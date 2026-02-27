const FIREBASE_URL = "https://sistema-p3-default-rtdb.firebaseio.com";

async function clicarBotaoGerar() {
    const select = document.getElementById("select-rp");
    const rpSelecionada = select.value;
    const container = document.getElementById("iframe-container");

    if (!rpSelecionada) {
        alert("Por favor, selecione uma guarnição.");
        return;
    }

    container.style.display = 'block';
    container.innerHTML = `<div style="text-align:center; padding: 30px; color: #003366;">
        <p><strong>🔥 Analisando Inteligência Criminal em Tempo Real...</strong></p>
    </div>`;

    const fetchData = async (node) => {
        try {
            const res = await fetch(`${FIREBASE_URL}/${node}.json`);
            return res.ok ? await res.json() : {};
        } catch (e) { return {}; }
    };

    try {
        const [geral, cvp, cvli, droga] = await Promise.all([
            fetchData('geral'), fetchData('cvp'), fetchData('cvli'), fetchData('droga')
        ]);

        const dadosInteligencia = processarDadosEstrategicos(rpSelecionada, { geral, cvp, cvli, droga });
        container.innerHTML = gerarTemplateHTML(dadosInteligencia);
        document.getElementById('btn-imprimir').style.display = "inline-block";
    } catch (error) {
        container.innerHTML = "<p style='color:red; text-align:center;'>Erro ao carregar dados.</p>";
    }
}

