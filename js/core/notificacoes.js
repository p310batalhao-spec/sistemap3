// ====================================================================
// Sistema P3 — Notificações do sino (header unificado)
// ====================================================================
// Carregado automaticamente por js/core/header-nav.js em toda página que
// usa o header unificado (não precisa incluir manualmente). Junta 4
// fontes de notificação — pedido explícito do usuário:
//   1) Avisos lançados pelo admin (page/admin-notificacoes.html), por
//      usuário específico (/notificacoes_usuarios/{cpf} no Firebase da
//      unidade).
//   2) Movimentações do E-SAJ nos TCOs que chegam a um status FINAL —
//      JULGADO, CERTIDÃO ou ARQUIVADO (compara o snapshot salvo no
//      navegador contra o retorno atual de getTCO — só avisa quando MUDA
//      pra um desses 3, nunca no 1º carregamento nem pras ~720 outras
//      variações intermediárias do E-SAJ, tipo "Petição Juntada").
//   3) Eventos de grande porte (>1000 pessoas, cfg.gas.EVENTOS) a 10, 5
//      ou 1 dia de distância — pra preparar a OPO.
//   4) Lembrete de cartão-programa nos últimos 3 dias de cada mês.
//
// Cada notificação tem um "id" estável — usado só pra saber se já foi
// VISTA (zera o badge quando o sino é aberto), guardado em localStorage
// por navegador. Não existe "notificação lida" sincronizada entre
// dispositivos — é um contador local, mesmo espírito do que já existia
// (ver antigo lastCountAIT em js/index.js, removido em favor deste módulo).
(function (global) {
    'use strict';
    if (global.P3Notificacoes) return;

    const CHAVE_VISTAS = 'p3_notif_vistas';
    const CHAVE_PERSISTIDAS = 'p3_notif_persistidas';
    const CHAVE_DISPENSADAS = 'p3_notif_dispensadas';
    const CHAVE_ESAJ_SNAPSHOT = 'p3_notif_esaj_snapshot';
    const CHAVE_ESAJ_ULTIMA_VERIFICACAO = 'p3_notif_esaj_ultima_verificacao';
    const CHAVE_ESAJ_ULTIMAS_NOTIF = 'p3_notif_esaj_ultimas';
    // TCO já teve timeout real na API (ver correção aplicada no Apps
    // Script) — não bate getTCO a cada carregamento de página, só a cada
    // 10min por navegador, pra não gerar carga extra desnecessária.
    const INTERVALO_MIN_VERIFICACAO_ESAJ_MS = 10 * 60 * 1000;
    // Quanto tempo uma notificação fica guardada depois de detectada —
    // só pra não crescer pra sempre no navegador; não tem nada a ver com
    // "ler"/"não ler" (bug relatado: notificação sumia sozinha depois de
    // aberta uma vez, porque antes a lista era recalculada do zero a
    // cada carregamento). Agora só some quando o usuário clica no "×" ou
    // depois desse prazo bem largo.
    const RETENCAO_DIAS = 30;

    function lerVistas() {
        try { return new Set(JSON.parse(localStorage.getItem(CHAVE_VISTAS) || '[]')); }
        catch (e) { return new Set(); }
    }
    function marcarVistas(ids) {
        const vistas = lerVistas();
        ids.forEach(id => vistas.add(id));
        try {
            // Poda pra não crescer pra sempre — mantém só as últimas 300.
            const arr = [...vistas].slice(-300);
            localStorage.setItem(CHAVE_VISTAS, JSON.stringify(arr));
        } catch (e) { /* localStorage indisponível — segue sem persistir */ }
    }

    // ── Persistência — a lista mostrada no sino NÃO é recalculada do
    // zero a cada carregamento (era a causa do bug "some depois de
    // ler"): as notificações detectadas em qualquer carregamento
    // anterior continuam aparecendo até o usuário clicar no "×" (ou
    // passarem os RETENCAO_DIAS), independente de a CONDIÇÃO que gerou
    // ainda valer naquele instante (ex.: uma movimentação de E-SAJ só é
    // detectável no momento em que muda — sem persistência ela some no
    // recarregamento seguinte, mesmo sem o usuário ter visto).
    function lerPersistidas() {
        try { return JSON.parse(localStorage.getItem(CHAVE_PERSISTIDAS) || '[]'); }
        catch (e) { return []; }
    }
    function salvarPersistidas(lista) {
        try { localStorage.setItem(CHAVE_PERSISTIDAS, JSON.stringify(lista)); }
        catch (e) { /* localStorage indisponível — segue sem persistir */ }
    }
    function lerDispensadas() {
        try { return new Set(JSON.parse(localStorage.getItem(CHAVE_DISPENSADAS) || '[]')); }
        catch (e) { return new Set(); }
    }
    // Junta o que acabou de ser detectado com o que já estava guardado
    // (por id, sem duplicar), poda o que passou da retenção e o que já
    // foi dispensado pelo usuário (senão um aviso do admin, por exemplo,
    // voltaria sozinho no próximo carregamento — ele continua existindo
    // no Firebase até o admin apagar), devolve ordenado mais recente
    // primeiro.
    function mesclarNaPersistencia(detectadasAgora) {
        const agora = Date.now();
        const limite = agora - RETENCAO_DIAS * 24 * 60 * 60 * 1000;
        const dispensadas = lerDispensadas();
        const existentes = lerPersistidas();
        const porId = new Map(existentes.map(function (n) { return [n.id, n]; }));
        detectadasAgora.forEach(function (n) {
            if (dispensadas.has(n.id)) return;
            if (!porId.has(n.id)) porId.set(n.id, Object.assign({ criadoEm: agora }, n));
        });
        const mesclada = Array.from(porId.values())
            .filter(function (n) { return (n.criadoEm || agora) >= limite; })
            .sort(function (a, b) { return (b.criadoEm || 0) - (a.criadoEm || 0); });
        salvarPersistidas(mesclada);
        return mesclada;
    }
    function dispensarNotificacao(id) {
        const dispensadas = lerDispensadas();
        dispensadas.add(id);
        try {
            localStorage.setItem(CHAVE_DISPENSADAS, JSON.stringify([...dispensadas].slice(-500)));
        } catch (e) { /* localStorage indisponível — segue sem persistir */ }
        const restante = lerPersistidas().filter(function (n) { return n.id !== id; });
        salvarPersistidas(restante);
        return restante;
    }
    // "Limpar tudo" — não precisa marcar cada id em CHAVE_DISPENSADAS (a
    // lista pode ter centenas de itens): a comparação por STATUS em
    // obterMovimentacoesEsaj já impede que a mesma transição volte
    // sozinha (só a data no fim da Movimentação mudou, o status é o
    // mesmo), então zerar a lista persistida basta.
    function dispensarTodas() {
        salvarPersistidas([]);
        return [];
    }

    function parseDataBR(str) {
        if (!str) return null;
        const s = String(str).trim();
        const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (!m) return null;
        const d = new Date(+m[3], +m[2] - 1, +m[1]);
        d.setHours(0, 0, 0, 0);
        return isNaN(d.getTime()) ? null : d;
    }

    function escaparHtml(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // O E-SAJ grava a Movimentação como "STATUS (dd/mm/aaaa)" (mesmo
    // formato usado em js/dashboard-cruzado.js e page/qualitativo_tco.html)
    // — normaliza sem acento/maiúsculo pra comparar só o status, ignorando
    // a data que vem colada.
    function normalizarMov(s) {
        return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    }
    // Só estes 3 status são "finais"/acionáveis pro operador (o TCO saiu
    // do fluxo normal e precisa de alguma ação/ciência) — pedido explícito
    // do usuário pra não afogar o sino nas ~720 variações intermediárias
    // reais do E-SAJ (Petição Juntada, Audiência Realizada, Concluso para
    // Julgamento etc.), que não exigem nenhuma ação do operador.
    const STATUS_NOTIFICAVEIS_ESAJ = [
        { chave: 'JULGADO', icone: '⚖️', titulo: 'TCO julgado' },
        { chave: 'CERTIDAO', icone: '📜', titulo: 'Certidão do TCO' },
        { chave: 'ARQUIVADO', icone: '🗄️', titulo: 'TCO arquivado' },
    ];
    function statusNotificavelEsaj(mov) {
        const m = normalizarMov(mov);
        return STATUS_NOTIFICAVEIS_ESAJ.find(s => m.includes(s.chave)) || null;
    }

    // ── 1) Avisos do admin ────────────────────────────────────────────
    // Fica no diretório CENTRAL (P3.DIRETORIO_BASE_URL), não no Firebase
    // da unidade — é lá que /usuarios/{cpf} também mora (ver
    // page/admin-usuarios.html), então cadastro de usuário e notificação
    // pra ele ficam no mesmo lugar, independente de unidade.
    async function obterNotificacoesAdmin(cfg, sessao) {
        if (!global.P3 || !global.P3.DIRETORIO_BASE_URL) return [];
        try {
            const res = await fetch(`${global.P3.DIRETORIO_BASE_URL}/notificacoes_usuarios/${encodeURIComponent(sessao.cpf)}.json`);
            const dados = res.ok ? await res.json() : null;
            if (!dados) return [];
            return Object.entries(dados).map(([id, n]) => ({
                id: 'admin:' + id,
                icone: '📢',
                titulo: (n && n.titulo) || 'Aviso do administrador',
                texto: (n && n.texto) || '',
            }));
        } catch (e) { return []; }
    }

    // ── 2) Novas movimentações do E-SAJ (TCO) — só as finais/acionáveis
    // (JULGADO, CERTIDÃO, ARQUIVADO; ver STATUS_NOTIFICAVEIS_ESAJ acima) ──
    async function obterMovimentacoesEsaj(cfg) {
        if (!cfg || !cfg.gas || !cfg.gas.TCO) return [];

        const agora = Date.now();
        const ultima = parseInt(localStorage.getItem(CHAVE_ESAJ_ULTIMA_VERIFICACAO) || '0', 10);
        if (agora - ultima < INTERVALO_MIN_VERIFICACAO_ESAJ_MS) {
            try { return JSON.parse(localStorage.getItem(CHAVE_ESAJ_ULTIMAS_NOTIF) || '[]'); }
            catch (e) { return []; }
        }

        let snapshotAnterior = {};
        try { snapshotAnterior = JSON.parse(localStorage.getItem(CHAVE_ESAJ_SNAPSHOT) || '{}'); } catch (e) {}

        try {
            const res = await fetch(`${cfg.gas.TCO}?action=getTCO`);
            const lista = res.ok ? await res.json() : null;
            if (!Array.isArray(lista)) return [];

            const primeiraVez = Object.keys(snapshotAnterior).length === 0;
            const novoSnapshot = {};
            const notificacoes = [];
            lista.forEach(item => {
                const numero = item['Nº Ocorrência'];
                const mov = (item['Movimentação'] || '').toString().trim();
                if (!numero || !mov) return;
                novoSnapshot[numero] = mov;
                // 1ª vez que este navegador vê a lista: só grava o snapshot,
                // nunca notifica (senão despeja "mudou" pra tudo de uma vez).
                // Só notifica quando o NOVO valor é um dos 3 status finais —
                // uma movimentação intermediária (ex.: "Petição Juntada")
                // não gera notificação, mesmo sendo uma mudança real.
                //
                // IMPORTANTE: compara pelo STATUS (statusNotificavelEsaj),
                // nunca pela string bruta — o E-SAJ grava "STATUS (dd/mm/aaaa)"
                // e essa data é reescrita a cada checagem do acionador diário,
                // mesmo quando o status não mudou (ex.: um TCO já ARQUIVADO
                // há semanas ganha uma data nova todo dia). Comparar a string
                // inteira gerava notificação de "mudança" todo santo dia pra
                // TCO nenhum ter mudado de verdade — só dispara aqui quando o
                // status em si é diferente do que já estava salvo.
                const statusFinal = statusNotificavelEsaj(mov);
                const statusAnterior = snapshotAnterior[numero] !== undefined ? statusNotificavelEsaj(snapshotAnterior[numero]) : null;
                const mudouDeStatus = !statusAnterior || statusAnterior.chave !== (statusFinal && statusFinal.chave);
                if (!primeiraVez && statusFinal && snapshotAnterior[numero] !== undefined && mudouDeStatus) {
                    notificacoes.push({
                        id: 'esaj:' + numero + ':' + mov,
                        icone: statusFinal.icone,
                        titulo: statusFinal.titulo,
                        texto: `TCO ${numero}: ${mov}`,
                    });
                }
            });

            localStorage.setItem(CHAVE_ESAJ_SNAPSHOT, JSON.stringify(novoSnapshot));
            localStorage.setItem(CHAVE_ESAJ_ULTIMA_VERIFICACAO, String(agora));
            localStorage.setItem(CHAVE_ESAJ_ULTIMAS_NOTIF, JSON.stringify(notificacoes));
            return notificacoes;
        } catch (e) { return []; }
    }

    // ── 3) Eventos de grande porte próximos (10/5/1 dia) ───────────────
    async function obterEventosProximos(cfg) {
        if (!cfg || !cfg.gas || !cfg.gas.EVENTOS) return [];
        try {
            const res = await fetch(`${cfg.gas.EVENTOS}?action=read`);
            const lista = res.ok ? await res.json() : null;
            if (!Array.isArray(lista)) return [];

            const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
            const notificacoes = [];
            lista.forEach(ev => {
                const publico = parseInt(ev['ESTIMATIVA DE PÚBLICO'] || ev['ESTIMATIVA DE PUBLICO'] || '0', 10);
                if (!(publico > 1000)) return; // só grande porte
                const dataEvento = parseDataBR(ev.DATA);
                if (!dataEvento) return;
                const diffDias = Math.round((dataEvento - hoje) / 86400000);
                if ([10, 5, 1].indexOf(diffDias) === -1) return;
                notificacoes.push({
                    id: 'evento:' + (ev.ID || ev['NOME DO EVENTO'] || '') + ':' + diffDias,
                    icone: '🎪',
                    titulo: diffDias === 1 ? 'Evento de grande porte amanhã' : `Evento de grande porte em ${diffDias} dias`,
                    texto: `${ev['NOME DO EVENTO'] || 'Evento'} — ${ev.CIDADE || ''} (${ev.DATA}), ~${publico} pessoas. Prepare a OPO.`,
                });
            });
            return notificacoes;
        } catch (e) { return []; }
    }

    // ── 4) Lembrete de cartão-programa (últimos 3 dias do mês) ─────────
    function obterLembreteCartaoPrograma() {
        const hoje = new Date();
        const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
        const diasRestantes = Math.round((fimMes - hoje) / 86400000);
        if (diasRestantes < 0 || diasRestantes > 3) return [];
        const mesLabel = hoje.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        return [{
            id: 'cartao-programa:' + hoje.getFullYear() + '-' + (hoje.getMonth() + 1),
            icone: '🚓',
            titulo: 'Preparar cartão-programa',
            texto: `Faltam ${diasRestantes} dia(s) pro fim de ${mesLabel} — hora de preparar o cartão-programa do mês seguinte.`,
        }];
    }

    // Detecção "crua" — cada fonte reporta o que vale AGORA (ex.: a
    // movimentação do E-SAJ só aparece aqui no instante em que muda).
    // Quem quer a lista completa pra MOSTRAR no sino usa
    // coletarEMesclarPersistidas() logo abaixo, não esta função direto.
    async function coletarTodas() {
        const sessao = (global.P3 && global.P3.getSession) ? global.P3.getSession() : null;
        if (!sessao) return [];
        let cfg;
        try { cfg = await global.P3.loadUnidadeConfig(); } catch (e) { return []; }

        const listas = await Promise.all([
            obterNotificacoesAdmin(cfg, sessao),
            obterMovimentacoesEsaj(cfg),
            obterEventosProximos(cfg),
            Promise.resolve(obterLembreteCartaoPrograma())
        ]);
        return listas.reduce(function (a, b) { return a.concat(b); }, []);
    }

    // O que de fato aparece no sino: detecção crua + o que já estava
    // guardado de carregamentos anteriores (ver mesclarNaPersistencia) —
    // uma notificação só some quando o usuário clica no "×", nunca
    // sozinha (bug relatado: "as notificações desaparecem depois de ler").
    async function coletarEMesclarPersistidas() {
        const detectadas = await coletarTodas();
        return mesclarNaPersistencia(detectadas);
    }

    function renderizar(lista) {
        const container = document.getElementById('notif-items');
        const badge = document.getElementById('notif-count');
        if (!container) return;

        if (!lista.length) {
            container.innerHTML = '<p class="empty-msg">Nenhuma notificação nova</p>';
        } else {
            container.innerHTML = lista.map(function (n) {
                return '<div class="notif-item" data-id="' + escaparHtml(n.id) + '">' +
                    '<button type="button" class="notif-dismiss" title="Dispensar" aria-label="Dispensar">✕</button>' +
                    '<strong>' + (n.icone || '🔔') + ' ' + escaparHtml(n.titulo || '') + '</strong><br>' +
                    escaparHtml(n.texto || '') +
                    '</div>';
            }).join('');
        }

        listaAtual = lista; // ver bell/dismiss wiring em iniciar() — sempre lêem a versão atual, nunca uma cópia presa no closure do render anterior

        const btnLimparTudo = document.getElementById('notif-limpar-tudo');
        if (btnLimparTudo) btnLimparTudo.style.display = lista.length ? '' : 'none';

        if (badge) {
            const vistas = lerVistas();
            const naoVistas = lista.filter(function (n) { return !vistas.has(n.id); });
            if (naoVistas.length > 0) {
                badge.textContent = String(naoVistas.length);
                badge.style.display = 'block';
            } else {
                badge.style.display = 'none';
            }
        }
    }

    // Guardada fora de renderizar() pra os listeners abaixo (wired 1x só,
    // em iniciar) sempre lerem a lista MAIS RECENTE — sem isso, dispensar
    // uma notificação re-renderiza com uma lista nova, mas um listener
    // registrado só na 1ª renderização ficaria preso na lista antiga.
    let listaAtual = [];

    async function iniciar() {
        // Só roda em páginas que têm o header unificado (header-nav.js já
        // injetou #notif-items antes do DOMContentLoaded) — nas poucas
        // páginas ainda não migradas isso simplesmente não faz nada.
        const container = document.getElementById('notif-items');
        if (!container) return;

        // Abrir o sino marca tudo que está na lista agora como "visto"
        // (zera o badge) — mesmo critério simples que o sino antigo já
        // usava (index.js), só que agregando as 4 fontes. As
        // notificações CONTINUAM na lista depois disso — só o contador
        // some, igual "marcar como lido" no Gmail.
        const bell = document.getElementById('bell-icon');
        if (bell) {
            bell.addEventListener('click', function () {
                marcarVistas(listaAtual.map(function (n) { return n.id; }));
            });
        }

        // "×" de cada notificação — 1 listener só, por delegação (a
        // lista é reconstruída via innerHTML a cada render, então um
        // listener por item se perderia).
        container.addEventListener('click', function (e) {
            const btn = e.target.closest('.notif-dismiss');
            if (!btn) return;
            const item = btn.closest('.notif-item');
            const id = item && item.dataset.id;
            if (!id) return;
            renderizar(dispensarNotificacao(id));
        });

        const btnLimparTudo = document.getElementById('notif-limpar-tudo');
        if (btnLimparTudo) {
            btnLimparTudo.addEventListener('click', function (e) {
                e.stopPropagation(); // não deixa fechar o dropdown pelo listener do header-nav.js
                renderizar(dispensarTodas());
            });
        }

        try {
            renderizar(await coletarEMesclarPersistidas());
        } catch (e) { console.error('[P3Notificacoes]', e); }
    }

    global.P3Notificacoes = { coletarTodas: coletarTodas, iniciar: iniciar };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})(window);
