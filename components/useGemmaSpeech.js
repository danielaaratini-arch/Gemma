"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useGemmaSpeech() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const sessionRef = useRef(0);
  const queueRef = useRef([]);
  const runningRef = useRef(false);
  const audioRef = useRef(null);
  const audioUrlRef = useRef(null);
  const controllersRef = useRef(new Set());

  const releaseUrl = useCallback(() => {
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    sessionRef.current += 1;
    queueRef.current = [];
    runningRef.current = false;

    for (const controller of controllersRef.current) {
      controller.abort();
    }
    controllersRef.current.clear();

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }

    releaseUrl();
    setIsSpeaking(false);
  }, [releaseUrl]);

  const fetchAudio = useCallback(async (text, sessionId) => {
    const controller = new AbortController();
    controllersRef.current.add(controller);

    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });

      if (!response.ok) return null;
      const blob = await response.blob();

      if (controller.signal.aborted || sessionId !== sessionRef.current) {
        return null;
      }

      return blob;
    } catch {
      return null;
    } finally {
      controllersRef.current.delete(controller);
    }
  }, []);

  const playQueue = useCallback(async (sessionId) => {
    if (runningRef.current) return;
    runningRef.current = true;

    try {
      while (queueRef.current.length > 0 && sessionId === sessionRef.current) {
        const item = queueRef.current.shift();
        if (!item) continue;

        const blob = await item.audio;
        if (!blob || sessionId !== sessionRef.current) continue;

        releaseUrl();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audioUrlRef.current = url;

        await new Promise((resolve) => {
          let finished = false;

          const finish = () => {
            if (finished) return;
            finished = true;
            if (audioRef.current === audio) audioRef.current = null;
            releaseUrl();
            resolve();
          };

          audio.onplaying = () => setIsSpeaking(true);
          audio.onended = finish;
          audio.onerror = finish;
          audio.play().catch(finish);
        });
      }
    } finally {
      if (sessionId === sessionRef.current) {
        runningRef.current = false;
        setIsSpeaking(false);

        if (queueRef.current.length > 0) {
          void playQueue(sessionId);
        }
      }
    }
  }, [releaseUrl]);

  const begin = useCallback(() => {
    stop();
    return sessionRef.current;
  }, [stop]);

  const enqueue = useCallback((text) => {
    const clean = String(text || "").trim();
    if (!clean) return;

    const sessionId = sessionRef.current;
    queueRef.current.push({
      audio: fetchAudio(clean, sessionId),
    });

    void playQueue(sessionId);
  }, [fetchAudio, playQueue]);

  useEffect(() => stop, [stop]);

  return {
    isSpeaking,
    begin,
    enqueue,
    stop,
  };
}
