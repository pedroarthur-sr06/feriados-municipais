# Marcas

Gera os arquivos de marca que a interface usa, a partir dos originais em
`origem/`.

```bash
npm run marcas
```

## O que entra e o que sai

| Origem | Saída | Tratamento |
| --- | --- | --- |
| `origem/apoio.png` | `public/img/apoio.png` | cópia, sem tratamento |
| `origem/sao-roque.png` | `public/img/sao-roque.png` | fundo branco removido, reduzido para 248px |
| `origem/sao-roque.png` | `public/img/favicon-64.png` | só o símbolo, quadrado 64px |
| `origem/sao-roque.png` | `public/img/apple-touch-icon.png` | só o símbolo, quadrado 180px |

## Por que isto existe

Os arquivos em `public/img/` são **derivados** — recortados, redimensionados
e com o fundo removido. Sem o original e a receita versionados, trocar a logo
um dia viraria adivinhação sobre como os atuais foram feitos.

A ferramenta **lê só de `origem/` e escreve só em `public/img/`**. A primeira
versão lia e escrevia no mesmo arquivo: rodar duas vezes reprocessava a
própria saída e degradava a imagem a cada passada. Hoje rodar três vezes
seguidas dá bytes idênticos.

## Trocar uma logo

Substitua o arquivo em `origem/` e rode `npm run marcas`. O recorte do
símbolo é **medido no bitmap** (varre as colunas com tinta e corta no
primeiro vão em branco que separa o símbolo do texto), não fixo em código —
uma arte com proporções diferentes continua funcionando. A ferramenta
imprime as coordenadas que encontrou; confira se fazem sentido.

Requisitos do arquivo de origem:

- **Apoio**: preto sobre fundo transparente. A interface pinta a marca por
  máscara CSS (branca na faixa, tinta no rodapé), então a cor do arquivo não
  importa — só a forma e a transparência.
- **Rede São Roque**: colorida sobre fundo branco liso, símbolo à esquerda e
  wordmark à direita. O fundo sai por limiar (pixels com os três canais acima
  de 246).

## `png.mjs`

Decodifica, recorta, reduz e recodifica PNG usando só o `zlib` do Node —
nenhuma dependência nova no projeto para preparar quatro arquivos. Suporta
PNG de 8 bits por canal, não entrelaçado, nos quatro tipos de cor comuns.
Não é uma biblioteca de imagem de uso geral; cobre o que esta pasta precisa.
