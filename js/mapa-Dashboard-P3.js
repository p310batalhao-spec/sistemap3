'use strict';

// ══════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO
// ══════════════════════════════════════════════════════════════════
const FB_BASE          = 'https://sistema-p3-default-rtdb.firebaseio.com';
const FB_DESENHOS_PATH = 'mapa_desenhos';   // nó Firebase para polígonos/marcadores

// ══════════════════════════════════════════════════════════════════
// CACHE PERSISTENTE — localStorage (sobrevive ao fechar o navegador)
// ══════════════════════════════════════════════════════════════════
// Na primeira visita: baixa do Firebase e grava no cache.
// Nas visitas seguintes: usa o cache sem nenhum download.
// O cache expira só após CACHE_TTL_HORAS horas ou ao clicar "Atualizar dados".
const CACHE_TTL_HORAS  = 24;        // ocorrências — 24h (recarregar 1×/dia é suficiente)
const CACHE_TTL_DESENHOS_MIN = 5;   // desenhos — 5 min (mudam com mais frequência)
const CACHE_PREFIX = 'p3mapa_v2_';  // prefixo no localStorage (v2 = localStorage)

function _armazenamento() {
    // Retorna localStorage; fallback para sessionStorage se bloqueado (modo privado restrito)
    try { localStorage.setItem('_test', '1'); localStorage.removeItem('_test'); return localStorage; }
    catch(e) { return sessionStorage; }
}

function cacheGet(chave) {
    try {
        const store = _armazenamento();
        const raw = store.getItem(CACHE_PREFIX + chave);
        if (!raw) return null;
        const { ts, data, v } = JSON.parse(raw);
        // Verifica versão — se mudou, invalida
        if (v !== CACHE_PREFIX) { store.removeItem(CACHE_PREFIX + chave); return null; }
        const ttlMs = chave.startsWith('desenhos')
            ? CACHE_TTL_DESENHOS_MIN * 60_000
            : CACHE_TTL_HORAS * 3_600_000;
        if (Date.now() - ts > ttlMs) {
            store.removeItem(CACHE_PREFIX + chave);
            return null; // expirado
        }
        console.log(`[Cache HIT] /${chave} — ${Array.isArray(data) ? data.length + ' registros' : 'objeto'}`);
        return data;
    } catch(e) { return null; }
}

function cacheSet(chave, data) {
    try {
        const store = _armazenamento();
        const payload = JSON.stringify({ ts: Date.now(), v: CACHE_PREFIX, data });
        store.setItem(CACHE_PREFIX + chave, payload);
    } catch(e) {
        // localStorage cheio (~5MB) — limpa entradas mais antigas e tenta de novo
        try {
            const store = _armazenamento();
            // Remove apenas chaves deste app, mantendo o resto
            const proprias = Object.keys(store).filter(k => k.startsWith(CACHE_PREFIX));
            // Ordena por timestamp para remover os mais velhos primeiro
            proprias
                .map(k => { try { return { k, ts: JSON.parse(store.getItem(k)).ts }; } catch(e) { return { k, ts:0 }; } })
                .sort((a,b) => a.ts - b.ts)
                .slice(0, Math.max(1, Math.floor(proprias.length / 2)))
                .forEach(({ k }) => store.removeItem(k));
            // Nova tentativa
            store.setItem(CACHE_PREFIX + chave, JSON.stringify({ ts: Date.now(), v: CACHE_PREFIX, data }));
            console.log(`[Cache] Espaço liberado — ${chave} armazenado.`);
        } catch(e2) { console.warn('[Cache] Sem espaço — operando sem cache.'); }
    }
}

function cacheLimpar() {
    const store = _armazenamento();
    const chaves = Object.keys(store).filter(k => k.startsWith(CACHE_PREFIX));
    chaves.forEach(k => store.removeItem(k));
    const msg = `${chaves.length} entradas removidas. Recarregando…`;
    setStatusFerramenta(msg);
    console.log('[Cache] Limpeza manual:', msg);
    setTimeout(() => location.reload(), 800);
}

function cacheStatus() {
    // Mostra no console o status de cada entrada em cache
    const store = _armazenamento();
    const agora = Date.now();
    console.group('[Cache] Status atual:');
    Object.keys(store).filter(k => k.startsWith(CACHE_PREFIX)).forEach(k => {
        try {
            const { ts, data } = JSON.parse(store.getItem(k));
            const mins = Math.round((agora - ts) / 60_000);
            const chave = k.replace(CACHE_PREFIX, '');
            console.log(`  /${chave}: ${Array.isArray(data) ? data.length + ' registros' : 'objeto'} — idade: ${mins}min`);
        } catch(e) {}
    });
    console.groupEnd();
}

// ══════════════════════════════════════════════════════════════════
// ESTADO GLOBAL
// ══════════════════════════════════════════════════════════════════
let _mapaL         = null;
let _heatLayers    = {};
let _clusterGroups = {};
let _dadosMapa     = {};
let _camadasAtivas = new Set();
let _modoVista     = 'heat';
let _filtroIni     = null;
let _filtroFim     = null;
let _legendaCtrl   = null;

let DADOS_FB = {
    geral:[], cvp:[], cvli:[], arma:[], droga:[],
    tco:[], vd:[], sossego:[], mandados:[], visitas:[], autores:[]
};
let _idxAutorByBoletim = {};
let _idxAutorByNome    = {};

// ── Camada de destaque da busca no mapa ──────────────────────────
let _camadaBusca         = null;   // LayerGroup com os pontos da busca ativa
let _buscaAtiva          = false;  // true enquanto há texto na busca
let _buscaDebounceTimer  = null;   // timer do debounce (ms)

// Ferramentas de desenho
let _camadasImportadas = [];
let _rascPoligonos     = [];  // { layer, nome, cor, pontos, salvo, fbKey }
let _rascMarcadores    = [];  // { layer, nota, lat, lng, salvo, fbKey }
let _polyPontos        = [];
let _polyPontosViz     = [];  // vértices visuais temporários
let _modoDesenho       = null;
let _corPoligono       = '#e65100';

// Desenhos carregados do Firebase
let _fbDesenhos = {};  // { fbKey: { tipo, layer, visivel, nome, cor, ... } }

// ══════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO DAS CAMADAS
// ══════════════════════════════════════════════════════════════════
const CAMADAS_CONFIG = [
    { id:'cvp',      label:'CVP — Crimes Violentos Patrimoniais',         icon:'🔶', cor:'#e65100', corHex:[230,81,0]   },
    { id:'cvli',     label:'CVLI — Crimes Violentos Letais Intencionais', icon:'💀', cor:'#6a1b9a', corHex:[106,27,154] },
    { id:'mvi',      label:'MVI — Mortes Violentas Intencionais',         icon:'☠️', cor:'#b71c1c', corHex:[183,28,28]  },
    { id:'droga',    label:'Drogas Apreendidas',                          icon:'🌿', cor:'#388e3c', corHex:[56,142,60]  },
    { id:'arma',     label:'Armas Apreendidas',                           icon:'🔫', cor:'#2e7d32', corHex:[46,125,50]  },
    { id:'vd',       label:'Violência Doméstica',                         icon:'🏠', cor:'#b500b2', corHex:[173,20,87]  },
    { id:'sossego',  label:'Perturbação do Sossego',                      icon:'📢', cor:'#00695c', corHex:[0,105,92]   },
    { id:'tco',      label:'TCO — Termo Circunstanciado',                 icon:'📑', cor:'#1565c0', corHex:[21,101,192] },
    { id:'ccp',      label:'CCP — Crimes Contra o Patrimônio',            icon:'🏚️', cor:'#4e342e', corHex:[78,52,46]  },
    { id:'mandados', label:'Cumprimento de Mandados',                     icon:'📋', cor:'#37474f', corHex:[55,71,79]   },
    { id:'visitas',  label:'Visitas Orientativas',                        icon:'🏘️', cor:'#00838f', corHex:[0,131,143] },
];
CAMADAS_CONFIG.forEach(c => _camadasAtivas.add(c.id));

// ══════════════════════════════════════════════════════════════════
// UTILITÁRIOS
// ══════════════════════════════════════════════════════════════════
const norm = s => String(s||'').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');

function parseDec(v) {
    if (v == null) return NaN;
    return parseFloat(String(v).replace(',','.').trim());
}
function coordValida(lat, lng) {
    return !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0
        && lat >= -11.0 && lat <= -7.0 && lng >= -38.5 && lng <= -34.5;
}
function parseDateStr(s) {
    if (!s || s === '---') return null;
    s = String(s).trim().substring(0,10);
    if (s.includes('/')) { const [d,m,a] = s.split('/'); return new Date(+a,+m-1,+d); }
    if (s.includes('-')) { const [a,m,d] = s.split('-'); return new Date(+a,+m-1,+d); }
    return null;
}
function filtroPeriodo(arr) {
    if (!_filtroIni && !_filtroFim) return arr;
    return arr.filter(item => {
        const d = parseDateStr(item.DATA || item.data || '');
        if (!d) return false;
        if (_filtroIni && d < _filtroIni) return false;
        if (_filtroFim && d > _filtroFim) return false;
        return true;
    });
}
function gradient(rgb) {
    const [r,g,b] = rgb;
    return {
        0.0:'rgba(255,255,255,0)',
        0.2:`rgba(${r},${g},${b},0.15)`,
        0.4:`rgba(${r},${g},${b},0.40)`,
        0.6:`rgba(${r},${g},${b},0.65)`,
        0.8:`rgba(${r},${g},${b},0.85)`,
        1.0:`rgb(${r},${g},${b})`
    };
}
function setLoader(msg) { const el = document.getElementById('loader-msg'); if (el) el.textContent = msg; }
function setStatusFerramenta(msg) { const el = document.getElementById('status-ferramenta'); if (el) el.textContent = msg; }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ══════════════════════════════════════════════════════════════════
// CLASSIFICADORES
// ══════════════════════════════════════════════════════════════════
function ehMVI(item) {
    const t = norm((item.TIPIFICACAO_GERAL||'') + ' ' + (item.TIPIFICACAO||''));
    const o = norm(item.OBITO||'');
    if (t.includes('ACHADO') || t.includes('SUICIDIO') || t.includes('VIOLACAO')) return false;
    if (t.includes('TENTATIVA'))
        return (t.includes('HOMICIDIO')||t.includes('FEMINICIDIO')||t.includes('LATROCINIO')) && o === 'S';
    return t.includes('HOMICIDIO') || t.includes('LATROCINIO') || t.includes('FEMINICIDIO')
        || t.includes('LESAO CORPORAL COM RESULTADO MORTE')
        || t.includes('LESAO CORPORAL SEGUIDA DE MORTE');
}
function ehTCO(item)  { return norm(item.SOLUÇÃO||item.SOLUCAO||item['SOLUÇÃO']||'').includes('ELABOROU TCO'); }
function ehCCP(item)  {
    const t = norm(item.TIPIFICACAO_GERAL||item.TIPIFICACAO||'');
    return !(t.includes('DIRIGIR')||t.includes('PERIGO')) && (
        t.includes('FURTO') || t.includes('DANO') || t.includes('RECEPTACAO')
        || t.includes('APROPRIACAO INDEBITA') || t.includes('ESTELIONATO') || t.includes('FRAUDE')
    );
}
function ehVisita(item){ return norm(item.TIPIFICACAO||item.TIPIFICACAO_GERAL||'').includes('VISITA'); }

