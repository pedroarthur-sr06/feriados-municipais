# Feriados Municipais

Consulta de feriados nacionais, estaduais e municipais brasileiros para
apoiar o fechamento de ponto mensal — responde se uma data foi feriado ou
ponto facultativo num município, sempre citando a fonte.

> Contexto de arquitetura e regras de negócio: [CLAUDE.md](CLAUDE.md).
> Pesquisa de fontes de dados: [docs/fontes-de-dados.md](docs/fontes-de-dados.md).

## Instalação

Requer [Node.js](https://nodejs.org/) 20 ou superior.

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

## Atualizando a base de feriados

- **Municípios (IBGE)**: `npm run seed:municipios` — re-sincroniza com a API
  do IBGE (idempotente, upsert por código IBGE). Raramente muda; rodar
  esporadicamente (ex.: início de ano) é suficiente.
- **Feriados nacionais**: não precisam de atualização de dado — são
  calculados em código a partir da lei (Fase 2). Só muda se uma nova lei
  federal alterar a lista, o que exige alteração de código, não de seed.
- **Feriados estaduais e municipais**: cadastro/correção manual, com fonte
  obrigatória, pela tela administrativa (Fase 4) ou diretamente na tabela
  `feriados` — nunca sem preencher `fonte_id`, `autor` e `data_verificacao`.
- **Candidatos não verificados**: `npm run seed:candidatos` reimporta o
  snapshot comunitário de `db/seed-data/`. Esses registros são só pistas de
  trabalho — nunca aparecem como feriado confirmado para quem consulta.

## Estado do projeto

- [x] Fase 0 — Pesquisa de fontes de dados
- [x] Fase 1 — Fundação (este repositório: modelo de dados, seed do IBGE)
- [ ] Fase 2 — Motor de feriados (cálculo + resolução em camadas + testes)
- [ ] Fase 3 — Interface web
- [ ] Fase 4 — Operação em lote (CSV/XLSX, exportação, tela administrativa)
