// ====================================================================
// Sistema P3 — Header + Navegação unificados
// ====================================================================
// Substitui o <header>...</header><nav class="navegacao">...</nav> que
// hoje é copiado e colado (com pequenas divergências) em cada página do
// sistema. Este módulo GERA esse HTML uma vez só, aqui, e decide quais
// itens de nav aparecem conforme a PERMISSÃO da sessão logada — em vez
// de cada página manter sua própria cópia (e arriscar ficar desatualizada
// quando um item novo é adicionado em algum lugar e esquecido em outro,
// como já tinha acontecido: várias páginas estavam sem "Eventos"/
// "Instrução" por divergência de cópia, não por decisão).
//
// USO — cada página troca o bloco estático de header/nav por:
//   <script src="../js/core/session.js"></script>
//   <script src="../js/core/header-nav.js" data-active="ait"></script>
// (mesma pasta relativa de sempre: sem "../" na raiz, com "../" dentro
// de page/relatorios/public/termos.)
//
// data-active: id do item de nav que deve ficar marcado (classe
// "active") — ver ID_ITENS abaixo. Vazio/omitido = nenhum item marcado
// (uso em página que não tem equivalente na nav, ex. um relatório).
//
// data-extra (opcional): JSON com itens adicionais só daquela página,
// ex. o link "Calendário de Eventos" ao lado de "Eventos":
//   data-extra='[{"id":"calendario","href":"page/calendario.html","label":"Calendário de Eventos","icone":"https://img.icons8.com/ios/50/calendar--v1.png","depoisDe":"eventos"}]'
//
// Como o próprio session.js, este script tem que ser um <script src>
// SÍNCRONO clássico (sem defer/async/type=module) — depende de
// document.currentScript pra saber onde se inserir no DOM, e isso só
// funciona nesse modo.
// ====================================================================
(function () {
    'use strict';

    var script = document.currentScript;
    if (!script) return; // segurança: carregado de um jeito não suportado — não quebra a página

    // ── Resolução de caminho relativo (mesmo critério de session.js) ──
    function estaEmSubpasta() {
        return /\/(page|relatorios|public|termos)\//.test(location.pathname);
    }
    function estaNaPastaPage() {
        return /\/page\//.test(location.pathname);
    }
    // hrefCanonico sempre relativo à RAIZ (ex.: "index.html",
    // "page/dashboard-cruzado.html") — resolve pro prefixo certo conforme
    // de onde a página atual está sendo servida.
    function resolverHref(hrefCanonico) {
        if (hrefCanonico === 'index.html') {
            return estaEmSubpasta() ? '../index.html' : 'index.html';
        }
        var restante = hrefCanonico.replace(/^page\//, '');
        if (estaNaPastaPage()) return restante;           // dentro de page/: mesmo nível
        if (estaEmSubpasta()) return '../page/' + restante; // relatorios/public/termos: sobe 1 e entra em page/
        return hrefCanonico;                                // raiz: "page/x.html" já está certo
    }

    // ── Itens padrão de navegação (mesma ordem/rótulos/ícones de hoje) ──
    var ITENS_NAV = [
        { id: 'home', href: 'index.html', label: 'Home',
          icone: 'https://img.icons8.com/fluency-systems-regular/48/home--v1.png', w: 48, h: 48 },
        { id: 'dashboard-cruzado', href: 'page/dashboard-cruzado.html', label: 'Dashboard Cruzado',
          icone: 'https://img.icons8.com/fluency-systems-regular/48/statistics.png', w: 48, h: 48 },
        { id: 'cadastro-ocorrencias', href: 'page/cadastroocorrencias.html', label: 'Cadastro de Ocorrências',
          icone: 'https://img.icons8.com/ios/50/add-file.png', w: 50, h: 50 },
        { id: 'materiais', href: 'page/materiais.html', label: 'Materiais Apreendidos',
          icone: 'https://img.icons8.com/ios/50/box--v1.png', w: 50, h: 50 },
        { id: 'eventos', href: 'page/eventos.html', label: 'Eventos',
          icone: 'https://img.icons8.com/external-outlines-amoghdesign/32/external-dance-happy-new-year-outlines-amoghdesign.png', w: 32, h: 32 },
        { id: 'instrucoes', href: 'page/instrucoes.html', label: 'Instrução',
          icone: 'https://img.icons8.com/ios/50/training.png', w: 48, h: 48 },
        { id: 'cumprimento', href: 'page/cumprimento-cartao.html', label: 'Cumprimento',
          icone: 'https://img.icons8.com/ios/50/checked-checkbox.png', w: 48, h: 48, titulo: 'Cumprimento do cartão-programa/OPO' },
        { id: 'rastreamento', href: 'page/rastreamento-guarnicao.html', label: 'Rastreamento',
          icone: 'https://img.icons8.com/ios/50/map-marker.png', w: 48, h: 48, titulo: 'Rastreamento de guarnição' },
        { id: 'chat-xerife', domId: 'nav-chat-xerife', href: 'page/chat-mobile.html', label: 'Chat Xerife',
          icone: null, w: 48, h: 48, titulo: 'Chat com o Xerife (mobile)' }, // ícone tratado à parte (logo com fallback)
        { id: 'solucoesia', domId: 'nav-solucoesia', href: 'page/solucoesia.html', label: 'Soluções IA',
          icone: 'https://img.icons8.com/sf-regular/48/bot.png', w: 48, h: 48,
          condicao: function (s) { return !!s && s.unidadeId === '10bpm'; } },
        { id: 'usuarios', domId: 'nav-usuarios', href: 'page/admin-usuarios.html', label: 'Usuários',
          icone: 'https://img.icons8.com/ios/50/administrator-male.png', w: 48, h: 48,
          condicao: function (s) { return !!s && s.nivel === 'admin'; } }
    ];

    // Sessão nível "copom": redirecionada pra rastreamento-guarnicao.html
    // em QUALQUER outra página (ver restringirNivelCopom em session.js) —
    // mostrar a nav inteira pra esse usuário só gera cliques que voltam
    // pro mesmo lugar. Nav reduzida ao que realmente é navegável.
    var IDS_COPOM = ['home', 'rastreamento'];

    function montarIconeItem(item) {
        if (item.id === 'chat-xerife') {
            var prefixo = estaEmSubpasta() ? '../' : '';
            return '<img width="' + item.w + '" height="' + item.h + '" src="' + prefixo + 'img/xerife-logo.png" ' +
                'alt="Xerife" style="object-fit:cover;" onerror="this.src=\'https://img.icons8.com/ios/50/chat--v1.png\'">';
        }
        return '<img width="' + item.w + '" height="' + item.h + '" src="' + item.icone + '" alt="' + item.label + '">';
    }

    function montarItemHTML(item, ativo, sessao) {
        var oculto = typeof item.condicao === 'function' && !item.condicao(sessao);
        var atributos = 'href="' + resolverHref(item.href) + '"';
        if (item.domId) atributos += ' id="' + item.domId + '"';
        if (ativo) atributos += ' class="active"';
        if (item.titulo) atributos += ' title="' + item.titulo + '"';
        if (oculto) atributos += ' style="display:none"';
        return '<a ' + atributos + '>' + montarIconeItem(item) + '<p>' + item.label + '</p></a>';
    }

    function montarExtraHTML(item, ativo) {
        var atributos = 'href="' + resolverHref(item.href) + '"';
        if (item.id) atributos += ' id="' + item.id + '"';
        if (ativo) atributos += ' class="active"';
        if (item.titulo) atributos += ' title="' + item.titulo + '"';
        var icone = item.icone
            ? '<img width="' + (item.w || 48) + '" height="' + (item.h || 48) + '" src="' + item.icone + '" alt="' + item.label + '">'
            : '';
        return '<a ' + atributos + '>' + icone + '<p>' + item.label + '</p></a>';
    }

    function gerarNavHTML(sessao, paginaAtiva, extras) {
        var nivelCopom = !!sessao && sessao.nivel === 'copom';
        var partes = [];
        ITENS_NAV.forEach(function (item) {
            if (nivelCopom && IDS_COPOM.indexOf(item.id) === -1) return;
            partes.push(montarItemHTML(item, item.id === paginaAtiva, sessao));
            (extras || []).filter(function (ex) { return ex.depoisDe === item.id; })
                .forEach(function (ex) { partes.push(montarExtraHTML(ex, ex.id === paginaAtiva)); });
        });
        return partes.join('\n            ');
    }

    // ── HTML do header (idêntico ao padrão atual — mesmas classes/ids,
    // então todo o CSS de css/style.css e css/theme.css continua valendo
    // sem nenhuma mudança) ──
    var HEADER_HTML =
        '<header>' +
        '<div class="header-info-left">' +
        '<img class="brasao" src="' + (estaEmSubpasta() ? '../' : '') + 'img/brasao.png" alt="brasão do 10º Batalhão">' +
        '<div class="cabecalhotexto">' +
        '<h1>SISTEMA DE GERENCIAMENTO P3</h1>' +
        '<h3 id="cabecalho-unidade"></h3>' +
        '</div>' +
        '</div>' +
        '<div class="header-info-right">' +
        '<button id="btn-tema" class="btn-tema" type="button" title="Alternar modo escuro" aria-label="Alternar modo escuro">' +
        '<svg class="icone-sol" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="4.2" stroke="currentColor" stroke-width="1.7"/><path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>' +
        '<svg class="icone-lua" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>' +
        '</button>' +
        '<div class="relogio" id="relogio"></div>' +
        '<div class="user-notification">' +
        '<div class="exibirusuario" id="user-info"></div>' +
        '<div class="notification-container">' +
        // SVG inline (não a fonte Material Icons via Google Fonts) —
        // várias páginas do sistema não carregam essa fonte no <head>,
        // e sem ela o glifo aparecia como texto cru "notifications" em
        // vez do ícone (bug real visto ao prototipar em page/ait.html).
        // Mesmo padrão já usado pros ícones de sol/lua do tema (SVG
        // inline, stroke="currentColor" herda a cor de #bell-icon).
        '<svg id="bell-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>' +
        '<span class="badge" id="notif-count" style="display:none">0</span>' +
        '<div class="notif-dropdown" id="notif-dropdown">' +
        '<div class="notif-header">Notificações' +
        '<button type="button" id="notif-limpar-tudo" class="notif-limpar-tudo" style="display:none;">Limpar tudo</button>' +
        '</div>' +
        '<div id="notif-items"><p class="empty-msg">Nenhuma notificação nova</p></div>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '</header>';

    function montarBotaoLogout() {
        return '<button id="btn-logout" class="btn-logout">' +
            '<img width="48" height="48" src="https://img.icons8.com/material-outlined/48/exit.png" alt="Sair">' +
            '<p>Sair</p>' +
            '</button>';
    }

    // O <header> vai como IRMÃO do <script>, direto no <body> — sempre
    // funcionou assim, mantido síncrono (executa durante o parse, antes
    // de <section class="pagecomplete"> sequer existir no DOM).
    function inserirHeader() {
        script.insertAdjacentHTML('afterend', HEADER_HTML);
    }

    // O <nav class="navegacao"> NÃO pode ir como irmão do <script> — o
    // CSS (.pagecomplete { display:flex }) espera nav e main como FILHOS
    // DIRETOS de <section class="pagecomplete">, lado a lado (nav vira a
    // barra lateral, main o conteúdo). Inserir nav como irmão solto
    // quebrava esse flex (bug real relatado: espaço gigante acima do
    // conteúdo — nav com height:100vh empilhando ANTES da section em vez
    // de ao lado dela — e o conteúdo não reagia ao nav expandir no
    // hover). Por isso essa parte espera o DOMContentLoaded (quando
    // .pagecomplete já existe) e insere DENTRO dela, como 1º filho.
    function inserirNav() {
        var sessao = (window.P3 && window.P3.getSession) ? window.P3.getSession() : null;
        var paginaAtiva = (script.dataset.active || '').trim();
        var extras = [];
        if (script.dataset.extra) {
            try { extras = JSON.parse(script.dataset.extra); } catch (e) { extras = []; }
        }
        var navHTML = '<nav class="navegacao">\n            ' +
            gerarNavHTML(sessao, paginaAtiva, extras) + '\n            ' +
            montarBotaoLogout() + '\n        </nav>';

        var container = document.querySelector('.pagecomplete');
        if (container) {
            container.insertAdjacentHTML('afterbegin', navHTML);
        } else {
            // Página sem .pagecomplete (não deveria acontecer no padrão
            // atual) — melhor inserir solta do que não inserir nada.
            script.insertAdjacentHTML('afterend', navHTML);
        }
    }

    inserirHeader();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inserirNav);
    } else {
        inserirNav();
    }

    // Carrega o motor de notificações (js/core/notificacoes.js) sob
    // demanda — só as páginas com o header unificado precisam dele, não
    // faz sentido incluir manualmente em cada uma. Mesmo padrão de
    // carregamento tardio já usado em outros módulos do sistema (ex.:
    // carregarCumprimentoCore em js/xerife.js).
    (function () {
        var prefixo = estaEmSubpasta() ? '../' : '';
        var s = document.createElement('script');
        s.src = prefixo + 'js/core/notificacoes.js';
        document.body.appendChild(s);
    })();

    // Relógio e "Bem-vindo(a)" — centraliza o que hoje cada página
    // reimplementava na mão no próprio script de rodapé.
    document.addEventListener('DOMContentLoaded', function () {
        var elRelogio = document.getElementById('relogio');
        if (elRelogio) {
            var atualizar = function () {
                var agora = new Date();
                var opcoesData = { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' };
                elRelogio.innerHTML = agora.toLocaleDateString('pt-BR', opcoesData) + '<br>' + agora.toLocaleTimeString('pt-BR');
            };
            atualizar();
            setInterval(atualizar, 1000);
        }

        var elUser = document.getElementById('user-info');
        var sessao = (window.P3 && window.P3.getSession) ? window.P3.getSession() : null;
        if (elUser && sessao) {
            elUser.innerHTML = '<p>Bem Vindo(a):</p><p class="user-nome">' + sessao.graduacao + ' ' + sessao.nomeGuerra + '</p>';
        }

        var btnLogout = document.getElementById('btn-logout');
        if (btnLogout && window.P3) btnLogout.addEventListener('click', window.P3.logout);

        // Toggle do dropdown do sino — só a interação genérica (abrir/
        // fechar, zerar o badge). O CONTEÚDO das notificações (o que
        // aparece dentro de #notif-items) é responsabilidade de
        // js/core/notificacoes.js (carregado à parte, quando existir).
        var bell = document.getElementById('bell-icon');
        var dropdown = document.getElementById('notif-dropdown');
        if (bell && dropdown) {
            bell.addEventListener('click', function (e) {
                e.stopPropagation();
                var aberto = dropdown.classList.toggle('aberto');
                dropdown.style.display = aberto ? 'block' : 'none';
                var badge = document.getElementById('notif-count');
                if (aberto && badge) badge.style.display = 'none';
            });
            document.addEventListener('click', function (e) {
                if (dropdown.style.display === 'block' && !dropdown.contains(e.target) && e.target !== bell) {
                    dropdown.style.display = 'none';
                    dropdown.classList.remove('aberto');
                }
            });
        }
    });
})();
