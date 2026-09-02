// Config definida em runtime a partir da unidade do usuário logado (ver js/core/session.js)
let db = null;
let cfgUnidade = null;
async function _ensureFirebase() {
    if (db) return db;
    cfgUnidade = await P3.loadUnidadeConfig();
    if (!firebase.apps.length) firebase.initializeApp(cfgUnidade.firebase);
    db = firebase.database();
    return db;
}

// Variáveis de controle
let bufferDados = [];

// ─────────────────────────────────────────────
// MAPAS DE COLUNAS
// ─────────────────────────────────────────────

const MAPA_GERAL = {
    "BOLETIM": ["Nº Ocorrência", "Boletim", "Nº Boletim"],
    "SOLUÇÃO": ["Solução", "Solucao"],
    "TIPIFICACAO": ["Tipicidade no Despacho", "Tipificacao"],
    "TIPIFICACAO_GERAL": ["Tipificação Geral"],
    "ATENDIMENTO_INICIAL": ["Atendimento Inicial"],
    "TEXTO_DESPACHANTE": ["Texto do Despachante"],
    "BAIRRO": ["Bairro"],
    "LOGRADOURO": ["Logradouro", "Endereço"],
    "SOLICITANTE": ["Solicitante"],
    "LATITUDE": ["Latitude (Abertura de Ocor.)", "Latitude"],
    "LONGITUDE": ["Longitude (Abertura de Ocor.)", "Longitude"],
    "CIDADE": ["Cidade", "Município"],
    "ESTABELECIMENTO": ["Estabelecimento", "Local"],
    "ATENDENTE": ["Atendente"]
};

const MAPA_OBJETO = {
    "BOLETIM": ["Ocorrência", "Boletim", "Nº Ocorrência"],
    "DESCRICAO": ["Descrição do Material", "Descricao", "Objeto"],
    "QUANTIDADE": ["Quantidade"]
};

const MAPA_ARMA = {
    "BOLETIM": ["Ocorrência", "Boletim"],
    "SERIE": ["Serie"],
    "TIPO_ARMA": ["Tipo"],
    "CALIBRE": ["Calibre"],
    "MARCA": ["Marca"],
    "BAIRRO": ["Bairro"]
};

const MAPA_DROGA = {
    "BOLETIM": ["Boletim"],
    "QUANTIDADE": ["Quantidade"],
    "TIPO_DROGA": ["Tipo"]
};

const MAPA_VEICULO = {
    "BOLETIM": ["Ocorrência", "Boletim"],
    "PLACA": ["Placa"]
};

const MAPA_AUTOR = {
    "BOLETIM": ["Nº Ocorrência", "Boletim", "Ocorrência"],
    "NOME": ["Nome"],
    "SITUACAO": ["Situação"],
    "NARRATIVA": ["Narrativa do Envolvido"],
    "NATUREZA": ["Natureza no Despacho"],
    "TIPIFICACAO": ["Tipificação no Despacho"],
    "BAIRRO": ["Bairro Ocorrência"],
    "CIDADE": ["Cidade Ocorrência"],
    "LOGRADOURO": ["Logradouro"],
    "MES": ["Mês da Ocorrência"],
    "ANO": ["Ano da Ocorrência"],
    "ENVOLVIMENTO": ["Tipo de Envolvimento", "Tipo Envolvido"],
    "CPF": ["CPF"],
    // Unidade responsável pela ocorrência (BOPE, ROTAM, 1º BPM, 3ª CPM/I...)
    // — já vem PRONTA, linha a linha, na planilha do CAD ("Unidade") — ver
    // normalizarUnidadeAutor abaixo, que só precisa normalizar a variante
    // do 10º BPM pro identificador "10bpm" usado no resto do sistema.
    "UNIDADE": ["Unidade"]
};

// ─────────────────────────────────────────────
// NOVO: MAPA DE PESSOAS (campo OBITO incluso)
// Adapte os nomes das colunas conforme o cabeçalho
// real da sua planilha de pessoas/vítimas.
// ─────────────────────────────────────────────
const MAPA_PESSOA = {
    "BOLETIM":   ["Nº Ocorrência", "Boletim", "Ocorrência", "Nº Boletim"],
    "NOME":      ["Nome", "Nome da Pessoa", "Vítima"],
    "OBITO":     ["Óbito?", "Obito?", "Obito", "Óbito", "Morte", "Falecimento"],
    "SITUACAO":  ["Situação", "Situacao"],
    "NATUREZA":  ["Natureza", "Natureza no Despacho"],
    "SEXO":      ["Sexo"],
    "IDADE":     ["Idade"],
    "TIPIFICACAO": ["Tipificação no Despacho", "Tipificacao"]
}

