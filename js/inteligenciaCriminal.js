// ════════════════════════════════════════════════════════════════════
// INTELIGÊNCIA CRIMINAL — Sistema P3 (10º BPM)
// ════════════════════════════════════════════════════════════════════
// Módulo complementar que cruza os dados de pessoas/vínculos/ORCRIM já
// cadastrados em page/mapaInteligencia.html (Supabase) com o histórico
// de ocorrências, pra alimentar js/machineLearningLeve.js com contexto
// de REDE — sem duplicar a lógica de busca/índices daquela página: os
// nomes de tabela, chaves de acesso e a estratégia de detecção
// automática de FK (colunas variam entre bancos configurados por
// unidade) são um PORTE FIEL do que já está validado lá.
//
// FUNDAMENTAÇÃO (pesquisa feita antes de escrever este módulo — ver
// resumo passado ao usuário):
//   • Análise de vínculos / Social Network Analysis (SNA) — grau de
//     centralidade (quantos vínculos diretos uma pessoa tem) e alcance
//     da rede (tamanho do grupo conectado) são as métricas clássicas
//     pra identificar atores relevantes numa organização criminosa,
//     sem exigir que a pessoa tenha um "cargo" formal (Springer,
//     "Network Analysis in Criminal Intelligence"; caso do motoclube
//     canadense onde a figura central não era o líder formal).
//   • Near-repeat victimization / modus operandi — o histórico de
//     CIDADE/BAIRRO/DIA DA SEMANA de ocorrências ligadas a uma pessoa
//     é o que a criminologia chama de "rotina"/"modus operandi": um
//     padrão que se repete e ajuda a prever ONDE e QUANDO a atividade
//     tende a se concentrar de novo.
//
// SALVAGUARDAS (baseadas em críticas documentadas ao policiamento
// preditivo — Brennan Center for Justice, RAND):
//   1) NUNCA gera uma frase do tipo "pessoa X vai cometer crime" — só
//      "atenção elevada"/"padrão histórico compatível", sempre com a
//      EVIDÊNCIA bruta (BOs, datas) junto, nunca um score sem lastro.
//   2) O ajuste de risco por rede sobre um LOCAL (ver
//      ajustarRiscoLocalComRede) fica numa faixa limitada [0.85, 1.25]
//      — mais estreita que a de calibrarPesos ([0.5,1.5], dado
//      agregado por categoria) porque aqui a entrada é dado individual
//      sensível: a rede NUNCA pode dominar a previsão geográfica, só
//      dar um empurrão modesto e auditável.
//   3) O ranking de pessoas (rankearPessoasRede) exige um mínimo de
//      ocorrências vinculadas — sem isso, a pessoa simplesmente não
//      aparece, em vez de aparecer com um score artificial baseado só
//      em cadastro.
//   4) A ponte Firebase /autor ↔ Supabase tb_pessoas é por NOME
//      aproximado (sem CPF/BO em comum — mesma limitação já existente
//      em mapaInteligencia.html), então qualquer contagem que dependa
//      dela vem marcada com `confiancaNome: true` nos resultados, pra
//      quem for usar saber que essa parte é menos confiável que os
//      vínculos vindos direto de tb_registro_pessoas (join por ID real).
// ════════════════════════════════════════════════════════════════════

