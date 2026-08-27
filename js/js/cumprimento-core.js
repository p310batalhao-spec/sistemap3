// ════════════════════════════════════════════════════════════════════
// CUMPRIMENTO CORE — cruza cartão-programa/OPO salvos com o rastreamento
// GPS real das viaturas (Firebase de frota, sistema de AVL do 10º BPM) pra
// calcular % de cumprimento e % de falha de cada bloco do cronograma.
//
// Núcleo puro (sem DOM) reaproveitado por 3 lugares: a página de análise
// (page/cumprimento-cartao.html), a página de rastreamento
// (page/rastreamento-guarnicao.html) e o Xerife (js/xerife.js) — mesma
// filosofia de js/opo-hotspot-core.js: uma lógica só, vários consumidores.
//
// FROTA_DATABASE_URL é fixo (só 10º BPM) por decisão explícita do usuário
// — diferente do resto do sistema, que é multi-tenant via
// P3.loadUnidadeConfig(). Só LEITURA nesse Firebase de frota; tudo que
// este módulo GRAVA (cartões salvos, mapeamento cidade↔viatura) vai pro
// Firebase da própria unidade logada.
// ════════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    if (window.CumprimentoCore) return;

    const FROTA_DATABASE_URL = 'https://frota10bpm-dc14a-default-rtdb.firebaseio.com';

    // Mesma tabela de centros de cidade de js/opo-hotspot-core.js (CIDADES_GEO),
    // duplicada de propósito: páginas como cartaoprograma.html não precisam
    // carregar o módulo inteiro de hotspot/OPO só pra saber o centro de uma
    // cidade. Se uma cidade for adicionada lá, adicionar aqui também.
    const CIDADES_GEO_NORM = {
        'PALMEIRA DOS INDIOS': { lat: -9.4092, lng: -36.6289 },
        'BELEM': { lat: -9.5722, lng: -36.6169 },
        'CACIMBINHAS': { lat: -9.3872, lng: -37.0064 },
        'ESTRELA DE ALAGOAS': { lat: -9.5433, lng: -36.5167 },
        'IGACI': { lat: -9.5361, lng: -36.6467 },
        'MAR VERMELHO': { lat: -9.4200, lng: -36.5283 },
        'MARIBONDO': { lat: -9.5600, lng: -36.3278 },
        'MINADOR DO NEGRAO': { lat: -9.3453, lng: -36.8628 },
        'PAULO JACINTO': { lat: -9.5267, lng: -36.4100 },
        'QUEBRANGULO': { lat: -9.3167, lng: -36.4736 },
        "TANQUE D'ARCA": { lat: -9.6522, lng: -36.6181 },
        'TANQUE D ARCA': { lat: -9.6522, lng: -36.6181 },
    };
    const GEO_10BPM = { lat: -9.4500, lng: -36.6200 };

    // Mapeamento FIXO cidade(RP do cartão)↔guarnição — confirmado pelo 1º
    // Tenente Calheiros (não é mais palpite). Duas cidades podem apontar
    // pra mesma guarnição (ex.: BELÉM e TANQUE D'ARCA são as duas RP 04) —
    // ainda editável na tela de Cumprimento se algo mudar no futuro, mas
    // esse é o valor correto de partida/reset.
    const SEED_RP_VIATURA = {
        'PALMEIRA DOS ÍNDIOS (RP 01)': 'RP 01',
        'PALMEIRA DOS ÍNDIOS (RP 02)': 'RP 02',
        'MARIBONDO (RP)': 'RP 03',
        'BELÉM (RP)': 'RP 04',
        "TANQUE D'ARCA (RP)": 'RP 04',
        'QUEBRANGULO (RP)': 'RP 05',
        'PAULO JACINTO (RP)': 'RP 06',
        'MAR VERMELHO (RP)': 'RP 06',
        'IGACI (RP)': 'RP 07',
        'ESTRELA DE ALAGOAS (RP)': 'RP 08',
        'MINADOR DO NEGRÃO (RP)': 'RP 08',
        'CACIMBINHAS (RP)': 'RP 09',
    };

    function normalizarStr(s) {
        return (s || '').toString().toUpperCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '');
    }

    // A fonte externa da planilha (portal GEO/SEDS-AL, fora do nosso
    // controle) não é 100% consistente no nome da guarnição — já vimos
    // "RP01", "RP 01" e "Rp 08 Estrela Minador" (nome descritivo colado)
    // pro mesmo tipo de unidade. Pra comparar contra o mapeamento fixo
    // (rp_viatura_map, sempre no formato "RP 0X"), extrai só o prefixo
    // RP+número quando existir — senão cai pra normalizarStr() normal
    // (cobre guarnições sem numeração, tipo "RURAL 01", "FT 02").
    function normalizarGuarnicao(s) {
        const norm = normalizarStr(s);
        const m = norm.match(/^RP\s*0*(\d+)/);
        if (m) return 'RP' + m[1].padStart(2, '0');
        return norm.replace(/\s+/g, ' ');
    }

    function haversineKm(lat1, lng1, lat2, lng2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // "det" de uma linha do cronograma é tipo "CENTRO | VILA NOVA  (GRAV.62%
    // — 14 ocorr. c/ hora (90 dias))" — os bairros ficam antes do primeiro
    // parêntese, separados por " | " (ver js/gerarcartao.js montarLinha()).
    function extrairBairros(det) {
        if (!det) return [];
        return det.split('(')[0].split('|').map(s => s.trim().toUpperCase()).filter(Boolean);
    }

    // Blocos puramente administrativos (sem local de patrulhamento real) —
    // não entram no cálculo de cumprimento nem tentam resolver um
    // perímetro. Cobre as variações REAIS usadas nos templates de RP
    // (js/gerarcartao.js) — descoberto cruzando cartões salvos com as
    // ocorrências reais: "BASE OPERACIONAL" às vezes vem com PONTO FINAL
    // ("BASE OPERACIONAL.", em vários templates de RP) e não batia com o
    // texto exato esperado aqui — esses blocos estavam contando pro
    // cumprimento (deveriam ser ignorados, igual almoço/janta sem ponto) e
    // tentando (e falhando) achar um perímetro sem sentido.
    const ROTULOS_ADMINISTRATIVOS = [
        'BASE OPERACIONAL',
        'APRESENTACAO E PRELECAO',
        'MANUTENCAO DE VIATURA E RENDICAO',
    ];
    function ehBlocoAdministrativo(det) {
        const bairros = extrairBairros(det);
        if (bairros.length !== 1) return false;
        const rotulo = normalizarStr(bairros[0]).replace(/\.+$/, ''); // tira ponto final
        return ROTULOS_ADMINISTRATIVOS.includes(rotulo);
    }

    // Nome de instituição (escola, posto etc.) usado como `det` em blocos
    // tipo "OPO - POLICIAMENTO ESCOLAR" — não é bairro (não vai bater por
    // texto) nem deve cair no agrupamento por coordenada da cidade inteira
    // (acharia o hotspot criminal mais próximo, que não tem nada a ver com
    // ONDE fica a escola — pior que impreciso, é confiantemente errado).
    // Nesses casos é mais honesto cair direto pro centro da cidade
    // (fallback já claramente rotulado como impreciso) do que fingir
    // precisão com um cluster errado.
    const PALAVRAS_INSTITUICAO = ['ESCOLA', 'COLEGIO', 'UNIDADE', 'HOSPITAL', 'POSTO', 'IGREJA', 'CEMITERIO', 'CRECHE'];
    function pareceInstituicaoNomeada(texto) {
        const n = normalizarStr(texto);
        return PALAVRAS_INSTITUICAO.some(p => n.includes(p));
    }

    function coordDaOcorrencia(oc) {
        const lat = parseFloat(String(oc.LATITUDE || oc.latitude || oc.lat || '').replace(',', '.').trim());
        const lng = parseFloat(String(oc.LONGITUDE || oc.longitude || oc.lng || '').replace(',', '.').trim());
        if (isNaN(lat) || isNaN(lng) || lat < -11.0 || lat > -7.0 || lng < -38.5 || lng > -34.5) return null;
        return { lat, lng };
    }

    // Raio data-driven: com poucos/nenhum ponto, cai pro padrão (raioKmPerimetro
    // do usuário, ou 1km); com pontos reais, usa a maior distância ao centro
    // (+25% de folga) — reflete a dispersão REAL da área, em vez de um raio
    // fixo que tanto pode sobrar (bairro pequeno) quanto faltar (bairro
    // grande/alongado, que antes dava 100% de falha mesmo com patrulhamento
    // real).
    function raioDoConjunto(pontos, lat, lng, raioKmPerimetro) {
        const temPerimetro = typeof raioKmPerimetro === 'number' && raioKmPerimetro > 0;
        if (temPerimetro) return raioKmPerimetro;
        if (!pontos.length) return 1;
        const maiorDist = pontos.reduce((m, p) => Math.max(m, haversineKm(lat, lng, p.lat, p.lng)), 0);
        return Math.min(3, Math.max(0.6, +(maiorDist * 1.25).toFixed(2)));
    }

    // Resolve o centro geográfico aproximado de um bloco do cartão (ou de uma
    // alocação de OPO, sem bloco) cruzando DUAS fontes, não só o nome do
    // bairro: (1) ocorrências cujo BAIRRO bate com os bairros do bloco — como
    // antes — só que agora TAMBÉM absorve ocorrências vizinhas por
    // COORDENADA (mesmo sem bater o texto do bairro — cobre grafia
    // diferente/sem acento/abreviada, mas geograficamente ali); (2) se
    // nenhuma ocorrência bater por texto, agrupa TODAS as ocorrências
    // georreferenciadas da cidade por proximidade de coordenada (mesmo
    // critério de identificarHotspots em js/opo-hotspot-core.js, raio
    // ~800m) e usa o maior agrupamento — bem mais preciso que o centro da
    // cidade inteira. Só sem nenhuma ocorrência com coordenada válida na
    // cidade é que cai pro centro fixo da cidade (último recurso).
    //
    // raioKmPerimetro (opcional): sobrescreve o raio automático — vem do
    // campo "Perímetro" que o usuário define ao gerar/salvar o
    // cartão-programa (ver relatorios/cartaoprograma.html).
    //
    // `cidade` aceita string OU array de strings — RPs com mais de uma
    // cidade sob responsabilidade (Mar Vermelho/Paulo Jacinto, Belém/
    // Tanque D'Arca, Minador/Estrela — ver MAPA_RP_CIDADES em
    // js/gerarcartao.js) analisam a mancha criminal cruzando AS DUAS
    // cidades, então o bairro escolhido pode fisicamente pertencer à
    // cidade "secundária" do cartão — buscar só na cidade principal
    // (como era antes) fazia esse caso falhar o match sempre. Passar
    // `cidadesPatrulhadas` (o array completo) em vez de só `cidade`
    // corrige isso.
    function resolverAreaBairro(det, cidade, ocorrenciasFlat, raioKmPerimetro) {
        const bairros = extrairBairros(det);
        const cidadesNorm = (Array.isArray(cidade) ? cidade : [cidade]).map(normalizarStr).filter(Boolean);
        const temPerimetro = typeof raioKmPerimetro === 'number' && raioKmPerimetro > 0;

        const daCidade = (ocorrenciasFlat || [])
            .filter(oc => !cidadesNorm.length || cidadesNorm.includes(normalizarStr(oc.CIDADE || oc.cidade)))
            .map(oc => {
                const c = coordDaOcorrencia(oc);
                return c ? { lat: c.lat, lng: c.lng, bairro: normalizarStr(oc.BAIRRO || oc.bairro) } : null;
            })
            .filter(Boolean);

        const ehInstituicao = bairros.length === 1 && pareceInstituicaoNomeada(bairros[0]);

        if (bairros.length && !ehBlocoAdministrativo(det)) {
            const bairrosNorm = bairros.map(normalizarStr);
            let pontos = daCidade.filter(p => bairrosNorm.includes(p.bairro));

            if (pontos.length) {
                const latBase = pontos.reduce((s, p) => s + p.lat, 0) / pontos.length;
                const lngBase = pontos.reduce((s, p) => s + p.lng, 0) / pontos.length;
                const raioBase = Math.max(raioDoConjunto(pontos, latBase, lngBase, raioKmPerimetro), 1.5);
                // Absorve vizinhos por coordenada (não só texto de bairro) —
                // ver comentário da função acima.
                const vizinhos = daCidade.filter(p => !pontos.includes(p) && haversineKm(latBase, lngBase, p.lat, p.lng) <= raioBase);
                pontos = pontos.concat(vizinhos);

                const lat = pontos.reduce((s, p) => s + p.lat, 0) / pontos.length;
                const lng = pontos.reduce((s, p) => s + p.lng, 0) / pontos.length;
                return { lat, lng, raioKm: raioDoConjunto(pontos, lat, lng, raioKmPerimetro), origem: 'ocorrencias' };
            }
        }

        // Sem match por bairro (texto ausente/divergente ou bloco sem
        // bairro, caso das alocações de OPO) — agrupa por coordenada em vez
        // de já cair pro centro da cidade inteira. EXCETO pra nome de
        // instituição (ver ehInstituicao acima): aí o cluster mais denso da
        // cidade não tem relação nenhuma com onde a instituição realmente
        // fica — cai direto pro centro da cidade, que pelo menos é honesto
        // sobre ser impreciso (em vez de parecer preciso e estar errado).
        if (daCidade.length && !ehInstituicao) {
            const raioAgrupGraus = 0.008; // ~800m — mesmo valor de identificarHotspots (opo-hotspot-core.js)
            const grupos = [];
            daCidade.forEach(p => {
                const g = grupos.find(g => Math.sqrt((g.lat - p.lat) ** 2 + (g.lng - p.lng) ** 2) < raioAgrupGraus);
                if (g) {
                    g.pontos.push(p);
                    g.lat = g.pontos.reduce((s, q) => s + q.lat, 0) / g.pontos.length;
                    g.lng = g.pontos.reduce((s, q) => s + q.lng, 0) / g.pontos.length;
                } else {
                    grupos.push({ lat: p.lat, lng: p.lng, pontos: [p] });
                }
            });
            grupos.sort((a, b) => b.pontos.length - a.pontos.length);
            const maior = grupos[0];
            if (maior && maior.pontos.length >= 2) {
                return { lat: maior.lat, lng: maior.lng, raioKm: raioDoConjunto(maior.pontos, maior.lat, maior.lng, raioKmPerimetro), origem: 'coordenadas' };
            }
        }

        const centro = CIDADES_GEO_NORM[cidadesNorm[0]] || GEO_10BPM;
        return { lat: centro.lat, lng: centro.lng, raioKm: temPerimetro ? raioKmPerimetro : 1, origem: 'centro-cidade' };
    }

    // ── Rastreamento (Firebase de frota, só leitura) ─────────────────
    async function obterViaturasAtivas() {
        const res = await fetch(`${FROTA_DATABASE_URL}/rastreamento.json`);
        const dados = res.ok ? await res.json() : {};
        const porNome = {};
        Object.entries(dados || {}).forEach(([idRadio, v]) => {
            if (v && v.nome) porNome[normalizarGuarnicao(v.nome)] = Object.assign({ idRadio }, v);
        });
        return porNome;
    }

    function parseDataHoraBR(str) {
        // "29/07/2026 12:23" -> Date local (o rastreamento não informa fuso;
        // trata como horário local do PM, mesmo critério do resto do sistema).
        const m = (str || '').match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
        if (!m) return null;
        return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], 0);
    }

    // Busca o histórico do dia do cartão E do dia seguinte (concatenados),
    // pra cobrir blocos que atravessam a meia-noite (ex.: 19:00–00:00,
    // 00:00–03:00) sem duplicar/perder pontos.
    async function buscarHistoricoViatura(idRadio, dataISO) {
        const dia1 = dataISO.slice(0, 10);
        const d2 = new Date(dia1 + 'T00:00:00');
        d2.setDate(d2.getDate() + 1);
        const dia2 = d2.toISOString().slice(0, 10);

        const res = await fetch(`${FROTA_DATABASE_URL}/rastreamento_historico/${idRadio}.json`);
        const dados = res.ok ? await res.json() : {};
        const pontos = [];
        Object.entries(dados || {}).forEach(([chave, v]) => {
            if (!v || typeof v.lat !== 'number' || typeof v.lng !== 'number') return;
            if (!chave.startsWith(dia1) && !chave.startsWith(dia2)) return;
            const dt = parseDataHoraBR(v.dataHora);
            if (!dt) return;
            pontos.push({ dt, lat: v.lat, lng: v.lng });
        });
        pontos.sort((a, b) => a.dt - b.dt);
        return pontos;
    }

    function converterDataBRparaISO(dataBR) {
        const m = (dataBR || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
        // Fallback usa data LOCAL, não .toISOString() (UTC) — em UTC-3, depois
        // das 21h no horário local isso já devolveria o dia seguinte.
        if (!m) {
            const hoje = new Date();
            return hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0') + '-' + String(hoje.getDate()).padStart(2, '0');
        }
        return `${m[3]}-${m[2]}-${m[1]}`;
    }

    // ── Validade do cartão/OPO (1 mês a partir de quando foi salvo) ──────
    // Pedido explícito: cada cartão/OPO fica "válido" por 1 mês, ou até um
    // novo ser salvo pra mesma RP/cidade (isso já acontece naturalmente —
    // toda tela pega o cartão mais recente por RP). Grava `validoAte` no
    // momento do save (ver salvarCartaoAtual() em js/gerarcartao.js e
    // salvarOpoAtual() em page/opo_inteligente.html).
    function calcularValidoAte(criadoEmISO) {
        const d = criadoEmISO ? new Date(criadoEmISO) : new Date();
        d.setMonth(d.getMonth() + 1);
        return d.toISOString();
    }
    // Cartões salvos ANTES dessa mudança não têm `validoAte` — tratados
    // como válidos (não quebra o que já existia), só os novos passam a
    // expirar de fato.
    function ehCartaoValido(cartao, agora) {
        if (!cartao || !cartao.validoAte) return true;
        return (agora || new Date()) <= new Date(cartao.validoAte);
    }

    // ── Mapeamento cidade/RP ↔ guarnição — leitura/escrita CENTRALIZADA ──
    // Antes cada página (gerarcartao.js, opo_inteligente.html) tinha sua
    // própria cópia dessa função — centralizado aqui pra garantir que
    // TODAS as telas (salvar cartão, salvar OPO, cumprimento, rastreamento)
    // sempre leem o MESMO mapeamento salvo da unidade, e uma atualização
    // feita na tela de Cumprimento vale pra todo mundo imediatamente (sem
    // precisar re-salvar cartões antigos).
    async function obterMapaViatura(dbUrl) {
        let mapa = null;
        try {
            const res = await fetch(`${dbUrl}/rp_viatura_map.json`);
            mapa = res.ok ? (await res.json()) : null;
        } catch (e) { mapa = null; }
        if (mapa && Object.keys(mapa).length) return mapa;
        return Object.assign({}, SEED_RP_VIATURA);
    }
    async function obterOuSemearMapaViatura(dbUrl) {
        let mapa = null;
        try {
            const res = await fetch(`${dbUrl}/rp_viatura_map.json`);
            mapa = res.ok ? (await res.json()) : null;
        } catch (e) { mapa = null; }
        if (mapa && Object.keys(mapa).length) return mapa;
        const seed = Object.assign({}, SEED_RP_VIATURA);
        try {
            await fetch(`${dbUrl}/rp_viatura_map.json`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(seed),
            });
        } catch (e) { /* não trava quem chamou por causa do seed */ }
        return seed;
    }
    // Resolve a guarnição responsável por uma RP usando o mapeamento MAIS
    // ATUAL (não o congelado no cartão em `viaturaResponsavel`) — é assim
    // que uma correção feita na tela de Cumprimento passa a valer pra
    // cartões já salvos, sem precisar gerá-los de novo.
    function resolverViaturaPorRP(rpSelecionado, mapaViatura, fallback) {
        return (mapaViatura && mapaViatura[rpSelecionado]) || fallback || null;
    }

    // ── Planilha (Google Sheets via GAS) — fonte pro rastreamento E pro
    // cumprimento ──
    // GAS real (confirmado pelo 1º Tenente Calheiros, doGet):
    //   ?acao=atual                                   → { guarnicoes: [...] } (posição mais recente, 1 linha por idRadio)
    //   ?acao=historico&idRadio=X&dataIni=Y&dataFim=Z → { pontos: [...] }     (aba rastreamento_historico, filtrada por coletadoEm)
    // dataIni/dataFim são "AAAA-MM-DD" (comparação de string, ver doGet).
    const GAS_RASTREAMENTO_URL = 'https://script.google.com/macros/s/AKfycbz5hHwPNcMv_MFX_p2ha5D91uUrcYloVE-q1fQXONIa_CklooWhpfkTaZgSTBampjnV/exec';

    function campoGas(obj, ...chaves) {
        for (const c of chaves) { if (obj[c] !== undefined && obj[c] !== null && obj[c] !== '') return obj[c]; }
        return null;
    }

    // Posição mais recente de cada guarnição (acao=atual) — usada pro mapa
    // ao vivo de rastreamento-guarnicao.html E pra resolver nome→idRadio
    // (a aba rastreamento_historico só aceita idRadio, não nome).
    // Cache do último idRadio conhecido por guarnição (localStorage — por
    // navegador). Existe porque a única fonte de idRadio é o snapshot
    // "atual" (quem está transmitindo NESTE instante) — sem isso, uma
    // guarnição que caiu da planilha por alguns minutos (troca de turno,
    // sem sinal, apresentação) fazia o cálculo de cumprimento do MÊS
    // INTEIRO falhar com "viatura-nao-encontrada", só porque ela não estava
    // online bem na hora da consulta.
    //
    // IMPORTANTE (confirmado testando de verdade): o idRadio NÃO é fixo por
    // guarnição — é o rádio físico, que troca de mão entre turnos (ex.: RP01
    // usou 131582 numa hora e 10130367 poucos dias depois — o mesmo
    // 10130367 que antes era o rádio da RP02!). Por isso o cache guarda
    // TAMBÉM quando cada entrada foi vista, e só é usado como fallback
    // dentro de uma janela curta (poucas horas — cobre uma troca de turno
    // pontual) — passado esse prazo, uma entrada teimosa arriscaria
    // devolver o rádio de OUTRA guarnição que ficou com ele depois.
    const CACHE_IDRADIO_KEY = 'p3_cumprimento_idradio_cache';
    const CACHE_IDRADIO_VALIDADE_MS = 4 * 60 * 60 * 1000; // 4h
    function lerCacheIdRadio() {
        try { return JSON.parse(localStorage.getItem(CACHE_IDRADIO_KEY) || '{}'); } catch (e) { return {}; }
    }
    function salvarCacheIdRadio(cache) {
        try { localStorage.setItem(CACHE_IDRADIO_KEY, JSON.stringify(cache)); } catch (e) { /* localStorage indisponível — segue sem cache */ }
    }

    // Dedup de chamadas concorrentes: no carregamento da página, vários
    // pontos independentes pedem "quem está online agora" quase ao mesmo
    // tempo (cards de cumprimento — 1x por cartão salvo — mais o próprio
    // mapa ao vivo e o select de histórico) — isso disparava várias
    // requisições IDÊNTICAS pro mesmo endpoint do Apps Script em paralelo.
    // O redirecionamento que o Apps Script faz internamente
    // (script.google.com/.../exec → script.googleusercontent.com/macros/
    // echo?...) não lida bem com esse volume de chamadas simultâneas —
    // aparecia como 404 em algumas delas no console (a funcionalidade não
    // quebrava porque pelo menos 1 das chamadas concorrentes sempre
    // vingava, mas gerava ruído e desperdício de rede). Reaproveita a MESMA
    // Promise em voo por até 5s — tempo curto o bastante pra nunca
    // desatualizar de verdade, longo o bastante pra juntar essa rajada.
    let _emVooGuarnicoesPlanilha = null;
    async function obterGuarnicoesPlanilha() {
        if (_emVooGuarnicoesPlanilha) return _emVooGuarnicoesPlanilha;
        const promise = _obterGuarnicoesPlanilhaSemDedup();
        _emVooGuarnicoesPlanilha = promise;
        setTimeout(() => { if (_emVooGuarnicoesPlanilha === promise) _emVooGuarnicoesPlanilha = null; }, 5000);
        return promise;
    }

    async function _obterGuarnicoesPlanilhaSemDedup() {
        const res = await fetch(`${GAS_RASTREAMENTO_URL}?acao=atual`);
        const dados = res.ok ? await res.json() : {};
        const guarnicoes = Array.isArray(dados.guarnicoes) ? dados.guarnicoes : [];
        const porNome = {};
        const agora = Date.now();
        const cache = lerCacheIdRadio();
        let cacheMudou = false;
        guarnicoes.forEach(g => {
            const nome = campoGas(g, 'nome', 'viatura', 'prefixo');
            const idRadio = campoGas(g, 'idRadio', 'id');
            const lat = parseFloat(campoGas(g, 'lat', 'latitude'));
            const lng = parseFloat(campoGas(g, 'lng', 'lon', 'longitude'));
            if (!nome || isNaN(lat) || isNaN(lng)) return;
            // Chave normalizada pra "RP0X" (ver normalizarGuarnicao) — a
            // fonte externa (portal GEO) varia entre "RP01"/"RP 01"/nomes
            // descritivos coladas ("Rp 08 Estrela Minador") pro mesmo tipo
            // de guarnição; sem isso, o mapeamento fixo (sempre "RP 0X")
            // não bate com a posição real.
            const chave = normalizarGuarnicao(nome);
            porNome[chave] = {
                idRadio, lat, lng, nome,
                dataHoraGEO: campoGas(g, 'dataHoraGEO', 'coletadoEm'),
                // militares/status: não são usados pela resolução de
                // idRadio em si, mas a página de rastreamento (mapa ao
                // vivo) precisa deles — expostos aqui pra ela reaproveitar
                // ESTA MESMA chamada (dedup'd) em vez de fazer outro fetch
                // próprio a ?acao=atual (2 chamadas concorrentes pro mesmo
                // dado é o que sobrecarregava o redirecionamento do Apps
                // Script e causava os 404 de echo).
                militares: campoGas(g, 'militares', 'integrantes', 'equipe') || '',
                status:    campoGas(g, 'status', 'situacao') || '',
            };
            if (idRadio && (!cache[chave] || cache[chave].idRadio !== idRadio)) {
                cache[chave] = { idRadio, vistoEm: agora };
                cacheMudou = true;
            }
        });
        if (cacheMudou) salvarCacheIdRadio(cache);

        // Guarnição do mapeamento fixo que não apareceu no snapshot "atual"
        // (offline agora) — entra com o idRadio cacheado SÓ se foi visto
        // dentro da janela de validade (ver CACHE_IDRADIO_VALIDADE_MS acima);
        // fora dela, fica de fora mesmo (melhor "sem dado" do que atribuir o
        // rádio errado). lat/lng ficam null — sem posição atual, não tem
        // como saber.
        Object.keys(cache).forEach(chave => {
            if (porNome[chave]) return;
            const entrada = cache[chave];
            if (entrada && (agora - entrada.vistoEm) <= CACHE_IDRADIO_VALIDADE_MS) {
                porNome[chave] = { idRadio: entrada.idRadio, lat: null, lng: null, nome: chave, offline: true };
            }
        });
        return porNome;
    }

    // Um bloco está "ativo agora" quando o horário atual cai em [ini, fim)
    // dele — checa hoje E ontem (base -1 dia) pra cobrir blocos que
    // atravessam a meia-noite (ex.: 19:00–00:00) sem exigir que o cartão
    // tenha sido gerado especificamente hoje (cartão-programa é uma rotina
    // diária recorrente, não um evento de uma data só). Usado só pelo
    // destaque visual no mapa de rastreamento — o cumprimento em si usa o
    // histórico da planilha (ver calcularCumprimentoPeriodo), não isso.
    function estaDentroDoHorarioAtual(bloco) {
        const mIni = (bloco.ini || '').match(/(\d{1,2}):(\d{2})/);
        const mFim = (bloco.fim || '').match(/(\d{1,2}):(\d{2})/);
        if (!mIni || !mFim) return false;
        const agora = new Date();
        for (const offsetDias of [0, -1]) {
            const base = new Date(agora);
            base.setDate(base.getDate() + offsetDias);
            base.setHours(0, 0, 0, 0);
            const inicio = new Date(base);
            inicio.setHours(+mIni[1], +mIni[2], 0, 0);
            let fim = new Date(base);
            fim.setHours(+mFim[1], +mFim[2], 0, 0);
            if (fim <= inicio) fim = new Date(fim.getTime() + 24 * 60 * 60 * 1000);
            if (agora >= inicio && agora <= fim) return true;
        }
        return false;
    }

    // Histórico real (aba rastreamento_historico) de 1 viatura num período —
    // usado pro cálculo de cumprimento (tempo dentro do perímetro) E pro
    // "Trajeto histórico" de rastreamento-guarnicao.html.
    async function buscarHistoricoPlanilha(idRadio, dataIniISO, dataFimISO) {
        const params = new URLSearchParams({ acao: 'historico', idRadio: String(idRadio) });
        if (dataIniISO) params.set('dataIni', dataIniISO);
        if (dataFimISO) params.set('dataFim', dataFimISO);
        const res = await fetch(`${GAS_RASTREAMENTO_URL}?${params.toString()}`);
        const dados = res.ok ? await res.json() : {};
        const pontos = Array.isArray(dados.pontos) ? dados.pontos : [];
        const ordenados = pontos
            .map(p => ({
                dt: new Date(campoGas(p, 'dataHora', 'coletadoEm')),
                lat: parseFloat(p.lat), lng: parseFloat(p.lng),
                militares: p.militares || '', status: p.status || '',
            }))
            .filter(p => p.dt instanceof Date && !isNaN(p.dt.getTime()) && !isNaN(p.lat) && !isNaN(p.lng))
            .sort((a, b) => a.dt - b.dt);

        // Deduplica pontos com o MESMO dataHora consecutivo — a fonte
        // externa (portal GEO/SEDS-AL) às vezes devolve o mesmo horário em
        // várias coletas seguidas (a posição real ainda não tinha
        // atualizado do lado deles, mas nós já coletamos de novo alguns
        // segundos depois). Sem isso, calcularCumprimentoBlocoNoDia mede o
        // "tempo dentro" pela diferença de horário entre pontos
        // consecutivos — com dataHora repetido essa diferença vira 0,
        // achatando o cumprimento pra 0% mesmo com presença real.
        const deduplicados = [];
        for (const p of ordenados) {
            const ultimo = deduplicados[deduplicados.length - 1];
            if (!ultimo || ultimo.dt.getTime() !== p.dt.getTime()) deduplicados.push(p);
        }
        return deduplicados;
    }

    function enumerarDiasISO(dataIniISO, dataFimISO) {
        const dias = [];
        let d = new Date(dataIniISO + 'T00:00:00');
        const fim = new Date(dataFimISO + 'T00:00:00');
        while (d <= fim) {
            dias.push(d.toISOString().slice(0, 10));
            d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
        }
        return dias;
    }

    // "Tempo mínimo de permanência": soma o tempo entre pontos CONSECUTIVOS
    // do histórico que caem dentro do raio da área, na janela [ini, fim] do
    // bloco NAQUELE DIA (cruzando meia-noite quando necessário) — cumprido
    // = tempo somado >= limiarMinutos.
    function calcularCumprimentoBlocoNoDia(bloco, historico, limiarMinutos, diaISO) {
        if (!bloco.area) return { cumprido: null, tempoDentroMin: 0, aplica: false, motivo: 'sem-area' };
        const mIni = (bloco.ini || '').match(/(\d{1,2}):(\d{2})/);
        const mFim = (bloco.fim || '').match(/(\d{1,2}):(\d{2})/);
        if (!mIni || !mFim) return { cumprido: null, tempoDentroMin: 0, aplica: false, motivo: 'sem-horario' };

        const base = new Date(diaISO + 'T00:00:00');
        const inicio = new Date(base);
        inicio.setHours(+mIni[1], +mIni[2], 0, 0);
        let fim = new Date(base);
        fim.setHours(+mFim[1], +mFim[2], 0, 0);
        if (fim <= inicio) fim = new Date(fim.getTime() + 24 * 60 * 60 * 1000);

        const naJanela = (historico || [])
            .filter(p => p.dt >= inicio && p.dt <= fim)
            .sort((a, b) => a.dt - b.dt);

        // Teto por "meia-janela" ao redor de cada ponto dentro do raio — evita
        // inflar o tempo quando há falha de sinal/poucas leituras. Mantido em
        // 10min pra bater com o teto de gap que já existia antes.
        const TETO_MEIA_JANELA_MS = 10 * 60 * 1000;

        // Crédito de permanência por ponto (não por PAR consecutivo): a coleta
        // real (GEO/SEDS-AL) é esparsa (leituras a cada poucos minutos) e nem
        // sempre a leitura seguinte a um ponto real dentro da área também cai
        // dentro do raio — exigir os DOIS vizinhos dentro do raio descartava
        // presença real comprovada sempre que a leitura anterior/seguinte
        // estava fora (ex.: viatura chegou, ficou, mas só 1 leitura pegou o
        // instante exato). Aqui cada ponto DENTRO do raio credita metade do
        // intervalo até o vizinho anterior + metade até o próximo (cada metade
        // limitada ao teto acima); pra uma sequência de pontos consecutivos
        // todos dentro do raio isso soma exatamente o mesmo tempo de antes
        // (cada gap interno é dividido e credita seus dois extremos).
        let tempoDentroMs = 0;
        for (let i = 0; i < naJanela.length; i++) {
            const p = naJanela[i];
            const d = haversineKm(p.lat, p.lng, bloco.area.lat, bloco.area.lng);
            if (d > bloco.area.raioKm) continue;
            const anterior = naJanela[i - 1];
            const proximo = naJanela[i + 1];
            const meioAntes = anterior ? Math.min(p.dt - anterior.dt, TETO_MEIA_JANELA_MS) / 2 : TETO_MEIA_JANELA_MS / 2;
            const meioDepois = proximo ? Math.min(proximo.dt - p.dt, TETO_MEIA_JANELA_MS) / 2 : TETO_MEIA_JANELA_MS / 2;
            tempoDentroMs += meioAntes + meioDepois;
        }
        const tempoDentroMin = Math.round(tempoDentroMs / 60000);
        return { cumprido: tempoDentroMin >= limiarMinutos, tempoDentroMin, aplica: true };
    }

    function resumirBlocos(blocos) {
        const aplicaveis = blocos.filter(b => b.aplica);
        const cumpridos = aplicaveis.filter(b => b.cumprido).length;
        const percentualCumprido = aplicaveis.length ? Math.round((cumpridos / aplicaveis.length) * 100) : null;
        const percentualFalha = percentualCumprido === null ? null : (100 - percentualCumprido);
        return { blocos, percentualCumprido, percentualFalha, totalBlocos: aplicaveis.length, blocosCumpridos: cumpridos };
    }

    // Orquestra o cumprimento de UM cronograma (rotina diária, de um cartão
    // salvo) contra o HISTÓRICO REAL de uma viatura num PERÍODO (pode ser
    // vários dias — ex.: o mês inteiro) — aplica o mesmo cronograma em cada
    // dia do período e soma os resultados. opts:
    //   cronograma      : array de blocos {ini, fim, miss, det, area} (de um cartão salvo)
    //   viaturaNome     : nome da guarnição no rastreamento (ex. "RP 01")
    //   dataIniISO      : "AAAA-MM-DD"
    //   dataFimISO      : "AAAA-MM-DD"
    //   limiarMinutos   : tempo mínimo de permanência (default 15)
    //   filtroMilitar   : texto opcional — só considera pontos do histórico
    //                     cujo campo "militares" contenha esse texto (ex.:
    //                     "Sd Fulano"), pra medir o desempenho de UM PM
    //                     específico dentro da guarnição.
    //   diasPermitidos  : array opcional de "AAAA-MM-DD" — restringe quais
    //                     dias do período são de fato avaliados (usado pela
    //                     busca por militar, que só conta os dias em que as
    //                     vistorias confirmam que ele estava naquela
    //                     guarnição — ver buscarCumprimentoPorMilitar).
    async function calcularCumprimentoPeriodo(opts) {
        opts = opts || {};
        const limiarMinutos = opts.limiarMinutos || 15;

        const guarnicoes = await obterGuarnicoesPlanilha();
        const info = opts.viaturaNome ? guarnicoes[normalizarGuarnicao(opts.viaturaNome)] : null;
        if (!info || !info.idRadio) {
            return { erro: 'viatura-nao-encontrada', viaturaEncontrada: false, blocos: [], percentualCumprido: null, percentualFalha: null, totalBlocos: 0, blocosCumpridos: 0, totalPontosHistorico: 0 };
        }

        let historico = await buscarHistoricoPlanilha(info.idRadio, opts.dataIniISO, opts.dataFimISO);
        if (opts.filtroMilitar) {
            const alvo = normalizarStr(opts.filtroMilitar);
            historico = historico.filter(p => normalizarStr(p.militares).includes(alvo));
        }

        const linhas = (opts.cronograma || []).filter(l => !ehBlocoAdministrativo(l.det));
        let dias = enumerarDiasISO(opts.dataIniISO, opts.dataFimISO);
        if (opts.diasPermitidos) {
            const permitidos = new Set(opts.diasPermitidos);
            dias = dias.filter(d => permitidos.has(d));
        }

        const blocos = [];
        dias.forEach(diaISO => {
            linhas.forEach(bloco => {
                const r = calcularCumprimentoBlocoNoDia(bloco, historico, limiarMinutos, diaISO);
                blocos.push(Object.assign({ dia: diaISO }, bloco, r));
            });
        });

        return Object.assign(
            { erro: null, viaturaEncontrada: true, totalPontosHistorico: historico.length },
            resumirBlocos(blocos)
        );
    }

    // "AAAA-MM-DD" + n dias (local, sem risco de fuso — parse e formata
    // sempre via getters locais, nunca .toISOString()).
    function somarDiasISO(diaISO, n) {
        const d = new Date(diaISO + 'T00:00:00');
        d.setDate(d.getDate() + n);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    // O serviço da guarnição é um TURNO de 24h — começa por volta das 8h da
    // manhã (1º bloco do cronograma, ex. "08:30-13:00") e só termina por
    // volta das 7h30 do dia SEGUINTE (último bloco, ex. "05:00-07:30"), não
    // à meia-noite do calendário. calcularCumprimentoPeriodo (acima) aplica
    // o cronograma inteiro em cada DIA DO CALENDÁRIO — o que funciona bem
    // agregado num mês inteiro (cada virada de dia se compensa: o que
    // "sobra" de um dia é o que "falta" no seguinte), mas quebra pra 1 dia
    // isolado: os blocos de madrugada (00:00-03:00, 03:00-05:00,
    // 05:00-07:30) do diaISO=D, calculados aqui, na verdade são o RESTO do
    // turno que começou em D-1 às 19h — não a madrugada do turno que começa
    // em D. calcularCumprimentoTurno corrige isso: um bloco cujo horário de
    // início é >= 8h pertence ao turno que COMEÇA no diaTurnoISO; um bloco
    // com início < 8h pertence ao MESMO turno, mas sua data-base real é
    // diaTurnoISO+1 (a madrugada seguinte).
    function calcularCumprimentoTurno(cronograma, historico, limiarMinutos, diaTurnoISO) {
        const diaSeguinteISO = somarDiasISO(diaTurnoISO, 1);
        const linhas = (cronograma || []).filter(l => !ehBlocoAdministrativo(l.det));
        const blocos = linhas.map(bloco => {
            const mIni = (bloco.ini || '').match(/(\d{1,2}):(\d{2})/);
            const horaIni = mIni ? parseInt(mIni[1], 10) : 8;
            const diaBase = horaIni >= 8 ? diaTurnoISO : diaSeguinteISO;
            const r = calcularCumprimentoBlocoNoDia(bloco, historico, limiarMinutos, diaBase);
            return Object.assign({ dia: diaBase, turno: diaTurnoISO }, bloco, r);
        });
        return resumirBlocos(blocos);
    }

    // Mesma orquestração de calcularCumprimentoPeriodo, mas por TURNO (8h de
    // diaISO até 8h de diaISO+1) em vez de dia de calendário — usada em
    // todo lugar EXCETO o card "Cumprimento do mês" (que continua agregando
    // por dia de calendário, sem diferença prática num período de 1 mês
    // inteiro). Busca o histórico com 1 dia a mais no fim: o turno do
    // ÚLTIMO dia do período só termina às 7h30/8h do dia SEGUINTE.
    async function calcularCumprimentoPeriodoTurno(opts) {
        opts = opts || {};
        const limiarMinutos = opts.limiarMinutos || 15;

        const guarnicoes = await obterGuarnicoesPlanilha();
        const info = opts.viaturaNome ? guarnicoes[normalizarGuarnicao(opts.viaturaNome)] : null;
        if (!info || !info.idRadio) {
            return { erro: 'viatura-nao-encontrada', viaturaEncontrada: false, blocos: [], percentualCumprido: null, percentualFalha: null, totalBlocos: 0, blocosCumpridos: 0, totalPontosHistorico: 0 };
        }

        const dataFimBusca = somarDiasISO(opts.dataFimISO, 1);
        let historico = await buscarHistoricoPlanilha(info.idRadio, opts.dataIniISO, dataFimBusca);
        if (opts.filtroMilitar) {
            const alvo = normalizarStr(opts.filtroMilitar);
            historico = historico.filter(p => normalizarStr(p.militares).includes(alvo));
        }

        let dias = enumerarDiasISO(opts.dataIniISO, opts.dataFimISO);
        if (opts.diasPermitidos) {
            const permitidos = new Set(opts.diasPermitidos);
            dias = dias.filter(d => permitidos.has(d));
        }

        const blocos = [];
        dias.forEach(diaTurnoISO => {
            const r = calcularCumprimentoTurno(opts.cronograma, historico, limiarMinutos, diaTurnoISO);
            blocos.push(...r.blocos);
        });

        return Object.assign(
            { erro: null, viaturaEncontrada: true, totalPontosHistorico: historico.length },
            resumirBlocos(blocos)
        );
    }

    // ── Cruzamento com "vistorias" (Firebase de frota) ───────────────────
    // vistorias tem campos MUITO mais confiáveis de identidade do militar
    // (motorista, nomeCivil, posto, matrícula — via assinatura eletrônica)
    // do que o campo solto "militares" do rastreamento_historico, além de
    // já vir com o campo `guarnicao` no MESMO formato de texto usado como
    // "nome" no rastreamento (ex. "RP 01", "PATRULHA MARIA DA PENHA") — é
    // a ponte pra descobrir EM QUAIS guarnições/dias um militar específico
    // esteve, sem depender só de correspondência de texto solto.
    async function buscarVistoriasPorMilitar(nomeMilitar, dataIniISO, dataFimISO) {
        const res = await fetch(`${FROTA_DATABASE_URL}/vistorias.json`);
        const dados = res.ok ? await res.json() : {};
        const alvo = normalizarStr(nomeMilitar);
        const registros = [];
        Object.values(dados || {}).forEach(v => {
            if (!v || !v.guarnicao) return;
            const dia = String(v.dataHora || '').slice(0, 10);
            if (dataIniISO && dia < dataIniISO) return;
            if (dataFimISO && dia > dataFimISO) return;
            const candidatos = [
                v.motorista, v.nomeCivil,
                v.assinatura && v.assinatura.nomeGuerra,
                v.assinatura && v.assinatura.nomeCivil,
            ];
            if (!candidatos.some(c => c && normalizarStr(c).includes(alvo))) return;
            registros.push({
                guarnicao: v.guarnicao, dia,
                horaInicio: v.horaInicio || null, horaTermino: v.horaTermino || null,
                motorista: v.motorista || null, nomeCivil: v.nomeCivil || null,
                posto: v.posto || null, matricula: v.matricula || null,
            });
        });
        return registros;
    }

    // Acha em quais guarnições um militar apareceu (via vistorias) num
    // período, e pra cada uma calcula o cumprimento do cartão-programa
    // correspondente, restrito aos DIAS em que ele de fato foi identificado
    // (não o período inteiro) — satisfaz "quanto % do mês X o Sd Fulano
    // patrulhou corretamente dentro dos perímetros", inclusive quando ele
    // passou por mais de uma guarnição no período. opts:
    //   nomeMilitar, dataIniISO, dataFimISO, limiarMinutos
    //   cartoesSalvos : array de cartões (tipo:'cartao') já carregados pela tela
    //   mapaViatura   : mapeamento RP→guarnição ATUAL (rp_viatura_map), pra
    //                   resolver a viatura responsável sem depender do
    //                   valor congelado no cartão
    //   rpFiltro      : opcional — restringe a busca só à guarnição mapeada
    //                   pra essa RP (ex.: "Sd Fulano" + "RP 01 (...)")
    async function buscarCumprimentoPorMilitar(opts) {
        opts = opts || {};
        const mapaViatura = opts.mapaViatura || {};
        const registros = await buscarVistoriasPorMilitar(opts.nomeMilitar, opts.dataIniISO, opts.dataFimISO);
        if (!registros.length) return { encontrado: false, porGuarnicao: [] };

        const porGuarnicaoChave = new Map();
        registros.forEach(r => {
            const chave = normalizarGuarnicao(r.guarnicao);
            if (!chave) return;
            if (!porGuarnicaoChave.has(chave)) porGuarnicaoChave.set(chave, { guarnicao: r.guarnicao, dias: new Set() });
            porGuarnicaoChave.get(chave).dias.add(r.dia);
        });

        let chavesAlvo = Array.from(porGuarnicaoChave.keys());
        if (opts.rpFiltro) {
            const viaturaDoRP = normalizarGuarnicao(mapaViatura[opts.rpFiltro] || '');
            chavesAlvo = chavesAlvo.filter(c => c === viaturaDoRP);
        }

        const resultados = [];
        for (const chave of chavesAlvo) {
            const info = porGuarnicaoChave.get(chave);
            const diasArr = Array.from(info.dias).sort();
            const cartao = (opts.cartoesSalvos || []).find(c => {
                if (c.tipo === 'opo') return false;
                const viaturaAtual = normalizarGuarnicao(resolverViaturaPorRP(c.rpSelecionado, mapaViatura, c.viaturaResponsavel));
                return viaturaAtual === chave;
            });
            if (!cartao) {
                resultados.push({ guarnicao: info.guarnicao, cartaoEncontrado: false, cidade: null, dias: diasArr, resultado: null });
                continue;
            }
            const viaturaNome = resolverViaturaPorRP(cartao.rpSelecionado, mapaViatura, cartao.viaturaResponsavel);
            // Por TURNO (8h-8h), não por dia de calendário — os dias em
            // diasArr vêm da vistoria (normalmente feita na troca de turno,
            // ~8h), então cada um já corresponde ao início de 1 turno.
            const r = await calcularCumprimentoPeriodoTurno({
                cronograma: cartao.cronograma, viaturaNome,
                dataIniISO: diasArr[0], dataFimISO: diasArr[diasArr.length - 1],
                diasPermitidos: diasArr, limiarMinutos: opts.limiarMinutos,
                filtroMilitar: opts.nomeMilitar,
            });
            resultados.push({ guarnicao: info.guarnicao, cartaoEncontrado: true, cidade: cartao.cidade, dias: diasArr, resultado: r });
        }
        return { encontrado: resultados.length > 0, porGuarnicao: resultados };
    }

    // ════════════════════════════════════════════════════════════════
    // GESTÃO DE FROTA — sinistros, manutenção (revisão por km), vistorias
    // e cadastro de motoristas/viaturas. MESMO Firebase de frota acima
    // (só leitura) — nós confirmados direto na base real: /sinistros,
    // /manutencao, /vistorias, /motoristas, /viaturas (ver também
    // /historico_manutencao, /rastreamento_historico, /rastreamento,
    // /rastreamento_meta, /mapa_diario, /relatorios_diarios, /usuarios —
    // fora do escopo desta função, não usados aqui). Pedido explícito do
    // usuário: motorista/viatura com mais sinistro, viatura mais próxima
    // (ou já vencida) da revisão, dossiê da viatura, dossiê do motorista.
    // ════════════════════════════════════════════════════════════════
    async function fetchFrotaComTimeout(caminho) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        try {
            const res = await fetch(`${FROTA_DATABASE_URL}/${caminho}.json`, { signal: controller.signal });
            return res.ok ? await res.json() : {};
        } finally { clearTimeout(timer); }
    }
    function paraListaComId(dados) {
        return Object.entries(dados || {}).map(([id, v]) => Object.assign({ id }, v));
    }
    async function obterSinistros() { return paraListaComId(await fetchFrotaComTimeout('sinistros')); }
    async function obterManutencao() { return paraListaComId(await fetchFrotaComTimeout('manutencao')); }
    async function obterVistorias() { return paraListaComId(await fetchFrotaComTimeout('vistorias')); }
    async function obterMotoristas() { return paraListaComId(await fetchFrotaComTimeout('motoristas')); }
    async function obterViaturas() { return paraListaComId(await fetchFrotaComTimeout('viaturas')); }

    // Ranking de motoristas por quantidade de sinistros — agrupa por
    // matrícula (mais estável que nome pra identificar a MESMA pessoa),
    // mas mostra o nome real pro usuário.
    async function rankingMotoristasSinistro(limite) {
        const sinistros = await obterSinistros();
        const porMotorista = {};
        sinistros.forEach(s => {
            const chave = s.condutorMatricula || s.condutorNome || 'desconhecido';
            if (!porMotorista[chave]) porMotorista[chave] = { nome: s.condutorNome || 'não informado', matricula: s.condutorMatricula || null, posto: s.condutorPosto || null, total: 0, ultimos: [] };
            porMotorista[chave].total++;
            porMotorista[chave].ultimos.push({ data: s.data, tipos: s.tipos, prefixo: s.prefixo, danos: s.danosOficial });
        });
        return Object.values(porMotorista).sort((a, b) => b.total - a.total).slice(0, limite || 10);
    }
    // Ranking de viaturas por quantidade de sinistros — agrupa por prefixo
    // (nome operacional da viatura, ex.: "30-1260"), com placa como reforço.
    async function rankingViaturasSinistro(limite) {
        const sinistros = await obterSinistros();
        const porViatura = {};
        sinistros.forEach(s => {
            const chave = s.prefixo || s.placa || 'desconhecida';
            if (!porViatura[chave]) porViatura[chave] = { prefixo: s.prefixo || null, placa: s.placa || null, marca: s.marca || null, modelo: s.modelo || null, total: 0 };
            porViatura[chave].total++;
        });
        return Object.values(porViatura).sort((a, b) => b.total - a.total).slice(0, limite || 10);
    }
    // Viaturas mais PRÓXIMAS (ou já vencidas) da próxima revisão — ordena
    // por faltaKm crescente (negativo/zero = já venceu o km da revisão).
    // limite: quantas retornar; sóVencidas: true filtra só as que já
    // passaram do km (situação que precisa de ação AGORA).
    async function viaturasProximasRevisao(limite, soVencidas) {
        const manut = await obterManutencao();
        // Alguns registros de /manutencao não são viatura de verdade (ex.:
        // prefixo literalmente "true"/"false" — erro de cadastro na
        // origem, valor booleano salvo como string) — filtra esse lixo de
        // dado antes de rankear, senão aparecia misturado com viaturas
        // reais (encontrado testando com dado real).
        let lista = manut.filter(m => typeof m.faltaKm === 'number' && !/^(true|false)$/i.test(String(m.prefixo || '').trim()));
        if (soVencidas) lista = lista.filter(m => m.faltaKm <= 0);
        return lista
            .sort((a, b) => a.faltaKm - b.faltaKm)
            .slice(0, limite || 10)
            .map(m => ({ prefixo: m.prefixo, placa: m.placa, marca: m.marca, modelo: m.modelo, kmAtual: m.kmAtual, proxRevisao: m.proxRevisao, faltaKm: m.faltaKm, situacao: m.situacao, vencida: m.faltaKm <= 0 }));
    }
    // Dossiê de UMA viatura — cruza cadastro + manutenção atual + histórico
    // de sinistros + última vistoria, tudo pelo MESMO prefixo/placa.
    async function obterDossieViatura(prefixoOuPlaca) {
        const alvo = normalizarStr(prefixoOuPlaca).replace(/\s+/g, '');
        const bateAlvo = v => normalizarStr(v || '').replace(/\s+/g, '') === alvo;
        const [viaturas, manut, sinistros, vistorias] = await Promise.all([obterViaturas(), obterManutencao(), obterSinistros(), obterVistorias()]);
        const bate = v => bateAlvo(v.prefixo) || bateAlvo(v.placa);
        const viatura = viaturas.find(bate);
        const manutencaoAtual = manut.find(bate);
        const sinistrosDaViatura = sinistros.filter(bate).sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));
        const vistoriasDaViatura = vistorias.filter(bate).sort((a, b) => new Date(b.dataHora || 0) - new Date(a.dataHora || 0));
        if (!viatura && !manutencaoAtual && !sinistrosDaViatura.length && !vistoriasDaViatura.length) return null;
        return {
            viatura: viatura || null, manutencao: manutencaoAtual || null,
            totalSinistros: sinistrosDaViatura.length, sinistros: sinistrosDaViatura.slice(0, 5),
            ultimaVistoria: vistoriasDaViatura[0] || null,
        };
    }
    // Dossiê de UM motorista — cruza cadastro + sinistros em que ele foi o
    // condutor + vistorias que ele realizou, pelo CPF/matrícula/nome.
    async function obterDossieMotorista(nomeOuMatricula) {
        const alvo = normalizarStr(nomeOuMatricula);
        const [motoristas, sinistros, vistorias] = await Promise.all([obterMotoristas(), obterSinistros(), obterVistorias()]);
        const bateMotorista = m => normalizarStr(m.matricula || '') === alvo || normalizarStr(m.cpf || '') === alvo || normalizarStr(m.nomeCivil || '').includes(alvo) || normalizarStr(m.nomeGuerra || '').includes(alvo);
        const motorista = motoristas.find(bateMotorista);
        const bateSinistro = s => normalizarStr(s.condutorMatricula || '') === alvo || normalizarStr(s.condutorNome || '').includes(alvo);
        const sinistrosDoMotorista = sinistros.filter(bateSinistro).sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));
        const bateVistoria = v => normalizarStr(v.matricula || '') === alvo || normalizarStr(v.nomeCivil || '').includes(alvo) || normalizarStr(v.motorista || '').includes(alvo);
        const vistoriasDoMotorista = vistorias.filter(bateVistoria);
        if (!motorista && !sinistrosDoMotorista.length && !vistoriasDoMotorista.length) return null;
        return {
            motorista: motorista || null,
            totalSinistros: sinistrosDoMotorista.length, sinistros: sinistrosDoMotorista.slice(0, 5),
            totalVistoriasRealizadas: vistoriasDoMotorista.length,
        };
    }

    window.CumprimentoCore = {
        FROTA_DATABASE_URL,
        GAS_RASTREAMENTO_URL,
        SEED_RP_VIATURA,
        normalizarStr,
        normalizarGuarnicao,
        haversineKm,
        extrairBairros,
        ehBlocoAdministrativo,
        resolverAreaBairro,
        obterViaturasAtivas,
        buscarHistoricoViatura,
        obterGuarnicoesPlanilha,
        buscarHistoricoPlanilha,
        estaDentroDoHorarioAtual,
        calcularCumprimentoBlocoNoDia,
        calcularCumprimentoPeriodo,
        somarDiasISO,
        calcularCumprimentoTurno,
        calcularCumprimentoPeriodoTurno,
        converterDataBRparaISO,
        calcularValidoAte,
        ehCartaoValido,
        obterMapaViatura,
        obterOuSemearMapaViatura,
        resolverViaturaPorRP,
        buscarVistoriasPorMilitar,
        buscarCumprimentoPorMilitar,
        obterSinistros,
        obterManutencao,
        obterVistorias,
        obterMotoristas,
        obterViaturas,
        rankingMotoristasSinistro,
        rankingViaturasSinistro,
        viaturasProximasRevisao,
        obterDossieViatura,
        obterDossieMotorista,
    };
})();
