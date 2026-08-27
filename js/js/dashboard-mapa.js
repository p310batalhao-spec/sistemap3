// ═══════════════════════════════════════════════════════════════════
// MAPA DE CALOR — Dashboard P3 / 10º BPM
// Leaflet + Leaflet.heat (heatmap) + MarkerCluster
// Camadas: CVP | CVLI | MVI | DROGA | ARMA | SOSSEGO | VD | MANDADOS | TCO | CCP
// ═══════════════════════════════════════════════════════════════════

// ── Configuração das camadas ──────────────────────────────────────
const CAMADAS_CONFIG = [
    {
        id:     'cvp',
        label:  'CVP — Crimes Violentos Patrimoniais',
        icon:   '🔶',
        cor:    '#a75c00',
        corHex: [230, 81, 0],
        noFB:   'cvp',
        filtro: null   // usa todos os registros do nó
    },
    {
        id:     'cvli',
        label:  'CVLI — Crimes Violentos Letais Intencionais',
        icon:   '💀',
        cor:    '#6a1b9a',
        corHex: [106, 27, 154],
        noFB:   'cvli',
        filtro: null
    },
    {
        id:     'droga',
        label:  'Drogas Apreendidas',
        icon:   '🌿',
        cor:    '#002206',
        corHex: [245, 127, 23],
        noFB:   'droga',
        filtro: null
    },
    {
        id:     'arma',
        label:  'Armas Apreendidas',
        icon:   '🔫',
        cor:    '#3d5f3e',
        corHex: [46, 125, 50],
        noFB:   'arma',
        filtro: null
    },
    {
        id:     'sossego',
        label:  'Perturbação do Sossego',
        icon:   '📢',
        cor:    '#00695c',
        corHex: [0, 105, 92],
        noFB:   'sossego',
        filtro: null
    },
    {
        id:     'vd',
        label:  'Violência Doméstica',
        icon:   '🏠',
        cor:    '#b500b2',
        corHex: [173, 20, 87],
        noFB:   'violencia_domestica',
        filtro: null
    },
    {
        id:     'mvi',
        label:  'MVI — Mortes Violentas Intencionais',
        icon:   '☠️',
        cor:    '#b71c1c',
        corHex: [183, 28, 28],
        noFB:   'cvli',
        filtro: 'mvi'
    },
    {
        id:     'mandados',
        label:  'Cumprimento de Mandados',
        icon:   '📋',
        cor:    '#080808',
        corHex: [55, 71, 79],
        noFB:   'mandados',
        filtro: null
    },
    {
        id:     'tco',
        label:  'TCO — Termo Circunstanciado de Ocorrência',
        icon:   '📑',
        cor:    '#1565c0',
        corHex: [21, 101, 192],
        noFB:   'tco',
        filtro: 'tco'
    },
    {
        id:     'ccp',
        label:  'CCP — Crimes Contra o Patrimônio',
        icon:   '🏚️',
        cor:    '#4e342e',
        corHex: [78, 52, 46],
        noFB:   'geral',
        filtro: 'ccp'  // furto | tentativa de furto | dano | invasão de domicílio
    },
        {
        id:     'visitas',
        label:  'Visitas Orientativas',
        icon:   '🏘️',
        cor:    '#72f3ff',
        corHex: [0, 131, 143],
        noFB:   'geral',
        filtro: 'visitas'
    }
];

// ── Estado do mapa ────────────────────────────────────────────────
let _mapaL         = null;        // instância Leaflet
let _heatLayers    = {};          // { id: heatLayer }
let _clusterGroups = {};          // { id: markerClusterGroup }
let _dadosMapa     = {};          // { id: [{lat,lng,info},...] }
let _camadasAtivas = new Set(['cvp','cvli','droga','arma','sossego','vd','mvi','mandados','tco','ccp','visitas']); // todas ativas por padrão
let _modoVista     = 'heat';      // 'heat' | 'cluster' | 'ambos'
let _mapaIniciado  = false;

// ── Paletas de gradiente por camada ──────────────────────────────
function gradientePara(corHex) {
    const [r, g, b] = corHex;
    return {
        0.0: 'rgba(255,255,255,0)',
        0.2: `rgba(${r},${g},${b},0.15)`,
        0.4: `rgba(${r},${g},${b},0.40)`,
        0.6: `rgba(${r},${g},${b},0.65)`,
        0.8: `rgba(${r},${g},${b},0.85)`,
        1.0: `rgb(${r},${g},${b})`
    };
}

// ── Parse de coordenada (vírgula ou ponto decimal) ────────────────
function parseDec(v) {
    if (v === null || v === undefined) return NaN;
    return parseFloat(String(v).replace(',', '.').trim());
}

// ── Validação de coordenada dentro de Alagoas ─────────────────────
function coordValida(lat, lng) {
    return !isNaN(lat) && !isNaN(lng)
        && lat !== 0 && lng !== 0
        && lat >= -11.0 && lat <= -7.0
        && lng >= -38.5 && lng <= -34.5;
}

// ── Extrai pontos válidos de um array de registros ────────────────
function extrairPontos(registros, cfg) {
    const pontos = [];
    for (const item of registros) {
        const lat = parseDec(item.LATITUDE  || item.latitude);
        const lng = parseDec(item.LONGITUDE || item.longitude);
        if (!coordValida(lat, lng)) continue;
        pontos.push({
            lat,
            lng,
            cidade:    item.CIDADE      || '—',
            bairro:    item.BAIRRO      || '—',
            logr:      item.LOGRADOURO  || item.ENDERECO || '—',
            data:      item.DATA        || '—',
            tip:       item.TIPIFICACAO_GERAL || item.TIPIFICACAO || item.TIPO_DROGA || item.TIPO_ARMA || '—',
            boletim:   item.BOLETIM     || '—',
            solucao:   item.SOLUÇÃO     || item.SOLUCAO  || item['SOLUÇÃO'] || '—',
        });
    }
    return pontos;
}

// ── Filtro de período PRÓPRIO do mapa ────────────────────────────
// Independente do filtro global do dashboard
let FILTRO_MAPA = { ini: null, fim: null };

function filtroMapaPeriodo(arr) {
    if (!FILTRO_MAPA.ini && !FILTRO_MAPA.fim) return arr;
    return arr.filter(item => {
        const d = parseDateStr(item.DATA || item.data || '');
        if (!d) return false;
        if (FILTRO_MAPA.ini && d < FILTRO_MAPA.ini) return false;
        if (FILTRO_MAPA.fim && d > FILTRO_MAPA.fim) return false;
        return true;
    });
}

// ── Classificador MVI ────────────────────────────────────────────
// Homicídio, Latrocínio, Feminicídio, Lesão Corporal c/ resultado morte
function ehMVI(item) {
    const t = (item.TIPIFICACAO_GERAL || item.TIPIFICACAO || '').toString()
        .toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // Exclui tentativas sem óbito e achados
    if (t.includes('ACHADO') || t.includes('SUICIDIO') || t.includes('VIOLACAO')) return false;
    if (t.includes('TENTATIVA')) {
        const obito = (item.OBITO || '').toString().toUpperCase().trim();
        return (t.includes('HOMICIDIO') || t.includes('FEMINICIDIO') || t.includes('LATROCINIO'))
            && obito === 'S';
    }
    return t.includes('HOMICIDIO') || t.includes('LATROCINIO') ||
           t.includes('FEMINICIDIO') || t.includes('LESAO CORPORAL COM RESULTADO MORTE') ||
           t.includes('LESAO CORPORAL SEGUIDA DE MORTE');
}

// ── Classificador TCO ────────────────────────────────────────────
// Critério: solução contém "ELABOROU TCO" (normalizado, sem acento)
function ehTCO(item) {
    const s = (item.SOLUÇÃO || item.SOLUCAO || item['SOLUÇÃO'] || '')
        .toString().toUpperCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return s.includes('ELABOROU TCO');
}

// ── Classificador CCP ───────────────────────────────────────────
// Furto | Tentativa de Furto | Dano | Invasão de Domicílio
// Opera sobre o nó /geral (tipificação)
function ehCCP(item) {
    const t = (item.TIPIFICACAO_GERAL || item.TIPIFICACAO || '')
        .toString().toUpperCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '');
    return t.includes('FURTO') ||
           t.includes('DANO')  ||
           t.includes('INVASAO DE DOMICILIO') ||
           t.includes('INVASÃO DE DOMICÍLIO');
}

// ── Classificador VISITAS ───────────────────────────────────────
// Critério: tipificação contém "VISITA" (visitas orientativas)
// Mesmo critério usado no dashboard-p3.js
function ehVisitas(item) {
    const t = (item.TIPIFICACAO_GERAL || item.TIPIFICACAO || '')
        .toString().toUpperCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return t.includes('VISITA');
}

// ── Carrega dados do Firebase para o mapa ─────────────────────────
// Reutiliza DADOS global do dashboard (já carregado)
// Usa FILTRO_MAPA (próprio) — independente do filtro do dashboard
function carregarDadosMapa() {
    const fontes = {
        cvp:      DADOS.cvp,
        cvli:     DADOS.cvli,
        droga:    DADOS.droga,
        arma:     DADOS.arma,
        sossego:  DADOS.sossego,
        vd:       DADOS.vd,
        mvi:      DADOS.cvli,    // MVI deriva do mesmo nó cvli com filtro adicional
        mandados: DADOS.mandados, // nó próprio
        tco:      DADOS.tco,      // nó /tco — filtrado por solução ehTCO
        ccp:      DADOS.geral,     // nó /geral — filtrado por tipificação ehCCP
        visitas:  DADOS.visitas  // nó /geral — filtrado por tipificação ehVisitas
    };

    let totalPontos = 0;
    for (const cfg of CAMADAS_CONFIG) {
        let arr = fontes[cfg.id] || [];

        // Aplica filtros especiais por camada
        if (cfg.filtro === 'mvi') {
            arr = arr.filter(ehMVI);
        }
        if (cfg.filtro === 'tco') {
            arr = arr.filter(ehTCO);
        }
        if (cfg.filtro === 'ccp') {
            arr = arr.filter(ehCCP);
        }
        if (cfg.filtro === 'visitas') {
            arr = arr.filter(ehVisitas);
        }

        // Aplica filtro de período do mapa (independente do dashboard)
        arr = filtroMapaPeriodo(arr);

        _dadosMapa[cfg.id] = extrairPontos(arr, cfg);
        totalPontos += _dadosMapa[cfg.id].length;
    }
    return totalPontos;
}

// ═══════════════════════════════════════════════════════════════════
// INICIALIZAÇÃO DO MAPA
// ═══════════════════════════════════════════════════════════════════
function iniciarMapa() {
    if (_mapaL) { _mapaL.remove(); _mapaL = null; }
    _heatLayers    = {};
    _clusterGroups = {};

    // Centro aproximado do 10º BPM (região de Palmeira dos Índios)
    _mapaL = L.map('mapa-calor', {
        center: [-9.42, -36.63],
        zoom:   10,
        zoomControl: true,
        attributionControl: true
    });

    // ── Camadas de tiles ─────────────────────────────────────────
    const tiles = {
        'Satélite (Esri)': L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            { attribution: 'Esri, Maxar, GeoEye, Earthstar', maxZoom: 19 }
        ),
        'Rua (OpenStreetMap)': L.tileLayer(
            'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            { attribution: '© OpenStreetMap', maxZoom: 19 }
        ),
        'Cinza (CartoDB)': L.tileLayer(
            'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
            { attribution: '© CartoDB', maxZoom: 19 }
        ),
        'Escuro (CartoDB)': L.tileLayer(
            'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
            { attribution: '© CartoDB', maxZoom: 19 }
        )
    };

    // Satélite como padrão (mais próximo do ArcGIS)
    tiles['Satélite (Esri)'].addTo(_mapaL);

    // ── Controle de camadas de tiles ─────────────────────────────
    L.control.layers(tiles, {}, { position: 'topleft', collapsed: true }).addTo(_mapaL);

    // ── Escala ───────────────────────────────────────────────────
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(_mapaL);

    // ── Construir camadas de dados ────────────────────────────────
    construirCamadas();

    // ── Controle de legenda ───────────────────────────────────────
    adicionarLegenda();

    _mapaIniciado = true;
}

