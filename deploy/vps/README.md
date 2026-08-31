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

Na raiz do home, e **não** junto do lingua em `~/sevices`: são projetos
independentes, com bancos, redes e ciclos de atualização separados. Como root,
isso é `/root/activity-manager`.

Separados porque os ciclos de vida são diferentes: o backend muda a cada push, o
Postgres quase nunca. Atualizar um não pode ter nada a ver com derrubar o outro.
Os dois se encontram pela rede `activity-net`, que é **externa** aos dois
composes — criada uma vez, e nenhum dos dois a destrói ao descer.

## Passo a passo

O `instalar.sh` é **um arquivo só e autossuficiente** — os dois composes estão
embutidos nele. Na VPS você não tem o repositório, e levar uma árvore de
diretórios por `scp` é justamente o passo em que dá errado.

**A branch que sobe é `hmg`, não `dev`.** Igual ao lingua: `dev` é onde se
trabalha e não publica imagem nenhuma; o merge em `hmg` é o ato deliberado de
publicar.

```bash
# 1. NA SUA MÁQUINA: publica a imagem
git checkout hmg && git merge dev && git push

# 2. NA SUA MÁQUINA: manda só o script.
#    Troque root@SEU-IP pelo endereço real da VPS — não é literal.
scp deploy/vps/instalar.sh root@SEU-IP:~/

# 3. NA VPS
bash ~/instalar.sh

# 4. Ainda na VPS: sobe o serviço
cd ~/activity-manager/service && docker compose up -d
docker logs -f activity-backend        # espere "Started Aplicacao"
curl -fsS localhost:8091/api/saude     # {"estado":"ok"}
```

Se preferir não usar `scp`, estando já conectado na VPS dá para colar o script
inteiro num heredoc:

```bash
cat > ~/instalar.sh <<'FIM'
   (cole aqui o conteúdo de deploy/vps/instalar.sh)
FIM
bash ~/instalar.sh
```

O script **escolhe porta livre sozinho**. Nesta VPS a 5432/8080 é do finance e a
5433/8090 é do lingua, então ele tende a pegar 5434/8091 — mas se estiverem
ocupadas, ele anda para a próxima e grava a escolhida no `.env`, em vez de
morrer com um "Bind for 0.0.0.0:5434 failed" que não diz o que fazer.


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

## Recomeçar do zero

```bash
scp deploy/vps/limpar.sh root@SEU-IP:~/     # no seu PC
bash ~/limpar.sh                            # na VPS — pede confirmação
bash ~/instalar.sh
```

Apaga contêineres, volumes, rede e a pasta inteira — inclusive os `.env`. O
convite e o segredo do JWT são regerados, então as sessões dos aparelhos morrem
e você entra de novo em cada um.

Cada nome no script é literal e do activity-manager: não há `prune`, nem filtro
por padrão, nem `-a`. Um `docker system prune` levaria junto imagem e volume do
lingua e do finance.

## Testar

```bash
scp deploy/vps/verificar.sh root@SEU-IP:~/     # no seu PC
bash ~/verificar.sh                            # na VPS
```

Ele checa sete camadas em ordem e **para na primeira que falhar**, dizendo o que
fazer — seguir adiante só produziria erros em cascata que escondem a causa:

```
1. Rede          activity-net existe?
2. Banco         postgres_activity saudável?
3. Imagem        o GHCR tem :dev, e a VPS consegue puxar?
4. Serviço       activity-backend saudável?
5. API           responde em 127.0.0.1:8091?
6. Túnel         cloudflared registrou conexão?
7. Função        quantas contas existem, e qual é o convite
```

Não muda nada e pode rodar quantas vezes quiser.

## Watchtower: o deploy é o push

Esta VPS já roda um Watchtower (do compose do finance), com
`WATCHTOWER_LABEL_ENABLE: false` — ele vigia **todos** os contêineres da
máquina. Não há um segundo aqui, pelo mesmo motivo do lingua: seriam dois
processos disputando o mesmo `/var/run/docker.sock`, e ambos usam
`container_name: watchtower`.

O ciclo, depois da primeira instalação:

```
git push  ─>  Actions constrói  ─>  GHCR :dev  ─>  Watchtower puxa  ─>  recria
```

Nada a fazer na VPS.

Como ele vigia tudo, o `postgres:16` também é atualizado quando sai um patch —
mesma situação do lingua. Patch de Postgres não quebra compatibilidade; o que
custa é o reinício do contêiner. Se um dia isso incomodar, o rótulo
`com.centurylinklabs.watchtower.enable: "false"` no serviço `db` tira o banco
da lista.

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
