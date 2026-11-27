/* ====================================================================
   P2 · Tarefas do Analista (nativo do Echelon) — quadro de tarefas.
   Lê vw_analista_tarefas_sidebar; agrupa por coluna do painel; conclui
   (marca concluida_em) com um clique.
   ==================================================================== */
(function () {
    'use strict';
    const alvo = P2.iniciar({ active: 'tarefas-analista', titulo: 'Tarefas do Analista', sub: 'Revisão e acompanhamento' });
    if (!alvo) return;
    const esc = P2.esc, sb = P2.sb;
    const dataBr = v => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? String(v).slice(0, 10).split('-').reverse().join('/') : d.toLocaleDateString('pt-BR'); };
    let TAR = [], verConcluidas = false;

    alvo.innerHTML = `<div class="p2-page-head"><h1><i class="fa-solid fa-list-check"></i> Tarefas do Analista</h1>
        <p>Painel de tarefas de revisão e acompanhamento da inteligência, organizado por coluna.</p></div>
        <div class="pd-filtros"><label style="font-size:.84rem;color:var(--p2-txt-dim);display:flex;align-items:center;gap:7px;cursor:pointer">
            <input type="checkbox" id="ta-conc"> mostrar concluídas</label></div>
        <div id="ta-body"><div class="p2-empty"><div class="ic">⏳</div><p>Carregando…</p></div></div>`;

    document.getElementById('ta-conc').onchange = e => { verConcluidas = e.target.checked; render(); };
    carregar();

    async function carregar() {
        try { TAR = await sb.get('vw_analista_tarefas_sidebar', 'select=*&order=ordem_manual.asc.nullslast&limit=500'); }
        catch (e) { try { TAR = await sb.get('tb_analista_tarefas', 'select=*&limit=500'); } catch (e2) { document.getElementById('ta-body').innerHTML = `<div class="p2-empty"><div class="ic">⚠️</div><h3>Não foi possível carregar</h3><p>${esc(e2.message)}</p></div>`; return; } }
        render();
    }
    function render() {
        let lista = TAR.filter(t => verConcluidas || !t.concluida_em);
        const cols = [...new Set(lista.map(t => t.coluna_painel || 'Sem coluna'))];
        if (!lista.length) { document.getElementById('ta-body').innerHTML = `<div class="p2-empty"><div class="ic">✅</div><h3>Nada pendente</h3><p>Sem tarefas ${verConcluidas ? '' : 'pendentes'}.</p></div>`; return; }
        document.getElementById('ta-body').innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;align-items:start">`
            + cols.map(c => {
                const its = lista.filter(t => (t.coluna_painel || 'Sem coluna') === c);
                return `<div class="pd-card"><h2><i class="fa-solid fa-layer-group"></i> ${esc(c)} <span class="cont">${its.length}</span></h2>
                    ${its.map(cardHtml).join('')}</div>`;
            }).join('') + '</div>';
        document.querySelectorAll('[data-concluir]').forEach(b => b.onclick = () => concluir(b.dataset.concluir, true));
        document.querySelectorAll('[data-reabrir]').forEach(b => b.onclick = () => concluir(b.dataset.reabrir, false));
    }
    function cardHtml(t) {
        const prioCor = { alta: 'var(--p2-red)', media: 'var(--p2-amber)', baixa: 'var(--p2-green)' }[String(t.prioridade || '').toLowerCase()] || 'var(--p2-txt-dim2)';
        const concl = !!t.concluida_em;
        return `<div style="padding:11px 0;border-top:1px solid var(--p2-line)">
            <div style="display:flex;gap:8px;align-items:flex-start">
                <span style="width:8px;height:8px;border-radius:50%;background:${prioCor};margin-top:6px;flex-shrink:0"></span>
                <div style="flex:1;min-width:0">
                    <div style="font-weight:700;color:var(--p2-txt-strong);font-size:.86rem;${concl ? 'text-decoration:line-through;opacity:.6' : ''}">${esc(t.titulo || '—')}</div>
                    ${t.descricao ? `<div style="font-size:.76rem;color:var(--p2-txt-dim);margin-top:2px">${esc(t.descricao)}</div>` : ''}
                    <div style="font-size:.7rem;color:var(--p2-txt-dim2);margin-top:4px;display:flex;gap:10px;flex-wrap:wrap">
                        ${t.tipo_item ? `<span>${esc(t.tipo_item)}</span>` : ''}
                        ${t.data_prazo ? `<span style="${t.vencida ? 'color:var(--p2-red);font-weight:700' : ''}"><i class="fa-solid fa-clock"></i> ${esc(dataBr(t.data_prazo))}${t.vencida ? ' (vencida)' : ''}</span>` : ''}
                    </div>
                </div>
                ${concl ? `<button class="p2-btn" data-reabrir="${esc(t.id)}" style="padding:4px 8px;font-size:.72rem">↩</button>`
                    : `<button class="p2-btn pri" data-concluir="${esc(t.id)}" style="padding:4px 8px;font-size:.72rem"><i class="fa-solid fa-check"></i></button>`}
            </div></div>`;
    }
    async function concluir(id, feito) {
        try {
            await sb.patch('tb_analista_tarefas', 'id=eq.' + id, { concluida_em: feito ? new Date().toISOString() : null });
            const t = TAR.find(x => String(x.id) === String(id)); if (t) t.concluida_em = feito ? new Date().toISOString() : null;
            render();
        } catch (e) { alert('Erro: ' + e.message); }
    }
})();
