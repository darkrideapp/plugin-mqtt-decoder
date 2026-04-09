import { describe, it, expect } from 'vitest';
import { readRemainingLength, readMqttString, parseMqttPacket, parseFrame, mqttDecoder } from '../mqtt';
import type { RawFrame } from '../../../../frontend/lib/protocol-decoders/types';

/** Helper: build a Uint8Array from byte values */
function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

/** Helper: encode a UTF-8 string with 2-byte length prefix (MQTT string format) */
function mqttString(str: string): number[] {
  const encoded = new TextEncoder().encode(str);
  return [(encoded.length >> 8) & 0xff, encoded.length & 0xff, ...encoded];
}

/** Helper: encode remaining length as variable-length bytes */
function encodeRemainingLength(len: number): number[] {
  const result: number[] = [];
  do {
    let byte = len % 128;
    len = Math.floor(len / 128);
    if (len > 0) byte |= 0x80;
    result.push(byte);
  } while (len > 0);
  return result;
}

/** Helper: build a complete MQTT packet */
function mqttPacket(type: number, flags: number, payload: number[]): Uint8Array {
  const byte1 = ((type & 0x0f) << 4) | (flags & 0x0f);
  const rl = encodeRemainingLength(payload.length);
  return bytes(byte1, ...rl, ...payload);
}

/** Helper: encode to base64 */
function toBase64(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf));
}

// ── readRemainingLength ───────────────────────────────────────

describe('readRemainingLength', () => {
  it('reads single-byte length', () => {
    const [value, consumed] = readRemainingLength(bytes(42), 0);
    expect(value).toBe(42);
    expect(consumed).toBe(1);
  });

  it('reads multi-byte length (128)', () => {
    const [value, consumed] = readRemainingLength(bytes(0x80, 0x01), 0);
    expect(value).toBe(128);
    expect(consumed).toBe(2);
  });

  it('reads multi-byte length (16383)', () => {
    const [value, consumed] = readRemainingLength(bytes(0xff, 0x7f), 0);
    expect(value).toBe(16383);
    expect(consumed).toBe(2);
  });

  it('reads zero', () => {
    const [value, consumed] = readRemainingLength(bytes(0x00), 0);
    expect(value).toBe(0);
    expect(consumed).toBe(1);
  });

  it('reads with offset', () => {
    const [value, consumed] = readRemainingLength(bytes(0xff, 10), 1);
    expect(value).toBe(10);
    expect(consumed).toBe(1);
  });
});

// ── readMqttString ────────────────────────────────────────────

describe('readMqttString', () => {
  it('reads a simple string', () => {
    const [str, consumed] = readMqttString(bytes(0, 5, 104, 101, 108, 108, 111), 0);
    expect(str).toBe('hello');
    expect(consumed).toBe(7);
  });

  it('reads an empty string', () => {
    const [str, consumed] = readMqttString(bytes(0, 0), 0);
    expect(str).toBe('');
    expect(consumed).toBe(2);
  });

  it('reads with offset', () => {
    const [str, consumed] = readMqttString(bytes(0xff, 0, 2, 104, 105), 1);
    expect(str).toBe('hi');
    expect(consumed).toBe(4);
  });
});

// ── CONNECT ───────────────────────────────────────────────────

describe('CONNECT packet', () => {
  it('parses a basic CONNECT', () => {
    const payload = [
      ...mqttString('MQTT'),  // protocol name
      4,                       // protocol version (3.1.1)
      0x02,                    // connect flags: clean session
      0, 60,                   // keepalive: 60s
      ...mqttString('my-client'),  // client ID
    ];
    const buf = mqttPacket(1, 0, payload);
    const [packet, consumed] = parseMqttPacket(buf, 0);

    expect(packet).not.toBeNull();
    expect(packet!.typeName).toBe('CONNECT');
    expect(packet!.properties['protocol']).toBe('MQTT');
    expect(packet!.properties['version']).toBe('4');
    expect(packet!.properties['keepalive']).toBe('60s');
    expect(packet!.properties['client-id']).toBe('my-client');
    expect(packet!.flagLabels).toContain('clean-session');
    expect(consumed).toBe(buf.length);
  });

  it('detects will, username, password flags', () => {
    const payload = [
      ...mqttString('MQTT'), 4,
      0xc6,  // username + password + will + clean-session
      0, 30,
      ...mqttString('test'),
    ];
    const buf = mqttPacket(1, 0, payload);
    const [packet] = parseMqttPacket(buf, 0);

    expect(packet!.flagLabels).toContain('clean-session');
    expect(packet!.flagLabels).toContain('will');
    expect(packet!.flagLabels).toContain('username');
    expect(packet!.flagLabels).toContain('password');
  });
});

