// ═══════════════════════════════════════════════════════════════════
// DASHBOARD P3 — 10º BPM
// Firebase: /geral  /cvp  /cvli  /arma  /droga  /tco
//           /violencia_domestica  /sossego  /mandados
// ═══════════════════════════════════════════════════════════════════

const FB_BASE = 'https://sistema-p3-default-rtdb.firebaseio.com';

// ── Normalização de texto ────────────────────────────────────────
const norm = str => (str || '').toString().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

// ── Classificadores ──────────────────────────────────────────────
// CVLI = tentativa de homicídio, tentativa de feminicídio, latrocínio tentado,
//        homicídio, feminicídio, latrocínio
// MVI  = homicídio, feminicídio, latrocínio, lesão corporal com resultado morte,
//        tentativa de homicídio (OBITO=S), tentativa de feminicídio (OBITO=S)

const ehHomicidioBase = t => t.includes('HOMICIDIO') || t.includes('FEMINICIDIO');
const ehLatrocinio    = t => t.includes('LATROCINIO');

function isCVLI(item) {
    const t = norm((item.TIPIFICACAO_GERAL || '') + ' ' + (item.TIPIFICACAO || ''));
    // Consumados: homicídio, feminicídio, latrocínio
    if (!t.includes('TENTATIVA') && (ehHomicidioBase(t) || ehLatrocinio(t))) return true;
    // Tentados: tentativa de homicídio, tentativa de feminicídio, latrocínio tentado
    if (t.includes('TENTATIVA') && (ehHomicidioBase(t) || ehLatrocinio(t))) return true;
    return false;
}

function isMVI(item) {
    const t     = norm((item.TIPIFICACAO_GERAL || '') + ' ' + (item.TIPIFICACAO || ''));
    const obito = norm(item.OBITO || '');
    // Consumados: homicídio, feminicídio, latrocínio
    if (!t.includes('TENTATIVA') && (ehHomicidioBase(t) || ehLatrocinio(t))) return true;
    // Lesão corporal com resultado morte
    if (!t.includes('TENTATIVA') && t.includes('LESAO') && t.includes('MORTE')) return true;
    // Tentativas com óbito confirmado: homicídio tentado + OBITO=S, feminicídio tentado + OBITO=S
    if (t.includes('TENTATIVA') && ehHomicidioBase(t) && obito === 'S') return true;
    return false;
}

function isCVP(item) {
    const t     = norm((item.TIPIFICACAO_GERAL || '') + ' ' + (item.TIPIFICACAO || ''));
    const obito = norm(item.OBITO || '');
    if (t.includes('APOIO') || t.includes('OUTRAS')) return false;
    if (t.includes('TENTATIVA') && obito === 'S') return false;
    return t.includes('ROUBO') || t.includes('EXTORSAO') || t.includes('LATROCINIO');
}

