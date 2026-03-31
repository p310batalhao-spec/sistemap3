
// ═══════════════════════════════════════════════════════════════════
// RELATÓRIO PÚBLICO P3 — busca dados direto do Firebase
// Sem login · Sem localStorage · Compartilhável por link
// ═══════════════════════════════════════════════════════════════════

const FB = 'https://sistema-p3-default-rtdb.firebaseio.com';

// ── Utilitários ──────────────────────────────────────────────────
const norm = s => (s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();

const toISO = str => {
    if (!str) return '';
    str = str.toString().trim().substring(0,10);
    if (str.includes('/')) { const [d,m,a]=str.split('/'); return `${a}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`; }
    return str;
};

const parseDateStr = str => {
    const iso = toISO(str);
    if (!iso) return null;
    const [a,m,d] = iso.split('-');
    return new Date(+a, +m-1, +d);
};

const parsePeso = i => { const v=parseFloat((i.QUANTIDADE||i.PESO||'0').toString().replace(',','.')); return isNaN(v)?0:v; };
const fmtPeso  = g => g>=1000 ? (g/1000).toFixed(2)+' kg' : g.toFixed(1)+' g';

// ── Classificadores ──────────────────────────────────────────────
const ehTipoCVLI = t => t.includes('HOMICIDIO')||t.includes('FEMINICIDIO')||t.includes('LATROCINIO');

const isMVI = item => {
    const t = norm((item.TIPIFICACAO_GERAL||'') + ' ' + (item.TIPIFICACAO||''));
    const o = norm(item.OBITO||'');
    if (t.includes('ACHADO')||t.includes('SUICIDIO')||t.includes('VIOLACAO')) return false;
    if (t.includes('TENTATIVA')) return ehTipoCVLI(t) && o==='S';
    return ehTipoCVLI(t);
};

const isCVLI = item => {
    const t = norm((item.TIPIFICACAO_GERAL||'') + ' ' + (item.TIPIFICACAO||''));
    if (t.includes('ACHADO')||t.includes('SUICIDIO')||t.includes('VIOLACAO')) return false;
    if (t.includes('TENTATIVA')) return ehTipoCVLI(t);
    return ehTipoCVLI(t);
};

const isCVP = item => {
    const t = norm((item.TIPIFICACAO_GERAL||'') + ' ' + (item.TIPIFICACAO||''));
    const o = norm(item.OBITO||'');
    if (t.includes('APOIO')||t.includes('OUTRAS')) return false;
    if (t.includes('TENTATIVA')&&o==='S') return false;
    return t.includes('ROUBO')||t.includes('EXTORSAO')||t.includes('LATROCINIO');
};

// ── Período: aceita ?periodo=AAAA ou ?ini=AAAA-MM-DD&fim=AAAA-MM-DD na URL ──
function getPeriodo() {
    const p = new URLSearchParams(location.search);
    const ano = p.get('ano');
    const ini = p.get('ini');
    const fim = p.get('fim');
    const anoAtual = new Date().getFullYear();

    if (ini || fim) {
        return {
            label: `${ini||'…'} → ${fim||'…'}`,
            filtro: item => {
                const d = toISO(item.DATA||item.data||'');
                if (ini && d && d < ini) return false;
                if (fim && d && d > fim) return false;
                return true;
            }
        };
    }
    const a = ano ? parseInt(ano) : anoAtual;
    return {
        label: `Ano ${a}`,
        filtro: item => {
            const d = parseDateStr(item.DATA||item.data||'');
            return d ? d.getFullYear() === a : false;
        }
    };
}

// ── Fetch ─────────────────────────────────────────────────────────
async function fetchNo(no) {
    const r = await fetch(`${FB}/${no}.json`);
    const d = await r.json();
    if (!d) return [];
    return Object.keys(d).map(id => ({id, ...d[id]}));
}

// ── Série temporal helpers ────────────────────────────────────────
function buildMeses12() {
    const agora = new Date();
    const meses = [];
    for (let i=11; i>=0; i--) {
        const d = new Date(agora.getFullYear(), agora.getMonth()-i, 1);
        meses.push({
            label: d.toLocaleDateString('pt-BR',{month:'short',year:'2-digit'}),
            chave: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
        });
    }
    return meses;
}

function contarMes(arr, meses) {
    const cnt = {};
    arr.forEach(i => {
        const iso = toISO(i.DATA||i.data||'');
        if (iso.length>=7) { const c=iso.substring(0,7); cnt[c]=(cnt[c]||0)+1; }
    });
    return meses.map(m => cnt[m.chave]||0);
}

function pesoMes(arr, meses) {
    const cnt = {};
    arr.forEach(i => {
        const iso = toISO(i.DATA||i.data||'');
        if (iso.length>=7) { const c=iso.substring(0,7); cnt[c]=(cnt[c]||0)+parsePeso(i); }
    });
    return meses.map(m => +((cnt[m.chave]||0).toFixed(2)));
}

// ── Gráfico helpers ───────────────────────────────────────────────
Chart.register(ChartDataLabels);
const CHARTS = {};
function mkBar(id, labels, data, cor, opts={}) {
    const ctx = document.getElementById(id)?.getContext('2d');
    if (!ctx) return;
    if (CHARTS[id]) CHARTS[id].destroy();
    // Rótulo formatado para barras de peso
    const dlFormatter = opts.tooltipFn
        ? (v) => { const fake = opts.horizontal ? {parsed:{x:v}} : {parsed:{y:v}}; return opts.tooltipFn(fake).trim(); }
        : (v) => v > 0 ? v : '';
    CHARTS[id] = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ data,
            backgroundColor: Array.isArray(cor) ? cor : cor,
            borderRadius: 4, borderSkipped: false,
            borderColor: Array.isArray(cor) ? cor : cor, borderWidth: 0
        }]},
        options: {
            indexAxis: opts.horizontal ? 'y' : 'x',
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: opts.tooltipFn || (c => ` ${c.parsed.y??c.parsed.x}`) } },
                datalabels: {
                    display: ctx => ctx.dataset.data[ctx.dataIndex] > 0,
                    anchor: opts.horizontal ? 'end' : 'end',
                    align:  opts.horizontal ? 'end' : 'top',
                    font: { size: 9, weight: 'bold' },
                    color: '#374263',
                    formatter: dlFormatter
                }
            },
            scales: {
                x: { beginAtZero: true, grid: { display: !opts.horizontal }, ticks: { font:{size:9} } },
                y: { beginAtZero: !opts.horizontal || false, grid: { display: opts.horizontal }, ticks: { font:{size:9} } }
            }
        }
    });
}

