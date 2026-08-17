// @ts-nocheck
// ================================================================
// GERADOR DE CARTÃO PROGRAMA — P3/10º BPM
// ================================================================

let FIREBASE_URL = null; // definido em runtime a partir da unidade do usuário logado (ver js/core/session.js)

// Guarda o resultado da última geração (dados agregados + ocorrências cruas
// já buscadas) pra "Salvar Cartão" não precisar refazer os fetches — também
// serve de snapshot fiel do que foi realmente exibido/editado na tela.
let ultimoDadosCartao = null;
let ultimasOcorrenciasFlat = [];

// Pesos de gravidade por categoria
// cvli=5, droga=4, cvp=3, geral=1
// sossego/violencia_domestica=4 — só ENTRAM na análise quando a RP tem
// menos de 2 CVLI nos últimos 90 dias (ver categoriasAtivasPara) — pedido
// explícito do usuário: ausência de crime letal não significa área
// tranquila, então nesse caso a lógica passa a considerar também
// perturbação do sossego e violência doméstica pra não ficar sem
// critério de priorização.
const PESOS = { cvli: 5, droga: 4, cvp: 3, geral: 1, sossego: 4, violencia_domestica: 4 };

// PESOS_ATIVOS é o que construirAnalisador/analisarCidadeMaisCritica usam
// de fato (nunca PESOS direto) — normalmente é uma cópia idêntica de
// PESOS, mas processarDados() pode recalibrá-lo por reincidência real via
// js/machineLearningLeve.js (ver calibrarPesosAtivos() logo abaixo) antes
// de cada geração de cartão. Sem o módulo carregado, ou sem histórico
// suficiente pra calibrar com segurança, fica idêntico a PESOS — nada
// muda no comportamento atual.
let PESOS_ATIVOS = PESOS;
let ultimaCalibragemPesos = null; // guardado pra dar transparência (ver console.log em calibrarPesosAtivos)

// Formato "DD/MM/AAAA" ou "DD/MM/AAAA HH:MM" ou ISO — mesma tolerância
// de dentroJanela() acima, só que devolvendo um Date em vez de bool
// (dentroJanela não expõe o Date, só decide dentro/fora da janela).
function parseDataFlexivel(dataStr) {
    if (!dataStr) return null;
    const s = dataStr.toString().trim();
    let d;
    if (s.includes('/')) {
        const partes = s.split(' ')[0].split('/');
        if (partes.length < 3) return null;
        const dia = parseInt(partes[0], 10), mes = parseInt(partes[1], 10), ano = parseInt(partes[2], 10);
        if (isNaN(dia) || isNaN(mes) || isNaN(ano)) return null;
        d = new Date(ano, mes - 1, dia);
    } else {
        d = new Date(s.substring(0, 10));
    }
    return isNaN(d.getTime()) ? null : d;
}

// Achata db (geral/cvp/cvli/droga/sossego/violencia_domestica) num único
// array { lat, lng, data, tipo, grave } pro formato que
// MLLeve.calibrarPesos espera — só 'cvli' marca grave:true (é a categoria
// mais grave de PESOS, usada como "rótulo" de reincidência séria; as
// outras alimentam as features de contagem recente, mas não definem o
// rótulo sozinhas).
function montarOcorrenciasParaCalibragem(db) {
    const flat = [];
    ['geral', 'cvp', 'cvli', 'droga', 'sossego', 'violencia_domestica'].forEach(categoria => {
        const registros = db[categoria];
        if (!registros) return;
        Object.values(registros).forEach(item => {
            const data = parseDataFlexivel(item.DATA || item.data);
            if (!data) return;
            flat.push({
                LATITUDE: item.LATITUDE || item.latitude,
                LONGITUDE: item.LONGITUDE || item.longitude,
                BAIRRO: item.BAIRRO || item.bairro,
                data,
                tipo: categoria,
                grave: categoria === 'cvli',
            });
        });
    });
    return flat;
}

// Recalibra PESOS_ATIVOS por reincidência real (regressão logística leve,
// treinada do zero em js/machineLearningLeve.js) — chamado 1x por
// geração de cartão (processarDados roda 1x por clique em "Gerar"), não
// por RP. Log no console pra dar transparência de auditoria (comando
// pode conferir se calibrou de verdade ou ficou no padrão, e por quê).
function calibrarPesosAtivos(db) {
    if (!window.MLLeve) { PESOS_ATIVOS = PESOS; ultimaCalibragemPesos = null; return; }
    const ocorrencias = window.MLLeve.filtrarCoordenadasValidas(montarOcorrenciasParaCalibragem(db));
    const resultado = window.MLLeve.calibrarPesos(ocorrencias, PESOS, { janelaDias: 30 });
    PESOS_ATIVOS = resultado.pesos;
    ultimaCalibragemPesos = resultado;
    if (resultado.calibrado) {
        console.log('[gerarcartao] Pesos calibrados por reincidência real (' + resultado.amostras + ' amostras):', PESOS_ATIVOS);
    } else {
        console.log('[gerarcartao] Pesos NÃO calibrados (' + resultado.motivo + ') — usando PESOS padrão:', PESOS);
    }
}

// Conta quantos CVLI (db.cvli) caem dentro da janela de 90 dias,
// opcionalmente filtrado por cidade(s) — usado por categoriasAtivasPara
// pra decidir se perturbação/violência doméstica entram no jogo.
function contarCVLIJanela(db, cidadesAlvo) {
    const registros = db.cvli;
    if (!registros) return 0;
    return Object.values(registros).filter(item => {
        if (cidadesAlvo) {
            const cid = (item.CIDADE || "").toString().toUpperCase().trim();
            if (!cidadesAlvo.some(c => cid.includes(c))) return false;
        }
        return dentroJanela(item.DATA || item.data);
    }).length;
}

// cidadesAlvo: null = sem filtro de cidade (usado pelo Tático Rural, que
// segue a mancha criminal GERAL, não uma área fixa).
function categoriasAtivasPara(db, cidadesAlvo) {
    const base = ['geral', 'cvp', 'cvli', 'droga'];
    if (contarCVLIJanela(db, cidadesAlvo) < 2) return base.concat(['sossego', 'violencia_domestica']);
    return base;
}

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

// ── Helpers puros de data/hora (sem depender de nenhuma cidade/filtro) —
// hoisted pra fora de processarDados pra poder ser reaproveitado tanto
// pela análise por BAIRRO (construirAnalisador, usada pelas RPs e pelo
// Tático Urbano) quanto pela análise por CIDADE (analisarCidadeMaisCritica,
// usada pelos táticos Rurais). ────────────────────────────────────────
function dentroJanela(dataStr) {
    if (!dataStr) return false;
    const hoje = new Date();
    const limite90 = new Date(hoje);
    limite90.setDate(hoje.getDate() - 90);
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
}

// O Firebase tem registros onde HORA = número do boletim (ex: "46336") —
// parseInt cairia fora do range 0-23 e é descartado como dado corrompido.
function horaValida(horaStr) {
    if (!horaStr) return null;
    const s = horaStr.toString().trim();
    const h = s.includes(':') ? parseInt(s.split(':')[0], 10) : parseInt(s, 10);
    return (h >= 0 && h <= 23) ? h : null;
}

