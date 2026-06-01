/**
 * installAudioMock()
 *
 * Stubs window.AudioContext (and window.webkitAudioContext) plus
 * Blob.prototype.arrayBuffer so that useDebbySpeech can be tested in jsdom.
 *
 * Design goals for Stream C interop:
 *  - decodeAudioData length is derivable from the input ArrayBuffer size so
 *    that concatenation math can be asserted in tests.
 *  - createBufferSource returns a node with connect / start / stop / onended.
 *  - All async methods resolve synchronously (via Promise.resolve) so tests
 *    don't need fake timers for the happy path.
 */

// ---------------------------------------------------------------------------
// Fake AudioBuffer
// ---------------------------------------------------------------------------

export class FakeAudioBuffer {
  readonly length: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  private _data: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.length = length;
    this.numberOfChannels = numberOfChannels;
    this.sampleRate = sampleRate;
    this._data = Array.from({ length: numberOfChannels }, () =>
      new Float32Array(length),
    );
  }

  getChannelData(channel: number): Float32Array {
    if (channel >= this.numberOfChannels) {
      throw new RangeError(`channel index ${channel} out of range`);
    }
    return this._data[channel];
  }
}

// ---------------------------------------------------------------------------
// Fake AudioBufferSourceNode
// ---------------------------------------------------------------------------

export class FakeBufferSourceNode {
  buffer: FakeAudioBuffer | null = null;
  onended: (() => void) | null = null;
  private _connected = false;
  private _started = false;
  private _stopped = false;

  connect(_dest: unknown): void {
    this._connected = true;
  }

  start(): void {
    this._started = true;
  }

  stop(): void {
    if (!this._started) {
      throw new DOMException("stop() called before start()", "InvalidStateError");
    }
    if (this._stopped) {
      throw new DOMException("Already stopped", "InvalidStateError");
    }
    this._stopped = true;
    // fire onended synchronously (mirrors real AudioContext behaviour in tests)
    if (this.onended) {
      this.onended();
    }
  }

  disconnect(): void {
    this._connected = false;
  }

  /** Test helpers */
  get isConnected(): boolean {
    return this._connected;
  }
  get isStarted(): boolean {
    return this._started;
  }
  get isStopped(): boolean {
    return this._stopped;
  }
}

// ---------------------------------------------------------------------------
// Fake AudioContext
// ---------------------------------------------------------------------------

/**
 * decodeAudioData uses byteLength / 4 as the buffer length so tests can
 * predict the exact length from the size of the ArrayBuffer they provide.
 * With 1 channel and sampleRate=44100 this keeps the math simple.
 */
const FAKE_SAMPLE_RATE = 44100;
const FAKE_CHANNELS = 1;

export class FakeAudioContext {
  readonly destination = {};
  readonly sampleRate = FAKE_SAMPLE_RATE;

  /** Track all source nodes created, newest last */
  readonly createdSourceNodes: FakeBufferSourceNode[] = [];

  decodeAudioData(arrayBuffer: ArrayBuffer): Promise<FakeAudioBuffer> {
    const length = Math.max(1, Math.floor(arrayBuffer.byteLength / 4));
    return Promise.resolve(
      new FakeAudioBuffer(FAKE_CHANNELS, length, FAKE_SAMPLE_RATE),
    );
  }

  createBuffer(
    numberOfChannels: number,
    length: number,
    sampleRate: number,
  ): FakeAudioBuffer {
    return new FakeAudioBuffer(numberOfChannels, length, sampleRate);
  }

  createBufferSource(): FakeBufferSourceNode {
    const node = new FakeBufferSourceNode();
    this.createdSourceNodes.push(node);
    return node;
  }

  resume(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Blob.prototype.arrayBuffer stub
// ---------------------------------------------------------------------------

/**
 * jsdom's Blob does not implement arrayBuffer().  We stub it to return an
 * ArrayBuffer whose size encodes the blob's text content length * 4 so that
 * the fake decodeAudioData length == content-string length.
 *
 * In practice tests create Blobs from strings like "audio-part-A" so the
 * resulting fake buffer length = string.length.
 */
function installBlobArrayBuffer(): void {
  // Always install a deterministic stub. jsdom's Blob implements neither a
  // usable arrayBuffer() nor text(), so we derive the byte length from the
  // blob's size: size * 4 bytes → fake decodeAudioData (byteLength / 4) yields
  // a sample length equal to the (ASCII) content length, which tests assert on.
  (Blob.prototype as unknown as Record<string, unknown>).arrayBuffer =
    async function (this: Blob): Promise<ArrayBuffer> {
      return new ArrayBuffer(this.size * 4);
    };
}

// ---------------------------------------------------------------------------
// installAudioMock – the exported surface Stream C imports
// ---------------------------------------------------------------------------

export interface AudioMockHandles {
  /** The FakeAudioContext constructor – cast as needed */
  FakeAudioContext: typeof FakeAudioContext;
  /** The last FakeAudioContext that was instantiated */
  lastCtx: () => FakeAudioContext | null;
  /** Reset: clear the last-ctx pointer (between tests) */
  reset: () => void;
}

/**
 * Call once at the top of a describe block (or in beforeEach).
 * Returns handles for inspecting the fake context in assertions.
 */
export function installAudioMock(): AudioMockHandles {
  let _lastCtx: FakeAudioContext | null = null;

  class TrackedFakeAudioContext extends FakeAudioContext {
    constructor() {
      super();
      _lastCtx = this;
    }
  }

  installBlobArrayBuffer();

  // Install on window so the hook's `window.AudioContext` lookup finds it
  (window as unknown as Record<string, unknown>).AudioContext =
    TrackedFakeAudioContext;
  (window as unknown as Record<string, unknown>).webkitAudioContext =
    TrackedFakeAudioContext;

  return {
    FakeAudioContext: TrackedFakeAudioContext as unknown as typeof FakeAudioContext,
    lastCtx: () => _lastCtx,
    reset: () => {
      _lastCtx = null;
    },
  };
}
