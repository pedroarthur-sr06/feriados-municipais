/**
 * Exportação em CSV/PDF do resultado de um período (Fase 4) — para anexar
 * ao fechamento de ponto. Ao contrário da lista resumida da tela de
 * consulta (Fase 3, só dias com ocorrência), a exportação lista TODOS os
 * dias do período, incluindo os úteis — é o registro completo para anexar.
 */
import type { ResultadoConsultaDia } from "../motor/resolver.js";
import type { MunicipioResumo } from "../services/feriados-service.js";
import { ROTULOS_CAMADA } from "./classificador.js";
import { gerarCsv } from "./planilha.js";
import { gerarPdf, type TDocumentDefinitions } from "./pdf.js";

export interface LinhaExportacaoPeriodo {
  data: string;
  diaSemana: string;
  classificacao: string;
  tipos: string;
  fonte: string;
  statusMunicipal: string;
}

export function linhasDoPeriodo(dias: ResultadoConsultaDia[]): LinhaExportacaoPeriodo[] {
  return dias.map((d) => {
    if (d.ocorrencias.length === 0) {
      return {
        data: d.data,
        diaSemana: d.diaSemana,
        classificacao: d.statusMunicipal === "verificado" ? "Dia útil (confirmado)" : "Dia útil (municipal não verificado)",
        tipos: "",
        fonte: "",
        statusMunicipal: d.statusMunicipal,
      };
    }
    return {
      data: d.data,
      diaSemana: d.diaSemana,
      classificacao: d.ocorrencias.map((o) => `${ROTULOS_CAMADA[o.camada]}: ${o.nome}`).join(" + "),
      tipos: d.ocorrencias.map((o) => o.camada).join(", "),
      fonte: d.ocorrencias.map((o) => o.baseLegal).join(" | "),
      statusMunicipal: d.statusMunicipal,
    };
  });
}

function formatarBr(iso: string): string {
  return iso.split("-").reverse().join("/");
}

export function gerarCsvPeriodo(linhas: LinhaExportacaoPeriodo[]): Buffer {
  return gerarCsv(
    linhas.map((l) => ({ ...l, data: formatarBr(l.data) })),
    [
      { chave: "data", cabecalho: "data" },
      { chave: "diaSemana", cabecalho: "dia_semana" },
      { chave: "classificacao", cabecalho: "classificacao" },
      { chave: "tipos", cabecalho: "tipos" },
      { chave: "fonte", cabecalho: "fonte" },
      { chave: "statusMunicipal", cabecalho: "status_municipal" },
    ],
  );
}

export async function gerarPdfPeriodo(opts: {
  municipio: MunicipioResumo;
  dataInicioTexto: string;
  dataFimTexto: string;
  linhas: LinhaExportacaoPeriodo[];
  statusMunicipal: "verificado" | "nao_verificado";
  geradoEm: string;
}): Promise<Buffer> {
  const { municipio, dataInicioTexto, dataFimTexto, linhas, statusMunicipal, geradoEm } = opts;

  const corpo = [
    ["Data", "Dia", "Classificação", "Fonte"],
    ...linhas.map((l) => [formatarBr(l.data), l.diaSemana, l.classificacao, l.fonte || "—"]),
  ];

  const docDefinition: TDocumentDefinitions = {
    pageMargins: [30, 40, 30, 30],
    content: [
      { text: "Relatório de feriados e pontos facultativos", fontSize: 14, bold: true },
      { text: `${municipio.nome}/${municipio.uf} — ${dataInicioTexto} a ${dataFimTexto}`, fontSize: 11, margin: [0, 2, 0, 8] },
      ...(statusMunicipal === "nao_verificado"
        ? [
            {
              text: "Atenção: feriados municipais deste município ainda não foram confirmados em fonte oficial. Este relatório mostra apenas feriados nacionais e estaduais confirmados.",
              fontSize: 8,
              italics: true,
              color: "#7a1710",
              margin: [0, 0, 0, 8] as [number, number, number, number],
            },
          ]
        : []),
      {
        table: {
          headerRows: 1,
          widths: [55, 60, "*", "*"],
          body: corpo,
        },
        layout: {
          fillColor: (rowIndex: number) => (rowIndex === 0 ? "#e6efff" : rowIndex % 2 === 0 ? "#f7f7f5" : null),
        },
        fontSize: 8,
      },
      { text: `Gerado em ${geradoEm} — feriados-municipais`, fontSize: 7, color: "#57606a", margin: [0, 12, 0, 0] },
    ],
  };

  return gerarPdf(docDefinition);
}
