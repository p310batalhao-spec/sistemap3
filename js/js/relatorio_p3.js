Chart.register(ChartDataLabels);

// ═══════════════════════════════════════════════════════════════════════
// RELATÓRIO ANALÍTICO P3 — 10º BPM
// Lê o RESUMO já agregado (números prontos, poucos KB) gravado no
// localStorage por js/dashboard-cruzado.js (abrirRelatorioP3 →
// montarResumoRelatorio). Não recebe mais registros brutos — por isso não
// precisa (nem deve) reclassificar CVLI/MVI/CVP aqui: a classificação já
// foi feita na origem, usando a mesma regra de MVI do js/index.js.
//
// Dois modos de exibição, montados sob demanda (lazy) a partir do MESMO
// objeto de dados: "retrato" (documento tradicional) e "slides"
// (apresentação 16:9, um bloco por slide). Ver mudarModo().
// ═══════════════════════════════════════════════════════════════════════

let D = null;           // resumo agregado (localStorage.p3_relatorio)
let SECOES = null;      // dados de conteúdo já prontos (texto + config de gráfico), sem DOM
let modoAtual = 'retrato';
let retratoMontado = false;
let slidesMontado = false;
const CHARTS = {};      // instâncias Chart.js vivas, por id de canvas — evita recriar/perder memória

// ── Utilitários ──────────────────────────────────────────────────────
function pct(val, total) { return !total ? '0%' : Math.round(val / total * 100) + '%'; }
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function somaArr(arr) { return arr.reduce((a, b) => a + b, 0); }
function maxArr(arr) { return arr.length ? Math.max(...arr) : 0; }
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const CORES = ['#0a448f', '#1565c0', '#1976d2', '#1e88e5', '#42a5f5', '#6a1b9a', '#8e24aa', '#ab47bc', '#ce93d8', '#b71c1c'];

// ── Rótulos de dados nos gráficos ────────────────────────────────────
const DL_BARH = { display: true, anchor: 'end', align: 'end', font: { size: 9, weight: 'bold' }, color: '#374263', formatter: v => v };
const DL_BARV = { display: ctx => ctx.dataset.data[ctx.dataIndex] > 0, anchor: 'end', align: 'top', font: { size: 9, weight: 'bold' }, color: '#374263', formatter: v => v };
const DL_LINE = { display: ctx => ctx.dataset.data[ctx.dataIndex] > 0, align: 'top', anchor: 'end', font: { size: 8, weight: 'bold' }, color: ctx => ctx.dataset.borderColor, formatter: v => v };
const DL_DONUT = {
    display: ctx => { const tot = ctx.dataset.data.reduce((a, b) => a + b, 0); return tot > 0 && (ctx.dataset.data[ctx.dataIndex] / tot) >= 0.06; },
    color: '#fff', font: { size: 9, weight: 'bold' },
    formatter: (v, ctx) => { const tot = ctx.dataset.data.reduce((a, b) => a + b, 0); return v + '\n' + Math.round(v / tot * 100) + '%'; }
};

function mkChart(id, type, labels, datasets, opts = {}) {
    const el = document.getElementById(id);
    if (!el) return;
    if (CHARTS[id]) { CHARTS[id].destroy(); delete CHARTS[id]; }
    CHARTS[id] = new Chart(el.getContext('2d'), {
        type,
        data: { labels, datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: opts.legend ?? { position: 'bottom', labels: { font: { size: 9 }, padding: 8, boxWidth: 10 } },
                tooltip: { callbacks: { label: c => ` ${c.dataset.label || c.label}: ${c.parsed.y ?? c.parsed}` } },
                datalabels: opts.datalabels ?? false
            },
            scales: opts.scales,
            ...(opts.extra || {})
        }
    });
}

// Trunca rótulos longos (nomes de tipificação) pra caber nos eixos dos gráficos.
function curto(s, n = 26) { s = String(s || 'N/D'); return s.length > n ? s.substring(0, n - 2) + '…' : s; }