// ─────────────────────────────────────────────────────────────────
// MAPA DE GUARNIÇÃO
// Planilha: Google Sheets ID '124q8ish_L1TyS2i_go6mfDwYOp0DTJ8z0-k1cbTKPx4'
// Cada linha representa um integrante de uma guarnição despachada
// O BOLETIM é a chave de cruzamento com o nó /geral/
// ─────────────────────────────────────────────────────────────────
const MAPA_GUARNICAO = {
    "BOLETIM":                  ["Nº Ocorrência", "Nº OCORRÊNCIA", "Nº Ocorrencia"],
    "POSTO_GRADUACAO":          ["Posto / Graduação", "Posto/Graduação", "Graduação"],
    "UNIDADE_DESPACHO":         ["Unidade de Despacho", "UNID DESPC"],
    "FUNCAO_EQUIPE":            ["Função na Equipe", "Funcao na Equipe"],
    "NOME_GUERRA":              ["Nome de guerra", "Nome de Guerra", "Nome de Guerra na Apresentaçao", "Nome de Guerra na Apresentacao"],
    "IC_STAT_RECR":             ["IC STAT RECR"],
    "DESC_DESPACHANTE":         ["Descrição do Despachante", "Descricao do Despachante"],
    "OCORRENCIAS_PAGAS":        ["Ocorrências Pagas", "Ocorrencias Pagas"],
    "SITUACAO_ORGAO":           ["Situação no Orgão", "Situacao no Orgao"],
    "OBSERVACAO":               ["Observação", "Observacao"],
    "AMBIENTE":                 ["Ambiente"],
    "OCORRENCIA_ATUAL":         ["Ocorrência Atual", "Ocorrencia Atual"],
    "CONDICAO_ORGAO":           ["Condição no Orgão", "Condicao no Orgao"],
    "ESTABELECIMENTO":          ["Estabelecimento"],
    "TEXTO_DIVULGACAO":         ["Texto de Divulgação Coordenador", "Texto de Divulgacao Coordenador"],
    "DESC_SOLICITACAO":         ["Descriçao da Solicitação", "Descricao da Solicitacao"],
    "COMUNIDADE":               ["Comunidade"],
    "LOGRADOURO":               ["Lougradouro", "Logradouro"],
    "UNID_ORIGEM_REFORCO":      ["Unidade Origem do Reforco"],
    "TIPO_DESLOCAMENTO":        ["Tipo de Deslocamento"],
    "KM_CHEGADA":               ["KM de Chegada"],
    "RADIO_RECURSO":            ["Radio do Recurso", "Rádio do Recurso"],
    "DESC_QUIMERA":             ["Descrição ocorrência Quimera", "Descricao ocorrencia Quimera"],
    "ANO_OCORRENCIA":           ["Ano da Ocorrência", "Ano da Ocorrencia"],
    "MES_ANO_OCORRENCIA":       ["Mês e Ano da Ocorrência", "Mes e Ano da Ocorrencia"],
    "KM_SAIDA":                 ["KM de Saída", "KM de Saida"],
    "DT_HR_SAIDA":              ["Data/Hora Saída", "Data/Hora Saida"],
    "LONGITUDE":                ["NR COOR LONG"],
    "LATITUDE":                 ["NR COOR LATD"],
    "DT_HR_CHEGADA":            ["Data/Hora Cheg.", "Data/Hora Chegada"],
    "ULT_DESTINO":              ["Últ. Destino", "Ult. Destino"],
    "SITUACAO_ATUAL":           ["Situação Atual", "Situacao Atual"],
    "ORGAO_EFETIVO":            ["Orgão do Efetivo"],
    "ID_ORGA_UNID_RECR":        ["ID ORGA UNID RECR"],
    "NOME_MAE":                 ["Nome da Mãe", "Nome da Mae"],
    "SEXO":                     ["Sexo"],
    "CPF":                      ["CPF do Integrante", "CPF"],
    "POSTO_APRESENTACAO":       ["Posto na Apresentação", "Posto na Apresentacao"],
    "NOME_COMPLETO":            ["Nome Completo"],
    "RADIO_HT":                 ["Radio HT", "Rádio HT"],
    "TITULAR_APOIO":            ["Titular ou Apoio"],
    "ESAJ":                     ["Nº ESAJ", "ESAJ"],
    "TIPO_DESPACHO":            ["Tipo do Despacho"],
    "DT_HR_REGISTRO":           ["DT/Hora Registro Ocorrência", "DT/Hora Registro Ocorrencia"],
    "BAIRRO":                   ["Bairro"],
    "CIDADE":                   ["Cidade"],
    "DT_HR_INCLUIU_RECURSO":    ["DT/Hora Incluiu o Recurso"],
    "DATA_SERVICO":             ["Data de Serviço", "Data de Servico"],
    "PREFIXO":                  ["Prefixo"],
    "PLACA":                    ["Placa"],
    "NOME_EQUIPE":              ["Nome da Equipe / Recurso"],
    "AREA_ATUACAO":             ["Area de Atuação", "Area de Atuacao"],
    "EQUIPE":                   ["Equipe"],
    "HR_ESCALA_INICIO":         ["Horario escala Inicio"],
    "HR_ESCALA_FIM":            ["Horario escala Fim"],
    "TURNO_HORAS":              ["Turno de Horas"],
    "TIPO":                     ["Tipo"],
    "MODALIDADE":               ["Modalidade"],
    "KM_INICIAL":               ["Km Inicial"],
    "KM_FINAL":                 ["Km Final"],
    "NATUREZA_GERAL":           ["Natureza Geral"],
    "TIPICIDADE_GERAL":         ["Tipicidade Geral"],
    "NATUREZA_ABERTURA":        ["Natureza na Abertura da Ocorrência", "Natureza na Abertura da Ocorrencia"],
    "TIPICIDADE_ABERTURA":      ["Tipicidade na Abertura da Ocorrência", "Tipicidade na Abertura da Ocorrencia"],
    "SOLUCAO_OCORRENCIA":       ["Solução da Ocorrência", "Solucao da Ocorrencia"],
    "COMPLEMENTADA_QUIMERA":    ["Complementada via QUIMERA?"],
    "USUARIO_INCLUIU":          ["Usuário incluiu", "Usuario incluiu"],
    "MOVIMENTACAO":             ["Movimentação", "Movimentacao"]
};;

// ─────────────────────────────────────────────
// FUNÇÃO UTILITÁRIA: busca valor flexível
// ─────────────────────────────────────────────
function buscarValor(linha, lista) {
    for (let n of lista) {
        let achou = Object.keys(linha).find(c => c.trim().toLowerCase() === n.toLowerCase());
        if (achou) return linha[achou];
    }
    return null;
}

// Normaliza o valor bruto da coluna "Unidade" da planilha do CAD pro
// identificador usado no resto do sistema — SÓ a variante do 10º BPM
// precisa virar exatamente "10bpm" (mesmo valor de session.unidadeId em
// js/core/session.js, usado pelo filtro do Apps Script e pela tela de
// Autores); as demais unidades (BOPE, ROTAM, 3º BPM, 3ª CPM/I...) ficam
// como vieram na planilha, sem inventar um código pra cada uma.
function normalizarUnidadeAutor(bruto) {
    const original = (bruto || '').toString().trim();
    if (!original || original === '---') return null;
    const semSimbolo = original.toUpperCase().replace(/[ºª°]/g, '').replace(/\s+/g, ' ').trim();
    return (semSimbolo === '10 BPM' || semSimbolo === '10BPM') ? '10bpm' : original;
}

// Campo "Unidade dona deste relatório" só faz sentido pro tipo "autor"
// (é a única coleção que virou tabela compartilhada entre unidades — ver
// hostinger-api/migrar_autores_unidade.sql) — escondido nos demais tipos.
document.getElementById('tipo-colecao').addEventListener('change', function (e) {
    document.getElementById('wrap-unidade-relatorio').style.display = e.target.value === 'autor' ? 'block' : 'none';
});

