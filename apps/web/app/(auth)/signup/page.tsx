"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getBrowserSupabase } from "@/lib/supabase";
import { updateProfile } from "@/lib/profiles";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignupPage() {
  return <SignupForm />;
}

function SignupForm() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): boolean {
    let ok = true;
    if (!email || !EMAIL_RE.test(email)) {
      setEmailError("Enter a valid email address.");
      ok = false;
    } else {
      setEmailError(null);
    }
    if (!password || password.length < 8) {
      setPasswordError("Password must be at least 8 characters.");
      ok = false;
    } else {
      setPasswordError(null);
    }
    return ok;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setFormError(null);
    setInfo(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      const supabase = getBrowserSupabase();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: displayName.trim()
          ? { data: { display_name: displayName.trim() } }
          : undefined,
      });
      if (error) {
        setFormError(error.message);
        return;
      }

      // If we have a session (email confirmation not required), persist the
      // display name via the profiles API. Best-effort: ignore failures.
      if (data?.session && displayName.trim()) {
        try {
          await updateProfile(displayName.trim());
        } catch {
          // Non-fatal — the display name can be set later in settings.
        }
      }

      if (data?.session) {
        router.push("/workspace");
      } else {
        setInfo("Check your email to confirm your account.");
      }
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-md">
        <h1 className="mb-6 text-2xl font-semibold text-teal-dark">Create your Debby account</h1>
        <form noValidate onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="display-name" className="mb-1 block text-sm font-medium text-slate-700">
              Display name <span className="text-slate-400">(optional)</span>
            </label>
            <input
              id="display-name"
              name="display_name"
              type="text"
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="How you'll appear to teammates"
              className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal"
            />
          </div>

          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? "email-error" : undefined}
              className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal"
            />
            {emailError ? (
              <p id="email-error" role="alert" className="mt-1 text-sm text-red-600">
                {emailError}
              </p>
            ) : null}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="password" className="text-sm font-medium text-slate-700">
                Password
              </label>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setShowPassword(!showPassword);
                }}
                className="text-xs font-medium text-teal hover:text-teal-dark"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={passwordError ? true : undefined}
              aria-describedby={passwordError ? "password-error" : undefined}
              className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal"
            />
            {passwordError ? (
              <p id="password-error" role="alert" className="mt-1 text-sm text-red-600">
                {passwordError}
              </p>
            ) : null}
          </div>

          {formError ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </p>
          ) : null}
          {info ? (
            <p role="status" className="rounded-md bg-teal/10 px-3 py-2 text-sm text-teal-dark">
              {info}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-teal px-4 py-2 font-medium text-white hover:bg-teal-dark disabled:opacity-60"
          >
            {submitting ? "Creating account..." : "Sign up"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-teal hover:text-teal-dark">
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