// ═══════════════════════════════════════════════════════════════════════
// MONTA O CONTEÚDO (texto + config de gráfico) A PARTIR DO RESUMO — não
// mexe em DOM aqui, só decide O QUE mostrar. renderRetrato/renderSlides
// decidem COMO mostrar.
// ═══════════════════════════════════════════════════════════════════════
function montarSecoes(dados) {
    const M = dados.mesesLabels;
    const tendencia = arr => arr.at(-1) > arr.at(-2) ? '📈 alta' : arr.at(-1) < arr.at(-2) ? '📉 queda' : '➡️ estável';
    const mesPico = arr => M[arr.indexOf(Math.max(...arr))] || '—';

    let somaDroga = dados.droga.somaPeso || 0;
    const drogaStr = somaDroga >= 1000 ? (somaDroga / 1000).toFixed(3) + ' kg' : somaDroga.toFixed(3) + ' g';

    const secoes = [];

    // ── 1. RESUMO EXECUTIVO ──────────────────────────────────────────
    secoes.push({
        id: 'resumo', icone: 'fa-chart-pie', titulo: 'Resumo Executivo — Indicadores Gerais',
        sub: 'Visão consolidada de todos os indicadores operacionais do período',
        kpis: [
            { valor: dados.cvli.total, sub: M.at(-1), label: 'CVLI', cor: '#6a1b9a' },
            { valor: dados.mvi.total, sub: pct(dados.mvi.total, dados.cvli.total) + ' do CVLI', label: 'MVI', cor: '#b71c1c' },
            { valor: dados.cvp.total, sub: M.at(-1), label: 'CVP', cor: '#e65100' },
            { valor: dados.vd.total, sub: 'ocorrências', label: 'Viol. Doméstica', cor: '#ad1457' },
            { valor: dados.tco.total, sub: 'lavrados', label: 'TCO', cor: '#1565c0' },
            { valor: dados.arma.total, sub: 'apreendidas', label: 'Armas', cor: '#2e7d32' },
            { valor: drogaStr, sub: dados.droga.totalRegistros + ' registros', label: 'Drogas', cor: '#f57f17' },
            { valor: dados.sossego.total, sub: 'ocorrências', label: 'Perturbação Sossego', cor: '#00695c' },
            { valor: dados.visitas.total, sub: 'realizadas', label: 'Visitas Orientativas', cor: '#00796b' },
        ],
        charts: [],
        insights: [
            { tipo: '', icone: 'fa-info-circle', html: `No período analisado (${esc(dados.periodo)}), o batalhão registrou <strong>${dados.cvli.total} ocorrências de CVLI</strong>, <strong>${dados.mvi.total} mortes violentas intencionais (MVI)</strong> e <strong>${dados.cvp.total} crimes contra o patrimônio (CVP)</strong>. Média mensal: <strong>${(dados.cvli.total / 12).toFixed(1)}</strong> CVLI/mês e <strong>${(dados.cvp.total / 12).toFixed(1)}</strong> CVP/mês.` },
            dados.mvi.total > 0 ? { tipo: dados.mvi.total >= dados.cvli.total * 0.5 ? 'perigo' : 'alerta', icone: 'fa-skull', html: `Das <strong>${dados.cvli.total} ocorrências de CVLI</strong>, <strong>${dados.mvi.total} (${pct(dados.mvi.total, dados.cvli.total)})</strong> resultaram em morte (MVI).${dados.mvi.total >= dados.cvli.total * 0.6 ? ' <strong>⚠️ Alta taxa de letalidade — verificar condições de atendimento às vítimas.</strong>' : ''}` } : null,
            { tipo: '', icone: 'fa-gun', html: `Foram apreendidas <strong>${dados.arma.total} arma(s)</strong> e <strong>${drogaStr}</strong> de drogas. Foram lavrados <strong>${dados.tco.total} TCO(s)</strong>.` },
        ].filter(Boolean),
    });

    // ── 2. CVLI ───────────────────────────────────────────────────────
    const cvliMedio = (dados.cvli.total / 12).toFixed(1);
    const top3CvliCid = pct(somaArr(dados.cvli.porCidade.slice(0, 3).map(e => e[1])), dados.cvli.total);
    secoes.push({
        id: 'cvli', icone: 'fa-skull', titulo: 'CVLI — Crimes Violentos Letais Intencionais',
        sub: 'Tipificação, cidades e evolução mensal',
        charts: [
            { id: 'cvli-tip', tipo: 'bar', titulo: 'Tipificações mais frequentes', labels: dados.cvli.porTip.map(e => curto(e[0])), datasets: [{ label: 'CVLI', data: dados.cvli.porTip.map(e => e[1]), backgroundColor: '#6a1b9a', borderRadius: 4, borderSkipped: false }], opts: { legend: { display: false }, scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } }, y: { grid: { display: false }, ticks: { font: { size: 9 } } } }, extra: { indexAxis: 'y' }, datalabels: DL_BARH } },
            { id: 'cvli-cidade', tipo: 'bar', titulo: 'Por cidade', labels: dados.cvli.porCidade.map(e => e[0]), datasets: [{ label: 'CVLI', data: dados.cvli.porCidade.map(e => e[1]), backgroundColor: CORES, borderRadius: 4, borderSkipped: false }], opts: { legend: { display: false }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { grid: { display: false }, ticks: { font: { size: 9 } } } }, datalabels: DL_BARV } },
            { id: 'cvli-mes', tipo: 'line', titulo: 'Evolução — últimos 12 meses', labels: M, datasets: [{ label: 'CVLI', data: dados.cvli.porMes, borderColor: '#6a1b9a', backgroundColor: 'rgba(106,27,154,.12)', fill: true, tension: .35, pointRadius: 4, borderWidth: 2.5 }], opts: { legend: { display: false }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: '#f3eaff' } }, x: { grid: { display: false }, ticks: { font: { size: 9 } } } }, datalabels: DL_LINE }, tall: true },
        ],
        insights: [
            { tipo: dados.cvli.total > 10 ? 'perigo' : 'alerta', icone: 'fa-skull', html: `Foram registradas <strong>${dados.cvli.total} ocorrências de CVLI</strong>, média de <strong>${cvliMedio} casos/mês</strong>. O mês de maior incidência foi <strong>${mesPico(dados.cvli.porMes)}</strong> (${maxArr(dados.cvli.porMes)} registro(s)). Tendência do último mês: <strong>${tendencia(dados.cvli.porMes)}</strong> (${dados.cvli.porMes.at(-1)} vs ${dados.cvli.porMes.at(-2)}).` },
            dados.cvli.porTip[0] ? { tipo: '', icone: 'fa-list', html: `A tipificação mais frequente é <strong>"${esc(dados.cvli.porTip[0][0])}"</strong> com <strong>${dados.cvli.porTip[0][1]} caso(s)</strong> (${pct(dados.cvli.porTip[0][1], dados.cvli.total)}).` } : null,
            dados.cvli.porCidade[0] ? { tipo: '', icone: 'fa-map-marker-alt', html: `A cidade de maior incidência é <strong>${esc(dados.cvli.porCidade[0][0])}</strong> com <strong>${dados.cvli.porCidade[0][1]} caso(s)</strong>. As 3 principais cidades concentram <strong>${top3CvliCid}</strong> dos registros.` } : null,
        ].filter(Boolean),
    });

    // ── 3. MVI ────────────────────────────────────────────────────────
    const diaMaisMvi = DIAS_SEMANA[dados.mvi.porDiaSemana.indexOf(Math.max(...dados.mvi.porDiaSemana))];
    secoes.push({
        id: 'mvi', icone: 'fa-skull-crossbones', titulo: 'MVI — Mortes Violentas Intencionais',
        sub: 'Tipificação e distribuição por dia da semana',
        charts: [
            { id: 'mvi-tip', tipo: 'doughnut', titulo: 'Tipificações', labels: dados.mvi.porTip.map(e => curto(e[0])), datasets: [{ data: dados.mvi.porTip.map(e => e[1]), backgroundColor: ['#b71c1c', '#c62828', '#e53935', '#ef5350', '#f44336', '#e57373', '#ffcdd2', '#ff8a80'], borderWidth: 2, borderColor: '#fff', hoverOffset: 5 }], opts: { legend: { position: 'right', labels: { font: { size: 9 }, padding: 8 } }, datalabels: DL_DONUT } },
            { id: 'mvi-dia', tipo: 'bar', titulo: 'Por dia da semana', labels: DIAS_SEMANA, datasets: [{ label: 'MVI', data: dados.mvi.porDiaSemana, backgroundColor: 'rgba(183,28,28,.75)', borderRadius: 4, borderSkipped: false }], opts: { legend: { display: false }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { grid: { display: false } } }, datalabels: DL_BARV } },
        ],
        insights: [
            dados.mvi.total > 0
                ? { tipo: 'perigo', icone: 'fa-skull-crossbones', html: `O período registrou <strong>${dados.mvi.total} morte(s) violenta(s) intencional(is)</strong>.${dados.mvi.tentativasComObito ? ` Desse total, <strong>${dados.mvi.tentativasComObito} caso(s)</strong> eram tentativas que evoluíram para óbito.` : ''} O dia da semana com maior concentração é <strong>${diaMaisMvi}</strong> (${Math.max(...dados.mvi.porDiaSemana)} caso(s)).` }
                : { tipo: 'ok', icone: 'fa-skull-crossbones', html: '✅ Nenhum caso de MVI registrado no período analisado.' },
            dados.mvi.porTip[0] ? { tipo: '', icone: 'fa-list', html: `A tipificação mais frequente nos casos de MVI é <strong>"${esc(dados.mvi.porTip[0][0])}"</strong> com <strong>${dados.mvi.porTip[0][1]} registro(s)</strong>.` } : null,
        ].filter(Boolean),
    });

    // ── 4. CVP ────────────────────────────────────────────────────────
    const cvpMedio = (dados.cvp.total / 12).toFixed(1);
    secoes.push({
        id: 'cvp', icone: 'fa-mask', titulo: 'CVP — Crimes Violentos contra o Patrimônio',
        sub: 'Tipificação, cidades e evolução mensal',
        charts: [
            { id: 'cvp-tip', tipo: 'bar', titulo: 'Tipos mais frequentes', labels: dados.cvp.porTip.map(e => curto(e[0])), datasets: [{ label: 'CVP', data: dados.cvp.porTip.map(e => e[1]), backgroundColor: '#e65100', borderRadius: 4, borderSkipped: false }], opts: { legend: { display: false }, scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } }, y: { grid: { display: false }, ticks: { font: { size: 9 } } } }, extra: { indexAxis: 'y' }, datalabels: DL_BARH } },
            { id: 'cvp-cidade', tipo: 'bar', titulo: 'Por cidade', labels: dados.cvp.porCidade.map(e => e[0]), datasets: [{ label: 'CVP', data: dados.cvp.porCidade.map(e => e[1]), backgroundColor: CORES, borderRadius: 4, borderSkipped: false }], opts: { legend: { display: false }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { grid: { display: false }, ticks: { font: { size: 9 } } } }, datalabels: DL_BARV } },
            { id: 'cvp-mes', tipo: 'line', titulo: 'Evolução — últimos 12 meses', labels: M, datasets: [{ label: 'CVP', data: dados.cvp.porMes, borderColor: '#e65100', backgroundColor: 'rgba(230,81,0,.1)', fill: true, tension: .35, pointRadius: 4, borderWidth: 2.5 }], opts: { legend: { display: false }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: '#fff3e0' } }, x: { grid: { display: false }, ticks: { font: { size: 9 } } } }, datalabels: DL_LINE }, tall: true },
        ],
        insights: [
            { tipo: dados.cvp.total > 20 ? 'perigo' : 'alerta', icone: 'fa-mask', html: `Foram registradas <strong>${dados.cvp.total} ocorrências de CVP</strong>, média de <strong>${cvpMedio} casos/mês</strong>. Mês de maior incidência: <strong>${mesPico(dados.cvp.porMes)}</strong> (${maxArr(dados.cvp.porMes)} registro(s)). Tendência: <strong>${tendencia(dados.cvp.porMes)}</strong>.` },
            dados.cvp.porTip[0] ? { tipo: '', icone: 'fa-list', html: `O tipo mais frequente é <strong>"${esc(dados.cvp.porTip[0][0])}"</strong> com <strong>${dados.cvp.porTip[0][1]} caso(s)</strong> (${pct(dados.cvp.porTip[0][1], dados.cvp.total)}).` } : null,
            dados.cvp.porCidade[0] ? { tipo: '', icone: 'fa-map-marker-alt', html: `A cidade mais afetada é <strong>${esc(dados.cvp.porCidade[0][0])}</strong> com <strong>${dados.cvp.porCidade[0][1]} caso(s)</strong>.` } : null,
        ].filter(Boolean),
    });

    // ── 5. SÉRIE TEMPORAL CRUZADA ────────────────────────────────────
    const mesCvliPico = mesPico(dados.cvli.porMes), mesCvpPico = mesPico(dados.cvp.porMes);
    const crescCvli = somaArr(dados.cvli.porMes.slice(-3)) > somaArr(dados.cvli.porMes.slice(0, 3));
    secoes.push({
        id: 'temporal', icone: 'fa-chart-line', titulo: 'Série Temporal Cruzada — CVLI · CVP · MVI',
        sub: 'Comparação da evolução mensal dos 3 indicadores',
        charts: [
            { id: 'temporal-cruzado', tipo: 'line', titulo: 'Evolução — últimos 12 meses', labels: M, datasets: [
                { label: 'CVLI', data: dados.cvli.porMes, borderColor: '#6a1b9a', backgroundColor: 'rgba(106,27,154,.08)', fill: true, tension: .35, pointRadius: 3, borderWidth: 2.5 },
                { label: 'CVP', data: dados.cvp.porMes, borderColor: '#e65100', backgroundColor: 'rgba(230,81,0,.06)', fill: true, tension: .35, pointRadius: 3, borderWidth: 2.5 },
                { label: 'MVI', data: dados.mvi.porMes, borderColor: '#b71c1c', backgroundColor: 'rgba(183,28,28,.06)', fill: true, tension: .35, pointRadius: 3, borderWidth: 2.5 },
            ], opts: { legend: { position: 'top', labels: { font: { size: 10 }, padding: 12 } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: '#f0f2f8' } }, x: { grid: { display: false }, ticks: { font: { size: 9 } } } }, extra: { interaction: { mode: 'index', intersect: false } }, datalabels: DL_LINE }, largo: true, tall: true },
        ],
        insights: [
            { tipo: '', icone: 'fa-chart-line', html: `Nos últimos 12 meses: <strong>${somaArr(dados.cvli.porMes)} CVLI</strong>, <strong>${somaArr(dados.cvp.porMes)} CVP</strong> e <strong>${somaArr(dados.mvi.porMes)} MVI</strong>. Pico de CVLI em <strong>${mesCvliPico}</strong>, pico de CVP em <strong>${mesCvpPico}</strong>.${mesCvliPico === mesCvpPico ? ' <strong>⚠️ O mesmo mês concentrou os dois picos.</strong>' : ''}` },
            { tipo: crescCvli ? 'perigo' : 'ok', icone: crescCvli ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down', html: crescCvli ? `⚠️ CVLI em <strong>tendência de crescimento</strong> nos últimos 3 meses (${somaArr(dados.cvli.porMes.slice(-3))} vs ${somaArr(dados.cvli.porMes.slice(0, 3))} no início do período). Recomenda-se intensificar ações de inteligência.` : `✅ CVLI em <strong>tendência de queda ou estabilidade</strong> (${somaArr(dados.cvli.porMes.slice(-3))} vs ${somaArr(dados.cvli.porMes.slice(0, 3))}).` },
        ],
    });

    // ── 6. VD + TCO ───────────────────────────────────────────────────
    secoes.push({
        id: 'vdtco', icone: 'fa-hand-back-fist', titulo: 'Violência Doméstica e TCO',
        sub: 'Evolução mensal dos dois indicadores',
        charts: [
            { id: 'vd-mes', tipo: 'bar', titulo: 'Violência Doméstica — mensal', labels: M, datasets: [{ label: 'VD', data: dados.vd.porMes, backgroundColor: 'rgba(173,20,87,.7)', borderRadius: 4, borderSkipped: false }], opts: { legend: { display: false }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: '#fce4ec' } }, x: { grid: { display: false }, ticks: { font: { size: 9 } } } }, datalabels: DL_BARV } },
            { id: 'tco-mes', tipo: 'bar', titulo: 'TCO — mensal', labels: M, datasets: [{ label: 'TCO', data: dados.tco.porMes, backgroundColor: 'rgba(21,101,192,.7)', borderRadius: 4, borderSkipped: false }], opts: { legend: { display: false }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: '#e3f2fd' } }, x: { grid: { display: false }, ticks: { font: { size: 9 } } } }, datalabels: DL_BARV } },
        ],
        insights: [
            { tipo: 'alerta', icone: 'fa-hand-back-fist', html: `Registradas <strong>${dados.vd.total} ocorrências de violência doméstica</strong> (média de <strong>${(dados.vd.total / 12).toFixed(1)}/mês</strong>). Mês de maior incidência: <strong>${mesPico(dados.vd.porMes)}</strong>.` },
            { tipo: '', icone: 'fa-file-lines', html: `Foram lavrados <strong>${dados.tco.total} TCO(s)</strong> (média de <strong>${(dados.tco.total / 12).toFixed(1)}/mês</strong>). Maior volume em <strong>${mesPico(dados.tco.porMes)}</strong>.` },
        ],
    });

    // ── 7. ARMAS E DROGAS ────────────────────────────────────────────
    const drogaOrd = dados.droga.porTipo.map(([k, v]) => [k, +v.toFixed(1)]);
    secoes.push({
        id: 'materiais', icone: 'fa-boxes-stacked', titulo: 'Armas e Drogas Apreendidas',
        sub: 'Distribuição por tipo',
        charts: [
            { id: 'arma-tipo', tipo: 'doughnut', titulo: 'Armas por tipo', labels: dados.arma.porTipo.map(e => curto(e[0])), datasets: [{ data: dados.arma.porTipo.map(e => e[1]), backgroundColor: ['#2e7d32', '#388e3c', '#43a047', '#4caf50', '#66bb6a', '#81c784', '#a5d6a7', '#c8e6c9'], borderWidth: 2, borderColor: '#fff', hoverOffset: 5 }], opts: { legend: { position: 'right', labels: { font: { size: 9 }, padding: 8 } }, datalabels: DL_DONUT } },
            { id: 'droga-tipo', tipo: 'bar', titulo: 'Drogas por tipo (gramas)', labels: drogaOrd.map(e => curto(e[0])), datasets: [{ label: 'Peso (g)', data: drogaOrd.map(e => e[1]), backgroundColor: '#f57f17', borderRadius: 4, borderSkipped: false }], opts: { legend: { display: false }, scales: { y: { beginAtZero: true }, x: { grid: { display: false }, ticks: { font: { size: 9 } } } }, datalabels: DL_BARV } },
        ],
        insights: [
            { tipo: 'ok', icone: 'fa-gun', html: `Foram apreendidas <strong>${dados.arma.total} arma(s)</strong>.${dados.arma.porTipo[0] ? ` Tipo mais apreendido: <strong>"${esc(dados.arma.porTipo[0][0])}"</strong> (${dados.arma.porTipo[0][1]}, ${pct(dados.arma.porTipo[0][1], dados.arma.total)}).` : ''}` },
            { tipo: 'ok', icone: 'fa-cannabis', html: `Total de <strong>${drogaStr}</strong> de drogas em ${dados.droga.totalRegistros} registro(s).${drogaOrd[0] ? ` Maior volume: <strong>"${esc(drogaOrd[0][0])}"</strong> (${drogaOrd[0][1] >= 1000 ? (drogaOrd[0][1] / 1000).toFixed(3) + ' kg' : drogaOrd[0][1] + ' g'}).` : ''}` },
        ],
    });

    // ── 8. CRUZAMENTO GERAL + TABELA ──────────────────────────────────
    const diaSemCvliMax = DIAS_SEMANA[dados.cvli.porDiaSemana.indexOf(Math.max(...dados.cvli.porDiaSemana))];
    const diaSemCvpMax = DIAS_SEMANA[dados.cvp.porDiaSemana.indexOf(Math.max(...dados.cvp.porDiaSemana))];
    const totalCidGeral = somaArr(dados.cidadeGeral.map(e => e[1]));
    secoes.push({
        id: 'cruzamento', icone: 'fa-table-list', titulo: 'Cruzamento Geral e Registros Recentes',
        sub: 'CVLI + CVP + MVI + Violência Doméstica, por cidade e dia da semana',
        charts: [
            { id: 'cidade-geral', tipo: 'bar', titulo: 'Cidades com mais ocorrências (todas as categorias)', labels: dados.cidadeGeral.map(e => e[0]), datasets: [{ label: 'Ocorrências', data: dados.cidadeGeral.map(e => e[1]), backgroundColor: CORES, borderRadius: 4, borderSkipped: false }], opts: { legend: { display: false }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { grid: { display: false }, ticks: { font: { size: 9 } } } }, datalabels: DL_BARV } },
            { id: 'diasemana-cruzado', tipo: 'bar', titulo: 'CVLI · CVP · MVI por dia da semana', labels: DIAS_SEMANA, datasets: [
                { label: 'CVLI', data: dados.cvli.porDiaSemana, backgroundColor: 'rgba(106,27,154,.75)', borderRadius: 4 },
                { label: 'CVP', data: dados.cvp.porDiaSemana, backgroundColor: 'rgba(230,81,0,.75)', borderRadius: 4 },
                { label: 'MVI', data: dados.mvi.porDiaSemana, backgroundColor: 'rgba(183,28,28,.75)', borderRadius: 4 },
            ], opts: { legend: { position: 'top', labels: { font: { size: 9 }, padding: 8 } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { grid: { display: false } } }, datalabels: DL_BARV } },
        ],
        insights: [
            dados.cidadeGeral[0] ? { tipo: '', icone: 'fa-map-marker-alt', html: `A cidade de maior incidência geral é <strong>${esc(dados.cidadeGeral[0][0])}</strong> com <strong>${dados.cidadeGeral[0][1]} ocorrência(s)</strong> (${pct(dados.cidadeGeral[0][1], totalCidGeral)}).` } : null,
            { tipo: '', icone: 'fa-calendar-week', html: `Dia da semana com maior concentração — CVLI: <strong>${diaSemCvliMax}</strong>, CVP: <strong>${diaSemCvpMax}</strong>.${diaSemCvliMax === diaSemCvpMax ? ' ⚠️ Mesmo dia concentra os dois picos — considerar reforço de efetivo.' : ''}` },
        ].filter(Boolean),
        tabela: dados.cvli.tabela,
    });

    // ── 9. VD · SOSSEGO · VISITAS ─────────────────────────────────────
    secoes.push({
        id: 'social', icone: 'fa-people-group', titulo: 'Violência Doméstica · Perturbação · Visitas Orientativas',
        sub: 'Indicadores sociais e comunitários',
        charts: [
            { id: 'vd-mes2', tipo: 'bar', titulo: 'Violência Doméstica', labels: M, datasets: [{ data: dados.vd.porMes, backgroundColor: 'rgba(173,20,87,.65)', borderColor: '#ad1457', borderWidth: 1.5, borderRadius: 4, borderSkipped: false }], opts: { legend: { display: false }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: '#f0f2f8' } }, x: { grid: { display: false }, ticks: { font: { size: 9 } } } }, datalabels: { display: ctx => ctx.dataset.data[ctx.dataIndex] > 0, anchor: 'end', align: 'top', font: { size: 9, weight: 'bold' }, color: '#ad1457', formatter: v => v } } },
            { id: 'soss-mes', tipo: 'bar', titulo: 'Perturbação do Sossego', labels: M, datasets: [{ data: dados.sossego.porMes, backgroundColor: 'rgba(0,105,92,.65)', borderColor: '#00695c', borderWidth: 1.5, borderRadius: 4, borderSkipped: false }], opts: { legend: { display: false }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: '#f0f2f8' } }, x: { grid: { display: false }, ticks: { font: { size: 9 } } } }, datalabels: { display: ctx => ctx.dataset.data[ctx.dataIndex] > 0, anchor: 'end', align: 'top', font: { size: 9, weight: 'bold' }, color: '#00695c', formatter: v => v } } },
            { id: 'visitas-cidade', tipo: 'doughnut', titulo: 'Visitas por cidade', labels: dados.visitas.porCidade.map(e => e[0]), datasets: [{ data: dados.visitas.porCidade.map(e => e[1]), backgroundColor: ['#00796b', '#00897b', '#009688', '#26a69a', '#4db6ac', '#80cbc4', '#b2dfdb', '#e0f2f1'], borderWidth: 2, borderColor: '#fff', hoverOffset: 5 }], opts: { legend: { position: 'right', labels: { font: { size: 9 }, padding: 6 } }, datalabels: DL_DONUT } },
        ],
        insights: [
            { tipo: dados.vd.total > 0 ? 'alerta' : 'ok', icone: 'fa-hand-back-fist', html: `<strong>${dados.vd.total}</strong> ocorrência(s) de violência doméstica (pico em <strong>${mesPico(dados.vd.porMes)}</strong>).` },
            { tipo: '', icone: 'fa-volume-high', html: `<strong>${dados.sossego.total}</strong> perturbação(ões) do sossego (pico em <strong>${mesPico(dados.sossego.porMes)}</strong>).` },
            { tipo: 'ok', icone: 'fa-house-user', html: `<strong>${dados.visitas.total}</strong> visita(s) orientativa(s) realizadas.${dados.visitas.porCidade[0] ? ` Cidade com mais visitas: <strong>${esc(dados.visitas.porCidade[0][0])}</strong> (${dados.visitas.porCidade[0][1]}).` : ''}` },
        ],
    });

    return secoes;
}

