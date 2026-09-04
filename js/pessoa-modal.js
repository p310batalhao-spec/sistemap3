// ====================================================================
// Sistema P3 — Modal de detalhes de pessoa (autor/suspeito/resultado do
// reconhecimento facial)
// ====================================================================
// Componente único, reaproveitado pelas 3 telas que precisam mostrar
// "tudo que existe sobre esta pessoa" + as fotos, ao clicar numa
// miniatura/linha (ver js/autores.js, js/suspeitos.js,
// js/autores-reconhecimento-facial.js). Injeta seu próprio HTML/CSS no
// <body> na primeira chamada, então basta carregar este arquivo e
// chamar PessoaModal.abrir({...}) — nenhuma marcação extra precisa
// existir na página.
//
// Somente LEITURA — nenhum campo de upload aqui (pedido explícito do
// usuário: este modal é pra "ver tudo que já tem", não pra editar). Pra
// adicionar fotos a um suspeito, ver abrirModalSuspeito em js/suspeitos.js.
//
// Junta em 3 seções o que o pedido original chamou de "Hostinger,
// Firebase e Supabase":
//   - "Hostinger"  -> todos os campos do registro já carregado na tela
//                     (autor/suspeito vêm 100% da API PHP/MySQL aqui).
//   - "Echelonx (Supabase)" -> cruzamento pontual por CPF contra
//                     hostinger-api/pessoas_echelonx.php (cache local
//                     do Supabase do echelonx.com.br).
//   - "Firebase"   -> este recurso (foto/modal) só existe pra quem usa
//                     apiPhp (10º BPM) — não há um registro Firebase
//                     PARALELO da mesma pessoa pra cruzar (os dados já
//                     migraram pra cá), então a seção só informa isso
//                     em vez de fingir uma busca que não existe.

