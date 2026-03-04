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

// Variável de controle
let bufferDados = [];

// Mapas de colunas (Mantidos do seu código original)
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

const MAPA_ARMA = { "BOLETIM": ["Ocorrência", "Boletim"], "SERIE": ["Serie"], "TIPO_ARMA": ["Tipo"], "CALIBRE": ["Calibre"], "MARCA": ["Marca"], "BAIRRO": ["Bairro"] };
const MAPA_DROGA = { "BOLETIM": ["Boletim"], "QUANTIDADE": ["Quantidade"], "TIPO_DROGA": ["Tipo"] };
const MAPA_VEICULO = { "BOLETIM": ["Ocorrência", "Boletim"], "PLACA": ["Placa"] };

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

// ... (Os outros mapas seguem a mesma lógica do seu app.js)

// Função de busca de valor nas colunas
function buscarValor(linha, lista) {
    for (let n of lista) {
        let achou = Object.keys(linha).find(c => c.trim().toLowerCase() === n.toLowerCase());
        if (achou) return linha[achou];
    }
    return null;
}

// Lógica de leitura do arquivo
document.getElementById('input-xls').onchange = function(e) {
    const tipo = document.getElementById('tipo-colecao').value;
    if(!tipo) { alert("Selecione o tipo primeiro!"); e.target.value = ""; return; }
    
    const reader = new FileReader();
    reader.onload = function(evt) {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, {type: 'array'});
        const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        
        const mapas = { 
            'geral': MAPA_GERAL, 'arma': MAPA_ARMA, 'droga': MAPA_DROGA, 
            'veiculo': MAPA_VEICULO, 'objeto': MAPA_OBJETO, 'autor': MAPA_AUTOR 
        };
        const mapa = mapas[tipo];

        bufferDados = json.map(linha => {
            let item = {};
            
            // ID DO BOLETIM
            let rawOcorrencia = buscarValor(linha, ["Nº Ocorrência", "Boletim", "Ocorrência"]) || "";
            let strOco = rawOcorrencia.toString().trim();
            let idLimpo = strOco.replace(/\D/g, '').substring(0, 7);

            // DATA E HORA SEPARADOS
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

            for(let chave in mapa) {
                let v = buscarValor(linha, mapa[chave]);
                // Trata especificamente latitude/longitude para manter todas as casas decimais
                if(chave === "LATITUDE" || chave === "LONGITUDE") {
                    item[chave] = v ? v.toString() : "---";
                } else {
                    item[chave] = (chave === "BOLETIM") ? idLimpo : (v || "---");
                }
            }

            item["DATA"] = dataFinal;
            item["HORA"] = horaFinal;
            
            return item;
        }).filter(i => i.BOLETIM && i.BOLETIM !== "");

        document.getElementById('status-msg').innerText = `✓ ${bufferDados.length} registros prontos para salvar.`;
        document.getElementById('btn-save-cloud').style.display = "block";
    };
    reader.readAsArrayBuffer(e.target.files[0]);
};

