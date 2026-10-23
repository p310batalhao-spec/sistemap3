// ═══════════════════════════════════════════════════════════════════
// MAPA DE INTELIGÊNCIA — CAMADA DE ALVOS (Ficha Alvo do ExchelonX)
// page/mapaInteligencia.html = cópia do dashboard-mapa (js/mapa-Dashboard-P3.js)
// + este módulo, carregado DEPOIS dele (usa os globais _mapaL, FB_BASE,
// CAMADAS_CONFIG, _dadosMapa, _camadasAtivas, _pontoDentroPoligono, norm, esc…).
//
//  · Fonte: Supabase do ExchelonX (mesmo banco/chave de js/inteligenciaCriminal.js):
//      tb_pessoas (+ tb_pessoa_apelidos), tb_residencias → tb_enderecos
//      (+ tb_bairros/tb_cidades/tb_estados), tb_pessoa_vinculos,
//      tb_faccao_pessoas/tb_faccoes, tb_orcrim_pessoas/tb_orcrim, tb_imagens (foto).
//  · Coordenada: usa a cadastrada no endereço (ou a do link do Google Maps);
//    se faltar ou for inválida (fora de Alagoas, zerada, "-9,-36", invertida),
//    localiza pelo ENDEREÇO (OpenStreetMap/Nominatim: rua+nº → rua → bairro →
//    cidade) e guarda o resultado em Firebase /alvos_geocode/<enderecoId>
//    (cada endereço é localizado uma única vez para todos os usuários).
//  · Clique no ponto → alvo, endereço, facção/ORCRIM e VÍNCULOS (com linhas no
//    mapa até os endereços dos vinculados).
//  · Polígono → seleção das ocorrências E dos alvos dentro da região, com
//    caixas de marcação, e o relatório da região passa a incluir os alvos.
// ═══════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    // Mesmo banco/chave de js/inteligenciaCriminal.js e do mapa anterior (ver comentário lá).
    const SB_URL = 'https://zxynbnnooauasmasgzxp.supabase.co';
    const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp4eW5ibm5vb2F1YXNtYXNnenhwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjg0ODE2NSwiZXhwIjoyMDg4NDI0MTY1fQ.f7CldsqEQdSsGGptzjgQiBVElKjNIyzu3ZHO9wHeQ94';
    const NO_GEO = 'alvos_geocode';
    const COR = '#d50000';
    const SUBTIPO = { irmao_de: 'irmão(ã)', pai_de: 'pai/mãe de', filho_de: 'filho(a) de', mae_de: 'mãe de', conjuge_de: 'cônjuge', companheiro_de: 'companheiro(a)', primo_de: 'primo(a)', tio_de: 'tio(a)', sobrinho_de: 'sobrinho(a)', amigo_de: 'amigo(a)', comparsa_de: 'comparsa', socio_de: 'sócio(a)' };

    const A = { pessoas: {}, enderecos: [], porPessoa: {}, camada: null, linhas: null, destaque: null, visivel: true, carregado: false, fila: [], geoCache: {}, consultas: {}, geocodificando: false };
    window.MapaAlvos = A;

    const $ = id => document.getElementById(id);
    const e = s => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
    const limpo = v => { const s = String(v == null ? '' : v).trim(); return s && s !== '---' ? s : ''; };
    const N = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

    async function sb(tabela, query) {
        const out = [];
        for (let off = 0; off < 20000; off += 1000) {
            const r = await fetch(`${SB_URL}/rest/v1/${tabela}?${query || 'select=*'}`, { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, Range: `${off}-${off + 999}` } });
            if (!r.ok) throw new Error(`${tabela}: HTTP ${r.status}`);
            const d = await r.json();
            out.push(...d);
            if (d.length < 1000) break;
        }
        return out;
    }
    const sbOpc = (t, q) => sb(t, q).catch(err => { console.warn('[alvos]', t, err.message); return []; });
    async function assinarFoto(caminho) {
        try {
            const r = await fetch(`${SB_URL}/storage/v1/object/sign/midia/${caminho}`, { method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600 }) });
            const j = r.ok ? await r.json() : null;
            return j && j.signedURL ? `${SB_URL}/storage/v1${j.signedURL}` : null;
        } catch (err) { return null; }
    }

    // ── Coordenadas ──────────────────────────────────────────────────
    const dentroAL = (lat, lng) => lat > -10.6 && lat < -8.7 && lng > -38.4 && lng < -35.0;
    function coordValidaAlvo(lat, lng) {
        const a = parseFloat(String(lat == null ? '' : lat).replace(',', '.')), b = parseFloat(String(lng == null ? '' : lng).replace(',', '.'));
        if (isNaN(a) || isNaN(b) || !a || !b) return null;
        if (Number.isInteger(a) && Number.isInteger(b)) return null; // "-9,-36": valor genérico, não é ponto real
        if (dentroAL(a, b)) return { lat: a, lng: b };
        if (dentroAL(b, a)) return { lat: b, lng: a }; // latitude e longitude invertidas
        return null;
    }
    function coordDoLink(link) {
        const m = String(link || '').match(/(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/);
        return m ? coordValidaAlvo(m[1], m[2]) : null;
    }

    // ── Carga ────────────────────────────────────────────────────────
    async function carregar() {
        status('⏳ Carregando alvos do ExchelonX…');
        const [pessoas, apelidos, residencias, enderecos, bairros, cidades, estados, vinculos, fp, fac, op, orc, imagens, geo] = await Promise.all([
            sb('tb_pessoas', 'select=id,nome_completo,cpf,data_nascimento,nome_mae,rg'),
            sbOpc('tb_pessoa_apelidos', 'select=pessoa_id,apelido'),
            sb('tb_residencias', 'select=id,pessoa_id,endereco_id,is_principal,descricao_completa,fonte_endereco'),
            sb('tb_enderecos', 'select=*'),
            sbOpc('tb_bairros', 'select=id,nome'), sbOpc('tb_cidades', 'select=id,nome,estado_id'), sbOpc('tb_estados', 'select=id,sigla'),
            sbOpc('tb_pessoa_vinculos', 'select=*'),
            sbOpc('tb_faccao_pessoas', 'select=*'), sbOpc('tb_faccoes', 'select=id,nome'),
            sbOpc('tb_orcrim_pessoas', 'select=*'), sbOpc('tb_orcrim', 'select=id,nome'),
            sbOpc('tb_imagens', 'select=pessoa_id,thumb_path,webp_path,arquivo_path,is_principal,entidade_tipo&entidade_tipo=eq.pessoa'),
            FB_BASE ? fetch(`${FB_BASE}/${NO_GEO}.json`).then(r => r.ok ? r.json() : null).catch(() => null) : null,
        ]);
        A.geoCache = geo || {};
        const idx = (l, k = 'id') => Object.fromEntries(l.map(x => [String(x[k]), x]));
        const iB = idx(bairros), iC = idx(cidades), iE = idx(estados), iEnd = idx(enderecos), iFac = idx(fac), iOrc = idx(orc);
        pessoas.forEach(p => { A.pessoas[p.id] = { id: p.id, nome: limpo(p.nome_completo) || '(sem nome)', cpf: limpo(p.cpf), nasc: limpo(p.data_nascimento), mae: limpo(p.nome_mae), rg: limpo(p.rg), apelidos: [], grupos: [], vinculos: [], fotos: [] }; });
        apelidos.forEach(a => { const p = A.pessoas[a.pessoa_id]; if (p && limpo(a.apelido)) p.apelidos.push(limpo(a.apelido)); });
        fp.forEach(v => { const p = A.pessoas[v.pessoa_id], g = iFac[String(v.faccao_id)]; if (p && g) p.grupos.push({ nome: g.nome, tipo: 'Facção', funcao: limpo(v.funcao) }); });
        op.forEach(v => { const p = A.pessoas[v.pessoa_id], g = iOrc[String(v.orcrim_id)]; if (p && g) p.grupos.push({ nome: g.nome, tipo: 'ORCRIM', funcao: limpo(v.funcao) }); });
        vinculos.filter(v => v.ativo !== false).forEach(v => {
            const o = A.pessoas[v.pessoa_origem_id], d = A.pessoas[v.pessoa_destino_id];
            const tipo = limpo(v.tipo_vinculo) || 'vínculo', sub = limpo(v.subtipo_vinculo);
            if (o) o.vinculos.push({ id: v.pessoa_destino_id, tipo, sub, dir: 'origem', obs: limpo(v.observacao), conf: limpo(v.nivel_confianca) });
            if (d) d.vinculos.push({ id: v.pessoa_origem_id, tipo, sub, dir: 'destino', obs: limpo(v.observacao), conf: limpo(v.nivel_confianca) });
        });
        imagens.sort((a, b) => (b.is_principal ? 1 : 0) - (a.is_principal ? 1 : 0)).forEach(i => { const p = A.pessoas[i.pessoa_id]; if (p) p.fotos.push(i.thumb_path || i.webp_path || i.arquivo_path); });

        residencias.forEach(r => {
            const p = A.pessoas[r.pessoa_id]; const en = iEnd[String(r.endereco_id)];
            if (!p || !en) return;
            const cid = iC[String(en.cidade_id)] || {}, uf = (iE[String(en.estado_id || cid.estado_id)] || {}).sigla || 'AL';
            let tl = limpo(en.tipo_logradouro), lg = limpo(en.logradouro);
            if (tl && lg && N(lg).startsWith(N(tl) + ' ')) tl = '';
            const logradouro = [tl, lg].filter(Boolean).join(' ');
            const numero = limpo(en.numero), bairro = limpo((iB[String(en.bairro_id)] || {}).nome), cidade = limpo(cid.nome);
            const texto = [logradouro + (numero ? ', ' + numero : ''), limpo(en.complemento), bairro, [cidade, uf].filter(Boolean).join('/')].filter(Boolean).join(' - ').toUpperCase();
            const item = { residenciaId: r.id, enderecoId: en.id, pessoaId: p.id, principal: !!r.is_principal, logradouro, numero, bairro, cidade, uf, texto: texto || limpo(r.descricao_completa).toUpperCase(),
                referencia: limpo(en.ponto_referencia), descricao: limpo(r.descricao_completa), lat: null, lng: null, fonte: null, precisao: null };
            const c = coordValidaAlvo(en.latitude, en.longitude) || coordDoLink(en.link_localizacao);
            const cache = A.geoCache[en.id];
            if (c) Object.assign(item, c, { fonte: 'cadastrada', precisao: 'exata' });
            else if (cache && cache.lat) Object.assign(item, { lat: cache.lat, lng: cache.lng, fonte: 'endereço', precisao: cache.precisao || 'rua' });
            else if (cidade || bairro || logradouro) A.fila.push(item);
            item.coordOriginal = limpo(en.latitude) ? `${en.latitude}, ${en.longitude}` : '';
            A.enderecos.push(item);
            (A.porPessoa[p.id] = A.porPessoa[p.id] || []).push(item);
        });
        A.carregado = true;
        status('');
        const qs = new URLSearchParams(location.search), idUrl = qs.get('alvo');
        if (idUrl && A.pessoas[idUrl]) setTimeout(() => {
            const acao = qs.get('acao');
            if (acao === 'ocorrencias') ocorrenciasAlvo(idUrl);
            else if (acao === 'rede') focarRede(idUrl, 1);
            else { const e0 = (A.porPessoa[idUrl] || []).find(x => x.lat != null); if (e0) irPara(e0.residenciaId); }
        }, 600);
        renderCamada();
        renderPainel();
        if (A.fila.length) geocodificarFila();
    }

    // ── Geocodificação pelo endereço (Nominatim, 1 consulta/s) ──────
    async function nominatim(q) {
        if (q in A.consultas) return A.consultas[q];
        await new Promise(r => setTimeout(r, 1100));
        try {
            const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=3&countrycodes=br&accept-language=pt-BR&q=${encodeURIComponent(q)}`);
            const d = r.ok ? await r.json() : [];
            const ok = d.map(x => ({ lat: +x.lat, lng: +x.lon })).find(x => dentroAL(x.lat, x.lng)) || null;
            return (A.consultas[q] = ok);
        } catch (err) { return (A.consultas[q] = null); }
    }
    async function geocodificarFila() {
        if (A.geocodificando) return;
        A.geocodificando = true;
        const total = A.fila.length;
        let feitos = 0;
        while (A.fila.length) {
            const it = A.fila.shift();
            const cid = it.cidade ? `${it.cidade}, Alagoas, Brasil` : 'Alagoas, Brasil';
            const tentativas = [];
            if (it.logradouro && !/^(S\/?N|SN)$/i.test(it.logradouro)) {
                if (it.numero && /\d/.test(it.numero)) tentativas.push([`${it.logradouro}, ${it.numero}, ${it.bairro ? it.bairro + ', ' : ''}${cid}`, 'endereço']);
                tentativas.push([`${it.logradouro}, ${it.bairro ? it.bairro + ', ' : ''}${cid}`, 'rua']);
                if (it.bairro) tentativas.push([`${it.logradouro}, ${cid}`, 'rua']);
            }
            if (it.bairro) tentativas.push([`${it.bairro}, ${cid}`, 'bairro']);
            if (it.cidade) tentativas.push([cid, 'cidade']);
            for (const [q, prec] of tentativas) {
                const c = await nominatim(q);
                if (c) {
                    Object.assign(it, c, { fonte: 'endereço', precisao: prec });
                    A.geoCache[it.enderecoId] = { lat: c.lat, lng: c.lng, precisao: prec, consulta: q, em: new Date().toISOString() };
                    if (FB_BASE) fetch(`${FB_BASE}/${NO_GEO}/${it.enderecoId}.json`, { method: 'PUT', body: JSON.stringify(A.geoCache[it.enderecoId]) }).catch(() => {});
                    break;
                }
            }
            feitos++;
            status(`🔎 Localizando endereços sem coordenada: ${feitos}/${total}…`);
            if (feitos % 5 === 0 || !A.fila.length) { renderCamada(); renderPainel(); }
        }
        A.geocodificando = false;
        status('');
        renderCamada(); renderPainel();
    }

    // ── Camada no mapa ───────────────────────────────────────────────
    const iniciais = nome => nome.split(/\s+/).filter(w => w.length > 2).slice(0, 2).map(w => w[0]).join('') || '?';
    function icone(end, destaque) {
        const p = A.pessoas[end.pessoaId], exata = end.precisao === 'exata' || end.precisao === 'endereço';
        const borda = destaque ? '3px solid #ffd600' : exata ? '2px solid #fff' : '2px dashed #fff';
        const fundo = p.grupos.length ? '#6a1b9a' : COR;
        return L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15],
            html: `<div title="${e(p.nome)}" style="width:30px;height:30px;border-radius:50%;background:${fundo};border:${borda};box-shadow:0 2px 8px rgba(0,0,0,.55);color:#fff;font:800 11px Arial;display:grid;place-items:center;${exata ? '' : 'opacity:.85;'}">${e(iniciais(p.nome))}</div>` });
    }
    function renderCamada() {
        if (typeof _mapaL === 'undefined' || !_mapaL || !A.carregado) return;
        if (!A.camada) {
            A.camada = L.markerClusterGroup ? L.markerClusterGroup({ maxClusterRadius: 28, spiderfyOnMaxZoom: true, showCoverageOnHover: false, disableClusteringAtZoom: 17,
                iconCreateFunction: c => L.divIcon({ className: '', iconSize: [34, 34], html: `<div style="width:34px;height:34px;border-radius:50%;background:${COR};border:3px solid #fff;color:#fff;font:800 12px Arial;display:grid;place-items:center;box-shadow:0 2px 8px rgba(0,0,0,.5);">🎯${c.getChildCount()}</div>` }) }) : L.layerGroup();
        }
        A.camada.clearLayers();
        const filtro = N(($('alvo-busca') || {}).value || '');
        A.enderecos.filter(x => x.lat != null).forEach(end => {
            const p = A.pessoas[end.pessoaId];
            if (filtro && !N([p.nome, p.cpf, ...p.apelidos, ...p.grupos.map(g => g.nome), end.texto].join(' ')).includes(filtro)) return;
            const mk = L.marker([end.lat, end.lng], { icon: icone(end), zIndexOffset: 800 });
            mk.bindPopup(() => popupAlvo(end), { maxWidth: 380, minWidth: 300 });
            mk.on('popupopen', () => carregarFotoPopup(end));
            end._mk = mk;
            A.camada.addLayer(mk);
        });
        const mostrar = A.visivel && !(A.foco && A.foco.ativo); // no modo foco os demais alvos saem do mapa
        if (mostrar && !_mapaL.hasLayer(A.camada)) A.camada.addTo(_mapaL);
        if (!mostrar && _mapaL.hasLayer(A.camada)) _mapaL.removeLayer(A.camada);
    }

    // ── Popup do alvo: dados + vínculos ──────────────────────────────
    const fonteTxt = end => end.precisao === 'exata' ? '📍 coordenada cadastrada no ExchelonX'
        : end.precisao === 'endereço' ? '🔎 localizado pelo endereço (rua e número)'
        : end.precisao === 'rua' ? '🔎 localizado pelo endereço (rua) — aproximado'
        : end.precisao === 'bairro' ? '≈ centro do bairro — endereço não localizado com precisão'
        : '≈ centro da cidade — endereço não localizado com precisão';
    function popupAlvo(end) {
        const p = A.pessoas[end.pessoaId];
        const outros = (A.porPessoa[p.id] || []).filter(x => x !== end);
        const vinc = p.vinculos.map(v => {
            const o = A.pessoas[v.id] || { nome: '(pessoa não encontrada)' };
            const ends = (A.porPessoa[v.id] || []).filter(x => x.lat != null);
            const rel = SUBTIPO[v.sub] || (v.sub || v.tipo || '').replace(/_/g, ' ');
            return `<div class="al-vinc">
                <div><b>${e(o.nome)}</b>${o.apelidos && o.apelidos.length ? ` <i>“${e(o.apelidos[0])}”</i>` : ''}<br><small>${e(v.tipo)}${rel ? ' · ' + e(rel) : ''}${v.conf ? ' · confiança ' + e(v.conf) : ''}</small>${v.obs ? `<br><small>${e(v.obs)}</small>` : ''}</div>
                ${ends.length ? `<button onclick="MapaAlvos.irPara('${ends[0].residenciaId}')" title="Ir para o endereço">📍</button>` : '<span title="Sem endereço no mapa" style="opacity:.4">—</span>'}
            </div>`;
        }).join('');
        return `<div class="al-pop">
            <div class="al-topo"><div class="al-foto" id="al-foto-${end.residenciaId}">${e(iniciais(p.nome))}</div>
                <div><div class="al-nome">🎯 ${e(p.nome)}</div>${p.apelidos.length ? `<div class="al-ap">Vulgo: ${p.apelidos.map(e).join(', ')}</div>` : ''}
                <div class="al-meta">${[p.cpf && 'CPF ' + e(p.cpf), p.nasc && 'Nasc. ' + e(String(p.nasc).split('-').reverse().join('/'))].filter(Boolean).join(' · ')}</div>
                ${p.mae ? `<div class="al-meta">Mãe: ${e(p.mae)}</div>` : ''}</div></div>
            ${p.grupos.length ? `<div class="al-grupos">${p.grupos.map(g => `<span>${g.tipo === 'ORCRIM' ? '🕸' : '⚑'} ${e(g.nome)}${g.funcao ? ' — ' + e(g.funcao) : ''}</span>`).join('')}</div>` : ''}
            <div class="al-sec">🏠 Endereço${end.principal ? ' (principal)' : ''}</div>
            <div class="al-end">${e(end.texto || '—')}${end.referencia ? `<br><small>Ref.: ${e(end.referencia)}</small>` : ''}</div>
            <div class="al-fonte">${fonteTxt(end)}${end.coordOriginal && end.precisao !== 'exata' ? `<br>coordenada cadastrada ignorada (inválida): ${e(end.coordOriginal)}` : ''}</div>
            <div class="al-links"><a href="https://www.google.com/maps?q=${end.lat},${end.lng}" target="_blank" rel="noopener">Google Maps</a>
                ${outros.length ? outros.map((o, i) => o.lat != null ? `<a href="#" onclick="MapaAlvos.irPara('${o.residenciaId}');return false;">Outro endereço ${i + 1}</a>` : `<span title="${e(o.texto)}">Outro endereço ${i + 1} (sem localização)</span>`).join('') : ''}</div>
            <div class="al-acoes"><button class="al-mini" onclick="MapaAlvos.abrirRelint('${p.id}')" title="Abre o Relatório de Inteligência com a ficha e a busca do CAD já preenchidas">📝 Gerar RELINT</button><button class="al-mini" onclick="MapaAlvos.ocorrenciasAlvo('${p.id}')">🔎 Ocorrências no CAD</button>${p.vinculos.length ? `<button class="al-mini" onclick="MapaAlvos.focarRede('${p.id}')">🕸 Mostrar rede no mapa</button>` : ''}</div>
            <div class="al-sec">🕸 Vínculos (${p.vinculos.length})</div>
            <div class="al-vincs">${vinc || '<div class="al-meta">Nenhum vínculo cadastrado.</div>'}</div>
        </div>`;
    }
    async function carregarFotoPopup(end) {
        const p = A.pessoas[end.pessoaId];
        if (!p.fotos.length) return;
        if (!p._fotoUrl) p._fotoUrl = await assinarFoto(p.fotos[0]);
        const el = $('al-foto-' + end.residenciaId);
        if (el && p._fotoUrl) el.innerHTML = `<img src="${p._fotoUrl}" alt="">`;
    }
    // Linhas do endereço do alvo até os endereços de cada vinculado
    function mostrarRede(pessoaId, enquadrar) {
        if (A.linhas) { _mapaL.removeLayer(A.linhas); A.linhas = null; }
        const p = A.pessoas[pessoaId]; if (!p) return;
        const origem = (A.porPessoa[pessoaId] || []).find(x => x.lat != null); if (!origem) return;
        A.linhas = L.layerGroup().addTo(_mapaL);
        const pts = [[origem.lat, origem.lng]];
        p.vinculos.forEach(v => {
            const d = (A.porPessoa[v.id] || []).find(x => x.lat != null); if (!d) return;
            const o = A.pessoas[v.id];
            L.polyline([[origem.lat, origem.lng], [d.lat, d.lng]], { color: '#ffd600', weight: 2.5, dashArray: '6 5', opacity: .9 })
                .bindTooltip(`${p.nome} ↔ ${o.nome} (${SUBTIPO[v.sub] || v.sub || v.tipo})`, { sticky: true }).addTo(A.linhas);
            L.circleMarker([d.lat, d.lng], { radius: 18, color: '#ffd600', weight: 3, fill: false }).addTo(A.linhas);
            pts.push([d.lat, d.lng]);
        });
        if (enquadrar && pts.length > 1) { _mapaL.closePopup(); _mapaL.fitBounds(pts, { padding: [60, 60], maxZoom: 16 }); }
    }
    function irPara(residenciaId) {
        const end = A.enderecos.find(x => String(x.residenciaId) === String(residenciaId));
        if (!end || end.lat == null) return;
        _mapaL.closePopup();
        if (A.camada && A.camada.zoomToShowLayer && end._mk && A.camada.hasLayer(end._mk)) A.camada.zoomToShowLayer(end._mk, () => end._mk.openPopup());
        else { _mapaL.setView([end.lat, end.lng], 17); end._mk && end._mk.openPopup(); }
    }

    // ── MODO FOCO: só o alvo escolhido, os vinculados e/ou as ocorrências dele ──
    // Esconde os demais alvos e as camadas de ocorrências do mapa; uma barra no
    // topo do mapa resume e permite sair (restaura tudo como estava).
    const F = { ativo: false, pessoaId: null, rede: null, ocs: null, info: null };
    A.foco = F;
    function barraFoco() {
        let b = $('al-foco');
        if (!b) {
            b = document.createElement('div'); b.id = 'al-foco';
            ($('mapa-wrapper') || document.body).appendChild(b);
        }
        return b;
    }
    function entrarFoco(pessoaId) {
        if (F.ativo && F.pessoaId === pessoaId) return;
        if (F.ativo) limparCamadasFoco();
        F.ativo = true; F.pessoaId = pessoaId; F.info = { rede: null, ocs: null };
        _mapaL.closePopup();
        if (A.linhas) { _mapaL.removeLayer(A.linhas); A.linhas = null; }
        if (A.camada && _mapaL.hasLayer(A.camada)) _mapaL.removeLayer(A.camada);
        if (typeof _ocultarCamadasNormais === 'function') _ocultarCamadasNormais();
        renderBarraFoco();
    }
    function limparCamadasFoco() {
        ['rede', 'ocs'].forEach(k => { if (F[k]) { _mapaL.removeLayer(F[k]); F[k] = null; } });
    }
    function sairFoco() {
        limparCamadasFoco();
        F.ativo = false; F.pessoaId = null; F.info = null;
        const b = $('al-foco'); if (b) b.style.display = 'none';
        if (typeof _restaurarCamadasNormais === 'function') _restaurarCamadasNormais();
        renderCamada();
    }
    function renderBarraFoco() {
        const b = barraFoco(), p = A.pessoas[F.pessoaId]; if (!p) return;
        const r = F.info.rede, o = F.info.ocs;
        b.style.display = 'block';
        b.innerHTML = `<div class="al-foco-l1"><b>🎯 ${e(p.nome)}</b>${p.apelidos.length ? ` “${e(p.apelidos[0])}”` : ''}
                <button class="al-mini" onclick="MapaAlvos.focarRede('${p.id}', 1)">🕸 Vínculos${r ? ` (${r.total})` : ''}</button>
                ${r ? `<button class="al-mini${r.grau > 1 ? ' on' : ''}" onclick="MapaAlvos.focarRede('${p.id}', ${r.grau > 1 ? 1 : 2})" title="Inclui os vínculos dos vinculados">${r.grau > 1 ? '◀ Só 1º grau' : '➕ 2º grau'}</button>` : ''}
                <button class="al-mini" onclick="MapaAlvos.ocorrenciasAlvo('${p.id}')">🔎 Ocorrências no CAD${o && o.fim ? ` (${o.noMapa} no mapa)` : ''}</button>
                <button class="al-mini" onclick="MapaAlvos.abrirRelint('${p.id}')">📝 Gerar RELINT</button>
                <button class="al-mini al-sair" onclick="MapaAlvos.sairFoco()">✕ Sair do foco</button></div>
            ${r ? `<div class="al-foco-leg">${Object.values(TIPO_VINC).map(t => `<span><i style="border-top:3px ${t.traco ? 'dashed' : 'solid'} ${t.cor}"></i>${t.rot}</span>`).join('')}<span>espessura = confiança</span><span>${r.nos} pessoa(s) na rede</span></div>` : ''}
            ${r && r.semOrigem ? `<div class="al-foco-l2">⚠️ O próprio alvo não tem endereço localizado no mapa — a rede aparece a partir dos vinculados.</div>` : ''}
            ${r && r.semEndereco.length ? `<div class="al-foco-l2">Sem endereço cadastrado (posicionados em órbita, borda tracejada): ${r.semEndereco.map(e).join(' · ')}</div>` : ''}
            ${o ? `<div class="al-foco-l2">${o.msg}</div>` : ''}
            ${o && o.lista && o.lista.length ? `<details class="al-foco-det"><summary>Ver lista das ocorrências (${o.lista.length})</summary><div>${o.lista.map((x, i) => `
                <div class="al-foco-oc${x.lat != null ? ' tem' : ''}" ${x.lat != null ? `onclick="MapaAlvos.irOcorrencia(${i})"` : ''}>
                <b>${e(x.data || '—')}</b> · ${e(x.natureza || '—')}${x.envolvimento ? ` · <i>${e(x.envolvimento)}</i>` : ''}<br>
                <small>BO ${e(x.boletim || '—')}${x.local ? ' · ' + e(x.local) : ''} · ${x.lat != null ? '📍 no mapa' : 'sem localização'} · ${e(x.fonte)}</small></div>`).join('')}</div></details>` : ''}`;
    }
    const iconePessoa = (p, cor, rot, grande, tracejado) => L.divIcon({ className: '', iconSize: null, iconAnchor: [grande ? 22 : 17, grande ? 22 : 17],
        html: `<div class="al-pin" style="--c:${cor}"><span style="width:${grande ? 44 : 34}px;height:${grande ? 44 : 34}px;${grande ? 'border-color:#ffd600;border-width:4px;' : ''}${tracejado ? 'border-style:dashed;opacity:.85;' : ''}">${p._fotoUrl ? `<img src="${p._fotoUrl}" onerror="this.parentNode.textContent='${e(iniciais(p.nome))}'">` : e(iniciais(p.nome))}</span><em>${e(p.nome.split(' ').slice(0, 2).join(' '))}${rot ? `<br><small>${e(rot)}</small>` : ''}</em></div>` });
    // Estilo do vínculo por tipo (cor/traço) e confiança (espessura)
    const TIPO_VINC = {
        criminal: { cor: '#ff3d00', traco: null, rot: 'criminal' },
        familiar: { cor: '#ffd600', traco: '8 6', rot: 'familiar' },
        afetivo: { cor: '#f06292', traco: '2 6', rot: 'afetivo' },
        social: { cor: '#4fc3f7', traco: '10 4 2 4', rot: 'social' },
        outro: { cor: '#b0bec5', traco: '4 4', rot: 'outro' },
    };
    const estiloVinc = v => TIPO_VINC[N(v.tipo).toLowerCase()] || (/CRIM|COMPARS|FAC|ORCRIM|SUBORDIN|LIDER|GERENTE/.test(N(v.tipo + ' ' + v.sub)) ? TIPO_VINC.criminal
        : /FAMIL|IRMA|PAI|MAE|FILH|PRIM|TIO|SOBRIN|AVO|NET|CUNHAD|SOGR/.test(N(v.tipo + ' ' + v.sub)) ? TIPO_VINC.familiar
        : /CONJ|COMPANH|NAMOR|ESPOS|AFET/.test(N(v.tipo + ' ' + v.sub)) ? TIPO_VINC.afetivo : TIPO_VINC.outro);
    const pesoConf = c => /ALT/.test(N(c)) ? 5 : /BAIX/.test(N(c)) ? 2 : 3.5;
    // Arco (Bézier quadrática) entre dois pontos — vários vínculos não se sobrepõem
    function arco(a, b, curva) {
        const [la, lo] = a, [lb, lob] = b;
        const ml = (la + lb) / 2, mo = (lo + lob) / 2, dl = lb - la, dlo = lob - lo;
        const c = [ml - dlo * curva, mo + dl * curva];
        const pts = [];
        for (let t = 0; t <= 1.0001; t += 0.05) pts.push([(1 - t) ** 2 * la + 2 * (1 - t) * t * c[0] + t * t * lb, (1 - t) ** 2 * lo + 2 * (1 - t) * t * c[1] + t * t * lob]);
        return { pts, meio: pts[10] };
    }
    async function focarRede(pessoaId, grau) {
        grau = grau || (F.ativo && F.pessoaId === pessoaId && F.info && F.info.rede ? F.info.rede.grau : 1) || 1;
        entrarFoco(pessoaId);
        if (F.rede) { _mapaL.removeLayer(F.rede); F.rede = null; }
        const p = A.pessoas[pessoaId];
        // Nós da rede: o alvo (nível 0), os vinculados (nível 1) e, se pedido, os vínculos deles (nível 2)
        const nos = new Map([[pessoaId, { p, nivel: 0 }]]);
        let fronteira = [pessoaId];
        for (let g = 1; g <= grau; g++) {
            const prox = [];
            fronteira.forEach(id => (A.pessoas[id].vinculos || []).forEach(v => { if (A.pessoas[v.id] && !nos.has(v.id)) { nos.set(v.id, { p: A.pessoas[v.id], nivel: g }); prox.push(v.id); } }));
            fronteira = prox;
        }
        await Promise.all([...nos.values()].map(n => n.p).filter(x => x.fotos.length && !x._fotoUrl).slice(0, 40).map(x => assinarFoto(x.fotos[0]).then(u => { x._fotoUrl = u; })));
        F.rede = L.layerGroup().addTo(_mapaL);
        const origem = (A.porPessoa[pessoaId] || []).find(x => x.lat != null);
        // Posição de cada nó: endereço real; quem não tem endereço entra numa órbita ao redor de quem o vincula
        const usados = {}, pos = new Map(), semEndereco = [];
        // raio do espalhamento proporcional ao tamanho da rede (senão some quando a rede ocupa km)
        const reais = [...nos.keys()].map(id => (A.pessoas[id] && (A.porPessoa[id] || []).find(x => x.lat != null))).filter(Boolean);
        const diag = reais.length > 1 ? Math.hypot(Math.max(...reais.map(x => x.lat)) - Math.min(...reais.map(x => x.lat)), Math.max(...reais.map(x => x.lng)) - Math.min(...reais.map(x => x.lng))) : 0;
        const raioBase = Math.max(0.00035, diag * 0.08);
        const espalhar = (lat, lng) => {
            const k = (Math.round(lat / raioBase * 2) / 2) + ',' + (Math.round(lng / raioBase * 2) / 2), n = usados[k] = (usados[k] || 0) + 1;
            if (n === 1) return [lat, lng];
            const ang = (n - 2) * 2 * Math.PI / 6, r = raioBase * (1 + Math.floor((n - 2) / 6) * 0.7);
            return [lat + r * Math.cos(ang), lng + r * Math.sin(ang) / Math.cos(lat * Math.PI / 180)];
        };
        [...nos.entries()].sort((a, b) => a[1].nivel - b[1].nivel).forEach(([id, n]) => {
            const end = (A.porPessoa[id] || []).find(x => x.lat != null);
            if (end) pos.set(id, { ll: espalhar(end.lat, end.lng), end, real: true });
        });
        const semPos = [...nos.keys()].filter(id => !pos.has(id));
        semPos.forEach((id, i) => {
            const n = nos.get(id);
            const pai = [...nos.keys()].find(o => pos.has(o) && (A.pessoas[o].vinculos || []).some(v => v.id === id)) || (origem ? pessoaId : null);
            const base = pai && pos.get(pai) ? pos.get(pai).ll : origem ? [origem.lat, origem.lng] : null;
            if (!base) { semEndereco.push(n.p.nome); return; }
            const ang = (i / Math.max(semPos.length, 1)) * 2 * Math.PI + 0.4, r = Math.max(0.0035, diag * 0.12);
            pos.set(id, { ll: [base[0] + r * Math.cos(ang), base[1] + r * Math.sin(ang) / Math.cos(base[0] * Math.PI / 180)], end: null, real: false });
            semEndereco.push(n.p.nome);
        });
        // Arestas: todos os vínculos entre nós da rede (inclusive entre os vinculados)
        const vistos = new Set(), pts = [];
        let curvaIdx = 0;
        [...nos.keys()].forEach(id => (A.pessoas[id].vinculos || []).forEach(v => {
            if (!nos.has(v.id) || !pos.has(id) || !pos.has(v.id)) return;
            const chave = [id, v.id].sort().join('|') + '|' + v.tipo + '|' + v.sub;
            if (vistos.has(chave)) return; vistos.add(chave);
            const st = estiloVinc(v), rel = SUBTIPO[v.sub] || (v.sub || v.tipo || '').replace(/_/g, ' ');
            const direto = id === pessoaId || v.id === pessoaId;
            const curva = (curvaIdx++ % 2 ? -1 : 1) * (0.18 + (curvaIdx % 3) * 0.06);
            const a = arco(pos.get(id).ll, pos.get(v.id).ll, curva);
            const p1 = A.pessoas[id], p2 = A.pessoas[v.id];
            L.polyline(a.pts, { color: '#000', weight: pesoConf(v.conf) + 3, opacity: direto ? .35 : .2, interactive: false }).addTo(F.rede);
            L.polyline(a.pts, { color: st.cor, weight: pesoConf(v.conf), opacity: direto ? .95 : .6, dashArray: st.traco })
                .bindTooltip(`<b>${e(p1.nome)}</b> ↔ <b>${e(p2.nome)}</b><br>${e(st.rot)} · ${e(rel)}${v.conf ? ' · confiança ' + e(v.conf) : ''}${v.obs ? '<br>' + e(v.obs) : ''}`, { sticky: true }).addTo(F.rede);
            if (direto || grau > 1) L.marker(a.meio, { interactive: false, icon: L.divIcon({ className: '', iconSize: null, iconAnchor: [0, 8],
                html: `<div class="al-rel" style="--c:${st.cor}">${e(rel)}</div>` }) }).addTo(F.rede);
        }));
        // Nós
        let noMapa = 0;
        [...nos.entries()].forEach(([id, n]) => {
            const ps = pos.get(id); if (!ps) return;
            if (n.nivel === 1 && ps.real) noMapa++;
            const vRaiz = (p.vinculos || []).find(v => v.id === id);
            const rot = n.nivel === 0 ? 'ALVO' : (ps.real ? '' : 'sem endereço · ') + (vRaiz ? (SUBTIPO[vRaiz.sub] || vRaiz.sub || vRaiz.tipo) : '2º grau');
            const cor = n.nivel === 0 ? '#d50000' : vRaiz ? estiloVinc(vRaiz).cor : '#78909c';
            const mk = L.marker(ps.ll, { icon: iconePessoa(n.p, cor, rot, n.nivel === 0, !ps.real), zIndexOffset: 2000 - n.nivel * 300 }).addTo(F.rede);
            if (ps.end) mk.bindPopup(() => popupAlvo(ps.end), { maxWidth: 380, minWidth: 300 }).on('popupopen', () => carregarFotoPopup(ps.end));
            else mk.bindPopup(`<div class="al-pop"><div class="al-nome">${e(n.p.nome)}</div><div class="al-meta">Sem endereço cadastrado no ExchelonX — posicionado ao lado de quem o vincula.</div>
                ${n.p.vinculos.length ? `<div class="al-acoes"><button class="al-mini" onclick="MapaAlvos.focarRede('${id}')">🕸 Rede desta pessoa</button></div>` : ''}</div>`);
            pts.push(ps.ll);
        });
        F.info.rede = { total: p.vinculos.length, noMapa, semEndereco: semEndereco.filter(x => x !== p.nome), semOrigem: !origem, grau, nos: nos.size };
        renderBarraFoco();
        // margem extra à direita/abaixo: a legenda do mapa fica nesse canto
        if (pts.length) _mapaL.fitBounds(pts, { paddingTopLeft: [70, 130], paddingBottomRight: [260, 90], maxZoom: 16 });
    }

    // ── Ocorrências da pessoa: base da unidade (/autor) + CAD (Consulta Integrada) ──
    const digitos = s => String(s || '').replace(/\D/g, '');
    async function ocorrenciasAlvo(pessoaId) {
        entrarFoco(pessoaId);
        const p = A.pessoas[pessoaId];
        if (F.ocs) { _mapaL.removeLayer(F.ocs); F.ocs = null; }
        F.ocs = L.layerGroup().addTo(_mapaL);
        const lista = [], porBol = new Map();
        const addPonto = (x) => {
            const k = digitos(x.boletim) || ('x' + lista.length);
            if (porBol.has(k)) { const y = porBol.get(k); if (y.lat == null && x.lat != null) Object.assign(y, { lat: x.lat, lng: x.lng, local: x.local || y.local, _pt: x._pt }); if (!y.envolvimento && x.envolvimento) y.envolvimento = x.envolvimento; return y; }
            porBol.set(k, x); lista.push(x); return x;
        };
        const desenhar = () => {
            F.ocs.clearLayers();
            const pts = [];
            lista.filter(x => x.lat != null).forEach((x, i) => {
                const cor = (x._cfg && x._cfg.cor) || '#00e5ff';
                const mk = L.circleMarker([x.lat, x.lng], { radius: 9, color: '#fff', weight: 2, fillColor: cor, fillOpacity: .95 }).addTo(F.ocs);
                mk.bindPopup(x._pt && typeof montarPopup === 'function' ? montarPopup(x._pt, x._cfg) : `<div style="font-size:12px;"><b>${e(x.natureza)}</b><br>${e(x.data)} · BO ${e(x.boletim)}<br>${e(x.local || '')}<br><i>${e(x.envolvimento || '')}</i></div>`, { maxWidth: 360 });
                x._mk = mk; pts.push([x.lat, x.lng]);
            });
            const origem = (A.porPessoa[pessoaId] || []).find(x => x.lat != null);
            if (origem && !F.rede) L.marker([origem.lat, origem.lng], { icon: iconePessoa(p, '#d50000', 'ALVO', true), zIndexOffset: 2000 }).bindPopup(() => popupAlvo(origem), { maxWidth: 380, minWidth: 300 }).addTo(F.ocs), pts.push([origem.lat, origem.lng]);
            return pts;
        };
        const atualizar = (msg, fim) => {
            const pts = desenhar();
            F.info.ocs = { lista, noMapa: lista.filter(x => x.lat != null).length, msg, fim };
            renderBarraFoco();
            if (pts.length) _mapaL.fitBounds(pts, { padding: [60, 60], maxZoom: 16 });
        };
        // 1) Base da unidade: autores (/autor) por CPF ou nome → boletins → pontos com GPS
        if (typeof _reconstruirOcorrencias === 'function') _reconstruirOcorrencias();
        const cpf = digitos(p.cpf), nome = norm(p.nome);
        const autores = (DADOS_FB.autores || []).filter(a => {
            const ac = digitos(a.CPF || a.cpf), an = norm(a.NOME || a.nome || a.AUTOR || a.SUSPEITO || '');
            return (cpf.length >= 9 && ac && ac === cpf) || (nome.length > 8 && an === nome);
        });
        const bols = new Map();
        autores.forEach(a => { const b = digitos(a.BOLETIM || a.boletim || a.NUM_BO || a.NUMERO); if (b) bols.set(b, a); });
        (_todasOcorrencias || []).forEach(pt => {
            const b = digitos(pt.boletim);
            if (!bols.has(b)) return;
            const a = bols.get(b);
            addPonto({ boletim: pt.boletim, data: pt.data, natureza: pt.tip, local: [pt.bairro, pt.cidade].filter(v => v && v !== '—').join(' / '), envolvimento: a.SITUACAO || a.situacao || 'autor/envolvido',
                lat: pt.lat, lng: pt.lng, fonte: 'base da unidade', _pt: pt, _cfg: pt._cfg });
        });
        bols.forEach((a, b) => { if (!porBol.has(b)) addPonto({ boletim: b, data: a.DATA || '', natureza: a.TIPIFICACAO || a.NATUREZA || '', envolvimento: a.SITUACAO || '', lat: null, lng: null, fonte: 'base da unidade' }); });
        atualizar(`Base da unidade: ${lista.length} ocorrência(s) com ${e(p.nome.split(' ')[0])} como envolvido(a)${cpf ? ' (por CPF)' : ' (por nome)'}. ⏳ Consultando o CAD…`, false);

        // 2) CAD — Consulta Integrada (atualizador local), pelo CPF
        const AL = window.P3AtualizadorLocal;
        if (!cpf) { atualizar(`Base da unidade: ${lista.length} ocorrência(s) (por nome). O alvo não tem CPF no ExchelonX — a consulta ao CAD exige CPF.`, true); return; }
        if (!AL || !(await AL.disponivel().catch(() => false))) {
            atualizar(`Base da unidade: ${lista.length} ocorrência(s). Para consultar o CAD completo, abra o Sistema P3 (exe) com login P2/ADMIN e clique de novo.`, true); return;
        }
        try {
            const r = await AL.consultarPessoaStream(cpf, ev => {
                if (ev && (ev.fonte || ev.mensagem)) { F.info.ocs.msg = `⏳ Consultando o CAD… ${e(ev.fonte || ev.mensagem || '')}`; renderBarraFoco(); }
            });
            const det = {}; ((r && r.detalhesOcorrencias) || []).forEach(d => { det[d.idOcorrencia] = d.campos || {}; });
            const idx = new Map(); (_todasOcorrencias || []).forEach(pt => { const b = digitos(pt.boletim); if (b && !idx.has(b)) idx.set(b, pt); });
            const cad = (r && r.ocorrenciasDespacho) || [];
            for (const oc of cad) {
                const bol = digitos(oc.id_ocor_fk || oc._id_ocor);
                const pt = idx.get(bol), campos = det[oc._id_ocor] || {};
                const local = pt ? [pt.bairro, pt.cidade].filter(v => v && v !== '—').join(' / ') : localDosCampos(campos);
                const c = pt ? { lat: pt.lat, lng: pt.lng } : coordDosCampos(campos);
                addPonto({ boletim: oc.id_ocor_fk || oc._id_ocor, data: oc.dt_ocor, natureza: oc.ds_ocor_sgrup, envolvimento: [oc.ds_oco_despc_tipo_envl, oc.ds_ocor_despc_envl_pess_sitc].filter(Boolean).join(' — '),
                    local, lat: c ? c.lat : null, lng: c ? c.lng : null, fonte: 'CAD', _pt: pt, _cfg: pt && pt._cfg, _campos: campos, _idOcor: oc._id_ocor });
            }
            atualizar(`CAD: ${cad.length} ocorrência(s) · base da unidade: ${autores.length ? bols.size : 0}. ⏳ Localizando as que não têm coordenada…`, false);
            // As que não estão na base: pega o detalhe no CAD e localiza pelo endereço
            const faltam = lista.filter(x => x.lat == null && x.fonte === 'CAD').slice(0, 40);
            for (const x of faltam) {
                let campos = x._campos || {};
                if (!Object.keys(campos).length && x._idOcor) {
                    try { const d = await AL.ocorrenciaDetalhe({ tipo: 'despacho', idOcor: x._idOcor }); if (d && d.ok && d.detalhe) campos = d.detalhe.campos || {}; } catch (err) { /* segue sem detalhe */ }
                }
                const c = coordDosCampos(campos);
                x.local = x.local || localDosCampos(campos);
                if (c) Object.assign(x, c);
                else if (x.local) { const g = await nominatim(`${x.local}, Alagoas, Brasil`); if (g) Object.assign(x, g, { local: x.local + ' (aprox.)' }); }
                atualizar(`CAD: ${cad.length} ocorrência(s). ⏳ Localizando… ${faltam.indexOf(x) + 1}/${faltam.length}`, false);
            }
            const n = lista.filter(x => x.lat != null).length;
            atualizar(`✅ ${lista.length} ocorrência(s) envolvendo ${e(p.nome)} (CAD + base da unidade) · ${n} no mapa${lista.length - n ? ` · ${lista.length - n} sem localização (ver lista)` : ''}.`, true);
        } catch (err) {
            atualizar(`Base da unidade: ${lista.length} ocorrência(s). ⚠️ CAD: ${e(err.message)}`, true);
        }
    }
    const achar = (campos, rx) => { const k = Object.keys(campos).find(c => rx.test(N(c))); return k ? limpo(campos[k]) : ''; };
    function coordDosCampos(campos) { return coordValidaAlvo(achar(campos, /LATITUDE/), achar(campos, /LONGITUDE/)); }
    function localDosCampos(campos) {
        return [achar(campos, /LOGRADOURO|ENDERECO/), achar(campos, /BAIRRO/), achar(campos, /MUNICIPIO|CIDADE/)].filter(Boolean).join(', ');
    }
    function irOcorrencia(i) {
        const x = F.info && F.info.ocs && F.info.ocs.lista[i];
        if (!x || x.lat == null) return;
        _mapaL.setView([x.lat, x.lng], 17);
        if (x._mk) x._mk.openPopup();
    }
    // RELINT do alvo em janela própria: ficha + Consulta Integrada (CAD) já preparadas, aguardando "Gerar texto"
    A.abrirRelint = id => {
        const w = window.open('relint.html?alvo=' + encodeURIComponent(id), 'relint_' + String(id).slice(0, 8), 'width=1380,height=920,resizable=yes,scrollbars=yes');
        if (!w) alert('O navegador bloqueou a janela do RELINT — permita pop-ups para esta página.'); else w.focus();
    };
    A.focarRede = focarRede;
    A.ocorrenciasAlvo = ocorrenciasAlvo;
    A.sairFoco = sairFoco;
    A.irOcorrencia = irOcorrencia;

    // ── Painel lateral ───────────────────────────────────────────────
    function status(t) { const el = $('alvo-status'); if (el) el.textContent = t; }
    function renderPainel() {
        const el = $('alvo-lista'); if (!el) return;
        const filtro = N(($('alvo-busca') || {}).value || '');
        const noMapa = A.enderecos.filter(x => x.lat != null);
        const exatos = noMapa.filter(x => x.precisao === 'exata').length, aprox = noMapa.length - exatos;
        $('alvo-resumo').innerHTML = `<b>${Object.keys(A.pessoas).length}</b> alvos · <b>${noMapa.length}</b>/${A.enderecos.length} endereços no mapa<br>
            <span style="opacity:.7">${exatos} pela coordenada cadastrada · ${aprox} pelo endereço${A.fila.length ? ` · ${A.fila.length} na fila` : ''}</span>`;
        const lista = Object.values(A.pessoas).filter(p => (A.porPessoa[p.id] || []).length)
            .filter(p => !filtro || N([p.nome, p.cpf, ...p.apelidos, ...p.grupos.map(g => g.nome)].join(' ')).includes(filtro))
            .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).slice(0, 80);
        el.innerHTML = lista.map(p => {
            const end = (A.porPessoa[p.id] || []).find(x => x.lat != null);
            return `<div class="al-item${end ? '' : ' sem'}" ${end ? `onclick="MapaAlvos.irPara('${end.residenciaId}')"` : ''} title="${end ? 'Ir para o endereço' : 'Endereço ainda não localizado'}">
                <b>${e(p.nome)}</b>${p.apelidos.length ? ` <i>“${e(p.apelidos[0])}”</i>` : ''}<br>
                <small>${e(end ? (end.bairro || end.cidade || end.texto) : 'sem localização')}${p.vinculos.length ? ` · ${p.vinculos.length} vínculo(s)` : ''}${p.grupos.length ? ' · ' + e(p.grupos[0].nome) : ''}</small></div>`;
        }).join('') || '<div style="opacity:.5;font-size:10px;padding:6px;">Nenhum alvo encontrado.</div>';
    }
    A.alternar = vis => { A.visivel = vis; renderCamada(); if (!vis && A.linhas) { _mapaL.removeLayer(A.linhas); A.linhas = null; } };
    A.filtrar = () => { renderCamada(); renderPainel(); };
    A.irPara = irPara;
    A.mostrarRede = (id) => focarRede(id);
    A.limparRede = () => { if (A.linhas) { _mapaL.removeLayer(A.linhas); A.linhas = null; } };

    // ── Polígono: seleção de ocorrências e alvos + relatório ─────────
    function ocorrenciasNoPoligono(poligono) {
        const ocorrencias = [], vistos = new Set();
        for (const cfg of CAMADAS_CONFIG) {
            if (!_camadasAtivas.has(cfg.id)) continue;
            for (const p of (_dadosMapa[cfg.id] || [])) {
                if (!_pontoDentroPoligono(p.lat, p.lng, poligono)) continue;
                const bol = norm(p.boletim).trim();
                if (bol && bol !== '—') { const k = cfg.id + '|' + bol; if (vistos.has(k)) continue; vistos.add(k); }
                ocorrencias.push(Object.assign({}, p, { _camada: cfg }));
            }
        }
        return ocorrencias;
    }
    const alvosNoPoligono = poligono => A.enderecos.filter(x => x.lat != null && _pontoDentroPoligono(x.lat, x.lng, poligono));
    function poligonoDe(fbKey, nome) {
        if (fbKey && _fbDesenhos[fbKey]) return (_fbDesenhos[fbKey].layer.getLatLngs()[0] || []).map(ll => ({ lat: ll.lat, lng: ll.lng }));
        const r = _rascPoligonos.find(p => p.nome === nome);
        return r ? r.pontos.map(ll => ({ lat: ll.lat, lng: ll.lng })) : null;
    }
    let SEL = null;
    function destacar() {
        if (A.destaque) _mapaL.removeLayer(A.destaque);
        A.destaque = L.layerGroup().addTo(_mapaL);
        if (!SEL) return;
        SEL.ocorrencias.forEach((o, i) => { if (SEL.marcOc.has(i)) L.circleMarker([o.lat, o.lng], { radius: 7, color: '#fff', weight: 2, fillColor: o._camada.cor, fillOpacity: 1 }).addTo(A.destaque); });
        SEL.alvos.forEach((a, i) => { if (SEL.marcAl.has(i)) L.circleMarker([a.lat, a.lng], { radius: 19, color: '#ffd600', weight: 3, fill: false }).addTo(A.destaque); });
    }
    function abrirSelecao(fbKey, nome) {
        const poligono = poligonoDe(fbKey, nome);
        if (!poligono) { alert('Não encontrei esse polígono — ele pode ter sido excluído.'); return; }
        if (poligono.length < 3) { alert('Polígono inválido (menos de 3 vértices).'); return; }
        _mapaL.closePopup();
        const ocorrencias = ocorrenciasNoPoligono(poligono), alvos = alvosNoPoligono(poligono);
        SEL = { nome, ocorrencias, alvos, marcOc: new Set(ocorrencias.map((_, i) => i)), marcAl: new Set(alvos.map((_, i) => i)) };
        const grupos = {};
        ocorrencias.forEach((o, i) => (grupos[o._camada.id] = grupos[o._camada.id] || { cfg: o._camada, itens: [] }).itens.push(i));
        $('al-sel-tit').textContent = `📊 Relatório da região — ${nome}`;
        $('al-sel-corpo').innerHTML = `
            <div class="al-sel-col"><div class="al-sel-h"><label><input type="checkbox" data-tudo="oc" checked> <b>Ocorrências</b> (${ocorrencias.length})</label></div>
                ${Object.values(grupos).map(g => `<details open><summary><label><input type="checkbox" data-grupo="${g.cfg.id}" checked> ${g.cfg.icon} ${e(g.cfg.label)} (${g.itens.length})</label></summary>
                    ${g.itens.map(i => { const o = ocorrencias[i]; return `<label class="al-sel-it"><input type="checkbox" data-oc="${i}" data-g="${g.cfg.id}" checked> ${e(o.data || '')} · ${e(o.tip || o.boletim || '')}<small>${e([o.bairro, o.cidade].filter(Boolean).join(' / '))} · BO ${e(o.boletim)}</small></label>`; }).join('')}</details>`).join('') || '<div class="al-meta">Nenhuma ocorrência das camadas ativas nesta região.</div>'}</div>
            <div class="al-sel-col"><div class="al-sel-h"><label><input type="checkbox" data-tudo="al" checked> <b>Alvos</b> (${alvos.length})</label></div>
                ${alvos.map((a, i) => { const p = A.pessoas[a.pessoaId]; return `<label class="al-sel-it"><input type="checkbox" data-al="${i}" checked> 🎯 <b>${e(p.nome)}</b>${p.apelidos.length ? ` “${e(p.apelidos[0])}”` : ''}<small>${e(a.texto)} · ${p.vinculos.length} vínculo(s)${p.grupos.length ? ' · ' + e(p.grupos.map(g => g.nome).join(', ')) : ''}</small></label>`; }).join('') || `<div class="al-meta">${A.carregado ? 'Nenhum alvo com endereço dentro desta região.' : 'Alvos ainda carregando…'}</div>`}</div>`;
        const corpo = $('al-sel-corpo');
        const sync = () => {
            SEL.marcOc = new Set([...corpo.querySelectorAll('[data-oc]:checked')].map(x => +x.dataset.oc));
            SEL.marcAl = new Set([...corpo.querySelectorAll('[data-al]:checked')].map(x => +x.dataset.al));
            $('al-sel-resumo').textContent = `${SEL.marcOc.size} ocorrência(s) e ${SEL.marcAl.size} alvo(s) marcados`;
            destacar();
        };
        corpo.querySelectorAll('[data-tudo]').forEach(cb => cb.onchange = () => { corpo.querySelectorAll(cb.dataset.tudo === 'oc' ? '[data-oc],[data-grupo]' : '[data-al]').forEach(x => x.checked = cb.checked); sync(); });
        corpo.querySelectorAll('[data-grupo]').forEach(cb => cb.onchange = () => { corpo.querySelectorAll(`[data-g="${cb.dataset.grupo}"]`).forEach(x => x.checked = cb.checked); sync(); });
        corpo.querySelectorAll('[data-oc],[data-al]').forEach(cb => cb.onchange = sync);
        sync();
        $('al-sel').classList.add('aberto');
    }
    async function gerarSelecionado() {
        if (!SEL) return;
        const ocs = SEL.ocorrencias.filter((_, i) => SEL.marcOc.has(i));
        const alvos = SEL.alvos.filter((_, i) => SEL.marcAl.has(i));
        if (!ocs.length && !alvos.length) { alert('Marque ao menos uma ocorrência ou um alvo.'); return; }
        $('al-sel-gerar').disabled = true; $('al-sel-gerar').textContent = '⏳ Montando relatório…';
        try {
            await _enriquecerOcorrenciasRelatorio(ocs);
            await Promise.all(alvos.map(a => { const p = A.pessoas[a.pessoaId]; return p.fotos.length && !p._fotoUrl ? assinarFoto(p.fotos[0]).then(u => { p._fotoUrl = u; }) : null; }));
            ALVOS_RELATORIO = alvos;
            _abrirModalRelatorioRegiao(SEL.nome, ocs);
            $('al-sel').classList.remove('aberto');
        } finally { $('al-sel-gerar').disabled = false; $('al-sel-gerar').textContent = '📄 Gerar relatório'; }
    }
    // Relatório da região (js/mapa-Dashboard-P3.js) + seção de alvos selecionados
    let ALVOS_RELATORIO = null;
    const abrirOriginal = window._abrirModalRelatorioRegiao;
    window._abrirModalRelatorioRegiao = function (nomeRegiao, ocorrencias) {
        abrirOriginal(nomeRegiao, ocorrencias);
        // um alvo por linha (o mesmo alvo pode ter vários endereços dentro da região)
        const porPessoa = new Map();
        (ALVOS_RELATORIO || []).forEach(a => { if (!porPessoa.has(a.pessoaId)) porPessoa.set(a.pessoaId, []); porPessoa.get(a.pessoaId).push(a); });
        const alvos = [...porPessoa.values()]; ALVOS_RELATORIO = null;
        const folha = document.querySelector('#rr-conteudo .rr-folha'); if (!folha) return;
        if (!ocorrencias.length) folha.querySelectorAll('.rr-kpis, .rr-tab-wrap').forEach(x => x.remove());
        if (!alvos || !alvos.length) return;
        const meta = folha.querySelector('.rr-meta');
        if (meta) meta.insertAdjacentHTML('beforeend', `<span><b>Alvos na região:</b> ${alvos.length}</span>`);
        const linhas = alvos.map(ends => {
            const a = ends[0], p = A.pessoas[a.pessoaId];
            const vinc = p.vinculos.map(v => { const o = A.pessoas[v.id]; return `${e(o ? o.nome : '?')} <small>(${e(SUBTIPO[v.sub] || v.sub || v.tipo)})</small>`; }).join('<br>') || '—';
            return `<tr><td>${p._fotoUrl ? `<img src="${p._fotoUrl}" style="width:46px;height:56px;object-fit:cover;border-radius:3px;">` : ''}</td>
                <td><b>${e(p.nome)}</b>${p.apelidos.length ? `<br><i>Vulgo: ${p.apelidos.map(e).join(', ')}</i>` : ''}${p.cpf ? `<br>CPF ${e(p.cpf)}` : ''}</td>
                <td>${ends.map(x => `${e(x.texto)}<br><small>${fonteTxt(x).replace(/^[^a-zA-Zà-úÀ-Ú]+/, '')}</small>`).join('<hr style="border:0;border-top:1px dotted #bbb;margin:3px 0;">')}</td>
                <td>${p.grupos.map(g => `${e(g.nome)}${g.funcao ? ' — ' + e(g.funcao) : ''}`).join('<br>') || '—'}</td><td>${vinc}</td></tr>`;
        }).join('');
        const sec = `<div class="rr-sec-titulo">Alvos com endereço na região (ExchelonX — Ficha Alvo)</div>
            <div class="rr-tab-wrap"><table class="rr-tabela"><thead><tr><th>Foto</th><th>Alvo</th><th>Endereço</th><th>Facção / ORCRIM</th><th>Vínculos</th></tr></thead><tbody>${linhas}</tbody></table></div>`;
        const rod = folha.querySelector('.rr-rodape');
        if (rod) rod.insertAdjacentHTML('beforebegin', sec); else folha.insertAdjacentHTML('beforeend', sec);
    };
    window.gerarRelatorioRegiao = (fbKey, nome) => abrirSelecao(fbKey, nome);
    A.gerarSelecionado = gerarSelecionado;
    A.fecharSelecao = () => { $('al-sel').classList.remove('aberto'); if (A.destaque) { _mapaL.removeLayer(A.destaque); A.destaque = null; } };

    // Ao fechar um polígono novo: abre o popup já com o resumo e o relatório
    const fecharOriginal = window._fecharPoligono;
    window._fecharPoligono = function (ev) {
        const antes = _rascPoligonos.length;
        fecharOriginal(ev);
        if (_rascPoligonos.length <= antes) return;
        const r = _rascPoligonos[_rascPoligonos.length - 1];
        const pol = r.pontos.map(ll => ({ lat: ll.lat, lng: ll.lng }));
        const nOc = ocorrenciasNoPoligono(pol).length, nAl = alvosNoPoligono(pol).length;
        r.layer.setPopupContent(`<div style="font-size:11px;color:#cde;margin:0 0 6px;">Dentro da região: <b style="color:#fff">${nOc}</b> ocorrência(s) · <b style="color:#fff">${nAl}</b> alvo(s)</div>` + _popupPoligono(r));
        setTimeout(() => r.layer.openPopup(), 50);
    };

    // ── Início: espera o mapa do dashboard ficar pronto ──────────────
    const iniciarOriginal = window._inicializarLeaflet;
    window._inicializarLeaflet = function () {
        iniciarOriginal.apply(this, arguments);
        if (A.carregado) renderCamada();
        else carregar().catch(err => { console.error('[alvos]', err); status('⚠️ Não foi possível carregar os alvos: ' + err.message); });
    };
})();
