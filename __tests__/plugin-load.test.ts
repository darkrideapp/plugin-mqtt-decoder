import { describe, it, expect } from 'vitest';
import definition from '../darkride-plugin';
import { mqttDecoder } from '../frontend/mqtt';

describe('MQTT Decoder Plugin', () => {
  it('exports a valid plugin definition', () => {
    expect(definition.name).toBe('mqtt-decoder');
    // `register` is required by the SDK; verify it's present and callable.
    expect(typeof definition.register).toBe('function');
  });

  it('exports a decoder with the SDK ProtocolDecoder shape', () => {
    expect(mqttDecoder.id).toBe('mqtt');
    expect(typeof mqttDecoder.name).toBe('string');
    expect(typeof mqttDecoder.detect).toBe('function');
    expect(typeof mqttDecoder.decodeFrames).toBe('function');
  });

  it('detects MQTT via the Sec-WebSocket-Protocol header', () => {
    expect(mqttDecoder.detect({ 'sec-websocket-protocol': 'mqtt' })).toBe(true);
    expect(mqttDecoder.detect({ 'Sec-WebSocket-Protocol': 'MQTT' })).toBe(true);
    expect(mqttDecoder.detect({ 'sec-websocket-protocol': 'mqttv3.1' })).toBe(true);
    expect(mqttDecoder.detect({ 'sec-websocket-protocol': 'blip' })).toBe(false);
    expect(mqttDecoder.detect({})).toBe(false);
  });

  it('returns an empty result for an empty frame array', () => {
    expect(mqttDecoder.decodeFrames([])).toEqual([]);
  });

  it('skips non-binary frames without throwing', () => {
    const textFrame = {
      id: 1,
      direction: 'receive' as const,
      opcode: 'text',
      payload: 'hello',
      isBinary: false,
      payloadSize: 5,
      timestamp: '2026-01-01T00:00:00.000Z',
    };
    expect(mqttDecoder.decodeFrames([textFrame])).toEqual([]);
  });
});
