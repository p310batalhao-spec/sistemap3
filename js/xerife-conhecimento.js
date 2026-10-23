// ═══════════════════════════════════════════════════════════════════
// XERIFE — BASE DE CONHECIMENTO + SKILLS (inspirado no OpenJarvis)
// ═══════════════════════════════════════════════════════════════════
// Ideias trazidas do open-jarvis/openjarvis, adaptadas ao navegador:
//  · MEMÓRIA com recuperação local: documentos divididos em trechos
//    (parágrafos acumulados até ~120 palavras, sobreposição de 20), índice
//    BM25 (k1=1.2, b=0.75) em duas visões — termos exatos e radicais — com
//    fusão por Reciprocal Rank Fusion (k=60, pesos 1.0 / 1.3), top-k=4 e
//    corte de contexto antes de ir para a IA local, sempre com a [Fonte].
//  · SKILLS como catálogo de ferramentas: cada uma com descrição, padrão de
//    disparo e executar(); o XERIFE escolhe a skill pela pergunta e devolve o
//    resultado (e, no Mapa de Inteligência, aciona o próprio mapa).
//  · Conhecimento dinâmico: no Mapa de Inteligência, os alvos do ExchelonX
//    (nome, vulgo, endereços, facção, vínculos) entram na memória.
// Nada aqui inventa dado: as respostas vêm dos documentos/dados indexados.
// ═══════════════════════════════════════════════════════════════════
(function (global) {
    'use strict';
    if (global.XerifeConhecimento) return;
    const N = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const STOP = new Set('a o as os um uma uns umas de do da dos das em no na nos nas por para pra pelo pela pelos pelas com sem e ou que se ao aos à às é ser foi são sao ter tem como mais menos muito sobre entre ate até isso essa esse esta este qual quais quando onde porque por que quem me te lhe nos vos eu tu ele ela eles elas meu minha seu sua seus suas o que oque voce você vc ja já nao não sim tambem também ha há'.split(' '));
    const tokens = s => N(s).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 1 && !STOP.has(t));
    const radical = t => t.length > 6 ? t.slice(0, 6) : t.replace(/(oes|aes|es|s)$/, '') || t;

    // ── Documentos de conhecimento (doutrina, análise criminal, sistema) ──
    const DOCS = [
        ['DNISP — Ciclo de Inteligência', 'doutrina', `O ciclo da produção do conhecimento de inteligência, segundo a Doutrina Nacional de Inteligência de Segurança Pública (DNISP), compreende: planejamento (definição do assunto, aspectos essenciais, prazos e fontes), reunião (coleta em fontes abertas e busca em fontes protegidas), processamento (avaliação, análise, integração e interpretação dos dados) e formalização/difusão (produção do documento e entrega ao usuário com necessidade de conhecer).

A reunião de dados usa coleta (fontes abertas, bancos de dados, CAD, BNMP, Tribunais, redes sociais) e busca (ações de inteligência como reconhecimento, vigilância, entrevista, recrutamento operacional, infiltração), sempre com controle e compartimentação.`],
        ['DNISP — Tipos de conhecimento', 'doutrina', `A DNISP classifica o conhecimento produzido em: INFORME (conhecimento resultante de juízo formulado pelo profissional, que expressa estado de certeza ou de opinião sobre fato ou situação passada ou presente, ainda não submetido a análise completa); INFORMAÇÃO (conhecimento que expressa estado de certeza, resultante de raciocínio elaborado, sobre fatos ou situações passados ou presentes); APRECIAÇÃO (conhecimento que expressa estado de opinião sobre fatos ou situações passados ou presentes, podendo projetar evolução futura); ESTIMATIVA (conhecimento que expressa estado de opinião sobre a evolução futura de fato ou situação).

No RELINT, dados de registros oficiais (CAD, BNMP, Tribunais) são tratados como informação confirmada; dados de fontes humanas, denúncias e levantamentos ainda não confirmados são informes, redigidos no futuro do pretérito (seria, atuaria, utilizaria, manteria).`],
        ['DNISP — Avaliação de dados (idoneidade e veracidade)', 'doutrina', `A técnica de avaliação de dados combina a IDONEIDADE DA FONTE e a VERACIDADE DO CONTEÚDO. Idoneidade da fonte: A — inteiramente idônea; B — normalmente idônea; C — razoavelmente idônea; D — normalmente inidônea; E — inidônea; F — idoneidade não pode ser avaliada. Veracidade do conteúdo: 1 — confirmado por outras fontes; 2 — provavelmente verdadeiro; 3 — possivelmente verdadeiro; 4 — duvidoso; 5 — improvável; 6 — veracidade não pode ser avaliada. A combinação (ex.: B2) acompanha o dado e orienta o grau de certeza da redação.`],
        ['RELINT — Estrutura do Relatório de Inteligência', 'doutrina', `O Relatório de Inteligência (RELINT) é o documento que difunde conhecimento produzido. Estrutura usual: cabeçalho (órgão, número, data, assunto, difusão, referência, anexos e grau de sigilo); corpo com introdução (contexto e fontes de forma genérica), desenvolvimento por alvo (identificação, endereço, informes, antecedentes, situação judicial, veículos, vínculos e denúncias), análise (perfil criminal, dinâmica temporal, rede de relacionamentos e avaliação de risco), conclusão dirigida ao decisor, propostas de ação, lacunas de inteligência e avaliação do conhecimento; anexos (fotos, Consulta Integrada).

Regras de redação: linguagem impessoal, em terceira pessoa, clara, concisa e precisa; nomes e vulgos em MAIÚSCULAS; nunca identificar fontes humanas; distinguir certeza (registros oficiais) de opinião (informes); a conclusão responde ao "e daí?" do decisor.`],
        ['RELINT no Sistema P3 — como gerar', 'sistema', `Na página Relatório de Inteligência (RELINT), busque o alvo (nome, vulgo ou CPF) ou um grupo (facção/ORCRIM) no ExchelonX e adicione-o. Use "Consulta Integrada" para trazer CAD, PPE, PC, BNMP e Tribunais. O botão "🧠 XERIFE: análise completa" consulta o que faltar, analisa ficha alvo + CAD + processos + mandados e redige o relatório completo: perfil criminal, dinâmica temporal, vitimização, situação processual, rede de relacionamentos, avaliação de risco com fatores, conclusão, propostas de ação, lacunas e avaliação do conhecimento. "Refinar redação com o XERIFE" usa a IA local só para melhorar a escrita, sem acrescentar dados. A prévia permite marcar e desmarcar blocos antes de imprimir.`],
        ['Análise de vínculos (link analysis)', 'analise', `A análise de vínculos (Social Network Analysis) representa pessoas como nós e relações como arestas. Métricas úteis: grau de centralidade (quantidade de vínculos diretos — identifica articuladores), intermediação (quem conecta grupos distintos — figura-chave para desarticular a rede) e proximidade. Vínculos de 2º grau (os vínculos dos vinculados) revelam fornecedores, gerentes e pontos de apoio. A figura central nem sempre é o líder formal. No Mapa de Inteligência, "🕸 Mostrar rede no mapa" exibe o alvo e os vinculados com arcos coloridos por tipo (criminal, familiar, afetivo, social, outro), espessura conforme a confiança e o botão "➕ 2º grau".`],
        ['Hotspots, near repeat e policiamento orientado ao problema', 'analise', `Hotspots são concentrações espaciais de crimes; o policiamento em hotspots reduz crimes sem simplesmente deslocá-los quando a presença é intermitente (efeito Koper: permanências de 10 a 15 minutos, repetidas). O fenômeno near repeat indica que, após um crime, locais próximos têm risco elevado por alguns dias. O policiamento orientado ao problema segue o método SARA: Scanning (identificação), Analysis (análise do triângulo do crime — ofensor, vítima, local), Response (resposta) e Assessment (avaliação). O Sistema P3 aplica pesos de gravidade e recência para delimitar áreas (OPO Inteligente e Operação Sufocamento).`],
        ['Operação Sufocamento', 'sistema', `A Operação Sufocamento (Controle de Operações / OPO Inteligente) foca armas, drogas, MVI, CVP e CCP. Pesos: MVI 1,00; arma 0,85; droga 0,75; CVP 0,55; CCP 0,30, multiplicados pela recência (até 30 dias ×1; até 90 ×0,75; mais antigo ×0,5). Ocorrências próximas são agrupadas no raio escolhido e as áreas de maior pontuação são delimitadas. Em cada área, por 30 minutos: RPs no entorno (bloqueio nos pontos N, L, S, O) e especializadas (PELOPES/Tático Urbano e Tático Rural) em saturação no interior; depois todas seguem para a próxima área. Gera documento no modelo da OPO, com mapas, Word e PDF, e fica no calendário do Controle de Operações.`],
        ['Definições — MVI, CVLI, CVP, CCP', 'definicoes', `MVI (mortes violentas intencionais): homicídio, feminicídio e latrocínio (inclui homicídio culposo/doloso ao volante, como nos cards do index); tentativa só conta com óbito confirmado (OBITO = S). CVLI (crimes violentos letais intencionais): homicídio, feminicídio e latrocínio, inclusive tentativas (regra do Dashboard Cruzado). CVP (crimes violentos contra o patrimônio): roubo e extorsão. CCP (crimes contra o patrimônio sem violência): furto, receptação, dano, estelionato e apropriação indébita. TCO: termo circunstanciado de ocorrência para infrações de menor potencial ofensivo.`],
        ['Mapa de Inteligência — funções', 'sistema', `O Mapa de Inteligência reúne as camadas de ocorrências do Firebase (calor, pontos ou ambos), filtro de período, polígonos salvos, GeoJSON, busca de ocorrências por nome/CPF e a camada de ALVOS do ExchelonX. Endereços com coordenada inválida são localizados pelo texto do endereço (rua com número, rua, bairro, cidade) e salvos para todos. Ao desenhar um polígono, o popup mostra quantas ocorrências e alvos há na região; o relatório abre uma seleção com caixas de marcação e inclui a seção de alvos. No popup de um alvo: "🕸 Mostrar rede no mapa" (modo foco com o alvo e os vinculados, demais alvos saem da tela) e "🔎 Ocorrências no CAD" (base da unidade e, com o exe aberto, a Consulta Integrada pelo CPF). Pergunte ao XERIFE: "mostre a rede de NOME", "ocorrências de NOME no mapa", "onde mora NOME", "alvos no bairro X", "analise o alvo NOME", "sair do foco".`],
        ['Desempenho por guarnição e grupo', 'sistema', `No Controle de Operações, a aba Desempenho cruza as ocorrências do CAD com a escala (turno de 24h das 08h às 08h; grupos A, B, C, D em ciclo contínuo). Atribuição da guarnição: equipe do boletim (CAD/TCO), solicitante (iniciativa própria), relato do despachante e, por último, a área da RP. Tem filtragem cruzada por clique, comparação com o mês anterior nos cards e relatório para impressão com os filtros aplicados.`],
        ['Painel do Comando', 'sistema', `O Painel do Comando (público) compara 2025 e 2026 no mês atual e no total do ano: Total de Ocorrências, TCO, MVI, CVLI, CVP, Armas, Drogas, Cumprimento de Mandados, Violência Doméstica, Perturbação do Sossego e Trânsito (AITs). Clicar num tema expande as tipificações (ou descrições, no trânsito), por cidade e por tipo, com variação. Pode comparar 2025 no mesmo período ou completo.`],
        ['Avaliação de risco de alvos (critério do XERIFE)', 'analise', `O XERIFE atribui risco a um alvo somando fatores explícitos: mandado pendente (25), crime violento letal (20), arma de fogo (15), vinculação a facção/ORCRIM (15) ou vínculos criminais (8), crimes violentos contra o patrimônio (10), tráfico (10), reiteração com 3 ou mais registros (10), atividade nos últimos 12 meses (10), escalada de gravidade (10), vitimização em crime violento (5) e execução penal (5). Até 19: BAIXO; 20–39: MÉDIO; 40–59: ALTO; 60 ou mais: CRÍTICO. Os fatores sempre aparecem junto do resultado.`],
    ];

    // ── Índice BM25 (duas visões) + RRF ─────────────────────────────
    function trechos(texto, tam = 120, sobre = 20) {
        const pars = String(texto).split(/\n\s*\n/).map(s => s.trim()).filter(Boolean), out = [];
        let buf = [];
        pars.forEach(p => {
            const w = p.split(/\s+/);
            if (buf.length + w.length > tam && buf.length) { out.push(buf.join(' ')); buf = buf.slice(-sobre); }
            buf = buf.concat(w);
        });
        if (buf.length) out.push(buf.join(' '));
        return out;
    }
    class BM25 {
        constructor(docs, tok) { this.tok = tok; this.docs = docs.map(d => tok(d)); this.N = docs.length; this.avg = this.docs.reduce((s, d) => s + d.length, 0) / Math.max(1, this.N); this.df = new Map(); this.docs.forEach(d => new Set(d).forEach(t => this.df.set(t, (this.df.get(t) || 0) + 1))); }
        score(q) {
            const qt = [...new Set(this.tok(q))];
            return this.docs.map((d, i) => {
                const tf = new Map(); d.forEach(t => tf.set(t, (tf.get(t) || 0) + 1));
                let s = 0;
                qt.forEach(t => { const f = tf.get(t); if (!f) return; const idf = Math.log(1 + (this.N - this.df.get(t) + .5) / (this.df.get(t) + .5)); s += idf * f * 2.2 / (f + 1.2 * (1 - .75 + .75 * d.length / this.avg)); });
                return { i, s };
            }).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
        }
    }
    const M = { chunks: [], exato: null, rad: null, versao: 0 };
    function indexar(extras) {
        M.chunks = [];
        DOCS.concat(extras || []).forEach(([titulo, fonte, texto]) => trechos(texto).forEach(t => M.chunks.push({ titulo, fonte, texto: t })));
        const corpo = c => c.titulo + ' ' + c.titulo + ' ' + c.texto; // título com peso dobrado
        M.exato = new BM25(M.chunks.map(corpo), tokens);
        M.rad = new BM25(M.chunks.map(corpo), s => tokens(s).map(radical));
        M.versao++;
    }
    function buscar(q, k = 4) {
        if (!M.exato || (global.MapaAlvos && global.MapaAlvos.carregado && M.alvosIndexados !== Object.keys(global.MapaAlvos.pessoas).length)) indexarComAlvos();
        const rrf = new Map();
        [[M.exato.score(q), 1.0], [M.rad.score(q), 1.3]].forEach(([lista, w]) => lista.slice(0, k * 3).forEach((x, pos) => rrf.set(x.i, (rrf.get(x.i) || 0) + w / (60 + pos + 1))));
        const melhorBM = (M.rad.score(q)[0] || { s: 0 }).s;
        return { melhor: melhorBM, itens: [...rrf.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([i, s]) => Object.assign({ rrf: s }, M.chunks[i])) };
    }
    // Alvos do Mapa de Inteligência viram documentos da memória
    function indexarComAlvos() {
        const A = global.MapaAlvos, extras = [];
        if (A && A.carregado) {
            Object.values(A.pessoas).forEach(p => {
                const ends = (A.porPessoa[p.id] || []).map(e => e.texto).filter(Boolean);
                const vinc = p.vinculos.map(v => (A.pessoas[v.id] || {}).nome).filter(Boolean);
                extras.push([`Alvo ${p.nome}${p.apelidos.length ? ' (' + p.apelidos.join(', ') + ')' : ''}`, 'alvo',
                    `${p.nome}${p.apelidos.length ? ', vulgo ' + p.apelidos.join(', ') : ''}. ${ends.length ? 'Endereço(s): ' + ends.join('; ') + '.' : 'Sem endereço cadastrado.'} ${p.grupos.length ? 'Facção/ORCRIM: ' + p.grupos.map(g => g.nome + (g.funcao ? ' (' + g.funcao + ')' : '')).join(', ') + '.' : ''} ${vinc.length ? 'Vínculos: ' + vinc.join(', ') + '.' : ''}`]);
            });
            M.alvosIndexados = Object.keys(A.pessoas).length;
        }
        indexar(extras);
    }

    // ── Resolução de nomes de alvos (nome completo, partes do nome ou vulgo) ──
    function resolverAlvo(texto) {
        const A = global.MapaAlvos; if (!A || !A.carregado) return null;
        const q = ' ' + N(texto).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ') + ' ';
        let melhor = null, ms = 0;
        Object.values(A.pessoas).forEach(p => {
            let s = 0;
            p.apelidos.forEach(ap => { const a = N(ap).trim(); if (a.length >= 3 && q.includes(' ' + a + ' ')) s += 5; });
            const partes = N(p.nome).split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));
            const hit = partes.filter(w => q.includes(' ' + w + ' ')).length;
            if (hit >= 2) s += hit + (hit === partes.length ? 3 : 0);
            if (s > ms) { ms = s; melhor = p; }
        });
        return ms >= 3 ? melhor : null;
    }

    // ── SKILLS (catálogo de ferramentas) ────────────────────────────
    const naPaginaMapa = () => !!(global.MapaAlvos && global.MapaAlvos.carregado);
    const linkMapa = (p, acao) => `<a href="${(/\/page\//.test(location.pathname) ? '' : 'page/')}mapaInteligencia.html?alvo=${encodeURIComponent(p ? p.id || p : '')}&acao=${acao}">abrir no Mapa de Inteligência</a>`;
    const SKILLS = [
        { id: 'sair_foco', descricao: 'Sai do modo foco do mapa e volta a mostrar tudo', rx: /\b(sair|sai|limpar|encerrar)\b.*\b(foco|rede|mapa)\b|\bmostrar todos os alvos\b/,
            executar: () => naPaginaMapa() ? (global.MapaAlvos.sairFoco(), '🗺 Pronto — saí do modo foco; o mapa voltou a mostrar todas as camadas e alvos.') : null },
        { id: 'rede', descricao: 'Mostra no mapa a rede de vínculos de um alvo (1º ou 2º grau)', rx: /\b(rede|vinculos?|vinculad|ligac|conexo|comparsa)/,
            executar: async (q, txt) => {
                const p = resolverAlvo(txt); if (!p) return null;
                const grau = /2|segundo grau|2o grau|completa/.test(q) ? 2 : 1;
                if (!naPaginaMapa()) return `🕸 <b>${esc(p.nome)}</b> — ${linkMapa(p, 'rede')} para ver a rede.`;
                await global.MapaAlvos.focarRede(p.id, grau);
                const r = global.MapaAlvos.foco.info.rede || {};
                return `🕸 Mostrando no mapa a rede de <b>${esc(p.nome)}</b>${grau > 1 ? ' (até o 2º grau)' : ''}: ${r.nos || 1} pessoa(s), ${r.noMapa || 0} vinculado(s) com endereço. Os demais alvos saíram do mapa — diga <i>"sair do foco"</i> para voltar.`;
            } },
        { id: 'ocorrencias', descricao: 'Mostra no mapa as ocorrências do CAD em que um alvo esteve envolvido', rx: /\b(ocorrenc|boletins?|bos?\b|cad\b|passagens?|antecedentes?)/,
            executar: async (q, txt) => {
                const p = resolverAlvo(txt); if (!p) return null;
                if (!naPaginaMapa()) return `🔎 <b>${esc(p.nome)}</b> — ${linkMapa(p, 'ocorrencias')} para ver as ocorrências no mapa.`;
                global.MapaAlvos.ocorrenciasAlvo(p.id);
                return `🔎 Buscando as ocorrências de <b>${esc(p.nome)}</b> (base da unidade e, com o exe aberto, CAD completo pelo CPF) — os pontos aparecem no mapa e a lista fica na barra no topo.`;
            } },
        { id: 'analise', descricao: 'Analisa um alvo: perfil criminal, risco, rede e propostas', rx: /\banalis|\bperfil (criminal )?(do|da|de)\b|\brisco (do|da) alvo/,
            executar: async (q, txt) => {
                // fora do mapa, só busca no ExchelonX se a pergunta falar em "alvo" (evita confundir com estatística)
                const p = resolverAlvo(txt) || (/\balvo\b/.test(q) ? await buscarPessoaExchelon(txt) : null); if (!p) return null;
                return await analisarPessoa(p);
            } },
        { id: 'onde', descricao: 'Mostra no mapa onde mora / o endereço de um alvo', rx: /\b(onde mora|endereco|reside|residencia|localiza|focar|ir para|mostra[r]?)\b/,
            executar: (q, txt) => {
                const p = resolverAlvo(txt); if (!p) return null;
                const A = global.MapaAlvos, ends = A.porPessoa[p.id] || [];
                if (!ends.length) return `🏠 <b>${esc(p.nome)}</b> não tem endereço cadastrado no ExchelonX.`;
                const e0 = ends.find(e => e.lat != null);
                if (e0 && naPaginaMapa()) A.irPara(e0.residenciaId);
                return `🏠 <b>${esc(p.nome)}</b>${p.apelidos.length ? ` “${esc(p.apelidos[0])}”` : ''}: ${ends.map(e => esc(e.texto)).join('<br>')}${e0 ? '' : '<br><small>(endereço ainda não localizado no mapa)</small>'}`;
            } },
        { id: 'alvos_local', descricao: 'Lista os alvos com endereço em um bairro ou cidade', rx: /\balvos?\b.*\b(no|na|em|do|da)\b\s+(bairro|cidade|povoado|conjunto|loteamento)?/,
            executar: (q) => {
                const A = global.MapaAlvos; if (!A || !A.carregado) return null;
                const m = q.match(/\b(?:no|na|em|do|da)\s+(?:bairro|cidade|povoado|conjunto|loteamento)?\s*(.{3,40})$/); if (!m) return null;
                const alvo = N(m[1]).replace(/[?.!]/g, '').trim();
                const achados = A.enderecos.filter(e => N([e.bairro, e.cidade, e.texto].join(' ')).includes(alvo));
                const pessoas = [...new Set(achados.map(e => e.pessoaId))].map(id => A.pessoas[id]);
                if (!pessoas.length) return `Nenhum alvo com endereço em “${esc(m[1])}”.`;
                const busca = document.getElementById('alvo-busca'); if (busca) { busca.value = m[1].trim(); A.filtrar(); }
                return `🎯 ${pessoas.length} alvo(s) com endereço em <b>${esc(m[1].trim())}</b> (filtrados no mapa):<br>${pessoas.slice(0, 25).map(p => `• ${esc(p.nome)}${p.apelidos.length ? ` “${esc(p.apelidos[0])}”` : ''}${p.grupos.length ? ' — ' + esc(p.grupos[0].nome) : ''}`).join('<br>')}`;
            } },
    ];
    // Busca no ExchelonX pelo atualizador local (fora do mapa)
    async function buscarPessoaExchelon(txt) {
        const termo = (txt.match(/(?:alvo|de|do|da)\s+([A-Za-zÀ-ú ]{5,60})$/i) || [])[1];
        if (!termo) return null;
        const base = (global.P3AtualizadorLocal && P3AtualizadorLocal.URL_BASE) || 'http://localhost:5057';
        try { const b = await fetch(`${base}/relint/buscar?q=${encodeURIComponent(termo.trim())}`).then(r => r.json()); return (b.pessoas || [])[0] ? { id: b.pessoas[0].id, nome: b.pessoas[0].nome, externo: true } : null; } catch (e) { return null; }
    }
    // Análise de um alvo para o chat: ficha completa (exe) ou dados do mapa + base da unidade
    async function analisarPessoa(p) {
        if (!global.XerifeAnalista) await new Promise(ok => { const s = document.createElement('script'); s.src = (/\/page\//.test(location.pathname) ? '../' : '') + 'js/xerife-analista.js'; s.onload = ok; s.onerror = ok; document.body.appendChild(s); });
        if (!global.XerifeAnalista) return '⚠️ Módulo de análise indisponível.';
        const base = (global.P3AtualizadorLocal && P3AtualizadorLocal.URL_BASE) || 'http://localhost:5057';
        let ficha = null;
        try { const r = await fetch(`${base}/relint/ficha?id=${encodeURIComponent(p.id)}`); if (r.ok) ficha = (await r.json()).ficha; } catch (e) { /* exe fechado */ }
        if (!ficha && global.MapaAlvos && global.MapaAlvos.pessoas[p.id]) {
            const A = global.MapaAlvos, x = A.pessoas[p.id];
            ficha = { dados: { nome: x.nome, cpf: x.cpf }, apelidos: x.apelidos, grupos: x.grupos, enderecos: A.porPessoa[p.id] || [], fotos: x.fotos,
                vinculos: x.vinculos.map(v => ({ nome: (A.pessoas[v.id] || {}).nome, tipo: v.tipo, subtipo: v.sub, nivelConfianca: v.conf })) };
        }
        if (!ficha) return `⚠️ Não consegui a ficha de <b>${esc(p.nome)}</b> — abra o Sistema P3 (exe) com login P2/ADMIN ou use o Mapa de Inteligência.`;
        // Ocorrências da base da unidade (Firebase /autor) pelo CPF, quando disponíveis nesta página
        const ocorrencias = [];
        try {
            const cpf = String(ficha.dados.cpf || '').replace(/\D/g, '');
            if (cpf.length >= 9 && typeof DADOS_FB !== 'undefined' && DADOS_FB.autores) {
                const bols = new Set(DADOS_FB.autores.filter(a => String(a.CPF || a.cpf || '').replace(/\D/g, '') === cpf).map(a => String(a.BOLETIM || a.boletim || '').replace(/\D/g, '')).filter(Boolean));
                (DADOS_FB.geral || []).forEach(o => { if (bols.has(String(o.BOLETIM || '').replace(/\D/g, ''))) ocorrencias.push({ fonte: 'CAD', numero: o.BOLETIM, data: o.DATA, natureza: o.TIPIFICACAO_GERAL || o.TIPIFICACAO, envolvimento: 'AUTOR' }); });
            }
        } catch (e) { /* sem base */ }
        const html = XerifeAnalista.resumoHTML({ ficha, consulta: ocorrencias.length ? { ocorrencias, processos: [], bnmp: {} } : null }, ficha.dados.nome || p.nome);
        return html + `<br><small>Para a análise com CAD completo, processos e BNMP, gere o relatório em <a href="${/\/page\//.test(location.pathname) ? '' : 'page/'}relint.html">RELINT → 🧠 XERIFE: análise completa</a>.</small>`;
    }
    async function executarSkill(textoOriginal) {
        const q = N(textoOriginal);
        for (const s of SKILLS) {
            if (!s.rx.test(q)) continue;
            try { const r = await s.executar(q, textoOriginal); if (r) return r; } catch (e) { console.warn('[xerife skill]', s.id, e); }
        }
        return null;
    }

    // ── Resposta pela base de conhecimento (RAG) ────────────────────
    async function responder(textoOriginal, ia) {
        const r = buscar(textoOriginal, 4);
        if (!r.itens.length || r.melhor < 1.2) return null;
        const ctx = r.itens.slice(0, 3);
        if (ia && ia.pronto && ia.gerar) {
            const contexto = ctx.map(c => `[Fonte: ${c.titulo}] ${c.texto}`).join('\n\n').split(/\s+/).slice(0, 900).join(' ');
            const sys = 'Você é o XERIFE, assistente de inteligência da Polícia Militar de Alagoas. Responda em português, de forma objetiva, USANDO SOMENTE o CONTEXTO abaixo. Se o contexto não tiver a resposta, diga que não consta na base. Não invente dados.\n\nCONTEXTO:\n' + contexto;
            try {
                const out = await ia.gerar([{ role: 'system', content: sys }, { role: 'user', content: textoOriginal }], { temperature: 0.2, max_tokens: 400 });
                if (out && String(out).trim()) return `📚 ${esc(String(out).trim()).replace(/\n/g, '<br>')}<br><small>Fontes: ${[...new Set(ctx.map(c => esc(c.titulo)))].join(' · ')}</small>`;
            } catch (e) { /* cai na resposta extrativa */ }
        }
        const c0 = ctx[0];
        return `📚 <b>${esc(c0.titulo)}</b><br>${esc(c0.texto)}${ctx[1] && ctx[1].titulo !== c0.titulo ? `<br><br><small>Veja também: ${[...new Set(ctx.slice(1).map(c => esc(c.titulo)))].join(' · ')}</small>` : ''}`;
    }
    // Pergunta conceitual explícita ("o que é…", "como funciona…", "explique…")
    const ehPerguntaConceitual = q => /^(o que (e|sao|significa)|oque e|como (funciona|faco|usar|uso|gerar|gero|fazer)|explique|explica|defina|definicao|qual a diferenca|para que serve|o que faz)\b/.test(N(q).trim());

    global.XerifeConhecimento = { buscar, responder, executarSkill, resolverAlvo, analisarPessoa, ehPerguntaConceitual, indexar: indexarComAlvos, SKILLS, DOCS };
})(window);
