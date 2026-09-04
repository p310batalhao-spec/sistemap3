// ====================================================================
// Sistema P3 — Notificações do sino (header unificado)
// ====================================================================
// Carregado automaticamente por js/core/header-nav.js em toda página que
// usa o header unificado (não precisa incluir manualmente). Junta 8
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
//   5) Novo acionamento do Botão do Pânico (Patrulha Maria da Penha —
//      Sistema Íris PMAL, API à parte na Hostinger; ver
//      js/core/iris-panico-client.js e page/acionamentos-panico.html).
//   6) Risco elevado de CVLI/MVI previsto por local (cidade+bairro) nos
//      próximos dias — js/machineLearningLeve.js (regressão logística
//      leve, ver preverRiscoPorLocal). Clicável: leva direto pra seção
//      de previsão em page/analisePreditiva.html.
//   7) Movimentação/alerta importante no(s) processo(s) e-SAJ de um
//      AUTOR (P3.Autores — Firebase ou Hostinger conforme a unidade, ver
//      js/core/session.js). Movimentação de rotina só dispara pra uma
//      lista FIXA de 9 códigos do DataJud
//      (CODIGOS_MOVIMENTO_AUTOR_NOTIFICAVEIS, diferente da categorização
//      por status usada na fonte 2); ALERTA IMPORTANTE (campo
//      alertaImportante/alertaImportanteEm, gravado pelo Apps Script
//      quando detecta mandado de prisão/busca, alvará, revogação de
//      prisão etc. — ver PADROES_ALERTA_IMPORTANTE em
//      apps-script/autores-esaj-hostinger.gs) dispara SEMPRE, fora dos 9
//      códigos, com ícone/prioridade diferentes.
//   8) Mesma coisa que a fonte 7, só que pra SUSPEITOS (P3.Suspeitos) —
//      uma pessoa pode ter vários processos, então percorre o array
//      `processos` de cada suspeito.
//   9) Registro AUTOMÁTICO da previsão mensal do Preditiva CAD, faltando
//      5, 3, 2 ou 1 dia(s) pro fim do mês (só 10º BPM) — diferente das
//      demais, essa fonte AGE (busca no CAD, classifica CVP/CVLI/MVI e
//      grava no Firebase via js/core/previsaoMensalCad.js), não só
//      detecta algo pra avisar; só notifica de verdade se falhar (login
//      do CAD ausente/expirado) ou quando consegue gravar com sucesso.
//
// MINI-ABAS no dropdown (#notif-tabs) — cada notificação carrega um
// campo `categoria` ('tco' | 'autores' | 'eventos' | 'outros') definido
// na própria fonte que a gerou; fontes 2→tco, 3→eventos, 7 e 8→autores
// (inclui os alertas importantes), as demais (1/4/5/6)→outros. Ver
// atualizarTabs()/renderizar() mais abaixo.
//
// SEGMENTAÇÃO POR PAPEL (nivel da sessão) — única exceção à regra "todo
// mundo recebe as mesmas fontes": nível 'p2' recebe SÓ as fontes 7 e 8
// (perde as outras 6); nível 'admin' mantém as 6 de sempre E ganha 7 e 8;
// qualquer outro nível continua recebendo só as 6 originais. Ver
// coletarTodas() logo abaixo.
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
    const CHAVE_PANICO_SNAPSHOT = 'p3_notif_panico_snapshot';
    const CHAVE_PANICO_ULTIMA_VERIFICACAO = 'p3_notif_panico_ultima_verificacao';
    const CHAVE_PANICO_ULTIMAS_NOTIF = 'p3_notif_panico_ultimas';
    // Botão do pânico é urgente de verdade — intervalo bem mais curto que
    // o do E-SAJ (não é possível ter push real sem um servidor próprio,
    // isso aqui só reduz o atraso do polling ao mínimo razoável).
    const INTERVALO_MIN_VERIFICACAO_PANICO_MS = 2 * 60 * 1000;
    const CHAVE_RISCO_LOCAL_ULTIMA_VERIFICACAO = 'p3_notif_risco_ultima_verificacao';
    // Ranking BRUTO (top 3, sem limiar) — a notificação do sino (fonte 6)
    // deriva o que precisa disso na hora, em vez de cachear separado; o
    // card "Resumo Preditivo" da home (index.html, 02/09/2026) usa o
    // mesmo cache, sem limiar de alarme nenhum (mostra o panorama sempre).
    const CHAVE_RISCO_LOCAL_RESULTADO = 'p3_notif_risco_resultado_bruto';
    // Cálculo mais pesado que os outros (2 fetches de nós que podem ser
    // grandes + treino de regressão logística) e "risco por local nos
    // próximos dias" não muda de hora em hora — 6h é generoso o
    // suficiente sem recalcular à toa a cada navegação de página.
    const INTERVALO_MIN_VERIFICACAO_RISCO_MS = 6 * 60 * 60 * 1000;
    // Quanto tempo uma notificação fica guardada depois de detectada —
    // só pra não crescer pra sempre no navegador; não tem nada a ver com
    // "ler"/"não ler" (bug relatado: notificação sumia sozinha depois de
    // aberta uma vez, porque antes a lista era recalculada do zero a
    // cada carregamento). Agora só some quando o usuário clica no "×" ou
    // depois desse prazo bem largo.
    const RETENCAO_DIAS = 30;
    // Registro automático da previsão mensal do Preditiva CAD (fonte 9,
    // 02/09/2026) — só tenta 1x por dia por navegador (a tentativa em si
    // já é idempotente do lado do Firebase, mas não há motivo pra bater
    // no CAD de novo a cada navegação de página no mesmo dia).
    const CHAVE_PREVISAO_CAD_PREFIXO = 'p3_notif_previsao_cad_tentativa:';

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

    // ISO 8601 -> "23/08/2026 09:35" no fuso do navegador — mesmo formato
    // de js/autores.js (formatarDataHoraIso), reproduzido aqui porque
    // notificacoes.js roda em TODA página com header unificado, não só em
    // autores.html (esse módulo não está sempre carregado).
    //
    // Usado pra mostrar "verificado em" ao lado da movimentação de
    // autor/suspeito: a data que vem dentro do texto de
    // movimentacaoAutor/movimentacaoProcesso é a do MOVIMENTO em si (ex.:
    // "Expedição de mandado (20/07/2026)"), que é só o que o DataJud do
    // CNJ tinha registrado — o DataJud é uma RÉPLICA do e-SAJ sincronizada
    // periodicamente pelo tribunal, não em tempo real, então pode ficar
    // dias/semanas atrás do que aparece ao vivo no e-SAJ. Sem o
    // "verificado em", a notificação parecia estar mostrando uma
    // atualização de hoje quando na verdade era só a movimentação MAIS
    // RECENTE QUE O DATAJUD CONHECIA na última vez que o robô checou —
    // deixa isso explícito em vez de dar a entender que o sistema está
    // atrasado/quebrado.
    function formatarDataHoraLocal(iso) {
        if (!iso) return null;
        const d = new Date(iso);
        if (isNaN(d.getTime())) return null;
        const dia = String(d.getDate()).padStart(2, '0');
        const mes = String(d.getMonth() + 1).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${dia}/${mes}/${d.getFullYear()} ${hh}:${mm}`;
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
                categoria: 'outros',
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
                        categoria: 'tco',
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
                    categoria: 'eventos',
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
            categoria: 'outros',
            icone: '🚓',
            titulo: 'Preparar cartão-programa',
            texto: `Faltam ${diasRestantes} dia(s) pro fim de ${mesLabel} — hora de preparar o cartão-programa do mês seguinte.`,
        }];
    }

    // ── 9) Registro automático da previsão mensal do Preditiva CAD —
    // 02/09/2026, pedido explícito do usuário: "quero que faltando 5, 3,
    // 2 e 1 dia avise que o mês está finalizando e precisa de uma nova
    // análise preditiva ou faça isso automaticamente quando abrir o exe
    // com os dados do CAD" — escolheu a opção automática.
    //
    // Diferente das outras 8 fontes (que só LEEM/detectam algo pra
    // avisar), esta AGE de verdade: busca no CAD, classifica CVP/CVLI/MVI
    // e grava a previsão do PRÓXIMO mês no Firebase (mesmo mecanismo de
    // js/preditivaCAD.js, compartilhado via js/core/previsaoMensalCad.js)
    // — sem precisar a página Preditiva CAD estar aberta. Rodar isso
    // ANTES do mês virar (faltando 5/3/2/1 dia(s)) evita o problema real
    // já relatado pelo usuário: se ninguém abrir a tela até o mês virar,
    // o mês corrente "contamina" o cálculo do que deveria ser uma
    // previsão às cegas.
    //
    // Só pro 10º BPM (mesmo recurso do Preditiva CAD). Exige login no
    // CAD (Apps Script, mesmo token do modal único, ver
    // js/core/cad-login-modal.js) já configurado — se a tentativa falhar
    // (token ausente/expirado), avisa pra configurar em vez de tentar de
    // novo em silêncio pra sempre sem ninguém saber que nunca funcionou.
    async function obterERegistrarPrevisaoMensalCad(cfg, sessao) {
        if (!sessao || sessao.unidadeId !== '10bpm') return [];
        if (typeof global.PrevisaoMensalCAD === 'undefined') return [];
        if (!cfg || !cfg.firebase || !cfg.firebase.databaseURL) return [];

        const hoje = new Date();
        const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
        const diasRestantes = Math.round((fimMes - hoje) / 86400000);
        if ([5, 3, 2, 1].indexOf(diasRestantes) === -1) return [];

        const hojeStr = hoje.toISOString().slice(0, 10);
        const chaveTentativa = CHAVE_PREVISAO_CAD_PREFIXO + hojeStr;
        try {
            const jaTentado = localStorage.getItem(chaveTentativa);
            if (jaTentado) return JSON.parse(jaTentado);
        } catch (e) { /* cache corrompido — tenta de novo */ }

        const mesLabel = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        let resultado;
        try {
            resultado = await global.PrevisaoMensalCAD.registrarPrevisaoProximoMesSeNecessario(cfg.firebase.databaseURL);
        } catch (e) {
            resultado = { status: 'erro', mensagem: e.message };
        }

        let notif;
        if (resultado.status === 'gravada') {
            const p = resultado.previsaoMensal || {};
            notif = [{
                id: 'previsao-cad:' + resultado.mesAlvo,
                categoria: 'outros', icone: '🎯',
                titulo: 'Previsão preditiva registrada',
                texto: `Previsão de ${mesLabel} registrada automaticamente (CVP ${p.cvp} · CVLI ${p.cvli} · MVI ${p.mvi}) — ${diasRestantes} dia(s) antes do fim do mês.`,
            }];
        } else if (resultado.status === 'ja_existia' || resultado.status === 'sem_dados') {
            notif = []; // já tinha previsão gravada (manual ou automática), ou não há dado suficiente ainda — nada a avisar
        } else {
            notif = [{
                id: 'previsao-cad-falha:' + hoje.getFullYear() + '-' + (hoje.getMonth() + 1) + '-' + diasRestantes,
                categoria: 'outros', icone: '⚠️',
                titulo: 'Previsão preditiva NÃO registrada',
                texto: `Faltam ${diasRestantes} dia(s) pro fim de ${mesLabel} e o sistema não conseguiu registrar a previsão automaticamente (${resultado.mensagem || 'falha desconhecida'}) — abra "🔑 Login CAD / Quimera" pra renovar o token e depois o Preditiva CAD.`,
            }];
        }

        try { localStorage.setItem(chaveTentativa, JSON.stringify(notif)); }
        catch (e) { /* sem cache, sem problema — só tenta de novo no próximo carregamento hoje */ }
        return notif;
    }

    // ── 5) Novos acionamentos do Botão do Pânico (Patrulha Maria da
    // Penha — Sistema Íris PMAL, projeto à parte na Hostinger) — ver
    // js/core/iris-panico-client.js. Só avisa de acionamento NOVO (id
    // nunca visto por este navegador), não de mudança de status — um
    // "novo acionamento" é sempre urgente, diferente do E-SAJ.
    //
    // Depende do token pessoal do Íris (localStorage['irisToken'],
    // ver login.html/rastreamento-guarnicao.html) — sem token, essa
    // fonte simplesmente não contribui nenhuma notificação, em silêncio
    // (mesmo espírito "best-effort" já adotado ali: não é o sino que
    // deve pedir pra autenticar no Íris no meio da navegação).
    async function obterAcionamentosPanico() {
        if (typeof IrisPanico === 'undefined' || !IrisPanico.temToken()) return [];

        const agora = Date.now();
        const ultima = parseInt(localStorage.getItem(CHAVE_PANICO_ULTIMA_VERIFICACAO) || '0', 10);
        if (agora - ultima < INTERVALO_MIN_VERIFICACAO_PANICO_MS) {
            try { return JSON.parse(localStorage.getItem(CHAVE_PANICO_ULTIMAS_NOTIF) || '[]'); }
            catch (e) { return []; }
        }

        let idsAnteriores = new Set();
        try { idsAnteriores = new Set(JSON.parse(localStorage.getItem(CHAVE_PANICO_SNAPSHOT) || '[]')); } catch (e) {}

        try {
            const lista = await IrisPanico.listarAcionamentos(150);
            // 1ª vez que este navegador vê a lista: só grava o snapshot,
            // nunca notifica (senão despeja todo o histórico de uma vez).
            const primeiraVez = idsAnteriores.size === 0;
            const notificacoes = [];
            const novoSnapshot = [];
            lista.forEach(item => {
                if (!item.id) return;
                novoSnapshot.push(item.id);
                if (!primeiraVez && !idsAnteriores.has(item.id)) {
                    notificacoes.push({
                        id: 'panico:' + item.id,
                        categoria: 'outros',
                        icone: '🚨',
                        titulo: 'Botão do pânico acionado',
                        texto: `${item.nome_assistida || 'Assistida não identificada'}` +
                            (item.cidade ? ` — ${item.cidade}` : '') +
                            (item.telefone ? ` · ${item.telefone}` : ''),
                    });
                }
            });

            localStorage.setItem(CHAVE_PANICO_SNAPSHOT, JSON.stringify(novoSnapshot.slice(-500)));
            localStorage.setItem(CHAVE_PANICO_ULTIMA_VERIFICACAO, String(agora));
            localStorage.setItem(CHAVE_PANICO_ULTIMAS_NOTIF, JSON.stringify(notificacoes));
            return notificacoes;
        } catch (e) { console.warn('[P3Notificacoes] Botão do pânico:', e.message); return []; }
    }

    // ── 6) Risco elevado de CVLI/MVI previsto por local (cidade+bairro)
    // nos próximos dias — js/machineLearningLeve.js (preverRiscoPorLocal,
    // regressão logística leve treinada do zero). Não depende de nenhuma
    // outra tela ter sido aberta antes (busca os nós geral/cvp direto,
    // igual js/analisePreditiva.js faz) — só entra em ação se o módulo
    // de ML estiver carregado (ver js/core/header-nav.js) e se houver
    // histórico suficiente pra prever com segurança (ver preverRiscoPorLocal).
    // Prefixo de página igual ao já usado em js/xerife.js (prefixoPagina).
    function _prefixoPaginaRisco() {
        return /\/(page|relatorios|public|termos)\//.test(location.pathname) ? '../' : '';
    }
    // Cálculo BRUTO (fetch + classificação leve + MLLeve) — extraído de
    // obterRiscoLocalPrevisto (02/09/2026) pra virar a base compartilhada
    // entre a notificação do sino (fonte 6, só o top1 SE passar de 50%) e
    // o card "Resumo Preditivo" da home (index.html, mostra até top3
    // SEMPRE, mesmo sem passar de limiar nenhum — ver
    // window.P3Notificacoes.obterResumoRiscoPorLocal). topN:3 sempre
    // calculado aqui; cada consumidor decide quanto do ranking usar.
    async function _calcularRiscoPorLocal(cfg) {
        if (!cfg || !cfg.firebase || !cfg.firebase.databaseURL) return null;
        if (typeof global.MLLeve === 'undefined' || !global.MLLeve) return null;

        const agora = Date.now();
        const ultima = parseInt(localStorage.getItem(CHAVE_RISCO_LOCAL_ULTIMA_VERIFICACAO) || '0', 10);
        if (agora - ultima < INTERVALO_MIN_VERIFICACAO_RISCO_MS) {
            try { return JSON.parse(localStorage.getItem(CHAVE_RISCO_LOCAL_RESULTADO) || 'null'); }
            catch (e) { return null; }
        }

        try {
            const [resGeral, resCVP] = await Promise.all([
                fetch(`${cfg.firebase.databaseURL}/geral.json`),
                fetch(`${cfg.firebase.databaseURL}/cvp.json`),
            ]);
            const dadosGeral = (await resGeral.json()) || {};
            const dadosCVP = (await resCVP.json()) || {};

            // Mesmo critério de CVLI (HOMICIDIO/FEMINICIDIO/LATROCINIO,
            // excluindo ACHADO/SUICIDIO/VIOLACAO) já usado em
            // js/analisePreditiva.js — versão enxuta só com o necessário
            // pra classificar grave:true/false, sem duplicar a tela toda.
            const normTxt = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
            const ehCVLI = t => t.includes('HOMICIDIO') || t.includes('FEMINICIDIO') || t.includes('LATROCINIO');
            const parseDataItem = item => {
                const s = (item.DATA || item.data || '').toString().trim();
                if (!s || s === '---') return null;
                let d;
                if (s.includes('/')) { const p = s.split('/'); if (p.length < 3) return null; d = new Date(+p[2], +p[1] - 1, +p[0]); }
                else if (s.includes('-')) d = new Date(s.substring(0, 10));
                return (!d || isNaN(d.getTime())) ? null : d;
            };

            const flat = [];
            Object.values(dadosGeral).forEach(item => {
                const t = normTxt((item.TIPIFICACAO_GERAL || '') + ' ' + (item.TIPIFICACAO || ''));
                if (t.includes('ACHADO') || t.includes('SUICIDIO') || t.includes('VIOLACAO') || !ehCVLI(t)) return;
                const data = parseDataItem(item);
                if (!data) return;
                flat.push({ cidade: item.CIDADE, bairro: item.BAIRRO, data, grave: true });
            });
            Object.values(dadosCVP).forEach(item => {
                const data = parseDataItem(item);
                if (!data) return;
                flat.push({ cidade: item.CIDADE, bairro: item.BAIRRO, data, grave: false });
            });

            const resultado = global.MLLeve.preverRiscoPorLocal(flat, { janelaDias: 7, topN: 3 });
            localStorage.setItem(CHAVE_RISCO_LOCAL_ULTIMA_VERIFICACAO, String(agora));
            localStorage.setItem(CHAVE_RISCO_LOCAL_RESULTADO, JSON.stringify(resultado));
            return resultado;
        } catch (e) {
            console.warn('[P3Notificacoes] Risco por local:', e.message);
            return null;
        }
    }

    async function obterRiscoLocalPrevisto(cfg) {
        const resultado = await _calcularRiscoPorLocal(cfg);
        if (!resultado) return [];

        const notificacoes = [];
        // Só notifica quando o modelo teve dado suficiente pra calibrar E
        // o local no topo do ranking passa de um limiar razoável — um
        // ranking com o "mais provável" em 8% não merece empurrar uma
        // notificação, é só ruído estatístico.
        const LIMIAR_NOTIFICAVEL = 0.5;
        if (resultado.calibrado && resultado.ranking.length && resultado.ranking[0].probabilidade >= LIMIAR_NOTIFICAVEL) {
            const top = resultado.ranking[0];
            const hojeStr = new Date().toISOString().slice(0, 10);
            notificacoes.push({
                id: 'risco-local:' + top.cidade + '|' + top.bairro + ':' + hojeStr,
                categoria: 'outros',
                icone: '🎯',
                titulo: 'Risco elevado de CVLI/MVI previsto',
                texto: `${top.cidade} — ${top.bairro}: ${Math.round(top.probabilidade * 100)}% de probabilidade nos próximos ${resultado.janelaDias} dias (previsão automática, modelo leve).`,
                link: _prefixoPaginaRisco() + 'page/analisePreditiva.html#secao-risco-local',
            });
        }
        return notificacoes;
    }

    // Exposta publicamente (ver global.P3Notificacoes no fim do arquivo)
    // — usada pelo card "Resumo Preditivo" da home (index.html,
    // 02/09/2026, pedido explícito do usuário: "quero que sempre analise
    // e informe se algo pode acontecer em alguma cidade"). Diferente de
    // obterRiscoLocalPrevisto (só notifica acima de 50%), esta devolve o
    // ranking (até 3 locais) SEMPRE que o modelo conseguiu calibrar —
    // um resumo informativo não deveria ficar mudo só porque nada é
    // "urgente" hoje.
    async function obterResumoRiscoPorLocal(cfg) {
        return await _calcularRiscoPorLocal(cfg);
    }

    // ── 7) Movimentação no processo E-SAJ de um autor (só papéis 'p2' e
    // 'admin' recebem esta fonte — ver coletarTodas() abaixo) ──────────
    const CHAVE_AUTOR_ESAJ_SNAPSHOT = 'p3_notif_autor_esaj_snapshot';
    const CHAVE_AUTOR_ESAJ_ULTIMA_VERIFICACAO = 'p3_notif_autor_esaj_ultima_verificacao';
    const CHAVE_AUTOR_ESAJ_ULTIMAS_NOTIF = 'p3_notif_autor_esaj_ultimas';
    const CHAVE_AUTOR_ALERTA_SNAPSHOT = 'p3_notif_autor_alerta_snapshot';
    const INTERVALO_MIN_VERIFICACAO_AUTOR_ESAJ_MS = 10 * 60 * 1000;
    // Lista fixa de códigos DataJud — pedido explícito do usuário,
    // DIFERENTE da categorização por status (STATUS_NOTIFICAVEIS_ESAJ)
    // já usada pra TCO. Redundante com o filtro que o Apps Script já
    // aplica antes de gravar ultimoCodigoMovimento (só grava um dos 9),
    // mas reforçado aqui por defesa em profundidade — se o schema mudar
    // do lado do GAS, esta página não passa a notificar código nenhum.
    const CODIGOS_MOVIMENTO_AUTOR_NOTIFICAVEIS = [60, 61, 11384, 11385, 62, 11386, 63, 11383, 11387];

    async function obterMovimentacoesEsajAutor(cfg) {
        if (!cfg || (!(cfg.firebase && cfg.firebase.databaseURL) && !(window.P3 && P3.Autores && P3.Autores.usaApiPhp(cfg)))) return [];

        const agora = Date.now();
        const ultima = parseInt(localStorage.getItem(CHAVE_AUTOR_ESAJ_ULTIMA_VERIFICACAO) || '0', 10);
        if (agora - ultima < INTERVALO_MIN_VERIFICACAO_AUTOR_ESAJ_MS) {
            try { return JSON.parse(localStorage.getItem(CHAVE_AUTOR_ESAJ_ULTIMAS_NOTIF) || '[]'); }
            catch (e) { return []; }
        }

        let snapshotAnterior = {};
        try { snapshotAnterior = JSON.parse(localStorage.getItem(CHAVE_AUTOR_ESAJ_SNAPSHOT) || '{}'); } catch (e) {}
        let snapshotAlertaAnterior = {};
        try { snapshotAlertaAnterior = JSON.parse(localStorage.getItem(CHAVE_AUTOR_ALERTA_SNAPSHOT) || '{}'); } catch (e) {}

        try {
            // P3.Autores decide Firebase vs API PHP (Hostinger, 10º BPM) —
            // ver js/core/session.js. Mesmo formato de retorno dos dois lados.
            const dados = await P3.Autores.listar(cfg);
            if (!dados || !Object.keys(dados).length) return [];

            const primeiraVez = Object.keys(snapshotAnterior).length === 0;
            const primeiraVezAlerta = Object.keys(snapshotAlertaAnterior).length === 0;
            const novoSnapshot = {};
            const novoSnapshotAlerta = {};
            const notificacoes = [];
            Object.entries(dados).forEach(([id, a]) => {
                if (!a || a.ENVOLVIMENTO !== 'AUTOR') return;

                // Rotina (só os 9 códigos monitorados) — como já era.
                // Number(...) — a API PHP/MySQL (Hostinger) devolve
                // ultimoCodigoMovimento como texto (coluna VARCHAR), o
                // Firebase devolve number; sem essa normalização o
                // indexOf() nunca bate pro lado Hostinger (string !==
                // number é sempre diferente em comparação estrita).
                const codigo = a.ultimoCodigoMovimento != null ? Number(a.ultimoCodigoMovimento) : null;
                if (codigo && CODIGOS_MOVIMENTO_AUTOR_NOTIFICAVEIS.indexOf(codigo) !== -1) {
                    // Chave = código + timestamp bruto do DataJud — só
                    // notifica de novo se QUALQUER um dos dois mudar (ex.:
                    // um novo movimento monitorado substituiu o anterior).
                    const chave = codigo + '@' + (a.ultimaMovimentacaoEm || '');
                    novoSnapshot[id] = chave;
                    if (!primeiraVez && snapshotAnterior[id] !== undefined && snapshotAnterior[id] !== chave) {
                        const verificadoFmt = formatarDataHoraLocal(a.verificadoEm);
                        notificacoes.push({
                            id: 'autor-esaj:' + id + ':' + chave,
                            categoria: 'autores',
                            icone: '⚖️',
                            titulo: 'Movimentação no processo do autor',
                            texto: `${a.NOME || 'Autor'}: ${a.movimentacaoAutor || ''}` +
                                (verificadoFmt ? ` (verificado em ${verificadoFmt})` : ''),
                            link: _prefixoPaginaRisco() + 'page/autores.html',
                        });
                    }
                }

                // Alerta importante (independente dos 9 códigos — mandado de
                // prisão/busca, alvará, revogação de prisão etc., ver
                // PADROES_ALERTA_IMPORTANTE no Apps Script). Sempre urgente,
                // por isso ícone/prefixo diferentes da movimentação de rotina.
                if (a.alertaImportante && a.alertaImportanteEm) {
                    const chaveAlerta = a.alertaImportanteEm + '@' + a.alertaImportante;
                    novoSnapshotAlerta[id] = chaveAlerta;
                    if (!primeiraVezAlerta && snapshotAlertaAnterior[id] !== undefined && snapshotAlertaAnterior[id] !== chaveAlerta) {
                        notificacoes.push({
                            id: 'autor-alerta:' + id + ':' + chaveAlerta,
                            categoria: 'autores',
                            icone: '🚨',
                            titulo: 'Evento importante no processo do autor',
                            texto: `${a.NOME || 'Autor'}: ${a.alertaImportante}`,
                            link: _prefixoPaginaRisco() + 'page/autores.html',
                        });
                    }
                }
            });

            localStorage.setItem(CHAVE_AUTOR_ESAJ_SNAPSHOT, JSON.stringify(novoSnapshot));
            localStorage.setItem(CHAVE_AUTOR_ALERTA_SNAPSHOT, JSON.stringify(novoSnapshotAlerta));
            localStorage.setItem(CHAVE_AUTOR_ESAJ_ULTIMA_VERIFICACAO, String(agora));
            localStorage.setItem(CHAVE_AUTOR_ESAJ_ULTIMAS_NOTIF, JSON.stringify(notificacoes));
            return notificacoes;
        } catch (e) { return []; }
    }

    // ── 8) Movimentação/alerta nos processos e-SAJ de um SUSPEITO (mesma
    // regra de segmentação por papel de source 7 — ver coletarTodas()).
    // Diferente de Autores: uma pessoa pode ter VÁRIOS processos, então
    // percorre o array `processos` de cada suspeito, não um único campo.
    const CHAVE_SUSPEITO_ESAJ_SNAPSHOT = 'p3_notif_suspeito_esaj_snapshot';
    const CHAVE_SUSPEITO_ESAJ_ULTIMA_VERIFICACAO = 'p3_notif_suspeito_esaj_ultima_verificacao';
    const CHAVE_SUSPEITO_ESAJ_ULTIMAS_NOTIF = 'p3_notif_suspeito_esaj_ultimas';
    const CHAVE_SUSPEITO_ALERTA_SNAPSHOT = 'p3_notif_suspeito_alerta_snapshot';
    const INTERVALO_MIN_VERIFICACAO_SUSPEITO_ESAJ_MS = 10 * 60 * 1000;

    async function obterMovimentacoesEsajSuspeito(cfg) {
        if (!cfg || !(window.P3 && P3.Suspeitos && P3.Suspeitos.disponivel(cfg))) return [];

        const agora = Date.now();
        const ultima = parseInt(localStorage.getItem(CHAVE_SUSPEITO_ESAJ_ULTIMA_VERIFICACAO) || '0', 10);
        if (agora - ultima < INTERVALO_MIN_VERIFICACAO_SUSPEITO_ESAJ_MS) {
            try { return JSON.parse(localStorage.getItem(CHAVE_SUSPEITO_ESAJ_ULTIMAS_NOTIF) || '[]'); }
            catch (e) { return []; }
        }

        let snapshotAnterior = {};
        try { snapshotAnterior = JSON.parse(localStorage.getItem(CHAVE_SUSPEITO_ESAJ_SNAPSHOT) || '{}'); } catch (e) {}
        let snapshotAlertaAnterior = {};
        try { snapshotAlertaAnterior = JSON.parse(localStorage.getItem(CHAVE_SUSPEITO_ALERTA_SNAPSHOT) || '{}'); } catch (e) {}

        try {
            const dados = await P3.Suspeitos.listar(cfg);
            if (!dados || !Object.keys(dados).length) return [];

            const primeiraVez = Object.keys(snapshotAnterior).length === 0;
            const primeiraVezAlerta = Object.keys(snapshotAlertaAnterior).length === 0;
            const novoSnapshot = {};
            const novoSnapshotAlerta = {};
            const notificacoes = [];
            Object.values(dados).forEach(s => {
                if (!s || !Array.isArray(s.processos)) return;
                s.processos.forEach(p => {
                    const chaveProc = 'susp:' + s.id + ':' + p.id;

                    const codigo = p.ultimoCodigoMovimento != null ? Number(p.ultimoCodigoMovimento) : null;
                    if (codigo && CODIGOS_MOVIMENTO_AUTOR_NOTIFICAVEIS.indexOf(codigo) !== -1) {
                        const chave = codigo + '@' + (p.ultimaMovimentacaoEm || '');
                        novoSnapshot[chaveProc] = chave;
                        if (!primeiraVez && snapshotAnterior[chaveProc] !== undefined && snapshotAnterior[chaveProc] !== chave) {
                            const verificadoFmt = formatarDataHoraLocal(p.verificadoEm);
                            notificacoes.push({
                                id: 'suspeito-esaj:' + chaveProc + ':' + chave,
                                categoria: 'autores',
                                icone: '⚖️',
                                titulo: 'Movimentação no processo do suspeito',
                                texto: `${s.NOME || 'Suspeito'}: ${p.movimentacaoProcesso || ''}` +
                                    (verificadoFmt ? ` (verificado em ${verificadoFmt})` : ''),
                                link: _prefixoPaginaRisco() + 'page/autores.html',
                            });
                        }
                    }

                    if (p.alertaImportante && p.alertaImportanteEm) {
                        const chaveAlerta = p.alertaImportanteEm + '@' + p.alertaImportante;
                        novoSnapshotAlerta[chaveProc] = chaveAlerta;
                        if (!primeiraVezAlerta && snapshotAlertaAnterior[chaveProc] !== undefined && snapshotAlertaAnterior[chaveProc] !== chaveAlerta) {
                            notificacoes.push({
                                id: 'suspeito-alerta:' + chaveProc + ':' + chaveAlerta,
                                categoria: 'autores',
                                icone: '🚨',
                                titulo: 'Evento importante no processo do suspeito',
                                texto: `${s.NOME || 'Suspeito'}: ${p.alertaImportante}`,
                                link: _prefixoPaginaRisco() + 'page/autores.html',
                            });
                        }
                    }
                });
            });

            localStorage.setItem(CHAVE_SUSPEITO_ESAJ_SNAPSHOT, JSON.stringify(novoSnapshot));
            localStorage.setItem(CHAVE_SUSPEITO_ALERTA_SNAPSHOT, JSON.stringify(novoSnapshotAlerta));
            localStorage.setItem(CHAVE_SUSPEITO_ESAJ_ULTIMA_VERIFICACAO, String(agora));
            localStorage.setItem(CHAVE_SUSPEITO_ESAJ_ULTIMAS_NOTIF, JSON.stringify(notificacoes));
            return notificacoes;
        } catch (e) { return []; }
    }

    // ── 10) Novidades na Lista de Interesses (módulo P2, 04/09/2026,
    // pedido explícito do usuário: "mostrando também no sininho de
    // notificações") — mesma segmentação de papel das fontes 7/8 (só
    // 'p2' e 'admin'). NÃO dispara nenhuma consulta ao CAD/Quimera — só
    // LÊ o cache já calculado (P3.ConsultaIntegrada, chaveado por CPF,
    // ver hostinger-api/consulta_integrada.php) e compara contra o que
    // este navegador já tinha visto. A consulta de verdade acontece só
    // quando alguém abre page/lista-interesses.html (lá sim, com CAD
    // aberto) — este módulo só percebe QUE mudou, não é quem descobre.
    const CHAVE_INTERESSE_SNAPSHOT = 'p3_notif_interesse_snapshot';
    const CHAVE_INTERESSE_ULTIMA_VERIFICACAO = 'p3_notif_interesse_ultima_verificacao';
    const CHAVE_INTERESSE_ULTIMAS_NOTIF = 'p3_notif_interesse_ultimas';
    const INTERVALO_MIN_VERIFICACAO_INTERESSE_MS = 10 * 60 * 1000;

    // "Assinatura" barata da Consulta Integrada — mandado + quantidade de
    // processos/ocorrências + data do movimento mais recente entre os
    // processos. Qualquer novo processo, nova ocorrência, mandado surgido
    // ou movimentação de processo muda essa string, sem precisar comparar
    // o JSON inteiro campo a campo.
    function _assinaturaConsultaIntegrada(r) {
        if (!r) return '';
        const processos = r.processos || [];
        const totalOcorrencias = (r.ocorrenciasPpe || []).length + (r.ocorrenciasPcAntigo || []).length + (r.ocorrenciasDespacho || []).length;
        const mandado = !!(r.mandados && r.mandados.possuiMandado);
        let ultimaMov = '';
        processos.forEach(p => {
            const dt = p.ultimoMovimento && p.ultimoMovimento.dataHora;
            if (dt && dt > ultimaMov) ultimaMov = dt;
        });
        return [mandado ? 1 : 0, processos.length, totalOcorrencias, ultimaMov].join('|');
    }

    async function obterNovidadesListaInteresses(cfg) {
        if (!cfg || !cfg.apiPhp || !cfg.apiPhp.listaInteressesUrl || !cfg.apiPhp.consultaIntegradaUrl) return [];

        const agora = Date.now();
        const ultima = parseInt(localStorage.getItem(CHAVE_INTERESSE_ULTIMA_VERIFICACAO) || '0', 10);
        if (agora - ultima < INTERVALO_MIN_VERIFICACAO_INTERESSE_MS) {
            try { return JSON.parse(localStorage.getItem(CHAVE_INTERESSE_ULTIMAS_NOTIF) || '[]'); }
            catch (e) { return []; }
        }

        let snapshotAnterior = {};
        try { snapshotAnterior = JSON.parse(localStorage.getItem(CHAVE_INTERESSE_SNAPSHOT) || '{}'); } catch (e) {}

        try {
            const res = await fetch(`${cfg.apiPhp.listaInteressesUrl}?action=listar`);
            const itens = res.ok ? await res.json() : null;
            if (!Array.isArray(itens) || !itens.length) return [];

            const primeiraVez = Object.keys(snapshotAnterior).length === 0;
            const novoSnapshot = {};
            const notificacoes = [];

            // Teto de segurança — a lista de interesses não deveria crescer
            // sem limite, mas evita bater dezenas de requisições de uma vez
            // se algum dia crescer demais.
            const alvos = itens.filter(it => it.cpf).slice(0, 80);
            const resultados = await Promise.all(alvos.map(it =>
                fetch(`${cfg.apiPhp.consultaIntegradaUrl}?action=obter&cpf=${encodeURIComponent(it.cpf)}`)
                    .then(r => r.ok ? r.json() : { encontrado: false })
                    .catch(() => ({ encontrado: false }))
            ));

            alvos.forEach((it, i) => {
                const info = resultados[i];
                if (!info || !info.encontrado) return;
                const assinatura = it.id + ':' + _assinaturaConsultaIntegrada(info.resultado);
                novoSnapshot[it.id] = assinatura;
                if (!primeiraVez && snapshotAnterior[it.id] !== undefined && snapshotAnterior[it.id] !== assinatura) {
                    notificacoes.push({
                        id: 'interesse:' + assinatura,
                        categoria: 'interesse',
                        icone: '⭐',
                        titulo: 'Novidade na Lista de Interesses',
                        texto: `${it.nome || 'Alvo'}: dados atualizados na Consulta Integrada (processos, ocorrências ou mandado).`,
                        link: _prefixoPaginaRisco() + 'page/lista-interesses.html',
                    });
                }
            });

            localStorage.setItem(CHAVE_INTERESSE_SNAPSHOT, JSON.stringify(novoSnapshot));
            localStorage.setItem(CHAVE_INTERESSE_ULTIMA_VERIFICACAO, String(agora));
            localStorage.setItem(CHAVE_INTERESSE_ULTIMAS_NOTIF, JSON.stringify(notificacoes));
            return notificacoes;
        } catch (e) { return []; }
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

        // P2: perde as outras 6 fontes, só recebe movimentação/alerta de
        // autor e suspeito (pedido explícito do usuário — não é aditivo
        // pra este papel).
        if (sessao.nivel === 'p2') {
            const listasP2 = await Promise.all([obterMovimentacoesEsajAutor(cfg), obterMovimentacoesEsajSuspeito(cfg), obterNovidadesListaInteresses(cfg)]);
            return listasP2.reduce(function (a, b) { return a.concat(b); }, []);
        }

        const fontes = [
            obterNotificacoesAdmin(cfg, sessao),
            obterMovimentacoesEsaj(cfg),
            obterEventosProximos(cfg),
            Promise.resolve(obterLembreteCartaoPrograma()),
            obterAcionamentosPanico(),
            obterRiscoLocalPrevisto(cfg),
            obterERegistrarPrevisaoMensalCad(cfg, sessao),
        ];
        // admin: mantém tudo que já tinha E ganha as fontes 7 e 8 também.
        if (sessao.nivel === 'admin') {
            fontes.push(obterMovimentacoesEsajAutor(cfg));
            fontes.push(obterMovimentacoesEsajSuspeito(cfg));
            fontes.push(obterNovidadesListaInteresses(cfg));
        }

        const listas = await Promise.all(fontes);
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

    // Mini-abas — TCO / Autores / Eventos / Outros (mais "Todas") — cada
    // notificação NOVA já vem marcada com `categoria` na origem (ver cada
    // fonte acima). Notificações PERSISTIDAS antes dessa mudança existir
    // (localStorage, ver CHAVE_PERSISTIDAS) não têm esse campo — e
    // mesclarNaPersistencia() nunca sobrescreve uma entrada já existente
    // pelo id, então elas ficariam presas em 'outros' pra sempre. Por
    // isso o fallback abaixo deduz a categoria pelo PREFIXO do id (que já
    // denuncia a fonte) quando `categoria` não vier preenchido — sem
    // precisar tocar no que já está salvo no navegador.
    const ROTULOS_CATEGORIA = { todas: 'Todas', tco: 'TCO', autores: 'Autores', interesse: 'Interesse', eventos: 'Eventos', outros: 'Outros' };
    let categoriaAtiva = 'todas';

    function categoriaPorPrefixoId(id) {
        const s = String(id || '');
        // "esaj:" é TCO — CUIDADO: testar depois de "autor-esaj:"/
        // "suspeito-esaj:" não adianta (esses não começam com "esaj:"),
        // mas a ordem aqui não importa porque os prefixos não se sobrepõem.
        if (s.indexOf('esaj:') === 0) return 'tco';
        if (s.indexOf('autor-esaj:') === 0 || s.indexOf('autor-alerta:') === 0 ||
            s.indexOf('suspeito-esaj:') === 0 || s.indexOf('suspeito-alerta:') === 0) return 'autores';
        if (s.indexOf('interesse:') === 0) return 'interesse';
        if (s.indexOf('evento:') === 0) return 'eventos';
        return 'outros';
    }

    function categoriaDe(n) {
        if (n && n.categoria) return n.categoria;
        return categoriaPorPrefixoId(n && n.id);
    }

    function atualizarTabs(lista) {
        const cont = document.getElementById('notif-tabs');
        if (!cont) return;
        const contagens = { todas: lista.length, tco: 0, autores: 0, eventos: 0, outros: 0 };
        lista.forEach(function (n) {
            const cat = categoriaDe(n);
            contagens[cat] = (contagens[cat] || 0) + 1;
        });
        cont.querySelectorAll('.notif-tab').forEach(function (btn) {
            const cat = btn.dataset.cat;
            const n = contagens[cat] || 0;
            btn.textContent = n ? (ROTULOS_CATEGORIA[cat] || cat) + ' (' + n + ')' : (ROTULOS_CATEGORIA[cat] || cat);
            btn.classList.toggle('ativa', cat === categoriaAtiva);
        });
    }

    function renderizar(lista) {
        const container = document.getElementById('notif-items');
        const badge = document.getElementById('notif-count');
        if (!container) return;

        listaAtual = lista; // ver bell/dismiss wiring em iniciar() — sempre a lista COMPLETA, nunca só o que está filtrado na aba atual (dispensar/marcar-visto precisa valer pra tudo, não só pro que está visível agora)
        atualizarTabs(lista);

        const visivel = categoriaAtiva === 'todas' ? lista : lista.filter(function (n) { return categoriaDe(n) === categoriaAtiva; });

        // Precisa ser lido AQUI, antes do clique no sino chamar
        // marcarVistas() — é o que diferencia visualmente o que é novo
        // (nunca visto por este navegador) do que já apareceu antes,
        // resolvendo o "abre o sino e não dá pra saber qual é a nova".
        const vistas = lerVistas();

        if (!visivel.length) {
            container.innerHTML = '<p class="empty-msg">' + (lista.length ? 'Nada nesta aba' : 'Nenhuma notificação nova') + '</p>';
        } else {
            container.innerHTML = visivel.map(function (n) {
                const linkAttr = n.link ? ' data-link="' + escaparHtml(n.link) + '"' : '';
                const clicavelClass = n.link ? ' notif-clicavel' : '';
                const clicavelStyle = n.link ? ' style="cursor:pointer;"' : '';
                const novaClass = vistas.has(n.id) ? '' : ' notif-nao-vista';
                const selo = vistas.has(n.id) ? '' : '<span class="notif-selo-nova">NOVA</span>';
                return '<div class="notif-item' + clicavelClass + novaClass + '" data-id="' + escaparHtml(n.id) + '"' + linkAttr + clicavelStyle + '>' +
                    '<button type="button" class="notif-dismiss" title="Dispensar" aria-label="Dispensar">✕</button>' +
                    '<strong>' + (n.icone || '🔔') + ' ' + escaparHtml(n.titulo || '') + selo + '</strong><br>' +
                    escaparHtml(n.texto || '') +
                    '</div>';
            }).join('');
        }

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

        // Mini-abas — troca a categoria ativa e re-renderiza em cima da
        // lista completa já carregada (sem refazer nenhuma busca).
        const tabs = document.getElementById('notif-tabs');
        if (tabs) {
            tabs.addEventListener('click', function (e) {
                const btn = e.target.closest('.notif-tab');
                if (!btn) return;
                e.stopPropagation(); // não fecha o dropdown (mesmo motivo do notif-limpar-tudo abaixo)
                categoriaAtiva = btn.dataset.cat;
                renderizar(listaAtual);
            });
        }

        // "×" de cada notificação — 1 listener só, por delegação (a
        // lista é reconstruída via innerHTML a cada render, então um
        // listener por item se perderia).
        container.addEventListener('click', function (e) {
            const btn = e.target.closest('.notif-dismiss');
            if (btn) {
                const item = btn.closest('.notif-item');
                const id = item && item.dataset.id;
                if (!id) return;
                renderizar(dispensarNotificacao(id));
                return;
            }
            // Clique na notificação (fora do "×") — navega direto pro
            // link, se essa fonte tiver um (ex.: risco por local leva
            // pra page/analisePreditiva.html#secao-risco-local). Fontes
            // sem link (a maioria) não fazem nada ao clicar, como sempre.
            const item = e.target.closest('.notif-item');
            const link = item && item.dataset.link;
            if (link) window.location.href = link;
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

    // ── API pública pra INJETAR notificações direto, sem esperar o
    // próximo ciclo de detecção automática (coletarTodas/throttle de
    // 10min) — usada pelo "Verificar agora" do atualizador local
    // (js/autores.js, js/suspeitos.js): uma mudança de movimentação
    // encontrada NA HORA pelo servidor local já aparece no sino
    // imediatamente, sem esperar a próxima checagem passiva.
    //
    // Reaproveita o MESMO mecanismo de persistência/dedupe por id que as
    // fontes internas já usam (mesclarNaPersistencia) — se o ciclo
    // automático mais tarde detectar essa MESMA mudança (mesmo id), não
    // duplica, só confirma o que já estava lá.
    function adicionarNotificacoes(lista) {
        if (!Array.isArray(lista) || !lista.length) return;
        const mesclada = mesclarNaPersistencia(lista);
        // Só re-renderiza se esta página tiver o dropdown do sino (header
        // unificado já carregado) — noutras páginas isso só persiste em
        // localStorage pro sino aparecer atualizado na próxima navegação.
        if (document.getElementById('notif-items')) renderizar(mesclada);
    }

    global.P3Notificacoes = {
        coletarTodas: coletarTodas, iniciar: iniciar, adicionarNotificacoes: adicionarNotificacoes,
        obterResumoRiscoPorLocal: obterResumoRiscoPorLocal,
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})(window);
