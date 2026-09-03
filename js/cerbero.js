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

    // Tabela paginada (03/09/2026, pedido explícito do usuário: "devolvendo
    // a tabela porém com limite de 50 linhas para cada página") — a busca
    // acima FILTRA a lista, a tabela sempre mostra o resultado paginado
    // (com busca vazia = tudo, paginado). Mesmo tamanho de página que
    // Autores/Suspeitos já usam (ver ITENS_POR_PAGINA em js/autores.js).
    const ITENS_POR_PAGINA = 50;
    let paginaAtualPessoas = 1;
    let paginaAtualEnderecos = 1;

    // Vínculos pessoa↔endereço (aba "Vínculos" → "Endereços" da ficha da
    // pessoa no Cérbero — ver tools/atualizador-local/cerbero_har.py). Só
    // existe vínculo pra quem o usuário abriu essa sub-aba durante a
    // captura — a maioria das pessoas/endereços não tem nenhum ainda, e
    // isso vai se completando aos poucos a cada .har novo. Mapas
    // derivados nos dois sentidos pra não varrer a lista toda a cada
    // clique de detalhe.
    let enderecosDaPessoa = new Map();  // pessoaId(string) -> [enderecoId, ...]
    let pessoasDoEndereco = new Map();  // enderecoId(string) -> [pessoaId, ...]

    // Último resultado de Consulta Integrada rodado a partir desta aba —
    // {pessoaId, resultado} — guardado só EM MEMÓRIA (não persiste ao
    // fechar/reabrir o modal de outra pessoa), usado pra não reconsultar
    // à toa se o usuário fechar e reabrir o mesmo detalhe, e pro botão
    // "Imprimir dossiê completo" ter o que combinar com os dados do
    // Cérbero (ver executarConsultaIntegrada/imprimirDossie abaixo).
    let ultimaConsultaIntegrada = null;

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

    // ── Busca (02/09/2026, pedido explícito do usuário: "esconda todos
    // eles mostrando somente um campo de pesquisa... por cpf, nome,
    // cidade, facção ou orcrim, ou data de nascimento") — nada é
    // renderizado sem uma busca; a lista de 500+ pessoas/endereços não
    // aparece mais de cara (só depois de um clique, ver
    // abrirDetalhePessoa/abrirDetalheEndereco). Tudo client-side (os
    // dados já estão carregados em memória) — não existe "cidade" como
    // campo próprio da pessoa no Cérbero, então esse critério casa contra
    // a naturalidade da pessoa E contra o texto de qualquer endereço já
    // vinculado a ela (a cidade mora dentro do texto do endereço, ex.:
    // "...CENTRO, MURICI - AL").
    function pessoaCasaComBusca(p, queryNorm, queryDigitos) {
        if (queryDigitos.length >= 3 && normalizar(p.cpf).includes(queryDigitos)) return true;
        const camposTexto = [p.nome, p.vulgos, p.faccao, p.orcrims, p.naturalidade, p.nacionalidade];
        if (camposTexto.some(c => normalizar(c).includes(queryNorm))) return true;
        if (queryDigitos.length >= 4) {
            const dataIso = String(p.nascimento || '').replace(/\D/g, '');
            const dataBr = formatarDataBr(p.nascimento).replace(/\D/g, '');
            if (dataIso.includes(queryDigitos) || dataBr.includes(queryDigitos)) return true;
        }
        const idsEndereco = enderecosDaPessoa.get(String(p.id)) || [];
        return idsEndereco.some(idEnd => {
            const end = enderecos.find(e => String(e.id) === idEnd);
            return end && normalizar(end.endereco).includes(queryNorm);
        });
    }

    function enderecoCasaComBusca(e, queryNorm) {
        return normalizar(e.endereco).includes(queryNorm);
    }

    function listaFiltradaPessoas() {
        const bruto = document.getElementById('cerbero-input-busca').value.trim();
        if (!bruto) return pessoas;
        const queryNorm = normalizar(bruto);
        const queryDigitos = bruto.replace(/\D/g, '');
        return pessoas.filter(p => pessoaCasaComBusca(p, queryNorm, queryDigitos));
    }

    function listaFiltradaEnderecos() {
        const bruto = document.getElementById('cerbero-input-busca').value.trim();
        if (!bruto) return enderecos;
        const queryNorm = normalizar(bruto);
        return enderecos.filter(e => enderecoCasaComBusca(e, queryNorm));
    }

    function renderizarTabelaPessoas() {
        const lista = listaFiltradaPessoas();
        const totalPaginas = Math.max(1, Math.ceil(lista.length / ITENS_POR_PAGINA));
        if (paginaAtualPessoas > totalPaginas) paginaAtualPessoas = totalPaginas;
        const inicio = (paginaAtualPessoas - 1) * ITENS_POR_PAGINA;
        const pagina = lista.slice(inicio, inicio + ITENS_POR_PAGINA);
        const baseFotos = (cfgUnidade && cfgUnidade.apiPhp && cfgUnidade.apiPhp.fotosCerberoBaseUrl) || '';

        document.getElementById('cerbero-corpo-pessoas').innerHTML = pagina.map(p => {
            const foto = p.fotoArquivo
                ? `<img src="${escaparHtml(baseFotos + p.fotoArquivo)}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:4px;">`
                : '—';
            return `<tr data-cb-pessoa="${escaparHtml(p.id)}" title="Clique para ver os detalhes">
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
        }).join('') || '<tr><td colspan="9" class="empty-msg">Nenhuma pessoa encontrada.</td></tr>';

        const pagWrap = document.getElementById('cerbero-paginacao-pessoas');
        pagWrap.style.display = lista.length > ITENS_POR_PAGINA ? 'flex' : 'none';
        document.getElementById('cerbero-pessoas-pag-texto').textContent = `Página ${paginaAtualPessoas} de ${totalPaginas} (${lista.length} pessoa(s))`;
        document.getElementById('cerbero-pessoas-pag-anterior').disabled = paginaAtualPessoas <= 1;
        document.getElementById('cerbero-pessoas-pag-proxima').disabled = paginaAtualPessoas >= totalPaginas;
    }

    function renderizarTabelaEnderecos() {
        const lista = listaFiltradaEnderecos();
        const totalPaginas = Math.max(1, Math.ceil(lista.length / ITENS_POR_PAGINA));
        if (paginaAtualEnderecos > totalPaginas) paginaAtualEnderecos = totalPaginas;
        const inicio = (paginaAtualEnderecos - 1) * ITENS_POR_PAGINA;
        const pagina = lista.slice(inicio, inicio + ITENS_POR_PAGINA);

        document.getElementById('cerbero-corpo-enderecos').innerHTML = pagina.map(e => {
            const qtdPessoas = (pessoasDoEndereco.get(String(e.id)) || []).length;
            const vinculo = qtdPessoas ? `${qtdPessoas} pessoa(s)` : '<span style="opacity:.5;">nenhum vínculo capturado</span>';
            return `<tr data-cb-endereco="${escaparHtml(e.id)}" title="Clique para ver os detalhes">
                <td>${escaparHtml(e.endereco || '---')}</td>
                <td>${vinculo}</td>
            </tr>`;
        }).join('') || '<tr><td colspan="2" class="empty-msg">Nenhum endereço encontrado.</td></tr>';

        const pagWrap = document.getElementById('cerbero-paginacao-enderecos');
        pagWrap.style.display = lista.length > ITENS_POR_PAGINA ? 'flex' : 'none';
        document.getElementById('cerbero-enderecos-pag-texto').textContent = `Página ${paginaAtualEnderecos} de ${totalPaginas} (${lista.length} endereço(s))`;
        document.getElementById('cerbero-enderecos-pag-anterior').disabled = paginaAtualEnderecos <= 1;
        document.getElementById('cerbero-enderecos-pag-proxima').disabled = paginaAtualEnderecos >= totalPaginas;
    }

    function renderizarTudo() {
        if (!carregado) return;
        const info = document.getElementById('cerbero-resultados-info');
        const bruto = document.getElementById('cerbero-input-busca').value.trim();
        info.textContent = bruto
            ? `${listaFiltradaPessoas().length} pessoa(s), ${listaFiltradaEnderecos().length} endereço(s) encontrado(s).`
            : `${pessoas.length} pessoa(s), ${enderecos.length} endereço(s) no total.`;
        renderizarTabelaPessoas();
        renderizarTabelaEnderecos();
    }

    function buscar() {
        paginaAtualPessoas = 1;
        paginaAtualEnderecos = 1;
        renderizarTudo();
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
            renderizarTudo();
            if (statusEl) statusEl.textContent = `${pessoas.length} pessoa(s), ${enderecos.length} endereço(s) carregado(s).`;
        } catch (e) {
            console.error('[cerbero] Erro ao carregar dados:', e);
            if (statusEl) statusEl.textContent = '⚠️ Erro ao carregar dados da Hostinger: ' + e.message;
        }
    }

    // Corpo comum de "importar" e "importar do disco local" — só muda a
    // função que efetivamente chama o servidor (`executor`) e quais
    // elementos ficam desabilitados durante a importação.
    async function executarImportacao(executor, elementosParaDesabilitar) {
        const statusEl = document.getElementById('cerbero-status-msg');
        const wrap = document.getElementById('cerbero-progresso-wrap');
        const fill = document.getElementById('cerbero-progresso-fill');
        const texto = document.getElementById('cerbero-progresso-texto');

        elementosParaDesabilitar.forEach(el => { el.disabled = true; });
        wrap.style.display = 'block';
        fill.style.width = '0%';
        let etapas = 0;
        try {
            const resultado = await executor(function (evt) {
                etapas++;
                texto.textContent = evt.mensagem || '';
                // Sem total conhecido de antemão (parse decide isso) — barra
                // "indeterminada" simples, só avança visualmente a cada evento.
                fill.style.width = Math.min(95, etapas * 2) + '%';
            });
            fill.style.width = '100%';
            const resumo = `Pessoas: ${resultado.pessoas} (${resultado.pessoasGravadas} gravada(s)) · ` +
                `Endereços: ${resultado.enderecos} (${resultado.enderecosGravados} gravado(s)) · ` +
                `Fotos: ${resultado.fotosEnviadas} enviada(s), ${resultado.fotosJaExistentes} já existente(s)` +
                (resultado.fotosComErro ? `, ${resultado.fotosComErro} com erro` : '');
            statusEl.textContent = '✅ ' + resumo;
            alert('Importação do Cérbero concluída!\n\n' + resumo);
            await carregarDados(true);
        } catch (e) {
            console.error('[cerbero] Erro na importação:', e);
            statusEl.textContent = '⚠️ Erro: ' + e.message;
            alert('Erro ao importar a captura do Cérbero: ' + e.message);
        } finally {
            elementosParaDesabilitar.forEach(el => { el.disabled = false; });
            setTimeout(() => { wrap.style.display = 'none'; }, 1500);
        }
    }

    async function importar() {
        const input = document.getElementById('cerbero-input-har');
        const btn = document.getElementById('cerbero-btn-importar');
        const arquivo = input.files && input.files[0];
        if (!arquivo) return;

        if (typeof P3AtualizadorLocal === 'undefined' || !(await P3AtualizadorLocal.disponivel())) {
            alert('O atualizador local precisa estar aberto pra importar uma captura (é ele quem lê o arquivo e envia pra Hostinger). Abra o Sistema P3 (app desktop) ou rode "python app.py" e tente de novo.');
            return;
        }
        if (!confirm(`Importar "${arquivo.name}" (${(arquivo.size / 1024 / 1024).toFixed(1)}MB) pro Cérbero? Isso pode levar alguns minutos (fotos são enviadas uma a uma).`)) return;

        await executarImportacao(
            (onProgresso) => P3AtualizadorLocal.importarHarCerbero(arquivo, onProgresso),
            [btn, input]
        );
        input.value = '';
    }

    // Importa direto pelo CAMINHO do arquivo (03/09/2026, pedido explícito
    // do usuário: capturas de vários GB não cabem numa cópia temporária
    // extra em disco pra fazer o upload por HTTP — ver comentário em
    // app.py:rota_cerbero_importar_caminho_local). Só uma string, sem
    // subir o conteúdo nenhuma vez pelo navegador.
    async function importarLocal() {
        const inputCaminho = document.getElementById('cerbero-input-caminho-local');
        const btn = document.getElementById('cerbero-btn-importar-local');
        const caminho = inputCaminho.value.trim();
        if (!caminho) { alert('Cole o caminho completo do arquivo primeiro (ex.: C:\\Users\\...\\Downloads\\cerbero_captura.ndjson).'); return; }

        if (typeof P3AtualizadorLocal === 'undefined' || !(await P3AtualizadorLocal.disponivel())) {
            alert('O atualizador local precisa estar aberto pra importar uma captura. Abra o Sistema P3 (app desktop) e tente de novo.');
            return;
        }
        if (!confirm(`Importar o arquivo em:\n${caminho}\n\npro Cérbero? Isso pode levar bastante tempo em capturas grandes (fotos são enviadas uma a uma).`)) return;

        await executarImportacao(
            (onProgresso) => P3AtualizadorLocal.importarCaminhoLocalCerbero(caminho, onProgresso),
            [btn, inputCaminho]
        );
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

    function garantirEstilosCerbero() {
        if (document.getElementById('cb-detalhe-estilos')) return;
        const style = document.createElement('style');
        style.id = 'cb-detalhe-estilos';
        style.textContent = `
            .cb-resultado-item { display:flex; align-items:center; gap:12px; border:1px solid var(--p3-border); border-radius:8px; padding:8px 12px; margin-bottom:8px; cursor:pointer; transition:border-color .1s; }
            .cb-btn { display:inline-block; background:var(--p3-blue-700,#003366); color:#fff; border:none; border-radius:6px; padding:8px 14px; font-size:12.5px; font-weight:600; cursor:pointer; text-decoration:none; }
            .cb-btn:hover { opacity:.9; }
            .cb-btn:disabled { opacity:.5; cursor:not-allowed; }
            .cb-alerta { background:#fdeaea; color:#8a1f1f; border:1px solid #e39a9a; border-radius:6px; padding:8px 12px; font-size:12.5px; font-weight:600; margin-bottom:10px; }
        `;
        style.textContent += `
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
        garantirEstilosCerbero();
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
                <button type="button" id="cb-btn-imprimir-dossie" class="cb-btn" style="margin-top:6px;">🖨️ Imprimir dossiê completo</button>
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
                <div>
                    <div class="cb-secao-titulo">🔎 Consulta Integrada</div>
                    <div id="cb-consulta-integrada"><div class="cb-vazio">⏳ Carregando...</div></div>
                </div>
            </div>`;

        document.getElementById('cb-detalhe-modal').classList.add('aberto');
        document.getElementById('cb-btn-imprimir-dossie').addEventListener('click', () => imprimirDossie(p));

        // Consulta Integrada (03/09/2026, pedido explícito do usuário) —
        // NÃO espera clique: já tenta mostrar/rodar sozinha assim que o
        // modal abre (ver carregarOuExecutarConsultaIntegrada abaixo).
        carregarOuExecutarConsultaIntegrada(p);

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

    function formatarDataHoraBr(mysqlDatetime) {
        if (!mysqlDatetime) return '';
        const m = String(mysqlDatetime).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
        return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : String(mysqlDatetime);
    }

    // Resumo (03/09/2026, pedido explícito do usuário: "mostrando todos
    // os dados como no consulta integrada com fotos do alcatraz e idseg e
    // processos") — mesmo objeto que page/consulta-pessoa.html usa (ver
    // js/consulta-pessoa.js), com galeria de fotos (r.fotos já junta
    // Alcatraz + Quimera/IDSEG num array só) e tabela de processos
    // inline. Não reimplementa a renderização INTEIRA de lá (~2000
    // linhas, ocorrências/vínculos/veículos em detalhe exaustivo) — o
    // link "Abrir consulta completa" leva pra tela de verdade pra quem
    // quiser aprofundar nisso. Os mesmos campos aqui alimentam o dossiê
    // impresso (ver montarDossieHtml).
    function montarResumoConsultaIntegradaHtml(p, r, consultadoEmTexto) {
        const pessoaR = r.pessoa || {};
        const totalOcorrencias = (r.ocorrenciasPpe || []).length + (r.ocorrenciasPcAntigo || []).length + (r.ocorrenciasDespacho || []).length;
        const processos = r.processos || [];
        const totalVeiculos = (r.veiculos || []).length;
        const totalVinculos = ((pessoaR.mae || pessoaR.pai) ? 1 : 0) + (r.vinculosOcorrencia || []).length + ((r.inteligencia && r.inteligencia.vinculos) || []).length;
        const mandadoAtivo = !!(r.mandados && r.mandados.possuiMandado);
        const fotos = r.fotos || [];

        const galeriaHtml = fotos.length
            ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">${fotos.map(f =>
                `<a href="${escaparHtml(f)}" target="_blank" rel="noopener"><img src="${escaparHtml(f)}" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:6px;border:1px solid var(--p3-border);"></a>`
              ).join('')}</div>`
            : '<div class="cb-vazio" style="margin-bottom:10px;">Nenhuma foto encontrada (Alcatraz/Quimera).</div>';

        const processosHtml = processos.length
            ? `<div class="cb-secao-titulo" style="border:none;padding:0;margin:10px 0 4px;font-size:11px;">Processos judiciais (${processos.length})</div>` +
              processos.slice(0, 10).map(pr => `<div class="cb-lista-item" style="cursor:default;">${escaparHtml(pr.tribunal || 'TJAL')} — ${escaparHtml(pr.numeroProcesso || '—')}${pr.classe ? ' · ' + escaparHtml(pr.classe) : ''}</div>`).join('')
            : '';

        return `
            ${consultadoEmTexto ? `<div style="font-size:11px;color:var(--p3-text-muted);margin-bottom:8px;">Consultado em ${escaparHtml(consultadoEmTexto)}</div>` : ''}
            ${mandadoAtivo ? '<div class="cb-alerta">🚨 Mandado de prisão ativo (BNMP)</div>' : ''}
            ${galeriaHtml}
            <div class="cb-campos">
                ${linhaCampo('Vínculos', String(totalVinculos))}
                ${linhaCampo('Ocorrências', String(totalOcorrencias))}
                ${linhaCampo('Processos', String(processos.length))}
                ${linhaCampo('Veículos', String(totalVeiculos))}
            </div>
            ${processosHtml}
            <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
                <a href="consulta-pessoa.html?cpf=${encodeURIComponent(p.cpf)}" target="_blank" rel="noopener" class="cb-btn">↗ Abrir consulta completa</a>
                <button type="button" id="cb-btn-nova-consulta" class="cb-btn" style="background:#8a6100;" title="Roda a consulta de novo e sobrescreve os dados salvos, caso ache que estão desatualizados">🔄 Nova consulta</button>
            </div>`;
    }

    // Orquestra a abertura da Consulta Integrada (03/09/2026, pedido
    // explícito do usuário): 1º tenta a versão JÁ SALVA na Hostinger
    // (rápida, sem precisar do CAD); se não tiver, roda a consulta de
    // verdade SOZINHA (sem precisar clicar em nada) quando o atualizador
    // local (CAD/Quimera) estiver disponível, e salva o resultado assim
    // que chega — pra da PRÓXIMA vez que essa pessoa for aberta, ser
    // instantâneo. O botão "🔄 Nova consulta" (dentro do resumo) sempre
    // permite forçar uma consulta nova, sobrescrevendo a salva.
    async function carregarOuExecutarConsultaIntegrada(p) {
        const area = document.getElementById('cb-consulta-integrada');
        if (!area) return;
        if (!p.cpf) {
            area.innerHTML = '<div class="cb-vazio">Pessoa sem CPF — não é possível fazer a consulta integrada.</div>';
            return;
        }

        try {
            const salvo = await P3.Cerbero.obterConsultaIntegrada(cfgUnidade, p.id);
            if (salvo && salvo.encontrado) {
                ultimaConsultaIntegrada = { pessoaId: p.id, resultado: salvo.resultado };
                area.innerHTML = montarResumoConsultaIntegradaHtml(p, salvo.resultado, formatarDataHoraBr(salvo.consultadoEm));
                const btnNova = document.getElementById('cb-btn-nova-consulta');
                if (btnNova) btnNova.addEventListener('click', () => executarConsultaIntegrada(p));
                return;
            }
        } catch (e) {
            console.error('[cerbero] erro ao buscar consulta integrada salva:', e);
        }

        // Sem nada salvo ainda — tenta rodar sozinha (cai pro botão manual
        // dentro de executarConsultaIntegrada se o CAD/Quimera não estiver
        // disponível agora).
        await executarConsultaIntegrada(p);
    }

    // roda /pessoa/consultar (mesma rota/serviço local de page/consulta-
    // pessoa.html — CAD PPE/PC/SISPOL/BNMP/IDNET, TJAL, Supabase) direto
    // pra dentro do modal, sem precisar trocar de tela. Exige o
    // atualizador local aberto e logado no CAD/Quimera — a trava de
    // nível (P2/ADMIN) já é a mesma que libera a página Cérbero inteira.
    // Ao terminar, SALVA o resultado na Hostinger (ver
    // carregarOuExecutarConsultaIntegrada acima) pra não precisar
    // reconsultar da próxima vez.
    async function executarConsultaIntegrada(p) {
        const area = document.getElementById('cb-consulta-integrada');
        if (!area) return;
        if (typeof P3AtualizadorLocal === 'undefined' || !(await P3AtualizadorLocal.disponivel())) {
            area.innerHTML = '<div class="cb-vazio">⚠️ O atualizador local (CAD/Quimera) não está aberto — não deu pra consultar automaticamente.</div>' +
                '<button type="button" id="cb-btn-consulta-integrada" class="cb-btn" style="margin-top:6px;">🔎 Tentar consulta integrada</button>';
            const btnTentar = document.getElementById('cb-btn-consulta-integrada');
            if (btnTentar) btnTentar.addEventListener('click', () => executarConsultaIntegrada(p));
            return;
        }
        area.innerHTML = '<div class="cb-vazio" id="cb-consulta-progresso">⏳ Iniciando consulta integrada (CAD/Quimera)...</div>';
        try {
            const resultado = await P3AtualizadorLocal.consultarPessoaStream(p.cpf, function (evento) {
                const el = document.getElementById('cb-consulta-progresso');
                if (!el) return;
                if (evento.tipo === 'progresso') el.textContent = '⏳ ' + (evento.etapa || 'Consultando...');
                else if (evento.tipo === 'aguardando') el.textContent = '⏳ ' + (evento.mensagem || 'Aguardando outra consulta terminar...');
            });
            ultimaConsultaIntegrada = { pessoaId: p.id, resultado };
            area.innerHTML = montarResumoConsultaIntegradaHtml(p, resultado, new Date().toLocaleString('pt-BR'));
            const btnNova = document.getElementById('cb-btn-nova-consulta');
            if (btnNova) btnNova.addEventListener('click', () => executarConsultaIntegrada(p));
            // Salva pra próxima abertura ser instantânea — não trava a
            // tela por isso, e uma falha aqui não invalida o que já foi
            // mostrado (só significa que vai reconsultar da próxima vez).
            P3.Cerbero.salvarConsultaIntegrada(cfgUnidade, p.id, p.cpf, resultado).catch(e => {
                console.error('[cerbero] falha ao salvar consulta integrada:', e);
            });
        } catch (e) {
            console.error('[cerbero] Erro na consulta integrada:', e);
            area.innerHTML = `<div class="cb-vazio">⚠️ Erro na consulta: ${escaparHtml(e.message)}</div>
                <button type="button" id="cb-btn-consulta-integrada" class="cb-btn" style="margin-top:6px;">🔎 Tentar de novo</button>`;
            const btn = document.getElementById('cb-btn-consulta-integrada');
            if (btn) btn.addEventListener('click', () => executarConsultaIntegrada(p));
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

    // ════════════════════════════════════════════════════════════════
    // Dossiê impresso (02/09/2026, pedido explícito do usuário) — junta
    // o registro do Cérbero (já em memória) com o resultado da Consulta
    // Integrada (se já foi rodada nesta sessão pro mesmo CPF — ver
    // executarConsultaIntegrada acima; se não foi, imprime só a parte do
    // Cérbero e avisa isso claramente, em vez de fingir uma seção vazia).
    // Não reaproveita o HTML/CSS da tela (telas normais) — monta um
    // documento HTML próprio numa aba nova, focado em impressão (preto e
    // branco, sem elementos interativos), e chama print() sozinho.
    // ════════════════════════════════════════════════════════════════
    function montarLinhaDoTempoOcorrencias(r) {
        const itens = [];
        (r.ocorrenciasPpe || []).forEach(o => itens.push({
            data: o.dt_ocorrencia, texto: `${o.no_natureza_ocorrencia || 'Ocorrência'} (${o.tipo_envolvimento || '—'})`, fonte: 'PPE',
        }));
        (r.ocorrenciasPcAntigo || []).forEach(o => itens.push({
            data: o.data_hora_registro, texto: `Boletim ${o.attr_numero_bo || '—'}`, fonte: 'Registro anterior',
        }));
        (r.ocorrenciasDespacho || []).forEach(o => itens.push({
            data: o.dt_ocor, texto: `${o.ds_ocor_sgrup || 'Ocorrência'} (${o.ds_oco_despc_tipo_envl || '—'})`, fonte: 'Despacho',
        }));
        itens.sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));
        return itens;
    }

    function montarDossieHtml(p, r) {
        const agora = new Date();
        const sessao = (window.P3 && window.P3.getSession) ? window.P3.getSession() : null;
        const geradoPor = sessao ? `${sessao.graduacao ? sessao.graduacao + ' ' : ''}${sessao.nomeGuerra || sessao.nome || sessao.cpf}` : '—';
        const baseFotos = (cfgUnidade && cfgUnidade.apiPhp && cfgUnidade.apiPhp.fotosCerberoBaseUrl) || '';
        const urlFoto = p.fotoArquivo && baseFotos ? baseFotos + p.fotoArquivo : null;

        const camposCerbero = Object.keys(RES_PESSOA)
            .filter(k => p[k])
            .map(k => `<tr><td class="rot">${escaparHtml(RES_PESSOA[k])}</td><td>${escaparHtml(p[k])}</td></tr>`)
            .join('');
        const linhaNascimento = p.nascimento ? `<tr><td class="rot">Nascimento</td><td>${escaparHtml(formatarDataBr(p.nascimento))}</td></tr>` : '';

        const idsEndereco = enderecosDaPessoa.get(String(p.id)) || [];
        const enderecosHtml = idsEndereco.length
            ? '<ul>' + idsEndereco.map(idEnd => {
                const end = enderecos.find(e => String(e.id) === idEnd);
                return `<li>${escaparHtml(end ? end.endereco : ('Endereço #' + idEnd))}</li>`;
            }).join('') + '</ul>'
            : '<p class="vazio">Nenhum endereço vinculado nesta captura.</p>';

        let secaoConsulta;
        if (!r) {
            secaoConsulta = '<p class="vazio">Consulta Integrada não foi realizada nesta sessão — os dados abaixo refletem só o que está registrado no Cérbero.</p>';
        } else {
            const pessoaR = r.pessoa || {};
            const mandadoAtivo = !!(r.mandados && r.mandados.possuiMandado);
            const timeline = montarLinhaDoTempoOcorrencias(r);
            const processos = r.processos || [];
            const veiculos = r.veiculos || [];
            const vinculosOc = r.vinculosOcorrencia || [];
            const vinculosSb = (r.inteligencia && r.inteligencia.vinculos) || [];

            secaoConsulta = `
                ${mandadoAtivo ? '<p class="alerta">🚨 MANDADO DE PRISÃO ATIVO (BNMP)</p>' : '<p class="vazio">Nenhum mandado de prisão ativo encontrado no BNMP.</p>'}
                ${(pessoaR.mae || pessoaR.pai) ? `<p><b>Filiação (CAD):</b> ${pessoaR.mae ? 'Mãe: ' + escaparHtml(pessoaR.mae) : ''}${pessoaR.mae && pessoaR.pai ? ' · ' : ''}${pessoaR.pai ? 'Pai: ' + escaparHtml(pessoaR.pai) : ''}</p>` : ''}

                <h3>Ocorrências (${timeline.length})</h3>
                ${timeline.length ? '<table class="tb"><thead><tr><th>Data</th><th>Descrição</th><th>Fonte</th></tr></thead><tbody>' +
                    timeline.map(i => `<tr><td>${escaparHtml(i.data || '—')}</td><td>${escaparHtml(i.texto)}</td><td>${escaparHtml(i.fonte)}</td></tr>`).join('') +
                    '</tbody></table>' : '<p class="vazio">Nenhuma ocorrência encontrada.</p>'}

                <h3>Processos judiciais (${processos.length})</h3>
                ${processos.length ? '<table class="tb"><thead><tr><th>Tribunal</th><th>Nº processo</th><th>Classe/Assunto</th><th>Último andamento</th></tr></thead><tbody>' +
                    processos.map(pr => `<tr><td>${escaparHtml(pr.tribunal || 'TJAL')}</td><td>${escaparHtml(pr.numeroProcesso)}</td><td>${escaparHtml([pr.classe, pr.assunto].filter(Boolean).join(' — ') || '—')}</td><td>${escaparHtml((pr.ultimoMovimento && (pr.ultimoMovimento.textoCompleto || pr.ultimoMovimento.nome)) || '—')}</td></tr>`).join('') +
                    '</tbody></table>' : '<p class="vazio">Nenhum processo encontrado.</p>'}

                <h3>Veículos (${veiculos.length})</h3>
                ${veiculos.length ? '<table class="tb"><thead><tr><th>Placa</th><th>Modelo</th><th>Relação</th></tr></thead><tbody>' +
                    veiculos.map(v => `<tr><td>${escaparHtml(v.placa)}</td><td>${escaparHtml((v.detran && v.detran['Modelo']) || '—')}</td><td>${escaparHtml(v.relacao === 'PROPRIETARIO' ? 'Proprietário' : 'Envolvido')}</td></tr>`).join('') +
                    '</tbody></table>' : '<p class="vazio">Nenhum veículo encontrado.</p>'}

                <h3>Vínculos (${vinculosOc.length + vinculosSb.length})</h3>
                ${(vinculosOc.length || vinculosSb.length) ? '<table class="tb"><thead><tr><th>Nome</th><th>CPF</th><th>Origem</th></tr></thead><tbody>' +
                    vinculosOc.map(v => `<tr><td>${escaparHtml(v.nome)}</td><td>${escaparHtml(v.cpf || '—')}</td><td>Vínculo por ocorrência</td></tr>`).join('') +
                    vinculosSb.map(v => `<tr><td>${escaparHtml(v.nome || '—')}</td><td>${escaparHtml(v.cpf || '—')}</td><td>Vínculo cadastrado</td></tr>`).join('') +
                    '</tbody></table>' : '<p class="vazio">Nenhum vínculo encontrado.</p>'}`;
        }

        return `<!doctype html><html><head><meta charset="utf-8"><title>Dossiê — ${escaparHtml(p.nome || p.cpf || '')}</title>
            <style>
                body { font-family: Arial, Helvetica, sans-serif; color:#111; margin:24px; font-size:13px; }
                h1 { font-size:18px; margin:0 0 2px; }
                h2 { font-size:14px; margin:24px 0 8px; border-bottom:2px solid #003366; padding-bottom:4px; color:#003366; }
                h3 { font-size:12.5px; margin:16px 0 6px; color:#003366; }
                .cabecalho { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #003366; padding-bottom:10px; margin-bottom:16px; }
                .meta { font-size:11px; color:#555; text-align:right; }
                .conteudo { display:flex; gap:20px; }
                .foto-col { flex:0 0 140px; }
                .foto-col img { width:140px; height:140px; object-fit:cover; border:1px solid #ccc; }
                .foto-vazia { width:140px; height:140px; border:1px dashed #999; display:flex; align-items:center; justify-content:center; font-size:11px; color:#999; text-align:center; }
                .dados-col { flex:1; }
                table.kv { border-collapse:collapse; width:100%; margin-bottom:10px; }
                table.kv td { padding:3px 6px; font-size:12px; border-bottom:1px solid #eee; }
                table.kv td.rot { color:#555; width:140px; font-weight:600; }
                table.tb { border-collapse:collapse; width:100%; margin-bottom:8px; }
                table.tb th, table.tb td { border:1px solid #ccc; padding:4px 6px; font-size:11px; text-align:left; }
                table.tb th { background:#f0f0f0; }
                ul { margin:4px 0; padding-left:20px; font-size:12px; }
                .vazio { color:#777; font-style:italic; font-size:12px; }
                .alerta { background:#fdeaea; color:#8a1f1f; border:1px solid #e39a9a; padding:6px 10px; font-weight:700; }
                @media print { body { margin:10mm; } }
            </style></head>
            <body>
                <div class="cabecalho">
                    <div><h1>Dossiê — ${escaparHtml(p.nome || '(sem nome)')}</h1><div>CPF ${escaparHtml(p.cpf || '—')} · Fontes: Cérbero${r ? ' + Consulta Integrada' : ''}</div></div>
                    <div class="meta">Gerado em ${escaparHtml(agora.toLocaleString('pt-BR'))}<br>Por: ${escaparHtml(geradoPor)}<br><b>USO INSTITUCIONAL — SIGILOSO</b></div>
                </div>
                <div class="conteudo">
                    <div class="foto-col">${urlFoto ? `<img src="${escaparHtml(urlFoto)}" alt="">` : '<div class="foto-vazia">Sem foto</div>'}</div>
                    <div class="dados-col">
                        <h2>Dados Gerais (Cérbero)</h2>
                        <table class="kv">${linhaNascimento}${camposCerbero}</table>
                        <h3>Endereços vinculados</h3>
                        ${enderecosHtml}
                    </div>
                </div>
                <h2>Consulta Integrada</h2>
                ${secaoConsulta}
            </body></html>`;
    }

    function imprimirDossie(p) {
        const consultaExistente = (ultimaConsultaIntegrada && String(ultimaConsultaIntegrada.pessoaId) === String(p.id))
            ? ultimaConsultaIntegrada.resultado : null;
        const html = montarDossieHtml(p, consultaExistente);
        const janela = window.open('', '_blank');
        if (!janela) { alert('O navegador bloqueou a janela de impressão — permita pop-ups pra este site e tente de novo.'); return; }
        janela.document.write(html);
        janela.document.close();
        janela.focus();
        setTimeout(() => janela.print(), 300); // dá tempo da foto carregar antes de abrir o diálogo de impressão
    }

    document.addEventListener('DOMContentLoaded', function () {
        // 03/09/2026 — Cérbero virou página própria (page/cerbero.html),
        // que já bloqueia a página inteira pra quem não é P2/ADMIN antes
        // de sequer chamar carregarSeNecessario(). A checagem de nível
        // que existia aqui (quando isso era uma ABA escondida dentro de
        // Autores) não é mais necessária.
        if (!document.getElementById('cerbero-input-busca')) return; // página sem esse painel — nada a fazer

        document.getElementById('cerbero-input-har').addEventListener('change', function (e) {
            document.getElementById('cerbero-btn-importar').disabled = !(e.target.files && e.target.files.length);
        });
        document.getElementById('cerbero-btn-importar').addEventListener('click', importar);
        document.getElementById('cerbero-btn-importar-local').addEventListener('click', importarLocal);
        document.getElementById('cerbero-input-caminho-local').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') importarLocal();
        });
        document.getElementById('cerbero-btn-facial').addEventListener('click', gerarReconhecimentoFacial);

        // Busca — botão, Enter, ou digitação (debounce 250ms, já que roda
        // sobre 500+ registros em memória a cada tecla senão).
        let timerBusca = null;
        const inputBusca = document.getElementById('cerbero-input-busca');
        inputBusca.addEventListener('input', function () {
            clearTimeout(timerBusca);
            timerBusca = setTimeout(buscar, 250);
        });
        inputBusca.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { clearTimeout(timerBusca); buscar(); }
        });
        document.getElementById('cerbero-btn-buscar').addEventListener('click', buscar);

        // Paginação (50 por página) — Pessoas e Endereços são
        // independentes uma da outra.
        document.getElementById('cerbero-pessoas-pag-anterior').addEventListener('click', () => {
            if (paginaAtualPessoas > 1) { paginaAtualPessoas--; renderizarTabelaPessoas(); }
        });
        document.getElementById('cerbero-pessoas-pag-proxima').addEventListener('click', () => {
            paginaAtualPessoas++; renderizarTabelaPessoas();
        });
        document.getElementById('cerbero-enderecos-pag-anterior').addEventListener('click', () => {
            if (paginaAtualEnderecos > 1) { paginaAtualEnderecos--; renderizarTabelaEnderecos(); }
        });
        document.getElementById('cerbero-enderecos-pag-proxima').addEventListener('click', () => {
            paginaAtualEnderecos++; renderizarTabelaEnderecos();
        });

        // Clique numa linha da tabela (pessoa ou endereço) abre o modal de
        // detalhe (delegado, já que a tabela é recriada a cada página).
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
