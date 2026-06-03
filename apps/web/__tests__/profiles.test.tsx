import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("@/lib/supabase", () => ({
  getBrowserSupabase: () => ({
    auth: { getSession: async () => ({ data: { session: null } }) },
  }),
}));

// ----- helpers -----

function mockFetchOnce(payload: unknown, status = 200) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  });
}

// ----- useProfileNames hook tests -----

import { useProfileNames, shortId } from "@/lib/profiles";

function ProfileDisplay({ ids }: { ids: string[] }) {
  const { nameFor } = useProfileNames(ids);
  return (
    <ul>
      {ids.map((id) => (
        <li key={id} data-testid={`name-${id}`}>
          {nameFor(id)}
        </li>
      ))}
    </ul>
  );
}

// Use unique IDs per test to avoid module-level cache cross-contamination.
let _counter = 0;
function uid(prefix: string) {
  return `${prefix}-${++_counter}-0000-0000-0000-000000000000`;
}

describe("shortId", () => {
  it("returns first 8 chars for a long id", () => {
    expect(shortId("abcdefghijklmnop")).toBe("abcdefgh");
  });

  it("returns the id as-is when it is 8 chars or fewer", () => {
    expect(shortId("abc")).toBe("abc");
    expect(shortId("abcdefgh")).toBe("abcdefgh");
  });
});

describe("useProfileNames", () => {
  beforeEach(() => {
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it("falls back to shortId when lookup returns no entry for a user", async () => {
    const USER_A = uid("aaa");
    const UNKNOWN = uid("ccc");
    // Lookup returns only USER_A; UNKNOWN should fall back.
    mockFetchOnce({ [USER_A]: "Alice" });

    render(<ProfileDisplay ids={[USER_A, UNKNOWN]} />);

    await waitFor(() => {
      expect(screen.getByTestId(`name-${USER_A}`)).toHaveTextContent("Alice");
    });
    expect(screen.getByTestId(`name-${UNKNOWN}`)).toHaveTextContent(
      shortId(UNKNOWN),
    );
  });

  it("renders a real name when present in lookup result", async () => {
    const USER_A = uid("aaa");
    const USER_B = uid("bbb");
    mockFetchOnce({ [USER_A]: "Alice", [USER_B]: "Bob" });

    render(<ProfileDisplay ids={[USER_A, USER_B]} />);

    await waitFor(() => {
      expect(screen.getByTestId(`name-${USER_A}`)).toHaveTextContent("Alice");
      expect(screen.getByTestId(`name-${USER_B}`)).toHaveTextContent("Bob");
    });
  });

  it("shows shortId while fetch is pending", async () => {
    const USER_A = uid("pending");
    // Never resolves
    (global.fetch as jest.Mock).mockImplementationOnce(
      () => new Promise(() => undefined),
    );

    render(<ProfileDisplay ids={[USER_A]} />);

    // Immediately after render (before fetch resolves), we should see the shortId fallback.
    expect(screen.getByTestId(`name-${USER_A}`)).toHaveTextContent(
      shortId(USER_A),
    );
  });

  it("gracefully handles fetch errors by keeping shortId fallback", async () => {
    const USER_A = uid("err");
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network error"));

    render(<ProfileDisplay ids={[USER_A]} />);

    // After error, should still render shortId without crashing.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(screen.getByTestId(`name-${USER_A}`)).toHaveTextContent(
      shortId(USER_A),
    );
  });
});

// ----- SettingsPage tests -----

import SettingsPage from "@/app/(app)/settings/page";

describe("SettingsPage", () => {
  beforeEach(() => {
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it("loads and displays current display name", async () => {
    const USER_A = uid("settings");
    mockFetchOnce({ user_id: USER_A, display_name: "Alice" });
    render(<SettingsPage />);

    await waitFor(() => {
      const input = screen.getByRole("textbox") as HTMLInputElement;
      expect(input.value).toBe("Alice");
    });
  });

  it("saves updated display name", async () => {
    const user = userEvent.setup();
    const USER_A = uid("save");
    mockFetchOnce({ user_id: USER_A, display_name: "Alice" });
    render(<SettingsPage />);

    await waitFor(() => {
      expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Alice");
    });

    mockFetchOnce({ user_id: USER_A, display_name: "Alice Updated" });
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "Alice Updated");
    await user.click(screen.getByRole("button", { name: /Save/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Display name saved.");
    });
  });
});
