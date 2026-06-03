import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClassSettings } from "@/components/classroom/ClassSettings";
import type { ClassDetail } from "@/lib/classroom";

jest.mock("@/lib/supabase", () => ({
  getBrowserSupabase: () => ({
    auth: { getSession: async () => ({ data: { session: null } }) },
  }),
}));

function mockFetchOk(payload: unknown, status = 200) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status < 400,
    status,
    statusText: "OK",
    text: async () => "",
    json: async () => payload,
  });
}

function mockFetchNoContent() {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    status: 204,
    statusText: "No Content",
    text: async () => "",
    json: async () => null,
  });
}

const CLASS_ID = "class-abc-123";
const STUDENT_ID = "student-xyz-456";

const baseClassRoom = {
  id: CLASS_ID,
  name: "Varsity Parli",
  join_code: "ABC123",
  created_by: "coach-id",
  created_at: null,
};

const coachDetail: ClassDetail = {
  class_room: baseClassRoom,
  role: "coach",
  roster: [
    { class_id: CLASS_ID, user_id: "coach-id", role: "coach", joined_at: null },
    { class_id: CLASS_ID, user_id: STUDENT_ID, role: "competitor", joined_at: null },
  ],
  assignments: [],
};

const studentDetail: ClassDetail = {
  class_room: baseClassRoom,
  role: "competitor",
  roster: [
    { class_id: CLASS_ID, user_id: "coach-id", role: "coach", joined_at: null },
    { class_id: CLASS_ID, user_id: STUDENT_ID, role: "competitor", joined_at: null },
  ],
  assignments: [],
};

describe("ClassSettings — coach view", () => {
  beforeEach(() => {
    global.fetch = jest.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    jest.resetAllMocks();
  });

  it("renders rename field, join code, regenerate button, and leave button", () => {
    render(
      <ClassSettings
        classDetail={coachDetail}
        onRefresh={async () => {}}
      />,
    );
    expect(screen.getByLabelText(/class name/i)).toBeInTheDocument();
    expect(screen.getByTestId("join-code")).toHaveTextContent("ABC123");
    expect(screen.getByRole("button", { name: /regenerate code/i })).toBeInTheDocument();
    expect(screen.getByTestId("leave-class-btn")).toBeInTheDocument();
  });

  it("calls PATCH /api/classes/:id when saving rename", async () => {
    const user = userEvent.setup();
    mockFetchOk({ ...baseClassRoom, name: "Junior Parli" });
    // onRefresh will trigger a re-fetch — mock it too
    mockFetchOk(coachDetail);

    render(
      <ClassSettings
        classDetail={coachDetail}
        onRefresh={async () => {}}
      />,
    );

    const input = screen.getByLabelText(/class name/i);
    await user.clear(input);
    await user.type(input, "Junior Parli");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/classes/${CLASS_ID}`),
        expect.objectContaining({ method: "PATCH" }),
      );
    });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.name).toBe("Junior Parli");
  });

  it("calls POST /api/classes/:id/regenerate-code when clicking Regenerate code", async () => {
    const user = userEvent.setup();
    mockFetchOk({ ...baseClassRoom, join_code: "XYZ789" });
    mockFetchOk(coachDetail);

    render(
      <ClassSettings
        classDetail={coachDetail}
        onRefresh={async () => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: /regenerate code/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/classes/${CLASS_ID}/regenerate-code`),
        expect.objectContaining({ method: "POST" }),
      );
    });

    // The displayed code should update
    await waitFor(() => {
      expect(screen.getByTestId("join-code")).toHaveTextContent("XYZ789");
    });
  });

  it("calls DELETE /api/classes/:id/members/:userId when removing a competitor", async () => {
    const user = userEvent.setup();
    mockFetchNoContent();
    mockFetchOk({ ...coachDetail, roster: [coachDetail.roster[0]] });

    render(
      <ClassSettings
        classDetail={coachDetail}
        onRefresh={async () => {}}
      />,
    );

    const removeBtn = screen.getByRole("button", { name: /^remove$/i });
    await user.click(removeBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/classes/${CLASS_ID}/members/${STUDENT_ID}`),
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });
});

describe("ClassSettings — student view", () => {
  beforeEach(() => {
    global.fetch = jest.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    jest.resetAllMocks();
  });

  it("shows Leave class button but not coach controls", () => {
    render(
      <ClassSettings
        classDetail={studentDetail}
        onRefresh={async () => {}}
      />,
    );
    expect(screen.getByTestId("leave-class-btn")).toBeInTheDocument();
    // Coach controls should NOT be present
    expect(screen.queryByLabelText(/class name/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /regenerate code/i })).not.toBeInTheDocument();
  });

  it("calls POST /api/classes/:id/leave when student clicks leave", async () => {
    const user = userEvent.setup();
    // Confirm dialog — jsdom confirm returns true by default
    window.confirm = jest.fn(() => true);
    mockFetchNoContent();

    const onClose = jest.fn();
    render(
      <ClassSettings
        classDetail={studentDetail}
        onRefresh={async () => {}}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByTestId("leave-class-btn"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/classes/${CLASS_ID}/leave`),
        expect.objectContaining({ method: "POST" }),
      );
    });

    expect(onClose).toHaveBeenCalled();
  });
});
