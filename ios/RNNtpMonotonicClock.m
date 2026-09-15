#import "RNNtpMonotonicClock.h"
#import <QuartzCore/QuartzCore.h>

@implementation RNNtpMonotonicClock

RCT_EXPORT_MODULE()

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(now)
{
  // CACurrentMediaTime() includes time spent in sleep (mach-based clocks on
  // iOS keep advancing during sleep) and resets on reboot — matching the
  // boot-anchor semantics of the JS layer.
  return @(CACurrentMediaTime() * 1000.0);
}

@end
