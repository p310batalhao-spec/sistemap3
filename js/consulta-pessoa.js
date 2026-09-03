// ====================================================================
// Sistema P3 — Consulta Integrada de Pessoas (page/consulta-pessoa.html)
// ====================================================================
// Fala só com o servidor Python local (tools/atualizador-local/), rotas
// /pessoa/consultar e /pessoa/ocorrencia-detalhe (ver
// js/core/atualizador-local.js:consultarPessoa/ocorrenciaDetalhe) — sem
// fallback via Apps Script (essas fontes — CAD PPE/PC/SISPOL/BNMP/IDNET,
// TJAL — nunca existiram lá).
//
// Recurso sensível — só nível P2/ADMIN, mesmo critério de
// page/busca-facial-campo.html (ver requireP2OuAdmin abaixo). O
// servidor Python também recusa (503) se não estiver rodando dentro do
// app desktop com esse nível — aqui é só a 1ª camada (nunca confiar só
// no frontend, ver app.py:_autorizado).
//
// SIMPLIFICAÇÃO MANTIDA — mãe/pai em "Vínculos" (via CAD) aparecem como
// texto, não clicáveis: o CAD não devolve o CPF da mãe/pai, só o nome.
// (29/08/2026 — a busca por NOME/MÃE/PAI em si já existe agora, ver
// modo "nome" abaixo/buscarPorNome — o que falta é achar o CPF exato
// de quem aparece só como texto dentro de uma ocorrência/vínculo já
// carregado, não a busca autônoma por nome, que já funciona.)

