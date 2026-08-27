// ════════════════════════════════════════════════════════════════════
// MACHINE LEARNING LEVE — Sistema P3 (10º BPM)
// ════════════════════════════════════════════════════════════════════
// Módulo complementar, 100% JavaScript puro, sem dependências externas,
// sem servidor — roda inteiro no navegador, em milissegundos, mesmo com
// alguns milhares de ocorrências. NÃO substitui a análise preditiva
// atual (js/analisePreditiva.js) nem o agrupamento geográfico atual
// (js/gerarcartao.js, js/opo-hotspot-core.js) — foi desenhado pra ser
// consumido POR ELES, como uma camada opcional de refino, sem exigir
// reescrever nada que já funciona.
//
// TRANSPARÊNCIA (auditoria do comando do 10º BPM) — cada técnica abaixo
// é comentada explicando EXATAMENTE como o "aprendizado" acontece, com
// os números reais que entram e saem. Nenhuma das técnicas aqui decide
// nada sozinha "às escuras": os pesos calibrados ficam sempre dentro de
// uma faixa segura em torno do peso definido pelo comando (ver
// FATOR_MIN/FATOR_MAX em calibrarPesos), e todo resultado informa se
// teve dado suficiente pra calibrar de verdade ou se caiu no padrão.
//
// 4 técnicas, cada uma na sua seção:
//   1) Suavização Exponencial Dupla (Holt) + sazonalidade leve (Holt-
//      Winters simplificado) — previsão de série temporal mensal, com
//      ajuste opcional por impacto de Eventos de médio/grande porte
//      (regra explícita, não ML treinado — ver seção 1b).
//   2) DBSCAN leve (com grade espacial pra não ser O(n²)) — agrupamento
//      geográfico por densidade real, complementar ao raio fixo atual.
//   3) Regressão Logística treinada do zero (gradiente descendente) —
//      calibra os PESOS de gravidade por reincidência histórica real.
//   4) Pontos ponderados pro heatmap (Leaflet.heat) usando os pesos
//      calibrados, em vez de intensidade fixa 1.0 pra tudo.
// ════════════════════════════════════════════════════════════════════

