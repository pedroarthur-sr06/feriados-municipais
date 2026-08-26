/**
 * Feriados nacionais e pontos facultativos nacionais, calculados em código —
 * nunca dependem de curadoria manual em banco. Ver docs/fontes-de-dados.md,
 * seção 2, e a regra inegociável em CLAUDE.md.
 *
 * CLASSIFICAÇÃO FERIADO vs. PONTO FACULTATIVO (importante e fácil de errar —
 * a maioria dos agregadores públicos, incluindo BrasilAPI e Nager.Date,
 * classifica Carnaval e Corpus Christi como feriado nacional, o que é
 * tecnicamente incorreto):
 *
 * - Carnaval (segunda e terça-feira) e Corpus Christi (quinta-feira) NÃO são
 *   feriados fixados em lei federal — são ponto facultativo para a
 *   administração pública federal, decretado ano a ano por portaria do
 *   Ministério da Gestão e da Inovação em Serviços Públicos (ex.: Portaria
 *   MGI nº 11.460/2025, para o ano de 2026). A data em si é 100%
 *   previsível a partir da Páscoa e o Executivo decreta ponto facultativo
 *   nessas datas todos os anos — por isso calculamos aqui — mas
 *   ocasionalmente a portaria acrescenta um dia extra de emenda (ex.: em
 *   2026 a sexta-feira 5/6, além da quinta de Corpus Christi) que este
 *   cálculo NÃO cobre; um dia extra de emenda precisaria ser cadastrado
 *   manualmente, com a portaria do ano como fonte.
 * - Sexta-feira Santa, por outro lado, é tratada como feriado pleno pelo
 *   próprio calendário oficial do Executivo (não entra na lista de pontos
 *   facultativos), por isso está classificada aqui como nacional — embora
 *   tecnicamente se enquadre entre os feriados religiosos do art. 2º da Lei
 *   nº 9.093/1995, e não na lista fixa da Lei 662/1949.
 * - Corpus Christi também pode ser feriado municipal/estadual em municípios
 *   com lei própria — isso é responsabilidade da curadoria local
 *   (tabela `feriados`), não deste módulo.
 *
 * Datas verificadas nesta sessão contra a BrasilAPI para 2024, 2025 e 2026.
 */
import { calcularPascoa, somarDias, dataParaIso, type DataCalendario } from "./pascoa.js";
import type { OcorrenciaFeriado } from "./tipos.js";

export interface FeriadoNacionalCalculado {
  mes: number;
  dia: number;
  ocorrencia: OcorrenciaFeriado;
}

const BASE_LEGAL_662 = "Lei nº 662/1949 (redação dada pela Lei nº 10.607/2002), art. 1º";

interface FixoAnual {
  mes: number;
  dia: number;
  nome: string;
  baseLegal: string;
  /** Ano a partir do qual a lei está em vigor; omitido = sempre vigente. */
  anoInicio?: number;
}

const FIXOS: FixoAnual[] = [
  { mes: 1, dia: 1, nome: "Confraternização Universal", baseLegal: BASE_LEGAL_662 },
  { mes: 4, dia: 21, nome: "Tiradentes", baseLegal: BASE_LEGAL_662 },
  { mes: 5, dia: 1, nome: "Dia do Trabalhador", baseLegal: BASE_LEGAL_662 },
  { mes: 9, dia: 7, nome: "Independência do Brasil", baseLegal: BASE_LEGAL_662 },
  { mes: 10, dia: 12, nome: "Nossa Senhora Aparecida", baseLegal: "Lei nº 6.802/1980" },
  { mes: 11, dia: 2, nome: "Finados", baseLegal: BASE_LEGAL_662 },
  { mes: 11, dia: 15, nome: "Proclamação da República", baseLegal: BASE_LEGAL_662 },
  {
    mes: 11,
    dia: 20,
    nome: "Dia Nacional de Zumbi e da Consciência Negra",
    baseLegal: "Lei nº 14.759/2023",
    // Sancionada em 21/12/2023, após o 20/11 daquele ano já ter passado —
    // primeira vigência efetiva é 20/11/2024.
    anoInicio: 2024,
  },
  { mes: 12, dia: 25, nome: "Natal", baseLegal: BASE_LEGAL_662 },
];

const BASE_PONTO_FACULTATIVO_CARNAVAL =
  "Ponto facultativo decretado anualmente para a administração pública federal por portaria do Ministério da Gestão e da Inovação em Serviços Públicos (ex.: Portaria MGI nº 11.460/2025, para 2026) — não é feriado fixado em lei.";

const BASE_PONTO_FACULTATIVO_CORPUS_CHRISTI =
  "Ponto facultativo decretado anualmente para a administração pública federal por portaria do Ministério da Gestão e da Inovação em Serviços Públicos (ex.: Portaria MGI nº 11.460/2025, para 2026) — não é feriado fixado em lei. Pode ser feriado municipal/estadual onde houver lei local própria (ver curadoria municipal).";

const BASE_SEXTA_FEIRA_SANTA =
  "Tratada como feriado nacional pleno no calendário oficial do Poder Executivo federal (não consta na lista de pontos facultativos); tecnicamente enquadrada entre os feriados religiosos do art. 2º da Lei nº 9.093/1995, mas observada uniformemente em todo o território.";

function calculado(data: DataCalendario, nome: string, camada: OcorrenciaFeriado["camada"], baseLegal: string): FeriadoNacionalCalculado {
  return {
    mes: data.mes,
    dia: data.dia,
    ocorrencia: {
      data: dataParaIso(data),
      nome,
      camada,
      baseLegal,
    },
  };
}

/** Feriados nacionais + pontos facultativos nacionais de um ano específico. */
export function feriadosNacionaisDoAno(ano: number): FeriadoNacionalCalculado[] {
  const resultado: FeriadoNacionalCalculado[] = [];

  for (const f of FIXOS) {
    if (f.anoInicio != null && ano < f.anoInicio) continue;
    resultado.push(calculado({ ano, mes: f.mes, dia: f.dia }, f.nome, "nacional", f.baseLegal));
  }

  const pascoa = calcularPascoa(ano);
  resultado.push(
    calculado(somarDias(pascoa, -48), "Carnaval (segunda-feira)", "ponto_facultativo", BASE_PONTO_FACULTATIVO_CARNAVAL),
    calculado(somarDias(pascoa, -47), "Carnaval (terça-feira)", "ponto_facultativo", BASE_PONTO_FACULTATIVO_CARNAVAL),
    calculado(somarDias(pascoa, -2), "Sexta-feira Santa", "nacional", BASE_SEXTA_FEIRA_SANTA),
    calculado(somarDias(pascoa, 60), "Corpus Christi", "ponto_facultativo", BASE_PONTO_FACULTATIVO_CORPUS_CHRISTI),
  );

  return resultado;
}
