// ═══════════════════════════════════════════════════════════════════
// DASHBOARD COPOM — 10º BPM
// Firebase: /geral
// Indicadores: Atendentes/Despachantes, Ocorrências, Soluções,
//              Dias da Semana, Tipificações, Cidades, Horários
// ═══════════════════════════════════════════════════════════════════

const FB_COPOM = 'https://sistema-p3-default-rtdb.firebaseio.com';

// ── Normalização ──────────────────────────────────────────────────
const normC = str => (str || '').toString().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

// ── Parsers de data ───────────────────────────────────────────────
function parseDateC(str) {
    if (!str || str === '---') return null;
    str = str.toString().trim().substring(0, 10);
    if (str.includes('/')) {
        const [d, m, a] = str.split('/');
        return new Date(+a, +m - 1, +d);
    }
    if (str.includes('-')) {
        const [a, m, d] = str.split('-');
        return new Date(+a, +m - 1, +d);
    }
    return null;
}

function toISOC(str) {
    if (!str || str === '---') return '';
    str = str.toString().trim().substring(0, 10);
    if (str.includes('/')) {
        const [d, m, a] = str.split('/');
        return `${a}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    }
    return str;
}

// ── Estado global ─────────────────────────────────────────────────
let DADOS_C   = [];   // array do nó /geral
let FILTRO_C  = { ini: null, fim: null };
let ANO_C     = new Date().getFullYear();
let CHARTS_C  = {};

// ── Fetch ─────────────────────────────────────────────────────────
async function carregarCopom() {
    const r = await fetch(`${FB_COPOM}/geral.json`);
    const d = await r.json();
    if (!d) return;
    DADOS_C = Object.keys(d).map(id => ({ id, ...d[id] }));
}

// ── Aplica filtro de período ──────────────────────────────────────
function filtradosC() {
    if (!FILTRO_C.ini && !FILTRO_C.fim) {
        return DADOS_C.filter(i => {
            const dt = parseDateC(i.DATA || i.data || '');
            return dt && dt.getFullYear() === ANO_C;
        });
    }
    return DADOS_C.filter(item => {
        const d = parseDateC(item.DATA || item.data || '');
        if (!d) return false;
        if (FILTRO_C.ini && d < FILTRO_C.ini) return false;
        if (FILTRO_C.fim && d > FILTRO_C.fim) return false;
        return true;
    });
}

// ── Extrair atendente do subnó 'atendente' ───────────────────────
// Campo gravado pelo cadastroocorrencias.js no subnó item.atendente
function extrairAtendente(item) {
    const v = item.atendente || item.ATENDENTE || '';
    const s = v.toString().trim();
    return (s && s !== '---') ? s.toUpperCase() : 'NÃO IDENTIFICADO';
}

// ═══════════════════════════════════════════════════════════════════
// RENDERIZAÇÃO PRINCIPAL
// ═══════════════════════════════════════════════════════════════════
function renderizarCopom() {
    Object.values(CHARTS_C).forEach(c => { try { c.destroy(); } catch(e){} });
    CHARTS_C = {};

    const main = document.getElementById('copom-main');
    main.innerHTML = '';

    // ── Cabeçalho ─────────────────────────────────────────────────
    main.innerHTML += `
        <div class="dash-header">
            <div>
                <h2><i class="fas fa-headset" style="margin-right:.4rem;"></i>Dashboard COPOM — Centro de Operações</h2>
                <small>10º Batalhão de Polícia Militar · Dados: Firebase — Nó /geral</small>
            </div>
            <div class="relogio-dash" id="copom-relogio"></div>
        </div>`;

    // ── Filtro de período ─────────────────────────────────────────
    main.innerHTML += `
        <div class="periodo-bar">
            <i class="fas fa-calendar-alt" style="color:#1a237e;"></i>
            <label>Período:</label>
            <label style="font-size:.82rem;color:#555;">De:
                <input type="date" id="copom-fil-ini" onchange="aplicarPeriodoCopom()" style="margin-left:4px;">
            </label>
            <label style="font-size:.82rem;color:#555;">Até:
                <input type="date" id="copom-fil-fim" onchange="aplicarPeriodoCopom()" style="margin-left:4px;">
            </label>
            <button class="btn-limpar" onclick="limparPeriodoCopom()">
                <i class="fas fa-times"></i> Limpar
            </button>
            <span id="copom-badge-periodo" style="font-size:.75rem;background:#1a237e;color:#fff;
                  padding:2px 10px;border-radius:12px;display:none;"></span>
            <span style="margin-left:auto;font-size:.78rem;color:#9ea3b5;">
                Sem filtro = ano corrente (${ANO_C})
            </span>
        </div>`;

    // ── KPIs ──────────────────────────────────────────────────────
    main.innerHTML += `<div class="kpi-grid" id="copom-kpi-grid"></div>`;

    // ── Seção 1: Temporal + Dia da semana ─────────────────────────
    main.innerHTML += `
        <div class="secao-titulo">
            <i class="fas fa-chart-line" style="margin-right:.4rem;"></i>
            Análise Temporal
        </div>
        <div class="charts-grid" id="copom-grid-temporal"></div>`;

    const gridTemporal = document.getElementById('copom-grid-temporal');
    gridTemporal.innerHTML = `
        <div class="chart-card full">
            <div class="chart-header">
                <div>
                    <div class="chart-title"><i class="fas fa-chart-line"></i> Ocorrências por Mês</div>
                    <div class="chart-sub">Total de acionamentos atendidos pelo COPOM</div>
                </div>
                <div class="chart-filter">
                    <select id="copom-fil-meses" onchange="renderCopomTemporal()">
                        <option value="6">Últimos 6 meses</option>
                        <option value="12" selected>Últimos 12 meses</option>
                        <option value="24">Últimos 24 meses</option>
                    </select>
                </div>
            </div>
            <div class="chart-wrap tall"><canvas id="copom-chart-temporal"></canvas></div>
        </div>
        <div class="chart-card">
            <div class="chart-header">
                <div>
                    <div class="chart-title"><i class="fas fa-calendar-week"></i> Por Dia da Semana</div>
                    <div class="chart-sub">Concentração de acionamentos</div>
                </div>
            </div>
            <div class="chart-wrap"><canvas id="copom-chart-diasemana"></canvas></div>
        </div>
        <div class="chart-card">
            <div class="chart-header">
                <div>
                    <div class="chart-title"><i class="fas fa-clock"></i> Heatmap de Horário</div>
                    <div class="chart-sub">Horas com maior concentração de acionamentos</div>
                </div>
            </div>
            <div id="copom-heatmap"></div>
            <div style="margin-top:.4rem;font-size:.65rem;color:#9ea3b5;">Branco = zero · azul escuro = pico</div>
        </div>`;

    // ── Seção 2: Tipificações + Soluções + Cidades ────────────────
    main.innerHTML += `
        <div class="secao-titulo" style="margin-top:.5rem;">
            <i class="fas fa-tags" style="margin-right:.4rem;"></i>
            Tipificações, Soluções e Cidades
        </div>
        <div class="charts-grid" id="copom-grid-tipsolcid"></div>`;

    const gridTip = document.getElementById('copom-grid-tipsolcid');
    gridTip.innerHTML = `
        <div class="chart-card full">
            <div class="chart-header">
                <div>
                    <div class="chart-title"><i class="fas fa-list-ul"></i> Top Tipificações</div>
                    <div class="chart-sub">Naturezas mais frequentes no período</div>
                </div>
                <div class="chart-filter">
                    <select id="copom-fil-cidade-tip" onchange="renderCopomTipificacao()">
                        <option value="">Todas as cidades</option>
                        <option>Palmeira dos Índios</option>
                        <option>Igaci</option>
                        <option>Belém</option>
                        <option>Cacimbinhas</option>
                        <option>Estrela de Alagoas</option>
                        <option>Mar Vermelho</option>
                        <option>Maribondo</option>
                        <option>Paulo Jacinto</option>
                        <option>Quebrangulo</option>
                        <option>Tanque D'Arca</option>
                        <option>Minador do Negrão</option>
                    </select>
                </div>
            </div>
            <div class="chart-wrap tall"><canvas id="copom-chart-tip"></canvas></div>
        </div>
        <div class="chart-card">
            <div class="chart-header">
                <div>
                    <div class="chart-title"><i class="fas fa-check-circle"></i> Soluções</div>
                    <div class="chart-sub">Desfecho das ocorrências atendidas</div>
                </div>
            </div>
            <div class="chart-wrap"><canvas id="copom-chart-solucoes"></canvas></div>
        </div>
        <div class="chart-card">
            <div class="chart-header">
                <div>
                    <div class="chart-title"><i class="fas fa-map-marker-alt"></i> Por Cidade</div>
                    <div class="chart-sub">Volume de acionamentos por município</div>
                </div>
            </div>
            <div class="chart-wrap"><canvas id="copom-chart-cidade"></canvas></div>
        </div>`;

    // ── Seção 3: Atendentes / Despachantes ────────────────────────
    main.innerHTML += `
        <div class="secao-titulo" style="margin-top:.5rem;">
            <i class="fas fa-headset" style="margin-right:.4rem;"></i>
            Produtividade por Atendente / Despachante
        </div>`;

    // Filtro compartilhado para toda a seção de atendentes
    main.innerHTML += `
        <div style="background:#fff;border:1.5px solid #d0d5e8;border-radius:8px;
                    padding:.6rem 1rem;display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;">
            <i class="fas fa-filter" style="color:#1a237e;"></i>
            <label style="font-size:.82rem;font-weight:bold;color:#374263;">Filtrar seção por cidade:</label>
            <select id="copom-fil-atend-cidade" onchange="renderCopomAtendente();renderCopomAtendSolucao();renderCopomAtendDisponib();"
                style="padding:5px 10px;border:1.5px solid #d0d5e8;border-radius:6px;font-size:.82rem;">
                <option value="">Todas as cidades</option>
                <option>Palmeira dos Índios</option>
                <option>Igaci</option>
                <option>Belém</option>
                <option>Cacimbinhas</option>
                <option>Estrela de Alagoas</option>
                <option>Mar Vermelho</option>
                <option>Maribondo</option>
                <option>Paulo Jacinto</option>
                <option>Quebrangulo</option>
                <option>Tanque D'Arca</option>
                <option>Minador do Negrão</option>
            </select>
        </div>`;

    // Cards de atendentes
    main.innerHTML += `
        <div id="copom-cards-atendentes"
            style="display:flex;flex-wrap:wrap;gap:.7rem;"></div>`;

    // Gráficos de atendentes
    main.innerHTML += `<div class="charts-grid" id="copom-grid-atendente"></div>`;

    const gridAt = document.getElementById('copom-grid-atendente');
    gridAt.innerHTML = `
        <div class="chart-card full">
            <div class="chart-header">
                <div>
                    <div class="chart-title">
                        <i class="fas fa-ranking-star"></i> Ranking — Atendente × Quantidade de Acionamentos
                    </div>
                    <div class="chart-sub">Total de ocorrências atendidas por operador no período</div>
                </div>
            </div>
            <div class="chart-wrap tall"><canvas id="copom-chart-atendente"></canvas></div>
        </div>
        <div class="chart-card full">
            <div class="chart-header">
                <div>
                    <div class="chart-title">
                        <i class="fas fa-layer-group"></i> Atendente × Tipo de Solução
                    </div>
                    <div class="chart-sub">Distribuição das soluções por operador (top 8 soluções)</div>
                </div>
            </div>
            <div class="chart-wrap tall"><canvas id="copom-chart-atend-solucao"></canvas></div>
        </div>
        <div class="chart-card full">
            <div class="chart-header">
                <div>
                    <div class="chart-title">
                        <i class="fas fa-circle-check"></i> Atendente × Atendido / Indisponibilidade
                    </div>
                    <div class="chart-sub">
                        🟢 Atendido = todas as soluções exceto indisponibilidade &nbsp;| 
                        🔴 Indisponibilidade = recurso indisponível
                    </div>
                </div>
            </div>
            <div class="chart-wrap tall"><canvas id="copom-chart-atend-disponib"></canvas></div>
        </div>`;

    // ── Seção 4: Tabela de ocorrências ────────────────────────────
    main.innerHTML += `
        <div class="secao-titulo" style="margin-top:.5rem;">
            <i class="fas fa-table" style="margin-right:.4rem;"></i>
            Registro de Ocorrências COPOM
        </div>
        <div class="chart-card" style="padding:1rem 1.2rem;">
            <div class="chart-header">
                <div>
                    <div class="chart-title"><i class="fas fa-filter"></i> Consulta de Acionamentos</div>
                    <div class="chart-sub">Filtro por cidade, tipificação e texto livre</div>
                </div>
                <div class="chart-filter" style="display:flex;gap:.5rem;flex-wrap:wrap;">
                    <select id="copom-crz-cidade" onchange="renderCopomTabela()">
                        <option value="">Todas as cidades</option>
                        <option>Palmeira dos Índios</option>
                        <option>Igaci</option>
                        <option>Belém</option>
                        <option>Cacimbinhas</option>
                        <option>Estrela de Alagoas</option>
                        <option>Mar Vermelho</option>
                        <option>Maribondo</option>
                        <option>Paulo Jacinto</option>
                        <option>Quebrangulo</option>
                        <option>Tanque D'Arca</option>
                        <option>Minador do Negrão</option>
                    </select>
                    <input type="text" id="copom-crz-busca" placeholder="🔍 Tipificação, bairro, solução..."
                        oninput="renderCopomTabela()" style="min-width:200px;">
                </div>
            </div>
            <div class="scroll-tabela" style="max-height:360px;overflow-y:auto;">
                <table class="cruzamento-table">
                    <thead>
                        <tr>
                            <th>BOLETIM</th>
                            <th>DATA</th>
                            <th>HORA</th>
                            <th>TIPIFICAÇÃO</th>
                            <th>BAIRRO</th>
                            <th>CIDADE</th>
                            <th>ATENDENTE</th>
                            <th>SOLUÇÃO</th>
                            <th>ESTABELECIMENTO</th>
                        </tr>
                    </thead>
                    <tbody id="copom-tbody"></tbody>
                </table>
            </div>
            <div id="copom-crz-contador" style="font-size:.75rem;color:#9ea3b5;margin-top:.5rem;"></div>
        </div>`;

    // ── Renderiza tudo ────────────────────────────────────────────
    setTimeout(() => {
        renderCopomKPIs();
        renderCopomTemporal();
        renderCopomDiaSemana();
        renderCopomHeatmap();
        renderCopomTipificacao();
        renderCopomSolucoes();
        renderCopomCidade();
        renderCopomAtendente();
        renderCopomAtendSolucao();
        renderCopomAtendDisponib();
        renderCopomTabela();
        startRelogioCopom();
    }, 80);
}

// ═══════════════════════════════════════════════════════════════════
// KPIs
// ═══════════════════════════════════════════════════════════════════
function renderCopomKPIs() {
    const arr = filtradosC();

    // Total de acionamentos
    const total = arr.length;

    // Acionamentos com solução
    const comSolucao = arr.filter(i => {
        const s = normC(i.SOLUÇÃO || i.SOLUCAO || '');
        return s && s !== '---' && s !== '';
    }).length;

    // Média diária
    const datas = arr.map(i => toISOC(i.DATA || i.data || '')).filter(Boolean);
    const diasUnicos = new Set(datas).size || 1;
    const mediaDiaria = (total / diasUnicos).toFixed(1);

    // Tipificação mais frequente
    const cntTip = {};
    arr.forEach(i => {
        const t = (i.TIPIFICACAO_GERAL || i.TIPIFICACAO || 'N/D').trim();
        cntTip[t] = (cntTip[t] || 0) + 1;
    });
    const topTip = Object.entries(cntTip).sort((a,b) => b[1]-a[1])[0];

    // Cidade mais acionada
    const cntCid = {};
    arr.forEach(i => {
        const c = (i.CIDADE || 'N/D').trim();
        cntCid[c] = (cntCid[c] || 0) + 1;
    });
    const topCid = Object.entries(cntCid).sort((a,b) => b[1]-a[1])[0];

    // Hora de pico
    const cntH = Array(24).fill(0);
    arr.forEach(i => {
        const h = parseInt((i.HORA || '00:00').toString().split(':')[0], 10);
        if (!isNaN(h) && h >= 0 && h < 24) cntH[h]++;
    });
    const horaPico = cntH.indexOf(Math.max(...cntH));

    // Atendentes únicos
    const atendentes = new Set(arr.map(i => extrairAtendente(i))
        .filter(a => a !== 'NÃO IDENTIFICADO')).size;

    const g = document.getElementById('copom-kpi-grid');
    if (!g) return;
    g.innerHTML = `
        <div class="kpi-card" style="border-top-color:#1565c0;">
            <span class="kpi-label"><i class="fas fa-phone-volume"></i> Total de Acionamentos</span>
            <span class="kpi-valor">${total.toLocaleString('pt-BR')}</span>
            <span class="kpi-sub">no período selecionado</span>
        </div>
        <div class="kpi-card" style="border-top-color:#2e7d32;">
            <span class="kpi-label"><i class="fas fa-check-double"></i> Com Solução Registrada</span>
            <span class="kpi-valor">${comSolucao.toLocaleString('pt-BR')}</span>
            <span class="kpi-sub">${total > 0 ? Math.round(comSolucao/total*100) : 0}% do total</span>
        </div>
        <div class="kpi-card" style="border-top-color:#00695c;">
            <span class="kpi-label"><i class="fas fa-chart-line"></i> Média Diária</span>
            <span class="kpi-valor" style="font-size:1.6rem;">${mediaDiaria}</span>
            <span class="kpi-sub">acionamentos/dia</span>
        </div>
        <div class="kpi-card" style="border-top-color:#f57f17;">
            <span class="kpi-label"><i class="fas fa-clock"></i> Hora de Pico</span>
            <span class="kpi-valor" style="font-size:1.6rem;">${String(horaPico).padStart(2,'0')}h</span>
            <span class="kpi-sub">${cntH[horaPico]} acionamentos</span>
        </div>
        <div class="kpi-card" style="border-top-color:#6a1b9a;">
            <span class="kpi-label"><i class="fas fa-tags"></i> Tipificação Top</span>
            <span class="kpi-valor" style="font-size:.95rem;line-height:1.3;margin-top:.3rem;">
                ${topTip ? topTip[0].substring(0,28) + (topTip[0].length>28?'…':'') : '—'}
            </span>
            <span class="kpi-sub">${topTip ? topTip[1] + ' ocorrências' : ''}</span>
        </div>
        <div class="kpi-card" style="border-top-color:#ad1457;">
            <span class="kpi-label"><i class="fas fa-map-marker-alt"></i> Cidade Mais Acionada</span>
            <span class="kpi-valor" style="font-size:1rem;line-height:1.3;margin-top:.3rem;">
                ${topCid ? topCid[0] : '—'}
            </span>
            <span class="kpi-sub">${topCid ? topCid[1] + ' acionamentos' : ''}</span>
        </div>
        <div class="kpi-card" style="border-top-color:#37474f;">
            <span class="kpi-label"><i class="fas fa-headset"></i> Atendentes Identificados</span>
            <span class="kpi-valor">${atendentes}</span>
            <span class="kpi-sub">operadores no período</span>
        </div>`;
}

// ═══════════════════════════════════════════════════════════════════
// GRÁFICO: SÉRIE TEMPORAL MENSAL
// ═══════════════════════════════════════════════════════════════════
function renderCopomTemporal() {
    const nMeses = parseInt(document.getElementById('copom-fil-meses')?.value || '12');
    const agora  = new Date();
    const meses  = [];
    for (let i = nMeses - 1; i >= 0; i--) {
        const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
        meses.push({
            label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
            chave: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
        });
    }

    // Quando há filtro de período, usa dados filtrados; senão usa histórico dos N meses
    const fonteTemporal = (FILTRO_C.ini || FILTRO_C.fim) ? filtradosC() : DADOS_C;
    const cnt = {};
    fonteTemporal.forEach(item => {
        const iso = toISOC(item.DATA || item.data || '');
        if (iso.length >= 7) {
            const c = iso.substring(0,7);
            cnt[c] = (cnt[c]||0) + 1;
        }
    });

    const ctx = document.getElementById('copom-chart-temporal')?.getContext('2d');
    if (!ctx) return;
    if (CHARTS_C['temporal']) CHARTS_C['temporal'].destroy();
    CHARTS_C['temporal'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: meses.map(m => m.label),
            datasets: [{
                label: 'Acionamentos',
                data:  meses.map(m => cnt[m.chave] || 0),
                backgroundColor: 'rgba(21,101,192,.70)',
                borderColor:     '#1565c0',
                borderWidth:     1.5,
                borderRadius:    5,
                borderSkipped:   false
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                datalabels: {
                    anchor: 'end', align: 'top',
                    color: '#374263', font: { size: 9, weight: 'bold' },
                    formatter: v => v > 0 ? v : ''
                }
            },
            scales: {
                y: { beginAtZero: true, ticks: { precision: 0 } },
                x: { grid: { display: false }, ticks: { font: { size: 10 } } }
            }
        },
        plugins: [ChartDataLabels]
    });
}

// ═══════════════════════════════════════════════════════════════════
// GRÁFICO: DIA DA SEMANA
// ═══════════════════════════════════════════════════════════════════
function renderCopomDiaSemana() {
    const dias = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    const cnt  = Array(7).fill(0);
    filtradosC().forEach(i => {
        const d = parseDateC(i.DATA || i.data || '');
        if (d) cnt[d.getDay()]++;
    });

    const ctx = document.getElementById('copom-chart-diasemana')?.getContext('2d');
    if (!ctx) return;
    if (CHARTS_C['diasemana']) CHARTS_C['diasemana'].destroy();
    CHARTS_C['diasemana'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: dias,
            datasets: [{
                label: 'Acionamentos',
                data:  cnt,
                backgroundColor: cnt.map(v => {
                    const max = Math.max(...cnt, 1);
                    const alpha = 0.35 + (v / max) * 0.55;
                    return `rgba(21,101,192,${alpha.toFixed(2)})`;
                }),
                borderRadius: 5, borderSkipped: false
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { precision: 0 } },
                x: { grid: { display: false } }
            }
        }
    });
}

// ═══════════════════════════════════════════════════════════════════
// HEATMAP DE HORÁRIO
// ═══════════════════════════════════════════════════════════════════
function renderCopomHeatmap() {
    const cnt = Array(24).fill(0);
    filtradosC().forEach(i => {
        const h = parseInt((i.HORA || '00:00').toString().split(':')[0], 10);
        if (!isNaN(h) && h >= 0 && h < 24) cnt[h]++;
    });
    const max = Math.max(...cnt, 1);
    const el  = document.getElementById('copom-heatmap');
    if (!el) return;
    el.className = 'hora-grid';
    el.innerHTML = cnt.map((v, h) => {
        const alpha = v === 0 ? 0 : Math.min(1, (v / max) * 1.3);
        const bg    = v === 0 ? '#f0f2f8' : `rgba(21,101,192,${alpha.toFixed(2)})`;
        const cor   = v === 0 ? '#bbb' : alpha > 0.5 ? '#fff' : '#1a237e';
        return `<div class="hora-cel" style="background:${bg};color:${cor};"
            title="${h}h — ${v} acionamento(s)">${h}h</div>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════════════════
// GRÁFICO: TIPIFICAÇÕES
// ═══════════════════════════════════════════════════════════════════
function renderCopomTipificacao() {
    const cidFiltro = normC(document.getElementById('copom-fil-cidade-tip')?.value || '');
    let arr = filtradosC();
    if (cidFiltro) arr = arr.filter(i => normC(i.CIDADE || '').includes(cidFiltro));

    const cnt = {};
    arr.forEach(i => {
        const t = (i.TIPIFICACAO_GERAL || i.TIPIFICACAO || 'NÃO INFORMADO').trim();
        cnt[t] = (cnt[t]||0)+1;
    });
    const top = Object.entries(cnt).sort((a,b) => b[1]-a[1]).slice(0,15);

    const ctx = document.getElementById('copom-chart-tip')?.getContext('2d');
    if (!ctx) return;
    if (CHARTS_C['tip']) CHARTS_C['tip'].destroy();
    CHARTS_C['tip'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: top.map(x => x[0].length > 35 ? x[0].substring(0,35)+'…' : x[0]),
            datasets: [{
                data:            top.map(x => x[1]),
                backgroundColor: top.map((_, i) => `rgba(21,101,192,${1 - i*0.055})`),
                borderRadius:    4,
                borderSkipped:   false
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false },
                datalabels: { anchor:'end', align:'end', color:'#374263', font:{size:9,weight:'bold'} }
            },
            scales: {
                x: { beginAtZero: true, ticks: { precision: 0 } },
                y: { ticks: { font: { size: 9 } } }
            }
        },
        plugins: [ChartDataLabels]
    });
}

