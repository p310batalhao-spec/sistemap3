// ════════════════════════════════════════════════════════════════════
// OPO HOTSPOT CORE — motor de hotspots/alocação tática, portado
// FIELMENTE de page/opo_inteligente.html (mesma classificação CVP/CVLI,
// mesmo agrupamento geográfico, mesma régua de reforço por RP/Tático/FT).
//
// Por que um arquivo NOVO em vez de mexer em opo_inteligente.html: aquela
// página já está em produção com essa lógica inline; extrair pra um módulo
// compartilhado ali arrisca quebrar uma ferramenta tática já em uso. Este
// arquivo é a MESMA lógica, só isolada em funções puras (sem DOM/mapa) pra
// o dashboard JARVIS (page/ia_xerife.html) reaproveitar. Se o critério
// mudar em opo_inteligente.html, mudar aqui também.
//
// Diferença deliberada: passaNoTurno() lá lê uma variável global mutável
// (turnoAtual); aqui virou parâmetro de função — mesmo comportamento, só
// sem estado escondido.
// ════════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    if (window.OpoHotspotCore) return;

    const NODE_OCORRENCIAS = 'geral';

    const CIDADES_GEO = {
        'PALMEIRA DOS ÍNDIOS': { lat: -9.4092, lng: -36.6289, zoom: 14 },
        'BELÉM': { lat: -9.5722, lng: -36.6169, zoom: 14 },
        'CACIMBINHAS': { lat: -9.3872, lng: -37.0064, zoom: 14 },
        'ESTRELA DE ALAGOAS': { lat: -9.5433, lng: -36.5167, zoom: 14 },
        'IGACI': { lat: -9.5361, lng: -36.6467, zoom: 14 },
        'MAR VERMELHO': { lat: -9.4200, lng: -36.5283, zoom: 14 },
        'MARIBONDO': { lat: -9.5600, lng: -36.3278, zoom: 14 },
        'MINADOR DO NEGRÃO': { lat: -9.3453, lng: -36.8628, zoom: 14 },
        'PAULO JACINTO': { lat: -9.5267, lng: -36.4100, zoom: 14 },
        'QUEBRANGULO': { lat: -9.3167, lng: -36.4736, zoom: 14 },
        "TANQUE D'ARCA": { lat: -9.6522, lng: -36.6181, zoom: 14 },
        'TANQUE D ARCA': { lat: -9.6522, lng: -36.6181, zoom: 14 },
    };
    const CIDADES_10BPM = [
        'BELÉM', 'CACIMBINHAS', 'ESTRELA DE ALAGOAS', 'IGACI',
        'MARIBONDO', 'MAR VERMELHO', 'MINADOR DO NEGRÃO',
        'PALMEIRA DOS ÍNDIOS', 'PAULO JACINTO', 'QUEBRANGULO', "TANQUE D'ARCA",
    ];
    const GEO_10BPM = { lat: -9.4500, lng: -36.6200, zoom: 10 };
    const HORARIOS_PICO = [
        { faixa: '06h–09h', intensidade: 0.4, turno: 'Manhã' },
        { faixa: '11h–13h', intensidade: 0.5, turno: 'Almoço' },
        { faixa: '18h–21h', intensidade: 0.9, turno: 'Entardecer' },
        { faixa: '21h–00h', intensidade: 1.0, turno: 'Noite' },
        { faixa: '00h–03h', intensidade: 0.7, turno: 'Madrugada' },
    ];
    const FAIXAS_TURNO = {
        manha: { ini: 6, fim: 11, label: 'MANHÃ (06h–12h)' },
        tarde: { ini: 12, fim: 17, label: 'TARDE (12h–18h)' },
        noite: { ini: 18, fim: 5, label: 'NOITE (18h–06h)' },
    };
    const FT_HOMENS_CADA = 3;
    const FT_MAX = 99; // ilimitado — FTs criadas conforme a análise

    const EFETIVO_OPO = [
        { id: 'rp_palmeira_1', label: 'RP 01 — PALMEIRA DOS ÍNDIOS', vtr: 1, homens: 3, tipo: 'rp', cidades: ['PALMEIRA DOS ÍNDIOS'] },
        { id: 'rp_palmeira_2', label: 'RP 02 — PALMEIRA DOS ÍNDIOS', vtr: 1, homens: 3, tipo: 'rp', cidades: ['PALMEIRA DOS ÍNDIOS'] },
        { id: 'rp_cacimbinhas', label: 'RP — CACIMBINHAS', vtr: 1, homens: 3, tipo: 'rp', cidades: ['CACIMBINHAS'] },
        { id: 'rp_quebrangulo', label: 'RP — QUEBRANGULO', vtr: 1, homens: 3, tipo: 'rp', cidades: ['QUEBRANGULO'] },
        { id: 'rp_maribondo', label: 'RP — MARIBONDO', vtr: 1, homens: 3, tipo: 'rp', cidades: ['MARIBONDO'] },
        { id: 'rp_igaci', label: 'RP — IGACI', vtr: 1, homens: 3, tipo: 'rp', cidades: ['IGACI'] },
        { id: 'rp_estrela_minador', label: "RP — ESTRELA DE ALAGOAS / MINADOR DO NEGRÃO", vtr: 1, homens: 3, tipo: 'rp', cidades: ['ESTRELA DE ALAGOAS', 'MINADOR DO NEGRÃO'] },
        { id: 'rp_belem_tanque', label: "RP — BELÉM / TANQUE D'ARCA", vtr: 1, homens: 3, tipo: 'rp', cidades: ['BELÉM', "TANQUE D'ARCA"] },
        { id: 'rp_marverm_paulo', label: 'RP — MAR VERMELHO / PAULO JACINTO', vtr: 1, homens: 3, tipo: 'rp', cidades: ['MAR VERMELHO', 'PAULO JACINTO'] },
        { id: 'tur_01', label: 'TÁTICO URBANO 01', vtr: 1, homens: 3, tipo: 'tatico_urbano', cidades: ['PALMEIRA DOS ÍNDIOS'] },
        { id: 'tur_02', label: 'TÁTICO URBANO 02', vtr: 1, homens: 3, tipo: 'tatico_urbano', cidades: ['PALMEIRA DOS ÍNDIOS'] },
        { id: 'tru_01', label: 'TÁTICO RURAL 01', vtr: 1, homens: 3, tipo: 'tatico_rural', cidades: null },
        { id: 'tru_02', label: 'TÁTICO RURAL 02', vtr: 1, homens: 3, tipo: 'tatico_rural', cidades: null },
        { id: 'oficial', label: 'OFICIAL DE SERVIÇO', vtr: 0, homens: 1, tipo: 'oficial', cidades: null },
    ];
    const EFETIVO_TOTAL_VTR = EFETIVO_OPO.reduce((s, e) => s + e.vtr, 0);
    const EFETIVO_TOTAL_PRAC = EFETIVO_OPO.reduce((s, e) => s + e.homens, 0);
    const EFETIVO_SEM_OFICIAL = EFETIVO_TOTAL_PRAC - 1;

    function criarFT(numero) {
        return { id: `ft_${String(numero).padStart(2, '0')}`, label: `FORÇA TAREFA ${String(numero).padStart(2, '0')} (FT)`, vtr: 1, homens: 3, tipo: 'ft', cidades: null };
    }
    function getTaticosUrbanos() { return EFETIVO_OPO.filter(e => e.tipo === 'tatico_urbano'); }
    function getTaticosRurais() { return EFETIVO_OPO.filter(e => e.tipo === 'tatico_rural'); }
    function getRPsDaCidade(cidade) {
        const norm = normalizarStr(cidade);
        return EFETIVO_OPO.filter(e => e.tipo === 'rp' && e.cidades.some(c => normalizarStr(c) === norm));
    }

    function normalizarStr(s) { return (s || '').toString().toUpperCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
    function normalizarCidade(str) {
        if (!str) return '';
        return str.toString().trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
    }
    function parsearData(str) {
        if (!str) return null;
        str = str.toString().trim();
        if (/^\d{2}\/\d{2}\/\d{4}/.test(str)) {
            const [d, m, a] = str.split('/');
            const dt = new Date(`${a}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00`);
            return isNaN(dt) ? null : dt;
        }
        if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
            const dt = new Date(str.substring(0, 10) + 'T00:00:00');
            return isNaN(dt) ? null : dt;
        }
        const n = Number(str);
        if (!isNaN(n) && n > 1000000000) return new Date(n);
        const dt = new Date(str);
        return isNaN(dt) ? null : dt;
    }
    // turno: '' | 'manha' | 'tarde' | 'noite' — vira parâmetro aqui (na
    // origem é uma variável global mutável, ver aviso no topo do arquivo).
    function passaNoTurno(oc, turno) {
        if (!turno) return true;
        const faixa = FAIXAS_TURNO[turno];
        if (!faixa) return true;
        const horaStr = (oc.HORA || oc.hora || '').toString().trim();
        const m = horaStr.match(/^(\d{1,2})[h:]?(\d{0,2})/);
        if (!m) return true;
        const h = parseInt(m[1], 10);
        if (isNaN(h)) return true;
        if (turno === 'noite') return h >= faixa.ini || h <= faixa.fim;
        return h >= faixa.ini && h <= faixa.fim;
    }
    function classificarCrimeGeral(oc) {
        const tipGeral = (oc.TIPIFICACAO_GERAL || '').toString().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const tipific = (oc.TIPIFICACAO || oc.tipicidade || oc.natureza || '').toString().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const texto = tipGeral + ' ' + tipific;
        const cvliPal = ['HOMICIDIO', 'LATROCINIO', 'FEMINICIDIO', 'LESAO CORPORAL SEGUIDA',
            'LESAO CORPORAL COM RESULTADO MORTE', 'TENTATIVA DE HOMICIDIO',
            'CVLI', 'LETAL INTENCIONAL', 'TENTATIVA DE FEMINICIDIO', 'LATROCÍNIO TENTADO'];
        for (const p of cvliPal) { if (texto.includes(p)) return 'CVLI'; }
        const cvpPal = ['ROUBO', 'EXTORÇÃO', 'EXTORSÃO MEDIANTE SEQUESTRO', 'TENTATIVA DE ROUBO'];
        for (const p of cvpPal) { if (texto.includes(p)) return 'CVP'; }
        return null;
    }
    function resolverCoordenadas(oc, geoCidade) {
        const parseDec = v => parseFloat(String(v || '').replace(',', '.').trim());
        const lat = parseDec(oc.LATITUDE || oc.latitude || oc.lat || oc.Latitude);
        const lng = parseDec(oc.LONGITUDE || oc.longitude || oc.lng || oc.Longitude);
        if (!isNaN(lat) && !isNaN(lng) && lat >= -11.0 && lat <= -7.0 && lng >= -38.5 && lng <= -34.5) {
            return { lat, lng };
        }
        const disp = 0.003;
        return { lat: geoCidade.lat + (Math.random() - 0.5) * disp, lng: geoCidade.lng + (Math.random() - 0.5) * disp };
    }
    function montarLocal(oc) {
        const bairro = (oc.BAIRRO || oc.bairro || oc.Bairro || '').toString().trim();
        const logradouro = (oc.LOGRADOURO || oc.logradouro || oc.Logradouro || '').toString().trim();
        const cidade = (oc.CIDADE || oc.cidade || oc.Cidade || '').toString().trim();
        const pontRef = (oc['PONTO de REF.'] || oc.PONTO_REF || '').toString().trim();
        if (logradouro && bairro) return `${logradouro}, ${bairro}`;
        if (logradouro) return logradouro;
        if (bairro && pontRef) return `${bairro} (${pontRef})`;
        if (bairro) return bairro;
        if (cidade) return `Área central — ${cidade}`;
        return 'Local não informado';
    }

    function identificarHotspots(ocorrencias) {
        const raioAgrup = 0.008; // ~800m
        const grupos = [];
        ocorrencias.forEach(oc => {
            let achou = false;
            for (const g of grupos) {
                const dlat = g.lat - oc.lat, dlng = g.lng - oc.lng;
                if (Math.sqrt(dlat * dlat + dlng * dlng) < raioAgrup) {
                    g.ocorrencias.push(oc);
                    g.lat = (g.lat * (g.ocorrencias.length - 1) + oc.lat) / g.ocorrencias.length;
                    g.lng = (g.lng * (g.ocorrencias.length - 1) + oc.lng) / g.ocorrencias.length;
                    g.cvli += oc.tipo === 'CVLI' ? 1 : 0;
                    g.cvp += oc.tipo === 'CVP' ? 1 : 0;
                    achou = true;
                    break;
                }
            }
            if (!achou) grupos.push({ lat: oc.lat, lng: oc.lng, ocorrencias: [oc], cvp: oc.tipo === 'CVP' ? 1 : 0, cvli: oc.tipo === 'CVLI' ? 1 : 0, local: oc.local });
        });
        return grupos
            .map(g => {
                const freqCidade = {};
                g.ocorrencias.forEach(o => { if (o.cidade) freqCidade[o.cidade] = (freqCidade[o.cidade] || 0) + 1; });
                const cidadePredominante = Object.keys(freqCidade).length ? Object.entries(freqCidade).sort((a, b) => b[1] - a[1])[0][0] : '';
                return {
                    ...g, cidade: cidadePredominante, total: g.ocorrencias.length,
                    score: g.cvp + g.cvli * 2,
                    nivel: g.cvli >= 2 ? 'CRÍTICO' : g.cvli === 1 ? 'ALTO' : g.cvp >= 4 ? 'MÉDIO' : 'BAIXO',
                };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, 8);
    }

    function calcularTatica(hotspots, ocorrencias, periodo, cidade) {
        const cvliTotal = ocorrencias.filter(o => o.tipo === 'CVLI').length;
        const cvpTotal = ocorrencias.filter(o => o.tipo === 'CVP').length;
        const fatorRisco = cvliTotal * 2 + cvpTotal;
        const nivelGeral = cvliTotal >= 3 ? 'CRÍTICO' : cvliTotal >= 1 ? 'ALTO' : cvpTotal >= 5 ? 'MÉDIO' : 'BAIXO';
        const horariosPico = HORARIOS_PICO.filter(h => h.intensidade >= 0.7).map(h => `${h.faixa} (${h.turno})`);
        const tempoParada = { 'CRÍTICO': '15–20 min a cada passagem', 'ALTO': '10–15 min a cada passagem', 'MÉDIO': '08–10 min a cada passagem', 'BAIXO': '05–08 min a cada passagem' };

        let efetivoCidade = null;
        if (cidade && cidade !== '10ºBPM — ÁREA COMPLETA') {
            const rps = getRPsDaCidade(cidade);
            const isPalmeira = normalizarStr(cidade) === 'PALMEIRA DOS INDIOS';
            const reforcos = [];
            if (nivelGeral === 'CRÍTICO' || nivelGeral === 'ALTO') {
                if (isPalmeira) { const urbs = getTaticosUrbanos(); const qtd = nivelGeral === 'CRÍTICO' ? 2 : 1; urbs.slice(0, qtd).forEach(u => reforcos.push(u.label)); }
                const rurais = getTaticosRurais(); const qtdR = nivelGeral === 'CRÍTICO' ? 2 : 1; rurais.slice(0, qtdR).forEach(r => reforcos.push(r.label));
                if (nivelGeral === 'CRÍTICO') reforcos.push(criarFT(1).label);
            }
            efetivoCidade = { rps, reforcos, nivelGeral, isPalmeira };
        }

        const ftSugeridas = Math.min(FT_MAX, hotspots.filter(h => h.nivel === 'CRÍTICO' || h.nivel === 'ALTO').length || 1);
        return {
            ftSugeridas, horariosPico, tempoParada, fatorRisco, cvliTotal, cvpTotal, nivelGeral, efetivoCidade,
            viaturasSug: EFETIVO_TOTAL_VTR, pmSug: EFETIVO_SEM_OFICIAL, oficialSug: 1, ftHomens: ftSugeridas * FT_HOMENS_CADA,
        };
    }

    function gerarAlocacaoEfetivo(ranking) {
        const poolRurais = getTaticosRurais().map(e => ({ ...e, alocado: false }));
        const poolUrbanos = getTaticosUrbanos().map(e => ({ ...e, alocado: false }));
        let ftContador = 0;
        const resultado = [];
        const comOcorrencia = new Set();

        ranking.forEach((cid, i) => {
            const nomNorm = normalizarStr(cid.nome);
            comOcorrencia.add(nomNorm);
            const nivel = cid.cvli >= 2 ? 'CRÍTICO' : cid.cvli >= 1 ? 'ALTO' : cid.cvp >= 4 ? 'MÉDIO' : 'BAIXO';
            const rps = getRPsDaCidade(cid.nome);
            const guarLabel = rps.length ? rps.map(r => r.label).join(' + ') : `RP ${cid.nome}`;
            const reforcos = [];

            if (nivel === 'CRÍTICO' || nivel === 'ALTO') {
                const isPalmeira = nomNorm === 'PALMEIRA DOS INDIOS';
                if (isPalmeira) {
                    const qtdUrb = nivel === 'CRÍTICO' ? 2 : 1;
                    let cnt = 0;
                    for (const u of poolUrbanos) { if (!u.alocado && cnt < qtdUrb) { u.alocado = true; reforcos.push(u.label); cnt++; } }
                }
                const qtdRural = nivel === 'CRÍTICO' ? 2 : 1;
                let cntR = 0;
                for (const r of poolRurais) { if (!r.alocado && cntR < qtdRural) { r.alocado = true; reforcos.push(r.label); cntR++; } }
                const vagasNaoCobertas = qtdRural - cntR;
                const ftNeeds = (nivel === 'CRÍTICO' ? 1 : 0) + vagasNaoCobertas;
                for (let f = 0; f < ftNeeds; f++) { ftContador++; reforcos.push(criarFT(ftContador).label); }
            }
            resultado.push({ prioridade: i + 1, cidade: cid.nome, guarnicao: guarLabel, rps, reforcos, score: cid.score, cvp: cid.cvp, cvli: cid.cvli, total: cid.total, nivel });
        });

        CIDADES_10BPM.forEach(cid => {
            if (!comOcorrencia.has(normalizarStr(cid))) {
                const rps = getRPsDaCidade(cid);
                resultado.push({ prioridade: null, cidade: cid, guarnicao: rps.length ? rps.map(r => r.label).join(' + ') : `RP ${cid}`, rps, reforcos: [], score: 0, cvp: 0, cvli: 0, total: 0, nivel: 'NORMAL' });
            }
        });
        return resultado;
    }

    // ── Carregamento dos dados (própria cópia, sem depender de js/xerife.js) ──
    let DATABASE_URL = null;
    let promessaConfig = null;
    let cacheOcorrencias = null;
    async function garantirConfig() {
        if (DATABASE_URL) return;
        if (!promessaConfig) promessaConfig = P3.loadUnidadeConfig().then(cfg => { DATABASE_URL = cfg.firebase.databaseURL; });
        await promessaConfig;
    }
    async function buscarOcorrencias() {
        if (cacheOcorrencias) return cacheOcorrencias;
        await garantirConfig();
        const resp = await fetch(`${DATABASE_URL}/${NODE_OCORRENCIAS}.json`);
        const dados = resp.ok ? await resp.json() : null;
        cacheOcorrencias = dados ? Object.values(dados).filter(Boolean) : [];
        return cacheOcorrencias;
    }

    // ── Filtro + análise de UMA cidade — réplica de filtrarEAnalisar() ──
    function filtrarEAnalisarCidade(cacheOc, cidade, periodoDias, opts) {
        const comCVP = !opts || opts.comCVP !== false;
        const comCVLI = !opts || opts.comCVLI !== false;
        const turno = (opts && opts.turno) || '';

        const cidadeNorm = normalizarCidade(cidade);
        let geo = CIDADES_GEO[cidade];
        if (!geo) {
            const chave = Object.keys(CIDADES_GEO).find(k => normalizarCidade(k) === cidadeNorm || normalizarCidade(k).includes(cidadeNorm) || cidadeNorm.includes(normalizarCidade(k)));
            geo = chave ? CIDADES_GEO[chave] : { lat: -9.4092, lng: -36.6289, zoom: 13 };
        }

        const agora = new Date(); agora.setHours(23, 59, 59, 999);
        const dataInicio = new Date(agora); dataInicio.setDate(dataInicio.getDate() - periodoDias); dataInicio.setHours(0, 0, 0, 0);

        const ocorrenciasFiltradas = [];
        for (const oc of cacheOc) {
            const ocCidade = normalizarCidade(oc.CIDADE || oc.cidade || oc.Cidade || '');
            if (!ocCidade || ocCidade !== cidadeNorm) continue;
            const dtOc = parsearData(oc.DATA || oc.data || oc.Data || oc.dataOcorrencia || oc.data_ocorrencia || '');
            if (!dtOc || dtOc < dataInicio || dtOc > agora) continue;
            if (!passaNoTurno(oc, turno)) continue;
            const tipo = classificarCrimeGeral(oc);
            if (!tipo) continue;
            if (tipo === 'CVP' && !comCVP) continue;
            if (tipo === 'CVLI' && !comCVLI) continue;
            const coords = resolverCoordenadas(oc, geo);
            const local = montarLocal(oc);
            const natureza = (oc.TIPIFICACAO_GERAL || oc.TIPIFICACAO || oc.tipicidade || oc.natureza || tipo).toString().trim();
            ocorrenciasFiltradas.push({
                tipo, lat: coords.lat, lng: coords.lng, local, cidade: ocCidade,
                bairro: (oc.BAIRRO || oc.bairro || '').toString().trim(),
                logr: (oc.LOGRADOURO || oc.logradouro || '').toString().trim(),
                data: dtOc.toLocaleDateString('pt-BR'), hora: oc.HORA || oc.hora || '—',
                natureza, boletim: oc.BOLETIM || oc.boletim || '—',
                peso: tipo === 'CVLI' ? 0.95 : 0.55,
            });
        }

        const hotspots = identificarHotspots(ocorrenciasFiltradas);
        const tatica = calcularTatica(hotspots, ocorrenciasFiltradas, periodoDias, cidade);
        return { cidade, periodo: periodoDias, ocorrencias: ocorrenciasFiltradas, hotspots, tatica, geo };
    }

    // ── Análise da área completa do 10ºBPM — réplica de analisarAreaCompleta10BPM() ──
    function analisarAreaCompleta(cacheOc, periodoDias, opts) {
        const comCVP = !opts || opts.comCVP !== false;
        const comCVLI = !opts || opts.comCVLI !== false;
        const turno = (opts && opts.turno) || '';

        const agora = new Date(); agora.setHours(23, 59, 59, 999);
        const dataInicio = new Date(agora); dataInicio.setDate(dataInicio.getDate() - periodoDias); dataInicio.setHours(0, 0, 0, 0);

        const todasOcorrencias = [];
        const estatsPorCidade = {};
        CIDADES_10BPM.forEach(c => { estatsPorCidade[c] = { nome: c, cvp: 0, cvli: 0, total: 0, ocorrencias: [], score: 0 }; });

        for (const oc of cacheOc) {
            const ocNorm = normalizarCidade(oc.CIDADE || oc.cidade || '');
            const cidadeMatch = CIDADES_10BPM.find(c => normalizarCidade(c) === ocNorm || normalizarCidade(c).includes(ocNorm) || ocNorm.includes(normalizarCidade(c)));
            if (!cidadeMatch) continue;
            const dtOc = parsearData(oc.DATA || oc.data || '');
            if (!dtOc || dtOc < dataInicio || dtOc > agora) continue;
            if (!passaNoTurno(oc, turno)) continue;
            const tipo = classificarCrimeGeral(oc);
            if (!tipo) continue;
            if (tipo === 'CVP' && !comCVP) continue;
            if (tipo === 'CVLI' && !comCVLI) continue;
            const geo = CIDADES_GEO[cidadeMatch] || GEO_10BPM;
            const coords = resolverCoordenadas(oc, geo);
            const local = montarLocal(oc);
            const natureza = (oc.TIPIFICACAO_GERAL || oc.TIPIFICACAO || tipo).toString().trim();
            const ocObj = {
                tipo, lat: coords.lat, lng: coords.lng, local, cidade: cidadeMatch,
                bairro: (oc.BAIRRO || '').toString().trim(), logr: (oc.LOGRADOURO || '').toString().trim(),
                data: dtOc.toLocaleDateString('pt-BR'), hora: oc.HORA || oc.hora || '—',
                natureza, boletim: oc.BOLETIM || '—', peso: tipo === 'CVLI' ? 0.95 : 0.55,
            };
            todasOcorrencias.push(ocObj);
            estatsPorCidade[cidadeMatch].ocorrencias.push(ocObj);
            estatsPorCidade[cidadeMatch].total++;
            estatsPorCidade[cidadeMatch][tipo === 'CVLI' ? 'cvli' : 'cvp']++;
        }

        Object.values(estatsPorCidade).forEach(e => { e.score = e.cvli * 2 + e.cvp; });
        const rankingCidades = Object.values(estatsPorCidade).filter(e => e.total > 0).sort((a, b) => b.score - a.score);
        const hotspots = identificarHotspots(todasOcorrencias).slice(0, 10);
        const tatica = calcularTatica(hotspots, todasOcorrencias, periodoDias, '10ºBPM — ÁREA COMPLETA');
        const alocacao = gerarAlocacaoEfetivo(rankingCidades);

        return { cidade: '10ºBPM — ÁREA COMPLETA', periodo: periodoDias, ocorrencias: todasOcorrencias, hotspots, tatica, geo: GEO_10BPM, rankingCidades, alocacao };
    }

    // ── API pública ──────────────────────────────────────────────────
    async function analisarCidade(cidade, periodoDias, opts) {
        const cache = await buscarOcorrencias();
        return filtrarEAnalisarCidade(cache, cidade, periodoDias || 30, opts);
    }
    async function analisarArea(periodoDias, opts) {
        const cache = await buscarOcorrencias();
        return analisarAreaCompleta(cache, periodoDias || 30, opts);
    }

    window.OpoHotspotCore = {
        analisarCidade,
        analisarArea,
        CIDADES_10BPM,
        CIDADES_GEO,
    };
})();
