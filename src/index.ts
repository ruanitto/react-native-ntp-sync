import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';

import type {
  Config,
  Delta,
  NtpDelta,
  NtpHistoryChangeHandler,
  NtpHistory,
  NtpServer,
} from './internals/types';

import { NtpClientError } from './internals/error';
import { getNetworkTime } from './internals/client';
import DEFAULT_CONFIG from './internals/default-config';

export default class NTPSync {
  private ntpServers: NtpServer[];
  private limit: number;
  private tickRate: number;
  private syncTimeout: number;
  private currentIndex = 0;
  private tickId: ReturnType<typeof setInterval> | null = null;
  private historyDetails: NtpHistory;
  private isOnline: boolean;
  private appStateSub: { remove: () => void } | null = null;

  private listeners = new Set<NtpHistoryChangeHandler>();

  private config: Config;

  public constructor(config?: Partial<Config>) {
    // Spread to avoid mutating the shared DEFAULT_CONFIG object
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.ntpServers = this.config.servers;
    this.limit = this.config.history;
    this.tickRate = this.config.syncInterval;
    this.syncTimeout = this.config.syncTimeout;

    this.historyDetails = {
      currentConsecutiveErrorCount: 0,
      currentServer: this.ntpServers[this.currentIndex],
      deltas: [],
      errors: [],
      isInErrorState: false,
      lastSyncTime: null,
      lastNtpTime: null,
      lastError: null,
      lifetimeErrorCount: 0,
      maxConsecutiveErrorCount: 0,
    };

    this.isOnline = this.config.startOnline;

    if (this.config.syncOnCreation && this.config.startOnline) {
      this.syncTime();
    }

    if (this.config.autoSync) {
      this.startAutoSync();
    }

    if (this.config.appStateSync) {
      const sub = AppState.addEventListener(
        'change',
        this.handleAppStateChange,
      ) as unknown as { remove: () => void };
      // Older React Native versions may return void here
      if (sub && typeof sub.remove === 'function') {
        this.appStateSub = sub;
      }
    }
  }

  /**
   * Re-sync when the app returns to the foreground. While backgrounded the JS
   * runtime is suspended, so the monotonic clock stops advancing; a fresh sync
   * re-anchors the corrected time.
   */
  private handleAppStateChange = (nextState: AppStateStatus) => {
    if (nextState === 'active' && this.isOnline) {
      this.syncTime();
    }
  };

  private computeAndUpdate = (ntpTime: number, monotonic: number): number => {
    const tempServerTime = ntpTime;
    const tempLocalTime = Date.now();
    const dt = tempServerTime - tempLocalTime;

    // Circular buffer: overwrite oldest entry when at capacity
    if (this.historyDetails.deltas.length >= this.limit) {
      this.historyDetails.deltas.shift();
    }

    this.historyDetails.deltas.push({
      dt,
      ntp: tempServerTime,
      monotonic,
    });

    this.historyDetails.lastSyncTime = tempLocalTime;
    this.historyDetails.lastNtpTime = tempServerTime;

    return dt;
  };

  public setIsOnline(isOnline: boolean) {
    if (isOnline && !this.isOnline) {
      this.isOnline = true;
      this.syncTime();
      this.startAutoSync();
    } else if (!isOnline && this.isOnline) {
      this.stopAutoSync();
      this.isOnline = false;
    }
  }

  public getIsOnline() {
    return this.isOnline;
  }

  public getDelta = async (): Promise<NtpDelta> => {
    if (!this.isOnline) {
      return { delta: 0 };
    }

    const fetchingServer = { ...this.historyDetails.currentServer };

    try {
      const { time, monotonic } = await getNetworkTime(
        this.historyDetails.currentServer.server,
        this.historyDetails.currentServer.port,
        this.syncTimeout
      );

      const delta = this.computeAndUpdate(time, monotonic);

      return { delta, fetchingServer };
    } catch (err: any) {
      this.shiftServer();
      throw new NtpClientError(err, fetchingServer);
    }
  };

  public getHistory = (): NtpHistory => {
    // Shallow-clone top level + spread arrays to avoid external mutation
    return {
      ...this.historyDetails,
      deltas: [...this.historyDetails.deltas],
      errors: [...this.historyDetails.errors],
    };
  };

  /**
   * Returns corrected current time (ms since epoch).
   *
   * Each sample is projected onto the monotonic clock (`performance.now()`):
   * `ntp + (now - monotonic)`. The median of those projections rejects
   * outliers from unstable networks AND is immune to manual device clock
   * changes, because it never reads `Date.now()` after the initial sync.
   */
  public getTime = (): number => {
    const { deltas } = this.historyDetails;

    if (deltas.length === 0) {
      return Date.now();
    }

    const perfNow = performance.now();
    const projected = deltas.map(d => d.ntp + (perfNow - d.monotonic));

    const sorted = [...projected].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    return sorted.length % 2 === 0
      ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
      : sorted[mid];
  };

  private shiftServer = () => {
    if (this.ntpServers.length > 1) {
      this.currentIndex = (this.currentIndex + 1) % this.ntpServers.length;
    }

    this.historyDetails.currentServer = this.ntpServers[this.currentIndex];
  };

  public startAutoSync = () => {
    if (!this.tickId) {
      this.tickId = setInterval(() => this.syncTime(), this.tickRate);
    }
  };

  public stopAutoSync = () => {
    if (this.tickId) {
      clearInterval(this.tickId);
      this.tickId = null;
    }
  };

  public syncTime = async (): Promise<boolean> => {
    if (!this.isOnline) {
      return false;
    }

    try {
      await this.getDelta();

      this.historyDetails.currentConsecutiveErrorCount = 0;
      this.historyDetails.isInErrorState = false;

      this.listeners.forEach(handler => handler(this.getHistory()));

      return true;
    } catch (err: any) {
      const ed = {
        name: err.name,
        message: err.message,
        server: err.server,
        stack: err.stack,
        time: Date.now(),
      };

      this.historyDetails.currentConsecutiveErrorCount++;

      if (this.historyDetails.errors.length >= this.limit) {
        this.historyDetails.errors.shift();
      }

      this.historyDetails.errors.push(ed);
      this.historyDetails.isInErrorState = true;
      this.historyDetails.lastError = ed;
      this.historyDetails.lifetimeErrorCount++;

      this.historyDetails.maxConsecutiveErrorCount = Math.max(
        this.historyDetails.maxConsecutiveErrorCount,
        this.historyDetails.currentConsecutiveErrorCount
      );

      return false;
    }
  };

  public addListener(listener: NtpHistoryChangeHandler) {
    this.listeners.add(listener);
  }

  public removeListener(listener: NtpHistoryChangeHandler) {
    this.listeners.delete(listener);
  }

  /**
   * Stops the auto-sync interval and unsubscribes from AppState changes.
   * Call when tearing down to avoid memory leaks.
   */
  public dispose() {
    this.stopAutoSync();
    if (this.appStateSub) {
      this.appStateSub.remove();
      this.appStateSub = null;
    }
  }
}

export { Config, Delta, NtpDelta, NtpHistory, NtpServer, NtpClientError };
