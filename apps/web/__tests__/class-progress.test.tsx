import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClassProgressDashboard } from "@/components/classroom/ClassProgressDashboard";
import type { ClassProgressResponse } from "@/lib/coachProgress";

// Minimal chart mocks to avoid recharts/canvas issues in jsdom
jest.mock("@/components/progress/WpmTrendChart", () => ({
  WpmTrendChart: ({ data }: { data: unknown[] }) => (
    <div data-testid="wpm-trend-chart">{data.length} points</div>
  ),
}));

jest.mock("@/components/progress/FillerTrendChart", () => ({
  FillerTrendChart: ({ data }: { data: unknown[] }) => (
    <div data-testid="filler-trend-chart">{data.length} points</div>
  ),
}));

jest.mock("@/components/progress/WinRateBreakdown", () => ({
  WinRateBreakdownCard: () => <div data-testid="win-rate-breakdown" />,
}));

jest.mock("@/components/progress/DrillScoreTrend", () => ({
  DrillScoreTrendChart: () => <div data-testid="drill-score-trend" />,
}));

jest.mock("@/components/progress/WeaknessSpotlight", () => ({
  WeaknessSpotlight: () => <div data-testid="weakness-spotlight" />,
}));

jest.mock("@/components/progress/ActivityHeatmap", () => ({
  ActivityHeatmap: () => <div data-testid="activity-heatmap" />,
}));

jest.mock("@/components/progress/RecentRoundsList", () => ({
  RecentRoundsList: ({ rounds }: { rounds: unknown[] }) => (
    <div data-testid="recent-rounds-list">{rounds.length} rounds</div>
  ),
}));

jest.mock("@/components/progress/DroppedArgumentPatterns", () => ({
  DroppedArgumentPatterns: () => <div data-testid="dropped-patterns" />,
}));

jest.mock("@/lib/supabase", () => ({
  getBrowserSupabase: () => ({
    auth: { getSession: async () => ({ data: { session: null } }) },
  }),
}));

const STUDENT_A_ID = "aaaa-aaaa-aaaa-aaaa";
const STUDENT_B_ID = "bbbb-bbbb-bbbb-bbbb";

const MOCK_PAYLOAD: ClassProgressResponse = {
  students: [
    {
      user_id: STUDENT_A_ID,
      rounds: [
        {
          id: "r1",
          topic: "Ban phones",
          format: "parli",
          side: "aff",
          winner_side: "aff",
          average_wpm: 160,
          filler_count: 2,
          major_pause_count: 0,
          created_at: "2026-01-10T10:00:00Z",
        },
      ],
      drills: [
        {
          id: "d1",
          drill_type: "rebuttal",
          numeric_score: 8,
          created_at: "2026-01-10T11:00:00Z",
        },
      ],
    },
    {
      user_id: STUDENT_B_ID,
      rounds: [
        {
          id: "r2",
          topic: "Free trade",
          format: "mspdp",
          side: "neg",
          winner_side: "neg",
          average_wpm: 140,
          filler_count: 5,
          major_pause_count: 1,
          created_at: "2026-01-11T10:00:00Z",
        },
        {
          id: "r3",
          topic: "Climate change",
          format: "parli",
          side: "aff",
          winner_side: "aff",
          average_wpm: 155,
          filler_count: 3,
          major_pause_count: 0,
          created_at: "2026-01-12T10:00:00Z",
        },
      ],
      drills: [],
    },
  ],
};

function mockFetchOnce(payload: unknown) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => "",
    json: async () => payload,
  });
}

function mockFetchFail() {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: false,
    status: 403,
    statusText: "Forbidden",
    text: async () => "Forbidden",
    json: async () => ({ detail: "Forbidden" }),
  });
}

describe("ClassProgressDashboard", () => {
  beforeEach(() => {
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it("shows loading state initially", () => {
    (global.fetch as jest.Mock).mockImplementationOnce(() => new Promise(() => undefined));
    render(<ClassProgressDashboard classId="class-1" />);
    expect(screen.getByText(/Loading progress/i)).toBeInTheDocument();
  });

  it("renders aggregate view for all students by default", async () => {
    // First call: class progress, second call: profiles lookup (fails gracefully)
    mockFetchOnce(MOCK_PAYLOAD);
    mockFetchFail(); // profiles lookup can fail

    render(<ClassProgressDashboard classId="class-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("selector-all")).toBeInTheDocument();
    });

    // Both student selectors should be visible
    expect(screen.getByTestId(`selector-${STUDENT_A_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`selector-${STUDENT_B_ID}`)).toBeInTheDocument();

    // Aggregate view has 3 rounds total (1 + 2)
    expect(screen.getByTestId("recent-rounds-list")).toHaveTextContent("3 rounds");

    // WPM trend should have 3 points (all rounds have average_wpm)
    expect(screen.getByTestId("wpm-trend-chart")).toHaveTextContent("3 points");
  });

  it("switches to individual student view when a student is selected", async () => {
    const user = userEvent.setup();
    mockFetchOnce(MOCK_PAYLOAD);
    mockFetchFail(); // profiles lookup

    render(<ClassProgressDashboard classId="class-1" />);

    await waitFor(() => {
      expect(screen.getByTestId(`selector-${STUDENT_A_ID}`)).toBeInTheDocument();
    });

    // Student A has 1 round
    await user.click(screen.getByTestId(`selector-${STUDENT_A_ID}`));

    await waitFor(() => {
      expect(screen.getByTestId("recent-rounds-list")).toHaveTextContent("1 rounds");
    });

    expect(screen.getByTestId("wpm-trend-chart")).toHaveTextContent("1 points");
  });

  it("switches back to aggregate view when All students is selected", async () => {
    const user = userEvent.setup();
    mockFetchOnce(MOCK_PAYLOAD);
    mockFetchFail();

    render(<ClassProgressDashboard classId="class-1" />);

    await waitFor(() => {
      expect(screen.getByTestId(`selector-${STUDENT_B_ID}`)).toBeInTheDocument();
    });

    // Select student B (2 rounds)
    await user.click(screen.getByTestId(`selector-${STUDENT_B_ID}`));
    await waitFor(() => {
      expect(screen.getByTestId("recent-rounds-list")).toHaveTextContent("2 rounds");
    });

    // Back to All (3 rounds)
    await user.click(screen.getByTestId("selector-all"));
    await waitFor(() => {
      expect(screen.getByTestId("recent-rounds-list")).toHaveTextContent("3 rounds");
    });
  });

  it("shows no-competitors message when students array is empty", async () => {
    mockFetchOnce({ students: [] });

    render(<ClassProgressDashboard classId="class-1" />);

    await waitFor(() => {
      expect(screen.getByText(/No competitors yet/i)).toBeInTheDocument();
    });
  });

  it("shows an error message when the fetch fails", async () => {
    mockFetchFail();

    render(<ClassProgressDashboard classId="class-1" />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });
});
