import { render, screen, waitFor } from "@testing-library/react";
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
  }: {
    label?: string;
    disabled?: boolean;
    onComplete: (b: Blob) => void;
  }) => (
    <button type="button" disabled={disabled} data-testid={`record-${label ?? "rec"}`}>
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

describe("DrillsClient", () => {
  beforeEach(() => {
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
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

  it("generates a rebuttal drill with correct body and lets the user submit a response", async () => {
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
    expect(JSON.parse(init.body as string)).toEqual({ drill_type: "rebuttal" });

    await screen.findByText("Defend free trade.");

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
});
