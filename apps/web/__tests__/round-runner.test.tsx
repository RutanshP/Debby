import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// --- Mocks --------------------------------------------------------------

jest.mock("../lib/supabase", () => ({
  getBrowserSupabase: () => ({
    auth: {
      getSession: async () => ({ data: { session: null } }),
    },
  }),
}));

// Avoid pulling in useMediaRecorder / Web APIs.
jest.mock("../components/RecordButton", () => ({
  RecordButton: ({
    onComplete,
    label,
    disabled,
  }: {
    onComplete: (b: Blob) => void | Promise<void>;
    label?: string;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      data-testid={`record-${(label ?? "rec").replace(/\s+/g, "-").toLowerCase()}`}
      disabled={disabled}
      onClick={() => onComplete(new Blob(["audio"], { type: "audio/webm" }))}
    >
      {label ?? "Record"}
    </button>
  ),
}));

// Avoid recharts ResizeObserver issues in jsdom.
jest.mock("../components/WpmChart", () => ({
  WpmChart: ({ series }: { series: unknown[] }) => (
    <div data-testid="wpm-chart">wpm-points:{series.length}</div>
  ),
}));

import { RoundRunner } from "../app/(app)/round-runner";

// --- Helpers -----------------------------------------------------------

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function audioResponse() {
  return new Response(new Blob([new Uint8Array([0xff, 0xfb])], { type: "audio/mpeg" }), {
    status: 200,
    headers: { "Content-Type": "audio/mpeg" },
  });
}

interface RouteConfig {
  topicSide?: "aff" | "neg";
  roundId?: string;
  affTranscript?: string; // user's AFF speech transcript
  negTranscript?: string; // user's NEG speech transcript
  affTwoTranscript?: string; // user's AFF rebuttal transcript
  negFramework?: string; // Debby NEG phase 1 (contentions)
  negAugment?: string; // Debby NEG phase 2 (final speech)
  affSpeech?: string; // Debby AFF constructive
  affRebuttal?: string; // Debby AFF rebuttal
  judgment?: unknown;
}

// URL-routed fetch mock: dispatches by path so the test is robust to the
// background prefetch calls (neg-framework, neg-augment, tts) firing in any
// order relative to the user's clicks.
function installRouter(cfg: RouteConfig = {}) {
  (global.fetch as jest.Mock).mockImplementation(
    (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.includes("/api/topics/tournaments")) {
        return Promise.resolve(jsonResponse({ tournaments: ["Bargain Belt", "Berkeley HS"] }));
      }
      if (url.includes("/api/topics")) {
        return Promise.resolve(
          jsonResponse({ topic: "T", side: cfg.topicSide ?? "aff", format: "parli" }),
        );
      }
      if (url.includes("/speeches")) {
        const fd = init?.body as FormData | undefined;
        const type = fd?.get?.("speech_type");
        if (type === "aff") {
          return Promise.resolve(
            jsonResponse({ transcript: cfg.affTranscript ?? "aff text", wpm_series: [] }),
          );
        }
        if (type === "neg") {
          return Promise.resolve(
            jsonResponse({ transcript: cfg.negTranscript ?? "user neg", wpm_series: [] }),
          );
        }
        return Promise.resolve(
          jsonResponse({ transcript: cfg.affTwoTranscript ?? "aff two", wpm_series: [] }),
        );
      }
      if (url.includes("/api/rounds") && method === "POST") {
        return Promise.resolve(jsonResponse({ id: cfg.roundId ?? "r1" }));
      }
      if (url.includes("/api/ai/neg-framework")) {
        return Promise.resolve(jsonResponse({ speech: cfg.negFramework ?? "neg framework" }));
      }
      if (url.includes("/api/ai/neg-augment")) {
        return Promise.resolve(jsonResponse({ speech: cfg.negAugment ?? "neg response" }));
      }
      if (url.includes("/api/ai/speech")) {
        return Promise.resolve(jsonResponse({ speech: cfg.affSpeech ?? "ai aff" }));
      }
      if (url.includes("/api/ai/aff-rebuttal")) {
        return Promise.resolve(jsonResponse({ speech: cfg.affRebuttal ?? "ai aff rebuttal" }));
      }
      if (url.includes("/api/ai/tts")) {
        return Promise.resolve(audioResponse());
      }
      if (url.includes("/api/ai/judgment")) {
        return Promise.resolve(
          jsonResponse(
            cfg.judgment ?? { rfd: "RFD here.", winner_side: "aff", flow: {} },
          ),
        );
      }
      return Promise.reject(new Error(`unhandled fetch: ${method} ${url}`));
    },
  );
}

function callsTo(pattern: string): [string, RequestInit | undefined][] {
  return (global.fetch as jest.Mock).mock.calls.filter(([u]: [string]) =>
    String(u).includes(pattern),
  );
}

