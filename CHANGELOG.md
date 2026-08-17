# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.4.1-beta.1] - 2026-08-17

### Added
- `maxSkewMs` config option (default `5000`) — maximum allowed clock skew in ms. Deltas exceeding this threshold are rejected to protect against rogue or buggy NTP servers that return implausible offsets (#6).

### Security
- Deltas from NTP servers with clock skew exceeding `maxSkewMs` are now rejected, preventing a single rogue response from poisoning the median and skewing the corrected time.

---

## [1.4.0] - 2026-08-10

### Added
- `importDeltas(deltas)` — import previously persisted NTP samples using raw monotonic anchors. Because `performance.now()` is boot-based on Android and iOS, no re-anchoring via `Date.now()` is needed, avoiding clock-manipulation vulnerabilities. Deltas from a previous boot are automatically discarded.
- `appStateSync` config option (default `true`) — re-syncs automatically when the app returns to the foreground, recovering from the suspended JS runtime in background.
- `dispose()` — stops the auto-sync interval and unsubscribes from `AppState`, preventing leaks on teardown.
- `maxSkewMs` config option (default `5000`) — maximum allowed clock skew in ms. Deltas exceeding this threshold are rejected to protect against rogue or buggy NTP servers that return implausible offsets (#6).

### Changed
- `getTime()` is now anchored to the **monotonic clock** (`performance.now()`): each sample is projected as `ntp + (now − monotonic)` and the median is returned. The corrected time no longer reads `Date.now()`, so it stays reliable even if the user changes the device date/time after the first sync.
- `getNetworkTime()` now captures T1/T4 with `performance.now()` (immune to manual clock changes during the request) and returns `{ time, monotonic }` instead of a `Date`.
- `Delta` type gained a `monotonic` field.
- `getDelta()` now updates history (previously documented as not doing so).

---

## [1.3.0] - 2026-06-01

### Added
- `removeListener(handler)` — removes a previously registered history change listener, preventing memory leaks.
- NTP response validation: rejects packets with LI=3 (unsynchronized server), invalid stratum (0 or >15), packets shorter than 48 bytes, and implausible timestamps (before year 2000).
- Full test suite using Jest + ts-jest with a `react-native-udp` mock that simulates real NTP packets, covering `client.ts` and all public API methods of `NTPSync` (46 tests).
- `npm test` and `npm run test:coverage` scripts.
- Comprehensive README with usage examples, API reference, and type documentation.

### Changed
- `getTime()` now uses **median** delta instead of arithmetic mean — rejects outliers caused by unstable network conditions.
- `getNetworkTime()` now applies RFC 5905 round-trip delay compensation: `offset = ((T2−T1) + (T3−T4)) / 2`, capturing `T1` just before the UDP send and `T4` on message receipt.
- `getNetworkTime()` reads both T2 (server receive, offset 32) and T3 (server transmit, offset 40) timestamps from the NTP response.
- `getHistory()` returns a shallow clone (spread) instead of a deep `JSON.parse/stringify` clone — significantly faster for frequent calls.
- Constructor now uses `{ ...DEFAULT_CONFIG, ...config }` instead of `Object.assign(DEFAULT_CONFIG, config)`, preventing mutation of the shared default config object across multiple instances.
- `tickId` typed as `ReturnType<typeof setInterval>` for correctness in React Native environments.
- `NTP_EPOCH_OFFSET_MS` extracted as a named constant replacing the implicit `Date.UTC(1900, 0, 1)` calculation.
- Removed unnecessary `for` loop zeroing `ntpData[1..47]` — `Buffer.alloc` already initializes to zero.

### Fixed
- `syncTime()` was declaring `delta` from `getDelta()` but never using it (lint warning).
- Zero-timestamp check in `getNetworkTime()` now correctly detects all-zero NTP fields (previously compared Unix ms against `0`, which was never true due to epoch offset).

---

## [1.2.0] - 2024-02-01

### Added
- `addListener(handler)` — register callbacks that receive a `NtpHistory` snapshot after every successful sync.
- `startOnline` config option to control network activity on instantiation.
- `syncOnCreation` config option to control whether an NTP sync is triggered immediately on construction.

### Changed
- Restructured internal module layout (`src/internals/`).
- Package renamed to `@ruanitto/react-native-ntp-sync`.

---

## [1.1.3] - 2023-06-01

### Fixed
- Minor stability fixes.

---

## [1.1.2] - 2023-01-01

### Changed
- Updated `react-native-udp` to latest compatible version.

---

## [1.1.1] - 2022-10-01

### Fixed
- README corrections.

---

## [1.1.0] - 2022-08-01

### Added
- `time.windows.com` added to default NTP server list.
- Reimplemented `isOnline` / `setOnline` logic.

---

## [1.0.4] - 2022-01-01

### Fixed
- Background timer compatibility fix for React Native.

---

## [1.0.3] - 2021-10-01

### Changed
- Converted codebase to TypeScript.
- Fixed UDP send-before-bind race condition.
- Added `setOnline` / offline mode support.

---

## [1.0.2] - 2021-06-01

### Added
- Initial public release as a React Native NTP client.
- UDP-based NTP packet implementation.
- Configurable server list, sync interval, and history size.