// ═══════════════════════════════════════════════════════════════════
// GRÁFICO: SOLUÇÕES
// ═══════════════════════════════════════════════════════════════════
function renderCopomSolucoes() {
    const cnt = {};
    filtradosC().forEach(i => {
        const s = (i.SOLUÇÃO || i.SOLUCAO || i['SOLUÇÃO'] || 'NÃO INFORMADO').trim();
        cnt[s] = (cnt[s]||0)+1;
    });
    const top = Object.entries(cnt).sort((a,b) => b[1]-a[1]).slice(0,10);

    const ctx = document.getElementById('copom-chart-solucoes')?.getContext('2d');
    if (!ctx) return;
    if (CHARTS_C['solucoes']) CHARTS_C['solucoes'].destroy();

    const cores = [
        '#1565c0','#1976d2','#1e88e5','#2196f3','#42a5f5',
        '#64b5f6','#90caf9','#bbdefb','#2e7d32','#388e3c'
    ];

    CHARTS_C['solucoes'] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: top.map(x => x[0].length > 30 ? x[0].substring(0,30)+'…' : x[0]),
            datasets: [{
                data:            top.map(x => x[1]),
                backgroundColor: cores,
                borderWidth:     2,
                borderColor:     '#fff'
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position:'right', labels:{ boxWidth:10, font:{size:9} } }
            }
        }
    });
}

