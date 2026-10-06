import fs from "node:fs/promises";
import path from "node:path";

const source =
  process.env.GEMMA_AVATAR_SOURCE ||
  "https://taap-alda.vercel.app/models/alda.glb";

const response = await fetch(source, { signal: AbortSignal.timeout(30000) });
if (!response.ok) {
  throw new Error("Impossibile leggere l'avatar sorgente: HTTP " + response.status);
}

const original = Buffer.from(await response.arrayBuffer());
if (original.toString("utf8", 0, 4) !== "glTF") {
  throw new Error("Il file sorgente non è un GLB valido.");
}

const jsonLength = original.readUInt32LE(12);
const jsonType = original.readUInt32LE(16);
if (jsonType !== 0x4e4f534a) {
  throw new Error("Chunk JSON GLB non trovato.");
}

const jsonStart = 20;
const jsonEnd = jsonStart + jsonLength;
const document = JSON.parse(
  original.toString("utf8", jsonStart, jsonEnd).trimEnd(),
);

console.log(
  "Gemma avatar materials:",
  JSON.stringify(
    (document.materials || []).map((material, index) => ({
      index,
      name: material.name || "",
      baseColorFactor:
        material.pbrMetallicRoughness?.baseColorFactor || null,
      hasBaseColorTexture: Boolean(
        material.pbrMetallicRoughness?.baseColorTexture,
      ),
    })),
  ),
);

const hair = (document.materials || []).find((material) =>
  String(material.name || "").toLowerCase().includes("long01"),
);

if (!hair) {
  throw new Error("Materiale capelli non trovato nel GLB sorgente.");
}

hair.pbrMetallicRoughness ||= {};
delete hair.pbrMetallicRoughness.baseColorTexture;
hair.pbrMetallicRoughness.baseColorFactor = [0.86, 0.69, 0.30, 1];
hair.pbrMetallicRoughness.roughnessFactor = 0.72;
hair.pbrMetallicRoughness.metallicFactor = 0.02;

const jsonText = JSON.stringify(document);
const jsonBytes = Buffer.from(jsonText, "utf8");
const paddedJsonLength = Math.ceil(jsonBytes.length / 4) * 4;
const paddedJson = Buffer.alloc(paddedJsonLength, 0x20);
jsonBytes.copy(paddedJson);

const remainder = original.subarray(jsonEnd);
const output = Buffer.alloc(12 + 8 + paddedJsonLength + remainder.length);

original.copy(output, 0, 0, 12);
output.writeUInt32LE(output.length, 8);
output.writeUInt32LE(paddedJsonLength, 12);
output.writeUInt32LE(0x4e4f534a, 16);
paddedJson.copy(output, 20);
remainder.copy(output, 20 + paddedJsonLength);

const target = path.join(process.cwd(), "public", "models", "gemma.glb");
await fs.mkdir(path.dirname(target), { recursive: true });
await fs.writeFile(target, output);

console.log(
  "Gemma avatar prepared:",
  JSON.stringify({
    sourceBytes: original.length,
    outputBytes: output.length,
    hairMaterial: hair.name,
    blonde: true,
  }),
);
