/* ====================================================================
   P2 · LINP — Levantamento de Informações (nativo do Echelon)
   Lista (vw_linp_detalhe) + detalhe com envolvidos e endereços.
   ==================================================================== */
(function () {
    'use strict';
    const alvo = P2.iniciar({ active: 'linp', titulo: 'LINP', sub: 'Levantamento de informações' });
    if (!alvo) return;
    const esc = P2.esc, sb = P2.sb;
    const dataBr = v => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? String(v).slice(0, 10).split('-').reverse().join('/') : d.toLocaleString('pt-BR'); };
    const sanitize = html => { const t = document.createElement('div'); t.innerHTML = String(html || ''); t.querySelectorAll('script,style,img,iframe,link').forEach(e => e.remove()); t.querySelectorAll('*').forEach(el => { [...el.attributes].forEach(a => { if (/^on/i.test(a.name) || /^(href|src|style)$/i.test(a.name)) el.removeAttribute(a.name); }); if (!['B', 'STRONG', 'U', 'I', 'EM', 'BR', 'P', 'DIV', 'SPAN', 'UL', 'OL', 'LI'].includes(el.tagName)) el.replaceWith(...el.childNodes); }); return t.innerHTML; };
    const plain = html => { const t = document.createElement('div'); t.innerHTML = String(html || ''); return (t.textContent || '').replace(/\s+/g, ' ').trim(); };

    let LINP = [], fQ = '', fSit = 'todas';

    alvo.innerHTML = `<div class="p2-page-head"><h1><i class="fa-solid fa-clipboard-list"></i> LINP — Levantamento de Informações</h1>
        <p>Ocorrências levantadas pela inteligência, com envolvidos, endereços e narrativa dos fatos.</p></div>
        <div id="li-body"><div class="p2-empty"><div class="ic">⏳</div><p>Carregando…</p></div></div>
        <div class="pd-modal" id="li-modal"><div class="pd-modal-box" style="width:min(720px,100%)">
            <div class="pd-modal-h"><h2 id="li-tit">LINP</h2><button class="fechar" id="li-fechar">✕</button></div>
            <div class="pd-modal-b" id="li-det"></div>
            <div class="pd-modal-f" id="li-acoes"></div>
        </div></div>
        <div id="li-print"></div>`;

    carregar();
    async function carregar() {
        try {
            LINP = await sb.get('vw_linp_detalhe', 'select=*&order=data_hora.desc.nullslast&limit=400');
        } catch (e) { document.getElementById('li-body').innerHTML = `<div class="p2-empty"><div class="ic">⚠️</div><h3>Não foi possível carregar</h3><p>${esc(e.message)}</p></div>`; return; }
        render();
    }
    function render() {
        const sits = [...new Set(LINP.map(l => l.situacao_atual || l.situacao).filter(Boolean))].sort();
        const kpi = (ic, v, lab) => `<div class="p2-kpi"><div class="p2-kpi-ic">${ic}</div><div class="p2-kpi-val">${v}</div><div class="p2-kpi-lab">${esc(lab)}</div></div>`;
        document.getElementById('li-body').innerHTML = `
            <div class="p2-kpis">
                ${kpi('<i class="fa-solid fa-clipboard-list"></i>', LINP.length + (LINP.length >= 400 ? '+' : ''), 'LINPs')}
                ${kpi('<i class="fa-solid fa-city"></i>', [...new Set(LINP.map(l => l.cidade_nome).filter(Boolean))].length, 'Cidades')}
            </div>
            <div class="pd-filtros">
                <input class="pd-sel" id="li-q" placeholder="🔍 nº, assunto, cidade…" style="min-width:180px">
                <select class="pd-sel" id="li-sit"><option value="todas">Todas as situações</option>${sits.map(s => `<option>${esc(s)}</option>`).join('')}</select>
            </div>
            <div class="pd-card"><div class="pd-tbl-wrap"><table class="pd-tbl">
                <thead><tr><th>Nº</th><th>Data</th><th>Assunto</th><th>Cidade</th><th>Situação</th></tr></thead>
                <tbody id="li-tbody"></tbody></table></div></div>`;
        document.getElementById('li-q').oninput = e => { fQ = e.target.value.toLowerCase(); tabela(); };
        document.getElementById('li-sit').onchange = e => { fSit = e.target.value; tabela(); };
        document.getElementById('li-fechar').onclick = () => document.getElementById('li-modal').classList.remove('aberto');
        tabela();
    }
    function tabela() {
        let lista = LINP.slice();
        if (fSit !== 'todas') lista = lista.filter(l => (l.situacao_atual || l.situacao) === fSit);
        if (fQ) lista = lista.filter(l => [l.numero, l.assunto, l.cidade_nome, plain(l.motivacao_preliminar)].join(' ').toLowerCase().includes(fQ));
        lista = lista.slice(0, 200);
        document.getElementById('li-tbody').innerHTML = lista.map(l => `<tr data-i="${LINP.indexOf(l)}">
            <td><b>${esc(l.numero || '—')}</b></td><td>${esc(dataBr(l.data_hora))}</td>
            <td>${esc((plain(l.assunto) || '').slice(0, 50))}</td><td>${esc(l.cidade_nome || '')}</td>
            <td><span class="p2-badge azul">${esc(l.situacao_atual || l.situacao || '—')}</span></td></tr>`).join('')
            || '<tr><td colspan="5" style="color:var(--p2-txt-dim2)">Nenhum LINP.</td></tr>';
        document.querySelectorAll('#li-tbody tr[data-i]').forEach(tr => tr.onclick = () => detalhe(LINP[+tr.dataset.i]));
    }
    async function detalhe(l) {
        document.getElementById('li-tit').textContent = 'LINP ' + (l.numero || '');
        const lin = (a, b, rich) => b ? `<div class="pd-linha"><b>${esc(a)}</b><span class="${rich ? 'fa-rich' : ''}">${rich ? sanitize(b) : esc(b)}</span></div>` : '';
        const body = document.getElementById('li-det');
        body.innerHTML = lin('Assunto', l.assunto, true) + lin('Data/hora', dataBr(l.data_hora)) + lin('Cidade', l.cidade_nome) +
            lin('Situação', l.situacao_atual || l.situacao) + lin('Local do fato', l.local_do_fato) +
            lin('Modo de execução', l.modo_execucao) + lin('Motivação preliminar', l.motivacao_preliminar, true) +
            lin('Narrativa', l.narrativa_fatos, true) +
            '<div id="li-env" style="margin-top:8px;color:var(--p2-txt-dim2);font-size:.8rem">Carregando envolvidos…</div>';
        document.getElementById('li-acoes').innerHTML = '<button class="p2-btn" id="li-imp"><i class="fa-solid fa-print"></i> Imprimir</button>';
        document.getElementById('li-modal').classList.add('aberto');
        const g = (t, q) => sb.get(t, q).catch(() => []);
        const [env, ends] = await Promise.all([
            g('tb_linp_envolvidos', 'select=papel,situacao_envolvido,observacao,pessoa:tb_pessoas(id,nome_completo)&linp_id=eq.' + l.id),
            g('tb_linp_enderecos', 'select=tipo,endereco:tb_enderecos(tipo_logradouro,logradouro,numero)&linp_id=eq.' + l.id),
        ]);
        let html = '';
        if (env.length) html += bloco('Envolvidos', env.map(e => {
            const nm = e.pessoa ? e.pessoa.nome_completo : '(pessoa)';
            const link = e.pessoa ? `<a href="p2-ficha-alvo.html?pessoa_id=${esc(e.pessoa.id)}" style="color:var(--p2-accent)">${esc(nm)}</a>` : esc(nm);
            return `${link} <small style="color:var(--p2-txt-dim2)">${esc([e.papel, e.situacao_envolvido].filter(Boolean).join(' · '))}</small>`;
        }));
        if (ends.length) html += bloco('Endereços', ends.map(e => esc([e.endereco && [e.endereco.tipo_logradouro, e.endereco.logradouro, e.endereco.numero].filter(Boolean).join(' '), e.tipo].filter(Boolean).join(' — '))));
        const envBox = document.getElementById('li-env'); if (envBox) { envBox.outerHTML = html || '<div style="color:var(--p2-txt-dim2);font-size:.8rem">Sem envolvidos/endereços.</div>'; }
        const imp = document.getElementById('li-imp'); if (imp) imp.onclick = () => imprimir(l, env, ends);
    }
    function bloco(t, arr) {
        return `<div style="margin-top:12px"><div style="font-size:.74rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--p2-txt-dim2);margin-bottom:5px">${esc(t)}</div>`
            + arr.map(x => `<div style="padding:6px 0;border-top:1px solid var(--p2-line);font-size:.83rem">${x}</div>`).join('') + '</div>';
    }
    function imprimir(l, env, ends) {
        const campo = (r, v) => v ? `<div class="fa-doc-campo"><b>${esc(r)}:</b><span>${esc(plain(v))}</span></div>` : '';
        P2.imprimirDoc(`<div class="fa-doc">
            <div class="fa-doc-cab"><img src="../img/brasao.png" onerror="this.style.display='none'">
                <div><h1>POLÍCIA MILITAR DE ALAGOAS — 10º BPM</h1><h2>Seção de Inteligência (P2) — LINP ${esc(l.numero || '')}</h2></div></div>
            <h3>DADOS</h3>${campo('Assunto', l.assunto)}${campo('Data/hora', dataBr(l.data_hora))}${campo('Cidade', l.cidade_nome)}
            ${campo('Situação', l.situacao_atual || l.situacao)}${campo('Local do fato', l.local_do_fato)}${campo('Modo de execução', l.modo_execucao)}
            <h3>MOTIVAÇÃO PRELIMINAR</h3><div style="font-size:12px;white-space:pre-wrap">${esc(plain(l.motivacao_preliminar) || '—')}</div>
            <h3>NARRATIVA DOS FATOS</h3><div style="font-size:12px;white-space:pre-wrap">${esc(plain(l.narrativa_fatos) || '—')}</div>
            <h3>ENVOLVIDOS</h3>${env.length ? '<ul>' + env.map(e => `<li>${esc((e.pessoa ? e.pessoa.nome_completo : '—'))} — ${esc([e.papel, e.situacao_envolvido].filter(Boolean).join(' · '))}</li>`).join('') + '</ul>' : '<div style="font-size:12px">—</div>'}
            <div style="margin-top:18px;font-size:11px;color:#555;border-top:1px solid #ccc;padding-top:8px;text-align:center">Documento gerado pelo Sistema P3 — Módulo P2 · ${new Date().toLocaleString('pt-BR')}</div>
        </div>`);
    }
})();
