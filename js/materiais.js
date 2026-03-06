// ====================================================================
// CONFIGURAÇÃO FIREBASE
// ====================================================================
const DATABASE_URL = 'https://sistema-p3-default-rtdb.firebaseio.com';
const NODE_MATERIAIS = 'materiais';

// URL do Apps Script — usado APENAS para sincronização e-SAJ (POST/ação server-side)
const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbwzoX1jw8mAREN24oiFRDxs2xF2xmIhsDS8M--VmIeSeuubNYflf5UTORAnF4JahFtn/exec';

let allMateriais = [];
let filtradosAtivos = null;

const chavesMateriais = ['IDMaterial', 'N° DO BOU', 'DATA', 'CATEGORIA', 'DESCRIÇÃO', 'LOCAL', 'DATA DE DEPOSITO', 'ESAJ', 'STATUS'];
const chavesEditaveis = chavesMateriais.filter(k => k !== 'IDMaterial');

const sidebar = document.getElementById('form-materiais');
const overlay = document.getElementById('overlay-sidebar');

// ====================================================================
// LOGIN E RELÓGIO
// ====================================================================
function checkLogin() {
    const graduacao = localStorage.getItem('userGraduacao');
    const nomeGuerra = localStorage.getItem('userNomeGuerra');
    const userInfoEl = document.getElementById('user-info');
    if (graduacao && nomeGuerra) {
        userInfoEl.innerHTML = `<p>Bem Vindo(a):</p><p class="user-nome">${graduacao} ${nomeGuerra}</p>`;
    } else {
        alert('Sessão expirada ou não iniciada. Redirecionando para a tela de Login.');
        window.location.href = '../page/login.html';
    }
}

function atualizarRelogio() {
    const agora = new Date();
    const opcoesData = { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' };
    const dataFormatada = agora.toLocaleDateString('pt-BR', opcoesData);
    const horaFormatada = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const el = document.getElementById('relogio');
    if (el) el.innerHTML = `${dataFormatada} <br> ${horaFormatada}`;
}

// ====================================================================
// CARREGAR DADOS DO FIREBASE
// ====================================================================
async function fetchData() {
    const msgCarregamento = document.getElementById('mensagem-carregamento');
    try {
        if (msgCarregamento) msgCarregamento.style.display = 'block';

        const response = await fetch(`${DATABASE_URL}/${NODE_MATERIAIS}.json`);
        if (!response.ok) throw new Error('Erro ao acessar Firebase');

        const data = await response.json();

        if (!data) {
            allMateriais = [];
        } else {
            // Converte objeto Firebase em array, guardando o id_realtime
            allMateriais = Object.keys(data)
                .map(id => ({ ...data[id], id_realtime: id }))
                .filter(item => item !== null)
                .sort((a, b) => {
                    // Ordena por data decrescente
                    return new Date(b.DATA || 0) - new Date(a.DATA || 0);
                });
        }

        renderTable(allMateriais);
        loadTotalCounts();
        if (msgCarregamento) msgCarregamento.style.display = 'none';

    } catch (error) {
        console.error("Erro ao buscar dados:", error);
        if (msgCarregamento) msgCarregamento.textContent = "Erro ao carregar dados. Verifique a conexão.";
    }
}

// ====================================================================
// RENDERIZAÇÃO DA TABELA
// ====================================================================
function renderTable(dataToRender) {
    const tbody = document.querySelector('#tabela-materiais tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    dataToRender.forEach(function (item) {
        const row = tbody.insertRow();

        // Coluna IDMaterial
        row.insertCell().textContent = item.IDMaterial || '';

        // Colunas dinâmicas
        chavesEditaveis.forEach(function (key) {
            const cell = row.insertCell();
            const valor = item[key] || '';

            if (key === 'STATUS') {
                const sClass = String(valor).replace(/\s+/g, '').toLowerCase();
                cell.innerHTML = '<span class="status-badge status-' + sClass + '">' + valor + '</span>';
            } else if (key === 'ESAJ' && valor) {
                const numLimpo = String(valor).replace(/\D/g, '');
                cell.innerHTML = `<a href="https://www2.tjal.jus.br/cpopg/search.do?conversationId=&cbPesquisa=NUMPROC&dadosConsulta.valorConsulta=${numLimpo}&numeroDigitado=${numLimpo}" target="_blank" style="color:#1a3d5d; font-weight:bold; text-decoration:underline;">${valor}</a>`;
            } else {
                cell.textContent = valor;
            }
        });

        // Coluna de AÇÕES
        const acoesCell = row.insertCell();
        acoesCell.style.display = 'flex';
        acoesCell.style.gap = '5px';

        const btnEditar = document.createElement('button');
        btnEditar.className = 'btn-editar-sidebar';
        btnEditar.style.cssText = 'background:#2c3e50; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;';
        btnEditar.textContent = 'Editar';
        btnEditar.onclick = () => toggleSidebar(true, item);
        acoesCell.appendChild(btnEditar);

        if (String(item.STATUS).toUpperCase() === 'A DEVOLVER') {
            const btnTermo = document.createElement('button');
            btnTermo.style.cssText = 'background:#e67e22; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer; font-weight:bold;';
            btnTermo.textContent = 'TERMO';
            btnTermo.onclick = () => gerarTermo(item);
            acoesCell.appendChild(btnTermo);
        }

        if (String(item.STATUS).toUpperCase() === 'FIEL DEPOSITÁRIO') {
            const btnFiel = document.createElement('button');
            btnFiel.style.cssText = 'background:#e67e22; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer; font-weight:bold;';
            btnFiel.textContent = 'TERMO FIEL DEP.';
            btnFiel.onclick = () => {
                localStorage.setItem('dadosTermoFiel', JSON.stringify(item));
                window.open('termo_fiel.html', '_blank');
            };
            acoesCell.appendChild(btnFiel);
        }
    });
}

