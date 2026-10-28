/**
 * Garante que o banco existe e está populado antes do servidor subir.
 *
 * Roda em dois cenários:
 *
 * 1. **Cópia nova** (alguém clonou o repositório e deu dois cliques no
 *    atalho). Antes era preciso rodar migrate e seed na mão; agora a base se
 *    constrói sozinha na primeira subida.
 * 2. **Instância publicada**, onde o sistema de arquivos é efêmero e o banco
 *    pode não sobreviver a um reinício. Como os dados moram nos seeds
 *    versionados e nenhum deles depende de rede, reconstruir é determinístico
 *    e leva ~14s.
 *
 * Quando o banco já está íntegro, sai em alguns milissegundos — então pode
 * ficar na frente do `npm start` sem atrapalhar o uso normal.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sqlite } from "../db/client.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MINIMO_MUNICIPIOS = 5570;

/** Conta sem explodir quando a tabela ainda não existe. */
function contar(tabela: string): number {
  try {
    const linha = sqlite.prepare(`select count(*) as n from ${tabela}`).get() as { n: number } | undefined;
    return linha?.n ?? 0;
  } catch {
    return 0;
  }
}

const municipios = contar("municipios");
const feriados = contar("feriados");
sqlite.close();

if (municipios >= MINIMO_MUNICIPIOS && feriados > 0) {
  console.log(`Banco pronto: ${municipios} municípios, ${feriados} feriados.`);
  process.exit(0);
}

console.log(
  `Banco incompleto (${municipios} municípios, ${feriados} feriados). Construindo a partir dos seeds versionados...`,
);

// Cada etapa em processo próprio, como o orquestrador de seed já fazia: isola
// falha e mantém curta a conexão com o SQLite. Os caminhos saem da pasta
// deste arquivo, então funciona tanto compilado quanto via tsx.
const ETAPAS = [
  ["migrações", path.join(AQUI, "..", "db", "migrate.js")],
  ["tipos de feriado", path.join(AQUI, "seed-tipos-feriado.js")],
  ["municípios", path.join(AQUI, "seed-municipios.js")],
  ["feriados curados", path.join(AQUI, "seed-feriados-curados.js")],
];

for (const [nome, script] of ETAPAS) {
  console.log(`  ${nome}...`);
  const r = spawnSync(process.execPath, [script!], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`Falha ao preparar o banco na etapa "${nome}" (exit ${r.status}).`);
    process.exit(r.status ?? 1);
  }
}

console.log("Banco construído.");
