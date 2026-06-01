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

// Mock useDebbySpeech so tests are self-contained and don't depend on Stream B.
const mockPlay = jest.fn();
const mockPrefetch = jest.fn();
const mockStop = jest.fn();
let mockActiveKey = "";

jest.mock("../hooks/useDebbySpeech", () => {
  const speechKeyImpl = (parts: string | string[]): string => {
    const arr = Array.isArray(parts) ? parts : [parts];
    return arr.join("|");
  };
  return {
    speechKey: speechKeyImpl,
    useDebbySpeech: () => ({
      play: mockPlay,
      prefetch: mockPrefetch,
      stop: mockStop,
      state: "idle",
      error: null,
      get activeKey() {
        return mockActiveKey;
      },
    }),
  };
});

import { RoundRunner } from "../app/(app)/round-runner";

// --- Helpers -----------------------------------------------------------

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function tournamentResponse() {
  return jsonResponse({ tournaments: ["Bargain Belt", "Berkeley HS"] });
}

/** Returns all URLs fetched so far. */
function fetchedUrls(): string[] {
  return (global.fetch as jest.Mock).mock.calls.map(([url]: [string]) => url);
}

/** Returns calls that contain the given path fragment. */
function callsTo(pathFragment: string) {
  return (global.fetch as jest.Mock).mock.calls.filter(([url]: [string]) =>
    url.includes(pathFragment),
  );
}

beforeEach(() => {
  jest.resetAllMocks();
  mockPlay.mockClear();
  mockPrefetch.mockClear();
  mockStop.mockClear();
  mockActiveKey = "";
  global.fetch = jest.fn();
});

// --- Tests --------------------------------------------------------------