// ═══════════════════════════════════════════════════════════════════
// GRÁFICO: POR CIDADE
// ═══════════════════════════════════════════════════════════════════
function renderCopomCidade() {
    const cnt = {};
    filtradosC().forEach(i => {
        const c = (i.CIDADE || 'NÃO INFORMADO').trim();
        cnt[c] = (cnt[c]||0)+1;
    });
    const top = Object.entries(cnt).sort((a,b) => b[1]-a[1]).slice(0,12);

    const ctx = document.getElementById('copom-chart-cidade')?.getContext('2d');
    if (!ctx) return;
    if (CHARTS_C['cidade']) CHARTS_C['cidade'].destroy();
    CHARTS_C['cidade'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: top.map(x => x[0]),
            datasets: [{
                data:            top.map(x => x[1]),
                backgroundColor: top.map((_,i) => `rgba(21,101,192,${1-i*0.065})`),
                borderRadius:    4,
                borderSkipped:   false
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { precision: 0 } },
                x: { grid: { display: false }, ticks: { font: { size: 9 } } }
            }
        }
    });
}

// ═══════════════════════════════════════════════════════════════════
// CARDS + GRÁFICO: ATENDENTES / DESPACHANTES
// ═══════════════════════════════════════════════════════════════════
function renderCopomAtendente() {
    const cidFiltro = normC(document.getElementById('copom-fil-atend-cidade')?.value || '');
    let arr = filtradosC();
    if (cidFiltro) arr = arr.filter(i => normC(i.CIDADE || '').includes(cidFiltro));

    const cnt = {};
    arr.forEach(i => {
        const a = extrairAtendente(i);
        cnt[a] = (cnt[a]||0)+1;
    });

    const todos = Object.entries(cnt)
        .filter(([k]) => k !== 'NÃO IDENTIFICADO')
        .sort((a,b) => b[1]-a[1]);

    const top = todos.slice(0, 20);
    const totalGeral = todos.reduce((s,[,v]) => s+v, 0);

    // ── Cards de atendentes ─────────────────────────────────────────
    /*const cardsEl = document.getElementById('copom-cards-atendentes');
    if (cardsEl) {
        if (!todos.length) {
            cardsEl.innerHTML = `<p style="color:#9ea3b5;font-size:.82rem;padding:.5rem;">
                Nenhum atendente identificado no período.</p>`;
        } else {
            const cores = ['#1565c0','#1976d2','#1e88e5','#2196f3','#42a5f5',
                           '#2e7d32','#388e3c','#43a047','#ad1457','#c2185b',
                           '#6a1b9a','#7b1fa2','#e65100','#f4511e','#37474f',
                           '#00695c','#00838f','#f57f17','#f9a825','#b71c1c'];
            cardsEl.innerHTML = todos.map(([nome, qtd], idx) => {
                const pct   = totalGeral > 0 ? Math.round(qtd/totalGeral*100) : 0;
                const cor   = cores[idx % cores.length];
                const initials = nome.split(' ').map(w=>w[0]||'').slice(0,2).join('');
                return `
                <div style="background:#fff;border-radius:10px;padding:.8rem 1rem;
                            box-shadow:0 2px 8px rgba(0,0,0,.07);min-width:140px;
                            border-top:3px solid ${cor};flex:1;max-width:190px;">
                    <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.4rem;">
                        <div style="background:${cor};color:#fff;border-radius:50%;
                                    width:32px;height:32px;display:flex;align-items:center;
                                    justify-content:center;font-weight:bold;font-size:12px;
                                    flex-shrink:0;">${initials}</div>
                        <span style="font-size:.75rem;font-weight:bold;color:#374263;
                                     line-height:1.2;word-break:break-word;">${nome}</span>
                    </div>
                    <div style="font-size:1.5rem;font-weight:bold;color:#1a1f36;">${qtd}</div>
                    <div style="font-size:.7rem;color:#9ea3b5;">acionamentos · ${pct}% do total</div>
                    <div style="margin-top:.4rem;background:#f0f2f8;border-radius:4px;height:4px;">
                        <div style="background:${cor};width:${pct}%;height:4px;border-radius:4px;"></div>
                    </div>
                </div>`;
            }).join('');
        }
    }*/

    // ── Gráfico de barras horizontais ───────────────────────────────
    const ctx = document.getElementById('copom-chart-atendente')?.getContext('2d');
    if (!ctx) return;
    if (CHARTS_C['atendente']) CHARTS_C['atendente'].destroy();

    if (!top.length) { ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height); return; }

    CHARTS_C['atendente'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: top.map(x => x[0].length > 30 ? x[0].substring(0,30)+'…' : x[0]),
            datasets: [{
                label:           'Acionamentos',
                data:            top.map(x => x[1]),
                backgroundColor: top.map((_,i) => `rgba(21,101,192,${Math.max(0.35, 1-i*0.032)})`),
                borderRadius:    4,
                borderSkipped:   false
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                datalabels: {
                    anchor:'end', align:'end',
                    color:'#374263', font:{size:9,weight:'bold'},
                    formatter: v => v.toLocaleString('pt-BR')
                }
            },
            scales: {
                x: { beginAtZero: true, ticks: { precision: 0 } },
                y: { ticks: { font: { size: 9 } } }
            }
        },
        plugins: [ChartDataLabels]
    });
}