// ── Parsers de data ──────────────────────────────────────────────
function parseDateStr(str) {
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

function toISO(str) {
    if (!str || str === '---') return '';
    str = str.toString().trim().substring(0, 10);
    if (str.includes('/')) {
        const [d, m, a] = str.split('/');
        return `${a}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    }
    return str;
}

function anoDoRegistro(item) {
    const d = parseDateStr(item.DATA || item.data || '');
    return d ? d.getFullYear() : null;
}

function mesDoRegistro(item) {
    const d = parseDateStr(item.DATA || item.data || '');
    return d ? d.getMonth() : null; // 0-based
}

// ── Estado global ────────────────────────────────────────────────
let DADOS = { geral: [], cvp: [], cvli: [], arma: [], droga: [], tco: [], vd: [], sossego: [], mandados: [], visitas: [] };
let FILTRO = { ini: null, fim: null };
let ANO_ATUAL = new Date().getFullYear();
let CHARTS = {};
let ABA_ATIVA = 'geral'; // 'geral' | 'mvi-cvli'

// ════════════════════════════════════════════════════════════════════
// CROSS-FILTER — motor de filtragem cruzada bidirecional
// Inspirado em Power BI / Looker Studio:
// • Clicar em qualquer gráfico filtra TODOS os outros simultaneamente
// • Segundo clique no mesmo item desfaz o filtro (toggle)
// • Múltiplos filtros ativos ao mesmo tempo (AND logic)
// • Chips visuais mostram filtros ativos com botão de remoção individual
// ════════════════════════════════════════════════════════════════════
const CROSS = {
    cidade:      null,  // string — nome da cidade clicada
    tipificacao: null,  // string — tipificação clicada
    mes:         null,  // 'YYYY-MM' — mês clicado na série temporal
    diaSemana:   null,  // 0-6 — dia da semana clicado
    hora:        null,  // 0-23 — hora clicada no heatmap
    drogaTipo:   null,  // string — tipo de droga clicado
};

// Nomes amigáveis e ícones por campo
const CROSS_META = {
    cidade:      { label:'Cidade',       icon:'fa-map-marker-alt', cor:'#1565c0' },
    tipificacao: { label:'Tipificação',  icon:'fa-tag',            cor:'#6a1b9a' },
    mes:         { label:'Mês',          icon:'fa-calendar-alt',   cor:'#0d7c3b' },
    diaSemana:   { label:'Dia da Semana',icon:'fa-calendar-week',  cor:'#e65100' },
    hora:        { label:'Hora',         icon:'fa-clock',          cor:'#1976d2' },
    drogaTipo:   { label:'Tipo de Droga',icon:'fa-cannabis',       cor:'#f57f17' },
};
const DIAS_SEMANA = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

// ── Toggle: ativa/desativa um campo do cross-filter ──────────────
function toggleCross(campo, valor) {
    CROSS[campo] = CROSS[campo] === valor ? null : valor;
    atualizarTudo();
    renderChipsCross();
}

// ── Limpa UM campo específico ─────────────────────────────────────
function removerCross(campo) {
    CROSS[campo] = null;
    atualizarTudo();
    renderChipsCross();
}

// ── Limpa TODOS os filtros cross ──────────────────────────────────
function limparCross() {
    Object.keys(CROSS).forEach(k => CROSS[k] = null);
    atualizarTudo();
    renderChipsCross();
}

// ── Aplica CROSS sobre um array — exceto o campo 'exceto'
// (para que o próprio gráfico origem mostre dados completos)
function aplicarCross(arr, exceto) {
    let r = arr;
    if (CROSS.cidade && exceto !== 'cidade')
        r = r.filter(i => norm(i.CIDADE || '') === norm(CROSS.cidade));
    if (CROSS.tipificacao && exceto !== 'tipificacao')
        r = r.filter(i => {
            const t = norm((i.TIPIFICACAO_GERAL||'')+(i.TIPIFICACAO||''));
            return t.includes(norm(CROSS.tipificacao));
        });
    if (CROSS.mes && exceto !== 'mes')
        r = r.filter(i => toISO(i.DATA||i.data||'').substring(0,7) === CROSS.mes);
    if (CROSS.diaSemana !== null && exceto !== 'diaSemana')
        r = r.filter(i => { const d = parseDateStr(i.DATA||i.data||''); return d && d.getDay() === CROSS.diaSemana; });
    if (CROSS.hora !== null && exceto !== 'hora')
        r = r.filter(i => { const h = parseInt((i.HORA||'').split(':')[0]); return h === CROSS.hora; });
    if (CROSS.drogaTipo && exceto !== 'drogaTipo')
        r = r.filter(i => (i.TIPO_DROGA||'').trim() === CROSS.drogaTipo);
    return r;
}

// ── doAno + CROSS (atalho usado em cada render) ───────────────────
function doAnoX(arr, exceto) {
    return aplicarCross(doAno(arr), exceto);
}

// ── Tem algum filtro ativo? ────────────────────────────────────────
function temCrossAtivo() {
    return Object.values(CROSS).some(v => v !== null);
}

// ── Renderiza chips de filtros ativos ─────────────────────────────
function renderChipsCross() {
    const el = document.getElementById('cross-chips');
    if (!el) return;
    const ativos = Object.entries(CROSS).filter(([,v]) => v !== null);
    if (!ativos.length) { el.innerHTML = ''; return; }

    el.innerHTML = ativos.map(([k, v]) => {
        const meta = CROSS_META[k];
        const display = k === 'diaSemana' ? DIAS_SEMANA[v] : k === 'hora' ? v+'h' : v;
        return `<span class="cross-chip" style="--chip-cor:${meta.cor}">
            <i class="fas ${meta.icon}"></i>
            <span>${meta.label}: <strong>${display}</strong></span>
            <button class="chip-x" onclick="removerCross('${k}')" title="Remover filtro">✕</button>
        </span>`;
    }).join('') +
    `<button class="cross-clear-all" onclick="limparCross()">
        <i class="fas fa-times-circle"></i> Limpar todos
    </button>`;
}

// ── Fetch helper ─────────────────────────────────────────────────
async function fetchNo(no) {
    const r = await fetch(`${FB_BASE}/${no}.json`);
    const d = await r.json();
    if (!d) return [];
    return Object.keys(d).map(id => ({ id, ...d[id] }));
}

// ═══════════════════════════════════════════════════════════════════
// CARREGAMENTO
// ═══════════════════════════════════════════════════════════════════
async function carregarTudo() {
    const [geral, cvp, cvli, arma, droga, tco, vd, sossego, mandados] = await Promise.all([
        fetchNo('geral'), fetchNo('cvp'), fetchNo('cvli'),
        fetchNo('arma'), fetchNo('droga'), fetchNo('tco'),
        fetchNo('violencia_domestica'), fetchNo('sossego'), fetchNo('mandados')
    ]);
    // Visitas orientativas: derivadas do nó /geral com tipificação contendo "VISITA"
    const visitas = geral.filter(i =>
        norm(i.TIPIFICACAO || i.TIPIFICACAO_GERAL || '').includes('VISITA')
    );
    DADOS = { geral, cvp, cvli, arma, droga, tco, vd, sossego, mandados, visitas };
}

// ── Filtro de período aplicado sobre um array ────────────────────
function filtroPeriodo(arr) {
    if (!FILTRO.ini && !FILTRO.fim) return arr;
    return arr.filter(item => {
        const d = parseDateStr(item.DATA || item.data || '');
        if (!d) return false;
        if (FILTRO.ini && d < FILTRO.ini) return false;
        if (FILTRO.fim && d > FILTRO.fim) return false;
        return true;
    });
}

// ── Filtra pelo ano atual (padrão quando não há filtro de período) ─
function doAno(arr) {
    if (FILTRO.ini || FILTRO.fim) return filtroPeriodo(arr);
    // Usa jan→hoje para que período atual seja proporcional ao anterior (jan→mesma data ano-1)
    const hoje = new Date();
    const ini  = new Date(ANO_ATUAL, 0, 1);
    const fim  = new Date(ANO_ATUAL, hoje.getMonth(), hoje.getDate(), 23, 59, 59);
    return arr.filter(i => {
        const d = parseDateStr(i.DATA || i.data || '');
        return d && d >= ini && d <= fim;
    });
}

// ═══════════════════════════════════════════════════════════════════
// RENDERIZAÇÃO PRINCIPAL
// ═══════════════════════════════════════════════════════════════════
function renderizar() {
    Object.values(CHARTS).forEach(c => { try { c.destroy(); } catch (e) {} });
    CHARTS = {};

    const main = document.getElementById('dash-main');
    main.innerHTML = '';

    // ── Cabeçalho do dash ─────────────────────────────────────────
    main.innerHTML += `
        <div class="dash-header">
            <div>
                <h2><i class="fas fa-chart-bar" style="margin-right:.4rem;"></i>Dashboard Operacional — P3</h2>
                <small>10º Batalhão de Polícia Militar · Dados: Firebase Realtime Database</small>
            </div>
        </div>`;

        // ── Seletor de Abas ────────────────────────────────────────
    main.insertAdjacentHTML('beforeend', `
        <div id="dash-abas" style="
            display:flex;gap:0;background:#fff;
            border:1.5px solid #d0d5e8;border-radius:10px;
            overflow:hidden;">
            <button id="aba-btn-geral" onclick="trocarAba('geral')"
                style="flex:1;padding:12px 20px;border:none;cursor:pointer;
                       font-weight:bold;font-size:.88rem;letter-spacing:.04em;
                       display:flex;align-items:center;justify-content:center;gap:8px;
                       transition:all .2s;background:#1565c0;color:#fff;
                       border-right:2px solid #d0d5e8;">
                <i class="fas fa-chart-bar"></i> Dashboard Geral
            </button>
            <button id="aba-btn-mvi-cvli" onclick="trocarAba('mvi-cvli')"
                style="flex:1;padding:12px 20px;border:none;cursor:pointer;
                       font-weight:bold;font-size:.88rem;letter-spacing:.04em;
                       display:flex;align-items:center;justify-content:center;gap:8px;
                       transition:all .2s;background:#f5f7ff;color:#374263;">
                <i class="fas fa-skull" style="color:#6a1b9a;"></i> Análise MVI / CVLI
            </button>
        </div>`);

        // Botão de acesso ao mapa de inteligência
    main.insertAdjacentHTML('beforeend', `
        <div style="margin-top:.5rem;padding:1.2rem 1.5rem;background:linear-gradient(135deg,#0a1628,#0d2147);
            border-radius:10px;border:1px solid rgba(66,165,245,.2);
            display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem;">
            <div>
                <div style="color:#fff;font-weight:bold;font-size:1rem;margin-bottom:.3rem;">
                    <i class="fas fa-map-marked-alt" style="color:#42a5f5;margin-right:.4rem;"></i>
                    Mapa de Inteligência Policial
                </div>
                <div style="color:rgba(255,255,255,.55);font-size:.8rem;">
                    Mapa de calor, Mapa de Agrupamento, Cruzamento de Registros de Ocorrências, Polígonos.
                </div>
            </div>
            <a href="../page/dashboard-mapa.html"
                style="padding:10px 24px;background:#1565c0;color:#fff;text-decoration:none;
                border-radius:8px;font-weight:bold;font-size:.88rem;
                display:flex;align-items:center;gap:8px;white-space:nowrap;
                box-shadow:0 2px 8px rgba(21,101,192,.4);">
                <i class="fas fa-map"></i> Abrir Mapa
            </a>
        </div>`);

    // ── Barra de cross-filter ────────────────────────────────────
    main.insertAdjacentHTML('beforeend', `
        <div id="cross-bar" style="
            background:#fff;border:1.5px solid #d0d5e8;border-radius:8px;
            padding:.55rem 1rem;display:flex;align-items:center;gap:.6rem;
            flex-wrap:wrap;min-height:44px;">
            <span style="font-size:.7rem;font-weight:bold;color:#9ea3b5;
                text-transform:uppercase;letter-spacing:.07em;white-space:nowrap;">
                <i class="fas fa-filter" style="margin-right:3px;color:#1565c0;"></i>
                Filtros Cruzados:
            </span>
            <div id="cross-chips" style="display:flex;flex-wrap:wrap;gap:5px;flex:1;align-items:center;">
                <span style="font-size:.75rem;color:#c0c5d8;font-style:italic;">
                    Clique em qualquer gráfico para filtrar todos simultaneamente
                </span>
            </div>
        </div>`);

    // ── Filtro de período ─────────────────────────────────────────
    main.innerHTML += `
        <div class="periodo-bar">
            <i class="fas fa-calendar-alt" style="color:#1a237e;"></i>
            <label>Período:</label>
            <label style="font-size:.82rem;color:#555;">De:
                <input type="date" id="fil-ini" onchange="aplicarPeriodo()" style="margin-left:4px;">
            </label>
            <label style="font-size:.82rem;color:#555;">Até:
                <input type="date" id="fil-fim" onchange="aplicarPeriodo()" style="margin-left:4px;">
            </label>
            <button class="btn-limpar" onclick="limparPeriodo()">
                <i class="fas fa-times"></i> Limpar
            </button>
            <span id="badge-periodo"></span>
            <span style="margin-left:auto;font-size:.78rem;color:#9ea3b5;">
                Sem filtro = exibe ano corrente (${ANO_ATUAL})
            </span>
        </div>`;

    // ── KPIs ──────────────────────────────────────────────────────
    // ── Botão imprimir relatório ──────────────────────────────────
    main.innerHTML += '<div style="display:flex;justify-content:flex-end;margin-bottom:-.25rem;">'
        + '<button onclick="abrirRelatorio()" style="padding:10px 22px;background:#0a448f;color:#fff;'
        + 'border:none;border-radius:8px;cursor:pointer;font-weight:bold;font-size:.88rem;'
        + 'display:flex;align-items:center;gap:8px;box-shadow:0 2px 8px rgba(10,68,143,.25);">'
        + '📄 IMPRIMIR RELATÓRIO</button></div>';
    
    main.innerHTML += '<div style="display:flex;justify-content:flex-end;margin-bottom:-.25rem;">'
        + '<a href="../relatorios/relatorio_publico.html" target="_blank" style="padding:10px 22px;background:#1565c0;color:#fff;'
        + 'border:none;border-radius:8px;cursor:pointer;font-weight:bold;font-size:.88rem;'
        + 'display:flex;align-items:center;gap:8px;box-shadow:0 2px 8px rgba(21,101,192,.25);">'
        + '📄 RELATÓRIO PÚBLICO</a></div>';

    // Cria o wrapper da aba geral via createElement (à prova de innerHTML +=)
    const divGeral = document.createElement('div');
    divGeral.id = 'conteudo-geral';
    main.appendChild(divGeral);

    // Todas as inserções da aba geral vão para divGeral, não para main
    divGeral.innerHTML += `<div class="kpi-grid" id="kpi-grid"></div>`;
    renderKPIs();

    // ── Gráficos ──────────────────────────────────────────────────
    divGeral.innerHTML += `<div class="secao-titulo"><i class="fas fa-chart-line" style="margin-right:.4rem;"></i>Análise Temporal e por Indicador</div>`;
    divGeral.innerHTML += `<div class="charts-grid" id="charts-grid"></div>`;
    const grid = document.getElementById('charts-grid');

    // Série temporal — gráfico único CVLI + CVP + MVI
    grid.innerHTML += `
        <div class="chart-card full">
            <div class="chart-header">
                <div>
                    <div class="chart-title"><i class="fas fa-chart-line"></i> Série Temporal Mensal — CVLI · CVP · MVI</div>
                    <div class="chart-sub">Ocorrências por mês no período selecionado</div>
                </div>
                <div class="chart-filter">
                    <select id="fil-meses" onchange="renderTemporal()">
                        <option value="12">Últimos 12 meses</option>
                        <option value="6">Últimos 6 meses</option>
                        <option value="24">Últimos 24 meses</option>
                    </select>
                </div>
            </div>
            <div class="chart-wrap tall"><canvas id="chart-temporal"></canvas></div>
        </div>`;

    // Tipificações CVLI
    grid.innerHTML += `
        <div class="chart-card">
            <div class="chart-header">
                <div>
                    <div class="chart-title"><i class="fas fa-skull" style="color:#6a1b9a;"></i> Tipificações CVLI</div>
                    <div class="chart-sub">Distribuição por tipo de crime</div>
                </div>
            </div>
            <div class="chart-wrap"><canvas id="chart-tip-cvli"></canvas></div>
        </div>`;

    // Tipificações CVP
    grid.innerHTML += `
        <div class="chart-card">
            <div class="chart-header">
                <div>
                    <div class="chart-title"><i class="fas fa-mask" style="color:#e65100;"></i> Tipificações CVP</div>
                    <div class="chart-sub">Distribuição por tipo de crime</div>
                </div>
            </div>
            <div class="chart-wrap"><canvas id="chart-tip-cvp"></canvas></div>
        </div>`;

    // Ocorrências por cidade
    grid.innerHTML += `
        <div class="chart-card">
            <div class="chart-header">
                <div>
                    <div class="chart-title"><i class="fas fa-map-marker-alt"></i> Ocorrências por Cidade</div>
                    <div class="chart-sub">Top cidades por indicador</div>
                </div>
                <div class="chart-filter">
                    <select id="fil-cidade-ind" onchange="renderCidade()">
                        <option value="cvli">CVLI</option>
                        <option value="cvp">CVP</option>
                        <option value="mvi">MVI</option>
                        <option value="vd">Viol. Doméstica</option>
                        <option value="sossego">Perturbação Sossego</option>
                        <option value="visitas">Visitas Orientativas</option>
                        <option value="tco">TCO</option>
                    </select>
                </div>
            </div>
            <div class="chart-wrap"><canvas id="chart-cidade"></canvas></div>
        </div>`;

    // Heatmap horário
    grid.innerHTML += `
        <div class="chart-card">
            <div class="chart-header">
                <div>
                    <div class="chart-title"><i class="fas fa-clock"></i> Concentração por Horário</div>
                    <div class="chart-sub">Horários com maior incidência</div>
                </div>
                <div class="chart-filter">
                    <select id="fil-hora-ind" onchange="renderHeatmap()">
                        <option value="cvli">CVLI</option>
                        <option value="cvp">CVP</option>
                        <option value="mvi">MVI</option>
                        <option value="vd">Viol. Doméstica</option>
                        <option value="sossego">Perturbação Sossego</option>
                        <option value="visitas">Visitas Orientativas</option>
                    </select>
                </div>
            </div>
            <div id="heatmap-horas"></div>
            <div style="margin-top:.4rem;font-size:.65rem;color:#9ea3b5;">Branco = zero · cor = maior concentração</div>
        </div>`;

    // Ocorrências por dia da semana
    grid.innerHTML += `
        <div class="chart-card full">
            <div class="chart-header">
                <div>
                    <div class="chart-title"><i class="fas fa-calendar-week"></i> Ocorrências por Dia da Semana — CVLI · CVP · MVI</div>
                    <div class="chart-sub">Concentração semanal dos principais indicadores</div>
                </div>
            </div>
            <div class="chart-wrap"><canvas id="chart-diasemana"></canvas></div>
        </div>`;

    // ── Gráficos: VD · Sossego · Visitas ─────────────────────────
    divGeral.innerHTML += `<div class="secao-titulo" style="margin-top:.5rem;"><i class="fas fa-chart-bar" style="margin-right:.4rem;"></i>Indicadores Sociais e Comunitários</div>`;
    divGeral.innerHTML += `<div class="charts-grid" id="charts-social"></div>`;
    const gridSocial = document.getElementById('charts-social');

    gridSocial.innerHTML += `
        <div class="chart-card">
            <div class="chart-header">
                <div>
                    <div class="chart-title"><i class="fas fa-hand-paper" style="color:#ad1457;"></i> Violência Doméstica — Evolução Mensal</div>
                    <div class="chart-sub">Ocorrências de violência doméstica por mês</div>
                </div>
            </div>
            <div class="chart-wrap"><canvas id="chart-vd-mes"></canvas></div>
        </div>
        <div class="chart-card">
            <div class="chart-header">
                <div>
                    <div class="chart-title"><i class="fas fa-volume-high" style="color:#00695c;"></i> Perturbação do Sossego — Evolução Mensal</div>
                    <div class="chart-sub">Ocorrências de perturbação por mês</div>
                </div>
            </div>
            <div class="chart-wrap"><canvas id="chart-soss-mes"></canvas></div>
        </div>
        <div class="chart-card full">
            <div class="chart-header">
                <div>
                    <div class="chart-title"><i class="fas fa-house-user" style="color:#00796b;"></i> Visitas Orientativas — Evolução Mensal e por Cidade</div>
                    <div class="chart-sub">Visitas comunitárias realizadas por mês</div>
                </div>
            </div>
            <div class="chart-wrap"><canvas id="chart-visitas-mes"></canvas></div>
        </div>`;

    // ── Gráficos TCO ──────────────────────────────────────────────
    divGeral.innerHTML += `<div class="secao-titulo" style="margin-top:.5rem;"><i class="fas fa-file-alt" style="margin-right:.4rem;color:#1565c0;"></i>TCO — Termos Circunstanciados de Ocorrência</div>`;
    divGeral.innerHTML += `<div class="charts-grid" id="charts-tco"></div>`;
    const gridTCO = document.getElementById('charts-tco');
    gridTCO.innerHTML += `
        <div class="chart-card">
            <div class="chart-header">
                <div>
                    <div class="chart-title"><i class="fas fa-file-alt" style="color:#1565c0;"></i> TCO — Tipificações</div>
                    <div class="chart-sub">Top tipificações dos termos lavrados</div>
                </div>
            </div>
            <div class="chart-wrap"><canvas id="chart-tco-tip"></canvas></div>
        </div>
        <div class="chart-card">
            <div class="chart-header">
                <div>
                    <div class="chart-title"><i class="fas fa-map-marker-alt" style="color:#1565c0;"></i> TCO — Por Cidade</div>
                    <div class="chart-sub">Municípios com mais TCOs registrados</div>
                </div>
            </div>
            <div class="chart-wrap"><canvas id="chart-tco-cidade"></canvas></div>
        </div>`;

    // ── Gráficos de Drogas ───────────────────────────────────────
    divGeral.innerHTML += `<div class="secao-titulo" style="margin-top:.5rem;"><i class="fas fa-cannabis" style="margin-right:.4rem;color:#f57f17;"></i>Drogas Apreendidas — Análise Detalhada</div>`;
    divGeral.innerHTML += `<div class="charts-grid" id="charts-droga"></div>`;
    const gridDroga = document.getElementById('charts-droga');

    gridDroga.innerHTML += `
        <div class="chart-card full">
            <div class="chart-header">
                <div>
                    <div class="chart-title"><i class="fas fa-chart-bar" style="color:#f57f17;"></i> Peso Apreendido por Mês (g)</div>
                    <div class="chart-sub">Evolução mensal do total de drogas apreendidas em gramas</div>
                </div>
                <div class="chart-filter">
                    <select id="fil-droga-tipo-mes" onchange="renderDrogaMes()">
                        <option value="">Todos os tipos</option>
                    </select>
                </div>
            </div>
            <div class="chart-wrap tall"><canvas id="chart-droga-mes"></canvas></div>
        </div>
        <div class="chart-card">
            <div class="chart-header">
                <div>
                    <div class="chart-title"><i class="fas fa-cannabis" style="color:#f57f17;"></i> Peso por Tipo de Droga (g)</div>
                    <div class="chart-sub">Total apreendido por substância no período</div>
                </div>
            </div>
            <div class="chart-wrap"><canvas id="chart-droga-tipo"></canvas></div>
        </div>
        <div class="chart-card">
            <div class="chart-header">
                <div>
                    <div class="chart-title"><i class="fas fa-map-marker-alt" style="color:#f57f17;"></i> Drogas por Cidade</div>
                    <div class="chart-sub">Peso total apreendido por município</div>
                </div>
                <div class="chart-filter">
                    <select id="fil-droga-cidade-tipo" onchange="renderDrogaCidade()">
                        <option value="">Todos os tipos</option>
                    </select>
                </div>
            </div>
            <div class="chart-wrap"><canvas id="chart-droga-cidade"></canvas></div>
        </div>`;

    // ── Tabela de cruzamento ──────────────────────────────────────
    divGeral.innerHTML += `<div class="secao-titulo" style="margin-top:.5rem;"><i class="fas fa-table" style="margin-right:.4rem;"></i>Cruzamento de Dados</div>`;
    divGeral.innerHTML += `
        <div class="chart-card" style="padding:1rem 1.2rem;">
            <div class="chart-header">
                <div>
                    <div class="chart-title"><i class="fas fa-filter"></i> Tabela de Ocorrências com Cruzamento</div>
                    <div class="chart-sub">Filtre por indicador, cidade, tipificação e texto livre</div>
                </div>
                <div class="chart-filter" style="display:flex;gap:.5rem;flex-wrap:wrap;">
                    <select id="crz-indicador" onchange="renderCruzamento()">
                        <option value="cvli">CVLI</option>
                        <option value="cvp">CVP</option>
                        <option value="mvi">MVI</option>
                        <option value="vd">Viol. Doméstica</option>
                        <option value="tco">TCO</option>
                        <option value="sossego">Perturbação Sossego</option>
                        <option value="visitas">Visitas Orientativas</option>
                    </select>
                    <select id="crz-cidade" onchange="renderCruzamento()">
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
                    </select>
                    <input type="text" id="crz-busca" placeholder="🔍 Busca livre..." oninput="renderCruzamento()"
                        style="min-width:180px;">
                </div>
            </div>
            <div class="scroll-tabela">
                <table class="cruzamento-table">
                    <thead>
                        <tr>
                            <th>Nº BOLETIM</th>
                            <th>DATA</th>
                            <th>HORA</th>
                            <th>TIPIFICAÇÃO</th>
                            <th>BAIRRO</th>
                            <th>CIDADE</th>
                            <th>SOLICITANTE</th>
                            <th>SOLUÇÃO</th>
                            <th>ÓBITO</th>
                        </tr>
                    </thead>
                    <tbody id="tbody-cruzamento"></tbody>
                </table>
            </div>
            <div id="crz-contador" style="font-size:.75rem;color:#9ea3b5;margin-top:.5rem;"></div>
        </div>`;

    // ── Conteúdo da aba MVI/CVLI ──────────────────────────────────
    main.insertAdjacentHTML('beforeend', `
        <div id="conteudo-mvi-cvli" style="display:none;">

            <!-- Filtros da aba MVI/CVLI -->
            <div style="background:#fff;border:1.5px solid #d0d5e8;border-radius:8px;
                        padding:.7rem 1rem;display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;">
                <i class="fas fa-filter" style="color:#6a1b9a;"></i>
                <strong style="font-size:.83rem;color:#374263;">Filtros MVI/CVLI:</strong>
                <label style="font-size:.82rem;color:#555;">Ano base:
                    <select id="mcvli-ano" onchange="renderMviCvli()" style="margin-left:4px;padding:5px 9px;border:1.5px solid #d0d5e8;border-radius:6px;font-size:.82rem;">
                        ${(() => { const o=[]; for(let a=ANO_ATUAL;a>=2024;a--) o.push(`<option value="${a}"${a===ANO_ATUAL?" selected":""}>${a}</option>`); return o.join(""); })()}
                    </select>
                </label>
                <label style="font-size:.82rem;color:#555;">Comparar com:
                    <select id="mcvli-comp" onchange="renderMviCvli()" style="margin-left:4px;padding:5px 9px;border:1.5px solid #d0d5e8;border-radius:6px;font-size:.82rem;">
                        <option value="ano-ant">Ano anterior</option>
                        ${(() => { const o=[]; for(let a=ANO_ATUAL-1;a>=2024;a--) o.push(`<option value="${a}">${a}</option>`); return o.join(""); })()}
                        <option value="periodo">Período personalizado</option>
                    </select>
                </label>
                <label style="font-size:.82rem;color:#555;">De:
                    <input type="date" id="mcvli-ini" onchange="renderMviCvli()" style="margin-left:4px;">
                </label>
                <label style="font-size:.82rem;color:#555;">Até:
                    <input type="date" id="mcvli-fim" onchange="renderMviCvli()" style="margin-left:4px;">
                </label>
                <label style="font-size:.82rem;color:#555;">Indicador:
                    <select id="mcvli-ind" onchange="renderMviCvli()" style="margin-left:4px;padding:5px 9px;border:1.5px solid #d0d5e8;border-radius:6px;font-size:.82rem;">
                        <option value="ambos">MVI + CVLI</option>
                        <option value="cvli">Somente CVLI</option>
                        <option value="mvi">Somente MVI</option>
                    </select>
                </label>
            </div>

            <!-- KPIs MVI/CVLI -->
            <div class="kpi-grid" id="kpi-mcvli"></div>

            <!-- Gráfico: comparativo mês a mês 2025 vs atual -->
            <div class="secao-titulo" style="margin-top:.5rem;">
                <i class="fas fa-chart-bar" style="margin-right:.4rem;color:#6a1b9a;"></i>
                Comparativo Mês a Mês — MVI/CVLI
            </div>
            <div class="charts-grid">
                <div class="chart-card">
                    <div class="chart-header">
                        <div>
                            <div class="chart-title">
                                <i class="fas fa-skull" style="color:#6a1b9a;"></i>
                                CVLI — Crimes Violentos Letais Intencionais
                            </div>
                            <div class="chart-sub">Tentativas sempre contam · % variação acima de cada barra</div>
                        </div>
                    </div>
                    <div class="chart-wrap tall"><canvas id="chart-mcvli-cvli"></canvas></div>
                </div>
                <div class="chart-card">
                    <div class="chart-header">
                        <div>
                            <div class="chart-title">
                                <i class="fas fa-exclamation-triangle" style="color:#b71c1c;"></i>
                                MVI — Mortes Violentas Intencionais
                            </div>
                            <div class="chart-sub">Tentativas só com ÓBITO = Sim · % variação acima de cada barra</div>
                        </div>
                    </div>
                    <div class="chart-wrap tall"><canvas id="chart-mcvli-mvi"></canvas></div>
                </div>
            </div>

            <!-- Tabela de variação mês a mês -->
            <div class="secao-titulo" style="margin-top:.5rem;">
                <i class="fas fa-percent" style="margin-right:.4rem;color:#1565c0;"></i>
                Variação Percentual Mês a Mês
            </div>
            <div class="chart-card" style="padding:1rem 1.2rem;">
                <div class="scroll-tabela">
                    <table class="cruzamento-table" id="tabela-mcvli-variacao">
                        <thead>
                            <tr>
                                <th>Mês</th>
                                <th style="text-align:center;">Período Atual</th>
                                <th style="text-align:center;">Referência</th>
                                <th style="text-align:center;">Variação</th>
                                <th style="text-align:center;">Status</th>
                            </tr>
                        </thead>
                        <tbody id="tbody-mcvli-variacao"></tbody>
                        <tfoot id="tfoot-mcvli-variacao"></tfoot>
                    </table>
                </div>
            </div>

            <!-- Gráfico: por cidade -->
            <div class="secao-titulo" style="margin-top:.5rem;">
                <i class="fas fa-map-marker-alt" style="margin-right:.4rem;color:#6a1b9a;"></i>
                MVI/CVLI por Cidade
            </div>
            <div class="charts-grid">
                <div class="chart-card">
                    <div class="chart-header">
                        <div class="chart-title"><i class="fas fa-city"></i> Por Município</div>
                        <div class="chart-sub">Comparativo das cidades — atual vs referência</div>
                    </div>
                    <div class="chart-wrap tall"><canvas id="chart-mcvli-cidade"></canvas></div>
                </div>
                <div class="chart-card">
                    <div class="chart-header">
                        <div class="chart-title"><i class="fas fa-clock"></i> Por Horário</div>
                        <div class="chart-sub">Concentração horária dos crimes</div>
                    </div>
                    <div id="heatmap-mcvli-hora"></div>
                </div>
            </div>

            <!-- Gráfico: tipificações -->
            <div class="charts-grid">
                <div class="chart-card">
                    <div class="chart-header">
                        <div class="chart-title"><i class="fas fa-tags" style="color:#6a1b9a;"></i> Tipificações</div>
                        <div class="chart-sub">Distribuição por tipo de crime</div>
                    </div>
                    <div class="chart-wrap"><canvas id="chart-mcvli-tip"></canvas></div>
                </div>
                <div class="chart-card">
                    <div class="chart-header">
                        <div class="chart-title"><i class="fas fa-calendar-week"></i> Por Dia da Semana</div>
                        <div class="chart-sub">Concentração semanal</div>
                    </div>
                    <div class="chart-wrap"><canvas id="chart-mcvli-diasem"></canvas></div>
                </div>
            </div>

            <!-- Tabela de cruzamento MVI/CVLI -->
            <div class="secao-titulo" style="margin-top:.5rem;">
                <i class="fas fa-table" style="margin-right:.4rem;"></i>
                Ocorrências MVI/CVLI Detalhadas
            </div>
            <div class="chart-card" style="padding:1rem 1.2rem;">
                <div class="chart-header">
                    <div class="chart-filter" style="display:flex;gap:.5rem;flex-wrap:wrap;">
                        <select id="mcvli-crz-cidade" onchange="renderMviCvliCruzamento()">
                            <option value="">Todas as cidades</option>
                            <option>Palmeira dos Índios</option><option>Igaci</option>
                            <option>Belém</option><option>Cacimbinhas</option>
                            <option>Estrela de Alagoas</option><option>Mar Vermelho</option>
                            <option>Maribondo</option><option>Paulo Jacinto</option>
                            <option>Quebrangulo</option><option>Tanque D'Arca</option>
                        </select>
                        <input type="text" id="mcvli-crz-busca" placeholder="🔍 Busca livre..."
                            oninput="renderMviCvliCruzamento()"
                            style="min-width:160px;padding:5px 9px;border:1.5px solid #d0d5e8;border-radius:6px;font-size:.82rem;">
                    </div>
                </div>
                <div class="scroll-tabela">
                    <table class="cruzamento-table">
                        <thead><tr>
                            <th>Nº BOLETIM</th><th>DATA</th><th>HORA</th>
                            <th>TIPIFICAÇÃO</th><th>BAIRRO</th><th>CIDADE</th>
                            <th>ÓBITO</th><th>TIPO</th>
                        </tr></thead>
                        <tbody id="tbody-mcvli-crz"></tbody>
                    </table>
                </div>
                <div id="mcvli-crz-contador" style="font-size:.75rem;color:#9ea3b5;margin-top:.5rem;"></div>
            </div>
        </div>`);

    // Renderiza gráficos após DOM estar pronto
    setTimeout(() => {
        renderKPIs();
        renderTemporal();
        renderTipCVLI();
        renderTipCVP();
        renderCidade();
        renderHeatmap();
        renderDiaSemana();
        popularSelectsDroga();
        renderDrogaMes();
        renderDrogaTipo();
        renderDrogaCidade();
        renderVdSossVisitas();
        renderTCO();
        renderCruzamento();
        startRelogio();
    }, 80);
}

// ═══════════════════════════════════════════════════════════════════
// KPIs — com comparativo do período anterior
// ═══════════════════════════════════════════════════════════════════

// Calcula o período anterior espelhado ao filtro atual.
// Com filtro: desloca o intervalo de mesma duração para trás.
// Sem filtro: usa o ano anterior.
function doPeriodoAnterior(arr) {
    if (FILTRO.ini || FILTRO.fim) {
        // Período atual definido
        const ini  = FILTRO.ini || new Date(FILTRO.fim.getFullYear(), 0, 1);
        const fim  = FILTRO.fim || new Date();
        const dur  = fim - ini; // duração em ms
        const antFim = new Date(ini.getTime() - 1);       // 1ms antes do início atual
        const antIni = new Date(antFim.getTime() - dur);  // mesmo intervalo para trás
        return arr.filter(item => {
            const d = parseDateStr(item.DATA || item.data || '');
            if (!d) return false;
            return d >= antIni && d <= antFim;
        });
    }
    // Sem filtro: jan→hoje do ano atual vs jan→mesma data do ano anterior
    // Ex: hoje = 30/05/2026 → compara jan-mai/2026 com jan-mai/2025
    const hoje     = new Date();
    const iniAtual = new Date(ANO_ATUAL, 0, 1);              // 01/01/ano atual
    const fimAtual = hoje;                                    // hoje
    const iniAnt   = new Date(ANO_ATUAL - 1, 0, 1);          // 01/01/ano anterior
    const fimAnt   = new Date(ANO_ATUAL - 1,
                        hoje.getMonth(), hoje.getDate(),
                        23, 59, 59);                          // mesma data/mês, ano anterior
    return arr.filter(item => {
        const d = parseDateStr(item.DATA || item.data || '');
        if (!d) return false;
        return d >= iniAnt && d <= fimAnt;
    });
}

// Gera badge de variação colorido
function badgeVariacao(atual, anterior) {
    if (anterior === 0 && atual === 0) {
        return '<span style="font-size:.7rem;color:#9ea3b5;font-weight:bold;">= sem dados ant.</span>';
    }
    if (anterior === 0) {
        return '<span style="font-size:.7rem;color:#e65100;font-weight:bold;">&#x25B2; novo</span>';
    }
    const diff = atual - anterior;
    const pct  = Math.round(diff / anterior * 100);
    // Para indicadores de crime: alta é ruim (vermelho), queda é boa (verde)
    if (diff > 0) {
        return '<span style="font-size:.7rem;color:#b71c1c;font-weight:bold;">'
             + '&#x25B2; +' + pct + '% (' + anterior + ')</span>';
    }
    if (diff < 0) {
        return '<span style="font-size:.7rem;color:#2e7d32;font-weight:bold;">'
             + '&#x25BC; ' + pct + '% (' + anterior + ')</span>';
    }
    return '<span style="font-size:.7rem;color:#9ea3b5;font-weight:bold;">'
         + '= 0% (' + anterior + ')</span>';
}

// Badge para armas/drogas: neutro (sem conotação de bom/ruim)
function badgeNeutro(atual, anterior) {
    if (anterior === 0 && atual === 0) {
        return '<span style="font-size:.7rem;color:#9ea3b5;font-weight:bold;">= sem dados ant.</span>';
    }
    if (anterior === 0) {
        return '<span style="font-size:.7rem;color:#1565c0;font-weight:bold;">&#x25B2; novo</span>';
    }
    const diff = atual - anterior;
    const pct  = Math.round(diff / anterior * 100);
    const cor  = diff > 0 ? '#1565c0' : diff < 0 ? '#1565c0' : '#9ea3b5';
    const seta = diff > 0 ? '&#x25B2; +' : diff < 0 ? '&#x25BC; ' : '= ';
    return '<span style="font-size:.7rem;color:' + cor + ';font-weight:bold;">'
         + seta + (diff !== 0 ? pct + '%' : '0%') + ' (' + anterior + ')</span>';
}

function labelPeriodoAnt() {
    if (FILTRO.ini || FILTRO.fim) return 'vs período anterior';
    return 'vs ' + (ANO_ATUAL - 1);
}

function renderKPIs() {
    // ── Período atual ─────────────────────────────────────────────
    // KPIs refletem TODOS os filtros cross ativos
    const g       = doAnoX(DADOS.geral);
    const cvli    = g.filter(isCVLI);
    const cvp     = doAnoX(DADOS.cvp).filter(isCVP);
    const mvi     = g.filter(isMVI);
    const vd      = doAnoX(DADOS.vd);
    const tco     = doAnoX(DADOS.tco);
    const arma    = doAnoX(DADOS.arma);
    const soss    = doAnoX(DADOS.sossego);
    const visitas = doAnoX(DADOS.visitas);

    const drogaArr = doAnoX(DADOS.droga);
    let somaDroga = 0;
    drogaArr.forEach(d => {
        const v = parseFloat((d.QUANTIDADE || d.PESO || '0').toString().replace(',', '.'));
        if (!isNaN(v)) somaDroga += v;
    });
    const drogaStr = somaDroga >= 1000
        ? (somaDroga / 1000).toFixed(3) + ' kg'
        : somaDroga.toFixed(3) + ' g';

    // ── Período anterior (espelho) ────────────────────────────────
    const gAnt      = doPeriodoAnterior(DADOS.geral);
    const cvliAnt   = gAnt.filter(isCVLI).length;
    const cvpAnt    = doPeriodoAnterior(DADOS.cvp).filter(isCVP).length;
    const mviAnt    = gAnt.filter(isMVI).length;
    const vdAnt     = doPeriodoAnterior(DADOS.vd).length;
    const tcoAnt    = doPeriodoAnterior(DADOS.tco).length;
    const armaAnt   = doPeriodoAnterior(DADOS.arma).length;
    const sossAnt   = doPeriodoAnterior(DADOS.sossego).length;
    const visitasAnt = doPeriodoAnterior(DADOS.visitas).length;

    const drogaAntArr = doPeriodoAnterior(DADOS.droga);
    let somaDrogaAnt = 0;
    drogaAntArr.forEach(d => {
        const v = parseFloat((d.QUANTIDADE || d.PESO || '0').toString().replace(',', '.'));
        if (!isNaN(v)) somaDrogaAnt += v;
    });
    // Comparativo drogas por número de registros (peso varia muito)
    const drogaRegAnt = drogaAntArr.length;

    const lbl = labelPeriodoAnt();

    const kpiGrid = document.getElementById('kpi-grid');
    if (!kpiGrid) return;
    kpiGrid.innerHTML = `
        <div class="kpi-card cvli">
            <span class="kpi-label"><i class="fas fa-skull"></i> CVLI</span>
            <span class="kpi-valor">${cvli.length}</span>
            ${badgeVariacao(cvli.length, cvliAnt)}
            <span class="kpi-sub" style="margin-top:.2rem;">${lbl}</span>
        </div>
        <div class="kpi-card mvi">
            <span class="kpi-label"><i class="fas fa-skull-crossbones"></i> MVI</span>
            <span class="kpi-valor">${mvi.length}</span>
            ${badgeVariacao(mvi.length, mviAnt)}
            <span class="kpi-sub" style="margin-top:.2rem;">${lbl}</span>
        </div>
        <div class="kpi-card cvp">
            <span class="kpi-label"><i class="fas fa-mask"></i> CVP</span>
            <span class="kpi-valor">${cvp.length}</span>
            ${badgeVariacao(cvp.length, cvpAnt)}
            <span class="kpi-sub" style="margin-top:.2rem;">${lbl}</span>
        </div>
        <div class="kpi-card tco">
            <span class="kpi-label"><i class="fas fa-file-alt"></i> TCO</span>
            <span class="kpi-valor">${tco.length}</span>
            ${badgeNeutro(tco.length, tcoAnt)}
            <span class="kpi-sub" style="margin-top:.2rem;">${lbl}</span>
        </div>
        <div class="kpi-card arma">
            <span class="kpi-label"><i class="fas fa-gun"></i> Armas Apreendidas</span>
            <span class="kpi-valor">${arma.length}</span>
            ${badgeNeutro(arma.length, armaAnt)}
            <span class="kpi-sub" style="margin-top:.2rem;">${lbl}</span>
        </div>
        <div class="kpi-card drug">
            <span class="kpi-label"><i class="fas fa-cannabis"></i> Drogas Apreendidas</span>
            <span class="kpi-valor" style="font-size:1.4rem;">${drogaStr}</span>
            ${badgeNeutro(drogaArr.length, drogaRegAnt)}
            <span class="kpi-sub" style="margin-top:.2rem;">${lbl}</span>
        </div>
        <div class="kpi-card sos">
            <span class="kpi-label"><i class="fas fa-volume-high"></i> Perturbação do Sossego</span>
            <span class="kpi-valor">${soss.length}</span>
            ${badgeVariacao(soss.length, sossAnt)}
            <span class="kpi-sub" style="margin-top:.2rem;">${lbl}</span>
        </div>`;
}

// ═══════════════════════════════════════════════════════════════════
// GRÁFICO: SÉRIE TEMPORAL
// ═══════════════════════════════════════════════════════════════════
function renderTemporal() {
    const nMeses = parseInt(document.getElementById('fil-meses')?.value || '12');
    const agora  = new Date();
    const meses  = [];
    for (let i = nMeses - 1; i >= 0; i--) {
        const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
        meses.push({
            label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
            chave: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        });
    }

    const contarPorMes = arr => {
        const cnt = {};
        arr.forEach(item => {
            const iso = toISO(item.DATA || item.data || '');
            if (iso.length >= 7) { cnt[iso.substring(0,7)] = (cnt[iso.substring(0,7)] || 0) + 1; }
        });
        return meses.map(m => cnt[m.chave] || 0);
    };

    // Aplica cross exceto 'mes' — aba geral usa gráfico único
    const geral  = doAnoX(DADOS.geral, 'mes');

    // ── Gráfico único: CVLI + CVP + MVI ────────────────────────
    const cvpArr  = doAnoX(DADOS.cvp, 'mes');
    const cvliArr = geral.filter(isCVLI);
    const mviArr  = geral.filter(isMVI);
    const cvpFilt = cvpArr.filter(isCVP);

    const ctx = document.getElementById('chart-temporal')?.getContext('2d');
    if (!ctx) return;
    if (CHARTS['temporal']) CHARTS['temporal'].destroy();
    CHARTS['temporal'] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: meses.map(m => m.label),
            datasets: [
                { label:'CVLI', data:contarPorMes(cvliArr), borderColor:'#6a1b9a', backgroundColor:'rgba(106,27,154,.1)', fill:true, tension:.35, pointRadius:4 },
                { label:'CVP',  data:contarPorMes(cvpFilt),  borderColor:'#e65100', backgroundColor:'rgba(230,81,0,.08)',  fill:true, tension:.35, pointRadius:4 },
                { label:'MVI',  data:contarPorMes(mviArr),  borderColor:'#b71c1c', backgroundColor:'rgba(183,28,28,.08)', fill:true, tension:.35, pointRadius:4 },
            ]
        },
        options: {
            responsive:true, maintainAspectRatio:false,
            interaction:{ mode:'index', intersect:false },
            plugins:{
                legend:{ labels:{ boxWidth:12, font:{size:11} } },
                tooltip:{ callbacks:{ footer: items => {
                    const chave = meses[items[0].dataIndex]?.chave;
                    return [CROSS.mes===chave ? '✅ Filtro ativo — clique para remover' : '🔍 Clique para filtrar por este mês'];
                }}}
            },
            scales:{
                x:{ grid:{display:false}, ticks:{
                    font: ctx => ({size:10, weight: CROSS.mes===meses[ctx.index]?.chave?'bold':'normal'}),
                    color: ctx => CROSS.mes===meses[ctx.index]?.chave ? '#1565c0' : '#666',
                }},
                y:{ beginAtZero:true, ticks:{precision:0, font:{size:10}} }
            },
            onClick:(evt, els) => {
                if (!els.length) return;
                const chave = meses[els[0].index]?.chave;
                if (chave) toggleCross('mes', chave);
            }
        }
    });
};

function renderTipCVLI() {
    const arr   = doAnoX(DADOS.geral, 'tipificacao').filter(isCVLI);
    const cnt   = {};
    arr.forEach(i => {
        const t = (i.TIPIFICACAO_GERAL || i.TIPIFICACAO || 'N/D').trim();
        cnt[t]  = (cnt[t] || 0) + 1;
    });
    const top    = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const cores  = ['#6a1b9a','#7b1fa2','#8e24aa','#9c27b0','#ab47bc','#ba68c8','#ce93d8','#e1bee7'];
    const ativo  = CROSS.tipificacao;
    const bgs    = cores.map((c,i) => !ativo || top[i]?.[0] === ativo ? c : c+'44');
    renderBarHClicavel('chart-tip-cvli', top.map(x => x[0]), top.map(x => x[1]),
        bgs, 'tipificacao', top);
}

// ═══════════════════════════════════════════════════════════════════
// GRÁFICO: TIPIFICAÇÕES CVP
// ═══════════════════════════════════════════════════════════════════
function renderTipCVP() {
    const arr   = doAnoX(DADOS.cvp, 'tipificacao').filter(isCVP);
    const cnt   = {};
    arr.forEach(i => {
        const t = (i.TIPIFICACAO_GERAL || i.TIPIFICACAO || 'N/D').trim();
        cnt[t]  = (cnt[t] || 0) + 1;
    });
    const top   = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const cores = ['#e65100','#f4511e','#ff5722','#ff7043','#ff8a65','#ffab91','#ffccbc','#fbe9e7'];
    const ativo = CROSS.tipificacao;
    const bgs   = cores.map((c,i) => !ativo || top[i]?.[0] === ativo ? c : c+'44');
    renderBarHClicavel('chart-tip-cvp', top.map(x => x[0]), top.map(x => x[1]),
        bgs, 'tipificacao', top);
}

// ═══════════════════════════════════════════════════════════════════
// GRÁFICO: POR CIDADE
// ═══════════════════════════════════════════════════════════════════
function renderCidade() {
    const ind = document.getElementById('fil-cidade-ind')?.value || 'cvli';
    const mapaArr = {
        cvli:    doAnoX(DADOS.geral,'cidade').filter(isCVLI),
        cvp:     doAnoX(DADOS.cvp,  'cidade').filter(isCVP),
        mvi:     doAnoX(DADOS.geral,'cidade').filter(isMVI),
        vd:      doAnoX(DADOS.vd,   'cidade'),
        sossego: doAnoX(DADOS.sossego,'cidade'),
        visitas: doAnoX(DADOS.visitas,'cidade'),
        tco:     doAnoX(DADOS.tco,  'cidade'),
    };
    const arr   = mapaArr[ind] || [];
    const cnt   = {};
    arr.forEach(i => {
        const c = (i.CIDADE || 'N/D').trim();
        cnt[c]  = (cnt[c] || 0) + 1;
    });
    const top   = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const ativo = CROSS.cidade;
    const total = top.reduce((s,[,v]) => s+v, 0);

    const coresBase = ['#1a237e','#283593','#303f9f','#3949ab','#3f51b5',
                       '#5c6bc0','#7986cb','#9fa8da','#c5cae9','#e8eaf6'];
    const bgs = coresBase.map((c,i) => !ativo || top[i]?.[0] === ativo ? c : c+'55');
    const borders = top.map(([c]) => c === ativo ? '#ff6f00' : '#fff');

    const ctx = document.getElementById('chart-cidade')?.getContext('2d');
    if (!ctx) return;
    if (CHARTS['cidade']) CHARTS['cidade'].destroy();
    CHARTS['cidade'] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: top.map(x => x[0]),
            datasets: [{ data: top.map(x => x[1]),
                backgroundColor: bgs, borderColor: borders,
                borderWidth: top.map(([c]) => c === ativo ? 3 : 1.5),
                hoverOffset: 10 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        boxWidth: 10, font: { size: 10 },
                        generateLabels: chart => chart.data.labels.map((lbl,i) => ({
                            text: `${lbl} — ${top[i]?.[1]} (${total>0?Math.round(top[i]?.[1]/total*100):0}%)`,
                            fillStyle: bgs[i], strokeStyle: borders[i],
                            lineWidth: 1.5, hidden: false, index: i,
                            fontColor: ativo === lbl ? '#1565c0' : '#374263',
                        }))
                    }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.label}: ${ctx.parsed} (${total>0?Math.round(ctx.parsed/total*100):0}%)`,
                        footer: ctx => [ativo === ctx[0]?.label
                            ? '✅ Filtro ativo — clique para remover'
                            : '🔍 Clique para filtrar por cidade'],
                    }
                }
            },
            onClick: (evt, els) => {
                if (!els.length) return;
                const cidade = top[els[0].index]?.[0];
                if (cidade) toggleCross('cidade', cidade);
            }
        }
    });
}

