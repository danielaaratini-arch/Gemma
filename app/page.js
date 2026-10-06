"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import GemmaHeader from "../components/GemmaHeader";
import GemmaFooter from "../components/GemmaFooter";
import { useGemmaSpeech } from "../components/useGemmaSpeech";

const GemmaAvatar = dynamic(() => import("../components/GemmaAvatar"), {
  ssr: false,
});

const STORAGE_KEY = "gemma-preview-conversation-v2";
const CONVERSATION_KEY = "gemma-preview-conversation-id-v1";

const welcome = {
  role: "assistant",
  content: "Ciao, sono Gemma. Come posso aiutarti oggi?",
};

function restoreConversation() {
  if (typeof window === "undefined") return [welcome];

  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every(
        (message) =>
          message &&
          (message.role === "user" || message.role === "assistant") &&
          typeof message.content === "string",
      )
    ) {
      return parsed.slice(-40);
    }
  } catch {}

  return [welcome];
}

function visibleSegment(text, progress) {
  if (progress >= 1) return text;
  if (progress <= 0) return "";

  const words = text.match(/\S+\s*/g) || [];
  if (!words.length) return "";

  const target = text.length * progress;
  let elapsed = 0;
  let visibleWords = 0;

  for (const word of words) {
    if (elapsed > target) break;
    visibleWords += 1;
    elapsed += word.length;
  }

  return words
    .slice(0, visibleWords)
    .join("")
    .trimEnd();
}

let guideManifestRequest = null;

function loadGuideManifest() {
  if (!guideManifestRequest) {
    guideManifestRequest = fetch(
      "/knowledge/mobile-config/manifest.json?gemmaGuideManifest=v1",
      { cache: "no-store" },
    )
      .then((response) =>
        response.ok ? response.json() : null,
      )
      .catch(() => null)
      .finally(() => {
        guideManifestRequest = null;
      });
  }

  return guideManifestRequest;
}

function normalizeGuideText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function mergeGuideVisuals(guide, manifest) {
  if (!guide?.steps?.length) return null;

  const documents =
    Object.values(manifest?.documents || {});

  const document =
    documents.find(
      (item) =>
        String(item?.title || "").trim() ===
        String(guide.title || "").trim(),
    ) || null;

  const visualSteps =
    Array.isArray(document?.steps)
      ? document.steps
      : [];

  const byChunk = new Map(
    visualSteps
      .filter((step) => step?.chunkId)
      .map((step) => [
        String(step.chunkId),
        step,
      ]),
  );

  const steps = guide.steps.map(
    (step, index) => {
      const exact =
        byChunk.get(String(step.chunkId));

      const sameText =
        exact ||
        visualSteps.find(
          (candidate) =>
            normalizeGuideText(
              candidate?.text,
            ) ===
            normalizeGuideText(step.text),
        );

      const images = (
        Array.isArray(sameText?.images)
          ? sameText.images
          : []
      )
        .map((image) => ({
          url:
            typeof image?.url === "string"
              ? image.url
              : "",
          width:
            Math.max(
              1,
              Number(image?.width) || 1,
            ),
          height:
            Math.max(
              1,
              Number(image?.height) || 1,
            ),
          targets: (
            Array.isArray(image?.targets)
              ? image.targets
              : []
          )
            .map((target) => ({
              x: Number(target?.x),
              y: Number(target?.y),
              width:
                Number(target?.width),
              height:
                Number(target?.height),
              label:
                typeof target?.label ===
                "string"
                  ? target.label
                  : "",
            }))
            .filter(
              (target) =>
                Number.isFinite(target.x) &&
                Number.isFinite(target.y) &&
                Number.isFinite(
                  target.width,
                ) &&
                Number.isFinite(
                  target.height,
                ) &&
                target.x >= 0 &&
                target.y >= 0 &&
                target.width > 0 &&
                target.height > 0 &&
                target.x +
                  target.width <=
                  1.001 &&
                target.y +
                  target.height <=
                  1.001,
            ),
        }))
        .filter((image) => image.url);

      return {
        ...step,
        stepNumber: index + 1,
        images,
      };
    },
  );

  return {
    documentId: guide.documentId,
    title: guide.title,
    steps,
    currentStepIndex: 0,
    currentImageIndex: 0,
  };
}

