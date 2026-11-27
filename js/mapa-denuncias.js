// ════════════════════════════════════════════════════════════════════
// Sistema P3 — Camada de DISQUE-DENÚNCIAS no Mapa de Inteligência
// --------------------------------------------------------------------
// Pedido do usuário (26/11/2026): "no mapa inteligência quero que apareçam
// os endereços dos disk denúncias (pendentes e concluídos)".
// Camada independente (não mexe em js/mapa-alvos.js) — usa o mapa global
// _mapaL já criado pela página. Plota as denúncias que têm endereço com
// coordenada válida (tb_denuncias.endereco_id → tb_enderecos lat/long),
// âmbar = pendente, verde = concluído. Controle próprio pra ligar/desligar.
// Mesmo Supabase/chave do Echelon já usados em mapa-alvos.js.
// ════════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    const SB_URL = 'https://zxynbnnooauasmasgzxp.supabase.co';
    const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp4eW5ibm5vb2F1YXNtYXNnenhwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjg0ODE2NSwiZXhwIjoyMDg4NDI0MTY1fQ.f7CldsqEQdSsGGptzjgQiBVElKjNIyzu3ZHO9wHeQ94';
    const e = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const plain = h => { const t = document.createElement('div'); t.innerHTML = String(h || ''); return (t.textContent || '').replace(/\s+/g, ' ').trim(); };
    const dataBr = v => { const m = String(v || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; };

    const dentroAL = (lat, lng) => lat > -10.6 && lat < -8.7 && lng > -38.4 && lng < -35.0;
    function coord(lat, lng) {
        const a = parseFloat(String(lat == null ? '' : lat).replace(',', '.')), b = parseFloat(String(lng == null ? '' : lng).replace(',', '.'));
        if (isNaN(a) || isNaN(b) || !a || !b) return null;
        if (Number.isInteger(a) && Number.isInteger(b)) return null;
        if (dentroAL(a, b)) return { lat: a, lng: b };
        if (dentroAL(b, a)) return { lat: b, lng: a };
        return null;
    }
    // Muitos endereços têm a coordenada só no LINK do mapa (ex.: Google
    // Maps colado), não nas colunas latitude/longitude — extrai de lá.
    function coordDoLink(link) {
        const m = String(link || '').match(/(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/);
        return m ? coord(m[1], m[2]) : null;
    }
    async function sb(tabela, query) {
        const r = await fetch(`${SB_URL}/rest/v1/${tabela}?${query}`, { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } });
        if (!r.ok) throw new Error(`${tabela}: HTTP ${r.status}`);
        return r.json();
    }

    const D = { camada: null, visivel: true, pend: 0, concl: 0, carregado: false };
    window.MapaDenuncias = D;

    function concluida(s) { return /conclu/.test(String(s || '').toLowerCase()); }
    function icone(conc) {
        const cor = conc ? '#2f9e44' : '#f08c00';
        return L.divIcon({
            className: '', iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -14],
            html: `<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${cor};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.5);display:grid;place-items:center">
                <i class="fa-solid fa-phone-volume" style="transform:rotate(45deg);color:#fff;font-size:12px"></i></div>`,
        });
    }
    function popup(d, c) {
        const st = concluida(d.status_operacional) ? '<span style="color:#2f9e44;font-weight:700">Concluída</span>' : '<span style="color:#f08c00;font-weight:700">Pendente</span>';
        const en = d.endereco || {};
        const endTxt = [en.tipo_logradouro, en.logradouro, en.numero].filter(Boolean).join(' ');
        return `<div style="font-size:12px;min-width:200px;color:#e3ecf7">
            <div style="font-weight:800;color:#fff">📞 Denúncia nº ${e(d.numero || '—')}</div>
            <div style="color:#ffd59a">${e(d.tipo || '')}</div>
            <div style="margin:4px 0">${st}${d.data_denuncia ? ' · ' + e(dataBr(d.data_denuncia)) : ''}</div>
            ${endTxt ? `<div style="color:rgba(227,236,247,.75)">📍 ${e(endTxt)}</div>` : ''}
            ${d.resumo_breve ? `<div style="color:rgba(227,236,247,.6);margin-top:4px;max-height:60px;overflow:hidden">${e(plain(d.resumo_breve).slice(0, 160))}</div>` : ''}
            <div style="margin-top:6px"><a href="p2-missoes.html" style="color:#90caf9">Abrir em Missões →</a></div>
        </div>`;
    }

    async function carregar() {
        let linhas;
        try {
            linhas = await sb('tb_denuncias', 'select=id,numero,tipo,status_operacional,data_denuncia,resumo_breve,endereco:tb_enderecos(latitude,longitude,link_localizacao,logradouro,numero,tipo_logradouro)&endereco_id=not.is.null&limit=6000');
        } catch (err) { console.warn('[denuncias-mapa]', err.message); return; }
        D.camada = (L.markerClusterGroup ? L.markerClusterGroup({ maxClusterRadius: 30, disableClusteringAtZoom: 16, showCoverageOnHover: false,
            iconCreateFunction: c => L.divIcon({ className: '', iconSize: [32, 32], html: `<div style="width:32px;height:32px;border-radius:50%;background:#f08c00;border:3px solid #fff;color:#fff;font:800 12px Arial;display:grid;place-items:center;box-shadow:0 2px 8px rgba(0,0,0,.5)">📞${c.getChildCount()}</div>` }) }) : L.layerGroup());
        D.pend = 0; D.concl = 0;
        linhas.forEach(d => {
            const en = d.endereco; if (!en) return;
            const c = coord(en.latitude, en.longitude) || coordDoLink(en.link_localizacao); if (!c) return;
            const conc = concluida(d.status_operacional);
            conc ? D.concl++ : D.pend++;
            L.marker([c.lat, c.lng], { icon: icone(conc), zIndexOffset: 500 }).bindPopup(popup(d, c)).addTo(D.camada);
        });
        D.carregado = true;
        if (D.visivel) D.camada.addTo(_mapaL);
        atualizarControle();
    }

    function alternar(v) { D.visivel = v; if (!D.camada) return; if (v) D.camada.addTo(_mapaL); else _mapaL.removeLayer(D.camada); }
    D.alternar = alternar;

    let ctrlEl = null;
    function adicionarControle() {
        const Ctrl = L.Control.extend({
            options: { position: 'topright' },
            onAdd: function () {
                const div = L.DomUtil.create('div');
                div.style.cssText = 'background:rgba(10,22,40,.92);color:#e3ecf7;border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:8px 10px;font:12px Inter,Arial;box-shadow:0 2px 10px rgba(0,0,0,.5);min-width:170px';
                div.innerHTML = `<label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-weight:700">
                    <input type="checkbox" id="mdn-ck" checked> <i class="fa-solid fa-phone-volume" style="color:#f08c00"></i> Disque-denúncias</label>
                    <div id="mdn-cnt" style="font-size:10.5px;color:rgba(227,236,247,.6);margin-top:4px">carregando…</div>`;
                L.DomEvent.disableClickPropagation(div);
                div.querySelector('#mdn-ck').addEventListener('change', ev => alternar(ev.target.checked));
                ctrlEl = div;
                return div;
            },
        });
        _mapaL.addControl(new Ctrl());
    }
    function atualizarControle() {
        if (!ctrlEl) return;
        const c = ctrlEl.querySelector('#mdn-cnt');
        if (c) c.innerHTML = `<span style="color:#f8b24d">● ${D.pend} pendentes</span> · <span style="color:#69db7c">● ${D.concl} concluídas</span>`;
    }

    // Espera o mapa global (_mapaL) existir (criado por mapa-Dashboard-P3.js).
    let tentativas = 0;
    const timer = setInterval(() => {
        tentativas++;
        if (typeof _mapaL !== 'undefined' && _mapaL && window.L) {
            clearInterval(timer);
            try { adicionarControle(); carregar(); } catch (err) { console.warn('[denuncias-mapa] init', err); }
        } else if (tentativas > 120) { clearInterval(timer); }
    }, 300);
})();
