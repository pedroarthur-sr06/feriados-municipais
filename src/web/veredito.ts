/**
 * A frase do veredito e a descrição de cada camada — a parte mais importante
 * da interface, em TypeScript e não dentro do EJS.
 *
 * O motivo é concreto: além das telas servidas pelo Fastify, existe o arquivo
 * HTML offline gerado por `npm run html`, que responde as mesmas consultas
 * sem servidor. Com a lógica dentro do template, as duas versões diriam
 * coisas diferentes sobre o mesmo dia assim que uma das duas fosse mexida —
 * e "Feriado municipal" contra "Ponto facultativo" é exatamente a distinção
 * que o projeto não pode errar.
 */
import type { ResultadoConsultaDia } from "../motor/resolver.js";

export type CamadaVeredito =
  | "nacional"
  | "estadual"
  | "municipal"
  | "ponto_facultativo"
  | "util"
  | "nao_verificado";

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "2026-12-08" -> "8 de dezembro de 2026" */
export function porExtenso(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return `${Number(dia)} de ${MESES[Number(mes) - 1]} de ${ano}`;
}

/** O que cada camada significa para quem fecha a folha. */
export const DESCRICAO_CAMADA: Record<string, string> = {
  nacional: "Feriado nacional, vale em todo o país",
  estadual: "Feriado estadual, vale para todos os municípios da UF",
  municipal: "Feriado municipal",
  ponto_facultativo: "Ponto facultativo, não é feriado — vincula só quem decretou",
};

const ROTULO: Record<string, string> = {
  nacional: "nacional",
  estadual: "estadual",
  municipal: "municipal",
};

export interface Veredito {
  /** "Feriado municipal", "Ponto facultativo", "Dia útil", "Não verificado"… */
  frase: string;
  /** Camada que dá a cor; também diz qual é o caso para a interface. */
  camada: CamadaVeredito;
  /** Ressalva obrigatória em alguns casos; vazia quando não há o que ressalvar. */
  nota: string;
}

/**
 * Traduz o resultado resolvido numa frase. A cor vem da camada mais forte
 * presente, na mesma prioridade que o calendário usa.
 */
export function montarVeredito(resultado: ResultadoConsultaDia, nomeMunicipio: string): Veredito {
  const camadas = resultado.ocorrencias.map((o) => o.camada);
  const feriados = (["nacional", "estadual", "municipal"] as const).filter((c) => camadas.includes(c));
  const temFacultativo = camadas.includes("ponto_facultativo");

  if (feriados.length > 0) {
    const nomes = feriados.map((c) => ROTULO[c]);
    let frase =
      "Feriado " +
      (nomes.length === 1 ? nomes[0] : nomes.slice(0, -1).join(", ") + " e " + nomes.at(-1));
    if (temFacultativo) frase += " e ponto facultativo";
    return {
      frase,
      camada: feriados[0] as CamadaVeredito,
      nota:
        resultado.statusMunicipal === "nao_verificado"
          ? `Pode haver também feriado municipal: ninguém conferiu os feriados de ${nomeMunicipio} ainda.`
          : "",
    };
  }

  if (temFacultativo) {
    return {
      frase: "Ponto facultativo",
      camada: "ponto_facultativo",
      nota:
        resultado.statusMunicipal === "nao_verificado"
          ? `Pode haver também feriado municipal: ninguém conferiu os feriados de ${nomeMunicipio} ainda.`
          : "",
    };
  }

  if (resultado.statusMunicipal === "verificado") {
    return {
      frase: "Dia útil",
      camada: "util",
      nota:
        `Nenhum feriado nacional, estadual ou municipal nesta data. Os feriados municipais de ` +
        `${nomeMunicipio} já foram conferidos com fonte oficial.`,
    };
  }

  // A ressalva que o projeto proíbe omitir: sem curadoria, não se afirma dia útil.
  return {
    frase: "Não verificado",
    camada: "nao_verificado",
    nota:
      `Ninguém confirmou os feriados municipais de ${nomeMunicipio} com fonte oficial. ` +
      `Não há feriado nacional nem estadual nesta data — mas isso não basta para tratar o dia como útil.`,
  };
}
