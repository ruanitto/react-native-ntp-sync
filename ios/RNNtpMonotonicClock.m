#import "RNNtpMonotonicClock.h"
#import <mach/mach_time.h>

@implementation RNNtpMonotonicClock

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

/**
 * Clock semantics advertised to the JS layer.
 *
 * Only reported as "elapsed" (sleep-aware) because `now` below is backed by
 * mach_continuous_time(). If this implementation ever goes back to a clock
 * that pauses during sleep, this MUST become "uptime" — the JS layer discards
 * deltas whose clock does not match the one currently in use, and a wrong
 * label here silently produces wrong projections instead of a safe failure.
 */
- (NSDictionary *)constantsToExport
{
  return @{ @"clock": @"elapsed" };
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(now)
{
  // mach_continuous_time() has CLOCK_MONOTONIC_RAW semantics: it keeps
  // incrementing while the device is asleep and resets on reboot, matching
  // SystemClock.elapsedRealtime() on Android and the boot-anchor semantics of
  // the JS layer.
  //
  // Do NOT use CACurrentMediaTime(), mach_absolute_time() or
  // ProcessInfo.systemUptime here: all three are CLOCK_UPTIME_RAW and DO NOT
  // increment while the system is asleep (see `man clock_gettime`). With any
  // of them, `ntp + (monotonicNow() - delta.monotonic)` under-counts real time
  // by exactly the sleep accumulated since the last NTP sync, so the projected
  // time drifts into the past — seconds with the screen off, hours overnight.
  static mach_timebase_info_data_t timebase;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    mach_timebase_info(&timebase);
  });

  const double nanos =
      (double)mach_continuous_time() * (double)timebase.numer / (double)timebase.denom;

  return @(nanos / 1000000.0);
}

@end