// ══════════════════════════════════════════════════════════════════
// EXTRATOR DE PONTOS GPS
// ══════════════════════════════════════════════════════════════════
function extrairPontos(registros) {
    return registros.map(item => ({
        lat:        parseDec(item.LATITUDE  || item.latitude),
        lng:        parseDec(item.LONGITUDE || item.longitude),
        cidade:     item.CIDADE     || '—',
        bairro:     item.BAIRRO     || '—',
        logr:       item.LOGRADOURO || item.ENDERECO || '—',
        data:       item.DATA       || '—',
        tip:        item.TIPIFICACAO_GERAL || item.TIPIFICACAO || item.TIPO_DROGA || item.TIPO_ARMA || '—',
        boletim:    item.BOLETIM    || '—',
        solucao:    item.SOLUÇÃO    || item.SOLUCAO  || item['SOLUÇÃO'] || '—',
        autorDireto:item.AUTOR || item.autor || item.NOME_AUTOR || item.SUSPEITO || item.suspeito || '',
        _raw: item,
    })).filter(p => coordValida(p.lat, p.lng));
}

// ══════════════════════════════════════════════════════════════════
// CARREGAMENTO FIREBASE COM CACHE (sessionStorage)
// ══════════════════════════════════════════════════════════════════
async function fbFetchComCache(no) {
    // 1. Tenta do cache
    const cached = cacheGet(no);
    if (cached) {
        console.log(`[Cache ✓] /${no} — ${cached.length} registros (sem download)`);
        return cached;
    }
    // 2. Busca do Firebase
    try {
        setLoader(`Firebase — baixando /${no}…`);
        const r = await fetch(`${FB_BASE}/${no}.json`);
        const d = await r.json();
        if (!d) { cacheSet(no, []); return []; }
        const arr = Object.keys(d).map(id => ({ _fbId:id, ...d[id] }));
        cacheSet(no, arr);
        console.log(`[Firebase ↓] /${no} — ${arr.length} registros (baixado e cacheado)`);
        return arr;
    } catch(e) {
        console.warn(`[Firebase] nó /${no}:`, e.message);
        return [];
    }
}

async function fbFetchObjComCache(no) {
    const cached = cacheGet(no);
    if (cached) return cached;
    try {
        const r = await fetch(`${FB_BASE}/${no}.json`);
        const d = await r.json();
        const obj = d || {};
        cacheSet(no, obj);
        return obj;
    } catch(e) { return {}; }
}

// Operações de escrita (sem cache — sempre direto no Firebase)
async function fbSalvar(path, dados) {
    try {
        const r = await fetch(`${FB_BASE}/${path}.json`, {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify(dados)
        });
        const resp = await r.json();
        // Invalida cache dos desenhos para próximo carregamento
        _armazenamento().removeItem(CACHE_PREFIX + FB_DESENHOS_PATH);
        return resp?.name || null;
    } catch(e) { console.warn('[Firebase] Erro ao salvar:', e.message); return null; }
}

async function fbAtualizar(path, dados) {
    try {
        await fetch(`${FB_BASE}/${path}.json`, {
            method:'PATCH', headers:{'Content-Type':'application/json'},
            body: JSON.stringify(dados)
        });
        _armazenamento().removeItem(CACHE_PREFIX + FB_DESENHOS_PATH);
        return true;
    } catch(e) { console.warn('[Firebase] Erro ao atualizar:', e.message); return false; }
}

async function fbDeletar(path) {
    try {
        await fetch(`${FB_BASE}/${path}.json`, { method:'DELETE' });
        _armazenamento().removeItem(CACHE_PREFIX + FB_DESENHOS_PATH);
        return true;
    } catch(e) { console.warn('[Firebase] Erro ao deletar:', e.message); return false; }
}

// ══════════════════════════════════════════════════════════════════
// CARREGAMENTO PRINCIPAL (usa cache em todos os nós)
// ══════════════════════════════════════════════════════════════════
async function carregarFirebase() {
    setLoader('Verificando cache…');

    // Carrega todos os nós em paralelo — se já estiverem em cache, é instantâneo
    const [geral, cvp, cvli, arma, droga, tco, vd, sossego, mandados, autores] = await Promise.all([
        fbFetchComCache('geral'),
        fbFetchComCache('cvp'),
        fbFetchComCache('cvli'),
        fbFetchComCache('arma'),
        fbFetchComCache('droga'),
        fbFetchComCache('tco'),
        fbFetchComCache('violencia_domestica'),
        fbFetchComCache('sossego'),
        fbFetchComCache('mandados'),
        fbFetchComCache('autor'),
    ]);

    const visitas = geral.filter(i => norm(i.TIPIFICACAO || i.TIPIFICACAO_GERAL || '').includes('VISITA'));
    DADOS_FB = { geral, cvp, cvli, arma, droga, tco, vd, sossego, mandados, visitas, autores };

    // Índice de autores
    _idxAutorByBoletim = {};
    _idxAutorByNome    = {};
    autores.forEach(a => {
        const bo = norm(a.BOLETIM || a.boletim || a.NUM_BO || a.NUMERO || '').trim();
        if (bo) { if (!_idxAutorByBoletim[bo]) _idxAutorByBoletim[bo] = []; _idxAutorByBoletim[bo].push(a); }
        const nm = norm(a.NOME || a.nome || a.AUTOR || a.SUSPEITO || '').trim();
        if (nm) { if (!_idxAutorByNome[nm])    _idxAutorByNome[nm]    = []; _idxAutorByNome[nm].push(a); }
    });

    const total = geral.length + cvp.length + cvli.length + arma.length + droga.length
                + tco.length + vd.length + sossego.length + mandados.length;
    const store = _armazenamento();
    const fromCache = Object.keys(store).filter(k => k.startsWith(CACHE_PREFIX)).length > 0;
    console.log(`[Firebase] ${total} registros + ${autores.length} autores.`);
    if (fromCache) {
        console.log('%c[Cache] Dados carregados do cache local — nenhum download realizado.', 'color:#4caf50;font-weight:bold;');
    } else {
        console.log('%c[Cache] Dados baixados do Firebase e salvos em cache.', 'color:#42a5f5;font-weight:bold;');
    }
    // Exibe aviso de cache no loader antes de iniciar o mapa
    setLoader(fromCache
        ? `Cache local ✓ — ${total.toLocaleString('pt-BR')} registros`
        : `Firebase ✓ — ${total.toLocaleString('pt-BR')} registros baixados`);
    iniciarMapa();
}

// ══════════════════════════════════════════════════════════════════
// AUTORES
// ══════════════════════════════════════════════════════════════════
function buscarAutores(p) {
    const resultados = [], vistos = new Set();
    const add = a => { if (!vistos.has(a._fbId)) { vistos.add(a._fbId); resultados.push(a); } };
    const boNorm = norm(p.boletim).trim();
    if (boNorm && boNorm !== '—') (_idxAutorByBoletim[boNorm] || []).forEach(add);
    if (p.autorDireto) {
        const nmNorm = norm(p.autorDireto).trim();
        if (nmNorm) (_idxAutorByNome[nmNorm] || []).forEach(a => {
            const aBO = norm(a.BOLETIM||a.boletim||'').trim();
            if (!aBO || !boNorm || aBO === boNorm) add(a);
        });
    }
    return resultados;
}

