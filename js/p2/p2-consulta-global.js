/* ====================================================================
   P2 · Consulta Global — busca unificada (reescrita nativa do Echelon)
   Usa a view vw_consulta_global_base (cobre pessoa, denúncia, veículo,
   mandado, LINP, MVI, facção, ORCRIM, ordens/relatórios de busca, missão,
   relatório de serviço, info complementar, registro oficial).
   ==================================================================== */
(function () {
    'use strict';
    const alvo = P2.iniciar({ active: 'consulta-global', titulo: 'Consulta Global', sub: 'Busca unificada da inteligência' });
    if (!alvo) return;
    const esc = P2.esc, sb = P2.sb;

    // módulo → rótulo, ícone, cor e rota (pra onde o resultado leva no P2).
    const MOD = {
        pessoa: { lab: 'Alvo', ic: 'fa-solid fa-id-card', cor: '#2e6be6', rota: r => 'p2-ficha-alvo.html?pessoa_id=' + encodeURIComponent(r.registro_id) },
        denuncia: { lab: 'Denúncia', ic: 'fa-solid fa-phone-volume', cor: '#0b7285', rota: () => 'p2-missoes.html' },
        missao: { lab: 'Missão', ic: 'fa-solid fa-bullseye', cor: '#1864ab', rota: () => 'p2-missoes.html' },
        veiculo: { lab: 'Veículo', ic: 'fa-solid fa-car', cor: '#5f3dc4', rota: () => 'p2-modulo.html?m=ficha-alvo' },
        mandado: { lab: 'Mandado', ic: 'fa-solid fa-handcuffs', cor: '#c62828', rota: () => 'p2-modulo.html?m=mandados' },
        linp: { lab: 'LINP', ic: 'fa-solid fa-clipboard-list', cor: '#2b8a3e', rota: () => 'p2-modulo.html?m=linp' },
        mvi: { lab: 'MVI', ic: 'fa-solid fa-skull', cor: '#e8590c', rota: () => 'p2-modulo.html?m=mvi' },
        faccao: { lab: 'Facção', ic: 'fa-solid fa-people-group', cor: '#6a1b9a', rota: () => 'p2-modulo.html?m=analise-vinculos' },
        orcrim: { lab: 'ORCRIM', ic: 'fa-solid fa-sitemap', cor: '#ad1457', rota: () => 'p2-modulo.html?m=analise-vinculos' },
        ordem_busca: { lab: 'Ordem de Busca', ic: 'fa-solid fa-envelope-open-text', cor: '#495057', rota: () => 'p2-modulo.html?m=info-complementar' },
        relatorio_busca: { lab: 'Relatório de Busca', ic: 'fa-solid fa-folder-open', cor: '#495057', rota: () => 'p2-modulo.html?m=info-complementar' },
        relatorio_servico: { lab: 'Rel. de Serviço', ic: 'fa-solid fa-file-pen', cor: '#364fc7', rota: () => 'p2-modulo.html?m=relatorio-servico' },
        info_complementar: { lab: 'Info Complementar', ic: 'fa-solid fa-circle-plus', cor: '#0c8599', rota: () => 'p2-modulo.html?m=info-complementar' },
        registro_oficial: { lab: 'Registro', ic: 'fa-solid fa-id-badge', cor: '#5c940d', rota: () => 'p2-modulo.html?m=ficha-alvo' },
    };
    const modInfo = m => MOD[m] || { lab: m || '—', ic: 'fa-solid fa-file', cor: '#777', rota: () => '#' };

    let RES = [], filtroMod = 'todos', seq = 0;

    alvo.innerHTML = `
        <div class="p2-page-head">
            <h1><i class="fa-solid fa-magnifying-glass"></i> Consulta Global</h1>
            <p>Busque por nome, vulgo, CPF, placa, número de denúncia/mandado, endereço… em toda a base de inteligência.</p>
        </div>
        <div class="pi-busca-wrap">
            <span class="pi-busca-ic">🔍</span>
            <input class="pi-busca" id="cg-q" placeholder="Digite ao menos 2 caracteres…" autocomplete="off" autofocus>
        </div>
        <div class="pi-chips" id="cg-chips"></div>
        <div id="cg-res"><div class="p2-empty"><div class="ic">🔎</div><h3>Comece a digitar</h3><p>Os resultados aparecem aqui, agrupados por tipo.</p></div></div>`;

    const inp = document.getElementById('cg-q');
    let timer = null;
    inp.oninput = () => { clearTimeout(timer); timer = setTimeout(buscar, 350); };

    async function buscar() {
        const termo = inp.value.trim();
        const box = document.getElementById('cg-res');
        if (termo.length < 2) { RES = []; document.getElementById('cg-chips').innerHTML = ''; box.innerHTML = `<div class="p2-empty"><div class="ic">🔎</div><h3>Comece a digitar</h3><p>Ao menos 2 caracteres.</p></div>`; return; }
        const meu = ++seq;
        box.innerHTML = `<div class="p2-empty"><div class="ic">⏳</div><p>Buscando…</p></div>`;
        try {
            const palavras = termo.split(/\s+/).filter(w => w.length >= 2).slice(0, 6);
            const conds = palavras.map(w => 'busca_texto.ilike.*' + encodeURIComponent(w) + '*').join(',');
            const query = 'select=modulo,registro_id,titulo,subtitulo,resumo,data_ref&and=(' + conds + ')&limit=200';
            const linhas = await sb.get('vw_consulta_global_base', query);
            if (meu !== seq) return; // resposta antiga
            RES = linhas || [];
            render();
        } catch (e) {
            if (meu !== seq) return;
            box.innerHTML = `<div class="p2-empty"><div class="ic">⚠️</div><h3>Erro na busca</h3><p>${esc(e.message)}</p></div>`;
        }
    }

    function render() {
        const box = document.getElementById('cg-res'), chips = document.getElementById('cg-chips');
        if (!RES.length) { chips.innerHTML = ''; box.innerHTML = `<div class="p2-empty"><div class="ic">🫙</div><h3>Nada encontrado</h3><p>Tente outro termo.</p></div>`; return; }
        // contagem por módulo
        const cont = {}; RES.forEach(r => cont[r.modulo] = (cont[r.modulo] || 0) + 1);
        const mods = Object.keys(cont).sort((a, b) => cont[b] - cont[a]);
        chips.innerHTML = `<span class="pi-chip ${filtroMod === 'todos' ? 'on' : ''}" data-m="todos">Todos <b>${RES.length}</b></span>`
            + mods.map(m => `<span class="pi-chip ${filtroMod === m ? 'on' : ''}" data-m="${esc(m)}">${P2.icone(modInfo(m).ic)} ${esc(modInfo(m).lab)} <b>${cont[m]}</b></span>`).join('');
        chips.querySelectorAll('[data-m]').forEach(c => c.onclick = () => { filtroMod = c.dataset.m; render(); });

        const lista = filtroMod === 'todos' ? RES : RES.filter(r => r.modulo === filtroMod);
        box.innerHTML = '<div class="pi-res">' + lista.map(itemHtml).join('') + '</div>';
    }
    function itemHtml(r) {
        const mi = modInfo(r.modulo);
        const data = r.data_ref ? ('<span class="sub"> · ' + esc(dataBr(r.data_ref)) + '</span>') : '';
        return `<a class="pi-res-item" href="${esc(mi.rota(r))}">
            <span class="pi-res-ic" style="background:${mi.cor}22;color:${mi.cor}">${P2.icone(mi.ic)}</span>
            <span class="pi-res-tx">
                <span class="tit">${esc(r.titulo || '—')}</span>
                <span class="sub">${esc(r.subtitulo || '')}${data ? '' : ''}</span>${data}
                ${r.resumo ? `<span class="resumo">${esc(r.resumo)}</span>` : ''}
            </span>
            <span class="pi-mod-badge" style="color:#fff;background:${mi.cor}">${esc(mi.lab)}</span>
        </a>`;
    }
    function dataBr(v) { const m = String(v || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; }
})();