function mkLine(id, meses, datasets) {
    const ctx = document.getElementById(id)?.getContext('2d');
    if (!ctx) return;
    if (CHARTS[id]) CHARTS[id].destroy();
    CHARTS[id] = new Chart(ctx, {
        type: 'line',
        data: { labels: meses.map(m=>m.label), datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode:'index', intersect:false },
            plugins: {
                legend: { labels: { boxWidth:12, font:{size:11} } },
                datalabels: {
                    display: ctx => ctx.dataset.data[ctx.dataIndex] > 0,
                    align: 'top', anchor: 'end',
                    font: { size: 8, weight: 'bold' },
                    color: ctx => ctx.dataset.borderColor,
                    formatter: v => v
                }
            },
            scales: {
                x: { grid:{display:false}, ticks:{font:{size:10}} },
                y: { beginAtZero:true, ticks:{precision:0,font:{size:10}} }
            }
        }
    });
}

function mkDonut(id, labels, data, colors) {
    const ctx = document.getElementById(id)?.getContext('2d');
    if (!ctx) return;
    if (CHARTS[id]) CHARTS[id].destroy();
    const total = data.reduce((a,b)=>a+b,0);
    CHARTS[id] = new Chart(ctx, {
        type: 'doughnut',
        data: { labels, datasets:[{ data, backgroundColor:colors, borderWidth:2, borderColor:'#fff', hoverOffset:5 }]},
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position:'right', labels:{ boxWidth:10, font:{size:10},
                    generateLabels: chart => {
                        const ds = chart.data.datasets[0];
                        return chart.data.labels.map((lbl,i) => ({
                            text: `${lbl} (${ds.data[i]})`,
                            fillStyle: ds.backgroundColor[i], hidden:false, index:i
                        }));
                    }
                }},
                datalabels: {
                    display: ctx => total > 0 && (ctx.dataset.data[ctx.dataIndex]/total) >= 0.05,
                    color: '#fff',
                    font: { size: 10, weight: 'bold' },
                    formatter: (v) => {
                        const pct = Math.round(v/total*100);
                        return v + '\n' + pct + '%';
                    }
                }
            }
        }
    });
}

