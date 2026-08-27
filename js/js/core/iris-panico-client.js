// ====================================================================
// Sistema P3 — Cliente do "Botão do Pânico" (Sistema Íris PMAL)
// ====================================================================
// A Patrulha Maria da Penha roda num sistema à parte (Íris PMAL, MySQL
// na Hostinger, projeto próprio "Sistema PMP") — este módulo só CONSOME
// a API pública dele (iris_api.php) pra trazer os acionamentos do botão
// do pânico pra dentro do P3, sem duplicar nem alterar nada daquele
// sistema.
//
// Autenticação: reaproveita o MESMO mecanismo já usado em
// page/rastreamento-guarnicao.html — token JWT pessoal do operador
// (localStorage['irisToken']), obtido via login cruzado silencioso em
// page/login.html (mesmo CPF+senha do P3) ou autenticado manualmente
// quando não bate. Não existe nem deve existir chave de serviço fixa
// aqui no front — exigiria expor um segredo no código-fonte da página,
// visível a qualquer visitante (mesmo raciocínio já registrado nos
// comentários de rastreamento-guarnicao.html).
(function (global) {
    'use strict';
    if (global.IrisPanico) return;

    const API_URL = 'https://irispmal.io/api/iris_api.php';

    function temToken() { return !!localStorage.getItem('irisToken'); }
    function unidadeChaveAtual() { return localStorage.getItem('irisUnidadeChave') || ''; }

    async function _chamar(params) {
        const token = localStorage.getItem('irisToken');
        if (!token) return { ok: false, erro: 'sem-token' };
        try {
            const url = API_URL + '?' + new URLSearchParams(params).toString();
            const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
            if (res.status === 401) { localStorage.removeItem('irisToken'); return { ok: false, erro: 'token-expirado' }; }
            const data = await res.json().catch(() => null);
            return data || { ok: false, erro: 'resposta-invalida' };
        } catch (e) {
            return { ok: false, erro: 'falha-rede' };
        }
    }

    // Login manual (mesmo endpoint que login.html usa pro login cruzado
    // silencioso) — usado quando a senha do P3 não bate no Íris e o
    // operador precisa autenticar separadamente nesta tela.
    async function autenticar(cpf, senha) {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ acao: 'login_mysql', cpf, senha }),
        });
        const data = await res.json().catch(() => null);
        if (data && data.ok && data.token) {
            localStorage.setItem('irisToken', data.token);
            localStorage.setItem('irisUnidadeChave', data.unidade || '');
        }
        return data || { ok: false, erro: 'resposta-invalida' };
    }

    // Acionamentos do botão do pânico — SEMPRE só da unidade do operador
    // logado (localStorage['irisUnidadeChave'], gravado no login). O
    // token sozinho não garante isso: se o perfil do operador no Íris
    // for ADM, o back-end (iris_api.php, ação "listar") não aplica NENHUM
    // filtro de unidade por padrão, e devolveria acionamentos de todos
    // os batalhões. Por isso passa unidade_chave explicitamente aqui —
    // esse filtro é aplicado incondicionalmente pelo back-end, mesmo pra
    // ADM (ver $filtros_por_tabela['tbl_acionamentos'] em iris_api.php).
    async function listarAcionamentos(limite) {
        const unidadeChave = unidadeChaveAtual();
        if (!unidadeChave) throw new Error('Unidade do Íris não identificada (faça login novamente).');
        const resp = await _chamar({
            acao: 'listar', tabela: 'acionamentos', ordem: 'DESC',
            limite: limite || 300, unidade_chave: unidadeChave,
        });
        if (!resp.ok) throw new Error(resp.erro || 'Falha ao consultar acionamentos no Íris.');
        return resp.registros || [];
    }

    global.IrisPanico = {
        API_URL,
        temToken,
        unidadeChaveAtual,
        autenticar,
        listarAcionamentos,
    };
})(window);
