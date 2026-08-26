export type Camada = "nacional" | "estadual" | "municipal" | "ponto_facultativo";

/** Uma ocorrência de feriado/ponto facultativo em uma data específica. */
export interface OcorrenciaFeriado {
  data: string; // ISO YYYY-MM-DD
  nome: string;
  camada: Camada;
  baseLegal: string;
  fonteUrl?: string;
  dataVerificacao?: string;
}
