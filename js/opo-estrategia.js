// ════════════════════════════════════════════════════════════════════
// OPO INTELIGENTE — ESTRATÉGIA POR TIPO DE COMBATE
// ════════════════════════════════════════════════════════════════════
// Pedido do usuário: escolher os crimes a combater (MVI, CVLI, CVP,
// Perturbação do Sossego, Violência Doméstica, Armas, Drogas) e obter a
// melhor estratégia REPRESSIVA e PREVENTIVA, sempre com base em análise
// preditiva, usando o PYTHON para os cálculos e o agente XERIFE para redigir.
//
//  1. Coleta (navegador): ocorrências de cada tipo, na cidade/área e no
//     período da análise da OPO (mesmos filtros da tela).
//  2. Cálculo: POST /opo/estrategia no atualizador local (Python —
//     tools/atualizador-local/opo_estrategia.py). Sem o atualizador (ou num
//     .exe antigo sem essa rota), o MESMO algoritmo roda aqui (calcularLocal).
//  3. Parecer: XERIFE (js/xerife.js → Xerife.gerarComIA, IA local) redige a
//     estratégia SÓ com os números calculados. Com a IA local indisponível,
//     o parecer sai pelas regras do XERIFE (texto montado deterministicamente).
//  4. Entrega: painel na tela + seção na OPO (tela e Word) + tipos salvos na OPO.
// ════════════════════════════════════════════════════════════════════
(function (global) {
    'use strict';

    const TIPOS = [
        { id: 'MVI', nome: 'MVI', cor: '#b71c1c', padrao: true },
        { id: 'CVLI', nome: 'CVLI', cor: '#6a1b9a', padrao: true },
        { id: 'CVP', nome: 'CVP', cor: '#e65100', padrao: true },
        { id: 'PERTURBACAO', nome: 'Perturbação do Sossego', cor: '#00695c' },
        { id: 'VD', nome: 'Violência Doméstica', cor: '#ad1457' },
        { id: 'ARMAS', nome: 'Armas', cor: '#2e7d32' },
        { id: 'DROGAS', nome: 'Drogas', cor: '#f57f17' },
    ];
    const BASE_MINIMA_DIAS = 90;
    const NOME = Object.fromEntries(TIPOS.map(t => [t.id, t.nome]));
    const COR = Object.fromEntries(TIPOS.map(t => [t.id, t.cor]));

    let resultado = null;     // último cálculo { ...retorno do Python/local, parecer, motorParecer, escopo }
    const cacheNos = {};

    const NORM = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
    const UP = s => String(s || '').trim().toUpperCase(); // = str().strip().upper() do Python
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const fmt = n => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

    function parseData(v) {
        const s = String(v || '').trim().slice(0, 10);
        let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
        m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
        return null;
    }
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    // ── Coleta ──────────────────────────────────────────────────────
    async function dbUrl() {
        if (typeof DATABASE_URL !== 'undefined' && DATABASE_URL) return DATABASE_URL; // global da OPO Inteligente
        return (await P3.loadUnidadeConfig()).firebase.databaseURL;
    }
    async function no(nome) {
        if (cacheNos[nome]) return cacheNos[nome];
        if (nome === 'geral' && typeof cacheOcorrencias !== 'undefined' && Array.isArray(cacheOcorrencias)) return (cacheNos.geral = cacheOcorrencias);
        const d = await fetch(`${await dbUrl()}/${nome}.json`).then(r => r.ok ? r.json() : null).catch(() => null);
        return (cacheNos[nome] = d ? Object.values(d).filter(Boolean) : []);
    }
    function tipGeral(oc) { return NORM(`${oc.TIPIFICACAO_GERAL || ''} ${oc.TIPIFICACAO || ''} ${oc['TIPIFICAÇÃO'] || ''}`); }
    // Mesmas regras do resto do sistema (js/dashboard-cruzado.js / js/index.js).
    function ehMVI(oc) {
        const t = tipGeral(oc);
        if (!(t.includes('HOMICIDIO') || t.includes('FEMINICIDIO') || t.includes('LATROCINIO'))) return false;
        return t.includes('TENTATIVA') ? NORM(oc.OBITO) === 'S' : true;
    }
    function ehCVLI(oc) { const t = tipGeral(oc); return t.includes('HOMICIDIO') || t.includes('FEMINI') || t.includes('LATROCINIO'); }
    function ehCVP(oc) {
        if (typeof classificarCrimeGeral === 'function') return classificarCrimeGeral(oc) === 'CVP';
        const t = tipGeral(oc); return t.includes('ROUBO') || t.includes('EXTORS');
    }

    function escopoAtualOPO() {
        const periodoTela = parseInt(document.getElementById('sel-periodo')?.value || '90', 10) || 90;
        // Base histórica mínima de 90 dias: a tendência compara os últimos 30
        // dias com os 30 anteriores e o Holt precisa de semanas suficientes —
        // com a análise da tela em 7/15/30 dias a previsão sairia sem base.
        const periodo = Math.max(periodoTela, BASE_MINIMA_DIAS);
        const ehBpm = (typeof escopoAtual !== 'undefined' && escopoAtual === 'bpm');
        const cidade = ehBpm ? '' : (document.getElementById('sel-cidade')?.value || '');
        return { periodo, cidade, cidadeNorm: NORM(cidade), rotulo: ehBpm ? '10º BPM — área completa' : (cidade || 'área selecionada') };
    }

    async function coletar(tipos, esc0) {
        const fim = new Date(); fim.setHours(23, 59, 59, 999);
        const ini = new Date(fim); ini.setDate(ini.getDate() - esc0.periodo + 1); ini.setHours(0, 0, 0, 0);
        const fontes = {
            MVI: ['geral', ehMVI], CVLI: ['geral', ehCVLI], CVP: ['geral', ehCVP],
            PERTURBACAO: ['sossego', oc => tipGeral(oc).includes('PERTURBACAO') && !tipGeral(oc).includes('VISITA')],
            VD: ['violencia_domestica', oc => !tipGeral(oc).includes('VISITA')],
            ARMAS: ['arma', () => true], DROGAS: ['droga', () => true],
        };
        const lista = [];
        for (const tipo of tipos) {
            const [nome, filtro] = fontes[tipo];
            for (const oc of await no(nome)) {
                const d = parseData(oc.DATA || oc.data);
                if (!d || d < ini || d > fim) continue;
                if (esc0.cidadeNorm && NORM(oc.CIDADE || oc.cidade) !== esc0.cidadeNorm) continue;
                if (!filtro(oc)) continue;
                const lat = parseFloat(String(oc.LATITUDE || oc.latitude || '').replace(',', '.'));
                const lng = parseFloat(String(oc.LONGITUDE || oc.longitude || '').replace(',', '.'));
                lista.push({
                    tipo, data: iso(d), hora: String(oc.HORA || oc.hora || ''),
                    cidade: String(oc.CIDADE || oc.cidade || ''), bairro: String(oc.BAIRRO || oc.bairro || ''),
                    lat: isNaN(lat) ? null : lat, lng: isNaN(lng) ? null : lng, peso: 1,
                });
            }
        }
        return { ocorrencias: lista, referencia: iso(fim) };
    }

    // ── Cálculo: Python (atualizador local) com fallback idêntico em JS ──
    async function calcularPython(payload) {
        const base = (global.P3AtualizadorLocal && P3AtualizadorLocal.URL_BASE) || 'http://localhost:5057';
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
        try {
            const r = await fetch(`${base}/opo/estrategia`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: ctl.signal });
            if (!r.ok) return null;
            const j = await r.json();
            return j && j.ok ? j : null;
        } catch (e) { return null; } finally { clearTimeout(t); }
    }

    // Porta FIEL de tools/atualizador-local/opo_estrategia.py — mudar os dois juntos.
    const GRAV = { MVI: 5, CVLI: 5, ARMAS: 4, DROGAS: 4, VD: 4, CVP: 3, PERTURBACAO: 2 };
    const DIAS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
    const FAIXAS = ['00h–04h', '04h–08h', '08h–12h', '12h–16h', '16h–20h', '20h–24h'];
    const PLAYBOOK = {
        MVI: [['Operação de saturação com abordagens qualificadas em {local}, na janela {janela}', 'Cumprimento prioritário de mandados de prisão e busca de alvos ligados a crimes contra a vida', 'Bloqueios e barreiras policiais nas rotas de fuga do entorno de {local}'],
              ['Ponto-base ostensivo em {local} na janela {janela}', 'Patrulhamento a pé em áreas de aglomeração e saída de festas/bares', 'Articulação com a inteligência (P2) para monitorar conflitos entre grupos']],
        CVLI: [['Saturação e abordagem a pessoas e veículos em {local} ({janela})', 'Busca de armas de fogo com apoio do tático', 'Cumprimento de mandados contra autores reincidentes'],
               ['Presença ostensiva fixa em {local} na janela {janela}', 'Rondas em pontos de lazer noturno e vias de acesso', 'Integração com a rede de proteção nos casos de conflito familiar']],
        CVP: [['Blitz e abordagens a motocicletas e pedestres suspeitos em {local} ({janela})', 'Operação contra receptação (feiras, oficinas, lojas de celulares)', 'Recaptura de foragidos e cumprimento de mandados de roubo'],
              ['Policiamento ostensivo em corredores comerciais e pontos de ônibus de {local} na janela {janela}', 'Orientação a comerciantes e visibilidade da viatura com giroflex ligado', 'Ponto-base em horário de abertura/fechamento do comércio']],
        PERTURBACAO: [['Fiscalização de bares e paredões de som em {local} ({janela}), com apreensão de equipamentos', 'Ação integrada com Prefeitura/Vigilância (alvarás e horário de funcionamento)'],
                      ['Visitas orientativas aos estabelecimentos reincidentes de {local}', 'Rondas preventivas nas noites de {janela}']],
        VD: [['Fiscalização do cumprimento de medidas protetivas (botão do pânico / Patrulha Maria da Penha)', 'Prioridade de resposta a acionamentos em {local} na janela {janela}', 'Cumprimento de mandados contra agressores com medida descumprida'],
             ['Visitas da Patrulha Maria da Penha às assistidas de maior risco', 'Palestras e orientação em escolas, CRAS e unidades de saúde de {local}', 'Articulação com a rede de proteção (CREAS, Conselho Tutelar, Delegacia)']],
        ARMAS: [['Operação de busca e apreensão de armas em {local} ({janela})', 'Abordagens qualificadas com detector/varredura em veículos e motocicletas', 'Cumprimento de mandados de busca com apoio da inteligência'],
                ['Barreiras ostensivas nas entradas e saídas de {local}', 'Fiscalização de eventos e estabelecimentos noturnos na janela {janela}']],
        DROGAS: [['Operação de combate ao tráfico em {local} ({janela}) com apoio do tático e da inteligência', 'Abordagens em pontos de venda conhecidos e cumprimento de mandados de busca', 'Barreiras para interceptar o abastecimento nas rotas de acesso'],
                 ['Ocupação ostensiva dos pontos de venda de {local} na janela {janela}', 'Ações de prevenção (PROERD) em escolas da área', 'Visitas orientativas e integração com a rede socioassistencial']],
    };
    function holt(serie, a = 0.5, b = 0.3) {
        if (!serie.length) return [0, 0];
        let nivel = serie[0], tend = serie.length > 1 ? serie[1] - serie[0] : 0;
        for (const x of serie.slice(1)) { const ant = nivel; nivel = a * x + (1 - a) * (nivel + tend); tend = b * (nivel - ant) + (1 - b) * tend; }
        return [nivel, tend];
    }
    function calcularLocal(payload) {
        const ref = parseData(payload.referencia) || new Date();
        const dias = (a, b) => Math.round((a - b) / 86400000);
        const resumos = payload.tipos.map(tipo => {
            const datas = payload.ocorrencias.filter(o => o.tipo === tipo).map(o => [o, parseData(o.data)])
                .filter(([, d]) => d && dias(ref, d) >= 0 && dias(ref, d) < payload.periodoDias);
            const ult30 = datas.filter(([, d]) => dias(ref, d) < 30).length;
            const ant30 = datas.filter(([, d]) => dias(ref, d) >= 30 && dias(ref, d) < 60).length;
            const tendencia = ant30 ? (ult30 - ant30) / ant30 * 100 : (ult30 ? 100 : 0);
            const semanas = Math.max(1, Math.ceil(payload.periodoDias / 7));
            const serie = new Array(semanas).fill(0);
            datas.forEach(([, d]) => { const i = semanas - 1 - Math.floor(dias(ref, d) / 7); if (i >= 0 && i < semanas) serie[i]++; });
            const [nv, td] = holt(serie);
            const proxSemana = Math.max(0, nv + td);
            const ds = new Array(7).fill(0), fx = new Array(6).fill(0), matriz = {};
            datas.forEach(([o, d]) => {
                const wd = (d.getDay() + 6) % 7; ds[wd]++;
                const h = parseInt(String(o.hora).split(':')[0], 10);
                if (!isNaN(h) && h >= 0 && h <= 23) { fx[Math.floor(h / 4)]++; const k = wd + '|' + Math.floor(h / 4); matriz[k] = (matriz[k] || 0) + 1; }
            });
            const janelas = Object.entries(matriz).sort((a, b) => b[1] - a[1]).slice(0, 3)
                .map(([k, n]) => { const [w, f] = k.split('|').map(Number); return { dia: DIAS[w], faixa: FAIXAS[f], n }; });
            const cel = {};
            datas.forEach(([o, d]) => {
                if (o.lat == null || o.lng == null || !(o.lat > -11 && o.lat < -7 && o.lng > -39 && o.lng < -34)) return;
                const k = Math.round(o.lat / 0.003) + '|' + Math.round(o.lng / 0.003);
                const c = cel[k] || (cel[k] = { risco: 0, n: 0, lat: 0, lng: 0, b: {}, c: {}, ultima: null });
                c.risco += (o.peso || 1) * Math.exp(-dias(ref, d) / 30); c.n++; c.lat += o.lat; c.lng += o.lng;
                const b = UP(o.bairro); if (b) c.b[b] = (c.b[b] || 0) + 1;
                const cc = UP(o.cidade); if (cc) c.c[cc] = (c.c[cc] || 0) + 1;
                if (!c.ultima || d > c.ultima) c.ultima = d;
            });
            const moda = obj => Object.entries(obj).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
            const hotspots = Object.values(cel).sort((a, b) => b.risco - a.risco).slice(0, 5).map(c => ({
                lat: +(c.lat / c.n).toFixed(6), lng: +(c.lng / c.n).toFixed(6), n: c.n, risco: +c.risco.toFixed(2),
                bairro: moda(c.b), cidade: moda(c.c), ultima: c.ultima ? c.ultima.toLocaleDateString('pt-BR') : '',
            }));
            const bc = {};
            datas.forEach(([o]) => { const b = UP(o.bairro); if (b && b !== '---') { const k = b + '|' + UP(o.cidade); bc[k] = (bc[k] || 0) + 1; } });
            const bairros = Object.entries(bc).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => { const [bairro, cidade] = k.split('|'); return { bairro, cidade, n }; });
            const previsao30 = +(proxSemana * 30 / 7).toFixed(1);
            const prioridade = (GRAV[tipo] || 2) * Math.log1p(previsao30) * (1 + Math.max(0, tendencia) / 100);
            const local = hotspots[0] ? (hotspots[0].bairro || hotspots[0].cidade) : (bairros[0] ? bairros[0].bairro : 'área de maior incidência');
            const janela = janelas[0] ? `${janelas[0].dia}, ${janelas[0].faixa}` : 'horários de maior incidência';
            const [rep, prev] = PLAYBOOK[tipo] || [[], []];
            const preenche = t => t.replace('{local}', local).replace('{janela}', janela);
            return {
                tipo, nome: NOME[tipo], total: datas.length, ultimos30: ult30, anteriores30: ant30, tendenciaPct: +tendencia.toFixed(1),
                previsao7: +proxSemana.toFixed(1), previsao30, metodo: 'Holt (semanal) + índice diário',
                diasSemana: Object.fromEntries(DIAS.map((d, i) => [d, ds[i]])), faixas: Object.fromEntries(FAIXAS.map((f, i) => [f, fx[i]])),
                janelasCriticas: janelas, hotspots, bairros, prioridadeScore: +prioridade.toFixed(2),
                repressiva: rep.map(preenche), preventiva: prev.map(preenche),
            };
        }).sort((a, b) => b.prioridadeScore - a.prioridadeScore);
        const soma = resumos.reduce((s, r) => s + r.prioridadeScore, 0) || 1;
        const ef = Math.max(1, payload.guarnicoesDisponiveis || 6);
        resumos.forEach((r, i) => {
            r.ordem = i + 1;
            r.participacaoPct = +(r.prioridadeScore / soma * 100).toFixed(1);
            r.guarnicoesSugeridas = Math.max(r.total ? 1 : 0, Math.round(ef * r.prioridadeScore / soma));
            r.enfase = (r.tendenciaPct > 10 || ((GRAV[r.tipo] || 2) >= 4 && r.ultimos30 > 0)) ? 'REPRESSIVA' : 'PREVENTIVA';
        });
        return { ok: true, motor: 'navegador', referencia: ref.toLocaleDateString('pt-BR'), periodoDias: payload.periodoDias,
            tipos: resumos, totalOcorrencias: resumos.reduce((s, r) => s + r.total, 0), geradoEm: new Date().toLocaleString('pt-BR').slice(0, 16) };
    }

    // ── XERIFE ──────────────────────────────────────────────────────
    function garantirXerife() {
        if (global.Xerife) return Promise.resolve(global.Xerife);
        return new Promise(ok => {
            if (!document.querySelector('script[data-opo-xerife]')) {
                const s = document.createElement('script');
                s.src = (/\/(page|relatorios|public|termos)\//.test(location.pathname) ? '../' : '') + 'js/xerife.js';
                s.dataset.opoXerife = '1';
                document.body.appendChild(s);
            }
            let n = 0;
            const t = setInterval(() => { if (global.Xerife || ++n > 50) { clearInterval(t); ok(global.Xerife || null); } }, 200);
        });
    }

    const PROMPT = 'Você é o XERIFE, assessor de planejamento operacional do 10º Batalhão de Polícia Militar de Alagoas. ' +
        'Redija, em português do Brasil, um parecer de estratégia para uma Ordem de Policiamento Ostensivo (OPO), com tom técnico-militar, objetivo, sem emojis. ' +
        'Estruture em: 1) Situação (síntese da análise preditiva); 2) Prioridades de combate (na ordem dada); 3) Linha de ação repressiva; 4) Linha de ação preventiva; 5) Emprego do efetivo. ' +
        'Use SOMENTE os números, locais, dias e horários presentes no JSON — nunca invente dados, locais ou percentuais. Não mencione "JSON". Máximo de 350 palavras.';

    function parecerRegras(R, esc0) {
        const linhas = [];
        const ativos = R.tipos.filter(t => t.total > 0);
        linhas.push(`<p><strong>1) Situação.</strong> Nos últimos ${R.periodoDias} dias (${esc(esc0.rotulo)}), foram analisadas ${fmt(R.totalOcorrencias)} ocorrência(s) dos tipos selecionados. ` +
            (ativos.length ? `A projeção para os próximos 30 dias é de ${ativos.map(t => `${fmt(t.previsao30)} de ${t.nome}`).join(', ')}.` : 'Não houve registros no período para os tipos selecionados.') + '</p>');
        if (ativos.length) {
            linhas.push(`<p><strong>2) Prioridades.</strong> ${ativos.map(t => `${t.ordem}º ${t.nome} (${t.tendenciaPct ? `${t.tendenciaPct > 0 ? 'alta' : 'queda'} de ${fmt(Math.abs(t.tendenciaPct))}%` : 'estável'} nos últimos 30 dias; ênfase ${t.enfase.toLowerCase()})`).join('; ')}.</p>`);
            const rep = ativos.filter(t => t.enfase === 'REPRESSIVA').slice(0, 3);
            const prv = ativos.slice(0, 3);
            linhas.push(`<p><strong>3) Linha de ação repressiva.</strong> ${rep.length ? rep.map(t => `${t.nome}: ${t.repressiva[0]}.`).join(' ') : 'Sem indicação de ação repressiva prioritária no período.'}</p>`);
            linhas.push(`<p><strong>4) Linha de ação preventiva.</strong> ${prv.map(t => `${t.nome}: ${t.preventiva[0]}.`).join(' ')}</p>`);
            linhas.push(`<p><strong>5) Emprego do efetivo.</strong> ${ativos.filter(t => t.guarnicoesSugeridas).map(t => `${t.guarnicoesSugeridas} guarnição(ões) para ${t.nome}`).join(', ')}, concentradas nas janelas críticas indicadas.</p>`);
        }
        return linhas.join('');
    }

    async function redigirParecer(R, esc0) {
        const X = await garantirXerife();
        if (X && X.gerarComIA && X.obterEstadoIA && X.obterEstadoIA() === 'pronto') {
            const dados = { area: esc0.rotulo, periodoDias: R.periodoDias, tipos: R.tipos.map(t => ({
                crime: t.nome, prioridade: t.ordem, ocorrenciasNoPeriodo: t.total, ultimos30dias: t.ultimos30, trintaDiasAnteriores: t.anteriores30,
                tendenciaPercentual: t.tendenciaPct, previsaoProximos30dias: t.previsao30, enfase: t.enfase,
                janelasCriticas: t.janelasCriticas, locaisDeMaiorRisco: t.hotspots.slice(0, 3).map(h => h.bairro || h.cidade).filter(Boolean),
                guarnicoesSugeridas: t.guarnicoesSugeridas, acoesRepressivas: t.repressiva, acoesPreventivas: t.preventiva })) };
            const txt = await X.gerarComIA([{ role: 'system', content: PROMPT }, { role: 'user', content: JSON.stringify(dados) }], { temperature: 0.25, max_tokens: 700 });
            if (txt) return { html: txt.split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>`).join(''), motor: 'XERIFE — IA local' };
        }
        const motivo = !X ? 'XERIFE indisponível' : (X.obterEstadoIA ? ({ baixando: 'IA local ainda carregando', indisponivel: 'computador sem suporte a IA local (WebGPU)', erro: 'IA local com erro' }[X.obterEstadoIA()] || 'IA local não pronta') : 'IA local não pronta');
        return { html: parecerRegras(R, esc0), motor: `XERIFE — regras (${motivo})` };
    }

    // ── Fluxo principal ─────────────────────────────────────────────
    function selecionados() { return [...document.querySelectorAll('#opo-est-tipos input:checked')].map(i => i.value); }

    async function gerar() {
        const tipos = selecionados();
        if (!tipos.length) { alert('Selecione ao menos um tipo de combate.'); return; }
        const btn = document.getElementById('opo-est-btn'), out = document.getElementById('opo-est-resultado');
        const esc0 = escopoAtualOPO();
        if (typeof escopoAtual !== 'undefined' && escopoAtual === 'cidade' && !esc0.cidade) { alert('Selecione a cidade da análise.'); return; }
        btn.disabled = true;
        const passo = t => { btn.textContent = t; };
        try {
            passo('⏳ Coletando ocorrências…');
            const { ocorrencias, referencia } = await coletar(tipos, esc0);
            const payload = { tipos, periodoDias: esc0.periodo, referencia, ocorrencias, guarnicoesDisponiveis: guarnicoesDisponiveis() };
            passo('🐍 Calculando (Python)…');
            let R = await calcularPython(payload);
            if (!R) { passo('⏳ Calculando no navegador…'); R = calcularLocal(payload); }
            passo('🤠 XERIFE redigindo a estratégia…');
            const parecer = await redigirParecer(R, esc0);
            resultado = Object.assign(R, { parecer: parecer.html, motorParecer: parecer.motor, escopo: esc0, tiposSelecionados: tipos });
            render(out, resultado);
        } catch (e) {
            console.error('[opo-estrategia]', e);
            out.innerHTML = `<div style="color:#ff8a80;font-size:12px;">Não foi possível gerar a estratégia: ${esc(e.message)}</div>`;
        } finally {
            btn.disabled = false; btn.textContent = '🎯 GERAR ESTRATÉGIA (XERIFE + PYTHON)';
        }
    }

    // Guarnições da alocação sugerida da OPO (se houver), senão 6.
    function guarnicoesDisponiveis() {
        try {
            if (typeof dadosAnalise !== 'undefined' && dadosAnalise && typeof calcularEfetivoOPO === 'function') {
                const ef = calcularEfetivoOPO(dadosAnalise.hotspots || []);
                const n = ef.opms.filter(o => o.vtr).length;
                if (n) return n;
            }
        } catch (e) { /* usa o padrão */ }
        return 6;
    }

    // Mesmo bairro em células vizinhas da grade → uma entrada só (soma).
    function locaisAgrupados(hotspots) {
        const m = new Map();
        hotspots.forEach(h => { const l = h.bairro || h.cidade || 'sem bairro'; m.set(l, (m.get(l) || 0) + h.n); });
        return [...m.entries()].slice(0, 3);
    }

    function render(out, R) {
        const motorCalc = R.motor === 'python' ? '🐍 Python (atualizador local)' : '🌐 navegador (atualizador local indisponível)';
        out.innerHTML = `
            <div class="opo-est-meta">Cálculo: ${motorCalc} · Parecer: ${esc(R.motorParecer)} · ${esc(R.escopo.rotulo)}, últimos ${R.periodoDias} dias</div>
            ${R.tipos.map(t => `
            <div class="opo-est-card" style="border-left-color:${COR[t.tipo] || '#888'};">
                <div class="opo-est-topo"><strong>${t.ordem}º ${esc(t.nome)}</strong>
                    <span class="opo-est-badge ${t.enfase === 'REPRESSIVA' ? 'rep' : 'prev'}">${t.enfase}</span></div>
                <div class="opo-est-nums">
                    <span><b>${fmt(t.total)}</b> no período</span>
                    <span><b>${t.tendenciaPct > 0 ? '▲' : t.tendenciaPct < 0 ? '▼' : '='} ${fmt(Math.abs(t.tendenciaPct))}%</b> 30d</span>
                    <span><b>${fmt(t.previsao30)}</b> previstos/30d</span>
                    <span><b>${t.guarnicoesSugeridas}</b> GU</span>
                </div>
                ${t.janelasCriticas[0] ? `<div class="opo-est-linha">⏰ ${t.janelasCriticas.map(j => `${j.dia} ${j.faixa} (${j.n})`).join(' · ')}</div>` : ''}
                ${t.hotspots[0] ? `<div class="opo-est-linha">📍 ${locaisAgrupados(t.hotspots).map(([l, n]) => esc(l) + ` (${n})`).join(' · ')}</div>` : ''}
                <details><summary>Ações</summary>
                    <div class="opo-est-acao"><b>Repressivas</b><ul>${t.repressiva.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>
                    <div class="opo-est-acao"><b>Preventivas</b><ul>${t.preventiva.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>
                </details>
            </div>`).join('')}
            <div class="opo-est-parecer"><div class="opo-est-parecer-tit">🤠 Parecer do XERIFE</div>${R.parecer}</div>
            <div class="opo-est-meta">✔ Esta estratégia entra automaticamente na OPO gerada (tela e Word).</div>`;
    }

    // ── Integração com a OPO (tela / Word / salvar) ─────────────────
    function htmlSecao() {
        const R = resultado; if (!R) return '';
        const linhas = R.tipos.map(t => `<tr>
            <td style="text-align:center;font-weight:bold;">${t.ordem}º</td><td><strong>${esc(t.nome)}</strong></td>
            <td style="text-align:center;">${fmt(t.total)}</td>
            <td style="text-align:center;">${t.tendenciaPct >= 0 ? '+' : ''}${fmt(t.tendenciaPct)}%</td>
            <td style="text-align:center;">${fmt(t.previsao30)}</td>
            <td>${t.janelasCriticas[0] ? esc(`${t.janelasCriticas[0].dia}, ${t.janelasCriticas[0].faixa}`) : '—'}</td>
            <td>${t.hotspots[0] ? esc(t.hotspots[0].bairro || t.hotspots[0].cidade) : '—'}</td>
            <td style="text-align:center;">${t.guarnicoesSugeridas}</td>
            <td style="text-align:center;font-weight:bold;">${t.enfase}</td></tr>`).join('');
        const acoes = R.tipos.filter(t => t.total > 0).map(t => `
            <p class="opo-texto"><strong>${esc(t.nome)}</strong> — <em>Repressiva:</em> ${t.repressiva.map(esc).join('; ')}. <em>Preventiva:</em> ${t.preventiva.map(esc).join('; ')}.</p>`).join('');
        return `
    <div class="opo-secao">2.2 ESTRATÉGIA POR TIPO DE COMBATE — ANÁLISE PREDITIVA</div>
    <p class="opo-texto">Tipos selecionados: <strong>${R.tipos.map(t => esc(t.nome)).join(', ')}</strong>. Previsão para os próximos 30 dias por suavização exponencial (Holt) sobre os últimos ${R.periodoDias} dias; prioridade = gravidade × previsão × tendência.</p>
    <table class="tab-hotspot">
      <thead><tr><th>Prio.</th><th>Crime</th><th>Ocorr.</th><th>Tend. 30d</th><th>Previsão 30d</th><th>Janela crítica</th><th>Local de maior risco</th><th>GU</th><th>Ênfase</th></tr></thead>
      <tbody>${linhas}</tbody>
    </table>
    ${acoes}
    <p class="opo-texto"><strong>Parecer do XERIFE:</strong></p>
    <div class="opo-texto">${R.parecer}</div>`;
    }

    // Para o Word (docx): recebe os helpers do baixarDocx (sec, par, cel, lin, …).
    function docxBlocos(h) {
        const R = resultado; if (!R) return [];
        const { sec, par, cel, lin, Table, WidthType, AlignmentType, shH, LT, espaco } = h;
        const pct = [0.07, 0.17, 0.08, 0.1, 0.1, 0.17, 0.17, 0.06];
        const cw = pct.map(p => Math.floor(LT * p)); cw.push(LT - cw.reduce((s, x) => s + x, 0));
        const W = i => ({ size: cw[i], type: WidthType.DXA });
        const tab = new Table({
            width: { size: LT, type: WidthType.DXA }, columnWidths: cw,
            rows: [
                lin(['Prio.', 'Crime', 'Ocorr.', 'Tend. 30d', 'Prev. 30d', 'Janela crítica', 'Local de maior risco', 'GU', 'Ênfase']
                    .map((t, i) => cel(t, { bold: true, al: AlignmentType.CENTER, sh: shH, w: W(i) }))),
                ...R.tipos.map(t => lin([
                    cel(`${t.ordem}º`, { al: AlignmentType.CENTER, w: W(0) }), cel(t.nome, { bold: true, w: W(1) }),
                    cel(fmt(t.total), { al: AlignmentType.CENTER, w: W(2) }),
                    cel(`${t.tendenciaPct >= 0 ? '+' : ''}${fmt(t.tendenciaPct)}%`, { al: AlignmentType.CENTER, w: W(3) }),
                    cel(fmt(t.previsao30), { al: AlignmentType.CENTER, w: W(4) }),
                    cel(t.janelasCriticas[0] ? `${t.janelasCriticas[0].dia}, ${t.janelasCriticas[0].faixa}` : '—', { w: W(5) }),
                    cel(t.hotspots[0] ? (t.hotspots[0].bairro || t.hotspots[0].cidade) : '—', { w: W(6) }),
                    cel(String(t.guarnicoesSugeridas), { al: AlignmentType.CENTER, w: W(7) }),
                    cel(t.enfase, { bold: true, al: AlignmentType.CENTER, w: W(8) }),
                ])),
            ],
        });
        const textoParecer = (() => { const d = document.createElement('div'); d.innerHTML = R.parecer; return [...d.querySelectorAll('p')].map(p => p.textContent.trim()).filter(Boolean); })();
        return [
            sec('2.2 ESTRATÉGIA POR TIPO DE COMBATE — ANÁLISE PREDITIVA'),
            par(`Tipos selecionados: ${R.tipos.map(t => t.nome).join(', ')}. Previsão para os próximos 30 dias por suavização exponencial (Holt) sobre os últimos ${R.periodoDias} dias.`),
            tab, espaco(),
            ...R.tipos.filter(t => t.total > 0).map(t => par(`${t.nome} — Repressiva: ${t.repressiva.join('; ')}. Preventiva: ${t.preventiva.join('; ')}.`)),
            par('Parecer do XERIFE:'),
            ...(textoParecer.length ? textoParecer : ['—']).map(p => par(p)),
            espaco(),
        ];
    }

    function montarPainel() {
        const el = document.getElementById('painel-estrategia');
        if (!el || el.dataset.montado) return;
        el.dataset.montado = '1';
        el.innerHTML = `
            <h3>🎯 Estratégia por tipo de combate</h3>
            <p style="font-size:11px;color:rgba(255,255,255,.55);margin:0 0 8px;">Escolha os crimes a combater. O Python calcula a análise preditiva (tendência, previsão, horários e locais de risco) e o XERIFE redige a estratégia repressiva e preventiva.</p>
            <div id="opo-est-tipos" class="opo-est-tipos">
                ${TIPOS.map(t => `<label><input type="checkbox" value="${t.id}"${t.padrao ? ' checked' : ''}> ${t.nome}</label>`).join('')}
            </div>
            <button class="btn-analisar" id="opo-est-btn" type="button" style="margin-top:8px;">🎯 GERAR ESTRATÉGIA (XERIFE + PYTHON)</button>
            <div id="opo-est-resultado" style="margin-top:10px;"></div>`;
        document.getElementById('opo-est-btn').addEventListener('click', gerar);
    }

    global.OPOEstrategia = { montarPainel, gerar, htmlSecao, docxBlocos, obterResultado: () => resultado, tiposSelecionados: () => (resultado ? resultado.tiposSelecionados : selecionados()), calcularLocal };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montarPainel); else montarPainel();
})(window);
