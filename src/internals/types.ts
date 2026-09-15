export type Config = {
  autoSync: boolean;
  startOnline: boolean;
  history: number;
  servers: NtpServer[];
  syncInterval: number;
  syncOnCreation: boolean;
  syncTimeout: number;
  appStateSync: boolean;
  // Maximum allowed clock skew in ms (absolute value). Deltas exceeding this
  // are rejected to protect against rogue/buggy NTP servers. Default: 5000 (5s).
  maxSkewMs: number;
};

export type NtpServer = {
  server: string;
  port: number;
};

// Clock used to measure `monotonic`. 'uptime' = SystemClock.uptimeMillis /
// performance.now() (pauses during deep sleep); 'elapsed' =
// SystemClock.elapsedRealtime / CACurrentMediaTime (includes deep sleep).
export type MonotonicClock = 'uptime' | 'elapsed';

export type Delta = {
  dt: number;
  ntp: number;
  // monotonic clock at the sync instant (ms) — projection anchor
  monotonic: number;
  clock: MonotonicClock;
};

export type NtpDelta = {
  delta: number;
  fetchingServer?: NtpServer;
};

export type NtpHistory = {
  currentConsecutiveErrorCount: number;
  currentServer: NtpServer;
  deltas: Delta[];
  errors: Error[];
  isInErrorState: boolean;
  lastSyncTime: number | null;
  lastNtpTime: number | null;
  lastError: Error | null;
  lifetimeErrorCount: number;
  maxConsecutiveErrorCount: number;
};

export type NtpHistoryChangeHandler = (delta: NtpHistory) => void

export type DeltaImport = {
  // NTP time (Unix ms) measured during a previous session
  ntp: number;
  // monotonic clock at the instant ntp was measured (boot-based, same-boot safe)
  monotonic: number;
  // Clock used to measure `monotonic`. Optional for compatibility with the
  // pre-2.0.0 format; deltas without this field ('uptime') are discarded on
  // import because the projection clock now includes deep sleep ('elapsed').
  clock?: MonotonicClock;
};