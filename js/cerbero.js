// ====================================================================
// Sistema P3 — Cérbero (base de inteligência PM-AL, cerimonial.pm.al.gov.br)
// ====================================================================
// 02/09/2026, pedido explícito do usuário — aba nova ao lado de
// Suspeitos, sob controle da P2. Lê pessoas/endereços DIRETO da
// Hostinger (hostinger-api/cerbero.php, leitura aberta — mesmo padrão
// de alvos_denuncia.php) pra funcionar mesmo sem o atualizador-local
// aberto; só a IMPORTAÇÃO de uma captura .har nova precisa do servidor
// local rodando (é ele quem lê o arquivo do disco e faz o parse — ver
// tools/atualizador-local/cerbero_har.py).
(function () {
    'use strict';

    let cfgUnidade = null;
    let pessoas = [];
    let enderecos = [];
    let carregado = false;

    // Vínculos pessoa↔endereço (aba "Vínculos" → "Endereços" da ficha da
    // pessoa no Cérbero — ver tools/atualizador-local/cerbero_har.py). Só
    // existe vínculo pra quem o usuário abriu essa sub-aba durante a
    // captura — a maioria das pessoas/endereços não tem nenhum ainda, e
    // isso vai se completando aos poucos a cada .har novo. Mapas
    // derivados nos dois sentidos pra não varrer a lista toda a cada
    // clique de detalhe.
    let enderecosDaPessoa = new Map();  // pessoaId(string) -> [enderecoId, ...]
    let pessoasDoEndereco = new Map();  // enderecoId(string) -> [pessoaId, ...]

    function montarMapasDeVinculo(vinculos) {
        enderecosDaPessoa = new Map();
        pessoasDoEndereco = new Map();
        (vinculos || []).forEach(v => {
            const pessoaId = String(v.pessoaId);
            const enderecoId = String(v.enderecoId);
            if (!enderecosDaPessoa.has(pessoaId)) enderecosDaPessoa.set(pessoaId, []);
            enderecosDaPessoa.get(pessoaId).push(enderecoId);
            if (!pessoasDoEndereco.has(enderecoId)) pessoasDoEndereco.set(enderecoId, []);
            pessoasDoEndereco.get(enderecoId).push(pessoaId);
        });
    }

    function normalizar(s) {
        return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    }

    function formatarDataBr(iso) {
        if (!iso) return '---';
        const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
    }

    function escaparHtml(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function renderizarPessoas() {
        const filtro = normalizar(document.getElementById('cerbero-filtro-pessoas').value.trim());
        const corpo = document.getElementById('cerbero-corpo-pessoas');
        const baseFotos = (cfgUnidade && cfgUnidade.apiPhp && cfgUnidade.apiPhp.fotosCerberoBaseUrl) || '';
        const lista = filtro
            ? pessoas.filter(p => normalizar(p.nome).includes(filtro) || normalizar(p.vulgos).includes(filtro) ||
                                    normalizar(p.cpf).includes(filtro))
            : pessoas;

        corpo.innerHTML = lista.map(p => {
            const foto = p.fotoArquivo
                ? `<img src="${escaparHtml(baseFotos + p.fotoArquivo)}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:4px;">`
                : '—';
            return `<tr data-cb-pessoa="${escaparHtml(p.id)}" style="cursor:pointer;" title="Clique para ver os detalhes">
                <td>${foto}</td>
                <td>${escaparHtml(p.nome || '---')}</td>
                <td>${escaparHtml(p.vulgos || '---')}</td>
                <td>${escaparHtml(p.cpf || '---')}</td>
                <td>${escaparHtml(p.filiacao1 || '---')}</td>
                <td>${formatarDataBr(p.nascimento)}</td>
                <td>${escaparHtml(p.sexo || '---')}</td>
                <td>${escaparHtml(p.situacao || '---')}</td>
                <td>${escaparHtml(p.faccao || '---')}</td>
            </tr>`;
        }).join('') || '<tr><td colspan="9" style="text-align:center;opacity:.6;">Nenhuma pessoa importada ainda.</td></tr>';
    }

    function renderizarEnderecos() {
        const filtro = normalizar(document.getElementById('cerbero-filtro-enderecos').value.trim());
        const corpo = document.getElementById('cerbero-corpo-enderecos');
        const lista = filtro ? enderecos.filter(e => normalizar(e.endereco).includes(filtro)) : enderecos;
        corpo.innerHTML = lista.map(e => {
            const qtdPessoas = (pessoasDoEndereco.get(String(e.id)) || []).length;
            const vinculo = qtdPessoas
                ? `${qtdPessoas} pessoa(s)`
                : '<span style="opacity:.5;">nenhum vínculo capturado</span>';
            return `<tr data-cb-endereco="${escaparHtml(e.id)}" style="cursor:pointer;" title="Clique para ver os detalhes">
                <td>${escaparHtml(e.endereco || '---')}</td>
                <td>${vinculo}</td>
            </tr>`;
        }).join('') || '<tr><td colspan="2" style="text-align:center;opacity:.6;">Nenhum endereço importado ainda.</td></tr>';
    }

    async function carregarDados(forcar) {
        if (carregado && !forcar) return;
        const statusEl = document.getElementById('cerbero-status-msg');
        try {
            if (!cfgUnidade) cfgUnidade = await P3.loadUnidadeConfig();
            const url = cfgUnidade.apiPhp.cerberoUrl;
            const [respPessoas, respEnderecos, respVinculos] = await Promise.all([
                fetch(`${url}?action=listar_pessoas`).then(r => r.json()),
                fetch(`${url}?action=listar_enderecos`).then(r => r.json()),
                P3.Cerbero.listarPessoaEnderecos(cfgUnidade).catch(e => {
                    console.error('[cerbero] Erro ao carregar vínculos pessoa↔endereço:', e);
                    return [];
                }),
            ]);
            pessoas = Array.isArray(respPessoas) ? respPessoas : [];
            enderecos = Array.isArray(respEnderecos) ? respEnderecos : [];
            montarMapasDeVinculo(respVinculos);
            carregado = true;
            renderizarPessoas();
            renderizarEnderecos();
            if (statusEl) statusEl.textContent = `${pessoas.length} pessoa(s), ${enderecos.length} endereço(s) carregado(s).`;
        } catch (e) {
            console.error('[cerbero] Erro ao carregar dados:', e);
            if (statusEl) statusEl.textContent = '⚠️ Erro ao carregar dados da Hostinger: ' + e.message;
        }
    }

    async function importar() {
        const input = document.getElementById('cerbero-input-har');
        const btn = document.getElementById('cerbero-btn-importar');
        const statusEl = document.getElementById('cerbero-status-msg');
        const wrap = document.getElementById('cerbero-progresso-wrap');
        const fill = document.getElementById('cerbero-progresso-fill');
        const texto = document.getElementById('cerbero-progresso-texto');
        const arquivo = input.files && input.files[0];
        if (!arquivo) return;

        if (typeof P3AtualizadorLocal === 'undefined' || !(await P3AtualizadorLocal.disponivel())) {
            alert('O atualizador local precisa estar aberto pra importar uma captura (é ele quem lê o arquivo e envia pra Hostinger). Abra o Sistema P3 (app desktop) ou rode "python app.py" e tente de novo.');
            return;
        }
        if (!confirm(`Importar "${arquivo.name}" (${(arquivo.size / 1024 / 1024).toFixed(1)}MB) pro Cérbero? Isso pode levar alguns minutos (fotos são enviadas uma a uma).`)) return;

        btn.disabled = true;
        input.disabled = true;
        wrap.style.display = 'block';
        fill.style.width = '0%';
        let etapas = 0;
        try {
            const resultado = await P3AtualizadorLocal.importarHarCerbero(arquivo, function (evt) {
                etapas++;
                texto.textContent = evt.mensagem || '';
                // Sem total conhecido de antemão (parse decide isso) — barra
                // "indeterminada" simples, só avança visualmente a cada evento.
                fill.style.width = Math.min(95, etapas * 4) + '%';
            });
            fill.style.width = '100%';
            const resumo = `Pessoas: ${resultado.pessoas} (${resultado.pessoasGravadas} gravada(s)) · ` +
                `Endereços: ${resultado.enderecos} (${resultado.enderecosGravados} gravado(s)) · ` +
                `Fotos: ${resultado.fotosEnviadas} enviada(s), ${resultado.fotosJaExistentes} já existente(s)` +
                (resultado.fotosComErro ? `, ${resultado.fotosComErro} com erro` : '');
            statusEl.textContent = '✅ ' + resumo;
            alert('Importação do Cérbero concluída!\n\n' + resumo);
            input.value = '';
            await carregarDados(true);
        } catch (e) {
            console.error('[cerbero] Erro na importação:', e);
            statusEl.textContent = '⚠️ Erro: ' + e.message;
            alert('Erro ao importar a captura do Cérbero: ' + e.message);
        } finally {
            btn.disabled = false;
            input.disabled = false;
            setTimeout(() => { wrap.style.display = 'none'; }, 1500);
        }
    }

    // ── "🧠 Gerar reconhecimento facial" (02/09/2026, pedido explícito do
    // usuário) — cerbero_har.py só sobe a FOTO (Python não roda
    // face-api.js, é só navegador); este botão roda no navegador, DEPOIS
    // da importação: baixa a foto de cada pessoa já importada que ainda
    // não tem vetor_facial, detecta o rosto (js/core/facial-detect.js,
    // já carregado nesta página) e grava o embedding — só a partir daí
    // essa pessoa passa a entrar na busca da aba "Reconhecimento facial"
    // (ver js/autores-reconhecimento-facial.js).
    //
    // Mesmo piso de confiança que cad-busca-foto.js usa pro mesmo motivo
    // (processamento em lote, sem humano revisando cada foto antes de
    // salvar o vetor) — duplicado aqui (não importado de lá) só pra não
    // criar acoplamento de ordem de carregamento entre os dois arquivos.
    const CERBERO_VETOR_SCORE_MINIMO = 0.35;

    async function baixarComoArquivo_(url, nomeArquivo) {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status} ao baixar a foto`);
        const blob = await resp.blob();
        return new File([blob], nomeArquivo, { type: blob.type || 'image/jpeg' });
    }

    async function gerarReconhecimentoFacial() {
        const btn = document.getElementById('cerbero-btn-facial');
        const statusEl = document.getElementById('cerbero-status-msg');
        const wrap = document.getElementById('cerbero-progresso-wrap');
        const fill = document.getElementById('cerbero-progresso-fill');
        const texto = document.getElementById('cerbero-progresso-texto');
        const baseFotos = (cfgUnidade && cfgUnidade.apiPhp && cfgUnidade.apiPhp.fotosCerberoBaseUrl) || '';
        if (!baseFotos) { alert('Configuração de fotos do Cérbero ausente.'); return; }

        let jaTemVetor;
        try {
            statusEl.textContent = '⏳ Verificando quem já tem reconhecimento facial…';
            jaTemVetor = await P3.Cerbero.listarVetores(cfgUnidade);
        } catch (e) {
            alert('Erro ao consultar vetores já existentes: ' + e.message);
            return;
        }

        const pendentes = pessoas.filter(p => p.fotoArquivo && !jaTemVetor[p.id]);
        if (!pendentes.length) {
            alert('Nenhuma pessoa pendente — todas as que têm foto já têm reconhecimento facial calculado (ou nenhuma pessoa importada tem foto ainda).');
            return;
        }
        if (!confirm(`Calcular reconhecimento facial pra ${pendentes.length} pessoa(s) com foto? Isso baixa cada foto e roda a detecção no navegador — pode levar alguns minutos.`)) return;

        btn.disabled = true;
        wrap.style.display = 'block';
        try {
            await p3CarregarModelosFaciais();
        } catch (e) {
            alert('Falha ao carregar os modelos de reconhecimento facial: ' + e.message);
            btn.disabled = false;
            wrap.style.display = 'none';
            return;
        }

        let processados = 0, comVetor = 0, semRosto = 0, erros = 0;
        for (const p of pendentes) {
            processados++;
            fill.style.width = Math.round((processados / pendentes.length) * 100) + '%';
            texto.textContent = `${processados}/${pendentes.length} — ${comVetor} com rosto, ${semRosto} sem rosto, ${erros} erro(s)`;
            try {
                const arquivo = await baixarComoArquivo_(baseFotos + p.fotoArquivo, `cerbero_${p.id}.jpg`);
                const deteccao = await p3DetectarRostoComQualidade(arquivo);
                if (deteccao && deteccao.score >= CERBERO_VETOR_SCORE_MINIMO) {
                    await P3.Cerbero.atualizarVetorFacial(cfgUnidade, p.id, deteccao.descritor);
                    comVetor++;
                } else {
                    semRosto++;
                }
            } catch (e) {
                console.error('[cerbero] Falha ao gerar vetor facial pra pessoa ' + p.id + ':', e);
                erros++;
            }
        }

        wrap.style.display = 'none';
        btn.disabled = false;
        const resumo = `${comVetor} pessoa(s) com reconhecimento facial calculado, ${semRosto} sem rosto detectável na foto, ${erros} erro(s) (de ${pendentes.length} processada(s)).`;
        statusEl.textContent = '✅ ' + resumo;
        alert('Reconhecimento facial do Cérbero concluído!\n\n' + resumo);
    }

    // ════════════════════════════════════════════════════════════════
    // Modal de detalhe (pessoa/endereço) — 02/09/2026, pedido explícito
    // do usuário: replicar o que aparece ao clicar numa pessoa/endereço
    // dentro do próprio Cérbero (abas Dados Gerais/Galeria de Imagens/
    // Vínculos/Abordagens da ficha). Modal DEDICADO (não reaproveita
    // js/pessoa-modal.js) — os campos e o cruzamento pessoa↔endereço são
    // específicos do Cérbero e não existem pra Autor/Suspeito, então um
    // componente próprio evita encher aquele com condicionais de um 4º
    // tipo. Mesmo visual (tokens --p3-*) pra ficar consistente com o
    // resto do sistema.
    // ════════════════════════════════════════════════════════════════
    const RES_PESSOA = {
        vulgos: 'Vulgos', filiacao1: 'Filiação 1', filiacao2: 'Filiação 2', sexo: 'Sexo',
        situacao: 'Situação', naturalidade: 'Naturalidade', nacionalidade: 'Nacionalidade',
        profissao: 'Profissão', faccao: 'Facção', orcrims: 'ORCRIM(s)',
        modus_operandi: 'Modus operandi', observacoes: 'Observações',
    };

    function garantirEstilosDetalhe() {
        if (document.getElementById('cb-detalhe-estilos')) return;
        const style = document.createElement('style');
        style.id = 'cb-detalhe-estilos';
        style.textContent = `
            #cb-detalhe-modal { display:none; position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:9100; align-items:center; justify-content:center; padding:20px; }
            #cb-detalhe-modal.aberto { display:flex; }
            .cb-box { background:var(--p3-surface,#fff); border:1px solid var(--p3-border,#ddd); border-radius:12px; max-width:820px; width:100%; max-height:90vh; overflow-y:auto; box-shadow:0 16px 48px rgba(0,0,0,.35); }
            .cb-head { background:#003366; color:#fff; padding:14px 18px; display:flex; justify-content:space-between; align-items:center; gap:10px; position:sticky; top:0; z-index:1; }
            .cb-head-titulo { font-weight:700; font-size:1rem; }
            .cb-head-sub { font-size:.75rem; opacity:.8; font-weight:400; }
            .cb-head button { background:none; border:none; color:rgba(255,255,255,.75); font-size:1.3rem; cursor:pointer; line-height:1; }
            .cb-body { padding:18px; display:flex; gap:20px; flex-wrap:wrap; }
            .cb-foto-col { flex:0 0 200px; display:flex; flex-direction:column; gap:10px; }
            .cb-foto-principal { width:200px; height:200px; border-radius:8px; object-fit:cover; background:var(--p3-bg); border:1px solid var(--p3-border); display:block; }
            .cb-foto-vazia { width:200px; height:200px; border-radius:8px; background:var(--p3-bg); border:2px dashed var(--p3-border); display:flex; align-items:center; justify-content:center; color:var(--p3-text-muted); font-size:12px; text-align:center; padding:10px; box-sizing:border-box; }
            .cb-galeria-titulo { font-size:.7rem; font-weight:700; text-transform:uppercase; color:var(--p3-text-muted); margin-top:2px; }
            .cb-galeria { display:flex; flex-wrap:wrap; gap:6px; }
            .cb-galeria img { width:56px; height:56px; border-radius:6px; object-fit:cover; border:1px solid var(--p3-border); cursor:pointer; }
            .cb-dados-col { flex:1 1 380px; min-width:280px; display:flex; flex-direction:column; gap:18px; }
            .cb-secao-titulo { font-size:.75rem; font-weight:700; text-transform:uppercase; letter-spacing:.03em; color:var(--p3-text-muted); border-bottom:1px solid var(--p3-border); padding-bottom:4px; margin-bottom:8px; }
            .cb-campos { display:flex; flex-direction:column; gap:5px; }
            .cb-campo { display:flex; gap:8px; font-size:12.5px; line-height:1.4; }
            .cb-campo-label { flex:0 0 150px; color:var(--p3-text-muted); }
            .cb-campo-valor { flex:1; color:var(--p3-text); word-break:break-word; white-space:pre-wrap; }
            .cb-vazio { font-size:12.5px; color:var(--p3-text-muted); font-style:italic; }
            .cb-lista-item { border:1px solid var(--p3-border); border-radius:6px; padding:8px 10px; margin-bottom:6px; font-size:12.5px; cursor:pointer; }
            .cb-lista-item:hover { border-color:var(--p3-blue-700,#003366); }
        `;
        document.head.appendChild(style);
    }

    function garantirModalDetalhe() {
        garantirEstilosDetalhe();
        if (document.getElementById('cb-detalhe-modal')) return;
        const div = document.createElement('div');
        div.id = 'cb-detalhe-modal';
        div.innerHTML = `
            <div class="cb-box">
                <div class="cb-head">
                    <div>
                        <div class="cb-head-titulo" id="cb-titulo">—</div>
                        <div class="cb-head-sub" id="cb-subtitulo"></div>
                    </div>
                    <button type="button" id="cb-fechar" title="Fechar">✕</button>
                </div>
                <div class="cb-body" id="cb-corpo"></div>
            </div>`;
        document.body.appendChild(div);
        document.getElementById('cb-fechar').addEventListener('click', fecharDetalhe);
        div.addEventListener('click', e => { if (e.target === div) fecharDetalhe(); });
    }

    function fecharDetalhe() {
        const el = document.getElementById('cb-detalhe-modal');
        if (el) el.classList.remove('aberto');
    }

    function linhaCampo(rotulo, valor) {
        return `<div class="cb-campo"><span class="cb-campo-label">${escaparHtml(rotulo)}</span><span class="cb-campo-valor">${escaparHtml(valor)}</span></div>`;
    }

    async function abrirDetalhePessoa(id) {
        const p = pessoas.find(x => String(x.id) === String(id));
        if (!p) return;
        garantirModalDetalhe();

        document.getElementById('cb-titulo').textContent = p.nome || '(sem nome)';
        document.getElementById('cb-subtitulo').textContent = `Pessoa (Cérbero) · CPF ${p.cpf || '—'}`;

        const baseFotos = (cfgUnidade && cfgUnidade.apiPhp && cfgUnidade.apiPhp.fotosCerberoBaseUrl) || '';
        const urlFotoPrincipal = p.fotoArquivo && baseFotos ? baseFotos + p.fotoArquivo : null;

        let camposHtml = Object.keys(RES_PESSOA)
            .filter(k => p[k])
            .map(k => linhaCampo(RES_PESSOA[k], p[k]))
            .join('');
        if (p.nascimento) camposHtml = linhaCampo('Nascimento', formatarDataBr(p.nascimento)) + camposHtml;
        if (!camposHtml) camposHtml = '<div class="cb-vazio">Sem outros campos preenchidos.</div>';

        const idsEndereco = enderecosDaPessoa.get(String(p.id)) || [];
        const enderecosHtml = idsEndereco.length
            ? idsEndereco.map(idEnd => {
                const end = enderecos.find(e => String(e.id) === idEnd);
                return `<div class="cb-lista-item" data-cb-endereco="${escaparHtml(idEnd)}">📍 ${escaparHtml(end ? end.endereco : ('Endereço #' + idEnd))}</div>`;
            }).join('')
            : '<div class="cb-vazio">Nenhum endereço vinculado nesta captura — abra a aba "Vínculos → Endereços" desta pessoa no Cérbero antes de exportar o próximo .har pra isso aparecer aqui.</div>';

        document.getElementById('cb-corpo').innerHTML = `
            <div class="cb-foto-col">
                ${urlFotoPrincipal ? `<img class="cb-foto-principal" src="${escaparHtml(urlFotoPrincipal)}" alt="Foto principal">` : `<div class="cb-foto-vazia">Sem foto cadastrada</div>`}
                <div class="cb-galeria-titulo" id="cb-galeria-titulo" style="display:none;">Todas as fotos registradas</div>
                <div class="cb-galeria" id="cb-galeria"></div>
            </div>
            <div class="cb-dados-col">
                <div>
                    <div class="cb-secao-titulo">📋 Dados Gerais</div>
                    <div class="cb-campos">${camposHtml}</div>
                </div>
                <div>
                    <div class="cb-secao-titulo">📍 Endereços vinculados</div>
                    ${enderecosHtml}
                </div>
            </div>`;

        document.getElementById('cb-detalhe-modal').classList.add('aberto');

        // Galeria carregada à parte (chamada de rede) — não trava a
        // abertura do modal.
        try {
            const fotos = await P3.Cerbero.listarFotos(cfgUnidade, p.id);
            const lista = Array.isArray(fotos) ? fotos.slice() : [];
            if (p.fotoArquivo && !lista.some(f => f.arquivo === p.fotoArquivo)) lista.unshift({ arquivo: p.fotoArquivo });
            const wrapTitulo = document.getElementById('cb-galeria-titulo');
            const wrap = document.getElementById('cb-galeria');
            if (wrapTitulo && wrap && lista.length) {
                wrapTitulo.style.display = '';
                wrapTitulo.textContent = `Todas as fotos registradas (${lista.length})`;
                wrap.innerHTML = lista.map(f => {
                    const url = baseFotos + f.arquivo;
                    return `<a href="${escaparHtml(url)}" target="_blank" rel="noopener"><img src="${escaparHtml(url)}" alt=""></a>`;
                }).join('');
            }
        } catch (e) {
            console.error('[cerbero] Erro ao carregar galeria de fotos:', e);
        }
    }

    function abrirDetalheEndereco(id) {
        const end = enderecos.find(x => String(x.id) === String(id));
        if (!end) return;
        garantirModalDetalhe();

        document.getElementById('cb-titulo').textContent = end.endereco || '(sem endereço)';
        document.getElementById('cb-subtitulo').textContent = 'Endereço (Cérbero)';

        const idsPessoa = pessoasDoEndereco.get(String(end.id)) || [];
        const pessoasHtml = idsPessoa.length
            ? idsPessoa.map(idPes => {
                const p = pessoas.find(x => String(x.id) === idPes);
                const nome = p ? (p.nome || '(sem nome)') : ('Pessoa #' + idPes);
                const cpf = p && p.cpf ? ` · CPF ${p.cpf}` : '';
                return `<div class="cb-lista-item" data-cb-pessoa="${escaparHtml(idPes)}">👤 ${escaparHtml(nome)}${escaparHtml(cpf)}</div>`;
            }).join('')
            : '<div class="cb-vazio">Nenhuma pessoa vinculada nesta captura — abra a aba "Vínculos → Endereços" da pessoa correspondente no Cérbero antes de exportar o próximo .har pra isso aparecer aqui.</div>';

        document.getElementById('cb-corpo').innerHTML = `
            <div class="cb-dados-col" style="flex-basis:100%;">
                <div>
                    <div class="cb-secao-titulo">👥 Pessoas vinculadas</div>
                    ${pessoasHtml}
                </div>
            </div>`;

        document.getElementById('cb-detalhe-modal').classList.add('aberto');
    }

    document.addEventListener('DOMContentLoaded', function () {
        // Sob controle da P2 — pedido explícito do usuário: aba (e o
        // recurso todo) só aparece pra sessão p2/admin, mesmo critério já
        // usado pra fonte 7/8 de notificações (autor/suspeito) em
        // js/core/notificacoes.js.
        const sessao = (window.P3 && window.P3.getSession) ? window.P3.getSession() : null;
        const autorizado = !!sessao && (sessao.nivel === 'p2' || sessao.nivel === 'admin');
        const btnAba = document.getElementById('aba-btn-cerbero');
        if (!btnAba) return;
        if (!autorizado) return; // fica escondida (display:none já é o padrão no HTML)
        btnAba.style.display = '';

        document.getElementById('cerbero-input-har').addEventListener('change', function (e) {
            document.getElementById('cerbero-btn-importar').disabled = !(e.target.files && e.target.files.length);
        });
        document.getElementById('cerbero-btn-importar').addEventListener('click', importar);
        document.getElementById('cerbero-btn-facial').addEventListener('click', gerarReconhecimentoFacial);
        document.getElementById('cerbero-filtro-pessoas').addEventListener('input', renderizarPessoas);
        document.getElementById('cerbero-filtro-enderecos').addEventListener('input', renderizarEnderecos);

        // Clique numa linha da tabela de Pessoas/Endereços abre o modal de
        // detalhe (delegado no tbody, já que as linhas são recriadas a
        // cada render/filtro).
        document.getElementById('cerbero-corpo-pessoas').addEventListener('click', function (e) {
            const linha = e.target.closest('[data-cb-pessoa]');
            if (linha) abrirDetalhePessoa(linha.dataset.cbPessoa);
        });
        document.getElementById('cerbero-corpo-enderecos').addEventListener('click', function (e) {
            const linha = e.target.closest('[data-cb-endereco]');
            if (linha) abrirDetalheEndereco(linha.dataset.cbEndereco);
        });

        // Navegação DENTRO do modal — clicar num endereço vinculado (na
        // ficha da pessoa) ou numa pessoa vinculada (na ficha do
        // endereço) troca o conteúdo pro outro lado do vínculo, sem
        // fechar o modal.
        garantirModalDetalhe();
        document.getElementById('cb-corpo').addEventListener('click', function (e) {
            const itemPessoa = e.target.closest('[data-cb-pessoa]');
            if (itemPessoa) { abrirDetalhePessoa(itemPessoa.dataset.cbPessoa); return; }
            const itemEndereco = e.target.closest('[data-cb-endereco]');
            if (itemEndereco) { abrirDetalheEndereco(itemEndereco.dataset.cbEndereco); }
        });
    });

    window.P3Cerbero = {
        carregarSeNecessario: function () { carregarDados(false); },
    };
})();