// Mesma fórmula de identificarHotspots (js/opo-hotspot-core.js) e do
// fallback por coordenada de resolverAreaBairro (js/cumprimento-core.js)
// — reaproveitada aqui de propósito (mantém os 3 lugares consistentes,
// sem depender de nenhum dos outros módulos estar carregado).
// ~80m — NÃO é o mesmo raio de identificarHotspots (800m, ~9x maior):
// testado com dados reais (Palmeira dos Índios, ~3400 ocorrências
// georreferenciadas) e 800m junta TODA a área urbana compacta num grupo
// só (990 ocorrências, 21 bairros diferentes misturados) — grande demais
// pra distinguir bairro dentro da mesma cidade (a OPO quer o oposto:
// achar só os piores pontos da cidade INTEIRA, grosseiro por natureza).
// A 80m, o maior grupo real cai pra ~150 ocorrências com só 2-3 bairros
// vizinhos/fronteira (ambiguidade real de limite, não erro). Decisão
// tomada com o usuário depois de reportar esse achado.
const RAIO_AGRUPAMENTO_GRAU = 0.0008;
function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
// Raio data-driven do agrupamento: maior distância real ao centro (+25%
// de folga), com piso de 600m e teto de 3km — mesma regra de
// raioDoConjunto (js/cumprimento-core.js), pra não gerar perímetro
// apertado demais (poucos pontos bem próximos) nem exagerado.
function raioDoAgrupamento(itens, lat, lng) {
    if (!itens.length) return 0.6;
    const maiorDist = itens.reduce((m, p) => Math.max(m, haversineKm(lat, lng, p.lat, p.lng)), 0);
    return Math.min(3, Math.max(0.6, +(maiorDist * 1.25).toFixed(2)));
}

