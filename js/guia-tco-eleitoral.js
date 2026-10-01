'use strict';

// ════════════════════════════════════════════════════════════════
// BASE DE DADOS — Crimes eleitorais de menor potencial ofensivo,
// condutas que NÃO admitem TCO e procedimentos/normativos relevantes.
// Transcrito do "Manual TCO Eleitoral da PMAL 2026" (2ª Seção/EMG, em
// parceria com o TRE-AL) — fonte: legislação eleitoral e Decreto nº
// 88.653/2023. Três entradas (Corrupção Eleitoral/compra de voto, e os
// 2 itens de "normativos" sobre força armada na seção e transporte de
// armas por CAC) foram incluídas além do conteúdo literal do manual
// pedido pelo usuário, porque são situações de busca muito comuns no
// dia a dia operacional ("compra de voto", "transportar", "entrar na
// seção") e o próprio manual já trata das dessas últimas duas no
// capítulo "Normativos Importantes" — mantidas com a MESMA fonte legal
// citada ali.
// ════════════════════════════════════════════════════════════════
const OQUE_FAZER_PADRAO_TCO = 'Analisar a viabilidade da lavratura do TCO e o interesse do autuado em assinar o Termo de Compromisso de Comparecimento ao Juízo Eleitoral. Registrar o atendimento PM com a natureza do crime eleitoral, preencher os termos com as assinaturas, informar o comandante imediato e encaminhar o arquivo digital ao supervisor de operações para peticionamento no PJe do TRE-AL. Se o autuado se recusar a assinar, encaminhar as partes à Delegacia de Polícia Federal/Civil.';
const OQUE_FAZER_PADRAO_NAO_TCO = 'NÃO se lavra TCO Eleitoral — a pena máxima ultrapassa 2 anos (ou a matéria não tem natureza penal de menor potencial ofensivo). Encaminhar as partes à Delegacia de Polícia Federal/Civil e comunicar o fato à Zona Eleitoral competente.';

