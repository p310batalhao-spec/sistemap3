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
                data: $('su-data').value, hIni: $('su-hini').value, hFim: $('su-hfim').value,
                nome: val($('su-nome').value) || `OPERAÇÃO SUFOCAMENTO — ${escopo === 'cidade' ? cidade : 'ÁREA DA UNIDADE'}`.toUpperCase() };
            render();
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

    // ── Documento (tela/impressão, Word e salvo no Controle) ────────
    function documentoHTML() {
        const R = RESULT; if (!R) return '';
        const dataBR = R.data ? R.data.split('-').reverse().join('/') : '____/____/______';
        const focosTxt = R.focos.map(f => F[f].nome).join(', ');
        return `<div class="opo-suf-doc" style="font:12pt/1.45 'Times New Roman',serif;color:#000;background:#fff;padding:14mm;">
            <div style="text-align:center;font-weight:bold;">POLÍCIA MILITAR DE ALAGOAS<br>${esc(((CFG && CFG.nome) || '10º BATALHÃO DE POLÍCIA MILITAR').replace(/\s*\(.*\)\s*$/, '')).toUpperCase()}<br>SEÇÃO DE PLANEJAMENTO — P3</div>
            <h2 style="text-align:center;font-size:13pt;margin:10px 0 2px;">ORDEM DE POLICIAMENTO OSTENSIVO — OPERAÇÃO SUFOCAMENTO</h2>
            <div style="text-align:center;font-weight:bold;margin-bottom:10px;">${esc(R.nome)}</div>
            <table style="width:100%;border-collapse:collapse;font-size:11pt;" border="1" cellpadding="4">
                <tr><td style="width:32%"><b>Data</b></td><td>${dataBR}</td></tr>
                <tr><td><b>Horário</b></td><td>${esc(R.hIni)} às ${esc(R.hFim)}</td></tr>
                <tr><td><b>Área</b></td><td>${esc(R.escopo === 'cidade' ? R.cidade : 'Área completa da unidade')}</td></tr>
                <tr><td><b>Focos</b></td><td>${esc(focosTxt)}</td></tr>
                <tr><td><b>Base da análise</b></td><td>Ocorrências georreferenciadas dos últimos ${R.dias} dias — ${fmt(R.pts.length)} registro(s), agrupados em raio de ${R.raio} m</td></tr>
                <tr><td><b>Guarnições — entorno</b></td><td>${esc(R.entorno.join(', ') || '—')}</td></tr>
                <tr><td><b>Guarnições — saturação</b></td><td>${esc(R.saturacao.join(', ') || '—')}</td></tr>
            </table>
            <h3 style="font-size:12pt;margin:12px 0 4px;">1. FINALIDADE</h3>
            <p style="text-align:justify;">Realizar operação de sufocamento ao crime organizado nas áreas de maior incidência de ${esc(focosTxt)}, mediante permanência de ${R.dur} minutos em cada área delimitada, com bloqueio do entorno pelas guarnições de Radiopatrulha e saturação do interior pelas guarnições especializadas, prosseguindo sucessivamente para as demais áreas.</p>
            <h3 style="font-size:12pt;margin:12px 0 4px;">2. ÁREAS DELIMITADAS (por pontuação ponderada)</h3>
            <table style="width:100%;border-collapse:collapse;font-size:10pt;" border="1" cellpadding="3">
                <tr style="background:#eee"><th>Nº</th><th>Área (bairro / cidade)</th><th>Ocorrências por foco</th><th>Raio</th><th>Centro (lat, lng)</th></tr>
                ${R.areas.map(a => `<tr><td style="text-align:center"><b>${a.n}</b></td><td>${esc(a.bairro || '—')} / ${esc(a.cidade)}</td><td>${FOCOS.filter(f => a.cont[f.id]).map(f => `${f.nome}: ${a.cont[f.id]}`).join('; ')}</td><td>${a.raioM} m</td><td>${a.lat.toFixed(5)}, ${a.lng.toFixed(5)}</td></tr>`).join('')}
            </table>
            <h3 style="font-size:12pt;margin:12px 0 4px;">3. EMPREGO DAS GUARNIÇÕES EM CADA ÁREA</h3>
            <p style="text-align:justify;">a) <b>Entorno (bloqueio)</b> — as RPs posicionam-se nos pontos cardeais do perímetro da área, realizando abordagens e impedindo a evasão: ${R.entorno.map((g, i) => `${esc(g)} (${ROSA[i % ROSA.length][0]})`).join(', ') || '—'}.<br>
            b) <b>Saturação (interior)</b> — as guarnições especializadas percorrem o interior da área com abordagens qualificadas, varredura de pontos de venda de drogas e busca de armas: ${esc(R.saturacao.join(', ') || '—')}.<br>
            c) Encerrados os ${R.dur} minutos, todas as guarnições deslocam-se juntas para a área seguinte do cronograma.</p>
            <h3 style="font-size:12pt;margin:12px 0 4px;">4. CRONOGRAMA</h3>
            <table style="width:100%;border-collapse:collapse;font-size:10pt;" border="1" cellpadding="3">
                <tr style="background:#eee"><th>#</th><th>Horário</th><th>Área</th><th>Ciclo</th><th>Deslocamento</th></tr>
                ${R.slots.map(s => { const a = R.areas.find(x => x.n === s.area); return `<tr><td>${s.ordem}</td><td>${s.ini} – ${s.fim}</td><td>${s.area} — ${esc(a.bairro || '')}</td><td>${s.ciclo}º</td><td>${s.distanciaKm ? `${fmt(s.distanciaKm, 1)} km (~${s.deslocamentoMin} min)` : 'início'}</td></tr>`; }).join('')}
            </table>
            <h3 style="font-size:12pt;margin:12px 0 4px;">5. PRESCRIÇÕES</h3>
            <p style="text-align:justify;">a) Comunicar ao COPOM a chegada e a saída de cada área. b) Luzes intermitentes ligadas durante a permanência. c) Consultas de veículos e pessoas pelo QUIMERA/COPOM. d) Ocorrências e apreensões comunicadas de imediato ao COPOM para registro. e) Critério de pesos: MVI 1,00; arma 0,85; droga 0,75; CVP 0,55; CCP 0,30, ponderados pela recência.</p>
        </div>`;
    }
    async function gerarDocx() {
        const R = RESULT, d = window.docx;
        const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle } = d;
        const T = { font: 'Times New Roman', size: 22 };
        const par = (t, o = {}) => new Paragraph({ alignment: o.al || AlignmentType.JUSTIFIED, spacing: { after: 100 }, children: [new TextRun({ text: t, bold: !!o.b, ...T })] });
        const b = { style: BorderStyle.SINGLE, size: 1, color: '000000' };
        const cel = (t, bold) => new TableCell({ borders: { top: b, bottom: b, left: b, right: b }, children: [new Paragraph({ children: [new TextRun({ text: String(t), bold: !!bold, ...T, size: 20 })] })] });
        const tab = (cab, linhas) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: cab.map(c => cel(c, true)) }), ...linhas.map(l => new TableRow({ children: l.map(c => cel(c)) }))] });
        const focosTxt = R.focos.map(f => F[f].nome).join(', ');
        const doc = new Document({ sections: [{ properties: { page: { margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } }, children: [
            par('POLÍCIA MILITAR DE ALAGOAS — ' + String((CFG && CFG.nome) || '10º BPM').replace(/\s*\(.*\)\s*$/, '').toUpperCase() + ' — P3', { b: true, al: AlignmentType.CENTER }),
            par('ORDEM DE POLICIAMENTO OSTENSIVO — OPERAÇÃO SUFOCAMENTO', { b: true, al: AlignmentType.CENTER }),
            par(R.nome, { b: true, al: AlignmentType.CENTER }),
            tab(['Campo', 'Valor'], [['Data', R.data ? R.data.split('-').reverse().join('/') : ''], ['Horário', `${R.hIni} às ${R.hFim}`], ['Área', R.escopo === 'cidade' ? R.cidade : 'Área completa da unidade'],
                ['Focos', focosTxt], ['Base da análise', `Últimos ${R.dias} dias — ${R.pts.length} ocorrência(s), raio ${R.raio} m`], ['Entorno', R.entorno.join(', ')], ['Saturação', R.saturacao.join(', ')]]),
            par('1. FINALIDADE', { b: true }),
            par(`Realizar operação de sufocamento ao crime organizado nas áreas de maior incidência de ${focosTxt}, com permanência de ${R.dur} minutos em cada área: RPs no bloqueio do entorno e guarnições especializadas na saturação do interior, prosseguindo para as demais áreas.`),
            par('2. ÁREAS DELIMITADAS', { b: true }),
            tab(['Nº', 'Área', 'Ocorrências por foco', 'Raio', 'Centro'], R.areas.map(a => [a.n, `${a.bairro || '—'} / ${a.cidade}`, FOCOS.filter(f => a.cont[f.id]).map(f => `${f.nome}: ${a.cont[f.id]}`).join('; '), `${a.raioM} m`, `${a.lat.toFixed(5)}, ${a.lng.toFixed(5)}`])),
            par('3. EMPREGO DAS GUARNIÇÕES', { b: true }),
            par(`a) Entorno (bloqueio): ${R.entorno.map((g, i) => `${g} (${ROSA[i % ROSA.length][0]})`).join(', ')}.`),
            par(`b) Saturação (interior): ${R.saturacao.join(', ')}.`),
            par(`c) Encerrados os ${R.dur} minutos, todas as guarnições seguem para a área seguinte do cronograma.`),
            par('4. CRONOGRAMA', { b: true }),
            tab(['#', 'Horário', 'Área', 'Ciclo', 'Deslocamento'], R.slots.map(s => { const a = R.areas.find(x => x.n === s.area); return [s.ordem, `${s.ini} – ${s.fim}`, `${s.area} — ${a.bairro || ''}`, `${s.ciclo}º`, s.distanciaKm ? `${s.distanciaKm} km (~${s.deslocamentoMin} min)` : 'início']; })),
            par('5. PRESCRIÇÕES', { b: true }),
            par('a) Comunicar ao COPOM a chegada e a saída de cada área. b) Luzes intermitentes ligadas. c) Consultas pelo QUIMERA/COPOM. d) Ocorrências e apreensões comunicadas de imediato ao COPOM. e) Pesos: MVI 1,00; arma 0,85; droga 0,75; CVP 0,55; CCP 0,30, ponderados pela recência.'),
        ] }] });
        const blob = await Packer.toBlob(doc);
        return { blob, nome: `OPO_SUFOCAMENTO_${NORM(R.cidade || 'AREA').replace(/[^A-Z0-9]+/g, '_')}_${R.data || iso(new Date())}.docx` };
    }
    async function baixarWord() { const r = await gerarDocx(); saveAs(r.blob, r.nome); }
    function imprimir() { $('su-doc').innerHTML = documentoHTML(); window.print(); }

    async function salvar() {
        const R = RESULT; if (!R) return;
        if (!R.data) { alert('Informe a data da operação.'); return; }
        const btn = $('su-salvar'); btn.disabled = true; btn.textContent = '⏳ Salvando…';
        try {
            const sess = window.P3 && P3.getSession ? P3.getSession() : null;
            const registro = {
                tipo: 'opo', modalidade: 'sufocamento', nome: R.nome, criadoEm: new Date().toISOString(), data: new Date().toLocaleDateString('pt-BR'),
                criadoPor: sess ? [sess.graduacao, sess.nomeGuerra].filter(Boolean).join(' ') : null,
                escopo: R.escopo, cidade: R.escopo === 'cidade' ? R.cidade : 'ÁREA DA UNIDADE', cidades: R.escopo === 'cidade' ? [R.cidade] : [...new Set(R.areas.map(a => a.cidade).filter(Boolean))],
                periodoDias: R.dias, tiposCombate: R.focos, vigenciaTexto: R.data.split('-').reverse().join('/'),
                execucao: { dataIni: R.data, dataFim: R.data, horaIni: R.hIni, horaFim: R.hFim },
                bairros: [...new Set(R.areas.map(a => a.bairro).filter(Boolean))],
                areas: R.areas.map(a => ({ n: a.n, lat: +a.lat.toFixed(6), lng: +a.lng.toFixed(6), raioM: a.raioM, score: a.score, bairro: a.bairro, cidade: a.cidade, cont: a.cont, entorno: a.entorno.map(p => ({ guarnicao: p.guarnicao, ponto: p.ponto })), saturacao: a.saturacao })),
                cronograma: R.slots, guarnicoes: { entorno: R.entorno, saturacao: R.saturacao }, duracaoAreaMin: R.dur, temDocumento: true,
            };
            const r = await fetch(`${DB}/cartoes_programa.json`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(registro) });
            if (!r.ok) throw new Error('Firebase respondeu HTTP ' + r.status);
            const id = (await r.json()).name;
            const dx = await gerarDocx();
            const b64 = await new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.readAsDataURL(dx.blob); });
            const html = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><title>${esc(R.nome)}</title></head><body style="margin:0;background:#fff;">${documentoHTML()}</body></html>`;
            await fetch(`${DB}/opo_documentos/${id}.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome: R.nome, modelo: 'sufocamento', html, docxBase64: b64, docxNome: dx.nome, criadoEm: new Date().toISOString() }) });
            btn.textContent = '✅ Salva';
            if (confirm('Operação Sufocamento salva. Abrir no Controle de Operações?')) location.href = 'controle-operacoes.html?dia=' + R.data;
        } catch (e) { alert('Não foi possível salvar: ' + e.message); btn.textContent = '💾 Salvar OPO'; }
        btn.disabled = false;
    }

    // ── Inicialização ───────────────────────────────────────────────
    async function iniciar() {
        CFG = await P3.loadUnidadeConfig();
        DB = CFG.firebase.databaseURL;
        $('su-focos').innerHTML = FOCOS.map(f => `<label title="peso ${String(f.peso).replace('.', ',')}"><input type="checkbox" value="${f.id}" checked> ${f.nome}</label>`).join('');
        $('su-data').value = iso(new Date());
        const q = new URLSearchParams(location.search);
        if (q.get('data')) $('su-data').value = q.get('data');
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
