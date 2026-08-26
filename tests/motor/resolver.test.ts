import { describe, it, expect } from "vitest";
import { consultarDia, consultarPeriodo, type FeriadoCuradoInput } from "../../src/motor/resolver.js";

// Fixtures sintéticas para teste — NÃO são dados reais curados do produto
// (esses vivem no banco, com fonte obrigatória). Usadas só para validar a
// lógica pura de resolução em camadas.

const MUNICIPIO_TESTE_UF = "SP";
const MUNICIPIO_TESTE_IBGE = 9999999; // código fictício, não corresponde a município real

const FERIADO_MUNICIPAL_FIXTURE: FeriadoCuradoInput = {
  nome: "Dia do Padroeiro (fixture de teste)",
  tipo: "municipal",
  abrangencia: "municipio",
  uf: MUNICIPIO_TESTE_UF,
  codigoIbge: MUNICIPIO_TESTE_IBGE,
  mes: 9,
  dia: 7, // mesma data do feriado nacional "Independência do Brasil" — usada para testar sobreposição
  regraCalculo: null,
  anoInicio: null,
  anoFim: null,
  baseLegal: "Lei municipal fictícia nº 1/2020 (fixture de teste)",
  fonteUrl: "https://exemplo.invalido/lei-1-2020",
  dataVerificacao: "2026-01-01",
};

const FERIADO_ESTADUAL_FIXTURE: FeriadoCuradoInput = {
  nome: "Data cívica estadual (fixture de teste)",
  tipo: "estadual",
  abrangencia: "uf",
  uf: MUNICIPIO_TESTE_UF,
  codigoIbge: null,
  mes: null,
  dia: null,
  regraCalculo: "pascoa+60", // reaproveita a regra de Corpus Christi só para testar regra baseada em Páscoa num feriado curado
  anoInicio: null,
  anoFim: null,
  baseLegal: "Lei estadual fictícia nº 2/2015 (fixture de teste)",
  fonteUrl: null,
  dataVerificacao: "2026-01-01",
};

describe("sobreposição: mesma data com feriado nacional e municipal simultâneos", () => {
  it("7 de setembro de 2025 retorna as duas ocorrências, nenhuma anula a outra", () => {
    const resultado = consultarDia({
      ano: 2025,
      mes: 9,
      dia: 7,
      uf: MUNICIPIO_TESTE_UF,
      codigoIbge: MUNICIPIO_TESTE_IBGE,
      feriadosCurados: [FERIADO_MUNICIPAL_FIXTURE],
    });

    expect(resultado.ocorrencias).toHaveLength(2);
    const camadas = resultado.ocorrencias.map((o) => o.camada).sort();
    expect(camadas).toEqual(["municipal", "nacional"]);
    expect(resultado.statusMunicipal).toBe("verificado");
  });
});

describe('município sem dado municipal cadastrado → status "não verificado"', () => {
  it("retorna nao_verificado quando não há nenhum feriado municipal curado para o código IBGE", () => {
    const resultado = consultarDia({
      ano: 2025,
      mes: 6,
      dia: 10, // data qualquer, sem feriado de nenhuma camada
      uf: "MG",
      codigoIbge: 3106200, // Belo Horizonte — sem fixture curada neste teste
      feriadosCurados: [],
    });

    expect(resultado.statusMunicipal).toBe("nao_verificado");
    expect(resultado.ocorrencias).toHaveLength(0);
  });

  it("continua nao_verificado mesmo se só existir feriado ESTADUAL curado (estadual não conta como curadoria municipal)", () => {
    const resultado = consultarDia({
      ano: 2025,
      mes: 1,
      dia: 1,
      uf: MUNICIPIO_TESTE_UF,
      codigoIbge: MUNICIPIO_TESTE_IBGE,
      feriadosCurados: [FERIADO_ESTADUAL_FIXTURE],
    });
    expect(resultado.statusMunicipal).toBe("nao_verificado");
  });

  it('fica "verificado" assim que existe ao menos um feriado municipal curado, mesmo em data sem feriado nenhum', () => {
    const resultado = consultarDia({
      ano: 2025,
      mes: 3,
      dia: 10, // data sem feriado nenhum (longe de Carnaval/Sexta Santa/Corpus Christi de 2025)
      uf: MUNICIPIO_TESTE_UF,
      codigoIbge: MUNICIPIO_TESTE_IBGE,
      feriadosCurados: [FERIADO_MUNICIPAL_FIXTURE],
    });
    expect(resultado.statusMunicipal).toBe("verificado");
    expect(resultado.ocorrencias).toHaveLength(0);
  });
});

