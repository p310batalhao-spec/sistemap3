/* ====================================================================
   P2 · Módulo Missões / Disque-Denúncia (reescrita nativa do Echelon)
   --------------------------------------------------------------------
   • Lê o PDF do disque (pdf.js) — um arquivo pode ter VÁRIAS denúncias;
     divide em blocos e processa cada uma.
   • PRIORIDADE: marca as que contêm termos de CVLI/MVI (morte, homicídio,
     atirou…). • REINCIDÊNCIA: cruza alvos/endereços da denúncia com a base
     (tb_pessoas/apelidos/enderecos) e marca "ALVO/ENDEREÇO REINCIDENTE".
   • Categoriza (heurística) e deixa atribuir a equipe. Salva em lote no
     Supabase do Echelon (1 upload do PDF + N inserts + missão por equipe).
   • Detalhe com rich text seguro + abrir PDF + impressão do disque.

   A camada Xerife-IA (categorização/equipe mais indicada por IA) ativa
   quando o backend local do exe responde (POST /xerife/ia/chat).
   ==================================================================== */
(function () {
    'use strict';
    const alvo = P2.iniciar({ active: 'missoes', titulo: 'Missões / Disque-Denúncia', sub: 'Recebimento → leitura → distribuição' });
    if (!alvo) return;
    const esc = P2.esc, sb = P2.sb;
    const BACKEND = 'http://127.0.0.1:5057';

    if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    let EQUIPES = [], CIDADES = [], DENUNCIAS = [], ALVOS = [], ENDERECOS = [], ITENS = [], pdfSel = null;
    let filtro = { q: '', status: 'todas' };

    // Termos que elevam a prioridade (CVLI/MVI). Comparados sem acento.
    const PRIORIDADE_TERMOS = ['MVI', 'CVLI', 'MORTE', 'HOMICIDIO', 'MATAR', 'MATOU', 'ASSASSINAR', 'DESOVAR', 'DESOVOU', 'CADAVER', 'ATIROU', 'DISPAROU'];

    // ── Util texto ───────────────────────────────────────────────────
    const normalizeText = t => String(t || '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    const semAcento = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
    const normCidade = v => semAcento(v).replace(/[^A-Za-z0-9\s'-]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
    const normBusca = v => semAcento(v).replace(/\s+/g, ' ').trim().toUpperCase();
    const dataIsoBr = v => { const m = String(v || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; };
    function normalizeDataBr(v) {
        const m = String(v || '').trim().match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/); if (!m) return null;
        const d = +m[1], mes = +m[2], a = +m[3];
        if (!d || mes < 1 || mes > 12 || a < 1900 || a > 2200 || d > new Date(a, mes, 0).getDate()) return null;
        return String(a).padStart(4, '0') + '-' + String(mes).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    }
    function normalizeHora(v) { const m = String(v || '').trim().match(/^(\d{1,2}):(\d{2})/); if (!m || +m[1] > 23 || +m[2] > 59) return null; return String(+m[1]).padStart(2, '0') + ':' + m[2]; }

    function sanitizeRich(html) {
        const t = document.createElement('div'); t.innerHTML = String(html || '');
        t.querySelectorAll('script,style,iframe,link,img').forEach(e => e.remove());
        t.querySelectorAll('*').forEach(el => {
            [...el.attributes].forEach(a => { if (/^on/i.test(a.name) || /^(href|src|style)$/i.test(a.name)) el.removeAttribute(a.name); });
            if (!['B', 'STRONG', 'U', 'I', 'EM', 'BR', 'P', 'DIV', 'SPAN', 'UL', 'OL', 'LI'].includes(el.tagName)) el.replaceWith(...el.childNodes);
        });
        return t.innerHTML;
    }
    const plainText = html => { const t = document.createElement('div'); t.innerHTML = String(html || ''); return (t.textContent || '').replace(/\s+/g, ' ').trim(); };

    // ── Parser (porte de denunciaPdfParser.ts) ───────────────────────
    async function extractPdfText(file) {
        if (!window.pdfjsLib) throw new Error('pdf.js não carregou.');
        const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        let full = '';
        for (let i = 1; i <= pdf.numPages; i++) { const p = await pdf.getPage(i); const tc = await p.getTextContent(); full += tc.items.map(it => it.str).join(' ') + '\n'; }
        return normalizeText(full);
    }
    // Divide um PDF com VÁRIAS denúncias em blocos (âncora: "Denúncia Nº ...").
    function dividirDenuncias(text) {
        const re = /den[úu]ncia\s*n[ºo°]?\s*:?\s*\d{4,}/gi;
        const idx = []; let m;
        while ((m = re.exec(text)) !== null) idx.push(m.index);
        if (idx.length <= 1) return [text];
        const blocos = [];
        for (let i = 0; i < idx.length; i++) blocos.push(text.slice(idx[i], i + 1 < idx.length ? idx[i + 1] : undefined));
        return blocos;
    }
    function parseBloco(text) {
        let numero = '', tipo = '', local = '', historico = '', dataDenuncia = null, horaDenuncia = null;
        const dm = text.match(/\bData\s*[:\-]\s*(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/i);
        if (dm) dataDenuncia = normalizeDataBr(dm[1] + '/' + dm[2] + '/' + dm[3]);
        const hm = text.match(/\bHora\s*[:\-]\s*(\d{1,2})\s*[:hH]\s*(\d{2})(?:\s*[:]\s*(\d{2}))?/);
        if (hm) horaDenuncia = normalizeHora(hm[1] + ':' + hm[2]);
        const ns = text.match(/den[úu]ncia\s*n[ºo°]?\s*[:\-]?\s*(\d{4,})/i);
        if (ns) numero = ns[1]; else { const nf = text.match(/n[ºo°]\s*[:\-]?\s*(\d{4,})/i); if (nf) numero = nf[1]; }
        const tm = text.match(/tipo\s*[:\-]\s*([\s\S]*?)(?=\s*(?:DATA|HORA|ORIGEM|LOCAL|HIST[OÓ]RICO|N[ºO°]|PROTOCOLO|DEN[ÚU]NCIA)\s*[:\-]|$)/i);
        if (tm) tipo = tm[1].replace(/\s+/g, ' ').trim().replace(/\s+\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}.*$/, '').trim();
        const lm = text.match(/LOCAL\s*[:\-]?\s*([\s\S]*?)(?=\s*HIST[OÓ]RICO\s*[:\-]?|$)/i);
        if (lm) local = normalizeText(lm[1]);
        const hi = text.match(/HIST[OÓ]RICO\s*[:\-]?\s*([\s\S]*?)$/i);
        if (hi) historico = normalizeText(hi[1]);
        const cidadeCandidata = local ? (local.split(/[,\n;]/)[0] || '').trim() : '';
        return { numero, tipo, local, historico, cidadeCandidata, dataDenuncia, horaDenuncia };
    }
    const matchCidadeId = texto => { const a = normCidade(texto); if (!a) return ''; const h = CIDADES.find(c => normCidade(c.nome) === a); return h ? h.id : ''; };

    // ── Classificação ────────────────────────────────────────────────
    function detectarPrioridade(texto) {
        const t = normBusca(texto);
        const achados = PRIORIDADE_TERMOS.filter(term => new RegExp('\\b' + term + '\\b').test(t));
        return { alta: achados.length > 0, termos: achados };
    }
    function categorizar(tipo, texto) {
        const t = normBusca(tipo + ' ' + texto);
        if (/\b(MVI|CVLI|HOMICIDIO|MORTE|CADAVER|ASSASSINAR)\b/.test(t)) return 'CVLI / MVI';
        if (/\b(ARMA|PORTE|POSSE|MUNICAO|DISPAROU|ATIROU)\b/.test(t)) return 'Armas / disparos';
        if (/\b(DROGA|TRAFICO|ENTORPECENTE|MACONHA|COCAINA|CRACK)\b/.test(t)) return 'Tráfico de drogas';
        if (/\b(ROUBO|FURTO|ASSALTO|RECEPTACAO)\b/.test(t)) return 'Patrimonial';
        if (/\b(AMEACA|VIOLENCIA DOMESTICA|MARIA DA PENHA|ESTUPRO)\b/.test(t)) return 'Pessoa / doméstica';
        return (tipo || 'Geral').toUpperCase();
    }
    const escapeRe = s => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Cruza o texto da denúncia com a base: alvos (nome/apelido) e endereços.
    // Usa os regex pré-compilados (_re) montados no carregamento.
    function detectarReincidencia(texto) {
        const t = normBusca(texto);
        const alvos = [];
        for (const p of ALVOS) { if (p._re && p._re.test(t)) { alvos.push({ id: p.id, nome: p.nome }); if (alvos.length >= 12) break; } }
        const enderecos = [];
        for (const e of ENDERECOS) { if (e._re && e._re.test(t)) { enderecos.push({ id: e.id, texto: e.texto }); if (enderecos.length >= 8) break; } }
        return { alvos, enderecos };
    }

    // ── Layout ───────────────────────────────────────────────────────
    function layout() {
        alvo.innerHTML = `
            <div class="p2-page-head">
                <h1><i class="fa-solid fa-bullseye"></i> Missões / Disque-Denúncia</h1>
                <p>Envie o PDF do disque (DINT) — mesmo com várias denúncias. O sistema lê tudo, detecta prioridade
                   (CVLI/MVI) e reincidência de alvos/endereços, você confere e salva. A distribuição às equipes e a
                   plotagem no mapa seguem o fluxo do Echelon.</p>
            </div>
            <div class="pm-acoes">
                <div class="pm-busca"><input class="pm-input" id="pm-q" placeholder="🔍 Nº, tipo, cidade, resumo…"></div>
                <select class="pm-select" id="pm-fstatus" style="max-width:180px">
                    <option value="todas">Todos os status</option><option value="pendente">Pendentes</option><option value="concluido">Concluídos</option>
                </select>
                <button class="p2-btn pri" id="pm-nova"><span class="p2-btn-ic">＋</span> Nova denúncia (PDF)</button>
            </div>
            <div id="pm-lista"><div class="p2-empty"><div class="ic">⏳</div><p>Carregando denúncias…</p></div></div>

            <div class="pm-modal" id="pm-modal">
              <div class="pm-modal-box">
                <div class="pm-modal-h"><h2>Nova denúncia — leitura do PDF</h2><button class="fechar" id="pm-fechar">✕</button></div>
                <div class="pm-modal-b">
                    <div class="pm-drop" id="pm-drop">
                        <div class="ic"><i class="fa-solid fa-file-arrow-up"></i></div><b>Clique ou arraste o PDF do disque-denúncia</b>
                        <small id="pm-drop-sub">Um arquivo pode conter várias denúncias — leio todas.</small>
                        <input type="file" id="pm-file" accept="application/pdf" hidden>
                    </div>
                    <div class="pm-msg" id="pm-msg"></div>
                    <div id="pm-lote" style="margin-top:14px"></div>
                </div>
                <div class="pm-modal-f">
                    <button class="p2-btn" id="pm-cancelar">Cancelar</button>
                    <button class="p2-btn pri" id="pm-salvar" style="display:none">💾 Salvar todas</button>
                </div>
              </div>
            </div>

            <div class="pm-modal" id="pm-modal-det">
              <div class="pm-modal-box">
                <div class="pm-modal-h"><h2 id="pm-det-tit">Denúncia</h2><button class="fechar" id="pm-det-fechar">✕</button></div>
                <div class="pm-modal-b" id="pm-det-body"></div>
                <div class="pm-modal-f" id="pm-det-acoes"></div>
              </div>
            </div>`;

        // Container de impressão FORA do .p2-app (senão o CSS de impressão o esconde junto).
        if (!document.getElementById('pm-print')) {
            const pr = document.createElement('div'); pr.id = 'pm-print'; document.body.appendChild(pr);
        }

        document.getElementById('pm-nova').onclick = abrirNova;
        document.getElementById('pm-fechar').onclick = document.getElementById('pm-cancelar').onclick = () => fechar('pm-modal');
        document.getElementById('pm-det-fechar').onclick = () => fechar('pm-modal-det');
        document.getElementById('pm-salvar').onclick = salvarTodas;
        document.getElementById('pm-q').oninput = e => { filtro.q = e.target.value.toLowerCase(); renderLista(); };
        document.getElementById('pm-fstatus').onchange = e => { filtro.status = e.target.value; renderLista(); };
        const drop = document.getElementById('pm-drop'), file = document.getElementById('pm-file');
        drop.onclick = () => file.click();
        file.onchange = () => file.files[0] && aoSelecionar(file.files[0]);
        drop.ondragover = e => { e.preventDefault(); drop.classList.add('drag'); };
        drop.ondragleave = () => drop.classList.remove('drag');
        drop.ondrop = e => { e.preventDefault(); drop.classList.remove('drag'); if (e.dataTransfer.files[0]) aoSelecionar(e.dataTransfer.files[0]); };
    }
    const fechar = id => document.getElementById(id).classList.remove('aberto');
    const abrir = id => document.getElementById(id).classList.add('aberto');

    // ── Carregamento (equipes, cidades, base p/ reincidência) ────────
    async function carregar() {
        try {
            const [eqs, cids, pes, ends] = await Promise.all([
                sb.get('tb_equipes', 'select=id,nome&ativo=eq.true&order=nome'),
                sb.get('tb_cidades', 'select=id,nome&ativo=eq.true&order=nome'),
                sb.get('tb_pessoas', 'select=id,nome_completo,tb_pessoa_apelidos(apelido)&limit=6000'),
                sb.get('tb_enderecos', 'select=id,tipo_logradouro,logradouro,numero&limit=6000'),
            ]);
            EQUIPES = eqs || []; CIDADES = cids || [];
            ALVOS = (pes || []).map(p => {
                const nomes = [...new Set([p.nome_completo].concat((p.tb_pessoa_apelidos || []).map(a => a.apelido))
                    .map(normBusca).filter(n => n && n.length >= 4))];
                return { id: p.id, nome: p.nome_completo, _re: nomes.length ? new RegExp('\\b(' + nomes.map(escapeRe).join('|') + ')\\b') : null };
            }).filter(p => p._re);
            ENDERECOS = (ends || []).map(e => {
                const via = [e.tipo_logradouro, e.logradouro].filter(Boolean).join(' ').trim();
                const norm = normBusca(via);
                return { id: e.id, texto: via + (e.numero ? ', ' + e.numero : ''), _re: norm.length >= 6 ? new RegExp('\\b' + escapeRe(norm) + '\\b') : null };
            }).filter(e => e._re);
        } catch (e) { /* segue com o que tiver */ }
        aiStatus();
        await carregarDenuncias();
    }
    async function aiStatus() {
        // Mostra se a IA do Xerife (backend do exe) está disponível.
        let on = false;
        try {
            const c = new AbortController(); const to = setTimeout(() => c.abort(), 1500);
            const r = await fetch(BACKEND + '/xerife/ia/status', { signal: c.signal }); clearTimeout(to);
            on = r.ok;
        } catch (e) { on = false; }
        window.__p2aiOn = on;
    }
    async function carregarDenuncias() {
        const box = document.getElementById('pm-lista');
        try {
            DENUNCIAS = await sb.get('tb_denuncias', 'select=*,cidade:tb_cidades(nome),equipe:tb_equipes(nome)&order=data_denuncia.desc.nullslast&limit=200');
            renderLista();
        } catch (e) { box.innerHTML = `<div class="p2-empty"><div class="ic">⚠️</div><h3>Não foi possível carregar</h3><p>${esc(e.message)}</p></div>`; }
    }
    function statusInfo(s) { const v = String(s || 'pendente').toLowerCase(); if (/conclu/.test(v)) return { cls: 'verde', txt: 'Concluído' }; if (/improc|arquiv|cancel/.test(v)) return { cls: 'verm', txt: s }; return { cls: 'amb', txt: 'Pendente' }; }

    // Ícone (Font Awesome) por tipo/assunto da denúncia — mais visível e
    // representativo: arma, maconha, caveira, etc.
    const fa = c => '<i class="fa-solid ' + c + '"></i>';
    function iconeDenuncia(tipo, texto) {
        const t = normBusca((tipo || '') + ' ' + (texto || ''));
        if (/\b(MVI|CVLI|HOMICIDIO|MORTE|MORTO|CADAVER|ASSASSIN|MATAR|MATOU|DESOVA|LATROCINIO)\b/.test(t)) return fa('fa-skull-crossbones');
        if (/\b(ARMA|PORTE|POSSE|MUNICAO|FUZIL|PISTOLA|REVOLVER|DISPAR|ATIROU)\b/.test(t)) return fa('fa-gun');
        if (/\b(DROGA|TRAFICO|ENTORPEC|MACONHA|COCAINA|CRACK|BOCA DE FUMO)\b/.test(t)) return fa('fa-cannabis');
        if (/\b(ROUBO|FURTO|ASSALTO|RECEPTACAO|ARROMBAMENTO)\b/.test(t)) return fa('fa-sack-dollar');
        if (/\b(VEICULO|CARRO|MOTO|PLACA)\b/.test(t)) return fa('fa-car-burst');
        if (/\b(AMEACA|VIOLENCIA DOMESTICA|MARIA DA PENHA|AGRESS)\b/.test(t)) return fa('fa-house-crack');
        if (/\b(ESTUPRO|ABUSO|PEDOFIL)\b/.test(t)) return fa('fa-triangle-exclamation');
        if (/\b(FACCAO|ORCRIM|CV|PCC|TORCIDA)\b/.test(t)) return fa('fa-people-group');
        if (/\b(FORAGIDO|MANDADO|PROCURAD)\b/.test(t)) return fa('fa-handcuffs');
        return fa('fa-phone-volume');
    }

    function renderLista() {
        const box = document.getElementById('pm-lista');
        let lista = DENUNCIAS.slice();
        if (filtro.status !== 'todas') lista = lista.filter(d => { const c = /conclu/.test(String(d.status_operacional || '').toLowerCase()); return filtro.status === 'concluido' ? c : !c; });
        if (filtro.q) lista = lista.filter(d => [d.numero, d.tipo, plainText(d.resumo_breve), d.cidade && d.cidade.nome].join(' ').toLowerCase().includes(filtro.q));
        if (!lista.length) { box.innerHTML = `<div class="p2-empty"><div class="ic">📭</div><h3>Nenhuma denúncia</h3><p>Clique em “Nova denúncia (PDF)”.</p></div>`; return; }
        box.innerHTML = '<div class="pm-grid">' + lista.map(cardHtml).join('') + '</div>';
        box.querySelectorAll('[data-ver]').forEach(b => b.onclick = () => abrirDetalhe(b.dataset.ver));
    }
    function cardHtml(d) {
        const st = statusInfo(d.status_operacional);
        const resumo = plainText(d.resumo_breve);
        const ic = iconeDenuncia(d.tipo, resumo);
        return `<div class="pm-card">
            <div class="pm-card-top"><div class="pm-card-ic" title="${esc(d.tipo || '')}">${ic}</div>
                <div class="pm-card-tit"><b>Nº ${esc(d.numero || '—')}</b><small>${esc(d.tipo || 'Denúncia')}</small></div>
                <span class="p2-badge ${st.cls}">${esc(st.txt)}</span></div>
            ${resumo ? `<div class="pm-card-resumo">${esc(resumo)}</div>` : ''}
            <div class="pm-card-meta">
                ${d.cidade ? `<span>📍 ${esc(d.cidade.nome)}</span>` : ''}
                ${d.data_denuncia ? `<span>📅 ${esc(dataIsoBr(d.data_denuncia))}</span>` : ''}
                <span>👥 ${esc(d.equipe ? d.equipe.nome : 'Sem equipe')}</span></div>
            <div class="pm-card-acoes"><button class="pm-mini pri" data-ver="${esc(d.id)}">👁️ Detalhes</button></div>
        </div>`;
    }

    // ── Nova denúncia (lote) ─────────────────────────────────────────
    function abrirNova() { pdfSel = null; ITENS = []; document.getElementById('pm-lote').innerHTML = ''; document.getElementById('pm-salvar').style.display = 'none'; document.getElementById('pm-drop-sub').textContent = 'Um arquivo pode conter várias denúncias — leio todas.'; msg('', ''); abrir('pm-modal'); }

    async function aoSelecionar(file) {
        if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { msg('Selecione um arquivo PDF.', 'erro'); return; }
        pdfSel = file;
        document.getElementById('pm-drop-sub').textContent = '📄 ' + file.name;
        msg('Lendo o PDF e cruzando com a base…', 'carregando');
        try {
            const texto = await extractPdfText(file);
            const blocos = dividirDenuncias(texto);
            ITENS = blocos.map(b => {
                const p = parseBloco(b);
                const prioridade = detectarPrioridade(b);
                const reinc = detectarReincidencia(b);
                const categoria = categorizar(p.tipo, b);
                const resumo = (p.local || p.historico) ? ('LOCAL: ' + (p.local || '—') + (p.historico ? '\n\nHISTÓRICO: ' + p.historico : '')) : '';
                return {
                    tipo: (p.tipo || '').toUpperCase(), numero: p.numero, data: p.dataDenuncia || '', hora: p.horaDenuncia || '',
                    cidadeId: matchCidadeId(p.cidadeCandidata), equipeId: '', resumo, narrativa: p.historico || '',
                    prioridade, reinc, categoria,
                };
            }).filter(it => it.numero || it.tipo || it.resumo);
            // prioridade primeiro
            ITENS.sort((a, b) => (b.prioridade.alta ? 1 : 0) - (a.prioridade.alta ? 1 : 0));
            renderLote();
            const nPrio = ITENS.filter(i => i.prioridade.alta).length;
            msg(`Detectei ${ITENS.length} denúncia(s)${nPrio ? ' · ' + nPrio + ' de ALTA prioridade' : ''}. Confira e salve.`, 'ok');
        } catch (e) { msg('Não consegui ler o PDF (' + e.message + ').', 'erro'); }
    }

    function renderLote() {
        const box = document.getElementById('pm-lote');
        if (!ITENS.length) { box.innerHTML = ''; document.getElementById('pm-salvar').style.display = 'none'; return; }
        const aiOn = window.__p2aiOn;
        const optsCid = id => '<option value="">—</option>' + CIDADES.map(c => `<option value="${esc(c.id)}"${c.id === id ? ' selected' : ''}>${esc(c.nome)}</option>`).join('');
        const optsEq = id => '<option value="">— atribuir depois —</option>' + EQUIPES.map(e => `<option value="${esc(e.id)}"${e.id === id ? ' selected' : ''}>${esc(e.nome)}</option>`).join('');
        box.innerHTML = `
            <div class="pm-lote-top"><b>${ITENS.length} denúncia(s) detectada(s)</b>
                <span class="pm-ai-chip ${aiOn ? 'on' : 'off'}">${aiOn ? '<i class="fa-solid fa-robot"></i> Xerife-IA disponível' : '<i class="fa-solid fa-robot"></i> Xerife-IA só no app (exe)'}</span></div>`
            + ITENS.map((it, i) => {
                const badges = [`<span class="pm-tag cat">${esc(it.categoria)}</span>`];
                if (it.prioridade.alta) badges.unshift(`<span class="pm-tag prio"><i class="fa-solid fa-triangle-exclamation"></i> Prioridade · ${esc(it.prioridade.termos.join(', '))}</span>`);
                if (it.reinc.alvos.length) badges.push(`<span class="pm-tag reinc-alvo">Alvo reincidente</span>`);
                if (it.reinc.enderecos.length) badges.push(`<span class="pm-tag reinc-end">Endereço reincidente</span>`);
                const reincHtml = (it.reinc.alvos.length || it.reinc.enderecos.length) ? `<div class="pm-reinc"><i class="fa-solid fa-rotate"></i> <b>Reincidência:</b> `
                    + (it.reinc.alvos.length ? 'alvos — ' + it.reinc.alvos.map(a => esc(a.nome)).join('; ') : '')
                    + (it.reinc.alvos.length && it.reinc.enderecos.length ? ' · ' : '')
                    + (it.reinc.enderecos.length ? 'endereços — ' + it.reinc.enderecos.map(e => esc(e.texto)).join('; ') : '') + '</div>' : '';
                return `<div class="pm-item ${it.prioridade.alta ? 'prio' : ''}">
                    <div class="pm-item-h"><span class="n">#${i + 1} · Nº ${esc(it.numero || '—')}</span>
                        <div class="pm-item-badges">${badges.join('')}</div></div>
                    ${reincHtml}
                    <div class="pm-item-grid">
                        <div class="pm-field"><label>Tipo *</label><input class="pm-input" id="it-${i}-tipo" value="${esc(it.tipo)}"></div>
                        <div class="pm-field"><label>Número *</label><input class="pm-input" id="it-${i}-numero" value="${esc(it.numero)}"></div>
                        <div class="pm-field"><label>Data</label><input class="pm-input" type="date" id="it-${i}-data" value="${esc(it.data)}"></div>
                        <div class="pm-field"><label>Hora</label><input class="pm-input" type="time" id="it-${i}-hora" value="${esc(it.hora)}"></div>
                        <div class="pm-field"><label>Cidade</label><select class="pm-select" id="it-${i}-cidade">${optsCid(it.cidadeId)}</select></div>
                        <div class="pm-field"><label>Equipe</label><select class="pm-select" id="it-${i}-equipe">${optsEq(it.equipeId)}</select></div>
                        <div class="pm-field full"><label>Resumo / Local</label><textarea class="pm-textarea" id="it-${i}-resumo">${esc(it.resumo)}</textarea></div>
                    </div>
                </div>`;
            }).join('');
        document.getElementById('pm-salvar').style.display = '';
        document.getElementById('pm-salvar').textContent = '💾 Salvar todas (' + ITENS.length + ')';
    }

    async function salvarTodas() {
        if (!pdfSel || !ITENS.length) { msg('Nada para salvar.', 'erro'); return; }
        // Lê edições da tela.
        ITENS.forEach((it, i) => {
            it.tipo = document.getElementById('it-' + i + '-tipo').value.trim().toUpperCase();
            it.numero = document.getElementById('it-' + i + '-numero').value.trim();
            it.data = document.getElementById('it-' + i + '-data').value;
            it.hora = document.getElementById('it-' + i + '-hora').value;
            it.cidadeId = document.getElementById('it-' + i + '-cidade').value;
            it.equipeId = document.getElementById('it-' + i + '-equipe').value;
            it.resumo = document.getElementById('it-' + i + '-resumo').value.trim();
        });
        const invalidos = ITENS.filter(it => !it.tipo || !it.numero);
        if (invalidos.length) { msg('Toda denúncia precisa de tipo e número (' + invalidos.length + ' incompleta(s)).', 'erro'); return; }
        const btn = document.getElementById('pm-salvar'); btn.disabled = true;
        msg('Enviando PDF e salvando…', 'carregando');
        try {
            // 1 upload do PDF (compartilhado por todas as denúncias do arquivo).
            const path = sb.caminhoDenuncia(ITENS[0].tipo, ITENS[0].numero, pdfSel);
            await sb.upload('denuncias', path, pdfSel, false);
            let ok = 0, dup = 0;
            for (const it of ITENS) {
                const existe = await sb.get('tb_denuncias', 'select=id&numero=eq.' + encodeURIComponent(it.numero) + '&limit=1');
                if (existe && existe.length) { dup++; continue; }
                const nova = await sb.insert('tb_denuncias', {
                    tipo: it.tipo, numero: it.numero, cidade_id: it.cidadeId || null,
                    resumo_breve: it.resumo || null, narrativa: it.narrativa || null,
                    data_denuncia: it.data || null, hora_denuncia: it.hora || null,
                    arquivo_path: path, arquivo_nome: pdfSel.name, arquivo_mime: pdfSel.type || 'application/pdf', arquivo_size: pdfSel.size,
                    status_operacional: 'pendente',
                });
                const d = Array.isArray(nova) ? nova[0] : nova;
                if (it.equipeId && d && d.id) await atribuirEquipe(d.id, it.equipeId, it.numero);
                ok++;
            }
            msg(`${ok} denúncia(s) salva(s)${dup ? ' · ' + dup + ' já existia(m)' : ''}.`, 'ok');
            setTimeout(() => { fechar('pm-modal'); carregarDenuncias(); }, 900);
        } catch (e) { msg('Erro ao salvar: ' + e.message, 'erro'); } finally { btn.disabled = false; }
    }
    async function atribuirEquipe(denunciaId, equipeId, numero) {
        const equipe = EQUIPES.find(e => e.id === equipeId); if (!equipe) return;
        await sb.patch('tb_denuncias', 'id=eq.' + denunciaId, { equipe_id: equipeId });
        const letra = (equipe.nome.trim().match(/([A-Z])$/i) || [])[1];
        await sb.insert('tb_missoes', {
            titulo: 'DENÚNCIA Nº ' + numero, descricao: 'Denúncia atribuída à equipe ' + equipe.nome,
            categoria: 'denuncia', equipe_codigo: (letra || 'A').toUpperCase(), equipe_id: equipeId,
            origem_tipo: 'denuncia', origem_ref: denunciaId, status: 'aberta',
        });
    }

    // ── Detalhe / PDF / impressão / status ───────────────────────────
    const denPorId = id => DENUNCIAS.find(d => String(d.id) === String(id));
    function abrirDetalhe(id) {
        const d = denPorId(id); if (!d) return;
        const st = statusInfo(d.status_operacional);
        const lin = (r, v, rich) => `<div class="pm-det-linha"><b>${esc(r)}</b><span class="${rich ? 'pm-rich' : ''}">${v || '—'}</span></div>`;
        document.getElementById('pm-det-tit').textContent = 'Denúncia nº ' + (d.numero || '');
        document.getElementById('pm-det-body').innerHTML =
            lin('Status', `<span class="p2-badge ${st.cls}">${esc(st.txt)}</span>`) +
            lin('Tipo', esc(d.tipo)) + lin('Cidade', esc(d.cidade ? d.cidade.nome : '')) +
            lin('Data / hora', esc([dataIsoBr(d.data_denuncia), (d.hora_denuncia || '').slice(0, 5)].filter(Boolean).join(' '))) +
            lin('Equipe', esc(d.equipe ? d.equipe.nome : 'Sem equipe')) +
            lin('Resumo / Local', sanitizeRich(d.resumo_breve), true) +
            lin('Histórico', sanitizeRich(d.narrativa), true);
        document.getElementById('pm-det-acoes').innerHTML =
            (d.arquivo_path ? '<button class="p2-btn" id="pm-abrir-pdf">📄 Abrir PDF</button>' : '') +
            '<button class="p2-btn" id="pm-imprimir">🖨️ Imprimir disque</button>' +
            `<button class="p2-btn pri" id="pm-status">${/conclu/.test(String(d.status_operacional || '').toLowerCase()) ? '↩️ Reabrir' : '✓ Concluir'}</button>`;
        const pdfBtn = document.getElementById('pm-abrir-pdf'); if (pdfBtn) pdfBtn.onclick = () => abrirPdf(d);
        document.getElementById('pm-imprimir').onclick = () => imprimir(d);
        document.getElementById('pm-status').onclick = () => alternarStatus(d);
        abrir('pm-modal-det');
    }
    async function abrirPdf(d) { const url = await sb.signUrl('denuncias', d.arquivo_path, 600); if (url) window.open(url, '_blank'); else alert('Não foi possível gerar o link do PDF.'); }
    async function alternarStatus(d) {
        const concluido = /conclu/.test(String(d.status_operacional || '').toLowerCase());
        const novo = concluido ? 'pendente' : 'concluido';
        try {
            await sb.patch('tb_denuncias', 'id=eq.' + d.id, { status_operacional: novo });
            await sb.patch('tb_missoes', 'origem_tipo=eq.denuncia&origem_ref=eq.' + d.id, { status: novo === 'concluido' ? 'aguardando_revisao' : 'aberta', atualizado_em: new Date().toISOString() });
            fechar('pm-modal-det'); carregarDenuncias();
        } catch (e) { alert('Erro ao alterar status: ' + e.message); }
    }
    function imprimir(d) {
        const campo = (r, v) => v ? `<div class="pm-doc-campo"><b>${esc(r)}:</b><span>${esc(v)}</span></div>` : '';
        document.getElementById('pm-print').innerHTML = `
            <div class="pm-doc">
                <div class="pm-doc-cab"><img src="../img/brasao.png" alt="" onerror="this.style.display='none'">
                    <div class="tit"><h1>POLÍCIA MILITAR DE ALAGOAS — 10º BPM</h1><h2>Seção de Inteligência (P2) — Disque-Denúncia</h2></div></div>
                <h3>IDENTIFICAÇÃO DA DENÚNCIA</h3>
                ${campo('Número', d.numero)}${campo('Tipo', d.tipo)}${campo('Cidade', d.cidade ? d.cidade.nome : '')}
                ${campo('Data', dataIsoBr(d.data_denuncia))}${campo('Hora', (d.hora_denuncia || '').slice(0, 5))}
                ${campo('Equipe responsável', d.equipe ? d.equipe.nome : 'Não atribuída')}${campo('Status', statusInfo(d.status_operacional).txt)}
                <h3>RESUMO / LOCAL</h3><div class="pm-doc-texto pm-rich">${sanitizeRich(d.resumo_breve) || '—'}</div>
                <h3>HISTÓRICO</h3><div class="pm-doc-texto pm-rich">${sanitizeRich(d.narrativa) || '—'}</div>
                <div class="pm-doc-rodape">Documento gerado pelo Sistema P3 — Módulo P2 · ${new Date().toLocaleString('pt-BR')}</div>
            </div>`;
        setTimeout(() => window.print(), 50);
    }

    function msg(t, cls) { const el = document.getElementById('pm-msg'); el.className = 'pm-msg' + (cls ? ' ' + cls : ''); el.textContent = t; }

    layout(); carregar();
})();