// ── Constrói heatLayers e clusterGroups ───────────────────────────
function construirCamadas() {
    // Limpa camadas anteriores
    for (const id in _heatLayers)    { _mapaL.removeLayer(_heatLayers[id]); }
    for (const id in _clusterGroups) { _mapaL.removeLayer(_clusterGroups[id]); }
    _heatLayers    = {};
    _clusterGroups = {};

    for (const cfg of CAMADAS_CONFIG) {
        const pontos = _dadosMapa[cfg.id] || [];
        if (!pontos.length) continue;

        // ── Heat layer ──────────────────────────────────────────
        const heatData = pontos.map(p => [p.lat, p.lng, 1.0]);
        _heatLayers[cfg.id] = L.heatLayer(heatData, {
            radius:    22,
            blur:      18,
            maxZoom:   14,
            gradient:  gradientePara(cfg.corHex),
            minOpacity: 0.25
        });

        // ── Cluster layer com markers ───────────────────────────
        const group = L.markerClusterGroup({
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            maxClusterRadius:    50,
            iconCreateFunction: (cluster) => {
                const count = cluster.getChildCount();
                const size  = count > 100 ? 48 : count > 20 ? 40 : 32;
                return L.divIcon({
                    className: '',
                    html: `<div style="
                        background:${cfg.cor};color:#fff;border-radius:50%;
                        width:${size}px;height:${size}px;
                        display:flex;align-items:center;justify-content:center;
                        font-weight:bold;font-size:${size > 40 ? 13 : 11}px;
                        border:3px solid rgba(255,255,255,0.7);
                        box-shadow:0 2px 8px rgba(0,0,0,0.4);
                    ">${count}</div>`,
                    iconSize: [size, size],
                    iconAnchor: [size/2, size/2]
                });
            }
        });

        for (const p of pontos) {
            const marker = L.circleMarker([p.lat, p.lng], {
                radius:      6,
                fillColor:   cfg.cor,
                color:       '#fff',
                weight:      1.5,
                opacity:     1,
                fillOpacity: 0.85
            });

            // Badge de tipificação — destaque por camada
            let tipBadge;
            if (cfg.id === 'tco') {
                tipBadge = `<div style="background:#e3f2fd;border:1px solid #1565c0;border-radius:4px;
                                padding:3px 8px;margin:4px 0;font-size:11px;color:#0d47a1;font-weight:bold;">
                        📑 ${p.tip}
                    </div>`;
            } else if (cfg.id === 'ccp') {
                tipBadge = `<div style="background:#efebe9;border:1px solid #4e342e;border-radius:4px;
                                padding:3px 8px;margin:4px 0;font-size:11px;color:#3e2723;font-weight:bold;">
                        🏚️ ${p.tip}
                    </div>`;
            } else {
                tipBadge = `<span style="color:#374263;">${p.tip}</span>`;
            }

            const solucaoLinha = (cfg.id === 'tco' || cfg.id === 'ccp')
                ? `<br><b>Solução:</b> <span style="color:${cfg.cor};font-weight:bold;">${p.solucao}</span>`
                : '';

            marker.bindPopup(`
                <div style="font-family:Arial,sans-serif;font-size:12px;min-width:220px;">
                    <div style="background:${cfg.cor};color:#fff;padding:6px 10px;
                                border-radius:6px 6px 0 0;font-weight:bold;margin:-8px -12px 8px;">
                        ${cfg.icon} ${cfg.label}
                    </div>
                    <b>Boletim:</b> ${p.boletim}<br>
                    <b>Data:</b> ${p.data}<br>
                    <b>Tipificação:</b> ${tipBadge}
                    <b>Bairro:</b> ${p.bairro}<br>
                    <b>Logradouro:</b> ${p.logr}<br>
                    <b>Cidade:</b> ${p.cidade}${solucaoLinha}
                </div>
            `, { maxWidth: 300 });

            group.addLayer(marker);
        }
        _clusterGroups[cfg.id] = group;

        // Adiciona ao mapa se camada está ativa
        if (_camadasAtivas.has(cfg.id)) {
            if (_modoVista === 'heat' || _modoVista === 'ambos') {
                _heatLayers[cfg.id].addTo(_mapaL);
            }
            if (_modoVista === 'cluster' || _modoVista === 'ambos') {
                _clusterGroups[cfg.id].addTo(_mapaL);
            }
        }
    }

    atualizarContadores();
}

// ── Atualiza visibilidade das camadas ─────────────────────────────
function atualizarCamadas() {
    for (const cfg of CAMADAS_CONFIG) {
        const ativa = _camadasAtivas.has(cfg.id);

        const hl = _heatLayers[cfg.id];
        const cl = _clusterGroups[cfg.id];

        if (ativa) {
            if ((_modoVista === 'heat' || _modoVista === 'ambos') && hl && !_mapaL.hasLayer(hl)) {
                hl.addTo(_mapaL);
            }
            if ((_modoVista === 'cluster' || _modoVista === 'ambos') && cl && !_mapaL.hasLayer(cl)) {
                cl.addTo(_mapaL);
            }
        }

        if (!ativa || _modoVista === 'cluster') {
            if (hl && _mapaL.hasLayer(hl)) _mapaL.removeLayer(hl);
        }
        if (!ativa || _modoVista === 'heat') {
            if (cl && _mapaL.hasLayer(cl)) _mapaL.removeLayer(cl);
        }

        atualizarContadores();
    }
}

// ── Legenda dinâmica — só exibe camadas/grupos ativos ─────────────
let _legendaControl = null;

function adicionarLegenda() {
    _legendaControl = L.control({ position: 'bottomright' });
    _legendaControl.onAdd = () => {
        const div = L.DomUtil.create('div');
        div.id = 'mapa-legenda';
        div.style.cssText = `
            background:rgba(15,20,40,0.88);color:#eee;
            padding:10px 14px;border-radius:10px;font-family:Arial,sans-serif;
            font-size:11px;min-width:180px;max-width:240px;
            box-shadow:0 4px 16px rgba(0,0,0,0.5);backdrop-filter:blur(4px);
        `;
        return div;
    };
    _legendaControl.addTo(_mapaL);
    atualizarLegenda();
}

function atualizarLegenda() {
    const div = document.getElementById('mapa-legenda');
    if (!div) return;

    // Camadas de ocorrências ativas com pelo menos 1 ponto GPS
    const ativas = CAMADAS_CONFIG.filter(c =>
        _camadasAtivas.has(c.id) && (_dadosMapa[c.id] || []).length > 0
    );

    // Grupos de anotações visíveis no mapa
    const gruposVisiveis = _gruposSalvos.filter(g => g.visivel && g.itens.length > 0);

    // Marcadores/polígonos não salvos (rascunho)
    const temRascunho = _poligonosFeitos.some(p => p) || _marcadoresUser.some(m => m);

    let html = `<div style="font-weight:bold;margin-bottom:8px;font-size:12px;color:#fff;">
        🗺️ Legenda</div>`;

    if (ativas.length === 0 && gruposVisiveis.length === 0 && !temRascunho) {
        html += `<div style="color:rgba(255,255,255,.4);font-size:10px;">Nenhuma camada ativa</div>`;
    }

    ativas.forEach(c => {
        const qtd = (_dadosMapa[c.id] || []).length;
        html += `<div style="display:flex;align-items:center;gap:7px;margin-bottom:5px;">
            <div style="width:12px;height:12px;border-radius:50%;background:${c.cor};
                        flex-shrink:0;box-shadow:0 0 5px ${c.cor};"></div>
            <span style="flex:1;">${c.icon} ${c.label.split('—')[0].trim()}</span>
            <span style="color:rgba(255,255,255,.5);font-size:9px;">${qtd}</span>
        </div>`;
    });

    gruposVisiveis.forEach(g => {
        html += `<div style="display:flex;align-items:center;gap:7px;margin-bottom:5px;">
            <div style="width:12px;height:12px;border-radius:3px;background:${g.cor};
                        flex-shrink:0;"></div>
            <span style="flex:1;">📁 ${g.nome}</span>
            <span style="color:rgba(255,255,255,.5);font-size:9px;">${g.itens.length}</span>
        </div>`;
    });

    if (temRascunho) {
        html += `<div style="display:flex;align-items:center;gap:7px;margin-bottom:5px;">
            <div style="width:12px;height:12px;border-radius:3px;background:#e65100;
                        flex-shrink:0;opacity:.8;"></div>
            <span style="flex:1;">✏️ Rascunho (não salvo)</span>
        </div>`;
    }

    div.innerHTML = html;
}

// ── Atualiza contadores no painel de controle ──────────────────────
function atualizarContadores() {
    for (const cfg of CAMADAS_CONFIG) {
        const el = document.getElementById(`mapa-count-${cfg.id}`);
        if (el) el.textContent = (_dadosMapa[cfg.id] || []).length;
    }
    const total = Object.values(_dadosMapa).reduce((s, a) => s + a.length, 0);
    const elTotal = document.getElementById('mapa-total');
    if (elTotal) elTotal.textContent = total;
    atualizarLegenda();
}