// ── CONNACK ───────────────────────────────────────────────────

describe('CONNACK packet', () => {
  it('parses accepted connection', () => {
    const buf = mqttPacket(2, 0, [0x00, 0x00]);
    const [packet] = parseMqttPacket(buf, 0);

    expect(packet!.typeName).toBe('CONNACK');
    expect(packet!.properties['return-code']).toBe('0');
    expect(packet!.properties['status']).toBe('Connection Accepted');
    expect(packet!.flagLabels).not.toContain('session-present');
  });

  it('parses session-present flag', () => {
    const buf = mqttPacket(2, 0, [0x01, 0x00]);
    const [packet] = parseMqttPacket(buf, 0);

    expect(packet!.flagLabels).toContain('session-present');
  });

  it('parses rejected connection', () => {
    const buf = mqttPacket(2, 0, [0x00, 0x05]);
    const [packet] = parseMqttPacket(buf, 0);

    expect(packet!.properties['return-code']).toBe('5');
    expect(packet!.properties['status']).toBe('Not Authorized');
  });
});

// ── PUBLISH ───────────────────────────────────────────────────

describe('PUBLISH packet', () => {
  it('parses QoS 0 PUBLISH with text payload', () => {
    const topic = mqttString('sensors/temp');
    const payloadText = new TextEncoder().encode('{"value": 22.5}');
    const payload = [...topic, ...payloadText];
    const buf = mqttPacket(3, 0x00, payload); // QoS 0, no retain, no dup

    const [packet] = parseMqttPacket(buf, 0);

    expect(packet!.typeName).toBe('PUBLISH');
    expect(packet!.properties['topic']).toBe('sensors/temp');
    expect(packet!.properties['qos']).toBe('0');
    expect(packet!.body).toContain('"value": 22.5');
    expect(packet!.bodySize).toBe(payloadText.length);
    expect(packet!.flagLabels).not.toContain('retain');
    expect(packet!.flagLabels).not.toContain('dup');
  });

  it('parses QoS 1 PUBLISH with retain flag', () => {
    const topic = mqttString('status/online');
    const packetId = [0, 42]; // packet ID = 42
    const payloadText = new TextEncoder().encode('true');
    const payload = [...topic, ...packetId, ...payloadText];
    const buf = mqttPacket(3, 0x03, payload); // QoS 1 (bits 1-2 = 01) + retain (bit 0)

    const [packet] = parseMqttPacket(buf, 0);

    expect(packet!.properties['topic']).toBe('status/online');
    expect(packet!.properties['qos']).toBe('1');
    expect(packet!.properties['packet-id']).toBe('42');
    expect(packet!.body).toBe('true');
    expect(packet!.flagLabels).toContain('retain');
    expect(packet!.flagLabels).toContain('qos1');
  });

  it('parses QoS 2 PUBLISH with dup flag', () => {
    const topic = mqttString('cmd');
    const packetId = [0, 7];
    const payload = [...topic, ...packetId, ...new TextEncoder().encode('go')];
    const buf = mqttPacket(3, 0x0c, payload); // QoS 2 (bits 1-2 = 10) + dup (bit 3)

    const [packet] = parseMqttPacket(buf, 0);

    expect(packet!.properties['qos']).toBe('2');
    expect(packet!.flagLabels).toContain('dup');
    expect(packet!.flagLabels).toContain('qos2');
  });

  it('pretty-prints JSON payload', () => {
    const topic = mqttString('data');
    const json = new TextEncoder().encode('{"a":1,"b":2}');
    const payload = [...topic, ...json];
    const buf = mqttPacket(3, 0x00, payload);

    const [packet] = parseMqttPacket(buf, 0);

    expect(packet!.body).toContain('"a": 1');
    expect(packet!.body).toContain('"b": 2');
  });

  it('shows binary payload as hex', () => {
    const topic = mqttString('bin');
    const binaryPayload = [0x00, 0xff, 0x80, 0xfe];
    const payload = [...topic, ...binaryPayload];
    const buf = mqttPacket(3, 0x00, payload);

    const [packet] = parseMqttPacket(buf, 0);

    expect(packet!.body).toBe('00 ff 80 fe');
    expect(packet!.bodySize).toBe(4);
  });
});

// ── PUBACK / PUBREC / PUBREL / PUBCOMP ────────────────────────

