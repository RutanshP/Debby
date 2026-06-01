"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";
import { getBrowserSupabase } from "../../lib/supabase";
import { RecordButton } from "../../components/RecordButton";
import { RfdCard } from "../../components/RfdCard";
import type { FlowSheetData } from "../../components/FlowSheet";
import { WpmChart, type WpmPoint } from "../../components/WpmChart";
import {
  useDebbySpeech,
  speechKey,
  type UseDebbySpeechResult,
} from "../../hooks/useDebbySpeech";

type Format = "parli" | "mspdp";
type Side = "aff" | "neg";

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

interface AiSpeechResponse {
  speech: string;
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

function formatDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
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
    (p): p is string => Boolean(p && p.trim()),
  );
  if (list.length === 0) return null;
  const playParts = list.length === 1 ? list[0] : list;
  const key = speechKey(playParts);
  const isThis = speech.activeKey === key;
  const loading = isThis && speech.state === "loading";
  const playing = isThis && speech.state === "playing";
  const errored = isThis && speech.state === "error";
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => void speech.play(playParts)}
        disabled={loading}
        className={secondaryButtonClass}
      >
        {loading ? "Loading audio…" : playing ? "■ Stop" : "▶ Play audio"}
      </button>
      {errored && speech.error && (
        <span className="text-xs text-red-600">{speech.error}</span>
      )}
    </div>
  );
}