(function (global) {
    const LABELS = {
        NOME: 'Nome', CPF: 'CPF', RG: 'RG', NOME_MAE: 'Nome da mãe', MAE: 'Nome da mãe', UNIDADE: 'Unidade',
        BOLETIM: 'COP/Boletim', DATA: 'Data da ocorrência', HORA: 'Hora', MES: 'Mês', ANO: 'Ano',
        ENVOLVIMENTO: 'Envolvimento', SITUACAO: 'Situação', NATUREZA: 'Natureza', TIPIFICACAO: 'Tipificação',
        NARRATIVA: 'Narrativa', BAIRRO: 'Bairro', CIDADE: 'Cidade', LOGRADOURO: 'Logradouro',
        LATITUDE: 'Latitude', LONGITUDE: 'Longitude', SOLICITANTE: 'Solicitante', OBITO: 'Óbito',
        statusVinculoEsaj: 'Status vínculo e-SAJ', statusBusca: 'Status da busca',
        numeroProcessoEsaj: 'Nº processo e-SAJ', movimentacaoAutor: 'Movimentação',
        ultimoCodigoMovimento: 'Último código de movimento', ultimaMovimentacaoEm: 'Última movimentação em',
        classeEsaj: 'Classe e-SAJ', assuntoEsaj: 'Assunto e-SAJ', alertaImportante: 'Alerta importante',
        alertaImportanteEm: 'Alerta em', vetorFacialEm: 'Foto/vetor facial sincronizado em',
        origemVinculo: 'Origem do vínculo', vinculadoPor: 'Vinculado por', descobertoEm: 'Descoberto em',
        verificadoEm: 'Verificado em', import_at: 'Importado em', criadoPor: 'Cadastrado por',
        criadoEm: 'Cadastrado em', origemImagemId: 'Origem da imagem (echelonx)', sincronizadoEm: 'Sincronizado em',
    };
    const OCULTOS = new Set([
        'NOME', 'CPF', 'fotoArquivo', 'processosExtras', 'processos', 'candidatosEsaj', 'id', '_id', 'tipo', 'distancia'
    ]);
    const ORIGEM_ROTULO = { upload: 'Upload manual', cad: 'CAD (SERIS/Alcatraz)', echelonx: 'Echelonx', migracao: 'Migração' };

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function rotulo(chave) {
        return LABELS[chave] || chave.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
    }

    function valorVazio(v) {
        return v === null || v === undefined || v === '' || v === '---';
    }

    function linhasDoRegistro(registro) {
        return Object.keys(registro)
            .filter(k => !OCULTOS.has(k) && !valorVazio(registro[k]))
            .map(k => `<div class="pm-campo"><span class="pm-campo-label">${esc(rotulo(k))}</span><span class="pm-campo-valor">${esc(registro[k])}</span></div>`)
            .join('');
    }

    function formatarDataHora(iso) {
        if (!iso) return null;
        const d = new Date(iso);
        if (isNaN(d.getTime())) return null;
        const dia = String(d.getDate()).padStart(2, '0');
        const mes = String(d.getMonth() + 1).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${dia}/${mes}/${d.getFullYear()} ${hh}:${mm}`;
    }

    function garantirEstilos() {
        if (document.getElementById('pessoa-modal-estilos')) return;
        const style = document.createElement('style');
        style.id = 'pessoa-modal-estilos';
        style.textContent = `
            #pessoa-modal { display:none; position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:9100; align-items:center; justify-content:center; padding:20px; }
            #pessoa-modal.aberto { display:flex; }
            .pm-box { background:var(--p3-surface,#fff); border:1px solid var(--p3-border,#ddd); border-radius:12px; max-width:820px; width:100%; max-height:90vh; overflow-y:auto; box-shadow:0 16px 48px rgba(0,0,0,.35); }
            .pm-head { background:#003366; color:#fff; padding:14px 18px; display:flex; justify-content:space-between; align-items:center; gap:10px; position:sticky; top:0; z-index:1; }
            .pm-head-titulo { font-weight:700; font-size:1rem; }
            .pm-head-sub { font-size:.75rem; opacity:.8; font-weight:400; }
            .pm-head button { background:none; border:none; color:rgba(255,255,255,.75); font-size:1.3rem; cursor:pointer; line-height:1; }
            .pm-body { padding:18px; display:flex; gap:20px; flex-wrap:wrap; }
            .pm-foto-col { flex:0 0 200px; display:flex; flex-direction:column; gap:10px; }
            .pm-foto-principal { width:200px; height:200px; border-radius:8px; object-fit:cover; background:var(--p3-bg); border:1px solid var(--p3-border); display:block; }
            .pm-foto-vazia { width:200px; height:200px; border-radius:8px; background:var(--p3-bg); border:2px dashed var(--p3-border); display:flex; align-items:center; justify-content:center; color:var(--p3-text-muted); font-size:12px; text-align:center; padding:10px; box-sizing:border-box; }
            .pm-galeria-titulo { font-size:.7rem; font-weight:700; text-transform:uppercase; color:var(--p3-text-muted); margin-top:2px; }
            .pm-galeria { display:flex; flex-wrap:wrap; gap:6px; }
            .pm-galeria a { display:block; }
            .pm-galeria img { width:56px; height:56px; border-radius:6px; object-fit:cover; border:1px solid var(--p3-border); cursor:pointer; }
            .pm-galeria img:hover { outline:2px solid var(--p3-blue-700); }
            .pm-galeria-vazia { font-size:11.5px; color:var(--p3-text-muted); font-style:italic; }
            .pm-dados-col { flex:1 1 380px; min-width:280px; display:flex; flex-direction:column; gap:18px; }
            .pm-secao-titulo { font-size:.75rem; font-weight:700; text-transform:uppercase; letter-spacing:.03em; color:var(--p3-text-muted); border-bottom:1px solid var(--p3-border); padding-bottom:4px; margin-bottom:8px; }
            .pm-campos { display:flex; flex-direction:column; gap:5px; }
            .pm-campo { display:flex; gap:8px; font-size:12.5px; line-height:1.4; }
            .pm-campo-label { flex:0 0 150px; color:var(--p3-text-muted); }
            .pm-campo-valor { flex:1; color:var(--p3-text); word-break:break-word; white-space:pre-wrap; }
            .pm-vazio { font-size:12.5px; color:var(--p3-text-muted); font-style:italic; }
            .pm-lista-item { border:1px solid var(--p3-border); border-radius:6px; padding:8px 10px; margin-bottom:6px; font-size:12px; white-space:pre-wrap; }
            .pm-btn { display:inline-block; background:var(--p3-blue-700,#003366); color:#fff; border:none; border-radius:6px; padding:8px 14px; font-size:12.5px; font-weight:600; cursor:pointer; width:100%; text-align:center; }
            .pm-btn:hover { opacity:.9; }
            .pm-btn:disabled { opacity:.6; cursor:not-allowed; }
            .pm-btn-ativo { background:#8a6100; }
        `;
        document.head.appendChild(style);
    }

    function garantirModal() {
        garantirEstilos();
        if (document.getElementById('pessoa-modal')) return;
        const div = document.createElement('div');
        div.id = 'pessoa-modal';
        div.innerHTML = `
            <div class="pm-box">
                <div class="pm-head">
                    <div>
                        <div class="pm-head-titulo" id="pm-titulo">—</div>
                        <div class="pm-head-sub" id="pm-subtitulo"></div>
                    </div>
                    <button type="button" id="pm-fechar" title="Fechar">✕</button>
                </div>
                <div class="pm-body">
                    <div class="pm-foto-col">
                        <div id="pm-foto-wrap"></div>
                        <div class="pm-galeria-titulo" id="pm-galeria-titulo" style="display:none;">Todas as fotos registradas</div>
                        <div class="pm-galeria" id="pm-galeria"></div>
                        <div id="pm-btn-interesse-wrap" style="margin-top:4px;"></div>
                    </div>
                    <div class="pm-dados-col">
                        <div>
                            <div class="pm-secao-titulo">📋 Hostinger — cadastro nesta unidade</div>
                            <div class="pm-campos" id="pm-campos-hostinger"></div>
                        </div>
                        <div>
                            <div class="pm-secao-titulo">🔗 Echelonx (Supabase)</div>
                            <div id="pm-echelonx">Consultando...</div>
                        </div>
                        <div>
                            <div class="pm-secao-titulo">🔥 Firebase</div>
                            <div class="pm-vazio">Este recurso (foto/detalhes) só está disponível para unidades na API Hostinger — não há um cadastro Firebase paralelo desta pessoa para cruzar aqui.</div>
                        </div>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(div);
        document.getElementById('pm-fechar').addEventListener('click', fechar);
        div.addEventListener('click', e => { if (e.target === div) fechar(); });
    }

    function fechar() {
        const el = document.getElementById('pessoa-modal');
        if (el) el.classList.remove('aberto');
    }

    function montarUrlFoto(cfg, tipo, fotoArquivo) {
        if (!fotoArquivo || !cfg || !cfg.apiPhp) return null;
        const base = tipo === 'suspeito' ? cfg.apiPhp.fotosSuspeitosBaseUrl
            : tipo === 'echelonx' ? cfg.apiPhp.fotosEchelonxBaseUrl
            : cfg.apiPhp.fotosAutoresBaseUrl;
        return base ? base + fotoArquivo : null;
    }

    function renderFotoPrincipal(urlFoto) {
        const wrap = document.getElementById('pm-foto-wrap');
        wrap.innerHTML = urlFoto
            ? `<img class="pm-foto-principal" src="${esc(urlFoto)}" alt="Foto principal">`
            : `<div class="pm-foto-vazia">Sem foto cadastrada</div>`;
    }

    // Galeria com TODAS as fotos já registradas (autor_fotos/suspeito_fotos)
    // — cada miniatura abre a foto em tamanho real numa aba nova. Pedido
    // explícito: este modal só mostra, nunca edita/envia foto.
    function renderGaleria(cfg, tipo, fotos) {
        const wrapTitulo = document.getElementById('pm-galeria-titulo');
        const wrap = document.getElementById('pm-galeria');
        if (!fotos || !fotos.length) {
            wrapTitulo.style.display = 'none';
            wrap.innerHTML = '';
            return;
        }
        wrapTitulo.style.display = '';
        wrapTitulo.textContent = `Todas as fotos registradas (${fotos.length})`;
        wrap.innerHTML = fotos.map(f => {
            const url = montarUrlFoto(cfg, tipo, f.arquivo);
            if (!url) return '';
            const quando = formatarDataHora(f.criadoEm);
            const origem = ORIGEM_ROTULO[f.origem] || f.origem || '';
            const titulo = [quando, origem].filter(Boolean).join(' · ');
            return `<a href="${esc(url)}" target="_blank" rel="noopener" title="${esc(titulo)}"><img src="${esc(url)}" alt=""></a>`;
        }).join('');
    }

    function renderListaAninhada(titulo, itens, montarLinha) {
        if (!itens || !itens.length) return '';
        return `<div><div class="pm-secao-titulo" style="border:none;padding:0;margin:10px 0 4px;font-size:11px;">${esc(titulo)}</div>${itens.map(montarLinha).join('')}</div>`;
    }

    async function carregarEchelonx(cfg, cpf) {
        const el = document.getElementById('pm-echelonx');
        if (!cpf) { el.innerHTML = '<div class="pm-vazio">Pessoa sem CPF cadastrado — não dá pra cruzar com o echelonx.</div>'; return; }
        try {
            const reg = await global.P3.PessoasEchelonx.buscarPorCpf(cfg, cpf);
            if (!reg) { el.innerHTML = '<div class="pm-vazio">Nenhuma correspondência encontrada no echelonx para este CPF.</div>'; return; }
            el.innerHTML = `<div class="pm-campos">${linhasDoRegistro(reg)}</div>`;
        } catch (e) {
            console.error('[pessoa-modal] Erro ao consultar echelonx:', e);
            el.innerHTML = '<div class="pm-vazio">Erro ao consultar o echelonx — tente novamente.</div>';
        }
    }

    async function carregarGaleria(cfg, tipo, id, fotoArquivoAtual) {
        const wrap = document.getElementById('pm-galeria');
        const wrapTitulo = document.getElementById('pm-galeria-titulo');
        if (tipo !== 'autor' && tipo !== 'suspeito') { wrapTitulo.style.display = 'none'; wrap.innerHTML = ''; return; }
        try {
            const fn = tipo === 'suspeito' ? global.P3.Suspeitos.listarFotos : global.P3.Autores.listarFotos;
            const fotos = await fn(cfg, id);
            // Se por algum motivo o histórico ainda não tem a foto de capa
            // registrada (ex.: dado migrado antes da tabela existir), garante
            // que ela pelo menos apareça na galeria.
            const lista = Array.isArray(fotos) ? fotos.slice() : [];
            if (fotoArquivoAtual && !lista.some(f => f.arquivo === fotoArquivoAtual)) {
                lista.unshift({ arquivo: fotoArquivoAtual, origem: null, criadoEm: null });
            }
            renderGaleria(cfg, tipo, lista);
        } catch (e) {
            console.error('[pessoa-modal] Erro ao listar fotos:', e);
            wrapTitulo.style.display = '';
            wrapTitulo.textContent = 'Todas as fotos registradas';
            wrap.innerHTML = '<div class="pm-galeria-vazia">Erro ao carregar o histórico de fotos.</div>';
        }
    }

    // ── "⭐ Add lista de interesses" (04/09/2026, módulo P2) — pedido
    // explícito do usuário: um autor/suspeito marcado aqui passa a
    // aparecer em page/lista-interesses.html, com processos/ocorrências
    // acompanhados e novidades no sino (ver js/core/notificacoes.js). Só
    // pra tipo 'autor'/'suspeito' — resultado de reconhecimento facial
    // (echelonx) não tem cadastro próprio pra vincular. Estado (já
    // adicionado ou não) é consultado ao abrir o modal, sem travar o
    // resto da renderização (mesmo espírito de carregarEchelonx/
    // carregarGaleria acima).
    function renderBotaoInteresseEstado(cfg, tipo, id, nome, cpf, jaAdicionado) {
        const wrap = document.getElementById('pm-btn-interesse-wrap');
        if (!wrap) return;
        wrap.innerHTML = jaAdicionado
            ? '<button type="button" id="pm-btn-interesse" class="pm-btn pm-btn-ativo">⭐ Na lista de interesses</button>'
            : '<button type="button" id="pm-btn-interesse" class="pm-btn">☆ Add lista de interesses</button>';
        document.getElementById('pm-btn-interesse').addEventListener('click', async () => {
            const btn = document.getElementById('pm-btn-interesse');
            btn.disabled = true;
            try {
                if (jaAdicionado) {
                    await global.P3.ListaInteresses.remover(cfg, { origem: tipo, origemId: id });
                } else {
                    await global.P3.ListaInteresses.adicionar(cfg, { origem: tipo, origemId: id, nome, cpf });
                }
                renderBotaoInteresseEstado(cfg, tipo, id, nome, cpf, !jaAdicionado);
            } catch (e) {
                alert('Erro ao atualizar a lista de interesses: ' + e.message);
                btn.disabled = false;
            }
        });
    }

    async function carregarEstadoInteresse(cfg, tipo, id, nome, cpf) {
        const wrap = document.getElementById('pm-btn-interesse-wrap');
        if (!wrap) return;
        if (tipo !== 'autor' && tipo !== 'suspeito' || !global.P3 || !global.P3.ListaInteresses) { wrap.innerHTML = ''; return; }
        wrap.innerHTML = '<button type="button" class="pm-btn" disabled>⏳ Verificando…</button>';
        try {
            const lista = await global.P3.ListaInteresses.listar(cfg);
            const jaAdicionado = lista.some(it => it.origem === tipo && String(it.origemId) === String(id));
            renderBotaoInteresseEstado(cfg, tipo, id, nome, cpf, jaAdicionado);
        } catch (e) {
            console.error('[pessoa-modal] Erro ao verificar lista de interesses:', e);
            wrap.innerHTML = '';
        }
    }

    // opts: { cfg, tipo: 'autor'|'suspeito'|'echelonx', registro }
    // registro precisa ter id (ou _id), NOME, CPF, fotoArquivo e demais
    // campos já carregados na tela (nenhuma chamada extra é feita pro
    // registro em si — só o cruzamento com o echelonx e o histórico de fotos).
    function abrir(opts) {
        const { cfg, tipo, registro } = opts;
        const id = registro.id != null ? registro.id : registro._id;
        garantirModal();

        const rotuloTipo = tipo === 'suspeito' ? 'Suspeito' : tipo === 'echelonx' ? 'Resultado do reconhecimento facial (echelonx)' : 'Autor';
        document.getElementById('pm-titulo').textContent = registro.NOME || '(sem nome)';
        document.getElementById('pm-subtitulo').textContent =
            `${rotuloTipo} · CPF ${registro.CPF || '—'}${registro.distancia != null ? ` · distância ${Number(registro.distancia).toFixed(3)}` : ''}`;

        renderFotoPrincipal(montarUrlFoto(cfg, tipo, registro.fotoArquivo));
        document.getElementById('pm-galeria-titulo').style.display = 'none';
        document.getElementById('pm-galeria').innerHTML = '';
        carregarGaleria(cfg, tipo, id, registro.fotoArquivo);

        let camposExtra = '';
        camposExtra += renderListaAninhada('Processos vinculados', registro.processos, p =>
            `<div class="pm-lista-item">${esc(p.numeroProcessoEsaj || '')}${p.movimentacaoProcesso ? '<br>' + esc(p.movimentacaoProcesso) : ''}</div>`);
        camposExtra += renderListaAninhada('Processos extras', registro.processosExtras, p =>
            `<div class="pm-lista-item">${esc(p.numeroProcessoEsaj || '')}${p.movimentacaoProcesso ? '<br>' + esc(p.movimentacaoProcesso) : ''}</div>`);

        const campos = linhasDoRegistro(registro);
        document.getElementById('pm-campos-hostinger').innerHTML =
            (campos || '<div class="pm-vazio">Sem outros campos preenchidos.</div>') + camposExtra;

        document.getElementById('pm-echelonx').textContent = 'Consultando...';
        carregarEchelonx(cfg, registro.CPF);

        document.getElementById('pm-btn-interesse-wrap').innerHTML = '';
        carregarEstadoInteresse(cfg, tipo, id, registro.NOME, registro.CPF);

        document.getElementById('pessoa-modal').classList.add('aberto');
    }

    global.PessoaModal = { abrir, fechar };
})(window);