describe('QoS handshake packets', () => {
  it('parses PUBACK', () => {
    const buf = mqttPacket(4, 0, [0, 42]);
    const [packet] = parseMqttPacket(buf, 0);
    expect(packet!.typeName).toBe('PUBACK');
    expect(packet!.properties['packet-id']).toBe('42');
  });

  it('parses PUBREC', () => {
    const buf = mqttPacket(5, 0, [0, 10]);
    const [packet] = parseMqttPacket(buf, 0);
    expect(packet!.typeName).toBe('PUBREC');
    expect(packet!.properties['packet-id']).toBe('10');
  });

  it('parses PUBREL', () => {
    const buf = mqttPacket(6, 0x02, [0, 10]);
    const [packet] = parseMqttPacket(buf, 0);
    expect(packet!.typeName).toBe('PUBREL');
    expect(packet!.properties['packet-id']).toBe('10');
  });

  it('parses PUBCOMP', () => {
    const buf = mqttPacket(7, 0, [0, 10]);
    const [packet] = parseMqttPacket(buf, 0);
    expect(packet!.typeName).toBe('PUBCOMP');
    expect(packet!.properties['packet-id']).toBe('10');
  });
});

// ── SUBSCRIBE ─────────────────────────────────────────────────

describe('SUBSCRIBE packet', () => {
  it('parses single topic subscription', () => {
    const payload = [
      0, 1,                          // packet ID = 1
      ...mqttString('home/lights'), 1,  // topic + QoS 1
    ];
    const buf = mqttPacket(8, 0x02, payload);
    const [packet] = parseMqttPacket(buf, 0);

    expect(packet!.typeName).toBe('SUBSCRIBE');
    expect(packet!.properties['packet-id']).toBe('1');
    expect(packet!.properties['topics']).toContain('home/lights (QoS 1)');
    expect(packet!.properties['topic-count']).toBe('1');
  });

  it('parses multiple topic subscriptions', () => {
    const payload = [
      0, 5,                               // packet ID = 5
      ...mqttString('a/b'), 0,            // topic 1 QoS 0
      ...mqttString('c/d'), 2,            // topic 2 QoS 2
    ];
    const buf = mqttPacket(8, 0x02, payload);
    const [packet] = parseMqttPacket(buf, 0);

    expect(packet!.properties['topic-count']).toBe('2');
    expect(packet!.properties['topics']).toContain('a/b (QoS 0)');
    expect(packet!.properties['topics']).toContain('c/d (QoS 2)');
  });
});

// ── SUBACK ────────────────────────────────────────────────────

describe('SUBACK packet', () => {
  it('parses success return codes', () => {
    const buf = mqttPacket(9, 0, [0, 5, 0, 1, 2]);
    const [packet] = parseMqttPacket(buf, 0);

    expect(packet!.typeName).toBe('SUBACK');
    expect(packet!.properties['packet-id']).toBe('5');
    expect(packet!.properties['return-codes']).toBe('QoS 0, QoS 1, QoS 2');
  });

  it('parses failure return code', () => {
    const buf = mqttPacket(9, 0, [0, 1, 0x80]);
    const [packet] = parseMqttPacket(buf, 0);

    expect(packet!.properties['return-codes']).toBe('Failure');
  });
});

// ── UNSUBSCRIBE / UNSUBACK ────────────────────────────────────

describe('UNSUBSCRIBE packet', () => {
  it('parses unsubscribe with topics', () => {
    const payload = [0, 3, ...mqttString('a/b'), ...mqttString('c/d')];
    const buf = mqttPacket(10, 0x02, payload);
    const [packet] = parseMqttPacket(buf, 0);

    expect(packet!.typeName).toBe('UNSUBSCRIBE');
    expect(packet!.properties['packet-id']).toBe('3');
    expect(packet!.properties['topics']).toContain('a/b');
    expect(packet!.properties['topics']).toContain('c/d');
  });
});

describe('UNSUBACK packet', () => {
  it('parses unsuback', () => {
    const buf = mqttPacket(11, 0, [0, 3]);
    const [packet] = parseMqttPacket(buf, 0);

    expect(packet!.typeName).toBe('UNSUBACK');
    expect(packet!.properties['packet-id']).toBe('3');
  });
});

// ── PINGREQ / PINGRESP / DISCONNECT ──────────────────────────

describe('control packets', () => {
  it('parses PINGREQ', () => {
    const buf = mqttPacket(12, 0, []);
    const [packet] = parseMqttPacket(buf, 0);
    expect(packet!.typeName).toBe('PINGREQ');
  });

  it('parses PINGRESP', () => {
    const buf = mqttPacket(13, 0, []);
    const [packet] = parseMqttPacket(buf, 0);
    expect(packet!.typeName).toBe('PINGRESP');
  });

  it('parses DISCONNECT', () => {
    const buf = mqttPacket(14, 0, []);
    const [packet] = parseMqttPacket(buf, 0);
    expect(packet!.typeName).toBe('DISCONNECT');
  });
});

