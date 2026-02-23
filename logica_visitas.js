// logica_visitas.js

async function buscarOcorrenciasParaVisita(dataInicio, dataFim) {
    try {
        const urlFinal = `${DATABASE_URL}/${NODE_GERAL}.json`;
        const response = await fetch(urlFinal);
        
        if (!response.ok) throw new Error("Erro ao acessar o banco de dados.");

        const data = await response.json();
        if (!data) return [];

        const resultados = [];
        
        const filtros = {
            tipificacoes: ["PERTURBAÇÃO", "VIOLÊNCIA DOMÉSTICA", "AMEAÇA", "LESÃO CORPORAL"],
            solucoes: ["FUGA", "RESOLVIDO", "EXECUTADO", "INDISPONIBILIDADE"],
            termosCriticos: ["FUGIU", "ARMA", "DISPARO", "BATEU", "AMEAÇOU", "FACA", "BRIGOU", "GRITOU", "ESPANCOU", "AGREDIU", "SANGUE", "FERIU", "MACHUCADO", "VIOLÊNCIA", "DOMÉSTICA", "DOMESTICA", "INDISPONIBILIDADE", "RESOLVIDO", "EXECUTADO"]
        };

        const dInicioNum = parseInt(dataInicio.replace(/-/g, ""), 10);
        const dFimNum = parseInt(dataFim.replace(/-/g, ""), 10);

        Object.keys(data).forEach(id => {
            const doc = data[id];
            
            const dataDoc = doc.DATA || doc.data || "";
            const dataNum = normalizarDataParaInt(dataDoc);
            if (dataNum < dInicioNum || dataNum > dFimNum) return;

            const campoTipificacao = String(doc.TIPIFICACAO || doc.TIPIFICAÇÃO || doc['TIPIFICAÇÃO NO DESPACHO'] || "").toUpperCase();
            const campoSolucao = String(doc.SOLUCAO || doc.SOLUÇÃO || doc.SOLUCAO_FINAL || "").toUpperCase();
            
            const textoParaAnalise = (
                String(doc.ATENDIMENTO_INICIAL || "") + " " + 
                String(doc.TEXTO_DO_DESPACHANTE || doc.TEXTO_DESPACHANTE || "") + " " + 
                String(doc.RELATO || "")
            ).toUpperCase();

            const passouTipificacao = filtros.tipificacoes.some(t => campoTipificacao.includes(t));
            const passouSolucao = filtros.solucoes.some(t => campoSolucao.includes(t));
            const temTermoCritico = filtros.termosCriticos.some(t => textoParaAnalise.includes(t));

            if (passouTipificacao && passouSolucao && temTermoCritico) {
                resultados.push({
                    cop: doc.BOLETIM || doc.NUMEROOCORRENCIA || id,
                    solicitante: doc.SOLICITANTE || "Não informado",
                    natureza: campoTipificacao,
                    data: dataDoc,
                    logradouro: `${doc.LOGRADOURO || ""}, ${doc.BAIRRO || ""} - ${doc.CIDADE || ""}`,
                    solucao: campoSolucao,
                    resumo: textoParaAnalise // AJUSTE: Texto agora vai completo sem substring
                });
            }
        });

        return resultados;
    } catch (err) {
        console.error("Erro na busca:", err);
        return [];
    }
}

function normalizarDataParaInt(dataStr) {
    if (!dataStr) return 0;
    const limpo = dataStr.replace(/\D/g, '');
    if (limpo.length !== 8) return 0;

    if (dataStr.includes('-')) { 
        return parseInt(limpo, 10);
    } else { 
        const dia = limpo.substring(0, 2);
        const mes = limpo.substring(2, 4);
        const ano = limpo.substring(4, 8);
        return parseInt(ano + mes + dia, 10);
    }
}