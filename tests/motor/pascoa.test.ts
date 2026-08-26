import { describe, it, expect } from "vitest";
import { calcularPascoa, somarDias } from "../../src/motor/pascoa.js";

// Datas da Páscoa verificadas contra a BrasilAPI (https://brasilapi.com.br/api/feriados/v1/{ano})
// nesta sessão, não copiadas de memória.

describe("cálculo da Páscoa (algoritmo de Gauss/Meeus)", () => {
  it("Páscoa 2024 = 31/03", () => {
    expect(calcularPascoa(2024)).toEqual({ ano: 2024, mes: 3, dia: 31 });
  });

  it("Páscoa 2025 = 20/04", () => {
    expect(calcularPascoa(2025)).toEqual({ ano: 2025, mes: 4, dia: 20 });
  });

  it("Páscoa 2026 = 05/04", () => {
    expect(calcularPascoa(2026)).toEqual({ ano: 2026, mes: 4, dia: 5 });
  });
});

describe("datas derivadas da Páscoa (briefing: Carnaval -47, Sexta-feira Santa -2, Corpus Christi +60)", () => {
  it("Carnaval (terça-feira) 2024 = 13/02", () => {
    expect(somarDias(calcularPascoa(2024), -47)).toEqual({ ano: 2024, mes: 2, dia: 13 });
  });

  it("Carnaval (terça-feira) 2025 = 04/03", () => {
    expect(somarDias(calcularPascoa(2025), -47)).toEqual({ ano: 2025, mes: 3, dia: 4 });
  });

  it("Carnaval (terça-feira) 2026 = 17/02", () => {
    expect(somarDias(calcularPascoa(2026), -47)).toEqual({ ano: 2026, mes: 2, dia: 17 });
  });

  it("Carnaval (segunda-feira) 2026 = 16/02", () => {
    expect(somarDias(calcularPascoa(2026), -48)).toEqual({ ano: 2026, mes: 2, dia: 16 });
  });

  it("Sexta-feira Santa 2026 = 03/04", () => {
    expect(somarDias(calcularPascoa(2026), -2)).toEqual({ ano: 2026, mes: 4, dia: 3 });
  });

  it("Corpus Christi 2025 = 19/06", () => {
    expect(somarDias(calcularPascoa(2025), 60)).toEqual({ ano: 2025, mes: 6, dia: 19 });
  });

  it("Corpus Christi 2026 = 04/06", () => {
    expect(somarDias(calcularPascoa(2026), 60)).toEqual({ ano: 2026, mes: 6, dia: 4 });
  });
});

describe("somarDias faz rollover correto de mês/ano", () => {
  it("30 de dezembro + 5 dias = 4 de janeiro do ano seguinte", () => {
    expect(somarDias({ ano: 2025, mes: 12, dia: 30 }, 5)).toEqual({ ano: 2026, mes: 1, dia: 4 });
  });

  it("2 de janeiro - 5 dias = 28 de dezembro do ano anterior", () => {
    expect(somarDias({ ano: 2026, mes: 1, dia: 2 }, -5)).toEqual({ ano: 2025, mes: 12, dia: 28 });
  });
});
