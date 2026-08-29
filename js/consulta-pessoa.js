// ====================================================================
// Sistema P3 — Consulta Integrada de Pessoas (page/consulta-pessoa.html)
// ====================================================================
// Fala só com o servidor Python local (tools/atualizador-local/), rotas
// /pessoa/consultar e /pessoa/ocorrencia-detalhe (ver
// js/core/atualizador-local.js:consultarPessoa/ocorrenciaDetalhe) — sem
// fallback via Apps Script (essas fontes — CAD PPE/PC/SISPOL/BNMP/IDNET,
// TJAL — nunca existiram lá).
//
// Recurso sensível — só nível P2/ADMIN, mesmo critério de
// page/busca-facial-campo.html (ver requireP2OuAdmin abaixo). O
// servidor Python também recusa (503) se não estiver rodando dentro do
// app desktop com esse nível — aqui é só a 1ª camada (nunca confiar só
// no frontend, ver app.py:_autorizado).
//
// SIMPLIFICAÇÃO DELIBERADA (1ª versão) — mãe/pai em "Vínculos" aparecem
// como texto, não clicáveis: o CAD não devolve o CPF da mãe/pai, só o
// nome, e esta página só busca por CPF (ver cad_consulta.py). Abrir uma
// consulta cruzada por NOME é uma extensão possível, não implementada
// ainda de propósito (evita grafo complexo cedo demais, mesmo espírito
// do pedido original: "não é necessário implementar grafo agora").

