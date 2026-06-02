"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetchBlob, apiFetchResponse } from "@/lib/api";

export type SpeechState = "idle" | "loading" | "playing" | "error";

export interface UseDebbySpeechResult {
  play: (parts: string | string[], voice?: string) => Promise<void>;
  prefetch: (parts: string | string[], voice?: string) => Promise<void>;
  cacheAudio: (text: string, chunks: ArrayBuffer[], voice?: string) => Promise<void>;
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

function decodeBase64Audio(base64: string): ArrayBuffer {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
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

  const cacheAudio = useCallback(async (text: string, chunks: ArrayBuffer[], voice?: string) => {
    const normalizedText = text.trim();
    if (!normalizedText || chunks.length === 0) return;

    try {
      const ctx = getCtx();
      const decoded = await Promise.all(
        chunks.map((chunk) => ctx.decodeAudioData(chunk.slice(0))),
      );
      const combined =
        decoded.length === 1 ? decoded[0] : concatBuffers(ctx, decoded);
      bufferCacheRef.current.set(audioCacheKey(normalizedText, voice), combined);
    } catch {
      // Best-effort cache hydration only.
    }
  }, []);

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

      if (playTokenRef.current !== token) return;
      const ctx = getCtx();
      await ctx.resume();
      if (playTokenRef.current !== token) return;

      const playWholeBuffer = (buffer: AudioBuffer) =>
        new Promise<void>((resolve) => {
          if (playTokenRef.current !== token) {
            resolve();
            return;
          }
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(ctx.destination);
          source.onended = () => {
            sourceNodeRef.current = null;
            resolve();
          };
          sourceNodeRef.current = source;
          setState("playing");
          source.start();
        });

      const playStreamedPart = async (text: string) => {
        const partKey = audioCacheKey(text, voice);
        const res = await apiFetchResponse("/api/ai/tts-stream", {
          method: "POST",
          body: JSON.stringify({ text, ...(voice ? { voice } : {}) }),
        });
        const reader = res.body?.getReader();
        if (!reader) {
          throw new Error("Streaming audio not available");
        }

        const decoder = new TextDecoder();
        let pending = "";
        const queued: AudioBuffer[] = [];
        const collected: AudioBuffer[] = [];
        let playing = false;
        let streamDone = false;

        const waitForPlayback = new Promise<void>((resolve, reject) => {
          const maybePlayNext = () => {
            if (playTokenRef.current !== token) {
              resolve();
              return;
            }
            if (playing) return;
            const next = queued.shift();
            if (!next) {
              if (streamDone) resolve();
              return;
            }

            playing = true;
            const source = ctx.createBufferSource();
            source.buffer = next;
            source.connect(ctx.destination);
            source.onended = () => {
              sourceNodeRef.current = null;
              playing = false;
              maybePlayNext();
            };
            sourceNodeRef.current = source;
            setState("playing");
            source.start();
          };

          const handleEvent = async (eventName: string, data: string) => {
            if (eventName === "audio") {
              const payload = JSON.parse(data) as { audio_b64: string };
              const arrayBuffer = decodeBase64Audio(payload.audio_b64);
              const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
              queued.push(decoded);
              collected.push(decoded);
              maybePlayNext();
              return;
            }
            if (eventName === "error") {
              const payload = JSON.parse(data) as { message?: string };
              reject(new Error(payload.message || "TTS stream failed"));
              return;
            }
            if (eventName === "done") {
              streamDone = true;
              if (!playing && queued.length === 0) {
                resolve();
              }
            }
          };

          const processPending = async () => {
            while (pending.includes("\n\n")) {
              const separatorIndex = pending.indexOf("\n\n");
              const rawEvent = pending.slice(0, separatorIndex);
              pending = pending.slice(separatorIndex + 2);
              if (!rawEvent.trim()) continue;
              const lines = rawEvent.split("\n");
              const eventName =
                lines.find((line) => line.startsWith("event:"))?.slice(6).trim() ??
                "message";
              const data = lines
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).trim())
                .join("\n");
              await handleEvent(eventName, data);
            }
          };

          void (async () => {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                pending += decoder.decode(value, { stream: true });
                await processPending();
              }
              pending += decoder.decode();
              await processPending();
              streamDone = true;
              if (!playing && queued.length === 0) {
                resolve();
              }
            } catch (err) {
              reject(err instanceof Error ? err : new Error("TTS stream failed"));
            }
          })();
        });

        await waitForPlayback;
        if (collected.length > 0) {
          const combined =
            collected.length === 1 ? collected[0] : concatBuffers(ctx, collected);
          bufferCacheRef.current.set(partKey, combined);
        }
      };

      try {
        for (const text of texts) {
          if (playTokenRef.current !== token) return;
          const cached = bufferCacheRef.current.get(audioCacheKey(text, voice));
          if (cached) {
            await playWholeBuffer(cached);
            continue;
          }
          await playStreamedPart(text);
        }
      } catch (err) {
        if (playTokenRef.current !== token) return;
        setState("error");
        setError(err instanceof Error ? err.message : "TTS fetch failed");
        return;
      }

      if (playTokenRef.current !== token) return;
      setState("idle");
      setActiveKey(null);
    },
    [activeKey, state, stop],
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

  return { play, prefetch, cacheAudio, stop, state, activeKey, error };
}
