/* ====================================================================
   P2 · Relatório de Serviço (nativo do Echelon)
   Lista tb_relatorios_servico + detalhe com itens. Impressão.
   ==================================================================== */
(function () {
    'use strict';
    const alvo = P2.iniciar({ active: 'relatorio-servico', titulo: 'Relatório de Serviço', sub: 'Relatórios da equipe' });
    if (!alvo) return;
    const esc = P2.esc, sb = P2.sb;
    const dataBr = v => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? v : d.toLocaleString('pt-BR'); };
    let REL = [], USR = {};

    alvo.innerHTML = `<div class="p2-page-head"><h1><i class="fa-solid fa-file-pen"></i> Relatório de Serviço</h1>
        <p>Registros de serviço das equipes, com os itens/ocorrências do turno.</p></div>
        <div id="rs-body"><div class="p2-empty"><div class="ic">⏳</div><p>Carregando…</p></div></div>
        <div class="pd-modal" id="rs-modal"><div class="pd-modal-box" style="width:min(680px,100%)">
            <div class="pd-modal-h"><h2 id="rs-tit">Relatório</h2><button class="fechar" id="rs-fechar">✕</button></div>
            <div class="pd-modal-b" id="rs-det"></div><div class="pd-modal-f" id="rs-acoes"></div></div></div>
        <div id="rs-print"></div>`;

    carregar();
    async function carregar() {
        try {
            const [rel, usr] = await Promise.all([
                sb.get('tb_relatorios_servico', 'select=*&order=data_hora_relatorio.desc.nullslast&limit=400'),
                sb.get('tb_usuarios', 'select=id,nome_completo,nome_de_guerra,posto_graduacao').catch(() => []),
            ]);
            REL = rel || []; (usr || []).forEach(u => USR[u.id] = (u.posto_graduacao ? u.posto_graduacao + ' ' : '') + (u.nome_de_guerra || u.nome_completo || ''));
        } catch (e) { document.getElementById('rs-body').innerHTML = `<div class="p2-empty"><div class="ic">⚠️</div><h3>Erro</h3><p>${esc(e.message)}</p></div>`; return; }
        render();
    }
    function render() {
        document.getElementById('rs-body').innerHTML = `
            <div class="p2-kpis"><div class="p2-kpi"><div class="p2-kpi-ic"><i class="fa-solid fa-file-pen"></i></div><div class="p2-kpi-val">${REL.length}${REL.length >= 400 ? '+' : ''}</div><div class="p2-kpi-lab">Relatórios</div></div></div>
            <div class="pd-card"><div class="pd-tbl-wrap"><table class="pd-tbl">
                <thead><tr><th>Data/hora</th><th>Viatura/veículo</th><th>Criado por</th><th>Status</th></tr></thead><tbody id="rs-tbody"></tbody></table></div></div>`;
        document.getElementById('rs-fechar').onclick = () => document.getElementById('rs-modal').classList.remove('aberto');
        document.getElementById('rs-tbody').innerHTML = REL.slice(0, 200).map(r => `<tr data-i="${REL.indexOf(r)}">
            <td><b>${esc(dataBr(r.data_hora_relatorio))}</b></td><td>${esc(r.veiculo_utilizado || '')}</td>
            <td>${esc(USR[r.criado_por] || '')}</td><td>${r.status ? `<span class="p2-badge azul">${esc(r.status)}</span>` : '—'}</td></tr>`).join('')
            || '<tr><td colspan="4" style="color:var(--p2-txt-dim2)">Nenhum relatório.</td></tr>';
        document.querySelectorAll('#rs-tbody tr[data-i]').forEach(tr => tr.onclick = () => detalhe(REL[+tr.dataset.i]));
    }
    async function detalhe(r) {
        document.getElementById('rs-tit').textContent = 'Relatório de Serviço';
        const lin = (a, b) => b ? `<div class="pd-linha"><b>${esc(a)}</b><span>${esc(b)}</span></div>` : '';
        document.getElementById('rs-det').innerHTML = lin('Data/hora', dataBr(r.data_hora_relatorio)) + lin('Veículo', r.veiculo_utilizado) +
            lin('Criado por', USR[r.criado_por]) + lin('Status', r.status) + lin('Observação', r.observacao) +
            '<div id="rs-itens" style="margin-top:8px;color:var(--p2-txt-dim2);font-size:.8rem">Carregando itens…</div>';
        document.getElementById('rs-acoes').innerHTML = '<button class="p2-btn" id="rs-imp"><i class="fa-solid fa-print"></i> Imprimir</button>';
        document.getElementById('rs-modal').classList.add('aberto');
        const itens = await sb.get('tb_relatorio_servico_itens', 'select=descricao,ordem&relatorio_servico_id=eq.' + r.id + '&order=ordem.asc.nullslast').catch(() => []);
        const html = itens.length ? `<div style="margin-top:12px"><div style="font-size:.74rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--p2-txt-dim2);margin-bottom:5px">Itens / ocorrências</div>`
            + itens.map((it, i) => `<div style="padding:7px 0;border-top:1px solid var(--p2-line);font-size:.83rem"><b>${i + 1}.</b> ${esc(it.descricao || '')}</div>`).join('') + '</div>' : '<div style="color:var(--p2-txt-dim2);font-size:.8rem">Sem itens.</div>';
        const box = document.getElementById('rs-itens'); if (box) box.outerHTML = html;
        document.getElementById('rs-imp').onclick = () => imprimir(r, itens);
    }
    function imprimir(r, itens) {
        P2.imprimirDoc(`<div class="fa-doc">
            <div class="fa-doc-cab"><img src="../img/brasao.png" onerror="this.style.display='none'">
                <div><h1>POLÍCIA MILITAR DE ALAGOAS — 10º BPM</h1><h2>Seção de Inteligência (P2) — Relatório de Serviço</h2></div></div>
            <div class="fa-doc-campo"><b>Data/hora:</b><span>${esc(dataBr(r.data_hora_relatorio))}</span></div>
            <div class="fa-doc-campo"><b>Veículo:</b><span>${esc(r.veiculo_utilizado || '—')}</span></div>
            <div class="fa-doc-campo"><b>Criado por:</b><span>${esc(USR[r.criado_por] || '—')}</span></div>
            <h3>ITENS / OCORRÊNCIAS</h3>${itens.length ? '<ul>' + itens.map(it => `<li>${esc(it.descricao || '')}</li>`).join('') + '</ul>' : '<div style="font-size:12px">—</div>'}
            <div style="margin-top:18px;font-size:11px;color:#555;border-top:1px solid #ccc;padding-top:8px;text-align:center">Documento gerado pelo Sistema P3 — Módulo P2 · ${new Date().toLocaleString('pt-BR')}</div></div>`);
    }
})();
