// ====================================================================
// URLs das APIs — definidas em runtime a partir da unidade do usuário
// logado (ver js/core/session.js). As demais URLs de GAS que existiam
// aqui (Drogas, TCO, MVI, Perturbação, CVP, VD, Visitas, Armas) nunca
// eram de fato usadas neste arquivo — os cartões correspondentes usam
// o Firebase diretamente (ver funções atualizarContagem*Firebase abaixo).
// ====================================================================
let DATABASE_URL           = null;
let WEBAPP_URL_AIT         = null;
let WEBAPP_URL_MATERIAIS   = null;
let WEBAPP_URL_MANDADOS    = null;

// ====================================================================
// UTILITÁRIOS
// ====================================================================
const ANO_ATUAL = new Date().getFullYear();

function anoDoRegistro(item) {
    const data = (item.DATA || item.data || '').toString().trim();
    if (!data || data === '---') return null;
    if (data.includes('/')) {
        const p = data.split('/');
        return p.length >= 3 ? parseInt(p[2]) : null;
    }
    if (data.includes('-')) return parseInt(data.split('-')[0]);
    return null;
}
function doAnoAtual(item) { return anoDoRegistro(item) === ANO_ATUAL; }

/**
 * Formata uma string ISO (import_at) para exibição amigável.
 * Retorna "Atualizado em DD/MM/AAAA às HH:MM"
 */
function formatarImportAt(isoStr) {
    if (!isoStr) return null;
    const d = new Date(isoStr);
    if (isNaN(d)) return null;
    const data = d.toLocaleDateString('pt-BR', { timeZone: 'America/Maceio' });
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Maceio' });
    return `Atualizado em ${data} às ${hora}`;
}

/**
 * Pega o import_at mais recente de um array de objetos do Firebase.
 */
function maiorImportAt(objetos) {
    let maior = null;
    objetos.forEach(item => {
        const val = item.import_at;
        if (!val) return;
        if (!maior || val > maior) maior = val;
    });
    return maior;
}

/**
 * Atualiza o elemento de data do card.
 * @param {string} elId  - ID do <span> de data (ex: 'sync-mvi')
 * @param {string|null} isoStr - string ISO do import_at
 */
function exibirDataAtualizacao(elId, isoStr) {
    const el = document.getElementById(elId);
    if (!el) return;
    const texto = formatarImportAt(isoStr);
    if (texto) {
        el.textContent = texto;
        el.classList.add('atualizado');
    } else {
        el.textContent = 'Nunca atualizado';
    }
}

// ====================================================================
// CONTAGEM GENÉRICA via Apps Script (AIT, Materiais, Mandados)
// ====================================================================
function updateCount(url, action, elementId) {
    const currentYear = new Date().getFullYear();
    const $el = $(`#${elementId}`);
    $el.text('...');

    $.ajax({
        url: url,
        type: 'GET',
        data: { action: action, year: currentYear },
        dataType: 'json',
        success: function (response) {
            let valor = response.count !== undefined ? response.count : response.total;
            $el.text(valor !== undefined ? valor : '0');
        },
        error: function (jqXHR, textStatus, errorThrown) {
            $el.text('!');
            console.error(`Erro na comunicação (${elementId}):`, textStatus, errorThrown);
        }
    });
}

// ====================================================================
// MVI (Homicídios) — Firebase /geral
// ====================================================================
async function atualizarContagemHomicidiosFirebase() {
    const el = document.getElementById('numeromvi');
    try {
        const response = await fetch(`${DATABASE_URL}/geral.json`);
        if (!response.ok) throw new Error("Erro ao acessar Firebase");
        const dados = await response.json();

        if (!dados) { el.innerText = "0"; return; }

        const lista = Object.values(dados);

        const contagem = lista.filter(item => {
            if (!doAnoAtual(item)) return false;
            const tip = (item.TIPIFICACAO_GERAL || item.TIPIFICACAO || "")
                .toString().trim()
                .normalize("NFD").replace(/[̀-ͯ]/g, "")
                .toUpperCase();
            const ehHomicidio = tip.includes("HOMICIDIO") && !tip.includes("TENTATIVA");
            const ehTentativa = tip.includes("TENTATIVA");
            const temObito = (item.OBITO || "").toString().trim().toUpperCase() === "S";
            return ehHomicidio || (ehTentativa && temObito);
        }).length;

        el.innerText = contagem;
        exibirDataAtualizacao('sync-mvi', maiorImportAt(lista));

    } catch (error) {
        console.error("Erro ao atualizar MVI:", error);
        el.innerText = "!";
    }
}

