const firebaseConfig = {
    apiKey: "AIzaSyBRZn_EOfV6ozsx6NNzOlq1sjIV_xVm7xE",
    authDomain: "sistema-p3-v2.firebaseapp.com",
    projectId: "sistema-p3-v2",
    storageBucket: "sistema-p3-v2.firebasestorage.app",
    messagingSenderId: "1019080251258",
    appId: "1:1019080251258:web:93f9e299cf19b16189e8c3",
    databaseURL: "https://sistema-p3-v2-default-rtdb.firebaseio.com"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.database();

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
    "CPF": ["CPF"]
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
document.getElementById('btn-save-cloud').onclick = async function() {
    const btn = this;
    const tipo = document.getElementById('tipo-colecao').value;
    const updates = {};
    const agora = new Date().toISOString();

    btn.disabled = true;
    btn.innerText = "SINCRONIZANDO...";

    try {
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
                    updates[`/${tipo}/${uniqueId}`] = dadoFinal;
                }
            });
        }

        // ── ENVIO EM LOTES DE 100 ──────────────────────────────────────────────
        const LOTE = 100;
        const chaves = Object.keys(updates);
        let salvos = 0;

        for (let i = 0; i < chaves.length; i += LOTE) {
            const lote = {};
            chaves.slice(i, i + LOTE).forEach(k => { lote[k] = updates[k]; });
            await db.ref().update(lote);
            salvos += Object.keys(lote).length;
            btn.innerText = `SINCRONIZANDO… ${Math.round(salvos / chaves.length * 100)}%`;
        }

        alert(`Sincronização concluída! ${salvos} escritas enviadas ao Firebase.`);
        location.reload();

    } catch (err) {
        console.error("Erro na sincronização:", err);
        alert("Erro crítico: " + err.message);
        btn.disabled = false;
        btn.innerText = "SALVAR NA NUVEM";
    }
};

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
    window.location.href = "../index.html";
}

document.addEventListener('DOMContentLoaded', () => {
    atualizarrelogio();
    setInterval(atualizarrelogio, 1000);
    exibirUsuario();
    document.getElementById('btn-logout').addEventListener('click', logout);
});