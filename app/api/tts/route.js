import OpenAI from "openai";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json();
    const text = typeof body?.text === "string" ? body.text.trim().slice(0, 1000) : "";

    if (!text) {
      return Response.json({ error: "Testo mancante." }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "Voce non configurata." }, { status: 503 });
    }

    const client = new OpenAI({ apiKey, timeout: 20000, maxRetries: 1 });
    const audio = await client.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "nova",
      input: text,
      response_format: "mp3",
      speed: 0.97,
      instructions: "Parla in italiano con voce femminile adulta, naturale, calda e professionale. Pronuncia solo il testo ricevuto, senza aggiungere contenuti. Le domande devono avere intonazione naturale e le istruzioni operative devono essere brevi e chiare."
    }, { signal: request.signal });

    return new Response(audio.body, {
      headers: {
        "content-type": "audio/mpeg",
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      return new Response(null, { status: 499 });
    }
    console.error("Gemma TTS error", error);
    return Response.json({ error: "Voce temporaneamente non disponibile." }, { status: 500 });
  }
}
