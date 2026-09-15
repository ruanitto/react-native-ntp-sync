import NTPSync, { MONOTONIC_CLOCK, monotonicNow } from '../index';
import {
  buildNtpPacket,
  __setNextResponse,
} from '../__mocks__/react-native-udp';
import { resetMonotonicClockSource } from '../internals/monotonic';

// Simulate a JS bundle where the RNNtpMonotonicClock native module is NOT
// linked (web, or an app not rebuilt after upgrading to 2.0.0). In that case
// monotonicNow() falls back to performance.now() (SystemClock.uptimeMillis /
// mach_absolute_time — sleep-blind) and MONOTONIC_CLOCK MUST report 'uptime'
// instead of mislabeling the fallback as sleep-aware.
jest.mock(
  'react-native',
  () => ({
    AppState: {
      addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    },
    NativeModules: {},
  }),
  { virtual: true }
);

afterEach(() => {
  resetMonotonicClockSource();
  jest.useRealTimers();
});

function makeSync(overrides = {}) {
  return new NTPSync({
    autoSync: false,
    syncOnCreation: false,
    syncTimeout: 500,
    ...overrides,
  });
}

describe('MONOTONIC_CLOCK fallback (no native module)', () => {
  it('reports "uptime" when the native module is unavailable', () => {
    // The exported value must reflect the real source, never a hardcoded
    // 'elapsed' — that would relabel a sleep-blind clock as sleep-aware.
    expect(MONOTONIC_CLOCK).toBe('uptime');
  });

  it('is re-exported from the package entry alongside monotonicNow', () => {
    expect(typeof monotonicNow).toBe('function');
    expect(typeof monotonicNow()).toBe('number');
  });

  it('syncTime-generated deltas carry the "uptime" label', async () => {
    __setNextResponse(buildNtpPacket(Date.now()));
    const sync = makeSync();

    await sync.syncTime();

    expect(sync.getHistory().deltas[0].clock).toBe('uptime');
  });

  it('importDeltas discards "elapsed"-labeled deltas (clock mismatch → fail-safe)', () => {
    // A delta persisted on a sleep-aware clock must NOT be projected on this
    // sleep-blind clock: servers aside, an 'elapsed' value may be much larger
    // than the current uptime, and accepting it would silently shift time.
    const sync = makeSync({ startOnline: false });
    const past = performance.now() - 1000;

    sync.importDeltas([
      { ntp: Date.now() + 200, monotonic: past, clock: 'elapsed' },
    ]);

    expect(sync.getHistory().deltas).toHaveLength(0);
    // Falls back to the wall clock — the honest limitation of a sleep-blind source
    const t = sync.getTime();
    expect(Math.abs(t - Date.now())).toBeLessThan(50);
  });

  it('importDeltas keeps "uptime"-labeled deltas from the same clock', () => {
    const sync = makeSync({ startOnline: false });
    const past = performance.now() - 1000;

    sync.importDeltas([
      { ntp: Date.now() + 200, monotonic: past, clock: 'uptime' },
    ]);

    const deltas = sync.getHistory().deltas;
    expect(deltas).toHaveLength(1);
    expect(deltas[0].clock).toBe('uptime');
  });

  it('offline getTime still projects correctly on the honest "uptime" clock', async () => {
    __setNextResponse(buildNtpPacket(Date.now() + 1000));
    const sync = makeSync();

    await sync.syncTime();
    sync.setIsOnline(false);

    const result = sync.getTime();
    expect(Math.abs(result - (Date.now() + 1000))).toBeLessThan(500);
  });

  it('deltas created by syncTime round-trip through importDeltas', async () => {
    __setNextResponse(buildNtpPacket(Date.now() + 300));
    const sync = makeSync();

    await sync.syncTime();

    const exported = sync.getHistory().deltas.map((d) => ({
      ntp: d.ntp,
      monotonic: d.monotonic,
      clock: d.clock,
    }));

    const restored = makeSync({ startOnline: false });
    restored.importDeltas(exported);

    const deltas = restored.getHistory().deltas;
    expect(deltas).toHaveLength(1);
    expect(deltas[0].clock).toBe('uptime');
    expect(Math.abs(restored.getTime() - (Date.now() + 300))).toBeLessThan(500);
  });
});