// ═══════════════════════════════════════════════════════════════════
// GRÁFICO STACKED: ATENDENTE × TIPO DE SOLUÇÃO
// ═══════════════════════════════════════════════════════════════════
function renderCopomAtendSolucao() {
    const cidFiltro = normC(document.getElementById('copom-fil-atend-cidade')?.value || '');
    let arr = filtradosC();
    if (cidFiltro) arr = arr.filter(i => normC(i.CIDADE || '').includes(cidFiltro));

    // Monta: { atendente: { solucao: contagem } }
    const mapa = {};
    arr.forEach(i => {
        const a = extrairAtendente(i);
        if (a === 'NÃO IDENTIFICADO') return;
        const s = (i.SOLUÇÃO || i.SOLUCAO || i['SOLUÇÃO'] || 'NÃO INFORMADO').toString().trim();
        if (!mapa[a]) mapa[a] = {};
        mapa[a][s] = (mapa[a][s] || 0) + 1;
    });

    // Top 15 atendentes por total
    const topAtend = Object.entries(mapa)
        .map(([a, sols]) => ({ a, total: Object.values(sols).reduce((s,v)=>s+v,0), sols }))
        .sort((x,y) => y.total - x.total)
        .slice(0, 15);

    // Top 8 tipos de solução (globais)
    const cntSol = {};
    arr.forEach(i => {
        const s = (i.SOLUÇÃO || i.SOLUCAO || i['SOLUÇÃO'] || 'NÃO INFORMADO').toString().trim();
        cntSol[s] = (cntSol[s]||0)+1;
    });
    const topSols = Object.entries(cntSol).sort((a,b)=>b[1]-a[1]).slice(0,8).map(x=>x[0]);

    const coresSol = [
        'rgba(21,101,192,.80)',  'rgba(46,125,50,.80)',   'rgba(173,20,87,.80)',
        'rgba(230,81,0,.80)',    'rgba(106,27,154,.80)',   'rgba(0,105,92,.80)',
        'rgba(245,127,23,.80)', 'rgba(55,71,79,.80)'
    ];

    const ctx = document.getElementById('copom-chart-atend-solucao')?.getContext('2d');
    if (!ctx) return;
    if (CHARTS_C['atend-solucao']) CHARTS_C['atend-solucao'].destroy();

    if (!topAtend.length) { ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height); return; }

    CHARTS_C['atend-solucao'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: topAtend.map(x => x.a.length > 25 ? x.a.substring(0,25)+'…' : x.a),
            datasets: topSols.map((sol, idx) => ({
                label: sol.length > 35 ? sol.substring(0,35)+'…' : sol,
                data:  topAtend.map(x => x.sols[sol] || 0),
                backgroundColor: coresSol[idx % coresSol.length],
                borderRadius: idx === topSols.length-1 ? { topLeft:4, topRight:4 } : 0,
                borderSkipped: false,
                stack: 'stack0'
            }))
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { boxWidth: 10, font: { size: 9 },
                              generateLabels: chart => chart.data.datasets.map((ds, i) => ({
                                  text: ds.label, fillStyle: coresSol[i], hidden: false, index: i
                              }))
                    }
                },
                datalabels: { display: false }
            },
            scales: {
                x: { stacked: true, grid: { display: false }, ticks: { font: { size: 9 } } },
                y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } }
            }
        },
        plugins: [ChartDataLabels]
    });
}

