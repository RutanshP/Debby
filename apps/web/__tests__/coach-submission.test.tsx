/**
 * Tests for the coach submission viewer page.
 *
 * Mocks supabase and global.fetch so no real HTTP calls happen.
 * Asserts that round data (RFD, transcripts) renders correctly.
 */

import { render, screen, waitFor } from "@testing-library/react";
import CoachSubmissionPage from "@/app/(app)/classes/submissions/[recipientId]/page";

// --- Supabase mock ---------------------------------------------------------
jest.mock("@/lib/supabase", () => ({
  getServerSupabase: () => ({
    auth: {
      getSession: async () => ({
        data: {
          session: {
            access_token: "fake-token",
            user: { id: "coach-id" },
          },
        },
      }),
    },
  }),
}));

// --- Next.js cookies mock --------------------------------------------------
jest.mock("next/headers", () => ({
  cookies: async () => ({}),
}));

// --- next/link mock --------------------------------------------------------
jest.mock("next/link", () => {
  const MockLink = ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  );
  MockLink.displayName = "Link";
  return MockLink;
});

// --- Component mocks -------------------------------------------------------
jest.mock("@/components/RfdCard", () => ({
  RfdCard: ({ rfd }: { rfd: string }) => (
    <div data-testid="rfd-card">{rfd}</div>
  ),
}));

jest.mock("@/components/WpmChart", () => ({
  WpmChart: () => <div data-testid="wpm-chart" />,
}));

jest.mock("@/components/FlowSheet", () => ({
  FlowSheet: () => <div data-testid="flow-sheet" />,
}));

// ---------------------------------------------------------------------------

const MOCK_ROUND_PAYLOAD = {
  type: "round" as const,
  round: {
    id: "round-123",
    user_id: "student-id",
    topic: "Schools should ban phones",
    format: "parli",
    side: "aff" as const,
    rfd: "Affirmative wins on the education flow.",
    winner_side: "aff" as const,
    flow: null,
    aff_speech: "Schools should ban phones because they are a distraction.",
    neg_speech: "We disagree because phones enable learning.",
    aff_two_speech: null,
    first_speech_wpm: 145,
    second_speech_wpm: null,
    average_wpm: 145,
    wpm_series: null,
    speech_metrics: null,
    filler_count: 2,
    filler_per_minute: 1.5,
    major_pause_count: 0,
    created_at: "2026-01-15T10:00:00Z",
  },
  drill: null,
  recipient: {
    id: "recipient-abc",
    assignment_id: "assign-1",
    user_id: "student-id",
    status: "completed",
    completed_at: "2026-01-15T11:00:00Z",
  },
  assignment: {
    id: "assign-1",
    class_id: "class-xyz",
    title: "Parli practice",
    type: "practice_round" as const,
    payload: { format: "parli", topic: "Schools should ban phones", side: "aff", speech_duration_seconds: 120 },
  },
  submission: {
    id: "sub-1",
    recipient_id: "recipient-abc",
    user_id: "student-id",
    round_id: "round-123",
  },
};

const MOCK_DRILL_PAYLOAD = {
  type: "drill" as const,
  round: null,
  drill: {
    id: "drill-456",
    user_id: "student-id",
    drill_type: "rebuttal",
    prompt: { title: "Rebuttal Speech", topic: "Topic", prompt: "Arg text", task: "Respond", timer_seconds: 60 },
    response: "My rebuttal was about X.",
    score: {
      score: 8,
      feedback: "Solid clash on the key issues.",
      strengths: ["Good structure"],
      improvements: ["Needs more depth"],
    },
    numeric_score: 8,
    duration_seconds: 58,
    wpm: 150,
    accuracy: null,
    completion: null,
    timer_seconds: 60,
    created_at: "2026-01-15T12:00:00Z",
  },
  recipient: {
    id: "recipient-def",
    assignment_id: "assign-2",
    user_id: "student-id",
    status: "completed",
    completed_at: "2026-01-15T12:05:00Z",
  },
  assignment: {
    id: "assign-2",
    class_id: "class-xyz",
    title: "Rebuttal reps",
    type: "drill" as const,
    payload: { drill_type: "rebuttal", timer_seconds: 60 },
  },
  submission: {
    id: "sub-2",
    recipient_id: "recipient-def",
    user_id: "student-id",
    drill_id: "drill-456",
  },
};

