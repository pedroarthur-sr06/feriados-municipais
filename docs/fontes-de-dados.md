# Fontes de dados — Feriados Municipais Brasileiros

> Pesquisa realizada em 26/08/2026. Todos os exemplos marcados como
> "verificado" foram de fato consultados nesta sessão (via `curl`/WebFetch),
> não reproduzidos de memória. URLs e números de lei citados a partir de
> fontes secundárias (blogs, agregadores) estão marcados como
> **"a confirmar na fonte primária"** e não devem entrar no banco sem essa
> confirmação — conforme a regra inegociável do projeto.

## Resumo executivo

Não existe hoje uma fonte gratuita, oficial e única com feriados municipais
dos ~5.570 municípios do Brasil, com rastreabilidade jurídica por registro.
As únicas ofertas com essa cobertura completa são produtos comerciais pagos
(e um deles está sendo descontinuado). Dado que a decisão do projeto é usar
**só fontes gratuitas/oficiais**, a conclusão prática é:

- **Feriados nacionais**: 100% resolvível por cálculo (lei + algoritmo de
  Páscoa) — zero dependência externa, zero custo, zero risco de dado errado.
- **Feriados estaduais**: só 27 linhas (uma por UF, mais eventuais leis
  estaduais adicionais) — viável curar manualmente, uma vez, com fonte legal
  citada em cada linha.
- **Feriados municipais**: não tem atalho gratuito confiável. Precisa ser
  povoado incrementalmente, município por município, com fonte primária
  (lei municipal / Diário Oficial do Município) registrada por linha. Todo
  município sem essa curadoria feita retorna `não verificado` — nunca "dia
  útil" por omissão.

Isso confirma a arquitetura em camadas já prevista no briefing. Detalhes e
fontes candidatas abaixo.

---

## 1. Base de municípios — IBGE

| | |
|---|---|
| **URL** | https://servicodados.ibge.gov.br/api/docs/localidades (docs) / `https://servicodados.ibge.gov.br/api/v1/localidades/municipios` (dados) |
| **Cobertura** | Todos os municípios brasileiros |
| **Formato** | JSON |
| **Limite de requisições** | Não documentado; API pública do governo, sem autenticação |
| **Custo** | Gratuito |
| **Licença** | Dado público governamental (IBGE) |

**Verificado nesta sessão** (`Invoke-RestMethod`/`curl` reais, não memória):

- Total de registros retornados por `GET /api/v1/localidades/municipios`:
  **5.571 municípios** (bate com o "5.570+" do briefing).
- Busca do registro de Salvador por `GET /api/v1/localidades/municipios/2927408`:

```json
{
  "id": 2927408,
  "nome": "Salvador",
  "microrregiao": {
    "id": 29021, "nome": "Salvador",
    "mesorregiao": {
      "id": 2905, "nome": "Metropolitana de Salvador",
      "UF": { "id": 29, "sigla": "BA", "nome": "Bahia",
        "regiao": { "id": 2, "sigla": "NE", "nome": "Nordeste" } }
    }
  }
}
```

Código IBGE 2927408 confere com o código oficial conhecido de Salvador/BA.

**Recomendação**: usar como *seed* one-shot na Fase 1 (baixar o JSON completo,
gravar num script de migração/seed versionado), não como dependência viva a
cada requisição — criação/fusão de municípios é rara, um re-sync manual
periódico (ex.: 1x/ano) é suficiente.

---

## 2. Feriados nacionais

| | |
|---|---|
| **Base legal** | Lei nº 662/1949, com redação dada pela Lei nº 10.607/2002 (datas fixas); Lei nº 6.802/1980 (12/10, Nossa Senhora Aparecida) |
| **Cobertura** | Nacional, 100% |
| **Formato** | Texto de lei (fonte primária) |
| **Custo** | Gratuito |
| **Confiabilidade** | Máxima — são as únicas datas de feriado que **não variam por município** e têm texto de lei federal direto, sem necessidade de terceiros |

Datas fixas confirmadas na Lei 662/1949 (redação atual): 1º de janeiro,
21 de abril, 1º de maio, 7 de setembro, 2 de novembro, 15 de novembro,
25 de dezembro — mais 12 de outubro pela Lei 6.802/1980. As móveis
(Carnaval, Sexta-feira Santa, Corpus Christi, Páscoa) são derivadas do
Domingo de Páscoa por regra astronômica/calendário, não por lei específica de
data — por isso precisam do algoritmo de Gauss/Meeus na Fase 2.

**Fontes usadas só para conferência cruzada do algoritmo (não como
dependência em runtime)**, ambas consultadas e verificadas nesta sessão:

