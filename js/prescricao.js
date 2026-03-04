const DATABASE_URL = 'https://sistema-p3-default-rtdb.firebaseio.com';
const NODE_TCO = 'tco_geral';

// Função baseada no Art. 109 do CP
function calcularPrazoPrescricao(penaMaximaAnos) {
    if (penaMaximaAnos < 1) return 3;
    if (penaMaximaAnos <= 2) return 4;
    if (penaMaximaAnos <= 4) return 8;
    if (penaMaximaAnos <= 8) return 12;
    if (penaMaximaAnos <= 12) return 16;
    return 20;
}

// Função para forçar a data a ficar correta, independente do formato no banco
function tratarData(stringData) {
    if (!stringData) return null;
    
    let partes;
    // Se a data vier com "/" (ex: 11/24/2025 ou 24/11/2025)
    if (stringData.includes('/')) {
        partes = stringData.split('/');
        // Se a primeira parte for > 12, assumimos DD/MM/AAAA
        if (parseInt(partes[0]) > 12) {
            return new Date(`${partes[2]}-${partes[1]}-${partes[0]}T00:00:00`);
        } 
        // Se a segunda parte for > 12, assumimos MM/DD/AAAA (seu erro atual)
        else if (parseInt(partes[1]) > 12) {
            return new Date(`${partes[2]}-${partes[0]}-${partes[1]}T00:00:00`);
        }
    }
    
    // Se já estiver no padrão ISO (AAAA-MM-DD) ou outro formato nativo
    const dataTentativa = new Date(stringData + (stringData.includes('T') ? '' : 'T00:00:00'));
    return isNaN(dataTentativa.getTime()) ? null : dataTentativa;
}

async function carregarPrescricoes() {
    try {
        const res = await fetch(`${DATABASE_URL}/${NODE_TCO}.json`);
        const data = await res.json();

        if (!data) return;

        // Limpeza dos dados vindo do Firebase (como no tco.js)
        const tcos = Object.keys(data)
            .map(id => data[id])
            .filter(item => item !== null && item.DATA);

        const tbody = document.querySelector('#tabela-prescricao tbody');
        tbody.innerHTML = '';

        let critico = 0, alerta = 0, seguro = 0;

        tcos.forEach(item => {
            const dataFato = tratarData(item.DATA.trim());

            if (!dataFato) {
                console.error("Data impossível de converter:", item['Nº Ocorrência'], item.DATA);
                return;
            }

            // Cálculo da Pena e Prescrição
            const penaMax = parseFloat(item.PenaMaxima) || 2; 
            const anosPrescricao = calcularPrazoPrescricao(penaMax);
            
            const dataLimite = new Date(dataFato);
            dataLimite.setFullYear(dataLimite.getFullYear() + anosPrescricao);

            const hoje = new Date();
            const diasParaPrescrever = Math.ceil((dataLimite - hoje) / (1000 * 60 * 60 * 24));

            let statusTexto = "SEGURO";
            let corEstilo = "color: green;";
            if (diasParaPrescrever <= 90) {
                statusTexto = "CRÍTICO";
                corEstilo = "color: red; font-weight: bold;";
                critico++;
            } else if (diasParaPrescrever <= 180) {
                statusTexto = "ALERTA";
                corEstilo = "color: orange; font-weight: bold;";
                alerta++;
            } else {
                seguro++;
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${item['Nº Ocorrência'] || "S/N"}</td>
                <td>${item['Tipicidade Geral'] || "N/I"}</td>
                <td>${dataFato.toLocaleDateString('pt-BR')}</td> 
                <td>${penaMax} ano(s)</td>
                <td>${anosPrescricao} anos</td>
                <td>${dataLimite.toLocaleDateString('pt-BR')}</td>
                <td style="${corEstilo}">${statusTexto} (${diasParaPrescrever} dias)</td>
            `;
            tbody.appendChild(tr);
        });

        document.getElementById('count-critico').innerText = critico;
        document.getElementById('count-alerta').innerText = alerta;
        document.getElementById('count-seguro').innerText = seguro;

    } catch (err) {
        console.error("Erro ao processar prescrições:", err);
    }
}
 function atualizarRelogio() {
        const agora = new Date();
        const el = document.getElementById('relogio');
        if (el) el.innerHTML = agora.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' }) + '<br>' + agora.toLocaleTimeString('pt-BR');
    }

    function checkLogin() {
        const grad = localStorage.getItem('userGraduacao');
        const nome = localStorage.getItem('userNomeGuerra');
        const userEl = document.getElementById('user-info');
        if (grad && nome && userEl) {
            userEl.innerHTML = `<p>Bem Vindo:</p><p class="user-nome">${grad} ${nome}</p>`;
        } else {
            window.location.href = '../page/login.html';
        }
    }

document.addEventListener('DOMContentLoaded', () =>{
    carregarPrescricoes ();
    atualizarRelogio ();
    checkLogin();
})

