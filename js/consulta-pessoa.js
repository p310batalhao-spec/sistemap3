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
// SIMPLIFICAÇÃO MANTIDA — mãe/pai em "Vínculos" (via CAD) aparecem como
// texto, não clicáveis: o CAD não devolve o CPF da mãe/pai, só o nome.
// (29/08/2026 — a busca por NOME/MÃE/PAI em si já existe agora, ver
// modo "nome" abaixo/buscarPorNome — o que falta é achar o CPF exato
// de quem aparece só como texto dentro de uma ocorrência/vínculo já
// carregado, não a busca autônoma por nome, que já funciona.)

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
                } else if (evento.tipo === 'aguardando') {
                    // Outra consulta em andamento na mesma sessão do CAD —
                    // ver CAD_LOCK em cad_alcatraz.py (nunca 2 ao mesmo
                    // tempo, senão uma atropela o contexto da outra).
                    progEtapa.textContent = '⏳ ' + (evento.mensagem || 'Aguardando outra consulta terminar...');
                    progTexto.textContent = '';
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
        alternarModoBusca('cpf');
        document.getElementById('cip-input-cpf').value = formatarCpf(cpfLimpo);
        consultar();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    window.P3ConsultaPessoaAbrirCpf = consultarPorCpf;

    // ────────────────────────────────────────────────────────────────
    // MODO DE BUSCA — CPF | Nome/Mãe/Pai | Veículo (29/08/2026, pedido
    // explícito: "faça a consulta também por NOME... igual ao CAD" e
    // "pesquisar Veículos por PLACA, RENAVAM ou CHASSI... igual ao CAD").
    // RENAVAM confirmado (via HAR real veiculos.al.gov.br.har) que NÃO
    // é aceito como critério de busca pelo CAD — só placa/chassi — por
    // isso não tem campo de RENAVAM aqui (só apareceria no resultado).
    // ────────────────────────────────────────────────────────────────
    function alternarModoBusca(modo) {
        document.querySelectorAll('.cip-modo-btn').forEach(b => b.classList.toggle('cip-modo-ativo', b.dataset.modo === modo));
        document.getElementById('cip-busca-cpf').style.display = modo === 'cpf' ? 'flex' : 'none';
        document.getElementById('cip-busca-nome').style.display = modo === 'nome' ? 'flex' : 'none';
        document.getElementById('cip-busca-veiculo').style.display = modo === 'veiculo' ? 'flex' : 'none';
        document.getElementById('cip-lista-nome').style.display = 'none';
        document.getElementById('cip-resultado-veiculo').style.display = 'none';
        document.getElementById('cip-status-msg').textContent = '';
    }

    async function buscarPorNome() {
        const nome = document.getElementById('cip-input-nome').value.trim();
        const mae = document.getElementById('cip-input-mae').value.trim();
        const pai = document.getElementById('cip-input-pai').value.trim();
        const msg = document.getElementById('cip-status-msg');
        const lista = document.getElementById('cip-lista-nome');

        if (!nome && !mae && !pai) {
            msg.style.color = 'var(--p3-danger)';
            msg.textContent = 'Informe ao menos o nome, o nome da mãe ou o nome do pai.';
            return;
        }
        if (!(await P3AtualizadorLocal.disponivel())) {
            document.getElementById('cip-aviso-servidor').style.display = 'block';
            return;
        }
        document.getElementById('cip-aviso-servidor').style.display = 'none';
        lista.style.display = 'none';
        msg.style.color = 'var(--p3-text-muted)';
        msg.textContent = 'Buscando...';

        try {
            const r = await P3AtualizadorLocal.buscarPessoaPorNome(nome, mae, pai);
            if (!r.ok) {
                msg.style.color = 'var(--p3-danger)';
                msg.textContent = 'Erro: ' + (r.erro || 'falha desconhecida.');
                return;
            }
            const pessoas = r.pessoas || [];
            if (pessoas.length === 0) {
                msg.style.color = 'var(--p3-text-muted)';
                msg.textContent = 'Nenhuma pessoa encontrada com esses critérios.';
                return;
            }
            msg.style.color = '#1e6b34';
            msg.textContent = `${pessoas.length} pessoa(s) encontrada(s) — clique numa pra abrir a consulta completa por CPF.`;
            lista.innerHTML = pessoas.map((p, i) => {
                const cpfLimpo = limparCpf(p.cpf);
                const detalhes = [
                    cpfLimpo ? 'CPF: ' + formatarCpf(cpfLimpo) : 'CPF não informado no CAD',
                    p.dataNascimento ? 'Nasc.: ' + p.dataNascimento : '',
                    p.mae ? 'Mãe: ' + p.mae : '',
                    p.pai ? 'Pai: ' + p.pai : '',
                ].filter(Boolean).join(' · ');
                return `<div class="cip-lista-resultado-item" data-idx="${i}">
                    <b>${esc(p.nome || 'Sem nome')}</b>
                    <span>${esc(detalhes)}</span>
                </div>`;
            }).join('');
            lista.style.display = 'block';
            lista.querySelectorAll('.cip-lista-resultado-item').forEach(item => {
                item.addEventListener('click', () => {
                    const p = pessoas[Number(item.dataset.idx)];
                    const cpfLimpo = limparCpf(p.cpf);
                    if (!cpfLimpo) {
                        msg.style.color = 'var(--p3-danger)';
                        msg.textContent = 'Essa pessoa não tem CPF cadastrado no CAD — não é possível abrir a consulta completa.';
                        return;
                    }
                    consultarPorCpf(cpfLimpo);
                });
            });
        } catch (e) {
            msg.style.color = 'var(--p3-danger)';
            msg.textContent = 'Erro: ' + e.message;
        }
    }

    async function buscarVeiculoAcao() {
        const placa = document.getElementById('cip-input-placa').value.trim();
        const chassi = document.getElementById('cip-input-chassi').value.trim();
        const msg = document.getElementById('cip-status-msg');
        const resultado = document.getElementById('cip-resultado-veiculo');

        if (!placa && !chassi) {
            msg.style.color = 'var(--p3-danger)';
            msg.textContent = 'Informe a placa ou o chassi (o CAD não aceita busca de veículo por RENAVAM).';
            return;
        }
        if (!(await P3AtualizadorLocal.disponivel())) {
            document.getElementById('cip-aviso-servidor').style.display = 'block';
            return;
        }
        document.getElementById('cip-aviso-servidor').style.display = 'none';
        resultado.style.display = 'none';
        msg.style.color = 'var(--p3-text-muted)';
        msg.textContent = 'Buscando...';

        try {
            const r = await P3AtualizadorLocal.buscarVeiculo(placa, chassi);
            if (!r.ok) {
                msg.style.color = 'var(--p3-danger)';
                msg.textContent = 'Erro: ' + (r.erro || 'falha desconhecida.');
                return;
            }
            if (!r.encontrado) {
                msg.style.color = 'var(--p3-text-muted)';
                msg.textContent = 'Nenhum veículo encontrado com esses critérios.';
                return;
            }
            msg.style.color = '#1e6b34';
            msg.textContent = 'Veículo encontrado.';
            const v = r.veiculo || {};
            resultado.innerHTML = `<div class="cip-lista-resultado-item" style="cursor:default;">` +
                Object.entries(v).map(([k, val]) => `<div><b>${esc(k)}:</b> ${esc(val)}</div>`).join('') +
                `</div>`;
            resultado.style.display = 'block';
        } catch (e) {
            msg.style.color = 'var(--p3-danger)';
            msg.textContent = 'Erro: ' + e.message;
        }
    }

    // ────────────────────────────────────────────────────────────────
    // CABEÇALHO DA PESSOA
    // ────────────────────────────────────────────────────────────────
    // ────────────────────────────────────────────────────────────────
    // GALERIA DE FOTOS + LIGHTBOX — mostra TODAS as fotos encontradas
    // (não só a 1ª), cada uma clicável pra ampliar. Reaproveitada no
    // cabeçalho e na Visão Geral (mesmo HTML, tamanhos diferentes).
    // ────────────────────────────────────────────────────────────────
    function montarGaleriaFotosHtml(fotos, tamanhoPx) {
        if (!fotos || !fotos.length) {
            const fs = Math.round(tamanhoPx * 0.37);
            return `<div class="cip-foto-thumb" style="width:${tamanhoPx}px;height:${tamanhoPx}px;display:flex;align-items:center;justify-content:center;font-size:${fs}px;opacity:.4;cursor:default;">👤</div>`;
        }
        return fotos.map((f, i) => `<div class="cip-foto-thumb" style="width:${tamanhoPx}px;height:${tamanhoPx}px;" onclick="P3ConsultaPessoaAbrirFoto(${i})"><img src="${f}" alt="Foto ${i + 1}"></div>`).join('');
    }

    let LIGHTBOX_INDICE = 0;
    function atualizarLightbox() {
        const fotos = (ULTIMO_RESULTADO && ULTIMO_RESULTADO.fotos) || [];
        if (!fotos.length) return;
        document.getElementById('cip-lightbox-img').src = fotos[LIGHTBOX_INDICE];
        document.getElementById('cip-lightbox-contador').textContent = fotos.length > 1 ? `${LIGHTBOX_INDICE + 1} / ${fotos.length}` : '';
        const mostraNav = fotos.length > 1 ? 'flex' : 'none';
        document.getElementById('cip-lightbox-prev').style.display = mostraNav;
        document.getElementById('cip-lightbox-next').style.display = mostraNav;
    }
    function abrirLightbox(idx) {
        const fotos = (ULTIMO_RESULTADO && ULTIMO_RESULTADO.fotos) || [];
        if (!fotos.length) return;
        LIGHTBOX_INDICE = ((idx % fotos.length) + fotos.length) % fotos.length;
        atualizarLightbox();
        document.getElementById('cip-lightbox').classList.add('aberto');
    }
    function fecharLightbox() {
        document.getElementById('cip-lightbox').classList.remove('aberto');
    }
    function navegarLightbox(delta) {
        const fotos = (ULTIMO_RESULTADO && ULTIMO_RESULTADO.fotos) || [];
        if (!fotos.length) return;
        LIGHTBOX_INDICE = ((LIGHTBOX_INDICE + delta) % fotos.length + fotos.length) % fotos.length;
        atualizarLightbox();
    }
    document.addEventListener('keydown', function (e) {
        const lb = document.getElementById('cip-lightbox');
        if (!lb || !lb.classList.contains('aberto')) return;
        if (e.key === 'Escape') fecharLightbox();
        else if (e.key === 'ArrowLeft') navegarLightbox(-1);
        else if (e.key === 'ArrowRight') navegarLightbox(1);
    });
    window.P3ConsultaPessoaAbrirFoto = abrirLightbox;
    window.P3ConsultaPessoaFecharLightbox = fecharLightbox;
    window.P3ConsultaPessoaNavegarLightbox = navegarLightbox;

    function renderizarHeader(r) {
        const p = r.pessoa;
        const el = document.getElementById('cip-header-pessoa');
        if (!p) { el.classList.remove('visivel'); return; }
        el.classList.add('visivel');
        document.getElementById('cip-header-nome').textContent = p.nome || '(sem nome)';

        // Cabeçalho mostra só a foto PRINCIPAL (1ª — Quimera se achou,
        // senão Alcatraz, ver _etapa_foto_idseg no Python) — a galeria
        // com TODAS as fotos das duas fontes fica só na Visão Geral (ver
        // renderVisaoGeral), pedido explícito do usuário. Clicar ainda
        // abre o lightbox, que navega por todas (ULTIMO_RESULTADO.fotos
        // inteiro, não só a que aparece aqui).
        document.getElementById('cip-header-foto').innerHTML = montarGaleriaFotosHtml((r.fotos || []).slice(0, 1), 140);

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
        { id: 'vinculos', label: '👪 Vínculos', contar: r => ((r.pessoa && (r.pessoa.mae || r.pessoa.pai)) ? 1 : 0) + (r.vinculosOcorrencia || []).length + ((r.inteligencia && r.inteligencia.vinculos) || []).length },
        { id: 'enderecos', label: '📍 Endereços', contar: r => montarEnderecos(r).length },
        { id: 'ocorrencias', label: '🚓 Ocorrências', contar: r => (r.ocorrenciasPpe || []).length + (r.ocorrenciasPcAntigo || []).length + (r.ocorrenciasDespacho || []).length },
        { id: 'mandados', label: '⛓️ BNMP', contar: r => (r.mandados && r.mandados.possuiMandado) ? 1 : 0 },
        { id: 'processos', label: '⚖️ Processos', contar: r => (r.processos || []).length },
        { id: 'veiculos', label: '🚗 Veículos', contar: r => (r.veiculos || []).length },
        { id: 'inteligencia', label: '🕵️ Inteligência', contar: r => r.inteligencia ? 1 : 0 },
        { id: 'relint', label: '📋 RELINT', contar: r => ((r.inteligencia && r.inteligencia.relint) || []).length },
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
            processos: renderProcessos, veiculos: renderVeiculos, inteligencia: renderInteligencia,
            relint: renderRelint, timeline: renderTimeline, fontes: renderFontes,
        };
        paineisEl.innerHTML = `<div class="cip-painel ativo">${(renderers[ABA_ATIVA] || (() => ''))(r)}</div>`;
        // Religa os cliques de detalhe/expand depois de re-renderizar (o innerHTML acima apaga listeners antigos).
        ligarEventosPainelAtivo(r);
        if (ABA_ATIVA === 'ocorrencias') inicializarMapaOcorrencias(r);
    }

    // ────────────────────────────────────────────────────────────────
    // VISÃO GERAL
    // ────────────────────────────────────────────────────────────────
    function renderVisaoGeral(r) {
        const p = r.pessoa || {};
        const totalOcor = (r.ocorrenciasPpe || []).length + (r.ocorrenciasPcAntigo || []).length + (r.ocorrenciasDespacho || []).length;

        // Foto(s) + nome completo (pedido explícito do usuário) — TODAS
        // as fotos encontradas (não só a 1ª), cada uma clicável pra
        // ampliar (ver montarGaleriaFotosHtml/lightbox); sem foto
        // nenhuma, fica um espaço reservado em vez de não mostrar nada.
        let h = '<div class="cip-card" style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;">';
        h += `<div style="display:flex;gap:8px;flex-wrap:wrap;max-width:460px;">${montarGaleriaFotosHtml(r.fotos, 140)}</div>`;
        h += `<div><div style="font-size:17px;font-weight:700;color:var(--p3-text);">${esc(p.nome || '(nome não encontrado)')}</div>
              <div style="font-size:12px;color:var(--p3-text-muted);margin-top:3px;">CPF ${esc(formatarCpf(r.cpf))}${p.dataNascimento ? ' · Nascimento ' + esc(p.dataNascimento) : ''}</div>
              ${r.fotos && r.fotos.length > 1 ? `<div style="font-size:11px;color:var(--p3-text-muted);margin-top:6px;">${r.fotos.length} fotos encontradas — clique pra ampliar</div>` : ''}</div>`;
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

    // Diagrama de rede simples (SVG puro, sem biblioteca externa) —
    // pessoa consultada no centro, vínculos cadastrados no Supabase ao
    // redor, ligados por linha com o tipo do vínculo. Pedido explícito
    // do usuário (29/08/2026): "vínculos... em modelo de rede ou árvore".
    function primeiroNome(nomeCompleto) {
        return String(nomeCompleto || '').trim().split(/\s+/)[0] || '?';
    }
    function montarRedeVinculosHtml(nomeCentral, vinculos) {
        if (!vinculos || !vinculos.length) return '';
        const n = vinculos.length;
        const W = 640, H = Math.max(320, 130 + n * 40);
        const cx = W / 2, cy = H / 2;
        const R = Math.min(W, H) / 2 - 90;
        let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;max-height:520px;display:block;" xmlns="http://www.w3.org/2000/svg">`;
        vinculos.forEach((v, i) => {
            const ang = (2 * Math.PI * i) / n - Math.PI / 2;
            const x = cx + R * Math.cos(ang), y = cy + R * Math.sin(ang);
            const mx = cx + (R * 0.55) * Math.cos(ang), my = cy + (R * 0.55) * Math.sin(ang);
            svg += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="var(--p3-border)" stroke-width="1.5" />`;
            svg += `<rect x="${mx - 36}" y="${my - 9}" width="72" height="18" rx="9" fill="var(--p3-bg)" />`;
            svg += `<text x="${mx}" y="${my + 4}" text-anchor="middle" font-size="9" fill="var(--p3-text-muted)">${esc((v.tipo || 'vínculo').slice(0, 14))}</text>`;
        });
        svg += `<circle cx="${cx}" cy="${cy}" r="34" fill="var(--p3-blue-700)" /><text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">${esc(primeiroNome(nomeCentral))}</text>`;
        vinculos.forEach((v, i) => {
            const ang = (2 * Math.PI * i) / n - Math.PI / 2;
            const x = cx + R * Math.cos(ang), y = cy + R * Math.sin(ang);
            const clicavel = !!v.cpf;
            svg += `<g style="cursor:${clicavel ? 'pointer' : 'default'};" ${clicavel ? `onclick="P3ConsultaPessoaAbrirCpf('${v.cpf}')"` : ''}>
                <title>${esc(v.nome)}${v.cpf ? ' — ' + esc(formatarCpf(v.cpf)) : ''}</title>
                <circle cx="${x}" cy="${y}" r="26" fill="${clicavel ? 'var(--p3-surface)' : 'var(--p3-bg)'}" stroke="var(--p3-border)" stroke-width="1.5" />
                <text x="${x}" y="${y + 4}" text-anchor="middle" font-size="9" fill="var(--p3-text)">${esc(primeiroNome(v.nome).slice(0, 10))}</text>
            </g>`;
        });
        svg += '</svg>';
        return svg;
    }

    // ────────────────────────────────────────────────────────────────
    // VÍNCULOS — filiação (mãe/pai, ver nota de simplificação no topo do
    // arquivo — sem CPF, não clicável) + vínculos por OCORRÊNCIA (outras
    // pessoas na(s) mesma(s) ocorrência(s), com CPF — essas sim
    // clicáveis, ver P3ConsultaPessoaAbrirCpf) + vínculos CADASTRADOS no
    // Supabase (rede/árvore, ver montarRedeVinculosHtml).
    // ────────────────────────────────────────────────────────────────
    function renderVinculos(r) {
        const p = r.pessoa;
        const vinculosOc = r.vinculosOcorrencia || [];
        let h = '';

        if (p && (p.mae || p.pai)) {
            h += '<div class="cip-card"><div class="cip-card-titulo">Filiação</div><div class="cip-kv">';
            if (p.mae) h += `<div><b>Mãe:</b> ${esc(p.mae)}</div>`;
            if (p.pai) h += `<div><b>Pai:</b> ${esc(p.pai)}</div>`;
            h += '</div><p style="font-size:11.5px;color:var(--p3-text-muted);margin-top:10px;">O CPF da mãe/pai não está disponível — pra consultar essa pessoa, é preciso pesquisar o CPF dela diretamente, se conhecido.</p></div>';
        }

        if (vinculosOc.length) {
            h += `<div class="cip-card"><div class="cip-card-titulo">Vínculos por ocorrência — ${vinculosOc.length}</div>
                <p style="font-size:11.5px;color:var(--p3-text-muted);margin-bottom:10px;">
                    Pessoas que apareceram na(s) mesma(s) ocorrência(s) que esta — linhas com CPF são clicáveis pra
                    consultar a pessoa diretamente. Só cobre as ocorrências que já tiveram o detalhe carregado
                    automaticamente (as mais recentes).
                </p>`;
            h += '<div class="cip-tabela-wrap"><table class="cip-tabela"><thead><tr><th>Nome</th><th>Envolvimento</th><th>Nº Ocorrência</th><th>Data</th><th>Tipificação</th></tr></thead><tbody>';
            vinculosOc.forEach(v => {
                const clicavel = !!v.cpf;
                h += `<tr ${clicavel ? `onclick="P3ConsultaPessoaAbrirCpf('${v.cpf}')" title="Clique pra consultar essa pessoa"` : 'style="cursor:default;" title="CPF não disponível"'}>
                    <td>${clicavel ? `<span class="cip-pessoa-link">${esc(v.nome)}</span>` : esc(v.nome)}</td>
                    <td>${esc(v.tipoEnvolvimento || '—')}</td>
                    <td>${esc(v.numeroOcorrencia || '—')}</td>
                    <td style="white-space:nowrap;">${esc(v.data || '—')}</td>
                    <td>${esc(v.tipificacao || '—')}</td>
                </tr>`;
            });
            h += '</tbody></table></div></div>';
        }

        const vinculosSb = (r.inteligencia && r.inteligencia.vinculos) || [];
        if (vinculosSb.length) {
            h += `<div class="cip-card"><div class="cip-card-titulo">Vínculos cadastrados — ${vinculosSb.length}</div>
                <p style="font-size:11.5px;color:var(--p3-text-muted);margin-bottom:10px;">
                    Já investigados e registrados pela própria unidade — clique num nome com CPF pra consultar essa
                    pessoa.
                </p>
                ${montarRedeVinculosHtml((r.pessoa && r.pessoa.nome) || esc(formatarCpf(r.cpf)), vinculosSb)}
            </div>`;
        }

        if (!h) return '<div class="cip-vazio">Nenhum vínculo encontrado.</div>';
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
    // MAPA DAS OCORRÊNCIAS — Leaflet + OpenStreetMap (mesma biblioteca
    // já usada em page/mapaInteligencia.html — grátis, sem chave de
    // API). Coordenadas vêm do detalhe já carregado automaticamente
    // (r.detalhesOcorrencias[i].campos — "Latitude"/"Longitude", com
    // fallback pras coordenadas "...pelo Quimera" quando as
    // principais vêm vazias, confirmado em captura real).
    // ────────────────────────────────────────────────────────────────
    function _parseCoordBr(s) {
        const n = parseFloat(String(s || '').replace(',', '.').trim());
        return isFinite(n) && n !== 0 ? n : null;
    }
    function extrairCoordenadasOcorrencias(r) {
        const despc = r.ocorrenciasDespacho || [];
        const detalhesPorId = {};
        (r.detalhesOcorrencias || []).forEach(d => { detalhesPorId[d.idOcorrencia] = d; });
        const pontos = [];
        despc.forEach(o => {
            const det = detalhesPorId[o._id_ocor];
            if (!det || !det.campos) return;
            const c = det.campos;
            const lat = _parseCoordBr(c['Latitude']) || _parseCoordBr(c['Latitude pelo Quimera']);
            const lng = _parseCoordBr(c['Longitude']) || _parseCoordBr(c['Longitude pelo Quimera']);
            if (lat === null || lng === null) return;
            pontos.push({
                lat, lng,
                numero: o.id_ocor_fk || o._id_ocor || '—',
                natureza: o.ds_ocor_sgrup || '—',
                data: o.dt_ocor || '—',
            });
        });
        return pontos;
    }

    let _mapaOcorrenciasCarregando = null;
    function carregarLeafletSeNecessario(callback) {
        if (window.L) { callback(); return; }
        if (_mapaOcorrenciasCarregando) { _mapaOcorrenciasCarregando.then(callback); return; }
        _mapaOcorrenciasCarregando = new Promise(resolve => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
            document.head.appendChild(link);
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
            script.onload = resolve;
            document.head.appendChild(script);
        });
        _mapaOcorrenciasCarregando.then(callback);
    }
    function inicializarMapaOcorrencias(r) {
        const container = document.getElementById('cip-mapa-ocorrencias');
        if (!container) return;
        const pontos = extrairCoordenadasOcorrencias(r);
        if (!pontos.length) return;
        carregarLeafletSeNecessario(() => {
            // A aba pode ter mudado enquanto o Leaflet carregava — confere de novo.
            if (!document.getElementById('cip-mapa-ocorrencias')) return;
            const mapa = L.map('cip-mapa-ocorrencias').setView([pontos[0].lat, pontos[0].lng], 12);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap',
            }).addTo(mapa);
            const grupo = [];
            pontos.forEach(p => {
                const marcador = L.marker([p.lat, p.lng]).addTo(mapa);
                marcador.bindPopup(`<b>${esc(p.numero)}</b><br>${esc(p.natureza)}<br><span style="color:#888;font-size:11px;">${esc(p.data)}</span>`);
                grupo.push(marcador);
            });
            if (grupo.length > 1) mapa.fitBounds(L.featureGroup(grupo).getBounds().pad(0.2));
        });
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
        const pontosMapa = extrairCoordenadasOcorrencias(r);
        if (pontosMapa.length) {
            h += `<div class="cip-card"><div class="cip-card-titulo">Mapa das ocorrências — ${pontosMapa.length} com localização</div>
                <div id="cip-mapa-ocorrencias" style="height:320px;border-radius:10px;"></div></div>`;
        }
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
        document.querySelectorAll('.cip-linha-relint').forEach(tr => {
            tr.addEventListener('click', () => {
                const i = Number(tr.dataset.idx);
                const detalheEl = document.getElementById('cip-det-relint-' + i);
                if (!detalheEl) return;
                const aberto = detalheEl.classList.contains('visivel');
                document.querySelectorAll('.cip-detalhe-linha.visivel').forEach(d => d.classList.remove('visivel'));
                if (aberto) return;
                detalheEl.classList.add('visivel');
                const rel = ((r.inteligencia && r.inteligencia.relint) || [])[i];
                detalheEl.querySelector('td').innerHTML = rel ? montarCamposDetalheRelint(rel) : '';
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
    // INTELIGÊNCIA — apelidos e observações já cadastrados pela própria
    // unidade no Supabase (ver supabase_intel.py). Vínculos cadastrados
    // ficam na aba Vínculos (rede/árvore, ver montarRedeVinculosHtml) —
    // aqui só o que é específico da pessoa: apelido(s) e texto livre.
    // ────────────────────────────────────────────────────────────────
    function renderInteligencia(r) {
        const inteligencia = r.inteligencia;
        if (!inteligencia) {
            return '<div class="cip-vazio">Nenhum registro de inteligência cadastrado pra este CPF.</div>';
        }
        let h = '<div class="cip-card"><div class="cip-card-titulo">Informações de Inteligência</div>';
        if (inteligencia.apelidos && inteligencia.apelidos.length) {
            h += `<div style="margin-bottom:10px;"><b>Apelido(s):</b> ${esc(inteligencia.apelidos.join(', '))}</div>`;
        }
        if (inteligencia.observacao) {
            h += `<div style="font-size:13px;color:var(--p3-text);white-space:pre-wrap;">${esc(inteligencia.observacao)}</div>`;
        } else if (!inteligencia.apelidos || !inteligencia.apelidos.length) {
            h += '<div style="font-size:12.5px;color:var(--p3-text-muted);">Pessoa cadastrada, mas sem apelido nem observação registrados.</div>';
        }
        h += `<div style="font-size:11px;color:var(--p3-text-muted);margin-top:10px;">Vínculos cadastrados desta pessoa ficam na aba <b>Vínculos</b> — relatórios de inteligência (RELINT), na aba <b>RELINT</b>.</div>`;
        h += '</div>';
        return h;
    }

    // ────────────────────────────────────────────────────────────────
    // RELINT — Relatórios de Inteligência cadastrados no Supabase que
    // têm esta pessoa como envolvida (ver tb_relatorio_busca_pessoas /
    // vw_relatorios_busca_detalhe em supabase_intel.py). Pedido
    // explícito do usuário (29/08/2026): "Se houver relint... deve
    // estar em uma aba separada, de forma clicável para ver os
    // detalhes" — os dados já vêm todos na consulta (sem chamada extra
    // ao clicar), então o clique só expande/recolhe o detalhe já em
    // memória (mesmo componente visual — cip-detalhe-linha — das
    // ocorrências, mas sem "Carregando...").
    // ────────────────────────────────────────────────────────────────
    function montarCamposDetalheRelint(rel) {
        return montarHtmlDetalheCampos({
            'Nº da Ordem de Busca vinculada': rel.ordemNumero,
            'Assunto (Ordem de Busca)': rel.ordemAssunto,
            'Cidade': rel.cidade,
            'Nº Denúncia 181': rel.numeroDenuncia181,
            'Redes sociais': rel.redesSociais,
            'Câmeras no local': rel.camerasLocal ? 'Sim' : (rel.camerasLocal === false ? 'Não' : null),
            'Observação do vínculo': rel.observacaoVinculo,
            'Informações complementares': rel.informacoesComplementares,
        });
    }
    function renderRelint(r) {
        const lista = (r.inteligencia && r.inteligencia.relint) || [];
        if (!lista.length) return '<div class="cip-vazio">Nenhum relatório de inteligência (RELINT) cadastrado pra este CPF.</div>';
        let h = `<div class="cip-card"><div class="cip-card-titulo">Relatórios de Inteligência (RELINT) — ${lista.length}</div>
            <p style="font-size:11.5px;color:var(--p3-text-muted);margin-bottom:10px;">Clique num relatório pra ver os detalhes completos.</p>`;
        h += '<div class="cip-tabela-wrap"><table class="cip-tabela"><thead><tr><th>Nº</th><th>Data</th><th>Assunto</th><th>Papel</th><th>Equipe</th><th>Status</th></tr></thead><tbody>';
        lista.forEach((rel, i) => {
            h += `<tr class="cip-linha-relint" data-idx="${i}" title="Clique pra ver os detalhes">
                <td><b>${esc(rel.numero || '—')}</b></td>
                <td style="white-space:nowrap;">${esc(rel.dataHora ? new Date(rel.dataHora).toLocaleDateString('pt-BR') : '—')}</td>
                <td>${esc(rel.assunto || '—')}</td>
                <td>${esc(rel.papel || '—')}</td>
                <td>${esc(rel.equipeResponsavel || '—')}</td>
                <td>${esc(rel.status || '—')}</td>
            </tr><tr class="cip-detalhe-linha" id="cip-det-relint-${i}"><td colspan="6"></td></tr>`;
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

    // Versão pra impressão do RELINT — o detalhe fica sempre ABERTO (no
    // papel não existe clique), mesmo espírito de renderOcorrenciasParaImpressao.
    function renderRelintParaImpressao(r) {
        const lista = (r.inteligencia && r.inteligencia.relint) || [];
        if (!lista.length) return '<div class="cip-vazio">Nenhum relatório de inteligência (RELINT) cadastrado pra este CPF.</div>';
        let h = `<div class="cip-card"><div class="cip-card-titulo">Relatórios de Inteligência (RELINT) — ${lista.length}</div>`;
        lista.forEach((rel, i) => {
            h += `<div style="padding:10px 0;${i > 0 ? 'border-top:1px dashed var(--p3-border);' : ''}">
                <div style="font-size:12.5px;"><b>${esc(rel.numero || '—')}</b> — ${esc(rel.dataHora ? new Date(rel.dataHora).toLocaleDateString('pt-BR') : '—')}</div>
                <div style="font-size:12px;color:var(--p3-text);margin-top:2px;">${esc(rel.assunto || '—')}</div>
                <div style="font-size:11px;color:var(--p3-text-muted);margin-top:2px;">Papel: ${esc(rel.papel || '—')} · Equipe: ${esc(rel.equipeResponsavel || '—')} · Status: ${esc(rel.status || '—')}</div>
                ${montarCamposDetalheRelint(rel)}
            </div>`;
        });
        h += '</div>';
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
        html += _cipMontarSecao(n++, 'Informações de Inteligência', renderInteligencia(r));
        html += _cipMontarSecao(n++, 'RELINT', renderRelintParaImpressao(r));
        html += _cipMontarSecao(n++, 'Linha do Tempo', renderTimeline(r));

        html += `<div class="cpp-rodape">
            <div><strong>Sistema P3</strong> — 10º Batalhão de Polícia Militar<br>Seção de Planejamento, Ensino e Instrução — P3/10ºBPM</div>
            <div style="text-align:right;">Consulta realizada em ${esc(r.consultadoEm)}</div>
        </div>`;

        raiz.innerHTML = html;
        window.print();
    }

    // ────────────────────────────────────────────────────────────────
    // MODAL DE CONFIGURAÇÃO — CAD (login/senha/token) + 2ª fonte de
    // foto (token do Quimera, ver idseg_quimera.py), tudo numa tela só
    // (pedido explícito do usuário — antes precisava ir noutra página
    // pro CAD). Salva os dois de uma vez: /cad/configurar (login/senha/
    // token) e, só se o campo do Quimera vier preenchido,
    // /cad/idseg-configurar (campo vazio = "não mexe no que já tá
    // salvo" — evita forçar redigitar toda vez que só quer renovar o
    // token do CAD, ou vice-versa).
    // ────────────────────────────────────────────────────────────────
    async function abrirModalConfig() {
        document.getElementById('cip-modal-config').classList.add('aberto');
        document.getElementById('cip-mc-senha').value = '';
        document.getElementById('cip-mc-token-cad').value = '';
        document.getElementById('cip-mc-token-quimera').value = '';
        const msgEl = document.getElementById('cip-mc-msg');
        msgEl.textContent = 'Carregando status atual...';
        msgEl.style.color = 'var(--p3-text-muted)';
        try {
            const [statusCad, statusIdseg] = await Promise.all([
                P3AtualizadorLocal.statusCad(), P3AtualizadorLocal.idsegStatus(),
            ]);
            document.getElementById('cip-mc-login').value = statusCad.login || '';
            const partes = [];
            partes.push('CAD: ' + (statusCad.configurado ? '✅ configurado' : '⛔ não configurado'));
            partes.push('2ª fonte de foto: ' + (statusIdseg.configurado ? '✅ configurada' : '➖ não configurada'));
            msgEl.style.color = 'var(--p3-text-muted)';
            msgEl.textContent = partes.join(' · ');
        } catch (e) {
            msgEl.style.color = 'var(--p3-danger)';
            msgEl.textContent = 'Servidor local não respondeu — abra-o pra configurar.';
        }
    }
    function fecharModalConfig() {
        document.getElementById('cip-modal-config').classList.remove('aberto');
    }

    async function salvarModalConfig() {
        const login = document.getElementById('cip-mc-login').value.trim();
        const senha = document.getElementById('cip-mc-senha').value;
        const tokenCad = document.getElementById('cip-mc-token-cad').value.trim();
        const tokenQuimera = document.getElementById('cip-mc-token-quimera').value.trim();
        const msgEl = document.getElementById('cip-mc-msg');
        const btn = document.getElementById('cip-mc-salvar-btn');

        if (!login || login.length < 11) { msgEl.style.color = 'var(--p3-danger)'; msgEl.textContent = 'Informe o CPF de acesso ao CAD (11 dígitos).'; return; }
        if (!tokenCad) { msgEl.style.color = 'var(--p3-danger)'; msgEl.textContent = 'Informe o token de acesso ao CAD.'; return; }

        btn.disabled = true;
        const resultados = [];
        try {
            msgEl.style.color = 'var(--p3-text-muted)';
            msgEl.textContent = 'Salvando login do CAD...';
            const rCad = await P3AtualizadorLocal.configurarCad(login, senha, tokenCad);
            resultados.push('CAD: ' + (rCad.ok ? '✅ ok' : '❌ ' + (rCad.erro || 'falhou')));

            if (tokenQuimera) {
                if (!/^\d{6}$/.test(tokenQuimera)) {
                    resultados.push('2ª fonte de foto: ❌ código precisa ter 6 dígitos');
                } else {
                    msgEl.textContent = 'Salvando token da 2ª fonte de foto...';
                    const rIdseg = await P3AtualizadorLocal.idsegConfigurar(tokenQuimera);
                    resultados.push('2ª fonte de foto: ' + (rIdseg.ok ? '✅ ok' : '❌ ' + (rIdseg.erro || 'falhou')));
                }
            }

            const algumFalhou = resultados.some(r => r.includes('❌'));
            msgEl.style.color = algumFalhou ? 'var(--p3-danger)' : '#1e6b34';
            msgEl.textContent = resultados.join(' · ');
            document.getElementById('cip-mc-senha').value = '';
            if (!algumFalhou) setTimeout(fecharModalConfig, 2000);
        } catch (e) {
            msgEl.style.color = 'var(--p3-danger)';
            msgEl.textContent = 'Erro de conexão: ' + e.message;
        } finally {
            btn.disabled = false;
        }
    }
    window.P3ConsultaPessoaFecharModalConfig = fecharModalConfig;

    // ────────────────────────────────────────────────────────────────
    // BOOT
    // ────────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', async function () {
        if (!requireP2OuAdmin()) return;

        if (!(await P3AtualizadorLocal.disponivel())) {
            document.getElementById('cip-aviso-servidor').style.display = 'block';
        }

        document.getElementById('cip-config-link').addEventListener('click', abrirModalConfig);
        document.getElementById('cip-mc-salvar-btn').addEventListener('click', salvarModalConfig);

        document.getElementById('cip-btn-consultar').addEventListener('click', consultar);
        document.getElementById('cip-btn-imprimir').addEventListener('click', imprimirConsultaCompleta);
        document.getElementById('cip-input-cpf').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') consultar();
        });
        document.getElementById('cip-input-cpf').addEventListener('input', function (e) {
            e.target.value = e.target.value.replace(/[^\d.\-]/g, '');
        });

        document.querySelectorAll('.cip-modo-btn').forEach(function (b) {
            b.addEventListener('click', () => alternarModoBusca(b.dataset.modo));
        });

        document.getElementById('cip-btn-buscar-nome').addEventListener('click', buscarPorNome);
        ['cip-input-nome', 'cip-input-mae', 'cip-input-pai'].forEach(function (id) {
            document.getElementById(id).addEventListener('keydown', function (e) {
                if (e.key === 'Enter') buscarPorNome();
            });
        });

        document.getElementById('cip-btn-buscar-veiculo').addEventListener('click', buscarVeiculoAcao);
        ['cip-input-placa', 'cip-input-chassi'].forEach(function (id) {
            document.getElementById(id).addEventListener('keydown', function (e) {
                if (e.key === 'Enter') buscarVeiculoAcao();
            });
        });
    });
})();