// ═══════════════════════════════════════════════════════════════════
// RENDERIZAÇÃO DA SEÇÃO DO MAPA NO DASHBOARD
// ═══════════════════════════════════════════════════════════════════
function renderMapaCalor() {
    const main = document.getElementById('dash-main');
    if (!main) return;

    // ── Seção título ──────────────────────────────────────────────
    main.insertAdjacentHTML('beforeend', `
        <div class="secao-titulo" style="margin-top:.5rem;">
            <i class="fas fa-map-marked-alt" style="margin-right:.4rem;color:#1a237e;"></i>
            Mapa de Concentração de Ocorrências — Análise Espacial
        </div>
    `);

    // ── Card do mapa ──────────────────────────────────────────────
    main.insertAdjacentHTML('beforeend', `
        <div class="chart-card" id="mapa-card-wrapper" style="padding:0;overflow:hidden;border-radius:12px;">

            <!-- Barra de controle -->
            <div id="mapa-controles" style="
                background:linear-gradient(90deg,#0a1628,#0d2147);
                color:#fff;padding:12px 16px;
                display:flex;flex-wrap:wrap;gap:10px;align-items:center;
            ">
                <!-- Toggle modo visualização -->
                <div style="display:flex;gap:6px;align-items:center;">
                    <span style="font-size:11px;font-weight:bold;opacity:.7;">MODO:</span>
                    <button onclick="setModoMapa('heat')"    id="btn-modo-heat"
                        style="${btnMapaStyle('#1565c0')}">🌡 Calor</button>
                    <button onclick="setModoMapa('cluster')" id="btn-modo-cluster"
                        style="${btnMapaStyle('#374263')}">📍 Pontos</button>
                    <button onclick="setModoMapa('ambos')"   id="btn-modo-ambos"
                        style="${btnMapaStyle('#374263')}">🔀 Ambos</button>
                </div>

                <div style="width:1px;height:28px;background:rgba(255,255,255,.15);"></div>

                <!-- Filtro de período próprio do mapa -->
                <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                    <span style="font-size:11px;font-weight:bold;opacity:.7;">PERÍODO:</span>
                    <input type="date" id="mapa-fil-ini"
                        style="padding:4px 8px;border:1.5px solid rgba(255,255,255,.2);
                               border-radius:6px;font-size:11px;background:rgba(255,255,255,.08);
                               color:#fff;cursor:pointer;"
                        onchange="aplicarFiltroMapa()"
                        title="Data inicial">
                    <span style="font-size:11px;opacity:.5;">até</span>
                    <input type="date" id="mapa-fil-fim"
                        style="padding:4px 8px;border:1.5px solid rgba(255,255,255,.2);
                               border-radius:6px;font-size:11px;background:rgba(255,255,255,.08);
                               color:#fff;cursor:pointer;"
                        onchange="aplicarFiltroMapa()"
                        title="Data final">
                    <button onclick="limparFiltroMapa()"
                        style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);
                               color:#fff;padding:4px 9px;border-radius:6px;cursor:pointer;
                               font-size:11px;" title="Limpar datas">
                        ✕
                    </button>
                    <span id="mapa-badge-periodo"
                        style="display:none;background:#1565c0;color:#fff;
                               font-size:10px;padding:2px 8px;border-radius:10px;font-weight:bold;">
                    </span>
                </div>

                <div style="width:1px;height:28px;background:rgba(255,255,255,.15);"></div>

                <!-- Toggles de camada -->
                <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                    <span style="font-size:11px;font-weight:bold;opacity:.7;">CAMADAS:</span>
                    ${CAMADAS_CONFIG.map(c => `
                        <button onclick="toggleCamadaMapa('${c.id}')" id="btn-camada-${c.id}"
                            style="${btnCamadaStyle(c.cor, true)}"
                            title="${c.label}">
                            ${c.icon}
                            <span style="font-size:10px;">${c.id.toUpperCase()}</span>
                            <span id="mapa-count-${c.id}"
                                style="background:rgba(0,0,0,.3);border-radius:8px;
                                       padding:0 5px;font-size:9px;margin-left:2px;">0</span>
                        </button>
                    `).join('')}
                </div>

                <div style="margin-left:auto;font-size:11px;opacity:.7;">
                    Total com GPS: <strong id="mapa-total" style="color:#fff;">0</strong> registros
                </div>

                <!-- Botão: ajustar zoom para todos os pontos -->
                <button onclick="fitMapaBounds()"
                    style="background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);
                           color:#fff;padding:5px 12px;border-radius:6px;cursor:pointer;
                           font-size:11px;white-space:nowrap;">
                    ⛶ Ajustar Zoom
                </button>

                <!-- Botão: tela cheia -->
                <button onclick="toggleTelaCheiaMapa()" id="btn-tela-cheia"
                    style="background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);
                           color:#fff;padding:5px 12px;border-radius:6px;cursor:pointer;
                           font-size:11px;white-space:nowrap;" title="Tela cheia">
                    ⛶ Tela Cheia
                </button>
            </div>

            <!-- Segunda barra: ferramentas de edição + exportação -->
            <div id="mapa-ferramentas" style="
                background:rgba(10,22,40,0.97);color:#fff;
                padding:8px 16px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;
                border-top:1px solid rgba(255,255,255,.08);
            ">
                <span style="font-size:11px;font-weight:bold;opacity:.6;">FERRAMENTAS:</span>

                <!-- Desmarcar todas -->
                <button onclick="desmarcarTodasCamadas()" id="btn-desmarcar-todas"
                    title="Desmarcar todas as camadas"
                    style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);
                           color:#fff;padding:5px 11px;border-radius:6px;cursor:pointer;font-size:11px;">
                    ☐ Desmarcar Todas
                </button>

                <!-- Marcar todas -->
                <button onclick="marcarTodasCamadas()" id="btn-marcar-todas"
                    title="Marcar todas as camadas"
                    style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);
                           color:#fff;padding:5px 11px;border-radius:6px;cursor:pointer;font-size:11px;">
                    ☑ Marcar Todas
                </button>

                <div style="width:1px;height:22px;background:rgba(255,255,255,.12);"></div>

                <!-- Desenhar polígono -->
                <button onclick="toggleDesenharPoligono()" id="btn-poligono"
                    title="Desenhar polígono de área"
                    style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);
                           color:#fff;padding:5px 11px;border-radius:6px;cursor:pointer;font-size:11px;">
                    🔷 Polígono
                </button>

                <!-- Adicionar marcador -->
                <button onclick="toggleAdicionarMarcador()" id="btn-add-marcador"
                    title="Clique no mapa para adicionar um marcador com nota"
                    style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);
                           color:#fff;padding:5px 11px;border-radius:6px;cursor:pointer;font-size:11px;">
                    📌 Marcador
                </button>

                <!-- Salvar rascunho como grupo -->
                <button onclick="salvarComoGrupo()"
                    title="Salvar polígonos e marcadores atuais como grupo no Firebase"
                    style="background:rgba(46,125,50,.6);border:1px solid rgba(76,175,80,.5);
                           color:#fff;padding:5px 11px;border-radius:6px;cursor:pointer;font-size:11px;">
                    💾 Salvar Grupo
                </button>

                <!-- Gerenciar grupos salvos -->
                <button onclick="abrirPainelGrupos()"
                    title="Visualizar e gerenciar grupos salvos no Firebase"
                    style="background:rgba(21,101,192,.5);border:1px solid rgba(33,150,243,.4);
                           color:#fff;padding:5px 11px;border-radius:6px;cursor:pointer;font-size:11px;">
                    📁 Grupos
                </button>

                <!-- Importar GeoJSON (shapefile exportado do leitor) -->
                <input type="file" id="inp-geojson-import" accept=".geojson,.json"
                    style="display:none;" onchange="importarGeojsonArquivo(event)">
                <button onclick="document.getElementById('inp-geojson-import').click()"
                    title="Importar arquivo GeoJSON exportado do Leitor de Shapefile"
                    style="background:rgba(0,229,255,.12);border:1px solid rgba(0,229,255,.25);
                           color:#00e5ff;padding:5px 11px;border-radius:6px;cursor:pointer;font-size:11px;
                           font-weight:bold;">
                    📂 Importar GeoJSON
                </button>

                <!-- Limpar rascunhos (não salvos) -->
                <button onclick="limparDesenhos()"
                    title="Remover polígonos e marcadores não salvos (rascunhos)"
                    style="background:rgba(180,28,28,.4);border:1px solid rgba(220,50,50,.4);
                           color:#fff;padding:5px 11px;border-radius:6px;cursor:pointer;font-size:11px;">
                    🗑 Limpar Rascunhos
                </button>

                <div style="width:1px;height:22px;background:rgba(255,255,255,.12);"></div>

                <!-- Imprimir -->
                <button onclick="imprimirMapa()"
                    title="Imprimir o mapa"
                    style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);
                           color:#fff;padding:5px 11px;border-radius:6px;cursor:pointer;font-size:11px;">
                    🖨 Imprimir
                </button>

                <!-- Exportar -->
                <div style="position:relative;display:inline-block;">
                    <button onclick="toggleMenuExportar()" id="btn-exportar"
                        title="Exportar mapa"
                        style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);
                               color:#fff;padding:5px 11px;border-radius:6px;cursor:pointer;font-size:11px;">
                        💾 Exportar ▾
                    </button>
                    <div id="menu-exportar" style="
                        display:none;position:absolute;bottom:calc(100% + 6px);left:0;
                        background:#0d2147;border:1px solid rgba(255,255,255,.2);
                        border-radius:8px;overflow:hidden;min-width:140px;
                        box-shadow:0 4px 16px rgba(0,0,0,.5);z-index:9999;
                    ">
                        <button onclick="exportarMapa('png')"
                            style="display:block;width:100%;padding:9px 14px;background:transparent;
                                   border:none;color:#fff;text-align:left;cursor:pointer;font-size:11px;"
                            onmouseover="this.style.background='rgba(255,255,255,.1)'"
                            onmouseout="this.style.background='transparent'">
                            🖼 Exportar PNG
                        </button>
                        <button onclick="exportarMapa('jpeg')"
                            style="display:block;width:100%;padding:9px 14px;background:transparent;
                                   border:none;color:#fff;text-align:left;cursor:pointer;font-size:11px;"
                            onmouseover="this.style.background='rgba(255,255,255,.1)'"
                            onmouseout="this.style.background='transparent'">
                            📷 Exportar JPEG
                        </button>
                        <button onclick="exportarMapa('json')"
                            style="display:block;width:100%;padding:9px 14px;background:transparent;
                                   border:none;color:#fff;text-align:left;cursor:pointer;font-size:11px;"
                            onmouseover="this.style.background='rgba(255,255,255,.1)'"
                            onmouseout="this.style.background='transparent'">
                            📄 Exportar JSON (GeoJSON)
                        </button>
                    </div>
                </div>

                <!-- Status da ferramenta ativa -->
                <span id="mapa-status-ferramenta"
                    style="font-size:10px;opacity:.7;margin-left:4px;"></span>
            </div>

            <!-- Container do mapa -->
            <div id="mapa-calor" style="width:100%;height:580px;"></div>

            <!-- Zona de hover no topo — ativa barras no fullscreen -->
            <div id="mapa-hover-trigger"></div>

            <!-- Rodapé informativo -->
            <div style="
                background:#0a1628;color:rgba(255,255,255,.5);
                padding:7px 16px;font-size:10px;
                display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;
            ">
                <span>🛰 Camadas de base: Satélite (Esri) · Rua (OSM) · Cinza/Escuro (CartoDB)</span>
                <span>ℹ Apenas registros com coordenadas GPS válidas são exibidos.</span>
            </div>
        </div>
    `);

    // ── Carregar bibliotecas e iniciar ────────────────────────────
    carregarLibsMapaEIniciar();
}

function btnMapaStyle(bg) {
    return `background:${bg};border:none;color:#fff;padding:5px 11px;
            border-radius:6px;cursor:pointer;font-size:11px;font-weight:bold;
            transition:opacity .15s;`;
}

function btnCamadaStyle(cor, ativo) {
    return `background:${ativo ? cor : 'rgba(255,255,255,.08)'};
            border:1.5px solid ${ativo ? cor : 'rgba(255,255,255,.15)'};
            color:#fff;padding:4px 9px;border-radius:6px;cursor:pointer;
            font-size:11px;font-weight:bold;display:flex;align-items:center;gap:4px;
            transition:all .15s;`;
}