// ═══════════════════════════════════════════════════════════════════
// GRÁFICO: ATENDENTE × ATENDIDO / INDISPONIBILIDADE
// Critério:
//   INDISPONIBILIDADE = solução contém "INDISPON" (normalizado, sem acento)
//   ATENDIDO          = todas as demais soluções
// ═══════════════════════════════════════════════════════════════════
function renderCopomAtendDisponib() {
    const cidFiltro = normC(document.getElementById('copom-fil-atend-cidade')?.value || '');
    let arr = filtradosC();
    if (cidFiltro) arr = arr.filter(i => normC(i.CIDADE || '').includes(cidFiltro));

    // Classifica cada registro
    const mapa = {}; // { atendente: { atendido: N, indisponivel: N } }
    arr.forEach(i => {
        const a = extrairAtendente(i);
        if (a === 'NÃO IDENTIFICADO') return;
        if (!mapa[a]) mapa[a] = { atendido: 0, indisponivel: 0 };

        const sol = normC(i.SOLUÇÃO || i.SOLUCAO || i['SOLUÇÃO'] || '');
        if (sol.includes('INDISPON')) {
            mapa[a].indisponivel += 1;
        } else {
            mapa[a].atendido += 1;
        }
    });

    // Ordena por total decrescente, top 15
    const top = Object.entries(mapa)
        .map(([a, v]) => ({ a, ...v, total: v.atendido + v.indisponivel }))
        .sort((x, y) => y.total - x.total)
        .slice(0, 15);

    const ctx = document.getElementById('copom-chart-atend-disponib')?.getContext('2d');
    if (!ctx) return;
    if (CHARTS_C['atend-disponib']) CHARTS_C['atend-disponib'].destroy();

    if (!top.length) { ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); return; }

    CHARTS_C['atend-disponib'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: top.map(x => x.a.length > 28 ? x.a.substring(0, 28) + '…' : x.a),
            datasets: [
                {
                    label:           '✅ Atendido',
                    data:            top.map(x => x.atendido),
                    backgroundColor: 'rgba(46,125,50,.80)',
                    borderColor:     'rgba(46,125,50,1)',
                    borderWidth:     1,
                    borderRadius:    0,
                    borderSkipped:   false,
                    stack:           'stack0'
                },
                {
                    label:           '🔴 Indisponibilidade',
                    data:            top.map(x => x.indisponivel),
                    backgroundColor: 'rgba(183,28,28,.80)',
                    borderColor:     'rgba(183,28,28,1)',
                    borderWidth:     1,
                    borderRadius:    { topLeft: 4, topRight: 4 },
                    borderSkipped:   false,
                    stack:           'stack0'
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: { boxWidth: 12, font: { size: 10 } }
                },
                tooltip: {
                    callbacks: {
                        afterBody: (items) => {
                            const idx = items[0].dataIndex;
                            const d   = top[idx];
                            const pct = d.total > 0
                                ? Math.round(d.indisponivel / d.total * 100)
                                : 0;
                            return [`Total: ${d.total}`, `Indisp.: ${pct}%`];
                        }
                    }
                },
                datalabels: {
                    display: ctx => ctx.dataset.data[ctx.dataIndex] > 0,
                    anchor:  'center',
                    align:   'center',
                    color:   '#fff',
                    font:    { size: 9, weight: 'bold' },
                    formatter: v => v > 0 ? v : ''
                }
            },
            scales: {
                x: { stacked: true, grid: { display: false }, ticks: { font: { size: 9 } } },
                y: { stacked: true, beginAtZero: true, ticks: { precision: 0 },
                     title: { display: true, text: 'Acionamentos', font: { size: 9 } } }
            }
        },
        plugins: [ChartDataLabels]
    });
}