export function RoundRunner() {
  const speech = useDebbySpeech();

  const [step, setStep] = useState<Step>(1);

  // Step 1
  const [format, setFormat] = useState<Format>("parli");
  const [tournament, setTournament] = useState<string>("");
  const [tournaments, setTournaments] = useState<string[]>([]);
  const [topic, setTopic] = useState<TopicResponse | null>(null);
  const [topicLoading, setTopicLoading] = useState(false);
  const [topicError, setTopicError] = useState<string | null>(null);
  const [roundId, setRoundId] = useState<string | null>(null);

  // Step 2
  const [affTranscript, setAffTranscript] = useState<string | null>(null);
  const [affWpm, setAffWpm] = useState<WpmPoint[]>([]);
  const [affLoading, setAffLoading] = useState(false);
  const [affAiRequested, setAffAiRequested] = useState(false);
  const [affAiError, setAffAiError] = useState<string | null>(null);

  // Step 3 — Neg speech (user is AFF: Debby neg; user is NEG: user speaks)
  // Debby's neg = negCase + negRebuttalPara spliced together.
  const [negCase, setNegCase] = useState<string | null>(null);
  const [negRebuttalPara, setNegRebuttalPara] = useState<string | null>(null);
  const [negDone, setNegDone] = useState(false);
  const [negLoading, setNegLoading] = useState(false);
  const [negRequested, setNegRequested] = useState(false);
  const [negError, setNegError] = useState<string | null>(null);
  const [negWpm, setNegWpm] = useState<WpmPoint[]>([]);

  // Step 4 — Aff rebuttal (user is NEG: Debby aff-2; user is AFF: user speaks)
  // Debby's aff-2 = affOverview + affRebuttalPara spliced together.
  const [affOverview, setAffOverview] = useState<string | null>(null);
  const [affRebuttalPara, setAffRebuttalPara] = useState<string | null>(null);
  const [affTwoLoading, setAffTwoLoading] = useState(false);
  const [affTwoRequested, setAffTwoRequested] = useState(false);
  const [affTwoError, setAffTwoError] = useState<string | null>(null);
  const [affTwoWpm, setAffTwoWpm] = useState<WpmPoint[]>([]);

  // Step 5
  const [judgment, setJudgment] = useState<JudgmentResponse | null>(null);
  const [judgmentLoading, setJudgmentLoading] = useState(false);
  const [judgmentRequested, setJudgmentRequested] = useState(false);
  const [judgmentError, setJudgmentError] = useState<string | null>(null);
  const [speechDurationSeconds, setSpeechDurationSeconds] = useState(120);

  // Derive combined transcripts for display and judging.
  // negTokens = full neg speech text (case + rebuttal paragraph if available).
  const negTokens = [negCase, negRebuttalPara].filter(Boolean).join("\n\n");
  // affTwoTranscript = full aff-2 text (overview + rebuttal paragraph if available).
  const affTwoTranscript = [affOverview, affRebuttalPara].filter(Boolean).join("\n\n");

  const abortRef = useRef<AbortController | null>(null);
  const affStartedRef = useRef(false);
  const negStartedRef = useRef(false);       // user is AFF step-2: neg case prefetch
  const negRebuttalStartedRef = useRef(false); // user is AFF step-3: neg rebuttal prefetch
  const affTwoStartedRef = useRef(false);
  const judgmentStartedRef = useRef(false);

  // Split promise refs for each AI piece.
  const affPromiseRef = useRef<Promise<string> | null>(null);
  const negCaseRef = useRef<Promise<string> | null>(null);
  const negRebuttalRef = useRef<Promise<string> | null>(null);
  const affOverviewRef = useRef<Promise<string> | null>(null);
  const affRebuttalRef = useRef<Promise<string> | null>(null);
  const judgmentPromiseRef = useRef<Promise<JudgmentResponse> | null>(null);

  const userSide = topic?.side ?? "aff";
  const userIsAff = userSide === "aff";

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

  const handleFormatChange = useCallback((nextFormat: Format) => {
    setFormat(nextFormat);
    setTopic(null);
    setTopicError(null);
    if (nextFormat !== "parli") setTournament("");
  }, []);

  const handleGetTopic = useCallback(async () => {
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
  }, [format, tournament]);

  const handleAcceptTopic = useCallback(async () => {
    if (!topic) return;
    setTopicError(null);
    try {
      const round = await apiFetch<RoundResponse>("/api/rounds", {
        method: "POST",
        body: JSON.stringify({
          format: topic.format,
          topic: topic.topic,
          side: topic.side,
        }),
      });
      setRoundId(round.id);
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
      setAffTwoRequested(false);
      setAffTwoError(null);
      setAffTwoWpm([]);
      setJudgment(null);
      setJudgmentRequested(false);
      setJudgmentError(null);
    } catch (err) {
      setTopicError(err instanceof Error ? err.message : "Failed to start round");
    }
  }, [topic, speech]);

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
    setAffTwoLoading(false);
    setAffTwoRequested(false);
    setAffTwoError(null);
    setAffTwoWpm([]);
    setJudgment(null);
    setJudgmentLoading(false);
    setJudgmentRequested(false);
    setJudgmentError(null);
  }, [speech]);

  const uploadSpeech = useCallback(
    async (
      blob: Blob,
      speechType: "aff" | "neg" | "aff_two",
    ): Promise<SpeechResponse> => {
      if (!roundId) throw new Error("No round id");
      const form = new FormData();
      form.append("audio", blob);
      form.append("speech_type", speechType);
      return apiFetch<SpeechResponse>(`/api/rounds/${roundId}/speeches`, {
        method: "POST",
        body: form,
      });
    },
    [roundId],
  );

  const handleAffComplete = useCallback(
    async (blob: Blob) => {
      setAffLoading(true);
      try {
        const res = await uploadSpeech(blob, "aff");
        setAffTranscript(res.transcript);
        setAffWpm(res.wpm_series ?? []);
        negStartedRef.current = false;
        negRebuttalStartedRef.current = false;
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

  // ── AFF-1: Debby's affirmative speech (user is NEG) ─────────────────────

  const prefetchAiAffSpeech = useCallback(async (): Promise<string> => {
    if (!topic) return "";
    if (affTranscript?.trim()) return affTranscript;
    if (affPromiseRef.current) return affPromiseRef.current;

    setAffAiError(null);
    setAffLoading(true);
    const promise = apiFetch<AiSpeechResponse>("/api/ai/speech", {
        method: "POST",
        body: JSON.stringify({ topic: topic.topic, side: "aff" }),
      })
      .then(async (res) => {
        setAffTranscript(res.speech);
        // Best-effort TTS prefetch for aff-1 — don't await, never blocks.
        speech.prefetch(res.speech);
        // Chain: prefetch aff-overview immediately after aff-1 resolves.
        affOverviewRef.current = apiFetch<AiSpeechResponse>("/api/ai/aff-overview", {
            method: "POST",
            body: JSON.stringify({ topic: topic.topic, aff_speech: res.speech }),
          })
          .then((ovRes) => {
            setAffOverview(ovRes.speech);
            speech.prefetch(ovRes.speech);
            return ovRes.speech;
          })
          .catch(() => "")
          .finally(() => {
            affOverviewRef.current = null;
          });
        return res.speech;
      })
      .catch((err) => {
        setAffAiError(
          err instanceof Error ? err.message : "Failed to generate affirmative speech",
        );
        throw err;
      })
      .finally(() => {
        setAffLoading(false);
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

  // ── NEG CASE: Debby's neg framework (user is AFF, step 2→3) ─────────────

  const prefetchNegCase = useCallback(async (): Promise<string> => {
    if (!topic) return "";
    if (negCase?.trim()) return negCase;
    if (negCaseRef.current) return negCaseRef.current;

    setNegError(null);
    setNegLoading(true);
    const promise = apiFetch<AiSpeechResponse>("/api/ai/neg-framework", {
        method: "POST",
        body: JSON.stringify({ topic: topic.topic }),
      })
      .then((res) => {
        setNegCase(res.speech);
        // Best-effort TTS prefetch.
        speech.prefetch(res.speech);
        return res.speech;
      })
      .catch((err) => {
        setNegError(err instanceof Error ? err.message : "Failed to generate neg case");
        throw err;
      })
      .finally(() => {
        setNegLoading(false);
        negCaseRef.current = null;
      });

    negCaseRef.current = promise;
    return promise;
  }, [topic, negCase, speech]);

  // ── NEG REBUTTAL: Debby's neg rebuttal paragraph (user is AFF, step 3) ──

  const prefetchNegRebuttal = useCallback(async (): Promise<string> => {
    if (!topic || !affTranscript) return "";
    if (negRebuttalPara?.trim()) return negRebuttalPara;
    if (negRebuttalRef.current) return negRebuttalRef.current;

    // Wait for the neg case before fetching the rebuttal.
    const caseText = await (negCaseRef.current ?? prefetchNegCase());
    if (!caseText?.trim()) return "";

    const promise = apiFetch<AiSpeechResponse>("/api/ai/neg-rebuttal", {
        method: "POST",
        body: JSON.stringify({
          topic: topic.topic,
          neg_case: caseText,
          aff_speech: affTranscript,
        }),
      })
      .then((res) => {
        setNegRebuttalPara(res.speech);
        setNegDone(true);
        // Best-effort TTS prefetch.
        speech.prefetch(res.speech);
        return res.speech;
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

  // ── REVEAL NEG: show combined neg speech + splice audio ─────────────────

  const revealAiOpposition = useCallback(async () => {
    setNegRequested(true);
    try {
      // Ensure both parts are generated so the Play button can splice instantly.
      await Promise.all([
        negCaseRef.current ?? prefetchNegCase(),
        negRebuttalRef.current ?? prefetchNegRebuttal(),
      ]);
    } catch {
      // Error text is already stored for the UI.
    }
  }, [prefetchNegCase, prefetchNegRebuttal]);

  const handleNegComplete = useCallback(
    async (blob: Blob) => {
      setNegLoading(true);
      try {
        const res = await uploadSpeech(blob, "neg");
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
    async (blob: Blob) => {
      setAffTwoLoading(true);
      try {
        const res = await uploadSpeech(blob, "aff_two");
        // Store the user's aff-2 in affOverview (the "case" slot) so
        // affTwoTranscript = overview + rebuttalPara shows the transcript.
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

  // ── AFF OVERVIEW: prefetched after aff-1 (user is NEG) ──────────────────
  // Note: the chained prefetch after aff-1 resolves sets affOverviewRef.current.
  // The effect below triggers the rebuttal once we're at step 4.

  // ── AFF REBUTTAL PARA: Debby's aff rebuttal paragraph (user is NEG, step 4) ─

  const prefetchAffRebuttal = useCallback(async (): Promise<string> => {
    if (!topic || !affTranscript || !negTokens.trim()) return "";
    if (affRebuttalPara?.trim()) return affRebuttalPara;
    if (affRebuttalRef.current) return affRebuttalRef.current;

    setAffTwoError(null);
    setAffTwoLoading(true);
    const promise = apiFetch<AiSpeechResponse>("/api/ai/aff-rebuttal", {
        method: "POST",
        body: JSON.stringify({
          topic: topic.topic,
          aff_speech: affTranscript,
          neg_speech: negTokens,
        }),
      })
      .then((res) => {
        setAffRebuttalPara(res.speech);
        // Best-effort TTS prefetch.
        speech.prefetch(res.speech);
        return res.speech;
      })
      .catch((err) => {
        setAffTwoError(
          err instanceof Error ? err.message : "Failed to generate affirmative rebuttal",
        );
        throw err;
      })
      .finally(() => {
        setAffTwoLoading(false);
        affRebuttalRef.current = null;
      });

    affRebuttalRef.current = promise;
    return promise;
  }, [topic, affTranscript, negTokens, affRebuttalPara, speech]);

  // ── REVEAL AFF REBUTTAL: show combined aff-2 + splice audio ─────────────

  const revealAiAffRebuttal = useCallback(async () => {
    setAffTwoRequested(true);
    try {
      // Ensure both parts are generated so the Play button can splice instantly.
      await Promise.all([
        affOverviewRef.current ?? Promise.resolve(affOverview ?? ""),
        affRebuttalRef.current ?? prefetchAffRebuttal(),
      ]);
    } catch {
      // Error text is already stored for the UI.
    }
  }, [affOverview, prefetchAffRebuttal]);

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
      .then((res) => {
        setJudgment(res);
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
  }, [topic, affTranscript, affTwoTranscript, negTokens, judgment, roundId]);

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

  // ── Effects ──────────────────────────────────────────────────────────────

  // User is AFF, step 2: prefetch neg case as soon as topic is accepted.
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

  // User is AFF, step 3: when aff transcript is ready, prefetch neg rebuttal.
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

  // User is NEG, step 2: prefetch Debby's aff-1 (and chains aff-overview).
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

  // User is NEG, step 4: prefetch Debby's aff rebuttal paragraph.
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

  // Prefetch judgment once all speeches are final. Gated on step 5 so the
  // Debby-AFF flow doesn't judge prematurely: affTwoTranscript becomes
  // non-empty as soon as the overview paragraph lands (well before the aff
  // rebuttal paragraph), so without the step gate judgment would fire with an
  // incomplete aff-2. By step 5 both halves are present for either side.
  useEffect(() => {
    if (
      step === 5 &&
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
    step,
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

      <StepCard step={1} title="Pick a topic" active={step === 1} done={step > 1}>
        <div className="flex flex-col gap-4">
          <label className={fieldLabelClass}>
            Format
            <select
              aria-label="Format"
              value={format}
              onChange={(e) => handleFormatChange(e.target.value as Format)}
              disabled={step > 1}
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
                disabled={step > 1}
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
              disabled={topicLoading || step > 1}
              className={primaryButtonClass}
            >
            {topicLoading ? "Loading…" : "Get topic"}
            </button>
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
                  className={`mt-3 ${primaryButtonClass}`}
                >
                  Accept topic
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
                {affAiRequested && affTranscript && (
                  <DebbyAudioButton parts={affTranscript} speech={speech} />
                )}
                {step === 2 && affAiRequested && affTranscript && (
                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    className={secondaryButtonClass}
                  >
                    Continue to Neg speech
                  </button>
                )}
                {affAiRequested && affTranscript && (
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
            {negRequested && negTokens && (
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
                {affTwoRequested && affTwoTranscript && (
                  <DebbyAudioButton
                    parts={[affOverview, affRebuttalPara].filter(Boolean) as string[]}
                    speech={speech}
                  />
                )}
                {affTwoRequested && affTwoTranscript && (
                  <div className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                    <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
                      Debby's Aff rebuttal
                    </div>
                    {affTwoTranscript}
                  </div>
                )}
                {step === 4 && affTwoRequested && affTwoTranscript && (
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
                    href={`/history/${roundId}`}
                    className="text-sm text-teal underline"
                  >
                    round saved as /history/{roundId}
                  </a>
                )}
                <button
                  type="button"
                  onClick={handlePracticeAgain}
                  className={secondaryButtonClass}
                >
                  Practice again
                </button>
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
          <div className="mt-4 rounded-md bg-teal/10 p-4 text-center">
            <div className="text-xs font-semibold uppercase tracking-wide text-teal-dark">
              Max
            </div>
            <div className="mt-1 text-3xl font-bold text-teal-dark">
              {formatDuration(speechDurationSeconds)}
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          WPM charts appear under each speech after transcription.
        </section>
      </aside>
    </main>
  );
}