// ── parseFrame ────────────────────────────────────────────────

describe('parseFrame', () => {
  it('parses a single packet from base64', () => {
    const buf = mqttPacket(12, 0, []); // PINGREQ
    const packets = parseFrame(toBase64(buf));

    expect(packets).toHaveLength(1);
    expect(packets[0].typeName).toBe('PINGREQ');
  });

  it('parses multiple packets in one frame', () => {
    const ping = mqttPacket(12, 0, []);
    const pong = mqttPacket(13, 0, []);
    const combined = new Uint8Array([...ping, ...pong]);
    const packets = parseFrame(toBase64(combined));

    expect(packets).toHaveLength(2);
    expect(packets[0].typeName).toBe('PINGREQ');
    expect(packets[1].typeName).toBe('PINGRESP');
  });

  it('returns empty for invalid base64', () => {
    expect(parseFrame('not-valid-base64!!!')).toEqual([]);
  });

  it('returns empty for empty payload', () => {
    expect(parseFrame('')).toEqual([]);
  });
});

// ── mqttDecoder.detect ────────────────────────────────────────

describe('mqttDecoder.detect', () => {
  it('detects mqtt protocol header', () => {
    expect(mqttDecoder.detect({ 'sec-websocket-protocol': 'mqtt' })).toBe(true);
  });

  it('detects case-insensitive', () => {
    expect(mqttDecoder.detect({ 'Sec-WebSocket-Protocol': 'MQTT' })).toBe(true);
  });

  it('detects mqtt in protocol list', () => {
    expect(mqttDecoder.detect({ 'sec-websocket-protocol': 'mqtt, mqttv3.1' })).toBe(true);
  });

  it('rejects non-mqtt', () => {
    expect(mqttDecoder.detect({ 'sec-websocket-protocol': 'graphql-ws' })).toBe(false);
  });

  it('rejects missing header', () => {
    expect(mqttDecoder.detect({})).toBe(false);
  });
});

// ── mqttDecoder.decodeFrames ──────────────────────────────────

describe('mqttDecoder.decodeFrames', () => {
  it('decodes binary frames into messages', () => {
    const connectPayload = [
      ...mqttString('MQTT'), 4, 0x02, 0, 60,
      ...mqttString('client1'),
    ];
    const connectBuf = mqttPacket(1, 0, connectPayload);

    const frames: RawFrame[] = [{
      id: 1,
      direction: 'send',
      opcode: 'binary',
      payload: toBase64(connectBuf),
      isBinary: true,
      payloadSize: connectBuf.length,
      timestamp: '2026-04-09T12:00:00Z',
    }];

    const messages = mqttDecoder.decodeFrames(frames);

    expect(messages).toHaveLength(1);
    expect(messages[0].typeLabel).toBe('CONNECT');
    expect(messages[0].direction).toBe('send');
    expect(messages[0].type).toBe('request');
    expect(messages[0].properties['client-id']).toBe('client1');
    expect(messages[0].rawFrameIds).toEqual([1]);
  });

  it('skips non-binary frames', () => {
    const frames: RawFrame[] = [{
      id: 1,
      direction: 'send',
      opcode: 'text',
      payload: 'hello',
      isBinary: false,
      payloadSize: 5,
      timestamp: '2026-04-09T12:00:00Z',
    }];

    expect(mqttDecoder.decodeFrames(frames)).toHaveLength(0);
  });

  it('handles multiple packets across multiple frames', () => {
    const ping = mqttPacket(12, 0, []);
    const pong = mqttPacket(13, 0, []);

    const frames: RawFrame[] = [
      { id: 1, direction: 'send', opcode: 'binary', payload: toBase64(ping), isBinary: true, payloadSize: ping.length, timestamp: '2026-04-09T12:00:00Z' },
      { id: 2, direction: 'receive', opcode: 'binary', payload: toBase64(pong), isBinary: true, payloadSize: pong.length, timestamp: '2026-04-09T12:00:01Z' },
    ];

    const messages = mqttDecoder.decodeFrames(frames);

    expect(messages).toHaveLength(2);
    expect(messages[0].typeLabel).toBe('PINGREQ');
    expect(messages[0].type).toBe('request');
    expect(messages[1].typeLabel).toBe('PINGRESP');
    expect(messages[1].type).toBe('response');
  });

  it('returns empty for empty frames', () => {
    expect(mqttDecoder.decodeFrames([])).toHaveLength(0);
  });
});