// ── Carrega Leaflet + Leaflet.heat + MarkerCluster dinamicamente ───
function carregarLibsMapaEIniciar() {
    const libs = [
        'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
        'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css',
        'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css',
    ];
    libs.forEach(href => {
        if (!document.querySelector(`link[href="${href}"]`)) {
            const l = document.createElement('link');
            l.rel = 'stylesheet'; l.href = href;
            document.head.appendChild(l);
        }
    });

    const scripts = [
        { src: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', check: () => window.L },
        { src: 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js', check: () => window.L && L.MarkerClusterGroup },
        { src: 'https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js', check: () => window.L && L.heatLayer },
    ];

    function carregarProximo(idx) {
        if (idx >= scripts.length) {
            // Todas as libs carregadas
            const total = carregarDadosMapa();
            iniciarMapa();
            atualizarContadores();
            document.getElementById('mapa-total').textContent = total;
            carregarGrupos();    // carrega grupos salvos no Firebase
            return;
        }
        const s = scripts[idx];
        if (s.check()) { carregarProximo(idx + 1); return; }
        const el = document.createElement('script');
        el.src = s.src;
        el.onload = () => carregarProximo(idx + 1);
        el.onerror = () => {
            console.warn('Falha ao carregar:', s.src);
            carregarProximo(idx + 1);
        };
        document.head.appendChild(el);
    }
    carregarProximo(0);
}

// ═══════════════════════════════════════════════════════════════════
// CONTROLES INTERATIVOS
// ═══════════════════════════════════════════════════════════════════

// Alterna modo de visualização: calor | cluster | ambos
function setModoMapa(modo) {
    _modoVista = modo;

    // Atualiza estilo dos botões
    ['heat','cluster','ambos'].forEach(m => {
        const btn = document.getElementById(`btn-modo-${m}`);
        if (btn) btn.style.background = m === modo ? '#1565c0' : '#374263';
    });

    atualizarCamadas();
}

// Liga/desliga uma camada
function toggleCamadaMapa(id) {
    if (_camadasAtivas.has(id)) {
        _camadasAtivas.delete(id);
    } else {
        _camadasAtivas.add(id);
    }

    // Atualiza visual do botão
    const cfg = CAMADAS_CONFIG.find(c => c.id === id);
    const btn = document.getElementById(`btn-camada-${id}`);
    if (btn && cfg) {
        const ativo = _camadasAtivas.has(id);
        btn.style.background = ativo ? cfg.cor : 'rgba(255,255,255,.08)';
        btn.style.border     = `1.5px solid ${ativo ? cfg.cor : 'rgba(255,255,255,.15)'}`;
        btn.style.opacity    = ativo ? '1' : '0.5';
    }

    atualizarCamadas();
    atualizarLegenda();
}

// ── Tela cheia — usa Fullscreen API nativa do browser ───────────
// Funciona igual ao Google Maps / ArcGIS: o elemento ocupa 100% da
// tela, os outros elementos da página desaparecem naturalmente.
// O CSS :fullscreen garante que o mapa preencha tudo corretamente.
(function injetarCSSFullscreen() {
    if (document.getElementById('mapa-fullscreen-style')) return;
    const s = document.createElement('style');
    s.id = 'mapa-fullscreen-style';
    s.textContent = `
        /* ── Modal interno do mapa (substitui alert/confirm/prompt) ── */
        .mapa-modal-overlay {
            position: absolute;
            inset: 0;
            background: rgba(0,0,0,.55);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 99999;
            backdrop-filter: blur(2px);
        }
        .mapa-modal-box {
            background: #0d2147;
            border: 1px solid rgba(255,255,255,.2);
            border-radius: 12px;
            padding: 24px 28px;
            min-width: 280px;
            max-width: 420px;
            color: #fff;
            font-family: Arial, sans-serif;
            font-size: 13px;
            box-shadow: 0 8px 32px rgba(0,0,0,.6);
        }
        .mapa-modal-box .mm-title {
            font-size: 14px;
            font-weight: bold;
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .mapa-modal-box .mm-msg {
            color: rgba(255,255,255,.8);
            margin-bottom: 16px;
            line-height: 1.5;
        }
        .mapa-modal-box input[type=text] {
            width: 100%;
            padding: 8px 10px;
            border-radius: 6px;
            border: 1.5px solid rgba(255,255,255,.25);
            background: rgba(255,255,255,.08);
            color: #fff;
            font-size: 13px;
            margin-bottom: 14px;
            outline: none;
            box-sizing: border-box;
        }
        .mapa-modal-box input[type=text]:focus {
            border-color: #42a5f5;
        }
        .mm-btns {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
        }
        .mm-btn {
            padding: 7px 18px;
            border-radius: 6px;
            border: none;
            cursor: pointer;
            font-size: 12px;
            font-weight: bold;
        }
        .mm-btn-ok     { background: #1565c0; color: #fff; }
        .mm-btn-cancel { background: rgba(255,255,255,.12); color: #fff; }
        .mm-btn-danger { background: #c62828; color: #fff; }
        .mm-btn-ok:hover     { background: #1976d2; }
        .mm-btn-cancel:hover { background: rgba(255,255,255,.2); }
        .mm-btn-danger:hover { background: #b71c1c; }
        /* Estado fullscreen nativo — aplicado pelo browser automaticamente */
        #mapa-card-wrapper:fullscreen {
            display: flex;
            flex-direction: column;
            background: #0a1628;
            border-radius: 0 !important;
        }
        #mapa-card-wrapper:-webkit-full-screen {
            display: flex;
            flex-direction: column;
            background: #0a1628;
            border-radius: 0 !important;
        }
        /* Mapa ocupa todo o espaço restante (tela - barra de controle - rodapé) */
        #mapa-card-wrapper:fullscreen #mapa-calor,
        #mapa-card-wrapper:-webkit-full-screen #mapa-calor {
            flex: 1 !important;
            height: auto !important;
            min-height: 0 !important;
        }
        /* Barra de controles continua visível e fixa no topo */
        #mapa-card-wrapper:fullscreen #mapa-controles,
        #mapa-card-wrapper:-webkit-full-screen #mapa-controles {
            flex-shrink: 0;
        }

        /* ── Barras ocultas no fullscreen — deslizam do topo ao hover ── */

        /* #mapa-controles: primeira barra (modo + período) — fica no topo */
        #mapa-card-wrapper:fullscreen #mapa-controles,
        #mapa-card-wrapper:-webkit-full-screen #mapa-controles {
            position: absolute;
            top: 0; left: 0; right: 0;
            z-index: 1001;
            pointer-events: none;
            opacity: 0;
            transform: translateY(-100%);
            transition: transform 0.25s ease, opacity 0.2s ease;
        }

        /* #mapa-ferramentas: segunda barra (ferramentas) — fica logo abaixo da primeira.
           Usamos uma var CSS dinâmica; como não temos a altura exata em CSS puro,
           usamos um translateY negativo maior e deixamos o JS posicionar via top. */
        #mapa-card-wrapper:fullscreen #mapa-ferramentas,
        #mapa-card-wrapper:-webkit-full-screen #mapa-ferramentas {
            position: absolute;
            left: 0; right: 0;
            z-index: 1000;
            pointer-events: none;
            opacity: 0;
            transform: translateY(-200%);
            transition: transform 0.25s ease 0.03s, opacity 0.2s ease 0.03s;
        }

        /* Zona de hover invisível no topo — 56px para capturar o mouse fácil */
        #mapa-card-wrapper:fullscreen #mapa-hover-trigger,
        #mapa-card-wrapper:-webkit-full-screen #mapa-hover-trigger {
            position: absolute;
            top: 0; left: 0; right: 0;
            height: 56px;
            z-index: 999;
            cursor: default;
        }

        /* Estado VISÍVEL — ambas as barras deslizam para dentro da tela */
        #mapa-card-wrapper:fullscreen.barras-visiveis #mapa-controles,
        #mapa-card-wrapper:-webkit-full-screen.barras-visiveis #mapa-controles {
            transform: translateY(0);
            opacity: 1;
            pointer-events: auto;
        }
        #mapa-card-wrapper:fullscreen.barras-visiveis #mapa-ferramentas,
        #mapa-card-wrapper:-webkit-full-screen.barras-visiveis #mapa-ferramentas {
            transform: translateY(0);
            opacity: 1;
            pointer-events: auto;
        }
        /* No fullscreen o mapa calor ocupa tela inteira */
        #mapa-card-wrapper:fullscreen #mapa-calor,
        #mapa-card-wrapper:-webkit-full-screen #mapa-calor {
            position: absolute !important;
            inset: 0 !important;
            height: 100% !important;
            width: 100% !important;
        }
    `;
    document.head.appendChild(s);
})();

function toggleTelaCheiaMapa() {
    const wrapper = document.getElementById('mapa-card-wrapper');
    const btn     = document.getElementById('btn-tela-cheia');
    if (!wrapper) return;

    const estaCheia = !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement
    );

    if (!estaCheia) {
        // Entra em tela cheia
        const fn = wrapper.requestFullscreen || wrapper.webkitRequestFullscreen;
        if (fn) fn.call(wrapper);
    } else {
        // Sai da tela cheia
        const fn = document.exitFullscreen || document.webkitExitFullscreen;
        if (fn) fn.call(document);
    }
}

// Sincroniza o botão, redimensiona Leaflet e configura hover das barras
function _onFullscreenChange() {
    const btn     = document.getElementById('btn-tela-cheia');
    const wrapper = document.getElementById('mapa-card-wrapper');
    const estaCheia = !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement
    );

    if (btn) {
        btn.textContent      = estaCheia ? '✕ Sair da Tela Cheia' : '⛶ Tela Cheia';
        btn.style.background = estaCheia ? 'rgba(220,50,50,.75)' : 'rgba(255,255,255,.1)';
        btn.style.border     = estaCheia ? '1px solid rgba(220,50,50,.5)' : '1px solid rgba(255,255,255,.2)';
    }

    // Configura hover das barras no fullscreen
    if (wrapper) {
        if (estaCheia) {
            _ativarHoverBarras(wrapper);
        } else {
            _desativarHoverBarras(wrapper);
            wrapper.classList.remove('barras-visiveis');
        }
    }

    // Leaflet precisa recalcular tamanho após transição
    setTimeout(() => { if (_mapaL) _mapaL.invalidateSize(); }, 200);
}

// Temporizador para ocultar as barras após inatividade
let _timerOcultarBarras = null;

function _mostrarBarras(wrapper) {
    wrapper.classList.add('barras-visiveis');
    clearTimeout(_timerOcultarBarras);
    _timerOcultarBarras = setTimeout(() => {
        wrapper.classList.remove('barras-visiveis');
    }, 3000); // oculta após 3s sem movimento no topo
}

function _ativarHoverBarras(wrapper) {
    const trigger     = document.getElementById('mapa-hover-trigger');
    const controles   = document.getElementById('mapa-controles');
    const ferramentas = document.getElementById('mapa-ferramentas');

    // Posiciona #mapa-ferramentas logo abaixo de #mapa-controles
    // (aguarda um frame para o layout do fullscreen estabilizar)
    requestAnimationFrame(() => {
        if (controles && ferramentas) {
            const h = controles.getBoundingClientRect().height || controles.offsetHeight || 58;
            ferramentas.style.top = h + 'px';
        }
    });

    // Hover no trigger (topo invisível)
    wrapper._fnTrigger = () => _mostrarBarras(wrapper);
    if (trigger) trigger.addEventListener('mouseenter', wrapper._fnTrigger);

    // Mantém visível enquanto mouse estiver sobre as barras
    wrapper._fnCtrl = () => {
        clearTimeout(_timerOcultarBarras);
    };
    wrapper._fnCtrlLeave = () => {
        _timerOcultarBarras = setTimeout(() => {
            wrapper.classList.remove('barras-visiveis');
        }, 1200);
    };
    if (controles)   { controles.addEventListener('mouseenter',   wrapper._fnCtrl); controles.addEventListener('mouseleave',   wrapper._fnCtrlLeave); }
    if (ferramentas) { ferramentas.addEventListener('mouseenter', wrapper._fnCtrl); ferramentas.addEventListener('mouseleave', wrapper._fnCtrlLeave); }
}

