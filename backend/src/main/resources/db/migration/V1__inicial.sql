-- O esquema inicial.
--
-- Três domínios num banco só: atividades, textos (clipboard) e rastreio de
-- foco. Antes cada um era um JSON no userData do app; aqui eles passam a ter a
-- mesma forma e a mesma sincronização.

create table usuario (
    id           bigserial primary key,
    email        text        not null unique,
    senha_hash   text        not null,
    criado_em    timestamptz not null default now()
);

create table dispositivo (
    id           bigserial primary key,
    usuario_id   bigint      not null references usuario(id) on delete cascade,
    nome         text        not null,
    -- O que ESTA máquina consegue executar de IA. Não é segredo: é capacidade.
    -- Um desktop com ollama anuncia "ollama"; o celular não anuncia nada.
    executores   text[]      not null default '{}',
    visto_em     timestamptz not null default now(),
    criado_em    timestamptz not null default now(),
    unique (usuario_id, nome)
);

-- ------------------------------------------------------------- atividades
create table atividade (
    id            bigserial primary key,
    usuario_id    bigint      not null references usuario(id) on delete cascade,
    texto         text        not null,
    tags          text[]      not null default '{}',
    alerta_min    int,
    criada_em     timestamptz not null,
    concluida_em  timestamptz,
    -- Exclusão é lápide, nunca DELETE físico: sem isso um dispositivo offline
    -- ressuscita o que outro apagou na próxima sincronização.
    apagada_em    timestamptz,
    atualizada_em timestamptz not null default now()
);
create index atividade_por_usuario on atividade (usuario_id, atualizada_em);

-- ------------------------------------------------------- textos (clipboard)
create table texto (
    id            bigserial primary key,
    usuario_id    bigint      not null references usuario(id) on delete cascade,
    titulo        text        not null default '',
    -- Guardado LITERALMENTE, byte a byte: é o que vai para o clipboard.
    conteudo      text        not null,
    tags          text[]      not null default '{}',
    copias        int         not null default 0,
    copiado_em    timestamptz,
    apagado_em    timestamptz,
    atualizado_em timestamptz not null default now()
);
create index texto_por_usuario on texto (usuario_id, atualizado_em);

-- --------------------------------------------------------------- categorias
create table categoria (
    id            bigserial primary key,
    usuario_id    bigint      not null references usuario(id) on delete cascade,
    chave         text        not null,
    nome          text        not null,
    -- O campo que faz o trabalho pesado: é ele que entra no prompt. Sem
    -- descrição, o modelo classifica pela ideia DELE de "estudo"; com ela,
    -- classifica pela sua.
    descricao     text        not null default '',
    cor           text        not null default '#888888',
    ordem         int         not null default 0,
    apagada_em    timestamptz,
    atualizada_em timestamptz not null default now(),
    unique (usuario_id, chave)
);

-- Mudar uma categoria invalida as classificações feitas com a versão anterior.
-- O contador vive por usuário e sobe a cada alteração.
create table versao_categorias (
    usuario_id bigint primary key references usuario(id) on delete cascade,
    versao     int    not null default 1
);

-- -------------------------------------------------------------------- regras
-- Resolvem a maior parte dos segmentos sem IA nenhuma: classe de janela e/ou
-- um trecho do título bastam para dizer "isto é trabalho no projeto lingua".
create table regra (
    id            bigserial primary key,
    usuario_id    bigint      not null references usuario(id) on delete cascade,
    ordem         int         not null default 0,
    wm_class      text,
    titulo_regex  text,
    categoria_id  bigint      references categoria(id) on delete set null,
    projeto       text,
    apagada_em    timestamptz,
    atualizada_em timestamptz not null default now()
);
create index regra_por_usuario on regra (usuario_id, ordem);

-- ----------------------------------------------------------------- segmentos
create table segmento (
    id             bigserial primary key,
    usuario_id     bigint      not null references usuario(id) on delete cascade,
    dispositivo_id bigint      references dispositivo(id) on delete set null,
    inicio         timestamptz not null,
    fim            timestamptz not null,
    segundos       int         not null,

    -- Fatos, vindos do dispositivo.
    wm_class       text,
    titulo         text,
    travado        boolean     not null default false,
    midia          boolean     not null default false,

    -- Significado, derivado aqui. Colunas e não expressões porque o relatório
    -- agrupa por elas — e porque recalcular tudo quando a regra muda é um
    -- UPDATE, o que é justamente a vantagem de a regra morar no servidor.
    ocioso         boolean     not null default false,
    categoria_id   bigint      references categoria(id) on delete set null,
    projeto        text,
    origem         text        not null default 'pendente',   -- regra | cache | ia | manual | pendente

    criado_em      timestamptz not null default now(),
    unique (usuario_id, dispositivo_id, inicio)
);
create index segmento_por_periodo on segmento (usuario_id, inicio);
create index segmento_pendente on segmento (usuario_id) where origem = 'pendente';

-- ------------------------------------------------------------------- cache
-- Um título só é classificado uma vez. Guardar a versão das categorias é o que
-- permite invalidar sem apagar: mudou a descrição de "estudo", as entradas da
-- versão antiga voltam para a fila conforme reaparecem.
create table classificacao (
    id           bigserial primary key,
    usuario_id   bigint      not null references usuario(id) on delete cascade,
    chave        text        not null,
    categoria_id bigint      references categoria(id) on delete set null,
    confianca    text        not null default 'alta',
    versao       int         not null default 1,
    criada_em    timestamptz not null default now(),
    unique (usuario_id, chave)
);

-- -------------------------------------------------------- fila de execução
-- Só existe para o provedor `local`: o servidor monta prompt e schema, mas não
-- alcança o ollama nem o claude da sua máquina. O dispositivo pergunta o que há
-- para rodar, roda, e devolve. Ele não decide nada — é executor, não decisor.
create table ia_tarefa (
    id             bigserial primary key,
    usuario_id     bigint      not null references usuario(id) on delete cascade,
    prompt         text        not null,
    esquema        text        not null,
    chaves         text[]      not null,
    estado         text        not null default 'pendente',   -- pendente | reservada | concluida
    reservada_por  bigint      references dispositivo(id) on delete set null,
    reservada_ate  timestamptz,
    criada_em      timestamptz not null default now()
);
create index ia_tarefa_fila on ia_tarefa (usuario_id, estado, criada_em);
