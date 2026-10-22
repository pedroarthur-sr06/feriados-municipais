# Direção visual — Feriados Municipais

Registro da decisão de design da interface. Quem for mexer em
`public/css/styles.css` ou nas views deve ler isto antes: as escolhas abaixo
não são estéticas soltas, cada uma resolve um problema concreto.

## O erro que a segunda passada corrigiu

A primeira repaginação trocou a anatomia de documento por um shell de
aplicação — isso continua valendo. Mas ela errou em duas frentes:

1. **Respondia a pergunta errada.** O trabalho do usuário é *"neste dia houve
   feriado, e com que fonte?"*. O maior elemento da tela era a grade do mês, a
   resposta era uma célula colorida que exigia decodificação contra uma legenda
   de seis itens, e a fonte — a razão de existir do projeto — era texto cinza de
   13px no rodapé de um cartão. O `CLAUDE.md` grita "sempre com a fonte" e o
   design sussurrava.
2. **Vestia os defaults de interface gerada.** Caixa alta com tracking em todo
   rótulo, seta "→" dentro do botão, monoespaçada como fantasia de dado,
   `#16181d` fazendo as vezes de preto, creme quente de fundo, e o mesmo raio e
   a mesma sombra em cada bloco da tela.

## Direção: "Parecer"

A tela lê como uma conclusão oficial curta: **veredito em palavras → a norma
que sustenta → o mês como contexto**.

### Princípios

1. **A resposta é uma frase, não uma cor.** O veredito ("Feriado estadual",
   "Ponto facultativo", "Dia útil", "Não verificado") é o maior elemento da
   tela, escrito, na cor da camada que o sustenta.
2. **A fonte tem peso de documento, não de rodapé.** Cada prova traz o nome da
   norma em serifa, o que aquela camada significa em português, o texto legal
   em medida de leitura e a data de conferência.
3. **Cor saturada só onde significa categoria.** Chrome em tinta; as únicas
   cores fortes são as cinco camadas. O veredito é o único lugar onde a cor
   aparece em escala grande — é lá que a ousadia foi gasta, e só lá.
4. **Caixa alta só para siglas.** Hierarquia por peso e tamanho, nunca por
   tracking.
5. **Ausência de prova é conteúdo.** Em município não verificado não existe
   bloco de prova para mostrar — e a tela deixa isso visível em vez de
   preencher o espaço.
6. **A abertura afirma o método; a ressalva mora na resposta.** O estado
   inicial da Consulta diz o que a ferramenta garante — norma citada, feriado
   distinguido de ponto facultativo, camadas convivendo. Não há contador de
   cobertura ali: medir a base na abertura promete um rigor que a curadoria
   por agregador não tem, e abrir pela lacuna descredibiliza a ferramenta
   antes de ela responder qualquer coisa. O "não verificado" continua
   intacto onde é obrigatório — no veredito daquela consulta específica,
   junto da frase que proíbe tratar o dia como útil.

### Tipografia

**Geist**, família única, usada com convicção — e **Geist Mono** só para código.

Geist é a grotesca geométrica desenhada para ferramenta de desenvolvedor: é o
que dá o ar técnico e atual que a ferramenta pede, sem cair em Inter, Roboto ou
Space Grotesk, que aparecem em qualquer página gerada. A distinção entre
veredito, título e corpo vem de **escala e peso**, não de trocar de tipo:

| Papel | Tamanho / peso |
|---|---|
| Veredito | 44px / 600, tracking −0.035em |
| Título de página | 30px / 600, tracking −0.03em |
| Nome de norma | 20px / 600, tracking −0.02em |
| Corpo das provas | 14.5px / 400, entrelinha 1.62 |
| Rótulos de interface | 12.5px / 600 |

O tracking negativo nos corpos grandes é o que faz uma grotesca parecer atual;
sem ele, Geist fica genérica.

**Não há monoespaçada para dados.** O problema real era alinhar números em
coluna, e `font-variant-numeric: tabular-nums` no `body` resolve isso sem a
fantasia de editor de código. Geist Mono aparece só onde o conteúdo é
literalmente código (`pascoa+60`, caminho de arquivo).

