/**
 * Seed de feriados ESTADUAIS/MUNICIPAIS curados manualmente, com fonte
 * primária verificada — ao contrário de seed-candidatos.ts (que só importa
 * pistas não confirmadas), estas linhas entram direto em `feriados` porque
 * a fonte foi checada. Idempotente (upsert por nome+abrangencia+uf+codigoIbge).
 *
 * Cada novo feriado real deve vir com fonte PRIMÁRIA (não um blog agregador)
 * — ver a regra inegociável em CLAUDE.md.
 */
import { db, sqlite } from "../db/client.js";
import { feriados, fontes, tiposFeriado } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

const HOJE = new Date().toISOString().slice(0, 10);

interface FeriadoParaCurar {
  nome: string;
  tipoChave: "estadual" | "municipal" | "ponto_facultativo";
  abrangencia: "uf" | "municipio";
  uf: string;
  codigoIbge: number | null;
  mes: number | null;
  dia: number | null;
  regraCalculo: string | null;
  fonte: {
    descricao: string;
    url: string | null;
    tipo: "lei" | "decreto" | "diario_oficial" | "api_publica" | "outro";
    dataPublicacao: string | null;
  };
  autor: string;
}

const FERIADOS: FeriadoParaCurar[] = [
  {
    nome: "Independência da Bahia",
    tipoChave: "estadual",
    abrangencia: "uf",
    uf: "BA",
    codigoIbge: null,
    mes: 7,
    dia: 2,
    regraCalculo: null,
    fonte: {
      descricao:
        "Lei Estadual (Bahia) nº 38, de 03/01/1936 — citada no Calendário de Feriados oficial do Governo do Estado da Bahia (Casa Civil) junto com a Lei Federal 9.093/1995 (enquadramento geral de feriados civis/religiosos).",
      url: "https://www.legislabahia.ba.gov.br/sites/default/files/2025-02/feriados2025.pdf",
      tipo: "lei",
      dataPublicacao: "1936-01-03",
    },
    autor: "seed inicial — verificado em fonte primária oficial (Governo do Estado da Bahia), ver docs/fontes-de-dados.md",
  },
];

function main() {
  const tipos = db.select().from(tiposFeriado).all();
  const tipoPorChave = new Map(tipos.map((t) => [t.chave, t.id]));

  for (const f of FERIADOS) {
    const tipoFeriadoId = tipoPorChave.get(f.tipoChave);
    if (!tipoFeriadoId) {
      throw new Error(`Tipo de feriado "${f.tipoChave}" não encontrado — rode seed:tipos-feriado antes.`);
    }

    let fonte = db.select().from(fontes).where(eq(fontes.descricao, f.fonte.descricao)).get();
    if (!fonte) {
      const inserted = db
        .insert(fontes)
        .values({
          descricao: f.fonte.descricao,
          url: f.fonte.url,
          tipo: f.fonte.tipo,
          dataPublicacao: f.fonte.dataPublicacao,
        })
        .returning()
        .get();
      fonte = inserted;
      console.log(`  fonte criada: "${f.fonte.descricao.slice(0, 60)}..."`);
    }

    const existente = db
      .select()
      .from(feriados)
      .where(
        and(
          eq(feriados.nome, f.nome),
          eq(feriados.abrangencia, f.abrangencia),
          eq(feriados.uf, f.uf),
        ),
      )
      .get();

    const valores = {
      tipoFeriadoId,
      nome: f.nome,
      abrangencia: f.abrangencia,
      uf: f.uf,
      codigoIbge: f.codigoIbge,
      mes: f.mes,
      dia: f.dia,
      regraCalculo: f.regraCalculo,
      anoInicio: null,
      anoFim: null,
      fonteId: fonte.id,
      autor: f.autor,
      dataVerificacao: HOJE,
      observacao: null,
      ativo: true as const,
    };

    if (existente) {
      db.update(feriados).set(valores).where(eq(feriados.id, existente.id)).run();
      console.log(`✔ atualizado: ${f.nome} (${f.abrangencia}/${f.uf})`);
    } else {
      db.insert(feriados).values(valores).run();
      console.log(`✔ inserido: ${f.nome} (${f.abrangencia}/${f.uf})`);
    }
  }
}

main();
sqlite.close();