const CRIMES = [
    {
        titulo: 'Desordem Eleitoral', base: 'Art. 296 — Código Eleitoral',
        dispositivo: 'Promover desordem que prejudique os trabalhos eleitorais.',
        pena: 'Detenção até 2 meses + pagamento de 60 a 90 dias-multa.',
        nota: 'A ação deve visar prejudicar a votação ou a apuração, bastando que cause atrasos nos procedimentos eleitorais.',
        fase: 'dia', cabeTco: true, categoria: 'crime',
        tags: ['tumulto', 'confusão', 'atrapalhar votação', 'atraso na votação', 'baderna'],
    },
    {
        titulo: 'Impedimento ou Embaraço ao Exercício do Voto', base: 'Art. 297 — Código Eleitoral',
        dispositivo: 'Impedir ou embaraçar o exercício do sufrágio.',
        pena: 'Detenção até 6 meses + pagamento de 60 a 100 dias-multa.',
        nota: 'O crime acontece durante o horário da votação, de qualquer maneira que cause impedimento ou constrangimento ao voto.',
        fase: 'dia', cabeTco: true, categoria: 'crime',
        tags: ['impedir votar', 'atrapalhar eleitor', 'constranger eleitor', 'não deixar votar', 'barrar eleitor'],
    },
    {
        titulo: 'Coação para Votar', base: 'Art. 300 — Código Eleitoral',
        dispositivo: 'Valer-se o servidor público da sua autoridade para coagir alguém a votar ou não votar em determinado candidato ou partido.',
        pena: 'Detenção até 6 meses + pagamento de 60 a 100 dias-multa.',
        nota: 'Crime cometido pelo servidor público.',
        fase: 'sempre', cabeTco: true, categoria: 'crime',
        tags: ['coagir', 'ameaçar eleitor', 'servidor público', 'obrigar votar', 'pressionar voto'],
    },
    {
        titulo: 'Intervenção de Autoridade Estranha', base: 'Art. 305 — Código Eleitoral',
        dispositivo: 'Intervir autoridade estranha à mesa receptora, salvo o juiz eleitoral, no seu funcionamento sob qualquer pretexto.',
        pena: 'Detenção até 6 meses + pagamento de 60 a 90 dias-multa.',
        nota: 'Quando qualquer autoridade, salvo o juiz eleitoral, intervir na mesa receptora.',
        fase: 'dia', cabeTco: true, categoria: 'crime',
        tags: ['intervir na mesa', 'autoridade na mesa receptora', 'atrapalhar mesário'],
    },
    {
        titulo: 'Ordem de Votação (Fila)', base: 'Art. 306 — Código Eleitoral',
        dispositivo: 'Não observar a ordem em que os eleitores devem ser chamados a votar.',
        pena: 'Pagamento de 15 a 30 dias-multa.',
        nota: 'Desrespeito à fila de votação configura esse crime.',
        fase: 'dia', cabeTco: true, categoria: 'crime',
        tags: ['fila de votação', 'furar fila', 'ordem da fila', 'desrespeitar fila'],
    },
    {
        titulo: 'Divulgação de Fatos Inverídicos', base: 'Art. 323 — Código Eleitoral (redação Lei nº 14.192/2021)',
        dispositivo: 'Divulgar, na propaganda eleitoral ou durante a campanha, fatos que sabe inverídicos em relação a partidos ou candidatos e capazes de exercer influência perante o eleitorado.',
        pena: 'Detenção de 2 meses a 1 ano OU pagamento de 120 a 150 dias-multa.',
        nota: 'Responde igualmente quem produz, oferece ou vende vídeo com conteúdo inverídico (§1º). Atenção às causas de aumento do art. 327 (internet/rede social; menosprezo à condição de mulher, cor, raça ou etnia).',
        fase: 'antes', cabeTco: true, categoria: 'crime',
        tags: ['fake news', 'notícia falsa', 'mentira sobre candidato', 'boato', 'desinformação', 'calote eleitoral'],
    },
    {
        titulo: 'Calúnia na Propaganda Eleitoral', base: 'Art. 324 — Código Eleitoral',
        dispositivo: 'Caluniar alguém, na propaganda eleitoral ou visando fins de propaganda, imputando-lhe falsamente fato definido como crime.',
        pena: 'Detenção de 6 meses a 2 anos + pagamento de 10 a 40 dias-multa.',
        nota: '§1º Nas mesmas penas incorre quem, sabendo falsa a imputação, a propala ou divulga.',
        fase: 'antes', cabeTco: true, categoria: 'crime',
        tags: ['caluniar candidato', 'acusar falsamente', 'imputar crime falso'],
    },
    {
        titulo: 'Difamação na Propaganda Eleitoral', base: 'Art. 325 — Código Eleitoral',
        dispositivo: 'Difamar alguém, na propaganda eleitoral ou visando fins de propaganda, imputando-lhe fato ofensivo à sua reputação.',
        pena: 'Detenção de 3 meses a 1 ano + pagamento de 5 a 30 dias-multa.',
        nota: 'Quando as críticas ofendem a honra pessoal de alguém no âmbito da propaganda eleitoral.',
        fase: 'antes', cabeTco: true, categoria: 'crime',
        tags: ['difamar candidato', 'ofender reputação', 'falar mal de candidato'],
    },
    {
        titulo: 'Injúria na Propaganda Eleitoral', base: 'Art. 326 — Código Eleitoral',
        dispositivo: 'Injuriar alguém, na propaganda eleitoral ou visando fins de propaganda, ofendendo-lhe a dignidade ou o decoro.',
        pena: 'Detenção até 6 meses OU pagamento de 30 a 60 dias-multa.',
        nota: 'Sujeita-se às causas de aumento do art. 327.',
        fase: 'antes', cabeTco: true, categoria: 'crime',
        tags: ['xingar candidato', 'ofender dignidade', 'insultar candidato'],
    },
    {
        titulo: 'Causas de Aumento de Pena (Calúnia, Difamação e Injúria)', base: 'Art. 327 — Código Eleitoral',
        dispositivo: 'As penas dos arts. 324, 325 e 326 aumentam-se de 1/3 até metade se o crime é cometido: I — contra o Presidente da República ou chefe de governo estrangeiro; II — contra funcionário público, em razão das funções; III — na presença de várias pessoas ou por meio que facilite a divulgação; IV — com menosprezo à condição de mulher, cor, raça ou etnia (Lei nº 14.192/2021); V — por meio da internet, rede social ou transmissão em tempo real (Lei nº 14.192/2021).',
        pena: 'Majorante de 1/3 até metade sobre os arts. 324, 325 e 326 — não é um tipo autônomo.',
        nota: 'Aplica-se sempre JUNTO com calúnia, difamação ou injúria eleitorais, nunca isoladamente.',
        fase: 'antes', cabeTco: true, categoria: 'crime',
        tags: ['aumento de pena', 'internet', 'rede social', 'contra mulher', 'racismo eleitoral', 'funcionário público'],
    },
    {
        titulo: 'Perturbação / Inutilização de Propaganda', base: 'Art. 331 — Código Eleitoral',
        dispositivo: 'Inutilizar, alterar ou perturbar meio de propaganda devidamente empregado.',
        pena: 'Detenção até 6 meses OU pagamento de 90 a 120 dias-multa.',
        fase: 'antes', cabeTco: true, categoria: 'crime',
        tags: ['rasgar cartaz', 'quebrar santinho', 'destruir propaganda', 'pichar outdoor', 'danificar propaganda'],
    },
    {
        titulo: 'Impedir o Exercício de Propaganda', base: 'Art. 332 — Código Eleitoral',
        dispositivo: 'Impedir o exercício de propaganda.',
        pena: 'Detenção até 6 meses + pagamento de 30 a 60 dias-multa.',
        fase: 'antes', cabeTco: true, categoria: 'crime',
        tags: ['impedir campanha', 'proibir propaganda', 'tirar cartaz à força'],
    },
    {
        titulo: 'Desobediência Eleitoral', base: 'Art. 347 — Código Eleitoral',
        dispositivo: 'Recusar cumprimento ou obediência a diligências, ordens ou instruções da Justiça Eleitoral, ou opor embaraços à sua execução.',
        pena: 'Detenção de 3 meses a 1 ano + pagamento de 10 a 20 dias-multa.',
        nota: 'Recusa, expressa ou implícita, de cumprir determinações específicas e individualizadas da Justiça Eleitoral. A desobediência à ordem de proibição de venda de bebidas alcoólicas se enquadra neste artigo.',
        fase: 'sempre', cabeTco: true, categoria: 'crime',
        tags: ['lei seca', 'venda de bebida alcoólica', 'desobedecer ordem', 'descumprir determinação judicial'],
    },
    {
        titulo: 'Retenção de Título Eleitoral', base: 'Art. 91, parágrafo único — Lei das Eleições nº 9.504/97',
        dispositivo: 'A retenção de título eleitoral ou do comprovante de alistamento eleitoral.',
        pena: 'Detenção de 1 a 3 meses (alternativa: prestação de serviços à comunidade por igual período) + multa de 5.000 a 10.000 UFIR.',
        nota: 'Consiste em reter o título ou o comprovante do alistamento.',
        fase: 'sempre', cabeTco: true, categoria: 'crime',
        tags: ['reter título de eleitor', 'segurar documento', 'não devolver título'],
    },
    {
        titulo: 'Crime na Propaganda no Dia da Eleição (boca de urna, carreata, santinho)', base: 'Art. 39, § 5º — Lei das Eleições nº 9.504/97',
        dispositivo: 'Constituem crimes no dia da eleição: I — uso de alto-falantes/amplificadores ou promoção de comício ou carreata; II — arregimentação de eleitor ou propaganda de boca de urna; III — divulgação de qualquer propaganda de partidos ou candidatos; IV — publicação/impulsionamento de novos conteúdos nas aplicações de internet (art. 57-B).',
        pena: 'Detenção de 6 meses a 1 ano (alternativa: prestação de serviços à comunidade) + multa de 5.000 a 15.000 UFIR.',
        nota: "A boca de urna (inciso II) pode ser cometida em qualquer lugar, desde que influencie o eleitor. O derramamento de santinhos está no inciso III. Fiscais só podem usar crachás do partido, sem padronizar vestuário. É permitido ao eleitor manifestar preferência individual e silenciosa por meio de bandeiras, broches, adesivos e dísticos.",
        fase: 'dia', cabeTco: true, categoria: 'crime',
        tags: ['boca de urna', 'santinho', 'carreata', 'carro de som', 'alto-falante', 'arregimentar eleitor', 'campanha no dia da votação', 'propaganda no dia', 'comício'],
    },
    {
        titulo: 'Irregularidade na Mesa / Voto Indevido', base: 'Arts. 310 e 311 — Código Eleitoral',
        dispositivo: 'Art. 310. Praticar ou permitir o membro da mesa receptora irregularidade que determine a anulação de votação (salvo art. 311). Art. 311. Votar em seção onde não está inscrito, salvo casos previstos, e permitir o presidente da mesa que o voto seja admitido.',
        pena: 'Art. 310: detenção até 6 meses ou 90 a 120 dias-multa. Art. 311: detenção até 1 mês ou 5 a 15 dias-multa (eleitor) e 20 a 30 dias-multa (presidente da mesa).',
        fase: 'dia', cabeTco: true, categoria: 'crime',
        tags: ['votar em seção errada', 'voto indevido', 'irregularidade na mesa', 'anular votação'],
    },
    {
        titulo: 'Violação do Sigilo de Voto', base: 'Art. 312 — Código Eleitoral',
        dispositivo: 'Violar ou tentar violar o sigilo do voto.',
        pena: 'Detenção até 2 anos.',
        nota: "Ocorre com a divulgação do voto, geralmente por 'selfies' nas urnas. O crime se configura ao tentar tirar a foto, não sendo necessária a divulgação da imagem.",
        fase: 'dia', cabeTco: true, categoria: 'crime',
        tags: ['selfie na urna', 'foto do voto', 'mostrar o voto', 'fotografar cédula', 'sigilo do voto', 'filmar o voto'],
    },
    {
        titulo: 'Recusar ou Abandonar o Serviço Eleitoral', base: 'Art. 344 — Código Eleitoral',
        dispositivo: 'Recusar ou abandonar o serviço eleitoral sem justa causa.',
        pena: 'Detenção até 2 meses ou pagamento de 90 a 120 dias-multa.',
        nota: 'Cometido pelo mesário ou eleitor convocado que se recusa ou abandona o posto. Só ocorre no dia da eleição, após o início dos trabalhos. A ausência do mesário, por si só, não configura o crime.',
        fase: 'dia', cabeTco: true, categoria: 'crime',
        tags: ['mesário abandonar', 'recusar ser mesário', 'largar a mesa', 'abandonar posto'],
    },
    {
        titulo: 'Induzir ou Dar Causa a Inscrição Eleitoral Fraudulenta', base: 'Art. 290 — Código Eleitoral',
        dispositivo: 'Fazer afirmação falsa ou valer-se de qualquer outro meio fraudulento para induzir ou manter outrem em erro, com o fim de obter ou proporcionar a terceiro inscrição eleitoral.',
        pena: 'Reclusão até 2 anos + pagamento de 15 a 30 dias-multa.',
        nota: 'Está exatamente no limite do art. 61 da Lei 9.099/95 (pena não superior a 2 anos) — admite TCO.',
        fase: 'sempre', cabeTco: true, categoria: 'crime',
        tags: ['inscrição eleitoral falsa', 'fraude no título de eleitor', 'alistamento fraudulento de outrem'],
    },
    {
        titulo: 'Perturbar ou Impedir o Alistamento Eleitoral', base: 'Art. 293 — Código Eleitoral',
        dispositivo: 'Perturbar, de qualquer forma, o funcionamento de serviço eleitoral, bem como impedir ou embaraçar o alistamento do eleitor.',
        pena: 'Detenção de 15 dias a 6 meses ou pagamento de 30 a 60 dias-multa.',
        fase: 'antes', cabeTco: true, categoria: 'crime',
        tags: ['atrapalhar alistamento', 'impedir título de eleitor', 'perturbar cartório eleitoral'],
    },
    {
        titulo: 'Reter Título Eleitoral Contra a Vontade do Eleitor', base: 'Art. 295 — Código Eleitoral',
        dispositivo: 'Reter título eleitoral de outrem, ou qualquer dos documentos necessários ao alistamento ou à votação, contra a vontade do eleitor.',
        pena: 'Detenção até 2 meses ou pagamento de 30 a 60 dias-multa.',
        nota: 'Figura semelhante à "Retenção de Título" da Lei 9.504/97 (art. 91) — podem ser enquadradas conforme o contexto; ambas admitem TCO.',
        fase: 'sempre', cabeTco: true, categoria: 'crime',
        tags: ['segurar título contra vontade', 'não devolver documento eleitor', 'reter documento de votação'],
    },
    {
        titulo: 'Majorar Preços de Utilidades do Serviço Eleitoral', base: 'Art. 303 — Código Eleitoral',
        dispositivo: 'Majorar os preços usuais das utilidades empregadas correntemente, ou de que habitualmente faça comércio, com o fim de causar embaraço ao exercício do voto ou aos trabalhos eleitorais.',
        pena: 'Pagamento de 250 a 300 dias-multa.',
        fase: 'dia', cabeTco: true, categoria: 'crime',
        tags: ['encarecer transporte eleitor', 'abusar preço eleição', 'especulação dia da eleição'],
    },
    {
        titulo: 'Ocultar ou Recusar Fornecer Utilidades do Serviço Eleitoral', base: 'Art. 304 — Código Eleitoral',
        dispositivo: 'Ocultar ou negar, dolosamente, gêneros alimentícios, combustíveis ou qualquer outro recurso essencial, com o fim de embaraçar o exercício do voto ou os trabalhos eleitorais.',
        pena: 'Pagamento de 250 a 300 dias-multa.',
        fase: 'dia', cabeTco: true, categoria: 'crime',
        tags: ['recusar vender combustível eleição', 'esconder mercadoria dia da votação'],
    },
    {
        titulo: 'Organização Comercial de Propaganda ou Aliciamento de Eleitores', base: 'Art. 334 — Código Eleitoral',
        dispositivo: 'Organizar grupo ou serviço destinado a fazer propaganda ou a aliciar eleitores mediante pagamento, para fins eleitorais.',
        pena: 'Detenção de 6 meses a 1 ano; se o responsável for candidato, cassação do registro ou do diploma.',
        fase: 'antes', cabeTco: true, categoria: 'crime',
        tags: ['aliciar eleitor pago', 'currais eleitorais organizados', 'cabo eleitoral remunerado'],
    },
    {
        titulo: 'Propaganda Eleitoral em Língua Estrangeira', base: 'Art. 335 — Código Eleitoral',
        dispositivo: 'Fazer propaganda, qualquer que seja a forma ou o meio de divulgação, em língua estrangeira.',
        pena: 'Detenção de 3 a 6 meses + pagamento de 30 a 60 dias-multa, com apreensão do material.',
        fase: 'antes', cabeTco: true, categoria: 'crime',
        tags: ['propaganda em outro idioma', 'material de campanha em língua estrangeira'],
    },
    {
        titulo: 'Participação de Estrangeiro ou Pessoa sem Direitos Políticos em Atividade Partidária', base: 'Art. 337 — Código Eleitoral',
        dispositivo: 'Exercer ou participar de atividade partidária ou eleitoral, inclusive propaganda, quem não possua direitos políticos, ou sendo estrangeiro.',
        pena: 'Detenção até 6 meses + pagamento de 90 a 120 dias-multa.',
        fase: 'sempre', cabeTco: true, categoria: 'crime',
        tags: ['estrangeiro fazendo campanha', 'pessoa sem direitos políticos em campanha'],
    },
    {
        titulo: 'Descumprimento do Dever de Transporte Gratuito de Eleitores', base: 'Art. 11, I — Lei nº 6.091/74',
        dispositivo: 'Os responsáveis por empresas, repartições ou órgãos públicos ou privados que deixarem de atender, no prazo, à requisição de veículos para o transporte gratuito de eleitores, ou prestarem informações inexatas sobre a sua disponibilidade.',
        pena: 'Detenção de 15 dias a 6 meses + pagamento de 60 a 100 dias-multa.',
        fase: 'dia', cabeTco: true, categoria: 'crime',
        tags: ['negar veículo para eleitor', 'não ceder transporte gratuito eleição'],
    },
    {
        titulo: 'Dano ou Extravio de Veículo Requisitado para Transporte de Eleitores', base: 'Art. 11, parágrafo único — Lei nº 6.091/74',
        dispositivo: 'O responsável pela guarda do veículo ou embarcação requisitado para o transporte gratuito de eleitores que o danificar, extraviar ou deixar de entregá-lo nas condições e prazo determinados.',
        pena: 'Detenção de 15 dias a 6 meses + pagamento de 60 a 100 dias-multa.',
        fase: 'dia', cabeTco: true, categoria: 'crime',
        tags: ['danificar veículo requisitado', 'não devolver veículo eleição'],
    },

    // ── NÃO ADMITEM TCO ─────────────────────────────────────────
    {
        titulo: 'Corrupção Eleitoral (Compra de Voto)', base: 'Art. 299 — Código Eleitoral',
        dispositivo: 'Dar, oferecer, prometer, solicitar ou receber, para si ou para outrem, dinheiro, dádiva, ou qualquer outra vantagem, para obter ou dar voto e para conseguir ou prometer abstenção, ainda que a oferta não seja aceita.',
        pena: 'Reclusão até 4 anos e multa.',
        nota: 'Pena máxima ultrapassa 2 anos — NÃO é crime de menor potencial ofensivo. A simples oferta já é punida, mesmo que não aceita. Um dos crimes eleitorais mais graves e mais recorrentes em período de campanha.',
        fase: 'sempre', cabeTco: false, categoria: 'crime',
        oqueFazer: 'NÃO lavrar TCO. Priorizar o flagrante quando possível, apreender dinheiro/bens oferecidos e eventuais listas, identificar testemunhas, encaminhar à Delegacia de Polícia Federal/Civil e comunicar imediatamente à Zona Eleitoral.',
        tags: ['compra de voto', 'comprar voto', 'dar dinheiro por voto', 'oferecer dinheiro eleitor', 'curral eleitoral', 'cabo eleitoral pagando', 'vender voto'],
    },
    {
        titulo: 'Violência Política contra a Mulher', base: 'Art. 326-B — Código Eleitoral (Lei nº 14.192/2021)',
        dispositivo: 'Assediar, constranger, humilhar, perseguir ou ameaçar, por qualquer meio, candidata a cargo eletivo ou detentora de mandato eletivo, utilizando-se de menosprezo ou discriminação à condição de mulher ou à sua cor, raça ou etnia, para impedir ou dificultar sua campanha ou o desempenho do mandato.',
        pena: 'Reclusão de 1 a 4 anos, e multa. Aumenta-se de 1/3 se cometido contra gestante, maior de 60 anos ou pessoa com deficiência.',
        nota: 'NÃO é crime de menor potencial ofensivo (pena máxima de 4 anos): não cabe TCO. As Resoluções do TSE para 2026 reforçaram o enfrentamento a esta conduta; as declarações da vítima têm especial importância.',
        fase: 'sempre', cabeTco: false, categoria: 'crime',
        oqueFazer: 'NÃO lavrar TCO. Encaminhar à Delegacia de Polícia Federal/Civil. Colher com cuidado o relato da vítima, preservar provas (mensagens, prints, testemunhas) e comunicar à Zona Eleitoral.',
        tags: ['assédio contra candidata', 'ameaça contra mulher candidata', 'violência de gênero eleitoral', 'perseguição política', 'constranger candidata'],
    },
    {
        titulo: 'Conteúdo Sintético / Inteligência Artificial (Deepfake)', base: 'Res. TSE nº 23.755/2026 (Propaganda Eleitoral) e nº 23.757/2026 (Ilícitos Eleitorais, que altera a Res. nº 23.735/2024)',
        dispositivo: 'É vedada a divulgação, publicação, republicação ou impulsionamento pago de conteúdo multimídia sintético (fabricado ou manipulado por IA ou tecnologia equivalente) com voz, imagem ou manifestação de candidato ou pessoa pública, nas 72h anteriores a cada turno de votação (1º a 3/10 para o 1º turno) e nas 24h posteriores ao encerramento da votação. Fora dessa janela, o conteúdo de IA é permitido, mas deve ter identificação explícita, destacada e acessível de que foi fabricado/manipulado e com qual tecnologia (em material impresso, em cada página). É vedado também: IA recomendar, ranquear ou priorizar candidatos; deepfake com conteúdo sexual, de nudez ou violência contra a mulher; conteúdo com informação falsa sobre as urnas, incitação a crime, subversão da ordem constitucional ou violência política.',
        pena: 'Natureza predominantemente eleitoral-administrativa: remoção imediata do conteúdo, indisponibilização do serviço de comunicação e inversão do ônus da prova (quem publicou deve provar a legalidade). Não é pena privativa de liberdade.',
        nota: 'Não gera, por si só, TCO. Se o conteúdo configurar também um dos crimes de propaganda de MPO (arts. 323 a 326 do CE), aplica-se o procedimento do respectivo tipo penal. Na dúvida, acionar o COPOM e a Zona Eleitoral.',
        fase: 'antes', cabeTco: false, categoria: 'crime',
        oqueFazer: 'Em regra NÃO se lavra TCO. Verificar se o conteúdo também configura calúnia/difamação/injúria/fatos inverídicos (arts. 323 a 326) — nesse caso, segue o procedimento daquele crime. Na dúvida, acionar o COPOM e a Zona Eleitoral.',
        tags: ['deepfake', 'vídeo falso', 'inteligência artificial', 'ia', 'voz clonada', 'imagem manipulada', 'conteúdo sintético', 'ia nas eleições'],
    },
    {
        titulo: 'Inscrição Eleitoral Fraudulenta (Falsidade)', base: 'Art. 289 — Código Eleitoral',
        dispositivo: 'Inscrever-se fraudulentamente eleitor, valendo-se de falsidade documental (arts. 348 a 352), ou dar causa a essa inscrição em proveito próprio ou de terceiro.',
        pena: 'Reclusão até 5 anos + pagamento de 5 a 15 dias-multa.',
        nota: 'NÃO é crime de menor potencial ofensivo (pena máxima de 5 anos).',
        fase: 'sempre', cabeTco: false, categoria: 'crime',
        tags: ['título de eleitor falso', 'se inscrever fraudulentamente', 'documento eleitoral falso'],
    },
    {
        titulo: 'Prisão ou Detenção Ilegal de Eleitor, Mesário, Fiscal ou Candidato', base: 'Art. 298 — Código Eleitoral',
        dispositivo: 'Prender ou deter qualquer eleitor, membro de mesa receptora ou de junta apuradora, fiscal, delegado de partido, candidato, ou membro das juntas eleitorais, fora das formalidades legais ou dos casos previstos em lei.',
        pena: 'Reclusão até 4 anos.',
        nota: 'Crime que pode ser cometido pelo próprio agente público que prende indevidamente. Relacionado à proibição de prisão no período eleitoral (art. 236 CE) — ver seção de Procedimentos.',
        fase: 'sempre', cabeTco: false, categoria: 'crime',
        oqueFazer: 'NÃO lavrar TCO. Observar rigorosamente o art. 236 do Código Eleitoral e suas exceções (flagrante, sentença condenatória por crime inafiançável, salvo-conduto) antes de efetuar qualquer prisão no período eleitoral. Em caso de dúvida, acionar o COPOM.',
        tags: ['prender eleitor errado', 'deter mesário ilegalmente', 'prisão ilegal eleição'],
    },
    {
        titulo: 'Coação ao Voto Mediante Violência ou Grave Ameaça', base: 'Art. 301 — Código Eleitoral',
        dispositivo: 'Usar de violência ou grave ameaça para coagir alguém a votar, ou não votar, em determinado candidato ou partido, a fazer propaganda, a subscrever lista de apoiamento, ou a exercer qualquer direito eleitoral.',
        pena: 'Reclusão até 4 anos + pagamento de 5 a 15 dias-multa.',
        nota: 'Versão mais grave da "Coação para Votar" (art. 300): aqui não é exclusivo de servidor público e envolve violência ou grave ameaça.',
        fase: 'sempre', cabeTco: false, categoria: 'crime',
        tags: ['ameaçar eleitor com violência', 'coagir com força física voto', 'intimidar eleitor'],
    },
    {
        titulo: 'Concentração de Eleitores para Desvio ou Aliciamento', base: 'Art. 302 — Código Eleitoral',
        dispositivo: 'Reunir ou concentrar eleitores em determinado local, antes ou no dia da eleição, com o fim de desviá-los da seção eleitoral de origem, ou de aliciar seu voto mediante qualquer vantagem.',
        pena: 'Reclusão de 4 a 6 anos + pagamento de 200 a 300 dias-multa.',
        fase: 'dia', cabeTco: false, categoria: 'crime',
        tags: ['concentrar eleitores', 'curral eleitoral desviar voto'],
    },
    {
        titulo: 'Fornecer Cédula Assinalada para Identificar o Voto', base: 'Art. 307 — Código Eleitoral',
        dispositivo: 'Fornecer o mesário, ou qualquer pessoa, ao eleitor, cédula oficial já assinalada, marcada ou identificável, com o fim de identificar o seu voto.',
        pena: 'Reclusão até 5 anos + pagamento de 5 a 15 dias-multa.',
        fase: 'dia', cabeTco: false, categoria: 'crime',
        tags: ['cédula marcada', 'identificar voto eleitor', 'fraude na cédula'],
    },
    {
        titulo: 'Rubricar Cédulas Indevidamente', base: 'Art. 308 — Código Eleitoral',
        dispositivo: 'Rubricar o mesário, ou qualquer pessoa, cédulas oficiais em substituição aos membros da mesa receptora, sem a devida autorização.',
        pena: 'Reclusão até 5 anos + pagamento de 60 a 90 dias-multa.',
        fase: 'dia', cabeTco: false, categoria: 'crime',
        tags: ['rubricar cédula sem autorização', 'fraude na mesa receptora'],
    },
    {
        titulo: 'Votar ou Tentar Votar Mais de Uma Vez, ou em Lugar de Outrem', base: 'Art. 309 — Código Eleitoral',
        dispositivo: 'Votar ou tentar votar mais de uma vez, ou em lugar de outrem.',
        pena: 'Reclusão até 3 anos.',
        nota: 'Diferente do art. 311 (votar em seção onde não está inscrito, que admite TCO): aqui o eleitor vota mais de uma vez ou se passa por outra pessoa — conduta mais grave.',
        fase: 'dia', cabeTco: false, categoria: 'crime',
        tags: ['votar duas vezes', 'votar no lugar de outra pessoa', 'fraude de identidade na votação', 'se passar por outro eleitor'],
    },
    {
        titulo: 'Alterar Resultado de Votação em Mapas ou Boletins', base: 'Art. 315 — Código Eleitoral',
        dispositivo: 'Alterar, falsear ou fraudar, por qualquer meio, a apuração, a totalização de votos ou o resultado de votação em mapas, boletins ou documentos eleitorais.',
        pena: 'Reclusão até 5 anos + pagamento de 5 a 15 dias-multa.',
        fase: 'dia', cabeTco: false, categoria: 'crime',
        tags: ['fraudar apuração', 'falsificar boletim de urna', 'adulterar resultado da eleição'],
    },
    {
        titulo: 'Omitir Recibo de Impugnação ou Protesto na Apuração', base: 'Art. 316 — Código Eleitoral',
        dispositivo: 'Deixar o membro da mesa ou junta de dar recibo de impugnação ou de registrar o protesto apresentado por fiscal ou candidato.',
        pena: 'Reclusão até 5 anos + pagamento de 5 a 15 dias-multa.',
        fase: 'dia', cabeTco: false, categoria: 'crime',
        tags: ['não registrar impugnação', 'ignorar protesto fiscal eleição'],
    },
    {
        titulo: 'Violação de Urna ou Invólucro Lacrado', base: 'Art. 317 — Código Eleitoral',
        dispositivo: 'Violar ou tentar violar o sigilo da urna ou dos invólucros que acondicionam material de votação, abrindo-os indevidamente.',
        pena: 'Reclusão de 3 a 5 anos.',
        fase: 'dia', cabeTco: false, categoria: 'crime',
        tags: ['abrir urna indevidamente', 'violar lacre da urna', 'arrombar urna eleitoral'],
    },
    {
        titulo: 'Destruir, Suprimir ou Ocultar Urna ou Documento Eleitoral', base: 'Art. 339 — Código Eleitoral',
        dispositivo: 'Destruir, suprimir ou ocultar urna, lista de votação, documento ou objeto relativo à eleição.',
        pena: 'Reclusão de 2 a 6 anos + pagamento de 5 a 15 dias-multa.',
        fase: 'dia', cabeTco: false, categoria: 'crime',
        tags: ['destruir urna', 'sumir com urna eletrônica', 'esconder documento eleitoral', 'roubar urna'],
    },
    {
        titulo: 'Fabricar ou Utilizar Instrumento Fraudulento de Votação', base: 'Art. 340 — Código Eleitoral',
        dispositivo: 'Fabricar, mandar fabricar, adquirir, fornecer (ainda que gratuitamente), manter em depósito ou utilizar urna, cédula ou instrumento falso ou fraudulento destinado a substituir, nas eleições, o que foi aprovado pela Justiça Eleitoral.',
        pena: 'Reclusão até 3 anos + pagamento de 3 a 15 dias-multa.',
        fase: 'dia', cabeTco: false, categoria: 'crime',
        tags: ['urna falsa', 'cédula fraudulenta fabricada', 'material de votação falso'],
    },
    {
        titulo: 'Falsificação de Documento Público para Fins Eleitorais', base: 'Art. 348 — Código Eleitoral',
        dispositivo: 'Falsificar, no todo ou em parte, documento público, ou alterar documento público verdadeiro, com fins eleitorais.',
        pena: 'Reclusão de 2 a 6 anos + pagamento de 15 a 30 dias-multa (agravada se o agente é funcionário público e comete o crime prevalecendo-se do cargo).',
        fase: 'sempre', cabeTco: false, categoria: 'crime',
        tags: ['falsificar documento eleitoral', 'adulterar documento público eleição'],
    },
    {
        titulo: 'Falsidade Documental e Ideológica para Fins Eleitorais', base: 'Arts. 349, 350 e 352 — Código Eleitoral',
        dispositivo: 'Art. 349: falsificar ou alterar documento particular para fins eleitorais. Art. 350: omitir, em documento público ou particular, declaração que dele deveria constar, ou nele inserir declaração falsa ou diversa da que devia ser escrita, para fins eleitorais (falsidade ideológica). Art. 352: reconhecer como verdadeira, na qualidade de tabelião ou funcionário público, firma ou letra que não o seja, para fins eleitorais.',
        pena: 'Reclusão até 5 anos (documento público) ou até 3 anos (documento particular) + multa; agravada se o agente é funcionário público ou a falsidade recai sobre assentamento de registro civil.',
        fase: 'sempre', cabeTco: false, categoria: 'crime',
        tags: ['falsidade ideológica eleitoral', 'documento particular falso eleição', 'reconhecimento de firma falso'],
    },
    {
        titulo: 'Denunciação Caluniosa com Finalidade Eleitoral', base: 'Art. 326-A — Código Eleitoral',
        dispositivo: 'Dar causa à instauração de investigação policial, de processo judicial, instauração de investigação administrativa, inquérito civil ou ação de improbidade administrativa contra alguém, imputando-lhe crime ou ato infracional de que o sabe inocente, com finalidade eleitoral.',
        pena: 'Reclusão de 2 a 8 anos, e multa.',
        nota: 'Crime grave para coibir denúncias falsas usadas como arma política.',
        fase: 'sempre', cabeTco: false, categoria: 'crime',
        tags: ['denúncia falsa contra candidato', 'acusação falsa eleitoral', 'denunciação caluniosa'],
    },
    {
        titulo: 'Crimes contra o Sistema Eletrônico de Votação', base: 'Art. 72 — Lei das Eleições nº 9.504/97',
        dispositivo: 'Constituem crimes: I — obter acesso a sistema de tratamento automático de dados usado pelo serviço eleitoral para alterar a apuração ou a contagem de votos; II — desenvolver ou introduzir comando, instrução ou programa de computador capaz de destruir, apagar, eliminar, alterar, gravar ou transmitir dado, instrução ou comando, com o fim de adulterar a apuração ou a contagem de votos; III — causar, propositadamente, dano físico ao equipamento usado na votação ou na totalização de votos, ou a suas partes.',
        pena: 'Reclusão de 5 a 10 anos.',
        nota: 'Um dos crimes eleitorais mais graves da legislação — ataque à urna eletrônica ou ao sistema de totalização. Qualquer indício (violação de lacre, manipulação de equipamento, acesso não autorizado) deve ser tratado com prioridade máxima.',
        fase: 'dia', cabeTco: false, categoria: 'crime',
        oqueFazer: 'NÃO lavrar TCO. Isolar e preservar o equipamento/urna, acionar imediatamente o Oficial de serviço, a Zona Eleitoral e o COPOM, preservar a cadeia de custódia de qualquer dispositivo ou mídia envolvida, e encaminhar à Polícia Federal (crime contra o sistema eleitoral é, em regra, de atribuição federal).',
        tags: ['hackear urna eletrônica', 'invadir sistema de votação', 'dano à urna eletrônica', 'fraude eletrônica eleição', 'clonar urna'],
    },
    {
        titulo: 'Transporte Irregular de Eleitores na Véspera ou no Dia da Eleição', base: 'Art. 11, III, c/c arts. 5º, 8º e 10º — Lei nº 6.091/74',
        dispositivo: 'Descumprir as proibições relativas ao transporte de eleitores fora das hipóteses e prazos legalmente autorizados — em regra, qualquer transporte de eleitores organizado por candidato, partido, coligação ou comitê é vedado nos 15 dias anteriores à eleição (salvo o transporte comum já utilizado antes da campanha) e totalmente vedado por esses mesmos agentes na véspera e no dia da votação, ressalvado o transporte oficial organizado pela própria Justiça Eleitoral.',
        pena: 'Reclusão de 4 a 6 anos + pagamento de 200 a 300 dias-multa.',
        nota: 'NÃO é crime de menor potencial ofensivo. É diferente de uma carona isolada e espontânea entre particulares sem vínculo com campanha — a vedação penal mira o transporte ORGANIZADO por candidato/partido/comitê para levar eleitores às urnas. Na dúvida sobre o enquadramento, acionar o COPOM e a Zona Eleitoral.',
        fase: 'dia', cabeTco: false, categoria: 'crime',
        oqueFazer: 'NÃO lavrar TCO. Identificar se o transporte é organizado por candidato/partido/comitê (crime) ou se é carona isolada entre particulares sem vínculo eleitoral organizado (não configura o crime). Havendo transporte irregular organizado, encaminhar à Delegacia de Polícia Federal/Civil, apreender o veículo quando cabível e comunicar à Zona Eleitoral.',
        tags: ['transportar eleitores', 'carro de campanha levando eleitor', 'ônibus de eleitores', 'frete de eleitores', 'kombi eleitoral', 'van de candidato'],
    },

    // ── PROCEDIMENTOS / NORMATIVOS ──────────────────────────────
    {
        titulo: 'Força Armada na Seção Eleitoral (100 metros)', base: 'Art. 143 — Resolução TSE nº 23.751/2026 (antigo art. 151)',
        dispositivo: 'A força armada se conservará a 100m da seção eleitoral e não poderá aproximar-se do lugar da votação ou nele adentrar sem ordem judicial ou do presidente da Mesa Receptora, nas 48h que antecedem o pleito e nas 24h que o sucedem, exceto nos estabelecimentos penais e nas unidades de internação de adolescentes, respeitado o sigilo do voto. §1º Não se aplica aos integrantes das forças de segurança em serviço na Justiça Eleitoral e quando autorizados/convocados pela autoridade eleitoral. §2º Aplica-se inclusive aos civis que carreguem armas, ainda que detentores de porte ou licença estatal. §3º Não se aplica ao agente das forças de segurança em atividade geral de policiamento no dia das eleições, permitido o porte na seção no momento em que for votar. §6º O descumprimento do caput e do §2º acarreta prisão em flagrante por porte ilegal de arma, sem prejuízo do crime eleitoral correspondente.',
        pena: 'Descumprimento = prisão em flagrante por porte ilegal de arma + crime eleitoral correspondente.',
        nota: 'A numeração do artigo mudou em relação a 2024 (era art. 151) — confirme o número vigente na versão consolidada da Resolução antes de citá-lo em peça oficial.',
        fase: 'dia', cabeTco: false, categoria: 'procedimento',
        oqueFazer: 'Policial em serviço de policiamento geral pode aproximar-se/entrar armado; fora dessa hipótese, manter distância de 100m da seção salvo ordem do juiz eleitoral ou do presidente da mesa. Em caso de descumprimento por civil armado, prisão em flagrante por porte ilegal de arma — não se lavra TCO.',
        tags: ['entrar na seção', 'aproximar da seção eleitoral', 'arma na seção', '100 metros', 'força armada seção', 'policiamento no local de votação', 'adentrar seção'],
    },
    {
        titulo: 'Transporte de Armas por CAC (Colecionador, Atirador e Caçador)', base: 'Normativo — Manual TCO Eleitoral PMAL 2026',
        dispositivo: 'Fica proibido o transporte de armas e munições, em todo o território nacional, por CAC no dia das eleições, nas 24h que antecedem e nas 24h que sucedem o pleito.',
        pena: 'Descumprimento = prisão em flagrante por porte ilegal de arma, sem prejuízo do crime eleitoral correspondente.',
        fase: 'dia', cabeTco: false, categoria: 'procedimento',
        oqueFazer: 'Identificar se o portador é CAC regularizado; se o transporte ocorrer dentro da janela proibida (24h antes/depois do pleito), efetuar prisão em flagrante por porte ilegal de arma — não se lavra TCO.',
        tags: ['transportar arma', 'transporte de arma', 'cac', 'caçador atirador colecionador', 'munição', 'levar arma'],
    },
    {
        titulo: 'Ato Infracional Praticado por Adolescente', base: 'Normativo — Manual TCO Eleitoral PMAL 2026',
        dispositivo: 'O adolescente deverá ser conduzido à Delegacia Especializada ou, na ausência, à delegacia indicada pelo Juízo Eleitoral. Será necessário lavrar o Relatório de Apreensão e entregar o adolescente ao policial civil responsável, que deverá emitir o recibo da entrega.',
        fase: 'sempre', cabeTco: false, categoria: 'procedimento',
        oqueFazer: 'NÃO se lavra TCO (o TCO eleitoral é para maiores de 18 anos). Conduzir à Delegacia Especializada (ou à indicada pelo Juízo Eleitoral), lavrar Relatório de Apreensão e obter recibo de entrega do policial civil responsável.',
        tags: ['menor de idade', 'adolescente', 'ato infracional', 'eca eleitoral', 'criança'],
    },
    {
        titulo: 'Proibição de Prisão no Período Eleitoral', base: 'Art. 236 — Código Eleitoral',
        dispositivo: 'Nenhuma autoridade poderá, desde 5 dias antes e até 48h depois do encerramento da eleição, prender ou deter qualquer eleitor, salvo em flagrante delito ou em virtude de sentença criminal condenatória por crime inafiançável, ou por desrespeito a salvo-conduto. §1º Membros das mesas receptoras e fiscais de partido, no exercício das funções, não podem ser detidos ou presos, salvo flagrante delito; a mesma garantia vale para os candidatos desde 15 dias antes da eleição. §2º Ocorrendo prisão, o preso será imediatamente conduzido à presença do juiz competente que, verificada a ilegalidade, a relaxará e promoverá a responsabilidade do coator.',
        fase: 'sempre', cabeTco: false, categoria: 'procedimento',
        oqueFazer: 'Regra geral: NÃO prender eleitor no período (5 dias antes a 48h depois do encerramento), salvo flagrante delito, sentença condenatória por crime inafiançável ou desrespeito a salvo-conduto. Mesários e fiscais de partido (em função), e candidatos (desde 15 dias antes), só podem ser presos em flagrante.',
        tags: ['prender eleitor', 'prisão no período eleitoral', 'deter candidato', 'prender mesário', 'prender fiscal de partido', 'flagrante eleitoral'],
    },
];

