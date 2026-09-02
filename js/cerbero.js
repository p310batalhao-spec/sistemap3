// ====================================================================
// Sistema P3 — Cérbero (base de inteligência PM-AL, cerimonial.pm.al.gov.br)
// ====================================================================
// 02/09/2026, pedido explícito do usuário — aba nova ao lado de
// Suspeitos, sob controle da P2. Lê pessoas/endereços DIRETO da
// Hostinger (hostinger-api/cerbero.php, leitura aberta — mesmo padrão
// de alvos_denuncia.php) pra funcionar mesmo sem o atualizador-local
// aberto; só a IMPORTAÇÃO de uma captura .har nova precisa do servidor
// local rodando (é ele quem lê o arquivo do disco e faz o parse — ver
// tools/atualizador-local/cerbero_har.py).
(function () {
    'use strict';

    let cfgUnidade = null;
    let pessoas = [];
    let enderecos = [];
    let carregado = false;

    function normalizar(s) {
        return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    }

    function formatarDataBr(iso) {
        if (!iso) return '---';
        const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
    }

    function escaparHtml(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function renderizarPessoas() {
        const filtro = normalizar(document.getElementById('cerbero-filtro-pessoas').value.trim());
        const corpo = document.getElementById('cerbero-corpo-pessoas');
        const baseFotos = (cfgUnidade && cfgUnidade.apiPhp && cfgUnidade.apiPhp.fotosCerberoBaseUrl) || '';
        const lista = filtro
            ? pessoas.filter(p => normalizar(p.nome).includes(filtro) || normalizar(p.vulgos).includes(filtro) ||
                                    normalizar(p.cpf).includes(filtro))
            : pessoas;

        corpo.innerHTML = lista.map(p => {
            const foto = p.fotoArquivo
                ? `<img src="${escaparHtml(baseFotos + p.fotoArquivo)}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:4px;">`
                : '—';
            return `<tr>
                <td>${foto}</td>
                <td>${escaparHtml(p.nome || '---')}</td>
                <td>${escaparHtml(p.vulgos || '---')}</td>
                <td>${escaparHtml(p.cpf || '---')}</td>
                <td>${escaparHtml(p.filiacao1 || '---')}</td>
                <td>${formatarDataBr(p.nascimento)}</td>
                <td>${escaparHtml(p.sexo || '---')}</td>
                <td>${escaparHtml(p.situacao || '---')}</td>
                <td>${escaparHtml(p.faccao || '---')}</td>
            </tr>`;
        }).join('') || '<tr><td colspan="9" style="text-align:center;opacity:.6;">Nenhuma pessoa importada ainda.</td></tr>';
    }

    function renderizarEnderecos() {
        const filtro = normalizar(document.getElementById('cerbero-filtro-enderecos').value.trim());
        const corpo = document.getElementById('cerbero-corpo-enderecos');
        const lista = filtro ? enderecos.filter(e => normalizar(e.endereco).includes(filtro)) : enderecos;
        corpo.innerHTML = lista.map(e => `<tr><td>${escaparHtml(e.endereco || '---')}</td></tr>`).join('')
            || '<tr><td style="text-align:center;opacity:.6;">Nenhum endereço importado ainda.</td></tr>';
    }

    async function carregarDados(forcar) {
        if (carregado && !forcar) return;
        const statusEl = document.getElementById('cerbero-status-msg');
        try {
            if (!cfgUnidade) cfgUnidade = await P3.loadUnidadeConfig();
            const url = cfgUnidade.apiPhp.cerberoUrl;
            const [respPessoas, respEnderecos] = await Promise.all([
                fetch(`${url}?action=listar_pessoas`).then(r => r.json()),
                fetch(`${url}?action=listar_enderecos`).then(r => r.json()),
            ]);
            pessoas = Array.isArray(respPessoas) ? respPessoas : [];
            enderecos = Array.isArray(respEnderecos) ? respEnderecos : [];
            carregado = true;
            renderizarPessoas();
            renderizarEnderecos();
            if (statusEl) statusEl.textContent = `${pessoas.length} pessoa(s), ${enderecos.length} endereço(s) carregado(s).`;
        } catch (e) {
            console.error('[cerbero] Erro ao carregar dados:', e);
            if (statusEl) statusEl.textContent = '⚠️ Erro ao carregar dados da Hostinger: ' + e.message;
        }
    }

    async function importar() {
        const input = document.getElementById('cerbero-input-har');
        const btn = document.getElementById('cerbero-btn-importar');
        const statusEl = document.getElementById('cerbero-status-msg');
        const wrap = document.getElementById('cerbero-progresso-wrap');
        const fill = document.getElementById('cerbero-progresso-fill');
        const texto = document.getElementById('cerbero-progresso-texto');
        const arquivo = input.files && input.files[0];
        if (!arquivo) return;

        if (typeof P3AtualizadorLocal === 'undefined' || !(await P3AtualizadorLocal.disponivel())) {
            alert('O atualizador local precisa estar aberto pra importar uma captura (é ele quem lê o arquivo e envia pra Hostinger). Abra o Sistema P3 (app desktop) ou rode "python app.py" e tente de novo.');
            return;
        }
        if (!confirm(`Importar "${arquivo.name}" (${(arquivo.size / 1024 / 1024).toFixed(1)}MB) pro Cérbero? Isso pode levar alguns minutos (fotos são enviadas uma a uma).`)) return;

        btn.disabled = true;
        input.disabled = true;
        wrap.style.display = 'block';
        fill.style.width = '0%';
        let etapas = 0;
        try {
            const resultado = await P3AtualizadorLocal.importarHarCerbero(arquivo, function (evt) {
                etapas++;
                texto.textContent = evt.mensagem || '';
                // Sem total conhecido de antemão (parse decide isso) — barra
                // "indeterminada" simples, só avança visualmente a cada evento.
                fill.style.width = Math.min(95, etapas * 4) + '%';
            });
            fill.style.width = '100%';
            const resumo = `Pessoas: ${resultado.pessoas} (${resultado.pessoasGravadas} gravada(s)) · ` +
                `Endereços: ${resultado.enderecos} (${resultado.enderecosGravados} gravado(s)) · ` +
                `Fotos: ${resultado.fotosEnviadas} enviada(s), ${resultado.fotosJaExistentes} já existente(s)` +
                (resultado.fotosComErro ? `, ${resultado.fotosComErro} com erro` : '');
            statusEl.textContent = '✅ ' + resumo;
            alert('Importação do Cérbero concluída!\n\n' + resumo);
            input.value = '';
            await carregarDados(true);
        } catch (e) {
            console.error('[cerbero] Erro na importação:', e);
            statusEl.textContent = '⚠️ Erro: ' + e.message;
            alert('Erro ao importar a captura do Cérbero: ' + e.message);
        } finally {
            btn.disabled = false;
            input.disabled = false;
            setTimeout(() => { wrap.style.display = 'none'; }, 1500);
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        // Sob controle da P2 — pedido explícito do usuário: aba (e o
        // recurso todo) só aparece pra sessão p2/admin, mesmo critério já
        // usado pra fonte 7/8 de notificações (autor/suspeito) em
        // js/core/notificacoes.js.
        const sessao = (window.P3 && window.P3.getSession) ? window.P3.getSession() : null;
        const autorizado = !!sessao && (sessao.nivel === 'p2' || sessao.nivel === 'admin');
        const btnAba = document.getElementById('aba-btn-cerbero');
        if (!btnAba) return;
        if (!autorizado) return; // fica escondida (display:none já é o padrão no HTML)
        btnAba.style.display = '';

        document.getElementById('cerbero-input-har').addEventListener('change', function (e) {
            document.getElementById('cerbero-btn-importar').disabled = !(e.target.files && e.target.files.length);
        });
        document.getElementById('cerbero-btn-importar').addEventListener('click', importar);
        document.getElementById('cerbero-filtro-pessoas').addEventListener('input', renderizarPessoas);
        document.getElementById('cerbero-filtro-enderecos').addEventListener('input', renderizarEnderecos);
    });

    window.P3Cerbero = {
        carregarSeNecessario: function () { carregarDados(false); },
    };
})();
