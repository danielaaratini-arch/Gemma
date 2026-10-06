import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const knowledge = read("lib/knowledge.js");
const chat = read("app/api/chat/route.js");
const tree = fs
  .readdirSync("app/api", { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const failures = [];

if (!knowledge.includes('sql.begin("read only"')) {
  failures.push("Il retrieval DB non forza una transazione read-only.");
}

for (const verb of ["INSERT INTO", "UPDATE ", "DELETE FROM", "CREATE TABLE", "ALTER TABLE", "DROP TABLE"]) {
  if (knowledge.toUpperCase().includes(verb)) {
    failures.push("Operazione DB di scrittura rilevata: " + verb.trim());
  }
}

if (!chat.includes("Nel troubleshooting proponi un solo passo alla volta")) {
  failures.push("Manca il guardrail one-step-at-a-time.");
}

if (!chat.includes("rispondi prima al chiarimento")) {
  failures.push("Manca il guardrail chiarimento-prima-ripresa.");
}

if (tree.some((name) => ["ticket", "admin", "knowledge-write"].includes(name))) {
  failures.push("Endpoint di scrittura inatteso.");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Gemma architecture guard: OK");
