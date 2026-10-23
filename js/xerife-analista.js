// ═══════════════════════════════════════════════════════════════════
// XERIFE — ANALISTA DE INTELIGÊNCIA (motor de análise do RELINT e do chat)
// ═══════════════════════════════════════════════════════════════════
// Analisa TUDO o que existe de um alvo — Ficha Alvo do ExchelonX (dados,
// vínculos, facção/ORCRIM, mandados, informes, denúncias, ficha criminal,
// veículos, endereços) + Consulta Integrada (CAD, PPE, PC, processos dos
// Tribunais, BNMP) — e produz CONHECIMENTO no padrão da DNISP:
//   · perfil criminal (categorias, predominância, escalada de gravidade);
//   · dinâmica temporal (reiteração, intervalo médio, atividade recente);
//   · vitimização (indicador de conflito/retaliação);
//   · situação judicial (processos ativos por classe, mandados em aberto);
//   · rede (vínculos por tipo, facção/ORCRIM e função);
//   · avaliação de risco com os FATORES explícitos (nunca um número sem lastro);
//   · lacunas de inteligência e propostas de ação;
//   · avaliação do conhecimento (registros oficiais × informes).
// É determinístico: só usa o que está nos dados — não "inventa" fatos. A IA
// local (WebLLM) do XERIFE pode depois só refinar a redação (relint.js).
// ═══════════════════════════════════════════════════════════════════
(function (global) {
    'use strict';
    if (global.XerifeAnalista) return;

    const val = v => { const s = (v == null ? '' : String(v)).trim(); return s && s !== '---' ? s : ''; };
    const N = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const listaE = arr => arr.length <= 1 ? (arr[0] || '') : arr.slice(0, -1).join(', ') + ' e ' + arr[arr.length - 1];
    function data(v) {
        const s = val(v); let m;
        if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return new Date(+m[1], +m[2] - 1, +m[3]);
        if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return new Date(+m[3], +m[2] - 1, +m[1]);
        return null;
    }
    const br = d => d ? d.toLocaleDateString('pt-BR') : '';

    // Categorias criminais e gravidade (1 = menor … 5 = letal)
    const CATEGORIAS = [
        { id: 'letal', nome: 'crimes violentos letais', g: 5, rx: /HOMICID|LATROCIN|FEMINICID|MORTE/ },
        { id: 'armas', nome: 'crimes com arma de fogo', g: 4, rx: /ARMA DE FOGO|DESARMAMENTO|MUNIC|DISPARO|PORTE ILEGAL|POSSE ILEGAL/ },
        { id: 'patrimonio_v', nome: 'crimes violentos contra o patrimônio', g: 4, rx: /ROUBO|EXTORS|SEQUESTRO/ },
        { id: 'trafico', nome: 'tráfico de drogas', g: 4, rx: /TRAFICO|ENTORPECENTE|DROGA|ASSOCIACAO PARA O TRAFICO/ },
        { id: 'orcrim', nome: 'organização/associação criminosa', g: 4, rx: /ORGANIZACAO CRIMINOSA|ASSOCIACAO CRIMINOSA|QUADRILHA|MILICIA/ },
        { id: 'violencia', nome: 'violência contra a pessoa', g: 3, rx: /LESAO|AMEACA|AGRESS|VIAS DE FATO|TORTURA|ESTUPRO/ },
        { id: 'vd', nome: 'violência doméstica', g: 3, rx: /MARIA DA PENHA|DOMESTIC|MEDIDA PROTETIVA/ },
        { id: 'patrimonio', nome: 'crimes contra o patrimônio', g: 2, rx: /FURTO|RECEPTA|ESTELIONAT|DANO|APROPRIACAO/ },
        { id: 'usuario', nome: 'porte de drogas para consumo', g: 1, rx: /USUARIO|CONSUMO|PORTE DE (DROGA|ENTORPECENTE)/ },
    ];
    const NAO_CRIME = /CUMPRIMENTO DE MANDADO|ALVARA|APOIO|VISITA|SEM ILICITUDE|PERDA|EXTRAVIO|ACIDENTE|AVERIGUA|DESAPARECIMENTO|ENTREGA|RECUPERA/;
    const categoriaDe = txt => { const t = N(txt); if (NAO_CRIME.test(t)) return null; return CATEGORIAS.find(c => c.rx.test(t)) || (t.trim() ? { id: 'outros', nome: 'outros delitos', g: 1 } : null); };
    const ENV_AUTOR = /AUTOR|SUSPEIT|INFRATOR|ACUSAD|CONDUZID|PRES[OA]|INDICIAD|INVESTIGAD|DETID|FLAGRAN/;
    const ENV_VITIMA = /VITIMA/;
    const PROC_INATIVO = /ARQUIVAD|BAIXA DEFINITIVA|EXTIN[CÇ]|TRANSITAD|TRANSITO EM JULGADO|CANCELAD/;
    const MANDADO_FECHADO = /CUMPRID|BAIXAD|REVOGAD|CANCELAD|EXPIRAD/;

    // ── Fatos normalizados de um alvo ────────────────────────────────
    function fatos(a) {
        const f = a.ficha || {}, c = a.consulta || {};
        const registros = [], vistos = new Set();
        (f.fichaCriminal || []).forEach(r => {
            const n = val(r.numero).replace(/\D/g, ''); if (n) vistos.add(n);
            registros.push({ fonte: 'ExchelonX', natureza: val(r.crimes) || val(r.tipo), data: data(r.dataFato), numero: val(r.numero), papel: 'autor' });
        });
        (c.ocorrencias || []).forEach(o => {
            const n = val(o.numero).replace(/\D/g, '');
            if (n && vistos.has(n)) return; if (n) vistos.add(n);
            const env = N(o.envolvimento);
            registros.push({ fonte: o.fonte || 'CAD', natureza: val(o.natureza), data: data(o.data), numero: val(o.numero),
                papel: ENV_VITIMA.test(env) ? 'vitima' : (!env || ENV_AUTOR.test(env)) ? 'autor' : 'outro', envolvimento: val(o.envolvimento) });
        });
        const comoAutor = registros.filter(r => r.papel === 'autor').map(r => Object.assign(r, { cat: categoriaDe(r.natureza) })).filter(r => r.cat);
        const comoVitima = registros.filter(r => r.papel === 'vitima');
        const processos = (c.processos || []).map(p => Object.assign({}, p, { ativo: p.ativo != null ? p.ativo : !PROC_INATIVO.test(N(p.ultimo)) }));
        const mandadosAbertos = (f.mandados || []).filter(m => !MANDADO_FECHADO.test(N(m.status)));
        return { f, c, registros, comoAutor, comoVitima, processos, mandadosAbertos, bnmp: !!(c.bnmp && c.bnmp.possui) };
    }

    // ── Análise de um alvo ────────────────────────────────────────────
    function analisarAlvo(a, hoje) {
        hoje = hoje || new Date();
        const F = fatos(a), f = F.f;
        // Perfil criminal
        const porCat = new Map();
        F.comoAutor.forEach(r => { const k = r.cat.id; const x = porCat.get(k) || { cat: r.cat, n: 0, ultimo: null }; x.n++; if (r.data && (!x.ultimo || r.data > x.ultimo)) x.ultimo = r.data; porCat.set(k, x); });
        const perfil = [...porCat.values()].sort((x, y) => y.n - x.n || y.cat.g - x.cat.g);
        const predominante = perfil[0] || null;
        // Dinâmica temporal
        const datas = F.comoAutor.map(r => r.data).filter(Boolean).sort((x, y) => x - y);
        const primeiro = datas[0] || null, ultimo = datas[datas.length - 1] || null;
        const intervalos = datas.slice(1).map((d, i) => (d - datas[i]) / 864e5).filter(x => x > 0);
        const intervaloMedio = intervalos.length ? Math.round(intervalos.reduce((s, x) => s + x, 0) / intervalos.length) : null;
        const diasDesdeUltimo = ultimo ? Math.round((hoje - ultimo) / 864e5) : null;
        const ultimos12 = F.comoAutor.filter(r => r.data && (hoje - r.data) / 864e5 <= 365).length;
        // Escalada: gravidade média da 1ª metade × 2ª metade (cronológica)
        const cron = F.comoAutor.filter(r => r.data).sort((x, y) => x.data - y.data);
        let escalada = null;
        if (cron.length >= 4) {
            const meio = Math.floor(cron.length / 2), m = l => l.reduce((s, r) => s + r.cat.g, 0) / l.length;
            const g1 = m(cron.slice(0, meio)), g2 = m(cron.slice(meio));
            escalada = g2 - g1 >= 0.75 ? 'crescente' : g1 - g2 >= 0.75 ? 'decrescente' : 'estável';
        }
        // Situação judicial
        const procAtivos = F.processos.filter(p => p.ativo);
        const classes = {};
        procAtivos.forEach(p => { const k = /EXECU[CÇ]/.test(N(p.classe)) ? 'execução penal' : /PROTETIV/.test(N(p.classe + ' ' + p.assunto)) ? 'medida protetiva' : /PENAL|CRIM|INQU|FLAGRANTE|PRIS/.test(N(p.classe)) ? 'ação/inquérito penal' : 'outros'; classes[k] = (classes[k] || 0) + 1; });
        // Rede
        const vinc = (f.vinculos || []).filter(v => val(v.nome));
        const vCrim = vinc.filter(v => /CRIM|COMPARS|SUBORDIN|GERENTE|LIDER|FAC/.test(N([v.tipo, v.subtipo].join(' '))));
        const vFam = vinc.filter(v => /FAMIL|IRMA|PAI|MAE|FILH|PRIM|TIO|CONJ|COMPANH/.test(N([v.tipo, v.subtipo].join(' '))));
        const grupos = (f.grupos || []).filter(g => val(g.nome));
        // Risco — fatores explícitos
        const fatores = [];
        const add = (pts, txt) => fatores.push({ pts, txt });
        if (F.bnmp || F.mandadosAbertos.length) add(25, 'mandado judicial pendente de cumprimento');
        if (porCat.has('letal')) add(20, 'registro de crime violento letal');
        if (porCat.has('armas')) add(15, 'envolvimento com arma de fogo');
        if (porCat.has('patrimonio_v')) add(10, 'crimes violentos contra o patrimônio');
        if (porCat.has('trafico')) add(10, 'envolvimento com tráfico de drogas');
        if (grupos.length) add(15, `vinculação a ${grupos.map(g => val(g.nome).toUpperCase()).join(', ')}`);
        else if (vCrim.length) add(8, `${vCrim.length} vínculo(s) de natureza criminal`);
        if (F.comoAutor.length >= 3) add(10, `reiteração delitiva (${F.comoAutor.length} registros)`);
        if (ultimos12) add(10, `atividade recente (${ultimos12} registro(s) nos últimos 12 meses)`);
        if (escalada === 'crescente') add(10, 'escalada de gravidade das condutas');
        if (F.comoVitima.some(r => /HOMICID|TENTATIVA|LESAO|DISPARO|ROUBO/.test(N(r.natureza)))) add(5, 'vitimização em crime violento (possível conflito/retaliação)');
        if (classes['execução penal']) add(5, 'em execução penal');
        const pontos = Math.min(100, fatores.reduce((s, x) => s + x.pts, 0));
        const nivel = pontos >= 60 ? 'CRÍTICO' : pontos >= 40 ? 'ALTO' : pontos >= 20 ? 'MÉDIO' : 'BAIXO';
        // Lacunas de inteligência
        const lacunas = [];
        const cpf = val((f.dados || {}).cpf).replace(/\D/g, '');
        if (cpf.length !== 11) lacunas.push('CPF não cadastrado (impede a consulta às bases do CAD, BNMP e Tribunais)');
        else if (!a.consulta) lacunas.push('Consulta Integrada (CAD/BNMP/Tribunais) ainda não realizada');
        if (!(f.enderecos || []).length) lacunas.push('endereço não cadastrado');
        if (!(f.fotos || []).length) lacunas.push('ausência de fotografia');
        if (!(f.informacoes || []).length && !(f.denuncias || []).length) lacunas.push('ausência de informes/denúncias que descrevam a atuação');
        if (!vinc.length) lacunas.push('vínculos não mapeados');
        // Propostas
        const propostas = [];
        if (F.bnmp || F.mandadosAbertos.length) propostas.push('priorizar o cumprimento do(s) mandado(s) judicial(is) em aberto, com levantamento prévio do endereço e da rotina do alvo');
        if ((f.enderecos || []).length && (porCat.has('trafico') || porCat.has('armas'))) propostas.push('monitorar o imóvel indicado e avaliar a representação por mandado de busca e apreensão, mediante difusão à Polícia Judiciária');
        if (porCat.has('trafico') || porCat.has('armas') || grupos.length) propostas.push('incluir a área de residência/atuação nas Operações Sufocamento (entorno e saturação) e no policiamento orientado a hotspots');
        if (vCrim.length || grupos.length) propostas.push('aprofundar a análise de vínculos (2º grau) para identificar fornecedores, gerentes e pontos de apoio');
        if (ultimos12) propostas.push('orientar as guarnições para abordagem qualificada, com consulta prévia ao COPOM/BNMP');
        if (lacunas.length) propostas.push('suprir as lacunas de inteligência: ' + lacunas.join('; '));
        return { F, perfil, predominante, primeiro, ultimo, intervaloMedio, diasDesdeUltimo, ultimos12, escalada, procAtivos, classes, vinc, vCrim, vFam, grupos, fatores, pontos, nivel, lacunas, propostas };
    }

    // ── Redação (DNISP: impessoal, 3ª pessoa, sem identificar fontes) ──
    function paragrafosAnalise(a, ref, k, rot) {
        const R = analisarAlvo(a), F = R.F, ps = [];
        const P = (bloco, rotulo, html) => ({ bloco: `${k}-xa-${bloco}`, rotulo: rot(rotulo), html });
        if (R.perfil.length) {
            const partes = R.perfil.slice(0, 4).map(x => `${x.cat.nome} (${x.n} registro${x.n > 1 ? 's' : ''})`);
            let t = `Da análise dos registros em que ${ref} figura como autor(a) ou suspeito(a) (${F.comoAutor.length} no total, considerando ExchelonX e CAD), verifica-se atuação em ${listaE(partes)}${R.perfil.length === 1 || R.perfil[0].n > R.perfil[1].n ? `, com predominância de <b>${esc(R.predominante.cat.nome)}</b>` : ', sem predominância definida entre as modalidades'}.`;
            if (R.escalada === 'crescente') t += ' Observa-se escalada na gravidade das condutas ao longo do tempo, o que indica agravamento do comportamento delitivo.';
            else if (R.escalada === 'decrescente') t += ' Observa-se redução na gravidade das condutas mais recentes.';
            ps.push(P('perfil', 'análise — perfil criminal', t));
        }
        if (R.primeiro) {
            let t = `O primeiro registro data de ${br(R.primeiro)} e o mais recente de ${br(R.ultimo)}`;
            if (R.diasDesdeUltimo != null) t += ` (há ${R.diasDesdeUltimo} dias)`;
            t += R.intervaloMedio ? `, com intervalo médio de ${R.intervaloMedio} dias entre os registros` : '';
            t += R.ultimos12 ? `. Nos últimos 12 meses, constam ${R.ultimos12} registro(s), o que evidencia atividade criminosa recente.` : '. Não há registros nos últimos 12 meses, o que não afasta a atuação, mas indica menor exposição recente às ações policiais.';
            ps.push(P('tempo', 'análise — dinâmica temporal', t));
        }
        if (F.comoVitima.length) {
            const graves = F.comoVitima.filter(r => /HOMICID|TENTATIVA|LESAO|DISPARO|ROUBO/.test(N(r.natureza)));
            if (graves.length) ps.push(P('vit', 'análise — vitimização', `${ref} figura como vítima em ${graves.length} ocorrência(s) de natureza violenta (${listaE(graves.slice(0, 4).map(r => esc(val(r.natureza).toLowerCase()) + (r.data ? ' em ' + br(r.data) : '')))}), circunstância que pode indicar conflito com grupos rivais e risco de retaliação.`));
        }
        const cls = Object.entries(R.classes);
        if (cls.length) ps.push(P('jud', 'análise — situação processual', `No âmbito judicial, há ${R.procAtivos.length} processo(s) em tramitação (${listaE(cls.map(([c, n]) => `${n} de ${c}`))})${R.classes['execução penal'] ? ', o que indica cumprimento de pena em curso e eventual descumprimento de condições a ser verificado junto ao Juízo da Execução' : ''}${R.classes['medida protetiva'] ? '; a existência de medida protetiva sugere contexto de violência doméstica' : ''}.`));
        if (R.grupos.length || R.vinc.length) {
            const g = R.grupos.map(x => `<b>${esc(val(x.nome).toUpperCase())}</b>${val(x.funcao) ? ' (função: ' + esc(val(x.funcao).toLowerCase()) + ')' : ''}`);
            let t = g.length ? `${ref} integraria ${listaE(g)}. ` : '';
            if (R.vinc.length) t += `Foram mapeados ${R.vinc.length} vínculo(s)${R.vCrim.length ? `, dos quais ${R.vCrim.length} de natureza criminal (${listaE(R.vCrim.slice(0, 4).map(v => esc(val(v.nome).toUpperCase())))})` : ''}${R.vFam.length ? ` e ${R.vFam.length} familiar(es)` : ''}, o que ${R.vCrim.length || g.length ? 'reforça a inserção do alvo em rede de apoio à atividade criminosa' : 'deve ser considerado na delimitação da rede de relacionamentos'}.`;
            ps.push(P('rede', 'análise — rede de relacionamentos', t.trim()));
        }
        paragrafosTecnicas(a, ref, k, rot).forEach(x => ps.push(x));
        ps.push(P('risco', 'análise — avaliação de risco', R.fatores.length
            ? `Considerando ${listaE(R.fatores.sort((x, y) => y.pts - x.pts).map(x => esc(x.txt)))}, o grau de risco atribuído a ${ref} é <b>${R.nivel}</b>.`
            : `Com base nos elementos disponíveis, o grau de risco atribuído a ${ref} é <b>${R.nivel}</b>, ressalvadas as lacunas de informação.`));
        return { R, paragrafos: ps };
    }
    // Conclusão, propostas e avaliação do conjunto
    function sintese(analises, opts) {
        opts = opts || {};
        const ordem = { 'CRÍTICO': 4, 'ALTO': 3, 'MÉDIO': 2, 'BAIXO': 1 };
        const maior = analises.reduce((m, x) => ordem[x.R.nivel] > ordem[m] ? x.R.nivel : m, 'BAIXO');
        const cats = new Map();
        analises.forEach(x => x.R.perfil.forEach(p => cats.set(p.cat.nome, (cats.get(p.cat.nome) || 0) + p.n)));
        const top = [...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]);
        const mandados = analises.filter(x => x.R.F.bnmp || x.R.F.mandadosAbertos.length).length;
        const recentes = analises.filter(x => x.R.ultimos12).length;
        const nomes = analises.map(x => x.ref);
        const conclusao = `${opts.orcrim ? 'Diante dos elementos analisados, verifica-se a existência de indícios consistentes da atuação de organização criminosa estruturada. ' + (analises.length > 1 ? `Os ${analises.length} alvos apresentam` : `${nomes[0]} apresenta`) : `Diante dos elementos analisados, ${analises.length > 1 ? `os ${analises.length} alvos apresentam` : `${nomes[0]} apresenta`}`} atuação ${top.length ? 'voltada a ' + listaE(top) : 'criminosa'}${recentes ? `, com atividade recente${analises.length > 1 ? ` em ${recentes} deles` : ''}` : ''}${mandados ? ` e ${mandados > 1 ? mandados + ' mandados judiciais pendentes' : 'mandado judicial pendente'} de cumprimento` : ''}. O grau de risco global é avaliado como <b>${maior}</b>, com probabilidade de continuidade delitiva e risco concreto à ordem pública.`;
        const propostas = [...new Set(analises.flatMap(x => x.R.propostas.filter(p => !p.startsWith('suprir'))))];
        const lacunas = analises.filter(x => x.R.lacunas.length).map(x => `${x.ref}: ${x.R.lacunas.join('; ')}`);
        const oficiais = analises.some(x => x.R.F.registros.length || x.R.F.processos.length);
        const informes = analises.some(x => (x.R.F.f.informacoes || []).length || (x.R.F.f.denuncias || []).length);
        const avaliacao = `Os dados oriundos de registros oficiais (${['CAD/SISP', 'BNMP', 'Tribunais', 'ExchelonX'].join(', ')}) foram tratados como <b>informação confirmada</b>${informes ? '; os dados provenientes de informes e denúncias, ainda não confirmados por outras fontes, foram tratados como <b>informes</b> e redigidos no futuro do pretérito' : ''}${oficiais ? '' : ' (não houve registros oficiais vinculados aos alvos)'}. A idoneidade das fontes humanas deve ser avaliada pelo analista responsável, nos termos da DNISP.`;
        const alvos = analises.map(x => x.alvo).filter(Boolean);
        const conjunto = alvos.length === analises.length ? paragrafosConjunto(alvos, analises.map(x => x.ref)) : [];
        return { conclusao, propostas, lacunas, avaliacao: alvos.length === analises.length ? avaliacaoEstados(alvos) : avaliacao, maior, conjunto };
    }
    // ═══ Técnicas estruturadas de análise (DAI/ABIN 2023, Heuer & Pherson) ═══
    // ── Enquadramento legal: natureza registrada → dispositivo legal ──
    const LEGAL = [
        [/FEMINICID/, 'feminicídio (art. 121-A do Código Penal, incluído pela Lei nº 14.994/2024)'],
        [/LATROCIN/, 'latrocínio (art. 157, § 3º, II, do Código Penal)'],
        [/HOMICID/, 'homicídio (art. 121 do Código Penal)'],
        [/EXTORSAO MEDIANTE SEQUESTRO/, 'extorsão mediante sequestro (art. 159 do Código Penal)'],
        [/EXTORS/, 'extorsão (art. 158 do Código Penal)'],
        [/ROUBO/, 'roubo (art. 157 do Código Penal)'],
        [/FURTO/, 'furto (art. 155 do Código Penal)'],
        [/RECEPTA/, 'receptação (art. 180 do Código Penal)'],
        [/ESTELIONAT/, 'estelionato (art. 171 do Código Penal)'],
        [/APROPRIACAO INDEBITA/, 'apropriação indébita (art. 168 do Código Penal)'],
        [/\bDANO\b/, 'dano (art. 163 do Código Penal)'],
        [/ASSOCIACAO PARA O TRAFICO/, 'associação para o tráfico (art. 35 da Lei nº 11.343/2006)'],
        [/TRAFICO|ENTORPECENTE.*VENDA|COMERCIO DE DROGA/, 'tráfico de drogas (art. 33 da Lei nº 11.343/2006)'],
        [/USUARIO|CONSUMO|PORTE DE (DROGA|ENTORPECENTE)|USO DE ENTORPECENTE/, 'porte de drogas para consumo pessoal (art. 28 da Lei nº 11.343/2006)'],
        [/USO RESTRITO/, 'posse ou porte ilegal de arma de fogo de uso restrito (art. 16 da Lei nº 10.826/2003)'],
        [/DISPARO/, 'disparo de arma de fogo (art. 15 da Lei nº 10.826/2003)'],
        [/POSSE (IRREGULAR|ILEGAL) DE ARMA/, 'posse irregular de arma de fogo de uso permitido (art. 12 da Lei nº 10.826/2003)'],
        [/ARMA DE FOGO|PORTE ILEGAL|DESARMAMENTO|MUNIC/, 'porte ilegal de arma de fogo de uso permitido (art. 14 da Lei nº 10.826/2003)'],
        [/ARMA BRANCA/, 'porte de arma branca (art. 19 da Lei das Contravenções Penais)'],
        [/ORGANIZACAO CRIMINOSA/, 'organização criminosa (art. 2º da Lei nº 12.850/2013)'],
        [/ASSOCIACAO CRIMINOSA|QUADRILHA/, 'associação criminosa (art. 288 do Código Penal)'],
        [/DESCUMPRIMENTO DE MEDIDA PROTETIVA/, 'descumprimento de medida protetiva de urgência (art. 24-A da Lei nº 11.340/2006)'],
        [/MARIA DA PENHA|DOMESTIC/, 'violência doméstica e familiar contra a mulher (Lei nº 11.340/2006)'],
        [/LESAO CORPORAL|LESAO/, 'lesão corporal (art. 129 do Código Penal)'],
        [/AMEACA/, 'ameaça (art. 147 do Código Penal)'],
        [/PERSEGUICAO/, 'perseguição (art. 147-A do Código Penal)'],
        [/ESTUPRO/, 'estupro (art. 213 do Código Penal)'],
        [/TORTURA/, 'tortura (Lei nº 9.455/1997)'],
        [/VIAS DE FATO/, 'vias de fato (art. 21 da Lei das Contravenções Penais)'],
        [/PERTURBACAO/, 'perturbação do trabalho ou do sossego alheios (art. 42 da Lei das Contravenções Penais)'],
        [/ADULTERACAO DE SINAL/, 'adulteração de sinal identificador de veículo automotor (art. 311 do Código Penal)'],
        [/EMBRIAGUEZ/, 'condução de veículo sob influência de álcool (art. 306 do Código de Trânsito Brasileiro)'],
        [/ENTREGAR VEICULO/, 'entrega de veículo a pessoa não habilitada (art. 310 do Código de Trânsito Brasileiro)'],
        [/DIRIGIR VEICULO|SEM (A DEVIDA )?PERMISSAO|SEM CNH|HABILITACAO/, 'direção sem habilitação gerando perigo de dano (art. 309 do Código de Trânsito Brasileiro)'],
        [/DESACATO/, 'desacato (art. 331 do Código Penal)'],
        [/RESISTENCIA/, 'resistência (art. 329 do Código Penal)'],
        [/DESOBEDIENCIA/, 'desobediência (art. 330 do Código Penal)'],
    ];
    function enquadramento(F) {
        const m = new Map();
        F.comoAutor.forEach(r => { const t = N(r.natureza); const hit = LEGAL.find(([rx]) => rx.test(t)); if (hit) m.set(hit[1], (m.get(hit[1]) || 0) + 1); });
        return [...m.entries()].sort((a, b) => b[1] - a[1]);
    }
    // ── Linha do tempo (cronologia) ──
    function linhaTempo(F) {
        const ev = [];
        F.registros.filter(r => r.data).forEach(r => ev.push({ d: r.data, t: `${val(r.natureza).toLowerCase() || 'registro'}${r.papel === 'vitima' ? ' (como vítima)' : ''}${r.numero ? ' — nº ' + r.numero : ''}` }));
        F.processos.forEach(p => { const d = data(p.dataUltimo); if (d) ev.push({ d, t: `movimentação processual (${val(p.classe).toLowerCase() || 'processo'} nº ${val(p.numero)})` }); });
        return ev.sort((a, b) => a.d - b.d);
    }
    // ── Vocabulário de probabilidade (Kent, 1964; faixas da ICD 203 adaptadas) ──
    function termoProbabilidade(p) {
        return p >= 0.95 ? 'quase certa' : p >= 0.8 ? 'muito provável' : p >= 0.55 ? 'provável' : p >= 0.45 ? 'tão provável quanto improvável' : p >= 0.2 ? 'improvável' : 'muito improvável';
    }
    // ── Análise de Hipóteses Concorrentes (ACH — Heuer, 1999) por alvo ──
    function hipoteses(R) {
        const F = R.F, e = [];
        const ev = (txt, h1, h2, h3) => e.push({ txt, h: [h1, h2, h3] }); // +2 muito consistente … -2 muito inconsistente
        if (R.grupos.length) ev('vinculação formal a facção/ORCRIM', 2, -2, -1);
        if (R.vCrim.length) ev(`${R.vCrim.length} vínculo(s) criminal(is)`, 2, -1, -1);
        if (porCat(R, 'trafico') && porCat(R, 'armas')) ev('tráfico associado a armas de fogo', 2, 0, -2);
        else if (porCat(R, 'trafico')) ev('envolvimento com tráfico', 1, 1, -1);
        if (porCat(R, 'patrimonio') || porCat(R, 'patrimonio_v')) ev('crimes patrimoniais', 0, 1, 0);
        if (F.comoAutor.length >= 3) ev('reiteração delitiva', 1, 1, -2);
        else if (F.comoAutor.length <= 1) ev('registro isolado ou inexistente', -1, -1, 2);
        if (R.ultimos12) ev('atividade nos últimos 12 meses', 1, 1, -1); else if (F.comoAutor.length) ev('ausência de registros recentes', -1, 0, 1);
        if (F.bnmp || F.mandadosAbertos.length) ev('mandado judicial em aberto', 1, 1, -2);
        if (F.comoVitima.some(r => /HOMICID|TENTATIVA|DISPARO/.test(N(r.natureza)))) ev('vitimização por violência letal (indicador de conflito)', 1, 0, -1);
        if (!e.length) return null;
        const H = ['integração a estrutura criminosa organizada (facção/ORCRIM ou rede de apoio)', 'atuação criminosa autônoma, com reiteração individual', 'envolvimento eventual, sem indicação de atuação criminosa contínua'];
        // Heuer: o que pesa é a INCONSISTÊNCIA — a hipótese com menos evidências contrárias é a mais provável
        const inc = [0, 1, 2].map(i => e.reduce((s, x) => s + Math.min(0, x.h[i]), 0));
        const cons = [0, 1, 2].map(i => e.reduce((s, x) => s + Math.max(0, x.h[i]), 0));
        const nota = [0, 1, 2].map(i => cons[i] + 2 * inc[i]);
        const ordem = [0, 1, 2].sort((a, b) => nota[b] - nota[a]);
        // probabilidade relativa (softmax das notas); com poucas evidências a confiança é puxada para o meio
        const ex = nota.map(n => Math.exp(n / 2.5)), soma = ex.reduce((s, x) => s + x, 0);
        let p = ex[ordem[0]] / soma;
        if (e.length < 3) p = 0.5 + (p - 0.5) * 0.6;
        return { H, e, ordem, nota, termo: termoProbabilidade(Math.min(0.94, p)), melhor: H[ordem[0]], descartada: H[ordem[2]], contra: e.filter(x => x.h[ordem[2]] < 0).map(x => x.txt) };
    }
    const porCat = (R, id) => R.perfil.some(p => p.cat.id === id);
    // ── Indicadores de alerta (para acompanhamento) ──
    function indicadores(R) {
        const out = [];
        if (porCat(R, 'trafico')) out.push('aumento de registros de tráfico e de denúncias no entorno do endereço do alvo');
        if (porCat(R, 'armas') || porCat(R, 'letal')) out.push('ocorrências com disparo de arma de fogo ou ameaça armada na área de atuação');
        if (R.F.comoVitima.length) out.push('novos episódios de violência contra o alvo ou seus vínculos (risco de retaliação)');
        if (R.grupos.length || R.vCrim.length) out.push('prisão, soltura ou morte de vinculados, que pode alterar a estrutura do grupo');
        if (R.F.bnmp || R.F.mandadosAbertos.length) out.push('indícios de mudança de endereço ou de evasão da área (alvo com mandado pendente)');
        if (R.classes && R.classes['execução penal']) out.push('descumprimento de condições da execução penal (horários, monitoramento)');
        if (R.classes && R.classes['medida protetiva']) out.push('aproximação da vítima ou descumprimento de medida protetiva de urgência');
        return out;
    }
    // ── Análise de rede do CONJUNTO de alvos (coautoria, vínculos e endereços em comum) ──
    function redeConjunto(alvos) {
        if (alvos.length < 2) return null;
        const nome = a => N(val(((a.ficha || {}).dados || {}).nome)).trim();
        const arestas = [];
        const add = (i, j, motivo) => arestas.push({ i, j, motivo });
        const bos = alvos.map(a => new Set(fatos(a).registros.map(r => val(r.numero).replace(/\D/g, '')).filter(x => x.length >= 4)));
        const vincs = alvos.map(a => new Set(((a.ficha || {}).vinculos || []).map(v => N(val(v.nome)).trim()).filter(Boolean)));
        const ends = alvos.map(a => new Set(((a.ficha || {}).enderecos || []).map(e => N(val(e.texto)).replace(/\W+/g, ' ').trim()).filter(Boolean)));
        const facs = alvos.map(a => new Set(((a.ficha || {}).grupos || []).map(g => N(val(g.nome)).trim()).filter(Boolean)));
        for (let i = 0; i < alvos.length; i++) for (let j = i + 1; j < alvos.length; j++) {
            const co = [...bos[i]].filter(x => bos[j].has(x));
            if (co.length) add(i, j, `coautoria em ${co.length} registro(s) (nº ${co.slice(0, 3).join(', ')})`);
            if (vincs[i].has(nome(alvos[j])) || vincs[j].has(nome(alvos[i]))) add(i, j, 'vínculo direto cadastrado');
            const vc = [...vincs[i]].filter(x => vincs[j].has(x));
            if (vc.length) add(i, j, `${vc.length} vinculado(s) em comum`);
            if ([...ends[i]].some(x => ends[j].has(x))) add(i, j, 'mesmo endereço');
            const fc = [...facs[i]].filter(x => facs[j].has(x));
            if (fc.length) add(i, j, `mesma organização (${fc.join(', ')})`);
        }
        // um par = uma ligação, com todos os motivos juntos
        const porPar = new Map();
        arestas.forEach(a => { const k = a.i + '-' + a.j; if (!porPar.has(k)) porPar.set(k, { i: a.i, j: a.j, motivos: [] }); porPar.get(k).motivos.push(a.motivo); });
        const pares = [...porPar.values()].map(x => Object.assign(x, { motivo: x.motivos.join('; ') }));
        const grau = alvos.map((_, k) => pares.filter(a => a.i === k || a.j === k).length);
        const max = Math.max(...grau);
        return { arestas: pares, grau, articuladores: max > 0 ? grau.map((g, k) => g === max ? k : -1).filter(k => k >= 0) : [], densidade: pares.length / (alvos.length * (alvos.length - 1) / 2) };
    }
    // Parágrafos adicionais por alvo
    function paragrafosTecnicas(a, ref, k, rot) {
        const R = analisarAlvo(a), ps = [];
        const P = (bloco, rotulo, html) => ({ bloco: `${k}-xa-${bloco}`, rotulo: rot(rotulo), html });
        const leg = enquadramento(R.F);
        if (leg.length) ps.push(P('legal', 'análise — enquadramento legal', `As condutas registradas em desfavor de ${ref} amoldam-se, em tese, a ${listaE(leg.slice(0, 6).map(([d, n]) => `${esc(d)}${n > 1 ? ` — ${n} registros` : ''}`))}, sem prejuízo da tipificação definitiva pela autoridade competente.`));
        const lt = linhaTempo(R.F);
        if (lt.length >= 3) ps.push(P('cronologia', 'análise — linha do tempo', `Em ordem cronológica: ${lt.slice(-10).map(x => `${br(x.d)} — ${esc(x.t)}`).join('; ')}.`));
        const h = hipoteses(R);
        if (h) ps.push(P('ach', 'análise — hipóteses concorrentes', `Aplicada a técnica de Análise de Hipóteses Concorrentes, confrontaram-se três hipóteses: (1) ${h.H[0]}; (2) ${h.H[1]}; (3) ${h.H[2]}. Considerando as evidências — ${esc(h.e.map(x => x.txt).join('; '))} —, a hipótese mais consistente é a de <b>${esc(h.melhor)}</b>, avaliada como <b>${h.termo}</b>${h.contra.length ? `; a hipótese de ${esc(h.descartada)} mostra-se inconsistente com ${esc(listaE(h.contra.slice(0, 3)))}` : ''}.`));
        const ind = indicadores(R);
        if (ind.length) ps.push(P('indic', 'análise — indicadores de acompanhamento', `Recomenda-se acompanhar os seguintes indicadores relativos a ${ref}: ${ind.map(esc).join('; ')}.`));
        return ps;
    }
    // Parágrafos do conjunto: rede entre alvos + avaliação por estados da mente + sigilo
    function paragrafosConjunto(alvos, refs) {
        const ps = [];
        const rd = redeConjunto(alvos);
        if (rd) {
            if (rd.arestas.length) ps.push({ bloco: 'xa-rede-conj', rotulo: 'Análise de rede do conjunto', html: `A análise de rede entre os ${alvos.length} alvos identificou ${rd.arestas.length} ligação(ões): ${rd.arestas.slice(0, 8).map(x => `${refs[x.i]} ↔ ${refs[x.j]} (${esc(x.motivo)})`).join('; ')}. A densidade da rede é de ${Math.round(rd.densidade * 100)}%${rd.articuladores.length && rd.articuladores.length < alvos.length ? `, destacando-se ${listaE(rd.articuladores.map(k => refs[k]))} como ${rd.articuladores.length > 1 ? 'articuladores' : 'articulador(a)'} do grupo, por concentrar o maior número de conexões` : ''}.` });
            else ps.push({ bloco: 'xa-rede-conj', rotulo: 'Análise de rede do conjunto', html: `Não foram identificadas, nas bases consultadas, ligações diretas entre os ${alvos.length} alvos (coautoria, vínculos, endereços ou organização em comum), o que recomenda aprofundar os levantamentos antes de afirmar atuação conjunta.` });
        }
        return ps;
    }
    // Avaliação do conhecimento — estados da mente (DAI/ABIN 2023: certeza, probabilidade, possibilidade)
    function avaliacaoEstados(alvos) {
        const ofic = alvos.reduce((s, a) => s + fatos(a).registros.length + fatos(a).processos.length, 0);
        const inf = alvos.reduce((s, a) => s + ((a.ficha || {}).informacoes || []).length, 0), den = alvos.reduce((s, a) => s + ((a.ficha || {}).denuncias || []).length, 0);
        const partes = [];
        if (ofic) partes.push(`os ${ofic} registro(s) oficiais (CAD, ExchelonX, Tribunais, BNMP) expressam estado de <b>certeza</b> quanto à sua existência`);
        if (inf && den) partes.push(`os informes convergentes com as ${den} denúncia(s) expressam estado de <b>probabilidade</b>`);
        else if (inf || den) partes.push(`os ${inf + den} informe(s)/denúncia(s) ainda não corroborados por fonte independente expressam estado de <b>possibilidade</b>`);
        return `Quanto à avaliação do conhecimento, ${partes.length ? listaE(partes) : 'os dados disponíveis são insuficientes para elevar o grau de certeza'}. Ressalta-se que denúncia anônima, isoladamente, não autoriza a instauração de persecução penal, mas legitima averiguação preliminar com prudência e discrição (STF, RE 1.193.343 AgR). Sugere-se a classificação <b>RESERVADO</b> (Lei nº 12.527/2011), com difusão restrita a quem tenha necessidade de conhecer, ressalvada a decisão da autoridade classificadora. Por se tratar de documento de inteligência, não se destina a instruir procedimentos; o que for necessário à persecução deve ser extraído para documento próprio (informação policial ou Relatório Técnico).`;
    }

    // Resumo curto em HTML (chat do XERIFE / mapa)
    function resumoHTML(a, nome) {
        const R = analisarAlvo(a);
        return `<b>🧠 Análise do XERIFE — ${esc(nome)}</b><br>Risco: <b>${R.nivel}</b> (${R.pontos}/100)${R.fatores.length ? '<br>• ' + R.fatores.map(x => esc(x.txt)).join('<br>• ') : ''}
            ${R.perfil.length ? `<br><br><b>Perfil:</b> ${R.perfil.slice(0, 4).map(x => `${esc(x.cat.nome)} (${x.n})`).join(', ')}` : ''}
            ${R.ultimo ? `<br><b>Último registro:</b> ${br(R.ultimo)}${R.intervaloMedio ? ` · intervalo médio ${R.intervaloMedio} dias` : ''}` : ''}
            ${(() => { const h = hipoteses(R); return h ? `<br><br><b>Hipótese mais consistente (ACH):</b> ${esc(h.melhor)} — <i>${h.termo}</i>` : ''; })()}
            ${(() => { const l = enquadramento(R.F); return l.length ? `<br><b>Enquadramento legal (em tese):</b> ${l.slice(0, 4).map(([d]) => esc(d)).join('; ')}` : ''; })()}
            ${R.propostas.length ? `<br><br><b>Propostas:</b><br>• ${R.propostas.map(esc).join('<br>• ')}` : ''}`;
    }

    global.XerifeAnalista = { analisarAlvo, paragrafosAnalise, sintese, resumoHTML, categoriaDe, CATEGORIAS, enquadramento: a => enquadramento(fatos(a)), hipoteses: a => hipoteses(analisarAlvo(a)), redeConjunto, linhaTempo: a => linhaTempo(fatos(a)), termoProbabilidade };
})(window);
