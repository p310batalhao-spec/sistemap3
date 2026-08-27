// ====================================================================
// Sistema P3 — Modal de mudanças de movimentação (e-SAJ/DataJud)
// ====================================================================
// Usado por js/autores.js e js/suspeitos.js depois de um "Verificar
// agora" pelo servidor local (tools/atualizador-local/) — mostra, numa
// janela só, TODAS as pessoas cuja movimentação mudou de verdade nessa
// checagem (comparado com o que já estava salvo antes — ver
// sync_movimentacoes.py, campo `mudanca`). Injeta o próprio HTML/CSS na
// primeira vez que é usado (não precisa editar autores.html à mão),
// mesmo espírito de js/core/header-nav.js.
//
// Também é reaproveitado pelo botão "🕓 Ver última atualização" (ver
// js/autores.js/js/suspeitos.js) — quem persiste em localStorage e
// decide QUANDO chamar exibir() é cada um desses arquivos; este módulo
// só sabe desenhar o que recebe.
//
// IMPRESSÃO — mesmo padrão visual de relatorios/relatorio_preditiva.html
// (capa com gradiente azul-marinho + brasão, cartão de seção com selo
// numerado, paleta #0a1f4d/#0a448f/#f4f6fb) — pra ficar no mesmo estilo
// dos outros relatórios do sistema, em vez do papel timbrado formal
// (Times New Roman) usado nos termos/. Caminho da imagem
// (`../img/brasao.png`) assume que este modal só roda em páginas dentro
// de `page/` (hoje só page/autores.html) — se um dia for reaproveitado
// fora de `page/`, ajustar o caminho.
(function (global) {
    'use strict';
    if (global.P3ModalMudancas) return;

    const CAMINHO_BRASAO = '../img/brasao.png';

    const ESTILO = `
        #modal-mudancas-movimentacao {
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(10, 14, 20, .5);
            z-index: 9999;
            align-items: center;
            justify-content: center;
            padding: 1rem;
        }
        #modal-mudancas-movimentacao.aberto { display: flex; }
        .mmm-box {
            background: var(--p3-surface, #fff);
            color: var(--p3-text, #1c1c1a);
            border-radius: var(--p3-radius-lg, .625rem);
            width: min(42rem, 100%);
            max-height: 85vh;
            display: flex;
            flex-direction: column;
            box-shadow: var(--p3-shadow-lg, 0 .5rem 2rem rgba(0,0,0,.3));
        }
        .mmm-head {
            display: flex; justify-content: space-between; align-items: flex-start; gap: .75rem;
            padding: .875rem 1rem;
            background: var(--p3-blue-700, #2f5fdd);
            color: #fff;
            border-radius: var(--p3-radius-lg, .625rem) var(--p3-radius-lg, .625rem) 0 0;
        }
        .mmm-head-textos { min-width: 0; }
        .mmm-head-titulo { font-weight: 700; }
        .mmm-head-quando { font-size: .75rem; opacity: .85; margin-top: .125rem; }
        .mmm-head-botoes { display: flex; gap: .25rem; flex: 0 0 auto; }
        .mmm-head button {
            background: none; border: none; color: rgba(255,255,255,.85);
            font-size: 1.1rem; cursor: pointer; line-height: 1; padding: .2rem .4rem;
            border-radius: var(--p3-radius-sm, .375rem);
        }
        .mmm-head button:hover { color: #fff; background: rgba(255,255,255,.15); }
        .mmm-body { padding: .5rem 1rem; overflow-y: auto; }
        .mmm-vazio { padding: 1.5rem 0; text-align: center; opacity: .65; font-size: .875rem; }
        .mmm-item {
            padding: .75rem 0;
            border-bottom: .0625rem solid var(--p3-border, #e5e3dc);
            font-size: .875rem;
        }
        .mmm-item:last-child { border-bottom: none; }
        .mmm-item a { color: inherit; }
        .mmm-processo { font-size: .75rem; opacity: .65; margin: .125rem 0 .375rem; }
        .mmm-rotulo { font-size: .7rem; font-weight: 700; opacity: .6; text-transform: uppercase; letter-spacing: .02em; margin-right: .3rem; }
        .mmm-de { opacity: .65; margin-bottom: .1875rem; }
        .mmm-de s { opacity: .8; }
        .mmm-para { color: var(--p3-blue-700, #2f5fdd); font-weight: 600; }
        .mmm-alerta {
            display: inline-block; margin-top: .375rem;
            padding: .125rem .5rem; border-radius: var(--p3-radius-sm, .375rem);
            background: var(--p3-danger, #c0392b); color: #fff; font-size: .75rem; font-weight: 700;
        }
        .mmm-foot {
            padding: .625rem 1rem; text-align: right;
            border-top: .0625rem solid var(--p3-border, #e5e3dc);
        }
        .mmm-foot button {
            background: var(--p3-blue-700, #2f5fdd); color: #fff; border: none;
            padding: .5rem 1rem; border-radius: var(--p3-radius-sm, .375rem);
            cursor: pointer; font-weight: 600; margin-left: .5rem;
        }
        .mmm-foot .mmm-btn-secundario { background: transparent; color: var(--p3-text, #1c1c1a); border: .0625rem solid var(--p3-border, #e5e3dc); }

        /* Cabeçalho/rodapé/seção "de relatório" — só existem visualmente
           na impressão (ver @media print abaixo); na tela ficam ocultos.
           Paleta e formas copiadas de relatorios/relatorio_preditiva.html
           (capa em gradiente + cartão de seção com selo numerado), pra
           sair no mesmo estilo visual dos outros relatórios do sistema. */
        .mmm-print-capa, .mmm-print-secao-titulo, .mmm-print-rodape { display: none; }
        .mmm-print-capa {
            background: linear-gradient(135deg, #0a1f4d 0%, #1a3a6e 60%, #0d2a5c 100%);
            border-radius: .75rem; padding: 1.75rem 1.5rem; color: #fff; margin-bottom: 1.25rem;
        }
        .mmm-print-capa-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.1rem; }
        .mmm-print-capa-header img { height: 3.5rem; }
        .mmm-print-capa-org h1 { font-size: 1.05rem; font-weight: 700; letter-spacing: .04em; }
        .mmm-print-capa-org h2 { font-size: .8rem; opacity: .7; margin-top: .25rem; font-weight: 400; }
        .mmm-print-capa-titulo { border-top: .0625rem solid rgba(255,255,255,.25); padding-top: 1rem; margin-top: .75rem; }
        .mmm-print-capa-titulo h3 { font-size: 1.15rem; font-weight: 700; letter-spacing: .06em; }
        .mmm-print-capa-titulo p { font-size: .8rem; opacity: .65; margin-top: .3rem; }
        .mmm-print-capa-meta { display: flex; flex-wrap: wrap; gap: .4rem 1.25rem; margin-top: 1rem; font-size: .78rem; opacity: .75; }
        .mmm-print-secao-titulo {
            align-items: flex-start; gap: .8rem; margin-bottom: 1rem; padding-bottom: .75rem; border-bottom: .125rem solid #e8ecf5;
        }
        .mmm-print-secao-numero {
            width: 2rem; height: 2rem; border-radius: 50%; background: #0a448f; color: #fff;
            display: flex; align-items: center; justify-content: center; font-size: .85rem; font-weight: 700; flex-shrink: 0;
        }
        .mmm-print-secao-titulo h2 { font-size: .92rem; font-weight: 700; color: #0a1f4d; }
        .mmm-print-secao-titulo p { font-size: .72rem; color: #9ea3b5; margin-top: .15rem; }
        .mmm-print-rodape {
            justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: .5rem;
            border-top: .125rem solid #e8ecf5; margin-top: 1.5rem; padding-top: .85rem;
            font-size: .72rem; color: #9ea3b5; line-height: 1.6;
        }

        /* Impressão — some com tudo mais na página, deixa só o conteúdo
           do modal (sem fundo escuro, sem posição fixa, sem scroll
           truncando o resto da lista) e esconde os botões (não fazem
           sentido no papel). O corpo (capa/cartão/rodapé) reaproveita a
           MESMA paleta do relatorio_preditiva — cores/gradiente saem
           normalmente na impressão (assim como lá), sem forçar preto e
           branco. */
        @media print {
            body { background: #f4f6fb !important; }
            body > *:not(#modal-mudancas-movimentacao) { display: none !important; }
            #modal-mudancas-movimentacao {
                position: static !important; background: none !important;
                display: block !important; padding: 0 !important;
            }
            #modal-mudancas-movimentacao .mmm-box {
                box-shadow: none !important; max-height: none !important; width: 100% !important;
                color: #1a1f36 !important; background: #f4f6fb !important;
            }
            #modal-mudancas-movimentacao .mmm-head,
            #modal-mudancas-movimentacao .mmm-foot { display: none !important; }
            #modal-mudancas-movimentacao .mmm-body {
                padding: 0 !important; overflow: visible !important;
                background: #fff !important; border-radius: .625rem !important;
                box-shadow: 0 .125rem .5rem rgba(0,0,0,.06) !important;
            }
            #modal-mudancas-movimentacao,
            #modal-mudancas-movimentacao .mmm-print-secao-titulo h2,
            #modal-mudancas-movimentacao .mmm-print-capa,
            #modal-mudancas-movimentacao .mmm-print-rodape,
            #modal-mudancas-movimentacao .mmm-item,
            #modal-mudancas-movimentacao .mmm-processo,
            #modal-mudancas-movimentacao .mmm-rotulo,
            #modal-mudancas-movimentacao .mmm-de,
            #modal-mudancas-movimentacao .mmm-para { font-family: Arial, Helvetica, sans-serif !important; }
            #modal-mudancas-movimentacao .mmm-print-secao-titulo,
            #modal-mudancas-movimentacao .mmm-print-rodape { display: flex !important; }
            /* BUG já corrigido: .mmm-print-capa virava display:flex SEM
               flex-direction:column, então os 3 blocos (brasão+órgão /
               título / metadados) caíam todos numa ÚNICA linha, um por
               cima do outro visualmente — daí o cabeçalho "bagunçado" na
               1ª versão. Precisa de column aqui, os filhos é que definem
               row onde fizer sentido (ver .mmm-print-capa-header abaixo). */
            #modal-mudancas-movimentacao .mmm-print-capa {
                display: flex !important; flex-direction: column !important;
            }
            #modal-mudancas-movimentacao .mmm-print-capa-titulo,
            #modal-mudancas-movimentacao .mmm-print-capa-header,
            #modal-mudancas-movimentacao .mmm-print-capa-meta { display: flex; flex-direction: column; }
            #modal-mudancas-movimentacao .mmm-print-capa-header { flex-direction: row; align-items: center; }
            #modal-mudancas-movimentacao .mmm-print-capa-meta { flex-direction: row; flex-wrap: wrap; }
            #modal-mudancas-movimentacao #mmm-lista { padding: 1.75rem; }
            #modal-mudancas-movimentacao .mmm-body { counter-reset: mmm-contador; }
            #modal-mudancas-movimentacao .mmm-item {
                counter-increment: mmm-contador;
                page-break-inside: avoid;
                background: #f8f9ff !important; border-radius: .5rem !important;
                border-bottom: none !important; padding: .9rem 1rem !important; margin-bottom: .7rem !important;
            }
            #modal-mudancas-movimentacao .mmm-item strong::before {
                content: counter(mmm-contador); display: inline-flex; align-items: center; justify-content: center;
                width: 1.35rem; height: 1.35rem; border-radius: 50%; background: #0a448f; color: #fff;
                font-size: .68rem; margin-right: .5rem; vertical-align: middle;
            }
            #modal-mudancas-movimentacao .mmm-de,
            #modal-mudancas-movimentacao .mmm-rotulo,
            #modal-mudancas-movimentacao .mmm-processo { opacity: 1 !important; color: #6b7594 !important; }
            #modal-mudancas-movimentacao .mmm-para { color: #0a448f !important; }
            #modal-mudancas-movimentacao .mmm-alerta { background: #ffebee !important; color: #b71c1c !important; }
        }
    `;

    let elModal = null;

    function escaparHtml(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // Movimentação pode vir com uma 2ª "linha" (o texto narrativo do
    // e-SAJ, ex.: o parágrafo de uma Certidão — ver
    // tools/atualizador-local/esaj_movimentos.py), separada por "\n" do
    // título+data — converte pra <br> depois de escapar, senão o
    // navegador colapsa a quebra de linha original num espaço só.
    function escaparComQuebra(s) {
        return escaparHtml(s).replace(/\n/g, '<br>');
    }

    function formatarDataHora(iso) {
        if (!iso) return null;
        const d = new Date(iso);
        if (isNaN(d.getTime())) return null;
        const dia = String(d.getDate()).padStart(2, '0');
        const mes = String(d.getMonth() + 1).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${dia}/${mes}/${d.getFullYear()} ${hh}:${mm}`;
    }

    function garantirDom() {
        if (elModal) return;
        const style = document.createElement('style');
        style.textContent = ESTILO;
        document.head.appendChild(style);

        elModal = document.createElement('div');
        elModal.id = 'modal-mudancas-movimentacao';
        elModal.innerHTML =
            '<div class="mmm-box">' +
            '<div class="mmm-head">' +
            '<div class="mmm-head-textos">' +
            '<div class="mmm-head-titulo" id="mmm-titulo">Movimentações atualizadas</div>' +
            '<div class="mmm-head-quando" id="mmm-quando"></div>' +
            '</div>' +
            '<div class="mmm-head-botoes">' +
            '<button type="button" id="mmm-imprimir" title="Imprimir">🖨️</button>' +
            '<button type="button" id="mmm-fechar" title="Fechar">✕</button>' +
            '</div>' +
            '</div>' +
            '<div class="mmm-body">' +
            '<div class="mmm-print-capa">' +
            '<div class="mmm-print-capa-header">' +
            `<img src="${CAMINHO_BRASAO}" alt="Brasão 10º BPM">` +
            '<div class="mmm-print-capa-org">' +
            '<h1>SISTEMA DE GERENCIAMENTO P3</h1>' +
            '<h2>10º BATALHÃO DE POLÍCIA MILITAR DE ALAGOAS</h2>' +
            '</div>' +
            '</div>' +
            '<div class="mmm-print-capa-titulo">' +
            '<h3>RELATÓRIO DE MOVIMENTAÇÕES PROCESSUAIS</h3>' +
            '<p>Comparação entre a movimentação anterior e a atual de cada processo, obtida do e-SAJ (TJAL)</p>' +
            '</div>' +
            '<div class="mmm-print-capa-meta" id="mmm-print-meta"></div>' +
            '</div>' +
            '<div class="mmm-print-secao-titulo">' +
            '<div class="mmm-print-secao-numero">1</div>' +
            '<div><h2 id="mmm-print-secao-h2">Movimentações atualizadas</h2>' +
            '<p>Cada item mostra o texto anterior riscado e o texto atual em destaque</p></div>' +
            '</div>' +
            '<div id="mmm-lista"></div>' +
            '<div class="mmm-print-rodape">' +
            '<div><strong>Sistema P3</strong> — 10º Batalhão de Polícia Militar<br>Seção de Planejamento, Ensino e Instrução — P3/10ºBPM</div>' +
            '<div id="mmm-print-rodape-meta" style="text-align:right;"></div>' +
            '</div>' +
            '</div>' +
            '<div class="mmm-foot">' +
            '<button type="button" class="mmm-btn-secundario" id="mmm-imprimir-2">🖨️ Imprimir</button>' +
            '<button type="button" id="mmm-ok">Entendi</button>' +
            '</div>' +
            '</div>';
        document.body.appendChild(elModal);

        function fechar() { elModal.classList.remove('aberto'); }
        function imprimir() { window.print(); }
        elModal.querySelector('#mmm-fechar').addEventListener('click', fechar);
        elModal.querySelector('#mmm-ok').addEventListener('click', fechar);
        elModal.querySelector('#mmm-imprimir').addEventListener('click', imprimir);
        elModal.querySelector('#mmm-imprimir-2').addEventListener('click', imprimir);
        // Clique fora da caixa (no fundo escuro) também fecha.
        elModal.addEventListener('click', function (e) { if (e.target === elModal) fechar(); });
    }

    // mudancas: [{nome, numeroProcesso, movimentacaoAnterior, movimentacaoAtual, alertaImportante, link}]
    // opts.quando: ISO da verificação que gerou esta lista (mostrado no
    // cabeçalho e usado no cabeçalho de impressão).
    // opts.permitirVazio: por padrão, uma lista vazia NÃO abre o modal
    // (comportamento automático de pós-"Verificar agora" — não interromper
    // com um modal vazio quando não mudou nada). O botão "Ver última
    // atualização" passa true aqui de propósito: um clique EXPLÍCITO no
    // botão deve sempre mostrar alguma coisa, mesmo que seja "nada mudou".
    function exibir(mudancas, opts) {
        opts = opts || {};
        const lista = Array.isArray(mudancas) ? mudancas : [];
        if (!lista.length && !opts.permitirVazio) return;

        garantirDom();

        const titulo = opts.titulo || `${lista.length} movimentação(ões) atualizada(s)`;
        document.getElementById('mmm-titulo').textContent = titulo;

        const quandoFmt = formatarDataHora(opts.quando);
        document.getElementById('mmm-quando').textContent = quandoFmt ? `Verificado em ${quandoFmt}` : '';

        // Capa de impressão — mesmo formato "ícone + texto" da faixa de
        // metadados do relatorio_preditiva.html (data/operador/período).
        document.getElementById('mmm-print-meta').innerHTML =
            (quandoFmt ? `<span>📅 Verificado em ${escaparHtml(quandoFmt)}</span>` : '') +
            `<span>🔎 ${escaparHtml(String(lista.length))} movimentação(ões)</span>`;
        document.getElementById('mmm-print-secao-h2').textContent = titulo;
        document.getElementById('mmm-print-rodape-meta').textContent =
            `Impresso em ${formatarDataHora(new Date().toISOString())}`;

        const corpo = document.getElementById('mmm-lista');
        if (!lista.length) {
            corpo.innerHTML = '<div class="mmm-vazio">Nenhuma mudança de movimentação nessa verificação.</div>';
        } else {
            corpo.innerHTML = lista.map(function (m) {
                const nome = escaparHtml(m.nome || 'Sem nome');
                const nomeHtml = m.link ? `<a href="${escaparHtml(m.link)}">${nome}</a>` : nome;
                const anterior = m.movimentacaoAnterior
                    ? `<s>${escaparComQuebra(m.movimentacaoAnterior)}</s>`
                    : '<em>(nenhuma registrada até agora)</em>';
                const alertaTag = m.alertaImportante
                    ? `<div><span class="mmm-alerta">🚨 ${escaparHtml(m.alertaImportante)}</span></div>` : '';
                return '<div class="mmm-item">' +
                    `<strong>${nomeHtml}</strong>` +
                    `<div class="mmm-processo">Processo nº ${escaparHtml(m.numeroProcesso || '—')}</div>` +
                    `<div class="mmm-de"><span class="mmm-rotulo">Movimentação anterior:</span>${anterior}</div>` +
                    `<div class="mmm-para"><span class="mmm-rotulo">Movimentação atual:</span>${escaparComQuebra(m.movimentacaoAtual || '')}</div>` +
                    alertaTag +
                    '</div>';
            }).join('');
        }

        elModal.classList.add('aberto');
    }

    global.P3ModalMudancas = { exibir: exibir };
})(window);