function _desativarHoverBarras(wrapper) {
    const trigger     = document.getElementById('mapa-hover-trigger');
    const controles   = document.getElementById('mapa-controles');
    const ferramentas = document.getElementById('mapa-ferramentas');
    if (trigger     && wrapper._fnTrigger)    trigger.removeEventListener('mouseenter',  wrapper._fnTrigger);
    if (controles   && wrapper._fnCtrl)       controles.removeEventListener('mouseenter', wrapper._fnCtrl);
    if (controles   && wrapper._fnCtrlLeave)  controles.removeEventListener('mouseleave', wrapper._fnCtrlLeave);
    if (ferramentas && wrapper._fnCtrl)       ferramentas.removeEventListener('mouseenter', wrapper._fnCtrl);
    if (ferramentas && wrapper._fnCtrlLeave)  ferramentas.removeEventListener('mouseleave', wrapper._fnCtrlLeave);
    // Limpa o top inline ao sair do fullscreen
    if (ferramentas) ferramentas.style.top = '';
    clearTimeout(_timerOcultarBarras);
}

document.addEventListener('fullscreenchange',       _onFullscreenChange);
document.addEventListener('webkitfullscreenchange', _onFullscreenChange);

// Ajusta zoom para mostrar todos os pontos ativos
function fitMapaBounds() {
    if (!_mapaL) return;
    const allLatLngs = [];
    for (const id of _camadasAtivas) {
        const pontos = _dadosMapa[id] || [];
        pontos.forEach(p => allLatLngs.push([p.lat, p.lng]));
    }
    if (allLatLngs.length > 0) {
        _mapaL.fitBounds(L.latLngBounds(allLatLngs), { padding: [40, 40] });
    }
}

// ── Aplica filtro de período próprio do mapa ──────────────────────
function aplicarFiltroMapa() {
    const ini = document.getElementById('mapa-fil-ini')?.value || '';
    const fim = document.getElementById('mapa-fil-fim')?.value || '';

    FILTRO_MAPA.ini = ini ? new Date(ini + 'T00:00:00') : null;
    FILTRO_MAPA.fim = fim ? new Date(fim + 'T23:59:59') : null;

    const badge = document.getElementById('mapa-badge-periodo');
    if (badge) {
        if (ini || fim) {
            badge.textContent  = `${ini || '…'} → ${fim || '…'}`;
            badge.style.display = 'inline';
        } else {
            badge.style.display = 'none';
        }
    }

    if (_mapaIniciado) {
        carregarDadosMapa();
        construirCamadas();
    }
}

function limparFiltroMapa() {
    const elI = document.getElementById('mapa-fil-ini');
    const elF = document.getElementById('mapa-fil-fim');
    if (elI) elI.value = '';
    if (elF) elF.value = '';
    FILTRO_MAPA = { ini: null, fim: null };

    const badge = document.getElementById('mapa-badge-periodo');
    if (badge) badge.style.display = 'none';

    if (_mapaIniciado) {
        carregarDadosMapa();
        construirCamadas();
    }
}

// Atualiza o mapa quando o filtro de período muda
function atualizarMapaComFiltro() {
    if (!_mapaIniciado) return;
    carregarDadosMapa();
    construirCamadas();
}

// ═══════════════════════════════════════════════════════════════════
// MODAIS INTERNOS — substituem alert/confirm/prompt nativos
// Ficam dentro do card do mapa, não saem do fullscreen
// ═══════════════════════════════════════════════════════════════════

// Retorna o container do mapa (funciona dentro e fora do fullscreen)
function _mapaContainer() {
    return document.getElementById('mapa-card-wrapper') || document.body;
}

// Cria e injeta o overlay do modal
function _criarOverlay() {
    const ov = document.createElement('div');
    ov.className = 'mapa-modal-overlay';
    // Impede que cliques no overlay propaguem para o mapa
    ov.addEventListener('click', e => e.stopPropagation());
    _mapaContainer().appendChild(ov);
    return ov;
}

// _mapaAlert(mensagem, titulo?) → Promise<void>
function _mapaAlert(msg, titulo) {
    return new Promise(resolve => {
        const ov  = _criarOverlay();
        ov.innerHTML = `
            <div class="mapa-modal-box">
                <div class="mm-title">ℹ️ ${titulo || 'Aviso'}</div>
                <div class="mm-msg">${msg}</div>
                <div class="mm-btns">
                    <button class="mm-btn mm-btn-ok" id="mm-ok">OK</button>
                </div>
            </div>`;
        const fechar = () => { ov.remove(); resolve(); };
        ov.querySelector('#mm-ok').addEventListener('click', fechar);
        // Enter também fecha
        const onKey = e => { if (e.key === 'Enter') { document.removeEventListener('keydown', onKey); fechar(); } };
        document.addEventListener('keydown', onKey);
    });
}

// _mapaConfirm(mensagem, titulo?) → Promise<boolean>
function _mapaConfirm(msg, titulo) {
    return new Promise(resolve => {
        const ov = _criarOverlay();
        ov.innerHTML = `
            <div class="mapa-modal-box">
                <div class="mm-title">⚠️ ${titulo || 'Confirmação'}</div>
                <div class="mm-msg">${msg}</div>
                <div class="mm-btns">
                    <button class="mm-btn mm-btn-cancel" id="mm-nao">Cancelar</button>
                    <button class="mm-btn mm-btn-danger" id="mm-sim">Confirmar</button>
                </div>
            </div>`;
        const sim = () => { ov.remove(); resolve(true);  };
        const nao = () => { ov.remove(); resolve(false); };
        ov.querySelector('#mm-sim').addEventListener('click', sim);
        ov.querySelector('#mm-nao').addEventListener('click', nao);
        const onKey = e => {
            if (e.key === 'Enter')  { document.removeEventListener('keydown', onKey); sim(); }
            if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); nao(); }
        };
        document.addEventListener('keydown', onKey);
    });
}

// _mapaPrompt(mensagem, titulo?, placeholder?) → Promise<string|null>
function _mapaPrompt(msg, titulo, placeholder) {
    return new Promise(resolve => {
        const ov = _criarOverlay();
        ov.innerHTML = `
            <div class="mapa-modal-box">
                <div class="mm-title">✏️ ${titulo || 'Entrada de dados'}</div>
                <div class="mm-msg">${msg}</div>
                <input type="text" id="mm-input" placeholder="${placeholder || ''}" autocomplete="off">
                <div class="mm-btns">
                    <button class="mm-btn mm-btn-cancel" id="mm-nao">Cancelar</button>
                    <button class="mm-btn mm-btn-ok"     id="mm-ok">OK</button>
                </div>
            </div>`;
        const inp = ov.querySelector('#mm-input');
        inp.focus();
        const ok  = () => { ov.remove(); resolve(inp.value || ''); };
        const nao = () => { ov.remove(); resolve(null); };
        ov.querySelector('#mm-ok').addEventListener('click', ok);
        ov.querySelector('#mm-nao').addEventListener('click', nao);
        const onKey = e => {
            if (e.key === 'Enter')  { document.removeEventListener('keydown', onKey); ok();  }
            if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); nao(); }
        };
        document.addEventListener('keydown', onKey);
    });
}

// ═══════════════════════════════════════════════════════════════════
// FERRAMENTAS DO MAPA
// ═══════════════════════════════════════════════════════════════════

// ── Estado das ferramentas ────────────────────────────────────────
let _modoDesenho      = null;  // null | 'poligono' | 'marcador'
let _pontosPoligono   = [];    // pontos do polígono em construção
let _poligonoTemp     = null;  // polyline de preview
let _poligonosFeitos  = [];    // polígonos NÃO salvos (rascunho)
let _marcadoresUser   = [];    // marcadores NÃO salvos (rascunho)
let _clickHandlerMapa = null;  // listener de click ativo

// ── Grupos salvos no Firebase ─────────────────────────────────────
// { id, nome, cor, visivel, itens:[{tipo:'marcador'|'poligono', lat, lng, nota, coords}] }
let _gruposSalvos     = [];
const FB_GRUPOS_NO    = 'mapa_grupos';  // nó no Firebase

function setStatusFerramenta(txt) {
    const el = document.getElementById('mapa-status-ferramenta');
    if (el) el.textContent = txt;
}

// ── 1. DESMARCAR / MARCAR TODAS AS CAMADAS ───────────────────────
function desmarcarTodasCamadas() {
    for (const cfg of CAMADAS_CONFIG) {
        _camadasAtivas.delete(cfg.id);
        const btn = document.getElementById(`btn-camada-${cfg.id}`);
        if (btn) {
            btn.style.background = 'rgba(255,255,255,.08)';
            btn.style.border     = '1.5px solid rgba(255,255,255,.15)';
            btn.style.opacity    = '0.5';
        }
    }
    atualizarCamadas();
    setStatusFerramenta('Todas as camadas desmarcadas.');
}

function marcarTodasCamadas() {
    for (const cfg of CAMADAS_CONFIG) {
        _camadasAtivas.add(cfg.id);
        const btn = document.getElementById(`btn-camada-${cfg.id}`);
        if (btn) {
            btn.style.background = cfg.cor;
            btn.style.border     = `1.5px solid ${cfg.cor}`;
            btn.style.opacity    = '1';
        }
    }
    atualizarCamadas();
    setStatusFerramenta('Todas as camadas marcadas.');
}

// ── 2. DESENHAR POLÍGONO ─────────────────────────────────────────
function toggleDesenharPoligono() {
    if (_modoDesenho === 'poligono') {
        // Segundo clique no botão = finaliza o polígono atual
        _finalizarPoligono();
        return;
    }
    _limparModoAtivo();
    _modoDesenho = 'poligono';
    _pontosPoligono = [];

    const btn = document.getElementById('btn-poligono');
    if (btn) { btn.style.background = '#e65100'; btn.style.border = '1px solid #e65100'; }

    _mapaL.getContainer().style.cursor = 'crosshair';
    setStatusFerramenta('Clique para adicionar vértices. Clique no botão novamente para fechar o polígono. ESC para cancelar.');

    _clickHandlerMapa = (e) => {
        _pontosPoligono.push([e.latlng.lat, e.latlng.lng]);
        if (_poligonoTemp) _mapaL.removeLayer(_poligonoTemp);
        _poligonoTemp = L.polyline(_pontosPoligono, {
            color: '#e65100', weight: 2.5, dashArray: '6,4', opacity: 0.85
        }).addTo(_mapaL);
    };
    _mapaL.on('click', _clickHandlerMapa);
}

function _finalizarPoligono() {
    if (_pontosPoligono.length < 3) {
        setStatusFerramenta('Mínimo de 3 pontos para fechar um polígono.');
        return;
    }
    if (_poligonoTemp) { _mapaL.removeLayer(_poligonoTemp); _poligonoTemp = null; }

    const pol = L.polygon(_pontosPoligono, {
        color:       '#e65100',
        fillColor:   '#e65100',
        fillOpacity: 0.15,
        weight:      2
    }).addTo(_mapaL);

    // Popup com área e opção de remover
    const area = L.GeometryUtil
        ? L.GeometryUtil.geodesicArea(pol.getLatLngs()[0]).toFixed(0) + ' m²'
        : `${_pontosPoligono.length} vértices`;

    pol.bindPopup(`
        <b>🔷 Área desenhada</b><br>
        Vértices: ${_pontosPoligono.length}<br>
        <button onclick="_removerPoligono(${_poligonosFeitos.length})"
            style="margin-top:6px;background:#c62828;color:#fff;border:none;
                   padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;">
            🗑 Remover este polígono
        </button>
    `).openPopup();

    _poligonosFeitos.push(pol);
    _pontosPoligono = [];
    _limparModoAtivo();
    setStatusFerramenta(`Polígono finalizado (${_poligonosFeitos.length} no mapa).`);
}

