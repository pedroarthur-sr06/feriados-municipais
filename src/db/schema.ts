import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Snapshot da base de municípios do IBGE (API de Localidades).
 * Populado pelo seed a partir de servicodados.ibge.gov.br — não é editado
 * manualmente. Ver docs/fontes-de-dados.md, seção 1.
 */
export const municipios = sqliteTable("municipios", {
  codigoIbge: integer("codigo_ibge").primaryKey(),
  nome: text("nome").notNull(),
  uf: text("uf", { length: 2 }).notNull(),
  regiao: text("regiao").notNull(),
  mesorregiao: text("mesorregiao"),
  microrregiao: text("microrregiao"),
});

/**
 * Tipos de feriado/não-dia-útil suportados. Fixo, seedado uma vez.
 * A distinção nacional/estadual/municipal/facultativo importa porque o
 * tratamento na folha de ponto é diferente (briefing, Fase 2).
 */
export const tiposFeriado = sqliteTable("tipos_feriado", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  chave: text("chave", {
    enum: ["nacional", "estadual", "municipal", "ponto_facultativo"],
  })
    .notNull()
    .unique(),
  nome: text("nome").notNull(),
  descricao: text("descricao"),
});

/**
 * Fonte legal/oficial de um feriado cadastrado (lei, decreto, Diário Oficial,
 * portal do IBGE etc). Todo registro em `feriados` referencia uma fonte —
 * é a regra inegociável do projeto: sem fonte rastreável, não entra como
 * feriado confirmado.
 */
export const fontes = sqliteTable("fontes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  descricao: text("descricao").notNull(),
  url: text("url"),
  tipo: text("tipo", {
    enum: ["lei", "decreto", "diario_oficial", "api_publica", "outro"],
  }).notNull(),
  dataPublicacao: text("data_publicacao"), // data da lei/norma, formato ISO (YYYY-MM-DD), quando conhecida
});

/**
 * Feriados ESTADUAIS, MUNICIPAIS e PONTOS FACULTATIVOS curados manualmente,
 * com fonte obrigatória. Feriados NACIONAIS não moram aqui — são calculados
 * em código (Fase 2: Lei 662/1949, Lei 6.802/1980 + algoritmo de Páscoa),
 * conforme decisão registrada em docs/fontes-de-dados.md.
 *
 * Suporta tanto data fixa anual (mes/dia) quanto regra baseada na Páscoa
 * (ex.: "pascoa-2" para Sexta-feira Santa local, "pascoa+60" para Corpus
 * Christi municipal), para cobrir feriados móveis declarados por lei local.
 */
export const feriados = sqliteTable("feriados", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tipoFeriadoId: integer("tipo_feriado_id")
    .notNull()
    .references(() => tiposFeriado.id),
  nome: text("nome").notNull(),

  // Abrangência: 'uf' (feriado estadual, aplica a todos os municípios da UF)
  // ou 'municipio' (aplica só ao município referenciado).
  abrangencia: text("abrangencia", { enum: ["uf", "municipio"] }).notNull(),
  uf: text("uf", { length: 2 }).notNull(),
  codigoIbge: integer("codigo_ibge").references(() => municipios.codigoIbge),

  // Data recorrente: OU (mes,dia) fixos, OU uma regra relativa à Páscoa.
  mes: integer("mes"),
  dia: integer("dia"),
  regraCalculo: text("regra_calculo"), // ex.: 'pascoa', 'pascoa-47', 'pascoa-2', 'pascoa+60'

  // Validade opcional (leis revogadas/alteradas) — null = vale para sempre.
  anoInicio: integer("ano_inicio"),
  anoFim: integer("ano_fim"),

  fonteId: integer("fonte_id")
    .notNull()
    .references(() => fontes.id),
  autor: text("autor").notNull(), // quem cadastrou/verificou (e-mail ou nome)
  dataVerificacao: text("data_verificacao").notNull(), // ISO date da última confirmação na fonte
  observacao: text("observacao"),
  ativo: integer("ativo", { mode: "boolean" }).notNull().default(true),
});

/**
 * Leads de feriados NÃO VERIFICADOS, importados de datasets comunitários
 * (ex.: joaopbini/feriados-brasil) para acelerar a curadoria manual.
 * NUNCA é lido pelo motor de consulta / exibido como fato ao usuário final —
 * serve só como fila de trabalho para a tela administrativa (Fase 4): alguém
 * confirma na fonte primária e promove para `feriados`, ou rejeita.
 */
export const candidatosNaoVerificados = sqliteTable(
  "candidatos_nao_verificados",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fonteDataset: text("fonte_dataset").notNull(), // ex.: 'joaopbini/feriados-brasil@2026'
    tipoSugerido: text("tipo_sugerido", {
      enum: ["estadual", "municipal", "ponto_facultativo"],
    }).notNull(),
    nome: text("nome").notNull(),
    descricaoOriginal: text("descricao_original"), // texto bruto da fonte, pode conter citação de lei a confirmar
    uf: text("uf", { length: 2 }).notNull(),
    codigoIbge: integer("codigo_ibge").references(() => municipios.codigoIbge),
    municipioNomeOriginal: text("municipio_nome_original"), // como veio na fonte, para conferência se o match de codigoIbge falhar
    data: text("data").notNull(), // data ISO (YYYY-MM-DD) do ano de referência do import, só como pista
    status: text("status", {
      enum: ["pendente", "promovido", "rejeitado"],
    })
      .notNull()
      .default("pendente"),
    importadoEm: text("importado_em").notNull(),
  },
);