// ═══════════════════════════════════════════════════════════════════
// HEATMAP HORÁRIO
// ═══════════════════════════════════════════════════════════════════
function renderHeatmap() {
    const ind = document.getElementById('fil-hora-ind')?.value || 'cvli';
    const mapaArr = {
        cvli:    doAno(DADOS.geral).filter(isCVLI),
        cvp:     doAno(DADOS.cvp).filter(isCVP),
        mvi:     doAno(DADOS.geral).filter(isMVI),
        vd:      doAno(DADOS.vd),
        sossego: doAno(DADOS.sossego),
        visitas: doAno(DADOS.visitas),
    };
    const arr     = aplicarCross(mapaArr[ind] || [], 'hora');
    const cnt     = Array(24).fill(0);
    const coresRGB = { cvli: '106,27,154', cvp: '230,81,0', mvi: '183,28,28', vd: '173,20,87', sossego: '0,105,92', visitas: '0,121,107' };
    const rgb     = coresRGB[ind] || '26,35,126';

    arr.forEach(i => {
        const h = parseInt((i.HORA || '00:00').split(':')[0]);
        if (!isNaN(h) && h >= 0 && h < 24) cnt[h]++;
    });

    const max  = Math.max(...cnt, 1);
    const el   = document.getElementById('heatmap-horas');
    if (!el) return;
    el.innerHTML = '';
    el.className = 'hora-grid';
    cnt.forEach((v, h) => {
        const isAtivo = CROSS.hora === h;
        const alpha   = v === 0 ? 0 : Math.min(1, (v / max) * 1.3);
        const bg      = isAtivo ? '#1565c0' : v === 0 ? '#f0f2f8' : `rgba(${rgb},${alpha})`;
        const cor     = isAtivo ? '#fff' : v === 0 ? '#bbb' : alpha > 0.5 ? '#fff' : '#333';
        const outline = isAtivo ? 'outline:2.5px solid #0a2d6b;outline-offset:-1px;' : '';
        const div     = document.createElement('div');
        div.className = 'hora-cel';
        div.style.cssText = `background:${bg};color:${cor};${outline}cursor:pointer;transition:all .15s;`;
        div.title = `${h}h — ${v} ocorrência(s)${isAtivo?' (filtro ativo — clique para remover)':' — clique para filtrar'}`;
        div.textContent = h + 'h';
        div.onclick = () => toggleCross('hora', h);
        el.appendChild(div);
    });
}

