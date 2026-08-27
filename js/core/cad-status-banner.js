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

        // ── Apps Script — CORRIGIDO (26/08/2026, achado testando o app
        // desktop numa 2ª máquina): antes, uma falha aqui interrompia a
        // função com `return` e o trecho "NOVO" mais abaixo (salvar no
        // servidor local) NUNCA chegava a rodar — mesmo com o servidor
        // local aberto e funcionando perfeitamente. Agora as duas
        // tentativas (Apps Script e servidor local) SEMPRE rodam as
        // duas, cada uma guarda seu próprio resultado, e o texto final
        // mostra as duas linhas — uma falhar não derruba a outra.
        msgEl.style.color = '#555';
        msgEl.textContent = 'Salvando credenciais no Apps Script...';
        let statusGas;
        try {
            const dataCred = await fetchCAD('definir_credenciais_cad', { login: login, senha: senha });
            if (dataCred.ok === false) {
                statusGas = { ok: false, msg: dataCred.erro || 'Falha ao salvar CPF/senha.' };
            } else {
                msgEl.textContent = 'Validando token com o CAD (Apps Script)...';
                const dataToken = await fetchCAD('definir_token', { token: token });
                if (dataToken.ok === false) {
                    statusGas = { ok: false, msg: dataToken.erro || 'Token inválido ou expirado.' };
                } else {
                    msgEl.textContent = 'Testando login completo no Apps Script — pode levar alguns segundos...';
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

        // ── Servidor local — a MESMA credencial (o token muda todo dia,
        // por isso este modal já existia) também vale pro servidor
        // local (tools/atualizador-local/), que hoje faz a busca de foto
        // do Alcatraz sem depender do Apps Script (ver
        // js/cad-busca-foto.js). SEMPRE tentado, independente do
        // resultado do Apps Script acima.
        msgEl.textContent = 'Testando no servidor local...';
        let statusLocal;
        if (typeof P3AtualizadorLocal !== 'undefined' && await P3AtualizadorLocal.disponivel()) {
            try {
                const respLocal = await P3AtualizadorLocal.configurarCad(login, senha, token);
                statusLocal = { ok: !!respLocal.ok, msg: respLocal.ok ? 'login testado com sucesso' : (respLocal.erro || 'falhou') };
            } catch (e) {
                statusLocal = { ok: false, msg: 'erro de conexão — ' + e.message };
            }
        } else {
            // null = "nem tentado" (servidor fechado/indisponível agora),
            // diferente de false ("tentou e falhou") — ver ➖ no ícone abaixo.
            statusLocal = { ok: null, msg: 'servidor local não está rodando agora' };
        }

        // Guarda o login/token no navegador (banner de status) se PELO
        // MENOS UM dos dois funcionou — continuam válidos mesmo que só
        // um lado tenha aceitado.
        const algumFuncionou = statusGas.ok || statusLocal.ok === true;
        if (algumFuncionou) {
            localStorage.setItem(TOKEN_GEO_KEY, token);
            localStorage.setItem(TOKEN_GEO_TS_KEY, Date.now().toString());
            localStorage.setItem(CAD_LOGIN_KEY, login);
        }
        document.getElementById('input-cad-senha').value = '';

        const iconeGas = statusGas.ok ? '✅' : '❌';
        const iconeLocal = statusLocal.ok === true ? '✅' : (statusLocal.ok === false ? '❌' : '➖');
        msgEl.style.color = algumFuncionou ? '#006432' : '#b40000';
        msgEl.textContent = `Apps Script: ${iconeGas} ${statusGas.msg} | Servidor local: ${iconeLocal} ${statusLocal.msg}`;

        // Só fecha sozinho se pelo menos um dos dois funcionou — se os
        // DOIS falharam, deixa o modal aberto com o erro visível em vez
        // de fechar e esconder o motivo.
        if (algumFuncionou) {
            setTimeout(function () {
                fecharModalToken();
                verificarTokenGEO();
            }, 3500);
        }
    };

    document.addEventListener('DOMContentLoaded', inicializarTokenGEO);
})();
