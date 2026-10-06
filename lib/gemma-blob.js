import { del, get, put } from "@vercel/blob";

const BLOB_PREFIX = "gemma-ticket-uploads";
const POINTER_PREFIX = "GEMMA_BLOB_V1:";

export function gemmaBlobConfigured() {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN?.trim() ||
      process.env.BLOB_STORE_ID?.trim(),
  );
}

function blobPath(ticketId, attachmentId) {
  return [
    BLOB_PREFIX,
    String(ticketId || "ticket").replace(/[^a-zA-Z0-9_-]/g, "_"),
    String(attachmentId || "attachment").replace(/[^a-zA-Z0-9_-]/g, "_"),
  ].join("/");
}

export async function saveGemmaBlob({
  ticketId,
  attachmentId,
  buffer,
  contentType,
}) {
  const pathname = blobPath(ticketId, attachmentId);

  await put(pathname, buffer, {
    access: "private",
    addRandomSuffix: false,
    contentType: contentType || "application/octet-stream",
  });

  return {
    pathname,
    pointer: Buffer.from(POINTER_PREFIX + pathname, "utf8"),
  };
}

export function parseGemmaBlobPointer(content) {
  if (!content) return null;

  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const text = buffer.toString("utf8");

  return text.startsWith(POINTER_PREFIX)
    ? text.slice(POINTER_PREFIX.length)
    : null;
}

export async function readGemmaBlob(pathname) {
  const result = await get(pathname, {
    access: "private",
    useCache: false,
  });

  if (!result || result.statusCode !== 200) {
    throw new Error("Allegato Blob non trovato.");
  }

  const arrayBuffer = await new Response(result.stream).arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function deleteGemmaBlob(pathname) {
  if (!pathname) return;
  await del(pathname);
}
