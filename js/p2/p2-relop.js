/* ====================================================================
   P2 · RELOP — Relatório Operacional (nativo do Echelon)
   Lista tb_relops + detalhe (narrativa) + impressão.
   ==================================================================== */
(function () {
    'use strict';
    const alvo = P2.iniciar({ active: 'relop', titulo: 'RELOP', sub: 'Relatório operacional' });
    if (!alvo) return;
    const esc = P2.esc, sb = P2.sb;
    const dataBr = v => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? String(v).slice(0, 10).split('-').reverse().join('/') : d.toLocaleDateString('pt-BR'); };
    const sanitize = html => { const t = document.createElement('div'); t.innerHTML = String(html || ''); t.querySelectorAll('script,style,img,iframe,link').forEach(e => e.remove()); t.querySelectorAll('*').forEach(el => { [...el.attributes].forEach(a => { if (/^on/i.test(a.name) || /^(href|src|style)$/i.test(a.name)) el.removeAttribute(a.name); }); if (!['B', 'STRONG', 'U', 'I', 'EM', 'BR', 'P', 'DIV', 'SPAN', 'UL', 'OL', 'LI'].includes(el.tagName)) el.replaceWith(...el.childNodes); }); return t.innerHTML; };
    const plain = html => { const t = document.createElement('div'); t.innerHTML = String(html || ''); return (t.textContent || '').replace(/\s+/g, ' ').trim(); };
    let REL = [], USR = {}, fQ = '', fStatus = 'todos';

    alvo.innerHTML = `<div class="p2-page-head"><h1><i class="fa-solid fa-file-contract"></i> RELOP — Relatório Operacional</h1>
        <p>Relatórios operacionais da seção, com assunto, operação, narrativa e difusão.</p></div>
        <div id="ro-body"><div class="p2-empty"><div class="ic">⏳</div><p>Carregando…</p></div></div>
        <div class="pd-modal" id="ro-modal"><div class="pd-modal-box" style="width:min(720px,100%)">
            <div class="pd-modal-h"><h2 id="ro-tit">RELOP</h2><button class="fechar" id="ro-fechar">✕</button></div>
            <div class="pd-modal-b" id="ro-det"></div><div class="pd-modal-f" id="ro-acoes"></div></div></div>
        <div id="ro-print"></div>`;

    carregar();
    async function carregar() {
        try {
            const [rel, usr] = await Promise.all([
                sb.get('tb_relops', 'select=*&order=data_documento.desc.nullslast&limit=400'),
                sb.get('tb_usuarios', 'select=id,nome_completo,nome_de_guerra,posto_graduacao').catch(() => []),
            ]);
            REL = rel || []; (usr || []).forEach(u => USR[u.id] = (u.posto_graduacao ? u.posto_graduacao + ' ' : '') + (u.nome_de_guerra || u.nome_completo || ''));
        } catch (e) { document.getElementById('ro-body').innerHTML = `<div class="p2-empty"><div class="ic">⚠️</div><h3>Erro</h3><p>${esc(e.message)}</p></div>`; return; }
        render();
    }
    function render() {
        const status = [...new Set(REL.map(r => r.status).filter(Boolean))].sort();
        document.getElementById('ro-body').innerHTML = `
            <div class="p2-kpis"><div class="p2-kpi"><div class="p2-kpi-ic"><i class="fa-solid fa-file-contract"></i></div><div class="p2-kpi-val">${REL.length}${REL.length >= 400 ? '+' : ''}</div><div class="p2-kpi-lab">Relatórios</div></div></div>
            <div class="pd-filtros"><input class="pd-sel" id="ro-q" placeholder="🔍 nº, assunto, operação…" style="min-width:180px">
                <select class="pd-sel" id="ro-status"><option value="todos">Todos os status</option>${status.map(s => `<option>${esc(s)}</option>`).join('')}</select></div>
            <div class="pd-card"><div class="pd-tbl-wrap"><table class="pd-tbl">
                <thead><tr><th>Nº</th><th>Data</th><th>Assunto</th><th>Operação</th><th>Status</th></tr></thead><tbody id="ro-tbody"></tbody></table></div></div>`;
        document.getElementById('ro-q').oninput = e => { fQ = e.target.value.toLowerCase(); tabela(); };
        document.getElementById('ro-status').onchange = e => { fStatus = e.target.value; tabela(); };
        document.getElementById('ro-fechar').onclick = () => document.getElementById('ro-modal').classList.remove('aberto');
        tabela();
    }
    function tabela() {
        let lista = REL.slice();
        if (fStatus !== 'todos') lista = lista.filter(r => r.status === fStatus);
        if (fQ) lista = lista.filter(r => [r.numero, plain(r.assunto), r.operacao].join(' ').toLowerCase().includes(fQ));
        lista = lista.slice(0, 200);
        document.getElementById('ro-tbody').innerHTML = lista.map(r => `<tr data-i="${REL.indexOf(r)}">
            <td><b>${esc(r.numero || '—')}</b></td><td>${esc(dataBr(r.data_documento))}</td>
            <td>${esc((plain(r.assunto) || '').slice(0, 46))}</td><td>${esc(r.operacao || '')}</td>
            <td>${r.status ? `<span class="p2-badge azul">${esc(r.status)}</span>` : '—'}</td></tr>`).join('')
            || '<tr><td colspan="5" style="color:var(--p2-txt-dim2)">Nenhum RELOP.</td></tr>';
        document.querySelectorAll('#ro-tbody tr[data-i]').forEach(tr => tr.onclick = () => detalhe(REL[+tr.dataset.i]));
    }
    function detalhe(r) {
        document.getElementById('ro-tit').textContent = 'RELOP ' + (r.numero || '');
        const lin = (a, b, rich) => b ? `<div class="pd-linha"><b>${esc(a)}</b><span class="${rich ? 'fa-rich' : ''}">${rich ? sanitize(b) : esc(b)}</span></div>` : '';
        document.getElementById('ro-det').innerHTML = lin('Assunto', r.assunto, true) + lin('Operação', r.operacao) + lin('Data', dataBr(r.data_documento)) +
            lin('Status', r.status) + lin('Referente', r.referente) + lin('Origem', r.origem) + lin('Difusão', r.difusao) +
            lin('Narrativa', r.narrativa, true) + lin('Observações', r.observacoes, true) +
            lin('Criado por', USR[r.criado_por]) + lin('Finalizado por', USR[r.finalizado_por]);
        document.getElementById('ro-acoes').innerHTML = '<button class="p2-btn" id="ro-imp"><i class="fa-solid fa-print"></i> Imprimir</button>';
        document.getElementById('ro-imp').onclick = () => imprimir(r);
        document.getElementById('ro-modal').classList.add('aberto');
    }
    function imprimir(r) {
        const campo = (a, b) => b ? `<div class="fa-doc-campo"><b>${esc(a)}:</b><span>${esc(plain(b))}</span></div>` : '';
        P2.imprimirDoc(`<div class="fa-doc">
            <div class="fa-doc-cab"><img src="../img/brasao.png" onerror="this.style.display='none'">
                <div><h1>POLÍCIA MILITAR DE ALAGOAS — 10º BPM</h1><h2>Seção de Inteligência (P2) — RELOP ${esc(r.numero || '')}</h2></div></div>
            <h3>DADOS</h3>${campo('Assunto', r.assunto)}${campo('Operação', r.operacao)}${campo('Data', dataBr(r.data_documento))}${campo('Difusão', r.difusao)}${campo('Referente', r.referente)}
            <h3>NARRATIVA</h3><div style="font-size:12px;white-space:pre-wrap">${esc(plain(r.narrativa) || '—')}</div>
            <div style="margin-top:18px;font-size:11px;color:#555;border-top:1px solid #ccc;padding-top:8px;text-align:center">Documento gerado pelo Sistema P3 — Módulo P2 · ${new Date().toLocaleString('pt-BR')}</div></div>`);
    }
})();