// ═══════════════════════════════════════════════════════════════════════
// MODO RETRATO — documento tradicional, seções empilhadas
// ═══════════════════════════════════════════════════════════════════════
function htmlInsights(insights) {
    return `<div class="comentario">${insights.map(i => `<div class="insight ${i.tipo}"><i class="fas ${i.icone}"></i><span>${i.html}</span></div>`).join('')}</div>`;
}

function htmlTabelaCvli(tabela) {
    if (!tabela || !tabela.length) return '';
    const linhas = tabela.map(doc => `<tr>
        <td><strong>${esc(doc.boletim || '—')}</strong></td>
        <td style="white-space:nowrap">${esc(doc.data || '—')}</td>
        <td>${esc(doc.hora || '—')}</td>
        <td><span class="badge-rel ${doc.mvi ? 'badge-mvi' : 'badge-cvli'}">${esc(curto(doc.tip, 35))}</span></td>
        <td>${esc(doc.bairro || '—')}</td>
        <td>${esc(doc.cidade || '—')}</td>
        <td>${esc(doc.solicitante || '—')}</td>
        <td>${esc(doc.solucao || '—')}</td>
        <td style="text-align:center">${doc.obito === 'S' ? '<span class="obito-s">SIM</span>' : '<span class="obito-n">NÃO</span>'}</td>
    </tr>`).join('');
    return `<div style="overflow-x:auto;margin-top:.8rem;"><table class="tabela-rel">
        <thead><tr><th>Boletim</th><th>Data</th><th>Hora</th><th>Tipificação</th><th>Bairro</th><th>Cidade</th><th>Solicitante</th><th>Solução</th><th>Óbito</th></tr></thead>
        <tbody>${linhas}</tbody></table></div>
        <p style="font-size:.68rem;color:#9ea3b5;margin-top:.4rem;">Exibindo os ${tabela.length} registros de CVLI mais recentes. Registros MVI destacados em vermelho.</p>`;
}

