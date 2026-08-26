/**
 * Importa os datasets comunitários de dados/seed-data/*.json (snapshot do
 * repositório joaopbini/feriados-brasil, licença MIT, ano de referência
 * 2026) para a tabela `candidatos_nao_verificados`.
 *
 * IMPORTANTE: isso não cadastra feriados de verdade. O README da fonte não
 * cita base legal por registro individual (só a categoria "estadual" traz
 * às vezes uma citação de lei no campo `descricao`, ainda a confirmar na
 * fonte primária). Estes registros nunca são lidos pelo motor de consulta —
 * servem só de lista de trabalho para a tela administrativa (Fase 4)
 * promover, um a um, depois de confirmar a fonte primária.
 *
 * Ver docs/fontes-de-dados.md, seção 4, "Opção intermediária".
 */
import { readFileSync } from "node:fs";
import { db, sqlite } from "../db/client.js";
import { candidatosNaoVerificados, municipios } from "../db/schema.js";
import { sql, eq } from "drizzle-orm";

interface RegistroFonte {
  data: string; // DD/MM/AAAA
  nome: string;
  tipo: "ESTADUAL" | "MUNICIPAL" | "NACIONAL" | "FACULTATIVO";
  descricao: string;
  uf: string;
  codigo_ibge: number | null;
}

const DATASET_ID = "joaopbini/feriados-brasil@2026";

function paraIso(dataBr: string): string {
  const [dia, mes, ano] = dataBr.split("/");
  return `${ano}-${mes}-${dia}`;
}

function carregar(caminho: string): RegistroFonte[] {
  const bruto = readFileSync(caminho, "utf-8");
  return JSON.parse(bruto) as RegistroFonte[];
}

function main() {
  const arquivos: { caminho: string; tipo: "estadual" | "municipal" }[] = [
    { caminho: "db/seed-data/candidatos-estadual-2026.json", tipo: "estadual" },
    { caminho: "db/seed-data/candidatos-municipal-2026.json", tipo: "municipal" },
  ];

  const codigosValidos = new Set(
    db.select({ codigoIbge: municipios.codigoIbge }).from(municipios).all().map((m) => m.codigoIbge),
  );
  if (codigosValidos.size === 0) {
    throw new Error("Tabela municipios vazia — rode o seed de municípios antes deste.");
  }

  const agora = new Date().toISOString();
  let totalInseridos = 0;
  let totalIgnoradosCodigoInvalido = 0;

  const inserirLote = db.transaction((registros: RegistroFonte[], tipo: "estadual" | "municipal") => {
    for (const r of registros) {
      const codigoIbge = r.codigo_ibge && codigosValidos.has(r.codigo_ibge) ? r.codigo_ibge : null;
      if (r.codigo_ibge && !codigoIbge) {
        totalIgnoradosCodigoInvalido++;
      }
      db.insert(candidatosNaoVerificados)
        .values({
          fonteDataset: DATASET_ID,
          tipoSugerido: tipo,
          nome: r.nome,
          descricaoOriginal: r.descricao || null,
          uf: r.uf,
          codigoIbge,
          municipioNomeOriginal: null,
          data: paraIso(r.data),
          status: "pendente",
          importadoEm: agora,
        })
        .run();
      totalInseridos++;
    }
  });

  // Evita duplicar em re-execuções: limpa import anterior deste dataset antes de recarregar.
  db.delete(candidatosNaoVerificados)
    .where(eq(candidatosNaoVerificados.fonteDataset, DATASET_ID))
    .run();

  for (const { caminho, tipo } of arquivos) {
    const registros = carregar(caminho);
    inserirLote(registros, tipo);
    console.log(`  ${caminho}: ${registros.length} registros processados (tipo=${tipo}).`);
  }

  const [{ total }] = db
    .select({ total: sql<number>`count(*)` })
    .from(candidatosNaoVerificados)
    .all() as { total: number }[];

  console.log(`✔ ${totalInseridos} candidatos inseridos (${total} na tabela ao todo).`);
  if (totalIgnoradosCodigoInvalido > 0) {
    console.log(
      `  Aviso: ${totalIgnoradosCodigoInvalido} registros vieram com codigo_ibge que não existe na base local de municípios — gravados com codigoIbge=null (ainda com uf/nome para conferência manual).`,
    );
  }
}

main();
sqlite.close();