function processarDadosEstrategicos(cidadeFiltro, db) {
    const pesos = { cvli: 5, droga: 4, cvp: 3, geral: 1 };
    let manchas = { alvorada: {}, manha: {}, tarde: {}, noite1: {}, noite2: {} };

    const cidadeAlvo = cidadeFiltro.split('(')[0].trim().toUpperCase();

    // 1. PROCESSAMENTO DINÂMICO DA MANCHA
    Object.keys(db).forEach(categoria => {
        const registros = db[categoria];
        if (!registros) return;
        Object.values(registros).forEach(item => {
            if (!(item.CIDADE || "").toString().toUpperCase().includes(cidadeAlvo)) return;
            
            const bairro = (item.BAIRRO || "").toString().toUpperCase().trim();
            if (!bairro) return;

            const hora = parseInt((item.HORA || "00").split(":")[0], 10);
            const p = pesos[categoria] || 1;

            if (hora >= 5 && hora < 7) manchas.alvorada[bairro] = (manchas.alvorada[bairro] || 0) + p;
            else if (hora >= 7 && hora < 12) manchas.manha[bairro] = (manchas.manha[bairro] || 0) + p;
            else if (hora >= 12 && hora < 18) manchas.tarde[bairro] = (manchas.tarde[bairro] || 0) + p;
            else if (hora >= 18 && hora < 22) manchas.noite1[bairro] = (manchas.noite1[bairro] || 0) + p;
            else manchas.noite2[bairro] = (manchas.noite2[bairro] || 0) + p;
        });
    });

    // 2. FUNÇÃO QUE ELIMINA NOMES FIXOS
    const obterRotaReal = (dadosTurno) => {
        const ordenado = Object.keys(dadosTurno).sort((a, b) => dadosTurno[b] - dadosTurno[a]);
        if (ordenado.length > 0) {
            return "FOCO NOS BAIRROS: " + ordenado.slice(0, 3).join(", ");
        }
        // Se não houver crime no banco para a cidade/horário, usa termo genérico
        return "PATRULHAMENTO EM VIAS PRINCIPAIS E CENTRO COMERCIAL";
    };

    let cronograma = [];
    const guarnicaoNome = cidadeFiltro.toUpperCase();

    // 3. APLICAÇÃO DA LÓGICA POR TIPO DE RP (SEM LOCAIS FIXOS)
    if (guarnicaoNome.includes("RP 01")) {
        cronograma = [
            { ini: "08:30", fim: "13:00", miss: "Patrulhamento Setorial", det: obterRotaReal(manchas.manha) },
            { ini: "13:00", fim: "17:30", miss: "Almoço / Prontidão", det: "BASE OPERACIONAL", h: "yellow" },
            { ini: "18:00", fim: "19:00", miss: "JANTA", det: "BASE OPERACIONAL", h: "yellow" },
            { ini: "19:00", fim: "00:00", miss: "Rota Crítica Noite 1", det: obterRotaReal(manchas.noite1), h: "red" },
            { ini: "00:00", fim: "03:00", miss: "Rota Crítica Noite 2", det: obterRotaReal(manchas.noite2), h: "red" },
            { ini: "03:00", fim: "05:00", miss: "Descanso / Prontidão", det: "BASE OPERACIONAL" },
            { ini: "05:00", fim: "07:30", miss: "OPO Alvorada", det: "BARREIRAS E " + obterRotaReal(manchas.alvorada), h: "yellow" }
        ];
    } else if (guarnicaoNome.includes("RP 02")) {
        cronograma = [
            { ini: "08:00", fim: "13:00", miss: "Prontidão / Adm / ALMOÇO", det: "BASE OPERACIONAL", h: "yellow" },
            { ini: "12:00", fim: "18:00", miss: "Patrulhamento Setorial", det: obterRotaReal(manchas.tarde) },
            { ini: "18:00", fim: "19:00", miss: "Ronda Crítica Noite", det: obterRotaReal(manchas.noite1), h: "red" },
            { ini: "19:00", fim: "20:00", miss: "Janta / Prontidão", det: "BASE OPERACIONAL", h: "yellow" },
            { ini: "20:00", fim: "20:30", miss: "OPO - POLICIAMENTO ESCOLAR", det: "ESCOLA EST. MONSENHOR RIBEIRO - PALMEIRA DE FORA", h: "red" },
            { ini: "20:30", fim: "00:00", miss: "Rota Crítica Noite 1", det: obterRotaReal(manchas.noite1), h: "red" }, 
            { ini: "00:00", fim: "03:00", miss: "DESCANSO / PRONTIDÃO", det: "BASE OPERACIONAL", h: "yellow" },
            { ini: "03:00", fim: "05:00", miss: "Rota Crítica Noite 2", det: obterRotaReal(manchas.noite2), h: "red" },
            { ini: "05:00", fim: "07:00", miss: "Descanso / Prontidão", det: "BASE OPERACIONAL" }
        ];
    } else if (guarnicaoNome.includes("PAULO JACINTO")) { 
        cronograma = [
            { ini: "08:00", fim: "08:30", miss: "Apresentação", det: "APRESENTAÇÃO E PRELEÇÃO." },
            { ini: "08:30", fim: "13:00", miss: "Patrulhamento Geral", det: obterRotaReal(manchas.manha) },
            { ini: "13:00", fim: "16:30", miss: "Almoço e Prontidão", det: "BASE OPERACIONAL.", h: "yellow" },
            { ini: "16:30", fim: "19:00", miss: "Rota Prioritária Tarde", det: obterRotaReal(manchas.tarde), h: "blue" },
            { ini: "19:00", fim: "20:00", miss: "Janta e Prontidão", det: "BASE OPERACIONAL.", h: "yellow" },
            { ini: "20:00", fim: "20:30", miss: "OPO - POLICIAMENTO ESCOLAR", det: "ESCOLA ESTADUAL JOSÉ MEDEIROS", h: "red" },
            { ini: "20:30", fim: "22:00", miss: "Rota Crítica Noite 1", det: obterRotaReal(manchas.noite1), h: "red" },
            { ini: "22:00", fim: "00:00", miss: "Rota Crítica Noite 2", det: obterRotaReal(manchas.noite2), h: "red" },
            { ini: "00:00", fim: "05:00", miss: "Descanso/Prontidão", det: "BASE OPERACIONAL." },
            { ini: "05:00", fim: "07:00", miss: "OPO ALVORADA", det: "BARREIRAS E " + obterRotaReal(manchas.alvorada), h: "yellow" },
            { ini: "07:00", fim: "08:00", miss: "Finalização", det: "MANUTENÇÃO DE VIATURA E RENDIÇÃO." }
        ];    
    } else {
        // DEMAIS RPs (INTERIOR)
        cronograma = [
            { ini: "08:00", fim: "08:30", miss: "Apresentação", det: "APRESENTAÇÃO E PRELEÇÃO." },
            { ini: "08:30", fim: "13:00", miss: "Patrulhamento Geral", det: obterRotaReal(manchas.manha) },
            { ini: "13:00", fim: "16:30", miss: "Almoço e Prontidão", det: "BASE OPERACIONAL.", h: "yellow" },
            { ini: "16:30", fim: "19:00", miss: "Rota Prioritária Tarde", det: obterRotaReal(manchas.tarde), h: "blue" },
            { ini: "19:00", fim: "20:00", miss: "Janta e Prontidão", det: "BASE OPERACIONAL.", h: "yellow" },
            { ini: "20:00", fim: "22:00", miss: "Rota Crítica Noite 1", det: obterRotaReal(manchas.noite1), h: "red" },
            { ini: "22:00", fim: "00:00", miss: "Rota Crítica Noite 2", det: obterRotaReal(manchas.noite2), h: "red" },
            { ini: "00:00", fim: "05:00", miss: "Descanso/Prontidão", det: "BASE OPERACIONAL." },
            { ini: "05:00", fim: "07:00", miss: "OPO ALVORADA", det: "BARREIRAS E " + obterRotaReal(manchas.alvorada), h: "yellow" },
            { ini: "07:00", fim: "08:00", miss: "Finalização", det: "MANUTENÇÃO DE VIATURA E RENDIÇÃO." }
        ];
    }

    return {
        cidade: cidadeAlvo,
        rp: cidadeFiltro.includes("(") ? cidadeFiltro.split('(')[1].replace(')', '') : "RP",
        data: new Date().toLocaleDateString('pt-BR'),
        cronograma: cronograma
    };
}