// ====================================================================
// CVP — Firebase /cvp
// ====================================================================
async function atualizarContagemCVPFirebase() {
    const el = document.getElementById('numerocvp');
    try {
        const response = await fetch(`${DATABASE_URL}/cvp.json`);
        if (!response.ok) throw new Error("Erro ao acessar Firebase");
        const dados = await response.json();

        if (!dados) { el.innerText = "0"; return; }

        const lista = Object.values(dados);
        el.innerText = lista.filter(doAnoAtual).length;
        exibirDataAtualizacao('sync-cvp', maiorImportAt(lista));

    } catch (error) {
        console.error("Erro ao atualizar CVP:", error);
        el.innerText = "!";
    }
}

// ====================================================================
// TCO — Firebase /tco
// ====================================================================
async function atualizarContagemTCOFirebase() {
    const el = document.getElementById('numerotco');
    try {
        const response = await fetch(`${DATABASE_URL}/tco.json`);
        if (!response.ok) throw new Error("Erro ao acessar Firebase");
        const dados = await response.json();

        if (!dados) { el.innerText = "0"; return; }

        const lista = Object.values(dados);
        el.innerText = lista.filter(doAnoAtual).length;
        exibirDataAtualizacao('sync-tco', maiorImportAt(lista));

    } catch (error) {
        console.error("Erro ao atualizar TCO:", error);
        el.innerText = "!";
    }
}

// ====================================================================
// Violência Doméstica — Firebase /violencia_domestica
// ====================================================================
async function atualizarContagemViolenciaDomesticaFirebase() {
    const el = document.getElementById('numeroviolenciadomestica');
    try {
        const response = await fetch(`${DATABASE_URL}/violencia_domestica.json`);
        if (!response.ok) throw new Error("Erro ao acessar Firebase");
        const dados = await response.json();

        if (!dados) { el.innerText = "0"; return; }

        const lista = Object.values(dados);
        el.innerText = lista.filter(doAnoAtual).length;
        exibirDataAtualizacao('sync-vd', maiorImportAt(lista));

    } catch (error) {
        console.error("Erro ao atualizar Violência Doméstica:", error);
        el.innerText = "!";
    }
}

// ====================================================================
// Armas Apreendidas — Firebase /arma
// ====================================================================
async function atualizarContagemArmasFirebase() {
    const el = document.getElementById('armasapreendidas');
    try {
        const response = await fetch(`${DATABASE_URL}/arma.json`);
        if (!response.ok) throw new Error("Erro ao acessar Firebase");
        const dados = await response.json();

        if (!dados) { el.innerText = "0"; return; }

        const lista = Object.values(dados);
        el.innerText = lista.filter(doAnoAtual).length;
        exibirDataAtualizacao('sync-armas', maiorImportAt(lista));

    } catch (error) {
        console.error("Erro ao atualizar Armas:", error);
        el.innerText = "!";
    }
}

// ====================================================================
// Drogas — Firebase /droga
// ====================================================================
async function atualizarDrogas() {
    const el = document.getElementById('numerodrogas');
    try {
        const response = await fetch(`${DATABASE_URL}/droga.json`);
        if (!response.ok) throw new Error('Erro ao acessar Firebase');
        const dados = await response.json();

        if (!dados) { el.innerText = '0 g'; return; }

        const lista = Object.values(dados);
        let soma = 0;
        lista.filter(doAnoAtual).forEach(item => {
            const bruto = item.QUANTIDADE || item.PESO || '0';
            const num = parseFloat(String(bruto).replace(',', '.'));
            if (!isNaN(num)) soma += num;
        });

        el.innerText = soma >= 1000
            ? (soma / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 3 }) + ' Kg'
            : soma.toLocaleString('pt-BR', { minimumFractionDigits: 3 }) + ' g';

        exibirDataAtualizacao('sync-drogas', maiorImportAt(lista));

    } catch (error) {
        console.error('Erro ao somar drogas:', error);
        el.innerText = '!';
    }
}

// ====================================================================
// Perturbação do Sossego — Firebase /sossego
// ====================================================================
async function atualizarContagemPerturbacaoFirebase() {
    const el = document.getElementById('numeroperturbacaodosossego');
    try {
        const response = await fetch(`${DATABASE_URL}/sossego.json`);
        if (!response.ok) throw new Error("Erro ao acessar Firebase");
        const dados = await response.json();

        if (!dados) { el.innerText = "0"; return; }

        const lista = Object.values(dados);
        const contagem = lista.filter(item =>
            doAnoAtual(item) &&
            item.TIPIFICACAO && item.TIPIFICACAO.toString().toUpperCase().includes("PERTURBAÇÃO")
        ).length;

        el.innerText = contagem;
        exibirDataAtualizacao('sync-sossego', maiorImportAt(lista));

    } catch (error) {
        console.error("Erro ao atualizar Perturbação:", error);
        el.innerText = "!";
    }
}

