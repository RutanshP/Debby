import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import LoginPage from "@/app/(auth)/login/page";
import SignupPage from "@/app/(auth)/signup/page";

const pushMock = jest.fn();
const getParamMock = jest.fn<string | null, [string]>(() => null);

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => ({ get: (k: string) => getParamMock(k) }),
}));

const signInWithPassword = jest.fn();
const signUp = jest.fn();

jest.mock("@/lib/supabase", () => ({
  getBrowserSupabase: () => ({
    auth: {
      signInWithPassword: (...args: unknown[]) => signInWithPassword(...args),
      signUp: (...args: unknown[]) => signUp(...args),
    },
  }),
}));

beforeEach(() => {
  pushMock.mockReset();
  getParamMock.mockReset().mockReturnValue(null);
  signInWithPassword.mockReset();
  signUp.mockReset();
});

describe("LoginPage", () => {
  it("renders email + password inputs and submit button", () => {
    render(<LoginPage />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("shows inline error when email is empty", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText(/password/i), "longenoughpw");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("shows inline error when password is too short", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText(/email/i), "a@b.co");
    await user.type(screen.getByLabelText(/password/i), "short");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("calls signInWithPassword with valid input", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText(/email/i), "a@b.co");
    await user.type(screen.getByLabelText(/password/i), "longenoughpw");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() =>
      expect(signInWithPassword).toHaveBeenCalledWith({
        email: "a@b.co",
        password: "longenoughpw",
      }),
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/workspace"));
  });

  it("renders the Supabase error message", async () => {
    signInWithPassword.mockResolvedValue({ error: { message: "Invalid credentials" } });
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText(/email/i), "a@b.co");
    await user.type(screen.getByLabelText(/password/i), "longenoughpw");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe("SignupPage", () => {
  it("renders email + password inputs and submit button", () => {
    render(<SignupPage />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign up/i })).toBeInTheDocument();
  });

  it("shows inline error when email is empty", async () => {
    const user = userEvent.setup();
    render(<SignupPage />);
    await user.type(screen.getByLabelText(/password/i), "longenoughpw");
    await user.click(screen.getByRole("button", { name: /sign up/i }));
    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(signUp).not.toHaveBeenCalled();
  });

  it("shows inline error when password is too short", async () => {
    const user = userEvent.setup();
    render(<SignupPage />);
    await user.type(screen.getByLabelText(/email/i), "a@b.co");
    await user.type(screen.getByLabelText(/password/i), "short");
    await user.click(screen.getByRole("button", { name: /sign up/i }));
    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(signUp).not.toHaveBeenCalled();
  });

  it("calls signUp with valid input", async () => {
    signUp.mockResolvedValue({ data: { session: { access_token: "x" } }, error: null });
    const user = userEvent.setup();
    render(<SignupPage />);
    await user.type(screen.getByLabelText(/email/i), "a@b.co");
    await user.type(screen.getByLabelText(/password/i), "longenoughpw");
    await user.click(screen.getByRole("button", { name: /sign up/i }));
    await waitFor(() =>
      expect(signUp).toHaveBeenCalledWith({
        email: "a@b.co",
        password: "longenoughpw",
      }),
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/workspace"));
  });

  it("renders the Supabase error message", async () => {
    signUp.mockResolvedValue({ data: null, error: { message: "Email already registered" } });
    const user = userEvent.setup();
    render(<SignupPage />);
    await user.type(screen.getByLabelText(/email/i), "a@b.co");
    await user.type(screen.getByLabelText(/password/i), "longenoughpw");
    await user.click(screen.getByRole("button", { name: /sign up/i }));
    expect(await screen.findByText(/already registered/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
