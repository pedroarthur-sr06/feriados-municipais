/**
 * Exportação em CSV/PDF do resultado de um período — para anexar ao
 * fechamento de ponto (Fase 4). Reaproveita a mesma consulta da Fase 3.
 */
import type { FastifyInstance } from "fastify";
import { consultarPeriodoPorMunicipio } from "../services/feriados-service.js";
import { gerarCsvPeriodo, gerarPdfPeriodo, linhasDoPeriodo } from "../lote/exportacao.js";

function parseIso(valor: unknown): { ano: number; mes: number; dia: number } | null {
  if (typeof valor !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return { ano, mes, dia };
}

function formatarBr(iso: string): string {
  return iso.split("-").reverse().join("/");
}

export default async function rotasExportacao(app: FastifyInstance) {
  app.get<{ Querystring: { codigoIbge?: string; dataInicio?: string; dataFim?: string } }>(
    "/exportar/csv",
    async (req, reply) => {
      const dados = validarQuery(req.query);
      if ("erro" in dados) return reply.code(400).send(dados.erro);

      const csv = gerarCsvPeriodo(linhasDoPeriodo(dados.consulta.dias));
      const nome = `feriados-${dados.consulta.municipio.nome.replace(/\s+/g, "_")}-${dados.dataInicio}-a-${dados.dataFim}.csv`;
      return reply
        .header("Content-Disposition", `attachment; filename="${nome}"`)
        .type("text/csv; charset=utf-8")
        .send(csv);
    },
  );

  app.get<{ Querystring: { codigoIbge?: string; dataInicio?: string; dataFim?: string } }>(
    "/exportar/pdf",
    async (req, reply) => {
      const dados = validarQuery(req.query);
      if ("erro" in dados) return reply.code(400).send(dados.erro);

      const linhas = linhasDoPeriodo(dados.consulta.dias);
      const statusMunicipal = dados.consulta.dias[0]?.statusMunicipal ?? "nao_verificado";
      const pdf = await gerarPdfPeriodo({
        municipio: dados.consulta.municipio,
        dataInicioTexto: formatarBr(dados.dataInicio),
        dataFimTexto: formatarBr(dados.dataFim),
        linhas,
        statusMunicipal,
        geradoEm: new Date().toISOString().slice(0, 16).replace("T", " "),
      });
      const nome = `feriados-${dados.consulta.municipio.nome.replace(/\s+/g, "_")}-${dados.dataInicio}-a-${dados.dataFim}.pdf`;
      return reply
        .header("Content-Disposition", `attachment; filename="${nome}"`)
        .type("application/pdf")
        .send(pdf);
    },
  );
}

function validarQuery(query: { codigoIbge?: string; dataInicio?: string; dataFim?: string }) {
  const codigoIbge = Number(query.codigoIbge);
  if (!query.codigoIbge || !Number.isInteger(codigoIbge)) {
    return { erro: "Parâmetro codigoIbge inválido." } as const;
  }
  const inicio = parseIso(query.dataInicio);
  const fim = parseIso(query.dataFim);
  if (!inicio || !fim) {
    return { erro: "Datas inválidas (use AAAA-MM-DD)." } as const;
  }
  const consulta = consultarPeriodoPorMunicipio(codigoIbge, inicio, fim);
  if (!consulta) {
    return { erro: "Município não encontrado." } as const;
  }
  return {
    consulta,
    dataInicio: query.dataInicio as string,
    dataFim: query.dataFim as string,
  };
}
