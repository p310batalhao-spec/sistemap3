// ====================================================================
// Sistema P3 — Suspeitos (cadastro manual + vínculo e-SAJ/DataJud)
// ====================================================================
// Recurso exclusivo do 10º BPM (só existe na API PHP/MySQL da Hostinger,
// sem equivalente Firebase — ver P3.Suspeitos em js/core/session.js).
// Diferente de Autores: cadastro manual (não vem de planilha) e
// agrupado por PESSOA — uma pessoa pode ter vários processos e-SAJ
// vinculados ao longo do tempo. A descoberta/checagem de movimentação é
// feita pelo mesmo Apps Script de Autores (bloco separado, ver
// apps-script/suspeitos-esaj-hostinger.gs).

let cfgUnidadeSuspeitos = null;
// Projeto Apps Script PRÓPRIO de Autores/Suspeitos (separado do de TCO,
// ver hostinger-api/DEPLOY.md) — mesma URL usada em js/autores.js.
let GAS_AUTORES_URL_SUSPEITOS = null;
let todosSuspeitos = [];
let filtroTextoSuspeitos = '';

function escaparHtmlSusp(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function normalizarBuscaSusp(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

function formatarDataHoraIsoSusp(iso) {
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
// buscados do servidor" (ver mesmo padrão/motivo em js/autores.js:
// marcarAtualizadoEmAgora) — substitui mensagens de conclusão que
// ficavam presas na tela.
function marcarAtualizadoEmAgoraSuspeitos() {
    const el = document.getElementById('suspeitos-atualizado-em');
    if (!el) return;
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    el.textContent = `Atualizado em: ${hh}:${mm}`;
}

// ====================================================================
// CARREGAMENTO
// ====================================================================
// Separado de carregarSuspeitos() pra ser reaproveitado pelo polling de
// progresso do "Verificar agora" (verificarAgoraSuspeitos) — ver mesmo
// padrão em js/autores.js (processarDadosAutores).
function processarDadosSuspeitos(dados) {
    todosSuspeitos = Object.keys(dados).map(id => dados[id]).sort((a, b) => (a.NOME || '').localeCompare(b.NOME || ''));
    aplicarFiltrosSuspeitos();
    marcarAtualizadoEmAgoraSuspeitos();
}

async function carregarSuspeitos() {
    const tbody = document.getElementById('suspeitos-tbody');
    tbody.innerHTML = '<tr><td colspan="6" class="empty-msg">Carregando...</td></tr>';
    try {
        const dados = await P3.Suspeitos.listar(cfgUnidadeSuspeitos);
        processarDadosSuspeitos(dados);
    } catch (e) {
        console.error('[suspeitos] Erro ao carregar:', e);
        tbody.innerHTML = `<tr><td colspan="6" class="empty-msg">Erro ao carregar suspeitos: ${escaparHtmlSusp(e.message)}</td></tr>`;
    }
}

function aplicarFiltrosSuspeitos() {
    const textoNorm = normalizarBuscaSusp(filtroTextoSuspeitos);
    const lista = todosSuspeitos.filter(s => {
        if (!textoNorm) return true;
        const alvo = normalizarBuscaSusp((s.NOME || '') + ' ' + (s.CPF || ''));
        return alvo.indexOf(textoNorm) !== -1;
    });
    renderizarTabelaSuspeitos(lista);
}

// ====================================================================
// RENDER
// ====================================================================
function badgeStatusSuspeito(s) {
    const n = (s.processos || []).length;
    if (n > 0) return `<span class="status-badge status-vinculado">Vinculado (${n})</span>`;
    const status = s.statusBusca || 'nao_verificado';
    const rotulos = {
        pendente_revisao: 'Pendente de revisão',
        nao_encontrado: 'Não encontrado',
        nao_verificado: 'Não verificado ainda',
    };
    return `<span class="status-badge status-${status}"${status === 'pendente_revisao' ? ' title="Clique para ver os candidatos"' : ''}>${rotulos[status] || status}</span>`;
}

function renderizarTabelaSuspeitos(lista) {
    const tbody = document.getElementById('suspeitos-tbody');
    if (!lista.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-msg">Nenhum suspeito cadastrado com esse filtro.</td></tr>';
        return;
    }

    tbody.innerHTML = lista.map(s => {
        const processos = s.processos || [];
        const status = s.statusBusca || (processos.length ? 'vinculado' : 'nao_verificado');

        const listaProcessosHtml = processos.length
            ? `<div class="lista-multi">${processos.map(p => `
                <div class="lista-multi-item">
                    <a class="link-processo" href="https://www2.tjal.jus.br/cpopg/search.do?cbPesquisa=NUMPROC&dadosConsulta.valorConsultaNuUnificado=${encodeURIComponent(p.numeroProcessoEsaj)}&dadosConsulta.tipoNuProcesso=UNIFICADO" target="_blank" rel="noopener">${escaparHtmlSusp(p.numeroProcessoEsaj)}</a>
                    <button type="button" class="btn-excluir-processo" data-processo-id="${p.id}" title="Remover este vínculo">✕</button>
                </div>`).join('')}</div>`
            : '<span style="opacity:.5;">—</span>';
        // Inserção manual — sempre disponível, independente de já ter
        // processo(s) vinculado(s) ou não (pedido explícito: uma pessoa
        // pode ter vários números de processo e-SAJ de interesse pro
        // mesmo CPF, adicionados à mão em vez de esperar a descoberta
        // automática do Apps Script).
        const colunaEsaj = `${listaProcessosHtml}
            <div class="add-processo-manual">
                <input type="text" class="input-processo-manual" data-suspeito-id="${s.id}" placeholder="nº processo e-SAJ">
                <button type="button" class="btn-add-processo-manual" data-suspeito-id="${s.id}" title="Vincular este número de processo">+</button>
            </div>`;

        const colunaMovimentacao = processos.length
            ? `<div class="lista-multi">${processos.map(p => {
                const atualizadoEm = formatarDataHoraIsoSusp(p.verificadoEm);
                const assuntoLinha = p.assuntoEsaj
                    ? `<div style="font-size:11px;color:#b26a00;margin-top:2px;" title="Assunto do processo no DataJud — confira se bate com o motivo real do vínculo">🔎 Assunto e-SAJ: ${escaparHtmlSusp(p.assuntoEsaj)}</div>`
                    : '';
                const alertaLinha = p.alertaImportante
                    ? `<div style="font-size:11px;color:#fff;background:#c0392b;padding:2px 6px;border-radius:4px;margin-top:3px;display:inline-block;" title="Evento importante detectado no processo — mandado, alvará, revogação de prisão etc.">🚨 ${escaparHtmlSusp(p.alertaImportante)}</div>`
                    : '';
                return `<div class="lista-multi-item">${p.movimentacaoProcesso
                    ? escaparHtmlSusp(p.movimentacaoProcesso) + (atualizadoEm ? `<div style="font-size:11px;opacity:.6;margin-top:2px;">atualizado em ${atualizadoEm}</div>` : '')
                    : '<span style="opacity:.5;">—</span>'}${assuntoLinha}${alertaLinha}</div>`;
            }).join('')}</div>`
            : '<span style="opacity:.5;">—</span>';

        let linhaCandidatos = '';
        if (status === 'pendente_revisao' && Array.isArray(s.candidatosEsaj) && s.candidatosEsaj.length) {
            const itens = s.candidatosEsaj.map((c, idx) => {
                const num = c.numeroProcesso || c.processoCodigo || '(sem número identificado)';
                const cpfInfo = c.cpfParte ? ` · CPF ${escaparHtmlSusp(c.cpfParte)}` : '';
                return `<div class="candidato-item">
                    <span>📄 ${escaparHtmlSusp(num)}${cpfInfo}</span>
                    <button type="button" class="btn-vincular-candidato-susp" data-suspeito-id="${s.id}" data-idx="${idx}">Vincular este</button>
                </div>`;
            }).join('');
            linhaCandidatos = `<tr class="linha-candidatos" data-candidatos-susp-de="${s.id}" style="display:none;">
                <td colspan="6">
                    <strong>Candidatos encontrados no e-SAJ para "${escaparHtmlSusp(s.NOME)}":</strong>
                    ${itens}
                    <button type="button" class="btn-nao-encontrado-manual-susp" data-suspeito-id="${s.id}">Nenhum destes — marcar como não encontrado</button>
                </td>
            </tr>`;
        }

        return `<tr data-suspeito-id="${s.id}">
            <td>${escaparHtmlSusp(s.NOME)}</td>
            <td>${s.CPF ? escaparHtmlSusp(s.CPF) : '<span style="opacity:.5;">—</span>'}</td>
            <td>${colunaEsaj}</td>
            <td>${colunaMovimentacao}</td>
            <td><span class="status-toggle-susp" data-toggle-susp-de="${s.id}">${badgeStatusSuspeito(s)}</span></td>
            <td><button type="button" class="btn-excluir-suspeito" data-suspeito-id="${s.id}" title="Excluir suspeito e todos os vínculos">🗑</button></td>
        </tr>${linhaCandidatos}`;
    }).join('');
}

// ====================================================================
// AÇÕES
// ====================================================================
async function salvarNovoSuspeito() {
    const nomeInput = document.getElementById('novo-suspeito-nome');
    const cpfInput = document.getElementById('novo-suspeito-cpf');
    const msg = document.getElementById('suspeitos-status-msg');
    const nome = nomeInput.value.trim();
    const cpf = cpfInput.value.trim();
    if (!nome) { msg.textContent = 'Informe o nome.'; return; }

    const btn = document.getElementById('btn-salvar-novo-suspeito');
    btn.disabled = true;
    try {
        await P3.Suspeitos.criar(cfgUnidadeSuspeitos, { nome, cpf });
        nomeInput.value = '';
        cpfInput.value = '';
        document.getElementById('form-novo-suspeito').classList.remove('aberto');
        msg.textContent = 'Suspeito cadastrado.';
        setTimeout(() => { msg.textContent = ''; }, 5000);
        await carregarSuspeitos();
    } catch (e) {
        msg.textContent = e.message || 'Erro ao cadastrar suspeito.';
    } finally {
        btn.disabled = false;
    }
}

async function vincularCandidatoSuspeito(suspeitoId, candidato) {
    const numero = candidato.numeroProcesso || candidato.processoCodigo || '';
    await P3.Suspeitos.vincularProcesso(cfgUnidadeSuspeitos, suspeitoId, numero, 'manual');
    await carregarSuspeitos();
}

// Inserção manual de nº de processo e-SAJ — a pessoa pode ter vários
// processos de interesse pro mesmo CPF, sem depender só da descoberta
// automática do Apps Script.
async function adicionarProcessoManual(suspeitoId) {
    const input = document.querySelector(`.input-processo-manual[data-suspeito-id="${CSS.escape(suspeitoId)}"]`);
    if (!input) return;
    const numero = input.value.trim();
    if (!numero) { input.focus(); return; }
    input.disabled = true;
    try {
        await P3.Suspeitos.vincularProcesso(cfgUnidadeSuspeitos, suspeitoId, numero, 'manual');
        await carregarSuspeitos();
    } catch (e) {
        console.error('[suspeitos] Erro ao adicionar processo manual:', e);
        alert('Erro ao vincular processo: ' + e.message);
        input.disabled = false;
    }
}

async function marcarNaoEncontradoSuspeito(suspeitoId) {
    await P3.Suspeitos.marcarNaoEncontrado(cfgUnidadeSuspeitos, suspeitoId);
    await carregarSuspeitos();
}

async function excluirProcessoSuspeito(processoId) {
    if (!confirm('Remover este vínculo de processo?')) return;
    await P3.Suspeitos.excluirProcesso(cfgUnidadeSuspeitos, processoId);
    await carregarSuspeitos();
}

async function excluirSuspeito(suspeitoId) {
    if (!confirm('Excluir este suspeito e todos os processos vinculados a ele?')) return;
    await P3.Suspeitos.excluirSuspeito(cfgUnidadeSuspeitos, suspeitoId);
    await carregarSuspeitos();
}

// Mesmo mecanismo do botão "Verificar agora" de Autores (ver
// js/autores.js:verificarAgora, comentário mais detalhado lá) — força um
// lote no Apps Script (rota sincronizarSuspeitosAgora, forcar=true) e
// acompanha o progresso em segundo plano via polling, comparando quem já
// tem verificadoEm mais recente que o clique contra o total elegível.
//
// Diferença de Autores: a fila do lado do .gs mistura 2 tipos de item —
// "descoberta" (1 por PESSOA sem processo/statusBusca ainda) e
// "movimentação" (1 por PROCESSO já vinculado, já que uma pessoa pode
// ter vários) — então rastreio os dois tipos de id separadamente.
let suspeitosVerificacaoEmAndamento = false;
let suspeitosPollTimer = null;
const SUSPEITOS_VERIF_STORAGE_KEY = 'p3_suspeitos_verificacao_ativa';
const SUSPEITOS_VERIF_TETO_MS = 40 * 60 * 1000; // ~40 min desde o clique original — teto de segurança

function suspeitosIdsElegiveisParaForcar() {
    const idsDescoberta = [];
    const idsProcesso = [];
    todosSuspeitos.forEach(s => {
        if (!s || !s.NOME) return;
        const processos = s.processos || [];
        if (!processos.length && !s.statusBusca) idsDescoberta.push(s.id);
        processos.forEach(p => idsProcesso.push(p.id)); // forcar=true força TODOS os processos, sem janela de recheque
    });
    return { idsDescoberta, idsProcesso };
}

// Barra só é mostrada enquanto a verificação está de fato em andamento —
// ao concluir, some na hora (ver iniciarPollSuspeitos) em vez de ficar
// "presa" mostrando 100%; quem sinaliza dados em dia é o "Atualizado em:
// HH:mm" (marcarAtualizadoEmAgoraSuspeitos).
function atualizarBarraLiveSuspeitos(processados, total) {
    const wrap = document.getElementById('suspeitos-progresso-live-wrap');
    const fill = document.getElementById('suspeitos-progresso-live-fill');
    const texto = document.getElementById('suspeitos-progresso-live-texto');
    if (!wrap || !fill || !texto) return;
    if (!total) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'block';
    const pct = Math.min(100, Math.round((processados / total) * 100));
    fill.style.width = pct + '%';
    texto.textContent = `${processados} de ${total} (${pct}%) — atualizando a cada ~15s...`;
}

function pararPollSuspeitos() {
    if (suspeitosPollTimer) { clearInterval(suspeitosPollTimer); suspeitosPollTimer = null; }
    suspeitosVerificacaoEmAndamento = false;
}

function salvarEstadoVerificacaoSuspeitos(inicioMs, idsDescoberta, idsProcesso, total) {
    try { localStorage.setItem(SUSPEITOS_VERIF_STORAGE_KEY, JSON.stringify({ inicioMs, idsDescoberta, idsProcesso, total })); }
    catch (e) { /* localStorage indisponível/cheio — só perde a retomada após reload, não quebra nada */ }
}
function limparEstadoVerificacaoSuspeitos() {
    try { localStorage.removeItem(SUSPEITOS_VERIF_STORAGE_KEY); } catch (e) { /* idem acima */ }
}
function lerEstadoVerificacaoSuspeitos() {
    try {
        const obj = JSON.parse(localStorage.getItem(SUSPEITOS_VERIF_STORAGE_KEY) || 'null');
        if (!obj || !Array.isArray(obj.idsDescoberta) || !Array.isArray(obj.idsProcesso) || !obj.total || !obj.inicioMs) return null;
        return obj;
    } catch (e) { return null; }
}

// Núcleo do acompanhamento — usado tanto por um clique novo em "Verificar
// agora" quanto pela retomada automática no carregamento da página (ver
// mesmo padrão em js/autores.js:iniciarPollAutores).
function iniciarPollSuspeitos(inicioMs, idsDescoberta, idsProcesso, total) {
    const btn = document.getElementById('btn-suspeitos-verificar-agora');
    const msg = document.getElementById('suspeitos-status-msg');
    const prazoMs = inicioMs + SUSPEITOS_VERIF_TETO_MS;

    suspeitosVerificacaoEmAndamento = true;
    if (btn) btn.disabled = true;
    salvarEstadoVerificacaoSuspeitos(inicioMs, idsDescoberta, idsProcesso, total);
    atualizarBarraLiveSuspeitos(0, total);

    async function tick() {
        try {
            const dados = await P3.Suspeitos.listar(cfgUnidadeSuspeitos);
            processarDadosSuspeitos(dados); // já atualiza a tabela

            // Processo -> flat lookup pra achar verificadoEm de cada um.
            const processoPorId = {};
            Object.keys(dados).forEach(id => {
                (dados[id].processos || []).forEach(p => { processoPorId[p.id] = p; });
            });

            const processadosDescoberta = idsDescoberta.reduce((n, id) => {
                const s = dados[id];
                return n + (s && s.verificadoEm && new Date(s.verificadoEm).getTime() >= inicioMs ? 1 : 0);
            }, 0);
            const processadosMov = idsProcesso.reduce((n, id) => {
                const p = processoPorId[id];
                return n + (p && p.verificadoEm && new Date(p.verificadoEm).getTime() >= inicioMs ? 1 : 0);
            }, 0);
            const processados = processadosDescoberta + processadosMov;
            atualizarBarraLiveSuspeitos(processados, total);

            if (processados >= total || Date.now() > prazoMs) {
                pararPollSuspeitos();
                if (btn) btn.disabled = false;
                limparEstadoVerificacaoSuspeitos();
                // Não deixa a barra presa — some na hora; o "Atualizado
                // em: HH:mm" (já atualizado dentro de processarDadosSuspeitos
                // logo acima) é quem informa que os dados estão em dia.
                const wrap = document.getElementById('suspeitos-progresso-live-wrap');
                if (wrap) wrap.style.display = 'none';
                if (msg) msg.textContent = '';
            }
        } catch (e) {
            console.error('[suspeitos] Erro ao acompanhar progresso:', e);
        }
    }

    tick(); // roda já na hora — importante ao retomar após reload
    suspeitosPollTimer = setInterval(tick, 15000);
}

// Pega uma verificação já rodando em segundo plano sem depender de
// localStorage (ver mesmo mecanismo/motivo em
// js/autores.js:detectarAtividadeEmAndamentoAutores).
async function detectarAtividadeEmAndamentoSuspeitos() {
    if (suspeitosVerificacaoEmAndamento) return;

    const referenciaMs = Date.now();
    const { idsDescoberta, idsProcesso } = suspeitosIdsElegiveisParaForcar();
    if (!idsDescoberta.length && !idsProcesso.length) return;

    const verificadoAntesDescoberta = {};
    const verificadoAntesProcesso = {};
    todosSuspeitos.forEach(s => {
        if (idsDescoberta.includes(s.id)) verificadoAntesDescoberta[s.id] = s.verificadoEm || null;
        (s.processos || []).forEach(p => { if (idsProcesso.includes(p.id)) verificadoAntesProcesso[p.id] = p.verificadoEm || null; });
    });

    await new Promise(r => setTimeout(r, 20000));
    if (suspeitosVerificacaoEmAndamento) return;

    try {
        const dados = await P3.Suspeitos.listar(cfgUnidadeSuspeitos);
        processarDadosSuspeitos(dados);

        const processoPorId = {};
        Object.keys(dados).forEach(id => { (dados[id].processos || []).forEach(p => { processoPorId[p.id] = p; }); });

        const mudouDescoberta = Object.keys(verificadoAntesDescoberta).some(id => {
            const atual = dados[id] && dados[id].verificadoEm;
            return atual && atual !== verificadoAntesDescoberta[id];
        });
        const mudouProcesso = Object.keys(verificadoAntesProcesso).some(id => {
            const atual = processoPorId[id] && processoPorId[id].verificadoEm;
            return atual && atual !== verificadoAntesProcesso[id];
        });

        if (mudouDescoberta || mudouProcesso) {
            const nova = suspeitosIdsElegiveisParaForcar();
            const totalNovo = nova.idsDescoberta.length + nova.idsProcesso.length;
            if (totalNovo) {
                const msg = document.getElementById('suspeitos-status-msg');
                if (msg) msg.textContent = 'Sincronização em segundo plano detectada — acompanhando pela barra abaixo.';
                iniciarPollSuspeitos(referenciaMs, nova.idsDescoberta, nova.idsProcesso, totalNovo);
            }
        }
    } catch (e) {
        console.error('[suspeitos] Erro ao detectar atividade em segundo plano:', e);
    }
}

async function verificarAgoraSuspeitos() {
    const msg = document.getElementById('suspeitos-status-msg');
    if (!GAS_AUTORES_URL_SUSPEITOS) {
        msg.textContent = 'Apps Script de Autores/Suspeitos não configurado para esta unidade.';
        return;
    }
    if (suspeitosVerificacaoEmAndamento) {
        msg.textContent = 'Já existe uma verificação em andamento — acompanhe pela barra abaixo.';
        return;
    }

    const { idsDescoberta, idsProcesso } = suspeitosIdsElegiveisParaForcar();
    const total = idsDescoberta.length + idsProcesso.length;
    if (!total) {
        msg.textContent = 'Nada elegível pra verificar agora.';
        setTimeout(() => { msg.textContent = ''; }, 6000);
        return;
    }

    msg.textContent = 'Forçando verificação — os mais desatualizados primeiro; acompanhe pela barra abaixo.';

    try {
        await fetch(`${GAS_AUTORES_URL_SUSPEITOS}?action=sincronizarSuspeitosAgora`);
    } catch (e) {
        console.error('[suspeitos] Erro em verificarAgoraSuspeitos:', e);
        msg.textContent = 'Erro ao acionar a verificação — tente novamente em instantes.';
        return;
    }

    iniciarPollSuspeitos(Date.now(), idsDescoberta, idsProcesso, total);
}

// ====================================================================
// BOOT
// ====================================================================
document.addEventListener('DOMContentLoaded', async function () {
    if (!P3.requireAuth()) return;

    let cfg = null;
    try { cfg = await P3.loadUnidadeConfig(); } catch (e) { console.warn('[suspeitos] loadUnidadeConfig:', e.message); }
    cfgUnidadeSuspeitos = cfg;
    GAS_AUTORES_URL_SUSPEITOS = cfg && cfg.gas ? cfg.gas.AUTORES : null;

    if (!cfg || !P3.Suspeitos.disponivel(cfg)) {
        // Recurso exclusivo do 10º BPM — some a aba inteira nas demais unidades.
        const abaBtn = document.getElementById('aba-btn-suspeitos');
        if (abaBtn) abaBtn.style.display = 'none';
        return;
    }

    document.getElementById('suspeitos-filtro-texto').addEventListener('input', function (e) {
        filtroTextoSuspeitos = e.target.value;
        aplicarFiltrosSuspeitos();
    });

    document.getElementById('btn-suspeitos-novo').addEventListener('click', function () {
        document.getElementById('form-novo-suspeito').classList.toggle('aberto');
    });
    document.getElementById('btn-cancelar-novo-suspeito').addEventListener('click', function () {
        document.getElementById('form-novo-suspeito').classList.remove('aberto');
    });
    document.getElementById('btn-salvar-novo-suspeito').addEventListener('click', salvarNovoSuspeito);
    document.getElementById('btn-suspeitos-verificar-agora').addEventListener('click', verificarAgoraSuspeitos);

    document.getElementById('suspeitos-tbody').addEventListener('click', function (e) {
        const toggle = e.target.closest('.status-toggle-susp');
        if (toggle) {
            const id = toggle.dataset.toggleSuspDe;
            const linha = document.querySelector(`.linha-candidatos[data-candidatos-susp-de="${CSS.escape(id)}"]`);
            if (linha) linha.style.display = linha.style.display === 'none' ? 'table-row' : 'none';
            return;
        }
        const btnVincular = e.target.closest('.btn-vincular-candidato-susp');
        if (btnVincular) {
            const suspeitoId = btnVincular.dataset.suspeitoId;
            const idx = parseInt(btnVincular.dataset.idx, 10);
            const suspeito = todosSuspeitos.find(s => String(s.id) === String(suspeitoId));
            const candidato = suspeito && Array.isArray(suspeito.candidatosEsaj) ? suspeito.candidatosEsaj[idx] : null;
            if (suspeito && candidato) vincularCandidatoSuspeito(suspeitoId, candidato);
            return;
        }
        const btnNaoEncontrado = e.target.closest('.btn-nao-encontrado-manual-susp');
        if (btnNaoEncontrado) { marcarNaoEncontradoSuspeito(btnNaoEncontrado.dataset.suspeitoId); return; }

        const btnExclProc = e.target.closest('.btn-excluir-processo');
        if (btnExclProc) { excluirProcessoSuspeito(btnExclProc.dataset.processoId); return; }

        const btnExclSusp = e.target.closest('.btn-excluir-suspeito');
        if (btnExclSusp) { excluirSuspeito(btnExclSusp.dataset.suspeitoId); return; }

        const btnAddProcesso = e.target.closest('.btn-add-processo-manual');
        if (btnAddProcesso) { adicionarProcessoManual(btnAddProcesso.dataset.suspeitoId); return; }
    });

    // Enter no campo de processo manual também vincula (sem precisar
    // clicar no "+") — delegado porque a tabela é reconstruída a cada render.
    document.getElementById('suspeitos-tbody').addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && e.target.classList.contains('input-processo-manual')) {
            e.preventDefault();
            adicionarProcessoManual(e.target.dataset.suspeitoId);
        }
    });

    await carregarSuspeitos();

    // Retoma sozinho o acompanhamento de uma verificação que ainda esteja
    // rodando em segundo plano (ver mesmo mecanismo/motivo em
    // js/autores.js, boot).
    const estadoVerifSalvo = lerEstadoVerificacaoSuspeitos();
    if (estadoVerifSalvo && !suspeitosVerificacaoEmAndamento) {
        const msg = document.getElementById('suspeitos-status-msg');
        if (msg) msg.textContent = 'Retomando o acompanhamento de uma verificação em andamento...';
        iniciarPollSuspeitos(estadoVerifSalvo.inicioMs, estadoVerifSalvo.idsDescoberta, estadoVerifSalvo.idsProcesso, estadoVerifSalvo.total);
    } else {
        detectarAtividadeEmAndamentoSuspeitos();
    }
});