// ── Analisador de criticidade por LOCAL, filtrado por cidade(s) —──────
// Mesma lógica de sempre (gravidade > quantidade > histórico geral),
// extraída de dentro de processarDados pra virar uma factory reutilizável:
// as RPs normais e o Tático Urbano (que patrulha só Palmeira, igual uma
// RP) usam isso; só muda o filtro `cidadesAlvo` de entrada.
//
// LÓGICA DE PRIORIDADE (ver analisarTurno abaixo):
//   1. GRAVIDADE tem prioridade sobre QUANTIDADE
//   2. Sem graves mas com registros → QUANTIDADE decide
//   3. Sem dados nos 90 dias → histórico geral (sem cor)
//   Escala de cor: <25% branco | 25-50% laranja | >50% vermelho
//
// AGRUPAMENTO: ocorrências com LATITUDE/LONGITUDE válida são agrupadas
// por PROXIMIDADE GEOGRÁFICA real (~800m, mesmo critério de
// identificarHotspots) em vez de confiar no texto do campo BAIRRO — evita
// que a mesma área física apareça espalhada por causa de bairro digitado
// diferente. O NOME exibido de cada agrupamento continua vindo do
// próprio registro (BAIRRO mais frequente entre os pontos do grupo, sem
// geocodificação reversa externa — decisão explícita do usuário).
// Ocorrências SEM coordenada válida caem no método antigo (por texto de
// BAIRRO) — nenhum dado é descartado, os dois tipos de grupo concorrem
// juntos no mesmo ranking. Pedido explícito do usuário.
function construirAnalisador(db, cidadesAlvo) {
    const TURNOS = ['manha', 'tarde', 'noite'];
    const qtd   = { manha:{}, tarde:{}, noite:{} };
    const grave = { manha:{}, tarde:{}, noite:{} };
    const totalQtdTurno   = { manha:0, tarde:0, noite:0 };
    const totalGraveTurno = { manha:0, tarde:0, noite:0 };
    const qtdGeral   = {};
    const graveGeral = {};
    const logradourosPorChave = {}; // chave -> {LOGRADOURO: contagem}
    const infoChave = {}; // chave -> {nome, cidade, lat, lng, raioKm} dos agrupamentos GEO

    // ── Passo 1: achata as ocorrências das categorias ativas (ver
    // categoriasAtivasPara — inclui perturbação/violência doméstica só
    // quando a RP tem pouco CVLI), filtradas pela(s) cidade(s) desta RP ──
    const itens = [];
    categoriasAtivasPara(db, cidadesAlvo).forEach(categoria => {
        const registros = db[categoria];
        if (!registros) return;
        Object.values(registros).forEach(item => {
            const cid = (item.CIDADE || "").toString().toUpperCase().trim();
            if (cidadesAlvo && !cidadesAlvo.some(c => cid.includes(c))) return;

            const bairro     = (item.BAIRRO     || "").toString().toUpperCase().trim();
            const logradouro = (item.LOGRADOURO || item.ENDERECO || "").toString().toUpperCase().trim();
            const lat = parseFloat(String(item.LATITUDE || item.latitude || "").replace(',', '.').trim());
            const lng = parseFloat(String(item.LONGITUDE || item.longitude || "").replace(',', '.').trim());
            const temCoord = !isNaN(lat) && !isNaN(lng) && lat >= -11.0 && lat <= -7.0 && lng >= -38.5 && lng <= -34.5;
            if (!bairro && !temCoord) return; // sem bairro e sem coordenada: não há como localizar

            const pesoTotal  = PESOS_ATIVOS[categoria] || 1;
            const pesoGravio = categoria !== 'geral' ? pesoTotal : 0;
            itens.push({ cid, bairro, logradouro, lat, lng, temCoord, pesoGravio,
                data: item.DATA || item.data, hora: item.HORA });
        });
    });

    // ── Passo 1.5: detecta coordenadas SUSPEITAS — a mesma coordenada
    // exata aparecendo em muitos registros (≥8) com bairros bem
    // diferentes entre si é indício de um pino padrão/fake da
    // geocodificação de origem, não a localização real da ocorrência
    // (confirmado com dados reais: uma única coordenada apareceu em 105
    // registros de 20 bairros distintos). Esses registros caem no método
    // antigo (por texto de BAIRRO) em vez de contaminar o agrupamento
    // geográfico do restante — decisão tomada com o usuário depois de eu
    // reportar esse achado durante os testes.
    const LIMIAR_QTD_SUSPEITA = 8;
    const LIMIAR_BAIRROS_SUSPEITA = 3;
    const porCoordExata = new Map();
    itens.forEach(it => {
        if (!it.temCoord) return;
        const chave = it.lat.toFixed(5) + ',' + it.lng.toFixed(5);
        if (!porCoordExata.has(chave)) porCoordExata.set(chave, { n: 0, bairros: new Set() });
        const info = porCoordExata.get(chave);
        info.n++;
        if (it.bairro) info.bairros.add(it.bairro);
    });
    const coordsSuspeitas = new Set();
    porCoordExata.forEach((info, chave) => {
        if (info.n >= LIMIAR_QTD_SUSPEITA && info.bairros.size >= LIMIAR_BAIRROS_SUSPEITA) coordsSuspeitas.add(chave);
    });
    itens.forEach(it => {
        if (it.temCoord && coordsSuspeitas.has(it.lat.toFixed(5) + ',' + it.lng.toFixed(5))) it.temCoord = false;
    });

    // ── Passo 2: agrupamento geográfico dos itens com coordenada válida,
    // em 2 estágios — bucket determinístico por célula de grade (não
    // depende da ORDEM de processamento) seguido de fusão das sementes
    // vizinhas cujo centroide real fica dentro do raio. Evita o "efeito
    // cadeia" do agrupamento incremental puro (A perto de B, B perto de
    // C, mas A longe de C — o centroide vai arrastando e cola pontos
    // fisicamente distantes), que testado com dados reais colava até 20+
    // bairros diferentes num grupo só.
    const celulas = new Map();
    itens.forEach(it => {
        if (!it.temCoord) return;
        const chaveCelula = Math.round(it.lat / RAIO_AGRUPAMENTO_GRAU) + ':' + Math.round(it.lng / RAIO_AGRUPAMENTO_GRAU);
        if (!celulas.has(chaveCelula)) celulas.set(chaveCelula, []);
        celulas.get(chaveCelula).push(it);
    });
    const sementes = Array.from(celulas.values()).map(itensCel => ({
        lat: itensCel.reduce((s, p) => s + p.lat, 0) / itensCel.length,
        lng: itensCel.reduce((s, p) => s + p.lng, 0) / itensCel.length,
        itens: itensCel,
    }));
    const gruposGeo = [];
    sementes.forEach(sem => {
        let g = gruposGeo.find(g => Math.sqrt((g.lat - sem.lat) ** 2 + (g.lng - sem.lng) ** 2) < RAIO_AGRUPAMENTO_GRAU);
        if (!g) { g = { lat: sem.lat, lng: sem.lng, itens: [] }; gruposGeo.push(g); }
        g.itens.push(...sem.itens);
        g.lat = g.itens.reduce((s, p) => s + p.lat, 0) / g.itens.length;
        g.lng = g.itens.reduce((s, p) => s + p.lng, 0) / g.itens.length;
    });
    // Itens sem coordenada confiável (incluindo os rebaixados no Passo
    // 1.5) caem no método antigo, por texto de BAIRRO.
    itens.forEach(it => { if (!it.temCoord) it.chave = 'bairro:' + (it.bairro || 'NAO INFORMADO'); });
    gruposGeo.forEach((g, i) => {
        const chave = 'geo:' + i;
        g.itens.forEach(it => { it.chave = chave; });
        const freqBairro = {}, freqCidade = {};
        g.itens.forEach(it => {
            if (it.bairro) freqBairro[it.bairro] = (freqBairro[it.bairro] || 0) + 1;
            if (it.cid)    freqCidade[it.cid]    = (freqCidade[it.cid]    || 0) + 1;
        });
        const bairroTop = Object.entries(freqBairro).sort((a, b) => b[1] - a[1])[0];
        const cidadeTop = Object.entries(freqCidade).sort((a, b) => b[1] - a[1])[0];
        infoChave[chave] = {
            nome: bairroTop ? bairroTop[0] : (cidadeTop ? cidadeTop[0] : 'ÁREA GEOGRÁFICA'),
            cidade: cidadeTop ? cidadeTop[0] : null,
            lat: g.lat, lng: g.lng,
            raioKm: raioDoAgrupamento(g.itens, g.lat, g.lng),
        };
    });

    // ── Passo 3: acumula qtd/gravidade por turno e histórico geral,
    // igual à lógica de sempre, agora chaveada pelo agrupamento (geo ou
    // bairro-texto) em vez do texto cru de BAIRRO ─────────────────────
    itens.forEach(it => {
        const chave = it.chave;
        const ehRural = it.bairro.includes("ZONA RURAL") || it.bairro.includes("RURAL");
        if (ehRural && it.logradouro) {
            if (!logradourosPorChave[chave]) logradourosPorChave[chave] = {};
            logradourosPorChave[chave][it.logradouro] = (logradourosPorChave[chave][it.logradouro] || 0) + 1;
        }

        qtdGeral[chave]   = (qtdGeral[chave]   || 0) + 1;
        graveGeral[chave] = (graveGeral[chave] || 0) + it.pesoGravio;

        if (!dentroJanela(it.data)) return;

        const h = horaValida(it.hora);
        if (h === null) {
            const frac = 1 / 3;
            for (const t of TURNOS) {
                qtd[t][chave]   = (qtd[t][chave]   || 0) + frac;
                grave[t][chave] = (grave[t][chave] || 0) + (it.pesoGravio * frac);
            }
            return;
        }

        let turno;
        if      (h >= 6  && h < 12) turno = 'manha';
        else if (h >= 12 && h < 18) turno = 'tarde';
        else                        turno = 'noite';

        qtd[turno][chave]   = (qtd[turno][chave]   || 0) + 1;
        grave[turno][chave] = (grave[turno][chave] || 0) + it.pesoGravio;
        totalQtdTurno[turno]   += 1;
        totalGraveTurno[turno] += it.pesoGravio;
    });

    // Resolve nome de exibição + dados geográficos de uma chave — geo:N
    // já vem pronto de infoChave; bairro:XXXX resolve rural->logradouro
    // igual sempre foi, sem dado geográfico real (não georreferenciável).
    const resolverInfo = (chave) => {
        if (infoChave[chave]) {
            const info = infoChave[chave];
            const lograd = logradourosPorChave[chave];
            if (info.nome.includes('RURAL') && lograd) {
                const top = Object.entries(lograd).sort((a, b) => b[1] - a[1])[0];
                return top ? Object.assign({}, info, { nome: top[0] }) : info;
            }
            return info;
        }
        const bairro = chave.slice('bairro:'.length);
        const ehRural = bairro.includes('ZONA RURAL') || bairro.includes('RURAL');
        const lograd  = logradourosPorChave[chave];
        const topLograd = ehRural && lograd ? Object.entries(lograd).sort((a, b) => b[1] - a[1])[0] : null;
        return { nome: topLograd ? topLograd[0] : bairro, cidade: null, lat: null, lng: null, raioKm: null };
    };
    // offset: pula os `offset` locais mais críticos do ranking antes de
    // pegar os próximos `n` — usado quando 2 guarnições da MESMA cidade
    // patrulham no MESMO turno ao mesmo tempo (ex.: RP 01 e RP 02 de
    // Palmeira, ambas de patrulhamento entre 20h-00h): sem isso, as duas
    // puxam exatamente o mesmo ranking de criticidade e acabam mandadas
    // pro MESMO ponto. Ver uso em processarDados (RP 02, bloco 20:30-00:00).
    const topLocais = (scores, n, offset) =>
        Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(offset || 0, (offset || 0) + n).map(([chave]) => resolverInfo(chave));
    const somaObj = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);

    function analisarTurno(nomeTurno, nLocais, offset) {
        const n = nLocais || 3;
        const somaGraveTurno = somaObj(grave[nomeTurno]);
        const somaQtdTurno   = somaObj(qtd[nomeTurno]);
        const totalGraveValido = Object.values(totalGraveTurno).reduce((a, b) => a + b, 0);
        const totalQtdValido   = Object.values(totalQtdTurno).reduce((a, b) => a + b, 0);

        if (totalGraveTurno[nomeTurno] > 0 || somaGraveTurno > 0) {
            const pct = totalGraveValido > 0 ? (totalGraveTurno[nomeTurno] / totalGraveValido) * 100 : 0;
            const locais = topLocais(grave[nomeTurno], n, offset);
            const nOcorr = totalQtdTurno[nomeTurno] > 0 ? `${totalQtdTurno[nomeTurno]} ocorr. c/ hora` : 'ocorrências';
            const info = pct > 0 ? `GRAV.${pct.toFixed(0)}% — ${nOcorr} (90 dias)` : `${nOcorr} (90 dias)`;
            let miss = null, h = null;
            if (pct > 50)       { miss = '🚨 ROTA CRÍTICA'; h = 'red'; }
            else if (pct >= 25) { h = 'orange'; }
            return { locais, info, miss, h };
        }

        if (totalQtdTurno[nomeTurno] > 0 || somaQtdTurno > 0) {
            const pct = totalQtdValido > 0 ? (totalQtdTurno[nomeTurno] / totalQtdValido) * 100 : 0;
            const locais = topLocais(qtd[nomeTurno], n, offset);
            const nOcorr = totalQtdTurno[nomeTurno] > 0 ? `${totalQtdTurno[nomeTurno]} ocorr.` : 'registros';
            const info = pct > 0 ? `QTD.${pct.toFixed(0)}% — ${nOcorr} (90 dias)` : `${nOcorr} (90 dias)`;
            let miss = null, h = null;
            if (pct > 50)       { miss = '🚨 ROTA CRÍTICA'; h = 'red'; }
            else if (pct >= 25) { h = 'orange'; }
            return { locais, info, miss, h };
        }

        const fallback = Object.values(graveGeral).some(v => v > 0) ? graveGeral : qtdGeral;
        const locais   = topLocais(fallback, n, offset);
        return { locais, info: 'HISTÓRICO GERAL', miss: null, h: null };
    }

    function montarLinha(ini, fim, nomeTurno, missPadrao, nLocais, offset) {
        const { locais, info, miss, h } = analisarTurno(nomeTurno, nLocais || 3, offset);
        const nomes = locais.map(l => l.nome);
        const top = nomes.length > 0 ? nomes.join(" | ") : "CENTRO DA CIDADE";
        const det = `${top}  (${info})`;
        // areasGeo: só os locais com coordenada REAL (agrupamento
        // georreferenciado) — guardado pra gerar o perímetro do
        // rastreamento ao salvar (ver salvarCartaoAtual), sem precisar
        // re-adivinhar a área a partir do texto depois.
        const areasGeo = locais.filter(l => l.lat != null).map(l => ({ nome: l.nome, lat: l.lat, lng: l.lng, raioKm: l.raioKm }));
        return { ini, fim, miss: miss || missPadrao, det, h, areasGeo };
    }

    return { montarLinha, analisarTurno, qtd, totalQtdTurno };
}

