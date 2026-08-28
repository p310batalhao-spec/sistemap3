// ====================================================================
// Sistema P3 — Cliente do Atualizador local (Python)
// ====================================================================
// Fala com o servidor Python que roda no PC de quem clicou (ver
// tools/atualizador-local/) — substitui, sob demanda (só quando
// clicado), o robô agendado do Apps Script pra:
//   1) Movimentação de processos (Autores/Suspeitos) — js/autores.js
//      (verificarAgora) e js/suspeitos.js (verificarAgoraSuspeitos).
//   2) Busca de foto no CAD/SERIS (Alcatraz) — js/cad-busca-foto.js.
//
// Servidor precisa estar rodando (python tools/atualizador-local/app.py)
// — se não estiver, disponivel() devolve false e quem chama decide o
// que fazer (cad-busca-foto.js cai de volta pro Apps Script; os botões
// de "Verificar agora" avisam o usuário pra abrir o servidor).
(function (global) {
    'use strict';
    if (global.P3AtualizadorLocal) return;

    const URL_BASE = 'http://localhost:5057';
    const TIMEOUT_HEALTH_MS = 2000;

    async function disponivel() {
        try {
            const controlador = new AbortController();
            const timer = setTimeout(() => controlador.abort(), TIMEOUT_HEALTH_MS);
            const resp = await fetch(`${URL_BASE}/health`, { signal: controlador.signal });
            clearTimeout(timer);
            return resp.ok;
        } catch (e) {
            return false;
        }
    }

    // Lê um corpo NDJSON (1 objeto JSON por linha) conforme os bytes vão
    // chegando, chamando onLinha(obj) pra cada linha completa — é assim
    // que /movimentacoes/atualizar manda progresso item a item sem
    // esperar o processo inteiro terminar pra responder.
    async function lerStreamNdjson(resp, onLinha) {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let idx;
            while ((idx = buffer.indexOf('\n')) !== -1) {
                const linha = buffer.slice(0, idx).trim();
                buffer = buffer.slice(idx + 1);
                if (!linha) continue;
                let obj;
                try { obj = JSON.parse(linha); }
                catch (e) { console.warn('[atualizador-local] linha NDJSON inválida:', linha); continue; }
                onLinha(obj);
            }
        }
        const resto = buffer.trim();
        if (resto) {
            try { onLinha(JSON.parse(resto)); } catch (e) { /* ignora resto incompleto */ }
        }
    }

    // tipo: 'autores' | 'suspeitos' | 'ambos'. onProgresso(obj) é chamado
    // pra cada evento {tipo:'inicio'|'progresso'|'aviso'|'fim_fonte', ...}
    // — ver tools/atualizador-local/sync_movimentacoes.py pro formato
    // exato de cada um. Lança erro se o servidor não estiver disponível,
    // responder com erro HTTP, ou mandar um evento {tipo:'erro_fatal'}.
    async function atualizarMovimentacoes(tipo, onProgresso) {
        const resp = await fetch(`${URL_BASE}/movimentacoes/atualizar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tipo: tipo, forcar: true }),
        });
        if (!resp.ok) {
            let detalhe = '';
            try { detalhe = (await resp.json()).erro || ''; } catch (e) { /* corpo não era JSON */ }
            throw new Error(detalhe || `Atualizador local respondeu HTTP ${resp.status}`);
        }

        let resumoFinal = null;
        let erroFatal = null;
        await lerStreamNdjson(resp, function (obj) {
            if (obj.tipo === 'fim') resumoFinal = obj.resumo;
            else if (obj.tipo === 'erro_fatal') erroFatal = obj.mensagem;
            else if (onProgresso) onProgresso(obj);
        });
        if (erroFatal) throw new Error(erroFatal);
        return resumoFinal;
    }

    // Mesmo contrato de retorno que o Apps Script (buscarFotoPessoaCAD)
    // já tinha: {ok, encontrado, pessoa, fotos:[...], erro?}.
    async function buscarFotoAlcatraz(cpfLimpo) {
        const resp = await fetch(`${URL_BASE}/alcatraz/buscar-foto?cpf=${cpfLimpo}`);
        return resp.json();
    }

    // {ok, configurado, login} — usado pra saber se já tem credenciais
    // salvas no servidor local (ver js/core/cad-status-banner.js).
    async function statusCad() {
        const resp = await fetch(`${URL_BASE}/cad/status`);
        return resp.json();
    }

    // Salva login/senha/token do CAD no servidor local (persistido em
    // cad_config.json — ver tools/atualizador-local/cad_config_store.py)
    // e já testa o login completo na hora, mesmo espírito do
    // "diagnostico_auth" que o modal já fazia contra o Apps Script.
    // {ok, testado, erro?}.
    async function configurarCad(login, senha, token) {
        const resp = await fetch(`${URL_BASE}/cad/configurar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ login: login, senha: senha, token: token }),
        });
        return resp.json();
    }

    // Consulta Integrada de Pessoas (page/consulta-pessoa.html) — ver
    // rotas /pessoa/consultar e /pessoa/ocorrencia-detalhe em
    // tools/atualizador-local/app.py. Timeout mais alto que os demais
    // (TIMEOUT_HEALTH_MS é só pro /health) porque a consulta bate em
    // várias fontes do CAD em sequência (ver comentário em
    // consulta_pessoa_service.py sobre por que não é paralelo) — pode
    // legitimamente levar bem mais que 2s.
    async function consultarPessoa(cpfLimpo) {
        const resp = await fetch(`${URL_BASE}/pessoa/consultar?cpf=${encodeURIComponent(cpfLimpo)}`);
        return resp.json();
    }

    // params: {tipo:'ppe', id, hash} | {tipo:'pc_antigo', numeroBo} | {tipo:'despacho', idOcor}
    async function ocorrenciaDetalhe(params) {
        const qs = new URLSearchParams(params).toString();
        const resp = await fetch(`${URL_BASE}/pessoa/ocorrencia-detalhe?${qs}`);
        return resp.json();
    }

    global.P3AtualizadorLocal = {
        URL_BASE: URL_BASE,
        disponivel: disponivel,
        atualizarMovimentacoes: atualizarMovimentacoes,
        buscarFotoAlcatraz: buscarFotoAlcatraz,
        statusCad: statusCad,
        configurarCad: configurarCad,
        consultarPessoa: consultarPessoa,
        ocorrenciaDetalhe: ocorrenciaDetalhe,
    };
})(window);
