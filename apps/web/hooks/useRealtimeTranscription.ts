"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/api";

const TARGET_SAMPLE_RATE = 16000;
const STREAMING_URL = "wss://streaming.assemblyai.com/v3/ws";

interface StreamingTokenResponse {
  token: string;
  expires_in_seconds: number;
}

export interface RealtimeWord {
  text: string;
  start: number;
  end: number;
}

export interface RealtimeTranscriptResult {
  transcript: string;
  durationSeconds: number;
  words: RealtimeWord[];
}

type RealtimeState = "idle" | "connecting" | "streaming" | "closing" | "error";

interface AssemblyTurnWord {
  text?: string;
  start?: number;
  end?: number;
  word_is_final?: boolean;
}

interface AssemblyTurnMessage {
  type?: string;
  turn_order?: number;
  end_of_turn?: boolean;
  transcript?: string;
  words?: AssemblyTurnWord[];
  audio_duration_seconds?: number;
  session_duration_seconds?: number;
}

export interface UseRealtimeTranscriptionResult {
  state: RealtimeState;
  error: string | null;
  start: (stream: MediaStream) => Promise<void>;
  stop: () => Promise<RealtimeTranscriptResult | null>;
}

interface UseRealtimeTranscriptionOptions {
  onTranscript?: (result: RealtimeTranscriptResult) => void;
  onAudioActivity?: () => void;
}

function downsampleTo16k(input: Float32Array, inputSampleRate: number): Int16Array {
  if (inputSampleRate === TARGET_SAMPLE_RATE) {
    return floatTo16BitPcm(input);
  }

  const ratio = inputSampleRate / TARGET_SAMPLE_RATE;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j += 1) {
      sum += input[j] ?? 0;
      count += 1;
    }
    output[i] = count > 0 ? sum / count : 0;
  }

  return floatTo16BitPcm(output);
}

function floatTo16BitPcm(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i] ?? 0));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

