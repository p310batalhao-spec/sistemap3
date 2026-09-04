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
            SENTENCAS: 'https://script.google.com/macros/s/AKfycbzkQrf1BPlEoG5Rj07vs1umurFHPURNVmC3GPd-r3TmV5yx-8Dkjpo2r_lxPwRz-_zU/exec',
            // Projeto Apps Script PRÓPRIO de Autores/Suspeitos (separado do
            // de TCO acima — ver apps-script/DEPLOY.md "Separar Autores/
            // Suspeitos do TCO"). TROQUE por essa URL depois de implantar o
            // projeto novo como app da Web — enquanto não trocar, os botões
            // "Verificar agora" de Autores/Suspeitos não funcionam.
            AUTORES: 'https://script.google.com/macros/s/AKfycbxTBLYkrpTLbxk01BIb9_tuRdmIBtv6NASChQOOTR4Z82-7rG_lXhh1VJc6uEV9JOHmTw/exec'
        },
        // API PHP/MySQL (Hostinger) — só o nó /autor do 10º BPM migrou pra cá
        // (o resto do sistema continua 100% Firebase). Ver hostinger-api/.
        apiPhp: {
            url: 'https://irispmal.io/api-p3/autores.php',
            apiKey: '#254562mdE1804199225359818#',
            // Pastas públicas com as fotos de autores/suspeitos — nomes
            // FIXOS (fotos_autores/fotos_suspeitos dentro de hostinger-api/
            // no servidor), criadas sozinhas pela rota uploadFoto na
            // primeira foto enviada pela tela. Usadas só pra mostrar
            // miniatura nas telas de Reconhecimento facial / Upload de
            // foto. Se você subiu fotos manualmente por FTP pro fluxo do
            // tools/vetores-faciais/ (script Node), use essa MESMA pasta
            // (fotos_autores) no FOTOS_BASE_URL do .env dele, pra não
            // ficar com fotos espalhadas em dois lugares diferentes.
            fotosAutoresBaseUrl: 'https://irispmal.io/api-p3/fotos_autores/',
            fotosSuspeitosBaseUrl: 'https://irispmal.io/api-p3/fotos_suspeitos/',
            // Pessoas sincronizadas do echelonx (Supabase) — ver
            // hostinger-api/pessoas_echelonx.php e tools/sincronizar-echelonx/.
            fotosEchelonxBaseUrl: 'https://irispmal.io/api-p3/fotos_echelonx/',
            // Cérbero (02/09/2026) — ver hostinger-api/cerbero.php e js/cerbero.js.
            cerberoUrl: 'https://irispmal.io/api-p3/cerbero.php',
            fotosCerberoBaseUrl: 'https://irispmal.io/api-p3/fotos_cerbero/',
            // Módulo P2 (04/09/2026) — Lista de Interesses (pessoas marcadas
            // em Autores/Suspeitos/Cérbero) e o cache de Consulta Integrada
            // compartilhado entre as 3 origens (chaveado por CPF, diferente
            // do cache próprio do Cérbero que é por id). Ver
            // hostinger-api/lista_interesses.php e
            // hostinger-api/consulta_integrada.php.
            listaInteressesUrl: 'https://irispmal.io/api-p3/lista_interesses.php',
            consultaIntegradaUrl: 'https://irispmal.io/api-p3/consulta_integrada.php'
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

    // Níveis válidos hoje: 'operador' (default), 'supervisor' (só rótulo,
    // sem lógica própria), 'admin' (requireAdmin), 'copom'
    // (restringirNivelCopom, só rastreamento-guarnicao.html) e 'p2'
    // (mesmas views do operador — a única diferença é a segmentação de
    // notificações em js/core/notificacoes.js: só vê movimentação de
    // autor no e-SAJ).
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

    // Nível "operador_campo": mesmo espírito de restringirNivelCopom() —
    // perfil criado pra quem só deve ter acesso à busca facial em campo
    // (page/busca-facial-campo.html), nada mais do sistema. Cadastro fica
    // pendente de aprovação do admin (ver login.html: auto-cadastro pra
    // este nível grava ativo:false; login já bloqueia usuário inativo com
    // "Contate o administrador" — admin aprova mudando ativo pra true em
    // admin-usuarios.html).
    const PAGINA_UNICA_OPERADOR_CAMPO = 'busca-facial-campo.html';
    function restringirNivelOperadorCampo() {
        document.addEventListener('DOMContentLoaded', () => {
            const session = getSession();
            if (!session || session.nivel !== 'operador_campo') return;
            const pagina = (global.location.pathname.split('/').pop() || '').toLowerCase();
            if (pagina === PAGINA_UNICA_OPERADOR_CAMPO || pagina === 'login.html') return;
            global.location.href = estaEmSubpasta() ? PAGINA_UNICA_OPERADOR_CAMPO : 'page/' + PAGINA_UNICA_OPERADOR_CAMPO;
        });
    }

    // Guarda de página, no mesmo espírito de requireAdmin() — usada em
    // page/busca-facial-campo.html pra impedir acesso direto de quem não
    // tem esse nível (a restrição acima só cuida do sentido contrário:
    // operador_campo tentando abrir OUTRA página).
    function requireOperadorCampo() {
        const session = requireAuth();
        if (!session) return null;
        if (session.nivel !== 'operador_campo' && session.nivel !== 'admin') {
            alert('Acesso restrito a Operador de Campo.');
            global.location.href = indexUrlFromHere();
            return null;
        }
        return session;
    }

    function mergeSobreDefault(base, override) {
        const result = { nome: base.nome, firebase: Object.assign({}, base.firebase), gas: Object.assign({}, base.gas), apiPhp: Object.assign({}, base.apiPhp), paginasPermitidas: null };
        if (override && override.nome) result.nome = override.nome;
        if (override && Array.isArray(override.paginasPermitidas)) result.paginasPermitidas = override.paginasPermitidas;
        if (override && override.firebase) Object.assign(result.firebase, override.firebase);
        if (override && override.gas) Object.assign(result.gas, override.gas);
        if (override && override.apiPhp) Object.assign(result.apiPhp, override.apiPhp);
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
            const configCacheada = JSON.parse(cached);
            // CORREÇÃO (04/09/2026) — cache por sessionStorage sobrevive a
            // um F5/reload (só é limpo quando TODAS as abas/janelas da
            // origem fecham), então um cache gravado ANTES de um campo
            // novo ser acrescentado em DEFAULT_10BPM_CONFIG.apiPhp (ex.:
            // listaInteressesUrl/consultaIntegradaUrl, 04/09/2026) ficava
            // preso sem esse campo até o usuário fechar o app de verdade —
            // bug real relatado: botão "Add lista de interesses" sumia
            // silenciosamente (cfg.apiPhp.listaInteressesUrl undefined)
            // mesmo com session.js já atualizado no GitHub Pages. Reforça
            // os campos do default por cima do cache a cada leitura — só
            // PREENCHE o que estiver faltando, nunca sobrescreve o que já
            // veio customizado (ordem do Object.assign: base primeiro).
            if (unidadeId === '10bpm' && configCacheada.apiPhp) {
                configCacheada.apiPhp = Object.assign({}, DEFAULT_10BPM_CONFIG.apiPhp, configCacheada.apiPhp);
            }
            global.P3_CONFIG = configCacheada;
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

    // ====================================================================
    // P3.Autores — abstração de fonte de dados do nó "autor"
    // ====================================================================
    // Só o nó /autor do 10º BPM migrou do Firebase para a API PHP/MySQL da
    // Hostinger (ver hostinger-api/ na raiz do projeto) — as demais
    // unidades continuam 100% Firebase. Toda página/script que lê ou
    // escreve autor deve passar por aqui (nunca falar direto com
    // Firebase/API PHP para esse nó específico), pra decisão "Firebase vs
    // Hostinger" ficar concentrada num único lugar. `cfg` é sempre o
    // retorno de loadUnidadeConfig(). O formato de retorno de listar()/
    // buscar() é sempre um dicionário {id: {NOME, CPF, ...}}, idêntico ao
    // que `${databaseURL}/autor.json` sempre devolveu — quem consome não
    // precisa saber de onde veio.
    function autoresUsaApiPhp(cfg) {
        return !!(cfg && cfg.apiPhp && cfg.apiPhp.url);
    }

    async function autoresApiFetch(cfg, acao, opts) {
        opts = opts || {};
        // apiPhp.url aceita as duas formas: apontando direto pro arquivo
        // (".../api-p3/autores.php") ou só a pasta (".../api-p3") — evita
        // duplicar "/autores.php" quando já vem no valor configurado.
        const base = /\.php$/i.test(cfg.apiPhp.url) ? cfg.apiPhp.url : `${cfg.apiPhp.url}/autores.php`;
        const url = `${base}?action=${acao}${opts.query || ''}`;
        const init = { method: opts.method || 'GET', headers: {} };
        // Só manda cabeçalho em requisição COM corpo (POST) — um GET puro
        // sem cabeçalho nenhum é "simple request" no CORS e não dispara
        // preflight OPTIONS, então uma leitura (listar/buscar) nunca
        // depende do servidor tratar OPTIONS corretamente.
        if (opts.body) {
            init.headers['Content-Type'] = 'application/json';
            init.headers['X-Api-Key'] = cfg.apiPhp.apiKey || '';
            init.body = JSON.stringify(opts.body);
        }
        const res = await fetch(url, init);
        if (!res.ok) throw new Error(`API autores (${acao}) — HTTP ${res.status}`);
        return await res.json();
    }

    async function fbGetAutorNode(cfg) {
        const res = await fetch(`${cfg.firebase.databaseURL}/autor.json`);
        return (res.ok ? await res.json() : null) || {};
    }

    async function fbPatchAutor(cfg, id, dados) {
        const res = await fetch(`${cfg.firebase.databaseURL}/autor/${encodeURIComponent(id)}.json`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados)
        });
        return await res.json();
    }

    async function autoresListar(cfg) {
        if (autoresUsaApiPhp(cfg)) return await autoresApiFetch(cfg, 'listar');
        return await fbGetAutorNode(cfg);
    }

    // Vetores faciais (embeddings) já calculados — ver tools/vetores-faciais/
    // e page/autores.html (aba "Reconhecimento facial"). Só existe no
    // caminho Hostinger; nas demais unidades (Firebase) devolve vazio, sem
    // erro, pra tela poder mostrar "recurso indisponível" ao invés de quebrar.
    async function autoresListarVetores(cfg) {
        if (!autoresUsaApiPhp(cfg)) return {};
        return await autoresApiFetch(cfg, 'listarVetores');
    }

    // Histórico completo de fotos já salvas pro autor (tabela autor_fotos)
    // — diferente de foto_arquivo (só a de capa), usado pelo modal de
    // detalhes (js/pessoa-modal.js) pra mostrar TODAS as fotos registradas.
    async function autoresListarFotos(cfg, id) {
        if (!autoresUsaApiPhp(cfg) || !id) return [];
        return await autoresApiFetch(cfg, 'listarFotos', { query: '&id=' + encodeURIComponent(id) });
    }

    // ====================================================================
    // P3.PessoasEchelonx — cache local de gente do echelonx (Supabase) —
    // só leitura por aqui (quem escreve é tools/sincronizar-echelonx/,
    // por fora). Mesmo formato de retorno de autoresListarVetores/
    // suspeitosListarVetores, pra js/autores-reconhecimento-facial.js e
    // js/busca-facial-campo.js somarem como uma 3ª fonte sem lógica
    // especial. Ver hostinger-api/pessoas_echelonx.php.
    // ====================================================================
    async function pessoasEchelonxListarVetores(cfg) {
        if (!autoresUsaApiPhp(cfg)) return {};
        const base = /\.php$/i.test(cfg.apiPhp.url) ? cfg.apiPhp.url.replace(/autores\.php$/i, 'pessoas_echelonx.php') : `${cfg.apiPhp.url}/pessoas_echelonx.php`;
        const res = await fetch(`${base}?action=listarVetores`);
        if (!res.ok) throw new Error(`API pessoas_echelonx (listarVetores) — HTTP ${res.status}`);
        return await res.json();
    }

    // Cruzamento pontual por CPF — usado pelo modal de detalhes (autor/
    // suspeito/resultado do reconhecimento facial) pra mostrar o que
    // existe no echelonx (Supabase) sobre a mesma pessoa. Devolve null
    // quando não há correspondência (nunca lança por "não achou").
    async function pessoasEchelonxBuscarPorCpf(cfg, cpf) {
        if (!autoresUsaApiPhp(cfg) || !cpf) return null;
        const base = /\.php$/i.test(cfg.apiPhp.url) ? cfg.apiPhp.url.replace(/autores\.php$/i, 'pessoas_echelonx.php') : `${cfg.apiPhp.url}/pessoas_echelonx.php`;
        const res = await fetch(`${base}?action=buscarPorCpf&cpf=${encodeURIComponent(cpf)}`);
        if (!res.ok) throw new Error(`API pessoas_echelonx (buscarPorCpf) — HTTP ${res.status}`);
        const j = await res.json();
        return (j && j.CPF) ? j : null;
    }

    // ====================================================================
    // P3.Cerbero (02/09/2026) — mesmo formato de retorno de
    // autoresListarVetores/suspeitosListarVetores/pessoasEchelonxListarVetores
    // (id -> {NOME,CPF,vetorFacial,fotoArquivo}), pra
    // js/autores-reconhecimento-facial.js somar como 4ª fonte sem lógica
    // especial. Ver hostinger-api/cerbero.php. cfg.apiPhp.cerberoUrl já
    // vem pronto (não precisa do replace de autores.php -> outro arquivo
    // que as demais integrações fazem, porque este campo foi criado
    // direto com o nome certo).
    // ====================================================================
    async function cerberoListarVetores(cfg) {
        if (!autoresUsaApiPhp(cfg) || !cfg.apiPhp.cerberoUrl) return {};
        const res = await fetch(`${cfg.apiPhp.cerberoUrl}?action=listarVetores`);
        if (!res.ok) throw new Error(`API cerbero (listarVetores) — HTTP ${res.status}`);
        return await res.json();
    }

    // Vínculos pessoa↔endereço (aba "Vínculos" → "Endereços" da ficha da
    // pessoa no Cérbero — extraído por tools/atualizador-local/cerbero_har.py,
    // ver hostinger-api/cerbero.php). Leitura aberta (sem X-Api-Key),
    // mesmo padrão de listarVetores/listar_pessoas/listar_enderecos. Só
    // existe vínculo pra quem o usuário abriu essa sub-aba durante a
    // captura — a lista pode vir bem menor que o total de pessoas.
    async function cerberoListarPessoaEnderecos(cfg) {
        if (!autoresUsaApiPhp(cfg) || !cfg.apiPhp.cerberoUrl) return [];
        const res = await fetch(`${cfg.apiPhp.cerberoUrl}?action=listar_pessoa_enderecos`);
        if (!res.ok) throw new Error(`API cerbero (listar_pessoa_enderecos) — HTTP ${res.status}`);
        return await res.json();
    }

    // Galeria de fotos de 1 pessoa do Cérbero (cerbero_pessoa_fotos) —
    // mesmo padrão de Autores/Suspeitos.listarFotos, usado pelo modal de
    // detalhe em js/cerbero.js.
    async function cerberoListarFotos(cfg, id) {
        if (!autoresUsaApiPhp(cfg) || !cfg.apiPhp.cerberoUrl || !id) return [];
        const res = await fetch(`${cfg.apiPhp.cerberoUrl}?action=listarFotos&id=${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error(`API cerbero (listarFotos) — HTTP ${res.status}`);
        return await res.json();
    }

    // Consulta Integrada persistida por pessoa do Cérbero (03/09/2026,
    // pedido explícito do usuário) — {encontrado, resultado?, consultadoEm?}.
    // Leitura aberta (mesmo padrão de listarFotos/listar_pessoas).
    async function cerberoObterConsultaIntegrada(cfg, pessoaId) {
        if (!autoresUsaApiPhp(cfg) || !cfg.apiPhp.cerberoUrl) return { encontrado: false };
        const res = await fetch(`${cfg.apiPhp.cerberoUrl}?action=obter_consulta_integrada&pessoaId=${encodeURIComponent(pessoaId)}`);
        if (!res.ok) throw new Error(`API cerbero (obter_consulta_integrada) — HTTP ${res.status}`);
        return await res.json();
    }

    // Salva/sobrescreve (upsert por pessoa_id) o resultado de 1 consulta
    // integrada — chamado por js/cerbero.js logo depois de uma consulta
    // nova terminar, pra próxima abertura da mesma pessoa ser instantânea.
    async function cerberoSalvarConsultaIntegrada(cfg, pessoaId, cpf, resultado) {
        if (!autoresUsaApiPhp(cfg) || !cfg.apiPhp.cerberoUrl) return;
        const res = await fetch(`${cfg.apiPhp.cerberoUrl}?action=salvar_consulta_integrada`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Api-Key': cfg.apiPhp.apiKey || '' },
            body: JSON.stringify({ pessoaId: pessoaId, cpf: cpf, resultado: resultado }),
        });
        if (!res.ok) throw new Error(`API cerbero (salvar_consulta_integrada) — HTTP ${res.status}`);
        return await res.json();
    }

    // ====================================================================
    // P3.ListaInteresses (04/09/2026) — módulo P2: pessoas marcadas com
    // "add lista de interesses" em Autores/Suspeitos/Cérbero. Leitura
    // aberta (mesmo padrão de listar_pessoas/listarFotos); escrita exige
    // X-Api-Key. Só existe pro 10º BPM (mesma exclusividade do resto do
    // módulo P2 — Cérbero/Consulta Integrada).
    // ====================================================================
    async function listaInteressesListar(cfg) {
        if (!autoresUsaApiPhp(cfg) || !cfg.apiPhp.listaInteressesUrl) return [];
        const res = await fetch(`${cfg.apiPhp.listaInteressesUrl}?action=listar`);
        if (!res.ok) throw new Error(`API lista_interesses (listar) — HTTP ${res.status}`);
        return await res.json();
    }

    async function listaInteressesAdicionar(cfg, { origem, origemId, nome, cpf }) {
        if (!autoresUsaApiPhp(cfg) || !cfg.apiPhp.listaInteressesUrl) throw new Error('Lista de Interesses só está disponível para o 10º BPM.');
        const sessao = getSession();
        const res = await fetch(`${cfg.apiPhp.listaInteressesUrl}?action=adicionar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Api-Key': cfg.apiPhp.apiKey || '' },
            body: JSON.stringify({ origem, origemId, nome, cpf, adicionadoPor: sessao ? sessao.cpf : null }),
        });
        if (!res.ok) throw new Error(`API lista_interesses (adicionar) — HTTP ${res.status}`);
        return await res.json();
    }

    async function listaInteressesRemover(cfg, { origem, origemId }) {
        if (!autoresUsaApiPhp(cfg) || !cfg.apiPhp.listaInteressesUrl) throw new Error('Lista de Interesses só está disponível para o 10º BPM.');
        const res = await fetch(`${cfg.apiPhp.listaInteressesUrl}?action=remover`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Api-Key': cfg.apiPhp.apiKey || '' },
            body: JSON.stringify({ origem, origemId }),
        });
        if (!res.ok) throw new Error(`API lista_interesses (remover) — HTTP ${res.status}`);
        return await res.json();
    }

    // ====================================================================
    // P3.ConsultaIntegrada (04/09/2026) — cache de Consulta Integrada
    // chaveado por CPF, compartilhado entre Autores/Suspeitos/Cérbero (ver
    // hostinger-api/consulta_integrada.php). Diferente de
    // P3.Cerbero.obterConsultaIntegrada/salvarConsultaIntegrada (chaveados
    // pelo id do Cérbero — continuam existindo, usados só pelo modal do
    // Cérbero) — este aqui é o que a página Lista de Interesses usa,
    // porque uma pessoa vinda de Autores/Suspeitos não tem id do Cérbero.
    // ====================================================================
    async function consultaIntegradaObter(cfg, cpf) {
        if (!autoresUsaApiPhp(cfg) || !cfg.apiPhp.consultaIntegradaUrl || !cpf) return { encontrado: false };
        const res = await fetch(`${cfg.apiPhp.consultaIntegradaUrl}?action=obter&cpf=${encodeURIComponent(cpf)}`);
        if (!res.ok) throw new Error(`API consulta_integrada (obter) — HTTP ${res.status}`);
        return await res.json();
    }

    async function consultaIntegradaSalvar(cfg, cpf, resultado) {
        if (!autoresUsaApiPhp(cfg) || !cfg.apiPhp.consultaIntegradaUrl) return;
        const res = await fetch(`${cfg.apiPhp.consultaIntegradaUrl}?action=salvar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Api-Key': cfg.apiPhp.apiKey || '' },
            body: JSON.stringify({ cpf, resultado }),
        });
        if (!res.ok) throw new Error(`API consulta_integrada (salvar) — HTTP ${res.status}`);
        return await res.json();
    }

    // Chamado pelo botão "🧠 Gerar reconhecimento facial" em js/cerbero.js
    // — depois que o navegador já baixou a foto de uma pessoa importada e
    // calculou o embedding via face-api.js.
    async function cerberoAtualizarVetorFacial(cfg, id, vetorFacial) {
        if (!autoresUsaApiPhp(cfg) || !cfg.apiPhp.cerberoUrl) throw new Error('Cérbero só está disponível para o 10º BPM.');
        const res = await fetch(`${cfg.apiPhp.cerberoUrl}?action=atualizarVetorFacial`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Api-Key': cfg.apiPhp.apiKey || '' },
            body: JSON.stringify({ id, vetorFacial: Array.from(vetorFacial) }),
        });
        if (!res.ok) {
            let msg = `API cerbero (atualizarVetorFacial) — HTTP ${res.status}`;
            try { const j = await res.json(); if (j && j.erro) msg = j.erro; } catch (e) {}
            throw new Error(msg);
        }
        return await res.json();
    }

    // Upload de foto (arquivo de verdade, multipart/form-data) — diferente
    // de autoresApiFetch (que só manda JSON): NÃO define Content-Type
    // manualmente, o navegador precisa gerar o boundary do multipart
    // sozinho. `vetorFacial` é opcional (Float32Array/array de 128
    // números já calculado no navegador via face-api.js — ver
    // js/core/facial-detect.js); se ausente, só a foto é salva.
    // `opts` (opcional): { capa, origem } — cada foto agora vira um
    // arquivo PRÓPRIO no servidor (nunca mais sobrescreve a anterior, ver
    // p3_salvar_foto_pessoa em hostinger-api/config.php). `capa: false`
    // salva a foto (e soma o vetor, se enviado) SEM trocar qual é a foto
    // de capa da pessoa — usado por js/cad-busca-foto.js pras fotos
    // extras (a melhor já foi escolhida como capa antes). `origem` é só
    // rótulo pra auditoria ('upload'|'cad'|'echelonx', default 'upload'
    // no servidor).
    async function autoresUploadFoto(cfg, id, arquivo, vetorFacial, opts) {
        if (!autoresUsaApiPhp(cfg)) throw new Error('Upload de foto só está disponível para o 10º BPM.');
        opts = opts || {};
        const base = /\.php$/i.test(cfg.apiPhp.url) ? cfg.apiPhp.url : `${cfg.apiPhp.url}/autores.php`;
        const form = new FormData();
        form.append('id', id);
        form.append('foto', arquivo);
        if (vetorFacial) form.append('vetorFacial', JSON.stringify(Array.from(vetorFacial)));
        if (opts.capa === false) form.append('capa', '0');
        if (opts.origem) form.append('origem', opts.origem);
        const res = await fetch(`${base}?action=uploadFoto`, {
            method: 'POST', headers: { 'X-Api-Key': cfg.apiPhp.apiKey || '' }, body: form
        });
        if (!res.ok) {
            let msg = `API autores (uploadFoto) — HTTP ${res.status}`;
            try { const j = await res.json(); if (j && j.erro) msg = j.erro; } catch (e) {}
            throw new Error(msg);
        }
        return await res.json();
    }

    // Acrescenta um vetor facial (embedding já calculado) SEM mexer na
    // foto de capa da pessoa — usado quando já existe uma foto melhor
    // marcada como capa (ver js/cad-busca-foto.js: baixa várias fotos do
    // CAD, escolhe a de rosto mais visível pra virar a capa via
    // autoresUploadFoto, e manda o resto só por aqui, pra não sobrescrever
    // a capa com uma foto pior — ex.: foto de mão/documento sem rosto).
    async function autoresAtualizarVetorFacial(cfg, id, vetorFacial) {
        if (!autoresUsaApiPhp(cfg)) throw new Error('Vetor facial só está disponível para o 10º BPM.');
        return await autoresApiFetch(cfg, 'atualizarVetorFacial', {
            method: 'POST', body: { id, vetorFacial: Array.from(vetorFacial) }
        });
    }

    // Busca precisa por NOME + CPF + NOME DA MÃE (evita homônimos). Só faz
    // busca server-side de fato no caminho Hostinger — no Firebase não há
    // essa capacidade, então devolve o nó inteiro e quem chamou filtra no
    // client, exatamente como a página de Autores já fazia antes.
    async function autoresBuscar(cfg, filtros) {
        filtros = filtros || {};
        if (autoresUsaApiPhp(cfg)) {
            const q = new URLSearchParams();
            if (filtros.nome) q.set('nome', filtros.nome);
            if (filtros.cpf) q.set('cpf', filtros.cpf);
            if (filtros.nomeMae) q.set('nomeMae', filtros.nomeMae);
            return await autoresApiFetch(cfg, 'buscar', { query: '&' + q.toString() });
        }
        return await fbGetAutorNode(cfg);
    }

    async function autoresVincular(cfg, id, dados) {
        dados = dados || {};
        if (autoresUsaApiPhp(cfg)) {
            return await autoresApiFetch(cfg, 'vincular', { method: 'POST', body: Object.assign({ id }, dados) });
        }
        return await fbPatchAutor(cfg, id, {
            statusVinculoEsaj: 'vinculado',
            numeroProcessoEsaj: dados.numeroProcesso,
            origemVinculo: 'manual',
            vinculadoPor: dados.vinculadoPor || null,
            descobertoEm: new Date().toISOString(),
            candidatosEsaj: null
        });
    }

    async function autoresMarcarNaoEncontrado(cfg, id) {
        if (autoresUsaApiPhp(cfg)) {
            return await autoresApiFetch(cfg, 'marcarNaoEncontrado', { method: 'POST', body: { id } });
        }
        return await fbPatchAutor(cfg, id, { statusVinculoEsaj: 'nao_encontrado', candidatosEsaj: null });
    }

    // Campo novo, só existe no caminho Hostinger — nas demais unidades o
    // Firebase nunca teve esse campo, então não há pra onde escrever.
    async function autoresAtualizarNomeMae(cfg, id, nomeMae) {
        if (!autoresUsaApiPhp(cfg)) throw new Error('Edição de Nome da Mãe só está disponível para o 10º BPM.');
        return await autoresApiFetch(cfg, 'nomeMae', { method: 'POST', body: { id, nomeMae } });
    }

    // Processo(s) EXTRA(s) vinculado(s) à mão — um autor pode ter mais de
    // um processo e-SAJ de interesse. O vínculo automático do robô
    // continua limitado a 1 processo por autor (statusVinculoEsaj/
    // numeroProcessoEsaj de sempre); isto aqui só adiciona/remove os
    // extras (tabela autor_processos). Só existe no caminho Hostinger.
    async function autoresAdicionarProcesso(cfg, id, numeroProcesso) {
        if (!autoresUsaApiPhp(cfg)) throw new Error('Vincular mais de um processo só está disponível para o 10º BPM.');
        const sessao = getSession();
        return await autoresApiFetch(cfg, 'adicionarProcesso', {
            method: 'POST', body: { id, numeroProcesso, vinculadoPor: sessao ? sessao.cpf : null }
        });
    }

    async function autoresExcluirProcesso(cfg, processoId) {
        if (!autoresUsaApiPhp(cfg)) throw new Error('Vincular mais de um processo só está disponível para o 10º BPM.');
        return await autoresApiFetch(cfg, 'excluirProcesso', { method: 'POST', body: { processoId } });
    }

    // Usado pelo cadastro de ocorrências ao importar planilha tipo "autor".
    // Fora do 10º BPM é no-op — quem chama continua gravando no Firebase
    // exatamente como sempre gravou, sem passar por aqui.
    async function autoresImportarLote(cfg, registros) {
        if (!autoresUsaApiPhp(cfg) || !registros || !registros.length) return { ok: true, gravados: 0 };
        const LOTE = 200;
        let gravados = 0;
        for (let i = 0; i < registros.length; i += LOTE) {
            const lote = registros.slice(i, i + LOTE);
            await autoresApiFetch(cfg, 'importar', { method: 'POST', body: { registros: lote } });
            gravados += lote.length;
        }
        return { ok: true, gravados };
    }

    // ====================================================================
    // P3.Suspeitos — cadastro manual, agrupado por pessoa (Hostinger only)
    // ====================================================================
    // Diferente de P3.Autores: não existe versão Firebase (recurso novo,
    // só Hostinger) — só funciona pra quem tem apiPhp configurado (10º
    // BPM). Uma pessoa pode ter vários processos e-SAJ vinculados; listar()
    // já devolve agrupado: {id: {NOME, CPF, ..., processos:[...]}}.
    async function suspeitosApiFetch(cfg, acao, opts) {
        if (!autoresUsaApiPhp(cfg)) throw new Error('Suspeitos só está disponível para o 10º BPM.');
        opts = opts || {};
        const base = /\.php$/i.test(cfg.apiPhp.url) ? cfg.apiPhp.url.replace(/autores\.php$/i, 'suspeitos.php') : `${cfg.apiPhp.url}/suspeitos.php`;
        const url = `${base}?action=${acao}${opts.query || ''}`;
        const init = { method: opts.method || 'GET', headers: {} };
        // Só manda cabeçalho em requisição COM corpo (POST) — ver comentário
        // equivalente em autoresApiFetch.
        if (opts.body) {
            init.headers['Content-Type'] = 'application/json';
            init.headers['X-Api-Key'] = cfg.apiPhp.apiKey || '';
            init.body = JSON.stringify(opts.body);
        }
        const res = await fetch(url, init);
        if (!res.ok) {
            let msg = `API suspeitos (${acao}) — HTTP ${res.status}`;
            try { const j = await res.json(); if (j && j.erro) msg = j.erro; } catch (e) {}
            throw new Error(msg);
        }
        return await res.json();
    }

    function suspeitosDisponivel(cfg) {
        return autoresUsaApiPhp(cfg);
    }

    async function suspeitosListar(cfg) {
        return await suspeitosApiFetch(cfg, 'listar');
    }

    async function suspeitosBuscar(cfg, filtros) {
        filtros = filtros || {};
        const q = new URLSearchParams();
        if (filtros.nome) q.set('nome', filtros.nome);
        if (filtros.cpf) q.set('cpf', filtros.cpf);
        return await suspeitosApiFetch(cfg, 'buscar', { query: '&' + q.toString() });
    }

    async function suspeitosCriar(cfg, { nome, cpf, rg, nomeMae }) {
        const sessao = getSession();
        return await suspeitosApiFetch(cfg, 'criar', { method: 'POST', body: { nome, cpf, rg, nomeMae, criadoPor: sessao ? sessao.cpf : null } });
    }

    async function suspeitosVincularProcesso(cfg, suspeitoId, numeroProcesso, origemVinculo) {
        const sessao = getSession();
        return await suspeitosApiFetch(cfg, 'vincularProcesso', {
            method: 'POST',
            body: { suspeitoId, numeroProcesso, origemVinculo: origemVinculo || 'manual', vinculadoPor: sessao ? sessao.cpf : null }
        });
    }

    async function suspeitosMarcarNaoEncontrado(cfg, id) {
        return await suspeitosApiFetch(cfg, 'marcarNaoEncontrado', { method: 'POST', body: { id } });
    }

    async function suspeitosExcluirProcesso(cfg, processoId) {
        return await suspeitosApiFetch(cfg, 'excluirProcesso', { method: 'POST', body: { processoId } });
    }

    async function suspeitosExcluirSuspeito(cfg, id) {
        return await suspeitosApiFetch(cfg, 'excluirSuspeito', { method: 'POST', body: { id } });
    }

    // Mesmo propósito de autoresListarVetores — ver comentário lá.
    async function suspeitosListarVetores(cfg) {
        if (!autoresUsaApiPhp(cfg)) return {};
        return await suspeitosApiFetch(cfg, 'listarVetores');
    }

    // Mesmo propósito de autoresListarFotos — ver comentário lá.
    async function suspeitosListarFotos(cfg, id) {
        if (!autoresUsaApiPhp(cfg) || !id) return [];
        return await suspeitosApiFetch(cfg, 'listarFotos', { query: '&id=' + encodeURIComponent(id) });
    }

    // Mesmo propósito de autoresUploadFoto — ver comentário lá.
    // Mesmo esquema de opts { capa, origem } de autoresUploadFoto — ver
    // comentário lá.
    async function suspeitosUploadFoto(cfg, id, arquivo, vetorFacial, opts) {
        if (!autoresUsaApiPhp(cfg)) throw new Error('Upload de foto só está disponível para o 10º BPM.');
        opts = opts || {};
        const base = /\.php$/i.test(cfg.apiPhp.url) ? cfg.apiPhp.url.replace(/autores\.php$/i, 'suspeitos.php') : `${cfg.apiPhp.url}/suspeitos.php`;
        const form = new FormData();
        form.append('id', id);
        form.append('foto', arquivo);
        if (vetorFacial) form.append('vetorFacial', JSON.stringify(Array.from(vetorFacial)));
        if (opts.capa === false) form.append('capa', '0');
        if (opts.origem) form.append('origem', opts.origem);
        const res = await fetch(`${base}?action=uploadFoto`, {
            method: 'POST', headers: { 'X-Api-Key': cfg.apiPhp.apiKey || '' }, body: form
        });
        if (!res.ok) {
            let msg = `API suspeitos (uploadFoto) — HTTP ${res.status}`;
            try { const j = await res.json(); if (j && j.erro) msg = j.erro; } catch (e) {}
            throw new Error(msg);
        }
        return await res.json();
    }

    // Mesmo propósito de autoresAtualizarVetorFacial — ver comentário lá.
    async function suspeitosAtualizarVetorFacial(cfg, id, vetorFacial) {
        if (!autoresUsaApiPhp(cfg)) throw new Error('Vetor facial só está disponível para o 10º BPM.');
        return await suspeitosApiFetch(cfg, 'atualizarVetorFacial', {
            method: 'POST', body: { id, vetorFacial: Array.from(vetorFacial) }
        });
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
    // Aparece em toda página, pra quem já está logado. js/xerife.js só é
    // carregado no PRIMEIRO CLIQUE no botão (ver garantirScriptXerifeCarregado
    // abaixo) — CORRIGIDO (27/08/2026): carregar cedo demais (antes, direto
    // aqui, sem esperar clique) mantinha o modelo de IA local (WebLLM/
    // WebGPU, ver js/xerife.js) baixado/rodando em TODA página pra TODO
    // usuário logado, mesmo quem nunca abre o chat — ~1GB de RAM extra
    // ocupado à toa (reclamação real rodando dentro do app desktop/webview,
    // mas vale pra qualquer navegador). Agora só baixa quando alguém
    // realmente clica em conversar com o Xerife.
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

            // CORREÇÃO (27/08/2026) — antes, js/xerife.js era carregado aqui
            // mesmo, sem esperar o clique, JUSTAMENTE pra dar tempo do
            // modelo de IA local (WebLLM/WebGPU, ver js/xerife.js) baixar/
            // carregar antes do usuário abrir o chat. Só que isso baixa e
            // mantém ~1GB de RAM ocupado em TODA página, pra TODO usuário
            // logado, mesmo quem nunca abre o Xerife — reclamação real:
            // "o sistema webview está deixando o windows extremamente
            // lento... chegou a marcar mais 1Gb no uso de memória". Agora só
            // carrega (e só então baixa o modelo) no primeiro clique no
            // botão — o spinner/polling abaixo já existia pra cobrir esse
            // caso (clique antes do script terminar de carregar), então não
            // precisou de lógica nova, só parou de disparar cedo demais.
            let scriptXerifeInjetado = false;
            function garantirScriptXerifeCarregado() {
                if (scriptXerifeInjetado) return;
                scriptXerifeInjetado = true;
                const script = document.createElement('script');
                script.src = prefixo + 'js/xerife.js';
                script.onerror = () => { btn.title = 'Xerife indisponível no momento'; };
                document.body.appendChild(script);
            }

            btn.addEventListener('click', () => {
                if (global.Xerife) { global.Xerife.alternar(); return; }
                garantirScriptXerifeCarregado();
                // script ainda não terminou de carregar — espera terminar e
                // então abre. Desiste depois de ~10s pra não ficar checando
                // pra sempre se o carregamento genuinamente falhou (ex.:
                // rede offline).
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
        requireOperadorCampo,
        logout,
        loadUnidadeConfig,
        alternarTema,
        Autores: {
            usaApiPhp: autoresUsaApiPhp,
            listar: autoresListar,
            listarVetores: autoresListarVetores,
            listarFotos: autoresListarFotos,
            uploadFoto: autoresUploadFoto,
            atualizarVetorFacial: autoresAtualizarVetorFacial,
            buscar: autoresBuscar,
            vincular: autoresVincular,
            marcarNaoEncontrado: autoresMarcarNaoEncontrado,
            atualizarNomeMae: autoresAtualizarNomeMae,
            importarLote: autoresImportarLote,
            adicionarProcesso: autoresAdicionarProcesso,
            excluirProcesso: autoresExcluirProcesso
        },
        Suspeitos: {
            disponivel: suspeitosDisponivel,
            listar: suspeitosListar,
            listarVetores: suspeitosListarVetores,
            listarFotos: suspeitosListarFotos,
            uploadFoto: suspeitosUploadFoto,
            atualizarVetorFacial: suspeitosAtualizarVetorFacial,
            buscar: suspeitosBuscar,
            criar: suspeitosCriar,
            vincularProcesso: suspeitosVincularProcesso,
            marcarNaoEncontrado: suspeitosMarcarNaoEncontrado,
            excluirProcesso: suspeitosExcluirProcesso,
            excluirSuspeito: suspeitosExcluirSuspeito
        },
        PessoasEchelonx: {
            listarVetores: pessoasEchelonxListarVetores,
            buscarPorCpf: pessoasEchelonxBuscarPorCpf
        },
        Cerbero: {
            listarVetores: cerberoListarVetores,
            atualizarVetorFacial: cerberoAtualizarVetorFacial,
            listarPessoaEnderecos: cerberoListarPessoaEnderecos,
            listarFotos: cerberoListarFotos,
            obterConsultaIntegrada: cerberoObterConsultaIntegrada,
            salvarConsultaIntegrada: cerberoSalvarConsultaIntegrada
        },
        ListaInteresses: {
            listar: listaInteressesListar,
            adicionar: listaInteressesAdicionar,
            remover: listaInteressesRemover
        },
        ConsultaIntegrada: {
            obter: consultaIntegradaObter,
            salvar: consultaIntegradaSalvar
        }
    };

    exibirLinkAdminNoMenu();
    exibirLinkSolucoesIANoMenu();
    conectarBotaoTema();
    exibirUnidadeNoHeader();
    iniciarMonitorInatividade();
    restringirAcessoPorPagina();
    restringirNivelCopom();
    restringirNivelOperadorCampo();
    injetarXerife();
})(window);
