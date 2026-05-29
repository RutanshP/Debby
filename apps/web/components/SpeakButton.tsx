"use client";

import type { SpeechState, UseDebbySpeechResult } from "../hooks/useDebbySpeech";

interface SpeakButtonProps {
  text: string;
  play: UseDebbySpeechResult["play"];
  state: SpeechState;
  activeText: string | null;
  error?: string | null;
  voice?: string;
}

export function SpeakButton({ text, play, state, activeText, error, voice }: SpeakButtonProps) {
  const isThisActive = activeText === text;
  const isLoading = isThisActive && state === "loading";
  const isPlaying = isThisActive && state === "playing";
  const hasError = isThisActive && state === "error";

  function handleClick() {
    void play(text, voice);
  }

  let icon: string;
  let label: string;
  if (isLoading) {
    icon = "…";
    label = "Loading speech…";
  } else if (isPlaying) {
    icon = "⏸";
    label = "Pause Debby's speech";
  } else {
    icon = "▶";
    label = "Play Debby's speech";
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={isLoading}
        aria-label={label}
        title={label}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-teal text-teal transition hover:bg-teal/10 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span aria-hidden="true" className="text-xs leading-none">
          {icon}
        </span>
      </button>
      {hasError && error && (
        <span className="text-xs text-red-600" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
