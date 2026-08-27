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
let filtroFotoCadSuspeitos = '';

// Ver comentário equivalente em js/autores.js:AUTORES_ULTIMA_ATUALIZACAO_KEY.
const SUSPEITOS_ULTIMA_ATUALIZACAO_KEY = 'p3_suspeitos_ultima_atualizacao';

// Fotos/detecções de rosto escolhidas no modal "Novo suspeito"/"Adicionar
// fotos" (ver abrirModalSuspeito/salvarNovoSuspeito abaixo) — guardadas em
// memória (não dá pra jogar File no HTML), zeradas a cada abertura do
// modal. Alinhadas por índice: msDescritoresFoto[i] é o descritor (ou
// null) de msArquivosFoto[i].
let msArquivosFoto = [];
let msDescritoresFoto = [];

function escaparHtmlSusp(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function normalizarBuscaSusp(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

// Ver comentário equivalente em js/autores.js:celulaMovimentacaoTexto —
// mesma lógica (título compacto na tabela + narrativa truncada com o
// texto inteiro no hover), duplicada aqui pelo mesmo motivo de
// escaparHtmlSusp/formatarDataHoraIsoSusp (arquivos sem módulo
// compartilhado entre si).
const MOVIMENTACAO_NARRATIVA_MAX_SUSP = 140;
function celulaMovimentacaoTextoSusp(texto) {
    if (!texto) return '<span style="opacity:.5;">—</span>';
    const partes = String(texto).split('\n');
    const titulo = escaparHtmlSusp(partes[0]);
    const narrativa = partes.slice(1).join(' ').trim();
    if (!narrativa) return titulo;
    const truncada = narrativa.length > MOVIMENTACAO_NARRATIVA_MAX_SUSP
        ? narrativa.slice(0, MOVIMENTACAO_NARRATIVA_MAX_SUSP) + '…'
        : narrativa;
    return `${titulo}<div style="font-size:11px;opacity:.75;margin-top:2px;" title="${escaparHtmlSusp(narrativa)}">${escaparHtmlSusp(truncada)}</div>`;
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
    tbody.innerHTML = '<tr><td colspan="10" class="empty-msg">Carregando...</td></tr>';
    try {
        const dados = await P3.Suspeitos.listar(cfgUnidadeSuspeitos);
        processarDadosSuspeitos(dados);
    } catch (e) {
        console.error('[suspeitos] Erro ao carregar:', e);
        tbody.innerHTML = `<tr><td colspan="10" class="empty-msg">Erro ao carregar suspeitos: ${escaparHtmlSusp(e.message)}</td></tr>`;
    }
}

function aplicarFiltrosSuspeitos() {
    const textoNorm = normalizarBuscaSusp(filtroTextoSuspeitos);
    const lista = todosSuspeitos.filter(s => {
        if (filtroFotoCadSuspeitos === 'sem_foto' && s.vetorFacialEm) return false;
        if (filtroFotoCadSuspeitos === 'com_foto' && !s.vetorFacialEm) return false;
        if (!textoNorm) return true;
        // Inclui a movimentação de TODOS os processos da pessoa (1:N —
        // diferente de Autores, aqui não existe "processo principal") —
        // mesmo espírito de js/autores.js:aplicarFiltros, pra dar pra
        // buscar por "alvará"/"expedição de mandado" etc.
        const movimentacoes = (Array.isArray(s.processos) ? s.processos : [])
            .map(p => p.movimentacaoProcesso).filter(Boolean).join(' ');
        const alvo = normalizarBuscaSusp([s.NOME, s.CPF, movimentacoes].filter(Boolean).join(' '));
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

// Mesmo papel de celulaFotoCad em js/autores.js — ver comentário lá.
function celulaFotoCadSuspeito(s) {
    const quando = formatarDataHoraIsoSusp(s.vetorFacialEm);
    const badge = s.vetorFacialEm
        ? `<span class="foto-cad-badge foto-cad-com" title="Sincronizada em ${quando || '—'}">📷 Sincronizada</span>`
        : `<span class="foto-cad-badge foto-cad-sem">Sem foto ainda</span>`;
    const botaoCad = s.CPF
        ? `<button type="button" class="btn-buscar-foto-cad" data-id="${s.id}" title="Buscar foto no CAD (SERIS/Alcatraz) por este CPF">🔍 Buscar</button>`
        : '';
    const botaoFotos = `<button type="button" class="btn-adicionar-fotos-susp" data-id="${s.id}" title="Adicionar mais fotos deste suspeito">➕📷 Fotos</button>`;
    return `<span class="foto-cad-coluna">${badge}${botaoCad}${botaoFotos}</span>`;
}

// Miniatura clicável — mesmo componente/modal de js/autores.js (ver
// js/pessoa-modal.js), mostra tudo sobre o suspeito (só leitura).
function celulaFotoSuspeito(s) {
    const url = (cfgUnidadeSuspeitos && cfgUnidadeSuspeitos.apiPhp && s.fotoArquivo) ? cfgUnidadeSuspeitos.apiPhp.fotosSuspeitosBaseUrl + s.fotoArquivo : null;
    return url
        ? `<img class="pessoa-foto-thumb" src="${escaparHtmlSusp(url)}" alt="" data-abrir-detalhes-susp="${s.id}" title="Ver detalhes">`
        : `<div class="pessoa-foto-vazia" data-abrir-detalhes-susp="${s.id}" title="Ver detalhes">👤</div>`;
}

function renderizarTabelaSuspeitos(lista) {
    const tbody = document.getElementById('suspeitos-tbody');
    if (!lista.length) {
        tbody.innerHTML = '<tr><td colspan="10" class="empty-msg">Nenhum suspeito cadastrado com esse filtro.</td></tr>';
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
                return `<div class="lista-multi-item">${celulaMovimentacaoTextoSusp(p.movimentacaoProcesso)}${atualizadoEm ? `<div style="font-size:11px;opacity:.6;margin-top:2px;">atualizado em ${atualizadoEm}</div>` : ''}${assuntoLinha}${alertaLinha}</div>`;
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
                <td colspan="10">
                    <strong>Candidatos encontrados no e-SAJ para "${escaparHtmlSusp(s.NOME)}":</strong>
                    ${itens}
                    <button type="button" class="btn-nao-encontrado-manual-susp" data-suspeito-id="${s.id}">Nenhum destes — marcar como não encontrado</button>
                </td>
            </tr>`;
        }

        return `<tr data-suspeito-id="${s.id}">
            <td>${celulaFotoSuspeito(s)}</td>
            <td>${escaparHtmlSusp(s.NOME)}</td>
            <td>${s.CPF ? escaparHtmlSusp(s.CPF) : '<span style="opacity:.5;">—</span>'}</td>
            <td>${s.RG ? escaparHtmlSusp(s.RG) : '<span style="opacity:.5;">—</span>'}</td>
            <td>${s.MAE ? escaparHtmlSusp(s.MAE) : '<span style="opacity:.5;">—</span>'}</td>
            <td>${colunaEsaj}</td>
            <td>${colunaMovimentacao}</td>
            <td>
                <span class="status-toggle-susp" data-toggle-susp-de="${s.id}">${badgeStatusSuspeito(s)}</span>
            </td>
            <td>${celulaFotoCadSuspeito(s)}</td>
            <td><button type="button" class="btn-excluir-suspeito" data-suspeito-id="${s.id}" title="Excluir suspeito e todos os vínculos">🗑</button></td>
        </tr>${linhaCandidatos}`;
    }).join('');
}

// ====================================================================
// AÇÕES
// ====================================================================
// MODAL "Novo suspeito" — cadastro + foto numa mesma tela (fusão das
// antigas abas "Suspeitos"/"Upload de foto", ver page/autores.html). Dá
// pra selecionar VÁRIAS fotos de uma vez (input multiple) — cada uma
// soma ao histórico da pessoa (autor_fotos/suspeito_fotos) e ao vetor
// facial, sem apagar as anteriores.
//
// 2 modos, controlados por msSuspeitoEmEdicao:
//   null   -> cadastro completo (nome/cpf/rg/mãe + foto(s) opcionais)
//   objeto -> só a área de fotos, pra ACRESCENTAR mais fotos a um
//             suspeito que já existe (ver btn-adicionar-fotos-susp)
// ====================================================================
let msSuspeitoEmEdicao = null;

function abrirModalSuspeito(suspeitoExistente) {
    msSuspeitoEmEdicao = suspeitoExistente || null;
    const camposCadastro = document.getElementById('ms-campos-cadastro');
    const titulo = document.getElementById('ms-titulo');

    if (msSuspeitoEmEdicao) {
        camposCadastro.style.display = 'none';
        titulo.textContent = `📷 Fotos de ${msSuspeitoEmEdicao.NOME || 'suspeito'}`;
    } else {
        camposCadastro.style.display = '';
        titulo.textContent = '🕵️ Novo suspeito';
        ['novo-suspeito-nome', 'novo-suspeito-cpf', 'novo-suspeito-rg', 'novo-suspeito-mae'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
    }

    document.getElementById('ms-input-foto').value = '';
    document.getElementById('ms-foto-previews').innerHTML = '';
    document.getElementById('ms-status-msg').textContent = '';
    msArquivosFoto = [];
    msDescritoresFoto = [];
    document.getElementById('modal-suspeito').classList.add('aberto');
    (msSuspeitoEmEdicao ? document.getElementById('ms-input-foto') : document.getElementById('novo-suspeito-nome')).focus();
}

function fecharModalSuspeito() {
    document.getElementById('modal-suspeito').classList.remove('aberto');
    msSuspeitoEmEdicao = null;
}

// Detecta o rosto de CADA arquivo selecionado, em paralelo, e guarda os
// descritores no mesmo índice dos arquivos — msArquivosFoto/
// msDescritoresFoto ficam alinhados por posição.
async function msOnArquivoSelecionado(e) {
    const arquivos = Array.from(e.target.files || []);
    const previews = document.getElementById('ms-foto-previews');
    const status = document.getElementById('ms-status-msg');
    msArquivosFoto = arquivos;
    msDescritoresFoto = new Array(arquivos.length).fill(null);
    previews.innerHTML = arquivos.map(a => `<img src="${URL.createObjectURL(a)}" alt="Foto selecionada">`).join('');
    if (!arquivos.length) { status.textContent = ''; return; }

    status.textContent = `Detectando rosto em ${arquivos.length} foto(s)...`;
    let comRosto = 0;
    await Promise.all(arquivos.map(async (arquivo, idx) => {
        try {
            const resultado = await p3DetectarRostoComQualidade(arquivo);
            msDescritoresFoto[idx] = resultado ? resultado.descritor : null;
            if (resultado) comRosto++;
        } catch (err) {
            console.error('[suspeitos] Erro ao detectar rosto:', err);
        }
    }));
    status.textContent = `${comRosto} de ${arquivos.length} foto(s) com rosto detectado — as demais ainda podem ser salvas como referência.`;
}

// Envia cada foto selecionada numa chamada própria (sequencial, não em
// paralelo — evita condição de corrida sobre qual arquivo "virou capa").
// capa:false sempre: se a pessoa ainda não tem NENHUMA foto, o próprio
// backend força a primeira a virar capa mesmo assim (ver uploadFoto em
// hostinger-api/suspeitos.php); se já tem, isso preserva a foto principal
// já escolhida em vez de trocá-la sem querer só por ter subido mais fotos.
async function msEnviarLoteFotos(id) {
    const status = document.getElementById('ms-status-msg');
    for (let i = 0; i < msArquivosFoto.length; i++) {
        status.textContent = `Enviando foto ${i + 1} de ${msArquivosFoto.length}...`;
        await P3.Suspeitos.uploadFoto(cfgUnidadeSuspeitos, id, msArquivosFoto[i], msDescritoresFoto[i], { capa: false });
    }
}

async function salvarNovoSuspeito() {
    const status = document.getElementById('ms-status-msg');
    const btn = document.getElementById('btn-salvar-novo-suspeito');
    btn.disabled = true;

    try {
        if (msSuspeitoEmEdicao) {
            if (!msArquivosFoto.length) { status.textContent = 'Selecione ao menos uma foto.'; return; }
            await msEnviarLoteFotos(msSuspeitoEmEdicao.id);
            fecharModalSuspeito();
            const msg = document.getElementById('suspeitos-status-msg');
            msg.textContent = 'Foto(s) adicionada(s).';
            setTimeout(() => { msg.textContent = ''; }, 5000);
            await carregarSuspeitos();
            return;
        }

        const nomeInput = document.getElementById('novo-suspeito-nome');
        const cpfInput = document.getElementById('novo-suspeito-cpf');
        const rgInput = document.getElementById('novo-suspeito-rg');
        const maeInput = document.getElementById('novo-suspeito-mae');
        const nome = nomeInput.value.trim();
        const cpf = cpfInput.value.trim();
        const rg = rgInput ? rgInput.value.trim() : '';
        const nomeMae = maeInput ? maeInput.value.trim() : '';
        if (!nome) { status.textContent = 'Informe o nome.'; return; }

        status.textContent = 'Cadastrando...';
        const r = await P3.Suspeitos.criar(cfgUnidadeSuspeitos, { nome, cpf, rg, nomeMae });
        if (msArquivosFoto.length && r && r.id) {
            await msEnviarLoteFotos(r.id);
        }
        fecharModalSuspeito();
        const msg = document.getElementById('suspeitos-status-msg');
        msg.textContent = 'Suspeito cadastrado.';
        setTimeout(() => { msg.textContent = ''; }, 5000);
        await carregarSuspeitos();
    } catch (e) {
        status.textContent = e.message || 'Erro ao salvar.';
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

// ====================================================================
// BUSCA DE FOTO NO CAD (SERIS/Alcatraz) — mesmo mecanismo de
// js/autores.js (ver js/cad-busca-foto.js pro fluxo completo).
// ====================================================================
async function buscarFotoCadSuspeito(idSuspeito) {
    const suspeito = todosSuspeitos.find(s => String(s.id) === String(idSuspeito));
    if (!suspeito) return;
    const btn = document.querySelector(`.btn-buscar-foto-cad[data-id="${CSS.escape(idSuspeito)}"]`);
    if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
    const r = await cadBuscarESalvarUmaPessoa(cfgUnidadeSuspeitos, 'suspeito', idSuspeito, suspeito.CPF);
    if (btn) { btn.disabled = false; btn.textContent = '🔍'; }

    if (r.status === 'salvo') alert(`${r.salvas} de ${r.totalFotos} foto(s) do CAD salva(s) para ${suspeito.NOME}${r.comVetor ? ` (${r.comVetor} com vetor facial).` : ' (rosto não detectado nas fotos — salvas só como referência).'}`);
    else if (r.status === 'nao_encontrado') alert(`Nenhuma foto encontrada no CAD (SERIS/Alcatraz) para ${suspeito.NOME}.`);
    else if (r.status === 'sem_cpf') alert('Este suspeito não tem CPF cadastrado.');
    else alert('Erro ao buscar no CAD: ' + (r.erro || 'desconhecido'));
}

// Painel de progresso visível — mesmo padrão de
// js/autores.js:atualizarProgressoCadAutores.
function atualizarProgressoCadSuspeitos(processados, total, achados, naoAchados, erros) {
    const wrap = document.getElementById('suspeitos-progresso-cad-wrap');
    const fill = document.getElementById('suspeitos-progresso-cad-fill');
    const texto = document.getElementById('suspeitos-progresso-cad-texto');
    if (!wrap) return;
    wrap.style.display = total ? 'block' : 'none';
    if (!total) return;
    const pct = Math.min(100, Math.round((processados / total) * 100));
    fill.style.width = pct + '%';
    texto.textContent = `${processados} de ${total} (${pct}%)`;
    document.getElementById('suspeitos-cad-stat-processados').textContent = `${processados} processados`;
    document.getElementById('suspeitos-cad-stat-achados').textContent = `${achados} salvos`;
    document.getElementById('suspeitos-cad-stat-nao-achados').textContent = `${naoAchados} sem foto`;
    document.getElementById('suspeitos-cad-stat-erros').textContent = `${erros} erros`;
}

// Mesmo mecanismo de cancelamento de js/autores.js:buscarFotosCadTodosAutores
// — ver comentário lá.
let suspeitosBuscaCadEmAndamento = false;
let suspeitosBuscaCadCancelar = false;
async function buscarFotosCadTodosSuspeitos() {
    const btn = document.getElementById('btn-suspeitos-buscar-foto-cad-todos');
    if (suspeitosBuscaCadEmAndamento) {
        suspeitosBuscaCadCancelar = true;
        if (btn) btn.textContent = '⏳ Cancelando (termina o CPF atual)...';
        return;
    }

    // Pula quem já tem QUALQUER imagem salva na Hostinger (fotoArquivo) —
    // ver mesmo comentário/motivo em js/autores.js:buscarFotosCadTodosAutores.
    const comCpf = todosSuspeitos.filter(s => s.CPF);
    const elegiveis = comCpf.filter(s => !s.fotoArquivo);
    const jaSincronizados = comCpf.length - elegiveis.length;
    if (!elegiveis.length) { alert(`Nenhum suspeito pendente — todos os ${comCpf.length} com CPF já têm foto salva.`); return; }
    if (!confirm(`Isso vai buscar no CAD, um suspeito de cada vez, os ${elegiveis.length} suspeito(s) com CPF ainda sem nenhuma foto salva (${jaSincronizados} já com foto serão pulados) — pode levar vários minutos. Clique no mesmo botão de novo a qualquer momento pra cancelar. Continuar?`)) return;

    suspeitosBuscaCadEmAndamento = true;
    suspeitosBuscaCadCancelar = false;
    const textoOriginal = btn ? btn.textContent : '';
    let achados = 0, naoAchados = 0, erros = 0, processados = 0, cancelado = false;
    atualizarProgressoCadSuspeitos(0, elegiveis.length, 0, 0, 0);
    for (; processados < elegiveis.length; processados++) {
        if (suspeitosBuscaCadCancelar) { cancelado = true; break; }
        const suspeito = elegiveis[processados];
        if (btn) btn.textContent = `⏳ ${processados + 1}/${elegiveis.length} — clique pra cancelar`;
        const r = await cadBuscarESalvarUmaPessoa(cfgUnidadeSuspeitos, 'suspeito', suspeito.id, suspeito.CPF);
        if (r.status === 'salvo') achados++;
        else if (r.status === 'erro') erros++;
        else naoAchados++;
        atualizarProgressoCadSuspeitos(processados + 1, elegiveis.length, achados, naoAchados, erros);
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    suspeitosBuscaCadEmAndamento = false;
    suspeitosBuscaCadCancelar = false;
    if (btn) { btn.disabled = false; btn.textContent = textoOriginal; }
    document.getElementById('suspeitos-progresso-cad-wrap').style.display = 'none';
    alert(`${cancelado ? 'Cancelado' : 'Concluído'} — ${achados} foto(s) salva(s), ${naoAchados} sem foto no CAD, ${erros} erro(s) (${processados} de ${elegiveis.length} processados).`);
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

// Botão "⏹ Parar" (ver #btn-suspeitos-parar-verificacao) — mesmo motivo
// de pararVerificacaoAutores em js/autores.js: sem isso, o "Verificar
// agora" ficava travado acompanhando um lote do Apps Script, sem jeito
// de interromper pra tentar de novo já preferindo o servidor local. Só
// encerra o ACOMPANHAMENTO aqui — se era o Apps Script, o lote em si
// continua rodando do lado do Google até terminar sozinho.
function pararVerificacaoSuspeitos() {
    pararPollSuspeitos();
    limparEstadoVerificacaoSuspeitos();
    const wrap = document.getElementById('suspeitos-progresso-live-wrap');
    if (wrap) wrap.style.display = 'none';
    const btn = document.getElementById('btn-suspeitos-verificar-agora');
    if (btn) btn.disabled = false;
    const msg = document.getElementById('suspeitos-status-msg');
    if (msg) {
        msg.textContent = 'Acompanhamento interrompido por aqui — se era o Apps Script, o lote continua rodando do lado de fora até terminar sozinho. Clique em "Verificar agora" pra tentar de novo (usa o servidor local se ele estiver aberto).';
        setTimeout(() => { if (msg.textContent.indexOf('Acompanhamento interrompido') === 0) msg.textContent = ''; }, 10000);
    }
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

// Caminho NOVO (preferido) — mesmo mecanismo de js/autores.js:
// verificarAgoraLocal (ver comentário mais detalhado lá), usando o
// servidor local Python (tools/atualizador-local/) em vez do Apps
// Script — progresso REAL item a item via streaming, sem esperar
// gatilho nenhum.
async function verificarAgoraSuspeitosLocal(totalEstimado) {
    const btn = document.getElementById('btn-suspeitos-verificar-agora');
    const msg = document.getElementById('suspeitos-status-msg');

    suspeitosVerificacaoEmAndamento = true;
    if (btn) btn.disabled = true;
    msg.textContent = 'Atualizando via servidor local — os mais desatualizados primeiro...';
    atualizarBarraLiveSuspeitos(0, totalEstimado);

    // Ver comentário equivalente em js/autores.js:verificarAgoraLocal —
    // guarda amostras de erro pra mostrar direto na tela, não só no console.
    const amostrasErro = [];
    // Idem — mudanças de movimentação detectadas nesta rodada (vira modal
    // + notificação, ver abaixo).
    const mudancasColetadas = [];
    try {
        const resumo = await P3AtualizadorLocal.atualizarMovimentacoes('suspeitos', function (evento) {
            if (evento.tipo === 'inicio') {
                atualizarBarraLiveSuspeitos(0, evento.total);
            } else if (evento.tipo === 'progresso') {
                atualizarBarraLiveSuspeitos(evento.processados, evento.total);
                msg.textContent = `Atualizando (servidor local) — ${evento.processados}/${evento.total}: ${evento.item || ''}`;
            } else if (evento.tipo === 'mudanca') {
                mudancasColetadas.push(evento);
            } else if (evento.tipo === 'aviso') {
                console.warn('[suspeitos] Aviso do atualizador local:', evento);
                if (amostrasErro.length < 3 && evento.erro && amostrasErro.indexOf(evento.erro) === -1) {
                    amostrasErro.push(evento.erro);
                }
            }
        });

        const dados = await P3.Suspeitos.listar(cfgUnidadeSuspeitos);
        processarDadosSuspeitos(dados);

        const agoraIso = new Date().toISOString();
        const link = '../page/autores.html';
        const totalProcessado = (resumo && resumo.suspeitos && resumo.suspeitos.total) || 0;
        const mudancasComLink = mudancasColetadas.map(m => Object.assign({}, m, { link }));

        // Persiste o resultado desta rodada (mesmo vazio) pro botão "🕓
        // Ver última atualização" — ver SUSPEITOS_ULTIMA_ATUALIZACAO_KEY.
        try {
            localStorage.setItem(SUSPEITOS_ULTIMA_ATUALIZACAO_KEY, JSON.stringify({
                quando: agoraIso, total: totalProcessado, mudancas: mudancasComLink,
            }));
        } catch (e) { /* localStorage indisponível/cheio — só perde a retomada, não quebra nada */ }

        if (mudancasColetadas.length) {
            if (typeof P3ModalMudancas !== 'undefined') {
                P3ModalMudancas.exibir(mudancasComLink, {
                    titulo: `${mudancasColetadas.length} movimentação(ões) de suspeito atualizada(s)`,
                    quando: agoraIso,
                });
            }
            if (typeof P3Notificacoes !== 'undefined') {
                // Mesma chave "susp:{suspeitoId}:{processoId}" que
                // js/core/notificacoes.js:obterMovimentacoesEsajSuspeito já
                // usa — evita duplicar quando o detector passivo mais
                // tarde também encontrar essa mesma mudança.
                P3Notificacoes.adicionarNotificacoes(mudancasColetadas.map(m => ({
                    id: 'suspeito-esaj:susp:' + m.suspeitoId + ':' + m.id + ':' + m.ultimoCodigoMovimento + '@' + (m.ultimaMovimentacaoEm || ''),
                    categoria: 'autores',
                    icone: m.alertaImportante ? '🚨' : '⚖️',
                    titulo: m.alertaImportante ? 'Evento importante no processo do suspeito' : 'Movimentação no processo do suspeito',
                    // Só a 1ª linha (título+data) — ver comentário
                    // equivalente em js/autores.js.
                    texto: `${m.nome || 'Suspeito'}: ${(m.movimentacaoAtual || '').split('\n')[0]}`,
                    link: link,
                })));
            }
        }

        const c = (resumo && resumo.suspeitos && resumo.suspeitos.contagem) || {};
        const total = (resumo && resumo.suspeitos && resumo.suspeitos.total) || 0;
        let texto = `Concluído (${total}) — ${c.atualizado || 0} processo(s) atualizado(s), ${c.vinculado || 0} vinculado(s) agora, ` +
            `${c.pendente_revisao || 0} pendente(s) de revisão, ${c.nao_encontrado || 0} não encontrado(s) no e-SAJ, ` +
            `${c.sem_movimento || 0} sem movimento novo, ${c.nao_encontrado_esaj || 0} não encontrado(s) no e-SAJ`;
        if (c.erro) {
            texto += ` — ⚠️ ${c.erro} erro(s)`;
            if (amostrasErro.length) texto += `: ${amostrasErro.join(' | ')}`;
        }
        msg.textContent = texto + '.';
        if (!c.erro) setTimeout(() => { if (msg.textContent.indexOf('Concluído') === 0) msg.textContent = ''; }, 12000);
    } catch (e) {
        console.error('[suspeitos] Erro em verificarAgoraSuspeitosLocal:', e);
        msg.textContent = 'Erro no atualizador local: ' + e.message;
    } finally {
        suspeitosVerificacaoEmAndamento = false;
        if (btn) btn.disabled = false;
        const wrap = document.getElementById('suspeitos-progresso-live-wrap');
        if (wrap) wrap.style.display = 'none';
    }
}

async function verificarAgoraSuspeitos() {
    const msg = document.getElementById('suspeitos-status-msg');
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

    // ÚNICO caminho agora — servidor local (Python, e-SAJ direto ao vivo).
    // CORREÇÃO (27/08/2026) — ver comentário completo em
    // js/autores.js:verificarAgora: o fallback pro Apps Script (DataJud,
    // sempre atrasado) foi removido — ficava sobrescrevendo com dado
    // velho a movimentação que o Python tinha acabado de gravar mais
    // atualizada. O robô do Apps Script foi desativado do lado do
    // servidor também (ver sincronizarSuspeitosDiario em
    // apps-script/suspeitos-esaj-hostinger.gs).
    if (await P3AtualizadorLocal.disponivel()) {
        await verificarAgoraSuspeitosLocal(total);
        return;
    }

    msg.textContent = 'Atualizador local (Python) não está rodando — abra tools/atualizador-local (python app.py, ' +
        'ou o app desktop) e clique em "Verificar agora" de novo. O Apps Script deixou de ser usado aqui (ficava ' +
        'sobrescrevendo com dado desatualizado do DataJud).';
}

// Ver comentário equivalente em js/autores.js:abrirUltimaAtualizacaoAutores.
function abrirUltimaAtualizacaoSuspeitos() {
    let dados = null;
    try { dados = JSON.parse(localStorage.getItem(SUSPEITOS_ULTIMA_ATUALIZACAO_KEY) || 'null'); }
    catch (e) { dados = null; }

    if (!dados) {
        alert('Ainda não foi feita nenhuma verificação pelo servidor local nesta sessão do navegador — clique em "Verificar agora" primeiro.');
        return;
    }
    if (typeof P3ModalMudancas === 'undefined') return;
    P3ModalMudancas.exibir(dados.mudancas || [], {
        titulo: `Última verificação de suspeitos — ${dados.total || 0} processado(s)`,
        quando: dados.quando,
        permitirVazio: true,
    });
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
    document.getElementById('suspeitos-filtro-foto-cad').addEventListener('change', function (e) {
        filtroFotoCadSuspeitos = e.target.value;
        aplicarFiltrosSuspeitos();
    });

    document.getElementById('btn-suspeitos-novo').addEventListener('click', () => abrirModalSuspeito());
    document.getElementById('ms-btn-cancelar').addEventListener('click', fecharModalSuspeito);
    document.getElementById('ms-btn-fechar-x').addEventListener('click', fecharModalSuspeito);
    document.getElementById('ms-input-foto').addEventListener('change', msOnArquivoSelecionado);
    document.getElementById('btn-salvar-novo-suspeito').addEventListener('click', salvarNovoSuspeito);
    document.getElementById('btn-suspeitos-verificar-agora').addEventListener('click', verificarAgoraSuspeitos);
    const btnPararVerifSuspeitos = document.getElementById('btn-suspeitos-parar-verificacao');
    if (btnPararVerifSuspeitos) btnPararVerifSuspeitos.addEventListener('click', pararVerificacaoSuspeitos);

    const btnVerUltimaAtualizacaoSusp = document.getElementById('btn-suspeitos-ver-ultima-atualizacao');
    if (btnVerUltimaAtualizacaoSusp) btnVerUltimaAtualizacaoSusp.addEventListener('click', abrirUltimaAtualizacaoSuspeitos);

    const btnBuscarFotoCadTodosSusp = document.getElementById('btn-suspeitos-buscar-foto-cad-todos');
    if (btnBuscarFotoCadTodosSusp) btnBuscarFotoCadTodosSusp.addEventListener('click', buscarFotosCadTodosSuspeitos);

    document.getElementById('suspeitos-tbody').addEventListener('click', function (e) {
        const btnBuscarFotoCad = e.target.closest('.btn-buscar-foto-cad');
        if (btnBuscarFotoCad) { buscarFotoCadSuspeito(btnBuscarFotoCad.dataset.id); return; }

        const btnAdicionarFotos = e.target.closest('.btn-adicionar-fotos-susp');
        if (btnAdicionarFotos) {
            const suspeito = todosSuspeitos.find(s => String(s.id) === String(btnAdicionarFotos.dataset.id));
            if (suspeito) abrirModalSuspeito(suspeito);
            return;
        }

        const fotoClicavel = e.target.closest('[data-abrir-detalhes-susp]');
        if (fotoClicavel) {
            const suspeito = todosSuspeitos.find(s => String(s.id) === String(fotoClicavel.dataset.abrirDetalhesSusp));
            if (suspeito) PessoaModal.abrir({ cfg: cfgUnidadeSuspeitos, tipo: 'suspeito', registro: suspeito });
            return;
        }

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
