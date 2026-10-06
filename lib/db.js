import postgres from "postgres";

const cache = globalThis;

function databaseUrlInfo() {
  const value = String(process.env.DATABASE_URL || "").trim();
  if (!value) {
    return { configured: false, mode: "unconfigured" };
  }

  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const pooled =
      /(^|[.-])(pooler|pgbouncer|proxy)([.-]|$)/.test(host) ||
      host.includes("-pooler.") ||
      host.includes(".pooler.");

    return {
      configured: true,
      mode: pooled ? "pooled" : "direct-or-unknown",
    };
  } catch {
    return { configured: true, mode: "unknown" };
  }
}

export function databaseConnectionProfile() {
  const info = databaseUrlInfo();
  return {
    ...info,
    productionConservativeMode:
      process.env.VERCEL_ENV === "production" && info.mode !== "pooled",
  };
}

function defaultPoolSize() {
  const profile = databaseConnectionProfile();
  return profile.productionConservativeMode ? 1 : 2;
}

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
      integerEnv("GEMMA_DB_READ_POOL", defaultPoolSize(), 1, 8),
    );
  }
  return cache.__gemmaKnowledgeDb;
}

export function operationalDb() {
  if (!cache.__gemmaOperationalDb) {
    cache.__gemmaOperationalDb = createClient(
      integerEnv("GEMMA_DB_WRITE_POOL", defaultPoolSize(), 1, 8),
    );
  }
  return cache.__gemmaOperationalDb;
}

export function databaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}
