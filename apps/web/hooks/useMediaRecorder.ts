"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "requesting" | "recording" | "stopping";

export interface UseMediaRecorderResult {
  state: RecorderState;
  error: string | null;
  stream: MediaStream | null;
  start: () => Promise<MediaStream>;
  stop: () => Promise<Blob>;
}

const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return PREFERRED_MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
}

export function useMediaRecorder(): UseMediaRecorderResult {
  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const cleanup = useCallback(() => {
    recorderRef.current = null;
    chunksRef.current = [];
    setStream((current) => {
      current?.getTracks().forEach((t) => t.stop());
      return null;
    });
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async (): Promise<MediaStream> => {
    setError(null);
    setState("requesting");
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
      });
      recorderRef.current = recorder;
      setStream(mediaStream);
      recorder.start(250);
      setState("recording");
      return mediaStream;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Microphone unavailable");
      setState("idle");
      throw err;
    }
  }, []);

  const stop = useCallback(async (): Promise<Blob> => {
    const recorder = recorderRef.current;
    if (!recorder) throw new Error("Recorder not started");

    setState("stopping");
    const blob = await new Promise<Blob>((resolve) => {
      recorder.addEventListener(
        "stop",
        () => {
          const type = recorder.mimeType || "audio/webm";
          resolve(new Blob(chunksRef.current, { type }));
        },
        { once: true },
      );
      recorder.stop();
    });
    cleanup();
    setState("idle");
    return blob;
  }, [cleanup]);

  return { state, error, stream, start, stop };
}
