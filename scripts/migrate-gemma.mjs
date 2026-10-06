process.env.GEMMA_AUTO_MIGRATE = "true";

const { ensureGemmaSchema } = await import("../lib/gemma-store.js");
const { migrateKnowledgeSyncSchema } = await import("../lib/gemma-knowledge-sync.js");

await ensureGemmaSchema();
await migrateKnowledgeSyncSchema();

console.log("Gemma schema migration completed.");
