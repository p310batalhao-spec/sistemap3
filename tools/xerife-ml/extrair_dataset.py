"""
Baixa os logs de interação do endpoint PHP (action=get_training_dataset) e
salva localmente em JSON — passo 1 do pipeline. Não faz nenhuma análise
aqui, só extração/persistência bruta (ver analisar_termos.py pro passo 2).

Uso:
    python extrair_dataset.py --url https://seu-dominio.com/xerife_api.php --saida dataset.json
"""
import argparse
import json
from pathlib import Path

import requests


def baixar_dataset(url: str, timeout: int = 30) -> list:
    resp = requests.get(url, params={"action": "get_training_dataset"}, timeout=timeout)
    resp.raise_for_status()
    dados = resp.json()
    if not isinstance(dados, list):
        raise ValueError(f"Resposta inesperada da API (esperava uma lista JSON, veio {type(dados).__name__}) — confira o contrato de get_training_dataset em xerife_api.php.")
    return dados


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True, help="URL base do xerife_api.php (ex.: https://seu-dominio.com/xerife_api.php)")
    parser.add_argument("--saida", default="dataset.json", help="Arquivo de saída (JSON)")
    args = parser.parse_args()

    print(f"Baixando dataset de {args.url} ...")
    dados = baixar_dataset(args.url)
    print(f"{len(dados)} registro(s) recebido(s).")

    Path(args.saida).write_text(json.dumps(dados, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Salvo em {args.saida}")


if __name__ == "__main__":
    main()
