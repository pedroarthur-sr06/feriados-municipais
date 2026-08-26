/**
 * Geração de PDF com pdfmake, usando a fonte padrão Helvetica (base-14 do
 * PDF, embutida em qualquer leitor — sem precisar embutir arquivo .ttf).
 * Testado nesta sessão com acentuação em português (ã, ç, é, í, ô, ú) —
 * renderiza corretamente via WinAnsiEncoding.
 */
import pdfMake from "pdfmake";
// @ts-expect-error -- módulo CJS sem tipos, formato: { Helvetica: { normal, bold, italics, bolditalics } }
import HelveticaFontes from "pdfmake/standard-fonts/Helvetica.js";

// @types/pdfmake não reexporta TDocumentDefinitions no nível do pacote —
// derivamos o tipo diretamente da assinatura de createPdf.
export type TDocumentDefinitions = Parameters<typeof pdfMake.createPdf>[0];

const nomesFontePadrao = new Set(Object.values(HelveticaFontes.Helvetica) as string[]);

pdfMake.setFonts(HelveticaFontes);
// Só os nomes das fontes padrão (Helvetica/Helvetica-Bold/...) — não abrimos
// acesso a arquivos locais nem URLs externas, o relatório não usa imagens.
pdfMake.setLocalAccessPolicy((caminho: string) => nomesFontePadrao.has(caminho));
pdfMake.setUrlAccessPolicy(() => false);

export async function gerarPdf(docDefinition: TDocumentDefinitions): Promise<Buffer> {
  const doc = pdfMake.createPdf({ defaultStyle: { font: "Helvetica", fontSize: 9 }, ...docDefinition });
  return doc.getBuffer();
}
