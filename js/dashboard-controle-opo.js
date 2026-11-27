// ═══════════════════════════════════════════════════════════════════
// DASHBOARD CRUZADO — ABA "CONTROLE DE OPO"
// ═══════════════════════════════════════════════════════════════════
// Pedido do usuário: usar os dados da OPO SALVA (OPO Inteligente → nó
// /cartoes_programa, tipo "opo") e as ocorrências do CAD para saber o que
// aconteceu DURANTE o cumprimento da OPO — intervalo de datas, faixa de
// horário diária e cidades da OPO:
//   · quantidade de ocorrências (por tipificação + lista completa)
//   · prisões efetuadas (autores com situação PRESO/APREENDIDO nos boletins)
//   · drogas apreendidas (peso por tipo)
//   · armas apreendidas (por tipo)
//   · materiais apreendidos (por categoria — planilha de materiais, pelo BOU)
// Com comparação com o MESMO intervalo imediatamente anterior à OPO.
//
// Janela de horário: "18:00 às 02:00" vale para cada dia do intervalo; as
// horas depois da meia-noite pertencem ao turno iniciado no dia anterior.
// OPOs antigas (salvas antes do campo "execução") usam criadoEm → validoAte.
// ═══════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const ABA = 'opo';
    let OPOS = [];          // [{ id, ...registro de /cartoes_programa }]
    let ULTIMO = null;      // último resultado calculado (CSV / impressão)
    let autoresCache = null;

    const nrm = s => (s == null ? '' : String(s)).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
    const val = v => { const s = (v == null ? '' : String(v)).trim(); return (s === '---' || s === '—') ? '' : s; };
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    // Mesma leitura de QUANTIDADE do resto do dashboard (CATEGORIAS.drogas.campoPeso).
    const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isNaN(n) ? 0 : n; };
    const fmtN = (n, d = 0) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const br = d => d.toLocaleDateString('pt-BR');

    function parseData(s) {
        s = val(s).slice(0, 10);
        let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
        m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
        return null;
    }
    const minutos = h => { const m = String(h || '').match(/(\d{1,2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null; };

    async function dbUrl() { return (await P3.loadUnidadeConfig()).firebase.databaseURL; }
    async function no(nome) {
        window._NODES_CACHE = window._NODES_CACHE || {};
        if (window._NODES_CACHE[nome]) return window._NODES_CACHE[nome];
        const d = await fetch(`${await dbUrl()}/${nome}.json`).then(r => r.ok ? r.json() : null);
        return (window._NODES_CACHE[nome] = d ? Object.values(d).filter(Boolean) : []);
    }

    // ── Janela da OPO ───────────────────────────────────────────────
    // Devolve um testador (data, hora) → bool para o intervalo [ini, fim]
    // com a faixa horária diária [hIni, hFim) (vazia = dia inteiro).
    function criarJanela(ini, fim, hIni, hFim) {
        const a = minutos(hIni), b = minutos(hFim);
        const dentroDia = d => d >= ini && d <= fim;
        const ontem = d => { const x = new Date(d); x.setDate(x.getDate() - 1); return x; };
        if (a == null || b == null || a === b) return (d) => dentroDia(d);
        return (d, hora) => {
            const m = minutos(hora);
            if (m == null) return false; // sem horário não dá pra afirmar que foi no turno da OPO
            if (a < b) return dentroDia(d) && m >= a && m < b;
            // Turno atravessa a meia-noite (ex.: 18:00 → 02:00)
            return (m >= a && dentroDia(d)) || (m < b && dentroDia(ontem(d)));
        };
    }

    function cidadesDaOpo(o) {
        if (Array.isArray(o.cidades) && o.cidades.length) return o.cidades;
        const al = (o.alocacoes || []).map(a => a.cidade).filter(Boolean);
        if (al.length) return [...new Set(al)];
        return o.cidade ? [o.cidade] : [];
    }
    // Lê datas do texto livre de vigência da OPO Inteligente:
    // "15/10/2026", "15 a 18/10/2026", "15/10 a 18/10/2026", "15/10/2026 a 18/10/2026",
    // "15 e 16/10". Ano ausente → ano da referência. → { ini: Date, fim: Date } | null
    function parseVigencia(txt, ref) {
        const t = String(txt || '');
        const ano = a => !a ? (ref || new Date()).getFullYear() : (a.length === 2 ? 2000 + +a : +a);
        const ok = d => d && !isNaN(d) ? d : null;
        const lista = [];
        const m = t.match(/(?<![\d\/])(\d{1,2})\s*(?:a|à|ate|até|-|–|e)\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/i);
        if (m) lista.push(ok(new Date(ano(m[4]), +m[3] - 1, +m[1])), ok(new Date(ano(m[4]), +m[3] - 1, +m[2])));
        const datas = [...t.matchAll(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/g)];
        const anoComum = (datas.find(d => d[3]) || [])[3];
        datas.forEach(d => lista.push(ok(new Date(ano(d[3] || anoComum), +d[2] - 1, +d[1]))));
        const validas = lista.filter(Boolean).sort((a, b) => a - b);
        return validas.length ? { ini: validas[0], fim: validas[validas.length - 1] } : null;
    }

    // Período da OPO: execução informada → vigência (texto) → estimado
    // (criação → validade). fimPlanejado = fim real (pode ser futuro, p/ o
    // calendário); fim = limitado a hoje (p/ o cálculo de resultados).
    function periodoPadrao(o) {
        const ex = o.execucao || {};
        let ini = parseData(ex.dataIni), fim = parseData(ex.dataFim), fonte = 'execucao';
        if (!ini) {
            const v = parseVigencia(o.vigenciaTexto, o.criadoEm ? new Date(o.criadoEm) : new Date());
            if (v) { ini = v.ini; fim = v.fim; fonte = 'vigencia'; }
        }
        if (!ini) {
            const criado = o.criadoEm ? new Date(o.criadoEm) : new Date();
            ini = new Date(criado.getFullYear(), criado.getMonth(), criado.getDate());
            fim = o.validoAte ? new Date(o.validoAte) : new Date();
            fonte = 'estimado';
        }
        if (!fim || fim < ini) fim = new Date(ini);
        fim = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate());
        const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
        const fimCalc = fim > hoje ? (hoje < ini ? ini : hoje) : fim;
        return { ini: iso(ini), fim: iso(fimCalc), fimPlanejado: iso(fim), hIni: ex.horaIni || '', hFim: ex.horaFim || '', fonte };
    }
    const rotuloOpo = o => `${o.nome || 'OPO ' + (o.cidade || '')} — ${o.data || (o.criadoEm || '').slice(0, 10)}${o.criadoPor ? ' — ' + o.criadoPor : ''}`;

    // ── Cálculo ─────────────────────────────────────────────────────
    async function listarAutores() {
        if (autoresCache) return autoresCache;
        try {
            const cfg = await P3.loadUnidadeConfig();
            const d = await P3.Autores.listar(cfg);
            autoresCache = Object.values(d || {}).filter(Boolean);
        } catch (e) { console.warn('[controle-opo] autores indisponíveis:', e.message); autoresCache = null; }
        return autoresCache;
    }
    // No Dashboard Cruzado reaproveita o cache dele; fora dele (página
    // Controle de Operações) lê a planilha de materiais da própria unidade.
    let materiaisCache = null;
    async function carregarMateriais() {
        if (window.DashCruzadoAPI) return DashCruzadoAPI.carregar('materiais');
        if (materiaisCache) return materiaisCache;
        const url = (await P3.loadUnidadeConfig()).gas.MATERIAIS;
        if (!url) return [];
        const d = await fetch(`${url}?action=read`).then(r => r.ok ? r.json() : []);
        return (materiaisCache = Array.isArray(d) ? d : []);
    }
    const chaveBol = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const ehPrisao = sit => { const s = nrm(sit); return s.includes('PRES') || s.includes('APREENDID') || s.includes('FLAGRANTE'); };

    async function calcular(f) {
        const [geral, drogas, armas, materiais, autores] = await Promise.all([
            no('geral'), no('droga'), no('arma'),
            carregarMateriais().catch(() => []),
            listarAutores(),
        ]);
        const cidSet = new Set(f.cidades.map(nrm));
        const daCidade = it => !cidSet.size || cidSet.has(nrm(it.CIDADE));

        const janelaOPO = criarJanela(f.ini, f.fim, f.hIni, f.hFim);
        const dias = Math.round((f.fim - f.ini) / 86400000) + 1;
        const antIni = new Date(f.ini); antIni.setDate(antIni.getDate() - dias);
        const antFim = new Date(f.ini); antFim.setDate(antFim.getDate() - 1);
        const janelaAnt = criarJanela(antIni, antFim, f.hIni, f.hFim);

        const recorte = janela => {
            const noTurno = it => { const d = parseData(it.DATA); return d && daCidade(it) && janela(d, it.HORA); };
            const ocs = geral.filter(noTurno);
            const bols = new Set(ocs.map(o => chaveBol(o.BOLETIM || o['Nº Ocorrência'])));
            const drg = drogas.filter(noTurno);
            const arm = armas.filter(noTurno);
            // Materiais não têm hora/cidade próprias: entram pelo Nº do BOU das ocorrências do turno.
            const mat = materiais.filter(m => bols.has(chaveBol(m['N° DO BOU'])));
            const pres = autores ? autores.filter(a => bols.has(chaveBol(a.BOLETIM)) && ehPrisao(a.SITUACAO)) : null;
            return { ocs, bols, drg, arm, mat, pres };
        };
        const A = recorte(janelaOPO), B = recorte(janelaAnt);
        // Comparação com o MÊS ANTERIOR à vigência: mesmos dias do mês anterior
        // (dia limitado ao último dia do mês), mesmo horário e mesmas cidades.
        const mesAnt = d => { const x = new Date(d.getFullYear(), d.getMonth() - 1, 1); x.setDate(Math.min(d.getDate(), new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate())); return x; };
        const mIni = mesAnt(f.ini), mFim = mesAnt(f.fim);
        const C = recorte(criarJanela(mIni, mFim, f.hIni, f.hFim));
        // [[chave, na OPO, no mês anterior]] — ordenado pelo período da OPO
        const comparar = (a, c, fn) => {
            const m = new Map();
            const add = (x, i) => { const k = (fn(x) || 'Não informado').toUpperCase(); const v = m.get(k) || [0, 0]; v[i]++; m.set(k, v); };
            a.forEach(x => add(x, 0)); c.forEach(x => add(x, 1));
            return [...m.entries()].map(([k, [x, y]]) => [k, x, y]).sort((p, q) => q[1] - p[1] || q[2] - p[2]);
        };

        const agrupar = (lista, chave, soma) => {
            const m = {};
            lista.forEach(it => { const k = chave(it) || 'Não informado'; m[k] = (m[k] || 0) + (soma ? soma(it) : 1); });
            return Object.entries(m).sort((a, b) => b[1] - a[1]);
        };
        // Peso de drogas em gramas (QUILOGRAMA → ×1000); "unidades" ficam à parte.
        const gramas = d => { const u = nrm(d.UNIDADE_MEDIDA); const q = num(d.QUANTIDADE || d.PESO); return u.includes('QUILO') || u === 'KG' ? q * 1000 : (u.includes('UNIDADE') ? 0 : q); };
        const unidades = d => nrm(d.UNIDADE_MEDIDA).includes('UNIDADE') ? num(d.QUANTIDADE) : 0;
        const pesoTotal = l => l.reduce((s, d) => s + gramas(d), 0);
        const qtdMaterial = m => Math.max(1, num(m.QUANTIDADE) || 1);

        return {
            f, dias, antIni, antFim, temAutores: !!autores, mesIni: mIni, mesFim: mFim,
            porCidadeComp: comparar(A.ocs, C.ocs, o => val(o.CIDADE)),
            porBairroComp: comparar(A.ocs, C.ocs, o => val(o.BAIRRO)),
            porTipComp: comparar(A.ocs, C.ocs, o => val(o.TIPIFICACAO_GERAL) || val(o.TIPIFICACAO)),
            ocorrencias: A.ocs.slice().sort((a, b) => (parseData(a.DATA) - parseData(b.DATA)) || String(a.HORA).localeCompare(String(b.HORA))),
            porTip: agrupar(A.ocs, o => val(o.TIPIFICACAO_GERAL) || val(o.TIPIFICACAO)),
            porCidade: agrupar(A.ocs, o => val(o.CIDADE)),
            drogas: A.drg, drogasPorTipo: agrupar(A.drg, d => val(d.TIPO_DROGA), gramas), drogasUnid: agrupar(A.drg.filter(unidades), d => val(d.TIPO_DROGA), unidades),
            armas: A.arm, armasPorTipo: agrupar(A.arm, a => val(a.TIPO_ARMA)),
            materiais: A.mat, materiaisPorCat: agrupar(A.mat, m => val(m.CATEGORIA), qtdMaterial),
            prisoes: A.pres || [], prisoesPorSit: agrupar(A.pres || [], p => val(p.SITUACAO)),
            kpi: {
                // [na OPO, período imediatamente anterior, mesmos dias do mês anterior]
                ocorrencias: [A.ocs.length, B.ocs.length, C.ocs.length],
                prisoes: [A.pres ? A.pres.length : null, B.pres ? B.pres.length : null, C.pres ? C.pres.length : null],
                drogas: [pesoTotal(A.drg), pesoTotal(B.drg), pesoTotal(C.drg)],
                armas: [A.arm.length, B.arm.length, C.arm.length],
                materiais: [A.mat.reduce((s, m) => s + qtdMaterial(m), 0), B.mat.reduce((s, m) => s + qtdMaterial(m), 0), C.mat.reduce((s, m) => s + qtdMaterial(m), 0)],
            },
        };
    }

    // ── Render ──────────────────────────────────────────────────────
    const peso = g => g >= 1000 ? fmtN(g / 1000, 3) + ' kg' : fmtN(g, g % 1 ? 3 : 0) + ' g';
    function variacao(atual, ant) {
        if (atual == null || ant == null) return '';
        if (!ant) return atual ? '<span class="co-var up">novo</span>' : '<span class="co-var">=</span>';
        const p = (atual - ant) / ant * 100;
        return `<span class="co-var ${p > 0 ? 'up' : p < 0 ? 'down' : ''}">${p > 0 ? '▲' : p < 0 ? '▼' : '='} ${fmtN(Math.abs(p), 0)}%</span>`;
    }
    const tabela = (titulo, linhas, rotuloValor, fmtValor) => `
        <div class="co-card"><div class="co-card-tit">${titulo}</div>
        ${linhas.length ? `<table class="co-tab"><thead><tr><th>Tipo</th><th style="text-align:right;">${rotuloValor}</th></tr></thead><tbody>
            ${linhas.map(([k, v]) => `<tr><td>${esc(k)}</td><td style="text-align:right;">${fmtValor ? fmtValor(v) : fmtN(v)}</td></tr>`).join('')}</tbody></table>`
            : '<div class="co-vazio">Nenhum registro no período.</div>'}</div>`;

    function render(R) {
        const out = document.getElementById('co-resultado');
        const k = R.kpi;
        const faixa = R.f.hIni && R.f.hFim && R.f.hIni !== R.f.hFim ? `${R.f.hIni} às ${R.f.hFim}` : 'dia inteiro';
        const kpi = (ic, rot, v, ant, fmt) => `<div class="co-kpi"><div class="co-kpi-ic">${ic}</div><div>
            <div class="co-kpi-rot">${rot}</div><div class="co-kpi-val">${v == null ? '—' : (fmt ? fmt(v) : fmtN(v))}</div>
            <div class="co-kpi-ant">antes: ${ant == null ? '—' : (fmt ? fmt(ant) : fmtN(ant))} ${variacao(v, ant)}</div></div></div>`;
        out.innerHTML = `
            <div class="co-resumo">📅 ${br(R.f.ini)} a ${br(R.f.fim)} (${R.dias} dia${R.dias > 1 ? 's' : ''}) · ⏰ ${faixa} · 📍 ${R.f.cidades.length ? esc(R.f.cidades.join(', ')) : 'todas as cidades'}
                <br><small>Comparação ("antes"): mesmo intervalo e horário imediatamente anterior — ${br(R.antIni)} a ${br(R.antFim)}.</small></div>
            <div class="co-kpis">
                ${kpi('🚨', 'Ocorrências', k.ocorrencias[0], k.ocorrencias[1])}
                ${kpi('🔒', 'Prisões / apreensões', k.prisoes[0], k.prisoes[1])}
                ${kpi('💊', 'Drogas apreendidas', k.drogas[0], k.drogas[1], peso)}
                ${kpi('🔫', 'Armas apreendidas', k.armas[0], k.armas[1])}
                ${kpi('📦', 'Materiais apreendidos', k.materiais[0], k.materiais[1])}
            </div>
            ${R.temAutores ? '' : '<div class="co-aviso">⚠️ Não foi possível consultar a base de autores — prisões indisponíveis.</div>'}
            <div class="co-grid">
                ${tabela('🚨 Ocorrências por tipificação', R.porTip, 'Qtd.')}
                ${tabela('📍 Ocorrências por cidade', R.porCidade, 'Qtd.')}
                ${tabela('💊 Drogas por tipo (peso)', R.drogasPorTipo, 'Peso', peso)}
                ${R.drogasUnid.length ? tabela('💊 Drogas em unidades', R.drogasUnid, 'Unid.') : ''}
                ${tabela('🔫 Armas por tipo', R.armasPorTipo, 'Qtd.')}
                ${tabela('📦 Materiais por categoria', R.materiaisPorCat, 'Qtd.')}
                ${tabela('🔒 Prisões por situação', R.prisoesPorSit, 'Qtd.')}
            </div>
            ${R.prisoes.length ? `<div class="co-card"><div class="co-card-tit">🔒 Prisões efetuadas (${R.prisoes.length})</div>
                <div class="co-scroll"><table class="co-tab"><thead><tr><th>Boletim</th><th>Nome</th><th>Situação</th><th>Tipificação</th><th>Cidade</th></tr></thead><tbody>
                ${R.prisoes.map(p => `<tr><td>${esc(p.BOLETIM)}</td><td>${esc(val(p.NOME))}</td><td>${esc(val(p.SITUACAO))}</td><td>${esc(val(p.TIPIFICACAO))}</td><td>${esc(val(p.CIDADE))}</td></tr>`).join('')}
                </tbody></table></div></div>` : ''}
            ${R.armas.length ? `<div class="co-card"><div class="co-card-tit">🔫 Armas apreendidas (${R.armas.length})</div>
                <div class="co-scroll"><table class="co-tab"><thead><tr><th>Data</th><th>Boletim</th><th>Tipo</th><th>Marca / calibre</th><th>Situação</th><th>Cidade</th></tr></thead><tbody>
                ${R.armas.map(a => `<tr><td>${esc(a.DATA)} ${esc(val(a.HORA))}</td><td>${esc(a.BOLETIM)}</td><td>${esc(val(a.TIPO_ARMA))}</td><td>${esc([val(a.MARCA), val(a.CALIBRE)].filter(Boolean).join(' · '))}</td><td>${esc(val(a.SITUACAO_ARMA))}</td><td>${esc(val(a.CIDADE))}</td></tr>`).join('')}
                </tbody></table></div></div>` : ''}
            ${R.materiais.length ? `<div class="co-card"><div class="co-card-tit">📦 Materiais apreendidos (${R.materiais.length})</div>
                <div class="co-scroll"><table class="co-tab"><thead><tr><th>Data</th><th>BOU</th><th>Categoria</th><th>Descrição</th><th>Status</th></tr></thead><tbody>
                ${R.materiais.map(m => `<tr><td>${esc(val(m.DATA))}</td><td>${esc(val(m['N° DO BOU']))}</td><td>${esc(val(m.CATEGORIA))}</td><td>${esc(val(m['DESCRIÇÃO']))}</td><td>${esc(val(m.STATUS))}</td></tr>`).join('')}
                </tbody></table></div></div>` : ''}
            <div class="co-card"><div class="co-card-tit">📋 Ocorrências durante a OPO (${R.ocorrencias.length})</div>
                ${R.ocorrencias.length ? `<div class="co-scroll co-scroll-alto"><table class="co-tab"><thead><tr><th>Data</th><th>Hora</th><th>Boletim</th><th>Cidade</th><th>Endereço</th><th>Tipificação</th><th>Solução</th></tr></thead><tbody>
                ${R.ocorrencias.map(o => `<tr><td>${esc(o.DATA)}</td><td>${esc(val(o.HORA))}</td><td>${esc(val(o.BOLETIM))}</td><td>${esc(val(o.CIDADE))}</td>
                    <td>${esc([val(o.LOGRADOURO), val(o.BAIRRO)].filter(Boolean).join(', '))}</td><td>${esc(val(o.TIPIFICACAO_GERAL) || val(o.TIPIFICACAO))}</td><td>${esc(val(o['SOLUÇÃO']))}</td></tr>`).join('')}
                </tbody></table></div>` : '<div class="co-vazio">Nenhuma ocorrência no intervalo, horário e cidades da OPO.</div>'}</div>`;
        document.getElementById('co-csv').disabled = false;
        document.getElementById('co-imprimir').disabled = false;
    }

    // ── Exportações ─────────────────────────────────────────────────
    function exportarCSV() {
        if (!ULTIMO) return;
        const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
        const linhas = [['Data', 'Hora', 'Boletim', 'Cidade', 'Bairro', 'Logradouro', 'Tipificação', 'Solução'].map(q).join(';')];
        ULTIMO.ocorrencias.forEach(o => linhas.push([o.DATA, val(o.HORA), val(o.BOLETIM), val(o.CIDADE), val(o.BAIRRO), val(o.LOGRADOURO), val(o.TIPIFICACAO_GERAL) || val(o.TIPIFICACAO), val(o['SOLUÇÃO'])].map(q).join(';')));
        const blob = new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = `controle_opo_${iso(ULTIMO.f.ini)}_${iso(ULTIMO.f.fim)}.csv`; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }

    // Relatório para imprimir/salvar em PDF. Sem nomes de presos: no .exe o
    // conteúdo passa por um nó temporário do Firebase (P3AbrirConteudoNoNavegador).
    function imprimir() {
        if (!ULTIMO) return;
        const R = ULTIMO, k = R.kpi;
        const faixa = R.f.hIni && R.f.hFim && R.f.hIni !== R.f.hFim ? `${R.f.hIni} às ${R.f.hFim}` : 'dia inteiro';
        const tab = (tit, linhas, fmt) => `<table><caption>${tit}</caption><tr><th>Tipo</th><th>Qtd.</th></tr>${linhas.length ? linhas.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${fmt ? fmt(b) : fmtN(b)}</td></tr>`).join('') : '<tr><td colspan="2">Nenhum registro</td></tr>'}</table>`;
        const html = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><title>Controle de OPO</title><style>
            body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:12mm;font-size:10pt}
            h1{font-size:14pt;margin:0 0 2px;color:#0b2545;text-transform:uppercase}.sub{color:#444;margin-bottom:10px}
            .kpis{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.kpi{border:1px solid #bbb;border-radius:6px;padding:6px 10px;min-width:120px}
            .kpi b{display:block;font-size:15pt;color:#0b2545}.kpi span{font-size:8pt;text-transform:uppercase;color:#555}
            .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:start}
            table{border-collapse:collapse;width:100%;margin:6px 0;font-size:8.5pt}caption{text-align:left;font-weight:bold;margin-bottom:2px}
            th,td{border:1px solid #bbb;padding:3px 5px;text-align:left;vertical-align:top}th{background:#e8eef7}
        </style></head><body>
            <h1>Controle de OPO — ${esc(R.f.nome)}</h1>
            <div class="sub">Polícia Militar de Alagoas — 10º BPM · ${br(R.f.ini)} a ${br(R.f.fim)} · ${faixa} · ${esc(R.f.cidades.join(', ') || 'todas as cidades')} · Gerado em ${new Date().toLocaleString('pt-BR')}</div>
            <div class="kpis">
                <div class="kpi"><span>Ocorrências</span><b>${fmtN(k.ocorrencias[0])}</b>antes: ${fmtN(k.ocorrencias[1])}</div>
                <div class="kpi"><span>Prisões / apreensões</span><b>${k.prisoes[0] == null ? '—' : fmtN(k.prisoes[0])}</b>antes: ${k.prisoes[1] == null ? '—' : fmtN(k.prisoes[1])}</div>
                <div class="kpi"><span>Drogas</span><b>${peso(k.drogas[0])}</b>antes: ${peso(k.drogas[1])}</div>
                <div class="kpi"><span>Armas</span><b>${fmtN(k.armas[0])}</b>antes: ${fmtN(k.armas[1])}</div>
                <div class="kpi"><span>Materiais</span><b>${fmtN(k.materiais[0])}</b>antes: ${fmtN(k.materiais[1])}</div>
            </div>
            <div class="grid">${tab('Ocorrências por tipificação', R.porTip)}${tab('Ocorrências por cidade', R.porCidade)}
                ${tab('Drogas por tipo (peso)', R.drogasPorTipo, peso)}${tab('Armas por tipo', R.armasPorTipo)}
                ${tab('Materiais por categoria', R.materiaisPorCat)}${tab('Prisões por situação', R.prisoesPorSit)}</div>
            <table><caption>Ocorrências durante a OPO (${R.ocorrencias.length})</caption><tr><th>Data</th><th>Hora</th><th>Boletim</th><th>Cidade</th><th>Endereço</th><th>Tipificação</th><th>Solução</th></tr>
            ${R.ocorrencias.map(o => `<tr><td>${esc(o.DATA)}</td><td>${esc(val(o.HORA))}</td><td>${esc(val(o.BOLETIM))}</td><td>${esc(val(o.CIDADE))}</td><td>${esc([val(o.LOGRADOURO), val(o.BAIRRO)].filter(Boolean).join(', '))}</td><td>${esc(val(o.TIPIFICACAO_GERAL) || val(o.TIPIFICACAO))}</td><td>${esc(val(o['SOLUÇÃO']))}</td></tr>`).join('')}</table>
            <p style="font-size:8pt;color:#555;">"Antes" = mesmo intervalo e horário imediatamente anterior (${br(R.antIni)} a ${br(R.antFim)}). Fonte: CAD/SISP (ocorrências, drogas, armas, autores) e planilha de materiais apreendidos.</p>
            <script>window.onload=function(){setTimeout(function(){window.print();},400);};<\/script></body></html>`;
        if (window.P3EmAppDesktop && P3EmAppDesktop() && window.P3AbrirConteudoNoNavegador) {
            P3AbrirConteudoNoNavegador({ tipo: 'impressao', html }).catch(e => alert('Não foi possível abrir a impressão: ' + e.message));
            return;
        }
        const w = window.open('', '_blank');
        if (!w) { alert('O navegador bloqueou a janela de impressão. Libere pop-ups para este site.'); return; }
        w.document.open(); w.document.write(html); w.document.close();
    }

    // ── Estrutura da aba ────────────────────────────────────────────
    function injetarCSS() {
        if (document.getElementById('co-css')) return;
        const st = document.createElement('style'); st.id = 'co-css';
        st.textContent = `
        .co-wrap{display:flex;flex-direction:column;gap:1rem}
        .co-barra{background:var(--p3-surface);border:1.5px solid var(--p3-border);border-radius:8px;padding:.8rem 1rem;display:flex;flex-direction:column;gap:.6rem;color:var(--p3-text)}
        .co-linha{display:flex;flex-wrap:wrap;gap:.6rem 1rem;align-items:center;font-size:.82rem}
        .co-linha select,.co-linha input{background:var(--p3-surface);color:var(--p3-text);margin-left:4px;padding:5px 8px;border:1.5px solid var(--p3-border);border-radius:6px;font-size:.82rem}
        .co-linha select#co-opo{min-width:320px;max-width:100%}
        .co-cidades{display:flex;flex-wrap:wrap;gap:4px}
        .co-cidades label{font-size:.75rem;border:1px solid var(--p3-border);border-radius:12px;padding:2px 8px;cursor:pointer}
        .co-cidades label:has(input:checked){background:rgba(47,95,221,.15);border-color:#2f5fdd}
        .co-btn{padding:7px 14px;border:1.5px solid var(--p3-border);border-radius:7px;background:var(--p3-surface);color:var(--p3-text);font-weight:bold;font-size:.8rem;cursor:pointer}
        .co-btn:disabled{opacity:.5;cursor:default}.co-btn-pri{background:#0b2545;border-color:#0b2545;color:#fff}
        .co-resumo{font-size:.85rem;color:var(--p3-text)}.co-resumo small{color:var(--p3-text-muted)}
        .co-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.75rem}
        .co-kpi{background:var(--p3-surface);border:1px solid var(--p3-border);border-radius:10px;padding:.8rem 1rem;display:flex;gap:.7rem;align-items:center;box-shadow:var(--p3-shadow-sm)}
        .co-kpi-ic{font-size:1.6rem}.co-kpi-rot{font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:var(--p3-text-muted)}
        .co-kpi-val{font-size:1.45rem;font-weight:bold;color:var(--p3-text)}.co-kpi-ant{font-size:.72rem;color:var(--p3-text-muted)}
        .co-var{font-weight:bold;margin-left:4px}.co-var.up{color:#c62828}.co-var.down{color:#2e7d32}
        .co-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:.75rem}
        .co-card{background:var(--p3-surface);border:1px solid var(--p3-border);border-radius:10px;padding:.9rem 1rem;min-width:0}
        .co-card-tit{font-weight:bold;font-size:.85rem;margin-bottom:.5rem;color:var(--p3-text)}
        .co-tab{width:100%;border-collapse:collapse;font-size:.76rem}
        .co-tab th{background:rgba(11,37,69,.08);text-align:left;padding:6px 8px;border-bottom:2px solid var(--p3-border);color:var(--p3-text);position:sticky;top:0}
        .co-tab td{padding:5px 8px;border-bottom:1px solid var(--p3-border);color:var(--p3-text);vertical-align:top}
        .co-scroll{max-height:320px;overflow:auto}.co-scroll-alto{max-height:520px}
        .co-vazio{font-size:.8rem;color:var(--p3-text-muted);padding:.4rem 0}
        .co-aviso{font-size:.8rem;background:#fff3e0;color:#8a4b00;border:1px solid #ffcc80;border-radius:8px;padding:.5rem .8rem}
        .co-status{font-size:.78rem;color:var(--p3-text-muted)}`;
        document.head.appendChild(st);
    }

    function montar(cont) {
        injetarCSS();
        cont.innerHTML = `<div class="co-wrap">
            <div class="co-barra">
                <div class="co-linha"><label>OPO salva: <select id="co-opo"><option value="">Carregando…</option></select></label>
                    <span class="co-status" id="co-status"></span></div>
                <div class="co-linha">
                    <label>De <input type="date" id="co-ini"></label><label>até <input type="date" id="co-fim"></label>
                    <label>Horário <input type="time" id="co-hini"></label><label>às <input type="time" id="co-hfim"></label>
                    <small style="color:var(--p3-text-muted)">(horário vazio = dia inteiro)</small>
                </div>
                <div class="co-linha"><span>Cidades:</span><div class="co-cidades" id="co-cidades"></div></div>
                <div class="co-linha">
                    <button class="co-btn co-btn-pri" id="co-calc">📊 Calcular controle da OPO</button>
                    <button class="co-btn" id="co-csv" disabled>⬇ Ocorrências (CSV)</button>
                    <button class="co-btn" id="co-imprimir" disabled>🖨 Imprimir / PDF</button>
                </div>
            </div>
            <div id="co-resultado"><div class="co-vazio">Selecione uma OPO salva (OPO Inteligente → “💾 Salvar OPO”) e clique em calcular.</div></div>
        </div>`;
        document.getElementById('co-opo').addEventListener('change', aoEscolherOpo);
        document.getElementById('co-calc').addEventListener('click', executar);
        document.getElementById('co-csv').addEventListener('click', exportarCSV);
        document.getElementById('co-imprimir').addEventListener('click', imprimir);
        cont.dataset.montado = '1';
    }

    async function carregarOpos() {
        const d = await fetch(`${await dbUrl()}/cartoes_programa.json`).then(r => r.ok ? r.json() : null);
        OPOS = Object.entries(d || {}).map(([id, o]) => Object.assign({ id }, o))
            .filter(o => o && o.tipo === 'opo')
            .sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')));
        const sel = document.getElementById('co-opo');
        sel.innerHTML = OPOS.length ? OPOS.map(o => `<option value="${esc(o.id)}">${esc(rotuloOpo(o))}</option>`).join('')
            : '<option value="">Nenhuma OPO salva</option>';
        if (OPOS.length) aoEscolherOpo();
    }

    async function aoEscolherOpo() {
        const o = OPOS.find(x => x.id === document.getElementById('co-opo').value);
        if (!o) return;
        const p = periodoPadrao(o);
        document.getElementById('co-ini').value = p.ini;
        document.getElementById('co-fim').value = p.fim;
        document.getElementById('co-hini').value = p.hIni;
        document.getElementById('co-hfim').value = p.hFim;
        const daOpo = cidadesDaOpo(o).map(nrm);
        // Todas as cidades que aparecem no CAD + as da OPO; marcadas = as da OPO.
        const geral = await no('geral');
        const nomes = new Map();
        geral.forEach(g => { const c = val(g.CIDADE); if (c && !nomes.has(nrm(c))) nomes.set(nrm(c), c); });
        cidadesDaOpo(o).forEach(c => { if (!nomes.has(nrm(c))) nomes.set(nrm(c), c); });
        const todas = [...nomes.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
        const bpm = o.escopo === 'bpm' && !daOpo.length;
        document.getElementById('co-cidades').innerHTML = todas.map(([k, c]) =>
            `<label><input type="checkbox" value="${esc(c)}"${bpm || daOpo.includes(k) ? ' checked' : ''}> ${esc(c)}</label>`).join('');
        const ex = p.fonte === 'estimado' ? ' · período estimado (OPO salva sem datas de execução nem vigência: criação → validade)' : p.fonte === 'vigencia' ? ' · período lido da vigência' : '';
        document.getElementById('co-status').textContent = `${(o.tiposCombate || []).length ? 'Combate: ' + o.tiposCombate.join(', ') : ''}${ex}`;
    }

    async function executar() {
        const btn = document.getElementById('co-calc');
        const o = OPOS.find(x => x.id === document.getElementById('co-opo').value);
        const ini = parseData(document.getElementById('co-ini').value), fim = parseData(document.getElementById('co-fim').value);
        if (!ini || !fim || fim < ini) { alert('Informe um intervalo de datas válido.'); return; }
        const f = {
            nome: o ? (o.nome || 'OPO ' + (o.cidade || '')) : 'OPO', ini, fim,
            hIni: document.getElementById('co-hini').value, hFim: document.getElementById('co-hfim').value,
            cidades: [...document.querySelectorAll('#co-cidades input:checked')].map(i => i.value),
        };
        btn.disabled = true; btn.textContent = '⏳ Cruzando ocorrências, drogas, armas, materiais e autores…';
        try {
            ULTIMO = await calcular(f);
            render(ULTIMO);
        } catch (e) {
            console.error('[controle-opo]', e);
            document.getElementById('co-resultado').innerHTML = `<div class="co-aviso">Não foi possível calcular: ${esc(e.message)}</div>`;
        } finally { btn.disabled = false; btn.textContent = '📊 Calcular controle da OPO'; }
    }

    window.renderControleOPO = async function () {
        const cont = document.getElementById('conteudo-' + ABA);
        if (!cont || cont.dataset.montado) return;
        montar(cont);
        try { await carregarOpos(); } catch (e) {
            document.getElementById('co-status').textContent = 'Erro ao carregar as OPOs salvas: ' + e.message;
        }
    };
    // Reaproveitado pela página Controle de Operações (js/controle-operacoes.js).
    window.ControleOPO = { criarJanela, periodoPadrao, parseVigencia, cidadesDaOpo, calcular, rotuloOpo, carregarNo: no };
})();