(function () {
    'use strict';

    let ULTIMO_RESULTADO = null;
    let ABA_ATIVA = '';

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function limparCpf(v) {
        return String(v || '').replace(/\D/g, '');
    }

    function formatarCpf(cpfLimpo) {
        if (!cpfLimpo || cpfLimpo.length !== 11) return cpfLimpo || '—';
        return cpfLimpo.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    }

    // ────────────────────────────────────────────────────────────────
    // GATE — P2/ADMIN (mesmo critério de page/busca-facial-campo.html)
    // ────────────────────────────────────────────────────────────────
    function requireP2OuAdmin() {
        const sessao = P3.requireAuth();
        if (!sessao) return null;
        if (sessao.nivel !== 'p2' && sessao.nivel !== 'admin') {
            alert('Este recurso está disponível apenas para usuários com nível P2 ou ADMIN.');
            location.href = '../index.html';
            return null;
        }
        return sessao;
    }

    // ────────────────────────────────────────────────────────────────
    // CONSULTA
    // ────────────────────────────────────────────────────────────────
    async function consultar() {
        const input = document.getElementById('cip-input-cpf');
        const btn = document.getElementById('cip-btn-consultar');
        const msg = document.getElementById('cip-status-msg');
        const cpfLimpo = limparCpf(input.value);

        if (cpfLimpo.length !== 11) {
            msg.textContent = 'Informe um CPF válido (11 dígitos).';
            msg.style.color = 'var(--p3-danger)';
            return;
        }

        if (!(await P3AtualizadorLocal.disponivel())) {
            document.getElementById('cip-aviso-servidor').style.display = 'block';
            return;
        }
        document.getElementById('cip-aviso-servidor').style.display = 'none';

        btn.disabled = true;
        msg.style.color = 'var(--p3-text-muted)';
        msg.textContent = 'Consultando — pode levar alguns segundos, várias etapas são checadas em sequência...';
        document.getElementById('cip-header-pessoa').classList.remove('visivel');
        document.getElementById('cip-conteudo').style.display = 'none';

        const progWrap = document.getElementById('cip-progresso-wrap');
        const progFill = document.getElementById('cip-progresso-fill');
        const progEtapa = document.getElementById('cip-progresso-etapa');
        const progTexto = document.getElementById('cip-progresso-texto');
        progWrap.style.display = 'block';
        progFill.style.width = '0%';
        progEtapa.textContent = 'Iniciando...';
        progTexto.textContent = '';

        try {
            const r = await P3AtualizadorLocal.consultarPessoaStream(cpfLimpo, function (evento) {
                if (evento.tipo === 'progresso') {
                    const pct = Math.round((evento.concluidas / evento.total) * 100);
                    progFill.style.width = pct + '%';
                    progEtapa.textContent = evento.etapa;
                    progTexto.textContent = `${evento.concluidas}/${evento.total} (${pct}%)`;
                }
            });
            progFill.style.width = '100%';
            ULTIMO_RESULTADO = r;
            const btnImprimir = document.getElementById('cip-btn-imprimir');
            btnImprimir.disabled = false;
            btnImprimir.title = '';
            msg.style.color = '#1e6b34';
            const okCount = r.fontes.filter(f => f.ok).length;
            msg.textContent = `Consulta concluída em ${(r.tempoTotalMs / 1000).toFixed(1)}s — ${okCount}/${r.fontes.length} etapa(s) concluídas.`;
            renderizarTudo(r);
        } catch (e) {
            msg.style.color = 'var(--p3-danger)';
            msg.textContent = 'Erro: ' + e.message;
        } finally {
            btn.disabled = false;
            setTimeout(() => { progWrap.style.display = 'none'; }, 1200);
        }
    }

    // Reaproveitada pelos cliques em "Vínculos" — abre uma consulta NOVA
    // pro CPF vinculado (autor/suspeito já cadastrado, quando o cruzamento
    // com autores/suspeitos achar CPF — ver renderVinculos).
    function consultarPorCpf(cpfLimpo) {
        document.getElementById('cip-input-cpf').value = formatarCpf(cpfLimpo);
        consultar();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    window.P3ConsultaPessoaAbrirCpf = consultarPorCpf;

    // ────────────────────────────────────────────────────────────────
    // CABEÇALHO DA PESSOA
    // ────────────────────────────────────────────────────────────────
    function renderizarHeader(r) {
        const p = r.pessoa;
        const el = document.getElementById('cip-header-pessoa');
        if (!p) { el.classList.remove('visivel'); return; }
        el.classList.add('visivel');
        document.getElementById('cip-header-nome').textContent = p.nome || '(sem nome)';

        const fotoEl = document.getElementById('cip-header-foto');
        if (r.fotos && r.fotos.length) {
            fotoEl.innerHTML = `<img src="${r.fotos[0]}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:10px;">`;
        } else {
            fotoEl.innerHTML = '👤';
        }

        const grid = document.getElementById('cip-header-grid');
        const linhas = [
            ['CPF', formatarCpf(r.cpf)],
            ['Nascimento', p.dataNascimento || '—'],
            ['Mãe', p.mae || '—'],
            ['Pai', p.pai || '—'],
            ['RG', p.rg || '—'],
            ['Alcunha', p.alcunha || '—'],
        ];
        grid.innerHTML = linhas.map(([k, v]) => `<div><b>${esc(k)}:</b> ${esc(v)}</div>`).join('');

        const alertasEl = document.getElementById('cip-header-alertas');
        const alertas = [];
        if (r.mandados && r.mandados.possuiMandado) alertas.push('🚨 MANDADO DE PRISÃO ATIVO (BNMP)');
        if (r.pessoasEncontradas && r.pessoasEncontradas.length > 1) {
            alertas.push(`⚠️ ${r.pessoasEncontradas.length} registros encontrados pra este CPF — possível duplicidade cadastral`);
        }
        alertasEl.innerHTML = alertas.map(a => `<span class="cip-header-alerta">${esc(a)}</span>`).join(' ');
    }

    // ────────────────────────────────────────────────────────────────
    // ABAS
    // ────────────────────────────────────────────────────────────────
    const DEFINICAO_ABAS = [
        { id: 'visaogeral', label: '📊 Visão Geral', contar: r => null },
        { id: 'cnh', label: '🪪 CNH', contar: r => r.cnh ? 1 : 0 },
        { id: 'vinculos', label: '👪 Vínculos', contar: r => (r.pessoa && (r.pessoa.mae || r.pessoa.pai)) ? 1 : 0 },
        { id: 'enderecos', label: '📍 Endereços', contar: r => montarEnderecos(r).length },
        { id: 'ocorrencias', label: '🚓 Ocorrências', contar: r => (r.ocorrenciasPpe || []).length + (r.ocorrenciasPcAntigo || []).length + (r.ocorrenciasDespacho || []).length },
        { id: 'mandados', label: '⛓️ BNMP', contar: r => (r.mandados && r.mandados.possuiMandado) ? 1 : 0 },
        { id: 'processos', label: '⚖️ Processos', contar: r => (r.processos || []).length },
        { id: 'veiculos', label: '🚗 Veículos', contar: r => (r.veiculos || []).length },
        { id: 'timeline', label: '🕐 Linha do Tempo', contar: r => null },
        { id: 'fontes', label: '🔌 Fontes', contar: r => r.fontes.length },
    ];

    function renderizarTudo(r) {
        document.getElementById('cip-conteudo').style.display = 'block';
        renderizarHeader(r);

        const abasEl = document.getElementById('cip-abas');
        const paineisEl = document.getElementById('cip-paineis');
        if (!ABA_ATIVA) ABA_ATIVA = 'visaogeral';

        abasEl.innerHTML = DEFINICAO_ABAS.map(a => {
            const n = a.contar(r);
            const badge = (n !== null) ? `<span class="cip-badge-contagem">${n}</span>` : '';
            return `<button type="button" class="cip-aba-btn${a.id === ABA_ATIVA ? ' ativa' : ''}" data-aba="${a.id}">${a.label}${badge}</button>`;
        }).join('');
        abasEl.querySelectorAll('.cip-aba-btn').forEach(btn => {
            btn.addEventListener('click', () => { ABA_ATIVA = btn.dataset.aba; renderizarTudo(r); });
        });

        const renderers = {
            visaogeral: renderVisaoGeral, cnh: renderCnh, vinculos: renderVinculos,
            enderecos: renderEnderecos, ocorrencias: renderOcorrencias, mandados: renderMandados,
            processos: renderProcessos, veiculos: renderVeiculos, timeline: renderTimeline, fontes: renderFontes,
        };
        paineisEl.innerHTML = `<div class="cip-painel ativo">${(renderers[ABA_ATIVA] || (() => ''))(r)}</div>`;
        // Religa os cliques de detalhe/expand depois de re-renderizar (o innerHTML acima apaga listeners antigos).
        ligarEventosPainelAtivo(r);
    }

    // ────────────────────────────────────────────────────────────────
    // VISÃO GERAL
    // ────────────────────────────────────────────────────────────────
    function renderVisaoGeral(r) {
        const p = r.pessoa || {};
        const totalOcor = (r.ocorrenciasPpe || []).length + (r.ocorrenciasPcAntigo || []).length + (r.ocorrenciasDespacho || []).length;

        // Foto + nome completo (pedido explícito do usuário) — foto vem
        // de r.fotos[0] quando disponível; sem foto ainda, fica um
        // espaço reservado (ex.: fonte em depuração no momento) em vez
        // de simplesmente não mostrar nada.
        const temFoto = r.fotos && r.fotos.length;
        let h = '<div class="cip-card" style="display:flex;gap:16px;align-items:center;">';
        h += `<div style="width:72px;height:72px;border-radius:10px;background:var(--p3-bg);border:1px solid var(--p3-border);
              display:flex;align-items:center;justify-content:center;font-size:30px;opacity:${temFoto ? '1' : '.4'};overflow:hidden;flex-shrink:0;">`;
        h += temFoto ? `<img src="${r.fotos[0]}" alt="" style="width:100%;height:100%;object-fit:cover;">` : '👤';
        h += '</div>';
        h += `<div><div style="font-size:17px;font-weight:700;color:var(--p3-text);">${esc(p.nome || '(nome não encontrado)')}</div>
              <div style="font-size:12px;color:var(--p3-text-muted);margin-top:3px;">CPF ${esc(formatarCpf(r.cpf))}${p.dataNascimento ? ' · Nascimento ' + esc(p.dataNascimento) : ''}</div></div>`;
        h += '</div>';

        const kpis = [
            ['🚓', totalOcor, 'Ocorrências'],
            ['⚖️', (r.processos || []).length, 'Processos'],
            ['🚗', (r.veiculos || []).length, 'Veículos (via ocorrências)'],
            ['📍', montarEnderecos(r).length, 'Endereços'],
            ['🔌', r.fontes.filter(f => f.ok).length + '/' + r.fontes.length, 'Etapas concluídas'],
        ];
        h += '<div class="cip-card"><div class="cip-card-titulo">Resumo</div>';
        h += '<div style="display:flex;gap:14px;flex-wrap:wrap;">';
        kpis.forEach(([ic, n, l]) => {
            h += `<div style="flex:1;min-width:140px;background:var(--p3-bg);border-radius:8px;padding:12px 16px;">
                <div style="font-size:22px;">${ic}</div>
                <div style="font-size:22px;font-weight:800;color:var(--p3-blue-700);">${n}</div>
                <div style="font-size:11px;color:var(--p3-text-muted);text-transform:uppercase;">${esc(l)}</div>
            </div>`;
        });
        h += '</div></div>';
        h += `<div class="cip-card" style="font-size:12.5px;color:var(--p3-text-muted);">
            Este painel é <strong>informativo e investigativo</strong> — mostra quantidade de ocorrências e
            relações encontradas, não representa risco/culpabilidade nem conclusão automática.
        </div>`;
        return h;
    }

    // ────────────────────────────────────────────────────────────────
    // CNH
    // ────────────────────────────────────────────────────────────────
    function renderCnh(r) {
        if (!r.cnh) return '<div class="cip-vazio">Nenhum dado de CNH encontrado pra este CPF.</div>';
        const h = Object.entries(r.cnh).map(([k, v]) =>
            `<div><b>${esc(k)}:</b> ${esc(v || '—')}</div>`).join('');
        return `<div class="cip-card"><div class="cip-card-titulo">CNH</div>
            <div class="cip-kv">${h}</div></div>`;
    }

    // ────────────────────────────────────────────────────────────────
    // VÍNCULOS — mãe/pai (ver nota de simplificação no topo do arquivo)
    // ────────────────────────────────────────────────────────────────
    function renderVinculos(r) {
        const p = r.pessoa;
        if (!p || (!p.mae && !p.pai)) return '<div class="cip-vazio">Nenhuma filiação encontrada.</div>';
        let h = '<div class="cip-card"><div class="cip-card-titulo">Filiação</div><div class="cip-kv">';
        if (p.mae) h += `<div><b>Mãe:</b> ${esc(p.mae)}</div>`;
        if (p.pai) h += `<div><b>Pai:</b> ${esc(p.pai)}</div>`;
        h += '</div><p style="font-size:11.5px;color:var(--p3-text-muted);margin-top:10px;">O CPF da mãe/pai não está disponível — pra consultar essa pessoa, é preciso pesquisar o CPF dela diretamente, se conhecido.</p></div>';
        return h;
    }

    // ────────────────────────────────────────────────────────────────
    // ENDEREÇOS — consolidados de TODAS as fontes que trazem campo de
    // endereço: identificação civil (com data — a mais completa) e CNH.
    // Busca a CHAVE do campo por regex (contém "endere") em vez de um
    // nome fixo — mais tolerante a variações de acento/grafia entre as
    // fontes (ex.: "Endereço" vs "Endereco") do que comparar string
    // exata. Dedup por texto normalizado.
    // ────────────────────────────────────────────────────────────────
    function normalizarEndereco(s) {
        return String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
    }
    function extrairCampoEndereco(obj) {
        if (!obj) return null;
        const chave = Object.keys(obj).find(k => /endere/i.test(k));
        return chave ? obj[chave] : null;
    }
    function montarEnderecos(r) {
        const vistos = new Set();
        const lista = [];
        function adicionar(end, data) {
            if (!end) return;
            const chave = normalizarEndereco(end);
            if (vistos.has(chave)) return;
            vistos.add(chave);
            lista.push({ endereco: end, data: data || null });
        }
        (r.idnet || []).forEach(reg => adicionar(extrairCampoEndereco(reg), reg['Data de Atendimento no IC']));
        adicionar(extrairCampoEndereco(r.cnh), null);
        return lista;
    }
    function renderEnderecos(r) {
        const lista = montarEnderecos(r);
        if (!lista.length) return '<div class="cip-vazio">Nenhum endereço encontrado.</div>';
        // Mais recente primeiro — data no formato DD/MM/AAAA HH:MM:SS
        lista.sort((a, b) => {
            const da = a.data ? a.data.split(' ')[0].split('/').reverse().join('') : '';
            const db = b.data ? b.data.split(' ')[0].split('/').reverse().join('') : '';
            return db.localeCompare(da);
        });
        let h = '<div class="cip-card"><div class="cip-card-titulo">Endereços</div>';
        lista.forEach((e, i) => {
            h += `<div style="padding:8px 0;${i > 0 ? 'border-top:1px dashed var(--p3-border);' : ''}">
                <div style="font-size:13px;color:var(--p3-text);">${esc(e.endereco)}</div>
                <div style="font-size:11px;color:var(--p3-text-muted);margin-top:2px;">${e.data ? 'Identificado em ' + esc(e.data) : 'Sem data'}</div>
            </div>`;
        });
        h += '</div>';
        return h;
    }

    // ────────────────────────────────────────────────────────────────
    // OCORRÊNCIAS — 3 fontes juntas, cada linha clicável (detalhe sob
    // demanda pra PPE/PC-antigo; SISPOL já tem detalhe pronto pras N
    // mais recentes — ver LIMITE_DETALHE_AUTOMATICO no Python).
    // ────────────────────────────────────────────────────────────────
    function renderOcorrencias(r) {
        const ppe = r.ocorrenciasPpe || [];
        const pcAntigo = r.ocorrenciasPcAntigo || [];
        const despc = r.ocorrenciasDespacho || [];
        if (!ppe.length && !pcAntigo.length && !despc.length) {
            return '<div class="cip-vazio">Nenhuma ocorrência encontrada.</div>';
        }

        let h = '';
        if (despc.length) {
            h += `<div class="cip-card"><div class="cip-card-titulo">Ocorrências — ${despc.length}</div>${tabelaOcorrenciasDespc(r, despc)}</div>`;
        }
        if (ppe.length) {
            h += `<div class="cip-card"><div class="cip-card-titulo">Ocorrências policiais — ${ppe.length}</div>${tabelaOcorrenciasPpe(ppe)}</div>`;
        }
        if (pcAntigo.length) {
            h += `<div class="cip-card"><div class="cip-card-titulo">Registros anteriores — ${pcAntigo.length} boletim(ns)</div>${tabelaOcorrenciasPcAntigo(pcAntigo)}</div>`;
        }
        return h;
    }

    function tabelaOcorrenciasDespc(r, lista) {
        const detalhesPorId = {};
        (r.detalhesOcorrencias || []).forEach(d => { detalhesPorId[d.idOcorrencia] = d; });
        let h = '<div class="cip-tabela-wrap"><table class="cip-tabela"><thead><tr><th>Nº Ocorrência</th><th>Data</th><th>Natureza</th><th>Envolvimento</th><th>Situação</th></tr></thead><tbody>';
        lista.forEach((o, i) => {
            const idOcor = o._id_ocor || '';
            const jaTemDetalhe = !!detalhesPorId[idOcor];
            h += `<tr class="cip-linha-despc" data-idx="${i}" data-id-ocor="${esc(idOcor)}" data-ja-tem="${jaTemDetalhe ? '1' : '0'}">
                <td>${esc(o.id_ocor_fk || idOcor || '—')}</td>
                <td style="white-space:nowrap;">${esc(o.dt_ocor || '—')}</td>
                <td>${esc(o.ds_ocor_sgrup || '—')}</td>
                <td>${esc(o.ds_oco_despc_tipo_envl || '—')}</td>
                <td>${esc(o.ds_ocor_despc_envl_pess_sitc || '—')}</td>
            </tr><tr class="cip-detalhe-linha" id="cip-det-despc-${i}"><td colspan="5"></td></tr>`;
        });
        h += '</tbody></table></div>';
        return h;
    }

    function tabelaOcorrenciasPpe(lista) {
        let h = '<div class="cip-tabela-wrap"><table class="cip-tabela"><thead><tr><th>Data</th><th>Natureza</th><th>Envolvimento</th><th>Sexo</th></tr></thead><tbody>';
        lista.forEach((o, i) => {
            h += `<tr class="cip-linha-ppe" data-idx="${i}" data-id="${esc(o._id || '')}" data-hash="${esc(o._hash || '')}">
                <td style="white-space:nowrap;">${esc(o.dt_ocorrencia || '—')}</td>
                <td>${esc(o.no_natureza_ocorrencia || '—')}</td>
                <td>${esc(o.tipo_envolvimento || '—')}</td>
                <td>${esc(o.sexo || '—')}</td>
            </tr><tr class="cip-detalhe-linha" id="cip-det-ppe-${i}"><td colspan="4"></td></tr>`;
        });
        h += '</tbody></table></div>';
        return h;
    }

    function tabelaOcorrenciasPcAntigo(lista) {
        let h = '<div class="cip-tabela-wrap"><table class="cip-tabela"><thead><tr><th>Nº BO</th><th>Data</th><th>Nome</th><th>Mãe</th></tr></thead><tbody>';
        lista.forEach((o, i) => {
            h += `<tr class="cip-linha-pcantigo" data-idx="${i}" data-env="${esc(o._env || o.attr_numero_bo || '')}">
                <td>${esc(o.attr_numero_bo || '—')}</td>
                <td style="white-space:nowrap;">${esc(o.data_hora_registro || '—')}</td>
                <td>${esc(o.nome || '—')}</td>
                <td>${esc(o.mae || '—')}</td>
            </tr><tr class="cip-detalhe-linha" id="cip-det-pcantigo-${i}"><td colspan="4"></td></tr>`;
        });
        h += '</tbody></table></div>';
        return h;
    }

    function montarHtmlDetalheCampos(campos) {
        if (!campos || !Object.keys(campos).length) return '<div style="font-size:12px;color:var(--p3-text-muted);">Sem detalhe disponível.</div>';
        return '<div class="cip-kv">' + Object.entries(campos)
            .filter(([, v]) => v)
            .map(([k, v]) => `<div><b>${esc(k)}:</b> ${esc(v)}</div>`).join('') + '</div>';
    }

    async function abrirDetalheLinha(tr, linhaDetalheId, buscarFn) {
        const detalheEl = document.getElementById(linhaDetalheId);
        if (!detalheEl) return;
        const aberto = detalheEl.classList.contains('visivel');
        document.querySelectorAll('.cip-detalhe-linha.visivel').forEach(d => d.classList.remove('visivel'));
        if (aberto) return;
        detalheEl.classList.add('visivel');
        const td = detalheEl.querySelector('td');
        if (td.dataset.carregado) return; // já buscado antes — não repete a chamada
        td.innerHTML = '<div style="font-size:12px;color:var(--p3-text-muted);">Carregando...</div>';
        try {
            const campos = await buscarFn();
            td.innerHTML = montarHtmlDetalheCampos(campos);
            td.dataset.carregado = '1';
        } catch (e) {
            td.innerHTML = `<div style="font-size:12px;color:var(--p3-danger);">Erro ao carregar: ${esc(e.message)}</div>`;
        }
    }

    function ligarEventosPainelAtivo(r) {
        document.querySelectorAll('.cip-linha-ppe').forEach(tr => {
            tr.addEventListener('click', () => {
                const i = tr.dataset.idx;
                abrirDetalheLinha(tr, 'cip-det-ppe-' + i, async () => {
                    const resp = await P3AtualizadorLocal.ocorrenciaDetalhe({ tipo: 'ppe', id: tr.dataset.id, hash: tr.dataset.hash });
                    if (!resp.ok) throw new Error(resp.erro || 'falha');
                    return resp.detalhe;
                });
            });
        });
        document.querySelectorAll('.cip-linha-pcantigo').forEach(tr => {
            tr.addEventListener('click', () => {
                const i = tr.dataset.idx;
                abrirDetalheLinha(tr, 'cip-det-pcantigo-' + i, async () => {
                    const resp = await P3AtualizadorLocal.ocorrenciaDetalhe({ tipo: 'pc_antigo', numeroBo: tr.dataset.env });
                    if (!resp.ok) throw new Error(resp.erro || 'falha');
                    // Detalhe do PC antigo pode ter VÁRIOS envolvidos (array) — junta todos num só bloco.
                    const lista = Array.isArray(resp.detalhe) ? resp.detalhe : [resp.detalhe];
                    return lista.reduce((acc, bloco, idx) => {
                        Object.entries(bloco || {}).forEach(([k, v]) => { acc[`${k} (envolvido ${idx + 1})`] = v; });
                        return acc;
                    }, {});
                });
            });
        });
        document.querySelectorAll('.cip-linha-despc').forEach(tr => {
            tr.addEventListener('click', () => {
                const i = tr.dataset.idx;
                const idOcor = tr.dataset.idOcor;
                abrirDetalheLinha(tr, 'cip-det-despc-' + i, async () => {
                    const detalhesPorId = {};
                    (ULTIMO_RESULTADO.detalhesOcorrencias || []).forEach(d => { detalhesPorId[d.idOcorrencia] = d; });
                    if (detalhesPorId[idOcor]) return detalhesPorId[idOcor].campos;
                    const resp = await P3AtualizadorLocal.ocorrenciaDetalhe({ tipo: 'despacho', idOcor: idOcor });
                    if (!resp.ok) throw new Error(resp.erro || 'falha');
                    return resp.detalhe.campos;
                });
            });
        });
    }

    // ────────────────────────────────────────────────────────────────
    // BNMP
    // ────────────────────────────────────────────────────────────────
    function renderMandados(r) {
        if (!r.mandados || !r.mandados.possuiMandado) {
            return '<div class="cip-card" style="color:#1e6b34;">✓ Nenhuma informação de mandado de prisão ativo encontrada na Central Nacional (BNMP) pra este CPF.</div>';
        }
        return `<div class="cip-card"><div class="cip-card-titulo" style="color:var(--p3-danger);">🚨 Mandado de prisão — BNMP</div>
            ${montarHtmlDetalheCampos(r.mandados.detalhe)}</div>`;
    }

    // ────────────────────────────────────────────────────────────────
    // PROCESSOS — TJAL (busca por nome) + TJSP (busca direta por CPF)
    // ────────────────────────────────────────────────────────────────
    const DOMINIO_ESAJ_POR_TRIBUNAL = { TJAL: 'www2.tjal.jus.br', TJSP: 'esaj.tjsp.jus.br' };
    const ORIGEM_LABEL = { nome_unico: 'Nome único', cpf_confirmado: 'CPF confirmado', cpf_direto: 'CPF direto' };
    function renderProcessos(r) {
        const lista = r.processos || [];
        if (!lista.length) return '<div class="cip-vazio">Nenhum processo encontrado (TJAL e TJSP) pra esta pessoa.</div>';
        let h = `<div class="cip-card"><div class="cip-card-titulo">Processos judiciais</div>
            <p style="font-size:11.5px;color:var(--p3-text-muted);margin-bottom:10px;">
                TJAL (por nome) e TJSP (direto por CPF) — classe/assunto/último andamento, quando disponíveis, vêm
                do DataJud (CNJ), checado também em tribunais vizinhos, federal (TRF5) e militar.
            </p>`;
        h += '<div class="cip-tabela-wrap"><table class="cip-tabela"><thead><tr><th>Tribunal</th><th>Nº Processo</th><th>Origem do vínculo</th><th>Classe / Assunto</th><th>Último andamento</th><th></th></tr></thead><tbody>';
        lista.forEach(p => {
            const dominio = DOMINIO_ESAJ_POR_TRIBUNAL[p.tribunal] || DOMINIO_ESAJ_POR_TRIBUNAL.TJAL;
            const link = `https://${dominio}/cpopg/search.do?cbPesquisa=NUMPROC&dadosConsulta.valorConsultaNuUnificado=${encodeURIComponent(p.numeroProcesso)}&dadosConsulta.tipoNuProcesso=UNIFICADO`;
            const classeAssunto = [p.classe, p.assunto].filter(Boolean).join(' — ') || '—';
            const mov = p.ultimoMovimento;
            const movTexto = mov ? `${esc(mov.textoCompleto || mov.nome || '—')}${mov.dataHora ? ' <span style="color:var(--p3-text-muted);">(' + esc(new Date(mov.dataHora).toLocaleDateString('pt-BR')) + ')</span>' : ''}` : '—';
            h += `<tr><td><b>${esc(p.tribunal || 'TJAL')}</b></td><td>${esc(p.numeroProcesso)}</td><td>${esc(ORIGEM_LABEL[p.origem] || p.origem || '—')}</td>
                <td>${esc(classeAssunto)}</td><td>${movTexto}</td>
                <td><a href="${link}" target="_blank" rel="noopener" style="color:var(--p3-blue-700);">Abrir no e-SAJ ↗</a></td></tr>`;
        });
        h += '</tbody></table></div></div>';
        return h;
    }

    // ────────────────────────────────────────────────────────────────
    // VEÍCULOS
    // ────────────────────────────────────────────────────────────────
    function renderVeiculos(r) {
        const lista = r.veiculos || [];
        if (!lista.length) return '<div class="cip-vazio">Nenhum veículo encontrado nas ocorrências desta pessoa.</div>';
        let h = `<div class="cip-card"><div class="cip-card-titulo">Veículos</div>
            <p style="font-size:11.5px;color:var(--p3-text-muted);margin-bottom:10px;">
                Descobertos a partir das ocorrências desta pessoa — a relação PROPRIETÁRIO só é atribuída quando o
                CPF do proprietário bate com o CPF pesquisado.
            </p>`;
        h += '<div class="cip-tabela-wrap"><table class="cip-tabela"><thead><tr><th>Placa</th><th>Modelo</th><th>Cor</th><th>Ano</th><th>Relação</th><th>Situação na ocorrência</th></tr></thead><tbody>';
        lista.forEach(v => {
            const d = v.detran || {};
            const corRelacao = v.relacao === 'PROPRIETARIO' ? '#1e6b34' : '#8a6100';
            h += `<tr>
                <td><b>${esc(v.placa)}</b></td>
                <td>${esc(d['Modelo'] || '—')}</td>
                <td>${esc(d['Cor'] || '—')}</td>
                <td>${esc(d['Ano'] || '—')}</td>
                <td><span style="color:${corRelacao};font-weight:700;">${v.relacao === 'PROPRIETARIO' ? 'PROPRIETÁRIO' : 'ENVOLVIDO'}</span></td>
                <td>${esc(v.situacaoNaOcorrencia || '—')}</td>
            </tr>`;
        });
        h += '</tbody></table></div></div>';
        return h;
    }

    // ────────────────────────────────────────────────────────────────
    // TIMELINE — junta PPE + PC antigo + SISPOL + processos por ano,
    // mais recente primeiro.
    // ────────────────────────────────────────────────────────────────
    function parseDataBrParaOrdenacao(s) {
        const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
        return m ? m[3] + m[2] + m[1] : '';
    }
    function renderTimeline(r) {
        const itens = [];
        (r.ocorrenciasPpe || []).forEach(o => itens.push({ data: o.dt_ocorrencia, texto: `${o.no_natureza_ocorrencia || 'Ocorrência'} (${o.tipo_envolvimento || '—'})`, fonte: 'Ocorrência' }));
        (r.ocorrenciasPcAntigo || []).forEach(o => itens.push({ data: o.data_hora_registro, texto: `Boletim ${o.attr_numero_bo || '—'}`, fonte: 'Registro anterior' }));
        (r.ocorrenciasDespacho || []).forEach(o => itens.push({ data: o.dt_ocor, texto: `${o.ds_ocor_sgrup || 'Ocorrência'} (${o.ds_oco_despc_tipo_envl || '—'})`, fonte: 'Ocorrência' }));

        itens.forEach(it => { it._ord = parseDataBrParaOrdenacao(it.data); });
        itens.sort((a, b) => b._ord.localeCompare(a._ord));

        if (!itens.length) return '<div class="cip-vazio">Nenhum evento datado encontrado pra montar a linha do tempo.</div>';

        let h = '<div class="cip-card"><div class="cip-timeline">';
        let anoAtual = null;
        itens.forEach(it => {
            const ano = (it._ord || '').slice(0, 4) || '(sem data)';
            if (ano !== anoAtual) { h += `<div class="cip-timeline-ano">${esc(ano)}</div>`; anoAtual = ano; }
            h += `<div class="cip-timeline-item">
                <div class="cip-timeline-data">${esc(it.data || '—')}</div>
                <div class="cip-timeline-texto">${esc(it.texto)} <span class="cip-fonte-tag">${esc(it.fonte)}</span></div>
            </div>`;
        });
        h += '</div></div>';
        return h;
    }

    // ────────────────────────────────────────────────────────────────
    // FONTES
    // ────────────────────────────────────────────────────────────────
    function renderFontes(r) {
        let h = '<div class="cip-card"><div class="cip-card-titulo">Etapas desta consulta</div><div id="cip-fontes-lista">';
        r.fontes.forEach(f => {
            const status = f.ok ? '<span class="cip-status-ok">✓ ok</span>' : `<span class="cip-status-erro">✗ erro: ${esc(f.erro || '')}</span>`;
            h += `<div class="cip-fonte-linha"><span>${esc(f.fonte)}</span><span>${status} — ${f.elapsedMs}ms</span></div>`;
        });
        h += `</div><p style="font-size:11px;color:var(--p3-text-muted);margin-top:10px;">
            Consultado em ${esc(r.consultadoEm)} — tempo total ${(r.tempoTotalMs / 1000).toFixed(1)}s.
        </p></div>`;
        return h;
    }

    // ────────────────────────────────────────────────────────────────
    // IMPRESSÃO — pedido explícito do usuário: "imprimir a consulta com
    // todos os dados completos". Mesmo padrão visual (capa em gradiente
    // + cartão de seção com selo numerado) de
    // js/core/modal-mudancas-movimentacao.js / relatorios/relatorio_preditiva.html.
    // Reaproveita as MESMAS funções render*(r) já usadas na tela — nunca
    // recalcula nada — então a impressão sai com o mesmo texto/números
    // que a tela mostra, incluindo a regra de não citar de onde cada
    // dado veio.
    //
    // Ocorrências ganham um render PRÓPRIO pra impressão
    // (renderOcorrenciasParaImpressao) porque a versão da tela depende
    // de clique pra abrir o detalhe — no papel isso não existe, então o
    // detalhe já carregado (ver r.detalhesOcorrencias, preenchido
    // automaticamente pras ocorrências mais recentes — ver
    // LIMITE_DETALHE_AUTOMATICO no Python) entra ABERTO, sem exigir
    // ação nenhuma. As ocorrências que nunca tiveram o detalhe buscado
    // (além do limite automático, ou de outras fontes) aparecem só com
    // o resumo da tabela — a impressão não dispara buscas novas.
    function _cipGarantirDomImpressao() {
        if (document.getElementById('cip-print-raiz')) return;
        const raiz = document.createElement('div');
        raiz.id = 'cip-print-raiz';
        document.body.appendChild(raiz);
    }

    function renderOcorrenciasParaImpressao(r) {
        const ppe = r.ocorrenciasPpe || [];
        const pcAntigo = r.ocorrenciasPcAntigo || [];
        const despc = r.ocorrenciasDespacho || [];
        if (!ppe.length && !pcAntigo.length && !despc.length) {
            return '<div class="cip-vazio">Nenhuma ocorrência encontrada.</div>';
        }
        const detalhesPorId = {};
        (r.detalhesOcorrencias || []).forEach(d => { detalhesPorId[d.idOcorrencia] = d; });

        let h = '';
        if (despc.length) {
            h += `<div class="cip-card"><div class="cip-card-titulo">Ocorrências — ${despc.length}</div>`;
            despc.forEach(o => {
                const det = detalhesPorId[o._id_ocor];
                h += `<div style="padding:10px 0;border-top:1px dashed var(--p3-border);">
                    <div style="font-size:12.5px;"><b>${esc(o.id_ocor_fk || o._id_ocor || '—')}</b> — ${esc(o.dt_ocor || '—')}</div>
                    <div style="font-size:12px;color:var(--p3-text);margin-top:2px;">${esc(o.ds_ocor_sgrup || '—')}</div>
                    <div style="font-size:11px;color:var(--p3-text-muted);margin-top:2px;">Envolvimento: ${esc(o.ds_oco_despc_tipo_envl || '—')} · Situação: ${esc(o.ds_ocor_despc_envl_pess_sitc || '—')}</div>
                    ${det ? montarHtmlDetalheCampos(det.campos) : ''}
                </div>`;
            });
            h += '</div>';
        }
        if (ppe.length) {
            h += `<div class="cip-card"><div class="cip-card-titulo">Ocorrências policiais — ${ppe.length}</div>${tabelaOcorrenciasPpe(ppe)}</div>`;
        }
        if (pcAntigo.length) {
            h += `<div class="cip-card"><div class="cip-card-titulo">Registros anteriores — ${pcAntigo.length} boletim(ns)</div>${tabelaOcorrenciasPcAntigo(pcAntigo)}</div>`;
        }
        return h;
    }

    function _cipMontarSecao(numero, titulo, htmlConteudo) {
        return `<div class="cpp-secao">
            <div class="cpp-secao-titulo"><div class="cpp-secao-numero">${numero}</div><div><h2>${esc(titulo)}</h2></div></div>
            <div class="cpp-conteudo">${htmlConteudo}</div>
        </div>`;
    }

    function imprimirConsultaCompleta() {
        const r = ULTIMO_RESULTADO;
        if (!r) { alert('Consulte uma pessoa primeiro.'); return; }

        _cipGarantirDomImpressao();
        const raiz = document.getElementById('cip-print-raiz');
        const p = r.pessoa || {};
        const agora = new Date();
        const agoraFmt = String(agora.getDate()).padStart(2, '0') + '/' + String(agora.getMonth() + 1).padStart(2, '0') + '/' + agora.getFullYear() +
            ' ' + String(agora.getHours()).padStart(2, '0') + ':' + String(agora.getMinutes()).padStart(2, '0');

        let html = `<div class="cpp-capa">
            <div class="cpp-capa-header">
                <img src="../img/brasao.png" alt="Brasão 10º BPM">
                <div class="cpp-capa-org"><h1>SISTEMA DE GERENCIAMENTO P3</h1><h2>10º BATALHÃO DE POLÍCIA MILITAR DE ALAGOAS</h2></div>
            </div>
            <div class="cpp-capa-titulo">
                <h3>CONSULTA INTEGRADA DE PESSOAS</h3>
                <p>Identificação, CNH, vínculos, endereços, ocorrências, mandados, processos e veículos consolidados</p>
            </div>
            <div class="cpp-capa-meta">
                <span>👤 ${esc(p.nome || '(nome não encontrado)')}</span>
                <span>📄 CPF ${esc(formatarCpf(r.cpf))}</span>
                <span>🖨️ Impresso em ${agoraFmt}</span>
            </div>
        </div>`;

        let n = 1;
        html += _cipMontarSecao(n++, 'Visão Geral', renderVisaoGeral(r));
        html += _cipMontarSecao(n++, 'CNH', renderCnh(r));
        html += _cipMontarSecao(n++, 'Vínculos', renderVinculos(r));
        html += _cipMontarSecao(n++, 'Endereços', renderEnderecos(r));
        html += _cipMontarSecao(n++, 'Ocorrências', renderOcorrenciasParaImpressao(r));
        html += _cipMontarSecao(n++, 'Mandados', renderMandados(r));
        html += _cipMontarSecao(n++, 'Processos Judiciais', renderProcessos(r));
        html += _cipMontarSecao(n++, 'Veículos', renderVeiculos(r));
        html += _cipMontarSecao(n++, 'Linha do Tempo', renderTimeline(r));

        html += `<div class="cpp-rodape">
            <div><strong>Sistema P3</strong> — 10º Batalhão de Polícia Militar<br>Seção de Planejamento, Ensino e Instrução — P3/10ºBPM</div>
            <div style="text-align:right;">Consulta realizada em ${esc(r.consultadoEm)}</div>
        </div>`;

        raiz.innerHTML = html;
        window.print();
    }

    // ────────────────────────────────────────────────────────────────
    // 2ª FONTE DE FOTO — token de 6 dígitos do app oficial (ver
    // idseg_quimera.py). Config isolada nesta página só (não é
    // credencial nova — reaproveita login/senha do CAD já salvos no
    // modal "🔑 Configurar acesso ao CAD"), por isso não usa o modal
    // global — é 1 campo extra, específico daqui.
    // ────────────────────────────────────────────────────────────────
    async function atualizarStatusIdseg() {
        const statusEl = document.getElementById('cip-idseg-status');
        try {
            const r = await P3AtualizadorLocal.idsegStatus();
            statusEl.style.color = r.configurado ? '#1e6b34' : 'var(--p3-text-muted)';
            statusEl.textContent = r.configurado ? '✅ Configurado — a 2ª fonte de foto será tentada nas consultas.' : '2ª fonte de foto ainda não configurada.';
        } catch (e) {
            statusEl.style.color = 'var(--p3-text-muted)';
            statusEl.textContent = 'Servidor local não respondeu — abra-o pra configurar.';
        }
    }

    async function salvarTokenIdseg() {
        const input = document.getElementById('cip-idseg-input');
        const statusEl = document.getElementById('cip-idseg-status');
        const btn = document.getElementById('cip-idseg-salvar');
        const token = input.value.replace(/\D/g, '');
        if (token.length !== 6) {
            statusEl.style.color = 'var(--p3-danger)';
            statusEl.textContent = 'Informe os 6 dígitos do código.';
            return;
        }
        btn.disabled = true;
        try {
            const r = await P3AtualizadorLocal.idsegConfigurar(token);
            if (r.ok) {
                statusEl.style.color = '#1e6b34';
                statusEl.textContent = '✅ Salvo — a 2ª fonte de foto será tentada nas próximas consultas.';
                input.value = '';
            } else {
                statusEl.style.color = 'var(--p3-danger)';
                statusEl.textContent = r.erro || 'Falha ao salvar.';
            }
        } catch (e) {
            statusEl.style.color = 'var(--p3-danger)';
            statusEl.textContent = 'Erro de conexão: ' + e.message;
        } finally {
            btn.disabled = false;
        }
    }

    // ────────────────────────────────────────────────────────────────
    // BOOT
    // ────────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', async function () {
        if (!requireP2OuAdmin()) return;

        if (!(await P3AtualizadorLocal.disponivel())) {
            document.getElementById('cip-aviso-servidor').style.display = 'block';
        }

        document.getElementById('cip-idseg-link').addEventListener('click', function () {
            const box = document.getElementById('cip-idseg-box');
            box.classList.toggle('aberto');
            if (box.classList.contains('aberto')) atualizarStatusIdseg();
        });
        document.getElementById('cip-idseg-salvar').addEventListener('click', salvarTokenIdseg);
        document.getElementById('cip-idseg-input').addEventListener('input', function (e) {
            e.target.value = e.target.value.replace(/\D/g, '');
        });

        document.getElementById('cip-btn-consultar').addEventListener('click', consultar);
        document.getElementById('cip-btn-imprimir').addEventListener('click', imprimirConsultaCompleta);
        document.getElementById('cip-input-cpf').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') consultar();
        });
        document.getElementById('cip-input-cpf').addEventListener('input', function (e) {
            e.target.value = e.target.value.replace(/[^\d.\-]/g, '');
        });
    });
})();