// ═══════════════════════════════════════════════════════════════════
// GRÁFICO: DIA DA SEMANA
// ═══════════════════════════════════════════════════════════════════
function renderDiaSemana() {
    const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const contar = arr => {
        const cnt = Array(7).fill(0);
        arr.forEach(i => {
            const d = parseDateStr(i.DATA || i.data || '');
            if (d) cnt[d.getDay()]++;
        });
        return cnt;
    };

    const cvliArr = doAnoX(DADOS.geral,'diaSemana').filter(isCVLI);
    const cvpArr  = doAnoX(DADOS.cvp,  'diaSemana').filter(isCVP);
    const mviArr  = doAnoX(DADOS.geral,'diaSemana').filter(isMVI);

    const dAtivo  = CROSS.diaSemana;
    // Barras do dia selecionado ficam cheias; demais ficam translúcidas
    const bgCVLI  = dias.map((_,i) => dAtivo===null||dAtivo===i ? 'rgba(106,27,154,.85)' : 'rgba(106,27,154,.15)');
    const bgCVP   = dias.map((_,i) => dAtivo===null||dAtivo===i ? 'rgba(230,81,0,.85)'   : 'rgba(230,81,0,.15)');
    const bgMVI   = dias.map((_,i) => dAtivo===null||dAtivo===i ? 'rgba(183,28,28,.85)'  : 'rgba(183,28,28,.15)');
    const bdCVLI  = dias.map((_,i) => dAtivo===i ? '#6a1b9a' : 'transparent');
    const bdCVP   = dias.map((_,i) => dAtivo===i ? '#e65100' : 'transparent');
    const bdMVI   = dias.map((_,i) => dAtivo===i ? '#b71c1c' : 'transparent');

    const ctx = document.getElementById('chart-diasemana')?.getContext('2d');
    if (!ctx) return;
    if (CHARTS['diasemana']) CHARTS['diasemana'].destroy();
    CHARTS['diasemana'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: dias,
            datasets: [
                { label:'CVLI', data:contar(cvliArr), backgroundColor:bgCVLI, borderColor:bdCVLI, borderWidth:2, borderRadius:4 },
                { label:'CVP',  data:contar(cvpArr),  backgroundColor:bgCVP,  borderColor:bdCVP,  borderWidth:2, borderRadius:4 },
                { label:'MVI',  data:contar(mviArr),  backgroundColor:bgMVI,  borderColor:bdMVI,  borderWidth:2, borderRadius:4 },
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { boxWidth: 12, font: { size: 11 } } },
                tooltip: {
                    callbacks: {
                        footer: items => [dAtivo === items[0].dataIndex
                            ? '✅ Filtro ativo — clique para remover'
                            : '🔍 Clique para filtrar por este dia']
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        font: ctx => ({ size:11, weight: CROSS.diaSemana===ctx.index?'bold':'normal' }),
                        color: ctx => CROSS.diaSemana===ctx.index ? '#1565c0' : '#666',
                    }
                },
                y: { beginAtZero: true, ticks: { precision: 0 } }
            },
            onClick: (evt, els) => {
                if (!els.length) return;
                toggleCross('diaSemana', els[0].index);
            }
        }
    });
}