function renderRetrato() {
    const cont = document.getElementById('modo-retrato');
    const agora = new Date();
    const geradoStr = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) + ' às ' + agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    let h = `<div class="capa">
        <div class="capa-header">
            <img src="../img/brasao.png" alt="Brasão" onerror="this.style.display='none'">
            <div class="capa-org"><h1>SISTEMA DE GERENCIAMENTO P3</h1><h2><span class="cabecalho-unidade">10º BATALHÃO DE POLÍCIA MILITAR</span></h2></div>
        </div>
        <div class="capa-titulo">
            <h3>RELATÓRIO ANALÍTICO OPERACIONAL</h3>
            <p>Análise integrada de CVLI, MVI, CVP, Violência Doméstica, TCO, Armas e Drogas apreendidas</p>
        </div>
        <div class="capa-meta">
            <span><i class="fas fa-shield-alt"></i> <span class="cabecalho-unidade">10º BPM</span></span>
            <span><i class="fas fa-calendar"></i> ${geradoStr}</span>
            <span><i class="fas fa-user"></i> ${esc(D.operador || 'Operador')}</span>
            <span><i class="fas fa-filter"></i> ${esc(D.periodo || 'Últimos 12 meses')}</span>
        </div>
    </div>`;

    SECOES.forEach((s, i) => {
        h += `<div class="secao" id="ret-secao-${s.id}">
            <div class="secao-titulo">
                <div class="secao-numero">${i + 1}</div>
                <div><h2><i class="fas ${s.icone}" style="margin-right:.4rem;"></i>${esc(s.titulo)}</h2><p>${esc(s.sub)}</p></div>
            </div>`;
        if (s.kpis) h += `<div class="kpi-grid">${s.kpis.map(k => `<div class="kpi" style="border-top-color:${k.cor}"><div class="kpi-valor" style="${typeof k.valor === 'string' && k.valor.length > 5 ? 'font-size:1.3rem;' : ''}color:${k.cor}">${esc(k.valor)}</div><div class="kpi-sub">${esc(k.sub)}</div><div class="kpi-label">${esc(k.label)}</div></div>`).join('')}</div>`;
        if (s.charts && s.charts.length) {
            const linhaClasse = s.charts.length === 3 ? 'chart-row tri' : 'chart-row';
            h += `<div class="${linhaClasse}">${s.charts.map(c => `<div class="chart-box" style="${c.largo ? 'grid-column:1/-1;' : ''}"><div class="chart-box-title">${esc(c.titulo)}</div><div class="chart-wrapper${c.tall ? ' tall' : ''}"><canvas id="ret-${c.id}"></canvas></div></div>`).join('')}</div>`;
        }
        h += htmlInsights(s.insights);
        if (s.tabela) h += htmlTabelaCvli(s.tabela);
        h += `</div>`;
    });

    h += `<div class="rodape"><div><strong>Sistema de Gerenciamento P3</strong><br>Seção de Planejamento, Instrução e Estatística</div><div style="text-align:right;">Gerado em: ${geradoStr}<br>Operador: ${esc(D.operador || '—')}</div></div>`;

    cont.innerHTML = h;

    SECOES.forEach(s => (s.charts || []).forEach(c => mkChart('ret-' + c.id, c.tipo, c.labels, c.datasets, c.opts)));
}

