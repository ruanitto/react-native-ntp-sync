export type Config = {
  autoSync?: boolean;
  startOnline?: boolean;
  history?: number;
  servers?: Array<NtpServer>;
  syncInterval?: number;
  syncOnCreation?: boolean;
  syncTimeout?: number;
  callbackDelta?: (delta: NtpDelta) => void
  callbackNTPTime?: (ntpTime: number) => void
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
  deltas: Array<Delta>;
  errors: Array<Error>;
  isInErrorState: boolean;
  lastSyncTime: number | null;
  lastNtpTime: number | null;
  lastError: Error | null;
  lifetimeErrorCount: number;
  maxConsecutiveErrorCount: number;
};
