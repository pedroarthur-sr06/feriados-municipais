import { describe, it, expect } from "vitest";
import { parseDataLinha, lerCsv } from "../../src/lote/planilha.js";

describe("parseDataLinha (planilha de lote)", () => {
  it("aceita formato AAAA-MM-DD", () => {
    expect(parseDataLinha("2025-07-02")).toEqual({ ano: 2025, mes: 7, dia: 2 });
  });

  it("aceita formato DD/MM/AAAA", () => {
    expect(parseDataLinha("02/07/2025")).toEqual({ ano: 2025, mes: 7, dia: 2 });
  });

  it("aceita DD/MM/AAAA sem zero à esquerda", () => {
    expect(parseDataLinha("2/7/2025")).toEqual({ ano: 2025, mes: 7, dia: 2 });
  });

  it("rejeita data inexistente (31 de fevereiro)", () => {
    expect(parseDataLinha("31/02/2025")).toBeNull();
  });

  it("rejeita mês fora do intervalo", () => {
    expect(parseDataLinha("2025-13-01")).toBeNull();
  });

  it("rejeita texto que não é data", () => {
    expect(parseDataLinha("não é uma data")).toBeNull();
  });

  it("rejeita string vazia", () => {
    expect(parseDataLinha("")).toBeNull();
  });
});

describe("lerCsv", () => {
  it("lê CSV separado por vírgula com cabeçalho acentuado", () => {
    const csv = "posto,município,uf,data\nCentro,Salvador,BA,02/07/2025\n";
    const { linhas, delimitador } = lerCsv(Buffer.from(csv, "utf-8"));
    expect(delimitador).toBe(",");
    expect(linhas).toEqual([{ posto: "Centro", municipio: "Salvador", uf: "BA", data: "02/07/2025" }]);
  });

  it("detecta e lê CSV separado por ponto-e-vírgula (padrão Excel pt-BR)", () => {
    const csv = "posto;municipio;uf;data\nCentro;Salvador;BA;02/07/2025\n";
    const { linhas, delimitador } = lerCsv(Buffer.from(csv, "utf-8"));
    expect(delimitador).toBe(";");
    expect(linhas).toEqual([{ posto: "Centro", municipio: "Salvador", uf: "BA", data: "02/07/2025" }]);
  });

  it("rejeita CSV sem as colunas obrigatórias", () => {
    const csv = "nome,cidade\nCentro,Salvador\n";
    expect(() => lerCsv(Buffer.from(csv, "utf-8"))).toThrow(/obrigatória/);
  });

  it("remove BOM UTF-8 no início do arquivo", () => {
    const csv = "﻿posto,municipio,uf,data\nCentro,Salvador,BA,02/07/2025\n";
    const { linhas } = lerCsv(Buffer.from(csv, "utf-8"));
    expect(linhas).toHaveLength(1);
  });
});
