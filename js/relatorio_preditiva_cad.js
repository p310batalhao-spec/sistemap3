// ═══════════════════════════════════════════════════════════════════
// RELATÓRIO — Análise Preditiva CAD P3
// Lê dados do localStorage: chave 'p3_preditiva_cad', gravados por
// js/preditivaCAD.js:atualizarDadosRelatorioCAD_/abrirRelatorioCAD.
// Este script só RENDERIZA — todo o cálculo (previsões, acurácia,
// janela tática, hotspots, risco por local) já vem PRONTO no payload,
// calculado pelas MESMAS funções que alimentam a tela ao vivo, pra o
// relatório impresso nunca divergir do que o comandante já viu.
// ═══════════════════════════════════════════════════════════════════
Chart.register(ChartDataLabels);

const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const DIAS_SEMANA_ABREV = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const NOMES_MES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const NOMES_MES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const LABEL_CATEGORIA = { cvp: 'CVP', cvli: 'CVLI', mvi: 'MVI' };
const LABEL_RISCO = { alto: 'Alto', medio: 'Médio', baixo: 'Baixo' };

// ── Utilitários ──────────────────────────────────────────────────
function labelMes(chave) {
    if (!chave) return '—';
    const p = chave.split('-');
    return NOMES_MES_ABREV[+p[1] - 1] + '/' + p[0].slice(-2);
}
function nomeMesCompleto(chave) {
    if (!chave) return '—';
    const p = chave.split('-');
    return NOMES_MES[+p[1] - 1];
}
function proximaChaveMes(chave) {
    const p = chave.split('-');
    const d = new Date(+p[0], +p[1] - 1 + 1, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function fmtDataISO(str) {
    if (!str) return '—';
    const p = str.split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : str;
}
function parseDateStr(str) {
    if (!str || str === '---') return null;
    str = str.toString().trim().substring(0, 10);
    const mBR = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (mBR) return new Date(+mBR[3], +mBR[2] - 1, +mBR[1]);
    const mISO = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (mISO) return new Date(+mISO[1], +mISO[2] - 1, +mISO[3]);
    return null;
}
function media(arr) {
    const pos = (arr || []).filter(function (v) { return v > 0; });
    return pos.length ? Math.round(pos.reduce(function (a, b) { return a + b; }, 0) / pos.length) : 0;
}
// A grade do CAD sufixa a tipificação com "| CÓDIGO PENAL" (a Natureza
// Geral — CVP/CVLI/MVI já são, por definição, Código Penal) — remove
// pra caber no eixo do gráfico, mesmo critério de js/preditivaCAD.js.
function encurtarLabel(label) {
    const s = String(label || '').replace(/\s*\|\s*C[ÓO]DIGO\s+PENAL\s*$/i, '').trim();
    return s.length > 28 ? s.substring(0, 26) + '…' : s;
}

// ── Gráfico helper (mesmo padrão de js/relatorio_preditiva.js) ────
function mkChart(id, type, labels, datasets, opts) {
    opts = opts || {};
    const ctx = document.getElementById(id) && document.getElementById(id).getContext('2d');
    if (!ctx) return;
    new Chart(ctx, {
        type: type,
        data: { labels: labels, datasets: datasets },
        options: Object.assign({
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: opts.legend || { position: 'bottom', labels: { font: { size: 10 }, padding: 10 } },
                tooltip: { callbacks: { label: function (c) { return ' ' + (c.dataset.label || c.label) + ': ' + (c.parsed.y != null ? c.parsed.y : c.parsed); } } },
                datalabels: opts.datalabels || false,
            },
            scales: opts.scales,
        }, opts.extra || {}),
    });
}
const DL_BARH = { display: true, anchor: 'end', align: 'end', font: { size: 9, weight: 'bold' }, color: '#374263', formatter: function (v) { return v; } };
const DL_LINE = { display: function (ctx) { return ctx.dataset.data[ctx.dataIndex] > 0; }, align: 'top', anchor: 'end', font: { size: 8, weight: 'bold' }, color: function (ctx) { return ctx.dataset.borderColor; }, formatter: function (v) { return v; } };
const DL_BARV = { display: function (ctx) { return ctx.dataset.data[ctx.dataIndex] > 0; }, anchor: 'end', align: 'top', font: { size: 9, weight: 'bold' }, color: function (ctx) { return ctx.dataset.backgroundColor; }, formatter: function (v) { return v; } };

function renderHeatmap(id, contagens, r, g, b) {
    const max = Math.max.apply(null, contagens.concat([1]));
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = contagens.map(function (v, h) {
        const alpha = v === 0 ? 0 : Math.min(1, (v / max) * 1.3);
        const bg = v === 0 ? '#e9ecef' : 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
        const cor = v === 0 ? '#aaa' : alpha > 0.5 ? '#fff' : '#333';
        return '<div class="hora-cel" style="background:' + bg + ';color:' + cor + '" title="' + h + 'h — ' + v + ' ocorrência(s)">' + h + 'h</div>';
    }).join('');
}

// ═══════════════════════════════════════════════════════════════════
// INICIALIZAÇÃO
// ═══════════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', function () {
    const raw = localStorage.getItem('p3_preditiva_cad');
    if (!raw) {
        document.getElementById('loader').innerHTML =
            '<i class="fas fa-exclamation-triangle" style="color:#b71c1c;font-size:2rem;display:block;margin-bottom:12px;"></i>' +
            'Dados não encontrados.<br><small>Abra este relatório pelo botão <strong>"🖨️ Imprimir Relatório"</strong> na página de Análise Preditiva CAD.</small>';
        return;
    }

    let D;
    try { D = JSON.parse(raw); } catch (e) {
        document.getElementById('loader').textContent = 'Dados corrompidos — gere o relatório novamente.';
        return;
    }

    // ── Metadados ─────────────────────────────────────────────────
    const agora = new Date();
    const geradoEm = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) +
        ' às ' + agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    document.querySelectorAll('.cabecalho-unidade').forEach(function (el) { el.textContent = D.unidade || '10º BPM'; });
    document.getElementById('meta-data').innerHTML = '<i class="fas fa-calendar"></i> ' + geradoEm;
    document.getElementById('meta-operador').innerHTML = '<i class="fas fa-user"></i> ' + (D.operador || '—');
    document.getElementById('meta-periodo').innerHTML = '<i class="fas fa-chart-line"></i> ' + fmtDataISO(D.dataIni) + ' a ' + fmtDataISO(D.dataFim);
    document.getElementById('rodape-meta').innerHTML = 'Gerado em: ' + geradoEm + '<br>Operador: ' + (D.operador || '—');
    document.title = 'Relatório Preditivo CAD P3 — ' + agora.toLocaleDateString('pt-BR');

    const cvpArr = D.cvpArr || [], cvliArr = D.cvliArr || [], mviArr = D.mviArr || [];
    const labelsMensais = D.labelsMensais || [];
    const idxAtual = cvpArr.length - 1, idxAnt = cvpArr.length - 2;
    const cvpMes = cvpArr[idxAtual] || 0, cvliMes = cvliArr[idxAtual] || 0, mviMes = mviArr[idxAtual] || 0;
    const cvpAnt = cvpArr[idxAnt] || 0, cvliAnt = cvliArr[idxAnt] || 0, mviAnt = mviArr[idxAnt] || 0;

    // ══ SEÇÃO 1 — KPIs + ALERTAS ═══════════════════════════════════
    document.getElementById('kpi-grid').innerHTML =
        '<div class="kpi"><div class="kpi-valor">' + (D.totalOcorrencias || 0) + '</div><div class="kpi-label"><i class="fas fa-file-alt"></i> Ocorrências no período</div></div>' +
        '<div class="kpi"><div class="kpi-valor">' + (D.totalEnvolvidos || 0) + '</div><div class="kpi-label"><i class="fas fa-users"></i> Envolvidos/autores</div></div>' +
        '<div class="kpi"><div class="kpi-valor">' + (D.pctCoordValidas || '—') + '</div><div class="kpi-label"><i class="fas fa-map-marker-alt"></i> Coordenadas válidas</div></div>' +
        '<div class="kpi cvp"><div class="kpi-valor">' + (D.arrCVP || []).length + '</div><div class="kpi-pct">Média: ' + media(cvpArr) + '/mês</div><div class="kpi-label"><i class="fas fa-mask"></i> CVP Total</div></div>' +
        '<div class="kpi cvli"><div class="kpi-valor">' + (D.arrCVLI || []).length + '</div><div class="kpi-pct">Média: ' + media(cvliArr) + '/mês</div><div class="kpi-label"><i class="fas fa-skull"></i> CVLI Total</div></div>' +
        '<div class="kpi mvi"><div class="kpi-valor">' + (D.arrMVI || []).length + '</div><div class="kpi-pct">Média: ' + media(mviArr) + '/mês</div><div class="kpi-label"><i class="fas fa-skull-crossbones"></i> MVI Total</div></div>';

    function gerarAlerta(ind, atual, ant, prev, icone) {
        if (atual > ant * 1.2) return '<div class="insight perigo"><i class="' + icone + '"></i><span><strong>' + ind + ' em alta ▲</strong> — Mês atual (' + atual + ') supera o anterior (' + ant + ') em mais de 20%. Previsão próximo mês: <strong>' + prev + '</strong>. Recomenda-se intensificar ações preventivas.</span></div>';
        if (atual === 0) return '<div class="insight ok"><i class="' + icone + '"></i><span><strong>' + ind + ': nenhum caso</strong> no mês atual. Previsão próximo mês: <strong>' + prev + '</strong>.</span></div>';
        if (atual < ant) return '<div class="insight ok"><i class="' + icone + '"></i><span><strong>' + ind + ' em queda ▼</strong> — Mês atual (' + atual + ') abaixo do anterior (' + ant + '). Previsão: <strong>' + prev + '</strong>.</span></div>';
        return '<div class="insight"><i class="' + icone + '"></i><span><strong>' + ind + ' estável</strong> — Mês atual: ' + atual + ' | Anterior: ' + ant + ' | Previsão: <strong>' + prev + '</strong>.</span></div>';
    }
    const prevProxMes = D.previsaoProximoMes || { cvp: 0, cvli: 0, mvi: 0 };
    document.getElementById('alertas-rel').innerHTML =
        gerarAlerta('CVP', cvpMes, cvpAnt, prevProxMes.cvp, 'fas fa-mask') +
        gerarAlerta('CVLI', cvliMes, cvliAnt, prevProxMes.cvli, 'fas fa-skull') +
        gerarAlerta('MVI', mviMes, mviAnt, prevProxMes.mvi, 'fas fa-skull-crossbones');

    // ══ SEÇÃO 2 — SÉRIE TEMPORAL ════════════════════════════════════
    mkChart('r-temporal', 'line', labelsMensais, [
        { label: 'CVLI', data: cvliArr, borderColor: '#6a1b9a', backgroundColor: 'rgba(106,27,154,.08)', fill: true, tension: .35, pointRadius: 5, borderWidth: 2.5 },
        { label: 'CVP', data: cvpArr, borderColor: '#e65100', backgroundColor: 'rgba(230,81,0,.06)', fill: true, tension: .35, pointRadius: 5, borderWidth: 2.5 },
        { label: 'MVI', data: mviArr, borderColor: '#b71c1c', backgroundColor: 'rgba(183,28,28,.06)', fill: true, tension: .35, pointRadius: 5, borderWidth: 2.5 },
    ], {
        legend: { position: 'top', labels: { font: { size: 11 }, padding: 14 } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { grid: { display: false } } },
        extra: { interaction: { mode: 'index', intersect: false } },
        datalabels: DL_LINE,
    });
    const picoIdxCVLI = cvliArr.indexOf(Math.max.apply(null, cvliArr.concat([0])));
    const picoIdxCVP = cvpArr.indexOf(Math.max.apply(null, cvpArr.concat([0])));
    document.getElementById('comentario-temporal').innerHTML =
        '<div class="insight"><i class="fas fa-chart-line"></i><span>No período carregado (' + labelsMensais.length + ' mês(es)): <strong>' + (D.arrCVLI || []).length + ' CVLI</strong>' +
        (labelsMensais[picoIdxCVLI] ? ' (pico em ' + labelsMensais[picoIdxCVLI] + ')' : '') + ', <strong>' + (D.arrCVP || []).length + ' CVP</strong>' +
        (labelsMensais[picoIdxCVP] ? ' (pico em ' + labelsMensais[picoIdxCVP] + ')' : '') + ', <strong>' + (D.arrMVI || []).length + ' MVI</strong>.</span></div>';

    // ══ SEÇÃO 3 — PREVISÕES ═════════════════════════════════════════
    // "mês atual" real usado nos cálculos é o da própria série (última
    // chave), não necessariamente a data de hoje — usa acuracia.mesAtual
    // (mesma fonte que gerou a série) quando disponível.
    const chaveMesAtual = (D.acuracia && D.acuracia.mesAtual) || null;
    const chaveProxMes = chaveMesAtual ? proximaChaveMes(chaveMesAtual) : null;
    document.getElementById('prev-prox-mes').textContent = chaveProxMes ? nomeMesCompleto(chaveProxMes) : '—';
    document.getElementById('p-cvp').textContent = prevProxMes.cvp;
    document.getElementById('p-cvli').textContent = prevProxMes.cvli;
    document.getElementById('p-mvi').textContent = prevProxMes.mvi;

    const prevAtual = D.previsaoMesAtualEstimado || { cvp: 0, cvli: 0, mvi: 0 };
    function prevRealRow(label, prev, real, cor) {
        const diff = real - prev;
        const cls = diff > 0 ? 'color:#b71c1c;' : diff < 0 ? 'color:#2e7d32;' : 'color:#9ea3b5;';
        const seta = diff > 0 ? '▲ +' + diff + ' acima' : diff < 0 ? '▼ ' + diff + ' abaixo' : '= conforme';
        return '<div style="display:flex;align-items:center;justify-content:space-between;background:#f8f9ff;border-radius:6px;padding:.5rem .75rem;">' +
            '<span style="font-size:.83rem;font-weight:bold;color:' + cor + '">' + label + '</span>' +
            '<span style="font-size:.8rem;color:#9ea3b5;">Est.: <strong>' + prev + '</strong> → Real: <strong style="color:' + cor + '">' + real + '</strong></span>' +
            '<span style="font-size:.78rem;font-weight:bold;' + cls + '">' + seta + '</span></div>';
    }
    document.getElementById('prev-real-grid').innerHTML =
        prevRealRow('CVP', prevAtual.cvp, cvpMes, '#e65100') +
        prevRealRow('CVLI', prevAtual.cvli, cvliMes, '#6a1b9a') +
        prevRealRow('MVI', prevAtual.mvi, mviMes, '#b71c1c');
    document.getElementById('comentario-previsao').innerHTML =
        '<div class="insight"><i class="fas fa-brain"></i><span>O modelo combina <strong>estatística simples</strong> (60% média ponderada dos últimos 3 meses + 40% regressão linear) com <strong>Holt-sazonal</strong> ' +
        '(suavização exponencial dupla + índice sazonal, via js/machineLearningLeve.js) em ensemble 50/50 — a previsão do mês atual usa só os meses ANTERIORES a ele (nunca vê o próprio mês avaliado), e a do próximo mês usa a série inteira.</span></div>';

    // ══ SEÇÃO 4 — ACURÁCIA PREDITIVA ESPACIAL ═══════════════════════
    const A = D.acuracia || { calculavel: false, motivo: 'Não calculado.' };
    if (!A.calculavel) {
        document.getElementById('acuracia-conteudo').innerHTML =
            '<div class="chart-box-title">Indisponível nesta geração</div><p style="font-size:.82rem;color:#9ea3b5;margin-top:.4rem;">' + (A.motivo || '—') + '</p>';
        document.getElementById('acuracia-fonte').innerHTML = '—';
    } else {
        const corAc = A.hitRate >= 70 ? '#2e7d32' : A.hitRate >= 40 ? '#f57f17' : '#b71c1c';
        document.getElementById('acuracia-conteudo').innerHTML =
            '<div class="chart-box-title"><i class="fas fa-bullseye" style="color:' + corAc + '"></i> Taxa de Acerto Espacial — ' + labelMes(A.mesAtual) + '</div>' +
            '<div class="acuracia-valor" style="color:' + corAc + '">' + A.hitRate.toFixed(1).replace('.', ',') + '%</div>' +
            '<div class="acuracia-trilha"><div class="acuracia-barra" style="width:' + Math.min(100, A.hitRate) + '%;background:' + corAc + '"></div></div>' +
            '<p style="font-size:.8rem;color:#374263;">' + A.acertos + ' de ' + A.totalAtual + ' ocorrência(s) de <strong>' + labelMes(A.mesAtual) + '</strong> caíram dentro das <strong>' + A.zonasRisco + '</strong> zona(s) de risco Alto/Médio do período de referência.</p>';
        document.getElementById('acuracia-fonte').innerHTML = A.fonte === 'registrada'
            ? '📌 <strong>Previsão registrada</strong> em ' + (A.criadoEm ? new Date(A.criadoEm).toLocaleDateString('pt-BR') : '—') + ' — as zonas de risco foram congeladas ANTES do mês começar e não foram recalculadas agora (registro auditável, gravado no Firebase da unidade).' +
              (A.previsaoMensal ? '<br><br>Estimativa de volume feita na época: CVP ' + A.previsaoMensal.cvp + ' · CVLI ' + A.previsaoMensal.cvli + ' · MVI ' + A.previsaoMensal.mvi + '.' : '')
            : '📊 <strong>Estimativa retroativa</strong> — nenhuma previsão foi registrada com antecedência pra este mês (ex.: primeira geração deste relatório, ou mês pulado). As zonas de risco foram recalculadas agora, usando o período de referência <strong>' + (A.mesesBaseline || []).map(labelMes).join(' + ') + '</strong> (' + (A.totalBaseline || 0) + ' ocorrência(s)).';
    }
    document.getElementById('comentario-acuracia').innerHTML =
        '<div class="insight"><i class="fas fa-circle-info"></i><span>Esta métrica identifica, num período de referência (até 3 meses acumulados ANTES do mês avaliado), quais bairros concentraram <strong>≥8%</strong> das ocorrências (mesmo corte de "risco Médio/Alto" usado nos badges do sistema) — depois confere quantas ocorrências reais do mês avaliado caíram dentro dessas zonas. É um indicador de <strong>onde</strong> o modelo acerta, não de quanto vai acontecer (essa parte é a Seção 3).</span></div>' +
        (A.calculavel && A.totalAtual < 5 ? '<div class="insight alerta"><i class="fas fa-triangle-exclamation"></i><span><strong>Amostra pequena</strong> (só ' + A.totalAtual + ' ocorrência(s) no mês avaliado) — com tão poucos casos, o percentual pode saltar de 0% pra 100% com 1 caso a mais ou a menos. Não deve ser tratado como indicador confiável isoladamente.</span></div>' : '');

    // ══ SEÇÃO 5 — JANELA MÓVEL TÁTICA ════════════════════════════════
    const JT = D.janelaTatica || { hotspots: [], dias: 7, estendida: false, totalJanela: 0 };
    const tbodyJT = document.getElementById('tbody-janela-tatica');
    if (!JT.hotspots || !JT.hotspots.length) {
        tbodyJT.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#9ea3b5;padding:1rem;font-size:.82rem;">Sem ocorrências suficientes nos últimos 7-14 dias no momento da geração.</td></tr>';
    } else {
        tbodyJT.innerHTML = JT.hotspots.map(function (h, i) {
            const rlabel = LABEL_RISCO[h.risco];
            const dias = (h.diasDoPico && h.diasDoPico.length) ? h.diasDoPico.map(function (d) { return DIAS_SEMANA[d]; }).join(' e ') : 'sem dia predominante';
            const hora = (h.horaMin != null) ? (h.horaMin === h.horaMax ? h.horaMin + 'h' : h.horaMin + 'h às ' + h.horaMax + 'h') : (h.faixaPico || '—');
            return '<tr><td style="color:#9ea3b5;font-weight:bold;">' + (i + 1) + '</td><td><strong>' + h.bairro + '</strong> (' + h.cidade + ')</td>' +
                '<td>' + LABEL_CATEGORIA[h.categoriaDominante] + '</td><td><span class="badge-risco risco-' + h.risco + '">' + rlabel + '</span></td>' +
                '<td>' + dias + '</td><td>' + hora + '</td><td>' + h.total + ' (' + h.pct + '%)</td></tr>';
        }).join('');
    }
    document.getElementById('comentario-janela-tatica').innerHTML =
        '<div class="insight"><i class="fas fa-calendar-day"></i><span>Janela de <strong>' + JT.dias + ' dias</strong>' +
        (JT.estendida ? ' (estendida de 7 pra 14 dias — volume baixo nos últimos 7)' : '') + ', ' + JT.totalJanela + ' ocorrência(s) analisada(s). ' +
        'Matriz estatística direta (não usa Machine Learning): num recorte tão curto, a unidade dificilmente teria os 30 exemplos mínimos que o modelo treinado exige pra calibrar com segurança — usar como indício operacional imediato, não como previsão calibrada.</span></div>';

    // ══ SEÇÃO 6 — TIPIFICAÇÕES ═══════════════════════════════════════
    function contarTip(arr) {
        const cnt = {};
        (arr || []).forEach(function (i) {
            const t = (i.TIPIFICACAO || i.TIPIFICACAO_GERAL || 'N/D').trim();
            cnt[t] = (cnt[t] || 0) + 1;
        });
        return Object.entries(cnt).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8);
    }
    const tipCVP = contarTip(D.arrCVP), tipCVLI = contarTip(D.arrCVLI), tipMVI = contarTip(D.arrMVI);
    function barHOpts(cor) {
        return {
            legend: { display: false },
            scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } }, y: { grid: { display: false }, ticks: { font: { size: 9 } } } },
            extra: { indexAxis: 'y' },
            datalabels: Object.assign({}, DL_BARH, { color: cor }),
        };
    }
    mkChart('r-tip-cvp', 'bar', tipCVP.map(function (t) { return encurtarLabel(t[0]); }), [{ data: tipCVP.map(function (t) { return t[1]; }), backgroundColor: '#e65100', borderRadius: 4, borderSkipped: false }], barHOpts('#bf360c'));
    mkChart('r-tip-cvli', 'bar', tipCVLI.map(function (t) { return encurtarLabel(t[0]); }), [{ data: tipCVLI.map(function (t) { return t[1]; }), backgroundColor: '#6a1b9a', borderRadius: 4, borderSkipped: false }], barHOpts('#4a148c'));
    mkChart('r-tip-mvi', 'bar', tipMVI.map(function (t) { return encurtarLabel(t[0]); }), [{ data: tipMVI.map(function (t) { return t[1]; }), backgroundColor: '#b71c1c', borderRadius: 4, borderSkipped: false }], barHOpts('#7f0000'));
    document.getElementById('comentario-tipificacoes').innerHTML =
        '<div class="insight"><i class="fas fa-list"></i><span>CVP: tipificação mais frequente <strong>"' + (tipCVP[0] ? tipCVP[0][0] : 'N/D') + '"</strong> (' + (tipCVP[0] ? tipCVP[0][1] : 0) + ' casos). ' +
        'CVLI: <strong>"' + (tipCVLI[0] ? tipCVLI[0][0] : 'N/D') + '"</strong> (' + (tipCVLI[0] ? tipCVLI[0][1] : 0) + ' casos). ' +
        'MVI: <strong>"' + (tipMVI[0] ? tipMVI[0][0] : 'N/D') + '"</strong> (' + (tipMVI[0] ? tipMVI[0][1] : 0) + ' casos).</span></div>';

    // ══ SEÇÃO 7 — HOTSPOTS ═══════════════════════════════════════════
    const HS = D.hotspots || { linhas: [], totalGeral: 0 };
    const tbodyHS = document.getElementById('tbody-hotspot');
    tbodyHS.innerHTML = (HS.linhas || []).map(function (r, i) {
        const rlabel = LABEL_RISCO[r.risco];
        const coordTd = r.coord
            ? '<a href="https://www.google.com/maps?q=' + r.coord + '" target="_blank" style="color:#00695c;font-weight:600;text-decoration:none;">📍 ' + r.coord + '</a>'
            : '<span style="color:#9ea3b5;">—</span>';
        return '<tr><td style="color:#9ea3b5;font-weight:bold;">' + (i + 1) + '</td><td>' + r.cidade + '</td><td><strong>' + r.bairro + '</strong></td>' +
            '<td>' + r.cvp + '</td><td>' + r.cvli + '</td><td>' + r.mvi + '</td><td><strong>' + r.total + '</strong></td>' +
            '<td><span class="badge-risco risco-' + r.risco + '">' + rlabel + '</span></td><td>' + coordTd + '</td></tr>';
    }).join('') || '<tr><td colspan="9" style="text-align:center;color:#9ea3b5;padding:1rem;">Sem dados suficientes.</td></tr>';
    const topHotspot = (HS.linhas || [])[0];
    document.getElementById('comentario-hotspots').innerHTML = topHotspot
        ? '<div class="insight"><i class="fas fa-map-marker-alt"></i><span>Maior concentração: <strong>' + topHotspot.bairro + ' (' + topHotspot.cidade + ')</strong>, ' + topHotspot.total + ' ocorrência(s) (' + topHotspot.pct + '% do total classificado). A coordenada mostrada é a mais frequente do local, já filtrada contra "pinos fixos" da geocodificação (mesma validação de bounding box de Alagoas do módulo de Machine Learning).</span></div>'
        : '<div class="insight"><i class="fas fa-circle-info"></i><span>Sem hotspots identificados no período carregado.</span></div>';

    // ══ SEÇÃO 8 — PREVISÃO DE RISCO — ONDE E QUANDO (4 BLOCOS) ═══════
    // HTML já vem PRONTO no payload (js/preditivaCAD.js:renderizarBlocoOndeQuando_,
    // reaproveitado tal e qual da tela ao vivo) — este script só injeta.
    const BQ = D.blocosOndeQuando || {};
    ['geral', 'cvp', 'cvli', 'mvi'].forEach(function (cat) {
        const el = document.getElementById('onde-quando-' + cat);
        if (el) el.innerHTML = BQ[cat] || '<div class="previsao-nota">Sem dados.</div>';
    });
    document.getElementById('comentario-risco-local').innerHTML =
        '<div class="insight"><i class="fas fa-circle-info"></i><span>Cada bloco mostra o dia da semana e horário de maior risco pra sua categoria — quando há histórico suficiente (mínimo 30 exemplos com casos e não-casos representados), o ranking de locais vem de uma regressão logística treinada do zero sobre o histórico real desta unidade (com regularização L2, que evita que bairros com pouco volume "decorem" 1-2 casos isolados); sem histórico suficiente, cai pra contagem histórica simples. Usar como apoio ao planejamento, não como decisão isolada.</span></div>';

    // ══ SEÇÃO 9 — HORÁRIOS E DIA DA SEMANA ═══════════════════════════
    function horaArr(arr) {
        const c = Array(24).fill(0);
        (arr || []).forEach(function (i) {
            const h = parseInt((i.HORA || '00:00').split(':')[0], 10);
            if (!isNaN(h) && h >= 0 && h < 24) c[h]++;
        });
        return c;
    }
    const todosArr = (D.arrCVP || []).concat(D.arrCVLI || [], D.arrMVI || []);
    renderHeatmap('r-horas', horaArr(todosArr), 0, 105, 92);
    const horasTodos = horaArr(todosArr);
    const picoHora = horasTodos.indexOf(Math.max.apply(null, horasTodos));

    function diaArr(arr) {
        const c = Array(7).fill(0);
        (arr || []).forEach(function (i) { const d = parseDateStr(i.DATA); if (d) c[d.getDay()]++; });
        return c;
    }
    const dCVP = diaArr(D.arrCVP), dCVLI = diaArr(D.arrCVLI), dMVI = diaArr(D.arrMVI);
    mkChart('r-diasemana', 'bar', DIAS_SEMANA_ABREV, [
        { label: 'CVP', data: dCVP, backgroundColor: 'rgba(230,81,0,.75)', borderRadius: 4 },
        { label: 'CVLI', data: dCVLI, backgroundColor: 'rgba(106,27,154,.75)', borderRadius: 4 },
        { label: 'MVI', data: dMVI, backgroundColor: 'rgba(183,28,28,.75)', borderRadius: 4 },
    ], {
        legend: { position: 'top', labels: { font: { size: 10 }, padding: 12 } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { grid: { display: false } } },
        datalabels: DL_BARV,
    });
    const dTodos = dCVP.map(function (v, i) { return v + dCVLI[i] + dMVI[i]; });
    const diaMais = DIAS_SEMANA_ABREV[dTodos.indexOf(Math.max.apply(null, dTodos))];
    document.getElementById('comentario-horas').innerHTML =
        '<div class="insight"><i class="fas fa-clock"></i><span>Horário de maior concentração (CVP+CVLI+MVI): <strong>' + picoHora + 'h</strong>. Dia da semana de maior concentração: <strong>' + diaMais + '</strong>. Esses dados orientam o planejamento de policiamento ostensivo (OPO) e o emprego de guarnições nos horários/dias críticos.</span></div>';

    // ── Exibe relatório ───────────────────────────────────────────
    document.getElementById('loader').style.display = 'none';
    document.getElementById('relatorio').style.display = 'block';
});
