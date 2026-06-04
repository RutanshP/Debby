"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch, apiFetchResponse } from "../../lib/api";
import { getBrowserSupabase } from "../../lib/supabase";
import { RecordButton } from "../../components/RecordButton";
import { RfdCard } from "../../components/RfdCard";
import type { RealtimeTranscriptResult } from "../../hooks/useRealtimeTranscription";
import {
  speechKey,
  useDebbySpeech,
  type UseDebbySpeechResult,
} from "../../hooks/useDebbySpeech";
import type { FlowSheetData } from "../../components/FlowSheet";
import { WpmChart, type WpmPoint } from "../../components/WpmChart";
import {
  isPracticePayload,
  statusLabel,
  withClassContext,
  type AssignmentRecipientDetail,
  type StartAssignmentResponse,
} from "../../lib/classroom";

type Format = "parli" | "mspdp";
type Side = "aff" | "neg";

const TOPIC_WORD_LIMIT = 100;

interface TopicResponse {
  topic: string;
  side: Side;
  format: Format;
}

interface TournamentListResponse {
  tournaments: string[];
}

interface RoundResponse {
  id: string;
}

interface SpeechResponse {
  transcript: string;
  wpm_series: WpmPoint[];
}

type GeneratedAudioKind =
  | "aff_speech"
  | "neg_framework"
  | "neg_rebuttal"
  | "aff_rebuttal";

interface GeneratedAudioStreamRequest {
  kind: GeneratedAudioKind;
  topic: string;
  side?: Side;
  aff_speech?: string;
  neg_case?: string;
  neg_speech?: string;
  voice?: string;
}

interface JudgmentResponse {
  rfd: string;
  winner_side?: Side | null;
  flow: FlowSheetData;
}

type Step = 1 | 2 | 3 | 4 | 5;

const fieldLabelClass = "flex flex-col gap-1 text-sm font-medium text-slate-700";
const fieldControlClass =
  "h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/20 disabled:bg-slate-100 disabled:text-slate-400";
const primaryButtonClass =
  "inline-flex h-10 items-center justify-center rounded-md bg-teal px-4 text-sm font-medium text-white shadow-sm transition hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClass =
  "inline-flex h-10 items-center justify-center rounded-md border border-teal px-4 text-sm font-medium text-teal transition hover:bg-teal/5 disabled:cursor-not-allowed disabled:opacity-60";

const timerOptions = [
  { label: "30 sec", seconds: 30 },
  { label: "45 sec", seconds: 45 },
  { label: "1 min", seconds: 60 },
  { label: "1:30", seconds: 90 },
  { label: "2 min", seconds: 120 },
  { label: "3 min", seconds: 180 },
  { label: "4 min", seconds: 240 },
  { label: "5 min", seconds: 300 },
];

const SIDE_LABEL: Record<Side, string> = {
  aff: "Affirmative",
  neg: "Negative",
};

