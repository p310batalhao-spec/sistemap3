"""
Analisa os logs coletados e sugere candidatos a NOVOS TERMOS/SINÔNIMOS pras
listas já existentes em js/xerife.js (CATEGORIAS[x].nomes, eh*()). Este
script NUNCA edita código sozinho — só gera um relatório em Markdown pra
revisão humana. O Xerife é um sistema determinístico de dados policiais e a
lista de sinônimos decide o que cada categoria "significa"; isso não pode
mudar sem alguém conferir (é exatamente a mesma doutrina de "nunca inventa"
que já rege o resto do sistema).

Duas fontes de sinal:
  1. correcao_humana preenchida — o operador já disse qual categoria a
     pergunta deveria ter caído; os termos dessas perguntas são o sinal mais
     forte (agrupa por categoria corrigida, conta termos mais frequentes).
  2. categoria_detectada == "nao_reconhecida" SEM correcao_humana — o Xerife
     não entendeu e ninguém corrigiu ainda; entra numa fila separada pra
     alguém rotular manualmente (isso vira sinal do tipo 1 depois).

Uso:
    python analisar_termos.py --entrada dataset.json --saida relatorio_termos.md
"""
import argparse
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path

import pandas as pd

STOPWORDS_PT = {
    "a", "o", "as", "os", "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas",
    "um", "uma", "uns", "umas", "e", "ou", "que", "pra", "para", "por", "com", "sem",
    "quantos", "quantas", "quanto", "quanta", "qual", "quais", "quem", "onde", "como",
    "esse", "essa", "esses", "essas", "este", "esta", "estes", "estas", "isso", "isto",
    "tem", "teve", "foi", "ser", "estar", "mais", "menos", "ja", "ainda",
    "me", "te", "se", "lhe", "meu", "minha", "seu", "sua", "eu", "voce", "ele", "ela",
    "ano", "mes", "dia", "hoje", "ontem", "agora", "todos", "toda", "todas",
}

CATEGORIAS_CONHECIDAS = [
    "mvicvli", "cvp", "tco", "armas", "drogas", "visita", "perturbacao", "violencia",
    "criticidade", "previsao", "cartao_programa", "ranking_tco_militares",
    "aceitabilidade_tco_local", "comarca_arquivamentos", "atendente_copom",
    "localizacao_droga", "materiais", "visitas_sugeridas", "resumo", "comparativo",
]


def normalizar(texto: str) -> str:
    texto = unicodedata.normalize("NFD", texto or "")
    texto = "".join(c for c in texto if unicodedata.category(c) != "Mn")
    return texto.lower()


def tokenizar(texto: str) -> list:
    tokens = re.findall(r"[a-z]{3,}", normalizar(texto))
    return [t for t in tokens if t not in STOPWORDS_PT]


def termos_mais_frequentes(perguntas: list, top_n: int = 15) -> list:
    contador = Counter()
    for p in perguntas:
        # set() = conta no máximo 1x por pergunta (não por repetição dentro
        # da mesma frase) — evita que uma pergunta só distorça o ranking.
        contador.update(set(tokenizar(p)))
    return contador.most_common(top_n)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--entrada", required=True, help="dataset.json gerado por extrair_dataset.py")
    parser.add_argument("--saida", default="relatorio_termos.md", help="Relatório em Markdown")
    args = parser.parse_args()

    registros = json.loads(Path(args.entrada).read_text(encoding="utf-8"))
    df = pd.DataFrame(registros)
    if df.empty:
        print("Dataset vazio — nada para analisar.")
        return

    for col in ("pergunta", "categoria_detectada", "feedback_usuario", "correcao_humana"):
        if col not in df.columns:
            df[col] = None

    linhas_md = ["# Relatório de termos candidatos — Xerife\n"]
    linhas_md.append(f"Categorias conhecidas hoje: `{'`, `'.join(CATEGORIAS_CONHECIDAS)}`\n")

    # 1) Perguntas com correção humana — sinal forte, agrupado por categoria CORRIGIDA
    corrigidas = df[df["correcao_humana"].notna() & (df["correcao_humana"] != "")]
    if not corrigidas.empty:
        linhas_md.append("## 1. Termos por categoria corrigida (sinal forte)\n")
        for categoria, grupo in corrigidas.groupby("correcao_humana"):
            termos = termos_mais_frequentes(grupo["pergunta"].dropna().tolist())
            if not termos:
                continue
            linhas_md.append(f"### `{categoria}` ({len(grupo)} correção/correções)")
            for termo, qtd in termos:
                linhas_md.append(f"- **{termo}** — apareceu em {qtd} pergunta(s)")
            linhas_md.append("")
    else:
        linhas_md.append("## 1. Termos por categoria corrigida\n\n_Nenhuma correção humana registrada ainda — preencha `correcao_humana` na tabela `logs_interacao` pra alimentar essa seção._\n")

    # 2) Perguntas não reconhecidas E sem correção ainda — fila pra alguém rotular
    pendentes = df[(df["categoria_detectada"] == "nao_reconhecida") & (df["correcao_humana"].isna() | (df["correcao_humana"] == ""))]
    linhas_md.append(f"## 2. Perguntas não reconhecidas aguardando rótulo ({len(pendentes)})\n")
    linhas_md.append(
        "Preencha `correcao_humana` na tabela `logs_interacao` com uma das categorias conhecidas "
        "acima e rode este script de novo — isso vira sinal forte na seção 1.\n"
    )
    for pergunta in pendentes["pergunta"].dropna().head(200):
        pergunta = str(pergunta).strip()
        if pergunta:
            linhas_md.append(f"- {pergunta}")

    # 3) Feedback negativo em perguntas RECONHECIDAS — categoria pode estar errada
    negativas = df[(df["feedback_usuario"] == "negativo") & (df["categoria_detectada"] != "nao_reconhecida")]
    if not negativas.empty:
        linhas_md.append(f"\n## 3. Categorias com feedback negativo, sem correção ainda ({len(negativas)})\n")
        linhas_md.append(
            "A categoria foi detectada, mas o usuário marcou 👎 — pode ser resposta certa mas mal "
            "formatada/período errado, ou categoria realmente errada. Vale conferir e preencher "
            "`correcao_humana` se for o caso.\n"
        )
        for categoria, grupo in negativas.groupby("categoria_detectada"):
            linhas_md.append(f"- `{categoria}`: {len(grupo)} feedback(s) negativo(s)")

    Path(args.saida).write_text("\n".join(linhas_md), encoding="utf-8")
    print(f"Relatório salvo em {args.saida} — revise antes de editar js/xerife.js")


if __name__ == "__main__":
    main()
