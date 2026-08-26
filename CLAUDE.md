# Feriados Municipais — contexto para sessões futuras

Aplicação interna de DP/RH para responder, em segundos: "no dia X, no
município Y/UF, houve feriado ou ponto facultativo?" — sempre citando a
fonte. Ver [docs/fontes-de-dados.md](docs/fontes-de-dados.md) para a pesquisa
completa de fontes de dados que fundamenta as decisões abaixo.

## Regra inegociável (vale para todo código e todo dado)

**Nunca inventar ou completar de memória datas de feriado municipal ou
estadual.** Todo registro em `feriados` tem `fonte_id` obrigatório (lei,
decreto, Diário Oficial). Sem fonte verificada, a consulta responde
`status_municipal: "nao_verificado"` — nunca assume dia útil por omissão.
Feriados nacionais são exceção: são calculados em código (lei + algoritmo de
Páscoa), não dependem de fonte cadastrada, porque a lei federal é fixa e
verificável no próprio texto do código.

## Stack

- **Runtime**: Node.js 20 ou 22 LTS / TypeScript (`"type": "module"`, ESM).
  Evitar Node 24+ por ora — `better-sqlite3` não publica binário
  pré-compilado para essa ABI ainda, e sem Python/build tools o
  `npm install` trava tentando compilar do zero (visto na prática nesta
  máquina). Ver [README.md](README.md) para detalhes.