// ═══════════════════════════════════════════════════════════════════
// TABELA DE OCORRÊNCIAS
// ═══════════════════════════════════════════════════════════════════
function renderCopomTabela() {
    const cidFiltro  = normC(document.getElementById('copom-crz-cidade')?.value || '');
    const buscaTexto = normC(document.getElementById('copom-crz-busca')?.value  || '');

    let lista = filtradosC();
    if (cidFiltro)  lista = lista.filter(i => normC(i.CIDADE || '').includes(cidFiltro));
    if (buscaTexto) lista = lista.filter(i => normC(Object.values(i).join(' ')).includes(buscaTexto));

    // Ordena por data decrescente
    lista = lista.slice().sort((a,b) => {
        const da = parseDateC(a.DATA || a.data || '') || new Date(0);
        const db = parseDateC(b.DATA || b.data || '') || new Date(0);
        return db - da;
    });

    const tbody    = document.getElementById('copom-tbody');
    const contador = document.getElementById('copom-crz-contador');
    if (!tbody) return;

    if (!lista.length) {
        tbody.innerHTML = `<tr><td colspan="9"
            style="text-align:center;padding:20px;color:#9ea3b5;">
            Nenhum registro encontrado.</td></tr>`;
        if (contador) contador.textContent = '0 registros';
        return;
    }

    tbody.innerHTML = lista.slice(0, 50).map(doc => {
        const tip = (doc.TIPIFICACAO_GERAL || doc.TIPIFICACAO || '—').trim();
        const sol = (doc.SOLUÇÃO || doc.SOLUCAO || doc['SOLUÇÃO'] || '—').trim();
        const atend = extrairAtendente(doc);
        return `<tr>
            <td><strong>${doc.BOLETIM || '—'}</strong></td>
            <td style="white-space:nowrap">${doc.DATA || doc.data || '—'}</td>
            <td>${doc.HORA || '—'}</td>
            <td><span class="badge-tip tip-out"
                style="max-width:200px;overflow:hidden;text-overflow:ellipsis;display:inline-block;white-space:nowrap;"
                title="${tip}">${tip}</span></td>
            <td>${doc.BAIRRO || '—'}</td>
            <td>${doc.CIDADE || '—'}</td>
            <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                title="${atend}">${atend}</td>
            <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                title="${sol}">${sol}</td>
            <td>${doc.ESTABELECIMENTO || '—'}</td>
        </tr>`;
    }).join('');

    if (contador) {
        contador.textContent = lista.length > 200
            ? `Exibindo 50 de ${lista.length} registros (refine os filtros)`
            : `${lista.length} registro(s)`;
    }
}

