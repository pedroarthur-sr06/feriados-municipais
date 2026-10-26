/**
 * Confere se o HTML offline responde o mesmo que o servidor.
 *
 *   node tools/offline/verificar.mjs            (servidor em localhost:3000)
 *   BASE=http://outra:3000 node tools/offline/verificar.mjs
 *
 * O arquivo offline embute o motor compilado em vez de reimplementá-lo, então
 * em tese as respostas não têm como divergir. "Em tese" não basta num produto
 * cujo erro aparece na folha de pagamento de alguém: aqui o núcleo do arquivo
 * gerado é extraído, executado em Node e comparado com o que a rota /consulta
 * devolve, para uma amostra aleatória de município × data.
 *
 * Compara o veredito, a lista de fontes citadas e as classes de cada célula
 * do calendário — o que a pessoa lê, o que ela anexa ao fechamento e a cor
 * que ela enxerga no mês. A primeira versão comparava só o veredito e passou
 * limpa enquanto o calendário do offline estava errado.
 */
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const ARQUIVO = "offline/feriados-municipais.html";
const BASE = process.env.BASE ?? "http://localhost:3000";
const AMOSTRAS = Number(process.env.AMOSTRAS ?? 120);

// --- carrega o núcleo do arquivo gerado -------------------------------------

const html = readFileSync(ARQUIVO, "utf8");
const inicio = html.indexOf("/* === nucleo:inicio ===");
const fim = html.indexOf("/* === nucleo:fim === */");
if (inicio < 0 || fim < 0) throw new Error("marcadores do núcleo não encontrados em " + ARQUIVO);

const contexto = createContext({});
runInContext(html.slice(inicio, fim), contexto);
runInContext("globalThis.__saida = { DADOS, MOTOR };", contexto);
const { DADOS, MOTOR } = contexto.__saida;

const porUf = new Map(), porMunicipio = new Map();
for (const f of DADOS.feriados) {
  const mapa = f.abrangencia === "uf" ? porUf : porMunicipio;
  const chave = f.abrangencia === "uf" ? f.uf : f.codigoIbge;
  if (chave == null) continue;
  if (!mapa.has(chave)) mapa.set(chave, []);
  mapa.get(chave).push(f);
}
const curadosDe = (m) => (porUf.get(m.uf) || []).concat(porMunicipio.get(m.codigoIbge) || []);

// --- amostra ----------------------------------------------------------------

// Mistura municípios sorteados com alguns que exercitam casos de borda
// conhecidos: Páscoa móvel, feriado estadual, município sem curadoria.
const sorteio = [];
for (let i = 0; i < AMOSTRAS; i++) {
  const m = DADOS.municipios[Math.floor(Math.random() * DADOS.municipios.length)];
  const ano = 2024 + Math.floor(Math.random() * 5);
  const mes = 1 + Math.floor(Math.random() * 12);
  const dia = 1 + Math.floor(Math.random() * 28);
  sorteio.push({ m, data: { ano, mes, dia } });
}
const fixos = [
  ["Campinas", "SP", 2026, 12, 8], ["Salvador", "BA", 2026, 7, 2],
  ["Sorocaba", "SP", 2026, 8, 15], ["Acauã", "PI", 2026, 7, 14],
  ["Campinas", "SP", 2026, 2, 16], ["Campinas", "SP", 2026, 4, 3],
  ["Campinas", "SP", 2026, 6, 4], ["Salvador", "BA", 2025, 12, 25],
];
for (const [nome, uf, ano, mes, dia] of fixos) {
  const m = DADOS.municipios.find((x) => x.nome === nome && x.uf === uf);
  if (m) sorteio.push({ m, data: { ano, mes, dia } });
}

// --- compara ----------------------------------------------------------------

const limpar = (s) => s.replace(/\s+/g, " ").trim();

async function doServidor(m, d) {
  const data = `${d.ano}-${String(d.mes).padStart(2, "0")}-${String(d.dia).padStart(2, "0")}`;
  const r = await fetch(`${BASE}/consulta?codigoIbge=${m.codigoIbge}&modo=dia&data=${data}`);
  if (!r.ok) throw new Error(`servidor respondeu ${r.status} para ${m.nome}/${m.uf} ${data}`);
  const texto = await r.text();
  const veredito = /<h2 class="veredito[^"]*">([^<]*)<\/h2>/.exec(texto);
  const fontes = [...texto.matchAll(/<p class="ocorrencia-fonte">([\s\S]*?)<\/p>/g)]
    .map((x) => limpar(x[1].replace(/<[^>]+>/g, "")));
  const corpo = texto.slice(texto.indexOf("<tbody>"));
  const celulas = [...corpo.matchAll(/<td class="([^"]*)"/g)].map((x) => limpar(x[1]));
  if (celulas.length === 0) throw new Error(`nenhuma célula de calendário na resposta de ${m.nome}/${m.uf} ${data}`);
  return { veredito: veredito ? limpar(veredito[1]) : null, fontes, celulas };
}

function doOffline(m, d) {
  const curados = curadosDe(m);
  const res = MOTOR.consultarDia({ ...d, uf: m.uf, codigoIbge: m.codigoIbge, feriadosCurados: curados });
  const ultimo = new Date(Date.UTC(d.ano, d.mes, 0)).getUTCDate();
  const mesInteiro = MOTOR.consultarPeriodo({
    dataInicio: { ano: d.ano, mes: d.mes, dia: 1 }, dataFim: { ano: d.ano, mes: d.mes, dia: ultimo },
    uf: m.uf, codigoIbge: m.codigoIbge, feriadosCurados: curados,
  });
  const grade = MOTOR.apresentarCalendario(
    MOTOR.montarGradeCalendario(d.ano, d.mes, mesInteiro), res.data);
  return {
    veredito: MOTOR.montarVeredito(res, m.nome).frase,
    fontes: res.ocorrencias.map((o) => limpar(o.baseLegal + (o.fonteUrl ? " ver fonte" : ""))),
    celulas: grade.flat().map((c) => limpar(c.classes)),
  };
}

const divergencias = [];
let conferidos = 0;
for (const { m, data } of sorteio) {
  const [a, b] = [await doServidor(m, data), doOffline(m, data)];
  conferidos++;
  if (a.veredito !== b.veredito ||
      JSON.stringify(a.fontes) !== JSON.stringify(b.fontes) ||
      JSON.stringify(a.celulas) !== JSON.stringify(b.celulas)) {
    divergencias.push({
      onde: `${m.nome}/${m.uf} ${data.ano}-${data.mes}-${data.dia}`,
      servidor: a, offline: b,
    });
  }
}

console.log(`${conferidos} consultas conferidas contra ${BASE}`);
if (divergencias.length === 0) {
  console.log("sem divergência: o arquivo offline responde igual ao servidor");
} else {
  console.error(`${divergencias.length} DIVERGÊNCIA(S):`);
  for (const d of divergencias.slice(0, 10)) console.error(JSON.stringify(d, null, 2));
  process.exit(1);
}
