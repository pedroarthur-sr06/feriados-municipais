/**
 * Camada de serviço: busca dados no SQLite (municípios, feriados curados) e
 * chama o motor puro (src/motor/) para resolver a consulta. O motor em si
 * nunca toca o banco — só esta camada.
 */
import { and, eq, or, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { feriados, fontes, municipios, tiposFeriado } from "../db/schema.js";
import {
  consultarDia as motorConsultarDia,
  consultarPeriodo as motorConsultarPeriodo,
  type FeriadoCuradoInput,
  type ResultadoConsultaDia,
} from "../motor/resolver.js";

export interface MunicipioResumo {
  codigoIbge: number;
  nome: string;
  uf: string;
}

export interface DataYmd {
  ano: number;
  mes: number;
  dia: number;
}

/** Busca municípios por nome (autocomplete). Prioriza nomes que começam com o termo. */
export function buscarMunicipios(termoBusca: string, limite = 10): MunicipioResumo[] {
  const termo = termoBusca.trim();
  if (termo.length < 2) return [];
  const contains = `%${termo}%`;
  const comecaCom = `${termo}%`;
  return db
    .select({ codigoIbge: municipios.codigoIbge, nome: municipios.nome, uf: municipios.uf })
    .from(municipios)
    .where(sql`${municipios.nome} LIKE ${contains} COLLATE NOCASE`)
    .orderBy(sql`CASE WHEN ${municipios.nome} LIKE ${comecaCom} COLLATE NOCASE THEN 0 ELSE 1 END`, municipios.nome)
    .limit(limite)
    .all();
}

export function buscarMunicipioPorCodigo(codigoIbge: number): MunicipioResumo | undefined {
  return db
    .select({ codigoIbge: municipios.codigoIbge, nome: municipios.nome, uf: municipios.uf })
    .from(municipios)
    .where(eq(municipios.codigoIbge, codigoIbge))
    .get();
}

function comoTipoCurado(chave: string, nomeFeriado: string): "estadual" | "municipal" | "ponto_facultativo" {
  if (chave === "estadual" || chave === "municipal" || chave === "ponto_facultativo") return chave;
  // Não deveria acontecer — feriados nacionais nunca são inseridos na tabela
  // `feriados` (são calculados em código). Se aparecer aqui, é bug de
  // cadastro (a tela administrativa da Fase 4 precisa impedir isso na
  // origem, já que o SQLite não garante o enum como CHECK constraint real).
  throw new Error(
    `Feriado curado "${nomeFeriado}" com tipo inesperado "${chave}" — feriados nacionais não devem estar na tabela "feriados".`,
  );
}

function buscarFeriadosCurados(uf: string, codigoIbge: number | null): FeriadoCuradoInput[] {
  const condicaoAbrangencia =
    codigoIbge == null
      ? eq(feriados.uf, uf) // sem município (ex.: consulta genérica) — só camada estadual
      : or(
          and(eq(feriados.abrangencia, "uf"), eq(feriados.uf, uf)),
          and(eq(feriados.abrangencia, "municipio"), eq(feriados.codigoIbge, codigoIbge)),
        );

  const linhas = db
    .select({
      nome: feriados.nome,
      tipoChave: tiposFeriado.chave,
      abrangencia: feriados.abrangencia,
      uf: feriados.uf,
      codigoIbge: feriados.codigoIbge,
      mes: feriados.mes,
      dia: feriados.dia,
      regraCalculo: feriados.regraCalculo,
      anoInicio: feriados.anoInicio,
      anoFim: feriados.anoFim,
      dataVerificacao: feriados.dataVerificacao,
      fonteDescricao: fontes.descricao,
      fonteUrl: fontes.url,
    })
    .from(feriados)
    .innerJoin(tiposFeriado, eq(feriados.tipoFeriadoId, tiposFeriado.id))
    .innerJoin(fontes, eq(feriados.fonteId, fontes.id))
    .where(and(eq(feriados.ativo, true), condicaoAbrangencia))
    .all();

  return linhas.map((l) => ({
    nome: l.nome,
    tipo: comoTipoCurado(l.tipoChave, l.nome),
    abrangencia: l.abrangencia as "uf" | "municipio",
    uf: l.uf,
    codigoIbge: l.codigoIbge,
    mes: l.mes,
    dia: l.dia,
    regraCalculo: l.regraCalculo,
    anoInicio: l.anoInicio,
    anoFim: l.anoFim,
    baseLegal: l.fonteDescricao,
    fonteUrl: l.fonteUrl,
    dataVerificacao: l.dataVerificacao,
  }));
}

export interface ConsultaComMunicipio {
  municipio: MunicipioResumo;
}

export function consultarDiaPorMunicipio(
  codigoIbge: number,
  data: DataYmd,
): (ResultadoConsultaDia & ConsultaComMunicipio) | null {
  const municipio = buscarMunicipioPorCodigo(codigoIbge);
  if (!municipio) return null;
  const curados = buscarFeriadosCurados(municipio.uf, codigoIbge);
  const resultado = motorConsultarDia({ ...data, uf: municipio.uf, codigoIbge, feriadosCurados: curados });
  return { ...resultado, municipio };
}

export function consultarPeriodoPorMunicipio(
  codigoIbge: number,
  dataInicio: DataYmd,
  dataFim: DataYmd,
): { municipio: MunicipioResumo; dias: ResultadoConsultaDia[] } | null {
  const municipio = buscarMunicipioPorCodigo(codigoIbge);
  if (!municipio) return null;
  const curados = buscarFeriadosCurados(municipio.uf, codigoIbge);
  const dias = motorConsultarPeriodo({ dataInicio, dataFim, uf: municipio.uf, codigoIbge, feriadosCurados: curados });
  return { municipio, dias };
}

function ultimoDiaDoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/** Todos os dias de um mês (para o calendário mensal da Fase 3). */
export function consultarMesPorMunicipio(
  codigoIbge: number,
  ano: number,
  mes: number,
): { municipio: MunicipioResumo; dias: ResultadoConsultaDia[] } | null {
  return consultarPeriodoPorMunicipio(
    codigoIbge,
    { ano, mes, dia: 1 },
    { ano, mes, dia: ultimoDiaDoMes(ano, mes) },
  );
}
