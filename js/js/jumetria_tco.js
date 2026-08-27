import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
    import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

    // Config definida em runtime a partir da unidade do usuário logado (ver js/core/session.js)
    const _cfg = await P3.loadUnidadeConfig();
    const app = initializeApp(_cfg.firebase);
    const db = getDatabase(app);

    // Variável global para armazenar os dados cruzados e permitir filtragem
    let dadosCruzadosCache = [];

    /**
     * Captura os dados, cruza os nós e armazena no cache
     */
    function carregarDadosFirebase() {
        const rootRef = ref(db, '/');

        onValue(rootRef, (snapshot) => {
            const dados = snapshot.val();
            if (!dados) return;

            const listaTco = dados.tco || {};
            const listaAutor = dados.autor || {};

            // Limpa o cache antes de repopular
            dadosCruzadosCache = [];

            // Faz o cruzamento (Join) dos dados e guarda no cache
            Object.values(listaTco).forEach(tco => {
                const autorMatch = Object.values(listaAutor).find(a => a.BOLETIM === tco.BOLETIM);
                if (autorMatch) {
                    dadosCruzadosCache.push({
                        ...tco,
                        NOME_AUTOR: autorMatch.NOME || 'N/A',
                        NARRATIVA: autorMatch.NARRATIVA || ''
                    });
                }
            });

            renderTable(dadosCruzadosCache);
        });
    }

    /**
     * Renderiza a tabela baseada em um array de dados
     */
    function renderTable(listaParaExibir) {
        const corpoTabela = document.getElementById('corpo-tabela');
        corpoTabela.innerHTML = "";

        listaParaExibir.forEach(item => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${item.BOLETIM}</td>
                <td>${item.DATA}</td>
                <td>${item.TIPIFICACAO}</td>
                <td>${item.NOME_AUTOR}</td>
                <td id="atip-${item.BOLETIM}">---</td>
                <td id="anpp-${item.BOLETIM}">---</td>
                <td id="den-${item.BOLETIM}">---</td>
                <td><button class="btn-analise" id="btn-${item.BOLETIM}">Analisar Caso</button></td>
            `;
            corpoTabela.appendChild(tr);

            // Reatribui o evento do botão de análise
            document.getElementById(`btn-${item.BOLETIM}`).onclick = async () => {
                await dispararAnalise(item);
            };
        });
    }

    /**
     * Prepara o contexto e chama a função do analise.js
     */
    async function dispararAnalise(item) {
        const btn = document.getElementById(`btn-${item.BOLETIM}`);
        btn.innerText = "Processando...";
        btn.disabled = true;

        const contexto = `
            BOLETIM: ${item.BOLETIM}. 
            TIPIFICAÇÃO: ${item.TIPIFICACAO}. 
            NARRATIVA: ${item.NARRATIVA}. 
            DESPACHO: ${item.TEXTO_DESPACHANTE}.
        `;

        const resultado = await chamarIAJurimetrica(contexto);

        document.getElementById(`atip-${item.BOLETIM}`).innerText = resultado.atipicidade;
        document.getElementById(`anpp-${item.BOLETIM}`).innerText = resultado.transacao;
        document.getElementById(`den-${item.BOLETIM}`).innerText = resultado.denuncia;

        btn.innerText = "Reanalisar";
        btn.disabled = false;
    }

    // --- LÓGICA DE FILTRO CORRIGIDA ---
    document.getElementById('btn-aplicar-filtro').onclick = () => {
        const campo = document.getElementById('filtro-tipo').value; // ex: 'BOLETIM' ou 'TIPIFICACAO'
        const termoBusca = document.getElementById('filtro-valor-text').value.toLowerCase();

        const filtrados = dadosCruzadosCache.filter(item => {
            // Mapeia o valor do select para as chaves reais do objeto
            const valorCampo = (item[campo] || '').toString().toLowerCase();
            return valorCampo.includes(termoBusca);
        });

        renderTable(filtrados);
    };

    // Relógio, user-info e logout já são centralizados por
    // js/core/header-nav.js — as funções que existiam aqui usavam um
    // esquema de login legado (chave "usuarioLogado", de antes do
    // sistema de sessão P3 atual) e sobrescreviam #user-info com texto
    // vazio (bug real: apagava o que header-nav.js tinha acabado de
    // preencher, já que "usuarioLogado" nunca existe no esquema atual).

    // Inicialização
    document.addEventListener('DOMContentLoaded', () => {
        carregarDadosFirebase();
    });