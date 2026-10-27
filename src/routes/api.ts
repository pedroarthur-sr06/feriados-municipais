/**
 * Rota de dados para outras ferramentas internas (a "Cálculo das Horas" do
 * DP roda em outro endereço e lê os feriados daqui pelo navegador).
 *
 * GET /api/feriados?municipio=Barreiras&uf=BA&dataInicio=2026-09-21&dataFim=2026-10-20
 * (ou codigoIbge= no lugar de municipio+uf). Responde JSON; erro vem como
 * { erro } com 400 ou 404.
 *
 * Só leitura, e só do que a tela de consulta já mostra a qualquer pessoa da
 * rede: por isso libera a leitura para qualquer origem (CORS "*").
 */
import type { FastifyInstance } from "fastify";
import {
  buscarMunicipioPorCodigo,
  buscarMunicipioPorNomeEUf,
  consultarPeriodoPorMunicipio,
  type DataYmd,
} from "../services/feriados-service.js";
import { montarRespostaFeriados } from "../api/feriados-json.js";

/** Um ano e um pouco: cobre o ciclo de ponto que vira o ano, e segura pedido sem fim. */
const MAX_DIAS = 400;

function parseIso(valor: unknown): DataYmd | null {
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

const emDias = (d: DataYmd) => Date.UTC(d.ano, d.mes - 1, d.dia) / 86_400_000;

export default async function rotasApi(app: FastifyInstance) {
  app.get<{ Querystring: { codigoIbge?: string; municipio?: string; uf?: string; dataInicio?: string; dataFim?: string } }>(
    "/api/feriados",
    async (req, reply) => {
      reply.header("Access-Control-Allow-Origin", "*");
      const q = req.query;

      const inicio = parseIso(q.dataInicio);
      const fim = parseIso(q.dataFim);
      if (!inicio || !fim) return reply.code(400).send({ erro: "Datas inválidas (use AAAA-MM-DD em dataInicio e dataFim)." });
      const dias = emDias(fim) - emDias(inicio) + 1;
      if (dias < 1) return reply.code(400).send({ erro: "dataFim vem antes de dataInicio." });
      if (dias > MAX_DIAS) return reply.code(400).send({ erro: `Período longo demais: no máximo ${MAX_DIAS} dias por consulta.` });

      const municipio = q.codigoIbge
        ? buscarMunicipioPorCodigo(Number(q.codigoIbge))
        : buscarMunicipioPorNomeEUf(q.municipio ?? "", q.uf ?? "");
      if (!municipio) {
        return reply.code(404).send({ erro: q.codigoIbge ? "Código IBGE não encontrado." : "Município não encontrado nesta UF." });
      }

      const consulta = consultarPeriodoPorMunicipio(municipio.codigoIbge, inicio, fim);
      if (!consulta) return reply.code(404).send({ erro: "Município não encontrado." });
      return montarRespostaFeriados(consulta.municipio, q.dataInicio as string, q.dataFim as string, consulta.dias);
    },
  );
}