// ═══════════════════════════════════════════════════════════════════════
// MODO SLIDES — um bloco 16:9 por seção
// ═══════════════════════════════════════════════════════════════════════
function renderSlides() {
    const cont = document.getElementById('modo-slides');
    const total = SECOES.length + 2; // + capa + encerramento

    let h = `<div class="slide slide-capa">
        <img src="../img/brasao.png" alt="Brasão" onerror="this.style.display='none'">
        <h1>SISTEMA DE GERENCIAMENTO P3</h1>
        <h2><span class="cabecalho-unidade">10º BATALHÃO DE POLÍCIA MILITAR</span></h2>
        <div class="slide-capa-titulo">RELATÓRIO ANALÍTICO OPERACIONAL</div>
        <div class="slide-capa-meta">
            <span><i class="fas fa-user"></i> ${esc(D.operador || 'Operador')}</span>
            <span><i class="fas fa-filter"></i> ${esc(D.periodo || 'Últimos 12 meses')}</span>
            <span><i class="fas fa-calendar"></i> ${esc(D.geradoEm || '')}</span>
        </div>
    </div>`;

    SECOES.forEach((s, i) => {
        h += `<div class="slide" id="sld-secao-${s.id}">
            <div class="slide-header"><div class="slide-numero">${i + 1}</div><div><h2><i class="fas ${s.icone}" style="margin-right:.4rem;"></i>${esc(s.titulo)}</h2><p>${esc(s.sub)}</p></div></div>
            <div class="slide-body">`;
        if (s.kpis) h += `<div class="slide-kpi-grid">${s.kpis.map(k => `<div class="slide-kpi" style="border-top-color:${k.cor}"><div class="kpi-valor" style="${typeof k.valor === 'string' && k.valor.length > 5 ? 'font-size:1rem;' : ''}color:${k.cor}">${esc(k.valor)}</div><div class="kpi-label">${esc(k.label)}</div></div>`).join('')}</div>`;
        if (s.charts && s.charts.length) {
            h += `<div class="chart-row${s.charts.length === 3 ? ' tri' : ''}">${s.charts.map(c => `<div class="chart-box" style="${c.largo ? 'grid-column:1/-1;' : ''}"><div class="chart-box-title">${esc(c.titulo)}</div><div class="chart-wrapper"><canvas id="sld-${c.id}"></canvas></div></div>`).join('')}</div>`;
        }
        // Slides ficam mais limpos com no máximo 2 insights (evita estourar a altura fixa do slide)
        h += htmlInsights(s.insights.slice(0, 2));
        h += `</div>
            <div class="slide-footer"><span>Sistema de Gerenciamento P3 — Relatório Analítico</span><span>${i + 2} / ${total}</span></div>
        </div>`;
    });

    h += `<div class="slide slide-fechamento">
        <i class="fas fa-shield-halved"></i>
        <h2>Fim do Relatório</h2>
        <p>Seção de Planejamento, Instrução e Estatística — Sistema de Gerenciamento P3</p>
        <p style="opacity:.5;font-size:.7rem;margin-top:1rem;">Gerado em ${esc(D.geradoEm || '')} por ${esc(D.operador || '—')}</p>
    </div>`;

    cont.innerHTML = h;

    SECOES.forEach(s => (s.charts || []).forEach(c => mkChart('sld-' + c.id, c.tipo, c.labels, c.datasets, c.opts)));
}