CRIMES.forEach(function (c, i) {
    c._id = i;
    if (c.cabeTco && !c.oqueFazer) c.oqueFazer = OQUE_FAZER_PADRAO_TCO;
    if (!c.cabeTco && !c.oqueFazer) c.oqueFazer = OQUE_FAZER_PADRAO_NAO_TCO;
});

// ════════════════════════════════════════════════════════════════
// BUSCA — normaliza (minúsculas, sem acento), separa a consulta em
// palavras e pontua cada card pela quantidade de palavras encontradas
// (em título, base legal, dispositivo, nota, "o que fazer" e tags) —
// título/tags valem mais que o corpo do texto. Pedido explícito do
// usuário: "poder consultar qualquer palavra que eu colocar na
// consulta e que estiver no texto da lei" — por isso _buscaCorpo
// inclui o DISPOSITIVO LEGAL NA ÍNTEGRA (não um resumo) de cada um
// dos 52 itens, não só o título/tags: qualquer termo que apareça no
// texto literal do artigo é encontrado. Sem necessidade de lib
// externa: a base é pequena (~50 itens) e o match por substring já
// cobre bem os termos que um PM digitaria no campo.
// ════════════════════════════════════════════════════════════════
function semAcento(s) {
    return String(s || '').toLowerCase()
        .replace(/[áàãâä]/g, 'a').replace(/[éèêë]/g, 'e')
        .replace(/[íìîï]/g, 'i').replace(/[óòõôö]/g, 'o')
        .replace(/[úùûü]/g, 'u').replace(/ç/g, 'c').replace(/ñ/g, 'n');
}