// ═══════════════════════════════════════════════════════════════════
// CRUZAMENTO DE DADOS — TABELA
// ═══════════════════════════════════════════════════════════════════
function renderCruzamento() {
    const ind    = document.getElementById('crz-indicador')?.value || 'cvli';
    const cidade = norm(document.getElementById('crz-cidade')?.value || '');
    const busca  = norm(document.getElementById('crz-busca')?.value  || '');

    // Tabela reflete TODOS os filtros cross ativos
    const mapaArr = {
        cvli:    doAnoX(DADOS.geral).filter(isCVLI),
        cvp:     doAnoX(DADOS.cvp).filter(isCVP),
        mvi:     doAnoX(DADOS.geral).filter(isMVI),
        vd:      doAnoX(DADOS.vd),
        tco:     doAnoX(DADOS.tco),
        sossego: doAnoX(DADOS.sossego),
        visitas: doAnoX(DADOS.visitas),
    };
    let lista = mapaArr[ind] || [];

    // Filtros cruzados
    if (cidade) lista = lista.filter(i => norm(i.CIDADE || '').includes(cidade));
    if (busca)  lista = lista.filter(i => norm(Object.values(i).join(' ')).includes(busca));

    const tbody = document.getElementById('tbody-cruzamento');
    const contador = document.getElementById('crz-contador');
    if (!tbody) return;

    if (!lista.length) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:20px;color:#9ea3b5;">
            Nenhum registro encontrado com os filtros aplicados.</td></tr>`;
        if (contador) contador.textContent = '0 registros';
        return;
    }

    const corTip = ind => {
        if (ind === 'cvli') return 'tip-cvli';
        if (ind === 'cvp')  return 'tip-cvp';
        if (ind === 'mvi')  return 'tip-mvi';
        return 'tip-out';
    };

    tbody.innerHTML = lista.slice(0, 150).map(doc => {
        const obito = (doc.OBITO || 'N').toString().trim().toUpperCase();
        const obitoHtml = obito === 'S'
            ? `<span class="obito-s">SIM</span>`
            : `<span class="obito-n">NÃO</span>`;
        const tip = (doc.TIPIFICACAO_GERAL || doc.TIPIFICACAO || '—').trim();
        return `<tr>
            <td><strong>${doc.BOLETIM || doc.NUMEROOCORRENCIA || '—'}</strong></td>
            <td style="white-space:nowrap">${doc.DATA || doc.data || '—'}</td>
            <td>${doc.HORA || '—'}</td>
            <td><span class="badge-tip ${corTip(ind)}">${tip}</span></td>
            <td>${doc.BAIRRO || doc.bairro || '—'}</td>
            <td>${doc.CIDADE || '—'}</td>
            <td>${doc.SOLICITANTE || '—'}</td>
            <td>${doc.SOLUÇÃO || doc.SOLUCAO || doc['SOLUÇÃO'] || '—'}</td>
            <td style="text-align:center">${obitoHtml}</td>
        </tr>`;
    }).join('');

    if (contador) {
        contador.textContent = lista.length > 150
            ? `Exibindo 150 de ${lista.length} registros (refine os filtros para ver mais)`
            : `${lista.length} registro(s) encontrado(s)`;
    }
}

// ═══════════════════════════════════════════════════════════════════
// GRÁFICO: VD · SOSSEGO · VISITAS — Série temporal mensal
// ═══════════════════════════════════════════════════════════════════
function renderVdSossVisitas() {
    const agora = new Date();
    const meses = [];
    for (let i = 11; i >= 0; i--) {
        const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
        meses.push({
            label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
            chave: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
        });
    }
    const contarM = arr => {
        const cnt = {};
        arr.forEach(item => {
            const iso = toISO(item.DATA || item.data || '');
            if (iso.length >= 7) { const c = iso.substring(0,7); cnt[c]=(cnt[c]||0)+1; }
        });
        return meses.map(m => cnt[m.chave]||0);
    };
    const labels = meses.map(m => m.label);
    const vdArr  = doAnoX(DADOS.vd);
    const sArr   = doAnoX(DADOS.sossego);
    const visArr = doAnoX(DADOS.visitas);

    const mkLine = (id, data, cor, corAlpha) => {
        const ctx = document.getElementById(id)?.getContext('2d');
        if (!ctx) return;
        if (CHARTS[id]) CHARTS[id].destroy();
        CHARTS[id] = new Chart(ctx, {
            type: 'bar',
            data: { labels, datasets: [{
                data, backgroundColor: corAlpha, borderColor: cor,
                borderWidth: 1.5, borderRadius: 4, borderSkipped: false
            }]},
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f0f2f8' } },
                    x: { grid: { display: false }, ticks: { font: { size: 10 } } }
                }
            }
        });
    };

    mkLine('chart-vd-mes',      contarM(vdArr),  '#ad1457', 'rgba(173,20,87,.65)');
    mkLine('chart-soss-mes',    contarM(sArr),   '#00695c', 'rgba(0,105,92,.65)');
    mkLine('chart-visitas-mes', contarM(visArr), '#00796b', 'rgba(0,121,107,.65)');
}

// ═══════════════════════════════════════════════════════════════════
// GRÁFICO: TCO — Tipificação e Cidade
// ═══════════════════════════════════════════════════════════════════
function renderTCO() {
    // ── Tipificação TCO ──────────────────────────────────────────
    // Cross exceto 'tipificacao' (gráfico origem = tipificação)
    const arrTip = doAnoX(DADOS.tco, 'tipificacao');
    const cntTip = {};
    arrTip.forEach(i => {
        const t = (i.TIPIFICACAO_GERAL || i.TIPIFICACAO || 'N/D').trim();
        cntTip[t] = (cntTip[t] || 0) + 1;
    });
    const topTip  = Object.entries(cntTip).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const ativoT  = CROSS.tipificacao;
    const coresTip = ['#1565c0','#1976d2','#1e88e5','#2196f3','#42a5f5','#64b5f6','#90caf9','#bbdefb'];
    const bgsTip  = coresTip.map((c,i) => !ativoT || topTip[i]?.[0] === ativoT ? c : c+'44');
    renderBarHClicavel('chart-tco-tip',
        topTip.map(x => x[0]), topTip.map(x => x[1]),
        bgsTip, 'tipificacao', topTip);

    // ── Cidade TCO ───────────────────────────────────────────────
    // Cross exceto 'cidade' (gráfico origem = cidade)
    const arrCid = doAnoX(DADOS.tco, 'cidade');

    // Cidade
    const cntCid = {};
    arrCid.forEach(i => {
        const c = (i.CIDADE || 'N/D').trim();
        cntCid[c] = (cntCid[c] || 0) + 1;
    });
    const topCid = Object.entries(cntCid).sort((a, b) => b[1] - a[1]).slice(0, 10);

    const ctx = document.getElementById('chart-tco-cidade')?.getContext('2d');
    if (!ctx) return;
    if (CHARTS['tco-cidade']) CHARTS['tco-cidade'].destroy();
    const atcid   = CROSS.cidade;
    const coresT  = ['#1565c0','#1976d2','#1e88e5','#2196f3','#42a5f5','#64b5f6','#90caf9','#bbdefb','#e3f2fd','#e8eaf6'];
    const bgsT    = coresT.map((c,i) => !atcid || topCid[i]?.[0] === atcid ? c : c+'55');
    CHARTS['tco-cidade'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: topCid.map(x => x[0]),
            datasets: [{ data: topCid.map(x => x[1]),
                backgroundColor: bgsT, borderRadius: 4, borderSkipped: false }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { footer: () => ['🔍 Clique para filtrar por cidade'] } }
            },
            scales: {
                y: { beginAtZero: true, ticks: { precision: 0 } },
                x: { grid: { display: false }, ticks: { font: { size: 10 } } }
            },
            onClick: (evt, els) => {
                if (!els.length) return;
                const cidade = topCid[els[0].index]?.[0];
                if (cidade) toggleCross('cidade', cidade);
            }
        }
    });
}

// ═══════════════════════════════════════════════════════════════════
// DROGAS — helpers de peso e população de selects
// ═══════════════════════════════════════════════════════════════════
function parsePeso(item) {
    const v = parseFloat((item.QUANTIDADE || item.PESO || '0').toString().replace(',', '.'));
    return isNaN(v) ? 0 : v;
}

function fmtPeso(g) {
    if (g >= 1000) return (g / 1000).toFixed(2) + ' kg';
    return g.toFixed(1) + ' g';
}

// Popula os selects de tipo de droga com os tipos encontrados nos dados
function popularSelectsDroga() {
    const arr  = doAno(DADOS.droga);
    const tipos = [...new Set(arr.map(i => (i.TIPO_DROGA || '').trim()).filter(Boolean))].sort();
    ['fil-droga-tipo-mes', 'fil-droga-cidade-tipo'].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const atual = sel.value;
        sel.innerHTML = '<option value="">Todos os tipos</option>' +
            tipos.map(t => `<option value="${t}"${t===atual?' selected':''}>${t}</option>`).join('');
    });
}

// ── Gráfico 1: Peso por mês (barras) ─────────────────────────────
function renderDrogaMes() {
    const filtroTipo = document.getElementById('fil-droga-tipo-mes')?.value || '';
    const agora = new Date();
    const meses = [];
    for (let i = 11; i >= 0; i--) {
        const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
        meses.push({
            label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
            chave: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
        });
    }

    let arr = doAnoX(DADOS.droga, 'mes');
    if (filtroTipo) arr = arr.filter(i => (i.TIPO_DROGA || '').trim() === filtroTipo);

    // Agrupa peso por mês
    const pesoMes = {};
    arr.forEach(i => {
        const iso = toISO(i.DATA || i.data || '');
        if (iso.length >= 7) {
            const ch = iso.substring(0, 7);
            pesoMes[ch] = (pesoMes[ch] || 0) + parsePeso(i);
        }
    });
    const dados  = meses.map(m => +(pesoMes[m.chave] || 0).toFixed(2));
    const labels = meses.map(m => m.label);

    const ctx = document.getElementById('chart-droga-mes')?.getContext('2d');
    if (!ctx) return;
    if (CHARTS['droga-mes']) CHARTS['droga-mes'].destroy();
    CHARTS['droga-mes'] = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{
            label: 'Peso (g)',
            data: dados,
            backgroundColor: dados.map(v => v > 0 ? 'rgba(245,127,23,.75)' : 'rgba(245,127,23,.2)'),
            borderColor: '#f57f17',
            borderWidth: 1.5,
            borderRadius: 4,
            borderSkipped: false
        }]},
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${fmtPeso(ctx.parsed.y)}`,
                        footer: items => {
                            const chave = meses[items[0].dataIndex]?.chave;
                            return [CROSS.mes === chave ? '✅ Filtro ativo — clique para remover' : '🔍 Clique para filtrar por mês'];
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { callback: v => v >= 1000 ? (v/1000).toFixed(1)+'kg' : v+'g', font: { size: 10 } },
                    grid: { color: '#f0f2f8' }
                },
                x: {
                    grid: { display: false },
                    ticks: {
                        font: ctx => ({ size:10, weight: CROSS.mes===meses[ctx.index]?.chave?'bold':'normal' }),
                        color: ctx => CROSS.mes===meses[ctx.index]?.chave ? '#1565c0' : '#666',
                    }
                }
            },
            onClick: (evt, els) => {
                if (!els.length) return;
                const chave = meses[els[0].dataIndex]?.chave;
                if (chave) toggleCross('mes', chave);
            }
        }
    });
}

