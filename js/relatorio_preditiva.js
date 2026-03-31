// ═══════════════════════════════════════════════════════════════════
// RELATÓRIO — Análise Preditiva P3
// Lê dados do localStorage: chave 'p3_preditiva'
// ═══════════════════════════════════════════════════════════════════
Chart.register(ChartDataLabels);

// ── Utilitários ──────────────────────────────────────────────────
function pct(v, t) { return t ? Math.round(v / t * 100) + '%' : '0%'; }

function parseDateStr(str) {
    if (!str || str === '---') return null;
    str = str.toString().trim().substring(0, 10);
    const mBR  = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (mBR)  return new Date(+mBR[3], +mBR[2] - 1, +mBR[1]);
    const mISO = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (mISO) return new Date(+mISO[1], +mISO[2] - 1, +mISO[3]);
    return null;
}

function toISO(str) {
    if (!str || str === '---') return '';
    str = str.toString().trim().substring(0, 10);
    if (str.includes('/')) {
        const [d, m, a] = str.split('/');
        return `${a}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    }
    return str;
}

// ── Modelos estatísticos ─────────────────────────────────────────
function regressaoLinear(arr) {
    const n = arr.length;
    if (n < 2) return arr[0] ?? 0;
    let sx=0, sy=0, sxy=0, sx2=0;
    arr.forEach((v,i) => { sx+=i; sy+=v; sxy+=i*v; sx2+=i*i; });
    const d = n*sx2 - sx*sx;
    const m = d ? (n*sxy - sx*sy)/d : 0;
    const b = (sy - m*sx)/n;
    return Math.round(Math.max(0, m*n + b));
}
function mediaPonderada(arr) {
    const u = arr.slice(-3);
    if (!u.length) return 0;
    const p = [1,2,3].slice(3-u.length);
    return Math.round(u.reduce((a,v,i)=>a+v*p[i],0) / p.reduce((a,v)=>a+v,0));
}
function prever(arr) { return Math.round(mediaPonderada(arr)*0.6 + regressaoLinear(arr)*0.4); }

// ── Gráfico helper ────────────────────────────────────────────────
function mkChart(id, type, labels, datasets, opts = {}) {
    const ctx = document.getElementById(id)?.getContext('2d');
    if (!ctx) return;
    new Chart(ctx, {
        type,
        data: { labels, datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: opts.legend ?? { position:'bottom', labels:{ font:{size:10}, padding:10 } },
                tooltip: { callbacks: { label: c => ` ${c.dataset.label||c.label}: ${c.parsed.y??c.parsed}` } },
                datalabels: opts.datalabels ?? false
            },
            scales: opts.scales,
            ...(opts.extra || {})
        }
    });
}

const DL_BARH = { display:true, anchor:'end', align:'end', font:{size:9,weight:'bold'}, color:'#374263', formatter:v=>v };
const DL_BARV = { display: ctx => ctx.dataset.data[ctx.dataIndex] > 0, anchor:'end', align:'top', font:{size:9,weight:'bold'}, color:'#374263', formatter:v=>v };
const DL_LINE = { display: ctx => ctx.dataset.data[ctx.dataIndex] > 0, align:'top', anchor:'end', font:{size:8,weight:'bold'}, color: ctx => ctx.dataset.borderColor, formatter:v=>v };

// ── Heatmap de horas ──────────────────────────────────────────────
function renderHeatmap(id, contagens, r, g, b) {
    const max = Math.max(...contagens, 1);
    const el  = document.getElementById(id);
    if (!el) return;
    el.innerHTML = contagens.map((v, h) => {
        const alpha = v === 0 ? 0 : Math.min(1, (v / max) * 1.3);
        const bg    = v === 0 ? '#e9ecef' : `rgba(${r},${g},${b},${alpha})`;
        const cor   = v === 0 ? '#aaa' : alpha > 0.5 ? '#fff' : '#333';
        return `<div class="hora-cel" style="background:${bg};color:${cor};font-size:.6rem;"
            title="${h}h — ${v} ocorrência(s)">${h}h</div>`;
    }).join('');
}

// ── Hotspot tabela ────────────────────────────────────────────────
function renderHotspot(tbodyId, mapa, total) {
    const top = Object.entries(mapa).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const max = top[0]?.[1] || 1;
    const el  = document.getElementById(tbodyId);
    if (!el) return;
    el.innerHTML = top.map(([chave, cnt], i) => {
        const [cidade, bairro] = chave.split('||');
        const p = total ? Math.round(cnt/total*100) : 0;
        const cls = p>=20?'alto':p>=8?'medio':'baixo';
        const lbl = {alto:'Alto',medio:'Médio',baixo:'Baixo'}[cls];
        return `<tr>
            <td style="color:#9ea3b5;font-size:.72rem;font-weight:bold">${i+1}</td>
            <td>${cidade||'N/D'}</td>
            <td><strong>${bairro||'N/D'}</strong></td>
            <td><strong>${cnt}</strong></td>
            <td><span class="badge-risco risco-${cls}">${lbl}</span></td>
        </tr>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════════════════
// INICIALIZAÇÃO
// ═══════════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
    const raw = localStorage.getItem('p3_preditiva');
    if (!raw) {
        document.getElementById('loader').innerHTML =
            '<i class="fas fa-exclamation-triangle" style="color:#b71c1c;font-size:2rem;display:block;margin-bottom:12px;"></i>' +
            'Dados não encontrados.<br><small>Abra este relatório pelo botão <strong>"Imprimir Relatório"</strong> na página de Análise Preditiva.</small>';
        return;
    }

    const D = JSON.parse(raw);
    const { arrCVP, arrCVLI, arrMVI, meses12, labels12, cvpArr, cvliArr, mviArr } = D;

    // ── Metadados ─────────────────────────────────────────────────
    const agora    = new Date();
    const geradoEm = agora.toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' })
                   + ' às ' + agora.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });

    document.getElementById('meta-data').innerHTML     = `<i class="fas fa-calendar"></i> ${geradoEm}`;
    document.getElementById('meta-operador').innerHTML = `<i class="fas fa-user"></i> ${D.operador || '—'}`;
    document.getElementById('rodape-meta').innerHTML   = `Gerado em: ${geradoEm}<br>Operador: ${D.operador||'—'}`;
    document.title = `Relatório Preditivo P3 — ${agora.toLocaleDateString('pt-BR')}`;

    const mesAtual  = agora.getMonth();
    const anoAtual  = agora.getFullYear();
    const proxMes   = new Date(anoAtual, mesAtual + 1, 1);
    const NOMES     = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    document.getElementById('prev-prox-mes').textContent = NOMES[proxMes.getMonth()];

    // ── Contagens auxiliares ──────────────────────────────────────
    const mesAtualIdx = labels12.length - 1;
    const mesAntIdx   = labels12.length - 2;

    const cvpMes  = cvpArr[mesAtualIdx]  || 0;
    const cvliMes = cvliArr[mesAtualIdx] || 0;
    const mviMes  = mviArr[mesAtualIdx]  || 0;
    const cvpAnt  = cvpArr[mesAntIdx]    || 0;
    const cvliAnt = cvliArr[mesAntIdx]   || 0;
    const mviAnt  = mviArr[mesAntIdx]    || 0;

    const media = arr => {
        const pos = arr.filter(v=>v>0);
        return pos.length ? Math.round(pos.reduce((a,b)=>a+b,0)/pos.length) : 0;
    };

    // ── SEÇÃO 1 — KPIs ────────────────────────────────────────────
    function deltaBadge(atual, ant) {
        if (!ant) return '';
        const d = atual - ant;
        const p = Math.round(d/ant*100);
        if (d > 0) return `<span style="font-size:.7rem;color:#b71c1c;font-weight:bold">▲ +${p}% vs mês ant.</span>`;
        if (d < 0) return `<span style="font-size:.7rem;color:#2e7d32;font-weight:bold">▼ ${p}% vs mês ant.</span>`;
        return `<span style="font-size:.7rem;color:#9ea3b5;">= igual</span>`;
    }

    document.getElementById('kpi-grid').innerHTML = `
        <div class="kpi cvli">
            <div class="kpi-valor">${arrCVLI.length}</div>
            <div class="kpi-pct">Média: ${media(cvliArr)}/mês</div>
            <div class="kpi-label"><i class="fas fa-skull"></i> CVLI Total</div>
        </div>
        <div class="kpi cvp">
            <div class="kpi-valor">${arrCVP.length}</div>
            <div class="kpi-pct">Média: ${media(cvpArr)}/mês</div>
            <div class="kpi-label"><i class="fas fa-mask"></i> CVP Total</div>
        </div>
        <div class="kpi mvi">
            <div class="kpi-valor">${arrMVI.length}</div>
            <div class="kpi-pct">Média: ${media(mviArr)}/mês</div>
            <div class="kpi-label"><i class="fas fa-skull-crossbones"></i> MVI Total</div>
        </div>
        <div class="kpi cvli">
            <div class="kpi-valor">${cvliMes}</div>
            <div class="kpi-pct">${deltaBadge(cvliMes, cvliAnt)}</div>
            <div class="kpi-label">CVLI Mês Atual</div>
        </div>
        <div class="kpi cvp">
            <div class="kpi-valor">${cvpMes}</div>
            <div class="kpi-pct">${deltaBadge(cvpMes, cvpAnt)}</div>
            <div class="kpi-label">CVP Mês Atual</div>
        </div>
        <div class="kpi mvi">
            <div class="kpi-valor">${mviMes}</div>
            <div class="kpi-pct">${deltaBadge(mviMes, mviAnt)}</div>
            <div class="kpi-label">MVI Mês Atual</div>
        </div>`;

    // Alertas gerados pelo modelo
    function gerarAlerta(ind, arr, atual, ant, cor, icone) {
        const prev = prever(arr);
        if (atual > ant * 1.2) return `<div class="insight perigo"><i class="${icone}"></i><span><strong>${ind} em alta ▲</strong> — Mês atual (${atual}) supera o anterior (${ant}) em mais de 20%. Previsão próximo mês: <strong>${prev}</strong>. Recomenda-se intensificar ações preventivas.</span></div>`;
        if (atual === 0)       return `<div class="insight ok"><i class="${icone}"></i><span><strong>${ind}: nenhum caso</strong> no mês atual. Previsão próximo mês: <strong>${prev}</strong>.</span></div>`;
        if (atual < ant)       return `<div class="insight ok"><i class="${icone}"></i><span><strong>${ind} em queda ▼</strong> — Mês atual (${atual}) abaixo do anterior (${ant}). Previsão: <strong>${prev}</strong>.</span></div>`;
        return `<div class="insight"><i class="${icone}"></i><span><strong>${ind} estável</strong> — Mês atual: ${atual} | Anterior: ${ant} | Previsão: <strong>${prev}</strong>.</span></div>`;
    }
    document.getElementById('alertas-rel').innerHTML =
        gerarAlerta('CVP',  cvpArr,  cvpMes,  cvpAnt,  '#e65100', 'fas fa-mask') +
        gerarAlerta('CVLI', cvliArr, cvliMes, cvliAnt, '#6a1b9a', 'fas fa-skull') +
        gerarAlerta('MVI',  mviArr,  mviMes,  mviAnt,  '#b71c1c', 'fas fa-skull-crossbones');

    // ── SEÇÃO 2 — PREVISÕES ───────────────────────────────────────
    document.getElementById('p-cvp').textContent  = prever(cvpArr);
    document.getElementById('p-cvli').textContent = prever(cvliArr);
    document.getElementById('p-mvi').textContent  = prever(mviArr);

    const prevAtualCVP  = prever(cvpArr.slice(0,-1));
    const prevAtualCVLI = prever(cvliArr.slice(0,-1));
    const prevAtualMVI  = prever(mviArr.slice(0,-1));

    function prevRealRow(label, prev, real, cor) {
        const diff = real - prev;
        const cls  = diff > 0 ? `color:#b71c1c;` : diff < 0 ? `color:#2e7d32;` : `color:#9ea3b5;`;
        const seta = diff > 0 ? `▲ +${diff} acima` : diff < 0 ? `▼ ${diff} abaixo` : '= conforme';
        return `<div style="display:flex;align-items:center;justify-content:space-between;background:#f8f9ff;border-radius:6px;padding:.5rem .75rem;">
            <span style="font-size:.83rem;font-weight:bold;color:${cor}">${label}</span>
            <span style="font-size:.8rem;color:#9ea3b5;">Est.: <strong>${prev}</strong> → Real: <strong style="color:${cor}">${real}</strong></span>
            <span style="font-size:.78rem;font-weight:bold;${cls}">${seta}</span>
        </div>`;
    }
    document.getElementById('prev-real-grid').innerHTML =
        prevRealRow('CVP',  prevAtualCVP,  cvpMes,  '#e65100') +
        prevRealRow('CVLI', prevAtualCVLI, cvliMes, '#6a1b9a') +
        prevRealRow('MVI',  prevAtualMVI,  mviMes,  '#b71c1c');

    const cvliTrend = cvliArr.slice(-3).reduce((a,b)=>a+b,0) > cvliArr.slice(0,3).reduce((a,b)=>a+b,0);
    document.getElementById('comentario-previsao').innerHTML = `
        <div class="insight">
            <i class="fas fa-brain"></i>
            <span>O modelo utiliza <strong>média ponderada dos últimos 3 meses</strong> (pesos crescentes: 1·2·3) combinada com
            <strong>regressão linear</strong> para capturar a tendência. O resultado é: 60% ponderada + 40% tendência.</span>
        </div>
        <div class="insight ${cvliTrend ? 'perigo' : 'ok'}">
            <i class="fas fa-arrow-trend-${cvliTrend?'up':'down'}"></i>
            <span>O CVLI apresenta tendência de <strong>${cvliTrend ? 'crescimento ▲' : 'queda ou estabilidade ▼'}</strong>
            nos últimos 3 meses (${cvliArr.slice(-3).reduce((a,b)=>a+b,0)} casos)
            vs os primeiros 3 do período (${cvliArr.slice(0,3).reduce((a,b)=>a+b,0)} casos).</span>
        </div>`;

    // ── SEÇÃO 3 — SÉRIE TEMPORAL ──────────────────────────────────
    mkChart('r-temporal', 'line', labels12, [
        { label:'CVLI', data:cvliArr, borderColor:'#6a1b9a', backgroundColor:'rgba(106,27,154,.08)', fill:true, tension:.35, pointRadius:5, borderWidth:2.5 },
        { label:'CVP',  data:cvpArr,  borderColor:'#e65100', backgroundColor:'rgba(230,81,0,.06)',   fill:true, tension:.35, pointRadius:5, borderWidth:2.5 },
        { label:'MVI',  data:mviArr,  borderColor:'#b71c1c', backgroundColor:'rgba(183,28,28,.06)',  fill:true, tension:.35, pointRadius:5, borderWidth:2.5 },
    ], {
        legend:{ position:'top', labels:{ font:{size:11}, padding:14 } },
        scales:{ y:{beginAtZero:true,ticks:{stepSize:1}}, x:{grid:{display:false}} },
        extra:{ interaction:{ mode:'index', intersect:false } },
        datalabels: DL_LINE
    });

    mkChart('r-cvli-mes', 'line', labels12,
        [{ label:'CVLI', data:cvliArr, borderColor:'#6a1b9a', backgroundColor:'rgba(106,27,154,.1)', fill:true, tension:.35, pointRadius:4, borderWidth:2 }],
        { legend:{display:false}, scales:{y:{beginAtZero:true,ticks:{stepSize:1}},x:{grid:{display:false},ticks:{font:{size:9}}}}, datalabels: DL_LINE });

    mkChart('r-cvp-mes', 'line', labels12,
        [{ label:'CVP', data:cvpArr, borderColor:'#e65100', backgroundColor:'rgba(230,81,0,.1)', fill:true, tension:.35, pointRadius:4, borderWidth:2 }],
        { legend:{display:false}, scales:{y:{beginAtZero:true,ticks:{stepSize:1}},x:{grid:{display:false},ticks:{font:{size:9}}}}, datalabels: DL_LINE });

    const mesPicoCVLI = labels12[cvliArr.indexOf(Math.max(...cvliArr))] || '—';
    const mesPicoCVP  = labels12[cvpArr.indexOf(Math.max(...cvpArr))]   || '—';
    document.getElementById('comentario-temporal').innerHTML = `
        <div class="insight">
            <i class="fas fa-chart-line"></i>
            <span>Nos últimos 12 meses: <strong>${arrCVLI.length} CVLI</strong> (pico em ${mesPicoCVLI}),
            <strong>${arrCVP.length} CVP</strong> (pico em ${mesPicoCVP}),
            <strong>${arrMVI.length} MVI</strong>.</span>
        </div>`;

    // ── SEÇÃO 4 — TIPIFICAÇÕES ────────────────────────────────────
    function contarTip(arr) {
        const cnt = {};
        arr.forEach(i => {
            const t = (i.TIPIFICACAO_GERAL || i.TIPIFICACAO || 'N/D').trim();
            cnt[t] = (cnt[t]||0)+1;
        });
        return Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,8);
    }

    const tipCVLI = contarTip(arrCVLI);
    const tipCVP  = contarTip(arrCVP);
    const tipMVI  = contarTip(arrMVI);

    const barHOpts = (cor) => ({
        legend:{display:false},
        scales:{ x:{beginAtZero:true,ticks:{stepSize:1}}, y:{grid:{display:false},ticks:{font:{size:9}}} },
        extra:{ indexAxis:'y' },
        datalabels: { ...DL_BARH, color: cor }
    });

    mkChart('r-tip-cvli','bar', tipCVLI.map(([k])=>k.length>28?k.substring(0,26)+'…':k), [{ data:tipCVLI.map(([,v])=>v), backgroundColor:'#6a1b9a', borderRadius:4, borderSkipped:false }], barHOpts('#4a148c'));
    mkChart('r-tip-cvp', 'bar', tipCVP.map(([k])=>k.length>28?k.substring(0,26)+'…':k),  [{ data:tipCVP.map(([,v])=>v),  backgroundColor:'#e65100', borderRadius:4, borderSkipped:false }], barHOpts('#bf360c'));
    mkChart('r-tip-mvi', 'bar', tipMVI.map(([k])=>k.length>28?k.substring(0,26)+'…':k),  [{ data:tipMVI.map(([,v])=>v),  backgroundColor:'#b71c1c', borderRadius:4, borderSkipped:false }], barHOpts('#7f0000'));

    document.getElementById('comentario-tipificacoes').innerHTML = `
        <div class="insight">
            <i class="fas fa-list"></i>
            <span>CVLI: tipificação mais frequente <strong>"${tipCVLI[0]?.[0]||'N/D'}"</strong> (${tipCVLI[0]?.[1]||0} casos).
            CVP: <strong>"${tipCVP[0]?.[0]||'N/D'}"</strong> (${tipCVP[0]?.[1]||0} casos).
            MVI: <strong>"${tipMVI[0]?.[0]||'N/D'}"</strong> (${tipMVI[0]?.[1]||0} casos).</span>
        </div>`;

    // ── SEÇÃO 5 — HOTSPOTS ────────────────────────────────────────
    function mapaLocalidade(arr) {
        const m = {};
        arr.forEach(r => {
            const c = (r.CIDADE||'N/D').trim();
            const b = (r.BAIRRO||'N/D').trim();
            const k = `${c}||${b}`;
            m[k] = (m[k]||0)+1;
        });
        return m;
    }
    renderHotspot('tbody-hotspot-cvli', mapaLocalidade(arrCVLI), arrCVLI.length);
    renderHotspot('tbody-hotspot-cvp',  mapaLocalidade(arrCVP),  arrCVP.length);
    renderHotspot('tbody-hotspot-mvi',  mapaLocalidade(arrMVI),  arrMVI.length);

    function topCidade(arr) {
        const m = {};
        arr.forEach(i => { const c=(i.CIDADE||'N/D').trim(); m[c]=(m[c]||0)+1; });
        return Object.entries(m).sort((a,b)=>b[1]-a[1])[0] || ['N/D',0];
    }
    document.getElementById('comentario-hotspots').innerHTML = `
        <div class="insight">
            <i class="fas fa-map-marker-alt"></i>
            <span>Cidade com maior CVLI: <strong>${topCidade(arrCVLI)[0]}</strong> (${topCidade(arrCVLI)[1]} casos).
            Maior CVP: <strong>${topCidade(arrCVP)[0]}</strong> (${topCidade(arrCVP)[1]} casos).
            Maior MVI: <strong>${topCidade(arrMVI)[0]}</strong> (${topCidade(arrMVI)[1]} casos).</span>
        </div>`;

    // ── SEÇÃO 6 — HEATMAPS ────────────────────────────────────────
    function horaArr(arr) {
        const c = Array(24).fill(0);
        arr.forEach(i => {
            const h = parseInt((i.HORA||'00:00').split(':')[0]);
            if (!isNaN(h) && h>=0 && h<24) c[h]++;
        });
        return c;
    }
    renderHeatmap('r-horas-cvp',  horaArr(arrCVP),  230, 81,  0);
    renderHeatmap('r-horas-cvli', horaArr(arrCVLI), 106, 27,  154);
    renderHeatmap('r-horas-mvi',  horaArr(arrMVI),  183, 28,  28);

    const picoCVP  = horaArr(arrCVP).indexOf(Math.max(...horaArr(arrCVP)));
    const picoCVLI = horaArr(arrCVLI).indexOf(Math.max(...horaArr(arrCVLI)));
    document.getElementById('comentario-horas').innerHTML = `
        <div class="insight">
            <i class="fas fa-clock"></i>
            <span>Horário de pico CVP: <strong>${picoCVP}h</strong>.
            Horário de pico CVLI: <strong>${picoCVLI}h</strong>.
            Esses dados orientam o planejamento de policiamento ostensivo.</span>
        </div>`;

    // ── SEÇÃO 7 — DIA DA SEMANA ───────────────────────────────────
    const dias = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    function diaArr(arr) {
        const c = Array(7).fill(0);
        arr.forEach(i => { const d = parseDateStr(i.DATA||i.data||''); if(d) c[d.getDay()]++; });
        return c;
    }
    const dCVLI = diaArr(arrCVLI);
    const dCVP  = diaArr(arrCVP);
    const dMVI  = diaArr(arrMVI);

    mkChart('r-diasemana', 'bar', dias, [
        { label:'CVLI', data:dCVLI, backgroundColor:'rgba(106,27,154,.75)', borderRadius:4 },
        { label:'CVP',  data:dCVP,  backgroundColor:'rgba(230,81,0,.75)',   borderRadius:4 },
        { label:'MVI',  data:dMVI,  backgroundColor:'rgba(183,28,28,.75)',  borderRadius:4 },
    ], {
        legend:{ position:'top', labels:{font:{size:10},padding:12} },
        scales:{ y:{beginAtZero:true,ticks:{stepSize:1}}, x:{grid:{display:false}} },
        datalabels: { display: ctx => ctx.dataset.data[ctx.dataIndex] > 0, anchor:'end', align:'top', font:{size:9,weight:'bold'}, color: ctx => ctx.dataset.backgroundColor.replace('.75','1'), formatter: v => v }
    });

    const diaMaisCVLI = dias[dCVLI.indexOf(Math.max(...dCVLI))];
    const diaMaisCVP  = dias[dCVP.indexOf(Math.max(...dCVP))];
    document.getElementById('comentario-diasemana').innerHTML = `
        <div class="insight">
            <i class="fas fa-calendar-week"></i>
            <span>Maior concentração CVLI: <strong>${diaMaisCVLI}</strong>.
            Maior concentração CVP: <strong>${diaMaisCVP}</strong>.
            ${diaMaisCVLI === diaMaisCVP ? '⚠️ O mesmo dia concentra o pico de CVLI e CVP — considerar reforço de efetivo.' : 'Os picos de CVLI e CVP ocorrem em dias diferentes — planejamento diferenciado possível.'}</span>
        </div>`;

    // ── Exibe relatório ───────────────────────────────────────────
    document.getElementById('loader').style.display = 'none';
    document.getElementById('relatorio').style.display = 'block';
});