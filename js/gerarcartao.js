// @ts-nocheck
// ================================================================
// GERADOR DE CARTÃO PROGRAMA — P3/10º BPM
// ================================================================

const FIREBASE_URL = "https://sistema-p3-default-rtdb.firebaseio.com";

// Pesos de gravidade por categoria
// cvli=5, droga=4, cvp=3, geral=1
const PESOS = { cvli: 5, droga: 4, cvp: 3, geral: 1 };

// Cidades patrulhadas por cada RP
const MAPA_RP_CIDADES = {
    "RP 01":              ["PALMEIRA DOS ÍNDIOS"],
    "RP 02":              ["PALMEIRA DOS ÍNDIOS"],
    "BELÉM":              ["BELÉM", "TANQUE D'ARCA"],
    "CACIMBINHAS":        ["CACIMBINHAS"],
    "MINADOR DO NEGRÃO":  ["MINADOR DO NEGRÃO", "ESTRELA DE ALAGOAS"],
    "MAR VERMELHO":       ["MAR VERMELHO", "PAULO JACINTO"],
    "PAULO JACINTO":      ["PAULO JACINTO", "MAR VERMELHO"],
    "TANQUE D'ARCA":      ["TANQUE D'ARCA", "BELÉM"],
    "MARIBONDO":          ["MARIBONDO"],
    "ESTRELA DE ALAGOAS": ["ESTRELA DE ALAGOAS", "MINADOR DO NEGRÃO"],
    "IGACI":              ["IGACI"],
    "QUEBRANGULO":        ["QUEBRANGULO"]
};

function identificarChaveRP(rp) {
    const u = rp.toUpperCase();
    for (const k of Object.keys(MAPA_RP_CIDADES)) {
        if (u.includes(k)) return k;
    }
    return null;
}

// ================================================================
// BOTÃO PRINCIPAL
// ================================================================
async function clicarBotaoGerar() {
    const select        = document.getElementById("select-rp");
    const rpSelecionada = select.value;
    const container     = document.getElementById("iframe-container");

    if (!rpSelecionada) { alert("Por favor, selecione uma guarnição."); return; }

    container.style.display = 'block';
    container.innerHTML = `<div style="text-align:center;padding:30px;color:#003366;">
        <p><strong>🔥 Analisando Inteligência Criminal em Tempo Real...</strong></p>
    </div>`;

    const fetchData = async (node) => {
        try {
            const res = await fetch(`${FIREBASE_URL}/${node}.json`);
            return res.ok ? await res.json() : {};
        } catch (e) { return {}; }
    };

    try {
        const [geral, cvp, cvli, droga] = await Promise.all([
            fetchData('geral'), fetchData('cvp'), fetchData('cvli'), fetchData('droga')
        ]);
        const dados = processarDados(rpSelecionada, { geral, cvp, cvli, droga });
        container.innerHTML = gerarTemplateHTML(dados);
        document.getElementById('btn-imprimir').style.display = "inline-block";
    } catch (err) {
        container.innerHTML = "<p style='color:red;text-align:center;'>Erro ao carregar dados.</p>";
        console.error(err);
    }
}

