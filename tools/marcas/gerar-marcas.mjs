/**
 * Gera os arquivos de marca que a interface usa, a partir dos originais em
 * `tools/marcas/origem/`.
 *
 *   node tools/marcas/gerar-marcas.mjs        (ou: npm run marcas)
 *
 * Por que isto existe como ferramenta versionada, e não como um passo manual:
 * os arquivos em `public/img/` são derivados — recortados, redimensionados e
 * com o fundo branco removido. Sem o original e a receita no repositório,
 * trocar a logo um dia viraria adivinhação sobre como os atuais foram feitos.
 *
 * A regra que a ferramenta respeita: **lê só de `origem/`, escreve só em
 * `public/img/`**. A primeira versão disto lia e escrevia no mesmo arquivo;
 * rodar duas vezes reprocessava a própria saída e degradava a imagem a cada
 * passada.
 *
 * Para trocar a logo: substitua o arquivo em `origem/` e rode de novo. O
 * recorte do símbolo é medido no bitmap, não fixo em código, então uma arte
 * com proporções diferentes continua funcionando.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { decodificar, codificar, tirarFundoBranco, recortar, reduzir, emQuadrado } from "./png.mjs";

const ORIGEM = "tools/marcas/origem";
const DESTINO = "public/img";

/**
 * Acha a parte gráfica de uma logo deitada (símbolo à esquerda, texto à
 * direita): varre as colunas com tinta e corta no primeiro vão em branco
 * largo o bastante para separar o símbolo do wordmark.
 */
function medirSimbolo(img, vaoMinimo = 6) {
  const temTinta = (x, y) => img.dados[(y * img.largura + x) * 4 + 3] > 24;
  const colunaTemTinta = (x) => {
    for (let y = 0; y < img.altura; y++) if (temTinta(x, y)) return true;
    return false;
  };

  let inicio = 0;
  while (inicio < img.largura && !colunaTemTinta(inicio)) inicio++;
  if (inicio === img.largura) throw new Error("imagem vazia");

  let fim = inicio, vazios = 0;
  for (let x = inicio; x < img.largura; x++) {
    if (colunaTemTinta(x)) { fim = x; vazios = 0; }
    else if (++vazios >= vaoMinimo) break;
  }

  let topo = -1, base = -1;
  for (let y = 0; y < img.altura; y++) {
    for (let x = inicio; x <= fim; x++) {
      if (temTinta(x, y)) { if (topo < 0) topo = y; base = y; break; }
    }
  }
  return { x: inicio, y: topo, largura: fim - inicio + 1, altura: base - topo + 1 };
}

mkdirSync(DESTINO, { recursive: true });

// ---------------------------------------------------------------------------
// Apoio: entra inteira e sem tratamento. É preta sobre fundo transparente e a
// interface a pinta por máscara CSS (branca na faixa, tinta no rodapé), então
// qualquer conversão aqui só teria como estragar.
// ---------------------------------------------------------------------------
copyFileSync(`${ORIGEM}/apoio.png`, `${DESTINO}/apoio.png`);
console.log(`${DESTINO}/apoio.png  (cópia do original)`);

// ---------------------------------------------------------------------------
// Rede São Roque: veio em RGB sobre branco. O fundo sai por limiar — ficaria
// uma franja branca de meio pixel nas bordas, mas a imagem é exibida com
// redução de ~2x, então ela some.
// ---------------------------------------------------------------------------
const saoRoque = tirarFundoBranco(decodificar(`${ORIGEM}/sao-roque.png`));

// Logo do rodapé a 2x do tamanho de exibição (124px), para telas densas.
const LARGURA_RODAPE = 248;
const rodape = reduzir(saoRoque, LARGURA_RODAPE, Math.round(LARGURA_RODAPE * saoRoque.altura / saoRoque.largura));
codificar(rodape, `${DESTINO}/sao-roque.png`);
console.log(`${DESTINO}/sao-roque.png  ${rodape.largura}x${rodape.altura}`);

// Favicon: só o símbolo, centrado num quadrado transparente.
const s = medirSimbolo(saoRoque);
console.log(`símbolo medido em x${s.x} y${s.y} ${s.largura}x${s.altura}`);
const simbolo = recortar(saoRoque, s.x, s.y, s.largura, s.altura);

codificar(emQuadrado(simbolo, 64), `${DESTINO}/favicon-64.png`);
console.log(`${DESTINO}/favicon-64.png  64x64`);

// O apple-touch-icon aparece como ícone de app, com cantos recortados pelo
// sistema: mais respiro para a marca não encostar na borda arredondada.
codificar(emQuadrado(simbolo, 180, 0.12), `${DESTINO}/apple-touch-icon.png`);
console.log(`${DESTINO}/apple-touch-icon.png  180x180`);
