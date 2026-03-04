// CONFIGURAÇÕES DO FIREBASE
const DATABASE_URL = 'https://sistema-p3-default-rtdb.firebaseio.com';
const NODE_TCO = 'tco_geral';
const NODE_META = '_meta_tco';

// URL do Apps Script — proxy para o DataJud (evita bloqueio CORS)
const WEBAPP_URL_TCO = 'https://script.google.com/macros/s/AKfycbwzoX1jw8mAREN24oiFRDxs2xF2xmIhsDS8M--VmIeSeuubNYflf5UTORAnF4JahFtn/exec';

let dadosTCO = [];

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

async function exibirUltimaSincronizacao() {
    try {
        const res = await fetch(`${DATABASE_URL}/${NODE_META}/ultima_sincronizacao.json`);
        const data = await res.json();
        const el = document.getElementById('ultima-sincronizacao');
        if (!el) return;
        if (!data || !data.timestamp) {
            el.textContent = 'Última sincronização: nunca realizada';
            return;
        }
        const dt = new Date(data.timestamp);
        const formatada = dt.toLocaleDateString('pt-BR', { timeZone: 'America/Maceio' }) + ' às ' +
            dt.toLocaleTimeString('pt-BR', { timeZone: 'America/Maceio', hour: '2-digit', minute: '2-digit' });
        el.innerHTML = `🔄 Última sincronização automática: <b>${formatada}</b>` +
            (data.atualizados !== undefined ? ` — ${data.atualizados} atualizados` : '') +
            (data.naoEncontrados !== undefined ? `, ${data.naoEncontrados} não encontrados` : '');
    } catch (e) {
        console.warn('Não foi possível carregar a última sincronização:', e);
    }
}

