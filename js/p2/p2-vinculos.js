/* ====================================================================
   P2 · Análise de Vínculos — rede interativa + ranking (nativo do Echelon)
   Ranking de centralidade (vw_rede_centralidade) e rede de vínculos
   (vw_rede_arestas_agregadas) renderizada com vis-network. Clique num nó
   para ver, dar 2 cliques para recentralizar, ou abrir a Ficha Alvo.
   ==================================================================== */
(function () {
    'use strict';
    const alvo = P2.iniciar({ active: 'analise-vinculos', titulo: 'Análise de Vínculos', sub: 'Rede de relacionamentos' });
    if (!alvo) return;
    const esc = P2.esc, sb = P2.sb;

    let RANK = [], aba = 'conectado', centerId = null, network = null, selId = null;
    const campoAba = { conectado: 'score_conectado', articulado: 'score_articulado', ponte: 'score_ponte' };

    alvo.innerHTML = `<div class="p2-page-head"><h1><i class="fa-solid fa-diagram-project"></i> Análise de Vínculos</h1>
        <p>Rede de relacionamentos da inteligência — identifique os alvos mais conectados, articuladores e pontes entre grupos.</p></div>
        <div class="rede-layout">
            <div class="rede-rank">
                <h2><i class="fa-solid fa-ranking-star"></i> Ranking</h2>
                <div class="rede-rank-tabs">
                    <div class="rede-tab on" data-aba="conectado">Conectado</div>
                    <div class="rede-tab" data-aba="articulado">Articulado</div>
                    <div class="rede-tab" data-aba="ponte">Ponte</div>
                </div>
                <div id="rede-rank-lista"><div class="fa-vazio" style="color:var(--p2-txt-dim2)">⏳ Carregando…</div></div>
            </div>
            <div class="rede-main">
                <div class="rede-toolbar">
                    <div class="pi-busca-wrap"><span class="pi-busca-ic">🔍</span>
                        <input class="pi-busca" id="rede-q" placeholder="Centralizar alvo por nome…" autocomplete="off"></div>
                </div>
                <div id="rede-net"></div>
                <div class="rede-info" id="rede-info"></div>
                <div class="rede-dica"><i class="fa-solid fa-circle-info"></i> Clique num nó para ver · 2 cliques para recentralizar · tamanho do nó = grau de conexões.</div>
            </div>
        </div>`;

    if (!window.vis) {
        document.getElementById('rede-net').innerHTML = '<div class="p2-empty"><div class="ic">⚠️</div><p>A biblioteca de rede não carregou (precisa de internet).</p></div>';
    }
    document.querySelectorAll('.rede-tab').forEach(t => t.onclick = () => { aba = t.dataset.aba; document.querySelectorAll('.rede-tab').forEach(x => x.classList.toggle('on', x === t)); renderRank(); });
    let tq = null;
    document.getElementById('rede-q').oninput = e => { clearTimeout(tq); tq = setTimeout(() => buscar(e.target.value.trim()), 400); };

    carregar();

    async function carregar() {
        try {
            RANK = await sb.get('vw_rede_centralidade', 'select=pessoa_id,nome_completo,grau,forca_ponderada,score_conectado,score_articulado,score_ponte&order=score_conectado.desc.nullslast&limit=60');
        } catch (e) { RANK = []; }
        renderRank();
        if (RANK[0] && window.vis) centralizar(RANK[0].pessoa_id, RANK[0].nome_completo);
    }
    function renderRank() {
        const lista = RANK.slice().sort((a, b) => (b[campoAba[aba]] || 0) - (a[campoAba[aba]] || 0)).slice(0, 40);
        const box = document.getElementById('rede-rank-lista');
        if (!lista.length) { box.innerHTML = '<div class="fa-vazio" style="color:var(--p2-txt-dim2)">Sem dados de rede.</div>'; return; }
        box.innerHTML = lista.map((r, i) => `<div class="rede-item" data-id="${esc(r.pessoa_id)}">
            <span class="rede-pos">${i + 1}</span>
            <span class="rede-item-tx"><b>${esc(r.nome_completo || '—')}</b><small>grau ${r.grau ?? 0}</small></span>
            <span class="rede-score">${Math.round((r[campoAba[aba]] || 0) * (aba === 'conectado' ? 1 : 100)) / (aba === 'conectado' ? 1 : 100) || (r[campoAba[aba]] != null ? (+r[campoAba[aba]]).toFixed(2) : '0')}</span>
        </div>`).join('');
        box.querySelectorAll('.rede-item').forEach(el => el.onclick = () => centralizar(el.dataset.id, el.querySelector('b').textContent));
    }

    async function buscar(termo) {
        if (termo.length < 2) return;
        try {
            const r = await sb.get('vw_rede_centralidade', 'select=pessoa_id,nome_completo&nome_completo=ilike.*' + encodeURIComponent(termo) + '*&limit=1');
            if (r && r[0]) centralizar(r[0].pessoa_id, r[0].nome_completo);
            else document.getElementById('rede-info').className = 'rede-info on', document.getElementById('rede-info').innerHTML = 'Nenhum alvo com vínculos para “' + esc(termo) + '”.';
        } catch (e) { /* ignora */ }
    }

    async function centralizar(pid, nomeHint) {
        if (!window.vis) return;
        centerId = pid;
        const net = document.getElementById('rede-net');
        net.innerHTML = '<div class="p2-empty"><div class="ic">⏳</div><p>Montando a rede…</p></div>';
        let arestas;
        try {
            arestas = await sb.get('vw_rede_arestas_agregadas', 'select=pessoa_a_id,pessoa_b_id,forca_total,total_arestas,ultima_referencia&or=(pessoa_a_id.eq.' + pid + ',pessoa_b_id.eq.' + pid + ')&order=forca_total.desc.nullslast&limit=70');
        } catch (e) { net.innerHTML = '<div class="p2-empty"><div class="ic">⚠️</div><p>Erro ao carregar a rede.</p></div>'; return; }
        const ids = new Set([pid]); arestas.forEach(e => { ids.add(e.pessoa_a_id); ids.add(e.pessoa_b_id); });
        let info = {};
        try { (await sb.get('vw_rede_centralidade', 'select=pessoa_id,nome_completo,grau&pessoa_id=in.(' + [...ids].join(',') + ')')).forEach(n => info[n.pessoa_id] = n); } catch (e) { }

        const escuro = document.documentElement.getAttribute('data-p3-theme') === 'dark';
        const fonte = escuro ? '#e7ecf5' : '#1a2335';
        const corAresta = escuro ? 'rgba(160,185,220,.45)' : 'rgba(40,70,120,.35)';
        const nodes = [...ids].map(id => {
            const n = info[id] || {}; const centro = id === pid;
            return {
                id, label: (n.nome_completo || (centro ? (nomeHint || 'Alvo') : 'Alvo')).split(' ').slice(0, 2).join(' '),
                title: n.nome_completo || '', value: (n.grau || 1),
                color: centro ? { background: '#3d7bf7', border: '#1746b0' } : { background: escuro ? '#1e3a5f' : '#cfe0ff', border: '#5a8ad0' },
                font: { color: fonte, size: centro ? 16 : 13, strokeWidth: 0 },
            };
        });
        const edges = arestas.map(e => ({ from: e.pessoa_a_id, to: e.pessoa_b_id, value: e.forca_total || 1, color: { color: corAresta } }));

        if (network) { network.destroy(); network = null; }
        net.innerHTML = '';
        network = new vis.Network(net, { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) }, {
            nodes: { shape: 'dot', scaling: { min: 8, max: 42 }, borderWidth: 2 },
            edges: { scaling: { min: 1, max: 7 }, smooth: false },
            physics: { stabilization: { iterations: 150 }, barnesHut: { gravitationalConstant: -9000, springLength: 130, springConstant: .03 } },
            interaction: { hover: true, tooltipDelay: 150 },
        });
        network.on('click', p => { selId = (p.nodes && p.nodes[0]) || null; mostrarInfo(selId, info); });
        network.on('doubleClick', p => { if (p.nodes && p.nodes[0]) { const n = info[p.nodes[0]] || {}; centralizar(p.nodes[0], n.nome_completo); } });
        mostrarInfo(pid, info);
    }

    function mostrarInfo(id, info) {
        const el = document.getElementById('rede-info');
        if (!id) { el.className = 'rede-info'; return; }
        const n = info[id] || {};
        el.className = 'rede-info on';
        el.innerHTML = `<b>${esc(n.nome_completo || 'Alvo')}</b> · grau ${n.grau ?? '—'}
            <div class="acoes">
                <a class="p2-btn pri" href="p2-ficha-alvo.html?pessoa_id=${esc(id)}"><i class="fa-solid fa-id-card"></i> Abrir ficha</a>
                <button class="p2-btn" id="rede-recentrar"><i class="fa-solid fa-crosshairs"></i> Centralizar aqui</button>
            </div>`;
        const b = document.getElementById('rede-recentrar'); if (b) b.onclick = () => centralizar(id, n.nome_completo);
    }
})();