describe("RoundRunner", () => {
  test("renders step 1 by default", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(tournamentResponse());
    render(<RoundRunner />);
    expect(screen.getByText("Pick a topic")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /get topic/i })).toBeEnabled();
    expect(await screen.findByRole("option", { name: "Bargain Belt" })).toBeInTheDocument();
  });

  test("selecting parli + clicking 'get topic' calls fetch with the right URL and renders the topic", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(tournamentResponse())
      .mockResolvedValueOnce(
        jsonResponse({ topic: "Resolved: cats > dogs", side: "aff", format: "parli" }),
      );

    render(<RoundRunner />);
    fireEvent.click(screen.getByRole("button", { name: /get topic/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
    const url = (global.fetch as jest.Mock).mock.calls[1][0] as string;
    expect(url).toContain("/api/topics?");
    expect(url).toContain("format=parli");
    expect(await screen.findByText("Resolved: cats > dogs")).toBeInTheDocument();
  });

  test("parli tournament selector defaults to no tournament and can select a CSV tournament", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(tournamentResponse())
      .mockResolvedValueOnce(
        jsonResponse({ topic: "Bargain topic", side: "aff", format: "parli" }),
      );

    render(<RoundRunner />);

    const tournament = await screen.findByRole("combobox", { name: /tournament/i });
    await screen.findByRole("option", { name: "Bargain Belt" });
    expect(tournament).toHaveValue("");
    expect(screen.getByRole("option", { name: /no tournament/i })).toBeInTheDocument();
    fireEvent.change(tournament, { target: { value: "Bargain Belt" } });
    fireEvent.click(screen.getByRole("button", { name: /get topic/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    const url = (global.fetch as jest.Mock).mock.calls[1][0] as string;
    expect(url).toContain("tournament=Bargain+Belt");
  });

  test("after recording the aff speech, fetch is called with FormData to /api/rounds/<id>/speeches", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(tournamentResponse())        // 0: tournaments
      .mockResolvedValueOnce(                             // 1: GET topic
        jsonResponse({ topic: "T", side: "aff", format: "parli" }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: "round-123" })) // 2: POST round
      // accept topic triggers neg-framework prefetch on step 2
      .mockResolvedValueOnce(jsonResponse({ speech: "neg case text" })) // 3: neg-framework
      .mockResolvedValueOnce(                             // 4: POST aff speech
        jsonResponse({ transcript: "hello world", wpm_series: [] }),
      )
      // after aff complete → step 3 → neg-rebuttal prefetch fires
      .mockResolvedValueOnce(jsonResponse({ speech: "neg rebuttal para" })); // 5: neg-rebuttal

    render(<RoundRunner />);
    fireEvent.click(screen.getByRole("button", { name: /get topic/i }));
    await screen.findByText("T");
    fireEvent.click(screen.getByRole("button", { name: /accept topic/i }));

    const recordBtn = await screen.findByTestId("record-record-aff-speech");
    await act(async () => {
      fireEvent.click(recordBtn);
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(6);
    });
    // The aff speech upload should be call index 4
    const [[url, init]] = callsTo("/api/rounds/round-123/speeches");
    expect(url).toContain("/api/rounds/round-123/speeches");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
    const fd = (init as RequestInit).body as FormData;
    expect(fd.get("speech_type")).toBe("aff");
    expect(fd.get("audio")).toBeInstanceOf(Blob);

    expect(await screen.findByText("hello world")).toBeInTheDocument();
  });

  test("the Neg speech step preloads but waits for Generate Neg speech click", async () => {
    // Sequence: topic -> round -> neg-framework (auto) -> aff speech -> neg-rebuttal (auto)
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(tournamentResponse())
      .mockResolvedValueOnce(
        jsonResponse({ topic: "T", side: "aff", format: "parli" }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: "r1" }))
      .mockResolvedValueOnce(jsonResponse({ speech: "neg case content" })) // neg-framework
      .mockResolvedValueOnce(
        jsonResponse({ transcript: "aff text", wpm_series: [] }),
      )
      .mockResolvedValueOnce(jsonResponse({ speech: "neg rebuttal content" })); // neg-rebuttal

    render(<RoundRunner />);
    fireEvent.click(screen.getByRole("button", { name: /get topic/i }));
    await screen.findByText("T");
    fireEvent.click(screen.getByRole("button", { name: /accept topic/i }));
    const recordBtn = await screen.findByTestId("record-record-aff-speech");
    await act(async () => {
      fireEvent.click(recordBtn);
    });
    await screen.findByText("aff text");

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(6));
    expect(screen.queryByTestId("neg-tokens")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /generate neg speech/i }));

    const tokens = await screen.findByTestId("neg-tokens");
    // Combined text: case + rebuttal paragraph
    expect(tokens).toHaveTextContent("neg case content");
    expect(tokens).toHaveTextContent("neg rebuttal content");
  });

  test("(1) neg-framework + TTS fire on accept-topic when user is AFF", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(tournamentResponse())
      .mockResolvedValueOnce(jsonResponse({ topic: "T", side: "aff", format: "parli" }))
      .mockResolvedValueOnce(jsonResponse({ id: "r1" }))
      .mockResolvedValueOnce(jsonResponse({ speech: "neg framework speech" })) // neg-framework
      // neg-rebuttal won't fire until aff transcript is available — leave hanging
      .mockResolvedValue(jsonResponse({ speech: "extra" }));

    render(<RoundRunner />);
    fireEvent.click(screen.getByRole("button", { name: /get topic/i }));
    await screen.findByText("T");
    fireEvent.click(screen.getByRole("button", { name: /accept topic/i }));

    await waitFor(() => {
      expect(callsTo("/api/ai/neg-framework")).toHaveLength(1);
    });

    // TTS prefetch fires for the neg case text
    await waitFor(() => {
      expect(mockPrefetch).toHaveBeenCalledWith("neg framework speech");
    });

    // Ensure no /neg-augment calls
    expect(fetchedUrls().some((u) => u.includes("/neg-augment"))).toBe(false);
  });

  test("(2) neg-rebuttal + TTS fire when AFF transcript is set", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(tournamentResponse())
      .mockResolvedValueOnce(jsonResponse({ topic: "T", side: "aff", format: "parli" }))
      .mockResolvedValueOnce(jsonResponse({ id: "r1" }))
      .mockResolvedValueOnce(jsonResponse({ speech: "neg case" })) // neg-framework
      .mockResolvedValueOnce(jsonResponse({ transcript: "aff speech text", wpm_series: [] }))
      .mockResolvedValueOnce(jsonResponse({ speech: "neg rebuttal paragraph" })) // neg-rebuttal
      .mockResolvedValue(jsonResponse({ speech: "extra" }));

    render(<RoundRunner />);
    fireEvent.click(screen.getByRole("button", { name: /get topic/i }));
    await screen.findByText("T");
    fireEvent.click(screen.getByRole("button", { name: /accept topic/i }));

    const recordBtn = await screen.findByTestId("record-record-aff-speech");
    await act(async () => {
      fireEvent.click(recordBtn);
    });

    await waitFor(() => {
      expect(callsTo("/api/ai/neg-rebuttal")).toHaveLength(1);
    });

    // Verify neg-rebuttal payload includes neg_case and aff_speech
    const [[, init]] = callsTo("/api/ai/neg-rebuttal");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ topic: "T", neg_case: "neg case", aff_speech: "aff speech text" });

    // TTS prefetch fires for the rebuttal paragraph
    await waitFor(() => {
      expect(mockPrefetch).toHaveBeenCalledWith("neg rebuttal paragraph");
    });
  });

  test("(3) aff-overview TTS fires after aff-1 when user is NEG", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(tournamentResponse())
      .mockResolvedValueOnce(jsonResponse({ topic: "T", side: "neg", format: "parli" }))
      .mockResolvedValueOnce(jsonResponse({ id: "r-neg" }))
      .mockResolvedValueOnce(jsonResponse({ speech: "ai aff speech" })) // /api/ai/speech
      .mockResolvedValueOnce(jsonResponse({ speech: "ai overview" })) // /api/ai/aff-overview (chained)
      .mockResolvedValue(jsonResponse({ speech: "extra" }));

    render(<RoundRunner />);
    fireEvent.click(screen.getByRole("button", { name: /get topic/i }));
    await screen.findByText("T");
    fireEvent.click(screen.getByRole("button", { name: /accept topic/i }));

    await waitFor(() => {
      expect(callsTo("/api/ai/aff-overview")).toHaveLength(1);
    });

    // Verify aff-overview payload
    const [[, ovInit]] = callsTo("/api/ai/aff-overview");
    const ovBody = JSON.parse((ovInit as RequestInit).body as string);
    expect(ovBody).toMatchObject({ topic: "T", aff_speech: "ai aff speech" });

    // TTS prefetch fires for both aff-1 and overview
    await waitFor(() => {
      expect(mockPrefetch).toHaveBeenCalledWith("ai aff speech");
      expect(mockPrefetch).toHaveBeenCalledWith("ai overview");
    });

    // Ensure no /neg-augment calls
    expect(fetchedUrls().some((u) => u.includes("/neg-augment"))).toBe(false);
  });

  test("(4) aff-rebuttal TTS fires when NEG transcript is ready", async () => {
    const flow = { aff: [], neg: [], ballot: { winner: "neg", explanation: "Neg wins." } };

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(tournamentResponse())
      .mockResolvedValueOnce(jsonResponse({ topic: "T", side: "neg", format: "parli" }))
      .mockResolvedValueOnce(jsonResponse({ id: "r-neg" }))
      .mockResolvedValueOnce(jsonResponse({ speech: "ai aff" })) // aff-1
      .mockResolvedValueOnce(jsonResponse({ speech: "ai overview" })) // aff-overview
      .mockResolvedValueOnce(jsonResponse({ transcript: "user neg speech", wpm_series: [] })) // neg upload
      .mockResolvedValueOnce(jsonResponse({ speech: "ai rebuttal para" })) // aff-rebuttal
      .mockResolvedValueOnce(jsonResponse({ rfd: "Neg wins.", winner_side: "neg", flow }));

    render(<RoundRunner />);
    fireEvent.click(screen.getByRole("button", { name: /get topic/i }));
    await screen.findByText("T");
    fireEvent.click(screen.getByRole("button", { name: /accept topic/i }));

    // Wait for aff-1 to be generated
    await waitFor(() => expect(callsTo("/api/ai/speech")).toHaveLength(1));

    // Reveal the aff speech
    fireEvent.click(screen.getByRole("button", { name: /generate aff speech/i }));
    expect(await screen.findByText("ai aff")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /continue to neg speech/i }));
    const negBtn = await screen.findByTestId("record-record-neg-speech");
    await act(async () => {
      fireEvent.click(negBtn);
    });

    await waitFor(() => {
      expect(callsTo("/api/ai/aff-rebuttal")).toHaveLength(1);
    });

    // Verify aff-rebuttal payload
    const [[, arbInit]] = callsTo("/api/ai/aff-rebuttal");
    const arbBody = JSON.parse((arbInit as RequestInit).body as string);
    expect(arbBody).toMatchObject({
      topic: "T",
      aff_speech: "ai aff",
      neg_speech: "user neg speech",
    });

    // TTS prefetch for rebuttal paragraph
    await waitFor(() => {
      expect(mockPrefetch).toHaveBeenCalledWith("ai rebuttal para");
    });
  });

  test("(5) reveal calls play with 2-element parts array for neg speech", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(tournamentResponse())
      .mockResolvedValueOnce(jsonResponse({ topic: "T", side: "aff", format: "parli" }))
      .mockResolvedValueOnce(jsonResponse({ id: "r1" }))
      .mockResolvedValueOnce(jsonResponse({ speech: "neg case" })) // neg-framework
      .mockResolvedValueOnce(jsonResponse({ transcript: "aff text", wpm_series: [] }))
      .mockResolvedValueOnce(jsonResponse({ speech: "neg rebuttal" })) // neg-rebuttal
      .mockResolvedValue(jsonResponse({ speech: "extra" }));

    render(<RoundRunner />);
    fireEvent.click(screen.getByRole("button", { name: /get topic/i }));
    await screen.findByText("T");
    fireEvent.click(screen.getByRole("button", { name: /accept topic/i }));

    const recordBtn = await screen.findByTestId("record-record-aff-speech");
    await act(async () => {
      fireEvent.click(recordBtn);
    });

    // Wait for both neg parts to be fetched
    await waitFor(() => {
      expect(callsTo("/api/ai/neg-rebuttal")).toHaveLength(1);
    });

    fireEvent.click(screen.getByRole("button", { name: /generate neg speech/i }));

    // Reveal generates both parts; clicking Play triggers the spliced playback.
    const playBtns = await screen.findAllByRole("button", { name: /play audio/i });
    fireEvent.click(playBtns[playBtns.length - 1]);

    // play should be called with a 2-element array
    await waitFor(() => {
      expect(mockPlay).toHaveBeenCalled();
    });
    const playArg = mockPlay.mock.calls[0][0];
    expect(Array.isArray(playArg)).toBe(true);
    expect(playArg).toHaveLength(2);
    expect(playArg[0]).toBe("neg case");
    expect(playArg[1]).toBe("neg rebuttal");
  });

  test("(5b) reveal calls play with 2-element parts array for aff rebuttal", async () => {
    const flow = { aff: [], neg: [], ballot: { winner: "neg", explanation: "Neg wins." } };

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(tournamentResponse())
      .mockResolvedValueOnce(jsonResponse({ topic: "T", side: "neg", format: "parli" }))
      .mockResolvedValueOnce(jsonResponse({ id: "r-neg" }))
      .mockResolvedValueOnce(jsonResponse({ speech: "ai aff" }))
      .mockResolvedValueOnce(jsonResponse({ speech: "ai overview" }))
      .mockResolvedValueOnce(jsonResponse({ transcript: "user neg", wpm_series: [] }))
      .mockResolvedValueOnce(jsonResponse({ speech: "ai rebuttal" }))
      .mockResolvedValueOnce(jsonResponse({ rfd: "Neg wins.", winner_side: "neg", flow }));

    render(<RoundRunner />);
    fireEvent.click(screen.getByRole("button", { name: /get topic/i }));
    await screen.findByText("T");
    fireEvent.click(screen.getByRole("button", { name: /accept topic/i }));

    await waitFor(() => expect(callsTo("/api/ai/speech")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: /generate aff speech/i }));
    expect(await screen.findByText("ai aff")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /continue to neg speech/i }));
    const negBtn = await screen.findByTestId("record-record-neg-speech");
    await act(async () => {
      fireEvent.click(negBtn);
    });

    // Wait for aff-rebuttal to be prefetched
    await waitFor(() => {
      expect(callsTo("/api/ai/aff-rebuttal")).toHaveLength(1);
    });

    fireEvent.click(screen.getByRole("button", { name: /generate aff rebuttal/i }));

    // Clicking Play on the aff-2 block triggers the spliced playback.
    const playBtns = await screen.findAllByRole("button", { name: /play audio/i });
    fireEvent.click(playBtns[playBtns.length - 1]);

    await waitFor(() => {
      expect(mockPlay).toHaveBeenCalled();
    });
    const playArg = mockPlay.mock.calls[0][0];
    expect(Array.isArray(playArg)).toBe(true);
    expect(playArg).toHaveLength(2);
    expect(playArg[0]).toBe("ai overview");
    expect(playArg[1]).toBe("ai rebuttal");
  });

  test("(6) no /neg-augment calls anywhere in the full AFF flow", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(tournamentResponse())
      .mockResolvedValueOnce(jsonResponse({ topic: "T", side: "aff", format: "parli" }))
      .mockResolvedValueOnce(jsonResponse({ id: "r1" }))
      .mockResolvedValueOnce(jsonResponse({ speech: "neg case" }))
      .mockResolvedValueOnce(jsonResponse({ transcript: "aff text", wpm_series: [] }))
      .mockResolvedValueOnce(jsonResponse({ speech: "neg rebuttal" }))
      .mockResolvedValueOnce(jsonResponse({ transcript: "aff rebuttal text", wpm_series: [] }))
      .mockResolvedValueOnce(jsonResponse({ rfd: "Aff wins.", winner_side: "aff", flow: { aff: [], neg: [], ballot: "ok" } }));

    render(<RoundRunner />);
    fireEvent.click(screen.getByRole("button", { name: /get topic/i }));
    await screen.findByText("T");
    fireEvent.click(screen.getByRole("button", { name: /accept topic/i }));

    const affBtn = await screen.findByTestId("record-record-aff-speech");
    await act(async () => {
      fireEvent.click(affBtn);
    });

    fireEvent.click(screen.getByRole("button", { name: /generate neg speech/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /continue to aff rebuttal/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /continue to aff rebuttal/i }));

    const rebuttalBtn = await screen.findByTestId("record-record-aff-rebuttal");
    await act(async () => {
      fireEvent.click(rebuttalBtn);
    });

    await waitFor(() => expect(screen.getByRole("button", { name: /judge debate/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /judge debate/i }));
    await screen.findByText("Aff wins.");

    expect(fetchedUrls().some((u) => u.includes("/neg-augment"))).toBe(false);
  });

  test("negative side flips the flow: Debby aff, user neg, Debby aff rebuttal", async () => {
    const flow = {
      aff: [],
      neg: [],
      ballot: { winner: "neg", explanation: "Neg wins." },
    };

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(tournamentResponse())          // 0
      .mockResolvedValueOnce(                               // 1: GET topic
        jsonResponse({ topic: "T", side: "neg", format: "parli" }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: "r-neg" })) // 2: POST round
      .mockResolvedValueOnce(jsonResponse({ speech: "ai aff" })) // 3: aff-1
      .mockResolvedValueOnce(jsonResponse({ speech: "ai overview" })) // 4: aff-overview
      .mockResolvedValueOnce(                               // 5: neg upload
        jsonResponse({ transcript: "user neg", wpm_series: [] }),
      )
      .mockResolvedValueOnce(jsonResponse({ speech: "ai aff rebuttal" })) // 6: aff-rebuttal
      .mockResolvedValueOnce(                               // 7: judgment
        jsonResponse({
          rfd: "Negative wins on defense and turns.",
          winner_side: "neg",
          flow,
        }),
      );

    render(<RoundRunner />);
    fireEvent.click(screen.getByRole("button", { name: /get topic/i }));
    await screen.findByText("T");
    expect(screen.getByText("Your side: Negative")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /accept topic/i }));
    // Wait for aff-1 and overview to both be fetched (calls 3 + 4)
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(5));
    fireEvent.click(screen.getByRole("button", { name: /generate aff speech/i }));
    expect(await screen.findByText("ai aff")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /continue to neg speech/i }));
    const negBtn = await screen.findByTestId("record-record-neg-speech");
    await act(async () => {
      fireEvent.click(negBtn);
    });
    expect(await screen.findByText("user neg")).toBeInTheDocument();

    // Wait for aff-rebuttal prefetch (call 6). Judgment does NOT fire yet —
    // it's gated on step 5, so the count is 7 here, not 8.
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(7));
    fireEvent.click(screen.getByRole("button", { name: /generate aff rebuttal/i }));
    // Combined aff-2 = overview + rebuttal paragraph
    expect(await screen.findByText(/ai overview/)).toBeInTheDocument();
    expect(await screen.findByText(/ai aff rebuttal/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /continue to judgment/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(8));
    fireEvent.click(screen.getByRole("button", { name: /judge debate/i }));
    expect(await screen.findByText("Negative wins on defense and turns.")).toBeInTheDocument();
    expect(screen.getByText("Winner: You (Negative)")).toBeInTheDocument();

    // Verify aff-1 payload
    const [[, speechInit]] = callsTo("/api/ai/speech");
    expect(JSON.parse(speechInit.body as string)).toMatchObject({ side: "aff" });

    // Verify judgment payload uses combined neg text (= user neg speech)
    const [[, judgmentInit]] = callsTo("/api/ai/judgment");
    expect(JSON.parse(judgmentInit.body as string)).toMatchObject({
      round_id: "r-neg",
      aff_speech: "ai aff",
      neg_speech: "user neg",
      aff_two_speech: "ai overview\n\nai aff rebuttal",
    });
  });

  test("final judgment renders RfdCard and history link without the full flow", async () => {
    const flow = {
      aff: [{ tag: "Econ", summary: "growth good" }],
      neg: [{ tag: "Env", summary: "climate bad" }],
      ballot: "Aff wins on probability.",
    };

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(tournamentResponse())          // 0
      .mockResolvedValueOnce(                               // 1: topic
        jsonResponse({ topic: "T", side: "aff", format: "parli" }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: "r1" }))   // 2: round
      .mockResolvedValueOnce(jsonResponse({ speech: "neg case speech" })) // 3: neg-framework
      .mockResolvedValueOnce(                               // 4: aff speech
        jsonResponse({ transcript: "aff one", wpm_series: [] }),
      )
      .mockResolvedValueOnce(jsonResponse({ speech: "neg rebuttal speech" })) // 5: neg-rebuttal
      .mockResolvedValueOnce(                               // 6: aff_two speech
        jsonResponse({ transcript: "aff two", wpm_series: [] }),
      )
      .mockResolvedValueOnce(                               // 7: judgment
        jsonResponse({
          rfd: "Aff wins because of clear impact comparison.",
          winner_side: "aff",
          flow,
        }),
      );

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

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(8));
    expect(
      screen.queryByText("Aff wins because of clear impact comparison."),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /judge debate/i }));

    expect(
      await screen.findByText("Aff wins because of clear impact comparison."),
    ).toBeInTheDocument();
    const [[, judgmentInit]] = callsTo("/api/ai/judgment");
    expect(JSON.parse(judgmentInit.body as string)).toMatchObject({
      round_id: "r1",
      neg_speech: "neg case speech\n\nneg rebuttal speech",
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
