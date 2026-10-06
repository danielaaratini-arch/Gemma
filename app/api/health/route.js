export async function GET() {
  return Response.json({
    ok: true,
    app: "Gemma",
    environment: process.env.VERCEL_ENV || "local",
    aiConfigured: Boolean(process.env.OPENAI_API_KEY),
    dbConfigured: Boolean(process.env.DATABASE_URL),
    writeMode: "disabled",
  });
}
