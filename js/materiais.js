// ====================================================================
// CONFIGURAÇÃO GOOGLE APPS SCRIPT
// ====================================================================
// URL do Apps Script exclusiva para BANCO DE DADOS (Buscar, criar e atualizar)
const DATABASE_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycby1FlbgHFzFZRDJbnzvCzsik-jlQDsnNCF3QafZemA6C4oSz8qODvOwrLaCGo0Z4VOJHg/exec';

// URL do Apps Script usada APENAS para a gestão de movimentações / sincronização e-SAJ
const MOVIMENTACAO_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbwzoX1jw8mAREN24oiFRDxs2xF2xmIhsDS8M--VmIeSeuubNYflf5UTORAnF4JahFtn/exec';

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
// CARREGAR DADOS DO GOOGLE SHEETS
// ====================================================================
async function fetchData() {
    const msgCarregamento = document.getElementById('mensagem-carregamento');
    try {
        if (msgCarregamento) msgCarregamento.style.display = 'block';

        // Utiliza a URL correta de BANCO DE DADOS para ler a planilha
        const response = await fetch(`${DATABASE_WEBAPP_URL}?action=read`);
        if (!response.ok) throw new Error('Erro ao acessar Google Sheets via Apps Script');

        const data = await response.json();

        if (data && data.status === 'error') {
            throw new Error(data.message);
        }

        if (!data || !Array.isArray(data)) {
            allMateriais = [];
        } else {
            allMateriais = data.sort((a, b) => {
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
// SALVAR NO GOOGLE SHEETS (POST com action=create ou action=update)
// ====================================================================
async function salvarDados(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-salvar-form');
    btn.disabled = true;
    btn.textContent = "Processando...";

    const id = document.getElementById('form-id').value; 
    const acao = id ? 'update' : 'create';

    const urlParams = new URLSearchParams();
    urlParams.append('IDMaterial', id || Date.now().toString());
    urlParams.append('N° DO BOU', document.getElementById('bou').value);
    urlParams.append('DATA', document.getElementById('data').value);
    urlParams.append('CATEGORIA', document.getElementById('categoria').value);
    urlParams.append('DESCRIÇÃO', document.getElementById('descricao').value);
    urlParams.append('LOCAL', document.getElementById('localdeposito').value);
    urlParams.append('DATA DE DEPOSITO', document.getElementById('data-deposito').value);
    urlParams.append('ESAJ', document.getElementById('esaj').value);
    urlParams.append('STATUS', document.getElementById('status').value);

    // Aponta para a URL correta de BANCO DE DADOS
    const urlFinal = `${DATABASE_WEBAPP_URL}?action=${acao}`;

    try {
        const res = await fetch(urlFinal, {
            method: 'POST',
            mode: 'cors',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: urlParams.toString()
        });

        if (!res.ok) throw new Error('Erro ao salvar na planilha: ' + res.status);

        const resultadoJson = await res.json();
        if (resultadoJson.status === 'error') throw new Error(resultadoJson.message);

        alert("Operação realizada com sucesso!");
        toggleSidebar(false);
        setTimeout(fetchData, 800); 
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
// SINCRONIZAÇÃO E-SAJ (Utiliza a URL de MOVIMENTAÇÃO)
// ====================================================================
const btnSinc = document.getElementById('btn-sincronizar-esaj');
if (btnSinc) {
    btnSinc.onclick = async function () {
        const btn = this;
        if (!confirm("Deseja atualizar os status via API DataJud? Isso pode levar alguns minutos.")) return;

        btn.disabled = true;
        btn.innerHTML = `<img width="20" height="20" src="https://img.icons8.com/material-outlined/24/ffffff/refresh.png"/> Sincronizando...`;

        try {
            // Aqui mantemos a chamada apontando para a URL de MOVIMENTAÇÃO
            const url = MOVIMENTACAO_WEBAPP_URL + "?action=sincronizar";
            const response = await fetch(url, { method: 'GET', redirect: 'follow' });
            const texto = await response.text();
            alert("✅ " + texto);
            await fetchData(); // Após atualizar no servidor, puxamos a lista atualizada
        } catch (e) {
            console.error("Erro na sincronização:", e);
            alert("Erro ao sincronizar: " + e.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = `<img width="20" height="20" src="https://img.icons8.com/material-outlined/24/ffffff/refresh.png"/> Sincronizar e-SAJ`;
        }
    };
}

// ====================================================================
// SIDEBAR
// ====================================================================
function toggleSidebar(show, data) {
    if (!sidebar) return;
    if (show) {
        sidebar.reset();
        document.getElementById('form-id').value = '';
        if (data) {
            document.getElementById('form-id').value = data.IDMaterial || '';
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