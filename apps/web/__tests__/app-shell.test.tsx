import { render, screen } from "@testing-library/react";
import { AppShell } from "@/components/AppShell";

const pathnameState = { value: "/drills" };
const searchParamsState = new URLSearchParams("class=class-1");
const useClassesMock = jest.fn(() => ({ data: [] }));
const useClassDetailMock = jest.fn(() => ({ data: null, isLoading: false }));
const invalidateQueriesMock = jest.fn();
const setQueryDataMock = jest.fn();

jest.mock("next/navigation", () => ({
  usePathname: () => pathnameState.value,
  useSearchParams: () => ({
    get: (key: string) => searchParamsState.get(key),
    toString: () => searchParamsState.toString(),
  }),
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

jest.mock("@/lib/supabase", () => ({
  getBrowserSupabase: () => ({
    auth: { signOut: async () => undefined },
  }),
}));

jest.mock("@/lib/queries/classroom", () => ({
  useClasses: (...args: unknown[]) => useClassesMock(...args),
  useClassDetail: (...args: unknown[]) => useClassDetailMock(...args),
  useQueryClient: () => ({
    invalidateQueries: invalidateQueriesMock,
    setQueryData: setQueryDataMock,
  }),
  classroomKeys: {
    list: () => ["classes", "list"],
  },
}));

describe("AppShell", () => {
  beforeEach(() => {
    pathnameState.value = "/drills";
    searchParamsState.forEach((_value, key) => searchParamsState.delete(key));
    searchParamsState.set("class", "class-1");
    useClassesMock.mockReset();
    useClassDetailMock.mockReset();
    useClassesMock.mockReturnValue({
      data: [
        {
          id: "class-1",
          name: "Varsity PF",
          role: "competitor",
          join_code: "ABC123",
          open_assignments: 2,
        },
      ],
    });
    useClassDetailMock.mockReturnValue({
      data: {
        class_room: {
          id: "class-1",
          name: "Varsity PF",
          join_code: "ABC123",
          created_by: "coach-1",
        },
        role: "competitor",
        assignments: [
          { recipient: { status: "assigned" } },
          { recipient: { status: "in_progress" } },
          { recipient: { status: "completed" } },
        ],
      },
      isLoading: false,
    });
    invalidateQueriesMock.mockReset();
    setQueryDataMock.mockReset();
  });

  it("shows the number of due assignments in the nav badge", () => {
    render(
      <AppShell>
        <div>Child</div>
      </AppShell>,
    );

    expect(screen.getAllByLabelText("2 assignments due")).toHaveLength(2);
  });

  it("keeps global progress and adds analytics for coaches", () => {
    useClassesMock.mockReturnValue({
      data: [
        {
          id: "class-1",
          name: "Varsity PF",
          role: "coach",
          join_code: "ABC123",
          open_assignments: 0,
        },
      ],
    });
    useClassDetailMock.mockReturnValue({
      data: {
        class_room: {
          id: "class-1",
          name: "Varsity PF",
          join_code: "ABC123",
          created_by: "coach-1",
        },
        role: "coach",
        assignments: [],
      },
      isLoading: false,
    });
    pathnameState.value = "/classes";
    searchParamsState.forEach((_value, key) => searchParamsState.delete(key));
    searchParamsState.set("class", "class-1");
    searchParamsState.set("tab", "analytics");

    render(
      <AppShell>
        <div>Child</div>
      </AppShell>,
    );

    expect(screen.getAllByRole("link", { name: "Progress" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Analytics" }).length).toBeGreaterThan(0);
  });

  it("shows create and join in the class section when there are no classes", () => {
    useClassesMock.mockReturnValue({ data: [] });
    useClassDetailMock.mockReturnValue({ data: null, isLoading: false });
    searchParamsState.forEach((_value, key) => searchParamsState.delete(key));
    searchParamsState.set("tab", "create");

    render(
      <AppShell>
        <div>Child</div>
      </AppShell>,
    );

    expect(screen.getAllByRole("button", { name: "Create" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Join" }).length).toBeGreaterThan(0);
  });
});
