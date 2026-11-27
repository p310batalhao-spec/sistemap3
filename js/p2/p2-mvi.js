/* ====================================================================
   P2 · MVI — Mortes Violentas Intencionais (reescrita nativa do Echelon)
   Dashboard: dias sem CVLI/homicídio por cidade, totais por categoria e
   cidade (ano), e lista de ocorrências com detalhe. Lê tb_mvi_ocorrencias
   e as views vw_mvi_* do Supabase do Echelon.
   ==================================================================== */
(function () {
    'use strict';
    const alvo = P2.iniciar({ active: 'mvi', titulo: 'MVI — Mortes Violentas Intencionais', sub: 'Monitoramento de CVLI' });
    if (!alvo) return;
    const esc = P2.esc, sb = P2.sb;

    const dataBr = v => { const m = String(v || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? m[3] + '/' + m[2] + '/' + m[1] : (v || ''); };
    let TOTAIS = [], DIAS = [], OCOR = [], anos = [], anoSel = '', cidadeSel = 'todas';

    alvo.innerHTML = `<div class="p2-page-head"><h1><i class="fa-solid fa-skull"></i> MVI — Mortes Violentas Intencionais</h1>
        <p>Acompanhamento de CVLI do 10º BPM — dias sem ocorrência por cidade, totais e as últimas ocorrências registradas.</p></div>
        <div id="mvi-body"><div class="p2-empty"><div class="ic">⏳</div><p>Carregando…</p></div></div>
        <div class="pd-modal" id="mvi-modal"><div class="pd-modal-box">
            <div class="pd-modal-h"><h2 id="mvi-det-tit">Ocorrência</h2><button class="fechar" id="mvi-det-fechar">✕</button></div>
            <div class="pd-modal-b" id="mvi-det-body"></div>
            <div class="pd-modal-f"><button class="p2-btn" id="mvi-det-fechar2">Fechar</button></div>
        </div></div>`;

    carregar();

    async function carregar() {
        const g = (t, q) => sb.get(t, q).catch(() => []);
        [TOTAIS, DIAS, OCOR] = await Promise.all([
            g('vw_mvi_totais_cidade_ano', 'select=ano,categoria,cidade,total'),
            g('vw_mvi_dias_sem_cvli', 'select=cidade,dias_sem_cvli,ultimo_cvli_em'),
            g('tb_mvi_ocorrencias', 'select=id,data_fato,categoria,cidade_fato,bairro_fato,nome_vitima,mae_vitima,sexo_vitima,bo,fonte,observacao_interna,tags&order=data_fato.desc.nullslast&limit=400'),
        ]);
        anos = [...new Set(TOTAIS.map(t => t.ano).filter(Boolean))].sort((a, b) => b - a);
        anoSel = anos[0] || '';
        render();
    }

    function render() {
        const totAno = TOTAIS.filter(t => String(t.ano) === String(anoSel));
        const totalAno = totAno.reduce((s, r) => s + (r.total || 0), 0);
        const homi = totAno.filter(r => /homic|cvli|lat/i.test(r.categoria || '')).reduce((s, r) => s + (r.total || 0), 0);
        const cidades = [...new Set(totAno.map(r => r.cidade).filter(Boolean))];

        const porCat = agrupar(totAno, 'categoria');
        const porCid = agrupar(totAno, 'cidade').slice(0, 10);
        const diasOrd = DIAS.slice().sort((a, b) => (a.dias_sem_cvli ?? 1e9) - (b.dias_sem_cvli ?? 1e9));

        const kpi = (ic, val, lab, cor) => `<div class="p2-kpi"><div class="p2-kpi-ic" style="color:${cor || 'var(--p2-accent)'}">${ic}</div>
            <div class="p2-kpi-val">${val}</div><div class="p2-kpi-lab">${esc(lab)}</div></div>`;

        document.getElementById('mvi-body').innerHTML = `
            <div class="pd-filtros">
                <label style="font-size:.8rem;color:var(--p2-txt-dim)">Ano:</label>
                <select class="pd-sel" id="mvi-ano">${anos.map(a => `<option value="${a}"${String(a) === String(anoSel) ? ' selected' : ''}>${a}</option>`).join('')}</select>
                <label style="font-size:.8rem;color:var(--p2-txt-dim);margin-left:8px">Cidade (lista):</label>
                <select class="pd-sel" id="mvi-cidade"><option value="todas">Todas</option>${[...new Set(OCOR.map(o => o.cidade_fato).filter(Boolean))].sort().map(c => `<option${c === cidadeSel ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
            </div>
            <div class="p2-kpis">
                ${kpi('<i class="fa-solid fa-skull-crossbones"></i>', totalAno.toLocaleString('pt-BR'), 'Total MVI em ' + anoSel, '#e03131')}
                ${kpi('<i class="fa-solid fa-person-rifle"></i>', homi.toLocaleString('pt-BR'), 'Homicídios/CVLI em ' + anoSel, '#c92a2a')}
                ${kpi('<i class="fa-solid fa-city"></i>', cidades.length, 'Cidades com registro')}
                ${kpi('<i class="fa-solid fa-database"></i>', OCOR.length.toLocaleString('pt-BR') + '+', 'Ocorrências carregadas')}
            </div>

            <h2 style="font-size:1rem;color:var(--p2-txt-strong);margin:4px 0 12px"><i class="fa-solid fa-calendar-check"></i> Dias sem CVLI por cidade</h2>
            <div class="pd-dias-grid">${diasOrd.length ? diasOrd.map(diaCard).join('') : '<div class="fa-vazio" style="color:var(--p2-txt-dim2)">Sem dados.</div>'}</div>

            <div class="pd-cols">
                <div class="pd-card"><h2><i class="fa-solid fa-layer-group"></i> Por categoria <span class="cont">${anoSel}</span></h2>${barras(porCat)}</div>
                <div class="pd-card"><h2><i class="fa-solid fa-city"></i> Por cidade <span class="cont">top 10 · ${anoSel}</span></h2>${barras(porCid)}</div>
            </div>

            <div class="pd-card"><h2><i class="fa-solid fa-list"></i> Últimas ocorrências <span class="cont" id="mvi-cont"></span></h2>
                <div class="pd-tbl-wrap"><table class="pd-tbl"><thead><tr><th>Data</th><th>Vítima</th><th>Cidade</th><th>Bairro</th><th>Categoria</th></tr></thead>
                <tbody id="mvi-tbody"></tbody></table></div></div>`;

        document.getElementById('mvi-ano').onchange = e => { anoSel = e.target.value; render(); };
        document.getElementById('mvi-cidade').onchange = e => { cidadeSel = e.target.value; renderTabela(); };
        document.getElementById('mvi-det-fechar').onclick = document.getElementById('mvi-det-fechar2').onclick = () => document.getElementById('mvi-modal').classList.remove('aberto');
        renderTabela();
    }

    function renderTabela() {
        let lista = OCOR.slice();
        if (cidadeSel !== 'todas') lista = lista.filter(o => o.cidade_fato === cidadeSel);
        lista = lista.slice(0, 120);
        document.getElementById('mvi-cont').textContent = lista.length + ' registro(s)';
        const tb = document.getElementById('mvi-tbody');
        tb.innerHTML = lista.map((o, i) => `<tr data-i="${OCOR.indexOf(o)}">
            <td>${esc(dataBr(o.data_fato))}</td><td><b>${esc(o.nome_vitima || '—')}</b></td>
            <td>${esc(o.cidade_fato || '')}</td><td>${esc(o.bairro_fato || '')}</td>
            <td>${esc(o.categoria || '')}</td></tr>`).join('') || '<tr><td colspan="5" style="color:var(--p2-txt-dim2)">Nenhuma ocorrência.</td></tr>';
        tb.querySelectorAll('tr[data-i]').forEach(tr => tr.onclick = () => detalhe(OCOR[+tr.dataset.i]));
    }

    function diaCard(d) {
        const n = d.dias_sem_cvli;
        const alerta = (n != null && n <= 7);
        return `<div class="pd-dias ${alerta ? 'alerta' : ''}">
            <div class="cidade"><i class="fa-solid fa-location-dot"></i> ${esc(d.cidade || '—')}</div>
            <div class="n">${n == null ? '—' : n}</div><div class="lab">dias sem CVLI</div>
            ${d.ultimo_cvli_em ? `<div class="ult">último: ${esc(dataBr(d.ultimo_cvli_em))}</div>` : ''}</div>`;
    }
    function agrupar(rows, campo) {
        const m = {}; rows.forEach(r => { const k = r[campo] || '—'; m[k] = (m[k] || 0) + (r.total || 0); });
        return Object.entries(m).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
    }
    function barras(arr) {
        if (!arr.length) return '<div style="color:var(--p2-txt-dim2);font-size:.82rem">Sem dados.</div>';
        const max = Math.max(...arr.map(a => a.v)) || 1;
        return '<div class="pd-bars">' + arr.map(a => `<div class="pd-bar"><span class="lb" title="${esc(a.k)}">${esc(a.k)}</span>
            <span class="tk"><span class="fl" style="width:${Math.round(a.v / max * 100)}%"></span></span>
            <span class="vl">${a.v.toLocaleString('pt-BR')}</span></div>`).join('') + '</div>';
    }
    function detalhe(o) {
        const lin = (r, v) => v ? `<div class="pd-linha"><b>${esc(r)}</b><span>${esc(v)}</span></div>` : '';
        document.getElementById('mvi-det-tit').textContent = o.nome_vitima || 'Ocorrência MVI';
        document.getElementById('mvi-det-body').innerHTML =
            lin('Data do fato', dataBr(o.data_fato)) + lin('Categoria', o.categoria) +
            lin('Cidade', o.cidade_fato) + lin('Bairro', o.bairro_fato) +
            lin('Vítima', o.nome_vitima) + lin('Mãe', o.mae_vitima) + lin('Sexo', o.sexo_vitima) +
            lin('BO', o.bo) + lin('Fonte', o.fonte) + lin('Tags', Array.isArray(o.tags) ? o.tags.join(', ') : o.tags) +
            lin('Observação', o.observacao_interna);
        document.getElementById('mvi-modal').classList.add('aberto');
    }
})();