// ─────────────────────────────────────────────
// LEITURA DO ARQUIVO XLS
// ─────────────────────────────────────────────
document.getElementById('input-xls').onchange = function(e) {
    const tipo = document.getElementById('tipo-colecao').value;
    if (!tipo) { alert("Selecione o tipo primeiro!"); e.target.value = ""; return; }

    const arquivo = e.target.files && e.target.files[0];
    if (!arquivo) { alert("Nenhum arquivo selecionado."); return; }

    const reader = new FileReader();
    reader.onload = function(evt) {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

        const mapas = {
            'geral':      MAPA_GERAL,
            'arma':       MAPA_ARMA,
            'droga':      MAPA_DROGA,
            'veiculo':    MAPA_VEICULO,
            'objeto':     MAPA_OBJETO,
            'autor':      MAPA_AUTOR,
            'pessoa':     MAPA_PESSOA,
            'guarnicao':  MAPA_GUARNICAO
        };
        const mapa = mapas[tipo];

        bufferDados = json.map(linha => {
            let item = {};

            // ── ID DO BOLETIM ──────────────────────────────
            let rawOcorrencia = buscarValor(linha, ["Nº Ocorrência", "Boletim", "Ocorrência"]) || "";
            let strOco = rawOcorrencia.toString().trim();
            let idLimpo = strOco.replace(/\D/g, '').substring(0, 7);

            // ── DATA E HORA ────────────────────────────────
            // Busca campo de data (pode conter data+hora no mesmo campo)
            let rawDataHora = buscarValor(linha, ["Data da Ocorrência", "Dia da Ocorrência", "Data"]) || "---";
            // Busca campo de hora separado (algumas planilhas têm coluna própria)
            let rawHora = buscarValor(linha, ["Hora da Ocorrência", "Hora", "Horário", "HORA"]);
            let dataFinal = "---";
            let horaFinal = "00:00";

            const rawStr = rawDataHora.toString().trim();

            if (rawStr.includes(" ")) {
                // Campo data contém data e hora separadas por espaço: "DD/MM/AAAA HH:MM"
                let partes = rawStr.split(" ");
                dataFinal = partes[0].trim();
                let horaCandidata = partes[1].trim().substring(0, 5);
                // Valida que é realmente HH:MM (0-23 : 0-59)
                let hh = parseInt(horaCandidata.split(":")[0], 10);
                let mm = parseInt((horaCandidata.split(":")[1] || "0"), 10);
                horaFinal = (!isNaN(hh) && hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59)
                    ? horaCandidata
                    : "00:00";
            } else {
                dataFinal = rawStr;
                // Tenta usar coluna separada de hora se existir
                if (rawHora) {
                    let horaStr = rawHora.toString().trim().substring(0, 5);
                    let hh = parseInt(horaStr.split(":")[0], 10);
                    let mm = parseInt((horaStr.split(":")[1] || "0"), 10);
                    horaFinal = (!isNaN(hh) && hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59)
                        ? horaStr
                        : "00:00";
                }
                // Se não há coluna separada, hora fica "00:00"
                // NUNCA usar strOco (número do boletim) como hora — causa corrupção
            }

            // ── CAMPOS DO MAPA ─────────────────────────────
            for (let chave in mapa) {
                let v = buscarValor(linha, mapa[chave]);
                if (chave === "LATITUDE" || chave === "LONGITUDE") {
                    item[chave] = v ? v.toString() : "---";
                } else if (chave === "OBITO") {
                    // Normaliza: "S", "SIM", "s", "sim" → "S" | qualquer outro → "N"
                    let raw = (v || "").toString().trim().toUpperCase();
                    item["OBITO"] = (raw === "S" || raw === "SIM" || raw === "1") ? "S" : "N";
                } else {
                    item[chave] = (chave === "BOLETIM") ? idLimpo : (v || "---");
                }
            }

            item["DATA"] = dataFinal;
            item["HORA"] = horaFinal;

            return item;
        }).filter(i => i.BOLETIM && i.BOLETIM !== "");

        document.getElementById('status-msg').innerText =
            `✓ ${bufferDados.length} registros prontos para salvar.`;
        document.getElementById('btn-save-cloud').style.display = "block";
    };

    reader.readAsArrayBuffer(arquivo);
};

