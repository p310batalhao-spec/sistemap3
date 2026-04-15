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
const ehTipoCVLI = t =>
    t.includes('HOMICIDIO') || t.includes('FEMINICIDIO') || t.includes('LATROCINIO');

function isMVI(item) {
    const t     = norm((item.TIPIFICACAO_GERAL || '') + ' ' + (item.TIPIFICACAO || ''));
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
    return arr.filter(i => anoDoRegistro(i) === ANO_ATUAL);
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
            <div class="relogio-dash" id="dash-relogio"></div>
        </div>`;

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

    main.innerHTML += `<div class="kpi-grid" id="kpi-grid"></div>`;
    renderKPIs();

    // ── Gráficos ──────────────────────────────────────────────────
    main.innerHTML += `<div class="secao-titulo"><i class="fas fa-chart-line" style="margin-right:.4rem;"></i>Análise Temporal e por Indicador</div>`;
    main.innerHTML += `<div class="charts-grid" id="charts-grid"></div>`;
    const grid = document.getElementById('charts-grid');

    // Série temporal CVLI + CVP + MVI
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
    main.innerHTML += `<div class="secao-titulo" style="margin-top:.5rem;"><i class="fas fa-chart-bar" style="margin-right:.4rem;"></i>Indicadores Sociais e Comunitários</div>`;
    main.innerHTML += `<div class="charts-grid" id="charts-social"></div>`;
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
    main.innerHTML += `<div class="secao-titulo" style="margin-top:.5rem;"><i class="fas fa-file-alt" style="margin-right:.4rem;color:#1565c0;"></i>TCO — Termos Circunstanciados de Ocorrência</div>`;
    main.innerHTML += `<div class="charts-grid" id="charts-tco"></div>`;
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
    main.innerHTML += `<div class="secao-titulo" style="margin-top:.5rem;"><i class="fas fa-cannabis" style="margin-right:.4rem;color:#f57f17;"></i>Drogas Apreendidas — Análise Detalhada</div>`;
    main.innerHTML += `<div class="charts-grid" id="charts-droga"></div>`;
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
    main.innerHTML += `<div class="secao-titulo" style="margin-top:.5rem;"><i class="fas fa-table" style="margin-right:.4rem;"></i>Cruzamento de Dados</div>`;
    main.innerHTML += `
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

    // ── Mapa de Calor ──────────────────────────────────────────────
    main.insertAdjacentHTML('beforeend', '<div class="secao-titulo" style="margin-top:.5rem;">'
        + '<i class="fas fa-map-marked-alt" style="margin-right:.4rem;color:#1a237e;"></i>'
        + 'Mapa de Concentração de Ocorrências — Análise Espacial</div>');

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
        // Mapa de calor (carrega após o resto para não bloquear)
        if (typeof renderMapaCalor === 'function') renderMapaCalor();
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
    // Sem filtro: ano anterior
    return arr.filter(i => anoDoRegistro(i) === ANO_ATUAL - 1);
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
    const g       = doAno(DADOS.geral);
    const cvli    = g.filter(isCVLI);
    const cvp     = doAno(DADOS.cvp).filter(isCVP);
    const mvi     = g.filter(isMVI);
    const vd      = doAno(DADOS.vd);
    const tco     = doAno(DADOS.tco);
    const arma    = doAno(DADOS.arma);
    const soss    = doAno(DADOS.sossego);
    const visitas = doAno(DADOS.visitas);

    const drogaArr = doAno(DADOS.droga);
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
            if (iso.length >= 7) {
                const chave = iso.substring(0, 7);
                cnt[chave] = (cnt[chave] || 0) + 1;
            }
        });
        return meses.map(m => cnt[m.chave] || 0);
    };

    const geral  = DADOS.geral;
    const cvpArr = DADOS.cvp;

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
                { label: 'CVLI', data: contarPorMes(cvliArr), borderColor: '#6a1b9a', backgroundColor: 'rgba(106,27,154,.1)', fill: true, tension: .35, pointRadius: 4 },
                { label: 'CVP',  data: contarPorMes(cvpFilt),  borderColor: '#e65100', backgroundColor: 'rgba(230,81,0,.08)',  fill: true, tension: .35, pointRadius: 4 },
                { label: 'MVI',  data: contarPorMes(mviArr),  borderColor: '#b71c1c', backgroundColor: 'rgba(183,28,28,.08)', fill: true, tension: .35, pointRadius: 4 },
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { labels: { boxWidth: 12, font: { size: 11 } } } },
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 10 } } },
                y: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } } }
            }
        }
    });
}