function gerarTemplateHTML(data) {
    let linhas = data.cronograma.map(i => `
        <tr class="${i.h ? 'highlight-' + i.h : ''}">
            <td style="text-align:center; border:1px solid #333; padding:5px;">${i.ini}</td>
            <td style="text-align:center; border:1px solid #333; padding:5px;">${i.fim}</td>
            <td style="font-weight:bold; border:1px solid #333; padding:5px;">${i.miss.toUpperCase()}</td>
            <td style="border:1px solid #333; padding:5px;">${i.det.toUpperCase()}</td>
        </tr>
    `).join('');

    return `
    <style>
        .card-programa { border: 3px solid #003366; padding: 15px; background: #fff; font-family: Arial, sans-serif; font-size: 11px; }
        .table-c { width: 100%; border-collapse: collapse; margin-top: 10px; }
        .table-c th { background: #003366; color: white; padding: 8px; border: 1px solid #333; }
        .highlight-red { background-color: #ffcccc; font-weight: bold; }
        .highlight-yellow { background-color: #fff9c4; }
        .highlight-blue { background-color: #e3f2fd; }
        .assinatura { text-align: center; margin-top: 20px; }
    </style>
    <div class="card-programa">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #003366; padding-bottom: 5px;">
            <img src="https://pm.al.gov.br/joomgallery/image?view=image&format=raw&type=orig&id=84" width="60">
            <div style="text-align:center">
                <h2 style="margin:0; font-size: 16px;">CARTÃO PROGRAMA DE RP</h2>
                <h4 style="margin:0; font-size: 12px;">10º BATALHÃO DE POLÍCIA MILITAR</h4>
            </div>
            <div style="text-align:right; font-size: 10px;">
                <strong>DATA:</strong> ${data.data}<br>
                <strong>CIDADE:</strong> ${data.cidade}<br>
                <strong>GU:</strong> ${data.rp}
            </div>
        </div>
        <table class="table-c">
            <thead>
                <tr><th>INÍCIO</th><th>FIM</th><th>MISSÃO</th><th>DETALHES DA ROTA / MANCHA CRIMINAL</th></tr>
            </thead>
            <tbody>${linhas}</tbody>
        </table>
        <div class="assinatura">
            <p>_______________________________________________________</p>
            <strong>JONATA APOLINARIO CALHEIROS - 1º TEN QOEM PM</strong><br>Chefe da P3/10º BPM
        </div>
        <div>
        <p style="font-size: 9px; color: #555; margin-top: 10px;">*Este cartão programa é gerado automaticamente com base em dados de inteligência criminal avaliados com base nos 90 dias anteriores. As rotas e focos são sugestões estratégicas para otimizar o patrulhamento e a prevenção de crimes, mas a atuação policial deve sempre considerar as dinâmicas locais e as orientações superiores.</p>
        <p style="font-size: 9px; color: #555;">**As guarnições deverão dar preferência ao cumprimento das OPOs de maior prioridade.</p>
        <p style="font-size: 9px; color: #555;">***Em caso de ocorrências em andamento, as guarnições devem priorizar o atendimento emergencial, mesmo que isso signifique desviar temporariamente das rotas sugeridas.</p>
        <br>
        <br>
        <strong style="font-size: 10px; color: #003366;">SEÇÃO DE PLANEJAMENTO, INSTRUÇÃO E ESTATÍSTICA - P3/10ºBPM</strong>
        </div>
    </div>`;
}