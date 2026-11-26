// ====================================================================
// Cartao Programa com PONTOS BASE (PB) - js/cartao-programa-pb.js
// ====================================================================
// Pedido do usuario (23/11/2026): pagina nova, com a mesma logica de mancha
// criminal/intervalos do cartao programa, acrescentando os Pontos Base (PB):
// 45 min cada, varios por cidade. Tres modos:
//  - Gerar PB automaticamente (clusters da mancha criminal = locais de maior
//    movimento/criminalidade).
//  - Cadastrar novos PBs (por endereco, geolocalizacao ou clique no mapa,
//    como no opo-sufocamento) e salvar com nome + data.
//  - Carregar PBs salvos.
// Depois, gera o cartao programa com os PBs intercalados por patrulhamento,
// respeitando os turnos e o almoco.
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const NORM = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
    const val = v => { const s = (v == null ? '' : String(v)).trim(); return s && s !== '---' ? s : ''; };
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isNaN(n) ? null : n; };
    const distM = (a, b) => { const R = 6371000, r = x => x * Math.PI / 180; const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng); const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
    const hm = m => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const minutos = h => { const m = String(h || '').match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
    function parseData(s) {
        const str = String(s || '').trim();
        let m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
        const d = new Date(str); return isNaN(d) ? null : d;
    }

    // Pesos por tipo (mesma ideia do opo/gerarcartao: gravidade + recencia)
    const PESO = { MVI: 5, CVP: 3, CCP: 1.5, ARMA: 2.5, DROGA: 1.5 };
    const tipG = o => NORM(`${o.TIPIFICACAO_GERAL || ''} ${o.TIPIFICACAO || ''}`);
    function focoDe(o) {
        const t = tipG(o);
        if (/HOMICIDIO|FEMINICIDIO|LATROCINIO/.test(t) && (!/TENTATIVA/.test(t) || NORM(o.OBITO) === 'S')) return 'MVI';
        if (/ROUBO|EXTORS/.test(t)) return 'CVP';
        if (/FURTO|RECEPTACAO|DANO\b|ESTELIONATO|APROPRIACAO INDEBITA/.test(t)) return 'CCP';
        return null;
    }

    // PBs padrao (23/11/2026, informados pelo usuario) — ja georreferenciados
    // e DEIXADOS SALVOS. Palmeira dos Indios tem 2 RPs (chaves "...|RP 01" e
    // "...|RP 02"), cada uma com a mesma logica/horarios do gerarcartao + seus
    // PBs. As coordenadas de pontos vagos ("cruzamento", "entrada") caem perto
    // do melhor palpite — o usuario pode arrastar no mapa pra ajustar.
    const PB_PADRAO = {
        "QUEBRANGULO": [{nome:"Avenida XV de Novembro (proximo a casa de eventos Brilho da Cidade)",lat:-9.3214,lng:-36.4719},{nome:"Entrada da cidade, Loteamento Caboge",lat:-9.3204,lng:-36.4709},{nome:"Praca G. Monteiro",lat:-9.3194,lng:-36.4699}],
        "MAR VERMELHO": [{nome:"Avenida Neto Lins",lat:-9.445892,lng:-36.384631},{nome:"Cruzamento da Av. Claudio Cabral com a Rua Sao Sebastiao",lat:-9.448818,lng:-36.389082},{nome:"Cruzamento da ladeira da Rua da Independencia com Rua Major Canuto",lat:-9.445129,lng:-36.390416}],
        "IGACI": [{nome:"Rua Sao Pedro, final da rua na entrada do Loteamento Lourenco Ferreira",lat:-9.552268,lng:-36.638639},{nome:"Rua das Pedrinhas",lat:-9.537875,lng:-36.631814},{nome:"Rua Pedro Joaquim da Silva, na praca antes da saida para Lagoa do Capim",lat:-9.53894,lng:-36.62856}],
        "ESTRELA DE ALAGOAS": [{nome:"Rua Rabo da Gata",lat:-9.38666,lng:-36.760811},{nome:"Rua Padre Ludugero",lat:-9.388897,lng:-36.761683},{nome:"Rua Ricardo Gonzaga",lat:-9.386906,lng:-36.759078}],
        "MINADOR DO NEGRAO": [{nome:"Rua Belarmino Vieira Barros",lat:-9.328305,lng:-36.886814},{nome:"Rua Helio Barros",lat:-9.30943,lng:-36.862315},{nome:"Cruzamento da Rua Remi Maia com a Rua Oliveira Lima",lat:-9.312358,lng:-36.869553}],
        "CACIMBINHAS": [{nome:"Entrada do Conjunto Maria Gonzaga",lat:-9.404908,lng:-36.997598},{nome:"Cruzamento da Rua Leticia Cavalcante Amorim com a Rua Julio Teixeira de Barros",lat:-9.398931,lng:-36.985754},{nome:"Inicio da Rua Domingos Leite",lat:-9.401212,lng:-36.991082}],
        "BELEM": [{nome:"Barro Vermelho (proximo ao colegio)",lat:-9.571535,lng:-36.492841},{nome:"Entrada para a Cha de Belem, cruzamento da rua do lixo",lat:-9.574985,lng:-36.498046},{nome:"Cabeca Dantas",lat:-9.571535,lng:-36.492841}],
        "TANQUE D'ARCA": [{nome:"Praca Central",lat:-9.534818,lng:-36.431458},{nome:"Cruzamento da Rua Artur de Almeida com a Rua Vicente de Mascarenhas",lat:-9.535318,lng:-36.431958},{nome:"Entrada da Cohab Nova",lat:-9.534318,lng:-36.430958}],
        "MARIBONDO": [{nome:"Entrada do Planalto",lat:-9.579795,lng:-36.306504},{nome:"Rua Capricho",lat:-9.580295,lng:-36.307004},{nome:"Rua Bonfim",lat:-9.573309,lng:-36.303249}],
        "PAULO JACINTO": [{nome:"Rua Sao Pedro (proximidades do Cemiterio)",lat:-9.369463,lng:-36.371271},{nome:"Entrada do Conjunto Santa Ines",lat:-9.367918,lng:-36.367241},{nome:"Rua Vera Cruz, entre os conjuntos Santa Quiteria 1 e 2",lat:-9.37508,lng:-36.378383}],
        "PALMEIRA DOS INDIOS|RP 01": [{nome:"Rua Dr. Aline Leal (Vila Joao XXIII)",lat:-9.413696,lng:-36.645845},{nome:"Cruzamento da Rua Raimundo Assis Maia com Claudio Barbosa de Lima (Vila Maria)",lat:-9.420032,lng:-36.645021},{nome:"Praca da Rua Jose Caetano de Moraes com a Rua da Solidao (Cafurna)",lat:-9.396931,lng:-36.632545}],
        "PALMEIRA DOS INDIOS|RP 02": [{nome:"Subida da Dom Bosco com Rua Professor Guedes de Miranda",lat:-9.387573,lng:-36.626517},{nome:"Rua Amarilio Fernandes, entrada do Conjunto Vila Nova",lat:-9.397406,lng:-36.62226},{nome:"Rua Osorio Horacio, entrada para o Xucurus",lat:-9.414094,lng:-36.620887}],
    };

    // Esquema de turno das RPs de Palmeira — RP 01 e RP 02 têm horários
    // DIFERENTES (copiados exatamente do gerarcartao.js). Os PBs sao
    // distribuidos (ciclados) dentro das JANELAS de patrulhamento, cada uma no
    // seu turno. Minutos; apos a meia-noite segue somando (00:00 = 1440).
    const ESQUEMA_PALMEIRA_RP = {
        // RP 01: 08:30-13:00 setorial · 13:00-18:00 almoço · 18:00-19:00 janta ·
        // 19:00-03:00 noturno · 03:00-05:00 descanso · 05:00-07:30 OPO alvorada.
        'RP 01': {
            janelas: [{ ini: 510, fim: 780, turno: 'manha' }, { ini: 1140, fim: 1620, turno: 'noite' }, { ini: 1740, fim: 1890, turno: 'manha' }],
            fixos: [
                { ini: 780, fim: 1080, atv: 'Almoço / Prontidão', loc: 'Base operacional' },
                { ini: 1080, fim: 1140, atv: 'Janta / Prontidão', loc: 'Base operacional' },
                { ini: 1620, fim: 1740, atv: 'Descanso / Prontidão', loc: 'Base operacional' },
            ],
        },
        // RP 02: 08:00-12:00 prontidão/adm · 12:00-18:00 setorial (tarde) ·
        // 18:00-19:00 ronda crítica · 19:00-20:00 janta · 20:00-20:30 OPO escolar ·
        // 20:30-00:00 noturno 1 · 00:00-03:00 descanso · 03:00-05:00 noturno 2 ·
        // 05:00-07:00 descanso.
        'RP 02': {
            janelas: [{ ini: 720, fim: 1080, turno: 'tarde' }, { ini: 1080, fim: 1140, turno: 'noite' }, { ini: 1230, fim: 1440, turno: 'noite' }, { ini: 1620, fim: 1740, turno: 'noite' }],
            fixos: [
                { ini: 480, fim: 720, atv: 'Prontidão / Adm / Almoço', loc: 'Base operacional' },
                { ini: 1140, fim: 1200, atv: 'Janta / Prontidão', loc: 'Base operacional' },
                { ini: 1200, fim: 1230, atv: 'OPO — Policiamento Escolar', loc: 'Escola Est. Monsenhor Ribeiro — Palmeira de Fora' },
                { ini: 1440, fim: 1620, atv: 'Descanso / Prontidão', loc: 'Base operacional' },
                { ini: 1740, fim: 1860, atv: 'Descanso / Prontidão', loc: 'Base operacional' },
            ],
        },
    };

    let CFG = null, DB = null, MAPA = null, CAMADAS = null, CIDADES = [], PTS = [], modoAlfinete = false, modoAtual = null;
    let PBS = []; // [{id, nome, rua, lat, lng, crit}]
    let CARTAO = null, RP_SEL = null; // RP_SEL: "RP 01"/"RP 02" quando Palmeira

    async function no(nome) {
        window._NODES_CACHE = window._NODES_CACHE || {};
        if (window._NODES_CACHE[nome]) return window._NODES_CACHE[nome];
        const d = await fetch(`${DB}/${nome}.json`).then(r => r.ok ? r.json() : null).catch(() => null);
        return (window._NODES_CACHE[nome] = d ? Object.values(d).filter(Boolean) : []);
    }

    // ── Mancha criminal da cidade: ocorrencias com coordenada, ponderadas ──
    async function coletarCrime(cidadeNorm, dias) {
        const [geral, armas, drogas] = await Promise.all([no('geral'), no('arma'), no('droga')]);
        const hoje = new Date(); hoje.setHours(23, 59, 59, 999);
        const ini = new Date(hoje); ini.setDate(ini.getDate() - dias);
        const pts = [], vistos = new Set();
        const add = (o, foco) => {
            const chave = val(o.BOLETIM) ? foco + '|' + val(o.BOLETIM) : null;
            if (chave && vistos.has(chave)) return;
            const d = parseData(o.DATA || o.data); if (!d || d < ini || d > hoje) return;
            if (cidadeNorm && NORM(o.CIDADE) !== cidadeNorm) return;
            const lat = num(o.LATITUDE), lng = num(o.LONGITUDE);
            if (lat == null || lng == null || lat > -7 || lat < -11 || lng > -34 || lng < -39) return;
            if (chave) vistos.add(chave);
            const idade = (hoje - d) / 864e5;
            const rec = idade <= 30 ? 1 : idade <= 90 ? 0.75 : 0.5;
            pts.push({ foco, lat, lng, peso: (PESO[foco] || 1) * rec, bairro: val(o.BAIRRO), tip: val(o.TIPIFICACAO_GERAL || o.TIPIFICACAO || o.TIPO_ARMA || o.TIPO_DROGA) });
        };
        geral.forEach(o => { const f = focoDe(o); if (f) add(o, f); });
        armas.forEach(o => add(o, 'ARMA'));
        drogas.forEach(o => add(o, 'DROGA'));
        return pts;
    }

    // Agrupamento geografico simples (celulas ~ raioM) -> centros ponderados
    function agrupar(pts, raioM) {
        const ord = pts.slice().sort((a, b) => b.peso - a.peso);
        const grupos = [];
        ord.forEach(p => {
            let g = grupos.find(g => distM(g, p) <= raioM);
            if (!g) { g = { lat: p.lat, lng: p.lng, pts: [] }; grupos.push(g); }
            g.pts.push(p);
            const w = g.pts.reduce((s, x) => s + x.peso, 0);
            g.lat = g.pts.reduce((s, x) => s + x.lat * x.peso, 0) / w;
            g.lng = g.pts.reduce((s, x) => s + x.lng * x.peso, 0) / w;
        });
        return grupos.map(g => ({
            lat: g.lat, lng: g.lng,
            score: g.pts.reduce((s, x) => s + x.peso, 0),
            total: g.pts.length,
            bairro: (() => { const b = {}; g.pts.forEach(p => { if (p.bairro) b[p.bairro] = (b[p.bairro] || 0) + 1; }); return Object.entries(b).sort((a, b2) => b2[1] - a[1])[0] ? Object.entries(b).sort((a, b2) => b2[1] - a[1])[0][0] : ''; })(),
        })).sort((a, b) => b.score - a.score);
    }

    // Criticidade de um PB: ocorrencias ponderadas num raio de 400 m
    function criticidade(pb) {
        let s = 0, n = 0;
        PTS.forEach(p => { if (distM(pb, p) <= 400) { s += p.peso; n++; } });
        pb.score = s; pb.nOc = n;
        return s >= 8 ? 'alta' : s >= 3 ? 'media' : 'baixa';
    }
    function recalcularCrit() { PBS.forEach(pb => { pb.crit = criticidade(pb); }); }

    // ── Geocodificacao (Nominatim, como no opo-sufocamento) ────────────
    async function reverseGeocode(lat, lng) {
        try {
            const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=jsonv2&accept-language=pt-BR&zoom=18`, { headers: { Accept: 'application/json' } });
            if (!r.ok) return null;
            const a = (await r.json()).address || {};
            return { rua: a.road || a.pedestrian || a.residential || '', bairro: a.suburb || a.neighbourhood || a.quarter || '' };
        } catch (e) { return null; }
    }
    async function forwardGeocode(texto) {
        try {
            const cidade = $('cp-cidade').value;
            const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(texto + (cidade ? ', ' + cidade : '') + ', Alagoas, Brasil')}&format=jsonv2&limit=1&accept-language=pt-BR`, { headers: { Accept: 'application/json' } });
            if (!r.ok) return null;
            const j = await r.json();
            return j.length ? { lat: +j[0].lat, lng: +j[0].lon } : null;
        } catch (e) { return null; }
    }

    // ── PBs ────────────────────────────────────────────────────────────
    let seq = 1;
    const TURNO_LABEL = { manha: 'Manhã', tarde: 'Tarde', noite: 'Noite', todos: 'Todos' };
    function turnoNovo() { const el = $('cp-turno-novo'); return el ? el.value : 'noite'; }
    function novoPB(lat, lng, nome, rua, turno) {
        const pb = { id: seq++, lat, lng, nome: nome || '', rua: rua || '', turno: turno || turnoNovo() };
        pb.crit = criticidade(pb);
        return pb;
    }
    function addPB(pb) { PBS.push(pb); renderTudo(); }

    async function addPorRua() {
        const t = val($('cp-add-rua').value);
        if (!t) { alert('Digite o endereço.'); return; }
        const msg = $('cp-add-msg'); msg.textContent = '⏳ Localizando…';
        const g = await forwardGeocode(t);
        if (!g) { msg.textContent = '⚠️ Não localizei esse endereço. Tente com o bairro, ou use o mapa.'; return; }
        const geo = await reverseGeocode(g.lat, g.lng);
        addPB(novoPB(g.lat, g.lng, geo && geo.rua ? geo.rua : t, geo ? geo.rua : t));
        $('cp-add-rua').value = ''; msg.textContent = '✅ PB adicionado.';
    }
    async function addPorPin(lat, lng) {
        const msg = $('cp-add-msg'); msg.textContent = '⏳ Reconhecendo a rua…';
        const geo = await reverseGeocode(lat, lng);
        addPB(novoPB(lat, lng, geo && geo.rua ? geo.rua : 'PB', geo ? geo.rua : ''));
        msg.textContent = geo && geo.rua ? `✅ PB em: ${geo.rua}` : '✅ PB adicionado (rua não reconhecida — edite se quiser).';
    }
    function addPorCoord() {
        const lat = num($('cp-add-lat').value), lng = num($('cp-add-lng').value);
        if (lat == null || lng == null) { alert('Informe latitude e longitude.'); return; }
        addPB(novoPB(lat, lng, 'PB', ''));
        $('cp-add-lat').value = ''; $('cp-add-lng').value = '';
    }
    function moverPB(i, dir) { const j = i + dir; if (j < 0 || j >= PBS.length) return; const t = PBS[i]; PBS[i] = PBS[j]; PBS[j] = t; renderTudo(); }
    function removerPB(i) { PBS.splice(i, 1); renderTudo(); }

    // ── Gerar PB automaticamente (clusters + centro geocodificado) ──────
    async function gerarAutomatico() {
        const cidade = $('cp-cidade').value;
        if (!cidade) { alert('Escolha a cidade primeiro.'); return; }
        const st = $('cp-status'); st.textContent = '⏳ Analisando a mancha criminal…';
        await garantirCrime();
        const clusters = agrupar(PTS, 350).slice(0, 6);
        PBS = [];
        for (const c of clusters) {
            const geo = await reverseGeocode(c.lat, c.lng);
            const nome = geo && geo.rua ? geo.rua : (c.bairro || 'Área crítica');
            const pb = novoPB(c.lat, c.lng, nome, geo ? geo.rua : '');
            PBS.push(pb);
        }
        // Ponto de maior movimento: centro da cidade (geocodificado)
        try {
            const centro = await forwardGeocode('Centro');
            if (centro && !PBS.some(p => distM(p, centro) < 250)) PBS.push(novoPB(centro.lat, centro.lng, 'Centro (maior movimento)', 'Centro'));
        } catch (e) { /* segue sem o centro */ }
        st.textContent = PBS.length ? `✅ ${PBS.length} PB(s) gerados pela mancha criminal.` : '⚠️ Sem ocorrências georreferenciadas suficientes nesta cidade — cadastre os PBs manualmente.';
        renderTudo();
    }

    async function garantirCrime() {
        const cidade = $('cp-cidade').value;
        PTS = cidade ? await coletarCrime(NORM(cidade), +$('cp-dias').value) : [];
        recalcularCrit();
    }

    // ── Salvar / carregar (Firebase: no "pontos_base") ─────────────────
    async function salvarPBs() {
        const cidade = $('cp-cidade').value;
        if (!cidade) { alert('Escolha a cidade.'); return; }
        if (!PBS.length) { alert('Adicione ao menos um PB.'); return; }
        const nome = val($('cp-salvar-nome').value) || `PBs ${cidade}`;
        const btn = $('cp-salvar-btn'); btn.disabled = true; btn.textContent = '⏳ Salvando…';
        try {
            const payload = { cidade, cidadeNorm: NORM(cidade), nome, rp: RP_SEL || null, data: new Date().toLocaleString('pt-BR'), criadoEm: Date.now(),
                pbs: PBS.map(p => ({ nome: p.nome, rua: p.rua, turno: p.turno, lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) })) };
            const r = await fetch(`${DB}/pontos_base.json`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            btn.textContent = '✅ Salvo!';
            $('cp-salvar-nome').value = '';
        } catch (e) { alert('Não consegui salvar: ' + e.message); btn.textContent = '💾 Salvar PBs'; }
        setTimeout(() => { btn.disabled = false; btn.textContent = '💾 Salvar PBs'; }, 2500);
    }
    async function listarSalvos() {
        const sel = $('cp-salvos'); const cidadeNorm = NORM($('cp-cidade').value);
        sel.innerHTML = '<option value="">— carregando… —</option>';
        const itens = [];
        // Conjuntos PADRAO embutidos (inclui Palmeira RP 01/RP 02)
        Object.keys(PB_PADRAO).forEach(k => {
            const partes = k.split('|');
            if (NORM(partes[0]) !== cidadeNorm) return;
            const rp = partes[1] || null;
            itens.push({ nome: '⭐ Padrão' + (rp ? ' — ' + rp : ''), rp: rp, padrao: true, pbs: PB_PADRAO[k] });
        });
        // Conjuntos salvos pelo usuario (Firebase)
        try {
            const d = await fetch(`${DB}/pontos_base.json`).then(r => r.ok ? r.json() : null).catch(() => null);
            const salvos = d ? Object.values(d).filter(v => v && (!cidadeNorm || v.cidadeNorm === cidadeNorm)) : [];
            salvos.sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));
            salvos.forEach(v => itens.push({ nome: `${v.nome} — ${v.data || ''}`, rp: v.rp || null, pbs: v.pbs || [] }));
        } catch (e) { /* segue so com os padrao */ }
        window._PB_SALVOS = itens;
        sel.innerHTML = '<option value="">— Selecione —</option>' + itens.map((v, i) => `<option value="${i}">${esc(v.nome)} (${(v.pbs || []).length} PB)</option>`).join('');
        if (!itens.length) sel.innerHTML = '<option value="">Nenhum conjunto pra esta cidade</option>';
    }
    function carregarSelecionado() {
        const i = $('cp-salvos').value; if (i === '') return;
        const item = (window._PB_SALVOS || [])[+i]; if (!item) return;
        // Os PBs ja salvos (padrao e os que o usuario mandou) sao de NOITE por
        // padrao; conjuntos salvos com turno proprio mantem o que foi salvo.
        PBS = (item.pbs || []).map(p => novoPB(+p.lat, +p.lng, p.nome, p.rua, p.turno || 'noite'));
        RP_SEL = item.rp || RP_SEL || (NORM($('cp-cidade').value) === 'PALMEIRA DOS INDIOS' ? 'RP 01' : null);
        if (item.rp && $('cp-rp')) $('cp-rp').value = item.rp; // sincroniza o seletor
        $('cp-carregar-msg').textContent = `✅ ${PBS.length} PB(s) carregados${item.rp ? ' (' + item.rp + ')' : ''}.`;
        renderTudo();
    }

    // ── Render (mapa + lista) ──────────────────────────────────────────
    function renderTudo() { recalcularCrit(); desenharMapa(); renderLista(); $('cp-gerar').disabled = !PBS.length; $('cp-pb-dica').style.display = PBS.length ? '' : 'none'; }

    function desenharMapa() {
        if (!MAPA) return;
        if (CAMADAS) MAPA.removeLayer(CAMADAS);
        CAMADAS = L.layerGroup().addTo(MAPA);
        // mancha criminal (pontos leves)
        PTS.forEach(p => L.circleMarker([p.lat, p.lng], { radius: 3, color: '#b91c1c', weight: 0, fillColor: '#b91c1c', fillOpacity: .35 }).addTo(CAMADAS));
        // PBs (marcadores arrastaveis numerados)
        PBS.forEach((pb, i) => {
            L.circle([pb.lat, pb.lng], { radius: 400, color: '#1e6b34', weight: 1, fillColor: '#1e6b34', fillOpacity: .06 }).addTo(CAMADAS);
            const mk = L.marker([pb.lat, pb.lng], { draggable: true, icon: L.divIcon({ className: '', html: `<div class="cp-pb-lbl" title="Arraste para mover">${i + 1}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] }) })
                .bindTooltip(`PB ${i + 1} — ${esc(pb.nome || pb.rua || '')}`).addTo(CAMADAS);
            mk.on('dragend', async ev => {
                const ll = ev.target.getLatLng(); pb.lat = ll.lat; pb.lng = ll.lng;
                const geo = await reverseGeocode(pb.lat, pb.lng);
                if (geo && geo.rua) { pb.rua = geo.rua; if (!pb.nome || pb.nome === 'PB') pb.nome = geo.rua; }
                renderTudo();
            });
        });
        const alvo = PBS.length ? PBS : PTS;
        if (alvo.length) MAPA.fitBounds(L.latLngBounds(alvo.map(p => [p.lat, p.lng])).pad(0.3), { maxZoom: 15, animate: false });
        setTimeout(() => MAPA.invalidateSize(), 120);
    }

    function renderLista() {
        if (!PBS.length) { $('cp-pb-lista').innerHTML = '<div class="cp-vazio">Nenhum PB ainda.</div>'; return; }
        const opt = (pb, v, lbl) => `<option value="${v}"${pb.turno === v ? ' selected' : ''}>${lbl}</option>`;
        const linhas = PBS.map((pb, i) => `<tr>
            <td><span class="cp-pb-lbl" style="width:22px;height:22px">${i + 1}</span></td>
            <td><b>${esc(pb.nome || pb.rua || '—')}</b><br><small>${esc(pb.rua && pb.rua !== pb.nome ? pb.rua + ' · ' : '')}${pb.lat.toFixed(5)}, ${pb.lng.toFixed(5)}</small></td>
            <td><span class="cp-crit ${pb.crit}">${pb.crit === 'alta' ? 'Alta' : pb.crit === 'media' ? 'Média' : 'Baixa'}</span><br><small>${pb.nOc || 0} oc.</small></td>
            <td class="cp-noprint"><select class="cp-mini" data-cp="turno" data-i="${i}" style="padding:2px 4px">${opt(pb, 'manha', 'Manhã')}${opt(pb, 'tarde', 'Tarde')}${opt(pb, 'noite', 'Noite')}${opt(pb, 'todos', 'Todos')}</select></td>
            <td class="cp-noprint" style="white-space:nowrap"><button class="cp-mini" data-cp="up" data-i="${i}" title="Subir"${i === 0 ? ' disabled' : ''}>⬆</button> <button class="cp-mini" data-cp="down" data-i="${i}" title="Descer"${i === PBS.length - 1 ? ' disabled' : ''}>⬇</button> <button class="cp-mini" data-cp="del" data-i="${i}" title="Remover">🗑</button></td></tr>`).join('');
        $('cp-pb-lista').innerHTML = `<div style="overflow:auto"><table class="cp-tab"><tr><th>#</th><th>Ponto Base</th><th>Criticidade</th><th class="cp-noprint">Turno</th><th class="cp-noprint">Ações</th></tr>${linhas}</table></div>`;
    }

    // ── Gerar o Cartao Programa: PB + Rondas no Entorno ─────────────────
    // Monta JANELAS de patrulhamento + slots FIXOS (intervalos). Em cada
    // janela, CICLA os PBs: cada um 45 min ("PB N - Ponto Base + Rondas no
    // entorno") + deslocamento. Palmeira dos Indios usa os horarios-base das
    // RPs do gerarcartao (jornada longa); as demais cidades usam o turno
    // informado (inicio/termino + almoco).
    function construirCartao(janelas, fixos, pbs, desl, manchaLocal) {
        manchaLocal = manchaLocal || 'Áreas críticas da cidade';
        const linhas = fixos.slice();
        // Cada janela recebe os PBs do SEU turno; os de turno "todos" entram
        // em TODAS as janelas (manha/tarde/noite).
        const porTurno = { manha: [], tarde: [], noite: [] };
        pbs.forEach(p => {
            if (p.turno === 'todos') { porTurno.manha.push(p); porTurno.tarde.push(p); porTurno.noite.push(p); }
            else (porTurno[p.turno] || porTurno.noite).push(p);
        });
        const idx = { manha: 0, tarde: 0, noite: 0 };
        janelas.forEach(w => {
            const lista = porTurno[w.turno] || [];
            let t = w.ini;
            while (t < w.fim) {
                if (!lista.length) { linhas.push({ ini: t, fim: w.fim, atividade: w.rotulo || 'Patrulhamento — Mancha Criminal', local: manchaLocal, crit: null }); break; }
                const pb = lista[idx[w.turno] % lista.length]; const nPB = (idx[w.turno] % lista.length) + 1; idx[w.turno]++;
                const durPB = Math.min(45, w.fim - t);
                linhas.push({ ini: t, fim: t + durPB, atividade: `PB ${nPB} — Ponto Base + Rondas no entorno`, local: pb.nome || pb.rua || '—', crit: pb.crit });
                t += durPB;
                if (t < w.fim) { const d = Math.min(desl, w.fim - t); linhas.push({ ini: t, fim: t + d, atividade: 'Deslocamento / Patrulhamento (mancha criminal)', local: manchaLocal, crit: null }); t += d; }
            }
        });
        return linhas.sort((a, b) => a.ini - b.ini);
    }

    function gerarCartao() {
        if (!PBS.length) { alert('Adicione os PBs primeiro.'); return; }
        const ehPalmeira = NORM($('cp-cidade').value) === 'PALMEIRA DOS INDIOS';
        const desl = +$('cp-desl').value;
        // Ordem dos PBs: por criticidade desc, desempate pela ordem da lista.
        const ordem = PBS.map((pb, i) => ({ pb, i })).sort((a, b) => (b.pb.score - a.pb.score) || (a.i - b.i)).map(x => x.pb);
        let janelas, fixos;
        if (ehPalmeira) {
            const rp = RP_SEL || ($('cp-rp') ? $('cp-rp').value : '') || 'RP 01';
            RP_SEL = rp;
            const esq = ESQUEMA_PALMEIRA_RP[rp] || ESQUEMA_PALMEIRA_RP['RP 01'];
            janelas = esq.janelas.map(w => ({ ini: w.ini, fim: w.fim, turno: w.turno }));
            fixos = esq.fixos.map(f => ({ ini: f.ini, fim: f.fim, atividade: f.atv, local: f.loc, fixa: true }));
        } else {
            // DEMAIS CIDADES (fora Palmeira RP 01/02) — blocos fixos IGUAIS ao
            // gerarcartao.js: Almoço e Prontidão 13:00-16:30, Janta e Prontidão
            // 19:00-20:00, Descanso/Prontidão 00:00-05:00. As rondas encerram às
            // 00h (ou no término, se antes) e a Operação Alvorada vai das 05:00
            // às 07:00. (Só Palmeira ronda na madrugada.)
            let ini = minutos($('cp-hini').value); if (ini == null) ini = 480; // início do serviço (08:00)
            const fim = minutos($('cp-hfim').value);
            const ALM_INI = 780, ALM_FIM = 990;    // 13:00–16:30 Almoço e Prontidão
            const JAN_INI = 1140, JAN_FIM = 1200;  // 19:00–20:00 Janta e Prontidão
            const ALV_INI = 1740, ALV_FIM = 1860;  // 05:00–07:00 Operação Alvorada
            const FIM_NOITE = (fim != null && fim > JAN_FIM && fim <= 1440) ? fim : 1440; // teto das rondas noturnas = 00:00
            fixos = [
                { ini: ALM_INI, fim: ALM_FIM, atividade: 'Almoço e Prontidão', local: 'Base operacional', fixa: true },
                { ini: JAN_INI, fim: JAN_FIM, atividade: 'Janta e Prontidão', local: 'Base operacional', fixa: true },
                { ini: FIM_NOITE, fim: ALV_INI, atividade: 'Descanso / Prontidão', local: 'Base operacional', fixa: true },
            ];
            // Janelas de patrulha (recebem os PBs conforme o turno de cada um):
            janelas = [
                { ini: Math.min(ini, ALM_INI), fim: ALM_INI, turno: 'manha' },  // manhã: início → 13:00
                { ini: ALM_FIM, fim: JAN_INI, turno: 'tarde' },                 // tarde: 16:30 → 19:00
                { ini: JAN_FIM, fim: FIM_NOITE, turno: 'noite' },               // noite: 20:00 → 00:00
                { ini: ALV_INI, fim: ALV_FIM, turno: 'manha', rotulo: 'Operação Alvorada — Patrulhamento' }, // 05:00 → 07:00
            ].filter(w => w.fim > w.ini);
        }
        // Top pontos da mancha criminal (bairros/areas mais criticos) — usados
        // pra nomear as rotas de patrulhamento, como no gerarcartao.
        const topCrit = agrupar(PTS, 350).slice(0, 4).map(c => c.bairro).filter(Boolean);
        const manchaLocal = topCrit.length ? topCrit.join(' · ') : 'Áreas críticas da cidade';
        const linhas = construirCartao(janelas, fixos, ordem, desl, manchaLocal);
        CARTAO = { cidade: $('cp-cidade').value, rp: ehPalmeira ? (RP_SEL || 'RP') : null, data: new Date().toLocaleDateString('pt-BR'), linhas, nPB: ordem.length };
        renderCartao();
        $('cp-cartao-card').style.display = ''; $('cp-imprimir').disabled = false;
        $('cp-status').textContent = `✅ Cartão gerado com ${ordem.length} PB(s)${ehPalmeira ? ' — esquema RP de Palmeira' : ''}.`;
        $('cp-cartao-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function renderCartao() {
        const C = CARTAO;
        const corpo = C.linhas.map(l => {
            const critCel = l.crit ? `<span class="cp-crit ${l.crit}">${l.crit === 'alta' ? 'Alta' : l.crit === 'media' ? 'Média' : 'Baixa'}</span>` : (l.fixa ? '—' : '');
            return `<tr class="${l.fixa ? 'fixa' : ''}"><td style="white-space:nowrap"><b>${hm(l.ini)} – ${hm(l.fim)}</b></td><td>${esc(l.atividade)}</td><td>${esc(l.local)}</td><td>${critCel}</td></tr>`;
        }).join('');
        // Nome da unidade SEM o "(PADRAO EMBUTIDO NO SISTEMA)" (tira o parentese).
        const nomeBruto = (window.P3_CONFIG && window.P3_CONFIG.nome) || '10º Batalhão de Polícia Militar';
        const nomeUnid = nomeBruto.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
        const dias = $('cp-dias') ? $('cp-dias').value : '90';
        const sessao = (window.P3 && P3.getSession) ? P3.getSession() : null;
        const usuario = sessao ? ([sessao.graduacao, sessao.nomeGuerra || sessao.nome].filter(Boolean).join(' ') || 'usuário do sistema') : 'usuário do sistema';
        const agora = new Date().toLocaleString('pt-BR');
        $('cp-cartao').innerHTML = `
          <div class="cp-doc">
            <div class="cp-doc-head">
              <img src="https://pm.al.gov.br/joomgallery/image?view=image&format=raw&type=orig&id=84" alt="Brasão PMAL" onerror="this.style.display='none'">
              <div class="cp-doc-titulo">
                <h2>CARTÃO PROGRAMA — PB + RONDAS NO ENTORNO</h2>
                <h4>${esc(nomeUnid)}</h4>
              </div>
              <div class="cp-doc-meta"><b>DATA:</b> ${esc(C.data)}<br><b>CIDADE:</b> ${esc(C.cidade)}<br><b>GU:</b> ${esc(C.rp || '—')}</div>
            </div>
            <table><thead><tr><th>Horário</th><th>Atividade</th><th>Local / Bairros de patrulhamento</th><th>Criticidade</th></tr></thead><tbody>${corpo}</tbody></table>
            <div class="cp-assinatura">
              <div class="linha"></div>
              <strong>JONATA APOLINARIO CALHEIROS - 1º TEN QOEM PM</strong><br>Chefe da P3/10º BPM
            </div>
            <div class="cp-orient">
              <p>*Cartão gerado com base nos últimos ${esc(dias)} dias. Prioridade: gravidade das ocorrências (CVLI×5, droga×4, CVP×3) sobre quantidade — locais ordenados por gravidade criminal; sem ocorrências graves, usa o critério de quantidade.</p>
              <p>**Cada Ponto Base (PB) tem permanência de <b>45 min com rondas no entorno</b>; entre os PBs, patrulhar pela mancha criminal.</p>
              <p>***As guarnições deverão dar preferência ao cumprimento das OPOs de maior prioridade.</p>
              <p>****Em caso de ocorrências em andamento, priorizar o atendimento emergencial.</p>
              <br><strong>SEÇÃO DE PLANEJAMENTO, INSTRUÇÃO E ESTATÍSTICA - P3/10º BPM</strong>
            </div>
            <div class="cp-gerado">Gerado em ${esc(agora)} por ${esc(usuario)}</div>
          </div>`;
    }

    // ── Modos ──────────────────────────────────────────────────────────
    function setModo(m) {
        modoAtual = m;
        ['auto', 'cadastrar', 'carregar'].forEach(x => $('cp-modo-' + x).classList.toggle('ativo', x === m));
        $('cp-editor-cadastrar').classList.toggle('aberto', m === 'cadastrar');
        $('cp-editor-carregar').classList.toggle('aberto', m === 'carregar');
        if (m === 'auto') gerarAutomatico();
        else if (m === 'carregar') listarSalvos();
    }

    // ── Cidades: todas as de Alagoas (IBGE) + as da base ───────────────
    async function carregarCidades() {
        let doIbge = [];
        try {
            const cache = JSON.parse(localStorage.getItem('cp_cidades_al') || 'null');
            if (cache && Date.now() - cache.ts < 30 * 864e5) doIbge = cache.lista;
            else {
                const r = await fetch('https://brasilapi.com.br/api/ibge/municipios/v1/AL');
                if (r.ok) { doIbge = (await r.json()).map(m => m.nome.toUpperCase()); localStorage.setItem('cp_cidades_al', JSON.stringify({ ts: Date.now(), lista: doIbge })); }
            }
        } catch (e) { /* segue so com as da base */ }
        const daBase = (await no('geral')).map(o => val(o.CIDADE)).filter(Boolean).map(c => c.toUpperCase());
        const set = new Map();
        daBase.concat(doIbge).forEach(c => { const k = NORM(c); if (c && !set.has(k)) set.set(k, c); });
        CIDADES = [...set.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
        $('cp-cidade').innerHTML = '<option value="">— Selecione a cidade —</option>' + CIDADES.map(c => `<option>${esc(c)}</option>`).join('');
    }

    // ── Inicializacao ──────────────────────────────────────────────────
    async function iniciar() {
        CFG = await P3.loadUnidadeConfig();
        DB = CFG.firebase.databaseURL;
        MAPA = L.map('cp-mapa').setView([-9.41, -36.63], 11);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(MAPA);
        MAPA.on('click', e => {
            if (!modoAlfinete) return;
            modoAlfinete = false; $('cp-add-pin').classList.remove('ativo'); MAPA.getContainer().style.cursor = '';
            addPorPin(e.latlng.lat, e.latlng.lng);
        });
        await carregarCidades();

        $('cp-cidade').addEventListener('change', async () => {
            PBS = []; CARTAO = null; $('cp-cartao-card').style.display = 'none'; $('cp-imprimir').disabled = true;
            const ehPalmeira = NORM($('cp-cidade').value) === 'PALMEIRA DOS INDIOS';
            $('cp-rp-wrap').style.display = ehPalmeira ? '' : 'none';
            RP_SEL = ehPalmeira ? ($('cp-rp').value || 'RP 01') : null;
            $('cp-status').textContent = '⏳ Carregando mancha criminal da cidade…';
            await garantirCrime();
            $('cp-status').textContent = $('cp-cidade').value ? `${PTS.length} ocorrência(s) georreferenciada(s) na cidade.` : '';
            renderTudo();
            if (modoAtual === 'carregar') listarSalvos();
        });
        $('cp-rp').addEventListener('change', () => { RP_SEL = $('cp-rp').value; if (modoAtual === 'carregar') listarSalvos(); });
        ['cp-modo-auto', 'cp-modo-cadastrar', 'cp-modo-carregar'].forEach(id => $(id).onclick = () => {
            if (!$('cp-cidade').value) { alert('Escolha a cidade primeiro.'); return; }
            setModo($(id).dataset.modo);
        });
        $('cp-add-rua-btn').onclick = addPorRua;
        $('cp-add-rua').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addPorRua(); } });
        $('cp-add-coord-btn').onclick = addPorCoord;
        $('cp-add-pin').onclick = () => {
            modoAlfinete = !modoAlfinete; $('cp-add-pin').classList.toggle('ativo', modoAlfinete);
            MAPA.getContainer().style.cursor = modoAlfinete ? 'crosshair' : '';
            $('cp-add-msg').textContent = modoAlfinete ? '📍 Clique no mapa no local do PB…' : '';
        };
        $('cp-salvar-btn').onclick = salvarPBs;
        $('cp-carregar-btn').onclick = carregarSelecionado;
        $('cp-gerar').onclick = gerarCartao;
        $('cp-imprimir').onclick = () => window.print();
        $('cp-imprimir2').onclick = () => window.print();
        $('cp-pb-lista').addEventListener('click', e => {
            const b = e.target.closest('button[data-cp]'); if (!b) return;
            const i = +b.dataset.i;
            if (b.dataset.cp === 'up') moverPB(i, -1);
            else if (b.dataset.cp === 'down') moverPB(i, 1);
            else if (b.dataset.cp === 'del') removerPB(i);
        });
        $('cp-pb-lista').addEventListener('change', e => {
            const s = e.target.closest('select[data-cp="turno"]'); if (!s) return;
            if (PBS[+s.dataset.i]) PBS[+s.dataset.i].turno = s.value; // nao re-renderiza (mantem o foco)
        });
        setTimeout(() => MAPA.invalidateSize(), 200);
    }

    document.addEventListener('DOMContentLoaded', () => {
        const s = (window.P3 && P3.requireAuth) ? P3.requireAuth() : true;
        if (s === null) return;
        iniciar().catch(e => { const st = $('cp-status'); if (st) st.textContent = '⚠️ ' + e.message; console.error('[cartao-programa-pb]', e); });
    });
})();
