/**
 * Números reais da base, para a interface poder dizer o tamanho do que tem —
 * e, principalmente, o tamanho do que NÃO tem. Nada aqui é escrito à mão na
 * view: se a curadoria avança, a frase na tela avança junto.
 *
 * Cache curto em memória porque são COUNTs baratos num SQLite local, mas
 * rodariam a cada pageview sem necessidade.
 */
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

export interface EstatisticasDaBase {
  /** Feriados curados ativos (estaduais + municipais). */
  feriados: number;
  /** Municípios do IBGE no total. */
  municipiosTotal: number;
  /** Municípios com pelo menos um feriado municipal curado. */
  municipiosCurados: number;
  /** Municípios que ninguém curou ainda — para eles a resposta é "não verificado". */
  municipiosSemCuradoria: number;
  /** Fontes distintas citadas. */
  fontes: number;
}

const TTL_MS = 5 * 60 * 1000;
let cache: { em: number; valor: EstatisticasDaBase } | null = null;

function contar(consulta: string): number {
  const linha = db.all<{ n: number }>(sql.raw(consulta))[0];
  return linha?.n ?? 0;
}

export function estatisticasDaBase(): EstatisticasDaBase {
  if (cache && Date.now() - cache.em < TTL_MS) return cache.valor;

  const municipiosTotal = contar("SELECT COUNT(*) AS n FROM municipios");
  const municipiosCurados = contar(
    "SELECT COUNT(DISTINCT codigo_ibge) AS n FROM feriados WHERE ativo = 1 AND abrangencia = 'municipio'",
  );

  const valor: EstatisticasDaBase = {
    feriados: contar("SELECT COUNT(*) AS n FROM feriados WHERE ativo = 1"),
    municipiosTotal,
    municipiosCurados,
    municipiosSemCuradoria: municipiosTotal - municipiosCurados,
    fontes: contar("SELECT COUNT(*) AS n FROM fontes"),
  };

  cache = { em: Date.now(), valor };
  return valor;
}