function moveGuide(guide, direction) {
  if (!guide) return guide;

  let stepIndex =
    guide.currentStepIndex;
  let imageIndex =
    guide.currentImageIndex;

  if (direction > 0) {
    const currentImages =
      guide.steps[stepIndex]?.images || [];

    if (
      imageIndex <
      currentImages.length - 1
    ) {
      imageIndex += 1;
    } else if (
      stepIndex <
      guide.steps.length - 1
    ) {
      stepIndex += 1;
      imageIndex = 0;
    }
  } else if (imageIndex > 0) {
    imageIndex -= 1;
  } else if (stepIndex > 0) {
    stepIndex -= 1;
    const previousImages =
      guide.steps[stepIndex]?.images || [];

    imageIndex = Math.max(
      previousImages.length - 1,
      0,
    );
  }

  return {
    ...guide,
    currentStepIndex: stepIndex,
    currentImageIndex: imageIndex,
  };
}

export default function Home() {
  const [messages, setMessages] = useState([welcome]);
  const [hydrated, setHydrated] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [ticketOffer, setTicketOffer] = useState(null);
  const [openedTicket, setOpenedTicket] = useState(null);
  const [ticketRequestKey, setTicketRequestKey] = useState(null);
  const [notificationEmail, setNotificationEmail] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [ticketBusy, setTicketBusy] = useState(false);
  const [metrics, setMetrics] = useState(null);
  const [micSupported, setMicSupported] = useState(false);
  const [micListening, setMicListening] = useState(false);
  const [micError, setMicError] = useState("");
  const [activeGuide, setActiveGuide] = useState(null);
  const [activeVideo, setActiveVideo] = useState(null);
  const [presentationError, setPresentationError] = useState("");

  const listRef = useRef(null);
  const abortRef = useRef(null);
  const recognitionRef = useRef(null);
  const recognitionPrefixRef = useRef("");
  const {
    isSpeaking: speaking,
    begin: beginSpeech,
    enqueue: enqueueSpeech,
    stop: stopSpeech,
  } = useGemmaSpeech();

  useEffect(() => {
    setMessages(restoreConversation());
    setConversationId(localStorage.getItem(CONVERSATION_KEY));
    setHydrated(true);
    void fetch("/api/gemma/session", { cache: "no-store" });

    void fetch("/api/gemma/auth/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (data?.user?.role === "CUSTOMER" && data.user.email) {
          setNotificationEmail(data.user.email);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const Recognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!Recognition) {
      setMicSupported(false);
      return;
    }

    setMicSupported(true);

    const recognition = new Recognition();
    recognition.lang = "it-IT";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let transcript = "";

      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index][0]?.transcript || "";
      }

      const prefix = recognitionPrefixRef.current;
      const separator =
        prefix && transcript && !/\s$/.test(prefix) ? " " : "";

      setInput((prefix + separator + transcript).trimStart());
      setMicError("");
    };

    recognition.onerror = (event) => {
      setMicListening(false);

      if (event?.error === "not-allowed" || event?.error === "service-not-allowed") {
        setMicError("Consenti l’uso del microfono per parlare con Gemma.");
      } else if (event?.error !== "aborted" && event?.error !== "no-speech") {
        setMicError("Non riesco ad ascoltare in questo momento.");
      }
    };

    recognition.onend = () => {
      setMicListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      try {
        recognition.abort();
      } catch {}
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)));
    } catch {}
  }, [messages, hydrated]);

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, busy, ticketOffer, openedTicket]);

  function newConversation() {
    abortRef.current?.abort();
    try {
      recognitionRef.current?.abort();
    } catch {}
    setMicListening(false);
    setMicError("");
    stopSpeech();
    setBusy(false);
    setMetrics(null);
    setTicketOffer(null);
    setOpenedTicket(null);
    setTicketRequestKey(null);
    setNotificationEmail("");
    setActiveGuide(null);
    setActiveVideo(null);
    setPresentationError("");
    setConversationId(null);
    setMessages([welcome]);

    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(CONVERSATION_KEY);
    } catch {}
  }

  function toggleMicrophone() {
    if (!micSupported || busy) return;

    const recognition = recognitionRef.current;
    if (!recognition) return;

    if (micListening) {
      try {
        recognition.stop();
      } catch {}
      setMicListening(false);
      return;
    }

    recognitionPrefixRef.current = input.trim();
    setMicError("");

    try {
      recognition.start();
      setMicListening(true);
    } catch {
      setMicListening(false);
      setMicError("Il microfono è già in uso. Riprova.");
    }
  }

  async function openTicket() {
    if (!conversationId || ticketBusy) return;

    setTicketBusy(true);
    try {
      const response = await fetch("/api/gemma/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, requestKey: ticketRequestKey, notificationEmail }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Impossibile aprire la segnalazione.");
      }

      setOpenedTicket(data.ticket || null);
      setTicketOffer(null);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            error?.message ||
            "Non sono riuscita ad aprire la segnalazione. Riprova.",
        },
      ]);
    } finally {
      setTicketBusy(false);
    }
  }

  async function showPresentation(presentation) {
    if (!presentation?.documentId) return;

    setPresentationError("");

    if (
      presentation.type ===
      "ILLUSTRATED_GUIDE"
    ) {
      try {
        const [response, manifest] =
          await Promise.all([
            fetch("/api/gemma/guides", {
              method: "POST",
              headers: {
                "content-type":
                  "application/json",
              },
              body: JSON.stringify({
                documentId:
                  presentation.documentId,
              }),
            }),
            loadGuideManifest(),
          ]);

        const body =
          await response.json();

        if (!response.ok || !body?.guide) {
          throw new Error(
            "Guida non disponibile.",
          );
        }

        const guide =
          mergeGuideVisuals(
            body.guide,
            manifest,
          );

        if (!guide) {
          throw new Error(
            "Guida non disponibile.",
          );
        }

        setActiveVideo(null);
        setActiveGuide(guide);
      } catch {
        setPresentationError(
          "La guida illustrata non è disponibile in questo momento.",
        );
      }

      return;
    }

    if (
      presentation.type ===
      "VIDEO_GUIDE"
    ) {
      try {
        const response =
          await fetch(
            "/api/gemma/videos",
            {
              method: "POST",
              headers: {
                "content-type":
                  "application/json",
              },
              body: JSON.stringify({
                documentId:
                  presentation.documentId,
              }),
            },
          );

        const body =
          await response.json();

        if (
          !response.ok ||
          !Array.isArray(body?.guides) ||
          body.guides.length !== 1
        ) {
          throw new Error(
            "Videoguida non disponibile.",
          );
        }

        setActiveGuide(null);
        setActiveVideo(body.guides[0]);
      } catch {
        setPresentationError(
          "La videoguida non è disponibile in questo momento.",
        );
      }
    }
  }

  function navigateGuide(direction) {
    if (!activeGuide) return;

    const next =
      moveGuide(activeGuide, direction);

    if (
      next.currentStepIndex !==
      activeGuide.currentStepIndex
    ) {
      const text =
        next.steps[
          next.currentStepIndex
        ]?.text;

      if (text) {
        beginSpeech();
        enqueueSpeech(text);
      }
    }

    setActiveGuide(next);
  }

  async function submit(event) {
    event.preventDefault();
    const question = input.trim();
    if (!question || busy) return;

    if (micListening) {
      try {
        recognitionRef.current?.stop();
      } catch {}
      setMicListening(false);
    }

    beginSpeech();
    setActiveGuide(null);
    setActiveVideo(null);
    setPresentationError("");
    setTicketOffer(null);
    setOpenedTicket(null);

    const context = [
      ...messages,
      {
        role: "user",
        content: question,
      },
    ].slice(-40);

    setMessages([
      ...context,
      {
        role: "assistant",
        content: "",
      },
    ]);

    setInput("");
    setBusy(true);
    setMetrics(null);

    const controller =
      new AbortController();

    abortRef.current = controller;

    let speechHandoff = false;

    try {
      const response = await fetch(
        "/api/chat",
        {
          method: "POST",
          headers: {
            "content-type":
              "application/json",
          },
          body: JSON.stringify({
            messages: context,
            conversationId,
          }),
          signal: controller.signal,
        },
      );

      if (
        !response.ok ||
        !response.body
      ) {
        const payload =
          await response
            .json()
            .catch(() => ({}));

        throw new Error(
          payload.error || "Errore",
        );
      }

      const reader =
        response.body.getReader();

      const decoder =
        new TextDecoder();

      let buffer = "";
      let answer = "";
      let selectedPresentation = null;

      while (true) {
        const { value, done } =
          await reader.read();

        if (done) break;

        buffer += decoder.decode(
          value,
          { stream: true },
        );

        const lines =
          buffer.split("\n");

        buffer =
          lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;

          const streamEvent =
            JSON.parse(line);

          if (
            streamEvent.type ===
            "metadata"
          ) {
            setMetrics(
              (current) => ({
                ...(current || {}),
                ...streamEvent,
              }),
            );

            if (
              streamEvent.conversationId
            ) {
              setConversationId(
                streamEvent.conversationId,
              );

              localStorage.setItem(
                CONVERSATION_KEY,
                streamEvent.conversationId,
              );
            }
          }

          if (
            streamEvent.type ===
            "delta"
          ) {
            answer += String(
              streamEvent.content || "",
            );
          }

          if (
            streamEvent.type ===
            "done"
          ) {
            setMetrics(
              (current) => ({
                ...(current || {}),
                ...streamEvent,
              }),
            );

            selectedPresentation =
              streamEvent.presentation ||
              null;

            if (
              streamEvent.conversationId
            ) {
              setConversationId(
                streamEvent.conversationId,
              );

              localStorage.setItem(
                CONVERSATION_KEY,
                streamEvent.conversationId,
              );
            }

            if (
              streamEvent.ticket
                ?.ticketRecommended
            ) {
              setTicketOffer(
                streamEvent.ticket,
              );

              setTicketRequestKey(
                typeof crypto !==
                  "undefined" &&
                  crypto.randomUUID
                  ? crypto.randomUUID()
                  : String(Date.now()) +
                      "-" +
                      Math.random()
                        .toString(36)
                        .slice(2),
              );
            }
          }

          if (
            streamEvent.type ===
            "error"
          ) {
            throw new Error(
              streamEvent.error ||
                "Errore",
            );
          }
        }
      }

      const finalAnswer =
        answer.trim();

      if (!finalAnswer) {
        throw new Error(
          "Risposta vuota",
        );
      }

      speechHandoff = true;

      enqueueSpeech(
        finalAnswer,
        {
          onStart: () => {
            setBusy(false);
          },
          onProgress: (
            progress,
          ) => {
            setMessages(
              (current) => {
                const next =
                  [...current];

                next[
                  next.length - 1
                ] = {
                  role:
                    "assistant",
                  content:
                    visibleSegment(
                      finalAnswer,
                      progress,
                    ),
                };

                return next;
              },
            );
          },
          onEnd: () => {
            setMessages(
              (current) => {
                const next =
                  [...current];

                next[
                  next.length - 1
                ] = {
                  role:
                    "assistant",
                  content:
                    finalAnswer,
                };

                return next;
              },
            );

            setBusy(false);

            if (
              selectedPresentation
            ) {
              void showPresentation(
                selectedPresentation,
              );
            }
          },
        },
      );
    } catch (error) {
      if (
        error?.name ===
        "AbortError"
      ) {
        return;
      }

      stopSpeech();
      setBusy(false);

      setMessages(
        (current) => {
          const next =
            [...current];

          next[
            next.length - 1
          ] = {
            role: "assistant",
            content:
              error?.message ||
              "Ho avuto un problema momentaneo nel generare la risposta. Riprova.",
          };

          return next;
        },
      );
    } finally {
      abortRef.current = null;

      if (!speechHandoff) {
        setBusy(false);
      }
    }
  }

  const status = speaking ? "speaking" : busy ? "thinking" : "idle";

  return (
    <main className="gemmaPublicPage">
      <GemmaHeader />

      <section className="gemmaHeroSection">
        <div className="gemmaHeroContainer">
          <div className="gemmaPresentation">
            <p className="gemmaEyebrow">Tiscali Assistant AI Platform</p>

            <h1 className="gemmaHeroTitle">
              Gemma, il nuovo volto{" "}
              <br />
              dell&apos;assistenza <span>Tiscali.</span>
            </h1>

            <p className="gemmaHeroDescription">
              Un assistente conversazionale che comprende il contesto,
              consulta la knowledge Tiscali e accompagna il cliente fino
              all&apos;eventuale apertura della segnalazione.
            </p>

            <div className="gemmaHeroActions">
              <Link href="/cliente" className="gemmaSecondaryButton">
                Area cliente
              </Link>
            </div>

            <p className="gemmaHeroCredit">
              Progettato per Tiscali con identità Smeraldo.
            </p>
          </div>

          <div className="gemmaAssistantPanel">
            <div className="gemmaPanelHeader">
              <div className="gemmaIdentity">
                <strong>Gemma</strong>
                <span>Assistente virtuale Tiscali</span>
              </div>

              <div className="gemmaStatus">
                <span
                  className={
                    busy
                      ? "gemmaStatusDot gemmaStatusThinking"
                      : "gemmaStatusDot"
                  }
                />
                <span>
                  {busy
                    ? "Gemma sta pensando"
                    : speaking
                      ? "Gemma sta parlando"
                      : "Gemma Online"}
                </span>
              </div>
            </div>

            <div className="gemmaAvatarArea">
              {activeGuide ? (
                <div className="gemmaGuideStage">
                  <div className="gemmaGuideHeader">
                    <strong>{activeGuide.title}</strong>
                    <button
                      type="button"
                      onClick={() => {
                        stopSpeech();
                        setActiveGuide(null);
                      }}
                    >
                      Chiudi
                    </button>
                  </div>

                  {(() => {
                    const step =
                      activeGuide.steps[
                        activeGuide.currentStepIndex
                      ];

                    const images =
                      step?.images || [];

                    const image =
                      images[
                        activeGuide.currentImageIndex
                      ] || null;

                    return (
                      <div className="gemmaGuideBody">
                        <div className="gemmaGuideProgress">
                          Passaggio{" "}
                          {activeGuide.currentStepIndex + 1}
                          {" / "}
                          {activeGuide.steps.length}
                        </div>

                        {image ? (
                          <div
                            className="gemmaGuideImageFrame"
                            style={{
                              aspectRatio:
                                image.width +
                                " / " +
                                image.height,
                            }}
                          >
                            <img
                              className="gemmaGuideImage"
                              src={image.url}
                              alt=""
                            />

                            {image.targets.map(
                              (target, index) => (
                                <div
                                  key={index}
                                  className="gemmaGuideTarget"
                                  style={{
                                    left:
                                      target.x *
                                        100 +
                                      "%",
                                    top:
                                      target.y *
                                        100 +
                                      "%",
                                    width:
                                      target.width *
                                        100 +
                                      "%",
                                    height:
                                      target.height *
                                        100 +
                                      "%",
                                  }}
                                >
                                  {target.label ? (
                                    <span>
                                      {target.label}
                                    </span>
                                  ) : null}
                                </div>
                              ),
                            )}
                          </div>
                        ) : null}

                        <p className="gemmaGuideText">
                          {step?.text || ""}
                        </p>

                        <div className="gemmaGuideControls">
                          <button
                            type="button"
                            onClick={() =>
                              navigateGuide(-1)
                            }
                            disabled={
                              activeGuide.currentStepIndex === 0 &&
                              activeGuide.currentImageIndex === 0
                            }
                          >
                            Indietro
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              navigateGuide(1)
                            }
                            disabled={
                              activeGuide.currentStepIndex ===
                                activeGuide.steps.length - 1 &&
                              activeGuide.currentImageIndex >=
                                Math.max(
                                  (activeGuide.steps[
                                    activeGuide.currentStepIndex
                                  ]?.images?.length || 1) - 1,
                                  0,
                                )
                            }
                          >
                            Avanti
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ) : activeVideo ? (
                <div className="gemmaVideoStage">
                  <div className="gemmaGuideHeader">
                    <strong>{activeVideo.title}</strong>
                    <button
                      type="button"
                      onClick={() =>
                        setActiveVideo(null)
                      }
                    >
                      Chiudi
                    </button>
                  </div>

                  {activeVideo.provider === "file" ? (
                    <video
                      controls
                      playsInline
                      preload="none"
                      src={activeVideo.embedUrl}
                    />
                  ) : (
                    <iframe
                      src={activeVideo.embedUrl}
                      title={activeVideo.title}
                      sandbox="allow-scripts allow-same-origin allow-presentation"
                      allow="encrypted-media; picture-in-picture; fullscreen"
                      allowFullScreen
                      referrerPolicy="strict-origin-when-cross-origin"
                    />
                  )}
                </div>
              ) : (
                <div className="gemmaAvatarPosition">
                  <GemmaAvatar status={status} />
                </div>
              )}

              {presentationError ? (
                <div className="gemmaPresentationError">
                  {presentationError}
                </div>
              ) : null}
            </div>

            <div className="gemmaChatArea">
              <div className="gemmaMessages" ref={listRef}>
                {messages.map((message, index) => (
                  <div key={index} className={"gemmaMessage " + message.role}>
                    {message.content ||
                      (busy && index === messages.length - 1
                        ? "Sto verificando il contesto…"
                        : "")}
                  </div>
                ))}

                {ticketOffer && !openedTicket && (
                  <div className="ticketOffer">
                    <div>
                      <strong>Vuoi aprire una segnalazione?</strong>
                      <span>
                        Il riepilogo raccolto da Gemma verrà passato al reparto{" "}
                        {ticketOffer.department || "competente"}.
                      </span>
                      {ticketOffer.summary ? (
                        <details className="ticketOfferSummary">
                          <summary>Riepilogo della segnalazione</summary>
                          <pre>{ticketOffer.summary}</pre>
                        </details>
                      ) : null}
                    </div>
                    <div className="ticketOfferActions">
                      <input
                        type="email"
                        value={notificationEmail}
                        onChange={(event) => setNotificationEmail(event.target.value)}
                        placeholder="Email per le notifiche"
                        aria-label="Email per le notifiche del ticket"
                      />
                      <button
                        onClick={openTicket}
                        disabled={ticketBusy || !notificationEmail.includes("@")}
                      >
                        {ticketBusy ? "Apertura…" : "Apri segnalazione"}
                      </button>
                    </div>
                  </div>
                )}

                {openedTicket && (
                  <div className="ticketOpened">
                    <div>
                      <strong>Segnalazione #{openedTicket.number} aperta</strong>
                      <span>
                        Puoi seguirla e rispondere dal tuo spazio cliente.
                      </span>
                    </div>
                    <Link href="/cliente">Vai all’area cliente</Link>
                  </div>
                )}
              </div>

              <div className="gemmaComposerWrap">
                <form className="gemmaComposer" onSubmit={submit}>
                  {micSupported && (
                    <button
                      type="button"
                      className={
                        micListening
                          ? "gemmaMicButton listening"
                          : "gemmaMicButton"
                      }
                      onClick={toggleMicrophone}
                      disabled={busy}
                      aria-label={
                        micListening
                          ? "Ferma ascolto"
                          : "Parla con Gemma"
                      }
                      title={
                        micListening
                          ? "Ferma ascolto"
                          : "Parla con Gemma"
                      }
                    >
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="9" y="2" width="6" height="12" rx="3" />
                        <path d="M5 10a7 7 0 0 0 14 0" />
                        <path d="M12 17v5" />
                        <path d="M8 22h8" />
                      </svg>
                    </button>
                  )}

                  <input
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder={
                      micListening
                        ? "Ti ascolto…"
                        : "Scrivi o parla con Gemma…"
                    }
                    autoComplete="off"
                    aria-label="Messaggio per Gemma"
                  />

                  <button
                    className="gemmaSendButton"
                    disabled={busy || !input.trim()}
                  >
                    Invia
                  </button>
                </form>

                {micError ? (
                  <div className="gemmaMicError">{micError}</div>
                ) : null}

                <div className="gemmaComposerMeta">
                  <div>
                    {metrics?.totalMs
                      ? metrics.totalMs + " ms"
                      : "Preview Gemma"}
                  </div>
                  <div className="gemmaComposerActions">
                    {speaking && (
                      <button type="button" onClick={stopSpeech}>
                        Ferma voce
                      </button>
                    )}
                    <button type="button" onClick={newConversation}>
                      Nuova chat
                    </button>
                    <Link href="/cliente">Area cliente</Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="gemmaQuickLinks">
        <div>
          <strong>Area cliente</strong>
          <span>Consulta ticket e messaggi del backoffice.</span>
          <Link href="/cliente">Apri area cliente</Link>
        </div>
        <div>
          <strong>Backoffice</strong>
          <span>Gestisci code, note, stati e risposte.</span>
          <Link href="/backoffice">Apri backoffice</Link>
        </div>
        <div>
          <strong>Admin</strong>
          <span>Controlla performance, ticket e piattaforma.</span>
          <Link href="/admin">Apri admin</Link>
        </div>
      </section>

      <GemmaFooter />
    </main>
  );
}
