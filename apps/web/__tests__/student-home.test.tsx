import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClassBanner } from "@/components/classroom/ClassBanner";
import { UpcomingCard } from "@/components/classroom/UpcomingCard";
import type { AssignmentRecipientDetail } from "@/lib/classroom";

jest.mock("@/lib/supabase", () => ({
  getBrowserSupabase: () => ({
    auth: { getSession: async () => ({ data: { session: null } }) },
  }),
}));

// next/link renders a plain <a> in jest (jsdom)
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function makeAssignment(
  overrides: Partial<AssignmentRecipientDetail> = {},
): AssignmentRecipientDetail {
  return {
    recipient: {
      id: "rec-1",
      assignment_id: "asgn-1",
      user_id: "user-1",
      status: "assigned",
    },
    assignment: {
      id: "asgn-1",
      class_id: "class-1",
      assigned_by: "coach-1",
      title: "Rebuttal Drill",
      type: "drill",
      payload: { drill_type: "rebuttal", timer_seconds: 60 },
      due_at: new Date(Date.now() + 86400000).toISOString(), // tomorrow
    },
    class_room: {
      id: "class-1",
      name: "Debate 101",
      join_code: "ABC123",
      created_by: "coach-1",
    },
    ...overrides,
  };
}

describe("ClassBanner", () => {
  it("renders the class name", () => {
    render(<ClassBanner className="Advanced Debate" role="competitor" />);
    expect(screen.getByText("Advanced Debate")).toBeInTheDocument();
  });

  it("renders the role label", () => {
    render(<ClassBanner className="Advanced Debate" role="coach" />);
    expect(screen.getByText("Coach")).toBeInTheDocument();
  });

  it("renders the join code when provided", () => {
    render(<ClassBanner className="My Class" role="coach" joinCode="XYZ99" />);
    expect(screen.getByText("XYZ99")).toBeInTheDocument();
  });

  it("does not render join code section when not provided", () => {
    render(<ClassBanner className="My Class" role="competitor" />);
    expect(screen.queryByText("Join code")).not.toBeInTheDocument();
  });
});

