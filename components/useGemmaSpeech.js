"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  resetGemmaAudioLevel,
  setGemmaAudioLevel,
} from "./gemmaAudioLevel";

const ANALYSER_FFT_SIZE = 1024;
const AUDIO_NOISE_FLOOR = 0.004;
const AUDIO_REFERENCE_LEVEL = 0.15;
const AUDIO_ATTACK = 0.42;
const AUDIO_RELEASE = 0.12;

function cleanSpeechText(text) {
  return String(text || "")
    .replace(/\`\`\`[\s\S]*?\`\`\`/g, " codice omesso ")
    .replace(/\`([^\`]+)\`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(^|\n)\s{0,3}#{1,6}\s+/g, "$1")
    .replace(/[*_>|~]/g, "")
    .replace(/\s*—\s*/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCallbacks(options) {
  if (typeof options === "function") return { onEnd: options };
  return options || {};
}

export function useGemmaSpeech() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const sessionRef = useRef(0);
  const queueRef = useRef([]);
  const runningRef = useRef(false);
  const audioRef = useRef(null);
  const audioUrlRef = useRef(null);
  const controllersRef = useRef(new Set());
  const prefetchedRef = useRef(new Map());

  const audioContextRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const analyserRef = useRef(null);
  const analysisFrameRef = useRef(null);
  const samplesRef = useRef(null);
  const smoothedLevelRef = useRef(0);

  const releaseUrl = useCallback(() => {
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  const stopAudioAnalysis = useCallback(() => {
    if (analysisFrameRef.current !== null) {
      cancelAnimationFrame(analysisFrameRef.current);
      analysisFrameRef.current = null;
    }

    sourceNodeRef.current?.disconnect();
    analyserRef.current?.disconnect();
    sourceNodeRef.current = null;
    analyserRef.current = null;
    samplesRef.current = null;
    smoothedLevelRef.current = 0;
    resetGemmaAudioLevel();
  }, []);

  const closeAudioContext = useCallback(() => {
    const context = audioContextRef.current;
    audioContextRef.current = null;

    if (context && context.state !== "closed") {
      void context.close();
    }
  }, []);

  const startAudioAnalysis = useCallback(
    async (audio) => {
      stopAudioAnalysis();

      const AudioContextConstructor =
        window.AudioContext || window.webkitAudioContext;

      if (!AudioContextConstructor) return;

      let context = audioContextRef.current;

      if (!context || context.state === "closed") {
        context = new AudioContextConstructor();
        audioContextRef.current = context;
      }

      const source = context.createMediaElementSource(audio);
      const analyser = context.createAnalyser();

      analyser.fftSize = ANALYSER_FFT_SIZE;
      analyser.smoothingTimeConstant = 0.55;

      source.connect(analyser);
      analyser.connect(context.destination);

      sourceNodeRef.current = source;
      analyserRef.current = analyser;
      samplesRef.current = new Float32Array(analyser.fftSize);

      if (context.state === "suspended") {
        await context.resume();
      }

      let lastSignalAt = performance.now();
      let lastPlaybackTime = audio.currentTime;

      const analyse = () => {
        const activeAnalyser = analyserRef.current;
        const samples = samplesRef.current;

        if (!activeAnalyser || !samples) return;

        activeAnalyser.getFloatTimeDomainData(samples);

        let sum = 0;
        for (let index = 0; index < samples.length; index += 1) {
          const sample = samples[index] || 0;
          sum += sample * sample;
        }

        const rms = Math.sqrt(sum / samples.length);
        const normalized = Math.min(
          Math.max(
            (rms - AUDIO_NOISE_FLOOR) / AUDIO_REFERENCE_LEVEL,
            0,
          ),
          1,
        );

        const now = performance.now();
        const playbackTime = audio.currentTime;
        const advancing =
          !audio.paused &&
          !audio.ended &&
          playbackTime > lastPlaybackTime + 0.0005;

        lastPlaybackTime = playbackTime;

        if (normalized > 0.002) {
          lastSignalAt = now;
        }

        const fallback =
          advancing && now - lastSignalAt >= 220
            ? 0.12 +
              (0.5 + 0.5 * Math.sin(playbackTime * 14)) * 0.07
            : 0;

        const shaped = Math.max(Math.sqrt(normalized), fallback);
        const current = smoothedLevelRef.current;
        const smoothing =
          shaped > current ? AUDIO_ATTACK : AUDIO_RELEASE;
        const next =
          current + (shaped - current) * smoothing;
        const stable = next < 0.025 ? 0 : next;

        smoothedLevelRef.current = stable;
        setGemmaAudioLevel(stable);
        analysisFrameRef.current =
          requestAnimationFrame(analyse);
      };

      analysisFrameRef.current =
        requestAnimationFrame(analyse);
    },
    [stopAudioAnalysis],
  );

  const stopCurrentAudio = useCallback(() => {
    for (const controller of controllersRef.current) {
      controller.abort();
    }

    controllersRef.current.clear();
    prefetchedRef.current.clear();

    stopAudioAnalysis();
    closeAudioContext();

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.src = "";
      audioRef.current = null;
    }

    releaseUrl();
  }, [
    closeAudioContext,
    releaseUrl,
    stopAudioAnalysis,
  ]);

  const stop = useCallback(() => {
    sessionRef.current += 1;
    queueRef.current = [];
    runningRef.current = false;
    stopCurrentAudio();
    setIsSpeaking(false);
  }, [stopCurrentAudio]);

  const fetchAudio = useCallback(
    async (item, sessionId) => {
      const speechText = cleanSpeechText(item.text);
      if (!speechText) return null;

      const controller = new AbortController();
      controllersRef.current.add(controller);

      try {
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ text: speechText }),
          signal: controller.signal,
        });

        if (!response.ok) return null;

        const blob = await response.blob();

        if (
          controller.signal.aborted ||
          sessionId !== sessionRef.current
        ) {
          return null;
        }

        return blob;
      } catch (error) {
        if (
          !(
            error instanceof DOMException &&
            error.name === "AbortError"
          )
        ) {
          console.error(
            "[Gemma Speech] TTS non disponibile",
            error,
          );
        }

        return null;
      } finally {
        controllersRef.current.delete(controller);
      }
    },
    [],
  );

  const prefetch = useCallback(
    (item, sessionId) => {
      if (prefetchedRef.current.has(item)) return;

      prefetchedRef.current.set(
        item,
        fetchAudio(item, sessionId),
      );
    },
    [fetchAudio],
  );

  const playItem = useCallback(
    async (item, sessionId, prefetched) => {
      const callbacks = item.callbacks || {};
      const speechText = cleanSpeechText(item.text);

      if (!speechText) {
        callbacks.onStart?.(0);
        callbacks.onProgress?.(1);
        callbacks.onEnd?.();
        return;
      }

      const blob =
        (await prefetched) ||
        (await fetchAudio(item, sessionId));

      if (
        !blob ||
        sessionId !== sessionRef.current
      ) {
        callbacks.onStart?.(0);
        callbacks.onProgress?.(1);
        callbacks.onEnd?.();
        return;
      }

      releaseUrl();

      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);

      audioRef.current = audio;
      audioUrlRef.current = url;
      audio.preload = "auto";
      audio.volume = 1;

      await new Promise((resolve) => {
        let finished = false;
        let started = false;
        let frame = null;

        const finish = () => {
          if (finished) return;
          finished = true;

          if (frame !== null) {
            cancelAnimationFrame(frame);
          }

          callbacks.onProgress?.(1);
          stopAudioAnalysis();

          if (audioRef.current === audio) {
            audioRef.current = null;
          }

          releaseUrl();
          callbacks.onEnd?.();
          resolve();
        };

        const progress = () => {
          if (
            finished ||
            !started ||
            sessionId !== sessionRef.current
          ) {
            return;
          }

          if (
            Number.isFinite(audio.duration) &&
            audio.duration > 0
          ) {
            callbacks.onProgress?.(
              Math.min(
                Math.max(
                  audio.currentTime / audio.duration,
                  0,
                ),
                1,
              ),
            );
          }

          frame = requestAnimationFrame(progress);
        };

        const start = () => {
          if (
            started ||
            sessionId !== sessionRef.current
          ) {
            return;
          }

          started = true;
          setIsSpeaking(true);

          callbacks.onStart?.(
            Number.isFinite(audio.duration)
              ? audio.duration
              : 0,
          );
          callbacks.onProgress?.(0);

          frame = requestAnimationFrame(progress);
        };

        audio.onplaying = start;
        audio.onended = finish;
        audio.onerror = finish;

        void (async () => {
          try {
            await startAudioAnalysis(audio);
            await audio.play();
            start();
          } catch {
            finish();
          }
        })();
      });
    },
    [
      fetchAudio,
      releaseUrl,
      startAudioAnalysis,
      stopAudioAnalysis,
    ],
  );

  const playQueue = useCallback(
    async (sessionId) => {
      if (runningRef.current) return;

      runningRef.current = true;

      try {
        while (
          queueRef.current.length &&
          sessionId === sessionRef.current
        ) {
          const item = queueRef.current.shift();
          if (!item) continue;

          const prepared =
            prefetchedRef.current.get(item);
          prefetchedRef.current.delete(item);

          const next = queueRef.current[0];
          if (next) {
            prefetch(next, sessionId);
          }

          await playItem(
            item,
            sessionId,
            prepared,
          );
        }
      } finally {
        if (sessionId === sessionRef.current) {
          runningRef.current = false;
          setIsSpeaking(false);
          resetGemmaAudioLevel();

          if (queueRef.current.length) {
            void playQueue(sessionId);
          }
        }
      }
    },
    [playItem, prefetch],
  );

  const begin = useCallback(() => {
    stop();
    return sessionRef.current;
  }, [stop]);

  const enqueue = useCallback(
    (text, options) => {
      const item = {
        text: String(text || ""),
        callbacks: normalizeCallbacks(options),
      };

      queueRef.current.push(item);

      if (queueRef.current.length === 1) {
        prefetch(item, sessionRef.current);
      }

      void playQueue(sessionRef.current);
    },
    [playQueue, prefetch],
  );

  const enqueueCompletion = useCallback(
    (options) => {
      queueRef.current.push({
        text: "",
        callbacks: normalizeCallbacks(options),
      });

      void playQueue(sessionRef.current);
    },
    [playQueue],
  );

  useEffect(() => stop, [stop]);

  return {
    isSpeaking,
    begin,
    enqueue,
    enqueueCompletion,
    stop,
  };
}
