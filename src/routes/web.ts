/**
 * Rotas da interface web: página inicial + endpoints htmx (autocomplete de
 * município e consulta de dia/período). Toda validação de entrada mora
 * aqui; a camada de serviço e o motor continuam puros/sem HTTP.
 */
import type { FastifyInstance } from "fastify";
import {
  buscarMunicipios,
  consultarDiaPorMunicipio,
  consultarMesPorMunicipio,
  consultarPeriodoPorMunicipio,
  type DataYmd,
} from "../services/feriados-service.js";
import { montarGradeCalendario } from "../web/calendario.js";
import type { ResultadoConsultaDia } from "../motor/resolver.js";

function parseIso(valor: unknown): DataYmd | null {
  if (typeof valor !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!m || !m[1] || !m[2] || !m[3]) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  // valida se a data realmente existe (ex.: 31/02 não existe)
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return { ano, mes, dia };
}

function formatarBr(iso: string): string {
  return iso.split("-").reverse().join("/");
}

function chaveAnoMes(iso: string): string {
  return iso.slice(0, 7); // "YYYY-MM"
}

// Cache curto no navegador — nossa base já é local (SQLite/IBGE via seed),
// isso só evita reconsultas repetidas em navegação rápida (voltar/avançar).
const CACHE_CURTO = "private, max-age=120";

export default async function rotasWeb(app: FastifyInstance) {
  app.get("/", async (_req, reply) => {
    return reply.view("index.ejs", { titulo: "Feriados Municipais" });
  });

  app.get("/municipios/busca", async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;
    const termo = query.municipioTexto ?? "";
    const municipios = buscarMunicipios(termo, 10);
    reply.header("Cache-Control", CACHE_CURTO);
    return reply.view("partials/municipios-lista.ejs", { municipios });
  });

  app.get("/consulta", async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;
    const codigoIbge = Number(query.codigoIbge);

    if (!query.codigoIbge || !Number.isInteger(codigoIbge)) {
      return reply.view("resultado-erro.ejs", {
        mensagem: "Selecione um município na lista de sugestões antes de consultar.",
      });
    }

    const modo = query.modo === "periodo" ? "periodo" : "dia";

    if (modo === "dia") {
      const data = parseIso(query.data);
      if (!data) {
        return reply.view("resultado-erro.ejs", { mensagem: "Escolha uma data válida." });
      }

      const resultado = consultarDiaPorMunicipio(codigoIbge, data);
      if (!resultado) {
        return reply.view("resultado-erro.ejs", { mensagem: "Município não encontrado." });
      }

      const mesCompleto = consultarMesPorMunicipio(codigoIbge, data.ano, data.mes);
      const semanas = montarGradeCalendario(data.ano, data.mes, mesCompleto?.dias ?? [resultado]);

      reply.header("Cache-Control", CACHE_CURTO);
      return reply.view("resultado-dia.ejs", {
        municipio: resultado.municipio,
        resultado,
        ano: data.ano,
        mes: data.mes,
        semanas,
      });
    }

    // modo período
    const dataInicio = parseIso(query.dataInicio);
    const dataFim = parseIso(query.dataFim);
    if (!dataInicio || !dataFim) {
      return reply.view("resultado-erro.ejs", { mensagem: "Escolha as duas datas do período (De / Até)." });
    }
    const inicioMs = Date.UTC(dataInicio.ano, dataInicio.mes - 1, dataInicio.dia);
    const fimMs = Date.UTC(dataFim.ano, dataFim.mes - 1, dataFim.dia);
    if (inicioMs > fimMs) {
      return reply.view("resultado-erro.ejs", { mensagem: '"De" precisa ser antes ou igual a "Até".' });
    }
    const diffDias = Math.round((fimMs - inicioMs) / 86_400_000) + 1;
    if (diffDias > 370) {
      return reply.view("resultado-erro.ejs", { mensagem: "Período máximo de consulta: 370 dias." });
    }

    const consulta = consultarPeriodoPorMunicipio(codigoIbge, dataInicio, dataFim);
    if (!consulta) {
      return reply.view("resultado-erro.ejs", { mensagem: "Município não encontrado." });
    }

    const mesesTocados = [...new Set(consulta.dias.map((d) => chaveAnoMes(d.data)))];
    const calendarios = mesesTocados.map((chave) => {
      const [anoStr, mesStr] = chave.split("-");
      const ano = Number(anoStr);
      const mes = Number(mesStr);
      const mesCompleto = consultarMesPorMunicipio(codigoIbge, ano, mes);
      return { ano, mes, semanas: montarGradeCalendario(ano, mes, mesCompleto?.dias ?? []) };
    });

    const diasComOcorrencia: ResultadoConsultaDia[] = consulta.dias.filter((d) => d.ocorrencias.length > 0);
    const statusMunicipal = consulta.dias[0]?.statusMunicipal ?? "nao_verificado";

    const dataInicioIso = `${dataInicio.ano}-${String(dataInicio.mes).padStart(2, "0")}-${String(dataInicio.dia).padStart(2, "0")}`;
    const dataFimIso = `${dataFim.ano}-${String(dataFim.mes).padStart(2, "0")}-${String(dataFim.dia).padStart(2, "0")}`;

    reply.header("Cache-Control", CACHE_CURTO);
    return reply.view("resultado-periodo.ejs", {
      municipio: consulta.municipio,
      dias: consulta.dias,
      calendarios,
      diasComOcorrencia,
      statusMunicipal,
      dataInicioIso,
      dataFimIso,
      dataInicioTexto: formatarBr(dataInicioIso),
      dataFimTexto: formatarBr(dataFimIso),
    });
  });
}