function _removerPoligono(idx) {
    const pol = _poligonosFeitos[idx];
    if (pol && _mapaL.hasLayer(pol)) { _mapaL.removeLayer(pol); _mapaL.closePopup(); }
    _poligonosFeitos[idx] = null;
}

// ── 3. ADICIONAR MARCADOR COM NOTA ───────────────────────────────
function toggleAdicionarMarcador() {
    if (_modoDesenho === 'marcador') {
        _limparModoAtivo();
        return;
    }
    _limparModoAtivo();
    _modoDesenho = 'marcador';

    const btn = document.getElementById('btn-add-marcador');
    if (btn) { btn.style.background = '#2e7d32'; btn.style.border = '1px solid #2e7d32'; }

    _mapaL.getContainer().style.cursor = 'cell';
    setStatusFerramenta('Clique no mapa para adicionar um marcador. ESC para cancelar.');

    _clickHandlerMapa = async (e) => {
        const nota = await _mapaPrompt('Adicione uma nota para este marcador (opcional):', 'Novo Marcador', 'Ex: ponto de atenção...') || '';
        const icone = L.divIcon({
            className: '',
            html: `<div style="background:#2e7d32;color:#fff;border-radius:50%;
                               width:28px;height:28px;display:flex;align-items:center;
                               justify-content:center;font-size:16px;
                               border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.5);">📌</div>`,
            iconSize: [28, 28], iconAnchor: [14, 28]
        });

        const m = L.marker([e.latlng.lat, e.latlng.lng], { icon: icone }).addTo(_mapaL);
        const idx = _marcadoresUser.length;
        m.bindPopup(`
            <b>📌 Marcador ${idx + 1}</b><br>
            <b>Lat:</b> ${e.latlng.lat.toFixed(6)}<br>
            <b>Lng:</b> ${e.latlng.lng.toFixed(6)}<br>
            ${nota ? `<b>Nota:</b> ${nota}<br>` : ''}
            <button onclick="_removerMarcadorUser(${idx})"
                style="margin-top:6px;background:#c62828;color:#fff;border:none;
                       padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;">
                🗑 Remover
            </button>
        `).openPopup();

        _marcadoresUser.push(m);
        setStatusFerramenta(`Marcador ${idx + 1} adicionado. Clique para mais ou ESC para sair.`);
    };
    _mapaL.on('click', _clickHandlerMapa);
}

function _removerMarcadorUser(idx) {
    const m = _marcadoresUser[idx];
    if (m && _mapaL.hasLayer(m)) { _mapaL.removeLayer(m); _mapaL.closePopup(); }
    _marcadoresUser[idx] = null;
}

// ── Limpa o modo ativo de desenho ────────────────────────────────
function _limparModoAtivo() {
    _modoDesenho = null;
    if (_clickHandlerMapa) {
        _mapaL.off('click', _clickHandlerMapa);
        _clickHandlerMapa = null;
    }
    if (_poligonoTemp) { _mapaL.removeLayer(_poligonoTemp); _poligonoTemp = null; }
    if (_mapaL) _mapaL.getContainer().style.cursor = '';

    // Restaura estilos dos botões
    const btnPol = document.getElementById('btn-poligono');
    const btnMar = document.getElementById('btn-add-marcador');
    if (btnPol) { btnPol.style.background = 'rgba(255,255,255,.08)'; btnPol.style.border = '1px solid rgba(255,255,255,.2)'; }
    if (btnMar) { btnMar.style.background = 'rgba(255,255,255,.08)'; btnMar.style.border = '1px solid rgba(255,255,255,.2)'; }
}

// ESC cancela o modo ativo
document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && _modoDesenho) {
        _limparModoAtivo();
        setStatusFerramenta('Modo cancelado.');
    }
});

// ── Limpar rascunhos (polígonos/marcadores não salvos) ───────────
async function limparDesenhos() {
    const temRascunho = _poligonosFeitos.some(p => p) || _marcadoresUser.some(m => m);
    if (!temRascunho) {
        setStatusFerramenta('Nenhum rascunho para limpar.');
        return;
    }
    const ok = await _mapaConfirm(
        'Remover todos os polígonos e marcadores <b>não salvos</b> (rascunhos)?<br>' +
        '<small style="opacity:.7">Os grupos salvos no Firebase não serão afetados.</small>',
        'Limpar Rascunhos'
    );
    if (!ok) return;
    _poligonosFeitos.forEach(p => { if (p && _mapaL.hasLayer(p)) _mapaL.removeLayer(p); });
    _marcadoresUser.forEach(m => { if (m && _mapaL.hasLayer(m)) _mapaL.removeLayer(m); });
    _poligonosFeitos = [];
    _marcadoresUser  = [];
    _limparModoAtivo();
    _mapaL.closePopup();
    atualizarLegenda();
    setStatusFerramenta('Rascunhos removidos. Grupos salvos preservados.');
}

// ── 4. IMPRIMIR MAPA ─────────────────────────────────────────────
// Estratégia: captura o mapa via leaflet-image (que lê o canvas real
// do Leaflet incluindo tiles + SVG de polígonos + marcadores),
// coloca a imagem em uma janela de impressão e chama window.print().
async function imprimirMapa() {
    setStatusFerramenta('Preparando impressão...');
    try {
        const imgDataUrl = await _capturarLeafletImage();
        const win = window.open('', '_blank');
        if (!win) {
            await _mapaAlert('O navegador bloqueou a abertura da janela de impressão. Permita popups para este site.', 'Impressão bloqueada');
            setStatusFerramenta('');
            return;
        }
        win.document.write(`<!DOCTYPE html><html><head>
            <title>Mapa P3 — 10º BPM</title>
            <style>
                * { margin:0; padding:0; box-sizing:border-box; }
                body { background:#000; display:flex; align-items:center; justify-content:center; min-height:100vh; }
                img  { max-width:100%; max-height:100vh; object-fit:contain; display:block; }
                @media print {
                    body { background:#fff; }
                    img  { width:100%; height:auto; page-break-inside:avoid; }
                }
            </style></head><body>
            <img src="${imgDataUrl}" onload="window.print();window.close();">
            </body></html>`);
        win.document.close();
    } catch(err) {
        console.error('Impressão:', err);
        await _mapaAlert('Não foi possível preparar a impressão: ' + err.message, 'Erro');
    }
    setStatusFerramenta('');
}

// ── 5. EXPORTAR MAPA ─────────────────────────────────────────────
function toggleMenuExportar() {
    const menu = document.getElementById('menu-exportar');
    if (!menu) return;
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    // Fecha ao clicar fora
    setTimeout(() => {
        document.addEventListener('click', function fechar(e) {
            if (!e.target.closest('#menu-exportar') && !e.target.closest('#btn-exportar')) {
                menu.style.display = 'none';
                document.removeEventListener('click', fechar);
            }
        });
    }, 50);
}

async function exportarMapa(formato) {
    const menu = document.getElementById('menu-exportar');
    if (menu) menu.style.display = 'none';

    // ── Exportar JSON (GeoJSON) ──────────────────────────────────
    if (formato === 'json') {
        const features = [];

        // Pontos de ocorrências por camada
        for (const cfg of CAMADAS_CONFIG) {
            const pontos = _dadosMapa[cfg.id] || [];
            pontos.forEach(p => {
                features.push({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
                    properties: {
                        camada:      cfg.id,
                        label:       cfg.label,
                        boletim:     p.boletim,
                        data:        p.data,
                        tipificacao: p.tip,
                        bairro:      p.bairro,
                        logradouro:  p.logr,
                        cidade:      p.cidade
                    }
                });
            });
        }

        // Polígonos desenhados pelo usuário
        _poligonosFeitos.forEach((pol, i) => {
            if (!pol) return;
            const coords = pol.getLatLngs()[0].map(ll => [ll.lng, ll.lat]);
            coords.push(coords[0]); // fechar o anel
            features.push({
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [coords] },
                properties: { tipo: 'poligono_usuario', indice: i }
            });
        });

        // Marcadores do usuário
        _marcadoresUser.forEach((m, i) => {
            if (!m) return;
            const ll = m.getLatLng();
            features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [ll.lng, ll.lat] },
                properties: { tipo: 'marcador_usuario', indice: i }
            });
        });

        const geojson = JSON.stringify({ type: 'FeatureCollection', features }, null, 2);
        _baixarArquivo(
            new Blob([geojson], { type: 'application/json' }),
            `mapa_p3_${_dataHoje()}.geojson`
        );
        return;
    }

    // ── Exportar PNG / JPEG ──────────────────────────────────────
    // Usa leaflet-image que captura o canvas real do Leaflet:
    // tiles de satélite + heatmap + clusters SVG + polígonos + marcadores
    setStatusFerramenta('Gerando imagem, aguarde...');
    try {
        const dataUrl = await _capturarLeafletImage();
        const tipo    = formato === 'jpeg' ? 'image/jpeg' : 'image/png';
        const ext     = formato === 'jpeg' ? 'jpg' : 'png';

        // Para JPEG converte (PNG->JPEG via canvas)
        let finalUrl = dataUrl;
        if (formato === 'jpeg') {
            const c  = document.createElement('canvas');
            const img = await new Promise((res, rej) => {
                const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl;
            });
            c.width  = img.width;
            c.height = img.height;
            const cx = c.getContext('2d');
            cx.fillStyle = '#0a1628';
            cx.fillRect(0, 0, c.width, c.height);
            cx.drawImage(img, 0, 0);
            finalUrl = c.toDataURL('image/jpeg', 0.92);
        }

        const blob = await fetch(finalUrl).then(r => r.blob());
        _baixarArquivo(blob, `mapa_p3_${_dataHoje()}.${ext}`);
        setStatusFerramenta('✅ Imagem exportada com sucesso.');
        setTimeout(() => setStatusFerramenta(''), 3000);
    } catch (err) {
        console.error('Erro ao exportar:', err);
        await _mapaAlert('Não foi possível exportar o mapa: ' + err.message, 'Erro na exportação');
        setStatusFerramenta('');
    }
}

// ── Captura o mapa via leaflet-image (tiles + SVG + canvas) ──────
// leaflet-image é a biblioteca oficial para exportar mapas Leaflet
// com todas as camadas — incluindo polígonos SVG e marcadores
function _capturarLeafletImage() {
    return new Promise(async (resolve, reject) => {
        // Carrega leaflet-image sob demanda
        if (!window.leafletImage) {
            await new Promise((res, rej) => {
                const sc = document.createElement('script');
                sc.src   = 'https://unpkg.com/leaflet-image@0.4.0/leaflet-image.js';
                sc.onload = res; sc.onerror = rej;
                document.head.appendChild(sc);
            }).catch(() => {
                // Fallback: se leaflet-image falhar ao carregar
                reject(new Error('Não foi possível carregar a biblioteca de exportação.'));
            });
        }

        if (!window.leafletImage) {
            reject(new Error('leafletImage não disponível.'));
            return;
        }

        leafletImage(_mapaL, (err, canvas) => {
            if (err) { reject(err); return; }
            resolve(canvas.toDataURL('image/png'));
        });
    });
}

// ── Helpers de exportação ─────────────────────────────────────────
function _baixarArquivo(blob, nome) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function _dataHoje() {
    return new Date().toISOString().substring(0, 10).replace(/-/g, '');
}

// ═══════════════════════════════════════════════════════════════════
// SISTEMA DE GRUPOS — Salva polígonos e marcadores no Firebase
// ═══════════════════════════════════════════════════════════════════