// ── Gráfico 2: Peso por tipo de droga (barras horizontais) ────────
function renderDrogaTipo() {
    const arr = doAnoX(DADOS.droga, 'drogaTipo');

    // Agrupa peso por tipo
    const pesoPorTipo = {};
    arr.forEach(i => {
        const t = (i.TIPO_DROGA || 'N/D').trim();
        pesoPorTipo[t] = (pesoPorTipo[t] || 0) + parsePeso(i);
    });
    const top = Object.entries(pesoPorTipo)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    const ctx = document.getElementById('chart-droga-tipo')?.getContext('2d');
    if (!ctx) return;
    if (CHARTS['droga-tipo']) CHARTS['droga-tipo'].destroy();
    CHARTS['droga-tipo'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: top.map(([k]) => k),
            datasets: [{
                data: top.map(([,v]) => +v.toFixed(2)),
                backgroundColor: [
                    '#f57f17','#fb8c00','#ffa000','#ffb300',
                    '#ffc107','#ffca28','#ffd54f','#ffe082',
                    '#ffecb3','#fff8e1'
                ],
                borderRadius: 4,
                borderSkipped: false
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${fmtPeso(ctx.parsed.x)}`,
                        footer: items => {
                            const tipo = top[items[0].dataIndex]?.[0];
                            return [CROSS.drogaTipo === tipo ? '✅ Filtro ativo — clique para remover' : '🔍 Clique para filtrar por tipo'];
                        }
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: { callback: v => v >= 1000 ? (v/1000).toFixed(1)+'kg' : v+'g', font: { size: 10 } }
                },
                y: {
                    ticks: {
                        font: ctx => ({ size:10, weight: CROSS.drogaTipo===top[ctx.index]?.[0]?'bold':'normal' }),
                        color: ctx => CROSS.drogaTipo===top[ctx.index]?.[0] ? '#f57f17' : '#666',
                    }
                }
            },
            onClick: (evt, els) => {
                if (!els.length) return;
                const tipo = top[els[0].index]?.[0];
                if (tipo) toggleCross('drogaTipo', tipo);
            }
        }
    });
}

// ── Gráfico 3: Peso por cidade (donut com filtro por tipo) ────────
function renderDrogaCidade() {
    const filtroTipo = document.getElementById('fil-droga-cidade-tipo')?.value || '';
    let arr = doAnoX(DADOS.droga, 'cidade');
    if (filtroTipo) arr = arr.filter(i => (i.TIPO_DROGA || '').trim() === filtroTipo);

    const pesoPorCid = {};
    arr.forEach(i => {
        const c = (i.CIDADE || 'N/D').trim();
        pesoPorCid[c] = (pesoPorCid[c] || 0) + parsePeso(i);
    });
    const top = Object.entries(pesoPorCid)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    const total = top.reduce((s, [,v]) => s + v, 0);

    const ctx = document.getElementById('chart-droga-cidade')?.getContext('2d');
    if (!ctx) return;
    if (CHARTS['droga-cidade']) CHARTS['droga-cidade'].destroy();
    const ativo_dc = CROSS.cidade;
    const coresDC  = ['#f57f17','#fb8c00','#ffa000','#ffb300','#ffc107','#ffd54f','#ffe082','#ffecb3','#e65100','#bf360c'];
    const bgsDC    = coresDC.map((c,i) => !ativo_dc || top[i]?.[0] === ativo_dc ? c : c+'55');
    CHARTS['droga-cidade'] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: top.map(([k]) => k),
            datasets: [{
                data: top.map(([,v]) => +v.toFixed(2)),
                backgroundColor: bgsDC, borderWidth: 2,
                borderColor: top.map(([k]) => k === ativo_dc ? '#e65100' : '#fff'),
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        boxWidth: 10, font: { size: 10 },
                        generateLabels: chart => {
                            const ds = chart.data.datasets[0];
                            return chart.data.labels.map((lbl, i) => ({
                                text: `${lbl} — ${fmtPeso(ds.data[i])} (${total>0?Math.round(ds.data[i]/total*100):0}%)`,
                                fillStyle: bgsDC[i], hidden: false, index: i
                            }));
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${fmtPeso(ctx.parsed)} (${total>0?Math.round(ctx.parsed/total*100):0}%)`,
                        footer: ctx => [ativo_dc === ctx[0]?.label
                            ? '✅ Filtro ativo — clique para remover'
                            : '🔍 Clique para filtrar por cidade']
                    }
                }
            },
            onClick: (evt, els) => {
                if (!els.length) return;
                const cidade = top[els[0].index]?.[0];
                if (cidade) toggleCross('cidade', cidade);
            }
        }
    });
}

// ═══════════════════════════════════════════════════════════════════
// HELPER: Gráfico de barras horizontais
// ═══════════════════════════════════════════════════════════════════
function renderBarH(id, labels, data, colors) {
    renderBarHClicavel(id, labels, data, colors, null, null);
}

// Versão interativa com cross-filter
// crossCampo: campo do CROSS a alternar ('tipificacao', 'cidade', etc.)
// top: array [[label, valor], ...] — para identificar o item clicado
function renderBarHClicavel(id, labels, data, colors, crossCampo, top) {
    const ctx = document.getElementById(id)?.getContext('2d');
    if (!ctx) return;
    if (CHARTS[id]) CHARTS[id].destroy();
    const ativo = crossCampo ? CROSS[crossCampo] : null;
    CHARTS[id] = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 4,
            borderColor: labels.map(l => l === ativo ? '#ff6f00' : 'transparent'),
            borderWidth: labels.map(l => l === ativo ? 2 : 0),
        }] },
        options: {
            indexAxis: 'y',
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: crossCampo ? {
                    callbacks: {
                        footer: items => {
                            const lbl = labels[items[0].dataIndex];
                            return [ativo === lbl ? '✅ Filtro ativo — clique para remover' : '🔍 Clique para filtrar'];
                        }
                    }
                } : {}
            },
            scales: {
                x: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } } },
                y: {
                    ticks: {
                        font: ctx => ({ size:10, weight: labels[ctx.index] === ativo?'bold':'normal' }),
                        color: ctx => labels[ctx.index] === ativo ? '#1565c0' : '#555',
                    }
                }
            },
            onClick: crossCampo ? (evt, els) => {
                if (!els.length) return;
                const valor = labels[els[0].index];
                if (valor) toggleCross(crossCampo, valor);
            } : undefined
        }
    });
}

// ═══════════════════════════════════════════════════════════════════
// ABRIR RELATÓRIO — enxuga campos e grava no localStorage
// ═══════════════════════════════════════════════════════════════════

// Mantém apenas os campos que o relatorio_p3.js realmente lê.
// Isso reduz o payload de ~10–30 MB para ~200–500 KB.
function enxugarGeral(arr) {
    return arr.map(i => ({
        DATA:              i.DATA || i.data || '',
        HORA:              i.HORA || '',
        BOLETIM:           i.BOLETIM || '',
        TIPIFICACAO_GERAL: i.TIPIFICACAO_GERAL || '',
        TIPIFICACAO:       i.TIPIFICACAO || '',
        CIDADE:            i.CIDADE || '',
        BAIRRO:            i.BAIRRO || i.bairro || '',
        SOLICITANTE:       i.SOLICITANTE || '',
        SOLUÇÃO:           i.SOLUÇÃO || i.SOLUCAO || '',
        OBITO:             i.OBITO || 'N',
    }));
}

function enxugarArma(arr) {
    return arr.map(i => ({
        DATA:      i.DATA || i.data || '',
        TIPO_ARMA: i.TIPO_ARMA || i.TIPIFICACAO || '',
        // campo auxiliar para contagemTip no relatório
        TIPIFICACAO:       i.TIPO_ARMA || '',
        TIPIFICACAO_GERAL: '',
    }));
}

