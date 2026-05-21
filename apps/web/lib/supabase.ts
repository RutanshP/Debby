import { createBrowserClient, createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function getBrowserSupabase() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

type CookieStore = {
  get(name: string): { value: string } | undefined;
  set?(name: string, value: string, options: CookieOptions): void;
};

export function getServerSupabase(cookieStore: CookieStore) {
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        cookieStore.set?.(name, value, options);
      },
      remove(name: string, options: CookieOptions) {
        cookieStore.set?.(name, "", { ...options, maxAge: 0 });
      },
    },
  });
}
