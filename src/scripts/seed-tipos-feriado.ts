/**
 * Seed fixo dos 4 tipos de feriado/não-dia-útil suportados. Idempotente.
 */
import { db, sqlite } from "../db/client.js";
import { tiposFeriado } from "../db/schema.js";

const TIPOS = [
  {
    chave: "nacional" as const,
    nome: "Feriado nacional",
    descricao:
      "Folga obrigatória em todo o território nacional (Lei 662/1949, Lei 6.802/1980, e feriados móveis derivados da Páscoa).",
  },
  {
    chave: "estadual" as const,
    nome: "Feriado estadual",
    descricao:
      "Folga obrigatória fixada por lei estadual (data cívica do Estado, Lei federal 9.093/1995 art. 1º, II).",
  },
  {
    chave: "municipal" as const,
    nome: "Feriado municipal",
    descricao:
      "Folga obrigatória fixada por lei municipal (aniversário/fundação do município ou feriado religioso local, Lei federal 9.093/1995).",
  },
  {
    chave: "ponto_facultativo" as const,
    nome: "Ponto facultativo",
    descricao:
      "Instituído por decreto administrativo, não por lei — obrigatório só para servidores públicos da esfera que decretou. Tratamento na folha de ponto é diferente de feriado.",
  },
];

function main() {
  for (const tipo of TIPOS) {
    db.insert(tiposFeriado)
      .values(tipo)
      .onConflictDoUpdate({
        target: tiposFeriado.chave,
        set: { nome: tipo.nome, descricao: tipo.descricao },
      })
      .run();
  }
  console.log(`✔ ${TIPOS.length} tipos de feriado seedados/atualizados.`);
}

main();
sqlite.close();
