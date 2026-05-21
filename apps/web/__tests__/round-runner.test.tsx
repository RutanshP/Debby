import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// --- Mocks --------------------------------------------------------------

jest.mock("ai/react", () => ({
  useCompletion: jest.fn(),
}));

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

import { useCompletion } from "ai/react";
import { RoundRunner } from "../app/(app)/round-runner";

const mockedUseCompletion = useCompletion as unknown as jest.Mock;

// --- Helpers -----------------------------------------------------------

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function defaultUseCompletionStub() {
  const complete = jest.fn(async () => "");
  mockedUseCompletion.mockReturnValue({
    complete,
    completion: "",
    isLoading: false,
    error: undefined,
    stop: jest.fn(),
  });
  return complete;
}

beforeEach(() => {
  jest.resetAllMocks();
  defaultUseCompletionStub();
  // @ts-expect-error override
  global.fetch = jest.fn();
});

// --- Tests --------------------------------------------------------------

describe("RoundRunner", () => {
  test("renders step 1 by default", () => {
    render(<RoundRunner />);
    expect(screen.getByText("Pick a topic")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /get topic/i })).toBeEnabled();
  });

  test("selecting parli + clicking 'get topic' calls fetch with the right URL and renders the topic", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse({ topic: "Resolved: cats > dogs", side: "aff", format: "parli" }),
    );

    render(<RoundRunner />);
    fireEvent.click(screen.getByRole("button", { name: /get topic/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
    const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(url).toContain("/api/topics?");
    expect(url).toContain("format=parli");
    expect(await screen.findByText("Resolved: cats > dogs")).toBeInTheDocument();
  });

  test("after recording the aff speech, fetch is called with FormData to /api/rounds/<id>/speeches", async () => {
    (global.fetch as jest.Mock)
      // GET topic
      .mockResolvedValueOnce(
        jsonResponse({ topic: "T", side: "aff", format: "parli" }),
      )
      // POST round
      .mockResolvedValueOnce(jsonResponse({ id: "round-123" }))
      // POST speech
      .mockResolvedValueOnce(
        jsonResponse({ transcript: "hello world", wpm_series: [] }),
      );

    render(<RoundRunner />);
    fireEvent.click(screen.getByRole("button", { name: /get topic/i }));
    await screen.findByText("T");
    fireEvent.click(screen.getByRole("button", { name: /accept topic/i }));

    const recordBtn = await screen.findByTestId("record-record-aff-speech");
    await act(async () => {
      fireEvent.click(recordBtn);
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[2];
    expect(url).toContain("/api/rounds/round-123/speeches");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
    const fd = (init as RequestInit).body as FormData;
    expect(fd.get("speech_type")).toBe("aff");
    expect(fd.get("audio")).toBeInstanceOf(Blob);

    expect(await screen.findByText("hello world")).toBeInTheDocument();
  });

  test("the AI-opposition step renders tokens that arrive on the mocked stream", async () => {
    // Sequence: topic -> round -> aff speech
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(
        jsonResponse({ topic: "T", side: "aff", format: "parli" }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: "r1" }))
      .mockResolvedValueOnce(
        jsonResponse({ transcript: "aff text", wpm_series: [] }),
      );

    // Rerender controllable useCompletion that streams tokens via state.
    let setCompletion: ((s: string) => void) | null = null;
    const complete = jest.fn(async () => "");
    mockedUseCompletion.mockImplementation(() => {
      const [c, set] = React.useState("");
      setCompletion = set;
      return {
        complete,
        completion: c,
        isLoading: false,
        error: undefined,
        stop: jest.fn(),
      };
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

    // We're now on step 3.
    fireEvent.click(screen.getByRole("button", { name: /generate opposition/i }));
    expect(complete).toHaveBeenCalled();

    // Simulate streamed tokens by updating useCompletion completion state.
    await act(async () => {
      setCompletion!("Hello ");
    });
    await act(async () => {
      setCompletion!("Hello world");
    });

    const tokens = await screen.findByTestId("neg-tokens");
    expect(tokens).toHaveTextContent("Hello world");
  });

  test("final judgment renders RfdCard with returned RFD text and FlowSheet with returned flow", async () => {
    const flow = {
      aff: [{ tag: "Econ", summary: "growth good" }],
      neg: [{ tag: "Env", summary: "climate bad" }],
      ballot: "Aff wins on probability.",
    };

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(
        jsonResponse({ topic: "T", side: "aff", format: "parli" }),
      ) // topic
      .mockResolvedValueOnce(jsonResponse({ id: "r1" })) // round
      .mockResolvedValueOnce(
        jsonResponse({ transcript: "aff one", wpm_series: [] }),
      ) // aff speech
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
    await act(async () => {
      fireEvent.click(await screen.findByTestId("record-record-aff-speech"));
    });
    await screen.findByText("aff one");

    // Skip AI opposition: just press continue (negDone via empty completion path)
    fireEvent.click(screen.getByRole("button", { name: /generate opposition/i }));
    // Wait for negDone to set after complete() resolves
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /continue to rebuttal/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /continue to rebuttal/i }));

    await act(async () => {
      fireEvent.click(await screen.findByTestId("record-record-rebuttal"));
    });
    await screen.findByText("aff two");

    fireEvent.click(screen.getByRole("button", { name: /get judgment/i }));

    expect(
      await screen.findByText("Aff wins because of clear impact comparison."),
    ).toBeInTheDocument();
    expect(screen.getByText("Econ")).toBeInTheDocument();
    expect(screen.getByText("growth good")).toBeInTheDocument();
    expect(screen.getByText("Env")).toBeInTheDocument();
    expect(screen.getByText(/round saved as \/history\/r1/)).toBeInTheDocument();
  });
});
