export type Config = {
  autoSync: boolean;
  startOnline: boolean;
  history: number;
  servers: NtpServer[];
  syncInterval: number;
  syncOnCreation: boolean;
  syncTimeout: number;
};

export type NtpServer = {
  server: string;
  port: number;
};

export type Delta = {
  dt: number;
  ntp: number;
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