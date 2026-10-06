import postgres from "postgres";

const cache = globalThis;

function integerEnv(name, fallback, min = 1, max = 20) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function createClient(max) {
  const url = process.env.DATABASE_URL;
  if (!url) return null;

  return postgres(url, {
    max,
    idle_timeout: 20,
    connect_timeout: 5,
    max_lifetime: 60 * 20,
    prepare: false,
  });
}

export function knowledgeDb() {
  if (!cache.__gemmaKnowledgeDb) {
    cache.__gemmaKnowledgeDb = createClient(
      integerEnv("GEMMA_DB_READ_POOL", 2, 1, 8),
    );
  }
  return cache.__gemmaKnowledgeDb;
}

export function operationalDb() {
  if (!cache.__gemmaOperationalDb) {
    cache.__gemmaOperationalDb = createClient(
      integerEnv("GEMMA_DB_WRITE_POOL", 2, 1, 8),
    );
  }
  return cache.__gemmaOperationalDb;
}

export function databaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}