function enxugarDroga(arr) {
    return arr.map(i => ({
        DATA:              i.DATA || i.data || '',
        TIPO_DROGA:        i.TIPO_DROGA || '',
        TIPIFICACAO:       i.TIPO_DROGA || '',
        TIPIFICACAO_GERAL: '',
        QUANTIDADE:        i.QUANTIDADE || i.PESO || '0',
    }));
}

function enxugarMinimo(arr) {
    // Para VD, TCO, sossego: só DATA e campos de tipificação/cidade
    return arr.map(i => ({
        DATA:              i.DATA || i.data || '',
        HORA:              i.HORA || '',
        TIPIFICACAO_GERAL: i.TIPIFICACAO_GERAL || '',
        TIPIFICACAO:       i.TIPIFICACAO || '',
        CIDADE:            i.CIDADE || '',
    }));
}

function abrirRelatorio() {
    const grad   = localStorage.getItem('userGraduacao')  || '';
    const nome   = localStorage.getItem('userNomeGuerra') || '';
    const elIni  = document.getElementById('fil-ini');
    const elFim  = document.getElementById('fil-fim');
    const iniStr = elIni?.value || '';
    const fimStr = elFim?.value || '';
    let periodo  = 'Ano corrente (' + ANO_ATUAL + ')';
    if (iniStr || fimStr) periodo = (iniStr || '…') + ' → ' + (fimStr || '…');

    // Monta payload com dados enxutos (apenas campos usados pelo relatório)
    const payload = {
        operador: (grad + ' ' + nome).trim(),
        periodo,
        geradoEm: new Date().toLocaleString('pt-BR'),
        geral:   enxugarGeral(doAno(DADOS.geral)),
        cvpArr:  enxugarGeral(doAno(DADOS.cvp)),
        arma:    enxugarArma(doAno(DADOS.arma)),
        droga:   enxugarDroga(doAno(DADOS.droga)),
        tco:     enxugarMinimo(doAno(DADOS.tco)),
        vd:      enxugarMinimo(doAno(DADOS.vd)),
        sossego: enxugarMinimo(doAno(DADOS.sossego)),
        visitas: enxugarMinimo(doAno(DADOS.visitas)),
    };

    const json = JSON.stringify(payload);
    const kb   = (json.length / 1024).toFixed(0);

    try {
        localStorage.removeItem('p3_relatorio'); // libera espaço antes de gravar
        localStorage.setItem('p3_relatorio', json);
        console.log(`p3_relatorio: ${kb} KB gravados no localStorage.`);
        window.open('../relatorios/relatorio_p3.html', '_blank');
    } catch (e) {
        console.error('QuotaExceeded mesmo após enxugar:', e);
        alert(
            'Os dados ainda excedem o limite do navegador (' + kb + ' KB).\n\n' +
            'Aplique um filtro de período menor no dashboard e tente novamente.'
        );
    }
}

// ═══════════════════════════════════════════════════════════════════
// FILTRO DE PERÍODO
// ═══════════════════════════════════════════════════════════════════
function aplicarPeriodo() {
    const ini = document.getElementById('fil-ini')?.value || '';
    const fim = document.getElementById('fil-fim')?.value || '';
    FILTRO.ini = ini ? new Date(ini + 'T00:00:00') : null;
    FILTRO.fim = fim ? new Date(fim + 'T23:59:59') : null;

    const badge = document.getElementById('badge-periodo');
    if (badge) {
        if (ini || fim) {
            badge.textContent = `Filtro ativo: ${ini || '…'} → ${fim || '…'}`;
            badge.style.display = 'inline';
        } else {
            badge.style.display = 'none';
        }
    }
    atualizarTudo();
}

function limparPeriodo() {
    const elI = document.getElementById('fil-ini');
    const elF = document.getElementById('fil-fim');
    if (elI) elI.value = '';
    if (elF) elF.value = '';
    FILTRO = { ini: null, fim: null };
    const badge = document.getElementById('badge-periodo');
    if (badge) badge.style.display = 'none';
    atualizarTudo();
}

// ════════════════════════════════════════════════════════════════════
// TROCA DE ABA
// ════════════════════════════════════════════════════════════════════
function trocarAba(aba) {
    ABA_ATIVA = aba;
    const geral    = document.getElementById('conteudo-geral');
    const mviCvli  = document.getElementById('conteudo-mvi-cvli');
    const btnGeral = document.getElementById('aba-btn-geral');
    const btnMvi   = document.getElementById('aba-btn-mvi-cvli');

    if (aba === 'geral') {
        if (geral)   geral.style.display   = 'block';
        if (mviCvli) mviCvli.style.display = 'none';
        if (btnGeral) {
            btnGeral.style.background = '#1565c0';
            btnGeral.style.color      = '#fff';
        }
        if (btnMvi) {
            btnMvi.style.background = '#f5f7ff';
            btnMvi.style.color      = '#374263';
        }
    } else {
        if (geral)   geral.style.display   = 'none';
        if (mviCvli) mviCvli.style.display = 'block';
        if (btnGeral) {
            btnGeral.style.background = '#f5f7ff';
            btnGeral.style.color      = '#374263';
        }
        if (btnMvi) {
            btnMvi.style.background = '#6a1b9a';
            btnMvi.style.color      = '#fff';
        }
        renderMviCvli();
    }
}

// ════════════════════════════════════════════════════════════════════
// ABA MVI/CVLI — Funções de filtragem e render
// ════════════════════════════════════════════════════════════════════

// Retorna os dados filtrados conforme configurações da aba MVI/CVLI
function getDadosMviCvli() {
    const ind  = document.getElementById('mcvli-ind')?.value || 'ambos';
    const arr  = DADOS.geral;

    let filtrarFn;
    if (ind === 'cvli')   filtrarFn = isCVLI;
    else if (ind === 'mvi') filtrarFn = isMVI;
    else filtrarFn = i => isMVI(i) || isCVLI(i);

    // Período atual (filtro manual ou ano selecionado)
    const anoSel = parseInt(document.getElementById('mcvli-ano')?.value || ANO_ATUAL);
    const iniEl  = document.getElementById('mcvli-ini')?.value;
    const fimEl  = document.getElementById('mcvli-fim')?.value;

    let atual;
    if (iniEl && fimEl) {
        const di = new Date(iniEl + 'T00:00:00');
        const df = new Date(fimEl + 'T23:59:59');
        atual = arr.filter(i => {
            const d = parseDateStr(i.DATA || i.data || '');
            return d && filtrarFn(i) && d >= di && d <= df;
        });
    } else {
        atual = arr.filter(i => filtrarFn(i) && anoDoRegistro(i) === anoSel);
    }

    // Período de referência para comparação
    const comp  = document.getElementById('mcvli-comp')?.value || 'ano-ant';
    let refAno;
    if (comp === 'ano-ant') refAno = anoSel - 1;
    else if (comp === '2025') refAno = 2025;
    else refAno = anoSel - 1; // fallback para período personalizado

    const ref = arr.filter(i => filtrarFn(i) && anoDoRegistro(i) === refAno);

    return { atual, ref, anoSel, refAno, filtrarFn, ind };
}

// ── KPIs da aba MVI/CVLI ─────────────────────────────────────────
function renderKpisMviCvli(atual, ref, anoSel, refAno) {
    const el = document.getElementById('kpi-mcvli');
    if (!el) return;

    const totalAtual = atual.length;
    const totalRef   = ref.length;
    const delta      = totalAtual - totalRef;
    const pct        = totalRef > 0 ? ((delta / totalRef) * 100).toFixed(1) : '—';
    const sinal      = delta > 0 ? '▲' : delta < 0 ? '▼' : '=';
    const cor        = delta > 0 ? '#c62828' : delta < 0 ? '#2e7d32' : '#555';

    const mviAtual   = atual.filter(isMVI).length;
    const cvliAtual  = atual.filter(isCVLI).length;
    const mviRef     = ref.filter(isMVI).length;
    const cvliRef    = ref.filter(isCVLI).length;

    const kpiDelta = (a, r) => {
        const d = a - r;
        const p = r > 0 ? ((d/r)*100).toFixed(1) : '—';
        const s = d > 0 ? '▲' : d < 0 ? '▼' : '=';
        const c = d > 0 ? '#c62828' : '#2e7d32';
        return `<span style="font-size:.72rem;color:${c};font-weight:bold;">${s}${Math.abs(d)} (${p}%)</span>`;
    };

    el.innerHTML = `
        <div class="kpi-card" style="border-top-color:#6a1b9a;">
            <div class="kpi-label">TOTAL MVI+CVLI (${anoSel})</div>
            <div class="kpi-valor" style="color:#6a1b9a;">${totalAtual}</div>
            <div class="kpi-sub">vs ${totalRef} em ${refAno} ${kpiDelta(totalAtual,totalRef)}</div>
        </div>
        <div class="kpi-card" style="border-top-color:#b71c1c;">
            <div class="kpi-label">MVI (${anoSel})</div>
            <div class="kpi-valor" style="color:#b71c1c;">${mviAtual}</div>
            <div class="kpi-sub">vs ${mviRef} em ${refAno} ${kpiDelta(mviAtual,mviRef)}</div>
        </div>
        <div class="kpi-card" style="border-top-color:#4a148c;">
            <div class="kpi-label">CVLI (${anoSel})</div>
            <div class="kpi-valor" style="color:#4a148c;">${cvliAtual}</div>
            <div class="kpi-sub">vs ${cvliRef} em ${refAno} ${kpiDelta(cvliAtual,cvliRef)}</div>
        </div>
        <div class="kpi-card" style="border-top-color:#1565c0;">
            <div class="kpi-label">VARIAÇÃO GERAL</div>
            <div class="kpi-valor" style="color:${cor};font-size:1.6rem;">${sinal}${Math.abs(delta)}</div>
            <div class="kpi-sub" style="color:${cor};font-weight:bold;">${sinal}${pct}% vs ${refAno}</div>
        </div>`;
}

// ── Comparativo mensal (gráfico de barras + %) ───────────────────
function renderComparativoMensal(atual, ref, anoSel, refAno) {
    const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

    const contarMes = arr => {
        const cnt = Array(12).fill(0);
        arr.forEach(i => { const m = mesDoRegistro(i); if (m !== null) cnt[m]++; });
        return cnt;
    };

    // CVLI: tentativas contam sempre (independente de OBITO)
    // MVI:  tentativas SÓ contam se OBITO = 'S'
    const cntCVLI_atual = contarMes(atual.filter(isCVLI));
    const cntMVI_atual  = contarMes(atual.filter(isMVI));
    const cntCVLI_ref   = contarMes(ref.filter(isCVLI));
    const cntMVI_ref    = contarMes(ref.filter(isMVI));

    // Plugin: % de variação acima das barras do dataset principal
    const pluginPct = (cntA, cntR) => ({
        id: 'var-pct',
        afterDatasetsDraw(chart) {
            const ds0 = chart.getDatasetMeta(0);
            if (!ds0) return;
            const c = chart.ctx;
            c.save();
            meses.forEach((_, i) => {
                const a = cntA[i], r = cntR[i];
                if (a === 0 && r === 0) return;
                const delta = a - r;
                const pct   = r > 0 ? Math.round(delta / r * 100) : null;
                const label = pct === null ? (a > 0 ? '+inf%' : '—') : (delta >= 0 ? '+' : '') + pct + '%';
                const cor   = delta > 0 ? '#c62828' : delta < 0 ? '#2e7d32' : '#888';
                const meta  = ds0.data[i];
                if (!meta) return;
                c.fillStyle = cor;
                c.font = 'bold 9px Arial';
                c.textAlign = 'center';
                c.fillText(label, meta.x, meta.y - 5);
            });
            c.restore();
        }
    });

    const opcoesComuns = (cntA, cntR) => ({
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: { labels: { boxWidth: 12, font: { size: 11 } } },
            tooltip: {
                callbacks: {
                    afterBody: items => {
                        const i = items[0].dataIndex;
                        const d = cntA[i] - cntR[i];
                        const p = cntR[i] > 0 ? ((d/cntR[i])*100).toFixed(1)+'%' : '—';
                        return ['Variação: ' + (d >= 0 ? '+' : '') + d + ' (' + p + ')'];
                    }
                }
            }
        },
        scales: {
            x: { grid: { display: false }, ticks: { font: { size: 10 } } },
            y: { beginAtZero: true, ticks: { precision: 0 } }
        },
        onClick: (evt, els) => {
            if (!els.length) return;
            const chave = anoSel + '-' + String(els[0].index + 1).padStart(2, '0');
            toggleCross('mes', chave);
        }
    });

    // ── Gráfico CVLI ─────────────────────────────────────────────
    const ctxCVLI = document.getElementById('chart-mcvli-cvli') &&
                    document.getElementById('chart-mcvli-cvli').getContext('2d');
    if (ctxCVLI) {
        if (CHARTS['mcvli-cvli']) CHARTS['mcvli-cvli'].destroy();
        CHARTS['mcvli-cvli'] = new Chart(ctxCVLI, {
            type: 'bar',
            data: {
                labels: meses,
                datasets: [
                    { label: 'CVLI ' + anoSel, data: cntCVLI_atual,
                      backgroundColor: 'rgba(106,27,154,.82)', borderRadius: 4 },
                    { label: 'CVLI ' + refAno + ' (ref.)', data: cntCVLI_ref,
                      backgroundColor: 'rgba(186,104,200,.45)', borderRadius: 4 },
                ]
            },
            plugins: [pluginPct(cntCVLI_atual, cntCVLI_ref)],
            options: opcoesComuns(cntCVLI_atual, cntCVLI_ref),
        });
    }

    // ── Gráfico MVI ───────────────────────────────────────────────
    const ctxMVI = document.getElementById('chart-mcvli-mvi') &&
                   document.getElementById('chart-mcvli-mvi').getContext('2d');
    if (ctxMVI) {
        if (CHARTS['mcvli-mvi']) CHARTS['mcvli-mvi'].destroy();
        CHARTS['mcvli-mvi'] = new Chart(ctxMVI, {
            type: 'bar',
            data: {
                labels: meses,
                datasets: [
                    { label: 'MVI ' + anoSel + ' (tent. só c/ óbito)', data: cntMVI_atual,
                      backgroundColor: 'rgba(183,28,28,.82)', borderRadius: 4 },
                    { label: 'MVI ' + refAno + ' (ref.)', data: cntMVI_ref,
                      backgroundColor: 'rgba(229,115,115,.45)', borderRadius: 4 },
                ]
            },
            plugins: [pluginPct(cntMVI_atual, cntMVI_ref)],
            options: opcoesComuns(cntMVI_atual, cntMVI_ref),
        });
    }

    // Tabela de variação: união CVLI ∪ MVI por mês (sem dupla contagem)
    // Homicídio consumado é isCVLI=true E isMVI=true — somar contadores inflaria o total
    const contarMesUniao = arr => {
        const cnt = Array(12).fill(0);
        arr.filter(i => isCVLI(i) || isMVI(i)).forEach(i => {
            const m = mesDoRegistro(i); if (m !== null) cnt[m]++;
        });
        return cnt;
    };
    const totalAtual = contarMesUniao(atual);
    const totalRef   = contarMesUniao(ref);
    renderTabelaVariacao(meses, totalAtual, totalRef, anoSel, refAno);
}

