/**
 * Importa a lista completa de municípios do Brasil a partir da API de
 * Localidades do IBGE (fonte oficial, gratuita — ver docs/fontes-de-dados.md
 * seção 1). Roda como snapshot one-shot: não é uma dependência viva do
 * runtime da aplicação, só do processo de seed/atualização.
 *
 * Re-rodar este script a qualquer momento é seguro (upsert por codigo_ibge).
 */
import { db, sqlite } from "../db/client.js";
import { municipios } from "../db/schema.js";
import { sql } from "drizzle-orm";

const IBGE_URL = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios";

interface MunicipioIbge {
  id: number;
  nome: string;
  microrregiao?: {
    nome: string;
    mesorregiao?: {
      nome: string;
      UF: { sigla: string; regiao: { nome: string } };
    };
  };
  "regiao-imediata"?: {
    "regiao-intermediaria"?: {
      UF: { sigla: string; regiao: { nome: string } };
    };
  };
}

async function main() {
  console.log(`Buscando municípios em ${IBGE_URL} ...`);
  const res = await fetch(IBGE_URL);
  if (!res.ok) {
    throw new Error(`IBGE respondeu ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as MunicipioIbge[];
  console.log(`Recebidos ${data.length} municípios do IBGE.`);

  if (data.length < 5570) {
    throw new Error(
      `Esperado 5.570+ municípios, recebido apenas ${data.length}. Abortando seed para não gravar base incompleta.`,
    );
  }

  const rows = data.map((m) => {
    // A API do IBGE expõe a UF por dois caminhos possíveis. A maioria dos
    // municípios tem microrregiao.mesorregiao.UF preenchido, mas alguns
    // (ex.: 5101837 - Boa Esperança do Norte/MT) vêm com microrregiao=null
    // e só têm UF disponível via regiao-imediata.regiao-intermediaria.UF.
    const uf =
      m.microrregiao?.mesorregiao?.UF ??
      m["regiao-imediata"]?.["regiao-intermediaria"]?.UF;
    if (!uf) {
      throw new Error(`Município ${m.id} (${m.nome}) sem UF na resposta do IBGE.`);
    }
    return {
      codigoIbge: m.id,
      nome: m.nome,
      uf: uf.sigla,
      regiao: uf.regiao.nome,
      mesorregiao: m.microrregiao?.mesorregiao?.nome ?? null,
      microrregiao: m.microrregiao?.nome ?? null,
    };
  });

  db.transaction((tx) => {
    for (const row of rows) {
      tx.insert(municipios)
        .values(row)
        .onConflictDoUpdate({
          target: municipios.codigoIbge,
          set: {
            nome: row.nome,
            uf: row.uf,
            regiao: row.regiao,
            mesorregiao: row.mesorregiao,
            microrregiao: row.microrregiao,
          },
        })
        .run();
    }
  });

  const contagem = db.select({ total: sql<number>`count(*)` }).from(municipios).all();
  const total = contagem[0]?.total ?? 0;
  console.log(`Total de municípios na base local: ${total}`);

  const salvador = db
    .select()
    .from(municipios)
    .where(sql`${municipios.nome} = 'Salvador'`)
    .all();
  console.log("Busca por 'Salvador':", salvador);

  if (total < 5570) {
    throw new Error(`Base local ficou com apenas ${total} municípios — abaixo do esperado.`);
  }
  if (salvador.length !== 1 || salvador[0]?.codigoIbge !== 2927408) {
    throw new Error(
      `Registro de Salvador incorreto ou ausente: ${JSON.stringify(salvador)}`,
    );
  }
  console.log("✔ Verificação OK: 5.570+ municípios e Salvador com código IBGE 2927408.");
}

main()
  .catch((err) => {
    console.error("Falha no seed de municípios:", err);
    process.exitCode = 1;
  })
  .finally(() => sqlite.close());
