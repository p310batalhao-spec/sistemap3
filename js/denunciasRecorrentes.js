// ====================================================================
// Sistema P3 — Denúncias Recorrentes (page/denunciasRecorrentes.html)
// ====================================================================
// 01/09/2026, redesenho a pedido explícito do usuário: agrupar por
// endereço semelhante, extrair candidatos a alvo do texto, cruzar contra
// Supabase/Autores e, pros confirmados, rodar a busca completa da
// Consulta Integrada (CAD+TJAL+BNMP), salvando na Hostinger — ver
// tools/atualizador-local/alvos_denuncia.py e as rotas
// /supabase/denuncias-recorrentes/salvos (leitura) e
// /supabase/denuncias-recorrentes/varredura (dispara o pipeline,
// streaming NDJSON) em tools/atualizador-local/app.py.
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

    function formatarDataHora(iso) {
        if (!iso) return '—';
        try { return new Date(iso.replace(' ', 'T')).toLocaleString('pt-BR'); }
        catch (e) { return iso; }
    }

    function rotuloOrigem(origemMatch) {
        if (origemMatch === 'autores') return 'Autores (Hostinger)';
        if (origemMatch === 'texto_cpf') return 'CPF citado no texto';
        return 'Supabase';
    }

    // "🔍 Detalhes" — 01/09/2026, pedido explícito do usuário: "ao clicar
    // em detalhes virá todo o cruzamento CAD/IDNET, SUPABASE detalhado
    // como uma ficha do alvo, semelhante à impressão da consulta
    // detalhada" — depois ajustado pra abrir em MODAL em vez de aba nova
    // ("eu quero que abra em um modal"). O `resultado` salvo aqui é o
    // MESMO objeto completo que consultar_pessoa_stream produz (CAD,
    // IDNET, ocorrências, processos, inteligência do Supabase — tudo já
    // salvo na varredura, nada precisou ser salvo "a mais"). Reaproveita
    // 100% a renderização e a impressão já existentes em
    // page/consulta-pessoa.html: o modal é só um iframe dela, e o
    // resultado viaja por sessionStorage (grande demais pra URL) — como
    // o iframe é MESMA ORIGEM/MESMA ABA, ele enxerga o mesmo
    // sessionStorage do documento pai (ver handoff em
    // js/consulta-pessoa.js), sem precisar de postMessage.
    function abrirFichaCompleta(alvo) {
        if (!alvo.resultado) {
            alert('Esta varredura ainda não tem o resultado completo salvo — rode "Rodar nova varredura" de novo.');
            return;
        }
        try {
            sessionStorage.setItem('p3_cip_resultado_salvo_handoff', JSON.stringify(alvo.resultado));
        } catch (e) {
            alert('Não foi possível preparar a ficha (resultado grande demais pro navegador): ' + e.message);
            return;
        }
        document.getElementById('dr-modal-ficha-iframe').src = 'consulta-pessoa.html?abrirResultadoSalvo=1';
        document.getElementById('dr-modal-ficha').classList.add('aberto');
    }

    function fecharModalFicha() {
        document.getElementById('dr-modal-ficha').classList.remove('aberto');
        // Reseta o iframe (não só esconde) — evita que a ficha antiga
        // ainda esteja carregada em memória na próxima abertura e garante
        // que o boot de consulta-pessoa.js roda de novo do zero sempre.
        document.getElementById('dr-modal-ficha-iframe').src = 'about:blank';
    }

    function montarLinhaDetalhe(alvo, colspan) {
        const r = alvo.resultado || {};
        const pessoa = r.pessoa || {};
        const inteligencia = r.inteligencia || {};
        const itens = [
            ['Nome (CAD)', pessoa.nome || '—'],
            ['Mãe', pessoa.mae || '—'],
            ['Nascimento', pessoa.dataNascimento || '—'],
            ['Correspondência por', alvo.correspondenciaPor || '—'],
            ['Endereços (IDNET)', (r.idnet || []).length],
            ['Ocorrências (PPE)', (r.ocorrenciasPpe || []).length],
            ['Registros anteriores', (r.ocorrenciasPcAntigo || []).length],
            ['Mandados', r.mandados ? 'Sim — ver Consulta Integrada' : 'Não'],
            ['Processos (e-SAJ)', (r.processos || []).length],
            ['Vínculos/ORCRIM (Supabase)', (inteligencia.orcrim || []).length],
        ];
        const tr = document.createElement('tr');
        tr.className = 'dr-detalhe';
        const td = document.createElement('td');
        td.colSpan = colspan;
        td.innerHTML = `<div class="dr-detalhe-conteudo">
            ${itens.map(([label, valor]) => `<div class="dr-detalhe-item"><span>${esc(label)}</span><span>${esc(valor)}</span></div>`).join('')}
            <div class="dr-detalhe-item"><span>Ficha completa</span><span>clique em "🔍 Detalhes" nessa linha pra ver o cruzamento CAD/IDNET/Supabase inteiro</span></div>
        </div>`;
        tr.appendChild(td);
        return tr;
    }

    function renderizar(alvos) {
        const corpo = document.getElementById('dr-corpo-tabela');
        const resumo = document.getElementById('dr-resumo');
        corpo.innerHTML = '';

        if (!alvos || !alvos.length) {
            resumo.textContent = 'Nenhum alvo confirmado salvo ainda — clique em "Rodar nova varredura".';
            corpo.innerHTML = '<tr><td colspan="7" class="dr-vazio">Nada a exibir.</td></tr>';
            return;
        }

        resumo.textContent = `${alvos.length} alvo${alvos.length === 1 ? '' : 's'} confirmado(s), salvos na última varredura.`;

        alvos.forEach(function (alvo) {
            const linha = document.createElement('tr');
            linha.className = 'dr-linha';
            linha.innerHTML = `
                <td>${esc(alvo.nome)}</td>
                <td>${esc(formatarCpf(alvo.cpf))}</td>
                <td>${esc(alvo.enderecoGrupo)}</td>
                <td class="dr-origem">${esc(rotuloOrigem(alvo.origemMatch))}</td>
                <td><span class="dr-badge">${alvo.totalDenunciasGrupo}</span></td>
                <td>${esc(formatarDataHora(alvo.atualizadoEm))}</td>
                <td><button type="button" class="dr-btn-ficha" ${alvo.resultado ? '' : 'disabled'} title="${alvo.resultado ? 'Ver ficha completa (CAD/IDNET/Supabase)' : 'Sem resultado completo salvo'}">🔍 Detalhes</button></td>
            `;
            linha.querySelector('.dr-btn-ficha').addEventListener('click', function (e) {
                e.stopPropagation();
                abrirFichaCompleta(alvo);
            });
            let linhaDetalhe = null;
            linha.addEventListener('click', function () {
                if (linhaDetalhe) { linhaDetalhe.remove(); linhaDetalhe = null; return; }
                linhaDetalhe = montarLinhaDetalhe(alvo, 7);
                linha.after(linhaDetalhe);
            });
            corpo.appendChild(linha);
        });
    }

    async function carregarSalvos() {
        const avisoServidor = document.getElementById('dr-aviso-servidor');
        const resumo = document.getElementById('dr-resumo');
        const corpo = document.getElementById('dr-corpo-tabela');
        resumo.textContent = '';
        corpo.innerHTML = '<tr><td colspan="7" class="dr-vazio">Carregando…</td></tr>';

        if (!(await P3AtualizadorLocal.disponivel())) {
            avisoServidor.style.display = 'block';
            corpo.innerHTML = '';
            return;
        }
        avisoServidor.style.display = 'none';

        try {
            const resultado = await P3AtualizadorLocal.alvosDenunciaSalvos();
            if (!resultado.ok) {
                corpo.innerHTML = `<tr><td colspan="7" class="dr-erro">${esc(resultado.erro || 'Não foi possível carregar os alvos salvos.')}</td></tr>`;
                return;
            }
            renderizar(resultado.alvos);
        } catch (e) {
            corpo.innerHTML = `<tr><td colspan="7" class="dr-erro">Erro ao carregar: ${esc(e.message)}</td></tr>`;
        }
    }

    async function rodarVarredura() {
        const btn = document.getElementById('dr-btn-varredura');
        const log = document.getElementById('dr-log');
        const avisoServidor = document.getElementById('dr-aviso-servidor');

        if (!(await P3AtualizadorLocal.disponivel())) {
            avisoServidor.style.display = 'block';
            return;
        }
        avisoServidor.style.display = 'none';

        btn.disabled = true;
        log.style.display = 'block';
        log.textContent = 'Iniciando varredura...\n';

        try {
            const resumo = await P3AtualizadorLocal.rodarVarreduraDenunciasRecorrentes(function (evento) {
                if (evento.tipo === 'inicio') {
                    log.textContent += `Agrupando denúncias — ${evento.totalGrupos} grupo(s) de endereço encontrado(s).\n`;
                } else if (evento.tipo === 'progresso') {
                    log.textContent += `[${evento.concluidas}/${evento.total}] ${evento.etapa}\n`;
                } else if (evento.tipo === 'aviso') {
                    log.textContent += `⚠️ ${evento.mensagem}\n`;
                } else if (evento.tipo === 'aguardando') {
                    log.textContent += `${evento.mensagem}\n`;
                }
                log.scrollTop = log.scrollHeight;
            });
            log.textContent += `\n✅ Concluído — ${resumo.totalGrupos} grupo(s), ${resumo.totalCandidatos} candidato(s) confirmado(s), `
                + `${resumo.totalInvestigados} investigado(s), ${resumo.totalSalvos} salvo(s) na Hostinger.\n`;
            await carregarSalvos();
        } catch (e) {
            log.textContent += `\n❌ ${e.message}\n`;
        } finally {
            btn.disabled = false;
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        if (!P3.requireAuth()) return;
        document.getElementById('dr-btn-varredura').addEventListener('click', rodarVarredura);
        document.getElementById('dr-btn-atualizar').addEventListener('click', carregarSalvos);
        document.getElementById('dr-modal-ficha-fechar').addEventListener('click', fecharModalFicha);
        document.getElementById('dr-modal-ficha').addEventListener('click', function (e) {
            if (e.target.id === 'dr-modal-ficha') fecharModalFicha();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') fecharModalFicha();
        });
        carregarSalvos();
    });
})();