// ─────────────────────────────────────────────
// SALVAR NO FIREBASE
// ─────────────────────────────────────────────
// EXTRAÍDO (02/09/2026) do antigo onclick do botão pra virar uma função
// reutilizável — o mesmo caminho de gravação (cruzamento com /geral,
// classificação TCO/VD/CVP/CVLI, dedup determinístico por tipo, lotes de
// 100 no Firebase, autores pro PHP/MySQL da Hostinger) agora também é
// usado pela sincronização DIRETA do CAD (ver
// "SINCRONIZAÇÃO DIRETA DO CAD" mais abaixo) — sem duplicar essa lógica
// delicada/já testada. `buffer` é o equivalente do antigo `bufferDados`
// global (agora passado por parâmetro); `onProgresso` (opcional) recebe
// uma string de status a cada lote gravado, pra quem chamar decidir onde
// mostrar (botão, painel de sincronização do CAD etc.).
async function sincronizarBufferComNuvem(tipo, buffer, unidadeRelatorioAutor, onProgresso) {
    const updates = {};
    const autoresParaApi = []; // tipo 'autor' no 10º BPM vai pra API PHP/MySQL, não pro objeto `updates` acima
    const agora = new Date().toISOString();
    const bufferDados = buffer || [];

    {
        // 1. Busca nó 'geral' para cruzamento
        const snapshotGeral = await db.ref('geral').once('value');
        const dadosGerais = snapshotGeral.val() || {};

        const tratar = (valor) => (valor === undefined || valor === null) ? "---" : valor;

        // ── FLUXO ESPECIAL: PESSOA ─────────────────────────────────────────────
        // A planilha de pessoas cruza pelo número do boletim e atualiza
        // somente o campo OBITO (e dados extras) nos registros já existentes.
        // ──────────────────────────────────────────────────────────────────────
        if (tipo === 'pessoa') {
            bufferDados.forEach(d => {
                const safeId = d.BOLETIM;
                const infoExistente = dadosGerais[safeId] || {};

                // Monta o patch: preserva tudo que já existe e adiciona/atualiza OBITO
                const patch = {
                    ...infoExistente,
                    OBITO: tratar(d.OBITO),
                    import_at: agora
                };

                // Atualiza no nó geral
                updates[`/geral/${safeId}`] = patch;

                // ── Regra CVLI com OBITO ──────────────────────────────────────
                // Se a tipificação contém "TENTATIVA" E o óbito é "S",
                // reclassifica como homicídio e insere no nó /cvli/
                const tipGeral = (infoExistente.TIPIFICACAO_GERAL || "").toUpperCase()
                    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");

                const ehTentativa = tipGeral.includes("TENTATIVA");
                const temObito = d.OBITO === "S";

                if (ehTentativa && temObito) {
                    updates[`/cvli/${safeId}`] = {
                        ...patch,
                        OBITO: "S",
                        CLASSIFICACAO_CVLI: "HOMICÍDIO (TENTATIVA COM ÓBITO)"
                    };
                }

                // Também salva os dados da pessoa no nó /pessoa/ para histórico
                updates[`/pessoa/${safeId}`] = { ...d, import_at: agora };
            });

        // ── FLUXO ESPECIAL: GUARNIÇÃO ─────────────────────────────────────────
        // Cada linha é um integrante da equipe despachada para o boletim.
        // Salva em /guarnicao/<BOLETIM>/<index>/ para manter todos os integrantes.
        // Também complementa /geral/<BOLETIM>/ com dados de coordenada se faltar.
        } else if (tipo === 'guarnicao') {
            // Agrupa por boletim para reescrever todos de uma vez
            const porBoletim = {};
            bufferDados.forEach(d => {
                const bol = d.BOLETIM;
                if (!bol || bol === '---') return;
                if (!porBoletim[bol]) porBoletim[bol] = [];
                porBoletim[bol].push(d);
            });

            Object.entries(porBoletim).forEach(([bol, integrantes]) => {
                // Salva lista de integrantes indexada
                integrantes.forEach((d, idx) => {
                    updates[`/guarnicao/${bol}/${idx}`] = { ...d, import_at: agora };
                });

                // Complementa /geral/ com latitude/longitude se estiver faltando
                const geralExistente = dadosGerais[bol] || {};
                const primeiroComCoord = integrantes.find(d =>
                    d.LATITUDE && d.LATITUDE !== '---' &&
                    d.LONGITUDE && d.LONGITUDE !== '---'
                );
                if (primeiroComCoord) {
                    if (!geralExistente.LATITUDE || geralExistente.LATITUDE === '---') {
                        updates[`/geral/${bol}/LATITUDE`]  = primeiroComCoord.LATITUDE;
                    }
                    if (!geralExistente.LONGITUDE || geralExistente.LONGITUDE === '---') {
                        updates[`/geral/${bol}/LONGITUDE`] = primeiroComCoord.LONGITUDE;
                    }
                }
            });

        // ── FLUXO PADRÃO: demais tipos ─────────────────────────────────────────
        } else {
            bufferDados.forEach((d, index) => {
                const safeId = d.BOLETIM;
                const infoExistente = dadosGerais[safeId] || {};

                // Cruzamento: prefere dado novo; se "---", usa o que já existe no Firebase
                let dadoFinal = {
                    ...d,
                    SOLICITANTE:  (d.SOLICITANTE  && d.SOLICITANTE  !== "---") ? tratar(d.SOLICITANTE)  : tratar(infoExistente.SOLICITANTE),
                    LATITUDE:     (d.LATITUDE     && d.LATITUDE     !== "---") ? tratar(d.LATITUDE)     : tratar(infoExistente.LATITUDE),
                    LONGITUDE:    (d.LONGITUDE    && d.LONGITUDE    !== "---") ? tratar(d.LONGITUDE)    : tratar(infoExistente.LONGITUDE),
                    CIDADE:       (d.CIDADE       && d.CIDADE       !== "---") ? tratar(d.CIDADE)       : tratar(infoExistente.CIDADE),
                    // Preserva OBITO caso já tenha sido importado anteriormente pela planilha de pessoas
                    OBITO:        tratar(infoExistente.OBITO) !== "---" ? tratar(infoExistente.OBITO) : "N",
                    import_at: agora
                };

                if (tipo === 'geral') {
                    updates[`/geral/${safeId}`] = dadoFinal;

                    const tipGeral = (d.TIPIFICACAO_GERAL || "").toUpperCase();
                    const solucao  = (d.SOLUÇÃO || "").toUpperCase();
                    const tipNorm  = tipGeral.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

                    if (solucao.includes("TCO"))
                        updates[`/tco/${safeId}`] = dadoFinal;

                    if (tipGeral.includes("MULHER") || tipGeral.includes("DOMÉSTICA") || tipGeral.includes("DOMESTICA"))
                        updates[`/violencia_domestica/${safeId}`] = dadoFinal;

                    if (tipGeral.includes("ROUBO")     || tipGeral.includes("EXTORÇÃO")  ||
                        tipGeral.includes("LATROCÍNIO") || tipGeral.includes("LATROCINIO") ||
                        tipGeral.includes("EXTORSÃO")  || tipGeral.includes("EXTORSAO")  ||
                        tipGeral.includes("EXTORSÃO MEDIANTE SEQUESTRO") ||
                        tipGeral.includes("EXTORSAO MEDIANTE SEQUESTRO"))
                        updates[`/cvp/${safeId}`] = dadoFinal;

                    // ── CVLI: inclui "TENTATIVA com OBITO=S" mesmo na importação geral ──
                    const ehCvliDireto  = tipNorm.includes("HOMICIDIO") || tipNorm.includes("CVLI") ||
                                          tipNorm.includes("LATROCINIO") || tipNorm.includes("FEMINICIDIO");
                    const ehTentativa   = tipNorm.includes("TENTATIVA");
                    const obitoPrevio   = tratar(infoExistente.OBITO) === "S";

                    if (ehCvliDireto || (ehTentativa && obitoPrevio)) {
                        updates[`/cvli/${safeId}`] = {
                            ...dadoFinal,
                            ...(ehTentativa && obitoPrevio
                                ? { CLASSIFICACAO_CVLI: "HOMICÍDIO (TENTATIVA COM ÓBITO)" }
                                : {})
                        };
                    }

                    if (tipGeral.includes("SOSSEGO"))  updates[`/sossego/${safeId}`]   = dadoFinal;
                    if (tipGeral.includes("MANDADO"))  updates[`/mandados/${safeId}`]  = dadoFinal;

                } else {
                    // Coleções específicas: ID determinístico por tipo para evitar duplicatas.
                    // Arma   → BOLETIM_SERIE   (uma arma é única pelo boletim + número de série)
                    // Droga  → BOLETIM_TIPO     (uma droga por tipo/boletim)
                    // Veículo→ BOLETIM_PLACA    (um veículo por placa/boletim)
                    // Objeto → BOLETIM_DESCRICAO_index (pode haver vários objetos por boletim)
                    // Autor  → BOLETIM_NOME     (um autor por nome/boletim)
                    let uniqueId;
                    if (tipo === 'arma') {
                        const serie = (d.SERIE || 'SSERIE').toString().trim().replace(/[^a-zA-Z0-9]/g, '_');
                        uniqueId = `${safeId}_${serie}`;
                    } else if (tipo === 'droga') {
                        const tipoDroga = (d.TIPO_DROGA || 'STIPO').toString().trim().replace(/[^a-zA-Z0-9]/g, '_');
                        uniqueId = `${safeId}_${tipoDroga}`;
                    } else if (tipo === 'veiculo') {
                        const placa = (d.PLACA || 'SPLACA').toString().trim().replace(/[^a-zA-Z0-9]/g, '_');
                        uniqueId = `${safeId}_${placa}`;
                    } else if (tipo === 'autor') {
                        const nome = (d.NOME || 'SNOME').toString().trim().replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
                        uniqueId = `${safeId}_${nome}`;
                    } else {
                        // objeto e outros: usa index como fallback (múltiplos por boletim)
                        uniqueId = `${safeId}_${index}`;
                    }

                    // ── Autor no 10º BPM: vai para a API PHP/MySQL da
                    // Hostinger, não mais para o Firebase (ver P3.Autores em
                    // js/core/session.js e hostinger-api/). Demais unidades
                    // e demais tipos seguem 100% Firebase, sem mudança.
                    if (tipo === 'autor' && cfgUnidade && P3.Autores.usaApiPhp(cfgUnidade)) {
                        // `unidade`: preferência é a coluna "Unidade" que já
                        // vem PRONTA, linha a linha, na planilha do CAD
                        // (BOPE, ROTAM, 1º BPM, 3ª CPM/I...) — normalizada
                        // só pra padronizar a variante do 10º BPM. Só cai
                        // pro campo manual (#input-unidade-relatorio) se a
                        // planilha usada não tiver essa coluna. Ver coluna
                        // `unidade` em hostinger-api/migrar_autores_unidade.sql.
                        const unidadeLinha = normalizarUnidadeAutor(d.UNIDADE) || unidadeRelatorioAutor || null;
                        autoresParaApi.push(Object.assign({ _id: uniqueId, unidade: unidadeLinha }, dadoFinal));
                    } else {
                        updates[`/${tipo}/${uniqueId}`] = dadoFinal;
                    }
                }
            });
        }

        // ── ENVIO EM LOTES DE 100 (Firebase) ────────────────────────────────────
        const LOTE = 100;
        const chaves = Object.keys(updates);
        const totalGeral = chaves.length + autoresParaApi.length;
        let salvos = 0;

        for (let i = 0; i < chaves.length; i += LOTE) {
            const lote = {};
            chaves.slice(i, i + LOTE).forEach(k => { lote[k] = updates[k]; });
            await db.ref().update(lote);
            salvos += Object.keys(lote).length;
            if (onProgresso && totalGeral) onProgresso(`SINCRONIZANDO… ${Math.round(salvos / totalGeral * 100)}%`);
        }

        // ── ENVIO PARA A API PHP/MySQL (autores do 10º BPM) ─────────────────────
        let salvosApi = 0;
        if (autoresParaApi.length) {
            if (onProgresso) onProgresso('SINCRONIZANDO AUTORES (HOSTINGER)…');
            const resultado = await P3.Autores.importarLote(cfgUnidade, autoresParaApi);
            salvosApi = resultado.gravados || 0;
        }

        return { salvos, salvosApi };
    }
}