// ══════════════════════════════════════════════════════════════════
// POPUP DO PONTO
// ══════════════════════════════════════════════════════════════════
function montarPopup(p, cfg) {
    const autoresUnicos = [];
    const chavesVistas  = new Set();
    buscarAutores(p).forEach(a => {
        const nome = norm(a.NOME || a.nome || a.AUTOR || a.SUSPEITO || '');
        const cpf  = (a.CPF || a.cpf || '').replace(/\D/g,'');
        const ch   = cpf ? `cpf_${cpf}` : `nome_${nome}`;
        if (!chavesVistas.has(ch) && (nome || cpf)) { chavesVistas.add(ch); autoresUnicos.push(a); }
    });

    let autoresHtml = '';
    if (autoresUnicos.length) {
        autoresHtml = `<div style="margin-top:9px;padding-top:9px;border-top:1px solid rgba(255,255,255,.1);">
            <div style="font-size:9px;font-weight:bold;letter-spacing:.08em;color:rgba(255,255,255,.4);margin-bottom:6px;">
                👤 AUTOR(ES) / SUSPEITO(S)</div>
            ${autoresUnicos.map(a => {
                const nome = a.NOME||a.nome||a.AUTOR||a.SUSPEITO||'—';
                const cpf  = a.CPF||a.cpf||'';
                const mae  = a.NOME_MAE||a.mae||'';
                const nasc = a.DATA_NASC||a.DATA_NASCIMENTO||a.NASCIMENTO||'';
                const nat  = a.NATURALIDADE||a.naturalidade||'';
                const res  = a.RESIDENCIA||a.ENDERECO||a.endereco||'';
                const tip2 = a.TIPIFICACAO||a.tipificacao||a.CRIME||'';
                const situ = a.SITUACAO||a.situacao||a.STATUS||'';
                const env  = a.ENVOLVIMENTO||a.envolvimento||'';
                return `<div style="padding:6px 8px;background:rgba(255,255,255,.05);
                    border-left:3px solid ${cfg.cor};border-radius:0 6px 6px 0;
                    margin-bottom:5px;font-size:11px;line-height:1.7;color:#cde;">
                    <div style="color:#fff;font-weight:bold;font-size:12px;">👤 ${esc(nome)}</div>
                    ${cpf  ? `<div><b>CPF:</b> ${esc(cpf)}</div>` : ''}
                    ${nasc ? `<div><b>Nasc.:</b> ${esc(nasc)}${nat?' — '+esc(nat):''}</div>` : ''}
                    ${mae  ? `<div><b>Mãe:</b> ${esc(mae)}</div>` : ''}
                    ${res  ? `<div><b>Residência:</b> ${esc(res)}</div>` : ''}
                    ${tip2 ? `<div><b>Crime:</b> <span style="color:#ffcc80;">${esc(tip2)}</span></div>` : ''}
                    ${env  ? `<div><b>Envolvimento:</b> <span style="color:#90caf9;">${esc(env)}</span></div>` : ''}
                    ${situ ? `<div><b>Situação:</b> <span style="color:#a5d6a7;">${esc(situ)}</span></div>` : ''}
                </div>`;
            }).join('')}
        </div>`;
    } else if (p.autorDireto) {
        autoresHtml = `<div style="margin-top:9px;padding-top:9px;border-top:1px solid rgba(255,255,255,.1);">
            <div style="font-size:9px;color:rgba(255,255,255,.4);margin-bottom:5px;">👤 AUTOR/SUSPEITO</div>
            <div style="font-size:11px;color:#ef9a9a;">${esc(p.autorDireto)}
                <span style="font-size:9px;color:rgba(255,255,255,.3);margin-left:6px;">(sem ficha no /autor)</span>
            </div>
        </div>`;
    }

    return `<div style="min-width:230px;max-width:380px;">
        <div style="background:${cfg.cor};color:#fff;padding:7px 12px;
            border-radius:6px 6px 0 0;font-weight:bold;margin:-10px -14px 10px;font-size:13px;">
            ${cfg.icon} ${cfg.label.split('—')[0].trim()}
        </div>
        <div style="font-size:11px;line-height:1.75;color:#cde;">
            <b>Boletim:</b> ${esc(p.boletim)}<br>
            <b>Data:</b> ${esc(p.data)}<br>
            <b>Tipificação:</b> ${esc(p.tip)}<br>
            <b>Bairro:</b> ${esc(p.bairro)}<br>
            <b>Logradouro:</b> ${esc(p.logr)}<br>
            <b>Cidade:</b> ${esc(p.cidade)}<br>
            <b>Solução:</b> ${esc(p.solucao)}
        </div>${autoresHtml}</div>`;
}

// ══════════════════════════════════════════════════════════════════
// INICIAR MAPA (Leaflet carregado dinamicamente)
// ══════════════════════════════════════════════════════════════════
function iniciarMapa() {
    const cssList = [
        'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
        'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css',
        'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css',
    ];
    cssList.forEach(href => {
        if (!document.querySelector(`link[href="${href}"]`)) {
            const l = document.createElement('link'); l.rel='stylesheet'; l.href=href;
            document.head.appendChild(l);
        }
    });
    const scripts = [
        { src:'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',                            check:()=>window.L },
        { src:'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js', check:()=>window.L&&L.MarkerClusterGroup },
        { src:'https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js',                   check:()=>window.L&&L.heatLayer },
    ];
    function next(i) {
        if (i >= scripts.length) { _inicializarLeaflet(); return; }
        const s = scripts[i];
        if (s.check()) { next(i+1); return; }
        const el = document.createElement('script');
        el.src=s.src; el.onload=()=>next(i+1);
        el.onerror=()=>{ console.warn('Falha:', s.src); next(i+1); };
        document.head.appendChild(el);
    }
    next(0);
}

function _inicializarLeaflet() {
    if (_mapaL) { _mapaL.remove(); _mapaL = null; }
    _mapaL = L.map('mapa-calor', { center:[-9.42,-36.63], zoom:10 });

    const tiles = {
        'Satélite (Esri)':    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{ attribution:'Esri', maxZoom:19 }),
        'Rua (OpenStreetMap)': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{ attribution:'© OpenStreetMap', maxZoom:19 }),
        'Cinza (CartoDB)':    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{ attribution:'© CartoDB', maxZoom:19 }),
        'Escuro (CartoDB)':   L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution:'© CartoDB', maxZoom:19 }),
    };
    tiles['Satélite (Esri)'].addTo(_mapaL);
    L.control.layers(tiles,{},{ position:'topleft', collapsed:true }).addTo(_mapaL);
    L.control.scale({ imperial:false, position:'bottomleft' }).addTo(_mapaL);

    _mapaL.on('mousemove', e => {
        const el = document.getElementById('sb-coords');
        if (el) el.textContent = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
    });

    _mapaL.invalidateSize();

    // Injeta keyframe de pulso para marcadores de busca
    if (!document.getElementById('_busca-pulse-style')) {
        const s = document.createElement('style');
        s.id = '_busca-pulse-style';
        s.textContent = `@keyframes buscaPulso {
            0%   { transform:scale(1);   opacity:.7; }
            70%  { transform:scale(2.4); opacity:0; }
            100% { transform:scale(1);   opacity:0; }
        }`;
        document.head.appendChild(s);
    }

    construirCamadas();
    adicionarLegenda();
    renderPainelCamadas();
    renderListaOcorrencias();
    carregarDesenhosSalvos();

    requestAnimationFrame(() => {
        document.getElementById('loader-overlay').style.display = 'none';
        atualizarResumo();
        setTimeout(() => _mapaL && _mapaL.invalidateSize(), 150);
    });
}

// ══════════════════════════════════════════════════════════════════
// CONSTRUIR CAMADAS
// ══════════════════════════════════════════════════════════════════
function _fontesDados() {
    return {
        cvp:      DADOS_FB.cvp,
        cvli:     DADOS_FB.cvli,
        mvi:      DADOS_FB.cvli.filter(ehMVI),
        droga:    DADOS_FB.droga,
        arma:     DADOS_FB.arma,
        vd:       DADOS_FB.vd,
        sossego:  DADOS_FB.sossego,
        tco:      [...DADOS_FB.tco, ...DADOS_FB.geral.filter(ehTCO)],
        ccp:      DADOS_FB.geral.filter(ehCCP),
        mandados: DADOS_FB.mandados,
        visitas:  DADOS_FB.visitas,
    };
}

function construirCamadas() {
    for (const id in _heatLayers)    { try { _mapaL.removeLayer(_heatLayers[id]); } catch(e){} }
    for (const id in _clusterGroups) { try { _mapaL.removeLayer(_clusterGroups[id]); } catch(e){} }
    _heatLayers = {}; _clusterGroups = {};

    const fontes = _fontesDados();
    for (const cfg of CAMADAS_CONFIG) {
        const arr    = filtroPeriodo(fontes[cfg.id] || []);
        const pontos = extrairPontos(arr);
        _dadosMapa[cfg.id] = pontos;
        if (!pontos.length) continue;

        try {
            _heatLayers[cfg.id] = L.heatLayer(
                pontos.map(p => [p.lat,p.lng,1.0]),
                { radius:22, blur:18, maxZoom:14, gradient:gradient(cfg.corHex), minOpacity:0.25 }
            );
        } catch(e) {}

        const group = L.markerClusterGroup({
            showCoverageOnHover:false, maxClusterRadius:50,
            iconCreateFunction: cl => {
                const n=cl.getChildCount(), sz=n>100?48:n>20?40:32;
                return L.divIcon({ className:'',
                    html:`<div style="background:${cfg.cor};color:#fff;border-radius:50%;
                        width:${sz}px;height:${sz}px;display:flex;align-items:center;
                        justify-content:center;font-weight:bold;font-size:${sz>40?13:11}px;
                        border:3px solid rgba(255,255,255,.7);
                        box-shadow:0 2px 8px rgba(0,0,0,.4);">${n}</div>`,
                    iconSize:[sz,sz], iconAnchor:[sz/2,sz/2] });
            }
        });
        pontos.forEach(p => {
            const mk = L.circleMarker([p.lat,p.lng],{ radius:6, fillColor:cfg.cor, color:'#fff', weight:1.5, fillOpacity:.85 });
            mk.bindPopup(montarPopup(p,cfg),{ maxWidth:400 });
            group.addLayer(mk);
        });
        _clusterGroups[cfg.id] = group;
        if (!_buscaAtiva && _camadasAtivas.has(cfg.id)) {
            if (_modoVista==='heat'   ||_modoVista==='ambos') _heatLayers[cfg.id]?.addTo(_mapaL);
            if (_modoVista==='cluster'||_modoVista==='ambos') _clusterGroups[cfg.id].addTo(_mapaL);
        }
    }
    // Se busca ativa, re-aplica a camada de busca sobre os dados novos
    if (_buscaAtiva) {
        const val = document.getElementById('busca-oc')?.value || '';
        _atualizarCamadaBusca(val);
    }
    atualizarResumo();
}