// Palavras muito comuns em português (conectivos) — aparecem em quase
// todo card, então contam pouco pra pontuação não ficar "diluída" numa
// consulta de várias palavras (ex.: "véspera da eleição" deve priorizar
// quem tem "véspera", não só quem tem "da"/"eleição"). Ainda contam um
// pouco — nunca ficam de fora da busca, só pesam menos.
const PALAVRAS_COMUNS = new Set(['de', 'da', 'do', 'das', 'dos', 'a', 'o', 'as', 'os', 'e', 'ou', 'em',
    'no', 'na', 'nos', 'nas', 'para', 'por', 'com', 'sem', 'que', 'se', 'ao', 'aos', 'à', 'às',
    'um', 'uma', 'uns', 'umas', 'eleitoral', 'eleitorais', 'eleicao', 'eleicoes']);

CRIMES.forEach(function (c) {
    c._buscaTitulo = semAcento(c.titulo + ' ' + (c.tags || []).join(' '));
    c._buscaCorpo = semAcento([c.base, c.dispositivo, c.pena, c.nota, c.oqueFazer].filter(Boolean).join(' '));
});

function pontuar(card, palavras) {
    let score = 0;
    palavras.forEach(function (p) {
        if (!p) return;
        const peso = PALAVRAS_COMUNS.has(p) ? 0.3 : 1;
        if (card._buscaTitulo.includes(p)) score += 3 * peso;
        if (card._buscaCorpo.includes(p)) score += 1 * peso;
    });
    return score;
}