// ═══════════════════════════════════════════════════════════════════════
// TROCA DE MODO + IMPRESSÃO
// ═══════════════════════════════════════════════════════════════════════
function aplicarTamanhoPagina(modo) {
    let tag = document.getElementById('page-size-style');
    if (!tag) { tag = document.createElement('style'); tag.id = 'page-size-style'; document.head.appendChild(tag); }
    tag.textContent = modo === 'slides' ? '@page { size: landscape; margin: 0; }' : '@page { size: portrait; margin: 12mm; }';
}

function mudarModo(modo) {
    modoAtual = modo;
    document.getElementById('btn-modo-retrato').classList.toggle('ativo', modo === 'retrato');
    document.getElementById('btn-modo-slides').classList.toggle('ativo', modo === 'slides');
    document.getElementById('modo-retrato').style.display = modo === 'retrato' ? 'block' : 'none';
    document.getElementById('modo-slides').style.display = modo === 'slides' ? 'flex' : 'none';

    if (modo === 'retrato' && !retratoMontado) { renderRetrato(); retratoMontado = true; preencherUnidade(); }
    if (modo === 'slides' && !slidesMontado) { renderSlides(); slidesMontado = true; preencherUnidade(); }

    aplicarTamanhoPagina(modo);
}
window.mudarModo = mudarModo;

