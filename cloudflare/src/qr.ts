import qrcode from "qrcode";

// Pre-computed CRC32 table
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

function crc32(buf: Uint8Array): number {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function adler32(buf: Uint8Array): number {
  let s1 = 1;
  let s2 = 0;
  for (let i = 0; i < buf.length; i++) {
    s1 = (s1 + buf[i]) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  return ((s2 << 16) | s1) >>> 0;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array([
    type.charCodeAt(0),
    type.charCodeAt(1),
    type.charCodeAt(2),
    type.charCodeAt(3),
  ]);
  const len = data.length;
  const chunk = new Uint8Array(4 + 4 + len + 4);
  const view = new DataView(chunk.buffer);

  // Chunk Length
  view.setUint32(0, len, false);

  // Chunk Type
  chunk.set(typeBytes, 4);

  // Chunk Data
  chunk.set(data, 8);

  // Chunk CRC (calculated over type + data)
  const crcPayload = new Uint8Array(4 + len);
  crcPayload.set(typeBytes, 0);
  crcPayload.set(data, 4);
  view.setUint32(8 + len, crc32(crcPayload), false);

  return chunk;
}

/**
 * Generates a valid PNG image of a QR code in pure TypeScript/JavaScript.
 * Does not require Canvas, DOM, or Node.js native bindings (fully compatible with Cloudflare Workers).
 */
export function generateQrPng(text: string, scale = 7, margin = 3): Uint8Array {
  // Generate QR symbol matrix
  const qr = (qrcode as any).create(text, { errorCorrectionLevel: "M" });
  const modSize = qr.modules.size as number;
  const imgSize = (modSize + margin * 2) * scale;

  // Raw grayscale scanlines (1 filter byte (0) per row + imgSize pixels)
  const rowBytes = 1 + imgSize;
  const rawData = new Uint8Array(rowBytes * imgSize);

  for (let y = 0; y < imgSize; y++) {
    const rawOffset = y * rowBytes;
    rawData[rawOffset] = 0; // Filter: None
    const modY = Math.floor(y / scale) - margin;

    for (let x = 0; x < imgSize; x++) {
      const modX = Math.floor(x / scale) - margin;
      let isDark = false;
      if (modY >= 0 && modY < modSize && modX >= 0 && modX < modSize) {
        isDark = !!qr.modules.get(modY, modX);
      }
      rawData[rawOffset + 1 + x] = isDark ? 0 : 255;
    }
  }

  // Deflate in uncompressed blocks (RFC 1951 / RFC 1950 zlib)
  const maxBlock = 65535;
  const numBlocks = Math.ceil(rawData.length / maxBlock);
  const idatDataLen = 2 + numBlocks * 5 + rawData.length + 4;
  const idatPayload = new Uint8Array(idatDataLen);
  let p = 0;

  // Zlib header (Deflate, 32K window, no preset dict)
  idatPayload[p++] = 0x78;
  idatPayload[p++] = 0x01;

  for (let i = 0; i < rawData.length; i += maxBlock) {
    const chunk = rawData.subarray(i, Math.min(i + maxBlock, rawData.length));
    const isLast = i + maxBlock >= rawData.length;
    idatPayload[p++] = isLast ? 0x01 : 0x00;
    const len = chunk.length;
    const nlen = ~len & 0xffff;
    idatPayload[p++] = len & 0xff;
    idatPayload[p++] = (len >> 8) & 0xff;
    idatPayload[p++] = nlen & 0xff;
    idatPayload[p++] = (nlen >> 8) & 0xff;
    idatPayload.set(chunk, p);
    p += chunk.length;
  }

  // Adler-32 checksum
  const adler = adler32(rawData);
  idatPayload[p++] = (adler >>> 24) & 0xff;
  idatPayload[p++] = (adler >>> 16) & 0xff;
  idatPayload[p++] = (adler >>> 8) & 0xff;
  idatPayload[p++] = adler & 0xff;

  // PNG File Signature
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR Chunk: 8-bit grayscale, non-interlaced
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, imgSize, false);
  ihdrView.setUint32(4, imgSize, false);
  ihdr[8] = 8; // Bit depth: 8
  ihdr[9] = 0; // Color type: 0 (Grayscale)
  ihdr[10] = 0; // Compression: 0
  ihdr[11] = 0; // Filter: 0
  ihdr[12] = 0; // Interlace: 0

  const ihdrChunk = makeChunk("IHDR", ihdr);
  const idatChunk = makeChunk("IDAT", idatPayload);
  const iendChunk = makeChunk("IEND", new Uint8Array(0));

  const totalLen = sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const png = new Uint8Array(totalLen);
  let pos = 0;
  png.set(sig, pos);
  pos += sig.length;
  png.set(ihdrChunk, pos);
  pos += ihdrChunk.length;
  png.set(idatChunk, pos);
  pos += idatChunk.length;
  png.set(iendChunk, pos);
  pos += iendChunk.length;

  return png;
}
