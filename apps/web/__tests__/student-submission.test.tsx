import { render, screen, waitFor } from "@testing-library/react";
import StudentSubmissionPage from "@/app/(app)/classes/results/[recipientId]/page";

jest.mock("@/lib/supabase", () => ({
  getServerSupabase: () => ({
    auth: {
      getSession: async () => ({
        data: {
          session: {
            access_token: "student-token",
            user: { id: "student-id" },
          },
        },
      }),
    },
  }),
}));

jest.mock("next/headers", () => ({
  cookies: async () => ({}),
}));

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

jest.mock("@/components/RfdCard", () => ({
  RfdCard: ({ rfd }: { rfd: string }) => <div data-testid="rfd-card">{rfd}</div>,
}));

jest.mock("@/components/WpmChart", () => ({
  WpmChart: () => <div data-testid="wpm-chart" />,
}));

jest.mock("@/components/FlowSheet", () => ({
  FlowSheet: () => <div data-testid="flow-sheet" />,
}));

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
  case_review: null,
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

describe("StudentSubmissionPage", () => {
  beforeEach(() => {
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it("renders detailed results and coach feedback when available", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => MOCK_DRILL_PAYLOAD,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: "fb-1",
          recipient_id: "recipient-def",
          grade: 8,
          feedback: "Coach says tighten the internal links.",
          returned: true,
        }),
      });

    const page = await StudentSubmissionPage({
      params: Promise.resolve({ recipientId: "recipient-def" }),
      searchParams: Promise.resolve({ class: "class-xyz" }),
    });

    render(page);

    expect(await screen.findByText("Drill stats")).toBeInTheDocument();
    expect(screen.getByText("Coach feedback")).toBeInTheDocument();
    expect(
      screen.getByText("Coach says tighten the internal links."),
    ).toBeInTheDocument();
  });

  it("shows no feedback yet when the coach has not returned feedback", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => MOCK_DRILL_PAYLOAD,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => null,
      });

    const page = await StudentSubmissionPage({
      params: Promise.resolve({ recipientId: "recipient-def" }),
      searchParams: Promise.resolve({ class: "class-xyz" }),
    });

    render(page);

    expect(await screen.findByText("No feedback yet.")).toBeInTheDocument();
  });

  it("shows not-found on 403 from the submission API", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ detail: "Recipient does not belong to this user" }),
    });

    const page = await StudentSubmissionPage({
      params: Promise.resolve({ recipientId: "recipient-def" }),
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