let filtroAtivo = 'todos';

function aplicarFiltro(card) {
    if (filtroAtivo === 'todos') return true;
    if (filtroAtivo === 'antes') return card.fase === 'antes' || card.fase === 'sempre';
    if (filtroAtivo === 'dia') return card.fase === 'dia' || card.fase === 'sempre';
    if (filtroAtivo === 'cabe') return card.cabeTco === true;
    if (filtroAtivo === 'naocabe') return card.cabeTco === false;
    if (filtroAtivo === 'proc') return card.categoria === 'procedimento';
    return true;
}

const FASE_LABEL = { antes: 'Antes do pleito', dia: 'Dia da eleição', sempre: 'A qualquer tempo' };

function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function montarCard(c) {
    const classeCor = !c.cabeTco ? (c.categoria === 'procedimento' ? 'proc' : 'nao-cabe') : 'cabe';
    const badgeCabe = c.cabeTco
        ? '<span class="badge b-cabe">✓ Cabe TCO</span>'
        : '<span class="badge b-naocabe">✕ Não cabe TCO</span>';
    const badgeProc = c.categoria === 'procedimento' ? '<span class="badge b-proc">Procedimento</span>' : '';
    return '<div class="card-crime ' + classeCor + '" data-id="' + c._id + '">' +
        '<div class="card-head">' +
            '<div><h3>' + esc(c.titulo) + '</h3><div class="card-base">' + esc(c.base) + '</div></div>' +
            '<div class="badges">' + badgeProc + '<span class="badge b-fase">' + FASE_LABEL[c.fase] + '</span>' + badgeCabe + '</div>' +
        '</div>' +
        '<div class="card-corpo">' +
            '<div class="linha-campo pena"><b>Pena</b>' + esc(c.pena || '—') + '</div>' +
            (c.nota ? '<div class="linha-campo nota">' + esc(c.nota) + '</div>' : '') +
            '<div class="linha-campo fazer"><b>O que fazer</b>' + esc(c.oqueFazer) + '</div>' +
            '<span class="toggle-dispositivo" data-id="' + c._id + '">📖 Ver texto da lei</span>' +
            '<div class="dispositivo-legal" id="disp-' + c._id + '">' + esc(c.dispositivo || '') + '</div>' +
        '</div>' +
    '</div>';
}

