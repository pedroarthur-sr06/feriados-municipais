/**
 * Leitura/escrita de planilhas CSV/XLSX para a operação em lote (Fase 4).
 * Puro I/O de arquivo — não sabe nada sobre feriados; ver
 * src/lote/classificador.ts para a parte que consulta o motor.
 */
import { parse as parseCsvSync } from "csv-parse/sync";
import { stringify as stringifyCsvSync } from "csv-stringify/sync";
import ExcelJS from "exceljs";

export interface LinhaEntrada {
  posto: string;
  municipio: string;
  uf: string;
  data: string;
}

export interface DataYmd {
  ano: number;
  mes: number;
  dia: number;
}

/** Aceita "AAAA-MM-DD" ou "DD/MM/AAAA" (com ou sem zero à esquerda); valida se a data existe de fato. */
export function parseDataLinha(valorBruto: string): DataYmd | null {
  const valor = valorBruto.trim();

  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (m?.[1] && m[2] && m[3]) {
    return validarData(Number(m[1]), Number(m[2]), Number(m[3]));
  }

  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(valor);
  if (m?.[1] && m[2] && m[3]) {
    return validarData(Number(m[3]), Number(m[2]), Number(m[1]));
  }

  return null;
}

function validarData(ano: number, mes: number, dia: number): DataYmd | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return { ano, mes, dia };
}

const COLUNAS_OBRIGATORIAS = ["posto", "municipio", "uf", "data"] as const;

function normalizarCabecalho(valor: string): string {
  return valor
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // remove acentos: "município" -> "municipio"
}

function detectarDelimitador(textoCsv: string): "," | ";" {
  const primeiraLinha = textoCsv.split(/\r?\n/, 1)[0] ?? "";
  const virgulas = (primeiraLinha.match(/,/g) ?? []).length;
  const pontoVirgulas = (primeiraLinha.match(/;/g) ?? []).length;
  return pontoVirgulas > virgulas ? ";" : ",";
}

export interface LeituraCsv {
  linhas: LinhaEntrada[];
  delimitador: "," | ";";
}

export function lerCsv(buffer: Buffer): LeituraCsv {
  // Remove BOM UTF-8 se presente (comum em CSV exportado pelo Excel).
  const texto = buffer.toString("utf-8").replace(/^﻿/, "");
  const delimitador = detectarDelimitador(texto);

  const registros = parseCsvSync(texto, {
    columns: (cabecalhos: string[]) => cabecalhos.map(normalizarCabecalho),
    delimiter: delimitador,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  validarColunas(registros[0] ? Object.keys(registros[0]) : []);

  const linhas = registros.map((r) => ({
    posto: r.posto ?? "",
    municipio: r.municipio ?? "",
    uf: r.uf ?? "",
    data: r.data ?? "",
  }));

  return { linhas, delimitador };
}

export async function lerXlsx(buffer: Buffer): Promise<{ linhas: LinhaEntrada[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new Error("A planilha não tem nenhuma aba.");
  }

  const indicePorColuna: Record<string, number> = {};
  sheet.getRow(1).eachCell((cell, colNumber) => {
    indicePorColuna[normalizarCabecalho(String(cell.value ?? ""))] = colNumber;
  });
  validarColunas(Object.keys(indicePorColuna));

  const linhas: LinhaEntrada[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // cabeçalho
    const valor = (coluna: string) => row.getCell(indicePorColuna[coluna]!).value;
    const posto = String(valor("posto") ?? "").trim();
    const municipio = String(valor("municipio") ?? "").trim();
    const uf = String(valor("uf") ?? "").trim();
    const data = formatarCelulaData(valor("data"));
    if (!posto && !municipio && !uf && !data) return; // linha em branco
    linhas.push({ posto, municipio, uf, data });
  });

  return { linhas };
}

function validarColunas(colunasEncontradas: string[]) {
  const faltando = COLUNAS_OBRIGATORIAS.filter((c) => !colunasEncontradas.includes(c));
  if (faltando.length > 0) {
    throw new Error(
      `Coluna(s) obrigatória(s) não encontrada(s): ${faltando.join(", ")}. ` +
        `Colunas esperadas: posto, municipio, uf, data.`,
    );
  }
}

function formatarCelulaData(valor: unknown): string {
  if (valor instanceof Date) {
    const ano = valor.getUTCFullYear();
    const mes = String(valor.getUTCMonth() + 1).padStart(2, "0");
    const dia = String(valor.getUTCDate()).padStart(2, "0");
    return `${ano}-${mes}-${dia}`;
  }
  if (valor && typeof valor === "object" && "text" in valor) {
    return String((valor as { text: unknown }).text ?? "").trim();
  }
  return String(valor ?? "").trim();
}

export interface ColunaSaida {
  chave: string;
  cabecalho: string;
}

/** Gera um CSV (com BOM, para o Excel abrir os acentos corretamente). */
export function gerarCsv<T extends object>(linhas: T[], colunas: ColunaSaida[], delimitador: "," | ";" = ","): Buffer {
  const csv = stringifyCsvSync(linhas, {
    header: true,
    delimiter: delimitador,
    columns: colunas.map((c) => ({ key: c.chave, header: c.cabecalho })),
  });
  return Buffer.from("﻿" + csv, "utf-8");
}

/** Gera um XLSX com uma aba única. */
export async function gerarXlsx<T extends object>(
  nomeAba: string,
  linhas: T[],
  colunas: (ColunaSaida & { largura?: number })[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(nomeAba);
  sheet.columns = colunas.map((c) => ({ header: c.cabecalho, key: c.chave, width: c.largura ?? 22 }));
  sheet.getRow(1).font = { bold: true };
  for (const linha of linhas) {
    sheet.addRow(linha);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
