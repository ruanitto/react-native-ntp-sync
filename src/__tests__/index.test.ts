import NTPSync from '../index';
import {
  buildNtpPacket,
  __setNextResponse,
  __setNextError,
  __setNextTimeout,
} from '../__mocks__/react-native-udp';
import type { NtpHistory } from '../internals/types';

// react-native is not installed in this repo — mock only what index.ts uses
jest.mock(
  'react-native',
  () => ({
    AppState: {
      addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    },
  }),
  { virtual: true },
);

import { AppState } from 'react-native';
const mockAppState = AppState as unknown as {
  addEventListener: jest.Mock;
};

// Prevent auto-sync intervals from leaking between tests
beforeEach(() => {
  jest.useFakeTimers();
  mockAppState.addEventListener.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

// Helper: create instance with autoSync and syncOnCreation disabled
function makeSync(overrides = {}) {
  return new NTPSync({
    autoSync: false,
    syncOnCreation: false,
    syncTimeout: 500,
    ...overrides,
  });
}

// Flush all pending microtasks (multiple rounds for promise chains)
async function flushMicrotasks(rounds = 5) {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

describe('NTPSync constructor', () => {
  it('does not mutate DEFAULT_CONFIG across instances', () => {
    const a = new NTPSync({ autoSync: false, syncOnCreation: false, history: 5 });
    const b = new NTPSync({ autoSync: false, syncOnCreation: false, history: 20 });

    // Each instance should have its own config
    expect((a as any).limit).toBe(5);
    expect((b as any).limit).toBe(20);
  });

  it('starts online by default', () => {
    const sync = makeSync();
    expect(sync.getIsOnline()).toBe(true);
  });

  it('respects startOnline: false', () => {
    const sync = makeSync({ startOnline: false });
    expect(sync.getIsOnline()).toBe(false);
  });

  it('calls syncTime on creation when syncOnCreation=true', async () => {
    __setNextResponse(buildNtpPacket(Date.now()));

    const sync = new NTPSync({ autoSync: false, syncOnCreation: true });
    await flushMicrotasks();

    const history = sync.getHistory();
    expect(history.deltas.length).toBeGreaterThan(0);
  });
});

describe('getTime', () => {
  it('returns Date.now() when no deltas exist', () => {
    const sync = makeSync();
    const before = Date.now();
    const t = sync.getTime();
    const after = Date.now();

    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });

  it('returns corrected time after successful sync', async () => {
    const serverTime = Date.now() + 5000; // server is 5s ahead
    __setNextResponse(buildNtpPacket(serverTime));

    const sync = makeSync();
    await sync.syncTime();

    const result = sync.getTime();
    // Should be close to serverTime (within 500ms tolerance)
    expect(Math.abs(result - serverTime)).toBeLessThan(500);
  });

  it('uses median delta to reject outliers', async () => {
    const sync = makeSync({ history: 5 });

    // Inject 5 deltas manually: 4 consistent + 1 extreme outlier.
    // ntp and monotonic are anchored to "now" so the projection is exact.
    const deltas = (sync as any).historyDetails.deltas as Array<{ dt: number; ntp: number; monotonic: number }>;
    const now = Date.now();
    const perfNow = performance.now();
    deltas.push({ dt: 100, ntp: now + 100, monotonic: perfNow });
    deltas.push({ dt: 110, ntp: now + 110, monotonic: perfNow });
    deltas.push({ dt: 90,  ntp: now + 90,  monotonic: perfNow });
    deltas.push({ dt: 105, ntp: now + 105, monotonic: perfNow });
    deltas.push({ dt: 50000, ntp: now + 50000, monotonic: perfNow }); // outlier

    // Median of [90, 100, 105, 110, 50000] = 105
    const result = sync.getTime();
    expect(Math.abs(result - (Date.now() + 105))).toBeLessThan(50);
  });

  it('median works with even number of deltas', async () => {
    const sync = makeSync({ history: 4 });
    const deltas = (sync as any).historyDetails.deltas as Array<{ dt: number; ntp: number; monotonic: number }>;
    const now = Date.now();
    const perfNow = performance.now();
    deltas.push({ dt: 100, ntp: now + 100, monotonic: perfNow });
    deltas.push({ dt: 200, ntp: now + 200, monotonic: perfNow });
    deltas.push({ dt: 300, ntp: now + 300, monotonic: perfNow });
    deltas.push({ dt: 400, ntp: now + 400, monotonic: perfNow });

    // Median of [100,200,300,400] = (200+300)/2 = 250
    const result = sync.getTime();
    expect(Math.abs(result - (Date.now() + 250))).toBeLessThan(50);
  });

  it('does not jump when the device clock is manually changed', async () => {
    const serverTime = Date.now() + 5000;
    __setNextResponse(buildNtpPacket(serverTime));
    const sync = makeSync();

    await sync.syncTime();
    const before = sync.getTime();

    // Simulate the user changing the device clock (+1 hour)
    const realNow = Date.now;
    jest.spyOn(Date, 'now').mockReturnValue(realNow() + 3_600_000);
    const after = sync.getTime();
    jest.restoreAllMocks();

    // getTime() is anchored to the monotonic clock, so it must not jump
    expect(Math.abs(after - before)).toBeLessThan(100);
  });
});

describe('syncTime', () => {
  it('returns true on success', async () => {
    __setNextResponse(buildNtpPacket(Date.now()));
    const sync = makeSync();

    const result = await sync.syncTime();
    expect(result).toBe(true);
  });

  it('returns false when offline', async () => {
    const sync = makeSync({ startOnline: false });
    const result = await sync.syncTime();
    expect(result).toBe(false);
  });

  it('returns false on network error', async () => {
    __setNextError(new Error('connection refused'));
    const sync = makeSync();

    const result = await sync.syncTime();
    expect(result).toBe(false);
  });

  it('updates history on success', async () => {
    __setNextResponse(buildNtpPacket(Date.now()));
    const sync = makeSync();

    await sync.syncTime();
    const history = sync.getHistory();

    expect(history.deltas).toHaveLength(1);
    expect(history.isInErrorState).toBe(false);
    expect(history.lastSyncTime).not.toBeNull();
    expect(history.currentConsecutiveErrorCount).toBe(0);
  });

  it('records error state on failure', async () => {
    __setNextError(new Error('timeout'));
    const sync = makeSync();

    await sync.syncTime();
    const history = sync.getHistory();

    expect(history.isInErrorState).toBe(true);
    expect(history.errors).toHaveLength(1);
    expect(history.lifetimeErrorCount).toBe(1);
    expect(history.currentConsecutiveErrorCount).toBe(1);
    expect(history.lastError).not.toBeNull();
  });

  it('tracks maxConsecutiveErrorCount', async () => {
    __setNextError(new Error('fail'));
    const sync = makeSync();

    await sync.syncTime();
    await sync.syncTime();
    __setNextError(new Error('fail'));
    await sync.syncTime();

    const history = sync.getHistory();
    expect(history.maxConsecutiveErrorCount).toBeGreaterThanOrEqual(2);
  });

  it('resets consecutive error count after recovery', async () => {
    __setNextError(new Error('fail'));
    const sync = makeSync();
    await sync.syncTime();
    await sync.syncTime();

    __setNextResponse(buildNtpPacket(Date.now()));
    await sync.syncTime();

    expect(sync.getHistory().currentConsecutiveErrorCount).toBe(0);
    expect(sync.getHistory().isInErrorState).toBe(false);
  });

  it('respects history limit for deltas (circular buffer)', async () => {
    const sync = makeSync({ history: 3 });

    for (let i = 0; i < 5; i++) {
      __setNextResponse(buildNtpPacket(Date.now() + i * 1000));
      await sync.syncTime();
    }

    expect(sync.getHistory().deltas).toHaveLength(3);
  });

  it('respects history limit for errors', async () => {
    const sync = makeSync({ history: 3 });

    for (let i = 0; i < 5; i++) {
      __setNextError(new Error(`fail ${i}`));
      await sync.syncTime();
    }

    expect(sync.getHistory().errors).toHaveLength(3);
  });
});

describe('getDelta', () => {
  it('returns delta=0 when offline', async () => {
    const sync = makeSync({ startOnline: false });
    const result = await sync.getDelta();
    expect(result.delta).toBe(0);
    expect(result.fetchingServer).toBeUndefined();
  });

  it('returns delta and fetchingServer on success', async () => {
    const serverTime = Date.now() + 1000;
    __setNextResponse(buildNtpPacket(serverTime));

    const sync = makeSync();
    const result = await sync.getDelta();

    expect(typeof result.delta).toBe('number');
    expect(result.fetchingServer).toBeDefined();
    expect(result.fetchingServer?.server).toBeTruthy();
  });

  it('shifts to next server on error', async () => {
    __setNextError(new Error('unreachable'));
    const sync = makeSync();

    const initialServer = sync.getHistory().currentServer.server;

    try {
      await sync.getDelta();
    } catch {
      // expected
    }

    const nextServer = sync.getHistory().currentServer.server;
    // With multiple servers in default config, server should have rotated
    expect(nextServer).not.toBe(initialServer);
  });

  it('throws NtpClientError with server info on failure', async () => {
    __setNextError(new Error('socket error'));
    const sync = makeSync();

    const { NtpClientError } = await import('../index');

    await expect(sync.getDelta()).rejects.toBeInstanceOf(NtpClientError);
  });
});

describe('setIsOnline / getIsOnline', () => {
  it('going online triggers syncTime', async () => {
    __setNextResponse(buildNtpPacket(Date.now()));
    const sync = makeSync({ startOnline: false });

    sync.setIsOnline(true);
    await flushMicrotasks();

    expect(sync.getIsOnline()).toBe(true);
    expect(sync.getHistory().deltas.length).toBeGreaterThan(0);
  });

  it('going offline stops auto-sync', () => {
    const sync = makeSync({ autoSync: false });
    sync.setIsOnline(false);
    expect(sync.getIsOnline()).toBe(false);
  });

  it('no-op when already in same state', () => {
    const sync = makeSync();
    const spy = jest.spyOn(sync, 'syncTime');

    sync.setIsOnline(true); // already online
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('autoSync', () => {
  it('startAutoSync schedules periodic syncTime', async () => {
    __setNextResponse(buildNtpPacket(Date.now()));
    const sync = makeSync({ autoSync: false });
    const spy = jest.spyOn(sync, 'syncTime');

    sync.startAutoSync();
    jest.advanceTimersByTime(300_000); // default interval
    await flushMicrotasks();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('stopAutoSync cancels interval', async () => {
    __setNextResponse(buildNtpPacket(Date.now()));
    const sync = makeSync({ autoSync: false });
    const spy = jest.spyOn(sync, 'syncTime');

    sync.startAutoSync();
    sync.stopAutoSync();
    jest.advanceTimersByTime(600_000);
    await flushMicrotasks();

    expect(spy).not.toHaveBeenCalled();
  });

  it('startAutoSync is idempotent (no duplicate intervals)', () => {
    const sync = makeSync({ autoSync: false });
    sync.startAutoSync();
    sync.startAutoSync();

    const tickId1 = (sync as any).tickId;
    sync.startAutoSync();
    const tickId2 = (sync as any).tickId;

    expect(tickId1).toBe(tickId2);
  });
});

describe('AppState / background handling', () => {
  it('subscribes to AppState changes by default', () => {
    makeSync();
    expect(mockAppState.addEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function),
    );
  });

  it('does not subscribe when appStateSync=false', () => {
    makeSync({ appStateSync: false });
    expect(mockAppState.addEventListener).not.toHaveBeenCalled();
  });

  it('re-syncs when the app returns to the foreground', async () => {
    __setNextResponse(buildNtpPacket(Date.now()));
    const sync = makeSync();
    const spy = jest.spyOn(sync, 'syncTime');

    const handler = mockAppState.addEventListener.mock.calls[0][1];
    handler('active');
    await flushMicrotasks();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(sync.getHistory().deltas.length).toBeGreaterThan(0);
  });

  it('does not sync when offline', async () => {
    const sync = makeSync({ startOnline: false });
    const spy = jest.spyOn(sync, 'syncTime');

    const handler = mockAppState.addEventListener.mock.calls[0][1];
    handler('active');
    await flushMicrotasks();

    expect(spy).not.toHaveBeenCalled();
  });

  it('ignores non-active states', () => {
    const sync = makeSync();
    const spy = jest.spyOn(sync, 'syncTime');

    const handler = mockAppState.addEventListener.mock.calls[0][1];
    handler('background');
    expect(spy).not.toHaveBeenCalled();
  });

  it('dispose removes the AppState subscription and stops auto-sync', () => {
    const sync = makeSync();
    const sub = mockAppState.addEventListener.mock.results[0].value;

    sync.startAutoSync();
    sync.dispose();

    expect(sub.remove).toHaveBeenCalled();
    expect((sync as any).appStateSub).toBeNull();
    expect((sync as any).tickId).toBeNull();
  });
});

describe('listeners', () => {
  it('addListener is called after successful sync', async () => {
    __setNextResponse(buildNtpPacket(Date.now()));
    const sync = makeSync();
    const handler = jest.fn();

    sync.addListener(handler);
    await sync.syncTime();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      deltas: expect.any(Array),
      isInErrorState: false,
    }));
  });

  it('listener not called on sync failure', async () => {
    __setNextError(new Error('fail'));
    const sync = makeSync();
    const handler = jest.fn();

    sync.addListener(handler);
    await sync.syncTime();

    expect(handler).not.toHaveBeenCalled();
  });

  it('removeListener stops future calls', async () => {
    __setNextResponse(buildNtpPacket(Date.now()));
    const sync = makeSync();
    const handler = jest.fn();

    sync.addListener(handler);
    sync.removeListener(handler);

    await sync.syncTime();
    expect(handler).not.toHaveBeenCalled();
  });

  it('multiple listeners all receive updates', async () => {
    __setNextResponse(buildNtpPacket(Date.now()));
    const sync = makeSync();
    const h1 = jest.fn();
    const h2 = jest.fn();

    sync.addListener(h1);
    sync.addListener(h2);
    await sync.syncTime();

    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });
});

describe('getHistory', () => {
  it('returns a snapshot — mutations do not affect internal state', async () => {
    __setNextResponse(buildNtpPacket(Date.now()));
    const sync = makeSync();
    await sync.syncTime();

    const history = sync.getHistory();
    history.deltas.push({ dt: 99999, ntp: 0, monotonic: 0 });

    // Internal state should be unchanged
    expect(sync.getHistory().deltas).toHaveLength(1);
  });

  it('contains all expected fields', () => {
    const sync = makeSync();
    const history: NtpHistory = sync.getHistory();

    expect(history).toMatchObject({
      currentConsecutiveErrorCount: expect.any(Number),
      currentServer: expect.objectContaining({ server: expect.any(String), port: expect.any(Number) }),
      deltas: expect.any(Array),
      errors: expect.any(Array),
      isInErrorState: expect.any(Boolean),
      lifetimeErrorCount: expect.any(Number),
      maxConsecutiveErrorCount: expect.any(Number),
    });
  });
});

describe('server rotation', () => {
  it('cycles through all servers on repeated errors', async () => {
    const servers = [
      { server: 'a.ntp.org', port: 123 },
      { server: 'b.ntp.org', port: 123 },
      { server: 'c.ntp.org', port: 123 },
    ];
    const sync = makeSync({ servers });
    const visited = new Set<string>();

    for (let i = 0; i < servers.length; i++) {
      __setNextError(new Error('fail'));
      visited.add(sync.getHistory().currentServer.server);
      try { await sync.getDelta(); } catch { /* expected */ }
    }

    expect(visited.size).toBe(servers.length);
  });

  it('wraps around after last server', async () => {
    const servers = [
      { server: 'a.ntp.org', port: 123 },
      { server: 'b.ntp.org', port: 123 },
    ];
    const sync = makeSync({ servers });

    // Fail twice to wrap around
    for (let i = 0; i < 2; i++) {
      __setNextError(new Error('fail'));
      try { await sync.getDelta(); } catch { /* expected */ }
    }

    // Should be back to first server
    expect(sync.getHistory().currentServer.server).toBe('a.ntp.org');
  });
});
