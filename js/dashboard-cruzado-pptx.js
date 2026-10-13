// ═══════════════════════════════════════════════════════════════════
// DASHBOARD CRUZADO — APRESENTAÇÃO EM POWERPOINT
// ═══════════════════════════════════════════════════════════════════
// Botão "Apresentação PowerPoint" do Dashboard Cruzado: indicadores de
// TODAS as abas (MVI/CVLI, CVP, TCO, Armas, Drogas, Visita Orientativa,
// Perturbação do Sossego, Violência Doméstica, Mandados, Materiais e
// Rede de Proteção) no período selecionado nos filtros da página,
// comparados com o MESMO período do ano anterior, com o nome e a logo
// da unidade logada (P3.loadUnidadeConfig → nome / logoUrl; sem logo
// cadastrada usa img/brasao.png).
//
// As contagens usam as MESMAS regras de cada aba (window.DashCruzadoAPI,
// exposto por js/dashboard-cruzado.js) — nada é recontado aqui de outro
// jeito. Gráficos são NATIVOS do PowerPoint (pptxgenjs), editáveis.
//
// coletar() lê os dados (navegador); montar() só desenha a partir de um
// objeto pronto — separado pra poder ser testado fora do navegador.
// ═══════════════════════════════════════════════════════════════════
(function (raiz) {
    'use strict';

    const URL_PPTXGEN = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js';
    const LOGO_PADRAO = '../img/brasao.png';

    const COR = {
        navy: '0B2545', azul: '2F5FDD', anterior: 'A9B4C8', claro: 'F3F5FA', texto: '1C2333',
        muted: '6B7280', borda: 'E5E7EB', bom: '2F8F5B', ruim: 'C0392B', neutro: '6B7280', branco: 'FFFFFF',
    };
    const FONTE = 'Calibri';

    // Sentido "bom" da variação por aba: crime (subir é ruim) x produtividade
    // policial (subir é bom). null = neutro (sem cor de juízo).
    const SUBIR_EH_BOM = {
        mvicvli: false, cvp: false, perturbacao: false, violencia: false,
        armas: true, drogas: true, visita: true, mandados: true, materiais: true, tco: null,
    };
    const NOME_SLIDE = {
        mvicvli: 'MVI e CVLI', cvp: 'CVP — Crimes Violentos contra o Patrimônio', tco: 'TCO — Termos Circunstanciados',
        armas: 'Armas Apreendidas', drogas: 'Drogas Apreendidas', visita: 'Visitas Orientativas',
        perturbacao: 'Perturbação do Sossego', violencia: 'Violência Doméstica', mandados: 'Cumprimento de Mandados',
        materiais: 'Materiais Apreendidos',
    };

    const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const fmtN = n => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    const dataBR = d => d.toLocaleDateString('pt-BR');
    const umAnoAntes = d => { const r = new Date(d); r.setFullYear(r.getFullYear() - 1); if (r.getMonth() !== d.getMonth()) r.setDate(0); return r; };

    function fmtPeso(g) {
        return g >= 1000 ? (g / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 }) + ' kg'
            : g.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' g';
    }
    function variacao(atual, anterior) {
        if (!anterior && !atual) return { txt: '—', pct: 0, sinal: 0 };
        if (!anterior) return { txt: 'novo', pct: null, sinal: 1 };
        const p = (atual - anterior) / anterior * 100;
        return { txt: (p > 0 ? '+' : '') + p.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%', pct: p, sinal: Math.sign(Math.round(p * 10)) };
    }
    function corVariacao(cat, sinal) {
        const bom = SUBIR_EH_BOM[cat];
        if (!sinal || bom == null) return COR.neutro;
        return (sinal > 0) === bom ? COR.bom : COR.ruim;
    }

    // ── Coleta (navegador) ──────────────────────────────────────────
    async function coletar() {
        const API = raiz.DashCruzadoAPI;
        if (!API) throw new Error('Dashboard Cruzado não carregado.');
        const f = API.filtrosManuais();
        const hoje = new Date();
        const ini = f.ini ? new Date(f.ini + 'T00:00:00') : new Date(hoje.getFullYear(), 0, 1);
        const fim = f.fim ? new Date(f.fim + 'T23:59:59') : new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 23, 59, 59);
        if (fim < ini) throw new Error('O período — fim é anterior ao início.');
        const iniAnt = umAnoAntes(ini), fimAnt = umAnoAntes(fim);
        const cidade = f.cidade || '';

        // Meses do período (rótulo "jan" ou "jan/26" se atravessar o ano).
        const meses = [];
        for (let d = new Date(ini.getFullYear(), ini.getMonth(), 1); d <= fim && meses.length < 36; d.setMonth(d.getMonth() + 1)) {
            meses.push({ ano: d.getFullYear(), mes: d.getMonth(),
                rotulo: MESES[d.getMonth()] + (ini.getFullYear() !== fim.getFullYear() ? '/' + String(d.getFullYear()).slice(2) : '') });
        }

        const categorias = [];
        for (const cat of API.ORDEM_ABAS) {
            const d = API.CATEGORIAS[cat];
            let base;
            try { base = await API.carregar(cat); }
            catch (e) { categorias.push({ cat, label: NOME_SLIDE[cat] || d.label, erro: e.message }); continue; }
            if (cidade && d.campoCidade) base = base.filter(i => API.NORM(d.campoCidade(i)).includes(cidade));
            const noIntervalo = (a, b) => base.filter(i => { const dt = API.parseData(d.campoData(i)); return dt && dt >= a && dt <= b; });
            const atual = noIntervalo(ini, fim), anterior = noIntervalo(iniAnt, fimAnt);
            const medir = l => d.campoPeso ? l.reduce((s, i) => s + d.campoPeso(i), 0) : l.length;

            const porMes = (lista, deslocAno) => meses.map(m => medir(lista.filter(i => {
                const dt = API.parseData(d.campoData(i));
                return dt && dt.getFullYear() === m.ano - deslocAno && dt.getMonth() === m.mes;
            })));
            const agrupar = (lista, fn) => {
                const c = {};
                lista.forEach(i => { const k = fn(i) || 'Não informado'; c[k] = (c[k] || 0) + (d.campoPeso ? d.campoPeso(i) : 1); });
                return c;
            };
            const tipA = agrupar(atual, d.campoTip), tipP = agrupar(anterior, d.campoTip);
            const topTip = Object.keys(Object.assign({}, tipA, tipP))
                .sort((a, b) => ((tipA[b] || 0) + (tipP[b] || 0)) - ((tipA[a] || 0) + (tipP[a] || 0))).slice(0, 6);
            const cidA = d.campoCidade ? agrupar(atual, d.campoCidade) : {};

            // KPI extra de cada aba (mesmos critérios das abas).
            let extra = null;
            if (cat === 'mvicvli') extra = { rotulo: 'MVI no período', atual: atual.filter(API.isMVI).length, anterior: anterior.filter(API.isMVI).length };
            else if (cat === 'tco') {
                const concl = l => l.filter(i => { const m = API.NORM(API.movBase(API.CAMPO(i, 'Movimentação', 'Movimentacao', 'MOVIMENTACAO'))); return m === 'ARQUIVADO' || m === 'JULGADO'; }).length;
                extra = { rotulo: 'Concluídos (arquiv./julg.)', atual: concl(atual), anterior: concl(anterior) };
            } else if (cat === 'drogas') extra = { rotulo: 'Apreensões (registros)', atual: atual.length, anterior: anterior.length };
            else if (cat === 'materiais') {
                const dev = l => l.filter(i => API.NORM(API.CAMPO(i, 'STATUS')) === 'DEVOLVIDO').length;
                extra = { rotulo: 'Devolvidos', atual: dev(atual), anterior: dev(anterior) };
            }

            categorias.push({
                cat, label: NOME_SLIDE[cat] || d.label, labelTip: d.labelTip || 'Tipificação', peso: !!d.campoPeso,
                atual: medir(atual), anterior: medir(anterior), registrosAtual: atual.length, registrosAnterior: anterior.length,
                mesAtual: porMes(atual, 0), mesAnterior: porMes(anterior, 1),
                topTip, tipAtual: topTip.map(k => tipA[k] || 0), tipAnterior: topTip.map(k => tipP[k] || 0),
                topCidades: Object.entries(cidA).sort((a, b) => b[1] - a[1]).slice(0, 3),
                extra,
            });
        }

        let rede = null;
        if (typeof raiz.RedeProtecaoResumo === 'function') {
            try {
                const [ra, rp] = await Promise.all([raiz.RedeProtecaoResumo(ini, fim, cidade), raiz.RedeProtecaoResumo(iniAnt, fimAnt, cidade)]);
                if (ra.baseDisponivel) rede = { atual: ra, anterior: rp };
            } catch (e) { console.warn('[cruzado-pptx] resumo da rede de proteção indisponível:', e); }
        }

        const cfg = await P3.loadUnidadeConfig();
        const sessao = P3.getSession ? P3.getSession() : null;
        return {
            unidade: cfg.nome || 'Unidade', logo: await carregarLogo(cfg.logoUrl),
            usuario: sessao ? `${sessao.graduacao || ''} ${sessao.nomeGuerra || ''}`.trim() : '',
            ini, fim, iniAnt, fimAnt, cidade, meses: meses.map(m => m.rotulo), categorias, rede, geradoEm: new Date(),
        };
    }

    // Logo como base64 + proporção (o PowerPoint precisa do tamanho certo).
    async function carregarLogo(url) {
        const tentar = async u => {
            const blob = await (await fetch(u)).blob();
            if (!/^image\//.test(blob.type)) throw new Error('não é imagem');
            const dataUrl = await new Promise((ok, falha) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = falha; r.readAsDataURL(blob); });
            const dim = await new Promise(ok => { const im = new Image(); im.onload = () => ok({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => ok({ w: 1, h: 1 }); im.src = dataUrl; });
            return { data: dataUrl.replace(/^data:/, ''), proporcao: dim.w / dim.h || 1 };
        };
        // Alternativa sem fetch: <img> + canvas (serve também pra logo em outro
        // domínio que libere CORS pra imagem mas não pra fetch).
        const viaImagem = u => new Promise((ok, falha) => {
            const im = new Image();
            im.crossOrigin = 'anonymous';
            im.onload = () => {
                try {
                    const c = document.createElement('canvas');
                    c.width = im.naturalWidth; c.height = im.naturalHeight;
                    c.getContext('2d').drawImage(im, 0, 0);
                    ok({ data: c.toDataURL('image/png').replace(/^data:/, ''), proporcao: im.naturalWidth / im.naturalHeight || 1 });
                } catch (e) { falha(e); }
            };
            im.onerror = () => falha(new Error('imagem não carregou'));
            im.src = u;
        });
        for (const u of [url, LOGO_PADRAO].filter(Boolean)) {
            try { return await tentar(u); } catch (e) { /* tenta pelo <img> */ }
            try { return await viaImagem(u); } catch (e) { console.warn('[cruzado-pptx] logo indisponível:', u, e.message); }
        }
        return null;
    }

    // ── Montagem (pptxgenjs) ────────────────────────────────────────
    function montar(PptxGenJS, D) {
        const pres = new PptxGenJS();
        pres.layout = 'LAYOUT_WIDE'; // 13,33" x 7,5"
        pres.title = `Indicadores — ${D.unidade}`;
        pres.company = D.unidade.replace(/&/g, '&amp;');
        pres.theme = { headFontFace: FONTE, bodyFontFace: FONTE };

        const periodo = `${dataBR(D.ini)} a ${dataBR(D.fim)}`;
        const periodoAnt = `${dataBR(D.iniAnt)} a ${dataBR(D.fimAnt)}`;
        const local = D.cidade ? ` • Cidade: ${D.cidade}` : '';
        const W = 13.333;

        const logoBox = (x, y, alturaMax, larguraMax) => {
            if (!D.logo) return null;
            let h = alturaMax, w = h * D.logo.proporcao;
            if (w > larguraMax) { w = larguraMax; h = w / D.logo.proporcao; }
            return { data: D.logo.data, x: x + (larguraMax - w) / 2, y: y + (alturaMax - h) / 2, w, h };
        };

        const objsMaster = [{ text: { text: `${D.unidade} • ${periodo} (comparado com ${periodoAnt})${local}`, options: { x: 0.5, y: 7.02, w: 10.5, h: 0.3, fontFace: FONTE, fontSize: 9, color: COR.muted } } }];
        const lm = logoBox(12.25, 0.25, 0.7, 0.7);
        if (lm) objsMaster.push({ image: lm });
        pres.defineSlideMaster({
            title: 'CONTEUDO', background: { color: COR.branco }, objects: objsMaster,
            slideNumber: { x: 12.2, y: 7.0, w: 0.65, h: 0.32, fontFace: FONTE, fontSize: 9, color: COR.muted, align: 'right' },
        });

        const titulo = (s, txt, sub) => {
            s.addText(txt, { x: 0.5, y: 0.3, w: 11.5, h: 0.6, fontFace: FONTE, fontSize: 26, bold: true, color: COR.navy, margin: 0, isTextBox: true });
            if (sub) s.addText(sub, { x: 0.5, y: 0.9, w: 11.5, h: 0.35, fontFace: FONTE, fontSize: 12, color: COR.muted, margin: 0, isTextBox: true });
        };
        const cartao = (s, x, y, w, h, rotulo, valor, cor, rodape) => {
            s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, fill: { color: COR.claro }, line: { color: COR.claro }, rectRadius: 0.08 });
            s.addText(rotulo.toUpperCase(), { x: x + 0.2, y: y + 0.12, w: w - 0.4, h: 0.3, fontFace: FONTE, fontSize: 10, bold: true, color: COR.muted, margin: 0, isTextBox: true });
            s.addText(String(valor), { x: x + 0.2, y: y + 0.4, w: w - 0.4, h: 0.6, fontFace: FONTE, fontSize: 28, bold: true, color: cor, margin: 0, fit: 'shrink', isTextBox: true });
            if (rodape) s.addText(rodape, { x: x + 0.2, y: y + h - 0.35, w: w - 0.4, h: 0.28, fontFace: FONTE, fontSize: 10, color: COR.muted, margin: 0, isTextBox: true });
        };
        const optsGrafico = (x, y, w, h, tituloG, dir, extra) => Object.assign({
            x, y, w, h, barDir: dir, barGrouping: 'clustered',
            chartColors: [COR.anterior, COR.azul], showLegend: true, legendPos: 't', legendFontSize: 10, legendFontFace: FONTE,
            showTitle: true, title: tituloG, titleFontSize: 13, titleColor: COR.navy, titleFontFace: FONTE,
            catAxisLabelFontSize: 9, valAxisLabelFontSize: 9, catAxisLabelColor: COR.muted, valAxisLabelColor: COR.muted,
            catAxisLabelFontFace: FONTE, valAxisLabelFontFace: FONTE,
            valGridLine: { color: COR.borda, size: 0.5 }, catGridLine: { style: 'none' },
            showValue: true, dataLabelFontSize: 8, dataLabelColor: COR.texto, dataLabelFontFace: FONTE, dataLabelPosition: 'outEnd',
            valAxisLabelFormatCode: '#,##0', dataLabelFormatCode: '#,##0',
        }, extra || {});
        const nomeAtual = `Atual (${D.ini.getFullYear() === D.fim.getFullYear() ? D.fim.getFullYear() : periodo})`;
        const nomeAnterior = `Anterior (${D.iniAnt.getFullYear() === D.fimAnt.getFullYear() ? D.fimAnt.getFullYear() : periodoAnt})`;

        // ── 1. Capa ──
        let s = pres.addSlide();
        s.background = { color: COR.navy };
        const lc = logoBox(0.9, 1.6, 3.6, 3.2);
        if (lc) s.addImage(lc);
        s.addText(D.unidade.toUpperCase(), { x: 4.6, y: 1.55, w: 8.2, h: 0.5, fontFace: FONTE, fontSize: 16, bold: true, color: 'C9D3E8', margin: 0, isTextBox: true });
        s.addText('Indicadores Operacionais', { x: 4.6, y: 2.1, w: 8.2, h: 0.9, fontFace: FONTE, fontSize: 40, bold: true, color: COR.branco, margin: 0, isTextBox: true });
        s.addText('Período selecionado comparado com o mesmo período do ano anterior', { x: 4.6, y: 3.0, w: 8.2, h: 0.45, fontFace: FONTE, fontSize: 16, color: 'C9D3E8', margin: 0, isTextBox: true });
        s.addText([
            { text: 'Período atual: ', options: { bold: true } }, { text: periodo, options: { breakLine: true } },
            { text: 'Comparação: ', options: { bold: true } }, { text: periodoAnt, options: { breakLine: !!D.cidade } },
        ].concat(D.cidade ? [{ text: 'Cidade: ', options: { bold: true } }, { text: D.cidade }] : []),
        { x: 4.6, y: 3.75, w: 8.2, h: 1.1, fontFace: FONTE, fontSize: 15, color: COR.branco, margin: 0, paraSpaceAfter: 4, isTextBox: true });
        s.addText(`Gerado em ${D.geradoEm.toLocaleString('pt-BR')}${D.usuario ? ' por ' + D.usuario : ''} • Fonte: Sistema P3 (Dashboard Cruzado)`,
            { x: 4.6, y: 6.55, w: 8.2, h: 0.35, fontFace: FONTE, fontSize: 10, color: '9AA8C4', margin: 0, isTextBox: true });

        // ── 2. Visão geral ──
        const cats = D.categorias.filter(c => !c.erro);
        s = pres.addSlide({ masterName: 'CONTEUDO' });
        titulo(s, 'Visão geral do período', `${periodo} comparado com ${periodoAnt}${local}`);
        const cab = ['Indicador', 'Atual', 'Anterior', 'Variação'].map((t, i) => ({ text: t, options: { bold: true, color: COR.branco, fill: { color: COR.navy }, align: i ? 'center' : 'left' } }));
        const linhas = [cab];
        cats.forEach(c => {
            const v = variacao(c.atual, c.anterior);
            const fv = c.peso ? fmtPeso : fmtN;
            linhas.push([
                { text: c.label },
                { text: fv(c.atual), options: { align: 'center', bold: true } },
                { text: fv(c.anterior), options: { align: 'center' } },
                { text: v.txt, options: { align: 'center', bold: true, color: corVariacao(c.cat, v.sinal) } },
            ]);
            if (c.cat === 'mvicvli' && c.extra) {
                const vm = variacao(c.extra.atual, c.extra.anterior);
                linhas.push([{ text: '   ↳ MVI (mortes violentas)' }, { text: fmtN(c.extra.atual), options: { align: 'center', bold: true } },
                    { text: fmtN(c.extra.anterior), options: { align: 'center' } }, { text: vm.txt, options: { align: 'center', bold: true, color: corVariacao('mvicvli', vm.sinal) } }]);
            }
        });
        // A base de vítimas só existe para os períodos já importados do CAD —
        // sem nenhuma vítima no período anterior não há comparação honesta.
        const redeSemAnterior = D.rede && !D.rede.anterior.total;
        if (D.rede) {
            const vr = variacao(D.rede.atual.total, D.rede.anterior.total);
            linhas.push([{ text: 'Rede de Proteção (vítimas)' }, { text: fmtN(D.rede.atual.total), options: { align: 'center', bold: true } },
                { text: redeSemAnterior ? '—' : fmtN(D.rede.anterior.total), options: { align: 'center' } },
                redeSemAnterior ? { text: 'sem base', options: { align: 'center', color: COR.muted } }
                    : { text: vr.txt, options: { align: 'center', bold: true, color: corVariacao('violencia', vr.sinal) } }]);
        }
        const altLinha = Math.min(0.38, 5.1 / linhas.length);
        s.addTable(linhas, { x: 0.5, y: 1.4, w: 7.3, colW: [3.4, 1.3, 1.3, 1.3], rowH: altLinha, margin: [2, 6, 2, 6], fontFace: FONTE, fontSize: linhas.length > 12 ? 10 : 11,
            color: COR.texto, border: { type: 'solid', pt: 0.5, color: COR.borda }, valign: 'middle' });
        const contaveis = cats.filter(c => !c.peso);
        s.addChart(pres.charts.BAR, [
            { name: nomeAnterior, labels: contaveis.map(c => c.label.split(' — ')[0]), values: contaveis.map(c => c.anterior) },
            { name: nomeAtual, labels: contaveis.map(c => c.label.split(' — ')[0]), values: contaveis.map(c => c.atual) },
        ], optsGrafico(8.05, 1.35, 4.8, 5.3, 'Registros: atual x anterior', 'bar', { dataLabelFontSize: 7, catAxisLabelFontSize: 8, catAxisOrientation: 'maxMin' }));
        s.addText('Verde = variação favorável • Vermelho = desfavorável (crimes: queda é favorável; apreensões, mandados e visitas: alta é favorável) • Cinza = neutro.',
            { x: 0.5, y: 6.75, w: 11.5, h: 0.25, fontFace: FONTE, fontSize: 9, italic: true, color: COR.muted, margin: 0, isTextBox: true });

        // ── 3. Destaques ──
        s = pres.addSlide({ masterName: 'CONTEUDO' });
        titulo(s, 'Destaques do período', 'Maiores variações em relação ao mesmo período do ano anterior');
        const comVar = cats.map(c => Object.assign({ v: variacao(c.atual, c.anterior) }, c)).filter(c => c.v.pct != null && c.anterior >= 3);
        const favor = comVar.filter(c => SUBIR_EH_BOM[c.cat] != null && corVariacao(c.cat, c.v.sinal) === COR.bom).sort((a, b) => Math.abs(b.v.pct) - Math.abs(a.v.pct)).slice(0, 4);
        const desfavor = comVar.filter(c => SUBIR_EH_BOM[c.cat] != null && corVariacao(c.cat, c.v.sinal) === COR.ruim).sort((a, b) => Math.abs(b.v.pct) - Math.abs(a.v.pct)).slice(0, 4);
        const blocoDestaque = (x, tituloB, cor, lista, vazio) => {
            s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 1.5, w: 5.95, h: 5.2, fill: { color: COR.claro }, line: { color: COR.claro }, rectRadius: 0.08 });
            s.addText(tituloB, { x: x + 0.3, y: 1.7, w: 5.35, h: 0.45, fontFace: FONTE, fontSize: 18, bold: true, color: cor, margin: 0, isTextBox: true });
            if (!lista.length) { s.addText(vazio, { x: x + 0.3, y: 2.3, w: 5.35, h: 0.5, fontFace: FONTE, fontSize: 14, color: COR.muted, margin: 0, isTextBox: true }); return; }
            lista.forEach((c, i) => {
                const y = 2.35 + i * 1.05, fv = c.peso ? fmtPeso : fmtN;
                s.addText(c.v.txt, { x: x + 0.3, y, w: 1.75, h: 0.75, fontFace: FONTE, fontSize: 26, bold: true, color: cor, margin: 0, valign: 'middle', isTextBox: true });
                s.addText([{ text: c.label, options: { bold: true, breakLine: true, color: COR.texto } }, { text: `${fv(c.anterior)} → ${fv(c.atual)}`, options: { color: COR.muted } }],
                    { x: x + 2.1, y, w: 3.55, h: 0.75, fontFace: FONTE, fontSize: 13, margin: 0, valign: 'middle', isTextBox: true });
            });
        };
        blocoDestaque(0.5, 'Resultados favoráveis', COR.bom, favor, 'Nenhuma variação favorável relevante.');
        blocoDestaque(6.88, 'Pontos de atenção', COR.ruim, desfavor, 'Nenhuma variação desfavorável relevante.');

        // ── 4. Um slide por aba ──
        D.categorias.forEach(c => {
            s = pres.addSlide({ masterName: 'CONTEUDO' });
            titulo(s, c.label, `${periodo} comparado com ${periodoAnt}${local}`);
            if (c.erro) {
                s.addText(`Não foi possível carregar os dados desta aba: ${c.erro}`, { x: 0.5, y: 2, w: 12, h: 0.6, fontFace: FONTE, fontSize: 16, color: COR.ruim, isTextBox: true });
                return;
            }
            const v = variacao(c.atual, c.anterior);
            const fv = c.peso ? fmtPeso : fmtN;
            const cw = 2.9, gap = 0.233;
            cartao(s, 0.5, 1.4, cw, 1.3, 'Período atual', fv(c.atual), COR.azul, c.peso ? `${fmtN(c.registrosAtual)} apreensão(ões)` : 'registros');
            cartao(s, 0.5 + (cw + gap), 1.4, cw, 1.3, 'Mesmo período anterior', fv(c.anterior), COR.muted, c.peso ? `${fmtN(c.registrosAnterior)} apreensão(ões)` : 'registros');
            cartao(s, 0.5 + 2 * (cw + gap), 1.4, cw, 1.3, 'Variação', v.txt, corVariacao(c.cat, v.sinal),
                SUBIR_EH_BOM[c.cat] == null ? 'indicador neutro' : (v.sinal ? (corVariacao(c.cat, v.sinal) === COR.bom ? 'favorável' : 'ponto de atenção') : 'estável'));
            if (c.extra) {
                const ve = variacao(c.extra.atual, c.extra.anterior);
                cartao(s, 0.5 + 3 * (cw + gap), 1.4, cw, 1.3, c.extra.rotulo, fmtN(c.extra.atual), COR.navy, `anterior: ${fmtN(c.extra.anterior)} (${ve.txt})`);
            } else {
                const nm = Math.max(1, D.meses.length);
                cartao(s, 0.5 + 3 * (cw + gap), 1.4, cw, 1.3, 'Média mensal', fv(c.atual / nm), COR.navy, `anterior: ${fv(c.anterior / nm)}`);
            }

            const kg = c.peso && Math.max(...c.mesAtual, ...c.mesAnterior, 0) >= 1000;
            const esc = arr => kg ? arr.map(x => Math.round(x / 10) / 100) : arr.map(x => Math.round(x * 100) / 100);
            const unid = c.peso ? (kg ? ' (kg)' : ' (g)') : '';
            const fmtCod = kg ? '#,##0.0' : '#,##0';
            if (c.atual || c.anterior) {
                s.addChart(pres.charts.BAR, [
                    { name: nomeAnterior, labels: D.meses, values: esc(c.mesAnterior) },
                    { name: nomeAtual, labels: D.meses, values: esc(c.mesAtual) },
                ], optsGrafico(0.5, 2.95, 6.75, 3.65, 'Evolução mensal' + unid, 'col', { valAxisLabelFormatCode: fmtCod, dataLabelFormatCode: fmtCod, dataLabelFontSize: D.meses.length > 8 ? 7 : 8 }));
                if (c.topTip.length) {
                    s.addChart(pres.charts.BAR, [
                        { name: nomeAnterior, labels: c.topTip.map(t => t.length > 38 ? t.slice(0, 36) + '…' : t), values: esc(c.tipAnterior) },
                        { name: nomeAtual, labels: c.topTip.map(t => t.length > 38 ? t.slice(0, 36) + '…' : t), values: esc(c.tipAtual) },
                    ], optsGrafico(7.45, 2.95, 5.4, 3.65, `Principais — ${c.labelTip}${unid}`, 'bar', { valAxisLabelFormatCode: fmtCod, dataLabelFormatCode: fmtCod, catAxisLabelFontSize: 8, catAxisOrientation: 'maxMin' }));
                }
            } else {
                s.addText('Sem registros no período atual nem no mesmo período do ano anterior.', { x: 0.5, y: 3.6, w: 12.3, h: 0.6, fontFace: FONTE, fontSize: 16, color: COR.muted, align: 'center', isTextBox: true });
            }
            if (c.topCidades.length) {
                s.addText([{ text: 'Cidades com mais registros no período: ', options: { bold: true, color: COR.navy } },
                    { text: c.topCidades.map(([k, n]) => `${k} (${fv(n)})`).join(' • '), options: { color: COR.texto } }],
                { x: 0.5, y: 6.65, w: 12.3, h: 0.3, fontFace: FONTE, fontSize: 11, margin: 0, isTextBox: true });
            }
        });

        // ── 5. Rede de Proteção ──
        if (D.rede) {
            const A = D.rede.atual, P = D.rede.anterior;
            s = pres.addSlide({ masterName: 'CONTEUDO' });
            titulo(s, 'Rede de Proteção — Grupos Vulneráveis', `Vítimas de violência registradas pela PM (CAD) • ${periodo} comparado com ${periodoAnt}${local}`);
            const cw = 2.9, gap = 0.233;
            [['Vítimas', A.total, P.total], ['Mulheres', A.mulheres, P.mulheres], ['Crianças e adolescentes', A.criancasAdolescentes, P.criancasAdolescentes], ['Pessoas idosas (60+)', A.idosos, P.idosos]]
                .forEach(([r, a, p], i) => { const vv = variacao(a, p); cartao(s, 0.5 + i * (cw + gap), 1.4, cw, 1.3, r, fmtN(a), COR.azul, redeSemAnterior ? 'anterior: sem dados importados' : `anterior: ${fmtN(p)} (${vv.txt})`); });
            if (redeSemAnterior) s.addText('O período anterior ainda não foi importado do CAD na aba Rede de Proteção ("Buscar vítimas no CAD") — por isso não há comparação.',
                { x: 0.5, y: 6.65, w: 12.3, h: 0.3, fontFace: FONTE, fontSize: 10, italic: true, color: COR.muted, margin: 0, isTextBox: true });
            const tipos = Object.keys(A.porTipo).filter(k => (A.porTipo[k] || 0) + (P.porTipo[k] || 0) > 0);
            if (tipos.length) {
                const series = [{ name: nomeAtual, labels: tipos, values: tipos.map(k => A.porTipo[k] || 0) }];
                if (!redeSemAnterior) series.unshift({ name: nomeAnterior, labels: tipos, values: tipos.map(k => P.porTipo[k] || 0) });
                s.addChart(pres.charts.BAR, series, optsGrafico(0.5, 2.95, 12.3, 3.6, 'Tipos de violência (múltipla resposta)', 'bar',
                    { catAxisOrientation: 'maxMin', chartColors: redeSemAnterior ? [COR.azul] : [COR.anterior, COR.azul] }));
            }
        }

        // ── 6. Notas e fonte ──
        s = pres.addSlide();
        s.background = { color: COR.navy };
        s.addText('Notas metodológicas', { x: 0.8, y: 0.7, w: 11.7, h: 0.7, fontFace: FONTE, fontSize: 30, bold: true, color: COR.branco, margin: 0, isTextBox: true });
        s.addText([
            `Período atual: ${periodo}; comparação: ${periodoAnt} (mesmo período do ano anterior).`,
            'Contagens seguem as mesmas regras de cada aba do Dashboard Cruzado do Sistema P3 (Firebase, planilhas de TCO e Materiais).',
            'MVI: homicídio, latrocínio, feminicídio e homicídio ao volante; tentativas só contam com óbito confirmado.',
            'Drogas: valores em peso apreendido (g/kg); demais indicadores em número de registros.',
            D.cidade ? `Filtro de cidade aplicado: ${D.cidade}.` : 'Todas as cidades da área da unidade.',
            D.rede ? 'Rede de Proteção: vítimas (tipo de envolvimento = vítima) do CAD, apenas ocorrências com violência.' : null,
        ].filter(Boolean).map((t, i, arr) => ({ text: t, options: { bullet: true, breakLine: i < arr.length - 1 } })),
        { x: 0.8, y: 1.7, w: 11.7, h: 4.2, fontFace: FONTE, fontSize: 16, color: 'DCE3F0', paraSpaceAfter: 10, valign: 'top', isTextBox: true });
        const ln = logoBox(0.8, 6.0, 1.0, 1.0);
        if (ln) s.addImage(ln);
        s.addText(`${D.unidade} • Sistema P3`, { x: 2.0, y: 6.3, w: 10, h: 0.4, fontFace: FONTE, fontSize: 14, bold: true, color: 'C9D3E8', margin: 0, isTextBox: true });

        return pres;
    }

    function nomeArquivo(D) {
        const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const u = D.unidade.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
        return `Indicadores_${u}_${iso(D.ini)}_a_${iso(D.fim)}.pptx`;
    }

    // ── Botão ───────────────────────────────────────────────────────
    function carregarScript(url, global) {
        if (raiz[global]) return Promise.resolve(raiz[global]);
        return new Promise((ok, falha) => {
            const s = document.createElement('script');
            s.src = url; s.onload = () => raiz[global] ? ok(raiz[global]) : falha(new Error('biblioteca não carregou'));
            s.onerror = () => falha(new Error('sem acesso à biblioteca de PowerPoint (internet?)'));
            document.head.appendChild(s);
        });
    }

    async function gerarApresentacao(ev) {
        const btn = ev && ev.currentTarget;
        const txt = btn ? btn.innerHTML : '';
        const status = m => { if (btn) btn.innerHTML = m; };
        try {
            if (btn) btn.style.pointerEvents = 'none';
            status('⏳ Carregando dados de todas as abas…');
            const PptxGenJS = await carregarScript(URL_PPTXGEN, 'PptxGenJS');
            const D = await coletar();
            status('⏳ Montando a apresentação…');
            const pres = montar(PptxGenJS, D);
            const nome = nomeArquivo(D);
            const blob = await pres.write({ outputType: 'blob' });
            if (raiz.P3EmAppDesktop && raiz.P3EmAppDesktop()) {
                // .exe: download bloqueado no WebView2 — abre no navegador comum (ver dashboard-rede-protecao.js).
                const b64 = await new Promise((ok, falha) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = falha; r.readAsDataURL(blob); });
                await raiz.P3AbrirConteudoNoNavegador({ tipo: 'apresentacao', titulo: `Indicadores Operacionais — ${D.unidade}`, nome, pptxBase64: b64 });
            } else {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob); a.download = nome;
                document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(a.href), 4000);
            }
        } catch (e) {
            console.error('[cruzado-pptx]', e);
            alert('Não foi possível gerar a apresentação: ' + e.message);
        } finally {
            if (btn) { btn.innerHTML = txt; btn.style.pointerEvents = ''; }
        }
    }

    const api = { coletar, montar, nomeArquivo, gerarApresentacao };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else { raiz.DashCruzadoPPTX = api; raiz.gerarApresentacaoCruzado = gerarApresentacao; }
})(typeof window !== 'undefined' ? window : globalThis);
