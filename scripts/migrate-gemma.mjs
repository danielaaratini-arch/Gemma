process.env.GEMMA_AUTO_MIGRATE = "true";

const { ensureGemmaSchema } = await import("../lib/gemma-store.js");

await ensureGemmaSchema();
console.log("Gemma schema migration completed.");
