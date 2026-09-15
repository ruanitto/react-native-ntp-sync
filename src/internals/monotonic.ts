import { NativeModules } from 'react-native';

// Clock semantics of the monotonic source currently in use. On Android/iOS the
// native module reads SystemClock.elapsedRealtime() / CACurrentMediaTime(),
// which INCLUDE deep sleep — unlike performance.now() (SystemClock.uptimeMillis
// on Android's Hermes), which pauses while the device sleeps.
export const MONOTONIC_CLOCK = 'elapsed' as const;

type MonotonicClockModule = {
  now: () => number;
};

/**
 * Default monotonic source: prefers the native `RNNtpMonotonicClock` module
 * (sleep-aware), falling back to `performance.now()` on platforms without it
 * (web, or RN apps that have not rebuilt their native code).
 */
const defaultSource = (): number => {
  const nativeModule = NativeModules.RNNtpMonotonicClock as
    | MonotonicClockModule
    | undefined;

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
