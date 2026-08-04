// ════════════════════════════════════════════════════════════════════
// PARTICLE SPHERE — motor de partículas do Xerife/JARVIS, em Canvas 2D
// puro (sem Three.js/WebGL). Decisão deliberada: qualquer biblioteca via
// CDN neste sistema já se mostrou frágil neste ambiente (ver xerife-sw.js
// — import cross-origin falha em Service Worker; e há travamentos de rede
// pra pacotes grandes) — uma esfera de partículas em Canvas 2D roda em
// qualquer navegador, sem download extra, sem risco de 404/CORS.
//
// Projeção 3D→2D é uma perspectiva simples (escala por profundidade),
// suficiente pra dar a sensação de esfera girando sem o custo de um
// pipeline WebGL de verdade.
// ════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    // Canvas não entende var(--p3-*) — as cores são lidas em tempo real das
    // MESMAS variáveis do resto do sistema (css/theme.css), pra esfera
    // trocar de cor sozinha quando o tema claro/escuro muda (botão ou
    // comando de voz), sem precisar recarregar a página. Mapeamento
    // corresponde ao mesmo código de cores já usado no status-pill do HUD
    // (idle/falando=azul de destaque, ouvindo=verde de sucesso,
    // processando=amarelo de aviso, desligado=cinza de texto secundário).
    function hexParaRGB(hex) {
        hex = String(hex || '').trim().replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
        const num = parseInt(hex, 16);
        return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
    }
    function lerCorVar(nomeVar, fallback) {
        const valor = getComputedStyle(document.documentElement).getPropertyValue(nomeVar);
        return hexParaRGB(valor) || fallback;
    }
    function montarCoresDoTema() {
        return {
            idle: lerCorVar('--p3-blue-300', { r: 0, g: 243, b: 255 }),
            listening: lerCorVar('--p3-success', { r: 47, g: 143, b: 91 }),
            thinking: lerCorVar('--p3-warning', { r: 255, g: 179, b: 0 }),
            speaking: lerCorVar('--p3-blue-300', { r: 0, g: 243, b: 255 }),
            off: lerCorVar('--p3-text-muted', { r: 110, g: 120, b: 130 }),
        };
    }

    class ParticleSphere {
        constructor(canvas, opcoes) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.opcoes = Object.assign({ quantidade: 850, corBase: null }, opcoes || {});
            this.estado = 'idle';
            this.audioLevel = 0; // 0..1, alimentado pelo AnalyserNode do mic
            this.pulsos = []; // pulsos de fala (TTS), cada um { t0, forca }
            this._raf = null;
            this._t0 = performance.now();
            this._anguloY = 0;
            this._dpr = Math.min(window.devicePixelRatio || 1, 2);
            this._cores = montarCoresDoTema();
            // Reage à troca de tema (botão ou comando de voz) em tempo real —
            // P3.alternarTema() só troca o atributo, sem disparar evento
            // próprio, então observa a mudança do atributo diretamente.
            this._observadorTema = new MutationObserver(() => { this._cores = montarCoresDoTema(); });
            this._observadorTema.observe(document.documentElement, { attributes: true, attributeFilter: ['data-p3-theme'] });
            this._particulas = this._gerarParticulas(this.opcoes.quantidade);
            this._resizeObserver = new ResizeObserver(() => this._ajustarTamanho());
            this._resizeObserver.observe(canvas);
            this._ajustarTamanho();
        }

        // Distribuição de Fibonacci sobre a esfera — bem mais uniforme que
        // pontos aleatórios (evita "aglomerados" nos polos).
        _gerarParticulas(n) {
            const pontos = [];
            const goldenAngle = Math.PI * (3 - Math.sqrt(5));
            for (let i = 0; i < n; i++) {
                const y = 1 - (i / (n - 1)) * 2;
                const raioNoY = Math.sqrt(1 - y * y);
                const theta = goldenAngle * i;
                const x = Math.cos(theta) * raioNoY;
                const z = Math.sin(theta) * raioNoY;
                pontos.push({
                    x, y, z,
                    seed: Math.random() * Math.PI * 2,
                    freq: 0.6 + Math.random() * 1.4,
                    tamanho: 1.1 + Math.random() * 1.6,
                    destaque: Math.random() < 0.06, // partícula "acento" (brilha mais)
                });
            }
            return pontos;
        }

        _ajustarTamanho() {
            const rect = this.canvas.getBoundingClientRect();
            this.canvas.width = Math.max(1, Math.round(rect.width * this._dpr));
            this.canvas.height = Math.max(1, Math.round(rect.height * this._dpr));
            this._w = this.canvas.width;
            this._h = this.canvas.height;
            this._raioBase = Math.min(this._w, this._h) * 0.34;
            this._cx = this._w / 2;
            this._cy = this._h / 2;
        }

        setEstado(estado) {
            if (this._cores[estado]) this.estado = estado;
        }
        // level: 0..1 — amplitude real do microfone (ver AnalyserNode no
        // controlador) ou uma aproximação de amplitude da fala sintetizada.
        setAudioLevel(level) {
            this.audioLevel = Math.max(0, Math.min(1, level || 0));
        }
        // Pulso decorrente de um evento de fala (ex.: boundary do
        // SpeechSynthesisUtterance, que dispara por palavra) — o
        // window.speechSynthesis NÃO expõe a onda sonora real (limitação
        // da própria API do navegador, não dá pra ligar num AnalyserNode),
        // então aqui é uma aproximação rítmica: cada palavra falada gera um
        // pulso decrescente, sincronizando visualmente com a CADÊNCIA da
        // fala mesmo sem acesso à amplitude real.
        pulse(forca) {
            this.pulsos.push({ t0: performance.now(), forca: forca == null ? 1 : forca });
            if (this.pulsos.length > 12) this.pulsos.shift();
        }

        start() {
            if (this._raf) return;
            const loop = () => { this._desenhar(); this._raf = requestAnimationFrame(loop); };
            this._raf = requestAnimationFrame(loop);
        }
        stop() {
            if (this._raf) cancelAnimationFrame(this._raf);
            this._raf = null;
        }
        destroy() {
            this.stop();
            this._resizeObserver.disconnect();
            this._observadorTema.disconnect();
        }

        _desenhar() {
            const ctx = this.ctx;
            const agora = performance.now();
            const t = (agora - this._t0) / 1000;
            const estado = this.estado;
            const cor = this._cores[estado] || this._cores.idle;

            // Velocidade de rotação e "turbulência" variam por estado.
            let velRot = 0.18, turbAmp = 0, turbFreq = 0;
            if (estado === 'listening') { velRot = 0.26; turbAmp = 0.10 + this.audioLevel * 0.55; turbFreq = 3.2; }
            else if (estado === 'thinking') { velRot = 1.35; turbAmp = 0.30; turbFreq = 5.5; }
            else if (estado === 'speaking') { velRot = 0.22; turbAmp = 0.04; turbFreq = 2; }
            else if (estado === 'off') { velRot = 0.05; turbAmp = 0; turbFreq = 0; }
            else { velRot = 0.18; turbAmp = 0.02; turbFreq = 0.6; } // idle

            this._anguloY += velRot * (1 / 60);
            const anguloX = Math.sin(t * 0.35) * 0.18;

            // Pulsos de fala ainda vivos (decaimento exponencial ~350ms).
            const pulsoAtivo = this.pulsos.reduce((acc, p) => {
                const dt = (agora - p.t0) / 1000;
                if (dt > 0.5) return acc;
                return acc + p.forca * Math.exp(-dt * 9) * Math.max(0, 1 - dt / 0.5);
            }, 0);
            this.pulsos = this.pulsos.filter(p => (agora - p.t0) / 1000 <= 0.5);

            ctx.clearRect(0, 0, this._w, this._h);

            // Brilho central (glow) — muda de intensidade com o estado.
            const intensidadeGlow = estado === 'off' ? 0.12 : (0.22 + pulsoAtivo * 0.25 + this.audioLevel * 0.25);
            const grad = ctx.createRadialGradient(this._cx, this._cy, 0, this._cx, this._cy, this._raioBase * 2.1);
            grad.addColorStop(0, `rgba(${cor.r},${cor.g},${cor.b},${intensidadeGlow})`);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, this._w, this._h);

            const cosY = Math.cos(this._anguloY), sinY = Math.sin(this._anguloY);
            const cosX = Math.cos(anguloX), sinX = Math.sin(anguloX);
            const foco = this._raioBase * 2.6;

            // Ordena por profundidade (pinta de trás pra frente) — evita
            // que partículas do fundo apareçam "por cima" das da frente.
            const projetadas = [];
            for (const p of this._particulas) {
                // raio individual: base + respiração idle + turbulência por
                // estado + reação ao áudio (mic ou pulso de fala).
                const respiracao = estado === 'idle' ? Math.sin(t * 0.9 + p.seed) * 0.03 : 0;
                const turb = turbAmp ? Math.sin(t * turbFreq + p.seed * p.freq) * turbAmp : 0;
                const raio = this._raioBase * (1 + respiracao + turb + pulsoAtivo * 0.18 + (estado === 'listening' ? this.audioLevel * 0.15 * Math.sin(p.seed * 7 + t * 6) : 0));

                // Rotação Y depois X (mesma ordem sempre, evita gimbal feio).
                let x = p.x * raio, y = p.y * raio, z = p.z * raio;
                let x1 = x * cosY - z * sinY, z1 = x * sinY + z * cosY;
                let y2 = y * cosX - z1 * sinX, z2 = y * sinX + z1 * cosX;

                const escala = foco / (foco + z2);
                const sx = this._cx + x1 * escala;
                const sy = this._cy + y2 * escala;
                const opacidade = Math.max(0.06, Math.min(1, escala * (estado === 'off' ? 0.35 : 0.85)));
                projetadas.push({ sx, sy, z2, tamanho: p.tamanho * escala * (p.destaque ? 1.9 : 1), opacidade, destaque: p.destaque });
            }
            projetadas.sort((a, b) => a.z2 - b.z2);

            for (const p of projetadas) {
                const brilhoExtra = p.destaque ? 0.35 : 0;
                ctx.beginPath();
                ctx.fillStyle = `rgba(${cor.r},${cor.g},${cor.b},${Math.min(1, p.opacidade + brilhoExtra)})`;
                ctx.arc(p.sx, p.sy, Math.max(0.4, p.tamanho), 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    window.ParticleSphere = ParticleSphere;
})();