// ══════════════════════════════════════════════════════════════════
// PAINEL — CAMADAS (botões preenchidos com cor quando ativos)
// ══════════════════════════════════════════════════════════════════
function renderPainelCamadas() {
    const el = document.getElementById('lista-camadas');
    if (!el) return;
    el.innerHTML = CAMADAS_CONFIG.map(cfg => {
        const n     = (_dadosMapa[cfg.id] || []).length;
        const ativa = _camadasAtivas.has(cfg.id);
        return `<div class="camada-toggle ${ativa?'ativa':''}" id="ct-${cfg.id}"
            onclick="toggleCamada('${cfg.id}')"
            style="--cor:${cfg.cor};
                   background:${ativa ? cfg.cor : 'rgba(255,255,255,.04)'};
                   border-color:${ativa ? cfg.cor : 'rgba(255,255,255,.08)'};
                   box-shadow:${ativa ? `0 0 10px ${cfg.cor}66` : 'none'};">
            <div class="camada-dot" style="background:#fff;opacity:${ativa?1:.4};"></div>
            <span class="camada-nome" style="color:${ativa?'#fff':'#99a'};font-weight:${ativa?'bold':'normal'};">
                ${cfg.icon} ${cfg.label.split('—')[0].trim()}
            </span>
            <span class="camada-count"
                style="background:rgba(0,0,0,.25);color:${ativa?'#fff':'rgba(255,255,255,.35)'};">
                ${n}
            </span>
        </div>`;
    }).join('');
    // Atualiza badge de cache
    _renderCacheBadge();
}

// ── Badge de status do cache no painel ────────────────────────
function _renderCacheBadge() {
    const el = document.getElementById('cache-badge');
    if (!el) return;
    try {
        const store = _armazenamento();
        const chaves = Object.keys(store).filter(k => k.startsWith(CACHE_PREFIX));
        if (!chaves.length) {
            el.textContent = 'Sem cache local';
            el.style.color = 'rgba(255,255,255,.3)';
            return;
        }
        // Acha a entrada mais antiga
        let tsMin = Infinity;
        chaves.forEach(k => {
            try { const { ts } = JSON.parse(store.getItem(k)); if (ts < tsMin) tsMin = ts; } catch(e) {}
        });
        const mins = Math.round((Date.now() - tsMin) / 60_000);
        const horas = Math.floor(mins / 60);
        const minsRest = mins % 60;
        const idade = horas > 0 ? `${horas}h ${minsRest}min` : `${mins}min`;
        el.textContent = `Cache local · ${idade} atrás`;
        el.style.color = mins < 60 ? '#81c784' : mins < 720 ? '#ffb74d' : '#ef9a9a';
    } catch(e) {
        el.textContent = '';
    }
}

// ══════════════════════════════════════════════════════════════════
// PAINEL — BUSCA ENRIQUECIDA
// Campos: nome/autor, CPF, cidade, bairro, logradouro, boletim
// Quando bate em nome/CPF → mostra todas as ocorrências da pessoa
// ══════════════════════════════════════════════════════════════════
let _todasOcorrencias = [];

// Reconstrói o índice flat de ocorrências (todas as camadas)
function _reconstruirOcorrencias() {
    const vistos = new Set();
    _todasOcorrencias = [];
    for (const cfg of CAMADAS_CONFIG) {
        for (const p of (_dadosMapa[cfg.id] || [])) {
            const chave = p.boletim + '|' + cfg.id;
            if (!vistos.has(chave)) { vistos.add(chave); _todasOcorrencias.push({ ...p, _cfg:cfg }); }
        }
    }
}

// Tipos de busca detectados automaticamente
function _detectarTipoBusca(f) {
    if (!f) return null;
    const s = f.replace(/\D/g, '');
    if (s.length >= 9) return 'cpf';                               // CPF numérico
    if (f.includes('CPF:')) return 'cpf';
    return 'geral';                                                 // tudo junto
}

// Busca pessoas no nó /autor por nome parcial ou CPF exato
function _buscarPessoasAutor(f) {
    const resultados = [];
    const vistos = new Set();
    const cpfNum = f.replace(/\D/g,'');

    DADOS_FB.autores.forEach(a => {
        const nome = norm(a.NOME || a.nome || a.AUTOR || a.SUSPEITO || '');
        const cpf  = (a.CPF || a.cpf || '').replace(/\D/g,'');
        // Match por CPF (exato, ao menos 9 dígitos) ou por nome (parcial)
        const matchCPF  = cpfNum.length >= 9 && cpf && cpf.includes(cpfNum);
        const matchNome = nome.length > 2 && nome.includes(f);
        if ((matchCPF || matchNome) && !vistos.has(a._fbId)) {
            vistos.add(a._fbId); resultados.push(a);
        }
    });
    return resultados;
}

// Dado um conjunto de autores encontrados, retorna todas as ocorrências deles
function _ocorrenciasDassPessoas(autoresList) {
    const boletimsSet = new Set();
    autoresList.forEach(a => {
        const bo = norm(a.BOLETIM || a.boletim || a.NUM_BO || a.NUMERO || '').trim();
        if (bo) boletimsSet.add(bo);
    });
    if (!boletimsSet.size) return [];
    return _todasOcorrencias.filter(p => boletimsSet.has(norm(p.boletim).trim()));
}

function renderListaOcorrencias(filtro='') {
    _reconstruirOcorrencias();

    const el = document.getElementById('lista-oc');
    if (!el) return;

    // Atualiza dica de total
    const hint = document.getElementById('oc-total-hint');
    if (hint) hint.textContent = `${_todasOcorrencias.length.toLocaleString('pt-BR')} ocorrências com GPS`;

    const f = norm(filtro.trim());

    if (!f) {
        el.innerHTML = `<div style="color:rgba(255,255,255,.3);font-size:11px;text-align:center;padding:24px 10px;">
            <div style="font-size:28px;margin-bottom:8px;">🔍</div>
            <div style="font-weight:bold;color:rgba(255,255,255,.5);margin-bottom:6px;">Pesquisar ocorrências</div>
            <div style="font-size:10px;line-height:1.7;color:rgba(255,255,255,.3);">
                🔸 <b style="color:rgba(255,255,255,.5);">Nome / autor</b> — mostra todas as ocorrências da pessoa<br>
                🔸 <b style="color:rgba(255,255,255,.5);">CPF</b> — busca exata no cadastro de autores<br>
                🔸 <b style="color:rgba(255,255,255,.5);">Cidade</b> · <b style="color:rgba(255,255,255,.5);">Bairro</b> · <b style="color:rgba(255,255,255,.5);">Logradouro</b><br>
                🔸 <b style="color:rgba(255,255,255,.5);">Boletim</b> · <b style="color:rgba(255,255,255,.5);">Tipificação</b>
            </div>
            <div style="margin-top:10px;font-size:10px;color:rgba(255,255,255,.2);">
                ${_todasOcorrencias.length.toLocaleString('pt-BR')} ocorrências · ${DADOS_FB.autores.length.toLocaleString('pt-BR')} autores cadastrados
            </div>
        </div>`;
        return;
    }

    // ── 1. Busca pessoas por nome/CPF no nó /autor ────────────────
    const pessoasEncontradas = _buscarPessoasAutor(f);
    const ocsPorPessoa       = _ocorrenciasDassPessoas(pessoasEncontradas);

    // ── 2. Busca direta nas ocorrências (bairro, cidade, logr, bol, tipif)
    const ocsDirectas = _todasOcorrencias.filter(p =>
        norm(p.boletim).includes(f)      ||
        norm(p.tip).includes(f)          ||
        norm(p.bairro).includes(f)       ||
        norm(p.logr).includes(f)         ||
        norm(p.cidade).includes(f)       ||
        norm(p.autorDireto).includes(f)
    );

    // ── 3. Merge sem duplicatas (ocorrências por pessoa têm prioridade visual)
    const boletinsJaAdicionados = new Set();
    const listaFinal = [];
    // Primeiro as da pessoa pesquisada
    ocsPorPessoa.forEach(p => {
        const ch = p.boletim + '|' + p._cfg.id;
        if (!boletinsJaAdicionados.has(ch)) { boletinsJaAdicionados.add(ch); listaFinal.push({ ...p, _porPessoa:true }); }
    });
    // Depois as diretas
    ocsDirectas.forEach(p => {
        const ch = p.boletim + '|' + p._cfg.id;
        if (!boletinsJaAdicionados.has(ch)) { boletinsJaAdicionados.add(ch); listaFinal.push(p); }
    });

    if (!listaFinal.length) {
        el.innerHTML = `<div style="color:rgba(255,255,255,.3);font-size:11px;text-align:center;padding:16px;">
            <div style="font-size:22px;margin-bottom:6px;">🔎</div>
            Nenhum resultado para <b>"${esc(filtro)}"</b></div>`;
        return;
    }

    // ── Cabeçalho de resultado ────────────────────────────────────
    let headerHtml = '';
    if (pessoasEncontradas.length) {
        // Mostra card de identificação da pessoa encontrada
        const p1 = pessoasEncontradas[0];
        const nomePessoa = p1.NOME || p1.nome || p1.AUTOR || p1.SUSPEITO || '—';
        const cpfPessoa  = p1.CPF  || p1.cpf  || '';
        const nascPessoa = p1.DATA_NASC || p1.DATA_NASCIMENTO || '';
        const resPessoa  = p1.RESIDENCIA || p1.ENDERECO || p1.endereco || '';
        const situ       = p1.SITUACAO || p1.situacao || '';
        const env        = p1.ENVOLVIMENTO || p1.envolvimento || '';
        const mais       = pessoasEncontradas.length > 1 ? ` <span style="font-size:10px;color:rgba(255,255,255,.4);">+${pessoasEncontradas.length-1} entrada(s)</span>` : '';
        headerHtml = `
        <div style="background:rgba(21,101,192,.2);border:1px solid rgba(66,165,245,.35);
            border-radius:9px;padding:10px 12px;margin-bottom:10px;">
            <div style="font-size:9px;font-weight:bold;letter-spacing:.08em;
                color:rgba(255,255,255,.4);margin-bottom:7px;">👤 PESSOA ENCONTRADA ${mais}</div>
            <div style="color:#fff;font-weight:bold;font-size:13px;margin-bottom:4px;">${esc(nomePessoa)}</div>
            <div style="font-size:11px;color:#cde;line-height:1.7;">
                ${cpfPessoa  ? `<b>CPF:</b> ${esc(cpfPessoa)}<br>` : ''}
                ${nascPessoa ? `<b>Nasc.:</b> ${esc(nascPessoa)}<br>` : ''}
                ${resPessoa  ? `<b>Residência:</b> ${esc(resPessoa)}<br>` : ''}
                ${situ       ? `<b>Situação:</b> <span style="color:#a5d6a7;">${esc(situ)}</span><br>` : ''}
                ${env        ? `<b>Envolvimento:</b> <span style="color:#90caf9;">${esc(env)}</span><br>` : ''}
            </div>
            <div style="margin-top:6px;font-size:10px;color:#42a5f5;font-weight:bold;">
                📋 ${ocsPorPessoa.length} ocorrência(s) vinculada(s) ao cadastro
            </div>
        </div>`;
    }

    // ── Render dos cards de ocorrência ────────────────────────────
    const cardsHtml = listaFinal.slice(0,120).map(p => {
        const cfg      = p._cfg;
        const destaque = p._porPessoa;   // borda extra se veio da busca por pessoa
        const info = encodeURIComponent(JSON.stringify({
            bo:p.boletim, d:p.data, t:p.tip, bairro:p.bairro,
            logr:p.logr, cidade:p.cidade, sol:p.solucao, autor:p.autorDireto, cfgId:cfg.id
        }));
        // Autor do registro: pode ser do nó /autor ou direto
        const autores = buscarAutores(p);
        const autorNome = autores.length
            ? (autores[0].NOME || autores[0].nome || autores[0].AUTOR || autores[0].SUSPEITO || '')
            : p.autorDireto;

        return `<div class="oc-card"
            onclick="_focarPonto(${p.lat},${p.lng},'${info}')"
            style="border-left:4px solid ${cfg.cor};
                   ${destaque ? `box-shadow:0 0 0 1px ${cfg.cor}44;background:rgba(255,255,255,.06);` : ''}">
            <div class="oc-titulo">${cfg.icon} ${esc(p.boletim!=='—'?p.boletim:cfg.label.split('—')[0].trim())}</div>
            <div style="color:rgba(255,255,255,.45);font-size:10px;margin-bottom:4px;line-height:1.5;">
                📅 ${esc(p.data)}<br>
                📍 ${esc(p.bairro)}${p.logr&&p.logr!=='—'?' · '+esc(p.logr.substring(0,30)):''}<br>
                🏙 ${esc(p.cidade)}
            </div>
            <div style="font-size:10px;color:#aac;margin-bottom:4px;line-height:1.4;">
                ${esc(p.tip.substring(0,50))}
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:3px;align-items:center;">
                <span class="oc-badge" style="background:${cfg.cor};color:#fff;">${cfg.icon} ${cfg.label.split(' ')[0]}</span>
                ${autorNome ? `<span class="oc-badge" style="background:rgba(239,154,154,.18);color:#ef9a9a;border:1px solid rgba(239,154,154,.3);">👤 ${esc(String(autorNome).substring(0,22))}</span>` : ''}
                ${destaque  ? `<span class="oc-badge" style="background:rgba(66,165,245,.2);color:#90caf9;border:1px solid rgba(66,165,245,.3);">🔗 vinculado</span>` : ''}
            </div>
        </div>`;
    }).join('');

    el.innerHTML = headerHtml + `
        <div style="font-size:10px;color:rgba(255,255,255,.3);text-align:right;margin-bottom:6px;padding-right:2px;">
            ${listaFinal.length.toLocaleString('pt-BR')} resultado(s)
        </div>` + cardsHtml;

    if (listaFinal.length > 120) {
        el.innerHTML += `<div style="text-align:center;font-size:10px;color:rgba(255,255,255,.3);padding:8px;">
            … mais ${listaFinal.length-120} resultados. Refine a busca.</div>`;
    }
}