const fixa = (ini, fim, miss, det, h) => ({ ini, fim, miss, det, h: h || null });

// Texto-resumo "📊 INTELIGÊNCIA" (distribuição por turno) — mesmo cálculo
// de sempre, extraído pra ser reaproveitado pelas RPs e pelo Tático Urbano.
function computarResumo(an) {
    const somaObj2 = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);
    const totalNos90 = ['manha','tarde','noite'].reduce((s,t) => s + somaObj2(an.qtd[t]), 0);
    const nomesTurno = { manha:'Manhã(06-12h)', tarde:'Tarde(12-18h)', noite:'Noite(18-05h)' };
    const partes = [];
    for (const t of ['manha','tarde','noite']) {
        const q  = an.totalQtdTurno[t];
        const tV = Object.values(an.totalQtdTurno).reduce((a,b)=>a+b,0);
        const pQ = tV > 0 ? ((q / tV) * 100).toFixed(0) : 0;
        // Reaproveita analisarTurno só pra pegar o % de gravidade já calculado
        const info = an.analisarTurno(t, 1).info || '';
        const mGrav = info.match(/GRAV\.(\d+)%/);
        const pG = mGrav ? mGrav[1] : 0;
        const sQ = Math.round(somaObj2(an.qtd[t]));
        if (sQ > 0) partes.push(`${nomesTurno[t]}: ${sQ} reg. | Grav.${pG}% / Qtd.${pQ}%`);
    }
    return { resumo: partes.join(' &bull; '), totalQtd: Math.round(totalNos90) };
}

// ── Analisador de criticidade por CIDADE (não por bairro), SEM filtro de
// cidade — usado pelos táticos RURAIS: em vez de patrulhar uma área fixa,
// vão pra CIDADE mais crítica do turno, dentre TODAS as cidades da área do
// batalhão. Mesma lógica de prioridade de construirAnalisador (gravidade >
// quantidade > histórico geral), só que agrupando por CIDADE.
function analisarCidadeMaisCritica(db, nomeTurno) {
    const TURNOS = ['manha', 'tarde', 'noite'];
    const qtd   = { manha:{}, tarde:{}, noite:{} };
    const grave = { manha:{}, tarde:{}, noite:{} };
    const totalQtdTurno   = { manha:0, tarde:0, noite:0 };
    const totalGraveTurno = { manha:0, tarde:0, noite:0 };
    const qtdGeral = {}, graveGeral = {};

    // Sem filtro de cidade (null) — mancha criminal GERAL de toda a área
    // do batalhão, mesmo critério de categoriasAtivasPara usado pelas RPs.
    categoriasAtivasPara(db, null).forEach(categoria => {
        const registros = db[categoria];
        if (!registros) return;
        Object.values(registros).forEach(item => {
            const cid = (item.CIDADE || "").toString().toUpperCase().trim();
            if (!cid) return;

            const pesoTotal  = PESOS_ATIVOS[categoria] || 1;
            const pesoGravio = categoria !== 'geral' ? pesoTotal : 0;

            qtdGeral[cid]   = (qtdGeral[cid]   || 0) + 1;
            graveGeral[cid] = (graveGeral[cid] || 0) + pesoGravio;

            if (!dentroJanela(item.DATA || item.data)) return;

            const h = horaValida(item.HORA);
            if (h === null) {
                const frac = 1 / 3;
                for (const t of TURNOS) {
                    qtd[t][cid]   = (qtd[t][cid]   || 0) + frac;
                    grave[t][cid] = (grave[t][cid]  || 0) + (pesoGravio * frac);
                }
                return;
            }

            let turno;
            if      (h >= 6  && h < 12) turno = 'manha';
            else if (h >= 12 && h < 18) turno = 'tarde';
            else                        turno = 'noite';

            qtd[turno][cid]   = (qtd[turno][cid]   || 0) + 1;
            grave[turno][cid] = (grave[turno][cid]  || 0) + pesoGravio;
            totalQtdTurno[turno]   += 1;
            totalGraveTurno[turno] += pesoGravio;
        });
    });

    const somaObj = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);
    const topCidade = (scores) => {
        const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
        return entries.length ? entries[0][0] : null;
    };

    const somaGraveTurno = somaObj(grave[nomeTurno]);
    const somaQtdTurno   = somaObj(qtd[nomeTurno]);
    const totalGraveValido = Object.values(totalGraveTurno).reduce((a, b) => a + b, 0);
    const totalQtdValido   = Object.values(totalQtdTurno).reduce((a, b) => a + b, 0);

    if (totalGraveTurno[nomeTurno] > 0 || somaGraveTurno > 0) {
        const cidade = topCidade(grave[nomeTurno]);
        const pct = totalGraveValido > 0 ? (totalGraveTurno[nomeTurno] / totalGraveValido) * 100 : 0;
        const nOcorr = totalQtdTurno[nomeTurno] > 0 ? `${totalQtdTurno[nomeTurno]} ocorr. c/ hora` : 'ocorrências';
        const info = pct > 0 ? `GRAV.${pct.toFixed(0)}% — ${nOcorr} (90 dias)` : `${nOcorr} (90 dias)`;
        let h = null;
        if (pct > 50) h = 'red'; else if (pct >= 25) h = 'orange';
        return { cidade: cidade || 'PALMEIRA DOS ÍNDIOS', info, h, totalQtdTurno: totalQtdTurno[nomeTurno] };
    }
    if (totalQtdTurno[nomeTurno] > 0 || somaQtdTurno > 0) {
        const cidade = topCidade(qtd[nomeTurno]);
        const pct = totalQtdValido > 0 ? (totalQtdTurno[nomeTurno] / totalQtdValido) * 100 : 0;
        const nOcorr = totalQtdTurno[nomeTurno] > 0 ? `${totalQtdTurno[nomeTurno]} ocorr.` : 'registros';
        const info = pct > 0 ? `QTD.${pct.toFixed(0)}% — ${nOcorr} (90 dias)` : `${nOcorr} (90 dias)`;
        let h = null;
        if (pct > 50) h = 'red'; else if (pct >= 25) h = 'orange';
        return { cidade: cidade || 'PALMEIRA DOS ÍNDIOS', info, h, totalQtdTurno: totalQtdTurno[nomeTurno] };
    }
    const fallback = Object.values(graveGeral).some(v => v > 0) ? graveGeral : qtdGeral;
    const cidade = topCidade(fallback);
    return { cidade: cidade || 'PALMEIRA DOS ÍNDIOS', info: 'HISTÓRICO GERAL', h: null, totalQtdTurno: 0 };
}