// Wrapper do botão manual (upload de .xls) — lê tipo/unidade da própria
// tela, chama sincronizarBufferComNuvem com o `bufferDados` global
// (preenchido por LEITURA DO ARQUIVO XLS acima) e cuida da UI (texto do
// botão, alert, reload) — igual sempre se comportou.
document.getElementById('btn-save-cloud').onclick = async function() {
    const btn = this;
    const tipo = document.getElementById('tipo-colecao').value;
    // Fallback SÓ pra quando a planilha de autores não tiver a coluna
    // "Unidade" (a maioria já tem — ver coluna UNIDADE em MAPA_AUTOR e
    // normalizarUnidadeAutor) — usado linha a linha só se d.UNIDADE vier
    // vazio (ver sincronizarBufferComNuvem).
    const unidadeRelatorioAutor = normalizarUnidadeAutor(document.getElementById('input-unidade-relatorio').value);

    btn.disabled = true;
    btn.innerText = "SINCRONIZANDO...";

    try {
        const { salvos, salvosApi } = await sincronizarBufferComNuvem(tipo, bufferDados, unidadeRelatorioAutor, txt => { btn.innerText = txt; });
        const partes = [];
        if (salvos) partes.push(`${salvos} escrita(s) no Firebase`);
        if (salvosApi) partes.push(`${salvosApi} autor(es) na Hostinger`);
        alert(`Sincronização concluída! ${partes.join(' + ') || 'nada a gravar'}.`);
        location.reload();
    } catch (err) {
        console.error("Erro na sincronização:", err);
        alert("Erro crítico: " + err.message);
        btn.disabled = false;
        btn.innerText = "SALVAR NA NUVEM";
    }
};

// ─────────────────────────────────────────────────────────────────────
// SINCRONIZAÇÃO DIRETA DO CAD (02/09/2026, pedido explícito do usuário:
// "quero que faça um botão no cadastro de ocorrências para realizar
// automaticamente a busca dos dados de ocorrencias diretamente do CAD e
// sincronizá-las com o firebase e a hostinger como já está sendo feito
// manualmente") — busca 4 grades do CAD (ocorrências geral, envolvidos,
// armas, drogas) via o mesmo Apps Script já usado pelo Preditiva CAD
// (js/preditivaCAD.js:GAS_CAD_URL — ver apps-script/rastreamento.gs,
// ações 'ocorrencias'/'envolvidos'/'armas'/'drogas'), converte cada
// grade pro MESMO formato que sincronizarBufferComNuvem já espera (o
// formato que antes só vinha do upload manual de .xls) e reaproveita
// EXATAMENTE aquela função de gravação — nenhuma lógica de cruzamento/
// classificação/dedup foi duplicada.
//
// Um único grid de "envolvidos" cobre TANTO Autores quanto Pessoas
// (Óbito) — o CAD não separa isso em 2 buscas diferentes como a
// planilha manual fazia; aqui é 1 busca só, convertida pros 2 formatos
// (autor filtra só ENVOLVIMENTO=AUTOR; pessoa usa TODAS as linhas, já
// que "Óbito?" pode se aplicar a vítima/testemunha também).
// ─────────────────────────────────────────────────────────────────────

// Mesmo projeto/URL Apps Script já usado por js/preditivaCAD.js,
// js/core/previsaoMensalCad.js, js/core/cad-login-modal.js etc. — um
// login/token só, configurado 1x em qualquer uma dessas telas.
const GAS_CAD_URL_SYNC_ = 'https://script.google.com/macros/s/AKfycbwuyKpN4AbmV_CmQfZr2olClY1JveArwKEcJE3__DFf74xfnd3AlhXqnde7RPkXDlqx/exec';

async function _fetchCadSync_(acao, params) {
    const qs = new URLSearchParams(Object.assign({ acao: acao }, params || {})).toString();
    const resp = await fetch(GAS_CAD_URL_SYNC_ + '?' + qs, { redirect: 'follow' });
    const texto = await resp.text();
    try { return JSON.parse(texto); }
    catch (e) { throw new Error('Resposta do Apps Script não é JSON válido: ' + texto.substring(0, 200)); }
}

