// ═══════════════════════════════════════════════════════════════════
// OPERAÇÃO SUFOCAMENTO (page/opo-sufocamento.html)
// ═══════════════════════════════════════════════════════════════════
// Modalidade de OPO pedida pelo usuário, diferente da OPO convencional:
//  · Focos: ARMAS, DROGAS, MVI, CVP e CCP (crimes contra o patrimônio sem
//    violência — furto, receptação, dano, estelionato, apropriação indébita)
//    na cidade ou na área escolhida, com hotspots de TODOS no mapa.
//  · Pesos por ocorrência (mesmo sistema da OPO: gravidade) × recência:
//      MVI 1,00 · ARMA 0,85 · DROGA 0,75 · CVP 0,55 · CCP 0,30
//      recência: ≤30 dias ×1,0 · ≤90 ×0,75 · mais antigo ×0,5
//  · Agrupamento das ocorrências por proximidade (raio escolhido) → cada
//    grupo vira uma ÁREA DELIMITADA (centro ponderado + raio que cobre as
//    ocorrências), pontuada pela soma dos pesos.
//  · Execução: 30 min por área (configurável). RPs no ENTORNO (pontos de
//    bloqueio N/L/S/O… do perímetro); especializadas (PELOPES/Tático Urbano e
//    Tático Rural) em SATURAÇÃO no interior; depois todas seguem para a
//    próxima área. Ordem: maior pontuação primeiro, depois a área mais
//    próxima (menos deslocamento); o ciclo se repete até o término.
//  · Salva como OPO (cartoes_programa, modalidade "sufocamento") + documento
//    (opo_documentos) → aparece no Controle de Operações com resultados.
// ═══════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const FOCOS = [
        { id: 'MVI', nome: 'MVI', peso: 1.0, cor: '#111111' },
        { id: 'ARMA', nome: 'Armas', peso: 0.85, cor: '#455a64' },
        { id: 'DROGA', nome: 'Drogas', peso: 0.75, cor: '#7cb342' },
        { id: 'CVP', nome: 'CVP', peso: 0.55, cor: '#e65100' },
        { id: 'CCP', nome: 'CCP', peso: 0.30, cor: '#f9a825' },
    ];
    const F = Object.fromEntries(FOCOS.map(f => [f.id, f]));
    const ESPECIALIZADAS = /PELOPES|TATICO|TÁTICO|FOR[CÇ]A TAREFA|\bFT\b|ROTAM|GOE/i;
    const VEL_KMH = 35; // deslocamento médio estimado entre áreas

    let CFG = null, DB = null, MAPA = null, CAMADAS = null, RESULT = null, CIDADES = [], GUARN = [];
    const $ = id => document.getElementById(id);
    const NORM = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
    const val = v => { const s = (v == null ? '' : String(v)).trim(); return s && s !== '---' ? s : ''; };
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const fmt = (n, d = 0) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    function parseData(s) {
        s = val(s);
        let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
        m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
        return null;
    }
    const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isNaN(n) ? null : n; };
    const distM = (a, b) => { const R = 6371000, r = x => x * Math.PI / 180; const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng); const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
    const hm = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const minutos = h => { const m = String(h || '').match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };

    async function no(nome) {
        window._NODES_CACHE = window._NODES_CACHE || {};
        if (window._NODES_CACHE[nome]) return window._NODES_CACHE[nome];
        const d = await fetch(`${DB}/${nome}.json`).then(r => r.ok ? r.json() : null).catch(() => null);
        return (window._NODES_CACHE[nome] = d ? Object.values(d).filter(Boolean) : []);
    }

    // ── Classificação das ocorrências nos focos ─────────────────────
    const tipG = o => NORM(`${o.TIPIFICACAO_GERAL || ''} ${o.TIPIFICACAO || ''}`);
    function focoGeral(o) {
        const t = tipG(o);
        if (/HOMICIDIO|FEMINICIDIO|LATROCINIO/.test(t) && (!/TENTATIVA/.test(t) || NORM(o.OBITO) === 'S')) return 'MVI';
        if (/ROUBO|EXTORS/.test(t)) return 'CVP';
        if (/FURTO|RECEPTACAO|DANO\b|ESTELIONATO|APROPRIACAO INDEBITA/.test(t)) return 'CCP';
        return null;
    }
    async function coletar(cidadeNorm, dias, focos) {
        const [geral, armas, drogas] = await Promise.all([no('geral'), no('arma'), no('droga')]);
        const hoje = new Date(); hoje.setHours(23, 59, 59, 999);
        const ini = new Date(hoje); ini.setDate(ini.getDate() - dias);
        const pts = [], vistos = new Set();
        const add = (o, foco) => {
            if (!focos.includes(foco)) return;
            // arma/droga têm um registro por item apreendido: conta 1 por boletim e foco
            const chave = val(o.BOLETIM) ? foco + '|' + val(o.BOLETIM) : null;
            if (chave && vistos.has(chave)) return;
            const d = parseData(o.DATA); if (!d || d < ini || d > hoje) return;
            if (cidadeNorm && NORM(o.CIDADE) !== cidadeNorm) return;
            const lat = num(o.LATITUDE), lng = num(o.LONGITUDE);
            if (lat == null || lng == null || lat > -7 || lat < -11 || lng > -34 || lng < -39) return;
            if (chave) vistos.add(chave);
            const idade = (hoje - d) / 864e5;
            const rec = idade <= 30 ? 1 : idade <= 90 ? 0.75 : 0.5;
            pts.push({ foco, lat, lng, peso: F[foco].peso * rec, data: val(o.DATA), hora: val(o.HORA), bairro: val(o.BAIRRO), cidade: val(o.CIDADE), boletim: val(o.BOLETIM), tip: val(o.TIPIFICACAO_GERAL || o.TIPIFICACAO || o.TIPO_ARMA || o.TIPO_DROGA) });
        };
        geral.forEach(o => { const f = focoGeral(o); if (f) add(o, f); });
        armas.forEach(o => add(o, 'ARMA'));
        drogas.forEach(o => add(o, 'DROGA'));
        return pts;
    }

    // ── Agrupamento ponderado → áreas delimitadas ───────────────────
    function agrupar(pts, raioM) {
        const ord = pts.slice().sort((a, b) => b.peso - a.peso);
        const grupos = [];
        for (const p of ord) {
            let melhor = null, dMin = Infinity;
            for (const g of grupos) { const d = distM(g, p); if (d < raioM && d < dMin) { dMin = d; melhor = g; } }
            if (!melhor) { grupos.push({ lat: p.lat, lng: p.lng, pts: [p], score: p.peso }); continue; }
            melhor.pts.push(p);
            melhor.score += p.peso;
            const w = melhor.pts.reduce((s, x) => s + x.peso, 0);
            melhor.lat = melhor.pts.reduce((s, x) => s + x.lat * x.peso, 0) / w;
            melhor.lng = melhor.pts.reduce((s, x) => s + x.lng * x.peso, 0) / w;
        }
        return grupos.map(g => {
            const raio = Math.min(Math.max(150, ...g.pts.map(p => distM(g, p) + 60)), raioM * 1.4);
            const cont = Object.fromEntries(FOCOS.map(f => [f.id, g.pts.filter(p => p.foco === f.id).length]));
            const bairros = {}; g.pts.forEach(p => { if (p.bairro) bairros[p.bairro] = (bairros[p.bairro] || 0) + 1; });
            const cid = {}; g.pts.forEach(p => { if (p.cidade) cid[p.cidade] = (cid[p.cidade] || 0) + 1; });
            const top = o => Object.entries(o).sort((a, b) => b[1] - a[1])[0];
            return { lat: g.lat, lng: g.lng, raioM: Math.round(raio), score: +g.score.toFixed(2), total: g.pts.length, cont,
                bairro: top(bairros) ? top(bairros)[0] : '', cidade: top(cid) ? top(cid)[0] : '', pts: g.pts };
        }).filter(g => g.total >= 2).sort((a, b) => b.score - a.score);
    }
    // Ordem de execução: começa pela maior pontuação, segue sempre para a mais próxima.
    function rotear(areas) {
        if (!areas.length) return [];
        const rest = areas.slice(1), rota = [areas[0]];
        while (rest.length) {
            const atual = rota[rota.length - 1];
            let k = 0, dMin = Infinity;
            rest.forEach((a, i) => { const d = distM(atual, a) / (1 + a.score / 10); if (d < dMin) { dMin = d; k = i; } });
            rota.push(rest.splice(k, 1)[0]);
        }
        return rota;
    }
    // Pontos de entorno no perímetro (N, L, S, O, NE, SE, SO, NO).
    const ROSA = [['N', 0], ['L', 90], ['S', 180], ['O', 270], ['NE', 45], ['SE', 135], ['SO', 225], ['NO', 315]];
    function pontoNoPerimetro(a, graus) {
        const r = a.raioM / 111320, rad = graus * Math.PI / 180;
        return { lat: a.lat + r * Math.cos(rad), lng: a.lng + r * Math.sin(rad) / Math.cos(a.lat * Math.PI / 180) };
    }
    function distribuir(area, entorno, saturacao) {
        const pos = entorno.map((g, i) => ({ guarnicao: g, ponto: ROSA[i % ROSA.length][0], ...pontoNoPerimetro(area, ROSA[i % ROSA.length][1]) }));
        return { entorno: pos, saturacao: saturacao.slice() };
    }
    function cronograma(rota, hIni, hFim, dur, somarDesl) {
        const slots = [];
        if (!rota.length) return slots;
        let t = minutos(hIni) ?? 19 * 60;
        let fim = minutos(hFim) ?? t + 240;
        if (fim <= t) fim += 24 * 60; // atravessa a meia-noite
        let i = 0, ciclo = 1, anterior = null;
        while (t + dur <= fim && slots.length < 60) {
            const a = rota[i];
            let desl = 0;
            if (anterior && somarDesl) desl = Math.ceil((distM(anterior, a) / 1000) / VEL_KMH * 60 / 5) * 5;
            t += desl;
            if (t + dur > fim) break;
            slots.push({ ordem: slots.length + 1, area: a.n, ciclo, ini: hm(t), fim: hm(t + dur), deslocamentoMin: desl, distanciaKm: anterior ? +(distM(anterior, a) / 1000).toFixed(1) : 0 });
            t += dur; anterior = a; i++;
            if (i >= rota.length) { i = 0; ciclo++; }
        }
        return slots;
    }

    // ── Geração ─────────────────────────────────────────────────────
    const lerFocos = () => [...document.querySelectorAll('#su-focos input:checked')].map(i => i.value);
    const marcadas = id => [...document.querySelectorAll(`#${id} input:checked`)].map(i => i.value);
    async function gerar() {
        const btn = $('su-gerar'), st = $('su-status');
        const focos = lerFocos();
        const escopo = $('su-escopo').value, cidade = $('su-cidade').value;
        if (!focos.length) { alert('Selecione ao menos um foco.'); return; }
        if (escopo === 'cidade' && !cidade) { alert('Selecione a cidade.'); return; }
        const entorno = marcadas('su-entorno'), saturacao = marcadas('su-saturacao');
        if (!entorno.length && !saturacao.length) { alert('Selecione as guarnições.'); return; }
        const dataIni = $('su-data-ini').value, dataFim = $('su-data-fim').value || dataIni;
        if (!dataIni) { alert('Informe o período da operação (de / até).'); return; }
        if (dataFim < dataIni) { alert('A data final é anterior à inicial.'); return; }
        btn.disabled = true; st.textContent = '⏳ Coletando ocorrências com coordenadas…';
        try {
            const dias = +$('su-periodo').value, raio = +$('su-raio').value;
            const pts = await coletar(escopo === 'cidade' ? NORM(cidade) : '', dias, focos);
            st.textContent = `⏳ Agrupando ${fmt(pts.length)} ocorrência(s)…`;
            const todas = agrupar(pts, raio);
            const n = +$('su-nareas').value;
            const escolhidas = todas.slice(0, n);
            const rota = rotear(escolhidas);
            rota.forEach((a, i) => { a.n = i + 1; Object.assign(a, distribuir(a, entorno, saturacao)); });
            const dur = +$('su-dur').value;
            const slots = cronograma(rota, $('su-hini').value, $('su-hfim').value, dur, $('su-desl').value === '1');
            RESULT = { focos, escopo, cidade, dias, raio, dur, pts, areas: rota, todas: todas.length, slots, entorno, saturacao,
                dataIni, dataFim, hIni: $('su-hini').value, hFim: $('su-hfim').value,
                protocolo: `P3/10°BPM — OPO N° ${String(Math.floor(Math.random() * 900) + 100)}/${dataIni.slice(0, 4)}`,
                nome: val($('su-nome').value) || `OPERAÇÃO SUFOCAMENTO — ${escopo === 'cidade' ? cidade : 'ÁREA DA UNIDADE'}`.toUpperCase() };
            render();
            if (rota.length) {
                st.textContent = '⏳ Gerando os mapas da OPO…';
                await gerarMapas(RESULT);
                $('su-doc').innerHTML = documentoHTML();
            }
            st.textContent = rota.length ? `✅ ${rota.length} área(s) delimitada(s) de ${todas.length} agrupamento(s) · ${slots.length} período(s) de ${dur} min.` : '⚠️ Nenhum agrupamento com 2 ou mais ocorrências com coordenadas no recorte — aumente o período ou o raio.';
            ['su-word', 'su-imprimir', 'su-salvar'].forEach(id => { $(id).disabled = !rota.length; });
        } catch (e) { console.error('[sufocamento]', e); st.textContent = '⚠️ ' + e.message; }
        btn.disabled = false;
    }

    // ── Render (mapa, tabelas, documento) ───────────────────────────
    function render() {
        const R = RESULT;
        const contFoco = Object.fromEntries(FOCOS.map(f => [f.id, R.pts.filter(p => p.foco === f.id).length]));
        $('su-kpis').innerHTML = `<div class="su-kpi" style="--c:#b91c1c"><small>Áreas</small><b>${R.areas.length}</b></div>` +
            FOCOS.filter(f => R.focos.includes(f.id)).map(f => `<div class="su-kpi" style="--c:${f.cor}"><small>${f.nome}</small><b>${fmt(contFoco[f.id])}</b></div>`).join('') +
            `<div class="su-kpi" style="--c:#1d4ed8"><small>Períodos de ${R.dur} min</small><b>${R.slots.length}</b></div>`;
        desenharMapa();
        const linhasAreas = R.areas.map(a => `<tr><td><span class="su-num">${a.n}</span></td><td><b>${esc(a.bairro || '—')}</b><br><small>${esc(a.cidade)}</small></td><td>${fmt(a.score, 2)}</td>
            <td>${FOCOS.filter(f => a.cont[f.id]).map(f => `${f.nome}: ${a.cont[f.id]}`).join(' · ')}</td><td>${a.raioM} m</td>
            <td>${a.entorno.map(p => `${esc(p.guarnicao)} <small>(${p.ponto})</small>`).join('<br>') || '—'}</td><td>${a.saturacao.map(esc).join('<br>') || '—'}</td>
            <td><a href="https://www.google.com/maps?q=${a.lat.toFixed(6)},${a.lng.toFixed(6)}" target="_blank" rel="noopener">${a.lat.toFixed(5)}, ${a.lng.toFixed(5)}</a></td></tr>`).join('');
        $('su-areas').innerHTML = R.areas.length ? `<div style="overflow:auto"><table class="su-tab"><tr><th>Nº</th><th>Área</th><th>Pontuação</th><th>Ocorrências</th><th>Raio</th><th>Entorno (RPs)</th><th>Saturação (interior)</th><th>Centro</th></tr>${linhasAreas}</table></div>` : '<div class="su-vazio">Nenhuma área.</div>';
        $('su-crono').innerHTML = R.slots.length ? `<div style="overflow:auto"><table class="su-tab"><tr><th>#</th><th>Horário</th><th>Área</th><th>Ciclo</th><th>Deslocamento</th></tr>${R.slots.map(s => {
            const a = R.areas.find(x => x.n === s.area);
            return `<tr><td>${s.ordem}</td><td><b>${s.ini} – ${s.fim}</b></td><td><span class="su-num">${s.area}</span> ${esc(a.bairro || '')}</td><td>${s.ciclo}º</td><td>${s.distanciaKm ? `${fmt(s.distanciaKm, 1)} km · ~${s.deslocamentoMin} min` : 'início'}</td></tr>`; }).join('')}</table></div>` : '<div class="su-vazio">Janela de horário insuficiente.</div>';
        $('su-doc').innerHTML = documentoHTML();
        $('su-doc-card').style.display = R.areas.length ? '' : 'none';
    }
    function desenharMapa() {
        const R = RESULT;
        if (!MAPA) { MAPA = L.map('su-mapa'); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(MAPA); }
        if (CAMADAS) MAPA.removeLayer(CAMADAS);
        CAMADAS = L.layerGroup().addTo(MAPA);
        // hotspots de TODOS os focos (ponto por ocorrência, tamanho pelo peso)
        R.pts.forEach(p => L.circleMarker([p.lat, p.lng], { radius: 3 + p.peso * 4, color: '#fff', weight: 1, fillColor: F[p.foco].cor, fillOpacity: .85 })
            .bindPopup(`<b>${esc(F[p.foco].nome)}</b><br>${esc(p.tip)}<br>${esc(p.bairro)} — ${esc(p.data)} ${esc(p.hora)}<br>BO ${esc(p.boletim)}<br>peso ${fmt(p.peso, 2)}`).addTo(CAMADAS));
        // rota
        if (R.areas.length > 1) L.polyline(R.areas.map(a => [a.lat, a.lng]), { color: '#b91c1c', weight: 2, dashArray: '6 6' }).addTo(CAMADAS);
        R.areas.forEach(a => {
            L.circle([a.lat, a.lng], { radius: a.raioM, color: '#b91c1c', weight: 2, fillColor: '#b91c1c', fillOpacity: .12 })
                .bindPopup(`<b>Área ${a.n}</b> — ${esc(a.bairro)}<br>Pontuação ${fmt(a.score, 2)} · ${a.total} ocorrência(s)<br>${FOCOS.filter(f => a.cont[f.id]).map(f => f.nome + ': ' + a.cont[f.id]).join(' · ')}`).addTo(CAMADAS);
            L.marker([a.lat, a.lng], { icon: L.divIcon({ className: '', html: `<div class="su-area-lbl">${a.n}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }) }).addTo(CAMADAS);
            a.entorno.forEach(p => L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: `<div class="su-pos">${esc(p.guarnicao)}</div>`, iconAnchor: [20, 8] }) }).bindTooltip(`Entorno ${p.ponto} — ${p.guarnicao}`).addTo(CAMADAS));
            if (a.saturacao.length) L.marker([a.lat - a.raioM / 111320 * 0.5, a.lng], { icon: L.divIcon({ className: '', html: `<div class="su-sat">SATURAÇÃO ×${a.saturacao.length}</div>`, iconAnchor: [34, 8] }) }).bindTooltip('Saturação no interior: ' + a.saturacao.join(', ')).addTo(CAMADAS);
        });
        const b = R.areas.length ? L.latLngBounds(R.areas.map(a => [a.lat, a.lng])) : (R.pts.length ? L.latLngBounds(R.pts.map(p => [p.lat, p.lng])) : null);
        if (b) MAPA.fitBounds(b.pad(0.25), { maxZoom: 16, animate: false }); else MAPA.setView([-9.41, -36.63], 12);
        setTimeout(() => MAPA.invalidateSize(), 150);
    }

    // ── Mapa estático (imagem) — tiles do OpenStreetMap num <canvas> ─
    // Imagem em vez de Leaflet vivo: aparece igual na tela, na impressão/PDF,
    // no Word e no documento salvo no Controle de Operações.
    const TILE = 256;
    const lng2x = (lng, z) => (lng + 180) / 360 * TILE * 2 ** z;
    const lat2y = (lat, z) => { const s = Math.sin(lat * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z; };
    const TILES = new Map();
    function carregarTile(z, x, y) {
        const n = 2 ** z, k = `${z}/${((x % n) + n) % n}/${y}`;
        if (!TILES.has(k)) TILES.set(k, new Promise(ok => {
            const im = new Image(); im.crossOrigin = 'anonymous';
            im.onload = () => ok(im); im.onerror = () => ok(null);
            im.src = `https://tile.openstreetmap.org/${k}.png`;
        }));
        return TILES.get(k);
    }
    function limitesDe(itens) { // itens: [{lat,lng,raioM?}]
        let a = 90, b = -90, c = 180, d = -180;
        itens.forEach(p => { const r = (p.raioM || 0) / 111320; a = Math.min(a, p.lat - r); b = Math.max(b, p.lat + r); c = Math.min(c, p.lng - r); d = Math.max(d, p.lng + r); });
        return { minLat: a, maxLat: b, minLng: c, maxLng: d };
    }
    async function mapaEstatico(w, h, lim, desenhar, zMax = 17) {
        const S = 1.5; // densidade (nitidez na impressão)
        let z = zMax;
        for (; z > 5; z--) {
            const dx = lng2x(lim.maxLng, z) - lng2x(lim.minLng, z), dy = lat2y(lim.minLat, z) - lat2y(lim.maxLat, z);
            if (dx <= w * 0.84 && dy <= h * 0.84) break;
        }
        const cx = (lng2x(lim.minLng, z) + lng2x(lim.maxLng, z)) / 2, cy = (lat2y(lim.minLat, z) + lat2y(lim.maxLat, z)) / 2;
        const ox = cx - w / 2, oy = cy - h / 2;
        const cv = document.createElement('canvas'); cv.width = w * S; cv.height = h * S;
        const ctx = cv.getContext('2d'); ctx.scale(S, S);
        ctx.fillStyle = '#e9edf1'; ctx.fillRect(0, 0, w, h);
        const tiles = [];
        for (let tx = Math.floor(ox / TILE); tx <= Math.floor((ox + w) / TILE); tx++)
            for (let ty = Math.floor(oy / TILE); ty <= Math.floor((oy + h) / TILE); ty++)
                tiles.push(carregarTile(z, tx, ty).then(im => { if (im) ctx.drawImage(im, tx * TILE - ox, ty * TILE - oy, TILE, TILE); }));
        await Promise.all(tiles);
        ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(0, 0, w, h); // suaviza o fundo p/ destacar os dados
        const proj = (lat, lng) => [lng2x(lng, z) - ox, lat2y(lat, z) - oy];
        const mpp = lat => 156543.03392 * Math.cos(lat * Math.PI / 180) / 2 ** z; // metros por pixel
        desenhar(ctx, proj, mpp);
        ctx.font = '9px Arial'; ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(w - 112, h - 13, 112, 13);
        ctx.fillStyle = '#333'; ctx.fillText('© OpenStreetMap', w - 106, h - 3);
        try { return cv.toDataURL('image/jpeg', 0.86); } catch (e) { console.warn('[sufocamento] mapa', e); return ''; }
    }
    const rotulo = (ctx, x, y, txt, fundo, cor, borda) => {
        ctx.font = 'bold 10px Arial';
        const w = ctx.measureText(txt).width + 8;
        ctx.fillStyle = fundo; ctx.strokeStyle = borda || '#fff'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.rect(x - w / 2, y - 7, w, 14); ctx.fill(); ctx.stroke();
        ctx.fillStyle = cor; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, x, y + 0.5);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    };
    const numeroArea = (ctx, x, y, n, r = 11) => {
        ctx.fillStyle = '#b91c1c'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = `bold ${r + 1}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(n), x, y + 0.5);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    };
    const pontoOc = (ctx, x, y, p, esc = 1) => {
        ctx.fillStyle = F[p.foco].cor; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, (2.5 + p.peso * 2.5) * esc, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    };
    async function gerarMapas(R) {
        // Mapa geral: todas as ocorrências + áreas numeradas + rota
        const refs = R.areas.length ? R.areas : R.pts;
        const lim = refs.length ? limitesDe(refs) : { minLat: -9.45, maxLat: -9.37, minLng: -36.68, maxLng: -36.58 };
        R.mapaGeral = await mapaEstatico(1000, 600, lim, (ctx, proj, mpp) => {
            R.pts.forEach(p => { const [x, y] = proj(p.lat, p.lng); pontoOc(ctx, x, y, p); });
            if (R.areas.length > 1) {
                ctx.setLineDash([7, 6]); ctx.strokeStyle = '#b91c1c'; ctx.lineWidth = 2.2; ctx.beginPath();
                R.areas.forEach((a, i) => { const [x, y] = proj(a.lat, a.lng); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); ctx.setLineDash([]);
            }
            R.areas.forEach(a => {
                const [x, y] = proj(a.lat, a.lng), r = a.raioM / mpp(a.lat);
                ctx.fillStyle = 'rgba(185,28,28,.15)'; ctx.strokeStyle = '#b91c1c'; ctx.lineWidth = 2.2;
                ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
                numeroArea(ctx, x, y, a.n, 12);
            });
        }, 16);
        // Um recorte por área: perímetro, pontos de bloqueio das RPs e saturação
        R.mapasArea = [];
        for (const a of R.areas) {
            const perto = R.pts.filter(p => distM(a, p) <= a.raioM * 1.8);
            R.mapasArea.push(await mapaEstatico(480, 300, limitesDe([{ lat: a.lat, lng: a.lng, raioM: a.raioM * 1.45 }]), (ctx, proj, mpp) => {
                perto.forEach(p => { const [x, y] = proj(p.lat, p.lng); pontoOc(ctx, x, y, p, 1.2); });
                const [x, y] = proj(a.lat, a.lng), r = a.raioM / mpp(a.lat);
                ctx.fillStyle = 'rgba(185,28,28,.14)'; ctx.strokeStyle = '#b91c1c'; ctx.lineWidth = 2.5;
                ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
                if (a.saturacao.length) rotulo(ctx, x, y + 22, `SATURAÇÃO — ${a.saturacao.length} guarnição(ões)`, '#111', '#ffd54f', '#ffd54f');
                a.entorno.forEach(p => { const [px, py] = proj(p.lat, p.lng); rotulo(ctx, px, py, `${p.guarnicao} (${p.ponto})`, '#1d4ed8', '#fff'); });
                numeroArea(ctx, x, y - 4, a.n, 13);
            }, 18));
        }
    }

    // ── Documento da OPO — MESMO modelo da OPO Inteligente, adaptado ─
    const DOC_CSS = `
        .folha-a4{background:#fff;width:210mm;max-width:100%;min-height:297mm;padding:18mm 20mm;margin:0 auto;box-shadow:0 4px 24px rgba(0,0,0,.4);font-family:'Times New Roman',serif;font-size:12pt;color:#000;line-height:1.35;position:relative;box-sizing:border-box}
        .opo-cabecalho{text-align:center;margin-bottom:14px;border-bottom:2px solid #000;padding-bottom:10px}
        .opo-cabecalho .orgao{font-size:10pt;font-weight:bold;letter-spacing:.05em;text-transform:uppercase}
        .opo-cabecalho .titulo-opo{font-size:14pt;font-weight:bold;text-transform:uppercase;margin:4px 0}
        .opo-cabecalho .subtitulo{font-size:11pt}
        .opo-selo{background:#b91c1c;color:#fff;font:700 10px Arial;letter-spacing:.12em;text-transform:uppercase;padding:4px 12px;border-radius:3px;display:inline-block;margin:4px 0}
        .opo-protocolo{font-weight:bold;font-size:10pt;margin-bottom:10px}
        .tab-info{width:100%;border-collapse:collapse;margin-bottom:12px;font-size:11pt}
        .tab-info td{border:1px solid #000;padding:4px 7px}
        .tab-info td:first-child{font-weight:bold;width:35%;background:#f0f0f0}
        .tab-info .titulo-tab{text-align:center;font-weight:bold;background:#d0d0d0!important;font-size:11pt;text-transform:uppercase;letter-spacing:.05em}
        .opo-secao{font-weight:bold;text-decoration:underline;text-transform:uppercase;font-size:11pt;margin:12px 0 5px 0}
        .opo-texto{text-align:justify;margin:4px 0;font-size:11pt}
        .tab-efetivo,.tab-hotspot{width:100%;border-collapse:collapse;font-size:10pt;margin-top:6px}
        .tab-efetivo th,.tab-hotspot th{background:#e0e0e0;border:1px solid #000;padding:4px 6px;text-align:center;font-size:10pt}
        .tab-efetivo td,.tab-hotspot td{border:1px solid #000;padding:3px 6px;vertical-align:top}
        .tab-efetivo tfoot td{background:#e0e0e0;font-weight:bold}
        .c{text-align:center}
        .opo-mapa-secao{margin:10px 0}
        .opo-mapa-legenda{font-size:8pt;color:#555;display:flex;gap:14px;flex-wrap:wrap;margin-bottom:6px}
        .opo-leg-item{display:flex;align-items:center;gap:4px}
        .opo-leg-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
        .opo-mapa-img{width:100%;border:1.5px solid #999;border-radius:4px;display:block}
        .opo-areas-grade{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
        .opo-area-card{border:1px solid #ccc;border-left:4px solid #b91c1c;border-radius:3px;padding:5px 7px;background:#fafafa;break-inside:avoid;page-break-inside:avoid}
        .opo-area-card img{width:100%;border:1px solid #bbb;border-radius:3px;display:block;margin-bottom:4px}
        .opo-area-card b{font-size:10pt} .opo-area-card div{font-size:8.5pt;color:#333;line-height:1.3}
        .assinatura{margin-top:50px;text-align:center;font-size:11pt}
        .assinatura .linha{margin-bottom:4px}
        .evitar-quebra{break-inside:avoid;page-break-inside:avoid}
        *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
        @media print{.folha-a4{box-shadow:none;margin:0;width:100%;padding:0}}`;
    const brData = s => s ? s.split('-').reverse().join('/') : '';
    function nivelArea(a) { return a.score >= 8 ? 'CRÍTICO' : a.score >= 4 ? 'ALTO' : a.score >= 2 ? 'MÉDIO' : 'BAIXO'; }
    function tipoGuarnicao(g) {
        const s = NORM(g);
        return /PELOPES|TATICO URBANO/.test(s) ? 'Tático Urbano (PELOPES)' : /TATICO RURAL|RURAL/.test(s) ? 'Tático Rural' : /FORCA TAREFA|\bFT\b/.test(s) ? 'Força Tarefa' : 'RP';
    }
    function efetivo(R) {
        const opms = [
            ...R.entorno.map(g => ({ label: g, tipo: 'RP', funcao: 'Entorno — bloqueio', vtr: 1, homens: 3 })),
            ...R.saturacao.map(g => ({ label: g, tipo: tipoGuarnicao(g), funcao: 'Saturação — interior', vtr: 1, homens: 3 })),
            { label: 'OFICIAL DE SERVIÇO', tipo: 'Oficial', funcao: 'Coordenação', vtr: 0, homens: 1 },
        ];
        return { opms, vtr: opms.reduce((s, o) => s + o.vtr, 0), homens: opms.reduce((s, o) => s + o.homens, 0) };
    }
    function horariosPico(pts) {
        const faixas = {};
        pts.forEach(p => { const m = String(p.hora).match(/^(\d{1,2})/); if (!m) return; const f = Math.floor(+m[1] / 2) * 2; faixas[f] = (faixas[f] || 0) + p.peso; });
        return Object.entries(faixas).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f]) => `${String(f).padStart(2, '0')}h–${String(+f + 2).padStart(2, '0')}h`);
    }
    function textos(R) {
        const focosTxt = R.focos.map(f => F[f].nome).join(', ');
        const cont = Object.fromEntries(FOCOS.map(f => [f.id, R.pts.filter(p => p.foco === f.id).length]));
        const vig = R.dataIni === R.dataFim ? brData(R.dataIni) : `${brData(R.dataIni)} a ${brData(R.dataFim)}`;
        const nDias = Math.round((new Date(R.dataFim) - new Date(R.dataIni)) / 864e5) + 1;
        const escopoLabel = R.escopo === 'cidade' ? R.cidade : '10º BPM — Área completa';
        const niveis = { 'CRÍTICO': 4, 'ALTO': 3, 'MÉDIO': 2, 'BAIXO': 1 };
        const media = R.areas.length ? R.areas.reduce((s, a) => s + niveis[nivelArea(a)], 0) / R.areas.length : 1;
        const nivelGeral = Object.keys(niveis).find(k => niveis[k] === Math.max(1, Math.min(4, Math.round(media))));
        const contTxt = FOCOS.filter(f => R.focos.includes(f.id)).map(f => `${f.nome}: ${cont[f.id]}`).join(' | ');
        return { focosTxt, cont, vig, nDias, escopoLabel, nivelGeral, contTxt, pico: horariosPico(R.pts) };
    }
    const CMT = 'ANTÔNIO ANDRÉ ANDRADE DE OLIVEIRA BARBOSA — MAJ QOEM PM';
    function documentoHTML() {
        const R = RESULT; if (!R) return '';
        const T = textos(R), EF = efetivo(R);
        const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
        const focoCols = FOCOS.filter(f => R.focos.includes(f.id));
        return `<div class="folha-a4">
    <div class="opo-cabecalho">
      <div class="orgao">ESTADO DE ALAGOAS — POLÍCIA MILITAR DE ALAGOAS</div>
      <div class="orgao">10° BATALHÃO DE POLÍCIA MILITAR</div>
      <div class="orgao">SEÇÃO DE PLANEJAMENTO, INSTRUÇÃO E ESTATÍSTICA — P3</div>
      <div class="titulo-opo">${esc(R.nome)}</div>
      <div class="opo-selo">🔥 OPERAÇÃO SUFOCAMENTO — ENTORNO E SATURAÇÃO</div>
      <div class="subtitulo">ORDEM DE POLICIAMENTO OSTENSIVO — ${esc(T.focosTxt.toUpperCase())}</div>
    </div>
    <div class="opo-protocolo">${esc(R.protocolo)}</div>
    <p class="opo-texto">O Comandante do 10º BPM, no uso de suas atribuições legais, com base na análise inteligente das ocorrências de
    <strong>${esc(T.focosTxt)}</strong> dos últimos <strong>${R.dias} dias</strong> em <strong>${esc(T.escopoLabel)}</strong>, determina a execução da
    seguinte Ordem de Policiamento Ostensivo na modalidade <strong>SUFOCAMENTO</strong>, com vigência de <strong>${T.vig}</strong>, no horário de
    <strong>${esc(R.hIni)}h às ${esc(R.hFim)}h</strong>${T.nDias > 1 ? ' (diariamente)' : ''}:</p>
    <table class="tab-info">
      <tr><td colspan="2" class="titulo-tab">IDENTIFICAÇÃO DA OPERAÇÃO</td></tr>
      <tr><td>Nome da Operação</td><td><strong>${esc(R.nome)}</strong></td></tr>
      <tr><td>Modalidade</td><td>Sufocamento — RPs no entorno (bloqueio) e especializadas em saturação no interior, ${R.dur} min por área</td></tr>
      <tr><td>Município / Escopo</td><td>${esc([...new Set(R.areas.map(a => a.cidade).filter(Boolean))].join(' · ') || T.escopoLabel)}</td></tr>
      <tr><td>Período de análise</td><td>Últimos ${R.dias} dias (até ${new Date().toLocaleDateString('pt-BR')})</td></tr>
      <tr><td>Vigência da OPO</td><td>${T.vig} — ${T.nDias} dia(s)</td></tr>
      <tr><td>Turno / Horário</td><td>${esc(R.hIni)}h às ${esc(R.hFim)}h${T.nDias > 1 ? ' — diariamente' : ''}</td></tr>
      <tr><td>Focos</td><td>${esc(T.focosTxt)}</td></tr>
      <tr><td>Total de ocorrências</td><td>${fmt(R.pts.length)} (${esc(T.contTxt)})</td></tr>
      <tr><td>Áreas delimitadas</td><td>${R.areas.length} área(s) de sufocamento · ${R.slots.length} período(s) de ${R.dur} min por dia</td></tr>
      <tr><td>Nível de risco geral</td><td><strong>${T.nivelGeral}</strong></td></tr>
      <tr><td>Data de emissão</td><td>${hoje}</td></tr>
    </table>

    <div class="opo-secao">EFETIVO E MEIOS — EFETIVO EMPENHADO</div>
    <p class="opo-texto">Com base na análise da mancha criminal, o seguinte efetivo será empenhado nesta operação:</p>
    <table class="tab-efetivo">
      <thead><tr><th style="width:36%">OPM / RECURSO</th><th style="width:22%">Tipo</th><th style="width:22%">Emprego</th><th style="width:10%">VTR</th><th style="width:10%">Homens</th></tr></thead>
      <tbody>${EF.opms.map(o => `<tr style="${o.tipo === 'RP' ? '' : o.tipo === 'Oficial' ? 'background:#fff8e1;' : o.tipo === 'Tático Rural' ? 'background:#f3e5f5;' : o.tipo === 'Força Tarefa' ? 'background:#e8f5e9;' : 'background:#e3f2fd;'}">
        <td><strong>${esc(o.label)}</strong></td><td class="c">${o.tipo}</td><td class="c">${o.funcao}</td><td class="c">${o.vtr || '—'}</td><td class="c"><b>${o.homens}</b></td></tr>`).join('')}</tbody>
      <tfoot><tr><td>TOTAL EMPENHADO</td><td></td><td></td><td class="c">${EF.vtr}</td><td class="c">${EF.homens}</td></tr></tfoot>
    </table>

    <div class="opo-secao" style="margin-top:14px;">ALOCAÇÃO POR ÁREA — ENTORNO E SATURAÇÃO</div>
    <p class="opo-texto">Em cada área, as RPs ocupam os pontos de bloqueio do perímetro e as especializadas saturam o interior:</p>
    <table class="tab-efetivo">
      <thead><tr><th style="width:6%">Nº</th><th style="width:26%">Área</th><th style="width:34%">Entorno — bloqueio (ponto)</th><th style="width:34%">Saturação — interior</th></tr></thead>
      <tbody>${R.areas.map(a => `<tr><td class="c"><b>${a.n}</b></td><td><strong>${esc(a.bairro || '—')}</strong><br><small>${esc(a.cidade)}</small></td>
        <td>${a.entorno.map(p => `${esc(p.guarnicao)} (${p.ponto})`).join('<br>') || '—'}</td><td>${a.saturacao.map(esc).join('<br>') || '—'}</td></tr>`).join('')}</tbody>
    </table>

    <div class="opo-secao">1. ANÁLISE SITUACIONAL</div>
    <p class="opo-texto">A análise dos registros georreferenciados dos últimos <strong>${R.dias} dias</strong> em <strong>${esc(T.escopoLabel)}</strong> identificou
    <strong>${fmt(R.pts.length)} ocorrência(s)</strong> dos focos da operação (${esc(T.contTxt)}). As ocorrências foram ponderadas por gravidade
    (MVI 1,00; arma 0,85; droga 0,75; CVP 0,55; CCP 0,30) e recência, e agrupadas em raio de <strong>${R.raio} m</strong>, resultando em
    <strong>${R.todas} agrupamento(s)</strong>, dos quais as <strong>${R.areas.length} área(s)</strong> de maior pontuação foram delimitadas para o sufocamento.
    O nível de risco geral foi classificado como <strong>${T.nivelGeral}</strong>.</p>
    ${T.pico.length ? `<p class="opo-texto">Os horários de maior concentração identificados são: <strong>${T.pico.join('; ')}</strong>.</p>` : ''}

    <div class="opo-secao">2. ÁREAS DE SUFOCAMENTO E TEMPO DE PERMANÊNCIA</div>
    <p class="opo-texto">As guarnições permanecerão <strong>${R.dur} minutos</strong> em cada área, na ordem abaixo (maior pontuação primeiro e, depois, a área mais próxima):</p>
    <table class="tab-hotspot">
      <thead><tr><th>#</th><th>Local / Área</th>${focoCols.map(f => `<th>${f.nome}</th>`).join('')}<th>Total</th><th>Nível</th><th>Permanência</th></tr></thead>
      <tbody>${R.areas.map(a => `<tr><td class="c">${a.n}</td><td>${esc(a.bairro || '—')} — ${esc(a.cidade)}<br><small>raio ${a.raioM} m · ${a.lat.toFixed(5)}, ${a.lng.toFixed(5)}</small></td>
        ${focoCols.map(f => `<td class="c">${a.cont[f.id] || 0}</td>`).join('')}<td class="c"><b>${a.total}</b></td><td class="c">${nivelArea(a)}</td><td class="c">${R.dur} min</td></tr>`).join('')}</tbody>
    </table>

    <div class="opo-secao">2.1 MANCHA CRIMINAL — VISUALIZAÇÃO GEOESPACIAL</div>
    <div class="opo-mapa-secao">
      <div class="opo-mapa-legenda">${FOCOS.filter(f => R.focos.includes(f.id)).map(f => `<div class="opo-leg-item"><div class="opo-leg-dot" style="background:${f.cor}"></div> ${f.nome}</div>`).join('')}
        <div class="opo-leg-item"><div class="opo-leg-dot" style="background:rgba(185,28,28,.25);border:1.5px solid #b91c1c"></div> Área de sufocamento (nº = ordem)</div>
        <div class="opo-leg-item"><div class="opo-leg-dot" style="background:#1d4ed8;border-radius:2px"></div> RP no entorno</div>
        <div class="opo-leg-item"><div class="opo-leg-dot" style="background:#111;border-radius:2px"></div> Saturação</div></div>
      ${R.mapaGeral ? `<img class="opo-mapa-img" src="${R.mapaGeral}" alt="Mapa geral das áreas de sufocamento">` : '<p class="opo-texto"><i>Mapa indisponível (sem acesso aos mapas no momento da geração).</i></p>'}
      <div class="opo-areas-grade">${R.areas.map((a, i) => `<div class="opo-area-card">
        ${R.mapasArea && R.mapasArea[i] ? `<img src="${R.mapasArea[i]}" alt="Área ${a.n}">` : ''}
        <b>ÁREA ${a.n} — ${esc(a.bairro || '—')}</b>
        <div>${FOCOS.filter(f => a.cont[f.id]).map(f => `${f.nome}: <b>${a.cont[f.id]}</b>`).join(' · ')} · <b>${nivelArea(a)}</b></div>
        <div>Entorno: ${a.entorno.map(p => `${esc(p.guarnicao)} (${p.ponto})`).join(', ') || '—'}</div>
        <div>Saturação: ${esc(a.saturacao.join(', ') || '—')}</div></div>`).join('')}</div>
    </div>

    <div class="opo-secao evitar-quebra">2.2 CRONOGRAMA DE EXECUÇÃO</div>
    <p class="opo-texto">Cronograma a ser cumprido ${T.nDias > 1 ? `diariamente, de ${T.vig}` : `em ${T.vig}`}. Encerrado o tempo em uma área, todas as guarnições deslocam-se juntas para a seguinte:</p>
    <table class="tab-hotspot">
      <thead><tr><th>#</th><th>Horário</th><th>Área</th><th>Ciclo</th><th>Deslocamento</th></tr></thead>
      <tbody>${R.slots.map(s => { const a = R.areas.find(x => x.n === s.area) || {}; return `<tr><td class="c">${s.ordem}</td><td class="c"><b>${s.ini} – ${s.fim}</b></td><td>${s.area} — ${esc(a.bairro || '')}</td><td class="c">${s.ciclo}º</td><td class="c">${s.distanciaKm ? `${fmt(s.distanciaKm, 1)} km (~${s.deslocamentoMin} min)` : 'início'}</td></tr>`; }).join('')}</tbody>
    </table>

    <div class="opo-secao">3. ORIENTAÇÕES OPERACIONAIS</div>
    <p class="opo-texto">a) O policiamento se destina ao cumprimento do artigo 144 da Constituição Federal c/c com o art. 5º, incisos X e XI, da Lei 14.751/2023, com foco no sufocamento das ações do crime organizado ligadas a ${esc(T.focosTxt)}.</p>
    <p class="opo-texto">b) <strong>Entorno (bloqueio):</strong> as RPs posicionam-se nos pontos cardeais do perímetro de cada área (N, L, S, O…), realizando abordagens a pessoas e veículos que entram ou saem da área e impedindo a evasão de suspeitos.</p>
    <p class="opo-texto">c) <strong>Saturação (interior):</strong> as guarnições especializadas (PELOPES/Tático Urbano e Tático Rural) percorrem o interior da área com abordagens qualificadas, varredura de pontos de venda de drogas, busca de armas e verificação de foragidos.</p>
    <p class="opo-texto">d) A permanência em cada área é de <strong>${R.dur} minutos</strong>. Encerrado o período, todas as guarnições deslocam-se juntas para a área seguinte do cronograma, mantendo a sequência até o término da operação.</p>
    <p class="opo-texto">e) Durante as abordagens, as guarnições deverão realizar consultas veiculares pelo aplicativo QUIMERA ou através do COPOM do 10º BPM. Consultas de indivíduos serão realizadas através do COPOM/CAD/BNMP-MJ.</p>
    <p class="opo-texto">f) Todo o policiamento deverá ser executado com luzes vermelhas intermitentes (rotativos) ligadas para maior visibilidade e efeito preventivo.</p>

    <div class="opo-secao">4. PRESCRIÇÕES DIVERSAS</div>
    <p class="opo-texto">a) As guarnições escaladas deverão se apresentar ao COPOM no início da operação, informando dados dos HTs digitais móveis e da viatura, e comunicar a chegada e a saída de cada área.</p>
    <p class="opo-texto">b) Todas as ocorrências e apreensões deverão ser imediatamente comunicadas ao COPOM para geração dos Boletins de Ocorrência.</p>
    <p class="opo-texto">c) Em caso de flagrante, adotar as medidas pertinentes à apresentação do infrator na delegacia plantonista; a área seguinte não fica descoberta — as demais guarnições prosseguem no cronograma.</p>
    <p class="opo-texto">d) Os dados desta OPO foram gerados com base em análise geoespacial ponderada dos registros do banco de dados do 10º BPM, período: últimos ${R.dias} dias.</p>

    <div class="assinatura">
      <div style="margin-bottom:60px;"></div>
      <div class="linha">____________________________________________________</div>
      <div class="linha"><strong>${CMT}</strong></div>
      <div class="linha">Comandante do 10º BPM</div>
    </div>
  </div>`;
    }
    const dataUrlBytes = u => { const b = atob(u.split(',')[1]); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; };
    async function gerarDocx() {
        const R = RESULT, T = textos(R), EF = efetivo(R);
        const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, ShadingType, VerticalAlign, ImageRun } = window.docx;
        const T24 = { font: 'Times New Roman', size: 24 }, T20 = { font: 'Times New Roman', size: 20 };
        const borda = { style: BorderStyle.SINGLE, size: 1, color: '000000' }, bordas = { top: borda, bottom: borda, left: borda, right: borda };
        const LT = 9638;
        const cel = (txt, o = {}) => new TableCell({ borders: bordas, margins: { top: 50, bottom: 50, left: 100, right: 100 }, width: { size: o.w || Math.floor(LT / 2), type: WidthType.DXA },
            shading: o.sh ? { fill: o.sh, type: ShadingType.CLEAR } : undefined, columnSpan: o.span || 1, verticalAlign: VerticalAlign.CENTER,
            children: String(txt ?? '—').split('\n').map(l => new Paragraph({ alignment: o.al || AlignmentType.LEFT, children: [new TextRun({ text: l, bold: !!o.bold, ...(o.peq ? T20 : T24) })] })) });
        const lin = cols => new TableRow({ children: cols });
        const sec = t => new Paragraph({ spacing: { before: 240, after: 100 }, children: [new TextRun({ text: t, bold: true, underline: {}, allCaps: true, ...T24 })] });
        const par = t => new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { before: 60, after: 60 }, children: [new TextRun({ text: t, ...T24 })] });
        const centr = (t, b = true) => new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: t, bold: b, ...T24 })] });
        const espaco = () => new Paragraph({ children: [new TextRun({ text: '', ...T20 })] });
        const tabela = (cab, larg, linhas) => {
            const w = larg.map(p => Math.floor(LT * p));
            return new Table({ width: { size: LT, type: WidthType.DXA }, columnWidths: w, rows: [
                lin(cab.map((c, i) => cel(c, { bold: true, al: AlignmentType.CENTER, sh: 'e0e0e0', w: w[i], peq: true }))),
                ...linhas.map(l => lin(l.map((c, i) => cel(c, { w: w[i], peq: true, al: i === 0 ? AlignmentType.CENTER : AlignmentType.LEFT })))),
            ] });
        };
        const img = (u, w, h) => u ? new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: dataUrlBytes(u), transformation: { width: w, height: h } })] }) : par('Mapa indisponível.');
        const c1 = Math.floor(LT * 0.38), c2 = LT - c1;
        const id = (k, v) => lin([cel(k, { bold: true, sh: 'f0f0f0', w: c1 }), cel(v, { w: c2 })]);
        const focoCols = FOCOS.filter(f => R.focos.includes(f.id));
        const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
        // cartões das áreas: 2 por linha, mapa + resumo
        const cartoes = [];
        for (let i = 0; i < R.areas.length; i += 2) {
            const cels = [R.areas[i], R.areas[i + 1]].map((a, k) => a ? new TableCell({ borders: bordas, width: { size: Math.floor(LT / 2), type: WidthType.DXA }, margins: { top: 60, bottom: 60, left: 80, right: 80 }, children: [
                ...(R.mapasArea && R.mapasArea[i + k] ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: dataUrlBytes(R.mapasArea[i + k]), transformation: { width: 290, height: 181 } })] })] : []),
                new Paragraph({ children: [new TextRun({ text: `ÁREA ${a.n} — ${a.bairro || '—'}`, bold: true, ...T20 })] }),
                new Paragraph({ children: [new TextRun({ text: FOCOS.filter(f => a.cont[f.id]).map(f => `${f.nome}: ${a.cont[f.id]}`).join(' · ') + ` · ${nivelArea(a)}`, ...T20, size: 18 })] }),
                new Paragraph({ children: [new TextRun({ text: 'Entorno: ' + (a.entorno.map(p => `${p.guarnicao} (${p.ponto})`).join(', ') || '—'), ...T20, size: 18 })] }),
                new Paragraph({ children: [new TextRun({ text: 'Saturação: ' + (a.saturacao.join(', ') || '—'), ...T20, size: 18 })] }),
            ] }) : new TableCell({ borders: bordas, width: { size: Math.floor(LT / 2), type: WidthType.DXA }, children: [new Paragraph('')] }));
            cartoes.push(lin(cels));
        }
        const children = [
            centr('POLÍCIA MILITAR DE ALAGOAS'), centr('10° BATALHÃO DE POLÍCIA MILITAR'), centr('SEÇÃO DE PLANEJAMENTO, INSTRUÇÃO E ESTATÍSTICA — P3'), espaco(),
            centr('ORDEM DE POLICIAMENTO OSTENSIVO — OPERAÇÃO SUFOCAMENTO'), centr(`ENTORNO E SATURAÇÃO — ${T.focosTxt.toUpperCase()}`), centr(R.nome), espaco(),
            new Paragraph({ children: [new TextRun({ text: R.protocolo, bold: true, ...T24 })] }), espaco(),
            par(`O Comandante do 10º BPM, no uso de suas atribuições legais, com base na análise inteligente das ocorrências de ${T.focosTxt} dos últimos ${R.dias} dias em ${T.escopoLabel}, determina a execução da seguinte Ordem de Policiamento Ostensivo na modalidade SUFOCAMENTO, com vigência de ${T.vig}, no horário de ${R.hIni}h às ${R.hFim}h${T.nDias > 1 ? ' (diariamente)' : ''}:`),
            new Table({ width: { size: LT, type: WidthType.DXA }, columnWidths: [c1, c2], rows: [
                lin([cel('IDENTIFICAÇÃO DA OPERAÇÃO', { span: 2, bold: true, al: AlignmentType.CENTER, sh: 'd0d0d0', w: LT })]),
                id('Nome da Operação', R.nome), id('Modalidade', `Sufocamento — RPs no entorno e especializadas em saturação, ${R.dur} min por área`),
                id('Município / Escopo', [...new Set(R.areas.map(a => a.cidade).filter(Boolean))].join(' · ') || T.escopoLabel),
                id('Período de análise', `Últimos ${R.dias} dias (até ${new Date().toLocaleDateString('pt-BR')})`), id('Vigência da OPO', `${T.vig} — ${T.nDias} dia(s)`),
                id('Turno / Horário', `${R.hIni}h às ${R.hFim}h${T.nDias > 1 ? ' — diariamente' : ''}`), id('Focos', T.focosTxt),
                id('Total de ocorrências', `${R.pts.length} (${T.contTxt})`), id('Áreas delimitadas', `${R.areas.length} área(s) · ${R.slots.length} período(s) de ${R.dur} min por dia`),
                id('Nível de risco geral', T.nivelGeral), id('Data de emissão', hoje),
            ] }), espaco(),
            sec('EFETIVO E MEIOS — EFETIVO EMPENHADO'),
            par('Com base na análise da mancha criminal, o seguinte efetivo será empenhado nesta operação:'),
            tabela(['OPM / RECURSO', 'Tipo', 'Emprego', 'VTR', 'Homens'], [0.34, 0.22, 0.24, 0.1, 0.1], [...EF.opms.map(o => [o.label, o.tipo, o.funcao, o.vtr || '—', o.homens]), ['TOTAL EMPENHADO', '', '', EF.vtr, EF.homens]]),
            sec('ALOCAÇÃO POR ÁREA — ENTORNO E SATURAÇÃO'),
            tabela(['Nº', 'Área', 'Entorno — bloqueio (ponto)', 'Saturação — interior'], [0.07, 0.27, 0.33, 0.33], R.areas.map(a => [a.n, `${a.bairro || '—'}\n${a.cidade}`, a.entorno.map(p => `${p.guarnicao} (${p.ponto})`).join('\n') || '—', a.saturacao.join('\n') || '—'])),
            sec('1. ANÁLISE SITUACIONAL'),
            par(`A análise dos registros georreferenciados dos últimos ${R.dias} dias em ${T.escopoLabel} identificou ${R.pts.length} ocorrência(s) dos focos da operação (${T.contTxt}). As ocorrências foram ponderadas por gravidade (MVI 1,00; arma 0,85; droga 0,75; CVP 0,55; CCP 0,30) e recência, e agrupadas em raio de ${R.raio} m, resultando em ${R.todas} agrupamento(s), dos quais as ${R.areas.length} área(s) de maior pontuação foram delimitadas para o sufocamento. Nível de risco geral: ${T.nivelGeral}.`),
            ...(T.pico.length ? [par(`Horários de maior concentração: ${T.pico.join('; ')}.`)] : []),
            sec('2. ÁREAS DE SUFOCAMENTO E TEMPO DE PERMANÊNCIA'),
            par(`As guarnições permanecerão ${R.dur} minutos em cada área, na ordem abaixo:`),
            tabela(['#', 'Local / Área', ...focoCols.map(f => f.nome), 'Total', 'Nível', 'Perman.'], [0.05, 0.31, ...focoCols.map(() => 0.34 / focoCols.length), 0.08, 0.11, 0.11],
                R.areas.map(a => [a.n, `${a.bairro || '—'} — ${a.cidade}\nraio ${a.raioM} m · ${a.lat.toFixed(5)}, ${a.lng.toFixed(5)}`, ...focoCols.map(f => a.cont[f.id] || 0), a.total, nivelArea(a), `${R.dur} min`])),
            sec('2.1 MANCHA CRIMINAL — VISUALIZAÇÃO GEOESPACIAL'),
            img(R.mapaGeral, 600, 360),
            par('Legenda: ' + FOCOS.filter(f => R.focos.includes(f.id)).map(f => f.nome).join(', ') + ' (pontos coloridos) · círculo vermelho numerado = área de sufocamento (nº = ordem) · azul = RP no entorno · preto/amarelo = saturação.'),
            ...(cartoes.length ? [new Table({ width: { size: LT, type: WidthType.DXA }, columnWidths: [Math.floor(LT / 2), Math.floor(LT / 2)], rows: cartoes })] : []),
            sec('2.2 CRONOGRAMA DE EXECUÇÃO'),
            par(`Cronograma a ser cumprido ${T.nDias > 1 ? `diariamente, de ${T.vig}` : `em ${T.vig}`}. Encerrado o tempo em uma área, todas as guarnições deslocam-se juntas para a seguinte:`),
            tabela(['#', 'Horário', 'Área', 'Ciclo', 'Deslocamento'], [0.07, 0.2, 0.38, 0.1, 0.25], R.slots.map(s => { const a = R.areas.find(x => x.n === s.area) || {}; return [s.ordem, `${s.ini} – ${s.fim}`, `${s.area} — ${a.bairro || ''}`, `${s.ciclo}º`, s.distanciaKm ? `${s.distanciaKm} km (~${s.deslocamentoMin} min)` : 'início']; })),
            sec('3. ORIENTAÇÕES OPERACIONAIS'),
            par(`a) O policiamento se destina ao cumprimento do artigo 144 da Constituição Federal c/c com o art. 5º, incisos X e XI, da Lei 14.751/2023, com foco no sufocamento das ações do crime organizado ligadas a ${T.focosTxt}.`),
            par('b) Entorno (bloqueio): as RPs posicionam-se nos pontos cardeais do perímetro de cada área (N, L, S, O…), abordando pessoas e veículos que entram ou saem e impedindo a evasão de suspeitos.'),
            par('c) Saturação (interior): as guarnições especializadas (PELOPES/Tático Urbano e Tático Rural) percorrem o interior da área com abordagens qualificadas, varredura de pontos de venda de drogas, busca de armas e verificação de foragidos.'),
            par(`d) A permanência em cada área é de ${R.dur} minutos. Encerrado o período, todas as guarnições deslocam-se juntas para a área seguinte do cronograma, até o término da operação.`),
            par('e) Consultas veiculares pelo QUIMERA ou COPOM/10º BPM. Consulta de indivíduos via COPOM/CAD/BNMP-MJ.'),
            par('f) Luzes vermelhas intermitentes (rotativos) ligadas em todo o policiamento.'),
            sec('4. PRESCRIÇÕES DIVERSAS'),
            par('a) Apresentação ao COPOM no início da operação com dados dos HTs e viatura; comunicar a chegada e a saída de cada área.'),
            par('b) Toda ocorrência e apreensão deve ser comunicada imediatamente ao COPOM para geração do BO.'),
            par('c) Em caso de flagrante, adotar as medidas cabíveis na delegacia plantonista; as demais guarnições prosseguem no cronograma.'),
            par(`d) Dados gerados com base em análise geoespacial ponderada dos registros do banco de dados do 10º BPM. Período: últimos ${R.dias} dias.`),
            new Paragraph({ spacing: { before: 1600 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: '____________________________________________________', ...T24 })] }),
            centr(CMT), centr('Comandante do 10º BPM', false),
        ];
        const doc = new Document({ styles: { default: { document: { run: { font: 'Times New Roman', size: 24 } } } },
            sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } }, children }] });
        const blob = await Packer.toBlob(doc);
        return { blob, nome: `OPO_SUFOCAMENTO_${NORM(R.cidade || 'AREA').replace(/[^A-Z0-9]+/g, '_')}_${R.dataIni}${R.dataFim !== R.dataIni ? '_a_' + R.dataFim : ''}.docx` };
    }
    async function baixarWord() {
        const b = $('su-word'), t = b.textContent; b.disabled = true; b.textContent = '⏳ Gerando Word…';
        try { const r = await gerarDocx(); saveAs(r.blob, r.nome); } catch (e) { alert('Erro ao gerar o Word: ' + e.message); }
        b.disabled = false; b.textContent = t;
    }
    function imprimir() { window.print(); }
    function htmlCompleto() {
        const R = RESULT;
        return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><title>${esc(R.nome)}</title><style>html,body{background:#fff;margin:0}body{padding:12px}${DOC_CSS}</style></head><body>${documentoHTML()}</body></html>`;
    }

    async function salvar() {
        const R = RESULT; if (!R) return;
        if (!R.dataIni) { alert('Informe o período (de / até) da operação.'); return; }
        const btn = $('su-salvar'); btn.disabled = true; btn.textContent = '⏳ Salvando…';
        try {
            const sess = window.P3 && P3.getSession ? P3.getSession() : null;
            const T = textos(R);
            const registro = {
                tipo: 'opo', modalidade: 'sufocamento', nome: R.nome, criadoEm: new Date().toISOString(), data: new Date().toLocaleDateString('pt-BR'),
                criadoPor: sess ? [sess.graduacao, sess.nomeGuerra].filter(Boolean).join(' ') : null,
                escopo: R.escopo, cidade: R.escopo === 'cidade' ? R.cidade : 'ÁREA DA UNIDADE', cidades: R.escopo === 'cidade' ? [R.cidade] : [...new Set(R.areas.map(a => a.cidade).filter(Boolean))],
                periodoDias: R.dias, raioM: R.raio, tiposCombate: R.focos, vigenciaTexto: T.vig, protocolo: R.protocolo,
                execucao: { dataIni: R.dataIni, dataFim: R.dataFim, horaIni: R.hIni, horaFim: R.hFim },
                bairros: [...new Set(R.areas.map(a => a.bairro).filter(Boolean))], locais: R.areas.map(a => `${a.bairro || ''} — ${a.cidade || ''}`),
                areas: R.areas.map(a => ({ n: a.n, lat: +a.lat.toFixed(6), lng: +a.lng.toFixed(6), raioM: a.raioM, score: a.score, nivel: nivelArea(a), total: a.total, bairro: a.bairro, cidade: a.cidade, cont: a.cont, entorno: a.entorno.map(p => ({ guarnicao: p.guarnicao, ponto: p.ponto })), saturacao: a.saturacao })),
                cronograma: R.slots, guarnicoes: { entorno: R.entorno, saturacao: R.saturacao }, duracaoAreaMin: R.dur, totalOcorrencias: R.pts.length, temDocumento: false,
            };
            const r = await fetch(`${DB}/cartoes_programa.json`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(registro) });
            if (!r.ok) throw new Error('Firebase respondeu HTTP ' + r.status);
            const id = (await r.json()).name;
            btn.textContent = '⏳ Salvando documento…';
            const dx = await gerarDocx();
            const b64 = await new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.readAsDataURL(dx.blob); });
            const r2 = await fetch(`${DB}/opo_documentos/${id}.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nome: R.nome, modelo: 'sufocamento', html: htmlCompleto(), mapa: R.mapaGeral || null, docxBase64: b64, docxNome: dx.nome, criadoEm: new Date().toISOString() }) });
            if (r2.ok) await fetch(`${DB}/cartoes_programa/${id}/temDocumento.json`, { method: 'PUT', body: 'true' });
            btn.textContent = '✅ Salva';
            if (confirm('Operação Sufocamento salva. Abrir no Controle de Operações?')) location.href = 'controle-operacoes.html?dia=' + R.dataIni;
        } catch (e) { alert('Não foi possível salvar: ' + e.message); btn.textContent = '💾 Salvar OPO'; }
        btn.disabled = false;
    }

    // ── Inicialização ───────────────────────────────────────────────
    async function iniciar() {
        CFG = await P3.loadUnidadeConfig();
        DB = CFG.firebase.databaseURL;
        $('su-focos').innerHTML = FOCOS.map(f => `<label title="peso ${String(f.peso).replace('.', ',')}"><input type="checkbox" value="${f.id}" checked> ${f.nome}</label>`).join('');
        const st = document.createElement('style'); st.textContent = DOC_CSS; document.head.appendChild(st);
        const q = new URLSearchParams(location.search);
        $('su-data-ini').value = q.get('dataIni') || q.get('data') || iso(new Date());
        $('su-data-fim').value = q.get('dataFim') || $('su-data-ini').value;
        $('su-data-ini').addEventListener('change', () => { if (!$('su-data-fim').value || $('su-data-fim').value < $('su-data-ini').value) $('su-data-fim').value = $('su-data-ini').value; });
        // Cidades da base + guarnições da escala (só nomes de guarnição)
        const [geral, esc0, rpMap] = await Promise.all([no('geral'),
            fetch(`${DB}/escala_servico.json`).then(r => r.ok ? r.json() : null).catch(() => null),
            fetch(`${DB}/rp_viatura_map.json`).then(r => r.ok ? r.json() : null).catch(() => null)]);
        const cid = new Map(); geral.forEach(o => { const c = val(o.CIDADE); if (c && !cid.has(NORM(c))) cid.set(NORM(c), c.toUpperCase()); });
        CIDADES = [...cid.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
        $('su-cidade').innerHTML = '<option value="">— Selecione —</option>' + CIDADES.map(c => `<option>${esc(c)}</option>`).join('');
        const meses = Object.keys(esc0 || {}).sort();
        GUARN = meses.length ? (esc0[meses[meses.length - 1]].guarnicoes || []).map(g => g.sigla) : [];
        if (!GUARN.length) GUARN = ['PELOPES 01', 'TÁTICO RURAL 01', 'TÁTICO RURAL 02', 'RP 01', 'RP 02', 'RP 03', 'RP 04', 'RP 05', 'RP 06', 'RP 07', 'RP 08', 'RP 09'];
        const rpsDaCidade = c => { const k = NORM(c); return Object.entries(rpMap || {}).filter(([nome]) => NORM(nome.replace(/\(.*\)/, '')) === k).map(([, rp]) => rp.replace(/^RP\s*0?(\d)$/, 'RP 0$1')); };
        const montarGuarnicoes = () => {
            const rpsCid = $('su-escopo').value === 'cidade' ? rpsDaCidade($('su-cidade').value) : GUARN.filter(g => !ESPECIALIZADAS.test(g));
            const rps = GUARN.filter(g => !ESPECIALIZADAS.test(g)), esp = GUARN.filter(g => ESPECIALIZADAS.test(g));
            $('su-entorno').innerHTML = rps.map(g => `<label><input type="checkbox" value="${esc(g)}" ${rpsCid.some(r => NORM(r) === NORM(g)) ? 'checked' : ''}> ${esc(g)}</label>`).join('');
            $('su-saturacao').innerHTML = esp.map(g => `<label><input type="checkbox" value="${esc(g)}" checked> ${esc(g)}</label>`).join('');
        };
        montarGuarnicoes();
        $('su-escopo').onchange = () => { $('su-bloco-cidade').style.display = $('su-escopo').value === 'cidade' ? '' : 'none'; montarGuarnicoes(); };
        $('su-cidade').onchange = () => { montarGuarnicoes(); if (!val($('su-nome').value) || /^OPERAÇÃO SUFOCAMENTO/.test($('su-nome').value)) $('su-nome').value = `OPERAÇÃO SUFOCAMENTO — ${$('su-cidade').value}`; };
        if (q.get('cidade')) { const alvo = NORM(q.get('cidade')); const c = CIDADES.find(x => NORM(x) === alvo); if (c) { $('su-cidade').value = c; $('su-cidade').onchange(); } }
        $('su-gerar').onclick = gerar;
        $('su-word').onclick = baixarWord;
        $('su-imprimir').onclick = imprimir;
        $('su-salvar').onclick = salvar;
        MAPA = L.map('su-mapa').setView([-9.41, -36.63], 11);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(MAPA);
        $('su-status').textContent = `${fmt(geral.length)} ocorrências na base · ${GUARN.length} guarnições na escala.`;
    }
    document.addEventListener('DOMContentLoaded', () => { const s = P3.requireAuth && P3.requireAuth(); if (s === null) return; iniciar().catch(e => { $('su-status').textContent = '⚠️ ' + e.message; }); });
    window.OPOSufocamento = { _agrupar: agrupar, _rotear: rotear, _cronograma: cronograma };
})();