(function (global) {
    'use strict';
    if (global.MLLeve) return;

    // ────────────────────────────────────────────────────────────────
    // 0) COORDENADAS — mesmo critério de validação/limpeza já usado e
    // testado com dados reais em js/gerarcartao.js: bounding box de
    // Alagoas + detecção de "coordenada suspeita" (mesmo par exato
    // repetido em muitos registros de bairros diferentes = pino
    // padrão/fake da geocodificação de origem, não a localização real).
    // Reaproveitado aqui porque QUALQUER clustering geográfico (DBSCAN
    // incluído) vira lixo se alimentado com coordenadas fantasmas — um
    // "cluster" de 100 pontos todos exatamente no mesmo pino padrão
    // pareceria o hotspot mais crítico da unidade sem ser real.
    // ────────────────────────────────────────────────────────────────
    const LIMITE_LAT = [-11.0, -7.0];
    const LIMITE_LNG = [-38.5, -34.5];
    const LIMIAR_QTD_SUSPEITA = 8;
    const LIMIAR_BAIRROS_SUSPEITA = 3;

    // Recebe uma lista de ocorrências CRUAS (formato livre) e um par de
    // funções que sabem extrair lat/lng/bairro de cada item — devolve só
    // as que têm coordenada válida e não-suspeita, no formato comum
    // { lat, lng, ...resto do item original }.
    function filtrarCoordenadasValidas(itens, extrair) {
        extrair = extrair || function (it) {
            return {
                lat: parseFloat(String(it.LATITUDE || it.latitude || '').replace(',', '.').trim()),
                lng: parseFloat(String(it.LONGITUDE || it.longitude || '').replace(',', '.').trim()),
                bairro: (it.BAIRRO || it.bairro || '').toString().toUpperCase().trim(),
            };
        };
        const comCoord = [];
        itens.forEach(it => {
            const { lat, lng, bairro } = extrair(it);
            const valido = !isNaN(lat) && !isNaN(lng) &&
                lat >= LIMITE_LAT[0] && lat <= LIMITE_LAT[1] &&
                lng >= LIMITE_LNG[0] && lng <= LIMITE_LNG[1];
            if (valido) comCoord.push(Object.assign({}, it, { lat, lng, bairro }));
        });

        const porCoordExata = new Map();
        comCoord.forEach(it => {
            const chave = it.lat.toFixed(5) + ',' + it.lng.toFixed(5);
            if (!porCoordExata.has(chave)) porCoordExata.set(chave, { n: 0, bairros: new Set() });
            const info = porCoordExata.get(chave);
            info.n++;
            if (it.bairro) info.bairros.add(it.bairro);
        });
        const suspeitas = new Set();
        porCoordExata.forEach((info, chave) => {
            if (info.n >= LIMIAR_QTD_SUSPEITA && info.bairros.size >= LIMIAR_BAIRROS_SUSPEITA) suspeitas.add(chave);
        });
        return comCoord.filter(it => !suspeitas.has(it.lat.toFixed(5) + ',' + it.lng.toFixed(5)));
    }

    // ────────────────────────────────────────────────────────────────
    // 1) PREVISÃO DE SÉRIE TEMPORAL — Suavização Exponencial Dupla
    // (método de Holt) + sazonalidade mensal leve (Holt-Winters
    // simplificado). Complementa regressaoLinear()/mediaPonderada() de
    // js/analisePreditiva.js — não os substitui; a ideia é usar em
    // ENSEMBLE (média dos dois métodos), igual o próprio prever() atual
    // já faz média entre regressão linear e média ponderada.
    //
    // COMO O "APRENDIZADO" ACONTECE: a cada mês da série, o modelo
    // atualiza um NÍVEL (patamar atual) e uma TENDÊNCIA (quanto o
    // patamar sobe/desce por mês), cada um com um peso de quanto confiar
    // no dado novo vs. no que já sabia (alpha/beta). É determinístico e
    // 100% recalculável — dá pra conferir o resultado com calculadora.
    // ────────────────────────────────────────────────────────────────

    // serie: array de números em ordem cronológica (ex.: CVP por mês).
    // Retorna null se não tiver pelo menos 2 pontos (não dá pra estimar
    // tendência com 1 ponto só).
    function suavizacaoExponencialDupla(serie, alpha, beta, passos) {
        alpha = alpha != null ? alpha : 0.5;
        beta = beta != null ? beta : 0.3;
        passos = passos || 1;
        if (!Array.isArray(serie) || serie.length < 2) return null;

        let nivel = serie[0];
        let tendencia = serie[1] - serie[0];
        for (let t = 1; t < serie.length; t++) {
            const nivelAnterior = nivel;
            nivel = alpha * serie[t] + (1 - alpha) * (nivel + tendencia);
            tendencia = beta * (nivel - nivelAnterior) + (1 - beta) * tendencia;
        }
        const previsoes = [];
        for (let h = 1; h <= passos; h++) previsoes.push(Math.max(0, nivel + h * tendencia));
        return { previsoes, nivelFinal: nivel, tendenciaFinal: tendencia };
    }

    // Índice sazonal por posição no ciclo (ex.: mês 0-11), normalizado
    // pra média 1 (índice 1.3 = esse mês roda 30% acima da média do
    // ano; 0.8 = 20% abaixo). Precisa de pelo menos 2 CICLOS COMPLETOS
    // (24 meses pra período=12) pra ser confiável — com menos histórico
    // que isso, devolve null em vez de inventar sazonalidade sem
    // sustentação estatística (é comum uma unidade só ter 12-18 meses
    // de histórico digitalizado).
    function indicesSazonais(serieMensal, periodo) {
        periodo = periodo || 12;
        if (!Array.isArray(serieMensal) || serieMensal.length < periodo * 2) return null;

        const nCiclos = Math.floor(serieMensal.length / periodo);
        const mediasCiclo = [];
        for (let c = 0; c < nCiclos; c++) {
            const fatia = serieMensal.slice(c * periodo, (c + 1) * periodo);
            mediasCiclo.push(fatia.reduce((a, b) => a + b, 0) / periodo);
        }
        const somaIdx = new Array(periodo).fill(0);
        const contIdx = new Array(periodo).fill(0);
        for (let i = 0; i < nCiclos * periodo; i++) {
            const ciclo = Math.floor(i / periodo);
            const media = mediasCiclo[ciclo] || 0;
            const pos = i % periodo;
            somaIdx[pos] += media > 0 ? serieMensal[i] / media : 1;
            contIdx[pos]++;
        }
        const indices = somaIdx.map((s, i) => (contIdx[i] ? s / contIdx[i] : 1));
        const mediaGeral = indices.reduce((a, b) => a + b, 0) / periodo;
        return indices.map(v => (mediaGeral > 0 ? v / mediaGeral : 1));
    }

    // Previsão com sazonalidade: dessazonaliza a série, aplica Holt na
    // série "limpa", e reaplica o índice sazonal do(s) mês(es) previsto(s)
    // por cima. Se não tiver sazonalidade confiável (histórico curto),
    // cai automaticamente em Holt puro (sem sazonalidade) — nunca falha
    // silenciosamente, sempre informa em `sazonalidadeAtiva`.
    // ────────────────────────────────────────────────────────────────
    // 1b) IMPACTO DE EVENTOS — cruza a previsão criminal com a agenda de
    // Eventos (mesma fonte que já alimenta o Xerife: cfg.gas.EVENTOS,
    // campos 'DATA', 'CIDADE', 'ESTIMATIVA DE PÚBLICO'). Não é ML
    // treinado — é uma REGRA explícita e auditável (evento de
    // médio/grande porte na mesma cidade/dia amplia a previsão), porque
    // não existe hoje histórico suficiente de "quanto um evento
    // específico historicamente elevou o crime" pra treinar um modelo
    // nisso com segurança; um coeficiente fixo e documentado é mais
    // honesto que fingir uma calibração sem sustentação (mesmo
    // princípio de calibrarPesos recusando calibrar sem dado
    // suficiente).
    //
    // Aceita o formato CRU do GAS de Eventos, SEM precisar normalizar
    // nada antes (ver `_extrairCampo`/`_parseDataBR` abaixo) — quem
    // chama só precisa buscar a lista (fetch em cfg.gas.EVENTOS
    // ?action=read) e passar direto, sem duplicar a lógica de
    // filtragem/classificação de porte que já existe na página de
    // Eventos (essa classificação — >1000 grande, 501-1000 médio — é a
    // MESMA usada em page/calendario.html e js/xerife.js; mantida aqui
    // pra não exigir que o chamador replique isso).
    // ────────────────────────────────────────────────────────────────

    function _normTexto(s) {
        return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
    }
    function _extrairCampo(obj, chaves) {
        for (const k of chaves) {
            const v = obj[k];
            if (v !== undefined && v !== null && v !== '') return v;
        }
        return null;
    }
    function _parseDataBR(str) {
        if (!str) return null;
        const s = String(str).trim();
        let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
        m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
        return null;
    }
    // Mesmo critério de porte já usado em page/calendario.html e
    // js/xerife.js — até 500 pequeno, 501-1000 médio, acima de 1000 grande.
    function _portePorPublico(publico) {
        if (publico > 1000) return 'grande';
        if (publico > 500) return 'medio';
        return 'pequeno';
    }

    const COEFICIENTE_EVENTO_GRANDE = 1.5;
    const COEFICIENTE_EVENTO_MEDIO = 1.2;

    // data: Date do dia a checar. cidade: nome da cidade (comparação
    // sem acento/maiúscula, tolera "Palmeira dos Índios" vs "PALMEIRA
    // DOS INDIOS"). eventosList: array cru de cfg.gas.EVENTOS (ou já
    // normalizado com { data:Date, cidade, publico } — ambos funcionam).
    // opts.coeficienteGrande/coeficienteMedio permitem ajustar os
    // valores padrão (1.5/1.2) se o comando quiser calibrar diferente.
    // Retorna 1 (sem impacto) se não achar evento de médio/grande porte
    // na mesma cidade e data.
    function calcularImpactoEvento(data, cidade, eventosList, opts) {
        opts = opts || {};
        if (!(data instanceof Date) || isNaN(data.getTime()) || !cidade || !Array.isArray(eventosList) || !eventosList.length) return 1;

        const cidadeNorm = _normTexto(cidade);
        const coefGrande = opts.coeficienteGrande || COEFICIENTE_EVENTO_GRANDE;
        const coefMedio = opts.coeficienteMedio || COEFICIENTE_EVENTO_MEDIO;

        let maiorCoeficiente = 1;
        eventosList.forEach(ev => {
            const dataEv = ev.data instanceof Date ? ev.data : _parseDataBR(_extrairCampo(ev, ['DATA', 'data']));
            if (!dataEv || isNaN(dataEv.getTime())) return;
            if (dataEv.getFullYear() !== data.getFullYear() || dataEv.getMonth() !== data.getMonth() || dataEv.getDate() !== data.getDate()) return;

            const cidadeEv = _normTexto(ev.cidade || _extrairCampo(ev, ['CIDADE', 'cidade']) || '');
            if (cidadeEv !== cidadeNorm) return;

            const publicoRaw = ev.publico != null ? ev.publico : _extrairCampo(ev, ['ESTIMATIVA DE PÚBLICO', 'ESTIMATIVA DE PUBLICO', 'publico']);
            const publico = parseInt(publicoRaw, 10) || 0;
            const porte = _portePorPublico(publico);
            if (porte === 'grande' && coefGrande > maiorCoeficiente) maiorCoeficiente = coefGrande;
            else if (porte === 'medio' && coefMedio > maiorCoeficiente) maiorCoeficiente = coefMedio;
        });
        return maiorCoeficiente;
    }

    function preverComSazonalidade(serieMensal, opts) {
        opts = opts || {};
        const periodo = opts.periodoSazonal || 12;
        const passos = opts.passos || 1;

        if (!Array.isArray(serieMensal) || serieMensal.length < 2) return null;

        const indices = indicesSazonais(serieMensal, periodo);
        const serieBase = indices ? serieMensal.map((v, i) => v / (indices[i % periodo] || 1)) : serieMensal;
        const holt = suavizacaoExponencialDupla(serieBase, opts.alpha, opts.beta, passos);
        if (!holt) return null;

        const posicaoProximoMes = serieMensal.length % periodo;
        const previsoesBase = holt.previsoes.map((v, h) => {
            const idx = indices ? indices[(posicaoProximoMes + h) % periodo] : 1;
            return Math.max(0, v * idx);
        });

        // Impacto de eventos (opcional) — só entra em ação se opts.eventos
        // E opts.cidade forem passados juntos (sem cidade não há como
        // saber ONDE procurar o evento). Como esta função prevê TOTAIS
        // MENSAIS (não por dia), o coeficiente do dia do evento aplica
        // sobre o MÊS INTEIRO que contém aquele dia (usa o MAIOR
        // coeficiente entre todos os dias do mês previsto, caso haja mais
        // de 1 evento). Pra um número só do DIA do evento, chame
        // calcularImpactoEvento() direto sobre uma média diária
        // (previsaoMensal / dias-do-mês) — ver exemplo nos comentários
        // de integração em js/analisePreditiva.js.
        let coeficientesPorMes = null;
        if (Array.isArray(opts.eventos) && opts.eventos.length && opts.cidade) {
            const dataBase = (opts.dataBase instanceof Date && !isNaN(opts.dataBase.getTime())) ? opts.dataBase : new Date();
            coeficientesPorMes = previsoesBase.map((_, h) => {
                const mesAlvo = new Date(dataBase.getFullYear(), dataBase.getMonth() + h + 1, 1);
                const diasDoMes = new Date(mesAlvo.getFullYear(), mesAlvo.getMonth() + 1, 0).getDate();
                let maior = 1;
                for (let dia = 1; dia <= diasDoMes; dia++) {
                    const d = new Date(mesAlvo.getFullYear(), mesAlvo.getMonth(), dia);
                    const c = calcularImpactoEvento(d, opts.cidade, opts.eventos, opts);
                    if (c > maior) maior = c;
                }
                return maior;
            });
        }

        const previsoes = previsoesBase.map((v, h) => Math.round(v * (coeficientesPorMes ? coeficientesPorMes[h] : 1)));

        return {
            previsoes,
            sazonalidadeAtiva: !!indices,
            impactoEventosAtivo: !!coeficientesPorMes,
            coeficientesEventoPorMes: coeficientesPorMes,
            tendencia: holt.tendenciaFinal > 0.05 ? 'alta' : holt.tendenciaFinal < -0.05 ? 'queda' : 'estável',
            confianca: serieMensal.length >= periodo * 2 ? 'alta' : serieMensal.length >= periodo ? 'média' : 'baixa',
        };
    }

    // ────────────────────────────────────────────────────────────────
    // 2) DBSCAN LEVE — agrupamento geográfico por densidade real, em vez
    // de raio fixo. Diferença pro agrupamento atual (js/gerarcartao.js
    // usa grade de ~80m + fusão de sementes; js/opo-hotspot-core.js usa
    // raio incremental de ~800m): DBSCAN só forma um cluster onde há
    // DENSIDADE de verdade (pelo menos minPts ocorrências próximas),
    // então não infla um "hotspot" a partir de 2-3 pontos isolados que
    // só calharam de estar dentro do raio.
    //
    // Não substitui o agrupamento atual — é uma lente adicional: rode os
    // dois e compare. Usa uma grade espacial pra achar vizinhos (célula
    // = eps), então fica O(n) na prática em vez de O(n²) — mesmo raciocínio de
    // desempenho que RAIO_AGRUPAMENTO_GRAU já usa em gerarcartao.js.
    // ────────────────────────────────────────────────────────────────

    function metrosParaGraus(metros) { return metros / 111320; } // aproximação padrão (1° lat ≈ 111.32km)

    // pontos: array de { lat, lng, peso? } (peso opcional, default 1 —
    // já compatível com o formato de `ocorrencias` de opo-hotspot-core.js).
    // opts: { epsMetros=150, minPts=3 }.
    function dbscanLeve(pontos, opts) {
        opts = opts || {};
        const epsGraus = metrosParaGraus(opts.epsMetros || 150);
        const minPts = opts.minPts || 3;
        const n = pontos.length;
        if (!n) return { clusters: [], ruido: [] };

        const visitados = new Array(n).fill(false);
        const rotulo = new Array(n).fill(-1);

        const grade = new Map();
        const chaveCel = (lat, lng) => Math.floor(lat / epsGraus) + ':' + Math.floor(lng / epsGraus);
        pontos.forEach((p, i) => {
            const k = chaveCel(p.lat, p.lng);
            if (!grade.has(k)) grade.set(k, []);
            grade.get(k).push(i);
        });

        function vizinhos(i) {
            const p = pontos[i];
            const cLat = Math.floor(p.lat / epsGraus), cLng = Math.floor(p.lng / epsGraus);
            const out = [];
            for (let dLat = -1; dLat <= 1; dLat++) {
                for (let dLng = -1; dLng <= 1; dLng++) {
                    const lista = grade.get((cLat + dLat) + ':' + (cLng + dLng));
                    if (!lista) continue;
                    for (const j of lista) {
                        if (j === i) continue;
                        const dLatG = pontos[j].lat - p.lat, dLngG = pontos[j].lng - p.lng;
                        if (Math.sqrt(dLatG * dLatG + dLngG * dLngG) <= epsGraus) out.push(j);
                    }
                }
            }
            return out;
        }

        let proximoCluster = 0;
        for (let i = 0; i < n; i++) {
            if (visitados[i]) continue;
            visitados[i] = true;
            const viz = vizinhos(i);
            if (viz.length + 1 < minPts) continue; // fica -1 (ruído) por ora — pode ser "resgatado" abaixo se um core point vizinho o alcançar
            rotulo[i] = proximoCluster;
            const fila = viz.slice();
            while (fila.length) {
                const j = fila.shift();
                if (!visitados[j]) {
                    visitados[j] = true;
                    const vizJ = vizinhos(j);
                    if (vizJ.length + 1 >= minPts) fila.push(...vizJ);
                }
                if (rotulo[j] === -1) rotulo[j] = proximoCluster;
            }
            proximoCluster++;
        }

        const porCluster = new Map();
        const ruido = [];
        pontos.forEach((p, i) => {
            if (rotulo[i] === -1) { ruido.push(p); return; }
            if (!porCluster.has(rotulo[i])) porCluster.set(rotulo[i], []);
            porCluster.get(rotulo[i]).push(p);
        });
        const clusters = Array.from(porCluster.values()).map(membros => {
            const pesoTotal = membros.reduce((s, p) => s + (p.peso != null ? p.peso : 1), 0);
            const lat = membros.reduce((s, p) => s + p.lat * (p.peso != null ? p.peso : 1), 0) / pesoTotal;
            const lng = membros.reduce((s, p) => s + p.lng * (p.peso != null ? p.peso : 1), 0) / pesoTotal;
            return { lat, lng, pontos: membros, pesoTotal, densidade: membros.length };
        }).sort((a, b) => b.pesoTotal - a.pesoTotal);

        return { clusters, ruido };
    }

    // ────────────────────────────────────────────────────────────────
    // 3) CALIBRAÇÃO DINÂMICA DE PESOS — Regressão Logística treinada do
    // zero (gradiente descendente batch, sem biblioteca) sobre o
    // histórico real de reincidência.
    //
    // COMO O "APRENDIZADO" ACONTECE, passo a passo:
    //   a) Cada ocorrência com coordenada válida vira 1 EXEMPLO de
    //      treino: as FEATURES são quantas ocorrências graves aconteceram
    //      no mesmo local (~80m, mesma célula de gerarcartao.js) nos 30 e
    //      nos 90 dias ANTES dela, mais a época do ano (seno/cosseno do
    //      mês, pra capturar sazonalidade sem precisar de 1 coluna por mês).
    //   b) O RÓTULO (o que o modelo aprende a prever) é 1 se uma NOVA
    //      ocorrência GRAVE (CVLI) aconteceu no mesmo local nos 30 dias
    //      SEGUINTES, e 0 se não aconteceu.
    //   c) A regressão logística ajusta pesos internos pra cada feature,
    //      por 300 rodadas de gradiente descendente, minimizando o erro
    //      entre a probabilidade prevista e o rótulo real.
    //   d) A probabilidade MÉDIA prevista por CATEGORIA (cvli/cvp/droga/
    //      etc.) vira um multiplicador do peso ESTÁTICO já definido pelo
    //      comando (PESOS em gerarcartao.js) — nunca um peso do zero.
    //
    // TRAVA DE SEGURANÇA: o multiplicador fica sempre entre 0.5x e 1.5x
    // do peso original (FATOR_MIN/FATOR_MAX) — a IA nunca decide sozinha
    // que uma categoria "não importa mais" ou "é o dobro da prioridade";
    // ela só ajusta a intensidade dentro de uma faixa auditável, com base
    // em quão reincidentes os locais realmente foram. Se não houver
    // histórico suficiente (mínimo 30 exemplos, com pelo menos 1 caso de
    // cada rótulo — sem isso não há o que "aprender"), devolve os pesos
    // ESTÁTICOS originais sem fingir uma calibração sem sustentação.
    // ────────────────────────────────────────────────────────────────

    function sigmoide(z) { return 1 / (1 + Math.exp(-z)); }

    // Regularização L2 (Ridge) — opts.lambda (padrão 0.05, ajustável por
    // quem chama). Sem isso, bairros com POUCOS exemplos (ex.: só 2-3
    // ocorrências numa célula/local) deixam os pesos crescerem sem
    // freio pra "decorar" esses poucos pontos (overfitting), inflando a
    // probabilidade prevista pra qualquer coisa parecida no futuro. O
    // termo de penalização (lambda/n)*peso empurra os pesos de volta pra
    // perto de zero a cada rodada, proporcional ao próprio tamanho do
    // peso — quanto maior lambda, mais o modelo prioriza generalizar em
    // vez de ajustar exatamente ao histórico pequeno. O viés (intercepto)
    // NUNCA é regularizado — é convenção padrão em regressão logística
    // (só os pesos das features "puxam" a decisão por variável, o viés é
    // só o patamar de base).
    function treinarRegressaoLogistica(exemplos, opts) {
        opts = opts || {};
        const taxaAprendizado = opts.taxaAprendizado || 0.1;
        const iteracoes = opts.iteracoes || 300;
        const lambda = opts.lambda != null ? opts.lambda : 0.05;
        const nFeatures = exemplos[0].features.length;
        const n = exemplos.length;

        let pesos = new Array(nFeatures).fill(0);
        let vies = 0;
        for (let it = 0; it < iteracoes; it++) {
            const gradPesos = new Array(nFeatures).fill(0);
            let gradVies = 0;
            for (const ex of exemplos) {
                let z = vies;
                for (let k = 0; k < nFeatures; k++) z += pesos[k] * ex.features[k];
                const erro = sigmoide(z) - ex.rotulo;
                for (let k = 0; k < nFeatures; k++) gradPesos[k] += erro * ex.features[k];
                gradVies += erro;
            }
            for (let k = 0; k < nFeatures; k++) {
                const gradienteMedio = gradPesos[k] / n + (lambda / n) * pesos[k];
                pesos[k] -= taxaAprendizado * gradienteMedio;
            }
            vies -= taxaAprendizado * gradVies / n;
        }

        return {
            pesos, vies, lambda,
            prever: function (features) {
                let z = vies;
                for (let k = 0; k < features.length; k++) z += pesos[k] * features[k];
                return sigmoide(z);
            },
        };
    }

    // Mesma escala de célula geográfica de RAIO_AGRUPAMENTO_GRAU em
    // gerarcartao.js (~80m) — mantém a granularidade espacial já
    // validada operacionalmente, só adiciona a camada de calibração.
    const CELULA_GRAU_RECIDIVA = 0.0008;
    function chaveCelulaRecidiva(lat, lng) {
        return Math.round(lat / CELULA_GRAU_RECIDIVA) + ':' + Math.round(lng / CELULA_GRAU_RECIDIVA);
    }

    // ocorrencias: array de { lat, lng, data: Date, tipo: 'cvli'|'cvp'|...,
    // grave: bool } — já filtradas por filtrarCoordenadasValidas().
    function montarDatasetReincidencia(ocorrencias, opts) {
        opts = opts || {};
        const janelaDias = opts.janelaDias || 30;
        const MS_DIA = 86400000;

        const porCelula = new Map();
        ocorrencias.forEach(o => {
            if (!(o.data instanceof Date) || isNaN(o.data.getTime())) return;
            const k = chaveCelulaRecidiva(o.lat, o.lng);
            if (!porCelula.has(k)) porCelula.set(k, []);
            porCelula.get(k).push(o);
        });

        const exemplos = [];
        porCelula.forEach(lista => {
            lista.sort((a, b) => a.data - b.data);
            lista.forEach(o => {
                const t = o.data.getTime();
                const cont30 = lista.filter(x => x.data.getTime() < t && x.data.getTime() >= t - 30 * MS_DIA).length;
                const cont90 = lista.filter(x => x.data.getTime() < t && x.data.getTime() >= t - 90 * MS_DIA).length;
                const mes = o.data.getMonth();
                const rotulo = lista.some(x => x.grave && x.data.getTime() > t && x.data.getTime() <= t + janelaDias * MS_DIA) ? 1 : 0;
                exemplos.push({
                    features: [cont30, cont90, Math.sin(2 * Math.PI * mes / 12), Math.cos(2 * Math.PI * mes / 12)],
                    rotulo,
                    tipo: o.tipo || 'geral',
                });
            });
        });
        return exemplos;
    }

    // pesosBase: objeto { categoria: pesoNumerico } (ex.: PESOS de
    // gerarcartao.js). Retorna { pesos, calibrado, motivo?, amostras? }.
    function calibrarPesos(ocorrencias, pesosBase, opts) {
        opts = opts || {};
        const minimoExemplos = opts.minimoExemplos || 30;
        const FATOR_MIN = opts.fatorMin || 0.5;
        const FATOR_MAX = opts.fatorMax || 1.5;

        const exemplos = montarDatasetReincidencia(ocorrencias, opts);
        const temClasse1 = exemplos.some(e => e.rotulo === 1);
        const temClasse0 = exemplos.some(e => e.rotulo === 0);

        if (exemplos.length < minimoExemplos || !temClasse1 || !temClasse0) {
            return {
                pesos: Object.assign({}, pesosBase),
                calibrado: false,
                motivo: `histórico insuficiente pra calibrar com segurança (${exemplos.length} exemplo(s), mínimo ${minimoExemplos} com as duas classes representadas) — usando pesos padrão`,
            };
        }

        const modelo = treinarRegressaoLogistica(exemplos, opts);
        const somaPorTipo = {}, contPorTipo = {};
        exemplos.forEach(ex => {
            const p = modelo.prever(ex.features);
            somaPorTipo[ex.tipo] = (somaPorTipo[ex.tipo] || 0) + p;
            contPorTipo[ex.tipo] = (contPorTipo[ex.tipo] || 0) + 1;
        });
        const probPorCategoria = {};
        Object.keys(pesosBase).forEach(cat => {
            probPorCategoria[cat] = contPorTipo[cat] ? somaPorTipo[cat] / contPorTipo[cat] : null; // null = categoria sem exemplo no histórico
        });

        // Normaliza de forma RELATIVA entre as categorias que TÊM exemplo —
        // o que importa aqui é qual categoria reincide MAIS QUE AS OUTRAS
        // nesta unidade, não a probabilidade absoluta (que numa grade fina
        // de ~80m/30 dias costuma ser baixa pra qualquer categoria).
        // Ancorar no valor absoluto empurrava TUDO pra perto do piso
        // (0.5x) quase igualmente sempre que a reincidência real girava
        // em torno de poucos % — confirmado com dados reais do 10º BPM
        // (7176 amostras, prob. média 1.7%-3.4% em todas as categorias)
        // antes desta correção: a calibração "funcionava" mas não
        // diferenciava nada de fato entre categorias.
        const probsValidas = Object.values(probPorCategoria).filter(v => v != null);
        const probMin = Math.min(...probsValidas);
        const probMax = Math.max(...probsValidas);
        const amplitude = probMax - probMin;

        const pesosCalibrados = {};
        Object.keys(pesosBase).forEach(cat => {
            const prob = probPorCategoria[cat];
            const probNormalizada = prob == null ? 0.5 // sem exemplo dessa categoria -> fator neutro (1x)
                : amplitude > 0 ? (prob - probMin) / amplitude
                : 0.5; // todas as categorias empataram -> sem base pra diferenciar, fica neutro
            const fator = FATOR_MIN + probNormalizada * (FATOR_MAX - FATOR_MIN);
            pesosCalibrados[cat] = Math.round(pesosBase[cat] * fator * 100) / 100;
        });

        return {
            pesos: pesosCalibrados,
            calibrado: true,
            amostras: exemplos.length,
            probabilidadeMediaPorCategoria: Object.keys(probPorCategoria).reduce((acc, cat) => {
                if (probPorCategoria[cat] != null) acc[cat] = Math.round(probPorCategoria[cat] * 1000) / 1000;
                return acc;
            }, {}),
        };
    }

    // ────────────────────────────────────────────────────────────────
    // 3b) PREVISÃO DE RISCO POR LOCAL — "em qual CIDADE e BAIRRO é mais
    // provável ter um CVLI/MVI nos PRÓXIMOS DIAS" (janela curta, dias —
    // diferente de calibrarPesos, que olha reincidência em até 30 dias
    // pra calibrar peso de categoria, não pra apontar um local
    // específico). Mesma técnica (regressão logística treinada do zero),
    // mas agrupando por CIDADE+BAIRRO em texto, não por célula de GPS —
    // bate com o jeito que js/analisePreditiva.js já trabalha (CIDADE/
    // BAIRRO, sem coordenada — ver relatório de investigação desta
    // sessão: esse arquivo NÃO usa LATITUDE/LONGITUDE).
    //
    // COMO O "APRENDIZADO" ACONTECE: cada ocorrência de qualquer
    // categoria (grave ou não) num local vira 1 exemplo de treino — as
    // FEATURES são quantas ocorrências aconteceram nesse MESMO
    // CIDADE+BAIRRO nos 7/30/90 dias ANTES dela (incluindo quantas eram
    // graves nos últimos 90), mais o dia da semana (seno/cosseno, pra
    // capturar padrão tipo "mais risco no fim de semana"). O RÓTULO é 1
    // se um CVLI/MVI aconteceu no MESMO local nos `janelaDias` (padrão
    // 7) SEGUINTES. Depois de treinado, o modelo é aplicado ao estado
    // ATUAL de cada local (contagens até HOJE) pra estimar a
    // probabilidade de cada um pros próximos dias — os locais viram um
    // RANKING, do mais provável pro menos.
    //
    // TRAVA: exige histórico mínimo (padrão 30 exemplos com as duas
    // classes) — sem isso devolve ranking vazio com o motivo, nunca
    // inventa um "local mais provável" sem sustentação estatística.
    // ────────────────────────────────────────────────────────────────

    function chaveLocalidade(cidade, bairro) {
        return _normTexto(cidade || 'N/D') + '||' + _normTexto(bairro || 'N/D');
    }

    // ocorrencias: array de { cidade, bairro, data:Date, grave:bool } —
    // grave=true é o que queremos prever (CVLI/MVI); grave=false só
    // alimenta as features de contexto (ex.: CVP como indício de
    // atividade na área). Retorna { exemplos, porLocal } — porLocal é um
    // Map chave->{cidade,bairro,itens} reaproveitado por
    // preverRiscoPorLocal pra calcular o estado ATUAL de cada local.
    function montarDatasetPorLocalidade(ocorrencias, opts) {
        opts = opts || {};
        const janelaDias = opts.janelaDias || 7;
        const MS_DIA = 86400000;

        const porLocal = new Map();
        ocorrencias.forEach(o => {
            if (!(o.data instanceof Date) || isNaN(o.data.getTime())) return;
            const k = chaveLocalidade(o.cidade, o.bairro);
            if (!porLocal.has(k)) porLocal.set(k, { cidade: o.cidade || 'N/D', bairro: o.bairro || 'N/D', itens: [] });
            porLocal.get(k).itens.push(o);
        });

        const exemplos = [];
        porLocal.forEach((info, k) => {
            info.itens.sort((a, b) => a.data - b.data);
            info.itens.forEach(o => {
                const t = o.data.getTime();
                const cont7  = info.itens.filter(x => x.data.getTime() < t && x.data.getTime() >= t - 7  * MS_DIA).length;
                const cont30 = info.itens.filter(x => x.data.getTime() < t && x.data.getTime() >= t - 30 * MS_DIA).length;
                const cont90 = info.itens.filter(x => x.data.getTime() < t && x.data.getTime() >= t - 90 * MS_DIA).length;
                const graves90 = info.itens.filter(x => x.grave && x.data.getTime() < t && x.data.getTime() >= t - 90 * MS_DIA).length;
                const diaSemana = o.data.getDay();
                const rotulo = info.itens.some(x => x.grave && x.data.getTime() > t && x.data.getTime() <= t + janelaDias * MS_DIA) ? 1 : 0;
                exemplos.push({
                    features: [cont7, cont30, cont90, graves90, Math.sin(2 * Math.PI * diaSemana / 7), Math.cos(2 * Math.PI * diaSemana / 7)],
                    rotulo,
                    chave: k,
                });
            });
        });
        return { exemplos, porLocal };
    }

    // ocorrencias: mesmo formato de montarDatasetPorLocalidade. opts:
    // { janelaDias=7, minimoExemplos=30, topN=5, dataReferencia=hoje }.
    // Retorna { ranking:[{cidade,bairro,probabilidade,ocorrenciasRecentes}],
    // calibrado, amostras, motivo? }.
    function preverRiscoPorLocal(ocorrencias, opts) {
        opts = opts || {};
        const janelaDias = opts.janelaDias || 7;
        const minimoExemplos = opts.minimoExemplos || 30;
        const topN = opts.topN || 5;
        const MS_DIA = 86400000;

        const { exemplos, porLocal } = montarDatasetPorLocalidade(ocorrencias, { janelaDias });
        const temClasse1 = exemplos.some(e => e.rotulo === 1);
        const temClasse0 = exemplos.some(e => e.rotulo === 0);

        if (exemplos.length < minimoExemplos || !temClasse1 || !temClasse0) {
            return {
                ranking: [],
                calibrado: false,
                motivo: `histórico insuficiente pra prever risco por local (${exemplos.length} exemplo(s), mínimo ${minimoExemplos} com as duas classes representadas)`,
            };
        }

        const modelo = treinarRegressaoLogistica(exemplos, opts);
        const agora = (opts.dataReferencia instanceof Date && !isNaN(opts.dataReferencia.getTime())) ? opts.dataReferencia : new Date();
        const t = agora.getTime();

        const ranking = [];
        porLocal.forEach((info, k) => {
            const cont7  = info.itens.filter(x => x.data.getTime() < t && x.data.getTime() >= t - 7  * MS_DIA).length;
            const cont30 = info.itens.filter(x => x.data.getTime() < t && x.data.getTime() >= t - 30 * MS_DIA).length;
            const cont90 = info.itens.filter(x => x.data.getTime() < t && x.data.getTime() >= t - 90 * MS_DIA).length;
            const graves90 = info.itens.filter(x => x.grave && x.data.getTime() < t && x.data.getTime() >= t - 90 * MS_DIA).length;
            const diaSemana = agora.getDay();
            const prob = modelo.prever([cont7, cont30, cont90, graves90, Math.sin(2 * Math.PI * diaSemana / 7), Math.cos(2 * Math.PI * diaSemana / 7)]);
            ranking.push({
                cidade: info.cidade,
                bairro: info.bairro,
                probabilidade: Math.round(prob * 1000) / 1000,
                ocorrenciasRecentes30d: cont30,
            });
        });
        ranking.sort((a, b) => b.probabilidade - a.probabilidade);

        return {
            ranking: ranking.slice(0, topN),
            calibrado: true,
            amostras: exemplos.length,
            janelaDias,
        };
    }

    // ────────────────────────────────────────────────────────────────
    // 4) HEATMAP PONDERADO — js/mapa-Dashboard-P3.js (carregado por
    // page/dashboard-mapa.html — o arquivo js/dashboard-mapa.js também
    // existe no repositório mas não está referenciado em nenhuma página,
    // não é o que roda de verdade) hoje monta 1 heat layer POR CATEGORIA
    // (CVP, CVLI...), cada uma com intensidade FIXA 1.0 pra toda
    // ocorrência daquela camada (`pontos.map(p => [p.lat,p.lng,1.0])`,
    // função construirCamadas()). Com os pesos calibrados, dá pra
    // diferenciar intensidade DENTRO da mesma categoria (ex.: destacar
    // dentro do próprio heat de CVLI os pontos com maior probabilidade
    // de reincidência), não só por cor entre categorias.
    // ────────────────────────────────────────────────────────────────

    // ocorrencias: array com { lat, lng, tipo }. pesosPorTipo: objeto
    // { categoria: peso }. Normaliza pra faixa 0-1 (Leaflet.heat espera
    // intensidade nessa faixa).
    function pontosParaHeatmapPonderado(ocorrencias, pesosPorTipo) {
        const pesos = pesosPorTipo || {};
        const valores = ocorrencias.map(o => (pesos[o.tipo] != null ? pesos[o.tipo] : 1));
        const maxPeso = Math.max(1, ...valores);
        return ocorrencias.map((o, i) => [o.lat, o.lng, Math.min(1, valores[i] / maxPeso)]);
    }

    global.MLLeve = {
        // coordenadas
        filtrarCoordenadasValidas,
        // previsão de série temporal
        suavizacaoExponencialDupla,
        indicesSazonais,
        preverComSazonalidade,
        calcularImpactoEvento,
        // clustering geográfico
        dbscanLeve,
        // calibração de pesos
        treinarRegressaoLogistica,
        montarDatasetReincidencia,
        calibrarPesos,
        // previsão de risco por local (cidade+bairro)
        montarDatasetPorLocalidade,
        preverRiscoPorLocal,
        // heatmap
        pontosParaHeatmapPonderado,
    };
})(window);
