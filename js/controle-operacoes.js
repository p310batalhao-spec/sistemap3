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
                eventoId: o.eventoId || null, eventoNome: o.eventoNome || null, temDocumento: !!o.temDocumento, modelo: o.modelo || null, modalidade: o.modalidade || null,
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
        montarOpcoesOPO();
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
    // Calcula no CAD (sem gravar) o recorte de um item entre ini e fim.
    async function calcularRecorte(it, ini, fim, modo) {
        const diaInteiro = modo === 'dia' || !temHorario(it);
        const R = await ControleOPO.calcular({ nome: it.nome, ini, fim, hIni: diaInteiro ? '' : it.hIni, hFim: diaInteiro ? '' : it.hFim, cidades: it.cidades });
        return resumirResultado(R, it, ini, fim, diaInteiro);
    }
    function resumirResultado(R, it, ini, fim, diaInteiro) {
        const k = R.kpi;
        const end = o => [val(o.LOGRADOURO), val(o.BAIRRO)].filter(Boolean).join(', ');
        const kp = i => ({ ocorrencias: k.ocorrencias[i], prisoes: k.prisoes[i], drogasG: +((k.drogas[i] || 0).toFixed(3)), armas: k.armas[i], materiais: k.materiais[i] });
        return {
            tipo: it.tipo, refId: it.id, nome: it.nome, calculadoEm: new Date().toISOString(),
            ini: iso(ini), fim: iso(fim), hIni: diaInteiro ? '' : (it.hIni || ''), hFim: diaInteiro ? '' : (it.hFim || ''), cidades: it.cidades,
            parcial: it.fim >= hoje0(), modo: diaInteiro ? 'dia' : 'horario',
            kpi: kp(0), antes: kp(1),
            // Mesmos dias do mês anterior à vigência, mesmo horário e cidades
            mesAnterior: { ini: iso(R.mesIni), fim: iso(R.mesFim), kpi: kp(2) },
            porBairroComp: R.porBairroComp.slice(0, 40), porCidadeComp: R.porCidadeComp.slice(0, 20), porTipComp: R.porTipComp.slice(0, 25),
            porTip: R.porTip.slice(0, 15), porCidade: R.porCidade.slice(0, 15),
            drogasPorTipo: R.drogasPorTipo, armasPorTipo: R.armasPorTipo, materiaisPorCat: R.materiaisPorCat, prisoesPorSit: R.prisoesPorSit,
            // Listas (sem nome de pessoa — ficam gravadas no Firebase da unidade)
            listaOcorrencias: R.ocorrencias.slice(0, L_MAX).map(o => ({ d: val(o.DATA), h: val(o.HORA), b: val(o.BOLETIM), c: val(o.CIDADE), e: end(o), t: val(o.TIPIFICACAO_GERAL) || val(o.TIPIFICACAO), s: val(o['SOLUÇÃO']) })),
            listaDrogas: R.drogas.slice(0, L_MAX).map(o => ({ d: val(o.DATA), h: val(o.HORA), b: val(o.BOLETIM), t: val(o.TIPO_DROGA), q: val(o.QUANTIDADE || o.PESO), u: val(o.UNIDADE_MEDIDA), c: val(o.CIDADE), x: val(o.OBSERVACAO) })),
            listaArmas: R.armas.slice(0, L_MAX).map(o => ({ d: val(o.DATA), h: val(o.HORA), b: val(o.BOLETIM), t: val(o.TIPO_ARMA), m: [val(o.MARCA), val(o.MODELO), val(o.CALIBRE)].filter(Boolean).join(' · '), s: val(o.SITUACAO_ARMA), c: val(o.CIDADE) })),
            listaMateriais: R.materiais.slice(0, L_MAX).map(o => ({ d: val(o.DATA), b: val(o['N° DO BOU']), t: val(o.CATEGORIA), x: val(o['DESCRIÇÃO']), s: val(o.STATUS), q: val(o.QUANTIDADE) })),
            listaPrisoes: R.prisoes.slice(0, L_MAX).map(o => ({ b: val(o.BOLETIM), s: val(o.SITUACAO), t: val(o.TIPIFICACAO), c: val(o.CIDADE) })),
        };
    }
    async function computar(it, modo = 'horario') {
        const fim = it.fim > hoje0() ? hoje0() : it.fim;
        const resumo = await calcularRecorte(it, it.ini, fim, modo);
        const chave = chaveRes(it, resumo.modo);
        const r = await fetch(`${DB}/${NO_RES}/${chave}.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(resumo) });
        if (!r.ok) throw new Error('Firebase respondeu HTTP ' + r.status);
        RES[chave] = resumo;
        return resumo;
    }
    // Resultado de um item no recorte pedido ('horario' | 'dia').
    const resDe = (it, rec = 'horario') => RES[chaveRes(it, rec)];
    // Pendentes = já começaram e (sem resultado OU resultado parcial calculado antes do fim).
    // Pendente = já começou e (sem resultado | parcial de outro dia | calculado
    // antes da comparação com o mês anterior existir).
    const pendente = (it, rec = 'horario') => { const r = resDe(it, rec); return podeCalcular(it) && (!r || !r.mesAnterior || (r.parcial && r.calculadoEm.slice(0, 10) < iso(new Date()))); };
    async function computarVarios(lista, btn, rec = 'horario') {
        const txt = btn.textContent; btn.disabled = true;
        let ok = 0, erro = 0;
        for (const it of lista) {
            btn.textContent = `⏳ ${ok + erro + 1}/${lista.length} — ${it.nome.slice(0, 28)}…`;
            try { await computar(it, rec); ok++; } catch (e) { console.error('[controle-operacoes]', it.nome, e); erro++; }
        }
        btn.disabled = false; btn.textContent = txt;
        if (erro) alert(`${ok} resultado(s) computado(s); ${erro} com erro (ver console).`);
    }

    // ── Visão geral: KPIs, calendário, programação ──────────────────
    const doMes = (it, mes) => it.dias.some(d => d.slice(0, 7) === iso(mes).slice(0, 7));
    function somaRes(lista, rec = 'horario') {
        const t = { ocorrencias: 0, prisoes: 0, drogasG: 0, armas: 0, materiais: 0, com: 0 };
        lista.forEach(it => { const r = resDe(it, rec); if (!r) return; t.com++; Object.keys(r.kpi || {}).forEach(k => { t[k] += r.kpi[k] || 0; }); });
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
        const pend = lista.filter(it => pendente(it));
        document.getElementById('co-aviso-mes').innerHTML = pend.length
            ? `<div class="co-aviso">⚠️ ${pend.length} operação(ões)/evento(s) deste mês sem resultado computado, com resultado parcial ou sem a comparação com o mês anterior.
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
            + (it.modalidade === 'sufocamento' ? ' <span class="co-tag" style="background:#b91c1c">SUFOCAMENTO</span>' : '')
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
        corpo.querySelectorAll('[data-relatorio]').forEach(b => b.addEventListener('click', () => abrirRelatorioOPO(ITENS.find(x => x.chave === b.dataset.relatorio), dia)));
        ligarOcorrencias(corpo);
        corpo.querySelectorAll('[data-opo-evento]').forEach(b => b.addEventListener('click', () => abrirOPOEvento(ITENS.find(x => x.chave === b.dataset.opoEvento), null)));
        corpo.querySelectorAll('[data-editar-opo]').forEach(b => b.addEventListener('click', () => { const o = ITENS.find(x => x.chave === b.dataset.editarOpo); abrirOPOEvento(ITENS.find(x => x.tipo === 'evento' && String(x.id) === String(o.eventoId)) || null, o); }));
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
            ${listaOcorrenciasHTML(r.listaOcorrencias)}
            ${tabLista('💊 Drogas apreendidas', [['Data', l => l.d], ['Boletim', l => l.b], ['Tipo', l => l.t], ['Quantidade', quant], ['Cidade', l => l.c], ['Obs.', l => l.x]], r.listaDrogas || [])}
            ${tabLista('🔫 Armas apreendidas', [['Data', l => l.d], ['Boletim', l => l.b], ['Tipo', l => l.t], ['Marca / modelo / calibre', l => l.m], ['Situação', l => l.s], ['Cidade', l => l.c]], r.listaArmas || [])}
            ${tabLista('📦 Materiais apreendidos', [['Data', l => l.d], ['BOU', l => l.b], ['Categoria', l => l.t], ['Descrição', l => l.x], ['Status', l => l.s]], r.listaMateriais || [])}
            ${tabLista('🔒 Prisões / apreensões', [['Boletim', l => l.b], ['Situação', l => l.s], ['Tipificação', l => l.t], ['Cidade', l => l.c]], r.listaPrisoes || [])}
        </div>`;
    }
    // ── Comparação com o mês anterior (mesmos dias, horário e cidades) ──
    const variaTxt = (a, b) => { if (a == null || b == null) return ''; if (!b) return a ? '<span class="co-up">▲ novo</span>' : '<span>=</span>'; const p = (a - b) / b * 100; return p ? `<span class="${p > 0 ? 'co-up' : 'co-down'}">${p > 0 ? '▲' : '▼'} ${Math.abs(p) > 999 ? '>999' : fmtN(Math.abs(p))}%</span>` : '<span>=</span>'; };
    function comparacaoMesHTML(r, it) {
        if (!r.mesAnterior) return '<div class="co-det-meta" style="margin:.3rem 0;">ℹ️ Clique em “↻ Recalcular resultados” para ver a comparação com o mês anterior.</div>';
        const m = r.mesAnterior, k = r.kpi, a = m.kpi;
        const linha = (rot, x, y, fmt = fmtN) => `<tr><td>${rot}</td><td>${x == null ? '—' : fmt(x)}</td><td>${y == null ? '—' : fmt(y)}</td><td>${variaTxt(x, y)}</td></tr>`;
        const tabComp = (tit, linhas) => linhas && linhas.length ? `<div class="co-scroll" style="max-height:220px;"><table class="co-mini"><tr><th>${tit}</th><th>OPO</th><th>Mês ant.</th><th>Var.</th></tr>${linhas.map(([n, x, y]) => `<tr><td>${esc(n)}</td><td>${x}</td><td>${y}</td><td>${variaTxt(x, y)}</td></tr>`).join('')}</table></div>` : '';
        return `<details class="co-lista-det co-comp" open><summary>📆 Comparação com o mês anterior — ${br(parseData(m.ini))}${m.ini !== m.fim ? ' a ' + br(parseData(m.fim)) : ''}${r.hIni ? `, das ${r.hIni} às ${r.hFim}` : ', dias inteiros'} · ${esc((it.cidades || []).join(', ') || 'área')}</summary>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:.6rem;align-items:start;">
                <table class="co-mini"><tr><th>Indicador</th><th>OPO</th><th>Mês ant.</th><th>Var.</th></tr>
                    ${linha('Ocorrências', k.ocorrencias, a.ocorrencias)}${linha('Prisões', k.prisoes, a.prisoes)}${linha('Drogas', k.drogasG, a.drogasG, peso)}${linha('Armas', k.armas, a.armas)}${linha('Materiais', k.materiais, a.materiais)}</table>
                ${tabComp('Cidade', r.porCidadeComp)}
                ${tabComp('Bairro', r.porBairroComp)}
            </div></details>`;
    }
    // Tipificação clicável → ocorrências daquela tipificação (detalhe como no CAD)
    function tabTip(r, it) {
        const linhas = r.porTip || [];
        if (!linhas.length) return '';
        return `<table class="co-mini"><tr><th>Tipificação <small style="font-weight:400;">(clique para ver as ocorrências)</small></th><th style="text-align:right">Qtd.</th></tr>${linhas.slice(0, 12).map(([k, v]) =>
            `<tr class="co-clicavel" data-tip="${esc(k)}" data-res="${esc(chaveRes(it, r.modo))}"><td>${esc(k)}</td><td style="text-align:right">${fmtN(v)}</td></tr>`).join('')}</table>`;
    }
    function listaOcorrenciasHTML(lista) {
        const l = lista || [];
        return `<details class="co-lista-det"><summary>📋 Ocorrências (${l.length}) <small style="font-weight:400;">— clique numa linha para ver a ocorrência completa</small></summary>${l.length
            ? `<div class="co-scroll" style="max-height:300px;"><table class="co-mini"><tr><th>Data</th><th>Hora</th><th>Boletim</th><th>Cidade</th><th>Endereço</th><th>Tipificação</th><th>Solução</th></tr>${l.map(o =>
                `<tr class="co-clicavel" data-bol="${esc(o.b)}"><td>${esc(o.d)}</td><td>${esc(o.h)}</td><td>${esc(o.b)}</td><td>${esc(o.c)}</td><td>${esc(o.e)}</td><td>${esc(o.t)}</td><td>${esc(o.s)}</td></tr>`).join('')}</table></div>`
            : '<div class="co-det-meta">Nenhum registro.</div>'}</details>`;
    }
    function ligarOcorrencias(raiz) {
        raiz.querySelectorAll('[data-tip]').forEach(tr => tr.addEventListener('click', () => {
            const r = RES[tr.dataset.res];
            abrirOcorrencias(`Tipificação: ${tr.dataset.tip}`, ((r && r.listaOcorrencias) || []).filter(o => o.t === tr.dataset.tip));
        }));
        raiz.querySelectorAll('[data-bol]').forEach(tr => tr.addEventListener('click', e => {
            e.stopPropagation();
            const lista = [...tr.closest('table').querySelectorAll('[data-bol]')].map(x => ({ d: x.cells[0].innerText, h: x.cells[1].innerText, b: x.dataset.bol, c: x.cells[3].innerText, e: x.cells[4].innerText, t: x.cells[5].innerText, s: x.cells[6].innerText }));
            abrirOcorrencias('Ocorrências', lista, tr.dataset.bol);
        }));
    }

    // ── Ocorrência completa (igual à Busca Integrada de Pessoas) ──
    // 1º o registro do Firebase (/geral — todos os campos importados do CAD);
    // depois, com o atualizador local, o detalhe completo direto do CAD
    // (mesma rota da Busca Integrada: /pessoa/ocorrencia-detalhe?tipo=despacho).
    const CAD_CACHE = {};
    // Também usado pelo painel de desempenho (js/desempenho-guarnicoes.js).
    window.CO_abrirOcorrencias = (...args) => abrirOcorrencias(...args);
    function abrirOcorrencias(titulo, lista, boletimInicial) {
        const m = document.getElementById('co-ocor');
        document.getElementById('co-ocor-tit').textContent = `🚨 ${titulo} (${lista.length})`;
        document.getElementById('co-ocor-lista').innerHTML = lista.length ? `<table class="co-mini">${lista.map(o =>
            `<tr class="co-clicavel" data-ver="${esc(o.b)}"><td>${esc(o.d)} ${esc(o.h)}</td><td><b>${esc(o.b)}</b></td><td>${esc(o.t)}</td><td>${esc(o.e || o.c)}</td></tr>`).join('')}</table>` : '<div class="co-vazio">Nenhuma ocorrência.</div>';
        document.getElementById('co-ocor-det').innerHTML = '<div class="co-vazio">Selecione uma ocorrência na lista.</div>';
        m.querySelectorAll('[data-ver]').forEach(tr => tr.addEventListener('click', () => verOcorrencia(tr.dataset.ver)));
        m.classList.add('aberto');
        if (boletimInicial || lista.length === 1) verOcorrencia(boletimInicial || lista[0].b);
    }
    const kvHTML = obj => '<div class="co-kv">' + Object.entries(obj || {}).filter(([, v]) => val(v)).map(([k, v]) => `<div><b>${esc(k)}:</b> ${esc(v)}</div>`).join('') + '</div>';
    const NOMES_GERAL = { BOLETIM: 'Nº Ocorrência', DATA: 'Data', HORA: 'Hora', CIDADE: 'Cidade', BAIRRO: 'Bairro', LOGRADOURO: 'Logradouro', ESTABELECIMENTO: 'Estabelecimento',
        TIPIFICACAO_GERAL: 'Tipificação', TIPIFICACAO: 'Tipificação (despacho)', 'SOLUÇÃO': 'Solução', ATENDENTE: 'Atendente', SOLICITANTE: 'Solicitante',
        ATENDIMENTO_INICIAL: 'Atendimento inicial', TEXTO_DESPACHANTE: 'Texto do despachante', OBITO: 'Óbito?', LATITUDE: 'Latitude', LONGITUDE: 'Longitude' };
    async function verOcorrencia(bol) {
        document.querySelectorAll('#co-ocor-lista [data-ver]').forEach(tr => tr.classList.toggle('sel', tr.dataset.ver === bol));
        const det = document.getElementById('co-ocor-det');
        const geral = (await ControleOPO.carregarNo('geral')).find(g => String(g.BOLETIM) === String(bol));
        const base = {};
        if (geral) Object.keys(NOMES_GERAL).forEach(k => { if (val(geral[k])) base[NOMES_GERAL[k]] = geral[k]; });
        det.innerHTML = `<div class="co-card-topo"><div><h3>Ocorrência ${esc(bol)}</h3><p>${geral ? esc(val(geral.TIPIFICACAO_GERAL)) : 'não encontrada na base importada'}</p></div></div>
            ${geral ? `<div class="co-ocor-bloco"><div class="co-ocor-sub">Dados importados do CAD (base do sistema)</div>${kvHTML(base)}</div>` : ''}
            <div class="co-ocor-bloco" id="co-ocor-cad"><div class="co-det-meta">⏳ Buscando o detalhe completo no CAD (atualizador local)…</div></div>`;
        const alvo = document.getElementById('co-ocor-cad');
        try {
            if (!window.P3AtualizadorLocal || !P3AtualizadorLocal.ocorrenciaDetalhe) throw new Error('atualizador local não carregado');
            const resp = CAD_CACHE[bol] || await P3AtualizadorLocal.ocorrenciaDetalhe({ tipo: 'despacho', idOcor: bol });
            if (!resp || !resp.ok) throw new Error((resp && resp.erro) || 'sem resposta');
            CAD_CACHE[bol] = resp;
            if (!document.getElementById('co-ocor-cad')) return;
            const d = resp.detalhe || {};
            const env = (d.envolvidos || []), vei = (d.veiculos || []);
            alvo.innerHTML = `<div class="co-ocor-sub">Ocorrência completa — CAD</div>${kvHTML(d.campos)}
                ${env.length ? `<div class="co-ocor-sub">Envolvidos (${env.length})</div>${env.map((p, i) => `<div class="co-ocor-env"><b>${i + 1}.</b> ${kvHTML(p)}</div>`).join('')}` : ''}
                ${vei.length ? `<div class="co-ocor-sub">Veículos (${vei.length})</div>${vei.map((v, i) => `<div class="co-ocor-env"><b>${i + 1}.</b> ${kvHTML(v)}</div>`).join('')}` : ''}`;
        } catch (e) {
            const msg = String(e.message || e);
            alvo.innerHTML = `<div class="co-det-meta">ℹ️ Detalhe completo do CAD indisponível (${esc(/Failed to fetch|NetworkError|carregado/i.test(msg) ? 'abra o Sistema P3 (atualizador local) com nível P2/ADMIN' : msg)}). Acima, os dados já importados.</div>`;
        }
    }

    // ── Relatório da OPO: dia clicado ou geral/parcial (início → fim/hoje) ──
    let REL_ATUAL = null;
    function abrirRelatorioOPO(it, dia) {
        const m = document.getElementById('co-rel');
        const diaOk = dia && it.dias.includes(dia) && parseData(dia) <= hoje0() ? dia : iso(it.ini);
        REL_ATUAL = { it, dia: diaOk, escopo: 'dia', modo: temHorario(it) ? modoDe(it) : 'horario' };
        document.getElementById('co-rel-tit').textContent = '📊 Relatório — ' + it.nome;
        const fimGeral = it.fim > hoje0() ? hoje0() : it.fim;
        document.getElementById('co-rel-opcoes').innerHTML = `
            <div class="co-modo"><span>Período:</span>
                <button data-rel-esc="dia">📅 Dia ${br(parseData(diaOk))}</button>
                <button data-rel-esc="geral">📈 ${it.fim > hoje0() ? 'Parcial' : 'Geral'} da OPO (${br(it.ini)} a ${br(fimGeral)})</button></div>
            ${temHorario(it) ? `<div class="co-modo"><span>Recorte:</span>
                <button data-rel-modo="horario">⏰ Somente no horário (${esc(it.hIni)}–${esc(it.hFim)})</button>
                <button data-rel-modo="dia">📅 Dias inteiros</button></div>` : ''}`;
        m.querySelectorAll('[data-rel-esc]').forEach(b => b.onclick = () => { REL_ATUAL.escopo = b.dataset.relEsc; gerarRelatorioOPO(); });
        m.querySelectorAll('[data-rel-modo]').forEach(b => b.onclick = () => { REL_ATUAL.modo = b.dataset.relModo; gerarRelatorioOPO(); });
        m.classList.add('aberto');
        gerarRelatorioOPO();
    }
    async function gerarRelatorioOPO() {
        const { it, dia, escopo, modo } = REL_ATUAL;
        const m = document.getElementById('co-rel');
        m.querySelectorAll('[data-rel-esc]').forEach(b => b.classList.toggle('ativo', b.dataset.relEsc === escopo));
        m.querySelectorAll('[data-rel-modo]').forEach(b => b.classList.toggle('ativo', b.dataset.relModo === modo));
        const fr = document.getElementById('co-rel-frame');
        fr.srcdoc = '<p style="font:14px Arial;padding:20px;">⏳ Cruzando com o CAD…</p>';
        document.getElementById('co-rel-imprimir').disabled = true;
        try {
            let r;
            if (escopo === 'dia') r = await calcularRecorte(it, parseData(dia), parseData(dia), modo);
            else {
                r = resDe(it, modo);
                if (!r || !r.mesAnterior || pendente(it, modo)) r = await computar(it, modo);
            }
            REL_ATUAL.html = htmlRelatorioOPO(it, r, escopo);
            fr.srcdoc = REL_ATUAL.html;
            document.getElementById('co-rel-imprimir').disabled = false;
        } catch (e) {
            fr.srcdoc = `<p style="font:14px Arial;padding:20px;color:#b00;">Não foi possível gerar: ${esc(e.message)}</p>`;
        }
    }
    function htmlRelatorioOPO(it, r, escopo) {
        const k = r.kpi, b = r.antes, ma = r.mesAnterior || { kpi: {} }, a = ma.kpi;
        const per = `${br(parseData(r.ini))}${r.ini !== r.fim ? ' a ' + br(parseData(r.fim)) : ''}`;
        const rec = r.hIni ? `somente das ${r.hIni} às ${r.hFim}` : 'dias inteiros';
        const tab = (tit, cols, linhas) => `<h2>${tit} (${linhas.length})</h2><table><tr>${cols.map(c => `<th>${c[0]}</th>`).join('')}</tr>${linhas.length ? linhas.map(l => `<tr>${cols.map(c => `<td>${esc(c[1](l))}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}">Nenhum registro.</td></tr>`}</table>`;
        const comp = (tit, linhas) => `<table><caption>${tit}</caption><tr><th>${tit.split(' ')[0]}</th><th>OPO</th><th>Mês anterior</th><th>Variação</th></tr>${(linhas || []).length ? linhas.map(([n, x, y]) => `<tr><td>${esc(n)}</td><td>${x}</td><td>${y}</td><td>${variaTxt(x, y).replace(/<[^>]+>/g, '')}</td></tr>`).join('') : '<tr><td colspan="4">Nenhum registro.</td></tr>'}</table>`;
        const ind = (rot, x, y, z, f = fmtN) => `<tr><td>${rot}</td><td><b>${x == null ? '—' : f(x)}</b></td><td>${y == null ? '—' : f(y)}</td><td>${variaTxt(x, y).replace(/<[^>]+>/g, '')}</td><td>${z == null ? '—' : f(z)}</td><td>${variaTxt(x, z).replace(/<[^>]+>/g, '')}</td></tr>`;
        const quant = l => l.q ? `${l.q} ${(l.u || '').toLowerCase()}`.trim() : '—';
        return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><title>Relatório — ${esc(it.nome)}</title><style>
            body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:12mm;font-size:9.5pt}
            .cab{display:flex;align-items:center;gap:12px;border-bottom:2px solid #0b2545;padding-bottom:8px;margin-bottom:10px}.cab img{height:56px}
            h1{font-size:13.5pt;margin:0;color:#0b2545;text-transform:uppercase}.sub{color:#444;font-size:9pt;margin-top:2px}
            h2{font-size:10.5pt;color:#0b2545;border-bottom:1.5px solid #0b2545;padding-bottom:2px;margin:14px 0 6px;text-transform:uppercase}
            table{border-collapse:collapse;width:100%;margin:4px 0 8px;font-size:8.5pt}caption{text-align:left;font-weight:bold;margin-bottom:2px}
            th,td{border:1px solid #bbb;padding:3px 5px;text-align:left;vertical-align:top}th{background:#e8eef7}
            .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:start}.nota{font-size:7.5pt;color:#555;margin-top:12px;border-top:1px solid #ccc;padding-top:5px}
        </style></head><body>
            <div class="cab">${CFG.logoUrl ? `<img src="${esc(new URL(CFG.logoUrl, location.href).href)}" alt="">` : ''}<div>
                <h1>Relatório da Operação — ${escopo === 'dia' ? 'dia ' + per : (r.parcial ? 'parcial' : 'geral')}</h1>
                <div class="sub"><b>${esc(it.nome)}</b> · ${esc(CFG.nome || '')}</div>
                <div class="sub">Período: ${per} · ${rec} · Cidades: ${esc((it.cidades || []).join(', ') || 'área completa')}${it.eventoNome ? ' · Evento: ' + esc(it.eventoNome) : ''} · Emitido em ${new Date().toLocaleString('pt-BR')}</div></div></div>
            <h2>1. Indicadores</h2>
            <table><tr><th>Indicador</th><th>Na operação</th><th>Período imediatamente anterior</th><th>Var.</th><th>Mesmos dias do mês anterior${ma.ini ? ` (${br(parseData(ma.ini))}${ma.ini !== ma.fim ? ' a ' + br(parseData(ma.fim)) : ''})` : ''}</th><th>Var.</th></tr>
                ${ind('Ocorrências', k.ocorrencias, b.ocorrencias, a.ocorrencias)}${ind('Prisões / apreensões', k.prisoes, b.prisoes, a.prisoes)}
                ${ind('Drogas apreendidas', k.drogasG, b.drogasG, a.drogasG, peso)}${ind('Armas apreendidas', k.armas, b.armas, a.armas)}${ind('Materiais apreendidos', k.materiais, b.materiais, a.materiais)}</table>
            <h2>2. Comparação com o mês anterior</h2>
            <div class="grid">${comp('Cidade', r.porCidadeComp)}${comp('Bairro', (r.porBairroComp || []).slice(0, 25))}</div>
            ${comp('Tipificação', (r.porTipComp || []).slice(0, 20))}
            ${tab('3. Ocorrências durante a operação', [['Data', l => l.d], ['Hora', l => l.h], ['Boletim', l => l.b], ['Cidade', l => l.c], ['Endereço', l => l.e], ['Tipificação', l => l.t], ['Solução', l => l.s]], r.listaOcorrencias || [])}
            ${tab('4. Drogas apreendidas', [['Data', l => l.d], ['Boletim', l => l.b], ['Tipo', l => l.t], ['Quantidade', quant], ['Cidade', l => l.c]], r.listaDrogas || [])}
            ${tab('5. Armas apreendidas', [['Data', l => l.d], ['Boletim', l => l.b], ['Tipo', l => l.t], ['Marca / modelo / calibre', l => l.m], ['Situação', l => l.s]], r.listaArmas || [])}
            ${tab('6. Materiais apreendidos', [['Data', l => l.d], ['BOU', l => l.b], ['Categoria', l => l.t], ['Descrição', l => l.x], ['Status', l => l.s]], r.listaMateriais || [])}
            ${tab('7. Prisões / apreensões', [['Boletim', l => l.b], ['Situação', l => l.s], ['Tipificação', l => l.t], ['Cidade', l => l.c]], r.listaPrisoes || [])}
            <div class="nota">Fonte: CAD/SISP (ocorrências, drogas, armas, autores) e planilha de materiais apreendidos (pelo nº do BOU), nas cidades de vigência da operação. "Período imediatamente anterior" = mesmo número de dias logo antes; "mês anterior" = mesmos dias do mês anterior, mesmo horário. Sem nomes de pessoas.</div>
            <script>window.onload=function(){if(window.__autoPrint)setTimeout(function(){window.print();},400);};<\/script>
        </body></html>`;
    }
    async function imprimirRelatorioOPO() {
        if (!REL_ATUAL || !REL_ATUAL.html) return;
        if (window.pywebview) {
            try { await abrirNoNavegador({ tipo: 'impressao', html: REL_ATUAL.html.replace('window.__autoPrint', 'true') }); } catch (e) { alert('Não foi possível abrir a impressão: ' + e.message); }
            return;
        }
        const w = document.getElementById('co-rel-frame').contentWindow;
        w.focus(); w.print();
    }

    // ── Busca de OPOs salvas (nome, cidade, bairro ou data) ─────────
    function textoBusca(it) {
        const o = it.raw || {};
        const bairrosRes = [it.chave, it.chave + '_dia'].flatMap(k => ((RES[k] || {}).listaOcorrencias || []).map(x => x.e));
        return nrm([it.nome, it.eventoNome, o.vigenciaTexto, o.local, ...(it.cidades || []), ...(o.bairros || []), ...(o.locais || []),
            ...((o.alocacoes || []).map(a => `${a.cidade} ${a.guarnicao}`)), ...bairrosRes].filter(Boolean).join(' | '));
    }
    function buscarOPOs(q) {
        const termo = nrm(q).trim();
        if (termo.length < 2) return [];
        const mData = termo.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
        return ITENS.filter(i => i.tipo === 'opo').filter(it => {
            if (mData) {
                const dd = mData[1].padStart(2, '0'), mm = mData[2].padStart(2, '0'), aa = mData[3] ? (mData[3].length === 2 ? '20' + mData[3] : mData[3]) : null;
                return it.dias.some(d => d.slice(8, 10) === dd && d.slice(5, 7) === mm && (!aa || d.slice(0, 4) === aa));
            }
            const txt = textoBusca(it);
            return termo.split(/\s+/).every(p => txt.includes(p));
        }).sort((a, b) => b.ini - a.ini);
    }
    function renderBusca() {
        const q = document.getElementById('co-busca').value;
        const out = document.getElementById('co-busca-res');
        const res = buscarOPOs(q);
        if (nrm(q).trim().length < 2) { out.classList.remove('aberto'); out.innerHTML = ''; return; }
        out.innerHTML = res.length ? res.slice(0, 30).map(it => `<div class="co-busca-item" data-ir="${esc(it.dias[0])}" data-chave="${esc(it.chave)}">
                <b>${esc(it.nome)}</b>${it.eventoId ? ' <span class="co-tag" style="background:#6d4c41">EVENTO</span>' : ''}${(it.modalidade === 'sufocamento' ? ' <span class="co-tag" style="background:#b91c1c">SUFOCAMENTO</span>' : '')}
                <small>${br(it.ini)}${it.fim - it.ini ? ' a ' + br(it.fim) : ''} · ${esc(it.cidades.join(', ') || 'área completa')}${it.hIni ? ` · ${it.hIni}–${it.hFim}` : ''}</small></div>`).join('')
            + (res.length > 30 ? `<div class="co-det-meta" style="padding:.4rem .7rem;">+${res.length - 30} resultado(s) — refine a busca.</div>` : '')
            : '<div class="co-det-meta" style="padding:.6rem .8rem;">Nenhuma OPO encontrada.</div>';
        out.classList.add('aberto');
        out.querySelectorAll('[data-ir]').forEach(el => el.addEventListener('click', () => {
            const d = parseData(el.dataset.ir);
            mesAtual = new Date(d.getFullYear(), d.getMonth(), 1);
            renderGeral(); out.classList.remove('aberto');
            abrirDia(el.dataset.ir);
            setTimeout(() => { const alvo = [...document.querySelectorAll('#co-modal-corpo .co-det h4')].find(h => h.textContent.includes(ITENS.find(x => x.chave === el.dataset.chave).nome)); if (alvo) alvo.scrollIntoView({ block: 'start' }); }, 50);
        }));
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
            ${comparacaoMesHTML(r, it)}
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:.6rem;align-items:start;">${tabTip(r, it)}${tabMini('Droga (peso)', r.drogasPorTipo, peso) || tabMini('Droga', [['Nenhuma', 0]])}${tabMini('Arma', r.armasPorTipo) || tabMini('Arma', [['Nenhuma', 0]])}${tabMini('Material', r.materiaisPorCat) || tabMini('Material', [['Nenhum', 0]])}</div>
            ${listasHTML(r)}
            <div class="co-det-meta" style="margin-top:.4rem;">Computado em ${new Date(r.calculadoEm).toLocaleString('pt-BR')} (${br(parseData(r.ini))} a ${br(parseData(r.fim))}, ${r.hIni && r.hFim ? 'das ' + r.hIni + ' às ' + r.hFim : 'dia inteiro'})${r.parcial ? ' — PARCIAL, a operação ainda está em andamento' : ''}. "Antes" = mesmo intervalo e horário imediatamente anterior.</div>`
            : `<div class="co-det-meta" style="margin:.5rem 0;">${podeCalcular(it) ? 'Resultados ainda não computados.' : 'Ainda não iniciado — os resultados poderão ser computados a partir da data de início.'}</div>`;
        const ex = it.tipo === 'opo' ? `
            <div class="co-exec" id="exec-${esc(it.chave)}">
                De <input type="date" data-e="ini" value="${it.semExecucao ? '' : iso(it.ini)}"> até <input type="date" data-e="fim" value="${it.semExecucao ? '' : iso(it.fim)}">
                das <input type="time" data-e="hIni" value="${esc(it.hIni)}"> às <input type="time" data-e="hFim" value="${esc(it.hFim)}">
                <button class="co-btn co-btn-pri" data-salvar-exec="${esc(it.chave)}">Salvar execução</button></div>` : '';
        return `<div class="co-det" style="--c:${cor}">
            <h4>${it.tipo === 'opo' ? '🎯' : '🎉'} ${esc(it.nome)} ${it.tipo === 'opo' ? `<span class="co-tag" style="background:${cor}">OPO</span>` : `<span class="co-tag" style="background:${cor}">${it.porte} PORTE</span>`}${(it.modalidade === 'sufocamento' ? ' <span class="co-tag" style="background:#b91c1c">SUFOCAMENTO</span>' : '')}</h4>
            <div class="co-det-meta">${meta}</div>${filtro}<div class="co-det-res">${kp}</div>
            <div class="co-det-acoes">
                ${podeCalcular(it) ? `<button class="co-btn co-btn-pri" data-computar="${esc(it.chave)}">${r ? '↻ Recalcular resultados' : '⚙ Computar resultados do CAD'}</button>` : ''}
                ${it.tipo === 'opo' && it.modelo === 'evento' ? `<button class="co-btn co-btn-pri" data-editar-opo="${esc(it.chave)}">✏️ Editar OPO</button>` : ''}
                ${it.tipo === 'opo' ? `<button class="co-btn" data-doc="${esc(it.chave)}">📄 Ver OPO (Word / PDF)</button>` : ''}
                ${it.tipo === 'opo' && podeCalcular(it) ? `<button class="co-btn" data-relatorio="${esc(it.chave)}">📊 Relatório</button>` : ''}
                ${it.tipo === 'opo' ? `<button class="co-btn" data-exec="${esc(it.chave)}">📅 Período de execução</button>` : ''}
                ${it.tipo === 'evento' ? (() => { const salva = opoDoEvento(it).find(o => o.modelo === 'evento');
                    return salva ? `<button class="co-btn co-btn-pri" data-editar-opo="${esc(salva.chave)}">✏️ Abrir OPO do evento</button>`
                                 : `<button class="co-btn co-btn-pri" data-opo-evento="${esc(it.chave)}">📝 Gerar OPO do evento</button>`; })() : ''}
                ${it.tipo === 'evento' ? `<button class="co-btn" data-nova-evento="${esc(it.chave)}">🎯 OPO Inteligente do evento</button>` : ''}
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

    // ── OPO de EVENTO (modelo relatorios/gerar_opo.html) num modal ──
    // Gera o modelo com os dados cadastrados do evento (ou reabre a OPO já
    // salva), editável livremente; salva como OPO (aparece no calendário,
    // vinculada ao evento, com resultados do CAD) + documento (Word/PDF).
    let EVT_OPO = null; // { ev, opo (item salvo ou null) }
    function abrirOPOEvento(ev, opo) {
        EVT_OPO = { ev, opo };
        window.CO_EVENTO_OPO = ev ? ev.raw : null; // lido pelo gerar_opo.html (mesma origem)
        const m = document.getElementById('co-evtopo');
        document.getElementById('co-evtopo-tit').textContent = `📝 OPO do evento — ${(opo && opo.eventoNome) || (ev && ev.nome) || ''}`;
        document.getElementById('co-evtopo-status').textContent = opo ? 'OPO salva — edite e salve novamente para atualizar.' : 'Modelo preenchido com os dados do evento — edite livremente e salve.';
        const q = new URLSearchParams({ embed: '1' });
        if (opo) q.set('opoId', opo.id); else if (ev) q.set('id', ev.id);
        document.getElementById('co-evtopo-frame').src = '../relatorios/gerar_opo.html?' + q.toString();
        document.getElementById('co-modal').classList.remove('aberto');
        m.classList.add('aberto');
    }
    async function apiOPOEvento() {
        const w = document.getElementById('co-evtopo-frame').contentWindow;
        for (let i = 0; i < 100 && !(w && w.OPOEvento); i++) await new Promise(r => setTimeout(r, 100));
        if (!w || !w.OPOEvento) throw new Error('modelo da OPO não carregou');
        await w.OPOEvento.pronto;
        return w.OPOEvento;
    }
    const blobBase64 = blob => new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
    async function salvarOPOEvento() {
        const btn = document.getElementById('co-evtopo-salvar'), st = document.getElementById('co-evtopo-status');
        btn.disabled = true; btn.textContent = '⏳ Salvando…';
        try {
            const api = await apiOPOEvento();
            const d = api.dados();
            const per = ControleOPO.parseVigencia(d.data, new Date());
            if (!per) throw new Error('a data da OPO ("' + d.data + '") não está no formato dd/mm/aaaa');
            const h = v => { const m = String(v || '').match(/(\d{1,2}):(\d{2})/); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null; };
            const ev = EVT_OPO.ev, antigo = EVT_OPO.opo;
            const nomeBase = (d.nome || (ev && ev.nome) || 'EVENTO').toUpperCase();
            const sessao = window.P3 && P3.getSession ? P3.getSession() : null;
            const registro = {
                tipo: 'opo', modelo: 'evento', nome: /^OPO\b/.test(nomeBase) ? nomeBase : 'OPO — ' + nomeBase,
                eventoId: ev ? ev.id : (antigo && antigo.eventoId) || null, eventoNome: ev ? ev.nome : (antigo && antigo.eventoNome) || nomeBase,
                cidade: d.cidade || '', cidades: [d.cidade].filter(Boolean), escopo: 'cidade', local: d.local || '',
                vigenciaTexto: d.data, execucao: { dataIni: iso(per.ini), dataFim: iso(per.fim), horaIni: h(d.inicio), horaFim: h(d.fim) },
                temDocumento: true, atualizadoEm: new Date().toISOString(),
            };
            let id = antigo ? antigo.id : null;
            if (id) {
                const r = await fetch(`${DB}/cartoes_programa/${encodeURIComponent(id)}.json`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(registro) });
                if (!r.ok) throw new Error('Firebase respondeu HTTP ' + r.status);
            } else {
                Object.assign(registro, { criadoEm: new Date().toISOString(), data: new Date().toLocaleDateString('pt-BR'),
                    criadoPor: sessao ? [sessao.graduacao, sessao.nomeGuerra].filter(Boolean).join(' ') : null });
                const r = await fetch(`${DB}/cartoes_programa.json`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(registro) });
                if (!r.ok) throw new Error('Firebase respondeu HTTP ' + r.status);
                id = (await r.json()).name;
            }
            btn.textContent = '⏳ Salvando documento…';
            const dx = await api.gerarDocx();
            const doc = { nome: registro.nome, modelo: 'evento', html: api.documentoHTML(), folhaHTML: api.folhaHTML(),
                docxBase64: dx && dx.blob ? await blobBase64(dx.blob) : null, docxNome: dx ? dx.nomeArq : null, criadoEm: new Date().toISOString() };
            const r2 = await fetch(`${DB}/opo_documentos/${encodeURIComponent(id)}.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc) });
            if (!r2.ok) throw new Error('documento não salvo (HTTP ' + r2.status + ')');
            // Período/horário podem ter mudado → resultados antigos não valem mais.
            const chave = 'opo_' + chaveFb(id);
            await Promise.all([chave, chave + '_dia'].map(k => fetch(`${DB}/${NO_RES}/${k}.json`, { method: 'DELETE' }).catch(() => {})));
            await carregarTudo();
            EVT_OPO.opo = ITENS.find(x => x.chave === chave) || EVT_OPO.opo;
            mesAtual = new Date(per.ini.getFullYear(), per.ini.getMonth(), 1);
            renderGeral();
            st.textContent = `✅ OPO salva em ${new Date().toLocaleTimeString('pt-BR')} — está no calendário (${br(per.ini)}${per.fim - per.ini ? ' a ' + br(per.fim) : ''}), vinculada ao evento.`;
        } catch (e) {
            console.error('[controle-operacoes] OPO do evento', e);
            alert('Não foi possível salvar a OPO: ' + e.message);
        } finally { btn.disabled = false; btn.textContent = '💾 Salvar OPO'; }
    }
    async function wordOPOEvento() {
        try {
            const api = await apiOPOEvento();
            const dx = await api.gerarDocx();
            if (!dx || !dx.blob) return;
            if (window.pywebview) { // .exe não baixa arquivo → navegador padrão
                await abrirNoNavegador({ tipo: 'arquivo', nome: dx.nomeArq, base64: await blobBase64(dx.blob), mime: dx.blob.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
                return;
            }
            const a = document.createElement('a');
            a.href = URL.createObjectURL(dx.blob); a.download = dx.nomeArq;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        } catch (e) { alert('Não foi possível gerar o Word: ' + e.message); }
    }
    async function pdfOPOEvento() {
        try {
            const api = await apiOPOEvento();
            if (window.pywebview) {
                const html = api.documentoHTML().replace('</body>', '<script>window.onload=function(){setTimeout(function(){window.print();},700);};<\/script></body>');
                await abrirNoNavegador({ tipo: 'impressao', html });
                return;
            }
            const w = document.getElementById('co-evtopo-frame').contentWindow;
            w.focus(); w.print(); // "Salvar como PDF" na janela de impressão
        } catch (e) { alert('Não foi possível abrir a impressão: ' + e.message); }
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
        document.getElementById('co-doc-refazer').textContent = it.modelo === 'evento' ? '✏️ Editar OPO' : '🔁 Gerar novamente';
        document.getElementById('co-doc-refazer').onclick = () => {
            m.classList.remove('aberto');
            if (it.modalidade === 'sufocamento') location.href = 'opo-sufocamento.html?data=' + encodeURIComponent((it.raw.execucao || {}).dataIni || '') + '&cidade=' + encodeURIComponent(it.raw.cidade || '');
            else if (it.modelo === 'evento') abrirOPOEvento(ITENS.find(x => x.tipo === 'evento' && String(x.id) === String(it.eventoId)) || null, it);
            else abrirNovaOPO(prefillOpo(it));
        };
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
        return { de, ate, cidade: document.getElementById('f-cidade').value, tipo: document.getElementById('f-tipo').value, porte: document.getElementById('f-porte').value,
            opo: document.getElementById('f-opo').value, recorte: document.getElementById('f-recorte').value === 'dia' ? 'dia' : 'horario' };
    }
    // Lista de OPOs para o filtro "Operação (OPO)" — mais recentes primeiro.
    function montarOpcoesOPO() {
        const sel = document.getElementById('f-opo'), atual = sel.value;
        const opos = ITENS.filter(i => i.tipo === 'opo').sort((a, b) => b.ini - a.ini);
        sel.innerHTML = '<option value="">Todas as operações e eventos do filtro</option>' + opos.map(o =>
            `<option value="${esc(o.chave)}">${br(o.ini)}${o.fim - o.ini ? ' a ' + br(o.fim) : ''} — ${esc(o.nome)} (${esc(o.cidades.join(', ') || 'área completa')})</option>`).join('');
        sel.value = opos.some(o => o.chave === atual) ? atual : '';
    }
    function filtrar(f) {
        if (f.opo) return ITENS.filter(it => it.chave === f.opo); // OPO específica: ignora os demais filtros
        return ITENS.filter(it => {
            if (f.de && it.fim < f.de) return false;
            if (f.ate && it.ini > f.ate) return false;
            if (f.tipo && it.tipo !== f.tipo) return false;
            if (f.porte && it.tipo === 'evento' && it.porte !== f.porte) return false;
            if (f.cidade && !it.cidades.some(c => nrm(c) === nrm(f.cidade)) && !(it.tipo === 'opo' && !it.cidades.length)) return false;
            return true;
        });
    }
    // Durante a operação × mesmos dias do mês anterior (mesmo horário e cidades),
    // somando apenas os itens cujo resultado já traz o mês anterior.
    function agregarComparacao(lista, rec) {
        const campos = ['ocorrencias', 'prisoes', 'drogasG', 'armas', 'materiais'];
        const dur = Object.fromEntries(campos.map(c => [c, 0])), ant = Object.fromEntries(campos.map(c => [c, 0]));
        const soma3 = campo => {
            const m = new Map();
            lista.forEach(it => { const r = resDe(it, rec); if (!r || !r.mesAnterior) return;
                (r[campo] || []).forEach(([k, x, y]) => { const v = m.get(k) || [0, 0]; v[0] += x; v[1] += y; m.set(k, v); }); });
            return [...m.entries()].map(([k, [x, y]]) => [k, x, y]).sort((p, q) => q[1] - p[1] || q[2] - p[2]);
        };
        const porMes = {};
        let com = 0;
        lista.forEach(it => {
            const r = resDe(it, rec); if (!r || !r.mesAnterior) return;
            com++;
            campos.forEach(c => { dur[c] += r.kpi[c] || 0; ant[c] += r.mesAnterior.kpi[c] || 0; });
            const k = iso(it.ini).slice(0, 7), pm = porMes[k] || (porMes[k] = [0, 0]);
            pm[0] += r.kpi.ocorrencias || 0; pm[1] += r.mesAnterior.kpi.ocorrencias || 0;
        });
        return { com, dur, ant, porCidade: soma3('porCidadeComp'), porBairro: soma3('porBairroComp'), porTip: soma3('porTipComp'),
            porMes: Object.entries(porMes).sort((a, b) => a[0].localeCompare(b[0])) };
    }
    const tabComp3 = (tit, linhas, max = 15) => `<div><div class="co-card-tit" style="font-size:.8rem;margin-bottom:.3rem;">${tit}</div>${linhas.length
        ? `<div class="co-scroll" style="max-height:300px;"><table class="co-mini"><tr><th>${tit}</th><th>Durante</th><th>Mês ant.</th><th>Var.</th></tr>${linhas.slice(0, max).map(([n, x, y]) =>
            `<tr><td>${esc(n)}</td><td>${fmtN(x)}</td><td>${fmtN(y)}</td><td>${variaTxt(x, y)}</td></tr>`).join('')}</table></div>` : '<div class="co-det-meta">Sem dados.</div>'}</div>`;

    function agregar(lista, rec = 'horario') {
        const somaPares = (campo) => { const m = {}; lista.forEach(it => ((resDe(it, rec) || {})[campo] || []).forEach(([k, v]) => { m[k] = (m[k] || 0) + v; })); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
        const meses = {};
        lista.forEach(it => {
            const k = iso(it.ini).slice(0, 7);
            const m = meses[k] || (meses[k] = { opo: 0, evento: 0, prisoes: 0, armas: 0, materiais: 0, drogasG: 0, ocorrencias: 0 });
            m[it.tipo]++;
            const r = resDe(it, rec); if (r) ['prisoes', 'armas', 'materiais', 'drogasG', 'ocorrencias'].forEach(c => { m[c] += r.kpi[c] || 0; });
        });
        const combate = {};
        lista.filter(i => i.tipo === 'opo').forEach(i => i.tiposCombate.forEach(t => { combate[t] = (combate[t] || 0) + 1; }));
        const evs = lista.filter(i => i.tipo === 'evento');
        return {
            lista, rec, opos: lista.filter(i => i.tipo === 'opo'), evs, tot: somaRes(lista, rec),
            publico: evs.reduce((s, e) => s + (e.publico || 0), 0),
            meses: Object.entries(meses).sort((a, b) => a[0].localeCompare(b[0])),
            porCidade: somaPares('porCidade'), porTip: somaPares('porTip'), drogas: somaPares('drogasPorTipo'), armas: somaPares('armasPorTipo'), materiais: somaPares('materiaisPorCat'),
            porte: { 'MÉDIO': evs.filter(e => e.porte === 'MÉDIO').length, GRANDE: evs.filter(e => e.porte === 'GRANDE').length },
            combate: Object.entries(combate).sort((a, b) => b[1] - a[1]),
            pend: lista.filter(it => pendente(it, rec)),
            comp: agregarComparacao(lista, rec),
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
        const A = agregar(filtrar(FILTRO), FILTRO.recorte);
        // Com uma OPO escolhida, os filtros de período/cidade/tipo/porte não se aplicam.
        ['f-de', 'f-ate', 'f-cidade', 'f-tipo', 'f-porte'].forEach(id => { document.getElementById(id).disabled = !!FILTRO.opo; });
        renderPainelOPO(A);
        const per = FILTRO.opo && A.lista[0] ? `${br(A.lista[0].ini)} a ${br(A.lista[0].fim)}` : `${FILTRO.de ? br(FILTRO.de) : 'início'} a ${FILTRO.ate ? br(FILTRO.ate) : 'hoje'}`;
        const C = A.comp;
        const subMes = (c, so, f = fmtN) => C.com ? `${so ? '' : '<br>'}mês anterior: ${f(C.ant[c])} ${variaTxt(C.dur[c], C.ant[c])}` : '';
        document.getElementById('co-kpis-est').innerHTML =
            kpi('#1f5fbf', 'Operações (OPO)', A.opos.length, per) +
            kpi('#e67e22', 'Eventos médio/grande', A.evs.length, `${fmtN(A.publico)} pessoas (público estimado)`) +
            kpi('#5e35b1', 'Ocorrências durante', fmtN(A.tot.ocorrencias), `${A.tot.com} de ${A.lista.length} com resultado${subMes('ocorrencias')}`) +
            kpi('#c0392b', 'Prisões / apreensões', fmtN(A.tot.prisoes), subMes('prisoes', true)) +
            kpi('#2e7d32', 'Drogas apreendidas', peso(A.tot.drogasG), subMes('drogasG', true, peso)) +
            kpi('#455a64', 'Armas apreendidas', fmtN(A.tot.armas), subMes('armas', true)) +
            kpi('#6d4c41', 'Materiais apreendidos', fmtN(A.tot.materiais), subMes('materiais', true));
        renderComparacaoEst(A);
        document.getElementById('co-aviso-est').innerHTML = A.pend.length
            ? `<div class="co-aviso">⚠️ ${A.pend.length} item(ns) do filtro sem resultado computado ou sem a comparação com o mês anterior — totais e comparação ficam incompletos.
                <button class="co-btn co-btn-pri" id="co-computar-est">⚙ Computar agora</button></div>` : '';
        const b = document.getElementById('co-computar-est');
        if (b) b.onclick = async () => { await computarVarios(A.pend, b, FILTRO.recorte); renderEstatisticas(); renderGeral(); };

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
            ${A.lista.map(it => { const r = resDe(it, A.rec); const k = r ? r.kpi : null; return `<tr>
                <td>${br(it.ini)}${it.fim - it.ini ? ' a ' + br(it.fim) : ''}</td><td>${it.tipo === 'opo' ? 'OPO' : 'Evento ' + it.porte.toLowerCase()}</td><td>${esc(it.nome)}</td>
                <td>${esc(it.cidades.join(', '))}</td><td>${horarioRecorte(it, A.rec)}</td>
                <td>${k ? k.ocorrencias : '—'}</td><td>${k ? (k.prisoes ?? '—') : '—'}</td><td>${k ? peso(k.drogasG) : '—'}</td><td>${k ? k.armas : '—'}</td><td>${k ? k.materiais : '—'}</td></tr>`; }).join('')}
            </tbody></table>` : '<div class="co-vazio">Nenhuma operação ou evento no filtro.</div>';
        return A;
    }

    // Horário efetivamente usado no recorte (para tabelas e relatório)
    const horarioRecorte = (it, rec) => temHorario(it) && rec !== 'dia' ? `${it.hIni}–${it.hFim}` : (temHorario(it) ? `dia inteiro (OPO: ${it.hIni}–${it.hFim})` : 'dia inteiro');
    const descRecorte = (it, rec) => `${br(it.ini)}${it.fim - it.ini ? ' a ' + br(it.fim) : ''} · ${temHorario(it) && rec !== 'dia' ? `somente das ${it.hIni} às ${it.hFim}` : 'dias inteiros (sem considerar o horário)'} · ${esc(it.cidades.join(', ') || 'área completa')}`;

    // Painel de resultados de UMA OPO (filtro "Operação (OPO)")
    function renderPainelOPO(A) {
        const el = document.getElementById('co-opo-det');
        if (!FILTRO.opo || !A.lista[0]) { el.innerHTML = ''; return; }
        const it = A.lista[0], r = resDe(it, A.rec);
        const varia = (a, b) => { if (a == null || b == null) return ''; if (!b) return a ? ' <span class="co-up">▲ novo</span>' : ''; const p = (a - b) / b * 100; return p ? ` <span class="${p > 0 ? 'co-up' : 'co-down'}">${p > 0 ? '▲' : '▼'} ${fmtN(Math.abs(p))}%</span>` : ' ='; };
        const corpo = !r
            ? `<div class="co-det-meta" style="margin:.5rem 0;">${podeCalcular(it) ? 'Resultado deste recorte ainda não computado.' : 'Operação ainda não iniciada.'}</div>
               ${podeCalcular(it) ? '<button class="co-btn co-btn-pri" id="co-opo-computar">⚙ Computar resultados do CAD</button>' : ''}`
            : `<div class="co-det-kpis">
                <div>Ocorrências<b>${fmtN(r.kpi.ocorrencias)}</b>antes: ${fmtN(r.antes.ocorrencias)}${varia(r.kpi.ocorrencias, r.antes.ocorrencias)}</div>
                <div>Prisões<b>${r.kpi.prisoes ?? '—'}</b>antes: ${r.antes.prisoes ?? '—'}${varia(r.kpi.prisoes, r.antes.prisoes)}</div>
                <div>Drogas apreendidas<b>${peso(r.kpi.drogasG)}</b>antes: ${peso(r.antes.drogasG)}${varia(r.kpi.drogasG, r.antes.drogasG)}</div>
                <div>Armas apreendidas<b>${fmtN(r.kpi.armas)}</b>antes: ${fmtN(r.antes.armas)}${varia(r.kpi.armas, r.antes.armas)}</div>
                <div>Materiais apreendidos<b>${fmtN(r.kpi.materiais)}</b>antes: ${fmtN(r.antes.materiais)}${varia(r.kpi.materiais, r.antes.materiais)}</div></div>
               ${comparacaoMesHTML(r, it)}
               <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:.6rem;align-items:start;">${tabTip(r, it)}${tabMini('Droga (peso)', r.drogasPorTipo, peso) || tabMini('Droga', [['Nenhuma', 0]])}${tabMini('Arma', r.armasPorTipo) || tabMini('Arma', [['Nenhuma', 0]])}${tabMini('Material', r.materiaisPorCat) || tabMini('Material', [['Nenhum', 0]])}</div>
               ${listasHTML(r)}
               <div class="co-det-meta" style="margin-top:.4rem;">Computado em ${new Date(r.calculadoEm).toLocaleString('pt-BR')}${r.parcial ? ' — PARCIAL, operação em andamento' : ''}. "Antes" = mesmo número de dias (e mesmo horário, se houver) imediatamente anterior à OPO.
               <button class="co-btn" id="co-opo-computar" style="margin-left:.4rem;">↻ Recalcular</button></div>`;
        el.innerHTML = `<div class="co-card co-det" style="--c:${COR.opo}">
            <div class="co-card-topo"><div><h3>🎯 ${esc(it.nome)}</h3><p>${descRecorte(it, A.rec)}</p></div>
            <div style="display:flex;gap:.4rem;flex-wrap:wrap;">${podeCalcular(it) ? '<button class="co-btn" id="co-opo-rel">📊 Relatório</button>' : ''}<button class="co-btn" id="co-opo-ver">📄 Ver OPO (Word / PDF)</button></div></div>${corpo}</div>`;
        document.getElementById('co-opo-ver').onclick = () => abrirDocumento(it);
        const br2 = document.getElementById('co-opo-rel');
        if (br2) br2.onclick = () => abrirRelatorioOPO(it, null);
        ligarOcorrencias(el);
        const b = document.getElementById('co-opo-computar');
        if (b) b.onclick = async () => {
            b.disabled = true; b.textContent = '⏳ Cruzando com o CAD…';
            try { await computar(it, A.rec); } catch (e) { alert('Não foi possível computar: ' + e.message); }
            renderEstatisticas(); renderGeral();
        };
    }

    function renderComparacaoEst(A) {
        const C = A.comp, el = document.getElementById('co-comp-est');
        if (!C.com) {
            el.innerHTML = `<div class="co-card-topo"><div><h3>📆 Durante a operação × mesmo período do mês anterior</h3><p>Nenhum item do filtro tem a comparação calculada — use “⚙ Computar agora” acima.</p></div></div>`;
            if (CHARTS['g-comp']) { CHARTS['g-comp'].destroy(); delete CHARTS['g-comp']; }
            return;
        }
        el.innerHTML = `<div class="co-card-topo"><div><h3>📆 Durante a operação × mesmo período do mês anterior</h3>
                <p>Mesmos dias do mês anterior ao início de cada operação/evento, no mesmo horário e nas mesmas cidades · ${C.com} de ${A.lista.length} item(ns) com comparação</p></div></div>
            <div class="co-comp-grade">
                <div class="co-graf" style="height:250px;"><canvas id="g-comp"></canvas></div>
                <table class="co-mini"><tr><th>Indicador</th><th>Durante</th><th>Mês ant.</th><th>Var.</th></tr>
                    ${[['Ocorrências', 'ocorrencias'], ['Prisões / apreensões', 'prisoes'], ['Drogas', 'drogasG', peso], ['Armas', 'armas'], ['Materiais', 'materiais']].map(([n, c, f = fmtN]) =>
                        `<tr><td>${n}</td><td><b>${f(C.dur[c])}</b></td><td>${f(C.ant[c])}</td><td>${variaTxt(C.dur[c], C.ant[c])}</td></tr>`).join('')}</table>
            </div>
            <div class="co-comp-tabs">${tabComp3('Cidade', C.porCidade)}${tabComp3('Bairro', C.porBairro, 30)}${tabComp3('Tipificação', C.porTip)}</div>`;
        grafico('g-comp', { type: 'bar', data: { labels: ['Ocorrências', 'Prisões', 'Armas', 'Materiais'], datasets: [
            { label: 'Durante a operação', data: [C.dur.ocorrencias, C.dur.prisoes, C.dur.armas, C.dur.materiais], backgroundColor: '#1f5fbf' },
            { label: 'Mesmo período do mês anterior', data: [C.ant.ocorrencias, C.ant.prisoes, C.ant.armas, C.ant.materiais], backgroundColor: '#9aa5b1' }] } });
    }

    // ── Relatório ───────────────────────────────────────────────────
    // Relatório de UMA OPO: listas detalhadas (sem nomes de pessoas).
    function listasRelatorio(it, rec) {
        const r = it ? resDe(it, rec) : null;
        if (!r || !r.listaOcorrencias) return '';
        const tab = (tit, cols, linhas) => `<section><h2>${tit} (${linhas.length})</h2><table><tr>${cols.map(c => `<th>${c[0]}</th>`).join('')}</tr>${linhas.length ? linhas.map(l => `<tr>${cols.map(c => `<td>${esc(c[1](l))}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}">Nenhum registro.</td></tr>`}</table></section>`;
        const quant = l => l.q ? `${l.q} ${(l.u || '').toLowerCase()}`.trim() : '—';
        return tab('6. Ocorrências durante a operação', [['Data', l => l.d], ['Hora', l => l.h], ['Boletim', l => l.b], ['Cidade', l => l.c], ['Endereço', l => l.e], ['Tipificação', l => l.t], ['Solução', l => l.s]], r.listaOcorrencias)
            + tab('7. Drogas apreendidas', [['Data', l => l.d], ['Boletim', l => l.b], ['Tipo', l => l.t], ['Quantidade', quant], ['Cidade', l => l.c]], r.listaDrogas || [])
            + tab('8. Armas apreendidas', [['Data', l => l.d], ['Boletim', l => l.b], ['Tipo', l => l.t], ['Marca / modelo / calibre', l => l.m], ['Situação', l => l.s]], r.listaArmas || [])
            + tab('9. Materiais apreendidos', [['Data', l => l.d], ['BOU', l => l.b], ['Categoria', l => l.t], ['Descrição', l => l.x], ['Status', l => l.s]], r.listaMateriais || [])
            + tab('10. Prisões / apreensões', [['Boletim', l => l.b], ['Situação', l => l.s], ['Tipificação', l => l.t], ['Cidade', l => l.c]], r.listaPrisoes || []);
    }
    function secaoComparacaoRel(A, img) {
        const C = A.comp;
        const v = (x, y) => variaTxt(x, y).replace(/<[^>]+>/g, '');
        if (!C.com) return '<section><h2>1.1 Comparação com o mês anterior</h2><p>Nenhum item com a comparação calculada (computar os resultados na aba Estatísticas).</p></section>';
        const t = (tit, linhas, max = 20) => `<table><caption>${tit}</caption><tr><th>${tit}</th><th>Durante</th><th>Mês anterior</th><th>Var.</th></tr>${linhas.length ? linhas.slice(0, max).map(([n, x, y]) => `<tr><td>${esc(n)}</td><td>${fmtN(x)}</td><td>${fmtN(y)}</td><td>${v(x, y)}</td></tr>`).join('') : '<tr><td colspan="4">Sem dados.</td></tr>'}</table>`;
        return `<section><h2>1.1 Comparação: durante a operação × mesmo período do mês anterior</h2>
            <p style="margin:2px 0 6px;color:#444;">Mesmos dias do mês anterior ao início de cada operação/evento, no mesmo horário e cidades (${C.com} de ${A.lista.length} item(ns) com comparação).</p>
            <div class="grid"><table><tr><th>Indicador</th><th>Durante</th><th>Mês anterior</th><th>Var.</th></tr>
                ${[['Ocorrências', 'ocorrencias'], ['Prisões / apreensões', 'prisoes'], ['Drogas apreendidas', 'drogasG', peso], ['Armas apreendidas', 'armas'], ['Materiais apreendidos', 'materiais']].map(([n, c, f = fmtN]) =>
                    `<tr><td>${n}</td><td><b>${f(C.dur[c])}</b></td><td>${f(C.ant[c])}</td><td>${v(C.dur[c], C.ant[c])}</td></tr>`).join('')}</table>${img('g-comp')}</div>
            <div class="grid">${t('Cidade', C.porCidade)}${t('Bairro', C.porBairro, 25)}</div>${t('Tipificação', C.porTip)}</section>`;
    }
    function htmlRelatorio(A) {
        const f = FILTRO, per = f.opo && A.lista[0] ? `${br(A.lista[0].ini)} a ${br(A.lista[0].fim)}` : `${f.de ? br(f.de) : 'início'} a ${f.ate ? br(f.ate) : br(new Date())}`;
        const img = id => CHARTS[id] ? `<img src="${CHARTS[id].toBase64Image()}" alt="">` : '';
        const tab = (tit, linhas, fmt) => `<table><caption>${tit}</caption><tr><th>Item</th><th>Qtd.</th></tr>${linhas.length ? linhas.slice(0, 15).map(([a, b]) => `<tr><td>${esc(a)}</td><td>${fmt ? fmt(b) : fmtN(b)}</td></tr>`).join('') : '<tr><td colspan="2">Nenhum registro</td></tr>'}</table>`;
        const opoSel = f.opo ? A.lista[0] : null;
        const recTxt = f.recorte === 'dia' ? 'Resultados: dias inteiros da vigência (sem considerar o horário)' : 'Resultados: dias e horário de vigência da operação';
        const filtrosTxt = opoSel ? `Operação: ${opoSel.nome} · ${recTxt}` : [recTxt, f.cidade ? 'Cidade: ' + f.cidade : 'Todas as cidades', f.tipo === 'opo' ? 'Somente operações' : f.tipo === 'evento' ? 'Somente eventos' : 'Operações e eventos', f.porte ? 'Eventos de ' + f.porte.toLowerCase() + ' porte' : ''].filter(Boolean).join(' · ');
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
            ${secaoComparacaoRel(A, img)}
            <section><h2>2. Evolução mensal</h2><div class="grid">${img('g-mes')}${img('g-res')}</div></section>
            <section><h2>3. Ocorrências durante as operações/eventos</h2><div class="grid">${tab('Por cidade', A.porCidade)}${tab('Por tipificação', A.porTip)}</div></section>
            <section><h2>4. Apreensões</h2><div class="grid">${tab('Drogas por tipo (peso)', A.drogas, peso)}${tab('Armas por tipo', A.armas)}${tab('Materiais por categoria', A.materiais)}${tab('Eventos por porte', Object.entries(A.porte))}</div></section>
            <section><h2>5. Operações e eventos do período</h2><table><tr><th>Data</th><th>Tipo</th><th>Nome</th><th>Cidades</th><th>Horário</th><th>Ocorr.</th><th>Prisões</th><th>Drogas</th><th>Armas</th><th>Mat.</th></tr>
                ${A.lista.map(it => { const r = resDe(it, A.rec); const k = r ? r.kpi : null; return `<tr><td>${br(it.ini)}${it.fim - it.ini ? ' a ' + br(it.fim) : ''}</td><td>${it.tipo === 'opo' ? 'OPO' : 'Evento ' + it.porte.toLowerCase()}</td><td>${esc(it.nome)}</td><td>${esc(it.cidades.join(', '))}</td><td>${horarioRecorte(it, A.rec)}</td><td>${k ? k.ocorrencias : '—'}</td><td>${k ? (k.prisoes ?? '—') : '—'}</td><td>${k ? peso(k.drogasG) : '—'}</td><td>${k ? k.armas : '—'}</td><td>${k ? k.materiais : '—'}</td></tr>`; }).join('') || '<tr><td colspan="10">Nenhum item no filtro.</td></tr>'}</table></section>
            ${listasRelatorio(opoSel, A.rec)}
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
        if (view === 'desempenho' && window.DesempenhoGuarnicoes) window.DesempenhoGuarnicoes.abrir();
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
        document.getElementById('f-recorte').value = modoPadrao;
        document.getElementById('f-opo').onchange = renderEstatisticas;
        document.getElementById('f-recorte').onchange = renderEstatisticas;
        document.getElementById('f-relatorio').onclick = () => mostrar('relatorio');
        document.getElementById('r-filtros').onclick = () => mostrar('estatisticas');
        document.getElementById('r-imprimir').onclick = imprimir;
        document.getElementById('co-btn-nova').onclick = () => abrirNovaOPO();
        document.getElementById('n-escopo').onchange = e => { document.getElementById('n-bloco-cidade').style.display = e.target.value === 'bpm' ? 'none' : ''; };
        document.getElementById('n-gerar').onclick = gerarOPOdoFormulario;
        document.getElementById('co-doc-word').onclick = baixarWordDoc;
        document.getElementById('co-doc-pdf').onclick = pdfDoc;
        document.getElementById('co-evtopo-salvar').onclick = salvarOPOEvento;
        document.getElementById('co-rel-imprimir').onclick = imprimirRelatorioOPO;
        const busca = document.getElementById('co-busca');
        busca.addEventListener('input', renderBusca);
        busca.addEventListener('focus', renderBusca);
        document.addEventListener('click', e => { if (!e.target.closest('.co-busca-wrap')) document.getElementById('co-busca-res').classList.remove('aberto'); });
        document.getElementById('co-evtopo-word').onclick = wordOPOEvento;
        document.getElementById('co-evtopo-pdf').onclick = pdfOPOEvento;
        document.querySelectorAll('[data-fechar]').forEach(b => b.addEventListener('click', () => document.getElementById(b.dataset.fechar).classList.remove('aberto')));
        ['co-nova', 'co-doc', 'co-evtopo', 'co-rel', 'co-ocor'].forEach(id => document.getElementById(id).addEventListener('click', e => { if (e.target.id === id) e.currentTarget.classList.remove('aberto'); }));
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
