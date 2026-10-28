/**
 * Ponto de entrada do servidor: Fastify servindo API/HTML (server-side
 * rendering com EJS + htmx/Alpine vendorizados) e estáticos (public/).
 */
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import fastifyView from "@fastify/view";
import fastifyStatic from "@fastify/static";
import fastifyFormbody from "@fastify/formbody";
import fastifyMultipart from "@fastify/multipart";
import ejs from "ejs";
import rotasWeb from "./routes/web.js";
import rotasLote from "./routes/lote.js";
import rotasExportacao from "./routes/exportacao.js";
import rotasAdmin from "./routes/admin.js";
import { montarVeredito, porExtenso, DESCRICAO_CAMADA } from "./web/veredito.js";
import { apresentarCalendario, DIAS_CABECALHO, nomeMes } from "./web/calendario.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_PROJETO = path.resolve(__dirname, "..");

/**
 * Nivel de log por ambiente. Em "warn" o Fastify para de imprimir uma linha
 * JSON por requisicao e so fala quando algo da errado — e o que o atalho de
 * um clique usa, porque quem abre a ferramenta ve essa janela e log tecnico
 * rolando ali parece defeito. Erro continua aparecendo.
 */
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

await app.register(fastifyView, {
  engine: { ejs },
  root: path.join(RAIZ_PROJETO, "views"),
  viewExt: "ejs",
  // A frase do veredito, a descrição das camadas e as classes do calendário
  // vêm de src/web/ — decididas em TypeScript, com tipo, e não dentro do EJS.
  defaultContext: { montarVeredito, porExtenso, DESCRICAO_CAMADA, apresentarCalendario, DIAS_CABECALHO, nomeMes },
});

await app.register(fastifyStatic, {
  root: path.join(RAIZ_PROJETO, "public"),
  prefix: "/",
});

await app.register(fastifyFormbody);
await app.register(fastifyMultipart, {
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }, // 10 MB, 1 arquivo por envio (lote CSV/XLSX)
});

app.get("/health", async () => ({ status: "ok" }));

await app.register(rotasWeb);
await app.register(rotasLote);
await app.register(rotasExportacao);
/**
 * A tela administrativa escreve no banco e não tem login (decisão do projeto,
 * ver CLAUDE.md). Na instância publicada ela fica desligada por
 * ADMIN_HABILITADO=false, e aí não há o que proteger: quem abre o endereço só
 * consulta. A curadoria continua sendo feita na cópia local, onde o banco é o
 * de verdade, e chega ao site pelo seed versionado.
 */
const ADMIN_HABILITADO = process.env.ADMIN_HABILITADO !== "false";
if (ADMIN_HABILITADO) {
  await app.register(rotasAdmin);
}

const PORT = Number(process.env.PORT ?? 3000);

/**
 * Endereços IPv4 desta máquina na rede local — é o que se manda para outra
 * pessoa abrir. O log do Fastify já imprime isso, mas em JSON no meio de
 * outras linhas; quem sobe a ferramenta pelo atalho precisa de uma linha só,
 * legível, para copiar e colar.
 */
function enderecosDeRede(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((lista) => lista ?? [])
    .filter((i) => i.family === "IPv4" && !i.internal)
    .map((i) => `http://${i.address}:${PORT}`);
}

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => {
    const naRede = enderecosDeRede();
    console.log("");
    console.log("  Feriados Municipais está no ar.");
    if (!ADMIN_HABILITADO) console.log("  (modo consulta: a tela de administração está desligada)");
    console.log("");
    console.log(`  Neste computador:   http://localhost:${PORT}`);
    if (naRede.length > 0) {
      console.log(`  Para compartilhar:  ${naRede[0]}`);
      for (const extra of naRede.slice(1)) console.log(`                      ${extra}`);
      console.log("");
      console.log("  Quem estiver na mesma rede abre por esse endereço.");
    } else {
      console.log("");
      console.log("  Sem rede detectada — só dá para abrir neste computador.");
    }
    console.log("  Para encerrar, feche esta janela ou pressione Ctrl+C.");
    console.log("");
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