async function registrarSincronizacao(atualizados, naoEncontrados, origem) {
    await fetch(`${DATABASE_URL}/${NODE_META}/ultima_sincronizacao.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            timestamp: new Date().toISOString(),
            atualizados: atualizados || 0,
            naoEncontrados: naoEncontrados || 0,
            origem: origem || 'manual'
        })
    });
}

async function loadTCO() {
    try {
        const msgCarregamento = document.getElementById('mensagem-carregamento');
        if (msgCarregamento) msgCarregamento.style.display = 'block';

        const resTco = await fetch(`${DATABASE_URL}/${NODE_TCO}.json`);
        const dataTco = await resTco.json();

        if (!dataTco) {
            renderTable([]);
            atualizarContadores([]);
            if (msgCarregamento) msgCarregamento.style.display = 'none';
            return;
        }

        dadosTCO = Object.keys(dataTco).map(id => {
            let item = dataTco[id];
            if (!item) return null;
            item.id_realtime = id;
            return item;
        }).filter(item => item !== null);

        dadosTCO.sort((a, b) => {
            const tempoA = a.DATA ? new Date(a.DATA).getTime() : 0;
            const tempoB = b.DATA ? new Date(b.DATA).getTime() : 0;
            return tempoB - tempoA;
        });

        renderTable(dadosTCO);
        atualizarContadores(dadosTCO);
        if (msgCarregamento) msgCarregamento.style.display = 'none';

    } catch (err) {
        console.error("Erro ao carregar TCO:", err);
    }
}

function atualizarContadores(dados) {
    const anoAtual = new Date().getFullYear();
    const anoAnterior = anoAtual - 1;
    let totalAtual = 0, totalAnterior = 0;

    dados.forEach(item => {
        if (!item['DATA']) return;
        let ano = null;
        const val = item['DATA'].toString().trim();
        if (val.includes('/')) {
            const partes = val.split('/');
            if (partes.length === 3) ano = parseInt(partes[2], 10);
        } else if (val.includes('-')) {
            ano = parseInt(val.split('-')[0], 10);
        }
        if (!ano || isNaN(ano)) return;
        if (ano === anoAtual) totalAtual++;
        else if (ano === anoAnterior) totalAnterior++;
    });

    const elAtual = document.getElementById('total-ano-atual');
    const elAnterior = document.getElementById('total-ano-anterior');
    if (elAtual) elAtual.textContent = totalAtual;
    if (elAnterior) elAnterior.textContent = totalAnterior;
}

function renderTable(data) {
    const tbody = document.querySelector('#tabela-tco tbody');
    tbody.innerHTML = '';

    data.forEach(item => {
        const tr = document.createElement('tr');

        let dataFormatada = "";
        if (item['DATA']) {
            const d = new Date(item['DATA']);
            dataFormatada = !isNaN(d) ? d.toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : item['DATA'];
        }

        let horaFormatada = item['Hora'] || "";
        if (horaFormatada.includes('T')) {
            horaFormatada = horaFormatada.split('T')[1].substring(0, 5);
        }

        const stringDoc = JSON.stringify(item).replace(/'/g, "&apos;").replace(/"/g, "&quot;");
        const numEsaj = item['LocalE-SAJ'] || item['E-SAJ'] || item['ESAJ'] || "";
        const numLimpo = numEsaj.replace(/\D/g, '');

        const linkEsaj = numEsaj
            ? `<a href="https://www2.tjal.jus.br/cpopg/search.do?conversationId=&cbPesquisa=NUMPROC&dadosConsulta.valorConsulta=${numLimpo}&numeroDigitado=${numLimpo}" target="_blank" style="color:#1a3d5d; font-weight:bold; text-decoration:underline;">${numEsaj}</a>`
            : "";

        tr.innerHTML = `
            <td>${item['ID'] || ""}</td>
            <td>${item['Dia da Semana'] || ""}</td>
            <td>${item['Mês'] || ""}</td>
            <td>${horaFormatada}</td>
            <td>${item['Nº Ocorrência'] || ""}</td>
            <td>${dataFormatada}</td>
            <td>${item['SERVIÇO'] || ""}</td>
            <td>${item['OPERADOR CAPA'] || ""}</td>
            <td>${item['SISDOC'] || ""}</td>
            <td>${item['Tipicidade Geral'] || ""}</td>
            <td>${item['Movimentação'] || ""}</td>
            <td>${item['OBS:'] || ""}</td>
            <td>${item['Material Apreendido'] || ""}</td>
            <td>${item['Data Envio'] || ""}</td>
            <td>${linkEsaj}</td>
            <td>${item['PETICIONADOR'] || ""}</td>
            <td>${item['Endereço'] || ""}</td>
            <td>${item['Vistoriou?'] || ""}</td>
            <td>${item['NUMERO_LACRE'] || ""}</td>
            <td><button class="btn-editar" onclick='preencherParaEditar(${stringDoc})'>EDITAR</button></td>
        `;
        tbody.appendChild(tr);
    });
}

// ====================================================================
// FILTRO E LIMPAR FILTRO
// ====================================================================
function aplicarFiltro() {
    const tipo = document.getElementById('filtro-tipo').value;
    const valor = document.getElementById('filtro-valor-text').value.toLowerCase().trim();

    if (!tipo || !valor) {
        alert('Selecione um campo e digite um valor para filtrar.');
        return;
    }

    const filtrados = dadosTCO.filter(item =>
        (item[tipo] || '').toString().toLowerCase().includes(valor)
    );

    renderTable(filtrados);

    const btnLimpar = document.getElementById('btn-limpar-filtro');
    if (btnLimpar) btnLimpar.style.display = 'inline-block';
}

function limparFiltro() {
    document.getElementById('filtro-tipo').value = '';
    document.getElementById('filtro-valor-text').value = '';

    const btnLimpar = document.getElementById('btn-limpar-filtro');
    if (btnLimpar) btnLimpar.style.display = 'none';

    renderTable(dadosTCO);
}

// ====================================================================
// SINCRONIZAÇÃO EM LOTES
// ====================================================================
async function sincronizarEsajTCO() {
    const btn = document.getElementById('btn-sincronizar-esaj-tco');
    if (!confirm("Deseja atualizar as Movimentações via API DataJud?\nApenas TCOs com 'PROTOCOLADO ESAJ' serão verificados.\n\nCom muitos registros pode levar alguns minutos — não feche a aba.")) return;

    let painel = document.getElementById('painel-progresso-esaj');
    if (!painel) {
        painel = document.createElement('div');
        painel.id = 'painel-progresso-esaj';
        painel.style.cssText = `
            display:inline-flex; align-items:center; gap:10px;
            background:#1a3d5d; color:#fff; border-radius:6px;
            padding:7px 14px; font-size:13px; margin-left:8px;
            vertical-align:middle; max-width:520px; flex-wrap:wrap;
        `;
        btn.insertAdjacentElement('afterend', painel);
    }

    if (!document.getElementById('spin-style')) {
        const s = document.createElement('style');
        s.id = 'spin-style';
        s.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
        document.head.appendChild(s);
    }

    const spinner = `<span style="display:inline-block;width:12px;height:12px;border:2px solid #fff;
        border-top-color:transparent;border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0;"></span>`;

    btn.disabled = true;
    btn.innerHTML = '<img width="20" height="20" src="https://img.icons8.com/material-outlined/24/ffffff/refresh.png"/> Sincronizando...';

    let totalAtualizados = 0, totalNaoEncontrados = 0, totalErros = 0;
    let offset = 0;
    let totalElegivel = null;

    try {
        while (true) {
            const url = `${WEBAPP_URL_TCO}?action=sincronizarTCOFirebase&offset=${offset}`;

            painel.style.display = 'inline-flex';
            if (totalElegivel) {
                const pct = Math.round((Math.min(offset, totalElegivel) / totalElegivel) * 100);
                painel.innerHTML = `${spinner} <span>Lote ${Math.min(offset, totalElegivel)}/${totalElegivel} (${pct}%) — atualizados: <b>${totalAtualizados}</b></span>`;
            } else {
                painel.innerHTML = `${spinner} <span>Iniciando sincronização em lotes...</span>`;
            }

            const res = await fetch(url, { method: 'GET', redirect: 'follow' });
            if (!res.ok) throw new Error('Servidor retornou status ' + res.status);

            const dados = await res.json();
            if (dados.status === 'error') throw new Error(dados.mensagem || 'Erro no servidor');

            totalAtualizados    += dados.atualizados    || 0;
            totalNaoEncontrados += dados.naoEncontrados || 0;
            totalErros          += dados.erros          || 0;
            if (dados.totalElegivel) totalElegivel = dados.totalElegivel;

            if (dados.status === 'concluido' || dados.proximoOffset === null || dados.proximoOffset === undefined) break;

            const novoOffset = parseInt(dados.proximoOffset, 10);
            if (novoOffset <= offset) {
                console.warn('Offset não avançou! Abortando.', { offset, novoOffset });
                break;
            }
            offset = novoOffset;
            await new Promise(r => setTimeout(r, 1000));
        }

        await registrarSincronizacao(totalAtualizados, totalNaoEncontrados, 'manual');

        painel.style.background = '#155724';
        painel.innerHTML = `
            ✅ <b>Concluído!</b> &nbsp;
            ${totalElegivel ?? '?'} verificados &nbsp;|&nbsp;
            ${totalAtualizados} atualizados &nbsp;|&nbsp;
            ${totalNaoEncontrados} não encontrados
            ${totalErros > 0 ? ` | <span style="color:#f9c74f">${totalErros} com erro</span>` : ''}
        `;
        setTimeout(() => { painel.style.display = 'none'; painel.style.background = '#1a3d5d'; }, 15000);

        await exibirUltimaSincronizacao();
        await loadTCO();

    } catch (err) {
        console.error("Erro na sincronização:", err);
        painel.style.background = '#7b1c1c';
        painel.innerHTML = `❌ <b>Erro:</b> ${err.message}`;
        setTimeout(() => { painel.style.display = 'none'; painel.style.background = '#1a3d5d'; }, 10000);
    }

    btn.disabled = false;
    btn.innerHTML = '<img width="20" height="20" src="https://img.icons8.com/material-outlined/24/ffffff/refresh.png"/> Sincronizar e-SAJ';
}

// ====================================================================
// PREENCHER PARA EDITAR
// ====================================================================
window.preencherParaEditar = (item) => {
    const form = document.getElementById('form-tco');
    form.reset();
    const inputId = document.getElementById('form-id-tco');
    if (inputId) inputId.value = item.id_realtime || "";
    const inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach(campo => {
        const name = campo.getAttribute('name');
        if (name && item[name] !== undefined) {
            let valor = item[name];
            if (campo.type === 'date' && typeof valor === 'string' && valor.includes('/')) {
                const p = valor.split('/');
                valor = `${p[2]}-${p[1]}-${p[0]}`;
            }
            campo.value = valor;
        }
    });
    toggleSidebar(true);
};

// ====================================================================
// ESPELHAR NA PLANILHA
// ====================================================================
function espelharNaPlanilha(payload, firebaseId) {
    const params = new URLSearchParams();
    params.set('action', 'espelharTCONaPlanilha');
    params.set('firebaseId', firebaseId || '');
    for (const [k, v] of Object.entries(payload)) {
        params.set(k, v);
    }
    fetch(`${WEBAPP_URL_TCO}?${params.toString()}`, { method: 'GET', redirect: 'follow' })
        .then(r => r.json())
        .then(d => {
            if (d.status === 'success') {
                console.log('[Planilha] Espelhado com sucesso:', d.nrOcorrencia || firebaseId);
            } else {
                console.warn('[Planilha] Retorno inesperado:', d);
            }
        })
        .catch(err => console.warn('[Planilha] Falha ao espelhar (não crítico):', err.message));
}

// ====================================================================
// SALVAR (POST/PATCH)
// ====================================================================
async function salvarDados(e) {
    e.preventDefault();
    const btnSalvar = document.getElementById('btn-salvar-form');
    const formData = new FormData(e.target);
    const payload = Object.fromEntries(formData.entries());
    const id = payload.id_realtime;
    delete payload.id_realtime;

    const url = id
        ? `${DATABASE_URL}/${NODE_TCO}/${id}.json`
        : `${DATABASE_URL}/${NODE_TCO}.json`;

    if (btnSalvar) { btnSalvar.disabled = true; btnSalvar.textContent = "Gravando..."; }

    try {
        const res = await fetch(url, {
            method: id ? 'PATCH' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            let firebaseId = id;
            if (!id) {
                const resData = await res.json();
                firebaseId = resData?.name || '';
            }
            espelharNaPlanilha(payload, firebaseId);
            alert("Dados salvos com sucesso!");
            toggleSidebar(false);
            loadTCO();
        }
    } catch (err) {
        console.error("Erro ao salvar:", err);
    } finally {
        if (btnSalvar) { btnSalvar.disabled = false; btnSalvar.textContent = "SALVAR TCO"; }
    }
}

// ====================================================================
// TOGGLE SIDEBAR
// ====================================================================
function toggleSidebar(show) {
    const sidebar = document.getElementById('form-tco');
    const overlay = document.getElementById('overlay');
    if (show) {
        sidebar.classList.add('active');
        if (overlay) overlay.classList.add('active');
    } else {
        sidebar.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
        const inputId = document.getElementById('form-id-tco');
        if (inputId) inputId.value = "";
        sidebar.reset();
    }
}

// ====================================================================
// INICIALIZAÇÃO
// ====================================================================
document.addEventListener('DOMContentLoaded', () => {
    checkLogin();
    loadTCO();
    atualizarRelogio();
    exibirUltimaSincronizacao();
    setInterval(atualizarRelogio, 1000);

    const formTco = document.getElementById('form-tco');
    if (formTco) formTco.onsubmit = salvarDados;

    const btnAdd = document.getElementById('btn-adicionar-cadastro');
    if (btnAdd) btnAdd.onclick = () => toggleSidebar(true);

    const btnFechar = document.getElementById('btn-fechar-sidebar');
    if (btnFechar) btnFechar.onclick = () => toggleSidebar(false);

    const btnSincronizar = document.getElementById('btn-sincronizar-esaj-tco');
    if (btnSincronizar) btnSincronizar.onclick = sincronizarEsajTCO;

    const btnAplicar = document.getElementById('btn-aplicar-filtro');
    if (btnAplicar) btnAplicar.onclick = aplicarFiltro;

    const btnLimpar = document.getElementById('btn-limpar-filtro');
    if (btnLimpar) btnLimpar.onclick = limparFiltro;

    const btnImprimir = document.getElementById('btn-imprimir');
    if (btnImprimir) btnImprimir.onclick = () => window.print();
});