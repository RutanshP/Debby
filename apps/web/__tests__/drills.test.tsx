import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DrillsClient } from "@/app/(app)/drills/drills-client";

jest.mock("@/lib/supabase", () => ({
  getBrowserSupabase: () => ({
    auth: { getSession: async () => ({ data: { session: null } }) },
  }),
}));

jest.mock("@/components/RecordButton", () => ({
  RecordButton: ({
    label,
    disabled,
    onComplete,
  }: {
    label?: string;
    disabled?: boolean;
    onComplete: (b: Blob) => void;
  }) => (
    <button
      type="button"
      disabled={disabled}
      data-testid={`record-${label ?? "rec"}`}
      onClick={() => onComplete(new Blob(["audio"], { type: "audio/webm" }))}
    >
      {label ?? "Record"}
    </button>
  ),
}));

jest.mock("@/components/WpmChart", () => ({
  WpmChart: () => <div data-testid="wpm-chart" />,
}));

function mockFetchOnce(payload: unknown) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => "",
    json: async () => payload,
  });
}

function mockPendingFetchOnce() {
  (global.fetch as jest.Mock).mockImplementationOnce(
    () => new Promise(() => undefined),
  );
}

describe("DrillsClient", () => {
  beforeEach(() => {
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.resetAllMocks();
  });

  it("renders drill-type picker", () => {
    render(<DrillsClient />);
    expect(
      screen.getByRole("button", { name: /Rebuttal/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Speed Reading/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Impact Extension/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Contention Storm/i }),
    ).toBeInTheDocument();
  });

  it("generates an audio rebuttal drill with correct body", async () => {
    const user = userEvent.setup();
    mockFetchOnce({ id: 42, drill_type: "rebuttal", prompt: "Defend free trade." });
    render(<DrillsClient />);

    // Rebuttal is the default selection.
    await user.click(screen.getByRole("button", { name: /Generate Drill/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(String(url)).toMatch(/\/api\/drills$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      drill_type: "rebuttal",
      timer_seconds: 60,
    });

    await screen.findByText("Defend free trade.");
    expect(screen.queryByPlaceholderText(/Your response goes here/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("record-Record Response")).toBeInTheDocument();
  });

  it("contention storm stays written and lets the user submit a response", async () => {
    const user = userEvent.setup();
    render(<DrillsClient />);

    await user.click(screen.getByRole("button", { name: /Contention Storm/i }));
    mockFetchOnce({ id: 42, drill_type: "contention", prompt: "Brainstorm contentions." });
    await user.click(screen.getByRole("button", { name: /Generate Drill/i }));

    await screen.findByText("Brainstorm contentions.");
    const [, generateInit] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(generateInit.body as string)).toEqual({
      drill_type: "contention",
      timer_seconds: 60,
    });
    expect(screen.getByText(/Time left:/i)).toBeInTheDocument();

    mockFetchOnce({
      score: 8,
      feedback: "Solid response.",
      strengths: ["Clear framing"],
      improvements: ["Add more warrants"],
    });

    const textarea = screen.getByPlaceholderText(/Your response goes here/i);
    await user.type(textarea, "My rebuttal");
    await user.click(screen.getByRole("button", { name: /Submit Response/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
    const [scoreUrl, scoreInit] = (global.fetch as jest.Mock).mock.calls[1];
    expect(String(scoreUrl)).toMatch(/\/api\/drills\/42\/score$/);
    expect(scoreInit.method).toBe("POST");
    expect(JSON.parse(scoreInit.body as string)).toEqual({ response: "My rebuttal" });

    expect(await screen.findByText("Solid response.")).toBeInTheDocument();
    expect(screen.getByText("Clear framing")).toBeInTheDocument();
    expect(screen.getByText("Add more warrants")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Redo Drill/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Submit Response/i })).not.toBeInTheDocument();
  });

  it("shows feedback loading while a typed drill is being scored", async () => {
    const user = userEvent.setup();
    render(<DrillsClient />);

    await user.click(screen.getByRole("button", { name: /Contention Storm/i }));
    mockFetchOnce({ id: 42, drill_type: "contention", prompt: "Brainstorm contentions." });
    await user.click(screen.getByRole("button", { name: /Generate Drill/i }));
    await screen.findByText("Brainstorm contentions.");

    mockPendingFetchOnce();
    await user.type(screen.getByPlaceholderText(/Your response goes here/i), "One tagline");
    await user.click(screen.getByRole("button", { name: /Submit Response/i }));

    expect(await screen.findByRole("status")).toHaveTextContent("Scoring your drill...");
  });

  it("shows feedback loading while an audio drill is being scored", async () => {
    const user = userEvent.setup();
    mockFetchOnce({ id: 42, drill_type: "rebuttal", prompt: "Defend free trade." });
    render(<DrillsClient />);

    await user.click(screen.getByRole("button", { name: /Generate Drill/i }));
    await screen.findByText("Defend free trade.");

    mockPendingFetchOnce();
    await user.click(screen.getByTestId("record-Record Response"));

    expect(await screen.findByRole("status")).toHaveTextContent("Scoring your drill...");
  });

  it("shows feedback loading while a speed drill is being scored", async () => {
    const user = userEvent.setup();
    render(<DrillsClient />);

    await user.click(screen.getByRole("button", { name: /Speed Reading/i }));
    mockFetchOnce({
      id: 7,
      drill_type: "speed",
      passage: "Quick brown fox jumps over the lazy dog.",
    });
    await user.click(screen.getByRole("button", { name: /Generate Drill/i }));
    await screen.findByText("Quick brown fox jumps over the lazy dog.");

    mockPendingFetchOnce();
    await user.click(screen.getByTestId("record-Record Reading"));

    expect(await screen.findByRole("status")).toHaveTextContent("Scoring your drill...");
  });

  it("auto-submits contention storm when the timer runs out", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<DrillsClient />);

    await user.click(screen.getByRole("button", { name: /Contention Storm/i }));
    await user.selectOptions(screen.getByLabelText(/timer/i), "30");
    mockFetchOnce({ id: 42, drill_type: "contention", prompt: "Brainstorm contentions." });
    await user.click(screen.getByRole("button", { name: /Generate Drill/i }));
    await screen.findByText("Brainstorm contentions.");

    mockFetchOnce({
      score: 8,
      feedback: "Auto scored.",
      strengths: [],
      improvements: [],
    });
    await user.type(screen.getByPlaceholderText(/Your response goes here/i), "One tagline");

    for (let i = 0; i < 30; i += 1) {
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
    }

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
    const [scoreUrl, scoreInit] = (global.fetch as jest.Mock).mock.calls[1];
    expect(String(scoreUrl)).toMatch(/\/api\/drills\/42\/score$/);
    expect(JSON.parse(scoreInit.body as string)).toEqual({ response: "One tagline" });
    expect(await screen.findByText("Auto scored.")).toBeInTheDocument();
  });

  it("keeps the contention storm timer moving while typing", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<DrillsClient />);

    await user.click(screen.getByRole("button", { name: /Contention Storm/i }));
    mockFetchOnce({ id: 42, drill_type: "contention", prompt: "Brainstorm contentions." });
    await user.click(screen.getByRole("button", { name: /Generate Drill/i }));
    await screen.findByText("Brainstorm contentions.");

    await act(async () => {
      jest.advanceTimersByTime(900);
    });
    await user.type(screen.getByPlaceholderText(/Your response goes here/i), "abc");
    await act(async () => {
      jest.advanceTimersByTime(100);
    });

    expect(screen.getByText(/Time left: 59s/i)).toBeInTheDocument();
  });

  it("shows passage and record button for speed drill", async () => {
    const user = userEvent.setup();
    render(<DrillsClient />);

    await user.click(screen.getByRole("button", { name: /Speed Reading/i }));
    mockFetchOnce({
      id: 7,
      drill_type: "speed",
      passage: "Quick brown fox jumps over the lazy dog.",
    });
    await user.click(screen.getByRole("button", { name: /Generate Drill/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({
      drill_type: "speed",
      timer_seconds: 60,
    });

    expect(
      await screen.findByText("Quick brown fox jumps over the lazy dog."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("record-Record Reading")).toBeInTheDocument();
  });

  it("shows a WPM chart after scoring a speed drill", async () => {
    const user = userEvent.setup();
    render(<DrillsClient />);

    await user.click(screen.getByRole("button", { name: /Speed Reading/i }));
    mockFetchOnce({
      id: 7,
      drill_type: "speed",
      passage: "Quick brown fox jumps over the lazy dog.",
    });
    await user.click(screen.getByRole("button", { name: /Generate Drill/i }));
    await screen.findByText("Quick brown fox jumps over the lazy dog.");

    mockFetchOnce({
      accuracy: 0.9,
      completion: 0.75,
      duration_seconds: 30,
      wpm: 180,
      wpm_series: [
        { t: 0, wpm: 160 },
        { t: 2, wpm: 190 },
      ],
      feedback: "Fast and clear.",
    });
    await user.click(screen.getByTestId("record-Record Reading"));

    expect(await screen.findByText("Feedback")).toBeInTheDocument();
    expect(screen.getByText("180 WPM")).toBeInTheDocument();
    expect(screen.getByText(/90% of attempted words/)).toBeInTheDocument();
    expect(screen.getByText(/75% of the passage/)).toBeInTheDocument();
    expect(screen.getByText("30s")).toBeInTheDocument();
    expect(screen.getByText("Fast and clear.")).toBeInTheDocument();
    expect(screen.getByTestId("wpm-chart")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Redo Drill/i })).toBeInTheDocument();
    expect(screen.queryByTestId("record-Record Reading")).not.toBeInTheDocument();
  });

  it("redo drill generates a fresh prompt for the same drill type", async () => {
    const user = userEvent.setup();
    mockFetchOnce({ id: 42, drill_type: "rebuttal", prompt: "Old drill." });
    render(<DrillsClient />);

    await user.click(screen.getByRole("button", { name: /Generate Drill/i }));
    await screen.findByText("Old drill.");

    mockFetchOnce({
      score: 7,
      feedback: "Done.",
      strengths: [],
      improvements: [],
    });
    await user.click(screen.getByTestId("record-Record Response"));
    await screen.findByText("Done.");

    mockFetchOnce({ id: 43, drill_type: "rebuttal", prompt: "New drill." });
    await user.click(screen.getByRole("button", { name: /Redo Drill/i }));

    expect(await screen.findByText("New drill.")).toBeInTheDocument();
    expect(screen.queryByText("Old drill.")).not.toBeInTheDocument();
    expect(screen.queryByText("Done.")).not.toBeInTheDocument();
    const [, redoInit] = (global.fetch as jest.Mock).mock.calls[2];
    expect(JSON.parse(redoInit.body as string)).toEqual({
      drill_type: "rebuttal",
      timer_seconds: 60,
    });
  });

  it("does not allow recording while redo is generating a fresh prompt", async () => {
    const user = userEvent.setup();
    mockFetchOnce({ id: 42, drill_type: "rebuttal", prompt: "Old drill." });
    render(<DrillsClient />);

    await user.click(screen.getByRole("button", { name: /Generate Drill/i }));
    await screen.findByText("Old drill.");

    mockFetchOnce({
      score: 7,
      feedback: "Done.",
      strengths: [],
      improvements: [],
    });
    await user.click(screen.getByTestId("record-Record Response"));
    await screen.findByText("Done.");

    mockPendingFetchOnce();
    await user.click(screen.getByRole("button", { name: /Redo Drill/i }));

    expect(screen.getByRole("button", { name: /Generating/i })).toBeDisabled();
    expect(screen.queryByText("Old drill.")).not.toBeInTheDocument();
    expect(screen.queryByTestId("record-Record Response")).not.toBeInTheDocument();
  });

  it("clears the current drill when switching drill type", async () => {
    const user = userEvent.setup();
    mockFetchOnce({ id: 42, drill_type: "rebuttal", prompt: "Old drill." });
    render(<DrillsClient />);

    await user.click(screen.getByRole("button", { name: /Generate Drill/i }));
    expect(await screen.findByText("Old drill.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Impact Extension/i }));
    expect(screen.queryByText("Old drill.")).not.toBeInTheDocument();
  });
});