// Mesmo mecanismo de retomada de js/preditivaCAD.js:buscarOcorrenciasComRetomada_
// (períodos grandes não cabem no teto de ~6min de 1 execução do Apps
// Script — cada resposta truncada por tempo/páginas vem com
// `proximoOffset`, usado como offsetInicial da PRÓXIMA chamada, uma
// execução nova com teto fresco), generalizado pra qualquer uma das 4
// ações (acao: 'ocorrencias' | 'envolvidos' | 'armas' | 'drogas').
const MAX_PARTES_RETOMADA_SYNC_ = 6;

// PONTO DE ENTRADA (02/09/2026) — prefere o atualizador-local (Python,
// ver tools/atualizador-local/cad_grades.py) quando ele estiver
// rodando: sem os tetos de tempo/tamanho de execução do Apps Script
// que causaram "Resposta do Apps Script não é JSON válido" num período
// grande (pedido explícito do usuário depois desse erro: "veja a
// possibilidade de migrar essa coleta para o python para poder ser
// mais rápido"). Só cai pro Apps Script (função abaixo) se o servidor
// local não estiver disponível, OU se a chamada ao Python falhar no
// meio do caminho — mesmo espírito de fallback já usado por
// cad-busca-foto.js/autores.js com P3AtualizadorLocal.
async function _buscarGradeCadComRetomada_(acao, dataIni, dataFim, statusFn) {
    if (window.P3AtualizadorLocal) {
        let disponivelLocal = false;
        try { disponivelLocal = await window.P3AtualizadorLocal.disponivel(); } catch (e) { disponivelLocal = false; }
        if (disponivelLocal) {
            try {
                if (statusFn) statusFn(`⏳ ${acao}: buscando via atualizador local (Python)…`);
                const resultado = await window.P3AtualizadorLocal.buscarGradeCad(acao, dataIni, dataFim, function (evt) {
                    if (statusFn) statusFn(`⏳ ${acao}: página ${evt.pagina}/${evt.totalPaginas} — ${evt.registros} de ${evt.totalReal} já carregado(s)…`);
                });
                if (resultado) return resultado;
            } catch (e) {
                console.warn('[cadastroocorrencias] atualizador local falhou em ' + acao + ', caindo pro Apps Script:', e.message);
                if (statusFn) statusFn(`⚠️ Atualizador local falhou (${e.message}) — tentando via Apps Script…`);
            }
        }
    }
    return _buscarGradeCadViaAppsScript_(acao, dataIni, dataFim, statusFn);
}

async function _buscarGradeCadViaAppsScript_(acao, dataIni, dataFim, statusFn) {
    let parte = 1;
    let resp = await _fetchCadSync_(acao, { dataIni: dataIni, dataFim: dataFim });
    if (resp.ok === false) return resp;
    let dadosAcumulados = resp.dados || [];

    while (resp.truncado && resp.proximoOffset && parte < MAX_PARTES_RETOMADA_SYNC_) {
        parte++;
        if (statusFn) statusFn(`⏳ ${acao}: parte ${parte} — ${dadosAcumulados.length} de ${resp.totalRelatadoPeloCAD || '?'} já carregada(s)…`);
        resp = await _fetchCadSync_(acao, {
            dataIni: dataIni, dataFim: dataFim,
            offsetInicial: String(resp.proximoOffset),
            totalConhecido: String(resp.totalRelatadoPeloCAD || ''),
            parte: String(parte),
        });
        if (resp.ok === false) {
            return { ok: true, dados: dadosAcumulados, totalRelatadoPeloCAD: resp.totalRelatadoPeloCAD, truncado: true, motivoTruncamento: 'falha ao retomar (parte ' + parte + '): ' + (resp.erro || 'erro desconhecido') };
        }
        // Dedup por linha inteira (BOLETIM sozinho não é único em
        // armas/drogas/envolvidos — mesmo cuidado do backend, ver
        // _buscarGradeGenericaCAD_ em rastreamento.gs) — protege contra
        // sobreposição acidental de offset entre partes.
        const vistos = {};
        dadosAcumulados.forEach(function (it) { vistos[JSON.stringify(it)] = true; });
        (resp.dados || []).forEach(function (it) {
            const chave = JSON.stringify(it);
            if (!vistos[chave]) { vistos[chave] = true; dadosAcumulados.push(it); }
        });
    }
    return { ok: true, dados: dadosAcumulados, totalRelatadoPeloCAD: resp.totalRelatadoPeloCAD, truncado: resp.truncado, motivoTruncamento: resp.motivoTruncamento };
}

// Troca "" (campo vazio/só &nbsp; já limpo pelo Apps Script) por "---" —
// mesmo sentinela de "sem valor" usado pelo fluxo de upload manual (ver
// buscarValor: `(v || "---")`), pra dedup/exibição ficarem consistentes
// entre um registro importado via .xls e um sincronizado direto do CAD.
function _semVazios_(obj) {
    const out = {};
    Object.keys(obj).forEach(function (k) {
        const v = obj[k];
        out[k] = (v === undefined || v === null || v === '') ? '---' : v;
    });
    return out;
}

// "DD/MM/AAAA HH:MM:SS" (formato de ocor_dt_ocor no CAD, armas/drogas/
// envolvidos) -> {data, hora} — mesma convenção DATA/HORA separadas que
// o fluxo de upload manual sempre usou (ver LEITURA DO ARQUIVO XLS acima).
function _dividirDataHoraCad_(dataCompleta) {
    const s = (dataCompleta || '').toString().trim();
    const m = s.match(/^(\d{2}\/\d{2}\/\d{4})[ T]?(\d{2}:\d{2})?/);
    if (!m) return { data: s || '---', hora: '00:00' };
    return { data: m[1], hora: m[2] || '00:00' };
}