// ═══════════════════════════════════════════════════════════════════
// GRÁFICO: TIPIFICAÇÕES CVLI
// ═══════════════════════════════════════════════════════════════════
function renderTipCVLI() {
    const arr  = doAno(DADOS.geral).filter(isCVLI);
    const cnt  = {};
    arr.forEach(i => {
        const t = (i.TIPIFICACAO_GERAL || i.TIPIFICACAO || 'N/D').trim();
        cnt[t]  = (cnt[t] || 0) + 1;
    });
    const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 8);
    renderBarH('chart-tip-cvli', top.map(x => x[0]), top.map(x => x[1]),
        ['#6a1b9a','#7b1fa2','#8e24aa','#9c27b0','#ab47bc','#ba68c8','#ce93d8','#e1bee7']);
}

// ═══════════════════════════════════════════════════════════════════
// GRÁFICO: TIPIFICAÇÕES CVP
// ═══════════════════════════════════════════════════════════════════
function renderTipCVP() {
    const arr = doAno(DADOS.cvp).filter(isCVP);
    const cnt = {};
    arr.forEach(i => {
        const t = (i.TIPIFICACAO_GERAL || i.TIPIFICACAO || 'N/D').trim();
        cnt[t]  = (cnt[t] || 0) + 1;
    });
    const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 8);
    renderBarH('chart-tip-cvp', top.map(x => x[0]), top.map(x => x[1]),
        ['#e65100','#f4511e','#ff5722','#ff7043','#ff8a65','#ffab91','#ffccbc','#fbe9e7']);
}

// ═══════════════════════════════════════════════════════════════════
// GRÁFICO: POR CIDADE
// ═══════════════════════════════════════════════════════════════════
function renderCidade() {
    const ind = document.getElementById('fil-cidade-ind')?.value || 'cvli';
    const mapaArr = {
        cvli:    doAno(DADOS.geral).filter(isCVLI),
        cvp:     doAno(DADOS.cvp).filter(isCVP),
        mvi:     doAno(DADOS.geral).filter(isMVI),
        vd:      doAno(DADOS.vd),
        sossego: doAno(DADOS.sossego),
        visitas: doAno(DADOS.visitas),
        tco:     doAno(DADOS.tco),
    };
    const arr = mapaArr[ind] || [];
    const cnt = {};
    arr.forEach(i => {
        const c = (i.CIDADE || 'N/D').trim();
        cnt[c]  = (cnt[c] || 0) + 1;
    });
    const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const cores = { cvli: '#6a1b9a', cvp: '#e65100', mvi: '#b71c1c', vd: '#ad1457' };

    const ctx = document.getElementById('chart-cidade')?.getContext('2d');
    if (!ctx) return;
    if (CHARTS['cidade']) CHARTS['cidade'].destroy();
    CHARTS['cidade'] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: top.map(x => x[0]),
            datasets: [{ data: top.map(x => x[1]),
                backgroundColor: ['#1a237e','#283593','#303f9f','#3949ab','#3f51b5',
                                   '#5c6bc0','#7986cb','#9fa8da','#c5cae9','#e8eaf6'] }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 } } } }
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
    const arr     = mapaArr[ind] || [];
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
        const alpha = v === 0 ? 0 : Math.min(1, (v / max) * 1.3);
        const bg    = v === 0 ? '#f0f2f8' : `rgba(${rgb},${alpha})`;
        const cor   = v === 0 ? '#bbb' : alpha > 0.5 ? '#fff' : '#333';
        el.innerHTML += `<div class="hora-cel" style="background:${bg};color:${cor};"
            title="${h}h — ${v} ocorrência(s)">${h}h</div>`;
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

    const cvliArr = doAno(DADOS.geral).filter(isCVLI);
    const cvpArr  = doAno(DADOS.cvp).filter(isCVP);
    const mviArr  = doAno(DADOS.geral).filter(isMVI);

    const ctx = document.getElementById('chart-diasemana')?.getContext('2d');
    if (!ctx) return;
    if (CHARTS['diasemana']) CHARTS['diasemana'].destroy();
    CHARTS['diasemana'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: dias,
            datasets: [
                { label: 'CVLI', data: contar(cvliArr), backgroundColor: 'rgba(106,27,154,.75)', borderRadius: 4 },
                { label: 'CVP',  data: contar(cvpArr),  backgroundColor: 'rgba(230,81,0,.75)',   borderRadius: 4 },
                { label: 'MVI',  data: contar(mviArr),  backgroundColor: 'rgba(183,28,28,.75)',  borderRadius: 4 },
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { labels: { boxWidth: 12, font: { size: 11 } } } },
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 11 } } },
                y: { beginAtZero: true, ticks: { precision: 0 } }
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

    const mapaArr = {
        cvli:    doAno(DADOS.geral).filter(isCVLI),
        cvp:     doAno(DADOS.cvp).filter(isCVP),
        mvi:     doAno(DADOS.geral).filter(isMVI),
        vd:      doAno(DADOS.vd),
        tco:     doAno(DADOS.tco),
        sossego: doAno(DADOS.sossego),
        visitas: doAno(DADOS.visitas),
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
    const vdArr  = doAno(DADOS.vd);
    const sArr   = doAno(DADOS.sossego);
    const visArr = doAno(DADOS.visitas);

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
    const arr = doAno(DADOS.tco);

    // Tipificação
    const cntTip = {};
    arr.forEach(i => {
        const t = (i.TIPIFICACAO_GERAL || i.TIPIFICACAO || 'N/D').trim();
        cntTip[t] = (cntTip[t] || 0) + 1;
    });
    const topTip = Object.entries(cntTip).sort((a, b) => b[1] - a[1]).slice(0, 8);
    renderBarH('chart-tco-tip', topTip.map(x => x[0]), topTip.map(x => x[1]),
        ['#1565c0','#1976d2','#1e88e5','#2196f3','#42a5f5','#64b5f6','#90caf9','#bbdefb']);

    // Cidade
    const cntCid = {};
    arr.forEach(i => {
        const c = (i.CIDADE || 'N/D').trim();
        cntCid[c] = (cntCid[c] || 0) + 1;
    });
    const topCid = Object.entries(cntCid).sort((a, b) => b[1] - a[1]).slice(0, 10);

    const ctx = document.getElementById('chart-tco-cidade')?.getContext('2d');
    if (!ctx) return;
    if (CHARTS['tco-cidade']) CHARTS['tco-cidade'].destroy();
    CHARTS['tco-cidade'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: topCid.map(x => x[0]),
            datasets: [{ data: topCid.map(x => x[1]),
                backgroundColor: ['#1565c0','#1976d2','#1e88e5','#2196f3','#42a5f5',
                                   '#64b5f6','#90caf9','#bbdefb','#e3f2fd','#e8eaf6'],
                borderRadius: 4, borderSkipped: false }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { precision: 0 } },
                x: { grid: { display: false }, ticks: { font: { size: 10 } } }
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

    let arr = doAno(DADOS.droga);
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
                        label: ctx => ` ${fmtPeso(ctx.parsed.y)}`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { callback: v => v >= 1000 ? (v/1000).toFixed(1)+'kg' : v+'g', font: { size: 10 } },
                    grid: { color: '#f0f2f8' }
                },
                x: { grid: { display: false }, ticks: { font: { size: 10 } } }
            }
        }
    });
}