describe("UpcomingCard", () => {
  it("shows empty state when no incomplete assignments", () => {
    const completed = makeAssignment({
      recipient: {
        id: "rec-1",
        assignment_id: "asgn-1",
        user_id: "user-1",
        status: "completed",
      },
    });
    render(<UpcomingCard assignments={[completed]} />);
    expect(screen.getByText(/Woohoo, no work due soon!/i)).toBeInTheDocument();
  });

  it("shows empty state when assignments array is empty", () => {
    render(<UpcomingCard assignments={[]} />);
    expect(screen.getByText(/Woohoo, no work due soon!/i)).toBeInTheDocument();
  });

  it("renders the soonest-due incomplete assignment", () => {
    const soonDue = makeAssignment({
      recipient: { id: "rec-1", assignment_id: "asgn-1", user_id: "user-1", status: "assigned" },
      assignment: {
        id: "asgn-1",
        class_id: "class-1",
        assigned_by: "coach-1",
        title: "Soon Due Drill",
        type: "drill",
        payload: { drill_type: "rebuttal", timer_seconds: 60 },
        due_at: new Date(Date.now() + 86400000).toISOString(), // 1 day
      },
    });
    const laterDue = makeAssignment({
      recipient: { id: "rec-2", assignment_id: "asgn-2", user_id: "user-1", status: "assigned" },
      assignment: {
        id: "asgn-2",
        class_id: "class-1",
        assigned_by: "coach-1",
        title: "Later Due Practice",
        type: "practice_round",
        payload: { format: "parli", topic: "Test", side: "aff", speech_duration_seconds: 120 },
        due_at: new Date(Date.now() + 7 * 86400000).toISOString(), // 7 days
      },
    });

    render(<UpcomingCard assignments={[laterDue, soonDue]} />);
    expect(screen.getByText("Soon Due Drill")).toBeInTheDocument();
    expect(screen.getByText("Later Due Practice")).toBeInTheDocument();
  });

  it("provides a link to the drill for a drill assignment", () => {
    const drillAssignment = makeAssignment();
    render(<UpcomingCard assignments={[drillAssignment]} />);
    const link = screen.getByRole("link", { name: /Rebuttal Drill/i });
    expect(link).toHaveAttribute("href", "/drills?class=class-1&assignment=rec-1");
  });

  it("provides a link to practice for a practice_round assignment", () => {
    const practiceAssignment = makeAssignment({
      recipient: { id: "rec-2", assignment_id: "asgn-2", user_id: "user-1", status: "assigned" },
      assignment: {
        id: "asgn-2",
        class_id: "class-1",
        assigned_by: "coach-1",
        title: "Practice Round",
        type: "practice_round",
        payload: { format: "parli", topic: "Climate", side: "aff", speech_duration_seconds: 120 },
        due_at: new Date(Date.now() + 86400000).toISOString(),
      },
    });
    render(<UpcomingCard assignments={[practiceAssignment]} />);
    const link = screen.getByRole("link", { name: /Practice Round/i });
    expect(link).toHaveAttribute("href", "/practice?class=class-1&assignment=rec-2");
  });

  it("does not show completed assignments in the list", () => {
    const incomplete = makeAssignment({
      recipient: { id: "rec-1", assignment_id: "asgn-1", user_id: "user-1", status: "assigned" },
    });
    const done = makeAssignment({
      recipient: { id: "rec-2", assignment_id: "asgn-2", user_id: "user-1", status: "completed" },
      assignment: {
        id: "asgn-2",
        class_id: "class-1",
        assigned_by: "coach-1",
        title: "Already Done",
        type: "drill",
        payload: { drill_type: "rebuttal", timer_seconds: 60 },
        due_at: new Date(Date.now() + 86400000).toISOString(),
      },
    });
    render(<UpcomingCard assignments={[incomplete, done]} />);
    expect(screen.queryByText("Already Done")).not.toBeInTheDocument();
    expect(screen.getByText("Rebuttal Drill")).toBeInTheDocument();
  });

  it("calls onViewAll when View all is clicked", async () => {
    const user = userEvent.setup();
    const onViewAll = jest.fn();
    const assignment = makeAssignment();
    render(<UpcomingCard assignments={[assignment]} onViewAll={onViewAll} />);
    await user.click(screen.getByRole("button", { name: /View all/i }));
    expect(onViewAll).toHaveBeenCalledTimes(1);
  });

  it("does not render View all button when onViewAll is not provided", () => {
    render(<UpcomingCard assignments={[]} />);
    expect(screen.queryByRole("button", { name: /View all/i })).not.toBeInTheDocument();
  });

  it("sorts assignments by due date closest first", () => {
    const soonDue = makeAssignment({
      recipient: { id: "rec-1", assignment_id: "asgn-1", user_id: "user-1", status: "assigned" },
      assignment: {
        id: "asgn-1",
        class_id: "class-1",
        assigned_by: "coach-1",
        title: "Due Tomorrow",
        type: "drill",
        payload: { drill_type: "rebuttal", timer_seconds: 60 },
        due_at: new Date(Date.now() + 86400000).toISOString(),
      },
    });
    const laterDue = makeAssignment({
      recipient: { id: "rec-2", assignment_id: "asgn-2", user_id: "user-1", status: "assigned" },
      assignment: {
        id: "asgn-2",
        class_id: "class-1",
        assigned_by: "coach-1",
        title: "Due Next Week",
        type: "drill",
        payload: { drill_type: "speed", timer_seconds: 60 },
        due_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      },
    });

    render(<UpcomingCard assignments={[laterDue, soonDue]} />);
    const items = screen.getAllByRole("listitem");
    // First item should be the soonest due
    expect(items[0]).toHaveTextContent("Due Tomorrow");
    expect(items[1]).toHaveTextContent("Due Next Week");
  });
});