function renderizar() {
    const q = semAcento(document.getElementById('campo-busca').value.trim());
    const palavras = q.split(/\s+/).filter(Boolean);
    let lista = CRIMES.filter(aplicarFiltro);

    if (palavras.length) {
        lista = lista.map(function (c) { return { c: c, score: pontuar(c, palavras) }; })
            .filter(function (x) { return x.score > 0; })
            .sort(function (a, b) { return b.score - a.score; })
            .map(function (x) { return x.c; });
    }

    const contador = document.getElementById('contador-resultados');
    const grade = document.getElementById('grade-cards');

    if (!lista.length) {
        contador.textContent = '';
        grade.innerHTML = '<div class="sem-resultado"><span class="ic">🔍</span>Nenhum resultado para essa busca/filtro.<br>Tente outro termo ou toque em "Todos".</div>';
        return;
    }

    contador.textContent = lista.length + ' resultado(s)' + (palavras.length ? ' para "' + document.getElementById('campo-busca').value.trim() + '"' : '');
    grade.innerHTML = lista.map(montarCard).join('');
}

document.getElementById('campo-busca').addEventListener('input', function () {
    document.getElementById('limpar-busca').style.display = this.value ? 'block' : 'none';
    renderizar();
});
document.getElementById('limpar-busca').addEventListener('click', function () {
    document.getElementById('campo-busca').value = '';
    this.style.display = 'none';
    renderizar();
});
document.querySelectorAll('.exemplos b').forEach(function (b) {
    b.addEventListener('click', function () {
        const campo = document.getElementById('campo-busca');
        campo.value = this.getAttribute('data-ex');
        campo.dispatchEvent(new Event('input'));
        campo.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
});
document.querySelectorAll('.chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
        document.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('ativo'); });
        this.classList.add('ativo');
        filtroAtivo = this.getAttribute('data-filtro');
        renderizar();
    });
});

