export const runtime = "nodejs";

export async function GET() {
  const response = await fetch("https://taap-alda.vercel.app/models/alda.glb", {
    next: { revalidate: 86400 },
  });

  if (!response.ok) {
    return Response.json({ error: "Avatar non disponibile" }, { status: 502 });
  }

  return new Response(await response.arrayBuffer(), {
    headers: {
      "content-type": "model/gltf-binary",
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
