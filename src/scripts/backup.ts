/**
 * Backup do banco, seguro com o servidor no ar.
 *
 * O banco roda em `journal_mode = WAL` (ver src/db/client.ts): parte das
 * gravações recentes vive no arquivo `-wal`, não no `.db`. Copiar só o
 * `holidays.db` com o servidor rodando, portanto, produz um arquivo
 * silenciosamente desatualizado — ou corrompido, se a cópia pegar o
 * `.db` no meio de um checkpoint. "Backup = copiar o arquivo" só vale com
 * o serviço parado.
 *
 * `VACUUM INTO` resolve isso: o próprio SQLite escreve um banco novo,
 * consistente e já compactado, sem travar quem está consultando.
 *
 * Uso:
 *   node dist/scripts/backup.js [pasta-destino]
 *
 * Variáveis de ambiente:
 *   DATABASE_PATH   banco de origem (padrão: data/holidays.db)
 *   BACKUP_DIR      pasta de destino (padrão: backups/)
 *   BACKUP_MANTER   quantos backups manter (padrão: 30; 0 = não apagar nada)
 */
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { sqlite } from "../db/client.js";

const PREFIXO = "holidays-";
const SUFIXO = ".db";

/** Carimbo de data/hora ordenável alfabeticamente: 2026-10-22-1435. */
function carimbo(agora = new Date()): string {
  const d = (n: number) => String(n).padStart(2, "0");
  return (
    `${agora.getFullYear()}-${d(agora.getMonth() + 1)}-${d(agora.getDate())}` +
    `-${d(agora.getHours())}${d(agora.getMinutes())}`
  );
}

/**
 * Apaga os backups mais antigos além dos `manter` mais recentes. Ordena pelo
 * nome (o carimbo é ordenável) e não pela data do arquivo — a data muda se
 * alguém copiar a pasta, o nome não.
 */
function limparAntigos(pasta: string, manter: number): string[] {
  if (manter <= 0) return [];
  const arquivos = readdirSync(pasta)
    .filter((n) => n.startsWith(PREFIXO) && n.endsWith(SUFIXO))
    .sort()
    .reverse();
  const excedentes = arquivos.slice(manter);
  for (const nome of excedentes) unlinkSync(path.join(pasta, nome));
  return excedentes;
}

const pastaDestino = process.argv[2] ?? process.env.BACKUP_DIR ?? "backups";
const manter = Number(process.env.BACKUP_MANTER ?? 30);

mkdirSync(pastaDestino, { recursive: true });

const destino = path.resolve(pastaDestino, `${PREFIXO}${carimbo()}${SUFIXO}`);
if (existsSync(destino)) {
  console.error(`Já existe um backup deste minuto: ${destino}`);
  process.exit(1);
}

// VACUUM não aceita parâmetro ligado (`?`), então o caminho entra literal —
// com as aspas simples escapadas, do jeito que o SQLite espera.
sqlite.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);

const tamanhoMb = (statSync(destino).size / 1024 / 1024).toFixed(1);
console.log(`Backup gravado: ${destino} (${tamanhoMb} MB)`);

const apagados = limparAntigos(path.resolve(pastaDestino), manter);
if (apagados.length > 0) {
  console.log(`Backups antigos removidos (mantendo ${manter}): ${apagados.join(", ")}`);
}