// ================================================================
// PROCESSAMENTO
// ================================================================
function processarDados(cidadeFiltro, db) {

    // ── Cidades alvo desta RP ────────────────────────────────────
    const chaveRP     = identificarChaveRP(cidadeFiltro);
    const cidadesAlvo = chaveRP
        ? MAPA_RP_CIDADES[chaveRP].map(c => c.toUpperCase())
        : [cidadeFiltro.split('(')[0].trim().toUpperCase()];

    // ── Janela dos últimos 90 dias ───────────────────────────────
    const hoje     = new Date();
    const limite90 = new Date(hoje);
    limite90.setDate(hoje.getDate() - 90);

    const dentroJanela = (dataStr) => {
        if (!dataStr) return false;
        const s = dataStr.toString().trim();
        let d;
        if (s.includes('/')) {
            // Suporta "DD/MM/AAAA" e "DD/MM/AAAA HH:MM" (ignora a hora)
            const soData = s.split(' ')[0];
            const partes = soData.split('/');
            if (partes.length < 3) return false;
            const dia = parseInt(partes[0], 10);
            const mes = parseInt(partes[1], 10);
            const ano = parseInt(partes[2], 10);
            if (isNaN(dia) || isNaN(mes) || isNaN(ano)) return false;
            d = new Date(ano, mes - 1, dia);
        } else {
            // ISO: AAAA-MM-DD ou AAAA-MM-DDTHH:MM...
            d = new Date(s.substring(0, 10));
        }
        return !isNaN(d.getTime()) && d >= limite90 && d <= hoje;
    };

    // ── CORREÇÃO CRÍTICA: validar HORA ───────────────────────────
    // O Firebase tem registros onde HORA = número do boletim (ex: "46336")
    // parseInt("46336") = 46336 → cai no else → turno='noite' incorretamente
    // Solução: só aceitar hora entre 0 e 23
    const horaValida = (horaStr) => {
        if (!horaStr) return null;
        const s = horaStr.toString().trim();
        let h;
        if (s.includes(':')) {
            h = parseInt(s.split(':')[0], 10);
        } else {
            h = parseInt(s, 10);
        }
        // Hora deve estar entre 0 e 23 — fora disso é dado corrompido
        return (h >= 0 && h <= 23) ? h : null;
    };

    // ── Estruturas de acumulação ─────────────────────────────────
    //
    // Turnos de ANÁLISE: manhã 06-12h | tarde 12-18h | noite 18-05h
    //
    // Para cada turno e bairro:
    //   qtd[t][b]   = total de registros (qualquer categoria)
    //   grave[t][b] = soma de peso apenas de ocorrências graves (cvli+cvp+droga)
    //                 peso=1 (geral) NÃO conta aqui
    //
    // Totais por turno (para percentuais relativos entre turnos):
    //   totalQtdTurno[t]   = total de registros do turno
    //   totalGraveTurno[t] = soma de peso grave do turno

    const TURNOS = ['manha', 'tarde', 'noite'];
    const qtd   = { manha:{}, tarde:{}, noite:{} }; // contagem por bairro
    const grave = { manha:{}, tarde:{}, noite:{} }; // peso grave por bairro

    const totalQtdTurno   = { manha:0, tarde:0, noite:0 };
    const totalGraveTurno = { manha:0, tarde:0, noite:0 };

    // Ranking GERAL de bairros (sem filtro de turno) como fallback
    // para quando o turno específico não tiver dados suficientes
    const qtdGeral   = {}; // bairro → contagem geral
    const graveGeral = {}; // bairro → peso grave geral

    // logradourosRurais[bairro][logradouro] = contagem
    const logradourosRurais = {};

    // ── Percorrer Firebase ───────────────────────────────────────
    Object.keys(db).forEach(categoria => {
        const registros = db[categoria];
        if (!registros) return;

        Object.values(registros).forEach(item => {
            // Filtra cidade
            const cid = (item.CIDADE || "").toString().toUpperCase().trim();
            if (!cidadesAlvo.some(c => cid.includes(c))) return;

            const bairro     = (item.BAIRRO     || "").toString().toUpperCase().trim();
            const logradouro = (item.LOGRADOURO  || item.ENDERECO || "").toString().toUpperCase().trim();
            if (!bairro) return;

            // Logradouros rurais
            const ehRural = bairro.includes("ZONA RURAL") || bairro.includes("RURAL");
            if (ehRural && logradouro) {
                if (!logradourosRurais[bairro]) logradourosRurais[bairro] = {};
                logradourosRurais[bairro][logradouro] =
                    (logradourosRurais[bairro][logradouro] || 0) + 1;
            }

            // Peso de gravidade deste registro
            // Peso grave = apenas cvli(5), cvp(3), droga(4)
            // geral tem peso=1 mas NÃO conta como ocorrência grave
            const pesoTotal  = PESOS[categoria] || 1;
            const pesoGravio = categoria !== 'geral' ? pesoTotal : 0;

            // Ranking geral (histórico completo, sem filtro de data)
            qtdGeral[bairro]   = (qtdGeral[bairro]   || 0) + 1;
            graveGeral[bairro] = (graveGeral[bairro]  || 0) + pesoGravio;

            // Só entra na análise de turno se estiver nos 90 dias
            if (!dentroJanela(item.DATA || item.data)) return;

            // Valida a HORA
            const h = horaValida(item.HORA);

            if (h === null) {
                // HORA corrompida (número do boletim, etc.)
                // Distribui o bairro nos 3 turnos (1/3 por turno) para que apareça no cartão.
                // NÃO incrementa totalQtdTurno/totalGraveTurno — não distorce a cor.
                const frac = 1 / 3;
                for (const t of ['manha', 'tarde', 'noite']) {
                    qtd[t][bairro]   = (qtd[t][bairro]   || 0) + frac;
                    grave[t][bairro] = (grave[t][bairro]  || 0) + (pesoGravio * frac);
                }
                return;
            }

            let turno;
            if      (h >= 6  && h < 12) turno = 'manha';
            else if (h >= 12 && h < 18) turno = 'tarde';
            else                        turno = 'noite';

            qtd[turno][bairro]   = (qtd[turno][bairro]   || 0) + 1;
            grave[turno][bairro] = (grave[turno][bairro]  || 0) + pesoGravio;

            totalQtdTurno[turno]   += 1;
            totalGraveTurno[turno] += pesoGravio;
        });
    });

    // ── Resolver ZONA RURAL → logradouro mais frequente ─────────
    const resolverLocal = (bairro) => {
        const ehRural = bairro.includes("ZONA RURAL") || bairro.includes("RURAL");
        if (ehRural && logradourosRurais[bairro]) {
            const top = Object.entries(logradourosRurais[bairro])
                .sort((a, b) => b[1] - a[1])[0];
            return top ? top[0] : bairro;
        }
        return bairro;
    };

    // ── Top N bairros de um objeto de scores ────────────────────
    const topBairros = (scores, n) =>
        Object.entries(scores)
            .sort((a, b) => b[1] - a[1])
            .slice(0, n)
            .map(([b]) => resolverLocal(b));

    // ── Análise de criticidade por turno ─────────────────────────
    //
    // LÓGICA DE PRIORIDADE:
    //
    // 1. GRAVIDADE tem prioridade sobre QUANTIDADE
    //    - Se o turno tem ocorrências GRAVES (cvli/cvp/droga):
    //      → ordena bairros por pesoGrave
    //      → cor baseada em % de gravidade DO TURNO sobre TOTAL GRAVE
    //
    // 2. Se NÃO há ocorrências graves no turno mas há ocorrências:
    //    → ordena bairros por quantidade (critério de quantidade)
    //    → cor baseada em % de quantidade DO TURNO sobre TOTAL QTD
    //
    // 3. Se NÃO há dados do turno nos 90 dias:
    //    → usa ranking GERAL histórico (sem filtro de data ou turno)
    //    → cor = branco (sem criticidade determinada)
    //
    // Escala de cor (baseada no percentual do turno mais pesado):
    //   pct < 25%  → branco (distribuição normal entre turnos)
    //   pct 25-50% → laranja (concentração moderada)
    //   pct > 50%  → vermelho (concentração alta neste turno)
    //
    // Nota: pct é calculado sobre o total DE TODOS OS TURNOS,
    // não sobre o total de registros. Isso permite comparar turnos
    // entre si e identificar qual concentra mais crimes.

    // Soma total de valores em um objeto de scores
    const somaObj = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);

    const analisarTurno = (nomeTurno, nLocais) => {
        const n = nLocais || 3;

        // Soma real dos scores acumulados no turno (inclui frações de hora inválida)
        const somaGraveTurno = somaObj(grave[nomeTurno]);
        const somaQtdTurno   = somaObj(qtd[nomeTurno]);

        // Soma total de grave e qtd com HORA VÁLIDA (para calcular cor/percentual)
        const totalGraveValido = Object.values(totalGraveTurno).reduce((a, b) => a + b, 0);
        const totalQtdValido   = Object.values(totalQtdTurno).reduce((a, b) => a + b, 0);

        // ── CASO 1: Tem ocorrências graves no turno → GRAVIDADE decide cor ──
        // Detecta pelo total com hora válida (totalGraveTurno) OU pelo acumulado (somaGraveTurno)
        if (totalGraveTurno[nomeTurno] > 0 || somaGraveTurno > 0) {
            // Cor: baseada apenas nos registros com hora válida (evita distorção)
            const pct = totalGraveValido > 0
                ? (totalGraveTurno[nomeTurno] / totalGraveValido) * 100
                : 0;

            // Bairros: ordenados pelo score acumulado de gravidade (inclui frações)
            const locais = topBairros(grave[nomeTurno], n);
            const nOcorr = totalQtdTurno[nomeTurno] > 0
                ? `${totalQtdTurno[nomeTurno]} ocorr. c/ hora` : 'ocorrências';
            const info = pct > 0
                ? `GRAV.${pct.toFixed(0)}% — ${nOcorr} (90 dias)`
                : `${nOcorr} (90 dias)`;

            let miss = null, h = null;
            if (pct > 50)       { miss = '🚨 ROTA CRÍTICA'; h = 'red'; }
            else if (pct >= 25) { h = 'orange'; }
            return { locais, info, miss, h };
        }

        // ── CASO 2: Sem graves, mas tem registros → QUANTIDADE decide cor ──
        if (totalQtdTurno[nomeTurno] > 0 || somaQtdTurno > 0) {
            const pct = totalQtdValido > 0
                ? (totalQtdTurno[nomeTurno] / totalQtdValido) * 100
                : 0;

            const locais = topBairros(qtd[nomeTurno], n);
            const nOcorr = totalQtdTurno[nomeTurno] > 0
                ? `${totalQtdTurno[nomeTurno]} ocorr.` : 'registros';
            const info = pct > 0
                ? `QTD.${pct.toFixed(0)}% — ${nOcorr} (90 dias)`
                : `${nOcorr} (90 dias)`;

            let miss = null, h = null;
            if (pct > 50)       { miss = '🚨 ROTA CRÍTICA'; h = 'red'; }
            else if (pct >= 25) { h = 'orange'; }
            return { locais, info, miss, h };
        }

        // ── CASO 3: Nenhum dado nos 90 dias → histórico geral ──
        const fallback = Object.values(graveGeral).some(v => v > 0) ? graveGeral : qtdGeral;
        const locais   = topBairros(fallback, n);
        return { locais, info: 'HISTÓRICO GERAL', miss: null, h: null };
    };

    // ── Montar linha do cronograma ────────────────────────────────
    const montarLinha = (ini, fim, nomeTurno, missPadrao, nLocais) => {
        const { locais, info, miss, h } = analisarTurno(nomeTurno, nLocais || 3);
        const top  = locais.length > 0 ? locais.join(" | ") : "CENTRO DA CIDADE";
        const det  = `${top}  (${info})`;
        return {
            ini, fim,
            miss: miss || missPadrao,
            det,
            h
        };
    };

    const fixa = (ini, fim, miss, det, h) => ({ ini, fim, miss, det, h: h || null });

    // ── Cronograma por tipo de RP ────────────────────────────────
    const gNome = cidadeFiltro.toUpperCase();
    let cronograma = [];

    if (gNome.includes("RP 01")) {
        cronograma = [
            montarLinha("08:30","13:00", 'manha',  "Patrulhamento Setorial"),
            fixa(       "13:00","17:30",            "Almoço / Prontidão",       "BASE OPERACIONAL", "green"),
            fixa(       "18:00","19:00",            "JANTA",                    "BASE OPERACIONAL", "green"),
            montarLinha("19:00","00:00", 'noite',   "Patrulhamento Noturno 1"),
            montarLinha("00:00","03:00", 'noite',   "Patrulhamento Noturno 2"),
            fixa(       "03:00","05:00",            "Descanso / Prontidão",     "BASE OPERACIONAL", null),
            montarLinha("05:00","07:30", 'manha',   "OPO Alvorada"),
        ];
    } else if (gNome.includes("RP 02")) {
        cronograma = [
            fixa(       "08:00","13:00",            "Prontidão / Adm / ALMOÇO", "BASE OPERACIONAL", "green"),
            montarLinha("12:00","18:00", 'tarde',   "Patrulhamento Setorial"),
            montarLinha("18:00","19:00", 'noite',   "Ronda Crítica Noturna"),
            fixa(       "19:00","20:00",            "Janta / Prontidão",        "BASE OPERACIONAL", "green"),
            fixa(       "20:00","20:30",            "OPO - POLICIAMENTO ESCOLAR","ESCOLA EST. MONSENHOR RIBEIRO - PALMEIRA DE FORA", "red"),
            montarLinha("20:30","00:00", 'noite',   "Patrulhamento Noturno 1"),
            fixa(       "00:00","03:00",            "DESCANSO / PRONTIDÃO",     "BASE OPERACIONAL", "green"),
            montarLinha("03:00","05:00", 'noite',   "Patrulhamento Noturno 2"),
            fixa(       "05:00","07:00",            "Descanso / Prontidão",     "BASE OPERACIONAL", null),
        ];
    } else if (gNome.includes("PAULO JACINTO")) {
        cronograma = [
            fixa(       "08:00","08:30",            "Apresentação",             "APRESENTAÇÃO E PRELEÇÃO.", null),
            montarLinha("08:30","13:00", 'manha',   "Patrulhamento - MAR VERMELHO"),
            fixa(       "13:00","16:30",            "Almoço e Prontidão",       "BASE OPERACIONAL.", "green"),
            montarLinha("16:30","19:00", 'tarde',   "Rota Prioritária Tarde"),
            fixa(       "19:00","20:00",            "Janta e Prontidão",        "BASE OPERACIONAL.", "green"),
            fixa(       "20:00","20:30",            "OPO - POLICIAMENTO ESCOLAR","ESCOLA ESTADUAL JOSÉ MEDEIROS", "red"),
            montarLinha("20:30","22:00", 'noite',   "Patrulhamento Noturno 1"),
            montarLinha("22:00","00:00", 'noite',   "Patrulhamento Noturno 2"),
            fixa(       "00:00","05:00",            "Descanso/Prontidão",       "BASE OPERACIONAL.", null),
            montarLinha("05:00","07:00", 'manha',   "OPO ALVORADA"),
            fixa(       "07:00","08:00",            "Finalização",              "MANUTENÇÃO DE VIATURA E RENDIÇÃO.", null),
        ];
    } else if (gNome.includes("MAR VERMELHO")) {
        cronograma = [
            fixa(       "08:00","08:30",            "Apresentação",             "APRESENTAÇÃO E PRELEÇÃO.", null),
            montarLinha("08:30","13:00", 'manha',   "Patrulhamento - PAULO JACINTO"),
            fixa(       "13:00","16:30",            "Almoço e Prontidão",       "BASE OPERACIONAL.", "green"),
            montarLinha("16:30","19:00", 'tarde',   "Rota Prioritária Tarde"),
            fixa(       "19:00","20:00",            "Janta e Prontidão",        "BASE OPERACIONAL.", "green"),
            montarLinha("20:00","22:00", 'noite',   "Patrulhamento Noturno 1"),
            montarLinha("22:00","00:00", 'noite',   "Patrulhamento Noturno 2"),
            fixa(       "00:00","05:00",            "Descanso/Prontidão",       "BASE OPERACIONAL.", null),
            montarLinha("05:00","07:00", 'manha',   "OPO ALVORADA"),
            fixa(       "07:00","08:00",            "Finalização",              "MANUTENÇÃO DE VIATURA E RENDIÇÃO.", null),
        ];
    } else if (gNome.includes("ESTRELA DE ALAGOAS")) {
        cronograma = [
            fixa(       "08:00","08:30",            "Apresentação",             "APRESENTAÇÃO E PRELEÇÃO.", null),
            montarLinha("08:30","13:00", 'manha',   "Patrulhamento - MINADOR DO NEGRÃO"),
            fixa(       "13:00","16:30",            "Almoço e Prontidão",       "BASE OPERACIONAL.", "green"),
            montarLinha("16:30","19:00", 'tarde',   "Rota Prioritária Tarde"),
            fixa(       "19:00","20:00",            "Janta e Prontidão",        "BASE OPERACIONAL.", "green"),
            montarLinha("20:00","22:00", 'noite',   "Patrulhamento Noturno 1"),
            montarLinha("22:00","00:00", 'noite',   "Patrulhamento Noturno 2"),
            fixa(       "00:00","05:00",            "Descanso/Prontidão",       "BASE OPERACIONAL.", null),
            montarLinha("05:00","07:00", 'manha',   "OPO ALVORADA"),
            fixa(       "07:00","08:00",            "Finalização",              "MANUTENÇÃO DE VIATURA E RENDIÇÃO.", null),
        ];
    } else if (gNome.includes("MINADOR DO NEGRÃO")) {
        cronograma = [
            fixa(       "08:00","08:30",            "Apresentação",             "APRESENTAÇÃO E PRELEÇÃO.", null),
            montarLinha("08:30","13:00", 'manha',   "Patrulhamento - ESTRELA DE ALAGOAS"),
            fixa(       "13:00","16:30",            "Almoço e Prontidão",       "BASE OPERACIONAL.", "green"),
            montarLinha("16:30","19:00", 'tarde',   "Rota Prioritária Tarde"),
            fixa(       "19:00","20:00",            "Janta e Prontidão",        "BASE OPERACIONAL.", "green"),
            montarLinha("20:00","22:00", 'noite',   "Patrulhamento Noturno 1"),
            montarLinha("22:00","00:00", 'noite',   "Patrulhamento Noturno 2"),
            fixa(       "00:00","05:00",            "Descanso/Prontidão",       "BASE OPERACIONAL.", null),
            montarLinha("05:00","07:00", 'manha',   "OPO ALVORADA"),
            fixa(       "07:00","08:00",            "Finalização",              "MANUTENÇÃO DE VIATURA E RENDIÇÃO.", null),
        ];
    } else if (gNome.includes("BELÉM")) {
        cronograma = [
            fixa(       "08:00","08:30",            "Apresentação",             "APRESENTAÇÃO E PRELEÇÃO.", null),
            montarLinha("08:30","13:00", 'manha',   "Patrulhamento - TANQUE D'ARCA"),
            fixa(       "13:00","16:30",            "Almoço e Prontidão",       "BASE OPERACIONAL.", "green"),
            montarLinha("16:30","19:00", 'tarde',   "Rota Prioritária Tarde"),
            fixa(       "19:00","20:00",            "Janta e Prontidão",        "BASE OPERACIONAL.", "green"),
            montarLinha("20:00","22:00", 'noite',   "Patrulhamento Noturno 1"),
            montarLinha("22:00","00:00", 'noite',   "Patrulhamento Noturno 2"),
            fixa(       "00:00","05:00",            "Descanso/Prontidão",       "BASE OPERACIONAL.", null),
            montarLinha("05:00","07:00", 'manha',   "OPO ALVORADA"),
            fixa(       "07:00","08:00",            "Finalização",              "MANUTENÇÃO DE VIATURA E RENDIÇÃO.", null),
        ];
    } else if (gNome.includes("TANQUE D'ARCA")) {
        cronograma = [
            fixa(       "08:00","08:30",            "Apresentação",             "APRESENTAÇÃO E PRELEÇÃO.", null),
            montarLinha("08:30","13:00", 'manha',   "Patrulhamento - BELÉM"),
            fixa(       "13:00","16:30",            "Almoço e Prontidão",       "BASE OPERACIONAL.", "green"),
            montarLinha("16:30","19:00", 'tarde',   "Rota Prioritária Tarde"),
            fixa(       "19:00","20:00",            "Janta e Prontidão",        "BASE OPERACIONAL.", "green"),
            montarLinha("20:00","22:00", 'noite',   "Patrulhamento Noturno 1"),
            montarLinha("22:00","00:00", 'noite',   "Patrulhamento Noturno 2"),
            fixa(       "00:00","05:00",            "Descanso/Prontidão",       "BASE OPERACIONAL.", null),
            montarLinha("05:00","07:00", 'manha',   "OPO ALVORADA"),
            fixa(       "07:00","08:00",            "Finalização",              "MANUTENÇÃO DE VIATURA E RENDIÇÃO.", null),
        ];
    } else {
        // Demais RPs: Cacimbinhas, Maribondo, Igaci, Quebrangulo…
        cronograma = [
            fixa(       "08:00","08:30",            "Apresentação",             "APRESENTAÇÃO E PRELEÇÃO.", null),
            montarLinha("08:30","13:00", 'manha',   "Patrulhamento Geral"),
            fixa(       "13:00","16:30",            "Almoço e Prontidão",       "BASE OPERACIONAL.", "green"),
            montarLinha("16:30","19:00", 'tarde',   "Rota Prioritária Tarde"),
            fixa(       "19:00","20:00",            "Janta e Prontidão",        "BASE OPERACIONAL.", "green"),
            montarLinha("20:00","22:00", 'noite',   "Patrulhamento Noturno 1"),
            montarLinha("22:00","00:00", 'noite',   "Patrulhamento Noturno 2"),
            fixa(       "00:00","05:00",            "Descanso/Prontidão",       "BASE OPERACIONAL.", null),
            montarLinha("05:00","07:00", 'manha',   "OPO ALVORADA"),
            fixa(       "07:00","08:00",            "Finalização",              "MANUTENÇÃO DE VIATURA E RENDIÇÃO.", null),
        ];
    }

    // ── Resumo de distribuição ────────────────────────────────────
    // Conta registros nos 90 dias: soma os valores dos objetos qtd (inclui frações)
    const somaObj2 = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);
    const totalNos90 = ['manha','tarde','noite'].reduce((s,t) => s + somaObj2(qtd[t]), 0);

    const nomesTurno = { manha:'Manhã(06-12h)', tarde:'Tarde(12-18h)', noite:'Noite(18-05h)' };
    const partes = [];
    for (const t of ['manha','tarde','noite']) {
        const q  = totalQtdTurno[t];   // com hora válida
        const g  = totalGraveTurno[t]; // com hora válida
        const tV = Object.values(totalQtdTurno).reduce((a,b)=>a+b,0);
        const tG = Object.values(totalGraveTurno).reduce((a,b)=>a+b,0);
        const pQ = tV > 0 ? ((q / tV) * 100).toFixed(0) : 0;
        const pG = tG > 0 ? ((g / tG) * 100).toFixed(0) : 0;
        const sQ = Math.round(somaObj2(qtd[t]));
        if (sQ > 0) partes.push(`${nomesTurno[t]}: ${sQ} reg. | Grav.${pG}% / Qtd.${pQ}%`);
    }

    return {
        cidade:             cidadesAlvo[0],
        cidadesPatrulhadas: cidadesAlvo,
        rp:   cidadeFiltro.includes("(") ? cidadeFiltro.split('(')[1].replace(')', '') : "RP",
        data: new Date().toLocaleDateString('pt-BR'),
        cronograma,
        resumo:    partes.join(' &bull; '),
        totalQtd:  Math.round(totalNos90)
    };
}

