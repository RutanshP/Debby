import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StreamTab } from "@/components/classroom/StreamTab";
import type { AssignmentRecipientDetail, ClassDetail } from "@/lib/classroom";

jest.mock("@/lib/supabase", () => ({
  getBrowserSupabase: () => ({
    auth: { getSession: async () => ({ data: { session: null } }) },
  }),
}));

// Helper to build a ClassDetail fixture.
function makeClassDetail(role: "coach" | "competitor"): ClassDetail {
  return {
    class_room: {
      id: "class-123",
      name: "Varsity Parli",
      join_code: "ABC123",
      created_by: "coach-user-id",
      created_at: "2026-01-01T00:00:00+00:00",
    },
    role,
    roster: [],
    assignments: [],
  };
}

function mockFetchOnce(payload: unknown, status = 200) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  });
}

const SAMPLE_POSTS = [
  {
    id: "post-1",
    class_id: "class-123",
    author_id: "coach-user-id",
    type: "announcement",
    title: "Welcome to the team",
    body: "Great season ahead!",
    link_url: null,
    created_at: "2026-01-02T10:00:00+00:00",
  },
  {
    id: "post-2",
    class_id: "class-123",
    author_id: "coach-user-id",
    type: "material",
    title: "Watch this video",
    body: null,
    link_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    created_at: "2026-01-01T09:00:00+00:00",
  },
];

const SAMPLE_ASSIGNMENT: AssignmentRecipientDetail = {
  recipient: {
    id: "recipient-1",
    assignment_id: "assignment-1",
    user_id: "student-1",
    status: "completed",
    created_at: "2026-01-03T10:00:00+00:00",
  },
  assignment: {
    id: "assignment-1",
    class_id: "class-123",
    assigned_by: "coach-user-id",
    title: "Rebuttal Drill",
    type: "drill",
    payload: {
      drill_type: "rebuttal",
      timer_seconds: 60,
    },
    due_at: "2026-01-05T23:59:00+00:00",
    created_at: "2026-01-03T09:00:00+00:00",
  },
  class_room: {
    id: "class-123",
    name: "Varsity Parli",
    join_code: "ABC123",
    created_by: "coach-user-id",
    created_at: "2026-01-01T00:00:00+00:00",
  },
  result: { numeric_score: 8 },
};

describe("StreamTab", () => {
  beforeEach(() => {
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it("renders the class banner with class name", async () => {
    mockFetchOnce([]); // posts fetch
    mockFetchOnce({}); // profiles lookup (may not be called)

    render(<StreamTab classDetail={makeClassDetail("coach")} />);

    expect(screen.getByText("Varsity Parli")).toBeInTheDocument();
    expect(screen.getByText(/ABC123/)).toBeInTheDocument();
  });

  it("renders posts after loading", async () => {
    // profiles lookup 404 → graceful degradation
    mockFetchOnce(SAMPLE_POSTS);
    mockFetchOnce({}, 404); // profiles lookup returns 404

    render(<StreamTab classDetail={makeClassDetail("coach")} />);

    await waitFor(() => {
      expect(screen.getByText("Welcome to the team")).toBeInTheDocument();
    });
    expect(screen.getByText("Great season ahead!")).toBeInTheDocument();
    expect(screen.getByText("Watch this video")).toBeInTheDocument();
  });

  it("shows coach composer when role is coach", async () => {
    mockFetchOnce([]);

    render(<StreamTab classDetail={makeClassDetail("coach")} />);

    // Composer form should be visible.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Post/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("Type")).toBeInTheDocument();
  });

  it("hides composer when role is competitor", async () => {
    mockFetchOnce([]);

    render(<StreamTab classDetail={makeClassDetail("competitor")} />);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /^Post$/i })).not.toBeInTheDocument();
    });
  });

  it("coach can create a post and it appears in the list", async () => {
    const user = userEvent.setup();
    // Initial load: posts fetch returns empty list (no profiles lookup since empty).
    mockFetchOnce([]);

    const newPost = {
      id: "post-new",
      class_id: "class-123",
      author_id: "coach-user-id",
      type: "announcement",
      title: "New post title",
      body: "New post body",
      link_url: null,
      created_at: new Date().toISOString(),
    };
    // POST to create the post.
    mockFetchOnce(newPost);
    // Profiles lookup after creating the post (graceful 404).
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "Not Found",
      json: async () => ({ detail: "not found" }),
    });

    render(<StreamTab classDetail={makeClassDetail("coach")} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Post$/i })).toBeInTheDocument();
    });
    // Wait for initial load to complete.
    await waitFor(() => {
      expect(screen.getByText(/No posts yet/i)).toBeInTheDocument();
    });

    const titleInput = screen.getByPlaceholderText(/e.g. Watch this breakdown/i);
    await user.type(titleInput, "New post title");

    const bodyTextarea = screen.getByPlaceholderText(/Write an announcement/i);
    await user.type(bodyTextarea, "New post body");

    await user.click(screen.getByRole("button", { name: /^Post$/i }));

    await waitFor(() => {
      expect(screen.getByText("New post title")).toBeInTheDocument();
    });
    expect(screen.getByText("New post body")).toBeInTheDocument();
  });

  it("renders a YouTube embed for material with YouTube link", async () => {
    mockFetchOnce(SAMPLE_POSTS);
    mockFetchOnce({}, 404); // profiles lookup

    render(<StreamTab classDetail={makeClassDetail("coach")} />);

    await waitFor(() => {
      const iframe = screen.getByTitle("YouTube video");
      expect(iframe).toBeInTheDocument();
      expect(iframe).toHaveAttribute(
        "src",
        "https://www.youtube.com/embed/dQw4w9WgXcQ",
      );
    });
  });

  it("shows empty state message when no posts", async () => {
    mockFetchOnce([]);

    render(<StreamTab classDetail={makeClassDetail("coach")} />);

    await waitFor(() => {
      expect(screen.getByText(/No posts yet/i)).toBeInTheDocument();
    });
  });

  it("degrades gracefully when profiles lookup errors", async () => {
    mockFetchOnce(SAMPLE_POSTS);
    // Simulate a network error for profiles lookup.
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network error"));

    render(<StreamTab classDetail={makeClassDetail("competitor")} />);

    // Posts should still render with short IDs.
    await waitFor(() => {
      expect(screen.getByText("Welcome to the team")).toBeInTheDocument();
    });
    // Author short-id should appear (first 8 chars of "coach-user-id").
    expect(screen.getAllByText(/coach-us/).length).toBeGreaterThan(0);
  });

  it("shows assignments in the student stream feed", async () => {
    const studentDetail = makeClassDetail("competitor");
    studentDetail.class_room.id = "class-assignments";
    mockFetchOnce([]);

    render(
      <StreamTab
        classDetail={studentDetail}
        assignments={[
          {
            ...SAMPLE_ASSIGNMENT,
            assignment: {
              ...SAMPLE_ASSIGNMENT.assignment,
              class_id: "class-assignments",
            },
            class_room: {
              ...SAMPLE_ASSIGNMENT.class_room,
              id: "class-assignments",
            },
          },
        ]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Rebuttal Drill")).toBeInTheDocument();
    });
    expect(screen.getByText(/^Assignment$/i)).toBeInTheDocument();
    expect(screen.getByText(/Score 8\/10/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open assignment/i })).toHaveAttribute(
      "href",
      "/drills?class=class-assignments&assignment=recipient-1",
    );
  });
});