const MOCK_CONTENTION_PAYLOAD = {
  type: "drill" as const,
  round: null,
  drill: {
    id: "drill-contention",
    user_id: "student-id",
    drill_type: "contention",
    prompt: {
      title: "Contention Storm",
      topic: "The United States should ban private prisons.",
      prompt: "Give me as many contentions as you can.",
      task: "Type as many contention taglines as possible.",
      timer_seconds: 60,
    },
    response: "Prisons exploit labor. Prisons destroy accountability.",
    score: {
      score: 8,
    },
    numeric_score: 8,
    duration_seconds: 60,
    wpm: null,
    accuracy: null,
    completion: null,
    timer_seconds: 60,
    created_at: "2026-01-15T12:00:00Z",
  },
  recipient: {
    id: "recipient-contention",
    assignment_id: "assign-contention",
    user_id: "student-id",
    status: "completed",
    completed_at: "2026-01-15T12:05:00Z",
  },
  assignment: {
    id: "assign-contention",
    class_id: "class-xyz",
    title: "Contention drill",
    type: "drill" as const,
    payload: { drill_type: "contention", timer_seconds: 60 },
  },
  submission: {
    id: "sub-contention",
    recipient_id: "recipient-contention",
    user_id: "student-id",
    drill_id: "drill-contention",
  },
};

function mockFetchSuccess(payload: unknown) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => payload,
  });
}

describe("CoachSubmissionPage", () => {
  beforeEach(() => {
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it("renders round RFD and affirmative transcript", async () => {
    mockFetchSuccess(MOCK_ROUND_PAYLOAD);

    const page = await CoachSubmissionPage({
      params: Promise.resolve({ recipientId: "recipient-abc" }),
      searchParams: Promise.resolve({ class: "class-xyz" }),
    });

    render(page);

    // RFD card should appear.
    expect(
      await screen.findByTestId("rfd-card"),
    ).toHaveTextContent("Affirmative wins on the education flow.");

    // Stats.
    expect(screen.getByText("1st speech WPM")).toBeInTheDocument();
    // Both first_speech_wpm and average_wpm are 145 in the mock, so multiple elements exist.
    expect(screen.getAllByText("145").length).toBeGreaterThanOrEqual(1);

    // Transcript details.
    expect(
      screen.getByText(/Student's affirmative speech/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Debby's negative speech/),
    ).toBeInTheDocument();
  });

  it("renders drill stats and feedback", async () => {
    mockFetchSuccess(MOCK_DRILL_PAYLOAD);

    const page = await CoachSubmissionPage({
      params: Promise.resolve({ recipientId: "recipient-def" }),
      searchParams: Promise.resolve({ class: "class-xyz" }),
    });

    render(page);

    expect(await screen.findByText("Drill stats")).toBeInTheDocument();
    expect(screen.getByText("My rebuttal was about X.")).toBeInTheDocument();
  });

  it("shows the contention topic in the coach drill results view", async () => {
    mockFetchSuccess(MOCK_CONTENTION_PAYLOAD);

    const page = await CoachSubmissionPage({
      params: Promise.resolve({ recipientId: "recipient-contention" }),
      searchParams: Promise.resolve({ class: "class-xyz" }),
    });

    render(page);

    expect(
      await screen.findByText("The United States should ban private prisons."),
    ).toBeInTheDocument();
  });

  it("shows not-found when class param is missing", async () => {
    const page = await CoachSubmissionPage({
      params: Promise.resolve({ recipientId: "recipient-abc" }),
      searchParams: Promise.resolve({}),
    });

    render(page);

    await waitFor(() => {
      expect(
        screen.getByText(/Submission not found or you do not have access/),
      ).toBeInTheDocument();
    });
  });

  it("shows not-found on 403 from API", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ detail: "Coach role required" }),
    });

    const page = await CoachSubmissionPage({
      params: Promise.resolve({ recipientId: "recipient-abc" }),
      searchParams: Promise.resolve({ class: "class-xyz" }),
    });

    render(page);

    await waitFor(() => {
      expect(
        screen.getByText(/Submission not found or you do not have access/),
      ).toBeInTheDocument();
    });
  });
});
