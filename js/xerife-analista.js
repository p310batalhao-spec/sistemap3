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
        return { conclusao, propostas, lacunas, avaliacao, maior };
    }
    // Resumo curto em HTML (chat do XERIFE / mapa)
    function resumoHTML(a, nome) {
        const R = analisarAlvo(a);
        return `<b>🧠 Análise do XERIFE — ${esc(nome)}</b><br>Risco: <b>${R.nivel}</b> (${R.pontos}/100)${R.fatores.length ? '<br>• ' + R.fatores.map(x => esc(x.txt)).join('<br>• ') : ''}
            ${R.perfil.length ? `<br><br><b>Perfil:</b> ${R.perfil.slice(0, 4).map(x => `${esc(x.cat.nome)} (${x.n})`).join(', ')}` : ''}
            ${R.ultimo ? `<br><b>Último registro:</b> ${br(R.ultimo)}${R.intervaloMedio ? ` · intervalo médio ${R.intervaloMedio} dias` : ''}` : ''}
            ${R.propostas.length ? `<br><br><b>Propostas:</b><br>• ${R.propostas.map(esc).join('<br>• ')}` : ''}`;
    }

    global.XerifeAnalista = { analisarAlvo, paragrafosAnalise, sintese, resumoHTML, categoriaDe, CATEGORIAS };
})(window);
