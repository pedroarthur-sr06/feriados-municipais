/**
 * Helper de apresentação da navegação de páginas das tabelas administrativas.
 *
 * Com milhares de registros curados a listagem passa de cem páginas, e
 * imprimir um link por página devolveria ao HTML justamente o peso que a
 * paginação existe para tirar. A janela mostra as duas extremidades, uma
 * vizinhança em torno da página atual, e "…" onde houver buraco.
 */
export type ItemPaginacao = number | "…";

export function janelaDePaginas(paginaAtual: number, totalPaginas: number, vizinhanca = 2): ItemPaginacao[] {
  const numeros = new Set<number>();
  numeros.add(1);
  numeros.add(Math.max(1, totalPaginas));
  for (let p = paginaAtual - vizinhanca; p <= paginaAtual + vizinhanca; p++) {
    if (p >= 1 && p <= totalPaginas) numeros.add(p);
  }

  const itens: ItemPaginacao[] = [];
  let anterior = 0;
  for (const p of [...numeros].sort((a, b) => a - b)) {
    if (anterior > 0 && p - anterior > 1) itens.push("…");
    itens.push(p);
    anterior = p;
  }
  return itens;
}
