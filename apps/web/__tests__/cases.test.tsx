import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CaseBuilder from "@/app/(app)/parli-gpt/case-builder";

const getParamMock = jest.fn<string | null, [string]>();
jest.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: (key: string) => getParamMock(key) }),
}));

jest.mock("@/lib/supabase", () => ({
  getBrowserSupabase: () => ({
    auth: {
      getSession: async () => ({ data: { session: null } }),
    },
  }),
}));

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });
}

beforeEach(() => {
  global.fetch = jest.fn();
  getParamMock.mockReset();
  getParamMock.mockImplementation(() => null);
});

afterEach(() => {
  jest.resetAllMocks();
});

describe("CaseBuilder", () => {
  it("renders format, topic, side inputs and generate button", () => {
    render(<CaseBuilder />);
    expect(screen.getByLabelText(/format/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/topic/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/side/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate/i })).toBeInTheDocument();
  });

  it("calls fetch with the correct body when Generate is clicked", async () => {
    const user = userEvent.setup();
    mockFetchOnce({ case: "# Hello" });
    render(<CaseBuilder />);

    await user.type(screen.getByLabelText(/topic/i), "X");
    await user.selectOptions(screen.getByLabelText(/side/i), "aff");
    await user.click(screen.getByRole("button", { name: /generate/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain("/api/cases");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      format: "parli",
      topic: "X",
      side: "aff",
    });
  });

  it("renders markdown response as HTML", async () => {
    const user = userEvent.setup();
    mockFetchOnce({ case: "# My Case\nContent." });
    render(<CaseBuilder />);

    await user.type(screen.getByLabelText(/topic/i), "Topic");
    await user.click(screen.getByRole("button", { name: /generate/i }));

    const heading = await screen.findByRole("heading", { level: 1, name: /my case/i });
    expect(heading).toBeInTheDocument();
  });

  it("saves a generated case to the Library", async () => {
    const user = userEvent.setup();
    mockFetchOnce({ case: "# My Case\nContent." });
    mockFetchOnce({ id: "case-1" });
    render(<CaseBuilder />);

    await user.type(screen.getByLabelText(/topic/i), "Topic");
    await user.click(screen.getByRole("button", { name: /generate/i }));

    await screen.findByRole("heading", { level: 1, name: /my case/i });
    await user.click(screen.getByRole("button", { name: /save to library/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    const [url, init] = (global.fetch as jest.Mock).mock.calls[1];
    expect(url).toContain("/api/saved-cases");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({
      title: "My Case",
      topic: "Topic",
      format: "parli",
      side: "aff",
      content: "# My Case\nContent.",
    });
    const savedButton = await screen.findByRole("button", {
      name: /saved to library/i,
    });
    expect(savedButton).toBeDisabled();
  });

  it("analyzes pasted case text with the correct body", async () => {
    const user = userEvent.setup();
    mockFetchOnce({
      score: 6,
      category: "Usable",
      summary: "Solid start, but it needs cleaner internals.",
      feedback: "## What Works\n- Clear hook",
    });
    render(<CaseBuilder />);

    await user.click(screen.getByRole("button", { name: /analyze a case/i }));
    await user.type(screen.getByLabelText(/topic \/ resolution/i), "Resolved: Test topic");
    await user.type(screen.getByLabelText(/paste case text/i), "Contention one: growth good.");
    await user.selectOptions(screen.getByLabelText(/side/i), "neg");
    await user.click(screen.getByRole("button", { name: /^analyze$/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain("/api/cases/analyze");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      format: "parli",
      topic: "Resolved: Test topic",
      side: "neg",
      content: "Contention one: growth good.",
    });
    expect(await screen.findByText("Usable")).toBeInTheDocument();
    expect(screen.getByText("6/10")).toBeInTheDocument();
  });

  it("normalizes indented subpoints before sending case analysis", async () => {
    const user = userEvent.setup();
    mockFetchOnce({
      score: 7,
      category: "Strong",
      summary: "Structured well.",
      feedback: "## What Works\n- Nice hierarchy",
    });
    render(<CaseBuilder />);

    await user.click(screen.getByRole("button", { name: /analyze a case/i }));
    fireEvent.change(screen.getByLabelText(/paste case text/i), {
      target: {
        value: "Contention 1\n    study one proves the point\n        impact grows",
      },
    });
    await user.click(screen.getByRole("button", { name: /^analyze$/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      format: "parli",
      topic: "",
      side: "aff",
      content:
        "Contention 1\n- study one proves the point\n  - impact grows",
    });
  });

  it("does not offer library saving for case feedback", async () => {
    const user = userEvent.setup();
    mockFetchOnce({
      score: 8,
      category: "Strong",
      summary: "Strong case overall.",
      feedback: "## What Works\n- Good structure",
    });
    render(<CaseBuilder />);

    await user.click(screen.getByRole("button", { name: /analyze a case/i }));
    await user.type(screen.getByLabelText(/paste case text/i), "Some case text.");
    await user.click(screen.getByRole("button", { name: /^analyze$/i }));

    await screen.findByText("Strong");
    expect(screen.queryByRole("button", { name: /save to library/i })).not.toBeInTheDocument();
  });

  it("Random button calls /api/cases/random and populates topic", async () => {
    const user = userEvent.setup();
    mockFetchOnce({
      case: "# Random Case",
      topic: "Random Topic Result",
      side: "neg",
    });
    render(<CaseBuilder />);

    await user.click(screen.getByRole("button", { name: /random topic/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain("/api/cases/random");

    await waitFor(() => {
      expect(screen.getByLabelText(/topic/i)).toHaveValue("Random Topic Result");
    });
  });

  it("displays error state when fetch fails", async () => {
    const user = userEvent.setup();
    mockFetchOnce("Server exploded", false, 500);
    render(<CaseBuilder />);

    await user.type(screen.getByLabelText(/topic/i), "Topic");
    await user.click(screen.getByRole("button", { name: /generate/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/server exploded/i);
  });
});
