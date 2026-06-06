import { render, screen } from "@testing-library/react";
import { AppShell } from "@/components/AppShell";

const pathnameState = { value: "/drills" };
const searchParamsState = new URLSearchParams("class=class-1");
const useClassesMock = jest.fn(() => ({ data: [] }));
const useClassDetailMock = jest.fn(() => ({ data: null, isLoading: false }));

jest.mock("next/navigation", () => ({
  usePathname: () => pathnameState.value,
  useSearchParams: () => ({ get: (key: string) => searchParamsState.get(key) }),
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
}));

describe("AppShell", () => {
  beforeEach(() => {
    pathnameState.value = "/drills";
    searchParamsState.forEach((_value, key) => searchParamsState.delete(key));
    searchParamsState.set("class", "class-1");
    useClassesMock.mockReset();
    useClassDetailMock.mockReset();
    useClassesMock.mockReturnValue({ data: [] });
    useClassDetailMock.mockReturnValue({
      data: {
        role: "competitor",
        assignments: [
          { recipient: { status: "assigned" } },
          { recipient: { status: "in_progress" } },
          { recipient: { status: "completed" } },
        ],
      },
      isLoading: false,
    });
  });

  it("shows the number of due assignments in the nav badge", () => {
    render(
      <AppShell>
        <div>Child</div>
      </AppShell>,
    );

    expect(screen.getAllByLabelText("2 assignments due")).toHaveLength(2);
  });
});
