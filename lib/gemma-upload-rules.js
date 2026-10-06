export const MAX_FILES_PER_UPLOAD = 5;
export const MAX_FILE_SIZE = 5 * 1024 * 1024;
export const MAX_TOTAL_TICKET_SIZE = 10 * 1024 * 1024;

export const ALLOWED_EXTENSIONS = [
  ".pdf", ".txt", ".rtf", ".csv", ".doc", ".docx", ".xls", ".xlsx",
  ".ppt", ".pptx", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic",
  ".heif", ".bmp", ".tif", ".tiff", ".mp3", ".m4a", ".aac", ".wav",
  ".ogg", ".oga", ".webm", ".amr", ".mp4", ".mov", ".m4v", ".3gp",
  ".3g2", ".mpeg", ".mpg", ".avi", ".mkv",
];

const EXTENSIONS = new Set(ALLOWED_EXTENSIONS);

export function fileExtension(name) {
  const value = String(name || "");
  const index = value.lastIndexOf(".");
  return index >= 0 ? value.slice(index).toLowerCase() : "";
}

export function validateAttachment(file) {
  if (!file || typeof file.name !== "string") return "File non valido.";
  if (!EXTENSIONS.has(fileExtension(file.name))) {
    return "Formato non consentito: " + file.name;
  }
  if (file.size > MAX_FILE_SIZE) {
    return "Il file supera il limite di 5 MB: " + file.name;
  }
  return null;
}

export function acceptedFiles() {
  return ALLOWED_EXTENSIONS.join(",");
}
