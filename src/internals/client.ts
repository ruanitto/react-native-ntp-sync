import { Buffer } from "buffer";
import dgram from "react-native-udp";

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
 * Gets the current time from the parsed NTP Server.
 * @param {String} server IP/Hostname of the NTP server
 * @param {Number} port Port of the NTP server
 */
export const getNetworkTime = async (
  server: string,
  port: number,
  serverTimeout: number
): Promise<Date> => {
  return new Promise((resolve, reject) => {
    const client = dgram.createSocket({
      type: "udp4",
      debug: false,
    });

    const ntpData = Buffer.alloc(48);
    ntpData[0] = 0x1b;
    for (let i = 1; i < 48; i++) {
      ntpData[i] = 0;
    }

    let errorFired = false;

    const timeout = setTimeout(() => {
      errorFired = true;
      client.close();

      reject(new Error("timed out waiting for response"));
    }, serverTimeout);

    client.on("error", err => {
      if (errorFired) {
        return;
      }

      errorFired = true;
      clearTimeout(timeout);
      client.close();
      reject(getError(err));
    });

    client.once("message", msg => {
      clearTimeout(timeout);
      client.close();

      try {
        let offsetTransmitTime = 40,
          intpart = 0,
          fractpart = 0;

        for (let i = 0; i <= 3; i++) {
          intpart = 256 * intpart + msg[offsetTransmitTime + i];
        }

        for (let i = 4; i <= 7; i++) {
          fractpart = 256 * fractpart + msg[offsetTransmitTime + i];
        }

        let milliseconds = intpart * 1000 + (fractpart * 1000) / 0x100000000;

        let date = new Date(Date.UTC(1900, 0, 1));
        date.setUTCMilliseconds(date.getUTCMilliseconds() + milliseconds);

        resolve(date);
      } catch (err) {
        reject(getError(err));
      }
    });

    client.once("listening", () => {
      client.send(ntpData, 0, ntpData.length, port, server, err => {
        if (err) {
          if (errorFired) {
            return;
          }
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