function filtrarOcorrencias() {
    const val = document.getElementById('busca-oc')?.value || '';
    renderListaOcorrencias(val);

    // Debounce: aguarda 280ms após parar de digitar antes de atualizar o mapa
    clearTimeout(_buscaDebounceTimer);
    _buscaDebounceTimer = setTimeout(() => _atualizarCamadaBusca(val), 280);
}

// ══════════════════════════════════════════════════════════════════
// CAMADA DE BUSCA NO MAPA — destaca os pontos vinculados à pesquisa
// ══════════════════════════════════════════════════════════════════
function _atualizarCamadaBusca(filtro) {
    // Remove a camada anterior se existir
    if (_camadaBusca) {
        _mapaL.removeLayer(_camadaBusca);
        _camadaBusca = null;
    }

    const f = norm((filtro || '').trim());

    if (!f) {
        // Busca vazia: restaura visibilidade normal de todas as camadas
        if (_buscaAtiva) {
            _buscaAtiva = false;
            _restaurarCamadasNormais();
            _atualizarBarraBusca(false, 0);
        }
        return;
    }

    // ── Replica a mesma lógica de busca do painel ──────────────────
    _reconstruirOcorrencias();

    const pessoasEncontradas = _buscarPessoasAutor(f);
    const ocsPorPessoa       = _ocorrenciasDassPessoas(pessoasEncontradas);

    const ocsDirectas = _todasOcorrencias.filter(p =>
        norm(p.boletim).includes(f)    ||
        norm(p.tip).includes(f)        ||
        norm(p.bairro).includes(f)     ||
        norm(p.logr).includes(f)       ||
        norm(p.cidade).includes(f)     ||
        norm(p.autorDireto).includes(f)
    );

    // Merge sem duplicatas
    const boletinsJaAdicionados = new Set();
    const listaFinal = [];
    ocsPorPessoa.forEach(p => {
        const ch = p.boletim + '|' + p._cfg.id;
        if (!boletinsJaAdicionados.has(ch)) {
            boletinsJaAdicionados.add(ch);
            listaFinal.push({ ...p, _porPessoa: true });
        }
    });
    ocsDirectas.forEach(p => {
        const ch = p.boletim + '|' + p._cfg.id;
        if (!boletinsJaAdicionados.has(ch)) {
            boletinsJaAdicionados.add(ch);
            listaFinal.push(p);
        }
    });

    if (!listaFinal.length) {
        _buscaAtiva = false;
        _restaurarCamadasNormais();
        _atualizarBarraBusca(false, 0);
        return;
    }

    // ── Oculta as camadas normais para deixar só a busca visível ──
    _buscaAtiva = true;
    _ocultarCamadasNormais();

    // ── Constrói a nova camada com os pontos da busca ──────────────
    const grupo = L.layerGroup();

    listaFinal.forEach(p => {
        const cfg       = p._cfg;
        const porPessoa = p._porPessoa || false;

        // Marcador pulsante para os vinculados à pessoa; marcador simples para os demais
        if (porPessoa) {
            // Ícone pulsante com div animado
            const icon = L.divIcon({
                className: '',
                html: `<div style="
                    position:relative;
                    width:22px;height:22px;">
                    <!-- anel pulsante -->
                    <div style="
                        position:absolute;inset:-6px;
                        border-radius:50%;
                        border:2.5px solid ${cfg.cor};
                        animation:buscaPulso 1.4s ease-out infinite;
                        opacity:.7;"></div>
                    <!-- ponto central -->
                    <div style="
                        position:absolute;inset:2px;
                        border-radius:50%;
                        background:${cfg.cor};
                        border:2px solid #fff;
                        box-shadow:0 0 8px ${cfg.cor}cc;"></div>
                </div>`,
                iconSize: [22, 22],
                iconAnchor: [11, 11]
            });
            const mk = L.marker([p.lat, p.lng], { icon, zIndexOffset: 1000 });
            mk.bindPopup(montarPopup(p, cfg), { maxWidth: 400 });
            grupo.addLayer(mk);
        } else {
            // Ponto simples com cor da camada, levemente maior
            const mk = L.circleMarker([p.lat, p.lng], {
                radius: 7, fillColor: cfg.cor, color: '#fff',
                weight: 2, fillOpacity: .9
            });
            mk.bindPopup(montarPopup(p, cfg), { maxWidth: 400 });
            grupo.addLayer(mk);
        }
    });

    _camadaBusca = grupo;
    _camadaBusca.addTo(_mapaL);

    // ── Ajusta o zoom para mostrar todos os pontos encontrados ──────
    if (listaFinal.length > 0) {
        const lats = listaFinal.map(p => p.lat);
        const lngs = listaFinal.map(p => p.lng);
        try {
            _mapaL.fitBounds(
                [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]],
                { padding: [50, 50], maxZoom: listaFinal.length === 1 ? 17 : 14, animate: true }
            );
        } catch(e) {}
    }

    _atualizarBarraBusca(true, listaFinal.length, pessoasEncontradas.length);
}

// Oculta as camadas normais (heat e cluster) sem destruí-las
function _ocultarCamadasNormais() {
    for (const cfg of CAMADAS_CONFIG) {
        const hl = _heatLayers[cfg.id];
        const cl = _clusterGroups[cfg.id];
        if (hl && _mapaL.hasLayer(hl)) _mapaL.removeLayer(hl);
        if (cl && _mapaL.hasLayer(cl)) _mapaL.removeLayer(cl);
    }
}

// Restaura as camadas normais conforme o estado atual (_camadasAtivas, _modoVista)
function _restaurarCamadasNormais() {
    atualizarVisibilidade();
}

// Barra flutuante no mapa com resumo da busca ativa
function _atualizarBarraBusca(ativa, total, totalPessoas) {
    let barra = document.getElementById('barra-busca-mapa');

    if (!ativa) {
        if (barra) barra.remove();
        return;
    }

    if (!barra) {
        barra = document.createElement('div');
        barra.id = 'barra-busca-mapa';
        barra.style.cssText = `
            position:absolute; top:12px; left:50%; transform:translateX(-50%);
            z-index:3000; background:rgba(10,22,40,.96);
            border:1px solid rgba(66,165,245,.45); border-radius:10px;
            padding:8px 14px; display:flex; align-items:center; gap:10px;
            font-size:11px; color:#cde; pointer-events:auto;
            box-shadow:0 4px 16px rgba(0,0,0,.5); backdrop-filter:blur(4px);
            white-space:nowrap; max-width:calc(100% - 80px);`;
        document.getElementById('mapa-wrapper')?.appendChild(barra);
    }

    const pessoaInfo = totalPessoas
        ? `<span style="color:#42a5f5;font-weight:bold;">👤 ${totalPessoas} pessoa(s)</span> ·`
        : '';

    barra.innerHTML = `
        <span style="color:#42a5f5;font-size:13px;">🔍</span>
        ${pessoaInfo}
        <span><b style="color:#fff;">${total.toLocaleString('pt-BR')}</b> ponto(s) no mapa</span>
        <button onclick="limparBusca()"
            style="background:rgba(239,83,80,.2);border:1px solid rgba(239,83,80,.4);
                   color:#ef9a9a;padding:3px 10px;border-radius:6px;cursor:pointer;
                   font-size:10px;font-weight:bold;margin-left:4px;">
            ✕ Limpar busca
        </button>`;
}

