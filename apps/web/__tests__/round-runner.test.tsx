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
    onComplete: (
      b: Blob,
      realtimeTranscript?: {
        transcript: string;
        durationSeconds: number;
        words: unknown[];
      },
    ) => void | Promise<void>;
    label?: string;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      data-testid={`record-${(label ?? "rec").replace(/\s+/g, "-").toLowerCase()}`}
      disabled={disabled}
      onClick={() =>
        onComplete(new Blob(["audio"], { type: "audio/webm" }), {
          transcript: `realtime ${label ?? "speech"}`,
          durationSeconds: 60,
          words: [],
        })
      }
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

function tournamentResponse() {
  return jsonResponse({ tournaments: ["Bargain Belt", "Berkeley HS"] });
}

function findFetchCall(path: string): [string, RequestInit] {
  const match = (global.fetch as jest.Mock).mock.calls.find(([url]) =>
    String(url).includes(path),
  );
  if (!match) {
    throw new Error(`Expected fetch call containing ${path}`);
  }
  return match as [string, RequestInit];
}

beforeEach(() => {
  jest.resetAllMocks();
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

  test("can start a round from a custom topic without fetching a random topic", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(tournamentResponse())
      .mockResolvedValueOnce(jsonResponse({ id: "custom-round" }));

    render(<RoundRunner />);

    fireEvent.change(screen.getByLabelText(/custom topic/i), {
      target: { value: "Resolved: Cities should ban private cars" },
    });
    fireEvent.change(screen.getByLabelText(/custom side/i), {
      target: { value: "neg" },
    });
    fireEvent.click(screen.getByRole("button", { name: /use custom topic/i }));

    expect(
      await screen.findByText("Resolved: Cities should ban private cars"),
    ).toBeInTheDocument();
    expect(screen.getByText("Your side: Negative")).toBeInTheDocument();
    expect(screen.queryByText(/^Max$/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /accept topic/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    const [url, init] = (global.fetch as jest.Mock).mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(url).toContain("/api/rounds");
    expect(JSON.parse(init.body as string)).toMatchObject({
      format: "parli",
      topic: "Resolved: Cities should ban private cars",
      side: "neg",
    });
  });

  test("after recording the aff speech, fetch saves the realtime transcript", async () => {
    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/topics/tournaments")) return Promise.resolve(tournamentResponse());
      if (url.includes("/api/topics?")) {
        return Promise.resolve(jsonResponse({ topic: "T", side: "aff", format: "parli" }));
      }
      if (url.endsWith("/api/rounds")) return Promise.resolve(jsonResponse({ id: "round-123" }));
      if (url.includes("/api/ai/neg-framework")) {
        return Promise.resolve(jsonResponse({ speech: "neg case" }));
      }
      if (url.includes("/api/rounds/round-123/speeches/text")) {
        return Promise.resolve(jsonResponse({ transcript: "hello world", wpm_series: [] }));
      }
      if (url.includes("/api/ai/neg-rebuttal")) {
        return Promise.resolve(jsonResponse({ speech: "neg rebuttal" }));
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<RoundRunner />);
    fireEvent.click(screen.getByRole("button", { name: /get topic/i }));
    await screen.findByText("T");
    fireEvent.click(screen.getByRole("button", { name: /accept topic/i }));

    const recordBtn = await screen.findByTestId("record-record-aff-speech");
    await act(async () => {
      fireEvent.click(recordBtn);
    });

    await waitFor(() =>
      expect(
        (global.fetch as jest.Mock).mock.calls.some(([url]) =>
          String(url).includes("/api/ai/neg-rebuttal"),
        ),
      ).toBe(true),
    );
    const [url, init] = findFetchCall("/api/rounds/round-123/speeches/text");
    expect(url).toContain("/api/rounds/round-123/speeches/text");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      speech_type: "aff",
      transcript: "realtime Record Aff speech",
      duration_seconds: 60,
    });

    expect(await screen.findByText("hello world")).toBeInTheDocument();
  });

  test("the Neg speech step preloads but waits for Generate Neg speech click", async () => {
    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/topics/tournaments")) return Promise.resolve(tournamentResponse());
      if (url.includes("/api/topics?")) {
        return Promise.resolve(jsonResponse({ topic: "T", side: "aff", format: "parli" }));
      }
      if (url.endsWith("/api/rounds")) return Promise.resolve(jsonResponse({ id: "r1" }));
      if (url.includes("/api/ai/neg-framework")) {
        return Promise.resolve(jsonResponse({ speech: "Hello world" }));
      }
      if (url.includes("/api/rounds/r1/speeches/text")) {
        return Promise.resolve(jsonResponse({ transcript: "aff text", wpm_series: [] }));
      }
      if (url.includes("/api/ai/neg-rebuttal")) {
        return Promise.resolve(jsonResponse({ speech: "Neg rebuttal" }));
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<RoundRunner />);
    fireEvent.click(screen.getByRole("button", { name: /get topic/i }));
    await screen.findByText("T");
    fireEvent.click(screen.getByRole("button", { name: /accept topic/i }));
    const recordBtn = await screen.findByTestId("record-record-aff-speech");
    await act(async () => {
      fireEvent.click(recordBtn);
    });
    await screen.findByText("aff text");

    await waitFor(() =>
      expect(
        (global.fetch as jest.Mock).mock.calls.some(([url]) =>
          String(url).includes("/api/ai/neg-rebuttal"),
        ),
      ).toBe(true),
    );
    expect(screen.queryByTestId("neg-tokens")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /generate neg speech/i }));

    const tokens = await screen.findByTestId("neg-tokens");
    expect(tokens).toHaveTextContent("Hello world");
    expect(tokens).toHaveTextContent("Neg rebuttal");
  });

  test("negative side flips the flow: Debby aff, user neg, Debby aff rebuttal", async () => {
    const flow = {
      aff: [],
      neg: [],
      ballot: { winner: "neg", explanation: "Neg wins." },
    };

    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/topics/tournaments")) return Promise.resolve(tournamentResponse());
      if (url.includes("/api/topics?")) {
        return Promise.resolve(jsonResponse({ topic: "T", side: "neg", format: "parli" }));
      }
      if (url.endsWith("/api/rounds")) return Promise.resolve(jsonResponse({ id: "r-neg" }));
      if (url.includes("/api/ai/speech")) return Promise.resolve(jsonResponse({ speech: "ai aff" }));
      if (url.includes("/api/ai/aff-overview")) {
        return Promise.resolve(jsonResponse({ speech: "aff overview" }));
      }
      if (url.includes("/api/rounds/r-neg/speeches/text")) {
        return Promise.resolve(jsonResponse({ transcript: "user neg", wpm_series: [] }));
      }
      if (url.includes("/api/ai/aff-rebuttal")) {
        return Promise.resolve(jsonResponse({ speech: "ai aff rebuttal" }));
      }
      if (url.includes("/api/ai/judgment")) {
        return Promise.resolve(
          jsonResponse({
            rfd: "Negative wins on defense and turns.",
            winner_side: "neg",
            flow,
          }),
        );
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<RoundRunner />);
    fireEvent.click(screen.getByRole("button", { name: /get topic/i }));
    await screen.findByText("T");
    expect(screen.getByText("Your side: Negative")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /accept topic/i }));
    fireEvent.click(await screen.findByRole("button", { name: /generate aff speech/i }));
    expect(await screen.findByText("ai aff")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        (global.fetch as jest.Mock).mock.calls.some(([url]) =>
          String(url).includes("/api/ai/aff-overview"),
        ),
      ).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: /continue to neg speech/i }));
    const negBtn = await screen.findByTestId("record-record-neg-speech");
    await act(async () => {
      fireEvent.click(negBtn);
    });
    expect(await screen.findByText("user neg")).toBeInTheDocument();

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/ai/aff-rebuttal"),
      expect.anything(),
    ));
    fireEvent.click(screen.getByRole("button", { name: /generate aff rebuttal/i }));
    expect(
      await screen.findByRole("button", { name: /continue to judgment/i }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /continue to judgment/i }));

    fireEvent.click(screen.getByRole("button", { name: /judge debate/i }));
    expect(await screen.findByText("Negative wins on defense and turns.")).toBeInTheDocument();
    expect(screen.getByText("Winner: You (Negative)")).toBeInTheDocument();

    const [, speechInit] = findFetchCall("/api/ai/speech");
    expect(JSON.parse(speechInit.body as string)).toMatchObject({
      side: "aff",
    });
    const [, judgmentInit] = findFetchCall("/api/ai/judgment");
    expect(JSON.parse(judgmentInit.body as string)).toMatchObject({
      round_id: "r-neg",
      aff_speech: "ai aff",
      neg_speech: "user neg",
      aff_two_speech: "aff overview\n\nai aff rebuttal",
    });
  });

  test("final judgment renders RfdCard and history link without the full flow", async () => {
    const flow = {
      aff: [{ tag: "Econ", summary: "growth good" }],
      neg: [{ tag: "Env", summary: "climate bad" }],
      ballot: "Aff wins on probability.",
    };

    (global.fetch as jest.Mock).mockImplementation(
      (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/topics/tournaments")) return Promise.resolve(tournamentResponse());
      if (url.includes("/api/topics?")) {
        return Promise.resolve(jsonResponse({ topic: "T", side: "aff", format: "parli" }));
      }
      if (url.endsWith("/api/rounds")) return Promise.resolve(jsonResponse({ id: "r1" }));
      if (url.includes("/api/ai/neg-framework")) {
        return Promise.resolve(jsonResponse({ speech: "neg case" }));
      }
      if (url.includes("/api/rounds/r1/speeches/text")) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        if (body.speech_type === "aff") {
          return Promise.resolve(jsonResponse({ transcript: "aff one", wpm_series: [] }));
        }
        if (body.speech_type === "aff_two") {
          return Promise.resolve(jsonResponse({ transcript: "aff two", wpm_series: [] }));
        }
      }
      if (url.includes("/api/ai/neg-rebuttal")) {
        return Promise.resolve(jsonResponse({ speech: "neg speech" }));
      }
      if (url.includes("/api/ai/judgment")) {
        return Promise.resolve(
          jsonResponse({
            rfd: "Aff wins because of clear impact comparison.",
            winner_side: "aff",
            flow,
          }),
        );
      }
      throw new Error(`Unhandled fetch: ${url}`);
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

    expect(
      screen.queryByText("Aff wins because of clear impact comparison."),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /judge debate/i }));

    expect(
      await screen.findByText("Aff wins because of clear impact comparison."),
    ).toBeInTheDocument();
    const [, judgmentInit] = findFetchCall("/api/ai/judgment");
    expect(JSON.parse(judgmentInit.body as string)).toMatchObject({
      round_id: "r1",
      neg_speech: "neg case\n\nneg speech",
    });
    expect(screen.queryByText("Econ")).not.toBeInTheDocument();
    expect(screen.queryByText("growth good")).not.toBeInTheDocument();
    expect(screen.queryByText("Env")).not.toBeInTheDocument();
    expect(screen.getByText(/round saved in library/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /practice again/i }));

    expect(screen.getByRole("button", { name: /get topic/i })).toBeEnabled();
    expect(screen.queryByText("Aff wins because of clear impact comparison.")).not.toBeInTheDocument();
    expect(screen.queryByText(/round saved in library/i)).not.toBeInTheDocument();
  });
});
