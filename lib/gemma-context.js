import { operationalDb } from "./db";
import { ensureGemmaSchema } from "./gemma-store";

export async function retrieveGemmaOperationalContext(customerKey) {
  await ensureGemmaSchema();
  const sql = operationalDb();
  if (!sql) {
    return {
      faults: [],
      memory: [],
    };
  }

  const [faults, memory] = await Promise.all([
    sql.unsafe(
      "SELECT id,service,fault_type,city,match_description,message,updated_at FROM gemma.service_fault WHERE active=true ORDER BY updated_at DESC LIMIT 30",
    ),
    customerKey
      ? sql.unsafe(
          "SELECT id,value,source,updated_at FROM gemma.customer_memory WHERE customer_key=$1 ORDER BY updated_at DESC LIMIT 20",
          [String(customerKey)],
        )
      : Promise.resolve([]),
  ]);

  return { faults, memory };
}

export function operationalContextText(context) {
  const faults = Array.isArray(context?.faults) ? context.faults : [];
  const memory = Array.isArray(context?.memory) ? context.memory : [];
  const blocks = [];

  if (faults.length) {
    blocks.push(
      [
        "ALERT DI SERVIZIO ATTIVI:",
        ...faults.map((item) =>
          [
            "- servizio=" + item.service,
            "tipo=" + item.fault_type,
            item.city ? "città=" + item.city : null,
            "quando è pertinente=" + item.match_description,
            "messaggio=" + item.message,
          ].filter(Boolean).join(" | "),
        ),
        "Usa un alert solo se è semanticamente pertinente al problema e al contesto del cliente. Non fare matching per parole isolate.",
      ].join("\n"),
    );
  }

  if (memory.length) {
    blocks.push(
      [
        "MEMORIA CLIENTE DISPONIBILE:",
        ...memory.map((item) => "- " + item.value),
        "Usa queste informazioni solo quando sono pertinenti alla richiesta corrente e non ripeterle gratuitamente.",
      ].join("\n"),
    );
  }

  return blocks.length
    ? blocks.join("\n\n")
    : "Nessun alert attivo o memoria cliente pertinente disponibile.";
}
