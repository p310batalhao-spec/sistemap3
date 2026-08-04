// ════════════════════════════════════════════════════════════════════
// XERIFE — assistente de dados da unidade logada
// Carregado sob demanda (1º clique no botão flutuante, ver
// js/core/session.js → injetarXerife). NÃO é uma IA de terceiros: é um
// interpretador de perguntas em português que reconhece categoria +
// período + cidade e calcula a resposta direto dos dados reais da
// unidade (Firebase/GAS) — nada sai do navegador, sem custo, sem chave
// de API exposta.
//
// A regra de MVI é a MESMA usada em js/index.js e js/dashboard-cruzado.js
// (ano/período + HOMICÍDIO sem "tentativa" OU tentativa com OBITO="S").
// Se precisar mudar esse critério, mudar nos três lugares.
// ════════════════════════════════════════════════════════════════════

(function () {
    'use strict';
    if (window.Xerife) return; // já carregado (2º clique reaproveita)

    let DATABASE_URL = null;
    let APPS_SCRIPT_TCO_URL = null;
    let APPS_SCRIPT_MATERIAIS_URL = null;
    let APPS_SCRIPT_SENTENCAS_URL = null;
    let configCarregada = null; // promise, evita disparar loadUnidadeConfig() em paralelo

    // ── Helpers de dados (mesmas convenções do resto do sistema) ──────
    function NORM(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim(); }
    function CAMPO(item, ...chaves) {
        for (const k of chaves) { const v = item[k]; if (v !== undefined && v !== null && v !== '') return String(v); }
        return '';
    }
    function parseData(str) {
        if (!str) return null;
        const s = String(str).trim();
        if (!s || s === '---') return null;
        let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) { const d = new Date(+m[1], +m[2] - 1, +m[3]); return isNaN(d) ? null : d; }
        m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (m) { const d = new Date(+m[3], +m[2] - 1, +m[1]); return isNaN(d) ? null : d; }
        const d = new Date(s);
        return isNaN(d.getTime()) ? null : d;
    }
    function isMVI(item) {
        const tip = NORM(CAMPO(item, 'TIPIFICACAO_GERAL', 'TIPIFICACAO'));
        const ehHomicidio = tip.includes('HOMICIDIO') && !tip.includes('TENTATIVA');
        const ehTentativa = tip.includes('TENTATIVA');
        const temObito = NORM(item.OBITO) === 'S';
        return ehHomicidio || (ehTentativa && temObito);
    }
    const TERMOS_CVP = ['ROUBO', 'FURTO', 'TENTATIVA DE ROUBO', 'TENTATIVA DE FURTO', 'ESTELIONATO', 'DANO', 'LATROCINIO', 'EXTORSAO', 'APROPRIACAO'];
    function isCVP(item) { const t = NORM(CAMPO(item, 'TIPIFICACAO_GERAL', 'TIPIFICACAO')); return TERMOS_CVP.some(x => t.includes(x)); }
    function movBase(mov) { return String(mov || '').replace(/\s*\([^)]*\)\s*$/, '').trim(); }

    async function garantirConfig() {
        if (DATABASE_URL) return;
        if (!configCarregada) configCarregada = P3.loadUnidadeConfig().then(cfg => {
            DATABASE_URL = cfg.firebase.databaseURL;
            APPS_SCRIPT_TCO_URL = cfg.gas.TCO;
            APPS_SCRIPT_MATERIAIS_URL = cfg.gas.MATERIAIS;
            APPS_SCRIPT_SENTENCAS_URL = cfg.gas.SENTENCAS;
        });
        await configCarregada;
    }

    // Timeout pra QUALQUER fetch feito por este módulo — sem isso, uma
    // Apps Script externa lenta/travada (já visto nesta mesma planilha em
    // outro contexto — ver comentário de obterGuarnicoesPlanilha em
    // js/cumprimento-core.js) prende `fetch()` indefinidamente, o que por
    // sua vez trava Promise.all() pra sempre — ex.: montarCasosMilitaresTCO()
    // (usada por obterRelatorioCidade(), que alimenta a apresentação em
    // slides do dashboard JARVIS) ficava "Montando apresentação…" pra
    // sempre se a Apps Script de TCO ou Sentenças não respondesse. 20s é
    // generoso o bastante pro cold-start típico de Apps Script, sem deixar
    // a tela travada por tempo indefinido — o try/catch de cada chamador já
    // trata falha aqui como "essa parte fica null", nunca quebra o resto.
    async function fetchComTimeout(url, opts, timeoutMs) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs || 20000);
        try {
            return await fetch(url, Object.assign({}, opts, { signal: controller.signal }));
        } finally {
            clearTimeout(timer);
        }
    }

    const NODE_CACHE = {};
    async function fetchNode(node) {
        await garantirConfig();
        if (NODE_CACHE[node]) return NODE_CACHE[node];
        const resp = await fetchComTimeout(`${DATABASE_URL}/${node}.json`);
        const dados = resp.ok ? await resp.json() : null;
        const lista = dados ? Object.values(dados) : [];
        NODE_CACHE[node] = lista;
        return lista;
    }
    async function fetchTCO() {
        await garantirConfig();
        if (NODE_CACHE.__tco) return NODE_CACHE.__tco;
        const resp = await fetchComTimeout(`${APPS_SCRIPT_TCO_URL}?action=getTCO`, { redirect: 'follow' });
        const json = await resp.json();
        const lista = Array.isArray(json) ? json : [];
        NODE_CACHE.__tco = lista;
        return lista;
    }
    // Materiais apreendidos em guarda (bens/armas/objetos depositados) —
    // mesma planilha/GAS usada em page/materiais.html (js/materiais.js).
    // Campos: IDMaterial, N° DO BOU, DATA, CATEGORIA, DESCRIÇÃO, LOCAL (=
    // guarda/depósito), DATA DE DEPOSITO, ESAJ, STATUS.
    async function fetchMateriais() {
        await garantirConfig();
        if (NODE_CACHE.__materiais) return NODE_CACHE.__materiais;
        const resp = await fetchComTimeout(`${APPS_SCRIPT_MATERIAIS_URL}?action=read`, { redirect: 'follow' });
        const json = await resp.json();
        const lista = Array.isArray(json) ? json : [];
        NODE_CACHE.__materiais = lista;
        return lista;
    }
    // Sentenças/decisões judiciais dos TCOs — mesma planilha/GAS usada em
    // page/qualitativo_tco.html (aba Sentenças/Aceitabilidade). Campos: Nº
    // Processo, Resultado, Motivo do Arquivamento, Erro – Atipicidade
    // Material/Formal, Tipificação, Comarca (campo de verdade, direto — ao
    // contrário do TCO, que não tem cidade/comarca própria), Indiciado,
    // Data da Sentença, Ano da Sentença.
    async function fetchSentencas() {
        await garantirConfig();
        if (NODE_CACHE.__sentencas) return NODE_CACHE.__sentencas;
        const resp = await fetchComTimeout(`${APPS_SCRIPT_SENTENCAS_URL}?action=listarSentencas`, { redirect: 'follow' });
        const json = await resp.json();
        const lista = Array.isArray(json) ? json : [];
        NODE_CACHE.__sentencas = lista;
        return lista;
    }
    // Guarnição por boletim — nó /guarnicao do Firebase, MESMO padrão de
    // page/qualitativo_tco.html: ao contrário dos outros nós (lista de
    // registros com push-id), aqui a própria chave do objeto já É o
    // boletim, e o valor é um array (ou objeto) de integrantes
    // {POSTO_GRADUACAO/NOME_GUERRA ou 'Posto / Graduação'/'Nome de guerra'}.
    async function fetchGuarnicao() {
        await garantirConfig();
        if (NODE_CACHE.__guarnicao) return NODE_CACHE.__guarnicao;
        const resp = await fetchComTimeout(`${DATABASE_URL}/guarnicao.json`);
        const dados = resp.ok ? await resp.json() : null;
        const guarPorBoletim = {};
        if (dados && typeof dados === 'object') {
            Object.entries(dados).forEach(([boletim, val]) => {
                const arr = Array.isArray(val) ? val : Object.values(val || {});
                guarPorBoletim[boletim] = arr.filter(Boolean);
            });
        }
        NODE_CACHE.__guarnicao = guarPorBoletim;
        return guarPorBoletim;
    }

    // ════════════════════════════════════════════════════════════════
    // IA LOCAL (WebLLM / WebGPU) — 100% no navegador, nenhum dado sai da
    // máquina, sem chave de API, sem servidor. Baixa o modelo em segundo
    // plano assim que este script carrega (não espera o clique no chat).
    //
    // IMPORTANTE — por que a IA não calcula números sozinha: um modelo de
    // 1B parâmetros rodando em q4 é ótimo pra entender linguagem natural e
    // escrever bem, mas é ruim em aritmética exata sobre listas grandes —
    // arriscaria "inventar" contagens/percentuais, o que quebraria a
    // promessa central do Xerife ("não invento nada"). Por isso a IA só
    // ENTENDE a pergunta e REDIGE a resposta; todo número que ela usa vem
    // pronto (já calculado em JS determinístico) no contexto que a gente
    // manda pra ela — ver responderComIA()/montarDossie*() mais abaixo.
    // ════════════════════════════════════════════════════════════════
    const MODELO_LLM = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';
    let llmEngine = null;
    let llmEstado = 'verificando'; // verificando | baixando | pronto | indisponivel | erro
    let llmProgresso = 0;

    function suportaWebGPU() { return typeof navigator !== 'undefined' && !!navigator.gpu; }

    async function iniciarWebLLM() {
        if (!suportaWebGPU()) { llmEstado = 'indisponivel'; atualizarBadgeIA(); return; }
        llmEstado = 'baixando';
        atualizarBadgeIA();
        try {
            // Importa do VENDOR LOCAL (js/vendor/), não do CDN — testado e
            // confirmado que um Service Worker do tipo module falha o
            // registro ("ServiceWorker cannot be started") ao importar uma
            // biblioteca de origem CRUZADA (ex.: https://esm.run/...); a
            // MESMA biblioteca importada de um arquivo local (mesma
            // origem) registra normalmente. Por isso a página e o Service
            // Worker (ver xerife-sw.js) importam o mesmo arquivo vendorizado
            // — necessário pra persistência funcionar, e também evita uma
            // segunda cópia (CDN) da biblioteca sendo baixada à toa.
            // import() dinâmico DENTRO DE UM <script> CLÁSSICO (não-module,
            // como js/xerife.js é carregado) resolve caminho relativo em
            // relação à URL do PRÓPRIO SCRIPT (js/xerife.js), não à página
            // que o incluiu — por isso NÃO usa o mesmo "prefixo" baseado em
            // location.pathname que o resto do arquivo usa (isso gerava
            // ".../js/js/vendor/..." duplicado, 404). Como js/vendor/ fica
            // dentro da MESMA pasta de js/xerife.js, o caminho certo é
            // sempre "./vendor/...", em qualquer página do sistema.
            const webllm = await import('./vendor/web-llm-0.2.84.esm.js');
            const progressCb = (info) => {
                llmProgresso = Math.round((info && info.progress || 0) * 100);
                atualizarBadgeIA();
            };

            // Mantém a IA viva num Service Worker — assim ela carrega só
            // UMA VEZ e sobrevive a recarregar a página ou navegar pra
            // outra (ver xerife-sw.js). Se der qualquer problema (navegador
            // sem suporte, biblioteca sem esse recurso etc.), cai pro modo
            // "carrega só nesta página" de antes, sem quebrar o Xerife.
            // register() (ao contrário do import() acima) resolve relativo
            // à PÁGINA, não ao script — por isso usa o prefixo baseado em
            // location.pathname aqui, igual o resto do arquivo já fazia.
            if ('serviceWorker' in navigator && webllm.CreateServiceWorkerMLCEngine) {
                try {
                    const prefixo = /\/(page|relatorios|public|termos)\//.test(location.pathname) ? '../' : '';
                    await navigator.serviceWorker.register(prefixo + 'xerife-sw.js', { type: 'module' });
                    await navigator.serviceWorker.ready;
                    // clients.claim() (ver xerife-sw.js) assume o controle
                    // da aba atual sem precisar de reload, mas isso ainda é
                    // ASSÍNCRONO — no 1º registro (aba ainda não controlada
                    // quando "ready" resolve), CreateServiceWorkerMLCEngine
                    // falharia com "There is no active service worker" sem
                    // esperar o evento "controllerchange" chegar primeiro.
                    if (!navigator.serviceWorker.controller) {
                        await new Promise(resolve => {
                            navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
                            setTimeout(resolve, 3000); // failsafe — segue mesmo se o evento não vier
                        });
                    }
                    // Watchdog — mesma classe de trava já vista nesta sessão
                    // (fetch a Apps Script e Web Speech API que ficavam
                    // penduradas pra sempre, sem erro nem progresso
                    // nenhum): se NENHUM tick de progresso chegar em
                    // TIMEOUT_SW_SEM_PROGRESSO_MS, trata como travado e cai
                    // pro modo direto (sem service worker), em vez de ficar
                    // preso em "0%" indefinidamente. Uma vez que o
                    // progresso começa a se mover (mesmo 1%), o watchdog
                    // NUNCA mais interfere — download real de modelo grande
                    // pode legitimamente demorar bastante, e queremos deixar.
                    const TIMEOUT_SW_SEM_PROGRESSO_MS = 15000;
                    let houveProgresso = false;
                    const progressComWatchdog = (info) => { houveProgresso = true; progressCb(info); };
                    const criacaoSw = webllm.CreateServiceWorkerMLCEngine(MODELO_LLM, { initProgressCallback: progressComWatchdog });
                    const corrida = await Promise.race([
                        criacaoSw.then(engine => ({ ok: true, engine })),
                        new Promise(resolve => setTimeout(() => resolve({ ok: false }), TIMEOUT_SW_SEM_PROGRESSO_MS)),
                    ]);
                    if (corrida.ok) {
                        llmEngine = corrida.engine;
                    } else if (houveProgresso) {
                        // Já tinha progresso real rolando, só não tinha
                        // terminado ainda dentro do prazo — não é trava, é
                        // só demorado (normal). Continua esperando a MESMA
                        // promise original (nunca reinicia do zero).
                        llmEngine = await criacaoSw;
                    } else {
                        throw new Error(`service worker da IA sem nenhum progresso em ${TIMEOUT_SW_SEM_PROGRESSO_MS / 1000}s — provável trava`);
                    }
                } catch (eSw) {
                    console.warn('Xerife: service worker da IA indisponível/travado, carregando só nesta página.', eSw);
                    llmEngine = await webllm.CreateMLCEngine(MODELO_LLM, { initProgressCallback: progressCb });
                }
            } else {
                llmEngine = await webllm.CreateMLCEngine(MODELO_LLM, { initProgressCallback: progressCb });
            }

            llmEstado = 'pronto';
            llmProgresso = 100;
            atualizarBadgeIA();
        } catch (e) {
            console.error('Xerife: não foi possível carregar a IA local — seguindo em modo regras.', e);
            llmEngine = null;
            llmEstado = 'erro';
            atualizarBadgeIA();
        }
    }
    iniciarWebLLM(); // dispara em segundo plano assim que o script é carregado, sem depender do clique

    function atualizarBadgeIA() {
        const el = document.getElementById('xerife-status-ia');
        if (!el) return; // painel do chat ainda não foi aberto — assume o estado atual quando abrir
        const infoPorEstado = {
            verificando: { cor: '#9e9e9e', texto: 'Verificando IA local…' },
            baixando: { cor: '#f1c40f', texto: `🟡 Carregando IA local… ${llmProgresso}%` },
            pronto: { cor: '#2ecc71', texto: '🟢 Xerife IA pronto' },
            indisponivel: { cor: '#e74c3c', texto: '🔴 WebGPU indisponível (modo regras)' },
            erro: { cor: '#e74c3c', texto: '🔴 IA local indisponível (modo regras)' },
        };
        const info = infoPorEstado[llmEstado] || infoPorEstado.verificando;
        el.innerHTML = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${info.cor};margin-right:4px;flex-shrink:0;"></span>${info.texto}`;
    }

    // ── Categorias que o Xerife entende ────────────────────────────────
    // "nomes" são os apelidos que o usuário pode digitar pra apontar essa
    // categoria — checados em ordem, o primeiro que aparecer na pergunta
    // vence (por isso termos mais específicos vêm antes dos genéricos).
    const CATEGORIAS = {
        mvicvli: {
            // Nomes por extenso adicionados a pedido explícito do usuário —
            // "mvi" = mortes violentas intencionais, "cvli" = crimes
            // violentos letais intencionais. Antes só tinha a forma
            // SINGULAR ("morte violenta"), que não batia com a pergunta
            // real do usuário no PLURAL ("mortes violentas intencionais")
            // por ser um includes() de substring exato — "mortes" (plural)
            // não contém "morte" (singular) como substring seguido de
            // espaço, então nunca casava.
            nomes: [
                'mvi', 'cvli',
                'morte violenta', 'mortes violentas',
                'morte intencional', 'mortes intencionais',
                'morte violenta intencional', 'mortes violentas intencionais',
                'crime violento letal intencional', 'crimes violentos letais intencionais',
                'homicidio', 'feminicidio', 'assassinato',
            ],
            label: 'CVLI (Crimes Violentos Letais Intencionais)',
            fetch: () => fetchNode('geral'),
            filtroBase: i => { const t = NORM(CAMPO(i, 'TIPIFICACAO_GERAL', 'TIPIFICACAO')); return t.includes('HOMICIDIO') || t.includes('FEMINI'); },
            campoData: i => CAMPO(i, 'DATA', 'data'), campoCidade: i => CAMPO(i, 'CIDADE'), campoBairro: i => CAMPO(i, 'BAIRRO'), campoTip: i => CAMPO(i, 'TIPIFICACAO_GERAL', 'TIPIFICACAO') || 'não informado',
            campoNome: i => CAMPO(i, 'SOLICITANTE'), labelNome: 'solicitante',
            campoStatus: i => CAMPO(i, 'SOLUCAO', 'SOLUÇÃO') || 'não informado',
        },
        cvp: {
            // "cpp" incluído como sinônimo de "cvp" a pedido do usuário —
            // não existe categoria/nó de dados separado pra "crimes contra
            // o patrimônio" (sem "violentos") no sistema, então mapeia pra
            // esta mesma categoria (a única fonte real desse dado).
            nomes: [
                'cvp', 'cpp',
                'crime violento contra o patrimonio', 'crimes violentos contra o patrimonio',
                'crime contra o patrimonio', 'crimes contra o patrimonio',
                'roubo', 'furto', 'patrimonio', 'extorsao', 'latrocinio',
            ],
            label: 'CVP (Crimes Violentos contra o Patrimônio)',
            fetch: () => fetchNode('cvp'),
            filtroBase: isCVP,
            campoData: i => CAMPO(i, 'DATA', 'data'), campoCidade: i => CAMPO(i, 'CIDADE'), campoBairro: i => CAMPO(i, 'BAIRRO'), campoTip: i => CAMPO(i, 'TIPIFICACAO_GERAL', 'TIPIFICACAO') || 'não informado',
            campoNome: i => CAMPO(i, 'SOLICITANTE', 'AUTOR'), labelNome: 'solicitante',
            campoStatus: i => CAMPO(i, 'SOLUCAO', 'SOLUÇÃO') || 'não informado',
        },
        tco: {
            nomes: ['tco', 'termo circunstanciado', 'termo circunstanciado de ocorrencia'],
            label: 'TCO',
            fetch: () => fetchTCO(),
            filtroBase: () => true,
            campoData: i => CAMPO(i, 'DATA'), campoCidade: null, campoBairro: null, campoTip: i => CAMPO(i, 'Tipicidade Geral', 'TIPIFICACAO') || 'não informado',
            campoStatus: i => movBase(CAMPO(i, 'Movimentação', 'Movimentacao', 'MOVIMENTACAO')) || 'sem movimentação',
            campoNome: i => CAMPO(i, 'OPERADOR CAPA', 'Operador Capa', 'OPERADOR'), labelNome: 'policial/operador responsável',
        },
        armas: {
            nomes: ['arma', 'armas apreendidas', 'apreensao de arma'],
            label: 'Armas Apreendidas',
            fetch: () => fetchNode('arma'),
            filtroBase: () => true,
            campoData: i => CAMPO(i, 'DATA'), campoCidade: i => CAMPO(i, 'CIDADE'), campoBairro: i => CAMPO(i, 'BAIRRO'), campoTip: i => CAMPO(i, 'TIPO_ARMA') || 'não informado',
            campoNome: null, labelNome: null,
        },
        drogas: {
            nomes: ['droga', 'entorpecente', 'maconha', 'cocaina', 'crack', 'substancia'],
            label: 'Drogas Apreendidas',
            fetch: () => fetchNode('droga'),
            filtroBase: () => true,
            campoData: i => CAMPO(i, 'DATA'), campoCidade: i => CAMPO(i, 'CIDADE'), campoBairro: i => CAMPO(i, 'BAIRRO'), campoTip: i => CAMPO(i, 'TIPO_DROGA', 'TIPO') || 'não informado',
            // AUTOR/NOME DO AUTOR não existe de verdade no /droga desta
            // unidade (campos reais: BOLETIM, CIDADE, DATA, HORA, QUANTIDADE,
            // TIPO_DROGA, SOLICITANTE — este último é a guarnição, não o
            // autor) — fica como fallback inofensivo pra unidades que
            // eventualmente tenham esse campo; "com quem" de verdade usa
            // responderLocalizacaoDroga(), que cruza por boletim com /autor.
            campoNome: i => CAMPO(i, 'AUTOR', 'NOME DO AUTOR'), labelNome: 'autor',
            campoPeso: i => parseFloat(String(CAMPO(i, 'QUANTIDADE', 'PESO') || '0').replace(',', '.')) || 0,
            campoStatus: i => CAMPO(i, 'SOLUÇÃO', 'SOLUCAO') || 'não informado',
        },
        visita: {
            nomes: ['visita orientativa', 'visitas orientativas', 'visita'],
            label: 'Visita Orientativa',
            fetch: () => fetchNode('geral'),
            filtroBase: i => NORM(CAMPO(i, 'TIPIFICACAO_GERAL', 'TIPIFICACAO')).includes('VISITA'),
            campoData: i => CAMPO(i, 'DATA', 'data'), campoCidade: i => CAMPO(i, 'CIDADE'), campoBairro: i => CAMPO(i, 'BAIRRO'), campoTip: i => CAMPO(i, 'TIPIFICACAO_GERAL', 'TIPIFICACAO') || 'não informado',
            campoNome: i => CAMPO(i, 'NOME_AUTOR'), labelNome: 'autor',
            campoStatus: i => CAMPO(i, 'SOLUÇÃO', 'SOLUCAO') || 'não informado',
        },
        perturbacao: {
            nomes: ['perturbacao', 'sossego'],
            label: 'Perturbação do Sossego',
            fetch: () => fetchNode('sossego'),
            filtroBase: i => { const t = NORM(CAMPO(i, 'TIPIFICAÇÃO', 'TIPIFICACAO')); return t.includes('PERTURBACAO') && !t.includes('VISITA'); },
            campoData: i => CAMPO(i, 'DATA', 'data'), campoCidade: i => CAMPO(i, 'CIDADE'), campoBairro: i => CAMPO(i, 'BAIRRO'), campoTip: i => CAMPO(i, 'TIPIFICAÇÃO', 'TIPIFICACAO') || 'não informado',
            campoNome: i => CAMPO(i, 'SOLICITANTE'), labelNome: 'solicitante',
            campoStatus: i => CAMPO(i, 'SOLUÇÃO', 'SOLUCAO') || 'não informado',
        },
        violencia: {
            nomes: ['violencia domestica', 'violencia contra mulher', ' vd '],
            label: 'Violência Doméstica',
            fetch: () => fetchNode('violencia_domestica'),
            filtroBase: i => { const t = NORM(CAMPO(i, 'TIPIFICAÇÃO', 'TIPIFICACAO')); return t.includes('VIOLENCIA') && !t.includes('VISITA'); },
            campoData: i => CAMPO(i, 'DATA', 'data'), campoCidade: i => CAMPO(i, 'CIDADE'), campoBairro: i => CAMPO(i, 'BAIRRO'), campoTip: i => CAMPO(i, 'TIPIFICAÇÃO', 'TIPIFICACAO') || 'não informado',
            campoStatus: i => CAMPO(i, 'SOLUÇÃO DA OCORRÊNCIA', 'SOLUÇÃO', 'SOLUCAO') || 'não informado',
            campoNome: i => CAMPO(i, 'SOLICITANTE'), labelNome: 'solicitante',
        },
    };

    function detectarCategoria(q) {
        for (const chave of Object.keys(CATEGORIAS)) {
            if (CATEGORIAS[chave].nomes.some(nome => q.includes(NORM(nome)))) return chave;
        }
        return null;
    }
    // Todas as categorias citadas (não só a 1ª) — usado no resumo, pra filtrar
    // "resumo de MVI e CVP" pra só essas duas em vez das 7 categorias padrão.
    function detectarCategoriasMultiplas(q) {
        return Object.keys(CATEGORIAS).filter(chave => CATEGORIAS[chave].nomes.some(nome => q.includes(NORM(nome))));
    }

    // ── Período ──────────────────────────────────────────────────────
    // Sem acento — usado pra CASAR com a pergunta (já normalizada/sem acento).
    const MESES_NOME = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    // Com acento — só pra EXIBIR na resposta (mesmo índice de MESES_NOME).
    const MESES_EXIBICAO = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    // Todos os anos (repetidos ou não) citados na pergunta, na ordem em que aparecem.
    function detectarAnos(q) { return (q.match(/\b20\d{2}\b/g) || []).map(Number); }
    // "de janeiro a julho", "entre março e junho", "janeiro até julho" — um
    // intervalo de meses (mesmo ano). Não confundir com "janeiro e 2026"
    // (mês + ano, não dois meses) — por isso exige que a 2ª palavra também
    // seja um nome de mês.
    function detectarIntervaloMeses(q) {
        const alt = MESES_NOME.join('|');
        const re = new RegExp('\\b(' + alt + ')\\b\\s*(?:a|ate|e)\\s*\\b(' + alt + ')\\b');
        const m = q.match(re);
        if (!m) return null;
        const i1 = MESES_NOME.indexOf(m[1]);
        const i2 = MESES_NOME.indexOf(m[2]);
        if (i1 === -1 || i2 === -1 || i1 === i2) return null;
        return i1 <= i2 ? { i1, i2 } : { i1: i2, i2: i1 };
    }
    // anoForcado: usado pra recalcular o MESMO período pedido só que num ano
    // diferente (comparação explícita entre dois anos citados — ver processarPergunta).
    function detectarPeriodo(q, anoForcado) {
        const hoje = new Date();
        const inicioDia = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const fimDia = d => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

        if (!anoForcado) {
            if (q.includes('hoje')) { const d = inicioDia(hoje); return { label: 'hoje', ini: d, fim: fimDia(hoje) }; }
            if (q.includes('ontem')) { const d = new Date(hoje); d.setDate(d.getDate() - 1); return { label: 'ontem', ini: inicioDia(d), fim: fimDia(d) }; }
            if (q.includes('esta semana') || q.includes('essa semana')) {
                const ini = new Date(hoje); ini.setDate(hoje.getDate() - hoje.getDay());
                return { label: 'esta semana', ini: inicioDia(ini), fim: fimDia(hoje) };
            }
            if (q.includes('mes passado') || q.includes('mes anterior')) {
                const d = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
                const fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0, 23, 59, 59, 999);
                return { label: 'no mês passado', ini: d, fim };
            }
            if (q.includes('este mes') || q.includes('esse mes') || q.includes('mes atual')) {
                return { label: 'este mês', ini: new Date(hoje.getFullYear(), hoje.getMonth(), 1), fim: fimDia(hoje) };
            }
            if (q.includes('ano passado') || q.includes('ano anterior')) {
                return { label: 'no ano passado', ini: new Date(hoje.getFullYear() - 1, 0, 1), fim: new Date(hoje.getFullYear() - 1, 11, 31, 23, 59, 59, 999) };
            }
        }

        // "de janeiro a julho de 2025" — intervalo de meses, checado antes do
        // mês único (senão só "janeiro" seria capturado e "a julho" ignorado).
        const intervalo = detectarIntervaloMeses(q);
        if (intervalo) {
            const anos = detectarAnos(q);
            const ano = anoForcado || anos[0] || hoje.getFullYear();
            return { label: `de ${MESES_EXIBICAO[intervalo.i1]} a ${MESES_EXIBICAO[intervalo.i2]} de ${ano}`, ini: new Date(ano, intervalo.i1, 1), fim: new Date(ano, intervalo.i2 + 1, 0, 23, 59, 59, 999) };
        }

        // "primeiro semestre", "1º semestre", "segundo semestre", "2º semestre"
        const semestre = q.match(/\b(1|primeiro|2|segundo)[oº]?\s*semestre\b/);
        if (semestre) {
            const eh1 = semestre[1] === '1' || semestre[1] === 'primeiro';
            const anos = detectarAnos(q);
            const ano = anoForcado || anos[0] || hoje.getFullYear();
            const mesIni = eh1 ? 0 : 6;
            return { label: `${eh1 ? '1º' : '2º'} semestre de ${ano}`, ini: new Date(ano, mesIni, 1), fim: new Date(ano, mesIni + 6, 0, 23, 59, 59, 999) };
        }

        // "mês de julho de 2025", "julho/2025", "em julho" — o mês, quando
        // citado, tem prioridade; se um ano também aparecer na frase, usa
        // esse ano em vez do atual (checado ANTES do "ano sozinho" abaixo,
        // senão "julho de 2025" cairia só no filtro do ano inteiro).
        for (let i = 0; i < MESES_NOME.length; i++) {
            // \b evita falso positivo tipo "maior"/"maiores" batendo com o mês "maio"
            if (new RegExp('\\b' + MESES_NOME[i] + '\\b').test(q)) {
                const anoNaFrase = detectarAnos(q)[0];
                const ano = anoForcado || anoNaFrase || hoje.getFullYear();
                return { label: `em ${MESES_EXIBICAO[i]} de ${ano}`, ini: new Date(ano, i, 1), fim: new Date(ano, i + 1, 0, 23, 59, 59, 999) };
            }
        }
        const anoExplicito = anoForcado || detectarAnos(q)[0];
        if (anoExplicito) { return { label: 'em ' + anoExplicito, ini: new Date(anoExplicito, 0, 1), fim: new Date(anoExplicito, 11, 31, 23, 59, 59, 999) }; }

        if (q.includes('este ano') || q.includes('esse ano') || q.includes('ano atual') || q.includes('ano corrente')) {
            return { label: 'este ano', ini: new Date(hoje.getFullYear(), 0, 1), fim: fimDia(hoje) };
        }
        // padrão: ano corrente até hoje (mesmo critério usado no resto do sistema)
        return { label: 'este ano', ini: new Date(hoje.getFullYear(), 0, 1), fim: fimDia(hoje), implicito: true };
    }

    // ── Cidade — comparado contra as cidades que realmente aparecem nos
    // dados da categoria (evita bater com uma cidade de outra unidade).
    // Duas passadas: 1) nome completo (mais preciso); 2) só a primeira
    // palavra significativa do nome (cobre nome digitado incompleto, tipo
    // "Palmeira" → "Palmeira dos Índios" — sem isso a 1ª passada nunca bate,
    // porque é a cidade inteira que precisa estar CONTIDA na pergunta). ──
    function melhorCidadeMatch(q, cidadesSet) {
        const ordenadas = Array.from(cidadesSet).sort((a, b) => b.length - a.length);
        for (const cidade of ordenadas) {
            if (q.includes(NORM(cidade))) return cidade;
        }
        for (const cidade of ordenadas) {
            const primeira = NORM(cidade).split(' ')[0];
            if (primeira.length >= 4 && new RegExp('\\b' + primeira + '\\b').test(q)) return cidade;
        }
        return null;
    }
    function detectarCidade(q, lista, cat) {
        if (!cat.campoCidade) return null;
        const cidades = new Set();
        lista.forEach(i => { const c = cat.campoCidade(i); if (c) cidades.add(c); });
        return melhorCidadeMatch(q, cidades);
    }
    // Mesma ideia de detectarCidade, mas por BAIRRO — permite filtrar a
    // contagem normal por bairro (ex.: "quantos mvi no Centro este ano?"),
    // não só o ranking de bairros que já existia (ehTopBairroCategoria).
    function detectarBairro(q, lista, cat) {
        if (!cat.campoBairro) return null;
        const bairros = new Set();
        lista.forEach(i => { const b = cat.campoBairro(i); if (b) bairros.add(b); });
        return melhorCidadeMatch(q, bairros); // mesmo algoritmo de match (nome completo, depois 1ª palavra)
    }

    function topEntries(lista, campoFn, n) {
        const cont = {};
        lista.forEach(i => { const v = campoFn(i); if (v) cont[v] = (cont[v] || 0) + 1; });
        return Object.entries(cont).sort((a, b) => b[1] - a[1]).slice(0, n || 5);
    }

    // ── Variação entre dois valores — ÚNICA fórmula usada em todo comparativo
    // do Xerife (evita as duas versões divergentes que existiam antes).
    // diff = valorB - valorA. diff>0 alta, diff<0 queda, diff===0 estabilidade.
    // percVar = 100% quando parte de zero (convenção — de 0 pra qualquer coisa
    // positiva não tem "percentual" matemático real), 0% quando os dois são
    // zero (nesse caso não houve variação nenhuma, não faria sentido dizer "alta de 100%").
    function calcularVariacao(valorA, valorB) {
        const diff = valorB - valorA;
        const tendencia = diff > 0 ? 'alta' : diff < 0 ? 'queda' : 'estabilidade';
        const percVar = (valorA === 0 && valorB === 0) ? 0 : (valorA === 0 ? 100 : Math.round(Math.abs(diff) / valorA * 100));
        return { diff, tendencia, percVar };
    }

    // Todos os meses (ano+mês) entre periodo.ini e periodo.fim, inclusive.
    function listarMesesDoPeriodo(periodo) {
        const meses = [];
        let cursor = new Date(periodo.ini.getFullYear(), periodo.ini.getMonth(), 1);
        const fimMes = new Date(periodo.fim.getFullYear(), periodo.fim.getMonth(), 1);
        while (cursor <= fimMes) {
            meses.push({ ano: cursor.getFullYear(), mes: cursor.getMonth() });
            cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
        }
        return meses;
    }

    // ── Intenções ────────────────────────────────────────────────────
    // Recebem o texto já em minúsculas (ver processarPergunta) — NORM() deixa
    // tudo maiúsculo (bom pra comparar com CAMPO/TIPIFICACAO), então essas
    // checagens de intenção usam sua própria versão em minúsculas.
    function ehSaudacao(q) { return /^(oi|ola|opa|eae|e ai|bom dia|boa tarde|boa noite)\b/.test(q) || q.length < 4; }
    function ehAjuda(q) { return q.includes('ajuda') || q.includes('o que voce faz') || q.includes('o que voce sabe') || q.includes('comandos') || q.includes('como funciona'); }
    function ehResumo(q) { return q.includes('resumo') || q.includes('visao geral') || (q.includes('tudo') && q.includes('hoje')); }
    function ehMensal(q) { return q.includes('mes a mes') || q.includes('mensal') || q.includes('por mes') || q.includes('mes por mes'); }
    function ehTop(q) {
        return q.includes('qual a cidade') || q.includes('quais cidades') || q.includes('top ') || q.includes('mais ocorrencias') ||
            q.includes('cidade com mais') || q.includes('ranking') || q.includes('qual a comarca') || q.includes('quais comarcas') || q.includes('comarca com mais');
    }
    // "Comarca com mais arquivamentos" é específico de TCO (termo jurídico —
    // arquivamento é uma movimentação de TCO) e precisa de um cruzamento
    // próprio com /geral (TCO não tem campo de cidade), por isso não usa o
    // ehTop genérico acima.
    function ehComarcaArquivamentos(q) { return q.includes('comarca') && (q.includes('arquiv')); }
    // Checado ANTES de ehTop — "qual bairro" não deve cair no ranking de cidade.
    function ehTopBairroCategoria(q) { return q.includes('bairro') && (q.includes('mais') || q.includes('qual') || q.includes('quais') || q.includes('onde')); }
    function ehTipificacao(q) { return q.includes('tipificacao') || q.includes('tipo mais') || q.includes('mais comum'); }
    // Detalhamento de drogas por SUBSTÂNCIA + peso (g/kg) — diferente de
    // ehTipificacao, que só conta ocorrências; aqui soma quantidade apreendida.
    function ehDetalheDrogas(q) {
        return q.includes('peso') || q.includes('quantidade') || q.includes('gramas') || q.includes('kg') || q.includes('quilo') || q.includes('pesou') || q.includes('apreendid');
    }
    function ehTopStatus(q) { return q.includes('status') || q.includes('andamento') || q.includes('movimentacao') || q.includes('situacao dos') || q.includes('decisoes') || q.includes('providencias'); }
    function ehTopPessoa(q) {
        return q.includes('qual autor') || q.includes('quais autores') || q.includes('quem mais') || q.includes('quem lavrou') ||
            q.includes('quem registrou') || q.includes('operador que mais') || q.includes('policial que mais') ||
            q.includes('responsavel por mais') || (q.includes('autor') && q.includes('mais')) || (q.includes('operador') && q.includes('mais'));
    }
    function ehComparativo(q) {
        return q.includes('comparat') || q.includes('compara') || q.includes(' vs ') || q.includes('em relacao a') ||
            q.includes('com relacao a') || q.includes('referente a') || q.includes('aumento ou queda') || q.includes('queda ou aumento') ||
            q.includes('houve aumento') || q.includes('houve queda') || q.includes('teve aumento') || q.includes('teve queda') ||
            (q.includes('aumento') && q.includes('queda'));
    }
    // "meta" (número-alvo definido pela chefia) não existe em lugar nenhum do
    // sistema — isso continua fora de escopo. "Previsão"/"predição" JÁ TEM
    // fonte real (js/analisePreditiva.js) e vira a intenção ehPrevisao abaixo.
    function ehForaDeEscopo(q) { return /\bmetas?\b/.test(q); }
    // Previsão pro próximo mês — delega pro mesmo modelo estatístico e critério
    // de MVI/CVLI/CVP usados em js/analisePreditiva.js (ver responderPrevisao).
    function ehPrevisao(q) {
        return q.includes('previsao') || q.includes('predi') || q.includes('projecao') || q.includes('projetar') ||
            q.includes('prever') || q.includes('proximo mes') || q.includes('mes que vem') || q.includes('mes seguinte') ||
            q.includes('analise preditiva');
    }
    // Horários/bairros críticos de uma cidade — mesma lógica de js/gerarcartao.js
    // (turnos manhã/tarde/noite, peso de gravidade cvli>droga>cvp>geral, 90 dias).
    function ehCriticidade(q) {
        return q.includes('critic') || q.includes('rota critica') || q.includes('hotspot') ||
            (q.includes('bairro') && (q.includes('horario') || q.includes('turno') || q.includes('perigos')));
    }
    // "Cadastrar/registrar evento" não é uma pergunta de dado (não tem
    // CATEGORIA em CATEGORIAS — Eventos é cadastro, não estatística) — sem
    // isso, cair no fallback genérico de categoria ("MVI/CVLI, CVP, TCO...")
    // confundia o usuário, já que Eventos nem aparece nessa lista.
    function ehCadastroEvento(q) {
        return q.includes('evento') && (q.includes('cadastr') || q.includes('registrar') || q.includes('registro') || q.includes('lancar') || q.includes('criar'));
    }
    // Produtividade do COPOM (quem mais atendeu/despachou) — mesma lógica de
    // js/dashboard-copom.js (campo item.atendente do nó /geral).
    function ehAtendenteCopom(q) {
        return q.includes('copom') || q.includes('atendente') || q.includes('despachante') ||
            (q.includes('atendeu') && q.includes('mais'));
    }
    // TCO — duas perguntas de "quem" bem diferentes (ver processarPergunta):
    //   "qual autor"           = cruzamento do nó /autor × TCO por boletim
    //                            (pessoa contra quem mais TCOs foram lavrados) — SEMPRE
    //                            vence quando a palavra "autor" aparece, mesmo que a frase
    //                            também tenha "lavrado(s)" (ex.: "autor com mais tcos lavrados").
    //   "quem lavrou/operador" = quem documentou o TCO (campo Operador Capa)
    function ehTopAutorTCO(q) {
        return q.includes('autor') || q.includes('autuado') || q.includes('reincidente') || q.includes('contra quem') || q.includes('contra si') || q.includes('contra ele') || q.includes('contra ela');
    }
    function ehTopOperadorTCO(q) {
        if (ehTopAutorTCO(q)) return false; // "autor" tem prioridade — ver acima
        return q.includes('lavrou') || q.includes('militar') || q.includes('operador') || q.includes('digitou') ||
            q.includes('documentou') || q.includes('quem registrou') || q.includes('policial que mais');
    }
    function periodoAnoAtual() {
        const hoje = new Date();
        return { label: 'no ano atual até hoje', ini: new Date(hoje.getFullYear(), 0, 1), fim: new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 23, 59, 59, 999) };
    }
    function normBoletim(v) { return String(v || '').replace(/\D/g, '').replace(/^0+/, ''); }

    // ── Memória de conversa ──────────────────────────────────────────
    // sessionStorage (não localStorage): sobrevive a recarregar a página ou
    // navegar pra outra dentro da MESMA aba, mas some quando a aba fecha —
    // e é limpo explicitamente no logout (ver js/core/session.js). A chave
    // inclui o CPF pra não misturar conversas se mais de um usuário logar
    // no mesmo navegador (computador compartilhado da unidade).
    function chaveHistorico() {
        const cpf = (typeof localStorage !== 'undefined' && localStorage.getItem('userCpf')) || 'anon';
        return 'p3_xerife_historico_' + cpf;
    }
    function carregarHistorico() {
        try { return JSON.parse(sessionStorage.getItem(chaveHistorico())) || []; }
        catch (e) { return []; }
    }
    function salvarHistorico(historico) {
        try { sessionStorage.setItem(chaveHistorico(), JSON.stringify(historico.slice(-12))); }
        catch (e) { /* sessionStorage indisponível/cheia — a conversa só não persiste, sem quebrar o chat */ }
    }
    function adicionarAoHistorico(pergunta, respostaHtml) {
        const h = carregarHistorico();
        h.push({ pergunta, respostaHtml });
        salvarHistorico(h);
    }
    // Versão em texto puro da resposta (sem tags) — usada só quando a
    // história vai pro modelo de IA como mensagens anteriores da conversa.
    function htmlParaTexto(html) {
        return String(html || '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<hr[^>]*>/gi, '\n---\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .trim();
    }
    // Cidade detectada contra os dados reais de várias listas combinadas —
    // usado por criticidade/COPOM, que não têm uma única "categoria" fixa.
    function detectarCidadeEmListas(q, listas) {
        const cidades = new Set();
        listas.forEach(lista => lista.forEach(i => { const c = CAMPO(i, 'CIDADE'); if (c) cidades.add(c); }));
        return melhorCidadeMatch(q, cidades);
    }

    // ── Busca por identificador (CPF, boletim/ocorrência, processo/E-SAJ, nome) ──
    // Pesquisa qualitativa/cadastro: consulta direta em vez de estatística.
    function extrairIdentificador(qMin) {
        const cpf = qMin.match(/\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/);
        if (cpf) return { tipo: 'cpf', valor: cpf[1].replace(/\D/g, '') };
        const processo = qMin.match(/\b(\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4})\b/);
        if (processo) return { tipo: 'processo', valor: processo[1].replace(/[^0-9]/g, '') };
        const boletim = qMin.match(/\b(?:boletim|ocorrencia|processo|bo|cop)\s*n?[ºo]?\s*[:\-]?\s*(\d{4,9})\b/);
        if (boletim) return { tipo: 'boletim', valor: boletim[1] };
        return null;
    }
    // Heurística de nome próprio: usa o texto ORIGINAL (antes do NORM, que já
    // deixou tudo maiúsculo) pra achar sequências de 2+ palavras capitalizadas
    // — só tenta se a pergunta claramente pede um nome ("nome de...", "quem é...").
    function extrairNomeProvavel(textoOriginal, qMin) {
        if (!qMin.includes('nome') && !qMin.includes('quem e') && !qMin.includes('quem é')) return null;
        const palavras = textoOriginal.replace(/[?.,;:!]/g, '').split(/\s+/);
        const candidatos = [];
        let atual = [];
        for (const p of palavras) {
            if (/^[A-ZÀ-Ú][a-zà-ú]+$/.test(p)) atual.push(p);
            else { if (atual.length >= 2) candidatos.push(atual.join(' ')); atual = []; }
        }
        if (atual.length >= 2) candidatos.push(atual.join(' '));
        return candidatos.sort((a, b) => b.length - a.length)[0] || null;
    }
    function ehConsultaIdentificador(qMin) {
        return qMin.includes('cpf') || qMin.includes('boletim') || qMin.includes('ocorrencia') || qMin.includes('processo') || qMin.includes('e-saj') || qMin.includes('esaj');
    }

    async function buscarPorCPF(cpf) {
        const autores = await fetchNode('autor');
        return autores.filter(a => normDigitos(CAMPO(a, 'CPF')) === cpf);
    }
    function normDigitos(v) { return String(v || '').replace(/\D/g, ''); }

    async function buscarPorNome(nome) {
        const autores = await fetchNode('autor');
        const alvo = NORM(nome);
        return autores.filter(a => NORM(CAMPO(a, 'NOME')).includes(alvo));
    }

    // ── Cruzamento TCO × Sentença × Materiais × Guarnição a partir de um
    // BOLETIM já conhecido — núcleo compartilhado entre o relatório por
    // boletim/processo E a busca por CPF/nome (que antes só mostrava a
    // linha do nó "autor" e não trazia TCO/movimentação/data/guarnição do
    // caso, mesmo quando o boletim encontrado tinha um TCO lavrado).
    async function coletarSecoesTCO(boletim) {
        const secoes = [];
        let tcos = [];
        try { tcos = await fetchTCO(); } catch (e) { /* GAS de TCO fora do ar — segue sem TCO */ }
        const tcoAchado = tcos.find(t => normBoletim(CAMPO(t, 'Nº Ocorrência')) === boletim);
        const esaj = tcoAchado ? normDigitos(CAMPO(tcoAchado, 'E-SAJ', 'ESAJ')) : null;

        if (tcoAchado) {
            secoes.push(`📋 <strong>TCO</strong>: boletim ${CAMPO(tcoAchado, 'Nº Ocorrência') || '—'}, E-SAJ ${CAMPO(tcoAchado, 'E-SAJ', 'ESAJ') || '—'}, ${CAMPO(tcoAchado, 'DATA') || '—'}, ${CAMPO(tcoAchado, 'Tipicidade Geral') || '—'}, movimentação: ${movBase(CAMPO(tcoAchado, 'Movimentação')) || '—'}, operador: ${CAMPO(tcoAchado, 'OPERADOR CAPA') || '—'}, material apreendido: ${CAMPO(tcoAchado, 'Material Apreendido') || '—'}`);
        }

        if (esaj) {
            try {
                const sentencas = await fetchSentencas();
                const achadasSentenca = sentencas.filter(r => normDigitos(CAMPO(r, 'Nº Processo')) === esaj);
                achadasSentenca.forEach(r => {
                    const motivoCanon = canonMotivoX(
                        CAMPO(r, 'Motivo do Arquivamento'), CAMPO(r, 'Resultado'),
                        CAMPO(r, 'Erro – Atipicidade Material', 'Erro - Atipicidade Material'),
                        CAMPO(r, 'Erro – Atipicidade Formal', 'Erro - Atipicidade Formal')
                    );
                    secoes.push(`⚖️ <strong>Sentença</strong>: resultado ${CAMPO(r, 'Resultado') || '—'}${motivoCanon ? ' (' + motivoCanon + ')' : ''}, comarca ${CAMPO(r, 'Comarca') || '—'}, data ${CAMPO(r, 'Data da Sentença') || '—'}, indiciado: ${CAMPO(r, 'Indiciado') || '—'}`);
                });
                // TCO já consta como arquivado/julgado no GAS, mas ainda não
                // tem sentença correspondente na planilha (falta importar em
                // "Importar do Gem", na Análise Qualitativa de TCO) — avisa em
                // vez de simplesmente omitir a seção calado, sem inventar dado.
                if (!achadasSentenca.length && tcoAchado) {
                    const movTco = NORM(CAMPO(tcoAchado, 'Movimentação', 'Movimentacao', 'MOVIMENTACAO')).toLowerCase();
                    if (movTco.includes('arquiv') || movTco.includes('julgado')) {
                        secoes.push(`⚖️ <strong>Sentença</strong>: ainda não importada na planilha de Sentenças (TCO consta como "${movBase(CAMPO(tcoAchado, 'Movimentação'))}" no GAS, mas sem sentença correspondente cadastrada — confira em "Importar do Gem" na Análise Qualitativa de TCO).`);
                    }
                }
            } catch (e) { /* GAS de sentenças fora do ar — ignora */ }
            try {
                const materiais = await fetchMateriais();
                materiais.filter(m => normDigitos(CAMPO(m, 'ESAJ')) === esaj).forEach(m => {
                    secoes.push(`📦 <strong>Material</strong>: ${CAMPO(m, 'CATEGORIA') || '—'} — ${CAMPO(m, 'DESCRIÇÃO') || '—'}, guarda: ${CAMPO(m, 'LOCAL') || '—'}, status: ${CAMPO(m, 'STATUS') || '—'}`);
                });
            } catch (e) { /* GAS de materiais fora do ar — ignora */ }
        }

        try {
            const guarPorBoletim = await fetchGuarnicao();
            let igs = guarPorBoletim[boletim] || [];
            if (!igs.length) {
                const chaveCrua = Object.keys(guarPorBoletim).find(k => normBoletim(k) === boletim);
                if (chaveCrua) igs = guarPorBoletim[chaveCrua];
            }
            const nomes = (igs || []).map(ig => {
                let posto = String(ig.POSTO_GRADUACAO || ig['Posto / Graduação'] || '').trim();
                if (posto === '---') posto = '';
                const nome = String(ig.NOME_GUERRA || ig['Nome de guerra'] || ig.NOME_COMPLETO || '').trim();
                return nome ? (posto ? posto + ' ' : '') + nome : null;
            }).filter(Boolean);
            if (nomes.length) secoes.push(`🎖️ <strong>Guarnição</strong>: ${nomes.join(', ')}`);
        } catch (e) { /* nó /guarnicao pode não existir — ignora */ }

        return secoes;
    }

    // Ocorrência original por BOLETIM, em qualquer um dos nós de registro —
    // enriquecido POR CATEGORIA quando o formato genérico não serve: /droga
    // não tem TIPIFICACAO_GERAL (o formato genérico ficava vazio pra ela) e
    // tem campos próprios (TIPO_DROGA, QUANTIDADE, SOLICITANTE, OBITO) que
    // valem a pena mostrar sempre. Compartilhado entre o relatório por
    // boletim/processo E a busca por CPF/nome — mesma info nos dois lugares.
    async function coletarSecoesOcorrencia(boletim) {
        const secoes = [];
        const nodes = { 'Geral (MVI/CVLI/Visita)': 'geral', 'CVP': 'cvp', 'Armas': 'arma', 'Drogas': 'droga', 'Perturbação do Sossego': 'sossego', 'Violência Doméstica': 'violencia_domestica' };
        for (const [label, node] of Object.entries(nodes)) {
            try {
                const bruto = await fetchNode(node);
                bruto.filter(i => normBoletim(CAMPO(i, 'BOLETIM', 'NUMEROOCORRENCIA')) === boletim).forEach(item => {
                    if (node === 'droga') {
                        const peso = parseFloat(String(CAMPO(item, 'QUANTIDADE', 'PESO') || '0').replace(',', '.')) || 0;
                        const hora = CAMPO(item, 'HORA', 'hora');
                        const obito = NORM(CAMPO(item, 'OBITO')) === 'S' ? ', com óbito' : '';
                        secoes.push(`📄 <strong>Drogas</strong>: ${CAMPO(item, 'TIPO_DROGA', 'TIPO') || 'tipo não informado'}${peso ? ', ' + formatarPesoDroga(peso) : ''}, ${CAMPO(item, 'DATA', 'data') || '—'}${hora ? ' às ' + hora : ''}, ${CAMPO(item, 'CIDADE') || '—'}${CAMPO(item, 'BAIRRO') ? '/' + CAMPO(item, 'BAIRRO') : ''}, solicitante: ${CAMPO(item, 'SOLICITANTE') || '—'}${obito}`);
                    } else {
                        secoes.push(`📄 <strong>${label}</strong>: ${CAMPO(item, 'TIPIFICACAO_GERAL', 'TIPIFICACAO', 'Tipicidade Geral') || '—'}, ${CAMPO(item, 'DATA', 'data') || '—'}, ${CAMPO(item, 'CIDADE') || '—'}${CAMPO(item, 'BAIRRO') ? '/' + CAMPO(item, 'BAIRRO') : ''}, status: ${CAMPO(item, 'SOLUÇÃO', 'SOLUCAO') || '—'}`);
                    }
                });
            } catch (e) { /* nó pode não existir nessa unidade — ignora */ }
        }
        return secoes;
    }

    // Cruza um NOME em todas as CATEGORIAS que têm campo de nome (autor/
    // solicitante/vítima) — mostra onde mais esse nome aparece registrado,
    // além do caso original sendo consultado. Pedido explícito do usuário:
    // "cruzamento também dos autores para mostrar onde os autores ou nomes
    // completos estão vinculados em ocorrências".
    async function cruzarNomeEmCategorias(nome, excluirBoletim) {
        const alvo = NORM(nome);
        if (!alvo) return [];
        const achados = [];
        for (const cat of Object.values(CATEGORIAS)) {
            if (!cat.campoNome) continue;
            try {
                const bruto = await cat.fetch();
                bruto.filter(cat.filtroBase).forEach(item => {
                    const nomeItem = cat.campoNome(item);
                    if (!nomeItem || !NORM(nomeItem).includes(alvo)) return;
                    const boletim = normBoletim(CAMPO(item, 'BOLETIM', 'NUMEROOCORRENCIA'));
                    if (excluirBoletim && boletim === excluirBoletim) return; // não repete o próprio caso já mostrado
                    achados.push({
                        categoria: cat.label, boletim: boletim || null,
                        data: cat.campoData ? cat.campoData(item) : null,
                        cidade: cat.campoCidade ? cat.campoCidade(item) : null,
                        tip: cat.campoTip ? cat.campoTip(item) : null,
                    });
                });
            } catch (e) { /* categoria pode falhar (GAS fora do ar etc.) — segue com as outras */ }
        }
        return achados;
    }
    // Verifica se um nome (ex.: autor de um TCO/boletim) é o MESMO nome de
    // uma ASSISTIDA (solicitante/vítima em violência doméstica) — pedido
    // explícito do usuário: só mostra o dossiê da assistida quando o
    // CONTEXTO exigir (autor de um caso batendo com uma assistida
    // cadastrada), nunca solto. Endereço/telefone entram quando existirem
    // nos registros de origem (decisão explícita do usuário — mais
    // completo, mesmo sendo dado de contato).
    async function verificarVinculoAssistida(nome) {
        const alvo = NORM(nome);
        if (!alvo) return null;
        let bruto = [];
        try { bruto = await fetchNode('violencia_domestica'); } catch (e) { return null; }
        const casos = bruto.filter(i => {
            const solicitante = CAMPO(i, 'SOLICITANTE');
            return solicitante && NORM(solicitante).includes(alvo);
        });
        if (!casos.length) return null;
        const nomeReal = CAMPO(casos[0], 'SOLICITANTE');
        const endereco = CAMPO(casos[0], 'ENDERECO', 'ENDEREÇO', 'LOGRADOURO');
        const telefone = CAMPO(casos[0], 'TELEFONE', 'CONTATO', 'CELULAR');
        return {
            nome: nomeReal, endereco: endereco || null, telefone: telefone || null,
            totalCasos: casos.length,
            casos: casos.slice(0, 5).map(c => ({
                boletim: CAMPO(c, 'BOLETIM', 'NUMEROOCORRENCIA') || null,
                data: CAMPO(c, 'DATA', 'data') || null,
                cidade: CAMPO(c, 'CIDADE') || null,
                status: CAMPO(c, 'SOLUÇÃO DA OCORRÊNCIA', 'SOLUÇÃO', 'SOLUCAO') || null,
            })),
        };
    }
    function montarBlocoAssistida(v) {
        const linhasCasos = v.casos.map(c => `&nbsp;&nbsp;• ${c.data || '—'}, boletim ${c.boletim || '—'}, ${c.cidade || '—'} — ${c.status || 'status não informado'}`).join('<br>');
        const contato = [v.endereco ? 'endereço: ' + escHtml(v.endereco) : null, v.telefone ? 'telefone: ' + escHtml(v.telefone) : null].filter(Boolean).join(' | ');
        return `🛡️ <strong>Contexto — Assistida (Violência Doméstica)</strong>: <strong>${escHtml(v.nome)}</strong> tem <strong>${v.totalCasos}</strong> caso(s) de violência doméstica vinculado(s) a esse nome.` +
            (contato ? `<br>${contato}` : '') +
            (linhasCasos ? `<br>${linhasCasos}` : '');
    }
    function montarBlocoCruzamentoNome(achados) {
        if (!achados.length) return '';
        const linhas = achados.slice(0, 8).map(a => `&nbsp;&nbsp;• <strong>${escHtml(a.categoria)}</strong>${a.boletim ? ', boletim ' + escHtml(a.boletim) : ''}, ${a.data || '—'}, ${a.cidade || '—'}${a.tip ? ' — ' + escHtml(a.tip) : ''}`).join('<br>');
        return `🔗 <strong>Esse nome também aparece em outras ${achados.length} ocorrência(s)</strong>:<br>${linhas}`;
    }

    // ── Relatório completo por BOLETIM/COP/BO ou processo/E-SAJ ─────────
    // Boletim e E-SAJ são as DUAS pontas da mesma chave (o TCO tem os dois
    // campos — Nº Ocorrência e E-SAJ), por isso, dado QUALQUER um dos dois,
    // dá pra achar o outro via TCO e cruzar TODOS os bancos que citam esse
    // caso: ocorrência original (geral/cvp/arma/droga/sossego/violência
    // doméstica), autor(es) envolvido(s), TCO, sentença/decisão judicial,
    // materiais em custódia (por E-SAJ) e guarnição que atendeu (Firebase
    // /guarnicao) — um "raio-x" único do caso inteiro, não só um nó isolado.
    async function montarRelatorioCompleto(identificador) {
        const alvoBoletim = identificador.tipo === 'boletim' ? normBoletim(identificador.valor) : null;
        const alvoEsaj = identificador.tipo === 'processo' ? normDigitos(identificador.valor) : null;

        let tcos = [];
        try { tcos = await fetchTCO(); } catch (e) { /* GAS de TCO fora do ar — segue sem TCO */ }

        const tcoAchado = tcos.find(t => {
            if (alvoBoletim && normBoletim(CAMPO(t, 'Nº Ocorrência')) === alvoBoletim) return true;
            if (alvoEsaj && normDigitos(CAMPO(t, 'E-SAJ', 'ESAJ')) === alvoEsaj) return true;
            return false;
        });
        const boletim = alvoBoletim || (tcoAchado ? normBoletim(CAMPO(tcoAchado, 'Nº Ocorrência')) : null);
        const esaj = alvoEsaj || (tcoAchado ? normDigitos(CAMPO(tcoAchado, 'E-SAJ', 'ESAJ')) : null);

        const secoes = [];

        if (boletim) {
            secoes.push(...await coletarSecoesOcorrencia(boletim));
            try {
                const autores = await fetchNode('autor');
                const autoresDoBoletim = autores.filter(a => normBoletim(CAMPO(a, 'BOLETIM')) === boletim);
                for (const a of autoresDoBoletim) {
                    const nomeAutor = CAMPO(a, 'NOME') || 'sem nome';
                    secoes.push(`👤 <strong>Autor/envolvido</strong>: ${nomeAutor}, ${CAMPO(a, 'NATUREZA') || CAMPO(a, 'TIPIFICACAO') || '—'}, situação: ${CAMPO(a, 'SITUACAO') || '—'}, ${CAMPO(a, 'CIDADE') || '—'}${CAMPO(a, 'BAIRRO') ? '/' + CAMPO(a, 'BAIRRO') : ''}, CPF: ${CAMPO(a, 'CPF') || '—'}`);
                    // Cruzamento contextual — pedido explícito do usuário:
                    // "caso eu peça para buscar algum boletim ou tco
                    // cadastrado em que o nome do autor seja o mesmo que
                    // esteja vinculado a assistida, aí pode apresentar os
                    // dados". Só aparece SE o nome bater com uma assistida
                    // real (violência doméstica) — nunca solto.
                    if (nomeAutor && nomeAutor !== 'sem nome') {
                        try {
                            const vinculoAssistida = await verificarVinculoAssistida(nomeAutor);
                            if (vinculoAssistida) secoes.push(montarBlocoAssistida(vinculoAssistida));
                        } catch (e) { /* cruzamento é um extra — nunca quebra o relatório principal */ }
                        // "Cruzamento também dos autores para mostrar onde
                        // os autores ou nomes completos estão vinculados em
                        // ocorrências" — pedido explícito do usuário.
                        try {
                            const outrasOcorrencias = await cruzarNomeEmCategorias(nomeAutor, boletim);
                            const blocoCruzamento = montarBlocoCruzamentoNome(outrasOcorrencias);
                            if (blocoCruzamento) secoes.push(blocoCruzamento);
                        } catch (e) { /* idem — extra, nunca quebra o relatório principal */ }
                    }
                }
            } catch (e) { /* nó de autores pode não existir — ignora */ }
        }

        if (boletim) secoes.push(...await coletarSecoesTCO(boletim));

        if (!secoes.length) {
            return identificador.tipo === 'boletim'
                ? `Não encontrei nenhum registro com o boletim/COP/BO <strong>${identificador.valor}</strong> em nenhum banco de dados da unidade.`
                : `Não encontrei nenhum registro com o processo/E-SAJ <strong>${identificador.valor}</strong> em nenhum banco de dados da unidade.`;
        }
        const cabecalho = identificador.tipo === 'boletim'
            ? `🔎 Relatório completo — Boletim/COP/BO <strong>${identificador.valor}</strong>${esaj && !alvoEsaj ? ` (E-SAJ vinculado encontrado no TCO)` : ''}:`
            : `🔎 Relatório completo — Processo/E-SAJ <strong>${identificador.valor}</strong>${boletim && !alvoBoletim ? ` (Boletim ${boletim} vinculado encontrado no TCO)` : ''}:`;
        return `${cabecalho}<br>` + secoes.join('<br>');
    }

    async function responderConsultaIdentificador(identificador) {
        if (identificador.tipo === 'nome' || identificador.tipo === 'cpf') {
            const achados = identificador.tipo === 'nome' ? await buscarPorNome(identificador.valor) : await buscarPorCPF(identificador.valor);
            if (!achados.length) {
                return identificador.tipo === 'nome'
                    ? `Não encontrei ninguém chamado "${identificador.valor}" no nó de autores.`
                    : 'Não encontrei nenhum registro no nó de autores pra esse CPF.';
            }
            // Além da linha do nó "autor", cruza pelo BOLETIM dessa pessoa com
            // a ocorrência original (com detalhe de droga quando for o caso —
            // tipo/quantidade/solicitante, que o nó "autor" sozinho não tem) e
            // com TCO/Sentença/Materiais/Guarnição — sem isso, um crime que
            // virou TCO aparecia só como "situação: liberado", sem
            // movimentação, data do TCO ou quem estava na guarnição.
            const blocos = [];
            for (const a of achados) {
                const linha = `👤 <strong>${CAMPO(a, 'NOME') || 'sem nome'}</strong> — Boletim ${CAMPO(a, 'BOLETIM') || '—'}, ${CAMPO(a, 'NATUREZA') || CAMPO(a, 'TIPIFICACAO') || '—'}, ${CAMPO(a, 'CIDADE') || '—'}/${CAMPO(a, 'BAIRRO') || '—'}, situação: ${CAMPO(a, 'SITUACAO') || '—'}`;
                const bol = normBoletim(CAMPO(a, 'BOLETIM'));
                let extra = [];
                if (bol) { try { extra = [...await coletarSecoesOcorrencia(bol), ...await coletarSecoesTCO(bol)]; } catch (e) { /* segue só com a linha do autor */ } }
                blocos.push([linha, ...extra].join('<br>'));
            }
            const titulo = identificador.tipo === 'nome' ? `pro nome "<strong>${identificador.valor}</strong>"` : 'pro CPF informado';
            // Mesmo cruzamento contextual de montarRelatorioCompleto — feito
            // UMA VEZ pro nome buscado (não por achado, todos os achados já
            // são do mesmo nome) — pedido explícito do usuário: cruzamento
            // com assistida (violência doméstica) e com outras categorias.
            const nomeAlvo = identificador.tipo === 'nome' ? identificador.valor : (CAMPO(achados[0], 'NOME') || null);
            if (nomeAlvo) {
                try {
                    const vinculoAssistida = await verificarVinculoAssistida(nomeAlvo);
                    if (vinculoAssistida) blocos.push(montarBlocoAssistida(vinculoAssistida));
                } catch (e) { /* extra — nunca quebra a resposta principal */ }
                try {
                    const outrasOcorrencias = await cruzarNomeEmCategorias(nomeAlvo, null);
                    const blocoCruzamento = montarBlocoCruzamentoNome(outrasOcorrencias);
                    if (blocoCruzamento) blocos.push(blocoCruzamento);
                } catch (e) { /* idem */ }
            }
            return `🔎 ${achados.length} registro(s) encontrado(s) ${titulo}:<br><br>` + blocos.join('<br><br>');
        }
        if (identificador.tipo === 'processo' || identificador.tipo === 'boletim') {
            return await montarRelatorioCompleto(identificador);
        }
        return 'Não consegui identificar o CPF, boletim ou processo na pergunta — tenta incluir o número completo.';
    }

    // ── Respostas ────────────────────────────────────────────────────
    // Conta quantos registros de cada categoria caem dentro do período —
    // núcleo compartilhado por responderResumo() (texto) e obterKPIs()
    // (dados estruturados pro dashboard JARVIS), pra nunca haver dois
    // jeitos de contar a mesma coisa.
    async function contarCategoriasPeriodo(chaves, periodo) {
        const resultado = {};
        for (const chave of chaves) {
            const cat = CATEGORIAS[chave];
            if (!cat) continue;
            try {
                const bruto = await cat.fetch();
                const filtrada = bruto.filter(cat.filtroBase).filter(i => { const d = parseData(cat.campoData(i)); return d && d >= periodo.ini && d <= periodo.fim; });
                resultado[chave] = { total: filtrada.length, mvi: chave === 'mvicvli' ? filtrada.filter(isMVI).length : null };
            } catch (e) { resultado[chave] = null; }
        }
        return resultado;
    }
    // categoriasFiltro: se informado (ex.: usuário pediu "resumo de MVI e CVP"),
    // mostra só essas categorias em vez das 7 padrão.
    async function responderResumo(periodo, categoriasFiltro) {
        const chaves = (categoriasFiltro && categoriasFiltro.length) ? categoriasFiltro : ['mvicvli', 'tco', 'armas', 'drogas', 'perturbacao', 'violencia', 'visita'];
        const contagens = await contarCategoriasPeriodo(chaves, periodo);
        const linhas = [];
        for (const chave of chaves) {
            const cat = CATEGORIAS[chave];
            const c = contagens[chave];
            if (!cat || !c) continue;
            if (chave === 'mvicvli') {
                linhas.push(`• <strong>${c.total}</strong> CVLI (dos quais <strong>${c.mvi}</strong> MVI)`);
            } else {
                linhas.push(`• <strong>${c.total}</strong> ${cat.label}`);
            }
        }
        return `📋 Resumo ${periodo.label}:<br>${linhas.join('<br>')}`;
    }

    // Mesma ideia do resumo, mas quebrado mês a mês dentro do período pedido
    // (ex.: "resumo de 2026 mês a mês de MVI e CVP").
    async function responderResumoMensal(periodo, categoriasFiltro) {
        const chaves = (categoriasFiltro && categoriasFiltro.length) ? categoriasFiltro : ['mvicvli', 'tco', 'armas', 'drogas', 'perturbacao', 'violencia', 'visita'];
        const meses = listarMesesDoPeriodo(periodo);

        const blocos = [];
        for (const chave of chaves) {
            const cat = CATEGORIAS[chave];
            if (!cat) continue;
            let bruto;
            try { bruto = await cat.fetch(); } catch (e) { continue; }
            const base = bruto.filter(cat.filtroBase);
            const linhasMes = meses.map(m => {
                const ini = new Date(m.ano, m.mes, 1);
                const fim = new Date(m.ano, m.mes + 1, 0, 23, 59, 59, 999);
                const filtrada = base.filter(i => { const d = parseData(cat.campoData(i)); return d && d >= ini && d <= fim; });
                const label = `${MESES_EXIBICAO[m.mes]}/${m.ano}`;
                if (chave === 'mvicvli') return `${label}: <strong>${filtrada.filter(isMVI).length}</strong> MVI (${filtrada.length} CVLI)`;
                return `${label}: <strong>${filtrada.length}</strong>`;
            });
            blocos.push(`<strong>${cat.label}</strong><br>${linhasMes.join('<br>')}`);
        }
        return `📆 Resumo mês a mês ${periodo.label}:<br><br>${blocos.join('<br><br>')}`;
    }

    // Comparação entre dois anos citados — suporta 1 ou várias categorias na
    // MESMA resposta (ex.: "MVI, CVP e TCO comparado com 2025"), com ou sem
    // "mês a mês". cidade/bairro são detectados POR CATEGORIA (cada uma tem
    // seus próprios dados de cidade), não globalmente.
    async function responderComparativoMultiCategoria(q, qMin, chaves, anosDaPergunta) {
        const periodoA = detectarPeriodo(qMin, anosDaPergunta[0]);
        const periodoB = detectarPeriodo(qMin, anosDaPergunta[1]);
        const deslocamentoAno = periodoB.ini.getFullYear() - periodoA.ini.getFullYear();
        const mensal = ehMensal(qMin);
        const mesesA = mensal ? listarMesesDoPeriodo(periodoA) : null;

        const blocos = [];
        for (const chave of chaves) {
            const cat = CATEGORIAS[chave];
            if (!cat) continue;
            let bruto;
            try { bruto = await cat.fetch(); } catch (e) { continue; }
            const base = bruto.filter(cat.filtroBase);
            const cidade = detectarCidade(q, base, cat);
            const bairro = detectarBairro(q, base, cat);
            const sufixoLocal = (cidade ? ` em ${cidade}` : '') + (bairro ? ` (bairro ${bairro})` : '');
            const perguntouMVI = chave === 'mvicvli' && q.includes('MVI') && !q.includes('CVLI');
            const rotulo = perguntouMVI ? 'MVI' : cat.label;
            const valorDe = lista => (chave === 'mvicvli' && perguntouMVI) ? lista.filter(isMVI).length : lista.length;
            const filtrarPeriodo = (ini, fim) => {
                let r = base.filter(i => { const d = parseData(cat.campoData(i)); return d && d >= ini && d <= fim; });
                if (cidade) r = r.filter(i => NORM(cat.campoCidade(i)) === NORM(cidade));
                if (bairro) r = r.filter(i => NORM(cat.campoBairro(i)) === NORM(bairro));
                return r;
            };

            if (mensal) {
                let totalA = 0, totalB = 0;
                const linhasMes = mesesA.map(m => {
                    const anoB = m.ano + deslocamentoAno;
                    const valA = valorDe(filtrarPeriodo(new Date(m.ano, m.mes, 1), new Date(m.ano, m.mes + 1, 0, 23, 59, 59, 999)));
                    const valB = valorDe(filtrarPeriodo(new Date(anoB, m.mes, 1), new Date(anoB, m.mes + 1, 0, 23, 59, 59, 999)));
                    totalA += valA; totalB += valB;
                    return `&nbsp;&nbsp;${MESES_EXIBICAO[m.mes]}: ${valA} (${m.ano}) → ${valB} (${anoB})`;
                });
                const { tendencia, percVar } = calcularVariacao(totalA, totalB);
                blocos.push(`<strong>${rotulo}</strong>${sufixoLocal}: <strong>${totalA}</strong> → <strong>${totalB}</strong> (<strong>${tendencia}</strong> de <strong>${percVar}%</strong>)<br>${linhasMes.join('<br>')}`);
            } else {
                const valorA = valorDe(filtrarPeriodo(periodoA.ini, periodoA.fim));
                const valorB = valorDe(filtrarPeriodo(periodoB.ini, periodoB.fim));
                const { tendencia, percVar } = calcularVariacao(valorA, valorB);
                blocos.push(`• <strong>${rotulo}</strong>${sufixoLocal}: <strong>${valorA}</strong> → <strong>${valorB}</strong> (<strong>${tendencia}</strong> de <strong>${percVar}%</strong>)`);
            }
        }

        if (!blocos.length) return 'Não consegui calcular essa comparação — confira as categorias pedidas.';
        return `📊 Comparativo — ${periodoA.label} vs ${periodoB.label}:<br>${mensal ? '<br>' : ''}${blocos.join(mensal ? '<br><br>' : '<br>')}`;
    }

    // Contagem simples de VÁRIAS categorias numa mesma resposta (sem
    // comparativo), ex.: "quantos mvi e cvp este ano" — cada categoria com
    // seu próprio período/cidade detectados independentemente.
    async function responderContagemMultiCategoria(q, qMin, chaves) {
        const blocos = [];
        for (const chave of chaves) {
            const cat = CATEGORIAS[chave];
            if (!cat) continue;
            let bruto;
            try { bruto = await cat.fetch(); } catch (e) { continue; }
            const base = bruto.filter(cat.filtroBase);
            const periodo = detectarPeriodo(qMin);
            const cidade = detectarCidade(q, base, cat);
            const bairro = detectarBairro(q, base, cat);
            const sufixoLocal = (cidade ? ` em ${cidade}` : '') + (bairro ? ` (bairro ${bairro})` : '');
            let filtrada = base.filter(i => { const d = parseData(cat.campoData(i)); return d && d >= periodo.ini && d <= periodo.fim; });
            if (cidade) filtrada = filtrada.filter(i => NORM(cat.campoCidade(i)) === NORM(cidade));
            if (bairro) filtrada = filtrada.filter(i => NORM(cat.campoBairro(i)) === NORM(bairro));

            const perguntouMVI = chave === 'mvicvli' && q.includes('MVI') && !q.includes('CVLI');
            if (chave === 'mvicvli') {
                const mvi = filtrada.filter(isMVI).length;
                const percentual = filtrada.length ? Math.round(mvi / filtrada.length * 100) : 0;
                blocos.push(perguntouMVI
                    ? `• <strong>MVI</strong>${sufixoLocal}: <strong>${mvi}</strong> (de ${filtrada.length} CVLI, ${percentual}%)`
                    : `• <strong>${cat.label}</strong>${sufixoLocal}: <strong>${filtrada.length}</strong> (dos quais ${mvi} MVI)`);
            } else {
                blocos.push(`• <strong>${cat.label}</strong>${sufixoLocal}: <strong>${filtrada.length}</strong>`);
            }
        }
        if (!blocos.length) return 'Não consegui buscar essas categorias agora. Tente de novo em instantes.';
        const periodoLabel = detectarPeriodo(qMin).label;
        return `📊 ${periodoLabel}:<br>${blocos.join('<br>')}`;
    }

    function formatarPesoDroga(g) {
        return g >= 1000
            ? (g / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 3 }) + ' kg'
            : g.toLocaleString('pt-BR', { minimumFractionDigits: 3 }) + ' g/unid.';
    }

    // Agrupa apreensões de droga por substância, somando o peso/quantidade de
    // cada uma (não só contando ocorrências) — mesma convenção de soma usada
    // em js/dashboard-cruzado.js (vírgula decimal, kg acima de 1000g).
    function responderDetalheDrogas(periodo, cidade, filtrada) {
        const sufixoCidade = cidade ? ` em <strong>${cidade}</strong>` : '';
        if (!filtrada.length) return `Não encontrei apreensões de drogas ${periodo.label}${sufixoCidade}.`;
        const porTipo = {};
        filtrada.forEach(i => {
            const tipo = CAMPO(i, 'TIPO_DROGA', 'TIPO') || 'não informado';
            if (!porTipo[tipo]) porTipo[tipo] = { qtd: 0, peso: 0 };
            porTipo[tipo].qtd++;
            porTipo[tipo].peso += CATEGORIAS.drogas.campoPeso(i);
        });
        const top = Object.entries(porTipo).sort((a, b) => b[1].peso - a[1].peso).slice(0, 8);
        const linhas = top.map(([tipo, v]) => `• <strong>${tipo}</strong>: ${v.qtd} ocorrência(s), ${formatarPesoDroga(v.peso)}`);
        const totalPeso = Object.values(porTipo).reduce((s, v) => s + v.peso, 0);
        return `💊 Drogas apreendidas ${periodo.label}${sufixoCidade} — por substância:<br>${linhas.join('<br>')}<br><br>Total geral: <strong>${formatarPesoDroga(totalPeso)}</strong> em <strong>${filtrada.length}</strong> ocorrência(s).`;
    }

    // "Onde a maconha foi apreendida e com quem" — pergunta por REGISTRO,
    // não por agregado: filtra a droga por substância específica (se
    // citada) e lista cidade/bairro + autor de cada apreensão, em vez de só
    // somar/contar. Usa os mesmos campos já mapeados em CATEGORIAS.drogas.
    const SUBSTANCIAS_DROGA = ['maconha', 'cocaina', 'crack', 'haxixe', 'lsd', 'ecstasy', 'skank', 'anfetamina', 'metanfetamina', 'merla'];
    function detectarSubstancia(qMin) {
        for (const s of SUBSTANCIAS_DROGA) if (qMin.includes(s)) return s;
        return null;
    }
    function ehLocalizacaoDroga(qMin) {
        const perguntaOnde = qMin.includes('onde') || qMin.includes('com quem') || qMin.includes('quem foi') || qMin.includes('quem estava') || qMin.includes('quem era');
        return perguntaOnde && (qMin.includes('droga') || qMin.includes('apreens') || !!detectarSubstancia(qMin));
    }
    async function responderLocalizacaoDroga(q, qMin) {
        // O nó /droga NÃO tem campo de autor próprio (só BOLETIM, CIDADE,
        // DATA, HORA, QUANTIDADE, TIPO_DROGA, SOLICITANTE — e SOLICITANTE é
        // a guarnição que atendeu, não quem estava com a droga). O "com
        // quem" só é respondível cruzando o BOLETIM com o nó /autor, mesma
        // técnica já usada pra TCO em rankingAutoresComTCO.
        let drogas, autores;
        try { [drogas, autores] = await Promise.all([fetchNode('droga'), fetchNode('autor')]); }
        catch (e) { return '⚠️ Não consegui buscar os dados agora. Tente de novo em instantes.'; }

        const nomePorBoletim = {};
        autores.forEach(a => { const b = normBoletim(CAMPO(a, 'BOLETIM')); if (b && !nomePorBoletim[b]) nomePorBoletim[b] = CAMPO(a, 'NOME'); });

        const substancia = detectarSubstancia(qMin);
        let filtrada = substancia ? drogas.filter(d => NORM(CAMPO(d, 'TIPO_DROGA', 'TIPO')).includes(NORM(substancia))) : drogas;

        const periodo = detectarPeriodo(qMin);
        filtrada = filtrada.filter(d => { const dt = parseData(CAMPO(d, 'DATA')); return dt && dt >= periodo.ini && dt <= periodo.fim; });

        const cidade = detectarCidade(q, drogas, CATEGORIAS.drogas);
        if (cidade) filtrada = filtrada.filter(d => NORM(CAMPO(d, 'CIDADE')) === NORM(cidade));

        const rotuloSub = substancia ? substancia.charAt(0).toUpperCase() + substancia.slice(1) : 'drogas';
        const sufixoCidade = cidade ? ` em <strong>${cidade}</strong>` : '';
        if (!filtrada.length) return `Não encontrei apreensões de <strong>${rotuloSub}</strong> ${periodo.label}${sufixoCidade}.`;

        const registros = filtrada.slice(0, 10).map(d => {
            const local = `${CAMPO(d, 'CIDADE') || '—'}${CAMPO(d, 'BAIRRO') ? '/' + CAMPO(d, 'BAIRRO') : ''}`;
            const b = normBoletim(CAMPO(d, 'BOLETIM'));
            const autor = (b && nomePorBoletim[b]) || 'não identificado no nó de autores';
            const data = CAMPO(d, 'DATA') || '—';
            return `• ${data} — ${local}, com <strong>${autor}</strong>`;
        });
        const aviso = filtrada.length > 10 ? `<br><small>Mostrando 10 de ${filtrada.length} registros — peça um período mais específico pra refinar.</small>` : '';
        return `💊 Apreensões de <strong>${rotuloSub}</strong> ${periodo.label}${sufixoCidade} — local e responsável (cruzamento com o nó "autor" por boletim):<br>${registros.join('<br>')}${aviso}`;
    }

    // ── Materiais apreendidos (bens/objetos em guarda/depósito) ─────────
    // Fonte: GAS "MATERIAIS" (page/materiais.html) — NÃO é uma ocorrência
    // com cidade, é um item guardado num LOCAL/depósito específico (ex.:
    // "guarda de Palmeira dos Índios"). Por padrão só conta o que ainda
    // está em custódia (STATUS ≠ DEVOLVIDO), igual à própria página de
    // materiais — a menos que a pergunta peça histórico/tudo/devolvidos.
    // "materiais" (plural) NÃO contém "material" como substring — é plural
    // irregular (troca o "l" por "is", não só acrescenta "s") — por isso
    // checa as duas formas explicitamente, e não só o singular.
    function ehMateriais(q) { return q.includes('material') || q.includes('materiais') || q.includes('bens apreendidos') || q.includes('objeto apreendido') || q.includes('objetos apreendidos'); }
    async function responderMateriais(q, qMin) {
        let materiais;
        try { materiais = await fetchMateriais(); } catch (e) { return '⚠️ Não consegui buscar os dados de materiais agora. Tente de novo em instantes.'; }
        if (!materiais.length) return 'Não encontrei nenhum material cadastrado pra essa unidade.';

        // "guarda de Palmeira" / "depósito em X" — filtra pelo campo LOCAL
        // (mesmo algoritmo de match usado pra cidade/bairro: nome completo,
        // depois só a 1ª palavra, pra aceitar nome parcial).
        const locais = new Set();
        materiais.forEach(m => { const l = CAMPO(m, 'LOCAL'); if (l) locais.add(l); });
        const local = melhorCidadeMatch(q, locais);

        let filtrada = local ? materiais.filter(m => NORM(CAMPO(m, 'LOCAL')) === NORM(local)) : materiais;

        const querTudo = qMin.includes('devolvido') || qMin.includes('todos') || qMin.includes('historico') || qMin.includes('todo o periodo');
        if (!querTudo) filtrada = filtrada.filter(m => NORM(CAMPO(m, 'STATUS')) !== 'DEVOLVIDO');

        // Só filtra por período se a pergunta pediu um explicitamente — "quantos
        // materiais tenho na guarda" quer TUDO que ainda está custodiado,
        // não só o que entrou este ano.
        const periodo = detectarPeriodo(qMin);
        if (!periodo.implicito) {
            filtrada = filtrada.filter(m => { const d = parseData(CAMPO(m, 'DATA')); return d && d >= periodo.ini && d <= periodo.fim; });
        }

        const sufixoLocal = local ? ` na guarda de <strong>${local}</strong>` : '';
        const sufixoStatus = querTudo ? '' : ' (ainda em guarda — não devolvidos)';

        if (qMin.includes('status')) {
            const top = topEntries(filtrada, i => CAMPO(i, 'STATUS') || 'não informado', 8);
            if (!top.length) return `Não encontrei materiais${sufixoLocal}.`;
            return `📦 Status dos materiais${sufixoLocal}:<br>` + top.map((e, i) => `${i + 1}. ${e[0]} — <strong>${e[1]}</strong>`).join('<br>');
        }
        if (qMin.includes('categoria') || qMin.includes('tipo de material')) {
            const top = topEntries(filtrada, i => CAMPO(i, 'CATEGORIA') || 'não informado', 8);
            if (!top.length) return `Não encontrei materiais${sufixoLocal}.`;
            return `📦 Materiais${sufixoLocal} por categoria:<br>` + top.map((e, i) => `${i + 1}. ${e[0]} — <strong>${e[1]}</strong>`).join('<br>');
        }
        if (ehTop(qMin)) {
            const top = topEntries(filtrada, i => CAMPO(i, 'LOCAL') || 'não informado', 5);
            if (!top.length) return 'Não encontrei materiais suficientes pra montar um ranking de locais de guarda.';
            return `📦 Locais de guarda com mais materiais${sufixoStatus}:<br>` + top.map((e, i) => `${i + 1}. <strong>${e[0]}</strong> — ${e[1]}`).join('<br>');
        }

        return `📦 <strong>${filtrada.length}</strong> material(is)${sufixoLocal}${sufixoStatus}.`;
    }

    // Cruza o nó /autor (importado da planilha de autores/envolvidos) com os
    // TCOs pelo número do boletim — mesma normalização de boletim usada em
    // page/qualitativo_tco.html (só dígitos, sem zeros à esquerda). Conta
    // quantos TCOs (já filtrados por período) existem contra cada nome.
    async function rankingAutoresComTCO(tcosFiltrados, n) {
        let autores;
        try { autores = await fetchNode('autor'); } catch (e) { return []; }
        const boletinsTCO = new Set();
        tcosFiltrados.forEach(t => {
            const b = normBoletim(CAMPO(t, 'Nº Ocorrência', 'BOLETIM'));
            if (b) boletinsTCO.add(b);
        });
        const cont = {};
        autores.forEach(a => {
            const b = normBoletim(CAMPO(a, 'BOLETIM'));
            if (!b || !boletinsTCO.has(b)) return;
            const nome = CAMPO(a, 'NOME');
            if (!nome) return;
            cont[nome] = (cont[nome] || 0) + 1;
        });
        return Object.entries(cont).sort((a, b) => b[1] - a[1]).slice(0, n || 5);
    }

    // "Comarca com mais arquivamentos" — fonte de VERDADE é o GAS de
    // Sentenças (mesma planilha/aba usada em page/qualitativo_tco.html), que
    // TEM um campo "Comarca" próprio — nada de cruzamento indireto por
    // boletim (versão antiga, menos precisa, cruzava TCO×geral).
    // "arquivou/arquivaram... POR <motivo>" — extrai o motivo livre digitado
    // e compara com o motivo CANÔNICO (ver canonMotivoX), não com o texto
    // bruto — assim "atipicidade material" bate mesmo que a planilha tenha
    // uma frase longa nesse campo, igual à aba Aceitabilidade já faz.
    // O motivo em si nunca menciona período — se a pergunta continuar com
    // "...por atipicidade material EM 2025?", a captura originalmente ia até
    // o fim da frase (não tinha onde parar) e trazia "ATIPICIDADE MATERIAL
    // EM 2025" inteiro, que nunca batia com o motivo canônico "Atipicidade
    // Material" sozinho — por isso cortava tudo fora mesmo quando os dados
    // existiam. Aqui trunca a captura na primeira referência de período que
    // aparecer (ano, mês, "ano passado", semestre etc.).
    function limparMotivoDePeriodo(motivo) {
        const marcadores = [
            /\b20\d{2}\b/,
            /\b(em|no|na|deste|desse|este|esse)\s+(ano|mes|20\d{2})\b/,
            /\bano\s+(passado|anterior)\b/,
            /\bmes\s+(passado|anterior|que vem|seguinte)\b/,
            /\b(primeiro|segundo|1[ºo]?|2[ºo]?)\s+semestre\b/,
            new RegExp('\\b(' + MESES_NOME.join('|') + ')\\b'),
        ];
        let corte = motivo.length;
        marcadores.forEach(re => { const m = motivo.match(re); if (m && m.index < corte) corte = m.index; });
        return motivo.slice(0, corte).trim();
    }
    function extrairMotivoArquivamento(qMin) {
        const m = qMin.match(/arquiv\w*[^.?]*?\bpor\s+(.+?)(?:[?.]|$)/);
        if (!m) return null;
        const motivo = limparMotivoDePeriodo(m[1].trim());
        return motivo ? NORM(motivo) : null;
    }

    // Réplica fiel da classificação de motivo de arquivamento de
    // page/qualitativo_tco.html (MOTIVO_REGRAS/MOTIVO_LABELS_CONHECIDOS) —
    // mesmas regras, pra não divergir do que já é mostrado na aba
    // Aceitabilidade/Sentenças.
    const MOTIVO_REGRAS_X = [
        { chave: 'Composição Civil das Partes', testes: [/composi[cç][aã]o civil/] },
        { chave: 'Litispendência / Duplicidade', testes: [/litispendenc/, /a[cç][aã]o id[eê]ntica.{0,20}(tramite|trâmite)/, /identidade entre os procedimentos/, /mesmos fatos.{0,20}outro processo/, /crime continuado com outro feito/] },
        { chave: 'Ausência de Representação', testes: [/representa[cç][aã]o/, /decadenc/, /ren[uú]ncia ao direito/, /interesse d[ae] v[ií]tima/] },
        { chave: 'Falta de Justa Causa', testes: [/justa causa/, /n[aã]o (h[aá]|restou comprovad).{0,30}(ind[ií]cio|elemento).{0,20}crime/, /n[aã]o houve.{0,20}(fato criminoso|ocorr[eê]ncia de (fato )?crime)/, /n[aã]o h[aá] ind[ií]cios de cometimento de crime/] },
        { chave: 'Atipicidade Formal', testes: [/atipicidade formal/] },
        { chave: 'Atipicidade Material', testes: [/atipicidade material/, /\batipic[ao]\b/, /natureza administrativa/, /n[aã]o se amolda ao tipo penal/, /inexiste.{0,40}suporte probat[oó]rio/, /aus[eê]ncia de perigo concreto/, /sem potencial ofensivo/, /conduta at[ií]pica/] },
        { chave: 'Transação Penal Cumprida', testes: [/transac/, /extinta a punibilidade/, /extinto o (processo|feito)/, /composi[cç][aã]o civil/, /homolog/, /cumprimento (d[ae]s?|integral)/] },
    ];
    const MOTIVO_LABELS_CONHECIDOS_X = {
        'atipicidade material': 'Atipicidade Material',
        'atipicidade formal': 'Atipicidade Formal',
        'falta de justa causa': 'Falta de Justa Causa',
        'ausencia de representacao': 'Ausência de Representação',
        'transacao penal cumprida': 'Transação Penal Cumprida',
    };
    function canonMotivoX(motivoTxt, resultadoTxt, erroMat, erroForm) {
        const m = NORM(motivoTxt || '').toLowerCase().trim();
        const r = NORM(resultadoTxt || '').toLowerCase();
        if (MOTIVO_LABELS_CONHECIDOS_X[m]) return MOTIVO_LABELS_CONHECIDOS_X[m];
        for (const grp of MOTIVO_REGRAS_X) {
            for (const teste of grp.testes) { if (teste.test(m) || teste.test(r)) return grp.chave; }
        }
        if (erroForm && String(erroForm).trim()) return 'Atipicidade Formal';
        if (erroMat && String(erroMat).trim()) return 'Atipicidade Material';
        if (!m && !r) return null;
        return m ? 'Outros Motivos' : null;
    }

    async function responderComarcaArquivamentos(periodo, motivoFiltro) {
        let sentencas;
        try { sentencas = await fetchSentencas(); } catch (e) { return '⚠️ Não consegui buscar os dados de sentenças agora. Tente de novo em instantes.'; }
        if (!sentencas.length) return 'Não encontrei nenhuma sentença registrada pra essa unidade (confira se já foi feita a importação na aba "Importar do Gem" de Sentenças, em Análise Qualitativa de TCO).';

        const sufixoMotivo = motivoFiltro ? ` por <strong>${motivoFiltro.toLowerCase()}</strong>` : '';
        const filtrada = sentencas.filter(r => {
            const d = parseData(CAMPO(r, 'Data da Sentença'));
            if (!d || d < periodo.ini || d > periodo.fim) return false;
            const motivoCanon = canonMotivoX(
                CAMPO(r, 'Motivo do Arquivamento'), CAMPO(r, 'Resultado'),
                CAMPO(r, 'Erro – Atipicidade Material', 'Erro - Atipicidade Material'),
                CAMPO(r, 'Erro – Atipicidade Formal', 'Erro - Atipicidade Formal')
            );
            if (!motivoCanon) return false; // sem motivo canônico = não foi arquivado
            if (motivoFiltro && !NORM(motivoCanon).includes(motivoFiltro)) return false;
            return true;
        });

        if (!filtrada.length) {
            return motivoFiltro
                ? `Não encontrei sentenças arquivadas${sufixoMotivo} ${periodo.label}. Confira se o motivo foi digitado como aparece nas sentenças (ex.: "atipicidade material", "falta de justa causa", "transação penal").`
                : `Não encontrei sentenças arquivadas ${periodo.label}.`;
        }

        const porComarca = {};
        filtrada.forEach(r => { const c = CAMPO(r, 'Comarca') || 'não informada'; porComarca[c] = (porComarca[c] || 0) + 1; });
        const top = Object.entries(porComarca).sort((a, b) => b[1] - a[1]).slice(0, 5);
        return `⚖️ Comarcas com mais arquivamentos${sufixoMotivo} ${periodo.label} (fonte: Sentenças):<br>` +
            top.map((e, i) => `${i + 1}. <strong>${e[0]}</strong> — ${e[1]}`).join('<br>');
    }

    // ── Ranking/aceitabilidade de MILITARES por TCO ─────────────────────
    // "Militar" aqui é quem estava na GUARNIÇÃO que atendeu a ocorrência
    // (Firebase /guarnicao), NÃO quem digitou o TCO (Operador Capa — esse já
    // existe em ehTopOperadorTCO/responderPergunta, é outra pergunta).
    // Réplica fiel de mkRankingMilitares()/buildDashboardFromRaw() de
    // page/qualitativo_tco.html — cada TCO×militar da guarnição vira um
    // "caso" classificado em ACEITÁVEL (transação penal, ANPP, composição
    // civil das partes, condenação/procedente) ou FALHA (atipicidade,
    // falta de justa causa e demais arquivamentos), usando as SENTENÇAS
    // como fonte de verdade e o campo Movimentação do TCO como fallback
    // (processos ainda sem sentença importada).
    const MOTIVO_GRUPO_X = {
        'Transação Penal Cumprida': 'aceitavel',
        'Composição Civil das Partes': 'aceitavel',
        'Atipicidade Material': 'falha',
        'Atipicidade Formal': 'falha',
        'Falta de Justa Causa': 'falha',
        'Ausência de Representação': 'externo',
        'Litispendência / Duplicidade': 'externo',
        'Outros Motivos': 'outros',
    };
    function grupoDoRegistroX(motivoCanon, resultadoTxt) {
        if (motivoCanon && MOTIVO_GRUPO_X[motivoCanon]) return MOTIVO_GRUPO_X[motivoCanon];
        const r = NORM(resultadoTxt || '').toLowerCase();
        if (r.includes('condena') || r.includes('procedente')) return 'processual';
        if (r.includes('arquiv')) return 'falha';
        return 'outros';
    }
    // Fallback quando o TCO ainda não tem sentença importada no IRIS — usa o
    // próprio campo Movimentação (e categoriaAceitabilidade, se existir).
    const ACEIT_MOV_X = ['transac', 'anpp', 'condena', 'homolog', 'composicao', 'suspensao', 'perda de bem', 'destruicao', 'extincao da pena', 'absolvicao'];
    const ACEIT_CAT_X = ['aceitac'];
    const FALHA_CAT_X = ['nao aceitac', 'rejeicao'];
    function classificarTcoFallback(t) {
        const mov = NORM(CAMPO(t, 'Movimentação', 'Movimentacao', 'MOVIMENTACAO')).toLowerCase();
        const cat = NORM(CAMPO(t, 'categoriaAceitabilidade')).toLowerCase();
        // "julgad" (não só "julgado") — pega também a flexão feminina
        // "julgada", igual à referência em qualitativo_tco.html.
        if (mov.includes('julgado') || mov.includes('julgad')) return 'aceitavel';
        if (mov.includes('arquiv')) {
            if (cat && ACEIT_CAT_X.some(k => cat.includes(k))) return 'aceitavel';
            if (cat && FALHA_CAT_X.some(k => cat.includes(k))) return 'falha';
            if (ACEIT_MOV_X.some(k => mov.includes(k))) return 'aceitavel';
            return 'falha';
        }
        return null;
    }
    // Lista achatada de casos (um item por TCO × militar da guarnição), com
    // data/comarca vindas da sentença (quando existir) pra permitir filtro
    // por ano/mês/comarca depois — igual ao que a aba Aceitabilidade mostra,
    // só que aqui em formato de pergunta/resposta em vez de dashboard.
    async function montarCasosMilitaresTCO() {
        if (NODE_CACHE.__casosMilitares) return NODE_CACHE.__casosMilitares;
        const [tcos, sentencas, guarPorBoletim, geral] = await Promise.all([fetchTCO(), fetchSentencas(), fetchGuarnicao(), fetchNode('geral')]);

        // TCO não tem CIDADE própria (só Comarca, via sentença) — cruza por
        // boletim com /geral (fonte de verdade da cidade) pra permitir
        // agrupar aceitabilidade por cidade também, não só por comarca.
        const cidadePorBoletim = {};
        geral.forEach(item => {
            const bol = normBoletim(CAMPO(item, 'BOLETIM', 'NUMEROOCORRENCIA'));
            if (bol && !cidadePorBoletim[bol]) cidadePorBoletim[bol] = CAMPO(item, 'CIDADE');
        });

        const semAcentoMin = s => NORM(s).toLowerCase();
        const esajMap = {}, esajData = {}, esajComarca = {}, esajMotivoCanon = {};
        // Um mesmo E-SAJ pode aparecer em mais de uma linha de sentença —
        // por isso ACUMULA em conjuntos (não sobrescreve um mapa único),
        // igual à referência (mkRankingMilitares/buildDashboardFromRaw em
        // qualitativo_tco.html: esajsAceitaveis/esajsFalha são LISTAS, e na
        // hora de classificar FALHA tem prioridade sobre ACEITÁVEL quando
        // o mesmo processo aparece nos dois grupos).
        const esajFalhaSet = new Set(), esajAceitavelSet = new Set();
        sentencas.forEach(r => {
            const numero = semAcentoMin(CAMPO(r, 'Nº Processo'));
            if (!numero) return;
            const motivoCanon = canonMotivoX(
                CAMPO(r, 'Motivo do Arquivamento'), CAMPO(r, 'Resultado'),
                CAMPO(r, 'Erro – Atipicidade Material', 'Erro - Atipicidade Material'),
                CAMPO(r, 'Erro – Atipicidade Formal', 'Erro - Atipicidade Formal')
            );
            const grupo = grupoDoRegistroX(motivoCanon, CAMPO(r, 'Resultado'));
            esajData[numero] = parseData(CAMPO(r, 'Data da Sentença'));
            esajComarca[numero] = CAMPO(r, 'Comarca') || '';
            esajMotivoCanon[numero] = motivoCanon;
            if (grupo === 'falha') esajFalhaSet.add(numero);
            else if (grupo === 'aceitavel' || grupo === 'processual') esajAceitavelSet.add(numero);
        });
        tcos.forEach(t => {
            const esaj = semAcentoMin(CAMPO(t, 'E-SAJ', 'ESAJ'));
            const bol = CAMPO(t, 'Nº Ocorrência').trim();
            if (esaj && bol) esajMap[esaj] = bol;
        });
        function getIgs(bol) {
            let igs = guarPorBoletim[bol] || [];
            if (!igs.length) igs = guarPorBoletim[String(bol).replace(/\D/g, '').replace(/^0+/, '')] || [];
            return igs;
        }

        const casos = [];
        tcos.forEach(t => {
            const esaj = semAcentoMin(CAMPO(t, 'E-SAJ', 'ESAJ'));
            let classif = null;
            if (esaj && esajFalhaSet.has(esaj)) classif = 'falha';
            else if (esaj && esajAceitavelSet.has(esaj)) classif = 'aceitavel';
            if (!classif) classif = classificarTcoFallback(t);
            if (!classif) return;

            const bol = esajMap[esaj] || CAMPO(t, 'Nº Ocorrência').trim();
            if (!bol) return;
            const igs = getIgs(bol);
            if (!igs.length) return;

            const tip = CAMPO(t, 'Tipicidade Geral') || '—';
            const data = (esaj && esajData[esaj]) || parseData(CAMPO(t, 'DATA')) || null;
            const comarca = (esaj && esajComarca[esaj]) || '';
            const cidade = cidadePorBoletim[normBoletim(bol)] || '';
            const motivoCanon = (esaj && esajMotivoCanon[esaj]) || null;

            igs.forEach(ig => {
                if (!ig) return;
                let posto = String(ig.POSTO_GRADUACAO || ig['Posto / Graduação'] || '').trim();
                if (posto === '---') posto = '';
                const nome = String(ig.NOME_GUERRA || ig['Nome de guerra'] || ig.NOME_COMPLETO || '').trim();
                if (!nome) return;
                casos.push({ esaj: esaj || '—', bol, posto, nome, data, comarca, cidade, tip, classif, motivoCanon });
            });
        });

        NODE_CACHE.__casosMilitares = casos;
        return casos;
    }

    function ehRankingMilitaresTCO(qMin) {
        const mencionaMilitar = qMin.includes('militar') || qMin.includes('guarnicao') || qMin.includes('policial');
        if (!mencionaMilitar) return false;
        return qMin.includes('arquiv') || qMin.includes('atipicidade') || qMin.includes('falha') ||
            qMin.includes('justa causa') || qMin.includes('aceit') || qMin.includes('valid');
    }
    // 'aceitavel' = só quer os aceitos/válidos; 'falha' = só quer os
    // arquivados/atipicidade; 'ambos' = pergunta genérica ("resultado do
    // militar X"), mostra os dois lados.
    function modoAceitabilidadeTCO(qMin) {
        const querAceit = qMin.includes('aceit') || qMin.includes('valid');
        const querFalha = qMin.includes('arquiv') || qMin.includes('atipicidade') || qMin.includes('falha') || qMin.includes('justa causa');
        if (querAceit && !querFalha) return 'aceitavel';
        if (querFalha && !querAceit) return 'falha';
        return 'ambos';
    }
    // Acha, entre os nomes de militares que realmente aparecem nos casos, o
    // mais longo que esteja contido na pergunta — assim "o militar Emerson
    // teve quantos arquivados" filtra só pra ele, sem precisar de um
    // vocabulário fixo de nomes (os nomes vêm do próprio Firebase).
    function encontrarMilitarNaPergunta(qMin, casos) {
        const nomes = Array.from(new Set(casos.map(c => c.nome))).filter(Boolean).sort((a, b) => b.length - a.length);
        for (const nome of nomes) {
            const norm = NORM(nome).toLowerCase();
            if (norm.length >= 3 && qMin.includes(norm)) return nome;
        }
        return null;
    }
    async function responderRankingMilitaresTCO(q, qMin) {
        let casos;
        try { casos = await montarCasosMilitaresTCO(); }
        catch (e) { return '⚠️ Não consegui buscar os dados agora. Tente de novo em instantes.'; }
        if (!casos.length) {
            return 'Não encontrei nenhum cruzamento entre TCO, Sentenças e Guarnição — confira se os boletins têm guarnição registrada no Firebase (nó /guarnicao) e se as sentenças foram importadas.';
        }

        const modo = modoAceitabilidadeTCO(qMin);
        let motivoFiltro = extrairMotivoArquivamento(qMin);
        if (!motivoFiltro && qMin.includes('atipicidade')) motivoFiltro = 'ATIPICIDADE';
        if (!motivoFiltro && qMin.includes('justa causa')) motivoFiltro = 'FALTA DE JUSTA CAUSA';

        const comarcas = new Set(casos.map(c => c.comarca).filter(Boolean));
        const comarcaFiltro = melhorCidadeMatch(q, comarcas);
        // Só filtra por período se a pergunta pediu um explicitamente — sem
        // isso, "militar que mais tem tco aceitável" deve trazer o
        // histórico INTEIRO (mesma convenção usada em responderMateriais).
        const periodo = detectarPeriodo(qMin);

        let filtrados = casos.slice();
        if (!periodo.implicito) filtrados = filtrados.filter(c => c.data && c.data >= periodo.ini && c.data <= periodo.fim);
        if (comarcaFiltro) filtrados = filtrados.filter(c => NORM(c.comarca) === NORM(comarcaFiltro));
        if (motivoFiltro) filtrados = filtrados.filter(c => c.classif !== 'falha' || (c.motivoCanon && NORM(c.motivoCanon).includes(motivoFiltro)));

        const sufixoMotivo = motivoFiltro ? ` por <strong>${motivoFiltro.toLowerCase()}</strong>` : '';
        const sufixoComarca = comarcaFiltro ? ` na comarca de <strong>${comarcaFiltro}</strong>` : '';
        const sufixoPeriodo = periodo.implicito ? '' : ` ${periodo.label}`;

        // Militar específico citado na pergunta ("o militar X teve quantos
        // arquivados/validados?") — responde só o número dele, já filtrado.
        const militarAlvo = encontrarMilitarNaPergunta(qMin, filtrados);
        if (militarAlvo) {
            const doMilitar = filtrados.filter(c => c.nome === militarAlvo);
            const aceitaveis = doMilitar.filter(c => c.classif === 'aceitavel').length;
            const falhas = doMilitar.filter(c => c.classif === 'falha').length;
            const posto = (doMilitar.find(c => c.posto) || {}).posto || '';
            const nomeCompleto = (posto ? posto + ' ' : '') + militarAlvo;
            if (modo === 'aceitavel') return `🎖️ <strong>${nomeCompleto}</strong> teve <strong>${aceitaveis}</strong> TCO(s) aceitável(is)/válido(s)${sufixoMotivo}${sufixoComarca}${sufixoPeriodo} (cruzamento Sentenças × TCO × Guarnição).`;
            if (modo === 'falha') return `🎖️ <strong>${nomeCompleto}</strong> teve <strong>${falhas}</strong> TCO(s) arquivado(s)${sufixoMotivo}${sufixoComarca}${sufixoPeriodo} (cruzamento Sentenças × TCO × Guarnição).`;
            return `🎖️ <strong>${nomeCompleto}</strong>${sufixoComarca}${sufixoPeriodo}:<br>✓ Aceitáveis/válidos: <strong>${aceitaveis}</strong><br>✗ Arquivados/falha: <strong>${falhas}</strong>`;
        }

        if (!filtrados.length) return `Não encontrei nenhum TCO cruzado com militar${sufixoMotivo}${sufixoComarca}${sufixoPeriodo}.`;

        const contPorMilitar = {};
        filtrados.forEach(c => {
            if (modo === 'aceitavel' && c.classif !== 'aceitavel') return;
            if (modo === 'falha' && c.classif !== 'falha') return;
            const chave = (c.posto ? c.posto + ' ' : '') + c.nome;
            if (!contPorMilitar[chave]) contPorMilitar[chave] = { aceitaveis: 0, falhas: 0 };
            if (c.classif === 'aceitavel') contPorMilitar[chave].aceitaveis++; else contPorMilitar[chave].falhas++;
        });

        const criterio = modo === 'aceitavel' ? 'aceitaveis' : 'falhas';
        const top = Object.entries(contPorMilitar)
            .map(([nome, c]) => ({ nome, ...c }))
            .sort((a, b) => b[criterio] - a[criterio])
            .slice(0, 10);
        if (!top.length || top.every(e => e[criterio] === 0)) {
            return `Não encontrei TCOs${modo === 'aceitavel' ? ' aceitáveis/válidos' : modo === 'falha' ? ' arquivados' : ''}${sufixoMotivo}${sufixoComarca}${sufixoPeriodo} cruzados com militar (confira se o processo tem E-SAJ no TCO e se o boletim tem guarnição registrada em /guarnicao).`;
        }

        const titulo = modo === 'aceitavel' ? '🎖️ Militares com mais TCOs aceitáveis/válidos'
            : modo === 'falha' ? '🎖️ Militares com mais TCOs arquivados'
                : '🎖️ Militares — aceitáveis × arquivados';
        const linhas = top.map((e, i) => modo === 'ambos'
            ? `${i + 1}. <strong>${e.nome}</strong> — ✓ ${e.aceitaveis} aceitável(is) / ✗ ${e.falhas} arquivado(s)`
            : `${i + 1}. <strong>${e.nome}</strong> — ${e[criterio]}`);
        return `${titulo}${sufixoMotivo}${sufixoComarca}${sufixoPeriodo} (cruzamento Sentenças × TCO × Guarnição):<br>` + linhas.join('<br>');
    }

    // ── Percentual de aceitabilidade/falha de TCO por CIDADE e/ou COMARCA ──
    // Diferente do ranking por militar acima: aqui cada TCO conta UMA VEZ só
    // (não uma vez por integrante da guarnição), senão um TCO com guarnição
    // de 3 pessoas pesaria 3x mais que um com 1 só, distorcendo o percentual
    // por local.
    function casosUnicosPorTco(casos) {
        const vistos = new Set();
        const unicos = [];
        casos.forEach(c => {
            const chave = (c.esaj && c.esaj !== '—') ? 'esaj:' + c.esaj : 'bol:' + c.bol;
            if (vistos.has(chave)) return;
            vistos.add(chave);
            unicos.push(c);
        });
        return unicos;
    }
    function ehAceitabilidadePorLocal(qMin) {
        const mencionaLocal = qMin.includes('cidade') || qMin.includes('comarca');
        const mencionaAceitabilidade = qMin.includes('aceitabilidade') || qMin.includes('aceitacao') ||
            qMin.includes('taxa de aceit') || qMin.includes('percentual de aceit') || qMin.includes('porcentagem de aceit') ||
            qMin.includes('percentual de rejeic') || qMin.includes('porcentagem de rejeic') ||
            qMin.includes('percentual de recus') || qMin.includes('porcentagem de recus') ||
            qMin.includes('percentual de falha') || qMin.includes('porcentagem de falha') ||
            qMin.includes('taxa de rejeic') || qMin.includes('taxa de recus') || qMin.includes('taxa de falha');
        return mencionaLocal && mencionaAceitabilidade;
    }
    async function responderAceitabilidadePorLocal(q, qMin) {
        let casos;
        try { casos = await montarCasosMilitaresTCO(); }
        catch (e) { return '⚠️ Não consegui buscar os dados agora. Tente de novo em instantes.'; }
        if (!casos.length) {
            return 'Não encontrei nenhum cruzamento entre TCO, Sentenças e Guarnição — confira se os boletins têm guarnição registrada no Firebase (nó /guarnicao) e se as sentenças foram importadas.';
        }

        const unicos = casosUnicosPorTco(casos);
        const periodo = detectarPeriodo(qMin);
        let filtrados = unicos.slice();
        if (!periodo.implicito) filtrados = filtrados.filter(c => c.data && c.data >= periodo.ini && c.data <= periodo.fim);
        if (!filtrados.length) return `Não encontrei TCOs${periodo.implicito ? '' : ' ' + periodo.label} pra calcular percentual de aceitabilidade.`;

        const sufixoPeriodo = periodo.implicito ? '' : ` ${periodo.label}`;
        const montarBloco = (campo, rotulo, emoji) => {
            const agrupado = {};
            filtrados.forEach(c => {
                const local = c[campo] || 'não informada';
                if (!agrupado[local]) agrupado[local] = { aceitaveis: 0, falhas: 0 };
                if (c.classif === 'aceitavel') agrupado[local].aceitaveis++; else agrupado[local].falhas++;
            });
            const linhas = Object.entries(agrupado)
                .map(([local, c]) => {
                    const total = c.aceitaveis + c.falhas;
                    return { local, total, pctAceit: total ? Math.round(c.aceitaveis / total * 100) : 0, pctFalha: total ? Math.round(c.falhas / total * 100) : 0 };
                })
                .filter(e => e.total > 0)
                .sort((a, b) => b.total - a.total);
            if (!linhas.length) return null;
            const texto = linhas.map((e, i) => `${i + 1}. <strong>${e.local}</strong> — ✓ ${e.pctAceit}% aceitável / ✗ ${e.pctFalha}% falha (${e.total} TCO(s))`).join('<br>');
            return `${emoji} Percentual de aceitabilidade por <strong>${rotulo}</strong>${sufixoPeriodo} (cruzamento Sentenças × TCO × Guarnição, cada TCO contado uma vez):<br>${texto}`;
        };

        const quisCidade = qMin.includes('cidade');
        const quisComarca = qMin.includes('comarca');
        const blocos = [];
        if (quisCidade) { const b = montarBloco('cidade', 'cidade', '📍'); if (b) blocos.push(b); }
        if (quisComarca) { const b = montarBloco('comarca', 'comarca', '⚖️'); if (b) blocos.push(b); }
        if (!blocos.length) return `Não encontrei TCOs cruzados com cidade/comarca${sufixoPeriodo} (confira se o boletim tem cidade em /geral e se o processo tem Comarca na Sentença).`;
        return blocos.join('<br><br>');
    }

    // Detecta pra QUAL mês a previsão foi pedida (ex.: "previsão de MVI pra
    // agosto") e quantos meses isso está à frente do mês atual. Sem mês
    // citado, assume o próximo mês (step=1), que é o caso "nativo" do modelo
    // de js/analisePreditiva.js.
    function detectarMesAlvo(qMin) {
        const hoje = new Date();
        const proxMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
        const rotuloProxMes = { step: 1, label: `${MESES_EXIBICAO[proxMes.getMonth()]}/${proxMes.getFullYear()}` };

        // "próximo mês"/"mês que vem"/"mês seguinte" EXPLÍCITO sempre vence,
        // mesmo se outro mês aparecer em outra parte da mensagem (ex.: pedido
        // composto — "compare julho... e me dê a previsão do próximo mês" —
        // sem essa prioridade, o "julho" (que é de OUTRO pedido) contaminava
        // a previsão, que deveria ter sido "mês que vem").
        if (qMin.includes('proximo mes') || qMin.includes('mes que vem') || qMin.includes('mes seguinte')) return rotuloProxMes;

        for (let i = 0; i < MESES_NOME.length; i++) {
            if (new RegExp('\\b' + MESES_NOME[i] + '\\b').test(qMin)) {
                const anoNaFrase = qMin.match(/\b(20\d{2})\b/);
                let anoAlvo = anoNaFrase ? +anoNaFrase[1] : hoje.getFullYear();
                // Sem ano explícito e o mês já passou (ou é o atual) neste ano → assume o ano que vem
                if (!anoNaFrase && i <= hoje.getMonth()) anoAlvo += 1;
                const step = (anoAlvo - hoje.getFullYear()) * 12 + (i - hoje.getMonth());
                return { step: Math.max(1, step), label: `${MESES_EXIBICAO[i]}/${anoAlvo}` };
            }
        }
        return rotuloProxMes;
    }

    // Previsão — réplica FIEL do modelo e da classificação de
    // js/analisePreditiva.js. Propositalmente usa um critério de MVI/CVP
    // diferente do resto do Xerife (que segue js/index.js): aqui o pedido foi
    // usar exatamente a mesma lógica da Análise Preditiva, então não unificar.
    // Pra mais de 1 mês à frente, o modelo original (média ponderada dos 3
    // últimos meses + regressão) só faz sentido pro passo 1 — além disso,
    // vira só extrapolação da reta de regressão, com aviso de confiança menor.
    async function responderPrevisao(q, qMin) {
        const alvo = detectarMesAlvo(qMin);
        let querMVI = q.includes('MVI');
        let querCVLI = q.includes('CVLI');
        let querCVP = q.includes('CVP') || q.includes('ROUBO') || q.includes('EXTORSAO');
        if (!querMVI && !querCVLI && !querCVP) { querMVI = querCVLI = querCVP = true; } // nenhuma citada → mostra as 3, como no painel

        let geral, cvp;
        try { [geral, cvp] = await Promise.all([fetchNode('geral'), fetchNode('cvp')]); }
        catch (e) { return '⚠️ Não consegui buscar os dados agora. Tente de novo em instantes.'; }

        const normP = s => String(s || '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
        const ehTipoCVLI_P = t => t.includes('HOMICIDIO') || t.includes('FEMINICIDIO') || t.includes('LATROCINIO');
        const isMVI_P = item => {
            const t = normP((item.TIPIFICACAO_GERAL || '') + ' ' + (item.TIPIFICACAO || ''));
            const obito = normP(item.OBITO || '');
            if (t.includes('ACHADO') || t.includes('SUICIDIO') || t.includes('VIOLACAO')) return false;
            if (t.includes('TENTATIVA')) return ehTipoCVLI_P(t) && obito === 'S';
            return ehTipoCVLI_P(t);
        };
        const isCVP_P = item => {
            const t = normP((item.TIPIFICACAO_GERAL || '') + ' ' + (item.TIPIFICACAO || ''));
            const obito = normP(item.OBITO || '');
            if (t.includes('APOIO') || t.includes('OUTRAS')) return false;
            if (t.includes('TENTATIVA') && obito === 'S') return false;
            return t.includes('ROUBO') || t.includes('EXTORSAO');
        };
        const cvliMap = {};
        geral.forEach(item => {
            const t = normP((item.TIPIFICACAO_GERAL || '') + ' ' + (item.TIPIFICACAO || ''));
            if (t.includes('ACHADO') || t.includes('SUICIDIO') || t.includes('VIOLACAO')) return;
            if (t.includes('TENTATIVA')) { if (ehTipoCVLI_P(t)) cvliMap[item.BOLETIM || Math.random()] = item; return; }
            if (ehTipoCVLI_P(t)) cvliMap[item.BOLETIM || Math.random()] = item;
        });
        const arrMVIitens = geral.filter(isMVI_P);
        const arrCVLIitens = Object.values(cvliMap);
        const arrCVPitens = cvp.filter(isCVP_P);

        function parseMesAnoP(item) {
            const data = (item.DATA || item.data || '').toString().trim();
            if (!data || data === '---') return null;
            let m, a;
            if (data.includes('/')) { const p = data.split('/'); if (p.length < 3) return null; m = parseInt(p[1]) - 1; a = parseInt(p[2]); }
            else if (data.includes('-')) { const p = data.split('-'); a = parseInt(p[0]); m = parseInt(p[1]) - 1; }
            else return null;
            if (isNaN(m) || isNaN(a) || m < 0 || m > 11) return null;
            return `${a}-${String(m + 1).padStart(2, '0')}`;
        }
        const hoje = new Date();
        const meses12 = [];
        for (let i = 11; i >= 0; i--) { const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1); meses12.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
        function serieMensal(itens) {
            const por = {};
            itens.forEach(r => { const ch = parseMesAnoP(r); if (ch) por[ch] = (por[ch] || 0) + 1; });
            return meses12.map(ch => por[ch] || 0);
        }
        // passos=1 → índice imediatamente após o último dado (o próximo mês);
        // passos>1 → extrapola mais além na mesma reta.
        function regressaoLinear(arr, passos) {
            const n = arr.length; if (n < 2) return arr[0] ?? 0;
            let sx = 0, sy = 0, sxy = 0, sx2 = 0;
            arr.forEach((v, i) => { sx += i; sy += v; sxy += i * v; sx2 += i * i; });
            const denom = n * sx2 - sx * sx;
            const m = denom ? (n * sxy - sx * sy) / denom : 0;
            const b = (sy - m * sx) / n;
            const alvoIdx = n + (passos - 1);
            return Math.round(Math.max(0, m * alvoIdx + b));
        }
        function mediaPonderada(arr) {
            const ult = arr.slice(-3); if (!ult.length) return 0;
            const pesos = [1, 2, 3].slice(3 - ult.length);
            const soma = ult.reduce((a, v, i) => a + v * pesos[i], 0);
            return Math.round(soma / pesos.reduce((a, v) => a + v, 0));
        }
        // passos=1: exatamente o modelo de js/analisePreditiva.js (60% média
        // ponderada + 40% regressão). Além disso, a média ponderada dos
        // últimos 3 meses REAIS não representa mais o alvo — usa só a reta.
        function prever(arr, passos) {
            if (passos <= 1) return Math.round(mediaPonderada(arr) * 0.6 + regressaoLinear(arr, 1) * 0.4);
            return regressaoLinear(arr, passos);
        }

        const linhas = [];
        if (querMVI) { const arr = serieMensal(arrMVIitens); linhas.push(`• <strong>MVI</strong>: <strong>${prever(arr, alvo.step)}</strong> ocorrência(s) previstas pra ${alvo.label} (últimos 3 meses: ${arr.slice(-3).join(', ')})`); }
        if (querCVLI) { const arr = serieMensal(arrCVLIitens); linhas.push(`• <strong>CVLI</strong>: <strong>${prever(arr, alvo.step)}</strong> ocorrência(s) previstas pra ${alvo.label} (últimos 3 meses: ${arr.slice(-3).join(', ')})`); }
        if (querCVP) { const arr = serieMensal(arrCVPitens); linhas.push(`• <strong>CVP</strong>: <strong>${prever(arr, alvo.step)}</strong> ocorrência(s) previstas pra ${alvo.label} (últimos 3 meses: ${arr.slice(-3).join(', ')})`); }

        const avisoExtrapolacao = alvo.step > 1
            ? '<br><br><small>⚠️ Previsão pra mais de um mês à frente é só a extrapolação da tendência linear — confiança menor que a previsão do próximo mês (essa sim, o modelo exato da Análise Preditiva).</small>'
            : '';
        return `🔮 Previsão pra <strong>${alvo.label}</strong> (mesmo critério de MVI/CVLI/CVP da Análise Preditiva):<br>${linhas.join('<br>')}${avisoExtrapolacao}<br><br><small>Esse critério de MVI/CVP é o específico da Análise Preditiva — pode variar um pouco do usado nas outras respostas do Xerife.</small>`;
    }

    // Horários/bairros críticos por cidade — réplica da lógica de turnos e
    // pesos de gravidade de js/gerarcartao.js (padrão: últimos 90 dias,
    // prioridade gravidade > quantidade, mesma escala de cor 25%/50%).
    // Se a pergunta citar um mês/ano/período explícito, usa ESSA janela em
    // vez dos 90 dias fixos (ex.: "bairros críticos em Palmeira em março" ou
    // "...este ano") — mesmo parser de período usado no resto do Xerife.
    // Núcleo de cálculo (sem HTML) — compartilhado entre responderCriticidade
    // (texto do chat) e obterHotspots (dados estruturados pro dashboard
    // JARVIS), pra nunca haver dois jeitos de pontuar criticidade.
    // cidadeForcada: quando informado, pula a detecção por texto (usado por
    // obterHotspots, que recebe a cidade já resolvida).
    async function calcularCriticidade(qOriginal, qMin, cidadeForcada) {
        const [geral, cvp, cvli, droga] = await Promise.all([
            fetchNode('geral'), fetchNode('cvp'), fetchNode('cvli'), fetchNode('droga')
        ]);

        const cidadeAlvo = cidadeForcada || detectarCidadeEmListas(qOriginal, [geral, cvp, cvli, droga]);
        if (!cidadeAlvo) return null;

        const PESOS_CRIT = { cvli: 5, droga: 4, cvp: 3, geral: 1 };
        const periodoInfo = detectarPeriodo(qMin || '');
        let janelaIni, janelaFim, rotuloJanela;
        if (periodoInfo.implicito) {
            const hoje = new Date();
            janelaFim = hoje;
            janelaIni = new Date(hoje); janelaIni.setDate(hoje.getDate() - 90);
            rotuloJanela = 'últimos 90 dias';
        } else {
            janelaIni = periodoInfo.ini; janelaFim = periodoInfo.fim;
            rotuloJanela = periodoInfo.label;
        }
        const dentroJanela = dataStr => { const d = parseData(dataStr); return d && d >= janelaIni && d <= janelaFim; };
        const horaValida = horaStr => {
            if (!horaStr) return null;
            const s = String(horaStr).trim();
            const h = s.includes(':') ? parseInt(s.split(':')[0], 10) : parseInt(s, 10);
            return (h >= 0 && h <= 23) ? h : null;
        };

        const qtd = { manha: {}, tarde: {}, noite: {} };
        const grave = { manha: {}, tarde: {}, noite: {} };
        const totalQtdTurno = { manha: 0, tarde: 0, noite: 0 };
        const totalGraveTurno = { manha: 0, tarde: 0, noite: 0 };
        const cidadeNorm = NORM(cidadeAlvo);

        const fontes = { geral, cvp, cvli, droga };
        Object.keys(fontes).forEach(categoria => {
            fontes[categoria].forEach(item => {
                const cid = NORM(CAMPO(item, 'CIDADE'));
                if (!cid.includes(cidadeNorm)) return;
                const bairro = (CAMPO(item, 'BAIRRO') || '').toUpperCase().trim();
                if (!bairro) return;
                const pesoGravio = categoria !== 'geral' ? (PESOS_CRIT[categoria] || 1) : 0;
                if (!dentroJanela(CAMPO(item, 'DATA', 'data'))) return;
                const h = horaValida(CAMPO(item, 'HORA', 'hora'));
                if (h === null) {
                    const frac = 1 / 3;
                    ['manha', 'tarde', 'noite'].forEach(t => {
                        qtd[t][bairro] = (qtd[t][bairro] || 0) + frac;
                        grave[t][bairro] = (grave[t][bairro] || 0) + (pesoGravio * frac);
                    });
                    return;
                }
                const turno = (h >= 6 && h < 12) ? 'manha' : (h >= 12 && h < 18) ? 'tarde' : 'noite';
                qtd[turno][bairro] = (qtd[turno][bairro] || 0) + 1;
                grave[turno][bairro] = (grave[turno][bairro] || 0) + pesoGravio;
                totalQtdTurno[turno] += 1;
                totalGraveTurno[turno] += pesoGravio;
            });
        });

        const totalGraveValido = Object.values(totalGraveTurno).reduce((a, b) => a + b, 0);
        const totalQtdValido = Object.values(totalQtdTurno).reduce((a, b) => a + b, 0);
        const topBairros = (scores, n) => Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, n).map(e => ({ bairro: e[0], score: e[1] }));

        const nomesTurno = { manha: 'Manhã (06h–12h)', tarde: 'Tarde (12h–18h)', noite: 'Noite (18h–06h)' };
        const turnos = [];
        for (const t of ['manha', 'tarde', 'noite']) {
            const somaGrave = Object.values(grave[t]).reduce((a, b) => a + b, 0);
            const somaQtd = Object.values(qtd[t]).reduce((a, b) => a + b, 0);
            let locais, pct, criterio;
            if (totalGraveTurno[t] > 0 || somaGrave > 0) {
                pct = totalGraveValido > 0 ? (totalGraveTurno[t] / totalGraveValido * 100) : 0;
                locais = topBairros(grave[t], 3);
                criterio = 'gravidade';
            } else if (totalQtdTurno[t] > 0 || somaQtd > 0) {
                pct = totalQtdValido > 0 ? (totalQtdTurno[t] / totalQtdValido * 100) : 0;
                locais = topBairros(qtd[t], 3);
                criterio = 'quantidade';
            } else { locais = []; pct = 0; criterio = null; }
            const nivel = !locais.length ? null : pct > 50 ? 'critico' : pct >= 25 ? 'atencao' : 'normal';
            turnos.push({ chave: t, nome: nomesTurno[t], locais, pct, criterio, nivel });
        }
        return { cidadeAlvo, rotuloJanela, turnos };
    }
    async function responderCriticidade(qOriginal, qMin) {
        let dados;
        try { dados = await calcularCriticidade(qOriginal, qMin); }
        catch (e) { return '⚠️ Não consegui buscar os dados agora. Tente de novo em instantes.'; }
        if (!dados) return 'Preciso saber de qual cidade — pergunte, por exemplo: <em>"quais os horários e bairros críticos em Palmeira dos Índios?"</em>.';

        const NIVEL_LABEL = { critico: '🔴 ROTA CRÍTICA', atencao: '🟠 Atenção', normal: '⬜ Normal' };
        const linhas = dados.turnos.map(t => {
            if (!t.locais.length) return `• <strong>${t.nome}</strong>: sem registros nos últimos 90 dias.`;
            const nomes = t.locais.map(l => l.bairro).join(', ');
            return `• <strong>${t.nome}</strong>: ${nomes} — ${NIVEL_LABEL[t.nivel]} (${t.criterio} ${t.pct.toFixed(0)}%)`;
        });
        return `🗺️ Horários e bairros críticos em <strong>${dados.cidadeAlvo}</strong> (${dados.rotuloJanela} — mesmo critério do Cartão Programa: gravidade &gt; quantidade; peso cvli=5, droga=4, cvp=3):<br>${linhas.join('<br>')}`;
    }

    // ── Visitas orientativas SUGERIDAS (a fazer) ────────────────────────
    // Réplica fiel do critério de buscarOcorrenciasParaVisita() em
    // js/logica_visitas.js (usado em page/gerarvisitas.html): ocorrência do
    // nó /geral cuja tipificação é sensível a escalada de violência + a
    // solução dada NÃO indica encerramento totalmente seguro (inclui casos
    // "resolvidos"/"executados" que ainda merecem acompanhamento) + o relato
    // tem termo crítico — MESMO critério, só devolvido como lista de chat em
    // vez de cards imprimíveis. Diferente da categoria "visita" (que conta
    // visitas orientativas JÁ REALIZADAS, tipificação = "VISITA") — aqui é
    // o oposto: ocorrências que AINDA precisam de visita.
    const VISITA_TIPIFICACOES = ['PERTURBAÇÃO', 'VIOLÊNCIA DOMÉSTICA', 'AMEAÇA', 'LESÃO CORPORAL'];
    const VISITA_SOLUCOES = ['FUGA', 'RESOLVIDO', 'EXECUTADO', 'INDISPONIBILIDADE'];
    const VISITA_TERMOS_CRITICOS = ['FUGIU', 'ARMA', 'DISPARO', 'BATEU', 'AMEAÇOU', 'FACA', 'BRIGOU', 'GRITOU', 'ESPANCOU', 'AGREDIU', 'SANGUE', 'FERIU', 'MACHUCADO', 'VIOLÊNCIA', 'DOMÉSTICA', 'DOMESTICA', 'INDISPONIBILIDADE', 'RESOLVIDO', 'EXECUTADO'];
    function ehVisitasSugeridas(qMin) {
        if (!qMin.includes('visita')) return false;
        return qMin.includes('precisam ser feita') || qMin.includes('precisa ser feita') || qMin.includes('precisam ser realizada') ||
            qMin.includes('sugerid') || qMin.includes('recomend') || qMin.includes('a fazer') || qMin.includes('devo fazer') ||
            qMin.includes('deveria') || qMin.includes('analise de visita') || qMin.includes('risco de escalada') ||
            qMin.includes('quais visitas') || qMin.includes('que visitas');
    }
    // Núcleo de cálculo (sem HTML) — compartilhado entre responderVisitasSugeridas
    // (texto do chat) e obterVisitasSugeridas (dados estruturados pro
    // dashboard JARVIS).
    async function calcularVisitasSugeridas(q, qMin) {
        const geral = await fetchNode('geral');

        const periodoInfo = detectarPeriodo(qMin);
        let ini, fim, rotuloPeriodo;
        if (periodoInfo.implicito) {
            fim = new Date();
            ini = new Date(fim); ini.setDate(fim.getDate() - 90);
            rotuloPeriodo = 'nos últimos 90 dias';
        } else {
            ini = periodoInfo.ini; fim = periodoInfo.fim;
            rotuloPeriodo = periodoInfo.label;
        }
        const cidade = detectarCidadeEmListas(q, [geral]);

        const resultados = [];
        geral.forEach(item => {
            const d = parseData(CAMPO(item, 'DATA', 'data'));
            if (!d || d < ini || d > fim) return;
            if (cidade && NORM(CAMPO(item, 'CIDADE')) !== NORM(cidade)) return;

            const tip = NORM(CAMPO(item, 'TIPIFICACAO_GERAL', 'TIPIFICACAO', 'TIPIFICAÇÃO'));
            const solucao = NORM(CAMPO(item, 'SOLUCAO', 'SOLUÇÃO', 'SOLUCAO_FINAL'));
            const texto = NORM(
                CAMPO(item, 'ATENDIMENTO_INICIAL') + ' ' +
                CAMPO(item, 'TEXTO_DO_DESPACHANTE', 'TEXTO_DESPACHANTE') + ' ' +
                CAMPO(item, 'RELATO')
            );

            const passouTip = VISITA_TIPIFICACOES.some(t => tip.includes(NORM(t)));
            const passouSolucao = VISITA_SOLUCOES.some(t => solucao.includes(NORM(t)));
            const temTermo = VISITA_TERMOS_CRITICOS.some(t => texto.includes(NORM(t)));
            if (!(passouTip && passouSolucao && temTermo)) return;

            resultados.push({
                cop: CAMPO(item, 'BOLETIM', 'NUMEROOCORRENCIA') || '—',
                solicitante: CAMPO(item, 'SOLICITANTE') || 'Não informado',
                natureza: CAMPO(item, 'TIPIFICACAO_GERAL', 'TIPIFICACAO', 'TIPIFICAÇÃO') || '—',
                data: CAMPO(item, 'DATA', 'data') || '—',
                local: `${CAMPO(item, 'BAIRRO') || '—'} - ${CAMPO(item, 'CIDADE') || '—'}`,
                solucao: CAMPO(item, 'SOLUCAO', 'SOLUÇÃO', 'SOLUCAO_FINAL') || '—',
            });
        });

        return { cidade, rotuloPeriodo, resultados };
    }
    async function responderVisitasSugeridas(q, qMin) {
        let dados;
        try { dados = await calcularVisitasSugeridas(q, qMin); }
        catch (e) { return '⚠️ Não consegui buscar os dados agora. Tente de novo em instantes.'; }
        const { cidade, rotuloPeriodo, resultados } = dados;

        const sufixoCidade = cidade ? ` em <strong>${cidade}</strong>` : '';
        if (!resultados.length) return `✅ Não encontrei ocorrências com risco de escalada pendente de visita${sufixoCidade} ${rotuloPeriodo} (mesmo critério de tipificação/solução/termo crítico do Gerar Visitas).`;

        const LIMITE = 15;
        const linhas = resultados.slice(0, LIMITE).map((r, i) =>
            `${i + 1}. COP nº ${r.cop} — <strong>${r.natureza}</strong> (${r.data}) — ${r.local} — desfecho: ${r.solucao} — solicitante: ${r.solicitante}`
        );
        const rodape = resultados.length > LIMITE ? `<br><br>+ ${resultados.length - LIMITE} outra(s) — veja a lista completa em <strong>Visitas Orientativas → Gerar Visitas</strong>.` : '';
        return `🚨 <strong>${resultados.length}</strong> ocorrência(s) com risco de escalada pendente de visita orientativa${sufixoCidade} ${rotuloPeriodo} (mesmo critério do Gerar Visitas):<br>${linhas.join('<br>')}${rodape}`;
    }

    // ── Cartão Programa das guarnições ───────────────────────────────
    // Chama window.processarDados() DIRETO — a MESMA função de
    // js/gerarcartao.js (usada em relatorios/cartaoprograma.html), que já
    // cobre RPs e os Táticos (Urbano/Rural 01/Rural 02). Antes esse trecho
    // era uma "réplica fiel" copiada aqui — dava pra divergir sem querer
    // (e de fato divergiu: não tinha os Táticos). js/gerarcartao.js
    // precisa estar incluído na página (ver <script> em page/ia_xerife.html
    // e page/chat-mobile.html) — se não estiver, processarCartaoPrograma()
    // avisa em vez de quebrar.
    const MAPA_RP_CIDADES = {
        "RP 01": ["PALMEIRA DOS ÍNDIOS"],
        "RP 02": ["PALMEIRA DOS ÍNDIOS"],
        "BELÉM": ["BELÉM", "TANQUE D'ARCA"],
        "CACIMBINHAS": ["CACIMBINHAS"],
        "MINADOR DO NEGRÃO": ["MINADOR DO NEGRÃO", "ESTRELA DE ALAGOAS"],
        "MAR VERMELHO": ["MAR VERMELHO", "PAULO JACINTO"],
        "PAULO JACINTO": ["PAULO JACINTO", "MAR VERMELHO"],
        "TANQUE D'ARCA": ["TANQUE D'ARCA", "BELÉM"],
        "MARIBONDO": ["MARIBONDO"],
        "ESTRELA DE ALAGOAS": ["ESTRELA DE ALAGOAS", "MINADOR DO NEGRÃO"],
        "IGACI": ["IGACI"],
        "QUEBRANGULO": ["QUEBRANGULO"],
    };
    // RP 03..RP 09 são o NÚMERO da viatura real de patrulhamento (mesmo
    // valor visto no rastreamento GPS — ver js/cumprimento-core.js:
    // SEED_RP_VIATURA, duplicado aqui de propósito pra não ter que
    // carregar aquele módulo só pra resolver um número falado). Só RP
    // 01/RP 02 (Palmeira) são chave literal em MAPA_RP_CIDADES — as demais
    // cidades não têm o número escrito, então "cartão programa da RP 03"
    // não achava nada antes desta tabela existir.
    const NUMERO_RP_PARA_CHAVE = {
        '03': 'MARIBONDO',
        '04': 'BELÉM', // TANQUE D'ARCA é a mesma guarnição (RP 04)
        '05': 'QUEBRANGULO',
        '06': 'PAULO JACINTO', // MAR VERMELHO é a mesma guarnição (RP 06)
        '07': 'IGACI',
        '08': 'ESTRELA DE ALAGOAS', // MINADOR DO NEGRÃO é a mesma guarnição (RP 08)
        '09': 'CACIMBINHAS',
    };
    // Coordenadas aproximadas do CENTRO de cada município da área de
    // atuação (mesmas cidades de MAPA_RP_CIDADES acima) — o sistema NÃO tem
    // geocodificação de bairro/endereço (BAIRRO é só texto livre), então o
    // mapa do dashboard JARVIS só consegue posicionar por CIDADE, nunca por
    // rua/bairro real. Cidade sem entrada aqui simplesmente não aparece no
    // mapa (nunca inventa coordenada).
    const CIDADE_COORDS_X = {
        "PALMEIRA DOS ÍNDIOS": [-9.4059, -36.6285],
        "BELÉM": [-9.6285, -36.4241],
        "TANQUE D'ARCA": [-9.6113, -36.3813],
        "CACIMBINHAS": [-9.3999, -36.9522],
        "MINADOR DO NEGRÃO": [-9.3552, -36.8144],
        "ESTRELA DE ALAGOAS": [-9.3527, -36.9138],
        "MAR VERMELHO": [-9.5427, -36.4934],
        "PAULO JACINTO": [-9.3966, -36.3958],
        "MARIBONDO": [-9.3742, -36.3527],
        "IGACI": [-9.5241, -36.6469],
        "QUEBRANGULO": [-9.3299, -36.4708],
    };
    // Busca por nome comparando SEM acento (NORM) dos dois lados — as
    // cidades vêm do Firebase com acento (ex.: "Palmeira dos Índios"), mas
    // NORM(cidade) removeria o acento e não bateria contra uma chave do
    // dicionário que também tem acento ("ÍNDIOS" ≠ "INDIOS").
    function coordsPorCidade(cidade) {
        const alvo = NORM(cidade);
        for (const nome of Object.keys(CIDADE_COORDS_X)) {
            if (NORM(nome) === alvo) return CIDADE_COORDS_X[nome];
        }
        return null;
    }

    // Checado ANTES de ehCartaoPrograma (mais abaixo) — este é bem mais
    // específico ("cumpriu o cartão"/"cumprimento da OPO"), e ehCartaoPrograma
    // bateria de qualquer forma (também contém "cartao"+"programa").
    function ehCumprimentoCartao(qMin) {
        const falaDeCartaoOuOpo = qMin.includes('cartao') || qMin.includes(' opo') || qMin.includes('opo ') || qMin === 'opo';
        // "compr" além de "cumpr" — "comprimento" (mesmo som/erro de
        // digitação comum de "cumprimento" em português, muito provável
        // vindo de voz) também tem que cair aqui, não em ehCartaoPrograma.
        // "porcentagem"/"percentual" também contam: perguntar "qual a
        // porcentagem do cartão programa" só faz sentido como pergunta de
        // CUMPRIMENTO (o cronograma em si não tem "porcentagem" nenhuma).
        const falaDeCumprimento = /cumpr|compr|falh|nao cumpr|porcentagem|percentual/.test(qMin);
        return falaDeCartaoOuOpo && falaDeCumprimento;
    }
    // Tenta achar uma cidade citada na pergunta comparando contra as
    // cidades já conhecidas (CIDADE_COORDS_X) — sem acento, igual ao resto
    // do arquivo. Sem nenhuma cidade citada, cumprimento é calculado pra
    // TODOS os cartões/OPOs salvos da unidade (sem filtro de cidade).
    function extrairCidadeCumprimento(qMin) {
        for (const cidade of Object.keys(CIDADE_COORDS_X)) {
            if (qMin.includes(NORM(cidade).toLowerCase())) return cidade;
        }
        return null;
    }
    // Carregamento sob demanda de js/cumprimento-core.js — mesmo padrão de
    // carregarModuloDocumentos() (mais abaixo): só baixa esse módulo
    // (cruzamento com o Firebase de frota/rastreamento) quando alguém
    // realmente pergunta sobre cumprimento, não em toda página do sistema.
    let promessaCumprimentoCore = null;
    function carregarCumprimentoCore() {
        if (window.CumprimentoCore) return Promise.resolve();
        if (!promessaCumprimentoCore) {
            promessaCumprimentoCore = new Promise((resolve, reject) => {
                const prefixo = /\/(page|relatorios|public|termos)\//.test(location.pathname) ? '../' : '';
                const s = document.createElement('script');
                s.src = prefixo + 'js/cumprimento-core.js';
                s.onload = () => resolve();
                s.onerror = () => reject(new Error('falha ao carregar js/cumprimento-core.js'));
                document.body.appendChild(s);
            });
        }
        return promessaCumprimentoCore;
    }
    // Cumprimento de cartão-programa/OPO salvos — cruza com o rastreamento
    // GPS real das viaturas (Firebase de frota do 10º BPM, ver
    // js/cumprimento-core.js). cidade: opcional (filtra cartões cuja
    // `cidade` contém o texto, sem acento); textoPeriodo: texto livre,
    // mesmo detectarPeriodo() do resto do arquivo, filtra pela DATA DE
    // CRIAÇÃO do cartão/OPO salvo (não pela data do cronograma em si).
    async function obterCumprimentoCartoes(cidade, textoPeriodo) {
        await garantirConfig();
        try { await carregarCumprimentoCore(); } catch (e) { return { totalCartoes: 0, mediaPercentualCumprimento: null, detalhePorCartao: [] }; }
        if (!window.CumprimentoCore) return { totalCartoes: 0, mediaPercentualCumprimento: null, detalhePorCartao: [] };

        let salvos = null;
        try {
            const res = await fetch(`${DATABASE_URL}/cartoes_programa.json`);
            salvos = res.ok ? (await res.json()) : null;
        } catch (e) { salvos = null; }
        if (!salvos) return { totalCartoes: 0, mediaPercentualCumprimento: null, detalhePorCartao: [] };

        const periodo = detectarPeriodo(NORM(textoPeriodo || '').toLowerCase());
        const cidadeAlvo = cidade ? NORM(cidade) : null;
        const dataIniISO = periodo.ini.toISOString().slice(0, 10);
        const dataFimISO = periodo.fim.toISOString().slice(0, 10);

        // Cartão-programa é uma ROTINA DIÁRIA recorrente, não um evento
        // pontual — não filtra por data de criação; em vez disso pega só o
        // cartão MAIS RECENTE salvo por cidade/tipo (evita analisar o mesmo
        // RP duas vezes se foi salvo mais de uma vez) e aplica esse
        // cronograma contra o histórico real de TODO o período pedido.
        let lista = Object.entries(salvos).map(([id, v]) => Object.assign({ id }, v));
        if (cidadeAlvo) lista = lista.filter(c => NORM(c.cidade || '').includes(cidadeAlvo));
        lista.sort((a, b) => new Date(b.criadoEm || 0) - new Date(a.criadoEm || 0));
        const vistos = new Set();
        lista = lista.filter(c => {
            const chave = (c.tipo || 'cartao') + '|' + (c.cidade || '');
            if (vistos.has(chave)) return false;
            vistos.add(chave);
            return true;
        }).slice(0, 6); // limita cruzamentos por resposta (cada um busca histórico real na planilha)

        const detalhePorCartao = [];
        for (const cartao of lista) {
            try {
                const cronograma = cartao.tipo === 'opo'
                    ? (cartao.alocacoes || []).map(a => ({ ini: a.ini || '00:00', fim: a.fim || '23:59', miss: a.guarnicao, det: a.cidade, area: a.area }))
                    : (cartao.cronograma || []);
                const r = await window.CumprimentoCore.calcularCumprimentoPeriodo({
                    cronograma, viaturaNome: cartao.viaturaResponsavel, dataIniISO, dataFimISO,
                });
                detalhePorCartao.push({
                    id: cartao.id, tipo: cartao.tipo, cidade: cartao.cidade, data: cartao.data,
                    viaturaResponsavel: cartao.viaturaResponsavel || null,
                    viaturaEncontrada: r.viaturaEncontrada,
                    percentualCumprido: r.percentualCumprido, percentualFalha: r.percentualFalha,
                    totalBlocos: r.totalBlocos, blocosCumpridos: r.blocosCumpridos,
                });
            } catch (e) { /* pula esse cartão/OPO, não trava os demais */ }
        }

        const validos = detalhePorCartao.filter(d => d.percentualCumprido !== null);
        const mediaPercentualCumprimento = validos.length
            ? Math.round(validos.reduce((s, d) => s + d.percentualCumprido, 0) / validos.length)
            : null;
        return { totalCartoes: detalhePorCartao.length, mediaPercentualCumprimento, detalhePorCartao, periodoLabel: periodo.label };
    }
    async function responderCumprimentoCartao(q, qMin) {
        const cidade = extrairCidadeCumprimento(qMin);
        let resultado;
        try { resultado = await obterCumprimentoCartoes(cidade, qMin); }
        catch (e) { return '⚠️ Não consegui cruzar o cartão-programa com o rastreamento agora. Tenta de novo?'; }

        if (!resultado.totalCartoes) {
            return `🤔 Não encontrei nenhum cartão-programa ou OPO salvo${cidade ? ' pra <strong>' + escHtml(cidade) + '</strong>' : ''}. Gere e salve um cartão em <strong>Cartão-Programa</strong> ou uma OPO em <strong>OPO Inteligente</strong> primeiro, e depois pergunte de novo.`;
        }

        const linhas = resultado.detalhePorCartao.map(d => {
            let pct;
            if (d.percentualCumprido !== null) pct = `${d.percentualCumprido}% cumprido / ${d.percentualFalha}% falha`;
            else if (!d.viaturaEncontrada) pct = 'guarnição não encontrada na planilha de rastreamento';
            else pct = 'sem histórico suficiente nesse período';
            const tipoLabel = d.tipo === 'opo' ? 'OPO' : 'Cartão';
            return `<li><strong>${escHtml(d.cidade || '')}</strong> (${tipoLabel}, guarnição ${escHtml(d.viaturaResponsavel || '?')}) — ${pct}</li>`;
        }).join('');

        const mediaTxt = resultado.mediaPercentualCumprimento === null ? 'sem dados suficientes' : `${resultado.mediaPercentualCumprimento}%`;
        return `📋 <strong>Cumprimento do Cartão-Programa/OPO${cidade ? ' — ' + escHtml(cidade) : ''}</strong><br>` +
            `Período: <strong>${escHtml(resultado.periodoLabel || '')}</strong> | Média de cumprimento: <strong>${mediaTxt}</strong> (${resultado.totalCartoes} registro(s) analisado(s))` +
            `<ul>${linhas}</ul>` +
            `<small>Cálculo usando o histórico real da planilha (aba rastreamento_historico) — critério: tempo mínimo de permanência dentro do perímetro em cada bloco do cronograma.</small>`;
    }

    // ── Gestão de frota (sinistros, revisão/manutenção, dossiê de viatura
    // e de motorista) — cruza os nós reais do MESMO Firebase de frota já
    // usado pelo rastreamento/cumprimento (ver js/cumprimento-core.js:
    // rankingMotoristasSinistro, rankingViaturasSinistro,
    // viaturasProximasRevisao, obterDossieViatura, obterDossieMotorista).
    // Pedido explícito do usuário — nunca inventa número, sempre os nós
    // reais /sinistros, /manutencao, /vistorias, /motoristas, /viaturas.
    function ehRankingSinistroMotorista(qMin) {
        return qMin.includes('sinistro') && (qMin.includes('motorista') || qMin.includes('condutor')) &&
            (qMin.includes('mais') || qMin.includes('ranking') || qMin.includes('quem'));
    }
    function ehRankingSinistroViatura(qMin) {
        return qMin.includes('sinistro') && qMin.includes('viatura') &&
            (qMin.includes('mais') || qMin.includes('ranking') || qMin.includes('qual'));
    }
    function ehRevisaoViatura(qMin) {
        return (qMin.includes('revisao') || qMin.includes('manutencao')) && qMin.includes('viatura');
    }
    function ehDossieViatura(qMin) {
        return qMin.includes('dossie') && qMin.includes('viatura');
    }
    function ehDossieMotorista(qMin) {
        return qMin.includes('dossie') && (qMin.includes('motorista') || qMin.includes('condutor'));
    }
    // Pega o texto livre depois de "dossiê da viatura"/"dossiê do
    // motorista" no texto ORIGINAL (preserva prefixo tipo "30-1260" e
    // nomes com acento) — mesmo padrão de extração usada pra busca no
    // Dashboard Mapa.
    function extrairAlvoDossie(textoOriginal, tipo) {
        const re = tipo === 'viatura' ? /dossi[eê]\s+d[ae]\s+viatura\s+(.+)/i : /dossi[eê]\s+d[oa]\s+motorista\s+(.+)/i;
        const m = textoOriginal.match(re);
        return m ? m[1].trim().replace(/[?.!]+$/, '') : null;
    }
    async function responderRankingSinistroMotorista() {
        try {
            await carregarCumprimentoCore();
            if (!window.CumprimentoCore) return '⚠️ Não consegui acessar os dados de frota agora.';
            const ranking = await window.CumprimentoCore.rankingMotoristasSinistro(10);
            if (!ranking.length) return 'Não encontrei sinistros registrados na frota.';
            const linhas = ranking.map((m, i) => `${i + 1}. <strong>${escHtml(m.nome)}</strong>${m.posto ? ' (' + escHtml(m.posto) + ')' : ''} — <strong>${m.total}</strong> sinistro(s)`);
            return `🚗 <strong>Ranking de sinistros por motorista</strong>:<br>${linhas.join('<br>')}`;
        } catch (e) { return '⚠️ Não consegui buscar os dados de frota agora.'; }
    }
    async function responderRankingSinistroViatura() {
        try {
            await carregarCumprimentoCore();
            if (!window.CumprimentoCore) return '⚠️ Não consegui acessar os dados de frota agora.';
            const ranking = await window.CumprimentoCore.rankingViaturasSinistro(10);
            if (!ranking.length) return 'Não encontrei sinistros registrados na frota.';
            const linhas = ranking.map((v, i) => `${i + 1}. <strong>${escHtml(v.prefixo || v.placa || '—')}</strong>${v.modelo ? ' (' + escHtml(v.modelo) + ')' : ''} — <strong>${v.total}</strong> sinistro(s)`);
            return `🚓 <strong>Ranking de sinistros por viatura</strong>:<br>${linhas.join('<br>')}`;
        } catch (e) { return '⚠️ Não consegui buscar os dados de frota agora.'; }
    }
    async function responderRevisaoViatura(qMin) {
        try {
            await carregarCumprimentoCore();
            if (!window.CumprimentoCore) return '⚠️ Não consegui acessar os dados de frota agora.';
            const soVencidas = /vencid|atrasad|precisa|necessit/.test(qMin);
            const lista = await window.CumprimentoCore.viaturasProximasRevisao(10, soVencidas);
            if (!lista.length) return soVencidas ? '✅ Nenhuma viatura está com a revisão vencida agora.' : 'Não encontrei dados de manutenção da frota.';
            const linhas = lista.map(v => `<strong>${escHtml(v.prefixo || v.placa || '—')}</strong>${v.modelo ? ' (' + escHtml(v.modelo) + ')' : ''} — ${v.vencida ? `🔴 revisão vencida há ${Math.abs(v.faltaKm)} km` : `faltam <strong>${v.faltaKm}</strong> km (${v.kmAtual ?? '—'}/${v.proxRevisao ?? '—'})`}`);
            return `🔧 <strong>${soVencidas ? 'Viaturas com revisão vencida' : 'Viaturas mais próximas da revisão'}</strong>:<br>${linhas.join('<br>')}`;
        } catch (e) { return '⚠️ Não consegui buscar os dados de manutenção agora.'; }
    }
    async function responderDossieViatura(textoOriginal) {
        const alvo = extrairAlvoDossie(textoOriginal, 'viatura');
        if (!alvo) return 'Qual viatura? Diga o prefixo (ex.: "30-1260") ou a placa.';
        try {
            await carregarCumprimentoCore();
            if (!window.CumprimentoCore) return '⚠️ Não consegui acessar os dados de frota agora.';
            const dossie = await window.CumprimentoCore.obterDossieViatura(alvo);
            if (!dossie) return `🤔 Não encontrei nenhuma viatura "${escHtml(alvo)}" na frota.`;
            const partes = [];
            if (dossie.viatura) partes.push(`🚓 <strong>${escHtml(dossie.viatura.prefixo || '—')}</strong> — ${escHtml(dossie.viatura.marca || '')} ${escHtml(dossie.viatura.modelo || '')} (${escHtml(dossie.viatura.placa || '—')}), ${escHtml(dossie.viatura.status || 'status não informado')}, ${dossie.viatura.kmAtual ?? '—'} km`);
            if (dossie.manutencao) partes.push(`🔧 Manutenção: próxima revisão aos ${dossie.manutencao.proxRevisao ?? '—'} km (faltam ${dossie.manutencao.faltaKm ?? '—'} km) — ${escHtml(dossie.manutencao.situacao || '—')}`);
            const linhasSinistro = dossie.sinistros.map(s => `&nbsp;&nbsp;• ${s.data || '—'}: ${(s.tipos || []).join(', ') || 'sem tipo'} — ${escHtml(s.danos || 'sem descrição')}`).join('<br>');
            partes.push(`💥 Sinistros: <strong>${dossie.totalSinistros}</strong> registrado(s)` + (linhasSinistro ? '<br>' + linhasSinistro : ''));
            if (dossie.ultimaVistoria) partes.push(`📋 Última vistoria: ${String(dossie.ultimaVistoria.dataHora || '').slice(0, 10) || '—'}, km ${dossie.ultimaVistoria.km || '—'}, por ${escHtml(dossie.ultimaVistoria.motorista || dossie.ultimaVistoria.nomeCivil || '—')}`);
            return partes.join('<br><br>');
        } catch (e) { return '⚠️ Não consegui montar o dossiê agora.'; }
    }
    async function responderDossieMotorista(textoOriginal) {
        const alvo = extrairAlvoDossie(textoOriginal, 'motorista');
        if (!alvo) return 'Qual motorista? Diga o nome ou a matrícula.';
        try {
            await carregarCumprimentoCore();
            if (!window.CumprimentoCore) return '⚠️ Não consegui acessar os dados de frota agora.';
            const dossie = await window.CumprimentoCore.obterDossieMotorista(alvo);
            if (!dossie) return `🤔 Não encontrei nenhum motorista "${escHtml(alvo)}" cadastrado.`;
            const partes = [];
            if (dossie.motorista) partes.push(`👤 <strong>${escHtml(dossie.motorista.nomeGuerra || dossie.motorista.nomeCivil || '—')}</strong> (${escHtml(dossie.motorista.posto || '—')}), matrícula ${escHtml(dossie.motorista.matricula || '—')}, CNH ${escHtml(dossie.motorista.categoriaCnh || '—')}, status ${escHtml(dossie.motorista.status || '—')}`);
            const linhasSinistro = dossie.sinistros.map(s => `&nbsp;&nbsp;• ${s.data || '—'}: ${(s.tipos || []).join(', ') || 'sem tipo'} (viatura ${escHtml(s.prefixo || '—')})`).join('<br>');
            partes.push(`💥 Sinistros como condutor: <strong>${dossie.totalSinistros}</strong>` + (linhasSinistro ? '<br>' + linhasSinistro : ''));
            partes.push(`📋 Vistorias realizadas: <strong>${dossie.totalVistoriasRealizadas}</strong>`);
            return partes.join('<br><br>');
        } catch (e) { return '⚠️ Não consegui montar o dossiê agora.'; }
    }

    function ehCartaoPrograma(qMin) {
        return qMin.includes('cartao programa') || qMin.includes('cartao de programa') ||
            (qMin.includes('cartao') && qMin.includes('programa')) ||
            (qMin.includes('programa') && (qMin.includes('guarnicao') || qMin.includes('patrulhamento') || / rp\b|\brp /.test(qMin)));
    }
    // Aceita citar a RP direto ("RP 01", "Paulo Jacinto"), só a cidade
    // ("cartão programa de Palmeira") ou um Tático ("cartão do tático
    // urbano", "tático rural 01/1") — usa o mesmo texto NORM (maiúsculo,
    // sem acento) já usado no resto do arquivo pra casar com as chaves.
    function detectarRPNaPergunta(q) {
        // Táticos primeiro — não têm 1 cidade fixa em MAPA_RP_CIDADES
        // (Rural 01/02 seguem a mancha criminal geral, não uma área só —
        // ver processarDadosTatico em js/gerarcartao.js), então usa direto
        // o mesmo texto que window.processarDados espera pra rotear.
        if (q.includes('TATICO') && q.includes('URBANO')) return 'TÁTICO URBANO';
        if (q.includes('TATICO') && q.includes('RURAL') && (q.includes(' 01') || q.includes(' 1') || / rural 1\b/.test(q))) return 'TÁTICO RURAL 01';
        if (q.includes('TATICO') && q.includes('RURAL') && (q.includes(' 02') || q.includes(' 2') || / rural 2\b/.test(q))) return 'TÁTICO RURAL 02';
        for (const chave of Object.keys(MAPA_RP_CIDADES)) {
            if (q.includes(NORM(chave))) return chave;
        }
        const mNumeroRP = q.match(/\bRP\s*0?(\d{1,2})\b/);
        if (mNumeroRP) {
            const numAlvo = mNumeroRP[1].padStart(2, '0');
            if (NUMERO_RP_PARA_CHAVE[numAlvo]) return NUMERO_RP_PARA_CHAVE[numAlvo];
        }
        for (const [chave, cidades] of Object.entries(MAPA_RP_CIDADES)) {
            if (cidades.some(c => q.includes(NORM(c)))) return chave;
        }
        return null;
    }

    // Mesmo padrão de carregarCumprimentoCore() acima: js/gerarcartao.js só
    // baixa quando alguém realmente pergunta sobre cartão-programa, não em
    // toda página do sistema que inclui xerife.js.
    let promessaGerarCartao = null;
    function carregarGerarCartao() {
        if (window.processarDados) return Promise.resolve();
        if (!promessaGerarCartao) {
            promessaGerarCartao = new Promise((resolve, reject) => {
                const prefixo = /\/(page|relatorios|public|termos)\//.test(location.pathname) ? '../' : '';
                const s = document.createElement('script');
                s.src = prefixo + 'js/gerarcartao.js';
                s.onload = () => resolve();
                s.onerror = () => reject(new Error('falha ao carregar js/gerarcartao.js'));
                document.body.appendChild(s);
            });
        }
        return promessaGerarCartao;
    }

    async function processarCartaoPrograma(chaveRP) {
        await carregarGerarCartao();
        if (!window.processarDados) throw new Error('gerarcartao.js não carregado');
        const [geral, cvp, cvli, droga] = await Promise.all([
            fetchNode('geral'), fetchNode('cvp'), fetchNode('cvli'), fetchNode('droga')
        ]);
        const dados = window.processarDados(chaveRP, { geral, cvp, cvli, droga });
        return {
            cidadesAlvo: dados.cidadesPatrulhadas,
            cronograma: dados.cronograma,
            resumo: dados.resumo,
            totalQtd: dados.totalQtd,
        };
    }

    // Cruzamento com a posição REAL da guarnição agora, via mesma planilha
    // de rastreamento usada por page/rastreamento-guarnicao.html e
    // js/cumprimento-core.js (obterGuarnicoesPlanilha) — pedido explícito
    // do usuário: só quando a pergunta é sobre uma RP/cidade (não em
    // buscas de CPF/nome/boletim/processo, sem relação com viatura).
    // Só tenta pra chaves que normalizam pra "RP0X" (RP01..RP09) — as
    // demais chaves do cartão-programa são NOMES DE CIDADE (ex.: "PAULO
    // JACINTO", "MARIBONDO"), que não têm correspondência garantida com o
    // campo `nome` real da planilha (esse é por rádio/unidade, tipo "RP
    // 03", "RURAL 01", "PELOPES 01" — nunca literalmente o nome da
    // cidade) — mostrar um cruzamento adivinhado seria pior que não
    // mostrar nenhum, então nesses casos a função só devolve vazio.
    async function anexarStatusRealRP(chaveRP) {
        try {
            await carregarCumprimentoCore();
            if (!window.CumprimentoCore) return '';
            const chave = window.CumprimentoCore.normalizarGuarnicao(chaveRP);
            if (!/^RP\d{2}$/.test(chave)) return '';
            const guarnicoes = await window.CumprimentoCore.obterGuarnicoesPlanilha();
            const v = guarnicoes[chave];
            if (!v || v.offline) return '';
            let tempoTxt = 'horário desconhecido';
            if (v.dataHoraGEO) {
                const minAtras = Math.round((Date.now() - new Date(v.dataHoraGEO).getTime()) / 60000);
                if (!isNaN(minAtras) && minAtras >= 0) tempoTxt = minAtras <= 0 ? 'agora' : `há ${minAtras} min`;
            }
            const partes = [];
            if (v.status) partes.push(escHtml(v.status));
            if (v.militares) partes.push(escHtml(v.militares));
            return `<br><br>📡 <strong>Posição real agora</strong> (rastreamento): ${partes.join(' — ') || 'sem detalhe'} — atualizado ${tempoTxt}.`;
        } catch (e) { return ''; } // rastreamento indisponível — cartão-programa segue funcionando normal, sem esse trecho
    }

    async function responderCartaoPrograma(q, qMin) {
        const chaveRP = detectarRPNaPergunta(q);
        if (!chaveRP) {
            return 'De qual guarnição/RP você quer o Cartão Programa? <strong>RP 01, RP 02, Belém, Cacimbinhas, Minador do Negrão, Mar Vermelho, Paulo Jacinto, Tanque D\'Arca, Maribondo, Estrela de Alagoas, Igaci</strong> ou <strong>Quebrangulo</strong>?';
        }
        let dados;
        try { dados = await processarCartaoPrograma(chaveRP); }
        catch (e) { return '⚠️ Não consegui buscar os dados agora. Tente de novo em instantes.'; }

        const linhas = dados.cronograma.map(l => {
            const marca = l.h === 'red' ? ' 🔴 ROTA CRÍTICA' : l.h === 'orange' ? ' 🟠 atenção' : l.h === 'green' ? ' 🟢' : '';
            return `<strong>${l.ini}–${l.fim}</strong> — ${l.miss} — ${l.det}${marca}`;
        });
        const resumoHTML = dados.totalQtd > 0
            ? `📊 <strong>${dados.totalQtd}</strong> registros (90 dias) — ${dados.cidadesAlvo.join(' + ')}: ${dados.resumo}`
            : `⚠️ Sem registros nos últimos 90 dias — exibindo bairros com maior histórico geral.`;

        const statusReal = await anexarStatusRealRP(chaveRP);

        return `🚓 <strong>Cartão Programa — ${chaveRP}</strong> (${dados.cidadesAlvo.join(' / ')}) — ${new Date().toLocaleDateString('pt-BR')}:<br>${resumoHTML}<br><br>` +
            linhas.join('<br>') +
            `<br><br><small>Critério: gravidade (cvli×5, droga×4, cvp×3) &gt; quantidade, últimos 90 dias — mesma lógica de relatorios/cartaoprograma.html.</small>` +
            statusReal;
    }

    // Produtividade do COPOM — mesma extração de atendente de js/dashboard-copom.js.
    async function responderAtendenteCopom(q, qMin) {
        let geral;
        try { geral = await fetchNode('geral'); } catch (e) { return '⚠️ Não consegui buscar os dados agora. Tente de novo em instantes.'; }
        const periodo = detectarPeriodo(qMin);
        const cidade = detectarCidadeEmListas(q, [geral]);
        let lista = geral.filter(i => { const d = parseData(CAMPO(i, 'DATA', 'data')); return d && d >= periodo.ini && d <= periodo.fim; });
        if (cidade) lista = lista.filter(i => NORM(CAMPO(i, 'CIDADE')) === NORM(cidade));
        const cont = {};
        lista.forEach(i => {
            const v = CAMPO(i, 'atendente', 'ATENDENTE');
            const nome = v && v !== '---' ? v.toUpperCase() : null;
            if (nome) cont[nome] = (cont[nome] || 0) + 1;
        });
        const top = Object.entries(cont).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const sufixoCidade = cidade ? ` em <strong>${cidade}</strong>` : '';
        if (!top.length) return `Não encontrei atendentes/despachantes identificados no COPOM ${periodo.label}${sufixoCidade}.`;
        return `🎧 Atendentes do COPOM com mais ocorrências ${periodo.label}${sufixoCidade}:<br>` + top.map((e, i) => `${i + 1}. <strong>${e[0]}</strong> — ${e[1]}`).join('<br>');
    }

    // ── Dossiê determinístico p/ IA ─────────────────────────────────────
    // Monta um JSON só com números JÁ CALCULADOS (nunca dados brutos demais
    // pra não estourar o contexto do modelo, nem deixar margem pra ele
    // "recalcular" por conta própria). Aceita VÁRIAS categorias de uma vez
    // (ex.: "me dê CVP, MVI e TCO"), pra IA conseguir estruturar tudo numa
    // resposta só, em vez de só a 1ª categoria mencionada.
    async function montarDossieMultiCategoria(chaves, q, qMin) {
        const dossies = [];
        for (const chaveCat of chaves) {
            const cat = CATEGORIAS[chaveCat];
            if (!cat) continue;
            try {
                const bruto = await cat.fetch();
                const base = bruto.filter(cat.filtroBase);
                const periodo = detectarPeriodo(qMin);
                const cidade = detectarCidade(q, base, cat);
                let filtrada = base.filter(i => { const d = parseData(cat.campoData(i)); return d && d >= periodo.ini && d <= periodo.fim; });
                if (cidade) filtrada = filtrada.filter(i => NORM(cat.campoCidade(i)) === NORM(cidade));

                const dossie = {
                    categoria: cat.label,
                    periodo: periodo.label,
                    cidadeFiltrada: cidade || 'nenhuma (todas as cidades da unidade)',
                    totalRegistros: filtrada.length,
                };
                if (chaveCat === 'mvicvli') {
                    const mvi = filtrada.filter(isMVI).length;
                    dossie.totalMVI = mvi;
                    dossie.percentualMVIsobreCVLI = filtrada.length ? Math.round(mvi / filtrada.length * 100) : 0;
                }
                if (cat.campoCidade) dossie.top5Cidades = topEntries(filtrada, cat.campoCidade, 5);
                if (cat.campoBairro) dossie.top5Bairros = topEntries(filtrada, cat.campoBairro, 5);
                dossie.top5Tipificacoes = topEntries(filtrada, cat.campoTip, 5);
                if (cat.campoNome) dossie.top5Nomes = { label: cat.labelNome, valores: topEntries(filtrada, cat.campoNome, 5) };
                dossies.push(dossie);
            } catch (e) { /* categoria falhou (ex.: TCO/GAS fora do ar) — segue pras outras */ }
        }
        return dossies;
    }

    // Converte a resposta em texto do modelo (que às vezes usa markdown
    // simples) pro mesmo estilo HTML enxuto usado no resto do chat.
    function formatarRespostaIA(texto) {
        let t = escHtml(String(texto || '').trim());
        t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        t = t.replace(/\n/g, '<br>');
        return t || 'Não consegui montar uma resposta agora.';
    }

    const SYSTEM_PROMPT_XERIFE = 'Você é o Xerife, assistente de dados operacionais de uma unidade da Polícia Militar brasileira. ' +
        'Glossário fixo (nunca interprete essas siglas de outro jeito): MVI = Morte Violenta Intencional; CVLI = Crime Violento Letal Intencional; ' +
        'CVP = Crime Violento contra o Patrimônio; TCO = Termo Circunstanciado de Ocorrência; COPOM = Centro de Operações da Polícia Militar. ' +
        'Responda SEMPRE em português do Brasil, de forma direta, objetiva e analítica — tom de assessoria operacional, sem enrolação e sem emojis em excesso. ' +
        'O contexto pode trazer UMA LISTA com várias categorias ao mesmo tempo (ex.: MVI, CVP e TCO juntos) — nesse caso, estruture a resposta com uma seção/linha clara pra cada categoria da lista, sem misturar os números de uma com os de outra. ' +
        'Sua ÚNICA fonte de dados é o JSON de contexto fornecido pelo usuário — que já vem filtrado com os dados REAIS e EXCLUSIVOS desta unidade. Você NUNCA tem acesso a nenhuma outra cidade, comarca, unidade ou estatística do Brasil ou do mundo — não existe nenhum outro dado além do que está no JSON. ' +
        'Use SOMENTE os números presentes nesse JSON — nunca invente, estime ou recalcule números que não estejam explicitamente lá, nunca cite nomes de cidades/lugares que não apareçam no JSON, e nunca monte tabelas ou compare períodos que não estejam ambos presentes no contexto. ' +
        'Se a pergunta pedir algo que não está no contexto (outra cidade, outro período, outra comparação, outro recorte como "por motivo X"), diga claramente que não tem esse dado disponível — nunca preencha a lacuna com um número ou nome inventado. ' +
        'Não mencione a existência de um "JSON" ou "contexto" — responda como se você já soubesse esses números, mas sem jamais ultrapassar o que eles mostram.';

    // Caminho via IA local: monta o dossiê determinístico das categorias já
    // identificadas com certeza (ver podeUsarIA em responderPergunta — nunca
    // é chamada sem isso) e pede pro modelo redigir a resposta em linguagem
    // natural usando só esses números.
    // Acesso genérico à IA local — usado por responderComIA() abaixo e
    // exposto em window.Xerife pra módulos externos (ex.: js/xerife-
    // documentos.js) poderem pedir extrações pontuais sem duplicar a
    // integração com o WebLLM nem acessar llmEngine diretamente.
    async function gerarComIA(mensagens, opcoes) {
        if (!llmEngine || llmEstado !== 'pronto') return null;
        try {
            const resp = await llmEngine.chat.completions.create({
                messages: mensagens,
                temperature: (opcoes && opcoes.temperature) || 0.2,
                max_tokens: (opcoes && opcoes.max_tokens) || 400,
            });
            return (resp && resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content) || null;
        } catch (e) { return null; }
    }

    async function responderComIA(textoOriginal, q, qMin, chavesCategorias) {
        const contexto = await montarDossieMultiCategoria(chavesCategorias, q, qMin);
        const mensagemUsuario = `Pergunta: "${textoOriginal}"\n\nDados disponíveis (JSON):\n${JSON.stringify(contexto)}`;

        // Últimas trocas da conversa (memória) — dá contexto real pro modelo
        // sobre o que já foi perguntado/respondido antes nesta sessão.
        const mensagensHistorico = [];
        carregarHistorico().slice(-6).forEach(h => {
            mensagensHistorico.push({ role: 'user', content: h.pergunta });
            mensagensHistorico.push({ role: 'assistant', content: htmlParaTexto(h.respostaHtml) });
        });

        const resp = await llmEngine.chat.completions.create({
            messages: [
                { role: 'system', content: SYSTEM_PROMPT_XERIFE },
                ...mensagensHistorico,
                { role: 'user', content: mensagemUsuario },
            ],
            temperature: 0.3,
            max_tokens: 400,
        });
        const textoResp = resp && resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content;
        return formatarRespostaIA(textoResp);
    }

    // ── Orquestrador principal — decide regras vs. IA local ─────────────
    // Intenções com matemática/cruzamento exato (previsão, criticidade,
    // resumo, autor×TCO, atendente COPOM etc.) continuam SEMPRE via regras,
    // mesmo com a IA pronta — são cálculos determinísticos já validados, e
    // pedir pra IA "explicar" isso de novo só adicionaria risco sem ganho.
    // A IA entra pra deixar mais natural as perguntas de contagem/ranking
    // simples e pra responder perguntas soltas fora da taxonomia fixa.
    async function responderPergunta(textoOriginal) {
        const q = NORM(textoOriginal);
        const qMin = q.toLowerCase();

        // "Comparativo" precisa SEMPRE ir por regras: a IA, tentando montar
        // uma comparação entre dois períodos sem os números prontos pros
        // dois, tende a inventar dados (já vimos ela confundir "MVI" com
        // "mísseis" e fabricar uma tabela inteira de percentuais fictícios).
        // Consulta por identificador (CPF/boletim/processo/nome) é busca de
        // cadastro exata — nunca deixar a IA "resumir" isso, sempre regra.
        const ehIdentificador = !!extrairIdentificador(qMin) || !!extrairNomeProvavel(textoOriginal, qMin);
        const ehIntentoDeterministico = ehSaudacao(qMin) || ehAjuda(qMin) || ehForaDeEscopo(qMin) || ehPrevisao(qMin) || ehCadastroEvento(qMin) ||
            ehCriticidade(qMin) || ehCartaoPrograma(qMin) || ehAtendenteCopom(qMin) || ehComarcaArquivamentos(qMin) || ehRankingMilitaresTCO(qMin) ||
            ehAceitabilidadePorLocal(qMin) || ehVisitasSugeridas(qMin) ||
            ehLocalizacaoDroga(qMin) || ehMateriais(qMin) ||
            ehResumo(qMin) || ehComparativo(qMin) || ehIdentificador || ehDetalheDrogas(qMin) || ehTopStatus(qMin) ||
            ehRankingSinistroMotorista(qMin) || ehRankingSinistroViatura(qMin) || ehRevisaoViatura(qMin) || ehDossieViatura(qMin) || ehDossieMotorista(qMin);
        const chaveCatPreliminar = detectarCategoria(q);
        const categoriasPreliminar = detectarCategoriasMultiplas(q);
        const ehTcoAutorOperador = chaveCatPreliminar === 'tco' && (ehTopAutorTCO(qMin) || ehTopOperadorTCO(qMin));

        // A IA só entra quando pelo menos UMA categoria foi identificada com
        // certeza (MVI, CVP, TCO...) — ou seja, ela SEMPRE recebe um dossiê
        // concreto e grounded, nunca "adivinha" o assunto. Já vimos ela
        // inventar uma "Análise por Comarca" inteira, com cidades que nem
        // existem (Porto Alegre, Belo Horizonte...), quando foi chamada sem
        // saber do que a pergunta tratava. Sem categoria clara, a resposta
        // determinística de processarPergunta() já pede pra especificar
        // (ver "Não entendi qual categoria..." mais abaixo) — isso É o
        // "pergunte o dado específico" que se espera aqui, então não tem
        // porquê a IA tentar adivinhar no lugar disso.
        const podeUsarIA = categoriasPreliminar.length > 0;

        if (podeUsarIA && !ehIntentoDeterministico && !ehTcoAutorOperador && llmEngine && llmEstado === 'pronto') {
            try { return await responderComIA(textoOriginal, q, qMin, categoriasPreliminar); }
            catch (e) { console.error('Xerife IA: erro ao responder, caindo pro modo regras.', e); }
        }

        const respostaRegras = await processarPergunta(textoOriginal);
        if (podeUsarIA && !ehIntentoDeterministico && !ehTcoAutorOperador && llmEstado === 'baixando') {
            return respostaRegras + `<br><br><small>🟡 IA local carregando (${llmProgresso}%) — usando modo regras por enquanto.</small>`;
        }
        return respostaRegras;
    }

    // ── Perguntas compostas ("me dê X, e também Y, e Z") ────────────────
    // Divide a mensagem em pedidos separados e responde cada um
    // independentemente, depois junta as respostas. Sem isso, uma mensagem
    // com 3 pedidos só respondia ao 1º que batesse com alguma intenção, e
    // pior: palavras de um pedido (ex.: "julho" do comparativo) vazavam pra
    // dentro do cálculo de outro pedido (ex.: a previsão do "próximo mês").
    function dividirEmSubPerguntas(texto) {
        const partes = texto
            .split(/(?<=[.;?!])\s+|,?\s+e\s+(?=(?:me\s+d[êe]|me\s+diga|me\s+fale|me\s+mostr|quero|gostaria|tamb[ée]m))/i)
            .map(p => p.trim())
            .filter(Boolean);
        return partes.length > 1 ? partes : [texto];
    }
    async function responderPerguntaComposta(textoOriginal) {
        const partes = dividirEmSubPerguntas(textoOriginal);
        if (partes.length <= 1) return await responderPergunta(textoOriginal);
        const respostas = [];
        for (const parte of partes) {
            try { respostas.push(await responderPerguntaComposta(parte)); }
            catch (e) { respostas.push('⚠️ Não consegui responder essa parte da pergunta.'); }
        }
        return respostas.join('<hr style="border:none;border-top:1px solid var(--p3-border,#e5e3dc);margin:10px 0;">');
    }

    async function processarPergunta(textoOriginal) {
        const q = NORM(textoOriginal);
        const qMin = q.toLowerCase();

        if (ehSaudacao(qMin)) return '🤠 E aí! Sou o Xerife, pergunte sobre os números da sua unidade — MVI, CVLI, CVP, TCO, armas, drogas, perturbação, violência doméstica ou visitas orientativas. Ex.: <em>"quantos TCOs este mês?"</em> ou <em>"resumo de hoje"</em>.';
        if (ehAjuda(qMin)) return montarAjuda();
        if (ehForaDeEscopo(qMin)) return respostaForaDeEscopo();
        // Checado antes de tudo — é um pedido de AÇÃO (cadastro), não uma
        // pergunta de dado, então não deve cair no fallback de categoria.
        if (ehCadastroEvento(qMin)) return respostaCadastroEvento();

        // Consulta direta por identificador (CPF/boletim/processo/nome) —
        // checado cedo, antes de qualquer detecção de categoria/estatística,
        // já que isso é busca de cadastro, não contagem.
        const identificador = extrairIdentificador(qMin);
        if (identificador) return await responderConsultaIdentificador(identificador);
        const nomeProvavel = extrairNomeProvavel(textoOriginal, qMin);
        if (nomeProvavel) return await responderConsultaIdentificador({ tipo: 'nome', valor: nomeProvavel });

        if (ehPrevisao(qMin)) return await responderPrevisao(q, qMin);
        // Gestão de frota (sinistros/revisão/dossiês) — checado cedo, são
        // pedidos bem específicos que não têm relação com as categorias de
        // ocorrência (CATEGORIAS) do resto do dispatch.
        if (ehDossieViatura(qMin)) return await responderDossieViatura(textoOriginal);
        if (ehDossieMotorista(qMin)) return await responderDossieMotorista(textoOriginal);
        if (ehRankingSinistroMotorista(qMin)) return await responderRankingSinistroMotorista();
        if (ehRankingSinistroViatura(qMin)) return await responderRankingSinistroViatura();
        if (ehRevisaoViatura(qMin)) return await responderRevisaoViatura(qMin);
        // Checado ANTES de ehCartaoPrograma — "cumprimento do cartão/OPO" é
        // mais específico (cruza com rastreamento GPS real) do que só pedir
        // pra gerar o cronograma; ehCartaoPrograma bateria de qualquer jeito
        // (também contém "cartao"+"programa").
        if (ehCumprimentoCartao(qMin)) return await responderCumprimentoCartao(q, qMin);
        // Checado ANTES de ehCriticidade — "cartão programa" é um pedido bem
        // mais específico (cronograma completo por RP/guarnição) do que só
        // "bairros/horários críticos"; não faz sentido cair no genérico.
        if (ehCartaoPrograma(qMin)) return await responderCartaoPrograma(q, qMin);
        if (ehCriticidade(qMin)) return await responderCriticidade(q, qMin);
        if (ehAtendenteCopom(qMin)) return await responderAtendenteCopom(q, qMin);
        if (ehComarcaArquivamentos(qMin)) return await responderComarcaArquivamentos(detectarPeriodo(qMin), extrairMotivoArquivamento(qMin));
        // Checado ANTES de ehRankingMilitaresTCO — esta é uma pergunta de
        // percentual POR LOCAL (cidade/comarca), não por militar; não exige
        // a palavra "militar", então precisa vencer antes desse outro check.
        if (ehAceitabilidadePorLocal(qMin)) return await responderAceitabilidadePorLocal(q, qMin);
        // Checado ANTES do ehTopOperadorTCO genérico (mais abaixo, dentro do
        // fluxo de categoria) — "militar" + "arquivado/atipicidade" é o
        // cruzamento por guarnição, bem diferente de "quem lavrou o TCO".
        if (ehRankingMilitaresTCO(qMin)) return await responderRankingMilitaresTCO(q, qMin);
        if (ehVisitasSugeridas(qMin)) return await responderVisitasSugeridas(q, qMin);
        if (ehLocalizacaoDroga(qMin)) return await responderLocalizacaoDroga(q, qMin);
        if (ehMateriais(qMin)) return await responderMateriais(q, qMin);
        if (ehResumo(qMin)) {
            const periodoResumo = detectarPeriodo(qMin);
            const categoriasPedidas = detectarCategoriasMultiplas(q);
            return ehMensal(qMin)
                ? await responderResumoMensal(periodoResumo, categoriasPedidas)
                : await responderResumo(periodoResumo, categoriasPedidas);
        }

        // Dois anos citados + palavra de comparação ("comparativa", "compara"...)
        // = comparação DIRETA entre esses dois anos específicos (mesmo
        // mês/intervalo em cada um). Checado ANTES de exigir uma categoria
        // única — cobre tanto "MVI comparado com 2025" (1 categoria) quanto
        // "MVI, CVP e TCO comparado com 2025" (várias) quanto "os indicadores
        // deste ano comparado com 2025" (nenhuma citada → todas por padrão).
        let anosDaPergunta = detectarAnos(q);
        // "ano passado"/"ano anterior" é uma referência relativa (não os 4
        // dígitos que detectarAnos procura) — sem isso, "julho deste ano
        // referência ao ano passado" não teria os "2 anos" que o comparativo
        // multi-categoria exige, e cairia em "não entendi categoria".
        if (ehComparativo(qMin) && anosDaPergunta.length < 2 && (qMin.includes('ano passado') || qMin.includes('ano anterior'))) {
            const hoje = new Date();
            anosDaPergunta = [hoje.getFullYear() - 1, hoje.getFullYear()];
        }
        // "comparativo do primeiro semestre atual com o anterior" — aqui
        // "anterior" se refere ao SEMESTRE (não ao ano, como no caso
        // acima), mas o efeito no cálculo é o mesmo: mesmo tipo de
        // período (detectarPeriodo já entende "semestre", ver lá), em 2
        // anos diferentes. Se JÁ tiver 1 ano citado ("...de 2026 com o
        // anterior"), usa esse como base; senão usa o ano atual.
        if (ehComparativo(qMin) && anosDaPergunta.length < 2 && qMin.includes('semestre') && qMin.includes('anterior')) {
            const anoBase = anosDaPergunta[0] || new Date().getFullYear();
            anosDaPergunta = [anoBase - 1, anoBase];
        }
        if (ehComparativo(qMin) && anosDaPergunta.length >= 2) {
            const categoriasComp = detectarCategoriasMultiplas(q);
            const chavesComp = categoriasComp.length ? categoriasComp : ['mvicvli', 'cvp', 'tco', 'armas', 'drogas', 'perturbacao', 'violencia', 'visita'];
            return await responderComparativoMultiCategoria(q, qMin, chavesComp, anosDaPergunta);
        }

        // 2+ categorias citadas junto, sem comparativo — ex.: "quantos mvi e
        // cvp este ano" — mostra as duas. Checado ANTES da categoria única,
        // senão "mvi e cvp" já resolveria (com sucesso) só pra MVI e nunca
        // chegaria aqui.
        const categoriasMultiplas = detectarCategoriasMultiplas(q);
        if (categoriasMultiplas.length >= 2) return await responderContagemMultiCategoria(q, qMin, categoriasMultiplas);

        const chaveCat = detectarCategoria(q);
        if (!chaveCat) return '🤔 Não identifiquei qual dado específico você quer — só respondo com base nos dados reais da sua unidade, então preciso saber exatamente o que buscar. Pode me dizer qual categoria: <strong>MVI/CVLI, CVP, TCO, Armas, Drogas, Perturbação do Sossego, Violência Doméstica</strong> ou <strong>Visitas Orientativas</strong>? Digite "ajuda" pra ver exemplos.';

        const cat = CATEGORIAS[chaveCat];
        let bruto;
        try { bruto = await cat.fetch(); } catch (e) { return '⚠️ Não consegui buscar os dados agora. Tente de novo em instantes.'; }
        const base = bruto.filter(cat.filtroBase);

        const periodo = detectarPeriodo(qMin);
        const cidade = detectarCidade(q, base, cat);
        const bairro = detectarBairro(q, base, cat);
        const sufixoLocal = (cidade ? ` em <strong>${cidade}</strong>` : '') + (bairro ? ` (bairro <strong>${bairro}</strong>)` : '');

        const filtrarPeriodoCidade = lista => {
            let r = lista.filter(i => { const d = parseData(cat.campoData(i)); return d && d >= periodo.ini && d <= periodo.fim; });
            if (cidade) r = r.filter(i => NORM(cat.campoCidade(i)) === NORM(cidade));
            if (bairro) r = r.filter(i => NORM(cat.campoBairro(i)) === NORM(bairro));
            return r;
        };
        const filtrada = filtrarPeriodoCidade(base);
        const sufixoCidade = sufixoLocal;

        // "qual bairro" é mais específico que "qual a cidade" — checado primeiro.
        if (ehTopBairroCategoria(qMin) && cat.campoBairro) {
            const top = topEntries(filtrada, cat.campoBairro, 5);
            if (!top.length) return `Não encontrei registros de <strong>${cat.label}</strong> ${periodo.label}${sufixoCidade} pra montar um ranking de bairros.`;
            return `📍 Bairros com mais <strong>${cat.label}</strong> ${periodo.label}${sufixoCidade}:<br>` + top.map((e, i) => `${i + 1}. <strong>${e[0]}</strong> — ${e[1]}`).join('<br>');
        }

        if (ehTop(qMin) && cat.campoCidade) {
            const top = topEntries(filtrada, cat.campoCidade, 5);
            if (!top.length) return `Não encontrei registros de <strong>${cat.label}</strong> ${periodo.label}${sufixoCidade} pra montar um ranking de cidades.`;
            return `📍 Cidades com mais <strong>${cat.label}</strong> ${periodo.label}:<br>` + top.map((e, i) => `${i + 1}. <strong>${e[0]}</strong> — ${e[1]}`).join('<br>');
        }

        // TCO tem duas perguntas de "quem" distintas — ver ehTopOperadorTCO/ehTopAutorTCO.
        if (chaveCat === 'tco' && (ehTopAutorTCO(qMin) || ehTopOperadorTCO(qMin))) {
            if (ehTopOperadorTCO(qMin)) {
                const top = topEntries(filtrada, cat.campoNome, 5);
                if (!top.length) return `Não encontrei registros de <strong>TCO</strong> ${periodo.label} pra identificar quem lavrou.`;
                return `🧑‍✈️ Policial/operador responsável(is) com mais <strong>TCO</strong> lavrados ${periodo.label}:<br>` + top.map((e, i) => `${i + 1}. <strong>${e[0]}</strong> — ${e[1]}`).join('<br>');
            }
            const top = await rankingAutoresComTCO(filtrada, 5);
            if (!top.length) return `Não encontrei nenhum cruzamento entre o nó de autores e os TCOs ${periodo.label} — confira se o nó "autor" está preenchido pra essa unidade.`;
            return `👤 Autor(es) com mais <strong>TCO</strong> registrados contra si ${periodo.label} (cruzamento do nó "autor" × TCO por boletim):<br>` + top.map((e, i) => `${i + 1}. <strong>${e[0]}</strong> — ${e[1]}`).join('<br>');
        }

        if (ehTopPessoa(qMin)) {
            if (!cat.campoNome) return `Não tenho um campo de autor/responsável cadastrado pra <strong>${cat.label}</strong> — só consigo rankear essa categoria por cidade ou tipificação.`;
            const top = topEntries(filtrada, cat.campoNome, 5);
            if (!top.length) return `Não encontrei registros de <strong>${cat.label}</strong> ${periodo.label}${sufixoCidade} pra identificar o(a) ${cat.labelNome}.`;
            const rotulo = cat.labelNome.charAt(0).toUpperCase() + cat.labelNome.slice(1);
            return `🧑‍✈️ ${rotulo}(s) com mais <strong>${cat.label}</strong> ${periodo.label}${sufixoCidade}:<br>` + top.map((e, i) => `${i + 1}. <strong>${e[0]}</strong> — ${e[1]}`).join('<br>');
        }

        // Detalhamento de drogas por substância + peso — mais específico que
        // tipificação genérica, checado antes.
        if (chaveCat === 'drogas' && ehDetalheDrogas(qMin)) {
            return responderDetalheDrogas(periodo, cidade, filtrada);
        }

        if (ehTopStatus(qMin) && cat.campoStatus) {
            const top = topEntries(filtrada, cat.campoStatus, 8);
            if (!top.length) return `Não encontrei registros de <strong>${cat.label}</strong> ${periodo.label}${sufixoCidade} pra listar status/movimentação.`;
            return `📋 Status/movimentação de <strong>${cat.label}</strong> ${periodo.label}${sufixoCidade}:<br>` + top.map((e, i) => `${i + 1}. ${e[0]} — <strong>${e[1]}</strong>`).join('<br>');
        }

        if (ehTipificacao(qMin)) {
            const top = topEntries(filtrada, cat.campoTip, 5);
            if (!top.length) return `Não encontrei registros de <strong>${cat.label}</strong> ${periodo.label}${sufixoCidade} pra listar tipificações.`;
            return `🏷️ Tipificações mais comuns de <strong>${cat.label}</strong> ${periodo.label}${sufixoCidade}:<br>` + top.map((e, i) => `${i + 1}. ${e[0]} — <strong>${e[1]}</strong>`).join('<br>');
        }

        // Contagem simples (padrão)
        const perguntouMVI = chaveCat === 'mvicvli' && q.includes('MVI') && !q.includes('CVLI');
        let resposta;
        if (chaveCat === 'mvicvli') {
            const mvi = filtrada.filter(isMVI).length;
            const percentual = filtrada.length ? Math.round(mvi / filtrada.length * 100) : 0;
            resposta = perguntouMVI
                ? `📊 <strong>${mvi}</strong> MVI (Morte Violenta Intencional) ${periodo.label}${sufixoCidade}, de um total de <strong>${filtrada.length}</strong> CVLI (${percentual}%).`
                : `📊 <strong>${filtrada.length}</strong> registro(s) de <strong>${cat.label}</strong> ${periodo.label}${sufixoCidade} — desses, <strong>${mvi}</strong> são MVI (${percentual}%).`;
        } else {
            resposta = `📊 <strong>${filtrada.length}</strong> registro(s) de <strong>${cat.label}</strong> ${periodo.label}${sufixoCidade}.`;
        }

        // Comparativo com o ano atual, se pedido e o período não for já "o ano atual"
        if (ehComparativo(qMin)) {
            const anoAtual = periodoAnoAtual();
            if (periodo.ini.getTime() !== anoAtual.ini.getTime() || periodo.fim.getFullYear() !== anoAtual.fim.getFullYear()) {
                let compAtual = base.filter(i => { const d = parseData(cat.campoData(i)); return d && d >= anoAtual.ini && d <= anoAtual.fim; });
                if (cidade) compAtual = compAtual.filter(i => NORM(cat.campoCidade(i)) === NORM(cidade));
                const valorAtual = chaveCat === 'mvicvli' ? compAtual.filter(isMVI).length : compAtual.length;
                const valorBase = chaveCat === 'mvicvli' && perguntouMVI ? filtrada.filter(isMVI).length : filtrada.length;
                const { tendencia, percVar } = calcularVariacao(valorBase, valorAtual);
                resposta += `<br><br>📈 Comparando com o ano atual até hoje (<strong>${valorAtual}</strong>), isso é uma <strong>${tendencia}</strong> de <strong>${percVar}%</strong>.`;
            }
        }

        return resposta;
    }

    function respostaForaDeEscopo() {
        return '🤠 "Meta" não é um dado que existe no sistema (não há número-alvo definido em nenhum lugar) — isso eu não invento. Mas eu <strong>faço previsão</strong> de MVI, CVLI e CVP pro próximo mês, com o mesmo modelo estatístico da Análise Preditiva: pergunte, por exemplo, <em>"previsão de MVI pro próximo mês"</em>.';
    }
    // Cadastro de Eventos é feito via anexo de ofício (OCR/PDF, ver
    // js/xerife-documentos.js) — o chat só entende TEXTO de pergunta sobre
    // dados; sem anexo não tem como extrair os campos do evento.
    function respostaCadastroEvento() {
        return '🎪 Pra cadastrar um evento, anexe o ofício (clique no 📎 aqui do chat) — eu leio o documento, preencho os campos automaticamente e te mostro pra confirmar antes de gravar. Se preferir, também dá pra cadastrar manualmente na página <strong>Eventos</strong>.';
    }

    function montarAjuda() {
        return `🤠 Eu sou o <strong>Xerife</strong>, respondo só com base nos dados reais da sua unidade (Firebase/GAS) — não invento nada e não crio metas.<br><br>
        Categorias que entendo: <strong>MVI, CVLI, CVP, TCO, Armas, Drogas, Perturbação do Sossego, Violência Doméstica, Visitas Orientativas, Materiais em guarda</strong>.<br><br>
        Exemplos de pergunta:<br>
        • "quantos TCOs este mês?"<br>
        • "quantas ocorrências de CVLI em Palmeira dos Índios este ano?" ou "...no bairro Centro?"<br>
        • "qual a cidade com mais CVP?" / "qual bairro tem mais MVI?"<br>
        • "quem mais lavrou TCO?" (operador) <em>ou</em> "qual autor tem mais TCO?" (cruzamento com o nó de autores)<br>
        • "quem mais do COPOM está atendendo ocorrências?"<br>
        • "quais os horários e bairros críticos em Palmeira dos Índios?"<br>
        • "previsão de MVI e CVP pro próximo mês"<br>
        • "quanto de maconha e cocaína foi apreendido este mês?" (soma peso por substância)<br>
        • "onde a maconha foi apreendida e com quem?" (local + autor, registro a registro)<br>
        • "quantos materiais tenho na guarda de Palmeira dos Índios?" (fonte: planilha de Materiais)<br>
        • "qual a comarca que mais arquivou por atipicidade material?" (fonte: planilha de Sentenças)<br>
        • "percentual de aceitabilidade de TCO por cidade" / "taxa de rejeição de TCO por comarca este ano"<br>
        • "quais visitas orientativas precisam ser feitas em Palmeira?" (mesmo critério do Gerar Visitas)<br>
        • "status dos TCOs este mês" / "movimentação das drogas este ano"<br>
        • "CPF 123.456.789-00" / "boletim 123456" / "processo 0700660-61.2026.8.02.0146" (consulta direta de cadastro)<br>
        • "tipificação mais comum de drogas este mês"<br>
        • "MVI do 1º semestre de 2026 comparado com o mesmo período de 2025 mês a mês"<br>
        • "resumo de hoje" / "resumo de 2026 mês a mês de MVI e CVP"<br>
        • "quero cadastrar um novo evento" (te explico como anexar o ofício)<br><br>
        Períodos que entendo: hoje, ontem, esta semana, este mês, mês passado, este ano, ano passado, um ano específico (ex.: 2025), um mês (ex.: "em março"), mês+ano juntos, intervalo de meses ("de janeiro a julho") e 1º/2º semestre. Se eu não entender o período, uso o ano atual.`;
    }

    // ════════════════════════════════════════════════════════════════
    // INTERFACE DO CHAT
    // ════════════════════════════════════════════════════════════════
    let painelAberto = false;
    let painelMontado = false;

    // ── Carregamento sob demanda de js/xerife-documentos.js ─────────────
    // O balão flutuante (aqui) e a página dedicada (page/chat-mobile.html)
    // compartilham a MESMA análise de documento — em vez de duplicar a
    // lógica de OCR/PDF/classificação, o balão só injeta esse script na
    // primeira vez que o usuário clica em anexar, exatamente como
    // js/core/session.js já faz com o próprio js/xerife.js (evita baixar
    // PDF.js/Tesseract.js pra quem nunca usa o recurso).
    let promessaModuloDocumentos = null;
    function carregarModuloDocumentos() {
        if (window.Xerife && window.Xerife.analisarDocumento) return Promise.resolve();
        if (!promessaModuloDocumentos) {
            promessaModuloDocumentos = new Promise((resolve, reject) => {
                const prefixo = /\/(page|relatorios|public|termos)\//.test(location.pathname) ? '../' : '';
                const s = document.createElement('script');
                s.src = prefixo + 'js/xerife-documentos.js';
                s.onload = () => {
                    // xerife-documentos.js só anexa analisarDocumento em
                    // window.Xerife depois que seu próprio aguardarXerife()
                    // resolve (polling) — espera aqui também.
                    let tentativas = 0;
                    const t = setInterval(() => {
                        if (window.Xerife && window.Xerife.analisarDocumento) { clearInterval(t); resolve(); }
                        else if (++tentativas > 50) { clearInterval(t); reject(new Error('módulo de documentos não carregou a tempo')); }
                    }, 200);
                };
                s.onerror = () => reject(new Error('falha ao carregar js/xerife-documentos.js'));
                document.body.appendChild(s);
            });
        }
        return promessaModuloDocumentos;
    }

    function montarPainel() {
        // mesma regra de prefixo de js/core/session.js (page/, relatorios/, public/, termos/ ficam um nível abaixo da raiz)
        const prefixo = /\/(page|relatorios|public|termos)\//.test(location.pathname) ? '../' : '';
        // cover (em vez de contain) corta a margem transparente ao redor do
        // escudo na imagem — sem isso, o logo aparece minúsculo dentro do espaço reservado.
        const iconeHTML = '<img src="' + prefixo + 'img/xerife-logo.png" alt="Xerife" ' +
            'style="width:68px;height:68px;object-fit:cover;border-radius:50%;flex-shrink:0;" ' +
            'onerror="this.remove();this.parentElement.insertAdjacentHTML(\'afterbegin\',\'<div style=&quot;font-size:2.2rem;&quot;>🤠</div>\');">';

        const wrap = document.createElement('div');
        wrap.id = 'xerife-painel';
        wrap.style.cssText = 'position:fixed;bottom:92px;right:24px;z-index:9997;width:min(370px,92vw);' +
            'height:min(560px,75vh);background:var(--p3-surface,#fff);border-radius:16px;' +
            'box-shadow:0 12px 40px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden;' +
            'border:1px solid var(--p3-border,#e5e3dc);font-family:var(--p3-font,Arial,sans-serif);';

        wrap.innerHTML = `
            <div style="background:var(--p3-gradient,linear-gradient(90deg,#2f5fdd,#2450bd));color:#fff;padding:.9rem 1rem;display:flex;align-items:center;gap:.6rem;flex-shrink:0;">
                ${iconeHTML}
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:700;font-size:.92rem;">Xerife</div>
                    <div style="font-size:.68rem;opacity:.85;">Assistente da unidade — dados em tempo real</div>
                    <div id="xerife-status-ia" style="font-size:.65rem;opacity:.85;margin-top:1px;display:flex;align-items:center;"></div>
                </div>
                <a href="${prefixo}page/ia_xerife.html" title="Abrir IA Xerife (voz, mapa, apresentações)" aria-label="Abrir IA Xerife"
                    style="background:rgba(255,255,255,.15);color:#fff;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.85rem;flex-shrink:0;text-decoration:none;">🪐</a>
                <button id="xerife-fechar" title="Fechar" style="background:rgba(255,255,255,.15);border:none;color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:.9rem;flex-shrink:0;">✕</button>
            </div>
            <div id="xerife-mensagens" style="flex:1;overflow-y:auto;padding:.9rem;display:flex;flex-direction:column;gap:.6rem;background:var(--p3-bg,#fafaf8);"></div>
            <div id="xerife-chips" style="display:flex;flex-wrap:wrap;gap:.4rem;padding:0 .9rem .6rem;flex-shrink:0;"></div>
            <form id="xerife-form" style="display:flex;gap:.5rem;padding:.7rem .9rem;border-top:1px solid var(--p3-border,#e5e3dc);flex-shrink:0;background:var(--p3-surface,#fff);align-items:flex-end;">
                <input type="file" id="xerife-anexo" accept="image/*,application/pdf" capture="environment" hidden>
                <div style="flex:1;display:flex;align-items:flex-end;gap:.2rem;border:1.5px solid var(--p3-border,#e5e3dc);border-radius:20px;background:var(--p3-bg,#fafaf8);padding:.35rem .35rem .35rem .5rem;">
                    <button type="button" id="xerife-btn-anexo" title="Anexar foto ou PDF" aria-label="Anexar foto ou PDF"
                        style="flex-shrink:0;width:28px;height:28px;border-radius:50%;border:none;background:transparent;color:inherit;opacity:.65;font-size:1rem;cursor:pointer;">📎</button>
                    <textarea id="xerife-input" rows="1" placeholder="Pergunte algo… (Shift+Enter pra nova linha)" autocomplete="off"
                        style="flex:1;padding:.3rem 0;border:none;outline:none;background:transparent;font-size:.85rem;color:var(--p3-text,#1c1c1a);resize:none;overflow-y:auto;max-height:120px;line-height:1.4;font-family:inherit;"></textarea>
                </div>
                <button type="submit" style="background:var(--p3-blue-700,#2f5fdd);color:#fff;border:none;width:38px;height:38px;border-radius:50%;cursor:pointer;font-size:.95rem;flex-shrink:0;">➤</button>
            </form>`;
        document.body.appendChild(wrap);

        document.getElementById('xerife-fechar').addEventListener('click', alternar);
        const inputEl = document.getElementById('xerife-input');
        const formEl = document.getElementById('xerife-form');
        const anexoEl = document.getElementById('xerife-anexo');
        const btnAnexoEl = document.getElementById('xerife-btn-anexo');

        // Mesma lógica/opção de anexo da página dedicada (page/chat-mobile.
        // html) — carrega js/xerife-documentos.js sob demanda (só no 1º
        // anexo) e delega a análise pra ele via window.Xerife.analisarDocumento.
        btnAnexoEl.addEventListener('click', () => anexoEl.click());
        anexoEl.addEventListener('change', async () => {
            const arquivo = anexoEl.files && anexoEl.files[0];
            anexoEl.value = ''; // permite reenviar o mesmo arquivo depois
            if (!arquivo) return;
            try {
                await carregarModuloDocumentos();
                window.Xerife.analisarDocumento(arquivo);
            } catch (e) {
                console.error('Xerife: não consegui carregar o módulo de análise de documentos.', e);
                adicionarMensagem('bot', '⚠️ Não consegui carregar a análise de documentos agora — tente novamente em instantes.');
            }
        });

        // Auto-expansão até 120px (a partir daí, rola dentro do próprio campo).
        inputEl.addEventListener('input', () => {
            inputEl.style.height = 'auto';
            inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
        });
        // Enter envia; Shift+Enter quebra linha normalmente.
        inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                formEl.requestSubmit();
            }
        });

        formEl.addEventListener('submit', (e) => {
            e.preventDefault();
            const texto = inputEl.value.trim();
            if (!texto) return;
            inputEl.value = '';
            inputEl.style.height = 'auto'; // volta pra 1 linha (rows="1")
            enviarPergunta(texto);
        });

        renderChips(['📋 Resumo de hoje', '📄 Quantos TCOs este mês?', '📍 Top cidades de CVLI', '🏠 Visitas orientativas este ano']);

        // Restaura a conversa anterior (mesma aba, mesmo usuário, ainda sem
        // logout) em vez de sempre voltar pra saudação — ver chaveHistorico().
        const historico = carregarHistorico();
        if (historico.length) {
            historico.forEach(h => {
                adicionarMensagem('user', escHtml(h.pergunta), h.pergunta);
                adicionarMensagem('bot', h.respostaHtml);
            });
        } else {
            adicionarMensagem('bot', '🤠 E aí! Sou o <strong>Xerife</strong>. Pergunte sobre os dados da sua unidade — MVI, CVLI, CVP, TCO, armas, drogas, perturbação, violência doméstica ou visitas. Ou clique numa sugestão abaixo.');
        }

        painelMontado = true;
        atualizarBadgeIA(); // reflete o estado atual da IA local (pode já estar pronta ou ainda baixando)
    }

    function renderChips(lista) {
        const cont = document.getElementById('xerife-chips');
        cont.innerHTML = lista.map(t => `<button type="button" class="xerife-chip" style="background:var(--p3-blue-100,#eef2fd);color:var(--p3-blue-700,#2f5fdd);border:none;border-radius:14px;padding:.35rem .7rem;font-size:.72rem;font-weight:600;cursor:pointer;">${t}</button>`).join('');
        cont.querySelectorAll('.xerife-chip').forEach(btn => {
            btn.addEventListener('click', () => enviarPergunta(btn.textContent.replace(/^\S+\s/, '')));
        });
    }

    // Copia texto pra área de transferência com fallback pra contexto sem
    // permissão de Clipboard API (ex.: http sem TLS) — sem isso, "copiar"
    // simplesmente falharia calado nesses casos.
    async function copiarTexto(texto) {
        try { await navigator.clipboard.writeText(texto); return true; }
        catch (e) {
            try {
                const ta = document.createElement('textarea');
                ta.value = texto;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                return true;
            } catch (e2) { return false; }
        }
    }

    // perguntaOriginal: só usado nas mensagens do usuário, pro botão "refazer"
    // reenviar o texto exato (evita depender de decodificar de volta o HTML
    // escapado, que só trata &, < e > — não &nbsp; e afins).
    // Retorna o elemento de CONTEÚDO (não a bolha inteira) — quem chama essa
    // função troca a resposta via `.innerHTML` nesse retorno (ver
    // enviarPergunta), sem apagar a barra de ações (copiar/refazer) que fica
    // num elemento irmão dentro da mesma bolha.
    function adicionarMensagem(quem, html, perguntaOriginal) {
        const cont = document.getElementById('xerife-mensagens');
        const bolha = document.createElement('div');
        const doUsuario = quem === 'user';
        bolha.style.cssText = `max-width:85%;align-self:${doUsuario ? 'flex-end' : 'flex-start'};` +
            `background:${doUsuario ? 'var(--p3-blue-700,#2f5fdd)' : 'var(--p3-surface,#fff)'};` +
            `color:${doUsuario ? '#fff' : 'var(--p3-text,#1c1c1a)'};` +
            `border:${doUsuario ? 'none' : '1px solid var(--p3-border,#e5e3dc)'};` +
            'padding:.55rem .8rem;border-radius:14px;font-size:.82rem;line-height:1.5;box-shadow:0 1px 3px rgba(0,0,0,.06);';

        const conteudo = document.createElement('div');
        conteudo.className = 'xerife-conteudo';
        conteudo.innerHTML = html;
        bolha.appendChild(conteudo);

        const acoes = document.createElement('div');
        acoes.className = 'xerife-acoes';
        acoes.style.cssText = `display:flex;align-items:center;justify-content:${doUsuario ? 'flex-end' : 'flex-start'};margin-top:.3rem;`;
        const botao = document.createElement('button');
        botao.type = 'button';
        botao.style.cssText = `background:none;border:none;cursor:pointer;font-size:.68rem;padding:0;opacity:.75;color:${doUsuario ? '#fff' : 'inherit'};font-family:inherit;`;
        if (doUsuario) {
            botao.title = 'Refazer esta pergunta';
            botao.textContent = '🔄 refazer';
            botao.addEventListener('click', () => enviarPergunta(perguntaOriginal != null ? perguntaOriginal : htmlParaTexto(html)));
        } else {
            botao.title = 'Copiar resposta';
            botao.textContent = '📋 copiar';
            botao.addEventListener('click', async () => {
                const ok = await copiarTexto(htmlParaTexto(conteudo.innerHTML));
                const original = botao.textContent;
                botao.textContent = ok ? '✅ copiado' : '⚠️ não copiou';
                setTimeout(() => { botao.textContent = original; }, 1500);
            });
        }
        acoes.appendChild(botao);
        bolha.appendChild(acoes);

        cont.appendChild(bolha);
        cont.scrollTop = cont.scrollHeight;
        return conteudo;
    }

    async function enviarPergunta(texto) {
        adicionarMensagem('user', escHtml(texto), texto);
        const bolhaCarregando = adicionarMensagem('bot', '<span style="opacity:.6;">Consultando os dados…</span>');
        try {
            const resposta = await responderPerguntaComposta(texto);
            bolhaCarregando.innerHTML = resposta;
            adicionarAoHistorico(texto, resposta);
            // "Dispara e esquece" — de propósito SEM await, pra nunca atrasar
            // a resposta na tela (ver doutrina completa no bloco de
            // TELEMETRIA logo abaixo desta função).
            registrarInteracaoTelemetria(texto, bolhaCarregando);
        } catch (e) {
            console.error('Xerife: erro ao responder', e);
            bolhaCarregando.innerHTML = '⚠️ Deu um problema aqui. Tenta perguntar de novo?';
        }
        document.getElementById('xerife-mensagens').scrollTop = document.getElementById('xerife-mensagens').scrollHeight;
    }

    // ════════════════════════════════════════════════════════════════
    // TELEMETRIA / APRENDIZADO — log OPCIONAL de interações pra uma API
    // HTTP externa (PHP/MySQL própria do usuário, fora deste repositório),
    // usada só pra descobrir gírias/termos regionais que faltam nas listas
    // de sinônimos (CATEGORIAS.nomes, eh*()) — NUNCA pra recalcular nada:
    // a resposta ao usuário já saiu antes desta função ser chamada.
    //
    // REGRAS DE PRIVACIDADE (decisão explícita — sistema policial, dado
    // sensível de verdade):
    //   1. Consulta de identificador (CPF/nome/boletim/processo) NUNCA é
    //      logada — nem a categoria, nem o texto. O simples fato de "esse
    //      usuário consultou tal CPF" já é, por si, um dado sensível de
    //      quem foi consultado.
    //   2. A RESPOSTA (resposta_gerada) nunca é enviada — pode conter
    //      contagem/nome real (ex.: "Militar Fulano teve 5 TCOs
    //      arquivados"). Só a CATEGORIA da pergunta é enviada.
    //   3. O TEXTO da pergunta só é enviado quando ela NÃO foi reconhecida
    //      por nenhuma categoria — é o único caso em que o texto bruto tem
    //      valor real (achar um termo novo pra ensinar); pergunta já
    //      reconhecida não precisa do texto, a categoria basta.
    //   4. Falha de rede aqui é sempre silenciosa — nunca aparece pro
    //      usuário, nunca atrasa nem interrompe o assistente.
    //
    // TELEMETRIA_ATIVA começa `false` de propósito — só ligar depois de
    // preencher TELEMETRIA_API_URL com o domínio real e confirmar que o
    // endpoint aceita esse contrato (action=log_interaction /
    // action=update_feedback, ver tools/xerife-ml/README.md).
    // ════════════════════════════════════════════════════════════════
    const TELEMETRIA_API_URL = 'https://irispmal.io/api/xerife_api.php';
    const TELEMETRIA_ATIVA = true;

    // Mesma ideia de detectarCategoria(), mas cobrindo também as intenções
    // "especiais" que não têm entrada em CATEGORIAS (criticidade, previsão,
    // cartão programa...) — só pra rotular o log, nunca usada pra decidir a
    // resposta em si (isso continua 100% em processarPergunta()).
    function detectarCategoriaOuIntencaoParaLog(qMin) {
        if (ehSaudacao(qMin) || ehAjuda(qMin) || ehForaDeEscopo(qMin) || ehCadastroEvento(qMin)) return null; // não é pergunta de dado
        if (ehCriticidade(qMin)) return 'criticidade';
        if (ehCartaoPrograma(qMin)) return 'cartao_programa';
        if (ehAtendenteCopom(qMin)) return 'atendente_copom';
        if (ehComarcaArquivamentos(qMin)) return 'comarca_arquivamentos';
        if (ehAceitabilidadePorLocal(qMin)) return 'aceitabilidade_tco_local';
        if (ehRankingMilitaresTCO(qMin)) return 'ranking_tco_militares';
        if (ehVisitasSugeridas(qMin)) return 'visitas_sugeridas';
        if (ehPrevisao(qMin)) return 'previsao';
        if (ehLocalizacaoDroga(qMin)) return 'localizacao_droga';
        if (ehMateriais(qMin)) return 'materiais';
        if (ehResumo(qMin)) return 'resumo';
        if (ehComparativo(qMin)) return 'comparativo';
        return detectarCategoria(qMin); // mvicvli, cvp, tco, armas, drogas, visita, perturbacao, violencia — ou null
    }

    // bolhaConteudo: opcional — quando informado (chat com UI de bolhas),
    // liga os botões de 👍/👎 na mesma bolha assim que o log é confirmado.
    async function registrarInteracaoTelemetria(textoOriginal, bolhaConteudo) {
        if (!TELEMETRIA_ATIVA) return;
        try {
            const qMin = NORM(textoOriginal).toLowerCase();
            if (identificarConsulta(textoOriginal)) return; // regra 1 — nunca loga consulta de identificador

            const categoria = detectarCategoriaOuIntencaoParaLog(qMin);
            const payload = {
                action: 'log_interaction',
                categoria_detectada: categoria || 'nao_reconhecida',
                pergunta: categoria ? null : textoOriginal.slice(0, 300), // regra 3
            };
            const resp = await fetch(TELEMETRIA_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                keepalive: true,
            });
            const json = await resp.json().catch(() => null);
            const logId = json && json.id;
            if (logId && bolhaConteudo) ligarBotoesFeedback(bolhaConteudo, logId);
        } catch (e) { /* regra 4 — log é best-effort, nunca propaga erro */ }
    }

    function ligarBotoesFeedback(bolhaConteudo, logId) {
        const acoes = bolhaConteudo.parentElement && bolhaConteudo.parentElement.querySelector('.xerife-acoes');
        if (!acoes || acoes.querySelector('.xerife-feedback')) return;
        const grupo = document.createElement('span');
        grupo.className = 'xerife-feedback';
        grupo.style.cssText = 'margin-left:.5rem;';
        const botoes = [];
        const mkBotao = (rotulo, valor) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.style.cssText = 'background:none;border:none;cursor:pointer;font-size:.75rem;padding:0 .2rem;opacity:.6;font-family:inherit;';
            b.textContent = rotulo;
            b.title = valor === 'positivo' ? 'Essa resposta ajudou' : 'Essa resposta não ajudou';
            b.addEventListener('click', () => {
                botoes.forEach(x => { x.disabled = true; x.style.opacity = '.3'; });
                b.style.opacity = '1';
                enviarFeedbackTelemetria(logId, valor);
            });
            botoes.push(b);
            return b;
        };
        grupo.appendChild(mkBotao('👍', 'positivo'));
        grupo.appendChild(mkBotao('👎', 'negativo'));
        acoes.appendChild(grupo);
    }

    async function enviarFeedbackTelemetria(logId, valor) {
        try {
            await fetch(TELEMETRIA_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'update_feedback', id: logId, feedback_usuario: valor }),
                keepalive: true,
            });
        } catch (e) { /* best-effort */ }
    }

    function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    function alternar() {
        if (!painelMontado) montarPainel();
        painelAberto = !painelAberto;
        document.getElementById('xerife-painel').style.display = painelAberto ? 'flex' : 'none';
        if (painelAberto) setTimeout(() => document.getElementById('xerife-input')?.focus(), 100);
    }

    // ════════════════════════════════════════════════════════════════
    // API DE DADOS ESTRUTURADOS — pro dashboard JARVIS (page/ia_xerife.html).
    // Cada função aqui reaproveita a MESMA fonte/regra já usada no chat
    // (nunca recalcula nada por conta própria) — só devolve OBJETO em vez
    // de HTML, pra virar widget (KPI/tabela/mapa) em vez de bolha de texto.
    // ════════════════════════════════════════════════════════════════
    async function responderTexto(texto) {
        return await responderPerguntaComposta(texto);
    }
    async function obterKPIs(textoPeriodo) {
        const qMin = NORM(textoPeriodo || '').toLowerCase();
        const periodo = detectarPeriodo(qMin);
        const contagens = await contarCategoriasPeriodo(['mvicvli', 'cvp', 'tco', 'armas', 'drogas'], periodo);

        let aceitabilidadeTcoPct = null, totalTcoCruzados = 0;
        try {
            const unicos = casosUnicosPorTco(await montarCasosMilitaresTCO());
            // Ao contrário do texto do chat (onde "sem período" = histórico
            // inteiro), este é um widget numérico com o período SEMPRE
            // visível na tela (periodoLabel) — o número tem que bater com
            // o rótulo mostrado, então filtra sempre por periodo.ini/fim,
            // mesmo quando o período é o padrão implícito ("este ano").
            const filtrados = unicos.filter(c => c.data && c.data >= periodo.ini && c.data <= periodo.fim);
            totalTcoCruzados = filtrados.length;
            if (totalTcoCruzados > 0) aceitabilidadeTcoPct = Math.round(filtrados.filter(c => c.classif === 'aceitavel').length / totalTcoCruzados * 100);
        } catch (e) { /* fica null se der erro — nunca inventa número */ }

        return {
            periodoLabel: periodo.label,
            mvi: contagens.mvicvli ? contagens.mvicvli.mvi : null,
            cvli: contagens.mvicvli ? contagens.mvicvli.total : null,
            cvp: contagens.cvp ? contagens.cvp.total : null,
            tco: contagens.tco ? contagens.tco.total : null,
            armas: contagens.armas ? contagens.armas.total : null,
            drogas: contagens.drogas ? contagens.drogas.total : null,
            aceitabilidadeTcoPct,
            totalTcoCruzados,
        };
    }
    // modo: 'aceitavel' | 'falha' | 'ambos' (padrão 'ambos').
    async function obterRankingTCO(modo, textoPeriodo) {
        const qMin = NORM(textoPeriodo || '').toLowerCase();
        let casos;
        try { casos = await montarCasosMilitaresTCO(); } catch (e) { return []; }
        const periodo = detectarPeriodo(qMin);
        const filtrados = periodo.implicito ? casos : casos.filter(c => c.data && c.data >= periodo.ini && c.data <= periodo.fim);

        const contPorMilitar = {};
        filtrados.forEach(c => {
            const chave = (c.posto ? c.posto + ' ' : '') + c.nome;
            if (!contPorMilitar[chave]) contPorMilitar[chave] = { nome: chave, aceitaveis: 0, falhas: 0 };
            if (c.classif === 'aceitavel') contPorMilitar[chave].aceitaveis++; else contPorMilitar[chave].falhas++;
        });
        const criterio = modo === 'falha' ? 'falhas' : 'aceitaveis';
        return Object.values(contPorMilitar).sort((a, b) => b[criterio] - a[criterio]).slice(0, 10);
    }
    // cidade: nome exato (ou o mais próximo — mesmo casamento usado no
    // resto do Xerife) de uma das cidades da unidade. Sem coords (cidade
    // fora de CIDADE_COORDS_X) o dashboard simplesmente não desenha o
    // marcador — nunca inventa latitude/longitude.
    async function obterHotspots(cidade, textoPeriodo) {
        const qMin = NORM(textoPeriodo || '').toLowerCase();
        let dados;
        try { dados = await calcularCriticidade('', qMin, cidade); } catch (e) { return null; }
        if (!dados) return null;
        return { ...dados, coords: coordsPorCidade(dados.cidadeAlvo) };
    }
    async function obterVisitasSugeridas(textoLivre) {
        const q = NORM(textoLivre || '');
        const qMin = q.toLowerCase();
        try { return await calcularVisitasSugeridas(q, qMin); }
        catch (e) { return { cidade: null, rotuloPeriodo: '', resultados: [] }; }
    }
    // Cidades com coordenada conhecida (pro mapa desenhar os marcadores de
    // base antes de qualquer pergunta) — mesma lista de CIDADE_COORDS_X.
    function obterCidadesComCoordenadas() {
        return Object.entries(CIDADE_COORDS_X).map(([cidade, coords]) => ({ cidade, coords }));
    }
    // Identifica se o texto é uma CONSULTA de cadastro (CPF/processo/
    // boletim/nome) — mesma detecção usada em processarPergunta(), só que
    // exposta sem executar a busca (o dashboard usa isso só pra decidir se
    // mostra o botão de baixar PDF; a resposta em si continua vindo de
    // responderTexto(), nunca recalculada aqui).
    function identificarConsulta(textoOriginal) {
        const qMin = NORM(textoOriginal || '').toLowerCase();
        const ident = extrairIdentificador(qMin);
        if (ident) return ident;
        const nome = extrairNomeProvavel(textoOriginal || '', qMin);
        if (nome) return { tipo: 'nome', valor: nome };
        return null;
    }
    // Acha a RP (ver MAPA_RP_CIDADES/Cartão Programa) que cobre uma cidade —
    // comparação sem acento dos dois lados.
    function encontrarRPPorCidade(cidade) {
        const alvo = NORM(cidade);
        for (const [rp, cidades] of Object.entries(MAPA_RP_CIDADES)) {
            if (cidades.some(c => NORM(c) === alvo)) return rp;
        }
        return null;
    }
    // Previsão (MVI/CVLI/CVP) recortada por CIDADE — mesma fórmula de
    // responderPrevisao() (60% média ponderada dos últimos 3 meses + 40%
    // regressão linear sobre 12 meses), mas responderPrevisao() é sempre
    // da unidade inteira (sem filtro de cidade) e o relatório por cidade
    // precisa especificamente disso — por isso a fórmula (não a
    // CLASSIFICAÇÃO, que continua vindo de isMVI/isCVP) é reaplicada aqui
    // sobre a lista já filtrada pela cidade. Mudou a fórmula lá, muda aqui.
    async function calcularPrevisaoCidade(cidade) {
        const [geral, cvp] = await Promise.all([fetchNode('geral'), fetchNode('cvp')]);
        const cidadeNorm = NORM(cidade);
        const dessaCidade = lista => lista.filter(i => NORM(CAMPO(i, 'CIDADE')) === cidadeNorm);
        const geralCidade = dessaCidade(geral), cvpCidade = dessaCidade(cvp);

        const mviItens = geralCidade.filter(isMVI);
        const cvliItens = geralCidade.filter(i => { const t = NORM(CAMPO(i, 'TIPIFICACAO_GERAL', 'TIPIFICACAO')); return t.includes('HOMICIDIO') || t.includes('FEMINICIDIO') || t.includes('LATROCINIO'); });
        const cvpItens = cvpCidade.filter(isCVP);

        const hoje = new Date();
        const meses12 = [];
        for (let i = 11; i >= 0; i--) { const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1); meses12.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
        const chaveMes = item => { const d = parseData(CAMPO(item, 'DATA', 'data')); return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : null; };
        const serie = itens => { const por = {}; itens.forEach(i => { const ch = chaveMes(i); if (ch) por[ch] = (por[ch] || 0) + 1; }); return meses12.map(ch => por[ch] || 0); };
        const regressaoLinear1 = arr => {
            const n = arr.length; if (n < 2) return arr[0] ?? 0;
            let sx = 0, sy = 0, sxy = 0, sx2 = 0;
            arr.forEach((v, i) => { sx += i; sy += v; sxy += i * v; sx2 += i * i; });
            const denom = n * sx2 - sx * sx;
            const m = denom ? (n * sxy - sx * sy) / denom : 0;
            const b = (sy - m * sx) / n;
            return Math.round(Math.max(0, m * n + b));
        };
        const mediaPonderada3 = arr => {
            const ult = arr.slice(-3); if (!ult.length) return 0;
            const pesos = [1, 2, 3].slice(3 - ult.length);
            const soma = ult.reduce((a, v, i) => a + v * pesos[i], 0);
            return Math.round(soma / pesos.reduce((a, v) => a + v, 0));
        };
        const prever = arr => Math.round(mediaPonderada3(arr) * 0.6 + regressaoLinear1(arr) * 0.4);

        const montar = itens => { const s = serie(itens); return { ultimosTresMeses: s.slice(-3), previstoProximoMes: prever(s) }; };
        return { mvi: montar(mviItens), cvli: montar(cvliItens), cvp: montar(cvpItens) };
    }
    // Relatório agregado de UMA CIDADE em UM ANO — reaproveita 100% das
    // mesmas fontes/regras já usadas em outras partes do Xerife (contagem
    // por categoria+cidade+período, cruzamento TCO×Sentenças×Guarnição,
    // criticidade por bairro/turno, previsão, Cartão Programa) — só agrupa
    // tudo numa resposta só, pro dashboard montar o relatório detalhado ou
    // a apresentação narrada.
    // cidade: null/vazio = RELATÓRIO GERAL DA UNIDADE (agregado de todas
    // as cidades, sem filtro) — pedido explícito do usuário: "se eu não
    // falar nenhuma cidade ou unidade, entenda que será o geral da
    // unidade logada". textoPeriodo: texto livre (não só um ano) — usa o
    // MESMO detectarPeriodo() do resto do arquivo, que já entende ano
    // isolado, mês, "este/esse ano", "mês passado" E SEMESTRE ("primeiro
    // semestre de 2026", "2º semestre") — só passar a frase inteira já
    // basta, nada de extrair só o ano feito antes.
    async function obterRelatorioCidade(cidade, textoPeriodo) {
        const qMinPeriodo = NORM(String(textoPeriodo || '')).toLowerCase();
        const periodoDet = detectarPeriodo(qMinPeriodo);
        const periodo = { ini: periodoDet.ini, fim: periodoDet.fim };
        const ano = periodoDet.ini.getFullYear();

        const contagens = {};
        for (const chave of ['mvicvli', 'cvp', 'armas', 'drogas']) {
            const cat = CATEGORIAS[chave];
            try {
                const bruto = await cat.fetch();
                const filtrada = bruto.filter(cat.filtroBase).filter(i => {
                    const d = parseData(cat.campoData(i));
                    if (!d || d < periodo.ini || d > periodo.fim) return false;
                    if (cidade && cat.campoCidade && NORM(cat.campoCidade(i)) !== NORM(cidade)) return false;
                    return true;
                });
                contagens[chave] = { total: filtrada.length, mvi: chave === 'mvicvli' ? filtrada.filter(isMVI).length : null };
            } catch (e) { contagens[chave] = null; }
        }

        const tco = { total: null, aceitabilidadePct: null };
        try {
            const unicos = casosUnicosPorTco(await montarCasosMilitaresTCO());
            const doPeriodo = unicos.filter(c => c.data && c.data >= periodo.ini && c.data <= periodo.fim && (!cidade || NORM(c.cidade) === NORM(cidade)));
            tco.total = doPeriodo.length;
            if (tco.total > 0) tco.aceitabilidadePct = Math.round(doPeriodo.filter(c => c.classif === 'aceitavel').length / tco.total * 100);
        } catch (e) { /* fica null */ }

        // Hotspots/previsão/cartão-programa são conceitos POR CIDADE (rankeia
        // bairro dentro de UMA cidade, ou prevê tendência de UMA cidade) —
        // sem cidade (relatório geral), ficam de fora; os totais agregados
        // acima já são o valor real desse caso.
        let hotspots = null;
        if (cidade) { try { hotspots = await calcularCriticidade('', qMinPeriodo || ('em ' + ano), cidade); } catch (e) { /* fica null */ } }

        let previsao = null;
        if (cidade) { try { previsao = await calcularPrevisaoCidade(cidade); } catch (e) { /* fica null */ } }

        let cartaoPrograma = null;
        if (cidade) {
            const rp = encontrarRPPorCidade(cidade);
            if (rp) { try { cartaoPrograma = { rp, dados: await processarCartaoPrograma(rp) }; } catch (e) { /* fica null */ } }
        }

        return {
            cidade: cidade || null, ano, periodoLabel: periodoDet.label,
            mvi: contagens.mvicvli ? contagens.mvicvli.mvi : null,
            cvli: contagens.mvicvli ? contagens.mvicvli.total : null,
            cvp: contagens.cvp ? contagens.cvp.total : null,
            armas: contagens.armas ? contagens.armas.total : null,
            drogas: contagens.drogas ? contagens.drogas.total : null,
            tco, hotspots, previsao, cartaoPrograma,
            coords: cidade ? coordsPorCidade(cidade) : null,
        };
    }

    // Relatório agregado de UMA CATEGORIA (ex.: "relatório de violência
    // doméstica") num período — total, top cidades, tendência mês a mês,
    // status. Reaproveita o MESMO CATEGORIAS/detectarCategoria/
    // detectarPeriodo do resto do arquivo — nunca duplica a lógica de
    // busca/filtro. cidade: opcional (sem cidade = toda a unidade, mesmo
    // princípio do relatório geral/obterRelatorioCidade). Retorna null se
    // o texto não corresponder a nenhuma categoria conhecida (chamador
    // decide o que fazer — nunca inventa uma categoria).
    async function obterRelatorioCategoria(textoCategoria, textoPeriodo, cidade) {
        // detectarCategoria espera o texto em MAIÚSCULAS (só NORM, sem
        // toLowerCase — ver uso real em responderPergunta: `const q =
        // NORM(textoOriginal)`, sempre maiúsculo) — os nomes em
        // CATEGORIAS[].nomes também passam por NORM() na comparação, que
        // já uppercasa; um texto em minúsculas aqui nunca bate com nada.
        const chave = detectarCategoria(NORM(textoCategoria || ''));
        if (!chave) return null;
        const cat = CATEGORIAS[chave];
        const qMinPeriodo = NORM(String(textoPeriodo || '')).toLowerCase();
        const periodoDet = detectarPeriodo(qMinPeriodo);

        let bruto = [];
        try { bruto = await cat.fetch(); } catch (e) { /* fica vazio — relatório mostra zerado, nunca quebra */ }
        let filtrada = bruto.filter(cat.filtroBase).filter(i => {
            const d = parseData(cat.campoData(i));
            return d && d >= periodoDet.ini && d <= periodoDet.fim;
        });
        if (cidade && cat.campoCidade) filtrada = filtrada.filter(i => NORM(cat.campoCidade(i)) === NORM(cidade));

        const porCidade = {};
        if (!cidade && cat.campoCidade) {
            filtrada.forEach(i => { const c = cat.campoCidade(i) || 'não informado'; porCidade[c] = (porCidade[c] || 0) + 1; });
        }
        const topCidades = Object.entries(porCidade).sort((a, b) => b[1] - a[1]).slice(0, 8);

        const porStatus = {};
        if (cat.campoStatus) {
            filtrada.forEach(i => { const s = cat.campoStatus(i) || 'não informado'; porStatus[s] = (porStatus[s] || 0) + 1; });
        }
        const topStatus = Object.entries(porStatus).sort((a, b) => b[1] - a[1]).slice(0, 6);

        const meses = listarMesesDoPeriodo(periodoDet);
        const porMes = meses.map(m => {
            const ini = new Date(m.ano, m.mes, 1), fim = new Date(m.ano, m.mes + 1, 0, 23, 59, 59, 999);
            const qtd = filtrada.filter(i => { const d = parseData(cat.campoData(i)); return d && d >= ini && d <= fim; }).length;
            return { label: `${MESES_EXIBICAO[m.mes]}/${m.ano}`, qtd };
        });

        return {
            categoria: cat.label, cidade: cidade || null, periodoLabel: periodoDet.label,
            total: filtrada.length, topCidades, topStatus, porMes,
        };
    }
    // Versão SÍNCRONA/leve (não busca dado nenhum) de detectarCategoria —
    // exposta pro dashboard JARVIS conseguir decidir, num detector de
    // texto puro, se "relatório de X" é uma CATEGORIA (violência
    // doméstica, drogas...) antes de chamar obterRelatorioCategoria de
    // verdade (que já faz o fetch pesado).
    function identificarCategoriaPorTexto(texto) {
        // Mesmo motivo do comentário em obterRelatorioCategoria — sem
        // toLowerCase, detectarCategoria precisa do texto em MAIÚSCULAS.
        const chave = detectarCategoria(NORM(texto || ''));
        return chave ? CATEGORIAS[chave].label : null;
    }

    // Além de `alternar` (abre/fecha o balão flutuante), expõe um punhado de
    // internos pra página dedicada de chat mobile (page/chat-mobile.html),
    // pro módulo de análise de documentos (js/xerife-documentos.js) e pro
    // dashboard JARVIS (js/components/jarvis-dashboard.js) reaproveitarem o
    // MESMO motor de perguntas/respostas/IA local/regras de negócio, em vez
    // de duplicar essa lógica numa UI separada.
    window.Xerife = {
        alternar,
        enviarPergunta,
        carregarHistorico,
        adicionarMensagem,
        escHtml,
        gerarComIA,
        obterEstadoIA: () => llmEstado,
        obterProgressoIA: () => llmProgresso,
        responderTexto,
        obterKPIs,
        obterRankingTCO,
        obterHotspots,
        obterVisitasSugeridas,
        obterCidadesComCoordenadas,
        identificarConsulta,
        obterRelatorioCidade,
        obterRelatorioCategoria,
        identificarCategoriaPorTexto,
        obterCumprimentoCartoes,
        // Fire-and-forget — ver doutrina de privacidade completa acima de
        // registrarInteracaoTelemetria(). texto: pergunta original;
        // bolhaConteudo é opcional (só o chat com bolhas usa, pra ligar os
        // botões de 👍/👎 — o dashboard JARVIS chama sem esse 2º argumento).
        registrarInteracaoTelemetria,
    };
})();
