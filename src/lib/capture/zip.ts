/**
 * Minimal zip reader for the browser: lists the central directory and inflates single
 * entries on demand with DecompressionStream, so a 600 MB capture never has to be read
 * whole. Handles zip64 and stored or deflated entries (what Windows, 7-Zip and Logel write).
 */

export interface ZipEntry {
  path: string;
  name: string;
  size: number;
  compressedSize: number;
  method: number;
  encrypted: boolean;
  offset: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_LOC64 = 0x07064b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

async function bytes(blob: Blob, start: number, end: number) {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u64 = (b: Uint8Array, o: number) => u32(b, o) + u32(b, o + 4) * 2 ** 32;

const CP437 =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

function decodeName(b: Uint8Array, utf8: boolean) {
  if (utf8) return new TextDecoder().decode(b);
  let s = "";
  for (const c of b) s += c < 0x80 ? String.fromCharCode(c) : CP437[c - 0x80];
  return s;
}

export async function isZip(blob: Blob) {
  if (blob.size < 22) return false;
  const h = await bytes(blob, 0, 4);
  return u32(h, 0) === SIG_LOC || u32(h, 0) === SIG_EOCD;
}

export async function listZip(blob: Blob): Promise<ZipEntry[]> {
  const tailLen = Math.min(blob.size, 22 + 65535 + 20);
  const tail = await bytes(blob, blob.size - tailLen, blob.size);
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tail, i) === SIG_EOCD) {
      e = i;
      break;
    }
  }
  if (e < 0) throw new Error("This is not a readable zip file (no central directory). It may be incomplete.");
  let count = u16(tail, e + 10);
  let cdSize = u32(tail, e + 12);
  let cdOffset = u32(tail, e + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const l = e - 20;
    if (l >= 0 && u32(tail, l) === SIG_LOC64) {
      const recOff = u64(tail, l + 8);
      const rec = await bytes(blob, recOff, recOff + 56);
      if (u32(rec, 0) === SIG_EOCD64) {
        count = u64(rec, 32);
        cdSize = u64(rec, 40);
        cdOffset = u64(rec, 48);
      }
    }
  }
  const cd = await bytes(blob, cdOffset, cdOffset + cdSize);
  const out: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cd.length; n++) {
    if (u32(cd, p) !== SIG_CEN) break;
    const flags = u16(cd, p + 8);
    const method = u16(cd, p + 10);
    let comp = u32(cd, p + 20);
    let size = u32(cd, p + 24);
    const nameLen = u16(cd, p + 28);
    const extraLen = u16(cd, p + 30);
    const commentLen = u16(cd, p + 32);
    let offset = u32(cd, p + 42);
    const path = decodeName(cd.subarray(p + 46, p + 46 + nameLen), (flags & 0x800) !== 0).replace(/\\/g, "/");
    // zip64 extended information
    let x = p + 46 + nameLen;
    const xEnd = x + extraLen;
    while (x + 4 <= xEnd) {
      const id = u16(cd, x);
      const len = u16(cd, x + 2);
      if (id === 0x0001) {
        let q = x + 4;
        if (size === 0xffffffff) {
          size = u64(cd, q);
          q += 8;
        }
        if (comp === 0xffffffff) {
          comp = u64(cd, q);
          q += 8;
        }
        if (offset === 0xffffffff) offset = u64(cd, q);
      }
      x += 4 + len;
    }
    p += 46 + nameLen + extraLen + commentLen;
    if (path.endsWith("/")) continue;
    out.push({
      path,
      name: path.split("/").pop() || path,
      size,
      compressedSize: comp,
      method,
      encrypted: (flags & 1) !== 0,
      offset,
    });
  }
  return out;
}

async function collect(stream: ReadableStream<Uint8Array>, size: number) {
  const out = new Uint8Array(size);
  const reader = stream.getReader();
  let at = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (at + value.length > out.length) throw new Error("A zip entry is larger than its header says.");
    out.set(value, at);
    at += value.length;
  }
  return at === out.length ? out : out.subarray(0, at);
}

/** An entry as a stream of chunks, so a large file can be searched without holding it whole. */
export async function zipEntryStream(blob: Blob, e: ZipEntry): Promise<ReadableStream<Uint8Array>> {
  if (e.encrypted) throw new Error(`${e.name} is password protected.`);
  const loc = await bytes(blob, e.offset, e.offset + 30);
  if (u32(loc, 0) !== SIG_LOC) throw new Error(`${e.name}: the zip entry header is damaged.`);
  const start = e.offset + 30 + u16(loc, 26) + u16(loc, 28);
  const data = blob.slice(start, start + e.compressedSize);
  if (e.method === 0) return data.stream();
  if (e.method === 8 && typeof DecompressionStream !== "undefined") return data.stream().pipeThrough(new DecompressionStream("deflate-raw"));
  throw new Error(`${e.name} uses a compression method (${e.method}) this page cannot unpack.`);
}

export async function readZipEntry(blob: Blob, e: ZipEntry): Promise<Uint8Array> {
  if (e.encrypted) throw new Error(`${e.name} is password protected.`);
  const loc = await bytes(blob, e.offset, e.offset + 30);
  if (u32(loc, 0) !== SIG_LOC) throw new Error(`${e.name}: the zip entry header is damaged.`);
  const start = e.offset + 30 + u16(loc, 26) + u16(loc, 28);
  const data = blob.slice(start, start + e.compressedSize);
  if (e.method === 0) return new Uint8Array(await data.arrayBuffer());
  if (e.method === 8) {
    if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot unzip files. Use a current Chrome, Edge or Firefox.");
    return collect(data.stream().pipeThrough(new DecompressionStream("deflate-raw")), e.size);
  }
  throw new Error(`${e.name} uses a compression method (${e.method}) this page cannot unpack. Zip it again with normal compression.`);
}
