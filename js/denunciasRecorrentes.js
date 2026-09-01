// ====================================================================
// Sistema P3 — Denúncias Recorrentes (page/denunciasRecorrentes.html)
// ====================================================================
// 31/08/2026, pedido explícito do usuário: "estive pensando na parte de
// denúncias, para que ele faça um cruzamento de quantas denuncias estão
// se repetindo para o mesmo local e alvo". Consome
// P3AtualizadorLocal.denunciasRecorrentes() (ver js/core/atualizador-local.js
// e a rota /supabase/denuncias-recorrentes em tools/atualizador-local/app.py),
// que por sua vez chama supabase_intel.buscar_denuncias_recorrentes —
// correspondência por texto (não existe elo direto pessoa↔endereço
// catalogado no schema de origem, ver comentário grande na função Python).
(function () {
    'use strict';

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function formatarCpf(cpf) {
        const d = String(cpf || '').replace(/\D/g, '');
        if (d.length !== 11) return cpf || '—';
        return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    }

    function formatarData(dataIso) {
        if (!dataIso) return '—';
        try { return new Date(dataIso + 'T00:00:00').toLocaleDateString('pt-BR'); }
        catch (e) { return dataIso; }
    }

    function montarLinhaDetalhe(par, colspan) {
        const tr = document.createElement('tr');
        tr.className = 'dr-detalhe';
        const td = document.createElement('td');
        td.colSpan = colspan;
        const itens = par.denuncias.map(function (d) {
            return `<div class="dr-detalhe-item"><span><b>${esc(d.tipo || 'Denúncia')}</b></span><span>${esc(formatarData(d.dataDenuncia))}</span></div>`;
        }).join('');
        td.innerHTML = `<div class="dr-detalhe-conteudo">
            <div class="dr-correspondencia">Correspondência por: "${esc(par.correspondenciaPor || par.nome)}"</div>
            ${itens}
        </div>`;
        tr.appendChild(td);
        return tr;
    }

    function renderizar(pares) {
        const corpo = document.getElementById('dr-corpo-tabela');
        const resumo = document.getElementById('dr-resumo');
        corpo.innerHTML = '';

        if (!pares || !pares.length) {
            resumo.textContent = 'Nenhum par de local + alvo recorrente encontrado com esse filtro.';
            corpo.innerHTML = '<tr><td colspan="4" class="dr-vazio">Nada a exibir.</td></tr>';
            return;
        }

        resumo.textContent = `${pares.length} par${pares.length === 1 ? '' : 'es'} de local + alvo com denúncias recorrentes.`;

        pares.forEach(function (par) {
            const linha = document.createElement('tr');
            linha.className = 'dr-linha-par';
            linha.innerHTML = `
                <td>${esc(par.endereco)}</td>
                <td>${esc(par.nome)}</td>
                <td>${esc(formatarCpf(par.cpf))}</td>
                <td><span class="dr-badge">${par.totalDenuncias}</span></td>
            `;
            let linhaDetalhe = null;
            linha.addEventListener('click', function () {
                if (linhaDetalhe) {
                    linhaDetalhe.remove();
                    linhaDetalhe = null;
                    return;
                }
                linhaDetalhe = montarLinhaDetalhe(par, 4);
                linha.after(linhaDetalhe);
            });
            corpo.appendChild(linha);
        });
    }

    async function buscar() {
        const btn = document.getElementById('dr-btn-buscar');
        const avisoServidor = document.getElementById('dr-aviso-servidor');
        const resumo = document.getElementById('dr-resumo');
        const corpo = document.getElementById('dr-corpo-tabela');
        const min = Math.max(2, parseInt(document.getElementById('dr-min').value, 10) || 2);

        btn.disabled = true;
        resumo.textContent = '';
        corpo.innerHTML = '<tr><td colspan="4" class="dr-vazio">Buscando…</td></tr>';

        if (!(await P3AtualizadorLocal.disponivel())) {
            avisoServidor.style.display = 'block';
            corpo.innerHTML = '';
            btn.disabled = false;
            return;
        }
        avisoServidor.style.display = 'none';

        try {
            const resultado = await P3AtualizadorLocal.denunciasRecorrentes(min);
            if (!resultado.ok) {
                corpo.innerHTML = `<tr><td colspan="4" class="dr-erro">${esc(resultado.erro || 'Não foi possível buscar as denúncias recorrentes.')}</td></tr>`;
                return;
            }
            renderizar(resultado.pares);
        } catch (e) {
            corpo.innerHTML = `<tr><td colspan="4" class="dr-erro">Erro ao buscar: ${esc(e.message)}</td></tr>`;
        } finally {
            btn.disabled = false;
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        if (!P3.requireAuth()) return;
        document.getElementById('dr-btn-buscar').addEventListener('click', buscar);
        buscar();
    });
})();
