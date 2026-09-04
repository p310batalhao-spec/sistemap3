// ====================================================================
// Sistema P3 — Lista de Interesses (módulo P2)
// ====================================================================
// 04/09/2026, pedido explícito do usuário: alvos marcados com "add lista
// de interesses" em Autores/Suspeitos/Cérbero (ver js/pessoa-modal.js e
// js/cerbero.js) aparecem aqui, com Consulta Integrada (processos,
// ocorrências, movimentações) acompanhada automaticamente — mesma lógica
// de cache-primeiro-depois-consulta-automática que js/cerbero.js já usa,
// só que o cache aqui é compartilhado por CPF entre as 3 origens (ver
// hostinger-api/consulta_integrada.php e P3.ConsultaIntegrada em
// js/core/session.js), porque uma pessoa vinda de Autores/Suspeitos não
// tem id do Cérbero pra usar como chave.
(function () {
    'use strict';

    let cfgUnidade = null;
    let itens = [];
    // origemId(string) -> {nome, cpf, fotoArquivo} — construído 1x a
    // partir de Autores/Suspeitos/Cérbero, usado só pra completar nome/
    // foto de itens que foram salvos sem esses campos (ex.: nome mudou
    // desde que foi adicionado à lista).
    let mapaAutores = new Map();
    let mapaSuspeitos = new Map();
    let mapaCerbero = new Map();

    function escaparHtml(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function formatarDataHoraBr(mysqlDatetime) {
        if (!mysqlDatetime) return '';
        const m = String(mysqlDatetime).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
        return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : String(mysqlDatetime);
    }

    const ORIGEM_LABEL = { autor: 'Autor', suspeito: 'Suspeito', cerbero: 'Cérbero' };

    function construirMapaOrigem(origem, dados) {
        const mapa = new Map();
        if (origem === 'cerbero') {
            (Array.isArray(dados) ? dados : []).forEach(p => mapa.set(String(p.id), { nome: p.nome, cpf: p.cpf, fotoArquivo: p.fotoArquivo }));
        } else {
            Object.entries(dados || {}).forEach(([id, r]) => mapa.set(String(id), { nome: r.NOME, cpf: r.CPF, fotoArquivo: r.fotoArquivo }));
        }
        return mapa;
    }

    function urlFotoDoItem(item) {
        if (!cfgUnidade || !cfgUnidade.apiPhp) return null;
        const mapa = item.origem === 'autor' ? mapaAutores : item.origem === 'suspeito' ? mapaSuspeitos : mapaCerbero;
        const extra = mapa.get(String(item.origemId));
        const arquivo = extra && extra.fotoArquivo;
        if (!arquivo) return null;
        const base = item.origem === 'autor' ? cfgUnidade.apiPhp.fotosAutoresBaseUrl
            : item.origem === 'suspeito' ? cfgUnidade.apiPhp.fotosSuspeitosBaseUrl
            : cfgUnidade.apiPhp.fotosCerberoBaseUrl;
        return base ? base + arquivo : null;
    }

    function nomeDoItem(item) {
        if (item.nome) return item.nome;
        const mapa = item.origem === 'autor' ? mapaAutores : item.origem === 'suspeito' ? mapaSuspeitos : mapaCerbero;
        const extra = mapa.get(String(item.origemId));
        return (extra && extra.nome) || '(sem nome)';
    }

    function cpfDoItem(item) {
        if (item.cpf) return item.cpf;
        const mapa = item.origem === 'autor' ? mapaAutores : item.origem === 'suspeito' ? mapaSuspeitos : mapaCerbero;
        const extra = mapa.get(String(item.origemId));
        return (extra && extra.cpf) || '';
    }

    async function carregarDados() {
        const listaEl = document.getElementById('li-lista');
        const vaziaEl = document.getElementById('li-lista-vazia');
        try {
            if (!cfgUnidade) cfgUnidade = await P3.loadUnidadeConfig();

            const [interesses, autores, suspeitos] = await Promise.all([
                P3.ListaInteresses.listar(cfgUnidade),
                P3.Autores.listar(cfgUnidade).catch(() => ({})),
                P3.Suspeitos.disponivel(cfgUnidade) ? P3.Suspeitos.listar(cfgUnidade).catch(() => ({})) : Promise.resolve({}),
            ]);
            let cerberoPessoas = [];
            if (cfgUnidade.apiPhp && cfgUnidade.apiPhp.cerberoUrl) {
                try {
                    const r = await fetch(`${cfgUnidade.apiPhp.cerberoUrl}?action=listar_pessoas`);
                    cerberoPessoas = r.ok ? await r.json() : [];
                } catch (e) { cerberoPessoas = []; }
            }

            mapaAutores = construirMapaOrigem('autor', autores);
            mapaSuspeitos = construirMapaOrigem('suspeito', suspeitos);
            mapaCerbero = construirMapaOrigem('cerbero', cerberoPessoas);
            itens = Array.isArray(interesses) ? interesses : [];

            if (!itens.length) {
                listaEl.innerHTML = '';
                vaziaEl.style.display = '';
                return;
            }
            vaziaEl.style.display = 'none';
            renderizarLista();
        } catch (e) {
            console.error('[lista-interesses] Erro ao carregar dados:', e);
            listaEl.innerHTML = `<div class="li-vazio">⚠️ Erro ao carregar a lista de interesses: ${escaparHtml(e.message)}</div>`;
        }
    }

    function renderizarLista() {
        const listaEl = document.getElementById('li-lista');
        listaEl.innerHTML = itens.map(item => {
            const url = urlFotoDoItem(item);
            const foto = url ? `<img class="li-foto" src="${escaparHtml(url)}" alt="">` : '<div class="li-foto-vazia">👤</div>';
            const origemClass = item.origem === 'cerbero' ? ' cerbero' : '';
            return `<div class="li-card" data-li-item="${item.id}">
                <div class="li-card-topo">
                    ${foto}
                    <div class="li-info">
                        <div class="li-nome">${escaparHtml(nomeDoItem(item))}</div>
                        <div class="li-meta">
                            <span class="li-origem-selo${origemClass}">${escaparHtml(ORIGEM_LABEL[item.origem] || item.origem)}</span>
                            CPF ${escaparHtml(cpfDoItem(item) || '—')} · Adicionado em ${escaparHtml(formatarDataHoraBr(item.adicionadoEm))}
                        </div>
                    </div>
                    <button type="button" class="li-btn-remover" data-li-remover="${item.id}" title="Remover da lista de interesses">🗑️</button>
                </div>
                <div class="li-consulta" id="li-consulta-${item.id}"><div class="li-vazio">⏳ Carregando...</div></div>
            </div>`;
        }).join('');

        itens.forEach(item => carregarOuExecutarConsultaIntegrada(item));
    }

    function montarResumoHtml(item, r, consultadoEmTexto) {
        const totalOcorrencias = (r.ocorrenciasPpe || []).length + (r.ocorrenciasPcAntigo || []).length + (r.ocorrenciasDespacho || []).length;
        const processos = r.processos || [];
        const totalVeiculos = (r.veiculos || []).length;
        const pessoaR = r.pessoa || {};
        const totalVinculos = ((pessoaR.mae || pessoaR.pai) ? 1 : 0) + (r.vinculosOcorrencia || []).length + ((r.inteligencia && r.inteligencia.vinculos) || []).length;
        const mandadoAtivo = !!(r.mandados && r.mandados.possuiMandado);
        const fotos = r.fotos || [];

        const galeriaHtml = fotos.length
            ? `<div class="li-galeria">${fotos.slice(0, 8).map(f => `<a href="${escaparHtml(f)}" target="_blank" rel="noopener"><img src="${escaparHtml(f)}" alt=""></a>`).join('')}</div>`
            : '';

        return `
            ${consultadoEmTexto ? `<div style="font-size:11px;color:#7f92b3;margin-bottom:8px;">Consultado em ${escaparHtml(consultadoEmTexto)}</div>` : ''}
            ${mandadoAtivo ? '<div class="li-alerta">🚨 Mandado de prisão ativo (BNMP)</div>' : ''}
            ${galeriaHtml}
            <div class="li-contadores">
                <span>Vínculos <b>${totalVinculos}</b></span>
                <span>Ocorrências <b>${totalOcorrencias}</b></span>
                <span>Processos <b>${processos.length}</b></span>
                <span>Veículos <b>${totalVeiculos}</b></span>
            </div>
            <div class="li-botoes">
                <button type="button" class="li-btn" data-li-abrir="${item.id}">↗ Abrir consulta completa</button>
                <button type="button" class="li-btn li-btn-nova" data-li-nova="${item.id}" title="Roda a consulta de novo e sobrescreve os dados salvos">🔄 Nova consulta</button>
                <button type="button" class="li-btn" data-li-dossie="${item.id}">🖨️ Dossiê completo</button>
            </div>`;
    }

    // Último resultado por item (id da lista de interesses) — usado pro
    // dossiê impresso, mesmo espírito de ultimaConsultaIntegrada em
    // js/cerbero.js.
    const ultimaConsulta = new Map();

    async function carregarOuExecutarConsultaIntegrada(item) {
        const area = document.getElementById('li-consulta-' + item.id);
        if (!area) return;
        const cpf = cpfDoItem(item);
        if (!cpf) { area.innerHTML = '<div class="li-vazio">Pessoa sem CPF — não é possível fazer a consulta integrada.</div>'; return; }

        try {
            const salvo = await P3.ConsultaIntegrada.obter(cfgUnidade, cpf);
            if (salvo && salvo.encontrado) {
                ultimaConsulta.set(item.id, salvo.resultado);
                area.innerHTML = montarResumoHtml(item, salvo.resultado, formatarDataHoraBr(salvo.consultadoEm));
                return;
            }
        } catch (e) {
            console.error('[lista-interesses] erro ao buscar consulta integrada salva:', e);
        }

        await executarConsultaIntegrada(item);
    }

    async function executarConsultaIntegrada(item) {
        const area = document.getElementById('li-consulta-' + item.id);
        if (!area) return;
        const cpf = cpfDoItem(item);
        if (!cpf) return;

        if (typeof P3AtualizadorLocal === 'undefined' || !(await P3AtualizadorLocal.disponivel())) {
            area.innerHTML = '<div class="li-vazio">⚠️ O atualizador local (CAD/Quimera) não está aberto — não deu pra consultar automaticamente.</div>' +
                `<button type="button" class="li-btn" data-li-retry="${item.id}" style="margin-top:6px;">🔎 Tentar consulta integrada</button>`;
            return;
        }
        area.innerHTML = `<div class="li-vazio" id="li-progresso-${item.id}">⏳ Iniciando consulta integrada (CAD/Quimera)...</div>`;
        try {
            const resultado = await P3AtualizadorLocal.consultarPessoaStream(cpf, function (evento) {
                const el = document.getElementById('li-progresso-' + item.id);
                if (!el) return;
                if (evento.tipo === 'progresso') el.textContent = '⏳ ' + (evento.etapa || 'Consultando...');
                else if (evento.tipo === 'aguardando') el.textContent = '⏳ ' + (evento.mensagem || 'Aguardando outra consulta terminar...');
            });
            ultimaConsulta.set(item.id, resultado);
            area.innerHTML = montarResumoHtml(item, resultado, new Date().toLocaleString('pt-BR'));
            P3.ConsultaIntegrada.salvar(cfgUnidade, cpf, resultado).catch(e => {
                console.error('[lista-interesses] falha ao salvar consulta integrada:', e);
            });
        } catch (e) {
            console.error('[lista-interesses] Erro na consulta integrada:', e);
            area.innerHTML = `<div class="li-vazio">⚠️ Erro na consulta: ${escaparHtml(e.message)}</div>
                <button type="button" class="li-btn" data-li-retry="${item.id}" style="margin-top:6px;">🔎 Tentar de novo</button>`;
        }
    }

    // ── Modal com iframe pra "Abrir consulta completa" (mesmo padrão de
    // js/cerbero.js:abrirConsultaCompletaEmModal). ──────────────────────
    function garantirModalIframe() {
        if (document.getElementById('li-iframe-modal')) return;
        const div = document.createElement('div');
        div.id = 'li-iframe-modal';
        div.innerHTML = `
            <div class="li-iframe-box">
                <div class="li-iframe-head">
                    <span>🔎 Consulta Integrada completa</span>
                    <button type="button" id="li-iframe-fechar" title="Fechar">✕</button>
                </div>
                <iframe id="li-iframe-conteudo" src="about:blank"></iframe>
            </div>`;
        document.body.appendChild(div);
        document.getElementById('li-iframe-fechar').addEventListener('click', fecharModalIframe);
        div.addEventListener('click', e => { if (e.target === div) fecharModalIframe(); });
    }

    function fecharModalIframe() {
        const el = document.getElementById('li-iframe-modal');
        if (!el) return;
        el.classList.remove('aberto');
        const iframe = document.getElementById('li-iframe-conteudo');
        if (iframe) iframe.src = 'about:blank';
    }

    function abrirConsultaCompletaEmModal(cpf) {
        if (!cpf) return;
        garantirModalIframe();
        document.getElementById('li-iframe-conteudo').src = `consulta-pessoa.html?cpf=${encodeURIComponent(cpf)}`;
        document.getElementById('li-iframe-modal').classList.add('aberto');
    }

    // ── Dossiê impresso (mesmo padrão de js/cerbero.js:imprimirDossie —
    // iframe oculto, sem window.open, pra não esbarrar em bloqueador de
    // pop-up). Mais enxuto que o do Cérbero (sem "Dados Gerais"/endereços
    // — origens diferentes não têm esses campos em comum). ─────────────
    function montarLinhaDoTempoOcorrencias(r) {
        const itensT = [];
        (r.ocorrenciasPpe || []).forEach(o => itensT.push({ data: o.dt_ocorrencia, texto: `${o.no_natureza_ocorrencia || 'Ocorrência'} (${o.tipo_envolvimento || '—'})`, fonte: 'PPE' }));
        (r.ocorrenciasPcAntigo || []).forEach(o => itensT.push({ data: o.data_hora_registro, texto: `Boletim ${o.attr_numero_bo || '—'}`, fonte: 'Registro anterior' }));
        (r.ocorrenciasDespacho || []).forEach(o => itensT.push({ data: o.dt_ocor, texto: `${o.ds_ocor_sgrup || 'Ocorrência'} (${o.ds_oco_despc_tipo_envl || '—'})`, fonte: 'Despacho' }));
        itensT.sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));
        return itensT;
    }

    function montarDossieHtml(item, r) {
        const agora = new Date();
        const sessao = (window.P3 && window.P3.getSession) ? window.P3.getSession() : null;
        const geradoPor = sessao ? `${sessao.graduacao ? sessao.graduacao + ' ' : ''}${sessao.nomeGuerra || sessao.nome || sessao.cpf}` : '—';
        const urlFoto = urlFotoDoItem(item);
        const nome = nomeDoItem(item);
        const cpf = cpfDoItem(item);

        let secaoConsulta;
        if (!r) {
            secaoConsulta = '<p class="vazio">Consulta Integrada ainda não foi carregada — os dados abaixo refletem só o cadastro de origem.</p>';
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

        return `<!doctype html><html><head><meta charset="utf-8"><title>Dossiê — ${escaparHtml(nome || cpf || '')}</title>
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
                table.tb { border-collapse:collapse; width:100%; margin-bottom:8px; }
                table.tb th, table.tb td { border:1px solid #ccc; padding:4px 6px; font-size:11px; text-align:left; }
                table.tb th { background:#f0f0f0; }
                .vazio { color:#777; font-style:italic; font-size:12px; }
                .alerta { background:#fdeaea; color:#8a1f1f; border:1px solid #e39a9a; padding:6px 10px; font-weight:700; }
                @media print { body { margin:10mm; } }
            </style></head>
            <body>
                <div class="cabecalho">
                    <div><h1>Dossiê — ${escaparHtml(nome || '(sem nome)')}</h1><div>CPF ${escaparHtml(cpf || '—')} · Origem: ${escaparHtml(ORIGEM_LABEL[item.origem] || item.origem)}</div></div>
                    <div class="meta">Gerado em ${escaparHtml(agora.toLocaleString('pt-BR'))}<br>Por: ${escaparHtml(geradoPor)}<br><b>USO INSTITUCIONAL — SIGILOSO</b></div>
                </div>
                <div class="conteudo">
                    <div class="foto-col">${urlFoto ? `<img src="${escaparHtml(urlFoto)}" alt="">` : '<div class="foto-vazia">Sem foto</div>'}</div>
                    <div style="flex:1;">${secaoConsulta}</div>
                </div>
            </body></html>`;
    }

    function imprimirDossie(item) {
        const r = ultimaConsulta.get(item.id) || null;
        const html = montarDossieHtml(item, r);

        let iframe = document.getElementById('li-print-iframe');
        if (!iframe) {
            iframe = document.createElement('iframe');
            iframe.id = 'li-print-iframe';
            iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:1120px;border:0;';
            document.body.appendChild(iframe);
        }
        const doc = iframe.contentWindow.document;
        doc.open();
        doc.write(html);
        doc.close();
        setTimeout(() => {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
        }, 300);
    }

    async function removerItem(id) {
        const item = itens.find(it => String(it.id) === String(id));
        if (!item) return;
        if (!confirm(`Remover "${nomeDoItem(item)}" da lista de interesses?`)) return;
        try {
            await P3.ListaInteresses.remover(cfgUnidade, { origem: item.origem, origemId: item.origemId });
            itens = itens.filter(it => String(it.id) !== String(id));
            const card = document.querySelector(`[data-li-item="${id}"]`);
            if (card) card.remove();
            if (!itens.length) document.getElementById('li-lista-vazia').style.display = '';
        } catch (e) {
            alert('Erro ao remover: ' + e.message);
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        const listaEl = document.getElementById('li-lista');
        if (!listaEl) return; // página sem esse painel — nada a fazer

        listaEl.addEventListener('click', function (e) {
            const btnRemover = e.target.closest('[data-li-remover]');
            if (btnRemover) { removerItem(btnRemover.dataset.liRemover); return; }

            const btnNova = e.target.closest('[data-li-nova]');
            if (btnNova) { const item = itens.find(it => String(it.id) === btnNova.dataset.liNova); if (item) executarConsultaIntegrada(item); return; }

            const btnRetry = e.target.closest('[data-li-retry]');
            if (btnRetry) { const item = itens.find(it => String(it.id) === btnRetry.dataset.liRetry); if (item) executarConsultaIntegrada(item); return; }

            const btnAbrir = e.target.closest('[data-li-abrir]');
            if (btnAbrir) { const item = itens.find(it => String(it.id) === btnAbrir.dataset.liAbrir); if (item) abrirConsultaCompletaEmModal(cpfDoItem(item)); return; }

            const btnDossie = e.target.closest('[data-li-dossie]');
            if (btnDossie) { const item = itens.find(it => String(it.id) === btnDossie.dataset.liDossie); if (item) imprimirDossie(item); return; }
        });
    });

    window.P3ListaInteresses = { carregar: carregarDados };
})();
