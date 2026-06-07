import { render, screen, fireEvent } from "@testing-library/react";
import { ClassCalendar } from "@/components/classroom/ClassCalendar";
import type { AssignmentRecipientDetail } from "@/lib/classroom";

jest.mock("@/lib/supabase", () => ({
  getBrowserSupabase: () => ({
    auth: { getSession: async () => ({ data: { session: null } }) },
  }),
}));

function createMockAssignment(
  overrides?: Partial<AssignmentRecipientDetail>,
): AssignmentRecipientDetail {
  const defaults: AssignmentRecipientDetail = {
    recipient: {
      id: "recipient-1",
      assignment_id: "assignment-1",
      user_id: "user-1",
      status: "assigned",
    },
    assignment: {
      id: "assignment-1",
      class_id: "class-1",
      assigned_by: "coach-1",
      title: "Test Assignment",
      type: "drill",
      payload: {
        drill_type: "rebuttal",
        timer_seconds: 60,
      },
      due_at: new Date().toISOString(),
    },
    class_room: {
      id: "class-1",
      name: "Test Class",
      join_code: "ABC123",
      created_by: "coach-1",
    },
  };
  return { ...defaults, ...overrides };
}

describe("ClassCalendar", () => {
  it("renders with current month header", () => {
    const now = new Date();
    const monthName = new Intl.DateTimeFormat(undefined, {
      month: "long",
      year: "numeric",
    }).format(now);

    render(<ClassCalendar assignments={[]} />);
    expect(screen.getByText(monthName)).toBeInTheDocument();
  });

  it("renders weekday headers", () => {
    render(<ClassCalendar assignments={[]} />);
    const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    weekDays.forEach((day) => {
      expect(screen.getByText(day)).toBeInTheDocument();
    });
  });

  it("shows assignments due on known dates as links", () => {
    const today = new Date();
    const dueDate = new Date(today.getFullYear(), today.getMonth(), 15);

    const assignment1 = createMockAssignment({
      recipient: {
        id: "recipient-1",
        assignment_id: "assignment-1",
        user_id: "user-1",
        status: "assigned",
      },
      assignment: {
        id: "assignment-1",
        class_id: "class-1",
        assigned_by: "coach-1",
        title: "Rebuttal Drill",
        type: "drill",
        payload: {
          drill_type: "rebuttal",
          timer_seconds: 60,
        },
        due_at: dueDate.toISOString(),
      },
      class_room: {
        id: "class-1",
        name: "Test Class",
        join_code: "ABC123",
        created_by: "coach-1",
      },
    });

    const assignment2 = createMockAssignment({
      recipient: {
        id: "recipient-2",
        assignment_id: "assignment-2",
        user_id: "user-1",
        status: "assigned",
      },
      assignment: {
        id: "assignment-2",
        class_id: "class-1",
        assigned_by: "coach-1",
        title: "Practice Round",
        type: "practice_round",
        payload: {
          format: "parli",
          topic: "Ban the AfD",
          side: "aff",
          speech_duration_seconds: 120,
        },
        due_at: dueDate.toISOString(),
      },
      class_room: {
        id: "class-1",
        name: "Test Class",
        join_code: "ABC123",
        created_by: "coach-1",
      },
    });

    render(<ClassCalendar assignments={[assignment1, assignment2]} />);

    const drillLink = screen.getByRole("link", { name: /Rebuttal Drill/i });
    expect(drillLink).toBeInTheDocument();
    expect(drillLink).toHaveAttribute(
      "href",
      "/drills?class=class-1&assignment=recipient-1",
    );

    const practiceLink = screen.getByRole("link", { name: /Practice Round/i });
    expect(practiceLink).toBeInTheDocument();
    expect(practiceLink).toHaveAttribute(
      "href",
      "/practice?class=class-1&assignment=recipient-2",
    );
  });

  it("does not render assignments with null due_at", () => {
    const assignment = createMockAssignment({
      assignment: {
        id: "assignment-1",
        class_id: "class-1",
        assigned_by: "coach-1",
        title: "No Due Date Assignment",
        type: "drill",
        payload: {
          drill_type: "rebuttal",
          timer_seconds: 60,
        },
        due_at: null,
      },
    });

    render(<ClassCalendar assignments={[assignment]} />);
    expect(
      screen.queryByRole("link", { name: /No Due Date Assignment/i }),
    ).not.toBeInTheDocument();
  });

  it("highlights today with teal accent", () => {
    const today = new Date();
    const assignment = createMockAssignment({
      assignment: {
        id: "assignment-1",
        class_id: "class-1",
        assigned_by: "coach-1",
        title: "Today's Assignment",
        type: "drill",
        payload: {
          drill_type: "rebuttal",
          timer_seconds: 60,
        },
        due_at: today.toISOString(),
      },
    });

    render(<ClassCalendar assignments={[assignment]} />);

    // Find the day cell containing today's date with teal styling
    const dayNumber = today.getDate().toString();
    const dayElements = screen.getAllByText(dayNumber);

    // Look for the one with teal border (inside the calendar grid, not elsewhere)
    let foundTealDay = false;
    dayElements.forEach((el) => {
      const dayCell = el.closest("div[class*='border']");
      if (dayCell && dayCell.className.includes("border-teal")) {
        foundTealDay = true;
      }
    });

    expect(foundTealDay).toBe(true);
  });

  it("navigates to previous and next month", () => {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextMonthName = new Intl.DateTimeFormat(undefined, {
      month: "long",
      year: "numeric",
    }).format(nextMonth);

    render(<ClassCalendar assignments={[]} />);

    const nextButton = screen.getByRole("button", { name: /Next/i });
    fireEvent.click(nextButton);

    expect(screen.getByText(nextMonthName)).toBeInTheDocument();

    const prevButton = screen.getByRole("button", { name: /Previous/i });
    fireEvent.click(prevButton);

    const currentMonth = new Intl.DateTimeFormat(undefined, {
      month: "long",
      year: "numeric",
    }).format(now);
    expect(screen.getByText(currentMonth)).toBeInTheDocument();
  });

  it("uses different accent colors for assignments from different classes", () => {
    const today = new Date();
    const dueDate = new Date(today.getFullYear(), today.getMonth(), 20);

    const assignment1 = createMockAssignment({
      recipient: {
        id: "recipient-color-1",
        assignment_id: "assignment-color-1",
        user_id: "user-1",
        status: "assigned",
      },
      assignment: {
        id: "assignment-color-1",
        class_id: "class-teal",
        assigned_by: "coach-1",
        title: "Class One Assignment",
        type: "drill",
        payload: {
          drill_type: "rebuttal",
          timer_seconds: 60,
        },
        due_at: dueDate.toISOString(),
      },
      class_room: {
        id: "class-teal",
        name: "Varsity PF",
        join_code: "ABC123",
        created_by: "coach-1",
      },
    });

    const assignment2 = createMockAssignment({
      recipient: {
        id: "recipient-color-2",
        assignment_id: "assignment-color-2",
        user_id: "user-2",
        status: "assigned",
      },
      assignment: {
        id: "assignment-color-2",
        class_id: "class-rose",
        assigned_by: "coach-2",
        title: "Class Two Assignment",
        type: "drill",
        payload: {
          drill_type: "impact",
          timer_seconds: 60,
        },
        due_at: dueDate.toISOString(),
      },
      class_room: {
        id: "class-rose",
        name: "JV PF",
        join_code: "DEF456",
        created_by: "coach-2",
      },
    });

    render(<ClassCalendar assignments={[assignment1, assignment2]} />);

    const classOneLink = screen.getByRole("link", { name: /Class One Assignment/i });
    const classTwoLink = screen.getByRole("link", { name: /Class Two Assignment/i });

    expect(classOneLink.className).not.toEqual(classTwoLink.className);
    expect(classOneLink).toHaveAttribute(
      "title",
      expect.stringContaining("Varsity PF"),
    );
    expect(classTwoLink).toHaveAttribute("title", expect.stringContaining("JV PF"));
  });
});
