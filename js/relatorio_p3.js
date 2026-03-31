Chart.register(ChartDataLabels);

// ═══════════════════════════════════════════════════════════════════════
// RELATÓRIO ANALÍTICO P3 — 10º BPM
// Lê os dados do localStorage gravados pelo dashboard-p3.html
// Chave: 'p3_relatorio'
// ═══════════════════════════════════════════════════════════════════════

// ── Cores padrão ────────────────────────────────────────────────────
const CORES = [
    '#0a448f', '#1565c0', '#1976d2', '#1e88e5', '#42a5f5',
    '#6a1b9a', '#8e24aa', '#ab47bc', '#ce93d8',
    '#b71c1c', '#c62828', '#e53935', '#ef5350',
    '#e65100', '#f4511e', '#ff7043', '#ffab91',
    '#2e7d32', '#388e3c', '#43a047', '#66bb6a',
];

// ── Utilitários ──────────────────────────────────────────────────────
function pct(val, total) {
    if (!total) return '0%';
    return Math.round(val / total * 100) + '%';
}

function parseDateStr(str) {
    if (!str || str === '---') return null;
    str = str.toString().trim().substring(0, 10);
    const mBR = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (mBR) return new Date(+mBR[3], +mBR[2] - 1, +mBR[1]);
    const mISO = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (mISO) return new Date(+mISO[1], +mISO[2] - 1, +mISO[3]);
    return null;
}

