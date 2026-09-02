/**
 * Camada de serviço: busca dados no SQLite (municípios, feriados curados) e
 * chama o motor puro (src/motor/) para resolver a consulta. O motor em si
 * nunca toca o banco — só esta camada.
 */
import { and, eq, or, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { candidatosNaoVerificados, feriados, fontes, municipios, tiposFeriado } from "../db/schema.js";
import {
  consultarDia as motorConsultarDia,
  consultarPeriodo as motorConsultarPeriodo,
  type FeriadoCuradoInput,
  type ResultadoConsultaDia,
} from "../motor/resolver.js";

export interface MunicipioResumo {
  codigoIbge: number;
  nome: string;
  uf: string;
}

export interface DataYmd {
  ano: number;
  mes: number;
  dia: number;
}

/**
 * Busca municípios por nome (autocomplete). Prioriza nomes que começam com o
 * termo. Tenta primeiro um LIKE direto no SQLite (rápido, cobre o caso comum
 * de quem já digita com acento, como o autocomplete sugere); se não achar
 * nada, cai para um filtro em memória ignorando acentos (ex.: "Vitoria" ou
 * "Sao Paulo" sem acento) — a tabela de municípios é pequena (~5.570 linhas),
 * então percorrer tudo em JS é barato e evita duplicar índice/coluna
 * normalizada só para isso.
 */
export function buscarMunicipios(termoBusca: string, limite = 10): MunicipioResumo[] {
  const termo = termoBusca.trim();
  if (termo.length < 2) return [];

  const contains = `%${termo}%`;
  const comecaCom = `${termo}%`;
  const resultadoDireto = db
    .select({ codigoIbge: municipios.codigoIbge, nome: municipios.nome, uf: municipios.uf })
    .from(municipios)
    .where(sql`${municipios.nome} LIKE ${contains} COLLATE NOCASE`)
    .orderBy(sql`CASE WHEN ${municipios.nome} LIKE ${comecaCom} COLLATE NOCASE THEN 0 ELSE 1 END`, municipios.nome)
    .limit(limite)
    .all();
  if (resultadoDireto.length > 0) return resultadoDireto;

  const termoNormalizado = normalizarNomeMunicipio(termo);
  const todos = db.select({ codigoIbge: municipios.codigoIbge, nome: municipios.nome, uf: municipios.uf }).from(municipios).all();
  return todos
    .filter((m) => normalizarNomeMunicipio(m.nome).includes(termoNormalizado))
    .sort((a, b) => {
      const aComeca = normalizarNomeMunicipio(a.nome).startsWith(termoNormalizado) ? 0 : 1;
      const bComeca = normalizarNomeMunicipio(b.nome).startsWith(termoNormalizado) ? 0 : 1;
      if (aComeca !== bComeca) return aComeca - bComeca;
      return a.nome.localeCompare(b.nome, "pt-BR");
    })
    .slice(0, limite);
}

export function buscarMunicipioPorCodigo(codigoIbge: number): MunicipioResumo | undefined {
  return db
    .select({ codigoIbge: municipios.codigoIbge, nome: municipios.nome, uf: municipios.uf })
    .from(municipios)
    .where(eq(municipios.codigoIbge, codigoIbge))
    .get();
}

function normalizarNomeMunicipio(valor: string): string {
  return valor
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // remove acentos — "Abaíra" e "Abaira" comparam iguais
}

/**
 * Busca por nome + UF — usada na operação em lote (Fase 4), onde a planilha
 * traz o nome do município como texto solto, não um código IBGE. Tenta
 * primeiro um match exato (case-insensitive) e, se não achar, um match
 * ignorando acentos (ainda EXATO depois de normalizar, nunca aproximado por
 * similaridade). Se mesmo assim não achar, quem chama deve reportar a linha
 * como "município não encontrado" — nunca adivinhar por aproximação.
 */
export function buscarMunicipioPorNomeEUf(nome: string, uf: string): MunicipioResumo | undefined {
  const nomeNormalizado = nome.trim();
  const ufNormalizada = uf.trim().toUpperCase();
  if (!nomeNormalizado || !ufNormalizada) return undefined;

  const exato = db
    .select({ codigoIbge: municipios.codigoIbge, nome: municipios.nome, uf: municipios.uf })
    .from(municipios)
    .where(and(sql`${municipios.nome} = ${nomeNormalizado} COLLATE NOCASE`, eq(municipios.uf, ufNormalizada)))
    .get();
  if (exato) return exato;

  const candidatosDaUf = db
    .select({ codigoIbge: municipios.codigoIbge, nome: municipios.nome, uf: municipios.uf })
    .from(municipios)
    .where(eq(municipios.uf, ufNormalizada))
    .all();
  const alvo = normalizarNomeMunicipio(nomeNormalizado);
  return candidatosDaUf.find((m) => normalizarNomeMunicipio(m.nome) === alvo);
}

function comoTipoCurado(chave: string, nomeFeriado: string): "estadual" | "municipal" | "ponto_facultativo" {
  if (chave === "estadual" || chave === "municipal" || chave === "ponto_facultativo") return chave;
  // Não deveria acontecer — feriados nacionais nunca são inseridos na tabela
  // `feriados` (são calculados em código). Se aparecer aqui, é bug de
  // cadastro (a tela administrativa da Fase 4 precisa impedir isso na
  // origem, já que o SQLite não garante o enum como CHECK constraint real).
  throw new Error(
    `Feriado curado "${nomeFeriado}" com tipo inesperado "${chave}" — feriados nacionais não devem estar na tabela "feriados".`,
  );
}

function buscarFeriadosCurados(uf: string, codigoIbge: number | null): FeriadoCuradoInput[] {
  const condicaoAbrangencia =
    codigoIbge == null
      ? eq(feriados.uf, uf) // sem município (ex.: consulta genérica) — só camada estadual
      : or(
          and(eq(feriados.abrangencia, "uf"), eq(feriados.uf, uf)),
          and(eq(feriados.abrangencia, "municipio"), eq(feriados.codigoIbge, codigoIbge)),
        );

  const linhas = db
    .select({
      nome: feriados.nome,
      tipoChave: tiposFeriado.chave,
      abrangencia: feriados.abrangencia,
      uf: feriados.uf,
      codigoIbge: feriados.codigoIbge,
      mes: feriados.mes,
      dia: feriados.dia,
      regraCalculo: feriados.regraCalculo,
      anoInicio: feriados.anoInicio,
      anoFim: feriados.anoFim,
      dataVerificacao: feriados.dataVerificacao,
      fonteDescricao: fontes.descricao,
      fonteUrl: fontes.url,
    })
    .from(feriados)
    .innerJoin(tiposFeriado, eq(feriados.tipoFeriadoId, tiposFeriado.id))
    .innerJoin(fontes, eq(feriados.fonteId, fontes.id))
    .where(and(eq(feriados.ativo, true), condicaoAbrangencia))
    .all();

  return linhas.map((l) => ({
    nome: l.nome,
    tipo: comoTipoCurado(l.tipoChave, l.nome),
    abrangencia: l.abrangencia as "uf" | "municipio",
    uf: l.uf,
    codigoIbge: l.codigoIbge,
    mes: l.mes,
    dia: l.dia,
    regraCalculo: l.regraCalculo,
    anoInicio: l.anoInicio,
    anoFim: l.anoFim,
    baseLegal: l.fonteDescricao,
    fonteUrl: l.fonteUrl,
    dataVerificacao: l.dataVerificacao,
  }));
}

export interface ConsultaComMunicipio {
  municipio: MunicipioResumo;
}

export function consultarDiaPorMunicipio(
  codigoIbge: number,
  data: DataYmd,
): (ResultadoConsultaDia & ConsultaComMunicipio) | null {
  const municipio = buscarMunicipioPorCodigo(codigoIbge);
  if (!municipio) return null;
  const curados = buscarFeriadosCurados(municipio.uf, codigoIbge);
  const resultado = motorConsultarDia({ ...data, uf: municipio.uf, codigoIbge, feriadosCurados: curados });
  return { ...resultado, municipio };
}

export function consultarPeriodoPorMunicipio(
  codigoIbge: number,
  dataInicio: DataYmd,
  dataFim: DataYmd,
): { municipio: MunicipioResumo; dias: ResultadoConsultaDia[] } | null {
  const municipio = buscarMunicipioPorCodigo(codigoIbge);
  if (!municipio) return null;
  const curados = buscarFeriadosCurados(municipio.uf, codigoIbge);
  const dias = motorConsultarPeriodo({ dataInicio, dataFim, uf: municipio.uf, codigoIbge, feriadosCurados: curados });
  return { municipio, dias };
}

function ultimoDiaDoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/** Todos os dias de um mês (para o calendário mensal da Fase 3). */
export function consultarMesPorMunicipio(
  codigoIbge: number,
  ano: number,
  mes: number,
): { municipio: MunicipioResumo; dias: ResultadoConsultaDia[] } | null {
  return consultarPeriodoPorMunicipio(
    codigoIbge,
    { ano, mes, dia: 1 },
    { ano, mes, dia: ultimoDiaDoMes(ano, mes) },
  );
}

// ---------------------------------------------------------------------------
// Tela administrativa (Fase 4): CRUD de feriados curados + fila de candidatos
// ---------------------------------------------------------------------------

export type TipoFonte = "lei" | "decreto" | "diario_oficial" | "api_publica" | "outro";

export interface FeriadoCuradoResumo {
  id: number;
  nome: string;
  tipo: "estadual" | "municipal" | "ponto_facultativo";
  abrangencia: "uf" | "municipio";
  uf: string;
  codigoIbge: number | null;
  municipioNome: string | null;
  mes: number | null;
  dia: number | null;
  regraCalculo: string | null;
  anoInicio: number | null;
  anoFim: number | null;
  fonteDescricao: string;
  fonteUrl: string | null;
  fonteTipo: TipoFonte;
  fonteDataPublicacao: string | null;
  autor: string;
  dataVerificacao: string;
  observacao: string | null;
  ativo: boolean;
}

export function listarFeriadosCurados(): FeriadoCuradoResumo[] {
  return db
    .select({
      id: feriados.id,
      nome: feriados.nome,
      tipo: tiposFeriado.chave,
      abrangencia: feriados.abrangencia,
      uf: feriados.uf,
      codigoIbge: feriados.codigoIbge,
      municipioNome: municipios.nome,
      mes: feriados.mes,
      dia: feriados.dia,
      regraCalculo: feriados.regraCalculo,
      anoInicio: feriados.anoInicio,
      anoFim: feriados.anoFim,
      fonteDescricao: fontes.descricao,
      fonteUrl: fontes.url,
      fonteTipo: fontes.tipo,
      fonteDataPublicacao: fontes.dataPublicacao,
      autor: feriados.autor,
      dataVerificacao: feriados.dataVerificacao,
      observacao: feriados.observacao,
      ativo: feriados.ativo,
    })
    .from(feriados)
    .innerJoin(tiposFeriado, eq(feriados.tipoFeriadoId, tiposFeriado.id))
    .innerJoin(fontes, eq(feriados.fonteId, fontes.id))
    .leftJoin(municipios, eq(feriados.codigoIbge, municipios.codigoIbge))
    .orderBy(feriados.uf, feriados.nome)
    .all()
    .map((l) => ({ ...l, tipo: comoTipoCurado(l.tipo, l.nome) }));
}

export interface DadosFeriadoCurado {
  nome: string;
  tipoChave: "estadual" | "municipal" | "ponto_facultativo";
  abrangencia: "uf" | "municipio";
  uf: string;
  codigoIbge: number | null;
  mes: number | null;
  dia: number | null;
  regraCalculo: string | null;
  anoInicio: number | null;
  anoFim: number | null;
  autor: string;
  dataVerificacao: string;
  observacao: string | null;
  fonte: {
    descricao: string;
    url: string | null;
    tipo: TipoFonte;
    dataPublicacao: string | null;
  };
}

function idDoTipoFeriado(chave: "estadual" | "municipal" | "ponto_facultativo"): number {
  const tipo = db.select().from(tiposFeriado).where(eq(tiposFeriado.chave, chave)).get();
  if (!tipo) throw new Error(`Tipo de feriado "${chave}" não encontrado.`);
  return tipo.id;
}

/**
 * Cria um novo feriado curado. Sempre grava uma fonte nova (mesmo que o
 * texto repita uma já existente) — isso preserva, na prática, um rastro de
 * "o que foi citado em cada edição", já que `feriados` guarda só a fonte
 * atual mas fontes antigas continuam no banco, nunca apagadas.
 */
export function criarFeriadoCurado(dados: DadosFeriadoCurado): number {
  const tipoFeriadoId = idDoTipoFeriado(dados.tipoChave);
  const fonte = db
    .insert(fontes)
    .values({
      descricao: dados.fonte.descricao,
      url: dados.fonte.url,
      tipo: dados.fonte.tipo,
      dataPublicacao: dados.fonte.dataPublicacao,
    })
    .returning()
    .get();

  const novo = db
    .insert(feriados)
    .values({
      tipoFeriadoId,
      nome: dados.nome,
      abrangencia: dados.abrangencia,
      uf: dados.uf,
      codigoIbge: dados.codigoIbge,
      mes: dados.mes,
      dia: dados.dia,
      regraCalculo: dados.regraCalculo,
      anoInicio: dados.anoInicio,
      anoFim: dados.anoFim,
      fonteId: fonte.id,
      autor: dados.autor,
      dataVerificacao: dados.dataVerificacao,
      observacao: dados.observacao,
      ativo: true,
    })
    .returning({ id: feriados.id })
    .get();

  return novo.id;
}

export function atualizarFeriadoCurado(id: number, dados: DadosFeriadoCurado): void {
  const tipoFeriadoId = idDoTipoFeriado(dados.tipoChave);
  const fonte = db
    .insert(fontes)
    .values({
      descricao: dados.fonte.descricao,
      url: dados.fonte.url,
      tipo: dados.fonte.tipo,
      dataPublicacao: dados.fonte.dataPublicacao,
    })
    .returning()
    .get();

  db.update(feriados)
    .set({
      tipoFeriadoId,
      nome: dados.nome,
      abrangencia: dados.abrangencia,
      uf: dados.uf,
      codigoIbge: dados.codigoIbge,
      mes: dados.mes,
      dia: dados.dia,
      regraCalculo: dados.regraCalculo,
      anoInicio: dados.anoInicio,
      anoFim: dados.anoFim,
      fonteId: fonte.id,
      autor: dados.autor,
      dataVerificacao: dados.dataVerificacao,
      observacao: dados.observacao,
    })
    .where(eq(feriados.id, id))
    .run();
}

export function definirAtivoFeriadoCurado(id: number, ativo: boolean): void {
  db.update(feriados).set({ ativo }).where(eq(feriados.id, id)).run();
}

export function buscarFeriadoCuradoPorId(id: number): FeriadoCuradoResumo | undefined {
  return listarFeriadosCurados().find((f) => f.id === id);
}

export interface CandidatoResumo {
  id: number;
  fonteDataset: string;
  tipoSugerido: "estadual" | "municipal" | "ponto_facultativo";
  nome: string;
  descricaoOriginal: string | null;
  uf: string;
  codigoIbge: number | null;
  municipioNome: string | null;
  data: string;
  status: "pendente" | "promovido" | "rejeitado";
  importadoEm: string;
}

export function listarCandidatos(
  filtro: { uf?: string; status?: "pendente" | "promovido" | "rejeitado" } = {},
  limite = 50,
  offset = 0,
): CandidatoResumo[] {
  const condicoes = [];
  if (filtro.uf) condicoes.push(eq(candidatosNaoVerificados.uf, filtro.uf));
  condicoes.push(eq(candidatosNaoVerificados.status, filtro.status ?? "pendente"));

  return db
    .select({
      id: candidatosNaoVerificados.id,
      fonteDataset: candidatosNaoVerificados.fonteDataset,
      tipoSugerido: candidatosNaoVerificados.tipoSugerido,
      nome: candidatosNaoVerificados.nome,
      descricaoOriginal: candidatosNaoVerificados.descricaoOriginal,
      uf: candidatosNaoVerificados.uf,
      codigoIbge: candidatosNaoVerificados.codigoIbge,
      municipioNome: municipios.nome,
      data: candidatosNaoVerificados.data,
      status: candidatosNaoVerificados.status,
      importadoEm: candidatosNaoVerificados.importadoEm,
    })
    .from(candidatosNaoVerificados)
    .leftJoin(municipios, eq(candidatosNaoVerificados.codigoIbge, municipios.codigoIbge))
    .where(and(...condicoes))
    .orderBy(candidatosNaoVerificados.uf, candidatosNaoVerificados.nome)
    .limit(limite)
    .offset(offset)
    .all();
}

export function contarCandidatos(filtro: { uf?: string; status?: "pendente" | "promovido" | "rejeitado" } = {}): number {
  const condicoes = [];
  if (filtro.uf) condicoes.push(eq(candidatosNaoVerificados.uf, filtro.uf));
  condicoes.push(eq(candidatosNaoVerificados.status, filtro.status ?? "pendente"));
  const linha = db
    .select({ total: sql<number>`count(*)` })
    .from(candidatosNaoVerificados)
    .where(and(...condicoes))
    .get();
  return linha?.total ?? 0;
}

export function buscarCandidatoPorId(id: number): CandidatoResumo | undefined {
  return db
    .select({
      id: candidatosNaoVerificados.id,
      fonteDataset: candidatosNaoVerificados.fonteDataset,
      tipoSugerido: candidatosNaoVerificados.tipoSugerido,
      nome: candidatosNaoVerificados.nome,
      descricaoOriginal: candidatosNaoVerificados.descricaoOriginal,
      uf: candidatosNaoVerificados.uf,
      codigoIbge: candidatosNaoVerificados.codigoIbge,
      municipioNome: municipios.nome,
      data: candidatosNaoVerificados.data,
      status: candidatosNaoVerificados.status,
      importadoEm: candidatosNaoVerificados.importadoEm,
    })
    .from(candidatosNaoVerificados)
    .leftJoin(municipios, eq(candidatosNaoVerificados.codigoIbge, municipios.codigoIbge))
    .where(eq(candidatosNaoVerificados.id, id))
    .get();
}

export function marcarStatusCandidato(id: number, status: "promovido" | "rejeitado"): void {
  db.update(candidatosNaoVerificados).set({ status }).where(eq(candidatosNaoVerificados.id, id)).run();
}

/** Todas as UFs distintas presentes na fila de candidatos (para o filtro da tela administrativa). */
export function listarUfsComCandidatos(): string[] {
  return db
    .selectDistinct({ uf: candidatosNaoVerificados.uf })
    .from(candidatosNaoVerificados)
    .orderBy(candidatosNaoVerificados.uf)
    .all()
    .map((r) => r.uf);
}
