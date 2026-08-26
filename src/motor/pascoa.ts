/**
 * Cálculo da data da Páscoa (algoritmo de Meeus/Jones/Butcher, também
 * conhecido como algoritmo de Gauss para o calendário gregoriano) e
 * aritmética de datas derivadas dela (Carnaval, Sexta-feira Santa,
 * Corpus Christi etc.).
 *
 * Verificado nesta sessão contra fonte externa (BrasilAPI) para 2024, 2025
 * e 2026 — ver docs/fontes-de-dados.md e o histórico de commits da Fase 2.
 */

export interface DataCalendario {
  ano: number;
  mes: number; // 1-12
  dia: number;
}

/** Calcula o domingo de Páscoa de um ano (calendário gregoriano). */
export function calcularPascoa(ano: number): DataCalendario {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return { ano, mes, dia };
}

/** Soma (ou subtrai, com delta negativo) dias corridos a uma data, com rollover correto de mês/ano. */
export function somarDias(data: DataCalendario, deltaDias: number): DataCalendario {
  const utc = new Date(Date.UTC(data.ano, data.mes - 1, data.dia));
  utc.setUTCDate(utc.getUTCDate() + deltaDias);
  return { ano: utc.getUTCFullYear(), mes: utc.getUTCMonth() + 1, dia: utc.getUTCDate() };
}

export function dataParaIso({ ano, mes, dia }: DataCalendario): string {
  return `${String(ano).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}
