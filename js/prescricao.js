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

// Mapa de penas máximas por tipicidade (Art. 109 CP + legislação especial)
// Chaves em MAIÚSCULO para comparação case-insensitive
const MAPA_PENAS = {
    // Crimes contra a vida
    "HOMICÍDIO DOLOSO":             20,
    "HOMICÍDIO CULPOSO":             3,
    "FEMINICÍDIO":                  20,
    "INDUZIMENTO AO SUICÍDIO":       6,
    "LESÃO CORPORAL GRAVE":          5,
    "LESÃO CORPORAL GRAVÍSSIMA":     5,
    "LESÃO CORPORAL SEGUIDA DE MORTE": 12,
    "LESÃO CORPORAL":                1,
    "LESÃO CORPORAL LEVE":           1,

    // Crimes contra o patrimônio
    "ROUBO":                         10,
    "ROUBO QUALIFICADO":             15,
    "LATROCÍNIO":                    30,
    "FURTO":                          4,
    "FURTO QUALIFICADO":              8,
    "EXTORSÃO":                      10,
    "EXTORSÃO MEDIANTE SEQUESTRO":   30,
    "DANO":                           1,
    "ESTELIONATO":                    5,
    "RECEPTAÇÃO":                     4,

    // Crimes contra a dignidade sexual
    "ESTUPRO":                       10,
    "ESTUPRO DE VULNERÁVEL":         15,
    "IMPORTUNAÇÃO SEXUAL":            5,
    "ASSÉDIO SEXUAL":                 2,

    // Crimes contra a pessoa / família
    "AMEAÇA":                         1,
    "CONSTRANGIMENTO ILEGAL":         1,
    "SEQUESTRO E CÁRCERE PRIVADO":    3,
    "VIOLÊNCIA DOMÉSTICA":            3,
    "VIAS DE FATO":                   1,

    // Crimes contra a paz pública / ordem
    "TRÁFICO DE DROGAS":             15,
    "USO DE DROGAS":                  2,
    "PORTE ILEGAL DE ARMA":           4,
    "DISPARO DE ARMA DE FOGO":        4,
    "RESISTÊNCIA":                    2,
    "DESACATO":                       2,
    "DESOBEDIÊNCIA":                  0.5,
    "PERTURBAÇÃO DO SOSSEGO":         0.25,
    "PERTURBAÇÃO":                    0.25,
    "EMBRIAGUEZ AO VOLANTE":          3,
    "DIREÇÃO PERIGOSA":               1,

    // Crimes contra a honra
    "INJÚRIA":                        1,
    "CALÚNIA":                        2,
    "DIFAMAÇÃO":                      2,

    // Padrão TCO (pena máxima 2 anos — Lei 9.099/95)
    "TCO":                            2
};

function buscarPenaMaxima(tipicidade) {
    if (!tipicidade) return 2;
    const tip = tipicidade.toString().toUpperCase().trim();

    // Tenta correspondência exata primeiro
    if (MAPA_PENAS[tip] !== undefined) return MAPA_PENAS[tip];

    // Tenta correspondência parcial (substring)
    for (const chave of Object.keys(MAPA_PENAS)) {
        if (tip.includes(chave) || chave.includes(tip)) return MAPA_PENAS[chave];
    }

    // Padrão: 2 anos (TCO)
    return 2;
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

            // Busca a pena máxima pelo campo Tipicidade Geral de cada TCO
            const tipicidade = item['Tipicidade Geral'] || item['TIPICIDADE'] || item['Tipificação'] || '';
            const penaMax = buscarPenaMaxima(tipicidade);
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
                <td>${tipicidade || "N/I"}</td>
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