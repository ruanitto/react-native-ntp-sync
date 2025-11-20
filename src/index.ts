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
  private tickId: number | null = null;
  private historyDetails: NtpHistory;
  private isOnline: boolean;

  private listeners = new Set<NtpHistoryChangeHandler>();

  private config: Config;

  public constructor(config?: Partial<Config>) {
    this.config = Object.assign(DEFAULT_CONFIG, config);

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
  }

  private computeAndUpdate = (ntpDate: Date): number => {
    const tempServerTime = ntpDate.getTime();
    const tempLocalTime = Date.now();
    const dt = tempServerTime - tempLocalTime;

    if (this.historyDetails.deltas.length === this.limit) {
      this.historyDetails.deltas.shift();
    }

    this.historyDetails.deltas.push({
      dt: dt,
      ntp: tempServerTime,
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
    if (this.isOnline) {
      const fetchingServer = Object.assign(
        {},
        this.historyDetails.currentServer
      );

      try {
        const ntpDate = await getNetworkTime(
          this.historyDetails.currentServer.server,
          this.historyDetails.currentServer.port,
          this.syncTimeout
        );

        const delta = this.computeAndUpdate(ntpDate);

        return {
          delta,
          fetchingServer,
        };
      } catch (err: any) {
        this.shiftServer();

        throw new NtpClientError(err, fetchingServer);
      }
    } else {
      return { delta: 0 };
    }
  };

  public getHistory = (): NtpHistory => {
    return JSON.parse(JSON.stringify(this.historyDetails)) as NtpHistory;
  };

  public getTime = () => {
    const sum = this.historyDetails.deltas.reduce((a, b) => {
      return a + b.dt;
    }, 0);

    const avg = Math.round(sum / this.historyDetails.deltas.length) || 0;

    return Date.now() + avg;
  };

  private shiftServer = () => {
    if (this.ntpServers.length > 1) {
      this.currentIndex++;
      this.currentIndex %= this.ntpServers.length;
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
    if (this.isOnline) {
      try {
        const delta = await this.getDelta();

        this.historyDetails.currentConsecutiveErrorCount = 0;
        this.historyDetails.isInErrorState = false;

        this.listeners.forEach((handler): void => handler(this.getHistory()));

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

        if (this.historyDetails.errors.length === this.limit) {
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
      }

      return false;
    }

    return false;
  };

  public addListener(listener: NtpHistoryChangeHandler) {
    this.listeners.add(listener);
  }

  // public removeListener(listener: NtpDeltaChangeHandler) {
  //   this.listeners.delete(listener);
  // };
}

export { Config, Delta, NtpDelta, NtpHistory, NtpServer, NtpClientError };