// ── Carrega grupos do Firebase ────────────────────────────────────
async function carregarGrupos() {
    try {
        const r = await fetch(`${FB_BASE}/${FB_GRUPOS_NO}.json`);
        const d = await r.json();
        _gruposSalvos = [];
        if (!d) return;
        for (const id of Object.keys(d)) {
            _gruposSalvos.push({ id, ...d[id], visivel: true });
        }
        _renderizarGruposNoMapa();
        _renderizarPainelGrupos();
        atualizarLegenda();
    } catch (e) {
        console.warn('Grupos Firebase:', e);
    }
}

// ── Salva um grupo no Firebase ────────────────────────────────────
async function _salvarGrupoFirebase(grupo) {
    const payload = {
        nome:  grupo.nome,
        cor:   grupo.cor,
        itens: grupo.itens
    };
    await fetch(`${FB_BASE}/${FB_GRUPOS_NO}/${grupo.id}.json`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload)
    });
}

// ── Deleta um grupo do Firebase ────────────────────────────────────
async function _deletarGrupoFirebase(id) {
    await fetch(`${FB_BASE}/${FB_GRUPOS_NO}/${id}.json`, { method: 'DELETE' });
}

// ── Salvar rascunho como grupo novo ──────────────────────────────
async function salvarComoGrupo() {
    const temRascunho = _poligonosFeitos.some(p => p) || _marcadoresUser.some(m => m);
    if (!temRascunho) {
        await _mapaAlert('Nenhum polígono ou marcador para salvar.<br>Desenhe algo primeiro.', 'Sem rascunho');
        return;
    }

    const nome = await _mapaPrompt(
        'Nome do grupo (ex: "Área de risco Norte", "Pontos de bloqueio"):',
        'Salvar Grupo', 'Nome do grupo...'
    );
    if (!nome) return;

    const corOpcoes = ['#e65100','#1565c0','#2e7d32','#6a1b9a','#ad1457','#37474f','#f57f17','#00695c'];
    const corIdx    = _gruposSalvos.length % corOpcoes.length;
    const cor       = corOpcoes[corIdx];
    const id        = 'grp_' + Date.now();

    // Serializa itens do rascunho
    const itens = [];
    _poligonosFeitos.forEach(p => {
        if (!p) return;
        const coords = p.getLatLngs()[0].map(ll => ({ lat: ll.lat, lng: ll.lng }));
        itens.push({ tipo: 'poligono', coords });
    });
    _marcadoresUser.forEach(m => {
        if (!m) return;
        const ll   = m.getLatLng();
        const nota = m.getPopup()?.getContent()?.match(/Nota:<\/b> ([^<]+)/)?.[1] || '';
        itens.push({ tipo: 'marcador', lat: ll.lat, lng: ll.lng, nota });
    });

    const grupo = { id, nome, cor, visivel: true, itens };

    setStatusFerramenta('Salvando grupo no Firebase...');
    try {
        await _salvarGrupoFirebase(grupo);
        _gruposSalvos.push(grupo);

        // Remove rascunhos (agora estão no grupo)
        _poligonosFeitos.forEach(p => { if (p && _mapaL.hasLayer(p)) _mapaL.removeLayer(p); });
        _marcadoresUser.forEach(m => { if (m && _mapaL.hasLayer(m)) _mapaL.removeLayer(m); });
        _poligonosFeitos = [];
        _marcadoresUser  = [];

        _renderizarGruposNoMapa();
        _renderizarPainelGrupos();
        atualizarLegenda();
        setStatusFerramenta(`✅ Grupo "${nome}" salvo com ${itens.length} item(ns).`);
        setTimeout(() => setStatusFerramenta(''), 4000);
    } catch (e) {
        await _mapaAlert('Erro ao salvar no Firebase: ' + e.message, 'Erro');
        setStatusFerramenta('');
    }
}

// ── Renderiza grupos salvos no mapa ──────────────────────────────
let _layersGrupos = {}; // { grupoId: [layer, layer, ...] }

function _renderizarGruposNoMapa() {
    // Remove camadas antigas
    for (const id in _layersGrupos) {
        _layersGrupos[id].forEach(l => { if (_mapaL.hasLayer(l)) _mapaL.removeLayer(l); });
    }
    _layersGrupos = {};

    _gruposSalvos.forEach(g => {
        if (!g.visivel) return;
        _layersGrupos[g.id] = [];

        g.itens.forEach(item => {
            let layer;
            if (item.tipo === 'poligono') {
                const latlngs = item.coords.map(c => [c.lat, c.lng]);
                layer = L.polygon(latlngs, {
                    color: g.cor, fillColor: g.cor,
                    fillOpacity: 0.15, weight: 2
                });
                layer.bindPopup(`
                    <div style="font-family:Arial,sans-serif;font-size:12px;">
                        <b>📁 Grupo: ${g.nome}</b><br>
                        <span style="color:${g.cor};font-weight:bold;">🔷 Polígono salvo</span><br>
                        Vértices: ${item.coords.length}
                    </div>`);
            } else {
                const icone = L.divIcon({
                    className: '',
                    html: `<div style="background:${g.cor};color:#fff;border-radius:50%;
                               width:26px;height:26px;display:flex;align-items:center;
                               justify-content:center;font-size:14px;
                               border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.5);">📌</div>`,
                    iconSize: [26, 26], iconAnchor: [13, 26]
                });
                layer = L.marker([item.lat, item.lng], { icon: icone });
                layer.bindPopup(`
                    <div style="font-family:Arial,sans-serif;font-size:12px;">
                        <b>📁 Grupo: ${g.nome}</b><br>
                        <span style="color:${g.cor};font-weight:bold;">📌 Marcador salvo</span><br>
                        ${item.nota ? `<b>Nota:</b> ${item.nota}<br>` : ''}
                        <b>Lat:</b> ${item.lat.toFixed(6)}<br>
                        <b>Lng:</b> ${item.lng.toFixed(6)}
                    </div>`);
            }
            layer.addTo(_mapaL);
            _layersGrupos[g.id].push(layer);
        });
    });
}

// ── Painel de gerenciamento de grupos (modal interno) ─────────────
function abrirPainelGrupos() {
    const existe = document.getElementById('painel-grupos-overlay');
    if (existe) { existe.remove(); return; }

    const ov = _criarOverlay();
    ov.id = 'painel-grupos-overlay';
    ov.style.alignItems = 'flex-start';
    ov.style.padding    = '20px';
    ov.style.overflowY  = 'auto';

    _renderizarPainelGruposConteudo(ov);
}

function _renderizarPainelGrupos() {
    const ov = document.getElementById('painel-grupos-overlay');
    if (ov) _renderizarPainelGruposConteudo(ov);
}

function _renderizarPainelGruposConteudo(ov) {
    const listaHTML = _gruposSalvos.length === 0
        ? `<div style="color:rgba(255,255,255,.4);padding:16px;text-align:center;font-size:12px;">
               Nenhum grupo salvo. Desenhe polígonos/marcadores e clique em "Salvar Grupo".
           </div>`
        : _gruposSalvos.map((g, idx) => `
            <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;
                        border-bottom:1px solid rgba(255,255,255,.08);">
                <!-- Cor e nome -->
                <div style="width:14px;height:14px;border-radius:3px;background:${g.cor};flex-shrink:0;"></div>
                <span style="flex:1;font-size:12px;">${g.nome}
                    <span style="color:rgba(255,255,255,.4);font-size:10px;">
                        (${g.itens.length} item${g.itens.length !== 1 ? 's' : ''})
                    </span>
                </span>
                <!-- Toggle visível -->
                <button onclick="_toggleVisibilidadeGrupo(${idx})"
                    title="${g.visivel ? 'Ocultar' : 'Mostrar'}"
                    style="background:${g.visivel ? '#1565c0' : 'rgba(255,255,255,.1)'};
                           border:none;color:#fff;padding:4px 10px;border-radius:5px;
                           cursor:pointer;font-size:11px;">
                    ${g.visivel ? '👁 Visível' : '🚫 Oculto'}
                </button>
                <!-- Deletar -->
                <button onclick="_deletarGrupo(${idx})"
                    style="background:#c62828;border:none;color:#fff;padding:4px 10px;
                           border-radius:5px;cursor:pointer;font-size:11px;">
                    🗑
                </button>
            </div>`).join('');

    ov.innerHTML = `
        <div class="mapa-modal-box" style="width:100%;max-width:520px;padding:0;overflow:hidden;">
            <div style="background:#0a1e3d;padding:16px 20px;display:flex;
                        align-items:center;justify-content:space-between;">
                <div class="mm-title" style="margin:0;">📁 Grupos de Anotações</div>
                <button onclick="document.getElementById('painel-grupos-overlay').remove()"
                    style="background:transparent;border:none;color:#fff;
                           font-size:18px;cursor:pointer;line-height:1;">✕</button>
            </div>
            <!-- Ações globais -->
            <div style="padding:10px 14px;display:flex;gap:8px;flex-wrap:wrap;
                        border-bottom:1px solid rgba(255,255,255,.1);">
                <button onclick="_mostrarTodosGrupos()"
                    style="background:#1565c0;border:none;color:#fff;padding:5px 12px;
                           border-radius:5px;cursor:pointer;font-size:11px;">
                    ☑ Mostrar Todos
                </button>
                <button onclick="_ocultarTodosGrupos()"
                    style="background:rgba(255,255,255,.1);border:none;color:#fff;padding:5px 12px;
                           border-radius:5px;cursor:pointer;font-size:11px;">
                    ☐ Ocultar Todos
                </button>
            </div>
            <!-- Lista de grupos -->
            <div style="max-height:340px;overflow-y:auto;">${listaHTML}</div>
            <!-- Rodapé -->
            <div style="padding:12px 14px;border-top:1px solid rgba(255,255,255,.1);
                        display:flex;justify-content:flex-end;">
                <button onclick="document.getElementById('painel-grupos-overlay').remove()"
                    class="mm-btn mm-btn-cancel">Fechar</button>
            </div>
        </div>`;
}

function _toggleVisibilidadeGrupo(idx) {
    const g = _gruposSalvos[idx];
    if (!g) return;
    g.visivel = !g.visivel;
    _renderizarGruposNoMapa();
    _renderizarPainelGrupos();
    atualizarLegenda();
}

async function _deletarGrupo(idx) {
    const g = _gruposSalvos[idx];
    if (!g) return;
    const ok = await _mapaConfirm(
        `Excluir permanentemente o grupo <b>"${g.nome}"</b>?<br>
         <small style="opacity:.7">Esta ação remove do Firebase e não pode ser desfeita.</small>`,
        'Excluir Grupo'
    );
    if (!ok) return;
    try {
        await _deletarGrupoFirebase(g.id);
        // Remove layers do mapa
        (_layersGrupos[g.id] || []).forEach(l => { if (_mapaL.hasLayer(l)) _mapaL.removeLayer(l); });
        delete _layersGrupos[g.id];
        _gruposSalvos.splice(idx, 1);
        _renderizarPainelGrupos();
        atualizarLegenda();
        setStatusFerramenta('Grupo excluído.');
    } catch (e) {
        await _mapaAlert('Erro ao excluir: ' + e.message, 'Erro');
    }
}

function _mostrarTodosGrupos() {
    _gruposSalvos.forEach(g => { g.visivel = true; });
    _renderizarGruposNoMapa();
    _renderizarPainelGrupos();
    atualizarLegenda();
}

