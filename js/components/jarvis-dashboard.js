// ════════════════════════════════════════════════════════════════════
// JARVIS DASHBOARD — controlador (page/jarvis.html)
//
// Orquestra: voz (STT/TTS), a esfera de partículas (particle-sphere.js)
// e os widgets do painel. NUNCA calcula nenhum número por conta própria —
// toda resposta de texto vem de window.Xerife.responderTexto() (o MESMO
// motor determinístico do chat normal, com as mesmas regras de negócio:
// MVI, cruzamento TCO×Sentenças×Guarnição etc.) e todo widget numérico
// vem de window.Xerife.obterKPIs()/obterRankingTCO()/obterHotspots()/
// obterVisitasSugeridas() — funções que reaproveitam a mesma fonte de
// dados/regra, só devolvendo objeto em vez de HTML (ver js/xerife.js).
//
// Este arquivo só entende INTENÇÃO o suficiente pra decidir quais
// widgets extras popular (heurística simples, best-effort) — a RESPOSTA
// em si (texto/voz) nunca depende dessa heurística acertar: ela sempre
// vem de responderTexto(), então na pior hipótese um widget não aparece,
// nunca um número errado aparece.
// ════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const $ = sel => document.querySelector(sel);

    let esfera = null;
    let muteAtivo = false;
    let wakeAtivo = false;
    let ouvindoAgora = false;
    let reconhecimentoContinuo = null;
    let reconhecimentoAtivo = null;
    let audioCtx = null, analiser = null, streamMic = null, rafAudio = null;
    let audioCtxFala = null, analiserFala = null, rafFala = null, audioFalaAtual = null;
    let vitsPromise = null, vitsFalhou = false;
    let vozesPt = [];
    let promessaLeaflet = null;
    let promessaJsPDF = null;
    let apresentacaoAtiva = false; // true enquanto o modo apresentação narrada está tocando
    let apresentacaoPopupAtiva = false; // true quando a apresentação atual está no modo "popup" (ver abrirApresentacaoOverlay)
    let mapaTaticoAtivo = null; // instância Leaflet aberta no momento (pra dar .remove() ao fechar)
    // Incrementado toda vez que #jv-overlay abre uma NOVA sessão (ver
    // abrirOverlay) — os fluxos de escolha assíncronos (relatório de
    // cidade/categoria: "Montando…" → fetch pesado → escreve o resultado
    // em #jv-overlay-corpo) capturam o valor no início e conferem no fim
    // antes de escrever; se um comando mais novo já abriu outra coisa no
    // meio do caminho (ex.: usuário ficou impaciente e pediu pra abrir
    // outra página enquanto o relatório ainda buscava dados), a resposta
    // atrasada não sobrescreve mais o conteúdo do overlay mais novo — bug
    // real encontrado testando (uma apresentação lenta acabava apagando um
    // iframe que já tinha sido aberto depois dela).
    let _geracaoOverlay = 0;
    let _timeoutFecharOverlay = null; // pendência do fecharOverlay() (ver comentário lá) — cancelada se reabrir antes de completar

    // Normaliza texto (sem acento, minúsculo) — mesmo critério usado em
    // toda comparação de intenção/cidade aqui neste arquivo.
    function normalizarTexto(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

    // ── Boot ─────────────────────────────────────────────────────────
    function aguardarXerife() {
        return new Promise(resolve => {
            const tentar = () => {
                if (window.Xerife && window.Xerife.responderTexto) return resolve();
                setTimeout(tentar, 120);
            };
            tentar();
        });
    }

    async function iniciar() {
        // Esfera primeiro (local, sem rede — rápido) porque a saudação por
        // voz já referencia ela (onboundary faz a esfera pulsar durante a
        // fala nativa).
        esfera = new ParticleSphere($('#jv-canvas'), { quantidade: 900 });
        esfera.start();
        esfera.setEstado('idle');

        // SAUDAÇÃO IMEDIATA — de propósito ANTES de aguardarXerife() (o
        // motor completo do Xerife, 3300+ linhas) e de carregarKPIsIniciais()
        // (fetch no Firebase): a saudação só precisa da sessão
        // (P3.getSession(), já carregada por js/core/session.js antes deste
        // script rodar), nada disso. Usa falar() — MESMA voz neural das
        // demais respostas (pedido explícito: consistência > velocidade
        // aqui) — em vez de forçar falarNativo(). carregarVits() já foi
        // disparado no topo do arquivo, então o modelo já vem baixando
        // desde antes da esfera/sessão carregarem; se ainda não estiver
        // pronto a tempo, falar() já cai sozinho no nativo (ver função).
        const identificacao = obterIdentificacaoUsuario();
        const saudacao = `Olá, ${identificacao}. Eu sou o Xerife, o assistente virtual da unidade. O que podemos analisar hoje?`;
        renderConsoleLinha('🤠 ' + saudacao, 'bot', false);
        falar(saudacao);

        await aguardarXerife();

        configurarRelogio();
        configurarMute();
        configurarFormulario();
        configurarVoz();
        configurarOverlay();

        carregarKPIsIniciais();
    }

    // Reaproveitado pela saudação e pela fala de "não entendi".
    function obterIdentificacaoUsuario() {
        const sessao = window.P3 && window.P3.getSession && window.P3.getSession();
        if (!sessao) return 'colega';
        return [sessao.graduacao, sessao.nomeGuerra].filter(Boolean).join(' ') || 'colega';
    }

    function configurarRelogio() {
        const el = $('#jv-relogio');
        if (!el) return;
        const atualizar = () => {
            const agora = new Date();
            el.textContent = agora.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }) + ' · ' + agora.toLocaleTimeString('pt-BR');
        };
        atualizar();
        setInterval(atualizar, 1000);
    }

    async function carregarKPIsIniciais() {
        try { renderKPIs(await window.Xerife.obterKPIs('')); } catch (e) { /* silencioso — dashboard segue funcional sem KPI inicial */ }
    }

    // ── Estado visual (pill + esfera) ───────────────────────────────
    function setEstado(estado) {
        esfera.setEstado(estado);
        const pill = $('#jv-status-pill');
        if (!pill) return;
        pill.dataset.estado = estado;
        const rotulos = { idle: 'Em espera', listening: 'Ouvindo…', thinking: 'Processando…', speaking: 'Falando…', off: 'Voz desligada' };
        pill.querySelector('.jv-status-txt').textContent = rotulos[estado] || estado;
    }

    // ── Mute ─────────────────────────────────────────────────────────
    function configurarMute() {
        const btn = $('#jv-mute-btn');
        if (!btn) return;
        btn.addEventListener('click', () => {
            muteAtivo = !muteAtivo;
            btn.classList.toggle('jv-mudo', muteAtivo);
            btn.textContent = muteAtivo ? '🔇' : '🔊';
            btn.title = muteAtivo ? 'Ativar voz' : 'Silenciar voz';
            if (muteAtivo && window.speechSynthesis) window.speechSynthesis.cancel();
        });
    }

    // ── Texto (fallback sempre disponível) ──────────────────────────
    function configurarFormulario() {
        const form = $('#jv-form');
        const input = $('#jv-input');
        if (!form || !input) return;
        form.addEventListener('submit', e => {
            e.preventDefault();
            const texto = input.value.trim();
            if (!texto) return;
            input.value = '';
            processarPerguntaSegura(texto);
        });
    }

    // processarPergunta() não tinha nenhum try/catch envolvendo o corpo
    // todo — um erro em qualquer fluxo especial (ex.: split-view, um bug
    // novo) virava uma promise rejeitada sem tratamento nas 3 chamadas
    // (form de texto, escuta manual, escuta contínua), sem NENHUM feedback
    // visível pro usuário (ficava "pensando" pra sempre) e só um log
    // discreto no console. Esse wrapper garante: sempre loga no console
    // (debugável) E sempre volta uma resposta visível + estado idle.
    function processarPerguntaSegura(texto) {
        processarPergunta(texto).catch(e => {
            console.error('[Xerife] erro ao processar pergunta:', e);
            renderConsoleLinha('⚠️ Deu um problema ao processar. Tenta de novo?', 'bot', false);
            falar('Deu um problema aqui. Tenta de novo?');
            setEstado('idle');
        });
    }

    // ── Reconhecimento de voz (STT) ─────────────────────────────────
    function ReconhecimentoAPI() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }

    function configurarVoz() {
        const Rec = ReconhecimentoAPI();
        const btnMic = $('#jv-mic-btn');
        const avisoSemVoz = $('#jv-sem-voz');
        const btnWake = $('#jv-wake-toggle');

        if (!Rec) {
            if (avisoSemVoz) avisoSemVoz.style.display = 'block';
            if (btnMic) btnMic.disabled = true;
            if (btnWake) btnWake.disabled = true;
            return;
        }

        if (btnMic) {
            btnMic.addEventListener('click', () => {
                if (ouvindoAgora) { pararEscutaManual(); return; }
                iniciarEscutaManual(Rec);
            });
        }
        if (btnWake) {
            btnWake.addEventListener('click', () => {
                wakeAtivo = !wakeAtivo;
                btnWake.classList.toggle('jv-ativo', wakeAtivo);
                btnWake.textContent = wakeAtivo ? '👂 Sempre ouvindo (ligado)' : '👂 Sempre ouvindo (desligado)';
                if (wakeAtivo) iniciarEscutaContinua(Rec); else pararEscutaContinua();
            });
        }
    }

    // Trava conhecida da Web Speech API (Chrome): de vez em quando a sessão
    // simplesmente MORRE em silêncio — nem onresult, nem onerror, nem onend
    // disparam, o mic fica "ouvindo" pra sempre sem log nenhum no console
    // (é isso, não uma exceção — exceção apareceria no console). Um
    // watchdog é a única forma de detectar essa trava e recuperar a UI.
    const TIMEOUT_ESCUTA_MS = 9000;

    // Escuta manual (push-to-talk): 1 pergunta por clique.
    function iniciarEscutaManual(Rec) {
        // Cancela qualquer fala em andamento antes de escutar — evita o
        // Xerife "ouvir a própria voz" (eco/vazamento de áudio do
        // alto-falante pro microfone), que pode atrapalhar o
        // reconhecimento de um comando curto tipo "voltar"/"fechar".
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        // NUNCA 2 reconhecimentos ativos ao mesmo tempo — só existe 1
        // microfone, e ter a escuta contínua (palavra de ativação) e o
        // push-to-talk brigando pelo mic ao mesmo tempo é uma causa real
        // de "começa a ouvir e para na hora" (a sessão nova falha ao
        // iniciar porque a outra já está usando o mic, ou vice-versa).
        pararEscutaContinua();
        try {
            reconhecimentoAtivo = new Rec();
            reconhecimentoAtivo.lang = 'pt-BR';
            // continuous:true (não false) — só encerra a sessão
            // explicitamente por aqui (watchdog/resultado final/erro),
            // nunca sozinho por causa de uma pausa natural no meio da
            // frase (com continuous:false o Chrome corta a escuta cedo
            // demais nesses casos — é o "começa a ouvir e para").
            reconhecimentoAtivo.continuous = true;
            reconhecimentoAtivo.interimResults = true;
            let watchdog = null;
            const zerarWatchdog = () => {
                if (watchdog) clearTimeout(watchdog);
                watchdog = setTimeout(() => {
                    try { reconhecimentoAtivo && reconhecimentoAtivo.abort(); } catch (e) { /* já parado */ }
                    pararEscutaManual();
                }, TIMEOUT_ESCUTA_MS);
            };
            reconhecimentoAtivo.onstart = () => { ouvindoAgora = true; $('#jv-mic-btn')?.classList.add('jv-ativo'); setEstado('listening'); iniciarAnaliseAudio(); mostrarTranscricao('', true); zerarWatchdog(); };
            reconhecimentoAtivo.onresult = ev => {
                zerarWatchdog(); // ainda tem atividade real — renova o prazo, não é trava
                let texto = '';
                for (let i = 0; i < ev.results.length; i++) texto += ev.results[i][0].transcript;
                const final = ev.results[ev.results.length - 1].isFinal;
                mostrarTranscricao(texto, !final);
                if (final && texto.trim()) {
                    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
                    const pergunta = texto.trim();
                    mostrarTranscricao('', false); // limpa o campo, igual ao envio por texto digitado
                    try { reconhecimentoAtivo && reconhecimentoAtivo.stop(); } catch (e) { /* já parado */ }
                    processarPerguntaSegura(pergunta);
                }
            };
            reconhecimentoAtivo.onerror = () => { if (watchdog) clearTimeout(watchdog); pararEscutaManual(); };
            reconhecimentoAtivo.onend = () => { if (watchdog) clearTimeout(watchdog); pararEscutaManual(); };
            reconhecimentoAtivo.start();
        } catch (e) { pararEscutaManual(); }
    }
    function pararEscutaManual() {
        ouvindoAgora = false;
        $('#jv-mic-btn')?.classList.remove('jv-ativo');
        pararAnaliseAudio();
        if (esfera.estado === 'listening') setEstado('idle');
        try { reconhecimentoAtivo && reconhecimentoAtivo.stop(); } catch (e) { /* já parado */ }
        reconhecimentoAtivo = null;
    }

    // Escuta contínua (palavra de ativação "Xerife"/"Jarvis") — opcional,
    // desligada por padrão (só liga com clique explícito, respeita
    // privacidade: não pede microfone sem ação do usuário).
    const PALAVRAS_ATIVACAO = ['xerife', 'jarvis'];
    // Renovação periódica DEFENSIVA da escuta contínua — a mesma trava
    // silenciosa da Web Speech API (nem onresult, nem onend, nem onerror
    // disparam, sessão morre sem aviso — já vista e corrigida no
    // push-to-talk via watchdog) também acontece no modo contínuo, mas
    // aqui não dá pra usar "sem atividade = travado": silêncio prolongado
    // é NORMAL nesse modo (ninguém fica repetindo "Xerife" sem parar,
    // ainda mais com uma página aberta dentro do overlay ocupando a
    // atenção — cenário relatado pelo usuário). Em vez de detectar a
    // trava, reconstrói a sessão inteira a cada 25s, travada ou não —
    // reiniciar uma sessão que já estava funcionando não tem custo
    // perceptível (a permissão de mic já concedida não é pedida de novo).
    const INTERVALO_RENOVAR_ESCUTA_CONTINUA_MS = 25000;
    let timerRenovarEscutaContinua = null;
    function iniciarEscutaContinua(Rec) {
        // Mesma exclusão mútua do lado do push-to-talk (ver
        // iniciarEscutaManual) — nunca os 2 reconhecimentos ativos juntos.
        pararEscutaManual();
        if (timerRenovarEscutaContinua) { clearInterval(timerRenovarEscutaContinua); timerRenovarEscutaContinua = null; }
        try {
            reconhecimentoContinuo = new Rec();
            reconhecimentoContinuo.lang = 'pt-BR';
            reconhecimentoContinuo.continuous = true;
            reconhecimentoContinuo.interimResults = true;
            reconhecimentoContinuo.onresult = ev => {
                const ultimo = ev.results[ev.results.length - 1];
                const texto = ultimo[0].transcript;
                const textoNorm = texto.toLowerCase();
                const palavraAchada = PALAVRAS_ATIVACAO.find(p => textoNorm.includes(p));
                if (!palavraAchada) return;
                if (!ultimo.isFinal) { setEstado('listening'); return; }
                const resto = texto.slice(textoNorm.indexOf(palavraAchada) + palavraAchada.length).trim();
                if (resto) { mostrarTranscricao('', false); processarPerguntaSegura(resto); }
                else { setEstado('idle'); mostrarTranscricao('', false); }
            };
            reconhecimentoContinuo.onend = () => { if (wakeAtivo) { try { reconhecimentoContinuo.start(); } catch (e) { /* evita loop de erro */ } } };
            reconhecimentoContinuo.onerror = () => { /* segue tentando via onend */ };
            reconhecimentoContinuo.start();
            timerRenovarEscutaContinua = setInterval(() => {
                if (!wakeAtivo) { clearInterval(timerRenovarEscutaContinua); timerRenovarEscutaContinua = null; return; }
                try { reconhecimentoContinuo && reconhecimentoContinuo.stop(); } catch (e) { /* já parado ou travado — tudo bem, reconstrói do zero abaixo */ }
                reconhecimentoContinuo = null;
                iniciarEscutaContinua(Rec);
            }, INTERVALO_RENOVAR_ESCUTA_CONTINUA_MS);
        } catch (e) { wakeAtivo = false; }
    }
    function pararEscutaContinua() {
        if (timerRenovarEscutaContinua) { clearInterval(timerRenovarEscutaContinua); timerRenovarEscutaContinua = null; }
        try { reconhecimentoContinuo && reconhecimentoContinuo.stop(); } catch (e) { /* já parado */ }
        reconhecimentoContinuo = null;
        if (esfera.estado === 'listening') setEstado('idle');
    }

    // O texto reconhecido por voz aparece DIRETO no campo de digitar
    // (#jv-input) — como se o usuário estivesse escrevendo, em vez de um
    // rótulo à parte acima da barra (que ficava confuso, colado no lugar
    // errado). provisorio=true só deixa mais apagado enquanto o
    // reconhecimento ainda não é final (não mexe no cursor/foco).
    function mostrarTranscricao(texto, provisorio) {
        const input = $('#jv-input');
        if (!input) return;
        input.value = texto || '';
        input.style.opacity = provisorio ? '.65' : '1';
    }

    // Amplitude REAL do microfone (Web Audio API) — alimenta a esfera
    // durante a escuta. Roda em paralelo ao SpeechRecognition (que não
    // expõe o stream de áudio diretamente).
    async function iniciarAnaliseAudio() {
        try {
            streamMic = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const fonte = audioCtx.createMediaStreamSource(streamMic);
            analiser = audioCtx.createAnalyser();
            analiser.fftSize = 256;
            fonte.connect(analiser);
            const buffer = new Uint8Array(analiser.frequencyBinCount);
            const loop = () => {
                if (!analiser) return;
                analiser.getByteFrequencyData(buffer);
                const media = buffer.reduce((a, b) => a + b, 0) / buffer.length;
                esfera.setAudioLevel(media / 140); // normaliza pra ~0..1
                rafAudio = requestAnimationFrame(loop);
            };
            loop();
        } catch (e) { /* sem permissão de mic — a esfera só não reage à amplitude real, escuta continua via SpeechRecognition */ }
    }
    function pararAnaliseAudio() {
        if (rafAudio) cancelAnimationFrame(rafAudio);
        rafAudio = null;
        esfera.setAudioLevel(0);
        if (streamMic) streamMic.getTracks().forEach(t => t.stop());
        streamMic = null;
        if (audioCtx) audioCtx.close().catch(() => { });
        audioCtx = null; analiser = null;
    }

    // ── Síntese de voz (TTS) ─────────────────────────────────────────
    // A API não expõe "qualidade" da voz, só nome/idioma/se é local ou de
    // rede — então usa uma heurística: vozes de REDE (Google/Microsoft
    // Online, ex.: "Google português do Brasil") costumam soar bem menos
    // robóticas que a voz local instalada no sistema operacional, então
    // ganham prioridade aqui. Sem custo/API key — ainda é o Web Speech API
    // nativo do navegador, só escolhendo melhor entre as vozes que já
    // existem nele.
    if ('speechSynthesis' in window) {
        const pontuarVoz = v => {
            let pontos = 0;
            if (!v.localService) pontos += 10;
            if (/google/i.test(v.name)) pontos += 6;
            if (/natural|online|neural/i.test(v.name)) pontos += 5;
            if (/^pt-BR/i.test(v.lang)) pontos += 3;
            return pontos;
        };
        const carregarVozes = () => {
            vozesPt = window.speechSynthesis.getVoices()
                .filter(v => /pt(-|_)?BR/i.test(v.lang) || /pt/i.test(v.lang))
                .sort((a, b) => pontuarVoz(b) - pontuarVoz(a));
        };
        carregarVozes();
        window.speechSynthesis.onvoiceschanged = carregarVozes;
    }
    // Remove emojis/símbolos pictográficos antes de mandar pra síntese de
    // voz — sem isso o navegador tenta "pronunciar" cada ícone (📋, 🗺️,
    // ✓, →...), que fica estranho falado. O console continua mostrando
    // os ícones normalmente — isso só filtra o texto que vai pro TTS.
    function removerEmojisParaFala(texto) {
        return String(texto || '')
            .replace(/[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}\u{FE0F}\u{200D}]/gu, '')
            .replace(/[ \t]{2,}/g, ' ')
            .replace(/\n{2,}/g, '\n')
            .trim();
    }
    // ── TTS neural (voz mais fluida) ────────────────────────────────
    // @diffusionstudio/vits-web roda um modelo Piper (voz pt-BR) via
    // WASM/ONNX Runtime direto no navegador — mesma filosofia de IA local
    // já usada no WebLLM do Xerife, sem custo/API key. Soa bem menos
    // robótica que o Web Speech API nativo, mas tem latência real por
    // frase (testado: ~14s na 1ª vez, quando baixa o modelo ~60MB, e
    // ~3s nas seguintes, já em cache). Por isso: começa a carregar em
    // segundo plano assim que a página abre (pra já estar pronta quando a
    // 1ª resposta chegar) e SEMPRE cai pro speechSynthesis nativo
    // (falarNativo) se o import/predict falhar ou demorar demais — nunca
    // deixa o Xerife mudo por causa da voz neural.
    const VOZ_NEURAL = 'pt_BR-faber-medium';
    function carregarVits() {
        if (!vitsPromise) {
            vitsPromise = import('https://cdn.jsdelivr.net/npm/@diffusionstudio/vits-web/+esm')
                .catch(e => { vitsFalhou = true; throw e; });
        }
        return vitsPromise;
    }
    carregarVits().catch(() => { /* fica no fallback nativo, silenciosamente */ });

    // Amplitude REAL do áudio da fala neural (Web Audio API) — mesmo
    // princípio de iniciarAnaliseAudio() acima, mas ligado na REPRODUÇÃO
    // (createMediaElementSource) em vez do microfone. Precisa reconectar
    // ao destination, senão o áudio fica mudo (createMediaElementSource
    // desvia o som pro grafo do Web Audio).
    function ligarAnaliseAudioFala(audioEl) {
        try {
            audioCtxFala = new (window.AudioContext || window.webkitAudioContext)();
            const fonte = audioCtxFala.createMediaElementSource(audioEl);
            analiserFala = audioCtxFala.createAnalyser();
            analiserFala.fftSize = 256;
            fonte.connect(analiserFala);
            analiserFala.connect(audioCtxFala.destination);
            const buffer = new Uint8Array(analiserFala.frequencyBinCount);
            const loop = () => {
                if (!analiserFala) return;
                analiserFala.getByteFrequencyData(buffer);
                const media = buffer.reduce((a, b) => a + b, 0) / buffer.length;
                esfera.setAudioLevel(media / 140);
                rafFala = requestAnimationFrame(loop);
            };
            loop();
        } catch (e) { /* sem suporte a Web Audio — a esfera só não pulsa em tempo real */ }
    }
    function pararAnaliseAudioFala() {
        if (rafFala) cancelAnimationFrame(rafFala);
        rafFala = null;
        esfera.setAudioLevel(0);
        if (audioCtxFala) audioCtxFala.close().catch(() => { });
        audioCtxFala = null; analiserFala = null;
    }

    // Textos muito longos (relatórios/apresentações) demorariam demais pra
    // GERAR na voz neural antes mesmo de começar a falar — nesses casos
    // vale mais a pena começar a falar na hora com a voz nativa do que
    // deixar a esfera "pensando" em silêncio por vários segundos.
    const LIMITE_CARACTERES_VOZ_NEURAL = 400;

    function falarNeural(textoFala, onFim) {
        return new Promise((resolve, reject) => {
            let liquidado = false;
            const tempo = setTimeout(() => {
                if (liquidado) return;
                liquidado = true;
                reject(new Error('tempo esgotado na voz neural'));
            }, 12000);
            (async () => {
                try {
                    const tts = await carregarVits();
                    const wav = await tts.predict({ text: textoFala, voiceId: VOZ_NEURAL });
                    if (liquidado) return; // já caiu no timeout/fallback nativo
                    clearTimeout(tempo);
                    liquidado = true;
                    const audio = new Audio(URL.createObjectURL(wav));
                    audioFalaAtual = audio;
                    ligarAnaliseAudioFala(audio);
                    setEstado('speaking');
                    audio.onended = () => { pararAnaliseAudioFala(); setEstado('idle'); audioFalaAtual = null; if (onFim) onFim(); resolve(); };
                    audio.onerror = () => { pararAnaliseAudioFala(); audioFalaAtual = null; reject(new Error('erro ao reproduzir áudio')); };
                    await audio.play();
                } catch (e) {
                    if (!liquidado) { liquidado = true; clearTimeout(tempo); reject(e); }
                }
            })();
        });
    }

    function falarNativo(textoFala, onFim) {
        if (!('speechSynthesis' in window)) {
            setEstado('idle');
            if (onFim) setTimeout(onFim, 1800);
            return;
        }
        try {
            window.speechSynthesis.cancel();
            const utter = new SpeechSynthesisUtterance(textoFala);
            utter.lang = 'pt-BR';
            if (vozesPt.length) utter.voice = vozesPt[0];
            // rate/pitch mais próximos do natural (1.0/1.0) — o pitch
            // rebaixado de antes (0.92) deixava a voz com um timbre mais
            // grave/artificial; um pouco mais devagar que o padrão ajuda
            // na clareza sem soar arrastado.
            utter.rate = 0.98;
            utter.pitch = 1.0;
            utter.onstart = () => setEstado('speaking');
            // "boundary" dispara por palavra/sentença — é a aproximação
            // possível de sincronizar a esfera com a fala (ver comentário
            // em particle-sphere.js: o navegador não expõe a onda sonora
            // real da síntese pra um AnalyserNode).
            utter.onboundary = () => esfera.pulse(1);
            utter.onend = () => { setEstado('idle'); if (onFim) onFim(); };
            utter.onerror = () => { setEstado('idle'); if (onFim) onFim(); };
            window.speechSynthesis.speak(utter);
        } catch (e) { setEstado('idle'); if (onFim) onFim(); }
    }

    // onFim: callback opcional, chamado quando a fala termina (usado pela
    // apresentação narrada pra avançar sozinha pro próximo slide) — SEMPRE
    // é chamado eventualmente, mesmo mudo/sem suporte a voz (assíncrono),
    // senão a apresentação travaria no slide com o som desligado.
    function falar(textoPlano, onFim) {
        const textoFala = removerEmojisParaFala(textoPlano);
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        if (audioFalaAtual) { try { audioFalaAtual.pause(); } catch (e) { /* já parado */ } pararAnaliseAudioFala(); audioFalaAtual = null; }
        if (muteAtivo || !textoFala) {
            setEstado('idle');
            if (onFim) setTimeout(onFim, 1800); // dá tempo de ler o slide mesmo sem narração
            return;
        }
        if (vitsFalhou || textoFala.length > LIMITE_CARACTERES_VOZ_NEURAL) {
            falarNativo(textoFala, onFim);
            return;
        }
        falarNeural(textoFala, onFim).catch(() => falarNativo(textoFala, onFim));
    }

    // ── Console com efeito typewriter ───────────────────────────────
    function renderConsoleLinha(texto, tipo, comEfeito) {
        const cont = $('#jv-console');
        if (!cont) return;
        const linha = document.createElement('div');
        linha.className = 'jv-linha' + (tipo === 'user' ? ' jv-user' : '');
        cont.appendChild(linha);
        cont.scrollTop = cont.scrollHeight;
        if (!comEfeito) { linha.textContent = texto; return; }

        const cursor = document.createElement('span');
        cursor.className = 'jv-cursor';
        let i = 0;
        const passo = () => {
            i += Math.max(1, Math.round(texto.length / 240)); // acelera textos longos
            linha.textContent = texto.slice(0, i);
            linha.appendChild(cursor);
            cont.scrollTop = cont.scrollHeight;
            if (i < texto.length) requestAnimationFrame(() => setTimeout(passo, 12));
            else cursor.remove();
        };
        passo();
    }

    function htmlParaTexto(html) {
        const div = document.createElement('div');
        div.innerHTML = String(html || '').replace(/<br\s*\/?>/gi, '\n');
        return (div.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
    }

    // Respostas com dado cruzado (CPF/nome/cidade/boletim/processo etc.)
    // vêm em HTML de verdade (tabelas, <strong>, listas — mesmo HTML que o
    // widget de chat balão de js/xerife.js recebe via adicionarMensagem()
    // com innerHTML, já que ambos vêm de responderTexto()/
    // responderPerguntaComposta(), a MESMA função). O console do dashboard
    // JARVIS, porém, jogava tudo isso fora com .textContent — toda tabela/
    // negrito virava um bloco de texto corrido, difícil de ler (pedido
    // explícito do usuário pra corrigir). Renderiza o HTML de verdade
    // aqui; a fala continua usando o texto puro (htmlParaTexto), que é o
    // que faz sentido pra voz.
    function renderConsoleLinhaHTML(html, tipo) {
        const cont = $('#jv-console');
        if (!cont) return;
        const linha = document.createElement('div');
        linha.className = 'jv-linha jv-linha-html' + (tipo === 'user' ? ' jv-user' : '');
        linha.innerHTML = html;
        cont.appendChild(linha);
        cont.scrollTop = cont.scrollHeight;
    }

    // ── Overlay dinâmico ─────────────────────────────────────────────
    // Nada de mapa/visitas/relatório fica fixo na tela — só este único
    // painel, reaproveitado pra todo conteúdo dinâmico, aberto sob
    // demanda quando a pergunta pede.
    function configurarOverlay() {
        $('#jv-overlay-fechar')?.addEventListener('click', fecharOverlay);
        $('#jv-overlay')?.addEventListener('click', e => { if (e.target.id === 'jv-overlay') fecharOverlay(); });
        $('#jv-apresentacao-fechar')?.addEventListener('click', fecharApresentacaoOverlay);
    }
    // telaCheia: usado pra mapa tático e pra página embutida — a esfera
    // encolhe/desloca pro canto (ver ligarModoImersivo) e o overlay ocupa a
    // tela inteira em vez do painel ancorado embaixo.
    function abrirOverlay(titulo, telaCheia) {
        const ov = $('#jv-overlay');
        if (!ov) return;
        _geracaoOverlay++;
        // Reabrir durante os ~300ms de fechamento (ver fecharOverlay): cancela
        // a limpeza pendente, senão ela ia rodar 300ms depois e apagar o
        // conteúdo que acabou de ser montado de novo.
        if (_timeoutFecharOverlay) { clearTimeout(_timeoutFecharOverlay); _timeoutFecharOverlay = null; }
        ov.classList.remove('jv-fechando');
        $('#jv-overlay-titulo').textContent = titulo;
        ov.classList.add('jv-aberto');
        ov.classList.toggle('jv-tela-cheia', !!telaCheia);
        ligarModoImersivo(!!telaCheia);
    }
    function fecharOverlay() {
        apresentacaoAtiva = false;
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        if (mapaTaticoAtivo) { try { mapaTaticoAtivo.remove(); } catch (e) { /* já removido */ } mapaTaticoAtivo = null; }
        ligarModoImersivo(false);
        const ov = $('#jv-overlay');
        if (!ov) return;
        // Fecha com a MESMA transição suave da abertura (translateY+opacity
        // de .jv-overlay-caixa, já definida em CSS) — antes, tirar
        // .jv-aberto na hora também derrubava o display:flex do overlay
        // IMEDIATAMENTE, sem dar tempo do navegador desenhar um frame
        // sequer da animação reversa (a caixa simplesmente sumia sem
        // transição nenhuma). .jv-fechando mantém display:flex só durante
        // os ~300ms da transição CSS antes de limpar de vez.
        ov.classList.remove('jv-aberto');
        ov.classList.add('jv-fechando');
        if (_timeoutFecharOverlay) clearTimeout(_timeoutFecharOverlay);
        _timeoutFecharOverlay = setTimeout(() => {
            _timeoutFecharOverlay = null;
            ov.classList.remove('jv-fechando', 'jv-tela-cheia');
            // Limpa o conteúdo (mapa/página incorporada/carrossel) — sem isso,
            // uma página fechada continuava "viva" escondida no DOM, e
            // obterJanelaMapaAtiva() achava ela de novo no próximo comando
            // (ex.: "apresente... este mês" virava, por engano, um filtro de
            // período pro Dashboard Mapa que o usuário já tinha fechado).
            const corpo = $('#jv-overlay-corpo');
            if (corpo) corpo.innerHTML = '';
        }, 300);
    }
    // Overlay de apresentação/relatório em slides — camada PRÓPRIA e
    // SEPARADA de #jv-overlay (ver CSS .jv-apresentacao-overlay), de
    // propósito: pedido explícito do usuário pra apresentação SOBREPOR a
    // página que já estiver carregada (single embed ou split), sem fechar
    // nem perder o que estava aberto por baixo. Mesma técnica de
    // animação de fechamento (classe .jv-fechando + timeout) já usada em
    // fecharOverlay() — ver comentário lá pro motivo.
    let _timeoutFecharApresentacao = null;
    // popup: true faz a apresentação abrir como um cartão pequeno no canto
    // (CSS .jv-apresentacao-overlay.jv-popup), sem cobrir a tela inteira e
    // SEM recolher a esfera/mapa por baixo (ligarModoImersivo não é
    // chamado) — pedido explícito do usuário: consultar um boletim/
    // processo/nome enquanto o mapa ou a tela dividida está aberta não
    // pode substituir nem esconder o que já estava na tela, só narrar e
    // mostrar o resultado por cima, num popup.
    function abrirApresentacaoOverlay(titulo, popup) {
        const ov = $('#jv-apresentacao-overlay');
        if (!ov) return;
        if (_timeoutFecharApresentacao) { clearTimeout(_timeoutFecharApresentacao); _timeoutFecharApresentacao = null; }
        ov.classList.remove('jv-fechando');
        $('#jv-apresentacao-titulo').textContent = titulo;
        ov.classList.toggle('jv-popup', !!popup);
        ov.classList.add('jv-aberto');
        apresentacaoPopupAtiva = !!popup;
        if (!popup) ligarModoImersivo(true);
    }
    function fecharApresentacaoOverlay() {
        apresentacaoAtiva = false;
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        if (audioFalaAtual) { try { audioFalaAtual.pause(); } catch (e) { /* já parado */ } pararAnaliseAudioFala(); audioFalaAtual = null; }
        // Só desliga o modo imersivo (esfera recolhida) se NENHUMA página
        // também estiver aberta por baixo — senão a esfera voltaria pro
        // grid enquanto a página embutida ainda ocupa a tela inteira. E só
        // se a apresentação atual NÃO era popup — o modo popup nunca liga
        // o imersivo (ver abrirApresentacaoOverlay), então também não deve
        // desligá-lo aqui (senão recolheria uma página/mapa que já estava
        // aberta por outro motivo antes do popup aparecer).
        if (!apresentacaoPopupAtiva && !$('#jv-overlay')?.classList.contains('jv-aberto')) ligarModoImersivo(false);
        const ov = $('#jv-apresentacao-overlay');
        apresentacaoPopupAtiva = false;
        if (!ov) return;
        ov.classList.remove('jv-aberto');
        ov.classList.add('jv-fechando');
        if (_timeoutFecharApresentacao) clearTimeout(_timeoutFecharApresentacao);
        _timeoutFecharApresentacao = setTimeout(() => {
            _timeoutFecharApresentacao = null;
            ov.classList.remove('jv-fechando', 'jv-popup');
            const corpo = $('#jv-apresentacao-corpo');
            if (corpo) corpo.innerHTML = '';
        }, 300);
    }

    // Esfera encolhe e desloca pro canto superior direito (CSS
    // .jv-nucleo.jv-recolhido) quando um mapa ou página do sistema toma a
    // tela inteira — mesma animação nos dois casos, pedida explicitamente.
    // Anima o encolhimento/retorno da esfera com a técnica FLIP (First,
    // Last, Invert, Play): mede a posição/tamanho ANTES de trocar de
    // layout (grid ↔ fixed no canto), aplica um transform que faz ela
    // PARECER que ainda está no lugar antigo, e no frame seguinte solta
    // pra animar suavemente até o lugar novo. Precisa disso porque a
    // esfera muda de "dentro do grid" pra "position:fixed" — uma mudança
    // de layout que uma transition de CSS sozinha não anima direito.
    function ligarModoImersivo(ligado) {
        $('#jv-corpo')?.classList.toggle('jv-modo-imersivo', ligado);
        const nucleo = $('.jv-nucleo');
        if (!nucleo) return;

        const antes = nucleo.getBoundingClientRect();
        nucleo.classList.toggle('jv-recolhido', ligado);
        const depois = nucleo.getBoundingClientRect();
        if (!antes.width || !depois.width) return; // painel oculto (mobile) — sem animação

        const dx = antes.left - depois.left;
        const dy = antes.top - depois.top;
        const escala = antes.width / depois.width;

        nucleo.style.transition = 'none';
        nucleo.style.transformOrigin = 'top left';
        nucleo.style.transform = `translate(${dx}px, ${dy}px) scale(${escala})`;
        requestAnimationFrame(() => {
            nucleo.style.transition = 'transform .5s cubic-bezier(.16,1,.3,1)';
            nucleo.style.transform = '';
        });
    }

    // ── Orquestração principal ──────────────────────────────────────
    async function processarPergunta(texto) {
        renderConsoleLinha('› ' + texto, 'user', false);
        setEstado('thinking');

        const q = normalizarTexto(texto);

        // Fluxo especial: tela cheia — checado ANTES de tudo (inclusive do
        // "fechar/voltar" logo abaixo, que também casaria com "sair da
        // tela cheia" sem essa prioridade, fechando a página inteira por
        // engano em vez de só sair do modo tela cheia).
        const pedidoTelaCheia = detectarPedidoTelaCheia(q);
        if (pedidoTelaCheia) {
            await tratarPedidoTelaCheia(pedidoTelaCheia);
            setEstado('idle');
            return;
        }

        // Fluxo especial: alternar tema claro/escuro por voz/texto — o
        // mesmo alternador (P3.alternarTema, ver js/core/session.js) que o
        // botão #btn-tema usa em toda página do sistema.
        const pedidoTema = detectarPedidoTema(q);
        if (pedidoTema) {
            const atual = document.documentElement.hasAttribute('data-p3-theme') ? 'dark' : 'light';
            if (pedidoTema === 'toggle' || pedidoTema !== atual) { window.P3 && window.P3.alternarTema && window.P3.alternarTema(); }
            const novoEscuro = document.documentElement.hasAttribute('data-p3-theme');
            const msg = `🎨 Modo ${novoEscuro ? 'escuro' : 'claro'} ativado.`;
            renderConsoleLinha(msg, 'bot', false);
            falar(htmlParaTexto(msg));
            setEstado('idle');
            return;
        }

        // Fluxo especial: fechar mapa/página aberta e voltar ao painel normal.
        // Ordem do mais ESPECÍFICO pro mais GERAL — bug real relatado: "fechar
        // o filtro do cartão programa" fechava a página/mapa inteiro porque
        // não tinha como fechar SÓ o painel. 1) um dropdown/painel aberto
        // dentro do rastreamento (histórico/cartão-programa/pânico) fecha
        // primeiro, sem tocar no resto; 2) senão, a apresentação (camada mais
        // externa) fecha se estiver aberta; 3) senão, a página embutida.
        if (detectarPedidoFechar(q)) {
            const janelaRastFechar = obterJanelaRastreamentoAtiva();
            if (janelaRastFechar && typeof janelaRastFechar.rgTemPainelAberto === 'function' && janelaRastFechar.rgTemPainelAberto()) {
                try {
                    janelaRastFechar.rgFecharPainelPerimetro();
                    janelaRastFechar.rgFecharPainelHistorico();
                    janelaRastFechar.rgFecharPainelPanico();
                } catch (e) { /* segue mesmo se algum painel não existir */ }
                renderConsoleLinha('↩️ Filtro fechado.', 'bot', false);
                falar('Filtro fechado.');
                setEstado('idle');
                return;
            }
            if ($('#jv-apresentacao-overlay')?.classList.contains('jv-aberto')) {
                fecharApresentacaoOverlay();
            } else {
                fecharOverlay();
            }
            renderConsoleLinha('↩️ Fechado.', 'bot', false);
            falar('Fechado.');
            setEstado('idle');
            return;
        }

        // Fluxo especial: controlar o Dashboard Mapa que já está aberto
        // (camadas, período, modo de visualização, busca por cidade/nome/
        // CPF) — só entra em jogo quando esse mapa está de fato na tela
        // (ver obterJanelaMapaAtiva). Checado ANTES de navegação/relatório
        // pra "adicionar camada de drogas" nunca ser confundido com outra
        // coisa enquanto o mapa está aberto.
        const janelaMapa = obterJanelaMapaAtiva();
        if (janelaMapa) {
            const comandoMapa = detectarComandoMapa(texto, q);
            if (comandoMapa) {
                const resultado = executarComandoMapa(janelaMapa, comandoMapa);
                if (resultado) {
                    renderConsoleLinha('🗺️ ' + resultado, 'bot', false);
                    falar(resultado);
                    setEstado('idle');
                    return;
                }
            }
        }

        // Fluxo especial: controlar o Rastreamento de Guarnição que já
        // está aberto (histórico/trajeto por período, cartão-programa/
        // perímetro por guarnição, zoom, abrir detalhes) — mesmo padrão
        // acima do Dashboard Mapa, só entra em jogo quando essa página
        // está de fato na tela (single embed OU um dos painéis do split).
        const janelaRastreamento = obterJanelaRastreamentoAtiva();
        if (janelaRastreamento) {
            const comandoRastreamento = detectarComandoRastreamento(q);
            if (comandoRastreamento) {
                const resultado = executarComandoRastreamento(janelaRastreamento, comandoRastreamento);
                if (resultado) {
                    renderConsoleLinha('🛰️ ' + resultado, 'bot', false);
                    falar(resultado);
                    setEstado('idle');
                    return;
                }
            }
        }

        // Fluxo especial: "divida a tela" / "divida a tela entre X e Y" —
        // split-view 50/50 (ver detectarPedidoSplit/tratarPedidoSplit mais
        // abaixo). Checado ANTES dos fluxos de abrir página/localizar
        // guarnição de propósito — "divida a tela entre rastreamento e
        // cartão programa" também casa palavras de página, mas quem tem que
        // tratar isso é o split, não um "abrir" avulso.
        const pedidoSplit = detectarPedidoSplit(q);
        if (pedidoSplit) {
            tratarPedidoSplit(pedidoSplit);
            return;
        }

        // Fluxo especial: split-view com um lado esperando escolha — o
        // picker mostrado na tela pede exatamente "diga o nome" (ex.:
        // "rastreamento", "cartão programa"), então aqui um nome de página
        // RECONHECIDO já basta, SEM precisar do verbo "abrir" que
        // detectarPedidoNavegacao exige (bug real: antes só o clique no
        // botão funcionava, dizer só o nome não preenchia nada). Limitado a
        // frases CURTAS (resposta direta ao picker, tipo "cartão programa")
        // — evita que uma pergunta de dado mais longa que por acaso cite o
        // nome de uma página vire, por engano, escolha de painel.
        if (splitAtivo() && (paneVazio('esq') || paneVazio('dir')) && q.length <= 30) {
            const paginaBare = acharPaginaPorTexto(q);
            if (paginaBare) { preencherProximoPaneVazio(paginaBare.url, paginaBare.titulo); return; }
        }

        // Fluxo especial: "onde a rp1 está?" — pedido de localização de uma
        // guarnição específica, resolve direto pra rastreamento-guarnicao.html
        // (com ?foco= quando dá pra identificar qual), sem precisar do verbo
        // "abrir" que o fluxo de navegação genérico abaixo exige.
        const pedidoLocalizar = detectarPedidoLocalizarGuarnicao(q);
        if (pedidoLocalizar) {
            const urlLocalizar = 'rastreamento-guarnicao.html' + (pedidoLocalizar.foco ? ('?foco=' + encodeURIComponent(pedidoLocalizar.foco)) : '');
            // Split-view ativo com um lado vazio (ver tratarPedidoSplit): o
            // pedido de aqui é "escolha da página" desse lado, não uma
            // página cheia nova — preenche o lado vazio em vez de abrir por
            // cima do split.
            if (preencherProximoPaneVazio(urlLocalizar, pedidoLocalizar.titulo)) return;
            const msgLocalizar = `🖥️ Abrindo ${pedidoLocalizar.titulo}. Diga "voltar" pra fechar.`;
            renderConsoleLinha(msgLocalizar, 'bot', false);
            falar(htmlParaTexto(msgLocalizar));
            abrirPaginaEmbutida(urlLocalizar, pedidoLocalizar.titulo);
            return;
        }

        // Fluxo especial: abrir outra página do sistema por comando de voz
        // (ou texto — mesmo pipeline) dentro da própria tela da IA Xerife,
        // com a MESMA animação de encolher a esfera usada pro mapa.
        const pedidoPagina = detectarPedidoNavegacao(q);
        if (pedidoPagina) {
            if (preencherProximoPaneVazio(pedidoPagina.url, pedidoPagina.titulo)) return;
            const msg = `🖥️ Abrindo ${pedidoPagina.titulo}. Diga "voltar" pra fechar.`;
            renderConsoleLinha(msg, 'bot', false);
            falar(htmlParaTexto(msg));
            abrirPaginaEmbutida(pedidoPagina.url, pedidoPagina.titulo);
            return;
        }

        // Fluxo especial: relatório de CATEGORIA (ex.: "relatório de
        // violência doméstica") — checado ANTES do relatório de cidade+ano
        // abaixo de propósito: desde que esse aceita cidade NULA (relatório
        // geral da unidade, pedido explícito do usuário), ele bateria com
        // QUALQUER "relatório de X [período]" sem uma cidade reconhecida —
        // inclusive "relatório de violência doméstica", que na real é uma
        // categoria, não a unidade inteira. Categoria é mais específica,
        // então vence quando reconhecida.
        const pedidoCategoria = detectarPedidoRelatorioCategoria(q);
        if (pedidoCategoria) {
            const msg = `📊 Relatório de <strong>${escaparHtml(pedidoCategoria.categoriaLabel)}</strong> — escolha o formato na tela.`;
            renderConsoleLinha(htmlParaTexto(msg), 'bot', false);
            falar(htmlParaTexto(msg));
            abrirEscolhaRelatorioCategoria(pedidoCategoria);
            return;
        }

        // Fluxo especial: relatório/apresentação de CIDADE + ANO (ou GERAL
        // DA UNIDADE, se nenhuma cidade for reconhecida) — troca a resposta
        // normal por uma escolha na tela (detalhado vs. detalhado com
        // apresentação narrada), ao invés de cair no fallback genérico de
        // "não entendi" (esse pedido composto não é uma pergunta única de
        // dado, é um relatório agregado — ver obterRelatorioCidade em
        // js/xerife.js).
        const pedidoCidadeAno = detectarPedidoRelatorioCidadeAno(q);
        if (pedidoCidadeAno) {
            const rotuloAlvo = pedidoCidadeAno.cidade || 'toda a unidade';
            const msg = `🗺️ Relatório de <strong>${escaparHtml(rotuloAlvo)}</strong> — escolha o formato na tela.`;
            renderConsoleLinha(htmlParaTexto(msg), 'bot', false);
            falar(htmlParaTexto(msg));
            abrirEscolhaRelatorioCidade(pedidoCidadeAno.cidade, pedidoCidadeAno.textoPeriodo);
            return;
        }

        // Fluxo especial: apresentação narrada GENÉRICA — qualquer pergunta
        // de dado pode virar apresentação, não só o relatório de
        // cidade+ano acima (que continua tendo prioridade, por ser mais
        // específico). A resposta em si é SEMPRE a mesma de
        // responderTexto() — só o formato de exibição muda (slide narrado
        // em vez de linha de console).
        if (/\bapresent/.test(q)) {
            let respostaHtmlApres;
            try { respostaHtmlApres = await window.Xerife.responderTexto(texto); }
            catch (e) { respostaHtmlApres = '⚠️ Deu um problema aqui. Tenta perguntar de novo?'; }
            const respostaTextoApres = htmlParaTexto(respostaHtmlApres);
            renderConsoleLinha(respostaTextoApres, 'bot', true);
            iniciarApresentacaoGenerica(texto, respostaTextoApres);
            window.Xerife.registrarInteracaoTelemetria(texto);
            return;
        }

        let respostaHtml;
        try { respostaHtml = await window.Xerife.responderTexto(texto); }
        catch (e) { respostaHtml = '⚠️ Deu um problema aqui. Tenta perguntar de novo?'; }

        const respostaTexto = htmlParaTexto(respostaHtml);
        renderConsoleLinhaHTML(respostaHtml, 'bot');
        // Quando o Xerife não identifica a categoria da pergunta, o texto
        // detalhado (com exemplos de categoria) continua só no console —
        // a fala fica curta e direta, usando só a graduação (sem nome de
        // guerra), pedido explícito do usuário.
        if (/não identifiquei qual dado/i.test(respostaTexto)) {
            const sessao = window.P3 && window.P3.getSession && window.P3.getSession();
            const graduacao = (sessao && sessao.graduacao) || 'colega';
            falar(`Não entendi ${graduacao}, por favor, explique novamente.`);
        } else {
            falar(respostaTexto);
        }

        // Fire-and-forget — nunca aguardado, pra nunca atrasar o console
        // ou a esfera de partículas (ver doutrina de privacidade completa
        // em registrarInteracaoTelemetria() no js/xerife.js: nunca envia
        // CPF/nome/boletim nem o conteúdo da resposta, só a categoria).
        window.Xerife.registrarInteracaoTelemetria(texto);

        avaliarWidgetsDinamicos(texto, q, respostaTexto);
    }

    // Heurística LEVE só pra decidir quais widgets extras acionar — a
    // resposta em texto/voz acima já saiu correta independente disso.
    async function avaliarWidgetsDinamicos(textoOriginal, q, respostaTexto) {
        // Roda em paralelo, SEM await — obterKPIs pode demorar bastante
        // (cruzamento de TCO via GAS já levou 20s+ em testes) e não pode
        // bloquear os outros widgets (mapa/visita/identificador) atrás dele.
        window.Xerife.obterKPIs(textoOriginal).then(renderKPIs).catch(() => { /* mantém KPIs anteriores */ });

        // 1) Identificador (CPF/processo/boletim/nome) — abre relatório +
        // prompt de baixar PDF. Prioridade alta: se a pergunta é uma
        // consulta de cadastro, não faz sentido também tentar mapa/visita.
        let ident = null;
        try { ident = window.Xerife.identificarConsulta(textoOriginal); } catch (e) { /* segue sem identificador */ }
        if (ident) { abrirRelatorioIdentificador(ident, respostaTexto); return; }

        // 2) Ranking de TCO — continua no painel lateral fixo (não foi
        // pedido pra virar overlay, só mapa/visitas).
        if (q.includes('tco') && (/militar|aceit|falha|arquiv|rejeic|recus/.test(q))) {
            try {
                const modo = q.includes('falha') || q.includes('arquiv') || q.includes('rejeic') ? 'falha' : 'ambos';
                renderRankingTCO(await window.Xerife.obterRankingTCO(modo, textoOriginal));
            } catch (e) { /* widget fica como estava */ }
        }

        // 3) Mapa/hotspot/perímetro/rota crítica — overlay dinâmico em tela
        // cheia, com a MESMA lógica de identificação de hotspots e sugestão
        // de guarnições/reforço de page/opo_inteligente.html (ver
        // js/opo-hotspot-core.js — motor portado, não duplicado à mão).
        if (/bairro|critic|hotspot|rota|perimetro|perímetro|\bmapa\b/.test(q)) {
            try {
                const periodoDias = detectarPeriodoDiasTexto(q);
                const cidades = window.Xerife.obterCidadesComCoordenadas();
                const cidadeAchada = cidades.find(c => q.includes(normalizarTexto(c.cidade)));
                const dadosOpo = cidadeAchada
                    ? await window.OpoHotspotCore.analisarCidade(cidadeAchada.cidade, periodoDias)
                    : await window.OpoHotspotCore.analisarArea(periodoDias);
                abrirMapaTaticoOverlay(dadosOpo);
                return;
            } catch (e) { /* widget fica como estava */ }
        }

        // 4) Visitas sugeridas — overlay dinâmico.
        if (q.includes('visita')) {
            try { abrirVisitasOverlay(await window.Xerife.obterVisitasSugeridas(textoOriginal)); return; } catch (e) { /* widget fica como estava */ }
        }
    }

    // ── Widget: KPIs (persistente, na coluna lateral) ────────────────
    function renderKPIs(kpis) {
        const mapa = {
            'jv-kpi-mvi': kpis.mvi, 'jv-kpi-cvli': kpis.cvli, 'jv-kpi-cvp': kpis.cvp,
            'jv-kpi-tco': kpis.tco, 'jv-kpi-armas': kpis.armas, 'jv-kpi-drogas': kpis.drogas,
        };
        Object.entries(mapa).forEach(([id, val]) => { const el = document.getElementById(id); if (el) el.textContent = (val == null ? '—' : val); });
        const aceit = document.getElementById('jv-kpi-aceit');
        if (aceit) aceit.textContent = kpis.aceitabilidadeTcoPct == null ? '—' : kpis.aceitabilidadeTcoPct + '%';
        const sub = document.getElementById('jv-kpi-periodo');
        if (sub) sub.textContent = kpis.periodoLabel || '';
    }

    // ── Widget: ranking TCO (persistente, na coluna lateral) ─────────
    function renderRankingTCO(lista) {
        const painel = $('#jv-painel-tco');
        const corpo = $('#jv-tabela-tco-body');
        if (!corpo || !painel) return;
        painel.classList.toggle('jv-vazio', !lista.length);
        corpo.innerHTML = lista.length
            ? lista.map(m => `<tr><td>${escaparHtml(m.nome)}</td><td class="jv-num">${m.aceitaveis}</td><td class="jv-num">${m.falhas}</td></tr>`).join('')
            : '<tr><td colspan="3" style="color:var(--p3-text-muted)">Sem cruzamento TCO×Guarnição pra esse período.</td></tr>';
    }

    function carregarLeaflet() {
        if (window.L) return Promise.resolve();
        if (promessaLeaflet) return promessaLeaflet;
        promessaLeaflet = new Promise((resolve, reject) => {
            const css = document.createElement('link');
            css.rel = 'stylesheet';
            css.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
            document.head.appendChild(css);
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Falha ao carregar Leaflet'));
            document.head.appendChild(script);
        });
        return promessaLeaflet;
    }

    // ── Overlay: mapa tático (tela cheia) ─────────────────────────────
    // dados vem de window.OpoHotspotCore.analisarCidade()/analisarArea() —
    // MESMA lógica de identificação de hotspots, coordenadas reais
    // (LATITUDE/LONGITUDE do boletim, com fallback pro centro da cidade) e
    // sugestão de reforço/guarnições de page/opo_inteligente.html.
    async function abrirMapaTaticoOverlay(dados) {
        if (!dados || !dados.geo) {
            abrirOverlay('Mapa tático', true);
            $('#jv-overlay-corpo').innerHTML = '<div class="jv-mapa-vazio">Não encontrei dados suficientes pra montar o mapa.</div>';
            return;
        }
        abrirOverlay('Mapa tático — ' + dados.cidade, true);
        const corpo = $('#jv-overlay-corpo');
        corpo.innerHTML = '<div id="jv-overlay-mapa" class="jv-mapa-em-overlay"></div><div class="jv-mapa-legenda" id="jv-mapa-legenda"></div>';

        try { await carregarLeaflet(); } catch (e) { corpo.innerHTML = '<div class="jv-mapa-vazio">Não consegui carregar o mapa agora.</div>'; return; }

        const mapaEl = document.getElementById('jv-overlay-mapa');
        if (!mapaEl) return; // overlay foi fechado antes do Leaflet terminar de carregar
        const mapa = L.map(mapaEl, { zoomControl: true }).setView([dados.geo.lat, dados.geo.lng], dados.geo.zoom || 11);
        mapaTaticoAtivo = mapa;
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© OpenStreetMap, © CARTO', maxZoom: 18 }).addTo(mapa);

        const corTipo = { CVLI: '#ff4d6d', CVP: '#ffd166' };
        dados.ocorrencias.forEach(oc => {
            L.circleMarker([oc.lat, oc.lng], { radius: 4, color: corTipo[oc.tipo] || '#35c9ff', fillColor: corTipo[oc.tipo] || '#35c9ff', fillOpacity: .6, weight: 1 })
                .addTo(mapa)
                .bindPopup(`<b>${oc.tipo}</b> — ${escaparHtml(oc.natureza)}<br>${escaparHtml(oc.local)}<br>${escaparHtml(oc.data)} ${escaparHtml(oc.hora)}<br>Boletim: ${escaparHtml(oc.boletim)}`);
        });

        const corNivel = { 'CRÍTICO': '#ff4d6d', 'ALTO': '#ff944d', 'MÉDIO': '#ffd166', 'BAIXO': '#35c9ff' };
        dados.hotspots.forEach(h => {
            L.circle([h.lat, h.lng], { radius: 280, color: corNivel[h.nivel] || '#35c9ff', fillColor: corNivel[h.nivel] || '#35c9ff', fillOpacity: .16, weight: 2 })
                .addTo(mapa)
                .bindPopup(`<b>Hotspot ${h.nivel}</b><br>${escaparHtml(h.local || h.cidade || '')}<br>${h.total} ocorrência(s) — CVLI ${h.cvli} / CVP ${h.cvp}`);
        });

        setTimeout(() => mapa.invalidateSize(), 100);
        renderLegendaTatica(dados);
    }

    // Painel flutuante sobre o mapa com o resumo tático: nível de risco,
    // guarnições da jurisdição e reforço sugerido pra OPO (mesma régua de
    // page/opo_inteligente.html: RP → Tático Urbano/Rural → Força Tarefa).
    function renderLegendaTatica(dados) {
        const legenda = document.getElementById('jv-mapa-legenda');
        if (!legenda) return;
        let html = `<div style="font-weight:700;margin-bottom:.4rem;">${escaparHtml(dados.cidade)}</div>`;
        html += `<div style="margin-bottom:.5rem;">${dados.ocorrencias.length} ocorrência(s) · ${dados.hotspots.length} hotspot(s)<br>CVLI ${dados.tatica.cvliTotal} / CVP ${dados.tatica.cvpTotal} — nível <b>${dados.tatica.nivelGeral}</b></div>`;

        if (dados.tatica.efetivoCidade) {
            const ef = dados.tatica.efetivoCidade;
            html += `<div style="font-weight:700;margin-top:.5rem;">Guarnições da jurisdição</div>`;
            html += ef.rps.length ? ef.rps.map(r => `<div>• ${escaparHtml(r.label)}</div>`).join('') : '<div>Nenhuma RP cadastrada pra essa cidade.</div>';
            if (ef.reforcos.length) {
                html += `<div style="font-weight:700;margin-top:.5rem;">Reforço sugerido pra OPO</div>`;
                html += ef.reforcos.map(r => `<div>• ${escaparHtml(r)}</div>`).join('');
            }
        }
        if (dados.alocacao) {
            const emAtencao = dados.alocacao.filter(a => a.nivel !== 'NORMAL');
            html += `<div style="font-weight:700;margin-top:.5rem;">Alocação sugerida por cidade</div>`;
            html += emAtencao.length
                ? emAtencao.map(a => `<div style="margin-top:.3rem;"><b>${escaparHtml(a.cidade)}</b> (${a.nivel})<br>${escaparHtml(a.guarnicao)}${a.reforcos.length ? '<br>+ ' + a.reforcos.map(escaparHtml).join(', ') : ''}</div>`).join('')
                : '<div>Nenhuma cidade em nível de atenção no período.</div>';
        }
        legenda.innerHTML = html;
    }

    // ── Período (em dias) pra análise de hotspot/mapa tático — mesma
    // convenção de "período em dias" já usada em opo_inteligente.html
    // (select de 7/15/30/60/90 dias); aqui interpretado da fala/texto.
    function detectarPeriodoDiasTexto(q) {
        if (/ultima semana|ultimos 7 dias|essa semana|esta semana/.test(q)) return 7;
        if (/ultimos 15 dias|quinzena/.test(q)) return 15;
        if (/ultimos 30 dias|mes|este mes|esse mes/.test(q)) return 30;
        if (/ultimos 60 dias|dois meses/.test(q)) return 60;
        if (/ultimos 90 dias|trimestre|este ano|esse ano/.test(q)) return 90;
        return 30; // padrão — mesmo default de "últimos 30 dias"
    }

    // ── Tema claro/escuro por voz/texto ────────────────────────────────
    function detectarPedidoTema(q) {
        if (/(modo|tema)\s*escur|escurecer a tela|deixar a tela escura/.test(q)) return 'dark';
        if (/(modo|tema)\s*clar|clarear a tela|deixar a tela clara/.test(q)) return 'light';
        if (/alternar (o )?tema|trocar (o )?tema|mudar (o )?tema/.test(q)) return 'toggle';
        return null;
    }
    function detectarPedidoFechar(q) {
        return /\bvolt[ae]r?\b|\bfech[ae]|\bsair\b|\bsaia\b/.test(q);
    }

    // ── Navegação dinâmica: abrir qualquer página do sistema por voz ──
    // Lista alinhada ao CATALOGO_PAGINAS de page/admin-usuarios.html (fonte
    // da verdade de quais páginas realmente existem/são navegáveis) — foram
    // deixadas de fora só as páginas de auth/admin puro (login.html,
    // admin-usuarios.html, admin-unidades.html) e as de diagnóstico interno
    // (diagnostico.html, diagnostico_tco.html, mapaInteligencia.html — essa
    // última é uma duplicata legada de dashboard-mapa.html, mesmo título,
    // pra não colidir sinônimo com sinônimo).
    const PAGINAS_SISTEMA = [
        { nomes: ['pagina inicial', 'tela inicial', 'inicio', 'home'], url: '../index.html', titulo: 'Início' },
        { nomes: ['dashboard', 'painel principal', 'dashboard p3'], url: 'dashboard-p3.html', titulo: 'Dashboard' },
        // "cruzando" (não "cruzado") incluído de propósito — confusão comum
        // de reconhecimento de voz entre "-ado"/"-ando" (bug real relatado:
        // "abrir dashboard cruzando" caía no "Dashboard" genérico, mais
        // curto, em vez do Cruzado).
        { nomes: ['dashboard cruzado', 'painel cruzado', 'dashboard cruzando', 'painel cruzando', 'dashboard', 'dados', 'analise de dados', 'dash', 'consulta de dados', 'estatística'], url: 'dashboard-cruzado.html', titulo: 'Dashboard Cruzado' },
        { nomes: ['dashboard do copom', 'painel do copom', 'dashboard copom'], url: 'dashboard-copom.html', titulo: 'Dashboard COPOM' },
        { nomes: ['dashboard mapa', 'mapa de inteligencia', 'mapa criminal'], url: 'dashboard-mapa.html', titulo: 'Dashboard Mapa' },
        { nomes: ['cadastro de ocorrencias', 'cadastrar ocorrencia', 'nova ocorrencia', 'ocorrencias'], url: 'cadastroocorrencias.html', titulo: 'Cadastro de Ocorrências' },
        { nomes: ['visitas orientativas', 'visitas realizadas'], url: 'exibirvisitas.html', titulo: 'Visitas Orientativas' },
        { nomes: ['gerar visitas', 'analise de visitas'], url: 'gerarvisitas.html', titulo: 'Gerar Visitas' },
        { nomes: ['materiais apreendidos', 'materiais'], url: 'materiais.html', titulo: 'Materiais Apreendidos' },
        { nomes: ['cadastro de eventos', 'pagina de eventos', 'eventos'], url: 'eventos.html', titulo: 'Eventos' },
        { nomes: ['instrucoes', 'instrucao'], url: 'instrucoes.html', titulo: 'Instrução' },
        { nomes: ['mvi', 'cvli', 'cadastro de mvi', 'cadastro de cvli', 'morte violenta intencional'], url: 'mvi.html', titulo: 'MVI / CVLI' },
        { nomes: ['cvp', 'crime violento contra o patrimonio', 'cadastro de cvp'], url: 'cvp.html', titulo: 'CVP' },
        { nomes: ['TCO','cadastro de tco', 'registrar tco', 'novo tco', 'lavrar tco'], url: 'tco.html', titulo: 'TCO' },
        { nomes: ['violencia domestica', 'maria da penha'], url: 'violenciadomestica.html', titulo: 'Violência Doméstica' },
        { nomes: ['armas apreendidas', 'cadastro de armas', 'armas'], url: 'armas.html', titulo: 'Armas Apreendidas' },
        { nomes: ['drogas apreendidas', 'entorpecentes', 'drogas'], url: 'drogas.html', titulo: 'Drogas Apreendidas' },
        { nomes: ['perturbacao do sossego', 'perturbacao'], url: 'perturbacao.html', titulo: 'Perturbação do Sossego' },
        { nomes: ['ait', 'auto de infracao de transito'], url: 'ait.html', titulo: 'AIT' },
        { nomes: ['cumprimento de mandados', 'cadastro de mandado', 'mandados'], url: 'mandado.html', titulo: 'Cumprimento de Mandados' },
        { nomes: ['pesquisa de mandado', 'consulta de mandado', 'consultar mandado', 'busca de mandado', 'datajud'], url: 'pesquisa_mandado.html', titulo: 'Consulta de Mandado (DataJud)' },
        { nomes: ['qualitativo de tco', 'analise qualitativa de tco', 'aceitabilidade de tco', 'iris tco'], url: 'qualitativo_tco.html', titulo: 'Qualitativo de TCO' },
        { nomes: ['relatorio quantitativo de tco', 'quantitativo de tco'], url: 'relatorio_quantitativo_tco.html', titulo: 'Relatório Quantitativo de TCO' },
        { nomes: ['analise de tco', 'analise juridica de tco', 'jurimetria de tco'], url: 'analise_tco.html', titulo: 'Análise de TCO' },
        { nomes: ['opo inteligente', 'analise de opo'], url: 'opo_inteligente.html', titulo: 'OPO Inteligente' },
        { nomes: ['opo interativa', 'montar opo', 'opo manual', 'opo no mapa'], url: 'opo-interativa.html', titulo: 'OPO Interativa' },
        { nomes: ['prelecao'], url: 'prelecao.html', titulo: 'Preleção' },
        { nomes: ['chat mobile', 'chat do xerife'], url: 'chat-mobile.html', titulo: 'Chat Xerife' },
        { nomes: ['analise preditiva'], url: 'analisePreditiva.html', titulo: 'Análise Preditiva' },
        { nomes: ['jurimetria'], url: 'jurimetria.html', titulo: 'Jurimetria' },
        { nomes: ['leitor de shapefile', 'shapefile'], url: 'leitorShapeFile.html', titulo: 'Leitor de ShapeFile' },
        { nomes: ['solucoes de ia', 'solucoes ia'], url: 'solucoesia.html', titulo: 'Soluções IA' },
        { nomes: ['calendario'], url: 'calendario.html', titulo: 'Calendário' },
        { nomes: ['cartao programa'], url: '../relatorios/cartaoprograma.html', titulo: 'Cartão Programa' },
        { nomes: ['cumprimento do cartao programa', 'cumprimento do cartao', 'cumprimento de opo', 'cumprimento da opo'], url: 'cumprimento-cartao.html', titulo: 'Cumprimento do Cartão-Programa' },
        { nomes: ['rastreamento', 'rastreamento de guarnicao', 'rastrear guarnicao', 'rastrear viatura', 'viaturas', 'viatura', 'vtr', 'mapa de viaturas', 'onde estao as viaturas'], url: 'rastreamento-guarnicao.html', titulo: 'Rastreamento de Guarnição' },
    ];
    function detectarPedidoNavegacao(q) {
        // Verbos específicos de navegação, cobrindo as conjugações comuns
        // na fala (imperativo "abra"/"acesse", infinitivo "abrir", "busque
        // a vtr", "procure o dashboard", "leva pro cadastro" etc.) — de
        // propósito SEM "mostrar"/"ver" (verbos comuns demais em perguntas
        // normais de dado, ex.: "mostra quantos TCO esse mês", que não é
        // pedido de navegação).
        const gatilho = /\b(abr[ae]|abrir|ir\s+(para|pra)|vai\s+(para|pra)|lev[ae]\s+(para|pra)|acess[ae]|acessar|entr[ae]\s+em|entrar\s+em|carreg[ae]|carregar|busc[ae]|busque|buscar|procur[ae]|procurar|localiz[ae]|localizar)\b/.test(q);
        if (!gatilho) return null;
        // Pega o sinônimo mais LONGO que bater (mais específico), não o
        // primeiro por ordem do array — ex.: "abra o cumprimento do cartão
        // programa" tem que ganhar de "cartão programa" (cartaoprograma.html),
        // que também é um `includes()` válido da mesma frase.
        let melhor = null, melhorTamanho = 0;
        for (const p of PAGINAS_SISTEMA) {
            for (const n of p.nomes) {
                if (n.length > melhorTamanho && q.includes(n)) { melhor = p; melhorTamanho = n.length; }
            }
        }
        return melhor;
    }

    // "onde a rp1 está?", "onde a rp 01 tá?", "onde anda o tático rural 1?",
    // "onde está a viatura?" — pedido de LOCALIZAÇÃO de uma guarnição
    // específica, não uma navegação genérica (sem verbo "abrir"/"buscar").
    // Sempre resolve pra rastreamento-guarnicao.html; quando dá pra
    // identificar QUAL guarnição, passa via ?foco= pra a página já abrir
    // com o marcador dela centralizado (ver leitura do parâmetro nesse
    // arquivo).
    function detectarPedidoLocalizarGuarnicao(q) {
        if (!/\bonde\b/.test(q)) return null;
        if (!/\b(esta|estao|anda|andam|fica|ficam|ta|tao)\b/.test(q)) return null;

        const mRP = q.match(/\brp\s*0?(\d{1,2})\b/);
        if (mRP) {
            const num = mRP[1].padStart(2, '0');
            return { foco: `RP ${num}`, titulo: `Rastreamento — RP ${num}` };
        }
        if (/\btatico\s+urbano\b/.test(q)) {
            return { foco: 'TATICO URBANO', titulo: 'Rastreamento — Tático Urbano' };
        }
        const mTaticoRural = q.match(/\btatico\s+rural\s*0?([12])\b/);
        if (mTaticoRural) {
            return { foco: `RURAL 0${mTaticoRural[1]}`, titulo: `Rastreamento — Tático Rural ${mTaticoRural[1]}` };
        }
        const mPelopes = q.match(/\bpelopes\s*0?(\d{1,2})\b/);
        if (mPelopes) {
            const num = mPelopes[1].padStart(2, '0');
            return { foco: `PELOPES ${num}`, titulo: `Rastreamento — PELOPES ${num}` };
        }
        if (/\bviatura\b|\bvtr\b|\bguarnicao\b/.test(q)) {
            return { foco: '', titulo: 'Rastreamento de Guarnição' };
        }
        return null;
    }
    function abrirPaginaEmbutida(url, titulo) {
        abrirOverlay(titulo, true);
        const corpo = $('#jv-overlay-corpo');
        corpo.innerHTML = `<iframe class="jv-pagina-embutida" src="${escaparHtml(url)}" title="${escaparHtml(titulo)}" allowfullscreen></iframe>`;
    }

    // ── Tela cheia — "coloque em tela cheia"/"colocar em tela cheia" (a
    // página toda, seja a home do Xerife, 1 página embutida ou o split
    // inteiro) vs. "coloque o MAPA em tela cheia" (específico — só quando a
    // pessoa pede explicitamente o mapa) ────────────────────────────────
    function detectarPedidoTelaCheia(q) {
        if (!/\btela\s+cheia\b/.test(q)) return null;
        return {
            mapa: /\bmapa\b/.test(q),
            sair: /\bsair\b|\bsaia\b|\bfechar\b/.test(q),
        };
    }
    // Cada página com mapa expõe seu próprio jeito de entrar em tela cheia
    // (nunca duplicado aqui) — dashboard-mapa.html expõe toggleTelaCheia()
    // como função global (ver js/mapa-Dashboard-P3.js:1171); já
    // rastreamento-guarnicao.html não expõe função, só o próprio botão
    // #rg-btn-fullscreen (ver page/rastreamento-guarnicao.html). Tenta os
    // 2 jeitos conhecidos, na ordem.
    function tentarTelaCheiaMapa(win, doc) {
        try { if (win && typeof win.toggleTelaCheia === 'function') { win.toggleTelaCheia(); return true; } } catch (e) { /* cross-origin inesperado ou função não existe nessa página */ }
        try { const btn = doc && doc.getElementById('rg-btn-fullscreen'); if (btn) { btn.click(); return true; } } catch (e) { /* idem */ }
        return false;
    }
    function iframesVisiveis() {
        return Array.from(document.querySelectorAll('iframe.jv-pagina-embutida, iframe.jv-pagina-embutida-split'));
    }
    async function tratarPedidoTelaCheia(pedido) {
        if (pedido.sair) {
            if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch (e) { /* já fora */ } }
            iframesVisiveis().forEach(f => {
                try {
                    const d = f.contentDocument;
                    if (d && (d.fullscreenElement || d.webkitFullscreenElement)) (d.exitFullscreen || d.webkitExitFullscreen)?.call(d);
                } catch (e) { /* cross-origin inesperado */ }
            });
            const msg = '⛶ Saindo da tela cheia.';
            renderConsoleLinha(msg, 'bot', false); falar(msg);
            return;
        }
        if (pedido.mapa) {
            // Tenta em qualquer iframe visível (1 embutida OU os 2 painéis
            // do split) — usa o primeiro que tiver mapa de verdade.
            for (const f of iframesVisiveis()) {
                let ok = false;
                try { ok = tentarTelaCheiaMapa(f.contentWindow, f.contentDocument); } catch (e) { /* cross-origin inesperado */ }
                if (ok) {
                    const msg = '🗺️ Mapa em tela cheia.';
                    renderConsoleLinha(msg, 'bot', false); falar(msg);
                    return;
                }
            }
            const msg = '⚠️ Não achei um mapa nessa página pra colocar em tela cheia.';
            renderConsoleLinha(msg, 'bot', false); falar(msg);
            return;
        }
        // Genérico: tela cheia real do navegador pra tudo que está visível
        // agora — home do Xerife (esfera), 1 página embutida ou o split
        // inteiro, sempre a MESMA área (document.documentElement).
        try {
            await document.documentElement.requestFullscreen();
            const msg = '⛶ Tela cheia ativada.';
            renderConsoleLinha(msg, 'bot', false); falar(msg);
        } catch (e) {
            // A Fullscreen API do navegador exige "ativação transitória"
            // (um clique/toque/tecla BEM recente, poucos segundos) — pedido
            // por VOZ costuma perder essa janela (o reconhecimento de fala
            // real leva 1-3s+ até o texto chegar aqui, tempo suficiente
            // pro navegador considerar a ativação expirada), enquanto um
            // clique real logo antes (ex.: no carrossel da apresentação)
            // ainda está "dentro do prazo" — é por isso que às vezes
            // funciona e às vezes não, mesmo pedindo a mesma coisa (bug
            // relatado pelo usuário). Não dá pra contornar (é política do
            // navegador, não bug daqui) — só avisar de forma honesta.
            console.error('[Xerife] Fullscreen negado pelo navegador:', e.name, e.message);
            const msg = e.name === 'NotAllowedError'
                ? '⚠️ O navegador bloqueou a tela cheia por voz (exige uma interação recente, tipo um clique) — clica em qualquer botão da tela e peça de novo.'
                : '⚠️ Não consegui ativar a tela cheia agora — tenta de novo.';
            renderConsoleLinha(msg, 'bot', false); falar(msg);
        }
    }

    // ── Split-view (estilo Windows Snap): 2 páginas lado a lado, 50/50 ──
    // Pedido explícito do usuário: "divida a tela" sozinho já abre o split
    // com os 2 lados esperando escolha (picker); "divida a tela entre X e
    // Y" já abre os 2 direto; e se já tinha 1 página aberta (não-split) e
    // o usuário só disser "divida a tela", essa página vira o lado
    // esquerdo e o direito fica esperando escolha — tudo confirmado com o
    // usuário antes de implementar (AskUserQuestion).
    // Mesmo casamento por sinônimo mais LONGO usado em detectarPedidoNavegacao
    // (ver comentário lá), mas como função à parte — reaproveitada também
    // pelo preenchimento de painel do split-view por voz SEM precisar de
    // verbo tipo "abrir" (ver uso mais abaixo: quando o picker do split tá
    // esperando escolha, um nome de página sozinho já basta).
    function acharPaginaPorTexto(texto) {
        let melhor = null, melhorTamanho = 0;
        for (const p of PAGINAS_SISTEMA) {
            for (const n of p.nomes) {
                if (n.length > melhorTamanho && texto.includes(n)) { melhor = p; melhorTamanho = n.length; }
            }
        }
        return melhor;
    }

    function detectarPedidoSplit(q) {
        if (!/\bdivid[ae]\b|\bdividir\b|tela\s+dividida|modo\s+split|split\s*view/.test(q)) return null;
        if (!/\btela\b|\bsplit\b/.test(q)) return null;

        const acharPagina = acharPaginaPorTexto;
        // "divida a tela entre RASTREAMENTO e CARTÃO PROGRAMA" — separa nas
        // conjunções mais comuns pra achar até 2 páginas nomeadas na frase.
        const partes = q.split(/\s+\be\b\s+|\s+\bcom\b\s+/);
        if (partes.length >= 2) {
            const p1 = acharPagina(partes[0]);
            const p2 = acharPagina(partes.slice(1).join(' e '));
            if (p1 && p2 && p1.url !== p2.url) return { pagina1: p1, pagina2: p2 };
        }
        return { pagina1: null, pagina2: null };
    }

    function splitAtivo() {
        return !!document.querySelector('.jv-split-container');
    }
    function paneVazio(lado) {
        const pane = document.querySelector(`.jv-split-pane[data-lado="${lado}"]`);
        return !!pane && pane.dataset.vazio === '1';
    }
    // Header (com brasão/relógio/usuário) e nav lateral de CADA página
    // embutida ficariam duplicados em split (2 headers, 2 navs, comendo
    // metade do espaço já curto de cada painel) — escondidos via CSS
    // injetado no <head> do iframe (mesma origem, acesso direto permitido).
    // "cadastroocorrencias.html"/`.pagecomplete`/`.navegacao` é o layout
    // padrão compartilhado por praticamente toda página do sistema (ver
    // css/style.css) — header ocupa 3.75rem sticky no topo, nav é uma
    // coluna flex de largura fixa ao lado do <main>; escondendo os dois
    // com display:none, o flexbox de .pagecomplete já reflui sozinho pro
    // <main> ocupar 100% da largura/altura do painel, sem sobra de espaço.
    // Estilo INLINE direto no elemento (não um <style> no <head>) — inline
    // + !important sempre vence qualquer regra de stylesheet + !important
    // por especificidade (a inline é tratada como a mais específica
    // possível), então não depende de ordem de carregamento de nenhum CSS
    // da página embutida (testado: um <style> injetado no <head> perdia
    // pra alguma regra da própria página, provavelmente por chegar cedo
    // demais na cascata — inline elimina essa incerteza de vez).
    function esconderHeaderNav(doc) {
        doc.querySelectorAll('header, nav.navegacao').forEach(el => el.style.setProperty('display', 'none', 'important'));
        doc.querySelectorAll('.pagecomplete').forEach(el => el.style.setProperty('min-height', '100vh', 'important'));
        if (doc.documentElement) doc.documentElement.style.setProperty('overflow-x', 'hidden', 'important');
        if (doc.body) doc.body.style.setProperty('overflow-x', 'hidden', 'important');
    }
    function preencherPane(lado, url, titulo) {
        const pane = document.querySelector(`.jv-split-pane[data-lado="${lado}"]`);
        if (!pane) return;
        pane.dataset.vazio = '0';
        pane.innerHTML = `<div class="jv-split-topo">${escaparHtml(titulo)}</div>`;
        const iframe = document.createElement('iframe');
        iframe.className = 'jv-pagina-embutida-split';
        iframe.title = titulo;
        iframe.allowFullscreen = true;
        // Listener ANTES de setar o src — um iframe já em cache pode
        // disparar 'load' rápido demais se o listener for anexado depois.
        iframe.addEventListener('load', () => {
            try {
                const doc = iframe.contentDocument;
                if (doc) esconderHeaderNav(doc);
            } catch (e) { console.error('[Xerife split] não consegui esconder header/nav do painel:', e); }
        });
        iframe.src = url;
        pane.appendChild(iframe);
    }
    function mostrarPickerPane(lado) {
        const pane = document.querySelector(`.jv-split-pane[data-lado="${lado}"]`);
        if (!pane) return;
        pane.dataset.vazio = '1';
        pane.innerHTML = `
            <div class="jv-split-picker">
                <div class="jv-split-picker-msg">🖥️ Qual tela você quer aqui? Diga o nome (ex.: "rastreamento", "cartão programa") ou escolha:</div>
                <div class="jv-split-picker-lista">
                    ${PAGINAS_SISTEMA.map(p => `<button type="button" class="jv-btn-pill jv-split-opcao" data-url="${escaparHtml(p.url)}" data-titulo="${escaparHtml(p.titulo)}">${escaparHtml(p.titulo)}</button>`).join('')}
                </div>
            </div>`;
        pane.querySelectorAll('.jv-split-opcao').forEach(btn => {
            btn.addEventListener('click', () => preencherPane(lado, btn.dataset.url, btn.dataset.titulo));
        });
    }
    // pagina1/pagina2 são entradas de PAGINAS_SISTEMA (ou null pra abrir o
    // picker naquele lado).
    function abrirSplitView(pagina1, pagina2) {
        abrirOverlay('Tela dividida', true);
        const corpo = $('#jv-overlay-corpo');
        corpo.innerHTML = `
            <div class="jv-split-container">
                <div class="jv-split-pane" data-lado="esq"></div>
                <div class="jv-split-divisor"></div>
                <div class="jv-split-pane" data-lado="dir"></div>
            </div>`;
        if (pagina1) preencherPane('esq', pagina1.url, pagina1.titulo); else mostrarPickerPane('esq');
        if (pagina2) preencherPane('dir', pagina2.url, pagina2.titulo); else mostrarPickerPane('dir');
    }
    function tratarPedidoSplit(pedido) {
        // Split já aberto: só reabre do zero se a frase nomeou as 2
        // páginas de novo (senão "divida a tela" repetido não faz nada,
        // evita apagar o que a pessoa já tinha escolhido).
        if (splitAtivo()) {
            if (pedido.pagina1 && pedido.pagina2) {
                const msg = `🖥️ Tela dividida entre ${pedido.pagina1.titulo} e ${pedido.pagina2.titulo}.`;
                renderConsoleLinha(msg, 'bot', false); falar(htmlParaTexto(msg));
                abrirSplitView(pedido.pagina1, pedido.pagina2);
            }
            return;
        }
        // 1 página já aberta (não-split) + "divida a tela" sozinho (sem
        // nomear as 2) — essa página vira o lado esquerdo, direito fica
        // esperando escolha. Pedido explícito do usuário.
        const iframeAtual = document.querySelector('.jv-pagina-embutida');
        if (iframeAtual && !pedido.pagina1 && !pedido.pagina2) {
            const url = iframeAtual.getAttribute('src') || '';
            const titulo = iframeAtual.getAttribute('title') || $('#jv-overlay-titulo')?.textContent || 'Página';
            const msg = `🖥️ Tela dividida — ${titulo} no lado esquerdo. Qual tela você quer no direito?`;
            renderConsoleLinha(msg, 'bot', false); falar(htmlParaTexto(msg));
            abrirSplitView({ url, titulo }, null);
            return;
        }
        const msg = pedido.pagina1 && pedido.pagina2
            ? `🖥️ Tela dividida entre ${pedido.pagina1.titulo} e ${pedido.pagina2.titulo}.`
            : '🖥️ Tela dividida. Escolha as páginas de cada lado.';
        renderConsoleLinha(msg, 'bot', false); falar(htmlParaTexto(msg));
        abrirSplitView(pedido.pagina1, pedido.pagina2);
    }
    // Usado pelos fluxos normais de "abrir página"/"onde está X": se o
    // split-view estiver aberto E tiver um lado esperando escolha, o
    // pedido preenche ESSE lado em vez de abrir uma página cheia nova por
    // cima do split. Retorna true se tratou (chamador não deve seguir com
    // o fluxo normal de página cheia).
    function preencherProximoPaneVazio(url, titulo) {
        if (!splitAtivo()) return false;
        const lado = paneVazio('esq') ? 'esq' : (paneVazio('dir') ? 'dir' : null);
        if (!lado) return false;
        preencherPane(lado, url, titulo);
        const msg = `🖥️ ${titulo} — colocado no lado ${lado === 'esq' ? 'esquerdo' : 'direito'}.`;
        renderConsoleLinha(msg, 'bot', false);
        falar(htmlParaTexto(msg));
        return true;
    }

    // ── Overlay: visitas sugeridas (carrossel) ────────────────────────
    function abrirVisitasOverlay(dados) {
        const itens = dados.resultados || [];
        abrirOverlay(`Visitas sugeridas${dados.cidade ? ' — ' + dados.cidade : ''} (${itens.length})`);
        const corpo = $('#jv-overlay-corpo');
        if (!itens.length) { corpo.innerHTML = '<div style="color:var(--p3-text-muted)">Nenhuma visita pendente encontrada.</div>'; return; }

        corpo.innerHTML = `
            <div class="jv-carrossel">
                <div class="jv-carrossel-viewport"><div class="jv-carrossel-trilho" id="jv-ov-trilho"></div></div>
                <div class="jv-carrossel-nav">
                    <button type="button" id="jv-ov-prev">‹ anterior</button>
                    <span id="jv-ov-indicador"></span>
                    <button type="button" id="jv-ov-next">próxima ›</button>
                </div>
            </div>`;
        const trilho = document.getElementById('jv-ov-trilho');
        trilho.innerHTML = itens.map(r => `
            <div class="jv-carrossel-slide">
                <div><b>COP nº ${escaparHtml(r.cop)}</b></div>
                <div>${escaparHtml(r.natureza)} — ${escaparHtml(r.data)}</div>
                <div>📍 ${escaparHtml(r.local)}</div>
                <div>Desfecho: ${escaparHtml(r.solucao)}</div>
                <div>Solicitante: ${escaparHtml(r.solicitante)}</div>
            </div>`).join('');

        let indice = 0;
        const atualizar = () => {
            trilho.style.transform = `translateX(-${indice * 100}%)`;
            document.getElementById('jv-ov-indicador').textContent = `${indice + 1} / ${itens.length}`;
            document.getElementById('jv-ov-prev').disabled = indice === 0;
            document.getElementById('jv-ov-next').disabled = indice >= itens.length - 1;
        };
        document.getElementById('jv-ov-prev').onclick = () => { indice = Math.max(0, indice - 1); atualizar(); };
        document.getElementById('jv-ov-next').onclick = () => { indice = Math.min(itens.length - 1, indice + 1); atualizar(); };
        atualizar();
    }

    // ── Overlay: relatório por identificador (CPF/processo/boletim/nome) ──
    // A resposta em si já veio de responderTexto() (mesma consulta, mesmo
    // texto mostrado no console) — aqui só reaproveita esse texto pra
    // exibir dentro do overlay + oferecer o botão de baixar em PDF.
    function abrirRelatorioIdentificador(ident, respostaTexto) {
        const rotulos = { cpf: 'CPF', processo: 'Processo', boletim: 'Boletim/COP', nome: 'Nome' };
        const titulo = `Relatório — ${rotulos[ident.tipo] || ident.tipo}: ${ident.valor}`;
        // Mapa (Dashboard Mapa/Rastreamento) ou tela dividida já aberta
        // dentro do #jv-overlay: abrirOverlay reaproveitaria a MESMA camada
        // e sobrescreveria #jv-overlay-corpo, apagando o mapa/split que já
        // estava na tela — bug real relatado pelo usuário. Nesse caso, usa
        // a apresentação em slides no modo POPUP (camada separada,
        // #jv-apresentacao-overlay, por cima sem substituir nada) em vez
        // do relatório de tela cheia normal.
        if ($('#jv-overlay')?.classList.contains('jv-aberto')) {
            // silencioso:true — o texto já foi narrado pelo fluxo normal de
            // processarPergunta (falar(respostaTexto), chamado ANTES de
            // avaliarWidgetsDinamicos/abrirRelatorioIdentificador); sem
            // isso, narraria a mesma resposta duas vezes seguidas.
            iniciarApresentacaoGenerica(titulo, respostaTexto, true, true);
            return;
        }
        abrirOverlay(titulo);
        const corpo = $('#jv-overlay-corpo');
        corpo.innerHTML = `
            <div class="jv-relatorio-texto">${escaparHtml(respostaTexto)}</div>
            <div class="jv-escolha-botoes">
                <button type="button" class="jv-btn-pill" id="jv-btn-pdf">📄 Baixar PDF estruturado</button>
            </div>`;
        document.getElementById('jv-btn-pdf').addEventListener('click', () => gerarPdfRelatorio(titulo, respostaTexto));
    }

    // ── Geração de PDF (jsPDF, carregado sob demanda só quando o botão é
    // clicado — mesmo padrão de carregamento tardio do Leaflet acima) ──
    function carregarJsPDF() {
        if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve();
        if (promessaJsPDF) return promessaJsPDF;
        promessaJsPDF = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Falha ao carregar gerador de PDF'));
            document.head.appendChild(script);
        });
        return promessaJsPDF;
    }
    async function gerarPdfRelatorio(titulo, corpoTexto) {
        const btn = document.getElementById('jv-btn-pdf');
        const rotuloOriginal = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = 'Gerando PDF…'; }
        try {
            await carregarJsPDF();
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({ unit: 'pt', format: 'a4' });
            const margem = 48;
            const larguraUtil = doc.internal.pageSize.getWidth() - margem * 2;
            const alturaPagina = doc.internal.pageSize.getHeight() - margem;
            let y = margem;

            doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
            doc.text('XERIFE — Relatório', margem, y); y += 22;
            doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
            doc.text(titulo, margem, y); y += 14;
            doc.text('Gerado em ' + new Date().toLocaleString('pt-BR'), margem, y); y += 18;
            doc.setDrawColor(180); doc.line(margem, y, margem + larguraUtil, y); y += 18;

            doc.setFontSize(10.5);
            const linhas = doc.splitTextToSize(corpoTexto, larguraUtil);
            linhas.forEach(linha => {
                if (y > alturaPagina) { doc.addPage(); y = margem; }
                doc.text(linha, margem, y);
                y += 14;
            });
            doc.save('xerife-relatorio-' + Date.now() + '.pdf');
        } catch (e) {
            alert('Não consegui gerar o PDF agora — tente de novo.');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = rotuloOriginal; }
        }
    }

    // ── Relatório/apresentação de CIDADE + ANO ────────────────────────
    // cidade: null quando nenhuma cidade é citada na pergunta — vira
    // RELATÓRIO GERAL DA UNIDADE (pedido explícito do usuário), não mais
    // exigência obrigatória. textoPeriodo é a FRASE INTEIRA (não só um
    // ano) — obterRelatorioCidade (xerife.js) usa o mesmo detectarPeriodo()
    // de todo o resto do arquivo, que já entende ano isolado, mês,
    // "este/esse ano" E SEMESTRE ("primeiro semestre de 2026").
    function detectarPedidoRelatorioCidadeAno(q) {
        const temRelatorio = /relatorio/.test(q);
        if (!temRelatorio && !/apresent/.test(q)) return null;
        // Precisa de ALGUM sinal de período — senão "relatório"/"apresente"
        // citado solto dentro de outra pergunta acionaria essa escolha por
        // engano (mesmos sinais que detectarPeriodo em xerife.js reconhece).
        const temSinalPeriodo = /\b20\d{2}\b|semestre|\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b|este ano|esse ano|ano passado|ano anterior|este mes|esse mes|mes passado|mes anterior|\bhoje\b|\bontem\b/.test(q);
        if (!temSinalPeriodo) return null;
        let cidades = [];
        try { cidades = window.Xerife.obterCidadesComCoordenadas(); } catch (e) { /* segue sem cidade — relatório geral */ }
        const cidadeAchada = cidades.find(c => q.includes(normalizarTexto(c.cidade)));
        // Sem cidade citada: só vira "geral da unidade" quando a palavra
        // for "RELATÓRIO" (pedido explícito e formal) — "apresente quantos
        // TCO tivemos esse mês" (só "apresente", sem "relatório" nem
        // cidade) é uma pergunta NORMAL só narrada, não um pedido de
        // relatório agregado; cai no fallback genérico de apresentação
        // (iniciarApresentacaoGenerica), não nesta escolha. Bug real
        // encontrado testando: "apresente" sozinho + qualquer menção de
        // período (ex.: "esse mês") sequestrava toda pergunta normal.
        if (!cidadeAchada && !temRelatorio) return null;
        return { cidade: cidadeAchada ? cidadeAchada.cidade : null, textoPeriodo: q };
    }

    function abrirEscolhaRelatorioCidade(cidade, textoPeriodo) {
        const rotuloAlvo = cidade || 'toda a unidade';
        abrirOverlay(`Relatório — ${rotuloAlvo}`);
        const minhaGeracao = _geracaoOverlay;
        const corpo = $('#jv-overlay-corpo');
        corpo.innerHTML = `
            <div>Como você quer ver o relatório de <b>${escaparHtml(rotuloAlvo)}</b>?</div>
            <div class="jv-escolha-botoes">
                <button type="button" class="jv-btn-pill" id="jv-btn-rel-detalhado">📋 Relatório detalhado</button>
                <button type="button" class="jv-btn-pill jv-gold" id="jv-btn-rel-apresentacao">🎬 Detalhado com apresentação</button>
            </div>`;
        document.getElementById('jv-btn-rel-detalhado').addEventListener('click', async () => {
            corpo.innerHTML = '<div style="color:var(--p3-text-muted)">Montando relatório…</div>';
            let dados;
            try { dados = await window.Xerife.obterRelatorioCidade(cidade, textoPeriodo); }
            catch (e) { if (_geracaoOverlay === minhaGeracao) corpo.innerHTML = '<div style="color:var(--p3-text-muted)">Não consegui montar o relatório agora.</div>'; return; }
            // Usuário já pediu outra coisa enquanto isso buscava dados
            // (fetch pesado — TCO/sentenças reais podem levar bastante) —
            // ignora silenciosamente, não sobrescreve o que já está na tela.
            if (_geracaoOverlay !== minhaGeracao) return;
            montarRelatorioCidadeDetalhado(dados);
        });
        document.getElementById('jv-btn-rel-apresentacao').addEventListener('click', async () => {
            corpo.innerHTML = '<div style="color:var(--p3-text-muted)">Montando apresentação…</div>';
            let dados;
            try { dados = await window.Xerife.obterRelatorioCidade(cidade, textoPeriodo); }
            catch (e) { if (_geracaoOverlay === minhaGeracao) corpo.innerHTML = '<div style="color:var(--p3-text-muted)">Não consegui montar a apresentação agora.</div>'; return; }
            if (_geracaoOverlay !== minhaGeracao) return;
            iniciarApresentacaoCidade(dados);
        });
    }

    // ── Relatório de CATEGORIA (ex.: "relatório de violência doméstica",
    // "relatório de drogas apreendidas este ano") ──────────────────────
    // identificarCategoriaPorTexto (xerife.js) reaproveita o MESMO
    // CATEGORIAS/detectarCategoria usado em toda pergunta normal de dado
    // — nunca uma lista de categorias duplicada aqui.
    function detectarPedidoRelatorioCategoria(q) {
        if (!/relatorio/.test(q)) return null;
        if (!window.Xerife || typeof window.Xerife.identificarCategoriaPorTexto !== 'function') return null;
        let categoriaLabel = null;
        try { categoriaLabel = window.Xerife.identificarCategoriaPorTexto(q); } catch (e) { return null; }
        if (!categoriaLabel) return null;
        let cidade = null;
        try {
            const cidades = window.Xerife.obterCidadesComCoordenadas();
            const achada = cidades.find(c => q.includes(normalizarTexto(c.cidade)));
            if (achada) cidade = achada.cidade;
        } catch (e) { /* segue sem cidade — relatório geral da unidade */ }
        return { categoriaLabel, textoCategoria: q, textoPeriodo: q, cidade };
    }
    function abrirEscolhaRelatorioCategoria(pedido) {
        abrirOverlay(`Relatório — ${pedido.categoriaLabel}`);
        const minhaGeracao = _geracaoOverlay;
        const corpo = $('#jv-overlay-corpo');
        corpo.innerHTML = `
            <div>Como você quer ver o relatório de <b>${escaparHtml(pedido.categoriaLabel)}</b>?</div>
            <div class="jv-escolha-botoes">
                <button type="button" class="jv-btn-pill" id="jv-btn-relcat-detalhado">📋 Relatório detalhado</button>
                <button type="button" class="jv-btn-pill jv-gold" id="jv-btn-relcat-apresentacao">🎬 Detalhado com apresentação</button>
            </div>`;
        const buscarDados = () => window.Xerife.obterRelatorioCategoria(pedido.textoCategoria, pedido.textoPeriodo, pedido.cidade);
        document.getElementById('jv-btn-relcat-detalhado').addEventListener('click', async () => {
            corpo.innerHTML = '<div style="color:var(--p3-text-muted)">Montando relatório…</div>';
            let dados;
            try { dados = await buscarDados(); }
            catch (e) { if (_geracaoOverlay === minhaGeracao) corpo.innerHTML = '<div style="color:var(--p3-text-muted)">Não consegui montar o relatório agora.</div>'; return; }
            if (_geracaoOverlay !== minhaGeracao) return; // usuário já pediu outra coisa nesse meio-tempo
            if (!dados) { corpo.innerHTML = '<div style="color:var(--p3-text-muted)">Não consegui identificar essa categoria.</div>'; return; }
            montarRelatorioCategoriaDetalhado(dados);
        });
        document.getElementById('jv-btn-relcat-apresentacao').addEventListener('click', async () => {
            corpo.innerHTML = '<div style="color:var(--p3-text-muted)">Montando apresentação…</div>';
            let dados;
            try { dados = await buscarDados(); }
            catch (e) { if (_geracaoOverlay === minhaGeracao) corpo.innerHTML = '<div style="color:var(--p3-text-muted)">Não consegui montar a apresentação agora.</div>'; return; }
            if (_geracaoOverlay !== minhaGeracao) return;
            if (!dados) { corpo.innerHTML = '<div style="color:var(--p3-text-muted)">Não consegui identificar essa categoria.</div>'; return; }
            iniciarApresentacaoSlides(`Apresentação — ${dados.categoria} (${dados.cidade || 'toda a unidade'})`, montarSlidesRelatorioCategoria(dados));
        });
    }
    function montarSlidesRelatorioCategoria(dados) {
        const rotulo = dados.cidade || 'toda a unidade';
        const slides = [];
        slides.push({
            fala: `Relatório de ${dados.categoria}, ${rotulo}, ${dados.periodoLabel}. Total de ${dados.total} registros.`,
            html: `<div><b>📊 ${escaparHtml(dados.categoria)} — ${escaparHtml(rotulo)} (${escaparHtml(dados.periodoLabel)})</b></div>
                   <div class="jv-relatorio-kpis"><div class="jv-kpi"><span class="jv-kpi-label">Total</span><span class="jv-kpi-valor">${dados.total}</span></div></div>`,
        });
        if (dados.porMes.some(m => m.qtd)) {
            const idGrafico = proximoIdGrafico();
            slides.push({
                fala: `Tendência mensal: ${dados.porMes.map(m => `${m.label}: ${m.qtd}`).join(', ')}.`,
                html: `<div><b>📈 Tendência mensal</b></div><div class="jv-slide-grafico-wrap"><canvas id="${idGrafico}"></canvas></div>`,
                grafico: { tipo: 'line', canvasId: idGrafico, titulo: dados.categoria, labels: dados.porMes.map(m => m.label), dados: dados.porMes.map(m => m.qtd) },
            });
        }
        if (dados.topCidades.length) {
            slides.push({
                fala: `Cidades com mais registros: ${dados.topCidades.map(([c, q]) => `${c}: ${q}`).join(', ')}.`,
                html: `<div><b>🏙️ Cidades com mais registros</b></div><ul>${dados.topCidades.map(([c, q]) => `<li><b>${escaparHtml(c)}</b>: ${q}</li>`).join('')}</ul>`,
            });
        }
        if (dados.topStatus.length) {
            slides.push({
                fala: `Situação dos registros: ${dados.topStatus.map(([s, q]) => `${s}: ${q}`).join(', ')}.`,
                html: `<div><b>📌 Situação</b></div><ul>${dados.topStatus.map(([s, q]) => `<li><b>${escaparHtml(s)}</b>: ${q}</li>`).join('')}</ul>`,
            });
        }
        return slides;
    }
    function montarRelatorioCategoriaDetalhado(dados) {
        const rotulo = dados.cidade || 'toda a unidade';
        abrirOverlay(`Relatório detalhado — ${dados.categoria} (${rotulo})`);
        const slides = montarSlidesRelatorioCategoria(dados);
        const corpo = $('#jv-overlay-corpo');
        corpo.innerHTML = slides.map(s => `<div style="margin-bottom:1rem;padding-bottom:1rem;border-bottom:1px solid var(--p3-border);">${s.html}</div>`).join('')
            + `<div class="jv-escolha-botoes"><button type="button" class="jv-btn-pill jv-gold" id="jv-btn-relcat-virar-apresentacao">🎬 Ver como apresentação narrada</button></div>`;
        document.getElementById('jv-btn-relcat-virar-apresentacao').addEventListener('click', () => iniciarApresentacaoSlides(`Apresentação — ${dados.categoria} (${rotulo})`, montarSlidesRelatorioCategoria(dados)));
        renderizarGraficosDosSlides(slides);
    }

    let _contadorGrafico = 0;
    function proximoIdGrafico() { return 'jv-chart-' + (++_contadorGrafico) + '-' + Date.now(); }

    // Chart.js — MESMA versão/CDN já usada em várias páginas do sistema
    // (ver dashboard-cruzado.html, dashboard-copom.html etc.), carregada
    // sob demanda (só quando um slide realmente tem gráfico) — mesmo
    // padrão de carregarVits()/carregarChartJs acima: nunca baixa nada
    // pesado à toa.
    let _chartJsPromise = null;
    function carregarChartJs() {
        if (window.Chart) return Promise.resolve();
        if (!_chartJsPromise) {
            _chartJsPromise = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
                s.onload = () => resolve();
                s.onerror = () => reject(new Error('falha ao carregar Chart.js'));
                document.body.appendChild(s);
            });
        }
        return _chartJsPromise;
    }
    // Instancia os gráficos de TODOS os slides que tiverem `grafico` — só
    // funciona DEPOIS que o HTML (com os <canvas>) já está no DOM (ver
    // chamadas em iniciarApresentacaoSlides/montarRelatorioCidadeDetalhado).
    // Falha de rede aqui nunca quebra a apresentação — o slide só fica
    // sem o gráfico, o texto/fala continuam normais.
    async function renderizarGraficosDosSlides(slides) {
        const comGrafico = slides.filter(s => s.grafico);
        if (!comGrafico.length) return;
        try { await carregarChartJs(); } catch (e) { return; }
        if (!window.Chart) return;
        comGrafico.forEach(s => {
            const canvas = document.getElementById(s.grafico.canvasId);
            if (!canvas) return;
            try {
                new Chart(canvas, {
                    type: s.grafico.tipo || 'bar',
                    data: {
                        labels: s.grafico.labels,
                        datasets: [{
                            label: s.grafico.titulo || '',
                            data: s.grafico.dados,
                            backgroundColor: s.grafico.cores || ['#1565c0', '#00838f', '#6a1b9a', '#c62828', '#2e7d32', '#ef6c00'],
                            borderColor: 'rgba(0,188,212,.9)', borderWidth: 1,
                        }],
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false },
                            title: { display: !!s.grafico.titulo, text: s.grafico.titulo, color: '#e8f1f5' },
                        },
                        scales: s.grafico.tipo === 'pie' || s.grafico.tipo === 'doughnut' ? {} : {
                            x: { ticks: { color: '#b8c4cc' }, grid: { color: 'rgba(255,255,255,.08)' } },
                            y: { ticks: { color: '#b8c4cc' }, grid: { color: 'rgba(255,255,255,.08)' }, beginAtZero: true },
                        },
                    },
                });
            } catch (e) { /* slide só fica sem o gráfico */ }
        });
    }

    // Monta os "slides" (texto pra narração + HTML pra tela) do relatório
    // agregado de uma cidade OU DE TODA A UNIDADE (dados.cidade === null —
    // pedido explícito do usuário: sem cidade citada, é o geral da
    // unidade) — reaproveitado tanto pelo relatório detalhado estático
    // quanto pela apresentação narrada.
    function montarSlidesRelatorioCidade(dados) {
        const rotulo = dados.cidade || 'toda a unidade';
        const periodoTxt = dados.periodoLabel || String(dados.ano);
        const slides = [];
        slides.push({
            fala: `Relatório de ${rotulo}, ${periodoTxt}. Foram registradas ${dados.mvi ?? 0} mortes violentas intencionais, de um total de ${dados.cvli ?? 0} crimes violentos letais. Crimes contra o patrimônio: ${dados.cvp ?? 0}. Armas apreendidas: ${dados.armas ?? 0}. Registros de drogas apreendidas: ${dados.drogas ?? 0}.`,
            html: `<div><b>📊 Visão geral — ${escaparHtml(rotulo)} (${escaparHtml(periodoTxt)})</b></div>
                   <div class="jv-relatorio-kpis">
                     <div class="jv-kpi"><span class="jv-kpi-label">MVI</span><span class="jv-kpi-valor">${dados.mvi ?? '—'}</span></div>
                     <div class="jv-kpi"><span class="jv-kpi-label">CVLI</span><span class="jv-kpi-valor">${dados.cvli ?? '—'}</span></div>
                     <div class="jv-kpi"><span class="jv-kpi-label">CVP</span><span class="jv-kpi-valor">${dados.cvp ?? '—'}</span></div>
                     <div class="jv-kpi"><span class="jv-kpi-label">Armas</span><span class="jv-kpi-valor">${dados.armas ?? '—'}</span></div>
                     <div class="jv-kpi"><span class="jv-kpi-label">Drogas</span><span class="jv-kpi-valor">${dados.drogas ?? '—'}</span></div>
                   </div>`,
        });
        // Gráfico de barras com as mesmas 5 categorias — só entra se pelo
        // menos 1 valor real existir (nunca desenha gráfico vazio).
        if ([dados.mvi, dados.cvli, dados.cvp, dados.armas, dados.drogas].some(v => v)) {
            const idGrafico = proximoIdGrafico();
            slides.push({
                fala: `Comparativo por categoria: CVLI ${dados.cvli ?? 0}, CVP ${dados.cvp ?? 0}, armas ${dados.armas ?? 0}, drogas ${dados.drogas ?? 0}.`,
                html: `<div><b>📈 Comparativo por categoria</b></div><div class="jv-slide-grafico-wrap"><canvas id="${idGrafico}"></canvas></div>`,
                grafico: { tipo: 'bar', canvasId: idGrafico, titulo: 'Registros por categoria', labels: ['CVLI', 'CVP', 'Armas', 'Drogas'], dados: [dados.cvli ?? 0, dados.cvp ?? 0, dados.armas ?? 0, dados.drogas ?? 0] },
            });
        }
        slides.push({
            fala: dados.tco.total
                ? `Termos circunstanciados: ${dados.tco.total} casos cruzados com guarnição, com taxa de aceitabilidade de ${dados.tco.aceitabilidadePct} por cento.`
                : 'Não encontrei termos circunstanciados cruzados com guarnição para essa cidade e período.',
            html: `<div><b>⚖️ TCO — Aceitabilidade</b></div><div>${dados.tco.total ? `${dados.tco.total} caso(s) cruzados — <b>${dados.tco.aceitabilidadePct}%</b> aceitável` : 'Sem dados suficientes.'}</div>`,
        });
        if (dados.hotspots) {
            slides.push({
                fala: `Bairros críticos por turno: ${dados.hotspots.turnos.map(t => `${t.nome}: ${t.locais.map(l => l.bairro).join(', ') || 'sem dado'}`).join('. ')}.`,
                html: `<div><b>🗺️ Hotspots por turno</b></div>` + dados.hotspots.turnos.map(t => `<div style="margin-top:.3rem;"><b>${t.nome}</b>: ${escaparHtml(t.locais.map(l => l.bairro).join(', ') || '—')} — ${t.nivel || 'sem dado'}</div>`).join(''),
            });
        }
        if (dados.previsao) {
            slides.push({
                fala: `Previsão para o próximo mês: ${dados.previsao.mvi.previstoProximoMes} MVI, ${dados.previsao.cvli.previstoProximoMes} CVLI e ${dados.previsao.cvp.previstoProximoMes} CVP.`,
                html: `<div><b>🔮 Previsão — próximo mês</b></div><div style="margin-top:.3rem;">MVI: <b>${dados.previsao.mvi.previstoProximoMes}</b> · CVLI: <b>${dados.previsao.cvli.previstoProximoMes}</b> · CVP: <b>${dados.previsao.cvp.previstoProximoMes}</b></div>`,
            });
        }
        if (dados.cartaoPrograma) {
            slides.push({
                fala: `Cartão programa da região ${dados.cartaoPrograma.rp}: ${dados.cartaoPrograma.dados.resumo}`,
                html: `<div><b>🚓 Cartão Programa — ${escaparHtml(dados.cartaoPrograma.rp)}</b></div><div style="margin-top:.3rem;">${escaparHtml(dados.cartaoPrograma.dados.resumo)}</div>`,
            });
        }
        return slides;
    }

    // ── Relatório detalhado (estático, sem narração) ──────────────────
    function montarRelatorioCidadeDetalhado(dados) {
        const rotulo = dados.cidade || 'toda a unidade';
        const periodoTxt = dados.periodoLabel || String(dados.ano);
        abrirOverlay(`Relatório detalhado — ${rotulo} (${periodoTxt})`);
        const slides = montarSlidesRelatorioCidade(dados);
        const corpo = $('#jv-overlay-corpo');
        corpo.innerHTML = slides.map(s => `<div style="margin-bottom:1rem;padding-bottom:1rem;border-bottom:1px solid var(--p3-border);">${s.html}</div>`).join('')
            + `<div class="jv-escolha-botoes"><button type="button" class="jv-btn-pill jv-gold" id="jv-btn-virar-apresentacao">🎬 Ver como apresentação narrada</button></div>`;
        document.getElementById('jv-btn-virar-apresentacao').addEventListener('click', () => iniciarApresentacaoCidade(dados));
        renderizarGraficosDosSlides(slides);
    }

    // ── Apresentação narrada (slide a slide, com TTS e avanço automático) ──
    // Genérica de propósito — reaproveitada tanto pelo relatório de
    // cidade+ano quanto por QUALQUER pergunta com "apresente"/"apresentação"
    // (ver iniciarApresentacaoGenerica), pra nunca ter dois jeitos
    // diferentes de tocar uma apresentação.
    // silencioso: true pula a narração PRÓPRIA desta apresentação — usado
    // quando o texto já foi falado por fora (ver abrirRelatorioIdentificador,
    // que reaproveita a fala já disparada pelo fluxo normal de
    // processarPergunta) pra nunca narrar a mesma resposta duas vezes.
    function iniciarApresentacaoSlides(titulo, slides, popup, silencioso) {
        abrirApresentacaoOverlay(titulo, popup);
        const corpo = $('#jv-apresentacao-corpo');
        corpo.innerHTML = `
            <div class="jv-carrossel">
                <div class="jv-carrossel-viewport"><div class="jv-carrossel-trilho" id="jv-apr-trilho"></div></div>
                <div class="jv-carrossel-nav">
                    <button type="button" id="jv-apr-prev">‹ anterior</button>
                    <span id="jv-apr-indicador"></span>
                    ${silencioso ? '' : '<button type="button" id="jv-apr-pausar">⏸ pausar narração</button>'}
                    <button type="button" id="jv-apr-next">próxima ›</button>
                </div>
            </div>`;
        const trilho = document.getElementById('jv-apr-trilho');
        trilho.innerHTML = slides.map(s => `<div class="jv-carrossel-slide jv-slide-grande">${s.html}</div>`).join('');
        renderizarGraficosDosSlides(slides);

        let indice = 0, pausado = false;
        apresentacaoAtiva = true;
        const atualizar = () => {
            trilho.style.transform = `translateX(-${indice * 100}%)`;
            document.getElementById('jv-apr-indicador').textContent = `${indice + 1} / ${slides.length}`;
            document.getElementById('jv-apr-prev').disabled = indice === 0;
            document.getElementById('jv-apr-next').disabled = indice >= slides.length - 1;
        };
        const narrarAtual = () => {
            if (!apresentacaoAtiva || pausado || silencioso) return;
            falar(slides[indice].fala, () => {
                if (!apresentacaoAtiva || pausado) return;
                if (indice < slides.length - 1) { indice++; atualizar(); narrarAtual(); }
            });
        };
        document.getElementById('jv-apr-prev').addEventListener('click', () => {
            if ('speechSynthesis' in window) window.speechSynthesis.cancel();
            indice = Math.max(0, indice - 1); atualizar(); if (!pausado) narrarAtual();
        });
        document.getElementById('jv-apr-next').addEventListener('click', () => {
            if ('speechSynthesis' in window) window.speechSynthesis.cancel();
            indice = Math.min(slides.length - 1, indice + 1); atualizar(); if (!pausado) narrarAtual();
        });
        document.getElementById('jv-apr-pausar')?.addEventListener('click', e => {
            pausado = !pausado;
            e.target.textContent = pausado ? '▶ retomar narração' : '⏸ pausar narração';
            if (pausado) { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }
            else narrarAtual();
        });
        atualizar();
        narrarAtual();
    }
    function iniciarApresentacaoCidade(dados) {
        const rotulo = dados.cidade || 'toda a unidade';
        const periodoTxt = dados.periodoLabel || String(dados.ano);
        iniciarApresentacaoSlides(`Apresentação — ${rotulo} (${periodoTxt})`, montarSlidesRelatorioCidade(dados));
    }
    // Apresentação de UM slide só, a partir de qualquer resposta normal do
    // Xerife (a mesma de responderTexto() — nunca recalcula nada) — cobre
    // "apresente/faça uma apresentação de X" pra perguntas que não são
    // relatório de cidade+ano.
    // Quebra um texto longo em pedaços que cabem no limite da voz NEURAL
    // (LIMITE_CARACTERES_VOZ_NEURAL) — corta em fronteira de frase/
    // parágrafo, nunca no meio de uma palavra. Pedido explícito do
    // usuário: a apresentação tem que falar na MESMA voz fluida da
    // saudação — um texto de resposta grande (comum em relatórios) que
    // passasse do limite cairia sozinho pro fallback nativo (ver
    // falar()), quebrando essa consistência; virando vários slides
    // curtos, cada um fica sempre dentro do limite neural.
    function quebrarEmPedacosDeVoz(texto, limite) {
        const alvo = limite || LIMITE_CARACTERES_VOZ_NEURAL;
        const paragrafos = texto.split(/\n{2,}/).filter(p => p.trim());
        const pedacos = [];
        let atual = '';
        const empilhar = frase => {
            const juntado = (atual + ' ' + frase).trim();
            if (juntado.length > alvo && atual) { pedacos.push(atual.trim()); atual = frase; }
            else { atual = juntado; }
        };
        (paragrafos.length ? paragrafos : [texto]).forEach(p => {
            if (p.length <= alvo) { empilhar(p); return; }
            p.split(/(?<=[.!?])\s+/).forEach(f => empilhar(f));
        });
        if (atual.trim()) pedacos.push(atual.trim());
        return pedacos.length ? pedacos : [texto];
    }
    function iniciarApresentacaoGenerica(pergunta, respostaTexto, popup, silencioso) {
        const pedacos = quebrarEmPedacosDeVoz(respostaTexto, LIMITE_CARACTERES_VOZ_NEURAL);
        const slides = pedacos.map((pedaco, i) => ({
            fala: pedaco,
            html: `<div><b>📊 ${escaparHtml(pergunta)}</b>${pedacos.length > 1 ? ` <small style="opacity:.6">(${i + 1}/${pedacos.length})</small>` : ''}</div><div style="margin-top:.6rem;white-space:pre-wrap;">${escaparHtml(pedaco)}</div>`,
        }));
        iniciarApresentacaoSlides('Apresentação', slides, popup, silencioso);
    }

    // ── Controle por voz do Dashboard Mapa embutido (camadas, período,
    // modo de visualização, busca por cidade/nome/CPF) ─────────────────
    // Reaproveita as funções JÁ EXPOSTAS globalmente por
    // js/mapa-Dashboard-P3.js (toggleCamada, aplicarFiltros,
    // filtrarOcorrencias etc.) — nunca reimplementa a lógica do mapa aqui,
    // só chama as mesmas funções que os botões daquela página já chamam,
    // através do iframe (mesma origem, acesso direto ao contentWindow).
    function obterJanelaMapaAtiva() {
        // iframesVisiveis() (ver bloco de tela cheia) — cobre tanto a
        // página embutida única quanto os 2 painéis do split-view.
        for (const iframe of iframesVisiveis()) {
            try {
                const w = iframe.contentWindow;
                if (w && typeof w.toggleCamada === 'function') return w;
            } catch (e) { /* cross-origin (não deveria acontecer, mesma origem) ou ainda não carregou */ }
        }
        return null;
    }
    const CAMADAS_MAPA = [
        { id: 'cvli', nomes: ['cvli', 'crimes violentos letais', 'mortes violentas letais'] },
        { id: 'mvi', nomes: ['mvi', 'mortes violentas intencionais'] },
        { id: 'cvp', nomes: ['cvp', 'crimes contra o patrimonio', 'crimes patrimoniais'] },
        { id: 'droga', nomes: ['drogas', 'droga', 'entorpecente'] },
        { id: 'arma', nomes: ['armas', 'arma'] },
        { id: 'vd', nomes: ['violencia domestica', 'vd'] },
        { id: 'sossego', nomes: ['perturbacao do sossego', 'sossego', 'perturbacao'] },
        { id: 'tco', nomes: ['tco'] },
        { id: 'ccp', nomes: ['ccp'] },
        { id: 'mandados', nomes: ['mandados', 'mandado'] },
        { id: 'visitas', nomes: ['visitas orientativas', 'visitas'] },
    ];
    function camadaEstaAtiva(win, id) {
        try { const el = win.document.getElementById('ct-' + id); return !!(el && el.classList.contains('ativa')); }
        catch (e) { return false; }
    }
    // Período — aceita "últimos N dias", "este mês/ano" e duas datas
    // DD/MM/AAAA — sempre convertido pro formato AAAA-MM-DD que os campos
    // <input type="date"> do Dashboard Mapa esperam.
    function detectarPeriodoMapa(q) {
        const hoje = new Date();
        const fmt = d => d.toISOString().slice(0, 10);
        const diasMatch = q.match(/ultimos?\s+(\d+)\s+dias?/);
        if (diasMatch) {
            const ini = new Date(hoje); ini.setDate(hoje.getDate() - parseInt(diasMatch[1], 10));
            return { ini: fmt(ini), fim: fmt(hoje) };
        }
        if (/\bhoje\b/.test(q)) return { ini: fmt(hoje), fim: fmt(hoje) };
        if (/\bontem\b/.test(q)) { const ont = new Date(hoje); ont.setDate(hoje.getDate() - 1); return { ini: fmt(ont), fim: fmt(ont) }; }
        if (/este mes|esse mes/.test(q)) return { ini: fmt(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), fim: fmt(hoje) };
        if (/este ano|esse ano/.test(q)) return { ini: fmt(new Date(hoje.getFullYear(), 0, 1)), fim: fmt(hoje) };
        const datas = q.match(/\d{1,2}\/\d{1,2}\/\d{4}/g);
        const paraIso = s => { const [d, m, a] = s.split('/'); return `${a}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`; };
        if (datas && datas.length >= 2) return { ini: paraIso(datas[0]), fim: paraIso(datas[1]) };
        if (datas && datas.length === 1 && /\ba partir de\b|\bdesde\b/.test(q)) return { ini: paraIso(datas[0]), fim: fmt(hoje) };
        return null;
    }
    function detectarComandoMapa(textoOriginal, q) {
        if (/todas as camadas|ativar tudo|mostrar tudo/.test(q)) return { tipo: 'marcar-todas' };
        if (/nenhuma camada|limpar camadas|desativar tudo|tirar todas as camadas/.test(q)) return { tipo: 'desmarcar-todas' };

        const verboAtivar = /\b(adicion[ae]r?|ativ[ae]r?|lig[ae]r?|mostr[ae]r?|coloc[ae]r?|coloque)\b/.test(q);
        const verboDesativar = /\b(remov[ae]r?|tir[ae]r?|desativ[ae]r?|deslig[ae]r?|escond[ae]r?)\b/.test(q);
        if (verboAtivar || verboDesativar) {
            for (const cam of CAMADAS_MAPA) {
                if (cam.nomes.some(n => q.includes(n))) return { tipo: verboAtivar ? 'ativar-camada' : 'desativar-camada', id: cam.id };
            }
        }

        if (/mapa de calor|modo calor|\bcalor\b/.test(q)) return { tipo: 'modo', modo: 'heat' };
        if (/\bcluster\b|agrupad[ao]/.test(q)) return { tipo: 'modo', modo: 'cluster' };
        if (/\bambos\b|os dois modos|calor e cluster/.test(q)) return { tipo: 'modo', modo: 'ambos' };

        if (/limpar (o )?periodo|tirar (o )?periodo|remover (o )?filtro de data|sem periodo/.test(q)) return { tipo: 'limpar-periodo' };
        const periodo = detectarPeriodoMapa(q);
        if (periodo) return { tipo: 'periodo', ini: periodo.ini, fim: periodo.fim };

        if (/limpar (a )?busca|tirar (a )?busca|limpar (a )?pesquisa/.test(q)) return { tipo: 'limpar-busca' };
        // Busca por cidade/nome/CPF é um campo único no Dashboard Mapa —
        // extrai tudo depois de "buscar/pesquisar/procurar (por) (cidade/
        // nome/cpf)" do texto ORIGINAL (preserva maiúsculas/pontuação do
        // CPF, importante pro campo de busca de lá).
        const buscaMatch = textoOriginal.match(/\b(?:buscar|pesquisar|procurar)\b(?:\s+por)?\s*(?:cidade|nome|cpf)?\s*[:\-]?\s*(.+)/i);
        if (buscaMatch && buscaMatch[1].trim()) return { tipo: 'busca', termo: buscaMatch[1].trim() };

        return null;
    }
    function executarComandoMapa(win, acao) {
        try {
            switch (acao.tipo) {
                case 'marcar-todas': win.marcarTodas(); return 'Todas as camadas ativadas.';
                case 'desmarcar-todas': win.desmarcarTodas(); return 'Todas as camadas desativadas.';
                case 'ativar-camada':
                    if (!camadaEstaAtiva(win, acao.id)) win.toggleCamada(acao.id);
                    return `Camada de ${acao.id.toUpperCase()} ativada.`;
                case 'desativar-camada':
                    if (camadaEstaAtiva(win, acao.id)) win.toggleCamada(acao.id);
                    return `Camada de ${acao.id.toUpperCase()} desativada.`;
                case 'modo':
                    win.setModo(acao.modo);
                    return `Modo de visualização: ${acao.modo === 'heat' ? 'mapa de calor' : acao.modo === 'cluster' ? 'agrupado' : 'calor e agrupado'}.`;
                case 'periodo':
                    win.document.getElementById('fil-ini').value = acao.ini;
                    win.document.getElementById('fil-fim').value = acao.fim;
                    win.aplicarFiltros();
                    return `Período aplicado: ${acao.ini} a ${acao.fim}.`;
                case 'limpar-periodo':
                    win.limparFiltros();
                    return 'Filtro de período removido.';
                case 'busca':
                    win.document.getElementById('busca-oc').value = acao.termo;
                    win.filtrarOcorrencias();
                    return `Buscando por "${acao.termo}".`;
                case 'limpar-busca':
                    win.limparBusca();
                    return 'Busca limpa.';
                default: return null;
            }
        } catch (e) { return null; }
    }

    // ── Controle por voz do Rastreamento de Guarnição embutido (histórico
    // /trajeto por período, cartão-programa/perímetro por guarnição, zoom,
    // abrir detalhes) ────────────────────────────────────────────────
    // Mesmo padrão do Dashboard Mapa acima — reaproveita as funções JÁ
    // EXPOSTAS globalmente por page/rastreamento-guarnicao.html
    // (rgVerTrajetoPorNome, rgBuscarPerimetroPorNome, rgZoomIn/Out,
    // rgAbrirDetalhes), nunca reimplementa a lógica do mapa aqui.
    function obterJanelaRastreamentoAtiva() {
        for (const iframe of iframesVisiveis()) {
            try {
                const w = iframe.contentWindow;
                if (w && typeof w.rgZoomIn === 'function') return w;
            } catch (e) { /* cross-origin inesperado ou ainda não carregou */ }
        }
        return null;
    }
    function detectarComandoRastreamento(q) {
        // "aplicar o zoom" (aumentar) / "retirar o zoom" (diminuir)
        // incluídos de propósito — variantes reais que o usuário usa e não
        // batiam antes (bug relatado: zoom "não fazia nada").
        if (/\bmais\s+zoom\b|\baumentar\s+(o\s+)?zoom\b|\bzoom\s+mais\b|\baproxim|\baplicar\s+(o\s+)?zoom\b/.test(q)) return { tipo: 'zoom-in' };
        if (/\bmenos\s+zoom\b|\bdiminuir\s+(o\s+)?zoom\b|\bzoom\s+menos\b|\bafast|\bretirar\s+(o\s+)?zoom\b|\btirar\s+(o\s+)?zoom\b/.test(q)) return { tipo: 'zoom-out' };

        // "histórico/trajeto da guarnição/rp X [no período Y]" — nome livre
        // até a parte de período (se houver) ou o fim da frase. NÃO retira
        // "rp" do nome capturado (só "guarnicao"/"viatura", que são
        // palavras-filler genéricas) — rgVerTrajetoPorNome/
        // rgBuscarPerimetroPorNome (rastreamento-guarnicao.html) dependem
        // do prefixo "RP" continuar no texto pra reconhecer um número de
        // RP (ex.: "RP 01") em vez de cair no casamento genérico por nome.
        const TERMINADORES_PERIODO = '(?:\\s+no\\s+periodo.*|\\s+entre\\s.*|\\s+de\\s+\\d.*|\\s+ultimos?\\s+\\d.*|\\s+este\\s+m[eê]s.*|\\s+esse\\s+m[eê]s.*|\\s+este\\s+ano.*|\\s+esse\\s+ano.*|\\s+hoje.*|\\s+ontem.*|$)';
        if (/\bhistorico\b|\btrajeto\b/.test(q)) {
            const m = q.match(new RegExp('(?:historico|trajeto)\\s+(?:da|de|do)?\\s*(?:guarnicao|viatura)?\\s*(.+?)' + TERMINADORES_PERIODO));
            const nome = m && m[1].trim() ? m[1].trim() : null;
            if (nome) return { tipo: 'historico', nome, periodo: detectarPeriodoMapa(q) };
        }

        // "cartão programa da guarnição/rp X [no dia Y]" — mesmo princípio.
        if (/cartao\s+programa/.test(q)) {
            const m = q.match(new RegExp('cartao\\s+programa\\s+(?:da|de|do)?\\s*(?:guarnicao|viatura)?\\s*(.+?)' + TERMINADORES_PERIODO));
            const nome = m && m[1].trim() ? m[1].trim() : null;
            if (nome) { const periodo = detectarPeriodoMapa(q); return { tipo: 'perimetro', nome, data: periodo ? periodo.fim : null }; }
        }

        // "abrir detalhes da guarnição/rp X", "detalhes de X"
        if (/detalhes?\b/.test(q)) {
            const m = q.match(/detalhes?\s+(?:da|de|do)?\s*(?:guarnicao|viatura)?\s*(.+)/);
            const nome = m && m[1].trim() ? m[1].trim() : null;
            if (nome) return { tipo: 'detalhes', nome };
        }

        return null;
    }
    function executarComandoRastreamento(win, acao) {
        try {
            switch (acao.tipo) {
                case 'zoom-in': win.rgZoomIn(); return 'Zoom aumentado.';
                case 'zoom-out': win.rgZoomOut(); return 'Zoom diminuído.';
                case 'historico': {
                    const ini = acao.periodo ? acao.periodo.ini : null;
                    const fim = acao.periodo ? acao.periodo.fim : null;
                    const ok = win.rgVerTrajetoPorNome(acao.nome, ini, fim);
                    return ok ? `Buscando histórico de ${acao.nome}.` : `Não achei uma guarnição chamada "${acao.nome}".`;
                }
                case 'perimetro': {
                    const ok = win.rgBuscarPerimetroPorNome(acao.nome, acao.data);
                    return ok ? `Buscando cartão-programa de ${acao.nome}.` : `Não achei uma RP/cidade chamada "${acao.nome}".`;
                }
                case 'detalhes': {
                    const ok = win.rgAbrirDetalhes(acao.nome);
                    return ok ? `Abrindo detalhes de ${acao.nome}.` : `Não achei "${acao.nome}" no mapa agora.`;
                }
                default: return null;
            }
        } catch (e) { return null; }
    }

    function escaparHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    document.addEventListener('DOMContentLoaded', iniciar);
})();
