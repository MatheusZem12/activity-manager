-- Atividades e textos saem do arquivo e entram no banco.
--
-- A V1 criou as tabelas com o essencial; faltavam dois campos que o app já
-- usava e que se perderiam na migração dos JSON locais:
--
--   atividade.vence_em  o instante do alerta. É diferente de `alerta_min`:
--                       adiar reagenda o vencimento sem mudar o intervalo, e
--                       o alerta repete nesse mesmo intervalo até concluir.
--   texto.criado_em     a ordenação por "Recentes" depende disto, e
--                       `atualizado_em` muda a cada cópia.

alter table atividade add column vence_em timestamptz;
alter table texto     add column criado_em timestamptz not null default now();

-- A lista da tela é sempre "o que não foi apagado, mais recente primeiro".
create index atividade_vivas on atividade (usuario_id, criada_em desc) where apagada_em is null;
create index texto_vivos     on texto     (usuario_id, criado_em desc) where apagado_em is null;
