/**
 * Gera `offline/feriados-municipais.html`: um arquivo único, sem servidor,
 * que responde as mesmas consultas de dia e de período citando a mesma fonte.
 *
 *   npm run html
 *
 * Para que serve: o time de DP pode guardar o arquivo numa pasta da rede ou
 * no próprio computador e abrir com dois cliques. Não instala nada, não
 * precisa do Node, funciona sem internet.
 *
 * Por que tudo numa página só: aberto por `file://`, o navegador bloqueia
 * `fetch` de arquivos vizinhos. Dados, motor, estilo e imagens têm de estar
 * dentro do HTML — daí o tamanho.
 *
 * O que ele NÃO faz, e por quê:
 *   - administração (cadastrar/editar feriado): escreve no banco, exige o servidor;
 *   - lote de planilha e exportação em PDF: ficam na versão servida.
 *
 * O motor, o calendário e o veredito são embutidos a partir de `dist/`, nunca
 * reescritos aqui. É isso que impede o arquivo offline de responder diferente
 * do servidor sobre o mesmo dia.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import Database from "better-sqlite3";

const SAIDA = "offline/feriados-municipais.html";
const DB = process.env.DATABASE_PATH ?? "data/holidays.db";

// ---------------------------------------------------------------------------
// 1. Motor: concatena os módulos compilados, em ordem de dependência.
// ---------------------------------------------------------------------------

const MODULOS = [
  "dist/motor/pascoa.js",
  "dist/motor/feriados-nacionais.js",
  "dist/motor/resolver.js",
  "dist/web/calendario.js",
  "dist/web/veredito.js",
];

const EXPOSTOS = [
  "consultarDia", "consultarPeriodo", "montarGradeCalendario", "apresentarCalendario",
  "DIAS_CABECALHO", "montarVeredito", "porExtenso", "DESCRICAO_CAMADA", "nomeMes",
];

function empacotarMotor() {
  const partes = MODULOS.map((caminho) => {
    let js;
    try {
      js = readFileSync(caminho, "utf8");
    } catch {
      throw new Error(`${caminho} não existe. Rode "npm run build" antes de "npm run html".`);
    }
    // Os módulos só usam import relativo de uma linha e export nomeado — tudo
    // vira escopo único dentro da IIFE. Qualquer forma diferente (default,
    // import de várias linhas, dependência externa) para aqui em vez de gerar
    // um arquivo silenciosamente quebrado.
    for (const linha of js.split("\n")) {
      if (/^\s*import\s/.test(linha) && !/^import\s+\{[^}]*\}\s+from\s+"\.\/[^"]+";\s*$/.test(linha.trim())) {
        throw new Error(`${caminho}: import não suportado pelo empacotador — "${linha.trim()}"`);
      }
      if (/^\s*export\s+default/.test(linha)) {
        throw new Error(`${caminho}: export default não é suportado pelo empacotador`);
      }
    }
    return js
      .split("\n")
      .filter((l) => !/^\s*import\s.*from\s+"\.\//.test(l))
      .map((l) => l.replace(/^export\s+(?=(function|const|let|class)\s)/, ""))
      .filter((l) => l.trim() !== "export {};")
      .join("\n");
  });

  return `const MOTOR = (function () {\n${partes.join("\n")}\nreturn { ${EXPOSTOS.join(", ")} };\n})();`;
}

// ---------------------------------------------------------------------------
// 2. Dados: tuplas em vez de objetos e tabela de textos repetidos. O JSON cru
//    com chaves em cada linha passa de 4 MB; assim fica perto da metade, e a
//    diferença aparece no tempo de abrir o arquivo.
// ---------------------------------------------------------------------------

function lerDados() {
  const db = new Database(DB, { readonly: true });
  const municipios = db.prepare("select codigo_ibge, nome, uf from municipios order by nome").all();
  const feriados = db.prepare(`
    select f.nome, t.chave tipo, f.abrangencia, f.uf, f.codigo_ibge, f.mes, f.dia,
           f.regra_calculo, f.ano_inicio, f.ano_fim, fo.descricao fonte, fo.url,
           f.data_verificacao
      from feriados f
      join tipos_feriado t on t.id = f.tipo_feriado_id
      join fontes fo on fo.id = f.fonte_id
     where f.ativo = 1`).all();
  const contagens = {
    municipios: municipios.length,
    feriados: feriados.length,
    comCuradoria: db.prepare(
      "select count(distinct codigo_ibge) n from feriados where ativo = 1 and abrangencia = 'municipio'").get().n,
  };
  db.close();

  const TIPOS = ["estadual", "municipal", "ponto_facultativo"];
  const textos = [];
  const idx = new Map();
  const texto = (s) => {
    if (s == null) return -1;
    if (!idx.has(s)) { idx.set(s, textos.length); textos.push(s); }
    return idx.get(s);
  };

  return {
    contagens,
    payload: {
      geradoEm: new Date().toISOString().slice(0, 10),
      contagens,
      textos,
      tipos: TIPOS,
      municipios: municipios.map((m) => [m.codigo_ibge, m.nome, m.uf]),
      feriados: feriados.map((f) => [
        texto(f.nome), TIPOS.indexOf(f.tipo), f.abrangencia === "uf" ? 0 : 1, f.uf,
        f.codigo_ibge, f.mes, f.dia, texto(f.regra_calculo),
        f.ano_inicio, f.ano_fim, texto(f.fonte), texto(f.url), f.data_verificacao,
      ]),
    },
  };
}

// Reidrata no navegador. Fica junto do payload de propósito: quem mexer num
// lado vê o outro.
const DECODIFICADOR = `
const DADOS = (function (d) {
  const t = (i) => (i < 0 ? null : d.textos[i]);
  return {
    geradoEm: d.geradoEm,
    contagens: d.contagens,
    municipios: d.municipios.map(([codigoIbge, nome, uf]) => ({ codigoIbge, nome, uf })),
    feriados: d.feriados.map((f) => ({
      nome: t(f[0]), tipo: d.tipos[f[1]], abrangencia: f[2] === 0 ? "uf" : "municipio",
      uf: f[3], codigoIbge: f[4], mes: f[5], dia: f[6], regraCalculo: t(f[7]),
      anoInicio: f[8], anoFim: f[9], baseLegal: t(f[10]), fonteUrl: t(f[11]),
      dataVerificacao: f[12],
    })),
  };
})(DADOS_BRUTOS);`;

// ---------------------------------------------------------------------------
// 3. Estilo e imagens. O CSS referencia /img/apoio.png nas máscaras; por
//    file:// isso não resolve, então vira data URI.
// ---------------------------------------------------------------------------

const dataUri = (caminho) =>
  "data:image/png;base64," + readFileSync(caminho).toString("base64");

function lerEstilo() {
  const apoio = dataUri("public/img/apoio.png");
  return readFileSync("public/css/styles.css", "utf8")
    .split('url("/img/apoio.png")').join(`url("${apoio}")`);
}

// ---------------------------------------------------------------------------
// 4. Montagem
// ---------------------------------------------------------------------------

const { contagens, payload } = lerDados();
const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Feriados Municipais — consulta offline</title>
<link rel="icon" type="image/png" href="${dataUri("public/img/favicon-64.png")}" />
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
${lerEstilo()}
/* Só deste arquivo: a faixa de procedência da cópia offline. */
.procedencia {
  display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
  margin: 18px 0 0; padding: 11px 14px;
  background: var(--laranja-claro); border-radius: 8px;
  font-size: 12.5px; color: var(--laranja-escuro);
}
.procedencia strong { font-weight: 600; }
[hidden] { display: none !important; }
</style>
</head>
<body>
<div class="app">
  <header class="barra">
    <span class="barra-marca">
      <span class="barra-simbolo" role="img" aria-label="Apoio"></span>
      <span class="barra-marca-texto">Feriados <span>Municipais</span></span>
    </span>
    <nav class="barra-nav" aria-label="Seções"><span class="barra-item ativo">Consulta offline</span></nav>
  </header>

  <div class="area">
    <main>
      <form id="form-consulta" class="console">
        <div class="console-topo">
          <div class="console-topo-texto">
            <h1 class="console-titulo">Consulta</h1>
            <p class="console-sub">No dia X, no município Y/UF, houve feriado ou ponto facultativo? Sempre com a fonte.</p>
          </div>
          <div class="segmentos" role="group" aria-label="Tipo de consulta">
            <label class="segmento"><input type="radio" name="modo" value="dia" checked /><span>Um dia</span></label>
            <label class="segmento"><input type="radio" name="modo" value="periodo" /><span>Um período</span></label>
          </div>
        </div>

        <div class="console-campos">
          <div class="campo campo-municipio">
            <label for="municipio-busca">Município</label>
            <div class="entrada">
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.6-3.6"></path></svg>
              <input type="text" id="municipio-busca" autocomplete="off" required
                     placeholder="Digite e escolha na lista"
                     role="combobox" aria-expanded="false" aria-controls="lista-municipios" aria-autocomplete="list" />
            </div>
            <div id="lista-municipios" class="lista-sugestoes"></div>
          </div>

          <div class="campo campo-data" id="campo-dia">
            <label for="data">Data</label>
            <div class="entrada"><input type="date" id="data" required /></div>
          </div>

          <div class="campo-grupo" id="campo-periodo" hidden>
            <div class="campo campo-data">
              <label for="dataInicio">De</label>
              <div class="entrada"><input type="date" id="dataInicio" /></div>
            </div>
            <div class="campo campo-data">
              <label for="dataFim">Até</label>
              <div class="entrada"><input type="date" id="dataFim" /></div>
            </div>
          </div>

          <div class="campo campo-acao">
            <button type="submit" class="botao-consultar">Consultar</button>
          </div>
        </div>
      </form>

      <p class="procedencia">
        <span><strong>Cópia offline</strong> da base de ${payload.geradoEm.split("-").reverse().join("/")} —
        ${contagens.feriados.toLocaleString("pt-BR")} feriados com fonte citada,
        ${contagens.comCuradoria.toLocaleString("pt-BR")} municípios conferidos de ${contagens.municipios.toLocaleString("pt-BR")}.
        Feriado cadastrado depois desta data não aparece aqui.</span>
      </p>

      <section id="resultado" aria-live="polite">
        <div class="apresentacao">
          <ul class="apresentacao-itens">
            <li><strong>A norma junto da resposta.</strong> Lei, decreto ou Diário Oficial citado em cada feriado, com quem conferiu e em que data — pronto para anexar ao fechamento.</li>
            <li><strong>Feriado e ponto facultativo não são a mesma coisa.</strong> Carnaval e Corpus Christi entram como ponto facultativo, que vincula só quem decretou. É a distinção que muda a folha.</li>
            <li><strong>As três camadas aparecem juntas.</strong> Nacional, estadual e municipal convivem no mesmo dia quando coincidem, e o cálculo vale para anos passados e futuros.</li>
            <li><strong>Município sem curadoria responde “não verificado”.</strong> Nunca “dia útil” por omissão: a ausência de prova aparece como ausência de prova.</li>
          </ul>
        </div>
      </section>
    </main>

    <footer class="rodape">
      <p>Arquivo gerado a partir da base do sistema. Para cadastrar ou corrigir feriado, e para processar planilha em
        lote, use a versão servida — esta cópia é só de consulta.</p>
      <div class="rodape-marcas">
        <span class="marca-apoio" role="img" aria-label="Apoio"></span>
        <span class="rodape-divisa" aria-hidden="true"></span>
        <img class="marca-sao-roque" src="${dataUri("public/img/sao-roque.png")}" alt="Rede São Roque" width="124" height="41" />
      </div>
    </footer>
  </div>
</div>

<script>
/* === nucleo:inicio === (dados + motor; tools/offline/verificar.mjs extrai
   este trecho e confere, contra o servidor, se as respostas batem) */
const DADOS_BRUTOS = ${JSON.stringify(payload)};
${DECODIFICADOR}
${empacotarMotor()}
/* === nucleo:fim === */
${readFileSync("tools/offline/app.js", "utf8")}
</script>
</body>
</html>
`;

mkdirSync("offline", { recursive: true });
writeFileSync(SAIDA, html);
console.log(`${SAIDA}  ${(Buffer.byteLength(html) / 1048576).toFixed(2)} MB`);
console.log(`base de ${payload.geradoEm}: ${contagens.feriados} feriados, ${contagens.municipios} municípios`);