// ── Cartões dos TÁTICOS — horários FIXOS (não variam por análise
// criminal), definidos pelo 1º Tenente Calheiros. Só o CONTEÚDO de
// alguns blocos (bairros/cidade mais crítica) vem da análise; os
// horários e a estrutura do cronograma são sempre os mesmos:
//
//   TÁTICO URBANO (patrulha só Palmeira, igual uma RP):
//     09h-13h Patrulhamento (mancha criminal DE PALMEIRA)
//     13h-15h30 Almoço/Descanso
//     16h-18h30 Cumprimento de OPO
//     18h30-20h Janta/Descanso
//     20h-21h Patrulhamento em áreas críticas (mancha criminal DE PALMEIRA)
//     21h-00h Cumprimento de OPO
//
//   TÁTICO RURAL 01/02 (não tem área fixa de patrulhamento — segue a
//   mancha criminal GERAL, ou seja, a cidade mais crítica do dia nesse
//   horário; só o bloco de OPO é fixo numa cidade — Maribondo/Igaci):
//     09h-13h Patrulhamento (mancha criminal GERAL — cidade mais crítica)
//     13h-15h30 Almoço/Descanso
//     16h-00h Cumprimento de OPO (cidade fixa)
function processarDadosTatico(tipoTaticoUpper, db) {
    const ehUrbano  = tipoTaticoUpper.includes('URBANO');
    const ehRural01 = /RURAL\s*0?1\b/.test(tipoTaticoUpper);

    let cronograma, cidade, cidadesPatrulhadas, nomeUnidade, resumo, totalQtd;

    if (ehUrbano) {
        nomeUnidade = 'TÁTICO URBANO';
        cidade = 'PALMEIRA DOS ÍNDIOS';
        cidadesPatrulhadas = [cidade];
        const opoCidade = 'PALMEIRA DOS ÍNDIOS';

        const an = construirAnalisador(db, cidadesPatrulhadas);
        cronograma = [
            an.montarLinha("09:00","13:00", 'manha', "Patrulhamento — Mancha Criminal de Palmeira"),
            fixa(          "13:00","15:30",           "Almoço / Descanso",  "BASE OPERACIONAL", "green"),
            fixa(          "16:00","18:30",           "Cumprimento de OPO", `OPO — ${opoCidade}`, null),
            fixa(          "18:30","20:00",           "Janta / Descanso",   "BASE OPERACIONAL", "green"),
            an.montarLinha("20:00","21:00", 'noite',  "Patrulhamento em Áreas Críticas — Mancha Criminal de Palmeira"),
            fixa(          "21:00","00:00",           "Cumprimento de OPO", `OPO — ${opoCidade}`, null),
        ];
        ({ resumo, totalQtd } = computarResumo(an));
    } else {
        const opoCidade = ehRural01 ? 'MARIBONDO' : 'IGACI';
        nomeUnidade = ehRural01 ? 'TÁTICO RURAL 01' : 'TÁTICO RURAL 02';
        cidade = opoCidade;
        cidadesPatrulhadas = [opoCidade];

        // 09h-13h cai majoritariamente na janela 'manha' (06-12h) do
        // critério de turno já usado no resto do sistema.
        const info = analisarCidadeMaisCritica(db, 'manha');
        const det  = `${info.cidade}  (${info.info})`;
        const missPrefixo = info.h === 'red' ? '🚨 ' : '';

        cronograma = [
            { ini:"09:00", fim:"13:00", miss:`${missPrefixo}Patrulhamento — Cidade Mais Crítica`, det, h: info.h },
            fixa("13:00","15:30", "Almoço / Descanso",  "BASE OPERACIONAL", "green"),
            fixa("16:00","00:00", "Cumprimento de OPO", `OPO — ${opoCidade}`, null),
        ];
        totalQtd = info.totalQtdTurno || 0;
        resumo = `Patrulhamento itinerante por mancha criminal geral (09h-13h) — OPO fixo em ${opoCidade} (16h-00h).`;
    }

    return {
        cidade,
        cidadesPatrulhadas,
        rp:   nomeUnidade,
        data: new Date().toLocaleDateString('pt-BR'),
        cronograma,
        resumo,
        totalQtd,
    };
}

// ================================================================
// BOTÃO PRINCIPAL
// ================================================================
async function clicarBotaoGerar() {
    const cfg = await P3.loadUnidadeConfig();
    FIREBASE_URL = cfg.firebase.databaseURL;
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
        // sossego/violencia_domestica são buscados sempre (custo baixo,
        // 2 nós a mais em paralelo) — só ENTRAM de fato na análise quando
        // a RP tem pouco CVLI (ver categoriasAtivasPara em processarDados).
        const [geral, cvp, cvli, droga, sossego, violencia_domestica] = await Promise.all([
            fetchData('geral'), fetchData('cvp'), fetchData('cvli'), fetchData('droga'),
            fetchData('sossego'), fetchData('violencia_domestica'),
        ]);
        const db = { geral, cvp, cvli, droga, sossego, violencia_domestica };
        const dados = processarDados(rpSelecionada, db);
        ultimoDadosCartao = dados;
        ultimoDadosCartao.rpSelecionado = rpSelecionada;
        ultimasOcorrenciasFlat = achatarOcorrencias(db);
        const { html, linhasIniciais } = gerarTemplateHTML(dados);
        container.innerHTML = html;
        // Popula o tbody APÓS o innerHTML estar no DOM — scripts inline em innerHTML não executam
        const tbody = container.querySelector('#tbody-cartao');
        if (tbody) _renderizarTbody(tbody, linhasIniciais);
        document.getElementById('btn-imprimir').style.display = "inline-block";
        const btnSalvar = document.getElementById('btn-salvar-cartao');
        if (btnSalvar) btnSalvar.style.display = "inline-block";
        const labelPerimetro = document.getElementById('label-perimetro-cartao');
        if (labelPerimetro) labelPerimetro.style.display = "inline-block";

        // Nota de Inteligência Criminal (rede conhecida) — carregada em
        // SEGUNDO PLANO, depois do cartão já estar na tela: o Supabase
        // (13 tabelas) pode levar vários segundos, e o cartão-programa é
        // ferramenta de uso rápido do dia a dia — não faz sentido atrasar
        // a geração normal por causa disso. Quando terminar, só injeta um
        // aviso se houver atividade de rede conhecida nas cidades desta
        // guarnição (nunca aponta pessoa específica aqui — só avisa que
        // existe rede ativa, o detalhe fica na Análise Preditiva/Aba
        // Pessoas e Redes).
        if (window.IntelCrime) {
            const notaRede = document.createElement('div');
            notaRede.id = 'nota-rede-cartao';
            notaRede.style.cssText = 'margin-top:10px;padding:10px 14px;border-radius:8px;background:#fff3e0;color:#7a4a00;font-size:.85rem;display:none;';
            container.appendChild(notaRede);
            window.IntelCrime.carregar(cfg).then(() => {
                const cidadesDoCartao = (dados.cidadesPatrulhadas || [dados.cidade]).filter(Boolean);
                const rankingFake = cidadesDoCartao.map(c => ({ cidade: c, bairro: '', probabilidade: 0 }));
                const ajustado = window.IntelCrime.ajustarRiscoLocalComRede(rankingFake);
                const comRede = ajustado.filter(r => r.ajustadoPorRede);
                if (comRede.length) {
                    notaRede.innerHTML = `🕸️ <strong>Inteligência Criminal:</strong> há atividade de rede conhecida (vínculos/ORCRIM) recente em
                        ${comRede.map(r => r.cidade).join(', ')} — ver detalhes na Análise Preditiva, aba "Pessoas e Redes".`;
                    notaRede.style.display = '';
                }
            }).catch(err => console.error('[gerarcartao] Inteligência Criminal:', err));
        }
    } catch (err) {
        container.innerHTML = "<p style='color:red;text-align:center;'>Erro ao carregar dados.</p>";
        console.error(err);
    }
}

