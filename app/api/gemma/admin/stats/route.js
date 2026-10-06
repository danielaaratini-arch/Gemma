import { adminStats } from "../../../../../lib/gemma-store";

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json(await adminStats());
  } catch (error) {
    console.error("Gemma admin stats error", error);
    return Response.json({ error: "Statistiche non disponibili." }, { status: 500 });
  }
}
