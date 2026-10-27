# Feriados Municipais

Consulta de feriados nacionais, estaduais e municipais brasileiros para
apoiar o fechamento de ponto mensal — responde se uma data foi feriado ou
ponto facultativo num município, sempre citando a fonte.

> Contexto de arquitetura e regras de negócio: [CLAUDE.md](CLAUDE.md).
> Pesquisa de fontes de dados: [docs/fontes-de-dados.md](docs/fontes-de-dados.md).

## Instalação

Requer [Node.js](https://nodejs.org/) 20 ou 22 (LTS). **Evite Node 24+ por
enquanto**: o `better-sqlite3` só publica binário pré-compilado até a ABI do
Node 22; em versões mais novas o `npm install` tenta compilar na hora e, sem
Python/ferramentas de build instaladas, trava. Se a máquina não tiver Node,
baixe o zip portátil em https://nodejs.org/ (não precisa do instalador MSI,
que exige admin) e extraia num local do seu usuário.

```bash
npm install
npm run db:generate   # gera as migrations a partir do schema (só é preciso rodar de novo se o schema mudar)
npm run db:migrate    # cria/atualiza data/holidays.db
npm run seed          # popula tipos de feriado, municípios (IBGE) e candidatos não verificados
npm run dev            # sobe o servidor em http://localhost:3000 (modo watch)
```

Verifique a instalação:

```bash
npm test               # roda a suíte de testes
curl http://localhost:3000/health   # deve responder {"status":"ok"}
```

**Problema conhecido**: `npm audit` reporta uma vulnerabilidade moderada
transitiva do `drizzle-kit` (dependência de desenvolvimento antiga —
`@esbuild-kit/esm-loader` — que ele mesmo empacota). É usada só localmente
para gerar migrations, nunca roda em produção nem fica exposta pela
aplicação; a "correção" automática (`npm audit fix --force`) rebaixaria o
`drizzle-kit` para uma versão quebrada, por isso foi deixada como está.

## Atualizando a base de feriados

- **Municípios (IBGE)**: `npm run seed:municipios` — re-sincroniza com a API
  do IBGE (idempotente, upsert por código IBGE). Raramente muda; rodar
  esporadicamente (ex.: início de ano) é suficiente.
- **Feriados nacionais**: não precisam de atualização de dado — são
  calculados em código a partir da lei (Fase 2). Só muda se uma nova lei
  federal alterar a lista, o que exige alteração de código, não de seed.
- **Feriados estaduais e municipais**: cadastro/correção pela tela
  administrativa em `/admin` (sempre pedindo fonte, autor e data de
  verificação — nunca aceita sem fonte). Alternativa por script:
  editar `src/scripts/seed-feriados-curados.ts` e rodar
  `npm run seed:feriados-curados`.
- **Candidatos não verificados**: `npm run seed:candidatos` reimporta o
  snapshot comunitário de `db/seed-data/`. Esses registros são só pistas de
  trabalho (fila em `/admin/candidatos`) — nunca aparecem como feriado
  confirmado para quem consulta.

## Operação em lote e administração

- **`/lote`** — envie um CSV/XLSX com colunas `posto, municipio, uf, data`
  e baixe de volta o mesmo arquivo com `classificacao`, `tipos`, `fonte`,
  `status_municipal` e `erro` preenchidos. Município é casado por
  nome+UF (não por código IBGE) — se a grafia não bater com a base do
  IBGE (nem ignorando acentuação), a linha volta com erro explicando.
- **`/exportar/csv`** e **`/exportar/pdf`** — a partir da tela de consulta
  por período, exportam todos os dias do intervalo (incluindo os úteis)
  para anexar ao fechamento de ponto.
- **`/admin`** — cadastra/edita/desativa feriados estaduais e municipais, e
  revisa a fila de candidatos importados (`/admin/candidatos`), promovendo
  os que tiverem fonte primária confirmada ou rejeitando os demais.
  **Não tem login nesta versão** — qualquer pessoa com acesso à rede onde
  o app roda pode editar; não é um controle de acesso, é o requisito
  explícito do escopo atual.

## Estado do projeto

- [x] Fase 0 — Pesquisa de fontes de dados
- [x] Fase 1 — Fundação (modelo de dados, seed do IBGE)
- [x] Fase 2 — Motor de feriados (cálculo + resolução em camadas + testes)
- [x] Fase 3 — Interface web (busca com autocomplete, data única/período, calendário mensal, aviso de não verificado)
- [x] Fase 4 — Operação em lote (CSV/XLSX, exportação CSV/PDF, tela administrativa)
