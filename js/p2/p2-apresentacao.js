/* ====================================================================
   P2 · Apresentação da Equipe (nativo do Echelon)
   Lista tb_apresentacoes_servico + detalhe com os integrantes.
   ==================================================================== */
(function () {
    'use strict';
    const alvo = P2.iniciar({ active: 'apresentacao-equipe', titulo: 'Apresentação da Equipe', sub: 'Apresentação de serviço' });
    if (!alvo) return;
    const esc = P2.esc, sb = P2.sb;
    const dataBr = v => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? String(v).slice(0, 10).split('-').reverse().join('/') : d.toLocaleDateString('pt-BR'); };
    let AP = [], USR = {}, EQ = {};

    alvo.innerHTML = `<div class="p2-page-head"><h1><i class="fa-solid fa-users"></i> Apresentação da Equipe</h1>
        <p>Apresentações de serviço das equipes — data, viatura e integrantes.</p></div>
        <div id="ap-body"><div class="p2-empty"><div class="ic">⏳</div><p>Carregando…</p></div></div>
        <div class="pd-modal" id="ap-modal"><div class="pd-modal-box"><div class="pd-modal-h"><h2 id="ap-tit">Apresentação</h2><button class="fechar" id="ap-fechar">✕</button></div>
            <div class="pd-modal-b" id="ap-det"></div><div class="pd-modal-f"><button class="p2-btn" id="ap-fechar2">Fechar</button></div></div></div>`;

    carregar();
    async function carregar() {
        try {
            const [ap, usr, eqs] = await Promise.all([
                sb.get('tb_apresentacoes_servico', 'select=*&order=data_servico.desc.nullslast&limit=400'),
                sb.get('tb_usuarios', 'select=id,nome_completo,nome_de_guerra,posto_graduacao').catch(() => []),
                sb.get('tb_equipes', 'select=id,nome').catch(() => []),
            ]);
            AP = ap || []; (usr || []).forEach(u => USR[u.id] = (u.posto_graduacao ? u.posto_graduacao + ' ' : '') + (u.nome_de_guerra || u.nome_completo || '')); (eqs || []).forEach(e => EQ[e.id] = e.nome);
        } catch (e) { document.getElementById('ap-body').innerHTML = `<div class="p2-empty"><div class="ic">⚠️</div><h3>Erro</h3><p>${esc(e.message)}</p></div>`; return; }
        render();
    }
    function render() {
        document.getElementById('ap-body').innerHTML = `
            <div class="p2-kpis"><div class="p2-kpi"><div class="p2-kpi-ic"><i class="fa-solid fa-users"></i></div><div class="p2-kpi-val">${AP.length}${AP.length >= 400 ? '+' : ''}</div><div class="p2-kpi-lab">Apresentações</div></div></div>
            <div class="pd-card"><div class="pd-tbl-wrap"><table class="pd-tbl">
                <thead><tr><th>Data</th><th>Equipe</th><th>Viatura</th><th>Apresentado por</th><th>Status</th></tr></thead><tbody id="ap-tbody"></tbody></table></div></div>`;
        document.getElementById('ap-fechar').onclick = document.getElementById('ap-fechar2').onclick = () => document.getElementById('ap-modal').classList.remove('aberto');
        document.getElementById('ap-tbody').innerHTML = AP.slice(0, 200).map(a => `<tr data-i="${AP.indexOf(a)}">
            <td><b>${esc(dataBr(a.data_servico))}</b></td><td>${esc(EQ[a.equipe_id] || '')}</td><td>${esc(a.viatura || '')}</td>
            <td>${esc(USR[a.apresentado_por] || '')}</td><td>${a.status ? `<span class="p2-badge azul">${esc(a.status)}</span>` : '—'}</td></tr>`).join('')
            || '<tr><td colspan="5" style="color:var(--p2-txt-dim2)">Nenhuma apresentação.</td></tr>';
        document.querySelectorAll('#ap-tbody tr[data-i]').forEach(tr => tr.onclick = () => detalhe(AP[+tr.dataset.i]));
    }
    async function detalhe(a) {
        document.getElementById('ap-tit').textContent = 'Apresentação — ' + dataBr(a.data_servico);
        const lin = (x, y) => y ? `<div class="pd-linha"><b>${esc(x)}</b><span>${esc(y)}</span></div>` : '';
        document.getElementById('ap-det').innerHTML = lin('Data', dataBr(a.data_servico)) + lin('Equipe', EQ[a.equipe_id]) + lin('Viatura', a.viatura) +
            lin('Apresentado por', USR[a.apresentado_por]) + lin('Status', a.status) + lin('Observação', a.observacao) +
            '<div id="ap-int" style="margin-top:8px;color:var(--p2-txt-dim2);font-size:.8rem">Carregando integrantes…</div>';
        document.getElementById('ap-modal').classList.add('aberto');
        const us = await sb.get('tb_apresentacao_servico_usuarios', 'select=usuario_id,observacao,ordem&apresentacao_id=eq.' + a.id + '&order=ordem.asc.nullslast').catch(() => []);
        const html = us.length ? `<div style="margin-top:12px"><div style="font-size:.74rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--p2-txt-dim2);margin-bottom:5px">Integrantes (${us.length})</div>`
            + us.map(u => `<div style="padding:7px 0;border-top:1px solid var(--p2-line);font-size:.83rem">${esc(USR[u.usuario_id] || '(usuário)')}${u.observacao ? ` <small style="color:var(--p2-txt-dim2)">— ${esc(u.observacao)}</small>` : ''}</div>`).join('') + '</div>' : '<div style="color:var(--p2-txt-dim2);font-size:.8rem">Sem integrantes.</div>';
        const box = document.getElementById('ap-int'); if (box) box.outerHTML = html;
    }
})();