const PALETA = ['#0a448f','#6a1b9a','#e65100','#b71c1c','#2e7d32','#1565c0',
                '#ad1457','#00695c','#f57f17','#37474f','#5c6bc0','#26a69a'];
const AMBER  = ['#f57f17','#fb8c00','#ffa000','#ffb300','#ffc107',
                '#ffd54f','#ffe082','#ffecb3','#e65100','#bf360c'];

// ── Contagem por campo ────────────────────────────────────────────
function topN(arr, campo, n=8, acumPeso=false) {
    const cnt = {};
    arr.forEach(i => {
        const k = (i[campo]||'N/D').trim();
        cnt[k] = (cnt[k]||0) + (acumPeso ? parsePeso(i) : 1);
    });
    return Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,n);
}

// ════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════
(async () => {
    try {
        // ── Buscar dados ────────────────────────────────────────
        const [geral, cvpRaw, armaRaw, drogaRaw, tcoRaw, vdRaw, sossRaw, visRaw] =
            await Promise.all([
                fetchNo('geral'), fetchNo('cvp'),  fetchNo('arma'),
                fetchNo('droga'), fetchNo('tco'),  fetchNo('violencia_domestica'),
                fetchNo('sossego'), fetchNo('geral') // visitas derivadas do geral
            ]);

        // visitas = registros do geral com TIPIFICACAO contendo VISITA
        const visitas = geral.filter(i => norm(i.TIPIFICACAO||'').includes('VISITA'));

        // ── Período (URL params ou ano atual) ───────────────────
        const periodo = getPeriodo();
        document.getElementById('meta-periodo').textContent = periodo.label;

        const F = periodo.filtro;
        const cvliArr = geral.filter(i => F(i) && isCVLI(i));
        const mviArr  = geral.filter(i => F(i) && isMVI(i));
        const cvpArr  = cvpRaw.filter(i => F(i) && isCVP(i));
        const vdArr   = vdRaw.filter(F);
        const sossArr = sossRaw.filter(F);
        const visArr  = visitas.filter(F);
        const tcoArr  = tcoRaw.filter(F);
        const armaArr = armaRaw.filter(F);
        const drogaArr= drogaRaw.filter(F);

        // ── Metadados ───────────────────────────────────────────
        const agora = new Date();
        const dataStr = agora.toLocaleDateString('pt-BR',
            {weekday:'long',day:'2-digit',month:'long',year:'numeric'}) +
            ' às ' + agora.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
        document.getElementById('meta-data').textContent = dataStr;
        document.getElementById('rodape-data').innerHTML =
            `Relatório gerado em: ${dataStr}<br>Sistema P3 · 10º BPM / PMAL`;

        // ── Drogas: soma peso ───────────────────────────────────
        const pesoDrogaTotal = drogaArr.reduce((s,i)=>s+parsePeso(i),0);

        // ── Filtro mês atual ─────────────────────────────────────
        const agora2      = new Date();
        const chaveAtual  = `${agora2.getFullYear()}-${String(agora2.getMonth()+1).padStart(2,'0')}`;
        const nomeMesAtual = agora2.toLocaleDateString('pt-BR',{month:'long'});
        const filtroMesAtual = item => {
            const iso = toISO(item.DATA||item.data||'')||''
            return iso.substring(0,7) === chaveAtual;
        };

        const cvliMes  = geral.filter(i => filtroMesAtual(i) && isCVLI(i)).length;
        const mviMes   = geral.filter(i => filtroMesAtual(i) && isMVI(i)).length;
        const cvpMes   = cvpRaw.filter(i => filtroMesAtual(i) && isCVP(i)).length;
        const vdMes    = vdRaw.filter(filtroMesAtual).length;
        const tcoMes   = tcoRaw.filter(filtroMesAtual).length;
        const armaMes  = armaRaw.filter(filtroMesAtual).length;
        const sossMes  = sossRaw.filter(filtroMesAtual).length;
        const visMes   = visitas.filter(filtroMesAtual).length;
        const drogaMes = drogaRaw.filter(filtroMesAtual);
        const pesoDrogaMes = drogaMes.reduce((s,i)=>s+parsePeso(i),0);

        // Badge variação: para crimes alta = ruim; para materiais = neutro
        function deltaBadge(mes, total, neutro=false) {
            const media = total > 0 ? (total / 12).toFixed(1) : 0;
            const diff  = mes - parseFloat(media);
            const pct   = media > 0 ? Math.round(diff / parseFloat(media) * 100) : 0;
            let cls, seta;
            if (diff > 0)      { cls = neutro ? 'delta-neu' : 'delta-up';   seta = '▲'; }
            else if (diff < 0) { cls = neutro ? 'delta-neu' : 'delta-down'; seta = '▼'; }
            else               { cls = 'delta-same'; seta = '='; }
            return `<span class="kpi-mes ${cls}">${seta} ${mes} <small style="font-weight:normal;">(${pct > 0 ? '+' : ''}${pct}% vs. média)</small></span>`;
        }

        // ── KPIs ────────────────────────────────────────────────
        const kpis = [
            { cls:'cvli',   ico:'fa-skull',              lbl:'CVLI',                 val: cvliArr.length, sub:'Crimes violentos letais',        mesVal: cvliMes,    mesTotal: cvliArr.length,  neutro: false },
            { cls:'mvi',    ico:'fa-skull-crossbones',   lbl:'MVI',                  val: mviArr.length,  sub:'Mortes violentas intencionais',   mesVal: mviMes,     mesTotal: mviArr.length,   neutro: false },
            { cls:'cvp',    ico:'fa-mask',               lbl:'CVP',                  val: cvpArr.length,  sub:'Crimes contra patrimônio',         mesVal: cvpMes,     mesTotal: cvpArr.length,   neutro: false },
            { cls:'vd',     ico:'fa-hand-paper',         lbl:'Violência Doméstica',  val: vdArr.length,   sub:'Ocorrências registradas',          mesVal: vdMes,      mesTotal: vdArr.length,    neutro: false },
            { cls:'tco',    ico:'fa-file-alt',           lbl:'TCO',                  val: tcoArr.length,  sub:'Termos circunstanciados',          mesVal: tcoMes,     mesTotal: tcoArr.length,   neutro: true  },
            { cls:'arma',   ico:'fa-gun',                lbl:'Armas Apreendidas',    val: armaArr.length, sub:'Registros do período',             mesVal: armaMes,    mesTotal: armaArr.length,  neutro: true  },
            { cls:'droga',  ico:'fa-cannabis',           lbl:'Drogas Apreendidas',   val: fmtPeso(pesoDrogaTotal), sub:`${drogaArr.length} registros`, mesVal: fmtPeso(pesoDrogaMes), mesTotal: null, neutro: true },
            { cls:'soss',   ico:'fa-volume-high',        lbl:'Perturbação Sossego',  val: sossArr.length, sub:'Ocorrências registradas',          mesVal: sossMes,    mesTotal: sossArr.length,  neutro: false },
            { cls:'visita', ico:'fa-house-user',         lbl:'Visitas Orientativas', val: visArr.length,  sub:'Visitas comunitárias',             mesVal: visMes,     mesTotal: visArr.length,   neutro: true  },
        ];

        document.getElementById('kpi-grid').innerHTML = kpis.map(k => {
            const badgeHtml = k.mesTotal !== null
                ? deltaBadge(k.mesVal, k.mesTotal, k.neutro)
                : `<span class="kpi-mes delta-neu">${k.mesVal}</span>`;
            return `
            <div class="kpi ${k.cls}">
                <span class="kpi-lbl"><i class="fas ${k.ico}"></i> ${k.lbl}</span>
                <span class="kpi-val">${k.val}</span>
                <span class="kpi-sub">${k.sub}</span>
                <div style="border-top:1px solid #f0f2f8;margin-top:.35rem;padding-top:.35rem;">
                    <span class="kpi-mes-lbl">${nomeMesAtual}:</span>
                    ${badgeHtml}
                </div>
            </div>`;
        }).join('');

        // ── Série temporal ──────────────────────────────────────
        const meses = buildMeses12();
        mkLine('c-temporal', meses, [
            { label:'CVLI', data:contarMes(cvliArr,meses), borderColor:'#6a1b9a', backgroundColor:'rgba(106,27,154,.08)', fill:true, tension:.35, pointRadius:4 },
            { label:'CVP',  data:contarMes(cvpArr, meses), borderColor:'#e65100', backgroundColor:'rgba(230,81,0,.06)',  fill:true, tension:.35, pointRadius:4 },
            { label:'MVI',  data:contarMes(mviArr, meses), borderColor:'#b71c1c', backgroundColor:'rgba(183,28,28,.06)', fill:true, tension:.35, pointRadius:4 },
        ]);

        // ── CVLI tipificações ───────────────────────────────────
        const cvliTip = topN(cvliArr,'TIPIFICACAO');
        mkBar('c-cvli-tip', cvliTip.map(([k])=>k.length>28?k.substring(0,26)+'…':k),
              cvliTip.map(([,v])=>v),
              ['#6a1b9a','#7b1fa2','#8e24aa','#9c27b0','#ab47bc','#ba68c8','#ce93d8','#e1bee7'],
              {horizontal:true});

        // ── CVP tipificações ────────────────────────────────────
        const cvpTip = topN(cvpArr,'TIPIFICACAO');
        mkBar('c-cvp-tip', cvpTip.map(([k])=>k.length>28?k.substring(0,26)+'…':k),
              cvpTip.map(([,v])=>v),
              ['#e65100','#f4511e','#ff5722','#ff7043','#ff8a65','#ffab91','#ffccbc','#fbe9e7'],
              {horizontal:true});

        // ── CVLI por cidade ─────────────────────────────────────
        const cvliCid = topN(cvliArr,'CIDADE',8);
        mkBar('c-cvli-cidade', cvliCid.map(([k])=>k), cvliCid.map(([,v])=>v),
              PALETA.slice(0,cvliCid.length));

        // ── CVP por cidade ──────────────────────────────────────
        const cvpCid = topN(cvpArr,'CIDADE',8);
        mkBar('c-cvp-cidade', cvpCid.map(([k])=>k), cvpCid.map(([,v])=>v),
              PALETA.slice(0,cvpCid.length));

        // ── VD mensal ───────────────────────────────────────────
        mkBar('c-vd-mes', meses.map(m=>m.label), contarMes(vdArr,meses),
              'rgba(173,20,87,.7)');

        // ── Sossego mensal ──────────────────────────────────────
        mkBar('c-soss-mes', meses.map(m=>m.label), contarMes(sossArr,meses),
              'rgba(0,105,92,.7)');

        // ── Visitas mensal ──────────────────────────────────────
        mkBar('c-visitas-mes', meses.map(m=>m.label), contarMes(visArr,meses),
              'rgba(0,121,107,.7)');

        // ── TCO por tipificação ─────────────────────────────────
        const tcoTip = topN(tcoArr,'TIPIFICACAO',8);
        mkBar('c-tco-tip',
              tcoTip.map(([k])=>k.length>28?k.substring(0,26)+'…':k),
              tcoTip.map(([,v])=>v),
              ['#1565c0','#1976d2','#1e88e5','#2196f3','#42a5f5','#64b5f6','#90caf9','#bbdefb'],
              {horizontal:true});

        // ── Armas por tipo ──────────────────────────────────────
        const armaTip = topN(armaArr, 'TIPO_ARMA', 8);
        mkDonut('c-arma-tipo',
            armaTip.map(([k])=>k),
            armaTip.map(([,v])=>v),
            ['#2e7d32','#388e3c','#43a047','#4caf50','#66bb6a','#81c784','#a5d6a7','#c8e6c9']);

        // ── Drogas por tipo (peso) ──────────────────────────────
        const drogaTip = topN(drogaArr,'TIPO_DROGA',8,true);
        mkBar('c-droga-tipo',
              drogaTip.map(([k])=>k.length>28?k.substring(0,26)+'…':k),
              drogaTip.map(([,v])=>+v.toFixed(2)),
              AMBER.slice(0,drogaTip.length),
              { horizontal:true, tooltipFn: c => ` ${fmtPeso(c.parsed.x)}` });

        // ── Drogas mensal (peso) ────────────────────────────────
        mkBar('c-droga-mes', meses.map(m=>m.label), pesoMes(drogaArr,meses),
              AMBER[0],
              { tooltipFn: c => ` ${fmtPeso(c.parsed.y)}` });

        // ── Tabela CVLI ─────────────────────────────────────────
        const cvliOrd = [...cvliArr].sort((a,b) => {
            const da = parseDateStr(a.DATA||a.data||'')||new Date(0);
            const db = parseDateStr(b.DATA||b.data||'')||new Date(0);
            return db - da;
        });
        const tbody = document.getElementById('tbody-cvli');
        tbody.innerHTML = cvliOrd.slice(0,30).map(doc => {
            const tip   = (doc.TIPIFICACAO_GERAL||doc.TIPIFICACAO||'—').trim();
            const obito = (doc.OBITO||'N').toString().toUpperCase().trim();
            const cls   = isMVI(doc) ? 'b-mvi' : isCVP(doc) ? 'b-cvp' : 'b-cvli';
            return `<tr>
                <td><strong>${doc.BOLETIM||'—'}</strong></td>
                <td style="white-space:nowrap">${doc.DATA||doc.data||'—'}</td>
                <td>${doc.HORA||'—'}</td>
                <td><span class="badge ${cls}">${tip.length>30?tip.substring(0,28)+'…':tip}</span></td>
                <td>${doc.BAIRRO||doc.bairro||'—'}</td>
                <td>${doc.CIDADE||'—'}</td>
                <td>${doc.SOLUÇÃO||doc.SOLUCAO||'—'}</td>
                <td style="text-align:center">${obito==='S'?'<span class="obito-s">SIM</span>':'<span class="obito-n">NÃO</span>'}</td>
            </tr>`;
        }).join('') || `<tr><td colspan="8" style="text-align:center;padding:20px;color:#9ea3b5;">Nenhum registro encontrado.</td></tr>`;

        const info = document.getElementById('tabela-info');
        if (cvliArr.length > 30) info.textContent = `Exibindo 30 registros mais recentes de um total de ${cvliArr.length}.`;
        else info.textContent = `${cvliArr.length} registro(s) encontrado(s).`;

        // ── Exibir página ───────────────────────────────────────
        document.getElementById('loader').style.display = 'none';
        document.getElementById('pagina').style.display = 'block';

    } catch (err) {
        console.error('Erro ao carregar relatório:', err);
        document.getElementById('loader').innerHTML =
            '<i class="fas fa-exclamation-triangle" style="color:#b71c1c;font-size:2rem;"></i>' +
            '<span>Erro ao carregar dados.<br><small>' + err.message + '</small></span>';
    }
})();