// ═══════════════════════════════════════════════════════════════════
// FILTROS DE PERÍODO
// ═══════════════════════════════════════════════════════════════════
function aplicarPeriodoCopom() {
    const ini = document.getElementById('copom-fil-ini')?.value || '';
    const fim = document.getElementById('copom-fil-fim')?.value || '';
    FILTRO_C.ini = ini ? new Date(ini + 'T00:00:00') : null;
    FILTRO_C.fim = fim ? new Date(fim + 'T23:59:59') : null;

    const badge = document.getElementById('copom-badge-periodo');
    if (badge) {
        badge.textContent  = ini || fim ? `${ini||'…'} → ${fim||'…'}` : '';
        badge.style.display = ini || fim ? 'inline' : 'none';
    }
    atualizarTudoCopom();
}

function limparPeriodoCopom() {
    const elI = document.getElementById('copom-fil-ini');
    const elF = document.getElementById('copom-fil-fim');
    if (elI) elI.value = '';
    if (elF) elF.value = '';
    FILTRO_C = { ini: null, fim: null };
    const badge = document.getElementById('copom-badge-periodo');
    if (badge) badge.style.display = 'none';
    atualizarTudoCopom();
}

function atualizarTudoCopom() {
    renderCopomKPIs();
    renderCopomTemporal();
    renderCopomDiaSemana();
    renderCopomHeatmap();
    renderCopomTipificacao();
    renderCopomSolucoes();
    renderCopomCidade();
    renderCopomAtendente();
    renderCopomAtendSolucao();
    renderCopomAtendDisponib();
    renderCopomTabela();
}