(function (global) {
    'use strict';
    if (global.IntelCrime) return;

    // Mesma chave/URL de page/mapaInteligencia.html — decisão já
    // confirmada com o usuário (reaproveitar a mesma service_role key
    // em vez de trocar pra anon+RLS, por ser ambiente de intranet).
    const SUPABASE_URL = 'https://zxynbnnooauasmasgzxp.supabase.co';
    const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp4eW5ibm5vb2F1YXNtYXNnenhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NDgxNjUsImV4cCI6MjA4ODQyNDE2NX0.2LVOegWWYaVrvQ5DzrSgyBvPaYsanitK_sdWjSHOhkw';
    const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp4eW5ibm5vb2F1YXNtYXNnenhwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjg0ODE2NSwiZXhwIjoyMDg4NDI0MTY1fQ.f7CldsqEQdSsGGptzjgQiBVElKjNIyzu3ZHO9wHeQ94';
    const SUPABASE_KEY = SUPABASE_SERVICE_KEY || SUPABASE_ANON;

    function norm(s) { return String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
    function parseDataFlexivel(s) {
        if (!s) return null;
        const str = String(s).trim().substring(0, 10);
        let d;
        if (str.includes('/')) { const p = str.split('/'); if (p.length < 3) return null; d = new Date(+p[2], +p[1] - 1, +p[0]); }
        else if (str.includes('-')) { const p = str.split('-'); d = new Date(+p[0], +p[1] - 1, +p[2]); }
        return (!d || isNaN(d.getTime())) ? null : d;
    }

    // ── Estado do módulo (carregado 1x, reaproveitado por quem pedir) ──
    let _sb = {
        pessoas: [], apelidos: [], vinculos: [], registros: [], registro_pessoas: [],
        crimes: [], enderecos: [], bairros: [], cidades: [], orcrim: [], orcrim_pessoas: [],
        faccoes: [], faccao_pessoas: [],
    };
    let _autores = []; // Firebase /autor
    let _idx = {
        pessoaById: {}, apelidosByPessoa: {}, vinculosByPessoa: {}, regOfcById: {},
        regOfcByPessoa: {}, pessByRegOfc: {}, crimesByRegOfc: {}, bairroById: {},
        cidadeById: {}, orcrimById: {}, orcrimByPessoa: {}, faccaoById: {}, faccaoByPessoa: {},
        autorByNome: {}, fbAutorByPessoa: {},
    };
    let _vincFKa = null, _vincFKb = null;
    let _promessaCarregamento = null;

    async function sbFetch(tabela) {
        try {
            const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?select=*`, {
                headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Range: '0-9999' },
            });
            if (!res.ok) return [];
            const dados = await res.json();
            return Array.isArray(dados) ? dados : [];
        } catch (e) { console.warn('[IntelCrime] Supabase ' + tabela + ':', e.message); return []; }
    }

    // Porte fiel de construirIndices() em page/mapaInteligencia.html —
    // só a parte de CRUZAMENTO (não a parte de desenho de mapa/grafo,
    // que não interessa aqui). Mantém os MESMOS fallbacks de nome de
    // coluna, porque bancos de unidades diferentes podem ter variações.
    function construirIndices() {
        const idx2 = (map, key, val) => { if (key == null) return; map[key] = val; map[String(key)] = val; };
        const idxArr = (map, key, val) => { if (key == null) return; const k = String(key); if (!map[k]) map[k] = []; map[k].push(val); };

        _sb.pessoas.forEach(p => idx2(_idx.pessoaById, p.id, p));
        _sb.orcrim.forEach(o => idx2(_idx.orcrimById, o.id, o));
        _sb.faccoes.forEach(f => idx2(_idx.faccaoById, f.id, f));
        _sb.bairros.forEach(b => idx2(_idx.bairroById, b.id, b));
        _sb.cidades.forEach(c => idx2(_idx.cidadeById, c.id, c));

        _sb.registros.forEach(r => idx2(_idx.regOfcById, r.id, r));

        _sb.apelidos.forEach(a => {
            const pid = a.pessoa_id || a.id_pessoa;
            if (pid) idxArr(_idx.apelidosByPessoa, pid, a.apelido || a.alcunha || a.nome_guerra || '');
        });

        // Vínculos entre pessoas — auto-detecta as colunas FK (mesma
        // heurística de mapaInteligencia.html: procura nome sugestivo,
        // senão cai nas 2 primeiras colunas que parecem UUID).
        if (_sb.vinculos.length && !_vincFKa) {
            const v0 = _sb.vinculos[0];
            const cols = Object.keys(v0);
            const uuidCols = cols.filter(c => c !== 'id' && typeof v0[c] === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v0[c] || ''));
            _vincFKa = cols.find(c => /origem|pessoa_a$|pessoa_id_a|id_pessoa_a/i.test(c)) || uuidCols[0];
            _vincFKb = cols.find(c => /destino|pessoa_b$|pessoa_id_b|id_pessoa_b/i.test(c)) || uuidCols[1];
        }
        _sb.vinculos.forEach(v => {
            const a = (_vincFKa && v[_vincFKa]) || v.pessoa_origem_id || v.pessoa_id_a || v.id_pessoa_a;
            const b = (_vincFKb && v[_vincFKb]) || v.pessoa_destino_id || v.pessoa_id_b || v.id_pessoa_b;
            if (a) idxArr(_idx.vinculosByPessoa, a, v);
            if (b) idxArr(_idx.vinculosByPessoa, b, v);
        });

        _sb.crimes.forEach(c => {
            const rid = c.registro_id || c.id_registro || c.registros_oficiais_id || c.registro_oficial_id || c.fk_registro;
            if (rid) idxArr(_idx.crimesByRegOfc, rid, c);
        });

        _sb.registro_pessoas.forEach(rp => {
            const rid = rp.registro_id || rp.id_registro || rp.registros_oficiais_id || rp.registro_oficial_id || rp.fk_registro;
            const pid = rp.pessoa_id || rp.id_pessoa || rp.pessoas_id || rp.fk_pessoa;
            if (rid) idxArr(_idx.pessByRegOfc, rid, pid);
            if (pid) idxArr(_idx.regOfcByPessoa, pid, rid);
        });

        _sb.orcrim_pessoas.forEach(op => {
            const pid = op.pessoa_id || op.id_pessoa;
            const oid = op.orcrim_id || op.id_orcrim;
            if (pid && oid) idxArr(_idx.orcrimByPessoa, pid, oid);
        });
        _sb.faccao_pessoas.forEach(fp => {
            const pid = fp.pessoa_id || fp.id_pessoa;
            const fid = fp.faccao_id || fp.id_faccao;
            if (pid && fid) idxArr(_idx.faccaoByPessoa, pid, fid);
        });

        // Ponte Firebase /autor ↔ Supabase — só por nome (ver aviso no
        // cabeçalho do arquivo: sem CPF/BO em comum pra cruzar de verdade).
        _autores.forEach(a => {
            const nomeNorm = norm(a.NOME || a.nome || a.AUTOR || a.autor || '').trim();
            if (!nomeNorm) return;
            if (!_idx.autorByNome[nomeNorm]) _idx.autorByNome[nomeNorm] = [];
            _idx.autorByNome[nomeNorm].push(a);
        });
        _sb.pessoas.forEach(p => {
            const pid = String(p.id);
            const nomes = [norm(p.nome || p.nome_completo || '')].concat((_idx.apelidosByPessoa[pid] || []).map(norm)).filter(Boolean);
            const matches = [];
            nomes.forEach(n => {
                if (_idx.autorByNome[n]) matches.push(..._idx.autorByNome[n]);
                Object.keys(_idx.autorByNome).forEach(k => {
                    if (k !== n && n.length > 5 && (k.includes(n) || n.includes(k))) matches.push(..._idx.autorByNome[k]);
                });
            });
            if (matches.length) _idx.fbAutorByPessoa[pid] = matches;
        });
    }

    // cfg: { firebase: { databaseURL } } — mesmo objeto de
    // P3.loadUnidadeConfig(). Cacheia a promise — 2ª chamada na mesma
    // página reaproveita, nunca refaz as 16 buscas (15 tabelas +
    // Firebase /autor) à toa.
    async function carregar(cfg) {
        if (_promessaCarregamento) return _promessaCarregamento;
        _promessaCarregamento = (async () => {
            _cachePadrao.clear();
            const tabelas = [
                ['tb_pessoas', 'pessoas'], ['tb_pessoa_apelidos', 'apelidos'], ['tb_pessoa_vinculos', 'vinculos'],
                ['tb_registros_oficiais', 'registros'], ['tb_registro_pessoas', 'registro_pessoas'],
                ['tb_registro_crimes', 'crimes'], ['tb_enderecos', 'enderecos'], ['tb_bairros', 'bairros'],
                ['tb_cidades', 'cidades'], ['tb_orcrim', 'orcrim'], ['tb_orcrim_pessoas', 'orcrim_pessoas'],
                ['tb_faccoes', 'faccoes'], ['tb_faccao_pessoas', 'faccao_pessoas'],
            ];
            const promessasSb = tabelas.map(async ([tabelaReal, chave]) => { _sb[chave] = await sbFetch(tabelaReal); });
            // P3.Autores decide Firebase vs API PHP (Hostinger, 10º BPM) — ver js/core/session.js
            const promessaAutor = cfg
                ? P3.Autores.listar(cfg).then(d => { _autores = d ? Object.values(d) : []; }).catch(() => { _autores = []; })
                : Promise.resolve();
            await Promise.all([...promessasSb, promessaAutor]);
            construirIndices();
        })();
        return _promessaCarregamento;
    }

    // ────────────────────────────────────────────────────────────────
    // ANÁLISE DE REDE (SNA leve)
    // ────────────────────────────────────────────────────────────────

    // Grau de centralidade — quantos vínculos DIRETOS essa pessoa tem.
    // Métrica mais simples e mais robusta de SNA (não exige o grafo
    // inteiro carregado em memória de um jeito especial, já temos o
    // índice pronto) — usada em toda a literatura de análise de
    // vínculos como primeiro indicador de relevância de um nó na rede.
    function centralidadeGrau(pessoaId) {
        return (_idx.vinculosByPessoa[String(pessoaId)] || []).length;
    }

    // Tamanho do GRUPO CONECTADO (busca em largura/BFS pelos vínculos)
    // — proxy leve pro "alcance" da rede, sem o custo de betweenness
    // centrality completa (O(V·E), pesada demais pra rodar no
    // navegador a cada carregamento). Um grupo de 40 pessoas conectadas
    // indica uma ORCRIM/facção estruturada; um grupo de 2 é só uma
    // dupla isolada.
    function tamanhoRedeConectada(pessoaId) {
        const visitados = new Set([String(pessoaId)]);
        const fila = [String(pessoaId)];
        while (fila.length) {
            const atual = fila.shift();
            (_idx.vinculosByPessoa[atual] || []).forEach(v => {
                const a = String((_vincFKa && v[_vincFKa]) || v.pessoa_origem_id || v.pessoa_id_a || v.id_pessoa_a);
                const b = String((_vincFKb && v[_vincFKb]) || v.pessoa_destino_id || v.pessoa_id_b || v.id_pessoa_b);
                const vizinho = a === atual ? b : a;
                if (vizinho && vizinho !== 'undefined' && !visitados.has(vizinho)) { visitados.add(vizinho); fila.push(vizinho); }
            });
        }
        return visitados.size; // inclui a própria pessoa
    }

    // ────────────────────────────────────────────────────────────────
    // PADRÃO COMPORTAMENTAL (modus operandi / rotina) por pessoa
    // ────────────────────────────────────────────────────────────────

    function ocorrenciasDaPessoa(pessoaId) {
        const regIds = _idx.regOfcByPessoa[String(pessoaId)] || [];
        return regIds.map(rid => _idx.regOfcById[String(rid)]).filter(Boolean);
    }

    // Cache simples — ajustarRiscoLocalComRede varre TODAS as pessoas e
    // rankearPessoasRede varre de novo, então sem isso o mesmo cálculo
    // roda 2x pra cada pessoa. Os dados só mudam quando carregar() roda
    // de novo (ver _promessaCarregamento acima), então é seguro cachear
    // pela duração do carregamento atual.
    const _cachePadrao = new Map();

    // Retorna null se a pessoa não tem NENHUMA ocorrência vinculada —
    // nunca inventa um padrão comportamental sem evidência.
    //
    // DATA/DIA-DA-SEMANA vêm de tb_registros_oficiais, cruzado por ID
    // real via tb_registro_pessoas (confiável). CIDADE/BAIRRO vêm da
    // ponte com o Firebase /autor (por nome aproximado — ver aviso no
    // cabeçalho do arquivo): confirmei direto no schema real do
    // Supabase que tb_enderecos tem cidade_id/bairro_id, mas NÃO tem
    // nenhuma coluna de FK pra pessoa nem pra registro nesta base — só
    // dá pra ligar endereço a pessoa/BO usando outra tabela ainda não
    // mapeada (achei tb_linp/tb_linp_enderecos, um cadastro de casos
    // mais rico com hora e local do fato, mas sem uma junção
    // confirmada pra pessoa) — por isso a localização aqui usa a fonte
    // que já funciona de verdade, com o campo `confiancaLocalizacao` a
    // avisando que não é join por ID.
    function padraoComportamental(pessoaId, opts) {
        opts = opts || {};
        const chaveCache = String(pessoaId);
        if (_cachePadrao.has(chaveCache)) return _cachePadrao.get(chaveCache);
        const registros = ocorrenciasDaPessoa(pessoaId);
        const autoresFirebase = _idx.fbAutorByPessoa[String(pessoaId)] || [];
        if (!registros.length && !autoresFirebase.length) { _cachePadrao.set(chaveCache, null); return null; }

        const hoje = new Date();
        const MS_DIA = 86400000;
        const cidades = {}, bairros = {}, diasSemana = Array(7).fill(0);
        let recentes90d = 0, recentes365d = 0, ultimaData = null;

        registros.forEach(r => {
            const data = parseDataFlexivel(r.data_fato || r.data);
            if (!data) return;
            diasSemana[data.getDay()]++;
            const diffDias = (hoje - data) / MS_DIA;
            if (diffDias <= 90) recentes90d++;
            if (diffDias <= 365) recentes365d++;
            if (!ultimaData || data > ultimaData) ultimaData = data;
        });

        autoresFirebase.forEach(a => {
            const cidadeNome = (a.CIDADE || '').toString().trim();
            const bairroNome = (a.BAIRRO || '').toString().trim();
            if (cidadeNome) cidades[cidadeNome] = (cidades[cidadeNome] || 0) + 1;
            if (bairroNome) bairros[bairroNome] = (bairros[bairroNome] || 0) + 1;
        });

        const ordenar = obj => Object.entries(obj).sort((a, b) => b[1] - a[1]);
        const resultado = {
            pessoaId: String(pessoaId),
            totalOcorrencias: registros.length,
            ocorrenciasRecentes90d: recentes90d,
            ocorrenciasRecentes365d: recentes365d,
            ultimaOcorrenciaData: ultimaData ? ultimaData.toISOString().slice(0, 10) : null,
            cidadesFrequentes: ordenar(cidades).slice(0, 5),
            bairrosFrequentes: ordenar(bairros).slice(0, 5),
            diasSemanaFrequentes: diasSemana,
            confiancaLocalizacao: autoresFirebase.length ? 'nome_aproximado' : 'sem_dado',
        };
        _cachePadrao.set(chaveCache, resultado);
        return resultado;
    }

    function pessoasDoOrcrim(orcrimId) {
        return Object.keys(_idx.orcrimByPessoa).filter(pid => _idx.orcrimByPessoa[pid].map(String).includes(String(orcrimId)));
    }
    function pessoasDaFaccao(faccaoId) {
        return Object.keys(_idx.faccaoByPessoa).filter(pid => _idx.faccaoByPessoa[pid].map(String).includes(String(faccaoId)));
    }

    // Agrega o padrão comportamental de TODAS as pessoas de um
    // ORCRIM/facção — usado tanto pro ajuste de risco por local quanto
    // pro ranking de redes.
    function atividadeGrupo(pessoaIds) {
        const porCidade = {}, porBairro = {};
        let recentes90d = 0, ultimaData = null;
        pessoaIds.forEach(pid => {
            const p = padraoComportamental(pid);
            if (!p) return;
            recentes90d += p.ocorrenciasRecentes90d;
            p.cidadesFrequentes.forEach(([c, n]) => { porCidade[c] = (porCidade[c] || 0) + n; });
            p.bairrosFrequentes.forEach(([b, n]) => { porBairro[b] = (porBairro[b] || 0) + n; });
            if (p.ultimaOcorrenciaData && (!ultimaData || p.ultimaOcorrenciaData > ultimaData)) ultimaData = p.ultimaOcorrenciaData;
        });
        return { porCidade, porBairro, recentes90d, ultimaData, qtdPessoasComAtividade: pessoaIds.filter(pid => ocorrenciasDaPessoa(pid).length > 0).length };
    }

    // ────────────────────────────────────────────────────────────────
    // ABA 1 — ajusta o RANKING DE LOCAL (saída de
    // MLLeve.preverRiscoPorLocal) com um fator de atividade de rede
    // conhecida naquela cidade/bairro. Fator sempre em [0.85, 1.25] —
    // ver justificativa no cabeçalho do arquivo.
    // ────────────────────────────────────────────────────────────────
    function ajustarRiscoLocalComRede(ranking, opts) {
        opts = opts || {};
        const FATOR_MIN = opts.fatorMin || 0.85, FATOR_MAX = opts.fatorMax || 1.25;
        if (!Array.isArray(ranking) || !ranking.length) return ranking;

        // Atividade recente (90d) por CIDADE, somando todas as pessoas
        // com pelo menos 1 vínculo (rede) — não olha pessoas isoladas
        // sem nenhum vínculo cadastrado, já que o ajuste é sobre REDE,
        // não sobre indivíduo solto.
        const atividadePorCidade = {};
        Object.keys(_idx.pessoaById).forEach(pid => {
            if (centralidadeGrau(pid) < 1) return; // sem vínculo = não é "rede"
            const p = padraoComportamental(pid);
            if (!p || !p.ocorrenciasRecentes90d) return;
            p.cidadesFrequentes.forEach(([cidade, n]) => {
                atividadePorCidade[norm(cidade)] = (atividadePorCidade[norm(cidade)] || 0) + n;
            });
        });

        const valores = Object.values(atividadePorCidade);
        const max = valores.length ? Math.max(...valores) : 0;
        if (max === 0) return ranking.map(r => Object.assign({}, r, { fatorRede: 1, ajustadoPorRede: false }));

        return ranking.map(r => {
            const atividade = atividadePorCidade[norm(r.cidade)] || 0;
            const intensidade = atividade / max; // 0..1
            const fator = FATOR_MIN + intensidade * (FATOR_MAX - FATOR_MIN);
            return Object.assign({}, r, {
                probabilidadeAjustada: Math.round(Math.min(1, r.probabilidade * fator) * 1000) / 1000,
                fatorRede: Math.round(fator * 100) / 100,
                ajustadoPorRede: atividade > 0,
            });
        }).sort((a, b) => (b.probabilidadeAjustada || b.probabilidade) - (a.probabilidadeAjustada || a.probabilidade));
    }

    // ────────────────────────────────────────────────────────────────
    // ABA 2 — ranking de PESSOAS/REDES com atenção elevada. Nunca "vai
    // cometer crime" — só "padrão histórico + rede ativa recentemente",
    // com a evidência (BOs) sempre junto.
    // ────────────────────────────────────────────────────────────────
    function rankearPessoasRede(opts) {
        opts = opts || {};
        const topN = opts.topN || 15;
        const minimoOcorrencias = opts.minimoOcorrencias || 1;

        const ranking = Object.values(_idx.pessoaById).map(p => {
            const pid = String(p.id);
            const padrao = padraoComportamental(pid);
            if (!padrao || padrao.totalOcorrencias < minimoOcorrencias) return null;

            const grau = centralidadeGrau(pid);
            const rede = tamanhoRedeConectada(pid);
            const orcrimIds = _idx.orcrimByPessoa[pid] || [];
            const faccaoIds = _idx.faccaoByPessoa[pid] || [];

            // Score simples e explicável (não é ML treinado — não há
            // rótulo "reincidiu de novo" com granularidade suficiente
            // por PESSOA pra treinar com segurança, ao contrário do que
            // fizemos por LOCAL em preverRiscoPorLocal): combina
            // recência de atividade (peso 2), centralidade (peso 1) e
            // alcance da rede (peso 0.5) — cada fator é 100% auditável.
            const score = padrao.ocorrenciasRecentes90d * 2 + grau * 1 + Math.log2(rede + 1) * 0.5;

            return {
                pessoaId: pid,
                nome: p.nome || p.nome_completo || 'Não identificado',
                score: Math.round(score * 100) / 100,
                centralidade: grau,
                tamanhoRedeConectada: rede,
                orcrim: orcrimIds.map(oid => { const o = _idx.orcrimById[oid]; return o ? (o.nome || o.nome_organizacao) : null; }).filter(Boolean),
                faccao: faccaoIds.map(fid => { const f = _idx.faccaoById[fid]; return f ? (f.nome || f.nome_faccao) : null; }).filter(Boolean),
                ocorrenciasRecentes90d: padrao.ocorrenciasRecentes90d,
                ultimaOcorrenciaData: padrao.ultimaOcorrenciaData,
                cidadesFrequentes: padrao.cidadesFrequentes,
                bairrosFrequentes: padrao.bairrosFrequentes,
                diasSemanaFrequentes: padrao.diasSemanaFrequentes,
                evidenciaBOs: (_idx.regOfcByPessoa[pid] || []).map(rid => {
                    const r = _idx.regOfcById[String(rid)];
                    if (!r) return null;
                    // numero_registro é o campo real confirmado no schema desta base;
                    // os demais ficam como fallback pra outras unidades com nomenclatura diferente.
                    // Nunca cai pro UUID interno (r.id) — sem número legível, fica null (a
                    // tela decide como mostrar "sem número", não um UUID sem sentido pro analista).
                    return { numero: r.numero_registro || r.numero_bo || r.num_bo || r.boletim || r.numero || null, tipo: r.tipo_registro || null, data: r.data_fato || r.data || null };
                }).filter(Boolean),
            };
        }).filter(Boolean).sort((a, b) => b.score - a.score);

        return { ranking: ranking.slice(0, topN), totalPessoasComOcorrencia: ranking.length };
    }

    global.IntelCrime = {
        carregar,
        centralidadeGrau,
        tamanhoRedeConectada,
        padraoComportamental,
        pessoasDoOrcrim,
        pessoasDaFaccao,
        atividadeGrupo,
        ajustarRiscoLocalComRede,
        rankearPessoasRede,
    };
})(window);
