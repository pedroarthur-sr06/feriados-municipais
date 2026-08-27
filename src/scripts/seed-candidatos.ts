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
import { sql, eq, and, ne } from "drizzle-orm";

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

  const lotes = arquivos.map(({ caminho, tipo }) => ({
    caminho,
    tipo,
    registros: carregar(caminho),
  }));

  // Preserva decisões já tomadas (promovido/rejeitado) através de re-execuções —
  // sem isso, todo trabalho de revisão da fila seria perdido a cada `npm run seed`.
  // Chave composta (não há ID estável na fonte externa): tipo+nome+uf+codigoIbge+data.
  // LIMITAÇÃO CONHECIDA: quando a fonte tem duas linhas literalmente idênticas
  // (mesmo tipo/nome/uf/codigoIbge/data — já visto no dataset, ex.: Carnaval de
  // Rolim de Moura duplicado), elas colidem na mesma chave e só um status
  // sobrevive para as duas após a reimportação. Confira manualmente se um
  // candidato duplicado sumir do status esperado.
  function chave(r: { tipoSugerido: string; nome: string; uf: string; codigoIbge: number | null; data: string }) {
    return `${r.tipoSugerido}|${r.nome}|${r.uf}|${r.codigoIbge ?? "null"}|${r.data}`;
  }
  const statusPreservados = new Map(
    db
      .select({
        tipoSugerido: candidatosNaoVerificados.tipoSugerido,
        nome: candidatosNaoVerificados.nome,
        uf: candidatosNaoVerificados.uf,
        codigoIbge: candidatosNaoVerificados.codigoIbge,
        data: candidatosNaoVerificados.data,
        status: candidatosNaoVerificados.status,
      })
      .from(candidatosNaoVerificados)
      .where(and(eq(candidatosNaoVerificados.fonteDataset, DATASET_ID), ne(candidatosNaoVerificados.status, "pendente")))
      .all()
      .map((r) => [chave(r), r.status] as const),
  );

  db.transaction((tx) => {
    // Evita duplicar em re-execuções: limpa import anterior deste dataset antes de recarregar.
    tx.delete(candidatosNaoVerificados)
      .where(eq(candidatosNaoVerificados.fonteDataset, DATASET_ID))
      .run();

    for (const { registros, tipo } of lotes) {
      for (const r of registros) {
        const codigoIbge = r.codigo_ibge && codigosValidos.has(r.codigo_ibge) ? r.codigo_ibge : null;
        if (r.codigo_ibge && !codigoIbge) {
          totalIgnoradosCodigoInvalido++;
        }
        const data = paraIso(r.data);
        const statusRestaurado = statusPreservados.get(chave({ tipoSugerido: tipo, nome: r.nome, uf: r.uf, codigoIbge, data }));
        tx.insert(candidatosNaoVerificados)
          .values({
            fonteDataset: DATASET_ID,
            tipoSugerido: tipo,
            nome: r.nome,
            descricaoOriginal: r.descricao || null,
            uf: r.uf,
            codigoIbge,
            municipioNomeOriginal: null,
            data,
            status: statusRestaurado ?? "pendente",
            importadoEm: agora,
          })
          .run();
        totalInseridos++;
      }
    }
  });

  if (statusPreservados.size > 0) {
    console.log(`  ${statusPreservados.size} decisões já tomadas (promovido/rejeitado) preservadas nesta reimportação.`);
  }

  for (const { caminho, tipo, registros } of lotes) {
    console.log(`  ${caminho}: ${registros.length} registros processados (tipo=${tipo}).`);
  }

  const contagem = db.select({ total: sql<number>`count(*)` }).from(candidatosNaoVerificados).all();
  const total = contagem[0]?.total ?? 0;

  console.log(`✔ ${totalInseridos} candidatos inseridos (${total} na tabela ao todo).`);
  if (totalIgnoradosCodigoInvalido > 0) {
    console.log(
      `  Aviso: ${totalIgnoradosCodigoInvalido} registros vieram com codigo_ibge que não existe na base local de municípios — gravados com codigoIbge=null (ainda com uf/nome para conferência manual).`,
    );
  }
}

main();
sqlite.close();