// ====================================================================
// SALVAR NO FIREBASE (POST = novo, PATCH = editar)
// ====================================================================
async function salvarDados(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-salvar-form');
    btn.disabled = true;
    btn.textContent = "Processando...";

    const id = document.getElementById('form-id').value; // id_realtime se edição

    const payload = {
        'IDMaterial':      id || Date.now().toString(),
        'N° DO BOU':       document.getElementById('bou').value,
        'DATA':            document.getElementById('data').value,
        'CATEGORIA':       document.getElementById('categoria').value,
        'DESCRIÇÃO':       document.getElementById('descricao').value,
        'LOCAL':           document.getElementById('localdeposito').value,
        'DATA DE DEPOSITO': document.getElementById('data-deposito').value,
        'ESAJ':            document.getElementById('esaj').value,
        'STATUS':          document.getElementById('status').value
    };

    // Remove campos vazios
    Object.keys(payload).forEach(k => { if (payload[k] === '') delete payload[k]; });

    const url = id
        ? `${DATABASE_URL}/${NODE_MATERIAIS}/${id}.json`
        : `${DATABASE_URL}/${NODE_MATERIAIS}.json`;

    try {
        const res = await fetch(url, {
            method: id ? 'PATCH' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error('Erro ao salvar: ' + res.status);

        alert("Operação realizada com sucesso!");
        toggleSidebar(false);
        setTimeout(fetchData, 500);
    } catch (error) {
        console.error("Erro ao salvar:", error);
        alert("Erro ao salvar: " + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = "SALVAR DADOS";
    }
}

// ====================================================================
// CONTADORES
// ====================================================================
function loadTotalCounts() {
    const agora = new Date();
    const anoAtual = agora.getFullYear().toString();
    const anoAnterior = (agora.getFullYear() - 1).toString();

    const ativos = allMateriais.filter(item =>
        String(item.STATUS || "").toUpperCase() !== 'DEVOLVIDO'
    );

    const elTotal = document.getElementById('total-materiais');
    if (elTotal) elTotal.textContent = ativos.length;

    const ativosAnoAtual = ativos.filter(item =>
        String(item.DATA || "").indexOf(anoAtual) > -1
    );
    const elAnoAtual = document.getElementById('total-ano-atual');
    if (elAnoAtual) elAnoAtual.textContent = ativosAnoAtual.length;

    const ativosAnoAnterior = ativos.filter(item =>
        String(item.DATA || "").indexOf(anoAnterior) > -1
    );
    const elAnoAnterior = document.getElementById('total-ano-anterior');
    if (elAnoAnterior) elAnoAnterior.textContent = ativosAnoAnterior.length;
}

// ====================================================================
// FILTROS
// ====================================================================
function aplicarFiltro() {
    const campo = document.getElementById('filtro-tipo').value;
    const busca = document.getElementById('filtro-valor-text').value.toLowerCase().trim();
    if (!campo || !busca) { alert('Selecione um campo e digite um valor.'); return; }

    filtradosAtivos = allMateriais.filter(i =>
        String(i[campo] || "").toLowerCase().indexOf(busca) > -1
    );

    renderTable(filtradosAtivos);
    document.getElementById('btn-limpar-filtro').style.display = 'inline-block';
}

function limparFiltro() {
    document.getElementById('filtro-tipo').value = "";
    document.getElementById('filtro-valor-text').value = "";
    document.getElementById('btn-limpar-filtro').style.display = 'none';
    filtradosAtivos = null;
    renderTable(allMateriais);
}

// ====================================================================
// IMPRESSÃO
// ====================================================================
function imprimirTabela() {
    const dadosParaImprimir = filtradosAtivos ? filtradosAtivos : allMateriais;
    if (dadosParaImprimir.length === 0) return alert("Não há dados para imprimir.");
    localStorage.setItem('dadosParaImpressao', JSON.stringify(dadosParaImprimir));
    window.open('../relatorios/relatoriomateriais.html', '_blank');
}

// ====================================================================
// SINCRONIZAÇÃO E-SAJ (ainda via Apps Script — roda no servidor)
// ====================================================================
document.getElementById('btn-sincronizar-esaj').onclick = async function () {
    const btn = this;
    if (!confirm("Deseja atualizar os status via API DataJud? Isso pode levar alguns minutos.")) return;

    btn.disabled = true;
    btn.innerHTML = `<img width="20" height="20" src="https://img.icons8.com/material-outlined/24/ffffff/refresh.png"/> Sincronizando...`;

    try {
        // A sincronização roda no Apps Script (server-side) e grava o resultado no Firebase
        const url = WEBAPP_URL + "?action=sincronizar";
        const response = await fetch(url, { method: 'GET', redirect: 'follow' });
        const texto = await response.text();
        alert("✅ " + texto);
        await fetchData(); // Recarrega do Firebase após sincronização
    } catch (e) {
        console.error("Erro na sincronização:", e);
        alert("Erro ao sincronizar: " + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<img width="20" height="20" src="https://img.icons8.com/material-outlined/24/ffffff/refresh.png"/> Sincronizar e-SAJ`;
    }
};

// ====================================================================
// SIDEBAR
// ====================================================================
function toggleSidebar(show, data) {
    if (!sidebar) return;
    if (show) {
        sidebar.reset();
        document.getElementById('form-id').value = '';
        if (data) {
            document.getElementById('form-id').value = data.id_realtime || '';
            document.getElementById('bou').value = data['N° DO BOU'] || '';
            document.getElementById('data').value = formatarDataParaInput(data.DATA);
            document.getElementById('categoria').value = data.CATEGORIA || '';
            document.getElementById('descricao').value = data.DESCRIÇÃO || '';
            document.getElementById('localdeposito').value = data.LOCAL || '';
            document.getElementById('data-deposito').value = formatarDataParaInput(data['DATA DE DEPOSITO']);
            document.getElementById('esaj').value = data.ESAJ || '';
            document.getElementById('status').value = data.STATUS || '';
        }
        sidebar.classList.add('active');
        if (overlay) overlay.classList.add('active');
    } else {
        sidebar.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
    }
}

function formatarDataParaInput(dataStr) {
    if (!dataStr || !dataStr.includes('/')) return dataStr || '';
    const p = dataStr.split('/');
    return p[2] + '-' + p[1] + '-' + p[0];
}

function gerarTermo(item) {
    localStorage.setItem('dadosTermo', JSON.stringify(item));
    window.open('../termos/termo_devolucao.html', '_blank');
}

function efetuarLogout() {
    localStorage.clear();
    window.location.href = '../page/login.html';
}

// ====================================================================
// INICIALIZAÇÃO
// ====================================================================
document.addEventListener('DOMContentLoaded', function () {
    checkLogin();
    atualizarRelogio();
    setInterval(atualizarRelogio, 1000);
    fetchData();

    document.getElementById('btn-logout').onclick = efetuarLogout;
    document.getElementById('btn-adicionar-cadastro').onclick = () => toggleSidebar(true);
    document.getElementById('btn-fechar-sidebar').onclick = () => toggleSidebar(false);
    if (overlay) overlay.onclick = () => toggleSidebar(false);
    sidebar.onsubmit = salvarDados;
    document.getElementById('btn-aplicar-filtro').onclick = aplicarFiltro;
    document.getElementById('btn-limpar-filtro').onclick = limparFiltro;
    document.getElementById('btn-imprimir').onclick = imprimirTabela;
});