// Limpa a busca e restaura o mapa
function limparBusca() {
    const inp = document.getElementById('busca-oc');
    if (inp) inp.value = '';
    filtrarOcorrencias();
}

function _focarPonto(lat, lng, infoEnc) {
    _mapaL.setView([lat,lng],17,{ animate:true });
    try {
        const info = JSON.parse(decodeURIComponent(infoEnc));
        const cfg  = CAMADAS_CONFIG.find(c=>c.id===info.cfgId)||CAMADAS_CONFIG[0];
        const pSim = { boletim:info.bo, data:info.d, tip:info.t, bairro:info.bairro,
            logr:info.logr, cidade:info.cidade, solucao:info.sol, autorDireto:info.autor, lat, lng, _raw:{} };
        L.popup({ maxWidth:400 }).setLatLng([lat,lng]).setContent(montarPopup(pSim,cfg)).openOn(_mapaL);
    } catch(e) { console.warn(e); }
}

// ══════════════════════════════════════════════════════════════════
// LEGENDA
// ══════════════════════════════════════════════════════════════════
function adicionarLegenda() {
    if (_legendaCtrl) _legendaCtrl.remove();
    _legendaCtrl = L.control({ position:'bottomright' });
    _legendaCtrl.onAdd = () => {
        const div = L.DomUtil.create('div');
        div.id = 'mapa-legenda';
        div.style.cssText = `background:rgba(15,20,40,.92);color:#eee;padding:10px 14px;
            border-radius:10px;font-family:Arial,sans-serif;font-size:11px;
            min-width:170px;max-width:240px;box-shadow:0 4px 16px rgba(0,0,0,.5);backdrop-filter:blur(4px);`;
        return div;
    };
    _legendaCtrl.addTo(_mapaL);
    atualizarLegenda();
}

function atualizarLegenda() {
    const div = document.getElementById('mapa-legenda');
    if (!div) return;
    const ativas = CAMADAS_CONFIG.filter(c => _camadasAtivas.has(c.id) && (_dadosMapa[c.id]||[]).length>0);
    let html = `<div style="font-weight:bold;margin-bottom:8px;font-size:12px;color:#fff;">🗺️ Legenda</div>`;
    if (!ativas.length) {
        html += `<div style="color:rgba(255,255,255,.4);font-size:10px;">Nenhuma camada ativa</div>`;
    } else {
        ativas.forEach(c => {
            const n = (_dadosMapa[c.id]||[]).length;
            html += `<div style="display:flex;align-items:center;gap:7px;margin-bottom:5px;">
                <div style="width:12px;height:12px;border-radius:50%;background:${c.cor};flex-shrink:0;box-shadow:0 0 5px ${c.cor};"></div>
                <span style="flex:1;">${c.icon} ${c.label.split('—')[0].trim()}</span>
                <span style="color:rgba(255,255,255,.4);font-size:9px;">${n}</span>
            </div>`;
        });
    }
    div.innerHTML = html;
}

// ══════════════════════════════════════════════════════════════════
// CONTROLES DE CAMADA
// ══════════════════════════════════════════════════════════════════
function toggleCamada(id) {
    if (_camadasAtivas.has(id)) _camadasAtivas.delete(id); else _camadasAtivas.add(id);
    atualizarVisibilidade();
    renderPainelCamadas();
    atualizarLegenda();
}

function atualizarVisibilidade() {
    for (const cfg of CAMADAS_CONFIG) {
        const ativa=_camadasAtivas.has(cfg.id), hl=_heatLayers[cfg.id], cl=_clusterGroups[cfg.id];
        if (ativa) {
            if ((_modoVista==='heat'   ||_modoVista==='ambos')&&hl&&!_mapaL.hasLayer(hl)) hl.addTo(_mapaL);
            if ((_modoVista==='cluster'||_modoVista==='ambos')&&cl&&!_mapaL.hasLayer(cl)) cl.addTo(_mapaL);
        }
        if (!ativa||_modoVista==='cluster'){ if (hl&&_mapaL.hasLayer(hl)) _mapaL.removeLayer(hl); }
        if (!ativa||_modoVista==='heat')   { if (cl&&_mapaL.hasLayer(cl)) _mapaL.removeLayer(cl); }
    }
    atualizarResumo();
}

function setModo(modo) {
    _modoVista = modo;
    ['heat','cluster','ambos'].forEach(m => document.getElementById(`btn-modo-${m}`)?.classList.toggle('active',m===modo));
    atualizarVisibilidade();
}

function marcarTodas()    { CAMADAS_CONFIG.forEach(c=>_camadasAtivas.add(c.id));   renderPainelCamadas(); atualizarVisibilidade(); atualizarLegenda(); }
function desmarcarTodas() { _camadasAtivas.clear(); renderPainelCamadas(); atualizarVisibilidade(); atualizarLegenda(); }

// ══════════════════════════════════════════════════════════════════
// FILTROS DE PERÍODO
// ══════════════════════════════════════════════════════════════════
function aplicarFiltros() {
    const ini=document.getElementById('fil-ini')?.value;
    const fim=document.getElementById('fil-fim')?.value;
    _filtroIni = ini ? new Date(ini)             : null;
    _filtroFim = fim ? new Date(fim+'T23:59:59') : null;
    construirCamadas(); renderPainelCamadas(); renderListaOcorrencias(); atualizarLegenda();
}
function limparFiltros() {
    const i=document.getElementById('fil-ini'), f=document.getElementById('fil-fim');
    if (i) i.value=''; if (f) f.value='';
    _filtroIni=null; _filtroFim=null;
    // Limpa busca ativa no mapa também
    if (_buscaAtiva) { limparBusca(); }
    construirCamadas(); renderPainelCamadas(); renderListaOcorrencias(); atualizarLegenda();
}

// ══════════════════════════════════════════════════════════════════
// RESUMO / FIT BOUNDS / SIDEBAR / TELA CHEIA
// ══════════════════════════════════════════════════════════════════
function atualizarResumo() {
    const total = Object.values(_dadosMapa).reduce((s,a)=>s+a.length,0);
    const el=document.getElementById('total-gps'), res=document.getElementById('resumo-total');
    if (el)  el.textContent  = total.toLocaleString('pt-BR');
    if (res) res.textContent = `${total.toLocaleString('pt-BR')} pts GPS`;
}
function fitBounds() {
    const todos = Object.values(_dadosMapa).flat();
    if (!todos.length) return;
    const lats=todos.map(p=>p.lat), lngs=todos.map(p=>p.lng);
    _mapaL.fitBounds([[Math.min(...lats),Math.min(...lngs)],[Math.max(...lats),Math.max(...lngs)]],{ padding:[30,30] });
}
function toggleSidebar() {
    const painel=document.getElementById('painel-lateral'), btn=document.getElementById('btn-toggle-sidebar');
    painel.classList.toggle('collapsed');
    btn.textContent = painel.classList.contains('collapsed') ? '▶' : '◀';
    setTimeout(()=>_mapaL&&_mapaL.invalidateSize(),300);
}
function toggleTelaCheia() {
    const w=document.getElementById('mapa-card-wrapper'), f=document.fullscreenElement||document.webkitFullscreenElement;
    if (!f) (w.requestFullscreen||w.webkitRequestFullscreen).call(w);
    else    (document.exitFullscreen||document.webkitExitFullscreen).call(document);
}
document.addEventListener('fullscreenchange',       ()=>setTimeout(()=>_mapaL&&_mapaL.invalidateSize(),100));
document.addEventListener('webkitfullscreenchange', ()=>setTimeout(()=>_mapaL&&_mapaL.invalidateSize(),100));
function imprimirMapa() { window.print(); }

// ══════════════════════════════════════════════════════════════════
// ABAS DO PAINEL
// ══════════════════════════════════════════════════════════════════
function abrirTab(id) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(id)?.classList.add('active');
    const ordem = ['tab-camadas','tab-ocorrencias','tab-desenhos'];
    const idx = ordem.indexOf(id);
    const btns = document.querySelectorAll('.tab-btn');
    if (btns[idx]) btns[idx].classList.add('active');
}

// ══════════════════════════════════════════════════════════════════
// FERRAMENTAS DE DESENHO
// ══════════════════════════════════════════════════════════════════
function toggleDesenharPoligono() {
    if (_modoDesenho === 'poligono') {
        _cancelarDesenhoPoligono();
    } else {
        _modoDesenho = 'poligono';
        document.getElementById('btn-poligono')?.classList.add('active');
        document.getElementById('btn-add-marcador')?.classList.remove('active');
        document.getElementById('mapa-calor').style.cursor = 'crosshair';
        setStatusFerramenta('Clique para adicionar vértices · Duplo-clique para fechar');
        _mapaL.on('click', _onMapClick);
        _mapaL.doubleClickZoom.disable();
    }
}

function toggleAdicionarMarcador() {
    if (_modoDesenho === 'marcador') {
        _modoDesenho = null;
        document.getElementById('btn-add-marcador')?.classList.remove('active');
        document.getElementById('mapa-calor').style.cursor = '';
        setStatusFerramenta(''); _mapaL.off('click', _onMapClick);
    } else {
        _modoDesenho = 'marcador';
        document.getElementById('btn-add-marcador')?.classList.add('active');
        document.getElementById('btn-poligono')?.classList.remove('active');
        document.getElementById('mapa-calor').style.cursor = 'crosshair';
        setStatusFerramenta('Clique no mapa para adicionar um marcador');
        _mapaL.on('click', _onMapClick);
    }
}

