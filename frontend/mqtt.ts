import type { ProtocolDecoder, RawFrame, DecodedMessage } from '@darkrideapp/plugin-sdk/react';

// MQTT Control Packet Types (4-bit, upper nibble of byte 1)
const PACKET_TYPES: Record<number, string> = {
  1: 'CONNECT',
  2: 'CONNACK',
  3: 'PUBLISH',
  4: 'PUBACK',
  5: 'PUBREC',
  6: 'PUBREL',
  7: 'PUBCOMP',
  8: 'SUBSCRIBE',
  9: 'SUBACK',
  10: 'UNSUBSCRIBE',
  11: 'UNSUBACK',
  12: 'PINGREQ',
  13: 'PINGRESP',
  14: 'DISCONNECT',
};

// CONNACK return codes (MQTT 3.1.1)
const CONNACK_CODES: Record<number, string> = {
  0: 'Connection Accepted',
  1: 'Unacceptable Protocol Version',
  2: 'Identifier Rejected',
  3: 'Server Unavailable',
  4: 'Bad Username or Password',
  5: 'Not Authorized',
};

interface MqttPacket {
  type: number;
  typeName: string;
  flags: number;
  payload: Uint8Array;
  properties: Record<string, string>;
  body: string | null;
  bodySize: number;
  flagLabels: string[];
}

/**
 * Read a variable-length integer (MQTT remaining length encoding).
 * Returns [value, bytesConsumed].
 */
export function readRemainingLength(buf: Uint8Array, offset: number): [number, number] {
  let value = 0;
  let multiplier = 1;
  let index = offset;

  for (let i = 0; i < 4; i++) {
    if (index >= buf.length) return [value, index - offset];
    const byte = buf[index++];
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) break;
    multiplier *= 128;
  }

  return [value, index - offset];
}

/**
 * Read a UTF-8 string prefixed with 2-byte big-endian length.
 * Returns [string, bytesConsumed].
 */
export function readMqttString(buf: Uint8Array, offset: number): [string, number] {
  if (offset + 2 > buf.length) return ['', 2];
  const len = (buf[offset] << 8) | buf[offset + 1];
  const strBytes = buf.slice(offset + 2, offset + 2 + len);
  const str = new TextDecoder().decode(strBytes);
  return [str, 2 + len];
}

/**
 * Parse a single MQTT control packet from binary data.
 */
