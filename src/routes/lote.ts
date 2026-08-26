/**
 * Upload de CSV/XLSX (posto, municipio, uf, data) → download do mesmo
 * arquivo com a classificação preenchida (Fase 4).
 */
import type { FastifyInstance } from "fastify";
import { classificarLinhas } from "../lote/classificador.js";
import { gerarCsv, gerarXlsx, lerCsv, lerXlsx } from "../lote/planilha.js";

const LIMITE_LINHAS = 20_000;

export default async function rotasLote(app: FastifyInstance) {
  app.get("/lote", async (_req, reply) => {
    return reply.view("lote.ejs", { titulo: "Operação em lote — Feriados Municipais" });
  });

  app.post("/lote/processar", async (req, reply) => {
    const arquivo = await req.file();
    if (!arquivo) {
      return reply.code(400).view("lote.ejs", { erro: "Selecione um arquivo CSV ou XLSX." });
    }

    const nomeOriginal = arquivo.filename || "planilha";
    const ehXlsx = /\.xlsx$/i.test(nomeOriginal);
    const ehCsv = /\.csv$/i.test(nomeOriginal);
    if (!ehXlsx && !ehCsv) {
      return reply.code(400).view("lote.ejs", { erro: "Formato não reconhecido. Envie um arquivo .csv ou .xlsx." });
    }

    const buffer = await arquivo.toBuffer();

    let linhas;
    let delimitador: "," | ";" = ",";
    try {
      if (ehXlsx) {
        ({ linhas } = await lerXlsx(buffer));
      } else {
        ({ linhas, delimitador } = lerCsv(buffer));
      }
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : "Falha ao ler o arquivo.";
      return reply.code(400).view("lote.ejs", { erro: mensagem });
    }

    if (linhas.length === 0) {
      return reply.code(400).view("lote.ejs", { erro: "Nenhuma linha de dados encontrada no arquivo." });
    }
    if (linhas.length > LIMITE_LINHAS) {
      return reply
        .code(400)
        .view("lote.ejs", { erro: `Arquivo com ${linhas.length} linhas — o limite por envio é ${LIMITE_LINHAS}. Divida em partes menores.` });
    }

    const classificadas = classificarLinhas(linhas);
    const nomeBase = nomeOriginal.replace(/\.(csv|xlsx)$/i, "");

    const colunas = [
      { chave: "posto", cabecalho: "posto" },
      { chave: "municipio", cabecalho: "municipio" },
      { chave: "uf", cabecalho: "uf" },
      { chave: "data", cabecalho: "data" },
      { chave: "classificacao", cabecalho: "classificacao" },
      { chave: "tipos", cabecalho: "tipos" },
      { chave: "fonte", cabecalho: "fonte" },
      { chave: "statusMunicipal", cabecalho: "status_municipal" },
      { chave: "erro", cabecalho: "erro" },
    ];

    if (ehXlsx) {
      const saida = await gerarXlsx("Classificação", classificadas, colunas.map((c) => ({ ...c, largura: 24 })));
      reply
        .header("Content-Disposition", `attachment; filename="${nomeBase}-classificado.xlsx"`)
        .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .send(saida);
    } else {
      const saida = gerarCsv(classificadas, colunas, delimitador);
      reply
        .header("Content-Disposition", `attachment; filename="${nomeBase}-classificado.csv"`)
        .type("text/csv; charset=utf-8")
        .send(saida);
    }
    return reply;
  });
}
