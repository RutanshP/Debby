"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetchBlob } from "../lib/api";

export type SpeechState = "idle" | "loading" | "playing" | "error";

export interface UseDebbySpeechResult {
  play: (text: string, voice?: string) => Promise<void>;
  prefetch: (text: string, voice?: string) => Promise<void>;
  stop: () => void;
  state: SpeechState;
  activeText: string | null;
  error: string | null;
}

export function useDebbySpeech(): UseDebbySpeechResult {
  const [state, setState] = useState<SpeechState>("idle");
  const [activeText, setActiveText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cacheRef = useRef<Map<string, string>>(new Map());
  // Tracks in-flight prefetch requests so play()/prefetch() don't double-fetch.
  const pendingRef = useRef<Map<string, Promise<string>>>(new Map());
  // Monotonically-incrementing token: allows a pending play() to detect it was superseded.
  const playTokenRef = useRef(0);

  function getAudio(): HTMLAudioElement {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    return audioRef.current;
  }

  // Fetches (and caches) the audio object URL for `text` without playing it.
  // Shared by play() and prefetch(); de-dupes concurrent requests for the same text.
  const loadAudioUrl = useCallback(
    async (text: string, voice?: string): Promise<string> => {
      const cached = cacheRef.current.get(text);
      if (cached) return cached;

      const inflight = pendingRef.current.get(text);
      if (inflight) return inflight;

      const request = apiFetchBlob("/api/ai/tts", {
        method: "POST",
        body: JSON.stringify({ text, ...(voice ? { voice } : {}) }),
      })
        .then((blob) => {
          const objectUrl = URL.createObjectURL(blob);
          cacheRef.current.set(text, objectUrl);
          return objectUrl;
        })
        .finally(() => {
          pendingRef.current.delete(text);
        });

      pendingRef.current.set(text, request);
      return request;
    },
    [],
  );

  const stop = useCallback(() => {
    playTokenRef.current += 1; // cancel any in-flight play
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.src = "";
    }
    setActiveText(null);
    setState("idle");
  }, []);

  // Warm the cache so a later play() is instant. Never throws and never
  // touches playback state — TTS failures must not block the speech UI.
  const prefetch = useCallback(
    async (text: string, voice?: string): Promise<void> => {
      if (!text.trim()) return;
      try {
        await loadAudioUrl(text, voice);
      } catch {
        // Swallow — audio is best-effort; the speech text still renders.
      }
    },
    [loadAudioUrl],
  );

  const play = useCallback(
    async (text: string, voice?: string): Promise<void> => {
      const audio = getAudio();

      // Toggle: if already playing this text, stop it.
      if (activeText === text && state === "playing") {
        stop();
        return;
      }

      // Cancel any previous in-flight load by bumping the token.
      playTokenRef.current += 1;
      const token = playTokenRef.current;

      // Clear stale event handlers before starting a new playback.
      audio.onended = null;
      audio.onerror = null;

      setError(null);
      setState("loading");
      setActiveText(text);

      try {
        const objectUrl = await loadAudioUrl(text, voice);
        // Check if this call was superseded while the fetch was in flight.
        if (playTokenRef.current !== token) return;

        audio.src = objectUrl;
        audio.onended = () => {
          if (playTokenRef.current === token) {
            setState("idle");
            setActiveText(null);
          }
        };
        audio.onerror = () => {
          if (playTokenRef.current === token) {
            setState("error");
            setError("Audio playback failed");
            setActiveText(null);
          }
        };
        await audio.play();
        if (playTokenRef.current === token) {
          setState("playing");
        }
      } catch (err) {
        if (playTokenRef.current === token) {
          setState("error");
          setError(err instanceof Error ? err.message : "Failed to play speech");
          setActiveText(null);
        }
      }
    },
    [activeText, state, stop, loadAudioUrl],
  );

  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      playTokenRef.current += 1; // cancel any in-flight play on unmount
      const audio = audioRef.current;
      if (audio) {
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        audio.src = "";
      }
      for (const url of cache.values()) {
        URL.revokeObjectURL(url);
      }
      cache.clear();
    };
  }, []);

  return { play, prefetch, stop, state, activeText, error };
}
