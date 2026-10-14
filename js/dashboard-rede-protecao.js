// ═══════════════════════════════════════════════════════════════════
// DASHBOARD P3 — ABA "REDE DE PROTEÇÃO / GRUPOS VULNERÁVEIS"
// ═══════════════════════════════════════════════════════════════════
// Pedido explícito do usuário: reproduzir no dashboard TODOS os dados
// solicitados pelo "Modelo Padronizado — Apresentação dos dados dos
// serviços da Rede de Proteção / Atendimentos às vítimas de violência"
// (Palmeira dos Índios/AL, jan–ago/2026), buscando no CAD o que faltar.
//
// Seções = slides do modelo:
//   1. Identificação do serviço          (texto editável, salvo no navegador)
//   2. Panorama geral (total, sexo, mês)
//   3. Distribuição por sexo
//   4. Faixa etária (faixas FIXAS do modelo: 0-6, 7-11, 12-17, 18-24, 25-29, 30-59, 60+)
//   5. Tipos de violência (múltipla resposta)
//   6. Vínculo do agressor com a vítima
//   7. Origem do acionamento ("serviço que encaminhou")
//   8. Território — zona urbana (bairros)
//   9. Território — zona rural (povoados/sítios/aldeias)
//  10. Síntese + necessidades da rede  (achados automáticos + texto editável)
//
// FONTE DOS DADOS: grade de ENVOLVIDOS do CAD (só linhas de VÍTIMA), via
// atualizador local (Python, tools/atualizador-local/cad_grades.py) ou,
// sem ele, Apps Script (apps-script/rastreamento.gs). O nó /pessoa do
// Firebase NÃO serve: guarda 1 pessoa por boletim e sem o tipo de
// envolvimento. O resultado da busca é gravado ANONIMIZADO em
// /rede_protecao_vitimas (sem nome, CPF, RG, mãe, telefone ou endereço
// da pessoa — orientação do próprio modelo: "não inserir nomes, iniciais,
// endereços ou outros dados que identifiquem vítimas"), pra que a aba
// funcione pra qualquer usuário depois de 1 busca, sem o atualizador.
// ═══════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    const FB_NO_VITIMAS = 'rede_protecao_vitimas';
    const FB_NO_META    = 'rede_protecao_meta';
    const GAS_CAD_URL   = 'https://script.google.com/macros/s/AKfycbwuyKpN4AbmV_CmQfZr2olClY1JveArwKEcJE3__DFf74xfnd3AlhXqnde7RPkXDlqx/exec';
    const LS_TEXTOS     = 'p3_rede_protecao_textos';

    const COR = {
        primaria: '#6a1b9a', fem: '#c2185b', masc: '#1565c0', ign: '#90a4ae',
        barras: '#7b1fa2', urbano: '#00838f', rural: '#558b2f',
    };

    const FAIXAS = ['0-6 anos', '7-11 anos', '12-17 anos', '18-24 anos', '25-29 anos', '30-59 anos', '60 anos ou mais'];
    const TIPOS_VIOLENCIA = ['Física', 'Doméstica', 'Autoprovocada', 'Psicológica/moral', 'Sexual',
        'Negligência/abandono', 'Financeira/econômica', 'Intervenção legal', 'Tortura', 'Trabalho infantil', 'Outros'];
    const VINCULOS = ['Própria pessoa*', 'Familiar / parceiro(a) íntimo(a)', 'Conhecido(a) com afinidade',
        'Sem afinidade / desconhecido(a)', 'Sem informação no CAD'];
    const ORIGENS = ['Acionamento direto à PM (190/COPOM/ronda)', 'APS/USF', 'UPA/Hospital', 'Assistência Social',
        'Conselho Tutelar', 'Educação', 'Segurança Pública (outros órgãos)', 'Justiça/MP/Defensoria', 'Sem informação'];

    // Identificação padrão (slide 2) — mesma fonte do gerador do PowerPoint.
    const IDENT = (window.RedeProtecaoPPTX && window.RedeProtecaoPPTX.IDENT_PADRAO) || {
        nome: '10º Batalhão de Polícia Militar (10º BPM)', orgao: 'SSP-AL — Polícia Militar de Alagoas',
        territorio: '11 municípios', responsavel: '1º TEN CALHEIROS', oquefazemos: '', porta: '', contato: '',
    };
    const URL_JSZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    const URL_PPTX_PREVIEW = 'https://cdn.jsdelivr.net/npm/pptx-preview@1.0.7/dist/pptx-preview.umd.js';

    let VITIMAS = [];      // registros anonimizados (Firebase /rede_protecao_vitimas)
    let META = null;
    let CARREGADO = false;
    let CHARTS_REDE = {};
    let ULTIMO = null;     // último agregado calculado (usado por CSV/impressão)

    // ── Utilitários ─────────────────────────────────────────────────
    const nrm = s => (s == null ? '' : String(s)).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
    const val = v => { const s = (v == null ? '' : String(v)).trim(); return (s === '---' || s === '—') ? '' : s; };
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const pct = (n, t) => t ? (n / t * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%' : '0,0%';
    const tem = (t, lista) => lista.some(p => t.includes(p));

    function parseData(s) {
        s = val(s).substring(0, 10);
        if (!s) return null;
        if (s.includes('/')) { const [d, m, a] = s.split('/'); return new Date(+a, +m - 1, +d); }
        if (s.includes('-')) { const [a, m, d] = s.split('-'); return new Date(+a, +m - 1, +d); }
        return null;
    }
    const isoDe = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    // Hash curto (FNV-1a) — pseudônimo da pessoa pra contar "pessoas
    // distintas" sem guardar o nome. Não é reversível na prática.
    function hash(str) {
        let h = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
        return h.toString(36);
    }

    function idade(rec) {
        const n = parseInt(val(rec.IDADE), 10);
        if (!isNaN(n) && n >= 0 && n < 120) return n;
        const nasc = parseData(rec.DATA_NASCIMENTO), ref = parseData(rec.DATA) || new Date();
        if (!nasc) return null;
        let a = ref.getFullYear() - nasc.getFullYear();
        if (ref.getMonth() < nasc.getMonth() || (ref.getMonth() === nasc.getMonth() && ref.getDate() < nasc.getDate())) a--;
        return (a >= 0 && a < 120) ? a : null;
    }

    function faixa(id) {
        if (id == null) return 'Ignorado';
        if (id <= 6) return FAIXAS[0];
        if (id <= 11) return FAIXAS[1];
        if (id <= 17) return FAIXAS[2];
        if (id <= 24) return FAIXAS[3];
        if (id <= 29) return FAIXAS[4];
        if (id <= 59) return FAIXAS[5];
        return FAIXAS[6];
    }

    function sexo(rec) {
        const s = nrm(rec.SEXO);
        if (s === 'F' || s.startsWith('FEM')) return 'Feminino';
        if (s === 'M' || s.startsWith('MASC')) return 'Masculino';
        return 'Outro/ignorado';
    }

    // ── Classificação: tipos de violência (múltipla resposta) ───────
    // Texto = tipificação + natureza + "(Se vítima) Tipo de agressão sofrida".
    function tiposViolencia(rec) {
        const t = nrm([rec.TIPIFICACAO, rec.NATUREZA, rec.TIPO_AGRESSAO].map(val).join(' | '));
        const id = rec._idade;
        const tipos = new Set();
        if (tem(t, ['SUICIDIO', 'AUTOLESAO', 'AUTO LESAO', 'AUTOPROVOCAD', 'AUTOEXTERMINIO', 'AUTO-EXTERMINIO', 'AUTO EXTERMINIO'])) tipos.add('Autoprovocada');
        if (tem(t, ['DOMESTIC', 'MARIA DA PENHA', 'CONTRA A MULHER', 'VIOLENCIA FAMILIAR', 'MEDIDA PROTETIVA', 'MEDIDAS PROTETIVAS'])) tipos.add('Doméstica');
        if (tem(t, ['LESAO CORPORAL', 'AGRESSAO', 'VIAS DE FATO', 'HOMICIDIO', 'FEMINICIDIO', 'ESPANCAMENTO', 'FISICA', 'LATROCINIO'])) tipos.add('Física');
        if (tem(t, ['AMEACA', 'INJURIA', 'CALUNIA', 'DIFAMACAO', 'PERSEGUICAO', 'STALKING', 'CONSTRANGIMENTO', 'PSICOLOGICA', 'MORAL', 'HUMILHACAO'])) tipos.add('Psicológica/moral');
        if (tem(t, ['ESTUPRO', 'IMPORTUNACAO SEXUAL', 'ASSEDIO SEXUAL', 'ATO LIBIDINOSO', 'ABUSO SEXUAL', 'EXPLORACAO SEXUAL', 'SEXUAL', 'PORNOGRAFIA', 'LIBIDINOS'])) tipos.add('Sexual');
        if (tem(t, ['ABANDONO', 'MAUS TRATOS', 'MAUS-TRATOS', 'MAUSTRATOS', 'NEGLIGENCIA', 'OMISSAO DE SOCORRO'])) tipos.add('Negligência/abandono');
        if (tem(t, ['PATRIMONIAL', 'FINANCEIRA', 'ECONOMICA', 'RETENCAO DE CARTAO'])
            || (id != null && id >= 60 && tem(t, ['APROPRIACAO', 'ESTELIONATO', 'EXTORSAO']))) tipos.add('Financeira/econômica');
        if (tem(t, ['INTERVENCAO LEGAL', 'INTERVENCAO POLICIAL', 'INTERVENCAO DE AGENTE', 'CONFRONTO COM'])) tipos.add('Intervenção legal');
        if (t.includes('TORTURA')) tipos.add('Tortura');
        if (t.includes('TRABALHO INFANTIL') || (id != null && id < 18 && t.includes('TRABALHO'))) tipos.add('Trabalho infantil');
        if (!tipos.size && (tem(t, ['SEQUESTRO', 'CARCERE PRIVADO', 'TRAFICO DE PESSOA', 'TRABALHO ANALOGO', 'VIOLENCIA', 'RACISMO', 'DISCRIMINACAO', 'RIXA'])
            || val(rec.TIPO_AGRESSAO))) tipos.add('Outros');
        return [...tipos];
    }

    function vinculo(rec) {
        if (rec._tipos.includes('Autoprovocada')) return VINCULOS[0];
        if (rec._tipos.includes('Doméstica')) return VINCULOS[1];
        const af = nrm(rec.AUTOR_AFINIDADE);
        if (af.includes('S')) return VINCULOS[2];
        if (af.includes('N')) return VINCULOS[3];
        return VINCULOS[4];
    }

    // "Serviço que encaminhou" — pra PM é a origem do acionamento, lida
    // do /geral do mesmo boletim (atendimento inicial, solicitante,
    // estabelecimento, texto do despachante).
    let _idxGeral = null;
    function origem(rec) {
        if (!_idxGeral) {
            _idxGeral = {};
            geralDisponivel().forEach(g => { const b = nrm(g.BOLETIM || g.id); if (b) _idxGeral[b] = g; });
        }
        const g = _idxGeral[nrm(rec.BOLETIM)];
        if (!g) return ORIGENS[8];
        const t = nrm([g.ATENDIMENTO_INICIAL, g.SOLICITANTE, g.ESTABELECIMENTO, g.TEXTO_DESPACHANTE].map(val).join(' | '));
        if (t.includes('CONSELHO TUTELAR')) return ORIGENS[4];
        if (tem(t, ['HOSPITAL', 'UPA ', ' UPA', 'SAMU', 'PRONTO SOCORRO', 'PRONTO-SOCORRO', 'MATERNIDADE'])) return ORIGENS[2];
        if (tem(t, ['USF', 'UBS', 'POSTO DE SAUDE', 'UNIDADE BASICA', 'SAUDE DA FAMILIA'])) return ORIGENS[1];
        if (tem(t, ['CRAS', 'CREAS', 'ASSISTENCIA SOCIAL', 'CENTRO POP'])) return ORIGENS[3];
        if (tem(t, ['ESCOLA', 'CRECHE', 'COLEGIO', 'EDUCACAO'])) return ORIGENS[5];
        if (tem(t, ['MINISTERIO PUBLICO', 'PROMOTORIA', 'FORUM', 'JUIZ', 'DEFENSORIA', 'OFICIAL DE JUSTICA', 'PODER JUDICIARIO'])) return ORIGENS[7];
        if (tem(t, ['DELEGACIA', 'POLICIA CIVIL', 'GUARDA MUNICIPAL', 'POLICIA FEDERAL', 'PRF', 'DEAM'])) return ORIGENS[6];
        return ORIGENS[0];
    }

    const RE_RURAL = /POVOADO|SITIO|ALDEIA|FAZENDA|ZONA RURAL|ASSENTAMENTO|AGROVILA|COLONIA|RURAL|CHACARA|RETIRO|LAGOA DO|SERRA D/;
    function territorio(rec) {
        const com = val(rec.COMUNIDADE), bai = val(rec.BAIRRO);
        if (com) return { zona: 'rural', local: com.toUpperCase() };
        if (bai && RE_RURAL.test(nrm(bai))) return { zona: 'rural', local: bai.toUpperCase() };
        return { zona: 'urbana', local: bai ? bai.toUpperCase() : 'NÃO INFORMADO' };
    }

    // ── Firebase ────────────────────────────────────────────────────
    // A aba roda em duas páginas: Dashboard P3 (FB_BASE e DADOS são `let`
    // globais de dashboard-p3.js — não viram window.*) e Dashboard Cruzado
    // (sem esses globais: base vem da config da unidade e /geral é baixado
    // aqui mesmo, ou reaproveitado do cache window._NODES_CACHE daquela página).
    let _fbBase = null, _geral = null;
    function base() {
        if (typeof FB_BASE !== 'undefined' && FB_BASE) return FB_BASE;
        return _fbBase;
    }
    function geralDisponivel() {
        if (typeof DADOS !== 'undefined' && DADOS && DADOS.geral && DADOS.geral.length) return DADOS.geral;
        if (window._NODES_CACHE && Array.isArray(window._NODES_CACHE.geral)) return window._NODES_CACHE.geral;
        return _geral || [];
    }
    async function carregarFirebase() {
        if (!base()) {
            const cfg = await P3.loadUnidadeConfig();
            _fbBase = cfg.firebase.databaseURL;
        }
        const [v, m] = await Promise.all([
            fetch(`${base()}/${FB_NO_VITIMAS}.json`).then(r => r.json()).catch(() => null),
            fetch(`${base()}/${FB_NO_META}.json`).then(r => r.json()).catch(() => null),
        ]);
        VITIMAS = v ? Object.keys(v).map(k => Object.assign({ _key: k }, v[k])) : [];
        META = m || null;
        if (VITIMAS.length && !geralDisponivel().length) {
            // Só pra "origem do acionamento" (atendimento inicial/solicitante do boletim).
            _geral = await fetch(`${base()}/geral.json`).then(r => r.json()).then(d => d ? Object.values(d) : []).catch(() => []);
        }
        CARREGADO = true;
    }

    async function gravarFirebase(registros, periodo) {
        const chaves = Object.keys(registros);
        for (let i = 0; i < chaves.length; i += 400) {
            const lote = {};
            chaves.slice(i, i + 400).forEach(k => { lote[k] = registros[k]; });
            const r = await fetch(`${base()}/${FB_NO_VITIMAS}.json`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lote),
            });
            if (!r.ok) throw new Error(`Firebase respondeu HTTP ${r.status} ao gravar as vítimas.`);
            status(`💾 Gravando no Firebase… ${Math.min(i + 400, chaves.length)}/${chaves.length}`);
        }
        const sessao = (window.P3 && P3.getSession) ? P3.getSession() : null;
        await fetch(`${base()}/${FB_NO_META}.json`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ultimaBusca: new Date().toISOString(),
                ultimoPeriodo: periodo,
                usuario: sessao ? `${sessao.graduacao || ''} ${sessao.nomeGuerra || ''}`.trim() : '',
            }),
        });
    }

    // ── Busca no CAD ────────────────────────────────────────────────
    async function buscarEnvolvidosCad(dataIni, dataFim) {
        if (window.P3AtualizadorLocal) {
            let ok = false;
            try { ok = await P3AtualizadorLocal.disponivel(); } catch (e) { ok = false; }
            if (ok) {
                try {
                    status('⏳ Buscando envolvidos no CAD via atualizador local…');
                    const r = await P3AtualizadorLocal.buscarGradeCad('envolvidos', dataIni, dataFim, evt =>
                        status(`⏳ CAD: página ${evt.pagina}/${evt.totalPaginas} — ${evt.registros} de ${evt.totalReal} envolvido(s)…`));
                    if (r) return r;
                } catch (e) {
                    console.warn('[rede-protecao] atualizador local falhou, tentando Apps Script:', e.message);
                    status(`⚠️ Atualizador local falhou (${e.message}) — tentando via Apps Script…`);
                }
            }
        }
        // Fallback: Apps Script, com retomada (mesmo mecanismo de cadastroocorrencias.js)
        const chamar = async params => {
            const qs = new URLSearchParams(Object.assign({ acao: 'envolvidos', dataIni, dataFim }, params)).toString();
            const txt = await (await fetch(`${GAS_CAD_URL}?${qs}`, { redirect: 'follow' })).text();
            try { return JSON.parse(txt); } catch (e) { throw new Error('Resposta do Apps Script não é JSON válido: ' + txt.substring(0, 200)); }
        };
        status('⏳ Buscando envolvidos no CAD via Apps Script (pode levar alguns minutos)…');
        let resp = await chamar({});
        if (resp.ok === false) throw new Error(resp.erro || 'falha na busca do CAD');
        const dados = resp.dados || [];
        let parte = 1;
        while (resp.truncado && resp.proximoOffset && parte < 8) {
            parte++;
            status(`⏳ CAD (Apps Script): parte ${parte} — ${dados.length} de ${resp.totalRelatadoPeloCAD || '?'}…`);
            resp = await chamar({ offsetInicial: String(resp.proximoOffset), totalConhecido: String(resp.totalRelatadoPeloCAD || ''), parte: String(parte) });
            if (resp.ok === false) break;
            dados.push(...(resp.dados || []));
        }
        return { ok: true, dados, truncado: !!resp.truncado, motivoTruncamento: resp.motivoTruncamento };
    }

    // Linhas do CAD -> registros ANONIMIZADOS (só vítimas), com a
    // afinidade declarada do(s) autor(es) do mesmo boletim anexada.
    function anonimizar(dadosCad) {
        const afinidadePorBoletim = {};
        dadosCad.forEach(it => {
            if (!nrm(it.ENVOLVIMENTO).includes('AUTOR')) return;
            const af = nrm(it.GRAU_AFINIDADE);
            if (!af) return;
            const b = String(it.BOLETIM);
            const marca = (af.startsWith('S')) ? 'S' : (af.startsWith('N') ? 'N' : '');
            if (marca) afinidadePorBoletim[b] = (afinidadePorBoletim[b] || '').includes('S') ? 'S' : marca;
        });
        const saida = {};
        dadosCad.forEach(it => {
            if (!it.BOLETIM || !nrm(it.ENVOLVIMENTO).includes('VITIMA')) return;
            const m = val(it.DATA).match(/^(\d{2}\/\d{2}\/\d{4})(?:\s+(\d{2}:\d{2}))?/);
            const pid = hash(nrm(it.NOME) + '|' + val(it.DATA_NASCIMENTO) + '|' + val(it.MAE ? nrm(it.MAE) : ''));
            const rec = {
                BOLETIM: String(it.BOLETIM),
                DATA: m ? m[1] : val(it.DATA),
                HORA: m && m[2] ? m[2] : '',
                CIDADE: val(it.CIDADE), BAIRRO: val(it.BAIRRO), COMUNIDADE: val(it.COMUNIDADE),
                SEXO: val(it.SEXO), IDADE: val(it.IDADE), DATA_NASCIMENTO: val(it.DATA_NASCIMENTO),
                NATUREZA: val(it.NATUREZA), TIPIFICACAO: val(it.TIPIFICACAO),
                TIPO_AGRESSAO: val(it.TIPO_AGRESSAO), LESIONADO: val(it.LESIONADO), OBITO: val(it.OBITO),
                ORIENTACAO_SEXUAL: val(it.ORIENTACAO_SEXUAL), IDENTIDADE_GENERO: val(it.IDENTIDADE_GENERO),
                COR_PELE: val(it.COR_PELE),
                AUTOR_AFINIDADE: afinidadePorBoletim[String(it.BOLETIM)] || '',
                PID: pid,
                importado_em: new Date().toISOString(),
            };
            // Idade calculada aqui e só ela gravada — a data de nascimento
            // é dado pessoal e não precisa sair do navegador.
            const id = idade(rec);
            rec.IDADE = id == null ? '' : String(id);
            delete rec.DATA_NASCIMENTO;
            saida[`${rec.BOLETIM}_${pid}`] = rec;
        });
        return saida;
    }

    async function buscarNoCad() {
        const sessao = (window.P3 && P3.getSession) ? P3.getSession() : null;
        if (!sessao || sessao.unidadeId !== '10bpm') {
            alert('A busca direta no CAD só está disponível pro 10º BPM (credenciais do CAD são desta unidade).');
            return;
        }
        const ini = document.getElementById('rp-ini').value, fim = document.getElementById('rp-fim').value;
        if (!ini || !fim) { alert('Informe o período (De / Até).'); return; }
        if (!confirm(`Buscar no CAD todas as vítimas registradas entre ${ini.split('-').reverse().join('/')} e ${fim.split('-').reverse().join('/')}?\n\nPode levar alguns minutos. Os dados são gravados no Firebase SEM nome, CPF, RG, telefone ou endereço da vítima.`)) return;
        let btn = document.getElementById('rp-btn-cad');
        btn.disabled = true;
        try {
            const r = await buscarEnvolvidosCad(ini, fim);
            if (!r || r.ok === false) throw new Error((r && r.erro) || 'busca no CAD falhou');
            const regs = anonimizar(r.dados || []);
            const n = Object.keys(regs).length;
            if (!n) { status(`ℹ️ O CAD não retornou vítimas nesse período (${(r.dados || []).length} envolvido(s) no total).`); return; }
            await gravarFirebase(regs, { ini, fim });
            await carregarFirebase();
            await window.renderRedeProtecao();
            status(`✅ ${n} vítima(s) importada(s) do CAD${r.truncado ? ' — ATENÇÃO: resultado parcial (' + (r.motivoTruncamento || 'truncado') + ')' : ''}.`);
        } catch (e) {
            console.error('[rede-protecao]', e);
            status(`❌ ${e.message}`);
            alert('Falha ao buscar no CAD: ' + e.message);
        } finally {
            btn = document.getElementById('rp-btn-cad'); // pode ter sido recriado pelo re-render
            if (btn) btn.disabled = false;
        }
    }

    function status(txt) { const el = document.getElementById('rp-status'); if (el) el.textContent = txt; }

    // ── Agregação ───────────────────────────────────────────────────
    function filtrar() {
        const ini = parseData(document.getElementById('rp-ini')?.value);
        const fim = parseData(document.getElementById('rp-fim')?.value);
        const cid = document.getElementById('rp-cidade')?.value || '';
        const soViolencia = document.getElementById('rp-so-violencia')?.checked !== false;
        _idxGeral = null;
        const base = VITIMAS.filter(r => {
            const d = parseData(r.DATA);
            if (ini && (!d || d < ini)) return false;
            if (fim && (!d || d > fim)) return false;
            if (cid && nrm(r.CIDADE) !== cid) return false;
            return true;
        }).map(r => {
            const o = Object.assign({}, r);
            o._idade = idade(o);
            o._tipos = tiposViolencia(o);
            return o;
        });
        const dentro = soViolencia ? base.filter(r => r._tipos.length) : base;
        return { lista: dentro, foraDoEscopo: base.length - dentro.length, ini, fim, cid };
    }

    function contar(lista, fn, ordem) {
        const c = {};
        (ordem || []).forEach(k => { c[k] = 0; });
        lista.forEach(r => { [].concat(fn(r)).forEach(k => { if (k != null) c[k] = (c[k] || 0) + 1; }); });
        return c;
    }
    const topN = (obj, n) => Object.entries(obj).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, n);

    function agregar() {
        const f = filtrar();
        const L = f.lista;
        const total = L.length;
        const pessoas = new Set(L.map(r => r.PID || r._key)).size;
        const porSexo = contar(L, sexo, ['Feminino', 'Masculino', 'Outro/ignorado']);
        const porFaixa = contar(L, r => faixa(r._idade), FAIXAS.concat('Ignorado'));
        const porTipo = contar(L, r => r._tipos.length ? r._tipos : ['Outros'], TIPOS_VIOLENCIA);
        L.forEach(r => { r._tipos = r._tipos.length ? r._tipos : ['Outros']; });
        const porVinculo = contar(L, vinculo, VINCULOS);
        const porOrigem = contar(L, origem, ORIGENS);
        const terr = L.map(territorio);
        const urbano = contar(terr.filter(t => t.zona === 'urbana'), t => t.local);
        const rural = contar(terr.filter(t => t.zona === 'rural'), t => t.local);

        // Mês a mês dentro do período (até 12 meses, como o gráfico do modelo)
        const meses = [];
        const ini = f.ini || (L.length ? L.map(r => parseData(r.DATA)).filter(Boolean).sort((a, b) => a - b)[0] : new Date());
        const fim = f.fim || new Date();
        for (let d = new Date(ini.getFullYear(), ini.getMonth(), 1); d <= fim && meses.length < 24; d.setMonth(d.getMonth() + 1)) {
            meses.push({ chave: `${d.getFullYear()}-${d.getMonth()}`, rotulo: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '') + (ini.getFullYear() !== fim.getFullYear() ? '/' + String(d.getFullYear()).slice(2) : '') });
        }
        const porMes = {};
        meses.forEach(m => { porMes[m.chave] = 0; });
        L.forEach(r => { const d = parseData(r.DATA); if (d) { const k = `${d.getFullYear()}-${d.getMonth()}`; if (k in porMes) porMes[k]++; } });

        const grupos = {
            mulheres: porSexo['Feminino'],
            criancas: L.filter(r => r._idade != null && r._idade <= 11).length,
            adolescentes: L.filter(r => r._idade != null && r._idade >= 12 && r._idade <= 17).length,
            idosos: L.filter(r => r._idade != null && r._idade >= 60).length,
            lgbt: L.filter(r => {
                const o = nrm(r.ORIENTACAO_SEXUAL), g = nrm(r.IDENTIDADE_GENERO);
                return (o && !tem(o, ['HETERO', 'NAO INFORM', 'IGNORAD', 'NAO SE APLICA', 'PREFERE NAO'])) ||
                       (g && !tem(g, ['CIS', 'NAO INFORM', 'IGNORAD', 'NAO SE APLICA', 'PREFERE NAO']));
            }).length,
            lesionados: L.filter(r => nrm(r.LESIONADO).startsWith('S')).length,
            obitos: L.filter(r => nrm(r.OBITO).startsWith('S')).length,
        };
        ULTIMO = { f, total, pessoas, porSexo, porFaixa, porTipo, porVinculo, porOrigem, urbano, rural, meses, porMes, grupos,
                   totalUrbano: terr.filter(t => t.zona === 'urbana').length, totalRural: terr.filter(t => t.zona === 'rural').length };
        return ULTIMO;
    }

    // ── Render ──────────────────────────────────────────────────────
    function montarEstrutura(cont) {
        const textos = lerTextos();
        const cidades = [...new Set(VITIMAS.map(r => nrm(r.CIDADE)).filter(Boolean))].sort();
        const cidadePadrao = cidades.find(c => c.includes('PALMEIRA DOS INDIOS')) || '';
        const anoRef = 2026;
        cont.innerHTML = `
        <div class="rp-wrap">
            <div class="rp-barra">
                <div class="rp-barra-linha">
                    <i class="fas fa-hands-helping" style="color:${COR.primaria};"></i>
                    <strong>Rede de Proteção às Vítimas de Violência</strong>
                    <label>De: <input type="date" id="rp-ini" value="${anoRef}-01-01"></label>
                    <label>Até: <input type="date" id="rp-fim" value="${anoRef}-08-31"></label>
                    <label>Cidade:
                        <select id="rp-cidade">
                            <option value="">Todas (área do 10º BPM)</option>
                            ${cidades.map(c => `<option value="${esc(c)}"${c === cidadePadrao ? ' selected' : ''}>${esc(c)}</option>`).join('')}
                        </select>
                    </label>
                    <label title="Desmarque para incluir vítimas de qualquer ocorrência (furto, acidente etc.)">
                        <input type="checkbox" id="rp-so-violencia" checked> Só violência
                    </label>
                </div>
                <div class="rp-barra-linha">
                    <button id="rp-btn-cad" class="rp-btn rp-btn-cad" title="Busca a grade de envolvidos do CAD (só vítimas) no período e grava no Firebase, anonimizada">
                        <i class="fas fa-download"></i> Buscar vítimas no CAD
                    </button>
                    <button class="rp-btn rp-btn-ppt" onclick="visualizarRedeProtecaoPPTX()" title="Abre a apresentação no modelo padronizado da Rede, já preenchida">
                        <i class="fas fa-desktop"></i> Visualizar apresentação</button>
                    <button class="rp-btn rp-btn-ppt" onclick="baixarRedeProtecaoPPTX()" title="Baixa o arquivo .pptx (modelo padronizado da Rede, gráficos editáveis)">
                        <i class="fas fa-file-powerpoint"></i> Salvar em PowerPoint</button>
                    <button class="rp-btn" onclick="exportarRedeProtecaoCSV()"><i class="fas fa-file-csv"></i> Exportar CSV</button>
                    <button class="rp-btn" onclick="imprimirRedeProtecao()"><i class="fas fa-print"></i> Imprimir / PDF</button>
                    <span id="rp-status" class="rp-status">${META && META.ultimaBusca
                        ? `Última busca no CAD: ${new Date(META.ultimaBusca).toLocaleString('pt-BR')}${META.ultimoPeriodo ? ` (período ${META.ultimoPeriodo.ini.split('-').reverse().join('/')} a ${META.ultimoPeriodo.fim.split('-').reverse().join('/')})` : ''}${META.usuario ? ' por ' + esc(META.usuario) : ''} · ${VITIMAS.length} vítima(s) na base`
                        : 'Nenhuma vítima importada ainda — clique em "Buscar vítimas no CAD".'}</span>
                </div>
            </div>

            <div class="rp-secao">1. Identificação do serviço <span class="rp-secao-obs">(vai para o slide 2 da apresentação)</span></div>
            <div class="rp-ident">
                ${campoTexto('nome', 'Nome do serviço', textos.nome || IDENT.nome)}
                ${campoTexto('orgao', 'Órgão / Secretaria', textos.orgao || IDENT.orgao)}
                ${campoTexto('territorio', 'Território', textos.territorio || IDENT.territorio, true)}
                ${campoTexto('responsavel', 'Responsável', textos.responsavel || IDENT.responsavel)}
                ${campoTexto('oquefazemos', 'O que fazemos', textos.oquefazemos || IDENT.oquefazemos, true)}
                ${campoTexto('porta', 'Porta de entrada', textos.porta || IDENT.porta)}
                ${campoTexto('contato', 'Contato institucional', textos.contato || IDENT.contato, false, 'Telefone • e-mail • endereço • horário')}
            </div>

            <div id="rp-corpo"></div>

            <div class="rp-secao">Botão do Pânico — Patrulha Maria da Penha (IRIS PMAL) <span class="rp-secao-obs">Palmeira dos Índios · período selecionado acima</span></div>
            <div id="rp-panico"></div>

            <div class="rp-secao">10. Síntese do serviço e necessidades da rede</div>
            <div class="rp-sintese">
                <div class="rp-card"><div class="rp-card-tit">Principais achados (automático)</div><ul id="rp-achados" class="rp-achados"></ul></div>
                ${campoTexto('fragilidades', 'Fragilidades identificadas', textos.fragilidades || '', true, 'Subnotificação, fluxo, acesso, registro, retorno…')}
                ${campoTexto('acoes', 'Ações já realizadas', textos.acoes || '', true, 'Ações do serviço no período…')}
                ${campoTexto('propostas', 'Necessidades / propostas', textos.propostas || '', true, 'O que o serviço propõe à rede para os próximos meses…')}
            </div>
            <div class="rp-nota">
                <b>Padronização (modelo da Rede):</b> unidade de medida = <b>vítimas registradas em ocorrências da PM</b> (uma mesma pessoa pode aparecer em mais de uma ocorrência — ver "pessoas distintas");
                faixas etárias fixas do modelo; tipos de violência admitem múltipla resposta; "sem informação/ignorado" não é redistribuído;
                nenhum nome, iniciais ou endereço de vítima é exibido. <b>Fonte:</b> CAD/SISP — grade de envolvidos (tipo de envolvimento = VÍTIMA), 10º BPM.
            </div>
        </div>`;

        ['rp-ini', 'rp-fim', 'rp-cidade', 'rp-so-violencia'].forEach(id =>
            document.getElementById(id).addEventListener('change', renderCorpo));
        document.getElementById('rp-btn-cad').addEventListener('click', buscarNoCad);
        cont.querySelectorAll('[data-rp-texto]').forEach(el => el.addEventListener('input', () => {
            const t = lerTextos(); t[el.dataset.rpTexto] = el.value; salvarTextos(t);
        }));
    }

    function campoTexto(chave, rotulo, valor, grande, placeholder) {
        const tag = grande
            ? `<textarea data-rp-texto="${chave}" rows="3" placeholder="${esc(placeholder || '')}">${esc(valor)}</textarea>`
            : `<input type="text" data-rp-texto="${chave}" value="${esc(valor)}" placeholder="${esc(placeholder || '')}">`;
        return `<label class="rp-campo${grande ? ' rp-campo-grande' : ''}"><span>${esc(rotulo)}</span>${tag}</label>`;
    }
    function lerTextos() { try { return JSON.parse(localStorage.getItem(LS_TEXTOS) || '{}') || {}; } catch (e) { return {}; } }
    function salvarTextos(t) { try { localStorage.setItem(LS_TEXTOS, JSON.stringify(t)); } catch (e) { /* sem storage */ } }

    function kpi(rot, n, sub, cor) {
        return `<div class="rp-kpi" style="border-top-color:${cor};"><div class="rp-kpi-rot">${rot}</div>
            <div class="rp-kpi-n" style="color:${cor};">${n.toLocaleString('pt-BR')}</div><div class="rp-kpi-sub">${sub || ''}</div></div>`;
    }

    function cardGrafico(id, titulo, sub, destaqueHtml, alto) {
        return `<div class="chart-card rp-chart-card">
            <div class="chart-header"><div><div class="chart-title">${titulo}</div><div class="chart-sub">${sub}</div></div></div>
            ${destaqueHtml ? `<div class="rp-destaques">${destaqueHtml}</div>` : ''}
            <div class="chart-wrap${alto ? ' tall' : ''}"><canvas id="${id}"></canvas></div>
        </div>`;
    }
    const destaque = (rot, txt) => `<div class="rp-dest"><span>${rot}</span><b>${txt}</b></div>`;

    function renderCorpo() {
        Object.values(CHARTS_REDE).forEach(c => { try { c.destroy(); } catch (e) { } });
        CHARTS_REDE = {};
        const corpo = document.getElementById('rp-corpo');
        if (!corpo) return;
        atualizarPanico();
        if (!VITIMAS.length) {
            corpo.innerHTML = `<div class="rp-vazio"><i class="fas fa-database"></i>
                Ainda não há vítimas importadas. Clique em <b>"Buscar vítimas no CAD"</b> (com o atualizador local aberto, ou via Apps Script).</div>`;
            document.getElementById('rp-achados').innerHTML = '';
            return;
        }
        const A = agregar();
        const T = A.total;
        const topTipo = topN(A.porTipo, 1)[0];
        const vinc = topN(Object.fromEntries(Object.entries(A.porVinculo).filter(([k]) => k !== VINCULOS[4])), 3);
        const orig = topN(Object.fromEntries(Object.entries(A.porOrigem).filter(([k]) => k !== ORIGENS[8])), 2);
        const topBairro = topN(A.urbano, 1)[0];
        const topLocal = topN(A.rural, 1)[0];

        corpo.innerHTML = `
            <div class="rp-secao">2. Panorama geral das vítimas atendidas</div>
            <div class="rp-kpis">
                ${kpi('Total de vítimas', T, `${A.pessoas.toLocaleString('pt-BR')} pessoa(s) distinta(s)`, COR.primaria)}
                ${kpi('Feminino', A.porSexo['Feminino'], pct(A.porSexo['Feminino'], T), COR.fem)}
                ${kpi('Masculino', A.porSexo['Masculino'], pct(A.porSexo['Masculino'], T), COR.masc)}
                ${kpi('Outro / ign.', A.porSexo['Outro/ignorado'], pct(A.porSexo['Outro/ignorado'], T), COR.ign)}
            </div>
            <div class="rp-sub-secao">Grupos vulneráveis</div>
            <div class="rp-kpis">
                ${kpi('Mulheres', A.grupos.mulheres, pct(A.grupos.mulheres, T), COR.fem)}
                ${kpi('Crianças (0–11)', A.grupos.criancas, pct(A.grupos.criancas, T), '#ef6c00')}
                ${kpi('Adolescentes (12–17)', A.grupos.adolescentes, pct(A.grupos.adolescentes, T), '#f9a825')}
                ${kpi('Pessoas idosas (60+)', A.grupos.idosos, pct(A.grupos.idosos, T), '#5d4037')}
                ${kpi('LGBTQIA+ (declarado)', A.grupos.lgbt, pct(A.grupos.lgbt, T), '#00897b')}
                ${kpi('Lesionadas', A.grupos.lesionados, pct(A.grupos.lesionados, T), '#c62828')}
                ${kpi('Óbitos', A.grupos.obitos, pct(A.grupos.obitos, T), '#212121')}
            </div>
            ${A.f.foraDoEscopo ? `<div class="rp-nota-peq">${A.f.foraDoEscopo} vítima(s) de ocorrências sem relação com violência (furto, acidente etc.) ficaram fora — desmarque "Só violência" para incluí-las.</div>` : ''}
            <div class="charts-grid">
                ${cardGrafico('rp-ch-mes', 'Vítimas por mês', 'Total registrado no período', '', false)}
                ${cardGrafico('rp-ch-sexo', '3. Distribuição por sexo', 'n e % — classificação do CAD',
                    destaque('Feminino', `${A.porSexo['Feminino']} · ${pct(A.porSexo['Feminino'], T)}`) +
                    destaque('Masculino', `${A.porSexo['Masculino']} · ${pct(A.porSexo['Masculino'], T)}`) +
                    destaque('Outro/ignorado', `${A.porSexo['Outro/ignorado']} · ${pct(A.porSexo['Outro/ignorado'], T)}`), false)}
                ${cardGrafico('rp-ch-faixa', '4. Faixa etária das vítimas', 'Faixas padronizadas do modelo da Rede', '', false)}
                ${cardGrafico('rp-ch-tipo', '5. Tipos de violência', 'Múltipla resposta — a soma pode passar do total de vítimas',
                    topTipo ? destaque('Tipo mais frequente', `${topTipo[0]} · ${topTipo[1]} (${pct(topTipo[1], T)})`) : '', true)}
                ${cardGrafico('rp-ch-vinc', '6. Vínculo do agressor com a vítima', 'CAD: violência doméstica + "autor possui afinidade com a vítima?"',
                    vinc.map((v, i) => destaque(`${i + 1}º`, `${v[0]} · ${v[1]}`)).join(''), true)}
                ${cardGrafico('rp-ch-orig', '7. Origem do acionamento', 'Como a ocorrência chegou à PM (atendimento inicial/solicitante no CAD)',
                    (orig[0] ? destaque('Principal origem', `${orig[0][0]} · ${orig[0][1]}`) : '') +
                    (orig[1] ? destaque('2ª origem', `${orig[1][0]} · ${orig[1][1]}`) : '') +
                    destaque('Sem informação', `${A.porOrigem[ORIGENS[8]]} · ${pct(A.porOrigem[ORIGENS[8]], T)}`), true)}
                ${cardGrafico('rp-ch-urb', `8. Território — zona urbana (${A.totalUrbano})`, 'Bairro da ocorrência',
                    topBairro ? destaque('Bairro com mais registros', `${topBairro[0]} · ${topBairro[1]}`) : '', true)}
                ${cardGrafico('rp-ch-rur', `9. Território — zona rural (${A.totalRural})`, 'Povoados, sítios, aldeias e comunidades',
                    topLocal ? destaque('Localidade com mais registros', `${topLocal[0]} · ${topLocal[1]}`) : '', true)}
            </div>
            <details class="rp-tabelas">
                <summary><i class="fas fa-table"></i> Tabelas completas (n e %) — para copiar para a apresentação</summary>
                <div class="rp-tabelas-grid">
                    ${tabela('Sexo', A.porSexo, T)}
                    ${tabela('Faixa etária', A.porFaixa, T)}
                    ${tabela('Tipos de violência', A.porTipo, T)}
                    ${tabela('Vínculo do agressor', A.porVinculo, T)}
                    ${tabela('Origem do acionamento', A.porOrigem, T)}
                    ${tabela('Zona urbana — bairros', ordenar(A.urbano), A.totalUrbano)}
                    ${tabela('Zona rural — localidades', ordenar(A.rural), A.totalRural)}
                </div>
            </details>`;

        const mesesLbl = A.meses.map(m => m.rotulo), mesesVal = A.meses.map(m => A.porMes[m.chave]);
        grafico('rp-ch-mes', 'bar', mesesLbl, mesesVal, COR.primaria);
        grafico('rp-ch-sexo', 'doughnut', Object.keys(A.porSexo), Object.values(A.porSexo), [COR.fem, COR.masc, COR.ign]);
        grafico('rp-ch-faixa', 'bar', Object.keys(A.porFaixa), Object.values(A.porFaixa), '#ef6c00');
        grafico('rp-ch-tipo', 'barH', Object.keys(A.porTipo), Object.values(A.porTipo), COR.barras);
        grafico('rp-ch-vinc', 'barH', Object.keys(A.porVinculo), Object.values(A.porVinculo), '#ad1457');
        grafico('rp-ch-orig', 'barH', Object.keys(A.porOrigem), Object.values(A.porOrigem), '#283593');
        const urb = comDemais(A.urbano, 10), rur = comDemais(A.rural, 10);
        grafico('rp-ch-urb', 'barH', urb.map(x => x[0]), urb.map(x => x[1]), COR.urbano);
        grafico('rp-ch-rur', 'barH', rur.map(x => x[0]), rur.map(x => x[1]), COR.rural);

        // Achados automáticos (slide 10)
        const achados = [];
        achados.push(`${T} vítima(s) registradas no período (${A.pessoas} pessoa(s) distinta(s)); ${pct(A.porSexo['Feminino'], T)} do sexo feminino.`);
        if (topTipo) achados.push(`Tipo de violência mais frequente: ${topTipo[0]} (${topTipo[1]} — ${pct(topTipo[1], T)}).`);
        const topFaixa = topN(Object.fromEntries(Object.entries(A.porFaixa).filter(([k]) => k !== 'Ignorado')), 1)[0];
        if (topFaixa) achados.push(`Faixa etária mais atingida: ${topFaixa[0]} (${topFaixa[1]}). Crianças e adolescentes: ${A.grupos.criancas + A.grupos.adolescentes}; pessoas idosas: ${A.grupos.idosos}.`);
        if (topBairro) achados.push(`Zona urbana: maior concentração em ${topBairro[0]} (${topBairro[1]}).`);
        if (topLocal) achados.push(`Zona rural: maior concentração em ${topLocal[0]} (${topLocal[1]}).`);
        const semVinc = A.porVinculo[VINCULOS[4]];
        if (semVinc) achados.push(`${pct(semVinc, T)} dos registros sem informação de vínculo com o agressor no CAD — ponto de melhoria no registro.`);
        document.getElementById('rp-achados').innerHTML = achados.map(a => `<li>${esc(a)}</li>`).join('');
        ULTIMO.achados = achados;
        if (_panico.chave === chavePanico() && _panico.dados) ULTIMO.panico = _panico.dados;
    }

    const ordenar = obj => Object.fromEntries(Object.entries(obj).sort((a, b) => b[1] - a[1]));
    function comDemais(obj, n) {
        const ord = Object.entries(obj).sort((a, b) => b[1] - a[1]);
        if (ord.length <= n) return ord;
        const resto = ord.slice(n).reduce((s, x) => s + x[1], 0);
        return ord.slice(0, n).concat([[`Demais (${ord.length - n})`, resto]]);
    }

    function tabela(titulo, obj, total) {
        const linhas = Object.entries(obj).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="rp-num">${v}</td><td class="rp-num">${pct(v, total)}</td></tr>`).join('');
        return `<div><div class="rp-tab-tit">${esc(titulo)}</div><table class="cruzamento-table">
            <thead><tr><th>Categoria</th><th class="rp-num">n</th><th class="rp-num">%</th></tr></thead>
            <tbody>${linhas || '<tr><td colspan="3">—</td></tr>'}</tbody></table></div>`;
    }

    function grafico(id, tipo, labels, data, cor) {
        const el = document.getElementById(id);
        if (!el || typeof Chart === 'undefined') return;
        const horizontal = tipo === 'barH';
        const plugins = window.ChartDataLabels ? [window.ChartDataLabels] : [];
        if (horizontal) el.parentElement.style.height = Math.max(220, labels.length * 26 + 40) + 'px';
        CHARTS_REDE[id] = new Chart(el, {
            type: tipo === 'doughnut' ? 'doughnut' : 'bar',
            data: { labels, datasets: [{ label: 'Vítimas', data, backgroundColor: cor, borderRadius: tipo === 'doughnut' ? 0 : 4 }] },
            plugins,
            options: {
                indexAxis: horizontal ? 'y' : 'x',
                responsive: true, maintainAspectRatio: false,
                animation: { duration: 300 },
                plugins: {
                    legend: { display: tipo === 'doughnut', position: 'bottom' },
                    datalabels: {
                        color: tipo === 'doughnut' ? '#fff' : '#37474f',
                        anchor: tipo === 'doughnut' ? 'center' : 'end',
                        align: tipo === 'doughnut' ? 'center' : (horizontal ? 'right' : 'top'),
                        font: { weight: 'bold', size: 11 },
                        formatter: v => v > 0 ? v : '',
                    },
                },
                scales: tipo === 'doughnut' ? {} : {
                    x: { beginAtZero: true, grid: { display: !horizontal ? false : true }, ticks: { precision: 0 } },
                    y: { beginAtZero: true, grid: { display: horizontal ? false : true }, ticks: { precision: 0, autoSkip: false } },
                },
                layout: { padding: { right: horizontal ? 28 : 0, top: horizontal ? 0 : 18 } },
            },
        });
    }

    // ── Botão do Pânico (IRIS PMAL) ─────────────────────────────────
    // Dados do aplicativo Íris PMAL (Patrulha Maria da Penha), via API do
    // próprio Íris (js/core/iris-panico-client.js, token do login integrado).
    // Pedido explícito: SEMPRE de Palmeira dos Índios, no período da aba.
    // Cidade de cada registro: campo próprio (acionamentos) ou a cidade da
    // assistida vinculada (assistida_id / firebase_key) — mesma regra do
    // dashboard do próprio Íris (dashboard_mysql.js:_cidadeAcio).
    const CIDADE_PANICO = 'PALMEIRA DOS INDIOS';
    const CIDADE_PANICO_TXT = 'Palmeira dos Índios';
    const GRAUS = ['BAIXO', 'MÉDIO', 'ALTO', 'GRAVE', 'Não avaliado'];
    let _irisBrutos = null, _irisCarregando = null;
    let _panico = { chave: null, dados: null, erro: null };
    let CHARTS_PANICO = {};

    function periodoAba() {
        const ini = parseData(document.getElementById('rp-ini')?.value);
        const f = parseData(document.getElementById('rp-fim')?.value);
        const fim = f ? new Date(f.getFullYear(), f.getMonth(), f.getDate(), 23, 59, 59) : null;
        return { ini, fim };
    }
    const chavePanico = () => (document.getElementById('rp-ini')?.value || '') + '|' + (document.getElementById('rp-fim')?.value || '');

    function carregarIris() {
        if (_irisBrutos) return Promise.resolve(_irisBrutos);
        if (_irisCarregando) return _irisCarregando;
        if (!window.IrisPanico) return Promise.reject(new Error('Cliente do Íris não carregado.'));
        if (!IrisPanico.temToken()) { const e = new Error('Sem acesso ao Íris PMAL nesta sessão.'); e.semToken = true; return Promise.reject(e); }
        _irisCarregando = Promise.all(['assistidas', 'fiscalizacao', 'avaliacao', 'acionamentos'].map(t => IrisPanico.listarTabela(t)))
            .then(([assistidas, fiscalizacao, avaliacao, acionamentos]) => (_irisBrutos = { assistidas, fiscalizacao, avaliacao, acionamentos }))
            .catch(e => { if (/sem acesso/i.test(e.message)) e.semToken = true; throw e; })
            .finally(() => { _irisCarregando = null; });
        return _irisCarregando;
    }

    // "AAAA-MM-DD HH:MM:SS" (MySQL) → Date com hora (parseData só pega a data).
    const dataHora = v => { const s = String(v || '').trim(); if (!s) return null; const d = new Date(s.replace(' ', 'T')); return isNaN(d) ? null : d; };

    function resumirPanico(B, ini, fim) {
        const cidAssist = {};
        B.assistidas.forEach(a => {
            const c = nrm(a.cidade);
            if (a.id != null) cidAssist['id:' + a.id] = c;
            if (a.firebase_key) cidAssist['fb:' + a.firebase_key] = c;
        });
        const cidadeDe = r => nrm(r.cidade) || cidAssist['id:' + r.assistida_id] || cidAssist['fb:' + r.assistida_key_fb]
            || cidAssist['id:' + r.assistida_key_fb] || cidAssist['fb:' + r.firebase_key] || '';
        const ehDaCidade = r => cidadeDe(r).includes(CIDADE_PANICO);
        const dataDe = (r, campos) => { for (const c of campos) { const d = parseData(r[c]); if (d) return d; } return null; };
        const noPeriodo = d => !!d && (!ini || d >= ini) && (!fim || d <= fim);

        const assist = B.assistidas.filter(a => nrm(a.cidade).includes(CIDADE_PANICO));
        const ativas = assist.filter(a => nrm(a.status) === 'ATIVO');
        const grau = {}; GRAUS.forEach(g => { grau[g] = 0; });
        ativas.forEach(a => { const g = GRAUS.find(x => nrm(x) === nrm(a.grau_risco)) || 'Não avaliado'; grau[g]++; });

        const CAMPOS = { fisc: ['data_fiscalizacao'], aval: ['data_visita', 'timestamp_iso', 'data_avaliacao_risco'], acio: ['data_hora_acio', 'timestamp_iso'] };
        const fisc = B.fiscalizacao.filter(r => ehDaCidade(r) && noPeriodo(dataDe(r, CAMPOS.fisc)));
        const aval = B.avaliacao.filter(r => ehDaCidade(r) && noPeriodo(dataDe(r, CAMPOS.aval)));
        const acio = B.acionamentos.filter(r => ehDaCidade(r) && noPeriodo(dataDe(r, CAMPOS.acio)));

        const statusAcio = {};
        acio.forEach(r => { const st = (r.status || 'NÃO INFORMADO').toString().toUpperCase(); statusAcio[st] = (statusAcio[st] || 0) + 1; });
        const tempos = acio.map(r => {
            const a = dataHora(r.data_hora_acio), b = dataHora(r.data_hora_resposta);
            return a && b ? (b - a) / 60000 : null;
        }).filter(m => m != null && m >= 0 && m < 24 * 60);

        // Série mensal (meses do período, até 24)
        const meses = [];
        const i0 = ini || new Date(new Date().getFullYear(), 0, 1), f0 = fim || new Date();
        for (let d = new Date(i0.getFullYear(), i0.getMonth(), 1); d <= f0 && meses.length < 24; d.setMonth(d.getMonth() + 1)) {
            meses.push({ ano: d.getFullYear(), mes: d.getMonth(), rotulo: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '') + (i0.getFullYear() !== f0.getFullYear() ? '/' + String(d.getFullYear()).slice(2) : '') });
        }
        const porMes = (lista, campos) => meses.map(m => lista.filter(r => { const d = dataDe(r, campos); return d && d.getFullYear() === m.ano && d.getMonth() === m.mes; }).length);

        return {
            cidade: CIDADE_PANICO_TXT,
            assistidasTotal: assist.length, assistidasAtivas: ativas.length,
            encerrando: assist.filter(a => nrm(a.status) === 'MEDIDA ENCERRANDO').length,
            encerradas: assist.filter(a => nrm(a.status) === 'MEDIDA ENCERRADA').length,
            novas: assist.filter(a => noPeriodo(dataDe(a, ['data_cadastro', 'data_inicio_mpu']))).length,
            grau,
            fiscalizacoes: fisc.length, avaliacoes: aval.length, acionamentos: acio.length,
            statusAcio, respondidos: acio.filter(r => r.data_hora_resposta).length,
            tempoMedioMin: tempos.length ? tempos.reduce((s, x) => s + x, 0) / tempos.length : null,
            meses: meses.map(m => m.rotulo),
            porMes: { fisc: porMes(fisc, CAMPOS.fisc), aval: porMes(aval, CAMPOS.aval), acio: porMes(acio, CAMPOS.acio) },
            atualizadoEm: new Date(),
        };
    }

    // Garante os dados do pânico do período atual (usado antes de gerar a apresentação).
    async function garantirPanico() {
        const chave = chavePanico();
        if (_panico.chave === chave && _panico.dados) return _panico.dados;
        const B = await carregarIris();
        const { ini, fim } = periodoAba();
        _panico = { chave, dados: resumirPanico(B, ini, fim), erro: null };
        if (ULTIMO) ULTIMO.panico = _panico.dados;
        return _panico.dados;
    }

    async function atualizarPanico() {
        const el = document.getElementById('rp-panico');
        if (!el) return;
        const chave = chavePanico();
        if (!(_panico.chave === chave && _panico.dados)) el.innerHTML = `<div class="rp-vazio" style="padding:1.4rem;">⏳ Carregando dados do IRIS PMAL…</div>`;
        try {
            const D = await garantirPanico();
            if (chavePanico() !== chave) return; // período mudou enquanto carregava
            renderPanico(el, D);
        } catch (e) {
            _panico = { chave, dados: null, erro: e.message };
            if (e.semToken) {
                el.innerHTML = `<div class="rp-vazio" style="padding:1.4rem;">
                    <i class="fas fa-lock"></i>Sem acesso ao IRIS PMAL nesta sessão. Entre com o seu CPF e senha do IRIS:
                    <form id="rp-iris-login" style="display:flex;gap:.5rem;justify-content:center;flex-wrap:wrap;margin-top:.8rem;">
                        <input name="cpf" placeholder="CPF" autocomplete="username" required style="padding:7px 9px;border:1.5px solid var(--p3-border);border-radius:6px;">
                        <input name="senha" type="password" placeholder="Senha do IRIS" autocomplete="current-password" required style="padding:7px 9px;border:1.5px solid var(--p3-border);border-radius:6px;">
                        <button class="rp-btn rp-btn-ppt" type="submit">Entrar no IRIS</button>
                    </form><div id="rp-iris-msg" class="rp-nota-peq" style="margin-top:.5rem;"></div></div>`;
                document.getElementById('rp-iris-login').addEventListener('submit', async ev => {
                    ev.preventDefault();
                    const f = ev.target, msg = document.getElementById('rp-iris-msg');
                    msg.textContent = 'Autenticando…';
                    const r = await IrisPanico.autenticar(f.cpf.value.replace(/\D/g, ''), f.senha.value).catch(() => null);
                    if (r && r.ok) { _irisBrutos = null; atualizarPanico(); }
                    else msg.textContent = 'Não foi possível entrar: ' + ((r && (r.erro || r.msg)) || 'verifique CPF e senha');
                });
            } else {
                el.innerHTML = `<div class="rp-vazio" style="padding:1.4rem;color:#b71c1c;">Não foi possível carregar os dados do IRIS PMAL: ${esc(e.message)}</div>`;
            }
        }
    }

    const fmtTempo = m => m == null ? '—' : (m < 60 ? Math.round(m) + ' min' : (m / 60).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' h');

    function renderPanico(el, D) {
        Object.values(CHARTS_PANICO).forEach(c => { try { c.destroy(); } catch (e) { } });
        CHARTS_PANICO = {};
        const atendidos = D.statusAcio['ATENDIDO'] || 0;
        el.innerHTML = `
            <div class="rp-kpis">
                ${kpi('Assistidas ativas', D.assistidasAtivas, `${D.assistidasTotal} cadastradas · ${D.novas} novas no período`, '#ad1457')}
                ${kpi('Fiscalizações', D.fiscalizacoes, 'no período', '#283593')}
                ${kpi('Avaliações de risco', D.avaliacoes, 'no período (FONAVID)', '#6a1b9a')}
                ${kpi('Acionamentos do botão', D.acionamentos, `${atendidos} atendido(s) · resposta média ${fmtTempo(D.tempoMedioMin)}`, '#c62828')}
            </div>
            <div class="rp-wrap"><div class="charts-grid">
                <div class="chart-card rp-chart-card"><div class="chart-header"><div><div class="chart-title">Fiscalizações, avaliações e acionamentos por mês</div>
                    <div class="chart-sub">${esc(D.cidade)} · IRIS PMAL</div></div></div><div class="chart-wrap"><canvas id="rp-ch-panico-mes"></canvas></div></div>
                <div class="chart-card rp-chart-card"><div class="chart-header"><div><div class="chart-title">Assistidas ativas por grau de risco</div>
                    <div class="chart-sub">Última avaliação registrada no IRIS · ${D.encerrando} com medida encerrando</div></div></div><div class="chart-wrap"><canvas id="rp-ch-panico-grau"></canvas></div></div>
            </div></div>
            <div class="rp-nota-peq">Fonte: aplicativo IRIS PMAL (Patrulha Maria da Penha) — somente ${esc(D.cidade)}. Atualizado em ${D.atualizadoEm.toLocaleString('pt-BR')}.</div>`;
        if (typeof Chart === 'undefined') return;
        const plugins = window.ChartDataLabels ? [window.ChartDataLabels] : [];
        CHARTS_PANICO.mes = new Chart(document.getElementById('rp-ch-panico-mes'), {
            type: 'bar', plugins,
            data: { labels: D.meses, datasets: [
                { label: 'Fiscalizações', data: D.porMes.fisc, backgroundColor: '#283593', borderRadius: 3 },
                { label: 'Avaliações de risco', data: D.porMes.aval, backgroundColor: '#8e24aa', borderRadius: 3 },
                { label: 'Acionamentos', data: D.porMes.acio, backgroundColor: '#c62828', borderRadius: 3 },
            ] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' },
                datalabels: { anchor: 'end', align: 'top', font: { size: 9, weight: 'bold' }, formatter: v => v > 0 ? v : '' } },
                scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } }, layout: { padding: { top: 16 } } },
        });
        CHARTS_PANICO.grau = new Chart(document.getElementById('rp-ch-panico-grau'), {
            type: 'doughnut', plugins,
            data: { labels: GRAUS, datasets: [{ data: GRAUS.map(g => D.grau[g]), backgroundColor: ['#43a047', '#fbc02d', '#ef6c00', '#c62828', '#90a4ae'] }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' },
                datalabels: { color: '#fff', font: { weight: 'bold' }, formatter: v => v > 0 ? v : '' } } },
        });
    }

    // ── Exportações ─────────────────────────────────────────────────
    function exportarCSV() {
        if (!ULTIMO) { alert('Nada para exportar ainda.'); return; }
        const A = ULTIMO, linhas = [['Seção', 'Categoria', 'n', '%']];
        const add = (sec, obj, tot) => Object.entries(obj).forEach(([k, v]) => linhas.push([sec, k, v, pct(v, tot)]));
        linhas.push(['Panorama', 'Total de vítimas', A.total, '100,0%'], ['Panorama', 'Pessoas distintas', A.pessoas, '']);
        Object.entries({ Mulheres: A.grupos.mulheres, 'Crianças (0-11)': A.grupos.criancas, 'Adolescentes (12-17)': A.grupos.adolescentes,
            'Pessoas idosas (60+)': A.grupos.idosos, 'LGBTQIA+ (declarado)': A.grupos.lgbt, Lesionadas: A.grupos.lesionados, 'Óbitos': A.grupos.obitos })
            .forEach(([k, v]) => linhas.push(['Grupos vulneráveis', k, v, pct(v, A.total)]));
        A.meses.forEach(m => linhas.push(['Por mês', m.rotulo, A.porMes[m.chave], pct(A.porMes[m.chave], A.total)]));
        add('Sexo', A.porSexo, A.total); add('Faixa etária', A.porFaixa, A.total); add('Tipos de violência', A.porTipo, A.total);
        add('Vínculo do agressor', A.porVinculo, A.total); add('Origem do acionamento', A.porOrigem, A.total);
        add('Zona urbana', ordenar(A.urbano), A.totalUrbano); add('Zona rural', ordenar(A.rural), A.totalRural);
        if (A.panico) {
            const P = A.panico, sec = `Botão do Pânico (IRIS PMAL) — ${P.cidade}`;
            [['Assistidas ativas', P.assistidasAtivas], ['Assistidas cadastradas (total)', P.assistidasTotal], ['Novas assistidas no período', P.novas],
             ['Medidas encerrando', P.encerrando], ['Fiscalizações no período', P.fiscalizacoes], ['Avaliações de risco no período', P.avaliacoes],
             ['Acionamentos no período', P.acionamentos], ['Acionamentos respondidos', P.respondidos], ['Tempo médio de resposta', fmtTempo(P.tempoMedioMin)]]
                .forEach(([k, v]) => linhas.push([sec, k, v, '']));
            Object.entries(P.grau).forEach(([k, v]) => linhas.push([sec + ' — grau de risco (ativas)', k, v, pct(v, P.assistidasAtivas)]));
            P.meses.forEach((m, i) => linhas.push([sec + ' — por mês', m, `fisc. ${P.porMes.fisc[i]} · aval. ${P.porMes.aval[i]} · acion. ${P.porMes.acio[i]}`, '']));
        }
        const csv = '﻿' + linhas.map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        a.download = `rede_protecao_vitimas_${isoDe(new Date())}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }

    function imprimir() {
        if (!ULTIMO) { alert('Nada para imprimir ainda.'); return; }
        const A = ULTIMO, t = lerTextos();
        const img = id => { const c = CHARTS_REDE[id]; return c ? `<img src="${c.toBase64Image()}" alt="">` : ''; };
        const per = `${A.f.ini ? A.f.ini.toLocaleDateString('pt-BR') : '…'} a ${A.f.fim ? A.f.fim.toLocaleDateString('pt-BR') : '…'}`;
        const cid = A.f.cid || 'Todas as cidades da área do 10º BPM';
        const tab = (tit, obj, tot) => `<table><caption>${esc(tit)}</caption><tr><th>Categoria</th><th>n</th><th>%</th></tr>${Object.entries(obj).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td><td>${pct(v, tot)}</td></tr>`).join('')}</table>`;
        const sec = (tit, corpo) => `<section><h2>${tit}</h2>${corpo}</section>`;
        const ident = [['Nome do serviço', 'nome'], ['Órgão / Secretaria', 'orgao'], ['Território', 'territorio'], ['Responsável', 'responsavel'],
            ['O que fazemos', 'oquefazemos'], ['Porta de entrada', 'porta'], ['Contato institucional', 'contato']]
            .map(([r, k]) => `<tr><th>${r}</th><td>${esc(document.querySelector(`[data-rp-texto="${k}"]`)?.value || t[k] || '')}</td></tr>`).join('');
        const html = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><title>Rede de Proteção — Vítimas de Violência</title>
        <style>
            body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:14mm;font-size:10.5pt}
            h1{font-size:15pt;margin:0 0 2px;text-transform:uppercase;color:#4a148c}
            .sub{color:#555;margin-bottom:10px}
            h2{font-size:11.5pt;color:#4a148c;border-bottom:1.5px solid #4a148c;padding-bottom:2px;margin:16px 0 8px;text-transform:uppercase}
            section{page-break-inside:avoid}
            .kpis{display:flex;flex-wrap:wrap;gap:6px}.kpi{border:1px solid #ccc;border-radius:6px;padding:6px 10px;min-width:110px}
            .kpi b{display:block;font-size:15pt;color:#4a148c}.kpi span{font-size:8pt;color:#555;text-transform:uppercase}
            img{max-width:100%;max-height:270px;display:block;margin:4px auto}
            table{border-collapse:collapse;width:100%;margin:6px 0;font-size:9pt}caption{text-align:left;font-weight:bold;margin-bottom:2px}
            th,td{border:1px solid #ccc;padding:3px 6px;text-align:left;vertical-align:top}th{background:#f3e5f5}
            .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:start}.nota{font-size:8pt;color:#555;margin-top:14px;border-top:1px solid #ccc;padding-top:6px}
        </style></head><body>
        <h1>Rede de Proteção às Vítimas de Violência</h1>
        <div class="sub">Polícia Militar de Alagoas — 10º BPM · ${esc(cid)} · Período: ${per} · Gerado em ${new Date().toLocaleString('pt-BR')}</div>
        ${sec('1. Identificação do serviço', `<table>${ident}</table>`)}
        ${sec('2. Panorama geral', `<div class="kpis">
            <div class="kpi"><span>Total de vítimas</span><b>${A.total}</b>${A.pessoas} pessoa(s) distinta(s)</div>
            <div class="kpi"><span>Feminino</span><b>${A.porSexo['Feminino']}</b>${pct(A.porSexo['Feminino'], A.total)}</div>
            <div class="kpi"><span>Masculino</span><b>${A.porSexo['Masculino']}</b>${pct(A.porSexo['Masculino'], A.total)}</div>
            <div class="kpi"><span>Outro/ign.</span><b>${A.porSexo['Outro/ignorado']}</b>${pct(A.porSexo['Outro/ignorado'], A.total)}</div>
            <div class="kpi"><span>Crianças (0–11)</span><b>${A.grupos.criancas}</b></div>
            <div class="kpi"><span>Adolescentes (12–17)</span><b>${A.grupos.adolescentes}</b></div>
            <div class="kpi"><span>Idosos (60+)</span><b>${A.grupos.idosos}</b></div></div>${img('rp-ch-mes')}`)}
        ${sec('3. Distribuição por sexo', `<div class="grid">${img('rp-ch-sexo')}${tab('Sexo', A.porSexo, A.total)}</div>`)}
        ${sec('4. Faixa etária das vítimas', `<div class="grid">${img('rp-ch-faixa')}${tab('Faixa etária', A.porFaixa, A.total)}</div>`)}
        ${sec('5. Tipos de violência', `${img('rp-ch-tipo')}${tab('Tipos de violência (múltipla resposta)', A.porTipo, A.total)}`)}
        ${sec('6. Vínculo do agressor com a vítima', `${img('rp-ch-vinc')}${tab('Vínculo', A.porVinculo, A.total)}<div class="nota">*Própria pessoa apenas em violência autoprovocada. O CAD não detalha o parentesco (cônjuge, pai/mãe…): registra a natureza doméstica e se o autor possui afinidade com a vítima.</div>`)}
        ${sec('7. Origem do acionamento', `${img('rp-ch-orig')}${tab('Origem', A.porOrigem, A.total)}`)}
        ${sec('8. Distribuição territorial — zona urbana', `${img('rp-ch-urb')}${tab('Bairros', ordenar(A.urbano), A.totalUrbano)}`)}
        ${sec('9. Distribuição territorial — zona rural', `${img('rp-ch-rur')}${tab('Localidades', ordenar(A.rural), A.totalRural)}`)}
        ${A.panico ? sec(`Botão do Pânico — IRIS PMAL (${esc(A.panico.cidade)})`, `<div class="kpis">
            <div class="kpi"><span>Assistidas ativas</span><b>${A.panico.assistidasAtivas}</b>${A.panico.assistidasTotal} cadastradas · ${A.panico.novas} novas</div>
            <div class="kpi"><span>Fiscalizações</span><b>${A.panico.fiscalizacoes}</b>no período</div>
            <div class="kpi"><span>Avaliações de risco</span><b>${A.panico.avaliacoes}</b>no período</div>
            <div class="kpi"><span>Acionamentos</span><b>${A.panico.acionamentos}</b>resposta média ${fmtTempo(A.panico.tempoMedioMin)}</div></div>
            <div class="grid">${CHARTS_PANICO.mes ? `<img src="${CHARTS_PANICO.mes.toBase64Image()}" alt="">` : ''}${CHARTS_PANICO.grau ? `<img src="${CHARTS_PANICO.grau.toBase64Image()}" alt="">` : ''}</div>
            <div class="nota">Fonte: aplicativo IRIS PMAL (Patrulha Maria da Penha) — somente ${esc(A.panico.cidade)}.</div>`) : ''}
        ${sec('10. Síntese do serviço e necessidades da rede', `<table>
            <tr><th>Principais achados</th><td><ul>${(A.achados || []).map(a => `<li>${esc(a)}</li>`).join('')}</ul></td></tr>
            <tr><th>Fragilidades identificadas</th><td>${esc(document.querySelector('[data-rp-texto="fragilidades"]')?.value || '')}</td></tr>
            <tr><th>Ações já realizadas</th><td>${esc(document.querySelector('[data-rp-texto="acoes"]')?.value || '')}</td></tr>
            <tr><th>Necessidades / propostas</th><td>${esc(document.querySelector('[data-rp-texto="propostas"]')?.value || '')}</td></tr></table>`)}
        <div class="nota">Unidade de medida: vítimas registradas em ocorrências da PM. Tipos de violência admitem múltipla resposta. "Sem informação/ignorado" não foi redistribuído. Nenhum dado identificável de vítima é apresentado.
        Fonte: CAD/SISP — grade de envolvidos (tipo de envolvimento = VÍTIMA), 10º BPM.</div>
        <script>window.onload=function(){setTimeout(function(){window.print();},400);};<\/script>
        </body></html>`;
        abrirImpressao(html);
    }

    // ── App desktop (.exe) ──────────────────────────────────────────
    // Dentro do executável (pywebview/WebView2) a janela embutida bloqueia
    // pop-up criado por script (window.open('') + document.write) e ignora
    // download de arquivo gerado no navegador (<a download>). Mesmo
    // contorno já usado pelo relatório da Preditiva CAD: o conteúdo vai
    // pro servidor local (POST /relatorio/salvar → token) e uma página
    // DO SITE (relatorios/rede_protecao.html?token=…) é aberta pela URL —
    // o que o .exe repassa pro navegador padrão do Windows —, busca o
    // conteúdo de volta no 127.0.0.1 e imprime/mostra/baixa por lá.
    const emAppDesktop = () => !!window.pywebview;

    // Leva a impressão/apresentação do .exe pro navegador comum.
    // 1º caminho: Firebase da unidade (nó temporário /relay_temp/<token>).
    //   A leitura NÃO apaga o registro — no .exe a página pode ser carregada
    //   mais de uma vez (o WebView2 abre o link internamente além de repassá-lo
    //   ao navegador padrão), e a leitura de uso único do servidor local fazia
    //   a 2ª abertura dar 404. Cada novo envio apaga os registros com mais de
    //   30 min (o token começa com o horário de criação). Só dados agregados.
    // 2º caminho (reserva): servidor local do .exe (POST /relatorio/salvar —
    //   sem consultar /health, que no .exe só libera P2/ADMIN; ver app.py).
    const RELAY_TTL_MS = 30 * 60 * 1000;

    async function limparRelayAntigo() {
        try {
            const chaves = await fetch(`${base()}/relay_temp.json?shallow=true`).then(r => r.ok ? r.json() : null);
            const agora = Date.now();
            await Promise.all(Object.keys(chaves || {}).filter(k => {
                const t = parseInt(k.split('-')[0], 36);
                return !t || agora - t > RELAY_TTL_MS;
            }).map(k => fetch(`${base()}/relay_temp/${encodeURIComponent(k)}.json`, { method: 'DELETE' }).catch(() => {})));
        } catch (e) { /* limpeza é oportunista — nunca bloqueia o envio */ }
    }

    async function abrirNoNavegador(payload) {
        const corpo = JSON.stringify(payload);
        let param = null;
        try {
            if (!base()) await carregarFirebase();
            limparRelayAntigo();
            const token = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
            const r = await fetch(`${base()}/relay_temp/${token}.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ criadoEm: Date.now(), conteudo: corpo }) });
            if (!r.ok) throw new Error('Firebase respondeu HTTP ' + r.status);
            param = 'fb=' + encodeURIComponent(token) + '&db=' + encodeURIComponent(base());
        } catch (e) { console.warn('[rede-protecao] Firebase indisponível, tentando o servidor local:', e.message); }

        if (!param) {
            const urlLocal = (window.P3AtualizadorLocal && P3AtualizadorLocal.URL_BASE) || 'http://localhost:5057';
            const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
            const resp = await fetch(`${urlLocal}/relatorio/salvar`, { method: 'POST', body: corpo, signal: ctl.signal })
                .catch(() => { throw new Error('não foi possível preparar o arquivo (sem acesso ao Firebase nem ao atualizador local).'); });
            clearTimeout(t);
            const dados = await resp.json().catch(() => ({}));
            if (!resp.ok || !dados.ok || !dados.token) throw new Error(dados.erro || ('servidor local respondeu HTTP ' + resp.status));
            param = 'token=' + encodeURIComponent(dados.token);
        }
        const url = new URL('../relatorios/rede_protecao.html?' + param, location.href).href;
        window.open(url, '_blank');
    }

    async function abrirImpressao(html) {
        if (!emAppDesktop()) {
            const w = window.open('', '_blank');
            if (w) { w.document.write(html); w.document.close(); return; }
        }
        // App desktop, ou navegador que bloqueou o pop-up: abre pelo servidor local.
        await comEspera('Abrindo a impressão no navegador', () => abrirNoNavegador({ tipo: 'impressao', html }));
    }

    function blobParaBase64(blob) {
        return new Promise((ok, falha) => {
            const r = new FileReader();
            r.onload = () => ok(String(r.result).split(',')[1]);
            r.onerror = () => falha(r.error);
            r.readAsDataURL(blob);
        });
    }

    async function abrirApresentacaoNoNavegador() {
        await comEspera('Gerando a apresentação e abrindo no navegador', async () => {
            const blob = await gerarPPTX();
            await abrirNoNavegador({ tipo: 'apresentacao', nome: RedeProtecaoPPTX.nomeArquivo(ULTIMO), pptxBase64: await blobParaBase64(blob) });
        });
    }

    // ── PowerPoint (modelo padronizado da Rede — js/rede-protecao-pptx.js) ──
    function carregarScript(url, global) {
        if (window[global]) return Promise.resolve(window[global]);
        return new Promise((ok, falha) => {
            const s = document.createElement('script');
            s.src = url; s.async = true;
            s.onload = () => window[global] ? ok(window[global]) : falha(new Error(`Biblioteca ${global} não carregou.`));
            s.onerror = () => falha(new Error(`Não foi possível baixar ${url} (sem internet?).`));
            document.head.appendChild(s);
        });
    }

    // Valores atuais dos campos editáveis (identificação + síntese), não só
    // o que já foi salvo — os padrões não são gravados até alguém editar.
    function textosAtuais() {
        const t = Object.assign({}, lerTextos());
        document.querySelectorAll('[data-rp-texto]').forEach(el => { t[el.dataset.rpTexto] = el.value; });
        return t;
    }

    async function gerarPPTX() {
        if (!ULTIMO || !ULTIMO.total) throw new Error('Não há vítimas no filtro atual — ajuste o período/cidade ou busque no CAD primeiro.');
        if (!window.RedeProtecaoPPTX) throw new Error('Gerador da apresentação (rede-protecao-pptx.js) não carregado.');
        await carregarScript(URL_JSZIP, 'JSZip');
        try { ULTIMO.panico = await garantirPanico(); }
        catch (e) { ULTIMO.panico = null; console.warn('[rede-protecao] botão do pânico fora da apresentação:', e.message); }
        return RedeProtecaoPPTX.gerar({ agregado: ULTIMO, textos: textosAtuais() });
    }

    async function comEspera(btnTxt, fn) {
        const anterior = document.getElementById('rp-status')?.textContent;
        status(`⏳ ${btnTxt}…`);
        try { const r = await fn(); status(anterior || ''); return r; }
        catch (e) { console.error('[rede-protecao/pptx]', e); status(`❌ ${e.message}`); alert(e.message); return null; }
    }

    async function baixarPPTX() {
        if (emAppDesktop()) return abrirApresentacaoNoNavegador();
        const blob = await comEspera('Gerando a apresentação no modelo da Rede', gerarPPTX);
        if (!blob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = RedeProtecaoPPTX.nomeArquivo(ULTIMO);
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }

    // A pré-visualização roda DENTRO do app (overlay na própria página —
    // funciona no .exe). Só salvar o .pptx e imprimir saem pro navegador.
    async function visualizarPPTX() {
        const blob = await comEspera('Montando a apresentação', async () => {
            const b = await gerarPPTX();
            await carregarScript(URL_PPTX_PREVIEW, 'pptxPreview');
            return b;
        });
        if (!blob) return;
        let ov = document.getElementById('rp-ppt-overlay');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'rp-ppt-overlay';
            ov.innerHTML = `
                <div class="rp-ppt-barra">
                    <span><i class="fas fa-file-powerpoint"></i> Apresentação — modelo padronizado da Rede de Proteção</span>
                    <span class="rp-ppt-dica">Pré-visualização no navegador (fontes/gráficos podem variar levemente). O arquivo salvo abre idêntico ao modelo no PowerPoint.</span>
                    <div class="rp-ppt-acoes">
                        <button type="button" id="rp-ppt-baixar"><i class="fas fa-download"></i> Salvar em PowerPoint</button>
                        <button type="button" id="rp-ppt-fechar" class="rp-ppt-fechar"><i class="fas fa-times"></i> Fechar</button>
                    </div>
                </div>
                <div id="rp-ppt-palco"></div>`;
            document.body.appendChild(ov);
            ov.querySelector('#rp-ppt-fechar').addEventListener('click', () => { ov.classList.remove('aberto'); document.getElementById('rp-ppt-palco').innerHTML = ''; });
            ov.querySelector('#rp-ppt-baixar').addEventListener('click', baixarPPTX);
            document.addEventListener('keydown', e => { if (e.key === 'Escape' && ov.classList.contains('aberto')) ov.querySelector('#rp-ppt-fechar').click(); });
        }
        ov.classList.add('aberto');
        const palco = document.getElementById('rp-ppt-palco');
        palco.innerHTML = '';
        const largura = Math.min(1100, window.innerWidth - 48);
        try {
            const previewer = window.pptxPreview.init(palco, { width: largura, height: Math.round(largura * 9 / 16), mode: 'slide' });
            await previewer.preview(await blob.arrayBuffer());
        } catch (e) {
            console.error('[rede-protecao/pptx] pré-visualização falhou:', e);
            palco.innerHTML = `<div class="rp-ppt-erro">Não foi possível pré-visualizar no navegador (${esc(e.message)}).<br>Use <b>Salvar em PowerPoint</b> — o arquivo é gerado normalmente.</div>`;
        }
    }

    // ── Ponto de entrada (chamado por trocarAba/atualizarTudo em dashboard-p3.js) ──
    async function renderRedeProtecao() {
        const cont = document.getElementById('conteudo-rede');
        if (!cont) return;
        if (!CARREGADO) {
            cont.innerHTML = `<div class="rp-carregando">⏳ Carregando dados da Rede de Proteção…</div>`;
            try { await carregarFirebase(); }
            catch (e) { cont.innerHTML = `<div class="rp-carregando" style="color:#b71c1c;">Erro ao carregar: ${esc(e.message)}</div>`; return; }
        }
        if (!document.getElementById('rp-corpo')) montarEstrutura(cont);
        renderCorpo();
    }

    // Recarrega a estrutura (lista de cidades/meta) depois de uma importação.
    const _renderOriginal = renderRedeProtecao;
    window.renderRedeProtecao = async function () {
        const cont = document.getElementById('conteudo-rede');
        if (cont && CARREGADO && cont.dataset.rpVersao !== String(VITIMAS.length)) {
            const ini = document.getElementById('rp-ini')?.value, fim = document.getElementById('rp-fim')?.value;
            montarEstrutura(cont);
            if (ini) document.getElementById('rp-ini').value = ini;
            if (fim) document.getElementById('rp-fim').value = fim;
        }
        await _renderOriginal();
        if (cont) cont.dataset.rpVersao = String(VITIMAS.length);
    };
    window.exportarRedeProtecaoCSV = exportarCSV;
    window.visualizarRedeProtecaoPPTX = visualizarPPTX;
    window.baixarRedeProtecaoPPTX = baixarPPTX;

    // Reaproveitados pela apresentação geral do Dashboard Cruzado
    // (js/dashboard-cruzado-pptx.js):
    //  · abrir conteúdo no navegador comum quando estiver no .exe;
    //  · resumo das vítimas (só violência) num intervalo [ini, fim] de Date.
    window.P3EmAppDesktop = emAppDesktop;
    window.P3AbrirConteudoNoNavegador = abrirNoNavegador;
    window.RedeProtecaoResumo = async function (ini, fim, cidadeNorm) {
        if (!CARREGADO) await carregarFirebase();
        const lista = VITIMAS.filter(r => {
            const d = parseData(r.DATA);
            if (!d || d < ini || d > fim) return false;
            if (cidadeNorm && !nrm(r.CIDADE).includes(cidadeNorm)) return false;
            return true;
        }).map(r => Object.assign({}, r, { _idade: idade(r) }))
          .map(r => Object.assign(r, { _tipos: tiposViolencia(r) }))
          .filter(r => r._tipos.length);
        const porTipo = contar(lista, r => r._tipos, TIPOS_VIOLENCIA);
        return {
            baseDisponivel: VITIMAS.length > 0,
            total: lista.length,
            mulheres: lista.filter(r => sexo(r) === 'Feminino').length,
            criancasAdolescentes: lista.filter(r => r._idade != null && r._idade <= 17).length,
            idosos: lista.filter(r => r._idade != null && r._idade >= 60).length,
            porTipo,
        };
    };
    window.imprimirRedeProtecao = imprimir;
})();
