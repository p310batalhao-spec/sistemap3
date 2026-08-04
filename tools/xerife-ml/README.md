# Xerife — ferramentas de aprendizado (escopo reduzido)

Este pipeline foi deliberadamente reduzido de "treinar e reimplantar um
modelo de IA" para **"descobrir termos/gírias que faltam nas listas de
sinônimos determinísticas de `js/xerife.js`"** — decisão tomada em conjunto
com o usuário, pelos motivos abaixo.

## Por que o escopo foi reduzido

- O Xerife é 100% determinístico: toda contagem/ranking vem de funções JS
  que leem direto do Firebase/GAS. A IA local (WebLLM) só existe pra
  ENTENDER a pergunta e redigir a resposta — nunca pra calcular números.
  "Fine-tunar" um modelo pra rodar de volta nesse mesmo lugar exigiria o
  toolchain de compilação do MLC-LLM (GPU, quantização, exportação pra
  WebGPU), um projeto de infraestrutura bem maior que os scripts aqui.
- O ganho real (entender gírias/termos regionais) se resolve de forma muito
  mais simples e auditável: expandindo as listas de sinônimos que já existem
  em `CATEGORIAS[x].nomes` e nos detectores `eh*()` dentro de
  `js/xerife.js` — sem servidor externo, sem custo de treino, sem risco de
  o assistente "aprender" algo errado sozinho.

## Privacidade — o que É e não É enviado pro seu servidor

Ver o bloco `TELEMETRIA` em `js/xerife.js` (comentário completo lá). Resumo:

| Tipo de pergunta | O que é enviado |
|---|---|
| Consulta de CPF/nome/boletim/processo | **Nada** — nem categoria, nem texto |
| Pergunta reconhecida (ex.: "quantos TCO este mês") | Só a categoria (`tco`) |
| Pergunta NÃO reconhecida | Categoria (`nao_reconhecida`) **+ texto da pergunta** (é o único caso em que o texto bruto tem valor) |
| Resposta gerada (`resposta_gerada`) | **Nunca** — pode conter contagem/nome real |

## Contrato assumido da API (`xerife_api.php`)

Como não tenho acesso ao código PHP real, o cliente JS (`js/xerife.js`) foi
escrito assumindo este contrato — **confira/ajuste no seu `xerife_api.php`
se os nomes de campo forem diferentes**:

- `POST xerife_api.php` com corpo JSON `{action: "log_interaction", categoria_detectada, pergunta}` → deve inserir uma linha em `logs_interacao` e responder `{"id": <novo id>}`.
- `POST xerife_api.php` com corpo JSON `{action: "update_feedback", id, feedback_usuario}` → deve fazer `UPDATE logs_interacao SET feedback_usuario = ? WHERE id = ?`.
- `GET xerife_api.php?action=get_training_dataset` → deve responder uma lista JSON de objetos `{id, pergunta, categoria_detectada, feedback_usuario, correcao_humana, data_registro}`.
- `correcao_humana` não é preenchido pelo cliente JS — é um campo pra VOCÊ (ou quem revisar os logs) editar direto no banco, apontando a categoria certa pra perguntas que o Xerife não entendeu ou entendeu errado.

**Antes de ligar de verdade**: preencha `TELEMETRIA_API_URL` em
`js/xerife.js` com o domínio real e troque `TELEMETRIA_ATIVA` pra `true`.
Continua desligado até isso ser feito, de propósito.

## Passo a passo

```bash
pip install -r requirements.txt

# 1. Baixa os logs do seu servidor
python extrair_dataset.py --url https://SEU-DOMINIO/xerife_api.php --saida dataset.json

# 2. Gera um relatório em Markdown com termos candidatos (revisão humana)
python analisar_termos.py --entrada dataset.json --saida relatorio_termos.md

# 3. (opcional, só se um projeto de fine-tuning de verdade for decidido no
#    futuro) exporta os logs JÁ corrigidos em formato JSONL de treino
python gerar_jsonl.py --entrada dataset.json --saida treino.jsonl
```

O `relatorio_termos.md` nunca edita `js/xerife.js` sozinho — ele só aponta
candidatos. Cabe a alguém olhar e decidir se um termo realmente pertence a
uma categoria antes de adicioná-lo em `CATEGORIAS[x].nomes` (ou no detector
`eh*()` correspondente).

## Não testado neste ambiente

Este ambiente de desenvolvimento não tem Python instalado, então os scripts
acima não puderam ser executados de ponta a ponta aqui — foram revisados
manualmente (uso padrão de `requests`/`pandas`/`json`), mas rode um teste
rápido com um `dataset.json` de exemplo antes de confiar neles em produção.
