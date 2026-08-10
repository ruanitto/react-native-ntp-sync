import { Buffer } from "buffer";
import dgram from "react-native-udp";

// NTP epoch offset: seconds between 1900-01-01 and 1970-01-01
const NTP_EPOCH_OFFSET_MS = 2208988800000;

export type NtpResult = {
  // Corrected NTP time (Unix ms) anchored to the monotonic clock
  time: number;
  // performance.now() at the correction instant (ms)
  monotonic: number;
};

const getError = (obj: any): Error => {
  if (!obj) {
    return new Error("unknown error");
  }
  if (!(obj instanceof Error)) {
    if (typeof obj === "string") {
      return new Error(obj);
    }
    return new Error(obj.toString());
  }
  return obj;
};

/**
 * Parse a 64-bit NTP timestamp at `offset` in `msg` → milliseconds since Unix epoch.
 */
const parseNtpTimestamp = (msg: Buffer, offset: number): number => {
  let intpart = 0;
  let fractpart = 0;
  for (let i = 0; i < 4; i++) {
    intpart = (intpart * 256 + msg[offset + i]) >>> 0;
  }
  for (let i = 4; i < 8; i++) {
    fractpart = (fractpart * 256 + msg[offset + i]) >>> 0;
  }
  return intpart * 1000 + (fractpart * 1000) / 0x100000000 - NTP_EPOCH_OFFSET_MS;
};

/**
 * Gets the current time from the NTP server, compensating for network round-trip delay.
 * @param {String} server IP/Hostname of the NTP server
 * @param {Number} port Port of the NTP server
 * @param {Number} serverTimeout Timeout in ms
 */
export const getNetworkTime = async (
  server: string,
  port: number,
  serverTimeout: number
): Promise<NtpResult> => {
  return new Promise((resolve, reject) => {
    const client = dgram.createSocket({
      type: "udp4",
      debug: false,
    });

    // NTPv3 client request packet
    const ntpData = Buffer.alloc(48);
    ntpData[0] = 0x1b; // LI=0, VN=3, Mode=3 (client)

    let errorFired = false;
    // T1: client send time on the monotonic clock (recorded just before send)
    let t1 = 0;

    const timeout = setTimeout(() => {
      errorFired = true;
      client.close();
      reject(new Error("timed out waiting for response"));
    }, serverTimeout);

    client.on("error", err => {
      if (errorFired) return;
      errorFired = true;
      clearTimeout(timeout);
      client.close();
      reject(getError(err));
    });

    client.once("message", msg => {
      // T4: client receive time on the monotonic clock
      const t4 = performance.now();
      clearTimeout(timeout);
      client.close();

      try {
        if (msg.length < 48) {
          throw new Error("NTP response too short");
        }

        // Validate: LI != 3 (unsynchronized), stratum must be 1-15
        const li = (msg[0] >> 6) & 0x3;
        const stratum = msg[1];
        if (li === 3) {
          throw new Error("NTP server is unsynchronized (LI=3)");
        }
        if (stratum === 0 || stratum > 15) {
          throw new Error(`NTP server invalid stratum: ${stratum}`);
        }

        // T2: server receive time (offset 32), T3: server transmit time (offset 40)
        const t2 = parseNtpTimestamp(msg, 32);
        const t3 = parseNtpTimestamp(msg, 40);

        // Reject implausible timestamps: NTP epoch (all zeros) or before year 2000
        const MIN_VALID_MS = Date.UTC(2000, 0, 1);
        if (t2 < MIN_VALID_MS || t3 < MIN_VALID_MS) {
          throw new Error("NTP server returned zero timestamps");
        }

        // Round-trip delay compensation: offset = ((T2-T1) + (T3-T4)) / 2
        const offset = ((t2 - t1) + (t3 - t4)) / 2;
        const correctedTime = t4 + offset;

        resolve({ time: correctedTime, monotonic: t4 });
      } catch (err) {
        reject(getError(err));
      }
    });

    client.once("listening", () => {
      t1 = performance.now(); // record T1 as close to send as possible
      client.send(ntpData, 0, ntpData.length, port, server, err => {
        if (err) {
          if (errorFired) return;
          errorFired = true;
          clearTimeout(timeout);
          client.close();
          reject(getError(err));
        }
      });
    });

    client.bind(0);
  });
};
