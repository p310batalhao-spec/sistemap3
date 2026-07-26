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

    const NODE_CACHE = {};
    async function fetchNode(node) {
        await garantirConfig();
        if (NODE_CACHE[node]) return NODE_CACHE[node];
        const resp = await fetch(`${DATABASE_URL}/${node}.json`);
        const dados = resp.ok ? await resp.json() : null;
        const lista = dados ? Object.values(dados) : [];
        NODE_CACHE[node] = lista;
        return lista;
    }
    async function fetchTCO() {
        await garantirConfig();
        if (NODE_CACHE.__tco) return NODE_CACHE.__tco;
        const resp = await fetch(`${APPS_SCRIPT_TCO_URL}?action=getTCO`, { redirect: 'follow' });
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
        const resp = await fetch(`${APPS_SCRIPT_MATERIAIS_URL}?action=read`, { redirect: 'follow' });
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
        const resp = await fetch(`${APPS_SCRIPT_SENTENCAS_URL}?action=listarSentencas`, { redirect: 'follow' });
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
        const resp = await fetch(`${DATABASE_URL}/guarnicao.json`);
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
            const webllm = await import('https://esm.run/@mlc-ai/web-llm');
            const progressCb = (info) => {
                llmProgresso = Math.round((info && info.progress || 0) * 100);
                atualizarBadgeIA();
            };

            // Tenta manter a IA viva num Service Worker — assim ela carrega
            // só UMA VEZ e sobrevive a recarregar a página ou navegar pra
            // outra (ver xerife-sw.js). Se der qualquer problema (navegador
            // sem suporte, biblioteca sem esse recurso, etc.), cai pro modo
            // "carrega só nesta página" de antes, sem quebrar o Xerife.
            if ('serviceWorker' in navigator && webllm.CreateServiceWorkerMLCEngine) {
                try {
                    const prefixo = /\/(page|relatorios|public|termos)\//.test(location.pathname) ? '../' : '';
                    await navigator.serviceWorker.register(prefixo + 'xerife-sw.js', { type: 'module' });
                    await navigator.serviceWorker.ready;
                    llmEngine = await webllm.CreateServiceWorkerMLCEngine(MODELO_LLM, { initProgressCallback: progressCb });
                } catch (eSw) {
                    console.warn('Xerife: service worker da IA indisponível, carregando só nesta página.', eSw);
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
            nomes: ['mvi', 'cvli', 'morte violenta', 'morte intencional', 'homicidio', 'feminicidio', 'assassinato'],
            label: 'CVLI (Crimes Violentos Letais Intencionais)',
            fetch: () => fetchNode('geral'),
            filtroBase: i => { const t = NORM(CAMPO(i, 'TIPIFICACAO_GERAL', 'TIPIFICACAO')); return t.includes('HOMICIDIO') || t.includes('FEMINI'); },
            campoData: i => CAMPO(i, 'DATA', 'data'), campoCidade: i => CAMPO(i, 'CIDADE'), campoBairro: i => CAMPO(i, 'BAIRRO'), campoTip: i => CAMPO(i, 'TIPIFICACAO_GERAL', 'TIPIFICACAO') || 'não informado',
            campoNome: i => CAMPO(i, 'SOLICITANTE'), labelNome: 'solicitante',
            campoStatus: i => CAMPO(i, 'SOLUCAO', 'SOLUÇÃO') || 'não informado',
        },
        cvp: {
            nomes: ['cvp', 'roubo', 'furto', 'patrimonio', 'extorsao', 'latrocinio'],
            label: 'CVP (Crimes Violentos contra o Patrimônio)',
            fetch: () => fetchNode('cvp'),
            filtroBase: isCVP,
            campoData: i => CAMPO(i, 'DATA', 'data'), campoCidade: i => CAMPO(i, 'CIDADE'), campoBairro: i => CAMPO(i, 'BAIRRO'), campoTip: i => CAMPO(i, 'TIPIFICACAO_GERAL', 'TIPIFICACAO') || 'não informado',
            campoNome: i => CAMPO(i, 'SOLICITANTE', 'AUTOR'), labelNome: 'solicitante',
            campoStatus: i => CAMPO(i, 'SOLUCAO', 'SOLUÇÃO') || 'não informado',
        },
        tco: {
            nomes: ['tco', 'termo circunstanciado'],
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
                autores.filter(a => normBoletim(CAMPO(a, 'BOLETIM')) === boletim).forEach(a => {
                    secoes.push(`👤 <strong>Autor/envolvido</strong>: ${CAMPO(a, 'NOME') || 'sem nome'}, ${CAMPO(a, 'NATUREZA') || CAMPO(a, 'TIPIFICACAO') || '—'}, situação: ${CAMPO(a, 'SITUACAO') || '—'}, ${CAMPO(a, 'CIDADE') || '—'}${CAMPO(a, 'BAIRRO') ? '/' + CAMPO(a, 'BAIRRO') : ''}, CPF: ${CAMPO(a, 'CPF') || '—'}`);
                });
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
            return `🔎 ${achados.length} registro(s) encontrado(s) ${titulo}:<br><br>` + blocos.join('<br><br>');
        }
        if (identificador.tipo === 'processo' || identificador.tipo === 'boletim') {
            return await montarRelatorioCompleto(identificador);
        }
        return 'Não consegui identificar o CPF, boletim ou processo na pergunta — tenta incluir o número completo.';
    }

    // ── Respostas ────────────────────────────────────────────────────
    // categoriasFiltro: se informado (ex.: usuário pediu "resumo de MVI e CVP"),
    // mostra só essas categorias em vez das 7 padrão.
    async function responderResumo(periodo, categoriasFiltro) {
        const chaves = (categoriasFiltro && categoriasFiltro.length) ? categoriasFiltro : ['mvicvli', 'tco', 'armas', 'drogas', 'perturbacao', 'violencia', 'visita'];
        const linhas = [];
        for (const chave of chaves) {
            const cat = CATEGORIAS[chave];
            if (!cat) continue;
            try {
                const bruto = await cat.fetch();
                const filtrada = bruto.filter(cat.filtroBase).filter(i => { const d = parseData(cat.campoData(i)); return d && d >= periodo.ini && d <= periodo.fim; });
                if (chave === 'mvicvli') {
                    linhas.push(`• <strong>${filtrada.length}</strong> CVLI (dos quais <strong>${filtrada.filter(isMVI).length}</strong> MVI)`);
                } else {
                    linhas.push(`• <strong>${filtrada.length}</strong> ${cat.label}`);
                }
            } catch (e) { /* categoria falhou, segue pras outras */ }
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
        if (mov.includes('julgado')) return 'aceitavel';
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
        const [tcos, sentencas, guarPorBoletim] = await Promise.all([fetchTCO(), fetchSentencas(), fetchGuarnicao()]);

        const semAcentoMin = s => NORM(s).toLowerCase();
        const esajMap = {}, esajData = {}, esajComarca = {}, esajMotivo = {};
        sentencas.forEach(r => {
            const numero = semAcentoMin(CAMPO(r, 'Nº Processo'));
            if (!numero) return;
            const motivoCanon = canonMotivoX(
                CAMPO(r, 'Motivo do Arquivamento'), CAMPO(r, 'Resultado'),
                CAMPO(r, 'Erro – Atipicidade Material', 'Erro - Atipicidade Material'),
                CAMPO(r, 'Erro – Atipicidade Formal', 'Erro - Atipicidade Formal')
            );
            esajData[numero] = parseData(CAMPO(r, 'Data da Sentença'));
            esajComarca[numero] = CAMPO(r, 'Comarca') || '';
            esajMotivo[numero] = { motivoCanon, grupo: grupoDoRegistroX(motivoCanon, CAMPO(r, 'Resultado')) };
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
            const info = esaj && esajMotivo[esaj];
            let classif = null;
            if (info && info.grupo === 'falha') classif = 'falha';
            else if (info && (info.grupo === 'aceitavel' || info.grupo === 'processual')) classif = 'aceitavel';
            if (!classif) classif = classificarTcoFallback(t);
            if (!classif) return;

            const bol = esajMap[esaj] || CAMPO(t, 'Nº Ocorrência').trim();
            if (!bol) return;
            const igs = getIgs(bol);
            if (!igs.length) return;

            const tip = CAMPO(t, 'Tipicidade Geral') || '—';
            const data = (esaj && esajData[esaj]) || parseData(CAMPO(t, 'DATA')) || null;
            const comarca = (esaj && esajComarca[esaj]) || '';
            const motivoCanon = (esaj && esajMotivo[esaj] && esajMotivo[esaj].motivoCanon) || null;

            igs.forEach(ig => {
                if (!ig) return;
                let posto = String(ig.POSTO_GRADUACAO || ig['Posto / Graduação'] || '').trim();
                if (posto === '---') posto = '';
                const nome = String(ig.NOME_GUERRA || ig['Nome de guerra'] || ig.NOME_COMPLETO || '').trim();
                if (!nome) return;
                casos.push({ esaj: esaj || '—', bol, posto, nome, data, comarca, tip, classif, motivoCanon });
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
    // pesos de gravidade de js/gerarcartao.js (últimos 90 dias, prioridade
    // gravidade > quantidade, mesma escala de cor 25%/50%).
    async function responderCriticidade(qOriginal) {
        let geral, cvp, cvli, droga;
        try {
            [geral, cvp, cvli, droga] = await Promise.all([
                fetchNode('geral'), fetchNode('cvp'), fetchNode('cvli'), fetchNode('droga')
            ]);
        } catch (e) { return '⚠️ Não consegui buscar os dados agora. Tente de novo em instantes.'; }

        const cidadeAlvo = detectarCidadeEmListas(qOriginal, [geral, cvp, cvli, droga]);
        if (!cidadeAlvo) return 'Preciso saber de qual cidade — pergunte, por exemplo: <em>"quais os horários e bairros críticos em Palmeira dos Índios?"</em>.';

        const PESOS_CRIT = { cvli: 5, droga: 4, cvp: 3, geral: 1 };
        const hoje = new Date();
        const limite90 = new Date(hoje); limite90.setDate(hoje.getDate() - 90);
        const dentroJanela = dataStr => { const d = parseData(dataStr); return d && d >= limite90 && d <= hoje; };
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
        const topBairros = (scores, n) => Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]);

        const nomesTurno = { manha: 'Manhã (06h–12h)', tarde: 'Tarde (12h–18h)', noite: 'Noite (18h–06h)' };
        const linhas = [];
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

            if (!locais.length) { linhas.push(`• <strong>${nomesTurno[t]}</strong>: sem registros nos últimos 90 dias.`); continue; }
            const nivel = pct > 50 ? '🔴 ROTA CRÍTICA' : pct >= 25 ? '🟠 Atenção' : '⬜ Normal';
            linhas.push(`• <strong>${nomesTurno[t]}</strong>: ${locais.join(', ')} — ${nivel} (${criterio} ${pct.toFixed(0)}%)`);
        }
        return `🗺️ Horários e bairros críticos em <strong>${cidadeAlvo}</strong> (últimos 90 dias — mesmo critério do Cartão Programa: gravidade &gt; quantidade; peso cvli=5, droga=4, cvp=3):<br>${linhas.join('<br>')}`;
    }

    // ── Cartão Programa das guarnições ───────────────────────────────
    // Réplica fiel de processarDados()/MAPA_RP_CIDADES/PESOS em
    // js/gerarcartao.js (usado em relatorios/cartaoprograma.html) — MESMA
    // inteligência criminal (90 dias, peso cvli=5/droga=4/cvp=3/geral=1,
    // turnos manhã/tarde/noite, gravidade > quantidade > histórico geral) e
    // MESMO cronograma fixo por RP — só muda o formato de saída (texto de
    // chat em vez da tabela imprimível). Se mudar o critério lá, mudar aqui
    // também (ver aviso equivalente no topo do arquivo pra regra de MVI).
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
    const PESOS_CARTAO = { cvli: 5, droga: 4, cvp: 3, geral: 1 };

    function ehCartaoPrograma(qMin) {
        return qMin.includes('cartao programa') || qMin.includes('cartao de programa') ||
            (qMin.includes('cartao') && qMin.includes('programa')) ||
            (qMin.includes('programa') && (qMin.includes('guarnicao') || qMin.includes('patrulhamento') || / rp\b|\brp /.test(qMin)));
    }
    // Aceita citar a RP direto ("RP 01", "Paulo Jacinto") ou só a cidade
    // ("cartão programa de Palmeira") — usa o mesmo texto NORM (maiúsculo,
    // sem acento) já usado no resto do arquivo pra casar com as chaves.
    function detectarRPNaPergunta(q) {
        for (const chave of Object.keys(MAPA_RP_CIDADES)) {
            if (q.includes(NORM(chave))) return chave;
        }
        for (const [chave, cidades] of Object.entries(MAPA_RP_CIDADES)) {
            if (cidades.some(c => q.includes(NORM(c)))) return chave;
        }
        return null;
    }

    async function processarCartaoPrograma(chaveRP) {
        const [geral, cvp, cvli, droga] = await Promise.all([
            fetchNode('geral'), fetchNode('cvp'), fetchNode('cvli'), fetchNode('droga')
        ]);
        const db = { geral, cvp, cvli, droga };
        const cidadesAlvo = MAPA_RP_CIDADES[chaveRP].map(c => c.toUpperCase());

        const hoje = new Date();
        const limite90 = new Date(hoje); limite90.setDate(hoje.getDate() - 90);
        const dentroJanelaCartao = dataStr => { const d = parseData(dataStr); return d && d >= limite90 && d <= hoje; };
        // Mesma correção crítica do gerarcartao.js: HORA às vezes vem com o
        // número do boletim (ex.: "46336") — só aceita 0–23, senão é lixo.
        const horaValidaCartao = horaStr => {
            if (!horaStr) return null;
            const s = String(horaStr).trim();
            const h = s.includes(':') ? parseInt(s.split(':')[0], 10) : parseInt(s, 10);
            return (h >= 0 && h <= 23) ? h : null;
        };

        const qtd = { manha: {}, tarde: {}, noite: {} };
        const grave = { manha: {}, tarde: {}, noite: {} };
        const totalQtdTurno = { manha: 0, tarde: 0, noite: 0 };
        const totalGraveTurno = { manha: 0, tarde: 0, noite: 0 };
        const qtdGeral = {}, graveGeral = {};
        const logradourosRurais = {};

        Object.keys(db).forEach(categoria => {
            (db[categoria] || []).forEach(item => {
                const cid = String(CAMPO(item, 'CIDADE') || '').toUpperCase().trim();
                if (!cidadesAlvo.some(c => cid.includes(c))) return;

                const bairro = String(CAMPO(item, 'BAIRRO') || '').toUpperCase().trim();
                const logradouro = String(CAMPO(item, 'LOGRADOURO', 'ENDERECO') || '').toUpperCase().trim();
                if (!bairro) return;

                const ehRural = bairro.includes('ZONA RURAL') || bairro.includes('RURAL');
                if (ehRural && logradouro) {
                    if (!logradourosRurais[bairro]) logradourosRurais[bairro] = {};
                    logradourosRurais[bairro][logradouro] = (logradourosRurais[bairro][logradouro] || 0) + 1;
                }

                const pesoTotal = PESOS_CARTAO[categoria] || 1;
                const pesoGravio = categoria !== 'geral' ? pesoTotal : 0;

                qtdGeral[bairro] = (qtdGeral[bairro] || 0) + 1;
                graveGeral[bairro] = (graveGeral[bairro] || 0) + pesoGravio;

                if (!dentroJanelaCartao(CAMPO(item, 'DATA', 'data'))) return;
                const h = horaValidaCartao(CAMPO(item, 'HORA', 'hora'));

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

        const resolverLocal = bairro => {
            const ehRural = bairro.includes('ZONA RURAL') || bairro.includes('RURAL');
            if (ehRural && logradourosRurais[bairro]) {
                const top = Object.entries(logradourosRurais[bairro]).sort((a, b) => b[1] - a[1])[0];
                return top ? top[0] : bairro;
            }
            return bairro;
        };
        const somaObjCartao = obj => Object.values(obj).reduce((a, b) => a + b, 0);
        const topBairrosCartao = (scores, n) => Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, n).map(([b]) => resolverLocal(b));

        const analisarTurnoCartao = (nomeTurno, nLocais) => {
            const n = nLocais || 3;
            const somaGraveTurno = somaObjCartao(grave[nomeTurno]);
            const somaQtdTurno = somaObjCartao(qtd[nomeTurno]);
            const totalGraveValido = Object.values(totalGraveTurno).reduce((a, b) => a + b, 0);
            const totalQtdValido = Object.values(totalQtdTurno).reduce((a, b) => a + b, 0);

            if (totalGraveTurno[nomeTurno] > 0 || somaGraveTurno > 0) {
                const pct = totalGraveValido > 0 ? (totalGraveTurno[nomeTurno] / totalGraveValido) * 100 : 0;
                const locais = topBairrosCartao(grave[nomeTurno], n);
                const nOcorr = totalQtdTurno[nomeTurno] > 0 ? `${totalQtdTurno[nomeTurno]} ocorr. c/ hora` : 'ocorrências';
                const info = pct > 0 ? `GRAV.${pct.toFixed(0)}% — ${nOcorr} (90 dias)` : `${nOcorr} (90 dias)`;
                let miss = null, h = null;
                if (pct > 50) { miss = '🚨 ROTA CRÍTICA'; h = 'red'; } else if (pct >= 25) { h = 'orange'; }
                return { locais, info, miss, h };
            }
            if (totalQtdTurno[nomeTurno] > 0 || somaQtdTurno > 0) {
                const pct = totalQtdValido > 0 ? (totalQtdTurno[nomeTurno] / totalQtdValido) * 100 : 0;
                const locais = topBairrosCartao(qtd[nomeTurno], n);
                const nOcorr = totalQtdTurno[nomeTurno] > 0 ? `${totalQtdTurno[nomeTurno]} ocorr.` : 'registros';
                const info = pct > 0 ? `QTD.${pct.toFixed(0)}% — ${nOcorr} (90 dias)` : `${nOcorr} (90 dias)`;
                let miss = null, h = null;
                if (pct > 50) { miss = '🚨 ROTA CRÍTICA'; h = 'red'; } else if (pct >= 25) { h = 'orange'; }
                return { locais, info, miss, h };
            }
            const fallback = Object.values(graveGeral).some(v => v > 0) ? graveGeral : qtdGeral;
            return { locais: topBairrosCartao(fallback, n), info: 'HISTÓRICO GERAL', miss: null, h: null };
        };

        const montarLinha = (ini, fim, nomeTurno, missPadrao, nLocais) => {
            const { locais, info, miss, h } = analisarTurnoCartao(nomeTurno, nLocais || 3);
            const top = locais.length > 0 ? locais.join(' | ') : 'CENTRO DA CIDADE';
            return { ini, fim, miss: miss || missPadrao, det: `${top}  (${info})`, h };
        };
        const fixa = (ini, fim, miss, det, h) => ({ ini, fim, miss, det, h: h || null });

        let cronograma;
        switch (chaveRP) {
            case 'RP 01':
                cronograma = [
                    montarLinha('08:30', '13:00', 'manha', 'Patrulhamento Setorial'),
                    fixa('13:00', '17:30', 'Almoço / Prontidão', 'BASE OPERACIONAL', 'green'),
                    fixa('18:00', '19:00', 'JANTA', 'BASE OPERACIONAL', 'green'),
                    montarLinha('19:00', '00:00', 'noite', 'Patrulhamento Noturno 1'),
                    montarLinha('00:00', '03:00', 'noite', 'Patrulhamento Noturno 2'),
                    fixa('03:00', '05:00', 'Descanso / Prontidão', 'BASE OPERACIONAL', null),
                    montarLinha('05:00', '07:30', 'manha', 'OPO Alvorada'),
                ];
                break;
            case 'RP 02':
                cronograma = [
                    fixa('08:00', '13:00', 'Prontidão / Adm / ALMOÇO', 'BASE OPERACIONAL', 'green'),
                    montarLinha('12:00', '18:00', 'tarde', 'Patrulhamento Setorial'),
                    montarLinha('18:00', '19:00', 'noite', 'Ronda Crítica Noturna'),
                    fixa('19:00', '20:00', 'Janta / Prontidão', 'BASE OPERACIONAL', 'green'),
                    fixa('20:00', '20:30', 'OPO - POLICIAMENTO ESCOLAR', 'ESCOLA EST. MONSENHOR RIBEIRO - PALMEIRA DE FORA', 'red'),
                    montarLinha('20:30', '00:00', 'noite', 'Patrulhamento Noturno 1'),
                    fixa('00:00', '03:00', 'DESCANSO / PRONTIDÃO', 'BASE OPERACIONAL', 'green'),
                    montarLinha('03:00', '05:00', 'noite', 'Patrulhamento Noturno 2'),
                    fixa('05:00', '07:00', 'Descanso / Prontidão', 'BASE OPERACIONAL', null),
                ];
                break;
            case 'PAULO JACINTO':
                cronograma = [
                    fixa('08:00', '08:30', 'Apresentação', 'APRESENTAÇÃO E PRELEÇÃO.', null),
                    montarLinha('08:30', '13:00', 'manha', 'Patrulhamento - MAR VERMELHO'),
                    fixa('13:00', '16:30', 'Almoço e Prontidão', 'BASE OPERACIONAL.', 'green'),
                    montarLinha('16:30', '19:00', 'tarde', 'Rota Prioritária Tarde'),
                    fixa('19:00', '20:00', 'Janta e Prontidão', 'BASE OPERACIONAL.', 'green'),
                    fixa('20:00', '20:30', 'OPO - POLICIAMENTO ESCOLAR', 'ESCOLA ESTADUAL JOSÉ MEDEIROS', 'red'),
                    montarLinha('20:30', '22:00', 'noite', 'Patrulhamento Noturno 1'),
                    montarLinha('22:00', '00:00', 'noite', 'Patrulhamento Noturno 2'),
                    fixa('00:00', '05:00', 'Descanso/Prontidão', 'BASE OPERACIONAL.', null),
                    montarLinha('05:00', '07:00', 'manha', 'OPO ALVORADA'),
                    fixa('07:00', '08:00', 'Finalização', 'MANUTENÇÃO DE VIATURA E RENDIÇÃO.', null),
                ];
                break;
            case 'MAR VERMELHO':
                cronograma = [
                    fixa('08:00', '08:30', 'Apresentação', 'APRESENTAÇÃO E PRELEÇÃO.', null),
                    montarLinha('08:30', '13:00', 'manha', 'Patrulhamento - PAULO JACINTO'),
                    fixa('13:00', '16:30', 'Almoço e Prontidão', 'BASE OPERACIONAL.', 'green'),
                    montarLinha('16:30', '19:00', 'tarde', 'Rota Prioritária Tarde'),
                    fixa('19:00', '20:00', 'Janta e Prontidão', 'BASE OPERACIONAL.', 'green'),
                    montarLinha('20:00', '22:00', 'noite', 'Patrulhamento Noturno 1'),
                    montarLinha('22:00', '00:00', 'noite', 'Patrulhamento Noturno 2'),
                    fixa('00:00', '05:00', 'Descanso/Prontidão', 'BASE OPERACIONAL.', null),
                    montarLinha('05:00', '07:00', 'manha', 'OPO ALVORADA'),
                    fixa('07:00', '08:00', 'Finalização', 'MANUTENÇÃO DE VIATURA E RENDIÇÃO.', null),
                ];
                break;
            case 'ESTRELA DE ALAGOAS':
                cronograma = [
                    fixa('08:00', '08:30', 'Apresentação', 'APRESENTAÇÃO E PRELEÇÃO.', null),
                    montarLinha('08:30', '13:00', 'manha', 'Patrulhamento - MINADOR DO NEGRÃO'),
                    fixa('13:00', '16:30', 'Almoço e Prontidão', 'BASE OPERACIONAL.', 'green'),
                    montarLinha('16:30', '19:00', 'tarde', 'Rota Prioritária Tarde'),
                    fixa('19:00', '20:00', 'Janta e Prontidão', 'BASE OPERACIONAL.', 'green'),
                    montarLinha('20:00', '22:00', 'noite', 'Patrulhamento Noturno 1'),
                    montarLinha('22:00', '00:00', 'noite', 'Patrulhamento Noturno 2'),
                    fixa('00:00', '05:00', 'Descanso/Prontidão', 'BASE OPERACIONAL.', null),
                    montarLinha('05:00', '07:00', 'manha', 'OPO ALVORADA'),
                    fixa('07:00', '08:00', 'Finalização', 'MANUTENÇÃO DE VIATURA E RENDIÇÃO.', null),
                ];
                break;
            case 'MINADOR DO NEGRÃO':
                cronograma = [
                    fixa('08:00', '08:30', 'Apresentação', 'APRESENTAÇÃO E PRELEÇÃO.', null),
                    montarLinha('08:30', '13:00', 'manha', 'Patrulhamento - ESTRELA DE ALAGOAS'),
                    fixa('13:00', '16:30', 'Almoço e Prontidão', 'BASE OPERACIONAL.', 'green'),
                    montarLinha('16:30', '19:00', 'tarde', 'Rota Prioritária Tarde'),
                    fixa('19:00', '20:00', 'Janta e Prontidão', 'BASE OPERACIONAL.', 'green'),
                    montarLinha('20:00', '22:00', 'noite', 'Patrulhamento Noturno 1'),
                    montarLinha('22:00', '00:00', 'noite', 'Patrulhamento Noturno 2'),
                    fixa('00:00', '05:00', 'Descanso/Prontidão', 'BASE OPERACIONAL.', null),
                    montarLinha('05:00', '07:00', 'manha', 'OPO ALVORADA'),
                    fixa('07:00', '08:00', 'Finalização', 'MANUTENÇÃO DE VIATURA E RENDIÇÃO.', null),
                ];
                break;
            case 'BELÉM':
                cronograma = [
                    fixa('08:00', '08:30', 'Apresentação', 'APRESENTAÇÃO E PRELEÇÃO.', null),
                    montarLinha('08:30', '13:00', 'manha', "Patrulhamento - TANQUE D'ARCA"),
                    fixa('13:00', '16:30', 'Almoço e Prontidão', 'BASE OPERACIONAL.', 'green'),
                    montarLinha('16:30', '19:00', 'tarde', 'Rota Prioritária Tarde'),
                    fixa('19:00', '20:00', 'Janta e Prontidão', 'BASE OPERACIONAL.', 'green'),
                    montarLinha('20:00', '22:00', 'noite', 'Patrulhamento Noturno 1'),
                    montarLinha('22:00', '00:00', 'noite', 'Patrulhamento Noturno 2'),
                    fixa('00:00', '05:00', 'Descanso/Prontidão', 'BASE OPERACIONAL.', null),
                    montarLinha('05:00', '07:00', 'manha', 'OPO ALVORADA'),
                    fixa('07:00', '08:00', 'Finalização', 'MANUTENÇÃO DE VIATURA E RENDIÇÃO.', null),
                ];
                break;
            case "TANQUE D'ARCA":
                cronograma = [
                    fixa('08:00', '08:30', 'Apresentação', 'APRESENTAÇÃO E PRELEÇÃO.', null),
                    montarLinha('08:30', '13:00', 'manha', 'Patrulhamento - BELÉM'),
                    fixa('13:00', '16:30', 'Almoço e Prontidão', 'BASE OPERACIONAL.', 'green'),
                    montarLinha('16:30', '19:00', 'tarde', 'Rota Prioritária Tarde'),
                    fixa('19:00', '20:00', 'Janta e Prontidão', 'BASE OPERACIONAL.', 'green'),
                    montarLinha('20:00', '22:00', 'noite', 'Patrulhamento Noturno 1'),
                    montarLinha('22:00', '00:00', 'noite', 'Patrulhamento Noturno 2'),
                    fixa('00:00', '05:00', 'Descanso/Prontidão', 'BASE OPERACIONAL.', null),
                    montarLinha('05:00', '07:00', 'manha', 'OPO ALVORADA'),
                    fixa('07:00', '08:00', 'Finalização', 'MANUTENÇÃO DE VIATURA E RENDIÇÃO.', null),
                ];
                break;
            default: // Demais RPs: Cacimbinhas, Maribondo, Igaci, Quebrangulo…
                cronograma = [
                    fixa('08:00', '08:30', 'Apresentação', 'APRESENTAÇÃO E PRELEÇÃO.', null),
                    montarLinha('08:30', '13:00', 'manha', 'Patrulhamento Geral'),
                    fixa('13:00', '16:30', 'Almoço e Prontidão', 'BASE OPERACIONAL.', 'green'),
                    montarLinha('16:30', '19:00', 'tarde', 'Rota Prioritária Tarde'),
                    fixa('19:00', '20:00', 'Janta e Prontidão', 'BASE OPERACIONAL.', 'green'),
                    montarLinha('20:00', '22:00', 'noite', 'Patrulhamento Noturno 1'),
                    montarLinha('22:00', '00:00', 'noite', 'Patrulhamento Noturno 2'),
                    fixa('00:00', '05:00', 'Descanso/Prontidão', 'BASE OPERACIONAL.', null),
                    montarLinha('05:00', '07:00', 'manha', 'OPO ALVORADA'),
                    fixa('07:00', '08:00', 'Finalização', 'MANUTENÇÃO DE VIATURA E RENDIÇÃO.', null),
                ];
        }

        const totalNos90 = ['manha', 'tarde', 'noite'].reduce((s, t) => s + somaObjCartao(qtd[t]), 0);
        const nomesTurno = { manha: 'Manhã(06-12h)', tarde: 'Tarde(12-18h)', noite: 'Noite(18-05h)' };
        const partesResumo = [];
        const tV = Object.values(totalQtdTurno).reduce((a, b) => a + b, 0);
        const tG = Object.values(totalGraveTurno).reduce((a, b) => a + b, 0);
        for (const t of ['manha', 'tarde', 'noite']) {
            const pQ = tV > 0 ? (totalQtdTurno[t] / tV * 100).toFixed(0) : 0;
            const pG = tG > 0 ? (totalGraveTurno[t] / tG * 100).toFixed(0) : 0;
            const sQ = Math.round(somaObjCartao(qtd[t]));
            if (sQ > 0) partesResumo.push(`${nomesTurno[t]}: ${sQ} reg. | Grav.${pG}% / Qtd.${pQ}%`);
        }

        return { cidadesAlvo, cronograma, resumo: partesResumo.join(' • '), totalQtd: Math.round(totalNos90) };
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

        return `🚓 <strong>Cartão Programa — ${chaveRP}</strong> (${dados.cidadesAlvo.join(' / ')}) — ${new Date().toLocaleDateString('pt-BR')}:<br>${resumoHTML}<br><br>` +
            linhas.join('<br>') +
            `<br><br><small>Critério: gravidade (cvli×5, droga×4, cvp×3) &gt; quantidade, últimos 90 dias — mesma lógica de relatorios/cartaoprograma.html.</small>`;
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
        const ehIntentoDeterministico = ehSaudacao(qMin) || ehAjuda(qMin) || ehForaDeEscopo(qMin) || ehPrevisao(qMin) ||
            ehCriticidade(qMin) || ehCartaoPrograma(qMin) || ehAtendenteCopom(qMin) || ehComarcaArquivamentos(qMin) || ehRankingMilitaresTCO(qMin) ||
            ehLocalizacaoDroga(qMin) || ehMateriais(qMin) ||
            ehResumo(qMin) || ehComparativo(qMin) || ehIdentificador || ehDetalheDrogas(qMin) || ehTopStatus(qMin);
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

        // Consulta direta por identificador (CPF/boletim/processo/nome) —
        // checado cedo, antes de qualquer detecção de categoria/estatística,
        // já que isso é busca de cadastro, não contagem.
        const identificador = extrairIdentificador(qMin);
        if (identificador) return await responderConsultaIdentificador(identificador);
        const nomeProvavel = extrairNomeProvavel(textoOriginal, qMin);
        if (nomeProvavel) return await responderConsultaIdentificador({ tipo: 'nome', valor: nomeProvavel });

        if (ehPrevisao(qMin)) return await responderPrevisao(q, qMin);
        // Checado ANTES de ehCriticidade — "cartão programa" é um pedido bem
        // mais específico (cronograma completo por RP/guarnição) do que só
        // "bairros/horários críticos"; não faz sentido cair no genérico.
        if (ehCartaoPrograma(qMin)) return await responderCartaoPrograma(q, qMin);
        if (ehCriticidade(qMin)) return await responderCriticidade(q);
        if (ehAtendenteCopom(qMin)) return await responderAtendenteCopom(q, qMin);
        if (ehComarcaArquivamentos(qMin)) return await responderComarcaArquivamentos(detectarPeriodo(qMin), extrairMotivoArquivamento(qMin));
        // Checado ANTES do ehTopOperadorTCO genérico (mais abaixo, dentro do
        // fluxo de categoria) — "militar" + "arquivado/atipicidade" é o
        // cruzamento por guarnição, bem diferente de "quem lavrou o TCO".
        if (ehRankingMilitaresTCO(qMin)) return await responderRankingMilitaresTCO(q, qMin);
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
        • "status dos TCOs este mês" / "movimentação das drogas este ano"<br>
        • "CPF 123.456.789-00" / "boletim 123456" / "processo 0700660-61.2026.8.02.0146" (consulta direta de cadastro)<br>
        • "tipificação mais comum de drogas este mês"<br>
        • "MVI do 1º semestre de 2026 comparado com o mesmo período de 2025 mês a mês"<br>
        • "resumo de hoje" / "resumo de 2026 mês a mês de MVI e CVP"<br><br>
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
        conteudo.innerHTML = html;
        bolha.appendChild(conteudo);

        const acoes = document.createElement('div');
        acoes.style.cssText = `display:flex;justify-content:${doUsuario ? 'flex-end' : 'flex-start'};margin-top:.3rem;`;
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
        } catch (e) {
            console.error('Xerife: erro ao responder', e);
            bolhaCarregando.innerHTML = '⚠️ Deu um problema aqui. Tenta perguntar de novo?';
        }
        document.getElementById('xerife-mensagens').scrollTop = document.getElementById('xerife-mensagens').scrollHeight;
    }

    function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    function alternar() {
        if (!painelMontado) montarPainel();
        painelAberto = !painelAberto;
        document.getElementById('xerife-painel').style.display = painelAberto ? 'flex' : 'none';
        if (painelAberto) setTimeout(() => document.getElementById('xerife-input')?.focus(), 100);
    }

    // Além de `alternar` (abre/fecha o balão flutuante), expõe um punhado de
    // internos pra página dedicada de chat mobile (page/chat-mobile.html) e
    // pro módulo de análise de documentos (js/xerife-documentos.js)
    // reaproveitarem o MESMO motor de perguntas/respostas/IA local, em vez
    // de duplicar essa lógica numa UI separada.
    window.Xerife = {
        alternar,
        enviarPergunta,
        carregarHistorico,
        adicionarMensagem,
        escHtml,
        gerarComIA,
        obterEstadoIA: () => llmEstado,
    };
})();