// ================================================================
// TEMPLATE HTML
// ================================================================
function gerarTemplateHTML(data) {

    const linhas = data.cronograma.map(i => {
        let cls   = i.h && i.h !== 'orange' ? `highlight-${i.h}` : '';
        let style = i.h === 'orange' ? 'background-color:#ffe0b2; font-weight:bold;' : '';
        return `
        <tr class="${cls}" style="${style}">
            <td style="text-align:center;border:1px solid #333;padding:5px;white-space:nowrap;">${i.ini}</td>
            <td style="text-align:center;border:1px solid #333;padding:5px;white-space:nowrap;">${i.fim}</td>
            <td style="font-weight:bold;border:1px solid #333;padding:5px;">${i.miss.toUpperCase()}</td>
            <td style="border:1px solid #333;padding:5px;">${i.det.toUpperCase()}</td>
        </tr>`;
    }).join('');

    const resumoHTML = data.totalQtd > 0 ? `
        <div style="margin:8px 0;padding:6px 10px;background:#f0f5ff;
                    border:1px solid #c5cae9;border-radius:5px;font-size:9px;color:#003366;">
            <strong>📊 INTELIGÊNCIA — ${data.totalQtd} registros (90 dias)
            | ${data.cidadesPatrulhadas.join(' + ')}:</strong>
            &nbsp;${data.resumo}
        </div>` : `
        <div style="margin:8px 0;padding:6px 10px;background:#fff3e0;
                    border:1px solid #ffcc80;border-radius:5px;font-size:9px;color:#e65100;">
            ⚠ Sem registros nos últimos 90 dias. Exibindo bairros com maior histórico geral.
        </div>`;

    const legendaHTML = `
        <div style="margin:4px 0 10px 0;display:flex;gap:8px;flex-wrap:wrap;
                    font-size:9px;align-items:center;color:#333;">
            <strong>LEGENDA:</strong>
            <span style="background:#fff;border:1px solid #bbb;padding:2px 7px;border-radius:3px;">
                ⬜ NORMAL — &lt;25% da concentração no turno
            </span>
            <span style="background:#ffe0b2;border:1px solid #ffb74d;padding:2px 7px;border-radius:3px;">
                🟠 ATENÇÃO — 25–50% da concentração
            </span>
            <span style="background:#ffcccc;border:1px solid #e57373;padding:2px 7px;border-radius:3px;">
                🔴 ROTA CRÍTICA — &gt;50% da concentração
            </span>
            <span style="font-size:8px;color:#777;">Prioridade: GRAVIDADE &gt; QUANTIDADE</span>
        </div>`;

    return `
    <style>
        .card-programa{border:3px solid #003366;padding:15px;background:#fff;font-family:Arial,sans-serif;font-size:11px;}
        .table-c{width:100%;border-collapse:collapse;margin-top:10px;}
        .table-c th{background:#003366;color:white;padding:8px;border:1px solid #333;}
        .highlight-red{background-color:#ffcccc;font-weight:bold;}
        .highlight-white{background-color:#fffff;}
        .assinatura{text-align:center;margin-top:20px;}
    </style>
    <div class="card-programa">
        <div style="display:flex;justify-content:space-between;align-items:center;
                    border-bottom:2px solid #003366;padding-bottom:5px;margin-bottom:8px;">
            <img src="https://pm.al.gov.br/joomgallery/image?view=image&format=raw&type=orig&id=84" width="60">
            <div style="text-align:center;">
                <h2 style="margin:0;font-size:16px;">CARTÃO PROGRAMA DE RP</h2>
                <h4 style="margin:0;font-size:12px;">10º BATALHÃO DE POLÍCIA MILITAR</h4>
            </div>
            <div style="text-align:right;font-size:10px;">
                <strong>DATA:</strong> ${data.data}<br>
                <strong>CIDADE(S):</strong> ${data.cidadesPatrulhadas.join(' / ')}<br>
                <strong>GU:</strong> ${data.rp}
            </div>
        </div>

        ${resumoHTML}
        ${legendaHTML}

        <table class="table-c">
            <thead>
                <tr>
                    <th>INÍCIO</th><th>FIM</th>
                    <th>MISSÃO</th>
                    <th>BAIRROS / LOGRADOUROS DE PATRULHAMENTO</th>
                </tr>
            </thead>
            <tbody>${linhas}</tbody>
        </table>

        <div class="assinatura">
            <p>_______________________________________________________</p>
            <strong>JONATA APOLINARIO CALHEIROS - 1º TEN QOEM PM</strong><br>Chefe da P3/10º BPM
        </div>
        <div>
            <p style="font-size:9px;color:#555;margin-top:10px;">
                *Cartão gerado com base nos últimos 90 dias. Prioridade: gravidade das ocorrências
                (cvli×5, droga×4, cvp×3) sobre quantidade. Locais ordenados por gravidade criminal.
                Quando não há ocorrências graves, usa critério de quantidade.
            </p>
            <p style="font-size:9px;color:#555;">**As guarnições deverão dar preferência ao cumprimento das OPOs de maior prioridade.</p>
            <p style="font-size:9px;color:#555;">***Em caso de ocorrências em andamento, priorizar o atendimento emergencial.</p>
            <br>
            <strong style="font-size:10px;color:#003366;">SEÇÃO DE PLANEJAMENTO, INSTRUÇÃO E ESTATÍSTICA - P3/10ºBPM</strong>
        </div>
    </div>`;
}