// ════════════════════════════════════════════════════════════════
// ABAS — pedido explícito do usuário: "mova essas informações de
// atualizações do tre e tse para dentro de uma aba específica...
// ficou muito texto na tela". Só 2 abas: "Guia" (busca + cards +
// procedimento + autoridades + zonas, tudo que já existia) e
// "Novidades 2026" (prazos/resoluções recentes do TSE/TRE-AL) — a
// aba Guia é a padrão ao abrir a página, a de Novidades só aparece
// quando o usuário clica. Os links do menu que apontam pra dentro da
// aba Guia (Buscar/Procedimento/Autoridades/Não cabe/Zonas) continuam
// como âncora normal — só garantem que a aba Guia esteja visível
// antes do navegador rolar até lá.
function mostrarAba(nome) {
    document.getElementById('aba-guia').hidden = (nome !== 'guia');
    document.getElementById('aba-novidades').hidden = (nome !== 'novidades');
    document.querySelectorAll('.aba-nav-link').forEach(function (a) {
        a.classList.toggle('ativo', a.getAttribute('data-aba') === nome);
    });
}
document.querySelectorAll('.aba-nav-link').forEach(function (a) {
    a.addEventListener('click', function (ev) {
        const aba = this.getAttribute('data-aba');
        if (aba === 'novidades') {
            ev.preventDefault();
            mostrarAba('novidades');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
            mostrarAba('guia'); // deixa visível ANTES do salto de âncora do próprio <a href="#...">
        }
    });
});
mostrarAba('guia');
document.getElementById('grade-cards').addEventListener('click', function (ev) {
    const t = ev.target.closest('.toggle-dispositivo');
    if (!t) return;
    const id = t.getAttribute('data-id');
    const el = document.getElementById('disp-' + id);
    if (!el) return;
    const aberto = el.classList.toggle('aberto');
    t.textContent = aberto ? '📖 Ocultar texto da lei' : '📖 Ver texto da lei';
});

