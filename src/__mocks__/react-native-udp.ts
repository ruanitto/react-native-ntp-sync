/**
 * Mock for react-native-udp.
 * Exposes `__setNextResponse` / `__setNextError` to control behavior per test.
 */

import { EventEmitter } from 'events';

// NTP epoch offset in seconds (1900 → 1970)
const NTP_EPOCH_OFFSET_S = 2208988800;

/**
 * Build a minimal valid 48-byte NTP response packet.
 * @param serverTimeMs Unix timestamp (ms) to encode as T3 (transmit time)
 * @param stratum      NTP stratum (default 2)
 */
export function buildNtpPacket(serverTimeMs: number, stratum = 2): Buffer {
  const buf = Buffer.alloc(48);

  // Byte 0: LI=0, VN=4, Mode=4 (server)
  buf[0] = 0b00_100_100; // LI=0, VN=4, Mode=4

  // Byte 1: stratum
  buf[1] = stratum;

  const ntpSeconds = serverTimeMs / 1000 + NTP_EPOCH_OFFSET_S;
  const intpart = Math.floor(ntpSeconds) >>> 0;
  const fractpart = Math.round((ntpSeconds % 1) * 0x100000000) >>> 0;

  // T2 (receive timestamp) at offset 32 — same value for simplicity
  buf.writeUInt32BE(intpart, 32);
  buf.writeUInt32BE(fractpart, 36);

  // T3 (transmit timestamp) at offset 40
  buf.writeUInt32BE(intpart, 40);
  buf.writeUInt32BE(fractpart, 44);

  return buf;
}

type SocketBehavior =
  | { type: 'response'; packet: Buffer; delayMs?: number }
  | { type: 'error'; error: Error; delayMs?: number }
  | { type: 'timeout' };

let nextBehavior: SocketBehavior = {
  type: 'response',
  packet: buildNtpPacket(Date.now()),
};

/** Call in tests to set what the next socket will emit. */
export function __setNextResponse(packet: Buffer, delayMs = 0) {
  nextBehavior = { type: 'response', packet, delayMs };
}

export function __setNextError(error: Error, delayMs = 0) {
  nextBehavior = { type: 'error', error, delayMs };
}

export function __setNextTimeout() {
  nextBehavior = { type: 'timeout' };
}

// ─── Mock socket ────────────────────────────────────────────────────────────

class MockSocket extends EventEmitter {
  private closed = false;

  bind(_port: number) {
    // Emit 'listening' via microtask so caller can attach handlers first
    Promise.resolve().then(() => {
      if (!this.closed) this.emit('listening');
    });
  }

  send(
    _data: Buffer,
    _offset: number,
    _length: number,
    _port: number,
    _address: string,
    callback?: (err: Error | null) => void,
  ) {
    if (callback) callback(null);

    const behavior = nextBehavior;

    if (behavior.type === 'timeout') {
      // Never respond — let the real timeout fire
      return;
    }

    const delay = behavior.delayMs ?? 0;

    const emit = () => {
      if (this.closed) return;
      if (behavior.type === 'response') {
        this.emit('message', behavior.packet);
      } else if (behavior.type === 'error') {
        this.emit('error', behavior.error);
      }
    };

    if (delay > 0) {
      setTimeout(emit, delay);
    } else {
      // Use microtask for zero-delay so fake timers don't block it
      Promise.resolve().then(emit);
    }
  }

  close() {
    this.closed = true;
  }
}

const dgram = {
  createSocket: jest.fn(() => new MockSocket()),
};

export default dgram;