function toISO(str) {
    if (!str || str === '---') return '';
    str = str.toString().trim().substring(0, 10);
    if (str.includes('/')) {
        const [d, m, a] = str.split('/');
        return `${a}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return str;
}

const norm = str => (str || '').toString().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

// ── Classificadores (idênticos ao dashboard-p3.js) ──────────────────
const ehTipoCVLI = t =>
    t.includes('HOMICIDIO') || t.includes('FEMINICIDIO') || t.includes('LATROCINIO');

function isMVI(item) {
    const t = norm((item.TIPIFICACAO_GERAL || '') + ' ' + (item.TIPIFICACAO || ''));
    const obito = norm(item.OBITO || '');
    if (t.includes('ACHADO') || t.includes('SUICIDIO') || t.includes('VIOLACAO')) return false;
    if (t.includes('TENTATIVA')) return ehTipoCVLI(t) && obito === 'S';
    return ehTipoCVLI(t);
}

function isCVLI(item) {
    const t = norm((item.TIPIFICACAO_GERAL || '') + ' ' + (item.TIPIFICACAO || ''));
    if (t.includes('ACHADO') || t.includes('SUICIDIO') || t.includes('VIOLACAO')) return false;
    if (t.includes('TENTATIVA')) return ehTipoCVLI(t);
    return ehTipoCVLI(t);
}

function isCVP(item) {
    const t = norm((item.TIPIFICACAO_GERAL || '') + ' ' + (item.TIPIFICACAO || ''));
    const obito = norm(item.OBITO || '');
    if (t.includes('APOIO') || t.includes('OUTRAS')) return false;
    if (t.includes('TENTATIVA') && obito === 'S') return false;
    return t.includes('ROUBO') || t.includes('EXTORSAO') || t.includes('LATROCINIO');
}

// ── Gráfico helper ────────────────────────────────────────────────────
function mkChart(id, type, labels, datasets, opts = {}) {
    const ctx = document.getElementById(id)?.getContext('2d');
    if (!ctx) return;
    new Chart(ctx, {
        type,
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: opts.legend ?? { position: 'bottom', labels: { font: { size: 10 }, padding: 10 } },
                tooltip: { callbacks: { label: c => ` ${c.dataset.label || c.label}: ${c.parsed.y ?? c.parsed}` } },
                datalabels: opts.datalabels ?? false
            },
            scales: opts.scales,
            ...(opts.extra || {})
        }
    });
}

// ── Série temporal: conta por mês nos últimos N meses ─────────────────
function buildMeses(n = 12) {
    const agora = new Date();
    const meses = [];
    for (let i = n - 1; i >= 0; i--) {
        const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
        meses.push({
            label: `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`,
            chave: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        });
    }
    return meses;
}

function contarPorMes(arr, meses) {
    const cnt = {};
    arr.forEach(item => {
        const iso = toISO(item.DATA || item.data || '');
        if (iso.length >= 7) {
            const chave = iso.substring(0, 7);
            cnt[chave] = (cnt[chave] || 0) + 1;
        }
    });
    return meses.map(m => cnt[m.chave] || 0);
}

function topEntries(obj, n = 8) {
    return Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
}

// ── Top cidade por array ──────────────────────────────────────────────
function contagemCidade(arr) {
    const cnt = {};
    arr.forEach(i => {
        const c = (i.CIDADE || 'N/D').trim();
        cnt[c] = (cnt[c] || 0) + 1;
    });
    return cnt;
}

// ── Contagem tipificação ──────────────────────────────────────────────
function contagemTip(arr) {
    const cnt = {};
    arr.forEach(i => {
        const t = (i.TIPIFICACAO_GERAL || i.TIPIFICACAO || 'N/D').trim();
        cnt[t] = (cnt[t] || 0) + 1;
    });
    return cnt;
}


// ── Helpers de rótulos ───────────────────────────────────────────
const DL_BARH = { display: true, anchor: 'end', align: 'end', font: { size: 9, weight: 'bold' }, color: '#374263', formatter: v => v };
const DL_BARV = { display: ctx => ctx.dataset.data[ctx.dataIndex] > 0, anchor: 'end', align: 'top', font: { size: 9, weight: 'bold' }, color: '#374263', formatter: v => v };
const DL_LINE = { display: ctx => ctx.dataset.data[ctx.dataIndex] > 0, align: 'top', anchor: 'end', font: { size: 8, weight: 'bold' }, color: ctx => ctx.dataset.borderColor, formatter: v => v };
const DL_DONUT = {
    display: ctx => { const tot = ctx.dataset.data.reduce((a,b)=>a+b,0); return tot>0 && (ctx.dataset.data[ctx.dataIndex]/tot)>=0.05; },
    color: '#fff', font: { size: 10, weight: 'bold' },
    formatter: (v, ctx) => { const tot = ctx.dataset.data.reduce((a,b)=>a+b,0); return v+'\n'+Math.round(v/tot*100)+'%'; }
};

// ═══════════════════════════════════════════════════════════════════════
// INICIALIZAÇÃO
// ═══════════════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
    const raw = localStorage.getItem('p3_relatorio');
    if (!raw) {
        document.getElementById('loader').innerHTML =
            '<i class="fas fa-exclamation-triangle" style="color:#b71c1c;font-size:2rem;display:block;margin-bottom:12px;"></i>' +
            'Dados não encontrados.<br><small>Abra este relatório pelo botão <strong>"Imprimir Relatório"</strong> no dashboard P3.</small>';
        return;
    }

    const D = JSON.parse(raw);
    const { geral, cvpArr, arma, droga, tco, vd, sossego, visitas = [] } = D;

    // ── Derivações dos dados brutos ───────────────────────────────────
    const cvliArr = geral.filter(isCVLI);
    const mviArr = geral.filter(isMVI);
    const cvpFilt = cvpArr.filter(isCVP);

    const meses = buildMeses(12);
    const mesesLabels = meses.map(m => m.label);

    // ── Metadados da capa ─────────────────────────────────────────────
    const agora = new Date();
    const geradoEm = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
        + ' às ' + agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    document.getElementById('meta-data').innerHTML = `<i class="fas fa-calendar"></i> ${geradoEm}`;
    document.getElementById('meta-operador').innerHTML = `<i class="fas fa-user"></i> ${D.operador || 'Operador'}`;
    document.getElementById('meta-periodo').innerHTML = `<i class="fas fa-filter"></i> ${D.periodo || 'Ano corrente'}`;
    document.getElementById('rodape-meta').innerHTML = `Gerado em: ${geradoEm}<br>Operador: ${D.operador || '—'}`;
    document.title = `Relatório P3 — 10º BPM — ${agora.toLocaleDateString('pt-BR')}`;

    // ════════════════════════════════════════════════════════════════
    // SEÇÃO 1 — RESUMO EXECUTIVO / KPIs
    // ════════════════════════════════════════════════════════════════
    let somaDroga = 0;
    droga.forEach(d => {
        const v = parseFloat((d.QUANTIDADE || d.PESO || '0').toString().replace(',', '.'));
        if (!isNaN(v)) somaDroga += v;
    });
    const drogaStr = somaDroga >= 1000
        ? (somaDroga / 1000).toFixed(3) + ' kg'
        : somaDroga.toFixed(3) + ' g';

    document.getElementById('kpi-grid').innerHTML = `
        <div class="kpi cvli">
            <div class="kpi-valor">${cvliArr.length}</div>
            <div class="kpi-pct">${meses.at(-1).label}</div>
            <div class="kpi-label"><i class="fas fa-skull"></i> CVLI</div>
        </div>
        <div class="kpi mvi">
            <div class="kpi-valor">${mviArr.length}</div>
            <div class="kpi-pct">${pct(mviArr.length, cvliArr.length)} do CVLI</div>
            <div class="kpi-label"><i class="fas fa-skull-crossbones"></i> MVI</div>
        </div>
        <div class="kpi cvp">
            <div class="kpi-valor">${cvpFilt.length}</div>
            <div class="kpi-pct">${meses.at(-1).label}</div>
            <div class="kpi-label"><i class="fas fa-mask"></i> CVP</div>
        </div>
        <div class="kpi vd">
            <div class="kpi-valor">${vd.length}</div>
            <div class="kpi-pct">${meses.at(-1).label}</div>
            <div class="kpi-label"><i class="fas fa-hand-paper"></i> Viol. Doméstica</div>
        </div>
        <div class="kpi tco">
            <div class="kpi-valor">${tco.length}</div>
            <div class="kpi-pct">${meses.at(-1).label}</div>
            <div class="kpi-label"><i class="fas fa-file-alt"></i> TCO</div>
        </div>
        <div class="kpi arma">
            <div class="kpi-valor">${arma.length}</div>
            <div class="kpi-pct">${meses.at(-1).label}</div>
            <div class="kpi-label"><i class="fas fa-gun"></i> Armas</div>
        </div>
        <div class="kpi drug">
            <div class="kpi-valor" style="font-size:1.35rem;">${drogaStr}</div>
            <div class="kpi-pct">${droga.length} registros</div>
            <div class="kpi-label"><i class="fas fa-cannabis"></i> Drogas</div>
        </div>
        <div class="kpi" style="border-top-color:#00695c;">
            <div class="kpi-valor" style="color:#00695c;">${sossego.length}</div>
            <div class="kpi-pct">ocorrências no período</div>
            <div class="kpi-label"><i class="fas fa-volume-high" style="color:#00695c;"></i> Perturbação Sossego</div>
        </div>
        <div class="kpi vd">
            <div class="kpi-valor">${vd.length}</div>
            <div class="kpi-pct">ocorrências no período</div>
            <div class="kpi-label"><i class="fas fa-hand-paper"></i> Viol. Doméstica</div>
        </div>
        <div class="kpi" style="border-top-color:#00796b;">
            <div class="kpi-valor" style="color:#00796b;">${visitas.length}</div>
            <div class="kpi-pct">visitas no período</div>
            <div class="kpi-label"><i class="fas fa-house-user" style="color:#00796b;"></i> Visitas Orientativas</div>
        </div>`;

    // Comentários analíticos — Resumo Executivo
    const topCvliCid = topEntries(contagemCidade(cvliArr))[0] || ['N/D', 0];
    const topCvpCid = topEntries(contagemCidade(cvpFilt))[0] || ['N/D', 0];
    const cvliMesArr = contarPorMes(cvliArr, meses);
    const cvpMesArr = contarPorMes(cvpFilt, meses);
    const mviMesArr = contarPorMes(mviArr, meses);
    const cvliMedio = (cvliArr.length / 12).toFixed(1);
    const cvpMedio = (cvpFilt.length / 12).toFixed(1);
    const tentComObito = cvliArr.filter(i => norm(i.TIPIFICACAO_GERAL || i.TIPIFICACAO || '').includes('TENTATIVA') && norm(i.OBITO || '') === 'S').length;

    document.getElementById('comentario-resumo').innerHTML = `
        <div class="insight">
            <i class="fas fa-info-circle"></i>
            <span>No período analisado, o 10º BPM registrou <strong>${cvliArr.length} ocorrências de CVLI</strong>,
            <strong>${mviArr.length} mortes violentas intencionais (MVI)</strong> e
            <strong>${cvpFilt.length} crimes contra o patrimônio (CVP)</strong>.
            A média mensal de CVLI foi de <strong>${cvliMedio} casos/mês</strong>
            e de CVP foi de <strong>${cvpMedio} casos/mês</strong>.</span>
        </div>
        ${mviArr.length > 0 ? `
        <div class="insight ${mviArr.length >= cvliArr.length * 0.5 ? 'perigo' : 'alerta'}">
            <i class="fas fa-skull"></i>
            <span>Das <strong>${cvliArr.length} ocorrências de CVLI</strong>, <strong>${mviArr.length}
            (${pct(mviArr.length, cvliArr.length)})</strong> resultaram em morte (MVI).
            ${tentComObito > 0 ? `Desse total, <strong>${tentComObito} caso(s)</strong> eram inicialmente tipificados como tentativa mas tiveram óbito confirmado.` : ''}
            ${mviArr.length >= cvliArr.length * 0.6 ? '<strong>⚠️ Alta taxa de letalidade — verificar condições de atendimento às vítimas.</strong>' : ''}</span>
        </div>` : ''}
        <div class="insight">
            <i class="fas fa-map-marker-alt"></i>
            <span>A cidade com maior incidência de CVLI é <strong>${topCvliCid[0]}</strong>
            com <strong>${topCvliCid[1]} caso(s)</strong> (${pct(topCvliCid[1], cvliArr.length)} do total).
            No CVP, o município de maior incidência é <strong>${topCvpCid[0]}</strong>
            com <strong>${topCvpCid[1]} ocorrência(s)</strong>.</span>
        </div>
        <div class="insight">
            <i class="fas fa-gun"></i>
            <span>Foram apreendidas <strong>${arma.length} arma(s)</strong> e
            <strong>${drogaStr}</strong> de drogas (${droga.length} registros).
            Foram lavrados <strong>${tco.length} TCO(s)</strong>.</span>
        </div>
        <div class="insight">
            <i class="fas fa-hand-paper"></i>
            <span>Registradas <strong>${vd.length} ocorrência(s) de violência doméstica</strong>,
            <strong>${sossego.length} perturbação(ões) do sossego</strong> e realizadas
            <strong>${visitas.length} visita(s) orientativa(s)</strong> no período.</span>
        </div>`;

    // ════════════════════════════════════════════════════════════════
    // SEÇÃO 2 — CVLI
    // ════════════════════════════════════════════════════════════════
    const cvliTip = topEntries(contagemTip(cvliArr));
    mkChart('r-cvli-tip', 'bar',
        cvliTip.map(([k]) => k.length > 30 ? k.substring(0, 28) + '…' : k),
        [{ label: 'CVLI', data: cvliTip.map(([, v]) => v), backgroundColor: '#6a1b9a', borderRadius: 4, borderSkipped: false }],
        { legend: { display: false }, scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } }, y: { grid: { display: false }, ticks: { font: { size: 9 } } } }, extra: { indexAxis: 'y' }, datalabels: DL_BARH });

    const cvliCid = topEntries(contagemCidade(cvliArr));
    mkChart('r-cvli-cidade', 'bar',
        cvliCid.map(([k]) => k),
        [{ label: 'CVLI', data: cvliCid.map(([, v]) => v), backgroundColor: CORES.slice(0, cvliCid.length), borderRadius: 4, borderSkipped: false }],
        { legend: { display: false }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { grid: { display: false }, ticks: { font: { size: 9 } } } }, datalabels: DL_BARV });

    mkChart('r-cvli-mes', 'line', mesesLabels,
        [{ label: 'CVLI', data: cvliMesArr, borderColor: '#6a1b9a', backgroundColor: 'rgba(106,27,154,.12)', fill: true, tension: .35, pointRadius: 5, borderWidth: 2.5 }],
        { legend: { display: false }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: '#f3eaff' } }, x: { grid: { display: false }, ticks: { font: { size: 10 } } } }, datalabels: DL_LINE });

    const mesMaisCvli = mesesLabels[cvliMesArr.indexOf(Math.max(...cvliMesArr))] || '—';
    const mesMenorCvli = mesesLabels[cvliMesArr.indexOf(Math.min(...cvliMesArr.filter(v => v > 0)))] || '—';
    const cvliTendencia = cvliMesArr.at(-1) > cvliMesArr.at(-2) ? '📈 alta' : cvliMesArr.at(-1) < cvliMesArr.at(-2) ? '📉 queda' : '➡️ estável';

    document.getElementById('comentario-cvli').innerHTML = `
        <div class="insight ${cvliArr.length > 10 ? 'perigo' : 'alerta'}">
            <i class="fas fa-skull"></i>
            <span>Foram registradas <strong>${cvliArr.length} ocorrências de CVLI</strong> no período,
            com média de <strong>${cvliMedio} casos/mês</strong>.
            O mês de maior incidência foi <strong>${mesMaisCvli}</strong> com
            <strong>${Math.max(...cvliMesArr)} registro(s)</strong>.
            A tendência do último mês é de <strong>${cvliTendencia}</strong>
            (${cvliMesArr.at(-1)} casos) em relação ao mês anterior (${cvliMesArr.at(-2)} casos).</span>
        </div>
        ${cvliTip[0] ? `
        <div class="insight">
            <i class="fas fa-list"></i>
            <span>A tipificação mais frequente é <strong>"${cvliTip[0][0]}"</strong>
            com <strong>${cvliTip[0][1]} caso(s)</strong> (${pct(cvliTip[0][1], cvliArr.length)} do total).
            ${cvliTip[1] ? `A segunda é <strong>"${cvliTip[1][0]}"</strong> com <strong>${cvliTip[1][1]}</strong>.` : ''}</span>
        </div>` : ''}
        <div class="insight">
            <i class="fas fa-map-marker-alt"></i>
            <span>A cidade de maior incidência de CVLI é <strong>${cvliCid[0]?.[0] || 'N/D'}</strong>
            com <strong>${cvliCid[0]?.[1] || 0} caso(s)</strong> (${pct(cvliCid[0]?.[1] || 0, cvliArr.length)} do total).
            ${cvliCid.length >= 3 ? `As 3 principais cidades concentram <strong>${pct(cvliCid.slice(0, 3).reduce((s, [, v]) => s + v, 0), cvliArr.length)}</strong> dos registros.` : ''}</span>
        </div>`;

    // ════════════════════════════════════════════════════════════════
    // SEÇÃO 3 — MVI
    // ════════════════════════════════════════════════════════════════
    const mviTip = topEntries(contagemTip(mviArr));
    mkChart('r-mvi-tip', 'doughnut',
        mviTip.map(([k]) => k.length > 30 ? k.substring(0, 28) + '…' : k),
        [{ data: mviTip.map(([, v]) => v), backgroundColor: ['#b71c1c', '#c62828', '#e53935', '#ef5350', '#f44336', '#e57373', '#ffcdd2', '#ff8a80'], borderWidth: 2, borderColor: '#fff', hoverOffset: 5 }],
        { legend: { position: 'right', labels: { font: { size: 10 }, padding: 10 } }, datalabels: DL_DONUT });

    const diasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const mviDia = Array(7).fill(0);
    mviArr.forEach(i => {
        const d = parseDateStr(i.DATA || i.data || '');
        if (d) mviDia[d.getDay()]++;
    });
    mkChart('r-mvi-diasemana', 'bar', diasSemana,
        [{ label: 'MVI', data: mviDia, backgroundColor: 'rgba(183,28,28,.75)', borderRadius: 4, borderSkipped: false }],
        { legend: { display: false }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { grid: { display: false } } }, datalabels: DL_BARV });

    const diaMaisMvi = diasSemana[mviDia.indexOf(Math.max(...mviDia))];
    const tentativasComObito = mviArr.filter(i => norm(i.TIPIFICACAO_GERAL || i.TIPIFICACAO || '').includes('TENTATIVA'));

    document.getElementById('comentario-mvi').innerHTML = `
        <div class="insight ${mviArr.length > 0 ? 'perigo' : 'ok'}">
            <i class="fas fa-skull-crossbones"></i>
            <span>${mviArr.length > 0
            ? `O período registrou <strong>${mviArr.length} morte(s) violenta(s) intencional(is)</strong>.
                   ${tentativasComObito.length > 0 ? `Desse total, <strong>${tentativasComObito.length} caso(s)</strong> eram
                   tentativas que evoluíram para óbito.` : ''}
                   O dia da semana com maior concentração de MVI é <strong>${diaMaisMvi}</strong>
                   com <strong>${Math.max(...mviDia)} caso(s)</strong>.`
            : '✅ Nenhum caso de MVI registrado no período analisado.'
        }</span>
        </div>
        ${mviTip[0] ? `
        <div class="insight">
            <i class="fas fa-list"></i>
            <span>A tipificação mais frequente nos casos de MVI é <strong>"${mviTip[0][0]}"</strong>
            com <strong>${mviTip[0][1]} registro(s)</strong>.</span>
        </div>` : ''}`;

    // ════════════════════════════════════════════════════════════════
    // SEÇÃO 4 — CVP
    // ════════════════════════════════════════════════════════════════
    const cvpTip = topEntries(contagemTip(cvpFilt));
    mkChart('r-cvp-tip', 'bar',
        cvpTip.map(([k]) => k.length > 30 ? k.substring(0, 28) + '…' : k),
        [{ label: 'CVP', data: cvpTip.map(([, v]) => v), backgroundColor: '#e65100', borderRadius: 4, borderSkipped: false }],
        { legend: { display: false }, scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } }, y: { grid: { display: false }, ticks: { font: { size: 9 } } } }, extra: { indexAxis: 'y' }, datalabels: DL_BARH });

    const cvpCid = topEntries(contagemCidade(cvpFilt));
    mkChart('r-cvp-cidade', 'bar',
        cvpCid.map(([k]) => k),
        [{ label: 'CVP', data: cvpCid.map(([, v]) => v), backgroundColor: CORES.slice(4, 4 + cvpCid.length), borderRadius: 4, borderSkipped: false }],
        { legend: { display: false }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { grid: { display: false }, ticks: { font: { size: 9 } } } }, datalabels: DL_BARV });

    mkChart('r-cvp-mes', 'line', mesesLabels,
        [{ label: 'CVP', data: cvpMesArr, borderColor: '#e65100', backgroundColor: 'rgba(230,81,0,.1)', fill: true, tension: .35, pointRadius: 5, borderWidth: 2.5 }],
        { legend: { display: false }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: '#fff3e0' } }, x: { grid: { display: false }, ticks: { font: { size: 10 } } } }, datalabels: DL_LINE });

    const mesMaisCvp = mesesLabels[cvpMesArr.indexOf(Math.max(...cvpMesArr))] || '—';
    const cvpTendencia = cvpMesArr.at(-1) > cvpMesArr.at(-2) ? '📈 alta' : cvpMesArr.at(-1) < cvpMesArr.at(-2) ? '📉 queda' : '➡️ estável';

    document.getElementById('comentario-cvp').innerHTML = `
        <div class="insight ${cvpFilt.length > 20 ? 'perigo' : 'alerta'}">
            <i class="fas fa-mask"></i>
            <span>Foram registradas <strong>${cvpFilt.length} ocorrências de CVP</strong> no período,
            com média de <strong>${cvpMedio} casos/mês</strong>.
            O mês de maior incidência foi <strong>${mesMaisCvp}</strong> com
            <strong>${Math.max(...cvpMesArr)} registro(s)</strong>.
            A tendência do último mês é de <strong>${cvpTendencia}</strong>
            (${cvpMesArr.at(-1)} casos vs ${cvpMesArr.at(-2)} no mês anterior).</span>
        </div>
        ${cvpTip[0] ? `
        <div class="insight">
            <i class="fas fa-list"></i>
            <span>O tipo mais frequente de CVP é <strong>"${cvpTip[0][0]}"</strong>
            com <strong>${cvpTip[0][1]} caso(s)</strong> (${pct(cvpTip[0][1], cvpFilt.length)} do total).
            ${cvpTip[1] ? `O segundo é <strong>"${cvpTip[1][0]}"</strong> com <strong>${cvpTip[1][1]}</strong>.` : ''}</span>
        </div>` : ''}
        <div class="insight">
            <i class="fas fa-map-marker-alt"></i>
            <span>A cidade mais afetada pelo CVP é <strong>${cvpCid[0]?.[0] || 'N/D'}</strong>
            com <strong>${cvpCid[0]?.[1] || 0} caso(s)</strong> (${pct(cvpCid[0]?.[1] || 0, cvpFilt.length)} do total).
            ${cvpCid.length >= 3 ? `As 3 primeiras cidades concentram <strong>${pct(cvpCid.slice(0, 3).reduce((s, [, v]) => s + v, 0), cvpFilt.length)}</strong> dos registros.` : ''}</span>
        </div>`;

    // ════════════════════════════════════════════════════════════════
    // SEÇÃO 5 — SÉRIE TEMPORAL CRUZADA
    // ════════════════════════════════════════════════════════════════
    mkChart('r-temporal-cruzado', 'line', mesesLabels, [
        { label: 'CVLI', data: cvliMesArr, borderColor: '#6a1b9a', backgroundColor: 'rgba(106,27,154,.08)', fill: true, tension: .35, pointRadius: 4, borderWidth: 2.5 },
        { label: 'CVP', data: cvpMesArr, borderColor: '#e65100', backgroundColor: 'rgba(230,81,0,.06)', fill: true, tension: .35, pointRadius: 4, borderWidth: 2.5 },
        { label: 'MVI', data: mviMesArr, borderColor: '#b71c1c', backgroundColor: 'rgba(183,28,28,.06)', fill: true, tension: .35, pointRadius: 4, borderWidth: 2.5 },
    ], {
        legend: { position: 'top', labels: { font: { size: 11 }, padding: 14 } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: '#f0f2f8' } }, x: { grid: { display: false }, ticks: { font: { size: 10 } } } },
        extra: { interaction: { mode: 'index', intersect: false } }, datalabels: DL_LINE
    });

    // Análise de correlação simples
    const cvliTotal12 = cvliMesArr.reduce((a, b) => a + b, 0);
    const cvpTotal12 = cvpMesArr.reduce((a, b) => a + b, 0);
    const mviTotal12 = mviMesArr.reduce((a, b) => a + b, 0);
    const mesCvliPico = mesesLabels[cvliMesArr.indexOf(Math.max(...cvliMesArr))];
    const mesCvpPico = mesesLabels[cvpMesArr.indexOf(Math.max(...cvpMesArr))];
    const crescCvli = cvliMesArr.slice(-3).reduce((a, b) => a + b, 0) > cvliMesArr.slice(0, 3).reduce((a, b) => a + b, 0);

    document.getElementById('comentario-temporal').innerHTML = `
        <div class="insight">
            <i class="fas fa-chart-line"></i>
            <span>Nos últimos 12 meses foram registrados <strong>${cvliTotal12} CVLI</strong>,
            <strong>${cvpTotal12} CVP</strong> e <strong>${mviTotal12} MVI</strong>.
            O pico de CVLI ocorreu em <strong>${mesCvliPico}</strong> e o de CVP em <strong>${mesCvpPico}</strong>.
            ${mesCvliPico === mesCvpPico ? '<strong>⚠️ O mesmo mês concentrou o pico de CVLI e CVP — analisar fatores contextuais.</strong>' : ''}</span>
        </div>
        <div class="insight ${crescCvli ? 'perigo' : 'ok'}">
            <i class="fas fa-arrow-trend-${crescCvli ? 'up' : 'down'}"></i>
            <span>${crescCvli
            ? `⚠️ O CVLI apresenta <strong>tendência de crescimento</strong> nos últimos 3 meses
                   (${cvliMesArr.slice(-3).reduce((a, b) => a + b, 0)} casos) em relação aos primeiros 3 meses do período
                   (${cvliMesArr.slice(0, 3).reduce((a, b) => a + b, 0)} casos). Recomenda-se intensificar ações de inteligência.`
            : `✅ O CVLI apresenta <strong>tendência de queda ou estabilidade</strong> nos últimos 3 meses
                   (${cvliMesArr.slice(-3).reduce((a, b) => a + b, 0)} casos) em relação ao início do período
                   (${cvliMesArr.slice(0, 3).reduce((a, b) => a + b, 0)} casos).`
        }</span>
        </div>`;

    // ════════════════════════════════════════════════════════════════
    // SEÇÃO 6 — VIOLÊNCIA DOMÉSTICA + TCO
    // ════════════════════════════════════════════════════════════════
    const vdMesArr = contarPorMes(vd, meses);
    const tcoMesArr = contarPorMes(tco, meses);

    mkChart('r-vd-mes', 'bar', mesesLabels,
        [{ label: 'Viol. Doméstica', data: vdMesArr, backgroundColor: 'rgba(173,20,87,.7)', borderRadius: 4, borderSkipped: false }],
        { legend: { display: false }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: '#fce4ec' } }, x: { grid: { display: false }, ticks: { font: { size: 9 } } } }, datalabels: DL_BARV });

    mkChart('r-tco-mes', 'bar', mesesLabels,
        [{ label: 'TCO', data: tcoMesArr, backgroundColor: 'rgba(21,101,192,.7)', borderRadius: 4, borderSkipped: false }],
        { legend: { display: false }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: '#e3f2fd' } }, x: { grid: { display: false }, ticks: { font: { size: 9 } } } }, datalabels: DL_BARV });

    const vdMedio = (vd.length / 12).toFixed(1);
    const tcoMedio = (tco.length / 12).toFixed(1);
    const mesMaxVD = mesesLabels[vdMesArr.indexOf(Math.max(...vdMesArr))] || '—';
    const mesMaxTCO = mesesLabels[tcoMesArr.indexOf(Math.max(...tcoMesArr))] || '—';

    document.getElementById('comentario-vd-tco').innerHTML = `
        <div class="insight alerta">
            <i class="fas fa-hand-paper"></i>
            <span>Foram registradas <strong>${vd.length} ocorrências de violência doméstica</strong>
            (média de <strong>${vdMedio}/mês</strong>).
            O mês de maior incidência foi <strong>${mesMaxVD}</strong>
            com <strong>${Math.max(...vdMesArr)} registro(s)</strong>.</span>
        </div>
        <div class="insight">
            <i class="fas fa-file-alt"></i>
            <span>Foram lavrados <strong>${tco.length} Termos Circunstanciados de Ocorrência (TCO)</strong>
            no período (média de <strong>${tcoMedio}/mês</strong>).
            O maior volume ocorreu em <strong>${mesMaxTCO}</strong>
            com <strong>${Math.max(...tcoMesArr)} TCO(s)</strong>.</span>
        </div>`;

    // ════════════════════════════════════════════════════════════════
    // SEÇÃO 7 — ARMAS E DROGAS
    // ════════════════════════════════════════════════════════════════
    const armaTipo = topEntries(contagemTip(arma.map(a => ({ TIPIFICACAO: a.TIPO_ARMA || 'N/D', TIPIFICACAO_GERAL: '' }))));
    mkChart('r-arma-tipo', 'doughnut',
        armaTipo.map(([k]) => k),
        [{ data: armaTipo.map(([, v]) => v), backgroundColor: ['#2e7d32', '#388e3c', '#43a047', '#4caf50', '#66bb6a', '#81c784', '#a5d6a7', '#c8e6c9'], borderWidth: 2, borderColor: '#fff', hoverOffset: 5 }],
        { legend: { position: 'right', labels: { font: { size: 10 }, padding: 10 } }, datalabels: DL_DONUT });

    const drogaTipo = {};
    droga.forEach(d => {
        const t = (d.TIPO_DROGA || d.TIPIFICACAO || 'N/D').trim();
        const qty = parseFloat((d.QUANTIDADE || d.PESO || '0').toString().replace(',', '.'));
        if (!isNaN(qty)) drogaTipo[t] = (drogaTipo[t] || 0) + qty;
    });
    const drogaOrd = Object.entries(drogaTipo).sort((a, b) => b[1] - a[1]).slice(0, 8);
    mkChart('r-droga-tipo', 'bar',
        drogaOrd.map(([k]) => k),
        [{ label: 'Peso (g)', data: drogaOrd.map(([, v]) => +v.toFixed(1)), backgroundColor: '#f57f17', borderRadius: 4, borderSkipped: false }],
        { legend: { display: false }, scales: { y: { beginAtZero: true, title: { display: true, text: 'Gramas', font: { size: 9 } } }, x: { grid: { display: false }, ticks: { font: { size: 9 } } } }, datalabels: DL_BARV });

    const topArma = armaTipo[0] || ['N/D', 0];
    const topDroga = drogaOrd[0] || ['N/D', 0];

    document.getElementById('comentario-materiais').innerHTML = `
        <div class="insight ok">
            <i class="fas fa-gun"></i>
            <span>Foram apreendidas <strong>${arma.length} arma(s)</strong> no período.
            O tipo mais apreendido foi <strong>"${topArma[0]}"</strong>
            com <strong>${topArma[1]} unidade(s)</strong> (${pct(topArma[1], arma.length)} do total).</span>
        </div>
        <div class="insight ok">
            <i class="fas fa-cannabis"></i>
            <span>Total de <strong>${drogaStr}</strong> de drogas apreendidas em ${droga.length} registros.
            A substância de maior volume foi <strong>"${topDroga[0]}"</strong>
            com <strong>${topDroga[1] >= 1000 ? (topDroga[1] / 1000).toFixed(3) + ' kg' : topDroga[1].toFixed(1) + ' g'}</strong>.</span>
        </div>`;

    // ════════════════════════════════════════════════════════════════
    // SEÇÃO 8 — CRUZAMENTO GERAL
    // ════════════════════════════════════════════════════════════════
    // Somatório por cidade de todos os indicadores
    const cidTotal = {};
    [...cvliArr, ...cvpFilt, ...mviArr, ...vd].forEach(i => {
        const c = (i.CIDADE || 'N/D').trim();
        cidTotal[c] = (cidTotal[c] || 0) + 1;
    });
    const cidOrd = Object.entries(cidTotal).sort((a, b) => b[1] - a[1]).slice(0, 10);

    mkChart('r-cidade-geral', 'bar',
        cidOrd.map(([k]) => k),
        [{ label: 'Ocorrências', data: cidOrd.map(([, v]) => v), backgroundColor: CORES.slice(0, cidOrd.length), borderRadius: 4, borderSkipped: false }],
        { legend: { display: false }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { grid: { display: false }, ticks: { font: { size: 9 } } } }, datalabels: DL_BARV });

    // Dia da semana cruzado
    const cvliDia = Array(7).fill(0);
    const cvpDia = Array(7).fill(0);
    cvliArr.forEach(i => { const d = parseDateStr(i.DATA || i.data || ''); if (d) cvliDia[d.getDay()]++; });
    cvpFilt.forEach(i => { const d = parseDateStr(i.DATA || i.data || ''); if (d) cvpDia[d.getDay()]++; });

    mkChart('r-diasemana-cruzado', 'bar', ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'], [
        { label: 'CVLI', data: cvliDia, backgroundColor: 'rgba(106,27,154,.75)', borderRadius: 4 },
        { label: 'CVP', data: cvpDia, backgroundColor: 'rgba(230,81,0,.75)', borderRadius: 4 },
        { label: 'MVI', data: mviDia, backgroundColor: 'rgba(183,28,28,.75)', borderRadius: 4 },
    ], {
        legend: { position: 'top', labels: { font: { size: 10 }, padding: 10 } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { grid: { display: false } } }, datalabels: DL_BARV
    });

    // Tabela CVLI + MVI detalhada
    const tabelaArr = [...cvliArr].sort((a, b) => {
        const da = parseDateStr(a.DATA || a.data || '') || new Date(0);
        const db2 = parseDateStr(b.DATA || b.data || '') || new Date(0);
        return db2 - da;
    });

    const corBadge = item => {
        const t = norm(item.TIPIFICACAO_GERAL || item.TIPIFICACAO || '');
        if (isMVI(item)) return 'badge-mvi';
        if (t.includes('FEMINICIDIO')) return 'badge-vd';
        return 'badge-cvli';
    };

    document.getElementById('tbody-cvli-rel').innerHTML = tabelaArr.slice(0, 40).map(doc => {
        const obito = (doc.OBITO || 'N').toString().trim().toUpperCase();
        const tip = (doc.TIPIFICACAO_GERAL || doc.TIPIFICACAO || '—').trim();
        return `<tr>
            <td><strong>${doc.BOLETIM || '—'}</strong></td>
            <td style="white-space:nowrap">${doc.DATA || doc.data || '—'}</td>
            <td>${doc.HORA || '—'}</td>
            <td><span class="badge ${corBadge(doc)}">${tip.length > 35 ? tip.substring(0, 33) + '…' : tip}</span></td>
            <td>${doc.BAIRRO || doc.bairro || '—'}</td>
            <td>${doc.CIDADE || '—'}</td>
            <td>${doc.SOLICITANTE || '—'}</td>
            <td>${doc.SOLUÇÃO || doc.SOLUCAO || '—'}</td>
            <td style="text-align:center">${obito === 'S' ? '<span class="obito-s">SIM</span>' : '<span class="obito-n">NÃO</span>'}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="9" style="text-align:center;padding:20px;color:#9ea3b5;">Nenhum registro encontrado.</td></tr>';

    // Comentário cruzamento
    const cidMaisOcorr = cidOrd[0] || ['N/D', 0];
    const diaSemCvliMax = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][cvliDia.indexOf(Math.max(...cvliDia))];
    const diaSemCvpMax = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][cvpDia.indexOf(Math.max(...cvpDia))];

    document.getElementById('comentario-cruzamento').innerHTML = `
        <div class="insight">
            <i class="fas fa-map-marker-alt"></i>
            <span>A cidade de maior incidência geral (CVLI + CVP + MVI + VD) é
            <strong>${cidMaisOcorr[0]}</strong> com <strong>${cidMaisOcorr[1]} ocorrência(s)</strong>
            (${pct(cidMaisOcorr[1], cidOrd.reduce((s, [, v]) => s + v, 0))} do total).
            ${cidOrd.length >= 3 ? `As 3 principais cidades concentram <strong>${pct(cidOrd.slice(0, 3).reduce((s, [, v]) => s + v, 0), cidOrd.reduce((s, [, v]) => s + v, 0))}</strong> de todas as ocorrências.` : ''}</span>
        </div>
        <div class="insight">
            <i class="fas fa-calendar-week"></i>
            <span>O dia da semana com maior concentração de CVLI é <strong>${diaSemCvliMax}</strong>
            e de CVP é <strong>${diaSemCvpMax}</strong>.
            ${diaSemCvliMax === diaSemCvpMax ? '⚠️ O mesmo dia concentra o pico de CVLI e CVP — considerar reforço de efetivo nesse dia.' : 'Os picos de CVLI e CVP ocorrem em dias distintos, permitindo planejamento diferenciado.'}</span>
        </div>
        <div class="insight">
            <i class="fas fa-table"></i>
            <span>A tabela exibe os <strong>${Math.min(40, tabelaArr.length)} registros mais recentes de CVLI</strong>
            (de um total de <strong>${cvliArr.length}</strong>). Registros classificados como MVI
            estão destacados em vermelho.</span>
        </div>`;

    // ════════════════════════════════════════════════════════════════
    // SEÇÃO 9 — VD · SOSSEGO · VISITAS
    // ════════════════════════════════════════════════════════════════
    (function () {
        const mkBar = (id, data, cor, corAlpha) => {
            const ctx = document.getElementById(id)?.getContext('2d');
            if (!ctx) return;
            new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: mesesLabels, datasets: [{
                        data, backgroundColor: corAlpha,
                        borderColor: cor, borderWidth: 1.5, borderRadius: 4, borderSkipped: false
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        datalabels: {
                            display: ctx => ctx.dataset.data[ctx.dataIndex] > 0,
                            anchor: 'end', align: 'top',
                            font: { size: 9, weight: 'bold' }, color: cor,
                            formatter: v => v
                        }
                    },
                    scales: {
                        y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: '#f0f2f8' } },
                        x: { grid: { display: false }, ticks: { font: { size: 9 } } }
                    }
                }
            });
        };

        const vdMes2 = contarPorMes(vd, meses);
        const sossMes = contarPorMes(sossego, meses);
        const visMes = contarPorMes(visitas, meses);

        mkBar('r-vd-mes2', vdMes2, '#ad1457', 'rgba(173,20,87,.65)');
        mkBar('r-soss-mes', sossMes, '#00695c', 'rgba(0,105,92,.65)');
        mkBar('r-visitas-mes', visMes, '#00796b', 'rgba(0,121,107,.65)');

        // Visitas por cidade
        const cidVis = {};
        visitas.forEach(i => { const c = (i.CIDADE || 'N/D').trim(); cidVis[c] = (cidVis[c] || 0) + 1; });
        const cidVisOrd = Object.entries(cidVis).sort((a, b) => b[1] - a[1]).slice(0, 8);
        const ctxCid = document.getElementById('r-visitas-cidade')?.getContext('2d');
        if (ctxCid && cidVisOrd.length) {
            new Chart(ctxCid, {
                type: 'doughnut',
                data: {
                    labels: cidVisOrd.map(([k]) => k), datasets: [{
                        data: cidVisOrd.map(([, v]) => v),
                        backgroundColor: ['#00796b', '#00897b', '#009688', '#26a69a', '#4db6ac', '#80cbc4', '#b2dfdb', '#e0f2f1'],
                        borderWidth: 2, borderColor: '#fff', hoverOffset: 5
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'right', labels: {
                            font: { size: 10 }, padding: 8,
                            generateLabels: chart => {
                                const ds = chart.data.datasets[0];
                                return chart.data.labels.map((lbl, i) => ({
                                    text: lbl + ' (' + ds.data[i] + ')',
                                    fillStyle: ds.backgroundColor[i], hidden: false, index: i
                                }));
                            }
                        }},
                        datalabels: DL_DONUT
                    }
                }
            });
        }

        // Comentário analítico
        const mesMaxVD2 = mesesLabels[vdMes2.indexOf(Math.max(...vdMes2))] || '—';
        const mesMaxSoss = mesesLabels[sossMes.indexOf(Math.max(...sossMes))] || '—';
        const mesMaxVis = mesesLabels[visMes.indexOf(Math.max(...visMes))] || '—';
        const topCidVis = cidVisOrd[0] || ['N/D', 0];
        const vdTend = vdMes2.at(-1) > vdMes2.at(-2) ? '📈 alta' : vdMes2.at(-1) < vdMes2.at(-2) ? '📉 queda' : '➡️ estável';

        document.getElementById('comentario-social').innerHTML = `
            <div class="insight ${vd.length > 0 ? 'alerta' : 'ok'}">
                <i class="fas fa-hand-paper"></i>
                <span>Foram registradas <strong>${vd.length} ocorrência(s) de violência doméstica</strong>
                no período (média de <strong>${(vd.length / 12).toFixed(1)}/mês</strong>).
                O mês de maior incidência foi <strong>${mesMaxVD2}</strong> com
                <strong>${Math.max(...vdMes2)} registro(s)</strong>.
                Tendência do último mês: <strong>${vdTend}</strong>.</span>
            </div>
            <div class="insight">
                <i class="fas fa-volume-high"></i>
                <span>Registradas <strong>${sossego.length} perturbação(ões) do sossego</strong>
                (pico em <strong>${mesMaxSoss}</strong> com <strong>${Math.max(...sossMes)}</strong> ocorrências).
                </span>
            </div>
            <div class="insight ok">
                <i class="fas fa-house-user"></i>
                <span>Realizadas <strong>${visitas.length} visita(s) orientativa(s)</strong> no período
                (pico em <strong>${mesMaxVis}</strong> com <strong>${Math.max(...visMes)}</strong> visitas).
                ${topCidVis[0] !== 'N/D' ? `A cidade com mais visitas é <strong>${topCidVis[0]}</strong>
                com <strong>${topCidVis[1]}</strong> visita(s).` : ''}</span>
            </div>`;
    })();

    // ── Exibe o relatório ─────────────────────────────────────────
    document.getElementById('loader').style.display = 'none';
    document.getElementById('relatorio').style.display = 'block';
});