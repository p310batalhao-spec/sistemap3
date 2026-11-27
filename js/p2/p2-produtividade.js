/* ====================================================================
   P2 · Produtividade (reescrita nativa do Echelon)
   Dashboard de apreensões/prisões: KPIs (registros, presos, armas,
   drogas, veículos, valores), por tipo/tipificação e lista com detalhe
   (itens apreendidos). Lê tb_produtividade (+ sub-tabelas) do Echelon.
   ==================================================================== */
(function () {
    'use strict';
    const alvo = P2.iniciar({ active: 'produtividade', titulo: 'Produtividade', sub: 'Apreensões e prisões' });
    if (!alvo) return;
    const esc = P2.esc, sb = P2.sb;
    const dataBr = v => { const m = String(v || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? m[3] + '/' + m[2] + '/' + m[1] : (v || ''); };
    const num = v => (v == null ? 0 : (+v || 0));

    let REG = [], EQ = {};

    alvo.innerHTML = `<div class="p2-page-head"><h1><i class="fa-solid fa-chart-line"></i> Produtividade</h1>
        <p>Resultados operacionais — apreensões de armas, drogas, veículos e valores, e prisões/conduções.</p></div>
        <div id="pr-body"><div class="p2-empty"><div class="ic">⏳</div><p>Carregando…</p></div></div>
        <div class="pd-modal" id="pr-modal"><div class="pd-modal-box">
            <div class="pd-modal-h"><h2 id="pr-det-tit">Registro</h2><button class="fechar" id="pr-det-fechar">✕</button></div>
            <div class="pd-modal-b" id="pr-det-body"></div>
            <div class="pd-modal-f"><button class="p2-btn" id="pr-det-fechar2">Fechar</button></div>
        </div></div>`;

    carregar();

    async function carregar() {
        const g = (t, q) => sb.get(t, q).catch(() => []);
        const c = (t, f) => sb.count(t, f).catch(() => null);
        const [reg, eqs, nPreso, nCond, nArmas, nDrogas, nVeic, valores] = await Promise.all([
            g('tb_produtividade', 'select=id,data_fato,numero,tipo_registro,tipificacao,houve_apreensao,equipe_id,observacoes,destino_pessoas,destino_materiais&order=data_fato.desc.nullslast&limit=1200'),
            g('tb_equipes', 'select=id,nome'),
            c('tb_produtividade_pessoas', 'is_preso=eq.true'),
            c('tb_produtividade_pessoas', 'is_conduzido=eq.true'),
            c('tb_produtividade_armas'), c('tb_produtividade_drogas'), c('tb_produtividade_veiculos'),
            g('tb_produtividade_valores', 'select=valor&limit=5000'),
        ]);
        REG = reg || []; (eqs || []).forEach(e => EQ[e.id] = e.nome);
        const valTotal = (valores || []).reduce((s, v) => s + num(v.valor), 0);
        render({ nPreso, nCond, nArmas, nDrogas, nVeic, valTotal });
    }

    function render(k) {
        const comApre = REG.filter(r => r.houve_apreensao).length;
        const porTipo = agrupar(REG, 'tipo_registro');
        const porTipif = agrupar(REG, 'tipificacao').slice(0, 10);
        const kpi = (ic, val, lab, cor) => `<div class="p2-kpi"><div class="p2-kpi-ic" style="color:${cor || 'var(--p2-accent)'}">${ic}</div>
            <div class="p2-kpi-val">${val}</div><div class="p2-kpi-lab">${esc(lab)}</div></div>`;
        const fmtMoeda = v => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        document.getElementById('pr-body').innerHTML = `
            <div class="p2-kpis">
                ${kpi('<i class="fa-solid fa-clipboard-check"></i>', REG.length.toLocaleString('pt-BR'), 'Registros')}
                ${kpi('<i class="fa-solid fa-handcuffs"></i>', k.nPreso ?? '—', 'Presos', '#c92a2a')}
                ${kpi('<i class="fa-solid fa-user-lock"></i>', k.nCond ?? '—', 'Conduzidos', '#e8590c')}
                ${kpi('<i class="fa-solid fa-gun"></i>', k.nArmas ?? '—', 'Armas', '#5f3dc4')}
                ${kpi('<i class="fa-solid fa-cannabis"></i>', k.nDrogas ?? '—', 'Apreensões de droga', '#2b8a3e')}
                ${kpi('<i class="fa-solid fa-car"></i>', k.nVeic ?? '—', 'Veículos')}
                ${kpi('<i class="fa-solid fa-sack-dollar"></i>', fmtMoeda(k.valTotal), 'Valores apreendidos', '#2f9e44')}
                ${kpi('<i class="fa-solid fa-box-archive"></i>', comApre.toLocaleString('pt-BR'), 'Com apreensão')}
            </div>
            <div class="pd-cols">
                <div class="pd-card"><h2><i class="fa-solid fa-layer-group"></i> Por tipo de registro</h2>${barras(porTipo)}</div>
                <div class="pd-card"><h2><i class="fa-solid fa-scale-balanced"></i> Por tipificação <span class="cont">top 10</span></h2>${barras(porTipif)}</div>
            </div>
            <div class="pd-card"><h2><i class="fa-solid fa-list"></i> Registros recentes <span class="cont">${Math.min(REG.length, 150)}</span></h2>
                <div class="pd-tbl-wrap"><table class="pd-tbl"><thead><tr><th>Data</th><th>Nº</th><th>Tipo</th><th>Tipificação</th><th>Equipe</th><th>Apre.</th></tr></thead>
                <tbody id="pr-tbody"></tbody></table></div></div>`;

        const tb = document.getElementById('pr-tbody');
        tb.innerHTML = REG.slice(0, 150).map((r, i) => `<tr data-i="${i}">
            <td>${esc(dataBr(r.data_fato))}</td><td><b>${esc(r.numero || '—')}</b></td>
            <td>${esc(r.tipo_registro || '')}</td><td>${esc((r.tipificacao || '').slice(0, 40))}</td>
            <td>${esc(EQ[r.equipe_id] || '')}</td><td>${r.houve_apreensao ? '<i class="fa-solid fa-check" style="color:var(--p2-green)"></i>' : '—'}</td></tr>`).join('')
            || '<tr><td colspan="6" style="color:var(--p2-txt-dim2)">Nenhum registro.</td></tr>';
        tb.querySelectorAll('tr[data-i]').forEach(tr => tr.onclick = () => detalhe(REG[+tr.dataset.i]));
        document.getElementById('pr-det-fechar').onclick = document.getElementById('pr-det-fechar2').onclick = () => document.getElementById('pr-modal').classList.remove('aberto');
    }

    function agrupar(rows, campo) {
        const m = {}; rows.forEach(r => { const k = (r[campo] || '—').toString().slice(0, 40); m[k] = (m[k] || 0) + 1; });
        return Object.entries(m).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
    }
    function barras(arr) {
        if (!arr.length) return '<div style="color:var(--p2-txt-dim2);font-size:.82rem">Sem dados.</div>';
        const max = Math.max(...arr.map(a => a.v)) || 1;
        return '<div class="pd-bars">' + arr.map(a => `<div class="pd-bar"><span class="lb" title="${esc(a.k)}">${esc(a.k)}</span>
            <span class="tk"><span class="fl" style="width:${Math.round(a.v / max * 100)}%"></span></span>
            <span class="vl">${a.v}</span></div>`).join('') + '</div>';
    }

    async function detalhe(r) {
        document.getElementById('pr-det-tit').textContent = 'Registro ' + (r.numero || '');
        const body = document.getElementById('pr-det-body');
        const lin = (a, b) => b ? `<div class="pd-linha"><b>${esc(a)}</b><span>${esc(b)}</span></div>` : '';
        body.innerHTML = lin('Data', dataBr(r.data_fato)) + lin('Tipo', r.tipo_registro) + lin('Tipificação', r.tipificacao)
            + lin('Equipe', EQ[r.equipe_id]) + lin('Apreensão', r.houve_apreensao ? 'Sim' : 'Não')
            + lin('Destino pessoas', r.destino_pessoas) + lin('Destino materiais', r.destino_materiais)
            + lin('Observações', r.observacoes) + '<div style="margin-top:10px;color:var(--p2-txt-dim2);font-size:.8rem">Carregando itens…</div>';
        document.getElementById('pr-modal').classList.add('aberto');
        const g = (t) => sb.get(t, 'produtividade_id=eq.' + r.id).catch(() => []);
        const [drogas, armas, veic, pes, val] = await Promise.all([
            g('tb_produtividade_drogas'), g('tb_produtividade_armas'), g('tb_produtividade_veiculos'),
            g('tb_produtividade_pessoas'), g('tb_produtividade_valores'),
        ]);
        let itens = '';
        if (armas.length) itens += bloco('Armas', armas.map(a => [a.tipo, a.calibre, a.numero_arma, a.quantidade ? 'x' + a.quantidade : ''].filter(Boolean).join(' · ')));
        if (drogas.length) itens += bloco('Drogas', drogas.map(d => [d.tipo, (d.quantidade != null ? d.quantidade : '') + (d.unidade || '')].filter(Boolean).join(' — ')));
        if (veic.length) itens += bloco('Veículos', veic.map(v => [v.placa, v.modelo, v.cor, v.classificacao].filter(Boolean).join(' · ')));
        if (val.length) itens += bloco('Valores', val.map(v => (v.moeda || 'R$') + ' ' + num(v.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })));
        if (pes.length) itens += bloco('Pessoas', pes.map(p => p.is_preso ? 'Preso' : (p.is_conduzido ? 'Conduzido' : 'Envolvido')));
        body.querySelector('div[style*="Carregando"]')?.remove();
        body.insertAdjacentHTML('beforeend', itens || '<div style="margin-top:10px;color:var(--p2-txt-dim2);font-size:.8rem">Sem itens vinculados.</div>');
    }
    function bloco(t, arr) {
        return `<div style="margin-top:12px"><div style="font-size:.74rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--p2-txt-dim2);margin-bottom:5px">${esc(t)}</div>`
            + arr.map(x => `<div class="fa-item" style="padding:6px 0;border-top:1px solid var(--p2-line);font-size:.82rem">${esc(x)}</div>`).join('') + '</div>';
    }
})();