(function () {
    'use strict';

    let ULTIMO_RESULTADO = null;

    // Abas de consulta "estilo navegador" (29/08/2026, pedido explícito:
    // "quando faço uma consulta muito próxima da outra... quero que crie
    // uma nova aba... com a primeira pesquisa ainda visível enquanto a
    // segunda carrega, quando a segunda carregar ficará nessa segunda
    // aba, caso eu clique em outro vínculo clicável, abre outra aba").
    // Cada item: {id, cpfLimpo, titulo, resultado, carregando, erro,
    // progresso:{etapa,concluidas,total}} — ver criarAbaConsulta/
    // executarConsultaEmAba/renderizarConsultaAtiva abaixo.
    let ABAS_CONSULTA = [];
    let ABA_CONSULTA_ATIVA_ID = null;
    let PROX_ABA_CONSULTA_ID = 1;

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function limparCpf(v) {
        return String(v || '').replace(/\D/g, '');
    }

    function formatarCpf(cpfLimpo) {
        if (!cpfLimpo || cpfLimpo.length !== 11) return cpfLimpo || '—';
        return cpfLimpo.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    }

    // ────────────────────────────────────────────────────────────────
    // GATE — P2/ADMIN (mesmo critério de page/busca-facial-campo.html)
    // ────────────────────────────────────────────────────────────────
    function requireP2OuAdmin() {
        const sessao = P3.requireAuth();
        if (!sessao) return null;
        if (sessao.nivel !== 'p2' && sessao.nivel !== 'admin') {
            alert('Este recurso está disponível apenas para usuários com nível P2 ou ADMIN.');
            location.href = '../index.html';
            return null;
        }
        return sessao;
    }

    // ────────────────────────────────────────────────────────────────
    // ABAS DE CONSULTA — cada consulta (CPF) vira uma aba independente,
    // igual a abas de navegador. A busca da barra principal ATIVA a aba
    // na hora (é uma ação direta do usuário); clique em vínculo/rede
    // (P3ConsultaPessoaAbrirCpf) cria a aba EM SEGUNDO PLANO — a aba
    // atual continua visível/intacta enquanto a nova carrega — e só
    // troca o foco pra ela quando terminar de carregar.
    // ────────────────────────────────────────────────────────────────
    function abaConsultaAtiva() {
        return ABAS_CONSULTA.find(a => a.id === ABA_CONSULTA_ATIVA_ID) || null;
    }

    function criarAbaConsulta(cpfLimpo) {
        const aba = {
            id: PROX_ABA_CONSULTA_ID++, cpfLimpo, titulo: formatarCpf(cpfLimpo),
            resultado: null, carregando: true, erro: null,
            progresso: { etapa: 'Iniciando...', concluidas: 0, total: 0 },
        };
        ABAS_CONSULTA.push(aba);
        return aba;
    }

    function ativarAbaConsulta(id) {
        ABA_CONSULTA_ATIVA_ID = id;
        const aba = abaConsultaAtiva();
        document.getElementById('cip-input-cpf').value = aba ? formatarCpf(aba.cpfLimpo) : '';
        renderAbasConsulta();
        renderizarConsultaAtiva();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function fecharAbaConsulta(id) {
        const idx = ABAS_CONSULTA.findIndex(a => a.id === id);
        if (idx === -1) return;
        ABAS_CONSULTA.splice(idx, 1);
        if (ABA_CONSULTA_ATIVA_ID === id) {
            const proxima = ABAS_CONSULTA[idx] || ABAS_CONSULTA[idx - 1] || null;
            ABA_CONSULTA_ATIVA_ID = proxima ? proxima.id : null;
            const inputCpf = document.getElementById('cip-input-cpf');
            inputCpf.value = proxima ? formatarCpf(proxima.cpfLimpo) : '';
        }
        renderAbasConsulta();
        renderizarConsultaAtiva();
    }

    function renderAbasConsulta() {
        const cont = document.getElementById('cip-abas-consulta');
        if (!cont) return;
        if (!ABAS_CONSULTA.length) { cont.style.display = 'none'; cont.innerHTML = ''; return; }
        cont.style.display = 'flex';
        cont.innerHTML = ABAS_CONSULTA.map(a => {
            const ativa = a.id === ABA_CONSULTA_ATIVA_ID;
            const statusIcone = a.carregando ? '<span class="cip-aba-consulta-spinner" title="Carregando..."></span>'
                : (a.erro ? '<span title="Falhou">⚠️</span>' : '');
            return `<div class="cip-aba-consulta-btn${ativa ? ' ativa' : ''}" data-id="${a.id}" title="${esc(a.titulo)} — ${esc(formatarCpf(a.cpfLimpo))}">
                ${statusIcone}<span class="cip-aba-consulta-titulo">${esc(a.titulo)}</span>
                <button type="button" class="cip-aba-consulta-fechar" data-fechar-id="${a.id}" title="Fechar aba">✕</button>
            </div>`;
        }).join('');
        cont.querySelectorAll('.cip-aba-consulta-btn').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target.closest('.cip-aba-consulta-fechar')) return;
                ativarAbaConsulta(Number(el.dataset.id));
            });
        });
        cont.querySelectorAll('.cip-aba-consulta-fechar').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                fecharAbaConsulta(Number(btn.dataset.fecharId));
            });
        });
    }

    // Roda a consulta de verdade pra 1 aba — atualiza só o estado DELA;
    // só mexe no DOM da consulta (progresso/cabeçalho/painéis) se essa
    // aba ainda for a ativa no momento do evento (senão outra aba que o
    // usuário esteja olhando "piscaria" com dado de uma consulta alheia).
    async function executarConsultaEmAba(aba, ativarAoTerminar) {
        try {
            const r = await P3AtualizadorLocal.consultarPessoaStream(aba.cpfLimpo, function (evento) {
                if (evento.tipo === 'progresso') {
                    aba.progresso = { etapa: evento.etapa, concluidas: evento.concluidas, total: evento.total };
                } else if (evento.tipo === 'aguardando') {
                    // Outra consulta em andamento na mesma sessão do CAD —
                    // ver CAD_LOCK em cad_alcatraz.py (nunca 2 ao mesmo
                    // tempo, senão uma atropela o contexto da outra).
                    aba.progresso = { ...aba.progresso, etapa: '⏳ ' + (evento.mensagem || 'Aguardando outra consulta terminar...') };
                }
                if (ABA_CONSULTA_ATIVA_ID === aba.id) renderizarConsultaAtiva();
                renderAbasConsulta();
            });
            aba.resultado = r;
            aba.carregando = false;
            aba.titulo = (r.pessoa && r.pessoa.nome) ? r.pessoa.nome.trim().split(/\s+/).slice(0, 2).join(' ') : formatarCpf(aba.cpfLimpo);
        } catch (e) {
            aba.erro = e.message;
            aba.carregando = false;
        }
        if (ativarAoTerminar) {
            ativarAbaConsulta(aba.id);
        } else {
            renderAbasConsulta();
            if (ABA_CONSULTA_ATIVA_ID === aba.id) renderizarConsultaAtiva();
        }
    }

    // Reflete o estado da aba ATIVA na tela (progresso/cabeçalho/painéis)
    // — chamada sempre que a aba ativa muda OU o estado dela muda.
    function renderizarConsultaAtiva() {
        const aba = abaConsultaAtiva();
        const msg = document.getElementById('cip-status-msg');
        const progWrap = document.getElementById('cip-progresso-wrap');
        const progFill = document.getElementById('cip-progresso-fill');
        const progEtapa = document.getElementById('cip-progresso-etapa');
        const progTexto = document.getElementById('cip-progresso-texto');
        const btnImprimir = document.getElementById('cip-btn-imprimir');

        if (!aba) {
            document.getElementById('cip-shell').style.display = 'none';
            progWrap.style.display = 'none';
            msg.textContent = '';
            btnImprimir.disabled = true;
            btnImprimir.title = 'Consulte uma pessoa primeiro';
            return;
        }

        if (aba.carregando) {
            document.getElementById('cip-shell').style.display = 'none';
            progWrap.style.display = 'block';
            const pct = aba.progresso.total ? Math.round((aba.progresso.concluidas / aba.progresso.total) * 100) : 0;
            progFill.style.width = pct + '%';
            progEtapa.textContent = aba.progresso.etapa || 'Iniciando...';
            progTexto.textContent = aba.progresso.total ? `${aba.progresso.concluidas}/${aba.progresso.total} (${pct}%)` : '';
            msg.style.color = 'var(--p3-text-muted)';
            msg.textContent = 'Consultando — pode levar alguns segundos, várias etapas são checadas em sequência...';
            btnImprimir.disabled = true;
            btnImprimir.title = 'Consulte uma pessoa primeiro';
            return;
        }

        if (aba.erro) {
            document.getElementById('cip-shell').style.display = 'none';
            progWrap.style.display = 'none';
            msg.style.color = 'var(--p3-danger)';
            msg.textContent = 'Erro: ' + aba.erro;
            btnImprimir.disabled = true;
            btnImprimir.title = 'Consulte uma pessoa primeiro';
            return;
        }

        progWrap.style.display = 'none';
        btnImprimir.disabled = false;
        btnImprimir.title = '';
        msg.style.color = '#1e6b34';
        const r = aba.resultado;
        ULTIMO_RESULTADO = r;
        const okCount = r.fontes.filter(f => f.ok).length;
        msg.textContent = `Consulta concluída em ${(r.tempoTotalMs / 1000).toFixed(1)}s — ${okCount}/${r.fontes.length} etapa(s) concluídas.`;
        renderizarTudo(r);
    }

    // ────────────────────────────────────────────────────────────────
    // CONSULTA
    // ────────────────────────────────────────────────────────────────
    async function consultar() {
        const input = document.getElementById('cip-input-cpf');
        const msg = document.getElementById('cip-status-msg');
        const cpfLimpo = limparCpf(input.value);

        if (cpfLimpo.length !== 11) {
            msg.textContent = 'Informe um CPF válido (11 dígitos).';
            msg.style.color = 'var(--p3-danger)';
            return;
        }

        if (!(await P3AtualizadorLocal.disponivel())) {
            document.getElementById('cip-aviso-servidor').style.display = 'block';
            return;
        }
        document.getElementById('cip-aviso-servidor').style.display = 'none';

        // Aba já aberta pro mesmo CPF — só troca o foco pra ela em vez
        // de duplicar/re-consultar.
        const existente = ABAS_CONSULTA.find(a => a.cpfLimpo === cpfLimpo);
        if (existente) { ativarAbaConsulta(existente.id); return; }

        const aba = criarAbaConsulta(cpfLimpo);
        ativarAbaConsulta(aba.id); // busca feita direto na barra principal = foco imediato
        executarConsultaEmAba(aba, false);
    }

    // Reaproveitada pelos cliques em "Vínculos"/rede de vínculos — abre
    // uma consulta NOVA pro CPF vinculado (autor/suspeito já cadastrado)
    // numa aba própria, EM SEGUNDO PLANO: a aba/consulta atual continua
    // visível até a nova terminar de carregar, só então o foco troca pra
    // ela — pedido explícito do usuário (29/08/2026): "quando faço uma
    // consulta muito próxima da outra... a primeira retorna com a foto,
    // a segunda não faz a consulta corretamente" / "crie uma nova aba...
    // com a primeira pesquisa ainda visível enquanto a segunda carrega".
    function consultarPorCpf(cpfLimpo) {
        alternarModoBusca('cpf');
        const existente = ABAS_CONSULTA.find(a => a.cpfLimpo === cpfLimpo);
        if (existente) { ativarAbaConsulta(existente.id); return; }
        const aba = criarAbaConsulta(cpfLimpo);
        renderAbasConsulta(); // mostra a aba nova (com spinner) sem tirar o foco da atual
        executarConsultaEmAba(aba, true);
    }
    window.P3ConsultaPessoaAbrirCpf = consultarPorCpf;

    // Abre uma aba com um resultado JÁ salvo (não roda o CAD de novo) —
    // 01/09/2026, pedido explícito do usuário: "ao clicar em detalhes
    // virá todo o cruzamento CAD/IDNET, SUPABASE detalhado como uma
    // ficha do alvo, semelhante à impressão da consulta detalhada".
    // Usado pela "🔍 Detalhes" de page/denunciasRecorrentes.html — o
    // resultado completo já foi salvo na Hostinger na varredura, então
    // só precisa ser EXIBIDO, reaproveitando 100% da mesma
    // renderização/impressão desta tela (ver
    // criarAbaConsulta/renderizarTudo/imprimirConsultaCompleta), sem
    // gastar uma nova consulta real no CAD.
    function abrirResultadoSalvoEmAba(resultado) {
        const cpfLimpo = limparCpf(resultado.cpf);
        const existente = ABAS_CONSULTA.find(a => a.cpfLimpo === cpfLimpo);
        if (existente) { existente.resultado = resultado; existente.erro = null; existente.carregando = false; ativarAbaConsulta(existente.id); return; }
        const aba = criarAbaConsulta(cpfLimpo);
        aba.resultado = resultado;
        aba.carregando = false;
        aba.titulo = (resultado.pessoa && resultado.pessoa.nome)
            ? resultado.pessoa.nome.trim().split(/\s+/).slice(0, 2).join(' ') : formatarCpf(cpfLimpo);
        ativarAbaConsulta(aba.id);
    }
    window.P3ConsultaPessoaAbrirResultadoSalvo = abrirResultadoSalvoEmAba;

    // ────────────────────────────────────────────────────────────────
    // MODO DE BUSCA — CPF | Nome/Mãe/Pai | Veículo (29/08/2026, pedido
    // explícito: "faça a consulta também por NOME... igual ao CAD" e
    // "pesquisar Veículos por PLACA, RENAVAM ou CHASSI... igual ao CAD").
    // RENAVAM confirmado (via HAR real veiculos.al.gov.br.har) que NÃO
    // é aceito como critério de busca pelo CAD — só placa/chassi — por
    // isso não tem campo de RENAVAM aqui (só apareceria no resultado).
    // ────────────────────────────────────────────────────────────────
    function alternarModoBusca(modo) {
        document.querySelectorAll('.cip-modo-btn').forEach(b => b.classList.toggle('cip-modo-ativo', b.dataset.modo === modo));
        document.getElementById('cip-busca-cpf').style.display = modo === 'cpf' ? 'flex' : 'none';
        document.getElementById('cip-busca-nome').style.display = modo === 'nome' ? 'flex' : 'none';
        document.getElementById('cip-busca-veiculo').style.display = modo === 'veiculo' ? 'flex' : 'none';
        document.getElementById('cip-busca-cnpj').style.display = modo === 'cnpj' ? 'flex' : 'none';
        document.getElementById('cip-lista-nome').style.display = 'none';
        document.getElementById('cip-resultado-veiculo').style.display = 'none';
        document.getElementById('cip-resultado-cnpj').style.display = 'none';
        document.getElementById('cip-status-msg').textContent = '';
    }

    // Renderiza a lista de resultados de uma busca por nome (usada tanto
    // pelo formulário "Nome / Mãe / Pai" quanto pelo clique num nome de
    // mãe/pai dentro da aba Vínculos — ver buscarEAbrirPorNome abaixo).
    function exibirResultadosNome(pessoas) {
        const lista = document.getElementById('cip-lista-nome');
        lista.innerHTML = pessoas.map((p, i) => {
            const cpfLimpo = limparCpf(p.cpf);
            const detalhes = [
                cpfLimpo ? 'CPF: ' + formatarCpf(cpfLimpo) : 'CPF não informado no CAD',
                p.dataNascimento ? 'Nasc.: ' + p.dataNascimento : '',
                p.mae ? 'Mãe: ' + p.mae : '',
                p.pai ? 'Pai: ' + p.pai : '',
            ].filter(Boolean).join(' · ');
            return `<div class="cip-lista-resultado-item" data-idx="${i}">
                <b>${esc(p.nome || 'Sem nome')}</b>
                <span>${esc(detalhes)}</span>
            </div>`;
        }).join('');
        lista.style.display = 'block';
        lista.querySelectorAll('.cip-lista-resultado-item').forEach(item => {
            item.addEventListener('click', () => {
                const p = pessoas[Number(item.dataset.idx)];
                const cpfLimpo = limparCpf(p.cpf);
                if (!cpfLimpo) {
                    const msg = document.getElementById('cip-status-msg');
                    msg.style.color = 'var(--p3-danger)';
                    msg.textContent = 'Essa pessoa não tem CPF cadastrado no CAD — não é possível abrir a consulta completa.';
                    return;
                }
                consultarPorCpf(cpfLimpo);
            });
        });
    }

    // Clique num nome de MÃE/PAI dentro da aba Vínculos (ver renderVinculos)
    // — o CAD não devolve o CPF da mãe/pai, só o nome (ver nota de
    // simplificação no topo do arquivo), mas já existe busca por nome
    // (ver buscarPorNome/exibirResultadosNome acima), então dá pra
    // aproveitar: busca essa pessoa PELO PRÓPRIO NOME dela (não como
    // "mãe de"/"pai de" ninguém) e já abre direto se achar 1 resultado
    // só com CPF; se achar mais de 1 (homônimos), muda pro modo "Nome"
    // e mostra a lista pra escolher — pedido explícito do usuário
    // (30/08/2026): "os vínculos de pai e mãe... todos clicáveis para
    // novas consultas se possível".
    async function buscarEAbrirPorNome(nome) {
        const msg = document.getElementById('cip-status-msg');
        if (!(await P3AtualizadorLocal.disponivel())) {
            document.getElementById('cip-aviso-servidor').style.display = 'block';
            return;
        }
        document.getElementById('cip-aviso-servidor').style.display = 'none';
        alternarModoBusca('nome');
        document.getElementById('cip-input-nome').value = nome;
        msg.style.color = 'var(--p3-text-muted)';
        msg.textContent = `Buscando "${nome}"...`;
        window.scrollTo({ top: 0, behavior: 'smooth' });
        try {
            const r = await P3AtualizadorLocal.buscarPessoaPorNome(nome, '', '');
            if (!r.ok) {
                msg.style.color = 'var(--p3-danger)';
                msg.textContent = 'Erro: ' + (r.erro || 'falha desconhecida.');
                return;
            }
            const pessoas = r.pessoas || [];
            if (pessoas.length === 0) {
                msg.style.color = 'var(--p3-text-muted)';
                msg.textContent = `Nenhuma pessoa encontrada no CAD com o nome "${nome}".`;
                return;
            }
            if (pessoas.length === 1 && limparCpf(pessoas[0].cpf)) {
                consultarPorCpf(limparCpf(pessoas[0].cpf));
                return;
            }
            msg.style.color = '#1e6b34';
            msg.textContent = `${pessoas.length} pessoa(s) encontrada(s) pra "${nome}" — clique numa pra abrir a consulta completa por CPF.`;
            exibirResultadosNome(pessoas);
        } catch (e) {
            msg.style.color = 'var(--p3-danger)';
            msg.textContent = 'Erro: ' + e.message;
        }
    }
    window.P3ConsultaPessoaAbrirPorNome = buscarEAbrirPorNome;

    async function buscarPorNome() {
        const nome = document.getElementById('cip-input-nome').value.trim();
        const mae = document.getElementById('cip-input-mae').value.trim();
        const pai = document.getElementById('cip-input-pai').value.trim();
        const msg = document.getElementById('cip-status-msg');
        const lista = document.getElementById('cip-lista-nome');

        if (!nome && !mae && !pai) {
            msg.style.color = 'var(--p3-danger)';
            msg.textContent = 'Informe ao menos o nome, o nome da mãe ou o nome do pai.';
            return;
        }
        if (!(await P3AtualizadorLocal.disponivel())) {
            document.getElementById('cip-aviso-servidor').style.display = 'block';
            return;
        }
        document.getElementById('cip-aviso-servidor').style.display = 'none';
        lista.style.display = 'none';
        msg.style.color = 'var(--p3-text-muted)';
        msg.textContent = 'Buscando...';

        try {
            const r = await P3AtualizadorLocal.buscarPessoaPorNome(nome, mae, pai);
            if (!r.ok) {
                msg.style.color = 'var(--p3-danger)';
                msg.textContent = 'Erro: ' + (r.erro || 'falha desconhecida.');
                return;
            }
            const pessoas = r.pessoas || [];
            if (pessoas.length === 0) {
                msg.style.color = 'var(--p3-text-muted)';
                msg.textContent = 'Nenhuma pessoa encontrada com esses critérios.';
                return;
            }
            msg.style.color = '#1e6b34';
            msg.textContent = `${pessoas.length} pessoa(s) encontrada(s) — clique numa pra abrir a consulta completa por CPF.`;
            exibirResultadosNome(pessoas);
        } catch (e) {
            msg.style.color = 'var(--p3-danger)';
            msg.textContent = 'Erro: ' + e.message;
        }
    }

    async function buscarVeiculoAcao() {
        const placa = document.getElementById('cip-input-placa').value.trim();
        const chassi = document.getElementById('cip-input-chassi').value.trim();
        const msg = document.getElementById('cip-status-msg');
        const resultado = document.getElementById('cip-resultado-veiculo');

        if (!placa && !chassi) {
            msg.style.color = 'var(--p3-danger)';
            msg.textContent = 'Informe a placa ou o chassi (o CAD não aceita busca de veículo por RENAVAM).';
            return;
        }
        if (!(await P3AtualizadorLocal.disponivel())) {
            document.getElementById('cip-aviso-servidor').style.display = 'block';
            return;
        }
        document.getElementById('cip-aviso-servidor').style.display = 'none';
        resultado.style.display = 'none';
        msg.style.color = 'var(--p3-text-muted)';
        msg.textContent = 'Buscando...';

        try {
            const r = await P3AtualizadorLocal.buscarVeiculo(placa, chassi);
            if (!r.ok) {
                msg.style.color = 'var(--p3-danger)';
                msg.textContent = 'Erro: ' + (r.erro || 'falha desconhecida.');
                return;
            }
            if (!r.encontrado) {
                msg.style.color = 'var(--p3-text-muted)';
                msg.textContent = 'Nenhum veículo encontrado com esses critérios.';
                return;
            }
            msg.style.color = '#1e6b34';
            msg.textContent = 'Veículo encontrado.';
            const v = r.veiculo || {};
            resultado.innerHTML = `<div class="cip-lista-resultado-item" style="cursor:default;">` +
                Object.entries(v).map(([k, val]) => `<div><b>${esc(k)}:</b> ${esc(val)}</div>`).join('') +
                `</div>`;
            resultado.style.display = 'block';
        } catch (e) {
            msg.style.color = 'var(--p3-danger)';
            msg.textContent = 'Erro: ' + e.message;
        }
    }

    // ────────────────────────────────────────────────────────────────
    // CNPJ — 31/08/2026, pedido explícito do usuário: "módulo de consulta
    // de cnpj devolvendo todos os dados... através do Brasilapi". API
    // pública/gratuita, sem CAD envolvido (ver brasilapi_cnpj.py) — por
    // isso não passa pela verificação de credenciais do CAD que os outros
    // modos fazem. Mostra TODOS os campos que a BrasilAPI devolve,
    // organizados em grupos (não é um resumo — é o dado completo, só
    // agrupado pra não virar uma parede de texto).
    // ────────────────────────────────────────────────────────────────
    function _cnpjFormatar(cnpj) {
        const d = String(cnpj || '').replace(/\D/g, '');
        return d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : (cnpj || '—');
    }
    function _cnpjTelefone(numero) {
        const d = String(numero || '').replace(/\D/g, '');
        if (!d) return null;
        return d.length > 8 ? `(${d.slice(0, 2)}) ${d.slice(2)}` : d;
    }
    function montarResultadoCnpjHtml(d) {
        let h = '<div class="cip-card">';
        h += `<div style="font-size:16px;font-weight:700;color:var(--p3-text);">${esc(d.razao_social || 'Sem razão social')}</div>`;
        if (d.nome_fantasia) h += `<div style="font-size:13px;color:var(--p3-text-muted);margin-top:2px;">${esc(d.nome_fantasia)}</div>`;
        h += `<div style="font-size:12.5px;color:var(--p3-text-muted);margin-top:6px;">CNPJ ${esc(_cnpjFormatar(d.cnpj))}${d.descricao_identificador_matriz_filial ? ' · ' + esc(d.descricao_identificador_matriz_filial) : ''}</div>`;
        h += '</div>';

        const corSituacao = (d.descricao_situacao_cadastral || '').toUpperCase() === 'ATIVA' ? '#1e6b34' : 'var(--p3-danger)';
        h += `<div class="cip-card"><div class="cip-card-titulo">Situação cadastral</div><div class="cip-kv">` +
            Object.entries({
                'Situação': `<span style="color:${corSituacao};font-weight:700;">${esc(d.descricao_situacao_cadastral || '—')}</span>`,
                'Data da situação': d.data_situacao_cadastral,
                'Motivo': d.descricao_motivo_situacao_cadastral,
                'Natureza jurídica': d.natureza_juridica,
                'Porte': d.porte,
                'Capital social': (d.capital_social || d.capital_social === 0) ? 'R$ ' + Number(d.capital_social).toLocaleString('pt-BR') : null,
                'Início de atividade': d.data_inicio_atividade,
                'Optante pelo Simples': d.opcao_pelo_simples === true ? 'Sim' : (d.opcao_pelo_simples === false ? 'Não' : null),
                'Optante pelo MEI': d.opcao_pelo_mei === true ? 'Sim' : (d.opcao_pelo_mei === false ? 'Não' : null),
            }).filter(([, v]) => v).map(([k, v]) => `<div><b>${esc(k)}:</b> ${v.startsWith && v.startsWith('<span') ? v : esc(v)}</div>`).join('')
            + '</div></div>';

        h += `<div class="cip-card"><div class="cip-card-titulo">Atividade econômica (CNAE)</div>
            <div style="font-size:13px;color:var(--p3-text);"><b>${esc(d.cnae_fiscal || '—')}</b> — ${esc(d.cnae_fiscal_descricao || '—')} <span class="cip-fonte-tag">principal</span></div>`;
        (d.cnaes_secundarios || []).forEach(c => {
            h += `<div style="font-size:12.5px;color:var(--p3-text-muted);margin-top:4px;">${esc(c.codigo)} — ${esc(c.descricao)}</div>`;
        });
        h += '</div>';

        const endereco = [d.descricao_tipo_de_logradouro, d.logradouro].filter(Boolean).join(' ') +
            (d.numero ? ', ' + d.numero : '') + (d.complemento ? ' (' + d.complemento + ')' : '');
        h += `<div class="cip-card"><div class="cip-card-titulo">Endereço e contato</div><div class="cip-kv">` +
            Object.entries({
                'Endereço': endereco || null,
                'Bairro': d.bairro,
                'Município/UF': [d.municipio, d.uf].filter(Boolean).join('/'),
                'CEP': d.cep,
                'Telefone 1': _cnpjTelefone(d.ddd_telefone_1),
                'Telefone 2': _cnpjTelefone(d.ddd_telefone_2),
                'Fax': _cnpjTelefone(d.ddd_fax),
                'E-mail': d.email,
            }).filter(([, v]) => v).map(([k, v]) => `<div><b>${esc(k)}:</b> ${esc(v)}</div>`).join('')
            + '</div></div>';

        const qsa = d.qsa || [];
        if (qsa.length) {
            h += `<div class="cip-card"><div class="cip-card-titulo">Sócios (QSA) — ${qsa.length}</div>
                <div class="cip-tabela-wrap"><table class="cip-tabela"><thead><tr><th>Nome</th><th>Qualificação</th><th>Entrada</th><th>Faixa etária</th></tr></thead><tbody>`;
            qsa.forEach(s => {
                h += `<tr style="cursor:default;"><td>${esc(s.nome_socio || '—')}</td><td>${esc(s.qualificacao_socio || '—')}</td>
                    <td style="white-space:nowrap;">${esc(s.data_entrada_sociedade || '—')}</td><td>${esc(s.faixa_etaria || '—')}</td></tr>`;
            });
            h += '</tbody></table></div></div>';
        }

        const regimes = d.regime_tributario || [];
        if (regimes.length) {
            h += `<div class="cip-card"><div class="cip-card-titulo">Regime tributário por ano</div>
                <div class="cip-tabela-wrap"><table class="cip-tabela"><thead><tr><th>Ano</th><th>Forma de tributação</th></tr></thead><tbody>`;
            regimes.slice().sort((a, b) => (b.ano || 0) - (a.ano || 0)).forEach(rt => {
                h += `<tr style="cursor:default;"><td>${esc(rt.ano)}</td><td>${esc(rt.forma_de_tributacao || '—')}</td></tr>`;
            });
            h += '</tbody></table></div></div>';
        }

        h += `<div style="font-size:11px;color:var(--p3-text-muted);padding:0 4px;">Fonte: BrasilAPI (dados públicos da Receita Federal).</div>`;
        return h;
    }
    async function buscarCnpjAcao() {
        const cnpj = document.getElementById('cip-input-cnpj').value.trim();
        const msg = document.getElementById('cip-status-msg');
        const resultado = document.getElementById('cip-resultado-cnpj');

        if (!cnpj) {
            msg.style.color = 'var(--p3-danger)';
            msg.textContent = 'Informe o CNPJ.';
            return;
        }
        if (!(await P3AtualizadorLocal.disponivel())) {
            document.getElementById('cip-aviso-servidor').style.display = 'block';
            return;
        }
        document.getElementById('cip-aviso-servidor').style.display = 'none';
        resultado.style.display = 'none';
        resultado.innerHTML = '';
        msg.style.color = 'var(--p3-text-muted)';
        msg.textContent = 'Buscando na BrasilAPI...';

        try {
            const r = await P3AtualizadorLocal.consultarCnpj(cnpj);
            if (!r.ok) {
                msg.style.color = 'var(--p3-danger)';
                msg.textContent = 'Erro: ' + (r.erro || 'falha desconhecida.');
                return;
            }
            if (!r.encontrado) {
                msg.style.color = 'var(--p3-text-muted)';
                msg.textContent = 'Nenhum CNPJ encontrado com esse número.';
                return;
            }
            msg.style.color = '#1e6b34';
            msg.textContent = 'CNPJ encontrado.';
            resultado.style.cssText = 'display:block;border:none;padding:0;background:none;';
            resultado.innerHTML = montarResultadoCnpjHtml(r.dados || {});
        } catch (e) {
            msg.style.color = 'var(--p3-danger)';
            msg.textContent = 'Erro: ' + e.message;
        }
    }

    // ────────────────────────────────────────────────────────────────
    // CABEÇALHO DA PESSOA
    // ────────────────────────────────────────────────────────────────
    // ────────────────────────────────────────────────────────────────
    // GALERIA DE FOTOS + LIGHTBOX — mostra TODAS as fotos encontradas
    // (não só a 1ª), cada uma clicável pra ampliar. Reaproveitada no
    // cabeçalho e na Visão Geral (mesmo HTML, tamanhos diferentes).
    // ────────────────────────────────────────────────────────────────
    function montarGaleriaFotosHtml(fotos, tamanhoPx) {
        if (!fotos || !fotos.length) {
            const fs = Math.round(tamanhoPx * 0.37);
            return `<div class="cip-foto-thumb" style="width:${tamanhoPx}px;height:${tamanhoPx}px;display:flex;align-items:center;justify-content:center;font-size:${fs}px;opacity:.4;cursor:default;">👤</div>`;
        }
        return fotos.map((f, i) => `<div class="cip-foto-thumb" style="width:${tamanhoPx}px;height:${tamanhoPx}px;" onclick="P3ConsultaPessoaAbrirFoto(${i})"><img src="${f}" alt="Foto ${i + 1}"></div>`).join('');
    }

    let LIGHTBOX_INDICE = 0;
    function atualizarLightbox() {
        const fotos = (ULTIMO_RESULTADO && ULTIMO_RESULTADO.fotos) || [];
        if (!fotos.length) return;
        document.getElementById('cip-lightbox-img').src = fotos[LIGHTBOX_INDICE];
        document.getElementById('cip-lightbox-contador').textContent = fotos.length > 1 ? `${LIGHTBOX_INDICE + 1} / ${fotos.length}` : '';
        const mostraNav = fotos.length > 1 ? 'flex' : 'none';
        document.getElementById('cip-lightbox-prev').style.display = mostraNav;
        document.getElementById('cip-lightbox-next').style.display = mostraNav;
    }
    function abrirLightbox(idx) {
        const fotos = (ULTIMO_RESULTADO && ULTIMO_RESULTADO.fotos) || [];
        if (!fotos.length) return;
        LIGHTBOX_INDICE = ((idx % fotos.length) + fotos.length) % fotos.length;
        atualizarLightbox();
        document.getElementById('cip-lightbox').classList.add('aberto');
    }
    function fecharLightbox() {
        document.getElementById('cip-lightbox').classList.remove('aberto');
    }
    function navegarLightbox(delta) {
        const fotos = (ULTIMO_RESULTADO && ULTIMO_RESULTADO.fotos) || [];
        if (!fotos.length) return;
        LIGHTBOX_INDICE = ((LIGHTBOX_INDICE + delta) % fotos.length + fotos.length) % fotos.length;
        atualizarLightbox();
    }
    document.addEventListener('keydown', function (e) {
        const lb = document.getElementById('cip-lightbox');
        if (!lb || !lb.classList.contains('aberto')) return;
        if (e.key === 'Escape') fecharLightbox();
        else if (e.key === 'ArrowLeft') navegarLightbox(-1);
        else if (e.key === 'ArrowRight') navegarLightbox(1);
    });
    window.P3ConsultaPessoaAbrirFoto = abrirLightbox;
    window.P3ConsultaPessoaFecharLightbox = fecharLightbox;
    window.P3ConsultaPessoaNavegarLightbox = navegarLightbox;

    // ────────────────────────────────────────────────────────────────
    // LAYOUT — "ficha lateral" (30/08/2026, escolha do usuário entre 3
    // opções apresentadas: sidebar fixa com identidade+navegação à
    // esquerda, todas as seções empilhadas e ancoradas à direita — ver
    // artefato "Layouts da Ficha Policial"). Sem abas escondendo
    // conteúdo: tudo fica no DOM ao mesmo tempo, a navegação lateral só
    // rola até a âncora (por isso ligarEventosPainelAtivo/
    // inicializarMapaOcorrencias agora rodam sempre, não só "se a aba X
    // estiver ativa" — não existe mais aba ativa).
    // ────────────────────────────────────────────────────────────────
    function renderizarHeader(r) {
        const p = r.pessoa;
        document.getElementById('cip-side-nome').textContent = (p && p.nome) || '(nome não encontrado)';
        document.getElementById('cip-side-cpf').textContent = 'CPF ' + formatarCpf(r.cpf);
        document.getElementById('cip-side-foto').innerHTML = montarGaleriaFotosHtml((r.fotos || []).slice(0, 1), 96);

        const factsEl = document.getElementById('cip-side-facts');
        const linhas = [
            ['Nascimento', (p && p.dataNascimento) || '—'],
            ['Mãe', (p && p.mae) || '—'],
            ['Pai', (p && p.pai) || '—'],
            ['RG', (p && p.rg) || '—'],
            ['Alcunha', (p && p.alcunha) || '—'],
        ];
        factsEl.innerHTML = linhas.map(([k, v]) => `<div><b>${esc(k)}:</b> ${esc(v)}</div>`).join('');

        const alertasEl = document.getElementById('cip-side-alertas');
        const alertas = [];
        if (r.mandados && r.mandados.possuiMandado) alertas.push('🚨 Mandado de prisão ativo');
        if (r.pessoasEncontradas && r.pessoasEncontradas.length > 1) {
            alertas.push(`⚠️ ${r.pessoasEncontradas.length} registros — possível duplicidade`);
        }
        alertasEl.innerHTML = alertas.map(a => `<div class="cip-side-alerta">${esc(a)}</div>`).join('');
    }

    // ────────────────────────────────────────────────────────────────
    // SEÇÕES — cada item vira 1 link na navegação lateral + 1 bloco
    // ancorado na coluna principal (ver renderizarTudo abaixo).
    // ────────────────────────────────────────────────────────────────
    const DEFINICAO_ABAS = [
        { id: 'visaogeral', label: '📊 Visão Geral', contar: r => null },
        { id: 'cnh', label: '🪪 CNH', contar: r => r.cnh ? 1 : 0 },
        { id: 'vinculos', label: '👪 Vínculos', contar: r => ((r.pessoa && (r.pessoa.mae || r.pessoa.pai)) ? 1 : 0) + (r.vinculosOcorrencia || []).length + ((r.inteligencia && r.inteligencia.vinculos) || []).length },
        { id: 'enderecos', label: '📍 Endereços', contar: r => montarEnderecos(r).length },
        { id: 'ocorrencias', label: '🚓 Ocorrências', contar: r => (r.ocorrenciasPpe || []).length + (r.ocorrenciasPcAntigo || []).length + (r.ocorrenciasDespacho || []).length },
        { id: 'mandados', label: '⛓️ BNMP', contar: r => (r.mandados && r.mandados.possuiMandado) ? 1 : 0 },
        { id: 'processos', label: '⚖️ Processos', contar: r => (r.processos || []).length },
        { id: 'veiculos', label: '🚗 Veículos', contar: r => (r.veiculos || []).length },
        { id: 'inteligencia', label: '🕵️ Inteligência', contar: r => r.inteligencia ? 1 : 0 },
        { id: 'orcrim', label: '🎯 ORCRIM', contar: r => ((r.inteligencia && r.inteligencia.orcrim) || []).length },
        { id: 'relint', label: '📋 RELINT', contar: r => ((r.inteligencia && r.inteligencia.relint) || []).length },
        { id: 'webmii', label: '🌐 Busca Web', contar: r => (r.webmii && r.webmii.resultados && r.webmii.resultados.length) || 0 },
        { id: 'timeline', label: '🕐 Linha do Tempo', contar: r => null },
        { id: 'fontes', label: '🔌 Fontes', contar: r => r.fontes.length },
    ];

    function renderizarTudo(r) {
        document.getElementById('cip-shell').style.display = 'flex';
        renderizarHeader(r);

        const navEl = document.getElementById('cip-side-nav');
        const mainEl = document.getElementById('cip-main');

        navEl.innerHTML = DEFINICAO_ABAS.map(a => {
            const n = a.contar(r);
            const badge = (n !== null) ? `<span class="cip-side-nav-badge">${n}</span>` : '';
            return `<a href="#cip-sec-${a.id}">${a.label}${badge}</a>`;
        }).join('');

        const renderers = {
            visaogeral: renderVisaoGeral, cnh: renderCnh, vinculos: renderVinculos,
            enderecos: renderEnderecos, ocorrencias: renderOcorrencias, mandados: renderMandados,
            processos: renderProcessos, veiculos: renderVeiculos, inteligencia: renderInteligencia,
            orcrim: renderOrcrim, relint: renderRelint, webmii: renderWebmii,
            timeline: renderTimeline, fontes: renderFontes,
        };
        mainEl.innerHTML = DEFINICAO_ABAS.map(a => `
            <section class="cip-sec" id="cip-sec-${a.id}">
                <h3 class="cip-sec-header">${a.label}</h3>
                ${(renderers[a.id] || (() => ''))(r)}
            </section>
        `).join('');

        // Religa os cliques de detalhe/expand depois de re-renderizar (o innerHTML acima apaga listeners antigos)
        // — agora sempre, pra TODAS as seções (não existe mais "só a aba ativa": tudo está no DOM ao mesmo tempo).
        ligarEventosPainelAtivo(r);
        inicializarMapaOcorrencias(r);
    }

    // Devolve a mensagem de erro da etapa (ver r.fontes — "fonte" bate
    // com o nome usado em consulta_pessoa_service.py), ou null se ela
    // não rodou/deu certo. Usado pra avisar na tela QUANDO/POR QUE a 2ª
    // fonte de foto (Quimera) não trouxe nada, em vez de só sumir sem
    // explicação (pedido explícito do usuário, 29/08/2026: "verifique a
    // questão da limitação de busca da imagem do idseg").
    function _cipErroDaFonte(r, nomeFonte) {
        const f = (r.fontes || []).find(x => x.fonte === nomeFonte);
        return (f && !f.ok) ? (f.erro || 'falha desconhecida') : null;
    }

    // ────────────────────────────────────────────────────────────────
    // VISÃO GERAL
    // ────────────────────────────────────────────────────────────────
    function renderVisaoGeral(r) {
        const p = r.pessoa || {};
        const totalOcor = (r.ocorrenciasPpe || []).length + (r.ocorrenciasPcAntigo || []).length + (r.ocorrenciasDespacho || []).length;

        // Foto(s) + nome completo (pedido explícito do usuário) — TODAS
        // as fotos encontradas (não só a 1ª), cada uma clicável pra
        // ampliar (ver montarGaleriaFotosHtml/lightbox); sem foto
        // nenhuma, fica um espaço reservado em vez de não mostrar nada.
        let h = '<div class="cip-card" style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;">';
        h += `<div style="display:flex;gap:8px;flex-wrap:wrap;max-width:460px;">${montarGaleriaFotosHtml(r.fotos, 140)}</div>`;
        h += `<div><div style="font-size:17px;font-weight:700;color:var(--p3-text);">${esc(p.nome || '(nome não encontrado)')}</div>
              <div style="font-size:12px;color:var(--p3-text-muted);margin-top:3px;">CPF ${esc(formatarCpf(r.cpf))}${p.dataNascimento ? ' · Nascimento ' + esc(p.dataNascimento) : ''}</div>
              ${r.fotos && r.fotos.length > 1 ? `<div style="font-size:11px;color:var(--p3-text-muted);margin-top:6px;">${r.fotos.length} fotos encontradas — clique pra ampliar</div>` : ''}</div>`;
        h += '</div>';

        const erroIdseg = _cipErroDaFonte(r, 'Foto (2ª fonte)');
        if (erroIdseg) {
            h += `<div class="cip-card" style="border-color:#f0d98a;background:#fff8e6;color:#8a6100;font-size:12px;">
                ⚠️ <b>2ª fonte de foto (Quimera) indisponível:</b> ${esc(erroIdseg)}
                <div style="margin-top:4px;">Renove o código de 6 dígitos em <b>🔑 Configurar acesso</b> — ele expira em poucas horas.</div>
            </div>`;
        } else if (r.fotoQuimera && r.fotoQuimera.consultado && !r.fotoQuimera.temFoto) {
            // INFORMA explicitamente quando não há foto (31/08/2026,
            // pedido explícito do usuário: "caso não haja foto registrada
            // informe") — antes disso, esse caso era IDÊNTICO na tela a
            // "nem consultou" (as duas situações mostravam nada). O
            // resultado final da consulta SÓ chega aqui depois que o
            // Quimera já respondeu (a consulta inteira é 1 stream que só
            // resolve no fim — ver consultarPessoaStream em
            // atualizador-local.js), então nunca mostra a tela "cedo
            // demais", antes do Quimera terminar de responder.
            const motivo = r.fotoQuimera.motivo === 'pessoa_nao_encontrada'
                ? 'esta pessoa não foi encontrada no cadastro do Quimera.'
                : 'a pessoa foi encontrada no Quimera, mas não tem foto cadastrada lá.';
            h += `<div class="cip-card" style="font-size:12px;color:var(--p3-text-muted);">
                ℹ️ <b>2ª fonte de foto (Quimera) consultada:</b> ${motivo}
            </div>`;
        }

        const kpis = [
            ['🚓', totalOcor, 'Ocorrências'],
            ['⚖️', (r.processos || []).length, 'Processos'],
            ['🚗', (r.veiculos || []).length, 'Veículos (via ocorrências)'],
            ['📍', montarEnderecos(r).length, 'Endereços'],
            ['🔌', r.fontes.filter(f => f.ok).length + '/' + r.fontes.length, 'Etapas concluídas'],
        ];
        h += '<div class="cip-card"><div class="cip-card-titulo">Resumo</div>';
        h += '<div style="display:flex;gap:14px;flex-wrap:wrap;">';
        kpis.forEach(([ic, n, l]) => {
            h += `<div style="flex:1;min-width:140px;background:var(--p3-bg);border-radius:8px;padding:12px 16px;">
                <div style="font-size:22px;">${ic}</div>
                <div style="font-size:22px;font-weight:800;color:var(--p3-blue-700);">${n}</div>
                <div style="font-size:11px;color:var(--p3-text-muted);text-transform:uppercase;">${esc(l)}</div>
            </div>`;
        });
        h += '</div></div>';
        h += `<div class="cip-card" style="font-size:12.5px;color:var(--p3-text-muted);">
            Este painel é <strong>informativo e investigativo</strong> — mostra quantidade de ocorrências e
            relações encontradas, não representa risco/culpabilidade nem conclusão automática.
        </div>`;
        return h;
    }

    // ────────────────────────────────────────────────────────────────
    // CNH
    // ────────────────────────────────────────────────────────────────
    function renderCnh(r) {
        if (!r.cnh) return '<div class="cip-vazio">Nenhum dado de CNH encontrado pra este CPF.</div>';
        const h = Object.entries(r.cnh).map(([k, v]) =>
            `<div><b>${esc(k)}:</b> ${esc(v || '—')}</div>`).join('');
        return `<div class="cip-card"><div class="cip-card-titulo">CNH</div>
            <div class="cip-kv">${h}</div></div>`;
    }

    // Diagrama de rede simples (SVG puro, sem biblioteca externa) —
    // pessoa consultada no centro, vínculos cadastrados no Supabase ao
    // redor, ligados por linha com o tipo do vínculo. Pedido explícito
    // do usuário (29/08/2026): "vínculos... em modelo de rede".
    //
    // CORREÇÃO (29/08/2026, relatado pelo usuário: "não está clicável e
    // não consigo ver os detalhes que eu pedi como estava anteriormente.
    // ao invés de arvore faça como uma rede"):
    //   1) Espaçamento angular UNIFORME (2π/n) fazia 2 vínculos caírem
    //      exatamente em lados opostos (linha reta vertical) — visual de
    //      "árvore"/organograma, não de rede. Trocado pelo ÂNGULO DE
    //      OURO (~137,5°), técnica de distribuição orgânica (mesma usada
    //      em phyllotaxis) que nunca cai em posições simétricas/opostas,
    //      não importa o total de nós.
    //   2) Só nós com CPF eram clicáveis (iam direto pra outra consulta,
    //      sem mostrar nada antes) — agora TODOS os nós são clicáveis e
    //      abrem um cartão de detalhe (nome completo, CPF, RG, data de
    //      nasc., mãe, pai, tipo/subtipo do vínculo, nível de confiança,
    //      observação — ver buscar_vinculos_pessoa em supabase_intel.py,
    //      que agora devolve todos esses campos, não só nome/cpf/tipo).
    //      Consultar o CPF vira uma ação EXPLÍCITA dentro do cartão (botão
    //      "🔍 Consultar este CPF"), só quando há CPF.
    function primeiroNome(nomeCompleto) {
        return String(nomeCompleto || '').trim().split(/\s+/)[0] || '?';
    }
    const _CIP_ANGULO_OURO = 2.399963229728653; // ~137,5° em radianos
    function montarRedeVinculosHtml(nomeCentral, vinculos) {
        if (!vinculos || !vinculos.length) return '';
        const n = vinculos.length;
        const W = 640, H = Math.max(340, 130 + n * 42);
        const cx = W / 2, cy = H / 2;
        const R = Math.min(W, H) / 2 - 90;
        let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;max-height:520px;display:block;" xmlns="http://www.w3.org/2000/svg">`;
        vinculos.forEach((v, i) => {
            const ang = i * _CIP_ANGULO_OURO;
            const x = cx + R * Math.cos(ang), y = cy + R * Math.sin(ang);
            const mx = cx + (R * 0.55) * Math.cos(ang), my = cy + (R * 0.55) * Math.sin(ang);
            svg += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="var(--p3-border)" stroke-width="1.5" />`;
            svg += `<rect x="${mx - 36}" y="${my - 9}" width="72" height="18" rx="9" fill="var(--p3-bg)" />`;
            svg += `<text x="${mx}" y="${my + 4}" text-anchor="middle" font-size="9" fill="var(--p3-text-muted)">${esc((v.tipo || 'vínculo').slice(0, 14))}</text>`;
        });
        svg += `<circle cx="${cx}" cy="${cy}" r="34" fill="var(--p3-blue-700)" /><text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">${esc(primeiroNome(nomeCentral))}</text>`;
        vinculos.forEach((v, i) => {
            const ang = i * _CIP_ANGULO_OURO;
            const x = cx + R * Math.cos(ang), y = cy + R * Math.sin(ang);
            svg += `<g class="cip-rede-no" data-idx="${i}" style="cursor:pointer;">
                <title>${esc(v.nome)} — clique pra ver os detalhes</title>
                <circle cx="${x}" cy="${y}" r="26" fill="var(--p3-surface)" stroke="var(--p3-border)" stroke-width="1.5" />
                <text x="${x}" y="${y + 4}" text-anchor="middle" font-size="9" fill="var(--p3-text)">${esc(primeiroNome(v.nome).slice(0, 10))}</text>
            </g>`;
        });
        svg += '</svg>';
        return `<div>${svg}<div id="cip-rede-detalhe" style="margin-top:8px;padding:12px 14px;border:1px dashed var(--p3-border);border-radius:8px;font-size:12px;color:var(--p3-text-muted);">👆 Clique num nome do diagrama pra ver os detalhes do vínculo.</div></div>`;
    }

    // Cartão de detalhe mostrado abaixo do diagrama ao clicar num nó —
    // ver montarRedeVinculosHtml acima e a religação de clique em
    // ligarEventosPainelAtivo.
    function montarDetalheNoRedeHtml(v) {
        const cpfLimpo = limparCpf(v.cpf);
        let h = '<div>';
        h += `<div style="font-weight:700;font-size:14px;color:var(--p3-text);margin-bottom:6px;">${esc(v.nome || 'Sem nome')}</div>`;
        h += montarHtmlDetalheCampos({
            'CPF': cpfLimpo ? formatarCpf(cpfLimpo) : 'Não informado',
            'RG': v.rg,
            'Data de nascimento': v.dataNascimento,
            'Mãe': v.mae,
            'Pai': v.pai,
            'Tipo de vínculo': [v.tipo, v.subtipo].filter(Boolean).join(' — '),
            'Nível de confiança': v.nivelConfianca,
            'Observação': v.observacao,
        });
        if (cpfLimpo) {
            h += `<button type="button" class="cip-rede-btn-consultar" data-cpf="${esc(cpfLimpo)}"
                style="margin-top:10px;padding:7px 14px;border:none;border-radius:6px;background:var(--p3-blue-700);color:#fff;font-size:12.5px;font-weight:600;cursor:pointer;">
                🔍 Consultar este CPF
            </button>`;
        } else {
            h += '<div style="font-size:11px;color:var(--p3-text-muted);margin-top:8px;">Sem CPF cadastrado — não é possível abrir a consulta completa dessa pessoa.</div>';
        }
        h += '</div>';
        return h;
    }

    // ────────────────────────────────────────────────────────────────
    // MODAL DE ENDEREÇO — mapa + rede de pessoas (30/08/2026, pedido
    // explícito do usuário: "crie... um mapa em modal com o endereço e
    // todas as pessoas vinculadas em nós", depois ajustado pra incluir
    // TODAS as pessoas que bateram no mesmo endereço aproximado, não só
    // a pessoa consultada — ver buscar_enderecos_aproximados_pessoa em
    // supabase_intel.py. Reaproveita o MESMO padrão de rede (ângulo de
    // ouro) de montarRedeVinculosHtml acima, só que o nó central é o
    // 📍 endereço em vez da pessoa, e o mapa é o mesmo Leaflet da aba
    // Ocorrências (ver carregarLeafletSeNecessario/inicializarMapaOcorrencias
    // mais abaixo no arquivo).
    // ────────────────────────────────────────────────────────────────
    let CIP_ENDERECO_MODAL_ATUAL = null;
    function montarRedeEnderecoHtml(pessoas) {
        if (!pessoas || !pessoas.length) {
            return '<div style="font-size:12px;color:var(--p3-text-muted);">Nenhuma pessoa encontrada nesse endereço.</div>';
        }
        const n = pessoas.length;
        const W = 640, H = Math.max(320, 120 + n * 40);
        const cx = W / 2, cy = H / 2;
        const R = Math.min(W, H) / 2 - 80;
        let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;max-height:460px;display:block;" xmlns="http://www.w3.org/2000/svg">`;
        pessoas.forEach((p, i) => {
            const ang = i * _CIP_ANGULO_OURO;
            const x = cx + R * Math.cos(ang), y = cy + R * Math.sin(ang);
            svg += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="var(--p3-border)" stroke-width="1.5" />`;
        });
        svg += `<circle cx="${cx}" cy="${cy}" r="30" fill="var(--p3-blue-700)" /><text x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="18">📍</text>`;
        pessoas.forEach((p, i) => {
            const ang = i * _CIP_ANGULO_OURO;
            const x = cx + R * Math.cos(ang), y = cy + R * Math.sin(ang);
            svg += `<g class="cip-rede-no cip-rede-endereco-no" data-idx="${i}" style="cursor:pointer;">
                <title>${esc(p.nome)} — clique pra ver os detalhes</title>
                <circle cx="${x}" cy="${y}" r="26" fill="var(--p3-surface)" stroke="var(--p3-border)" stroke-width="1.5" />
                <text x="${x}" y="${y + 4}" text-anchor="middle" font-size="9" fill="var(--p3-text)">${esc(primeiroNome(p.nome).slice(0, 10))}</text>
            </g>`;
        });
        svg += '</svg>';
        return `<div>${svg}<div id="cip-me-detalhe" style="margin-top:8px;padding:12px 14px;border:1px dashed var(--p3-border);border-radius:8px;font-size:12px;color:var(--p3-text-muted);">👆 Clique num nome do diagrama pra ver os detalhes.</div></div>`;
    }

    function _cipMontarDetalhePessoaEndereco(p) {
        const cpfLimpo = limparCpf(p.cpf);
        let h = `<div style="font-weight:700;font-size:14px;color:var(--p3-text);margin-bottom:6px;">${esc(p.nome || 'Sem nome')}</div>`;
        h += montarHtmlDetalheCampos({
            'CPF': cpfLimpo ? formatarCpf(cpfLimpo) : 'Não informado',
            'Encontrado por': p.correspondenciaPor,
            'Tipo de denúncia': p.tipoDenuncia,
            'Data da denúncia': p.dataDenuncia,
        });
        if (cpfLimpo) {
            h += `<button type="button" class="cip-rede-btn-consultar" data-cpf="${esc(cpfLimpo)}"
                style="margin-top:10px;padding:7px 14px;border:none;border-radius:6px;background:var(--p3-blue-700);color:#fff;font-size:12.5px;font-weight:600;cursor:pointer;">
                🔍 Consultar este CPF
            </button>`;
        } else {
            h += '<div style="font-size:11px;color:var(--p3-text-muted);margin-top:8px;">Sem CPF cadastrado — não é possível abrir a consulta completa dessa pessoa.</div>';
        }
        return h;
    }

    function abrirModalEndereco(e) {
        CIP_ENDERECO_MODAL_ATUAL = e;
        document.getElementById('cip-me-titulo').textContent = e.endereco || 'Endereço';
        document.getElementById('cip-me-rede').innerHTML = montarRedeEnderecoHtml(e.pessoas);
        document.getElementById('cip-modal-endereco').classList.add('aberto');

        const mapaEl = document.getElementById('cip-me-mapa');
        const lat = _parseCoordBr(e.latitude), lng = _parseCoordBr(e.longitude);
        if (lat !== null && lng !== null) {
            mapaEl.style.cssText = 'height:280px;border-radius:10px;margin-bottom:14px;';
            carregarLeafletSeNecessario(() => {
                mapaEl.innerHTML = '';
                const mapa = L.map('cip-me-mapa').setView([lat, lng], 16);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(mapa);
                L.marker([lat, lng]).addTo(mapa).bindPopup(esc(e.endereco)).openPopup();
                setTimeout(() => mapa.invalidateSize(), 80); // modal recém aberto — tamanho pode vir errado sem isso
            });
        } else {
            mapaEl.innerHTML = 'Sem coordenadas cadastradas pra este endereço.';
            mapaEl.style.cssText = 'height:120px;border-radius:10px;margin-bottom:14px;display:flex;align-items:center;justify-content:center;background:var(--p3-bg);color:var(--p3-text-muted);font-size:12.5px;text-align:center;padding:0 20px;';
        }

        document.querySelectorAll('.cip-rede-endereco-no').forEach(no => {
            no.addEventListener('click', () => {
                const i = Number(no.dataset.idx);
                const p = ((CIP_ENDERECO_MODAL_ATUAL && CIP_ENDERECO_MODAL_ATUAL.pessoas) || [])[i];
                const detalheEl = document.getElementById('cip-me-detalhe');
                if (!detalheEl || !p) return;
                detalheEl.style.border = 'none';
                detalheEl.innerHTML = _cipMontarDetalhePessoaEndereco(p);
                const btnConsultar = detalheEl.querySelector('.cip-rede-btn-consultar');
                if (btnConsultar) btnConsultar.addEventListener('click', () => P3ConsultaPessoaAbrirCpf(btnConsultar.dataset.cpf));
            });
        });
    }
    function fecharModalEndereco() {
        document.getElementById('cip-modal-endereco').classList.remove('aberto');
    }
    window.P3ConsultaPessoaFecharModalEndereco = fecharModalEndereco;

    // Agrupa vínculos de ocorrência pelo papel (campo "Envolvimento" do
    // próprio CAD) — 01/09/2026, pedido explícito do usuário: "vinculos
    // (ocorrências) esses vinculos são os descritos nas ocorrências:
    // vítima, testemunha, autor, outros, condutor do veiculo". O CAD não
    // garante que o texto exato seja sempre uma dessas 5 palavras (pode
    // vir "Autor(a)", "Condutor do Veículo", etc.), então a ordenação
    // abaixo só usa essa lista como PRIORIDADE de exibição (por
    // correspondência parcial, sem acento) — o rótulo original do CAD é
    // sempre preservado no título do grupo, nunca reescrito/adivinhado.
    const _PRIORIDADE_ENVOLVIMENTO = ['VITIMA', 'TESTEMUNHA', 'AUTOR', 'CONDUTOR', 'OUTROS'];
    function _cipSemAcento(s) {
        return String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    }
    function _cipPrioridadeEnvolvimento(tipo) {
        const norm = _cipSemAcento(tipo) || 'OUTROS';
        const idx = _PRIORIDADE_ENVOLVIMENTO.findIndex(p => norm.includes(p));
        return idx === -1 ? _PRIORIDADE_ENVOLVIMENTO.length : idx;
    }
    function montarVinculosOcorrenciaAgrupadosHtml(vinculosOc) {
        const grupos = new Map(); // rótulo original do CAD -> [vínculos]
        vinculosOc.forEach(v => {
            const rotulo = v.tipoEnvolvimento || 'Outros';
            if (!grupos.has(rotulo)) grupos.set(rotulo, []);
            grupos.get(rotulo).push(v);
        });
        const rotulosOrdenados = Array.from(grupos.keys()).sort((a, b) => {
            const dif = _cipPrioridadeEnvolvimento(a) - _cipPrioridadeEnvolvimento(b);
            return dif !== 0 ? dif : a.localeCompare(b, 'pt-BR');
        });
        let h = '';
        rotulosOrdenados.forEach(rotulo => {
            const lista = grupos.get(rotulo);
            h += `<div class="cip-vinculos-grupo" style="margin-bottom:14px;">
                <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:var(--p3-text-muted);margin-bottom:6px;">${esc(rotulo)} — ${lista.length}</div>
                <div class="cip-tabela-wrap"><table class="cip-tabela"><thead><tr><th>Nome completo</th><th>CPF</th><th>Nº COP</th><th>Data</th><th>Tipificação</th></tr></thead><tbody>`;
            lista.forEach(v => {
                const clicavel = !!v.cpf;
                h += `<tr ${clicavel ? `onclick="P3ConsultaPessoaAbrirCpf('${v.cpf}')" title="Clique pra consultar essa pessoa"` : 'style="cursor:default;" title="CPF não disponível"'}>
                    <td>${clicavel ? `<span class="cip-pessoa-link">${esc(v.nome)}</span>` : esc(v.nome)}</td>
                    <td style="white-space:nowrap;">${v.cpf ? esc(formatarCpf(limparCpf(v.cpf))) : '—'}</td>
                    <td>${esc(v.numeroOcorrencia || '—')}</td>
                    <td style="white-space:nowrap;">${esc(v.data || '—')}</td>
                    <td>${esc(v.tipificacao || '—')}</td>
                </tr>`;
            });
            h += '</tbody></table></div></div>';
        });
        return h;
    }

    // ────────────────────────────────────────────────────────────────
    // VÍNCULOS — filiação (mãe/pai, ver nota de simplificação no topo do
    // arquivo — sem CPF, não clicável) + vínculos por OCORRÊNCIA (outras
    // pessoas na(s) mesma(s) ocorrência(s), com CPF — essas sim
    // clicáveis, ver P3ConsultaPessoaAbrirCpf), agrupados por papel
    // (Vítima/Testemunha/Autor/Condutor/Outros, ver
    // montarVinculosOcorrenciaAgrupadosHtml) + vínculos CADASTRADOS no
    // Supabase (rede/árvore, ver montarRedeVinculosHtml).
    // ────────────────────────────────────────────────────────────────
    function renderVinculos(r) {
        const p = r.pessoa;
        const vinculosOc = r.vinculosOcorrencia || [];
        let h = '';

        if (p && (p.mae || p.pai)) {
            // Mãe/pai clicáveis (30/08/2026, pedido explícito do usuário)
            // — o CAD não devolve o CPF deles, só o nome, então o clique
            // busca essa pessoa PELO NOME (ver buscarEAbrirPorNome) em vez
            // de abrir direto por CPF — se achar 1 só com CPF, já abre a
            // consulta completa; se achar mais de 1 (homônimos), mostra a
            // lista pra escolher.
            h += '<div class="cip-card"><div class="cip-card-titulo">Filiação</div><div class="cip-kv">';
            if (p.mae) h += `<div><b>Mãe:</b> <span class="cip-pessoa-link" onclick="P3ConsultaPessoaAbrirPorNome('${esc(p.mae).replace(/'/g, "\\'")}')" title="Buscar essa pessoa pelo nome">${esc(p.mae)}</span></div>`;
            if (p.pai) h += `<div><b>Pai:</b> <span class="cip-pessoa-link" onclick="P3ConsultaPessoaAbrirPorNome('${esc(p.pai).replace(/'/g, "\\'")}')" title="Buscar essa pessoa pelo nome">${esc(p.pai)}</span></div>`;
            h += '</div><p style="font-size:11.5px;color:var(--p3-text-muted);margin-top:10px;">O CAD não devolve o CPF da mãe/pai — clicar no nome faz uma busca por nome (pode haver homônimos).</p></div>';
        }

        if (vinculosOc.length) {
            h += `<div class="cip-card"><div class="cip-card-titulo">Vínculos por ocorrência — ${vinculosOc.length}</div>
                <p style="font-size:11.5px;color:var(--p3-text-muted);margin-bottom:10px;">
                    Pessoas que apareceram na(s) mesma(s) ocorrência(s) que esta, agrupadas pelo papel que tiveram
                    (Envolvimento, campo do próprio CAD) — linhas com CPF são clicáveis pra consultar a pessoa
                    diretamente. Só cobre as ocorrências que já tiveram o detalhe carregado automaticamente (as
                    mais recentes).
                </p>`;
            h += montarVinculosOcorrenciaAgrupadosHtml(vinculosOc);
            h += '</div>';
        }

        const vinculosSb = (r.inteligencia && r.inteligencia.vinculos) || [];
        if (vinculosSb.length) {
            h += `<div class="cip-card"><div class="cip-card-titulo">Vínculos cadastrados — ${vinculosSb.length}</div>
                <p style="font-size:11.5px;color:var(--p3-text-muted);margin-bottom:10px;">
                    Já investigados e registrados pela própria unidade — clique num nome com CPF pra consultar essa
                    pessoa.
                </p>
                ${montarRedeVinculosHtml((r.pessoa && r.pessoa.nome) || esc(formatarCpf(r.cpf)), vinculosSb)}
            </div>`;
        }

        if (!h) return '<div class="cip-vazio">Nenhum vínculo encontrado.</div>';
        return h;
    }

    // ────────────────────────────────────────────────────────────────
    // ENDEREÇOS — consolidados de TODAS as fontes que trazem campo de
    // endereço: identificação civil (com data — a mais completa) e CNH.
    // Busca a CHAVE do campo por regex (contém "endere") em vez de um
    // nome fixo — mais tolerante a variações de acento/grafia entre as
    // fontes (ex.: "Endereço" vs "Endereco") do que comparar string
    // exata. Dedup por texto normalizado.
    // ────────────────────────────────────────────────────────────────
    function normalizarEndereco(s) {
        return String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
    }
    function extrairCampoEndereco(obj) {
        if (!obj) return null;
        const chave = Object.keys(obj).find(k => /endere/i.test(k));
        return chave ? obj[chave] : null;
    }
    function montarEnderecos(r) {
        const vistos = new Set();
        const lista = [];
        function adicionar(end, data, extra) {
            if (!end) return;
            const chave = normalizarEndereco(end);
            if (vistos.has(chave)) return;
            vistos.add(chave);
            lista.push(Object.assign({ endereco: end, data: data || null }, extra || {}));
        }
        (r.idnet || []).forEach(reg => adicionar(extrairCampoEndereco(reg), reg['Data de Atendimento no IC']));
        adicionar(extrairCampoEndereco(r.cnh), null);
        // Equatorial Alagoas (30/08/2026, ver buscarEquatorialAcao) — só
        // populado depois que o usuário usa o botão "Buscar unidade
        // consumidora" nessa mesma aba, então normalmente vem vazio.
        (r.enderecosEquatorial || []).forEach(e => adicionar(e.endereco, null, { origem: 'Equatorial', uc: e.uc, pontoReferencia: e.pontoReferencia }));
        return lista;
    }
    // Endereços APROXIMADOS (Supabase, ver buscar_enderecos_aproximados_pessoa
    // em supabase_intel.py) — correspondência por TEXTO entre o nome/apelido
    // desta pessoa e denúncias que citam um endereço catalogado, nunca uma
    // FK direta (o schema não tem uma). Cada item abre o modal de mapa+rede
    // (ver abrirModalEndereco acima) com TODAS as pessoas encontradas nesse
    // MESMO endereço — pedido explícito do usuário (30/08/2026): "lembrando
    // de colocar também nesse mesmo mapa os vínculos, ou seja, outras
    // pessoas que tenham o endereço aproximado também tenham aparecido."
    function renderEnderecosAproximados(r) {
        const lista = (r.inteligencia && r.inteligencia.enderecosAproximados) || [];
        if (!lista.length) return '';
        let h = `<div class="cip-card"><div class="cip-card-titulo">Endereços aproximados (Supabase) — ${lista.length}</div>
            <p style="font-size:11.5px;color:var(--p3-text-muted);margin-bottom:10px;">
                Correspondência POR TEXTO entre o nome/apelido desta pessoa e denúncias que citam um endereço — não é
                um vínculo formal no banco. Clique num endereço pra ver o mapa e as outras pessoas encontradas na(s)
                mesma(s) denúncia(s).
            </p>`;
        lista.forEach((e, i) => {
            h += `<div class="cip-endereco-aprox" data-idx="${i}" style="padding:10px 12px;border-radius:8px;cursor:pointer;background:var(--p3-bg);${i > 0 ? 'margin-top:6px;' : ''}" title="Clique pra ver no mapa">
                <div style="font-size:13px;color:var(--p3-blue-700);font-weight:600;">📍 ${esc(e.endereco)}</div>
                <div style="font-size:11px;color:var(--p3-text-muted);margin-top:2px;">${e.pessoas.length} pessoa(s) encontrada(s) nesse endereço</div>
            </div>`;
        });
        h += '</div>';
        return h;
    }

    function renderEnderecos(r) {
        const lista = montarEnderecos(r);
        // Mais recente primeiro — data no formato DD/MM/AAAA HH:MM:SS
        lista.sort((a, b) => {
            const da = a.data ? a.data.split(' ')[0].split('/').reverse().join('') : '';
            const db = b.data ? b.data.split(' ')[0].split('/').reverse().join('') : '';
            return db.localeCompare(da);
        });

        let h = '<div class="cip-card">';
        h += `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:${lista.length ? '12px' : '0'};">
            <div class="cip-card-titulo" style="margin:0;">Endereços</div>
            <div>
                <button type="button" id="cip-btn-equatorial" style="padding:7px 14px;border:none;border-radius:6px;background:var(--p3-blue-700);color:#fff;font-size:12px;font-weight:600;cursor:pointer;">🔌 Buscar unidade consumidora (Equatorial)</button>
                <div id="cip-equatorial-status" style="font-size:11px;color:var(--p3-text-muted);margin-top:5px;text-align:right;"></div>
            </div>
        </div>`;
        if (!lista.length) {
            h += '<div class="cip-vazio" style="padding:14px 0;">Nenhum endereço encontrado.</div>';
        }
        lista.forEach((e, i) => {
            let rodape;
            if (e.origem === 'Equatorial') {
                rodape = 'Fonte: Equatorial Alagoas' + (e.uc ? ' · UC ' + esc(e.uc) : '') + (e.pontoReferencia ? ' · Ref.: ' + esc(e.pontoReferencia) : '');
            } else {
                rodape = e.data ? 'Identificado em ' + esc(e.data) : 'Sem data';
            }
            h += `<div style="padding:8px 0;${i > 0 ? 'border-top:1px dashed var(--p3-border);' : ''}">
                <div style="font-size:13px;color:var(--p3-text);">${esc(e.endereco)}</div>
                <div style="font-size:11px;color:var(--p3-text-muted);margin-top:2px;">${rodape}</div>
            </div>`;
        });
        h += '</div>';
        h += renderEnderecosAproximados(r);
        return h;
    }

    // Botão "Buscar unidade consumidora (Equatorial)" na aba Endereços
    // (30/08/2026) — SÓ manual, de propósito: um disparo automático a
    // cada consulta chegou a deixar uma janela presa/invisível numa
    // sessão real (travando a trava global do lado do Python — ver
    // _LOCK_JANELA em equatorial_popup.py — sem nenhuma janela visível
    // pra fechar), pedido explícito do usuário: "não abra
    // automaticamente, deixe somente quando clicar". Abre uma janela de
    // navegador de VERDADE (só funciona dentro do app desktop) já com
    // CPF/data de nascimento preenchidos; o próprio usuário clica em
    // "Entrar" na janela e resolve o captcha lá se aparecer — esta
    // função só espera o resultado (pode levar minutos) e soma os
    // endereços encontrados à lista já existente.
    async function buscarEquatorialAcao(r) {
        const btn = document.getElementById('cip-btn-equatorial');
        const status = document.getElementById('cip-equatorial-status');
        if (!btn || !status) return;
        btn.disabled = true;
        status.style.color = 'var(--p3-text-muted)';
        status.textContent = '🪟 Abrindo janela da Equatorial — clique em "Entrar" lá quando estiver pronto...';
        try {
            const dataNasc = (r.pessoa && r.pessoa.dataNascimento) || '';
            const resp = await P3AtualizadorLocal.equatorialConsultar(r.cpf, dataNasc);
            if (!resp.ok) {
                btn.disabled = false;
                status.style.color = 'var(--p3-danger)';
                status.textContent = 'Erro: ' + (resp.erro || 'falha desconhecida.');
                return;
            }
            r.enderecosEquatorial = (r.enderecosEquatorial || []).concat(resp.enderecos || []);
            renderizarTudo(r); // reconstrói a seção já com os endereços novos na lista
        } catch (e) {
            btn.disabled = false;
            status.style.color = 'var(--p3-danger)';
            status.textContent = 'Erro de conexão: ' + e.message;
        }
    }

    // ────────────────────────────────────────────────────────────────
    // MAPA DAS OCORRÊNCIAS — Leaflet + OpenStreetMap (mesma biblioteca
    // já usada em page/mapaInteligencia.html — grátis, sem chave de
    // API). Coordenadas vêm do detalhe já carregado automaticamente
    // (r.detalhesOcorrencias[i].campos — "Latitude"/"Longitude", com
    // fallback pras coordenadas "...pelo Quimera" quando as
    // principais vêm vazias, confirmado em captura real).
    // ────────────────────────────────────────────────────────────────
    function _parseCoordBr(s) {
        const n = parseFloat(String(s || '').replace(',', '.').trim());
        return isFinite(n) && n !== 0 ? n : null;
    }
    function extrairCoordenadasOcorrencias(r) {
        const despc = r.ocorrenciasDespacho || [];
        const detalhesPorId = {};
        (r.detalhesOcorrencias || []).forEach(d => { detalhesPorId[d.idOcorrencia] = d; });
        const pontos = [];
        despc.forEach(o => {
            const det = detalhesPorId[o._id_ocor];
            if (!det || !det.campos) return;
            const c = det.campos;
            const lat = _parseCoordBr(c['Latitude']) || _parseCoordBr(c['Latitude pelo Quimera']);
            const lng = _parseCoordBr(c['Longitude']) || _parseCoordBr(c['Longitude pelo Quimera']);
            if (lat === null || lng === null) return;
            pontos.push({
                lat, lng,
                numero: o.id_ocor_fk || o._id_ocor || '—',
                natureza: o.ds_ocor_sgrup || '—',
                data: o.dt_ocor || '—',
            });
        });
        return pontos;
    }

    let _mapaOcorrenciasCarregando = null;
    function carregarLeafletSeNecessario(callback) {
        if (window.L) { callback(); return; }
        if (_mapaOcorrenciasCarregando) { _mapaOcorrenciasCarregando.then(callback); return; }
        _mapaOcorrenciasCarregando = new Promise(resolve => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
            document.head.appendChild(link);
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
            script.onload = resolve;
            document.head.appendChild(script);
        });
        _mapaOcorrenciasCarregando.then(callback);
    }
    function inicializarMapaOcorrencias(r) {
        const container = document.getElementById('cip-mapa-ocorrencias');
        if (!container) return;
        const pontos = extrairCoordenadasOcorrencias(r);
        if (!pontos.length) return;
        carregarLeafletSeNecessario(() => {
            // A aba pode ter mudado enquanto o Leaflet carregava — confere de novo.
            if (!document.getElementById('cip-mapa-ocorrencias')) return;
            const mapa = L.map('cip-mapa-ocorrencias').setView([pontos[0].lat, pontos[0].lng], 12);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap',
            }).addTo(mapa);
            const grupo = [];
            pontos.forEach(p => {
                const marcador = L.marker([p.lat, p.lng]).addTo(mapa);
                marcador.bindPopup(`<b>${esc(p.numero)}</b><br>${esc(p.natureza)}<br><span style="color:#888;font-size:11px;">${esc(p.data)}</span>`);
                grupo.push(marcador);
            });
            if (grupo.length > 1) mapa.fitBounds(L.featureGroup(grupo).getBounds().pad(0.2));
        });
    }

    // ────────────────────────────────────────────────────────────────
    // OCORRÊNCIAS — 3 fontes juntas, cada linha clicável (detalhe sob
    // demanda pra PPE/PC-antigo; SISPOL já tem detalhe pronto pras N
    // mais recentes — ver LIMITE_DETALHE_AUTOMATICO no Python).
    // ────────────────────────────────────────────────────────────────
    function renderOcorrencias(r) {
        const ppe = r.ocorrenciasPpe || [];
        const pcAntigo = r.ocorrenciasPcAntigo || [];
        const despc = r.ocorrenciasDespacho || [];
        if (!ppe.length && !pcAntigo.length && !despc.length) {
            return '<div class="cip-vazio">Nenhuma ocorrência encontrada.</div>';
        }

        let h = '';
        const pontosMapa = extrairCoordenadasOcorrencias(r);
        if (pontosMapa.length) {
            h += `<div class="cip-card"><div class="cip-card-titulo">Mapa das ocorrências — ${pontosMapa.length} com localização</div>
                <div id="cip-mapa-ocorrencias" style="height:320px;border-radius:10px;"></div></div>`;
        }
        if (despc.length) {
            h += `<div class="cip-card"><div class="cip-card-titulo">Ocorrências — ${despc.length}</div>${tabelaOcorrenciasDespc(r, despc)}</div>`;
        }
        if (ppe.length) {
            h += `<div class="cip-card"><div class="cip-card-titulo">Ocorrências policiais — ${ppe.length}</div>${tabelaOcorrenciasPpe(ppe)}</div>`;
        }
        if (pcAntigo.length) {
            h += `<div class="cip-card"><div class="cip-card-titulo">Registros anteriores — ${pcAntigo.length} boletim(ns)</div>${tabelaOcorrenciasPcAntigo(pcAntigo)}</div>`;
        }
        return h;
    }

    function tabelaOcorrenciasDespc(r, lista) {
        const detalhesPorId = {};
        (r.detalhesOcorrencias || []).forEach(d => { detalhesPorId[d.idOcorrencia] = d; });
        let h = '<div class="cip-tabela-wrap"><table class="cip-tabela"><thead><tr><th>Nº Ocorrência</th><th>Data</th><th>Natureza</th><th>Envolvimento</th><th>Situação</th></tr></thead><tbody>';
        lista.forEach((o, i) => {
            const idOcor = o._id_ocor || '';
            const jaTemDetalhe = !!detalhesPorId[idOcor];
            h += `<tr class="cip-linha-despc" data-idx="${i}" data-id-ocor="${esc(idOcor)}" data-ja-tem="${jaTemDetalhe ? '1' : '0'}">
                <td>${esc(o.id_ocor_fk || idOcor || '—')}</td>
                <td style="white-space:nowrap;">${esc(o.dt_ocor || '—')}</td>
                <td>${esc(o.ds_ocor_sgrup || '—')}</td>
                <td>${esc(o.ds_oco_despc_tipo_envl || '—')}</td>
                <td>${esc(o.ds_ocor_despc_envl_pess_sitc || '—')}</td>
            </tr><tr class="cip-detalhe-linha" id="cip-det-despc-${i}"><td colspan="5"></td></tr>`;
        });
        h += '</tbody></table></div>';
        return h;
    }

    function tabelaOcorrenciasPpe(lista) {
        let h = '<div class="cip-tabela-wrap"><table class="cip-tabela"><thead><tr><th>Data</th><th>Natureza</th><th>Envolvimento</th><th>Sexo</th></tr></thead><tbody>';
        lista.forEach((o, i) => {
            h += `<tr class="cip-linha-ppe" data-idx="${i}" data-id="${esc(o._id || '')}" data-hash="${esc(o._hash || '')}">
                <td style="white-space:nowrap;">${esc(o.dt_ocorrencia || '—')}</td>
                <td>${esc(o.no_natureza_ocorrencia || '—')}</td>
                <td>${esc(o.tipo_envolvimento || '—')}</td>
                <td>${esc(o.sexo || '—')}</td>
            </tr><tr class="cip-detalhe-linha" id="cip-det-ppe-${i}"><td colspan="4"></td></tr>`;
        });
        h += '</tbody></table></div>';
        return h;
    }

    function tabelaOcorrenciasPcAntigo(lista) {
        let h = '<div class="cip-tabela-wrap"><table class="cip-tabela"><thead><tr><th>Nº BO</th><th>Data</th><th>Nome</th><th>Mãe</th></tr></thead><tbody>';
        lista.forEach((o, i) => {
            h += `<tr class="cip-linha-pcantigo" data-idx="${i}" data-env="${esc(o._env || o.attr_numero_bo || '')}">
                <td>${esc(o.attr_numero_bo || '—')}</td>
                <td style="white-space:nowrap;">${esc(o.data_hora_registro || '—')}</td>
                <td>${esc(o.nome || '—')}</td>
                <td>${esc(o.mae || '—')}</td>
            </tr><tr class="cip-detalhe-linha" id="cip-det-pcantigo-${i}"><td colspan="4"></td></tr>`;
        });
        h += '</tbody></table></div>';
        return h;
    }

    function montarHtmlDetalheCampos(campos) {
        if (!campos || !Object.keys(campos).length) return '<div style="font-size:12px;color:var(--p3-text-muted);">Sem detalhe disponível.</div>';
        return '<div class="cip-kv">' + Object.entries(campos)
            .filter(([, v]) => v)
            .map(([k, v]) => `<div><b>${esc(k)}:</b> ${esc(v)}</div>`).join('') + '</div>';
    }

    async function abrirDetalheLinha(tr, linhaDetalheId, buscarFn) {
        const detalheEl = document.getElementById(linhaDetalheId);
        if (!detalheEl) return;
        const aberto = detalheEl.classList.contains('visivel');
        document.querySelectorAll('.cip-detalhe-linha.visivel').forEach(d => d.classList.remove('visivel'));
        if (aberto) return;
        detalheEl.classList.add('visivel');
        const td = detalheEl.querySelector('td');
        if (td.dataset.carregado) return; // já buscado antes — não repete a chamada
        td.innerHTML = '<div style="font-size:12px;color:var(--p3-text-muted);">Carregando...</div>';
        try {
            const campos = await buscarFn();
            td.innerHTML = montarHtmlDetalheCampos(campos);
            td.dataset.carregado = '1';
        } catch (e) {
            td.innerHTML = `<div style="font-size:12px;color:var(--p3-danger);">Erro ao carregar: ${esc(e.message)}</div>`;
        }
    }

    function ligarEventosPainelAtivo(r) {
        document.querySelectorAll('.cip-linha-ppe').forEach(tr => {
            tr.addEventListener('click', () => {
                const i = tr.dataset.idx;
                abrirDetalheLinha(tr, 'cip-det-ppe-' + i, async () => {
                    const resp = await P3AtualizadorLocal.ocorrenciaDetalhe({ tipo: 'ppe', id: tr.dataset.id, hash: tr.dataset.hash });
                    if (!resp.ok) throw new Error(resp.erro || 'falha');
                    return resp.detalhe;
                });
            });
        });
        document.querySelectorAll('.cip-linha-pcantigo').forEach(tr => {
            tr.addEventListener('click', () => {
                const i = tr.dataset.idx;
                abrirDetalheLinha(tr, 'cip-det-pcantigo-' + i, async () => {
                    const resp = await P3AtualizadorLocal.ocorrenciaDetalhe({ tipo: 'pc_antigo', numeroBo: tr.dataset.env });
                    if (!resp.ok) throw new Error(resp.erro || 'falha');
                    // Detalhe do PC antigo pode ter VÁRIOS envolvidos (array) — junta todos num só bloco.
                    const lista = Array.isArray(resp.detalhe) ? resp.detalhe : [resp.detalhe];
                    return lista.reduce((acc, bloco, idx) => {
                        Object.entries(bloco || {}).forEach(([k, v]) => { acc[`${k} (envolvido ${idx + 1})`] = v; });
                        return acc;
                    }, {});
                });
            });
        });
        document.querySelectorAll('.cip-linha-despc').forEach(tr => {
            tr.addEventListener('click', () => {
                const i = tr.dataset.idx;
                const idOcor = tr.dataset.idOcor;
                abrirDetalheLinha(tr, 'cip-det-despc-' + i, async () => {
                    const detalhesPorId = {};
                    (ULTIMO_RESULTADO.detalhesOcorrencias || []).forEach(d => { detalhesPorId[d.idOcorrencia] = d; });
                    if (detalhesPorId[idOcor]) return detalhesPorId[idOcor].campos;
                    const resp = await P3AtualizadorLocal.ocorrenciaDetalhe({ tipo: 'despacho', idOcor: idOcor });
                    if (!resp.ok) throw new Error(resp.erro || 'falha');
                    return resp.detalhe.campos;
                });
            });
        });
        document.querySelectorAll('.cip-linha-relint').forEach(tr => {
            tr.addEventListener('click', () => {
                const i = Number(tr.dataset.idx);
                const detalheEl = document.getElementById('cip-det-relint-' + i);
                if (!detalheEl) return;
                const aberto = detalheEl.classList.contains('visivel');
                document.querySelectorAll('.cip-detalhe-linha.visivel').forEach(d => d.classList.remove('visivel'));
                if (aberto) return;
                detalheEl.classList.add('visivel');
                const rel = ((r.inteligencia && r.inteligencia.relint) || [])[i];
                detalheEl.querySelector('td').innerHTML = rel ? montarCamposDetalheRelint(rel) : '';
            });
        });
        // Escopado a #cip-sec-vinculos (não só ".cip-rede-no") DE PROPÓSITO —
        // os nós do modal de endereço (abrirModalEndereco) usam a MESMA
        // classe só pra herdar o hover do CSS (.cip-rede-no:hover circle),
        // mas têm seu próprio listener (.cip-rede-endereco-no, ligado direto
        // em abrirModalEndereco) — sem esse escopo, reabrir esta seção
        // (ligarEventosPainelAtivo roda de novo a cada renderizarTudo, ex.:
        // depois de buscar endereço na Equatorial) ligaria os nós do modal
        // de endereço (se já tiver sido aberto antes) neste handler também,
        // lendo o índice errado de r.inteligencia.vinculos.
        document.querySelectorAll('#cip-sec-vinculos .cip-rede-no').forEach(no => {
            no.addEventListener('click', () => {
                const i = Number(no.dataset.idx);
                const v = ((r.inteligencia && r.inteligencia.vinculos) || [])[i];
                const detalheEl = document.getElementById('cip-rede-detalhe');
                if (!detalheEl || !v) return;
                detalheEl.style.border = 'none';
                detalheEl.style.color = '';
                detalheEl.innerHTML = montarDetalheNoRedeHtml(v);
                const btnConsultar = detalheEl.querySelector('.cip-rede-btn-consultar');
                if (btnConsultar) btnConsultar.addEventListener('click', () => P3ConsultaPessoaAbrirCpf(btnConsultar.dataset.cpf));
            });
        });
        const btnEquatorial = document.getElementById('cip-btn-equatorial');
        if (btnEquatorial) {
            btnEquatorial.addEventListener('click', () => buscarEquatorialAcao(r));
        }
        document.querySelectorAll('.cip-denuncia-vermais').forEach(btn => {
            btn.addEventListener('click', () => {
                const i = Number(btn.dataset.idx);
                const d = ((r.inteligencia && r.inteligencia.denuncias) || [])[i];
                if (!d) return;
                const resumoEl = document.getElementById('cip-denuncia-resumo-' + i);
                if (resumoEl) resumoEl.textContent = d.resumoBreve || d.narrativa || '';
                btn.remove();
            });
        });
        document.querySelectorAll('.cip-endereco-aprox').forEach(div => {
            div.addEventListener('click', () => {
                const i = Number(div.dataset.idx);
                const e = ((r.inteligencia && r.inteligencia.enderecosAproximados) || [])[i];
                if (e) abrirModalEndereco(e);
            });
        });
    }

    // ────────────────────────────────────────────────────────────────
    // BNMP
    // ────────────────────────────────────────────────────────────────
    function renderMandados(r) {
        if (!r.mandados || !r.mandados.possuiMandado) {
            return '<div class="cip-card" style="color:#1e6b34;">✓ Nenhuma informação de mandado de prisão ativo encontrada na Central Nacional (BNMP) pra este CPF.</div>';
        }
        return `<div class="cip-card"><div class="cip-card-titulo" style="color:var(--p3-danger);">🚨 Mandado de prisão — BNMP</div>
            ${montarHtmlDetalheCampos(r.mandados.detalhe)}</div>`;
    }

    // ────────────────────────────────────────────────────────────────
    // PROCESSOS — TJAL (busca por nome) + TJSP (busca direta por CPF)
    // ────────────────────────────────────────────────────────────────
    const DOMINIO_ESAJ_POR_TRIBUNAL = { TJAL: 'www2.tjal.jus.br', TJSP: 'esaj.tjsp.jus.br' };
    const ORIGEM_LABEL = { nome_unico: 'Nome único', cpf_confirmado: 'CPF confirmado', cpf_direto: 'CPF direto' };
    function renderProcessos(r) {
        const lista = r.processos || [];
        if (!lista.length) return '<div class="cip-vazio">Nenhum processo encontrado (TJAL e TJSP) pra esta pessoa.</div>';
        let h = `<div class="cip-card"><div class="cip-card-titulo">Processos judiciais</div>
            <p style="font-size:11.5px;color:var(--p3-text-muted);margin-bottom:10px;">
                TJAL (por nome) e TJSP (direto por CPF) — classe/assunto/último andamento, quando disponíveis, vêm
                do DataJud (CNJ), checado também em tribunais vizinhos, federal (TRF5) e militar.
            </p>`;
        h += '<div class="cip-tabela-wrap"><table class="cip-tabela"><thead><tr><th>Tribunal</th><th>Nº Processo</th><th>Origem do vínculo</th><th>Classe / Assunto</th><th>Último andamento</th><th></th></tr></thead><tbody>';
        lista.forEach(p => {
            const dominio = DOMINIO_ESAJ_POR_TRIBUNAL[p.tribunal] || DOMINIO_ESAJ_POR_TRIBUNAL.TJAL;
            const link = `https://${dominio}/cpopg/search.do?cbPesquisa=NUMPROC&dadosConsulta.valorConsultaNuUnificado=${encodeURIComponent(p.numeroProcesso)}&dadosConsulta.tipoNuProcesso=UNIFICADO`;
            const classeAssunto = [p.classe, p.assunto].filter(Boolean).join(' — ') || '—';
            const mov = p.ultimoMovimento;
            const movTexto = mov ? `${esc(mov.textoCompleto || mov.nome || '—')}${mov.dataHora ? ' <span style="color:var(--p3-text-muted);">(' + esc(new Date(mov.dataHora).toLocaleDateString('pt-BR')) + ')</span>' : ''}` : '—';
            h += `<tr><td><b>${esc(p.tribunal || 'TJAL')}</b></td><td>${esc(p.numeroProcesso)}</td><td>${esc(ORIGEM_LABEL[p.origem] || p.origem || '—')}</td>
                <td>${esc(classeAssunto)}</td><td>${movTexto}</td>
                <td><a href="${link}" target="_blank" rel="noopener" style="color:var(--p3-blue-700);">Abrir no e-SAJ ↗</a></td></tr>`;
        });
        h += '</tbody></table></div></div>';
        return h;
    }

    // ────────────────────────────────────────────────────────────────
    // VEÍCULOS
    // ────────────────────────────────────────────────────────────────
    function renderVeiculos(r) {
        const lista = r.veiculos || [];
        if (!lista.length) return '<div class="cip-vazio">Nenhum veículo encontrado nas ocorrências desta pessoa.</div>';
        let h = `<div class="cip-card"><div class="cip-card-titulo">Veículos</div>
            <p style="font-size:11.5px;color:var(--p3-text-muted);margin-bottom:10px;">
                Descobertos a partir das ocorrências desta pessoa — a relação PROPRIETÁRIO só é atribuída quando o
                CPF do proprietário bate com o CPF pesquisado.
            </p>`;
        h += '<div class="cip-tabela-wrap"><table class="cip-tabela"><thead><tr><th>Placa</th><th>Modelo</th><th>Cor</th><th>Ano</th><th>Relação</th><th>Situação na ocorrência</th></tr></thead><tbody>';
        lista.forEach(v => {
            const d = v.detran || {};
            const corRelacao = v.relacao === 'PROPRIETARIO' ? '#1e6b34' : '#8a6100';
            h += `<tr>
                <td><b>${esc(v.placa)}</b></td>
                <td>${esc(d['Modelo'] || '—')}</td>
                <td>${esc(d['Cor'] || '—')}</td>
                <td>${esc(d['Ano'] || '—')}</td>
                <td><span style="color:${corRelacao};font-weight:700;">${v.relacao === 'PROPRIETARIO' ? 'PROPRIETÁRIO' : 'ENVOLVIDO'}</span></td>
                <td>${esc(v.situacaoNaOcorrencia || '—')}</td>
            </tr>`;
        });
        h += '</tbody></table></div></div>';
        return h;
    }

    // ────────────────────────────────────────────────────────────────
    // INTELIGÊNCIA — apelidos e observações já cadastrados pela própria
    // unidade no Supabase (ver supabase_intel.py). Vínculos cadastrados
    // ficam na aba Vínculos (rede/árvore, ver montarRedeVinculosHtml) —
    // aqui só o que é específico da pessoa: apelido(s) e texto livre.
    // ────────────────────────────────────────────────────────────────
    function renderInteligencia(r, paraImpressao) {
        const inteligencia = r.inteligencia;
        if (!inteligencia) {
            return '<div class="cip-vazio">Nenhum registro de inteligência cadastrado pra este CPF.</div>';
        }
        let h = '<div class="cip-card"><div class="cip-card-titulo">Informações de Inteligência</div>';
        if (inteligencia.apelidos && inteligencia.apelidos.length) {
            h += `<div style="margin-bottom:10px;"><b>Apelido(s):</b> ${esc(inteligencia.apelidos.join(', '))}</div>`;
        }
        if (inteligencia.observacao) {
            h += `<div style="font-size:13px;color:var(--p3-text);white-space:pre-wrap;">${esc(inteligencia.observacao)}</div>`;
        } else if (!inteligencia.apelidos || !inteligencia.apelidos.length) {
            h += '<div style="font-size:12.5px;color:var(--p3-text-muted);">Pessoa cadastrada, mas sem apelido nem observação registrados.</div>';
        }
        h += `<div style="font-size:11px;color:var(--p3-text-muted);margin-top:10px;">Vínculos cadastrados desta pessoa ficam na aba <b>Vínculos</b>, facção/organização criminosa na aba <b>ORCRIM</b> — relatórios de inteligência (RELINT), na aba <b>RELINT</b>.</div>`;
        h += '</div>';
        h += montarDenunciasHtml(inteligencia.denuncias, !!paraImpressao);
        return h;
    }

    // ────────────────────────────────────────────────────────────────
    // ORCRIM/FACÇÃO — 30/08/2026, pedido explícito do usuário: "crie o
    // campo ORCRIM". Dado vem de tb_faccao_pessoas (ver comentário
    // grande em supabase_intel.py:buscar_orcrim_pessoa sobre por que não
    // é tb_orcrim_pessoas, que está vazia no banco).
    // ────────────────────────────────────────────────────────────────
    function renderOrcrim(r) {
        const lista = (r.inteligencia && r.inteligencia.orcrim) || [];
        if (!lista.length) return '<div class="cip-vazio">Nenhum vínculo com organização criminosa/facção cadastrado pra este CPF.</div>';
        let h = `<div class="cip-card"><div class="cip-card-titulo">ORCRIM / Facção — ${lista.length}</div>
            <p style="font-size:11.5px;color:var(--p3-text-muted);margin-bottom:10px;">
                Vínculo cadastrado pela própria unidade — não representa condenação nem confirmação judicial.
            </p>`;
        lista.forEach((v, i) => {
            const corAtiva = v.ativa ? '#8f1f1f' : 'var(--p3-text-muted)';
            h += `<div style="padding:10px 0;${i > 0 ? 'border-top:1px dashed var(--p3-border);' : ''}">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                    <span style="font-weight:700;font-size:14px;color:${corAtiva};">${esc(v.faccao || '—')}</span>
                    ${v.ativa ? '<span class="cip-fonte-tag" style="background:#f6d3d3;color:#8f1f1f;">ATIVO</span>' : '<span class="cip-fonte-tag">inativo/encerrado</span>'}
                </div>
                <div style="font-size:12px;color:var(--p3-text-muted);margin-top:3px;">
                    ${esc(v.funcao || 'Função não definida')}${v.dataInicio ? ' · desde ' + esc(v.dataInicio) : ''}${v.dataFim ? ' até ' + esc(v.dataFim) : ''}
                </div>
                ${v.observacao ? `<div style="font-size:12.5px;color:var(--p3-text);white-space:pre-wrap;margin-top:6px;">${esc(v.observacao)}</div>` : ''}
            </div>`;
        });
        h += '</div>';
        return h;
    }

    // ────────────────────────────────────────────────────────────────
    // BUSCA WEB (Webmii) — 30/08/2026, pedido explícito do usuário:
    // "após a consulta do CPF, utilize o nome completo e faça essa busca
    // web e mostre junto aos dados." Ver webmii_busca.py — os resultados
    // vêm do MESMO Google CSE que o Webmii usa (não é um cadastro
    // verificado, é busca aberta na web pelo nome completo).
    // ────────────────────────────────────────────────────────────────
    function renderWebmii(r) {
        const w = r.webmii;
        if (!w) {
            // CORREÇÃO (31/08/2026, achado testando no .exe de verdade) —
            // r.webmii fica null tanto quando não tinha nome pra buscar
            // QUANTO quando a etapa deu erro (exceção capturada em
            // consulta_pessoa_service.py) — os dois casos pareciam a MESMA
            // mensagem genérica antes, escondendo o motivo real (que já
            // ficava certinho em r.fontes, só não era mostrado aqui).
            const erroFonte = _cipErroDaFonte(r, 'Busca web (nome)');
            if (erroFonte) {
                return `<div class="cip-card" style="border-color:#f0d98a;background:#fff8e6;color:#8a6100;font-size:12.5px;">
                    ⚠️ Busca na web indisponível: ${esc(erroFonte)}
                </div>`;
            }
            return '<div class="cip-vazio">Busca na web não foi executada pra este CPF (sem nome completo consolidado).</div>';
        }
        if (!w.ok) {
            return `<div class="cip-card" style="border-color:#f0d98a;background:#fff8e6;color:#8a6100;font-size:12.5px;">
                ⚠️ Busca na web indisponível: ${esc(w.erro || 'falha desconhecida')}
            </div>`;
        }
        const lista = w.resultados || [];
        if (!lista.length) return '<div class="cip-vazio">Nenhum resultado encontrado na web pra este nome.</div>';
        let h = `<div class="cip-card"><div class="cip-card-titulo">Busca na web — ${lista.length} resultado(s)${w.totalResultados ? ' de ' + esc(String(w.totalResultados)) : ''}</div>
            <p style="font-size:11.5px;color:var(--p3-text-muted);margin-bottom:10px;">
                Páginas públicas que mencionam este nome completo (editais, diários oficiais, redes sociais,
                notícias) — busca aberta na web, não é um cadastro verificado.
            </p>`;
        lista.forEach((item, i) => {
            h += `<div style="padding:10px 0;${i > 0 ? 'border-top:1px dashed var(--p3-border);' : ''}">
                <a href="${esc(item.url || '')}" target="_blank" rel="noopener" style="color:var(--p3-blue-700);font-weight:600;font-size:13px;">${esc(item.titulo || item.url || 'Sem título')}</a>
                <div style="font-size:11px;color:var(--p3-text-muted);margin:2px 0 4px;">${esc(item.urlVisivel || item.url || '')}</div>
                <div style="font-size:12.5px;color:var(--p3-text);">${esc(item.resumo || '')}</div>
            </div>`;
        });
        h += '</div>';
        return h;
    }

    // ────────────────────────────────────────────────────────────────
    // DISQUE DENÚNCIA — tb_denuncias no Supabase, ligada direto por
    // pessoa_id (sem tabela de junção, diferente de RELINT). Pedido
    // explícito do usuário (29/08/2026): "também quero que mostre o
    // disk denúncia para a pessoa consultada caso tenha. tb_denuncias."
    // Resumo vem truncado com "Ver mais" (pode ser um texto bem longo —
    // ver dado real testado) — link pro PDF anexado usa URL ASSINADA
    // (o bucket "denuncias" no Storage é privado, ver
    // supabase_intel.py:_sb_storage_sign_url), gerada só na hora da
    // consulta e válida por 1h.
    // ────────────────────────────────────────────────────────────────
    function _cipTruncar(s, n) {
        s = String(s || '');
        return s.length > n ? s.slice(0, n).trim() + '…' : s;
    }
    function montarDenunciasHtml(denuncias, paraImpressao) {
        if (!denuncias || !denuncias.length) return '';
        const STATUS_COR = { concluido: '#1e6b34', pendente: '#8a6100' };
        let h = `<div class="cip-card"><div class="cip-card-titulo">📞 Disque Denúncia — ${denuncias.length}</div>`;
        denuncias.forEach((d, i) => {
            const statusCor = STATUS_COR[d.statusOperacional] || 'var(--p3-text-muted)';
            const resumo = d.resumoBreve || d.narrativa || '';
            const resumoCurto = paraImpressao ? resumo : _cipTruncar(resumo, 260);
            const temMais = !paraImpressao && resumo.length > resumoCurto.length;
            const dataFmt = d.dataDenuncia ? new Date(d.dataDenuncia + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
            h += `<div style="padding:10px 0;${i > 0 ? 'border-top:1px dashed var(--p3-border);' : ''}">
                <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:12.5px;">
                    <div><b>${esc(d.tipo || 'Denúncia')}</b> · nº ${esc(d.numero || '—')}</div>
                    <div style="color:${statusCor};font-weight:700;text-transform:uppercase;font-size:11px;">${esc(d.statusOperacional || '—')}</div>
                </div>
                <div style="font-size:11px;color:var(--p3-text-muted);margin-top:2px;">${esc(dataFmt)}${d.cidade ? ' · ' + esc(d.cidade) : ''}</div>
                ${resumo ? `<div class="cip-denuncia-resumo" id="cip-denuncia-resumo-${i}" style="font-size:12.5px;color:var(--p3-text);margin-top:6px;white-space:pre-wrap;">${esc(resumoCurto)}</div>` : ''}
                ${temMais ? `<button type="button" class="cip-denuncia-vermais" data-idx="${i}" style="background:none;border:none;color:var(--p3-blue-700);font-size:11.5px;cursor:pointer;padding:2px 0;">Ver mais</button>` : ''}
                ${d.arquivoUrl ? `<div style="margin-top:6px;"><a href="${d.arquivoUrl}" target="_blank" rel="noopener" style="color:var(--p3-blue-700);font-size:12px;">📄 ${esc(d.arquivoNome || 'Abrir PDF da denúncia')} ↗</a></div>` : ''}
            </div>`;
        });
        h += '</div>';
        return h;
    }

    // ────────────────────────────────────────────────────────────────
    // RELINT — Relatórios de Inteligência cadastrados no Supabase que
    // têm esta pessoa como envolvida (ver tb_relatorio_busca_pessoas /
    // vw_relatorios_busca_detalhe em supabase_intel.py). Pedido
    // explícito do usuário (29/08/2026): "Se houver relint... deve
    // estar em uma aba separada, de forma clicável para ver os
    // detalhes" — os dados já vêm todos na consulta (sem chamada extra
    // ao clicar), então o clique só expande/recolhe o detalhe já em
    // memória (mesmo componente visual — cip-detalhe-linha — das
    // ocorrências, mas sem "Carregando...").
    // ────────────────────────────────────────────────────────────────
    function montarCamposDetalheRelint(rel) {
        return montarHtmlDetalheCampos({
            'Nº da Ordem de Busca vinculada': rel.ordemNumero,
            'Assunto (Ordem de Busca)': rel.ordemAssunto,
            'Cidade': rel.cidade,
            'Nº Denúncia 181': rel.numeroDenuncia181,
            'Redes sociais': rel.redesSociais,
            'Câmeras no local': rel.camerasLocal ? 'Sim' : (rel.camerasLocal === false ? 'Não' : null),
            'Observação do vínculo': rel.observacaoVinculo,
            'Informações complementares': rel.informacoesComplementares,
        });
    }
    function renderRelint(r) {
        const lista = (r.inteligencia && r.inteligencia.relint) || [];
        if (!lista.length) return '<div class="cip-vazio">Nenhum relatório de inteligência (RELINT) cadastrado pra este CPF.</div>';
        let h = `<div class="cip-card"><div class="cip-card-titulo">Relatórios de Inteligência (RELINT) — ${lista.length}</div>
            <p style="font-size:11.5px;color:var(--p3-text-muted);margin-bottom:10px;">Clique num relatório pra ver os detalhes completos.</p>`;
        h += '<div class="cip-tabela-wrap"><table class="cip-tabela"><thead><tr><th>Nº</th><th>Data</th><th>Assunto</th><th>Papel</th><th>Equipe</th><th>Status</th></tr></thead><tbody>';
        lista.forEach((rel, i) => {
            h += `<tr class="cip-linha-relint" data-idx="${i}" title="Clique pra ver os detalhes">
                <td><b>${esc(rel.numero || '—')}</b></td>
                <td style="white-space:nowrap;">${esc(rel.dataHora ? new Date(rel.dataHora).toLocaleDateString('pt-BR') : '—')}</td>
                <td>${esc(rel.assunto || '—')}</td>
                <td>${esc(rel.papel || '—')}</td>
                <td>${esc(rel.equipeResponsavel || '—')}</td>
                <td>${esc(rel.status || '—')}</td>
            </tr><tr class="cip-detalhe-linha" id="cip-det-relint-${i}"><td colspan="6"></td></tr>`;
        });
        h += '</tbody></table></div></div>';
        return h;
    }

    // ────────────────────────────────────────────────────────────────
    // TIMELINE — junta PPE + PC antigo + SISPOL + processos por ano,
    // mais recente primeiro.
    // ────────────────────────────────────────────────────────────────
    function parseDataBrParaOrdenacao(s) {
        const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
        return m ? m[3] + m[2] + m[1] : '';
    }
    function renderTimeline(r) {
        const itens = [];
        (r.ocorrenciasPpe || []).forEach(o => itens.push({ data: o.dt_ocorrencia, texto: `${o.no_natureza_ocorrencia || 'Ocorrência'} (${o.tipo_envolvimento || '—'})`, fonte: 'Ocorrência' }));
        (r.ocorrenciasPcAntigo || []).forEach(o => itens.push({ data: o.data_hora_registro, texto: `Boletim ${o.attr_numero_bo || '—'}`, fonte: 'Registro anterior' }));
        (r.ocorrenciasDespacho || []).forEach(o => itens.push({ data: o.dt_ocor, texto: `${o.ds_ocor_sgrup || 'Ocorrência'} (${o.ds_oco_despc_tipo_envl || '—'})`, fonte: 'Ocorrência' }));

        itens.forEach(it => { it._ord = parseDataBrParaOrdenacao(it.data); });
        itens.sort((a, b) => b._ord.localeCompare(a._ord));

        if (!itens.length) return '<div class="cip-vazio">Nenhum evento datado encontrado pra montar a linha do tempo.</div>';

        let h = '<div class="cip-card"><div class="cip-timeline">';
        let anoAtual = null;
        itens.forEach(it => {
            const ano = (it._ord || '').slice(0, 4) || '(sem data)';
            if (ano !== anoAtual) { h += `<div class="cip-timeline-ano">${esc(ano)}</div>`; anoAtual = ano; }
            h += `<div class="cip-timeline-item">
                <div class="cip-timeline-data">${esc(it.data || '—')}</div>
                <div class="cip-timeline-texto">${esc(it.texto)} <span class="cip-fonte-tag">${esc(it.fonte)}</span></div>
            </div>`;
        });
        h += '</div></div>';
        return h;
    }

    // ────────────────────────────────────────────────────────────────
    // FONTES
    // ────────────────────────────────────────────────────────────────
    function renderFontes(r) {
        let h = '<div class="cip-card"><div class="cip-card-titulo">Etapas desta consulta</div><div id="cip-fontes-lista">';
        r.fontes.forEach(f => {
            const status = f.ok ? '<span class="cip-status-ok">✓ ok</span>' : `<span class="cip-status-erro">✗ erro: ${esc(f.erro || '')}</span>`;
            h += `<div class="cip-fonte-linha"><span>${esc(f.fonte)}</span><span>${status} — ${f.elapsedMs}ms</span></div>`;
        });
        h += `</div><p style="font-size:11px;color:var(--p3-text-muted);margin-top:10px;">
            Consultado em ${esc(r.consultadoEm)} — tempo total ${(r.tempoTotalMs / 1000).toFixed(1)}s.
        </p></div>`;
        return h;
    }

    // ────────────────────────────────────────────────────────────────
    // IMPRESSÃO — pedido explícito do usuário: "imprimir a consulta com
    // todos os dados completos". Mesmo padrão visual (capa em gradiente
    // + cartão de seção com selo numerado) de
    // js/core/modal-mudancas-movimentacao.js / relatorios/relatorio_preditiva.html.
    // Reaproveita as MESMAS funções render*(r) já usadas na tela — nunca
    // recalcula nada — então a impressão sai com o mesmo texto/números
    // que a tela mostra, incluindo a regra de não citar de onde cada
    // dado veio.
    //
    // Ocorrências ganham um render PRÓPRIO pra impressão
    // (renderOcorrenciasParaImpressao) porque a versão da tela depende
    // de clique pra abrir o detalhe — no papel isso não existe, então o
    // detalhe já carregado (ver r.detalhesOcorrencias, preenchido
    // automaticamente pras ocorrências mais recentes — ver
    // LIMITE_DETALHE_AUTOMATICO no Python) entra ABERTO, sem exigir
    // ação nenhuma. As ocorrências que nunca tiveram o detalhe buscado
    // (além do limite automático, ou de outras fontes) aparecem só com
    // o resumo da tabela — a impressão não dispara buscas novas.
    function _cipGarantirDomImpressao() {
        if (document.getElementById('cip-print-raiz')) return;
        const raiz = document.createElement('div');
        raiz.id = 'cip-print-raiz';
        document.body.appendChild(raiz);
    }

    function renderOcorrenciasParaImpressao(r) {
        const ppe = r.ocorrenciasPpe || [];
        const pcAntigo = r.ocorrenciasPcAntigo || [];
        const despc = r.ocorrenciasDespacho || [];
        if (!ppe.length && !pcAntigo.length && !despc.length) {
            return '<div class="cip-vazio">Nenhuma ocorrência encontrada.</div>';
        }
        const detalhesPorId = {};
        (r.detalhesOcorrencias || []).forEach(d => { detalhesPorId[d.idOcorrencia] = d; });

        let h = '';
        if (despc.length) {
            h += `<div class="cip-card"><div class="cip-card-titulo">Ocorrências — ${despc.length}</div>`;
            despc.forEach(o => {
                const det = detalhesPorId[o._id_ocor];
                h += `<div style="padding:10px 0;border-top:1px dashed var(--p3-border);">
                    <div style="font-size:12.5px;"><b>${esc(o.id_ocor_fk || o._id_ocor || '—')}</b> — ${esc(o.dt_ocor || '—')}</div>
                    <div style="font-size:12px;color:var(--p3-text);margin-top:2px;">${esc(o.ds_ocor_sgrup || '—')}</div>
                    <div style="font-size:11px;color:var(--p3-text-muted);margin-top:2px;">Envolvimento: ${esc(o.ds_oco_despc_tipo_envl || '—')} · Situação: ${esc(o.ds_ocor_despc_envl_pess_sitc || '—')}</div>
                    ${det ? montarHtmlDetalheCampos(det.campos) : ''}
                </div>`;
            });
            h += '</div>';
        }
        if (ppe.length) {
            h += `<div class="cip-card"><div class="cip-card-titulo">Ocorrências policiais — ${ppe.length}</div>${tabelaOcorrenciasPpe(ppe)}</div>`;
        }
        if (pcAntigo.length) {
            h += `<div class="cip-card"><div class="cip-card-titulo">Registros anteriores — ${pcAntigo.length} boletim(ns)</div>${tabelaOcorrenciasPcAntigo(pcAntigo)}</div>`;
        }
        return h;
    }

    // Versão pra impressão do RELINT — o detalhe fica sempre ABERTO (no
    // papel não existe clique), mesmo espírito de renderOcorrenciasParaImpressao.
    function renderRelintParaImpressao(r) {
        const lista = (r.inteligencia && r.inteligencia.relint) || [];
        if (!lista.length) return '<div class="cip-vazio">Nenhum relatório de inteligência (RELINT) cadastrado pra este CPF.</div>';
        let h = `<div class="cip-card"><div class="cip-card-titulo">Relatórios de Inteligência (RELINT) — ${lista.length}</div>`;
        lista.forEach((rel, i) => {
            h += `<div style="padding:10px 0;${i > 0 ? 'border-top:1px dashed var(--p3-border);' : ''}">
                <div style="font-size:12.5px;"><b>${esc(rel.numero || '—')}</b> — ${esc(rel.dataHora ? new Date(rel.dataHora).toLocaleDateString('pt-BR') : '—')}</div>
                <div style="font-size:12px;color:var(--p3-text);margin-top:2px;">${esc(rel.assunto || '—')}</div>
                <div style="font-size:11px;color:var(--p3-text-muted);margin-top:2px;">Papel: ${esc(rel.papel || '—')} · Equipe: ${esc(rel.equipeResponsavel || '—')} · Status: ${esc(rel.status || '—')}</div>
                ${montarCamposDetalheRelint(rel)}
            </div>`;
        });
        h += '</div>';
        return h;
    }

    function _cipMontarSecao(numero, titulo, htmlConteudo) {
        return `<div class="cpp-secao">
            <div class="cpp-secao-titulo"><div class="cpp-secao-numero">${numero}</div><div><h2>${esc(titulo)}</h2></div></div>
            <div class="cpp-conteudo">${htmlConteudo}</div>
        </div>`;
    }

    // SELEÇÃO DE MÓDULOS NA IMPRESSÃO (31/08/2026, pedido explícito do
    // usuário: "quero que cada módulo... seja separado na hora de
    // imprimir, podendo selecionar o que quer que entre... pois podem
    // ter dados que eu não queria colocar na lista"). 1 entrada por
    // seção que a impressão já sabia montar (mesmas funções render*
    // que existiam, só que agora cada uma some sozinha do relatório se
    // desmarcada, em vez de ser tudo-ou-nada). "Fontes" fica de fora —
    // nunca fez parte da impressão (é só um log técnico da consulta).
    const CIP_SECOES_IMPRESSAO = [
        { id: 'visaogeral', titulo: 'Visão Geral', label: '📊 Visão Geral', render: r => renderVisaoGeral(r) },
        { id: 'cnh', titulo: 'CNH', label: '🪪 CNH', render: r => renderCnh(r) },
        { id: 'vinculos', titulo: 'Vínculos', label: '👪 Vínculos', render: r => renderVinculos(r) },
        { id: 'enderecos', titulo: 'Endereços', label: '📍 Endereços', render: r => renderEnderecos(r) },
        { id: 'ocorrencias', titulo: 'Ocorrências', label: '🚓 Ocorrências', render: r => renderOcorrenciasParaImpressao(r) },
        { id: 'mandados', titulo: 'Mandados', label: '⛓️ Mandados', render: r => renderMandados(r) },
        { id: 'processos', titulo: 'Processos Judiciais', label: '⚖️ Processos', render: r => renderProcessos(r) },
        { id: 'veiculos', titulo: 'Veículos', label: '🚗 Veículos', render: r => renderVeiculos(r) },
        { id: 'inteligencia', titulo: 'Informações de Inteligência', label: '🕵️ Inteligência', render: r => renderInteligencia(r, true) },
        { id: 'orcrim', titulo: 'ORCRIM', label: '🎯 ORCRIM', render: r => renderOrcrim(r) },
        { id: 'relint', titulo: 'RELINT', label: '📋 RELINT', render: r => renderRelintParaImpressao(r) },
        { id: 'webmii', titulo: 'Busca na Web', label: '🌐 Busca na Web', render: r => renderWebmii(r) },
        { id: 'timeline', titulo: 'Linha do Tempo', label: '🕐 Linha do Tempo', render: r => renderTimeline(r) },
    ];
    const CIP_IMPRESSAO_LOCALSTORAGE_KEY = 'p3_cip_secoes_impressao';

    // Abre o modal de seleção — cada consulta impressa lembra da ÚLTIMA
    // escolha (localStorage, por navegador/máquina — nunca envia nada
    // pra lugar nenhum), pra não precisar desmarcar as mesmas seções
    // toda vez. Na 1ª vez (nada salvo ainda), tudo vem marcado — mesmo
    // comportamento de "imprimir tudo" que já existia.
    function abrirModalImprimir() {
        if (!ULTIMO_RESULTADO) { alert('Consulte uma pessoa primeiro.'); return; }
        let selecaoSalva = null;
        try {
            const bruto = localStorage.getItem(CIP_IMPRESSAO_LOCALSTORAGE_KEY);
            if (bruto) selecaoSalva = new Set(JSON.parse(bruto));
        } catch (e) { /* localStorage indisponível/corrompido — cai no padrão (tudo marcado) */ }

        const lista = document.getElementById('cip-mi-lista');
        lista.innerHTML = CIP_SECOES_IMPRESSAO.map(s => {
            const marcado = !selecaoSalva || selecaoSalva.has(s.id);
            return `<label style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:7px;cursor:pointer;">
                <input type="checkbox" class="cip-mi-check" value="${s.id}" ${marcado ? 'checked' : ''}>
                <span style="font-size:13px;color:var(--p3-text);">${s.label}</span>
            </label>`;
        }).join('');

        document.getElementById('cip-modal-imprimir').classList.add('aberto');
    }
    function fecharModalImprimir() {
        document.getElementById('cip-modal-imprimir').classList.remove('aberto');
    }
    window.P3ConsultaPessoaFecharModalImprimir = fecharModalImprimir;

    function imprimirConsultaCompleta(idsSelecionados) {
        const r = ULTIMO_RESULTADO;
        if (!r) { alert('Consulte uma pessoa primeiro.'); return; }
        // Sem seleção nenhuma passada (ex.: chamada antiga/direta) —
        // imprime tudo, mesmo comportamento de antes.
        const secoes = idsSelecionados
            ? CIP_SECOES_IMPRESSAO.filter(s => idsSelecionados.has(s.id))
            : CIP_SECOES_IMPRESSAO;
        if (!secoes.length) { alert('Selecione ao menos 1 módulo pra imprimir.'); return; }

        _cipGarantirDomImpressao();
        const raiz = document.getElementById('cip-print-raiz');
        const p = r.pessoa || {};
        const agora = new Date();
        const agoraFmt = String(agora.getDate()).padStart(2, '0') + '/' + String(agora.getMonth() + 1).padStart(2, '0') + '/' + agora.getFullYear() +
            ' ' + String(agora.getHours()).padStart(2, '0') + ':' + String(agora.getMinutes()).padStart(2, '0');

        let html = `<div class="cpp-capa">
            <div class="cpp-capa-header">
                <img src="../img/brasao.png" alt="Brasão 10º BPM">
                <div class="cpp-capa-org"><h1>SISTEMA DE GERENCIAMENTO P3</h1><h2>10º BATALHÃO DE POLÍCIA MILITAR DE ALAGOAS</h2></div>
            </div>
            <div class="cpp-capa-titulo">
                <h3>CONSULTA INTEGRADA DE PESSOAS</h3>
                <p>Identificação, CNH, vínculos, endereços, ocorrências, mandados, processos e veículos consolidados</p>
            </div>
            <div class="cpp-capa-meta">
                <span>👤 ${esc(p.nome || '(nome não encontrado)')}</span>
                <span>📄 CPF ${esc(formatarCpf(r.cpf))}</span>
                <span>🖨️ Impresso em ${agoraFmt}</span>
            </div>
        </div>`;

        let n = 1;
        secoes.forEach(s => { html += _cipMontarSecao(n++, s.titulo, s.render(r)); });

        html += `<div class="cpp-rodape">
            <div><strong>Sistema P3</strong> — 10º Batalhão de Polícia Militar<br>Seção de Planejamento, Ensino e Instrução — P3/10ºBPM</div>
            <div style="text-align:right;">Consulta realizada em ${esc(r.consultadoEm)}</div>
        </div>`;

        raiz.innerHTML = html;
        window.print();
    }

    // Botão "🖨️ Imprimir selecionados" dentro do modal — lê os
    // checkboxes marcados, salva a escolha (pra lembrar da próxima vez)
    // e dispara a impressão de verdade.
    function confirmarImprimir() {
        const idsSelecionados = new Set(
            Array.from(document.querySelectorAll('.cip-mi-check:checked')).map(el => el.value)
        );
        try { localStorage.setItem(CIP_IMPRESSAO_LOCALSTORAGE_KEY, JSON.stringify([...idsSelecionados])); }
        catch (e) { /* localStorage indisponível — só não lembra da próxima vez, sem quebrar a impressão */ }
        fecharModalImprimir();
        imprimirConsultaCompleta(idsSelecionados);
    }

    // ────────────────────────────────────────────────────────────────
    // "Preparar busca web" (Webmii, ver webmii_busca.py) — Chromium é
    // baixado sob demanda, não vem no .exe (ver comentário grande em
    // webmii_busca.py). Botão fica desabilitado com "✅ já instalado"
    // quando o servidor confirma que já tem o Chromium nesta máquina.
    async function atualizarStatusWebmii() {
        const btn = document.getElementById('cip-mc-btn-webmii');
        const status = document.getElementById('cip-mc-webmii-status');
        if (!btn || !status) return;
        status.style.color = 'var(--p3-text-muted)';
        status.textContent = 'Verificando...';
        try {
            const r = await P3AtualizadorLocal.webmiiStatus();
            if (r.instalado) {
                btn.disabled = true;
                btn.textContent = '✅ Já instalado';
                status.style.color = '#1e6b34';
                status.textContent = 'Pronto — a busca na web já funciona nas próximas consultas.';
            } else {
                btn.disabled = false;
                btn.textContent = '⬇️ Preparar busca web';
                status.style.color = 'var(--p3-text-muted)';
                status.textContent = 'Ainda não baixado nesta máquina.';
            }
        } catch (e) {
            status.style.color = 'var(--p3-danger)';
            status.textContent = 'Erro ao verificar: ' + e.message;
        }
    }
    async function instalarWebmiiAcao() {
        const btn = document.getElementById('cip-mc-btn-webmii');
        const status = document.getElementById('cip-mc-webmii-status');
        if (!btn || !status) return;
        btn.disabled = true;
        status.style.color = 'var(--p3-text-muted)';
        status.textContent = '⏳ Baixando (~190MB, pode levar alguns minutos)...';
        try {
            const r = await P3AtualizadorLocal.webmiiInstalar();
            if (r.ok) {
                status.style.color = '#1e6b34';
                status.textContent = '✅ ' + (r.mensagem || 'Instalado com sucesso.');
                btn.textContent = '✅ Já instalado';
            } else {
                btn.disabled = false;
                status.style.color = 'var(--p3-danger)';
                status.textContent = '❌ ' + (r.mensagem || 'Falha ao instalar.');
            }
        } catch (e) {
            btn.disabled = false;
            status.style.color = 'var(--p3-danger)';
            status.textContent = 'Erro de conexão: ' + e.message;
        }
    }

    // ────────────────────────────────────────────────────────────────
    // BOOT
    // ────────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', async function () {
        if (!requireP2OuAdmin()) return;

        if (!(await P3AtualizadorLocal.disponivel())) {
            document.getElementById('cip-aviso-servidor').style.display = 'block';
        }

        CadLoginModal.montarBadge(document.getElementById('clm-badge-container'));
        document.getElementById('cip-config-link').addEventListener('click', () => CadLoginModal.abrir());
        atualizarStatusWebmii();
        document.getElementById('cip-mc-btn-webmii').addEventListener('click', instalarWebmiiAcao);

        document.getElementById('cip-btn-consultar').addEventListener('click', consultar);
        document.getElementById('cip-btn-imprimir').addEventListener('click', abrirModalImprimir);
        document.getElementById('cip-mi-confirmar-btn').addEventListener('click', confirmarImprimir);
        document.getElementById('cip-mi-marcar-todos').addEventListener('click', () => {
            document.querySelectorAll('.cip-mi-check').forEach(el => { el.checked = true; });
        });
        document.getElementById('cip-mi-desmarcar-todos').addEventListener('click', () => {
            document.querySelectorAll('.cip-mi-check').forEach(el => { el.checked = false; });
        });
        document.getElementById('cip-input-cpf').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') consultar();
        });
        document.getElementById('cip-input-cpf').addEventListener('input', function (e) {
            e.target.value = e.target.value.replace(/[^\d.\-]/g, '');
        });

        document.querySelectorAll('.cip-modo-btn').forEach(function (b) {
            b.addEventListener('click', () => alternarModoBusca(b.dataset.modo));
        });

        document.getElementById('cip-btn-buscar-nome').addEventListener('click', buscarPorNome);
        ['cip-input-nome', 'cip-input-mae', 'cip-input-pai'].forEach(function (id) {
            document.getElementById(id).addEventListener('keydown', function (e) {
                if (e.key === 'Enter') buscarPorNome();
            });
        });

        document.getElementById('cip-btn-buscar-veiculo').addEventListener('click', buscarVeiculoAcao);
        ['cip-input-placa', 'cip-input-chassi'].forEach(function (id) {
            document.getElementById(id).addEventListener('keydown', function (e) {
                if (e.key === 'Enter') buscarVeiculoAcao();
            });
        });

        document.getElementById('cip-btn-buscar-cnpj').addEventListener('click', buscarCnpjAcao);
        document.getElementById('cip-input-cnpj').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') buscarCnpjAcao();
        });

        // Handoff de "🔍 Detalhes" vindo de page/denunciasRecorrentes.html
        // (ver abrirResultadoSalvoEmAba acima) — o resultado completo é
        // grande demais pra ir numa URL, então viaja por sessionStorage;
        // a chave some logo em seguida (é um handoff de 1 uso só, não um
        // cache — recarregar esta página não deve reabrir sozinha).
        if (new URLSearchParams(location.search).get('abrirResultadoSalvo') === '1') {
            try {
                const bruto = sessionStorage.getItem('p3_cip_resultado_salvo_handoff');
                sessionStorage.removeItem('p3_cip_resultado_salvo_handoff');
                if (bruto) abrirResultadoSalvoEmAba(JSON.parse(bruto));
            } catch (e) {
                console.warn('[consulta-pessoa] falha ao abrir resultado salvo:', e.message);
            }
        }

        // Deep-link "?cpf=..." (02/09/2026) — usado pelo botão "🔎 Consulta
        // Integrada" da aba Cérbero (js/cerbero.js), que abre esta página
        // numa aba nova já pronta pra consultar o CPF da pessoa. Mesmo
        // caminho de consultar() (preenche o campo e roda a busca normal),
        // então herda a mesma validação/aviso de servidor indisponível.
        const cpfDeepLink = limparCpf(new URLSearchParams(location.search).get('cpf') || '');
        if (cpfDeepLink.length === 11) {
            alternarModoBusca('cpf');
            document.getElementById('cip-input-cpf').value = formatarCpf(cpfDeepLink);
            consultar();
        }
    });
})();
