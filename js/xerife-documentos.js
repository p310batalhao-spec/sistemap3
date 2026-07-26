// ════════════════════════════════════════════════════════════════════
// XERIFE — ANÁLISE DE DOCUMENTOS (OCR/PDF) — módulo separado, carregado
// SÓ em page/chat-mobile.html (não injetado em toda página pelo
// session.js) — evita baixar PDF.js/Tesseract.js em quem nunca usa isso.
//
// Depende de window.Xerife já estar carregado (js/xerife.js) — espera
// via polling curto, mesmo padrão usado em js/core/session.js pro botão
// flutuante. Estende window.Xerife com UMA função nova:
//   window.Xerife.analisarDocumento(file)
//
// Escopo v1: só reconhece ofícios de EVENTO (ver contexto no chat — TCO/
// Materiais/CVP/MVI/Sentença ficam pra uma próxima etapa). Cadastra no
// MESMO Google Apps Script que page/eventos.html já usa (action=create),
// nos mesmos nomes de campo — nenhum endpoint novo foi inventado.
//
// Doutrina de segurança: texto extraído de OCR/PDF é conteúdo NÃO
// CONFIÁVEL (vem de um arquivo enviado pelo usuário) — todo valor exibido
// vira HTML só depois de passar por Xerife.escHtml(), e os botões de
// confirmação nunca usam onclick inline (sempre addEventListener depois
// de inserir o HTML). Nada é gravado sem clique explícito em "Cadastrar".
// ════════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    function NORM(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim(); }

    // ── Espera window.Xerife (js/xerife.js) terminar de carregar ────────
    function aguardarXerife() {
        return new Promise((resolve, reject) => {
            let tentativas = 0;
            const t = setInterval(() => {
                if (window.Xerife && window.Xerife.enviarPergunta) { clearInterval(t); resolve(window.Xerife); }
                else if (++tentativas > 50) { clearInterval(t); reject(new Error('Xerife não carregou a tempo')); }
            }, 200);
        });
    }

    // ── Carregamento sob demanda de bibliotecas externas (só quando o
    // usuário realmente anexa um arquivo) — mesmo padrão de carregamento
    // dinâmico de <script> já usado em js/gerarcartao.js (_iniciarSortable),
    // com cache por Promise pra não recarregar em anexos seguintes. ──────
    const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
    const PDFJS_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.4/dist/tesseract.min.js';

    function carregarScript(src) {
        return new Promise((resolve, reject) => {
            const existente = document.querySelector(`script[data-xerife-lib="${src}"]`);
            if (existente) { existente.addEventListener('load', resolve); if (existente.dataset.carregado) resolve(); return; }
            const s = document.createElement('script');
            s.src = src;
            s.dataset.xerifeLib = src;
            s.onload = () => { s.dataset.carregado = '1'; resolve(); };
            s.onerror = () => reject(new Error('Falha ao carregar biblioteca: ' + src));
            document.head.appendChild(s);
        });
    }

    let promessaPdfJs = null;
    function carregarPdfJs() {
        if (!promessaPdfJs) {
            promessaPdfJs = carregarScript(PDFJS_URL).then(() => {
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
                return window.pdfjsLib;
            });
        }
        return promessaPdfJs;
    }

    let promessaTesseract = null;
    function carregarTesseract() {
        if (!promessaTesseract) promessaTesseract = carregarScript(TESSERACT_URL).then(() => window.Tesseract);
        return promessaTesseract;
    }

    // ── Extração de texto bruto do arquivo ──────────────────────────────
    // Limite de segurança — ofícios costumam ter 1-2 páginas; sem isso, um
    // PDF escaneado de muitas páginas rodaria OCR página por página até travar
    // a aba (cada página leva vários segundos no Tesseract).
    const MAX_PAGINAS_OCR_PDF = 5;

    // PDF escaneado (só imagem, sem camada de texto) — em vez de desistir e
    // devolver a tarefa pro usuário, renderiza cada página como imagem
    // (mesma técnica de qualquer visualizador de PDF: canvas + viewport) e
    // roda o MESMO OCR usado pra fotos avulsas em cima dela.
    async function ocrPdfEscaneado(pdf, onProgresso) {
        const Tesseract = await carregarTesseract();
        const totalPaginas = Math.min(pdf.numPages, MAX_PAGINAS_OCR_PDF);
        let texto = '';
        for (let i = 1; i <= totalPaginas; i++) {
            if (onProgresso) onProgresso(`🔎 Página escaneada, rodando OCR… (${i}/${totalPaginas})`);
            const pagina = await pdf.getPage(i);
            const viewport = pagina.getViewport({ scale: 2 }); // escala maior = OCR mais preciso
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');
            await pagina.render({ canvasContext: ctx, viewport }).promise;
            const resultado = await Tesseract.recognize(canvas, 'por');
            texto += ((resultado && resultado.data && resultado.data.text) || '') + '\n';
        }
        return texto;
    }

    async function extrairTextoDeArquivo(file, onProgresso) {
        if (file.type === 'application/pdf') {
            const pdfjsLib = await carregarPdfJs();
            const buffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
            let texto = '';
            for (let i = 1; i <= pdf.numPages; i++) {
                const pagina = await pdf.getPage(i);
                const conteudo = await pagina.getTextContent();
                texto += conteudo.items.map(it => it.str).join(' ') + '\n';
            }
            if (texto.trim().length < 20) {
                texto = await ocrPdfEscaneado(pdf, onProgresso);
            }
            if (texto.trim().length < 20) {
                throw new Error('Não consegui ler texto suficiente nesse PDF, nem com OCR — tente uma foto mais nítida, com mais luz, ou mais perto do texto.');
            }
            return texto;
        }
        if (file.type.startsWith('image/')) {
            const Tesseract = await carregarTesseract();
            const resultado = await Tesseract.recognize(file, 'por');
            const texto = (resultado && resultado.data && resultado.data.text) || '';
            if (texto.trim().length < 20) {
                throw new Error('Não consegui ler texto suficiente nessa imagem — tente tirar a foto com mais luz/foco ou mais perto do texto.');
            }
            return texto;
        }
        throw new Error('Formato de arquivo não suportado — envie um PDF ou uma foto (JPG/PNG).');
    }

    // ── Classificação: por enquanto só reconhece ofício de evento ───────
    // Usa RADICAIS em vez de palavras completas onde faz sentido (ex.:
    // "solicit" casa solicito/solicita/solicitamos/solicitação/solicitar) —
    // a lista original só pegava a forma exata "solicito"/"realizacao" e
    // ficava cega pra variações super comuns ("solicitamos", "realizada").
    // Também ampliada com termos de apoio policial/policiamento em geral
    // (não só "festa"/"evento" no sentido estrito) — um ofício pedindo
    // reforço pra um campeonato de futebol ou pros Jogos Estudantis (JEAL)
    // é o MESMO tipo de documento pro nosso propósito, mesmo sem usar a
    // palavra "evento" ou "festa" em lugar nenhum.
    const PALAVRAS_OFICIO_EVENTO = [
        'oficio', 'evento', 'autorizacao', 'solicit', 'realizac', 'realizad', 'festivid',
        'festa', 'festival', 'show', 'feira', 'comemorac', 'procissao', 'quermesse',
        'vaquejada', 'forro', 'cavalgada', 'exposicao', 'arraia', 'trilha',
        'apoio', 'policiamento', 'reforco', 'guarnicao', 'seguranca', 'jogos',
        'copa', 'campeonato', 'competicao', 'programacao',
    ];
    function classificarOficioEvento(texto) {
        const t = NORM(texto);
        return PALAVRAS_OFICIO_EVENTO.filter(p => t.includes(NORM(p))).length >= 2;
    }

    // ── Extratores de campo de formato fixo (regex, sem IA) ─────────────
    // Ofícios reais raramente escrevem a data do EVENTO em dígitos — o mais
    // comum é por extenso ("no dia 11 de julho de 2026"), com o formato
    // DD/MM/AAAA aparecendo só (se aparecer) na data da CARTA em si. Por
    // isso tenta dígitos primeiro (mais confiável quando existe) e cai pro
    // extenso — preferindo o trecho precedido de "dia" (padrão de data de
    // EVENTO), pra não confundir com a data de cabeçalho da carta
    // ("Cidade, DD de mês de ANO."), que também bate no mesmo padrão e
    // normalmente aparece ANTES no texto.
    const MESES_EXTENSO = { janeiro: 1, fevereiro: 2, marco: 3, março: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
    function extrairData(texto) {
        const t = String(texto || '');
        const direto = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
        if (direto) return `${direto[1].padStart(2, '0')}/${direto[2].padStart(2, '0')}/${direto[3]}`;

        const achados = Array.from(t.matchAll(/\b(\d{1,2})\s*de\s*(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s*de\s*(\d{4}))?\b/gi));
        if (!achados.length) return '';
        const comDia = achados.find(m => /\bdia\s*$/i.test(t.slice(Math.max(0, m.index - 10), m.index)));
        const escolhido = comDia || achados[0];
        const dia = escolhido[1].padStart(2, '0');
        const mes = String(MESES_EXTENSO[NORM(escolhido[2]).toLowerCase()] || '').padStart(2, '0');
        if (!mes) return '';
        // Sem ano junto da data por extenso (comum em formulários curtos,
        // ex.: "Data: 25 julho") — busca o ano mais próximo em qualquer
        // lugar do documento como melhor palpite (sempre editável depois).
        const ano = escolhido[3] || (t.match(/\b20\d{2}\b/) || [])[0] || '';
        return ano ? `${dia}/${mes}/${ano}` : '';
    }
    // Ofícios reais costumam ter DOIS horários (início e término) e não
    // necessariamente em ordem crescente — eventos que atravessam a
    // meia-noite (ex.: "início às 9:30 e término a 00:00") tornam a
    // heurística antiga (só ordenar os valores) errada, porque 00:00 vem
    // antes de 9:30 numericamente mesmo sendo o horário de TÉRMINO.
    //
    // A heurística certa NÃO é "o horário mais próximo" (testado e falha:
    // numa frase como "início às 9:30 e término a 00:00", a palavra
    // "término" fica, em distância bruta de caracteres, mais perto de
    // "9:30" — que vem ANTES dela — do que de "00:00", que vem DEPOIS).
    // O português sempre põe o horário DEPOIS da palavra-chave ("início
    // ÀS X", "término A Y"), nunca antes — por isso a busca certa é "o
    // primeiro horário que aparece a partir da posição da palavra-chave em
    // diante", não "o mais próximo em qualquer direção".
    // Aceita hora SEM minutos também ("19h", "9h00", "9:30") — ofícios
    // costumam misturar os dois formatos na mesma frase.
    function extrairHoras(texto) {
        const horas = Array.from(texto.matchAll(/\b(\d{1,2})[:h]\s?(\d{2})?\b/gi)).map(m => ({
            valor: `${m[1].padStart(2, '0')}:${m[2] || '00'}`,
            indice: m.index,
        }));
        if (!horas.length) return { inicio: '', fim: '' };
        if (horas.length === 1) return { inicio: horas[0].valor, fim: '' };

        const tNorm = NORM(texto);
        const idxInicio = tNorm.search(/IN[IÍ]CIO/);
        // "encerramento" é sinônimo comum de término em ofícios de evento
        // (ex.: "com início às 20h00 e encerramento às 02h00") — sem ele,
        // a palavra-chave de término nunca era achada nesses casos.
        const idxTermino = tNorm.search(/T[EÉ]RMINO|ENCERRAMENTO|\bFIM\b/);
        const primeiraApos = idxPalavra => {
            if (idxPalavra === -1) return null;
            return horas.reduce((melhor, h) => {
                if (h.indice < idxPalavra) return melhor; // horário antes da palavra-chave não conta
                return (!melhor || h.indice < melhor.indice) ? h : melhor;
            }, null);
        };
        const achadaInicio = primeiraApos(idxInicio);
        const achadaTermino = primeiraApos(idxTermino);

        // Usa cada palavra-chave ACHADA individualmente — antes, se só UMA
        // das duas fosse encontrada (ex.: documento usa "encerramento" mas
        // não tinha sido reconhecido), o código descartava a outra que
        // TINHA sido achada corretamente e recaía pra ordem cronológica dos
        // dois, o que já se mostrou errado pra eventos que atravessam a
        // meia-noite. Só cai pra ordem cronológica no lado que realmente
        // faltou palavra-chave (ou empatou com o outro lado).
        const unicos = Array.from(new Set(horas.map(h => h.valor))).sort();
        let inicio = achadaInicio ? achadaInicio.valor : '';
        let fim = (achadaTermino && achadaTermino.valor !== inicio) ? achadaTermino.valor : '';
        if (!inicio && !fim) { inicio = unicos[0] || ''; fim = unicos[1] || unicos[0] || ''; }
        else if (!inicio) { inicio = unicos.find(v => v !== fim) || unicos[0] || ''; }
        else if (!fim) { fim = unicos.find(v => v !== inicio) || unicos[0] || ''; }
        return { inicio, fim };
    }
    // Extrai só UM horário de um trecho curto (ex.: valor já isolado por
    // rótulo, tipo "Início: 19h") — mais simples que extrairHoras (que
    // precisa decidir entre dois horários), usado como refinamento.
    function extrairUmaHora(texto) {
        const m = String(texto || '').match(/\b(\d{1,2})[:h]\s?(\d{2})?\b/i);
        return m ? `${m[1].padStart(2, '0')}:${m[2] || '00'}` : '';
    }
    // OCR às vezes troca "." por espaço ou some com o separador — aceita
    // espaço opcional além de ponto/traço/barra nos separadores, sem abrir
    // mão do formato de grupos (3-3-3-2 pro CPF, 2-3-3-4-2 pro CNPJ), que
    // já é específico o bastante pra não confundir com outro número solto.
    function extrairCPF(texto) {
        const cpf = texto.match(/\b\d{3}[.\s]?\d{3}[.\s]?\d{3}-?\s?\d{2}\b/);
        if (cpf) return cpf[0].replace(/\s+/g, '');
        const cnpj = texto.match(/\b\d{2}[.\s]?\d{3}[.\s]?\d{3}[\/\s]?\d{4}-?\s?\d{2}\b/);
        return cnpj ? cnpj[0].replace(/\s+/g, '') : '';
    }
    // 0? antes do DDD — formatação antiga/legada de discagem ainda comum em
    // papel timbrado de prefeitura ("(082)" = "0" + DDD "82", convenção de
    // interurbano), sem o 0? o "(0" ficava de fora do número capturado.
    // \s? depois do 9 também — formato "82 9 9902-2883" (DDD, o dígito 9
    // do celular e o resto do número, cada um separado por espaço) é comum
    // o bastante em formulários pra merecer suporte, não só "8299902-2883".
    function extrairTelefone(texto) {
        const m = texto.match(/\(?0?\d{2}\)?\s?9?\s?\d{4}-?\d{4}\b/);
        return m ? m[0] : '';
    }
    // Prioriza um número IMEDIATAMENTE seguido de "pessoas"/"espectadores"
    // (mais específico e confiável) sobre a proximidade genérica com
    // "estimativa"/"público" — um ofício comum cita mais de um número perto
    // dessas palavras (ex.: "estimativa de 300 motocicletas... e a presença
    // de 2.000 pessoas"), e o genérico pegava o primeiro (errado). Aceita
    // ponto/vírgula como separador de milhar (ex.: "2.000") e um parêntese
    // explicativo opcional entre o número e a palavra (ex.: "800
    // (oitocentas) pessoas" — comum em redação oficial), que sem essa
    // tolerância quebrava o casamento e fazia cair pro genérico (que aí
    // sim pegava um número errado de outra frase perto de "estimativa").
    function extrairEstimativaPublico(texto) {
        const numero = '(\\d{1,3}(?:[.,]\\d{3})*)';
        const mDireto = texto.match(new RegExp(numero + '\\s*(?:\\([^)]*\\)\\s*)?(?:pessoas|espectadores|participantes)', 'i'));
        if (mDireto) return mDireto[1].replace(/[.,]/g, '');
        const mGenerico = texto.match(new RegExp('(?:p[uú]blico|estimativa)[^\\d]{0,20}' + numero, 'i'));
        return mGenerico ? mGenerico[1].replace(/[.,]/g, '') : '';
    }
    // Aceita o ponto do "n.º" (abreviação de "número" comum em papel
    // timbrado oficial, ex.: "Ofício n.º 33/2026") — sem o \.? entre "n" e
    // o indicador de ordinal, o ponto quebrava o casamento e o protocolo
    // sempre voltava vazio nesse formato (bem comum em ofícios de prefeitura).
    function extrairProtocolo(texto) {
        const m = texto.match(/of[ií]cio\s*n?\.?\s*[ºo°]?\.?\s*[:\-]?\s*(\d+\/?\d*)/i);
        return m ? m[1] : '';
    }
    // Fallback de CIDADE quando a IA não está disponível — usa o padrão
    // clássico de datação de ofício brasileiro ("Cidade /UF, DD de mês de
    // AAAA" ou "Cidade, DD de mês de AAAA"), que aparece logo no topo da
    // grande maioria dos ofícios oficiais. Nome de cidade capturado com
    // quantificador PREGUIÇOSO (tenta o menor trecho possível primeiro,
    // vai crescendo só o necessário) — evita ter que modelar à mão cada
    // conector possível ("d'Arca", "dos Índios", "de Minas" etc.). Exclui
    // quebra de linha, barra e vírgula do meio do nome (são exatamente os
    // caracteres que marcam o FIM do nome da cidade) — sem isso, um
    // cabeçalho de página com o nome do município ANTES da data (comum em
    // papel timbrado) fazia o preguiçoso "vazar" e engolir várias linhas
    // até achar a primeira data qualquer no documento.
    // Traço (– / — / -) TAMBÉM é fronteira, não só barra/vírgula — formato
    // "Cidade – UF, DD de mês de AAAA" (com travessão antes da UF) é tão
    // comum quanto "Cidade/UF, ..."; sem excluir o traço do meio da
    // captura, "Cacimbinhas – AL" inteiro virava "cidade" (incluindo a UF).
    //
    // IMPORTANTE — NUNCA usar a flag /i aqui: o "[A-ZÀ-Ú]" no começo da
    // captura EXISTE justamente pra exigir que o nome comece com maiúscula
    // de verdade (distinguindo um nome próprio de uma palavra qualquer no
    // meio da frase, tipo "a", "de", "para"). Com /i essa exigência vira
    // inútil — [A-ZÀ-Ú] passa a casar QUALQUER letra, maiúscula ou
    // minúscula — e a captura já vazou "para a realização de evento" como
    // se fosse nome de cidade num caso real. Por isso: acha a posição da
    // DATA por extenso usando NORM (tolera maiúsculo/minúsculo/acento só
    // pra achar a posição), e SÓ DEPOIS aplica a regex do nome da cidade
    // sem /i sobre o texto ORIGINAL, olhando pra trás a partir dali.
    function extrairCidadeDateline(texto) {
        const tNorm = NORM(texto);
        const md = tNorm.match(/\d{1,2}\s*DE\s*(JANEIRO|FEVEREIRO|MAR[CÇ]O|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)\s*DE\s*\d{4}/);
        if (!md) return '';
        const antes = texto.slice(0, md.index);
        const m = antes.match(/([A-ZÀ-Ú][^\n\/,–—-]{1,40}?)\s*[\/,–—-]\s*(?:[A-Z]{2}\s*,\s*)?$/);
        return m ? m[1].replace(/\s+/g, ' ').trim() : '';
    }
    // Fallback adicional pra CIDADE: papel timbrado de prefeitura quase
    // sempre estampa "PREFEITURA MUNICIPAL DE <CIDADE>" (ou "PREFEITURA DO
    // MUNICÍPIO DE <CIDADE>") no cabeçalho — funciona mesmo em formulários
    // sem nenhuma linha de datação corrida (ex.: a Autorização de Palmeira
    // dos Índios, que é só uma lista de campos). Mesmo cuidado do
    // extrairCidadeDateline: localiza o RÓTULO via NORM (tolera caixa),
    // mas extrai o nome da cidade sem /i sobre o texto original — sem essa
    // separação, o "[A-ZÀ-Ú]" também casava a legenda/slogan do brasão
    // logo depois do nome de verdade (ex.: "PAULO JACINTO" seguido de
    // "Reconstrução em Ação!" virava tudo junto "cidade").
    function extrairCidadePrefeitura(texto) {
        const tNorm = NORM(texto);
        for (const rotulo of ['PREFEITURA MUNICIPAL DE', 'PREFEITURA DO MUNICIPIO DE']) {
            const idx = tNorm.indexOf(rotulo);
            if (idx === -1) continue;
            const trecho = texto.slice(idx + rotulo.length);
            const m = trecho.match(/^\s+([A-ZÀ-Ú][\wÀ-ÿ'’]*(?:[^\S\n]+(?:do|da|dos|das|de)?[^\S\n]*[A-ZÀ-Ú][\wÀ-ÿ'’]*){0,3})/);
            if (m) return m[1].replace(/\s+/g, ' ').trim();
        }
        return '';
    }
    // Palavras típicas de NOME de evento — não inclui "evento" sozinho
    // (genérico demais: aparece em "durante o evento", "para o evento" sem
    // ligação com o nome próprio de verdade, gerando captura sem sentido).
    const PALAVRAS_EVENTO_NOME = ['trilha', 'festa', 'festival', 'show', 'feira', 'comemoracao', 'procissao', 'quermesse', 'vaquejada', 'forro', 'cavalgada', 'exposicao', 'arraial', 'arraia', 'copa', 'jogos', 'campeonato'];

    // Nomes de evento entre ASPAS (ex.: uma declaração de anuência citando
    // "3ª Trilha em alusão ao Festival de Inverno de Mar Vermelho") são o
    // sinal MAIS confiável que existe — a aspa já delimita o nome inteiro
    // de propósito, sem precisar adivinhar onde ele termina.
    function extrairNomeEventoEntreAspas(texto) {
        const candidatos = Array.from(String(texto || '').matchAll(/["“]([^"”]{3,100})["”]/g));
        for (const m of candidatos) {
            if (PALAVRAS_EVENTO_NOME.some(p => NORM(m[1]).includes(NORM(p)))) return m[1].trim();
        }
        return '';
    }
    // Fallback de NOME DO EVENTO sem aspas — acha a palavra-chave (via NORM,
    // tolera caixa/acento) e captura dali até a primeira pontuação forte
    // (vírgula, ponto, aspas, quebra de linha) no texto ORIGINAL.
    //
    // IMPORTANTE — por que NÃO valida maiúscula palavra por palavra: nomes
    // de evento reais têm conectores minúsculos NO MEIO ("Trilha EM ALUSÃO
    // AO Festival de Inverno de Mar Vermelho" — "em", "alusão", "ao", "de"
    // são todos minúsculos e não são só 1 conector isolado) — tentar exigir
    // maiúscula em cada palavra (com ou sem /i) sempre erra pra um lado ou
    // outro: OU trunca cedo demais, OU (com /i) vaza frase inteira porque
    // [A-ZÀ-Ú] deixa de distinguir maiúscula de minúscula. Cortar só na
    // pontuação forte é mais robusto pra frases assim.
    function extrairNomeEventoPalavraChave(texto) {
        const tNorm = NORM(texto);
        for (const palavra of PALAVRAS_EVENTO_NOME) {
            // \b (fronteira de palavra) é ESSENCIAL aqui — sem ela, um
            // .indexOf() de substring casava "festa" dentro de "maniFESTA"
            // (manifesta), virando nome de evento a frase toda daquele
            // ponto em diante.
            const m = tNorm.match(new RegExp('\\b' + NORM(palavra) + '\\b'));
            if (!m) continue;
            const trecho = texto.slice(m.index).replace(/^\s+/, '');
            const mCaptura = trecho.match(/^[^,.;"“”\n]{3,80}/);
            if (mCaptura) return mCaptura[0].trim();
        }
        return '';
    }

    // ── Extração por "Rótulo: valor" (linha de formulário) ──────────────
    // Bem mais confiável que qualquer regex de prosa QUANDO o documento é
    // um formulário estruturado (rótulo seguido dos dois pontos e o valor
    // na mesma linha), como a "Autorização de Evento" de Palmeira dos
    // Índios ("Nome do Evento: Ressaca de São João", "Início: 19h" etc.).
    // Só aceita o rótulo se (a) ele estiver nos primeiros ~35 caracteres da
    // linha E (b) vier IMEDIATAMENTE seguido de dois-pontos — as duas
    // condições juntas distinguem uma linha de FORMULÁRIO ("Campo: valor")
    // de uma palavra em pleno meio de frase corrida. Só a posição não
    // bastava: "...pessoas, e a programação..." tem "estimativa de
    // público é de aproximadamente 800..." bem no início da frase (dentro
    // do limite de 35 caracteres), mas sem dois-pontos depois — é prosa,
    // não rótulo, e sem essa exigência o valor virava a frase inteira em
    // vez do número certo (que o extrairEstimativaPublico já acha sozinho).
    // Mesma lógica pra "...no município de Mar Vermelho/AL" (prosa, sem
    // dois-pontos) vs. um rótulo de verdade tipo "Cidade: Mar Vermelho".
    const ROTULOS_CAMPO = {
        nomeEvento: ['nome do evento'],
        cidade: ['cidade', 'municipio', 'município'],
        local: ['local do evento', 'espaco utilizado', 'espaço utilizado', 'local'],
        data: ['data'],
        horaInicio: ['horario de inicio', 'horário de início', 'inicio', 'início'],
        horaFim: ['horario de termino', 'horário de término', 'termino', 'término', 'encerramento'],
        estimativaPublico: ['estimativa de publico', 'estimativa de público', 'publico estimado', 'público estimado'],
        atracoes: ['atracoes', 'atrações'],
        organizacao: ['organizacao', 'organização'],
        nomeResponsavel: ['nome do responsavel', 'nome do responsável', 'responsavel', 'responsável'],
        cpf: ['cpf'],
        telefone: ['telefone', 'contato', 'fone', 'whatsapp'],
    };
    function extrairPorRotulos(texto) {
        const linhas = String(texto || '').split('\n');
        const resultado = {};
        Object.keys(ROTULOS_CAMPO).forEach(campo => {
            for (const linhaOriginal of linhas) {
                if (resultado[campo]) break; // já achou esse campo, não procura mais
                const linha = linhaOriginal.trim();
                // Linha vazia é comum entre campos (OCR de formulário insere
                // linha em branco separando cada um) — só PULA pra próxima,
                // não pode abortar a busca inteira (bug: era `break` aqui,
                // e a primeira linha em branco encontrada parava de procurar
                // TODOS os campos seguintes, mesmo os que apareciam depois).
                if (!linha) continue;
                const linhaNorm = NORM(linha);
                for (const sinonimo of ROTULOS_CAMPO[campo]) {
                    const sinNorm = NORM(sinonimo);
                    const idx = linhaNorm.indexOf(sinNorm);
                    if (idx === -1 || idx > 35) continue;
                    const apos = linha.slice(idx + sinonimo.length);
                    if (!/^\s*:/.test(apos)) continue; // sem ":" logo depois = prosa, não rótulo de formulário
                    const resto = apos.replace(/^\s*:\s*/, '').trim();
                    if (resto) { resultado[campo] = resto.slice(0, 120); break; }
                }
            }
        });
        return resultado;
    }

    // ── Extração semântica via IA local (campos de texto livre) ─────────
    // Prompt fechado — só JSON, "não invente" explícito, mesma doutrina
    // anti-alucinação do resto do Xerife (ver SYSTEM_PROMPT_XERIFE em
    // js/xerife.js). Se a IA local não estiver pronta ou falhar, os
    // campos voltam vazios — o usuário preenche na hora da confirmação,
    // o fluxo nunca trava por causa disso.
    const CAMPOS_SEMANTICOS_VAZIO = {
        nomeEvento: '', cidade: '', local: '', atracoes: '', organizacao: '', nomeResponsavel: '',
        data: '', horaInicio: '', horaFim: '', estimativaPublico: '',
    };
    // Pede TODOS os campos numa chamada só — documentos reais variam demais
    // em formato (prosa corrida, formulário "Campo: valor", maiúsculas,
    // sinônimos como "encerramento" no lugar de "término") pra regex sozinho
    // dar conta de tudo; a IA entende a língua natural muito melhor que
    // qualquer heurística escrita à mão. Os campos NUMÉRICOS/EXATOS (data,
    // horários, estimativa) continuam preferindo regex/rótulo no merge final
    // (ver analisarDocumento) — a IA aqui é só mais uma fonte, nunca a única
    // pros dígitos, porque um modelo de linguagem pode "lembrar" um número
    // errado (mesma cautela usada em todo o resto do Xerife: IA nunca
    // calcula/reproduz número exato sozinha, só ajuda a entender o texto).
    async function extrairCamposSemanticos(texto) {
        if (window.Xerife.obterEstadoIA() !== 'pronto') return { ...CAMPOS_SEMANTICOS_VAZIO };
        const prompt = 'Extraia do texto abaixo (obtido por OCR/leitura de um ofício oficial, pode ter erros de leitura) os seguintes campos: ' +
            'nome do evento, cidade onde ocorre, local/endereço do evento, atrações/atividades previstas, nome da organização responsável, nome da pessoa responsável, ' +
            'data do evento (formato DD/MM/AAAA), horário de início (HH:MM), horário de término (HH:MM), estimativa de público (só o número). ' +
            'Responda SOMENTE um JSON válido, sem nenhum texto antes ou depois, no formato exato: ' +
            '{"nomeEvento":"","cidade":"","local":"","atracoes":"","organizacao":"","nomeResponsavel":"","data":"","horaInicio":"","horaFim":"","estimativaPublico":""}. ' +
            'Se um campo não estiver claramente presente no texto, use uma string vazia "" — NUNCA invente um valor que não esteja no texto.';
        const mensagens = [
            { role: 'system', content: prompt },
            { role: 'user', content: texto.slice(0, 4000) },
        ];
        // 1 nova tentativa se a IA local não responder — GPUs locais (WebGPU)
        // às vezes engasgam numa chamada isolada (device hung/lost) mas se
        // recuperam na tentativa seguinte; se persistir, cai pro vazio normalmente.
        for (let tentativa = 0; tentativa < 2; tentativa++) {
            try {
                const resposta = await window.Xerife.gerarComIA(mensagens, { temperature: 0.1, max_tokens: 400 });
                if (!resposta) continue;
                const m = resposta.match(/\{[\s\S]*\}/);
                if (!m) continue;
                const obj = JSON.parse(m[0]);
                const campos = { ...CAMPOS_SEMANTICOS_VAZIO };
                Object.keys(campos).forEach(k => { campos[k] = String(obj[k] || '').trim(); });
                return campos;
            } catch (e) { /* tenta de novo (se ainda houver tentativa) ou cai pro vazio */ }
        }
        return { ...CAMPOS_SEMANTICOS_VAZIO };
    }

    // ── Formulário de confirmação (bolha do bot com campos editáveis) ───
    let contadorFormulario = 0;
    function montarFormularioConfirmacao(campos) {
        contadorFormulario++;
        const prefixo = 'xerdoc' + contadorFormulario;
        // escHtml() só trata & < > — texto de OCR/PDF é NÃO CONFIÁVEL e pode
        // conter aspas, o que quebraria pra fora do atributo value="..." (e
        // injetaria HTML/atributos arbitrários); por isso escapa aspas aqui
        // também, mesmo padrão já usado em js/gerarcartao.js (_renderizarTbody).
        const esc = valor => window.Xerife.escHtml(valor).replace(/"/g, '&quot;');
        const campo = (id, label, valor) =>
            `<label style="display:block;font-size:.72rem;margin:.35rem 0 .15rem;opacity:.75;">${label}</label>` +
            `<input type="text" id="${prefixo}-${id}" value="${esc(valor || '')}" style="width:100%;box-sizing:border-box;padding:.35rem .5rem;border:1px solid var(--p3-border,#e5e3dc);border-radius:6px;font-size:.82rem;background:var(--p3-bg,#fafaf8);color:inherit;">`;

        const html = `📄 <strong>Tipo do Documento:</strong> Ofício de Evento<br>` +
            `📝 <strong>Resumo extraído</strong> (confira e corrija antes de cadastrar):` +
            campo('nome', 'Nome do evento', campos.nomeEvento) +
            campo('cidade', 'Cidade', campos.cidade) +
            campo('local', 'Local do evento', campos.local) +
            campo('data', 'Data (DD/MM/AAAA)', campos.data) +
            campo('inicio', 'Horário de início', campos.horaInicio) +
            campo('fim', 'Horário de término', campos.horaFim) +
            campo('publico', 'Estimativa de público', campos.estimativaPublico) +
            campo('atracoes', 'Atrações', campos.atracoes) +
            campo('org', 'Organização', campos.organizacao) +
            campo('responsavel', 'Nome do responsável', campos.nomeResponsavel) +
            campo('cpf', 'CPF/CNPJ', campos.cpf) +
            campo('tel', 'Telefone', campos.telefone) +
            `<br>📍 <strong>Sugestão de destino:</strong> aba Eventos<br><br>` +
            `<div style="font-size:.78rem;margin-bottom:.4rem;">Deseja cadastrar estas informações agora?</div>` +
            `<div style="display:flex;gap:.5rem;">` +
            `<button type="button" id="${prefixo}-sim" style="flex:1;background:#166534;color:#fff;border:none;border-radius:6px;padding:.45rem;cursor:pointer;font-weight:600;">✅ Cadastrar</button>` +
            `<button type="button" id="${prefixo}-nao" style="flex:1;background:#991b1b;color:#fff;border:none;border-radius:6px;padding:.45rem;cursor:pointer;font-weight:600;">❌ Descartar</button>` +
            `</div>`;
        return { html, prefixo };
    }

    // Lê os valores (possivelmente corrigidos pelo usuário) direto dos
    // inputs do formulário — nunca reusa os campos originais da extração,
    // pra respeitar qualquer correção manual antes do clique em "Cadastrar".
    function lerCamposDoFormulario(prefixo) {
        const v = id => { const el = document.getElementById(`${prefixo}-${id}`); return el ? el.value.trim() : ''; };
        return {
            nomeEvento: v('nome'), cidade: v('cidade'), local: v('local'), data: v('data'),
            horaInicio: v('inicio'), horaFim: v('fim'), estimativaPublico: v('publico'),
            atracoes: v('atracoes'), organizacao: v('org'), nomeResponsavel: v('responsavel'),
            cpf: v('cpf'), telefone: v('tel'),
        };
    }

    // ── Cadastro no GAS de Eventos — MESMO endpoint/campos/método de
    // page/eventos.html:971-984 (action=create, POST x-www-form-urlencoded).
    // GUARNICOES/VIATURAS nunca são preenchidos aqui — são decisão
    // operacional do batalhão, não vêm do ofício do organizador. ─────────
    async function cadastrarEvento(campos) {
        const cfg = await P3.loadUnidadeConfig();
        const urlEventos = cfg.gas && cfg.gas.EVENTOS;
        if (!urlEventos) throw new Error('Essa unidade não tem o GAS de Eventos configurado.');

        const observacoes = campos.atracoes ? `Atrações: ${campos.atracoes}` : '';
        const payload = {
            action: 'create',
            'PROTOCOLO': campos.protocolo || '',
            'DATA': campos.data || '',
            'CIDADE': campos.cidade || '',
            'NOME DO EVENTO': campos.nomeEvento || '',
            'LOCAL DO EVENTO': campos.local || '',
            'HORÁRIO DE INÍCIO': campos.horaInicio || '',
            'HORÁRIO DE TÉRMINO': campos.horaFim || '',
            'ESTIMATIVA DE PÚBLICO': campos.estimativaPublico || '',
            'ORGANIZAÇÃO': campos.organizacao || '',
            'NOME DO RESPONSÁVEL': campos.nomeResponsavel || '',
            'CPF': campos.cpf || '',
            'TELEFONE': campos.telefone || '',
            'GUARNICOES': '',
            'VIATURAS': '',
            'OBSERVACOES': observacoes,
        };
        const res = await fetch(urlEventos, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(payload),
        });
        if (!res.ok) throw new Error('GAS respondeu ' + res.status);
        return true;
    }

    function ligarBotoesConfirmacao(containerEl, prefixo, campos) {
        const btSim = containerEl.querySelector(`#${prefixo}-sim`);
        const btNao = containerEl.querySelector(`#${prefixo}-nao`);
        if (btNao) btNao.addEventListener('click', () => {
            containerEl.innerHTML = 'Ok, descartei essa análise — nada foi cadastrado.';
        });
        if (btSim) btSim.addEventListener('click', async () => {
            const finais = lerCamposDoFormulario(prefixo);
            finais.protocolo = campos.protocolo || '';
            btSim.disabled = true; btNao.disabled = true;
            btSim.textContent = 'Cadastrando…';
            try {
                await cadastrarEvento(finais);
                containerEl.innerHTML = `✅ Evento "<strong>${window.Xerife.escHtml(finais.nomeEvento || 'sem nome')}</strong>" cadastrado com sucesso na aba Eventos!`;
            } catch (e) {
                console.error('Xerife documentos: erro ao cadastrar evento', e);
                containerEl.innerHTML = '⚠️ Não consegui cadastrar agora — tente de novo ou cadastre manualmente em Eventos.' +
                    '<br><br><button type="button" id="' + prefixo + '-retry" style="background:#166534;color:#fff;border:none;border-radius:6px;padding:.4rem .8rem;cursor:pointer;">Tentar de novo</button>';
                const btRetry = containerEl.querySelector(`#${prefixo}-retry`);
                if (btRetry) btRetry.addEventListener('click', async () => {
                    btRetry.disabled = true; btRetry.textContent = 'Cadastrando…';
                    try {
                        await cadastrarEvento(finais);
                        containerEl.innerHTML = `✅ Evento "<strong>${window.Xerife.escHtml(finais.nomeEvento || 'sem nome')}</strong>" cadastrado com sucesso na aba Eventos!`;
                    } catch (e2) {
                        containerEl.innerHTML = '⚠️ Continuou falhando — cadastre manualmente em Eventos, por favor.';
                    }
                });
            }
        });
    }

    // ── Ponto de entrada público ─────────────────────────────────────────
    async function analisarDocumento(file) {
        await aguardarXerife();
        window.Xerife.adicionarMensagem('user', `📎 ${window.Xerife.escHtml(file.name)}`);
        const bolha = window.Xerife.adicionarMensagem('bot', '<span style="opacity:.6;">🔎 Lendo o documento…</span>');

        let texto;
        try {
            texto = await extrairTextoDeArquivo(file, msg => { bolha.innerHTML = `<span style="opacity:.6;">${msg}</span>`; });
        } catch (e) {
            bolha.innerHTML = '⚠️ ' + window.Xerife.escHtml(e.message || 'Não consegui ler esse arquivo — tente novamente ou confira se não está corrompido.');
            return;
        }

        if (!classificarOficioEvento(texto)) {
            bolha.innerHTML = '🤔 Não consegui identificar isso como um ofício de evento — por enquanto só sei cadastrar <strong>Eventos</strong> automaticamente a partir de documento. Você pode preencher manualmente na página de Eventos.';
            return;
        }

        bolha.innerHTML = '<span style="opacity:.6;">🧠 Documento identificado como ofício de evento — extraindo os campos…</span>';

        const horas = extrairHoras(texto);
        const rotulos = extrairPorRotulos(texto);
        let semanticos;
        try { semanticos = await extrairCamposSemanticos(texto); }
        catch (e) { semanticos = { ...CAMPOS_SEMANTICOS_VAZIO }; }

        // Primeiro valor não-vazio da lista vence.
        const primeiro = (...vals) => { for (const v of vals) { if (v && String(v).trim()) return String(v).trim(); } return ''; };

        // Documentos reais variam MUITO de formato (prosa corrida, "Campo:
        // valor" tipo formulário, sinônimos diferentes) — por isso 3 fontes
        // são combinadas, com prioridade diferente conforme o tipo de campo:
        //
        // Campos de TEXTO LIVRE (nome, cidade, atrações...): a IA local vence
        // quando disponível — entende variação de linguagem natural muito
        // melhor que qualquer regex escrita à mão; rótulo explícito
        // ("Nome do Evento: X") e regex de prosa ("Trilha do Cajá") são o
        // fallback, nessa ordem, quando a IA não respondeu.
        //
        // Campos NUMÉRICOS/EXATOS (CPF, telefone, data, horários,
        // estimativa): rótulo explícito primeiro (mais confiável que
        // qualquer heurística quando existe), depois regex de prosa
        // (determinístico, sempre confere), e a IA só entra por ÚLTIMO —
        // um modelo de linguagem não deve ser a fonte de um dígito exato,
        // mesma cautela já aplicada em todo o resto do Xerife.
        const cidade = primeiro(semanticos.cidade, rotulos.cidade, extrairCidadeDateline(texto), extrairCidadePrefeitura(texto));
        const campos = {
            nomeEvento: primeiro(semanticos.nomeEvento, rotulos.nomeEvento, extrairNomeEventoEntreAspas(texto), extrairNomeEventoPalavraChave(texto)),
            cidade: cidade,
            local: primeiro(semanticos.local, rotulos.local, cidade),
            atracoes: primeiro(semanticos.atracoes, rotulos.atracoes),
            organizacao: primeiro(semanticos.organizacao, rotulos.organizacao),
            nomeResponsavel: primeiro(semanticos.nomeResponsavel, rotulos.nomeResponsavel, semanticos.organizacao),

            data: primeiro(rotulos.data && extrairData(rotulos.data), rotulos.data, extrairData(texto), semanticos.data),
            horaInicio: primeiro(rotulos.horaInicio && extrairUmaHora(rotulos.horaInicio), rotulos.horaInicio, horas.inicio, semanticos.horaInicio),
            horaFim: primeiro(rotulos.horaFim && extrairUmaHora(rotulos.horaFim), rotulos.horaFim, horas.fim, semanticos.horaFim),
            estimativaPublico: primeiro(rotulos.estimativaPublico && extrairEstimativaPublico(rotulos.estimativaPublico), rotulos.estimativaPublico, extrairEstimativaPublico(texto), semanticos.estimativaPublico),
            cpf: primeiro(rotulos.cpf && extrairCPF(rotulos.cpf), rotulos.cpf, extrairCPF(texto)),
            telefone: primeiro(rotulos.telefone && extrairTelefone(rotulos.telefone), rotulos.telefone, extrairTelefone(texto)),
            protocolo: extrairProtocolo(texto),
        };

        const { html, prefixo } = montarFormularioConfirmacao(campos);
        bolha.innerHTML = html;
        ligarBotoesConfirmacao(bolha, prefixo, campos);
    }

    aguardarXerife().then(() => { window.Xerife.analisarDocumento = analisarDocumento; })
        .catch(e => console.error('Xerife documentos: não consegui me conectar ao Xerife principal.', e));
})();
