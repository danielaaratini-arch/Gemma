import * as cheerio from "cheerio";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

const MAX_KNOWLEDGE_FILE_SIZE = 10 * 1024 * 1024;
const SUPPORTED = new Set(["pdf", "docx", "txt", "html", "htm"]);

function extension(name) {
  const value = String(name || "").toLowerCase();
  const index = value.lastIndexOf(".");
  return index >= 0 ? value.slice(index + 1) : "";
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function titleFromFileName(name) {
  return String(name || "Documento Knowledge")
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || "Documento Knowledge";
}

export async function parseKnowledgeUpload(file) {
  if (!(file instanceof File)) {
    throw new Error("Nessun file selezionato.");
  }

  if (!file.size) {
    throw new Error("Il file selezionato è vuoto.");
  }

  if (file.size > MAX_KNOWLEDGE_FILE_SIZE) {
    throw new Error("Il file supera il limite di 10 MB.");
  }

  const ext = extension(file.name);
  if (!SUPPORTED.has(ext)) {
    throw new Error("Per la Knowledge usa PDF, DOCX, TXT oppure HTML.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let text = "";

  if (ext === "pdf") {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      text = result.text;
    } finally {
      await parser.destroy();
    }
  } else if (ext === "docx") {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else if (ext === "html" || ext === "htm") {
    const $ = cheerio.load(buffer.toString("utf8"));
    $("script,style,noscript,svg,canvas,iframe,form").remove();
    $("h1,h2,h3,h4,h5,h6,p,li,dt,dd,tr,br").each((_, element) => {
      $(element).append("\n");
    });
    text = $("body").text();
  } else {
    text = buffer.toString("utf8");
  }

  text = normalizeText(text);
  if (!text) {
    throw new Error("Il documento non contiene testo estraibile.");
  }

  return {
    title: titleFromFileName(file.name),
    content: text.slice(0, 200000),
    fileName: String(file.name || "").slice(0, 255),
    fileSize: file.size,
    fileType: file.type || "application/octet-stream",
  };
}