function decodeBase64Audio(base64: string): ArrayBuffer {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function streamGeneratedSpeech(
  request: GeneratedAudioStreamRequest,
  callbacks: {
    onTextReady: (text: string, initialAudioChunks: ArrayBuffer[]) => void;
    onAudioChunk?: (chunk: ArrayBuffer, fullText: string) => void;
    onComplete?: (chunks: ArrayBuffer[], fullText: string) => Promise<void>;
  },
): Promise<string> {
  const response = await apiFetchResponse("/api/ai/generate-audio-stream", {
    method: "POST",
    body: JSON.stringify(request),
  });
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Generated audio stream is not available");
  }

  const decoder = new TextDecoder();
  let pending = "";
  let text = "";
  let readyText = "";
  const audioChunks: ArrayBuffer[] = [];

  const handleEvent = async (eventName: string, data: string) => {
    if (eventName === "text") {
      const payload = JSON.parse(data) as { text: string };
      text += payload.text;
      return;
    }
    if (eventName === "audio") {
      const payload = JSON.parse(data) as { audio_b64: string };
      const chunk = decodeBase64Audio(payload.audio_b64);
      audioChunks.push(chunk);
      if (readyText && callbacks.onAudioChunk) {
        callbacks.onAudioChunk(chunk, readyText);
      }
      return;
    }
    if (eventName === "text_done") {
      const payload = JSON.parse(data) as { full_text?: string };
      readyText = payload.full_text?.trim() ?? text.trim();
      if (!readyText) readyText = text.trim();
      callbacks.onTextReady(readyText, [...audioChunks]);
      return;
    }
    if (eventName === "error") {
      const payload = JSON.parse(data) as { message?: string };
      throw new Error(payload.message || "Failed to generate Debby audio");
    }
    if (eventName === "done") {
      const payload = JSON.parse(data) as { full_text?: string };
      if (!readyText) {
        readyText = payload.full_text?.trim() ?? text.trim();
        if (!readyText) readyText = text.trim();
        callbacks.onTextReady(readyText, [...audioChunks]);
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
        lines.find((line) => line.startsWith("event:"))?.slice(6).trim() ?? "message";
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      await handleEvent(eventName, data);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    await processPending();
  }

  pending += decoder.decode();
  await processPending();

  const finalText = readyText || text.trim();
  if (callbacks.onComplete && finalText && audioChunks.length > 0) {
    await callbacks.onComplete(audioChunks, finalText);
  }
  return finalText;
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function winnerLabel(
  winner: Side | null | undefined,
  userSide: Side,
): string | null {
  if (!winner) return null;
  const person = winner === userSide ? "You" : "Debby";
  return `${person} (${SIDE_LABEL[winner]})`;
}

function StepCard({
  step,
  title,
  active,
  done,
  children,
}: {
  step: number;
  title: string;
  active: boolean;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-current={active ? "step" : undefined}
      className={`rounded-lg border p-6 shadow-sm transition-colors ${
        active
          ? "border-teal bg-white"
          : done
            ? "border-slate-200 bg-slate-50"
            : "border-slate-200 bg-slate-50 opacity-60"
      }`}
    >
      <header className="mb-4 flex items-center gap-3">
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
            done
              ? "bg-teal text-white"
              : active
                ? "bg-teal/15 text-teal"
                : "bg-slate-200 text-slate-500"
          }`}
        >
          {done ? "✓" : step}
        </span>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      </header>
      <div>{children}</div>
    </section>
  );
}

function DebbyAudioButton({
  parts,
  speech,
}: {
  parts: string | string[];
  speech: UseDebbySpeechResult;
}) {
  const list = (Array.isArray(parts) ? parts : [parts]).filter(
    (part): part is string => Boolean(part && part.trim()),
  );
  if (list.length === 0) return null;
  const playParts = list.length === 1 ? list[0] : list;
  const key = speechKey(playParts);
  const isActive = speech.activeKey === key;
  const loading = isActive && speech.state === "loading";
  const playing = isActive && speech.state === "playing";
  const errored = isActive && speech.state === "error";

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => void speech.play(playParts)}
        disabled={loading}
        className={secondaryButtonClass}
      >
        {loading ? "Loading audio..." : playing ? "Stop audio" : "Play audio"}
      </button>
      {errored && speech.error && (
        <span className="text-xs text-red-600">{speech.error}</span>
      )}
    </div>
  );
}

export function RoundRunner() {
  const speech = useDebbySpeech();
  const searchParams = useSearchParams();
  const classId = searchParams?.get("class") ?? null;
  const assignmentRecipientId = searchParams?.get("assignment") ?? null;
  const [step, setStep] = useState<Step>(1);

  // Step 1
  const [format, setFormat] = useState<Format>("parli");
  const [tournament, setTournament] = useState<string>("");
  const [tournaments, setTournaments] = useState<string[]>([]);
  const [topic, setTopic] = useState<TopicResponse | null>(null);
  const [customTopic, setCustomTopic] = useState("");
  const [customSide, setCustomSide] = useState<Side>("aff");
  const [topicLoading, setTopicLoading] = useState(false);
  const [topicError, setTopicError] = useState<string | null>(null);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [assignmentDetail, setAssignmentDetail] =
    useState<AssignmentRecipientDetail | null>(null);
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const [assignmentCompleted, setAssignmentCompleted] = useState(false);

  // Step 2
  const [affTranscript, setAffTranscript] = useState<string | null>(null);
  const [affWpm, setAffWpm] = useState<WpmPoint[]>([]);
  const [affLoading, setAffLoading] = useState(false);
  const [affAiRequested, setAffAiRequested] = useState(false);
  const [affAiError, setAffAiError] = useState<string | null>(null);

  // Step 3
  const [negCase, setNegCase] = useState<string | null>(null);
  const [negRebuttalPara, setNegRebuttalPara] = useState<string | null>(null);
  const [negDone, setNegDone] = useState(false);
  const [negLoading, setNegLoading] = useState(false);
  const [negRequested, setNegRequested] = useState(false);
  const [negError, setNegError] = useState<string | null>(null);
  const [negWpm, setNegWpm] = useState<WpmPoint[]>([]);

  // Step 4
  const [affOverview, setAffOverview] = useState<string | null>(null);
  const [affRebuttalPara, setAffRebuttalPara] = useState<string | null>(null);
  const [affTwoWpm, setAffTwoWpm] = useState<WpmPoint[]>([]);
  const [affTwoLoading, setAffTwoLoading] = useState(false);
  const [affTwoRequested, setAffTwoRequested] = useState(false);
  const [affTwoError, setAffTwoError] = useState<string | null>(null);

  // Step 5
  const [judgment, setJudgment] = useState<JudgmentResponse | null>(null);
  const [judgmentLoading, setJudgmentLoading] = useState(false);
  const [judgmentRequested, setJudgmentRequested] = useState(false);
  const [judgmentError, setJudgmentError] = useState<string | null>(null);
  const [speechDurationSeconds, setSpeechDurationSeconds] = useState(120);

  const abortRef = useRef<AbortController | null>(null);
  const affStartedRef = useRef(false);
  const negStartedRef = useRef(false);
  const negRebuttalStartedRef = useRef(false);
  const affTwoStartedRef = useRef(false);
  const judgmentStartedRef = useRef(false);
  const affPromiseRef = useRef<Promise<string> | null>(null);
  const negCaseRef = useRef<Promise<string> | null>(null);
  const negRebuttalRef = useRef<Promise<string> | null>(null);
  const affOverviewRef = useRef<Promise<string> | null>(null);
  const affRebuttalRef = useRef<Promise<string> | null>(null);
  const judgmentPromiseRef = useRef<Promise<JudgmentResponse> | null>(null);
  const userSide = topic?.side ?? "aff";
  const userIsAff = userSide === "aff";
  const negTokens = [negCase, negRebuttalPara].filter(Boolean).join("\n\n");
  const affTwoTranscript = userIsAff
    ? [affOverview, affRebuttalPara].filter(Boolean).join("\n\n")
    : (affRebuttalPara ?? "");
  const assignmentPayload =
    assignmentDetail && isPracticePayload(assignmentDetail.assignment)
      ? assignmentDetail.assignment.payload
      : null;
  const assignmentLocked = Boolean(assignmentPayload);
  const affSpeechReady = Boolean(affTranscript?.trim());
  const affRebuttalReady = Boolean(affTwoTranscript.trim());
  const customTopicWordCount = countWords(customTopic);
  const customTopicTooLong = customTopicWordCount > TOPIC_WORD_LIMIT;
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let ignore = false;

    async function loadTournaments() {
      try {
        const data = await apiFetch<TournamentListResponse>("/api/topics/tournaments");
        if (!ignore) setTournaments(data.tournaments);
      } catch {
        if (!ignore) setTournaments([]);
      }
    }

    loadTournaments();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    let ignore = false;
    async function loadAssignment() {
      if (!assignmentRecipientId) {
        setAssignmentDetail(null);
        setAssignmentCompleted(false);
        return;
      }
      setAssignmentLoading(true);
      setTopicError(null);
      try {
        const detail = await apiFetch<AssignmentRecipientDetail>(
          `/api/assignments/${assignmentRecipientId}`,
        );
        if (ignore) return;
        if (!isPracticePayload(detail.assignment)) {
          throw new Error("This assignment is not a practice round.");
        }
        const payload = detail.assignment.payload;
        setAssignmentDetail(detail);
        setAssignmentCompleted(detail.recipient.status === "completed");
        setFormat(payload.format);
        setSpeechDurationSeconds(payload.speech_duration_seconds);
        setCustomTopic(payload.topic);
        setCustomSide(payload.side);
        setTopic({
          topic: payload.topic,
          side: payload.side,
          format: payload.format,
        });
      } catch (err) {
        if (!ignore) {
          setTopicError(err instanceof Error ? err.message : "Failed to load assignment");
        }
      } finally {
        if (!ignore) setAssignmentLoading(false);
      }
    }
    void loadAssignment();
    return () => {
      ignore = true;
    };
  }, [assignmentRecipientId]);

  const handleFormatChange = useCallback((nextFormat: Format) => {
    if (assignmentLocked) return;
    setFormat(nextFormat);
    setTopic(null);
    setTopicError(null);
    if (nextFormat !== "parli") setTournament("");
  }, [assignmentLocked]);

  const handleGetTopic = useCallback(async () => {
    if (assignmentLocked) return;
    setTopicError(null);
    setTopicLoading(true);
    try {
      const params = new URLSearchParams({ format });
      if (format === "parli" && tournament) params.set("tournament", tournament);
      const t = await apiFetch<TopicResponse>(`/api/topics?${params.toString()}`);
      setTopic(t);
    } catch (err) {
      setTopicError(err instanceof Error ? err.message : "Failed to load topic");
    } finally {
      setTopicLoading(false);
    }
  }, [assignmentLocked, format, tournament]);

  const handleUseCustomTopic = useCallback(() => {
    if (assignmentLocked) return;
    const trimmed = customTopic.trim();
    if (!trimmed) {
      setTopicError("Enter a custom topic first.");
      return;
    }
    if (customTopicTooLong) {
      setTopicError(`Custom topics must be ${TOPIC_WORD_LIMIT} words or fewer.`);
      return;
    }
    setTopicError(null);
    setTopic({
      topic: trimmed,
      side: customSide,
      format,
    });
  }, [assignmentLocked, customSide, customTopic, customTopicTooLong, format]);

  const handleAcceptTopic = useCallback(async () => {
    if (!topic) return;
    setTopicError(null);
    try {
      let nextRoundId: string | null = null;
      if (assignmentRecipientId) {
        const started = await apiFetch<StartAssignmentResponse>(
          `/api/assignments/${assignmentRecipientId}/start`,
          { method: "POST" },
        );
        nextRoundId = started.round_id ?? null;
        setAssignmentDetail((current) =>
          current ? { ...current, recipient: started.recipient } : current,
        );
      } else {
        const round = await apiFetch<RoundResponse>("/api/rounds", {
          method: "POST",
          body: JSON.stringify({
            format: topic.format,
            topic: topic.topic,
            side: topic.side,
          }),
        });
        nextRoundId = round.id;
      }
      if (!nextRoundId) throw new Error("Failed to start round");
      setRoundId(nextRoundId);
      setStep(2);
      speech.stop();
      affStartedRef.current = false;
      negStartedRef.current = false;
      negRebuttalStartedRef.current = false;
      affTwoStartedRef.current = false;
      judgmentStartedRef.current = false;
      affPromiseRef.current = null;
      negCaseRef.current = null;
      negRebuttalRef.current = null;
      affOverviewRef.current = null;
      affRebuttalRef.current = null;
      judgmentPromiseRef.current = null;
      setAffTranscript(null);
      setAffWpm([]);
      setAffAiRequested(false);
      setAffAiError(null);
      setNegCase(null);
      setNegRebuttalPara(null);
      setNegDone(false);
      setNegRequested(false);
      setNegError(null);
      setNegWpm([]);
      setAffOverview(null);
      setAffRebuttalPara(null);
      setAffTwoWpm([]);
      setAffTwoRequested(false);
      setAffTwoError(null);
      setJudgment(null);
      setJudgmentRequested(false);
      setJudgmentError(null);
    } catch (err) {
      setTopicError(err instanceof Error ? err.message : "Failed to start round");
    }
  }, [assignmentRecipientId, speech, topic]);

  const handlePracticeAgain = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    speech.stop();
    affStartedRef.current = false;
    negStartedRef.current = false;
    negRebuttalStartedRef.current = false;
    affTwoStartedRef.current = false;
    judgmentStartedRef.current = false;
    affPromiseRef.current = null;
    negCaseRef.current = null;
    negRebuttalRef.current = null;
    affOverviewRef.current = null;
    affRebuttalRef.current = null;
    judgmentPromiseRef.current = null;
    setStep(1);
    setTopic(null);
    setCustomTopic("");
    setCustomSide("aff");
    setTopicError(null);
    setRoundId(null);
    setAffTranscript(null);
    setAffWpm([]);
    setAffLoading(false);
    setAffAiRequested(false);
    setAffAiError(null);
    setNegCase(null);
    setNegRebuttalPara(null);
    setNegDone(false);
    setNegLoading(false);
    setNegRequested(false);
    setNegError(null);
    setNegWpm([]);
    setAffOverview(null);
    setAffRebuttalPara(null);
    setAffTwoWpm([]);
    setAffTwoLoading(false);
    setAffTwoRequested(false);
    setAffTwoError(null);
    setJudgment(null);
    setJudgmentLoading(false);
    setJudgmentRequested(false);
    setJudgmentError(null);
  }, [speech]);

  const uploadSpeech = useCallback(
    async (
      blob: Blob,
      speechType: "aff" | "neg" | "aff_two",
      realtimeTranscript?: RealtimeTranscriptResult | null,
    ): Promise<SpeechResponse> => {
      if (!roundId) throw new Error("No round id");
      if (realtimeTranscript?.transcript.trim()) {
        return apiFetch<SpeechResponse>(`/api/rounds/${roundId}/speeches/text`, {
          method: "POST",
          body: JSON.stringify({
            speech_type: speechType,
            transcript: realtimeTranscript.transcript,
            duration_seconds: realtimeTranscript.durationSeconds,
            words: realtimeTranscript.words,
          }),
        });
      }
      throw new Error("Realtime transcription failed before the speech could be saved.");
    },
    [roundId],
  );

  const handleAffComplete = useCallback(
    async (blob: Blob, realtimeTranscript?: RealtimeTranscriptResult | null) => {
      setAffLoading(true);
      try {
        const res = await uploadSpeech(blob, "aff", realtimeTranscript);
        setAffTranscript(res.transcript);
        setAffWpm(res.wpm_series ?? []);
        negStartedRef.current = false;
        negCaseRef.current = null;
        negRebuttalRef.current = null;
        setNegRequested(false);
        setStep(3);
      } finally {
        setAffLoading(false);
      }
    },
    [uploadSpeech],
  );

  const prefetchAiAffSpeech = useCallback(async (): Promise<string> => {
    if (!topic) return "";
    if (affTranscript?.trim()) return affTranscript;
    if (affPromiseRef.current) return affPromiseRef.current;

    setAffAiError(null);
    setAffLoading(true);
    const promise = streamGeneratedSpeech(
      {
        kind: "aff_speech",
        topic: topic.topic,
        side: "aff",
      },
      {
        onTextReady: (finalText, initialAudioChunks) => {
          setAffTranscript(finalText || null);
          speech.beginStreamingAudio(finalText, initialAudioChunks);
          setAffLoading(false);
        },
        onAudioChunk: (chunk, finalText) => {
          speech.appendStreamingAudio(finalText, chunk);
        },
        onComplete: (audioChunks, finalText) =>
          speech.finishStreamingAudio(finalText, audioChunks),
      },
    )
      .then((finalText) => {
        setAffTranscript(finalText);
        return finalText;
      })
      .catch((err) => {
        setAffLoading(false);
        setAffAiError(
          err instanceof Error ? err.message : "Failed to generate affirmative speech",
        );
        throw err;
      })
      .finally(() => {
        affPromiseRef.current = null;
      });

    affPromiseRef.current = promise;
    return promise;
  }, [topic, affTranscript, speech]);

  const revealAiAffSpeech = useCallback(async () => {
    setAffAiRequested(true);
    try {
      await prefetchAiAffSpeech();
    } catch {
      // Error text is already stored for the UI.
    }
  }, [prefetchAiAffSpeech]);

  const prefetchNegCase = useCallback(async (): Promise<string> => {
    if (!topic) return "";
    if (negCase?.trim()) return negCase;
    if (negCaseRef.current) return negCaseRef.current;

    setNegError(null);
    setNegLoading(true);
    const promise = streamGeneratedSpeech(
      {
        kind: "neg_framework",
        topic: topic.topic,
      },
      {
        onTextReady: (finalText, initialAudioChunks) => {
          setNegCase(finalText || null);
          speech.beginStreamingAudio(finalText, initialAudioChunks);
          setNegLoading(false);
        },
        onAudioChunk: (chunk, finalText) => {
          speech.appendStreamingAudio(finalText, chunk);
        },
        onComplete: (audioChunks, finalText) =>
          speech.finishStreamingAudio(finalText, audioChunks),
      },
    )
      .then((finalText) => {
        setNegCase(finalText);
        return finalText;
      })
      .catch((err) => {
        setNegLoading(false);
        setNegError(err instanceof Error ? err.message : "Failed to generate neg case");
        throw err;
      })
      .finally(() => {
        negCaseRef.current = null;
      });

    negCaseRef.current = promise;
    return promise;
  }, [topic, negCase, speech]);

  const prefetchNegRebuttal = useCallback(async (): Promise<string> => {
    if (!topic || !affTranscript) return "";
    if (negRebuttalPara?.trim()) return negRebuttalPara;
    if (negRebuttalRef.current) return negRebuttalRef.current;

    const caseText = await (negCaseRef.current ?? prefetchNegCase());
    if (!caseText.trim()) return "";

    const promise = streamGeneratedSpeech(
      {
        kind: "neg_rebuttal",
        topic: topic.topic,
        neg_case: caseText,
        aff_speech: affTranscript,
      },
      {
        onTextReady: (finalText, initialAudioChunks) => {
          setNegRebuttalPara(finalText || null);
          setNegDone(true);
          speech.beginStreamingAudio(finalText, initialAudioChunks);
        },
        onAudioChunk: (chunk, finalText) => {
          speech.appendStreamingAudio(finalText, chunk);
        },
        onComplete: (audioChunks, finalText) =>
          speech.finishStreamingAudio(finalText, audioChunks),
      },
    )
      .then((finalText) => {
        setNegRebuttalPara(finalText);
        setNegDone(true);
        return finalText;
      })
      .catch((err) => {
        setNegError(
          err instanceof Error ? err.message : "Failed to generate neg rebuttal",
        );
        throw err;
      })
      .finally(() => {
        negRebuttalRef.current = null;
      });

    negRebuttalRef.current = promise;
    return promise;
  }, [topic, affTranscript, negRebuttalPara, prefetchNegCase, speech]);

  const revealAiOpposition = useCallback(async () => {
    setNegRequested(true);
    try {
      await Promise.all([
        negCaseRef.current ?? prefetchNegCase(),
        negRebuttalRef.current ?? prefetchNegRebuttal(),
      ]);
    } catch {
      // Error text is already stored for the UI.
    }
  }, [prefetchNegCase, prefetchNegRebuttal]);

  const handleNegComplete = useCallback(
    async (blob: Blob, realtimeTranscript?: RealtimeTranscriptResult | null) => {
      setNegLoading(true);
      try {
        const res = await uploadSpeech(blob, "neg", realtimeTranscript);
        setNegCase(res.transcript);
        setNegRebuttalPara(null);
        setNegDone(true);
        setNegWpm(res.wpm_series ?? []);
        affTwoStartedRef.current = false;
        affOverviewRef.current = null;
        affRebuttalRef.current = null;
        setAffTwoRequested(false);
        setAffTwoError(null);
        setStep(4);
      } finally {
        setNegLoading(false);
      }
    },
    [uploadSpeech],
  );

  const handleAffTwoComplete = useCallback(
    async (blob: Blob, realtimeTranscript?: RealtimeTranscriptResult | null) => {
      setAffTwoLoading(true);
      try {
        const res = await uploadSpeech(blob, "aff_two", realtimeTranscript);
        setAffOverview(res.transcript);
        setAffRebuttalPara(null);
        setAffTwoWpm(res.wpm_series ?? []);
        judgmentStartedRef.current = false;
        judgmentPromiseRef.current = null;
        setJudgmentRequested(false);
        setStep(5);
      } finally {
        setAffTwoLoading(false);
      }
    },
    [uploadSpeech],
  );

  const prefetchAffRebuttal = useCallback(async (): Promise<string> => {
    if (!topic || !affTranscript || !negTokens.trim()) return "";
    if (affRebuttalPara?.trim()) return affRebuttalPara;
    if (affRebuttalRef.current) return affRebuttalRef.current;

    setAffTwoError(null);
    setAffTwoLoading(true);
    const promise = streamGeneratedSpeech(
      {
        kind: "aff_rebuttal",
        topic: topic.topic,
        aff_speech: affTranscript,
        neg_speech: negTokens,
      },
      {
        onTextReady: (finalText, initialAudioChunks) => {
          setAffRebuttalPara(finalText || null);
          speech.beginStreamingAudio(finalText, initialAudioChunks);
          setAffTwoLoading(false);
        },
        onAudioChunk: (chunk, finalText) => {
          speech.appendStreamingAudio(finalText, chunk);
        },
        onComplete: (audioChunks, finalText) =>
          speech.finishStreamingAudio(finalText, audioChunks),
      },
    )
      .then((finalText) => {
        setAffRebuttalPara(finalText);
        return finalText;
      })
      .catch((err) => {
        setAffTwoLoading(false);
        setAffTwoError(
          err instanceof Error ? err.message : "Failed to generate affirmative rebuttal",
        );
        throw err;
      })
      .finally(() => {
        affRebuttalRef.current = null;
      });

    affRebuttalRef.current = promise;
    return promise;
  }, [topic, affTranscript, negTokens, affRebuttalPara, speech]);

  const revealAiAffRebuttal = useCallback(async () => {
    setAffTwoRequested(true);
    try {
      await (affRebuttalRef.current ?? prefetchAffRebuttal());
    } catch {
      // Error text is already stored for the UI.
    }
  }, [prefetchAffRebuttal]);

  const prefetchJudgment = useCallback(async (): Promise<JudgmentResponse> => {
    if (!topic || !affTranscript || !affTwoTranscript) {
      throw new Error("Finish the speeches before judging.");
    }
    if (!negTokens.trim()) {
      throw new Error("Finish the negative speech before judging.");
    }
    if (judgment) return judgment;
    if (judgmentPromiseRef.current) return judgmentPromiseRef.current;

    setJudgmentError(null);
    judgmentStartedRef.current = true;
    setJudgmentLoading(true);
    const promise = apiFetch<JudgmentResponse>("/api/ai/judgment", {
        method: "POST",
        body: JSON.stringify({
          round_id: roundId,
          topic: topic.topic,
          aff_speech: affTranscript,
          neg_speech: negTokens,
          aff_two_speech: affTwoTranscript,
        }),
      })
      .then(async (res) => {
        setJudgment(res);
        if (assignmentRecipientId && roundId && !assignmentCompleted) {
          const detail = await apiFetch<AssignmentRecipientDetail>(
            `/api/assignments/${assignmentRecipientId}/complete`,
            {
              method: "POST",
              body: JSON.stringify({ round_id: roundId }),
            },
          );
          setAssignmentDetail(detail);
          setAssignmentCompleted(detail.recipient.status === "completed");
        }
        return res;
      })
      .catch((err) => {
        setJudgmentError(
          err instanceof Error ? err.message : "Failed to fetch judgment",
        );
        throw err;
      })
      .finally(() => {
        setJudgmentLoading(false);
        judgmentPromiseRef.current = null;
      });

    judgmentPromiseRef.current = promise;
    return promise;
  }, [
    topic,
    affTranscript,
    affTwoTranscript,
    negTokens,
    judgment,
    roundId,
    assignmentRecipientId,
    assignmentCompleted,
  ]);

  const revealJudgment = useCallback(async () => {
    setJudgmentRequested(true);
    try {
      await prefetchJudgment();
    } catch (err) {
      setJudgmentError(
        err instanceof Error ? err.message : "Failed to fetch judgment",
      );
    }
  }, [prefetchJudgment]);

  const handleJudgment = useCallback(async () => {
    await revealJudgment();
  }, [revealJudgment]);

  useEffect(() => {
    if (
      userIsAff &&
      step === 2 &&
      topic &&
      !negCase?.trim() &&
      !negLoading &&
      !negStartedRef.current
    ) {
      negStartedRef.current = true;
      void prefetchNegCase().catch(() => undefined);
    }
  }, [
    userIsAff,
    step,
    topic,
    negCase,
    negLoading,
    prefetchNegCase,
  ]);

  useEffect(() => {
    if (
      userIsAff &&
      step === 3 &&
      topic &&
      affTranscript &&
      !negRebuttalPara?.trim() &&
      !negRebuttalStartedRef.current
    ) {
      negRebuttalStartedRef.current = true;
      void prefetchNegRebuttal().catch(() => undefined);
    }
  }, [
    userIsAff,
    step,
    topic,
    affTranscript,
    negRebuttalPara,
    prefetchNegRebuttal,
  ]);

  useEffect(() => {
    if (
      !userIsAff &&
      step === 2 &&
      topic &&
      !affTranscript?.trim() &&
      !affLoading &&
      !affStartedRef.current
    ) {
      affStartedRef.current = true;
      void prefetchAiAffSpeech().catch(() => undefined);
    }
  }, [
    userIsAff,
    step,
    topic,
    affTranscript,
    affLoading,
    prefetchAiAffSpeech,
  ]);

  useEffect(() => {
    if (
      !userIsAff &&
      step === 4 &&
      topic &&
      affTranscript &&
      negTokens.trim() &&
      !affRebuttalPara?.trim() &&
      !affTwoLoading &&
      !affTwoStartedRef.current
    ) {
      affTwoStartedRef.current = true;
      void prefetchAffRebuttal().catch(() => undefined);
    }
  }, [
    userIsAff,
    step,
    topic,
    affTranscript,
    negTokens,
    affRebuttalPara,
    affTwoLoading,
    prefetchAffRebuttal,
  ]);

  useEffect(() => {
    if (
      topic &&
      affTranscript &&
      affTwoTranscript &&
      negTokens.trim() &&
      !judgment &&
      !judgmentLoading &&
      !judgmentStartedRef.current
    ) {
      void prefetchJudgment().catch(() => undefined);
    }
  }, [
    topic,
    affTranscript,
    affTwoTranscript,
    negTokens,
    judgment,
    judgmentLoading,
    prefetchJudgment,
  ]);

  // ensure supabase module is referenced so build trees include it (auth bearer paths)
  void getBrowserSupabase;

  return (
    <main className="mx-auto grid max-w-6xl gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-slate-900">Practice Round</h1>

      {assignmentDetail && (
        <section className="rounded-lg border border-teal/30 bg-teal/5 p-4 text-sm shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-semibold text-teal-dark">
                {assignmentDetail.assignment.title}
              </div>
              <div className="text-slate-600">
                {assignmentDetail.class_room.name} / {assignmentPayload?.format} /{" "}
                {assignmentPayload?.side} / {assignmentPayload?.speech_duration_seconds}s
              </div>
            </div>
            <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-semibold text-teal-dark">
              {assignmentCompleted
                ? "Completed"
                : statusLabel(assignmentDetail.recipient.status)}
            </span>
          </div>
        </section>
      )}

      <StepCard step={1} title="Pick a topic" active={step === 1} done={step > 1}>
        <div className="flex flex-col gap-4">
          <label className={fieldLabelClass}>
            Format
            <select
              aria-label="Format"
              value={format}
              onChange={(e) => handleFormatChange(e.target.value as Format)}
              disabled={step > 1 || assignmentLocked}
              className={fieldControlClass}
            >
              <option value="parli">Parli</option>
              <option value="mspdp">MSPDP</option>
            </select>
          </label>
          {format === "parli" && (
            <label className={fieldLabelClass}>
              Tournament
              <select
                aria-label="Tournament"
                value={tournament}
                onChange={(e) => setTournament(e.target.value)}
                disabled={step > 1 || assignmentLocked}
                className={fieldControlClass}
              >
                <option value="">No Tournament</option>
                {tournaments.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleGetTopic}
              disabled={topicLoading || step > 1 || assignmentLocked}
              className={primaryButtonClass}
            >
            {topicLoading ? "Loading…" : "Get topic"}
            </button>
          </div>
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem_auto] md:items-start">
              <label className={fieldLabelClass}>
                Custom topic
                <input
                  aria-label="Custom topic"
                  value={customTopic}
                  onChange={(event) => setCustomTopic(event.target.value)}
                  disabled={step > 1 || assignmentLocked}
                  placeholder="Enter your own topic..."
                  className={fieldControlClass}
                />
                <div className="flex justify-between text-xs font-normal">
                  {customTopicTooLong ? (
                    <span className="text-red-600">
                      Topics must be {TOPIC_WORD_LIMIT} words or fewer.
                    </span>
                  ) : (
                    <span className="text-slate-500">
                      {TOPIC_WORD_LIMIT - customTopicWordCount} words left
                    </span>
                  )}
                  <span
                    className={
                      customTopicTooLong ? "text-red-600" : "text-slate-400"
                    }
                  >
                    {customTopicWordCount}/{TOPIC_WORD_LIMIT}
                  </span>
                </div>
              </label>
              <label className={fieldLabelClass}>
                Your side
                <select
                  aria-label="Custom side"
                  value={customSide}
                  onChange={(event) => setCustomSide(event.target.value as Side)}
                  disabled={step > 1 || assignmentLocked}
                  className={fieldControlClass}
                >
                  <option value="aff">Affirmative</option>
                  <option value="neg">Negative</option>
                </select>
                <div className="h-4 text-xs font-normal" aria-hidden="true" />
              </label>
              <button
                type="button"
                onClick={handleUseCustomTopic}
                disabled={
                  step > 1 || assignmentLocked || !customTopic.trim() || customTopicTooLong
                }
                className={`${secondaryButtonClass} md:mt-6`}
              >
                Use custom topic
              </button>
            </div>
          </div>
          {topicError && <p className="text-sm text-red-600">{topicError}</p>}
          {topic && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-medium text-slate-900">{topic.topic}</p>
              <p className="sr-only">
                Side: {topic.side} · {topic.format}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full bg-teal/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-teal-dark">
                  Your side: {SIDE_LABEL[topic.side]}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {topic.format}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {topic.side === "aff"
                  ? "You speak first for the affirmative. Debby answers as negative."
                  : "Debby speaks first for the affirmative. You answer as negative."}
              </p>
              {step === 1 && (
                <button
                  type="button"
                  onClick={handleAcceptTopic}
                  disabled={assignmentLoading || assignmentCompleted}
                  className={`mt-3 ${primaryButtonClass}`}
                >
                  {assignmentCompleted ? "Assignment completed" : "Accept topic"}
                </button>
              )}
            </div>
          )}
        </div>
      </StepCard>

      <StepCard step={2} title="Aff speech" active={step === 2} done={step > 2}>
        {step >= 2 ? (
          <div className="flex flex-col gap-3">
            {userIsAff ? (
              <>
                <p className="text-sm font-medium text-slate-700">
                  You are speaking for the affirmative.
                </p>
                <RecordButton
              onComplete={handleAffComplete}
              label="Record Aff speech"
              disabled={step !== 2 || affLoading}
              maxDurationSeconds={speechDurationSeconds}
              realtimeTranscription
            />
            {affLoading && <p className="text-sm text-slate-500">Uploading…</p>}
            {affTranscript && (
              <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
                  Transcript
                </div>
                {affTranscript}
              </div>
            )}
                {affWpm.length > 0 && <WpmChart series={affWpm} />}
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-slate-700">
                  Debby is speaking first for the affirmative.
                </p>
                <button
                  type="button"
                  onClick={revealAiAffSpeech}
                  disabled={step !== 2 || (affAiRequested && affLoading)}
                  className={primaryButtonClass}
                >
                  {affAiRequested && affLoading
                    ? "Generating..."
                    : "Generate Aff speech"}
                </button>
                {affAiError && <p className="text-sm text-red-600">{affAiError}</p>}
                {affAiRequested && affSpeechReady && affTranscript && (
                  <DebbyAudioButton parts={affTranscript} speech={speech} />
                )}
                {step === 2 && affAiRequested && affSpeechReady && affTranscript && (
                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    className={secondaryButtonClass}
                  >
                    Continue to Neg speech
                  </button>
                )}
                {affAiRequested && affSpeechReady && affTranscript && (
                  <div
                    data-testid="aff-transcript"
                    className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-700"
                  >
                    <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
                      Debby's Aff speech
                    </div>
                    {affTranscript}
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Complete step 1 first.</p>
        )}
      </StepCard>

      <StepCard
        step={3}
        title="Neg speech"
        active={step === 3}
        done={step > 3}
      >
        {step >= 3 ? (
          <div className="flex flex-col gap-3">
            {userIsAff ? (
              <>
                <p className="text-sm font-medium text-slate-700">
                  Debby answers as the negative.
                </p>
            <button
              type="button"
              onClick={revealAiOpposition}
              disabled={step !== 3 || (negRequested && negLoading)}
              className={primaryButtonClass}
            >
              {negRequested && negLoading ? "Generating..." : "Generate Neg speech"}
            </button>
            {negError && <p className="text-sm text-red-600">{negError}</p>}
            {negRequested && negDone && negTokens && (
              <div
                data-testid="neg-tokens"
                className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-700"
              >
                {negTokens}
              </div>
            )}
            {negRequested && negDone && negTokens.trim().length > 0 && (
              <DebbyAudioButton
                parts={[negCase, negRebuttalPara].filter(Boolean) as string[]}
                speech={speech}
              />
            )}
            {step === 3 && negRequested && negDone && negTokens.trim().length > 0 && (
              <button
                type="button"
                onClick={() => setStep(4)}
                className={secondaryButtonClass}
              >
                Continue to Aff rebuttal
              </button>
            )}
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-slate-700">
                  You are speaking for the negative.
                </p>
                <RecordButton
                  onComplete={handleNegComplete}
                  label="Record Neg speech"
                  disabled={step !== 3 || negLoading}
                  maxDurationSeconds={speechDurationSeconds}
                  realtimeTranscription
                />
                {negLoading && <p className="text-sm text-slate-500">Uploading...</p>}
                {negWpm.length > 0 && <WpmChart series={negWpm} />}
                {negTokens && (
                  <div
                    data-testid="neg-tokens"
                    className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-700"
                  >
                    <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
                      Transcript
                    </div>
                    {negTokens}
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Complete the Aff speech first.</p>
        )}
      </StepCard>

      <StepCard step={4} title="Aff rebuttal" active={step === 4} done={step > 4}>
        {step >= 4 ? (
          <div className="flex flex-col gap-3">
            {userIsAff ? (
              <>
                <p className="text-sm font-medium text-slate-700">
                  You close for the affirmative.
                </p>
            <RecordButton
              onComplete={handleAffTwoComplete}
              label="Record Aff rebuttal"
              disabled={step !== 4 || affTwoLoading}
              maxDurationSeconds={speechDurationSeconds}
              realtimeTranscription
            />
            {affTwoLoading && <p className="text-sm text-slate-500">Uploading…</p>}
            {affTwoTranscript && (
              <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
                  Transcript
                </div>
                {affTwoTranscript}
              </div>
            )}
            {affTwoWpm.length > 0 && <WpmChart series={affTwoWpm} />}
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-slate-700">
                  Debby gives a short affirmative rebuttal.
                </p>
                <button
                  type="button"
                  onClick={revealAiAffRebuttal}
                  disabled={step !== 4 || (affTwoRequested && affTwoLoading)}
                  className={primaryButtonClass}
                >
                  {affTwoRequested && affTwoLoading
                    ? "Generating..."
                    : "Generate Aff rebuttal"}
                </button>
                {affTwoError && <p className="text-sm text-red-600">{affTwoError}</p>}
                {affTwoRequested && affRebuttalReady && affTwoTranscript && (
                  <DebbyAudioButton
                    parts={affTwoTranscript}
                    speech={speech}
                  />
                )}
                {affTwoRequested && affRebuttalReady && affTwoTranscript && (
                  <div className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                    <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
                      Debby's Aff rebuttal
                    </div>
                    {affTwoTranscript}
                  </div>
                )}
                {step === 4 && affTwoRequested && affRebuttalReady && affTwoTranscript && (
                  <button
                    type="button"
                    onClick={() => setStep(5)}
                    className={secondaryButtonClass}
                  >
                    Continue to judgment
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Finish the Neg speech first.</p>
        )}
      </StepCard>

      <StepCard
        step={5}
        title="Judgment"
        active={step === 5}
        done={judgmentRequested && !!judgment}
      >
        {step >= 5 ? (
          <div className="flex flex-col gap-4">
            {!judgmentRequested && (
              <button
                type="button"
                onClick={handleJudgment}
                disabled={false}
                className={primaryButtonClass}
              >
                Judge debate
              </button>
            )}
            {judgmentRequested && !judgment && (
              <button
                type="button"
                disabled
                className={primaryButtonClass}
              >
                {judgmentLoading ? "Judging..." : "Judge debate"}
              </button>
            )}
            {judgmentError && (
              <p className="text-sm text-red-600">{judgmentError}</p>
            )}
            {judgmentRequested && judgment && (
              <>
                <RfdCard
                  rfd={judgment.rfd}
                  winnerSide={judgment.winner_side ?? null}
                  winnerLabel={winnerLabel(judgment.winner_side, userSide)}
                />
                  {roundId && (
                    <a
                      href={withClassContext(`/library/rounds/${roundId}`, classId)}
                      className="text-sm text-teal underline"
                    >
                    round saved in Library
                  </a>
                )}
                {assignmentDetail ? (
                  <a href="/classes" className={secondaryButtonClass}>
                    Back to Classes
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={handlePracticeAgain}
                    className={secondaryButtonClass}
                  >
                    Practice again
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Finish the rebuttal first.</p>
        )}
      </StepCard>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Timer
          </h2>
          {step === 1 ? (
            <label className="mt-4 flex flex-col gap-1 text-sm font-medium text-slate-700">
              Speech length
              <select
                aria-label="Speech timer"
                value={speechDurationSeconds}
                onChange={(event) => setSpeechDurationSeconds(Number(event.target.value))}
                disabled={assignmentLocked}
                className={fieldControlClass}
              >
                {timerOptions.map((option) => (
                  <option key={option.seconds} value={option.seconds}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="mt-4 text-sm font-medium text-slate-700">
              Speech length
            </div>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          WPM charts appear under each speech after transcription.
        </section>
      </aside>
    </main>
  );
}
