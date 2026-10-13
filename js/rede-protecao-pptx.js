// ═══════════════════════════════════════════════════════════════════
// REDE DE PROTEÇÃO — GERADOR DO POWERPOINT A PARTIR DO MODELO OFICIAL
// ═══════════════════════════════════════════════════════════════════
// Preenche o "Modelo Padronizado — Apresentação dos dados dos serviços da
// Rede de Proteção" (modelos/Modelo_Padronizado_Rede_Protecao_2026.pptx,
// cópia EXATA do arquivo recebido) com os dados da aba Rede de Proteção do
// Dashboard P3 (js/dashboard-rede-protecao.js). Nada de layout é recriado:
// o .pptx original é aberto (JSZip) e só são trocados
//   · os textos entre [colchetes] (por nome da caixa de texto do modelo),
//     reduzindo a fonte quando o conteúdo não cabe no cartão;
//   · os dados dos 8 gráficos NATIVOS (cache do gráfico + a planilha
//     embutida, pra continuarem editáveis no PowerPoint) + rótulos de valor;
//   · o período e a cidade do rodapé.
// Funciona no navegador (window.RedeProtecaoPPTX) e no Node (testes).
// ═══════════════════════════════════════════════════════════════════
(function (raiz) {
    'use strict';

    const MODELO_URL = '../modelos/Modelo_Padronizado_Rede_Protecao_2026.pptx';
    const MIME_PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

    const MUNICIPIOS_10BPM = ['Palmeira dos Índios', 'Belém', 'Cacimbinhas', 'Estrela de Alagoas', 'Igaci', 'Mar Vermelho',
        'Maribondo', 'Minador do Negrão', 'Paulo Jacinto', 'Quebrangulo', "Tanque d'Arca"];

    const IDENT_PADRAO = {
        nome: '10º Batalhão de Polícia Militar (10º BPM)',
        orgao: 'SSP-AL — Polícia Militar de Alagoas',
        territorio: `${MUNICIPIOS_10BPM.length} municípios: ${MUNICIPIOS_10BPM.slice(0, -1).join(', ')} e ${MUNICIPIOS_10BPM[MUNICIPIOS_10BPM.length - 1]}`,
        responsavel: '1º TEN CALHEIROS',
        oquefazemos: 'Atendimento emergencial às ocorrências de violência (190), proteção imediata da vítima, condução das partes à autoridade policial, fiscalização de medidas protetivas e encaminhamento à rede de proteção.',
        porta: 'Demanda espontânea (190/COPOM), abordagem em policiamento ostensivo e solicitação de outros órgãos da rede',
        contato: '[Telefone • e-mail • endereço • horário]',
    };

    // Rótulos curtos pros cartões/gráficos (o cartão do modelo é estreito).
    const ROTULO_CURTO = {
        'Acionamento direto à PM (190/COPOM/ronda)': 'Demanda espontânea (190/COPOM)',
        'Segurança Pública (outros órgãos)': 'Segurança Pública',
        'Familiar / parceiro(a) íntimo(a)': 'Familiar/parceiro(a) íntimo(a)',
        'Sem afinidade / desconhecido(a)': 'Sem afinidade/desconhecido(a)',
    };
    const curto = s => ROTULO_CURTO[s] || s;

    const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    const nrm = s => (s == null ? '' : String(s)).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
    const xml = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const pct = (n, t) => t ? (n / t * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%' : '0,0%';
    const fmtN = n => Number(n || 0).toLocaleString('pt-BR');
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    const dataBR = d => d ? d.toLocaleDateString('pt-BR') : '…';

    // ── Textos de período/local ─────────────────────────────────────
    function textoPeriodo(ini, fim) {
        if (!ini || !fim) return 'período disponível na base';
        const mi = MESES[ini.getMonth()], mf = MESES[fim.getMonth()];
        if (ini.getFullYear() === fim.getFullYear()) {
            if (ini.getMonth() === fim.getMonth()) return `${mi} de ${fim.getFullYear()}`;
            return `${mi} a ${mf} de ${fim.getFullYear()}`;
        }
        return `${mi} de ${ini.getFullYear()} a ${mf} de ${fim.getFullYear()}`;
    }
    function nomeCidade(cidNorm) {
        if (!cidNorm) return null;
        return MUNICIPIOS_10BPM.find(m => nrm(m) === nrm(cidNorm).replace(/ D ARCA/, " D'ARCA")) ||
            nrm(cidNorm).toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
    }

    // ── Medição aproximada de texto (Aptos) pra caber nos cartões ────
    function larguraTexto(txt, sz, negrito) {
        let w = 0;
        for (const ch of txt) {
            if (ch === ' ') w += 0.26;
            else if (/[A-ZÁÉÍÓÚÂÊÔÃÕÇÀ0-9%]/.test(ch)) w += negrito ? 0.66 : 0.6;
            else if (/[•.,:;'()\-|/ilj!]/.test(ch)) w += 0.3;
            else if (/[mwMW]/.test(ch)) w += 0.85;
            else w += negrito ? 0.54 : 0.5;
        }
        return w * sz; // pt
    }
    function linhasTexto(txt, sz, negrito, larguraPt) {
        const palavras = String(txt).split(/\s+/).filter(Boolean);
        if (!palavras.length) return 1;
        let linhas = 1, atual = 0;
        const esp = larguraTexto(' ', sz, negrito);
        for (const p of palavras) {
            const w = larguraTexto(p, sz, negrito);
            if (atual === 0) { atual = w; if (w > larguraPt) linhas += Math.ceil(w / larguraPt) - 1; continue; }
            if (atual + esp + w <= larguraPt) atual += esp + w;
            else { linhas++; atual = w; }
        }
        return linhas;
    }

    // ── Manipulação de slide ────────────────────────────────────────
    const EMU_PT = 12700;
    function atributoNum(s, nome, padrao) { const m = s.match(new RegExp(nome + '="(-?\\d+)"')); return m ? +m[1] : padrao; }

    function formas(slideXml) {
        const lista = [];
        const re = /<p:sp>[\s\S]*?<\/p:sp>/g;
        let m;
        while ((m = re.exec(slideXml))) {
            const sp = m[0];
            const nome = (sp.match(/<p:cNvPr id="\d+" name="([^"]*)"/) || [])[1];
            const off = sp.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/), ext = sp.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
            if (!nome || !off || !ext) continue;
            lista.push({ nome, sp, x: +off[1], y: +off[2], cx: +ext[1], cy: +ext[2],
                card: /prst="roundRect"/.test(sp), texto: /<a:t>/.test(sp) });
        }
        return lista;
    }

    // Altura máxima disponível pra caixa: até o próximo texto abaixo (na
    // mesma coluna), o fim do cartão que a contém, ou a faixa de nota do rodapé.
    function alturaDisponivel(todas, f) {
        const sobrepoe = o => o.x < f.x + f.cx && o.x + o.cx > f.x;
        // Topo da faixa de orientação (igual em todos os slides do modelo) — ou
        // o fim do slide, pra caixas que já estão dentro dessa faixa/rodapé.
        let limite = f.y < 5989320 ? 5989320 : 6858000;
        todas.forEach(o => {
            if (o === f) return;
            if (o.card && o.x <= f.x && o.x + o.cx >= f.x + f.cx && o.y <= f.y && o.y + o.cy > f.y) limite = Math.min(limite, o.y + o.cy - 20000);
            else if (o.texto && sobrepoe(o) && o.y > f.y + 10000) limite = Math.min(limite, o.y - 30000);
            else if (o.card && sobrepoe(o) && o.y > f.y + 10000) limite = Math.min(limite, o.y - 30000);
        });
        return Math.max(limite - f.y, 200000);
    }

    // Troca TODOS os parágrafos da caixa `nome` por `paras` — cada item é
    // string ou {texto, rel (fator do tamanho base), b}. Mantém pPr/defRPr do
    // 1º parágrafo do modelo e reduz o tamanho até caber na altura disponível.
    function definirTexto(slideXml, nome, paras, opc) {
        opc = opc || {};
        const todas = formas(slideXml);
        const f = todas.find(o => o.nome === nome);
        if (!f) { console.warn('[RedeProtecaoPPTX] caixa não encontrada:', nome); return slideXml; }
        const pModelo = (f.sp.match(/<a:p>[\s\S]*?<\/a:p>/) || [''])[0];
        const pPr = (pModelo.match(/<a:pPr[\s\S]*?<\/a:pPr>|<a:pPr[^>]*\/>/) || [''])[0];
        const szBase = atributoNum(pPr, 'sz', 1800);
        const negritoBase = /\bb="1"/.test(pPr);
        const itens = [].concat(paras).map(p => typeof p === 'string' ? { texto: p } : p);

        const lIns = atributoNum(f.sp.match(/<a:bodyPr[^>]*>/)[0], 'lIns', 91440), rIns = atributoNum(f.sp.match(/<a:bodyPr[^>]*>/)[0], 'rIns', 91440);
        const larguraPt = (f.cx - lIns - rIns) / EMU_PT;
        const alturaPt = (opc.alturaMax || alturaDisponivel(todas, f)) / EMU_PT - 7; // 7pt = insets sup/inf
        const espaco = opc.espacoEntre != null ? opc.espacoEntre : 0;

        let sz = opc.inicio || szBase;
        const minimo = opc.minimo || 700;
        const altura = s => itens.reduce((h, it) => {
            const szi = Math.round(s * (it.rel || 1));
            const b = it.b != null ? it.b : negritoBase;
            return h + linhasTexto(it.texto, szi / 100, b, larguraPt) * (szi / 100) * 1.17 + espaco;
        }, 0);
        // umaLinha: cada parágrafo numa linha só (listas de destaques).
        const quebra = s => opc.umaLinha && itens.some(it => linhasTexto(it.texto, Math.round(s * (it.rel || 1)) / 100, it.b != null ? it.b : negritoBase, larguraPt) > 1);
        while (sz > minimo && (altura(sz) > alturaPt || quebra(sz))) sz -= 50;

        const novos = itens.map(it => {
            const szi = Math.round(sz * (it.rel || 1) / 50) * 50;
            let pp = pPr.replace(/sz="\d+"/, `sz="${szi}"`);
            if (it.b != null) pp = /\bb="[01]"/.test(pp) ? pp.replace(/\bb="[01]"/, `b="${it.b ? 1 : 0}"`) : pp.replace('<a:defRPr ', `<a:defRPr b="${it.b ? 1 : 0}" `);
            return `<a:p>${pp}<a:r>${rPrDe(pp)}<a:t>${xml(it.texto)}</a:t></a:r></a:p>`;
        }).join('');
        const corpo = f.sp.replace(/(<a:lstStyle\/>|<a:lstStyle>[\s\S]*?<\/a:lstStyle>)[\s\S]*<\/p:txBody>/, (_, ls) => `${ls}${novos}</p:txBody>`);
        return slideXml.replace(f.sp, () => corpo);
    }

    // O modelo formata o texto pelo <a:defRPr> do parágrafo (o PowerPoint
    // aplica; leitores como o pptx-preview da pré-visualização, não). Copia a
    // mesma formatação pra um <a:rPr> explícito em cada trecho — visual
    // idêntico no PowerPoint, e a pré-visualização passa a respeitar cor/tamanho.
    function rPrDe(pPr) {
        const m = pPr.match(/<a:defRPr([^>]*?)(\/>|>([\s\S]*?)<\/a:defRPr>)/);
        if (!m) return '<a:rPr lang="pt-BR" dirty="0"/>';
        const attrs = m[1].replace(/\s*lang="[^"]*"/, '');
        return m[3] ? `<a:rPr lang="pt-BR"${attrs} dirty="0">${m[3]}</a:rPr>` : `<a:rPr lang="pt-BR"${attrs} dirty="0"/>`;
    }
    function materializarEstilos(slideXml) {
        return slideXml.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (p, corpo) => {
            const pPr = (corpo.match(/<a:pPr[\s\S]*?<\/a:pPr>/) || [''])[0];
            if (!pPr || !/<a:defRPr/.test(pPr)) return p;
            return p.replace(/<a:r><a:t>/g, () => `<a:r>${rPrDe(pPr)}<a:t>`);
        });
    }

    // ── Gráficos ────────────────────────────────────────────────────
    const COL = n => String.fromCharCode(64 + n);
    function planilhaXml(nomeSerie, rotulos, valores) {
        const linhas = [`<row r="1"><c r="B1" t="inlineStr"><is><t>${xml(nomeSerie)}</t></is></c></row>`];
        rotulos.forEach((r, i) => {
            const n = i + 2;
            linhas.push(`<row r="${n}"><c r="A${n}" t="inlineStr"><is><t>${xml(r)}</t></is></c><c r="B${n}"><v>${+valores[i] || 0}</v></c></row>`);
        });
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${COL(2)}${rotulos.length + 1}"/><sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="34" customWidth="1"/></cols><sheetData>${linhas.join('')}</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
    }

    async function preencherGrafico(JSZip, zip, numero, rotulos, valores, cor, coresPorPonto, titulo) {
        const caminho = `ppt/charts/chart${numero}.xml`;
        let c = await zip.file(caminho).async('string');
        const N = rotulos.length, fim = N + 1;
        let nomeSerie = (c.match(/<c:tx>[\s\S]*?<c:v>([^<]*)<\/c:v>/) || [])[1] || 'Nº de atendimentos';
        if (titulo) {
            // Gráfico de slide clonado (botão do pânico): troca o nome da série e o título.
            c = c.replace(/(<c:ser>[\s\S]*?<c:tx>[\s\S]*?<c:v>)[^<]*(<\/c:v>)/, (_, a, b) => a + xml(titulo) + b);
            c = c.replace(/<c:title>[\s\S]*?<\/c:title>/, bloco => {
                let primeiro = true;
                return bloco.replace(/<a:t>[^<]*<\/a:t>/g, () => { const r = primeiro ? `<a:t>${xml(titulo)}</a:t>` : '<a:t></a:t>'; primeiro = false; return r; });
            });
            nomeSerie = titulo;
        }
        const cat = `<c:cat><c:strRef><c:f>Sheet1!$A$2:$A$${fim}</c:f><c:strCache><c:ptCount val="${N}"/>${rotulos.map((r, i) => `<c:pt idx="${i}"><c:v>${xml(r)}</c:v></c:pt>`).join('')}</c:strCache></c:strRef></c:cat>`;
        const val = `<c:val><c:numRef><c:f>Sheet1!$B$2:$B$${fim}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${N}"/>${valores.map((v, i) => `<c:pt idx="${i}"><c:v>${+v || 0}</c:v></c:pt>`).join('')}</c:numCache></c:numRef></c:val>`;
        c = c.replace(/<c:cat>[\s\S]*?<\/c:cat>/, () => cat).replace(/<c:val>[\s\S]*?<\/c:val>/, () => val);
        // Cor da série (paleta do próprio modelo) + rótulo com o valor (n) em cada barra.
        if (!/<c:ser>[\s\S]*?<c:spPr>/.test(c.split('<c:cat>')[0])) {
            const dPts = (coresPorPonto || []).map((cp, i) => `<c:dPt><c:idx val="${i}"/><c:invertIfNegative val="0"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="${cp}"/></a:solidFill></c:spPr></c:dPt>`).join('');
            c = c.replace(/(<c:ser>[\s\S]*?<\/c:tx>)/, m => `${m}<c:spPr><a:solidFill><a:srgbClr val="${cor}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>${dPts}`);
        }
        if (!/<c:dLbls>/.test(c.split('<c:cat>')[0])) {
            c = c.replace('<c:cat>', `<c:dLbls><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1000" b="1"><a:solidFill><a:srgbClr val="302B37"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="pt-BR"/></a:p></c:txPr><c:dLblPos val="outEnd"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls><c:cat>`);
        }
        // Os gráficos 2–8 do modelo usam título AUTOMÁTICO (o PowerPoint mostra
        // o nome da série, "Nº de atendimentos"). Grava o mesmo título de forma
        // explícita — igual no PowerPoint, e a pré-visualização do navegador
        // deixa de mostrar o texto genérico da biblioteca no lugar.
        if (!/<c:title>/.test(c)) {
            c = c.replace('<c:chart>', `<c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1800" b="1"/></a:pPr><a:r><a:rPr lang="pt-BR" sz="1800" b="1"/><a:t>${xml(nomeSerie)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`);
        }
        zip.file(caminho, c);

        // Planilha embutida (Editar Dados no PowerPoint)
        const rels = await zip.file(`ppt/charts/_rels/chart${numero}.xml.rels`).async('string');
        const alvo = (rels.match(/Target="\.\.\/embeddings\/([^"]+)"/) || [])[1];
        if (alvo) {
            const caminhoXlsx = `ppt/embeddings/${alvo}`;
            const xlsx = await JSZip.loadAsync(await zip.file(caminhoXlsx).async('uint8array'));
            xlsx.file('xl/worksheets/sheet1.xml', planilhaXml(nomeSerie, rotulos, valores));
            zip.file(caminhoXlsx, await xlsx.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
        }
    }

    // ── Slides extras (botão do pânico) ─────────────────────────────
    // Duplica um slide DO PRÓPRIO MODELO (com o gráfico e a planilha embutida
    // dele), registrando as partes novas no pacote — o visual fica idêntico
    // ao do modelo. A posição é definida depois, em inserirSlides().
    const maxNum = (zip, re) => Math.max(0, ...Object.keys(zip.files).map(f => (f.match(re) || [])[1]).filter(Boolean).map(Number));

    async function clonarSlide(zip, origem) {
        const novo = maxNum(zip, /^ppt\/slides\/slide(\d+)\.xml$/) + 1;
        let rels = await zip.file(`ppt/slides/_rels/slide${origem}.xml.rels`).async('string');
        const mChart = rels.match(/Target="\.\.\/charts\/chart(\d+)\.xml"/);
        let novoChart = null;
        if (mChart) {
            novoChart = maxNum(zip, /^ppt\/charts\/chart(\d+)\.xml$/) + 1;
            zip.file(`ppt/charts/chart${novoChart}.xml`, await zip.file(`ppt/charts/chart${mChart[1]}.xml`).async('string'));
            let cRels = await zip.file(`ppt/charts/_rels/chart${mChart[1]}.xml.rels`).async('string');
            const mEmb = cRels.match(/Target="\.\.\/embeddings\/([^"]+)"/);
            if (mEmb) {
                const nomeNovo = `Microsoft_Excel_Sheet${novoChart}.xlsx`;
                zip.file(`ppt/embeddings/${nomeNovo}`, await zip.file(`ppt/embeddings/${mEmb[1]}`).async('uint8array'));
                cRels = cRels.replace(`../embeddings/${mEmb[1]}`, `../embeddings/${nomeNovo}`);
            }
            zip.file(`ppt/charts/_rels/chart${novoChart}.xml.rels`, cRels);
            rels = rels.replace(`../charts/chart${mChart[1]}.xml`, `../charts/chart${novoChart}.xml`);
        }
        zip.file(`ppt/slides/slide${novo}.xml`, await zip.file(`ppt/slides/slide${origem}.xml`).async('string'));
        zip.file(`ppt/slides/_rels/slide${novo}.xml.rels`, rels);

        let ct = await zip.file('[Content_Types].xml').async('string');
        ct = ct.replace('</Types>', `<Override PartName="/ppt/slides/slide${novo}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>` +
            (novoChart ? `<Override PartName="/ppt/charts/chart${novoChart}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>` : '') + '</Types>');
        zip.file('[Content_Types].xml', ct);

        let pr = await zip.file('ppt/_rels/presentation.xml.rels').async('string');
        const rid = 'rId' + (Math.max(0, ...[...pr.matchAll(/Id="rId(\d+)"/g)].map(m => +m[1])) + 1);
        pr = pr.replace('</Relationships>', `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${novo}.xml"/></Relationships>`);
        zip.file('ppt/_rels/presentation.xml.rels', pr);
        return { slide: novo, chart: novoChart, rid };
    }

    // Coloca os slides (por rId) logo depois do slide `depoisDe` (nº do arquivo).
    async function inserirSlides(zip, rids, depoisDe) {
        const pr = await zip.file('ppt/_rels/presentation.xml.rels').async('string');
        const ridAlvo = (pr.match(new RegExp(`Id="(rId\\d+)"[^>]*Target="slides/slide${depoisDe}\\.xml"`)) || [])[1];
        let p = await zip.file('ppt/presentation.xml').async('string');
        let maxId = Math.max(...[...p.matchAll(/<p:sldId id="(\d+)"/g)].map(m => +m[1]));
        const novos = rids.map(r => `<p:sldId id="${++maxId}" r:id="${r}"/>`).join('');
        const alvo = ridAlvo && p.match(new RegExp(`<p:sldId id="\\d+" r:id="${ridAlvo}"/>`));
        p = alvo ? p.replace(alvo[0], alvo[0] + novos) : p.replace('</p:sldIdLst>', novos + '</p:sldIdLst>');
        zip.file('ppt/presentation.xml', p);
    }

    // Nºs dos arquivos de slide na ordem de exibição.
    async function ordemSlides(zip) {
        const pr = await zip.file('ppt/_rels/presentation.xml.rels').async('string');
        const alvoDe = {};
        for (const m of pr.matchAll(/<Relationship [^>]*>/g)) {
            const id = (m[0].match(/Id="([^"]+)"/) || [])[1], t = (m[0].match(/Target="slides\/slide(\d+)\.xml"/) || [])[1];
            if (id && t) alvoDe[id] = +t;
        }
        const p = await zip.file('ppt/presentation.xml').async('string');
        return [...p.matchAll(/<p:sldId id="\d+" r:id="([^"]+)"\/>/g)].map(m => alvoDe[m[1]]).filter(Boolean);
    }

    // ── Conteúdo (a partir do agregado da aba) ──────────────────────
    function topN(obj, n, excluir) {
        return Object.entries(obj).filter(([k, v]) => v > 0 && !(excluir || []).includes(k)).sort((a, b) => b[1] - a[1]).slice(0, n);
    }
    function comDemais(obj, n) {
        const ord = Object.entries(obj).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
        if (!ord.length) return [['Sem registros no período', 0]];
        if (ord.length <= n + 1) return ord;
        const resto = ord.slice(n).reduce((s, x) => s + x[1], 0);
        return ord.slice(0, n).concat([[`Demais (${ord.length - n})`, resto]]);
    }
    const valorOuModelo = (txt, padrao) => (txt && String(txt).trim()) ? String(txt).trim() : padrao;

    function montarConteudo(A, textos) {
        textos = textos || {};
        const T = A.total;
        const periodo = textoPeriodo(A.f.ini, A.f.fim);
        const cidade = nomeCidade(A.f.cid);
        const local = cidade ? `${cidade} - AL` : `Área do 10º BPM (${MUNICIPIOS_10BPM.length} municípios) - AL`;
        const localRodape = cidade ? `${cidade}/AL` : 'Área do 10º BPM/AL';
        const id = k => valorOuModelo(textos[k], IDENT_PADRAO[k]);

        const territorio = id('territorio');
        const mTerr = territorio.match(/^(\d+\s+munic[ií]pios?)\s*[:\-–—]\s*([\s\S]+)$/i);
        const parasTerritorio = mTerr ? [{ texto: mTerr[1], rel: 1 }, { texto: mTerr[2], rel: 0.7, b: false }] : [territorio];

        const topTipo = topN(A.porTipo, 1)[0];
        const tiposLista = topN(A.porTipo, 5).map(([k, v]) => `${k}: ${fmtN(v)} (${pct(v, T)})`);
        const vinc = topN(A.porVinculo, 3, ['Sem informação no CAD']);
        const orig = topN(A.porOrigem, 2, ['Sem informação']);
        const semOrig = A.porOrigem['Sem informação'] || 0;
        const topBairros = topN(A.urbano, 3), topLocais = topN(A.rural, 3);
        const somaTop = l => l.reduce((s, x) => s + x[1], 0);
        const leitura = (lista, total, zona) => lista.length
            ? `${lista.map(([k, v]) => `${k} (${fmtN(v)})`).join(', ').replace(/, ([^,]*)$/, ' e $1')} ${lista.length > 1 ? 'concentram' : 'concentra'} ${pct(somaTop(lista), total)} dos registros da zona ${zona} no período.`
            : `Sem registros na zona ${zona} no período.`;
        const faixas = Object.entries(A.porFaixa).filter(([k, v]) => k !== 'Ignorado' || v > 0);
        const entreMeses = (A.f.ini && A.f.fim && (A.f.ini.getMonth() !== A.f.fim.getMonth() || A.f.ini.getFullYear() !== A.f.fim.getFullYear()))
            ? `entre ${MESES[A.f.ini.getMonth()]} e ${MESES[A.f.fim.getMonth()]}` : `em ${periodo}`;

        // Botão do pânico (IRIS PMAL) — 2 slides extras, só quando há dados.
        let panico = null;
        const P = A.panico;
        if (P) {
            const GRAUS = ['BAIXO', 'MÉDIO', 'ALTO', 'GRAVE', 'Não avaliado'];
            const tm = P.tempoMedioMin == null ? '—' : (P.tempoMedioMin < 60 ? Math.round(P.tempoMedioMin) + ' min' : (P.tempoMedioMin / 60).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' h');
            const atendidos = (P.statusAcio && P.statusAcio['ATENDIDO']) || 0;
            const pred = GRAUS.filter(g => g !== 'Não avaliado').sort((a, b) => (P.grau[b] || 0) - (P.grau[a] || 0))[0];
            const altoGrave = (P.grau['ALTO'] || 0) + (P.grau['GRAVE'] || 0);
            const semAval = P.grau['Não avaliado'] || 0;
            const per = `${dataBR(A.f.ini)} a ${dataBR(A.f.fim)}`;
            panico = {
                textosA: {
                    'TextBox 3': ['BOTÃO DO PÂNICO — PATRULHA MARIA DA PENHA'],
                    'TextBox 5': [`Dados do aplicativo IRIS PMAL • ${P.cidade} • Período de referência: ${per}.`],
                    'TextBox 9': ['ASSISTIDAS ATIVAS'], 'TextBox 10': [fmtN(P.assistidasAtivas)],
                    'TextBox 11': [`${fmtN(P.assistidasTotal)} cadastradas • ${fmtN(P.novas)} novas no período`],
                    'TextBox 14': ['FISCALIZAÇÕES'], 'TextBox 15': [fmtN(P.fiscalizacoes)], 'TextBox 16': ['realizadas no período'],
                    'TextBox 19': ['AVALIAÇÕES DE RISCO'], 'TextBox 20': [fmtN(P.avaliacoes)], 'TextBox 21': ['FONAVID no período'],
                    'TextBox 24': ['ACIONAMENTOS'], 'TextBox 25': [fmtN(P.acionamentos)], 'TextBox 26': [`${fmtN(atendidos)} atendidos • resposta média ${tm}`],
                    'TextBox 29': [`Fonte: aplicativo IRIS PMAL (Patrulha Maria da Penha) — somente ${P.cidade}; dados agregados, sem identificação das assistidas.`],
                },
                graficoA: { rotulos: P.meses.map(cap), valores: P.porMes.acio, cor: 'C62828', titulo: 'Acionamentos do botão do pânico por mês' },
                textosB: {
                    'TextBox 3': ['BOTÃO DO PÂNICO — PERFIL DE RISCO DAS ASSISTIDAS'],
                    'TextBox 5': [`Assistidas ativas por grau de risco (última avaliação FONAVID registrada no IRIS PMAL) • ${P.cidade}.`],
                    'TextBox 10': ['GRAU DE RISCO PREDOMINANTE'],
                    'TextBox 11': [P.assistidasAtivas ? `${cap(pred.toLowerCase())} • ${fmtN(P.grau[pred] || 0)}` : 'Sem assistidas ativas'],
                    'TextBox 14': ['RISCO ALTO OU GRAVE'], 'TextBox 15': [`${fmtN(altoGrave)} • ${pct(altoGrave, P.assistidasAtivas)}`],
                    'TextBox 18': ['SEM AVALIAÇÃO DE RISCO'], 'TextBox 19': [`${fmtN(semAval)} • ${pct(semAval, P.assistidasAtivas)}`],
                    'TextBox 21': [`${fmtN(P.encerrando)} assistida(s) com medida protetiva encerrando. Grau de risco conforme o formulário FONAVID aplicado pela Patrulha Maria da Penha.`],
                },
                graficoB: { rotulos: GRAUS.map(g => g === 'Não avaliado' ? g : cap(g.toLowerCase())), valores: GRAUS.map(g => P.grau[g] || 0),
                    cor: '531C7E', cores: ['43A047', 'FBC02D', 'EF6C00', 'C62828', '90A4AE'], titulo: 'Assistidas ativas por grau de risco' },
            };
        }

        return {
            panico,
            periodo, local, localRodape,
            textos: {
                1: {
                    'TextBox 7': [cap(periodo)],
                    'TextBox 8': [local, 'Reunião da Rede de Proteção / Grupo Técnico de Vigilância das Violências'],
                    'TextBox 9': ['Polícia Militar de Alagoas • 10º BPM • Fonte: CAD/SISP — ocorrências com vítimas registradas'],
                },
                2: {
                    'TextBox 10': [id('nome')], 'TextBox 14': [id('orgao')], 'TextBox 18': mTerr ? { paras: parasTerritorio, opc: { inicio: 1000, minimo: 600 } } : parasTerritorio,
                    'TextBox 22': [id('responsavel')], 'TextBox 24': [id('oquefazemos')],
                    'TextBox 26': [id('porta')], 'TextBox 28': [id('contato')],
                },
                3: {
                    'TextBox 5': [`Período de referência: ${dataBR(A.f.ini)} a ${dataBR(A.f.fim)}.`],
                    'TextBox 10': [fmtN(T)], 'TextBox 11': [`Vítimas registradas • ${fmtN(A.pessoas)} pessoas distintas`],
                    'TextBox 15': [fmtN(A.porSexo['Feminino'])], 'TextBox 16': [pct(A.porSexo['Feminino'], T)],
                    'TextBox 20': [fmtN(A.porSexo['Masculino'])], 'TextBox 21': [pct(A.porSexo['Masculino'], T)],
                    'TextBox 25': [fmtN(A.porSexo['Outro/ignorado'])], 'TextBox 26': [pct(A.porSexo['Outro/ignorado'], T)],
                    'TextBox 29': ['Indicador: vítimas registradas em ocorrências atendidas pela PM (CAD/SISP). Uma mesma pessoa pode constar em mais de uma ocorrência.'],
                },
                4: {
                    'TextBox 11': [`${fmtN(A.porSexo['Feminino'])} • ${pct(A.porSexo['Feminino'], T)}`],
                    'TextBox 15': [`${fmtN(A.porSexo['Masculino'])} • ${pct(A.porSexo['Masculino'], T)}`],
                    'TextBox 19': [`${fmtN(A.porSexo['Outro/ignorado'])} • ${pct(A.porSexo['Outro/ignorado'], T)}`],
                },
                5: { 'TextBox 9': { paras: faixas.map(([k, v]) => `${k}: ${fmtN(v)} (${pct(v, T)})`), opc: { umaLinha: true, minimo: 1100 } } },
                6: {
                    'TextBox 8': ['PRINCIPAIS TIPOS (n e %)'],
                    'TextBox 9': { paras: tiposLista.length ? tiposLista : ['Sem registros no período.'], opc: { umaLinha: true, minimo: 1100 } },
                    'TextBox 13': [topTipo ? `${topTipo[0]} • ${fmtN(topTipo[1])}` : 'Sem registros'],
                },
                7: { 'TextBox 9': { paras: vinc.length ? vinc.map(([k, v], i) => `${i + 1}º ${curto(k)} - ${fmtN(v)}`) : ['Sem informação de vínculo no período.'], opc: { umaLinha: true, minimo: 1100 } } },
                8: {
                    'TextBox 11': [orig[0] ? `${curto(orig[0][0])} • ${fmtN(orig[0][1])}` : '—'],
                    'TextBox 15': [orig[1] ? `${curto(orig[1][0])} • ${fmtN(orig[1][1])}` : '—'],
                    'TextBox 19': [`${fmtN(semOrig)} • ${pct(semOrig, T)}`],
                },
                9: {
                    'TextBox 11': [topBairros[0] ? `${topBairros[0][0]} • ${fmtN(topBairros[0][1])}` : 'Sem registros'],
                    'TextBox 13': [leitura(topBairros, A.totalUrbano, 'urbana')],
                },
                10: {
                    'TextBox 11': [topLocais[0] ? `${topLocais[0][0]} • ${fmtN(topLocais[0][1])}` : 'Sem registros'],
                    'TextBox 13': [leitura(topLocais, A.totalRural, 'rural')],
                },
                11: {
                    'TextBox 9': (A.achados || []).slice(0, 3).map(a => '• ' + a),
                    'TextBox 12': [valorOuModelo(textos.fragilidades, '[subnotificação, fluxo, acesso, registro, retorno etc.]')],
                    'TextBox 15': [valorOuModelo(textos.acoes, `[ações do serviço ${entreMeses}]`)],
                    'TextBox 18': [valorOuModelo(textos.propostas, '[o que o serviço propõe à rede para os próximos meses]')],
                },
            },
            graficos: {
                1: { rotulos: A.meses.map(m => cap(m.rotulo)), valores: A.meses.map(m => A.porMes[m.chave]), cor: '531C7E' },
                2: { rotulos: Object.keys(A.porSexo), valores: Object.values(A.porSexo), cor: 'CA247A', cores: ['CA247A', '1C5391', 'F6AB16'] },
                3: { rotulos: faixas.map(x => x[0]), valores: faixas.map(x => x[1]), cor: '531C7E' },
                4: { rotulos: Object.keys(A.porTipo), valores: Object.values(A.porTipo), cor: '531C7E' },
                5: { rotulos: Object.keys(A.porVinculo).map(curto), valores: Object.values(A.porVinculo), cor: 'CA247A' },
                6: { rotulos: Object.keys(A.porOrigem).map(curto), valores: Object.values(A.porOrigem), cor: '19844E' },
                7: (() => { const l = comDemais(A.urbano, 8); return { rotulos: l.map(x => x[0]), valores: l.map(x => x[1]), cor: '1C5391' }; })(),
                8: (() => { const l = comDemais(A.rural, 8); return { rotulos: l.map(x => x[0]), valores: l.map(x => x[1]), cor: '19844E' }; })(),
            },
        };
    }

    // ── Geração ─────────────────────────────────────────────────────
    async function gerar(opc) {
        const JSZip = opc.JSZip || raiz.JSZip;
        if (!JSZip) throw new Error('JSZip não carregado.');
        let modelo = opc.modelo;
        if (!modelo) {
            const r = await fetch(opc.modeloUrl || MODELO_URL);
            if (!r.ok) throw new Error(`Modelo da apresentação não encontrado (${r.status}).`);
            modelo = await r.arrayBuffer();
        }
        const C = montarConteudo(opc.agregado, opc.textos);
        const zip = await JSZip.loadAsync(modelo);

        // Botão do pânico: 2 slides clonados do modelo (Panorama e Origem),
        // inseridos antes da Síntese (depois do slide 10 — zona rural).
        if (C.panico) {
            const a = await clonarSlide(zip, 3), b = await clonarSlide(zip, 8);
            await inserirSlides(zip, [a.rid, b.rid], 10);
            C.textos[a.slide] = C.panico.textosA; C.textos[b.slide] = C.panico.textosB;
            C.graficos[a.chart] = C.panico.graficoA; C.graficos[b.chart] = C.panico.graficoB;
        }
        // Numeração do canto superior (TextBox 4) conforme a ordem final.
        const ordem = await ordemSlides(zip);
        ordem.forEach((num, i) => { if (i > 0) (C.textos[num] = C.textos[num] || {})['TextBox 4'] = [String(i + 1).padStart(2, '0')]; });

        const rodapeDe = /Palmeira dos Índios\/AL • Dados de janeiro a agosto de 2026/g;
        const rodapePara = xml(`${C.localRodape} • Dados de ${C.periodo}`);
        for (const n of ordem) {
            const caminho = `ppt/slides/slide${n}.xml`;
            if (!zip.file(caminho)) continue;
            let s = await zip.file(caminho).async('string');
            s = s.replace(rodapeDe, () => rodapePara);
            const t = C.textos[n] || {};
            Object.keys(t).forEach(nome => {
                const v = t[nome];
                const paras = Array.isArray(v) ? v : v.paras;
                const o = Array.isArray(v) ? {} : (v.opc || {});
                if (n === 11 && nome === 'TextBox 9') o.espacoEntre = 2;
                if (nome === 'TextBox 3') o.umaLinha = true; // títulos novos dos slides clonados
                s = definirTexto(s, nome, paras, o);
            });
            zip.file(caminho, materializarEstilos(s));
        }
        for (const [num, g] of Object.entries(C.graficos)) {
            await preencherGrafico(JSZip, zip, +num, g.rotulos, g.valores, g.cor, g.cores, g.titulo);
        }
        const tipo = opc.tipoSaida || (typeof Blob !== 'undefined' ? 'blob' : 'nodebuffer');
        return zip.generateAsync({ type: tipo, mimeType: MIME_PPTX, compression: 'DEFLATE' });
    }

    function nomeArquivo(A) {
        const cid = nomeCidade(A.f.cid);
        const base = `Rede_Protecao_Vitimas_10BPM_${cid ? cid.replace(/[^A-Za-zÀ-ú0-9]+/g, '_') + '_' : ''}${textoPeriodo(A.f.ini, A.f.fim).replace(/[^A-Za-zÀ-ú0-9]+/g, '_')}`;
        return base.normalize('NFD').replace(/[̀-ͯ]/g, '') + '.pptx';
    }

    const api = { gerar, montarConteudo, nomeArquivo, IDENT_PADRAO, MUNICIPIOS_10BPM, MODELO_URL };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else raiz.RedeProtecaoPPTX = api;
})(typeof window !== 'undefined' ? window : globalThis);
