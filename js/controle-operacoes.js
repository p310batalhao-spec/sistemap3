// ═══════════════════════════════════════════════════════════════════
// CONTROLE DE OPERAÇÕES (page/controle-operacoes.html)
// ═══════════════════════════════════════════════════════════════════
// Painel de planejamento e controle das operações da UNIDADE LOGADA —
// tudo lido/gravado no Firebase e nas planilhas da própria unidade
// (P3.loadUnidadeConfig()), nunca no de outra:
//   · Operações  = OPOs salvas na OPO Inteligente (/cartoes_programa, tipo "opo")
//   · Eventos    = cadastro de Eventos (planilha cfg.gas.EVENTOS), só os de
//                  MÉDIO (501–1000) e GRANDE (>1000) porte — mesma regra de
//                  page/eventos.html e page/calendario.html
//   · Resultados = ocorrências, prisões, drogas, armas e materiais do CAD no
//                  período/horário/cidades de cada operação ou evento, pelo
//                  MESMO cálculo da aba "Controle de OPO" do Dashboard Cruzado
//                  (window.ControleOPO.calcular). Ficam gravados em
//                  /operacoes_resultados/<opo_ID | evt_ID> para o calendário e
//                  as estatísticas não recalcularem tudo a cada abertura.
// Visões: Visão Geral (KPIs do mês + calendário + programação), Estatísticas
// (filtros por período/cidade/tipo/porte + gráficos) e Relatório (impressão).
// ═══════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const NO_RES = 'operacoes_resultados';
    const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const COR = { opo: '#1f5fbf', 'MÉDIO': '#e67e22', GRANDE: '#c0392b' };

    let CFG = null, DB = null;
    let ITENS = [];            // operações + eventos normalizados
    let RES = {};              // resultados gravados { chave: resumo }
    let mesAtual = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })();
    let FILTRO = null;         // últimos filtros aplicados nas estatísticas
    const CHARTS = {};

    // ── Utilitários ─────────────────────────────────────────────────
    const nrm = s => (s == null ? '' : String(s)).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
    const val = v => { const s = (v == null ? '' : String(v)).trim(); return (s === '---' || s === '—') ? '' : s; };
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const fmtN = (n, d = 0) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
    const peso = g => g >= 1000 ? fmtN(g / 1000, 3) + ' kg' : fmtN(g, g % 1 ? 3 : 0) + ' g';
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const br = d => d ? d.toLocaleDateString('pt-BR') : '';
    const hoje0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
    function parseData(v) {
        const s = val(v);
        let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
        m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
        return null;
    }
    function hora(v) {
        const s = val(v); if (!s) return '';
        const m = s.match(/(\d{1,2}):(\d{2})/); if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
        const d = new Date(s); return isNaN(d) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    const chaveFb = s => String(s).replace(/[.#$\[\]\/]/g, '_');

    // ── Carga de dados ──────────────────────────────────────────────
    async function carregarOpos() {
        const d = await fetch(`${DB}/cartoes_programa.json`).then(r => r.ok ? r.json() : null);
        return Object.entries(d || {}).filter(([, o]) => o && o.tipo === 'opo').map(([id, o]) => {
            // Período: execução informada → texto da vigência ("15 a 18/10/2026") →
            // estimado. No calendário a OPO ocupa todos os dias do período; a
            // estimada (sem datas) aparece só no dia em que foi salva — a validade
            // de 1 mês pintaria o mês inteiro.
            const p = ControleOPO.periodoPadrao(o);
            const ini = parseData(p.ini), fimPlan = parseData(p.fimPlanejado);
            const dias = [];
            if (p.fonte === 'estimado') dias.push(iso(ini));
            else for (let x = new Date(ini); x <= fimPlan && dias.length < 62; x.setDate(x.getDate() + 1)) dias.push(iso(x));
            return {
                tipo: 'opo', id, chave: 'opo_' + chaveFb(id), raw: o,
                nome: o.nome || ('OPO ' + (o.cidade || '')), dias, ini, fim: p.fonte === 'estimado' ? parseData(p.fim) : fimPlan,
                hIni: p.hIni, hFim: p.hFim, cidades: ControleOPO.cidadesDaOpo(o),
                fonte: p.fonte, semExecucao: p.fonte === 'estimado', tiposCombate: o.tiposCombate || [],
                eventoId: o.eventoId || null, eventoNome: o.eventoNome || null, temDocumento: !!o.temDocumento,
                detalhe: [o.criadoPor && 'Criada por ' + o.criadoPor, o.vigenciaTexto && 'Vigência: ' + o.vigenciaTexto].filter(Boolean).join(' · '),
            };
        });
    }

    async function carregarEventos() {
        if (!CFG.gas || !CFG.gas.EVENTOS) return [];
        const d = await fetch(`${CFG.gas.EVENTOS}?action=read`, { redirect: 'follow' }).then(r => r.ok ? r.json() : []).catch(() => []);
        return (Array.isArray(d) ? d : []).map((e, i) => {
            const publico = parseInt(e['ESTIMATIVA DE PÚBLICO'], 10) || 0;
            const porte = publico > 1000 ? 'GRANDE' : publico > 500 ? 'MÉDIO' : null;
            const dt = parseData(e.DATA);
            if (!porte || !dt) return null;
            const id = e.ID || `${iso(dt)}_${i}`;
            return {
                tipo: 'evento', id, chave: 'evt_' + chaveFb(id), raw: e, porte, publico,
                nome: val(e['NOME DO EVENTO']) || 'Evento', dias: [iso(dt)], ini: dt, fim: dt,
                hIni: hora(e['HORÁRIO DE INÍCIO']), hFim: hora(e['HORÁRIO DE TÉRMINO']),
                cidades: [val(e.CIDADE)].filter(Boolean), local: val(e['LOCAL DO EVENTO']),
                guarnicoes: val(e.GUARNICOES), viaturas: val(e.VIATURAS),
                detalhe: [val(e['ORGANIZAÇÃO']) && 'Organização: ' + val(e['ORGANIZAÇÃO']), val(e['NOME DO RESPONSÁVEL']) && 'Responsável: ' + val(e['NOME DO RESPONSÁVEL'])].filter(Boolean).join(' · '),
            };
        }).filter(Boolean);
    }

    async function carregarTudo() {
        const [opos, eventos, res] = await Promise.all([
            carregarOpos(), carregarEventos(),
            fetch(`${DB}/${NO_RES}.json`).then(r => r.ok ? r.json() : null).catch(() => null),
        ]);
        ITENS = [...opos, ...eventos].sort((a, b) => a.ini - b.ini);
        RES = res || {};
        montarCidades();
    }

    // ── Resultados (CAD) ────────────────────────────────────────────
    // Dois recortes por operação (filtro no detalhe do dia):
    //   'horario' → só as ocorrências dentro do horário diário da operação
    //               (chave = it.chave — é o usado em KPIs/estatísticas/relatório)
    //   'dia'     → todas as ocorrências dos dias de vigência (chave = it.chave + '_dia')
    // Sem horário definido os dois são iguais e o filtro nem aparece.
    const podeCalcular = it => it.ini <= hoje0();
    const temHorario = it => !!(it.hIni && it.hFim && it.hIni !== it.hFim);
    const chaveRes = (it, modo) => modo === 'dia' && temHorario(it) ? it.chave + '_dia' : it.chave;
    const LS_MODO = 'p3_controle_operacoes_modo';
    let modoPadrao = (() => { try { return localStorage.getItem(LS_MODO) === 'dia' ? 'dia' : 'horario'; } catch (e) { return 'horario'; } })();
    const modoItem = {};
    const modoDe = it => modoItem[it.chave] || modoPadrao;
    const L_MAX = 500; // limite de linhas guardadas por lista
    async function computar(it, modo = 'horario') {
        const fim = it.fim > hoje0() ? hoje0() : it.fim;
        const parcial = it.fim >= hoje0(); // hoje ainda não terminou
        const diaInteiro = modo === 'dia' || !temHorario(it);
        const R = await ControleOPO.calcular({ nome: it.nome, ini: it.ini, fim, hIni: diaInteiro ? '' : it.hIni, hFim: diaInteiro ? '' : it.hFim, cidades: it.cidades });
        const k = R.kpi;
        const end = o => [val(o.LOGRADOURO), val(o.BAIRRO)].filter(Boolean).join(', ');
        const resumo = {
            tipo: it.tipo, refId: it.id, nome: it.nome, calculadoEm: new Date().toISOString(),
            ini: iso(it.ini), fim: iso(fim), hIni: diaInteiro ? '' : (it.hIni || ''), hFim: diaInteiro ? '' : (it.hFim || ''), cidades: it.cidades,
            parcial, modo: diaInteiro ? 'dia' : 'horario',
            kpi: { ocorrencias: k.ocorrencias[0], prisoes: k.prisoes[0], drogasG: +k.drogas[0].toFixed(3), armas: k.armas[0], materiais: k.materiais[0] },
            antes: { ocorrencias: k.ocorrencias[1], prisoes: k.prisoes[1], drogasG: +k.drogas[1].toFixed(3), armas: k.armas[1], materiais: k.materiais[1] },
            porTip: R.porTip.slice(0, 15), porCidade: R.porCidade.slice(0, 15),
            drogasPorTipo: R.drogasPorTipo, armasPorTipo: R.armasPorTipo, materiaisPorCat: R.materiaisPorCat, prisoesPorSit: R.prisoesPorSit,
            // Listas (sem nome de pessoa — ficam gravadas no Firebase da unidade)
            listaOcorrencias: R.ocorrencias.slice(0, L_MAX).map(o => ({ d: val(o.DATA), h: val(o.HORA), b: val(o.BOLETIM), c: val(o.CIDADE), e: end(o), t: val(o.TIPIFICACAO_GERAL) || val(o.TIPIFICACAO), s: val(o['SOLUÇÃO']) })),
            listaDrogas: R.drogas.slice(0, L_MAX).map(o => ({ d: val(o.DATA), h: val(o.HORA), b: val(o.BOLETIM), t: val(o.TIPO_DROGA), q: val(o.QUANTIDADE || o.PESO), u: val(o.UNIDADE_MEDIDA), c: val(o.CIDADE), x: val(o.OBSERVACAO) })),
            listaArmas: R.armas.slice(0, L_MAX).map(o => ({ d: val(o.DATA), h: val(o.HORA), b: val(o.BOLETIM), t: val(o.TIPO_ARMA), m: [val(o.MARCA), val(o.MODELO), val(o.CALIBRE)].filter(Boolean).join(' · '), s: val(o.SITUACAO_ARMA), c: val(o.CIDADE) })),
            listaMateriais: R.materiais.slice(0, L_MAX).map(o => ({ d: val(o.DATA), b: val(o['N° DO BOU']), t: val(o.CATEGORIA), x: val(o['DESCRIÇÃO']), s: val(o.STATUS), q: val(o.QUANTIDADE) })),
            listaPrisoes: R.prisoes.slice(0, L_MAX).map(o => ({ b: val(o.BOLETIM), s: val(o.SITUACAO), t: val(o.TIPIFICACAO), c: val(o.CIDADE) })),
        };
        const chave = chaveRes(it, resumo.modo);
        const r = await fetch(`${DB}/${NO_RES}/${chave}.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(resumo) });
        if (!r.ok) throw new Error('Firebase respondeu HTTP ' + r.status);
        RES[chave] = resumo;
        return resumo;
    }
    // Pendentes = já começaram e (sem resultado OU resultado parcial calculado antes do fim).
    const pendente = it => podeCalcular(it) && (!RES[it.chave] || (RES[it.chave].parcial && RES[it.chave].calculadoEm.slice(0, 10) < iso(new Date())));
    async function computarVarios(lista, btn) {
        const txt = btn.textContent; btn.disabled = true;
        let ok = 0, erro = 0;
        for (const it of lista) {
            btn.textContent = `⏳ ${ok + erro + 1}/${lista.length} — ${it.nome.slice(0, 28)}…`;
            try { await computar(it); ok++; } catch (e) { console.error('[controle-operacoes]', it.nome, e); erro++; }
        }
        btn.disabled = false; btn.textContent = txt;
        if (erro) alert(`${ok} resultado(s) computado(s); ${erro} com erro (ver console).`);
    }

    // ── Visão geral: KPIs, calendário, programação ──────────────────
    const doMes = (it, mes) => it.dias.some(d => d.slice(0, 7) === iso(mes).slice(0, 7));
    function somaRes(lista) {
        const t = { ocorrencias: 0, prisoes: 0, drogasG: 0, armas: 0, materiais: 0, com: 0 };
        lista.forEach(it => { const r = RES[it.chave]; if (!r) return; t.com++; Object.keys(r.kpi || {}).forEach(k => { t[k] += r.kpi[k] || 0; }); });
        return t;
    }
    const kpi = (cor, rot, v, sub) => `<div class="co-kpi" style="--c:${cor}"><small>${rot}</small><b>${v}</b><span>${sub || ''}</span></div>`;

    function renderGeral() {
        const lista = ITENS.filter(it => doMes(it, mesAtual));
        const opos = lista.filter(i => i.tipo === 'opo'), evs = lista.filter(i => i.tipo === 'evento');
        const t = somaRes(lista);
        const nomeMes = mesAtual.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        document.getElementById('co-kpis-mes').innerHTML =
            kpi('#1f5fbf', 'Operações no mês', opos.length, nomeMes) +
            kpi('#e67e22', 'Eventos médio/grande porte', evs.length, `${evs.filter(e => e.porte === 'GRANDE').length} de grande porte`) +
            kpi('#5e35b1', 'Ocorrências nas operações', fmtN(t.ocorrencias), `${t.com} de ${lista.length} com resultado`) +
            kpi('#c0392b', 'Prisões / apreensões', fmtN(t.prisoes), 'autores presos/apreendidos') +
            kpi('#2e7d32', 'Drogas apreendidas', peso(t.drogasG), '') +
            kpi('#455a64', 'Armas · materiais', `${fmtN(t.armas)} · ${fmtN(t.materiais)}`, 'apreendidos');
        const pend = lista.filter(pendente);
        document.getElementById('co-aviso-mes').innerHTML = pend.length
            ? `<div class="co-aviso">⚠️ ${pend.length} operação(ões)/evento(s) deste mês sem resultado computado (ou com resultado parcial).
                <button class="co-btn co-btn-pri" id="co-computar-mes">⚙ Computar resultados do CAD</button></div>` : '';
        const b = document.getElementById('co-computar-mes');
        if (b) b.onclick = async () => { await computarVarios(pend, b); renderGeral(); };
        renderCalendario(lista);
        renderProgramacao(lista);
    }

    function renderCalendario(lista) {
        document.getElementById('co-mes').textContent = mesAtual.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        const porDia = {};
        lista.forEach(it => it.dias.forEach(d => (porDia[d] = porDia[d] || []).push(it)));
        const ini = new Date(mesAtual); ini.setDate(1 - ini.getDay());
        const hoje = iso(new Date());
        let h = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(d => `<div class="co-cal-dow">${d}</div>`).join('');
        for (let i = 0; i < 42; i++) {
            const d = new Date(ini); d.setDate(ini.getDate() + i);
            if (i === 35 && d.getMonth() !== mesAtual.getMonth()) break;
            const k = iso(d), itens = porDia[k] || [];
            const chips = itens.slice(0, 3).map(it => `<div class="co-chip ${it.tipo === 'opo' ? 'opo' : it.porte === 'GRANDE' ? 'grande' : 'medio'}" title="${esc(it.nome)}">${it.tipo === 'opo' ? '🎯' : '🎉'} ${esc(it.nome)}</div>`).join('')
                + (itens.length > 3 ? `<div class="co-chip mais">+${itens.length - 3}</div>` : '');
            h += `<div class="co-dia${d.getMonth() !== mesAtual.getMonth() ? ' fora' : ''}${k === hoje ? ' hoje' : ''}${d.getDay() === 0 ? ' dom' : ''}" data-dia="${k}">
                <div class="co-dia-n">${d.getDate()}</div>${chips}</div>`;
        }
        const cal = document.getElementById('co-cal');
        cal.innerHTML = h;
        cal.querySelectorAll('.co-dia').forEach(el => el.addEventListener('click', () => abrirDia(el.dataset.dia)));
    }

    function resumoRes(it) {
        const r = RES[it.chave];
        if (!r) return podeCalcular(it) ? '<div class="co-res"><span>sem resultado computado</span></div>' : '<div class="co-res"><span>programado</span></div>';
        const k = r.kpi;
        return `<div class="co-res"><span>🚨 ${k.ocorrencias} ocorr.</span><span>🔒 ${k.prisoes ?? '—'} prisões</span><span>💊 ${peso(k.drogasG)}</span><span>🔫 ${fmtN(k.armas)} armas</span><span>📦 ${fmtN(k.materiais)} materiais</span>${r.parcial ? '<span>parcial</span>' : ''}</div>`;
    }
    function cardItem(it) {
        const d = it.ini;
        const tag = (it.tipo === 'opo' ? `<span class="co-tag" style="background:${COR.opo}">OPO</span>` : `<span class="co-tag" style="background:${COR[it.porte]}">${it.porte === 'GRANDE' ? 'GRANDE' : 'MÉDIO'}</span>`)
            + (it.tipo === 'opo' && it.eventoId ? '<span class="co-tag" style="background:#6d4c41">EVENTO</span>' : '')
            + (it.tipo === 'evento' && opoDoEvento(it).length ? '<span class="co-tag" style="background:#1f5fbf">COM OPO</span>' : '');
        const horario = it.hIni ? `${it.hIni}${it.hFim ? '–' + it.hFim : ''}` : 'dia inteiro';
        const periodo = it.tipo === 'opo' && !it.semExecucao && it.dias.length > 1 ? `${br(parseData(it.dias[0]))} a ${br(parseData(it.dias[it.dias.length - 1]))} · ` : '';
        return `<div class="co-item" data-dia="${it.dias[0]}"><div class="co-item-data"><b>${String(d.getDate()).padStart(2, '0')}</b><small>${MESES[d.getMonth()]}</small></div>
            <div class="co-item-txt"><strong>${esc(it.nome)}${tag}</strong>${periodo}${horario} · ${esc(it.cidades.join(', ') || 'todas as cidades')}${it.publico ? ` · ${fmtN(it.publico)} pessoas` : ''}${resumoRes(it)}</div></div>`;
    }
    function renderProgramacao(lista) {
        const opos = lista.filter(i => i.tipo === 'opo'), evs = lista.filter(i => i.tipo === 'evento');
        document.getElementById('co-prog-sub').textContent = mesAtual.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        const el = document.getElementById('co-lista');
        el.innerHTML = `<div class="co-lista-sec"><span>🎯 Operações (OPO)</span><span>${opos.length}</span></div>
            ${opos.length ? opos.map(cardItem).join('') : '<div class="co-vazio">Nenhuma OPO neste mês.</div>'}
            <div class="co-lista-sec"><span>🎉 Eventos de médio e grande porte</span><span>${evs.length}</span></div>
            ${evs.length ? evs.map(cardItem).join('') : '<div class="co-vazio">Nenhum evento de médio/grande porte neste mês.</div>'}`;
        el.querySelectorAll('.co-item').forEach(c => c.addEventListener('click', () => abrirDia(c.dataset.dia)));
    }

    // ── Detalhe do dia ──────────────────────────────────────────────
    let diaAberto = null;
    function abrirDia(dia) {
        diaAberto = dia;
        const itens = ITENS.filter(it => it.dias.includes(dia));
        document.getElementById('co-modal-tit').textContent = `📅 ${parseData(dia).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}`;
        const corpo = document.getElementById('co-modal-corpo');
        corpo.innerHTML = `<div style="display:flex;justify-content:flex-end;margin-bottom:.6rem;"><button class="co-btn co-btn-pri" data-nova-dia="${dia}">➕ Nova OPO Inteligente neste dia</button></div>`
            + (itens.length ? itens.map(detalheItem).join('') : '<div class="co-vazio">Nenhuma operação ou evento de médio/grande porte neste dia.</div>');
        corpo.querySelector('[data-nova-dia]').addEventListener('click', () => abrirNovaOPO({ dataIni: dia, dataFim: dia }));
        corpo.querySelectorAll('[data-nova-evento]').forEach(b => b.addEventListener('click', () => abrirNovaOPO(prefillEvento(ITENS.find(x => x.chave === b.dataset.novaEvento)))));
        corpo.querySelectorAll('[data-doc]').forEach(b => b.addEventListener('click', () => abrirDocumento(ITENS.find(x => x.chave === b.dataset.doc))));
        corpo.querySelectorAll('[data-computar]').forEach(b => b.addEventListener('click', async () => {
            const it = ITENS.find(x => x.chave === b.dataset.computar);
            b.disabled = true; b.textContent = '⏳ Cruzando com o CAD…';
            try { await computar(it, modoDe(it)); } catch (e) { alert('Não foi possível computar: ' + e.message); }
            abrirDia(dia); renderGeral();
        }));
        // Filtro: só no horário da operação × dias inteiros da vigência
        corpo.querySelectorAll('[data-modo]').forEach(b => b.addEventListener('click', async () => {
            const it = ITENS.find(x => x.chave === b.dataset.item);
            const modo = b.dataset.modo;
            modoItem[it.chave] = modo; modoPadrao = modo;
            try { localStorage.setItem(LS_MODO, modo); } catch (e) { /* preferência opcional */ }
            if (!RES[chaveRes(it, modo)] && podeCalcular(it)) {
                b.closest('.co-det').querySelector('.co-det-res').innerHTML = '<div class="co-det-meta" style="margin:.6rem 0;">⏳ Cruzando com o CAD…</div>';
                try { await computar(it, modo); } catch (e) { alert('Não foi possível computar: ' + e.message); }
            }
            abrirDia(dia);
        }));
        corpo.querySelectorAll('[data-exec]').forEach(b => b.addEventListener('click', () => document.getElementById('exec-' + b.dataset.exec).classList.toggle('aberto')));
        corpo.querySelectorAll('[data-salvar-exec]').forEach(b => b.addEventListener('click', () => salvarExecucao(b.dataset.salvarExec)));
        document.getElementById('co-modal').classList.add('aberto');
    }
    const tabMini = (tit, linhas, fmt) => linhas && linhas.length ? `<table class="co-mini"><tr><th>${tit}</th><th style="text-align:right">Qtd.</th></tr>${linhas.slice(0, 8).map(([k, v]) => `<tr><td>${esc(k)}</td><td style="text-align:right">${fmt ? fmt(v) : fmtN(v)}</td></tr>`).join('')}</table>` : '';
    const tabLista = (tit, cols, linhas) => `<details class="co-lista-det"><summary>${tit} (${linhas.length})</summary>${linhas.length
        ? `<div class="co-scroll" style="max-height:260px;"><table class="co-mini"><tr>${cols.map(c => `<th>${c[0]}</th>`).join('')}</tr>${linhas.map(l => `<tr>${cols.map(c => `<td>${esc(c[1](l))}</td>`).join('')}</tr>`).join('')}</table></div>`
        : '<div class="co-det-meta">Nenhum registro.</div>'}</details>`;
    function listasHTML(r) {
        if (!r.listaOcorrencias) return '<div class="co-det-meta" style="margin-top:.4rem;">ℹ️ Clique em “↻ Recalcular resultados” para ver a lista detalhada de ocorrências e apreensões.</div>';
        const quant = l => l.q ? `${l.q} ${(l.u || '').toLowerCase()}`.trim() : '—';
        return `<div class="co-listas">
            ${tabLista('📋 Ocorrências', [['Data', l => l.d], ['Hora', l => l.h], ['Boletim', l => l.b], ['Cidade', l => l.c], ['Endereço', l => l.e], ['Tipificação', l => l.t], ['Solução', l => l.s]], r.listaOcorrencias)}
            ${tabLista('💊 Drogas apreendidas', [['Data', l => l.d], ['Boletim', l => l.b], ['Tipo', l => l.t], ['Quantidade', quant], ['Cidade', l => l.c], ['Obs.', l => l.x]], r.listaDrogas || [])}
            ${tabLista('🔫 Armas apreendidas', [['Data', l => l.d], ['Boletim', l => l.b], ['Tipo', l => l.t], ['Marca / modelo / calibre', l => l.m], ['Situação', l => l.s], ['Cidade', l => l.c]], r.listaArmas || [])}
            ${tabLista('📦 Materiais apreendidos', [['Data', l => l.d], ['BOU', l => l.b], ['Categoria', l => l.t], ['Descrição', l => l.x], ['Status', l => l.s]], r.listaMateriais || [])}
            ${tabLista('🔒 Prisões / apreensões', [['Boletim', l => l.b], ['Situação', l => l.s], ['Tipificação', l => l.t], ['Cidade', l => l.c]], r.listaPrisoes || [])}
        </div>`;
    }
    function detalheItem(it) {
        const modo = temHorario(it) ? modoDe(it) : 'horario';
        const r = RES[chaveRes(it, modo)];
        const filtro = temHorario(it) ? `<div class="co-modo" role="group" aria-label="Recorte dos resultados">
                <span>Resultados:</span>
                <button class="${modo === 'horario' ? 'ativo' : ''}" data-modo="horario" data-item="${esc(it.chave)}">⏰ Somente no horário da operação (${esc(it.hIni)}–${esc(it.hFim)})</button>
                <button class="${modo === 'dia' ? 'ativo' : ''}" data-modo="dia" data-item="${esc(it.chave)}">📅 Dias inteiros da vigência</button></div>` : '';
        const cor = it.tipo === 'opo' ? COR.opo : COR[it.porte];
        const horario = it.hIni ? `${it.hIni}${it.hFim ? ' às ' + it.hFim : ''}` : 'dia inteiro';
        const meta = [
            it.tipo === 'opo' ? `Execução: ${it.semExecucao ? `não informada — resultados de ${br(it.ini)} a ${br(it.fim)} (criação → validade)` : `${br(it.ini)} a ${br(it.fim)}${it.fonte === 'vigencia' ? ' (lida da vigência)' : ''}`}` : `Local: ${esc(it.local || '—')} · Público estimado: ${fmtN(it.publico)} pessoas`,
            it.tipo === 'opo' && it.eventoId ? `🔗 OPO do evento: <strong>${esc(it.eventoNome || it.eventoId)}</strong>` : '',
            it.tipo === 'evento' && opoDoEvento(it).length ? `🔗 OPO(s) deste evento: ${opoDoEvento(it).map(o => `<strong>${esc(o.nome)}</strong>`).join(', ')}` : '',
            `Horário: ${horario} · Cidades: ${esc(it.cidades.join(', ') || 'todas')}`,
            it.tiposCombate && it.tiposCombate.length ? `Tipos de combate: ${esc(it.tiposCombate.join(', '))}` : '',
            it.guarnicoes || it.viaturas ? `Guarnições: ${esc(it.guarnicoes || '—')} · Viaturas: ${esc(it.viaturas || '—')}` : '',
            esc(it.detalhe || ''),
        ].filter(Boolean).join('<br>');
        const kp = r ? `<div class="co-det-kpis">
                <div>Ocorrências<b>${fmtN(r.kpi.ocorrencias)}</b>antes: ${fmtN(r.antes.ocorrencias)}</div>
                <div>Prisões<b>${r.kpi.prisoes ?? '—'}</b>antes: ${r.antes.prisoes ?? '—'}</div>
                <div>Drogas<b>${peso(r.kpi.drogasG)}</b>antes: ${peso(r.antes.drogasG)}</div>
                <div>Armas apreendidas<b>${fmtN(r.kpi.armas)}</b>antes: ${fmtN(r.antes.armas)}</div>
                <div>Materiais apreendidos<b>${fmtN(r.kpi.materiais)}</b>antes: ${fmtN(r.antes.materiais)}</div></div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:.6rem;align-items:start;">${tabMini('Tipificação', r.porTip)}${tabMini('Droga (peso)', r.drogasPorTipo, peso) || tabMini('Droga', [['Nenhuma', 0]])}${tabMini('Arma', r.armasPorTipo) || tabMini('Arma', [['Nenhuma', 0]])}${tabMini('Material', r.materiaisPorCat) || tabMini('Material', [['Nenhum', 0]])}</div>
            ${listasHTML(r)}
            <div class="co-det-meta" style="margin-top:.4rem;">Computado em ${new Date(r.calculadoEm).toLocaleString('pt-BR')} (${br(parseData(r.ini))} a ${br(parseData(r.fim))}, ${r.hIni && r.hFim ? 'das ' + r.hIni + ' às ' + r.hFim : 'dia inteiro'})${r.parcial ? ' — PARCIAL, a operação ainda está em andamento' : ''}. "Antes" = mesmo intervalo e horário imediatamente anterior.</div>`
            : `<div class="co-det-meta" style="margin:.5rem 0;">${podeCalcular(it) ? 'Resultados ainda não computados.' : 'Ainda não iniciado — os resultados poderão ser computados a partir da data de início.'}</div>`;
        const ex = it.tipo === 'opo' ? `
            <div class="co-exec" id="exec-${esc(it.chave)}">
                De <input type="date" data-e="ini" value="${it.semExecucao ? '' : iso(it.ini)}"> até <input type="date" data-e="fim" value="${it.semExecucao ? '' : iso(it.fim)}">
                das <input type="time" data-e="hIni" value="${esc(it.hIni)}"> às <input type="time" data-e="hFim" value="${esc(it.hFim)}">
                <button class="co-btn co-btn-pri" data-salvar-exec="${esc(it.chave)}">Salvar execução</button></div>` : '';
        return `<div class="co-det" style="--c:${cor}">
            <h4>${it.tipo === 'opo' ? '🎯' : '🎉'} ${esc(it.nome)} ${it.tipo === 'opo' ? `<span class="co-tag" style="background:${cor}">OPO</span>` : `<span class="co-tag" style="background:${cor}">${it.porte} PORTE</span>`}</h4>
            <div class="co-det-meta">${meta}</div>${filtro}<div class="co-det-res">${kp}</div>
            <div class="co-det-acoes">
                ${podeCalcular(it) ? `<button class="co-btn co-btn-pri" data-computar="${esc(it.chave)}">${r ? '↻ Recalcular resultados' : '⚙ Computar resultados do CAD'}</button>` : ''}
                ${it.tipo === 'opo' ? `<button class="co-btn" data-doc="${esc(it.chave)}">📄 Ver OPO (Word / PDF)</button>` : ''}
                ${it.tipo === 'opo' ? `<button class="co-btn" data-exec="${esc(it.chave)}">📅 Período de execução</button>` : ''}
                ${it.tipo === 'evento' ? `<button class="co-btn co-btn-pri" data-nova-evento="${esc(it.chave)}">🎯 Gerar OPO deste evento</button>` : ''}
                ${it.tipo === 'evento' ? opoDoEvento(it).map(o => `<button class="co-btn" data-doc="${esc(o.chave)}">📄 ${esc(o.nome)}</button>`).join('') : ''}
            </div>${ex}</div>`;
    }

    async function salvarExecucao(chave) {
        const it = ITENS.find(x => x.chave === chave);
        const box = document.getElementById('exec-' + chave);
        const v = k => box.querySelector(`[data-e="${k}"]`).value;
        if (!v('ini')) { alert('Informe a data de início da execução.'); return; }
        if (v('fim') && v('fim') < v('ini')) { alert('A data final é anterior à inicial.'); return; }
        const execucao = { dataIni: v('ini'), dataFim: v('fim') || v('ini'), horaIni: v('hIni') || null, horaFim: v('hFim') || null };
        const r = await fetch(`${DB}/cartoes_programa/${encodeURIComponent(it.id)}/execucao.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(execucao) });
        if (!r.ok) { alert('Não foi possível salvar (HTTP ' + r.status + ').'); return; }
        // O resultado antigo foi calculado com outro período — descarta.
        await Promise.all([it.chave, it.chave + '_dia'].map(k => fetch(`${DB}/${NO_RES}/${k}.json`, { method: 'DELETE' }).catch(() => {})));
        delete RES[it.chave]; delete RES[it.chave + '_dia'];
        await carregarTudo();
        document.getElementById('co-modal').classList.remove('aberto');
        mesAtual = new Date(parseData(execucao.dataIni).getFullYear(), parseData(execucao.dataIni).getMonth(), 1);
        renderGeral();
        abrirDia(execucao.dataIni);
    }

    // ── Integração com a OPO Inteligente e com Eventos ──────────────
    const opoDoEvento = ev => ITENS.filter(o => o.tipo === 'opo' && o.eventoId && String(o.eventoId) === String(ev.id));
    const FOCOS = [['MVI', 'MVI', 1], ['CVLI', 'CVLI', 1], ['CVP', 'CVP', 1], ['VD', 'Violência Doméstica', 0], ['PERTURBACAO', 'Perturbação do Sossego', 0], ['ARMAS', 'Armas', 0], ['DROGAS', 'Drogas', 0]];
    let CIDADES_CAD = null;
    async function cidadesCAD() {
        if (CIDADES_CAD) return CIDADES_CAD;
        const m = new Map();
        (await ControleOPO.carregarNo('geral')).forEach(g => { const c = val(g.CIDADE); if (c && !m.has(nrm(c))) m.set(nrm(c), c.toUpperCase()); });
        return (CIDADES_CAD = [...m.values()].sort((a, b) => a.localeCompare(b, 'pt-BR')));
    }
    // Evento → OPO: cidade, data, horário do evento; focos típicos de evento.
    function prefillEvento(ev) {
        return {
            escopo: 'cidade', cidade: ev.cidades[0] || '', dataIni: iso(ev.ini), dataFim: iso(ev.ini),
            horaIni: ev.hIni, horaFim: ev.hFim, nome: `OPO — ${ev.nome}${ev.cidades[0] ? ' — ' + ev.cidades[0] : ''}`.toUpperCase(),
            tipos: ['CVLI', 'CVP', 'PERTURBACAO', 'DROGAS', 'ARMAS'], evento: ev.id, eventoNome: ev.nome,
        };
    }
    // Registro salvo → mesmos parâmetros (gerar o documento de novo).
    function prefillOpo(it) {
        const o = it.raw || {};
        return {
            escopo: o.escopo === 'bpm' ? 'bpm' : 'cidade', cidade: it.cidades[0] || '', periodo: String(o.periodoDias || 30),
            turno: o.turno || '', nome: it.nome, dataIni: iso(it.ini), dataFim: iso(it.semExecucao ? it.ini : it.fim),
            horaIni: it.hIni, horaFim: it.hFim, tipos: it.tiposCombate.length ? it.tiposCombate : ['MVI', 'CVLI', 'CVP'],
            evento: it.eventoId || '', eventoNome: it.eventoNome || '',
        };
    }

    async function abrirNovaOPO(pref = {}) {
        const m = document.getElementById('co-nova');
        const f = id => m.querySelector('#' + id);
        f('n-cidade').innerHTML = '<option value="">⏳ Carregando cidades…</option>';
        f('n-escopo').value = pref.escopo || 'cidade';
        f('n-periodo').value = pref.periodo || '30';
        f('n-turno').value = pref.turno || '';
        f('n-nome').value = pref.nome || '';
        f('n-ini').value = pref.dataIni || iso(new Date());
        f('n-fim').value = pref.dataFim || pref.dataIni || iso(new Date());
        f('n-hini').value = pref.horaIni || '';
        f('n-hfim').value = pref.horaFim || '';
        const tipos = new Set(pref.tipos || FOCOS.filter(x => x[2]).map(x => x[0]));
        f('n-tipos').innerHTML = FOCOS.map(([id, nome]) => `<label><input type="checkbox" value="${id}"${tipos.has(id) ? ' checked' : ''}> ${nome}</label>`).join('');
        m.dataset.evento = pref.evento || '';
        m.dataset.eventoNome = pref.eventoNome || '';
        f('n-evento').innerHTML = pref.evento ? `🔗 Vinculada ao evento <strong>${esc(pref.eventoNome)}</strong>` : '';
        f('n-bloco-cidade').style.display = f('n-escopo').value === 'bpm' ? 'none' : '';
        m.classList.add('aberto');
        const lista = await cidadesCAD();
        const alvo = nrm(pref.cidade);
        f('n-cidade').innerHTML = '<option value="">— Selecione a cidade —</option>' + lista.map(c => `<option value="${esc(c)}"${nrm(c) === alvo ? ' selected' : ''}>${esc(c)}</option>`).join('');
    }
    function gerarOPOdoFormulario() {
        const m = document.getElementById('co-nova');
        const f = id => m.querySelector('#' + id).value;
        const tipos = [...m.querySelectorAll('#n-tipos input:checked')].map(i => i.value);
        if (f('n-escopo') === 'cidade' && !f('n-cidade')) { alert('Selecione a cidade.'); return; }
        if (!tipos.length) { alert('Selecione ao menos um tipo de foco.'); return; }
        if (f('n-fim') && f('n-fim') < f('n-ini')) { alert('A data final é anterior à inicial.'); return; }
        const q = new URLSearchParams({ opo: '1', auto: '1', origem: 'controle', escopo: f('n-escopo'), cidade: f('n-escopo') === 'bpm' ? '' : f('n-cidade'),
            periodo: f('n-periodo'), turno: f('n-turno'), nome: f('n-nome'), dataIni: f('n-ini'), dataFim: f('n-fim') || f('n-ini'),
            horaIni: f('n-hini'), horaFim: f('n-hfim'), tipos: tipos.join(','), evento: m.dataset.evento || '', eventoNome: m.dataset.eventoNome || '' });
        [...q.keys()].forEach(k => { if (!q.get(k)) q.delete(k); });
        location.href = 'opo_inteligente.html?' + q.toString();
    }

    // ── Documento da OPO salva (gravado pela OPO Inteligente ao salvar) ──
    let DOC_ATUAL = null;
    async function abrirDocumento(it) {
        const m = document.getElementById('co-doc');
        document.getElementById('co-doc-tit').textContent = '📄 ' + it.nome;
        const corpo = document.getElementById('co-doc-corpo');
        corpo.innerHTML = '<div class="co-vazio">⏳ Carregando documento…</div>';
        document.getElementById('co-doc-word').disabled = true;
        document.getElementById('co-doc-pdf').disabled = true;
        m.classList.add('aberto');
        DOC_ATUAL = await fetch(`${DB}/opo_documentos/${encodeURIComponent(it.id)}.json`).then(r => r.ok ? r.json() : null).catch(() => null);
        document.getElementById('co-doc-refazer').onclick = () => { m.classList.remove('aberto'); abrirNovaOPO(prefillOpo(it)); };
        if (!DOC_ATUAL || !DOC_ATUAL.html) {
            corpo.innerHTML = `<div class="co-aviso">Esta OPO foi salva antes de o sistema guardar o documento (ou sem gerar a OPO em tela).
                Use <strong>“🔁 Gerar novamente”</strong> para abrir a OPO Inteligente com os mesmos parâmetros, gerar o documento e salvar.</div>
                <div class="co-det-meta" style="margin-top:.7rem;">Cidades: ${esc(it.cidades.join(', ') || '—')} · Período de análise: ${esc((it.raw || {}).periodoDias || '—')} dias ·
                ${(it.raw || {}).alocacoes ? (it.raw.alocacoes.map(a => esc(a.cidade + ': ' + a.guarnicao)).join('<br>')) : ''}</div>`;
            return;
        }
        corpo.innerHTML = '<iframe class="co-doc-frame" id="co-doc-frame" title="Documento da OPO"></iframe>';
        document.getElementById('co-doc-frame').srcdoc = DOC_ATUAL.html;
        document.getElementById('co-doc-word').disabled = !DOC_ATUAL.docxBase64;
        document.getElementById('co-doc-pdf').disabled = false;
    }
    async function baixarWordDoc() {
        if (!DOC_ATUAL || !DOC_ATUAL.docxBase64) return;
        const nome = DOC_ATUAL.docxNome || 'OPO.docx';
        const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        if (window.pywebview) { // .exe não baixa arquivo → navegador padrão
            try { await abrirNoNavegador({ tipo: 'arquivo', nome, base64: DOC_ATUAL.docxBase64, mime }); } catch (e) { alert('Não foi possível baixar: ' + e.message); }
            return;
        }
        const b = atob(DOC_ATUAL.docxBase64), u8 = new Uint8Array(b.length);
        for (let i = 0; i < b.length; i++) u8[i] = b.charCodeAt(i);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([u8], { type: mime })); a.download = nome;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
    async function pdfDoc() {
        if (!DOC_ATUAL || !DOC_ATUAL.html) return;
        if (window.pywebview) {
            const html = DOC_ATUAL.html.replace('</body>', '<script>window.onload=function(){setTimeout(function(){window.print();},900);};<\/script></body>');
            try { await abrirNoNavegador({ tipo: 'impressao', html }); } catch (e) { alert('Não foi possível abrir: ' + e.message); }
            return;
        }
        const fr = document.getElementById('co-doc-frame');
        fr.contentWindow.focus(); fr.contentWindow.print(); // "Salvar como PDF" na janela de impressão
    }

    // ── Estatísticas ────────────────────────────────────────────────
    function montarCidades() {
        const sel = document.getElementById('f-cidade'), atual = sel.value;
        const nomes = new Map();
        ITENS.forEach(it => it.cidades.forEach(c => { if (!nomes.has(nrm(c))) nomes.set(nrm(c), c); }));
        sel.innerHTML = '<option value="">Todas</option>' + [...nomes.values()].sort((a, b) => a.localeCompare(b, 'pt-BR')).map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
        sel.value = atual;
    }
    function lerFiltros() {
        const de = parseData(document.getElementById('f-de').value), ate = parseData(document.getElementById('f-ate').value);
        return { de, ate, cidade: document.getElementById('f-cidade').value, tipo: document.getElementById('f-tipo').value, porte: document.getElementById('f-porte').value };
    }
    function filtrar(f) {
        return ITENS.filter(it => {
            if (f.de && it.fim < f.de) return false;
            if (f.ate && it.ini > f.ate) return false;
            if (f.tipo && it.tipo !== f.tipo) return false;
            if (f.porte && it.tipo === 'evento' && it.porte !== f.porte) return false;
            if (f.cidade && !it.cidades.some(c => nrm(c) === nrm(f.cidade)) && !(it.tipo === 'opo' && !it.cidades.length)) return false;
            return true;
        });
    }
    function agregar(lista) {
        const somaPares = (campo) => { const m = {}; lista.forEach(it => ((RES[it.chave] || {})[campo] || []).forEach(([k, v]) => { m[k] = (m[k] || 0) + v; })); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
        const meses = {};
        lista.forEach(it => {
            const k = iso(it.ini).slice(0, 7);
            const m = meses[k] || (meses[k] = { opo: 0, evento: 0, prisoes: 0, armas: 0, materiais: 0, drogasG: 0, ocorrencias: 0 });
            m[it.tipo]++;
            const r = RES[it.chave]; if (r) ['prisoes', 'armas', 'materiais', 'drogasG', 'ocorrencias'].forEach(c => { m[c] += r.kpi[c] || 0; });
        });
        const combate = {};
        lista.filter(i => i.tipo === 'opo').forEach(i => i.tiposCombate.forEach(t => { combate[t] = (combate[t] || 0) + 1; }));
        const evs = lista.filter(i => i.tipo === 'evento');
        return {
            lista, opos: lista.filter(i => i.tipo === 'opo'), evs, tot: somaRes(lista),
            publico: evs.reduce((s, e) => s + (e.publico || 0), 0),
            meses: Object.entries(meses).sort((a, b) => a[0].localeCompare(b[0])),
            porCidade: somaPares('porCidade'), porTip: somaPares('porTip'), drogas: somaPares('drogasPorTipo'), armas: somaPares('armasPorTipo'), materiais: somaPares('materiaisPorCat'),
            porte: { 'MÉDIO': evs.filter(e => e.porte === 'MÉDIO').length, GRANDE: evs.filter(e => e.porte === 'GRANDE').length },
            combate: Object.entries(combate).sort((a, b) => b[1] - a[1]),
            pend: lista.filter(pendente),
        };
    }
    const NOME_COMBATE = { MVI: 'MVI', CVLI: 'CVLI', CVP: 'CVP', PERTURBACAO: 'Perturbação do Sossego', VD: 'Violência Doméstica', ARMAS: 'Armas', DROGAS: 'Drogas' };
    const rotMes = k => { const [a, m] = k.split('-'); return `${MESES[+m - 1]}/${a.slice(2)}`; };

    function grafico(id, cfg) {
        if (CHARTS[id]) CHARTS[id].destroy();
        const cs = getComputedStyle(document.documentElement);
        const txt = cs.getPropertyValue('--p3-text').trim() || '#333', grid = cs.getPropertyValue('--p3-border').trim() || '#ddd';
        cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: false,
            plugins: { legend: { labels: { color: txt, boxWidth: 12, font: { size: 11 } } } } }, cfg.options || {});
        if (cfg.type !== 'doughnut') cfg.options.scales = Object.assign({ x: { ticks: { color: txt, font: { size: 10 } }, grid: { color: grid } }, y: { ticks: { color: txt, font: { size: 10 }, precision: 0 }, grid: { color: grid }, beginAtZero: true } }, cfg.options.scales || {});
        CHARTS[id] = new Chart(document.getElementById(id), cfg);
    }

    function renderEstatisticas() {
        FILTRO = lerFiltros();
        const A = agregar(filtrar(FILTRO));
        const per = `${FILTRO.de ? br(FILTRO.de) : 'início'} a ${FILTRO.ate ? br(FILTRO.ate) : 'hoje'}`;
        document.getElementById('co-kpis-est').innerHTML =
            kpi('#1f5fbf', 'Operações (OPO)', A.opos.length, per) +
            kpi('#e67e22', 'Eventos médio/grande', A.evs.length, `${fmtN(A.publico)} pessoas (público estimado)`) +
            kpi('#5e35b1', 'Ocorrências durante', fmtN(A.tot.ocorrencias), `${A.tot.com} de ${A.lista.length} com resultado`) +
            kpi('#c0392b', 'Prisões / apreensões', fmtN(A.tot.prisoes), '') +
            kpi('#2e7d32', 'Drogas apreendidas', peso(A.tot.drogasG), '') +
            kpi('#455a64', 'Armas apreendidas', fmtN(A.tot.armas), '') +
            kpi('#6d4c41', 'Materiais apreendidos', fmtN(A.tot.materiais), '');
        document.getElementById('co-aviso-est').innerHTML = A.pend.length
            ? `<div class="co-aviso">⚠️ ${A.pend.length} item(ns) do filtro sem resultado computado — os totais de resultados ficam incompletos.
                <button class="co-btn co-btn-pri" id="co-computar-est">⚙ Computar agora</button></div>` : '';
        const b = document.getElementById('co-computar-est');
        if (b) b.onclick = async () => { await computarVarios(A.pend, b); renderEstatisticas(); renderGeral(); };

        const lbl = A.meses.map(([k]) => rotMes(k));
        grafico('g-mes', { type: 'bar', data: { labels: lbl, datasets: [
            { label: 'Operações (OPO)', data: A.meses.map(([, m]) => m.opo), backgroundColor: COR.opo },
            { label: 'Eventos', data: A.meses.map(([, m]) => m.evento), backgroundColor: '#e67e22' }] } });
        grafico('g-res', { type: 'bar', data: { labels: lbl, datasets: [
            { label: 'Prisões', data: A.meses.map(([, m]) => m.prisoes), backgroundColor: '#c0392b' },
            { label: 'Armas', data: A.meses.map(([, m]) => m.armas), backgroundColor: '#455a64' },
            { label: 'Materiais', data: A.meses.map(([, m]) => m.materiais), backgroundColor: '#8d6e63' }] } });
        grafico('g-cidade', { type: 'bar', data: { labels: A.porCidade.slice(0, 12).map(x => x[0]), datasets: [{ label: 'Ocorrências', data: A.porCidade.slice(0, 12).map(x => x[1]), backgroundColor: '#5e35b1' }] },
            options: { indexAxis: 'y', plugins: { legend: { display: false } } } });
        grafico('g-tip', { type: 'bar', data: { labels: A.porTip.slice(0, 10).map(x => x[0].split(' | ')[0].slice(0, 38)), datasets: [{ label: 'Ocorrências', data: A.porTip.slice(0, 10).map(x => x[1]), backgroundColor: '#2f5fdd' }] },
            options: { indexAxis: 'y', plugins: { legend: { display: false } } } });
        grafico('g-porte', { type: 'doughnut', data: { labels: ['Médio porte', 'Grande porte'], datasets: [{ data: [A.porte['MÉDIO'], A.porte.GRANDE], backgroundColor: ['#e67e22', '#c0392b'] }] } });
        grafico('g-combate', { type: 'bar', data: { labels: A.combate.map(x => NOME_COMBATE[x[0]] || x[0]), datasets: [{ label: 'OPOs', data: A.combate.map(x => x[1]), backgroundColor: '#00897b' }] },
            options: { plugins: { legend: { display: false } } } });

        document.getElementById('co-tab-sub').textContent = `${A.lista.length} item(ns) · ${per}`;
        document.getElementById('co-tabela').innerHTML = A.lista.length ? `<table class="co-tab"><thead><tr><th>Data</th><th>Tipo</th><th>Nome</th><th>Cidades</th><th>Horário</th><th>Ocorr.</th><th>Prisões</th><th>Drogas</th><th>Armas</th><th>Mat.</th></tr></thead><tbody>
            ${A.lista.map(it => { const r = RES[it.chave]; const k = r ? r.kpi : null; return `<tr>
                <td>${br(it.ini)}${it.fim - it.ini ? ' a ' + br(it.fim) : ''}</td><td>${it.tipo === 'opo' ? 'OPO' : 'Evento ' + it.porte.toLowerCase()}</td><td>${esc(it.nome)}</td>
                <td>${esc(it.cidades.join(', '))}</td><td>${it.hIni ? it.hIni + (it.hFim ? '–' + it.hFim : '') : 'dia inteiro'}</td>
                <td>${k ? k.ocorrencias : '—'}</td><td>${k ? (k.prisoes ?? '—') : '—'}</td><td>${k ? peso(k.drogasG) : '—'}</td><td>${k ? k.armas : '—'}</td><td>${k ? k.materiais : '—'}</td></tr>`; }).join('')}
            </tbody></table>` : '<div class="co-vazio">Nenhuma operação ou evento no filtro.</div>';
        return A;
    }

    // ── Relatório ───────────────────────────────────────────────────
    function htmlRelatorio(A) {
        const f = FILTRO, per = `${f.de ? br(f.de) : 'início'} a ${f.ate ? br(f.ate) : br(new Date())}`;
        const img = id => CHARTS[id] ? `<img src="${CHARTS[id].toBase64Image()}" alt="">` : '';
        const tab = (tit, linhas, fmt) => `<table><caption>${tit}</caption><tr><th>Item</th><th>Qtd.</th></tr>${linhas.length ? linhas.slice(0, 15).map(([a, b]) => `<tr><td>${esc(a)}</td><td>${fmt ? fmt(b) : fmtN(b)}</td></tr>`).join('') : '<tr><td colspan="2">Nenhum registro</td></tr>'}</table>`;
        const filtrosTxt = [f.cidade ? 'Cidade: ' + f.cidade : 'Todas as cidades', f.tipo === 'opo' ? 'Somente operações' : f.tipo === 'evento' ? 'Somente eventos' : 'Operações e eventos', f.porte ? 'Eventos de ' + f.porte.toLowerCase() + ' porte' : ''].filter(Boolean).join(' · ');
        return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><title>Relatório de Operações — ${esc(CFG.nome || '')}</title><style>
            body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:12mm;font-size:10pt}
            .cab{display:flex;align-items:center;gap:12px;border-bottom:2px solid #0b2545;padding-bottom:8px;margin-bottom:10px}.cab img{height:58px}
            h1{font-size:14pt;margin:0;color:#0b2545;text-transform:uppercase}.sub{color:#444;font-size:9pt}
            h2{font-size:11pt;color:#0b2545;border-bottom:1.5px solid #0b2545;padding-bottom:2px;margin:14px 0 6px;text-transform:uppercase}
            .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.kpi{border:1px solid #bbb;border-radius:6px;padding:6px 8px}
            .kpi b{display:block;font-size:14pt;color:#0b2545}.kpi span{font-size:7.5pt;text-transform:uppercase;color:#555}
            .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:start}img{max-width:100%;max-height:250px;display:block;margin:0 auto}
            table{border-collapse:collapse;width:100%;margin:4px 0;font-size:8.5pt}caption{text-align:left;font-weight:bold;margin-bottom:2px}
            th,td{border:1px solid #bbb;padding:3px 5px;text-align:left;vertical-align:top}th{background:#e8eef7}section{page-break-inside:avoid}
            .nota{font-size:7.5pt;color:#555;margin-top:12px;border-top:1px solid #ccc;padding-top:5px}
        </style></head><body>
            <div class="cab">${CFG.logoUrl ? `<img src="${esc(new URL(CFG.logoUrl, location.href).href)}" alt="">` : ''}<div>
                <h1>Relatório de Controle de Operações</h1>
                <div class="sub">${esc(CFG.nome || '')} · Período: ${per} · ${esc(filtrosTxt)} · Emitido em ${new Date().toLocaleString('pt-BR')}</div></div></div>
            <section><h2>1. Indicadores</h2><div class="kpis">
                <div class="kpi"><span>Operações (OPO)</span><b>${A.opos.length}</b></div>
                <div class="kpi"><span>Eventos médio/grande porte</span><b>${A.evs.length}</b>${fmtN(A.publico)} pessoas</div>
                <div class="kpi"><span>Ocorrências durante</span><b>${fmtN(A.tot.ocorrencias)}</b></div>
                <div class="kpi"><span>Prisões / apreensões</span><b>${fmtN(A.tot.prisoes)}</b></div>
                <div class="kpi"><span>Drogas apreendidas</span><b>${peso(A.tot.drogasG)}</b></div>
                <div class="kpi"><span>Armas apreendidas</span><b>${fmtN(A.tot.armas)}</b></div>
                <div class="kpi"><span>Materiais apreendidos</span><b>${fmtN(A.tot.materiais)}</b></div>
                <div class="kpi"><span>Com resultado computado</span><b>${A.tot.com}/${A.lista.length}</b></div></div></section>
            <section><h2>2. Evolução mensal</h2><div class="grid">${img('g-mes')}${img('g-res')}</div></section>
            <section><h2>3. Ocorrências durante as operações/eventos</h2><div class="grid">${tab('Por cidade', A.porCidade)}${tab('Por tipificação', A.porTip)}</div></section>
            <section><h2>4. Apreensões</h2><div class="grid">${tab('Drogas por tipo (peso)', A.drogas, peso)}${tab('Armas por tipo', A.armas)}${tab('Materiais por categoria', A.materiais)}${tab('Eventos por porte', Object.entries(A.porte))}</div></section>
            <section><h2>5. Operações e eventos do período</h2><table><tr><th>Data</th><th>Tipo</th><th>Nome</th><th>Cidades</th><th>Horário</th><th>Ocorr.</th><th>Prisões</th><th>Drogas</th><th>Armas</th><th>Mat.</th></tr>
                ${A.lista.map(it => { const r = RES[it.chave]; const k = r ? r.kpi : null; return `<tr><td>${br(it.ini)}${it.fim - it.ini ? ' a ' + br(it.fim) : ''}</td><td>${it.tipo === 'opo' ? 'OPO' : 'Evento ' + it.porte.toLowerCase()}</td><td>${esc(it.nome)}</td><td>${esc(it.cidades.join(', '))}</td><td>${it.hIni ? it.hIni + (it.hFim ? '–' + it.hFim : '') : 'dia inteiro'}</td><td>${k ? k.ocorrencias : '—'}</td><td>${k ? (k.prisoes ?? '—') : '—'}</td><td>${k ? peso(k.drogasG) : '—'}</td><td>${k ? k.armas : '—'}</td><td>${k ? k.materiais : '—'}</td></tr>`; }).join('') || '<tr><td colspan="10">Nenhum item no filtro.</td></tr>'}</table></section>
            <div class="nota">Resultados = registros do CAD no período, horário e cidades de cada operação/evento (ocorrências, autores presos/apreendidos, drogas, armas) e planilha de materiais apreendidos (pelo nº do BOU). "—" = resultado ainda não computado. Eventos: cadastro de Eventos da unidade, médio porte 501–1000 e grande porte acima de 1000 pessoas.</div>
            <script>window.onload=function(){if(window.__autoPrint)setTimeout(function(){window.print();},400);};<\/script>
        </body></html>`;
    }
    // Os gráficos do relatório são os da aba Estatísticas; com ela oculta o
    // canvas tem tamanho 0 e a imagem sai vazia — renderiza fora da tela.
    function estatisticasVisiveis(fn) {
        const v = document.getElementById('view-estatisticas');
        if (v.classList.contains('ativa')) return fn();
        const antes = v.getAttribute('style') || '';
        v.setAttribute('style', 'display:flex;position:absolute;left:-12000px;top:0;width:1100px;');
        try { return fn(); } finally { v.setAttribute('style', antes); }
    }
    function renderRelatorio() {
        const A = estatisticasVisiveis(renderEstatisticas); // gráficos/filtros sempre atualizados
        document.getElementById('r-previa').srcdoc = htmlRelatorio(A);
    }
    async function imprimir() {
        const A = estatisticasVisiveis(renderEstatisticas);
        const html = htmlRelatorio(A).replace('window.__autoPrint', 'true');
        if (window.pywebview) { // .exe: WebView2 bloqueia pop-up → abre no navegador padrão
            try { await abrirNoNavegador({ tipo: 'impressao', html }); } catch (e) { alert('Não foi possível abrir a impressão: ' + e.message); }
            return;
        }
        const w = window.open('', '_blank');
        if (!w) { alert('O navegador bloqueou a janela de impressão. Libere pop-ups para este site.'); return; }
        w.document.open(); w.document.write(html); w.document.close();
    }
    // Mesmo contorno da Rede de Proteção (js/dashboard-rede-protecao.js):
    // conteúdo num nó temporário /relay_temp do Firebase da unidade e a
    // página relatorios/rede_protecao.html (que imprime tipo "impressao").
    async function abrirNoNavegador(payload) {
        const agora = Date.now();
        try {
            const chaves = await fetch(`${DB}/relay_temp.json?shallow=true`).then(r => r.ok ? r.json() : null);
            await Promise.all(Object.keys(chaves || {}).filter(k => { const t = parseInt(k.split('-')[0], 36); return !t || agora - t > 30 * 60 * 1000; })
                .map(k => fetch(`${DB}/relay_temp/${encodeURIComponent(k)}.json`, { method: 'DELETE' }).catch(() => {})));
        } catch (e) { /* limpeza oportunista */ }
        const token = agora.toString(36) + '-' + Math.random().toString(36).slice(2, 12);
        const r = await fetch(`${DB}/relay_temp/${token}.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ criadoEm: agora, conteudo: JSON.stringify(payload) }) });
        if (!r.ok) throw new Error('Firebase respondeu HTTP ' + r.status);
        window.open(new URL(`../relatorios/rede_protecao.html?fb=${encodeURIComponent(token)}&db=${encodeURIComponent(DB)}`, location.href).href, '_blank');
    }

    // ── Navegação interna ───────────────────────────────────────────
    function mostrar(view) {
        document.querySelectorAll('.co-menu button').forEach(b => b.classList.toggle('ativo', b.dataset.view === view));
        document.querySelectorAll('.co-view').forEach(v => v.classList.toggle('ativa', v.id === 'view-' + view));
        if (view === 'estatisticas') renderEstatisticas();
        if (view === 'relatorio') renderRelatorio();
    }

    async function iniciar() {
        CFG = await P3.loadUnidadeConfig();
        DB = CFG.firebase.databaseURL;
        document.getElementById('co-unidade').textContent = CFG.nome || 'Unidade';
        if (CFG.logoUrl) document.getElementById('co-logo').src = CFG.logoUrl;
        const h = new Date();
        document.getElementById('f-de').value = iso(new Date(h.getFullYear(), 0, 1));
        document.getElementById('f-ate').value = iso(h);

        document.querySelectorAll('.co-menu button').forEach(b => b.addEventListener('click', () => mostrar(b.dataset.view)));
        document.getElementById('co-ant').onclick = () => { mesAtual = new Date(mesAtual.getFullYear(), mesAtual.getMonth() - 1, 1); renderGeral(); };
        document.getElementById('co-prox').onclick = () => { mesAtual = new Date(mesAtual.getFullYear(), mesAtual.getMonth() + 1, 1); renderGeral(); };
        document.getElementById('co-hoje').onclick = () => { const d = new Date(); mesAtual = new Date(d.getFullYear(), d.getMonth(), 1); renderGeral(); };
        document.getElementById('co-recarregar').onclick = async () => { await carregarTudo(); renderGeral(); };
        document.getElementById('co-modal-fechar').onclick = () => document.getElementById('co-modal').classList.remove('aberto');
        document.getElementById('co-modal').addEventListener('click', e => { if (e.target.id === 'co-modal') e.currentTarget.classList.remove('aberto'); });
        document.getElementById('f-aplicar').onclick = renderEstatisticas;
        document.getElementById('f-relatorio').onclick = () => mostrar('relatorio');
        document.getElementById('r-filtros').onclick = () => mostrar('estatisticas');
        document.getElementById('r-imprimir').onclick = imprimir;
        document.getElementById('co-btn-nova').onclick = () => abrirNovaOPO();
        document.getElementById('n-escopo').onchange = e => { document.getElementById('n-bloco-cidade').style.display = e.target.value === 'bpm' ? 'none' : ''; };
        document.getElementById('n-gerar').onclick = gerarOPOdoFormulario;
        document.getElementById('co-doc-word').onclick = baixarWordDoc;
        document.getElementById('co-doc-pdf').onclick = pdfDoc;
        document.querySelectorAll('[data-fechar]').forEach(b => b.addEventListener('click', () => document.getElementById(b.dataset.fechar).classList.remove('aberto')));
        ['co-nova', 'co-doc'].forEach(id => document.getElementById(id).addEventListener('click', e => { if (e.target.id === id) e.currentTarget.classList.remove('aberto'); }));
        document.querySelectorAll('#btn-tema').forEach(b => b.addEventListener('click', () => setTimeout(() => {
            if (document.getElementById('view-estatisticas').classList.contains('ativa')) renderEstatisticas();
        }, 60)));

        try {
            await carregarTudo();
            // ?dia=AAAA-MM-DD (volta da OPO Inteligente / link direto) → mês e dia abertos
            const dia = new URLSearchParams(location.search).get('dia');
            if (dia && parseData(dia)) { const d = parseData(dia); mesAtual = new Date(d.getFullYear(), d.getMonth(), 1); }
            renderGeral();
            if (dia && parseData(dia)) abrirDia(dia);
        } catch (e) {
            console.error('[controle-operacoes]', e);
            document.getElementById('co-lista').innerHTML = `<div class="co-vazio">Erro ao carregar: ${esc(e.message)}</div>`;
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
