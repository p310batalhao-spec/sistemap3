/* ====================================================================
   P2 · Imersão total nas páginas NATIVAS do P3 (relint, mapa, cérbero…).
   --------------------------------------------------------------------
   Em vez de uma gaveta, TRANSFORMA o sidebar do shell (nav.navegacao, já
   fixo e estilizado como P2 pelo css/p3-shell.css) para listar os MÓDULOS
   do P2 no lugar do nav original do P3 — "removendo o nav do P3 e passando
   para o nav fixo do P2" (pedido do usuário). Sem mexer no conteúdo da
   página: só troca o conteúdo da barra lateral e marca body.p2-modnav
   (ver css/p2-nav.css). Requer window.P2 (js/p2/p2-core.js antes).
   ==================================================================== */
(function () {
    'use strict';
    if (!window.P2 || !P2.MODULOS) return;

    function linkCss(href, attr) {
        if (document.querySelector('link[' + attr + ']')) return;
        const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.setAttribute(attr, '1'); document.head.appendChild(l);
    }
    linkCss('../css/p2-nav.css', 'data-p2nav-css');
    linkCss('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css', 'data-p2nav-fa');

    const esc = P2.esc, icone = P2.icone;
    const atual = (location.pathname.split('/').pop() || '').toLowerCase();
    const ativoDe = m => (m.url.split('?')[0].toLowerCase() === atual);

    function montarItens() {
        const grupos = [];
        P2.MODULOS.forEach(m => { if (!grupos.includes(m.grupo)) grupos.push(m.grupo); });
        let html = '';
        grupos.forEach(g => {
            html += `<div class="p2grp">${esc(g)}</div>`;
            P2.MODULOS.filter(m => m.grupo === g).forEach(m => {
                html += `<a class="p2mod${ativoDe(m) ? ' active' : ''}" href="${esc(m.url)}">${icone(m.ic)}<p>${esc(m.nome)}</p>${m.nativo ? '<span class="p2tag">P3</span>' : ''}</a>`;
            });
        });
        html += `<a class="p2mod p2-voltar" href="solucoesia.html"><i class="fa-solid fa-house"></i><p>Voltar ao Sistema P3</p></a>`;
        return html;
    }

    // Substitui o conteúdo do nav do shell pelos módulos do P2, preservando
    // o botão de logout (handler do session.js) que já estava no nav.
    function transformar(nav) {
        if (!nav || nav.dataset.p2mod === '1') return;
        const logout = nav.querySelector('.btn-logout');
        nav.innerHTML = montarItens();
        if (logout) nav.appendChild(logout);
        nav.dataset.p2mod = '1';
        document.body.classList.add('p2-modnav');
    }

    // Fallback: páginas sem o sidebar do shell (ex.: mapaInteligencia, tela
    // cheia) recebem uma GAVETA (não sobrepõe o conteúdo full-screen).
    function construirGaveta() {
        if (document.getElementById('p2nav-drawer')) return;
        const navHtml = (function () {
            const grupos = []; P2.MODULOS.forEach(m => { if (!grupos.includes(m.grupo)) grupos.push(m.grupo); });
            return grupos.map(g => `<div class="p2nav-grp">${esc(g)}</div>` + P2.MODULOS.filter(m => m.grupo === g).map(m =>
                `<a class="p2nav-item${ativoDe(m) ? ' ativo' : ''}" href="${esc(m.url)}"><span class="p2nav-ic">${icone(m.ic)}</span>${esc(m.nome)}${m.nativo ? '<span class="p2nav-tag">P3</span>' : ''}</a>`).join('')).join('');
        })();
        const wrap = document.createElement('div');
        wrap.innerHTML = `
            <button id="p2nav-tab" title="Navegação P2"><i class="fa-solid fa-bars"></i><span>P2 INTEL</span></button>
            <div id="p2nav-backdrop"></div>
            <aside id="p2nav-drawer" aria-label="Navegação do módulo P2">
                <div class="p2nav-brand"><img src="../img/brasao.png" alt="PMAL" onerror="this.style.display='none'">
                    <div><b>P2 Inteligência</b><small>10º BPM · PMAL</small></div>
                    <button class="x" id="p2nav-x" aria-label="Fechar">✕</button></div>
                <nav class="p2nav-list">${navHtml}</nav>
                <div class="p2nav-foot"><a href="solucoesia.html"><i class="fa-solid fa-house"></i> Voltar ao Sistema P3</a></div>
            </aside>`;
        document.body.appendChild(wrap);
        const drawer = document.getElementById('p2nav-drawer'), back = document.getElementById('p2nav-backdrop');
        const abrir = () => { drawer.classList.add('on'); back.classList.add('on'); };
        const fechar = () => { drawer.classList.remove('on'); back.classList.remove('on'); };
        document.getElementById('p2nav-tab').addEventListener('click', abrir);
        document.getElementById('p2nav-x').addEventListener('click', fechar);
        back.addEventListener('click', fechar);
        document.addEventListener('keydown', ev => { if (ev.key === 'Escape') fechar(); });
    }

    // O nav do shell é inserido pelo header-nav.js no DOMContentLoaded; pode
    // ainda não existir quando este script roda. Tenta aplicar; se a página
    // não tem shell (sem nav.navegacao), cai pra gaveta.
    function tentar() { const nav = document.querySelector('nav.navegacao'); if (nav) { transformar(nav); return true; } return false; }
    if (!tentar()) {
        let tentativas = 0;
        const timer = setInterval(() => {
            if (tentar()) { clearInterval(timer); return; }
            if (++tentativas > 25) { clearInterval(timer); if (!document.querySelector('nav.navegacao') && !document.getElementById('p2nav-drawer')) construirGaveta(); }
        }, 80);
        document.addEventListener('DOMContentLoaded', tentar);
    }
    // Se o header-nav reescrever o nav depois (sessão assíncrona), reaplica.
    const obs = new MutationObserver(() => { const nav = document.querySelector('nav.navegacao'); if (nav && nav.dataset.p2mod !== '1' && !nav.querySelector('.p2grp')) transformar(nav); });
    try { obs.observe(document.body, { childList: true, subtree: true }); setTimeout(() => obs.disconnect(), 6000); } catch (e) { }
})();
