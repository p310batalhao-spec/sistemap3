// ====================================================================
// Sistema P3 — Sessão, controle de acesso e configuração multi-unidade
// ====================================================================
// Centraliza o que hoje está duplicado (e às vezes inconsistente) em cada
// página: leitura de sessão, guarda de rotas por nível e carregamento do
// Firebase/GAS da unidade do usuário logado.

(function (global) {
    'use strict';

    // Firebase "diretório" central — guarda /usuarios e /unidades de TODAS
    // as unidades. É sempre este projeto, independente da unidade
    // operacional (Firebase/GAS de dados) do usuário logado.
    const DIRETORIO_BASE_URL = 'https://sistema-p3-v2-default-rtdb.firebaseio.com';

    // Configuração padrão embutida do 10º BPM — usada quando a unidade é
    // "10bpm" (ou ausente, para contas já existentes) e como fallback campo
    // a campo caso /unidades/10bpm ainda não exista no diretório central.
    // Este é o banco Firebase ATUAL/real do 10º BPM (mesmo projeto do
    // diretório central, "sistema-p3-v2") — "sistema-p3" (sem v2) é o
    // projeto ANTIGO, fora de uso, mantido só em páginas legadas não
    // migradas (termos/requerimento_pericia.html, public/verificar_assinatura.html).
    const DEFAULT_10BPM_CONFIG = {
        nome: '10º Batalhão de Polícia Militar',
        firebase: {
            apiKey: 'AIzaSyBRZn_EOfV6ozsx6NNzOlq1sjIV_xVm7xE',
            authDomain: 'sistema-p3-v2.firebaseapp.com',
            projectId: 'sistema-p3-v2',
            storageBucket: 'sistema-p3-v2.firebasestorage.app',
            messagingSenderId: '1019080251258',
            appId: '1:1019080251258:web:93f9e299cf19b16189e8c3',
            databaseURL: DIRETORIO_BASE_URL
        },
        gas: {
            AIT: 'https://script.google.com/macros/s/AKfycbyNpjC9Ul4XRllFSciCj6hA62u74K8VIdXo1ecND-VCg1RiJCETqCWnrKKNN3bQtChOTg/exec',
            DROGAS: 'https://script.google.com/macros/s/AKfycbzw3yzJEf5hC7DtE_1P8OTvopqigWdVOilONhOMiii-2wLAHXO8v4uwDDD0895GzsEZQg/exec',
            TCO: 'https://script.google.com/macros/s/AKfycbzgewj7KjnTtWrnmnE7dcrz99CCpW1G3xw4Zft59dyIPL91avy1fqdVvgL1mRcIYhLP/exec',
            MATERIAIS: 'https://script.google.com/macros/s/AKfycby1FlbgHFzFZRDJbnzvCzsik-jlQDsnNCF3QafZemA6C4oSz8qODvOwrLaCGo0Z4VOJHg/exec',
            MATERIAIS_MOVIMENTACAO: 'https://script.google.com/macros/s/AKfycbwzoX1jw8mAREN24oiFRDxs2xF2xmIhsDS8M--VmIeSeuubNYflf5UTORAnF4JahFtn/exec',
            MVI: 'https://script.google.com/macros/s/AKfycbzpoyFungNK4VL99YrPj_jCF0GwBtUF0w8wXLhZxgbNUVbGbU3CxLS0n6-jOiqfASCJTA/exec',
            PERTURBACAO: 'https://script.google.com/macros/s/AKfycbwpkufWkoQ483xA3t8UGgf-q7Je3r3pXrRMcN9v_3RZQA9xjnEaocDa-9jsTu_c7P37/exec',
            CVP: 'https://script.google.com/macros/s/AKfycbzgC94-IDT31Mzmz8T1u3yvuHvM3Y73WRqjEeWIG3cKxNHDACMH1rwRSNxiX3APUTWi/exec',
            VD: 'https://script.google.com/macros/s/AKfycbyyqS93ST2mawBpEEjmbgMHYBhh7nMJXv8_yTelXtNxZ2BhS03KfAlBGqpTjXCp3scbQQ/exec',
            ARMAS: 'https://script.google.com/macros/s/AKfycbwYFUIiT7n0SCjK2kUY_6a68XC_rcvWkuPOkf1uDcvfKEN-cMyHw0TcovSoBv81E3So/exec',
            MANDADOS: 'https://script.google.com/macros/s/AKfycbzpY_8r8s8gPu-yEHa4jJEONTrYZsGwOj4OA26E9y2FO0ejQQkk3-wjWcN88QDUvLNh/exec',
            EVENTOS: 'https://script.google.com/macros/s/AKfycbyTNCA2XY0YMhJHpgnIigTijA5JaVOTvCVukrOPrKNlGvryiFHdURIe3daupK8Si1qu/exec',
            SENTENCAS: 'https://script.google.com/macros/s/AKfycbzkQrf1BPlEoG5Rj07vs1umurFHPURNVmC3GPd-r3TmV5yx-8Dkjpo2r_lxPwRz-_zU/exec'
        }
    };

    const SESSION_KEYS = ['userCpf', 'userGraduacao', 'userNomeGuerra', 'userNome', 'userNivel', 'userSenha', 'userUnidade'];

    // ── Expiração por inatividade (2h sem clique/tecla/scroll/navegação) ──
    const INATIVIDADE_CHAVE = 'p3_ultima_atividade';
    const INATIVIDADE_LIMITE_MS = 2 * 60 * 60 * 1000; // 2 horas

    // ── Tema (claro "minimalista" padrão / escuro "centro de operações") ──
    const TEMA_STORAGE_KEY = 'p3_tema';

    function temaSalvo() {
        try { return localStorage.getItem(TEMA_STORAGE_KEY) === 'dark' ? 'dark' : 'light'; }
        catch (e) { return 'light'; }
    }

    function aplicarTema(tema) {
        if (tema === 'dark') {
            global.document.documentElement.setAttribute('data-p3-theme', 'dark');
        } else {
            global.document.documentElement.removeAttribute('data-p3-theme');
        }
    }

    function alternarTema() {
        const novo = temaSalvo() === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem(TEMA_STORAGE_KEY, novo); } catch (e) {}
        aplicarTema(novo);
    }

    // Aplica o tema salvo imediatamente (antes do DOMContentLoaded) para
    // reduzir o "flash" da troca de tema ao carregar a página.
    aplicarTema(temaSalvo());

    function getSession() {
        const cpf = localStorage.getItem('userCpf');
        if (!cpf) return null;
        return {
            cpf,
            graduacao: localStorage.getItem('userGraduacao') || '',
            nomeGuerra: localStorage.getItem('userNomeGuerra') || '',
            nome: localStorage.getItem('userNome') || '',
            nivel: localStorage.getItem('userNivel') || 'operador',
            unidadeId: localStorage.getItem('userUnidade') || '10bpm'
        };
    }

    // Resolve caminhos relativos a partir de page/, relatorios/, public/ e
    // termos/ (todos um nível abaixo da raiz) ou da própria raiz.
    function estaEmSubpasta() {
        return /\/(page|relatorios|public|termos)\//.test(global.location.pathname);
    }

    // login.html só existe fisicamente dentro de page/ — a partir de
    // relatorios/, public/ ou termos/ é preciso subir um nível e entrar
    // em page/, não basta 'login.html' (isso apontaria para um arquivo
    // inexistente dentro da própria subpasta atual).
    function estaNaPastaPage() {
        return /\/page\//.test(global.location.pathname);
    }

    function loginUrlFromHere() {
        if (estaNaPastaPage()) return 'login.html';
        return estaEmSubpasta() ? '../page/login.html' : 'page/login.html';
    }

    function indexUrlFromHere() {
        return estaEmSubpasta() ? '../index.html' : 'index.html';
    }

    function logout(opts) {
        SESSION_KEYS.forEach(k => localStorage.removeItem(k));
        localStorage.removeItem(INATIVIDADE_CHAVE);
        // Token do login cruzado no Íris PMAL (ver page/login.html) — sai
        // junto da sessão do P3, senão ficaria válido (até expirar sozinho,
        // 7 dias) mesmo depois do usuário deslogar.
        localStorage.removeItem('irisToken');
        localStorage.removeItem('irisUnidadeChave');
        Object.keys(sessionStorage)
            .filter(k => k.indexOf('p3_unidade_config_') === 0 || k.indexOf('p3_xerife_historico_') === 0)
            .forEach(k => sessionStorage.removeItem(k));
        // opts.motivo vira ?motivo=... na URL de login, pra página de login
        // poder mostrar "sessão expirada" em vez do formulário mudo. Chamadas
        // antigas via addEventListener('click', P3.logout) passam o MouseEvent
        // como opts — sem .motivo, então isso não quebra nada.
        const motivo = opts && opts.motivo ? ('?motivo=' + opts.motivo) : '';
        global.location.href = loginUrlFromHere() + motivo;
    }

    // ── Monitor de inatividade (2h sem clique/tecla/scroll/navegação) ─────
    function registrarAtividade() {
        try { localStorage.setItem(INATIVIDADE_CHAVE, String(Date.now())); } catch (e) {}
    }

    function tempoOciosoMs() {
        const ultima = parseInt(localStorage.getItem(INATIVIDADE_CHAVE) || '0', 10);
        return ultima ? (Date.now() - ultima) : 0;
    }

    function iniciarMonitorInatividade() {
        if (!getSession()) return; // sem sessão, nada a monitorar

        // Se a aba ficou fechada/hibernada além do limite, desloga já ao
        // carregar — não precisa esperar o próximo tick do setInterval.
        if (tempoOciosoMs() > INATIVIDADE_LIMITE_MS) {
            logout({ motivo: 'inatividade' });
            return;
        }
        registrarAtividade(); // carregar/trocar de página já conta como atividade

        // Clique, tecla, rolagem ou toque reiniciam o contador. Sem throttle:
        // gravar no localStorage é barato e esses eventos não disparam a
        // ponto de pesar.
        ['click', 'keydown', 'scroll', 'touchstart'].forEach(evento => {
            global.addEventListener(evento, registrarAtividade, { passive: true });
        });

        // Verificação periódica — cobre o caso de deixar a aba aberta e
        // parada (sem clicar/navegar) além do limite.
        setInterval(() => {
            if (tempoOciosoMs() > INATIVIDADE_LIMITE_MS) logout({ motivo: 'inatividade' });
        }, 60 * 1000);
    }

    function requireAuth() {
        const session = getSession();
        if (!session) {
            global.location.href = loginUrlFromHere();
            return null;
        }
        return session;
    }

    function requireAdmin() {
        const session = requireAuth();
        if (!session) return null;
        if (session.nivel !== 'admin') {
            alert('Acesso restrito ao administrador.');
            global.location.href = indexUrlFromHere();
            return null;
        }
        return session;
    }

    // "Soluções IA" é um recurso exclusivo do 10º BPM (ferramentas externas
    // contratadas só para essa unidade). Demais unidades ficam de fora.
    function requireUnidade10bpm() {
        const session = requireAuth();
        if (!session) return null;
        if (session.unidadeId !== '10bpm') {
            alert('Este recurso está disponível apenas para o 10º BPM.');
            global.location.href = indexUrlFromHere();
            return null;
        }
        return session;
    }

    // Nível "copom": diferente de requireAdmin()/requireUnidade10bpm()
    // (que bloqueiam UMA página específica pra quem NÃO tem o nível), aqui
    // é o oposto — bloqueia TODAS as páginas do sistema pra quem TEM esse
    // nível, exceto a única liberada (rastreamento de guarnição). Chamada
    // incondicionalmente no fim deste arquivo, então roda em toda página
    // que inclui session.js, sem precisar adicionar nada em cada uma.
    const PAGINA_UNICA_COPOM = 'rastreamento-guarnicao.html';
    function restringirNivelCopom() {
        document.addEventListener('DOMContentLoaded', () => {
            const session = getSession();
            if (!session || session.nivel !== 'copom') return;
            const pagina = (global.location.pathname.split('/').pop() || '').toLowerCase();
            if (pagina === PAGINA_UNICA_COPOM || pagina === 'login.html') return;
            global.location.href = estaEmSubpasta() ? PAGINA_UNICA_COPOM : 'page/' + PAGINA_UNICA_COPOM;
        });
    }

    function mergeSobreDefault(base, override) {
        const result = { nome: base.nome, firebase: Object.assign({}, base.firebase), gas: Object.assign({}, base.gas), paginasPermitidas: null };
        if (override && override.nome) result.nome = override.nome;
        if (override && Array.isArray(override.paginasPermitidas)) result.paginasPermitidas = override.paginasPermitidas;
        if (override && override.firebase) Object.assign(result.firebase, override.firebase);
        if (override && override.gas) Object.assign(result.gas, override.gas);
        return result;
    }

    // Busca a configuração (Firebase + GAS) da unidade do usuário logado.
    // Para "10bpm", sempre parte do default embutido (funciona mesmo sem
    // nada cadastrado em /unidades). Para as demais unidades, usa somente
    // o que o admin configurou em /unidades/{id} — sem herdar URLs do 10º BPM.
    async function loadUnidadeConfig() {
        const session = getSession();
        const unidadeId = (session && session.unidadeId) || '10bpm';

        const cacheKey = 'p3_unidade_config_' + unidadeId;
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
            global.P3_CONFIG = JSON.parse(cached);
            return global.P3_CONFIG;
        }

        let config;
        try {
            // Timeout defensivo: se a rede travar (sem erro, sem resposta), o
            // fetch nunca resolveria sozinho — e como TODA página aguarda essa
            // função antes de continuar (cards do index, botão de sair, etc.),
            // uma trava aqui travava a página inteira. Com o AbortController,
            // depois de 8s desistimos e caímos no fallback abaixo.
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);
            const resp = await fetch(`${DIRETORIO_BASE_URL}/unidades/${unidadeId}.json`, { signal: controller.signal });
            clearTimeout(timeoutId);
            const dados = resp.ok ? await resp.json() : null;

            config = unidadeId === '10bpm'
                ? mergeSobreDefault(DEFAULT_10BPM_CONFIG, dados)
                : { nome: (dados && dados.nome) || unidadeId.toUpperCase(), firebase: (dados && dados.firebase) || {}, gas: (dados && dados.gas) || {}, paginasPermitidas: (dados && dados.paginasPermitidas) || null };
        } catch (err) {
            console.error('Erro ao carregar configuração da unidade:', err);
            config = unidadeId === '10bpm' ? DEFAULT_10BPM_CONFIG : { nome: unidadeId.toUpperCase(), firebase: {}, gas: {} };
        }

        sessionStorage.setItem(cacheKey, JSON.stringify(config));
        global.P3_CONFIG = config;
        return config;
    }

    // Mostra o item de menu "Usuários" (oculto por padrão no HTML) somente
    // para administradores. As páginas só precisam ter <a id="nav-usuarios">.
    function exibirLinkAdminNoMenu() {
        document.addEventListener('DOMContentLoaded', () => {
            const link = document.getElementById('nav-usuarios');
            if (!link) return;
            const session = getSession();
            if (session && session.nivel === 'admin') link.style.display = '';
        });
    }

    // Mostra o item de menu "Soluções IA" (oculto por padrão no HTML) somente
    // para usuários do 10º BPM. As páginas só precisam ter <a id="nav-solucoesia">.
    function exibirLinkSolucoesIANoMenu() {
        document.addEventListener('DOMContentLoaded', () => {
            const link = document.getElementById('nav-solucoesia');
            if (!link) return;
            const session = getSession();
            if (session && session.unidadeId === '10bpm') link.style.display = '';
        });
    }

    // Conecta o(s) botão(ões) #btn-tema presentes na página ao alternador.
    function conectarBotaoTema() {
        document.addEventListener('DOMContentLoaded', () => {
            document.querySelectorAll('#btn-tema').forEach(btn => {
                btn.addEventListener('click', alternarTema);
            });
        });
    }

    // Substitui o texto estático "10º BATALHÃO DE POLÍCIA MILITAR" (e
    // variações como "10º BPM") pelo nome da unidade do usuário logado
    // (campo "Nome" de /unidades/{id}, cadastrado em admin-unidades.html).
    // As páginas só precisam marcar o texto fixo com id="cabecalho-unidade"
    // (um único elemento) e/ou class="cabecalho-unidade" (vários na mesma
    // página, ex.: cabeçalho + selo de metadados de um relatório) no lugar
    // do texto — funciona tanto num elemento inteiro quanto num <span>
    // aninhado (quando há um complemento fixo, ex.: "— SEÇÃO P3").
    function exibirUnidadeNoHeader() {
        document.addEventListener('DOMContentLoaded', async () => {
            const alvos = document.querySelectorAll('#cabecalho-unidade, .cabecalho-unidade');
            if (!alvos.length) return;
            let nome = DEFAULT_10BPM_CONFIG.nome.toUpperCase();
            try {
                const cfg = await loadUnidadeConfig();
                if (cfg && cfg.nome) nome = cfg.nome.toUpperCase();
            } catch (e) { /* mantém o nome padrão em caso de falha */ }
            alvos.forEach(el => { el.textContent = nome; });
        });
    }

    // ── Restrição de acesso por página, por unidade ────────────────────
    // Admin configura em admin-usuarios.html → aba "Acesso por Página" quais
    // arquivos de page/ cada unidade pode abrir (campo /unidades/{id}/
    // paginasPermitidas, uma lista de nomes de arquivo). Se o campo não
    // existir (unidade nunca configurada nessa tela), o acesso continua
    // liberado — o padrão é NÃO restringir, pra não travar unidades já em
    // uso antes dessa função existir. Só entra em vigor depois que o admin
    // salva uma lista explícita (mesmo vazia) para aquela unidade.
    const PAGINAS_SEMPRE_LIBERADAS = ['index.html', 'login.html', 'admin-usuarios.html', 'admin-unidades.html', 'chat-mobile.html', 'ia_xerife.html', ''];

    async function restringirAcessoPorPagina() {
        const session = getSession();
        if (!session) return; // sem sessão — requireAuth() de cada página cuida disso
        if (!estaNaPastaPage()) return; // só restringe dentro de page/

        const pagina = (global.location.pathname.split('/').pop() || '').toLowerCase();
        if (PAGINAS_SEMPRE_LIBERADAS.includes(pagina)) return;

        try {
            const cfg = await loadUnidadeConfig();
            const permitidas = cfg && cfg.paginasPermitidas;
            if (!Array.isArray(permitidas)) return; // nada configurado = liberado
            if (permitidas.includes(pagina)) return;
            alert('Sua unidade não tem acesso a esta página.');
            // Volta pra página anterior (de onde o usuário veio) em vez de
            // sempre mandar pra Home — document.referrer só é confiável se
            // for do próprio sistema; link externo/aba nova cai no fallback.
            const veioDoProprioSistema = document.referrer && document.referrer.indexOf(global.location.origin) === 0;
            if (veioDoProprioSistema) {
                global.history.back();
            } else {
                global.location.href = indexUrlFromHere();
            }
        } catch (e) {
            // Falha de rede ao checar não deve travar o usuário fora do sistema.
            console.error('Erro ao checar acesso por página:', e);
        }
    }

    // ── Botão flutuante do Xerife (assistente da unidade) ──────────────
    // Aparece em toda página, pra quem já está logado. js/xerife.js é
    // carregado assim que a página termina de carregar (NÃO espera o clique
    // no botão) — porque, além da lógica de perguntas, ele dispara em
    // segundo plano o download do modelo de IA local (WebLLM/WebGPU), que
    // pode levar um tempo; carregar cedo dá tempo dele ficar pronto antes do
    // usuário realmente abrir o chat. Em navegadores sem WebGPU (ou sem
    // suporte), isso não baixa nada pesado — só cai direto no modo regras.
    function injetarXerife() {
        document.addEventListener('DOMContentLoaded', () => {
            if (!getSession()) return;
            // page/chat-mobile.html e page/ia_xerife.html já SÃO o Xerife em
            // tela cheia (incluem js/xerife.js diretamente) — sem essa
            // guarda, apareceria um botão flutuante duplicado por cima da
            // própria tela. login.html nunca deve mostrar o Xerife — não faz
            // sentido conversar com o assistente antes de entrar no sistema,
            // e uma sessão antiga ainda em localStorage (sem logout
            // explícito) podia fazer o botão aparecer ali por engano.
            const pagina = (global.location.pathname.split('/').pop() || '').toLowerCase();
            if (pagina === 'chat-mobile.html' || pagina === 'ia_xerife.html' || pagina === 'login.html') return;
            if (document.getElementById('xerife-botao')) return;
            // Página carregada DENTRO de um iframe (single embed ou split do
            // IA Xerife, ver js/components/jarvis-dashboard.js) — nunca
            // injeta o botão flutuante aqui: a esfera de partículas do
            // documento PAI já É o Xerife ativo. Sem essa guarda, tinha 2
            // interfaces de Xerife coexistindo (o botão/balão desta página
            // por cima da esfera externa) — pedido explícito do usuário:
            // "no mapa ou em qualquer página renderizada dentro do IA
            // Xerife eu quero que funcione somente o globo de partículas".
            try { if (window.self !== window.top) return; } catch (e) { return; } // cross-origin (não deveria acontecer) — mais seguro não injetar

            const prefixo = estaEmSubpasta() ? '../' : '';
            // Logo em img/xerife-logo.png; se ainda não existir, cai pro emoji
            // 🤠 automaticamente (onerror troca o <img> por texto).
            // A logo (img/xerife-logo.png) tem bastante margem transparente ao
            // redor do escudo — object-fit:cover a 100% (em vez de contain a
            // 72%) corta essa margem e faz o escudo preencher o círculo do
            // botão, que já é circular via overflow:hidden.
            const iconeXerifeHTML = '<img src="' + prefixo + 'img/xerife-logo.png" alt="Xerife" ' +
                'style="width:100%;height:100%;object-fit:cover;pointer-events:none;" ' +
                'onerror="this.remove();this.parentElement.textContent=\'🤠\';">';

            const btn = document.createElement('button');
            btn.id = 'xerife-botao';
            btn.type = 'button';
            btn.title = 'Falar com o Xerife';
            btn.setAttribute('aria-label', 'Abrir o assistente Xerife');
            btn.innerHTML = iconeXerifeHTML;
            btn.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9997;' +
                'width:58px;height:58px;border-radius:50%;border:none;cursor:pointer;' +
                'background:var(--p3-gradient, linear-gradient(90deg,#2f5fdd,#2450bd));' +
                'color:#fff;font-size:26px;line-height:1;box-shadow:0 4px 16px rgba(0,0,0,.28);' +
                'display:flex;align-items:center;justify-content:center;transition:transform .15s ease;overflow:hidden;';
            btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.08)'; });
            btn.addEventListener('mouseleave', () => { btn.style.transform = 'scale(1)'; });
            document.body.appendChild(btn);

            // Carrega já (sem esperar clique) — ver comentário acima.
            const script = document.createElement('script');
            script.src = prefixo + 'js/xerife.js';
            script.onerror = () => { btn.title = 'Xerife indisponível no momento'; };
            document.body.appendChild(script);

            btn.addEventListener('click', () => {
                if (global.Xerife) { global.Xerife.alternar(); return; }
                // script ainda não terminou de carregar (raro, mas possível
                // num clique muito rápido) — espera terminar e então abre.
                // Desiste depois de ~10s pra não ficar checando pra sempre
                // se o carregamento genuinamente falhou (ex.: rede offline).
                btn.disabled = true;
                btn.textContent = '⏳';
                let tentativas = 0;
                const esperar = setInterval(() => {
                    tentativas++;
                    if (global.Xerife) {
                        clearInterval(esperar);
                        btn.disabled = false;
                        btn.innerHTML = iconeXerifeHTML;
                        global.Xerife.alternar();
                    } else if (tentativas > 50) {
                        clearInterval(esperar);
                        btn.disabled = false;
                        btn.innerHTML = iconeXerifeHTML;
                        alert('Não foi possível carregar o Xerife agora. Tente novamente.');
                    }
                }, 200);
            });
        });
    }

    global.P3 = {
        DIRETORIO_BASE_URL,
        DEFAULT_10BPM_CONFIG,
        getSession,
        requireAuth,
        requireAdmin,
        requireUnidade10bpm,
        logout,
        loadUnidadeConfig,
        alternarTema
    };

    exibirLinkAdminNoMenu();
    exibirLinkSolucoesIANoMenu();
    conectarBotaoTema();
    exibirUnidadeNoHeader();
    iniciarMonitorInatividade();
    restringirAcessoPorPagina();
    restringirNivelCopom();
    injetarXerife();
})(window);
