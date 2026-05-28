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

function tournamentResponse() {
  return jsonResponse({ tournaments: ["Bargain Belt", "Berkeley HS"] });
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

  test("after recording the aff speech, fetch is called with FormData to /api/rounds/<id>/speeches", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(tournamentResponse())
      // GET topic
      .mockResolvedValueOnce(
        jsonResponse({ topic: "T", side: "aff", format: "parli" }),
      )
      // POST round
      .mockResolvedValueOnce(jsonResponse({ id: "round-123" }))
      // POST speech
      .mockResolvedValueOnce(
        jsonResponse({ transcript: "hello world", wpm_series: [] }),
      )
      // automatic AI opposition
      .mockResolvedValueOnce(jsonResponse({ speech: "neg response" }));

    render(<RoundRunner />);
    fireEvent.click(screen.getByRole("button", { name: /get topic/i }));
    await screen.findByText("T");
    fireEvent.click(screen.getByRole("button", { name: /accept topic/i }));

    const recordBtn = await screen.findByTestId("record-record-aff-speech");
    await act(async () => {
      fireEvent.click(recordBtn);
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(5);
    });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[3];
    expect(url).toContain("/api/rounds/round-123/speeches");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
    const fd = (init as RequestInit).body as FormData;
    expect(fd.get("speech_type")).toBe("aff");
    expect(fd.get("audio")).toBeInstanceOf(Blob);

    expect(await screen.findByText("hello world")).toBeInTheDocument();
  });

  test("the AI-opposition step preloads but waits for Generate response click", async () => {
    // Sequence: topic -> round -> aff speech
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(tournamentResponse())
      .mockResolvedValueOnce(
        jsonResponse({ topic: "T", side: "aff", format: "parli" }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: "r1" }))
      .mockResolvedValueOnce(
        jsonResponse({ transcript: "aff text", wpm_series: [] }),
      )
      .mockResolvedValueOnce(jsonResponse({ speech: "Hello world" }));

    render(<RoundRunner />);
    fireEvent.click(screen.getByRole("button", { name: /get topic/i }));
    await screen.findByText("T");
    fireEvent.click(screen.getByRole("button", { name: /accept topic/i }));
    const recordBtn = await screen.findByTestId("record-record-aff-speech");
    await act(async () => {
      fireEvent.click(recordBtn);
    });
    await screen.findByText("aff text");

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(5));
    expect(screen.queryByTestId("neg-tokens")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /generate response/i }));

    const tokens = await screen.findByTestId("neg-tokens");
    expect(tokens).toHaveTextContent("Hello world");
  });

  test("final judgment renders RfdCard and history link without the full flow", async () => {
    const flow = {
      aff: [{ tag: "Econ", summary: "growth good" }],
      neg: [{ tag: "Env", summary: "climate bad" }],
      ballot: "Aff wins on probability.",
    };

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(tournamentResponse())
      .mockResolvedValueOnce(
        jsonResponse({ topic: "T", side: "aff", format: "parli" }),
      ) // topic
      .mockResolvedValueOnce(jsonResponse({ id: "r1" })) // round
      .mockResolvedValueOnce(
        jsonResponse({ transcript: "aff one", wpm_series: [] }),
      ) // aff speech
      .mockResolvedValueOnce(jsonResponse({ speech: "neg speech" })) // AI opposition
      .mockResolvedValueOnce(
        jsonResponse({ transcript: "aff two", wpm_series: [] }),
      ) // aff_two speech
      .mockResolvedValueOnce(
        jsonResponse({
          rfd: "Aff wins because of clear impact comparison.",
          winner_side: "aff",
          flow,
        }),
      ); // judgment

    render(<RoundRunner />);
    fireEvent.click(screen.getByRole("button", { name: /get topic/i }));
    await screen.findByText("T");
    fireEvent.click(screen.getByRole("button", { name: /accept topic/i }));
    const affBtn = await screen.findByTestId("record-record-aff-speech");
    await act(async () => {
      fireEvent.click(affBtn);
    });
    await screen.findByText("aff one");

    fireEvent.click(screen.getByRole("button", { name: /generate response/i }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /continue to rebuttal/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /continue to rebuttal/i }));

    const rebuttalBtn = await screen.findByTestId("record-record-rebuttal");
    await act(async () => {
      fireEvent.click(rebuttalBtn);
    });
    await screen.findByText("aff two");

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(7));
    expect(
      screen.queryByText("Aff wins because of clear impact comparison."),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /judge debate/i }));

    expect(
      await screen.findByText("Aff wins because of clear impact comparison."),
    ).toBeInTheDocument();
    const [, judgmentInit] = (global.fetch as jest.Mock).mock.calls[6] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(judgmentInit.body as string)).toMatchObject({
      round_id: "r1",
      neg_speech: "neg speech",
    });
    expect(screen.queryByText("Econ")).not.toBeInTheDocument();
    expect(screen.queryByText("growth good")).not.toBeInTheDocument();
    expect(screen.queryByText("Env")).not.toBeInTheDocument();
    expect(screen.getByText(/round saved as \/history\/r1/)).toBeInTheDocument();
  });
});