// session.js só escaneia .cabecalho-unidade UMA vez, no DOMContentLoaded —
// como a capa desta página é montada depois (via innerHTML, sob demanda),
// os elementos ainda não existem nesse momento e ficariam vazios. Preenche
// aqui, de novo, toda vez que um modo novo é montado pela primeira vez.
async function preencherUnidade() {
    const alvos = document.querySelectorAll('.cabecalho-unidade');
    if (!alvos.length || !window.P3) return;
    try {
        const cfg = await P3.loadUnidadeConfig();
        const nome = (cfg && cfg.nome) ? cfg.nome.toUpperCase() : '10º BATALHÃO DE POLÍCIA MILITAR';
        alvos.forEach(el => { el.textContent = nome; });
    } catch (e) { /* mantém o texto padrão em caso de falha */ }
}

// ═══════════════════════════════════════════════════════════════════════
// INICIALIZAÇÃO
// ═══════════════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
    const raw = localStorage.getItem('p3_relatorio');
    if (!raw) {
        document.getElementById('loader').innerHTML =
            '<i class="fas fa-exclamation-triangle" style="color:#b71c1c;font-size:2rem;display:block;margin-bottom:12px;"></i>' +
            'Dados não encontrados.<br><small>Abra este relatório pelo botão <strong>"Relatório P3"</strong> no Dashboard Cruzado.</small>';
        return;
    }

    try {
        D = JSON.parse(raw);
        SECOES = montarSecoes(D);
    } catch (e) {
        console.error('Erro ao ler dados do relatório:', e);
        document.getElementById('loader').innerHTML =
            '<i class="fas fa-exclamation-triangle" style="color:#b71c1c;font-size:2rem;display:block;margin-bottom:12px;"></i>' +
            'Erro ao processar os dados do relatório. Gere-o novamente no Dashboard Cruzado.';
        return;
    }

    document.title = `Relatório P3 — 10º BPM — ${new Date().toLocaleDateString('pt-BR')}`;
    document.getElementById('loader').style.display = 'none';
    document.getElementById('relatorio').style.display = 'block';

    mudarModo('retrato');
});
