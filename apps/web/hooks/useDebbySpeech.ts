"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetchBlob } from "@/lib/api";

export type SpeechState = "idle" | "loading" | "playing" | "error";

export interface UseDebbySpeechResult {
  play: (parts: string | string[], voice?: string) => Promise<void>;
  prefetch: (parts: string | string[], voice?: string) => Promise<void>;
  stop: () => void;
  state: SpeechState;
  activeKey: string | null;
  error: string | null;
}

export function speechKey(parts: string | string[]): string {
  return Array.isArray(parts) ? parts.join("\x00") : parts;
}

function audioCacheKey(text: string, voice?: string): string {
  return `${voice ?? ""}\x01${text}`;
}

function normalize(parts: string | string[]): string[] {
  return Array.isArray(parts) ? parts : [parts];
}

function concatBuffers(ctx: AudioContext, buffers: AudioBuffer[]): AudioBuffer {
  const totalLength = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
  const channelCount = Math.max(...buffers.map((buffer) => buffer.numberOfChannels));
  const sampleRate = buffers[0].sampleRate;
  const output = ctx.createBuffer(channelCount, totalLength, sampleRate);

  let offset = 0;
  for (const buffer of buffers) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const outData = output.getChannelData(channel);
      if (channel < buffer.numberOfChannels) {
        outData.set(buffer.getChannelData(channel), offset);
      }
    }
    offset += buffer.length;
  }

  return output;
}

export function useDebbySpeech(): UseDebbySpeechResult {
  const [state, setState] = useState<SpeechState>("idle");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const bufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map());
  const pendingRef = useRef<Map<string, Promise<AudioBuffer>>>(new Map());
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const playTokenRef = useRef(0);

  function getCtx(): AudioContext {
    if (!ctxRef.current) {
      const win = typeof window !== "undefined" ? window : null;
      const AudioContextClass =
        (win &&
          ((win as unknown as { AudioContext?: typeof AudioContext }).AudioContext ||
            (win as unknown as { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext)) ||
        null;
      if (!AudioContextClass) throw new Error("AudioContext not available");
      ctxRef.current = new AudioContextClass();
    }
    return ctxRef.current;
  }

  const loadBuffer = useCallback(async (text: string, voice?: string) => {
    const key = audioCacheKey(text, voice);
    const cached = bufferCacheRef.current.get(key);
    if (cached) return cached;

    const pending = pendingRef.current.get(key);
    if (pending) return pending;

    const promise = (async () => {
      const blob = await apiFetchBlob("/api/ai/tts", {
        method: "POST",
        body: JSON.stringify({ text, ...(voice ? { voice } : {}) }),
      });
      const arrayBuffer = await blob.arrayBuffer();
      const ctx = getCtx();
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
      bufferCacheRef.current.set(key, decoded);
      return decoded;
    })();

    pendingRef.current.set(key, promise);
    try {
      return await promise;
    } finally {
      pendingRef.current.delete(key);
    }
  }, []);

  const prefetch = useCallback(
    async (parts: string | string[], voice?: string) => {
      try {
        await Promise.all(normalize(parts).map((part) => loadBuffer(part, voice)));
      } catch {
        // Best-effort warmup only.
      }
    },
    [loadBuffer],
  );

  const stop = useCallback(() => {
    playTokenRef.current += 1;
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
        sourceNodeRef.current.disconnect();
      } catch {
        // Already stopped.
      }
      sourceNodeRef.current = null;
    }
    setState("idle");
    setActiveKey(null);
    setError(null);
  }, []);

  const play = useCallback(
    async (parts: string | string[], voice?: string) => {
      const key = speechKey(parts);
      const texts = normalize(parts);

      if (state === "playing" && activeKey === key) {
        stop();
        return;
      }

      const token = ++playTokenRef.current;
      if (sourceNodeRef.current) {
        try {
          sourceNodeRef.current.stop();
          sourceNodeRef.current.disconnect();
        } catch {
          // Already stopped.
        }
        sourceNodeRef.current = null;
      }

      setState("loading");
      setActiveKey(key);
      setError(null);

      let buffers: AudioBuffer[];
      try {
        buffers = await Promise.all(texts.map((text) => loadBuffer(text, voice)));
      } catch (err) {
        if (playTokenRef.current !== token) return;
        setState("error");
        setError(err instanceof Error ? err.message : "TTS fetch failed");
        return;
      }

      if (playTokenRef.current !== token) return;
      const ctx = getCtx();
      await ctx.resume();
      if (playTokenRef.current !== token) return;

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
    [activeKey, loadBuffer, state, stop],
  );

  useEffect(() => {
    return () => {
      playTokenRef.current += 1;
      if (sourceNodeRef.current) {
        try {
          sourceNodeRef.current.stop();
          sourceNodeRef.current.disconnect();
        } catch {
          // Already stopped.
        }
      }
      sourceNodeRef.current = null;
      if (ctxRef.current) {
        void ctxRef.current.close().catch(() => {});
        ctxRef.current = null;
      }
      bufferCacheRef.current.clear();
      pendingRef.current.clear();
    };
  }, []);

  return { play, prefetch, stop, state, activeKey, error };
}
