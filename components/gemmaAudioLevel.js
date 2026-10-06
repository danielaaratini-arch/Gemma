"use client";

let currentLevel = 0;

export function setGemmaAudioLevel(value) {
  const numeric = Number(value);
  currentLevel = Number.isFinite(numeric)
    ? Math.min(Math.max(numeric, 0), 1)
    : 0;
}

export function getGemmaAudioLevel() {
  return currentLevel;
}

export function resetGemmaAudioLevel() {
  currentLevel = 0;
}
