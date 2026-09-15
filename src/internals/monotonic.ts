import { NativeModules } from 'react-native';
import type { MonotonicClock } from './types';

type MonotonicClockModule = {
  now: () => number;
  // Clock semantics advertised by the native module: 'elapsed' when backed by
  // SystemClock.elapsedRealtime() (Android) / mach_continuous_time() (iOS),
  // which INCLUDE deep sleep. If the platform reports anything else, the JS
  // layer must treat it as 'uptime' to avoid mislabeling the projection clock.
  clock: MonotonicClock;
};

// The native module instance is captured once at load time because the clock
// semantics it reports are the same for the whole session.
const nativeModule = NativeModules.RNNtpMonotonicClock as
  | MonotonicClockModule
  | undefined;

/**
 * Clock semantics of the monotonic source in use, reported by the native
 * module itself (Android: SystemClock.elapsedRealtime; iOS:
 * mach_continuous_time — both INCLUDE deep sleep).
 *
 * When the native module is unavailable the source falls back to
 * `performance.now()`, which is SystemClock.uptimeMillis on Android's Hermes
 * and mach_absolute_time on iOS — both PAUSE while the device sleeps. That is
 * reported as 'uptime' on purpose: deltas anchored on a sleep-blind clock
 * project a time in the past, and the JS layer discards them instead of
 * trusting a wrong value.
 *
 * Never hardcode 'elapsed' here — that mislabels the fallback and
 * reintroduces silent wrong time (deltas measured on a sleep-blind clock
 * would be accepted as sleep-aware).
 */
export const MONOTONIC_CLOCK: MonotonicClock =
  typeof nativeModule?.clock === 'string' ? nativeModule.clock : 'uptime';

/**
 * Default monotonic source: prefers the native `RNNtpMonotonicClock` module
 * (sleep-aware), falling back to `performance.now()` on platforms without it
 * (web, or RN apps that have not rebuilt their native code).
 */
const defaultSource = (): number => {
  if (nativeModule && typeof nativeModule.now === 'function') {
    return nativeModule.now();
  }

  return performance.now();
};

let monotonicSource: () => number = defaultSource;

/**
 * Current value of the monotonic clock (ms since boot). Safe to call on any
 * platform.
 */
export const monotonicNow = (): number => monotonicSource();

/**
 * TEST-ONLY: replace the monotonic source (e.g. with a fake clock) to
 * simulate deep sleep / clock manipulation.
 */
export const setMonotonicClockSource = (fn: () => number): void => {
  monotonicSource = fn;
};

/**
 * TEST-ONLY: restore the default source (native module + performance.now
 * fallback).
 */
export const resetMonotonicClockSource = (): void => {
  monotonicSource = defaultSource;
};
