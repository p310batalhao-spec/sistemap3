// ====================================================================
// Sistema P3 — Modal único de login CAD + Quimera (reutilizável)
// ====================================================================
// 01/09/2026, pedido explícito do usuário: existiam 4 cópias divergentes
// do mesmo formulário (page/autores.html via js/core/cad-status-banner.js;
// js/preditivaCAD.js com lógica própria; page/rastreamento-guarnicao.html
// com lógica inline própria; page/consulta-pessoa.html/js/consulta-pessoa.js
// com o modal mais completo, CAD+Quimera). "quero que tenha um modal logo
// no index para fazer o login no CAD e QUIMERA que seja reutilizável em
// todas as páginas que necessitem dessas credenciais, retirando os campos
// de login dessas páginas e passando para um local único."
//
// Mesmo padrão de injeção de js/pessoa-modal.js: injeta CSS/HTML sob
// demanda (garantirEstilos/garantirModal, idempotentes), API global
// mínima. Qualquer página que precise do login CAD/Quimera só inclui:
//   <script src="../js/core/atualizador-local.js"></script>
//   <script src="../js/core/cad-login-modal.js"></script>
// e chama CadLoginModal.abrir() (de um botão) e, se quiser um indicador
// de status, CadLoginModal.montarBadge(elementoContainer).
//
// Salva SEMPRE nos dois lados (Apps Script + servidor local), igual o
// cad-status-banner.js já fazia — preserva o comportamento de páginas
// que dependem só do Apps Script (Preditiva CAD, Rastreamento de
// guarnição) e das que dependem só do servidor local (Consulta
// Integrada, Denúncias Recorrentes), sem cada página precisar saber
// qual delas usar.
(function (global) {
    'use strict';
    if (global.CadLoginModal) return;

    const GAS_CAD_URL = 'https://script.google.com/macros/s/AKfycbwuyKpN4AbmV_CmQfZr2olClY1JveArwKEcJE3__DFf74xfnd3AlhXqnde7RPkXDlqx/exec';
    const TOKEN_GEO_KEY = 'geo_cookie_p3';
    const TOKEN_GEO_TS_KEY = 'geo_cookie_ts_p3';
    const TOKEN_TTL_MS = 23 * 60 * 60 * 1000; // 23h — mesma janela usada antes em preditivaCAD.js/cad-status-banner.js
    const CAD_LOGIN_KEY = 'cad_login_p3';

    async function fetchCAD(acao, params) {
        const qs = new URLSearchParams(Object.assign({ acao: acao }, params || {})).toString();
        const resp = await fetch(GAS_CAD_URL + '?' + qs, { redirect: 'follow' });
        const texto = await resp.text();
        let data;
        try { data = JSON.parse(texto); }
        catch (e) { throw new Error('Resposta do Apps Script não é JSON válido: ' + texto.substring(0, 200)); }
        return data;
    }

    function garantirEstilos() {
        if (document.getElementById('clm-estilos')) return;
        const style = document.createElement('style');
        style.id = 'clm-estilos';
        style.textContent = `
            #clm-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:9200; align-items:center; justify-content:center; padding:20px; }
            #clm-overlay.aberto { display:flex; }
            .clm-box { background:var(--p3-surface,#fff); border:1px solid var(--p3-border,#ddd); border-radius:12px; max-width:520px; width:100%; overflow:hidden; box-shadow:0 16px 48px rgba(0,0,0,.35); max-height:90vh; overflow-y:auto; font-family:var(--p3-font, 'Inter', 'Segoe UI', Arial, sans-serif); }
            .clm-head { background:var(--p3-blue-700,#2f5fdd); color:#fff; padding:14px 18px; display:flex; justify-content:space-between; align-items:center; font-weight:700; font-size:.95rem; position:sticky; top:0; }
            .clm-head button { background:none; border:none; color:rgba(255,255,255,.75); font-size:1.3rem; cursor:pointer; line-height:1; }
            .clm-body { padding:18px; }
            .clm-secao-titulo { font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:var(--p3-text-muted,#7a7a72); margin:16px 0 8px; }
            .clm-secao-titulo:first-child { margin-top:0; }
            .clm-body label { display:block; font-size:.75rem; font-weight:700; text-transform:uppercase; color:var(--p3-text-muted,#7a7a72); margin-bottom:5px; }
            .clm-body input { width:100%; box-sizing:border-box; padding:9px 10px; border:2px solid var(--p3-border,#ddd); border-radius:6px; font-size:.92rem; margin-bottom:12px; background:var(--p3-bg,#fafaf8); color:var(--p3-text,#1c1c1a); }
            .clm-body input:focus { border-color:var(--p3-blue-700,#2f5fdd); outline:none; }
            .clm-instrucao { background:var(--p3-bg,#fafaf8); border-left:3px solid var(--p3-blue-700,#2f5fdd); padding:10px 14px; border-radius:0 6px 6px 0; font-size:12px; line-height:1.7; margin-bottom:14px; color:var(--p3-text,#1c1c1a); }
            .clm-body input.clm-token-field { height:46px; font-size:1.05rem; text-align:center; letter-spacing:3px; font-family:monospace; }
            #clm-msg { font-size:.8rem; margin-top:6px; min-height:1.2em; }
            .clm-foot { padding:0 18px 18px; display:flex; gap:8px; justify-content:flex-end; }
            .clm-foot .clm-cancelar { background:var(--p3-bg,#fafaf8); color:var(--p3-text,#1c1c1a); border:1px solid var(--p3-border,#ddd); border-radius:5px; padding:8px 16px; cursor:pointer; font-size:.85rem; }
            .clm-foot .clm-salvar { background:var(--p3-blue-700,#2f5fdd); color:#fff; border:none; border-radius:5px; padding:8px 16px; cursor:pointer; font-size:.85rem; font-weight:700; }
            .clm-badge { display:inline-flex; align-items:center; gap:6px; font-size:12px; padding:5px 10px; border-radius:999px; background:var(--p3-blue-100,#eef2fd); color:var(--p3-text,#1c1c1a); cursor:pointer; border:1px solid var(--p3-border,#ddd); }
            .clm-badge:hover { opacity:.85; }
        `;
        document.head.appendChild(style);
    }

    function garantirModal() {
        garantirEstilos();
        if (document.getElementById('clm-overlay')) return;
        const div = document.createElement('div');
        div.id = 'clm-overlay';
        div.innerHTML = `
            <div class="clm-box">
                <div class="clm-head">
                    🔑 Login CAD SEDS/AL e Quimera
                    <button type="button" id="clm-btn-fechar-x" title="Fechar">✕</button>
                </div>
                <div class="clm-body">
                    <div class="clm-secao-titulo">Login no CAD</div>
                    <div class="clm-instrucao">
                        <strong>Por que login e senha, além do token?</strong><br>
                        A consulta é liberada pela SUA conta pessoal (CPF+senha), não só pelo token — o token
                        sozinho só autentica o rastreamento de viaturas. É a MESMA sessão usada em todas as
                        telas que precisam do CAD.<br>
                        <span style="color:#b46400">⚠️ O token expira em 24h — renove diariamente.</span>
                    </div>
                    <label>CPF de acesso (só números):</label>
                    <input type="text" id="clm-login" placeholder="09089567461" inputmode="numeric">
                    <label>Senha:</label>
                    <input type="password" id="clm-senha" placeholder="Senha do CAD" autocomplete="off">
                    <label>Token de acesso (ex: TK2037113550):</label>
                    <input type="text" id="clm-token-cad" class="clm-token-field" placeholder="TK2037113550">

                    <div class="clm-secao-titulo">2ª fonte de foto — Quimera (opcional)</div>
                    <div class="clm-instrucao">
                        <strong>De onde vem esse código?</strong><br>
                        Chega por e-mail ("Aplicativo Quimera &lt;naoresponda@seguranca.al.gov.br&gt;") a cada
                        login novo no app Quimera. Deixe em branco pra não mexer no que já está salvo.<br>
                        <span style="color:#b46400">⚠️ Dura só ALGUMAS HORAS (bem menos que o token do CAD acima).
                        O login do Quimera usa o MESMO CPF do CAD acima, mas a senha pode ser diferente — se for
                        esse o seu caso, preencha "Senha do Quimera" abaixo.</span>
                    </div>
                    <label>Senha do Quimera (só se for diferente da senha do CAD):</label>
                    <input type="password" id="clm-senha-quimera" placeholder="Deixe em branco se for a mesma senha do CAD" autocomplete="off">
                    <label>Código de 6 dígitos:</label>
                    <input type="text" id="clm-token-quimera" class="clm-token-field" placeholder="000000" inputmode="numeric" maxlength="6">

                    <div id="clm-msg"></div>
                </div>
                <div class="clm-foot">
                    <button type="button" class="clm-cancelar" id="clm-btn-fechar">Cancelar</button>
                    <button type="button" class="clm-salvar" id="clm-btn-salvar">✅ Salvar</button>
                </div>
            </div>
        `;
        document.body.appendChild(div);

        document.getElementById('clm-login').addEventListener('input', function () { this.value = this.value.replace(/\D/g, ''); });
        document.getElementById('clm-token-cad').addEventListener('input', function () { this.value = this.value.toUpperCase(); });
        document.getElementById('clm-token-quimera').addEventListener('input', function () { this.value = this.value.replace(/\D/g, ''); });
        document.getElementById('clm-btn-fechar-x').addEventListener('click', fechar);
        document.getElementById('clm-btn-fechar').addEventListener('click', fechar);
        document.getElementById('clm-btn-salvar').addEventListener('click', salvar);
        div.addEventListener('click', function (e) { if (e.target === div) fechar(); });
    }

    async function abrir() {
        garantirModal();
        document.getElementById('clm-overlay').classList.add('aberto');
        document.getElementById('clm-senha').value = '';
        document.getElementById('clm-token-cad').value = '';
        document.getElementById('clm-token-quimera').value = '';
        document.getElementById('clm-senha-quimera').value = '';
        document.getElementById('clm-login').value = localStorage.getItem(CAD_LOGIN_KEY) || '';
        const msgEl = document.getElementById('clm-msg');
        msgEl.style.color = 'var(--p3-text-muted,#7a7a72)';
        msgEl.textContent = 'Carregando status atual...';
        try {
            if (typeof P3AtualizadorLocal !== 'undefined' && await P3AtualizadorLocal.disponivel()) {
                const [statusCad, statusIdseg] = await Promise.all([
                    P3AtualizadorLocal.statusCad(), P3AtualizadorLocal.idsegStatus(),
                ]);
                if (statusCad.login) document.getElementById('clm-login').value = statusCad.login;
                msgEl.textContent = 'CAD: ' + (statusCad.configurado ? '✅ configurado' : '⛔ não configurado')
                    + ' · 2ª fonte de foto: ' + (statusIdseg.configurado ? '✅ configurada' : '➖ não configurada');
            } else {
                msgEl.textContent = 'Servidor local não está respondendo — o login ainda pode ser salvo no Apps Script.';
            }
        } catch (e) {
            msgEl.textContent = 'Não foi possível carregar o status atual — preencha e salve normalmente.';
        }
    }

    function fechar() {
        const overlay = document.getElementById('clm-overlay');
        if (overlay) overlay.classList.remove('aberto');
    }

    async function salvar() {
        const login = document.getElementById('clm-login').value.trim();
        const senha = document.getElementById('clm-senha').value;
        const tokenCad = document.getElementById('clm-token-cad').value.trim();
        const tokenQuimera = document.getElementById('clm-token-quimera').value.trim();
        const senhaQuimera = document.getElementById('clm-senha-quimera').value;
        const msgEl = document.getElementById('clm-msg');
        const btn = document.getElementById('clm-btn-salvar');

        if (!login || login.length < 11) { msgEl.style.color = 'var(--p3-danger,#c0392b)'; msgEl.textContent = 'Informe o CPF de acesso ao CAD (11 dígitos).'; return; }
        if (!tokenCad) { msgEl.style.color = 'var(--p3-danger,#c0392b)'; msgEl.textContent = 'Informe o token de acesso ao CAD.'; return; }
        if (!/^TK\d+$/.test(tokenCad) && !/^\d+$/.test(tokenCad)) {
            msgEl.style.color = 'var(--p3-danger,#c0392b)';
            msgEl.textContent = 'Formato de token inválido. Use TK seguido de números (ex: TK2037113550).';
            return;
        }
        if (tokenQuimera && !/^\d{6}$/.test(tokenQuimera)) {
            msgEl.style.color = 'var(--p3-danger,#c0392b)';
            msgEl.textContent = 'O código do Quimera precisa ter 6 dígitos.';
            return;
        }

        btn.disabled = true;

        // Apps Script — mesma dupla tentativa que cad-status-banner.js já
        // fazia (uma falhar não impede a outra de rodar).
        msgEl.style.color = 'var(--p3-text-muted,#7a7a72)';
        msgEl.textContent = 'Salvando credenciais no Apps Script...';
        let statusGas;
        try {
            const dataCred = await fetchCAD('definir_credenciais_cad', { login: login, senha: senha });
            if (dataCred.ok === false) {
                statusGas = { ok: false, msg: dataCred.erro || 'Falha ao salvar CPF/senha.' };
            } else {
                msgEl.textContent = 'Validando token com o CAD (Apps Script)...';
                const dataToken = await fetchCAD('definir_token', { token: tokenCad });
                if (dataToken.ok === false) {
                    statusGas = { ok: false, msg: dataToken.erro || 'Token inválido ou expirado.' };
                } else {
                    msgEl.textContent = 'Testando login completo no Apps Script...';
                    const dataAuth = await fetchCAD('diagnostico_auth', {});
                    const trace = dataAuth && dataAuth.trace;
                    if (dataAuth.ok === false || !trace || trace.erro || !trace.sessidFinal) {
                        statusGas = { ok: false, msg: 'login completo falhou: ' + ((trace && trace.erro) || dataAuth.erro || 'sessão final não obtida') };
                    } else {
                        statusGas = { ok: true, msg: 'validado' };
                    }
                }
            }
        } catch (e) {
            statusGas = { ok: false, msg: 'erro de conexão — ' + e.message };
        }

        // Servidor local — mesma credencial vale pro atualizador-local
        // (Consulta Integrada, Denúncias Recorrentes, busca de foto).
        msgEl.textContent = 'Testando no servidor local...';
        let statusLocal;
        if (typeof P3AtualizadorLocal !== 'undefined' && await P3AtualizadorLocal.disponivel()) {
            try {
                const respLocal = await P3AtualizadorLocal.configurarCad(login, senha, tokenCad);
                statusLocal = { ok: !!respLocal.ok, msg: respLocal.ok ? 'login testado com sucesso' : (respLocal.erro || 'falhou') };
            } catch (e) {
                statusLocal = { ok: false, msg: 'erro de conexão — ' + e.message };
            }
        } else {
            statusLocal = { ok: null, msg: 'servidor local não está rodando agora' };
        }

        // Quimera — só servidor local (não existe no Apps Script), só
        // tenta se o código de 6 dígitos foi preenchido.
        let statusIdseg = null;
        if (tokenQuimera && typeof P3AtualizadorLocal !== 'undefined' && await P3AtualizadorLocal.disponivel()) {
            msgEl.textContent = 'Salvando token da 2ª fonte de foto (Quimera)...';
            try {
                const rIdseg = await P3AtualizadorLocal.idsegConfigurar(tokenQuimera, senhaQuimera);
                statusIdseg = { ok: !!rIdseg.ok, msg: rIdseg.ok ? 'ok' : (rIdseg.erro || 'falhou') };
            } catch (e) {
                statusIdseg = { ok: false, msg: 'erro de conexão — ' + e.message };
            }
        }

        const algumFuncionou = statusGas.ok || statusLocal.ok === true;
        if (algumFuncionou) {
            localStorage.setItem(TOKEN_GEO_KEY, tokenCad);
            localStorage.setItem(TOKEN_GEO_TS_KEY, Date.now().toString());
            localStorage.setItem(CAD_LOGIN_KEY, login);
        }
        document.getElementById('clm-senha').value = '';
        document.getElementById('clm-senha-quimera').value = '';

        const iconeGas = statusGas.ok ? '✅' : '❌';
        const iconeLocal = statusLocal.ok === true ? '✅' : (statusLocal.ok === false ? '❌' : '➖');
        const partes = [`Apps Script: ${iconeGas} ${statusGas.msg}`, `Servidor local: ${iconeLocal} ${statusLocal.msg}`];
        if (statusIdseg) partes.push(`Quimera: ${statusIdseg.ok ? '✅' : '❌'} ${statusIdseg.msg}`);
        const tudoQueFoiTentadoFuncionou = algumFuncionou && (!statusIdseg || statusIdseg.ok);
        msgEl.style.color = tudoQueFoiTentadoFuncionou ? '#1e6b34' : (algumFuncionou ? '#b46400' : 'var(--p3-danger,#c0392b)');
        msgEl.textContent = partes.join(' · ');
        btn.disabled = false;

        // Recarrega a página quando algo relevante funcionou — garante que
        // qualquer estado que dependia do login antigo já nasce com a
        // sessão nova, sem precisar fechar/reabrir a página manualmente.
        if (algumFuncionou) {
            setTimeout(function () {
                fechar();
                location.reload();
            }, 1800);
        }
    }

    // Indicador de status clicável, pra páginas que querem mostrar "CAD
    // configurado/não configurado" sem abrir o modal (mesmo espírito do
    // #token-banner que cad-status-banner.js injetava antes). Só um
    // indicador CLIENTE (baseado em quando você mesmo configurou o token
    // neste navegador), não confirma com o servidor a cada carga.
    function textoBadge() {
        const token = localStorage.getItem(TOKEN_GEO_KEY);
        const ts = parseInt(localStorage.getItem(TOKEN_GEO_TS_KEY) || '0');
        if (!token) return '⛔ CAD não configurado';
        const idadeMs = Date.now() - ts;
        if (idadeMs > TOKEN_TTL_MS) return '⛔ Token do CAD expirado';
        const restH = Math.floor((TOKEN_TTL_MS - idadeMs) / 3600000);
        if (idadeMs > TOKEN_TTL_MS - 2 * 3600000) return `⚠️ Token do CAD expira em ~${restH}h`;
        const horas = Math.floor(idadeMs / 3600000);
        return `✅ CAD ativo — ${horas}h de uso`;
    }

    function montarBadge(container) {
        if (!container) return;
        const badge = document.createElement('span');
        badge.className = 'clm-badge';
        badge.title = 'Clique para configurar o login do CAD/Quimera';
        badge.addEventListener('click', abrir);
        container.appendChild(badge);
        function atualizar() { garantirEstilos(); badge.textContent = textoBadge(); }
        atualizar();
        setInterval(atualizar, 60000);
    }

    global.CadLoginModal = { abrir: abrir, fechar: fechar, montarBadge: montarBadge };
})(window);
