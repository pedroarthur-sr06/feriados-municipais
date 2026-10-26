/**
 * Utilitário PNG mínimo (decodifica, recorta, reduz, recodifica) usando só
 * zlib do Node — evita dependência nova no projeto só para preparar dois
 * arquivos de marca.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";

const ASSINATURA = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(buf) {
  let tabela = crc32.tabela;
  if (!tabela) {
    tabela = crc32.tabela = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tabela[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = tabela[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

export function decodificar(caminho) {
  const b = readFileSync(caminho);
  if (!b.subarray(0, 8).equals(ASSINATURA)) throw new Error("não é PNG");
  let pos = 8;
  let largura = 0, altura = 0, profundidade = 0, tipoCor = 0;
  const idat = [];
  while (pos < b.length) {
    const tam = b.readUInt32BE(pos);
    const tipo = b.toString("ascii", pos + 4, pos + 8);
    const dados = b.subarray(pos + 8, pos + 8 + tam);
    if (tipo === "IHDR") {
      largura = dados.readUInt32BE(0);
      altura = dados.readUInt32BE(4);
      profundidade = dados[8];
      tipoCor = dados[9];
      if (profundidade !== 8) throw new Error("só 8 bits por canal");
      if (dados[12] !== 0) throw new Error("PNG entrelaçado não suportado");
    } else if (tipo === "IDAT") idat.push(dados);
    else if (tipo === "IEND") break;
    pos += 12 + tam;
  }
  const canais = { 0: 1, 2: 3, 4: 2, 6: 4 }[tipoCor];
  if (!canais) throw new Error("tipo de cor " + tipoCor + " não suportado");
  const bruto = inflateSync(Buffer.concat(idat));
  const bpp = canais;
  const linha = largura * bpp;
  const px = Buffer.alloc(altura * linha);
  let p = 0;
  for (let y = 0; y < altura; y++) {
    const filtro = bruto[p++];
    const atual = bruto.subarray(p, p + linha); p += linha;
    const destino = px.subarray(y * linha, (y + 1) * linha);
    const anterior = y > 0 ? px.subarray((y - 1) * linha, y * linha) : null;
    for (let x = 0; x < linha; x++) {
      const a = x >= bpp ? destino[x - bpp] : 0;
      const b2 = anterior ? anterior[x] : 0;
      const c = anterior && x >= bpp ? anterior[x - bpp] : 0;
      let v = atual[x];
      if (filtro === 1) v += a;
      else if (filtro === 2) v += b2;
      else if (filtro === 3) v += (a + b2) >> 1;
      else if (filtro === 4) {
        const pa = Math.abs(b2 - c), pb = Math.abs(a - c), pc = Math.abs(a + b2 - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b2 : c;
      }
      destino[x] = v & 0xff;
    }
  }
  // normaliza para RGBA
  const rgba = Buffer.alloc(largura * altura * 4);
  for (let i = 0, n = largura * altura; i < n; i++) {
    const s = i * bpp, d = i * 4;
    if (canais === 4) { rgba[d] = px[s]; rgba[d+1] = px[s+1]; rgba[d+2] = px[s+2]; rgba[d+3] = px[s+3]; }
    else if (canais === 3) { rgba[d] = px[s]; rgba[d+1] = px[s+1]; rgba[d+2] = px[s+2]; rgba[d+3] = 255; }
    else if (canais === 2) { rgba[d] = rgba[d+1] = rgba[d+2] = px[s]; rgba[d+3] = px[s+1]; }
    else { rgba[d] = rgba[d+1] = rgba[d+2] = px[s]; rgba[d+3] = 255; }
  }
  return { largura, altura, dados: rgba };
}

export function codificar({ largura, altura, dados }, caminho) {
  const linha = largura * 4;
  const bruto = Buffer.alloc(altura * (linha + 1));
  for (let y = 0; y < altura; y++) {
    bruto[y * (linha + 1)] = 0; // sem filtro
    dados.copy(bruto, y * (linha + 1) + 1, y * linha, (y + 1) * linha);
  }
  const pedaco = (tipo, corpo) => {
    const t = Buffer.from(tipo, "ascii");
    const tam = Buffer.alloc(4); tam.writeUInt32BE(corpo.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, corpo])));
    return Buffer.concat([tam, t, corpo, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0); ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  writeFileSync(caminho, Buffer.concat([
    ASSINATURA,
    pedaco("IHDR", ihdr),
    pedaco("IDAT", deflateSync(bruto, { level: 9 })),
    pedaco("IEND", Buffer.alloc(0)),
  ]));
}

/** Zera o alfa de pixels quase brancos (logo veio em RGB sobre branco). */
export function tirarFundoBranco(img, limiar = 246) {
  const d = img.dados;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] >= limiar && d[i+1] >= limiar && d[i+2] >= limiar) d[i+3] = 0;
  }
  return img;
}

export function recortar(img, x0, y0, w, h) {
  const saida = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = ((y0 + y) * img.largura + x0) * 4;
    img.dados.copy(saida, y * w * 4, src, src + w * 4);
  }
  return { largura: w, altura: h, dados: saida };
}

/** Redução por média de área (box filter), com alfa pré-multiplicado. */
export function reduzir(img, w, h) {
  const saida = Buffer.alloc(w * h * 4);
  const ex = img.largura / w, ey = img.altura / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * ey), y1 = Math.max(y0 + 1, Math.floor((y + 1) * ey));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * ex), x1 = Math.max(x0 + 1, Math.floor((x + 1) * ex));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1 && sy < img.altura; sy++) {
        for (let sx = x0; sx < x1 && sx < img.largura; sx++) {
          const i = (sy * img.largura + sx) * 4;
          const al = img.dados[i + 3] / 255;
          r += img.dados[i] * al; g += img.dados[i+1] * al; b += img.dados[i+2] * al;
          a += al; n++;
        }
      }
      const d = (y * w + x) * 4;
      if (a > 0) {
        saida[d] = Math.round(r / a); saida[d+1] = Math.round(g / a); saida[d+2] = Math.round(b / a);
        saida[d+3] = Math.round((a / n) * 255);
      }
    }
  }
  return { largura: w, altura: h, dados: saida };
}

/** Encaixa a imagem centrada num quadrado transparente. */
export function emQuadrado(img, lado, respiro = 0.08) {
  const util = lado * (1 - respiro * 2);
  const escala = Math.min(util / img.largura, util / img.altura);
  const w = Math.max(1, Math.round(img.largura * escala));
  const h = Math.max(1, Math.round(img.altura * escala));
  const reduzida = reduzir(img, w, h);
  const saida = Buffer.alloc(lado * lado * 4);
  const ox = Math.round((lado - w) / 2), oy = Math.round((lado - h) / 2);
  for (let y = 0; y < h; y++) {
    reduzida.dados.copy(saida, ((oy + y) * lado + ox) * 4, y * w * 4, (y + 1) * w * 4);
  }
  return { largura: lado, altura: lado, dados: saida };
}
