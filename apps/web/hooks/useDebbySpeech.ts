"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetchBlob } from "@/lib/api";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SpeechState = "idle" | "loading" | "playing" | "error";

export interface UseDebbySpeechResult {
  play: (parts: string | string[], voice?: string) => Promise<void>;
  prefetch: (parts: string | string[], voice?: string) => Promise<void>;
  stop: () => void;
  state: SpeechState;
  activeKey: string | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stable join key for a set of speech parts. Single string = itself. */
export function speechKey(parts: string | string[]): string {
  return Array.isArray(parts) ? parts.join("\x00") : parts;
}

function normalise(parts: string | string[]): string[] {
  return Array.isArray(parts) ? parts : [parts];
}

// ---------------------------------------------------------------------------
// Concatenate an array of AudioBuffers into a single AudioBuffer
// ---------------------------------------------------------------------------
function concatBuffers(ctx: AudioContext, buffers: AudioBuffer[]): AudioBuffer {
  const totalLength = buffers.reduce((sum, b) => sum + b.length, 0);
  const channelCount = Math.max(...buffers.map((b) => b.numberOfChannels));
  const sampleRate = buffers[0].sampleRate;

  const output = ctx.createBuffer(channelCount, totalLength, sampleRate);

  let offset = 0;
  for (const buf of buffers) {
    for (let ch = 0; ch < channelCount; ch++) {
      const outData = output.getChannelData(ch);
      if (ch < buf.numberOfChannels) {
        outData.set(buf.getChannelData(ch), offset);
      }
      // channels beyond buf.numberOfChannels are already zero (createBuffer zeros memory)
    }
    offset += buf.length;
  }

  return output;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDebbySpeech(): UseDebbySpeechResult {
  const [state, setState] = useState<SpeechState>("idle");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Lazy singleton AudioContext
  const ctxRef = useRef<AudioContext | null>(null);

  // Per-part AudioBuffer cache, keyed by text
  const bufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map());

  // In-flight fetches, de-duped by text
  const pendingRef = useRef<Map<string, Promise<AudioBuffer>>>(new Map());

  // Currently playing source node
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);

  // Monotonic play token for cancellation
  const playTokenRef = useRef<number>(0);

  // ------------------------------------------------------------------
  // AudioContext – created lazily on first use
  // ------------------------------------------------------------------
  function getCtx(): AudioContext {
    if (!ctxRef.current) {
      const win = typeof window !== "undefined" ? window : null;
      const AC =
        (win &&
          ((win as unknown as { AudioContext?: typeof AudioContext }).AudioContext ||
            (win as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)) ||
        null;
      if (!AC) throw new Error("AudioContext not available");
      ctxRef.current = new AC();
    }
    return ctxRef.current;
  }

  // ------------------------------------------------------------------
  // Load a single part's AudioBuffer (network + decode, cached)
  // ------------------------------------------------------------------
  const loadBuffer = useCallback(
    async (text: string, voice?: string): Promise<AudioBuffer> => {
      const cached = bufferCacheRef.current.get(text);
      if (cached) return cached;

      const inFlight = pendingRef.current.get(text);
      if (inFlight) return inFlight;

      const promise = (async () => {
        const blob = await apiFetchBlob("/api/ai/tts", {
          method: "POST",
          body: JSON.stringify({ text, ...(voice ? { voice } : {}) }),
        });
        const arrayBuf = await blob.arrayBuffer();
        const ctx = getCtx();
        // decodeAudioData detaches the ArrayBuffer – slice to be safe
        const buffer = await ctx.decodeAudioData(arrayBuf.slice(0));
        bufferCacheRef.current.set(text, buffer);
        return buffer;
      })();

      pendingRef.current.set(text, promise);
      try {
        const result = await promise;
        return result;
      } finally {
        pendingRef.current.delete(text);
      }
    },
    [],
  );

  // ------------------------------------------------------------------
  // prefetch – warm buffers, best-effort, never throws
  // ------------------------------------------------------------------
  const prefetch = useCallback(
    async (parts: string | string[], voice?: string): Promise<void> => {
      const texts = normalise(parts);
      try {
        await Promise.all(texts.map((t) => loadBuffer(t, voice)));
      } catch {
        // swallow – prefetch is best-effort
      }
    },
    [loadBuffer],
  );

  // ------------------------------------------------------------------
  // stop – immediate, bump token
  // ------------------------------------------------------------------
  const stop = useCallback(() => {
    playTokenRef.current += 1;
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
        sourceNodeRef.current.disconnect();
      } catch {
        // already stopped
      }
      sourceNodeRef.current = null;
    }
    setState("idle");
    setActiveKey(null);
    setError(null);
  }, []);

  // ------------------------------------------------------------------
  // play
  // ------------------------------------------------------------------
  const play = useCallback(
    async (parts: string | string[], voice?: string): Promise<void> => {
      const key = speechKey(parts);
      const texts = normalise(parts);

      // Toggle-stop if already playing the same key
      if (state === "playing" && activeKey === key) {
        stop();
        return;
      }

      const token = ++playTokenRef.current;

      // Stop any current playback
      if (sourceNodeRef.current) {
        try {
          sourceNodeRef.current.stop();
          sourceNodeRef.current.disconnect();
        } catch {
          // already stopped
        }
        sourceNodeRef.current = null;
      }

      setState("loading");
      setActiveKey(key);
      setError(null);

      let buffers: AudioBuffer[];
      try {
        buffers = await Promise.all(texts.map((t) => loadBuffer(t, voice)));
      } catch (err) {
        if (playTokenRef.current !== token) return; // superseded
        setState("error");
        setError(err instanceof Error ? err.message : "TTS fetch failed");
        return;
      }

      if (playTokenRef.current !== token) return; // superseded

      const ctx = getCtx();
      await ctx.resume();

      if (playTokenRef.current !== token) return; // superseded

      const combined =
        buffers.length === 1 ? buffers[0] : concatBuffers(ctx, buffers);

      const source = ctx.createBufferSource();
      source.buffer = combined;
      source.connect(ctx.destination);
      source.onended = () => {
        if (playTokenRef.current === token) {
          setState("idle");
          setActiveKey(null);
          sourceNodeRef.current = null;
        }
      };

      sourceNodeRef.current = source;
      setState("playing");
      source.start();
    },
    [state, activeKey, stop, loadBuffer],
  );

  // ------------------------------------------------------------------
  // Cleanup on unmount
  // ------------------------------------------------------------------
  useEffect(() => {
    return () => {
      playTokenRef.current += 1;
      if (sourceNodeRef.current) {
        try {
          sourceNodeRef.current.stop();
          sourceNodeRef.current.disconnect();
        } catch {
          // already stopped
        }
        sourceNodeRef.current = null;
      }
      if (ctxRef.current) {
        ctxRef.current.close().catch(() => {});
        ctxRef.current = null;
      }
      bufferCacheRef.current.clear();
      pendingRef.current.clear();
    };
  }, []);

  return { play, prefetch, stop, state, activeKey, error };
}
