// ====================================================================
// Sistema P3 — RELOP de Cumprimento de Mandado (04/09/2026)
// ====================================================================
// Pedido explícito do usuário: gerar o "Relatório de Operações" (RELOP)
// que a P2/10º BPM já usa hoje pra cumprimento de mandado, no MESMO
// modelo (cabeçalho oficial, ACESSO RESTRITO, campos DATA/ASSUNTO/
// REFERENTE AOS AUTOS Nº/..., seção "ALVOS E RESULTADOS DAS
// DILIGÊNCIAS" por alvo, "ANEXO A" com as fotos do mandado/auto de
// busca e apreensão anexadas no CAD) — só pra usuários P2/ADMIN.
//
// Botão em page/mandado.html abre um modal com 2 opções:
//   1) RELOP individual — 1 boletim + a data dele.
//   2) RELOP por período — intervalo de datas, pega TODAS as
//      ocorrências de cumprimento de mandado do período.
// As imagens vêm do CAD ao vivo via tools/atualizador-local/
// cad_grades.py:gerar_relop_mandados_stream (precisa do atualizador
// local aberto e logado no CAD — mesmo requisito de toda busca CAD já
// existente no sistema).
//
// O documento gerado é uma PROPOSTA/rascunho: nome do alvo, "mandado
// cumprido" e "material apreendido" são preenchidos manualmente por
// quem está montando o RELOP (não são extraídos automaticamente do
// texto do despachante) — é um documento oficial assinado, não faz
// sentido inventar esse conteúdo a partir de heurística de texto.
(function () {
    'use strict';

    let ULTIMO_MODO = 'individual';
    let ALVOS_CARREGADOS = [];

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function hojeISO() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function formatarDataBrExtenso(dataBr) {
        // "15/07/2026" -> "15 de julho de 2026"
        const m = String(dataBr || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/);
        if (!m) return dataBr || '';
        const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
        return `${parseInt(m[1], 10)} de ${meses[parseInt(m[2], 10) - 1]} de ${m[3]}`;
    }

    // ── Estilos (injetados 1x, mesmo padrão de js/cerbero.js) ──────────
    function garantirEstilos() {
        if (document.getElementById('relop-estilos')) return;
        const style = document.createElement('style');
        style.id = 'relop-estilos';
        style.textContent = `
            #relop-modal { display:none; position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:9300; align-items:center; justify-content:center; padding:16px; }
            #relop-modal.aberto { display:flex; }
            .relop-box { background:var(--p3-surface,#fff); border-radius:12px; width:100%; max-width:960px; height:100%; max-height:92vh; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 16px 48px rgba(0,0,0,.4); }
            .relop-head { background:#003366; color:#fff; padding:14px 18px; display:flex; justify-content:space-between; align-items:center; flex:0 0 auto; }
            .relop-head span { font-weight:700; font-size:1rem; }
            .relop-head button { background:none; border:none; color:rgba(255,255,255,.75); font-size:1.3rem; cursor:pointer; line-height:1; }
            .relop-corpo { padding:20px; overflow-y:auto; flex:1 1 auto; color:var(--p3-text); }

            .relop-opcoes { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
            @media (max-width:640px) { .relop-opcoes { grid-template-columns:1fr; } }
            .relop-opcao { border:1px solid var(--p3-border); border-radius:10px; padding:16px; }
            .relop-opcao.ativa { border-color:var(--p3-blue-700,#003366); box-shadow:0 0 0 2px var(--p3-blue-700,#003366) inset; }
            .relop-opcao h4 { margin:0 0 10px; font-size:.95rem; }
            .relop-opcao label { display:block; font-size:.75rem; color:var(--p3-text-muted); margin:8px 0 3px; }
            .relop-opcao input { width:100%; padding:7px 9px; border-radius:6px; border:1px solid var(--p3-border); background:var(--p3-bg); color:var(--p3-text); font-size:13px; box-sizing:border-box; }
            .relop-radio-modo { display:flex; align-items:center; gap:6px; margin-bottom:4px; cursor:pointer; }

            .relop-btn { display:inline-flex; align-items:center; gap:6px; background:var(--p3-blue-700,#003366); color:#fff; border:none; border-radius:8px; padding:9px 16px; font-size:13px; font-weight:700; cursor:pointer; }
            .relop-btn:hover { opacity:.92; }
            .relop-btn:disabled { opacity:.5; cursor:not-allowed; }
            .relop-btn-secundario { background:var(--p3-bg); color:var(--p3-text); border:1px solid var(--p3-border); }

            .relop-progresso { text-align:center; padding:40px 20px; color:var(--p3-text-muted); font-size:13.5px; }
            .relop-erro { background:#fdeaea; color:#8a1f1f; border:1px solid #e39a9a; border-radius:8px; padding:12px 14px; font-size:13px; margin-top:14px; }

            .relop-campo { margin-bottom:10px; }
            .relop-campo label { display:block; font-size:.72rem; font-weight:700; text-transform:uppercase; letter-spacing:.03em; color:var(--p3-text-muted); margin-bottom:4px; }
            .relop-campo input, .relop-campo textarea, .relop-campo select { width:100%; padding:8px 10px; border-radius:6px; border:1px solid var(--p3-border); background:var(--p3-surface); color:var(--p3-text); font-size:13px; box-sizing:border-box; font-family:inherit; }
            .relop-campo textarea { resize:vertical; }
            .relop-grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
            @media (max-width:640px) { .relop-grid-2 { grid-template-columns:1fr; } }

            .relop-secao-titulo { font-size:.85rem; font-weight:700; text-transform:uppercase; letter-spacing:.03em; color:var(--p3-text); border-bottom:2px solid var(--p3-border); padding-bottom:6px; margin:22px 0 12px; }
            .relop-alvo-card { border:1px solid var(--p3-border); border-radius:10px; padding:14px; margin-bottom:14px; background:var(--p3-bg); }
            .relop-alvo-card-cabecalho { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; font-size:12px; color:var(--p3-text-muted); }
            .relop-galeria { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
            .relop-galeria label { display:flex; flex-direction:column; align-items:center; gap:4px; font-size:10px; cursor:pointer; }
            .relop-galeria img { width:84px; height:84px; object-fit:cover; border-radius:6px; border:2px solid var(--p3-border); }
            .relop-galeria input:checked + img { border-color:var(--p3-blue-700,#003366); }
            .relop-galeria-vazia { font-size:12px; color:var(--p3-text-muted); font-style:italic; }

            .relop-rodape { display:flex; justify-content:flex-end; gap:8px; padding:14px 18px; border-top:1px solid var(--p3-border); flex:0 0 auto; }
        `;
        document.head.appendChild(style);
    }

    function garantirModal() {
        garantirEstilos();
        if (document.getElementById('relop-modal')) return;
        const div = document.createElement('div');
        div.id = 'relop-modal';
        div.innerHTML = `
            <div class="relop-box">
                <div class="relop-head"><span>📄 Gerar RELOP — Cumprimento de Mandado</span><button type="button" id="relop-fechar" title="Fechar">✕</button></div>
                <div class="relop-corpo" id="relop-corpo"></div>
                <div class="relop-rodape" id="relop-rodape"></div>
            </div>`;
        document.body.appendChild(div);
        document.getElementById('relop-fechar').addEventListener('click', fechar);
        div.addEventListener('click', e => { if (e.target === div) fechar(); });
    }

    function abrir() {
        garantirModal();
        document.getElementById('relop-modal').classList.add('aberto');
        renderEscolha();
    }

    function fechar() {
        const el = document.getElementById('relop-modal');
        if (el) el.classList.remove('aberto');
    }

    // ── Etapa 1 — escolher modo (individual/período) ───────────────────
    function renderEscolha(erro) {
        const corpo = document.getElementById('relop-corpo');
        corpo.innerHTML = `
            <div class="relop-opcoes">
                <div class="relop-opcao${ULTIMO_MODO === 'individual' ? ' ativa' : ''}" id="relop-card-individual">
                    <label class="relop-radio-modo"><input type="radio" name="relop-modo" value="individual" ${ULTIMO_MODO === 'individual' ? 'checked' : ''}> <h4 style="display:inline;margin:0;">RELOP Individual</h4></label>
                    <p style="font-size:12px;color:var(--p3-text-muted);margin:4px 0 0;">1 COP específico — a data é localizada sozinha a partir do cadastro de Cumprimento de Mandados já feito nesta tela.</p>
                    <label>Nº do COP/boletim</label>
                    <input type="text" id="relop-in-boletim" inputmode="numeric" placeholder="ex.: 1551648">
                </div>
                <div class="relop-opcao${ULTIMO_MODO === 'periodo' ? ' ativa' : ''}" id="relop-card-periodo">
                    <label class="relop-radio-modo"><input type="radio" name="relop-modo" value="periodo" ${ULTIMO_MODO === 'periodo' ? 'checked' : ''}> <h4 style="display:inline;margin:0;">RELOP por Período</h4></label>
                    <p style="font-size:12px;color:var(--p3-text-muted);margin:4px 0 0;">Todas as ocorrências de cumprimento de mandado do intervalo.</p>
                    <label>De</label>
                    <input type="date" id="relop-in-data-ini">
                    <label>Até</label>
                    <input type="date" id="relop-in-data-fim">
                </div>
            </div>
            ${erro ? `<div class="relop-erro">⚠️ ${esc(erro)}</div>` : ''}
        `;
        document.getElementById('relop-rodape').innerHTML = `
            <button type="button" class="relop-btn relop-btn-secundario" id="relop-btn-cancelar">Cancelar</button>
            <button type="button" class="relop-btn" id="relop-btn-buscar">🔎 Buscar no CAD</button>
        `;
        corpo.querySelectorAll('input[name="relop-modo"]').forEach(r => r.addEventListener('change', () => {
            ULTIMO_MODO = r.value;
            document.getElementById('relop-card-individual').classList.toggle('ativa', ULTIMO_MODO === 'individual');
            document.getElementById('relop-card-periodo').classList.toggle('ativa', ULTIMO_MODO === 'periodo');
        }));
        document.getElementById('relop-btn-cancelar').addEventListener('click', fechar);
        document.getElementById('relop-btn-buscar').addEventListener('click', executarBusca);
    }

    // "AAAA-MM-DD" <- "DD/MM/AAAA" (formato salvo no Firebase, ver
    // js/cadastroocorrencias.js) — a rota /cad/relop-mandado exige ISO.
    function dataBrParaIso(dataBr) {
        const m = String(dataBr || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/);
        return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
    }

    // Localiza sozinho a data do boletim no nó /mandados (o mesmo que
    // alimenta a tabela desta própria tela) — o usuário só digita o
    // número do COP, pedido explícito (04/09/2026): "não quero colocar
    // data, mas sim somente o número do COP". Sem isso, precisaríamos
    // perguntar a data porque a busca do CAD é sempre por período.
    async function resolverDataDoBoletim(boletim) {
        const cfg = await P3.loadUnidadeConfig();
        const resp = await fetch(`${cfg.firebase.databaseURL}/mandados.json`);
        const dados = resp.ok ? await resp.json() : null;
        if (!dados) return null;
        const registro = Object.values(dados).find(r => String(r.BOLETIM || r.NUMEROOCORRENCIA || '') === String(boletim));
        return registro ? dataBrParaIso(registro.DATA || registro.data) : null;
    }

    async function executarBusca() {
        if (typeof P3AtualizadorLocal === 'undefined' || !(await P3AtualizadorLocal.disponivel())) {
            renderEscolha('O atualizador local (CAD/Quimera) precisa estar aberto e logado no CAD pra buscar as ocorrências e imagens.');
            return;
        }

        let params;
        if (ULTIMO_MODO === 'individual') {
            const boletim = document.getElementById('relop-in-boletim').value.trim();
            if (!boletim) { renderEscolha('Informe o número do COP/boletim.'); return; }

            const corpoEspera = document.getElementById('relop-corpo');
            corpoEspera.innerHTML = '<div class="relop-progresso">⏳ Localizando a data desse boletim no cadastro...</div>';
            document.getElementById('relop-rodape').innerHTML = '';
            let data;
            try {
                data = await resolverDataDoBoletim(boletim);
            } catch (e) {
                console.error('[relop-mandados] erro ao localizar data do boletim:', e);
                renderEscolha('Não consegui consultar o cadastro pra achar a data desse boletim — tente de novo.');
                return;
            }
            if (!data) {
                renderEscolha(`Boletim ${boletim} não encontrado no cadastro de Cumprimento de Mandados desta tela — confira o número (ou importe essa ocorrência antes, na Sincronização Direta do CAD).`);
                return;
            }
            params = { boletim, data };
        } else {
            const dataIni = document.getElementById('relop-in-data-ini').value;
            const dataFim = document.getElementById('relop-in-data-fim').value;
            if (!dataIni || !dataFim) { renderEscolha('Informe o período (de/até).'); return; }
            params = { dataIni, dataFim };
        }

        const corpo = document.getElementById('relop-corpo');
        corpo.innerHTML = '<div class="relop-progresso" id="relop-progresso-txt">⏳ Iniciando busca no CAD...</div>';
        document.getElementById('relop-rodape').innerHTML = '';

        try {
            const alvos = await P3AtualizadorLocal.gerarRelopMandado(ULTIMO_MODO, params, function (evento) {
                const el = document.getElementById('relop-progresso-txt');
                if (el && evento.mensagem) el.textContent = '⏳ ' + evento.mensagem;
            });
            ALVOS_CARREGADOS = alvos;
            renderRevisao(params);
        } catch (e) {
            console.error('[relop-mandados] erro ao buscar no CAD:', e);
            renderEscolha(e.message);
        }
    }

    // ── Etapa 2 — revisão/edição antes de gerar o documento ────────────
    // Referência do processo: prioriza o Nº do processo extraído do
    // "Relato do Despachante" no CAD (pedido explícito do usuário,
    // 12/09/2026: "no lugar de informar o nº do boletim... deve informar
    // o número do processo, tanto no texto quanto nos dados") — só cai
    // pro boletim quando o CAD não trouxe o número do processo.
    function referenciasProcesso(alvos) {
        return alvos.map(a => a.NUMERO_PROCESSO || `boletim ${a.BOLETIM}`);
    }

    function montarNarrativaPadrao(params, alvos) {
        const cidades = [...new Set(alvos.map(a => a.CIDADE).filter(Boolean))].join(', ');
        const refs = referenciasProcesso(alvos).join(', ');
        const dataRef = ULTIMO_MODO === 'individual' ? formatarDataBrExtenso(alvos[0] && alvos[0].DATA) : null;
        const periodoTxt = dataRef
            ? `No dia ${dataRef}, foi cumprido mandado de busca e apreensão referente ao processo nº ${refs}`
            : `No período informado, foram cumpridos mandados de busca e apreensão referentes aos processos nº ${refs}`;
        return `${periodoTxt}, expedido(s) pela Vara Criminal da Comarca de [COMARCA], no âmbito de investigação que apura [NATUREZA DA INVESTIGAÇÃO], tendo como alvos indivíduos situados n${cidades ? 'o município de ' + cidades : 'este município'}/AL.\n\n` +
            `As diligências foram executadas com base em levantamentos da Agência de Inteligência do 10º BPM (PM-2), com emprego de equipes operacionais, visando à localização de materiais ilícitos, armas de fogo, drogas e dispositivos eletrônicos.`;
    }

    // Endereço: prioriza o endereço rico extraído da página de detalhes
    // do CAD (logradouro+nº+bairro+cidade/UF reais) — pedido explícito
    // do usuário (12/09/2026): "os dados do endereço devem estar
    // preenchidos com os dados da imagem 3". Só cai pro endereço da
    // grade (mais pobre) quando o detalhe não veio.
    function montarEnderecoAlvo(a) {
        if (a.ENDERECO_DETALHE) return a.ENDERECO_DETALHE;
        return [a.LOGRADOURO, a.BAIRRO, a.CIDADE ? a.CIDADE + '/AL' : ''].filter(Boolean).join(', ');
    }

    function renderRevisao(params) {
        const alvos = ALVOS_CARREGADOS;
        const corpo = document.getElementById('relop-corpo');
        const hoje = hojeISO();
        // Autos nº: pré-preenche com o 1º processo achado no CAD (pedido
        // explícito do usuário, item 1) — continua editável pra quando
        // houver mais de um processo distinto ou o CAD não achar nenhum.
        const autosPreenchido = (alvos.find(a => a.NUMERO_PROCESSO) || {}).NUMERO_PROCESSO || '';
        corpo.innerHTML = `
            <div class="relop-secao-titulo">Dados do RELOP</div>
            <div class="relop-grid-2">
                <div class="relop-campo"><label>Nº RELOP</label><input type="text" id="relop-campo-numero" placeholder="ex.: 0011"></div>
                <div class="relop-campo"><label>Data</label><input type="date" id="relop-campo-data" value="${esc(hoje)}"></div>
                <div class="relop-campo"><label>Origem</label><input type="text" id="relop-campo-origem" value="PM-2/10º BPM"></div>
                <div class="relop-campo"><label>Difusão</label><input type="text" id="relop-campo-difusao" value="TJAL"></div>
                <div class="relop-campo"><label>Difusão anterior</label><input type="text" id="relop-campo-difusao-ant" value="X-X-X-X"></div>
                <div class="relop-campo"><label>Referência</label><input type="text" id="relop-campo-referencia" value="X-X-X-X"></div>
                <div class="relop-campo"><label>Operação</label><input type="text" id="relop-campo-operacao" value="X-X-X-X"></div>
                <div class="relop-campo"><label>Referente aos autos nº</label><input type="text" id="relop-campo-autos" value="${esc(autosPreenchido)}" placeholder="ex.: 8000052-74.2026.8.02.0046"></div>
            </div>
            <div class="relop-campo"><label>Assunto</label><input type="text" id="relop-campo-assunto" value="CUMPRIMENTO DE MANDADOS DE BUSCA E APREENSÃO"></div>
            <div class="relop-campo"><label>Narrativa (revise antes de gerar — comarca/natureza da investigação não vêm do CAD)</label>
                <textarea id="relop-campo-narrativa" rows="5">${esc(montarNarrativaPadrao(params, alvos))}</textarea>
            </div>

            <div class="relop-secao-titulo">Alvos e resultados das diligências (${alvos.length})</div>
            <div id="relop-lista-alvos"></div>
        `;
        const listaEl = document.getElementById('relop-lista-alvos');
        listaEl.innerHTML = alvos.map((a, i) => `
            <div class="relop-alvo-card" data-relop-alvo="${i}">
                <div class="relop-alvo-card-cabecalho"><span>Boletim ${esc(a.BOLETIM)} · ${esc(a.DATA)} ${esc(a.HORA || '')}</span><span>${(a.IMAGENS || []).length} imagem(ns) no CAD</span></div>
                <div class="relop-campo"><label>Nome do alvo</label><input type="text" id="relop-alvo-nome-${i}" value="${esc(a.NOME_ALVO || '')}" placeholder="Nome do representado/alvo"></div>
                <div class="relop-campo"><label>Endereço</label><textarea id="relop-alvo-endereco-${i}" rows="2">${esc(montarEnderecoAlvo(a))}</textarea></div>
                <div class="relop-grid-2">
                    <div class="relop-campo"><label>Mandado cumprido</label>
                        <select id="relop-alvo-cumprido-${i}"><option value="SIM">SIM</option><option value="NÃO">NÃO</option><option value="PARCIALMENTE">PARCIALMENTE</option></select>
                    </div>
                    <div class="relop-campo"><label>Material apreendido (revise — extraído do CAD, editável)</label><textarea id="relop-alvo-material-${i}" rows="2" placeholder="Nada encontrado">${esc(a.MATERIAL_APREENDIDO || (a.SOLUCAO && /nada/i.test(a.SOLUCAO) ? 'Nada encontrado' : ''))}</textarea></div>
                </div>
                ${a.TEXTO_DESPACHANTE ? `<div style="font-size:11.5px;color:var(--p3-text-muted);background:var(--p3-surface);border:1px dashed var(--p3-border);border-radius:6px;padding:8px 10px;margin-top:6px;"><b>Despacho no CAD (referência):</b> ${esc(a.TEXTO_DESPACHANTE)}</div>` : ''}
                <div class="relop-galeria">
                    ${(a.IMAGENS || []).length
                        ? a.IMAGENS.map((img, j) => `<label><input type="checkbox" data-relop-img="${i}-${j}" checked style="display:none;"><img src="data:${esc(img.contentType)};base64,${img.base64}" alt=""></label>`).join('')
                        : '<span class="relop-galeria-vazia">Nenhuma imagem anexada no CAD pra este boletim.</span>'}
                </div>
            </div>
        `).join('');

        // Clicar na foto alterna incluir/excluir do Anexo A (feedback visual
        // via opacidade — o checkbox em si fica oculto, só a foto é clicável).
        listaEl.querySelectorAll('.relop-galeria img').forEach(img => {
            img.addEventListener('click', () => {
                const cb = img.previousElementSibling;
                cb.checked = !cb.checked;
                img.style.opacity = cb.checked ? '1' : '.3';
            });
        });

        document.getElementById('relop-rodape').innerHTML = `
            <button type="button" class="relop-btn relop-btn-secundario" id="relop-btn-voltar">← Voltar</button>
            <button type="button" class="relop-btn" id="relop-btn-gerar">🖨️ Gerar e imprimir RELOP</button>
        `;
        document.getElementById('relop-btn-voltar').addEventListener('click', () => renderEscolha());
        document.getElementById('relop-btn-gerar').addEventListener('click', () => gerarEImprimir(alvos));
    }

    // ── Etapa 3 — monta o HTML final (mesmo modelo do RELOP em uso) e
    // imprime via iframe oculto (nunca window.open — esbarra em
    // bloqueador de pop-up, mesma correção já aplicada em js/cerbero.js). ─
    function gerarEImprimir(alvos) {
        const cabecalho = {
            numero: document.getElementById('relop-campo-numero').value.trim() || '____',
            data: document.getElementById('relop-campo-data').value,
            origem: document.getElementById('relop-campo-origem').value.trim(),
            difusao: document.getElementById('relop-campo-difusao').value.trim(),
            difusaoAnterior: document.getElementById('relop-campo-difusao-ant').value.trim(),
            referencia: document.getElementById('relop-campo-referencia').value.trim(),
            operacao: document.getElementById('relop-campo-operacao').value.trim(),
            autos: document.getElementById('relop-campo-autos').value.trim(),
            assunto: document.getElementById('relop-campo-assunto').value.trim(),
            narrativa: document.getElementById('relop-campo-narrativa').value.trim(),
        };
        const alvosEditados = alvos.map((a, i) => ({
            nome: document.getElementById('relop-alvo-nome-' + i).value.trim() || '(não informado)',
            endereco: document.getElementById('relop-alvo-endereco-' + i).value.trim(),
            cumprido: document.getElementById('relop-alvo-cumprido-' + i).value,
            material: document.getElementById('relop-alvo-material-' + i).value.trim() || 'Nada encontrado',
            imagens: (a.IMAGENS || []).filter((img, j) => {
                const cb = document.querySelector(`[data-relop-img="${i}-${j}"]`);
                return !cb || cb.checked;
            }),
        }));

        const html = montarDocumentoHtml(cabecalho, alvosEditados);
        let iframe = document.getElementById('relop-print-iframe');
        if (!iframe) {
            iframe = document.createElement('iframe');
            iframe.id = 'relop-print-iframe';
            iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:1120px;border:0;';
            document.body.appendChild(iframe);
        }
        const doc = iframe.contentWindow.document;
        doc.open();
        doc.write(html);
        doc.close();
        setTimeout(() => { iframe.contentWindow.focus(); iframe.contentWindow.print(); }, 400);
    }

    function dataBrDe(iso) {
        const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
    }

    const TEXTO_SIGILO = 'O sigilo deste documento é protegido e controlado pela Lei n.º 12.527/11. A divulgação, o fornecimento, a utilização ou ' +
        'a reprodução desautorizada do seu conteúdo, a qualquer tempo ou por qualquer meio ou modo, inclusive mediante ' +
        'acesso ou facilitação de acesso indevidos, constituem condutas ilícitas que ensejam responsabilidades penais, civis e administrativas.';
    const TEXTO_DNISP = 'Conhecimento para assessoramento do processo decisório, não tendo finalidade probatória. Conforme previsto na DNISP, ' +
        'este documento e seus anexos não devem ser inseridos em procedimentos e/ou processos de qualquer natureza.';

    function montarDocumentoHtml(c, alvos) {
        const dataExibicao = dataBrDe(c.data);
        const numeroTitulo = `Nº ${esc(c.numero)}/10ºBPM/PM-2 -${esc(dataExibicao)}`;
        const totalImagens = alvos.reduce((s, a) => s + a.imagens.length, 0);

        const secaoAlvos = alvos.map(a => `
            <div class="relopdoc-alvo">
                <h3>${esc(a.nome)}</h3>
                ${a.endereco.split('\n').filter(Boolean).map(linha => `<p class="relopdoc-endereco"><b>ENDEREÇO:</b> ${esc(linha)}</p>`).join('')}
                <p><b>MANDADO CUMPRIDO:</b> ${esc(a.cumprido)}</p>
                <p><b>MATERIAL APREENDIDO:</b><br>${esc(a.material).replace(/\n/g, '<br>')}</p>
            </div>`).join('<hr class="relopdoc-sep">');

        const anexoA = totalImagens ? `
            <div class="relopdoc-pagebreak"></div>
            <h2 class="relopdoc-anexo-titulo">ANEXO A - MANDADOS CUMPRIDOS</h2>
            <div class="relopdoc-galeria">
                ${alvos.map(a => a.imagens.map(img => `<img src="data:${esc(img.contentType)};base64,${img.base64}" alt="">`).join('')).join('')}
            </div>` : '';

        return `<!doctype html><html><head><meta charset="utf-8"><title>RELOP ${esc(c.numero)}</title>
            <style>
                @page { size: A4; margin: 16mm 14mm; }
                body { font-family: Arial, Helvetica, sans-serif; color:#111; font-size:12.5px; line-height:1.5; margin:0; }
                .relopdoc-topo-aviso, .relopdoc-rodape-aviso { border:1px solid #cc0000; color:#cc0000; font-size:9.5px; padding:5px 8px; margin-bottom:8px; }
                .relopdoc-acesso-restrito { text-align:center; margin:6px 0 14px; }
                .relopdoc-acesso-restrito span { display:inline-block; border:2px solid #cc0000; color:#cc0000; font-weight:700; padding:3px 14px; border-radius:4px; }
                .relopdoc-cabecalho { display:flex; align-items:center; gap:16px; margin-bottom:16px; }
                .relopdoc-cabecalho img { width:64px; height:64px; object-fit:contain; }
                .relopdoc-cabecalho-texto { flex:1; text-align:center; font-weight:700; font-size:11.5px; line-height:1.4; }
                .relopdoc-cabecalho-texto small { display:block; font-weight:400; font-size:10px; }
                .relopdoc-titulo { text-align:center; font-weight:700; font-size:13px; margin:14px 0; position:relative; }
                .relopdoc-selo { position:absolute; right:0; top:-6px; width:70px; height:auto; opacity:.92; }
                table.relopdoc-campos { width:100%; border-collapse:collapse; margin-bottom:14px; }
                table.relopdoc-campos td { padding:2px 4px; font-size:12px; vertical-align:top; }
                table.relopdoc-campos td.relopdoc-rot { font-weight:700; width:150px; white-space:nowrap; }
                .relopdoc-narrativa p { margin:0 0 10px; text-align:justify; white-space:pre-wrap; }
                .relopdoc-secao-titulo { font-weight:700; margin:22px 0 10px; border-bottom:1px solid #333; padding-bottom:4px; }
                .relopdoc-alvo h3 { font-size:12.5px; margin:0 0 6px; text-transform:uppercase; }
                .relopdoc-alvo p { margin:2px 0; }
                .relopdoc-endereco { margin:2px 0 4px !important; }
                .relopdoc-sep { border:none; border-top:1px dashed #999; margin:14px 0; }
                .relopdoc-pagebreak { page-break-before: always; }
                .relopdoc-anexo-titulo { text-align:center; margin-top:20px; }
                .relopdoc-galeria { display:flex; flex-direction:column; gap:16px; align-items:center; }
                .relopdoc-galeria img { max-width:100%; max-height:220mm; object-fit:contain; page-break-inside:avoid; }
            </style></head>
            <body>
                <div class="relopdoc-topo-aviso">${TEXTO_DNISP}</div>
                <div class="relopdoc-acesso-restrito"><span>ACESSO RESTRITO</span></div>
                <div class="relopdoc-cabecalho">
                    <img src="../img/brasao.png" alt="brasão">
                    <div class="relopdoc-cabecalho-texto">
                        ESTADO DE ALAGOAS<br>SECRETARIA DE SEGURANÇA PÚBLICA<br>POLÍCIA MILITAR DE ALAGOAS<br>
                        COMANDO DE POLICIAMENTO DA REGIÃO DO AGRESTE (CPRA)<br>CISP II – 10º BATALHÃO DE POLÍCIA MILITAR (10º BPM)
                        <small>p2.10bpm@pm.al.gov.br / p2.10bpm.pmal@gmail.com</small>
                    </div>
                </div>
                <div class="relopdoc-titulo">RELOP - CUMPRIMENTO DE MANDADO - ${numeroTitulo}<img class="relopdoc-selo" src="../img/selo-relop-10bpm.png" alt="selo de autenticação"></div>
                <table class="relopdoc-campos">
                    <tr><td class="relopdoc-rot">DATA:</td><td>${esc(dataExibicao)}</td></tr>
                    <tr><td class="relopdoc-rot">ASSUNTO:</td><td>${esc(c.assunto)}</td></tr>
                    <tr><td class="relopdoc-rot">REFERENTE AOS AUTOS Nº:</td><td>${esc(c.autos || 'X-X-X-X')}</td></tr>
                    <tr><td class="relopdoc-rot">ORIGEM:</td><td>${esc(c.origem)}</td></tr>
                    <tr><td class="relopdoc-rot">DIFUSÃO:</td><td>${esc(c.difusao)}</td></tr>
                    <tr><td class="relopdoc-rot">DIFUSÃO ANTERIOR:</td><td>${esc(c.difusaoAnterior)}</td></tr>
                    <tr><td class="relopdoc-rot">REFERÊNCIA:</td><td>${esc(c.referencia)}</td></tr>
                    <tr><td class="relopdoc-rot">OPERAÇÃO:</td><td>${esc(c.operacao)}</td></tr>
                    <tr><td class="relopdoc-rot">ANEXOS:</td><td>${totalImagens ? 'ANEXO A - MANDADOS CUMPRIDOS' : 'X-X-X-X'}</td></tr>
                </table>
                <div class="relopdoc-narrativa">${c.narrativa.split(/\n\s*\n/).map(p => `<p>${esc(p)}</p>`).join('')}</div>
                <div class="relopdoc-secao-titulo">ALVOS E RESULTADOS DAS DILIGÊNCIAS</div>
                ${secaoAlvos}
                ${anexoA}
                <div class="relopdoc-rodape-aviso" style="margin-top:20px;">${TEXTO_SIGILO}</div>
                <div class="relopdoc-acesso-restrito"><span>ACESSO RESTRITO</span></div>
            </body></html>`;
    }

    document.addEventListener('DOMContentLoaded', function () {
        const btn = document.getElementById('btn-gerar-relop');
        if (btn) btn.addEventListener('click', abrir);
    });
})();
