/* ====================================================================
   P2 · Auditoria — trilha de acesso/eventos (nativo do Echelon)
   Lista tb_audit_logs (quem fez o quê, quando, em qual registro).
   ==================================================================== */
(function () {
    'use strict';
    const alvo = P2.iniciar({ active: 'auditoria', titulo: 'Auditoria', sub: 'Trilha de acesso e eventos' });
    if (!alvo) return;
    const esc = P2.esc, sb = P2.sb;
    const fmt = v => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? v : d.toLocaleString('pt-BR'); };

    let LOGS = [], fTipo = 'todos', fAcao = 'todas', fQ = '';

    alvo.innerHTML = `<div class="p2-page-head"><h1><i class="fa-solid fa-shield-halved"></i> Auditoria</h1>
        <p>Registro de quem acessou e alterou o quê no sistema de inteligência — rastreabilidade das ações.</p></div>
        <div id="au-body"><div class="p2-empty"><div class="ic">⏳</div><p>Carregando eventos…</p></div></div>
        <div class="pd-modal" id="au-modal"><div class="pd-modal-box">
            <div class="pd-modal-h"><h2>Detalhe do evento</h2><button class="fechar" id="au-fechar">✕</button></div>
            <div class="pd-modal-b" id="au-det"></div>
            <div class="pd-modal-f"><button class="p2-btn" id="au-fechar2">Fechar</button></div>
        </div></div>`;

    carregar();

    async function carregar() {
        try {
            LOGS = await sb.get('tb_audit_logs', 'select=id,created_at,action,entity_type,entity_id,usuario_id,ip,user_agent,metadata&order=created_at.desc.nullslast&limit=500');
        } catch (e) {
            document.getElementById('au-body').innerHTML = `<div class="p2-empty"><div class="ic">⚠️</div><h3>Não foi possível carregar</h3><p>${esc(e.message)}</p></div>`;
            return;
        }
        render();
    }
    function render() {
        const tipos = [...new Set(LOGS.map(l => l.entity_type).filter(Boolean))].sort();
        const acoes = [...new Set(LOGS.map(l => l.action).filter(Boolean))].sort();
        const hoje = new Date().toISOString().slice(0, 10);
        const nHoje = LOGS.filter(l => (l.created_at || '').slice(0, 10) === hoje).length;
        const kpi = (ic, v, lab) => `<div class="p2-kpi"><div class="p2-kpi-ic">${ic}</div><div class="p2-kpi-val">${v}</div><div class="p2-kpi-lab">${esc(lab)}</div></div>`;

        document.getElementById('au-body').innerHTML = `
            <div class="p2-kpis">
                ${kpi('<i class="fa-solid fa-list"></i>', LOGS.length + (LOGS.length >= 500 ? '+' : ''), 'Eventos carregados')}
                ${kpi('<i class="fa-solid fa-calendar-day"></i>', nHoje, 'Hoje')}
                ${kpi('<i class="fa-solid fa-table-cells"></i>', tipos.length, 'Tipos de registro')}
            </div>
            <div class="pd-filtros">
                <input class="pd-sel" id="au-q" placeholder="🔍 buscar…" style="min-width:160px">
                <select class="pd-sel" id="au-tipo"><option value="todos">Todos os tipos</option>${tipos.map(t => `<option>${esc(t)}</option>`).join('')}</select>
                <select class="pd-sel" id="au-acao"><option value="todas">Todas as ações</option>${acoes.map(a => `<option>${esc(a)}</option>`).join('')}</select>
            </div>
            <div class="pd-card"><div class="pd-tbl-wrap"><table class="pd-tbl">
                <thead><tr><th>Data/hora</th><th>Ação</th><th>Tipo</th><th>Registro</th><th>Usuário</th><th>IP</th></tr></thead>
                <tbody id="au-tbody"></tbody></table></div></div>`;

        document.getElementById('au-q').oninput = e => { fQ = e.target.value.toLowerCase(); tabela(); };
        document.getElementById('au-tipo').onchange = e => { fTipo = e.target.value; tabela(); };
        document.getElementById('au-acao').onchange = e => { fAcao = e.target.value; tabela(); };
        document.getElementById('au-fechar').onclick = document.getElementById('au-fechar2').onclick = () => document.getElementById('au-modal').classList.remove('aberto');
        tabela();
    }
    function tabela() {
        let lista = LOGS.slice();
        if (fTipo !== 'todos') lista = lista.filter(l => l.entity_type === fTipo);
        if (fAcao !== 'todas') lista = lista.filter(l => l.action === fAcao);
        if (fQ) lista = lista.filter(l => [l.action, l.entity_type, l.entity_id, l.usuario_id, l.ip].join(' ').toLowerCase().includes(fQ));
        lista = lista.slice(0, 200);
        const corAcao = a => /delet|remov|exclu/i.test(a) ? 'var(--p2-red)' : (/insert|cria|add/i.test(a) ? 'var(--p2-green)' : (/updat|alter|edit/i.test(a) ? 'var(--p2-amber)' : 'var(--p2-txt)'));
        document.getElementById('au-tbody').innerHTML = lista.map((l, i) => `<tr data-i="${LOGS.indexOf(l)}">
            <td>${esc(fmt(l.created_at))}</td>
            <td style="color:${corAcao(l.action || '')};font-weight:700">${esc(l.action || '')}</td>
            <td>${esc(l.entity_type || '')}</td>
            <td><b>${esc((l.entity_id || '').toString().slice(0, 10))}</b></td>
            <td>${esc((l.usuario_id || '—').toString().slice(0, 10))}</td>
            <td>${esc(l.ip || '')}</td></tr>`).join('') || '<tr><td colspan="6" style="color:var(--p2-txt-dim2)">Nenhum evento.</td></tr>';
        document.querySelectorAll('#au-tbody tr[data-i]').forEach(tr => tr.onclick = () => detalhe(LOGS[+tr.dataset.i]));
    }
    function detalhe(l) {
        const lin = (a, b) => b ? `<div class="pd-linha"><b>${esc(a)}</b><span style="word-break:break-all">${esc(b)}</span></div>` : '';
        let meta = l.metadata; try { if (meta && typeof meta === 'object') meta = JSON.stringify(meta, null, 2); } catch (e) { }
        document.getElementById('au-det').innerHTML =
            lin('Data/hora', fmt(l.created_at)) + lin('Ação', l.action) + lin('Tipo', l.entity_type) +
            lin('Registro', l.entity_id) + lin('Usuário', l.usuario_id) + lin('IP', l.ip) + lin('Navegador', l.user_agent) +
            (meta ? `<div class="pd-linha"><b>Metadados</b><pre style="margin:0;white-space:pre-wrap;font-size:.76rem;color:var(--p2-txt-dim)">${esc(meta)}</pre></div>` : '');
        document.getElementById('au-modal').classList.add('aberto');
    }
})();
