function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function fact(state, key) {
  return (state?.facts || []).find((item) => item.key === key)?.value || null;
}

function saleFlowActive(state) {
  return (
    state?.department === "VENDITE" &&
    String(state?.pending || "").startsWith("SALES:")
  );
}

function explicitSalesRequest(value) {
  const text = normalize(value);
  if (!text) return false;

  const informationalPrice =
    /\b(?:quanto costa|costo|tariffa|roaming|quanto pago|piano tariffario)\b/.test(text);
  const explicitPurchase =
    /\b(?:voglio|vorrei|desidero|intendo|posso|come|dove)\b.{0,45}\b(?:acquist\w*|compr\w*|sottoscriv\w*|attivare un nuovo|fare un nuovo)\b/.test(text);
  const offerRequest =
    /\b(?:voglio|vorrei|desidero|cerco|mi interessa|quali|che)\b.{0,45}\b(?:offert\w*|promozion\w*|nuov\w* abbonament\w*)\b/.test(text) ||
    /\b(?:offert\w*|promozion\w*|nuov\w* abbonament\w*)\b.{0,45}\b(?:voglio|vorrei|desidero|cerco|mi interessa)\b/.test(text);

  if (
    informationalPrice &&
    !explicitPurchase &&
    !/\bnuov\w* offert\w*\b/.test(text)
  ) {
    return false;
  }

  return explicitPurchase || offerRequest;
}

function inferService(value, previous) {
  const text = normalize(value);
  const mobile = /\b(?:mobile|sim|esim|cellulare)\b/.test(text);
  const fixed =
    /\b(?:fisso|fissa|fibra|ftth|fttc|adsl|internet casa|linea casa)\b/.test(text);

  if (mobile && !fixed) return "MOBILE";
  if (fixed && !mobile) return "FIXED";
  return previous || null;
}

function inferCustomerType(value, previous) {
  const text = normalize(value);

  if (
    /\b(?:azienda|business|partita iva|p\.?\s*iva|impresa|professionista)\b/.test(text)
  ) {
    return "BUSINESS";
  }

  if (/\b(?:privato|casa|famiglia|residenziale)\b/.test(text)) {
    return "PRIVATE";
  }

  return previous || null;
}

function salesState(service, customerType, pending, answer) {
  const facts = [];

  if (service) {
    facts.push({
      key: "salesService",
      label: "Servizio richiesto",
      value: service === "FIXED" ? "Fisso/Fibra" : "Mobile",
    });
  }

  if (customerType) {
    facts.push({
      key: "salesCustomerType",
      label: "Tipo cliente",
      value: customerType === "BUSINESS" ? "Azienda" : "Privato",
    });
  }

  return {
    issue: "Richiesta di nuova offerta Tiscali",
    service: "COMMERCIAL",
    department: "VENDITE",
    facts,
    checks: [],
    pending,
    outcome: pending ? null : answer,
    resolved: !pending,
    ticketRecommended: false,
  };
}

export function routeSalesTurn(value, previousState) {
  const active = saleFlowActive(previousState);
  if (!active && !explicitSalesRequest(value)) return null;

  const previousService =
    fact(previousState, "salesService") === "Fisso/Fibra"
      ? "FIXED"
      : fact(previousState, "salesService") === "Mobile"
        ? "MOBILE"
        : null;

  const previousCustomer =
    fact(previousState, "salesCustomerType") === "Azienda"
      ? "BUSINESS"
      : fact(previousState, "salesCustomerType") === "Privato"
        ? "PRIVATE"
        : null;

  const service = inferService(value, previousService);
  const customerType = inferCustomerType(value, previousCustomer);

  if (!service && !customerType) {
    const answer =
      "Certo. Ti interessa una nuova offerta Mobile oppure Fisso/Fibra, e si tratta di un Privato o di un’Azienda?";
    return {
      answer,
      state: salesState(
        null,
        null,
        "SALES:service+customerType",
        answer,
      ),
    };
  }

  if (!service) {
    const answer = "Ti interessa una nuova offerta Mobile oppure Fisso/Fibra?";
    return {
      answer,
      state: salesState(null, customerType, "SALES:service", answer),
    };
  }

  if (!customerType) {
    const label = service === "FIXED" ? "Fisso/Fibra" : "Mobile";
    const answer =
      "Per la nuova offerta " +
      label +
      ", si tratta di un Privato o di un’Azienda?";
    return {
      answer,
      state: salesState(service, null, "SALES:customerType", answer),
    };
  }

  const label = service === "FIXED" ? "Fisso/Fibra" : "Mobile";
  const answer =
    customerType === "BUSINESS"
      ? "Per una nuova offerta " +
        label +
        " Aziende puoi procedere tramite il canale Tiscali Business oppure chiamare il 192130. Non serve aprire un ticket di assistenza."
      : "Per una nuova offerta " +
        label +
        " Privati puoi procedere online, chiamare il 130 oppure rivolgerti a un Centro Tiscali. Non serve aprire un ticket di assistenza.";

  return {
    answer,
    state: salesState(service, customerType, null, answer),
  };
}
