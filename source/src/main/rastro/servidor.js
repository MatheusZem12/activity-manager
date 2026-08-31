/**
 * O endereço do servidor. Constante, não configuração.
 *
 * Já foi um campo na tela, e estava errado: o endereço não é uma preferência do
 * usuário — é onde este app vive. Campo editável só cria uma forma de digitar
 * errado e ficar com um app que não sincroniza e não diz por quê.
 *
 * AM_SERVIDOR existe para desenvolvimento (apontar para o backend local sem
 * mexer em código) e não aparece em lugar nenhum da interface.
 */
const PRODUCAO = 'https://activity-manager.matheuszem.org';

function endereco() {
  return (process.env.AM_SERVIDOR || PRODUCAO).replace(/\/+$/, '');
}

module.exports = { endereco, PRODUCAO };
