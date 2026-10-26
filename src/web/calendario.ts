/**
 * Helper de apresentação (não é motor nem serviço): monta a grade do
 * calendário mensal a partir de um resultado já resolvido, decidindo a
 * categoria visual de cada dia — a mesma legenda pedida na Fase 3:
 * nacional / estadual / municipal / facultativo / útil / não verificado.
 *
 * Prioridade quando há sobreposição no mesmo dia (mostra a camada mais
 * "forte" na cor da célula; a lista de ocorrências abaixo do calendário
 * continua mostrando todas, sem esconder nada).
 */
import type { Camada } from "../motor/tipos.js";
import type { ResultadoConsultaDia } from "../motor/resolver.js";

export type CategoriaDia = Camada | "nao_verificado" | "util";

const PRIORIDADE: Camada[] = ["nacional", "estadual", "municipal", "ponto_facultativo"];

export function categoriaDoDia(resultado: ResultadoConsultaDia): CategoriaDia {
  for (const camada of PRIORIDADE) {
    if (resultado.ocorrencias.some((o) => o.camada === camada)) return camada;
  }
  // Sem nenhuma ocorrência confirmada: se o município nunca foi curado para
  // feriados municipais, não dá pra garantir que é dia útil — regra
  // inegociável (ver CLAUDE.md).
  return resultado.statusMunicipal === "nao_verificado" ? "nao_verificado" : "util";
}

export interface CelulaCalendario {
  dia: number | null; // null = célula de preenchimento (fora do mês)
  data?: string;
  categoria?: CategoriaDia;
  resultado?: ResultadoConsultaDia;
}

/** Monta a grade (semanas de 7 colunas, domingo a sábado) de um mês específico. */
export function montarGradeCalendario(ano: number, mes: number, dias: ResultadoConsultaDia[]): CelulaCalendario[][] {
  const primeiroDiaSemana = new Date(Date.UTC(ano, mes - 1, 1)).getUTCDay(); // 0 = domingo

  const celulas: CelulaCalendario[] = [];
  for (let i = 0; i < primeiroDiaSemana; i++) celulas.push({ dia: null });

  for (const resultado of dias) {
    const dia = Number(resultado.data.slice(8, 10));
    celulas.push({
      dia,
      data: resultado.data,
      categoria: categoriaDoDia(resultado),
      resultado,
    });
  }

  while (celulas.length % 7 !== 0) celulas.push({ dia: null });

  const semanas: CelulaCalendario[][] = [];
  for (let i = 0; i < celulas.length; i += 7) {
    semanas.push(celulas.slice(i, i + 7));
  }
  return semanas;
}

export const NOMES_MES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
] as const;

export function nomeMes(mes: number): string {
  return NOMES_MES[mes - 1] ?? String(mes);
}

// ---------------------------------------------------------------------------
// Apresentação da grade
//
// As classes de cada célula moravam dentro do template EJS. Decidir aqui o
// que é cada dia — categoria, destaque, fim de semana, marcador de
// sobreposição — deixa a regra num lugar tipado e conferível, em vez de
// espalhada em condicionais de template.
// ---------------------------------------------------------------------------

/** Cabeçalho de domingo a sábado; o fim de semana é posição, não dado. */
export const DIAS_CABECALHO: { rotulo: string; fimDeSemana: boolean }[] = [
  { rotulo: "D", fimDeSemana: true },
  { rotulo: "S", fimDeSemana: false },
  { rotulo: "T", fimDeSemana: false },
  { rotulo: "Q", fimDeSemana: false },
  { rotulo: "Q", fimDeSemana: false },
  { rotulo: "S", fimDeSemana: false },
  { rotulo: "S", fimDeSemana: true },
];

export interface CelulaApresentacao {
  dia: number | null;
  /** Pronta para o atributo class. */
  classes: string;
  /** Nomes das ocorrências, para o title; "" quando não há. */
  titulo: string;
  /** "+N" quando o dia tem mais de uma ocorrência; "" caso contrário. */
  marcador: string;
}

export function apresentarCalendario(
  semanas: CelulaCalendario[][],
  dataDestaque?: string,
): CelulaApresentacao[][] {
  return semanas.map((semana) =>
    semana.map((celula, coluna) => {
      const fds = DIAS_CABECALHO[coluna]?.fimDeSemana ? " fim-de-semana" : "";
      if (celula.dia === null) {
        return { dia: null, classes: "vazia" + fds, titulo: "", marcador: "" };
      }
      const ocorrencias = celula.resultado?.ocorrencias ?? [];
      const classes =
        `dia-${celula.categoria}` +
        (ocorrencias.length > 0 ? " tem-ocorrencia" : "") +
        (dataDestaque && celula.data === dataDestaque ? " dia-consultado" : "") +
        fds;
      return {
        dia: celula.dia,
        classes,
        titulo: ocorrencias.map((o) => o.nome).join(" + "),
        marcador: ocorrencias.length > 1 ? `+${ocorrencias.length}` : "",
      };
    }),
  );
}