function buildTranscript(turns: Map<number, string>): string {
  return Array.from(turns.entries())
    .sort(([a], [b]) => a - b)
    .map(([, text]) => text.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

export function useRealtimeTranscription(
  options: UseRealtimeTranscriptionOptions = {},
): UseRealtimeTranscriptionResult {
  const [state, setState] = useState<RealtimeState>("idle");
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const turnsRef = useRef<Map<number, string>>(new Map());
  const wordsRef = useRef<Map<string, RealtimeWord>>(new Map());
  const messageCountRef = useRef<number>(0);
  const startedAtRef = useRef<number | null>(null);
  const durationRef = useRef<number>(0);
  const closingPromiseRef = useRef<Promise<RealtimeTranscriptResult | null> | null>(null);
  const onTranscriptRef = useRef(options.onTranscript);
  const onAudioActivityRef = useRef(options.onAudioActivity);

  useEffect(() => {
    onTranscriptRef.current = options.onTranscript;
    onAudioActivityRef.current = options.onAudioActivity;
  }, [options.onTranscript, options.onAudioActivity]);

  const cleanupAudio = useCallback(() => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    gainRef.current?.disconnect();
    processorRef.current = null;
    sourceRef.current = null;
    gainRef.current = null;
    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    void audioContext?.close().catch(() => undefined);
  }, []);

  const buildResult = useCallback((): RealtimeTranscriptResult | null => {
    const transcript = buildTranscript(turnsRef.current);
    if (!transcript) return null;
    const fallbackDuration =
      startedAtRef.current === null
        ? 0
        : (performance.now() - startedAtRef.current) / 1000;
    return {
      transcript,
      durationSeconds: durationRef.current || fallbackDuration,
      words: Array.from(wordsRef.current.values()).sort((a, b) => a.start - b.start),
    };
  }, []);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      let message: AssemblyTurnMessage;
      try {
        message = JSON.parse(event.data) as AssemblyTurnMessage;
      } catch {
        return;
      }

      messageCountRef.current += 1;

      const isTurn =
        message.type === "Turn" ||
        message.turn_order !== undefined ||
        message.transcript !== undefined;

      if (isTurn) {
        const order = message.turn_order ?? 0;
        if (message.transcript) {
          turnsRef.current.set(order, message.transcript);
        }
        for (const word of message.words ?? []) {
          if (!word.word_is_final || !word.text) continue;
          const start = Math.max(0, Math.round(word.start ?? 0));
          const end = Math.max(start, Math.round(word.end ?? start));
          wordsRef.current.set(`${start}:${end}:${word.text}`, {
            text: word.text,
            start,
            end,
          });
        }
        const liveResult = buildResult();
        if (liveResult) {
          onTranscriptRef.current?.(liveResult);
        }
      }

      if (message.type === "Termination") {
        durationRef.current =
          message.audio_duration_seconds ?? message.session_duration_seconds ?? durationRef.current;
      }
    },
    [buildResult],
  );

  const start = useCallback(
    async (stream: MediaStream) => {
      setError(null);
      setState("connecting");
      turnsRef.current.clear();
      wordsRef.current.clear();
      durationRef.current = 0;
      messageCountRef.current = 0;
      startedAtRef.current = performance.now();
      closingPromiseRef.current = null;

      try {
        const token = await apiFetch<StreamingTokenResponse>(
          "/api/transcription/stream-token",
        );
        const params = new URLSearchParams({
          token: token.token,
          speech_model: "u3-rt-pro",
          sample_rate: String(TARGET_SAMPLE_RATE),
          encoding: "pcm_s16le",
          format_turns: "true",
          inactivity_timeout: "10",
        });
        const ws = new WebSocket(`${STREAMING_URL}?${params.toString()}`);
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;
        ws.addEventListener("message", handleMessage);
        ws.addEventListener("error", () => {
          setError("Realtime transcription connection failed");
          setState("error");
        });
        ws.addEventListener("close", () => {
          if (state !== "closing") setState("idle");
        });

        await new Promise<void>((resolve, reject) => {
          ws.addEventListener("open", () => resolve(), { once: true });
          ws.addEventListener("error", () => reject(new Error("WebSocket failed")), {
            once: true,
          });
        });

        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const audioContext = new AudioContextClass();
        audioContextRef.current = audioContext;
        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        const gain = audioContext.createGain();
        gain.gain.value = 0;

        processor.onaudioprocess = (event) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const input = event.inputBuffer.getChannelData(0);
          let sum = 0;
          for (let i = 0; i < input.length; i += 1) {
            sum += (input[i] ?? 0) ** 2;
          }
          const rms = Math.sqrt(sum / Math.max(input.length, 1));
          if (rms > 0.025) {
            onAudioActivityRef.current?.();
          }
          const pcm = downsampleTo16k(input, audioContext.sampleRate);
          ws.send(pcm.buffer);
        };

        source.connect(processor);
        processor.connect(gain);
        gain.connect(audioContext.destination);
        sourceRef.current = source;
        processorRef.current = processor;
        gainRef.current = gain;
        setState("streaming");
      } catch (err) {
        cleanupAudio();
        wsRef.current?.close();
        wsRef.current = null;
        setError(err instanceof Error ? err.message : "Realtime transcription failed");
        setState("error");
        throw err;
      }
    },
    [cleanupAudio, handleMessage, state],
  );

  const stop = useCallback(async (): Promise<RealtimeTranscriptResult | null> => {
    if (closingPromiseRef.current) return closingPromiseRef.current;

    const ws = wsRef.current;
    cleanupAudio();
    if (!ws) return buildResult();

    setState("closing");
    const promise = new Promise<RealtimeTranscriptResult | null>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        ws.removeEventListener("message", handleMessage);
        wsRef.current = null;
        closingPromiseRef.current = null;
        setState("idle");
        resolve(buildResult());
      };

      const timeout = window.setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
        settle();
      }, 5000);

      ws.addEventListener(
        "message",
        (event) => {
          if (typeof event.data === "string" && event.data.includes('"Termination"')) {
            window.clearTimeout(timeout);
            settle();
          }
        },
        { once: false },
      );
      ws.addEventListener(
        "close",
        () => {
          window.clearTimeout(timeout);
          settle();
        },
        { once: true },
      );

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "Terminate" }));
      } else {
        ws.close();
        settle();
      }
    });

    closingPromiseRef.current = promise;
    return promise;
  }, [buildResult, cleanupAudio, handleMessage]);

  useEffect(() => {
    return () => {
      cleanupAudio();
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "Terminate" }));
      }
      ws?.close();
      wsRef.current = null;
    };
  }, [cleanupAudio]);

  return { state, error, start, stop };
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