// ====================================================================
// Visitas Orientativas — Firebase /geral (filtro por TIPIFICACAO)
// ====================================================================
async function atualizarContagemVisitasFirebase() {
    const el = document.getElementById('numerovistiasorientativas');
    try {
        const response = await fetch(`${DATABASE_URL}/geral.json`);
        if (!response.ok) throw new Error("Erro ao acessar Firebase");
        const dados = await response.json();

        if (!dados) { el.innerText = "0"; return; }

        const lista = Object.values(dados);
        const filtradas = lista.filter(item =>
            doAnoAtual(item) &&
            item.TIPIFICACAO && item.TIPIFICACAO.toString().toUpperCase().includes("VISITA")
        );

        el.innerText = filtradas.length;
        exibirDataAtualizacao('sync-visitas', maiorImportAt(filtradas.length ? filtradas : lista));

    } catch (error) {
        console.error("Erro ao atualizar Visitas:", error);
        el.innerText = "!";
    }
}

// ====================================================================
// AIT — Apps Script (sem Firebase, sem import_at disponível)
// Usa a data local do último acesso guardada em localStorage
// ====================================================================
async function atualizarAIT() {
    updateCount(WEBAPP_URL_AIT, 'countAITs', 'numeroait');

    // Para AIT (que vem do Apps Script, não tem import_at),
    // exibe a data da última vez que o index foi carregado com dados válidos
    const chave = 'ait_ultima_carga';
    const salvo = localStorage.getItem(chave);
    if (salvo) {
        exibirDataAtualizacao('sync-ait', salvo);
    }

    // Aguarda o valor aparecer no DOM e registra se mudou
    setTimeout(() => {
        const val = document.getElementById('numeroait')?.textContent;
        if (val && val !== '--' && val !== '!') {
            localStorage.setItem(chave, new Date().toISOString());
        }
    }, 5000);
}

// ====================================================================
// Materiais e Mandados — Apps Script (mesma lógica do AIT)
// ====================================================================
async function atualizarMateriaisEMandados() {
    // Materiais
    updateCount(WEBAPP_URL_MATERIAIS, 'countMateriais', 'numeromateriais');
    const chaveMat = 'materiais_ultima_carga';
    const salvoMat = localStorage.getItem(chaveMat);
    if (salvoMat) exibirDataAtualizacao('sync-materiais', salvoMat);
    setTimeout(() => {
        const val = document.getElementById('numeromateriais')?.textContent;
        if (val && val !== '--' && val !== '!') localStorage.setItem(chaveMat, new Date().toISOString());
    }, 5000);

    // Mandados
    updateCount(WEBAPP_URL_MANDADOS, 'countMandados', 'numeromandados');
    const chaveMand = 'mandados_ultima_carga';
    const salvoMand = localStorage.getItem(chaveMand);
    if (salvoMand) exibirDataAtualizacao('sync-mandados', salvoMand);
    setTimeout(() => {
        const val = document.getElementById('numeromandados')?.textContent;
        if (val && val !== '--' && val !== '!') localStorage.setItem(chaveMand, new Date().toISOString());
    }, 5000);
}

// ====================================================================
// INICIALIZAÇÃO
// ====================================================================
// Relógio, "Bem-vindo(a)", botão Sair e o toggle do sino já são
// centralizados por js/core/header-nav.js — aqui só falta a guarda de
// autenticação (redireciona pro login se a sessão não existir).
async function inicializar() {
    if (!P3.requireAuth()) return;

    const cfg = await P3.loadUnidadeConfig();
    DATABASE_URL         = cfg.firebase.databaseURL;
    WEBAPP_URL_AIT       = cfg.gas.AIT;
    WEBAPP_URL_MATERIAIS = cfg.gas.MATERIAIS;
    WEBAPP_URL_MANDADOS  = cfg.gas.MANDADOS;

    // Firebase (tem import_at → data real de atualização)
    atualizarContagemHomicidiosFirebase();
    atualizarContagemCVPFirebase();
    atualizarContagemTCOFirebase();
    atualizarContagemViolenciaDomesticaFirebase();
    atualizarContagemArmasFirebase();
    atualizarDrogas();
    atualizarContagemPerturbacaoFirebase();
    atualizarContagemVisitasFirebase();

    // Apps Script (sem import_at → usa localStorage como fallback)
    atualizarAIT();
    atualizarMateriaisEMandados();
}

// Defensivo: se o DOMContentLoaded já disparou antes deste script rodar
// (pode acontecer dependendo de como a página é servida/recarregada),
// esperar pelo evento nunca chamaria inicializar().
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializar);
} else {
    inicializar();
}
