"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetchBlob } from "../lib/api";

export type SpeechState = "idle" | "loading" | "playing" | "error";

export interface UseDebbySpeechResult {
  play: (text: string, voice?: string) => Promise<void>;
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
  // Monotonically-incrementing token: allows a pending play() to detect it was superseded.
  const playTokenRef = useRef(0);

  function getAudio(): HTMLAudioElement {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    return audioRef.current;
  }

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

  const play = useCallback(async (text: string, voice?: string): Promise<void> => {
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
      let objectUrl = cacheRef.current.get(text);
      if (!objectUrl) {
        const blob = await apiFetchBlob("/api/ai/tts", {
          method: "POST",
          body: JSON.stringify({ text, ...(voice ? { voice } : {}) }),
        });
        // Check if this call was superseded while the fetch was in flight.
        if (playTokenRef.current !== token) return;
        objectUrl = URL.createObjectURL(blob);
        cacheRef.current.set(text, objectUrl);
      }

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeText, state, stop]);

  useEffect(() => {
    return () => {
      playTokenRef.current += 1; // cancel any in-flight play on unmount
      const audio = audioRef.current;
      if (audio) {
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        audio.src = "";
      }
      for (const url of cacheRef.current.values()) {
        URL.revokeObjectURL(url);
      }
      cacheRef.current.clear();
    };
  }, []);

  return { play, stop, state, activeText, error };
}
