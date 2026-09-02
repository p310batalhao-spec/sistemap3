// ════════════════════════════════════════════════════════════════════
// ANÁLISE PREDITIVA — CAD (Sistema P3, 10º BPM)
// ════════════════════════════════════════════════════════════════════
// Consome o MESMO Apps Script já usado por page/rastreamento-guarnicao.html
// (GAS_CAD_URL abaixo = GAS_RASTREAMENTO_URL de lá — é o mesmo projeto/
// implantação, só com rotas novas: ?acao=ocorrencias / ?acao=envolvidos /
// ?acao=diagnostico_ocorrencias / ?acao=definir_credenciais_cad /
// ?acao=diagnostico_auth). A pesquisa de ocorrências/envolvidos no CAD só é
// liberada pela conta pessoal do usuário (CPF+senha) — o token sozinho
// (?acao=definir_token, usado pelo Rastreamento de Guarnição) não é
// suficiente. Por isso o modal desta página pede CPF+senha+token e o Apps
// Script encadeia os dois logins (autenticarCadCompleto_).
//
// Formato de resposta dos dois endpoints de grade do CAD
// (cad_grid_tb_ocor_consulta_com_cadastro e
// cad_grid_tb_ocor_despc_envl_envolvidos_pesquisa) ainda não foi
// confirmado em produção — o Apps Script normaliza campos usando o MESMO
// dicionário de nomes reais do CAD já usado em js/cadastroocorrencias.js
// (MAPA_GERAL/MAPA_AUTOR, alimentado pelas planilhas que vêm direto do
// CAD). Se algum campo aparecer vazio/"---" na tela, use o botão
// "🔧 Diagnóstico CAD" pra ver a resposta bruta e ajustar o mapeamento no
// Apps Script.
// ════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    // Marcador de versão só pra diagnóstico de cache do navegador — se
    // este log não aparecer no console ao carregar a página, o
    // navegador está servindo um js/preditivaCAD.js em cache, mais
    // antigo que este arquivo (precisa de hard refresh: Ctrl+Shift+R).
    console.log('[preditivaCAD] script carregado — versão com mega-cards CVP/CVLI/MVI 12 meses (estilo analisePreditiva) (2026-08-11)');

    // Mesma implantação (Web App) do Coletor GEO 10º BPM — ver
    // page/rastreamento-guarnicao.html:608. Não é uma URL nova: as rotas
    // de ocorrências/envolvidos foram adicionadas nesse MESMO projeto.
    const GAS_CAD_URL = 'https://script.google.com/macros/s/AKfycbwuyKpN4AbmV_CmQfZr2olClY1JveArwKEcJE3__DFf74xfnd3AlhXqnde7RPkXDlqx/exec';

    window._cadOcorrencias = [];
    window._cadEnvolvidos  = [];
    window._cadValidas     = [];

    let chartCvpMes = null, chartCvliMes = null, chartMviMes = null;
    let chartTipCvp = null, chartTipCvli = null, chartTipMvi = null;

    // ────────────────────────────────────────────────────────────────
    // FILTRO CRUZADO — clicar num gráfico (tipificação/dia da
    // semana/horário/hotspot) filtra os demais, igual
    // page/dashboard-cruzado.html (js/dashboard-cruzado.js:
    // aplicarCross/toggleCross). Os gráficos de SÉRIE TEMPORAL (mês) NÃO
    // participam disso — o clique neles abre o modal de ocorrências
    // (estilo page/analisePreditiva.html), pedido separado do usuário.
    // exceto: dimensão do próprio gráfico que originou o clique fica de
    // fora do filtro pra continuar mostrando a distribuição inteira
    // (senão não dá pra escolher outra fatia ou desfazer o clique).
    // ────────────────────────────────────────────────────────────────
    window._cadCross = { tip: null, dia: null, hora: null, cidade: null };

    function chaveCidadeBairro_(it) {
        return (it.CIDADE || 'N/D').toString().trim() + '||' + (it.BAIRRO || 'N/D').toString().trim();
    }
    function tipificacaoLabel_(it) {
        const t1 = (it.TIPIFICACAO || '').toString().trim();
        if (t1 && t1 !== '---') return t1;
        const t2 = (it.TIPIFICACAO_GERAL || '').toString().trim();
        return (t2 && t2 !== '---') ? t2 : '';
    }
    function aplicarCrossCAD(lista, exceto) {
        const c = window._cadCross;
        return lista.filter(function (it) {
            if (c.tip && exceto !== 'tip' && tipificacaoLabel_(it) !== c.tip) return false;
            if (c.dia !== null && exceto !== 'dia') {
                const d = parseDataBR(it.DATA);
                if (!d || d.getDay() !== c.dia) return false;
            }
            if (c.hora !== null && exceto !== 'hora' && parseHoraCAD(it) !== c.hora) return false;
            if (c.cidade && exceto !== 'cidade' && chaveCidadeBairro_(it) !== c.cidade) return false;
            return true;
        });
    }
    function toggleCrossCAD(campo, valor) {
        const c = window._cadCross;
        c[campo] = (c[campo] === valor) ? null : valor;
        renderClassificacaoRisco();
    }
    function limparCrossCAD() {
        window._cadCross = { tip: null, dia: null, hora: null, cidade: null };
        renderClassificacaoRisco();
    }
    function limparUmCrossCAD(campo) {
        window._cadCross[campo] = null;
        renderClassificacaoRisco();
    }
    function renderChipsCrossCAD() {
        const box = document.getElementById('cross-chips-cad');
        if (!box) return;
        const c = window._cadCross;
        const chips = [];
        if (c.tip) chips.push({ campo: 'tip', label: 'Tipificação: ' + c.tip });
        if (c.dia !== null) chips.push({ campo: 'dia', label: 'Dia: ' + DIAS_SEMANA_FULL[c.dia] });
        if (c.hora !== null) chips.push({ campo: 'hora', label: 'Horário: ' + c.hora + 'h' });
        if (c.cidade) chips.push({ campo: 'cidade', label: 'Local: ' + c.cidade.replace('||', ' / ') });
        if (!chips.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
        box.style.display = 'flex';
        box.innerHTML = '<span class="chips-label-cad">🔗 Filtros ativos (clique no gráfico de novo pra desfazer):</span>' +
            chips.map(function (ch) {
                return '<span class="chip-cad" data-campo="' + escapeHtml(ch.campo) + '">' + escapeHtml(ch.label) + ' <b>✕</b></span>';
            }).join('') +
            '<button type="button" class="chip-limpar-cad" data-limpar-tudo>✕ Limpar tudo</button>';
    }

    // Cores dos eixos/legenda/grid dos gráficos Chart.js, lidas dos
    // tokens de tema (--p3-text/--p3-text-muted/--p3-border, ver
    // css/theme.css) — SEM isso os gráficos usam a cor padrão escura do
    // Chart.js pros textos, que fica ilegível (texto escuro sobre fundo
    // escuro) quando o modo escuro está ativo. Mesmo padrão de
    // js/dashboard-cruzado.js:coresTema().
    function coresTemaCAD_() {
        const cs = getComputedStyle(document.documentElement);
        return {
            texto: (cs.getPropertyValue('--p3-text') || '#1c1c1a').trim(),
            mudo: (cs.getPropertyValue('--p3-text-muted') || '#7a7a72').trim(),
            grade: (cs.getPropertyValue('--p3-border') || '#e5e3dc').trim(),
        };
    }

    // ────────────────────────────────────────────────────────────────
    // BOOT
    // ────────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', async function () {
        if (!P3.requireAuth()) return;

        let cfg = null;
        try { cfg = await P3.loadUnidadeConfig(); } catch (e) { console.warn('[preditivaCAD] loadUnidadeConfig:', e.message); }
        const elUnidade = document.getElementById('cabecalho-unidade');
        if (elUnidade) elUnidade.textContent = (cfg && cfg.nome ? cfg.nome : '') + ' — SEÇÃO P3';
        // Guardado global — usado pelo log de previsões (salvarPrevisaoSeNecessario_/
        // buscarPrevisaoRegistrada_) pra gravar/conferir no Firebase da
        // unidade sem precisar re-buscar cfg em cada função.
        window._cadFirebaseUrl = (cfg && cfg.firebase && cfg.firebase.databaseURL) || null;
        // Mesmo espírito — usado por capturarClimaHistoricoSeNecessario_
        // pra montar a URL/chave da Hostinger sem re-buscar cfg.
        window._cadUnidadeConfig = cfg;

        configurarDatasPadrao();
        CadLoginModal.montarBadge(document.getElementById('clm-badge-container'));

        document.getElementById('btn-atualizar-cad').addEventListener('click', () => carregarDadosCAD());
        document.getElementById('btn-diagnostico').addEventListener('click', rodarDiagnostico);
        document.getElementById('busca-ocorrencias').addEventListener('input', renderTabelaOcorrencias);
        document.getElementById('busca-envolvidos').addEventListener('input', renderTabelaEnvolvidos);
        document.getElementById('btn-busca-direta').addEventListener('click', buscarDiretoNoCAD_);
        // Enter em qualquer um dos dois campos já dispara a busca —
        // não devia ser obrigatório clicar no botão.
        document.getElementById('busca-direta-boletim').addEventListener('keydown', function (e) { if (e.key === 'Enter') buscarDiretoNoCAD_(); });
        document.getElementById('busca-direta-data').addEventListener('keydown', function (e) { if (e.key === 'Enter') buscarDiretoNoCAD_(); });

        // ── Modal de ocorrências (clique num ponto do gráfico mensal) ──
        document.getElementById('modal-cad-fechar').addEventListener('click', function () {
            document.getElementById('modal-ocorrencias-cad').classList.remove('aberto');
        });
        document.getElementById('modal-ocorrencias-cad').addEventListener('click', function (e) {
            if (e.target === document.getElementById('modal-ocorrencias-cad')) {
                document.getElementById('modal-ocorrencias-cad').classList.remove('aberto');
            }
        });
        document.getElementById('modal-cad-busca').addEventListener('input', function (e) {
            const q = e.target.value.toLowerCase();
            renderModalCadTabela(_modalCadRegistros.filter(function (r) {
                return (r.BOLETIM || '').toLowerCase().includes(q) ||
                    (r.TIPIFICACAO || r.TIPIFICACAO_GERAL || '').toLowerCase().includes(q) ||
                    (r.BAIRRO || '').toLowerCase().includes(q) ||
                    (r.CIDADE || '').toLowerCase().includes(q);
            }));
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') document.getElementById('modal-ocorrencias-cad').classList.remove('aberto');
        });

        // ── Filtro cruzado — cliques em elementos renderizados via
        // innerHTML (não dá pra addEventListener direto neles, então
        // delega no container pai, que existe desde o boot). ──
        document.getElementById('tbody-hotspot').addEventListener('click', function (e) {
            if (e.target.closest('a')) return; // não interfere no link do mapa
            const tr = e.target.closest('tr[data-chave]');
            if (tr) toggleCrossCAD('cidade', tr.dataset.chave);
        });
        document.getElementById('heatmap-horario').addEventListener('click', function (e) {
            const cel = e.target.closest('[data-hora]');
            if (cel) toggleCrossCAD('hora', parseInt(cel.dataset.hora, 10));
        });
        document.getElementById('previsao-onde-quando').addEventListener('click', function (e) {
            if (e.target.closest('a')) return; // não interfere no link de coordenada (Zona Rural)
            const item = e.target.closest('[data-chave]');
            if (item) toggleCrossCAD('cidade', item.dataset.chave);
        });
        document.getElementById('cross-chips-cad').addEventListener('click', function (e) {
            if (e.target.closest('[data-limpar-tudo]')) { limparCrossCAD(); return; }
            const chip = e.target.closest('.chip-cad');
            if (chip) limparUmCrossCAD(chip.dataset.campo);
        });
        document.getElementById('filtro-categoria-risco').addEventListener('click', function (e) {
            const btn = e.target.closest('.cat-risco-btn');
            if (!btn) return;
            window._cadCategoriaRisco = btn.dataset.cat;
            if (window._cadBaseCVP) renderClassificacaoRisco();
            else atualizarBotoesCategoriaRisco_(); // ainda sem dados carregados — só marca o botão ativo
        });

        // Chart.js não recalcula sozinho as cores dos eixos/legenda quando
        // o tema muda — sem isso os gráficos ficariam com a cor antiga até
        // um F5. Re-renderiza tudo (destroy+recreate, já é o padrão usado
        // em cada render*) um instante depois do clique, pra dar tempo do
        // atributo data-p3-theme já ter sido trocado (ver js/core/session.js:
        // alternarTema). Mesmo padrão de js/dashboard-cruzado.js.
        document.querySelectorAll('#btn-tema').forEach(function (btn) {
            btn.addEventListener('click', function () {
                setTimeout(function () { if (window._cadBaseCVP) renderClassificacaoRisco(); }, 60);
            });
        });

        if (verificarTokenGEO()) {
            carregarDadosCAD();
        } else {
            document.getElementById('status-carga').textContent = '⛔ Configure o token de acesso ao CAD para carregar os dados.';
        }
    });

    // Início do mês, 11 meses atrás — 12 meses-calendário completos (mês
    // atual + 11 anteriores) como padrão, igual ao horizonte usado em
    // page/analisePreditiva.html. É o volume mínimo pro modelo de
    // sazonalidade do MLLeve rodar com confiança "média" (só fica "alta"
    // com 24+ meses) e pra mediaPonderada/regressaoLinear terem uma base
    // de verdade, não só o mínimo técnico de 2 pontos. Isso deixa a carga
    // inicial mais lenta (mais páginas no CAD, ~4-5x mais que os 3 meses
    // usados antes) — a barra de progresso existe justamente pra dar
    // visibilidade disso enquanto carrega.
    function configurarDatasPadrao() {
        const hoje = new Date();
        const ini = new Date(hoje.getFullYear(), hoje.getMonth() - 11, 1);
        document.getElementById('data-fim').value = hoje.toISOString().substring(0, 10);
        document.getElementById('data-ini').value = ini.toISOString().substring(0, 10);
    }

    // ────────────────────────────────────────────────────────────────
    // FETCH — mesmo padrão de page/rastreamento-guarnicao.html: GET com
    // parâmetros na URL (GAS não aceita POST com Content-Type JSON por
    // CORS), resposta sempre JSON com {ok, ...}.
    // ────────────────────────────────────────────────────────────────
    async function fetchCAD(acao, params) {
        const qs = new URLSearchParams(Object.assign({ acao: acao }, params || {})).toString();
        const resp = await fetch(GAS_CAD_URL + '?' + qs, { redirect: 'follow' });
        const texto = await resp.text();
        let data;
        try { data = JSON.parse(texto); }
        catch (e) { throw new Error('Resposta do Apps Script não é JSON válido (veja o Diagnóstico): ' + texto.substring(0, 200)); }
        return data;
    }

    // Cada execução do Apps Script tem um teto de tempo (~6min na conta
    // free) — com 12 meses de período, um ano movimentado pode nem
    // caber nesse teto de jeito nenhum, não importa quanto os limites
    // internos do backend sejam alargados. Em vez disso, encadeia
    // QUANTAS chamadas forem necessárias: cada resposta truncada por
    // limite de tempo/páginas (não por realmente ter acabado) vem com
    // `proximoOffset` (ver buscarOcorrenciasCAD no Apps Script) — usa
    // isso como offsetInicial da PRÓXIMA chamada, que roda como uma
    // execução NOVA (teto de tempo totalmente fresco) e retoma
    // exatamente de onde a anterior parou, sem reprocessar nada.
    // MAX_PARTES_RETOMADA: rede de segurança contra loop indevido (ex.:
    // um bug no backend devolvendo truncado:true pra sempre) — 6 partes
    // já cobre um volume bem maior que qualquer período razoável.
    const MAX_PARTES_RETOMADA = 6;
    async function buscarOcorrenciasComRetomada_(dataIni, dataFim, statusEl) {
        let parte = 1;
        let resp = await fetchCAD('ocorrencias', { dataIni: dataIni, dataFim: dataFim });
        if (resp.ok === false) return resp;
        let dadosAcumulados = resp.dados || [];

        while (resp.truncado && resp.proximoOffset && parte < MAX_PARTES_RETOMADA) {
            parte++;
            if (statusEl) statusEl.textContent = '⏳ Consultando CAD... (parte ' + parte + ' — ' + dadosAcumulados.length + ' de ' + (resp.totalRelatadoPeloCAD || '?') + ' já carregadas)';
            resp = await fetchCAD('ocorrencias', {
                dataIni: dataIni, dataFim: dataFim,
                offsetInicial: String(resp.proximoOffset),
                totalConhecido: String(resp.totalRelatadoPeloCAD || ''),
                parte: String(parte),
            });
            if (resp.ok === false) {
                // Uma parte falhou no meio do caminho — não descarta o que
                // já foi carregado até aqui, só marca como truncado com o
                // motivo do erro (mais honesto que perder tudo por causa
                // de uma falha pontual numa retomada).
                return { ok: true, dados: dadosAcumulados, totalRelatadoPeloCAD: resp.totalRelatadoPeloCAD, truncado: true, motivoTruncamento: 'falha ao retomar a busca (parte ' + parte + '): ' + (resp.erro || 'erro desconhecido') };
            }
            // Dedup por BOLETIM ao juntar — mesma precaução do backend,
            // caso duas partes se sobreponham por algum motivo.
            const vistos = {};
            dadosAcumulados.forEach(function (it) { if (it.BOLETIM) vistos[it.BOLETIM] = true; });
            (resp.dados || []).forEach(function (it) { if (!it.BOLETIM || !vistos[it.BOLETIM]) { vistos[it.BOLETIM] = true; dadosAcumulados.push(it); } });
        }

        return {
            ok: true,
            dados: dadosAcumulados,
            totalRelatadoPeloCAD: resp.totalRelatadoPeloCAD,
            truncado: resp.truncado,
            motivoTruncamento: resp.truncado
                ? (parte >= MAX_PARTES_RETOMADA ? 'limite de ' + MAX_PARTES_RETOMADA + ' partes de retomada (período grande demais mesmo encadeando chamadas)' : resp.motivoTruncamento)
                : null,
            // scFresco da ÚLTIMA parte — usado por abrirBoletimCompletoCAD_
            // pra montar o link de "Boletim Completo" (ver mais abaixo).
            scFresco: resp.scFresco || null,
        };
    }

    // ────────────────────────────────────────────────────────────────
    // BARRA DE PROGRESSO — o Apps Script só devolve a resposta HTTP
    // quando a busca inteira termina (pode levar dezenas de segundos
    // com muitas páginas), então a única forma de mostrar progresso
    // real é fazer polling num endpoint separado (?acao=
    // progresso_ocorrencias) que lê o que o backend foi gravando
    // página a página enquanto a busca principal ainda está rodando.
    // ────────────────────────────────────────────────────────────────
    let progressoIntervalId = null;

    function mostrarBarraProgresso() {
        // "display: ''" NÃO sobrepõe o "display:none" da classe
        // .progresso-cad no CSS — só limpa o inline style, então o
        // valor da FOLHA DE ESTILO (none) continuava valendo e o
        // elemento nunca ficava visível de verdade, mesmo com toda a
        // lógica de progresso rodando certinho por baixo (confirmado
        // pelos logs). Precisa de um valor explícito que sobreponha.
        document.getElementById('progresso-cad').style.display = 'block';
        document.getElementById('progresso-cad-barra').style.width = '4%';
        document.getElementById('progresso-cad-texto').textContent = 'Autenticando e preparando a busca no CAD…';
    }
    function esconderBarraProgresso() {
        document.getElementById('progresso-cad').style.display = 'none';
    }
    function atualizarBarraProgresso(p) {
        const barra = document.getElementById('progresso-cad-barra');
        const texto = document.getElementById('progresso-cad-texto');
        // etapa distingue qual busca está em andamento quando há mais de
        // uma sequencial (CVP, depois CVLI/MVI, depois a busca geral) —
        // sem isso a barra volta pro início sem explicação a cada troca.
        const prefixo = p && p.etapa ? '[' + p.etapa + '] ' : '';
        if (!p || p.pagina === 0) {
            barra.style.width = '4%';
            texto.textContent = prefixo + 'Autenticando e preparando a busca no CAD…';
            return;
        }
        if (p.pagina < 0) {
            texto.textContent = prefixo + 'Falha na busca — veja a mensagem de erro acima.';
            return;
        }
        const pct = p.totalPaginas ? Math.max(4, Math.min(100, Math.round((p.pagina / p.totalPaginas) * 100))) : 4;
        barra.style.width = pct + '%';
        texto.textContent = prefixo + 'Página ' + p.pagina + ' de ' + p.totalPaginas + ' · ' +
            p.registrosAcumulados + ' de ' + p.totalReal + ' ocorrências carregadas (' + pct + '%)';
    }
    function iniciarPollingProgresso() {
        console.log('[preditivaCAD] iniciando barra de progresso e polling…');
        // NÃO chamar pararPollingProgresso() aqui — ela também ESCONDE a
        // barra (é feita pra ser chamada no FIM da busca), então mostrar
        // e logo em seguida "parar" no mesmo instante escondia a barra
        // de novo antes do primeiro poll rodar (bug real: os dados de
        // progresso chegavam certinho no console, mas a barra nunca
        // ficava visível). Só limpa um interval anterior, sem mexer na
        // visibilidade.
        if (progressoIntervalId) { clearInterval(progressoIntervalId); progressoIntervalId = null; }
        mostrarBarraProgresso();
        progressoIntervalId = setInterval(async function () {
            try {
                const p = await fetchCAD('progresso_ocorrencias', {});
                console.log('[preditivaCAD] progresso recebido:', p);
                atualizarBarraProgresso(p);
            } catch (e) { console.warn('[preditivaCAD] falha ao consultar progresso:', e); }
        }, 1500);
    }
    function pararPollingProgresso() {
        if (progressoIntervalId) { clearInterval(progressoIntervalId); progressoIntervalId = null; }
        esconderBarraProgresso();
    }

    // Trava contra buscas concorrentes — o Apps Script NÃO cancela uma
    // execução anterior quando chega uma requisição nova (e a página
    // dispara carregarDadosCAD() sozinha ao abrir, se o token já
    // estiver válido). Sem essa trava, um clique em "Atualizar do CAD"
    // enquanto a carga automática do boot ainda está rodando (ou dois
    // cliques seguidos) faz DUAS buscas paginadas rodarem em paralelo
    // no CAD ao mesmo tempo, usando a MESMA sessão — confirmado pelo
    // log de progresso "pulando" pra trás (duas execuções gravando
    // por cima uma da outra na mesma memória de progresso). Além da
    // barra ficar sem sentido, é arriscado: duas navegações de página
    // concorrentes na mesma sessão do CAD podem atropelar o cursor de
    // paginação uma da outra do lado do servidor.
    let carregandoCAD = false;

    async function carregarDadosCAD() {
        const statusEl = document.getElementById('status-carga');
        if (carregandoCAD) {
            console.warn('[preditivaCAD] Já existe uma busca em andamento — ignorando novo pedido.');
            statusEl.textContent = '⏳ Já existe uma busca em andamento — aguarde terminar.';
            return;
        }
        carregandoCAD = true;
        const btnAtualizar = document.getElementById('btn-atualizar-cad');
        btnAtualizar.disabled = true;
        const textoOriginalBtn = btnAtualizar.textContent;
        btnAtualizar.textContent = '⏳ Carregando...';

        statusEl.textContent = '⏳ Consultando CAD...';
        limparAlerta();

        const dataIni = document.getElementById('data-ini').value;
        const dataFim = document.getElementById('data-fim').value;

        iniciarPollingProgresso();

        // Busca RÁPIDA (filtrada por tipificação direto no CAD, ao invés
        // de baixar tudo e classificar aqui). Roda SEQUENCIALMENTE, antes
        // da busca geral abaixo — de propósito: as duas usam o mesmo
        // LockService no backend, e se disparassem juntas a busca geral
        // (lenta, ~5min) poderia ganhar a trava primeiro e bloquear essa
        // busca rápida por minutos, matando o motivo dela existir. Se
        // falhar por qualquer motivo, não aborta a carga — só cai de
        // volta pra classificação client-side de sempre, a partir dos
        // dados da busca geral (comportamento antigo, mais lento porém
        // já validado).
        window._cadClassificacaoRapida = false;
        try {
            const respClass = await fetchCAD('ocorrencias_classificadas', { dataIni: dataIni, dataFim: dataFim });
            if (respClass.ok) {
                if (respClass.scFresco) window._cadScFresco = respClass.scFresco;
                const cvpBruto = respClass.cvp || [];
                const cvliMviBruto = respClass.cvliMvi || [];
                window._cadArrCVP = cvpBruto.filter(isCVP);
                window._cadArrCVLI = cvliMviBruto.filter(isCVLI);
                window._cadArrMVI = cvliMviBruto.filter(isMVI);
                window._cadClassificacaoRapida = true;
                renderClassificacaoRisco();
                capturarClimaHistoricoSeNecessario_(window._cadArrCVP, window._cadArrCVLI, window._cadArrMVI);
                carregarPopulacoesCidades_(window._cadArrCVP, window._cadArrCVLI, window._cadArrMVI);
                if (respClass.truncadoCVP || respClass.truncadoCVLIMVI) {
                    mostrarAlerta(
                        'Classificação rápida incompleta — dados truncados',
                        'A busca filtrada por tipificação (CVP/CVLI/MVI) bateu um limite de segurança antes de trazer tudo (' +
                        (respClass.truncadoCVP ? 'CVP: ' + (respClass.totalCVP || '?') + ' no CAD' : '') +
                        (respClass.truncadoCVP && respClass.truncadoCVLIMVI ? ' · ' : '') +
                        (respClass.truncadoCVLIMVI ? 'CVLI/MVI: ' + (respClass.totalCVLIMVI || '?') + ' no CAD' : '') +
                        '). Os cards e gráficos de CVP/CVLI/MVI refletem só o que foi carregado — considere estreitar o período.'
                    );
                }
            } else {
                console.warn('[preditivaCAD] busca classificada retornou ok:false —', respClass.erro);
            }
        } catch (e) {
            console.warn('[preditivaCAD] busca classificada rápida falhou, seguindo com classificação a partir da busca geral:', e);
            window._cadClassificacaoRapida = false;
        }

        try {
            const [respOc, respEnv] = await Promise.all([
                buscarOcorrenciasComRetomada_(dataIni, dataFim, statusEl),
                fetchCAD('envolvidos', { dataIni: dataIni, dataFim: dataFim }),
            ]);
            if (respOc.ok === false) throw new Error(respOc.erro || 'Falha ao consultar ocorrências no CAD.');
            if (respEnv.ok === false) throw new Error(respEnv.erro || 'Falha ao consultar envolvidos no CAD.');

            if (respOc.scFresco) window._cadScFresco = respOc.scFresco;
            window._cadOcorrencias = respOc.dados || [];
            window._cadEnvolvidos = respEnv.dados || [];

            processarDados();
            statusEl.textContent = '✅ ' + window._cadOcorrencias.length + ' ocorrências · ' +
                window._cadEnvolvidos.length + ' envolvidos — atualizado ' + new Date().toLocaleTimeString('pt-BR');

            // truncado: o backend cortou a paginação por um limite de
            // segurança (tempo de execução do Apps Script ou nº de
            // páginas) antes de terminar — os dados carregados são
            // PARCIAIS, não o período inteiro selecionado. Precisa
            // avisar isso explicitamente: sem isso, um "✅ 7500
            // ocorrências" pareceria completo quando na real faltaram
            // milhares de registros (grave numa ferramenta de análise
            // preditiva usada pelo comando).
            if (respOc.truncado) {
                mostrarAlerta(
                    'Busca incompleta — dados truncados',
                    'O CAD tem ' + (respOc.totalRelatadoPeloCAD || '?') + ' ocorrência(s) no período, mas só foi possível ' +
                    'carregar ' + window._cadOcorrencias.length + ' antes de bater um limite de segurança (' +
                    (respOc.motivoTruncamento || 'motivo desconhecido') + '). As análises abaixo refletem só o que foi carregado — ' +
                    'considere estreitar o período selecionado para ter certeza de que os dados estão completos.'
                );
            }
        } catch (err) {
            console.error('[preditivaCAD]', err);
            statusEl.textContent = '❌ ' + err.message;
            mostrarAlerta('Falha ao consultar o CAD', err.message);
        } finally {
            pararPollingProgresso();
            carregandoCAD = false;
            btnAtualizar.disabled = false;
            btnAtualizar.textContent = textoOriginalBtn;
        }
    }

    // ────────────────────────────────────────────────────────────────
    // ML LEVE — filtra coordenadas fantasmas/suspeitas antes de qualquer
    // contagem geográfica, e gera a previsão de curto prazo (ver
    // js/machineLearningLeve.js).
    // ────────────────────────────────────────────────────────────────
    function processarDados() {
        const total = window._cadOcorrencias.length;
        const validas = window.MLLeve
            ? window.MLLeve.filtrarCoordenadasValidas(window._cadOcorrencias, function (it) {
                return {
                    lat: parseFloat(String(it.LATITUDE || '').replace(',', '.').trim()),
                    lng: parseFloat(String(it.LONGITUDE || '').replace(',', '.').trim()),
                    bairro: (it.BAIRRO || '').toString().toUpperCase().trim(),
                };
            })
            : window._cadOcorrencias;
        window._cadValidas = validas;

        document.getElementById('kpi-total-ocorrencias').textContent = total;
        document.getElementById('kpi-total-envolvidos').textContent = window._cadEnvolvidos.length;
        const pctValidas = total ? Math.round((validas.length / total) * 100) : 0;
        document.getElementById('kpi-coord-validas').textContent = pctValidas + '%';
        document.getElementById('kpi-coord-nota').textContent =
            (total - validas.length) + ' coordenada(s) descartada(s) (fora de Alagoas ou padrão suspeito de pino fixo)';

        // Se a busca rápida classificada já rodou com sucesso, ela já
        // chamou renderClassificacaoRisco() com dados mais confiáveis
        // (filtrados direto no CAD) — não repete aqui pra não sobrescrever
        // com a classificação client-side mais lenta/genérica.
        if (!window._cadClassificacaoRapida) {
            renderClassificacaoRisco();
            const _cvpFallback = window._cadOcorrencias.filter(isCVP), _cvliFallback = window._cadOcorrencias.filter(isCVLI), _mviFallback = window._cadOcorrencias.filter(isMVI);
            capturarClimaHistoricoSeNecessario_(_cvpFallback, _cvliFallback, _mviFallback);
            carregarPopulacoesCidades_(_cvpFallback, _cvliFallback, _mviFallback);
        }
        renderTabelaOcorrencias();
        renderTabelaEnvolvidos();
    }

    // ────────────────────────────────────────────────────────────────
    // CLASSIFICAÇÃO DE RISCO — CVP / CVLI / MVI. Mesma lógica de
    // classificação de js/analisePreditiva.js, adaptada pros campos que
    // a extração real do CAD já traz (TIPIFICACAO_GERAL/TIPIFICACAO).
    // Sem o campo OBITO (a grade do CAD não expõe isso), TENTATIVA de
    // tipo CVLI/MVI é sempre classificada como CVLI — sem esse campo
    // não dá pra confirmar quem morreu, então não separa pra MVI.
    // ────────────────────────────────────────────────────────────────
    const COR_CVP = '#e65100', COR_CVLI = '#6a1b9a', COR_MVI = '#b71c1c';

    function normRisco(str) {
        return String(str || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    }
    // Classificação CVP/CVLI/MVI — MOVIDA pra js/core/previsaoMensalCad.js
    // (02/09/2026) pra virar fonte única, compartilhada com o lembrete
    // automático de fim de mês (js/core/notificacoes.js, que roda sem
    // esta página estar aberta e precisa da MESMA regra de classificação
    // pra nunca divergir do que a tela mostraria). Ver ali o histórico de
    // bugs já corrigidos (subnotificação de óbito, "LATROCINIO TENTADO").
    const isMVI = window.PrevisaoMensalCAD.isMVI;
    const isCVLI = window.PrevisaoMensalCAD.isCVLI;
    const isCVP = window.PrevisaoMensalCAD.isCVP;

    function parseHoraCAD(item) {
        const h = String(item.HORA || '').trim();
        const n = parseInt(h.split(':')[0], 10);
        return isNaN(n) ? null : Math.min(23, Math.max(0, n));
    }

    // ────────────────────────────────────────────────────────────────
    // ENSEMBLE DE PREVISÃO — mesmo modelo de js/analisePreditiva.js
    // (regressão linear + média ponderada dos últimos 3 meses, 60/40),
    // combinado 50/50 com o Holt+sazonalidade do MLLeve quando disponível
    // — "dados mais robustos e confiáveis do machine learn" pedido pelo
    // usuário. Duplicado aqui (em vez de reaproveitar analisePreditiva.js)
    // porque esta página não carrega aquele script e não trabalha com o
    // mesmo formato de dados (Firebase vs. resposta direta do CAD).
    // ────────────────────────────────────────────────────────────────
    function regressaoLinear(arr) {
        const n = arr.length;
        if (n < 2) return arr[0] || 0;
        let sx = 0, sy = 0, sxy = 0, sx2 = 0;
        arr.forEach(function (v, i) { sx += i; sy += v; sxy += i * v; sx2 += i * i; });
        const denom = n * sx2 - sx * sx;
        const m = denom ? (n * sxy - sx * sy) / denom : 0;
        const b = (sy - m * sx) / n;
        return Math.round(Math.max(0, m * n + b));
    }
    function mediaPonderada(arr) {
        const ult = arr.slice(-3);
        if (!ult.length) return 0;
        const pesos = [1, 2, 3].slice(3 - ult.length);
        const soma = ult.reduce(function (a, v, i) { return a + v * pesos[i]; }, 0);
        return Math.round(soma / pesos.reduce(function (a, v) { return a + v; }, 0));
    }
    function preverSimples(arr) {
        return Math.round(mediaPonderada(arr) * 0.6 + regressaoLinear(arr) * 0.4);
    }
    function preverComEnsemble(arr) {
        const previsaoAtual = preverSimples(arr);
        if (!window.MLLeve || arr.length < 2) return previsaoAtual;
        const hw = window.MLLeve.preverComSazonalidade(arr, { passos: 1 });
        if (!hw || !hw.previsoes.length) return previsaoAtual;
        return Math.round(previsaoAtual * 0.5 + hw.previsoes[0] * 0.5);
    }

    function chaveMes(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }

    // Série mensal ZERO-PREENCHIDA entre dataIniStr e dataFimStr (ambos
    // "YYYY-MM-DD", vindos dos inputs de período) — um mês real sem
    // nenhum CVLI, por exemplo, precisa aparecer como 0 na série (não
    // sumir), senão o índice do "mês atual"/"mês anterior" desalinha
    // sempre que algum mês do meio zerar.
    function serieMensalCompleta(lista, dataIniStr, dataFimStr) {
        const porMes = new Map();
        lista.forEach(function (it) {
            const d = parseDataBR(it.DATA);
            if (!d) return;
            const k = chaveMes(d);
            porMes.set(k, (porMes.get(k) || 0) + 1);
        });
        const pIni = String(dataIniStr || '').split('-');
        const pFim = String(dataFimStr || '').split('-');
        if (pIni.length < 2 || pFim.length < 2) return { chaves: [], valores: [] };
        const cursor = new Date(+pIni[0], +pIni[1] - 1, 1);
        const fim = new Date(+pFim[0], +pFim[1] - 1, 1);
        const chaves = [], valores = [];
        while (cursor <= fim) {
            const k = chaveMes(cursor);
            chaves.push(k);
            valores.push(porMes.get(k) || 0);
            cursor.setMonth(cursor.getMonth() + 1);
        }
        return { chaves: chaves, valores: valores };
    }

    const NOMES_MES_COMPLETO = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const NOMES_MES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    function labelMesAbrev(chave) {
        const p = chave.split('-');
        return NOMES_MES_ABREV[+p[1] - 1] + '/' + p[0].slice(-2);
    }

    // calcDelta / media / topCidadeBairro — mesmas funções de
    // js/analisePreditiva.js (comportamento idêntico, só que operando
    // sobre os dados reais do CAD em vez do Firebase).
    function calcDelta(atual, anterior) {
        if (anterior == null || anterior === 0) return { txt: '—', cls: 'eq' };
        const d = atual - anterior;
        if (d > 0) return { txt: '▲ +' + d + ' vs mês ant.', cls: 'up' };
        if (d < 0) return { txt: '▼ ' + d + ' vs mês ant.', cls: 'down' };
        return { txt: '= igual ao mês ant.', cls: 'eq' };
    }
    function mediaSerie(arr) {
        const naoZero = arr.filter(function (v) { return v > 0; });
        if (!naoZero.length) return 0;
        return Math.round(naoZero.reduce(function (a, b) { return a + b; }, 0) / naoZero.length);
    }
    function topCidadeBairro(arr) {
        const mapa = new Map();
        arr.forEach(function (r) {
            const cidade = (r.CIDADE || 'N/D').toString().trim();
            const bairro = (r.BAIRRO || 'N/D').toString().trim();
            const chave = cidade + '||' + bairro;
            mapa.set(chave, (mapa.get(chave) || 0) + 1);
        });
        let melhorChave = null, melhorCnt = 0;
        mapa.forEach(function (cnt, chave) { if (cnt > melhorCnt) { melhorCnt = cnt; melhorChave = chave; } });
        return melhorChave ? [melhorChave, melhorCnt] : null;
    }
    function formatarCidadeBairro(top) {
        if (!top) return 'N/D';
        const partes = top[0].split('||');
        return partes[0] + ' · ' + partes[1];
    }

    // Preenche prevmes-X/real-X/delta-X-mes — mesma função de
    // js/analisePreditiva.js.
    function renderPrevReal(idPrev, idReal, idDelta, previsto, real) {
        document.getElementById(idPrev).textContent = previsto;
        document.getElementById(idReal).textContent = real;
        const diff = real - previsto;
        const el = document.getElementById(idDelta);
        if (diff > 0) { el.textContent = '▲ +' + diff + ' acima do previsto'; el.className = 'p-delta up'; }
        else if (diff < 0) { el.textContent = '▼ ' + diff + ' abaixo do previsto'; el.className = 'p-delta down'; }
        else { el.textContent = '= conforme previsto'; el.className = 'p-delta eq'; }
    }

    // onClickCb (opcional): recebe o índice do ponto clicado — usado
    // pelos gráficos mensais de CVP/CVLI/MVI pra abrir o modal de
    // ocorrências daquele mês (estilo page/analisePreditiva.html).
    function atualizarGraficoLinha(chartAnterior, id, labels, dataset, onClickCb) {
        if (chartAnterior) chartAnterior.destroy();
        const ctx = document.getElementById(id).getContext('2d');
        const cores = coresTemaCAD_();
        return new Chart(ctx, {
            type: 'line',
            data: { labels: labels, datasets: [dataset] },
            options: {
                // responsive+maintainAspectRatio:false — SEM isso o
                // Chart.js tenta manter uma proporção fixa (padrão ~2:1)
                // em vez de preencher o .chart-wrap de altura fixa da
                // página; o canvas interno acaba com um tamanho diferente
                // do que a CSS mostra, e ao passar o mouse o tooltip
                // recalcula posição/hover contra esse tamanho errado —
                // aparece como uma caixa deslocada "por cima" do gráfico.
                // Mesma configuração já usada e validada em
                // page/analisePreditiva.html (CFG_BASE).
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { color: cores.grade }, ticks: { color: cores.mudo } },
                    y: { beginAtZero: true, ticks: { precision: 0, color: cores.mudo }, grid: { color: cores.grade } },
                },
                elements: { point: { radius: 2, hoverRadius: 6 } },
                onClick: onClickCb ? function (evt, elements) { if (elements.length) onClickCb(elements[0].index); } : undefined,
            }
        });
    }
    // onClickCb (opcional): recebe o índice da barra clicada — usado
    // pelos gráficos de tipificação pra ativar o filtro cruzado
    // (toggleCrossCAD), estilo page/dashboard-cruzado.html.
    // Plugin leve (sem depender de nenhuma lib nova) que desenha o valor
    // numérico logo depois da ponta de cada barra HORIZONTAL — poupa o
    // usuário de ficar lendo a régua do eixo pra saber a contagem exata.
    // afterDatasetsDraw só desenha em barras horizontais (indexAxis:'y'),
    // então não afeta o gráfico de dia da semana (vertical, outro Chart()).
    Chart.register({
        id: 'valorBarraHorizontalCAD',
        afterDatasetsDraw: function (chart) {
            if (chart.config.type !== 'bar' || chart.options.indexAxis !== 'y') return;
            const dataset = chart.data.datasets[0];
            const meta = chart.getDatasetMeta(0);
            if (!dataset || !meta) return;
            const ctx = chart.ctx;
            ctx.save();
            ctx.font = 'bold 10px Arial, sans-serif';
            ctx.fillStyle = coresTemaCAD_().texto;
            ctx.textBaseline = 'middle';
            meta.data.forEach(function (bar, i) {
                const val = dataset.data[i];
                if (val == null) return;
                ctx.fillText(String(val), bar.x + 6, bar.y);
            });
            ctx.restore();
        },
    });

    function atualizarGraficoBar(chartAnterior, id, labels, data, cor, onClickCb) {
        if (chartAnterior) chartAnterior.destroy();
        const ctx = document.getElementById(id).getContext('2d');
        const cores = coresTemaCAD_();
        return new Chart(ctx, {
            type: 'bar',
            data: { labels: labels, datasets: [{ data: data, backgroundColor: cor, borderRadius: 4 }] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                // Espaço extra à direita — sem isso, o número desenhado
                // pelo plugin valorBarraHorizontalCAD nas barras mais
                // longas (perto do máximo da escala) ficava cortado pela
                // borda do canvas.
                layout: { padding: { right: 26 } },
                plugins: { legend: { display: false } },
                scales: {
                    x: { beginAtZero: true, ticks: { precision: 0, color: cores.mudo, font: { size: 10 } }, grid: { color: cores.grade } },
                    y: { ticks: { color: cores.mudo, font: { size: 10 } }, grid: { color: cores.grade } },
                },
                onClick: onClickCb ? function (evt, elements) { if (elements.length) onClickCb(elements[0].index); } : undefined,
            }
        });
    }

    // Mega-cards CVP/CVLI/MVI (total/mês atual+delta/média/cidade-bairro
    // crítico + gráfico de tendência) + cards "Previsão vs Real" e
    // "Previsão próximo mês" — MESMA matemática de
    // page/analisePreditiva.html (preverComEnsemble sobre a série
    // ZERO-PREENCHIDA), só que alimentada pelos dados reais do CAD.
    // Antes desta versão, a página tinha uma comparação própria (mês
    // anterior real vs mês atual real, direto) que não batia com a do
    // Análise Preditiva porque comparava coisas DIFERENTES — aqui é a
    // mesma conta: previsão do mês atual = ensemble sobre os meses
    // ANTERIORES (exclui o mês atual, que está incompleto) vs o real
    // parcial já importado; previsão do próximo mês = ensemble sobre
    // TODA a série (incluindo o mês atual).
    function renderMensalCategorias(arrCVP, arrCVLI, arrMVI) {
        const dataIni = document.getElementById('data-ini').value;
        const dataFim = document.getElementById('data-fim').value;

        const sCVP = serieMensalCompleta(arrCVP, dataIni, dataFim);
        const sCVLI = serieMensalCompleta(arrCVLI, dataIni, dataFim);
        const sMVI = serieMensalCompleta(arrMVI, dataIni, dataFim);
        const chaves = sCVP.chaves; // mesmo período pras 3 séries

        if (chaves.length === 0) {
            document.getElementById('previsao-confianca-nota').textContent = 'Selecione um período válido para calcular o comparativo mensal.';
            return;
        }

        const labels = chaves.map(labelMesAbrev);
        const idxAtual = chaves.length - 1;
        const mesAtualCVP = sCVP.valores[idxAtual] || 0;
        const mesAtualCVLI = sCVLI.valores[idxAtual] || 0;
        const mesAtualMVI = sMVI.valores[idxAtual] || 0;
        const mesAntCVP = idxAtual > 0 ? sCVP.valores[idxAtual - 1] : null;
        const mesAntCVLI = idxAtual > 0 ? sCVLI.valores[idxAtual - 1] : null;
        const mesAntMVI = idxAtual > 0 ? sMVI.valores[idxAtual - 1] : null;

        document.getElementById('cvp-total').textContent = arrCVP.length;
        document.getElementById('cvli-total').textContent = arrCVLI.length;
        document.getElementById('mvi-total').textContent = arrMVI.length;
        document.getElementById('cvp-mes-atual').textContent = mesAtualCVP;
        document.getElementById('cvli-mes-atual').textContent = mesAtualCVLI;
        document.getElementById('mvi-mes-atual').textContent = mesAtualMVI;
        document.getElementById('cvp-media').textContent = mediaSerie(sCVP.valores);
        document.getElementById('cvli-media').textContent = mediaSerie(sCVLI.valores);
        document.getElementById('mvi-media').textContent = mediaSerie(sMVI.valores);
        document.getElementById('cvp-cidade-bairro').textContent = formatarCidadeBairro(topCidadeBairro(arrCVP));
        document.getElementById('cvli-cidade-bairro').textContent = formatarCidadeBairro(topCidadeBairro(arrCVLI));
        document.getElementById('mvi-cidade-bairro').textContent = formatarCidadeBairro(topCidadeBairro(arrMVI));

        [['cvp', mesAtualCVP, mesAntCVP], ['cvli', mesAtualCVLI, mesAntCVLI], ['mvi', mesAtualMVI, mesAntMVI]].forEach(function (t) {
            const d = calcDelta(t[1], t[2]);
            const el = document.getElementById(t[0] + '-delta');
            el.textContent = d.txt; el.className = 'delta ' + d.cls;
        });

        const ultimoP = chaves[idxAtual].split('-');
        const dataMesAtual = new Date(+ultimoP[0], +ultimoP[1] - 1, 1);
        const dataProxMes = new Date(dataMesAtual.getFullYear(), dataMesAtual.getMonth() + 1, 1);
        document.getElementById('prev-nome-mes-atual').textContent = NOMES_MES_COMPLETO[dataMesAtual.getMonth()] + '/' + dataMesAtual.getFullYear();
        document.getElementById('prev-nome-prox-mes').textContent = NOMES_MES_COMPLETO[dataProxMes.getMonth()] + '/' + dataProxMes.getFullYear();

        // Previsão do MÊS ATUAL: ensemble sobre os meses ANTERIORES
        // (slice(0,-1) exclui o próprio mês atual) vs o valor real já
        // importado do CAD até agora.
        renderPrevReal('prevmes-cvp', 'real-cvp', 'delta-cvp-mes', preverComEnsemble(sCVP.valores.slice(0, -1)), mesAtualCVP);
        renderPrevReal('prevmes-cvli', 'real-cvli', 'delta-cvli-mes', preverComEnsemble(sCVLI.valores.slice(0, -1)), mesAtualCVLI);
        renderPrevReal('prevmes-mvi', 'real-mvi', 'delta-mvi-mes', preverComEnsemble(sMVI.valores.slice(0, -1)), mesAtualMVI);

        // Previsão do PRÓXIMO MÊS: ensemble sobre TODA a série (inclui o mês atual).
        document.getElementById('prev-cvp').textContent = preverComEnsemble(sCVP.valores);
        document.getElementById('prev-cvli').textContent = preverComEnsemble(sCVLI.valores);
        document.getElementById('prev-mvi').textContent = preverComEnsemble(sMVI.valores);

        // Índice mês→registros — pra abrir o modal de ocorrências com a
        // lista real ao clicar num ponto do gráfico (estilo
        // page/analisePreditiva.html: graficoLinha(...,onClickCb) +
        // abrirModal). Construído sobre os MESMOS arrays já recebidos
        // (arrCVP/arrCVLI/arrMVI — já passam pelo filtro cruzado das
        // OUTRAS dimensões ativas, exceto "mes", ver renderClassificacaoRisco).
        function indexarPorMes_(lista) {
            const idx = {};
            lista.forEach(function (it) {
                const d = parseDataBR(it.DATA);
                if (!d) return;
                const k = chaveMes(d);
                (idx[k] = idx[k] || []).push(it);
            });
            return idx;
        }
        const idxCVP = indexarPorMes_(arrCVP), idxCVLI = indexarPorMes_(arrCVLI), idxMVI = indexarPorMes_(arrMVI);

        chartCvpMes = atualizarGraficoLinha(chartCvpMes, 'chart-cvp-mes', labels,
            { label: 'CVP', data: sCVP.valores, borderColor: COR_CVP, backgroundColor: 'rgba(230,81,0,.12)', fill: true, tension: .35 },
            function (idx) {
                const chave = chaves[idx];
                abrirModalCAD('CVP — ' + labelMesAbrev(chave), (sCVP.valores[idx] || 0) + ' ocorrência(s)', idxCVP[chave] || []);
            });
        chartCvliMes = atualizarGraficoLinha(chartCvliMes, 'chart-cvli-mes', labels,
            { label: 'CVLI', data: sCVLI.valores, borderColor: COR_CVLI, backgroundColor: 'rgba(106,27,154,.12)', fill: true, tension: .35 },
            function (idx) {
                const chave = chaves[idx];
                abrirModalCAD('CVLI — ' + labelMesAbrev(chave), (sCVLI.valores[idx] || 0) + ' ocorrência(s)', idxCVLI[chave] || []);
            });
        chartMviMes = atualizarGraficoLinha(chartMviMes, 'chart-mvi-mes', labels,
            { label: 'MVI', data: sMVI.valores, borderColor: COR_MVI, backgroundColor: 'rgba(183,28,28,.12)', fill: true, tension: .35 },
            function (idx) {
                const chave = chaves[idx];
                abrirModalCAD('MVI — ' + labelMesAbrev(chave), (sMVI.valores[idx] || 0) + ' ocorrência(s)', idxMVI[chave] || []);
            });

        const confianca = chaves.length >= 24 ? 'alta' : chaves.length >= 12 ? 'média' : 'baixa';
        document.getElementById('previsao-confianca-nota').textContent =
            'Modelo: ensemble 50% (média ponderada + regressão linear) / 50% Holt com sazonalidade (Machine Learning) — ' +
            chaves.length + ' mês(es) de histórico no período selecionado, confiança ' + confianca +
            (chaves.length < 12 ? ' (o ideal são 12+ meses).' : '.');
    }

    // Top tipificações por categoria — mesmo padrão de
    // page/analisePreditiva.html (gráfico horizontal, 1 por categoria).
    // A grade do CAD sempre sufixa a tipificação com "| CÓDIGO PENAL" (a
    // Natureza Geral — todo CVP/CVLI/MVI já é, por definição, Código
    // Penal). Repetir isso em CADA barra do gráfico só ocupava espaço
    // sem informar nada novo, e era o que empurrava o início do rótulo
    // (ex.: "TENTATIVA DE...") pra fora da área visível do card. Só
    // encurta pra EXIBIÇÃO no eixo do gráfico — o filtro cruzado
    // (toggleCrossCAD) continua recebendo o rótulo COMPLETO (ver
    // renderTipificacaoPorCategoria abaixo), pra combinar exatamente com
    // o texto que tipificacaoLabel_/aplicarCrossCAD comparam.
    function encurtarLabelTipificacao_(label) {
        const semSufixo = String(label || '').replace(/\s*\|\s*C[ÓO]DIGO\s+PENAL\s*$/i, '').trim();
        return semSufixo.length > 30 ? semSufixo.substring(0, 28) + '…' : semSufixo;
    }

    function renderTipificacaoPorCategoria(arrCVP, arrCVLI, arrMVI) {
        const tCVP = contarTop(arrCVP, ['TIPIFICACAO', 'TIPIFICACAO_GERAL'], 8);
        const tCVLI = contarTop(arrCVLI, ['TIPIFICACAO', 'TIPIFICACAO_GERAL'], 8);
        const tMVI = contarTop(arrMVI, ['TIPIFICACAO', 'TIPIFICACAO_GERAL'], 8);
        chartTipCvp = atualizarGraficoBar(chartTipCvp, 'chart-tip-cvp', tCVP.map(function (t) { return encurtarLabelTipificacao_(t[0]); }), tCVP.map(function (t) { return t[1]; }), COR_CVP,
            function (idx) { toggleCrossCAD('tip', tCVP[idx][0]); });
        chartTipCvli = atualizarGraficoBar(chartTipCvli, 'chart-tip-cvli', tCVLI.map(function (t) { return encurtarLabelTipificacao_(t[0]); }), tCVLI.map(function (t) { return t[1]; }), COR_CVLI,
            function (idx) { toggleCrossCAD('tip', tCVLI[idx][0]); });
        chartTipMvi = atualizarGraficoBar(chartTipMvi, 'chart-tip-mvi', tMVI.map(function (t) { return encurtarLabelTipificacao_(t[0]); }), tMVI.map(function (t) { return t[1]; }), COR_MVI,
            function (idx) { toggleCrossCAD('tip', tMVI[idx][0]); });
    }

    function renderClassificacaoRisco() {
        // Caminho rápido: quando a busca filtrada direto no CAD (rota
        // ocorrencias_classificadas) deu certo, usa os arrays já prontos
        // dela em vez de reclassificar a busca geral aqui no cliente —
        // mais confiável (filtro pelo ID real da tipificação no CAD) e
        // não depende de window._cadOcorrencias já ter chegado.
        let arrCVP, arrCVLI, arrMVI;
        if (window._cadClassificacaoRapida) {
            arrCVP = window._cadArrCVP || [];
            arrCVLI = window._cadArrCVLI || [];
            arrMVI = window._cadArrMVI || [];
        } else {
            const lista = window._cadOcorrencias;
            arrCVP = lista.filter(isCVP);
            arrCVLI = lista.filter(isCVLI);
            arrMVI = lista.filter(isMVI);
        }

        // Guarda a base (sem filtro cruzado) — os toggles de clique só
        // precisam chamar renderClassificacaoRisco() de novo, sem
        // refazer a busca/classificação.
        window._cadBaseCVP = arrCVP;
        window._cadBaseCVLI = arrCVLI;
        window._cadBaseMVI = arrMVI;

        renderChipsCrossCAD();

        // Conjunto totalmente cross-filtrado — usado pelos KPIs/tabelas/
        // gráficos que NÃO são donos de nenhuma dimensão de filtro.
        const fCVP = aplicarCrossCAD(arrCVP, null);
        const fCVLI = aplicarCrossCAD(arrCVLI, null);
        const fMVI = aplicarCrossCAD(arrMVI, null);

        renderAlertasRisco(fCVP, fCVLI, fMVI);
        // Cada gráfico abaixo é "dono" de uma dimensão (mês/tipificação/
        // dia da semana/hora/cidade) — pra continuar mostrando a
        // distribuição INTEIRA daquela dimensão (permitindo escolher outra
        // fatia ou desfazer o clique), ele usa o cross-filter aplicado a
        // TODAS as dimensões MENOS a própria (exceto). Mesmo princípio de
        // js/dashboard-cruzado.js:aplicarCross(lista, cat, exceto).
        renderHeatmapHorario(aplicarCrossCAD(arrCVP, 'hora').concat(aplicarCrossCAD(arrCVLI, 'hora'), aplicarCrossCAD(arrMVI, 'hora')));
        renderGraficoDiaSemana(aplicarCrossCAD(arrCVP, 'dia'), aplicarCrossCAD(arrCVLI, 'dia'), aplicarCrossCAD(arrMVI, 'dia'));
        renderHotspotRisco(aplicarCrossCAD(arrCVP, 'cidade'), aplicarCrossCAD(arrCVLI, 'cidade'), aplicarCrossCAD(arrMVI, 'cidade'));
        // "mes" não é uma dimensão do cross-filter (os gráficos mensais
        // abrem modal ao clicar, não filtram os demais — ver
        // renderMensalCategorias), então usa o conjunto totalmente filtrado.
        // ── BLOCO PRESERVADO — confronto Taxa do Mês x Estimativa (não alterar) ──
        renderMensalCategorias(fCVP, fCVLI, fMVI);
        // ── FIM DO BLOCO PRESERVADO ──

        // Acurácia preditiva espacial e Janela Móvel Tática usam a base
        // INTEIRA (sem o cross-filter de clique) de propósito — são
        // indicadores operacionais/de diagnóstico do modelo como um
        // todo; se dependessem do último gráfico clicado, um filtro
        // esquecido ligado (ex.: só "ROUBO") distorceria o hit rate e a
        // matriz tática sem o usuário perceber.
        renderAcuraciaPreditiva(arrCVP, arrCVLI, arrMVI);
        renderJanelaMovelTatica(arrCVP, arrCVLI, arrMVI);
        // Só tenta gravar a previsão do próximo mês 1x por sessão (não a
        // cada re-render de cross-filter/tema/categoria) — evita ficar
        // batendo no Firebase à toa; é idempotente de qualquer forma
        // (nunca sobrescreve uma previsão já gravada), mas não há motivo
        // pra tentar de novo toda hora dentro da mesma sessão de página.
        if (!window._cadPrevisaoSalvaTentativa) {
            window._cadPrevisaoSalvaTentativa = true;
            salvarPrevisaoSeNecessario_(arrCVP, arrCVLI, arrMVI);
        }

        renderTipificacaoPorCategoria(aplicarCrossCAD(arrCVP, 'tip'), aplicarCrossCAD(arrCVLI, 'tip'), aplicarCrossCAD(arrMVI, 'tip'));
        renderPrevisaoOndeQuando(fCVP, fCVLI, fMVI);

        // Mantém window._cadDadosRelatorio sempre atualizado — assim o
        // botão "Imprimir Relatório" já tem os dados prontos assim que o
        // usuário clicar, sem precisar esperar um recálculo na hora.
        atualizarDadosRelatorioCAD_(arrCVP, arrCVLI, arrMVI);
    }

    const DIAS_SEMANA_FULL = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

    // Índice do maior valor do array (hora ou dia-da-semana mais frequente).
    // Retorna null se tudo for zero (sem padrão pra apontar).
    function modaIndice(arr) {
        let maxV = 0, maxI = null;
        arr.forEach(function (v, i) { if (v > maxV) { maxV = v; maxI = i; } });
        return maxI;
    }

    // Responde direto à pergunta "em qual cidade, bairro, hora e dia da
    // semana pode acontecer um crime" — sem precisar de nenhum filtro
    // extra do usuário, sobre TODAS as ocorrências CVP/CVLI/MVI já
    // carregadas (mesmo conjunto usado no heatmap/hotspot acima).
    // Categoria escolhida no filtro Geral/CVP/CVLI/MVI do card "Previsão
    // de Risco — Onde e Quando" — GERAL combina as 3 (padrão de sempre);
    // cada categoria isolada olha SÓ pra ela mesma, porque o padrão de
    // onde/quando de um roubo (CVP) não é o mesmo de um homicídio (MVI) —
    // misturado, o "horário mais crítico" acaba sendo uma média sem
    // sentido operacional pra nenhum dos dois.
    window._cadCategoriaRisco = window._cadCategoriaRisco || 'geral';

    const NOMES_CATEGORIA_RISCO = { geral: 'Geral (CVP+CVLI+MVI)', cvp: 'CVP', cvli: 'CVLI', mvi: 'MVI' };

    function atualizarBotoesCategoriaRisco_() {
        const cat = window._cadCategoriaRisco;
        document.querySelectorAll('#filtro-categoria-risco .cat-risco-btn').forEach(function (btn) {
            btn.classList.toggle('ativa', btn.dataset.cat === cat);
        });
    }

    // ════════════════════════════════════════════════════════════════
    // CLIMA (CPTEC via BrasilAPI) — 02/09/2026, pedido explícito do
    // usuário: mostrar a previsão do tempo ao lado das cidades de maior
    // risco, como CONTEXTO operacional pra quem for planejar
    // patrulhamento (ex.: "vai chover amanhã em X"). Deliberadamente
    // NÃO entra como peso/coeficiente na probabilidade calculada pelo
    // MLLeve — a CPTEC só devolve previsão FUTURA, não um histórico de
    // clima passado, então não dá pra cruzar contra as ocorrências já
    // registradas e validar um coeficiente de verdade; melhor mostrar o
    // dado bruto do que fingir um ajuste não validado.
    //
    // BrasilAPI (brasilapi.com.br) tem CORS aberto (confirmado:
    // access-control-allow-origin: *) — chamado direto do navegador,
    // sem servidor local envolvido, igual ao Google Maps já é aqui.
    // Fluxo: nome da cidade → GET /api/cptec/v1/cidade/{nome} (acha o
    // id do CPTEC, cacheado em localStorage por 30 dias — a lista de
    // cidades quase nunca muda) → GET /api/cptec/v1/clima/previsao/{id}
    // (previsão dos próximos dias, usa só o 1º = amanhã).
    //
    // LACUNA REAL DE COBERTURA confirmada testando cidades da área do
    // 10º BPM: "Palmeira dos Índios" (uma das mais citadas na base) não
    // existe na base do CPTEC em nenhuma grafia testada — por isso todo
    // o fluxo abaixo trata "não encontrada" como caso normal (remove o
    // badge daquele item, não quebra o resto da tela).
    // ════════════════════════════════════════════════════════════════
    const CPTEC_CACHE_ID_KEY = 'cad_cptec_id_cidade_v1';
    const CPTEC_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

    function _cptecCacheIdCarregar() {
        try { return JSON.parse(localStorage.getItem(CPTEC_CACHE_ID_KEY) || '{}'); }
        catch (e) { return {}; }
    }
    function _cptecCacheIdSalvar(cache) {
        try { localStorage.setItem(CPTEC_CACHE_ID_KEY, JSON.stringify(cache)); }
        catch (e) { /* localStorage indisponível/cheio — sem cache, sem problema, só perde a otimização */ }
    }

    // Cidades da área do 10º BPM sem cobertura confirmada no CPTEC →
    // cidade vizinha usada como substituta (02/09/2026, decisão
    // explícita do usuário: "busque os dados de tempo em igaci... e
    // replique em palmeira" — "Palmeira dos Índios" não existe na base
    // do CPTEC em nenhuma grafia testada). Nunca finge que é dado
    // direto da própria cidade — cptecResolverIdCidade_ devolve também
    // `cidadeReal` sempre que usa uma substituta, e isso é propagado
    // até o badge/tooltip e até o registro salvo na Hostinger
    // (coluna cidade_substituta).
    const CPTEC_CIDADE_SUBSTITUTA_ = {
        'PALMEIRA DOS INDIOS': 'Igaci',
    };

    // id pode ser `null` no cache — significa "já sabemos que essa
    // cidade não existe no CPTEC (nem tem substituta)", evita
    // reconsultar toda hora. Devolve {id, cidadeReal} — cidadeReal é
    // null quando o id já é da própria cidade pedida (sem substituição).
    async function cptecResolverIdCidade_(nomeCidade) {
        const chave = normRisco(nomeCidade);
        const cache = _cptecCacheIdCarregar();
        const entrada = cache[chave];
        if (entrada && (Date.now() - entrada.ts) < CPTEC_CACHE_TTL_MS) {
            return { id: entrada.id, cidadeReal: entrada.cidadeReal || null };
        }

        async function buscarIdDireto(nome) {
            const resp = await fetch('https://brasilapi.com.br/api/cptec/v1/cidade/' + encodeURIComponent(nome));
            if (!resp.ok) return null;
            const lista = await resp.json();
            // Homônimos entre estados são comuns (ex.: "Belém" existe em
            // PA/PB/AL/PE) — prioriza o de Alagoas quando houver mais de 1.
            const doAL = lista.find(function (c) { return c.estado === 'AL'; });
            const escolhido = doAL || lista[0];
            return escolhido ? escolhido.id : null;
        }

        let id = null, cidadeReal = null;
        try {
            id = await buscarIdDireto(nomeCidade);
            if (id == null && CPTEC_CIDADE_SUBSTITUTA_[chave]) {
                cidadeReal = CPTEC_CIDADE_SUBSTITUTA_[chave];
                id = await buscarIdDireto(cidadeReal);
                if (id == null) cidadeReal = null; // substituta também não encontrada — desiste mesmo
            }
        } catch (e) {
            return { id: null, cidadeReal: null }; // rede indisponível agora — não grava no cache, tenta de novo na próxima
        }
        cache[chave] = { id: id, cidadeReal: cidadeReal, ts: Date.now() };
        _cptecCacheIdSalvar(cache);
        return { id: id, cidadeReal: cidadeReal };
    }

    // numDias: 1 (só amanhã, usado pro badge na tela) ou até 6 (usado
    // na captura histórica, ver capturarClimaHistoricoSeNecessario_).
    async function cptecPrevisao_(nomeCidade, numDias) {
        const resolvido = await cptecResolverIdCidade_(nomeCidade);
        if (resolvido.id == null) return null;
        try {
            const sufixo = numDias && numDias > 1 ? '/' + numDias : '';
            const resp = await fetch('https://brasilapi.com.br/api/cptec/v1/clima/previsao/' + resolvido.id + sufixo);
            if (!resp.ok) return null;
            const dados = await resp.json();
            const dias = (dados.clima || []).map(function (dia) {
                return { condicaoCod: dia.condicao, condicaoDesc: dia.condicao_desc, min: dia.min, max: dia.max, indiceUv: dia.indice_uv, data: dia.data };
            });
            return { dias: dias, cidadeReal: resolvido.cidadeReal };
        } catch (e) {
            return null;
        }
    }

    const CPTEC_ICONES_ = {
        ec: '☀️', pn: '⛅', cl: '🌤️', nu: '☁️', pc: '🌦️', ps: '🌦️', cm: '🌧️',
        ch: '🌧️', tc: '⛈️', pt: '⛈️', ne: '🌫️', ge: '🌨️', vn: '💨',
    };
    function cptecIcone_(codigo) {
        return CPTEC_ICONES_[String(codigo || '').toLowerCase()] || '🌡️';
    }

    // Progressive enhancement — roda DEPOIS do render síncrono de
    // renderizarBlocoOndeQuando_, injeta o badge de clima em cada item
    // sem bloquear/atrasar o render principal (as chamadas à CPTEC são
    // assíncronas e podem demorar/falhar). Só usada na tela ao vivo —
    // de propósito NÃO é chamada no fluxo do relatório impresso
    // (atualizarDadosRelatorioCAD_): o PDF é um registro do que já
    // aconteceu, previsão de clima do dia seguinte não faz sentido lá,
    // e mantém o relatório rápido/sem depender de rede externa.
    async function anexarClimaAoRanking_(box) {
        const itens = Array.prototype.slice.call(box.querySelectorAll('.previsao-item[data-cidade-clima]'));
        for (const item of itens) {
            const cidade = item.getAttribute('data-cidade-clima');
            const alvo = item.querySelector('.previsao-clima');
            if (!alvo) continue;
            const previsao = await cptecPrevisao_(cidade, 1);
            const dia = previsao && previsao.dias[0];
            if (!dia) { alvo.remove(); continue; }
            alvo.textContent = cptecIcone_(dia.condicaoCod) + ' ' + dia.min + '°–' + dia.max + '°';
            const origem = previsao.cidadeReal ? ' (réplica de ' + previsao.cidadeReal + ', cidade mais próxima com cobertura CPTEC)' : '';
            alvo.title = 'Previsão CPTEC pra amanhã em ' + cidade + origem + ': ' + dia.condicaoDesc + ' (dado bruto, contexto operacional — não entra no cálculo de risco)';
        }
    }

    // ════════════════════════════════════════════════════════════════
    // CAPTURA E ARMAZENAMENTO DE HISTÓRICO DE CLIMA — 02/09/2026,
    // pedido explícito do usuário: "faça a captura desses dados e
    // armazene na hostinger para poder lembrar desses dados e utilizar
    // também nas análises preditivas". Dispara 1x por CARGA REAL de
    // dados do CAD (chamada nos 2 pontos de carregarDadosCAD onde dado
    // novo de verdade chega — nunca a cada toggle de filtro), no máximo
    // 1x por dia por navegador (guard em localStorage) — captura TODAS
    // as cidades do período carregado, não só as 5 do ranking de risco:
    // uma amostra enviesada só nos dias/locais de maior risco
    // inviabilizaria qualquer correlação clima×crime no futuro.
    //
    // CPTEC devolve até 6 dias de previsão por chamada — cada captura
    // grava/atualiza TODOS eles (upsert por cidade+data, ver
    // hostinger-api/clima_historico.php): o valor salvo pra uma data
    // converge pro mais preciso à medida que a captura acontece mais
    // perto da própria data (a mais recente sempre sobrescreve a mais
    // antiga pra aquele dia).
    // ════════════════════════════════════════════════════════════════
    const CLIMA_HISTORICO_GUARD_KEY = 'cad_clima_historico_capturado_em';
    const CLIMA_DIAS_PREVISAO_HISTORICO = 6;

    function _cidadesDistintasDoPeriodo_(arrCVP, arrCVLI, arrMVI) {
        const vistos = new Set();
        const cidades = [];
        [].concat(arrCVP || [], arrCVLI || [], arrMVI || []).forEach(function (it) {
            const cidade = (it.CIDADE || '').trim();
            if (!cidade) return;
            const chave = normRisco(cidade);
            if (vistos.has(chave)) return;
            vistos.add(chave);
            cidades.push(cidade);
        });
        return cidades;
    }

    async function capturarClimaHistoricoSeNecessario_(arrCVP, arrCVLI, arrMVI) {
        const hoje = new Date().toISOString().slice(0, 10);
        if (localStorage.getItem(CLIMA_HISTORICO_GUARD_KEY) === hoje) return; // já capturou hoje neste navegador
        const cfg = window._cadUnidadeConfig;
        if (!cfg || !cfg.apiPhp || !cfg.apiPhp.url) return; // recurso só existe pro 10º BPM (mesma trava de P3.Autores)

        const cidades = _cidadesDistintasDoPeriodo_(arrCVP, arrCVLI, arrMVI);
        if (!cidades.length) return;

        const registros = [];
        for (const cidade of cidades) {
            const previsao = await cptecPrevisao_(cidade, CLIMA_DIAS_PREVISAO_HISTORICO);
            if (!previsao) continue; // cidade sem cobertura nem substituta — pula, não trava as outras
            previsao.dias.forEach(function (dia) {
                registros.push({
                    cidade: cidade, data: dia.data, condicaoCod: dia.condicaoCod, condicaoDesc: dia.condicaoDesc,
                    min: dia.min, max: dia.max, indiceUv: dia.indiceUv, cidadeSubstituta: previsao.cidadeReal || null,
                });
            });
        }
        if (!registros.length) return;

        try {
            const base = /\.php$/i.test(cfg.apiPhp.url) ? cfg.apiPhp.url.replace(/autores\.php$/i, 'clima_historico.php') : cfg.apiPhp.url + '/clima_historico.php';
            const resp = await fetch(base + '?action=importar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Api-Key': cfg.apiPhp.apiKey || '' },
                body: JSON.stringify({ registros: registros }),
            });
            if (resp.ok) localStorage.setItem(CLIMA_HISTORICO_GUARD_KEY, hoje);
        } catch (e) {
            console.warn('[preditivaCAD] falha ao salvar histórico de clima na Hostinger:', e.message);
        }
    }

    // ════════════════════════════════════════════════════════════════
    // POPULAÇÃO (IBGE, via BrasilAPI + SIDRA/Agregados) — 02/09/2026,
    // pedido explícito do usuário: normalizar o ranking de hotspots por
    // habitante, não só contagem bruta — uma cidade grande sempre
    // aparece "pior" só por ter mais gente, mesmo sem ser
    // proporcionalmente mais perigosa. Diferente do clima, população
    // NÃO precisa de histórico acumulado — já entra em uso direto.
    //
    // Fluxo: nome da cidade → tabela de municípios de AL inteira (1
    // chamada só, BrasilAPI, cacheada por 30 dias) → código IBGE →
    // população (IBGE Agregados/SIDRA, agregado 6579 "População
    // residente estimada", TODOS os códigos numa chamada só — testado
    // ao vivo, funciona em lote com N6[cod1,cod2,...]).
    // ════════════════════════════════════════════════════════════════
    const IBGE_CACHE_MUNICIPIOS_KEY = 'cad_ibge_municipios_al_v1';
    const IBGE_CACHE_POP_KEY = 'cad_ibge_populacao_v1';
    const IBGE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias — população não muda de um dia pro outro

    async function ibgeMapaMunicipiosAL_() {
        try {
            const cache = JSON.parse(localStorage.getItem(IBGE_CACHE_MUNICIPIOS_KEY) || 'null');
            if (cache && (Date.now() - cache.ts) < IBGE_CACHE_TTL_MS) return cache.mapa;
        } catch (e) { /* cache corrompido — ignora e busca de novo */ }

        let mapa = {};
        try {
            const resp = await fetch('https://brasilapi.com.br/api/ibge/municipios/v1/AL');
            if (resp.ok) {
                const lista = await resp.json();
                lista.forEach(function (m) { mapa[normRisco(m.nome)] = m.codigo_ibge; });
            }
        } catch (e) {
            return {}; // rede indisponível agora — não cacheia, tenta de novo na próxima
        }
        try { localStorage.setItem(IBGE_CACHE_MUNICIPIOS_KEY, JSON.stringify({ mapa: mapa, ts: Date.now() })); }
        catch (e) { /* localStorage indisponível/cheio — sem cache, sem problema */ }
        return mapa;
    }

    function _ibgeCachePopCarregar() {
        try { return JSON.parse(localStorage.getItem(IBGE_CACHE_POP_KEY) || '{}'); }
        catch (e) { return {}; }
    }
    function _ibgeCachePopSalvar(cache) {
        try { localStorage.setItem(IBGE_CACHE_POP_KEY, JSON.stringify(cache)); }
        catch (e) { /* localStorage indisponível/cheio — sem cache, sem problema */ }
    }

    // Preenche window._cadPopulacoes (objeto {cidadeNormalizada: população})
    // com as cidades do período carregado e re-renderiza o card de
    // Hotspots quando terminar (mesmo espírito "progressive enhancement"
    // do clima) — computarHotspots_ já lê window._cadPopulacoes de forma
    // síncrona, então a 1ª renderização (antes disso terminar) sai igual
    // a antes (só contagem bruta), e a taxa/10k aparece assim que chega.
    async function carregarPopulacoesCidades_(arrCVP, arrCVLI, arrMVI) {
        const cidades = _cidadesDistintasDoPeriodo_(arrCVP, arrCVLI, arrMVI);
        if (!cidades.length) return;

        const mapaMunicipios = await ibgeMapaMunicipiosAL_();
        const cachePop = _ibgeCachePopCarregar();
        const populacoes = {};
        const codigosParaBuscar = [];
        const codigoParaChaveCidade = {};

        cidades.forEach(function (cidade) {
            const chave = normRisco(cidade);
            const cod = mapaMunicipios[chave];
            if (!cod) return; // nome não bateu com a lista do IBGE — fica sem taxa pra essa cidade, não trava as outras
            const entrada = cachePop[cod];
            if (entrada && (Date.now() - entrada.ts) < IBGE_CACHE_TTL_MS) {
                populacoes[chave] = entrada.populacao;
            } else {
                codigosParaBuscar.push(cod);
                codigoParaChaveCidade[cod] = chave;
            }
        });

        if (codigosParaBuscar.length) {
            try {
                const url = 'https://servicodados.ibge.gov.br/api/v3/agregados/6579/periodos/-1/variaveis/9324?localidades='
                    + encodeURIComponent('N6[' + codigosParaBuscar.join(',') + ']');
                const resp = await fetch(url);
                if (resp.ok) {
                    const dados = await resp.json();
                    const series = (dados[0] && dados[0].resultados[0] && dados[0].resultados[0].series) || [];
                    series.forEach(function (s) {
                        const cod = s.localidade.id;
                        const valoresAno = Object.values(s.serie || {});
                        const pop = valoresAno.length ? parseInt(valoresAno[valoresAno.length - 1], 10) : null;
                        if (!pop) return;
                        const chave = codigoParaChaveCidade[cod];
                        if (!chave) return;
                        populacoes[chave] = pop;
                        cachePop[cod] = { populacao: pop, ts: Date.now() };
                    });
                    _ibgeCachePopSalvar(cachePop);
                }
            } catch (e) {
                console.warn('[preditivaCAD] falha ao buscar população IBGE:', e.message);
            }
        }

        if (Object.keys(populacoes).length) {
            window._cadPopulacoes = Object.assign({}, window._cadPopulacoes, populacoes);
            if (window._cadBaseCVP) renderClassificacaoRisco(); // reaplica com a taxa/10k já disponível
        }
    }

    // Cálculo puro (sem DOM) de "Previsão de Risco — Onde e Quando" pra
    // UMA categoria (geral/cvp/cvli/mvi) — extraído de
    // renderPrevisaoOndeQuando pra ser reaproveitado também na coleta de
    // dados do relatório impresso (atualizarDadosRelatorioCAD_), que
    // agora mostra os 4 blocos (Geral/CVP/CVLI/MVI) separados, chamando
    // esta função 4x com a MESMA lógica que a tela ao vivo usa quando o
    // usuário troca o filtro — garante que o relatório nunca diverge do
    // que a tela mostraria pra cada categoria.
    function computarPrevisaoOndeQuando_(arrCVP, arrCVLI, arrMVI, cat) {
        const todos = cat === 'cvp' ? arrCVP : cat === 'cvli' ? arrCVLI : cat === 'mvi' ? arrMVI : arrCVP.concat(arrCVLI, arrMVI);
        if (todos.length === 0) return { cat: cat, todos: todos, vazio: true };

        // Panorama geral — dia da semana e horário de maior concentração
        // considerando TODO o período carregado.
        const horaGlobal = Array(24).fill(0);
        const diaGlobal = Array(7).fill(0);
        todos.forEach(function (it) {
            const h = parseHoraCAD(it);
            if (h !== null) horaGlobal[h]++;
            const d = parseDataBR(it.DATA);
            if (d) diaGlobal[d.getDay()]++;
        });
        const hPico = modaIndice(horaGlobal);
        const dPico = modaIndice(diaGlobal);

        // Ranking por cidade/bairro, cada um com seu PRÓPRIO pico de dia
        // e hora (o hotspot mais violento pode ter um horário diferente
        // do panorama geral do 10º BPM inteiro).
        const mapa = new Map();
        todos.forEach(function (it) {
            const cidade = (it.CIDADE || 'N/D').trim() || 'N/D';
            const bairro = (it.BAIRRO || 'N/D').trim() || 'N/D';
            const chave = cidade + '||' + bairro;
            if (!mapa.has(chave)) mapa.set(chave, { cidade: cidade, bairro: bairro, total: 0, horas: Array(24).fill(0), dias: Array(7).fill(0), itens: [] });
            const g = mapa.get(chave);
            g.total++;
            g.itens.push(it);
            const h = parseHoraCAD(it);
            if (h !== null) g.horas[h]++;
            const d = parseDataBR(it.DATA);
            if (d) g.dias[d.getDay()]++;
        });

        // Ranking dos locais — por padrão (ou se o MLLeve estiver
        // indisponível/sem histórico suficiente) usa a contagem histórica
        // bruta já calculada acima (heurística). Quando o MLLeve consegue
        // calibrar (mínimo 30 exemplos com as duas classes representadas),
        // troca pelo ranking de PROBABILIDADE REAL — regressão logística
        // treinada do zero sobre o histórico (MLLeve.preverRiscoPorLocal),
        // MESMA técnica já usada em page/analisePreditiva.html.
        //
        // O que conta como "grave" (o rótulo que o modelo aprende a
        // prever) muda com a categoria escolhida:
        //   • GERAL: CVLI é o grave, CVP entra só como indício de
        //     atividade recente na área (mesmo raciocínio da referência
        //     em analisePreditiva.js) — pergunta: "onde é mais provável
        //     ter um CVLI/MVI dado o clima de CVP na área?".
        //   • CVP/CVLI/MVI isolados: SEM classe de contexto — o próprio
        //     tipo escolhido é o "grave" que se quer prever, ou seja,
        //     onde ELE MESMO tende a se repetir nos próximos 7 dias
        //     (recidivência da própria categoria, sem misturar com as
        //     outras). Funciona porque o rótulo do MLLeve não é "este
        //     item é grave", é "um item grave aconteceu no MESMO local
        //     nos 7 dias seguintes" — mesmo com uma única categoria
        //     homogênea, ainda há exemplos com rótulo 0 e 1 de sobra.
        let riscoLocalML = null;
        if (window.MLLeve) {
            let flatRisco;
            if (cat === 'geral') {
                flatRisco = arrCVLI
                    .map(function (r) { return { cidade: r.CIDADE, bairro: r.BAIRRO, data: parseDataBR(r.DATA), grave: true }; })
                    .concat(arrCVP.map(function (r) { return { cidade: r.CIDADE, bairro: r.BAIRRO, data: parseDataBR(r.DATA), grave: false }; }));
            } else {
                flatRisco = todos.map(function (r) { return { cidade: r.CIDADE, bairro: r.BAIRRO, data: parseDataBR(r.DATA), grave: true }; });
            }
            flatRisco = flatRisco.filter(function (o) { return o.data; });
            riscoLocalML = window.MLLeve.preverRiscoPorLocal(flatRisco, { janelaDias: 7, topN: 5 });
        }

        const usaML = !!(riscoLocalML && riscoLocalML.calibrado && riscoLocalML.ranking.length);
        let ranking;
        if (usaML) {
            // r.cidade/r.bairro do MLLeve são agrupados por texto
            // NORMALIZADO (sem acento/maiúsculo) — recalcula dia/hora
            // filtrando "todos" com a mesma normalização, em vez de tentar
            // casar contra a chave (não-normalizada) do Map "mapa" acima,
            // que poderia deixar de fora variações de grafia da mesma
            // cidade/bairro.
            ranking = riscoLocalML.ranking.map(function (r) {
                const cidadeN = normRisco(r.cidade), bairroN = normRisco(r.bairro);
                const g = { cidade: r.cidade || 'N/D', bairro: r.bairro || 'N/D', total: 0, horas: Array(24).fill(0), dias: Array(7).fill(0), itens: [], probabilidadeML: r.probabilidade };
                todos.forEach(function (it) {
                    if (normRisco(it.CIDADE || 'N/D') !== cidadeN || normRisco(it.BAIRRO || 'N/D') !== bairroN) return;
                    g.total++;
                    g.itens.push(it);
                    const h = parseHoraCAD(it);
                    if (h !== null) g.horas[h]++;
                    const d = parseDataBR(it.DATA);
                    if (d) g.dias[d.getDay()]++;
                });
                return g;
            });
        } else {
            ranking = Array.from(mapa.values()).sort(function (a, b) { return b.total - a.total; }).slice(0, 5);
        }

        return {
            cat: cat, todos: todos, vazio: false,
            hPico: hPico, dPico: dPico, horaGlobal: horaGlobal, diaGlobal: diaGlobal,
            ranking: ranking, usaML: usaML,
            amostrasML: usaML ? riscoLocalML.amostras : null,
            motivoSemML: !usaML ? (riscoLocalML && riscoLocalML.motivo ? riscoLocalML.motivo : 'módulo de Machine Learning não disponível') : null,
        };
    }

    // Monta o HTML de um bloco de "Onde e Quando" a partir do resultado
    // de computarPrevisaoOndeQuando_ — usado pela tela ao vivo
    // (renderPrevisaoOndeQuando) e reaproveitável tal e qual no
    // relatório impresso, pra nunca ter dois jeitos de formatar a mesma
    // informação.
    function renderizarBlocoOndeQuando_(r, nomeCategoria, opts) {
        opts = opts || {};
        if (r.vazio) {
            return '<div class="previsao-nota">Sem ocorrências de ' + nomeCategoria + ' no período selecionado' +
                (opts.notaFiltroCruzado ? ' (considerando o filtro cruzado ativo)' : '') + '.</div>';
        }
        const partesResumo = [];
        if (r.dPico !== null) partesResumo.push('maior concentração às <strong>' + DIAS_SEMANA_FULL[r.dPico] + 's</strong> (' + r.diaGlobal[r.dPico] + ' ocorrência(s))');
        if (r.hPico !== null) partesResumo.push('horário mais crítico por volta das <strong>' + r.hPico + 'h</strong> (' + r.horaGlobal[r.hPico] + ' ocorrência(s))');
        const resumo = '<div class="previsao-resumo-geral">📍 <strong>Panorama ' + escapeHtml(nomeCategoria) + ' do período:</strong> ' +
            (partesResumo.length ? partesResumo.join(' · ') : 'dados insuficientes para apontar um padrão de dia/hora') +
            ' — com base em ' + r.todos.length + ' ocorrência(s).</div>';

        let fonteHtml;
        if (r.usaML) {
            const alvoTxt = r.cat === 'geral' ? 'CVLI/MVI' : nomeCategoria;
            fonteHtml = '<div class="previsao-nota">🤖 <strong>Ranking calculado por Machine Learning</strong> (regressão logística treinada sobre ' +
                r.amostrasML + ' exemplo(s) históricos) — estima a probabilidade real de ' + escapeHtml(alvoTxt) + ' nos próximos 7 dias em cada local, não só quem teve mais casos no passado.</div>';
        } else {
            fonteHtml = '<div class="previsao-nota">📊 Ranking por contagem histórica no período (' + escapeHtml(nomeCategoria) + ') — ' + escapeHtml(r.motivoSemML) + '.</div>';
        }

        const cidadeAtiva = opts.cidadeAtiva || null;
        const confiaveis = boletinsComCoordenadaConfiavel_(r.todos);
        const itens = r.ranking.map(function (g, i) {
            const pct = r.todos.length ? Math.round((g.total / r.todos.length) * 100) : 0;
            let risco, probTxt = '';
            if (g.probabilidadeML != null) {
                risco = g.probabilidadeML >= 0.5 ? 'alto' : g.probabilidadeML >= 0.25 ? 'medio' : 'baixo';
                probTxt = Math.round(g.probabilidadeML * 100) + '% de probabilidade (7 dias) · ';
            } else {
                risco = pct >= 20 ? 'alto' : pct >= 8 ? 'medio' : 'baixo';
            }
            const rlabel = { alto: 'Alto', medio: 'Médio', baixo: 'Baixo' }[risco];
            const gh = modaIndice(g.horas);
            const gd = modaIndice(g.dias);
            const detalhesDia = gd !== null ? '<strong>' + DIAS_SEMANA_FULL[gd] + 's</strong>' : 'sem dia predominante';
            const detalhesHora = gh !== null ? 'por volta de <strong>' + gh + 'h</strong>' : 'sem horário predominante';
            let bairroLabel = escapeHtml(g.bairro);
            if (normRisco(g.bairro).includes('RURAL')) {
                const coord = coordenadaMaisFrequente_(g.itens, confiaveis);
                if (coord) bairroLabel += ' <a class="coord-rural" href="https://www.google.com/maps?q=' + coord + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">(' + coord + ')</a>';
            }
            const chave = g.cidade + '||' + g.bairro;
            const linhaAtiva = cidadeAtiva === chave ? ' style="outline:2px solid var(--cad);outline-offset:-2px"' : '';
            const classeClicavel = opts.clicavel ? ' linha-clicavel' : '';
            const dataChave = opts.clicavel ? ' data-chave="' + escapeHtml(chave) + '"' : '';
            // Badge de clima (CPTEC) — só na tela ao vivo (opts.clicavel),
            // preenchido depois por anexarClimaAoRanking_ (assíncrono,
            // ver comentário grande acima). No relatório impresso não
            // existe esse atributo/span, de propósito.
            const dataCidadeClima = opts.clicavel ? ' data-cidade-clima="' + escapeHtml(g.cidade) + '"' : '';
            const climaSpan = opts.clicavel ? '<span class="previsao-clima" title="Carregando previsão do tempo (CPTEC)...">🌡️ …</span>' : '';
            return '<div class="previsao-item' + classeClicavel + '"' + dataChave + dataCidadeClima + linhaAtiva + '>' +
                '<div class="previsao-pos">' + (i + 1) + 'º</div>' +
                '<div class="previsao-detalhe">' +
                '<strong>' + escapeHtml(g.cidade) + ' / ' + bairroLabel + '</strong>' +
                '<span class="risco-badge risco-' + risco + '">' + rlabel + '</span>' +
                climaSpan +
                '<div class="previsao-sub">' + probTxt + g.total + ' ocorrência(s) (' + pct + '% do total classificado) · maior risco ' + detalhesDia + ', ' + detalhesHora + '</div>' +
                '</div></div>';
        }).join('');

        return resumo + fonteHtml + '<div class="previsao-ranking">' + itens + '</div>';
    }

    function renderPrevisaoOndeQuando(arrCVP, arrCVLI, arrMVI) {
        atualizarBotoesCategoriaRisco_();
        const box = document.getElementById('previsao-onde-quando');
        const cat = window._cadCategoriaRisco;
        const nomeCategoria = NOMES_CATEGORIA_RISCO[cat];
        const r = computarPrevisaoOndeQuando_(arrCVP, arrCVLI, arrMVI, cat);
        const notaFiltroCruzado = !!(window._cadCross.tip || window._cadCross.dia !== null || window._cadCross.hora !== null || window._cadCross.cidade);
        box.innerHTML = renderizarBlocoOndeQuando_(r, nomeCategoria, { cidadeAtiva: window._cadCross.cidade, clicavel: true, notaFiltroCruzado: notaFiltroCruzado });
        anexarClimaAoRanking_(box); // assíncrono, de propósito não bloqueia o render acima (ver comentário grande)
    }

    // ════════════════════════════════════════════════════════════════
    // JANELA MÓVEL TÁTICA (7-14 dias) — Matriz de Risco Tático
    // ════════════════════════════════════════════════════════════════
    // Diferente da "Previsão de Risco — Onde e Quando" acima (que olha o
    // PERÍODO INTEIRO selecionado, útil pra planejamento estratégico de
    // médio prazo), esta seção olha só os últimos 7 dias (ou 14, se o
    // volume de 7 dias for baixo demais pra apontar padrão) — pensada
    // pra alimentar a confecção de uma OPO de curtíssimo prazo, com o
    // emprego imediato de guarnições. Cruza Bairro/Zona × Dia da Semana ×
    // Faixa Horária e aponta os 3 locais mais críticos nesse recorte.
    //
    // Não usa o modelo de ML (MLLeve.preverRiscoPorLocal) aqui de
    // propósito: numa janela de só 7-14 dias, o próprio 10º BPM
    // dificilmente teria os 30 exemplos mínimos que o treino exige pra
    // calibrar com segurança (ver calibrarPesos/preverRiscoPorLocal em
    // js/machineLearningLeve.js) — forçar isso aqui inflaria confiança
    // que os dados não sustentam. É uma matriz estatística direta
    // (contagem cruzada), com o MESMO critério de risco (%) já usado no
    // resto da página, mantendo consistência visual e de raciocínio.
    const FAIXAS_HORARIAS_ = [
        { nome: 'Madrugada', ini: 0, fim: 5 },
        { nome: 'Manhã', ini: 6, fim: 11 },
        { nome: 'Tarde', ini: 12, fim: 17 },
        { nome: 'Noite', ini: 18, fim: 23 },
    ];
    function faixaHorariaDe_(hora) {
        if (hora == null) return null;
        for (let i = 0; i < FAIXAS_HORARIAS_.length; i++) {
            if (hora >= FAIXAS_HORARIAS_[i].ini && hora <= FAIXAS_HORARIAS_[i].fim) return i;
        }
        return null;
    }
    const NOMES_DIA_LONGO_ = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const LABEL_CATEGORIA_ = { cvp: 'CVP', cvli: 'CVLI', mvi: 'MVI' };

    // MINIMO_JANELA_7D: abaixo disso, os 7 dias mais recentes têm
    // ocorrências demais pra apontar qualquer padrão de dia/hora com
    // confiança — estende automaticamente pra 14 dias em vez de mostrar
    // uma matriz vazia/enganosa.
    const MINIMO_JANELA_7D = 5;

    // AMOSTRA_MINIMA_CONFIAVEL: usada tanto na Janela Tática quanto na
    // Acurácia Preditiva abaixo — abaixo disso, 1 ocorrência a mais ou a
    // menos muda o resultado (% ou padrão de dia/hora) de forma
    // desproporcional (ex.: 1 ocorrência só = ou 0% ou 100% de acerto,
    // nunca nada no meio). Mostra um aviso em vez de deixar o número/
    // padrão parecer mais confiável do que os dados sustentam.
    const AMOSTRA_MINIMA_CONFIAVEL = 5;

    function calcularJanelaMovelTatica_(arrCVP, arrCVLI, arrMVI) {
        // hojeMeiaNoite (não "new Date()" cru) — comparar direto contra o
        // instante ATUAL (com hora/minuto) contra "d" (que parseDataBR
        // sempre zera pra meia-noite) encolhia a janela sem avisar: às
        // 14h de hoje, uma ocorrência de exatamente 7 dias atrás já dava
        // diferença de 7,58 dias (> 7), sendo excluída da janela de "7
        // dias" mesmo sendo, no calendário, o 7º dia. Quanto mais tarde
        // no dia a página é carregada, mais a borda da janela (dia 7 ou
        // dia 14) fica cortada. Zerando os dois lados pra meia-noite, a
        // diferença vira sempre um número inteiro de dias-calendário.
        const hoje = new Date();
        const hojeMeiaNoite = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
        function dentroDeDias(it, dias) {
            const d = parseDataBR(it.DATA);
            if (!d) return false;
            const diffDias = Math.round((hojeMeiaNoite - d) / 86400000);
            return diffDias >= 0 && diffDias <= dias;
        }
        const categorias = [['cvp', arrCVP], ['cvli', arrCVLI], ['mvi', arrMVI]];
        function montarJanela(dias) {
            const itens = [];
            categorias.forEach(function (par) {
                const cat = par[0], arr = par[1];
                arr.forEach(function (it) { if (dentroDeDias(it, dias)) itens.push({ item: it, cat: cat }); });
            });
            return itens;
        }

        let dias = 7;
        let janela = montarJanela(7);
        let estendida = false;
        if (janela.length < MINIMO_JANELA_7D) {
            janela = montarJanela(14);
            dias = 14;
            estendida = true;
        }
        if (janela.length === 0) return { hotspots: [], dias: dias, estendida: estendida, totalJanela: 0 };

        const mapa = new Map();
        janela.forEach(function (par) {
            const it = par.item, cat = par.cat;
            const cidade = (it.CIDADE || 'N/D').trim() || 'N/D';
            const bairro = (it.BAIRRO || 'N/D').trim() || 'N/D';
            const chave = cidade + '||' + bairro;
            if (!mapa.has(chave)) mapa.set(chave, { cidade: cidade, bairro: bairro, total: 0, porCategoria: { cvp: 0, cvli: 0, mvi: 0 }, porDiaFaixa: new Map() });
            const g = mapa.get(chave);
            g.total++;
            g.porCategoria[cat]++;
            const d = parseDataBR(it.DATA);
            const h = parseHoraCAD(it);
            const faixa = faixaHorariaDe_(h);
            if (d && faixa != null) {
                const chaveDF = d.getDay() + '|' + faixa;
                if (!g.porDiaFaixa.has(chaveDF)) g.porDiaFaixa.set(chaveDF, { dia: d.getDay(), faixa: faixa, count: 0, horas: [] });
                const cel = g.porDiaFaixa.get(chaveDF);
                cel.count++;
                cel.horas.push(h);
            }
        });

        const totalJanela = janela.length;
        const hotspots = Array.from(mapa.values()).map(function (g) {
            // Pico = combinação dia+faixa horária com mais ocorrências
            // nesse local.
            let pico = null;
            g.porDiaFaixa.forEach(function (cel) { if (!pico || cel.count > pico.count) pico = cel; });

            // Outros dias que caem na MESMA faixa horária do pico, com
            // volume próximo (>=60% do pico) — permite mostrar "Sexta e
            // Sábado" quando o padrão realmente se repete em mais de um
            // dia dentro do mesmo horário crítico, em vez de sempre
            // reduzir a um único dia isolado.
            let diasDoPico = [];
            if (pico) {
                const limiar = Math.max(1, Math.ceil(pico.count * 0.6));
                const candidatos = [];
                g.porDiaFaixa.forEach(function (cel) {
                    if (cel.faixa === pico.faixa && cel.count >= limiar) candidatos.push(cel);
                });
                candidatos.sort(function (a, b) { return b.count - a.count; });
                diasDoPico = candidatos.slice(0, 3).map(function (c) { return c.dia; });
            }

            const categoriaDominante = Object.keys(g.porCategoria).reduce(function (a, b) {
                return g.porCategoria[a] >= g.porCategoria[b] ? a : b;
            });
            const pct = totalJanela ? Math.round((g.total / totalJanela) * 100) : 0;
            const risco = pct >= 20 ? 'alto' : pct >= 8 ? 'medio' : 'baixo';

            let horaMin = null, horaMax = null;
            if (pico) {
                pico.horas.forEach(function (h) {
                    if (horaMin === null || h < horaMin) horaMin = h;
                    if (horaMax === null || h > horaMax) horaMax = h;
                });
            }

            return {
                cidade: g.cidade, bairro: g.bairro, total: g.total, pct: pct, risco: risco,
                categoriaDominante: categoriaDominante, diasDoPico: diasDoPico,
                faixaPico: pico ? FAIXAS_HORARIAS_[pico.faixa].nome : null,
                horaMin: horaMin, horaMax: horaMax,
            };
        }).sort(function (a, b) { return b.total - a.total; }).slice(0, 3);

        return { hotspots: hotspots, dias: dias, estendida: estendida, totalJanela: totalJanela };
    }

    function renderJanelaMovelTatica(arrCVP, arrCVLI, arrMVI) {
        const box = document.getElementById('janela-movel-tatica');
        if (!box) return;
        const r = calcularJanelaMovelTatica_(arrCVP, arrCVLI, arrMVI);
        if (!r.hotspots.length) {
            box.innerHTML = '<div class="previsao-nota">Sem ocorrências suficientes nos últimos 7-14 dias pra montar a matriz tática.</div>';
            return;
        }
        const nota = '<div class="previsao-resumo-geral">🗓️ Janela de <strong>' + r.dias + ' dias</strong>' +
            (r.estendida ? ' (estendida de 7 pra 14 — volume baixo nos últimos 7 dias)' : '') +
            ' · ' + r.totalJanela + ' ocorrência(s) analisada(s) na matriz Bairro × Dia da Semana × Faixa Horária.' +
            // Mesmo já estendendo pra 14 dias, o volume pode continuar
            // baixo — com poucas ocorrências, o "padrão" de dia/hora pode
            // ser só coincidência de 1-2 casos isolados, não um padrão de
            // verdade. Avisa em vez de apresentar como certeza tática.
            (r.totalJanela < AMOSTRA_MINIMA_CONFIAVEL ? ' <strong style="color:var(--warn)">⚠️ Volume baixo — trate o padrão de dia/hora abaixo como indício, não certeza.</strong>' : '') +
            '</div>';
        const itens = r.hotspots.map(function (h, i) {
            const rIcone = { alto: '⚠️', medio: '🟡', baixo: '🟢' }[h.risco];
            const rlabel = { alto: 'Alto', medio: 'Médio', baixo: 'Baixo' }[h.risco];
            const diasTxt = h.diasDoPico.length ? h.diasDoPico.map(function (d) { return NOMES_DIA_LONGO_[d]; }).join(' e ') : 'sem dia predominante';
            const horaTxt = (h.horaMin != null) ? (h.horaMin === h.horaMax ? h.horaMin + 'h' : h.horaMin + 'h às ' + h.horaMax + 'h') : (h.faixaPico || 'sem horário predominante');
            return '<div class="previsao-item">' +
                '<div class="previsao-pos">' + (i + 1) + 'º</div>' +
                '<div class="previsao-detalhe">' +
                '<strong>📍 ' + escapeHtml(h.bairro) + ' (' + escapeHtml(h.cidade) + ')</strong>' +
                '<span class="risco-badge risco-' + h.risco + '">' + rlabel + '</span>' +
                '<div class="previsao-sub">' + rIcone + ' ' + rlabel + ' Risco de ' + LABEL_CATEGORIA_[h.categoriaDominante] +
                ' | ' + diasTxt + ' | ' + horaTxt + ' — ' + h.total + ' ocorrência(s) (' + h.pct + '% da janela)</div>' +
                '</div></div>';
        }).join('');
        box.innerHTML = nota + '<div class="previsao-ranking">' + itens + '</div>';
    }

    // ════════════════════════════════════════════════════════════════
    // ACURÁCIA PREDITIVA ESPACIAL (Hit Rate) — % das ocorrências reais do
    // MÊS ATUAL que caíram dentro de bairros já sinalizados como risco
    // Alto/Médio no BASELINE (os até JANELA_MESES_BASELINE_ACURACIA meses
    // ANTES do atual, acumulados).
    //
    // LOG DE PREVISÕES (Firebase) — antes desta versão, essa conta era
    // sempre um "back-test" RETROATIVO: recalculada do zero a cada
    // carregamento, usando dado que já estava disponível pros dois
    // lados (baseline e mês atual). Isso é honesto matematicamente, mas
    // não é a mesma coisa que "o sistema previu e depois conferiu" — é
    // uma simulação do que TERIA sido previsto, sempre com o algoritmo
    // ATUAL. Se o algoritmo mudar no futuro (ex.: eu ajustar o corte de
    // %), o "passado" recalculado muda junto — não fica um registro
    // fixo do que foi realmente mostrado ao comando num dado momento, e
    // não dá pra montar uma SÉRIE histórica de "hit rate mês a mês" sem
    // recalcular tudo de novo a cada vez.
    //
    // Pra resolver isso: sempre que a página carrega, se ainda não
    // existe uma previsão GRAVADA pro PRÓXIMO mês, calcula e grava uma
    // agora (salvarPrevisaoSeNecessario_) — congela zonasRisco/
    // previsaoMensal num nó do Firebase da unidade, com o mês-alvo como
    // chave. Nunca sobrescreve uma previsão já gravada (idempotente:
    // quem abrir a página primeiro num mês novo "trava" a previsão
    // daquele mês pra sempre). Quando o mês vira o "mês atual", a
    // Acurácia primeiro tenta buscar essa previsão CONGELADA
    // (buscarPrevisaoRegistrada_) — se achar, usa ela (fonte:
    // "registrada", um registro de verdade, auditável, que não muda
    // ainda que eu altere o algoritmo depois). Só cai de volta pro
    // recálculo retroativo (fonte: "retroativa") se não houver nenhuma
    // previsão gravada pra aquele mês (ex.: primeira vez usando esse
    // recurso, ou mês pulado).
    //
    // Baseline de VÁRIOS meses (em vez de só o mês imediatamente
    // anterior) — decisão tomada depois de ver, na prática, que com o
    // volume mensal baixo de CVP/CVLI/MVI de uma unidade (dezenas de
    // casos, não milhares), 1 mês isolado como referência oscila demais
    // (um mês parado zera as zonas de risco; um mês atípico infla uma
    // zona que não é recorrente de verdade). Acumular os últimos 3
    // meses acumula volume suficiente pra suavizar isso, sem deixar de
    // ser um baseline "do passado recente" (não usa o histórico INTEIRO,
    // que diluiria mudanças reais de padrão).
    // ════════════════════════════════════════════════════════════════
    const JANELA_MESES_BASELINE_ACURACIA = 3;
    const NO_PREVISOES_FIREBASE = 'preditiva_cad_previsoes';

    function chaveLocalNormalizada_(it) {
        return normRisco(it.CIDADE || 'N/D') + '||' + normRisco(it.BAIRRO || 'N/D');
    }

    // Agrupa uma lista de ocorrências por mês-calendário (chaveMes) —
    // usado tanto pra avaliar o passado (calcularAcuraciaPreditivaEspacial_)
    // quanto pra montar a previsão do próximo mês (computarPrevisaoProximoMes_).
    function agruparPorMes_(todos) {
        const porMes = new Map();
        todos.forEach(function (it) {
            const d = parseDataBR(it.DATA);
            if (!d) return;
            const k = chaveMes(d);
            if (!porMes.has(k)) porMes.set(k, []);
            porMes.get(k).push(it);
        });
        return porMes;
    }

    // Zonas de risco Alto/Médio numa lista de ocorrências — mesmo
    // critério de % já usado nos badges de risco do resto da página
    // (>=8% do total = médio ou mais). Devolve um Set de chaves
    // "CIDADE||BAIRRO" normalizadas.
    function identificarZonasRisco_(itens) {
        const contPorLocal = new Map();
        itens.forEach(function (it) {
            const chave = chaveLocalNormalizada_(it);
            contPorLocal.set(chave, (contPorLocal.get(chave) || 0) + 1);
        });
        const total = itens.length;
        const zonas = new Set();
        contPorLocal.forEach(function (cnt, chave) {
            if (total && (cnt / total) * 100 >= 8) zonas.add(chave);
        });
        return zonas;
    }

    function proximaChaveMes_(chave) {
        const p = chave.split('-');
        const d = new Date(+p[0], +p[1] - 1 + 1, 1); // +1 mês
        return chaveMes(d);
    }

    // computarPrevisaoProximoMes_/buscarPrevisaoRegistrada_/
    // salvarPrevisaoSeNecessario_ — MOVIDOS pra
    // js/core/previsaoMensalCad.js (02/09/2026), mesmo motivo da
    // classificação acima: precisam ser IDÊNTICOS ao que o lembrete
    // automático de fim de mês usa (js/core/notificacoes.js), senão as
    // duas fontes podem gravar previsões diferentes pro mesmo mês.
    // Ficam só wrappers finos aqui — mesmo nome/assinatura de sempre,
    // então nenhum outro lugar deste arquivo precisou mudar.
    function computarPrevisaoProximoMes_(arrCVP, arrCVLI, arrMVI) {
        const dataIni = document.getElementById('data-ini').value;
        const dataFim = document.getElementById('data-fim').value;
        return window.PrevisaoMensalCAD.computarPrevisaoProximoMes(arrCVP, arrCVLI, arrMVI, dataIni, dataFim);
    }

    // Cache em memória — evita reconsultar o Firebase a cada re-render
    // (cross-filter, troca de tema etc.) dentro da mesma sessão de
    // página. null = ainda não consultado; false = consultado, não achou.
    window._cadPrevisoesCache = window._cadPrevisoesCache || {};

    async function buscarPrevisaoRegistrada_(chaveMesAlvo) {
        if (chaveMesAlvo in window._cadPrevisoesCache) return window._cadPrevisoesCache[chaveMesAlvo];
        if (!window._cadFirebaseUrl) { window._cadPrevisoesCache[chaveMesAlvo] = false; return false; }
        const dados = await window.PrevisaoMensalCAD.buscarPrevisaoRegistrada(window._cadFirebaseUrl, chaveMesAlvo);
        window._cadPrevisoesCache[chaveMesAlvo] = dados || false;
        return window._cadPrevisoesCache[chaveMesAlvo];
    }

    // Calcula (se ainda não existir) e grava no Firebase a previsão pro
    // PRÓXIMO mês — idempotente: se já existe algo gravado nesse nó,
    // NUNCA sobrescreve (a previsão fica congelada no que foi calculado
    // da primeira vez que alguém abriu a página naquele mês, OU pelo
    // lembrete automático — ver js/core/notificacoes.js). Chamada uma
    // única vez por sessão (ver renderClassificacaoRisco), não a cada
    // re-render — evita ficar batendo no Firebase à toa.
    async function salvarPrevisaoSeNecessario_(arrCVP, arrCVLI, arrMVI) {
        if (!window._cadFirebaseUrl) return;
        try {
            const dataIni = document.getElementById('data-ini').value;
            const dataFim = document.getElementById('data-fim').value;
            const resultado = await window.PrevisaoMensalCAD.registrarPrevisaoProximoMesSeNecessario(window._cadFirebaseUrl, { dataIni: dataIni, dataFim: dataFim });
            if (resultado.status === 'gravada') {
                window._cadPrevisoesCache[resultado.mesAlvo] = resultado;
                console.log('[preditivaCAD] previsão gravada pra ' + resultado.mesAlvo + ':', resultado);
            } else if (resultado.status === 'ja_existia') {
                window._cadPrevisoesCache[resultado.mesAlvo] = resultado;
            }
        } catch (e) {
            console.warn('[preditivaCAD] falha ao gravar previsão:', e);
        }
    }

    async function calcularAcuraciaPreditivaEspacial_(arrCVP, arrCVLI, arrMVI) {
        const todos = arrCVP.concat(arrCVLI, arrMVI);
        const porMes = agruparPorMes_(todos);
        const chaves = Array.from(porMes.keys()).sort();
        if (!chaves.length) {
            return { calculavel: false, motivo: 'nenhuma ocorrência com data válida no período carregado' };
        }

        const chaveAtual = chaves[chaves.length - 1];
        const itensAtual = porMes.get(chaveAtual);
        if (!itensAtual.length) {
            return { calculavel: false, motivo: 'mês atual sem ocorrências no período carregado' };
        }

        // 1) Tenta usar uma previsão REGISTRADA (congelada) pra esse mês.
        const registrada = await buscarPrevisaoRegistrada_(chaveAtual);
        if (registrada && registrada.zonasRisco && registrada.zonasRisco.length) {
            const zonasRisco = new Set(registrada.zonasRisco);
            let acertos = 0;
            itensAtual.forEach(function (it) { if (zonasRisco.has(chaveLocalNormalizada_(it))) acertos++; });
            return {
                calculavel: true, fonte: 'registrada',
                hitRate: Math.round((acertos / itensAtual.length) * 1000) / 10,
                acertos: acertos, totalAtual: itensAtual.length, zonasRisco: zonasRisco.size,
                mesesBaseline: registrada.mesesBaseline || [], totalBaseline: registrada.totalBaseline || 0,
                mesAtual: chaveAtual, previsaoMensal: registrada.previsaoMensal || null,
                criadoEm: registrada.criadoEm || null,
            };
        }

        // 2) Sem previsão registrada — cai pro back-test retroativo de
        // sempre (recalcula o baseline com o algoritmo ATUAL).
        if (chaves.length < 2) {
            return { calculavel: false, motivo: 'histórico insuficiente (precisa de pelo menos 2 meses carregados — os anteriores pra identificar as zonas de risco, o atual pra conferir) e nenhuma previsão registrada foi encontrada pra esse mês' };
        }
        const mesesAnteriores = chaves.slice(0, chaves.length - 1);
        const mesesBaseline = mesesAnteriores.slice(-JANELA_MESES_BASELINE_ACURACIA);
        const itensBaseline = [];
        mesesBaseline.forEach(function (k) { itensBaseline.push.apply(itensBaseline, porMes.get(k)); });
        if (!itensBaseline.length) {
            return { calculavel: false, motivo: 'meses de referência sem ocorrências suficientes no período carregado' };
        }
        const zonasRisco = identificarZonasRisco_(itensBaseline);
        if (!zonasRisco.size) {
            return { calculavel: false, motivo: 'nenhuma zona de risco Alto/Médio identificada no período de referência (' + mesesBaseline.map(labelMesAbrev).join(', ') + ')' };
        }
        let acertos = 0;
        itensAtual.forEach(function (it) { if (zonasRisco.has(chaveLocalNormalizada_(it))) acertos++; });

        return {
            calculavel: true, fonte: 'retroativa',
            hitRate: Math.round((acertos / itensAtual.length) * 1000) / 10,
            acertos: acertos, totalAtual: itensAtual.length, zonasRisco: zonasRisco.size,
            mesesBaseline: mesesBaseline, totalBaseline: itensBaseline.length, mesAtual: chaveAtual,
        };
    }

    async function renderAcuraciaPreditiva(arrCVP, arrCVLI, arrMVI) {
        const box = document.getElementById('acuracia-preditiva-conteudo');
        if (!box) return;
        const r = await calcularAcuraciaPreditivaEspacial_(arrCVP, arrCVLI, arrMVI);
        if (!r.calculavel) {
            box.innerHTML = '<div class="previsao-nota">Indisponível — ' + escapeHtml(r.motivo) + '.</div>';
            return;
        }
        const cor = r.hitRate >= 70 ? 'var(--ok)' : r.hitRate >= 40 ? 'var(--warn)' : 'var(--alerta)';
        const hitRateTxt = r.hitRate.toFixed(1).replace('.', ',') + '%';
        const baselineTxt = r.mesesBaseline.map(labelMesAbrev).join(' + ');
        const fonteHtml = r.fonte === 'registrada'
            ? '<div class="previsao-nota">📌 <strong>Previsão registrada</strong> em ' + (r.criadoEm ? new Date(r.criadoEm).toLocaleDateString('pt-BR') : '—') +
              ' — congelada antes do mês começar, não recalculada agora (registro auditável).' +
              (r.previsaoMensal ? ' Estimativa feita na época: CVP ' + r.previsaoMensal.cvp + ' · CVLI ' + r.previsaoMensal.cvli + ' · MVI ' + r.previsaoMensal.mvi + '.' : '') + '</div>'
            : '<div class="previsao-nota">📊 <strong>Estimativa retroativa</strong> (recalculada agora) — nenhuma previsão foi registrada pra ' + labelMesAbrev(r.mesAtual) +
              ' antes do mês começar. A partir do próximo mês este card passa a comparar contra uma previsão de verdade, gravada com antecedência.</div>';
        const avisoAmostra = r.totalAtual < AMOSTRA_MINIMA_CONFIAVEL
            ? '<div class="previsao-nota" style="color:var(--warn);font-weight:bold;">⚠️ Amostra pequena (só ' + r.totalAtual + ' ocorrência(s) em ' + labelMesAbrev(r.mesAtual) +
              ' até agora) — com tão poucos casos, o percentual pode saltar de 0% pra 100% com só 1 ocorrência a mais ou a menos. Não trate como indicador confiável ainda; reavalie mais perto do fim do mês.</div>'
            : '';
        box.innerHTML =
            '<div class="acuracia-valor" style="color:' + cor + '">' + hitRateTxt + '</div>' +
            '<div class="acuracia-trilha"><div class="acuracia-barra" style="width:' + Math.min(100, r.hitRate) + '%;background:' + cor + '"></div></div>' +
            avisoAmostra +
            '<div class="previsao-nota">' + r.acertos + ' de ' + r.totalAtual + ' ocorrência(s) de <strong>' + labelMesAbrev(r.mesAtual) +
            '</strong> caíram dentro das ' + r.zonasRisco + ' zona(s) de risco Alto/Médio identificadas no período de referência <strong>' + escapeHtml(baselineTxt) +
            '</strong> (' + r.totalBaseline + ' ocorrência(s) acumuladas nesses meses).</div>' +
            fonteHtml;
    }

    function renderAlertasRisco(arrCVP, arrCVLI, arrMVI) {
        const alertas = [];
        if (arrMVI.length > 0) {
            alertas.push({ tipo: 'alto', icone: '🔴', t: arrMVI.length + ' caso(s) de MVI no período', s: 'Homicídio/Feminicídio/Latrocínio consumado' });
        } else {
            alertas.push({ tipo: 'ok', icone: '✅', t: 'Nenhum MVI no período', s: 'Sem homicídio/feminicídio/latrocínio consumado registrado' });
        }
        if (arrCVP.length > 0 && arrCVLI.length > arrCVP.length * 0.3) {
            alertas.push({ tipo: 'alto', icone: '🟡', t: 'CVLI elevado em relação ao CVP', s: arrCVLI.length + ' CVLI vs ' + arrCVP.length + ' CVP no período' });
        }
        document.getElementById('alertas-risco').innerHTML = alertas.map(function (a) {
            return '<div class="alerta ' + a.tipo + '"><div class="alerta-icone">' + a.icone +
                '</div><div class="alerta-txt"><strong>' + escapeHtml(a.t) + '</strong><small>' + escapeHtml(a.s) + '</small></div></div>';
        }).join('');
    }

    function renderHeatmapHorario(lista) {
        const cont = Array(24).fill(0);
        lista.forEach(function (it) {
            const h = parseHoraCAD(it);
            if (h !== null) cont[h]++;
        });
        const max = Math.max.apply(null, cont.concat([1]));
        const horaAtiva = window._cadCross.hora;
        document.getElementById('heatmap-horario').innerHTML = cont.map(function (v, i) {
            const ratio = v / max;
            const alpha = Math.min(1, ratio * 1.3);
            const estilos = [];
            if (v !== 0) { estilos.push('background:rgba(183,28,28,' + alpha + ')'); estilos.push('color:white'); }
            if (horaAtiva === i) estilos.push('outline:2px solid var(--cad)', 'outline-offset:-2px');
            return '<div class="hora-cel' + (v === 0 ? ' zero' : '') + '" data-hora="' + i + '" style="' + estilos.join(';') + '"' +
                ' title="' + i + 'h — ' + v + ' ocorrência(s) — clique pra filtrar os demais gráficos">' + i + 'h</div>';
        }).join('');
    }

    let chartDiaSemana = null;
    function renderGraficoDiaSemana(arrCVP, arrCVLI, arrMVI) {
        const dCVP = Array(7).fill(0), dCVLI = Array(7).fill(0), dMVI = Array(7).fill(0);
        arrCVP.forEach(function (it) { const d = parseDataBR(it.DATA); if (d) dCVP[d.getDay()]++; });
        arrCVLI.forEach(function (it) { const d = parseDataBR(it.DATA); if (d) dCVLI[d.getDay()]++; });
        arrMVI.forEach(function (it) { const d = parseDataBR(it.DATA); if (d) dMVI[d.getDay()]++; });
        const labels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
        const ctx = document.getElementById('chart-dia-semana').getContext('2d');
        if (chartDiaSemana) chartDiaSemana.destroy();
        const cores = coresTemaCAD_();
        chartDiaSemana = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    { label: 'CVP', data: dCVP, backgroundColor: COR_CVP },
                    { label: 'CVLI', data: dCVLI, backgroundColor: COR_CVLI },
                    { label: 'MVI', data: dMVI, backgroundColor: COR_MVI },
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: true, position: 'bottom', labels: { color: cores.mudo } } },
                scales: {
                    x: { ticks: { color: cores.mudo }, grid: { color: cores.grade } },
                    y: { beginAtZero: true, ticks: { precision: 0, color: cores.mudo }, grid: { color: cores.grade } },
                },
                // elements[0].index é o índice do DIA (0=Dom...6=Sáb), igual
                // pros 3 datasets (CVP/CVLI/MVI) — clicar em qualquer barra
                // daquele dia ativa o mesmo filtro cruzado.
                onClick: function (evt, elements) { if (elements.length) toggleCrossCAD('dia', elements[0].index); },
            }
        });
    }

    // Coordenada que mais se repete numa lista de ocorrências (arredondada
    // a 4 casas decimais — ~11m — pra agrupar pontos praticamente no mesmo
    // lugar sem exigir coordenada byte-a-byte idêntica). Usada tanto na
    // coluna "Coordenadas" da tabela de hotspots quanto no tratamento de
    // "ZONA RURAL" da Previsão de Risco (onde não há campo de logradouro
    // na grade do CAD — a coordenada mais frequente é o melhor substituto
    // disponível pra apontar "onde" dentro do bairro).
    // Roda MLLeve.filtrarCoordenadasValidas() sobre TODO o conjunto (todas
    // as categorias, todos os bairros já carregados) — devolve o conjunto
    // de BOLETIM que passaram na validação (dentro de Alagoas E sem
    // suspeita de "pino fixo" repetido entre bairros diferentes). Precisa
    // ser calculado sobre o conjunto INTEIRO, não por hotspot/grupo
    // isolado: o critério de suspeita exige a MESMA coordenada em pelo
    // menos 3 bairros DIFERENTES — chamado só com os ~15 itens de 1
    // hotspot (1 bairro só) nunca dispararia esse critério, mesmo que a
    // coordenada seja, de fato, o pino padrão repetido em outros bairros
    // do restante da base. Sem isso, os links de mapa (coluna
    // "Coordenadas" dos hotspots e o parênteses de "Zona Rural", ambos
    // via coordenadaMaisFrequente_) corriam o risco de apontar pra um
    // pino falso da geocodificação de origem, em vez de "sem dado" —
    // Zona Rural é justamente o caso mais propenso a isso.
    function boletinsComCoordenadaConfiavel_(todos) {
        if (!window.MLLeve) return null; // módulo não carregou — sem filtro extra (mesmo fallback já usado no KPI de coordenadas válidas)
        const validos = window.MLLeve.filtrarCoordenadasValidas(todos, function (it) {
            return {
                lat: parseFloat(String(it.LATITUDE || '').replace(',', '.').trim()),
                lng: parseFloat(String(it.LONGITUDE || '').replace(',', '.').trim()),
                bairro: (it.BAIRRO || '').toString().toUpperCase().trim(),
            };
        });
        const set = new Set();
        validos.forEach(function (it) { if (it.BOLETIM) set.add(it.BOLETIM); });
        return set;
    }

    // confiaveis (opcional): Set de BOLETIM retornado por
    // boletinsComCoordenadaConfiavel_ — quando informado, ignora
    // coordenadas de itens que o MLLeve descartou (fora de Alagoas ou
    // "pino fixo" suspeito) antes de escolher a mais frequente.
    function coordenadaMaisFrequente_(itens, confiaveis) {
        const cont = new Map();
        itens.forEach(function (it) {
            if (confiaveis && it.BOLETIM && !confiaveis.has(it.BOLETIM)) return;
            const lat = parseFloat(it.LATITUDE), lng = parseFloat(it.LONGITUDE);
            if (!lat || !lng) return;
            const chave = lat.toFixed(4) + ',' + lng.toFixed(4);
            cont.set(chave, (cont.get(chave) || 0) + 1);
        });
        let melhor = null, melhorCnt = 0;
        cont.forEach(function (cnt, chave) { if (cnt > melhorCnt) { melhorCnt = cnt; melhor = chave; } });
        return melhor;
    }

    // Cálculo puro (sem DOM) dos hotspots — extraído de renderHotspotRisco
    // pra ser reaproveitado também na coleta de dados do relatório
    // impresso (atualizarDadosRelatorioCAD_), garantindo que a tabela do
    // relatório mostre EXATAMENTE os mesmos hotspots/coordenadas/risco da
    // tela ao vivo (mesma fonte de verdade, sem recalcular duas vezes com
    // risco de divergir).
    function computarHotspots_(arrCVP, arrCVLI, arrMVI) {
        const mapa = new Map();
        function acumular(lista, campo) {
            lista.forEach(function (it) {
                const cidade = (it.CIDADE || 'N/D').trim();
                const bairro = (it.BAIRRO || 'N/D').trim();
                const chave = cidade + '||' + bairro;
                if (!mapa.has(chave)) mapa.set(chave, { cidade: cidade, bairro: bairro, cvp: 0, cvli: 0, mvi: 0, itens: [] });
                const g = mapa.get(chave);
                g[campo]++;
                g.itens.push(it);
            });
        }
        acumular(arrCVP, 'cvp');
        acumular(arrCVLI, 'cvli');
        acumular(arrMVI, 'mvi');

        const confiaveis = boletinsComCoordenadaConfiavel_(arrCVP.concat(arrCVLI, arrMVI));
        const totalGeral = arrCVP.length + arrCVLI.length + arrMVI.length;
        // População (IBGE) — lida de forma SÍNCRONA de window._cadPopulacoes,
        // preenchida à parte por carregarPopulacoesCidades_ (assíncrona, ver
        // comentário grande acima). Antes dela terminar, o objeto está vazio
        // e o comportamento é IDÊNTICO a antes (ordena só por contagem
        // bruta) — assim que a população chega, um re-render troca pra
        // ordenar por taxa/10k, sem travar a 1ª exibição esperando rede.
        const populacoes = window._cadPopulacoes || {};
        const temPopulacao = Object.keys(populacoes).length > 0;
        const linhas = Array.from(mapa.values()).map(function (r) {
            r.total = r.cvp + r.cvli + r.mvi;
            r.coord = coordenadaMaisFrequente_(r.itens, confiaveis);
            r.pct = totalGeral ? Math.round((r.total / totalGeral) * 100) : 0;
            r.risco = r.pct >= 20 ? 'alto' : r.pct >= 8 ? 'medio' : 'baixo';
            const pop = populacoes[normRisco(r.cidade)] || null;
            r.populacao = pop;
            r.taxa10k = pop ? (r.total / pop) * 10000 : null;
            delete r.itens; // não precisa seguir adiante — só servia pra achar a coordenada
            return r;
        }).sort(function (a, b) {
            // Sem população carregada ainda: contagem bruta, igual sempre foi.
            // Com população: taxa por habitante manda (uma cidade pequena com
            // taxa alta não pode ficar de fora do topo só por ter contagem
            // bruta menor que uma cidade grande) — quem não tem taxa (nome
            // não bateu no IBGE) cai pro fim, nunca antes de quem tem.
            if (temPopulacao) {
                if (a.taxa10k != null && b.taxa10k != null) return b.taxa10k - a.taxa10k;
                if (a.taxa10k != null) return -1;
                if (b.taxa10k != null) return 1;
            }
            return b.total - a.total;
        }).slice(0, 15);

        return { linhas: linhas, totalGeral: totalGeral, temPopulacao: temPopulacao };
    }

    function renderHotspotRisco(arrCVP, arrCVLI, arrMVI) {
        const resultado = computarHotspots_(arrCVP, arrCVLI, arrMVI);
        const linhas = resultado.linhas;
        const cidadeAtiva = window._cadCross.cidade;
        const tbody = document.getElementById('tbody-hotspot');
        tbody.innerHTML = linhas.map(function (r, i) {
            const rlabel = { alto: 'Alto', medio: 'Médio', baixo: 'Baixo' }[r.risco];
            const chave = r.cidade + '||' + r.bairro;
            const coordTd = r.coord
                ? '<a class="link-mapa-cad" href="https://www.google.com/maps?q=' + r.coord + '" target="_blank" rel="noopener">📍 ' + r.coord + '</a>'
                : '<span style="color:var(--sub)">—</span>';
            const linhaAtiva = cidadeAtiva === chave ? ' style="outline:2px solid var(--cad);outline-offset:-2px"' : '';
            // Taxa/10k habitantes (IBGE) — "—" quando a população ainda não
            // chegou ou o nome da cidade não bateu com a lista do IBGE
            // (não trava a linha, só fica sem essa métrica).
            const taxaTd = r.taxa10k != null
                ? '<td>' + r.taxa10k.toFixed(1) + '<span style="color:var(--sub);font-size:.68rem;"> /10k</span></td>'
                : '<td style="color:var(--sub)" title="População do município não encontrada no IBGE">—</td>';
            return '<tr class="linha-clicavel" data-chave="' + escapeHtml(chave) + '"' + linhaAtiva + '><td>' + (i + 1) + '</td><td>' + escapeHtml(r.cidade) + '</td><td><strong>' + escapeHtml(r.bairro) + '</strong></td>' +
                '<td>' + r.cvp + '</td><td>' + r.cvli + '</td><td>' + r.mvi + '</td><td><strong>' + r.total + '</strong></td>' + taxaTd +
                '<td><span class="risco-badge risco-' + r.risco + '">' + rlabel + '</span></td><td>' + coordTd + '</td></tr>';
        }).join('') || '<tr><td colspan="10" class="modal-vazio">Sem dados suficientes.</td></tr>';
    }

    // ════════════════════════════════════════════════════════════════
    // RELATÓRIO IMPRIMÍVEL — serializa um retrato COMPLETO de tudo que
    // está sendo mostrado na tela (mesmo padrão de
    // js/analisePreditiva.js:abrirRelatorioPreditivo → localStorage →
    // relatorios/relatorio_preditiva.html). Cada peça abaixo REAPROVEITA
    // as MESMAS funções de cálculo já usadas na tela ao vivo
    // (serieMensalCompleta, preverComEnsemble, calcularAcuraciaPreditivaEspacial_,
    // calcularJanelaMovelTatica_, computarHotspots_) em vez de duplicar a
    // lógica no script do relatório — garante que o PDF nunca diverge do
    // que o comandante já viu na tela. Usa a base SEM cross-filter
    // (mesmo motivo de renderAcuraciaPreditiva/renderJanelaMovelTatica:
    // o relatório é um retrato geral, não deve mudar por causa de um
    // filtro de clique esquecido ligado).
    async function atualizarDadosRelatorioCAD_(arrCVP, arrCVLI, arrMVI) {
        const dataIni = document.getElementById('data-ini').value;
        const dataFim = document.getElementById('data-fim').value;
        const sCVP = serieMensalCompleta(arrCVP, dataIni, dataFim);
        const sCVLI = serieMensalCompleta(arrCVLI, dataIni, dataFim);
        const sMVI = serieMensalCompleta(arrMVI, dataIni, dataFim);

        const acuracia = await calcularAcuraciaPreditivaEspacial_(arrCVP, arrCVLI, arrMVI);
        const janelaTatica = calcularJanelaMovelTatica_(arrCVP, arrCVLI, arrMVI);
        const hotspots = computarHotspots_(arrCVP, arrCVLI, arrMVI);

        // Previsão de risco — Onde e Quando, nos 4 blocos GERAL/CVP/CVLI/MVI
        // (mesmo pedido do usuário: separar por categoria, já que o
        // padrão de um roubo não é o mesmo de um homicídio). Reaproveita
        // EXATAMENTE as mesmas funções da tela ao vivo — já devolve HTML
        // pronto (renderizarBlocoOndeQuando_), não recalculado/reformatado
        // no script do relatório, pra nunca divergir do que a tela
        // mostraria se o usuário trocasse o filtro pra cada categoria.
        // clicavel:false — o relatório é estático, não tem filtro cruzado.
        const blocosOndeQuando = {};
        ['geral', 'cvp', 'cvli', 'mvi'].forEach(function (catRel) {
            const rCat = computarPrevisaoOndeQuando_(arrCVP, arrCVLI, arrMVI, catRel);
            blocosOndeQuando[catRel] = renderizarBlocoOndeQuando_(rCat, NOMES_CATEGORIA_RISCO[catRel], { clicavel: false });
        });

        function enxugar(arr) {
            return arr.map(function (i) {
                return {
                    DATA: i.DATA || '', HORA: i.HORA || '', BOLETIM: i.BOLETIM || '',
                    TIPIFICACAO_GERAL: i.TIPIFICACAO_GERAL || '', TIPIFICACAO: i.TIPIFICACAO || '',
                    CIDADE: i.CIDADE || '', BAIRRO: i.BAIRRO || '',
                };
            });
        }

        const grad = localStorage.getItem('userGraduacao') || '';
        const nome = localStorage.getItem('userNomeGuerra') || '';
        const elUnidade = document.getElementById('cabecalho-unidade');
        const elCoordValidas = document.getElementById('kpi-coord-validas');

        window._cadDadosRelatorio = {
            operador: (grad + ' ' + nome).trim(),
            unidade: elUnidade ? elUnidade.textContent : '',
            dataIni: dataIni, dataFim: dataFim,
            totalOcorrencias: (window._cadOcorrencias || []).length,
            totalEnvolvidos: (window._cadEnvolvidos || []).length,
            pctCoordValidas: elCoordValidas ? elCoordValidas.textContent : '—',
            arrCVP: enxugar(arrCVP), arrCVLI: enxugar(arrCVLI), arrMVI: enxugar(arrMVI),
            labelsMensais: sCVP.chaves.map(labelMesAbrev),
            cvpArr: sCVP.valores, cvliArr: sCVLI.valores, mviArr: sMVI.valores,
            previsaoProximoMes: {
                cvp: preverComEnsemble(sCVP.valores), cvli: preverComEnsemble(sCVLI.valores), mvi: preverComEnsemble(sMVI.valores),
            },
            previsaoMesAtualEstimado: {
                cvp: preverComEnsemble(sCVP.valores.slice(0, -1)), cvli: preverComEnsemble(sCVLI.valores.slice(0, -1)), mvi: preverComEnsemble(sMVI.valores.slice(0, -1)),
            },
            acuracia: acuracia,
            janelaTatica: janelaTatica,
            hotspots: hotspots,
            blocosOndeQuando: blocosOndeQuando,
        };
    }

    // Botão "🖨️ Imprimir Relatório" — mesmo mecanismo de
    // js/analisePreditiva.js:abrirRelatorioPreditivo (serializa em
    // localStorage, abre a página do relatório em nova aba). Exposta em
    // window pq é chamada via onclick inline no HTML.
    window.abrirRelatorioCAD = function () {
        if (!window._cadDadosRelatorio) {
            alert('Aguarde o carregamento completo dos dados do CAD antes de gerar o relatório.');
            return;
        }
        const json = JSON.stringify(window._cadDadosRelatorio);
        try {
            localStorage.removeItem('p3_preditiva_cad');
            localStorage.setItem('p3_preditiva_cad', json);
            window.open('../relatorios/relatorio_preditiva_cad.html', '_blank');
        } catch (e) {
            alert('Erro ao gerar relatório: dados muito grandes (' + Math.round(json.length / 1024) + ' KB). Tente um período menor.');
            console.error(e);
        }
    };

    function parseDataBR(str) {
        if (!str) return null;
        const s = String(str).trim();
        let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
        m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
        return null;
    }

    function contarTop(lista, campos, n) {
        const cont = new Map();
        lista.forEach(function (it) {
            let v = '';
            for (let i = 0; i < campos.length; i++) {
                const cand = (it[campos[i]] || '').toString().trim();
                if (cand && cand !== '---') { v = cand; break; }
            }
            if (!v) return;
            cont.set(v, (cont.get(v) || 0) + 1);
        });
        return Array.from(cont.entries()).sort(function (a, b) { return b[1] - a[1]; }).slice(0, n || 8);
    }

    // ────────────────────────────────────────────────────────────────
    // TABELAS
    // ────────────────────────────────────────────────────────────────
    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // ────────────────────────────────────────────────────────────────
    // MODAL DE OCORRÊNCIAS — aberto ao clicar num ponto dos gráficos
    // mensais de CVP/CVLI/MVI (mesmo padrão de page/analisePreditiva.js:
    // abrirModal/renderModalTabela).
    // ────────────────────────────────────────────────────────────────
    let _modalCadRegistros = [];
    function abrirModalCAD(titulo, subtitulo, registros) {
        _modalCadRegistros = registros || [];
        document.getElementById('modal-cad-titulo').textContent = titulo;
        document.getElementById('modal-cad-subtitulo').textContent = subtitulo;
        document.getElementById('modal-cad-busca').value = '';
        renderModalCadTabela(_modalCadRegistros);
        document.getElementById('modal-ocorrencias-cad').classList.add('aberto');
    }
    function renderModalCadTabela(lista) {
        const tbody = document.getElementById('modal-cad-tbody');
        const footer = document.getElementById('modal-cad-footer');
        if (!lista.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="modal-vazio">Nenhuma ocorrência encontrada.</td></tr>';
            footer.textContent = '';
            return;
        }
        tbody.innerHTML = lista.map(function (r) {
            return '<tr>' +
                celulaBoletimCAD_(r) +
                '<td>' + escapeHtml(r.DATA || '—') + ' ' + escapeHtml(r.HORA || '') + '</td>' +
                '<td>' + escapeHtml(r.TIPIFICACAO || r.TIPIFICACAO_GERAL || '—') + '</td>' +
                '<td>' + escapeHtml(r.CIDADE || '—') + ' / ' + escapeHtml(r.BAIRRO || '—') + '</td>' +
                '</tr>';
        }).join('');
        footer.textContent = lista.length + ' ocorrência(s) exibida(s)';
    }

    // Hash FIXO do botão "Completo" no CAD — não muda por linha, só por
    // qual botão é (Completo vs Resumido), ver _campoDetalheId_ no Apps
    // Script. Confirmado por captura real do DevTools em 11/08/2026.
    const HASH_DETALHE_COMPLETO_CAD_ = 'ce5703b0ecdf73f24c5fb6dd682b2714';

    // Abre o popup de "Boletim Completo" do CAD — mesmo destino que a
    // lupa "Completo" abre dentro do próprio CAD
    // (javascript:nm_gp_submit5(...)), reconstruído aqui porque essa
    // função só existe carregada dentro das páginas do CAD, não na
    // nossa. Monta e envia um form POST escondido direto pro domínio do
    // CAD com target="_blank" — é uma navegação de verdade do
    // navegador (não um fetch/XHR do nosso Apps Script), então usa o
    // cookie de sessão que o PRÓPRIO NAVEGADOR do usuário já tem pra
    // analisacad.seguranca.al.gov.br, sem esbarrar em CORS. PRECISA que
    // o usuário esteja logado no CAD nesse mesmo navegador — se não
    // estiver, o popup cai na tela de login do CAD normalmente (mesmo
    // comportamento de abrir a lupa "Completo" direto no CAD).
    window.abrirBoletimCompletoCAD_ = function (detalheId) {
        if (!detalheId) {
            alert('Não foi possível localizar o ID interno desse boletim (dado carregado antes dessa funcionalidade existir) — atualize os dados do CAD e tente de novo.');
            return;
        }
        const sc = window._cadScFresco;
        if (!sc || !sc.session || !sc.init) {
            alert('Sessão do CAD ainda não disponível — atualize os dados do CAD (botão "Atualizar do CAD") e tente de novo.');
            return;
        }
        const campos = {
            nmgp_chave: '',
            nmgp_opcao: 'grid',
            nmgp_ordem: '',
            SC_lig_apl_orig: 'cad_grid_tb_ocor_consulta_com_cadastro',
            nmgp_parm_acum: '',
            nmgp_quant_linhas: '',
            nmgp_url_saida: '/app/cad/cad_grid_tb_ocor_consulta_com_cadastro/',
            nmgp_parms: '@SC_par@' + detalheId + '@SC_par@cad_grid_tb_ocor_consulta_com_cadastro@SC_par@' + HASH_DETALHE_COMPLETO_CAD_,
            nmgp_tipo_pdf: '',
            nmgp_outra_jan: 'true',
            nmgp_orig_pesq: '',
            script_case_init: sc.init,
            script_case_session: sc.session,
        };
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = 'https://analisacad.seguranca.al.gov.br/app/cad/cad_grid_tb_ocor_detalhes/';
        form.target = '_blank';
        form.style.display = 'none';
        Object.keys(campos).forEach(function (nome) {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = nome;
            input.value = campos[nome];
            form.appendChild(input);
        });
        document.body.appendChild(form);
        form.submit();
        form.remove();
    };

    // Célula <td> do boletim, reaproveitada nas 3 tabelas que mostram
    // ocorrências (Ocorrências, modal do gráfico mensal, busca direta)
    // — vira link clicável quando temos o DETALHE_ID da linha; sem ele
    // (ex.: dado antigo em cache), mostra só o texto, sem quebrar nada.
    function celulaBoletimCAD_(it) {
        const texto = escapeHtml(it.BOLETIM || '—');
        if (!it.DETALHE_ID) return '<td class="modal-boletim">' + texto + '</td>';
        return '<td><a href="javascript:void(0)" class="modal-boletim" title="Abrir Boletim Completo no CAD" onclick="abrirBoletimCompletoCAD_(\'' + escapeHtml(it.DETALHE_ID) + '\')">' + texto + ' 🔗</a></td>';
    }

    function renderTabelaOcorrencias() {
        const termo = (document.getElementById('busca-ocorrencias').value || '').toUpperCase().trim();
        const tbody = document.getElementById('tbody-ocorrencias');
        const lista = window._cadOcorrencias.filter(function (it) {
            return !termo || JSON.stringify(it).toUpperCase().includes(termo);
        });
        tbody.innerHTML = lista.slice(0, 300).map(function (it) {
            return '<tr>' +
                celulaBoletimCAD_(it) +
                '<td>' + escapeHtml(it.DATA || '—') + ' ' + escapeHtml(it.HORA || '') + '</td>' +
                '<td>' + escapeHtml(it.TIPIFICACAO_GERAL || it.TIPIFICACAO || '—') + '</td>' +
                '<td>' + escapeHtml(it.CIDADE || '—') + ' / ' + escapeHtml(it.BAIRRO || '—') + '</td>' +
                '<td>' + escapeHtml(it['SOLUÇÃO'] || it.SOLUCAO || '—') + '</td>' +
                '<td>' + escapeHtml(it.ATENDENTE || '—') + '</td>' +
                '</tr>';
        }).join('') || '<tr><td colspan="6" class="modal-vazio">Nenhuma ocorrência encontrada.</td></tr>';
        document.getElementById('contagem-ocorrencias').textContent = lista.length + ' de ' + window._cadOcorrencias.length;
    }

    function renderTabelaEnvolvidos() {
        const termo = (document.getElementById('busca-envolvidos').value || '').toUpperCase().trim();
        const tbody = document.getElementById('tbody-envolvidos');
        const lista = window._cadEnvolvidos.filter(function (it) {
            return !termo || JSON.stringify(it).toUpperCase().includes(termo);
        });
        tbody.innerHTML = lista.slice(0, 300).map(function (it) {
            return '<tr>' +
                '<td class="modal-boletim">' + escapeHtml(it.BOLETIM || '—') + '</td>' +
                '<td>' + escapeHtml(it.NOME || '—') + '</td>' +
                '<td>' + escapeHtml(it.CPF || '—') + '</td>' +
                '<td>' + escapeHtml(it.SITUACAO || '—') + '</td>' +
                '<td>' + escapeHtml(it.NATUREZA || it.TIPIFICACAO || '—') + '</td>' +
                '<td>' + escapeHtml(it.CIDADE || '—') + ' / ' + escapeHtml(it.BAIRRO || '—') + '</td>' +
                '<td>' + escapeHtml(it.ENVOLVIMENTO || '—') + '</td>' +
                '</tr>';
        }).join('') || '<tr><td colspan="7" class="modal-vazio">Nenhum envolvido encontrado.</td></tr>';
        document.getElementById('contagem-envolvidos').textContent = lista.length + ' de ' + window._cadEnvolvidos.length;
    }

    // ────────────────────────────────────────────────────────────────
    // BUSCA DIRETA NO CAD — por número de ocorrência (boletim) OU por
    // uma data específica, SEM precisar carregar/paginar o período
    // inteiro selecionado acima. Diferente da busca local
    // (busca-ocorrencias, que só filtra o que já está em memória), essa
    // dispara uma requisição NOVA direto ao CAD (?acao=buscar_ocorrencia)
    // — acha um boletim mesmo que esteja fora do período carregado.
    // ────────────────────────────────────────────────────────────────
    async function buscarDiretoNoCAD_() {
        const boletim = document.getElementById('busca-direta-boletim').value.trim();
        const data = document.getElementById('busca-direta-data').value;
        const statusEl = document.getElementById('busca-direta-status');
        const wrap = document.getElementById('busca-direta-resultado-wrap');
        const btn = document.getElementById('btn-busca-direta');

        if (!boletim && !data) {
            statusEl.textContent = '⚠️ Informe um número de ocorrência ou uma data.';
            return;
        }
        // Prioriza boletim se os dois estiverem preenchidos — é o
        // critério mais específico dos dois.
        const params = boletim ? { boletim: boletim } : { data: data };

        btn.disabled = true;
        const textoOriginal = btn.textContent;
        btn.textContent = '⏳ Buscando...';
        statusEl.textContent = '⏳ Buscando direto no CAD...';
        wrap.style.display = 'none';

        try {
            const resp = await fetchCAD('buscar_ocorrencia', params);
            if (resp.ok === false) throw new Error(resp.erro || 'Falha na busca.');
            if (resp.scFresco) window._cadScFresco = resp.scFresco;
            const dados = resp.dados || [];
            if (!dados.length) {
                statusEl.textContent = '❌ Nenhuma ocorrência encontrada' + (boletim ? ' com o nº ' + escapeHtml(boletim) : ' em ' + escapeHtml(data)) + '.';
                return;
            }
            document.getElementById('tbody-busca-direta').innerHTML = dados.map(function (it) {
                return '<tr>' +
                    celulaBoletimCAD_(it) +
                    '<td>' + escapeHtml(it.DATA || '—') + ' ' + escapeHtml(it.HORA || '') + '</td>' +
                    '<td>' + escapeHtml(it.TIPIFICACAO_GERAL || it.TIPIFICACAO || '—') + '</td>' +
                    '<td>' + escapeHtml(it.CIDADE || '—') + ' / ' + escapeHtml(it.BAIRRO || '—') + '</td>' +
                    '<td>' + escapeHtml(it['SOLUÇÃO'] || it.SOLUCAO || '—') + '</td>' +
                    '<td>' + escapeHtml(it.ATENDENTE || '—') + '</td>' +
                    '</tr>';
            }).join('');
            wrap.style.display = 'block';
            statusEl.textContent = '✅ ' + dados.length + ' ocorrência(s) encontrada(s)' +
                (resp.truncado ? ' — o CAD relata ' + (resp.totalRelatadoPeloCAD || '?') + ' no total pra essa data; só a 1ª página (até 50) é mostrada aqui, refine a busca se precisar do resto' : '') + '.';
        } catch (e) {
            console.error('[preditivaCAD] busca direta:', e);
            statusEl.textContent = '❌ ' + e.message;
        } finally {
            btn.disabled = false;
            btn.textContent = textoOriginal;
        }
    }

    function mostrarAlerta(titulo, detalhe) {
        // Acrescenta em vez de substituir: a busca rápida classificada e a
        // busca geral podem truncar de forma independente na mesma carga
        // (ex.: só o CVLI/MVI bate o limite), e um erro final não deve
        // apagar o aviso de truncamento que já apareceu antes dele.
        const bar = document.getElementById('alertas-cad');
        bar.innerHTML += '<div class="alerta alto"><div class="alerta-icone">⚠️</div><div class="alerta-txt"><strong>' +
            escapeHtml(titulo) + '</strong><small>' + escapeHtml(detalhe) + '</small></div></div>';
    }
    function limparAlerta() {
        document.getElementById('alertas-cad').innerHTML = '';
    }

    // ────────────────────────────────────────────────────────────────
    // DIAGNÓSTICO — chama as rotas de diagnóstico do Apps Script (que
    // devolvem a resposta BRUTA dos dois endpoints do CAD, sem normalizar
    // nada). Use isso se as tabelas/gráficos aparecerem vazios mesmo com
    // "ok: true" — indica que o mapeamento de colunas no Apps Script
    // precisa de ajuste pro formato real retornado pelo CAD.
    // ────────────────────────────────────────────────────────────────
    async function rodarDiagnostico() {
        const out = document.getElementById('diagnostico-saida');
        const painel = document.getElementById('painel-diagnostico');
        painel.style.display = 'block';
        out.textContent = '⏳ Consultando endpoint bruto do CAD...';
        try {
            const dataIni = document.getElementById('data-ini').value;
            const dataFim = document.getElementById('data-fim').value;
            const oc = await fetchCAD('diagnostico_ocorrencias', { dataIni: dataIni, dataFim: dataFim });
            out.textContent = 'OCORRÊNCIAS (diagnóstico):\n' + JSON.stringify(oc, null, 2) +
                '\n\n(Envolvidos ainda não implementado no Apps Script — só ocorrências por enquanto.)';
        } catch (err) {
            out.textContent = '❌ ' + err.message;
        }
    }

})();
