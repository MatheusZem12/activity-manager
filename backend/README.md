# Backend do Activity Manager

Spring Boot + Postgres. Uma API para os três domínios do app: **atividades**,
**textos** (clipboard) e **segmentos** (rastreio de foco). Mesmo esqueleto do
Lingua — JWT com convite, Flyway como dono do schema, `ddl-auto: validate`.

## A regra que decide o que mora aqui

**Toda regra de negócio fica no servidor. O dispositivo produz fatos; o servidor
deriva significado.**

Isso não é cerimônia — é o que permite mudar de ideia depois:

| | onde | por quê |
|---|---|---|
| ler o socket do Hyprland, `pgrep`, `playerctl` | dispositivo | driver: só existe lá |
| `ocioso = travado && !midia` | **servidor** | mudou a definição? reprocessa o histórico |
| regras de classificação | **servidor** | regra nova vale para trás |
| montar prompt e schema | **servidor** | é decisão, não execução |
| chamar o modelo local | dispositivo | a VPS não alcança seu `ollama` |
| validar a resposta e aplicar | **servidor** | executor não escreve no banco o que quiser |

O `ReclassificadorServico` é a prova disso: criar uma regra dispara um
reprocessamento de todos os segmentos já guardados. Se o coletor tivesse mandado
`ocioso: true` em vez de `travado` e `midia`, a premissa teria sido jogada fora e
nada disso seria possível.

## Subir

```bash
cp .env.exemplo ../.env      # e preencha AM_JWT_SEGREDO e AM_CONVITE
docker compose up -d         # banco + api
```

Ou, para desenvolver, com o banco em contêiner e a API na sua máquina:

```bash
docker compose up -d banco
AM_JWT_SEGREDO=... AM_CONVITE=... mvn spring-boot:run
```

## Rotas

| | |
|---|---|
| `GET /api/saude` | sem sessão — é onde o healthcheck do contêiner bate |
| `POST /api/sessao` | entrar; e-mail novo + convite cria a conta e semeia as categorias |
| `POST /api/segmentos` | lote de fatos vindo do coletor; classifica e grava |
| `GET·POST·PATCH·DELETE /api/categorias` | as categorias do usuário; qualquer mudança invalida o cache |
| `GET·POST·PATCH·DELETE /api/regras` | regras de classificação; qualquer mudança reprocessa o histórico |
| `GET /api/relatorio?de=&ate=` | tempo por categoria, projeto e app |
| `POST /api/ia/enfileirar` | fecha o lote do que está pendente e monta as perguntas |
| `GET /api/ia/pendentes?dispositivo=` | entrega uma tarefa a quem sabe executá-la |
| `POST /api/ia/resultado` | recebe a resposta, valida, aplica |

Ainda não implementados: `/api/atividades` e `/api/textos`. As tabelas existem
na migração `V1`; os controladores seguem a mesma forma do de segmentos.

## Os quatro degraus da classificação

Do mais barato para o mais caro, em `ClassificadorServico`:

```
1. ocioso     travado e sem mídia → nem chega a ser classificado
2. regra      classe/título do usuário resolvem, de graça e determinístico
3. cache      esse título já foi decidido nesta versão de categorias
4. pendente   sobrou: vai para a fila de IA
```

A camada 2 existe porque modelo pequeno erra. No teste real, o `llama3:8b`
classificou uma aula de Computação Gráfica no Teams como `trabalho`; uma regra
com `202602|NOTURNO → faculdade` corrigiu — e corrigiu **o passado junto**.

## A IA, e o caso `local`

`AM_IA_PROVEDOR` decide quem faz a chamada:

- `anthropic` / `openai` / `gemini` — o servidor chama, com `AM_IA_CHAVE`.
- `local` — o servidor **não chama nada**. Ele monta a pergunta, guarda em
  `ia_tarefa`, e espera. O dispositivo sonda `/api/ia/pendentes`, roda no
  `ollama` ou no `claude` da máquina, e devolve.

Sondagem de saída e não notificação de entrada, porque a máquina do usuário está
atrás de NAT residencial — o servidor não consegue ligar para ela. A reserva tem
prazo (`AM_IA_RESERVA`), então máquina que desliga no meio devolve a tarefa
sozinha, e dois desktops ligados não rodam a mesma coisa.

O dispositivo recebe texto e schema e devolve JSON. Ele não sabe o que está
classificando nem por quê: **é executor, não decisor**. O servidor valida índice,
categoria e confiança antes de acreditar em qualquer coisa.

## O que garante que o modelo respeite as categorias do usuário

Não é instrução em prosa — é o `enum` do schema, montado a partir das chaves da
conta em `IaServico.esquema()`. Prosa o modelo às vezes ignora; enum de saída
estruturada, não.

E `nao_classificado` é uma saída legítima. Sem ela o modelo força encaixe, e um
relatório que parece certo e está errado é pior que um buraco visível. Confiança
`baixa` também não é aplicada sozinha: fica para revisão.
