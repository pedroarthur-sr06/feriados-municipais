# Feriados Municipais

Responde, em segundos, se uma data foi feriado ou ponto facultativo num
município — **sempre citando a lei ou o decreto que cria o feriado**, com
quem conferiu e quando. É o documento que vai anexado ao fechamento de ponto.

A base tem **8.6 mil feriados estaduais e municipais com fonte primária
conferida**, mais os nacionais, que são calculados por lei e algoritmo de
Páscoa. Município sem curadoria feita responde "não verificado" — nunca
"dia útil" por omissão.

---

## Para quem vai usar a ferramenta

Precisa de duas coisas instaladas na máquina, uma vez só:

1. **[Node.js 22 LTS](https://nodejs.org/)** — na dúvida, baixe a versão LTS.
   Não instale a 24 ou mais nova (ver [Instalação](#instalação)).
2. **[Git](https://git-scm.com/)** — só se você quiser receber as atualizações
   com dois cliques. Sem ele dá para usar, mas atualizar vira baixar o ZIP de
   novo.

Depois disso, dentro da pasta do projeto:

| Arquivo | O que faz |
| --- | --- |
| **Abrir Feriados Municipais.cmd** | Sobe a ferramenta e abre no navegador. É o do dia a dia. |
| **Atualizar.cmd** | Busca a versão mais nova e atualiza a base de feriados. |

A janela que abre ao subir mostra dois endereços:

```
  Neste computador:   http://localhost:3000
  Para compartilhar:  http://192.168.1.149:3000
```

O segundo é o que você manda para outra pessoa da rede — enquanto a janela
estiver aberta, qualquer um na mesma rede abre e vê exatamente a mesma base.
Fechar a janela derruba a ferramenta.

> **Na primeira vez o Windows pode perguntar** se libera o Node.js na rede.
> Precisa responder que sim, senão só funciona no seu próprio computador.

Para não procurar a pasta toda vez: clique direito no `.cmd` →
Enviar para → Área de trabalho.

---

## O site publicado

Além de rodar na própria máquina, o projeto é publicado como site a partir
deste repositório: cada envio para o GitHub reconstrói e republica. Quem só
consulta abre o endereço e pronto — nada para instalar.

A instância publicada roda em **modo consulta** (`ADMIN_HABILITADO=false`):
a tela de administração fica de fora. Isso é deliberado — ela escreve no
banco e o projeto não tem login, então expô-la seria abrir escrita para
qualquer um. A curadoria continua sendo feita na cópia local, onde o banco é
o de verdade, e chega ao site pelo seed versionado quando você commita.

Configuração em [render.yaml](render.yaml). O banco não é transportado: é
reconstruído a partir dos seeds do repositório a cada publicação, o que torna
o resultado determinístico e independente de a API do IBGE estar no ar.

## Para quem for mexer no código

> Arquitetura e regras de negócio: [CLAUDE.md](CLAUDE.md).
> Pesquisa de fontes de dados: [docs/fontes-de-dados.md](docs/fontes-de-dados.md).
> Direção visual: [docs/design.md](docs/design.md).
> Deixar sempre no ar: [docs/implantacao.md](docs/implantacao.md).

## Instalação

Requer [Node.js](https://nodejs.org/) 20 ou 22 (LTS). **Evite Node 24+ por
enquanto**: o `better-sqlite3` só publica binário pré-compilado até a ABI do
Node 22; em versões mais novas o `npm install` tenta compilar na hora e, sem
Python/ferramentas de build instaladas, trava. Se a máquina não tiver Node,
baixe o zip portátil em https://nodejs.org/ (não precisa do instalador MSI,
que exige admin) e extraia num local do seu usuário.

```bash
npm install
npm run dev            # sobe o servidor em http://localhost:3000 (modo watch)
```

O banco se constrói sozinho na primeira subida: `npm start` roda
`db:preparar` antes do servidor, que aplica as migrations e os seeds quando
encontra a base vazia (~14s, sem depender de rede). Em modo `dev` não há
esse guarda — rode `npm run db:preparar` uma vez, ou `npm run seed` para
incluir também os candidatos não verificados, que só a tela administrativa usa.

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

## Licença

[Apache License 2.0](LICENSE).

Escolhida por causa da seção 6: a licença é permissiva com o código e os
dados, mas **não concede direito sobre as marcas**. Os logotipos da Rede São
Roque e da Apoio estão no repositório porque a aplicação os exibe, não como
permissão de uso — quem reaproveitar o código deve trocá-los pelos próprios.
Detalhes em [NOTICE](NOTICE).

A base de feriados compila atos públicos (leis, decretos, Diários Oficiais),
citados registro a registro. As normas são públicas; a compilação e a
conferência são trabalho deste projeto.