### Paleta

| Token | Valor | Uso |
|---|---|---|
| `--tinta` | `#1a2438` | Rail, botão primário, foco — azul-marinho de tinta, não um preto acinzentado |
| `--tinta-2` / `--tinta-3` | `#263351` / `#3c4a6b` | Hover do rail; veredito neutro |
| `--texto` | `#1f2633` | Texto principal |
| `--texto-suave` | `#525b6b` | Texto secundário, corpo das provas |
| `--texto-fraco` | `#5f6876` | Micro-texto (4.70:1 sobre o papel — AA em 12px) |
| `--canvas` | `#e9ebe9` | Papel de pasta de processo, frio; o creme quente é o clichê nº 1 de página gerada |
| `--superficie` | `#ffffff` | Provas, cartões, tabelas |
| `--linha` | `#d7dbd7` | Hairlines |

Categorias — as únicas cores saturadas:

| Categoria | Traço | Fundo |
|---|---|---|
| Nacional | `#1c5fc4` | `#dbe8fa` |
| Estadual | `#5f2da8` | `#e7dcf7` |
| Municipal | `#146b43` | `#d5efe0` |
| Ponto facultativo | `#8a5406` | `#f8e7c4` |
| Não verificado | `#b8281c` | `#f9ddda` |
| Dia útil confirmado | `#5f6876` | `#ffffff` |

### Forma

Raio 8px (cartões) / 6px (blocos) / 5px (controles). **Sem sombra** — a
profundidade vem de hierarquia e hairline; sombra só no popover de
autocomplete, onde ela diz "isto flutua acima do resto".

### Redundância de sinal (acessibilidade)

Cor nunca é o único portador de significado: a camada aparece escrita no
veredito e na descrição de cada prova; "não verificado" no calendário usa
hachura diagonal (forma, não cor); o dia consultado leva anel de tinta,
independente da categoria. Contraste auditado no navegador em todas as telas e
nos dois modos do toggle — zero falhas AA.

### Marca institucional no rail

O topo do rail traz o **símbolo da Apoio** em branco, ao lado do nome da
aplicação, numa linha só. O ícone de calendário que ocupava esse lugar saiu:
duas marcas no topo competem, e um glifo genérico ao lado de uma marca real
perde sempre.

**Só o símbolo, sem o wordmark.** O "APOIO" ocupa 12% da altura do arquivo da
marca. Para ele ficar legível, a marca inteira precisa virar um bloco alto de
~70px — e aí a identidade da empresa passa a gritar mais alto que a
navegação, que é o trabalho desta coluna. A primeira tentativa foi assim e foi
rejeitada na revisão. O símbolo sozinho carrega a marca e cabe numa linha.

**A logo entra como máscara, não como `<img>`.** O arquivo
(`public/img/apoio.png`) é preto sobre fundo transparente;
`mask` + `background-color: currentColor` pinta de branco sem exigir uma
segunda versão do arquivo. A caixa tem a proporção da parte gráfica (148:117)
e a máscara fica ancorada no topo — é o que recorta o wordmark para fora, sem
precisar de um segundo arquivo. Se aparecer o `.svg` oficial, trocar é mudar
a URL.

A coluna da marca nasce na mesma vertical dos ícones do menu (24px da borda).
O anel de foco do link da marca é branco: o anel global é `var(--tinta)`, a
própria cor do rail, e sumiria ali.

### Autocomplete de município

O campo é um combobox, não um campo de texto com lista decorativa: setas
percorrem, Enter escolhe, Esc fecha, e o item percorrido pelo teclado usa
fundo de tinta cheia — mais forte que o hover de propósito, porque é posição
do teclado e precisa se distinguir de onde o mouse passou por acaso.

Escolher um município joga o foco para a data. Quem usa isto confere dezenas
de datas por dia; o caminho inteiro tem que funcionar sem tirar a mão do
teclado.
