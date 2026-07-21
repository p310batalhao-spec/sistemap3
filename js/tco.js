// ====================================================================
// CONFIGURAÇÃO — URL do Web App do Apps Script (planilha TCO GERAL)
// ====================================================================
const APPS_SCRIPT_TCO_URL = 'https://script.google.com/macros/s/AKfycbzgewj7KjnTtWrnmnE7dcrz99CCpW1G3xw4Zft59dyIPL91avy1fqdVvgL1mRcIYhLP/exec';

var dadosTCO = [];  // var garante acesso via window.dadosTCO de outros scripts

// ====================================================================
// RELÓGIO E LOGIN
// ====================================================================
function atualizarRelogio() {
    const agora = new Date();
    const el = document.getElementById('relogio');
    if (el) el.innerHTML =
        agora.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' }) +
        '<br>' + agora.toLocaleTimeString('pt-BR');
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

// ====================================================================
// ÚLTIMA SINCRONIZAÇÃO (agora via localStorage)
// ====================================================================
function exibirUltimaSincronizacao() {
    const el = document.getElementById('ultima-sincronizacao');
    if (!el) return;
    const salvo = localStorage.getItem('tco_ultima_sync');
    if (salvo) {
        try {
            const d = JSON.parse(salvo);
            el.innerHTML = `🔄 Última sincronização: <b>${d.data}</b>` +
                (d.atualizados !== undefined ? ` — ${d.atualizados} atualizados` : '') +
                (d.naoEncontrados !== undefined ? `, ${d.naoEncontrados} não encontrados` : '');
        } catch {
            el.textContent = `🔄 Última sincronização: ${salvo}`;
        }
    } else {
        el.textContent = '🔄 Última sincronização: nunca realizada';
    }
}

function registrarSincronizacao(atualizados, naoEncontrados, origem) {
    const dados = {
        data: new Date().toLocaleString('pt-BR', { timeZone: 'America/Maceio' }),
        atualizados: atualizados || 0,
        naoEncontrados: naoEncontrados || 0,
        origem: origem || 'manual'
    };
    localStorage.setItem('tco_ultima_sync', JSON.stringify(dados));
    exibirUltimaSincronizacao();
}

// ====================================================================
// CARREGAR DADOS DO GOOGLE SHEETS
// ====================================================================
async function loadTCO() {
    const msgCarregamento = document.getElementById('mensagem-carregamento');
    if (msgCarregamento) msgCarregamento.style.display = 'block';

    const skeletons = document.getElementById('lista-skeletons');
    if (skeletons) skeletons.style.display = 'block';

    try {
        const res = await fetch(`${APPS_SCRIPT_TCO_URL}?action=getTCO`, { redirect: 'follow' });
        const json = await res.json();

        // CORREÇÃO: em vez de falhar silenciosamente, exibe mensagem de erro visível
        if (!Array.isArray(json)) {
            console.error('Resposta inesperada ao carregar TCO:', json);
            const lista = document.getElementById('lista-tco');
            if (lista) {
                lista.innerHTML = `
                    <div style="text-align:center; padding:2rem 1rem; color:#991b1b;
                                background:#fee2e2; border-radius:8px; margin-top:.5rem;">
                        <strong>⚠️ Erro ao carregar dados da planilha.</strong><br>
                        <small style="color:#7f1d1d;">
                            ${json?.message || 'Resposta inválida da API. Verifique se o doGet foi publicado no Apps Script.'}
                        </small>
                    </div>`;
            }
            atualizarContadores([]);
            return;
        }

        // Ordena por DATA decrescente
        const parseTCODate = str => {
            if (!str) return 0;
            str = str.toString().trim();
            if (/^\d{2}\/\d{2}\/\d{4}/.test(str)) {
                const [d, m, a] = str.split('/');
                return new Date(`${a}-${m}-${d}T00:00:00Z`).getTime() || 0;
            }
            const t = new Date(str).getTime();
            return isNaN(t) ? 0 : t;
        };

        dadosTCO = json.sort((a, b) => parseTCODate(b['DATA']) - parseTCODate(a['DATA']));

        renderTable(dadosTCO);
        atualizarContadores(dadosTCO);

    } catch (err) {
        console.error('Erro ao carregar TCO:', err);
        const lista = document.getElementById('lista-tco');
        if (lista) {
            lista.innerHTML = `
                <div style="text-align:center; padding:2rem 1rem; color:#991b1b;
                            background:#fee2e2; border-radius:8px; margin-top:.5rem;">
                    <strong>⚠️ Falha de conexão com a API.</strong><br>
                    <small style="color:#7f1d1d;">${err.message}</small>
                </div>`;
        }
    } finally {
        if (msgCarregamento) msgCarregamento.style.display = 'none';
        if (skeletons) skeletons.style.display = 'none';
    }
}

// ====================================================================
// CONTADORES DE ANO
// ====================================================================
function atualizarContadores(dados) {
    const anoAtual = new Date().getFullYear();
    const anoAnterior = anoAtual - 1;
    let totalAtual = 0, totalAnterior = 0;

    dados.forEach(item => {
        if (!item['DATA']) return;
        const val = item['DATA'].toString().trim();
        let ano = null;
        if (val.includes('/')) {
            const p = val.split('/');
            if (p.length === 3) ano = parseInt(p[2], 10);
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

// ====================================================================
// RENDERIZAR LISTA (estilo AppSheet)
// ====================================================================
function classeBadge(mov) {
    if (!mov) return 'mov-DEFAULT';
    const m = mov.toString().toUpperCase().trim();
    if (m.includes('PROTOCOLADO'))  return 'mov-PROTOCOLADO';
    if (m.includes('ARQUIVADO'))    return 'mov-ARQUIVADO';
    if (m.includes('PENDENTE'))     return 'mov-PENDENTE';
    if (m.includes('REFAZER'))      return 'mov-REFAZER';
    if (m.includes('CAPA'))         return 'mov-CAPA';
    if (m.includes('ENCAMINHADO'))  return 'mov-ENCAMINHADO';
    if (m.includes('DIGITALIZADO')) return 'mov-DIGITALIZADO';
    if (m.includes('VISTORIADO'))   return 'mov-VISTORIADO';
    if (m.includes('ASSINADO'))     return 'mov-ASSINADO';
    if (m.includes('RECEBIDO'))     return 'mov-RECEBIDO';
    if (m.includes('PRONTO'))       return 'mov-PRONTO';
    return 'mov-DEFAULT';
}

function renderTable(dados) {
    const lista = document.getElementById('lista-tco');
    if (!lista) return;
    lista.innerHTML = '';

    const badgeTotal = document.getElementById('badge-total');
    if (badgeTotal) badgeTotal.textContent = dados.length + ' registro' + (dados.length !== 1 ? 's' : '');

    if (!dados.length) {
        lista.innerHTML = `
            <div style="text-align:center; padding:3rem 1rem; color:#9ca3af;">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    stroke-width="1.5" style="opacity:.3; display:block; margin:0 auto .75rem;">
                    <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/>
                    <line x1="9" y1="21" x2="9" y2="9"/>
                </svg>
                <p>Nenhum TCO encontrado.</p>
            </div>`;
        return;
    }

    // Aplica scroll limitado à lista
    lista.style.maxHeight = '600px';
    lista.style.overflowY = 'auto';
    lista.style.overflowX = 'hidden';
    lista.style.paddingRight = '4px';
    lista.style.scrollbarWidth = 'thin';

    // Função de parse de data (reutilizada na ordenação interna dos grupos)
    const parseDateMs = str => {
        if (!str) return 0;
        str = str.toString().trim();
        if (/^\d{2}\/\d{2}\/\d{4}/.test(str)) {
            const [d, m, a] = str.split('/');
            return new Date(`${a}-${m}-${d}T00:00:00Z`).getTime() || 0;
        }
        const t = new Date(str).getTime();
        return isNaN(t) ? 0 : t;
    };

    // Agrupa por mês preservando a ordem cronológica (dados já vêm ordenados desc por DATA)
    const grupos = {};
    const gruposOrdem = []; // mantém a ordem de inserção (mais recente primeiro)
    const ordemMeses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                        'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

    const mesPorDataMs = ms => {
        if (!ms) return '—';
        const dt = new Date(ms);
        return isNaN(dt) ? '—' : ordemMeses[dt.getUTCMonth()];
    };

    dados.forEach(d => {
        // Registros do formulário de TCO trazem 'Mês' pronto; registros
        // restaurados via CAD não têm esse campo — nesse caso, calcula
        // o mês a partir da própria DATA.
        const mes = d['Mês'] || mesPorDataMs(parseDateMs(d['DATA']));
        if (!grupos[mes]) {
            grupos[mes] = [];
            gruposOrdem.push(mes);
        }
        grupos[mes].push(d);
    });

    // Ordena cada grupo internamente por DATA decrescente (mais recente no topo)
    gruposOrdem.forEach(mes => {
        grupos[mes].sort((a, b) => parseDateMs(b['DATA']) - parseDateMs(a['DATA']));
    });

    // Ordena os grupos pelo mês mais recente que contém (usa a data do primeiro item)
    const gruposOrdenados = gruposOrdem.sort((a, b) => {
        const dataA = parseDateMs(grupos[a][0]?.['DATA']);
        const dataB = parseDateMs(grupos[b][0]?.['DATA']);
        return dataB - dataA; // decrescente
    });

    gruposOrdenados.forEach(mes => {
        const items = grupos[mes];

        const sep = document.createElement('div');
        sep.className = 'grupo-mes';
        sep.innerHTML = `
            <span class="grupo-mes-titulo">${mes}</span>
            <span class="grupo-mes-linha"></span>
            <span class="grupo-mes-count">${items.length}</span>`;
        lista.appendChild(sep);

        items.forEach(d => {
            // Campos possuem dois formatos possíveis no Firebase:
            //  - vindos do formulário "Cadastro de TCO" (ex: "Nº Ocorrência")
            //  - vindos da restauração/importação em massa via CAD (ex: "BOLETIM")
            const tipificacao = d['Tipicidade Geral'] || d['TIPIFICACAO_GERAL'] || '—';
            const numCop      = d['Nº Ocorrência']    || d['BOLETIM']          || '—';
            const dataFato    = formatarData(d['DATA']);
            const mov         = d['Movimentação']     || d['SOLUÇÃO']         || '—';

            // Campo E-SAJ: número do processo judicial
            const numEsaj  = (d['E-SAJ'] || d['ESAJ'] || d['LocalE-SAJ'] || '').toString().trim();
            const urlEsaj  = numEsaj
                ? `https://www2.tjal.jus.br/cpopg/search.do?cbPesquisa=NUMPROC` +
                  `&dadosConsulta.valorConsultaNuUnificado=${encodeURIComponent(numEsaj)}` +
                  `&dadosConsulta.tipoNuProcesso=UNIFICADO`
                : '';
            const esajHtml = numEsaj
                ? `<div class="meta-sisdoc">
                       <a href="${urlEsaj}" target="_blank" rel="noopener"
                          onclick="event.stopPropagation();"
                          style="color:#1a6bbf;font-size:.72rem;font-weight:600;
                                 text-decoration:underline;display:inline-flex;
                                 align-items:center;gap:3px;">
                           <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                                stroke="currentColor" stroke-width="2.5">
                               <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                               <polyline points="15 3 21 3 21 9"/>
                               <line x1="10" y1="14" x2="21" y2="3"/>
                           </svg>
                           ESAJ: ${numEsaj}
                       </a>
                   </div>`
                : '';

            const card = document.createElement('div');
            card.className = 'item-tco';

            card.innerHTML = `
                <div class="item-tco-icone">⚖️</div>
                <div class="item-tco-corpo">
                    <div class="item-tco-tipificacao" title="${tipificacao}">${tipificacao}</div>
                    <div class="item-tco-meta">
                        <span class="meta-cop">Nº ${numCop}</span>
                        <span class="meta-sep"></span>
                        <span class="meta-data">${dataFato}</span>
                    </div>
                    ${esajHtml}
                </div>
                <span class="badge-movimentacao ${classeBadge(mov)}">${mov}</span>
                <button class="btn-editar-item" title="Editar">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                </button>`;

            card.addEventListener('click', (e) => {
                if (e.target.closest('.btn-editar-item')) return;
                preencherParaEditar(d);
            });
            card.querySelector('.btn-editar-item').addEventListener('click', () => preencherParaEditar(d));

            lista.appendChild(card);
        });
    });
}

function formatarData(val) {
    if (!val) return '—';
    if (/^\d{2}\/\d{2}\/\d{4}/.test(val.toString().trim())) return val;
    const d = new Date(val);
    if (!isNaN(d)) return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
    return val;
}

// ====================================================================
// SALVAR (POST para Apps Script)
// ====================================================================
async function salvarDados(e) {
    e.preventDefault();
    const btnSalvar = document.getElementById('btn-salvar-form');
    const formData = new FormData(e.target);
    const payload  = Object.fromEntries(formData.entries());
    const idForm   = payload.id_realtime || payload['ID'] || '';
    delete payload.id_realtime;

    if (idForm) payload['ID'] = idForm;

    const action = idForm ? 'updateTCO' : 'createTCO';

    if (!idForm) payload['ID'] = 'TCO-' + Date.now();

    if (btnSalvar) { btnSalvar.disabled = true; btnSalvar.textContent = 'Gravando...'; }

    try {
        const res = await fetch(APPS_SCRIPT_TCO_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, ...payload })
        });
        const json = await res.json();

        if (json.status === 'success') {
            alert('Dados salvos com sucesso!');
            toggleSidebar(false);
            loadTCO();
        } else {
            alert('Erro ao salvar: ' + (json.message || 'resposta inesperada'));
        }
    } catch (err) {
        console.error('Erro ao salvar TCO:', err);
        alert('Erro de conexão ao salvar TCO.');
    } finally {
        if (btnSalvar) { btnSalvar.disabled = false; btnSalvar.textContent = 'SALVAR TCO'; }
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
        if (inputId) inputId.value = '';
        sidebar.reset();
    }
}

// ====================================================================
// PREENCHER PARA EDITAR
// ====================================================================
window.preencherParaEditar = (item) => {
    const form = document.getElementById('form-tco');
    form.reset();

    const inputId = document.getElementById('form-id-tco');
    if (inputId) inputId.value = item['ID'] || item.id_realtime || '';

    const inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach(campo => {
        const name = campo.getAttribute('name');
        if (!name || name === 'id_realtime') return;
        if (item[name] !== undefined) {
            let valor = item[name];
            if (campo.type === 'date' && typeof valor === 'string' && valor.includes('/')) {
                const p = valor.split('/');
                valor = `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
            }
            campo.value = valor;
        }
    });
    toggleSidebar(true);
};

// ====================================================================
// SINCRONIZAÇÃO e-SAJ
// ====================================================================
async function sincronizarEsajTCO() {
    const btn = document.getElementById('btn-sincronizar-esaj-tco');
    if (!confirm("Deseja atualizar as Movimentações via API DataJud?\nApenas TCOs com 'PROTOCOLADO ESAJ' serão verificados.\n\nCom muitos registros pode levar alguns minutos — não feche a aba.")) return;

    // Injeta estilos da barra de progresso (uma vez)
    if (!document.getElementById('esaj-sync-style')) {
        const s = document.createElement('style');
        s.id = 'esaj-sync-style';
        s.textContent = `
            @keyframes spin { to { transform: rotate(360deg); } }
            #painel-progresso-esaj {
                display:none; flex-direction:column; gap:8px;
                background:#0f2744; color:#fff; border-radius:10px;
                padding:14px 18px; margin-top:10px; width:100%; max-width:560px;
                box-shadow:0 4px 16px rgba(0,0,0,.25); font-size:13px;
            }
            #esaj-sync-titulo { display:flex; align-items:center; gap:8px; font-weight:bold; }
            #esaj-sync-spinner {
                display:inline-block; width:14px; height:14px;
                border:2px solid rgba(255,255,255,.3); border-top-color:#fff;
                border-radius:50%; animation:spin .7s linear infinite; flex-shrink:0;
            }
            .esaj-progress-wrap { background:rgba(255,255,255,.12); border-radius:6px; height:10px; overflow:hidden; }
            #esaj-progress-bar { height:100%; width:0%; background:linear-gradient(90deg,#42a5f5,#00e5ff); border-radius:6px; transition:width .4s ease; }
            .esaj-counters { display:flex; gap:16px; font-size:12px; opacity:.9; }
            .esaj-counter { display:flex; flex-direction:column; align-items:center; gap:1px; }
            .esaj-counter b { font-size:18px; line-height:1; }
            .esaj-counter span { font-size:10px; opacity:.65; text-transform:uppercase; letter-spacing:.05em; }
            #esaj-sync-log { max-height:80px; overflow-y:auto; font-size:11px; opacity:.65; line-height:1.6; }`;
        document.head.appendChild(s);
    }

    let painel = document.getElementById('painel-progresso-esaj');
    if (!painel) {
        painel = document.createElement('div');
        painel.id = 'painel-progresso-esaj';
        btn.parentNode.insertBefore(painel, btn.nextSibling);
    }
    painel.style.display = 'flex';
    painel.innerHTML = `
        <div id="esaj-sync-titulo">
            <span id="esaj-sync-spinner"></span>
            Sincronizando processos com o DataJud...
        </div>
        <div class="esaj-progress-wrap"><div id="esaj-progress-bar"></div></div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <div class="esaj-counters">
                <div class="esaj-counter"><b id="ec-atualiz">0</b><span>Atualizados</span></div>
                <div class="esaj-counter" style="color:#ffd54f;"><b id="ec-naoenco">0</b><span>Não encontrados</span></div>
                <div class="esaj-counter" style="color:#ef9a9a;"><b id="ec-erros">0</b><span>Erros</span></div>
                <div class="esaj-counter" style="color:#b3e5fc;"><b id="ec-total">—</b><span>Total elegível</span></div>
            </div>
            <span id="esaj-pct-txt" style="font-size:22px;font-weight:bold;opacity:.9;">0%</span>
        </div>
        <div id="esaj-sync-log"></div>`;

    const atualizarProgresso = (atualiz, naoEnco, erros, total, processados, logMsg) => {
        const pct = total > 0 ? Math.min(100, Math.round(processados / total * 100)) : 0;
        document.getElementById('esaj-progress-bar').style.width = pct + '%';
        document.getElementById('esaj-pct-txt').textContent = pct + '%';
        document.getElementById('ec-atualiz').textContent = atualiz;
        document.getElementById('ec-naoenco').textContent = naoEnco;
        document.getElementById('ec-erros').textContent   = erros;
        document.getElementById('ec-total').textContent   = total || '—';
        if (logMsg) {
            const log = document.getElementById('esaj-sync-log');
            log.innerHTML += `<div>${logMsg}</div>`;
            log.scrollTop  = log.scrollHeight;
        }
    };

    btn.disabled = true;
    btn.innerHTML = '⏳ Sincronizando...';

    let totalAtualizados = 0, totalNaoEncontrados = 0, totalErros = 0;
    let offset = 0, totalElegivel = null;

    try {
        while (true) {
            const url = `${APPS_SCRIPT_TCO_URL}?action=sincronizarTCOFirebase&offset=${offset}`;
            atualizarProgresso(totalAtualizados, totalNaoEncontrados, totalErros, totalElegivel, offset, null);

            const res = await fetch(url, { method: 'GET', redirect: 'follow' });
            if (!res.ok) throw new Error('Servidor retornou status ' + res.status);

            const dados = await res.json();
            if (dados.status === 'error') throw new Error(dados.message || dados.mensagem || 'Erro no servidor');

            totalAtualizados    += dados.atualizados    || 0;
            totalNaoEncontrados += dados.naoEncontrados || 0;
            totalErros          += dados.erros          || 0;
            if (dados.totalElegivel) totalElegivel = dados.totalElegivel;

            const logTxt = `Lote ${offset}→${dados.processadosAte || offset}: ` +
                `✅ ${dados.atualizados || 0} · 🔍 ${dados.naoEncontrados || 0} · ❌ ${dados.erros || 0}`;
            atualizarProgresso(totalAtualizados, totalNaoEncontrados, totalErros,
                totalElegivel, dados.processadosAte || offset, logTxt);

            if (dados.status === 'concluido' || dados.proximoOffset === null || dados.proximoOffset === undefined) break;

            const novoOffset = parseInt(dados.proximoOffset, 10);
            if (novoOffset <= offset) { console.warn('Offset não avançou! Abortando.'); break; }
            offset = novoOffset;
            await new Promise(r => setTimeout(r, 1000));
        }

        registrarSincronizacao(totalAtualizados, totalNaoEncontrados, 'manual');

        document.getElementById('esaj-progress-bar').style.width = '100%';
        document.getElementById('esaj-pct-txt').textContent = '100%';
        document.getElementById('ec-atualiz').textContent = totalAtualizados;
        document.getElementById('ec-naoenco').textContent = totalNaoEncontrados;
        document.getElementById('ec-erros').textContent   = totalErros;
        document.getElementById('ec-total').textContent   = totalElegivel ?? '?';
        const logEl = document.getElementById('esaj-sync-log');
        if (logEl) logEl.innerHTML += `<div style="color:#a5d6a7;font-weight:bold;margin-top:4px;">✅ Concluído!</div>`;
        const spinEl = document.getElementById('esaj-sync-spinner');
        if (spinEl) { spinEl.style.animation='none'; spinEl.textContent='✅'; }
        setTimeout(() => { painel.style.display = 'none'; }, 20000);

        exibirUltimaSincronizacao();
        await loadTCO();

    } catch (err) {
        console.error('Erro na sincronização:', err);
        painel.style.background = '#7b1c1c';
        const logErr = document.getElementById('esaj-sync-log');
        if (logErr) logErr.innerHTML += `<div style="color:#ef9a9a;font-weight:bold;">❌ ${err.message}</div>`;
        const titErr = document.getElementById('esaj-sync-titulo');
        if (titErr) titErr.innerHTML = `<span style="color:#ef9a9a;">❌ Erro na sincronização</span>`;
        setTimeout(() => { painel.style.display = 'none'; painel.style.background = '#1a3d5d'; }, 10000);
    }

    btn.disabled = false;
    btn.innerHTML = '<img width="20" height="20" src="https://img.icons8.com/material-outlined/24/ffffff/refresh.png"/> Sincronizar e-SAJ';
}

// ====================================================================
// FILTROS AVANÇADOS
// ====================================================================
function _normAv(texto) {
    if (!texto) return '';
    return texto.toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
}

function _toISOAv(str) {
    if (!str) return '';
    str = str.toString().trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.substring(0, 10);
    if (str.includes('/')) {
        const p = str.split('/');
        if (p.length === 3 && p[2].length === 4)
            return `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
    }
    return '';
}

function _getAv(doc, ...chaves) {
    for (const k of chaves) {
        const v = doc[k];
        if (v !== undefined && v !== null && v !== '') return String(v);
    }
    return '';
}

function filtroAvancado() {
    if (!dadosTCO || !dadosTCO.length) return;

    const busca = _normAv(document.getElementById('busca-geral-av')?.value);
    const ini   = document.getElementById('data-ini-av')?.value  || '';
    const fim   = document.getElementById('data-fim-av')?.value  || '';
    const tipic = _normAv(document.getElementById('tipicidade-av')?.value);
    const movi  = _normAv(document.getElementById('movimentacao-av')?.value);
    const oper  = _normAv(document.getElementById('operador-av')?.value);
    const mes   = _normAv(document.getElementById('mes-av')?.value);

    if (!busca && !ini && !fim && !tipic && !movi && !oper && !mes) {
        renderTable(dadosTCO);
        _badgeAv(dadosTCO.length);
        return;
    }

    const resultado = dadosTCO.filter(doc => {
        const docISO = _toISOAv(_getAv(doc, 'DATA'));

        if (busca && !_normAv(Object.values(doc).join(' ')).includes(busca)) return false;

        if ((ini || fim) && docISO) {
            if (ini && docISO < ini) return false;
            if (fim && docISO > fim) return false;
        }

        if (tipic) {
            const v = _normAv(_getAv(doc, 'Tipicidade Geral', 'TIPIFICACAO', 'TIPIFICACAO_GERAL'));
            if (!v.includes(tipic)) return false;
        }

        if (movi) {
            const v = _normAv(_getAv(doc, 'Movimentação', 'Movimentacao', 'MOVIMENTACAO', 'SOLUÇÃO', 'SOLUCAO'));
            if (!v.includes(movi)) return false;
        }

        if (oper) {
            const v = _normAv(_getAv(doc, 'OPERADOR CAPA'));
            if (!v.includes(oper)) return false;
        }

        if (mes) {
            const v = _normAv(_getAv(doc, 'Mês', 'Mes', 'MES'));
            if (!v.includes(mes)) return false;
        }

        return true;
    });

    renderTable(resultado);
    _badgeAv(resultado.length);
}

function limparFiltroAvancado() {
    ['busca-geral-av','data-ini-av','data-fim-av','tipicidade-av','movimentacao-av','operador-av','mes-av']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    renderTable(dadosTCO);
    _badgeAv(dadosTCO.length);
}

function _badgeAv(total) {
    const badge    = document.getElementById('badge-av');
    const contador = document.getElementById('contador-av');
    const totalG   = dadosTCO.length;

    if (total < totalG) {
        if (badge)    { badge.textContent = `${total} de ${totalG}`; badge.style.display = 'inline-block'; }
        if (contador) { contador.textContent = `Mostrando ${total} de ${totalG} registros`; contador.style.color = '#c0392b'; }
    } else {
        if (badge)    badge.style.display = 'none';
        if (contador) { contador.textContent = `Mostrando todos os ${totalG} registros`; contador.style.color = '#1a3d5d'; }
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

    const overlay = document.getElementById('overlay');
    if (overlay) overlay.onclick = () => toggleSidebar(false);

    const btnSincronizar = document.getElementById('btn-sincronizar-esaj-tco');
    if (btnSincronizar) btnSincronizar.onclick = sincronizarEsajTCO;

    const btnImprimir = document.getElementById('btn-imprimir');
    if (btnImprimir) btnImprimir.onclick = () => window.print();

    // Aguarda dadosTCO e atualiza contador
    (function aguardarDados() {
        const iv = setInterval(() => {
            if (typeof dadosTCO !== 'undefined' && dadosTCO.length > 0) {
                clearInterval(iv);
                _badgeAv(dadosTCO.length);
            }
        }, 300);
    })();
});