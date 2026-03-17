const firebaseConfig = {
    apiKey: "AIzaSyAFflO2pvI7nFDNwFdK86-TK18o6_cpXr4",
    authDomain: "sistema-p3.firebaseapp.com",
    projectId: "sistema-p3",
    storageBucket: "sistema-p3.firebasestorage.app",
    messagingSenderId: "186813662716",
    appId: "1:186813662716:web:e2a85cc956ed561c541e79",
    databaseURL: "https://sistema-p3-default-rtdb.firebaseio.com"
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
    "ESTABELECIMENTO": ["Estabelecimento", "Local"]
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
    "ANO": ["Ano da Ocorrência"]
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
};

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
            'geral':   MAPA_GERAL,
            'arma':    MAPA_ARMA,
            'droga':   MAPA_DROGA,
            'veiculo': MAPA_VEICULO,
            'objeto':  MAPA_OBJETO,
            'autor':   MAPA_AUTOR,
            'pessoa':  MAPA_PESSOA   // NOVO
        };
        const mapa = mapas[tipo];

        bufferDados = json.map(linha => {
            let item = {};

            // ── ID DO BOLETIM ──────────────────────────────
            let rawOcorrencia = buscarValor(linha, ["Nº Ocorrência", "Boletim", "Ocorrência"]) || "";
            let strOco = rawOcorrencia.toString().trim();
            let idLimpo = strOco.replace(/\D/g, '').substring(0, 7);

            // ── DATA E HORA ────────────────────────────────
            let rawDataHora = buscarValor(linha, ["Data da Ocorrência", "Dia da Ocorrência", "Data"]) || "---";
            let dataFinal = "---";
            let horaFinal = "00:00";

            if (rawDataHora.toString().includes(" ")) {
                let partes = rawDataHora.toString().split(" ");
                dataFinal = partes[0].trim();
                horaFinal = partes[1].trim().substring(0, 5);
            } else {
                dataFinal = rawDataHora.toString().trim();
                horaFinal = strOco.length >= 5 ? strOco.slice(-5) : "00:00";
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
                    // Coleções específicas (arma, droga, veiculo, objeto, autor)
                    const uniqueId = `${safeId}_${index}`;
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