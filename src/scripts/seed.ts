/**
 * Orquestrador do seed completo. Cada etapa roda em processo próprio
 * (npm run seed:*) para isolar falhas e manter a conexão sqlite curta;
 * aqui só encadeamos via spawn.
 */
import { spawnSync } from "node:child_process";

const ETAPAS = ["seed:tipos-feriado", "seed:municipios", "seed:feriados-curados", "seed:candidatos"];

for (const etapa of ETAPAS) {
  console.log(`\n=== npm run ${etapa} ===`);
  const resultado = spawnSync("npm", ["run", etapa], {
    stdio: "inherit",
    shell: true,
  });
  if (resultado.status !== 0) {
    console.error(`Etapa "${etapa}" falhou (exit ${resultado.status}). Abortando.`);
    process.exit(resultado.status ?? 1);
  }
}

console.log("\n✔ Seed completo.");
