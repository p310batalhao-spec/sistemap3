/* ====================================================================
   Sistema P3 — Módulo P2 (Inteligência) · núcleo do app
   --------------------------------------------------------------------
   26/11/2026 — reescrita do P2 como "sistema independente, mas ligado ao
   P3" (pedido do usuário). Este arquivo:
     • monta o SHELL (sidebar fixa + topbar) em toda tela do P2;
     • expõe o cliente Supabase do Echelon (mesmo banco — "um cérebro só",
       decisão do usuário) com helpers de leitura/escrita;
     • faz o controle de acesso (nível p2/admin), reaprovetando a sessão
       do P3 (js/core/session.js).

   ⚠️ A chave abaixo é a service_role do Supabase do Echelon — a MESMA já
   exposta em page/mapaInteligencia.html e reutilizada em todo o P3. Fica
   client-side (como já era). Bypassa RLS; mantém o padrão atual do
   sistema. (Trocar isso por um proxy exigiria backend sempre online.)
   ==================================================================== */
(function () {
    'use strict';

    const SB_URL = 'https://zxynbnnooauasmasgzxp.supabase.co';
    const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp4eW5ibm5vb2F1YXNtYXNnenhwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjg0ODE2NSwiZXhwIjoyMDg4NDI0MTY1fQ.f7CldsqEQdSsGGptzjgQiBVElKjNIyzu3ZHO9wHeQ94';

    const H = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY };

    // ── Supabase REST helpers ────────────────────────────────────────
    async function sbGet(tabela, query) {
        const url = SB_URL + '/rest/v1/' + tabela + (query ? '?' + query : '');
        const r = await fetch(url, { headers: H });
        if (!r.ok) throw new Error('Supabase ' + tabela + ': HTTP ' + r.status);
        return r.json();
    }
    // Conta linhas sem baixá-las (Content-Range: 0-0/<total>).
    async function sbCount(tabela, filtro) {
        const url = SB_URL + '/rest/v1/' + tabela + '?select=id' + (filtro ? '&' + filtro : '');
        const r = await fetch(url, { headers: Object.assign({ Prefer: 'count=exact', Range: '0-0' }, H) });
        if (!r.ok) return null;
        const cr = r.headers.get('content-range') || '';
        const m = cr.match(/\/(\d+)$/);
        return m ? parseInt(m[1], 10) : null;
    }
    async function sbInsert(tabela, obj) {
        const r = await fetch(SB_URL + '/rest/v1/' + tabela, {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=representation' }, H),
            body: JSON.stringify(obj),
        });
        if (!r.ok) throw new Error('Insert ' + tabela + ': HTTP ' + r.status + ' — ' + await r.text());
        return r.json();
    }
    async function sbPatch(tabela, filtro, obj) {
        const r = await fetch(SB_URL + '/rest/v1/' + tabela + '?' + filtro, {
            method: 'PATCH',
            headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=representation' }, H),
            body: JSON.stringify(obj),
        });
        if (!r.ok) throw new Error('Patch ' + tabela + ': HTTP ' + r.status + ' — ' + await r.text());
        return r.json();
    }

    // ── Storage (buckets privados do Echelon: 'denuncias', 'midia'…) ──
    // Sobe um File/Blob pro bucket. upsert=false por padrão (não sobrescreve).
    async function sbUpload(bucket, path, file, upsert) {
        const r = await fetch(SB_URL + '/storage/v1/object/' + bucket + '/' + path, {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': upsert ? 'true' : 'false' }, H),
            body: file,
        });
        if (!r.ok) throw new Error('Upload ' + bucket + ': HTTP ' + r.status + ' — ' + await r.text());
        return r.json();
    }
    // Gera URL assinada (buckets são privados). expira em `segundos` (padrão 10 min).
    async function sbSignUrl(bucket, path, segundos) {
        const r = await fetch(SB_URL + '/storage/v1/object/sign/' + bucket + '/' + path, {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, H),
            body: JSON.stringify({ expiresIn: segundos || 600 }),
        });
        if (!r.ok) return null;
        const j = await r.json();
        return j && j.signedURL ? (SB_URL + '/storage/v1' + j.signedURL) : null;
    }

    // slug igual ao storage-utils.ts do Echelon (mantém o MESMO formato de
    // caminho no bucket, pros dois sistemas lerem os mesmos arquivos).
    function slugify(str) {
        return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    }
    function caminhoDenuncia(tipo, numero, file) {
        const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
        const base = slugify(file.name.replace(/\.[^/.]+$/, '')).slice(0, 80);
        return slugify(tipo) + '/' + slugify(numero) + '/' + Date.now() + '-' + base + '.' + ext;
    }

    // ── Font Awesome 6 (ícones reais, mesmo estilo em todo o módulo) ──
    const FA_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css';
    function injetarFontAwesome() {
        if (document.querySelector('link[data-p2-fa]')) return;
        const l = document.createElement('link');
        l.rel = 'stylesheet'; l.href = FA_CSS; l.setAttribute('data-p2-fa', '1');
        document.head.appendChild(l);
    }
    // Renderiza um ícone: classe Font Awesome (contém "fa-") vira <i>; caso
    // contrário devolve o texto/emoji como veio (compatibilidade).
    const icone = ic => (ic && /fa-/.test(ic)) ? '<i class="' + ic + '"></i>' : (ic || '');

    // ── Registro de módulos (fonte única da navegação) ───────────────
    // pronto=false → ainda em desenvolvimento (abre placeholder).
    // nativo=true  → página nativa do P3 que já existia.
    const MODULOS = [
        // grupo Operacional
        { id: 'visao-operacional', grupo: 'Operacional', nome: 'Visão Operacional', sub: 'Dashboard', ic: 'fa-solid fa-gauge-high', url: 'p2.html', pronto: true },
        { id: 'missoes', grupo: 'Operacional', nome: 'Missões', sub: 'Disque-denúncia → Ficha Alvo', ic: 'fa-solid fa-bullseye', url: 'p2-missoes.html', pronto: true },
        { id: 'tarefas-analista', grupo: 'Operacional', nome: 'Tarefas do Analista', sub: 'Revisão / decisão', ic: 'fa-solid fa-list-check', url: 'p2-tarefas.html', pronto: true },
        { id: 'apresentacao-equipe', grupo: 'Operacional', nome: 'Apresentação da Equipe', sub: '', ic: 'fa-solid fa-users', url: 'p2-apresentacao.html', pronto: true },
        { id: 'relatorio-servico', grupo: 'Operacional', nome: 'Relatório de Serviço', sub: '', ic: 'fa-solid fa-file-pen', url: 'p2-relservico.html', pronto: true },
        // grupo Inteligência & Análise
        { id: 'ficha-alvo', grupo: 'Inteligência & Análise', nome: 'Ficha Alvo', sub: 'Dossiê do alvo', ic: 'fa-solid fa-id-card', url: 'p2-ficha-alvo.html', pronto: true },
        { id: 'consulta-global', grupo: 'Inteligência & Análise', nome: 'Consulta Global', sub: 'Busca unificada', ic: 'fa-solid fa-magnifying-glass', url: 'p2-consulta-global.html', pronto: true },
        { id: 'analise-vinculos', grupo: 'Inteligência & Análise', nome: 'Análise de Vínculos', sub: 'Rede + ranking', ic: 'fa-solid fa-diagram-project', url: 'p2-vinculos.html', pronto: true },
        { id: 'mapa-inteligencia', grupo: 'Inteligência & Análise', nome: 'Mapa de Inteligência', sub: 'Ocorrências + alvos', ic: 'fa-solid fa-map-location-dot', url: 'mapaInteligencia.html', pronto: true, nativo: true },
        { id: 'relint', grupo: 'Inteligência & Análise', nome: 'RELINT', sub: 'Relatório de inteligência', ic: 'fa-solid fa-file-lines', url: 'relint.html', pronto: true, nativo: true },
        { id: 'relop', grupo: 'Inteligência & Análise', nome: 'RELOP', sub: 'Relatório operacional', ic: 'fa-solid fa-file-contract', url: 'p2-relop.html', pronto: true },
        { id: 'mvi', grupo: 'Inteligência & Análise', nome: 'MVI', sub: 'Mortes violentas', ic: 'fa-solid fa-skull', url: 'p2-mvi.html', pronto: true },
        { id: 'produtividade', grupo: 'Inteligência & Análise', nome: 'Produtividade', sub: 'Dashboard', ic: 'fa-solid fa-chart-line', url: 'p2-produtividade.html', pronto: true },
        { id: 'linp', grupo: 'Inteligência & Análise', nome: 'LINP', sub: 'Ocorrências', ic: 'fa-solid fa-clipboard-list', url: 'p2-linp.html', pronto: true },
        { id: 'info-complementar', grupo: 'Inteligência & Análise', nome: 'Info Complementar', sub: '', ic: 'fa-solid fa-circle-plus', url: 'p2-info.html', pronto: true },
        { id: 'auditoria', grupo: 'Inteligência & Análise', nome: 'Auditoria', sub: 'Trilha de acesso', ic: 'fa-solid fa-shield-halved', url: 'p2-auditoria.html', pronto: true },
        // grupo Ferramentas nativas do P3
        { id: 'consulta-integrada', grupo: 'Ferramentas P3', nome: 'Consulta Integrada', sub: 'CAD · TJAL · BNMP', ic: 'fa-solid fa-address-card', url: 'consulta-pessoa.html', pronto: true, nativo: true },
        { id: 'lista-interesses', grupo: 'Ferramentas P3', nome: 'Lista de Interesses', sub: 'Alvos acompanhados', ic: 'fa-solid fa-star', url: 'lista-interesses.html', pronto: true, nativo: true },
        { id: 'facial', grupo: 'Ferramentas P3', nome: 'Reconhecimento Facial', sub: 'Similaridade', ic: 'fa-solid fa-fingerprint', url: 'reconhecimento-facial.html', pronto: true, nativo: true },
        { id: 'cerbero', grupo: 'Ferramentas P3', nome: 'Cérbero', sub: 'Base PM-AL', ic: 'fa-solid fa-dog', url: 'cerbero.html', pronto: true, nativo: true },
        { id: 'denuncias-recorrentes', grupo: 'Ferramentas P3', nome: 'Denúncias Recorrentes', sub: 'Mesmo local', ic: 'fa-solid fa-rotate', url: 'denunciasRecorrentes.html', pronto: true, nativo: true },
    ];
    const moduloPorId = id => MODULOS.find(m => m.id === id);

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // ── Shell (sidebar + topbar) ─────────────────────────────────────
    function montarShell(opts) {
        const ativo = opts.active || '';
        const sessao = opts.sessao || {};
        const grupos = [];
        MODULOS.forEach(m => { if (!grupos.includes(m.grupo)) grupos.push(m.grupo); });

        const navHtml = grupos.map(g => {
            const itens = MODULOS.filter(m => m.grupo === g).map(m => {
                const tag = m.nativo ? '<span class="p2-nav-tag p3">P3</span>'
                    : (!m.pronto ? '<span class="p2-nav-tag breve">em breve</span>' : '');
                return '<a class="p2-nav-item' + (m.id === ativo ? ' ativo' : '') + '" href="' + esc(m.url) + '">'
                    + '<span class="p2-nav-ic">' + icone(m.ic) + '</span><b>' + esc(m.nome) + '</b>' + tag + '</a>';
            }).join('');
            return '<div class="p2-nav-grp">' + esc(g) + '</div>' + itens;
        }).join('');

        const iniciais = (sessao.nomeGuerra || sessao.nome || 'P2').slice(0, 2).toUpperCase();
        const userLin = esc([sessao.graduacao, sessao.nomeGuerra].filter(Boolean).join(' ') || 'Operador P2');

        const shell = ''
            + '<aside class="p2-sidebar" id="p2-sidebar">'
            + '  <div class="p2-brand">'
            + '    <img class="p2-brand-logo" src="../img/brasao.png" alt="PMAL — 10º BPM" onerror="this.style.display=\'none\'">'
            + '    <div class="p2-brand-txt"><b>P2 Inteligência</b><small>10º BPM · PMAL</small></div>'
            + '  </div>'
            + '  <nav class="p2-nav">' + navHtml + '</nav>'
            + '</aside>'
            + '<div class="p2-backdrop" id="p2-backdrop"></div>'
            + '<header class="p2-topbar">'
            + '  <button class="p2-burger" id="p2-burger" aria-label="Menu"><i class="fa-solid fa-bars"></i></button>'
            + '  <div class="p2-top-tit"><b id="p2-top-nome">' + esc(opts.titulo || 'Módulo P2') + '</b>'
            + '    <small id="p2-top-sub">' + esc(opts.sub || '') + '</small></div>'
            + '  <div class="p2-top-actions">'
            + '    <div class="p2-clock" id="p2-clock"></div>'
            + '    <a class="p2-btn ia" href="ia_xerife.html" title="Xerife — IA do P3"><span class="p2-btn-ic"><i class="fa-solid fa-robot"></i></span><span class="rotulo">Xerife</span></a>'
            + '    <a class="p2-btn" href="solucoesia.html" title="Voltar ao Sistema P3"><span class="p2-btn-ic"><i class="fa-solid fa-house"></i></span><span class="rotulo">Voltar ao P3</span></a>'
            + '    <button id="btn-tema" class="p2-btn-tema" type="button" title="Alternar tema claro/escuro" aria-label="Alternar tema">'
            + '      <svg class="icone-sol" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="4.2" stroke="currentColor" stroke-width="1.7"/><path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
            + '      <svg class="icone-lua" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>'
            + '    </button>'
            + '    <div class="p2-user"><div class="p2-user-av">' + esc(iniciais) + '</div><span class="rotulo">' + userLin + '</span></div>'
            + '  </div>'
            + '</header>'
            + '<main class="p2-main" id="p2-conteudo"></main>';

        const app = document.createElement('div');
        app.className = 'p2-app';
        app.innerHTML = shell;
        document.body.appendChild(app);

        // Mobile: abrir/fechar sidebar
        const side = document.getElementById('p2-sidebar');
        const back = document.getElementById('p2-backdrop');
        const abrir = () => { side.classList.add('aberta'); back.classList.add('ativo'); };
        const fechar = () => { side.classList.remove('aberta'); back.classList.remove('ativo'); };
        document.getElementById('p2-burger').addEventListener('click', abrir);
        back.addEventListener('click', fechar);

        // Relógio: dia da semana + data (em cima) e hora HH:MM:SS (grande).
        // O #btn-tema é conectado pelo próprio js/core/session.js.
        const relogio = document.getElementById('p2-clock');
        function tick() {
            if (!relogio) return;
            const d = new Date();
            const hora = d.toLocaleTimeString('pt-BR');
            const dia = d.toLocaleDateString('pt-BR', { weekday: 'long' });
            const data = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
            relogio.innerHTML = '<b>' + hora + '</b><small>' + dia + ' · ' + data + '</small>';
        }
        tick();
        setInterval(tick, 1000);

        return document.getElementById('p2-conteudo');
    }

    // ── Inicialização (chamada por cada página do P2) ─────────────────
    // Devolve o elemento #p2-conteudo pra página preencher. Retorna null
    // se o acesso foi negado (a própria função redireciona).
    function iniciar(opts) {
        opts = opts || {};
        document.body.classList.add('p2-body');
        injetarFontAwesome();
        const sessao = (window.P3 && P3.requireAuth) ? P3.requireAuth() : null;
        if (window.P3 && P3.requireAuth && !sessao) return null; // requireAuth já redireciona
        if (sessao && sessao.nivel && sessao.nivel !== 'p2' && sessao.nivel !== 'admin') {
            alert('O módulo P2 está disponível apenas para usuários com nível P2 ou ADMIN.');
            location.href = 'solucoesia.html';
            return null;
        }
        opts.sessao = sessao || {};
        return montarShell(opts);
    }

    // ── Impressão de documento ───────────────────────────────────────
    // Mantém o container FORA do .p2-app (que o @media print esconde),
    // senão o documento some na impressão. Todos os módulos usam isto.
    function imprimirDoc(html) {
        let el = document.getElementById('p2-print-area');
        if (!el) { el = document.createElement('div'); el.id = 'p2-print-area'; document.body.appendChild(el); }
        el.innerHTML = html;
        if (!document.getElementById('p2-print-style')) {
            const s = document.createElement('style'); s.id = 'p2-print-style';
            s.textContent = '#p2-print-area{display:none}@media print{body.p2-body>.p2-app{display:none!important}body.p2-body{background:#fff!important}#p2-print-area{display:block!important}@page{margin:14mm}}';
            document.head.appendChild(s);
        }
        setTimeout(() => window.print(), 60);
    }

    // ── API pública ──────────────────────────────────────────────────
    window.P2 = {
        iniciar, MODULOS, moduloPorId, esc, slugify, icone, imprimirDoc,
        sb: {
            url: SB_URL, get: sbGet, count: sbCount, insert: sbInsert, patch: sbPatch,
            upload: sbUpload, signUrl: sbSignUrl, caminhoDenuncia, headers: H,
        },
    };
})();
