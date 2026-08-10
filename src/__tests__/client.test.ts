import { getNetworkTime } from '../internals/client';
import {
  buildNtpPacket,
  __setNextResponse,
  __setNextError,
  __setNextTimeout,
} from '../__mocks__/react-native-udp';

describe('getNetworkTime', () => {
  const SERVER = 'time.google.com';
  const PORT = 123;
  const TIMEOUT = 5000;

  describe('successful response', () => {
    it('returns an NtpResult close to the server time encoded in the packet', async () => {
      const serverTime = Date.now();
      __setNextResponse(buildNtpPacket(serverTime));

      const result = await getNetworkTime(SERVER, PORT, TIMEOUT);

      expect(typeof result.time).toBe('number');
      expect(typeof result.monotonic).toBe('number');
      // Allow ±500ms tolerance for round-trip compensation + test execution
      expect(Math.abs(result.time - serverTime)).toBeLessThan(500);
    });

    it('anchors the result to the monotonic clock', async () => {
      __setNextResponse(buildNtpPacket(Date.now()));

      const before = performance.now();
      const result = await getNetworkTime(SERVER, PORT, TIMEOUT);
      const after = performance.now();

      expect(result.monotonic).toBeGreaterThanOrEqual(before);
      expect(result.monotonic).toBeLessThanOrEqual(after);
    });

    it('applies round-trip delay compensation (offset formula)', async () => {
      // Simulate 200ms one-way delay: server time is 100ms ahead of local
      const serverTime = Date.now() + 100;
      __setNextResponse(buildNtpPacket(serverTime), 200);

      const result = await getNetworkTime(SERVER, PORT, TIMEOUT);

      // With compensation, result should be within 50ms of actual server time
      expect(Math.abs(result.time - serverTime)).toBeLessThan(250);
    });

    it('handles stratum 1 (primary reference)', async () => {
      __setNextResponse(buildNtpPacket(Date.now(), 1));
      const result = await getNetworkTime(SERVER, PORT, TIMEOUT);
      expect(typeof result.time).toBe('number');
    });

    it('handles stratum 15 (max valid)', async () => {
      __setNextResponse(buildNtpPacket(Date.now(), 15));
      const result = await getNetworkTime(SERVER, PORT, TIMEOUT);
      expect(typeof result.time).toBe('number');
    });
  });

  describe('validation — rejects invalid packets', () => {
    it('rejects when LI=3 (server unsynchronized)', async () => {
      const packet = buildNtpPacket(Date.now());
      // Set LI=3 in byte 0: bits 7-6 = 11
      packet[0] = (packet[0] & 0x3f) | 0xc0;

      __setNextResponse(packet);

      await expect(getNetworkTime(SERVER, PORT, TIMEOUT)).rejects.toThrow(
        'NTP server is unsynchronized',
      );
    });

    it('rejects when stratum=0 (kiss-o-death)', async () => {
      __setNextResponse(buildNtpPacket(Date.now(), 0));

      await expect(getNetworkTime(SERVER, PORT, TIMEOUT)).rejects.toThrow(
        'invalid stratum',
      );
    });

    it('rejects when stratum=16 (unsynchronized)', async () => {
      __setNextResponse(buildNtpPacket(Date.now(), 16));

      await expect(getNetworkTime(SERVER, PORT, TIMEOUT)).rejects.toThrow(
        'invalid stratum',
      );
    });

    it('rejects when packet is too short', async () => {
      __setNextResponse(Buffer.alloc(20));

      await expect(getNetworkTime(SERVER, PORT, TIMEOUT)).rejects.toThrow(
        'NTP response too short',
      );
    });

    it('rejects when T3 timestamp is zero', async () => {
      const packet = buildNtpPacket(Date.now());
      // Zero out both T2 (offset 32) and T3 (offset 40)
      packet.fill(0, 32, 48);

      __setNextResponse(packet);

      await expect(getNetworkTime(SERVER, PORT, TIMEOUT)).rejects.toThrow(
        'zero timestamps',
      );
    });
  });

  describe('error handling', () => {
    it('rejects on socket error', async () => {
      __setNextError(new Error('network unreachable'));

      await expect(getNetworkTime(SERVER, PORT, TIMEOUT)).rejects.toThrow(
        'network unreachable',
      );
    });

    it('rejects on timeout', async () => {
      __setNextTimeout();

      await expect(getNetworkTime(SERVER, PORT, 100)).rejects.toThrow(
        'timed out',
      );
    }, 1000);
  });
});
