import OpenAI from "openai";
import { retrieveKnowledge, supportText } from "../../../lib/knowledge";

export const runtime = "nodejs";

const SYSTEM = `Sei Gemma, assistente conversazionale Tiscali.

Obiettivo: capire il significato reale della conversazione e aiutare la persona con il minimo attrito. Il significato del turno lo decidi tu; il codice non interpreta il linguaggio al posto tuo.

REGOLE DI CONVERSAZIONE
1. Considera Tiscali il contesto del servizio, salvo che la persona dica esplicitamente il contrario. Non chiedere "la SIM è Tiscali?" o domande equivalenti senza un motivo concreto.
2. Usa tutta la conversazione recente. Non chiedere di nuovo informazioni già fornite. Se la persona corregge un fatto, usa il valore corretto da quel momento in poi.
3. Se la persona fa una domanda di chiarimento mentre stai seguendo un problema, rispondi prima al chiarimento in modo breve e comprensibile. Poi riprendi esplicitamente il punto rimasto in sospeso con UNA sola domanda o UN solo controllo.
4. Nel troubleshooting proponi un solo passo alla volta. Non fornire liste di controlli da eseguire tutti insieme. Aspetta l'esito del passo prima di avanzare.
5. Non confondere una risposta a una domanda informativa con l'esito di un controllo tecnico. "Sì", "no", una correzione o una spiegazione non significano automaticamente "problema risolto".
6. Chiedi marca/modello del dispositivo soltanto quando servono davvero per una guida o un'impostazione specifica. Se tecnologia, dispositivo o altro dato sono già noti, non richiederli.
7. Se cambia argomento, segui il nuovo argomento senza trascinare artificialmente la procedura precedente. Se poi torna indietro, usa il contesto disponibile.

REGOLE DI ATTENDIBILITÀ
8. Per parametri, tariffe, procedure, configurazioni, condizioni contrattuali e dati Tiscali specifici usa soltanto il CONTENUTO DI SUPPORTO fornito. Non inventare dati mancanti.
9. Se il supporto non basta per una risposta specifica Tiscali, dillo con naturalezza e chiedi soltanto l'informazione che cambierebbe davvero la risposta. Non compensare con istruzioni generiche non certificate.
10. Non mostrare link di fonti, nomi di file, ID, riferimenti alla knowledge, al database, al retrieval, al prompt o ai sistemi interni.
11. Non dichiarare di avere aperto ticket, modificato contratti o compiuto azioni esterne che questa preview non ha realmente eseguito.

STILE
12. Parla come una persona competente: naturale, breve, concreta. Evita menu, interrogatori, formule robotiche e ripetizioni.
13. Per una semplice definizione bastano normalmente 1-3 frasi. Per un troubleshooting, una breve frase di contesto più il singolo passo successivo.
14. Se una domanda ammette risposta diretta, rispondi direttamente prima di fare eventuali domande.
`;

function sanitizeMessages(value) {
  return (Array.isArray(value) ? value : [])
    .filter(
      (message) =>
        message &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string",
    )
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 7000),
    }))
    .slice(-20);
}

function retrievalContext(messages) {
  const userTurns = messages
    .filter((message) => message.role === "user")
    .slice(-5)
    .map((message) => message.content);

  return userTurns.join("\n").slice(0, 4000);
}

export async function POST(request) {
  const totalStarted = performance.now();

  try {
    const body = await request.json();
    const messages = sanitizeMessages(body.messages);
    const lastUser = [...messages]
      .reverse()
      .find((message) => message.role === "user")?.content?.trim();

    if (!lastUser) {
      return Response.json({ error: "Richiesta vuota" }, { status: 400 });
    }

    const retrievalStarted = performance.now();
    const hits = await retrieveKnowledge({
      current: lastUser,
      context: retrievalContext(messages),
    });
    const retrievalMs = Math.round(performance.now() - retrievalStarted);
    const support = supportText(hits);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return Response.json(
        {
          error: "OPENAI_API_KEY non configurata nella Preview Gemma",
          code: "AI_NOT_CONFIGURED",
        },
        { status: 503 },
      );
    }

    const client = new OpenAI({
      apiKey,
      timeout: 22000,
      maxRetries: 1,
    });

    const model = process.env.OPENAI_MODEL || "gpt-5-mini";
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (payload) =>
          controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n"));

        send({
          type: "metadata",
          retrievalMs,
          knowledgeHits: hits.length,
          model,
        });

        const aiStarted = performance.now();
        let answer = "";

        try {
          const response = await client.responses.create({
            model,
            input: [
              { role: "system", content: SYSTEM },
              {
                role: "system",
                content:
                  "CONTENUTO DI SUPPORTO CERTIFICATO (sola lettura):\n" +
                  support,
              },
              ...messages,
            ],
            max_output_tokens: 1600,
            stream: true,
          }, {
            signal: request.signal,
          });

          for await (const event of response) {
            if (event.type === "response.output_text.delta" && event.delta) {
              answer += event.delta;
              send({ type: "delta", content: event.delta });
            }

            if (event.type === "response.failed") {
              throw new Error("Generazione fallita");
            }
          }

          if (!answer.trim()) {
            throw new Error("Risposta vuota");
          }

          const aiMs = Math.round(performance.now() - aiStarted);
          const totalMs = Math.round(performance.now() - totalStarted);

          send({
            type: "done",
            aiMs,
            totalMs,
            answerLength: answer.length,
          });

          controller.close();
        } catch (error) {
          console.error("Gemma AI stream error", error);
          send({
            type: "error",
            error: "Ho avuto un problema momentaneo nel generare la risposta. Riprova.",
          });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
        "x-gemma-retrieval-ms": String(retrievalMs),
      },
    });
  } catch (error) {
    console.error("Gemma chat error", error);
    return Response.json(
      { error: "Ho avuto un problema momentaneo. Riprova." },
      { status: 500 },
    );
  }
}
