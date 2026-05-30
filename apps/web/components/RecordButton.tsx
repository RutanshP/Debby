"use client";

import { useEffect, useRef, useState } from "react";
import { useMediaRecorder } from "../hooks/useMediaRecorder";
import {
  type RealtimeTranscriptResult,
  useRealtimeTranscription,
} from "../hooks/useRealtimeTranscription";
import { WaveformVisualizer } from "./WaveformVisualizer";

interface RecordButtonProps {
  onComplete: (
    blob: Blob,
    realtimeTranscript?: RealtimeTranscriptResult | null,
  ) => void | Promise<void>;
  label?: string;
  disabled?: boolean;
  maxDurationSeconds?: number;
  realtimeTranscription?: boolean;
  onRealtimeTranscript?: (result: RealtimeTranscriptResult) => void;
  stopWhenRealtimeTranscript?: (result: RealtimeTranscriptResult) => boolean;
  stopAfterRealtimeSilenceSeconds?: number;
  allowEmptyRealtimeTranscript?: boolean;
}

export function RecordButton({
  onComplete,
  label = "Record",
  disabled = false,
  maxDurationSeconds,
  realtimeTranscription = false,
  onRealtimeTranscript,
  stopWhenRealtimeTranscript,
  stopAfterRealtimeSilenceSeconds,
  allowEmptyRealtimeTranscript = false,
}: RecordButtonProps) {
  const { state, error, stream, start, stop } = useMediaRecorder();
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [realtimeError, setRealtimeError] = useState<string | null>(null);
  const stoppingRef = useRef(false);
  const autoStopRef = useRef(false);
  const lastRealtimeActivityAtRef = useRef<number | null>(null);
  const lastRealtimeTranscriptRef = useRef("");
  const lastRealtimeWordCountRef = useRef(0);

  const isRecording = state === "recording";
  const isBusy = state === "requesting" || state === "stopping";

  const realtime = useRealtimeTranscription({
    onTranscript: (result) => {
      if (
        result.transcript !== lastRealtimeTranscriptRef.current ||
        result.words.length !== lastRealtimeWordCountRef.current
      ) {
        lastRealtimeTranscriptRef.current = result.transcript;
        lastRealtimeWordCountRef.current = result.words.length;
        lastRealtimeActivityAtRef.current = Date.now();
      }
      onRealtimeTranscript?.(result);
      if (
        stopWhenRealtimeTranscript?.(result) &&
        !stoppingRef.current &&
        !autoStopRef.current
      ) {
        autoStopRef.current = true;
        void finishRecording();
      }
    },
  });

  async function finishRecording() {
    if (stoppingRef.current || !isRecording) return;
    stoppingRef.current = true;
    try {
      const realtimeResult = realtimeTranscription ? await realtime.stop() : null;
      const blob = await stop();
      if (
        realtimeTranscription &&
        !allowEmptyRealtimeTranscript &&
        !realtimeResult?.transcript.trim()
      ) {
        setRealtimeError(
          "Realtime transcription connected but returned no transcript. Check the browser console Network tab for the AssemblyAI websocket messages.",
        );
        return;
      }
      await onComplete(blob, realtimeResult);
    } finally {
      setRemainingSeconds(null);
      stoppingRef.current = false;
    }
  }

  async function handleClick() {
    if (disabled) return;
    if (isRecording) {
      await finishRecording();
      return;
    }
    autoStopRef.current = false;
    lastRealtimeActivityAtRef.current = null;
    lastRealtimeTranscriptRef.current = "";
    lastRealtimeWordCountRef.current = 0;
    setRemainingSeconds(maxDurationSeconds ?? null);
    setRealtimeError(null);
    const mediaStream = await start().catch(() => null);
    if (!mediaStream) return;
    if (realtimeTranscription) {
      try {
        await realtime.start(mediaStream);
      } catch (err) {
        setRealtimeError(
          err instanceof Error ? err.message : "Realtime transcription failed",
        );
        await stop().catch(() => undefined);
        setRemainingSeconds(null);
      }
    }
  }

  useEffect(() => {
    if (!isRecording || !maxDurationSeconds) return undefined;

    setRemainingSeconds(maxDurationSeconds);
    const interval = window.setInterval(() => {
      setRemainingSeconds((current) => {
        if (current === null) return current;
        if (current <= 1) {
          window.clearInterval(interval);
          void finishRecording();
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
    // finishRecording intentionally reads the current recorder state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording, maxDurationSeconds]);

  useEffect(() => {
    if (
      !isRecording ||
      !realtimeTranscription ||
      !stopAfterRealtimeSilenceSeconds
    ) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      const lastActivity = lastRealtimeActivityAtRef.current;
      if (lastActivity === null || stoppingRef.current || autoStopRef.current) {
        return;
      }
      if (Date.now() - lastActivity >= stopAfterRealtimeSilenceSeconds * 1000) {
        autoStopRef.current = true;
        void finishRecording();
      }
    }, 250);

    return () => window.clearInterval(interval);
    // finishRecording intentionally reads the current recorder state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording, realtimeTranscription, stopAfterRealtimeSilenceSeconds]);

  const timerText =
    remainingSeconds === null
      ? null
      : `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, "0")}`;

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || isBusy}
        className={`inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          isRecording ? "bg-red-600 hover:bg-red-700" : "bg-teal hover:bg-teal-dark"
        }`}
      >
        {isRecording ? "Stop" : isBusy ? "..." : label}
      </button>
      {timerText && (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-center text-sm font-semibold text-slate-700">
          {timerText}
        </div>
      )}
      {isRecording && <WaveformVisualizer stream={stream} />}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {realtimeTranscription && (realtime.error || realtimeError) && (
        <p className="text-sm text-red-600">
          {realtime.error || realtimeError}
        </p>
      )}
    </div>
  );
}
