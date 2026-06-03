import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommentThread } from "@/components/classroom/CommentThread";

jest.mock("@/lib/supabase", () => ({
  getBrowserSupabase: () => ({
    auth: { getSession: async () => ({ data: { session: null } }) },
  }),
}));

function mockFetchOnce(payload: unknown, status = 200) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  });
}

const CLASS_ID = "class-uuid-1";
const TARGET_ID = "assignment-uuid-1";

describe("CommentThread", () => {
  beforeEach(() => {
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it("renders an expand button and no comments by default", () => {
    render(
      <CommentThread
        classId={CLASS_ID}
        targetType="assignment"
        targetId={TARGET_ID}
      />,
    );
    expect(
      screen.getByRole("button", { name: /add comment/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /comments/i })).not.toBeInTheDocument();
  });

  it("loads and lists comments when expanded", async () => {
    const user = userEvent.setup();

    mockFetchOnce([
      {
        id: "comment-1",
        class_id: CLASS_ID,
        target_type: "assignment",
        target_id: TARGET_ID,
        author_id: "author-uuid-abcd1234",
        body: "Great work!",
        is_private: false,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);
    // resolveUserNames call (profiles/lookup) - return empty to trigger shortId fallback
    mockFetchOnce({}, 200);

    render(
      <CommentThread
        classId={CLASS_ID}
        targetType="assignment"
        targetId={TARGET_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: /add comment/i }));

    await waitFor(() => {
      expect(screen.getByText("Great work!")).toBeInTheDocument();
    });

    // Author shown as shortId (first 8 chars of "author-uuid-abcd1234")
    expect(screen.getByText("author-u")).toBeInTheDocument();
  });

  it("posts a new comment and shows it in the list", async () => {
    const user = userEvent.setup();

    // Initial list (empty).
    mockFetchOnce([]);
    // resolveUserNames for empty list
    mockFetchOnce({}, 200);

    render(
      <CommentThread
        classId={CLASS_ID}
        targetType="assignment"
        targetId={TARGET_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: /add comment/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/comment body/i)).toBeInTheDocument();
    });

    const input = screen.getByLabelText(/comment body/i);
    await user.type(input, "Nice assignment!");

    // Mock the POST response.
    mockFetchOnce({
      id: "comment-new",
      class_id: CLASS_ID,
      target_type: "assignment",
      target_id: TARGET_ID,
      author_id: "me-uuid-12345678",
      body: "Nice assignment!",
      is_private: false,
      created_at: "2026-01-02T00:00:00Z",
    });
    // resolveUserNames for the new author
    mockFetchOnce({ "me-uuid-12345678": "Me" });

    await user.click(screen.getByRole("button", { name: /^post$/i }));

    await waitFor(() => {
      expect(screen.getByText("Nice assignment!")).toBeInTheDocument();
    });
  });

  it("shows private checkbox when allowPrivate is true", async () => {
    const user = userEvent.setup();

    mockFetchOnce([]);
    mockFetchOnce({}, 200);

    render(
      <CommentThread
        classId={CLASS_ID}
        targetType="assignment"
        targetId={TARGET_ID}
        allowPrivate
      />,
    );

    await user.click(screen.getByRole("button", { name: /add comment/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/private/i)).toBeInTheDocument();
    });
  });

  it("does not show private checkbox when allowPrivate is false", async () => {
    const user = userEvent.setup();

    mockFetchOnce([]);
    mockFetchOnce({}, 200);

    render(
      <CommentThread
        classId={CLASS_ID}
        targetType="assignment"
        targetId={TARGET_ID}
        allowPrivate={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: /add comment/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/comment body/i)).toBeInTheDocument();
    });

    expect(screen.queryByLabelText(/private/i)).not.toBeInTheDocument();
  });

  it("shows delete button for own comments", async () => {
    const user = userEvent.setup();

    mockFetchOnce([
      {
        id: "comment-mine",
        class_id: CLASS_ID,
        target_type: "assignment",
        target_id: TARGET_ID,
        author_id: "my-user-id",
        body: "My comment",
        is_private: false,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);
    mockFetchOnce({}, 200);

    render(
      <CommentThread
        classId={CLASS_ID}
        targetType="assignment"
        targetId={TARGET_ID}
        currentUserId="my-user-id"
        currentUserRole="competitor"
      />,
    );

    await user.click(screen.getByRole("button", { name: /add comment/i }));

    await waitFor(() => {
      expect(screen.getByText("My comment")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /delete comment/i })).toBeInTheDocument();
  });

  it("hides delete button for other users' comments when not coach", async () => {
    const user = userEvent.setup();

    mockFetchOnce([
      {
        id: "comment-theirs",
        class_id: CLASS_ID,
        target_type: "assignment",
        target_id: TARGET_ID,
        author_id: "other-user-id",
        body: "Their comment",
        is_private: false,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);
    mockFetchOnce({}, 200);

    render(
      <CommentThread
        classId={CLASS_ID}
        targetType="assignment"
        targetId={TARGET_ID}
        currentUserId="my-user-id"
        currentUserRole="competitor"
      />,
    );

    await user.click(screen.getByRole("button", { name: /add comment/i }));

    await waitFor(() => {
      expect(screen.getByText("Their comment")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: /delete comment/i })).not.toBeInTheDocument();
  });
});
