// ====================================================================
// Sistema P3 — banner + modal de status do login no CAD (CPF+senha+token)
// ====================================================================
// Extraído do mecanismo já usado em page/preditivaCAD.html pra poder ser
// reaproveitado em outras páginas (ex.: page/autores.html, que busca
// fotos no CAD/Alcatraz e precisa da MESMA sessão) sem duplicar a lógica.
//
// Usa as MESMAS chaves de localStorage que preditivaCAD.js e
// rastreamento-guarnicao.html — configurar em qualquer uma dessas
// páginas já deixa o status certo aqui também, é a mesma sessão do CAD
// guardada no mesmo projeto Apps Script (Script Properties).
//
// A página que incluir este arquivo precisa ter no HTML:
//   - #token-banner / #token-banner-texto (span com o texto do status)
//   - #modal-token com #input-cad-login / #input-cad-senha /
//     #input-token-geo / #msg-token-geo
//   - o CSS de .token-banner/.token-ok/.token-warn/.token-err/#modal-token
//     (ver page/preditivaCAD.html ou page/autores.html pra copiar)

(function () {
    const GAS_CAD_URL = 'https://script.google.com/macros/s/AKfycbwuyKpN4AbmV_CmQfZr2olClY1JveArwKEcJE3__DFf74xfnd3AlhXqnde7RPkXDlqx/exec';

    const TOKEN_GEO_KEY    = 'geo_cookie_p3';
    const TOKEN_GEO_TS_KEY = 'geo_cookie_ts_p3';
    const TOKEN_TTL_MS     = 23 * 60 * 60 * 1000; // 23h — mesma janela usada em preditivaCAD.js
    const CAD_LOGIN_KEY    = 'cad_login_p3';

    async function fetchCAD(acao, params) {
        const qs = new URLSearchParams(Object.assign({ acao: acao }, params || {})).toString();
        const resp = await fetch(GAS_CAD_URL + '?' + qs, { redirect: 'follow' });
        const texto = await resp.text();
        let data;
        try { data = JSON.parse(texto); }
        catch (e) { throw new Error('Resposta do Apps Script não é JSON válido: ' + texto.substring(0, 200)); }
        return data;
    }

    // Só um indicador CLIENTE (baseado em quando você mesmo configurou o
    // token neste navegador) — não confirma com o servidor a cada carga
    // de página. Suficiente pra avisar "token velho, capaz de já ter
    // expirado" sem gastar uma chamada extra ao Apps Script só pra isso.
    function verificarTokenGEO() {
        const banner = document.getElementById('token-banner');
        const texto = document.getElementById('token-banner-texto');
        if (!banner || !texto) return false;

        const token = localStorage.getItem(TOKEN_GEO_KEY);
        const ts = parseInt(localStorage.getItem(TOKEN_GEO_TS_KEY) || '0');
        banner.style.display = '';

        if (!token) {
            banner.className = 'token-banner token-err';
            texto.textContent = '⛔ Token não configurado — a busca de fotos no CAD não vai funcionar';
            return false;
        }
        const idadeMs = Date.now() - ts;
        if (idadeMs > TOKEN_TTL_MS) {
            banner.className = 'token-banner token-err';
            texto.textContent = '⛔ Token expirado — renove agora para continuar';
            return false;
        }
        const horas = Math.floor(idadeMs / 3600000);
        const mins = Math.floor((idadeMs % 3600000) / 60000);
        const restH = Math.floor((TOKEN_TTL_MS - idadeMs) / 3600000);
        if (idadeMs > TOKEN_TTL_MS - 2 * 3600000) {
            banner.className = 'token-banner token-warn';
            texto.textContent = '⚠️ Token expira em ~' + restH + 'h — renove em breve';
        } else {
            banner.className = 'token-banner token-ok';
            texto.textContent = '✅ Token ativo — ' + horas + 'h' + mins + 'min de uso';
        }
        return true;
    }

    function inicializarTokenGEO() {
        verificarTokenGEO();
        setInterval(verificarTokenGEO, 60000);
    }

    window.abrirModalToken = function () {
        document.getElementById('modal-token').classList.add('aberto');
        document.getElementById('input-token-geo').value = localStorage.getItem(TOKEN_GEO_KEY) || '';
        document.getElementById('input-cad-login').value = localStorage.getItem(CAD_LOGIN_KEY) || '';
        document.getElementById('input-cad-senha').value = '';
        document.getElementById('msg-token-geo').textContent = '';
    };
    window.fecharModalToken = function () {
        document.getElementById('modal-token').classList.remove('aberto');
    };

    window.salvarTokenGEO = async function () {
        const token = document.getElementById('input-token-geo').value.trim().toUpperCase();
        const login = document.getElementById('input-cad-login').value.trim();
        const senha = document.getElementById('input-cad-senha').value;
        const msgEl = document.getElementById('msg-token-geo');

        if (!login || login.length < 11) { msgEl.style.color = '#b40000'; msgEl.textContent = 'Informe o CPF de acesso ao CAD (11 dígitos).'; return; }
        if (!senha) { msgEl.style.color = '#b40000'; msgEl.textContent = 'Informe a senha de acesso ao CAD.'; return; }
        if (!token) { msgEl.style.color = '#b40000'; msgEl.textContent = 'Informe o token de acesso.'; return; }
        if (!/^TK\d+$/.test(token) && !/^\d+$/.test(token)) {
            msgEl.style.color = '#b40000';
            msgEl.textContent = 'Formato de token inválido. Use TK seguido de números (ex: TK2037113550).';
            return;
        }

        msgEl.style.color = '#555';
        msgEl.textContent = 'Salvando credenciais no Apps Script...';

        try {
            const dataCred = await fetchCAD('definir_credenciais_cad', { login: login, senha: senha });
            if (dataCred.ok === false) {
                msgEl.style.color = '#b40000';
                msgEl.textContent = '❌ ' + (dataCred.erro || 'Falha ao salvar CPF/senha.');
                return;
            }

            msgEl.textContent = 'Validando token com o CAD...';
            const dataToken = await fetchCAD('definir_token', { token: token });
            if (dataToken.ok === false) {
                msgEl.style.color = '#b40000';
                msgEl.textContent = '❌ ' + (dataToken.erro || 'Token inválido ou expirado.');
                return;
            }

            msgEl.textContent = 'Testando login completo (CPF+senha+token) no CAD — pode levar alguns segundos...';
            const dataAuth = await fetchCAD('diagnostico_auth', {});
            const trace = dataAuth && dataAuth.trace;
            if (dataAuth.ok === false || !trace || trace.erro || !trace.sessidFinal) {
                msgEl.style.color = '#b40000';
                msgEl.textContent = '❌ Login completo falhou: ' + ((trace && trace.erro) || dataAuth.erro || 'sessão final não obtida');
                return;
            }
        } catch (e) {
            msgEl.style.color = '#b40000';
            msgEl.textContent = '❌ Erro de conexão com o Apps Script: ' + e.message;
            return;
        }

        // NOVO — a MESMA credencial (o token muda todo dia, por isso este
        // modal já existia) também vale pro servidor local
        // (tools/atualizador-local/), que hoje faz a busca de foto do
        // Alcatraz sem depender do Apps Script (ver js/cad-busca-foto.js)
        // — salvar aqui evita ter que editar o .env dele toda vez que o
        // token expira. Best-effort: se o servidor local não estiver
        // aberto agora, só avisa — não bloqueia o sucesso do Apps Script
        // (a pessoa pode simplesmente não estar usando ele hoje).
        let statusLocal = ' (servidor local: não está rodando agora — abra tools/atualizador-local/app.py se for usar a busca de fotos por lá)';
        if (typeof P3AtualizadorLocal !== 'undefined' && await P3AtualizadorLocal.disponivel()) {
            try {
                const respLocal = await P3AtualizadorLocal.configurarCad(login, senha, token);
                statusLocal = respLocal.ok
                    ? ' (servidor local: ✅ login testado com sucesso)'
                    : ' (servidor local: ❌ ' + (respLocal.erro || 'falhou') + ')';
            } catch (e) {
                statusLocal = ' (servidor local: ❌ erro de conexão — ' + e.message + ')';
            }
        }

        localStorage.setItem(TOKEN_GEO_KEY, token);
        localStorage.setItem(TOKEN_GEO_TS_KEY, Date.now().toString());
        localStorage.setItem(CAD_LOGIN_KEY, login);
        document.getElementById('input-cad-senha').value = '';
        msgEl.style.color = '#006432';
        msgEl.textContent = '✅ Login completo validado!' + statusLocal;

        setTimeout(function () {
            fecharModalToken();
            verificarTokenGEO();
        }, 2200);
    };

    document.addEventListener('DOMContentLoaded', inicializarTokenGEO);
})();
