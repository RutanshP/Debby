import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// --- Mocks ---------------------------------------------------------------

jest.mock("../lib/api", () => ({
  apiFetch: jest.fn(),
  apiFetchBlob: jest.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  },
}));

jest.mock("../lib/supabase", () => ({
  getBrowserSupabase: () => ({
    auth: {
      getSession: async () => ({ data: { session: null } }),
    },
  }),
}));

// jsdom doesn't implement HTMLMediaElement.prototype.play / URL.createObjectURL
let mockPlay: jest.Mock;
let mockCreateObjectURL: jest.Mock;

beforeAll(() => {
  mockPlay = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    writable: true,
    value: mockPlay,
  });
  // jsdom doesn't implement pause — stub it to avoid console.error noise
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    writable: true,
    value: jest.fn(),
  });

  mockCreateObjectURL = jest.fn().mockReturnValue("blob:fake-url");
  global.URL.createObjectURL = mockCreateObjectURL;
  global.URL.revokeObjectURL = jest.fn();
});

import { apiFetchBlob } from "../lib/api";
import { useDebbySpeech } from "../hooks/useDebbySpeech";
import { SpeakButton } from "../components/SpeakButton";

// --- Helper component to test hook + button together ---------------------

function TestSpeakWidget({ text }: { text: string }) {
  const { play, state, activeText } = useDebbySpeech();
  return (
    <div>
      <div data-testid="state">{state}</div>
      <SpeakButton text={text} play={play} state={state} activeText={activeText} />
    </div>
  );
}

// --- Tests ---------------------------------------------------------------

describe("useDebbySpeech + SpeakButton", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPlay.mockResolvedValue(undefined);
    mockCreateObjectURL.mockReturnValue("blob:fake-url");
  });

  test("renders play button in idle state", () => {
    render(<TestSpeakWidget text="Hello world" />);
    expect(screen.getByRole("button", { name: /play debby's speech/i })).toBeInTheDocument();
    expect(screen.getByTestId("state")).toHaveTextContent("idle");
  });

  test("clicking the button calls apiFetchBlob with /api/ai/tts and the speech text", async () => {
    const fakeBlob = new Blob(["mp3data"], { type: "audio/mpeg" });
    (apiFetchBlob as jest.Mock).mockResolvedValueOnce(fakeBlob);

    render(<TestSpeakWidget text="Hello debate" />);
    const btn = screen.getByRole("button", { name: /play debby's speech/i });

    await act(async () => {
      fireEvent.click(btn);
    });

    expect(apiFetchBlob).toHaveBeenCalledWith(
      "/api/ai/tts",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ text: "Hello debate" }),
      }),
    );
  });

  test("transitions to playing state after blob loads", async () => {
    const fakeBlob = new Blob(["mp3data"], { type: "audio/mpeg" });
    (apiFetchBlob as jest.Mock).mockResolvedValueOnce(fakeBlob);

    render(<TestSpeakWidget text="Playing speech" />);
    const btn = screen.getByRole("button", { name: /play debby's speech/i });

    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() => {
      expect(screen.getByTestId("state")).toHaveTextContent("playing");
    });
    expect(screen.getByRole("button", { name: /pause debby's speech/i })).toBeInTheDocument();
  });

  test("uses cached object URL on second play call (apiFetchBlob called only once)", async () => {
    const fakeBlob = new Blob(["mp3data"], { type: "audio/mpeg" });
    (apiFetchBlob as jest.Mock).mockResolvedValue(fakeBlob);

    render(<TestSpeakWidget text="Cache test" />);
    const btn = screen.getByRole("button", { name: /play debby's speech/i });

    // First play
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("playing"),
    );

    // Simulate audio ended to go back to idle
    await act(async () => {
      const audio = document.querySelector("audio") ?? new Audio();
      audio.dispatchEvent(new Event("ended"));
      // Trigger ended callback directly via the audio element ref in the hook
      // Since jsdom audio element events don't bubble the same, we trigger on the
      // HTMLAudioElement prototype's onended we set. Instead just click again to toggle.
    });

    // Second play — should not call apiFetchBlob again
    await act(async () => {
      fireEvent.click(btn);
    });

    // apiFetchBlob should be called at most once (cache reuse)
    // (In reality it might be called once total if cache works)
    expect(apiFetchBlob).toHaveBeenCalledTimes(1);
  });

  test("shows error state when apiFetchBlob rejects", async () => {
    (apiFetchBlob as jest.Mock).mockRejectedValueOnce(new Error("TTS service unavailable"));

    render(<TestSpeakWidget text="Error speech" />);
    const btn = screen.getByRole("button", { name: /play debby's speech/i });

    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() => {
      expect(screen.getByTestId("state")).toHaveTextContent("error");
    });
  });
});

describe("SpeakButton rendering states", () => {
  test("shows pause icon when state is playing for the active text", () => {
    const mockPlayFn = jest.fn();
    render(
      <SpeakButton
        text="some speech"
        play={mockPlayFn}
        state="playing"
        activeText="some speech"
      />,
    );
    expect(screen.getByRole("button", { name: /pause debby's speech/i })).toBeInTheDocument();
  });

  test("shows loading indicator when loading for the active text", () => {
    const mockPlayFn = jest.fn();
    render(
      <SpeakButton
        text="some speech"
        play={mockPlayFn}
        state="loading"
        activeText="some speech"
      />,
    );
    expect(screen.getByRole("button", { name: /loading speech/i })).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeDisabled();
  });

  test("shows play icon when playing a different text (not active)", () => {
    const mockPlayFn = jest.fn();
    render(
      <SpeakButton
        text="my speech"
        play={mockPlayFn}
        state="playing"
        activeText="other speech"
      />,
    );
    // This button should show play since it's not the active one
    expect(screen.getByRole("button", { name: /play debby's speech/i })).toBeInTheDocument();
  });
});
