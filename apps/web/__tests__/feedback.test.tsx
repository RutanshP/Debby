import type { ReactElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FeedbackPanel } from "@/components/classroom/FeedbackPanel";

jest.mock("@/lib/supabase", () => ({
  getBrowserSupabase: () => ({
    auth: { getSession: async () => ({ data: { session: null } }) },
  }),
}));

const RECIPIENT_ID = "recipient-123";

function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

function mockFetchOnce(payload: unknown, status = 200) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  });
}

describe("FeedbackPanel — coach mode", () => {
  beforeEach(() => {
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it("renders grade input, feedback textarea, and return toggle", () => {
    renderWithQueryClient(
      <FeedbackPanel
        recipientId={RECIPIENT_ID}
        isCoach={true}
        initialFeedback={null}
      />,
    );

    expect(screen.getByRole("spinbutton", { name: /grade/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /feedback text/i })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /return to student/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save feedback/i })).toBeInTheDocument();
  });

  it("calls PUT when coach saves feedback", async () => {
    const user = userEvent.setup();
    const savedFeedback = {
      id: "fb-1",
      recipient_id: RECIPIENT_ID,
      coach_id: "coach-uuid",
      grade: 8.5,
      feedback: "Great rebuttal!",
      returned: true,
    };
    mockFetchOnce(savedFeedback);

    renderWithQueryClient(
      <FeedbackPanel
        recipientId={RECIPIENT_ID}
        isCoach={true}
        initialFeedback={null}
      />,
    );

    await user.clear(screen.getByRole("spinbutton", { name: /grade/i }));
    await user.type(screen.getByRole("spinbutton", { name: /grade/i }), "8.5");
    await user.type(
      screen.getByRole("textbox", { name: /feedback text/i }),
      "Great rebuttal!",
    );
    await user.click(screen.getByRole("checkbox", { name: /return to student/i }));
    await user.click(screen.getByRole("button", { name: /save feedback/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(String(url)).toMatch(/\/api\/recipients\/recipient-123\/feedback$/);
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body as string);
    expect(body.grade).toBe(8.5);
    expect(body.feedback).toBe("Great rebuttal!");
    expect(body.returned).toBe(true);

    expect(await screen.findByText("Feedback sent")).toBeInTheDocument();
    expect(screen.getByText("Great rebuttal!")).toBeInTheDocument();
    expect(screen.getByText(/returned to student/i)).toBeInTheDocument();
  });

  it("shows error message when PUT fails", async () => {
    const user = userEvent.setup();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => JSON.stringify({ detail: "Coach role required" }),
      json: async () => ({ detail: "Coach role required" }),
    });

    renderWithQueryClient(
      <FeedbackPanel
        recipientId={RECIPIENT_ID}
        isCoach={true}
        initialFeedback={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: /save feedback/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Coach role required");
  });
});

describe("FeedbackPanel — student read-only mode", () => {
  beforeEach(() => {
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it("shows a no feedback message when feedback is not returned", () => {
    renderWithQueryClient(
      <FeedbackPanel
        recipientId={RECIPIENT_ID}
        isCoach={false}
        initialFeedback={{
          id: "fb-1",
          recipient_id: RECIPIENT_ID,
          grade: 9,
          feedback: "Excellent.",
          returned: false,
        }}
      />,
    );

    expect(screen.getByText("No feedback yet.")).toBeInTheDocument();
  });

  it("shows grade and feedback when returned is true", () => {
    renderWithQueryClient(
      <FeedbackPanel
        recipientId={RECIPIENT_ID}
        isCoach={false}
        initialFeedback={{
          id: "fb-1",
          recipient_id: RECIPIENT_ID,
          grade: 9,
          feedback: "Excellent rebuttal!",
          returned: true,
        }}
      />,
    );

    expect(screen.getByText(/coach feedback/i)).toBeInTheDocument();
    expect(screen.getByText(/9/)).toBeInTheDocument();
    expect(screen.getByText("Excellent rebuttal!")).toBeInTheDocument();
  });

  it("does not show save button in student mode", () => {
    renderWithQueryClient(
      <FeedbackPanel
        recipientId={RECIPIENT_ID}
        isCoach={false}
        initialFeedback={{
          id: "fb-1",
          recipient_id: RECIPIENT_ID,
          returned: true,
        }}
      />,
    );

    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
  });
});