// Lógica de Salvar no Firebase
document.getElementById('btn-save-cloud').onclick = async function() {
    const btn = this;
    const tipo = document.getElementById('tipo-colecao').value;
    const updates = {};
    const agora = new Date().toISOString();
    
    btn.disabled = true;
    btn.innerText = "SINCRONIZANDO...";

    try {
        // 1. Busca todos os dados do nó 'geral' para fazer o cruzamento (igual à lógica do app.js)
        const snapshotGeral = await db.ref('geral').once('value');
        const dadosGerais = snapshotGeral.val() || {};

        bufferDados.forEach((d, index) => {
            let safeId = d.BOLETIM;
            // Busca dados existentes no nó geral para este boletim
            let infoExistente = dadosGerais[safeId] || {};
            
            // Função interna para garantir que nenhum valor seja 'undefined'
            const tratar = (valor) => (valor === undefined || valor === null) ? "---" : valor;

            // 2. Lógica de Cruzamento: Se o dado atual for "---", tenta pegar do nó Geral
            let dadoFinal = { 
                ...d, 
                SOLICITANTE: (d.SOLICITANTE && d.SOLICITANTE !== "---") ? tratar(d.SOLICITANTE) : tratar(infoExistente.SOLICITANTE),
                LATITUDE: (d.LATITUDE && d.LATITUDE !== "---") ? tratar(d.LATITUDE) : tratar(infoExistente.LATITUDE),
                LONGITUDE: (d.LONGITUDE && d.LONGITUDE !== "---") ? tratar(d.LONGITUDE) : tratar(infoExistente.LONGITUDE),
                CIDADE: (d.CIDADE && d.CIDADE !== "---") ? tratar(d.CIDADE) : tratar(infoExistente.CIDADE),
                import_at: agora 
            };

            // 3. Distribuição dos dados pelos nós (Lógica de Negócio)
            if (tipo === 'geral') {
                updates[`/geral/${safeId}`] = dadoFinal;
                
                // Filtros Automáticos para sub-nós (Réplica da lógica do sistema anterior)
                const tipGeral = (d.TIPIFICACAO_GERAL || "").toUpperCase();
                const solucao = (d.SOLUÇÃO || "").toUpperCase();

                if (solucao.includes("TCO")) updates[`/tco/${safeId}`] = dadoFinal;
                if (tipGeral.includes("MULHER") || tipGeral.includes("DOMÉSTICA")) updates[`/violencia_domestica/${safeId}`] = dadoFinal;
                if (tipGeral.includes("ROUBO") || tipGeral.includes("FURTO") || tipGeral.includes("EXTORÇÃO") ||tipGeral.includes("LATROCÍNIO") || (tipGeral.includes("DANO") && !tipGeral.includes("PERIGO"))) updates[`/cvp/${safeId}`] = dadoFinal;
                if (tipGeral.includes("HOMICIDIO") || tipGeral.includes("CVLI")) updates[`/cvli/${safeId}`] = dadoFinal;
                if (tipGeral.includes("SOSSEGO")) updates[`/sossego/${safeId}`] = dadoFinal;
                if (tipGeral.includes("MANDADO")) updates[`/mandados/${safeId}`] = dadoFinal;
            } else {
                // Para coleções específicas (arma, droga, veiculo), cria ID único
                let uniqueId = `${safeId}_${index}`;
                updates[`/${tipo}/${uniqueId}`] = dadoFinal;
            }
        });

        // 4. Executa o update atômico no Firebase
        await db.ref().update(updates);
        alert("Sincronização realizada com sucesso e dados cruzados!");
        location.reload(); 

    } catch (e) {
        console.error("Erro na sincronização:", e);
        alert("Erro crítico: " + e.message);
        btn.disabled = false;
        btn.innerText = "SALVAR NA NUVEM";
    }
};
// Funções de Interface (Relógio e Login)
function atualizarrelogio() {
    const relogio = document.getElementById('relogio');
    const agora = new Date();
    const horas = String(agora.getHours()).padStart(2, '0');
    const minutos = String(agora.getMinutes()).padStart(2, '0');
    const segundos = String(agora.getSeconds()).padStart(2, '0');
    relogio.innerText = `${horas}:${minutos}:${segundos}`;
}
function logout() {
    localStorage.removeItem('usuarioLogado');
    window.location.href = '../index.html';
}
function exibirUsuario() {
    const userInfoDiv = document.getElementById('user-info');
    const usuarioLogado = JSON.parse(localStorage.getItem('usuarioLogado'));

    if (usuarioLogado) {
        userInfoDiv.innerText = `Olá, ${usuarioLogado.nome}`;
    } else {
        userInfoDiv.innerText = '';
    }
}


function logout() {
    localStorage.clear();
    window.location.href = "../index.html";
}

document.addEventListener('DOMContentLoaded', () => {
    atualizarrelogio();
    exibirUsuario();
    document.getElementById('btn-logout').addEventListener('click', logout);
});