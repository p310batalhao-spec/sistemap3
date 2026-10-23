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
// Stopwords: lista própria + stopwords-iso/pt (MIT, github.com/stopwords-iso),
// sem os termos com peso no domínio (ano, certeza, grupo, área…).
// Nada aqui inventa dado: as respostas vêm dos documentos/dados indexados.
// ═══════════════════════════════════════════════════════════════════
(function (global) {
    'use strict';
    if (global.XerifeConhecimento) return;
    const N = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const STOP = new Set('a o as os um uma uns umas de do da dos das em no na nos nas por para pra pelo pela pelos pelas com sem e ou que se ao aos à às é ser foi são sao ter tem como mais menos muito sobre entre ate até isso essa esse esta este qual quais quando onde porque por que quem me te lhe nos vos eu tu ele ela eles elas meu minha seu sua seus suas o que oque voce você vc ja já nao não sim tambem também ha há acerca adeus agora ai ainda alem algmas algo algumas alguns ali ambas ambos antes ao aonde aos apenas apos aquela aquelas aquele aqueles aqui aquilo as assim ate atras atraves ca cada com como cuja cujas cujo cujos da dao daquela daquelas daquele daqueles das de debaixo dela delas dele deles demais dentro depois desde desligado dessa dessas desse desses desta destas deste destes deve devem devera diante dispoe dispoem diversa diversas diversos do dos durante duvida ela elas ele eles em entao eram eramos es essas esse esses esta estamos estao estar estara estas estava estavam estavamos este esteja estejam estejamos estes esteve estive estivemos estiver estivera estiveram estiveramos estiverem estivermos estivesse estivessem estivessemos estiveste estivestes estou eu faco fara faz fazeis fazem fazemos fazes fazia foi fomos for foram foramos forem formos fosse fossem fossemos foste fostes fui ha haja hajam hajamos hao havemos havia hei houve houvemos houver houvera houveram houveramos houverao houverei houverem houveremos houveria houveriam houveriamos houvermos houvesse houvessem houvessemos iniciar ir ira isso ista iste isto ja la lhe lhes ligado logo longe maioria maiorias mas maximo me mediante mesma mesmas mesmo mesmos meu meus mil minha minhas muitos na nao naquela naquelas naqueles nas nem nessa nessas nesse nesses nesta nestas neste nestes no noite nos nossa nossas nosso nossos num numa numas nunca nuns obrigada obrigado oitava oitavo onde os ou outra outras outro outros para parece paucas pela pelas pelos perante pessoas podera podia poe poem pois ponto pontos por porque portanto posso povo promeiro propios propria proprias proprios proximas proximos puderam quais qual qualquer quando quanto que quem quer quereis querem queremas queres quero questao sabem saber sao se seja sejam sejamos sem sendo ser sera serao serei seremos seria seriam seriamos seu seus sim so sob sobre sois somente somos sou sua suas talvez tambem tantas tao te tem temos tendes tenha tenham tenhamos tenho tens tentaram tente tentei ter tera terao terei teremos teria teriam teriamos teu teus teve tinha tinham tinhamos tive tivemos tiver tivera tiveram tiveramos tiverem tivermos tivesse tivessem tivessemos tiveste tivestes toda todas todos trabalhar trabalho tu tua tuas tudo um uma umas uns usa usar vais valor vao varios veja vem vens ver verdade verdadeiro viagem vindo voce voces vos vossa vossas vosso vossos'.split(' '));
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
        // ── Ampliação da base (pesquisa: DAI/ABIN 2023, DNISP 2014/2016, MPRJ 2024, Heuer, Kent, Manual de Redação, legislação) ──
        ['Doutrina da Atividade de Inteligência (ABIN, 2023) — estados da mente', 'doutrina', `A Doutrina da Atividade de Inteligência (DAI, ABIN 2023) substituiu os estados da mente perante a verdade da doutrina anterior (ignorância, dúvida, opinião e certeza) por IGNORÂNCIA, POSSIBILIDADE, PROBABILIDADE e CERTEZA. Certeza: a mente adere à imagem por ela formada sem receio de erro (ex.: registro oficial). Probabilidade: há motivos preponderantes para aceitar a imagem, com algum receio de erro (ex.: informes convergentes de fontes distintas). Possibilidade: os motivos favoráveis e contrários se equivalem ou são insuficientes (ex.: denúncia isolada). Ignorância: ausência de imagem. A redação do documento deve deixar explícito o estado da mente do analista, e na DNISP o tipo de conhecimento transmitido deve estar claro na forma da redação, pois todos circulam como Relatório de Inteligência (RELINT).

Fonte: CARVALHO, A. TCC CSIE/ESG, 2024, com base em ABIN (2016; 2023) e DNISP (Brasil, 2014).`],
        ['Tipos de conhecimento — DAI e DNISP', 'doutrina', `Na DAI (ABIN 2023): INFORME é o conhecimento narrativo-descritivo, fruto de juízos sobre fatos, eventos, situações ou fenômenos passados e presentes; APRECIAÇÃO é o conhecimento interpretativo, fruto de juízos e raciocínios explicativos sobre o passado, o presente e o futuro imediato; ESTIMATIVA é o conhecimento interpretativo-prospectivo, fruto de raciocínios preditivos sobre a evolução futura (futuro distante). A INFORMAÇÃO, prevista na DNISP como conhecimento que expressa certeza resultante de raciocínio, foi absorvida pela Apreciação na DAI. Na DNISP não há documentos diferentes para cada tipo de conhecimento: todos são veiculados em RELINT.`],
        ['Classificações da produção de conhecimento (DAI)', 'doutrina', `Por PROPÓSITO: inteligência estratégica (assessora decisões sobre políticas públicas), tática, operacional e de base (acompanhamento temático ordinário e aprofundado). Por RECORTE TEMPORAL: inteligência de alerta (eventos iminentes), corrente (situações estabelecidas, acompanhamento de alterações), explanativa e prospectiva. Pela ORIGEM dos dados: inteligência de fontes humanas (HUMINT), de fontes técnicas (TECHINT) e de fontes abertas (OSINT). As classificações combinam-se: um conhecimento tem um propósito e um recorte temporal, mas pode conter dados de diversas origens.`],
        ['Ciclo de Inteligência (DAI) e Metodologia de Produção do Conhecimento', 'doutrina', `Na DAI o ciclo compreende OBJETIVAR (direção do organismo define o que acompanhar), ACOMPANHAR (fase permanente: planejamento, reunião e processamento de dados), INFORMAR (formalização e difusão), DECIDIR e AGIR (fases da autoridade destinatária). Na ISP, a produção segue etapas de planejamento, reunião de dados, avaliação dos dados e informações, análise, integração, interpretação, formalização e difusão, excluídas ações meramente intuitivas e procedimentos sem orientação racional. As fases da metodologia se interpenetram e são interdependentes.`],
        ['Documentos de Inteligência de Segurança Pública', 'doutrina', `Documentos de Inteligência são documentos padronizados, redigidos em texto claro, ordenado e objetivo, que circulam internamente ou entre as Agências de Inteligência para transmitir ou solicitar conhecimentos. Documentos externos usuais: Pedido de Busca (PB), Relatório de Inteligência (RELINT), Relatório Periódico de Inteligência (RPI), Relatório Especial de Inteligência (REI), Mensagem, Sumário e Relatório Técnico (RT). DADO é toda representação de fato, situação, comunicação, notícia, documento, fotografia, gravação, relato ou denúncia ainda não submetida à metodologia de produção do conhecimento. DENÚNCIA é o dado que contém acusação, ostensiva ou sigilosa, formal ou anônima, sobre falta ou crime cometido ou na iminência de ser cometido. Os documentos de ISP recebem classificação conforme a sensibilidade do assunto e não podem ser inseridos em procedimentos ou processos, salvo o Relatório Técnico.

Fonte: DNISP (2014/2016); LAVAREDA, M. J. O Relatório Técnico na ISP. Revista do MPRJ nº 91, 2024.`],
        ['Relatório Técnico (RT) e uso do RELINT na persecução penal', 'doutrina', `Relatório Técnico é o documento externo padronizado, passível de classificação, que transmite de forma excepcional análises técnicas e de dados destinados a subsidiar o destinatário, inclusive na produção de provas. O RELINT não é usado como prova, mas pode ser "dissecado": o que for útil à persecução é extraído para informação policial ou outro documento de investigação, respeitando o contraditório e a ampla defesa. Dados de fontes humanas isolados têm baixo valor probatório; compilados e convergentes com dados técnicos, ganham peso para orientar a investigação.

Fonte: LAVAREDA, M. J. Revista do MPRJ nº 91, jan./mar. 2024.`],
        ['Denúncia anônima — entendimento do STF', 'juridico', `Segundo o STF (RE 1.193.343 AgR, 2ª Turma, Rel. Min. Celso de Mello, j. 29/11/2019), escritos anônimos não autorizam, isoladamente considerados, a imediata instauração de persecução penal ou de procedimento disciplinar. Nada impede, contudo, que o Poder Público, provocado por delação anônima, adote medidas informais para apurar previamente, em averiguação sumária, com prudência e discrição, a verossimilhança dos fatos, instaurando então a persecução formal desvinculada das peças apócrifas. Por isso, no RELINT, denúncias são tratadas como informes a serem corroborados.`],
        ['Técnicas estruturadas de análise (TAE)', 'analise', `A DAI (ABIN 2023) apresenta técnicas de apoio à análise complementares à metodologia: técnicas analíticas estruturadas (TAE) como brainstorming, matriz de impactos cruzados, cronologia e linha do tempo e análise de redes; a DNISP prevê as técnicas acessórias de análise de vínculos, análise criminal e análise de riscos. Na literatura (Heuer & Pherson, Structured Analytic Techniques for Intelligence Analysis) destacam-se: Análise de Hipóteses Concorrentes (ACH), checagem de premissas-chave (Key Assumptions Check), indicadores e alertas, análise do "advogado do diabo", Red Hat Analysis e análise morfológica. O objetivo é reduzir vieses cognitivos, sobretudo o viés de confirmação.`],
        ['Análise de Hipóteses Concorrentes (ACH)', 'analise', `Desenvolvida por Richards Heuer na CIA (Psychology of Intelligence Analysis, 1999). Passos: (1) listar hipóteses mutuamente exclusivas; (2) listar evidências e argumentos relevantes; (3) montar matriz evidências × hipóteses, marcando consistência ou inconsistência; (4) refinar a matriz; (5) buscar REFUTAR hipóteses — a mais provável é a que tem MENOS evidências inconsistentes, não a que tem mais evidências a favor; (6) analisar a sensibilidade às evidências-chave; (7) relatar conclusões com a probabilidade relativa de todas as hipóteses; (8) identificar indicadores para acompanhamento. Estudos (Dhami, Belton e Mandel, 2019) mostram que o método só ajuda se os passos forem seguidos com disciplina. O XERIFE aplica a ACH a cada alvo, confrontando: integração a estrutura organizada, atuação autônoma reiterada e envolvimento eventual.`],
        ['Linguagem de probabilidade (palavras de estimativa)', 'analise', `Sherman Kent (CIA, 1964) mostrou que expressões vagas como "séria possibilidade" eram lidas de 20% a 80% por analistas diferentes, e propôs um léxico fixo. Escala adotada pelo XERIFE (adaptada da ICD 203 e de Kent): quase certa (95–99%), muito provável (80–95%), provável (55–80%), tão provável quanto improvável (45–55%), improvável (20–45%), muito improvável (5–20%), quase impossível (1–5%). Regra: usar sempre o mesmo termo para a mesma faixa e não misturar com adjetivos.`],
        ['Redação oficial — Manual da Presidência da República (3ª ed., 2018)', 'redacao', `Atributos da redação oficial: clareza e precisão, objetividade, concisão, coesão e coerência, impessoalidade, formalidade e padronização, e uso da norma-padrão da língua portuguesa. Texto claro permite compreensão imediata e transmite o máximo de informação com o mínimo de palavras. Recomendações: frases curtas e em ordem direta; palavras no sentido comum; siglas por extenso na primeira ocorrência; eliminar detalhes irrelevantes, prolixidade e adjetivação; tratar o assunto de forma impessoal, em nome do serviço público. Aplicado ao RELINT: 3ª pessoa, verbos no futuro do pretérito para informes, nomes e vulgos em maiúsculas, um assunto por parágrafo.`],
        ['Classificação de sigilo — Lei de Acesso à Informação', 'juridico', `A Lei nº 12.527/2011 (LAI) prevê os graus de sigilo ULTRASSECRETO (até 25 anos), SECRETO (até 15 anos) e RESERVADO (até 5 anos), atribuídos pela autoridade competente conforme a sensibilidade. Documentos de inteligência de segurança pública são, em regra, classificados e difundidos apenas a quem tem necessidade de conhecer (princípio da compartimentação). Sugestão padrão do XERIFE para RELINT de alvos: RESERVADO, ressalvada a decisão da autoridade classificadora.`],
        ['Organização criminosa e associação criminosa — Lei 12.850/2013 e art. 288 do CP', 'juridico', `Organização criminosa (art. 1º, § 1º, da Lei nº 12.850/2013): associação de 4 ou mais pessoas, estruturalmente ordenada e caracterizada pela divisão de tarefas, ainda que informalmente, com o objetivo de obter vantagem de qualquer natureza mediante a prática de infrações penais com penas máximas superiores a 4 anos ou de caráter transnacional. Promover, constituir, financiar ou integrar ORCRIM: art. 2º, reclusão de 3 a 8 anos, com aumento se houver emprego de arma de fogo. Associação criminosa (art. 288 do CP): 3 ou mais pessoas associadas para cometer crimes. Associação para o tráfico: art. 35 da Lei nº 11.343/2006 (2 ou mais pessoas). No RELINT, a imputação é sempre "em tese".`],
        ['Enquadramento legal das naturezas mais comuns', 'juridico', `Homicídio: art. 121 do CP; feminicídio: art. 121-A do CP (Lei nº 14.994/2024); latrocínio: art. 157, § 3º, II; roubo: art. 157; extorsão: art. 158; furto: art. 155; receptação: art. 180; estelionato: art. 171; dano: art. 163; lesão corporal: art. 129; ameaça: art. 147; perseguição: art. 147-A; estupro: art. 213; tráfico de drogas: art. 33 da Lei nº 11.343/2006; associação para o tráfico: art. 35; porte para consumo: art. 28; porte ilegal de arma de uso permitido: art. 14 da Lei nº 10.826/2003; posse irregular: art. 12; uso restrito: art. 16; disparo: art. 15; violência doméstica: Lei nº 11.340/2006 (descumprimento de medida protetiva: art. 24-A); perturbação do sossego: art. 42 da LCP; porte de arma branca: art. 19 da LCP; embriaguez ao volante: art. 306 do CTB; direção sem habilitação: art. 309; entregar veículo a inabilitado: art. 310; adulteração de sinal identificador: art. 311 do CP; desacato, resistência e desobediência: arts. 331, 329 e 330 do CP.`],
        ['Política e Sistema de Inteligência de Segurança Pública', 'juridico', `O Decreto nº 10.777/2021 institui a Política Nacional de Inteligência de Segurança Pública (PNISP) e lista a DNISP entre os instrumentos basilares de sua execução. A Lei nº 9.883/1999 institui o Sistema Brasileiro de Inteligência (SISBIN) e cria a ABIN; o Decreto nº 11.693/2023 prevê a integração de órgãos federados ao SISBIN. A atividade de ISP obedece aos princípios constitucionais da legalidade, impessoalidade, moralidade, publicidade e eficiência e respeita os direitos e garantias individuais.`],
        ['Análise de risco e indicadores de alerta', 'analise', `Risco = probabilidade × impacto. Na avaliação de alvos, a probabilidade de continuidade delitiva cresce com reiteração, atividade recente, vínculos criminais e escalada de gravidade; o impacto cresce com violência letal, armas de fogo e inserção em facção. Indicadores de alerta são sinais observáveis que antecipam mudança de cenário (ex.: aumento de denúncias no entorno, disparos de arma de fogo, prisão ou morte de vinculados, mudança de endereço de alvo com mandado). O relatório deve listar indicadores para acompanhamento e revisão da avaliação.`],
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
        M.integral = {};
        DOCS.concat(extras || []).forEach(([titulo, fonte, texto]) => { M.integral[titulo] = texto; trechos(texto).forEach(t => M.chunks.push({ titulo, fonte, texto: t })); });
        const corpo = c => c.titulo + ' ' + c.titulo + ' ' + c.texto; // título com peso dobrado
        M.exato = new BM25(M.chunks.map(corpo), tokens);
        M.rad = new BM25(M.chunks.map(corpo), s => tokens(s).map(radical));
        M.versao++;
    }
    // Expansão de consulta (sinônimos/abreviações do domínio)
    const SINONIMOS = { artigo: 'art', artigos: 'art arts', pena: 'reclusao detencao pena', orcrim: 'organizacao criminosa', faccao: 'organizacao criminosa faccao', sigilo: 'reservado secreto ultrassecreto', relatorio: 'relint', denuncia: 'denuncia informe', provavel: 'probabilidade estimativa', hipoteses: 'ach hipoteses' };
    const expandir = q => q + ' ' + tokens(q).map(t => SINONIMOS[t] || '').join(' ');
    function buscar(q, k = 4) {
        q = expandir(q);
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
        { id: 'relint', descricao: 'Abre o Relatório de Inteligência do alvo com ficha e CAD preparados', rx: /(relint|relatorio de inteligencia)/,
            executar: (q, txt) => {
                const p = resolverAlvo(txt); if (!p) return null;
                if (global.MapaAlvos && global.MapaAlvos.abrirRelint) { global.MapaAlvos.abrirRelint(p.id); return `📝 Abri o RELINT de <b>${esc(p.nome)}</b> em outra janela — a ficha e a busca no CAD estão sendo preparadas; depois é só clicar em <b>Gerar texto</b>.`; }
                return `📝 <a href="${/\/page\//.test(location.pathname) ? '' : 'page/'}relint.html?alvo=${encodeURIComponent(p.id)}" target="_blank">Abrir o RELINT de ${esc(p.nome)}</a>.`;
            } },
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
        // Sem IA carregada: resumo EXTRATIVO focado na pergunta — pontua cada frase dos melhores
        // trechos pelos termos da pergunta (radicais) e devolve as mais relevantes, na ordem original.
        const qr = new Set(tokens(expandir(textoOriginal)).map(radical));
        const frases = [];
        // divide em frases protegendo abreviações (Rel., Min., art., nº…); listas longas com ";" viram itens
        const ABREV = /\b(Rel|Min|art|arts|n|nº|Dr|Sr|Sra|ed|p|inc|al|ex|cf|v)\.\s/gi;
        const unidades = txt => txt.replace(/\s+/g, ' ').replace(ABREV, m => m.replace('. ', '.~@~')).split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ(“"])/)
            .flatMap(f => f.split(/\s+/).length > 45 && f.includes(';') ? f.split(/;\s*/).map(x => x.trim()).filter(Boolean) : [f]);
        // frases do texto INTEGRAL de cada documento recuperado (os trechos cortam no meio da frase)
        const docsCtx = [...new Set(ctx.map(c => c.titulo))].map(titulo => ({ titulo, texto: M.integral[titulo] || ctx.find(c => c.titulo === titulo).texto }));
        // peso de cada termo da pergunta pela raridade nas frases candidatas (IDF): "roubo" pesa mais que "art"
        const cand = [];
        docsCtx.forEach((c, ci) => unidades(c.texto).forEach((f, fi) => {
            const t = tokens(f.replace(/~@~/g, ' ')).map(radical); if (t.length < 2 || /^Fonte:/.test(f)) return;
            cand.push({ f, ci, fi, t, titulo: c.titulo });
        }));
        const df = {}; cand.forEach(x => new Set(x.t).forEach(w => { if (qr.has(w)) df[w] = (df[w] || 0) + 1; }));
        const idf = w => Math.log(1 + cand.length / (df[w] || 1));
        cand.forEach(x => {
            const ganho = [...new Set(x.t)].filter(w => qr.has(w)).reduce((s, w) => s + idf(w), 0);
            if (!ganho) return;
            frases.push(Object.assign(x, { s: ganho / Math.sqrt(x.t.length + 3) + (x.ci === 0 ? 0.2 : 0) + (x.ci === 0 && x.fi === 0 ? 0.3 : 0) }));
        });
        const melhor = Math.max(0, ...frases.map(x => x.s));
        const escolhidas = frases.filter(x => x.s >= melhor * 0.45).sort((a, b) => b.s - a.s).slice(0, 4).sort((a, b) => a.ci - b.ci || a.fi - b.fi);
        if (!escolhidas.length) return null;
        const fontes = [...new Set(escolhidas.map(x => x.titulo))];
        const texto = escolhidas.map(x => { const t = x.f.replace(/~@~/g, ' ').trim(); return /[.!?]$/.test(t) ? t : t + '.'; });
        return `📚 ${texto.map(t => esc(t.charAt(0).toUpperCase() + t.slice(1))).join(' ')}<br><small>Fonte${fontes.length > 1 ? 's' : ''}: ${fontes.map(esc).join(' · ')}</small>`;
    }
    // Pergunta conceitual explícita ("o que é…", "como funciona…", "explique…")
    const ehPerguntaConceitual = q => /^(o que (e|sao|significa|diz)|oque e|como (funciona|faco|usar|uso|gerar|gero|fazer|redigir|escrever|avaliar|classificar)|explique|explica|defina|definicao|qual a diferenca|para que serve|o que faz|qual (o |a )?(artigo|pena|lei|grau|tipificacao|conceito|definicao)|quais (sao )?(os |as )?(estados|tipos|fases|tecnicas|graus|atributos|etapas|documentos|principios|classificacoes))\b|\b(dnisp|doutrina|ach|hipoteses concorrentes|estados? da mente|grau de sigilo|redacao oficial)\b/.test(N(q).trim());

    global.XerifeConhecimento = { buscar, responder, executarSkill, resolverAlvo, analisarPessoa, ehPerguntaConceitual, indexar: indexarComAlvos, SKILLS, DOCS };
})(window);
