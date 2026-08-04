"""
Converte os logs CORRIGIDOS (correcao_humana preenchida) num arquivo JSONL no
formato de conversa system/user/assistant — o formato que ferramentas de
fine-tuning (OpenAI, Llama etc.) esperam.

Isso é só o EXPORTADOR de dados. Treinar e reimplantar um modelo pro WebLLM
do navegador é um projeto à parte, bem maior (exige o toolchain de
compilação do MLC-LLM — GPU, quantização, exportação pra WebGPU — não só um
script Python) e está FORA do escopo deste pipeline, que hoje só existe pra
sugerir novos termos/sinônimos pras listas determinísticas de js/xerife.js
(ver analisar_termos.py). Este arquivo fica pronto pra esse dia, se um
projeto de fine-tuning de verdade for decidido no futuro.

Uso:
    python gerar_jsonl.py --entrada dataset.json --saida treino.jsonl
"""
import argparse
import json
from pathlib import Path

SYSTEM_PROMPT = (
    "Você é o Xerife, assistente de dados de uma unidade policial. Sua função "
    "é identificar a CATEGORIA de uma pergunta em português sobre estatística "
    "criminal (mvicvli, cvp, tco, armas, drogas, visita, perturbacao, "
    "violencia, criticidade, previsao, cartao_programa, ranking_tco_militares, "
    "aceitabilidade_tco_local, comarca_arquivamentos, atendente_copom, "
    "localizacao_droga, materiais, visitas_sugeridas, resumo, comparativo). "
    "Nunca invente números — sua única saída é o nome da categoria."
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--entrada", required=True, help="dataset.json gerado por extrair_dataset.py")
    parser.add_argument("--saida", default="treino.jsonl")
    args = parser.parse_args()

    registros = json.loads(Path(args.entrada).read_text(encoding="utf-8"))
    linhas = []
    for r in registros:
        pergunta = (r.get("pergunta") or "").strip()
        categoria = (r.get("correcao_humana") or "").strip()
        if not pergunta or not categoria:
            continue  # só entra no dataset quem tem OS DOIS lados confirmados por humano
        linhas.append({
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": pergunta},
                {"role": "assistant", "content": categoria},
            ]
        })

    with open(args.saida, "w", encoding="utf-8") as f:
        for linha in linhas:
            f.write(json.dumps(linha, ensure_ascii=False) + "\n")

    print(f"{len(linhas)} exemplo(s) exportado(s) pra {args.saida}")


if __name__ == "__main__":
    main()
