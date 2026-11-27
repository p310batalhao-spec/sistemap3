/* ====================================================================
   P2 · Ficha Alvo — dossiê completo do alvo (reescrita nativa do Echelon)
   Dados + apelidos + facção/ORCRIM + vínculos + denúncias + mandados +
   veículos + fotos + observações. Lê o Supabase do Echelon; fotos pelo
   bucket privado 'midia' (URL assinada). Impressão do dossiê.
   ==================================================================== */
(function () {
    'use strict';
    const alvo = P2.iniciar({ active: 'ficha-alvo', titulo: 'Ficha Alvo', sub: 'Dossiê de inteligência' });
    if (!alvo) return;
    const esc = P2.esc, sb = P2.sb;
    const pid = new URLSearchParams(location.search).get('pessoa_id') || '';
    let CAD = null; // resultado da consulta integrada (CAD/TJAL/BNMP)

    const dataBr = v => { const m = String(v || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? m[3] + '/' + m[2] + '/' + m[1] : (v || ''); };
    const sanitize = html => { const t = document.createElement('div'); t.innerHTML = String(html || ''); t.querySelectorAll('script,style,iframe,img,link').forEach(e => e.remove()); t.querySelectorAll('*').forEach(el => { [...el.attributes].forEach(a => { if (/^on/i.test(a.name) || /^(href|src|style)$/i.test(a.name)) el.removeAttribute(a.name); }); if (!['B', 'STRONG', 'U', 'I', 'EM', 'BR', 'P', 'DIV', 'SPAN', 'UL', 'OL', 'LI'].includes(el.tagName)) el.replaceWith(...el.childNodes); }); return t.innerHTML; };

    if (!pid) {
        alvo.innerHTML = `<div class="p2-empty"><div class="ic">🪪</div><h3>Nenhum alvo selecionado</h3>
            <p>Abra uma ficha pela <a href="p2-consulta-global.html" style="color:var(--p2-accent)">Consulta Global</a>.</p></div>`;
        return;
    }
    alvo.innerHTML = `<div class="p2-empty"><div class="ic">⏳</div><p>Carregando dossiê…</p></div><div id="fa-print"></div>`;
    carregar();

    async function carregar() {
        let pessoa;
        try {
            const ps = await sb.get('tb_pessoas', 'select=*&id=eq.' + encodeURIComponent(pid) + '&limit=1');
            pessoa = ps && ps[0];
            if (!pessoa) throw new Error('Alvo não encontrado.');
        } catch (e) {
            alvo.innerHTML = `<div class="p2-empty"><div class="ic">⚠️</div><h3>Não foi possível carregar</h3><p>${esc(e.message)}</p></div><div id="fa-print"></div>`;
            return;
        }
        const g = (t, q) => sb.get(t, q).catch(() => []);
        const [apelidos, faccoes, orcrim, vincRaw, denun, mand, veic, imgs] = await Promise.all([
            g('tb_pessoa_apelidos', 'select=apelido&pessoa_id=eq.' + pid),
            g('tb_faccao_pessoas', 'select=funcao,is_ativa,data_inicio,faccao:tb_faccoes(nome,tipo_grupo)&pessoa_id=eq.' + pid),
            g('tb_orcrim_pessoas', 'select=funcao,is_ativa,orcrim:tb_orcrim(nome)&pessoa_id=eq.' + pid),
            g('tb_pessoa_vinculos', 'select=*&or=(pessoa_origem_id.eq.' + pid + ',pessoa_destino_id.eq.' + pid + ')'),
            g('tb_denuncia_pessoas', 'select=denuncia:tb_denuncias(id,numero,tipo,data_denuncia,status_operacional)&pessoa_id=eq.' + pid),
            g('tb_mandado_pessoas', 'select=papel,mandado:tb_mandados(numero_mandado,tipo_mandado,status,situacao_judicial,tipo_crime,vara_comarca)&pessoa_id=eq.' + pid),
            g('tb_veiculos', 'select=placa,modelo,cor&proprietario_id=eq.' + pid),
            g('tb_imagens', 'select=id,arquivo_path,thumb_path,is_principal,legenda&entidade_tipo=eq.pessoa&pessoa_id=eq.' + pid),
        ]);

        // Resolve nomes das outras pontas dos vínculos.
        const outros = [...new Set(vincRaw.map(v => String(v.pessoa_origem_id) === pid ? v.pessoa_destino_id : v.pessoa_origem_id).filter(Boolean))];
        let nomes = {};
        if (outros.length) { const ns = await g('tb_pessoas', 'select=id,nome_completo&id=in.(' + outros.join(',') + ')'); ns.forEach(p => nomes[p.id] = p.nome_completo); }
        const vinculos = vincRaw.map(v => {
            const outroId = String(v.pessoa_origem_id) === pid ? v.pessoa_destino_id : v.pessoa_origem_id;
            return { nome: nomes[outroId] || '(alvo)', tipo: v.tipo_vinculo || v.subtipo_vinculo || 'Vínculo', sub: v.subtipo_vinculo, obs: v.observacao, ativo: v.ativo, outroId };
        });

        // Fotos (bucket privado 'midia' → URL assinada).
        const fotos = (await Promise.all((imgs || []).map(async im => {
            const p = im.thumb_path || im.arquivo_path; if (!p) return null;
            const url = await sb.signUrl('midia', p, 1800).catch(() => null);
            return url ? { url, principal: im.is_principal, legenda: im.legenda } : null;
        }))).filter(Boolean);
        fotos.sort((a, b) => (b.principal ? 1 : 0) - (a.principal ? 1 : 0));

        render({ pessoa, apelidos: apelidos.map(a => a.apelido).filter(Boolean), faccoes, orcrim, vinculos, denun: denun.map(d => d.denuncia).filter(Boolean), mand, veic, fotos });
    }

    function render(d) {
        const p = d.pessoa;
        const cpfDig = (p.cpf || '').replace(/\D/g, '');
        const fotoPrincipal = d.fotos[0];
        const dado = (k, v) => v ? `<div><b>${k}:</b>${esc(v)}</div>` : '';
        const chips = [];
        d.faccoes.forEach(f => { if (f.faccao) chips.push(`<span class="fa-chip fac"><i class="fa-solid fa-flag"></i> ${esc(f.faccao.nome)}${f.funcao ? ' · ' + esc(f.funcao) : ''}</span>`); });
        d.orcrim.forEach(o => { if (o.orcrim) chips.push(`<span class="fa-chip orcrim"><i class="fa-solid fa-sitemap"></i> ${esc(o.orcrim.nome)}</span>`); });
        const mandAtivos = d.mand.filter(m => m.mandado && /ativ|aberto|cumprir/i.test((m.mandado.status || '') + (m.mandado.situacao_judicial || '')));
        if (mandAtivos.length) chips.push(`<span class="fa-chip mand"><i class="fa-solid fa-handcuffs"></i> ${mandAtivos.length} mandado(s)</span>`);

        const secVinculos = d.vinculos.length ? d.vinculos.map(v => `<div class="fa-item"><a href="p2-ficha-alvo.html?pessoa_id=${esc(v.outroId)}"><b>${esc(v.nome)}</b></a>
            <small>${esc(v.tipo)}${v.sub && v.sub !== v.tipo ? ' · ' + esc(v.sub) : ''}${v.obs ? ' — ' + esc(v.obs) : ''}</small></div>`).join('') : vazio();
        const secDenun = d.denun.length ? d.denun.map(x => `<div class="fa-item"><b>Nº ${esc(x.numero || '—')}</b> — ${esc(x.tipo || '')}
            <small>${esc(dataBr(x.data_denuncia))} · ${esc(x.status_operacional || '')}</small></div>`).join('') : vazio();
        const secMand = d.mand.length ? d.mand.map(m => m.mandado ? `<div class="fa-item"><b>${esc(m.mandado.numero_mandado || 'Mandado')}</b> — ${esc(m.mandado.tipo_mandado || '')}
            <small>${esc([m.papel, m.mandado.tipo_crime, m.mandado.situacao_judicial || m.mandado.status, m.mandado.vara_comarca].filter(Boolean).join(' · '))}</small></div>` : '').join('') : vazio();
        const secVeic = d.veic.length ? d.veic.map(v => `<div class="fa-item"><b>${esc(v.placa || '—')}</b> — ${esc([v.modelo, v.cor].filter(Boolean).join(' · '))}</div>`).join('') : vazio();
        const secFac = (d.faccoes.length || d.orcrim.length) ?
            d.faccoes.map(f => f.faccao ? `<div class="fa-item"><b>${esc(f.faccao.nome)}</b> <small>${esc([f.funcao, f.faccao.tipo_grupo, f.is_ativa ? 'ativo' : 'inativo'].filter(Boolean).join(' · '))}</small></div>` : '').join('')
            + d.orcrim.map(o => o.orcrim ? `<div class="fa-item"><b>${esc(o.orcrim.nome)}</b> <small>ORCRIM${o.funcao ? ' · ' + esc(o.funcao) : ''}</small></div>` : '').join('') : vazio();
        const secFotos = d.fotos.length ? '<div class="fa-fotos">' + d.fotos.map(f => `<img src="${esc(f.url)}" alt="${esc(f.legenda || '')}" title="${esc(f.legenda || '')}" onclick="window.open('${esc(f.url)}','_blank')">`).join('') + '</div>' : vazio('Sem fotos cadastradas.');

        alvo.innerHTML = `
            <div class="fa-top">
                ${fotoPrincipal ? `<img class="fa-foto" src="${esc(fotoPrincipal.url)}" alt="foto">` : `<div class="fa-foto"><i class="fa-solid fa-user"></i></div>`}
                <div class="fa-ident">
                    <h1>${esc(p.nome_completo || 'Sem nome')}</h1>
                    ${d.apelidos.length ? `<div class="fa-vulgo"><i class="fa-solid fa-flag"></i> ${esc(d.apelidos.join(' · '))}</div>` : ''}
                    <div class="fa-dados">
                        ${dado('CPF', p.cpf)}${dado('RG', p.rg)}${dado('Nascimento', dataBr(p.data_nascimento))}
                        ${dado('Sexo', p.sexo)}${dado('Mãe', p.nome_mae)}${dado('Pai', p.nome_pai)}
                        ${dado('Naturalidade', [p.naturalidade_cidade, p.naturalidade_uf].filter(Boolean).join('/'))}
                        ${dado('Profissão', p.profissao)}${dado('Situação', p.situacao)}
                    </div>
                    ${chips.length ? `<div class="fa-chips">${chips.join('')}</div>` : ''}
                </div>
                <div class="fa-acoes">
                    <a class="p2-btn" href="p2-consulta-global.html">🔎 Nova busca</a>
                    <button class="p2-btn pri" id="fa-imprimir">🖨️ Imprimir dossiê</button>
                </div>
            </div>
            <div class="fa-cols">
                <div style="display:flex;flex-direction:column;gap:16px">
                    <div class="fa-sec"><h2><i class="fa-solid fa-diagram-project"></i> Vínculos <span class="cont">${d.vinculos.length}</span></h2>${secVinculos}</div>
                    <div class="fa-sec"><h2><i class="fa-solid fa-phone-volume"></i> Denúncias <span class="cont">${d.denun.length}</span></h2>${secDenun}</div>
                    <div class="fa-sec"><h2><i class="fa-solid fa-handcuffs"></i> Mandados <span class="cont">${d.mand.length}</span></h2>${secMand}</div>
                </div>
                <div style="display:flex;flex-direction:column;gap:16px">
                    <div class="fa-sec"><h2><i class="fa-solid fa-people-group"></i> Facção / ORCRIM</h2>${secFac}</div>
                    <div class="fa-sec"><h2><i class="fa-solid fa-car"></i> Veículos <span class="cont">${d.veic.length}</span></h2>${secVeic}</div>
                    <div class="fa-sec"><h2><i class="fa-solid fa-images"></i> Fotos <span class="cont">${d.fotos.length}</span></h2>${secFotos}</div>
                    ${p.observacoes ? `<div class="fa-sec"><h2><i class="fa-solid fa-note-sticky"></i> Observações</h2><div class="fa-rich">${sanitize(p.observacoes)}</div></div>` : ''}
                </div>
            </div>
            <div class="fa-sec" id="fa-cad" style="margin-top:16px">
                <h2><i class="fa-solid fa-magnifying-glass-chart"></i> Consulta Integrada <span class="cont">CAD · TJAL · BNMP</span></h2>
                <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
                    <button class="p2-btn pri" id="fa-cad-btn"${cpfDig ? '' : ' disabled'}><i class="fa-solid fa-magnifying-glass"></i> ${cpfDig ? 'Consultar CPF ' + esc(p.cpf) : 'Sem CPF cadastrado'}</button>
                    <span style="font-size:.78rem;color:var(--p2-txt-dim2)">Cruza CAD (PPE/PC/SISPOL/BNMP/IDNET), TJAL e inteligência deste alvo — disponível no app (exe).</span>
                </div>
                <div id="fa-cad-res" style="margin-top:12px"></div>
            </div>`;
        document.getElementById('fa-imprimir').onclick = () => imprimir(d);
        const _cadBtn = document.getElementById('fa-cad-btn');
        if (_cadBtn) _cadBtn.onclick = () => consultarCad(cpfDig, d);
    }
    const vazio = t => `<div class="fa-vazio">${esc(t || 'Nada registrado.')}</div>`;

    function imprimir(d) {
        const p = d.pessoa;
        const campo = (r, v) => v ? `<div class="fa-doc-campo"><b>${esc(r)}:</b><span>${esc(v)}</span></div>` : '';
        const li = arr => arr.length ? '<ul>' + arr.join('') + '</ul>' : '<div class="fa-vazio">—</div>';
        P2.imprimirDoc(`
            <div class="fa-doc">
                <div class="fa-doc-cab"><img src="../img/brasao.png" onerror="this.style.display='none'">
                    <div><h1>POLÍCIA MILITAR DE ALAGOAS — 10º BPM</h1><h2>Seção de Inteligência (P2) — Ficha Alvo</h2></div></div>
                <h3>QUALIFICAÇÃO</h3>
                ${campo('Nome', p.nome_completo)}${d.apelidos.length ? campo('Vulgo', d.apelidos.join(' · ')) : ''}
                ${campo('CPF', p.cpf)}${campo('RG', p.rg)}${campo('Nascimento', dataBr(p.data_nascimento))}
                ${campo('Mãe', p.nome_mae)}${campo('Pai', p.nome_pai)}
                ${campo('Naturalidade', [p.naturalidade_cidade, p.naturalidade_uf].filter(Boolean).join('/'))}
                <h3>FACÇÃO / ORCRIM</h3>${li(d.faccoes.map(f => f.faccao ? `<li>${esc(f.faccao.nome)}${f.funcao ? ' — ' + esc(f.funcao) : ''}</li>` : '').concat(d.orcrim.map(o => o.orcrim ? `<li>${esc(o.orcrim.nome)} (ORCRIM)</li>` : '')).filter(Boolean))}
                <h3>VÍNCULOS</h3>${li(d.vinculos.map(v => `<li>${esc(v.nome)} — ${esc(v.tipo)}</li>`))}
                <h3>DENÚNCIAS</h3>${li(d.denun.map(x => `<li>Nº ${esc(x.numero || '—')} — ${esc(x.tipo || '')} (${esc(x.status_operacional || '')})</li>`))}
                <h3>MANDADOS</h3>${li(d.mand.map(m => m.mandado ? `<li>${esc(m.mandado.numero_mandado || '')} — ${esc(m.mandado.tipo_mandado || '')} (${esc(m.mandado.situacao_judicial || m.mandado.status || '')})</li>` : '').filter(Boolean))}
                <h3>VEÍCULOS</h3>${li(d.veic.map(v => `<li>${esc(v.placa || '')} — ${esc([v.modelo, v.cor].filter(Boolean).join(' · '))}</li>`))}
                ${cadDoc(CAD)}
                <div class="fa-doc-rodape" style="margin-top:18px;font-size:11px;color:#555;border-top:1px solid #ccc;padding-top:8px;text-align:center">Documento gerado pelo Sistema P3 — Módulo P2 · ${new Date().toLocaleString('pt-BR')}</div>
            </div>`);
    }

    // ── Consulta Integrada (CAD/TJAL/BNMP) via backend local (exe) ────
    const resumoItem = o => Object.values(o || {}).filter(v => v && (typeof v === 'string' || typeof v === 'number')).map(String).slice(0, 7).join(' · ');
    const avisoBox = t => `<div style="font-size:.82rem;color:var(--p2-amber);background:var(--p2-amber-soft);border:1px solid rgba(255,160,40,.3);border-radius:8px;padding:9px 12px">${esc(t)}</div>`;
    const blocoCad = (t, arr) => arr.length ? `<div style="margin-top:12px"><div style="font-size:.74rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--p2-txt-dim2);margin-bottom:5px">${esc(t)}</div>${arr.map(x => `<div style="padding:6px 0;border-top:1px solid var(--p2-line);font-size:.82rem">${x}</div>`).join('')}</div>` : '';

    async function consultarCad(cpf, d) {
        const btn = document.getElementById('fa-cad-btn'), res = document.getElementById('fa-cad-res');
        if (!cpf) return;
        if (!window.P3AtualizadorLocal || !P3AtualizadorLocal.consultarPessoaStream) { res.innerHTML = avisoBox('Consulta integrada disponível apenas no aplicativo (exe) do Sistema P3 — o navegador não acessa o CAD/TJAL/BNMP.'); return; }
        const txt = btn.innerHTML; btn.disabled = true;
        res.innerHTML = `<div class="fa-vazio" id="fa-cad-prog">⏳ Consultando CAD/TJAL/BNMP…</div>`;
        try {
            const r = await P3AtualizadorLocal.consultarPessoaStream(cpf, ev => {
                const pr = document.getElementById('fa-cad-prog');
                if (pr && ev && ev.etapa) pr.textContent = '⏳ ' + ev.etapa + '…';
            });
            if (!r || r.ok === false) { res.innerHTML = avisoBox((r && r.erro) || 'Não foi possível consultar.'); btn.disabled = false; btn.innerHTML = txt; return; }
            CAD = r;
            res.innerHTML = renderCad(r);
            btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Consultar de novo';
            const imp = document.getElementById('fa-imprimir'); if (imp) imp.innerHTML = '🖨️ Imprimir dossiê + consulta';
        } catch (e) { res.innerHTML = avisoBox('Erro na consulta: ' + e.message); btn.disabled = false; btn.innerHTML = txt; }
    }
    function renderCad(r) {
        const p = r.pessoa || {}, mand = r.mandados || {};
        const totOc = (r.ocorrenciasPpe || []).length + (r.ocorrenciasPcAntigo || []).length + (r.ocorrenciasDespacho || []).length;
        const kpi = (ic, v, l, cor) => `<div class="p2-kpi" style="padding:12px 14px"><div class="p2-kpi-ic" style="color:${cor || 'var(--p2-accent)'}">${ic}</div><div class="p2-kpi-val" style="font-size:1.3rem">${v}</div><div class="p2-kpi-lab">${esc(l)}</div></div>`;
        let h = `<div class="p2-kpis" style="margin-bottom:6px">
            ${kpi('<i class="fa-solid fa-triangle-exclamation"></i>', totOc, 'Ocorrências', '#e8590c')}
            ${kpi('<i class="fa-solid fa-scale-balanced"></i>', (r.processos || []).length, 'Processos', '#1864ab')}
            ${kpi('<i class="fa-solid fa-car"></i>', (r.veiculos || []).length, 'Veículos', '#5f3dc4')}
            ${kpi('<i class="fa-solid fa-handcuffs"></i>', mand.possuiMandado ? 'SIM' : (mand.indeterminado ? '?' : 'não'), 'Mandado BNMP', mand.possuiMandado ? '#c92a2a' : 'var(--p2-txt-dim2)')}</div>`;
        if (mand.possuiMandado) { const lista = (Array.isArray(mand.mandados) && mand.mandados.length) ? mand.mandados : [mand.detalhe]; h += `<div class="pm-reinc" style="color:#c92a2a;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);border-radius:8px;padding:9px 12px;margin-top:10px"><b>🚨 Mandado de prisão (BNMP):</b> ` + lista.map(det => esc(Object.entries(det || {}).map(([k, v]) => k + ': ' + v).join(' · '))).join('<br>') + '</div>'; }
        else if (mand.indeterminado) h += avisoBox('Mandado BNMP: não foi possível confirmar agora — reconsulte em alguns segundos.');
        const ident = []; if (p.mae) ident.push('Mãe: ' + esc(p.mae)); if (p.pai) ident.push('Pai: ' + esc(p.pai)); if (p.cnh) ident.push('CNH localizada');
        h += blocoCad('Identificação (CAD)', ident);
        h += blocoCad('Processos (TJAL)', (r.processos || []).slice(0, 15).map(pr => esc(resumoItem(pr))));
        h += blocoCad('Veículos', (r.veiculos || []).slice(0, 20).map(v => esc(resumoItem(v))));
        return h;
    }
    function cadDoc(r) {
        if (!r || r.ok === false) return '';
        const mand = r.mandados || {};
        const li = arr => arr.length ? '<ul>' + arr.map(x => `<li>${x}</li>`).join('') + '</ul>' : '<div class="fa-vazio">—</div>';
        const totOc = (r.ocorrenciasPpe || []).length + (r.ocorrenciasPcAntigo || []).length + (r.ocorrenciasDespacho || []).length;
        let h = `<h3>CONSULTA INTEGRADA (CAD · TJAL · BNMP)</h3>
            <div class="fa-doc-campo"><b>Ocorrências:</b><span>${totOc}</span></div>
            <div class="fa-doc-campo"><b>Processos:</b><span>${(r.processos || []).length}</span></div>
            <div class="fa-doc-campo"><b>Veículos:</b><span>${(r.veiculos || []).length}</span></div>
            <div class="fa-doc-campo"><b>Mandado BNMP:</b><span>${mand.possuiMandado ? 'SIM — mandado em aberto' : (mand.indeterminado ? 'não confirmado' : 'nada consta')}</span></div>`;
        if (mand.possuiMandado) { const lista = (Array.isArray(mand.mandados) && mand.mandados.length) ? mand.mandados : [mand.detalhe]; h += '<h3>MANDADO DE PRISÃO</h3>' + li(lista.map(det => esc(Object.entries(det || {}).map(([k, v]) => k + ': ' + v).join(' · ')))); }
        if ((r.processos || []).length) h += '<h3>PROCESSOS (TJAL)</h3>' + li(r.processos.slice(0, 20).map(pr => esc(resumoItem(pr))));
        if ((r.veiculos || []).length) h += '<h3>VEÍCULOS</h3>' + li(r.veiculos.slice(0, 20).map(v => esc(resumoItem(v))));
        return h;
    }
})();
