# Direção visual — Feriados Municipais

Registro da decisão de design da interface. Quem for mexer em
`public/css/styles.css` ou nas views deve ler isto antes: as escolhas abaixo
não são estéticas soltas, cada uma resolve um problema concreto.

## Diagnóstico: por que parecia "sistema antigo"

1. **Anatomia de documento, não de aplicação.** Título grande, parágrafo,
   links de texto e conteúdo numa coluna centralizada — isso é anatomia de
   página/blog. Ferramenta interna tem shell: rail de navegação persistente
   e área de trabalho.
2. **Azul genérico como cor de ação.** O botão primário usava o mesmo azul
   da categoria "Nacional". Cor que significa duas coisas não significa
   nenhuma — e "tudo azul" é a assinatura de software corporativo dos anos
   2000.
3. **Tipografia de sistema, sem numerais tabulares.** Datas, códigos IBGE e
   números de lei renderizados como texto corrido, sem coluna óptica.
4. **Tabelas cruas** (linha fina cinza, sem densidade, sem cabeçalho fixo).
5. **Estados não desenhados**: vazio, carregando e erro eram parágrafos.

## Direção: "Painel de conformidade"

Chrome neutro, cor só onde ela carrega significado de dado.

### Princípio central

**As únicas cores saturadas da tela são as cinco categorias semânticas**
(nacional, estadual, municipal, ponto facultativo, não verificado). Todo o
resto — botões, navegação, foco, links — é tinta (grafite) e neutros quentes.
Isso elimina a colisão ação-vs-categoria e é o que faz a interface parecer
deliberada em vez de "tema padrão do framework".

### Tipografia

| Papel | Família | Por quê |
|---|---|---|
| Títulos | **Space Grotesk** (600/700) | Contemporânea e técnica, com personalidade — evita a neutralidade genérica de Inter/Roboto |
| UI e corpo | **IBM Plex Sans** (400/500/600) | Desenhada para interface corporativa densa; legível em 13–14px |
| Dados | **IBM Plex Mono** (400/500) | Datas, códigos IBGE, nº de lei, colunas numéricas — numerais tabulares fazem a coluna alinhar de fato |

Fallback em todas: `system-ui, -apple-system, "Segoe UI", sans-serif`.

### Paleta

**Chrome (neutros quentes — o cinza puro é o que dá cara de Windows antigo):**

| Token | Valor | Uso |
|---|---|---|
| `--tinta` | `#16181d` | Rail de navegação, botão primário, texto forte |
| `--tinta-2` | `#22252c` | Hover do rail |
| `--texto` | `#1b1d22` | Texto principal |
| `--texto-suave` | `#5c6069` | Texto secundário |
| `--texto-fraco` | `#6b6f78` | Micro-texto, metadados (4.62:1 sobre o canvas — AA em 12px) |
| `--canvas` | `#f6f5f3` | Fundo da área de trabalho (quente) |
| `--superficie` | `#ffffff` | Cards, tabelas |
| `--linha` | `#e6e4e0` | Hairlines |

**Categorias (as únicas cores saturadas):**

| Categoria | Traço | Fundo |
|---|---|---|
| Nacional | `#1c5fc4` | `#dbe8fa` |
| Estadual | `#7038c4` | `#e8dcfa` |
| Municipal | `#146b43` | `#d5efe0` |
| Ponto facultativo | `#8a5406` | `#f8e7c4` |
| Não verificado | `#b8281c` | `#f9ddda` |
| Dia útil confirmado | `#8b8f98` | `#ffffff` |

Contraste: todos os traços passam ≥ 4.5:1 sobre branco e sobre o próprio
fundo pálido (texto de categoria nunca fica só na cor — ver redundância
abaixo).

### Escala e forma

- Base **4px**. Cards com 20–24px de padding; blocos separados por 32–40px.
- Largura útil da área de trabalho: **1100px**.
- Raio: **10px** (cards, inputs), **8px** (controles pequenos), **999px** (chips).
- Sombra: quase nenhuma — hairline + 1px. Profundidade vem de hierarquia.
- Movimento: 120ms em hover/foco. Nada além disso.

### Redundância de sinal (acessibilidade)

Cor nunca é o único portador de significado:

- Categoria no calendário = cor **+** peso da pílula; não verificado =
  hachura diagonal **+** marcador `?`.
- Dia consultado = anel de tinta (independente da categoria).
- Cada ocorrência traz o rótulo textual da camada num chip ("ESTADUAL").
- Foco visível em tinta, 2px, com offset — nunca removido.

### Calendário

É o âncora visual da ferramenta, então recebe o tratamento mais cuidadoso:
célula com pílula do dia (não fundo sangrado até a borda), cabeçalho de
semana em mono micro-caixa-alta, dia consultado com anel, contêiner com
hairline e cantos arredondados.
