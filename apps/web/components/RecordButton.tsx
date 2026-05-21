"use client";

import { useMediaRecorder } from "../hooks/useMediaRecorder";
import { WaveformVisualizer } from "./WaveformVisualizer";

interface RecordButtonProps {
  onComplete: (blob: Blob) => void | Promise<void>;
  label?: string;
  disabled?: boolean;
}

export function RecordButton({
  onComplete,
  label = "Record",
  disabled = false,
}: RecordButtonProps) {
  const { state, error, stream, start, stop } = useMediaRecorder();

  const isRecording = state === "recording";
  const isBusy = state === "requesting" || state === "stopping";

  async function handleClick() {
    if (disabled) return;
    if (isRecording) {
      const blob = await stop();
      await onComplete(blob);
      return;
    }
    await start().catch(() => undefined);
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || isBusy}
        className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          isRecording ? "bg-red-600 hover:bg-red-700" : "bg-teal hover:bg-teal-dark"
        }`}
      >
        {isRecording ? "Stop" : isBusy ? "…" : label}
      </button>
      {isRecording && <WaveformVisualizer stream={stream} />}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
