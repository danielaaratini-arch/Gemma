import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL non configurata.");

const sql = postgres(url, {
  max: 1,
  prepare: false,
  connect_timeout: 8,
});

try {
  await sql.unsafe("DROP SCHEMA IF EXISTS gemma CASCADE");

  const rows = await sql.unsafe(
    "SELECT schema_name FROM information_schema.schemata WHERE schema_name='gemma'",
  );

  if (rows.length > 0) {
    throw new Error("Lo schema gemma risulta ancora presente.");
  }

  console.log("GEMMA_SCHEMA_DROPPED_AND_VERIFIED");
} finally {
  await sql.end({ timeout: 5 });
}
