import { describe, it, expect } from "vitest";
import { feriadosNacionaisDoAno } from "../../src/motor/feriados-nacionais.js";

function acha(ano: number, nome: string) {
  return feriadosNacionaisDoAno(ano).find((f) => f.ocorrencia.nome === nome);
}

describe("feriados nacionais fixos (Lei 662/1949 e Lei 6.802/1980)", () => {
  it("inclui os 8 feriados fixos clássicos em 2025, todos como camada nacional", () => {
    const nomes = [
      "Confraternização Universal",
      "Tiradentes",
      "Dia do Trabalhador",
      "Independência do Brasil",
      "Nossa Senhora Aparecida",
      "Finados",
      "Proclamação da República",
      "Natal",
    ];
    for (const nome of nomes) {
      const f = acha(2025, nome);
      expect(f, `esperava encontrar "${nome}"`).toBeDefined();
      expect(f!.ocorrencia.camada).toBe("nacional");
    }
  });

  it("12 de outubro tem como base legal a Lei 6.802/1980", () => {
    const f = acha(2025, "Nossa Senhora Aparecida");
    expect(f!.ocorrencia.baseLegal).toContain("6.802/1980");
    expect(f!.mes).toBe(10);
    expect(f!.dia).toBe(12);
  });
});

describe("Dia Nacional de Zumbi e da Consciência Negra (Lei 14.759/2023) — só a partir de 2024", () => {
  it("NÃO aparece em 2023 (lei sancionada em 21/12/2023, após a data daquele ano)", () => {
    expect(acha(2023, "Dia Nacional de Zumbi e da Consciência Negra")).toBeUndefined();
  });

  it("aparece em 2024 em diante", () => {
    const f2024 = acha(2024, "Dia Nacional de Zumbi e da Consciência Negra");
    expect(f2024).toBeDefined();
    expect(f2024!.mes).toBe(11);
    expect(f2024!.dia).toBe(20);
    expect(f2024!.ocorrencia.camada).toBe("nacional");

    const f2026 = acha(2026, "Dia Nacional de Zumbi e da Consciência Negra");
    expect(f2026).toBeDefined();
  });
});

describe("distinção feriado vs. ponto facultativo nas datas móveis (briefing Fase 2)", () => {
  it("Carnaval (segunda e terça) é ponto_facultativo, não feriado nacional", () => {
    const segunda = acha(2025, "Carnaval (segunda-feira)");
    const terca = acha(2025, "Carnaval (terça-feira)");
    expect(segunda!.ocorrencia.camada).toBe("ponto_facultativo");
    expect(terca!.ocorrencia.camada).toBe("ponto_facultativo");
  });

  it("Corpus Christi é ponto_facultativo, não feriado nacional", () => {
    const f = acha(2025, "Corpus Christi");
    expect(f!.ocorrencia.camada).toBe("ponto_facultativo");
    expect(f!.mes).toBe(6);
    expect(f!.dia).toBe(19);
  });

  it("Sexta-feira Santa é feriado nacional (tratamento pleno pelo Executivo federal)", () => {
    const f = acha(2025, "Sexta-feira Santa");
    expect(f!.ocorrencia.camada).toBe("nacional");
  });
});
