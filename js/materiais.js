
let allMateriais = [];
let filtradosAtivos = null;
const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbwzoX1jw8mAREN24oiFRDxs2xF2xmIhsDS8M--VmIeSeuubNYflf5UTORAnF4JahFtn/exec';

// Wrapper para fetch do Apps Script — funciona em Live Server e produção
// O Apps Script retorna um redirect 302; o browser bloqueia por CORS no redirect.
// Solução: abrimos a URL final num iframe oculto via postMessage (workaround),
// OU usamos jsonp via script tag para GET requests.
async function appsScriptFetch(url) {
    return new Promise((resolve, reject) => {
        // Cria uma <script> tag — não tem restrição de CORS
        const cbName = '_gsCallback_' + Date.now();
        const script = document.createElement('script');

        // Timeout de 15 segundos
        const timer = setTimeout(() => {
            delete window[cbName];
            script.remove();
            reject(new Error('Timeout ao chamar Apps Script'));
        }, 15000);

        window[cbName] = function (data) {
            clearTimeout(timer);
            delete window[cbName];
            script.remove();
            // Simula um Response para manter a interface igual ao fetch normal
            resolve({
                ok: true,
                json: () => Promise.resolve(data),
                text: () => Promise.resolve(typeof data === 'string' ? data : JSON.stringify(data))
            });
        };

        // Adiciona callback JSONP na URL
        const sep = url.includes('?') ? '&' : '?';
        script.src = url + sep + 'callback=' + cbName;
        script.onerror = () => {
            clearTimeout(timer);
            delete window[cbName];
            reject(new Error('Erro ao carregar script do Apps Script'));
        };
        document.head.appendChild(script);
    });
}

const chavesMateriais = ['IDMaterial', 'N° DO BOU', 'DATA', 'CATEGORIA', 'DESCRIÇÃO', 'LOCAL', 'DATA DE DEPOSITO', 'ESAJ', 'STATUS'];
const chavesEditaveis = chavesMateriais.filter(function (k) { return k !== 'IDMaterial'; });

const sidebar = document.getElementById('form-materiais');
const overlay = document.getElementById('overlay-sidebar');

