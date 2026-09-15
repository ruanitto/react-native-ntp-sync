# @ruanitto/react-native-ntp-sync

> Forked from [@luneo7/react-native-ntp-sync](https://github.com/luneo7/react-native-ntp-sync)

React Native NTP client that fetches accurate time from the internet and keeps your app's clock in sync — regardless of the device's local clock drift.

**How it works:**

1. Sends an NTP request to a configurable list of servers.
2. Compensates for network round-trip delay using the standard RFC 5905 offset formula: `((T2−T1) + (T3−T4)) / 2`.
3. Validates the server response (stratum, synchronization status, timestamp sanity).
4. Anchors every sample to a **sleep-aware monotonic clock** — `SystemClock.elapsedRealtime()` on Android and `CACurrentMediaTime()` on iOS — so the corrected time is computed as `ntp + (now − monotonic)`.
5. Stores a rolling history of deltas and uses the **median** to compute corrected time — outliers from unstable networks are automatically rejected.
6. Rotates to the next server on failure and retries automatically.
7. Re-syncs automatically when the app returns to the foreground (`AppState`).

**Why a monotonic clock?** The device wall clock (`Date.now()`) can be changed by the user or by automatic time corrections. Because `getTime()` is anchored to the monotonic clock — which cannot be changed manually — the returned time stays reliable even if the user changes the device date/time *after* the first successful sync.

**Why a native module?** Before 2.0.0 the package used `performance.now()` as its monotonic clock. On Android's Hermes runtime that is backed by `SystemClock.uptimeMillis()`, which **does not count time spent in deep sleep** — a phone synced at 21:00, closed overnight, and reopened offline at 08:10 would project the time as ~01:27 (≈7h behind). On iOS, `performance.now()` (`mach_absolute_time`) already includes sleep, so iOS was never affected.

Since 2.0.0 the package ships a small native module (`RNNtpMonotonicClock`) that reads `SystemClock.elapsedRealtime()` on Android and `CACurrentMediaTime()` on iOS — both include deep sleep, are immune to wall-clock manipulation, and reset on reboot (preserving the existing boot-filter semantics). **Consumers must rebuild their native code** (and re-run `pod install` on iOS) for the module to be linked; until then, and on platforms without the module (e.g. web), the package transparently falls back to `performance.now()`.

> **Breaking change (2.0.0):** persisted delta format. Deltas stored by versions < 2.0.0 used `performance.now()` (uptime-based) and have no `clock` field. Because uptime ≤ elapsed-realtime always, they would pass the boot filter and silently project the entire sleep time since boot. `importDeltas` now discards any delta whose `clock` field does not match the current clock (deltas without the field are treated as `'uptime'` and discarded). New deltas carry `clock: 'elapsed'`.

---

## Installation

```sh
npm install @ruanitto/react-native-ntp-sync react-native-udp
```

On iOS, run pod install after installing:

```sh
cd ios && pod install
```

**Since 2.0.0 the package contains native code.** Rebuild the app after upgrading so the native `RNNtpMonotonicClock` module is linked (Android: `npx react-native run-android`; iOS: `pod install` + rebuild). Autolinking (React Native ≥ 0.60) picks up `android/` and the podspec automatically.

**React Native >= 0.60 required.** See [react-native-udp compatibility](https://www.npmjs.com/package/react-native-udp#react-native-compatibility) for details.

---

## Quick Start

```typescript
import NTPSync from '@ruanitto/react-native-ntp-sync';

// Create instance with defaults — starts syncing immediately
const clock = new NTPSync();

// Use instead of Date.now() anywhere you need a reliable timestamp
const now = clock.getTime();
console.log(new Date(now).toISOString());
```

---

## Configuration

All options are optional. Defaults shown below.

```typescript
import NTPSync from '@ruanitto/react-native-ntp-sync';

const clock = new NTPSync({
  // NTP servers to use, tried in order on failure
  servers: [
    { server: 'time.google.com',     port: 123 },
    { server: 'time.cloudflare.com', port: 123 },
    { server: 'time.windows.com',    port: 123 },
    { server: '0.pool.ntp.org',      port: 123 },
    { server: '1.pool.ntp.org',      port: 123 },
  ],

  // Number of delta samples kept for median calculation
  history: 10,

  // How often to re-sync with NTP (ms). Default: 5 minutes
  syncInterval: 300_000,

  // Per-request timeout (ms). Default: 10 seconds
  syncTimeout: 10_000,

  // Sync immediately on instantiation
  syncOnCreation: true,

  // Start the auto-sync interval on instantiation
  autoSync: true,

  // Set to false to start in offline mode (no network calls)
  startOnline: true,

  // Re-sync when the app returns to the foreground (AppState)
  appStateSync: true,

  // Maximum allowed clock skew in ms (absolute value). Deltas exceeding this
  // are rejected to protect against rogue/buggy NTP servers. Default: 5000 (5s).
  maxSkewMs: 5000,
});
```

---

## API

### `getTime(): number`

Returns the current corrected Unix timestamp (ms). Use this instead of `Date.now()`.

```typescript
const timestamp = clock.getTime();
console.log(new Date(timestamp).toISOString()); // e.g. "2026-06-01T12:00:00.000Z"
```

The value is the **median** of each sample projected onto the monotonic clock (`ntp + (monotonicNow() − monotonic)`), which rejects outliers and stays correct even if the user changes the device clock or the device sleeps (the native clock includes deep sleep). If no sync has occurred yet, falls back to `Date.now()`.

---

### `syncTime(): Promise<boolean>`

Forces an immediate NTP sync. Returns `true` on success, `false` on failure or when offline.

```typescript
const synced = await clock.syncTime();
if (!synced) {
  console.warn('Sync failed, using last known delta');
}
```

You generally don't need to call this manually — `autoSync` handles it. Useful for forcing a sync after a network reconnect or on app foreground.

---

### `getDelta(): Promise<NtpDelta>`

Fetches a single delta from the current NTP server and stores the result in history. Returns `{ delta: 0 }` when offline.

```typescript
const { delta, fetchingServer } = await clock.getDelta();
console.log(`Delta: ${delta}ms from ${fetchingServer?.server}`);
```

---

### `getHistory(): NtpHistory`

Returns a snapshot of the current sync state. Safe to mutate — changes do not affect internal state.

```typescript
const history = clock.getHistory();

console.log(history.currentServer);              // { server: 'time.google.com', port: 123 }
console.log(history.deltas.length);              // number of stored samples
console.log(history.isInErrorState);             // true if last sync failed
console.log(history.lifetimeErrorCount);         // total errors since creation
console.log(history.lastSyncTime);               // local timestamp of last successful sync
```

#### `NtpHistory` fields

| Field | Type | Description |
|---|---|---|
| `currentServer` | `NtpServer` | Server used for the next sync |
| `deltas` | `Delta[]` | Rolling list of `{ dt, ntp, monotonic, clock }` samples (max `history` entries) |
| `errors` | `object[]` | Rolling list of sync errors (max `history` entries) |
| `isInErrorState` | `boolean` | `true` if last sync failed |
| `lastSyncTime` | `number \| null` | Local time of last successful sync (ms) |
| `lastNtpTime` | `number \| null` | NTP time of last successful sync (ms) |
| `lastError` | `object \| null` | Last error details |
| `currentConsecutiveErrorCount` | `number` | Errors since last success |
| `maxConsecutiveErrorCount` | `number` | Peak consecutive error streak |
| `lifetimeErrorCount` | `number` | Total errors since creation |

---

### `importDeltas(deltas: DeltaImport[]): void`

Import previously persisted NTP deltas, using raw monotonic anchors. This maintains reliable time **across app restarts while offline**.

Each persisted sample must include `ntp` (the NTP time at sync), `monotonic` (the monotonic clock value at sync) and `clock` (the clock used to measure it — `'elapsed'` in 2.0.0+). The monotonic clock is boot-based on Android (`SystemClock.elapsedRealtime`) and iOS (`CACurrentMediaTime()`), so raw values are valid across process restarts within the same boot — **no re-anchoring via `Date.now()` is needed**, which avoids reintroducing clock-manipulation vulnerabilities.

Deltas captured before a device reboot (where the stored `monotonic` exceeds the current monotonic clock) are **automatically discarded**.

**Legacy deltas (pre-2.0.0) are discarded.** Deltas persisted by older versions used `performance.now()` (`SystemClock.uptimeMillis`, which excludes deep sleep) and have no `clock` field. They are treated as `'uptime'` and rejected, because projecting them on the sleep-aware clock would silently add the total sleep time since boot. If you have stored deltas, drop them or let `importDeltas` discard them — the first successful sync after upgrading produces compatible deltas.

```typescript
import NTPSync, { DeltaImport } from '@ruanitto/react-native-ntp-sync';
import AsyncStorage from '@react-native-async-storage/async-storage';

const clock = new NTPSync({ syncOnCreation: false, startOnline: false });

// --- On app startup, before first sync ---
const stored = await AsyncStorage.getItem('ntp-deltas');
if (stored) {
  const deltas: DeltaImport[] = JSON.parse(stored);
  clock.importDeltas(deltas);
}

// Now getTime() is accurate even while offline
console.log(new Date(clock.getTime()).toISOString());

// --- After each successful sync, persist the latest state ---
clock.addListener(history => {
  const toStore: DeltaImport[] = history.deltas.map(d => ({
    ntp: d.ntp,
    monotonic: d.monotonic,
    clock: d.clock,
  }));
  AsyncStorage.setItem('ntp-deltas', JSON.stringify(toStore));
});
```

#### Why no re-anchoring is needed

| Scenario | Old monotonic | monotonic clock (new process, same boot) | Without import | With `importDeltas` |
|---|---|---|---|---|
| Sample at 50s into boot | `50000` | `55000` | `ntp + (55000 − 50000)` = **correct** | Same — raw anchor used directly |
| After device reboot | `50000` | `1000` | `ntp + (1000 − 50000)` = **way off** | **Discarded** (`1000 < 50000`) |

---

### `setIsOnline(isOnline: boolean): void`

Controls network activity. Useful when responding to connectivity changes.

- `true` → immediately syncs and resumes auto-sync interval.
- `false` → stops all network activity. `getTime()` continues to work using the last known deltas.

```typescript
import NTPSync from '@ruanitto/react-native-ntp-sync';
import NetInfo from '@react-native-community/netinfo';

const clock = new NTPSync({ startOnline: false });

// Set initial state
NetInfo.fetch().then(state => {
  clock.setIsOnline(state.isConnected ?? false);
});

// React to connectivity changes
const unsubscribe = NetInfo.addEventListener(state => {
  clock.setIsOnline(state.isConnected ?? false);
});

// Clean up when done (e.g. component unmount)
unsubscribe();
clock.setIsOnline(false);
```

---

### `getIsOnline(): boolean`

Returns the current online state of the instance.

---

### `startAutoSync(): void`

Starts the periodic sync interval. No-op if already running.

### `stopAutoSync(): void`

Stops the periodic sync interval.

---

### `dispose(): void`

Stops the auto-sync interval and unsubscribes from `AppState` changes. Call this when tearing down (e.g. app shutdown or unmounting a long-lived component) to avoid leaks.

```typescript
const clock = new NTPSync();
// ... later, on cleanup:
clock.dispose();
```

---

### `addListener(handler: (history: NtpHistory) => void): void`

Registers a callback invoked after every **successful** sync. Receives a `NtpHistory` snapshot.

```typescript
clock.addListener(history => {
  console.log('Synced. Delta samples:', history.deltas.length);
  console.log('Last NTP time:', new Date(history.lastNtpTime!).toISOString());
});
```

### `removeListener(handler: (history: NtpHistory) => void): void`

Removes a previously registered listener. Always call this when tearing down to avoid memory leaks.

```typescript
const handler = (history: NtpHistory) => { /* ... */ };

clock.addListener(handler);

// Later, on cleanup:
clock.removeListener(handler);
```

---

## Examples

### Basic usage in a React Native component

```typescript
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import NTPSync from '@ruanitto/react-native-ntp-sync';

const clock = new NTPSync();

export default function ClockDisplay() {
  const [time, setTime] = useState(clock.getTime());

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(clock.getTime());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <View>
      <Text>{new Date(time).toLocaleTimeString()}</Text>
    </View>
  );
}
```

---

### Responding to network changes

```typescript
import NTPSync from '@ruanitto/react-native-ntp-sync';
import NetInfo from '@react-native-community/netinfo';

// Start offline — no network calls until connectivity is confirmed
const clock = new NTPSync({ startOnline: false, autoSync: false });

const unsubscribe = NetInfo.addEventListener(state => {
  clock.setIsOnline(state.isConnected ?? false);
});

// On app shutdown / component unmount
function cleanup() {
  unsubscribe();
  clock.stopAutoSync();
}
```

---

### Monitoring sync health

```typescript
import NTPSync from '@ruanitto/react-native-ntp-sync';

const clock = new NTPSync();

clock.addListener(history => {
  if (history.currentConsecutiveErrorCount > 3) {
    console.warn('NTP sync struggling — check connectivity');
  }

  const drift = history.deltas.at(-1)?.dt ?? 0;
  console.log(`Clock drift: ${drift}ms`);
});
```

---

### Manual sync on app foreground (React Native AppState)

By default, `appStateSync: true` handles this automatically. If you disabled it, you can wire it up manually:

```typescript
import { AppState } from 'react-native';
import NTPSync from '@ruanitto/react-native-ntp-sync';

const clock = new NTPSync({ appStateSync: false });

AppState.addEventListener('change', nextState => {
  if (nextState === 'active') {
    clock.syncTime(); // re-sync when app comes back to foreground
  }
});
```

---

## Testing

```sh
npm test
npm run test:coverage
```

Tests use Jest with a full mock of `react-native-udp`, covering NTP packet parsing, round-trip compensation, server validation, server rotation, monotonic anchor immunity to device clock changes, deep-sleep handling (sleep-aware monotonic clock), legacy-delta rejection on import, offline reliability, secure monotonic-based delta import, maxSkewMs protection against rogue servers, and all public API methods (86 tests).

---

## Types

```typescript
type NtpServer = {
  server: string;
  port: number;
};

type MonotonicClock = 'uptime' | 'elapsed';
// 'uptime'  = SystemClock.uptimeMillis / performance.now() — pauses during deep sleep (pre-2.0.0)
// 'elapsed' = SystemClock.elapsedRealtime / CACurrentMediaTime — includes deep sleep (2.0.0+)

type Delta = {
  dt: number;         // delta between NTP and local time (ms)
  ntp: number;        // NTP server time (Unix ms)
  monotonic: number;  // monotonic clock at the sync instant (ms)
  clock: MonotonicClock; // 'elapsed' in 2.0.0+
};

type NtpDelta = {
  delta: number;
  fetchingServer?: NtpServer;
};

type DeltaImport = {
  ntp: number;        // NTP time (Unix ms) measured in a previous session
  monotonic: number;  // monotonic clock at the sync instant (boot-based)
  clock?: MonotonicClock; // optional — deltas without it ('uptime') are discarded on import
};

type Config = {
  autoSync: boolean;
  startOnline: boolean;
  history: number;
  servers: NtpServer[];
  syncInterval: number;
  syncOnCreation: boolean;
  syncTimeout: number;
  appStateSync: boolean;
  maxSkewMs: number; // max allowed clock skew (ms) — rejects rogue server deltas
};
```

---

## Dependencies

- [buffer](https://www.npmjs.com/package/buffer)
- [react-native-udp](https://www.npmjs.com/package/react-native-udp)

## License

MIT
