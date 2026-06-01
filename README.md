# @ruanitto/react-native-ntp-sync

> Forked from [@luneo7/react-native-ntp-sync](https://github.com/luneo7/react-native-ntp-sync)

React Native NTP client that fetches accurate time from the internet and keeps your app's clock in sync — regardless of the device's local clock drift.

**How it works:**

1. Sends an NTP request to a configurable list of servers.
2. Compensates for network round-trip delay using the standard RFC 5905 offset formula: `((T2−T1) + (T3−T4)) / 2`.
3. Validates the server response (stratum, synchronization status, timestamp sanity).
4. Stores a rolling history of deltas and uses the **median** to compute corrected time — outliers from unstable networks are automatically rejected.
5. Rotates to the next server on failure and retries automatically.

---

## Installation

```sh
npm install @ruanitto/react-native-ntp-sync react-native-udp
```

On iOS, run pod install after installing:

```sh
cd ios && pod install
```

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

The value is computed as `Date.now() + median(deltas)`. If no sync has occurred yet, falls back to `Date.now()`.

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

Fetches a single delta from the current NTP server without updating history. Returns `{ delta: 0 }` when offline.

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
| `deltas` | `Delta[]` | Rolling list of `{ dt, ntp }` samples (max `history` entries) |
| `errors` | `object[]` | Rolling list of sync errors (max `history` entries) |
| `isInErrorState` | `boolean` | `true` if last sync failed |
| `lastSyncTime` | `number \| null` | Local time of last successful sync (ms) |
| `lastNtpTime` | `number \| null` | NTP time of last successful sync (ms) |
| `lastError` | `object \| null` | Last error details |
| `currentConsecutiveErrorCount` | `number` | Errors since last success |
| `maxConsecutiveErrorCount` | `number` | Peak consecutive error streak |
| `lifetimeErrorCount` | `number` | Total errors since creation |

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

```typescript
import { AppState } from 'react-native';
import NTPSync from '@ruanitto/react-native-ntp-sync';

const clock = new NTPSync();

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

Tests use Jest with a full mock of `react-native-udp`, covering NTP packet parsing, round-trip compensation, server validation, server rotation, and all public API methods.

---

## Types

```typescript
type NtpServer = {
  server: string;
  port: number;
};

type Delta = {
  dt: number;   // delta between NTP and local time (ms)
  ntp: number;  // NTP server time (Unix ms)
};

type NtpDelta = {
  delta: number;
  fetchingServer?: NtpServer;
};

type Config = {
  autoSync: boolean;
  startOnline: boolean;
  history: number;
  servers: NtpServer[];
  syncInterval: number;
  syncOnCreation: boolean;
  syncTimeout: number;
};
```

---

## Dependencies

- [buffer](https://www.npmjs.com/package/buffer)
- [react-native-udp](https://www.npmjs.com/package/react-native-udp)

## License

MIT
