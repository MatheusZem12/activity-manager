# Deploy na VPS

## A VPS não tem o repositório

Você não faz `git clone` lá. **O código nunca chega na VPS.** O que chega é uma
imagem Docker já construída, e a máquina só sabe o nome dela.

```
  sua máquina          GitHub Actions              GHCR                VPS
  ───────────          ──────────────              ────                ───
  git push  ─────────>  roda os testes  ──build──> imagem :main <──pull──  você
                                                                     (ou watchtower)
```

Três consequências:

- **o GitHub nunca conecta na sua máquina.** A VPS só faz requisição de *saída*.
  Não existe chave de deploy, nem webhook aberto, nem porta de CI;
- **a VPS não precisa de JDK, Maven nem 2 GB livres para compilar;**
- **o que está no ar é exatamente o que passou nos testes.**

## A estrutura

```
~/activity-manager/
├── postgres/   docker-compose.yml + .env    o banco, sozinho
└── service/    docker-compose.yml + .env    backend + túnel
```

Separados porque os ciclos de vida são diferentes: o backend muda a cada push, o
Postgres quase nunca. Atualizar um não pode ter nada a ver com derrubar o outro.
Os dois se encontram pela rede `activity-net`, que é **externa** aos dois
composes — criada uma vez, e nenhum dos dois a destrói ao descer.

## Passo a passo

```bash
# 1. Na sua máquina: publica a imagem
git push

# 2. Na VPS: monta tudo e sobe o banco
scp -r deploy/vps/* usuario@vps:~/instalador/
ssh usuario@vps
bash ~/instalador/instalar.sh

# 3. Ainda na VPS: sobe o serviço
cd ~/activity-manager/service && docker compose up -d
docker logs -f activity-backend        # espere "Started Aplicacao"
curl -fsS localhost:8091/api/saude     # {"estado":"ok"}
```

O `instalar.sh` gera o segredo do JWT, a senha do banco e o convite, e **imprime
o convite no fim** — é o que você digita uma vez em cada dispositivo.

Ele é idempotente: rodar de novo não sobrescreve `.env` que já tenha valor.
Regenerar o JWT derrubaria a sessão de todos os seus aparelhos.

## Subdomínio, sem abrir porta

Nada da VPS escuta no mundo: banco em `127.0.0.1:5434`, backend em
`127.0.0.1:8091`. Isso basta para o PC de casa por túnel SSH, mas **não serve
para o celular** — daí o Cloudflare Tunnel.

O `cloudflared` não recebe conexão: ele abre uma conexão de **saída** até a
Cloudflare, e o tráfego dos seus aparelhos volta por dentro dela. O firewall
continua fechado, o IP da VPS não aparece em lugar nenhum, e o TLS é resolvido
lá — não há certificado para renovar nem para esquecer de renovar.

No painel: **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**,
nome `activity-manager`. Em **Public Hostname → Add**:

| campo | valor |
|---|---|
| Subdomain | `rastro` |
| Domain | `matheuszem.org` |
| Service Type | `HTTP` |
| URL | `activity-backend:8090` |

`activity-backend:8090` e **não** `127.0.0.1:8091`: o conector roda *dentro* da
rede `activity-net`, junto do backend, e ali valem o nome do contêiner e a porta
de dentro. A 8091 é do host, e o contêiner não a enxerga.

Copie o token e:

```bash
sed -i "s|^AM_TUNEL_TOKEN=.*|AM_TUNEL_TOKEN=cole-aqui|" ~/activity-manager/service/.env
cd ~/activity-manager/service && docker compose --profile tunel up -d
docker logs -f activity-tunel          # espere "Registered tunnel connection"
```

O perfil `tunel` fica desligado por padrão porque ele é a **única** peça que
expõe o serviço na internet.

## Portas nesta VPS

| serviço | host |
|---|---|
| finance | 5432 / 8080 |
| lingua | 5433 / 8090 |
| **activity-manager** | **5434 / 8091** |

## A IA na VPS

O padrão é `AM_IA_PROVEDOR=local`: o servidor monta o prompt e o schema — que é
regra de negócio — mas **não chama modelo nenhum**. Ele enfileira, e um
dispositivo seu roda no `ollama` ou no `claude` daquela máquina e devolve.

É o único modo em que a VPS não precisa de chave. Para o servidor classificar
sozinho, troque para `anthropic`, `openai` ou `gemini` e preencha `AM_IA_CHAVE`.
