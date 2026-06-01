/**
 * useDebbySpeech tests
 *
 * Covers:
 *  - prefetch warms buffers and de-dupes in-flight fetches
 *  - play(string) fetches + plays a single part
 *  - play(string[]) fetches both parts and produces a concatenated buffer
 *    whose length equals the sum of the individual part lengths
 *  - cache hit ⇒ no second /api/ai/tts fetch
 *  - prefetch swallows fetch errors without changing state
 *  - stop() resets to idle
 *  - toggle-stop on the same activeKey
 */

import { renderHook, act } from "@testing-library/react";
import { installAudioMock, FakeAudioBuffer } from "./test-utils/audio-mock";
import { useDebbySpeech, speechKey } from "@/hooks/useDebbySpeech";

// ---------------------------------------------------------------------------
// Supabase mock (apiFetchBlob calls authHeader which calls getSession)
// ---------------------------------------------------------------------------
jest.mock("@/lib/supabase", () => ({
  getBrowserSupabase: () => ({
    auth: {
      getSession: async () => ({ data: { session: null } }),
    },
  }),
}));

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const handles = installAudioMock();

// We will replace global.fetch before each test
let mockFetch: jest.Mock;

/**
 * Build a fake fetch that returns a Blob containing `content` for each call.
 * Providing an array rotates through responses in order.
 */
function makeFetch(...contents: string[]): jest.Mock {
  let i = 0;
  return jest.fn(async (_url: string, _init?: RequestInit) => {
    const content = contents[i % contents.length];
    i++;
    const blob = new Blob([content], { type: "audio/mpeg" });
    return new Response(blob, { status: 200 });
  });
}

beforeEach(() => {
  handles.reset();
  jest.clearAllMocks();
  // Default: single content blob
  mockFetch = makeFetch("AUDIO");
  global.fetch = mockFetch;
});

// ---------------------------------------------------------------------------
// speechKey helper
// ---------------------------------------------------------------------------

describe("speechKey", () => {
  it("returns the string itself for a scalar", () => {
    expect(speechKey("hello")).toBe("hello");
  });

  it("joins an array with NUL", () => {
    expect(speechKey(["a", "b"])).toBe("a\x00b");
  });

  it("is stable across two calls", () => {
    expect(speechKey(["x", "y"])).toBe(speechKey(["x", "y"]));
  });
});

// ---------------------------------------------------------------------------
// prefetch
// ---------------------------------------------------------------------------

