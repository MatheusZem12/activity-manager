/**
 * O cliente da API. Fino de propósito.
 *
 * Nada aqui decide nada sobre o seu dia: só empacota HTTP. Toda regra de
 * negócio — o que é ocioso, que categoria é qual, o que ainda falta
 * classificar — vive no backend. Este arquivo leva fatos e traz respostas.
 */
const CABECALHO_JSON = { 'content-type': 'application/json' };

class Api {
  constructor({ url, token } = {}) {
    this.url = (url || '').replace(/\/+$/, '');
    this.token = token || null;
  }

  get configurado() {
    return Boolean(this.url && this.token);
  }

  async pedir(caminho, { metodo = 'GET', corpo, autenticado = true } = {}) {
    const cabecalhos = { ...CABECALHO_JSON };
    if (autenticado) {
      if (!this.token) throw new Error('sem sessão: entre em Configurações → Conta');
      cabecalhos.authorization = `Bearer ${this.token}`;
    }
    const resposta = await fetch(`${this.url}${caminho}`, {
      method: metodo,
      headers: cabecalhos,
      body: corpo === undefined ? undefined : JSON.stringify(corpo)
    });
    const texto = await resposta.text();
    const dados = texto ? JSON.parse(texto) : {};
    if (!resposta.ok) {
      // O servidor já escreve a frase que a pessoa deve ler; repassar é melhor
      // do que traduzir código de status aqui.
      throw new Error(dados.erro || `servidor respondeu ${resposta.status}`);
    }
    return dados;
  }

  entrar({ email, senha, convite }) {
    return this.pedir('/api/sessao', {
      metodo: 'POST', autenticado: false, corpo: { email, senha, convite }
    });
  }

  enviarSegmentos(lote) {
    return this.pedir('/api/segmentos', { metodo: 'POST', corpo: lote });
  }

  enfileirar() {
    return this.pedir('/api/ia/enfileirar', { metodo: 'POST' });
  }

  pedirTarefa(dispositivo) {
    return this.pedir(`/api/ia/pendentes?dispositivo=${encodeURIComponent(dispositivo)}`);
  }

  devolverResultado(tarefa, itens) {
    return this.pedir('/api/ia/resultado', { metodo: 'POST', corpo: { tarefa, itens } });
  }

  relatorio(de, ate) {
    const q = new URLSearchParams({ de, ate });
    return this.pedir(`/api/relatorio?${q}`);
  }

  categorias() {
    return this.pedir('/api/categorias');
  }
}

module.exports = { Api };