// ── Conversores — grade do CAD (Apps Script) -> mesmo formato de item
// que sincronizarBufferComNuvem já recebe do upload manual de .xls.
// Nomes de chave espelham EXATAMENTE os alvos de MAPA_GERAL/MAPA_ARMA/
// MAPA_DROGA/MAPA_AUTOR/MAPA_PESSOA acima — não são coincidência.
function converterGeralParaBuffer(dadosCad) {
    return (dadosCad || []).filter(function (it) { return it.BOLETIM; }).map(function (it) {
        return _semVazios_({
            BOLETIM: it.BOLETIM,
            DATA: it.DATA,
            HORA: it.HORA,
            // ATENÇÃO: chave com acento de propósito — sincronizarBufferComNuvem
            // lê `d.SOLUÇÃO` (não SOLUCAO) pra detectar TCO (ver "FLUXO
            // PADRÃO" mais acima) — mesma grafia usada pelo cabeçalho
            // "Solução" da planilha do CAD, reproduzida aqui.
            'SOLUÇÃO': it.SOLUCAO,
            TIPIFICACAO: it.TIPIFICACAO,
            TIPIFICACAO_GERAL: it.TIPIFICACAO_GERAL,
            ATENDIMENTO_INICIAL: '---', // não extraído pelo backend ainda (ver extrairCamposLinha_)
            TEXTO_DESPACHANTE: '---',
            BAIRRO: it.BAIRRO,
            LOGRADOURO: '---',
            SOLICITANTE: it.SOLICITANTE,
            LATITUDE: it.LATITUDE,
            LONGITUDE: it.LONGITUDE,
            CIDADE: it.CIDADE,
            ESTABELECIMENTO: '---',
            ATENDENTE: it.ATENDENTE,
        });
    });
}

function converterArmasParaBuffer(dadosCad) {
    return (dadosCad || []).filter(function (it) { return it.BOLETIM; }).map(function (it) {
        const dh = _dividirDataHoraCad_(it.DATA);
        return _semVazios_(Object.assign({}, it, { DATA: dh.data, HORA: dh.hora }));
    });
}

function converterDrogasParaBuffer(dadosCad) {
    return (dadosCad || []).filter(function (it) { return it.BOLETIM; }).map(function (it) {
        const dh = _dividirDataHoraCad_(it.DATA);
        return _semVazios_(Object.assign({}, it, { DATA: dh.data, HORA: dh.hora }));
    });
}

// Só as linhas com ENVOLVIMENTO=AUTOR — mesmo recorte que a planilha
// "Relatório de Autores" já representava.
function converterEnvolvidosParaBufferAutor(dadosCad) {
    return (dadosCad || [])
        .filter(function (it) { return it.BOLETIM && (it.ENVOLVIMENTO || '').toUpperCase().trim() === 'AUTOR'; })
        .map(function (it) {
            const dh = _dividirDataHoraCad_(it.DATA);
            // MES/ANO_OCORRENCIA (mes_ocor/ano_ocor no CAD) dependem da
            // seleção de colunas persistida na conta do CAD (ver aviso em
            // rastreamento.gs) — se vier vazio, deriva da própria data.
            const mesFallback = dh.data !== '---' ? dh.data.split('/')[1] : '---';
            const anoFallback = dh.data !== '---' ? dh.data.split('/')[2] : '---';
            return _semVazios_({
                BOLETIM: it.BOLETIM,
                DATA: dh.data, HORA: dh.hora,
                NOME: it.NOME,
                SITUACAO: it.SITUACAO,
                NARRATIVA: '---', // não selecionado nesta grade (ver aviso em rastreamento.gs)
                NATUREZA: it.NATUREZA,
                TIPIFICACAO: it.TIPIFICACAO,
                BAIRRO: it.BAIRRO,
                CIDADE: it.CIDADE,
                LOGRADOURO: it.LOGRADOURO,
                MES: it.MES_OCORRENCIA || mesFallback,
                ANO: it.ANO_OCORRENCIA || anoFallback,
                ENVOLVIMENTO: it.ENVOLVIMENTO,
                CPF: it.CPF,
                UNIDADE: it.UNIDADE,
            });
        });
}

// TODAS as linhas (não só AUTOR) — "Óbito?" vale pra qualquer papel na
// ocorrência (vítima, testemunha etc.), mesmo espírito de MAPA_PESSOA.
function converterEnvolvidosParaBufferPessoa(dadosCad) {
    return (dadosCad || []).filter(function (it) { return it.BOLETIM; }).map(function (it) {
        // Mesma normalização que a LEITURA DO ARQUIVO XLS já aplicava —
        // reproduzida aqui porque este caminho não passa por ela.
        const raw = (it.OBITO || '').toString().trim().toUpperCase();
        const obito = (raw === 'S' || raw === 'SIM' || raw === '1') ? 'S' : 'N';
        return _semVazios_({
            BOLETIM: it.BOLETIM,
            NOME: it.NOME,
            OBITO: obito,
            SITUACAO: it.SITUACAO,
            NATUREZA: it.NATUREZA,
            SEXO: it.SEXO,
            IDADE: it.IDADE,
            TIPIFICACAO: it.TIPIFICACAO,
        });
    });
}