describe("prefetch", () => {
  it("warms the buffer cache so a subsequent play hits no extra fetch", async () => {
    const { result } = renderHook(() => useDebbySpeech());

    await act(async () => {
      await result.current.prefetch("hello world");
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain("/api/ai/tts");

    // State should still be idle
    expect(result.current.state).toBe("idle");

    // Now play – should NOT hit fetch again
    await act(async () => {
      await result.current.play("hello world");
    });

    expect(mockFetch).toHaveBeenCalledTimes(1); // still 1
    expect(result.current.state).toBe("playing");
  });

  it("de-dupes concurrent prefetch calls for the same text", async () => {
    const { result } = renderHook(() => useDebbySpeech());

    await act(async () => {
      await Promise.all([
        result.current.prefetch("same"),
        result.current.prefetch("same"),
        result.current.prefetch("same"),
      ]);
    });

    // Only one network call despite three concurrent prefetches
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("swallows fetch errors without changing state", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useDebbySpeech());

    // Should not throw
    await act(async () => {
      await result.current.prefetch("will fail");
    });

    expect(result.current.state).toBe("idle");
    expect(result.current.error).toBeNull();
  });

  it("prefetches an array of parts", async () => {
    mockFetch = makeFetch("PART-A", "PART-B");
    global.fetch = mockFetch;

    const { result } = renderHook(() => useDebbySpeech());

    await act(async () => {
      await result.current.prefetch(["part a", "part b"]);
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// play – single string
// ---------------------------------------------------------------------------

describe("play – single string", () => {
  it("fetches once and transitions to playing", async () => {
    const { result } = renderHook(() => useDebbySpeech());

    await act(async () => {
      await result.current.play("debate speech");
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/ai/tts");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      text: "debate speech",
    });

    expect(result.current.state).toBe("playing");
    expect(result.current.activeKey).toBe("debate speech");
    expect(result.current.error).toBeNull();
  });

  it("passes an optional voice parameter", async () => {
    const { result } = renderHook(() => useDebbySpeech());

    await act(async () => {
      await result.current.play("text", "en-US-Wavenet-A");
    });

    const [, init] = mockFetch.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      text: "text",
      voice: "en-US-Wavenet-A",
    });
  });

  it("sets state=error when fetch fails", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("500 server error"));
    const { result } = renderHook(() => useDebbySpeech());

    await act(async () => {
      await result.current.play("broken");
    });

    expect(result.current.state).toBe("error");
    expect(result.current.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// play – array (concat)
// ---------------------------------------------------------------------------

describe("play – array (splice/concat)", () => {
  it("fetches both parts and plays a concatenated buffer whose length = sum of parts", async () => {
    // "PART-AAAA" = 9 chars → arrayBuffer length 36 bytes → decoded length 9
    // "PART-BB"   = 7 chars → arrayBuffer length 28 bytes → decoded length 7
    // concatenated length should be 16
    mockFetch = makeFetch("PART-AAAA", "PART-BB");
    global.fetch = mockFetch;

    const { result } = renderHook(() => useDebbySpeech());

    await act(async () => {
      await result.current.play(["speech one", "speech two"]);
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe("playing");
    expect(result.current.activeKey).toBe("speech one\x00speech two");

    // Inspect the buffer that was handed to createBufferSource
    const ctx = handles.lastCtx();
    expect(ctx).not.toBeNull();
    const nodes = ctx!.createdSourceNodes;
    expect(nodes.length).toBeGreaterThan(0);
    const lastNode = nodes[nodes.length - 1];
    expect(lastNode.buffer).toBeInstanceOf(FakeAudioBuffer);

    const combinedLength = (lastNode.buffer as FakeAudioBuffer).length;
    // "PART-AAAA".length = 9, "PART-BB".length = 7 → 16
    expect(combinedLength).toBe(9 + 7);
  });

  it("cache hit: second play of same parts makes no extra fetch", async () => {
    mockFetch = makeFetch("AAA", "BBB");
    global.fetch = mockFetch;

    const { result } = renderHook(() => useDebbySpeech());

    await act(async () => {
      await result.current.play(["part-x", "part-y"]);
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // stop to allow re-play
    act(() => result.current.stop());

    await act(async () => {
      await result.current.play(["part-x", "part-y"]);
    });
    // Should still be 2, cache served both parts
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// stop
// ---------------------------------------------------------------------------

describe("stop", () => {
  it("resets state to idle", async () => {
    const { result } = renderHook(() => useDebbySpeech());

    await act(async () => {
      await result.current.play("text");
    });
    expect(result.current.state).toBe("playing");

    act(() => {
      result.current.stop();
    });

    expect(result.current.state).toBe("idle");
    expect(result.current.activeKey).toBeNull();
  });

  it("is safe to call when already idle", () => {
    const { result } = renderHook(() => useDebbySpeech());

    expect(() => {
      act(() => result.current.stop());
    }).not.toThrow();

    expect(result.current.state).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// toggle-stop
// ---------------------------------------------------------------------------

describe("toggle-stop", () => {
  it("calling play with the same activeKey while playing stops playback", async () => {
    const { result } = renderHook(() => useDebbySpeech());

    await act(async () => {
      await result.current.play("the speech");
    });
    expect(result.current.state).toBe("playing");
    expect(result.current.activeKey).toBe("the speech");

    // Play same key again – should toggle-stop
    await act(async () => {
      await result.current.play("the speech");
    });

    expect(result.current.state).toBe("idle");
    expect(result.current.activeKey).toBeNull();
    // Only one fetch should have happened (toggle doesn't re-fetch)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