// ═══════════════════════════════════════════════════════════════════
// RELÓGIO
// ═══════════════════════════════════════════════════════════════════
function startRelogioCopom() {
    const tick = () => {
        const n    = new Date();
        const opts = { weekday:'short', day:'2-digit', month:'long', year:'numeric' };
        const str  = `${n.toLocaleDateString('pt-BR', opts)} | ${n.toLocaleTimeString('pt-BR')}`;
        const el1  = document.getElementById('relogio');
        const el2  = document.getElementById('copom-relogio');
        if (el1) el1.innerHTML = str;
        if (el2) el2.innerHTML = str;
    };
    tick();
    setInterval(tick, 1000);
}

// ═══════════════════════════════════════════════════════════════════
// LOGIN / LOGOUT
// ═══════════════════════════════════════════════════════════════════
function checkLoginCopom() {
    const grad = localStorage.getItem('userGraduacao');
    const nome = localStorage.getItem('userNomeGuerra');
    const el   = document.getElementById('user-info');
    if (grad && nome) {
        if (el) el.innerHTML = `<p>Bem Vindo(a):</p><p class="user-nome">${grad} ${nome}</p>`;
    } else {
        window.location.href = '../page/login.html';
    }
}

// ═══════════════════════════════════════════════════════════════════
// INICIALIZAÇÃO
// ═══════════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', async () => {
    checkLoginCopom();

    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) btnLogout.addEventListener('click', () => {
        localStorage.clear();
        window.location.href = '../page/login.html';
    });

    const main = document.getElementById('copom-main');
    if (main) main.innerHTML = `
        <div class="loader-dash">
            <i class="fas fa-spinner fa-spin" style="font-size:1.4rem;color:#1a237e;"></i>
            Carregando dados do COPOM…
        </div>`;

    try {
        await carregarCopom();
        renderizarCopom();
    } catch (err) {
        console.error('Erro ao carregar COPOM:', err);
        if (main) main.innerHTML = `
            <div class="loader-dash" style="color:#b71c1c;">
                <i class="fas fa-exclamation-triangle"></i>
                Erro ao carregar dados: ${err.message}
            </div>`;
    }
});