// --- 1. FUNÇÕES DE LOGIN E RELÓGIO (IGUAIS AO CADASTRO) ---
function checkLogin() {
    const graduacao = localStorage.getItem('userGraduacao');
    const nomeGuerra = localStorage.getItem('userNomeGuerra');
    const userInfoEl = document.getElementById('user-info');

    if (graduacao && nomeGuerra) {
        userInfoEl.innerHTML = `
                <p>Bem Vindo(a):</p>
                <p class="user-nome">${graduacao} ${nomeGuerra}</p>
            `;
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

// --- 2. FUNÇÕES DE DADOS E TABELA ---
async function fetchData() {
    try {
        const response = await appsScriptFetch(WEBAPP_URL + '?action=read');
        const data = await response.json();
        allMateriais = data;
        renderTable(allMateriais);
        loadTotalCounts();
        if (document.getElementById('mensagem-carregamento')) {
            document.getElementById('mensagem-carregamento').style.display = 'none';
        }
    } catch (error) {
        console.error("Erro ao buscar dados:", error);
    }
}

function renderTable(dataToRender) {
    const tbody = document.querySelector('#tabela-materiais tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    dataToRender.forEach(function (item) {
        const row = tbody.insertRow();

        // 1. Coluna IDMaterial
        row.insertCell().textContent = item.IDMaterial || '';

        // 2. Colunas dinâmicas baseadas em chavesEditaveis
        chavesEditaveis.forEach(function (key) {
            const cell = row.insertCell();
            const valor = item[key] || '';

            // Lógica para a coluna STATUS (Badges coloridas)
            if (key === 'STATUS') {
                const sClass = String(valor).replace(/\s+/g, '').toLowerCase();
                cell.innerHTML = '<span class="status-badge status-' + sClass + '">' + valor + '</span>';
            }

            // --- NOVO: LÓGICA DO LINK E-SAJ (Igual ao tco.js) ---
            else if (key === 'ESAJ' && valor) {
                const numLimpo = String(valor).replace(/\D/g, ''); // Remove pontos e traços
                cell.innerHTML = `
                    <a href="https://www2.tjal.jus.br/cpopg/search.do?conversationId=&cbPesquisa=NUMPROC&dadosConsulta.valorConsulta=${numLimpo}&numeroDigitado=${numLimpo}" 
                       target="_blank" 
                       style="color:#1a3d5d; font-weight:bold; text-decoration:underline;">
                       ${valor}
                    </a>`;
            }
            // ---------------------------------------------------

            else {
                cell.textContent = valor;
            }
        });

        // 3. Coluna de AÇÕES
        const acoesCell = row.insertCell();
        acoesCell.style.display = 'flex';
        acoesCell.style.gap = '5px';

        // Botão Editar (Sempre visível)
        const btnEditar = document.createElement('button');
        btnEditar.className = 'btn-editar-sidebar';
        btnEditar.style.cssText = 'background:#2c3e50; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;';
        btnEditar.textContent = 'Editar';
        btnEditar.onclick = () => toggleSidebar(true, item);
        acoesCell.appendChild(btnEditar);

        // Botão TERMO (Status: A DEVOLVER)
        if (String(item.STATUS).toUpperCase() === 'A DEVOLVER') {
            const btnTermo = document.createElement('button');
            btnTermo.style.cssText = 'background:#e67e22; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer; font-weight:bold;';
            btnTermo.textContent = 'TERMO';
            btnTermo.onclick = () => gerarTermo(item);
            acoesCell.appendChild(btnTermo);
        }

        // Botão FIEL DEPOSITÁRIO (Status: FIEL DEPOSITÁRIO)
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

function gerarTermo(item) {
    // Salva os dados do item selecionado para o termo
    localStorage.setItem('dadosTermo', JSON.stringify(item));
    // Abre a nova página do termo
    window.open('../termos/termo_devolucao.html', '_blank');
}

// --- 3. FILTROS ---
function aplicarFiltro() {
    var campo = document.getElementById('filtro-tipo').value;
    var busca = document.getElementById('filtro-valor-text').value.toLowerCase();
    if (!campo || !busca) return;

    filtradosAtivos = allMateriais.filter(function (i) {
        return String(i[campo] || "").toLowerCase().indexOf(busca) > -1;
    });

    renderTable(filtradosAtivos);
    document.getElementById('btn-limpar-filtro').style.display = 'inline-block';
}

function limparFiltro() {
    document.getElementById('filtro-tipo').value = "";
    document.getElementById('filtro-valor-text').value = "";
    document.getElementById('btn-limpar-filtro').style.display = 'none';
    filtradosAtivos = null; // Reseta o estado do filtro
    renderTable(allMateriais);
}

// --- 4. IMPRESSÃO (FILTRADO OU TOTAL) ---
function imprimirTabela() {
    // Se houver filtro aplicado, usa os filtrados, senão usa todos
    const dadosParaImprimir = filtradosAtivos ? filtradosAtivos : allMateriais;

    if (dadosParaImprimir.length === 0) return alert("Não há dados para imprimir.");

    localStorage.setItem('dadosParaImpressao', JSON.stringify(dadosParaImprimir));
    window.open('../relatorios/relatoriomateriais.html', '_blank');
}

// --- 5. LOGOUT E OUTROS ---
function efetuarLogout() {
    localStorage.clear();
    window.location.href = '../page/login.html';
}

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
    if (!dataStr || !dataStr.includes('/')) return dataStr;
    var p = dataStr.split('/');
    return p[2] + '-' + p[1] + '-' + p[0];
}

// --- FUNÇÃO DE CONTAGEM ATUALIZADA ---
function loadTotalCounts() {
    const agora = new Date();
    const anoAtual = agora.getFullYear().toString();
    const anoAnterior = (agora.getFullYear() - 1).toString();

    // 1. Total de Materiais (Todos exceto DEVOLVIDO)
    const materiaisAtivosGeral = allMateriais.filter(item => {
        return String(item.STATUS || "").toUpperCase() !== 'DEVOLVIDO';
    });
    const elTotal = document.getElementById('total-materiais');
    if (elTotal) elTotal.textContent = materiaisAtivosGeral.length;

    // 2. Total do Ano (Ativos do ano atual)
    const ativosAnoAtual = materiaisAtivosGeral.filter(item => {
        return String(item.DATA || "").indexOf(anoAtual) > -1;
    });
    const elAnoAtual = document.getElementById('total-ano-atual');
    if (elAnoAtual) elAnoAtual.textContent = ativosAnoAtual.length;

    // 3. Total Ano Anterior (Ativos do ano anterior)
    const ativosAnoAnterior = materiaisAtivosGeral.filter(item => {
        return String(item.DATA || "").indexOf(anoAnterior) > -1;
    });
    const elAnoAnterior = document.getElementById('total-ano-anterior');
    if (elAnoAnterior) elAnoAnterior.textContent = ativosAnoAnterior.length;
}

// --- FETCH DATA ATUALIZADO ---
async function fetchData() {
    try {
        const response = await appsScriptFetch(WEBAPP_URL + '?action=read');
        const data = await response.json();
        allMateriais = data;

        renderTable(allMateriais);
        loadTotalCounts(); // Chama a contagem logo após carregar os dados

        if (document.getElementById('mensagem-carregamento')) {
            document.getElementById('mensagem-carregamento').style.display = 'none';
        }
    } catch (error) {
        console.error("Erro ao buscar dados:", error);
        if (document.getElementById('mensagem-carregamento')) {
            document.getElementById('mensagem-carregamento').textContent = "Erro ao carregar dados.";
        }
    }
}
// Lógica para o botão de sincronização
document.getElementById('btn-sincronizar-esaj').onclick = async function () {
    const btn = this;
    if (!confirm("Deseja atualizar os status via API DataJud? Isso pode levar alguns minutos.")) return;

    btn.disabled = true;
    btn.innerHTML = `<img width="20" height="20" src="https://img.icons8.com/material-outlined/24/ffffff/refresh.png"/> Sincronizando...`;

    try {
        const url = WEBAPP_URL + "?action=sincronizar";
        const response = await appsScriptFetch(url);
        const texto = await response.text();
        alert("✅ " + texto);
        await fetchData();
    } catch (e) {
        console.error("Erro na sincronização:", e);
        alert("Erro ao sincronizar: " + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<img width="20" height="20" src="https://img.icons8.com/material-outlined/24/ffffff/refresh.png"/> Sincronizar e-SAJ`;
    }
};

// --- INICIALIZAÇÃO ---
document.addEventListener('DOMContentLoaded', function () {
    checkLogin();
    atualizarRelogio();
    setInterval(atualizarRelogio, 1000);
    fetchData();

    document.getElementById('btn-logout').onclick = efetuarLogout;
    document.getElementById('btn-adicionar-cadastro').onclick = function () { toggleSidebar(true); };
    document.getElementById('btn-fechar-sidebar').onclick = function () { toggleSidebar(false); };
    if (overlay) overlay.onclick = function () { toggleSidebar(false); };
    sidebar.onsubmit = salvarDados;
    document.getElementById('btn-aplicar-filtro').onclick = aplicarFiltro;
    document.getElementById('btn-limpar-filtro').onclick = limparFiltro;
    document.getElementById('btn-imprimir').onclick = imprimirTabela;
});

async function salvarDados(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-salvar-form');
    btn.disabled = true;
    btn.textContent = "Processando...";
    const payload = {
        action: document.getElementById('form-id').value ? 'update' : 'create',
        IDMaterial: document.getElementById('form-id').value,
        'N° DO BOU': document.getElementById('bou').value,
        'DATA': document.getElementById('data').value,
        'CATEGORIA': document.getElementById('categoria').value,
        'DESCRIÇÃO': document.getElementById('descricao').value,
        'LOCAL': document.getElementById('localdeposito').value,
        'DATA DE DEPOSITO': document.getElementById('data-deposito').value,
        'ESAJ': document.getElementById('esaj').value,
        'STATUS': document.getElementById('status').value
    };
    try {
        await fetch(WEBAPP_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/x-form-urlencoded' },
            body: new URLSearchParams(payload)
        });
        alert("Operação realizada com sucesso!");
        toggleSidebar(false);
        setTimeout(fetchData, 1500);
    } catch (error) {
        alert("Erro ao salvar.");
    } finally {
        btn.disabled = false;
        btn.textContent = "SALVAR DADOS";
    }
}