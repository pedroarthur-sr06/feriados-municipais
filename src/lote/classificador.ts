/**
 * Classifica linhas de planilha (posto, município, uf, data) usando a
 * camada de serviço (que por sua vez chama o motor). Usado pela operação em
 * lote (upload/download) da Fase 4.
 */
import { buscarMunicipioPorNomeEUf, consultarDiaPorMunicipio } from "../services/feriados-service.js";
import { parseDataLinha, type LinhaEntrada } from "./planilha.js";

export interface LinhaClassificada extends LinhaEntrada {
  classificacao: string;
  tipos: string;
  fonte: string;
  statusMunicipal: string;
  erro: string;
}

export const ROTULOS_CAMADA: Record<string, string> = {
  nacional: "Feriado nacional",
  estadual: "Feriado estadual",
  municipal: "Feriado municipal",
  ponto_facultativo: "Ponto facultativo",
};

export function classificarLinha(linha: LinhaEntrada): LinhaClassificada {
  const base: LinhaClassificada = {
    ...linha,
    classificacao: "",
    tipos: "",
    fonte: "",
    statusMunicipal: "",
    erro: "",
  };

  if (!linha.municipio.trim() || !linha.uf.trim()) {
    return { ...base, erro: "Município ou UF não informado." };
  }

  const municipio = buscarMunicipioPorNomeEUf(linha.municipio, linha.uf);
  if (!municipio) {
    return { ...base, erro: `Município "${linha.municipio}/${linha.uf}" não encontrado na base do IBGE (confira a grafia).` };
  }

  const data = parseDataLinha(linha.data);
  if (!data) {
    return { ...base, erro: `Data "${linha.data}" inválida (use AAAA-MM-DD ou DD/MM/AAAA).` };
  }

  const resultado = consultarDiaPorMunicipio(municipio.codigoIbge, data);
  if (!resultado) {
    return { ...base, erro: "Falha inesperada ao consultar o município." };
  }

  if (resultado.ocorrencias.length === 0) {
    return {
      ...base,
      classificacao:
        resultado.statusMunicipal === "verificado" ? "Dia útil (confirmado)" : "Dia útil (municipal não verificado)",
      statusMunicipal: resultado.statusMunicipal,
    };
  }

  return {
    ...base,
    classificacao: resultado.ocorrencias.map((o) => `${ROTULOS_CAMADA[o.camada]}: ${o.nome}`).join(" + "),
    tipos: resultado.ocorrencias.map((o) => o.camada).join(", "),
    fonte: resultado.ocorrencias.map((o) => o.baseLegal).join(" | "),
    statusMunicipal: resultado.statusMunicipal,
  };
}

export function classificarLinhas(linhas: LinhaEntrada[]): LinhaClassificada[] {
  return linhas.map(classificarLinha);
}
