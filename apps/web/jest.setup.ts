import "@testing-library/jest-dom";

// jsdom omits the WHATWG fetch globals; whatwg-fetch installs `fetch`,
// `Response`, `Request`, and `Headers` onto the global scope, which our
// test files rely on (e.g. `new Response(JSON.stringify(...))`).
import "whatwg-fetch";

// recharts' ResponsiveContainer reads ResizeObserver; jsdom doesn't ship
// one. Provide a noop implementation good enough for tests.
class _RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof (globalThis as any).ResizeObserver === "undefined") {
  (globalThis as any).ResizeObserver = _RO;
}