function _cancelarDesenhoPoligono() {
    _modoDesenho = null;
    document.getElementById('btn-poligono')?.classList.remove('active');
    document.getElementById('mapa-calor').style.cursor = '';
    setStatusFerramenta('');
    _mapaL.off('click', _onMapClick);
    _mapaL.off('dblclick', _fecharPoligono);
    _mapaL.doubleClickZoom.enable();
    _polyPontosViz.forEach(m => _mapaL.removeLayer(m));
    _polyPontosViz = []; _polyPontos = [];
}

function _onMapClick(e) {
    if (_modoDesenho === 'marcador') {
        const nota = prompt('Nota do marcador (opcional):') || '';
        const mk = L.marker(e.latlng, { icon: L.divIcon({
            className:'',
            html:`<div style="background:#e65100;color:#fff;border-radius:50%;width:28px;height:28px;
                display:flex;align-items:center;justify-content:center;font-size:14px;
                border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4);">📌</div>`,
            iconSize:[28,28], iconAnchor:[14,14]
        })}).addTo(_mapaL);
        const obj = { layer:mk, nota, lat:e.latlng.lat, lng:e.latlng.lng, salvo:false };
        mk.bindPopup(_popupMarcador(obj));
        _rascMarcadores.push(obj);
        setStatusFerramenta(`✓ Marcador adicionado — clique em 💾 Salvar no popup`);

    } else if (_modoDesenho === 'poligono') {
        _polyPontos.push(e.latlng);
        const vm = L.circleMarker(e.latlng,{ radius:5, fillColor:'#ff7043', color:'#fff', weight:2, fillOpacity:1 }).addTo(_mapaL);
        _polyPontosViz.push(vm);
        if (_polyPontos.length === 1) _mapaL.on('dblclick', _fecharPoligono);
        setStatusFerramenta(`${_polyPontos.length} vértice(s) — duplo-clique para fechar`);
    }
}

function _fecharPoligono(e) {
    if (e) L.DomEvent.stop(e);
    if (_polyPontos.length < 3) { setStatusFerramenta('⚠️ Mínimo 3 vértices.'); return; }
    const nome = prompt('Nome do polígono:') || 'Área sem nome';
    const cor  = _corPoligono;

    const poly = L.polygon(_polyPontos,{ color:cor, weight:2.5, fillOpacity:.18, fillColor:cor }).addTo(_mapaL);
    const obj  = { layer:poly, nome, cor, pontos:[..._polyPontos], salvo:false };
    poly.bindPopup(_popupPoligono(obj));
    poly.on('click', ev => L.DomEvent.stopPropagation(ev));
    _rascPoligonos.push(obj);

    _polyPontosViz.forEach(m => _mapaL.removeLayer(m));
    _polyPontosViz=[]; _polyPontos=[];
    _mapaL.off('dblclick', _fecharPoligono);
    _mapaL.doubleClickZoom.enable();
    _modoDesenho = null;
    document.getElementById('btn-poligono')?.classList.remove('active');
    document.getElementById('mapa-calor').style.cursor = '';
    setStatusFerramenta(`✓ Polígono "${nome}" criado — clique em 💾 Salvar para persistir`);
}

// ── Popup polígono ─────────────────────────────────────────────
function _popupPoligono(obj) {
    const { nome, cor, salvo, fbKey } = obj;
    const badge = salvo
        ? `<span style="color:#81c784;font-size:9px;">✅ Salvo no Firebase</span>`
        : `<span style="color:#ffb74d;font-size:9px;">⚠️ Rascunho</span>`;
    const fk = esc(fbKey||'');
    const nm = esc(nome);
    return `<div style="min-width:200px;">
        <div style="background:${cor};color:#fff;padding:6px 10px;border-radius:6px 6px 0 0;
            font-weight:bold;margin:-10px -14px 10px;font-size:13px;">🔷 ${nm}</div>
        <div style="font-size:11px;color:#cde;margin-bottom:8px;">${badge}</div>
        <div style="display:flex;flex-direction:column;gap:6px;">
            <button onclick="_renomearPoligono('${fk}','${nm}')"
                style="background:rgba(33,150,243,.2);border:1px solid rgba(33,150,243,.4);
                color:#90caf9;padding:5px 10px;border-radius:6px;cursor:pointer;font-size:11px;width:100%;">
                ✏️ Renomear</button>
            ${!salvo?`<button onclick="_salvarPoligonoRasc('${nm}')"
                style="background:rgba(76,175,80,.2);border:1px solid rgba(76,175,80,.4);
                color:#a5d6a7;padding:5px 10px;border-radius:6px;cursor:pointer;font-size:11px;width:100%;">
                💾 Salvar no Firebase</button>`:''}
            <button onclick="_excluirPoligono('${fk}','${nm}')"
                style="background:rgba(244,67,54,.15);border:1px solid rgba(244,67,54,.35);
                color:#ef9a9a;padding:5px 10px;border-radius:6px;cursor:pointer;font-size:11px;width:100%;">
                🗑️ Excluir</button>
        </div></div>`;
}

// ── Popup marcador ─────────────────────────────────────────────
function _popupMarcador(obj) {
    const { nota, salvo, fbKey, lat, lng } = obj;
    const badge = salvo
        ? `<span style="color:#81c784;font-size:9px;">✅ Salvo</span>`
        : `<span style="color:#ffb74d;font-size:9px;">⚠️ Rascunho</span>`;
    const fk = esc(fbKey||'');
    return `<div style="min-width:180px;">
        <div style="background:#e65100;color:#fff;padding:6px 10px;border-radius:6px 6px 0 0;
            font-weight:bold;margin:-10px -14px 10px;font-size:13px;">📌 Marcador</div>
        ${nota?`<div style="font-size:11px;color:#cde;margin-bottom:6px;">${esc(nota)}</div>`:''}
        <div style="font-size:11px;margin-bottom:8px;">${badge}</div>
        <div style="display:flex;flex-direction:column;gap:6px;">
            ${!salvo?`<button onclick="_salvarMarcadorRasc(${lat},${lng},'${esc(nota||'')}')"
                style="background:rgba(76,175,80,.2);border:1px solid rgba(76,175,80,.4);
                color:#a5d6a7;padding:5px 10px;border-radius:6px;cursor:pointer;font-size:11px;width:100%;">
                💾 Salvar no Firebase</button>`:''}
            <button onclick="_excluirMarcador('${fk}',${lat},${lng})"
                style="background:rgba(244,67,54,.15);border:1px solid rgba(244,67,54,.35);
                color:#ef9a9a;padding:5px 10px;border-radius:6px;cursor:pointer;font-size:11px;width:100%;">
                🗑️ Excluir</button>
        </div></div>`;
}

// ── Ações de polígono ──────────────────────────────────────────
function _renomearPoligono(fbKey, nomeAtual) {
    const novoNome = prompt('Novo nome:', nomeAtual);
    if (!novoNome || novoNome === nomeAtual) return;
    _mapaL.closePopup();
    if (fbKey) {
        fbAtualizar(`${FB_DESENHOS_PATH}/${fbKey}`, { nome:novoNome }).then(ok => {
            if (!ok) return;
            const d = _fbDesenhos[fbKey];
            if (d) { d.nome=novoNome; d.layer.setPopupContent(_popupPoligono({ nome:novoNome, cor:d.cor, salvo:true, fbKey })); }
            renderPainelDesenhos();
            setStatusFerramenta(`✓ Renomeado para "${novoNome}"`);
        });
    } else {
        const r = _rascPoligonos.find(p => p.nome === nomeAtual);
        if (r) { r.nome=novoNome; r.layer.setPopupContent(_popupPoligono({ nome:novoNome, cor:r.cor, salvo:false })); }
        setStatusFerramenta(`✓ Renomeado para "${novoNome}"`);
    }
}

function _excluirPoligono(fbKey, nome) {
    if (!confirm(`Excluir "${nome}"?`)) return;
    _mapaL.closePopup();
    if (fbKey) {
        fbDeletar(`${FB_DESENHOS_PATH}/${fbKey}`).then(ok => {
            if (!ok) return;
            const d = _fbDesenhos[fbKey];
            if (d) { _mapaL.removeLayer(d.layer); delete _fbDesenhos[fbKey]; }
            renderPainelDesenhos();
            setStatusFerramenta(`🗑️ "${nome}" excluído`);
        });
    } else {
        const idx = _rascPoligonos.findIndex(p => p.nome === nome);
        if (idx>=0) { _mapaL.removeLayer(_rascPoligonos[idx].layer); _rascPoligonos.splice(idx,1); }
        setStatusFerramenta(`🗑️ Rascunho "${nome}" removido`);
    }
}

function _salvarPoligonoRasc(nome) {
    const r = _rascPoligonos.find(p => p.nome===nome && !p.salvo);
    if (!r) return;
    _mapaL.closePopup();
    fbSalvar(FB_DESENHOS_PATH, {
        tipo:'poligono', nome:r.nome, cor:r.cor,
        pontos: r.pontos.map(ll=>({ lat:ll.lat, lng:ll.lng })),
        criadoEm: new Date().toISOString()
    }).then(fbKey => {
        if (!fbKey) { setStatusFerramenta('❌ Erro ao salvar'); return; }
        r.salvo=true; r.fbKey=fbKey;
        r.layer.setPopupContent(_popupPoligono({ nome:r.nome, cor:r.cor, salvo:true, fbKey }));
        _fbDesenhos[fbKey] = { tipo:'poligono', layer:r.layer, visivel:true, nome:r.nome, cor:r.cor, fbKey };
        renderPainelDesenhos();
        setStatusFerramenta(`✅ "${r.nome}" salvo no Firebase!`);
    });
}

