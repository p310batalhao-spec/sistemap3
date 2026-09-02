// ====================================================================
// Sistema P3 — Previsão mensal do CAD (CVP/CVLI/MVI) — módulo
// compartilhado
// ====================================================================
// 02/09/2026, pedido explícito do usuário: "quero que faltando 5, 3, 2
// e 1 dia avise que o mês está finalizando e precisa de uma nova
// análise preditiva ou faça isso automaticamente quando abrir o exe
// com os dados do CAD" — escolheu a opção automática.
//
// Extraído de js/preditivaCAD.js (fonte original, ainda a única tela
// que EXIBE isso) pra ser a FONTE ÚNICA da classificação CVP/CVLI/MVI e
// do mecanismo de gravação/idempotência da previsão — usado tanto pela
// tela ao vivo (que continua com seu próprio filtro de período) quanto
// pelo lembrete automático de js/core/notificacoes.js (que roda em
// QUALQUER página, sem a tela do Preditiva CAD precisar estar aberta).
// Duplicar a classificação (que já teve bug real corrigido — ver
// comentário de "LATROCINIO TENTADO" abaixo) em dois arquivos seria
// arriscar os dois divergirem silenciosamente; centralizar aqui evita
// isso — preditivaCAD.js passou a importar isCVP/isCVLI/isMVI e o
// mecanismo de gravação DESTE arquivo em vez de definir os seus.
//
// NÃO depende de nenhum elemento de DOM — pode rodar em qualquer
// página que carregue este script (via js/core/header-nav.js).
// ====================================================================
(function (global) {
    'use strict';
    if (global.PrevisaoMensalCAD) return;

    // Mesmo projeto Apps Script que page/preditivaCAD.html e
    // page/rastreamento-guarnicao.html já usam — mesma sessão/token do
    // CAD, configurados via js/core/cad-login-modal.js.
    const GAS_CAD_URL = 'https://script.google.com/macros/s/AKfycbwuyKpN4AbmV_CmQfZr2olClY1JveArwKEcJE3__DFf74xfnd3AlhXqnde7RPkXDlqx/exec';
    const NO_PREVISOES_FIREBASE = 'preditiva_cad_previsoes';
    const JANELA_MESES_BASELINE_ACURACIA = 3;

    async function fetchCAD(acao, params) {
        const qs = new URLSearchParams(Object.assign({ acao: acao }, params || {})).toString();
        const resp = await fetch(GAS_CAD_URL + '?' + qs, { redirect: 'follow' });
        const texto = await resp.text();
        let data;
        try { data = JSON.parse(texto); }
        catch (e) { throw new Error('Resposta do Apps Script não é JSON válido: ' + texto.substring(0, 200)); }
        return data;
    }

    function normRisco(str) {
        return String(str || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    }

    // ────────────────────────────────────────────────────────────────
    // CLASSIFICAÇÃO CVP/CVLI/MVI — cópia EXATA de js/preditivaCAD.js
    // (mesma regra de js/analisePreditiva.js). Ver histórico de bugs já
    // corrigidos nos comentários originais: subnotificação de óbito (a
    // grade do CAD não tem campo "Óbito" explícito) e "LATROCINIO
    // TENTADO" (tipificação real do CAD que não contém a palavra
    // "TENTATIVA", escapava da checagem de tentativa).
    // ────────────────────────────────────────────────────────────────
    function tipificacaoDe(item) {
        return normRisco((item.TIPIFICACAO_GERAL || '') + ' ' + (item.TIPIFICACAO || ''));
    }
    function ehTipoCVLI(t) {
        return t.includes('HOMICIDIO') || t.includes('FEMINICIDIO') || t.includes('LATROCINIO');
    }
    const REGEX_INDICIO_OBITO = /(óbito|obito|constatado óbito|samu atestou|iml)/i;
    function textoRelatoDe(item) {
        return [item.SOLUCAO, item['SOLUÇÃO'], item.SITUACAO, item.TIPIFICACAO, item.TIPIFICACAO_GERAL]
            .filter(Boolean).join(' ');
    }
    function temIndicioDeObitoNoRelato(item) {
        return REGEX_INDICIO_OBITO.test(textoRelatoDe(item));
    }
    function ehTentativa_(t) {
        return t.includes('TENTATIVA') || t.includes('TENTADO');
    }
    function isMVI(item) {
        const t = tipificacaoDe(item);
        if (t.includes('ACHADO') || t.includes('SUICIDIO') || t.includes('VIOLACAO')) return false;
        if (ehTentativa_(t)) return ehTipoCVLI(t) && temIndicioDeObitoNoRelato(item);
        return ehTipoCVLI(t);
    }
    function isCVLI(item) {
        const t = tipificacaoDe(item);
        if (t.includes('ACHADO') || t.includes('SUICIDIO') || t.includes('VIOLACAO')) return false;
        return ehTipoCVLI(t);
    }
    function isCVP(item) {
        const t = tipificacaoDe(item);
        if (t.includes('APOIO') || t.includes('OUTRAS')) return false;
        if (ehTentativa_(t) && temIndicioDeObitoNoRelato(item)) return false;
        return t.includes('ROUBO') || t.includes('EXTORSAO');
    }

    // ────────────────────────────────────────────────────────────────
    // ENSEMBLE DE PREVISÃO — mesma cópia de js/preditivaCAD.js/
    // js/analisePreditiva.js (regressão linear + média ponderada 60/40,
    // combinado 50/50 com Holt+sazonalidade do MLLeve quando disponível).
    // ────────────────────────────────────────────────────────────────
    function regressaoLinear(arr) {
        const n = arr.length;
        if (n < 2) return arr[0] || 0;
        let sx = 0, sy = 0, sxy = 0, sx2 = 0;
        arr.forEach(function (v, i) { sx += i; sy += v; sxy += i * v; sx2 += i * i; });
        const denom = n * sx2 - sx * sx;
        const m = denom ? (n * sxy - sx * sy) / denom : 0;
        const b = (sy - m * sx) / n;
        return Math.round(Math.max(0, m * n + b));
    }
    function mediaPonderada(arr) {
        const ult = arr.slice(-3);
        if (!ult.length) return 0;
        const pesos = [1, 2, 3].slice(3 - ult.length);
        const soma = ult.reduce(function (a, v, i) { return a + v * pesos[i]; }, 0);
        return Math.round(soma / pesos.reduce(function (a, v) { return a + v; }, 0));
    }
    function preverSimples(arr) {
        return Math.round(mediaPonderada(arr) * 0.6 + regressaoLinear(arr) * 0.4);
    }
    function preverComEnsemble(arr) {
        const previsaoAtual = preverSimples(arr);
        if (!global.MLLeve || arr.length < 2) return previsaoAtual;
        const hw = global.MLLeve.preverComSazonalidade(arr, { passos: 1 });
        if (!hw || !hw.previsoes.length) return previsaoAtual;
        return Math.round(previsaoAtual * 0.5 + hw.previsoes[0] * 0.5);
    }

    // ────────────────────────────────────────────────────────────────
    // DATAS / SÉRIE MENSAL — mesma cópia de js/preditivaCAD.js.
    // ────────────────────────────────────────────────────────────────
    function parseDataBR(str) {
        if (!str) return null;
        const s = String(str).trim();
        let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
        m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
        return null;
    }
    function chaveMes(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
    function proximaChaveMes(chave) {
        const p = chave.split('-');
        const d = new Date(+p[0], +p[1] - 1 + 1, 1);
        return chaveMes(d);
    }
    function serieMensalCompleta(lista, dataIniStr, dataFimStr) {
        const porMes = new Map();
        lista.forEach(function (it) {
            const d = parseDataBR(it.DATA);
            if (!d) return;
            const k = chaveMes(d);
            porMes.set(k, (porMes.get(k) || 0) + 1);
        });
        const pIni = String(dataIniStr || '').split('-');
        const pFim = String(dataFimStr || '').split('-');
        if (pIni.length < 2 || pFim.length < 2) return { chaves: [], valores: [] };
        const cursor = new Date(+pIni[0], +pIni[1] - 1, 1);
        const fim = new Date(+pFim[0], +pFim[1] - 1, 1);
        const chaves = [], valores = [];
        while (cursor <= fim) {
            const k = chaveMes(cursor);
            chaves.push(k);
            valores.push(porMes.get(k) || 0);
            cursor.setMonth(cursor.getMonth() + 1);
        }
        return { chaves: chaves, valores: valores };
    }
    function chaveLocalNormalizada(it) {
        return normRisco(it.CIDADE || 'N/D') + '||' + normRisco(it.BAIRRO || 'N/D');
    }
    function agruparPorMes(todos) {
        const porMes = new Map();
        todos.forEach(function (it) {
            const d = parseDataBR(it.DATA);
            if (!d) return;
            const k = chaveMes(d);
            if (!porMes.has(k)) porMes.set(k, []);
            porMes.get(k).push(it);
        });
        return porMes;
    }
    function identificarZonasRisco(itens) {
        const contPorLocal = new Map();
        itens.forEach(function (it) {
            const chave = chaveLocalNormalizada(it);
            contPorLocal.set(chave, (contPorLocal.get(chave) || 0) + 1);
        });
        const total = itens.length;
        const zonas = new Set();
        contPorLocal.forEach(function (cnt, chave) {
            if (total && (cnt / total) * 100 >= 8) zonas.add(chave);
        });
        return zonas;
    }

    // Busca ocorrências já classificadas (endpoint rápido do Apps
    // Script) e aplica isCVP/isCVLI/isMVI — mesma etapa que
    // js/preditivaCAD.js:carregarDadosCAD faz pro caminho "rápido".
    async function buscarEClassificar(dataIni, dataFim) {
        const resp = await fetchCAD('ocorrencias_classificadas', { dataIni: dataIni, dataFim: dataFim });
        if (!resp || resp.ok === false) {
            throw new Error((resp && resp.erro) || 'Falha ao consultar o CAD — login/token pode estar expirado ou não configurado.');
        }
        const cvpBruto = resp.cvp || [];
        const cvliMviBruto = resp.cvliMvi || [];
        return {
            arrCVP: cvpBruto.filter(isCVP),
            arrCVLI: cvliMviBruto.filter(isCVLI),
            arrMVI: cvliMviBruto.filter(isMVI),
        };
    }

    // Cálculo puro (sem rede) — mesma lógica de
    // js/preditivaCAD.js:computarPrevisaoProximoMes_.
    function computarPrevisaoProximoMes(arrCVP, arrCVLI, arrMVI, dataIniStr, dataFimStr) {
        const sCVP = serieMensalCompleta(arrCVP, dataIniStr, dataFimStr);
        const sCVLI = serieMensalCompleta(arrCVLI, dataIniStr, dataFimStr);
        const sMVI = serieMensalCompleta(arrMVI, dataIniStr, dataFimStr);
        if (!sCVP.chaves.length) return null;

        const chaveAtual = sCVP.chaves[sCVP.chaves.length - 1];
        const mesAlvo = proximaChaveMes(chaveAtual);

        const todos = arrCVP.concat(arrCVLI, arrMVI);
        const porMes = agruparPorMes(todos);
        const chaves = Array.from(porMes.keys()).sort();
        const mesesBaseline = chaves.slice(-JANELA_MESES_BASELINE_ACURACIA);
        const itensBaseline = [];
        mesesBaseline.forEach(function (k) { itensBaseline.push.apply(itensBaseline, porMes.get(k)); });
        if (!itensBaseline.length) return null;

        return {
            mesAlvo: mesAlvo, criadoComDadosAte: chaveAtual,
            previsaoMensal: {
                cvp: preverComEnsemble(sCVP.valores), cvli: preverComEnsemble(sCVLI.valores), mvi: preverComEnsemble(sMVI.valores),
            },
            zonasRisco: Array.from(identificarZonasRisco(itensBaseline)),
            mesesBaseline: mesesBaseline, totalBaseline: itensBaseline.length,
        };
    }

    async function buscarPrevisaoRegistrada(firebaseUrl, chaveMesAlvo) {
        try {
            const resp = await fetch(firebaseUrl + '/' + NO_PREVISOES_FIREBASE + '/' + chaveMesAlvo + '.json');
            return resp.ok ? await resp.json() : null;
        } catch (e) {
            return null;
        }
    }

    async function salvarPrevisao(firebaseUrl, previsao) {
        const registro = Object.assign({ criadoEm: new Date().toISOString() }, previsao);
        const resp = await fetch(firebaseUrl + '/' + NO_PREVISOES_FIREBASE + '/' + previsao.mesAlvo + '.json', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(registro),
        });
        if (!resp.ok) throw new Error('Falha ao gravar no Firebase (HTTP ' + resp.status + ')');
        return registro;
    }

    // ════════════════════════════════════════════════════════════════
    // ALTO NÍVEL — busca no CAD, calcula e grava (se ainda não existir)
    // a previsão pro mês SEGUINTE ao último mês presente no período
    // buscado. Idempotente (nunca sobrescreve uma previsão já gravada
    // pro mesmo mês-alvo). opts.dataIni/opts.dataFim: quando quem chama
    // já tem um período escolhido (ex.: a tela ao vivo, com o filtro do
    // usuário); sem eles, usa os ÚLTIMOS 12 MESES até hoje — usado pelo
    // lembrete automático (js/core/notificacoes.js), que roda sem
    // nenhuma tela aberta pra ler um filtro de data.
    //
    // Rodar isso ANTES do mês virar (ver o lembrete automático, que
    // dispara faltando 5/3/2/1 dia(s)) já resolve sozinho o problema de
    // "previsão contaminada": nesses dias, hoje AINDA está dentro do mês
    // corrente, então chaveAtual = mês corrente e mesAlvo = mês seguinte,
    // sem precisar de nenhum truque manual de data.
    //
    // Devolve {status: 'gravada'|'ja_existia'|'sem_dados', ...previsao}.
    // ════════════════════════════════════════════════════════════════
    async function registrarPrevisaoProximoMesSeNecessario(firebaseUrl, opts) {
        opts = opts || {};
        const hoje = new Date();
        const dataFim = opts.dataFim || (hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0') + '-' + String(hoje.getDate()).padStart(2, '0'));
        const iniPadrao = new Date(hoje.getFullYear(), hoje.getMonth() - 11, 1);
        const dataIni = opts.dataIni || (iniPadrao.getFullYear() + '-' + String(iniPadrao.getMonth() + 1).padStart(2, '0') + '-01');

        const { arrCVP, arrCVLI, arrMVI } = await buscarEClassificar(dataIni, dataFim);
        const previsao = computarPrevisaoProximoMes(arrCVP, arrCVLI, arrMVI, dataIni, dataFim);
        if (!previsao) return { status: 'sem_dados' };

        const jaExiste = await buscarPrevisaoRegistrada(firebaseUrl, previsao.mesAlvo);
        if (jaExiste) return Object.assign({ status: 'ja_existia' }, jaExiste);

        const registro = await salvarPrevisao(firebaseUrl, previsao);
        return Object.assign({ status: 'gravada' }, registro);
    }

    global.PrevisaoMensalCAD = {
        fetchCAD: fetchCAD,
        normRisco: normRisco,
        isCVP: isCVP, isCVLI: isCVLI, isMVI: isMVI,
        preverComEnsemble: preverComEnsemble,
        parseDataBR: parseDataBR, chaveMes: chaveMes, proximaChaveMes: proximaChaveMes,
        serieMensalCompleta: serieMensalCompleta,
        chaveLocalNormalizada: chaveLocalNormalizada, agruparPorMes: agruparPorMes, identificarZonasRisco: identificarZonasRisco,
        buscarEClassificar: buscarEClassificar,
        computarPrevisaoProximoMes: computarPrevisaoProximoMes,
        buscarPrevisaoRegistrada: buscarPrevisaoRegistrada,
        salvarPrevisao: salvarPrevisao,
        registrarPrevisaoProximoMesSeNecessario: registrarPrevisaoProximoMesSeNecessario,
    };
})(window);
