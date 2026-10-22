/**
 * Campo de município da tela de Consulta: combobox navegável por teclado e,
 * principalmente, a trava que impede a consulta de sair com um município
 * diferente do que está escrito no campo.
 *
 * O problema que isto resolve: o nome é texto livre, mas o que o servidor
 * recebe é o código IBGE, guardado num input escondido no momento em que a
 * pessoa clica numa sugestão. Se ela depois apagasse o texto e digitasse
 * outra cidade sem clicar na lista, o código antigo continuava lá — e a
 * resposta vinha sobre a cidade anterior, afirmando o nome dela com todas as
 * letras. Num documento que vai para fechamento de folha, isso é pior do que
 * não responder. Aqui o código é apagado a cada tecla digitada e só volta por
 * escolha explícita; sem código, o formulário não envia.
 *
 * A validação usa setCustomValidity em vez de uma mensagem desenhada à mão:
 * o htmx respeita a validação nativa, então o pedido nem sai, o aviso aparece
 * colado no campo errado e o leitor de tela anuncia sem precisar de ARIA
 * extra.
 */
(function () {
  const form = document.getElementById("form-consulta");
  const campo = document.getElementById("municipio-busca");
  const oculto = document.getElementById("codigoIbge");
  const lista = document.getElementById("lista-municipios");
  const confirmacao = document.getElementById("municipio-selecionado");
  const ancora = document.getElementById("ancora-municipio");
  if (!form || !campo || !oculto || !lista) return;

  const SEM_MUNICIPIO = "Escolha um município na lista de sugestões.";
  let indiceAtivo = -1;

  const opcoes = () => Array.from(lista.querySelectorAll("[role='option']"));

  function sincronizarValidade() {
    campo.setCustomValidity(oculto.value ? "" : SEM_MUNICIPIO);
  }

  function fecharLista() {
    lista.innerHTML = "";
    indiceAtivo = -1;
    campo.setAttribute("aria-expanded", "false");
    campo.removeAttribute("aria-activedescendant");
  }

  function destacar(novoIndice) {
    const itens = opcoes();
    if (itens.length === 0) return;
    indiceAtivo = (novoIndice + itens.length) % itens.length;
    itens.forEach(function (botao, i) {
      const ativo = i === indiceAtivo;
      botao.classList.toggle("ativo", ativo);
      botao.setAttribute("aria-selected", ativo ? "true" : "false");
      if (ativo) {
        campo.setAttribute("aria-activedescendant", botao.id);
        botao.scrollIntoView({ block: "nearest" });
      }
    });
  }

  function selecionar(botao) {
    const nome = botao.dataset.nome;
    const uf = botao.dataset.uf;
    oculto.value = botao.dataset.codigo;
    campo.value = nome + " / " + uf;
    if (confirmacao) confirmacao.textContent = "Selecionado: " + nome + "/" + uf;
    if (ancora) ancora.classList.add("preenchida");
    // A lacuna encolhe no nome escolhido: solta, ela deixaria um traço longo
    // sobrando depois da palavra e a frase pararia de parecer uma frase.
    campo.style.width = (campo.value.length + 1) + "ch";
    fecharLista();
    sincronizarValidade();
    // Escolhido o município, o passo seguinte é sempre a data — levar o foco
    // para lá poupa um clique em quem consulta dezenas de datas por dia.
    // offsetParent em vez de ler o style: quem esconde o campo é o x-show.
    const datas = Array.from(form.querySelectorAll("input[type='date']"));
    const visivel = datas.find(function (i) { return i.offsetParent !== null; });
    if (visivel) visivel.focus();
  }

  // Qualquer digitação invalida a escolha anterior. É esta linha que impede a
  // consulta de responder sobre a cidade errada.
  campo.addEventListener("input", function () {
    if (oculto.value) {
      oculto.value = "";
      if (confirmacao) confirmacao.textContent = "";
      if (ancora) ancora.classList.remove("preenchida");
      campo.style.width = "";
    }
    sincronizarValidade();
  });

  campo.addEventListener("keydown", function (evt) {
    if (evt.key === "ArrowDown") {
      evt.preventDefault();
      destacar(indiceAtivo + 1);
    } else if (evt.key === "ArrowUp") {
      evt.preventDefault();
      destacar(indiceAtivo - 1);
    } else if (evt.key === "Escape") {
      fecharLista();
    } else if (evt.key === "Enter") {
      // Com a lista aberta, Enter escolhe em vez de enviar o formulário.
      // Lista de um item só não precisa de seta para baixo antes.
      const itens = opcoes();
      const alvo = itens[indiceAtivo] || (itens.length === 1 ? itens[0] : null);
      if (alvo) {
        evt.preventDefault();
        selecionar(alvo);
      }
    }
  });

  lista.addEventListener("click", function (evt) {
    const botao = evt.target.closest("[role='option']");
    if (botao) selecionar(botao);
  });

  // O htmx acabou de trocar a lista: a navegação por teclado recomeça do zero.
  lista.addEventListener("htmx:afterSwap", function () {
    indiceAtivo = -1;
    campo.setAttribute("aria-expanded", opcoes().length > 0 ? "true" : "false");
    campo.removeAttribute("aria-activedescendant");
  });

  document.addEventListener("click", function (evt) {
    if (!campo.contains(evt.target) && !lista.contains(evt.target)) fecharLista();
  });

  // Rede de segurança: se por algum motivo a validação nativa não barrar o
  // envio, o pedido do htmx é cancelado aqui. Os pedidos do autocomplete
  // também borbulham até o formulário, por isso o teste de alvo.
  form.addEventListener("htmx:beforeRequest", function (evt) {
    if (evt.target !== form) return;
    if (!form.checkValidity()) {
      evt.preventDefault();
      form.reportValidity();
    }
  });

  sincronizarValidade();
})();