// ── Gráfico 2: Peso por tipo de droga (barras horizontais) ────────
function renderDrogaTipo() {
    const arr = doAno(DADOS.droga);

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
                tooltip: { callbacks: { label: ctx => ` ${fmtPeso(ctx.parsed.x)}` } }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: { callback: v => v >= 1000 ? (v/1000).toFixed(1)+'kg' : v+'g', font: { size: 10 } }
                },
                y: { ticks: { font: { size: 10 } } }
            }
        }
    });
}

// ── Gráfico 3: Peso por cidade (donut com filtro por tipo) ────────
function renderDrogaCidade() {
    const filtroTipo = document.getElementById('fil-droga-cidade-tipo')?.value || '';
    let arr = doAno(DADOS.droga);
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
    CHARTS['droga-cidade'] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: top.map(([k]) => k),
            datasets: [{
                data: top.map(([,v]) => +v.toFixed(2)),
                backgroundColor: [
                    '#f57f17','#fb8c00','#ffa000','#ffb300','#ffc107',
                    '#ffd54f','#ffe082','#ffecb3','#e65100','#bf360c'
                ],
                borderWidth: 2,
                borderColor: '#fff',
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        boxWidth: 10,
                        font: { size: 10 },
                        generateLabels: chart => {
                            const ds = chart.data.datasets[0];
                            return chart.data.labels.map((lbl, i) => ({
                                text: `${lbl} — ${fmtPeso(ds.data[i])} (${total > 0 ? Math.round(ds.data[i]/total*100) : 0}%)`,
                                fillStyle: ds.backgroundColor[i],
                                hidden: false, index: i
                            }));
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${fmtPeso(ctx.parsed)} (${total > 0 ? Math.round(ctx.parsed/total*100) : 0}%)`
                    }
                }
            }
        }
    });
}

// ═══════════════════════════════════════════════════════════════════
// HELPER: Gráfico de barras horizontais
// ═══════════════════════════════════════════════════════════════════
function renderBarH(id, labels, data, colors) {
    const ctx = document.getElementById(id)?.getContext('2d');
    if (!ctx) return;
    if (CHARTS[id]) CHARTS[id].destroy();
    CHARTS[id] = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 4 }] },
        options: {
            indexAxis: 'y',
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } } },
                y: { ticks: { font: { size: 10 } } }
            }
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

function atualizarTudo() {
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
    // Atualiza mapa com novo filtro de período
    if (typeof atualizarMapaComFiltro === 'function') atualizarMapaComFiltro();
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