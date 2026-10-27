import { describe, it, expect } from "vitest";
import { consultarPeriodo, type FeriadoCuradoInput } from "../../src/motor/resolver.js";
import { montarRespostaFeriados } from "../../src/api/feriados-json.js";

// Fixtures sintéticas — NÃO são dados reais curados (esses vivem no banco,
// com fonte obrigatória). Servem só para validar o formato da resposta.
const MUNICIPIO = { codigoIbge: 9999999, nome: "Município Fictício", uf: "SP" };

const MUNICIPAL: FeriadoCuradoInput = {
  nome: "Aniversário da cidade (fixture de teste)",
  tipo: "municipal",
  abrangencia: "municipio",
  uf: "SP",
  codigoIbge: MUNICIPIO.codigoIbge,
  mes: 10,
  dia: 5,
  regraCalculo: null,
  anoInicio: null,
  anoFim: null,
  baseLegal: "Lei municipal fictícia nº 1/2020 (fixture de teste)",
  fonteUrl: null,
  dataVerificacao: "2026-01-01",
};

const periodo = (curados: FeriadoCuradoInput[]) =>
  consultarPeriodo({
    dataInicio: { ano: 2026, mes: 9, dia: 21 },
    dataFim: { ano: 2026, mes: 10, dia: 20 },
    uf: "SP",
    codigoIbge: MUNICIPIO.codigoIbge,
    feriadosCurados: curados,
  });

describe("montarRespostaFeriados (JSON para outras ferramentas)", () => {
  it("traz só os dias com ocorrência, cada um com a camada", () => {
    const r = montarRespostaFeriados(MUNICIPIO, "2026-09-21", "2026-10-20", periodo([MUNICIPAL]));
    expect(r.statusMunicipal).toBe("verificado");
    expect(r.ocorrencias.map((o) => [o.data, o.camada])).toEqual([
      ["2026-10-05", "municipal"],
      ["2026-10-12", "nacional"],
    ]);
    expect(r.ocorrencias[0]?.baseLegal).toContain("fixture");
  });

  it("município sem curadoria responde não verificado, nunca dia útil por omissão", () => {
    const r = montarRespostaFeriados(MUNICIPIO, "2026-09-21", "2026-10-20", periodo([]));
    expect(r.statusMunicipal).toBe("nao_verificado");
    expect(r.ocorrencias.every((o) => o.camada === "nacional")).toBe(true);
  });

  it("sem dia nenhum, também não verificado", () => {
    expect(montarRespostaFeriados(MUNICIPIO, "2026-09-21", "2026-09-20", []).statusMunicipal).toBe("nao_verificado");
  });
});
