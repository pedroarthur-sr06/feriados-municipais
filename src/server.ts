/**
 * Ponto de entrada do servidor. Ainda mínimo (Fase 1 = fundação); a
 * interface e as rotas de consulta chegam na Fase 3.
 */
import Fastify from "fastify";

const app = Fastify({ logger: true });

app.get("/health", async () => ({ status: "ok" }));

const PORT = Number(process.env.PORT ?? 3000);

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
