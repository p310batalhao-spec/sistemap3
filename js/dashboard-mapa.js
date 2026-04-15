// ═══════════════════════════════════════════════════════════════════
// MAPA DE CALOR — Dashboard P3 / 10º BPM
// Leaflet + Leaflet.heat (heatmap) + MarkerCluster
// Camadas: CVP | CVLI | MVI | DROGA | ARMA | SOSSEGO | VD
// ═══════════════════════════════════════════════════════════════════

// ── Configuração das camadas ──────────────────────────────────────
const CAMADAS_CONFIG = [
    {
        id:     'cvp',
        label:  'CVP — Crimes Violentos Patrimoniais',
        icon:   '🔶',
        cor:    '#e65100',
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
        id:     'mvi',
        label:  'MVI — Mortes Violentas Intencionais',
        icon:   '☠️',
        cor:    '#500000',
        corHex: [183, 28, 28],
        noFB:   'cvli',   // deriva do nó cvli com filtro de tipificação
        filtro: 'mvi'     // sinaliza filtragem especial
    },
    {
        id:     'droga',
        label:  'Drogas Apreendidas',
        icon:   '🌿',
        cor:    '#f57f17',
        corHex: [245, 127, 23],
        noFB:   'droga',
        filtro: null
    },
    {
        id:     'arma',
        label:  'Armas Apreendidas',
        icon:   '🔫',
        cor:    '#2e7d32',
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
        cor:    '#ad1457',
        corHex: [173, 20, 87],
        noFB:   'violencia_domestica',
        filtro: null
    },

];

// ── Estado do mapa ────────────────────────────────────────────────
let _mapaL         = null;        // instância Leaflet
let _heatLayers    = {};          // { id: heatLayer }
let _clusterGroups = {};          // { id: markerClusterGroup }
let _dadosMapa     = {};          // { id: [{lat,lng,info},...] }
let _camadasAtivas = new Set(['cvp','cvli','droga','arma','sossego','vd','mvi']);
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

// ── Carrega dados do Firebase para o mapa ─────────────────────────
// Reutiliza DADOS global do dashboard (já carregado)
// Usa FILTRO_MAPA (próprio) — independente do filtro do dashboard
function carregarDadosMapa() {
    const fontes = {
        cvp:     DADOS.cvp,
        cvli:    DADOS.cvli,
        droga:   DADOS.droga,
        arma:    DADOS.arma,
        sossego: DADOS.sossego,
        vd:      DADOS.vd,
        mvi:     DADOS.cvli  // MVI deriva do mesmo nó cvli com filtro adicional
    };

    let totalPontos = 0;
    for (const cfg of CAMADAS_CONFIG) {
        let arr = fontes[cfg.id] || [];

        // Aplica filtro de tipificação especial para MVI
        if (cfg.filtro === 'mvi') {
            arr = arr.filter(ehMVI);
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

            marker.bindPopup(`
                <div style="font-family:Arial,sans-serif;font-size:12px;min-width:200px;">
                    <div style="background:${cfg.cor};color:#fff;padding:6px 10px;
                                border-radius:6px 6px 0 0;font-weight:bold;margin:-8px -12px 8px;">
                        ${cfg.icon} ${cfg.label}
                    </div>
                    <b>Boletim:</b> ${p.boletim}<br>
                    <b>Data:</b> ${p.data}<br>
                    <b>Tipificação:</b> ${p.tip}<br>
                    <b>Bairro:</b> ${p.bairro}<br>
                    <b>Logradouro:</b> ${p.logr}<br>
                    <b>Cidade:</b> ${p.cidade}
                </div>
            `, { maxWidth: 280 });

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

// ── Legenda fixa no mapa ──────────────────────────────────────────
function adicionarLegenda() {
    const Legend = L.control({ position: 'bottomright' });
    Legend.onAdd = () => {
        const div = L.DomUtil.create('div');
        div.style.cssText = `
            background:rgba(15,20,40,0.88);color:#eee;
            padding:10px 14px;border-radius:10px;font-family:Arial,sans-serif;
            font-size:11px;min-width:190px;box-shadow:0 4px 16px rgba(0,0,0,0.5);
            backdrop-filter:blur(4px);
        `;
        div.innerHTML = `<div style="font-weight:bold;margin-bottom:8px;font-size:12px;color:#fff;">
            📍 Camadas Ativas
        </div>` + CAMADAS_CONFIG.map(c => `
            <div style="display:flex;align-items:center;gap:7px;margin-bottom:5px;">
                <div style="width:14px;height:14px;border-radius:50%;
                            background:${c.cor};flex-shrink:0;
                            box-shadow:0 0 6px ${c.cor};"></div>
                <span>${c.icon} ${c.label.split('—')[0].trim()}</span>
            </div>
        `).join('');
        return div;
    };
    Legend.addTo(_mapaL);
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
}

// ═══════════════════════════════════════════════════════════════════
// RENDERIZAÇÃO DA SEÇÃO DO MAPA NO DASHBOARD
// ═══════════════════════════════════════════════════════════════════
function renderMapaCalor() {
    const main = document.getElementById('dash-main');
    if (!main) return;

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

            <!-- Container do mapa -->
            <div id="mapa-calor" style="width:100%;height:580px;"></div>

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

// Sincroniza o botão e redimensiona o Leaflet ao entrar/sair
function _onFullscreenChange() {
    const btn     = document.getElementById('btn-tela-cheia');
    const estaCheia = !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement
    );

    if (btn) {
        btn.textContent     = estaCheia ? '✕ Sair da Tela Cheia' : '⛶ Tela Cheia';
        btn.style.background = estaCheia ? 'rgba(220,50,50,.75)' : 'rgba(255,255,255,.1)';
        btn.style.border     = estaCheia ? '1px solid rgba(220,50,50,.5)' : '1px solid rgba(255,255,255,.2)';
    }

    // Leaflet precisa recalcular o tamanho após a transição CSS do browser
    setTimeout(() => { if (_mapaL) _mapaL.invalidateSize(); }, 200);
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