beforeAll(() => {
  // jsdom lacks object-URL APIs used by the TTS audio cache.
  global.URL.createObjectURL = jest.fn(() => "blob:mock-url");
  global.URL.revokeObjectURL = jest.fn();
});

beforeEach(() => {
  jest.resetAllMocks();
  global.fetch = jest.fn();
});

// --- Tests --------------------------------------------------------------

describe("RoundRunner", () => {
  test("renders step 1 by default", async () => {
    installRouter();
    render(<RoundRunner />);
    expect(screen.getByText("Pick a topic")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /get topic/i })).toBeEnabled();
    expect(await screen.findByRole("option", { name: "Bargain Belt" })).toBeInTheDocument();
  });

  test("selecting parli + clicking 'get topic' calls fetch with the right URL and renders the topic", async () => {
    installRouter({ topicSide: "aff" });

    render(<RoundRunner />);
    fireEvent.click(screen.getByRole("button", { name: /get topic/i }));

    expect(await screen.findByText("T")).toBeInTheDocument();
    const topicCall = callsTo("/api/topics?")[0];
    expect(topicCall).toBeDefined();
    expect(topicCall[0]).toContain("format=parli");
  });

  test("parli tournament selector defaults to no tournament and can select a CSV tournament", async () => {
    installRouter({ topicSide: "aff" });

    render(<RoundRunner />);

    const tournament = await screen.findByRole("combobox", { name: /tournament/i });
    await screen.findByRole("option", { name: "Bargain Belt" });
    expect(tournament).toHaveValue("");
    expect(screen.getByRole("option", { name: /no tournament/i })).toBeInTheDocument();
    fireEvent.change(tournament, { target: { value: "Bargain Belt" } });
    fireEvent.click(screen.getByRole("button", { name: /get topic/i }));

    await screen.findByText("T");
    const topicCall = callsTo("/api/topics?")[0];
    expect(topicCall[0]).toContain("tournament=Bargain+Belt");
  });

  test("after recording the aff speech, fetch is called with FormData to /api/rounds/<id>/speeches", async () => {
    installRouter({ topicSide: "aff", roundId: "round-123", affTranscript: "hello world" });

    render(<RoundRunner />);
    fireEvent.click(screen.getByRole("button", { name: /get topic/i }));
    await screen.findByText("T");
    fireEvent.click(screen.getByRole("button", { name: /accept topic/i }));

    const recordBtn = await screen.findByTestId("record-record-aff-speech");
    await act(async () => {
      fireEvent.click(recordBtn);
    });

    expect(await screen.findByText("hello world")).toBeInTheDocument();

    const speechCall = callsTo("/api/rounds/round-123/speeches")[0];
    expect(speechCall).toBeDefined();
    const init = speechCall[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    const fd = init.body as FormData;
    expect(fd.get("speech_type")).toBe("aff");
    expect(fd.get("audio")).toBeInstanceOf(Blob);
  });

  test("Debby NEG: framework generates at accept-topic, augment after the aff transcript, revealed on click", async () => {
    installRouter({
      topicSide: "aff",
      affTranscript: "aff text",
      negFramework: "neg contentions",
      negAugment: "Hello world",
    });

    render(<RoundRunner />);
    fireEvent.click(screen.getByRole("button", { name: /get topic/i }));
    await screen.findByText("T");
    fireEvent.click(screen.getByRole("button", { name: /accept topic/i }));

    // Phase 1 framework fires immediately at accept-topic (overlapping the speech).
    await waitFor(() => expect(callsTo("/api/ai/neg-framework").length).toBe(1));

    const recordBtn = await screen.findByTestId("record-record-aff-speech");
    await act(async () => {
      fireEvent.click(recordBtn);
    });
    await screen.findByText("aff text");

    // Phase 2 augment fires automatically once the AFF transcript lands, sending
    // the pre-generated framework + the aff speech.
    await waitFor(() => expect(callsTo("/api/ai/neg-augment").length).toBe(1));
    const augmentCall = callsTo("/api/ai/neg-augment")[0];
    expect(JSON.parse(augmentCall[1]!.body as string)).toMatchObject({
      framework: "neg contentions",
      aff_speech: "aff text",
    });

    // …but the speech stays hidden until the user clicks Generate.
    expect(screen.queryByTestId("neg-tokens")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /generate neg speech/i }));

    const tokens = await screen.findByTestId("neg-tokens");
    expect(tokens).toHaveTextContent("Hello world");

    // Audio for the NEG speech was pre-warmed via /api/ai/tts.
    await waitFor(() => expect(callsTo("/api/ai/tts").length).toBeGreaterThanOrEqual(1));
    // The legacy single-shot endpoint is no longer used for the NEG speech.
    expect(callsTo("/api/ai/response").length).toBe(0);
  });

  test("negative side flips the flow: Debby aff, user neg, Debby aff rebuttal", async () => {
    const flow = {
      aff: [],
      neg: [],
      ballot: { winner: "neg", explanation: "Neg wins." },
    };
    installRouter({
      topicSide: "neg",
      roundId: "r-neg",
      affSpeech: "ai aff",
      negTranscript: "user neg",
      affRebuttal: "ai aff rebuttal",
      judgment: {
        rfd: "Negative wins on defense and turns.",
        winner_side: "neg",
        flow,
      },
    });

    render(<RoundRunner />);
    fireEvent.click(screen.getByRole("button", { name: /get topic/i }));
    await screen.findByText("T");
    expect(screen.getByText("Your side: Negative")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /accept topic/i }));
    // Debby's AFF constructive generates at accept-topic.
    await waitFor(() => expect(callsTo("/api/ai/speech").length).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: /generate aff speech/i }));
    expect(await screen.findByText("ai aff")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /continue to neg speech/i }));
    const negBtn = await screen.findByTestId("record-record-neg-speech");
    await act(async () => {
      fireEvent.click(negBtn);
    });
    expect(await screen.findByText("user neg")).toBeInTheDocument();

    // Debby's AFF rebuttal generates after the user's NEG transcript.
    await waitFor(() => expect(callsTo("/api/ai/aff-rebuttal").length).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: /generate aff rebuttal/i }));
    expect(await screen.findByText("ai aff rebuttal")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /continue to judgment/i }));

    await waitFor(() => expect(callsTo("/api/ai/judgment").length).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: /judge debate/i }));
    expect(await screen.findByText("Negative wins on defense and turns.")).toBeInTheDocument();
    expect(screen.getByText("Winner: You (Negative)")).toBeInTheDocument();

    const speechCall = callsTo("/api/ai/speech")[0];
    expect(JSON.parse(speechCall[1]!.body as string)).toMatchObject({ side: "aff" });
    const judgmentCall = callsTo("/api/ai/judgment")[0];
    expect(JSON.parse(judgmentCall[1]!.body as string)).toMatchObject({
      round_id: "r-neg",
      aff_speech: "ai aff",
      neg_speech: "user neg",
      aff_two_speech: "ai aff rebuttal",
    });
  });

  test("final judgment renders RfdCard and history link without the full flow", async () => {
    const flow = {
      aff: [{ tag: "Econ", summary: "growth good" }],
      neg: [{ tag: "Env", summary: "climate bad" }],
      ballot: "Aff wins on probability.",
    };
    installRouter({
      topicSide: "aff",
      roundId: "r1",
      affTranscript: "aff one",
      negAugment: "neg speech",
      affTwoTranscript: "aff two",
      judgment: {
        rfd: "Aff wins because of clear impact comparison.",
        winner_side: "aff",
        flow,
      },
    });

    render(<RoundRunner />);
    fireEvent.click(screen.getByRole("button", { name: /get topic/i }));
    await screen.findByText("T");
    fireEvent.click(screen.getByRole("button", { name: /accept topic/i }));
    const affBtn = await screen.findByTestId("record-record-aff-speech");
    await act(async () => {
      fireEvent.click(affBtn);
    });
    await screen.findByText("aff one");

    fireEvent.click(screen.getByRole("button", { name: /generate neg speech/i }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /continue to aff rebuttal/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /continue to aff rebuttal/i }));

    const rebuttalBtn = await screen.findByTestId("record-record-aff-rebuttal");
    await act(async () => {
      fireEvent.click(rebuttalBtn);
    });
    await screen.findByText("aff two");

    await waitFor(() => expect(callsTo("/api/ai/judgment").length).toBe(1));
    expect(
      screen.queryByText("Aff wins because of clear impact comparison."),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /judge debate/i }));

    expect(
      await screen.findByText("Aff wins because of clear impact comparison."),
    ).toBeInTheDocument();
    const judgmentCall = callsTo("/api/ai/judgment")[0];
    expect(JSON.parse(judgmentCall[1]!.body as string)).toMatchObject({
      round_id: "r1",
      neg_speech: "neg speech",
    });
    expect(screen.queryByText("Econ")).not.toBeInTheDocument();
    expect(screen.queryByText("growth good")).not.toBeInTheDocument();
    expect(screen.queryByText("Env")).not.toBeInTheDocument();
    expect(screen.getByText(/round saved as \/history\/r1/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /practice again/i }));

    expect(screen.getByRole("button", { name: /get topic/i })).toBeEnabled();
    expect(screen.queryByText("Aff wins because of clear impact comparison.")).not.toBeInTheDocument();
    expect(screen.queryByText(/round saved as \/history\/r1/)).not.toBeInTheDocument();
  });
});
