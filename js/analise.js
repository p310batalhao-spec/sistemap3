/**
 * analise.js - Processamento Jurimétrico com Tratamento de Erros 429
 */

const API_KEY = "AIzaSyBsCoTlX3zsMHXM1wT8TDp2WsWI5-acv0o"; 

async function chamarIAJurimetrica(contexto) {
    // Sugestão: Use gemini-1.5-flash se o 2.0 continuar dando erro 429 frequente
    const MODELO = "gemini-2.5-flash"; 
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent?key=${API_KEY}`;
    
    const systemPrompt = `Você é o 'JECRIM Jurimetria TCO Predictor'. 
    Analise os dados e retorne APENAS um objeto JSON puro:
    {
      "atipicidade": "XX%",
      "transacao": "YY%",
      "denuncia": "ZZ%",
      "motivo": "resumo de 1 frase"
    }`;

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: `Analise: ${contexto}` }] }],
                systemInstruction: { parts: [{ text: systemPrompt }] }
            })
        });

        if (response.status === 429) {
            throw new Error("Limite de requisições atingido. Aguarde 60 segundos.");
        }

        const data = await response.json();

        // Verifica se a estrutura da resposta existe antes de acessar
        if (!data.candidates || data.candidates.length === 0) {
            throw new Error("A IA não gerou uma resposta válida.");
        }

        const textoResposta = data.candidates[0].content.parts[0].text;
        const jsonLimpo = textoResposta.replace(/```json|```/g, '').trim();
        
        return JSON.parse(jsonLimpo);

    } catch (e) {
        console.error("Erro na análise:", e.message);
        // Retorna valores de erro amigáveis para a tabela
        return { 
            atipicidade: "Limite", 
            transacao: "Excedido", 
            denuncia: "429", 
            motivo: e.message 
        };
    }
}