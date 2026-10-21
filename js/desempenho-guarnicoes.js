// ═══════════════════════════════════════════════════════════════════
// CONTROLE DE OPERAÇÕES — DESEMPENHO POR GUARNIÇÃO E POR GRUPO
// ═══════════════════════════════════════════════════════════════════
// Pedido do usuário: dashboard de desempenho por guarnição e por grupo,
// com as ocorrências do CAD da base da unidade, cruzadas com a ESCALA de
// serviço (turno de 24h, 08h → 08h do dia seguinte, grupos A/B/C/D), com
// filtros de período, grupo, guarnição, tipificação e tipo, e
// AUTOFILTRAGEM POR CLIQUE (como Power BI / Dashboard Cruzado): clicar numa
// barra/fatia/célula filtra todos os outros gráficos; cada gráfico é
// calculado com os filtros dos DEMAIS e destaca o item escolhido.
//
// FONTES (Firebase da unidade):
//   /geral ............ ocorrências do CAD (base de tudo)
//   /guarnicao ........ equipe (NOME_EQUIPE) por boletim (TCO) — só o nome da guarnição
//   /arma, /droga ..... apreensões por boletim
//   /escala_servico ... escala do mês (importada do PDF da P1) → grupo de cada
//                       dia e guarnições do turno (sem nomes de policiais)
//   /rp_viatura_map ... cidade → RP (atribuição "pela área")
//   autores (P3.Autores) — prisões (situação PRESO/APREENDIDO) por boletim
//
// ATRIBUIÇÃO DA GUARNIÇÃO (na ordem; a fonte fica registrada e filtrável):
//   1. CAD/TCO ........ equipe registrada no boletim (/guarnicao)
//   2. Solicitante .... a própria guarnição abriu a ocorrência (= iniciativa própria)
//   3. Relato ......... guarnição citada no texto do despachante
//   4. Área ........... RP responsável pela cidade (estimativa)
// GRUPO: dia do TURNO (antes das 08h conta para o turno do dia anterior) no
// ciclo A-B-C-D da escala (ex.: 01/10/2026 = B), estendido para outros meses.
// ═══════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const GRUPOS = ['A', 'B', 'C', 'D'];
    const COR_GRUPO = { A: '#1f77b4', B: '#e67e22', C: '#2ca02c', D: '#9467bd' };
    const TIPOS = [['MVI', 'MVI'], ['CVLI', 'CVLI'], ['CVP', 'CVP'], ['VD', 'Violência doméstica'], ['ARMA', 'Arma'], ['DROGA', 'Droga'],
        ['MANDADO', 'Mandados'], ['PERTURBACAO', 'Perturbação do sossego'], ['TCO', 'TCO']];
    const NOME_TIPO = Object.fromEntries(TIPOS);
    const FONTES = { cad: 'CAD (equipe do boletim)', solicitante: 'Solicitante = guarnição', texto: 'Relato do despachante', area: 'Pela área (estimado)' };
    const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

    let DB = null, REG = null, ESCALAS = {}, ANCORA = null, INICIO_TURNO = 8 * 60;
    const CROSS = {};            // filtros por clique { dim: valor }
    const CH = {};               // instâncias Chart.js
    let carregando = null;

    const NORM = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
    const val = v => { const s = (v == null ? '' : String(v)).trim(); return s && s !== '---' ? s : ''; };
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const fmt = (n, d = 0) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
    const peso = g => g >= 1000 ? fmt(g / 1000, 3) + ' kg' : fmt(g, g % 1 ? 1 : 0) + ' g';
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const $ = id => document.getElementById(id);
    function parseData(s) {
        s = val(s);
        let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
        m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
        return null;
    }
    const minutos = h => { const m = String(h || '').match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };

    // ── Guarnição: nomes do CAD → siglas da escala ──────────────────
    let CIDADE_RP = {};
    function sigla(texto) {
        const s = NORM(texto);
        if (!s) return null;
        let m;
        if ((m = s.match(/\bRP\s*0?(\d{1,2})\b/))) return 'RP ' + m[1].padStart(2, '0');
        if (/PELOPES/.test(s)) return 'PELOPES 01';
        if ((m = s.match(/\b(?:TATICO\s*)?RURAL\s*0?(\d)\b/))) return 'TÁTICO RURAL ' + m[1].padStart(2, '0');
        if ((m = s.match(/\bTATICO(?:\s*URBANO)?(?:\s*0?(\d))?\b/))) return !m[1] || m[1] === '1' ? 'PELOPES 01' : 'TÁTICO URBANO ' + m[1].padStart(2, '0');
        if ((m = s.match(/\bFT\s*0?(\d{1,2})\b|\bFORCA TAREFA\s*0?(\d{1,2})\b/))) return 'FORÇA TAREFA ' + (m[1] || m[2]).padStart(2, '0');
        for (const [cid, rp] of Object.entries(CIDADE_RP)) if (s.includes(cid) && /\b(RP|CISP|PATRULHA)\b/.test(s)) return rp;
        return null;
    }
    const RX_EQUIPE = /\b(RP\s*0?\d{1,2}|PELOPES(?:\s*0?\d)?|T[AÁ]TICO\s*(?:RURAL|URBANO)?\s*0?\d?|RURAL\s*0?\d|FT\s*0?\d{1,2}|FOR[CÇ]A\s*TAREFA\s*0?\d{1,2}|CISP\s+[A-ZÀ-Ú]+|RP\s+[A-ZÀ-Ú]{4,}(?:\s+D[AEO]S?\s+[A-ZÀ-Ú]+)?)\b/i;
    const equipeNoTexto = t => { const m = String(t || '').match(RX_EQUIPE); return m ? sigla(m[1]) : null; };

    // ── Grupo / turno ───────────────────────────────────────────────
    // Ciclo contínuo A-B-C-D ancorado no dia 1 do mês de escala mais recente.
    function montarAncora() {
        const meses = Object.keys(ESCALAS).sort();
        const ult = meses[meses.length - 1];
        const e = ult && ESCALAS[ult];
        if (e && e.diaGrupo && e.diaGrupo['1']) {
            const [a, m] = ult.split('-').map(Number);
            ANCORA = { data: new Date(a, m - 1, 1), idx: GRUPOS.indexOf(e.diaGrupo['1']) };
            INICIO_TURNO = minutos((e.turno && e.turno.inicio) || '08:00') ?? 480;
        } else ANCORA = { data: new Date(2026, 9, 1), idx: 1 }; // 01/10/2026 = B (escala de outubro/2026)
    }
    const diasEntre = (a, b) => Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 864e5);
    const grupoDoDia = d => GRUPOS[(((ANCORA.idx + diasEntre(ANCORA.data, d)) % 4) + 4) % 4];
    function diaDoTurno(d, hora) {
        const m = minutos(hora);
        if (m != null && m < INICIO_TURNO) { const x = new Date(d); x.setDate(x.getDate() - 1); return x; }
        return d;
    }
    // Siglas das guarnições do turno de 24h (escala mais recente) — aparecem
    // em matriz/ranking mesmo sem ocorrência no período.
    function guarnicoesEscala() {
        const meses = Object.keys(ESCALAS).sort();
        const e = meses.length ? ESCALAS[meses[meses.length - 1]] : null;
        return e ? (e.guarnicoes || []).map(g => ({ sigla: g.sigla, area: g.area || '' })) : [];
    }

    // ── Carga e montagem dos registros ──────────────────────────────
    const gramas = d => { const u = NORM(d.UNIDADE_MEDIDA); const q = parseFloat(String(d.QUANTIDADE || d.PESO || '0').replace(',', '.')) || 0; return /QUILO|^KG/.test(u) ? q * 1000 : /UNIDADE/.test(u) ? 0 : q; };
    const tipGeral = o => NORM(`${o.TIPIFICACAO_GERAL || ''} ${o.TIPIFICACAO || ''}`);
    function tiposDe(o, extra) {
        const t = tipGeral(o), s = [];
        const letal = /HOMICIDIO|FEMINICIDIO|LATROCINIO/.test(t);
        if (letal && (!/TENTATIVA/.test(t) || NORM(o.OBITO) === 'S')) s.push('MVI');
        if (letal || /LESAO CORPORAL SEGUIDA DE MORTE/.test(t)) s.push('CVLI');
        if (/ROUBO|EXTORS/.test(t)) s.push('CVP');
        if (/MARIA DA PENHA|VIOLENCIA DOMESTICA|VIOLENCIA CONTRA A MULHER/.test(t)) s.push('VD');
        if (extra.armas || /ARMA DE FOGO|ESTATUTO DO DESARMAMENTO/.test(t)) s.push('ARMA');
        if (extra.drogas || /ENTORPECENTE|DROGA|TRAFICO/.test(t)) s.push('DROGA');
        if (/MANDADO/.test(t)) s.push('MANDADO');
        if (/PERTURBACAO/.test(t)) s.push('PERTURBACAO');
        if (extra.tco || /TCO/.test(NORM(o['SOLUÇÃO']))) s.push('TCO');
        return s;
    }
    async function noJson(nome) {
        window._NODES_CACHE = window._NODES_CACHE || {};
        if (window._NODES_CACHE[nome]) return window._NODES_CACHE[nome];
        const d = await fetch(`${DB}/${nome}.json`).then(r => r.ok ? r.json() : null).catch(() => null);
        return (window._NODES_CACHE[nome] = d ? Object.values(d).filter(Boolean) : []);
    }
    async function carregar(progresso) {
        const cfg = await P3.loadUnidadeConfig();
        DB = cfg.firebase.databaseURL;
        progresso('Carregando escala e mapa das RPs…');
        const [esc, rpMap] = await Promise.all([
            fetch(`${DB}/escala_servico.json`).then(r => r.ok ? r.json() : null).catch(() => null),
            fetch(`${DB}/rp_viatura_map.json`).then(r => r.ok ? r.json() : null).catch(() => null),
        ]);
        ESCALAS = esc || {}; montarAncora();
        CIDADE_RP = {};
        Object.entries(rpMap || {}).forEach(([k, rp]) => { const cid = NORM(k.replace(/\(.*\)/, '')); CIDADE_RP[cid] = CIDADE_RP[cid] && CIDADE_RP[cid] !== sigla(rp) ? `${cid} — ${CIDADE_RP[cid]}/${sigla(rp).slice(3)} (pela área)` : sigla(rp); });
        progresso('Carregando ocorrências do CAD…');
        const [geral, armas, drogas] = await Promise.all([noJson('geral'), noJson('arma'), noJson('droga')]);
        progresso('Carregando equipes registradas no CAD (TCO)…');
        const guarnicao = await fetch(`${DB}/guarnicao.json`).then(r => r.ok ? r.json() : null).catch(() => null);
        progresso('Carregando autores (prisões)…');
        let autores = [];
        try { autores = Object.values((await P3.Autores.listar(cfg)) || {}); } catch (e) { autores = []; }
        progresso('Cruzando ocorrências × guarnições × escala…');
        const chave = v => String(v || '').replace(/\D/g, '');
        const eqCad = {};
        Object.entries(guarnicao || {}).forEach(([bol, v]) => {
            const lista = Array.isArray(v) ? v : Object.values(v || {});
            const x = lista.find(i => i && i.NOME_EQUIPE);
            if (!x) return;
            eqCad[chave(bol)] = { sigla: sigla(x.NOME_EQUIPE) || val(x.NOME_EQUIPE).toUpperCase() };
        });
        const armaPor = {}, drogaPor = {};
        armas.forEach(a => { const k = chave(a.BOLETIM); if (k) armaPor[k] = (armaPor[k] || 0) + 1; });
        drogas.forEach(d => { const k = chave(d.BOLETIM); if (k) drogaPor[k] = (drogaPor[k] || 0) + gramas(d) + 0.000001; });
        const presoPor = {};
        autores.forEach(a => { const k = chave(a.BOLETIM); if (k && /PRES|APREENDID|FLAGRANTE/.test(NORM(a.SITUACAO))) presoPor[k] = (presoPor[k] || 0) + 1; });
        REG = [];
        for (const o of geral) {
            const d = parseData(o.DATA);
            if (!d) continue;
            const bol = chave(o.BOLETIM);
            const turnoDia = diaDoTurno(d, o.HORA);
            let eq = null, fonte = 'area', iniciativa = false;
            const sol = String(o.SOLICITANTE || '').split('|')[0];
            if (eqCad[bol]) { eq = eqCad[bol].sigla; fonte = 'cad'; }
            const doSol = equipeNoTexto(sol);
            if (doSol) { iniciativa = true; if (!eq) { eq = doSol; fonte = 'solicitante'; } }
            if (!eq) { const t = equipeNoTexto(o.TEXTO_DESPACHANTE); if (t) { eq = t; fonte = 'texto'; } }
            if (!eq) { eq = CIDADE_RP[NORM(o.CIDADE)] || 'SEM GUARNIÇÃO'; fonte = 'area'; }
            const extra = { armas: armaPor[bol] || 0, drogas: drogaPor[bol] || 0, tco: !!eqCad[bol] };
            const h = minutos(o.HORA);
            REG.push({
                bol, data: d, dataStr: val(o.DATA), hora: val(o.HORA), turno: iso(turnoDia), grupo: grupoDoDia(turnoDia),
                mes: iso(turnoDia).slice(0, 7), dow: DOW[d.getDay()], horaN: h == null ? null : Math.floor(h / 60),
                cidade: val(o.CIDADE).toUpperCase() || 'NÃO INFORMADA', bairro: val(o.BAIRRO),
                tip: (val(o.TIPIFICACAO_GERAL) || val(o.TIPIFICACAO) || 'NÃO INFORMADA').split('|')[0].trim(),
                tipos: tiposDe(o, extra), equipe: eq, fonte, iniciativa,
                armas: extra.armas, drogasG: Math.round(extra.drogas * 1000) / 1000, presos: presoPor[bol] || 0,
                solucao: val(o['SOLUÇÃO']),
            });
        }
        return REG;
    }

    // ── Filtros (barra) + filtragem cruzada (clique) ────────────────
    const DIMS = {
        grupo: { rot: 'Grupo', get: r => r.grupo },
        equipe: { rot: 'Guarnição', get: r => r.equipe },
        tipo: { rot: 'Tipo', get: r => r.tipos, multi: true, nome: v => NOME_TIPO[v] || v },
        tip: { rot: 'Tipificação', get: r => r.tip },
        periodo: { rot: 'Período', get: r => r.mes, nome: v => v.length === 7 ? `${MESES[+v.slice(5) - 1]}/${v.slice(2, 4)}` : v.split('-').reverse().join('/') },
        dia: { rot: 'Dia do turno', get: r => r.turno, nome: v => v.split('-').reverse().join('/') },
        hora: { rot: 'Hora', get: r => r.horaN, nome: v => `${String(v).padStart(2, '0')}h` },
        dow: { rot: 'Dia da semana', get: r => r.dow },
        cidade: { rot: 'Cidade', get: r => r.cidade },
        fonte: { rot: 'Atribuição', get: r => r.fonte, nome: v => FONTES[v] || v },
        iniciativa: { rot: 'Iniciativa própria', get: r => r.iniciativa ? 'Sim' : 'Não' },
    };
    function lerBarra() {
        const v = id => ($(id) || {}).value || '';
        return { de: parseData(v('dg-de')), ate: parseData(v('dg-ate')), grupo: v('dg-grupo'), equipe: v('dg-equipe'), tip: v('dg-tip'), tipo: v('dg-tipo'), fonte: v('dg-fonte') };
    }
    // Mesmo recorte deslocado 1 mês para trás (mês cheio → mês anterior cheio).
    const ultimoDia = d => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    function menosUmMes(d, fimDoMes) {
        const alvo = new Date(d.getFullYear(), d.getMonth() - 1, 1);
        const dia = fimDoMes ? ultimoDia(alvo) : Math.min(d.getDate(), ultimoDia(alvo));
        return new Date(alvo.getFullYear(), alvo.getMonth(), dia);
    }
    function periodoAnterior() {
        const f = lerBarra();
        if (!f.de || !f.ate) return null;
        const de = menosUmMes(f.de, false), ate = menosUmMes(f.ate, f.ate.getDate() === ultimoDia(f.ate));
        const mesCheio = f.de.getDate() === 1 && f.ate.getDate() === ultimoDia(f.ate) && f.de.getMonth() === f.ate.getMonth() && f.de.getFullYear() === f.ate.getFullYear();
        const br = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
        return { de, ate, rotulo: mesCheio ? `${MESES[de.getMonth()]}/${String(de.getFullYear()).slice(2)}` : `${br(de)} a ${br(ate)}/${String(ate.getFullYear()).slice(2)}` };
    }
    function baseFiltrada(sobrepor) {
        const f = Object.assign(lerBarra(), sobrepor || {});
        return REG.filter(r => {
            const t = parseData(r.turno);
            if (f.de && t < f.de) return false;
            if (f.ate && t > f.ate) return false;
            if (f.grupo && r.grupo !== f.grupo) return false;
            if (f.equipe && r.equipe !== f.equipe) return false;
            if (f.tip && r.tip !== f.tip) return false;
            if (f.tipo && !r.tipos.includes(f.tipo)) return false;
            if (f.fonte === 'identificada' && r.fonte === 'area') return false;
            if (f.fonte && f.fonte !== 'identificada' && r.fonte !== f.fonte) return false;
            return true;
        });
    }
    const passa = (r, exceto) => Object.entries(CROSS).every(([d, v]) => {
        if (d === exceto) return true;
        const x = DIMS[d].get(r);
        return DIMS[d].multi ? (x || []).includes(v) : String(x) === String(v);
    });
    function alternar(dim, valor) {
        if (CROSS[dim] != null && String(CROSS[dim]) === String(valor)) delete CROSS[dim]; else CROSS[dim] = valor;
        render();
    }
    function contarPor(lista, dim) {
        const m = new Map();
        lista.forEach(r => { const x = DIMS[dim].get(r); (DIMS[dim].multi ? x : [x]).forEach(k => { if (k == null) return; m.set(k, (m.get(k) || 0) + 1); }); });
        return m;
    }

    // ── Gráficos (clique = filtro cruzado) ──────────────────────────
    function cores() { if (IMPRESSAO) return { txt: '#222', grade: '#ddd' }; const cs = getComputedStyle(document.documentElement); return { txt: cs.getPropertyValue('--p3-text').trim() || '#333', grade: cs.getPropertyValue('--p3-border').trim() || '#ddd' }; }
    const alfa = (hex, a) => { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
    function grafico(id, dim, tipo, rotulos, valores, cor, extra = {}) {
        const c = cores(), sel = CROSS[dim];
        const bg = rotulos.map((l, i) => { const base = Array.isArray(cor) ? cor[i % cor.length] : cor; return sel == null || String(extra.chaves ? extra.chaves[i] : l) === String(sel) ? base : alfa(base, .22); });
        if (CH[id]) CH[id].destroy();
        const el = $(id); if (!el) return;
        CH[id] = new Chart(el, {
            type: tipo === 'hbar' ? 'bar' : tipo,
            data: { labels: rotulos.map(l => extra.nome ? extra.nome(l) : l), datasets: [{ label: extra.rotulo || 'Ocorrências', data: valores, backgroundColor: bg, borderColor: tipo === 'line' ? cor : bg, borderWidth: tipo === 'line' ? 2 : 0, borderRadius: tipo === 'doughnut' ? 0 : 4, fill: false, tension: .25, pointRadius: tipo === 'line' ? 3 : 0 }].concat(extra.datasets || []) },
            options: {
                responsive: true, maintainAspectRatio: false, animation: false, indexAxis: tipo === 'hbar' ? 'y' : 'x',
                plugins: { legend: { display: tipo === 'doughnut' || !!extra.datasets, labels: { color: c.txt, boxWidth: 11, font: { size: 10 } } },
                    tooltip: { callbacks: { footer: () => 'Clique para filtrar todo o painel' } } },
                scales: tipo === 'doughnut' ? {} : { x: { ticks: { color: c.txt, font: { size: 10 } }, grid: { color: c.grade }, beginAtZero: true }, y: { ticks: { color: c.txt, font: { size: 10 }, precision: 0 }, grid: { color: c.grade }, beginAtZero: true } },
                // redesenha depois do clique (destruir o gráfico dentro do próprio evento quebra o Chart.js)
                onClick: (e, els) => { if (els.length) { const v = extra.chaves ? extra.chaves[els[0].index] : rotulos[els[0].index]; setTimeout(() => alternar(dim, v), 0); } },
                onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
            },
        });
    }
    const ordenar = (m, lim, porChave) => [...m.entries()].sort(porChave ? (a, b) => String(a[0]).localeCompare(String(b[0]), 'pt-BR', { numeric: true }) : (a, b) => b[1] - a[1]).slice(0, lim || 999);

    // ── Turnos trabalhados no período (média por turno) ────────────
    function turnosNoPeriodo(lista, sobrepor) {
        const f = Object.assign(lerBarra(), sobrepor || {});
        const datas = lista.map(r => parseData(r.turno)).filter(Boolean);
        const de = f.de || (datas.length ? new Date(Math.min(...datas)) : null), ate = f.ate || (datas.length ? new Date(Math.max(...datas)) : null);
        const t = { A: 0, B: 0, C: 0, D: 0 };
        if (!de || !ate) return t;
        for (let d = new Date(de); d <= ate; d.setDate(d.getDate() + 1)) t[grupoDoDia(d)]++;
        return t;
    }
    // Turnos que contam para a média: só os do grupo filtrado (barra ou clique), senão todos.
    function turnosEfetivos(turnos) {
        const g = CROSS.grupo || lerBarra().grupo;
        return (g ? turnos[g] : Object.values(turnos).reduce((s, x) => s + x, 0)) || 1;
    }
    function metricas(lista) {
        const m = { total: lista.length, iniciativa: 0, armas: 0, drogasG: 0, drogasOc: 0, tco: 0, mandados: 0, presos: 0, cvli: 0, mvi: 0, cvp: 0, vd: 0, pert: 0 };
        lista.forEach(r => {
            if (r.iniciativa) m.iniciativa++;
            m.armas += r.armas; m.drogasG += r.drogasG; if (r.tipos.includes('DROGA')) m.drogasOc++;
            if (r.tipos.includes('TCO')) m.tco++; if (r.tipos.includes('MANDADO')) m.mandados++;
            m.presos += r.presos; if (r.tipos.includes('CVLI')) m.cvli++; if (r.tipos.includes('MVI')) m.mvi++;
            if (r.tipos.includes('CVP')) m.cvp++; if (r.tipos.includes('VD')) m.vd++; if (r.tipos.includes('PERTURBACAO')) m.pert++;
        });
        return m;
    }

    // ── KPIs com comparação ao mês anterior do período aplicado ─────
    // sentido: +1 = aumentar é bom (produtividade) · -1 = aumentar é ruim (crime) · 0 = neutro
    function kpiDados(lista, totTurnos) {
        const M = metricas(lista);
        const PA = periodoAnterior();
        let A = null, totA = 1;
        if (PA) {
            // mesmo recorte (barra + cliques), exceto os filtros de data por clique
            const cross = Object.entries(CROSS).filter(([d]) => d !== 'dia' && d !== 'periodo');
            const la = baseFiltrada({ de: PA.de, ate: PA.ate }).filter(r => cross.every(([d, v]) => { const x = DIMS[d].get(r); return DIMS[d].multi ? (x || []).includes(v) : String(x) === String(v); }));
            A = metricas(la); A.armasOc = la.filter(r => r.armas).length;
            totA = turnosEfetivos(turnosNoPeriodo(la, { de: PA.de, ate: PA.ate }));
        }
        const itens = [
            { ic: '🚨', rot: 'Ocorrências atendidas', chave: 'total', txt: fmt(M.total), sub: `${fmt(M.total / totTurnos, 1)} por turno de 24h`, sentido: 0 },
            { ic: '🎯', rot: 'Iniciativa própria', chave: 'iniciativa', txt: fmt(M.iniciativa), sub: M.total ? `${fmt(M.iniciativa / M.total * 100, 1)}% do total` : '', dim: 'iniciativa', valor: 'Sim', sentido: 1 },
            { ic: '🔫', rot: 'Armas apreendidas', chave: 'armas', txt: fmt(M.armas), sub: `${fmt(lista.filter(r => r.armas).length)} ocorrência(s)`, dim: 'tipo', valor: 'ARMA', sentido: 1 },
            { ic: '💊', rot: 'Drogas apreendidas', chave: 'drogasG', txt: peso(M.drogasG), sub: `${fmt(M.drogasOc)} ocorrência(s)`, dim: 'tipo', valor: 'DROGA', sentido: 1, fmtA: peso },
            { ic: '📝', rot: 'TCO lavrados', chave: 'tco', txt: fmt(M.tco), sub: '', dim: 'tipo', valor: 'TCO', sentido: 1 },
            { ic: '⚖', rot: 'Mandados', chave: 'mandados', txt: fmt(M.mandados), sub: 'cumprimentos registrados', dim: 'tipo', valor: 'MANDADO', sentido: 1 },
            { ic: '🔒', rot: 'Prisões / apreensões', chave: 'presos', txt: fmt(M.presos), sub: 'autores presos/apreendidos', sentido: 1 },
            { ic: '☠', rot: 'CVLI / MVI', chave: 'cvli', txt: `${fmt(M.cvli)} / ${fmt(M.mvi)}`, sub: 'ocorrências atendidas', dim: 'tipo', valor: 'CVLI', sentido: -1, fmtA: () => `${fmt(A.cvli)} / ${fmt(A.mvi)}` },
        ];
        itens.forEach(x => {
            x.atual = M[x.chave];
            x.varHTML = ''; x.anterior = null; x.varTxt = '';
            if (!A) return;
            const a = A[x.chave], b = M[x.chave];
            x.anterior = a; x.antTxt = x.fmtA ? x.fmtA(a) : fmt(a);
            const pct = a ? (b - a) / a * 100 : (b ? null : 0);
            const seta = b > a ? '▲' : b < a ? '▼' : '=';
            const classe = !x.sentido || b === a ? 'neutro' : (b > a) === (x.sentido > 0) ? 'bom' : 'ruim';
            x.varTxt = `${seta} ${pct == null ? 'novo' : fmt(Math.abs(pct), 1) + '%'} vs ${PA.rotulo} (${x.antTxt})`;
            x.classe = classe;
            x.varHTML = `<i class="dg-var ${classe}" title="Mesmo recorte no período ${PA.de.toLocaleDateString('pt-BR')} a ${PA.ate.toLocaleDateString('pt-BR')}">${x.varTxt}</i>`;
        });
        itens.periodoAnterior = PA; itens.porTurnoAnterior = A ? A.total / totA : null;
        return itens;
    }

    // ── Relatório para impressão (respeita filtros da barra e por clique) ──
    let IMPRESSAO = false;
    function descreverFiltros() {
        const f = lerBarra(), txt = [];
        const br = d => d.toLocaleDateString('pt-BR');
        txt.push(`Período: ${f.de ? br(f.de) : 'início'} a ${f.ate ? br(f.ate) : 'hoje'}`);
        const opc = id => { const s = $(id); return s && s.value ? s.options[s.selectedIndex].text : ''; };
        [['dg-grupo', 'Grupo'], ['dg-equipe', 'Guarnição'], ['dg-tip', 'Tipificação'], ['dg-tipo', 'Tipo'], ['dg-fonte', 'Atribuição']].forEach(([id, n]) => { const v = opc(id); if (v) txt.push(`${n}: ${v}`); });
        Object.entries(CROSS).forEach(([d, v]) => txt.push(`${DIMS[d].rot}: ${DIMS[d].nome ? DIMS[d].nome(v) : v} (clique)`));
        return txt;
    }
    function imprimirRelatorio() {
        if (!REG) return;
        const comLista = confirm('Incluir a lista de ocorrências do recorte no relatório?\n(OK = sim · Cancelar = só indicadores, gráficos e tabelas)');
        // gráficos com cores de papel (texto escuro), mesmo no tema escuro
        IMPRESSAO = true; render();
        const graf = [['dg-g-grupo', 'Por grupo'], ['dg-g-equipe', 'Por guarnição'], ['dg-g-tipo', 'Por tipo'], ['dg-g-tip', 'Principais tipificações'], ['dg-g-evol', 'Evolução'], ['dg-g-hora', 'Hora do dia'], ['dg-g-dow', 'Dia da semana'], ['dg-g-cidade', 'Por cidade']]
            .map(([id, t]) => { const c = $(id); return c ? `<div class="g"><h4>${t}</h4><img src="${c.toDataURL('image/png')}"></div>` : ''; }).join('');
        const base = baseFiltrada(), lista = base.filter(r => passa(r, null)), turnos = turnosNoPeriodo(base);
        const totTurnos = Object.values(turnos).reduce((s, x) => s + x, 0) || 1;
        const KP = kpiDados(lista, turnosEfetivos(turnos)), PA = KP.periodoAnterior;
        const tabela = id => { const el = $(id); if (!el) return ''; const c = el.cloneNode(true); c.querySelectorAll('[class]').forEach(x => x.classList.remove('dg-clic', 'dg-sel')); return c.innerHTML; };
        IMPRESSAO = false; render();
        const cfg = window.P3_CONFIG || {};
        const sess = window.P3 && P3.getSession ? P3.getSession() : null;
        const kpis = `<table class="t"><thead><tr><th>Indicador</th><th>Período aplicado</th>${PA ? `<th>${esc(PA.rotulo)} (mês anterior)</th><th>Variação</th>` : ''}</tr></thead><tbody>
            ${KP.map(x => `<tr><td>${x.ic} ${x.rot}</td><td><b>${x.txt}</b>${x.sub ? `<br><small>${x.sub}</small>` : ''}</td>${PA ? `<td>${x.antTxt}</td><td class="${x.classe}">${esc(x.varTxt.split(' vs ')[0])}</td>` : ''}</tr>`).join('')}
            <tr><td>📊 Média por turno de 24h</td><td><b>${fmt(lista.length / turnosEfetivos(turnos), 1)}</b></td>${PA ? `<td>${fmt(KP.porTurnoAnterior, 1)}</td><td></td>` : ''}</tr></tbody></table>`;
        const l = lista.slice().sort((a, b) => b.data - a.data || String(b.hora).localeCompare(String(a.hora)));
        const listaHTML = comLista ? `<h3>Ocorrências do recorte (${fmt(l.length)})</h3><table class="t lista"><thead><tr><th>Data</th><th>Hora</th><th>Grupo</th><th>Guarnição</th><th>Boletim</th><th>Cidade</th><th>Tipificação</th><th>Apreensões</th></tr></thead><tbody>
            ${l.slice(0, 1000).map(r => `<tr><td>${esc(r.dataStr)}</td><td>${esc(r.hora)}</td><td>${r.grupo}</td><td>${esc(r.equipe)}</td><td>${esc(r.bol)}</td><td>${esc(r.cidade)}</td><td>${esc(r.tip)}</td><td>${[r.armas ? `${r.armas} arma(s)` : '', r.drogasG ? peso(r.drogasG) : '', r.presos ? `${r.presos} preso(s)` : ''].filter(Boolean).join(' · ')}</td></tr>`).join('')}</tbody></table>
            ${l.length > 1000 ? '<p class="nota">Listadas as 1.000 mais recentes — o CSV traz todas.</p>' : ''}` : '';
        const w = window.open('', '_blank');
        if (!w) { alert('O navegador bloqueou a janela do relatório — permita pop-ups para esta página.'); return; }
        w.document.write(`<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><title>Relatório de desempenho — guarnições e grupos</title><style>
            @page { size: A4; margin: 12mm; } * { box-sizing: border-box; }
            body { font: 10.5pt/1.4 Arial, sans-serif; color: #111; margin: 0; padding: 14px; background: #fff; }
            .cab { text-align: center; border-bottom: 2px solid #0d2a52; padding-bottom: 6px; margin-bottom: 10px; } .cab b { display: block; font-size: 11pt; } .cab h1 { font-size: 14pt; margin: 6px 0 2px; color: #0d2a52; }
            .filtros { background: #f3f6fb; border: 1px solid #cdd7e6; border-radius: 6px; padding: 6px 10px; font-size: 9.5pt; margin-bottom: 10px; } .filtros span { display: inline-block; margin-right: 14px; }
            h3 { font-size: 11.5pt; color: #0d2a52; border-left: 4px solid #2f5fdd; padding-left: 6px; margin: 14px 0 6px; page-break-after: avoid; }
            table { width: 100%; border-collapse: collapse; font-size: 8.6pt; page-break-inside: auto; } tr { page-break-inside: avoid; }
            th, td { border: 1px solid #c9ced6; padding: 3px 5px; text-align: left; vertical-align: top; } th { background: #e8eef8 !important; }
            td small { display: block; color: #555; font-size: 7.5pt; } .bom { color: #1b5e20; font-weight: bold; } .ruim { color: #b71c1c; font-weight: bold; }
            .dg-gbadge { display: inline-block; min-width: 18px; text-align: center; color: #fff; border-radius: 4px; font-weight: bold; padding: 0 4px; }
            .dg-top { font-weight: bold; color: #1b5e20; } .co-det-meta, .nota { font-size: 8pt; color: #555; margin: 3px 0; }
            .graf { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; } .g { border: 1px solid #d5dbe5; border-radius: 6px; padding: 4px 6px; page-break-inside: avoid; } .g h4 { margin: 0 0 3px; font-size: 9pt; } .g img { width: 100%; height: auto; }
            .lista td { font-size: 7.8pt; } .rod { margin-top: 14px; font-size: 8pt; color: #555; border-top: 1px solid #ccc; padding-top: 4px; }
            * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            @media screen { .barra { position: sticky; top: 0; background: #0d2a52; color: #fff; padding: 8px 12px; margin: -14px -14px 12px; display: flex; justify-content: space-between; align-items: center; } .barra button { font: bold 10pt Arial; padding: 6px 14px; border: 0; border-radius: 5px; cursor: pointer; } }
            @media print { .barra { display: none; } }
        </style></head><body>
            <div class="barra"><span>Pré-visualização do relatório</span><button onclick="print()">🖨 Imprimir / salvar PDF</button></div>
            <div class="cab"><b>POLÍCIA MILITAR DE ALAGOAS</b><b>${esc(String(cfg.nome || '10º Batalhão de Polícia Militar').replace(/\s*\(.*\)\s*$/, '').toUpperCase())}</b><b>SEÇÃO DE PLANEJAMENTO, INSTRUÇÃO E ESTATÍSTICA — P3</b>
                <h1>RELATÓRIO DE DESEMPENHO POR GUARNIÇÃO E POR GRUPO</h1><div style="font-size:9pt;">Ocorrências do CAD × escala de serviço (turno de 24h, ${String(Math.floor(INICIO_TURNO / 60)).padStart(2, '0')}h às ${String(Math.floor(INICIO_TURNO / 60)).padStart(2, '0')}h)</div></div>
            <div class="filtros"><b>Filtros aplicados:</b> ${descreverFiltros().map(t => `<span>• ${esc(t)}</span>`).join('')}
                <br><b>Turnos no período:</b> ${totTurnos} (A ${turnos.A} · B ${turnos.B} · C ${turnos.C} · D ${turnos.D})${PA ? ` · <b>Comparação:</b> mesmo recorte em ${PA.de.toLocaleDateString('pt-BR')} a ${PA.ate.toLocaleDateString('pt-BR')}` : ''}</div>
            <h3>1. Indicadores do período${PA ? ' e comparação com o mês anterior' : ''}</h3>${kpis}
            <h3>2. Desempenho por grupo</h3>${tabela('dg-grupos')}
            <h3>3. Ranking por guarnição</h3>${tabela('dg-ranking')}
            <h3>4. Matriz guarnição × grupo</h3>${tabela('dg-matriz')}
            <h3>5. Gráficos</h3><div class="graf">${graf}</div>
            ${listaHTML ? listaHTML.replace('<h3>', '<h3>6. ') : ''}
            <div class="rod">Atribuição da guarnição: equipe do boletim (CAD/TCO) → solicitante → relato do despachante → área da RP (estimativa). Variação: verde = melhora · vermelho = piora (para crimes, aumento é piora).<br>
                Emitido em ${new Date().toLocaleString('pt-BR')}${sess ? ' por ' + esc([sess.graduacao, sess.nomeGuerra].filter(Boolean).join(' ')) : ''} — Sistema P3.</div>
        </body></html>`);
        w.document.close();
        setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* usuário imprime pelo botão */ } }, 700);
    }

    // ── Render ──────────────────────────────────────────────────────
    let ORDEM_RANK = { col: 'total', desc: true };
    function render() {
        if (!REG) return;
        const base = baseFiltrada();
        const lista = base.filter(r => passa(r, null));
        const sem = dim => base.filter(r => passa(r, dim));
        const turnos = turnosNoPeriodo(base);
        const M = metricas(lista);
        // chips
        $('dg-chips').innerHTML = Object.keys(CROSS).length
            ? '<span class="dg-chips-rot">Filtros por clique:</span>' + Object.entries(CROSS).map(([d, v]) => `<button class="dg-chip" data-tira="${d}">${esc(DIMS[d].rot)}: <b>${esc(DIMS[d].nome ? DIMS[d].nome(v) : v)}</b> ✕</button>`).join('') + '<button class="dg-chip dg-chip-limpa" data-limpa>Limpar todos</button>'
            : '<span class="dg-chips-rot">💡 Clique em qualquer barra, fatia, célula ou linha para filtrar todo o painel.</span>';
        $('dg-chips').querySelectorAll('[data-tira]').forEach(b => b.onclick = () => { delete CROSS[b.dataset.tira]; render(); });
        const lb = $('dg-chips').querySelector('[data-limpa]'); if (lb) lb.onclick = () => { Object.keys(CROSS).forEach(k => delete CROSS[k]); render(); };
        // KPIs (clicáveis → filtro de tipo / iniciativa)
        const totTurnos = Object.values(turnos).reduce((s, x) => s + x, 0) || 1;
        const KP = kpiDados(lista, turnosEfetivos(turnos));
        const k = x => `<div class="dg-kpi${x.dim ? ' dg-clic' : ''}${x.dim && String(CROSS[x.dim]) === String(x.valor) ? ' dg-sel' : ''}" ${x.dim ? `data-dim="${x.dim}" data-val="${esc(x.valor)}"` : ''}><span>${x.ic}</span><div><small>${x.rot}</small><b>${x.txt}</b><em>${x.sub || ''}</em>${x.varHTML}</div></div>`;
        $('dg-kpis').innerHTML = KP.map(k).join('');
        $('dg-kpis').querySelectorAll('[data-dim]').forEach(el => el.onclick = () => alternar(el.dataset.dim, el.dataset.val));

        // gráficos — cada um com os filtros dos DEMAIS
        const pg = contarPor(sem('grupo'), 'grupo');
        grafico('dg-g-grupo', 'grupo', 'bar', GRUPOS, GRUPOS.map(g => pg.get(g) || 0), GRUPOS.map(g => COR_GRUPO[g]), {
            nome: g => `Grupo ${g}`, datasets: [{ label: 'Média por turno', type: 'line', data: GRUPOS.map(g => turnos[g] ? +((pg.get(g) || 0) / turnos[g]).toFixed(1) : 0), borderColor: '#c0392b', backgroundColor: '#c0392b', yAxisID: 'y', pointRadius: 4 }] });
        const pe = ordenar(contarPor(sem('equipe'), 'equipe'), 18);
        grafico('dg-g-equipe', 'equipe', 'hbar', pe.map(x => x[0]), pe.map(x => x[1]), '#2f5fdd');
        const pt = contarPor(sem('tipo'), 'tipo');
        grafico('dg-g-tipo', 'tipo', 'bar', TIPOS.map(t => t[0]), TIPOS.map(t => pt.get(t[0]) || 0), ['#111', '#6a1b9a', '#e65100', '#ad1457', '#455a64', '#7cb342', '#00897b', '#0097a7', '#5d4037'], { nome: t => NOME_TIPO[t] });
        const ptip = ordenar(contarPor(sem('tip'), 'tip'), 12);
        grafico('dg-g-tip', 'tip', 'hbar', ptip.map(x => x[0]), ptip.map(x => x[1]), '#8e44ad', { nome: t => t.length > 34 ? t.slice(0, 33) + '…' : t, chaves: ptip.map(x => x[0]) });
        // evolução: por dia do turno se o período for curto, senão por mês
        const f = lerBarra(), curto = f.de && f.ate && diasEntre(f.de, f.ate) <= 62;
        const dimEv = curto ? 'dia' : 'periodo';
        const ev = ordenar(contarPor(sem(dimEv), dimEv), 999, true);
        grafico('dg-g-evol', dimEv, 'line', ev.map(x => x[0]), ev.map(x => x[1]), '#2f5fdd', { nome: DIMS[dimEv].nome });
        const ph = contarPor(sem('hora'), 'hora');
        const horas = [...Array(24).keys()];
        grafico('dg-g-hora', 'hora', 'bar', horas, horas.map(h => ph.get(h) || 0), '#e67e22', { nome: h => `${String(h).padStart(2, '0')}h` });
        const pd = contarPor(sem('dow'), 'dow');
        grafico('dg-g-dow', 'dow', 'bar', DOW, DOW.map(d => pd.get(d) || 0), '#16a085');
        const pc = ordenar(contarPor(sem('cidade'), 'cidade'), 12);
        grafico('dg-g-cidade', 'cidade', 'hbar', pc.map(x => x[0]), pc.map(x => x[1]), '#c0392b');
        const pf = contarPor(sem('fonte'), 'fonte');
        const fk = Object.keys(FONTES);
        grafico('dg-g-fonte', 'fonte', 'doughnut', fk, fk.map(x => pf.get(x) || 0), ['#2f5fdd', '#27ae60', '#f39c12', '#95a5a6'], { nome: x => FONTES[x], chaves: fk });

        renderMatriz(base, turnos);
        renderRanking(base, turnos);
        renderGrupos(base, turnos);
        renderEscala();
        renderLista(lista);
        $('dg-resumo').textContent = `${fmt(lista.length)} ocorrência(s) no recorte · ${fmt(totTurnos)} turno(s) de 24h no período (A ${turnos.A} · B ${turnos.B} · C ${turnos.C} · D ${turnos.D}) · turno das ${String(Math.floor(INICIO_TURNO / 60)).padStart(2, '0')}h às ${String(Math.floor(INICIO_TURNO / 60)).padStart(2, '0')}h`;
    }

    // Matriz guarnição × grupo (célula clicável = filtra guarnição E grupo)
    function renderMatriz(base, turnos) {
        const dados = base.filter(r => Object.entries(CROSS).every(([d, v]) => d === 'equipe' || d === 'grupo' ? true : (DIMS[d].multi ? (DIMS[d].get(r) || []).includes(v) : String(DIMS[d].get(r)) === String(v))));
        const m = {}, totEq = {};
        dados.forEach(r => { m[r.equipe] = m[r.equipe] || { A: 0, B: 0, C: 0, D: 0 }; m[r.equipe][r.grupo]++; totEq[r.equipe] = (totEq[r.equipe] || 0) + 1; });
        if (CROSS.equipe == null) guarnicoesEscala().forEach(g => { if (!m[g.sigla]) { m[g.sigla] = { A: 0, B: 0, C: 0, D: 0 }; totEq[g.sigla] = 0; } });
        const eqs = Object.keys(m).sort((a, b) => totEq[b] - totEq[a]).slice(0, 30);
        const max = Math.max(1, ...eqs.flatMap(e => GRUPOS.map(g => m[e][g])));
        $('dg-matriz').innerHTML = eqs.length ? `<table class="dg-tab dg-matriz"><thead><tr><th>Guarnição</th>${GRUPOS.map(g => `<th class="dg-clic${CROSS.grupo === g ? ' dg-sel' : ''}" data-g="${g}">Grupo ${g}<br><small>${turnos[g]} turno(s)</small></th>`).join('')}<th>Total</th></tr></thead><tbody>
            ${eqs.map(e => `<tr><th class="dg-clic${CROSS.equipe === e ? ' dg-sel' : ''}" data-e="${esc(e)}">${esc(e)}</th>${GRUPOS.map(g => { const v = m[e][g], sel = CROSS.equipe === e && CROSS.grupo === g;
                return `<td class="dg-clic dg-cel${sel ? ' dg-sel' : ''}" data-e="${esc(e)}" data-g="${g}" style="background:${alfa(COR_GRUPO[g], .08 + .62 * v / max)}" title="${fmt(v)} ocorrência(s) · ${turnos[g] ? fmt(v / turnos[g], 1) : 0} por turno">${fmt(v)}<small>${turnos[g] ? fmt(v / turnos[g], 1) + '/turno' : ''}</small></td>`; }).join('')}<td><b>${fmt(totEq[e])}</b></td></tr>`).join('')}</tbody></table>` : '<div class="co-vazio">Sem dados.</div>';
        $('dg-matriz').querySelectorAll('[data-e],[data-g]').forEach(el => el.onclick = () => {
            const e = el.dataset.e, g = el.dataset.g;
            if (e && g) { const ja = CROSS.equipe === e && CROSS.grupo === g; if (ja) { delete CROSS.equipe; delete CROSS.grupo; } else { CROSS.equipe = e; CROSS.grupo = g; } render(); }
            else if (e) alternar('equipe', e); else alternar('grupo', g);
        });
    }

    // Ranking de desempenho por guarnição (colunas ordenáveis; linha clicável)
    function renderRanking(base, turnos) {
        const dados = base.filter(r => passa(r, 'equipe'));
        const por = {};
        dados.forEach(r => { (por[r.equipe] = por[r.equipe] || []).push(r); });
        if (CROSS.equipe == null && !lerBarra().equipe) guarnicoesEscala().forEach(g => { por[g.sigla] = por[g.sigla] || []; });
        const totTurnos = Object.values(turnos).reduce((s, x) => s + x, 0) || 1;
        const linhas = Object.entries(por).map(([e, l]) => {
            const m = metricas(l);
            const gruposAtivos = CROSS.grupo ? [CROSS.grupo] : GRUPOS;
            const tEq = gruposAtivos.reduce((s, g) => s + turnos[g], 0) || totTurnos;
            return { equipe: e, ...m, porTurno: m.total / tEq, inicPct: m.total ? m.iniciativa / m.total * 100 : 0, identificadas: l.filter(r => r.fonte !== 'area').length };
        });
        const c = ORDEM_RANK.col;
        linhas.sort((a, b) => (ORDEM_RANK.desc ? -1 : 1) * ((typeof a[c] === 'string' ? a[c].localeCompare(b[c]) : a[c] - b[c])));
        const cols = [['equipe', 'Guarnição'], ['total', 'Ocorr.'], ['porTurno', 'Por turno'], ['iniciativa', 'Iniciativa'], ['inicPct', '% inic.'], ['armas', 'Armas'], ['drogasG', 'Drogas'], ['tco', 'TCO'], ['mandados', 'Mandados'], ['presos', 'Prisões'], ['cvli', 'CVLI'], ['cvp', 'CVP'], ['vd', 'VD'], ['pert', 'Perturb.'], ['identificadas', 'Atribuição CAD']];
        const v = (x, k) => k === 'porTurno' ? fmt(x[k], 1) : k === 'inicPct' ? fmt(x[k], 1) + '%' : k === 'drogasG' ? peso(x[k]) : k === 'identificadas' ? `${fmt(x.total ? x[k] / x.total * 100 : 0)}%` : k === 'equipe' ? esc(x[k]) : fmt(x[k]);
        $('dg-ranking').innerHTML = linhas.length ? `<table class="dg-tab"><thead><tr><th>#</th>${cols.map(([k, n]) => `<th class="dg-clic" data-ord="${k}">${n}${ORDEM_RANK.col === k ? (ORDEM_RANK.desc ? ' ▼' : ' ▲') : ''}</th>`).join('')}</tr></thead><tbody>
            ${linhas.map((x, i) => `<tr class="dg-clic${CROSS.equipe === x.equipe ? ' dg-sel' : ''}" data-e="${esc(x.equipe)}"><td>${i + 1}º</td>${cols.map(([k]) => `<td>${v(x, k)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<div class="co-vazio">Sem dados.</div>';
        $('dg-ranking').querySelectorAll('[data-ord]').forEach(th => th.onclick = () => { ORDEM_RANK = { col: th.dataset.ord, desc: ORDEM_RANK.col === th.dataset.ord ? !ORDEM_RANK.desc : true }; render(); });
        $('dg-ranking').querySelectorAll('tr[data-e]').forEach(tr => tr.onclick = () => alternar('equipe', tr.dataset.e));
    }

    // Desempenho por GRUPO (A/B/C/D) — totais e médias por turno de 24h
    function renderGrupos(base, turnos) {
        const dados = base.filter(r => passa(r, 'grupo'));
        const cols = [['total', 'Ocorr.'], ['porTurno', 'Por turno'], ['iniciativa', 'Iniciativa'], ['inicPct', '% inic.'], ['armas', 'Armas'], ['drogasG', 'Drogas'], ['tco', 'TCO'], ['mandados', 'Mandados'], ['presos', 'Prisões'], ['cvli', 'CVLI'], ['mvi', 'MVI'], ['cvp', 'CVP'], ['vd', 'VD'], ['pert', 'Perturb.']];
        const linhas = GRUPOS.map(g => { const l = dados.filter(r => r.grupo === g), m = metricas(l);
            return { g, turnos: turnos[g], ...m, porTurno: turnos[g] ? m.total / turnos[g] : 0, inicPct: m.total ? m.iniciativa / m.total * 100 : 0 }; });
        const melhor = k => Math.max(...linhas.map(x => x[k]));
        const v = (x, k) => k === 'porTurno' ? fmt(x[k], 1) : k === 'inicPct' ? fmt(x[k], 1) + '%' : k === 'drogasG' ? peso(x[k]) : fmt(x[k]);
        $('dg-grupos').innerHTML = `<table class="dg-tab"><thead><tr><th>Grupo</th><th>Turnos</th>${cols.map(c => `<th>${c[1]}</th>`).join('')}</tr></thead><tbody>
            ${linhas.map(x => `<tr class="dg-clic${CROSS.grupo === x.g ? ' dg-sel' : ''}" data-g="${x.g}"><td><span class="dg-gbadge" style="background:${COR_GRUPO[x.g]}">${x.g}</span></td><td>${x.turnos}</td>
                ${cols.map(([k]) => `<td${x[k] && x[k] === melhor(k) && k !== 'total' ? ' class="dg-top"' : ''}>${v(x, k)}</td>`).join('')}</tr>`).join('')}</tbody></table>
            <div class="co-det-meta" style="margin-top:4px;">Destaque = maior valor entre os grupos. Média por turno = ocorrências ÷ turnos de 24h do grupo no período.</div>`;
        $('dg-grupos').querySelectorAll('tr[data-g]').forEach(tr => tr.onclick = () => alternar('grupo', tr.dataset.g));
    }

    // Escala: guarnições do turno de 24h e grupo de serviço de cada dia do período
    function renderEscala() {
        const el = $('dg-escala');
        const f = lerBarra();
        const gs = guarnicoesEscala();
        if (!gs.length) { el.innerHTML = '<div class="co-vazio">Nenhuma escala importada em /escala_servico.</div>'; return; }
        const de = f.de || new Date(new Date().getFullYear(), new Date().getMonth(), 1), ate = f.ate || new Date();
        const dias = [];
        for (let d = new Date(de); d <= ate && dias.length < 120; d.setDate(d.getDate() + 1)) dias.push(new Date(d));
        el.innerHTML = `<p class="co-det-meta" style="margin:0 0 8px;">Turno de 24h a partir das ${String(Math.floor(INICIO_TURNO / 60)).padStart(2, '0')}h. Grupos em ciclo contínuo A → B → C → D a partir da escala de referência (01/10/2026 = grupo ${GRUPOS[ANCORA.idx]}), aplicado também aos meses anteriores.</p>
            <div class="dg-esc-gs">${gs.map(g => `<span class="dg-clic${CROSS.equipe === g.sigla ? ' dg-sel' : ''}" data-e="${esc(g.sigla)}"><b>${esc(g.sigla)}</b>${g.area ? ' · ' + esc(g.area) : ''}</span>`).join('')}</div>
            <div class="dg-cal">${dias.map(d => { const g = grupoDoDia(d); return `<div class="dg-cal-d${CROSS.grupo === g ? ' dg-sel' : ''}" data-g="${g}" title="${d.toLocaleDateString('pt-BR')} — grupo ${g}"><small>${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}</small><b style="background:${COR_GRUPO[g]}">${g}</b></div>`; }).join('')}</div>`;
        el.querySelectorAll('[data-e]').forEach(x => x.onclick = () => alternar('equipe', x.dataset.e));
        el.querySelectorAll('[data-g]').forEach(x => x.onclick = () => alternar('grupo', x.dataset.g));
    }

    // Lista das ocorrências do recorte (linha → ocorrência completa, como no CAD)
    function renderLista(lista) {
        const l = lista.slice().sort((a, b) => b.data - a.data || String(b.hora).localeCompare(String(a.hora)));
        $('dg-lista-tit').textContent = `📋 Ocorrências do recorte (${fmt(l.length)})`;
        $('dg-lista').innerHTML = l.length ? `<table class="dg-tab"><thead><tr><th>Data</th><th>Hora</th><th>Turno</th><th>Grupo</th><th>Guarnição</th><th>Atribuição</th><th>Boletim</th><th>Cidade</th><th>Tipificação</th><th>Tipos</th><th>Apreensões</th></tr></thead><tbody>
            ${l.slice(0, 400).map(r => `<tr class="dg-clic" data-bol="${esc(r.bol)}"><td>${esc(r.dataStr)}</td><td>${esc(r.hora)}</td><td>${esc(r.turno.split('-').reverse().join('/'))}</td><td><span class="dg-gbadge" style="background:${COR_GRUPO[r.grupo]}">${r.grupo}</span></td>
                <td>${esc(r.equipe)}${r.iniciativa ? ' <span title="iniciativa própria">🎯</span>' : ''}</td><td><small>${esc(FONTES[r.fonte])}</small></td><td>${esc(r.bol)}</td><td>${esc(r.cidade)}</td><td>${esc(r.tip)}</td>
                <td>${r.tipos.map(t => `<span class="dg-tag">${esc(NOME_TIPO[t])}</span>`).join('')}</td><td>${[r.armas ? `🔫 ${r.armas}` : '', r.drogasG ? `💊 ${peso(r.drogasG)}` : '', r.presos ? `🔒 ${r.presos}` : ''].filter(Boolean).join(' ')}</td></tr>`).join('')}</tbody></table>
            ${l.length > 400 ? `<div class="co-det-meta" style="margin-top:6px;">Mostrando as 400 mais recentes — refine os filtros para ver as demais (o CSV traz todas).</div>` : ''}` : '<div class="co-vazio">Nenhuma ocorrência no recorte.</div>';
        $('dg-lista').querySelectorAll('tr[data-bol]').forEach(tr => tr.onclick = () => {
            if (!window.CO_abrirOcorrencias) return;
            const ls = l.slice(0, 400).map(r => ({ d: r.dataStr, h: r.hora, b: r.bol, c: r.cidade, e: r.bairro, t: r.tip, s: r.solucao }));
            window.CO_abrirOcorrencias('Ocorrências do painel de desempenho', ls, tr.dataset.bol);
        });
    }

    function exportarCSV() {
        const base = baseFiltrada().filter(r => passa(r, null));
        const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
        const linhas = [['Data', 'Hora', 'Dia do turno', 'Grupo', 'Guarnição', 'Atribuição', 'Iniciativa própria', 'Boletim', 'Cidade', 'Bairro', 'Tipificação', 'Tipos', 'Armas', 'Drogas (g)', 'Presos', 'Solução'].map(q).join(';')];
        base.forEach(r => linhas.push([r.dataStr, r.hora, r.turno.split('-').reverse().join('/'), r.grupo, r.equipe, FONTES[r.fonte], r.iniciativa ? 'Sim' : 'Não', r.bol, r.cidade, r.bairro, r.tip, r.tipos.map(t => NOME_TIPO[t]).join(', '), r.armas, String(r.drogasG).replace('.', ','), r.presos, r.solucao].map(q).join(';')));
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
        a.download = `desempenho_guarnicoes_${iso(new Date())}.csv`; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }

    // ── Estrutura da aba ────────────────────────────────────────────
    function montar(el) {
        const h = new Date();
        el.innerHTML = `
            <div class="co-barra-acoes"><div><h2>📈 Desempenho por guarnição e por grupo</h2><p>Ocorrências do CAD × escala de serviço (turno de 24h, 08h às 08h) — clique nos gráficos para filtrar</p></div>
                <div style="display:flex;gap:.5rem;flex-wrap:wrap;"><button class="co-btn co-btn-pri" id="dg-imprimir">🖨 Imprimir relatório</button><button class="co-btn" id="dg-csv">⬇ CSV</button><button class="co-btn" id="dg-recarregar">↻ Recarregar dados</button></div></div>
            <div class="co-card"><div class="co-filtros">
                <label>De <input type="date" id="dg-de" value="${iso(new Date(h.getFullYear(), h.getMonth(), 1))}"></label>
                <label>Até <input type="date" id="dg-ate" value="${iso(h)}"></label>
                <label>Grupo <select id="dg-grupo"><option value="">Todos</option>${GRUPOS.map(g => `<option value="${g}">Grupo ${g}</option>`).join('')}</select></label>
                <label>Guarnição <select id="dg-equipe"><option value="">Todas</option></select></label>
                <label class="co-filtro-largo">Tipificação <select id="dg-tip"><option value="">Todas</option></select></label>
                <label>Tipo <select id="dg-tipo"><option value="">Todos</option>${TIPOS.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
                <label>Atribuição <select id="dg-fonte"><option value="">Todas</option><option value="identificada">Só identificadas (sem estimativa)</option>${Object.entries(FONTES).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
            </div></div>
            <div class="dg-chips" id="dg-chips"></div>
            <div class="co-det-meta" id="dg-resumo"></div>
            <div class="dg-kpis" id="dg-kpis"></div>
            <div class="dg-graficos">
                <div class="co-card"><h3 class="dg-h">Por grupo <small>(barras = ocorrências · linha = média por turno)</small></h3><div class="dg-graf"><canvas id="dg-g-grupo"></canvas></div></div>
                <div class="co-card"><h3 class="dg-h">Por guarnição</h3><div class="dg-graf dg-alto"><canvas id="dg-g-equipe"></canvas></div></div>
                <div class="co-card"><h3 class="dg-h">Por tipo</h3><div class="dg-graf"><canvas id="dg-g-tipo"></canvas></div></div>
                <div class="co-card"><h3 class="dg-h">Principais tipificações</h3><div class="dg-graf dg-alto"><canvas id="dg-g-tip"></canvas></div></div>
                <div class="co-card dg-largo"><h3 class="dg-h">Evolução</h3><div class="dg-graf"><canvas id="dg-g-evol"></canvas></div></div>
                <div class="co-card"><h3 class="dg-h">Hora do dia</h3><div class="dg-graf"><canvas id="dg-g-hora"></canvas></div></div>
                <div class="co-card"><h3 class="dg-h">Dia da semana</h3><div class="dg-graf"><canvas id="dg-g-dow"></canvas></div></div>
                <div class="co-card"><h3 class="dg-h">Por cidade</h3><div class="dg-graf"><canvas id="dg-g-cidade"></canvas></div></div>
                <div class="co-card"><h3 class="dg-h">Atribuição da guarnição</h3><div class="dg-graf"><canvas id="dg-g-fonte"></canvas></div></div>
            </div>
            <div class="co-card"><h3 class="dg-h">👥 Desempenho por grupo <small>(clique na linha para filtrar)</small></h3><div class="co-scroll" id="dg-grupos"></div></div>
            <div class="co-card"><h3 class="dg-h">🧮 Matriz guarnição × grupo <small>(cor = volume · clique numa célula, linha ou coluna)</small></h3><div class="co-scroll" id="dg-matriz"></div></div>
            <div class="co-card"><h3 class="dg-h">🏆 Ranking de desempenho por guarnição <small>(clique no título da coluna para ordenar; na linha para filtrar)</small></h3><div class="co-scroll" id="dg-ranking"></div></div>
            <div class="co-card"><h3 class="dg-h">📅 Guarnições e grupos de serviço no período</h3><div id="dg-escala"></div></div>
            <div class="co-card"><h3 class="dg-h" id="dg-lista-tit">📋 Ocorrências</h3><div class="co-scroll" style="max-height:520px;" id="dg-lista"></div></div>`;
        ['dg-de', 'dg-ate', 'dg-grupo', 'dg-equipe', 'dg-tip', 'dg-tipo', 'dg-fonte'].forEach(id => $(id).addEventListener('change', render));
        $('dg-csv').onclick = exportarCSV;
        $('dg-imprimir').onclick = imprimirRelatorio;
        $('dg-recarregar').onclick = () => { REG = null; carregando = null; window._NODES_CACHE = {}; abrir(true); };
    }
    function preencherListas() {
        const eqs = [...new Set(REG.map(r => r.equipe))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
        const tips = [...new Set(REG.map(r => r.tip))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
        const sel = (id, lista) => { const s = $(id), v = s.value; s.innerHTML = s.options[0].outerHTML + lista.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join(''); s.value = v; };
        sel('dg-equipe', eqs); sel('dg-tip', tips);
    }
    async function abrir(forcar) {
        const el = $('view-desempenho');
        if (!el) return;
        if (!el.dataset.montado) { montar(el); el.dataset.montado = '1'; }
        if (REG && !forcar) { render(); return; }
        const r = $('dg-resumo');
        try {
            carregando = carregando || carregar(t => { r.textContent = '⏳ ' + t; });
            await carregando;
            preencherListas();
            render();
        } catch (e) { console.error('[desempenho]', e); r.textContent = '⚠️ Não foi possível carregar: ' + e.message; carregando = null; }
    }
    // Tema claro/escuro → redesenha
    document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#btn-tema') && REG) setTimeout(render, 60); });
    // ── API sem tela (usada pelo XERIFE) ────────────────────────────
    async function garantirEscala() {
        if (ANCORA && Object.keys(ESCALAS).length) return;
        if (!DB) DB = (await P3.loadUnidadeConfig()).firebase.databaseURL;
        ESCALAS = (await fetch(`${DB}/escala_servico.json`).then(r => r.ok ? r.json() : null).catch(() => null)) || {};
        montarAncora();
    }
    async function garantirDados() {
        if (REG) return REG;
        carregando = carregando || carregar(() => {});
        return carregando;
    }
    // Grupo de serviço de uma data (turno de 24h que COMEÇA nessa data).
    async function grupoDe(data) { await garantirEscala(); return grupoDoDia(data); }
    // Desempenho por grupo e por guarnição no período [de, ate] (datas do turno).
    async function resumo(de, ate) {
        await garantirDados();
        const lista = REG.filter(r => { const t = parseData(r.turno); return t >= de && t <= ate; });
        const turnos = { A: 0, B: 0, C: 0, D: 0 };
        for (let d = new Date(de); d <= ate; d.setDate(d.getDate() + 1)) turnos[grupoDoDia(d)]++;
        const totTurnos = Object.values(turnos).reduce((s, x) => s + x, 0) || 1;
        const grupos = GRUPOS.map(g => { const m = metricas(lista.filter(r => r.grupo === g)); return { grupo: g, turnos: turnos[g], porTurno: turnos[g] ? m.total / turnos[g] : 0, ...m }; });
        const por = {};
        lista.forEach(r => { (por[r.equipe] = por[r.equipe] || []).push(r); });
        guarnicoesEscala().forEach(g => { por[g.sigla] = por[g.sigla] || []; });
        const guarnicoes = Object.entries(por).map(([e, l]) => { const m = metricas(l); return { guarnicao: e, porTurno: m.total / totTurnos, estimada: /pela área/.test(e), ...m }; })
            .sort((a, b) => b.total - a.total);
        return { de, ate, total: lista.length, turnos, grupos, guarnicoes, atribuicaoEstimadaPct: lista.length ? lista.filter(r => r.fonte === 'area').length / lista.length * 100 : 0 };
    }
    window.DesempenhoGuarnicoes = { abrir, resumo, grupoDe, guarnicoes: async () => { await garantirEscala(); return guarnicoesEscala(); }, _sigla: sigla, _grupoDoDia: d => { if (!ANCORA) montarAncora(); return grupoDoDia(d); } };
})();