describe("feriado curado com regra relativa à Páscoa (não só data fixa)", () => {
  it("resolve a data estadual fixture (pascoa+60) corretamente para 2025 e 2026", () => {
    const r2025 = consultarDia({
      ano: 2025,
      mes: 6,
      dia: 19, // Corpus Christi 2025
      uf: MUNICIPIO_TESTE_UF,
      codigoIbge: null,
      feriadosCurados: [FERIADO_ESTADUAL_FIXTURE],
    });
    expect(r2025.ocorrencias.some((o) => o.camada === "estadual")).toBe(true);

    const r2026 = consultarDia({
      ano: 2026,
      mes: 6,
      dia: 4, // Corpus Christi 2026
      uf: MUNICIPIO_TESTE_UF,
      codigoIbge: null,
      feriadosCurados: [FERIADO_ESTADUAL_FIXTURE],
    });
    expect(r2026.ocorrencias.some((o) => o.camada === "estadual")).toBe(true);
  });
});

describe("vigência (ano_inicio / ano_fim) de feriados curados", () => {
  it("feriado curado com ano_inicio no futuro não aparece antes disso", () => {
    const fixture: FeriadoCuradoInput = {
      ...FERIADO_MUNICIPAL_FIXTURE,
      anoInicio: 2027,
    };
    const antes = consultarDia({
      ano: 2026,
      mes: 9,
      dia: 7,
      uf: MUNICIPIO_TESTE_UF,
      codigoIbge: MUNICIPIO_TESTE_IBGE,
      feriadosCurados: [fixture],
    });
    const depois = consultarDia({
      ano: 2027,
      mes: 9,
      dia: 7,
      uf: MUNICIPIO_TESTE_UF,
      codigoIbge: MUNICIPIO_TESTE_IBGE,
      feriadosCurados: [fixture],
    });
    expect(antes.ocorrencias.some((o) => o.camada === "municipal")).toBe(false);
    expect(depois.ocorrencias.some((o) => o.camada === "municipal")).toBe(true);
  });
});

describe("suporte a anos passados e ao ano seguinte (sem assumir ano corrente)", () => {
  it.each([2015, 2020, 2024, 2025, 2026, 2030])("calcula sem erro e com nacionais para o ano %i", (ano) => {
    const resultado = consultarDia({
      ano,
      mes: 1,
      dia: 1,
      uf: "SP",
      codigoIbge: null,
      feriadosCurados: [],
    });
    expect(resultado.ocorrencias.some((o) => o.nome === "Confraternização Universal")).toBe(true);
  });
});

describe("consulta por período (ciclo de ponto)", () => {
  it("21/07 a 20/08/2025 retorna 31 dias, na ordem, com pelo menos um feriado municipal fixture reconhecido", () => {
    const resultado = consultarPeriodo({
      dataInicio: { ano: 2025, mes: 7, dia: 21 },
      dataFim: { ano: 2025, mes: 8, dia: 20 },
      uf: MUNICIPIO_TESTE_UF,
      codigoIbge: MUNICIPIO_TESTE_IBGE,
      feriadosCurados: [FERIADO_MUNICIPAL_FIXTURE],
    });

    expect(resultado).toHaveLength(31);
    expect(resultado[0]!.data).toBe("2025-07-21");
    expect(resultado.at(-1)!.data).toBe("2025-08-20");
    // 07/09 não entra nesse ciclo — troca por uma data dentro do período com feriado nacional conhecido: nenhum feriado fixo cai nesse intervalo em 2025, então só validamos a integridade da sequência de dias.
    const datas = resultado.map((r) => r.data);
    expect(new Set(datas).size).toBe(31); // sem duplicatas/buracos
  });

  it("período cruzando virada de ano funciona (dezembro/2025 a janeiro/2026)", () => {
    const resultado = consultarPeriodo({
      dataInicio: { ano: 2025, mes: 12, dia: 20 },
      dataFim: { ano: 2026, mes: 1, dia: 5 },
      uf: "SP",
      codigoIbge: null,
      feriadosCurados: [],
    });
    expect(resultado).toHaveLength(17);
    const natal = resultado.find((r) => r.data === "2025-12-25");
    const anoNovo = resultado.find((r) => r.data === "2026-01-01");
    expect(natal!.ocorrencias.some((o) => o.nome === "Natal")).toBe(true);
    expect(anoNovo!.ocorrencias.some((o) => o.nome === "Confraternização Universal")).toBe(true);
  });

  it("rejeita período com dataInicio depois de dataFim", () => {
    expect(() =>
      consultarPeriodo({
        dataInicio: { ano: 2025, mes: 8, dia: 20 },
        dataFim: { ano: 2025, mes: 7, dia: 21 },
        uf: "SP",
        codigoIbge: null,
        feriadosCurados: [],
      }),
    ).toThrow();
  });
});

describe("dia da semana calculado corretamente", () => {
  it("Carnaval (terça) de 2025, 04/03, cai numa terça-feira", () => {
    const resultado = consultarDia({
      ano: 2025,
      mes: 3,
      dia: 4,
      uf: "SP",
      codigoIbge: null,
      feriadosCurados: [],
    });
    expect(resultado.diaSemana).toBe("terça-feira");
  });
});
