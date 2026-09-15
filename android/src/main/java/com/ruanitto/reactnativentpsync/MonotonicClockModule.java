package com.ruanitto.reactnativentpsync;

import android.os.SystemClock;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

import java.util.Map;
import java.util.HashMap;

/**
 * Sleep-aware monotonic clock.
 *
 * Returns SystemClock.elapsedRealtime() — milliseconds since boot, including
 * time spent in deep sleep, immune to wall-clock manipulation and reset on
 * reboot. Unlike performance.now() on Hermes (SystemClock.uptimeMillis),
 * elapsedRealtime keeps advancing while the device sleeps, so NTP projections
 * stay accurate after the app was suspended overnight.
 */
public class MonotonicClockModule extends ReactContextBaseJavaModule {

  public static final String NAME = "RNNtpMonotonicClock";

  public MonotonicClockModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @Override
  public String getName() {
    return NAME;
  }

  @Override
  public Map<String, Object> getConstants() {
    final Map<String, Object> constants = new HashMap<>();
    constants.put("clock", "elapsed");
    return constants;
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  public double now() {
    return SystemClock.elapsedRealtime();
  }
}