// ================================================================
// PROCESSAMENTO
// ================================================================
function processarDados(cidadeFiltro, db) {
    const gNome = cidadeFiltro.toUpperCase();

    // Recalibra PESOS_ATIVOS por reincidência real ANTES de qualquer
    // análise (RP normal ou Tático) — processarDados roda 1x por clique
    // em "Gerar", então isso não recalcula por RP nem fica caro.
    calibrarPesosAtivos(db);

    // Táticos (Urbano/Rural) têm estrutura de cronograma diferente das RPs
    // (horários fixos, alguns blocos por cidade mais crítica em vez de
    // bairro) — ver processarDadosTatico() e o comentário grande acima dela.
    if (gNome.includes('TÁTICO') || gNome.includes('TATICO')) {
        return processarDadosTatico(gNome, db);
    }

    // ── Cidades alvo desta RP ────────────────────────────────────
    const chaveRP     = identificarChaveRP(cidadeFiltro);
    const cidadesAlvo = chaveRP
        ? MAPA_RP_CIDADES[chaveRP].map(c => c.toUpperCase())
        : [cidadeFiltro.split('(')[0].trim().toUpperCase()];

    // Análise de criticidade por bairro, restrita às cidades desta RP —
    // mesma lógica de sempre (gravidade > quantidade > histórico geral),
    // ver construirAnalisador() acima (extraída daqui pra ser reaproveitada
    // pelo Tático Urbano também).
    const an          = construirAnalisador(db, cidadesAlvo);
    const montarLinha = an.montarLinha;
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
            // offset=3: das 20:30 às 00:00 a RP 02 patrulha ao MESMO tempo
            // que a RP 01 (bloco 19:00-00:00 dela, logo abaixo) — sem o
            // deslocamento, as duas puxam o mesmo ranking de criticidade
            // ("noite") e acabam mandadas pro MESMO local. A RP 01 fica
            // com os 3 pontos mais críticos (offset padrão); a RP 02 pega
            // os 3 seguintes, ainda dentro da mancha criminal real, só que
            // sem repetir. Ajuste pedido pelo usuário.
            montarLinha("20:30","00:00", 'noite',   "Patrulhamento Noturno 1", 3, 3),
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
    const { resumo, totalQtd } = computarResumo(an);

    return {
        cidade:             cidadesAlvo[0],
        cidadesPatrulhadas: cidadesAlvo,
        rp:   cidadeFiltro.includes("(") ? cidadeFiltro.split('(')[1].replace(')', '') : "RP",
        data: new Date().toLocaleDateString('pt-BR'),
        cronograma,
        resumo,
        totalQtd,
    };
}

// ================================================================
// TEMPLATE HTML — EDITÁVEL
// ================================================================

/**
 * Serializa as linhas atuais da tabela para um array de objetos,
 * lendo os inputs/contenteditable presentes no DOM.
 * Usado pelo botão "Adicionar Linha" para obter o estado atual.
 */
function _lerLinhasDoDOM(tbody) {
    const linhas = [];
    tbody.querySelectorAll('tr[data-idx]').forEach(tr => {
        const critica = tr.dataset.critica === 'true';
        // Ignora col-drag (indice 0) e col-acoes (ultimo) — so le as 4 colunas de dados
        const tds = Array.from(tr.querySelectorAll('td')).filter(
            td => !td.classList.contains('col-drag') && !td.classList.contains('col-acoes')
        );
        const val = (td) => {
            const inp = td ? td.querySelector('input') : null;
            if (inp) return inp.value;
            // Rota critica: bairros ficam num <span>, ignora o lock-badge
            const span = td ? td.querySelector('span:not(.lock-badge)') : null;
            return span ? span.innerText.trim() : (td ? td.innerText.trim() : '');
        };
        let areasGeo = null;
        if (tr.dataset.areasGeo) {
            try { areasGeo = JSON.parse(tr.dataset.areasGeo); } catch (e) { areasGeo = null; }
        }
        linhas.push({
            ini:     val(tds[0]),
            fim:     val(tds[1]),
            miss:    val(tds[2]),
            det:     val(tds[3]),
            critica,
            h:       tr.dataset.h || null,
            areasGeo,
        });
    });
    return linhas;
}

/**
 * Renderiza o <tbody> completo a partir de um array de objetos de linha.
 * É chamado na geração inicial e sempre que uma linha é adicionada/removida.
 *
 * Regras de edição:
 *  - Linha normal (h !== 'red'):  todos os 4 campos editáveis via <input>
 *  - Linha de rota crítica (h === 'red'):
 *      · INÍCIO, FIM e MISSÃO → editáveis via <input>
 *      · BAIRROS/LOGRADOUROS  → somente leitura (gerado pela análise criminal)
 *
 * Todas as linhas têm botão "×" para exclusão.
 * O botão "+ Linha" abaixo da tabela adiciona uma linha em branco ao final.
 */