- **BrasilAPI** — `GET https://brasilapi.com.br/api/feriados/v1/{ano}`.
  Gratuita, sem chave, projeto open-source comunitário
  ([BrasilAPI/BrasilAPI](https://github.com/BrasilAPI/BrasilAPI)), sem SLA
  formal. Exemplo real (2025, primeiros itens):
  ```json
  [{"date":"2025-01-01","name":"Confraternização mundial","type":"national","weekday":"quarta-feira"},
   {"date":"2025-03-03","name":"Carnaval","type":"national","weekday":"segunda-feira"},
   {"date":"2025-04-18","name":"Sexta-feira Santa","type":"national","weekday":"sexta-feira"},
   {"date":"2025-06-19","name":"Corpus Christi","type":"national","weekday":"quinta-feira"}]
  ```
  (14 datas nacionais para 2025, incluindo as móveis já calculadas.)
- **Nager.Date** — `GET https://date.nager.at/api/v3/publicholidays/{ano}/BR`.
  Gratuita, sem chave, projeto global open-source. Exemplo real confirma as
  mesmas datas e ainda sinaliza corretamente que "Revolução Constitucionalista
  de 1932" (9/7) é `"global": false, "counties": ["BR-SP"]` — ou seja, é um
  feriado **estadual** de SP, não nacional (cuidado: algumas fontes o listam
  junto dos nacionais por engano).

**Recomendação**: implementar o cálculo em código na Fase 2 (Gauss/Meeus +
tabela de datas fixas), sem chamada externa em runtime — evita indisponibilidade
de terceiro, é mais rápido (<2s exigido) e é 100% verificável por lei. Usar
BrasilAPI/Nager.Date apenas como oráculo de teste ao escrever a suíte.

---

## 3. Feriados estaduais

| | |
|---|---|
| **Base legal** | Lei federal nº 9.093/1995, art. 1º, II: cada Estado pode fixar **uma** data cívica por lei estadual própria; alguns estados têm leis adicionais |
| **Cobertura** | 27 UFs, mas cada uma exige pesquisa individual — não há agregador único |
| **Formato** | Texto de lei estadual (varia por estado) |
| **Custo** | Gratuito (mas é trabalho manual de curadoria) |
| **Confiabilidade das fontes secundárias encontradas** | Baixa/média — nenhum agregador citou número de lei de forma consistente |

Não encontrei nenhuma fonte gratuita agregando os 27 feriados estaduais com
citação de lei verificável em cada linha. As opções são:

- **Curadoria manual, 27 linhas** — trabalhoso mas pequeno e finito; cada
  linha leva número de lei estadual + link da fonte primária (portal de
  legislação do estado / Assembleia Legislativa). É o único caminho compatível
  com a regra inegociável.
- **[joaopbini/feriados-brasil](https://github.com/joaopbini/feriados-brasil)**
  (GitHub, MIT, gratuito, CSV/JSON/SQL, já referencia código IBGE) — schema
  bom para imitar, mas o próprio README **não cita fonte legal por feriado**
  nem metodologia de verificação; não pode ser importado direto, só usado
  como lista de pistas a confirmar uma a uma.

**Exemplo trabalhado (caso do critério de aceite Salvador/BA 02/07)**:
"Independência da Bahia" (2 de julho) é um **feriado ESTADUAL da Bahia**, não
municipal — o estado inteiro para, e por isso aparece também em Salvador (e em
qualquer município baiano) quando a camada estadual é resolvida. Múltiplas
fontes secundárias (contabeis.com.br, querobolsa, UFBA) confirmam a data e
citam a base legal como **Lei nº 9.093/95** — só que esse é o número da lei
*federal* de 1995 que trata de feriados civis/religiosos em geral, não uma lei
específica da Bahia; outras fontes citam **"Lei nº 38/1936"** como a lei
estadual baiana que institui a data. **Isso ainda precisa ser confirmado na
fonte primária** (portal de legislação da Assembleia Legislativa da Bahia)
antes de entrar no seed — vou fazer essa confirmação dentro da Fase 1, ao
popular a tabela de 27 estados, e reporto o número exato de lei aí.

Importante para a Fase 2: a consulta "Salvador, 02/07" deve responder
corretamente porque a camada **estadual** cobre Salvador (todo município da
Bahia herda os feriados estaduais da Bahia) — não porque exista uma lei
*municipal* de Salvador para essa data. O motor de resolução em camadas
precisa então filtrar o feriado estadual pela UF do município, não só pelo
código IBGE específico.

**Recomendação**: curar as 27 linhas manualmente na Fase 1, com fonte, como
parte do seed inicial — é escopo pequeno e único.

---

## 4. Feriados municipais — o ponto crítico

| | |
|---|---|
| **Base legal** | Lei federal nº 9.093/1995: municípios podem fixar por lei municipal (a) data cívica no aniversário/fundação do município e (b) até 4 feriados religiosos conforme tradição local (incluindo Sexta-feira Santa) |
| **Cobertura** | ~5.570 leis municipais distintas — nenhuma fonte gratuita cobre todas com rastreabilidade |
| **Formato** | Diário Oficial do Município / lei municipal — varia por município |
| **Custo** | Gratuito nas fontes primárias, mas é trabalho manual município a município |

Fontes reais investigadas:

**a) Diários Oficiais dos Municípios (fonte primária)** — portais mantidos
por associações estaduais de municípios, ex.:
[diariomunicipal.com.br](https://www.diariomunicipal.com.br/) (AMA-AL,
AMM-MG, AMR-RR, AGM-GO, AMP-PR, associações da Bahia, entre outras) e
[diariomunicipal.org](https://diariomunicipal.org/) (ex.: AMM-MT). Cobertura
é fragmentada — cada estado tem seu próprio portal/associação, não há um
índice nacional único, e não há API de busca estruturada por "há feriado
nesta data neste município" — é preciso localizar a lei/decreto específico
publicado. É a fonte correta para citar como "base legal" quando um feriado
municipal for cadastrado, mas não serve para importação em massa.

**b) APIs comerciais com cobertura declarada de 100% dos municípios** —
avaliadas para completude, mas **descartadas pela decisão de usar só fontes
gratuitas**:
- **Feriados API** ([feriadosapi.com](https://feriadosapi.com/sobre), por
  Bini Labs) — declara cobrir os 5.570 municípios, código IBGE, diz monitorar
  DOU/DOE/DOM e legislações municipais. Preço não publicado na página pública
  (necessário contato/checkout); o repositório gratuito `joaopbini/feriados-brasil`
  é, na prática, um funil promocional para esse produto pago (mesmo autor).
- **feriados.dev** — declarava cobrir 96% dos municípios (5.374/5.570),
  majoritariamente via o "aniversário do município" (o feriado cívico padrão
  da Lei 9.093/95). **Está sendo descontinuada**: a própria página informa que
  novos cadastros não estão mais disponíveis e a API hospedada só continua
  até 19/10/2026 para clientes existentes — não é uma dependência viável de
  qualquer forma.
- **Invertexto** — cobre só feriados nacionais e estaduais, não municipais
  (não serve para o problema central de qualquer forma).

**c) Datasets comunitários gratuitos**:
- `joaopbini/feriados-brasil` (já citado acima) — bom schema (3 tabelas:
  estados, municípios, feriado; código IBGE como FK), licença MIT, mas **não
  cita fonte legal por feriado municipal individual** — falha a regra
  inegociável se importado direto.
- `dadosbr/feriados` — **arquivado desde 2019**, dados desatualizados,
  descartado.

**Conclusão**: não existe atalho. Feriados municipais precisam ser
cadastrados incrementalmente, com fonte primária (Diário Oficial / lei
municipal, URL + data de verificação) por linha, priorizando os municípios
onde a empresa realmente tem postos de trabalho. Todo o resto responde
`não verificado`.

**Opção intermediária que proponho para acelerar a curadoria** (decisão sua):
importar o dataset `joaopbini/feriados-brasil` para uma tabela separada de
**"candidatos não verificados"** — nunca exibida como fato ao usuário, usada
só como lista de trabalho na tela administrativa da Fase 4 (ex.: "candidato:
Aniversário de X, 15/03 — confirmar na fonte e promover"). Isso não viola a
regra inegociável (nada aparece como feriado real até alguém confirmar a
fonte primária), mas dá um ponto de partida em vez de partir de zero em 5.570
municípios.

---

## Arquitetura de dados em camadas (recomendação)

```
tipos_feriado   (nacional | estadual | municipal | ponto_facultativo)
fontes          (id, descricao, url, tipo_fonte, data_publicacao)
municipios      (codigo_ibge PK, nome, uf, ... — snapshot do IBGE)
feriados        (id, data ou regra_calculo, nome, tipo_feriado_id,
                 abrangencia: nacional | uf | codigo_ibge,
                 fonte_id, data_verificacao, ativo)
```

Resolução para "município M, data D":
1. **Nacional** — sempre calculado em código (lei + algoritmo de Páscoa),
   nunca depende de linha no banco.
2. **Estadual** — busca na tabela `feriados` por `abrangencia = UF(M)`,
   curada manualmente (27 linhas + eventuais extras por estado).
3. **Municipal** — busca por `abrangencia = codigo_ibge(M)`. Se não houver
   linha **e** o município nunca foi curado, a resposta inclui
   `status_municipal: "nao_verificado"` explícito — nunca inferido como dia
   útil.
4. Camadas podem coexistir na mesma data (ex.: nacional + municipal) — a
   resposta lista todas, sem uma "vencer" a outra, conforme pedido no
   briefing.

Isso é exatamente a arquitetura que o briefing já antecipava; a pesquisa só
confirma que a camada municipal tem que nascer vazia/curada manualmente, e
propõe a tabela de "candidatos não verificados" como acelerador opcional.

---

## Decisões que preciso da sua confirmação antes da Fase 1

1. **Aprovar a arquitetura em camadas acima** (nacional calculado / estadual
   curado manualmente / municipal curado manualmente com fonte por linha).
2. **Importar ou não** o dataset `joaopbini/feriados-brasil` como lista de
   candidatos não verificados (tabela separada, nunca exibida como fato) para
   acelerar a curadoria futura — ou prefere começar 100% vazio?
3. **Prioridade de povoamento municipal**: você tem a lista de municípios
   onde a empresa tem postos de trabalho? Se sim, começo a curadoria por eles
   na Fase 1/2; senão, sugiro começarmos pelas capitais + Salvador/BA (já que
   é o critério de aceite) e você me passa a lista real depois.
