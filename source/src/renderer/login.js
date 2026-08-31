/**
 * A tela de entrada.
 *
 * Ela toma o painel inteiro enquanto não há sessão, e não é teimosia: atividades
 * e textos moram no banco agora. Mostrar as abas vazias e deixar a pessoa
 * descobrir sozinha que nada salva seria pior do que pedir o login de uma vez.
 *
 * Não há campo de servidor. O endereço é constante — veja
 * `src/main/rastro/servidor.js`. Endereço editável só cria uma forma de digitar
 * errado e ficar com um app que não sincroniza e não diz por quê.
 */

/* global RastroAPI */

const Login = (() => {
  let erro = null;
  let ocupado = false;
  let servidor = '';
  let primeiraVez = false;

  function esc(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function render(container, aoEntrar) {
    const estado = await RastroAPI.estado();
    servidor = estado.servidor;

    container.innerHTML = `
      <div class="login">
        <div class="login-marca">
          <span>Activity</span> Manager
        </div>

        <p class="login-servidor">${esc(servidor.replace(/^https?:\/\//, ''))}</p>

        ${erro ? `<div class="login-erro">${esc(erro)}</div>` : ''}

        <form class="login-form" id="login-form">
          <label for="login-email">E-mail</label>
          <input id="login-email" type="email" autocomplete="username" required autofocus>

          <label for="login-senha">Senha</label>
          <input id="login-senha" type="password" autocomplete="current-password" required>

          <label class="login-alternar">
            <input type="checkbox" id="login-primeira" ${primeiraVez ? 'checked' : ''}>
            É a primeira vez nesta conta
          </label>

          <div id="login-convite-campo" class="${primeiraVez ? '' : 'oculto'}">
            <label for="login-convite">Convite</label>
            <input id="login-convite" type="text" autocomplete="off">
            <p class="login-dica">
              O convite fica no servidor, em
              <code>~/activity-manager/service/.env</code>, na linha
              <code>AM_CONVITE</code>. Só é pedido ao criar a conta.
            </p>
          </div>

          <button type="submit" id="login-entrar">Entrar</button>
        </form>

        <p class="login-rodape">
          A sessão fica só nesta máquina. Este dispositivo se identifica
          como <b>${esc(estado.dispositivo)}</b>.
        </p>
      </div>
    `;

    const marcador = container.querySelector('#login-primeira');
    const campo = container.querySelector('#login-convite-campo');
    marcador.addEventListener('change', () => {
      primeiraVez = marcador.checked;
      campo.classList.toggle('oculto', !primeiraVez);
      if (primeiraVez) container.querySelector('#login-convite').focus();
    });

    container.querySelector('#login-form').addEventListener('submit', async (evento) => {
      evento.preventDefault();
      if (ocupado) return;

      const botao = container.querySelector('#login-entrar');
      ocupado = true;
      botao.disabled = true;
      botao.textContent = 'Entrando…';
      erro = null;

      try {
        await RastroAPI.entrar({
          email: container.querySelector('#login-email').value.trim(),
          senha: container.querySelector('#login-senha').value,
          convite: primeiraVez ? container.querySelector('#login-convite').value.trim() : ''
        });
        aoEntrar();
      } catch (e) {
        // A mensagem do servidor é melhor que qualquer genérica daqui: ele sabe
        // se foi senha errada, convite inválido ou limite de contas.
        erro = e.message.replace(/^Error:\s*/, '');
        // Convite ausente quase sempre quer dizer conta nova sem a caixa marcada.
        if (/convite/i.test(erro) && !primeiraVez) primeiraVez = true;
        ocupado = false;
        render(container, aoEntrar);
      }
    });
  }

  return { render };
})();
