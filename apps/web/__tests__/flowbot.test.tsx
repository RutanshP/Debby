import { render, screen } from "@testing-library/react";
import FlowView from "@/app/(app)/flowbot/[roundId]/flow-view";
import type { FlowSheetData } from "@/components/FlowSheet";

jest.mock("next/headers", () => ({
  cookies: jest.fn(() => ({
    get: jest.fn(() => undefined),
    set: jest.fn(),
  })),
}));

jest.mock("@/lib/supabase", () => ({
  getServerSupabase: jest.fn(),
}));

describe("FlowView", () => {
  it("renders both sheets given a flow prop", () => {
    const flow: FlowSheetData = {
      aff: [{ tag: "Aff Tag", summary: "Aff summary" }],
      neg: [{ tag: "Neg Tag", summary: "Neg summary", refuted: true }],
      ballot: "Aff wins on warming.",
    };

    render(<FlowView flow={flow} />);

    expect(screen.getByText("Affirmative")).toBeInTheDocument();
    expect(screen.getByText("Negative")).toBeInTheDocument();
    expect(screen.getByText("Aff Tag")).toBeInTheDocument();
    expect(screen.getByText("Neg Tag")).toBeInTheDocument();
    expect(screen.getByText("Aff wins on warming.")).toBeInTheDocument();
  });

  it("shows no-flow placeholder when flow is empty", () => {
    render(<FlowView flow={null} />);
    expect(screen.getByTestId("flow-empty")).toBeInTheDocument();

    const empty: FlowSheetData = { aff: [], neg: [] };
    render(<FlowView flow={empty} />);
    expect(screen.getAllByTestId("flow-empty").length).toBeGreaterThan(0);
  });
});

describe("FlowbotRoundPage (server component)", () => {
  const ORIGINAL_FETCH = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  async function loadPage() {
    return await import("@/app/(app)/flowbot/[roundId]/page");
  }

  it("fetches /api/rounds/[roundId] with bearer token and renders the flow", async () => {
    const { cookies } = require("next/headers");
    const { getServerSupabase } = require("@/lib/supabase");

    (cookies as jest.Mock).mockReturnValue({
      get: jest.fn(() => ({ value: "cookie" })),
      set: jest.fn(),
    });
    (getServerSupabase as jest.Mock).mockReturnValue({
      auth: {
        getSession: jest.fn(async () => ({
          data: { session: { access_token: "abc123" } },
        })),
      },
    });

    const flow: FlowSheetData = {
      aff: [{ tag: "A", summary: "a" }],
      neg: [{ tag: "N", summary: "n" }],
    };
    const fetchMock = jest.fn(async () =>
      new Response(JSON.stringify({ id: "r1", flow }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const { default: Page } = await loadPage();
    const element = await Page({ params: { roundId: "r1" } });

    render(element);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/rounds/r1");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer abc123",
    });
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("renders 'Round not found' when the API returns 404", async () => {
    const { cookies } = require("next/headers");
    const { getServerSupabase } = require("@/lib/supabase");

    (cookies as jest.Mock).mockReturnValue({
      get: jest.fn(() => ({ value: "cookie" })),
      set: jest.fn(),
    });
    (getServerSupabase as jest.Mock).mockReturnValue({
      auth: {
        getSession: jest.fn(async () => ({
          data: { session: { access_token: "abc123" } },
        })),
      },
    });

    global.fetch = jest.fn(
      async () => new Response("", { status: 404 }),
    ) as unknown as typeof fetch;

    const { default: Page } = await loadPage();
    const element = await Page({ params: { roundId: "missing" } });
    render(element);

    expect(screen.getByText(/Round not found/i)).toBeInTheDocument();
  });

  it("renders 'Round not found' when there's no session", async () => {
    const { cookies } = require("next/headers");
    const { getServerSupabase } = require("@/lib/supabase");

    (cookies as jest.Mock).mockReturnValue({
      get: jest.fn(() => undefined),
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
    const element = await Page({ params: { roundId: "r1" } });
    render(element);

    expect(screen.getByText(/Round not found/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
