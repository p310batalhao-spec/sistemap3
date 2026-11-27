/* ====================================================================
   P2 · Info Complementar (nativo do Echelon)
   Lista tb_info_complementares + detalhe (texto, pessoas, endereços,
   anexos com URL assinada). Mostra a origem vinculada (denúncia/LINP/…).
   ==================================================================== */
(function () {
    'use strict';
    const alvo = P2.iniciar({ active: 'info-complementar', titulo: 'Info Complementar', sub: 'Informações complementares' });
    if (!alvo) return;
    const esc = P2.esc, sb = P2.sb;
    const dataBr = v => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? String(v).slice(0, 10).split('-').reverse().join('/') : d.toLocaleString('pt-BR'); };
    const sanitize = html => { const t = document.createElement('div'); t.innerHTML = String(html || ''); t.querySelectorAll('script,style,img,iframe,link').forEach(e => e.remove()); t.querySelectorAll('*').forEach(el => { [...el.attributes].forEach(a => { if (/^on/i.test(a.name) || /^(href|src|style)$/i.test(a.name)) el.removeAttribute(a.name); }); if (!['B', 'STRONG', 'U', 'I', 'EM', 'BR', 'P', 'DIV', 'SPAN', 'UL', 'OL', 'LI'].includes(el.tagName)) el.replaceWith(...el.childNodes); }); return t.innerHTML; };
    const plain = html => { const t = document.createElement('div'); t.innerHTML = String(html || ''); return (t.textContent || '').replace(/\s+/g, ' ').trim(); };
    const origem = r => { const map = { denuncia_id: 'Denúncia', linp_id: 'LINP', mandado_id: 'Mandado', missao_id: 'Missão', ordem_busca_id: 'Ordem de Busca', relatorio_busca_id: 'Rel. de Busca' }; for (const k in map) if (r[k]) return map[k]; return ''; };

    let INFO = [], fQ = '', fStatus = 'todos';

    alvo.innerHTML = `<div class="p2-page-head"><h1><i class="fa-solid fa-circle-plus"></i> Info Complementar</h1>
        <p>Informações complementares vinculadas a alvos, denúncias, LINPs, mandados e relatórios — com pessoas, endereços e anexos.</p></div>
        <div id="ic-body"><div class="p2-empty"><div class="ic">⏳</div><p>Carregando…</p></div></div>
        <div class="pd-modal" id="ic-modal"><div class="pd-modal-box" style="width:min(720px,100%)">
            <div class="pd-modal-h"><h2 id="ic-tit">Info</h2><button class="fechar" id="ic-fechar">✕</button></div>
            <div class="pd-modal-b" id="ic-det"></div>
            <div class="pd-modal-f"><button class="p2-btn" id="ic-fechar2">Fechar</button></div>
        </div></div>`;

    carregar();
    async function carregar() {
        try {
            INFO = await sb.get('tb_info_complementares', 'select=*&order=data_hora.desc.nullslast&limit=400');
        } catch (e) { document.getElementById('ic-body').innerHTML = `<div class="p2-empty"><div class="ic">⚠️</div><h3>Não foi possível carregar</h3><p>${esc(e.message)}</p></div>`; return; }
        render();
    }
    function render() {
        const status = [...new Set(INFO.map(i => i.status).filter(Boolean))].sort();
        const kpi = (ic, v, lab) => `<div class="p2-kpi"><div class="p2-kpi-ic">${ic}</div><div class="p2-kpi-val">${v}</div><div class="p2-kpi-lab">${esc(lab)}</div></div>`;
        document.getElementById('ic-body').innerHTML = `
            <div class="p2-kpis">${kpi('<i class="fa-solid fa-circle-plus"></i>', INFO.length + (INFO.length >= 400 ? '+' : ''), 'Informações')}</div>
            <div class="pd-filtros">
                <input class="pd-sel" id="ic-q" placeholder="🔍 nº, assunto, texto…" style="min-width:180px">
                <select class="pd-sel" id="ic-status"><option value="todos">Todos os status</option>${status.map(s => `<option>${esc(s)}</option>`).join('')}</select>
            </div>
            <div class="pd-card"><div class="pd-tbl-wrap"><table class="pd-tbl">
                <thead><tr><th>Nº</th><th>Data</th><th>Assunto</th><th>Origem</th><th>Status</th></tr></thead>
                <tbody id="ic-tbody"></tbody></table></div></div>`;
        document.getElementById('ic-q').oninput = e => { fQ = e.target.value.toLowerCase(); tabela(); };
        document.getElementById('ic-status').onchange = e => { fStatus = e.target.value; tabela(); };
        document.getElementById('ic-fechar').onclick = document.getElementById('ic-fechar2').onclick = () => document.getElementById('ic-modal').classList.remove('aberto');
        tabela();
    }
    function tabela() {
        let lista = INFO.slice();
        if (fStatus !== 'todos') lista = lista.filter(i => i.status === fStatus);
        if (fQ) lista = lista.filter(i => [i.numero, plain(i.assunto), plain(i.texto_principal)].join(' ').toLowerCase().includes(fQ));
        lista = lista.slice(0, 200);
        document.getElementById('ic-tbody').innerHTML = lista.map(i => `<tr data-i="${INFO.indexOf(i)}">
            <td><b>${esc(i.numero || '—')}</b></td><td>${esc(dataBr(i.data_hora))}</td>
            <td>${esc((plain(i.assunto) || '').slice(0, 48))}</td><td>${esc(origem(i)) || '—'}</td>
            <td>${i.status ? `<span class="p2-badge azul">${esc(i.status)}</span>` : '—'}</td></tr>`).join('')
            || '<tr><td colspan="5" style="color:var(--p2-txt-dim2)">Nenhuma informação.</td></tr>';
        document.querySelectorAll('#ic-tbody tr[data-i]').forEach(tr => tr.onclick = () => detalhe(INFO[+tr.dataset.i]));
    }
    async function detalhe(i) {
        document.getElementById('ic-tit').textContent = 'Info ' + (i.numero || '');
        const lin = (a, b, rich) => b ? `<div class="pd-linha"><b>${esc(a)}</b><span class="${rich ? 'fa-rich' : ''}">${rich ? sanitize(b) : esc(b)}</span></div>` : '';
        document.getElementById('ic-det').innerHTML = lin('Assunto', i.assunto, true) + lin('Data/hora', dataBr(i.data_hora)) +
            lin('Origem', origem(i)) + lin('Status', i.status) + lin('Texto', i.texto_principal, true) +
            '<div id="ic-extra" style="margin-top:8px;color:var(--p2-txt-dim2);font-size:.8rem">Carregando vínculos…</div>';
        document.getElementById('ic-modal').classList.add('aberto');
        const g = (t, q) => sb.get(t, q).catch(() => []);
        const [pes, ends, anexos] = await Promise.all([
            g('tb_info_complementar_pessoas', 'select=papel,observacao,pessoa:tb_pessoas(id,nome_completo)&info_complementar_id=eq.' + i.id),
            g('tb_info_complementar_enderecos', 'select=tipo,observacao,endereco:tb_enderecos(tipo_logradouro,logradouro,numero)&info_complementar_id=eq.' + i.id),
            g('tb_info_complementar_anexos', 'select=arquivo_nome,arquivo_path,bucket_id,legenda&info_complementar_id=eq.' + i.id),
        ]);
        let html = '';
        if (pes.length) html += bloco('Pessoas', pes.map(p => p.pessoa ? `<a href="p2-ficha-alvo.html?pessoa_id=${esc(p.pessoa.id)}" style="color:var(--p2-accent)">${esc(p.pessoa.nome_completo)}</a> <small style="color:var(--p2-txt-dim2)">${esc(p.papel || '')}</small>` : '—'));
        if (ends.length) html += bloco('Endereços', ends.map(e => esc([e.endereco && [e.endereco.tipo_logradouro, e.endereco.logradouro, e.endereco.numero].filter(Boolean).join(' '), e.tipo].filter(Boolean).join(' — '))));
        if (anexos.length) {
            const links = await Promise.all(anexos.map(async a => {
                const url = a.arquivo_path ? await sb.signUrl(a.bucket_id || 'midia', a.arquivo_path, 600).catch(() => null) : null;
                const nome = esc(a.arquivo_nome || a.legenda || 'anexo');
                return url ? `<a href="${esc(url)}" target="_blank" style="color:var(--p2-accent)"><i class="fa-solid fa-paperclip"></i> ${nome}</a>` : nome;
            }));
            html += bloco('Anexos', links);
        }
        const extra = document.getElementById('ic-extra'); if (extra) extra.outerHTML = html || '<div style="color:var(--p2-txt-dim2);font-size:.8rem">Sem pessoas/endereços/anexos.</div>';
    }
    function bloco(t, arr) {
        return `<div style="margin-top:12px"><div style="font-size:.74rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--p2-txt-dim2);margin-bottom:5px">${esc(t)}</div>`
            + arr.map(x => `<div style="padding:6px 0;border-top:1px solid var(--p2-line);font-size:.83rem">${x}</div>`).join('') + '</div>';
    }
})();
