/**
 * Resposta em JSON de um período, para outras ferramentas internas lerem —
 * hoje a "Cálculo das Horas" do DP, que busca os feriados do município de
 * cada posto. Função pura: só reorganiza o que o motor já respondeu, sem
 * banco nem HTTP.
 *
 * Vão todas as ocorrências, inclusive ponto facultativo, cada uma com a
 * camada: decidir o que conta como feriado na folha é de quem lê, e a
 * camada é o que permite decidir certo (regra 2 do CLAUDE.md).
 */
import type { ResultadoConsultaDia } from "../motor/resolver.js";
import type { OcorrenciaFeriado } from "../motor/tipos.js";
import type { MunicipioResumo } from "../services/feriados-service.js";

export interface RespostaFeriadosJson {
  municipio: MunicipioResumo;
  dataInicio: string;
  dataFim: string;
  /** "nao_verificado": ninguém curou os feriados municipais deste município ainda. */
  statusMunicipal: "verificado" | "nao_verificado";
  /** Só os dias com ocorrência, em ordem de data. */
  ocorrencias: OcorrenciaFeriado[];
}

export function montarRespostaFeriados(
  municipio: MunicipioResumo,
  dataInicio: string,
  dataFim: string,
  dias: ResultadoConsultaDia[],
): RespostaFeriadosJson {
  return {
    municipio,
    dataInicio,
    dataFim,
    // O status é do município, igual em todos os dias. Sem dia nenhum, não
    // há prova de curadoria: nunca "verificado" por omissão.
    statusMunicipal: dias[0]?.statusMunicipal ?? "nao_verificado",
    ocorrencias: dias.flatMap((d) => d.ocorrencias),
  };
}
