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
    const LOGO_PADRAO = '../img/brasao-limpo.png'; // brasão com contorno limpo (gerado de img/brasao.png)

    const COR = {
        navy: '0B2545', azul: '2F5FDD', anterior: 'A9B4C8', claro: 'F3F5FA', texto: '1C2333',
        muted: '6B7280', borda: 'E5E7EB', bom: '1E8E5A', ruim: 'C53030', neutro: '6B7280', branco: 'FFFFFF',
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
    // Visual: capa/encerramento em azul-marinho; conteúdo em fundo claro com
    // cartões brancos (sombra suave), ícone colorido por indicador e
    // etiquetas ▲/▼ de variação. SEM slide master/layout próprio de
    // propósito: cada slide desenha fundo, logo, rodapé e número — o leitor
    // da pré-visualização no navegador (pptx-preview) quebra com layouts
    // personalizados ("reading 'background'"); no PowerPoint fica idêntico.
    const VISUAL = {
        mvicvli: { icone: '🚨', cor: 'B42318' }, cvp: { icone: '💰', cor: 'C2410C' }, tco: { icone: '📋', cor: '1D4ED8' },
        armas: { icone: '🔫', cor: '166534' }, drogas: { icone: '💊', cor: 'B45309' }, visita: { icone: '🏠', cor: '0E7490' },
        perturbacao: { icone: '🔊', cor: '0F766E' }, violencia: { icone: '🛡️', cor: 'BE185D' }, mandados: { icone: '📜', cor: '4338CA' },
        materiais: { icone: '📦', cor: '6D28D9' }, rede: { icone: '🤝', cor: '9D174D' },
    };
    const FUNDO_CLARO = 'F4F6FA';

    function montar(PptxGenJS, D) {
        const pres = new PptxGenJS();
        pres.layout = 'LAYOUT_WIDE'; // 13,33" x 7,5"
        pres.title = `Indicadores — ${D.unidade}`;
        pres.company = D.unidade.replace(/&/g, '&amp;');
        pres.theme = { headFontFace: FONTE, bodyFontFace: FONTE };

        const W = 13.333, Hs = 7.5;
        const periodo = `${dataBR(D.ini)} a ${dataBR(D.fim)}`;
        const periodoAnt = `${dataBR(D.iniAnt)} a ${dataBR(D.fimAnt)}`;
        const local = D.cidade ? ` • Cidade: ${D.cidade}` : '';
        const cats = D.categorias.filter(c => !c.erro);
        const totalSlides = 3 + D.categorias.length + (D.rede ? 1 : 0) + 1;
        let numSlide = 0;
        const nomeAtual = `${D.ini.getFullYear() === D.fim.getFullYear() ? D.fim.getFullYear() : 'Atual'}`;
        const nomeAnterior = `${D.iniAnt.getFullYear() === D.fimAnt.getFullYear() ? D.fimAnt.getFullYear() : 'Anterior'}`;

        // ── peças reutilizáveis (objetos de opção sempre novos — pptxgenjs os altera) ──
        const sombra = () => ({ type: 'outer', blur: 8, offset: 2, angle: 90, color: '0B2545', opacity: 0.12 });
        const texto = (s, t, o) => s.addText(t, Object.assign({ fontFace: FONTE, margin: 0, isTextBox: true }, o));
        const logoBox = (x, y, alturaMax, larguraMax) => {
            if (!D.logo) return null;
            let h = alturaMax, w = h * D.logo.proporcao;
            if (w > larguraMax) { w = larguraMax; h = w / D.logo.proporcao; }
            return { data: D.logo.data, x: x + (larguraMax - w) / 2, y: y + (alturaMax - h) / 2, w, h };
        };
        const novoSlide = (escuro) => {
            const s = pres.addSlide();
            numSlide++;
            s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: W, h: Hs, fill: { color: escuro ? COR.navy : FUNDO_CLARO }, line: { color: escuro ? COR.navy : FUNDO_CLARO } });
            return s;
        };
        const moldura = (s) => {
            const lg = logoBox(12.05, 0.28, 0.72, 0.8);
            if (lg) s.addImage(lg);
            texto(s, `${D.unidade} • ${periodo} comparado com ${periodoAnt}${local}`, { x: 0.5, y: 7.05, w: 10.8, h: 0.28, fontSize: 9, color: COR.muted });
            texto(s, `${numSlide} / ${totalSlides}`, { x: 11.8, y: 7.05, w: 1.05, h: 0.28, fontSize: 9, color: COR.muted, align: 'right' });
        };
        const cabecalho = (s, icone, cor, titulo, sub) => {
            s.addShape(pres.shapes.OVAL, { x: 0.5, y: 0.33, w: 0.72, h: 0.72, fill: { color: cor }, line: { color: cor } });
            texto(s, icone, { x: 0.5, y: 0.33, w: 0.72, h: 0.72, fontSize: 20, align: 'center', valign: 'middle' });
            texto(s, titulo, { x: 1.42, y: 0.28, w: 10.4, h: 0.55, fontSize: 26, bold: true, color: COR.navy, fit: 'shrink' });
            if (sub) texto(s, sub, { x: 1.42, y: 0.83, w: 10.4, h: 0.3, fontSize: 12, color: COR.muted });
            moldura(s);
        };
        const cartao = (s, x, y, w, h) => s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.12, fill: { color: COR.branco }, line: { color: 'E6EAF2', width: 0.75 }, shadow: sombra() });
        const pill = (s, x, y, w, txt, fundo, cor, tam) => {
            s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h: 0.32, rectRadius: 0.16, fill: { color: fundo }, line: { color: fundo } });
            texto(s, txt, { x, y, w, h: 0.32, fontSize: tam || 11, bold: true, color: cor, align: 'center', valign: 'middle' });
        };
        const estiloVar = (cat, v) => {
            const cor = corVariacao(cat, v.sinal);
            const seta = v.sinal > 0 ? '▲ ' : (v.sinal < 0 ? '▼ ' : '');
            const fundo = cor === COR.bom ? 'E3F4EA' : (cor === COR.ruim ? 'FBE4E4' : 'EDEFF3');
            return { txt: seta + v.txt, cor, fundo };
        };
        const kpi = (s, x, y, w, h, rotulo, valor, corValor, rodape, varObj) => {
            cartao(s, x, y, w, h);
            texto(s, rotulo.toUpperCase(), { x: x + 0.22, y: y + 0.16, w: w - 0.44, h: 0.26, fontSize: 10, bold: true, color: COR.muted, charSpacing: 1 });
            texto(s, String(valor), { x: x + 0.22, y: y + 0.44, w: w - 0.44, h: 0.6, fontSize: 30, bold: true, color: corValor, fit: 'shrink' });
            if (varObj) pill(s, x + 0.22, y + h - 0.46, Math.min(1.5, w - 0.44), varObj.txt, varObj.fundo, varObj.cor, 10);
            else if (rodape) texto(s, rodape, { x: x + 0.22, y: y + h - 0.42, w: w - 0.44, h: 0.28, fontSize: 10, color: COR.muted });
            if (varObj && rodape) texto(s, rodape, { x: x + 1.82, y: y + h - 0.46, w: w - 2.04, h: 0.32, fontSize: 9.5, color: COR.muted, valign: 'middle' });
        };
        const optsGrafico = (x, y, w, h, extra) => Object.assign({
            x, y, w, h, barGrouping: 'clustered',
            showLegend: true, legendPos: 't', legendFontSize: 10, legendFontFace: FONTE, legendColor: COR.texto,
            showTitle: false,
            catAxisLabelFontSize: 9, valAxisLabelFontSize: 9, catAxisLabelColor: COR.muted, valAxisLabelColor: COR.muted,
            catAxisLabelFontFace: FONTE, valAxisLabelFontFace: FONTE, catAxisLineShow: false, valAxisLineShow: false,
            valGridLine: { color: 'E8ECF3', size: 0.5 }, catGridLine: { style: 'none' },
            showValue: true, dataLabelFontSize: 8, dataLabelColor: COR.texto, dataLabelFontFace: FONTE, dataLabelPosition: 'outEnd',
            valAxisLabelFormatCode: '#,##0', dataLabelFormatCode: '#,##0', barGapWidthPct: 60,
        }, extra || {});
        const rotuloCartao = (s, x, y, w, txt) => texto(s, txt, { x: x + 0.25, y: y + 0.16, w: w - 0.5, h: 0.32, fontSize: 13, bold: true, color: COR.navy });

        // ══ 1. Capa ══
        let s = novoSlide(true);
        s.addShape(pres.shapes.OVAL, { x: 8.6, y: -2.2, w: 7.2, h: 7.2, fill: { color: '163A66', transparency: 35 }, line: { color: '163A66', transparency: 100 } });
        s.addShape(pres.shapes.OVAL, { x: 10.6, y: 4.3, w: 4.4, h: 4.4, fill: { color: '1F4E86', transparency: 55 }, line: { color: '1F4E86', transparency: 100 } });
        const lc = logoBox(0.85, 1.35, 4.5, 3.4);
        if (lc) s.addImage(lc);
        texto(s, D.unidade.toUpperCase(), { x: 4.75, y: 1.55, w: 7.9, h: 0.4, fontSize: 15, bold: true, color: '9FB4D6', charSpacing: 2 });
        texto(s, 'Indicadores Operacionais', { x: 4.75, y: 2.0, w: 7.9, h: 0.95, fontSize: 44, bold: true, color: COR.branco, fit: 'shrink' });
        texto(s, 'Período selecionado comparado com o mesmo período do ano anterior', { x: 4.75, y: 2.95, w: 7.9, h: 0.42, fontSize: 17, color: 'C9D3E8' });
        pill(s, 4.75, 3.75, 3.55, `ATUAL  ${periodo}`, COR.azul, COR.branco, 12);
        pill(s, 8.45, 3.75, 3.85, `COMPARAÇÃO  ${periodoAnt}`, '1F3B63', 'C9D3E8', 12);
        if (D.cidade) pill(s, 4.75, 4.22, 3.55, `CIDADE  ${D.cidade}`, '1F3B63', 'C9D3E8', 12);
        texto(s, `Gerado em ${D.geradoEm.toLocaleString('pt-BR')}${D.usuario ? ' por ' + D.usuario : ''} • Fonte: Sistema P3 (Dashboard Cruzado)`,
            { x: 4.75, y: 6.6, w: 8.1, h: 0.3, fontSize: 10, color: '8FA3C4' });

        // ══ 2. Visão geral ══
        s = novoSlide(false);
        cabecalho(s, '📊', COR.navy, 'Visão geral do período', `${periodo} comparado com ${periodoAnt}${local}`);
        cartao(s, 0.5, 1.45, 7.55, 5.35);
        const cab = ['Indicador', nomeAtual, nomeAnterior, 'Variação'].map((t, i) => ({ text: t, options: { bold: true, color: COR.muted, fill: { color: 'F1F4F9' }, align: i ? 'center' : 'left', fontSize: 10 } }));
        const linhas = [cab];
        const linha = (rotulo, a, p, v, cat, fv, destaqueRot) => {
            const ev = v ? estiloVar(cat, v) : null;
            linhas.push([
                { text: rotulo, options: { bold: !destaqueRot, color: destaqueRot ? COR.muted : COR.texto } },
                { text: fv(a), options: { align: 'center', bold: true, color: COR.navy } },
                { text: p == null ? '—' : fv(p), options: { align: 'center', color: COR.muted } },
                ev ? { text: ev.txt, options: { align: 'center', bold: true, color: ev.cor } } : { text: 'sem base', options: { align: 'center', color: COR.muted } },
            ]);
        };
        cats.forEach(c => {
            const fv = c.peso ? fmtPeso : fmtN;
            linha(c.label.split(' — ')[0], c.atual, c.anterior, variacao(c.atual, c.anterior), c.cat, fv);
            if (c.cat === 'mvicvli' && c.extra) linha('   ↳ MVI (mortes violentas)', c.extra.atual, c.extra.anterior, variacao(c.extra.atual, c.extra.anterior), 'mvicvli', fmtN, true);
        });
        const redeSemAnterior = D.rede && !D.rede.anterior.total;
        if (D.rede) linha('Rede de Proteção (vítimas)', D.rede.atual.total, redeSemAnterior ? null : D.rede.anterior.total,
            redeSemAnterior ? null : variacao(D.rede.atual.total, D.rede.anterior.total), 'violencia', fmtN);
        const altLinha = Math.min(0.37, 4.95 / linhas.length);
        s.addTable(linhas, { x: 0.68, y: 1.62, w: 7.2, colW: [3.3, 1.3, 1.3, 1.3], rowH: altLinha, margin: [2, 6, 2, 6], fontFace: FONTE,
            fontSize: linhas.length > 12 ? 10.5 : 11.5, color: COR.texto, valign: 'middle',
            border: [{ type: 'none' }, { type: 'none' }, { type: 'solid', pt: 0.5, color: 'E8ECF3' }, { type: 'none' }] });
        cartao(s, 8.25, 1.45, 4.58, 5.35);
        rotuloCartao(s, 8.25, 1.45, 4.58, 'Registros por indicador');
        const contaveis = cats.filter(c => !c.peso);
        const rot = contaveis.map(c => c.label.split(' — ')[0].replace('Cumprimento de ', '').replace(' Apreendidas', '').replace(' Apreendidos', ''));
        s.addChart(pres.charts.BAR, [
            { name: nomeAnterior, labels: rot, values: contaveis.map(c => c.anterior) },
            { name: nomeAtual, labels: rot, values: contaveis.map(c => c.atual) },
        ], optsGrafico(8.35, 1.85, 4.38, 4.85, { barDir: 'bar', chartColors: [COR.anterior, COR.azul], dataLabelFontSize: 7, catAxisLabelFontSize: 8.5, catAxisOrientation: 'maxMin', valAxisHidden: true, valGridLine: { style: 'none' } }));
        texto(s, '▲▼ verde = favorável • vermelho = ponto de atenção (crimes: queda é favorável; apreensões, mandados e visitas: alta é favorável) • cinza = neutro',
            { x: 0.5, y: 6.83, w: 12.3, h: 0.22, fontSize: 8.5, italic: true, color: COR.muted });

        // ══ 3. Destaques ══
        s = novoSlide(false);
        cabecalho(s, '⭐', 'B7791F', 'Destaques do período', 'Maiores variações em relação ao mesmo período do ano anterior');
        const comVar = cats.map(c => Object.assign({ v: variacao(c.atual, c.anterior) }, c)).filter(c => c.v.pct != null && c.anterior >= 3);
        const favor = comVar.filter(c => SUBIR_EH_BOM[c.cat] != null && corVariacao(c.cat, c.v.sinal) === COR.bom).sort((a, b) => Math.abs(b.v.pct) - Math.abs(a.v.pct)).slice(0, 4);
        const desfavor = comVar.filter(c => SUBIR_EH_BOM[c.cat] != null && corVariacao(c.cat, c.v.sinal) === COR.ruim).sort((a, b) => Math.abs(b.v.pct) - Math.abs(a.v.pct)).slice(0, 4);
        const bloco = (x, titulo, cor, fundo, lista, vazio) => {
            cartao(s, x, 1.45, 5.98, 5.35);
            pill(s, x + 0.3, 1.68, 2.9, titulo, fundo, cor, 12);
            if (!lista.length) { texto(s, vazio, { x: x + 0.3, y: 2.3, w: 5.4, h: 0.5, fontSize: 14, color: COR.muted }); return; }
            lista.forEach((c, i) => {
                const y = 2.25 + i * 1.1, fv = c.peso ? fmtPeso : fmtN, vis = VISUAL[c.cat] || {};
                s.addShape(pres.shapes.OVAL, { x: x + 0.3, y: y + 0.12, w: 0.6, h: 0.6, fill: { color: vis.cor || COR.navy }, line: { color: vis.cor || COR.navy } });
                texto(s, vis.icone || '', { x: x + 0.3, y: y + 0.12, w: 0.6, h: 0.6, fontSize: 16, align: 'center', valign: 'middle' });
                texto(s, [{ text: c.label.split(' — ')[0], options: { bold: true, color: COR.texto, breakLine: true } }, { text: `${fv(c.anterior)}  →  ${fv(c.atual)}`, options: { color: COR.muted } }],
                    { x: x + 1.05, y, w: 3.0, h: 0.85, fontSize: 13, valign: 'middle' });
                texto(s, (c.v.sinal > 0 ? '▲ ' : '▼ ') + c.v.txt, { x: x + 3.95, y, w: 1.8, h: 0.85, fontSize: 24, bold: true, color: cor, align: 'right', valign: 'middle' });
            });
        };
        bloco(0.5, 'RESULTADOS FAVORÁVEIS', COR.bom, 'E3F4EA', favor, 'Nenhuma variação favorável relevante.');
        bloco(6.85, 'PONTOS DE ATENÇÃO', COR.ruim, 'FBE4E4', desfavor, 'Nenhuma variação desfavorável relevante.');

        // ══ 4. Um slide por aba ══
        D.categorias.forEach(c => {
            const vis = VISUAL[c.cat] || { icone: '•', cor: COR.navy };
            s = novoSlide(false);
            cabecalho(s, vis.icone, vis.cor, c.label, `${periodo} comparado com ${periodoAnt}${local}`);
            if (c.erro) { texto(s, `Não foi possível carregar os dados desta aba: ${c.erro}`, { x: 0.5, y: 2, w: 12.3, h: 0.6, fontSize: 16, color: COR.ruim }); return; }
            const v = variacao(c.atual, c.anterior), fv = c.peso ? fmtPeso : fmtN;
            const cw = 2.93, gap = 0.2, ky = 1.45, kh = 1.35;
            kpi(s, 0.5, ky, cw, kh, `Período atual (${nomeAtual})`, fv(c.atual), vis.cor, c.peso ? `${fmtN(c.registrosAtual)} apreensão(ões)` : 'registros');
            kpi(s, 0.5 + (cw + gap), ky, cw, kh, `Mesmo período (${nomeAnterior})`, fv(c.anterior), COR.muted, c.peso ? `${fmtN(c.registrosAnterior)} apreensão(ões)` : 'registros');
            const ev = estiloVar(c.cat, v);
            kpi(s, 0.5 + 2 * (cw + gap), ky, cw, kh, 'Variação', ev.txt, ev.cor,
                SUBIR_EH_BOM[c.cat] == null ? 'indicador neutro' : (v.sinal ? (ev.cor === COR.bom ? 'resultado favorável' : 'ponto de atenção') : 'estável'));
            if (c.extra) {
                const ve = variacao(c.extra.atual, c.extra.anterior);
                kpi(s, 0.5 + 3 * (cw + gap), ky, cw, kh, c.extra.rotulo, fmtN(c.extra.atual), COR.navy, `antes: ${fmtN(c.extra.anterior)}`,
                    estiloVar(c.cat === 'mvicvli' ? 'mvicvli' : c.cat, ve));
            } else {
                const nm = Math.max(1, D.meses.length);
                kpi(s, 0.5 + 3 * (cw + gap), ky, cw, kh, 'Média mensal', fv(c.atual / nm), COR.navy, `antes: ${fv(c.anterior / nm)}`);
            }

            const kg = c.peso && Math.max(...c.mesAtual, ...c.mesAnterior, 0) >= 1000;
            const escala = arr => kg ? arr.map(x => Math.round(x / 10) / 100) : arr.map(x => Math.round(x * 100) / 100);
            const unid = c.peso ? (kg ? ' (kg)' : ' (g)') : '';
            const fmtCod = kg ? '#,##0.0' : '#,##0';
            const gy = 3.0, gh = 3.55;
            cartao(s, 0.5, gy, 7.15, gh);
            rotuloCartao(s, 0.5, gy, 7.15, 'Evolução mensal' + unid);
            cartao(s, 7.85, gy, 4.98, gh);
            rotuloCartao(s, 7.85, gy, 4.98, `Principais — ${c.labelTip}${unid}`);
            if (c.atual || c.anterior) {
                s.addChart(pres.charts.BAR, [
                    { name: nomeAnterior, labels: D.meses.map(m => m.charAt(0).toUpperCase() + m.slice(1)), values: escala(c.mesAnterior) },
                    { name: nomeAtual, labels: D.meses.map(m => m.charAt(0).toUpperCase() + m.slice(1)), values: escala(c.mesAtual) },
                ], optsGrafico(0.6, gy + 0.45, 6.95, gh - 0.55, { barDir: 'col', chartColors: [COR.anterior, vis.cor], valAxisLabelFormatCode: fmtCod, dataLabelFormatCode: fmtCod, dataLabelFontSize: D.meses.length > 8 ? 7 : 8 }));
                if (c.topTip.length) {
                    const rotTip = c.topTip.map(t => t.length > 34 ? t.slice(0, 32) + '…' : t);
                    s.addChart(pres.charts.BAR, [
                        { name: nomeAnterior, labels: rotTip, values: escala(c.tipAnterior) },
                        { name: nomeAtual, labels: rotTip, values: escala(c.tipAtual) },
                    ], optsGrafico(7.95, gy + 0.45, 4.78, gh - 0.55, { barDir: 'bar', chartColors: [COR.anterior, vis.cor], valAxisLabelFormatCode: fmtCod, dataLabelFormatCode: fmtCod,
                        catAxisLabelFontSize: 8, catAxisOrientation: 'maxMin', valAxisHidden: true, valGridLine: { style: 'none' }, dataLabelFontSize: 7.5 }));
                }
            } else {
                texto(s, 'Sem registros no período atual nem no mesmo período do ano anterior.', { x: 0.5, y: 4.4, w: 12.3, h: 0.5, fontSize: 15, color: COR.muted, align: 'center' });
            }
            if (c.topCidades.length) {
                texto(s, [{ text: 'Cidades com mais registros:  ', options: { bold: true, color: COR.navy } },
                    { text: c.topCidades.map(([k, n]) => `${k} (${fv(n)})`).join('   •   '), options: { color: COR.texto } }],
                { x: 0.5, y: 6.66, w: 12.3, h: 0.3, fontSize: 11 });
            }
        });

        // ══ 5. Rede de Proteção ══
        if (D.rede) {
            const A = D.rede.atual, P = D.rede.anterior, vis = VISUAL.rede;
            s = novoSlide(false);
            cabecalho(s, vis.icone, vis.cor, 'Rede de Proteção — Grupos Vulneráveis', `Vítimas de violência registradas pela PM (CAD) • ${periodo}${local}`);
            const cw = 2.93, gap = 0.2;
            [['Vítimas', A.total, P.total], ['Mulheres', A.mulheres, P.mulheres], ['Crianças e adolescentes', A.criancasAdolescentes, P.criancasAdolescentes], ['Pessoas idosas (60+)', A.idosos, P.idosos]]
                .forEach(([r, a, p], i) => kpi(s, 0.5 + i * (cw + gap), 1.45, cw, 1.35, r, fmtN(a), vis.cor,
                    redeSemAnterior ? 'ano anterior não importado' : `antes: ${fmtN(p)}`, redeSemAnterior ? null : estiloVar('violencia', variacao(a, p))));
            const tipos = Object.keys(A.porTipo).filter(k => (A.porTipo[k] || 0) + (P.porTipo[k] || 0) > 0);
            cartao(s, 0.5, 3.0, 12.33, 3.55);
            rotuloCartao(s, 0.5, 3.0, 12.33, 'Tipos de violência (múltipla resposta)');
            if (tipos.length) {
                const series = [{ name: nomeAtual, labels: tipos, values: tipos.map(k => A.porTipo[k] || 0) }];
                if (!redeSemAnterior) series.unshift({ name: nomeAnterior, labels: tipos, values: tipos.map(k => P.porTipo[k] || 0) });
                s.addChart(pres.charts.BAR, series, optsGrafico(0.6, 3.45, 12.13, 3.0, { barDir: 'col', chartColors: redeSemAnterior ? [vis.cor] : [COR.anterior, vis.cor], showLegend: !redeSemAnterior }));
            }
            if (redeSemAnterior) texto(s, 'O período anterior ainda não foi importado do CAD na aba Rede de Proteção ("Buscar vítimas no CAD") — por isso não há comparação.',
                { x: 0.5, y: 6.66, w: 12.3, h: 0.3, fontSize: 10, italic: true, color: COR.muted });
        }

        // ══ 6. Notas e fonte ══
        s = novoSlide(true);
        s.addShape(pres.shapes.OVAL, { x: 9.8, y: 3.6, w: 6, h: 6, fill: { color: '163A66', transparency: 40 }, line: { color: '163A66', transparency: 100 } });
        texto(s, 'Notas metodológicas', { x: 0.8, y: 0.7, w: 11.7, h: 0.7, fontSize: 32, bold: true, color: COR.branco });
        texto(s, [
            `Período atual: ${periodo}; comparação: ${periodoAnt} (mesmo período do ano anterior).`,
            'Contagens seguem as mesmas regras de cada aba do Dashboard Cruzado do Sistema P3 (Firebase, planilhas de TCO e Materiais).',
            'MVI: homicídio, latrocínio, feminicídio e homicídio ao volante; tentativas só contam com óbito confirmado.',
            'Drogas: valores em peso apreendido (g/kg); demais indicadores em número de registros.',
            D.cidade ? `Filtro de cidade aplicado: ${D.cidade}.` : 'Todas as cidades da área da unidade.',
            D.rede ? 'Rede de Proteção: vítimas (tipo de envolvimento = vítima) do CAD, apenas ocorrências com violência.' : null,
        ].filter(Boolean).map((t, i, arr) => ({ text: t, options: { bullet: { indent: 18 }, breakLine: i < arr.length - 1 } })),
        { x: 0.8, y: 1.65, w: 11.4, h: 4.2, fontSize: 16, color: 'DCE3F0', paraSpaceAfter: 10, valign: 'top' });
        const ln = logoBox(0.8, 5.95, 1.0, 1.0);
        if (ln) s.addImage(ln);
        texto(s, `${D.unidade} • Sistema P3`, { x: 2.0, y: 6.25, w: 9, h: 0.4, fontSize: 14, bold: true, color: 'C9D3E8' });
        texto(s, `${numSlide} / ${totalSlides}`, { x: 11.8, y: 7.05, w: 1.05, h: 0.28, fontSize: 9, color: '8FA3C4', align: 'right' });

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
                // semPrevia: o leitor de pré-visualização do navegador (pptx-preview) não
                // abre arquivos da pptxgenjs com mais de 1 slide — a página mostra o sumário.
                const sumario = ['Capa', 'Visão geral do período', 'Destaques do período'].concat(D.categorias.map(c => c.label), D.rede ? ['Rede de Proteção — Grupos Vulneráveis'] : [], ['Notas metodológicas']);
                await raiz.P3AbrirConteudoNoNavegador({ tipo: 'apresentacao', titulo: `Indicadores Operacionais — ${D.unidade}`, nome, pptxBase64: b64, semPrevia: true, sumario,
                    periodo: `${D.ini.toLocaleDateString('pt-BR')} a ${D.fim.toLocaleDateString('pt-BR')} (comparado com ${D.iniAnt.toLocaleDateString('pt-BR')} a ${D.fimAnt.toLocaleDateString('pt-BR')})` });
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
