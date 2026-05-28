/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { HistoryList, type HistoryRound } from "@/app/(app)/history/history-list";

jest.mock("next/headers", () => ({ cookies: jest.fn() }));
jest.mock("@/lib/supabase", () => ({ getServerSupabase: jest.fn() }));

const ROUNDS: HistoryRound[] = [
  {
    id: "r1",
    topic: "UBI",
    format: "parli",
    side: "aff",
    winner_side: "aff",
    created_at: "2026-05-01T00:00:00Z",
  },
  {
    id: "r2",
    topic: "Phones",
    format: "mspdp",
    side: "neg",
    winner_side: "neg",
    created_at: "2026-05-02T00:00:00Z",
  },
  {
    id: "r3",
    topic: "Open",
    format: "parli",
    side: "aff",
    winner_side: null,
    flow: { ballot: { winner: "neg" } },
    created_at: "2026-05-03T00:00:00Z",
  },
];

describe("HistoryList", () => {
  it("renders one row per round", () => {
    render(<HistoryList rounds={ROUNDS} />);
    expect(screen.getByText("UBI")).toBeInTheDocument();
    expect(screen.getByText("Phones")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
  });

  it("computes aggregate counts", () => {
    render(<HistoryList rounds={ROUNDS} />);
    expect(screen.getByTestId("stat-total").textContent).toBe("3");
    // Round r1: user is aff and winner is aff → user win.
    // Round r2: user is neg and winner is aff → debby win.
    // Round r3: no winner_side → counted as neither.
    expect(screen.getByTestId("stat-user-wins").textContent).toBe("2");
    expect(screen.getByTestId("stat-debby-wins").textContent).toBe("1");
  });

  it("shows winner pills as You or Debby", () => {
    render(<HistoryList rounds={ROUNDS} />);
    expect(screen.getAllByText("Winner: You")).toHaveLength(2);
    expect(screen.getByText("Winner: Debby")).toBeInTheDocument();
  });

  it("shows the empty state when the list is empty", () => {
    render(<HistoryList rounds={[]} />);
    expect(screen.getByText(/no rounds yet/i)).toBeInTheDocument();
  });
});

describe("HistoryPage (server component) — list view", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  async function loadPage() {
    return import("@/app/(app)/history/page");
  }

  it("calls /api/rounds with the user's bearer token", async () => {
    const { cookies } = require("next/headers");
    const { getServerSupabase } = require("@/lib/supabase");

    (cookies as jest.Mock).mockReturnValue({
      get: jest.fn(),
      set: jest.fn(),
    });
    (getServerSupabase as jest.Mock).mockReturnValue({
      auth: {
        getSession: jest.fn(async () => ({
          data: { session: { access_token: "abc123" } },
        })),
      },
    });

    const fetchMock = jest.fn(async () =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const { default: Page } = await loadPage();
    const element = await Page();
    render(element);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      unknown,
      RequestInit,
    ];
    expect(String(url)).toContain("/api/rounds?limit=50");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer abc123",
    });
  });

  it("falls back to an empty list when there is no session", async () => {
    const { cookies } = require("next/headers");
    const { getServerSupabase } = require("@/lib/supabase");

    (cookies as jest.Mock).mockReturnValue({
      get: jest.fn(),
      set: jest.fn(),
    });
    (getServerSupabase as jest.Mock).mockReturnValue({
      auth: {
        getSession: jest.fn(async () => ({ data: { session: null } })),
      },
    });
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { default: Page } = await loadPage();
    render(await Page());

    expect(screen.getByText(/no rounds yet/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("HistoryDetailPage (server component)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  async function loadPage() {
    return import("@/app/(app)/history/[roundId]/page");
  }

  function withSession(token: string | null) {
    const { cookies } = require("next/headers");
    const { getServerSupabase } = require("@/lib/supabase");
    (cookies as jest.Mock).mockReturnValue({ get: jest.fn(), set: jest.fn() });
    (getServerSupabase as jest.Mock).mockReturnValue({
      auth: {
        getSession: jest.fn(async () => ({
          data: { session: token ? { access_token: token } : null },
        })),
      },
    });
  }

  it("renders RfdCard, WpmChart, and FlowSheet for a stored round", async () => {
    withSession("tok");
    const round = {
      id: "r1",
      topic: "UBI",
      format: "parli",
      side: "aff",
      rfd: "Aff wins.",
      winner_side: "aff",
      flow: { aff: [{ tag: "Econ", summary: "growth" }], neg: [] },
      first_speech_wpm: 150,
      second_speech_wpm: 170,
      average_wpm: 160,
      wpm_series: {
        aff: [{ t: 0, wpm: 150 }],
        aff_two: [{ t: 0, wpm: 170 }],
      },
      aff_speech: "first",
      neg_speech: "second",
      aff_two_speech: "rebuttal",
      created_at: "2026-05-01T00:00:00Z",
    };
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify(round), { status: 200 }),
    ) as unknown as typeof fetch;

    const { default: Page } = await loadPage();
    render(await Page({ params: Promise.resolve({ roundId: "r1" }) }));

    expect(screen.getByRole("heading", { name: "UBI" })).toBeInTheDocument();
    expect(screen.getByText("Winner: You (Affirmative)")).toBeInTheDocument();
    expect(screen.getByText("Aff wins.")).toBeInTheDocument();
    expect(screen.getByText(/speech statistics/i)).toBeInTheDocument();
    expect(screen.getByText("1st speech WPM")).toBeInTheDocument();
    expect(screen.getByText("2nd speech WPM")).toBeInTheDocument();
    expect(screen.getByText("150")).toBeInTheDocument();
    expect(screen.getByText("170")).toBeInTheDocument();
    expect(screen.getByText("Econ")).toBeInTheDocument();
    expect(screen.getByText(/affirmative speech/i)).toBeInTheDocument();
  });

  it("shows 'Round not found' on 404", async () => {
    withSession("tok");
    global.fetch = jest.fn(
      async () => new Response("missing", { status: 404 }),
    ) as unknown as typeof fetch;
    const { default: Page } = await loadPage();
    render(await Page({ params: Promise.resolve({ roundId: "x" }) }));
    expect(screen.getByText(/round not found/i)).toBeInTheDocument();
  });
});
