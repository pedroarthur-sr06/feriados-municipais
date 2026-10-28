/**
 * Popula a tabela de municípios a partir do snapshot versionado em
 * `db/seed-data/municipios-ibge.json`, capturado da API de Localidades do
 * IBGE (fonte oficial — ver docs/fontes-de-dados.md seção 1).
 *
 *   npm run seed:municipios              # usa o snapshot do repositório
 *   npm run seed:municipios -- --atualizar   # busca no IBGE e regrava o snapshot
 *
 * Por que snapshot e não sempre a API: a lista de municípios muda de década
 * em década, mas o seed roda em toda publicação do site. Depender da API
 * nesse momento significaria uma build que falha quando o IBGE sai do ar, e
 * um resultado que não é reproduzível a partir do que está no repositório.
 * O mesmo padrão já valia para o dataset comunitário de candidatos.
 *
 * Re-rodar a qualquer momento é seguro (upsert por codigo_ibge).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { db, sqlite } from "../db/client.js";
import { municipios } from "../db/schema.js";
import { sql } from "drizzle-orm";

const IBGE_URL = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios";
const SNAPSHOT = "db/seed-data/municipios-ibge.json";
const MINIMO = 5570;

interface MunicipioLinha {
  codigoIbge: number;
  nome: string;
  uf: string;
  regiao: string;
  mesorregiao: string | null;
  microrregiao: string | null;
}

interface MunicipioIbge {
  id: number;
  nome: string;
  microrregiao?: { nome: string; mesorregiao?: { nome: string; UF: UfIbge } };
  "regiao-imediata"?: { "regiao-intermediaria"?: { UF: UfIbge } };
}
interface UfIbge {
  sigla: string;
  regiao: { nome: string };
}

/** A API do IBGE expõe a UF por dois caminhos; alguns municípios só têm o segundo. */
function linhaDoIbge(m: MunicipioIbge): MunicipioLinha {
  const uf = m.microrregiao?.mesorregiao?.UF ?? m["regiao-imediata"]?.["regiao-intermediaria"]?.UF;
  if (!uf) throw new Error(`Município ${m.id} (${m.nome}) sem UF na resposta do IBGE.`);
  return {
    codigoIbge: m.id,
    nome: m.nome,
    uf: uf.sigla,
    regiao: uf.regiao.nome,
    mesorregiao: m.microrregiao?.mesorregiao?.nome ?? null,
    microrregiao: m.microrregiao?.nome ?? null,
  };
}

async function buscarNoIbgeEGravarSnapshot(): Promise<MunicipioLinha[]> {
  console.log(`Buscando municípios em ${IBGE_URL} ...`);
  const res = await fetch(IBGE_URL);
  if (!res.ok) throw new Error(`IBGE respondeu ${res.status} ${res.statusText}`);
  const data = (await res.json()) as MunicipioIbge[];
  console.log(`Recebidos ${data.length} municípios do IBGE.`);
  if (data.length < MINIMO) {
    throw new Error(
      `Esperado ${MINIMO}+ municípios, recebido apenas ${data.length}. Abortando para não gravar base incompleta.`,
    );
  }
  const linhas = data.map(linhaDoIbge);
  writeFileSync(
    SNAPSHOT,
    JSON.stringify(
      { fonte: IBGE_URL, capturadoEm: new Date().toISOString().slice(0, 10), total: linhas.length, municipios: linhas },
      null,
      0,
    ) + "\n",
  );
  console.log(`Snapshot regravado em ${SNAPSHOT}. Lembre de commitá-lo.`);
  return linhas;
}

function lerSnapshot(): MunicipioLinha[] {
  let bruto: string;
  try {
    bruto = readFileSync(SNAPSHOT, "utf8");
  } catch {
    throw new Error(
      `${SNAPSHOT} não encontrado. Rode "npm run seed:municipios -- --atualizar" para capturá-lo do IBGE.`,
    );
  }
  const dados = JSON.parse(bruto) as { capturadoEm?: string; municipios: MunicipioLinha[] };
  console.log(`Lendo ${SNAPSHOT} (capturado em ${dados.capturadoEm ?? "data não registrada"}).`);
  return dados.municipios;
}

async function main() {
  const atualizar = process.argv.includes("--atualizar");
  const linhas = atualizar ? await buscarNoIbgeEGravarSnapshot() : lerSnapshot();

  if (linhas.length < MINIMO) {
    throw new Error(`Fonte trouxe apenas ${linhas.length} municípios — abaixo do esperado.`);
  }

  db.transaction((tx) => {
    for (const row of linhas) {
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

  const total = db.select({ total: sql<number>`count(*)` }).from(municipios).all()[0]?.total ?? 0;
  const salvador = db.select().from(municipios).where(sql`${municipios.nome} = 'Salvador'`).all();

  if (total < MINIMO) throw new Error(`Base local ficou com apenas ${total} municípios — abaixo do esperado.`);
  if (salvador.length !== 1 || salvador[0]?.codigoIbge !== 2927408) {
    throw new Error(`Registro de Salvador incorreto ou ausente: ${JSON.stringify(salvador)}`);
  }
  console.log(`✔ ${total} municípios na base; Salvador com código IBGE 2927408.`);
}

main()
  .catch((err) => {
    console.error("Falha no seed de municípios:", err);
    process.exitCode = 1;
  })
  .finally(() => sqlite.close());