// Orquestra as 4 buscas + 5 gravações (geral, autor, pessoa, arma,
// droga) em sequência — sequencial de propósito, não Promise.all: cada
// busca no CAD usa a MESMA sessão (LockService do lado do Apps Script já
// rejeitaria chamadas concorrentes) e a gravação de 'geral' precisa
// terminar ANTES das demais, que cruzam contra /geral já atualizado.
async function sincronizarDiretoDoCad(dataIni, dataFim, statusFn) {
    // TRAVA (02/09/2026, achado durante revisão com o usuário) — os
    // templates de busca (CAD_BODY_TEMPLATE_ARMAS_/DROGAS_/ENVOLVIDOS_/
    // CAD_BODY_TEMPLATE_ em rastreamento.gs) têm o filtro de Unidade
    // FIXO em "10º BPM" (mesma credencial única do CAD, compartilhada
    // por todo o Apps Script — não por unidade logada no P3). Cada
    // unidade do P3 já tem seu PRÓPRIO Firebase isolado (confirmado:
    // 10º BPM e 11º BPM são projetos Firebase diferentes, não dá pra um
    // sobrescrever o outro) — mas sem esta trava, uma unidade que NÃO
    // seja o 10º BPM clicando neste botão gravaria as ocorrências do
    // 10º BPM dentro do PRÓPRIO banco dela (dado errado pra ela, mesmo
    // não tocando no banco do 10º BPM). Reaproveita a checagem já usada
    // em page/solucoesia.html pro card "Preditiva CAD".
    const sessao = (window.P3 && window.P3.getSession) ? window.P3.getSession() : null;
    if (!sessao || sessao.unidadeId !== '10bpm') {
        throw new Error('A sincronização direta do CAD só está disponível pro 10º BPM (login/credenciais do CAD configurados são específicos desta unidade).');
    }
    const unidadeRelatorioAutor = normalizarUnidadeAutor(document.getElementById('input-unidade-relatorio').value) || '10bpm';
    const resumo = [];
    function status(txt) { if (statusFn) statusFn(txt); }

    status('⏳ Buscando ocorrências gerais no CAD…');
    const respGeral = await _buscarGradeCadComRetomada_('ocorrencias', dataIni, dataFim, status);
    if (respGeral.ok === false) throw new Error('Ocorrências gerais: ' + (respGeral.erro || 'falha desconhecida'));
    const bufGeral = converterGeralParaBuffer(respGeral.dados);
    status(`💾 Gravando ${bufGeral.length} ocorrência(s) geral(is)…`);
    await sincronizarBufferComNuvem('geral', bufGeral, unidadeRelatorioAutor, status);
    resumo.push(`Geral: ${bufGeral.length}${respGeral.truncado ? ' (parcial — ' + respGeral.motivoTruncamento + ')' : ''}`);

    status('⏳ Buscando envolvidos no CAD…');
    const respEnv = await _buscarGradeCadComRetomada_('envolvidos', dataIni, dataFim, status);
    if (respEnv.ok === false) throw new Error('Envolvidos: ' + (respEnv.erro || 'falha desconhecida'));
    const bufAutor = converterEnvolvidosParaBufferAutor(respEnv.dados);
    const bufPessoa = converterEnvolvidosParaBufferPessoa(respEnv.dados);
    status(`💾 Gravando ${bufAutor.length} autor(es)…`);
    const rAutor = await sincronizarBufferComNuvem('autor', bufAutor, unidadeRelatorioAutor, status);
    resumo.push(`Autores: ${bufAutor.length} (${(rAutor.salvos || 0) + (rAutor.salvosApi || 0)} gravação(ões))`);
    status(`💾 Gravando ${bufPessoa.length} pessoa(s) (óbito)…`);
    await sincronizarBufferComNuvem('pessoa', bufPessoa, unidadeRelatorioAutor, status);
    resumo.push(`Pessoas: ${bufPessoa.length}${respEnv.truncado ? ' (parcial — ' + respEnv.motivoTruncamento + ')' : ''}`);

    status('⏳ Buscando armas no CAD…');
    const respArmas = await _buscarGradeCadComRetomada_('armas', dataIni, dataFim, status);
    if (respArmas.ok === false) throw new Error('Armas: ' + (respArmas.erro || 'falha desconhecida'));
    const bufArmas = converterArmasParaBuffer(respArmas.dados);
    status(`💾 Gravando ${bufArmas.length} arma(s)…`);
    await sincronizarBufferComNuvem('arma', bufArmas, unidadeRelatorioAutor, status);
    resumo.push(`Armas: ${bufArmas.length}${respArmas.truncado ? ' (parcial — ' + respArmas.motivoTruncamento + ')' : ''}`);

    status('⏳ Buscando drogas no CAD…');
    const respDrogas = await _buscarGradeCadComRetomada_('drogas', dataIni, dataFim, status);
    if (respDrogas.ok === false) throw new Error('Drogas: ' + (respDrogas.erro || 'falha desconhecida'));
    const bufDrogas = converterDrogasParaBuffer(respDrogas.dados);
    status(`💾 Gravando ${bufDrogas.length} droga(s)…`);
    await sincronizarBufferComNuvem('droga', bufDrogas, unidadeRelatorioAutor, status);
    resumo.push(`Drogas: ${bufDrogas.length}${respDrogas.truncado ? ' (parcial — ' + respDrogas.motivoTruncamento + ')' : ''}`);

    return resumo;
}

document.addEventListener('DOMContentLoaded', function () {
    const btnCad = document.getElementById('btn-sync-cad');
    if (!btnCad) return;

    // Só mostra a seção pro 10º BPM — ver comentário grande em
    // sincronizarDiretoDoCad (a checagem de verdade é lá; esta aqui só
    // evita mostrar um botão que vai dar erro de propósito pra quem não
    // é do 10º BPM).
    const secaoSyncCad = document.getElementById('secao-sync-cad');
    const sessaoAtual = (window.P3 && window.P3.getSession) ? window.P3.getSession() : null;
    if (secaoSyncCad) secaoSyncCad.style.display = (sessaoAtual && sessaoAtual.unidadeId === '10bpm') ? '' : 'none';
    if (!sessaoAtual || sessaoAtual.unidadeId !== '10bpm') return;

    btnCad.addEventListener('click', async function () {
        const dataIni = document.getElementById('sync-cad-data-ini').value;
        const dataFim = document.getElementById('sync-cad-data-fim').value;
        const statusEl = document.getElementById('sync-cad-status');
        if (!dataIni || !dataFim) { alert('Escolha a data inicial e final do período.'); return; }
        if (!confirm(`Buscar e sincronizar automaticamente ocorrências/envolvidos/armas/drogas do CAD entre ${dataIni} e ${dataFim}? Isso pode levar alguns minutos.`)) return;

        btnCad.disabled = true;
        const textoOriginal = btnCad.innerText;
        try {
            await _ensureFirebase();
            const resumo = await sincronizarDiretoDoCad(dataIni, dataFim, function (txt) {
                if (statusEl) statusEl.textContent = txt;
                btnCad.innerText = 'SINCRONIZANDO…';
            });
            if (statusEl) statusEl.textContent = '✅ ' + resumo.join(' · ');
            alert('Sincronização direta do CAD concluída!\n\n' + resumo.join('\n'));
        } catch (err) {
            console.error('Erro na sincronização direta do CAD:', err);
            if (statusEl) statusEl.textContent = '⚠️ Erro: ' + err.message;
            alert('Erro na sincronização direta do CAD: ' + err.message);
        } finally {
            btnCad.disabled = false;
            btnCad.innerText = textoOriginal;
        }
    });
});

// ─────────────────────────────────────────────
// INTERFACE: Relógio e Login
// ─────────────────────────────────────────────
function atualizarrelogio() {
    const relogio = document.getElementById('relogio');
    const agora = new Date();
    const horas    = String(agora.getHours()).padStart(2, '0');
    const minutos  = String(agora.getMinutes()).padStart(2, '0');
    const segundos = String(agora.getSeconds()).padStart(2, '0');
    relogio.innerText = `${horas}:${minutos}:${segundos}`;
}

function exibirUsuario() {
    const userInfoDiv = document.getElementById('user-info');
    const usuarioLogado = JSON.parse(localStorage.getItem('usuarioLogado'));
    userInfoDiv.innerText = usuarioLogado ? `Olá, ${usuarioLogado.nome}` : '';
}

function logout() {
    localStorage.clear();
    window.location.href = "../page/login.html";
}

document.addEventListener('DOMContentLoaded', async () => {
    // Logout — conectado antes do await de configuração de rede abaixo,
    // para não depender de Firebase/GAS responderem para funcionar.
    document.getElementById('btn-logout').addEventListener('click', logout);

    await _ensureFirebase();
    atualizarrelogio();
    setInterval(atualizarrelogio, 1000);
    exibirUsuario();
});