- **Servidor**: [Fastify](https://fastify.dev/).
- **Banco**: SQLite (arquivo único em `data/holidays.db`) via
  `better-sqlite3` + [Drizzle ORM](https://orm.drizzle.team/) — schema em
  [src/db/schema.ts](src/db/schema.ts), migrations geradas em `drizzle/`.
- **Frontend**: renderização server-side (Fastify + @fastify/view + EJS) com
  htmx + Alpine.js vendorizados em `public/vendor/` (sem CDN, sem
  SPA/bundler) — um único processo Node serve tudo, views em `views/`.
- **Planilha/PDF (Fase 4)**: `exceljs`, `csv-parse`/`csv-stringify`,
  `pdfmake`.
- **Testes**: Vitest.

**Por quê essa stack**: o requisito não-funcional pede "simples de hospedar e
manter" em servidor próprio/VM (não cloud gerenciada) e "sem dependências
pesadas". SQLite elimina serviço de banco separado (backup = copiar
arquivo); Fastify + server-side rendering elimina build step de SPA; nenhuma
dependência exige binário externo (Chromium, etc.) além do próprio Node.

## Comandos

```bash
npm install          # instala dependências (better-sqlite3 compila binário nativo — pode levar minutos na 1ª vez)
npm run dev           # servidor em modo watch (tsx)
npm run build         # compila TypeScript para dist/
npm start             # roda a build compilada
npm test              # roda a suíte de testes (Vitest)
npm run test:watch    # Vitest em modo watch

npm run db:generate   # gera migration SQL a partir de src/db/schema.ts
npm run db:migrate    # aplica migrations em data/holidays.db

npm run seed          # roda todos os seeds, em ordem (tipos -> municípios -> feriados curados -> candidatos)
npm run seed:tipos-feriado    # seed dos 4 tipos fixos (nacional/estadual/municipal/facultativo)
npm run seed:municipios       # importa municípios da API do IBGE (~5.570 registros)
npm run seed:feriados-curados # feriados estaduais/municipais REAIS, com fonte primária verificada
npm run seed:candidatos       # importa dataset comunitário como leads não verificados
```

## Estrutura de pastas

```
src/
  db/
    schema.ts     # tabelas Drizzle: municipios, tipos_feriado, fontes, feriados, candidatos_nao_verificados
    client.ts     # conexão better-sqlite3 + drizzle
    migrate.ts    # aplica migrations
  scripts/
    seed*.ts       # scripts de seed (idempotentes, upsert)
  server.ts        # entrypoint Fastify (registra view engine, estáticos, rotas)
  motor/            # lógica pura: cálculo de feriados nacionais + resolução em camadas (sem acesso a banco)
    pascoa.ts         # algoritmo de Gauss/Meeus + aritmética de datas
    feriados-nacionais.ts  # feriados/pontos facultativos nacionais calculados por ano
    resolver.ts        # consultarDia / consultarPeriodo — camadas nacional+estadual+municipal
  services/
    feriados-service.ts  # busca no SQLite (municípios, feriados curados) e chama o motor
  routes/
    web.ts            # página inicial + endpoints htmx (autocomplete, consulta)
  web/
    calendario.ts      # helper de apresentação: monta a grade do calendário mensal
views/                  # templates EJS (views/partials/ para fragmentos htmx)
public/
  css/styles.css        # estilos (sem framework externo)
  vendor/                # htmx.min.js e alpine.min.js vendorizados (sem CDN)
db/
  seed-data/        # snapshots versionados de datasets externos usados no seed (ex.: candidatos comunitários)
drizzle/            # migrations SQL geradas (versionadas no git)
data/                # holidays.db (SQLite) — gitignored, gerado localmente
docs/
  fontes-de-dados.md # pesquisa de fontes (Fase 0)
tests/                # Vitest
```

## Modelo de dados (resumo — ver src/db/schema.ts para detalhes)

- **`municipios`**: snapshot da API do IBGE. PK = `codigo_ibge`. Não editar
  manualmente; re-rodar `npm run seed:municipios` para atualizar.
- **`tipos_feriado`**: 4 linhas fixas (`nacional`, `estadual`, `municipal`,
  `ponto_facultativo`). Feriado ≠ ponto facultativo: feriado é folga
  obrigatória por lei; ponto facultativo é decreto administrativo, só
  vincula servidor público da esfera que decretou — tratamento na folha de
  ponto é diferente.
- **`fontes`**: toda fonte legal/oficial citável (lei, decreto, Diário
  Oficial). Referenciada por `feriados.fonte_id`.
- **`feriados`**: feriados **estaduais e municipais** curados manualmente
  (nacional é calculado em código, não mora aqui). Suporta data fixa
  (`mes`/`dia`) ou regra relativa à Páscoa (`regra_calculo`, ex.
  `"pascoa+60"`). `abrangencia = 'uf'` aplica a todos os municípios daquela
  UF (ex.: 2 de julho na Bahia é estadual, não municipal, mas aparece na
  consulta de qualquer município baiano).
- **`candidatos_nao_verificados`**: leads importados de dataset comunitário,
  **nunca lidos pelo motor de consulta**, só fila de trabalho da tela
  administrativa (Fase 4) para promover a `feriados` após confirmar a fonte
  primária.

## Regras de negócio

1. Resolução em camadas: nacional (calculado) → estadual (curado) →
   municipal (curado). Camadas podem coexistir na mesma data — mostrar
   todas, nenhuma "vence" a outra.
2. Feriado vs. ponto facultativo têm tratamento diferente na folha de ponto
   — nunca tratar como sinônimos na UI ou nos dados. Importante: **Carnaval
   e Corpus Christi são `ponto_facultativo`, não `nacional`** — não são
   feriados fixados em lei federal, são decretados ano a ano por portaria do
   Executivo (mas a data em si é 100% previsível a partir da Páscoa, por
   isso são calculados). Sexta-feira Santa é tratada como `nacional` (feriado
   pleno), por ser excluída da lista de pontos facultativos do próprio
   governo federal. Ver o comentário extenso em
   [src/motor/feriados-nacionais.ts](src/motor/feriados-nacionais.ts) antes
   de mudar essa classificação — a maioria dos agregadores públicos
   (BrasilAPI, Nager.Date) erra isso classificando tudo como "nacional".
3. Município sem curadoria municipal feita → resposta inclui aviso explícito
   `nao_verificado`, nunca "dia útil" implícito.
4. Suporte a datas passadas (fechamentos retroativos) e ao ano seguinte —
   nada no motor pode assumir "ano corrente".
5. Toda entrada em `feriados` carrega `fonte_id`, `autor` e
   `data_verificacao` — auditoria de quem cadastrou/confirmou o quê.

## Fases do projeto (ver plano completo com o usuário)

Fase 0 (pesquisa de fontes), Fase 1 (fundação), Fase 2 (motor + testes) e
Fase 3 (interface web) concluídas. Fase 4 (lote CSV/XLSX, exportação, tela
administrativa) é a próxima — segue o mesmo padrão: uma fase por vez, com
aprovação do usuário ao final.