// ── Tabela de variação mês a mês ─────────────────────────────────
function renderTabelaVariacao(meses, cntAtual, cntRef, anoSel, refAno) {
    const tbody  = document.getElementById('tbody-mcvli-variacao');
    const tfoot  = document.getElementById('tfoot-mcvli-variacao');
    if (!tbody) return;

    let totalA = 0, totalR = 0;
    tbody.innerHTML = meses.map((m, i) => {
        const a = cntAtual[i], r = cntRef[i];
        totalA += a; totalR += r;
        const d   = a - r;
        const pct = r > 0 ? ((d/r)*100).toFixed(1) : (a > 0 ? '—' : '—');
        const cor = d > 0 ? '#c62828' : d < 0 ? '#2e7d32' : '#555';
        const sinal = d > 0 ? '▲' : d < 0 ? '▼' : '=';
        const badge = d > 0
            ? `<span class="obito-s" style="background:#c62828;">▲ AUMENTO</span>`
            : d < 0
            ? `<span class="obito-n" style="background:#e8f5e9;color:#2e7d32;border:1px solid #2e7d32;">▼ REDUÇÃO</span>`
            : `<span class="obito-n">= IGUAL</span>`;
        return `<tr>
            <td><strong>${m}</strong></td>
            <td style="text-align:center;font-weight:bold;">${a}</td>
            <td style="text-align:center;">${r}</td>
            <td style="text-align:center;color:${cor};font-weight:bold;">${sinal}${Math.abs(d)} (${pct}%)</td>
            <td style="text-align:center;">${badge}</td>
        </tr>`;
    }).join('');

    const dTot = totalA - totalR;
    const pTot = totalR > 0 ? ((dTot/totalR)*100).toFixed(1) : '—';
    const cTot = dTot > 0 ? '#c62828' : '#2e7d32';
    tfoot.innerHTML = `<tr style="background:#f0f2f8;font-weight:bold;border-top:2px solid #d0d5e8;">
        <td>TOTAL</td>
        <td style="text-align:center;">${totalA}</td>
        <td style="text-align:center;">${totalR}</td>
        <td style="text-align:center;color:${cTot};">${dTot >= 0?'▲':'▼'}${Math.abs(dTot)} (${pTot}%)</td>
        <td style="text-align:center;">${dTot > 0
            ? '<span class="obito-s" style="background:#c62828;">▲ AUMENTO GERAL</span>'
            : '<span class="obito-n" style="background:#e8f5e9;color:#2e7d32;border:1px solid #2e7d32;">▼ REDUÇÃO GERAL</span>'}</td>
    </tr>`;
}

// ── Gráfico por cidade ────────────────────────────────────────────
function renderCidadeMviCvli(atual, ref, anoSel, refAno) {
    const contarCidade = arr => {
        const cnt = {};
        arr.forEach(i => { const c = (i.CIDADE||'N/D').trim(); cnt[c] = (cnt[c]||0)+1; });
        return cnt;
    };
    const cA = contarCidade(atual), cR = contarCidade(ref);
    const cids = [...new Set([...Object.keys(cA), ...Object.keys(cR)])].sort((a,b) => (cA[b]||0)-(cA[a]||0));

    const ctx = document.getElementById('chart-mcvli-cidade')?.getContext('2d');
    if (!ctx) return;
    if (CHARTS['mcvli-cidade']) CHARTS['mcvli-cidade'].destroy();
    CHARTS['mcvli-cidade'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: cids,
            datasets: [
                { label: `${anoSel}`, data: cids.map(c => cA[c]||0), backgroundColor: 'rgba(106,27,154,.8)', borderRadius: 4 },
                { label: `${refAno}`, data: cids.map(c => cR[c]||0), backgroundColor: 'rgba(21,101,192,.5)',  borderRadius: 4 },
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { labels: { boxWidth: 12, font: { size: 11 } } } },
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 10 } } },
                y: { beginAtZero: true, ticks: { precision: 0 } }
            },
            onClick: (evt, els) => {
                if (!els.length) return;
                const cidade = cids[els[0].index];
                if (cidade) toggleCross('cidade', cidade);
            }
        }
    });
}

// ── Heatmap horário MVI/CVLI ──────────────────────────────────────
function renderHoraMviCvli(atual) {
    const el = document.getElementById('heatmap-mcvli-hora');
    if (!el) return;
    const cnt = Array(24).fill(0);
    atual.forEach(i => { const h = parseInt((i.HORA||'').split(':')[0]); if (!isNaN(h) && h >= 0 && h < 24) cnt[h]++; });
    const max = Math.max(...cnt, 1);
    el.innerHTML = '';
    el.className = 'hora-grid';
    cnt.forEach((v, h) => {
        const isAtivo = CROSS.hora === h;
        const alpha   = v === 0 ? 0 : Math.min(1, (v / max) * 1.3);
        const bg      = isAtivo ? '#1565c0' : v === 0 ? '#f0f2f8' : `rgba(106,27,154,${alpha})`;
        const cor     = isAtivo ? '#fff' : v === 0 ? '#bbb' : alpha > 0.5 ? '#fff' : '#333';
        const div     = document.createElement('div');
        div.className = 'hora-cel';
        div.style.cssText = `background:${bg};color:${cor};cursor:pointer;`;
        div.title = `${h}h — ${v} ocorrência(s)`;
        div.textContent = h+'h';
        div.onclick = () => toggleCross('hora', h);
        el.appendChild(div);
    });
}

// ── Tipificações MVI/CVLI ─────────────────────────────────────────
function renderTipMviCvli(atual) {
    const cnt = {};
    atual.forEach(i => { const t = (i.TIPIFICACAO_GERAL||i.TIPIFICACAO||'N/D').trim(); cnt[t]=(cnt[t]||0)+1; });
    const top = Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const cores = ['#6a1b9a','#7b1fa2','#8e24aa','#9c27b0','#ab47bc','#ba68c8','#ce93d8','#e1bee7'];
    renderBarH('chart-mcvli-tip', top.map(x=>x[0]), top.map(x=>x[1]), cores);
}

// ── Dia da semana MVI/CVLI ────────────────────────────────────────
function renderDiasMviCvli(atual) {
    const dias  = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    const cnt   = Array(7).fill(0);
    atual.forEach(i => { const d = parseDateStr(i.DATA||i.data||''); if (d) cnt[d.getDay()]++; });
    const ctx = document.getElementById('chart-mcvli-diasem')?.getContext('2d');
    if (!ctx) return;
    if (CHARTS['mcvli-diasem']) CHARTS['mcvli-diasem'].destroy();
    CHARTS['mcvli-diasem'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: dias,
            datasets: [{ label: 'MVI+CVLI', data: cnt, backgroundColor: 'rgba(106,27,154,.8)', borderRadius: 4 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false } },
                y: { beginAtZero: true, ticks: { precision: 0 } }
            },
            onClick: (evt, els) => {
                if (!els.length) return;
                toggleCross('diaSemana', els[0].index);
            }
        }
    });
}

// ── Tabela de cruzamento MVI/CVLI ─────────────────────────────────
function renderMviCvliCruzamento() {
    const { atual } = getDadosMviCvli();
    const cidade  = norm(document.getElementById('mcvli-crz-cidade')?.value || '');
    const busca   = norm(document.getElementById('mcvli-crz-busca')?.value  || '');

    let lista = aplicarCross(atual);
    if (cidade) lista = lista.filter(i => norm(i.CIDADE||'') === cidade);
    if (busca)  lista = lista.filter(i =>
        norm(JSON.stringify(i)).includes(busca)
    );
    lista = lista.sort((a,b) => {
        const da = parseDateStr(a.DATA||a.data||''), db = parseDateStr(b.DATA||b.data||'');
        return (db||0) - (da||0);
    }).slice(0, 200);

    const tbody = document.getElementById('tbody-mcvli-crz');
    if (!tbody) return;

    tbody.innerHTML = lista.map(i => {
        const tipo = isMVI(i) ? '<span class="badge-tip tip-mvi">MVI</span>'
                               : '<span class="badge-tip tip-cvli">CVLI</span>';
        const obito = (i.OBITO||'').toUpperCase() === 'S'
            ? '<span class="obito-s">SIM</span>' : '<span class="obito-n">NÃO</span>';
        return `<tr>
            <td>${i.BOLETIM||'—'}</td>
            <td>${i.DATA||'—'}</td>
            <td>${(i.HORA||'—').substring(0,5)}</td>
            <td>${(i.TIPIFICACAO_GERAL||i.TIPIFICACAO||'—').substring(0,35)}</td>
            <td>${i.BAIRRO||'—'}</td>
            <td>${i.CIDADE||'—'}</td>
            <td>${obito}</td>
            <td>${tipo}</td>
        </tr>`;
    }).join('');
    document.getElementById('mcvli-crz-contador').textContent =
        `Exibindo ${lista.length} ocorrência(s)`;
}

// ── Orquestrador principal da aba MVI/CVLI ────────────────────────
function renderMviCvli() {
    const { atual, ref, anoSel, refAno } = getDadosMviCvli();
    // Aplica cross-filter
    const atualFilt = aplicarCross(atual);

    renderKpisMviCvli(atualFilt, ref, anoSel, refAno);
    renderComparativoMensal(atualFilt, ref, anoSel, refAno);
    renderCidadeMviCvli(atualFilt, ref, anoSel, refAno);
    renderHoraMviCvli(atualFilt);
    renderTipMviCvli(atualFilt);
    renderDiasMviCvli(atualFilt);
    renderMviCvliCruzamento();
}

function atualizarTudo() {
    if (ABA_ATIVA === 'mvi-cvli') {
        renderMviCvli();
        return;
    }
    renderKPIs();
    renderTemporal();
    renderTipCVLI();
    renderTipCVP();
    renderCidade();
    renderHeatmap();
    renderDiaSemana();
    popularSelectsDroga();
    renderDrogaMes();
    renderDrogaTipo();
    renderDrogaCidade();
    renderVdSossVisitas();
    renderTCO();
    renderCruzamento();
    renderChipsCross();
}

// ═══════════════════════════════════════════════════════════════════
// RELÓGIO
// ═══════════════════════════════════════════════════════════════════
function startRelogio() {
    const atualizar = () => {
        const n = new Date();
        const opts = { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' };
        const el1 = document.getElementById('relogio');
        const el2 = document.getElementById('dash-relogio');
        const str = `${n.toLocaleDateString('pt-BR', opts)} | ${n.toLocaleTimeString('pt-BR')}`;
        if (el1) el1.innerHTML = str;
        if (el2) el2.innerHTML = str;
    };
    atualizar();
    setInterval(atualizar, 1000);
}

// ═══════════════════════════════════════════════════════════════════
// LOGIN / LOGOUT
// ═══════════════════════════════════════════════════════════════════
function checkLogin() {
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
    checkLogin();

    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) btnLogout.addEventListener('click', () => {
        localStorage.clear();
        window.location.href = '../page/login.html';
    });

    try {
        await carregarTudo();
        renderizar();
    } catch (err) {
        console.error('Erro ao carregar dashboard:', err);
        const main = document.getElementById('dash-main');
        if (main) main.innerHTML = `<div class="loader-dash" style="color:#b71c1c;">
            <i class="fas fa-exclamation-triangle"></i>
            Erro ao carregar dados: ${err.message}
        </div>`;
    }
});