/**
 * Resolução em camadas: nacional (calculado) → estadual (curado) →
 * municipal (curado). Camadas podem coexistir na mesma data — todas são
 * retornadas, nenhuma "vence" a outra (briefing, Fase 2).
 *
 * Função pura: recebe os feriados estadual/municipal já curados como dado
 * de entrada (quem busca no banco é a camada de serviço, fora do motor —
 * "antes da interface, implementar e testar a lógica pura"). Isso permite
 * testar sobreposição e o caso "não verificado" sem precisar de SQLite.
 */
import { calcularPascoa, somarDias, dataParaIso } from "./pascoa.js";
import { feriadosNacionaisDoAno } from "./feriados-nacionais.js";
import type { OcorrenciaFeriado } from "./tipos.js";

export interface FeriadoCuradoInput {
  nome: string;
  tipo: "estadual" | "municipal" | "ponto_facultativo";
  abrangencia: "uf" | "municipio";
  uf: string;
  codigoIbge: number | null;
  /** Data fixa anual — usar mes/dia OU regraCalculo, nunca os dois. */
  mes: number | null;
  dia: number | null;
  /** Regra relativa à Páscoa, ex.: "pascoa", "pascoa-47", "pascoa+60". */
  regraCalculo: string | null;
  anoInicio: number | null;
  anoFim: number | null;
  baseLegal: string;
  fonteUrl: string | null;
  dataVerificacao: string;
}

export interface ResultadoConsultaDia {
  data: string; // ISO YYYY-MM-DD
  diaSemana: string;
  ocorrencias: OcorrenciaFeriado[];
  /**
   * "nao_verificado" quando não existe NENHUM feriado municipal curado para
   * este código IBGE — significa que ninguém pesquisou/confirmou os
   * feriados deste município ainda, não que hoje não é feriado. Ver regra
   * inegociável em CLAUDE.md: nunca inferir "dia útil" por ausência de
   * curadoria.
   */
  statusMunicipal: "verificado" | "nao_verificado";
}

const DIAS_SEMANA = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
] as const;

function nomeDiaSemana(ano: number, mes: number, dia: number): string {
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return DIAS_SEMANA[d.getUTCDay()]!;
}

function dentroDaVigencia(f: Pick<FeriadoCuradoInput, "anoInicio" | "anoFim">, ano: number): boolean {
  if (f.anoInicio != null && ano < f.anoInicio) return false;
  if (f.anoFim != null && ano > f.anoFim) return false;
  return true;
}

const REGRA_PASCOA = /^pascoa([+-]\d+)?$/;

function resolverDataDoFeriadoCurado(f: FeriadoCuradoInput, ano: number): { mes: number; dia: number } {
  if (f.regraCalculo) {
    const m = REGRA_PASCOA.exec(f.regraCalculo);
    if (!m) {
      throw new Error(`Regra de cálculo desconhecida: "${f.regraCalculo}" (feriado "${f.nome}")`);
    }
    const delta = m[1] ? Number.parseInt(m[1], 10) : 0;
    const pascoa = calcularPascoa(ano);
    const data = delta === 0 ? pascoa : somarDias(pascoa, delta);
    return { mes: data.mes, dia: data.dia };
  }
  if (f.mes != null && f.dia != null) {
    return { mes: f.mes, dia: f.dia };
  }
  throw new Error(`Feriado curado "${f.nome}" sem data fixa nem regra de cálculo.`);
}

/** Filtra os feriados curados relevantes para a UF/município da consulta (independente de data/vigência). */
function filtrarRelevantes(
  feriadosCurados: FeriadoCuradoInput[],
  uf: string,
  codigoIbge: number | null,
): FeriadoCuradoInput[] {
  return feriadosCurados.filter((f) => {
    if (f.abrangencia === "uf") return f.uf === uf;
    return codigoIbge != null && f.codigoIbge === codigoIbge;
  });
}

export function consultarDia(opts: {
  ano: number;
  mes: number;
  dia: number;
  uf: string;
  codigoIbge: number | null;
  feriadosCurados: FeriadoCuradoInput[];
}): ResultadoConsultaDia {
  const { ano, mes, dia, uf, codigoIbge, feriadosCurados } = opts;
  const dataIso = dataParaIso({ ano, mes, dia });

  const ocorrencias: OcorrenciaFeriado[] = [];

  // Camada nacional — sempre calculada, nunca depende de curadoria.
  for (const fn of feriadosNacionaisDoAno(ano)) {
    if (fn.mes === mes && fn.dia === dia) {
      ocorrencias.push(fn.ocorrencia);
    }
  }

  // Camadas estadual + municipal + ponto facultativo, curadas manualmente.
  const relevantes = filtrarRelevantes(feriadosCurados, uf, codigoIbge);

  const statusMunicipal: "verificado" | "nao_verificado" = relevantes.some(
    (f) => f.abrangencia === "municipio" && f.tipo === "municipal",
  )
    ? "verificado"
    : "nao_verificado";

  for (const f of relevantes) {
    if (!dentroDaVigencia(f, ano)) continue;
    const resolvida = resolverDataDoFeriadoCurado(f, ano);
    if (resolvida.mes === mes && resolvida.dia === dia) {
      ocorrencias.push({
        data: dataIso,
        nome: f.nome,
        camada: f.tipo,
        baseLegal: f.baseLegal,
        fonteUrl: f.fonteUrl ?? undefined,
        dataVerificacao: f.dataVerificacao,
      });
    }
  }

  return {
    data: dataIso,
    diaSemana: nomeDiaSemana(ano, mes, dia),
    ocorrencias,
    statusMunicipal,
  };
}

/** Consulta um período (ciclo de ponto), inclusive nas duas pontas. Um item por dia corrido. */
export function consultarPeriodo(opts: {
  dataInicio: { ano: number; mes: number; dia: number };
  dataFim: { ano: number; mes: number; dia: number };
  uf: string;
  codigoIbge: number | null;
  feriadosCurados: FeriadoCuradoInput[];
}): ResultadoConsultaDia[] {
  const { dataInicio, dataFim, uf, codigoIbge, feriadosCurados } = opts;
  const inicio = new Date(Date.UTC(dataInicio.ano, dataInicio.mes - 1, dataInicio.dia));
  const fim = new Date(Date.UTC(dataFim.ano, dataFim.mes - 1, dataFim.dia));
  if (inicio.getTime() > fim.getTime()) {
    throw new Error("dataInicio precisa ser anterior ou igual a dataFim.");
  }

  const resultado: ResultadoConsultaDia[] = [];
  const cursor = new Date(inicio);
  while (cursor.getTime() <= fim.getTime()) {
    resultado.push(
      consultarDia({
        ano: cursor.getUTCFullYear(),
        mes: cursor.getUTCMonth() + 1,
        dia: cursor.getUTCDate(),
        uf,
        codigoIbge,
        feriadosCurados,
      }),
    );
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return resultado;
}
