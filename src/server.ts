/**
 * Ponto de entrada do servidor: Fastify servindo API/HTML (server-side
 * rendering com EJS + htmx/Alpine vendorizados) e estáticos (public/).
 */
import { fileURLToPath } from "node:url";
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

const app = Fastify({ logger: true });

await app.register(fastifyView, {
  engine: { ejs },
  root: path.join(RAIZ_PROJETO, "views"),
  viewExt: "ejs",
  // A frase do veredito e a descrição das camadas vêm de src/web/veredito.ts,
  // o mesmo módulo que o HTML offline embute — para as duas versões nunca
  // dizerem coisas diferentes sobre o mesmo dia.
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
await app.register(rotasAdmin);

const PORT = Number(process.env.PORT ?? 3000);

app.listen({ port: PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
