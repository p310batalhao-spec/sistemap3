// ════════════════════════════════════════════════════════════════════
// DASHBOARD CRUZADO — visão consolidada por categoria (MVI/CVLI, TCO,
// Armas, Drogas, Visita Orientativa, Perturbação do Sossego, Violência
// Doméstica), com filtro cruzado (clicar num gráfico filtra os demais
// da mesma aba), comparativo ano anterior x atual e filtros manuais de
// período, COP, nome e cidade.
//
// A regra de contagem de MVI é a MESMA usada em js/index.js
// (atualizarContagemHomicidiosFirebase): ano atual + (HOMICÍDIO sem
// "tentativa" OU tentativa com OBITO = "S"). Não reinventar essa regra
// em outro lugar — se precisar mudar o critério de MVI, mudar aqui E
// em js/index.js.
// ════════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    let DATABASE_URL = null;
    let APPS_SCRIPT_TCO_URL = null;

    if (window.ChartDataLabels) Chart.register(ChartDataLabels);

    // ── Helpers genéricos ────────────────────────────────────────────
    function NORM(s) {
        return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
    }
    function CAMPO(item, ...chaves) {
        for (const k of chaves) {
            const v = item[k];
            if (v !== undefined && v !== null && v !== '') return String(v);
        }
        return '';
    }
    function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    // Parser de data tolerante — cobre AAAA-MM-DD, DD/MM/AAAA e strings
    // de Date() genéricas (mesma necessidade já resolvida em
    // qualitativo_tco.html/calendario.html para os mesmos tipos de dado).
    function parseData(str) {
        if (!str) return null;
        const s = String(str).trim();
        if (!s || s === '---') return null;
        let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) { const d = new Date(+m[1], +m[2] - 1, +m[3]); return isNaN(d) ? null : d; }
        m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (m) { const d = new Date(+m[3], +m[2] - 1, +m[1]); return isNaN(d) ? null : d; }
        const d = new Date(s);
        return isNaN(d.getTime()) ? null : d;
    }

    // ── Regra oficial de MVI (idêntica a js/index.js) ─────────────────
    function isMVI(item) {
        const tip = NORM(CAMPO(item, 'TIPIFICACAO_GERAL', 'TIPIFICACAO'));
        const ehHomicidio = tip.includes('HOMICIDIO') && !tip.includes('TENTATIVA');
        const ehTentativa = tip.includes('TENTATIVA');
        const temObito = NORM(item.OBITO) === 'S';
        return ehHomicidio || (ehTentativa && temObito);
    }

    // ── Movimentação do TCO vem como "STATUS (dd/mm/aaaa)" — mesma
    // correção feita em relatorio_quantitativo_tco.html ──────────────
    function movBase(mov) {
        return String(mov || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    }

    // ════════════════════════════════════════════════════════════════
    // CAMADA DE DADOS — cache em memória por nó (evita buscar /geral
    // duas vezes para MVI e Visita, que compartilham o mesmo nó)
    // ════════════════════════════════════════════════════════════════
    window._NODES_CACHE = {};

    async function fetchNode(node) {
        if (window._NODES_CACHE[node]) return window._NODES_CACHE[node];
        const resp = await fetch(`${DATABASE_URL}/${node}.json`);
        const dados = resp.ok ? await resp.json() : null;
        const lista = dados ? Object.values(dados) : [];
        window._NODES_CACHE[node] = lista;
        return lista;
    }

    async function fetchTCO() {
        if (window._NODES_CACHE.__tco) return window._NODES_CACHE.__tco;
        const resp = await fetch(`${APPS_SCRIPT_TCO_URL}?action=getTCO`, { redirect: 'follow' });
        const json = await resp.json();
        const lista = Array.isArray(json) ? json : [];
        window._NODES_CACHE.__tco = lista;
        return lista;
    }

    // ════════════════════════════════════════════════════════════════
    // DESCRITORES DE CATEGORIA — um único motor de render reaproveitado
    // pelas 7 abas; cada categoria só declara como ler seus campos.
    // ════════════════════════════════════════════════════════════════
    const CATEGORIAS = {
        mvicvli: {
            label: 'MVI e CVLI', icone: '🔪',
            fetch: () => fetchNode('geral'),
            // Universo de CVLI = mesmo filtro usado em page/mvi.html (o
            // cadastro de CVLI de fato): tipificação contém HOMICIDIO ou FEMINI.
            filtroBase: item => { const t = NORM(CAMPO(item, 'TIPIFICACAO_GERAL', 'TIPIFICACAO')); return t.includes('HOMICIDIO') || t.includes('FEMINI'); },
            campoData: item => CAMPO(item, 'DATA', 'data'),
            campoCidade: item => CAMPO(item, 'CIDADE'),
            campoCop: item => CAMPO(item, 'BOLETIM'),
            campoNome: item => CAMPO(item, 'SOLICITANTE'),
            campoTip: item => CAMPO(item, 'TIPIFICACAO_GERAL', 'TIPIFICACAO') || 'Não informado',
            campoStatus: item => CAMPO(item, 'SOLUCAO', 'SOLUÇÃO') || 'Não informado',
            labelTip: 'Tipificação', labelStatus: 'Solução',
            kpiExtra: lista => ({ label: 'MVI no período', valor: lista.filter(isMVI).length }),
            iconeExtra: '💀',
        },
        tco: {
            label: 'TCO', icone: '📋',
            fetch: () => fetchTCO(),
            filtroBase: () => true,
            campoData: item => CAMPO(item, 'DATA'),
            campoCidade: null,
            campoCop: item => CAMPO(item, 'Nº Ocorrência', 'BOLETIM'),
            campoNome: null,
            campoTip: item => CAMPO(item, 'Tipicidade Geral', 'TIPIFICACAO') || 'Não informado',
            campoStatus: item => movBase(CAMPO(item, 'Movimentação', 'Movimentacao', 'MOVIMENTACAO')) || 'Sem Movimentação',
            labelTip: 'Tipicidade', labelStatus: 'Movimentação (status)',
            kpiExtra: lista => {
                const concl = lista.filter(i => { const m = NORM(movBase(CAMPO(i, 'Movimentação', 'Movimentacao', 'MOVIMENTACAO'))); return m === 'ARQUIVADO' || m === 'JULGADO'; }).length;
                return { label: 'Concluídos (arquiv./julg.)', valor: concl };
            },
            iconeExtra: '✅',
        },
        armas: {
            label: 'Armas Apreendidas', icone: '🔫',
            fetch: () => fetchNode('arma'),
            filtroBase: () => true,
            campoData: item => CAMPO(item, 'DATA'),
            campoCidade: item => CAMPO(item, 'CIDADE'),
            campoCop: item => CAMPO(item, 'BOLETIM'),
            campoNome: null,
            campoTip: item => CAMPO(item, 'TIPO_ARMA') || 'Não informado',
            campoStatus: null,
            labelTip: 'Tipo de Arma', labelStatus: null,
        },
        drogas: {
            label: 'Drogas', icone: '💊',
            fetch: () => fetchNode('droga'),
            filtroBase: () => true,
            campoData: item => CAMPO(item, 'DATA'),
            campoCidade: item => CAMPO(item, 'CIDADE'),
            campoCop: item => CAMPO(item, 'BOLETIM'),
            campoNome: item => CAMPO(item, 'AUTOR', 'NOME DO AUTOR'),
            campoTip: item => CAMPO(item, 'TIPO_DROGA', 'TIPO') || 'Não informado',
            campoStatus: item => CAMPO(item, 'SOLUÇÃO', 'SOLUCAO') || 'Não informado',
            labelTip: 'Tipo de Droga', labelStatus: 'Solução',
            kpiExtra: lista => {
                let soma = 0;
                lista.forEach(i => { const n = parseFloat(String(CAMPO(i, 'QUANTIDADE', 'PESO') || '0').replace(',', '.')); if (!isNaN(n)) soma += n; });
                const txt = soma >= 1000 ? (soma / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 3 }) + ' Kg' : soma.toLocaleString('pt-BR', { minimumFractionDigits: 3 }) + ' g';
                return { label: 'Peso apreendido', valor: txt };
            },
            iconeExtra: '⚖️',
        },
        visita: {
            label: 'Visita Orientativa', icone: '🏠',
            fetch: () => fetchNode('geral'),
            filtroBase: item => NORM(CAMPO(item, 'TIPIFICACAO_GERAL', 'TIPIFICACAO', 'TIPIFICAÇÃO')).includes('VISITA'),
            campoData: item => CAMPO(item, 'DATA', 'data'),
            campoCidade: item => CAMPO(item, 'CIDADE'),
            campoCop: item => CAMPO(item, 'NUMEROOCORRENCIA', 'BOLETIM'),
            campoNome: item => CAMPO(item, 'NOME_AUTOR'),
            campoTip: item => CAMPO(item, 'TIPIFICACAO_GERAL', 'TIPIFICACAO', 'TIPIFICAÇÃO') || 'Não informado',
            campoStatus: item => CAMPO(item, 'SOLUÇÃO', 'SOLUCAO') || 'Não informado',
            labelTip: 'Tipificação de origem', labelStatus: 'Solução',
        },
        perturbacao: {
            label: 'Perturbação do Sossego', icone: '🔊',
            fetch: () => fetchNode('sossego'),
            filtroBase: item => { const t = NORM(CAMPO(item, 'TIPIFICAÇÃO', 'TIPIFICACAO')); return t.includes('PERTURBACAO') && !t.includes('VISITA'); },
            campoData: item => CAMPO(item, 'DATA', 'data'),
            campoCidade: item => CAMPO(item, 'CIDADE'),
            campoCop: item => CAMPO(item, 'NUMEROOCORRENCIA', 'BOLETIM'),
            campoNome: item => CAMPO(item, 'SOLICITANTE'),
            campoTip: item => CAMPO(item, 'TIPIFICAÇÃO', 'TIPIFICACAO') || 'Não informado',
            campoStatus: item => CAMPO(item, 'SOLUÇÃO', 'SOLUCAO') || 'Não informado',
            labelTip: 'Tipificação', labelStatus: 'Solução',
        },
        violencia: {
            label: 'Violência Doméstica', icone: '🛡️',
            fetch: () => fetchNode('violencia_domestica'),
            filtroBase: item => { const t = NORM(CAMPO(item, 'TIPIFICAÇÃO', 'TIPIFICACAO')); return t.includes('VIOLENCIA') && !t.includes('VISITA'); },
            campoData: item => CAMPO(item, 'DATA', 'data'),
            campoCidade: item => CAMPO(item, 'CIDADE'),
            campoCop: item => CAMPO(item, 'NUMEROOCORRENCIA', 'BOLETIM'),
            campoNome: item => CAMPO(item, 'SOLICITANTE'),
            campoTip: item => CAMPO(item, 'TIPIFICAÇÃO', 'TIPIFICACAO') || 'Não informado',
            campoStatus: item => CAMPO(item, 'SOLUÇÃO DA OCORRÊNCIA', 'SOLUÇÃO', 'SOLUCAO') || 'Não informado',
            labelTip: 'Tipificação', labelStatus: 'Solução',
        },
    };

    const ORDEM_ABAS = ['mvicvli', 'tco', 'armas', 'drogas', 'visita', 'perturbacao', 'violencia'];

    // ════════════════════════════════════════════════════════════════
    // ESTADO — filtros manuais e cross-filter, por aba
    // ════════════════════════════════════════════════════════════════
    window._DADOS_CAT = {};      // cache: { [cat]: registros já com filtroBase aplicado }
    window._CROSS = {};          // { [cat]: { mes, cidade, tip, status } }
    window._ABA_ATIVA = ORDEM_ABAS[0];
    window._ABAS_CARREGADAS = {};

    function crossDoAba(cat) {
        if (!window._CROSS[cat]) window._CROSS[cat] = { mes: null, cidade: null, tip: null, status: null };
        return window._CROSS[cat];
    }

    function filtrosManuais() {
        return {
            ini: document.getElementById('f-periodo-ini')?.value || '',
            fim: document.getElementById('f-periodo-fim')?.value || '',
            cop: NORM(document.getElementById('f-cop')?.value || ''),
            nome: NORM(document.getElementById('f-nome')?.value || ''),
            cidade: NORM(document.getElementById('f-cidade')?.value || ''),
        };
    }

    // Aplica filtros manuais (período/COP/nome/cidade) — não depende da aba.
    function aplicarFiltrosManuais(lista, cat) {
        const d = CATEGORIAS[cat];
        const f = filtrosManuais();
        return lista.filter(item => {
            if (f.ini || f.fim) {
                const dt = parseData(d.campoData(item));
                if (!dt) return false;
                const iso = dt.toISOString().substring(0, 10);
                if (f.ini && iso < f.ini) return false;
                if (f.fim && iso > f.fim) return false;
            }
            // Campos ausentes na categoria (ex.: TCO não tem cidade/nome) não
            // devem "zerar" a lista — o filtro só se aplica quando o campo existe.
            if (f.cop && d.campoCop && !NORM(d.campoCop(item)).includes(f.cop)) return false;
            if (f.nome && d.campoNome && !NORM(d.campoNome(item)).includes(f.nome)) return false;
            if (f.cidade && d.campoCidade && !NORM(d.campoCidade(item)).includes(f.cidade)) return false;
            return true;
        });
    }

    // Aplica o cross-filter da aba (clique em gráfico), exceto a própria
    // dimensão de origem — mesmo princípio do js/dashboard-p3.js: o
    // gráfico que originou o clique continua mostrando a distribuição
    // inteira, pra dar pra clicar em outra fatia ou desfazer.
    function aplicarCross(lista, cat, exceto) {
        const d = CATEGORIAS[cat];
        const c = crossDoAba(cat);
        let r = lista;
        if (c.mes && exceto !== 'mes') r = r.filter(i => { const dt = parseData(d.campoData(i)); return dt && (dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0')) === c.mes; });
        if (c.cidade && exceto !== 'cidade' && d.campoCidade) r = r.filter(i => NORM(d.campoCidade(i)) === NORM(c.cidade));
        if (c.tip && exceto !== 'tip') r = r.filter(i => NORM(d.campoTip(i)) === NORM(c.tip));
        if (c.status && exceto !== 'status' && d.campoStatus) r = r.filter(i => NORM(d.campoStatus(i)) === NORM(c.status));
        return r;
    }

    function toggleCross(cat, campo, valor) {
        const c = crossDoAba(cat);
        c[campo] = c[campo] === valor ? null : valor;
        renderAba(cat);
    }
    window.toggleCross = toggleCross;

    function limparCross(cat) {
        window._CROSS[cat] = { mes: null, cidade: null, tip: null, status: null };
        renderAba(cat);
    }
    window.limparCrossDash = limparCross;

    function limparFiltrosManuais() {
        ['f-periodo-ini', 'f-periodo-fim', 'f-cop', 'f-nome', 'f-cidade'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        renderAba(window._ABA_ATIVA);
    }
    window.limparFiltrosManuaisDash = limparFiltrosManuais;

    // ════════════════════════════════════════════════════════════════
    // CORES DO TEMA (claro/escuro) — mesma abordagem de
    // relatorio_quantitativo_tco.html
    // ════════════════════════════════════════════════════════════════
    function coresTema() {
        const cs = getComputedStyle(document.documentElement);
        return {
            text: (cs.getPropertyValue('--p3-text') || '#1c1c1a').trim(),
            muted: (cs.getPropertyValue('--p3-text-muted') || '#7a7a72').trim(),
            grid: (cs.getPropertyValue('--p3-border') || '#e5e3dc').trim(),
        };
    }
    const PALETA = ['#2f5fdd', '#12719c', '#2f8f5b', '#b5860a', '#c0392b', '#5b21b6', '#0891b2', '#be185d', '#7592e8', '#166534', '#92400e', '#4c1d95'];

    window._CHARTS = {};
    function destruirChart(id) { if (window._CHARTS[id]) { window._CHARTS[id].destroy(); delete window._CHARTS[id]; } }

    // ════════════════════════════════════════════════════════════════
    // AGREGAÇÕES
    // ════════════════════════════════════════════════════════════════
    const MESES_LBL = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

    function agregarPorMesAno(lista, campoData, ano) {
        const contagem = new Array(12).fill(0);
        lista.forEach(item => {
            const dt = parseData(campoData(item));
            if (dt && dt.getFullYear() === ano) contagem[dt.getMonth()]++;
        });
        return contagem;
    }

    function topEntries(lista, campoFn, n) {
        const cont = {};
        lista.forEach(item => { const v = campoFn(item); if (v) cont[v] = (cont[v] || 0) + 1; });
        return Object.entries(cont).sort((a, b) => b[1] - a[1]).slice(0, n || 8);
    }

    // ════════════════════════════════════════════════════════════════
    // CONSTRUTORES DE GRÁFICO GENÉRICOS
    // ════════════════════════════════════════════════════════════════
    function criarSerieMensal(canvasId, dados, cor, cores) {
        destruirChart(canvasId);
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;
        window._CHARTS[canvasId] = new Chart(ctx, {
            type: 'bar',
            data: { labels: MESES_LBL, datasets: [{ label: 'Registros', data: dados, backgroundColor: cor, borderRadius: 5, maxBarThickness: 34 }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, datalabels: { color: cores.text, anchor: 'end', align: 'top', font: { weight: 'bold', size: 10 } } },
                scales: {
                    x: { ticks: { color: cores.muted, font: { size: 10 } }, grid: { display: false } },
                    y: { beginAtZero: true, ticks: { color: cores.muted, precision: 0 }, grid: { color: cores.grid } }
                }
            }
        });
    }

    function criarBarraHorizontal(canvasId, entries, cores, cat, campoCross) {
        destruirChart(canvasId);
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;
        const labels = entries.map(e => e[0]);
        const dados = entries.map(e => e[1]);
        const cor = labels.map((_, i) => PALETA[i % PALETA.length]);
        // Headroom no eixo X — sem isso o rótulo de valor da maior barra
        // (align:'right') fica cortado na borda direita do gráfico.
        const maxValor = dados.length ? Math.max(...dados) : 0;
        window._CHARTS[canvasId] = new Chart(ctx, {
            type: 'bar',
            data: { labels, datasets: [{ label: 'Registros', data: dados, backgroundColor: cor, borderRadius: 5 }] },
            options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                onClick: (evt, els) => { if (!els.length) return; toggleCross(cat, campoCross, labels[els[0].index]); },
                layout: { padding: { right: 24 } },
                plugins: {
                    legend: { display: false },
                    datalabels: { color: cores.text, anchor: 'end', align: 'right', clamp: true, font: { weight: 'bold', size: 10 } }
                },
                scales: {
                    x: { beginAtZero: true, suggestedMax: Math.ceil(maxValor * 1.15) || 1, ticks: { color: cores.muted, precision: 0 }, grid: { color: cores.grid } },
                    y: { ticks: { color: cores.muted, font: { size: 10.5 } }, grid: { display: false } }
                }
            }
        });
    }

    function criarSerieClicavel(canvasId, dados, cor, cores, cat, ano) {
        destruirChart(canvasId);
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;
        window._CHARTS[canvasId] = new Chart(ctx, {
            type: 'bar',
            data: { labels: MESES_LBL, datasets: [{ label: 'Registros', data: dados, backgroundColor: cor, borderRadius: 5, maxBarThickness: 34 }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                onClick: (evt, els) => { if (!els.length) return; const mes = ano + '-' + String(els[0].index + 1).padStart(2, '0'); toggleCross(cat, 'mes', mes); },
                plugins: { legend: { display: false }, datalabels: { color: cores.text, anchor: 'end', align: 'top', font: { weight: 'bold', size: 10 } } },
                scales: {
                    x: { ticks: { color: cores.muted, font: { size: 10 } }, grid: { display: false } },
                    y: { beginAtZero: true, ticks: { color: cores.muted, precision: 0 }, grid: { color: cores.grid } }
                }
            }
        });
    }

    // ════════════════════════════════════════════════════════════════
    // RENDER DE UMA ABA
    // ════════════════════════════════════════════════════════════════
    async function renderAba(cat) {
        const cont = document.getElementById('conteudo-' + cat);
        if (!cont) return;
        const d = CATEGORIAS[cat];

        if (!window._DADOS_CAT[cat]) {
            cont.innerHTML = '<div class="vz-dc"><div class="vi">⏳</div><div class="vt">Carregando dados...</div></div>';
            try {
                const bruto = await d.fetch();
                window._DADOS_CAT[cat] = bruto.filter(d.filtroBase);
            } catch (e) {
                cont.innerHTML = '<div class="vz-dc"><div class="vi">⚠️</div><div class="vt">Erro ao carregar: ' + esc(e.message) + '</div></div>';
                return;
            }
        }

        const base = aplicarFiltrosManuais(window._DADOS_CAT[cat], cat);
        const cores = coresTema();
        const anoAtual = new Date().getFullYear();
        const anoAnterior = anoAtual - 1;

        // Monta o esqueleto uma única vez; nas próximas chamadas só troca dados/gráficos.
        if (!cont.dataset.montado) {
            cont.innerHTML = mkEsqueletoAba(cat, d);
            cont.dataset.montado = '1';
        }
        renderChipsDaAba(cat);

        // ── KPIs (ano atual x anterior, com variação) ──────────────
        const semCrossParaKpi = aplicarCross(base, cat, null);
        const totalAtual = semCrossParaKpi.filter(i => { const dt = parseData(d.campoData(i)); return dt && dt.getFullYear() === anoAtual; }).length;
        const totalAnterior = semCrossParaKpi.filter(i => { const dt = parseData(d.campoData(i)); return dt && dt.getFullYear() === anoAnterior; }).length;
        const variacao = totalAnterior > 0 ? Math.round((totalAtual - totalAnterior) / totalAnterior * 100) : (totalAtual > 0 ? 100 : 0);
        const kpiEl = document.getElementById('kpis-' + cat);
        if (kpiEl) {
            let h = '';
            h += mkKpi('⏮️', totalAnterior, 'Ano Anterior · ' + anoAnterior);
            h += mkKpi('🗓️', totalAtual, 'Ano Atual · ' + anoAtual);
            const setaCls = variacao > 0 ? 'alta' : variacao < 0 ? 'baixa' : 'estavel';
            const setaIc = variacao > 0 ? '📈' : variacao < 0 ? '📉' : '➡️';
            h += '<div class="kpi-dc kpi-var-' + setaCls + '"><div class="ki">' + setaIc + '</div><div class="kn">' + (variacao > 0 ? '+' : '') + variacao + '%</div><div class="kl">Variação vs. ano anterior</div></div>';
            if (d.kpiExtra) { const ex = d.kpiExtra(semCrossParaKpi.filter(i => { const dt = parseData(d.campoData(i)); return dt && dt.getFullYear() === anoAtual; })); h += mkKpi(d.iconeExtra || '⭐', ex.valor, ex.label); }
            kpiEl.innerHTML = h;
        }

        // ── Duas séries temporais (ano anterior / ano atual) ───────
        const listaSerie = aplicarCross(base, cat, 'mes');
        criarSerieClicavel('chart-' + cat + '-serieAnt', agregarPorMesAno(listaSerie, d.campoData, anoAnterior), '#7592e8', cores, cat, anoAnterior);
        criarSerieClicavel('chart-' + cat + '-serieAtu', agregarPorMesAno(listaSerie, d.campoData, anoAtual), '#2f5fdd', cores, cat, anoAtual);

        // ── Top Cidades ─────────────────────────────────────────────
        if (d.campoCidade) {
            const listaCidade = aplicarCross(base, cat, 'cidade');
            criarBarraHorizontal('chart-' + cat + '-cidade', topEntries(listaCidade, d.campoCidade, 8), cores, cat, 'cidade');
        }

        // ── Tipificação/Tipo ─────────────────────────────────────────
        const listaTip = aplicarCross(base, cat, 'tip');
        criarBarraHorizontal('chart-' + cat + '-tip', topEntries(listaTip, d.campoTip, 8), cores, cat, 'tip');

        // ── Status/Solução ───────────────────────────────────────────
        if (d.campoStatus) {
            const listaStatus = aplicarCross(base, cat, 'status');
            criarBarraHorizontal('chart-' + cat + '-status', topEntries(listaStatus, d.campoStatus, 8), cores, cat, 'status');
        }
    }
    window.renderAbaDash = renderAba;

    function mkKpi(icone, valor, label) {
        return '<div class="kpi-dc"><div class="ki">' + icone + '</div><div class="kn">' + valor + '</div><div class="kl">' + esc(String(label)) + '</div></div>';
    }

    function mkEsqueletoAba(cat, d) {
        let h = '<div class="kpi-row-dc" id="kpis-' + cat + '"></div>';
        h += '<div class="chips-dc" id="chips-' + cat + '"></div>';
        h += '<div class="graficos-grid-dc">';
        h += mkCardGrafico('chart-' + cat + '-serieAnt', '📅 Série Temporal — Ano Anterior');
        h += mkCardGrafico('chart-' + cat + '-serieAtu', '📌 Série Temporal — Ano Atual');
        if (d.campoCidade) h += mkCardGrafico('chart-' + cat + '-cidade', '📍 Top Cidades (clique filtra as demais)');
        h += mkCardGrafico('chart-' + cat + '-tip', '🏷️ ' + d.labelTip + ' (clique filtra as demais)');
        if (d.campoStatus) h += mkCardGrafico('chart-' + cat + '-status', '✅ ' + d.labelStatus + ' (clique filtra as demais)');
        h += '</div>';
        return h;
    }

    function mkCardGrafico(canvasId, titulo) {
        return '<div class="grafico-card-dc"><div class="grafico-titulo-dc">' + titulo + '</div>' +
            '<div class="grafico-wrap-dc"><canvas id="' + canvasId + '"></canvas></div></div>';
    }

    function renderChipsDaAba(cat) {
        const el = document.getElementById('chips-' + cat);
        if (!el) return;
        const c = crossDoAba(cat);
        const f = filtrosManuais();
        const chips = [];
        if (c.mes) chips.push({ label: 'Mês: ' + c.mes, fn: () => toggleCross(cat, 'mes', c.mes) });
        if (c.cidade) chips.push({ label: 'Cidade: ' + c.cidade, fn: () => toggleCross(cat, 'cidade', c.cidade) });
        if (c.tip) chips.push({ label: CATEGORIAS[cat].labelTip + ': ' + c.tip, fn: () => toggleCross(cat, 'tip', c.tip) });
        if (c.status) chips.push({ label: (CATEGORIAS[cat].labelStatus || 'Status') + ': ' + c.status, fn: () => toggleCross(cat, 'status', c.status) });

        if (!chips.length && !f.ini && !f.fim && !f.cop && !f.nome && !f.cidade) { el.innerHTML = ''; return; }

        window._CHIPS_TMP = window._CHIPS_TMP || {};
        window._CHIPS_TMP[cat] = chips;

        let h = '<span class="chips-label-dc">Filtros ativos (clique num gráfico de novo pra desfazer):</span>';
        chips.forEach((chip, i) => {
            h += '<span class="chip-dc" onclick="window._CHIPS_TMP[\'' + cat + '\'][' + i + '].fn()">' + esc(chip.label) + ' <b>✕</b></span>';
        });
        if (f.ini || f.fim || f.cop || f.nome || f.cidade) {
            h += '<button class="chip-limpar-dc" onclick="limparFiltrosManuaisDash()">✕ Limpar filtros manuais</button>';
        }
        if (chips.length) {
            h += '<button class="chip-limpar-dc" onclick="limparCrossDash(\'' + cat + '\')">✕ Limpar cruzamento</button>';
        }
        el.innerHTML = h;
    }

    // ════════════════════════════════════════════════════════════════
    // RELATÓRIO P3 — relatorios/relatorio_p3.html não busca dados
    // sozinho: ele só lê localStorage.p3_relatorio. A versão antiga
    // mandava os registros BRUTOS (centenas de milhares de caracteres),
    // o que estourava a cota do localStorage (~5-10MB, e cresce com o
    // tempo). Aqui já mandamos os números PRONTOS (totais, série de 12
    // meses, top 8 por categoria) — poucos KB, sem risco de cota, e é
    // exatamente o que os dois modos do relatório (slides/retrato) precisam
    // pra desenhar os gráficos sem reprocessar nada.
    //
    // Classificação de CVLI/MVI usa as MESMAS regras das abas do dashboard
    // (isMVI = regra oficial do index.js). CVP usa o mesmo filtro de
    // page/cvp.html (ROUBO/FURTO/EXTORSÃO/LATROCÍNIO/...).
    // ════════════════════════════════════════════════════════════════
    const TERMOS_CVP = ['ROUBO', 'FURTO', 'TENTATIVA DE ROUBO', 'TENTATIVA DE FURTO', 'ESTELIONATO', 'DANO', 'LATROCINIO', 'EXTORSAO', 'APROPRIACAO'];
    function isCVP(item) {
        const t = NORM(CAMPO(item, 'TIPIFICACAO_GERAL', 'TIPIFICACAO'));
        return TERMOS_CVP.some(termo => t.includes(termo));
    }

    function buildMeses12() {
        const agora = new Date();
        const meses = [];
        for (let i = 11; i >= 0; i--) {
            const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
            meses.push({ label: String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(), chave: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') });
        }
        return meses;
    }
    function contarPorMes12(arr, meses) {
        const cnt = {};
        arr.forEach(item => {
            const d = parseData(CAMPO(item, 'DATA', 'data'));
            if (!d) return;
            const chave = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
            cnt[chave] = (cnt[chave] || 0) + 1;
        });
        return meses.map(m => cnt[m.chave] || 0);
    }
    function porDiaSemana(arr) {
        const cont = new Array(7).fill(0);
        arr.forEach(item => { const d = parseData(CAMPO(item, 'DATA', 'data')); if (d) cont[d.getDay()]++; });
        return cont;
    }

    async function montarResumoRelatorio() {
        const [geral, cvpBruto, arma, droga, tcoFirebase, vd, sossego] = await Promise.all([
            fetchNode('geral'), fetchNode('cvp'), fetchNode('arma'), fetchNode('droga'),
            fetchNode('tco'), fetchNode('violencia_domestica'), fetchNode('sossego')
        ]);
        const visitas = geral.filter(i => NORM(CAMPO(i, 'TIPIFICACAO', 'TIPIFICACAO_GERAL')).includes('VISITA'));

        const meses = buildMeses12();
        const mesesLabels = meses.map(m => m.label);

        const cvliArr = geral.filter(i => { const t = NORM(CAMPO(i, 'TIPIFICACAO_GERAL', 'TIPIFICACAO')); return t.includes('HOMICIDIO') || t.includes('FEMINI'); });
        const mviArr = geral.filter(isMVI);
        const cvpArr = cvpBruto.filter(isCVP);

        const campoTip = i => CAMPO(i, 'TIPIFICACAO_GERAL', 'TIPIFICACAO') || 'Não informado';
        const campoCidade = i => CAMPO(i, 'CIDADE') || 'Não informado';

        // Tabela: só os campos necessários dos 40 CVLI mais recentes (leve, não é o array bruto inteiro)
        const tabelaCvli = cvliArr.slice()
            .sort((a, b) => { const da = parseData(CAMPO(a, 'DATA', 'data')) || new Date(0); const db = parseData(CAMPO(b, 'DATA', 'data')) || new Date(0); return db - da; })
            .slice(0, 40)
            .map(doc => ({
                boletim: CAMPO(doc, 'BOLETIM'), data: CAMPO(doc, 'DATA', 'data'), hora: CAMPO(doc, 'HORA'),
                tip: campoTip(doc), bairro: CAMPO(doc, 'BAIRRO', 'bairro'), cidade: campoCidade(doc),
                solicitante: CAMPO(doc, 'SOLICITANTE'), solucao: doc['SOLUÇÃO'] || doc.SOLUCAO || '',
                obito: NORM(doc.OBITO) === 'S' ? 'S' : 'N', mvi: isMVI(doc),
            }));

        const cidadeGeralMap = {};
        [...cvliArr, ...cvpArr, ...mviArr, ...vd].forEach(i => { const c = campoCidade(i); cidadeGeralMap[c] = (cidadeGeralMap[c] || 0) + 1; });

        let somaDroga = 0;
        const drogaPorTipoMap = {};
        droga.forEach(d => {
            const t = CAMPO(d, 'TIPO_DROGA', 'TIPO') || 'Não informado';
            const q = parseFloat(String(CAMPO(d, 'QUANTIDADE', 'PESO') || '0').replace(',', '.'));
            if (!isNaN(q)) { drogaPorTipoMap[t] = (drogaPorTipoMap[t] || 0) + q; somaDroga += q; }
        });

        const grad = localStorage.getItem('userGraduacao') || '';
        const nome = localStorage.getItem('userNomeGuerra') || '';

        return {
            operador: (grad + ' ' + nome).trim(),
            periodo: 'Últimos 12 meses',
            geradoEm: new Date().toLocaleString('pt-BR'),
            mesesLabels,
            cvli: { total: cvliArr.length, porMes: contarPorMes12(cvliArr, meses), porTip: topEntries(cvliArr, campoTip, 8), porCidade: topEntries(cvliArr, campoCidade, 8), porDiaSemana: porDiaSemana(cvliArr), tabela: tabelaCvli },
            mvi: { total: mviArr.length, porMes: contarPorMes12(mviArr, meses), porTip: topEntries(mviArr, campoTip, 8), porDiaSemana: porDiaSemana(mviArr), tentativasComObito: mviArr.filter(i => NORM(CAMPO(i, 'TIPIFICACAO_GERAL', 'TIPIFICACAO')).includes('TENTATIVA')).length },
            cvp: { total: cvpArr.length, porMes: contarPorMes12(cvpArr, meses), porTip: topEntries(cvpArr, campoTip, 8), porCidade: topEntries(cvpArr, campoCidade, 8), porDiaSemana: porDiaSemana(cvpArr) },
            vd: { total: vd.length, porMes: contarPorMes12(vd, meses) },
            tco: { total: tcoFirebase.length, porMes: contarPorMes12(tcoFirebase, meses) },
            arma: { total: arma.length, porTipo: topEntries(arma, i => CAMPO(i, 'TIPO_ARMA') || 'Não informado', 8) },
            droga: { totalRegistros: droga.length, somaPeso: somaDroga, porTipo: Object.entries(drogaPorTipoMap).sort((a, b) => b[1] - a[1]).slice(0, 8) },
            sossego: { total: sossego.length, porMes: contarPorMes12(sossego, meses) },
            visitas: { total: visitas.length, porMes: contarPorMes12(visitas, meses), porCidade: topEntries(visitas, campoCidade, 8) },
            cidadeGeral: Object.entries(cidadeGeralMap).sort((a, b) => b[1] - a[1]).slice(0, 10),
        };
    }

    async function abrirRelatorioP3(evt) {
        const btn = evt ? evt.currentTarget : null;
        const textoOriginal = btn ? btn.innerHTML : '';
        if (btn) { btn.innerHTML = '⏳ Preparando...'; btn.style.pointerEvents = 'none'; }
        try {
            const resumo = await montarResumoRelatorio();
            localStorage.removeItem('p3_relatorio');
            localStorage.setItem('p3_relatorio', JSON.stringify(resumo));
            window.open('../relatorios/relatorio_p3.html', '_blank');
        } catch (e) {
            console.error('Erro ao preparar relatório P3:', e);
            alert('Erro ao preparar os dados do relatório. Tente novamente.');
        } finally {
            if (btn) { btn.innerHTML = textoOriginal; btn.style.pointerEvents = ''; }
        }
    }
    window.abrirRelatorioP3 = abrirRelatorioP3;

    // ════════════════════════════════════════════════════════════════
    // ABAS — troca e inicialização
    // ════════════════════════════════════════════════════════════════
    function trocarAbaDash(cat) {
        window._ABA_ATIVA = cat;
        document.querySelectorAll('.tab-dc-btn').forEach(b => b.classList.toggle('ativo', b.dataset.cat === cat));
        document.querySelectorAll('.aba-dc').forEach(a => a.classList.toggle('ativa', a.id === 'aba-' + cat));
        atualizarDisponibilidadeFiltros(cat);
        renderAba(cat);
    }
    window.trocarAbaDash = trocarAbaDash;

    // Desliga (visualmente e funcionalmente) os campos Nome/Cidade quando a
    // categoria ativa não tem esse dado — evita o usuário digitar um filtro
    // que nunca vai encontrar nada e achar que o dashboard está com bug.
    function atualizarDisponibilidadeFiltros(cat) {
        const d = CATEGORIAS[cat];
        const nomeEl = document.getElementById('f-nome');
        const cidadeEl = document.getElementById('f-cidade');
        if (nomeEl) {
            nomeEl.disabled = !d.campoNome;
            nomeEl.placeholder = d.campoNome ? 'Autor/Solicitante' : 'Sem esse dado nesta aba';
            if (!d.campoNome) nomeEl.value = '';
        }
        if (cidadeEl) {
            cidadeEl.disabled = !d.campoCidade;
            cidadeEl.placeholder = d.campoCidade ? 'Cidade' : 'Sem esse dado nesta aba';
            if (!d.campoCidade) cidadeEl.value = '';
        }
    }

    function aplicarFiltrosGlobais() { renderAba(window._ABA_ATIVA); }
    window.aplicarFiltrosGlobaisDash = aplicarFiltrosGlobais;

    function montarTabs() {
        const tabsEl = document.getElementById('tabs-dc');
        const abasEl = document.getElementById('abas-dc');
        let hTabs = '', hAbas = '';
        ORDEM_ABAS.forEach((cat, i) => {
            const d = CATEGORIAS[cat];
            hTabs += '<button class="tab-dc-btn' + (i === 0 ? ' ativo' : '') + '" data-cat="' + cat + '" onclick="trocarAbaDash(\'' + cat + '\')">' + d.icone + ' ' + esc(d.label) + '</button>';
            hAbas += '<div class="aba-dc' + (i === 0 ? ' ativa' : '') + '" id="aba-' + cat + '"><div id="conteudo-' + cat + '"><div class="vz-dc"><div class="vi">⏳</div><div class="vt">Carregando dados...</div></div></div></div>';
        });
        tabsEl.innerHTML = hTabs;
        abasEl.innerHTML = hAbas;
    }

    // ── Relógio / login / tema (mesmo padrão das outras páginas) ────
    function atualizarRelogio() {
        const el = document.getElementById('relogio');
        if (!el) return;
        const agora = new Date();
        el.innerHTML = agora.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' }) + '<br>' + agora.toLocaleTimeString('pt-BR');
    }
    function checkLogin() {
        const graduacao = localStorage.getItem('userGraduacao');
        const nomeGuerra = localStorage.getItem('userNomeGuerra');
        const el = document.getElementById('user-info');
        if (graduacao && nomeGuerra && el) el.innerHTML = `<p>Bem Vindo(a):</p><p class="user-nome">${graduacao} ${nomeGuerra}</p>`;
    }
    function logout() {
        localStorage.removeItem('userGraduacao');
        localStorage.removeItem('userNomeGuerra');
        window.location.href = '../page/login.html';
    }

    document.addEventListener('DOMContentLoaded', async () => {
        atualizarRelogio();
        setInterval(atualizarRelogio, 1000);
        checkLogin();

        const btnLogout = document.getElementById('btn-logout');
        if (btnLogout) btnLogout.addEventListener('click', logout);

        document.querySelectorAll('#btn-tema').forEach(btn => {
            btn.addEventListener('click', () => setTimeout(() => renderAba(window._ABA_ATIVA), 50));
        });

        montarTabs();
        atualizarDisponibilidadeFiltros(ORDEM_ABAS[0]);

        const cfg = await P3.loadUnidadeConfig();
        DATABASE_URL = cfg.firebase.databaseURL;
        APPS_SCRIPT_TCO_URL = cfg.gas.TCO;

        renderAba(ORDEM_ABAS[0]);
    });
})();
