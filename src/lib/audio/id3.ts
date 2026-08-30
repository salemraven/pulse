export type Id3Meta = {
  title?: string;
  artist?: string;
  artworkUrl?: string;
};

function synchsafe(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! & 0x7f) * 0x200000 +
    (bytes[offset + 1]! & 0x7f) * 0x4000 +
    (bytes[offset + 2]! & 0x7f) * 0x80 +
    (bytes[offset + 3]! & 0x7f)
  );
}

function decodeText(data: Uint8Array): string {
  if (data.length === 0) return "";
  const enc = data[0];
  const body = data.subarray(1);
  try {
    if (enc === 0) return new TextDecoder("latin1").decode(body).replace(/\0/g, "").trim();
    if (enc === 1) return new TextDecoder("utf-16").decode(body).replace(/\0/g, "").trim();
    if (enc === 2) return new TextDecoder("utf-16be").decode(body).replace(/\0/g, "").trim();
    return new TextDecoder("utf-8").decode(body).replace(/\0/g, "").trim();
  } catch {
    return "";
  }
}

function parseApic(data: Uint8Array): string | undefined {
  if (data.length < 4) return;
  const enc = data[0]!;
  let i = 1;
  while (i < data.length && data[i] !== 0) i++;
  const mime = new TextDecoder("latin1").decode(data.subarray(1, i)) || "image/jpeg";
  i += 1; // null
  i += 1; // picture type
  if (enc === 0 || enc === 3) {
    while (i < data.length && data[i] !== 0) i++;
    i += 1;
  } else {
    while (i + 1 < data.length && !(data[i] === 0 && data[i + 1] === 0)) i += 2;
    i += 2;
  }
  const slice = data.subarray(i);
  const copy = new Uint8Array(slice.byteLength);
  copy.set(slice);
  const blob = new Blob([copy], { type: mime });
  return URL.createObjectURL(blob);
}

export async function readId3(file: File): Promise<Id3Meta> {
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  if (head.length < 10 || String.fromCharCode(head[0]!, head[1]!, head[2]!) !== "ID3") {
    return {};
  }
  const size = synchsafe(head, 6);
  const tag = new Uint8Array(await file.slice(10, 10 + size).arrayBuffer());
  const meta: Id3Meta = {};
  let offset = 0;
  while (offset + 10 < tag.length) {
    const id = String.fromCharCode(tag[offset]!, tag[offset + 1]!, tag[offset + 2]!, tag[offset + 3]!);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const frameSize =
      head[3]! >= 4
        ? synchsafe(tag, offset + 4)
        : (tag[offset + 4]! << 24) | (tag[offset + 5]! << 16) | (tag[offset + 6]! << 8) | tag[offset + 7]!;
    if (frameSize <= 0 || offset + 10 + frameSize > tag.length) break;
    const payload = tag.subarray(offset + 10, offset + 10 + frameSize);
    if (id === "TIT2") meta.title = decodeText(payload);
    else if (id === "TPE1") meta.artist = decodeText(payload);
    else if (id === "APIC" && !meta.artworkUrl) meta.artworkUrl = parseApic(payload);
    offset += 10 + frameSize;
  }
  return meta;
}
