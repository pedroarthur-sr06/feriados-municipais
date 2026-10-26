/**
 * Interface do arquivo HTML offline.
 *
 * O motor de resolução, o helper de calendário e o módulo do veredito são
 * embutidos pelo gerador a partir de `dist/` — este arquivo só cuida da tela.
 * Nenhuma lógica de feriado mora aqui, de propósito: se morasse, o offline e
 * o servidor começariam a divergir na primeira correção feita só de um lado.
 *
 * Globais fornecidas pelo gerador:
 *   MOTOR.consultarDia / consultarPeriodo / montarGradeCalendario /
 *        montarVeredito / porExtenso / DESCRICAO_CAMADA / nomeMes
 *   DADOS.geradoEm, DADOS.municipios, DADOS.feriados
 */
(function () {
  "use strict";

  // --- dados -------------------------------------------------------------

  // Índice de feriados por UF e por município: sem isso, cada consulta
  // varreria os 8 mil registros. Montado uma vez na abertura.
  const porUf = new Map();
  const porMunicipio = new Map();
  const municipiosComCuradoria = new Set();
  for (const f of DADOS.feriados) {
    if (f.abrangencia === "uf") {
      if (!porUf.has(f.uf)) porUf.set(f.uf, []);
      porUf.get(f.uf).push(f);
    } else if (f.codigoIbge != null) {
      if (!porMunicipio.has(f.codigoIbge)) porMunicipio.set(f.codigoIbge, []);
      porMunicipio.get(f.codigoIbge).push(f);
      if (f.tipo === "municipal") municipiosComCuradoria.add(f.codigoIbge);
    }
  }

  function curadosDe(m) {
    return (porUf.get(m.uf) || []).concat(porMunicipio.get(m.codigoIbge) || []);
  }

  const semAcento = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const municipiosIndexados = DADOS.municipios.map((m) => ({ ...m, busca: semAcento(m.nome) }));

  function buscarMunicipios(termo, limite) {
    const t = semAcento(termo.trim());
    if (t.length < 2) return [];
    const comeca = [], contem = [];
    for (const m of municipiosIndexados) {
      if (m.busca.startsWith(t)) comeca.push(m);
      else if (m.busca.includes(t)) contem.push(m);
      if (comeca.length >= limite) break;
    }
    return comeca.concat(contem).slice(0, limite);
  }

  // --- consulta ----------------------------------------------------------

  const parseIso = (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || "");
    if (!m) return null;
    const ano = +m[1], mes = +m[2], dia = +m[3];
    const d = new Date(Date.UTC(ano, mes - 1, dia));
    if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
    return { ano, mes, dia };
  };
  const iso = ({ ano, mes, dia }) =>
    ano + "-" + String(mes).padStart(2, "0") + "-" + String(dia).padStart(2, "0");

  function consultarDia(m, data) {
    return MOTOR.consultarDia({ ...data, uf: m.uf, codigoIbge: m.codigoIbge, feriadosCurados: curadosDe(m) });
  }
  // consultarPeriodo devolve o array de dias direto, e os parâmetros se
  // chamam dataInicio/dataFim — mesma assinatura que o serviço usa.
  function consultarMes(m, ano, mes) {
    const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    return MOTOR.consultarPeriodo({
      dataInicio: { ano, mes, dia: 1 }, dataFim: { ano, mes, dia: ultimo },
      uf: m.uf, codigoIbge: m.codigoIbge, feriadosCurados: curadosDe(m),
    });
  }

  // --- apresentação ------------------------------------------------------

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function htmlVeredito(res, m, contexto) {
    const v = MOTOR.montarVeredito(res, m.nome);
    return (
      '<div class="bloco-veredito">' +
      '<p class="linha-contexto">' + esc(contexto) + "</p>" +
      '<h2 class="veredito camada-' + v.camada + '">' + esc(v.frase) + "</h2>" +
      (v.nota ? '<p class="veredito-nota">' + esc(v.nota) + "</p>" : "") +
      "</div>"
    );
  }

  function htmlOcorrencia(o) {
    return (
      '<article class="ocorrencia camada-' + o.camada + '">' +
      '<strong class="ocorrencia-nome">' + esc(o.nome) + "</strong>" +
      '<p class="ocorrencia-camada">' + esc(MOTOR.DESCRICAO_CAMADA[o.camada]) + " — " + esc(MOTOR.porExtenso(o.data)) + "</p>" +
      '<p class="ocorrencia-fonte">' + esc(o.baseLegal) +
        (o.fonteUrl ? ' <a href="' + esc(o.fonteUrl) + '" target="_blank" rel="noopener noreferrer">ver fonte</a>' : "") +
      "</p>" +
      (o.dataVerificacao ? '<p class="ocorrencia-verificacao">Conferido em ' + esc(MOTOR.porExtenso(o.dataVerificacao)) + "</p>" : "") +
      "</article>"
    );
  }

  function htmlCalendario(ano, mes, semanas, destaque) {
    // Classes, title e marcador vêm de MOTOR.apresentarCalendario — o mesmo
    // módulo que o template do servidor usa.
    const grade = MOTOR.apresentarCalendario(semanas, destaque || undefined);
    let h = '<div class="calendario-wrap"><p class="calendario-titulo">' +
            esc(MOTOR.nomeMes(mes)) + " de " + ano + "</p>";
    h += '<table class="calendario"><thead><tr>';
    for (const d of MOTOR.DIAS_CABECALHO) {
      h += '<th scope="col" class="' + (d.fimDeSemana ? "fim-de-semana" : "") + '">' + d.rotulo + "</th>";
    }
    h += "</tr></thead><tbody>";
    for (const semana of grade) {
      h += "<tr>";
      for (const c of semana) {
        if (c.dia === null) { h += '<td class="' + c.classes + '"></td>'; continue; }
        h += '<td class="' + c.classes + '"' + (c.titulo ? ' title="' + esc(c.titulo) + '"' : "") + ">" +
             c.dia + (c.marcador ? '<span class="marcador-multiplo">' + c.marcador + "</span>" : "") +
             "</td>";
      }
      h += "</tr>";
    }
    return h + "</tbody></table></div>";
  }

  const LEGENDA =
    '<ul class="legenda" role="list">' +
    [["nacional", "Nacional"], ["estadual", "Estadual"], ["municipal", "Municipal"],
     ["facultativo", "Ponto facultativo"]].map(([k, r]) =>
      '<li class="legenda-item"><span class="legenda-swatch" style="background: var(--' + k + '-bg); border-color: var(--' + k + ');"></span> ' + r + "</li>").join("") +
    '<li class="legenda-item"><span class="legenda-swatch" style="background: var(--util-bg); border-color: var(--linha-forte);"></span> Dia útil (confirmado)</li>' +
    '<li class="legenda-item"><span class="legenda-swatch legenda-swatch-hachura"></span> Não verificado</li>' +
    "</ul>";

  // --- telas -------------------------------------------------------------

  const $ = (s) => document.querySelector(s);
  const alvo = $("#resultado");
  let ultimoPeriodo = null; // guarda o que exportar

  function erro(msg) {
    alvo.innerHTML = '<div class="erro" role="alert">' + esc(msg) + "</div>";
  }

  function responderDia(m, data) {
    const res = consultarDia(m, data);
    const semanas = MOTOR.montarGradeCalendario(data.ano, data.mes, consultarMes(m, data.ano, data.mes));
    const contexto = m.nome + "/" + m.uf + ", " + res.diaSemana + ", " + MOTOR.porExtenso(res.data);

    alvo.innerHTML =
      htmlVeredito(res, m, contexto) +
      '<div class="resposta-corpo"><div class="resposta-provas">' +
      (res.ocorrencias.length
        ? '<div class="lista-ocorrencias">' + res.ocorrencias.map(htmlOcorrencia).join("") + "</div>"
        : '<p class="sem-prova">Nenhuma ocorrência nesta data — não há norma a citar.</p>') +
      '</div><aside class="resposta-mes">' + htmlCalendario(data.ano, data.mes, semanas, res.data) + LEGENDA + "</aside></div>";
    ultimoPeriodo = null;
  }

  function responderPeriodo(m, inicio, fim) {
    const dias = MOTOR.consultarPeriodo({
      dataInicio: inicio, dataFim: fim, uf: m.uf, codigoIbge: m.codigoIbge, feriadosCurados: curadosDe(m),
    });
    const comOcorrencia = dias.filter((d) => d.ocorrencias.length > 0);
    const qtd = comOcorrencia.length;
    const contexto = m.nome + "/" + m.uf + ", de " + MOTOR.porExtenso(iso(inicio)) + " a " + MOTOR.porExtenso(iso(fim));

    const meses = [];
    for (const d of dias) {
      const chave = d.data.slice(0, 7);
      if (!meses.includes(chave)) meses.push(chave);
    }
    const calendarios = meses.map((chave) => {
      const ano = +chave.slice(0, 4), mes = +chave.slice(5, 7);
      return htmlCalendario(ano, mes, MOTOR.montarGradeCalendario(ano, mes, consultarMes(m, ano, mes)), null);
    }).join("");

    alvo.innerHTML =
      '<div class="bloco-veredito"><p class="linha-contexto">' + esc(contexto) + "</p>" +
      '<h2 class="veredito camada-' + (qtd > 0 ? "estadual" : "util") + '">' +
      (qtd === 0 ? "Nenhum dia não útil" : qtd === 1 ? "1 dia não útil" : qtd + " dias não úteis") + "</h2>" +
      '<p class="veredito-nota">Em ' + dias.length + " dias do período" +
      (qtd > 0 ? ", classificados abaixo com a fonte de cada um" : "") + ".</p></div>" +
      '<div class="resposta-painel"><div class="exportar-links">' +
      '<button type="button" class="botao-secundario" id="exportar">Exportar CSV do período</button></div>' +
      (qtd > 0 ? '<div class="lista-ocorrencias">' +
        comOcorrencia.map((d) => d.ocorrencias.map(htmlOcorrencia).join("")).join("") + "</div>" : "") +
      "</div>" +
      '<div class="calendarios-periodo">' + calendarios + "</div>" + LEGENDA;

    ultimoPeriodo = { municipio: m, dias };
    $("#exportar").addEventListener("click", exportarCsv);
  }

  // --- exportação --------------------------------------------------------

  function exportarCsv() {
    if (!ultimoPeriodo) return;
    const { municipio: m, dias } = ultimoPeriodo;
    const campo = (v) => {
      const s = String(v == null ? "" : v);
      return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const linhas = [["data", "dia_semana", "municipio", "uf", "classificacao", "tipos", "fonte", "status_municipal"]];
    for (const d of dias) {
      const v = MOTOR.montarVeredito(d, m.nome);
      linhas.push([
        d.data, d.diaSemana, m.nome, m.uf,
        v.frase + (d.ocorrencias.length ? ": " + d.ocorrencias.map((o) => o.nome).join(" / ") : ""),
        d.ocorrencias.map((o) => o.camada).join(" / "),
        d.ocorrencias.map((o) => o.baseLegal).join(" | "),
        d.statusMunicipal,
      ]);
    }
    // BOM para o Excel abrir os acentos certos.
    const csv = "﻿" + linhas.map((l) => l.map(campo).join(",")).join("\r\n");
    const nome = "feriados-" + semAcento(m.nome).replace(/[^a-z0-9]+/g, "-") + "-" + m.uf.toLowerCase() +
                 "-" + dias[0].data + "-a-" + dias[dias.length - 1].data + ".csv";
    baixar(new Blob([csv], { type: "text/csv;charset=utf-8" }), nome);
  }

  function baixar(blob, nome) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // --- combobox de município --------------------------------------------

  const campo = $("#municipio-busca");
  const lista = $("#lista-municipios");
  const oculto = { valor: null }; // o município escolhido, não só o texto
  let indiceAtivo = -1;

  const SEM_MUNICIPIO = "Escolha um município na lista de sugestões.";
  const opcoes = () => Array.from(lista.querySelectorAll("[role='option']"));
  const validar = () => campo.setCustomValidity(oculto.valor ? "" : SEM_MUNICIPIO);

  function fecharLista() {
    lista.innerHTML = "";
    indiceAtivo = -1;
    campo.setAttribute("aria-expanded", "false");
    campo.removeAttribute("aria-activedescendant");
  }

  function abrirLista(termo) {
    const achados = buscarMunicipios(termo, 10);
    if (achados.length === 0) {
      lista.innerHTML = termo.trim().length >= 2
        ? '<p class="sem-resultado">Nenhum município encontrado para “' + esc(termo.trim()) + "”.</p>"
        : "";
      campo.setAttribute("aria-expanded", "false");
      return;
    }
    lista.innerHTML = '<ul class="sugestoes" role="listbox" aria-label="Municípios encontrados">' +
      achados.map((m, i) =>
        '<li role="presentation"><button type="button" role="option" id="municipio-opcao-' + i +
        '" aria-selected="false" data-codigo="' + m.codigoIbge + '">' +
        esc(m.nome) + ' <span class="uf">/ ' + esc(m.uf) + "</span></button></li>").join("") +
      "</ul>";
    indiceAtivo = -1;
    campo.setAttribute("aria-expanded", "true");
  }

  function destacar(novo) {
    const itens = opcoes();
    if (!itens.length) return;
    indiceAtivo = (novo + itens.length) % itens.length;
    itens.forEach((b, i) => {
      const ativo = i === indiceAtivo;
      b.classList.toggle("ativo", ativo);
      b.setAttribute("aria-selected", ativo ? "true" : "false");
      if (ativo) { campo.setAttribute("aria-activedescendant", b.id); b.scrollIntoView({ block: "nearest" }); }
    });
  }

  function escolher(botao) {
    const m = municipiosIndexados.find((x) => x.codigoIbge === +botao.dataset.codigo);
    oculto.valor = m;
    campo.value = m.nome + " / " + m.uf;
    campo.style.width = "";
    fecharLista();
    validar();
    const datas = Array.from(document.querySelectorAll("input[type='date']"));
    const visivel = datas.find((i) => i.offsetParent !== null);
    if (visivel) visivel.focus();
  }

  campo.addEventListener("input", () => {
    if (oculto.valor) oculto.valor = null;
    validar();
    abrirLista(campo.value);
  });
  campo.addEventListener("focus", () => { if (campo.value.trim().length >= 2) abrirLista(campo.value); });
  campo.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); destacar(indiceAtivo + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); destacar(indiceAtivo - 1); }
    else if (e.key === "Escape") fecharLista();
    else if (e.key === "Enter") {
      const itens = opcoes();
      const alvoItem = itens[indiceAtivo] || (itens.length === 1 ? itens[0] : null);
      if (alvoItem) { e.preventDefault(); escolher(alvoItem); }
    }
  });
  lista.addEventListener("click", (e) => {
    const b = e.target.closest("[role='option']");
    if (b) escolher(b);
  });
  document.addEventListener("click", (e) => {
    if (!campo.contains(e.target) && !lista.contains(e.target)) fecharLista();
  });

  // --- formulário --------------------------------------------------------

  const form = $("#form-consulta");
  const modoDe = () => (form.querySelector("input[name='modo']:checked") || {}).value || "dia";

  function aplicarModo() {
    const periodo = modoDe() === "periodo";
    $("#campo-dia").hidden = periodo;
    $("#campo-periodo").hidden = !periodo;
    $("#data").required = !periodo;
    $("#dataInicio").required = periodo;
    $("#dataFim").required = periodo;
  }
  form.querySelectorAll("input[name='modo']").forEach((r) => r.addEventListener("change", aplicarModo));
  aplicarModo();

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const m = oculto.valor;
    if (modoDe() === "dia") {
      const d = parseIso($("#data").value);
      if (!d) return erro("Escolha uma data válida.");
      responderDia(m, d);
    } else {
      const i = parseIso($("#dataInicio").value), f = parseIso($("#dataFim").value);
      if (!i || !f) return erro("Escolha as duas datas do período (De / Até).");
      const ms = (x) => Date.UTC(x.ano, x.mes - 1, x.dia);
      if (ms(i) > ms(f)) return erro('"De" precisa ser antes ou igual a "Até".');
      if (Math.round((ms(f) - ms(i)) / 86400000) + 1 > 370) return erro("Período máximo de consulta: 370 dias.");
      responderPeriodo(m, i, f);
    }
    alvo.scrollIntoView({ block: "start", behavior: "smooth" });
  });

  validar();
})();
