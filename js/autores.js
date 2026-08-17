// ====================================================================
// Sistema P3 — Autores (vínculo de processo E-SAJ + movimentação)
// ====================================================================
// Fonte de dados abstraída por P3.Autores (js/core/session.js): para o
// 10º BPM lê/escreve na API PHP/MySQL da Hostinger, para as demais
// unidades continua no nó /autor do Firebase — exatamente como sempre
// foi. Esta página não decide de onde vem o dado, só chama P3.Autores.
//
// A descoberta automática e a checagem diária de movimentação são
// feitas pelo Apps Script (fora deste repositório); esta página só lê
// o resultado e permite resolver manualmente os casos "pendente_revisao"
// (nunca vinculados sozinhos pelo robô, por decisão explícita: só liga
// automático quando o match é exato — 1 único resultado, ou CPF batendo).

let cfgUnidade = null; // definido em runtime a partir da unidade do usuário logado
// Projeto Apps Script PRÓPRIO de Autores/Suspeitos (separado do de TCO,
// ver hostinger-api/DEPLOY.md) — usado só pelo botão "Verificar agora"
// (rota sincronizarAutoresAgora).
let GAS_AUTORES_URL = null;

let todosAutores = [];
let filtroTexto = '';
let filtroStatus = '';

function escaparHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function normalizarBusca(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

// ====================================================================
// CARREGAMENTO
// ====================================================================
// Separado de carregarAutores() pra poder ser reaproveitado pelo polling
// de progresso do "Verificar agora" (verificarAgora) — cada refetch
// durante o acompanhamento precisa atualizar todosAutores, a barra de
// backlog geral e a tabela, exatamente como no carregamento inicial.
function processarDadosAutores(dados) {
    todosAutores = Object.keys(dados)
        .map(id => Object.assign({ _id: id }, dados[id]))
        .filter(a => a.NOME && a.NOME !== '---')
        // Só ENVOLVIMENTO = "AUTOR" entra nesta tela — demais papéis
        // (VITIMA, TESTEMUNHA, SUSPEITO...) continuam existindo na
        // fonte de dados, só não aparecem aqui.
        .filter(a => normalizarBusca(a.ENVOLVIMENTO) === 'AUTOR');
    // Mais recentes primeiro (DATA no formato DD/MM/AAAA, igual ao
    // resto do projeto — ver js/cadastroocorrencias.js).
    todosAutores.sort((a, b) => {
        const da = parseDataBR(a.DATA), db = parseDataBR(b.DATA);
        if (da && db) return db - da;
        return 0;
    });
    atualizarProgresso();
    aplicarFiltros();
    marcarAtualizadoEmAgora();
}

async function carregarAutores() {
    const tbody = document.getElementById('autores-tbody');
    tbody.innerHTML = '<tr><td colspan="9" class="empty-msg">Carregando...</td></tr>';
    try {
        const dados = await P3.Autores.listar(cfgUnidade);
        processarDadosAutores(dados);
    } catch (e) {
        console.error('[autores] Erro ao carregar:', e);
        tbody.innerHTML = '<tr><td colspan="9" class="empty-msg">Erro ao carregar autores. Tente recarregar a página.</td></tr>';
    }
}

function parseDataBR(str) {
    if (!str) return null;
    const m = String(str).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return null;
    const d = new Date(+m[3], +m[2] - 1, +m[1]);
    return isNaN(d.getTime()) ? null : d;
}

// ISO 8601 (ex. "2026-08-13T16:47:52.022Z") -> "13/08/2026 13:47", no
// fuso do navegador — usado pra mostrar QUANDO o robô checou pela última
// vez, distinto da data do movimento em si (que já vem embutida no texto
// de movimentacaoAutor, ver processarMovimentacaoAutor no Apps Script).
function formatarDataHoraIso(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const dia = String(d.getDate()).padStart(2, '0');
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${dia}/${mes}/${d.getFullYear()} ${hh}:${mm}`;
}

// Indicador discreto e permanente de "última vez que os dados foram
// buscados do servidor" — substitui a mensagem de conclusão que antes
// ficava alguns segundos na tela e depois sumia (pedido explícito: não
// deixar nada "preso"/fixo, só um "atualizado em" sempre visível).
function marcarAtualizadoEmAgora() {
    const el = document.getElementById('autores-atualizado-em');
    if (!el) return;
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    el.textContent = `Atualizado em: ${hh}:${mm}`;
}

// ====================================================================
// PROGRESSO — mostra quantos autores já foram tocados pelo Apps Script
// (descoberta feita pelo menos 1x), pra não parecer que "nada
// aconteceu" enquanto a fila de milhares de autores é processada aos
// poucos em segundo plano (lotes de AUTORES_BATCH_SIZE, 1x por gatilho,
// pode levar horas pra zerar a fila inicial num nó grande).
//
// Some da tela quando não sobra ninguém "aguardando na fila" (descoberta
// 100% feita) — mesmo princípio da barra "ao vivo" (iniciarPollAutores):
// uma barra parada em 100% pra sempre lê como "ainda carregando algo",
// não como "terminou". O resumo de vinculados/pendentes/não encontrados
// continua disponível nos filtros de status da tabela, só não fica fixo
// aqui como barra.
// ====================================================================
function atualizarProgresso() {
    const wrap = document.getElementById('autores-progresso-geral-wrap');
    const fill = document.getElementById('autores-progresso-geral-fill');
    const texto = document.getElementById('autores-progresso-geral-texto');
    if (!wrap || !fill || !texto) return;
    const total = todosAutores.length;
    if (!total) { wrap.style.display = 'none'; return; }
    const vinculados = todosAutores.filter(a => a.statusVinculoEsaj === 'vinculado').length;
    const pendentes = todosAutores.filter(a => a.statusVinculoEsaj === 'pendente_revisao').length;
    const naoEncontrados = todosAutores.filter(a => a.statusVinculoEsaj === 'nao_encontrado').length;
    const jaProcessados = vinculados + pendentes + naoEncontrados;

    if (jaProcessados >= total) { wrap.style.display = 'none'; return; }

    const pct = Math.round((jaProcessados / total) * 100);
    wrap.style.display = 'block';
    fill.style.width = pct + '%';
    texto.textContent = `${jaProcessados} de ${total} (${pct}%) — ` +
        `${vinculados} vinculados · ${pendentes} pendentes de revisão · ${naoEncontrados} não encontrados · ` +
        `${total - jaProcessados} aguardando na fila`;
}

// ====================================================================
// FILTROS
// ====================================================================
function aplicarFiltros() {
    const textoNorm = normalizarBusca(filtroTexto);
    const lista = todosAutores.filter(a => {
        if (filtroStatus) {
            const status = a.statusVinculoEsaj || 'nao_verificado';
            if (status !== filtroStatus) return false;
        }
        if (textoNorm) {
            // Um campo só faz tudo: nome/CPF/nome da mãe (evita homônimos)
            // + COP, data, tipificação e movimentação (pra achar rápido por
            // qualquer coluna visível na tabela, sem precisar de filtro
            // separado pra cada uma).
            const alvo = normalizarBusca([
                a.NOME, a.CPF, a.NOME_MAE, a.BOLETIM, a.DATA, a.TIPIFICACAO, a.movimentacaoAutor
            ].filter(Boolean).join(' '));
            if (alvo.indexOf(textoNorm) === -1) return false;
        }
        return true;
    });
    renderizarTabela(lista);
}

// ====================================================================
// RENDER
// ====================================================================
function badgeStatus(status) {
    const s = status || 'nao_verificado';
    const rotulos = {
        vinculado: 'Vinculado',
        pendente_revisao: 'Pendente de revisão',
        nao_encontrado: 'Não encontrado',
        nao_verificado: 'Não verificado ainda',
    };
    return `<span class="status-badge status-${s}"${s === 'pendente_revisao' ? ' title="Clique para ver os candidatos"' : ''}>${rotulos[s] || s}</span>`;
}

function celulaNomeMae(a) {
    const podeEditar = P3.Autores.usaApiPhp(cfgUnidade);
    const valor = a.NOME_MAE ? escaparHtml(a.NOME_MAE) : '<span style="opacity:.5;">—</span>';
    if (!podeEditar) return valor;
    return `<span class="nome-mae-valor" data-nome-mae-de="${escaparHtml(a._id)}" title="Clique para editar">${valor}</span>`;
}

function renderizarTabela(lista) {
    const tbody = document.getElementById('autores-tbody');
    if (!lista.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty-msg">Nenhum autor encontrado com esse filtro.</td></tr>';
        return;
    }

    tbody.innerHTML = lista.map(a => {
        const status = a.statusVinculoEsaj || 'nao_verificado';

        // Processo "principal" (vínculo automático do robô, ou o 1º
        // vínculo manual pela tela) + processos EXTRAS vinculados à mão
        // (tabela autor_processos) — um autor pode ter mais de um
        // processo e-SAJ de interesse. O principal não tem botão de
        // remover aqui (mexe nele via "Vincular este"/"Não encontrado",
        // igual sempre foi); só os extras são removíveis.
        const processoPrincipal = a.numeroProcessoEsaj
            ? [{ numeroProcessoEsaj: a.numeroProcessoEsaj, movimentacaoAutor: a.movimentacaoAutor, verificadoEm: a.verificadoEm, assuntoEsaj: a.assuntoEsaj, classeEsaj: a.classeEsaj, alertaImportante: a.alertaImportante, id: null }]
            : [];
        const processosExtras = (Array.isArray(a.processosExtras) ? a.processosExtras : []).map(p => ({
            numeroProcessoEsaj: p.numeroProcessoEsaj, movimentacaoAutor: p.movimentacaoProcesso, verificadoEm: p.verificadoEm, assuntoEsaj: p.assuntoEsaj, classeEsaj: p.classeEsaj, alertaImportante: p.alertaImportante, id: p.id
        }));
        const todosProcessos = processoPrincipal.concat(processosExtras);

        const listaEsajHtml = todosProcessos.length
            ? `<div class="lista-multi">${todosProcessos.map(p => `
                <div class="lista-multi-item">
                    <a class="link-processo" href="https://www2.tjal.jus.br/cpopg/search.do?cbPesquisa=NUMPROC&dadosConsulta.valorConsultaNuUnificado=${encodeURIComponent(p.numeroProcessoEsaj)}&dadosConsulta.tipoNuProcesso=UNIFICADO" target="_blank" rel="noopener">${escaparHtml(p.numeroProcessoEsaj)}</a>
                    ${p.id ? `<button type="button" class="btn-excluir-processo-autor" data-processo-id="${p.id}" title="Remover este vínculo">✕</button>` : ''}
                </div>`).join('')}</div>`
            : '<span style="opacity:.5;">—</span>';
        const formAddProcesso = P3.Autores.usaApiPhp(cfgUnidade)
            ? `<div class="add-processo-manual">
                <input type="text" class="input-processo-manual-autor" data-autor-id="${escaparHtml(a._id)}" placeholder="nº processo e-SAJ">
                <button type="button" class="btn-add-processo-manual-autor" data-autor-id="${escaparHtml(a._id)}" title="Vincular este número de processo">+</button>
            </div>`
            : '';
        const numeroProcesso = listaEsajHtml + formAddProcesso;

        // Assunto/classe do e-SAJ (DataJud) ao lado da movimentação — pra
        // confrontar visualmente com a coluna Tipificação (dado local,
        // vindo da planilha/CAD) e pegar processo vinculado errado.
        const movimentacao = todosProcessos.length
            ? `<div class="lista-multi">${todosProcessos.map(p => {
                const atualizadoEm = formatarDataHoraIso(p.verificadoEm);
                const assuntoLinha = p.assuntoEsaj
                    ? `<div style="font-size:11px;color:#b26a00;margin-top:2px;" title="Confira contra a coluna Tipificação — dado local pode não bater com o processo vinculado">🔎 Assunto e-SAJ: ${escaparHtml(p.assuntoEsaj)}</div>`
                    : '';
                const alertaLinha = p.alertaImportante
                    ? `<div style="font-size:11px;color:#fff;background:#c0392b;padding:2px 6px;border-radius:4px;margin-top:3px;display:inline-block;" title="Evento importante detectado no processo — mandado, alvará, revogação de prisão etc.">🚨 ${escaparHtml(p.alertaImportante)}</div>`
                    : '';
                return `<div class="lista-multi-item">${p.movimentacaoAutor
                    ? escaparHtml(p.movimentacaoAutor) + (atualizadoEm ? `<div style="font-size:11px;opacity:.6;margin-top:2px;">atualizado em ${atualizadoEm}</div>` : '')
                    : '<span style="opacity:.5;">—</span>'}${assuntoLinha}${alertaLinha}</div>`;
            }).join('')}</div>`
            : '<span style="opacity:.5;">—</span>';

        let linhaCandidatos = '';
        if (status === 'pendente_revisao' && Array.isArray(a.candidatosEsaj) && a.candidatosEsaj.length) {
            const itens = a.candidatosEsaj.map((c, idx) => {
                const num = c.numeroProcesso || c.processoCodigo || '(sem número identificado)';
                const cpfInfo = c.cpfParte ? ` · CPF ${escaparHtml(c.cpfParte)}` : '';
                return `<div class="candidato-item">
                    <span>📄 ${escaparHtml(num)}${cpfInfo}</span>
                    <button type="button" class="btn-vincular-candidato" data-autor-id="${escaparHtml(a._id)}" data-idx="${idx}">Vincular este</button>
                </div>`;
            }).join('');
            linhaCandidatos = `<tr class="linha-candidatos" data-candidatos-de="${escaparHtml(a._id)}" style="display:none;">
                <td colspan="9">
                    <strong>Candidatos encontrados no e-SAJ para "${escaparHtml(a.NOME)}":</strong>
                    ${itens}
                    <button type="button" class="btn-nao-encontrado-manual" data-autor-id="${escaparHtml(a._id)}">Nenhum destes — marcar como não encontrado</button>
                </td>
            </tr>`;
        }

        return `<tr data-autor-id="${escaparHtml(a._id)}">
            <td>${escaparHtml(a.NOME)}</td>
            <td>${a.CPF ? escaparHtml(a.CPF) : '<span style="opacity:.5;">—</span>'}</td>
            <td data-cel-nome-mae="${escaparHtml(a._id)}">${celulaNomeMae(a)}</td>
            <td>${escaparHtml(a.BOLETIM || '—')}</td>
            <td>${escaparHtml(a.DATA || '—')}</td>
            <td>${a.TIPIFICACAO ? escaparHtml(a.TIPIFICACAO) : '<span style="opacity:.5;">—</span>'}</td>
            <td>${numeroProcesso}</td>
            <td>${movimentacao}</td>
            <td><span class="status-toggle" data-toggle-de="${escaparHtml(a._id)}">${badgeStatus(status)}</span></td>
        </tr>${linhaCandidatos}`;
    }).join('');
}

// ====================================================================
// AÇÕES — vínculo manual / marcar não encontrado / editar nome da mãe
// ====================================================================
async function vincularManualmente(idAutor, candidato) {
    const sessao = (window.P3 && P3.getSession) ? P3.getSession() : null;
    const numeroProcesso = candidato.numeroProcesso || candidato.processoCodigo || '';
    await P3.Autores.vincular(cfgUnidade, idAutor, {
        numeroProcesso,
        vinculadoPor: sessao ? sessao.cpf : null,
    });
    await carregarAutores();
}

async function marcarNaoEncontrado(idAutor) {
    await P3.Autores.marcarNaoEncontrado(cfgUnidade, idAutor);
    await carregarAutores();
}

// Processo EXTRA vinculado à mão — um autor pode ter mais de um processo
// e-SAJ de interesse (o vínculo automático do robô continua limitado a 1).
async function adicionarProcessoManualAutor(idAutor) {
    const input = document.querySelector(`.input-processo-manual-autor[data-autor-id="${CSS.escape(idAutor)}"]`);
    if (!input) return;
    const numero = input.value.trim();
    if (!numero) { input.focus(); return; }
    input.disabled = true;
    try {
        await P3.Autores.adicionarProcesso(cfgUnidade, idAutor, numero);
        await carregarAutores();
    } catch (e) {
        console.error('[autores] Erro ao adicionar processo manual:', e);
        alert('Erro ao vincular processo: ' + e.message);
        input.disabled = false;
    }
}

async function excluirProcessoAutor(processoId) {
    if (!confirm('Remover este vínculo de processo?')) return;
    await P3.Autores.excluirProcesso(cfgUnidade, processoId);
    await carregarAutores();
}

function abrirEdicaoNomeMae(idAutor) {
    const celula = document.querySelector(`[data-cel-nome-mae="${CSS.escape(idAutor)}"]`);
    if (!celula) return;
    const autor = todosAutores.find(a => a._id === idAutor);
    const valorAtual = (autor && autor.NOME_MAE) || '';
    celula.innerHTML = `<span class="nome-mae-edit">
        <input type="text" value="${escaparHtml(valorAtual)}" maxlength="255">
        <button type="button" class="btn-salvar-nome-mae" data-autor-id="${escaparHtml(idAutor)}">Salvar</button>
    </span>`;
    celula.querySelector('input').focus();
}

async function salvarNomeMae(idAutor) {
    const celula = document.querySelector(`[data-cel-nome-mae="${CSS.escape(idAutor)}"]`);
    if (!celula) return;
    const input = celula.querySelector('input');
    const valor = input ? input.value.trim() : '';
    try {
        await P3.Autores.atualizarNomeMae(cfgUnidade, idAutor, valor);
        const autor = todosAutores.find(a => a._id === idAutor);
        if (autor) autor.NOME_MAE = valor;
        celula.innerHTML = celulaNomeMae(autor || { _id: idAutor, NOME_MAE: valor });
    } catch (e) {
        console.error('[autores] Erro ao salvar nome da mãe:', e);
        alert('Erro ao salvar nome da mãe — tente novamente.');
    }
}

// ====================================================================
// "VERIFICAR AGORA" — força um lote no Apps Script (rota
// sincronizarAutoresAgora, forcar=true). O processamento roda em
// segundo plano no GAS, em lotes de AUTORES_BATCH_SIZE encadeados por
// gatilho a cada ~10s (pode levar vários minutos pra fila inteira
// zerar) — esta função só dispara o primeiro lote e depois FICA
// acompanhando o progresso via polling (refetch de P3.Autores.listar a
// cada 15s), comparando quem já tem verificadoEm mais recente que o
// instante do clique contra o total elegível calculado no cliente com a
// MESMA regra de elegibilidade do .gs (forcar=true): nunca verificado,
// OU já vinculado com numeroProcessoEsaj. Não há um endpoint de
// progresso de verdade no GAS — isso é a melhor aproximação possível
// sem mudar o backend.
//
// PERSISTÊNCIA (localStorage) — sem isso, recarregar a página (ou só
// trocar de aba e voltar depois de um tempo) perde as variáveis de
// polling em memória, e a barra some mesmo com o robô ainda processando
// o lote do outro lado (é exatamente isso que ficava "sem reconhecer"
// uma verificação já em andamento). Ao clicar, o estado (início, ids
// elegíveis, total) é salvo; no carregamento da página, se sobrar um
// estado salvo, o polling retoma sozinho, sem precisar clicar de novo.
// ====================================================================
let autoresVerificacaoEmAndamento = false;
let autoresPollTimer = null;
const AUTORES_VERIF_STORAGE_KEY = 'p3_autores_verificacao_ativa';
const AUTORES_VERIF_TETO_MS = 40 * 60 * 1000; // ~40 min desde o clique original — teto de segurança

function autorElegivelParaForcar(a) {
    if (!a || !a.NOME || a.NOME === '---') return false;
    if (!a.statusVinculoEsaj) return true;
    return a.statusVinculoEsaj === 'vinculado' && !!a.numeroProcessoEsaj;
}

// Barra só é mostrada enquanto a verificação está de fato em andamento —
// ao concluir, a barra some na hora (ver iniciarPollAutores) em vez de
// ficar "presa" mostrando 100%; quem sinaliza dados em dia é o
// "Atualizado em: HH:mm" (marcarAtualizadoEmAgora).
function atualizarBarraLiveAutores(processados, total) {
    const wrap = document.getElementById('autores-progresso-live-wrap');
    const fill = document.getElementById('autores-progresso-live-fill');
    const texto = document.getElementById('autores-progresso-live-texto');
    if (!wrap || !fill || !texto) return;
    if (!total) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'block';
    const pct = Math.min(100, Math.round((processados / total) * 100));
    fill.style.width = pct + '%';
    texto.textContent = `${processados} de ${total} (${pct}%) — atualizando a cada ~15s...`;
}

function pararPollAutores() {
    if (autoresPollTimer) { clearInterval(autoresPollTimer); autoresPollTimer = null; }
    autoresVerificacaoEmAndamento = false;
}

function salvarEstadoVerificacaoAutores(inicioMs, idsElegiveis, total) {
    try { localStorage.setItem(AUTORES_VERIF_STORAGE_KEY, JSON.stringify({ inicioMs, ids: idsElegiveis, total })); }
    catch (e) { /* localStorage indisponível/cheio — só perde a retomada após reload, não quebra nada */ }
}
function limparEstadoVerificacaoAutores() {
    try { localStorage.removeItem(AUTORES_VERIF_STORAGE_KEY); } catch (e) { /* idem acima */ }
}
function lerEstadoVerificacaoAutores() {
    try {
        const obj = JSON.parse(localStorage.getItem(AUTORES_VERIF_STORAGE_KEY) || 'null');
        if (!obj || !Array.isArray(obj.ids) || !obj.total || !obj.inicioMs) return null;
        return obj;
    } catch (e) { return null; }
}

// Núcleo do acompanhamento — usado tanto por um clique novo em "Verificar
// agora" quanto pela retomada automática no carregamento da página
// (quando sobra um estado salvo de uma verificação ainda não concluída).
function iniciarPollAutores(inicioMs, idsElegiveis, total) {
    const btn = document.getElementById('btn-autores-verificar-agora');
    const msg = document.getElementById('autores-status-msg');
    const prazoMs = inicioMs + AUTORES_VERIF_TETO_MS;

    autoresVerificacaoEmAndamento = true;
    if (btn) btn.disabled = true;
    salvarEstadoVerificacaoAutores(inicioMs, idsElegiveis, total);
    atualizarBarraLiveAutores(0, total);

    async function tick() {
        try {
            const dados = await P3.Autores.listar(cfgUnidade);
            processarDadosAutores(dados); // já atualiza tabela + barra de backlog geral
            const processados = idsElegiveis.reduce((n, id) => {
                const a = dados[id];
                return n + (a && a.verificadoEm && new Date(a.verificadoEm).getTime() >= inicioMs ? 1 : 0);
            }, 0);
            atualizarBarraLiveAutores(processados, total);

            if (processados >= total || Date.now() > prazoMs) {
                pararPollAutores();
                if (btn) btn.disabled = false;
                limparEstadoVerificacaoAutores();
                // Não deixa a barra "presa" na tela — some na hora; quem
                // informa que os dados estão em dia é só o "Atualizado
                // em: HH:mm" (marcarAtualizadoEmAgora, já chamado dentro
                // de processarDadosAutores logo acima).
                const wrap = document.getElementById('autores-progresso-live-wrap');
                if (wrap) wrap.style.display = 'none';
                if (msg) msg.textContent = '';
            }
        } catch (e) {
            console.error('[autores] Erro ao acompanhar progresso:', e);
        }
    }

    tick(); // roda já na hora — importante ao retomar após reload, pra não esperar 15s pra saber onde a barra está
    autoresPollTimer = setInterval(tick, 15000);
}

// ====================================================================
// DETECÇÃO PASSIVA — pega uma verificação que já esteja rodando em
// segundo plano SEM depender de localStorage (ex.: foi disparada antes
// desta versão da página existir, veio de outro navegador/dispositivo,
// ou é o próprio gatilho diário automático do GAS, não o botão). Sem
// isso, quem abre a página nesses casos via de um "nada acontecendo" —
// mesmo com o Apps Script de fato processando lotes do outro lado —
// porque não há nenhum sinal salvo pra retomar.
//
// Estratégia: tira uma "foto" do verificadoEm de cada autor elegível
// agora, espera ~20s, busca de novo e compara — se ALGUM verificadoEm
// mudou nesse intervalo, é prova de que o robô está de fato ativo agora
// mesmo, e daí liga o acompanhamento normal (iniciarPollAutores) a
// partir desse ponto em diante.
// ====================================================================
async function detectarAtividadeEmAndamentoAutores() {
    if (autoresVerificacaoEmAndamento) return; // já sendo acompanhada (clique ou retomada do localStorage)

    const referenciaMs = Date.now();
    const verificadoAntes = {};
    todosAutores.filter(autorElegivelParaForcar).forEach(a => { verificadoAntes[a._id] = a.verificadoEm || null; });
    if (!Object.keys(verificadoAntes).length) return; // nada elegível — nada pra detectar

    await new Promise(r => setTimeout(r, 20000));
    if (autoresVerificacaoEmAndamento) return; // usuário pode ter clicado "Verificar agora" nesse meio tempo

    try {
        const dados = await P3.Autores.listar(cfgUnidade);
        processarDadosAutores(dados);
        const mudou = Object.keys(verificadoAntes).some(id => {
            const atual = dados[id] && dados[id].verificadoEm;
            return atual && atual !== verificadoAntes[id];
        });
        if (mudou) {
            const idsElegiveisAgora = todosAutores.filter(autorElegivelParaForcar).map(a => a._id);
            if (idsElegiveisAgora.length) {
                const msg = document.getElementById('autores-status-msg');
                if (msg) msg.textContent = 'Sincronização em segundo plano detectada — acompanhando pela barra abaixo.';
                iniciarPollAutores(referenciaMs, idsElegiveisAgora, idsElegiveisAgora.length);
            }
        }
    } catch (e) {
        console.error('[autores] Erro ao detectar atividade em segundo plano:', e);
    }
}

async function verificarAgora() {
    const msg = document.getElementById('autores-status-msg');
    if (!GAS_AUTORES_URL) {
        msg.textContent = 'Apps Script de Autores/Suspeitos não configurado para esta unidade.';
        return;
    }
    if (autoresVerificacaoEmAndamento) {
        msg.textContent = 'Já existe uma verificação em andamento — acompanhe pela barra abaixo.';
        return;
    }

    const idsElegiveis = todosAutores.filter(autorElegivelParaForcar).map(a => a._id);
    const total = idsElegiveis.length;
    if (!total) {
        msg.textContent = 'Nada elegível pra verificar agora (todos os pendentes de revisão/não encontrados só saem por ação manual).';
        setTimeout(() => { msg.textContent = ''; }, 6000);
        return;
    }

    msg.textContent = 'Forçando verificação — os mais desatualizados primeiro; acompanhe pela barra abaixo.';

    try {
        await fetch(`${GAS_AUTORES_URL}?action=sincronizarAutoresAgora`);
    } catch (e) {
        console.error('[autores] Erro em verificarAgora:', e);
        msg.textContent = 'Erro ao acionar a verificação — tente novamente em instantes.';
        return;
    }

    iniciarPollAutores(Date.now(), idsElegiveis, total);
}

// ====================================================================
// BOOT
// ====================================================================
document.addEventListener('DOMContentLoaded', async function () {
    if (!P3.requireAuth()) return;

    let cfg = null;
    try { cfg = await P3.loadUnidadeConfig(); } catch (e) { console.warn('[autores] loadUnidadeConfig:', e.message); }
    cfgUnidade = cfg;
    GAS_AUTORES_URL = cfg && cfg.gas ? cfg.gas.AUTORES : null;

    const temFonte = cfg && (P3.Autores.usaApiPhp(cfg) || (cfg.firebase && cfg.firebase.databaseURL));
    if (!temFonte) {
        document.getElementById('autores-tbody').innerHTML =
            '<tr><td colspan="9" class="empty-msg">Configuração da unidade indisponível — não foi possível carregar os autores.</td></tr>';
        return;
    }

    const btnVerificar = document.getElementById('btn-autores-verificar-agora');

    document.getElementById('autores-filtro-texto').addEventListener('input', function (e) {
        filtroTexto = e.target.value;
        aplicarFiltros();
    });
    document.getElementById('autores-filtro-status').addEventListener('change', function (e) {
        filtroStatus = e.target.value;
        aplicarFiltros();
    });
    btnVerificar.addEventListener('click', verificarAgora);

    // Delegação de eventos — a tabela é reconstruída via innerHTML a
    // cada render, então listeners individuais por linha se perderiam.
    document.getElementById('autores-tbody').addEventListener('click', function (e) {
        const valorNomeMae = e.target.closest('.nome-mae-valor');
        if (valorNomeMae) {
            abrirEdicaoNomeMae(valorNomeMae.dataset.nomeMaeDe);
            return;
        }
        const btnSalvarNomeMae = e.target.closest('.btn-salvar-nome-mae');
        if (btnSalvarNomeMae) {
            salvarNomeMae(btnSalvarNomeMae.dataset.autorId);
            return;
        }
        const toggle = e.target.closest('.status-toggle');
        if (toggle) {
            const id = toggle.dataset.toggleDe;
            const linha = document.querySelector(`.linha-candidatos[data-candidatos-de="${CSS.escape(id)}"]`);
            if (linha) linha.style.display = linha.style.display === 'none' ? 'table-row' : 'none';
            return;
        }
        const btnVincular = e.target.closest('.btn-vincular-candidato');
        if (btnVincular) {
            const idAutor = btnVincular.dataset.autorId;
            const idx = parseInt(btnVincular.dataset.idx, 10);
            const autor = todosAutores.find(a => a._id === idAutor);
            const candidato = autor && Array.isArray(autor.candidatosEsaj) ? autor.candidatosEsaj[idx] : null;
            if (autor && candidato) vincularManualmente(idAutor, candidato);
            return;
        }
        const btnNaoEncontrado = e.target.closest('.btn-nao-encontrado-manual');
        if (btnNaoEncontrado) {
            marcarNaoEncontrado(btnNaoEncontrado.dataset.autorId);
            return;
        }
        const btnAddProcesso = e.target.closest('.btn-add-processo-manual-autor');
        if (btnAddProcesso) { adicionarProcessoManualAutor(btnAddProcesso.dataset.autorId); return; }

        const btnExclProcesso = e.target.closest('.btn-excluir-processo-autor');
        if (btnExclProcesso) { excluirProcessoAutor(btnExclProcesso.dataset.processoId); }
    });

    // Enter no campo de processo manual também vincula (sem precisar
    // clicar no "+") — delegado porque a tabela é reconstruída a cada render.
    document.getElementById('autores-tbody').addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && e.target.classList.contains('input-processo-manual-autor')) {
            e.preventDefault();
            adicionarProcessoManualAutor(e.target.dataset.autorId);
        }
    });

    await carregarAutores();

    // Retoma sozinho o acompanhamento de uma verificação que ainda esteja
    // rodando em segundo plano no Apps Script (ex.: a página foi
    // recarregada ou reaberta antes do lote inteiro terminar) — sem isso
    // a barra simplesmente não aparecia, mesmo com o robô continuando a
    // processar do outro lado.
    const estadoVerifSalvo = lerEstadoVerificacaoAutores();
    if (estadoVerifSalvo && !autoresVerificacaoEmAndamento) {
        const msg = document.getElementById('autores-status-msg');
        if (msg) msg.textContent = 'Retomando o acompanhamento de uma verificação em andamento...';
        iniciarPollAutores(estadoVerifSalvo.inicioMs, estadoVerifSalvo.ids, estadoVerifSalvo.total);
    } else {
        // Sem estado salvo — não significa que nada está rodando (pode
        // ser um lote iniciado antes desta versão da página, de outro
        // navegador, ou o próprio gatilho automático). Fire-and-forget:
        // não trava o boot, só liga a barra sozinha se detectar mudanças.
        detectarAtividadeEmAndamentoAutores();
    }
});
