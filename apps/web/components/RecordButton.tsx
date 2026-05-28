"use client";

import { useEffect, useRef, useState } from "react";
import { useMediaRecorder } from "../hooks/useMediaRecorder";
import { WaveformVisualizer } from "./WaveformVisualizer";

interface RecordButtonProps {
  onComplete: (blob: Blob) => void | Promise<void>;
  label?: string;
  disabled?: boolean;
  maxDurationSeconds?: number;
}

export function RecordButton({
  onComplete,
  label = "Record",
  disabled = false,
  maxDurationSeconds,
}: RecordButtonProps) {
  const { state, error, stream, start, stop } = useMediaRecorder();
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const stoppingRef = useRef(false);

  const isRecording = state === "recording";
  const isBusy = state === "requesting" || state === "stopping";

  async function finishRecording() {
    if (stoppingRef.current || !isRecording) return;
    stoppingRef.current = true;
    try {
      const blob = await stop();
      await onComplete(blob);
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
    setRemainingSeconds(maxDurationSeconds ?? null);
    await start().catch(() => undefined);
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
    </div>
  );
}