export function parseMqttPacket(buf: Uint8Array, offset: number): [MqttPacket | null, number] {
  if (offset >= buf.length) return [null, 0];

  const byte1 = buf[offset];
  const type = (byte1 >> 4) & 0x0f;
  const flags = byte1 & 0x0f;
  const typeName = PACKET_TYPES[type] || `UNKNOWN(${type})`;

  const [remainingLength, lenBytes] = readRemainingLength(buf, offset + 1);
  const headerSize = 1 + lenBytes;
  const totalSize = headerSize + remainingLength;

  if (offset + totalSize > buf.length) return [null, 0];

  const payload = buf.slice(offset + headerSize, offset + totalSize);
  const properties: Record<string, string> = {};
  const flagLabels: string[] = [];
  let body: string | null = null;
  let bodySize = 0;

  let pos = 0;

  switch (type) {
    case 1: { // CONNECT
      if (pos + 2 <= payload.length) {
        const [protocolName, pnLen] = readMqttString(payload, pos);
        pos += pnLen;
        properties['protocol'] = protocolName;
      }
      if (pos < payload.length) {
        properties['version'] = String(payload[pos++]);
      }
      if (pos < payload.length) {
        const connectFlags = payload[pos++];
        if (connectFlags & 0x02) flagLabels.push('clean-session');
        if (connectFlags & 0x04) flagLabels.push('will');
        if (connectFlags & 0x40) flagLabels.push('username');
        if (connectFlags & 0x80) flagLabels.push('password');
        const willQos = (connectFlags >> 3) & 0x03;
        if (willQos) properties['will-qos'] = String(willQos);
        if (connectFlags & 0x20) flagLabels.push('will-retain');
      }
      if (pos + 2 <= payload.length) {
        const keepAlive = (payload[pos] << 8) | payload[pos + 1];
        pos += 2;
        properties['keepalive'] = `${keepAlive}s`;
      }
      // Client ID
      if (pos + 2 <= payload.length) {
        const [clientId, cidLen] = readMqttString(payload, pos);
        pos += cidLen;
        properties['client-id'] = clientId;
      }
      break;
    }

    case 2: { // CONNACK
      if (payload.length >= 2) {
        if (payload[0] & 0x01) flagLabels.push('session-present');
        const code = payload[1];
        properties['return-code'] = String(code);
        properties['status'] = CONNACK_CODES[code] || `Unknown(${code})`;
      }
      break;
    }

    case 3: { // PUBLISH
      const dup = (flags >> 3) & 0x01;
      const qos = (flags >> 1) & 0x03;
      const retain = flags & 0x01;
      if (dup) flagLabels.push('dup');
      if (qos) flagLabels.push(`qos${qos}`);
      if (retain) flagLabels.push('retain');
      properties['qos'] = String(qos);

      if (pos + 2 <= payload.length) {
        const [topic, topicLen] = readMqttString(payload, pos);
        pos += topicLen;
        properties['topic'] = topic;
      }
      // Packet ID for QoS > 0
      if (qos > 0 && pos + 2 <= payload.length) {
        const packetId = (payload[pos] << 8) | payload[pos + 1];
        pos += 2;
        properties['packet-id'] = String(packetId);
      }
      // Remaining bytes are the payload
      if (pos < payload.length) {
        const pubPayload = payload.slice(pos);
        bodySize = pubPayload.length;
        try {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(pubPayload);
          // Try to pretty-print JSON
          try {
            const parsed = JSON.parse(text);
            body = JSON.stringify(parsed, null, 2);
          } catch {
            body = text;
          }
        } catch {
          // Not valid UTF-8 — show as hex
          body = Array.from(pubPayload).map(b => b.toString(16).padStart(2, '0')).join(' ');
        }
      }
      break;
    }

    case 4: case 5: case 6: case 7: { // PUBACK, PUBREC, PUBREL, PUBCOMP
      if (pos + 2 <= payload.length) {
        const packetId = (payload[pos] << 8) | payload[pos + 1];
        properties['packet-id'] = String(packetId);
      }
      break;
    }

    case 8: { // SUBSCRIBE
      if (pos + 2 <= payload.length) {
        const packetId = (payload[pos] << 8) | payload[pos + 1];
        pos += 2;
        properties['packet-id'] = String(packetId);
      }
      const topics: string[] = [];
      while (pos + 2 < payload.length) {
        const [topic, topicLen] = readMqttString(payload, pos);
        pos += topicLen;
        const qos = pos < payload.length ? payload[pos++] : 0;
        topics.push(`${topic} (QoS ${qos})`);
      }
      if (topics.length > 0) {
        properties['topics'] = topics.join(', ');
        properties['topic-count'] = String(topics.length);
      }
      break;
    }

    case 9: { // SUBACK
      if (pos + 2 <= payload.length) {
        const packetId = (payload[pos] << 8) | payload[pos + 1];
        pos += 2;
        properties['packet-id'] = String(packetId);
      }
      const codes: string[] = [];
      while (pos < payload.length) {
        const code = payload[pos++];
        codes.push(code === 0x80 ? 'Failure' : `QoS ${code}`);
      }
      if (codes.length > 0) {
        properties['return-codes'] = codes.join(', ');
      }
      break;
    }

    case 10: { // UNSUBSCRIBE
      if (pos + 2 <= payload.length) {
        const packetId = (payload[pos] << 8) | payload[pos + 1];
        pos += 2;
        properties['packet-id'] = String(packetId);
      }
      const topics: string[] = [];
      while (pos + 2 < payload.length) {
        const [topic, topicLen] = readMqttString(payload, pos);
        pos += topicLen;
        topics.push(topic);
      }
      if (topics.length > 0) {
        properties['topics'] = topics.join(', ');
      }
      break;
    }

    case 11: { // UNSUBACK
      if (pos + 2 <= payload.length) {
        const packetId = (payload[pos] << 8) | payload[pos + 1];
        properties['packet-id'] = String(packetId);
      }
      break;
    }

    // PINGREQ (12), PINGRESP (13), DISCONNECT (14) have no variable header or payload
  }

  return [{
    type,
    typeName,
    flags,
    payload,
    properties,
    body,
    bodySize,
    flagLabels,
  }, totalSize];
}

/**
 * Parse all MQTT packets from a single WebSocket frame's payload.
 * A single WS frame can contain multiple MQTT packets.
 */
export function parseFrame(base64Payload: string): MqttPacket[] {
  let buf: Uint8Array;
  try {
    const binary = atob(base64Payload);
    buf = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  } catch {
    return [];
  }

  const packets: MqttPacket[] = [];
  let offset = 0;

  while (offset < buf.length) {
    const [packet, consumed] = parseMqttPacket(buf, offset);
    if (!packet || consumed === 0) break;
    packets.push(packet);
    offset += consumed;
  }

  return packets;
}

export const mqttDecoder: ProtocolDecoder = {
  id: 'mqtt',
  name: 'MQTT',

  detect(headers: Record<string, string>): boolean {
    const protocol = headers['sec-websocket-protocol']
      || headers['Sec-WebSocket-Protocol']
      || headers['Sec-Websocket-Protocol']
      || '';
    return protocol.toLowerCase().includes('mqtt');
  },

  decodeFrames(frames: RawFrame[]): DecodedMessage[] {
    const messages: DecodedMessage[] = [];
    let messageNumber = 0;

    for (const frame of frames) {
      if (!frame.isBinary || !frame.payload) continue;

      const packets = parseFrame(frame.payload);

      for (const packet of packets) {
        const isClientToServer = frame.direction === 'send';
        messages.push({
          messageNumber: messageNumber++,
          type: isClientToServer ? 'request' : 'response',
          typeLabel: packet.typeName,
          direction: frame.direction,
          properties: packet.properties,
          body: packet.body,
          bodySize: packet.bodySize,
          timestamp: frame.timestamp,
          flags: packet.flagLabels,
          rawFrameIds: [frame.id],
        });
      }
    }

    return messages;
  },
};