function _ocultarTodosGrupos() {
    _gruposSalvos.forEach(g => { g.visivel = false; });
    _renderizarGruposNoMapa();
    _renderizarPainelGrupos();
    atualizarLegenda();
}



// ═══════════════════════════════════════════════════════════════════
// IMPORTAÇÃO DE GEOJSON — gerado pelo leitor_shapefile.html
// Lê o arquivo, detecta metadados p3_meta, renderiza no mapa
// e exibe painel de controle de camadas importadas.
// ═══════════════════════════════════════════════════════════════════

let _camadasImportadas = [];  // [{id, nome, cor, icone, feicoes, tipo, layer}]

// ── Handler do input file ─────────────────────────────────────────
function importarGeojsonArquivo(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reseta o input para permitir reimportar o mesmo arquivo
    event.target.value = '';

    setStatusFerramenta('Lendo arquivo...');
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const geojson = JSON.parse(e.target.result);
            _processarGeojsonImportado(geojson, file.name);
        } catch(err) {
            _mapaAlert('Arquivo inválido: ' + err.message, 'Erro ao importar');
            setStatusFerramenta('');
        }
    };
    reader.onerror = () => {
        _mapaAlert('Não foi possível ler o arquivo.', 'Erro');
        setStatusFerramenta('');
    };
    reader.readAsText(file, 'UTF-8');
}

// ── Processa o GeoJSON e extrai metadados P3 ──────────────────────
function _processarGeojsonImportado(geojson, nomeArquivo) {
    if (geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
        _mapaAlert('O arquivo não é um GeoJSON FeatureCollection válido.', 'Formato inválido');
        setStatusFerramenta('');
        return;
    }

    // Lê metadados P3 embutidos (gerados pelo leitor_shapefile)
    const meta = geojson.p3_meta || {};
    const nome  = meta.nome  || nomeArquivo.replace(/\.geojson$/i, '');
    const cor   = meta.cor   || '#00e5ff';
    const icone = meta.icone || '🗺';
    const tipo  = meta.tipo  || geojson.features[0]?.geometry?.type || 'N/D';

    // Renderiza no mapa
    const isPoint = tipo.includes('Point');
    const layer = L.geoJSON(geojson, {
        style: () => ({
            color:       cor,
            fillColor:   cor,
            weight:      isPoint ? 0 : 1.8,
            opacity:     0.9,
            fillOpacity: 0.15
        }),
        pointToLayer: (feat, latlng) => L.circleMarker(latlng, {
            radius:      5,
            fillColor:   cor,
            color:       '#fff',
            weight:      1,
            opacity:     1,
            fillOpacity: 0.9
        }),
        onEachFeature: (feat, layer) => {
            if (!feat.properties || !Object.keys(feat.properties).length) return;
            const linhas = Object.entries(feat.properties).slice(0, 12)
                .map(([k, v]) => `
                    <div style="display:flex;gap:8px;padding:3px 0;
                                border-bottom:1px solid rgba(255,255,255,.06);">
                        <span style="color:#64748b;font-size:10px;
                                     min-width:80px;flex-shrink:0;">${k}</span>
                        <span style="font-size:10px;font-family:monospace;
                                     word-break:break-word;">${v ?? '—'}</span>
                    </div>`).join('');
            layer.bindPopup(`
                <div style="font-family:Arial,sans-serif;min-width:210px;max-width:300px;">
                    <div style="background:${cor};color:#fff;padding:6px 10px;
                                font-weight:bold;font-size:12px;
                                margin:-8px -12px 8px;border-radius:4px 4px 0 0;">
                        ${icone} ${nome}
                    </div>
                    <div style="font-size:9px;color:#64748b;margin-bottom:6px;">
                        ${tipo} · ${nomeArquivo}
                    </div>
                    ${linhas}
                    ${Object.keys(feat.properties).length > 12
                        ? `<div style="font-size:9px;color:#64748b;margin-top:4px;">
                           + ${Object.keys(feat.properties).length - 12} campos adicionais</div>`
                        : ''}
                </div>`, { maxWidth: 320 });
        }
    }).addTo(_mapaL);

    // Ajusta zoom
    try { _mapaL.fitBounds(layer.getBounds(), { padding: [30, 30] }); } catch(e) {}

    const camada = {
        id:      'imp_' + Date.now(),
        nome,
        cor,
        icone,
        tipo,
        feicoes: geojson.features.length,
        arquivo: nomeArquivo,
        visivel: true,
        layer
    };
    _camadasImportadas.push(camada);

    _renderizarPainelImportadas();
    atualizarLegenda();
    setStatusFerramenta(`✅ "${nome}" importado — ${camada.feicoes.toLocaleString('pt-BR')} feições.`);
    setTimeout(() => setStatusFerramenta(''), 5000);
}

// ── Painel de camadas importadas ──────────────────────────────────
function _renderizarPainelImportadas() {
    // Cria wrapper se não existir — injeta após a barra de ferramentas
    let wrapper = document.getElementById('imp-painel-wrapper');
    if (!wrapper) {
        const ferramentas = document.getElementById('mapa-ferramentas');
        if (!ferramentas) return;

        // CSS do painel
        if (!document.getElementById('imp-style')) {
            const s = document.createElement('style');
            s.id = 'imp-style';
            s.textContent = `
                #imp-painel-wrapper {
                    background: rgba(0,229,255,.04);
                    border-top: 1px solid rgba(0,229,255,.15);
                    padding: 8px 16px;
                    display: flex;
                    flex-direction: column;
                    gap: 0;
                }
                .imp-item {
                    display: flex; align-items: center; gap: 8px;
                    padding: 5px 0;
                    border-bottom: 1px solid rgba(255,255,255,.04);
                    font-size: 11px;
                }
                .imp-item:last-child { border-bottom: none; }
                .imp-dot {
                    width: 10px; height: 10px;
                    border-radius: 3px; flex-shrink: 0;
                }
                .imp-btn {
                    background: none; border: none; cursor: pointer;
                    padding: 2px 6px; border-radius: 4px;
                    font-size: 12px; color: rgba(255,255,255,.5);
                    transition: all .15s;
                }
                .imp-btn:hover { background: rgba(255,255,255,.08); color: #fff; }
                .imp-btn-del {
                    background: none; border: none; cursor: pointer;
                    color: rgba(255,71,87,.5); font-size: 12px;
                    padding: 2px 5px; border-radius: 4px;
                    transition: all .15s;
                }
                .imp-btn-del:hover { background: rgba(255,71,87,.12); color: #ff4757; }
            `;
            document.head.appendChild(s);
        }

        wrapper = document.createElement('div');
        wrapper.id = 'imp-painel-wrapper';
        ferramentas.insertAdjacentElement('afterend', wrapper);
    }

    if (!_camadasImportadas.length) {
        wrapper.style.display = 'none';
        return;
    }

    wrapper.style.display = 'flex';
    wrapper.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:7px;flex-wrap:wrap;">
            <span style="font-size:11px;font-weight:bold;
                         color:rgba(0,229,255,.9);letter-spacing:.05em;text-transform:uppercase;">
                📂 GeoJSON Importados (${_camadasImportadas.length})
            </span>
            <button onclick="_toggleTodasImportadas(true)"
                style="background:rgba(0,229,255,.1);border:1px solid rgba(0,229,255,.2);
                       color:#00e5ff;padding:3px 9px;border-radius:4px;
                       cursor:pointer;font-size:10px;font-weight:bold;">
                ☑ Mostrar Todas
            </button>
            <button onclick="_toggleTodasImportadas(false)"
                style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);
                       color:rgba(255,255,255,.4);padding:3px 9px;border-radius:4px;
                       cursor:pointer;font-size:10px;">
                ☐ Ocultar Todas
            </button>
            <button onclick="_removerTodasImportadas()"
                style="background:rgba(255,71,87,.1);border:1px solid rgba(255,71,87,.2);
                       color:#ff4757;padding:3px 9px;border-radius:4px;
                       cursor:pointer;font-size:10px;margin-left:auto;">
                🗑 Remover Todas
            </button>
        </div>
        ${_camadasImportadas.map((c, idx) => `
        <div class="imp-item">
            <div class="imp-dot"
                 style="background:${c.cor};box-shadow:0 0 5px ${c.cor};
                        opacity:${c.visivel ? 1 : 0.3};"></div>
            <span style="flex:1;${!c.visivel ? 'opacity:.4' : ''};">
                ${c.icone} ${c.nome}
            </span>
            <span style="font-size:9px;color:rgba(255,255,255,.25);">
                ${c.feicoes.toLocaleString('pt-BR')} feições
            </span>
            <button class="imp-btn" onclick="_toggleImportada(${idx})"
                title="${c.visivel ? 'Ocultar' : 'Mostrar'}">
                ${c.visivel ? '👁' : '🚫'}
            </button>
            <button class="imp-btn-del" onclick="_removerImportada(${idx})" title="Remover">✕</button>
        </div>`).join('')}`;
}

function _toggleImportada(idx) {
    const c = _camadasImportadas[idx];
    if (!c) return;
    c.visivel = !c.visivel;
    if (c.visivel) c.layer.addTo(_mapaL);
    else _mapaL.removeLayer(c.layer);
    _renderizarPainelImportadas();
    atualizarLegenda();
}

function _toggleTodasImportadas(visivel) {
    _camadasImportadas.forEach(c => {
        c.visivel = visivel;
        if (visivel) c.layer.addTo(_mapaL);
        else _mapaL.removeLayer(c.layer);
    });
    _renderizarPainelImportadas();
    atualizarLegenda();
}

function _removerImportada(idx) {
    const c = _camadasImportadas[idx];
    if (!c) return;
    _mapaL.removeLayer(c.layer);
    _camadasImportadas.splice(idx, 1);
    _renderizarPainelImportadas();
    atualizarLegenda();
    setStatusFerramenta(`Camada "${c.nome}" removida.`);
}

async function _removerTodasImportadas() {
    if (!_camadasImportadas.length) return;
    const ok = await _mapaConfirm(
        `Remover todas as ${_camadasImportadas.length} camada(s) GeoJSON importada(s)?`,
        'Remover Todas'
    );
    if (!ok) return;
    _camadasImportadas.forEach(c => _mapaL.removeLayer(c.layer));
    _camadasImportadas = [];
    const w = document.getElementById('imp-painel-wrapper');
    if (w) w.style.display = 'none';
    atualizarLegenda();
    setStatusFerramenta('Todas as camadas importadas removidas.');
}

// Patch na legenda para incluir camadas importadas
const _atualizarLegendaComImport = atualizarLegenda;
atualizarLegenda = function() {
    _atualizarLegendaComImport();
    const div = document.getElementById('mapa-legenda');
    if (!div) return;
    const ativas = _camadasImportadas.filter(c => c.visivel);
    if (!ativas.length) return;
    div.innerHTML += `
        <div style="height:1px;background:rgba(255,255,255,.08);margin:5px 0;"></div>
        <div style="font-size:9px;font-weight:bold;letter-spacing:.08em;
                    color:rgba(0,229,255,.6);text-transform:uppercase;margin-bottom:5px;">
            GeoJSON
        </div>` +
        ativas.map(c => `
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:5px;">
            <div style="width:12px;height:12px;border-radius:3px;background:${c.cor};
                        flex-shrink:0;box-shadow:0 0 5px ${c.cor};"></div>
            <span style="flex:1;">${c.icone} ${c.nome}</span>
            <span style="color:rgba(255,255,255,.3);font-size:9px;">${c.feicoes.toLocaleString('pt-BR')}</span>
        </div>`).join('');
};