// ── Ações de marcador ──────────────────────────────────────────
function _salvarMarcadorRasc(lat, lng, nota) {
    const r = _rascMarcadores.find(m => m.lat===lat && m.lng===lng);
    if (!r) return;
    _mapaL.closePopup();
    fbSalvar(FB_DESENHOS_PATH, { tipo:'marcador', nota, lat, lng, criadoEm:new Date().toISOString() })
    .then(fbKey => {
        if (!fbKey) { setStatusFerramenta('❌ Erro ao salvar'); return; }
        r.salvo=true; r.fbKey=fbKey;
        r.layer.setPopupContent(_popupMarcador({ nota, salvo:true, fbKey, lat, lng }));
        r.layer.openPopup();
        _fbDesenhos[fbKey] = { tipo:'marcador', layer:r.layer, visivel:true, nota, fbKey, lat, lng };
        renderPainelDesenhos();
        setStatusFerramenta(`✅ Marcador salvo!`);
    });
}

function _excluirMarcador(fbKey, lat, lng) {
    if (!confirm('Excluir este marcador?')) return;
    _mapaL.closePopup();
    if (fbKey) {
        fbDeletar(`${FB_DESENHOS_PATH}/${fbKey}`).then(ok => {
            if (!ok) return;
            const d = _fbDesenhos[fbKey];
            if (d) { _mapaL.removeLayer(d.layer); delete _fbDesenhos[fbKey]; }
            renderPainelDesenhos();
            setStatusFerramenta('🗑️ Marcador excluído');
        });
    } else {
        const idx = _rascMarcadores.findIndex(m => m.lat===lat && m.lng===lng);
        if (idx>=0) { _mapaL.removeLayer(_rascMarcadores[idx].layer); _rascMarcadores.splice(idx,1); }
        setStatusFerramenta('🗑️ Marcador removido');
    }
}

// ── Limpar rascunhos (apenas não salvos) ──────────────────────
function limparDesenhos() {
    _rascPoligonos.filter(p=>!p.salvo).forEach(p=>_mapaL.removeLayer(p.layer));
    _rascMarcadores.filter(m=>!m.salvo).forEach(m=>_mapaL.removeLayer(m.layer));
    _rascPoligonos  = _rascPoligonos.filter(p=>p.salvo);
    _rascMarcadores = _rascMarcadores.filter(m=>m.salvo);
    _polyPontosViz.forEach(m=>_mapaL.removeLayer(m));
    _polyPontosViz=[]; _polyPontos=[];
    if (_modoDesenho) {
        _modoDesenho=null;
        _mapaL.off('click',_onMapClick); _mapaL.off('dblclick',_fecharPoligono);
        _mapaL.doubleClickZoom.enable();
        document.getElementById('btn-poligono')?.classList.remove('active');
        document.getElementById('btn-add-marcador')?.classList.remove('active');
        document.getElementById('mapa-calor').style.cursor='';
    }
    setStatusFerramenta('Rascunhos removidos. Desenhos salvos permanecem.');
}

// ══════════════════════════════════════════════════════════════════
// CARREGAR DESENHOS SALVOS DO FIREBASE
// ══════════════════════════════════════════════════════════════════
async function carregarDesenhosSalvos() {
    const dados = await fbFetchObjComCache(FB_DESENHOS_PATH);
    if (!dados || typeof dados !== 'object') { renderPainelDesenhos(); return; }

    Object.entries(dados).forEach(([fbKey, d]) => {
        if (!d || !d.tipo) return;
        if (d.tipo === 'poligono' && Array.isArray(d.pontos) && d.pontos.length >= 3) {
            const cor=d.cor||'#1565c0', nome=d.nome||'Polígono';
            const layer = L.polygon(d.pontos.map(p=>[p.lat,p.lng]),{
                color:cor, weight:2.5, fillOpacity:.18, fillColor:cor
            }).addTo(_mapaL);
            const obj = { tipo:'poligono', layer, visivel:true, nome, cor, fbKey };
            layer.bindPopup(_popupPoligono({ nome, cor, salvo:true, fbKey }));
            layer.on('click', ev=>L.DomEvent.stopPropagation(ev));
            _fbDesenhos[fbKey] = obj;
        } else if (d.tipo === 'marcador' && d.lat && d.lng) {
            const nota=d.nota||'';
            const mk = L.marker([d.lat,d.lng],{ icon: L.divIcon({
                className:'',
                html:`<div style="background:#1565c0;color:#fff;border-radius:50%;width:28px;height:28px;
                    display:flex;align-items:center;justify-content:center;font-size:14px;
                    border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4);">📍</div>`,
                iconSize:[28,28], iconAnchor:[14,14]
            })}).addTo(_mapaL);
            mk.bindPopup(_popupMarcador({ nota, salvo:true, fbKey, lat:d.lat, lng:d.lng }));
            _fbDesenhos[fbKey] = { tipo:'marcador', layer:mk, visivel:true, nota, fbKey, lat:d.lat, lng:d.lng };
        }
    });

    renderPainelDesenhos();
    console.log(`[Firebase] ${Object.keys(_fbDesenhos).length} desenhos carregados.`);
}

// ══════════════════════════════════════════════════════════════════
// PAINEL — DESENHOS SALVOS
// ══════════════════════════════════════════════════════════════════
function renderPainelDesenhos() {
    const el = document.getElementById('lista-desenhos');
    if (!el) return;
    const todos = Object.values(_fbDesenhos);
    if (!todos.length) {
        el.innerHTML = `<div style="color:rgba(255,255,255,.3);font-size:10px;text-align:center;padding:14px;">
            Nenhum desenho salvo no Firebase<br>
            <span style="opacity:.5;font-size:9px;">Crie polígonos ou marcadores e salve-os</span></div>`;
        return;
    }
    // Agrupa por nome
    const grupos = {};
    todos.forEach(d => {
        const g = d.tipo==='poligono' ? d.nome : `📌 ${d.nota||'Marcador'}`;
        if (!grupos[g]) grupos[g]=[];
        grupos[g].push(d);
    });
    el.innerHTML = Object.entries(grupos).map(([grupo, items]) => {
        const cor = items[0].tipo==='poligono' ? (items[0].cor||'#1565c0') : '#e65100';
        const vis = items.every(d=>d.visivel);
        const icone = items[0].tipo==='poligono' ? '🔷' : '📍';
        return `<div class="camada-toggle ${vis?'ativa':''}"
            style="--cor:${cor};background:${vis?cor:'rgba(255,255,255,.04)'};
                   border-color:${vis?cor:'rgba(255,255,255,.08)'};
                   box-shadow:${vis?`0 0 8px ${cor}55`:'none'};"
            onclick="_toggleDesenhoGrupo('${esc(grupo)}')">
            <div class="camada-dot" style="background:#fff;opacity:${vis?1:.4};"></div>
            <span class="camada-nome" style="color:${vis?'#fff':'#99a'};font-weight:${vis?'bold':'normal'};">
                ${icone} ${esc(grupo)}
            </span>
            <div style="display:flex;gap:4px;align-items:center;">
                <span class="camada-count" style="background:rgba(0,0,0,.25);color:${vis?'#fff':'rgba(255,255,255,.35)'};">
                    ${items.length}
                </span>
                <button onclick="event.stopPropagation();_focarDesenhoGrupo('${esc(grupo)}')"
                    style="background:none;border:none;color:rgba(255,255,255,.45);cursor:pointer;
                    font-size:13px;padding:0 3px;" title="Ir para no mapa">⛶</button>
            </div>
        </div>`;
    }).join('');
}

function _toggleDesenhoGrupo(grupo) {
    const items = Object.values(_fbDesenhos).filter(d => {
        const g = d.tipo==='poligono' ? d.nome : `📌 ${d.nota||'Marcador'}`;
        return g === grupo;
    });
    const vis = items.every(d=>d.visivel);
    items.forEach(d => {
        d.visivel = !vis;
        if (d.visivel) d.layer.addTo(_mapaL); else _mapaL.removeLayer(d.layer);
    });
    renderPainelDesenhos();
}

function _focarDesenhoGrupo(grupo) {
    const items = Object.values(_fbDesenhos).filter(d => {
        const g = d.tipo==='poligono' ? d.nome : `📌 ${d.nota||'Marcador'}`;
        return g === grupo;
    });
    if (!items.length) return;
    try {
        let bounds = null;
        items.forEach(d => {
            if (!d.visivel) return;
            const b = d.layer.getBounds ? d.layer.getBounds() : L.latLngBounds([d.layer.getLatLng()]);
            bounds = bounds ? bounds.extend(b) : b;
        });
        if (bounds) _mapaL.fitBounds(bounds, { padding:[40,40], maxZoom:16 });
    } catch(e) {}
}

// ══════════════════════════════════════════════════════════════════
// IMPORTAÇÃO GEOJSON
// ══════════════════════════════════════════════════════════════════
function importarGeojson(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const geojson = JSON.parse(e.target.result);
            const nome = file.name.replace(/\.(geojson|json)$/i,'');
            const layer = L.geoJSON(geojson,{
                style:{ color:'#00e5ff', weight:2, fillOpacity:.15 },
                onEachFeature:(feat,layer)=>{
                    const linhas = Object.entries(feat.properties||{}).slice(0,10)
                        .map(([k,v])=>`<b>${k}:</b> ${v}`).join('<br>');
                    layer.bindPopup(`<b>${nome}</b><br>${linhas}`,{ maxWidth:300 });
                }
            }).addTo(_mapaL);
            _camadasImportadas.push({ nome, layer, cor:'#00e5ff' });
            try { _mapaL.fitBounds(layer.getBounds(),{ padding:[30,30] }); } catch(e){}
            setStatusFerramenta(`✅ "${nome}" importado — ${geojson.features?.length??'?'} feições.`);
        } catch(e) { alert('Erro ao ler GeoJSON: '+e.message); }
    };
    reader.readAsText(file);
    event.target.value = '';
}

// ══════════════════════════════════════════════════════════════════
// RELÓGIO
// ══════════════════════════════════════════════════════════════════
(function relogio() {
    const el = document.getElementById('relogio-mapa');
    if (el) el.textContent = new Date().toLocaleString('pt-BR');
    setTimeout(relogio, 1000);
})();

// ══════════════════════════════════════════════════════════════════
// INICIAR
// ══════════════════════════════════════════════════════════════════
carregarFirebase();