function _renderizarTbody(tbody, linhas) {
    tbody.innerHTML = '';

    linhas.forEach((item, idx) => {
        const tr = document.createElement('tr');
        tr.dataset.idx     = idx;
        tr.dataset.critica = item.critica ? 'true' : 'false';
        tr.dataset.h       = item.h || '';
        // Dados geográficos do agrupamento (ver construirAnalisador) —
        // guardados no próprio <tr> pra sobreviver a reordenação/remoção
        // de linha (_lerLinhasDoDOM os lê de volta) e serem usados direto
        // ao salvar o cartão (ver salvarCartaoAtual), sem re-adivinhar a
        // área a partir do texto.
        tr.dataset.areasGeo = item.areasGeo ? JSON.stringify(item.areasGeo) : '';

        if (item.h === 'red')    { tr.style.backgroundColor = '#ffcccc'; tr.style.fontWeight = 'bold'; }
        if (item.h === 'orange') { tr.style.backgroundColor = '#ffe0b2'; tr.style.fontWeight = 'bold'; }
        if (item.h === 'green')  { tr.style.backgroundColor = '#e8f5e9'; }

        const inputStyle = `
            width:100%; box-sizing:border-box; border:none; background:transparent;
            font-family:inherit; font-size:inherit; font-weight:inherit;
            color:inherit; padding:2px 3px; outline:none;
        `;
        const readonlyStyle = `
            width:100%; box-sizing:border-box; padding:2px 3px;
            font-family:inherit; font-size:inherit; font-weight:inherit;
            color:#333; background:transparent;
        `;
        const tdBase = `border:1px solid #333; padding:4px 6px;`;
        const bloquearBairros = (item.h === 'red');

        const detHTML = bloquearBairros
            ? `<span style="${readonlyStyle}" title="Campo gerado pela analise criminal">${item.det}</span>
               <span class="lock-badge" style="font-size:8px;color:#b71c1c;display:block;margin-top:2px;">&#128274; analise criminal</span>`
            : `<input type="text" value="${item.det.replace(/"/g, '&quot;')}" style="${inputStyle}" />`;

        tr.innerHTML = `
            <td class="col-drag" style="border:none;padding:0 6px;text-align:center;cursor:grab;color:#aaa;font-size:18px;user-select:none;" title="Arrastar para reordenar">&#8942;</td>
            <td style="${tdBase} text-align:center;white-space:nowrap;">
                <input type="text" value="${item.ini}" style="${inputStyle} text-align:center;" />
            </td>
            <td style="${tdBase} text-align:center;white-space:nowrap;">
                <input type="text" value="${item.fim}" style="${inputStyle} text-align:center;" />
            </td>
            <td style="${tdBase} font-weight:bold;">
                <input type="text" value="${item.miss.replace(/"/g, '&quot;')}" style="${inputStyle} font-weight:bold;text-transform:uppercase;" />
            </td>
            <td style="${tdBase}">
                ${detHTML}
            </td>
            <td class="col-acoes" style="border:none;padding:0 4px;text-align:center;white-space:nowrap;">
                <button onclick="_removerLinha(this)" title="Remover linha"
                    style="background:#c0392b;color:white;border:none;border-radius:4px;
                           padding:3px 8px;cursor:pointer;font-size:12px;line-height:1;">&#215;</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    _iniciarSortable(tbody);
}

/**
 * Carrega SortableJS via CDN (uma vez) e ativa drag-and-drop no tbody.
 */
function _iniciarSortable(tbody) {
    const _ativar = () => {
        if (tbody._sortable) tbody._sortable.destroy();
        tbody._sortable = new Sortable(tbody, {
            animation:   150,
            handle:      '.col-drag',
            ghostClass:  'sortable-ghost',
            chosenClass: 'sortable-chosen',
            onEnd() {
                // Apenas reindexar data-idx — sem re-renderizar o tbody inteiro
                // (evita loop e preserva todos os valores digitados nos inputs)
                tbody.querySelectorAll('tr[data-idx]').forEach((tr, i) => {
                    tr.dataset.idx = i;
                });
            }
        });
    };
    if (typeof Sortable !== 'undefined') {
        _ativar();
    } else {
        // Carrega o script apenas se ainda nao estiver no DOM
        if (!document.querySelector('script[data-sortable]')) {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Sortable/1.15.2/Sortable.min.js';
            s.dataset.sortable = '1';
            s.onload = _ativar;
            document.head.appendChild(s);
        }
    }
}


/**
 * Remove a linha cujo botão "×" foi clicado.
 * Relê todo o estado atual antes de remover para preservar edições feitas.
 */
function _removerLinha(btn) {
    const tr    = btn.closest('tr');
    const tbody = tr.closest('tbody');
    const idx   = parseInt(tr.dataset.idx, 10);
    const linhas = _lerLinhasDoDOM(tbody);
    linhas.splice(idx, 1);
    _renderizarTbody(tbody, linhas);
}

/**
 * Adiciona uma linha em branco após a última linha da tabela.
 * Preserva todas as edições já feitas pelo usuário.
 */
function _adicionarLinha(btn) {
    const tbody  = btn.closest('.card-programa').querySelector('tbody');
    const linhas = _lerLinhasDoDOM(tbody);
    linhas.push({ ini: '00:00', fim: '00:00', miss: 'NOVA MISSÃO', det: '', critica: false, h: null });
    _renderizarTbody(tbody, linhas);
}

function gerarTemplateHTML(data) {

    // Converte o cronograma para o formato interno (adiciona flag critica)
    // Retornamos também as linhas para que clicarBotaoGerar possa popular o tbody
    // APÓS o innerHTML ser inserido no DOM (scripts inline em innerHTML não executam).
    const linhasIniciais = data.cronograma.map(i => ({
        ini:     i.ini,
        fim:     i.fim,
        miss:    i.miss || '',
        det:     i.det  || '',
        critica: i.h === 'red',
        h:       i.h || null,
        areasGeo: i.areasGeo || null,
    }));

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

    const html = `
    <style>
        .card-programa {
            border:3px solid #003366; padding:15px; background:#fff;
            font-family:Arial,sans-serif; font-size:11px;
        }
        .table-c { width:100%; border-collapse:collapse; margin-top:10px; }
        .table-c th { background:#003366; color:white; padding:8px; border:1px solid #333; }

        /* Drag-and-drop visual feedback */
        .sortable-ghost   { opacity:0.4; background:#cfe2ff !important; }
        .sortable-chosen  { box-shadow:0 2px 8px rgba(0,0,0,0.25); }
        .col-drag:hover   { color:#003366 !important; }

        .table-c input:focus { background:#fffde7 !important; outline:1px solid #003366; border-radius:2px; }
        .assinatura { text-align:center; margin-top:20px; }
        .btn-add-linha {
            margin-top:8px; padding:6px 16px; background:#003366; color:white;
            border:none; border-radius:5px; cursor:pointer; font-size:11px; font-weight:bold;
        }
        .btn-add-linha:hover { background:#0056b3; }
        .barra-edicao {
            display:flex; align-items:center; gap:8px; margin-top:6px;
            padding:6px 8px; background:#f0f5ff; border:1px dashed #90a4ae;
            border-radius:5px; font-size:10px; color:#37474f;
        }

        /* ===== IMPRESSAO LIMPA ===== */
        @media print {
            .col-acoes,
            .col-drag,
            .barra-edicao,
            .btn-add-linha,
            .lock-badge           { display:none !important; }

            .table-c input {
                border:none !important;
                background:transparent !important;
                pointer-events:none;
                -webkit-appearance:none;
                appearance:none;
            }
        }
    </style>
    <div class="card-programa">
        <div style="display:flex;justify-content:space-between;align-items:center;
                    border-bottom:2px solid #003366;padding-bottom:5px;margin-bottom:8px;">
            <img src="https://pm.al.gov.br/joomgallery/image?view=image&format=raw&type=orig&id=84" width="60">
            <div style="text-align:center;">
                <h2 style="margin:0;font-size:16px;">CARTÃO PROGRAMA DE RP</h2>
                <h4 style="margin:0;font-size:12px;">${(window.P3_CONFIG && window.P3_CONFIG.nome ? window.P3_CONFIG.nome : '10º Batalhão de Polícia Militar').toUpperCase()}</h4>
            </div>
            <div style="text-align:right;font-size:10px;">
                <strong>DATA:</strong> ${data.data}<br>
                <strong>CIDADE(S):</strong> ${data.cidadesPatrulhadas.join(' / ')}<br>
                <strong>GU:</strong> ${data.rp}
            </div>
        </div>

        ${resumoHTML}
        ${legendaHTML}

        <div class="barra-edicao">
            ✏️ <strong>Modo edição ativo:</strong>
            clique em qualquer campo para editar.
            Linhas 🔒 ROTA CRÍTICA têm bairros protegidos (análise criminal).
            Use <strong>×</strong> para remover e o botão abaixo para adicionar linhas.
        </div>

        <table class="table-c">
            <thead>
                <tr>
                    <th class="col-drag" style="background:#003366;border:1px solid #333;padding:8px;width:20px;"></th>
                    <th>INÍCIO</th><th>FIM</th>
                    <th>MISSÃO</th>
                    <th>BAIRROS / LOGRADOUROS DE PATRULHAMENTO</th>
                    <th class="col-acoes" style="background:#003366;border:1px solid #333;padding:8px;width:32px;"></th>
                </tr>
            </thead>
            <tbody id="tbody-cartao"></tbody>
        </table>

        <button class="btn-add-linha" onclick="_adicionarLinha(this)">＋ Adicionar Linha</button>

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

    return { html, linhasIniciais };
}

// ================================================================
// SALVAR CARTÃO (Firebase da própria unidade — /cartoes_programa)
// ================================================================

// Achata {geral:{id:{...}}, cvp:{...}, ...} num array só de registros —
// mesmo formato que resolverAreaBairro() de js/cumprimento-core.js espera.
function achatarOcorrencias(db) {
    const flat = [];
    Object.keys(db || {}).forEach(categoria => {
        const registros = db[categoria];
        if (!registros) return;
        Object.values(registros).forEach(item => flat.push(item));
    });
    return flat;
}

// Resolve /rp_viatura_map na unidade logada; se ainda não existir, grava o
// seed inicial de js/cumprimento-core.js (SEED_RP_VIATURA) — assim a 1ª vez
// que alguém salva um cartão já fica com um palpite editável, sem exigir
// nenhuma configuração manual prévia. Centralizado em
// js/cumprimento-core.js (obterOuSemearMapaViatura) — reaproveitado aqui
// em vez de duplicar, pra garantir que uma correção de mapeamento feita na
// tela de Cumprimento valha em todo lugar.
async function obterOuSemearMapaViatura(dbUrl) {
    if (window.CumprimentoCore) return window.CumprimentoCore.obterOuSemearMapaViatura(dbUrl);
    return {};
}

async function salvarCartaoAtual() {
    const btnSalvar = document.getElementById('btn-salvar-cartao');
    const container = document.getElementById('iframe-container');
    const tbody = container ? container.querySelector('#tbody-cartao') : null;

    if (!tbody || !ultimoDadosCartao) { alert('Gere o cartão antes de salvar.'); return; }

    const textoOriginal = btnSalvar ? btnSalvar.textContent : '';
    if (btnSalvar) { btnSalvar.disabled = true; btnSalvar.textContent = 'Salvando...'; }

    try {
        const cfg = await P3.loadUnidadeConfig();
        const dbUrl = cfg.firebase.databaseURL;

        const mapaViatura = await obterOuSemearMapaViatura(dbUrl);
        const rpSelecionado = ultimoDadosCartao.rpSelecionado;
        const viaturaResponsavel = mapaViatura[rpSelecionado] || null;

        // Perímetro (km) definido pelo usuário nesta tela — sobrescreve o
        // raio automático padrão (1.2km/4km) do cálculo de cumprimento, que
        // se mostrou estreito demais em bairros grandes/alongados (dava
        // 100% de falha mesmo com patrulhamento real). Ver
        // js/cumprimento-core.js resolverAreaBairro().
        const inputPerimetro = document.getElementById('input-perimetro-cartao');
        const perimetroKm = inputPerimetro ? parseFloat(inputPerimetro.value) : null;

        const linhasDom = _lerLinhasDoDOM(tbody);
        const cronograma = linhasDom.map(linha => {
            // Prioridade 1: dado geográfico REAL já calculado na geração
            // (agrupamento georreferenciado — ver construirAnalisador em
            // js/gerarcartao.js), preservado no <tr> e lido de volta por
            // _lerLinhasDoDOM. O 1º item de areasGeo é o local de maior
            // prioridade (ordenado por gravidade/quantidade) — usado como
            // centro do perímetro; o perímetro manual (perimetroKm), se
            // informado, sempre sobrescreve o raio calculado.
            //
            // Prioridade 2 (fallback): linhas sem areasGeo — administrativas
            // (almoço/janta/OPO) ou adicionadas/editadas manualmente — ainda
            // passam por resolverAreaBairro (re-deriva do texto), mesmo
            // método de sempre. Passa TODAS as cidades sob responsabilidade
            // dessa RP (não só a principal) — RPs de 2 cidades (Mar
            // Vermelho/Paulo Jacinto, Belém/Tanque D'Arca, Minador/Estrela)
            // analisam a mancha criminal cruzando as duas, então o bairro
            // escolhido pode ser fisicamente da cidade "secundária".
            const temPerimetroManual = typeof perimetroKm === 'number' && perimetroKm > 0;
            const area = (linha.areasGeo && linha.areasGeo.length)
                ? {
                    lat: linha.areasGeo[0].lat,
                    lng: linha.areasGeo[0].lng,
                    raioKm: temPerimetroManual ? perimetroKm : linha.areasGeo[0].raioKm,
                    origem: 'georreferenciamento',
                }
                : (window.CumprimentoCore
                    ? window.CumprimentoCore.resolverAreaBairro(linha.det, ultimoDadosCartao.cidadesPatrulhadas, ultimasOcorrenciasFlat, perimetroKm)
                    : null);
            return Object.assign({}, linha, { area });
        });

        const sessao = window.P3 && window.P3.getSession ? window.P3.getSession() : null;
        const criadoEm = new Date().toISOString();
        const payload = {
            tipo: 'cartao',
            criadoEm,
            // Válido por 1 mês a partir de agora (ou até um novo cartão ser
            // salvo pra mesma RP, que passa a ser o "mais recente" nas
            // buscas) — pedido explícito do usuário.
            validoAte: window.CumprimentoCore ? window.CumprimentoCore.calcularValidoAte(criadoEm) : null,
            criadoPor: sessao ? [sessao.graduacao, sessao.nomeGuerra].filter(Boolean).join(' ') : null,
            data: ultimoDadosCartao.data,
            cidade: ultimoDadosCartao.cidade,
            cidadesPatrulhadas: ultimoDadosCartao.cidadesPatrulhadas,
            rpSelecionado,
            viaturaResponsavel,
            perimetroKm: (typeof perimetroKm === 'number' && perimetroKm > 0) ? perimetroKm : null,
            cronograma,
            resumo: ultimoDadosCartao.resumo,
            totalQtd: ultimoDadosCartao.totalQtd,
        };

        const res = await fetch(`${dbUrl}/cartoes_programa.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Falha ao gravar no Firebase');

        if (btnSalvar) {
            btnSalvar.textContent = viaturaResponsavel ? '✅ Salvo!' : '✅ Salvo (sem viatura mapeada)';
        }
        setTimeout(() => {
            if (btnSalvar) { btnSalvar.disabled = false; btnSalvar.textContent = textoOriginal || '💾 SALVAR CARTÃO'; }
        }, 3000);
    } catch (err) {
        console.error(err);
        alert('Não foi possível salvar o cartão. Tente novamente.');
        if (btnSalvar) { btnSalvar.disabled = false; btnSalvar.textContent = textoOriginal || '💾 SALVAR CARTÃO'; }
    }
}