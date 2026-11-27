/* ====================================================================
   P2 · Injeta a navegação do P2 (gaveta) nas páginas NATIVAS.
   Requer window.P2 (js/p2/p2-core.js carregado antes). Não toca no
   conteúdo/layout da página — só adiciona a aba lateral + gaveta.
   ==================================================================== */
(function () {
    'use strict';
    if (!window.P2 || !P2.MODULOS) { return; } // p2-core não carregou
    if (document.getElementById('p2nav-drawer')) return; // já injetado

    // CSS da gaveta + Font Awesome (se faltarem).
    function linkCss(href, attr) {
        if (document.querySelector('link[' + attr + ']')) return;
        const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.setAttribute(attr, '1'); document.head.appendChild(l);
    }
    linkCss('../css/p2-nav.css', 'data-p2nav-css');
    linkCss('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css', 'data-p2nav-fa');

    const esc = P2.esc, icone = P2.icone;
    const atual = (location.pathname.split('/').pop() || '').toLowerCase();
    const ativoDe = m => (m.url.split('?')[0].toLowerCase() === atual);

    // Monta nav agrupada.
    const grupos = [];
    P2.MODULOS.forEach(m => { if (!grupos.includes(m.grupo)) grupos.push(m.grupo); });
    const navHtml = grupos.map(g => {
        const itens = P2.MODULOS.filter(m => m.grupo === g).map(m =>
            `<a class="p2nav-item${ativoDe(m) ? ' ativo' : ''}" href="${esc(m.url)}"><span class="p2nav-ic">${icone(m.ic)}</span>${esc(m.nome)}${m.nativo ? '<span class="p2nav-tag">P3</span>' : ''}</a>`).join('');
        return `<div class="p2nav-grp">${esc(g)}</div>${itens}`;
    }).join('');

    const wrap = document.createElement('div');
    wrap.innerHTML = `
        <button id="p2nav-tab" title="Navegação P2"><i class="fa-solid fa-bars"></i><span>P2 INTEL</span></button>
        <div id="p2nav-backdrop"></div>
        <aside id="p2nav-drawer" aria-label="Navegação do módulo P2">
            <div class="p2nav-brand">
                <img src="../img/brasao.png" alt="PMAL" onerror="this.style.display='none'">
                <div><b>P2 Inteligência</b><small>10º BPM · PMAL</small></div>
                <button class="x" id="p2nav-x" aria-label="Fechar">✕</button>
            </div>
            <nav class="p2nav-list">${navHtml}</nav>
            <div class="p2nav-foot"><a href="solucoesia.html"><i class="fa-solid fa-house"></i> Voltar ao Sistema P3</a></div>
        </aside>`;
    document.body.appendChild(wrap);

    const drawer = document.getElementById('p2nav-drawer');
    const back = document.getElementById('p2nav-backdrop');
    const abrir = () => { drawer.classList.add('on'); back.classList.add('on'); };
    const fechar = () => { drawer.classList.remove('on'); back.classList.remove('on'); };
    document.getElementById('p2nav-tab').addEventListener('click', abrir);
    document.getElementById('p2nav-x').addEventListener('click', fechar);
    back.addEventListener('click', fechar);
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape') fechar(); });
})();