renderizar();

// ════════════════════════════════════════════════════════════════
// ANEXO I — ZONAS ELEITORAIS
// ════════════════════════════════════════════════════════════════
const ZONAS = [
    ['1ª', 'Maceió', 'ze0001@tre-al.jus.br'], ['2ª', 'Maceió', 'ze0002@tre-al.jus.br'],
    ['3ª', 'Maceió', 'ze0003@tre-al.jus.br'], ['5ª', 'Viçosa', 'ze0005@tre-al.jus.br'],
    ['6ª', 'Atalaia', 'ze0006@tre-al.jus.br'], ['7ª', 'Coruripe', 'ze0007@tre-al.jus.br'],
    ['8ª', 'Pilar', 'ze0008@tre-al.jus.br'], ['9ª', 'Murici', 'ze0009@tre-al.jus.br'],
    ['10ª', 'Palmeira dos Índios', 'ze0010@tre-al.jus.br'], ['11ª', 'Pão de Açúcar', 'ze0011@tre-al.jus.br'],
    ['12ª', 'Passo de Camaragibe', 'ze0012@tre-al.jus.br'], ['13ª', 'Penedo', 'ze0013@tre-al.jus.br'],
    ['14ª', 'Porto Calvo', 'ze0014@tre-al.jus.br'], ['15ª', 'Rio Largo', 'ze0015@tre-al.jus.br'],
    ['16ª', 'São José da Laje', 'ze0016@tre-al.jus.br'], ['17ª', 'São Luís do Quitunde', 'ze0017@tre-al.jus.br'],
    ['18ª', 'São Miguel dos Campos', 'ze0018@tre-al.jus.br'], ['19ª', 'Santana do Ipanema', 'ze0019@tre-al.jus.br'],
    ['20ª', 'Traipu', 'ze0020@tre-al.jus.br'], ['21ª', 'União dos Palmares', 'ze0021@tre-al.jus.br'],
    ['22ª', 'Arapiraca', 'ze0022@tre-al.jus.br'], ['26ª', 'Marechal Deodoro', 'ze0026@tre-al.jus.br'],
    ['27ª', 'Mata Grande', 'ze0027@tre-al.jus.br'], ['28ª', 'Quebrangulo', 'ze0028@tre-al.jus.br'],
    ['29ª', 'Batalha', 'ze0029@tre-al.jus.br'], ['31ª', 'Major Isidoro', 'ze0031@tre-al.jus.br'],
    ['33ª', 'Maceió', 'ze0033@tre-al.jus.br'], ['34ª', 'Teotônio Vilela', 'ze0034@tre-al.jus.br'],
    ['37ª', 'Porto Real do Colégio', 'ze0037@tre-al.jus.br'], ['39ª', 'Água Branca', 'ze0039@tre-al.jus.br'],
    ['40ª', 'Delmiro Gouveia', 'ze0040@tre-al.jus.br'], ['44ª', 'Girau do Ponciano', 'ze0044@tre-al.jus.br'],
    ['45ª', 'Igaci', 'ze0045@tre-al.jus.br'], ['46ª', 'Cacimbinhas', 'ze0046@tre-al.jus.br'],
    ['47ª', 'Campo Alegre', 'ze0047@tre-al.jus.br'], ['48ª', 'Boca da Mata', 'ze0048@tre-al.jus.br'],
    ['49ª', 'São Sebastião', 'ze0049@tre-al.jus.br'], ['50ª', 'Maravilha', 'ze0050@tre-al.jus.br'],
    ['51ª', 'São José da Tapera', 'ze0051@tre-al.jus.br'], ['53ª', 'Joaquim Gomes', 'ze0053@tre-al.jus.br'],
    ['54ª', 'Maceió', 'ze0054@tre-al.jus.br'], ['55ª', 'Arapiraca', 'ze0055@tre-al.jus.br'],
];

function renderZonas(filtro) {
    const f = semAcento(filtro || '');
    const linhas = ZONAS.filter(function (z) { return !f || semAcento(z[0] + ' ' + z[1]).includes(f); })
        .map(function (z) { return '<tr><td>' + z[0] + '</td><td>' + esc(z[1]) + '</td><td>' + z[2] + '</td></tr>'; })
        .join('');
    document.querySelector('#tabela-zonas tbody').innerHTML = linhas || '<tr><td colspan="3" style="text-align:center;color:#999;">Nenhuma zona encontrada.</td></tr>';
}
renderZonas('');
document.getElementById('busca-zona').addEventListener('input', function () { renderZonas(this.value); });

// ════════════════════════════════════════════════════════════════
// Botão "voltar ao topo"
// ════════════════════════════════════════════════════════════════
window.addEventListener('scroll', function () {
    document.getElementById('btn-topo').classList.toggle('visivel', window.scrollY > 500);
});
document.getElementById('btn-topo').addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
});
