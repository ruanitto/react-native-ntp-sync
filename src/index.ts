import { Config, Delta, NtpDelta, NtpHistory, NtpServer } from "./types";

import { NtpClientError } from "./error";
import { getNetworkTime } from "./client";

export default class NTPSync {
  private ntpServers: Array<NtpServer>;
  private limit: number;
  private tickRate: number;
  private syncTimeout: number;
  private currentIndex = 0;
  private tickId: number | null = null;
  private historyDetails: NtpHistory;
  private isOnline: boolean;
  private callbackDelta: Config['callbackDelta']
  private callbackNTPTime: Config['callbackNTPTime']

  public constructor({
    servers = [
      { server: "time.google.com", port: 123 },
      { server: "time.windows.com", port: 123 },
      { server: "time.cloudflare.com", port: 123 },
      { server: "0.pool.ntp.org", port: 123 },
      { server: "1.pool.ntp.org", port: 123 },
    ],
    history = 10,
    syncInterval = 300 * 1000,
    syncTimeout = 10 * 1000,
    syncOnCreation = true,
    autoSync = true,
    startOnline = true,
    callbackDelta,
    callbackNTPTime
  }: Config = {}) {
    this.ntpServers = servers;
    this.limit = history;
    this.tickRate = syncInterval;
    this.syncTimeout = syncTimeout;
    this.callbackDelta = callbackDelta;
    this.callbackNTPTime = callbackNTPTime;

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

    this.isOnline = startOnline;

    if (syncOnCreation && startOnline) {
      this.syncTime();
    }

    if (autoSync) {
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
    return this.isOnline
  }

  public getDelta = async (): Promise<NtpDelta> => {
    if (this.isOnline) {
      const fetchingServer = Object.assign({}, this.historyDetails.currentServer);

      try {
        const ntpDate = await getNetworkTime(
          this.historyDetails.currentServer.server,
          this.historyDetails.currentServer.port,
          this.syncTimeout
        );

        if (typeof this.callbackNTPTime === 'function') {
          this.callbackNTPTime(ntpDate.getTime())
        }

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
      return { delta: 0 }
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
  }

  public syncTime = async (): Promise<boolean> => {
    if (this.isOnline) {
      try {
        const delta = await this.getDelta();

        if (typeof this.callbackDelta === 'function') {
          this.callbackDelta(delta)
        }

        this.historyDetails.currentConsecutiveErrorCount = 0;
        this.historyDetails.isInErrorState = false;
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
}

export { Config, Delta, NtpDelta, NtpHistory, NtpServer, NtpClientError };
