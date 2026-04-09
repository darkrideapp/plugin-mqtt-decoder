# MQTT Protocol Decoder for DarkRide

Decodes [MQTT](https://mqtt.org/) control packets from WebSocket frames in the DarkRide traffic inspector.

MQTT is a lightweight publish/subscribe messaging protocol widely used in IoT, mobile apps, and real-time systems. This plugin decodes MQTT packets carried over WebSocket connections, showing message types, topics, payloads, QoS levels, and flags.

## Features

- Detects MQTT protocol from `Sec-WebSocket-Protocol` header
- Decodes all MQTT 3.1.1 control packet types:
  - **CONNECT / CONNACK** — connection setup with client ID, credentials, keepalive
  - **PUBLISH** — topic, QoS, retain, payload (auto-formats JSON)
  - **SUBSCRIBE / SUBACK** — topic filters with QoS levels
  - **UNSUBSCRIBE / UNSUBACK**
  - **PUBACK / PUBREC / PUBREL / PUBCOMP** — QoS 1/2 handshake
  - **PINGREQ / PINGRESP** — keepalive
  - **DISCONNECT**
- Pretty-prints JSON payloads, hex dump for binary
- Handles multiple MQTT packets in a single WebSocket frame

## Install

```bash
cd plugins
git clone https://github.com/darkrideapp/plugin-mqtt-decoder.git mqtt-decoder
cd ..
npm install
```

Restart DarkRide. The MQTT decoder will automatically activate when MQTT-over-WebSocket traffic is captured.

## Note on Raw TCP MQTT

This plugin currently decodes MQTT over WebSocket only. Raw TCP MQTT support (port 1883/8883) requires a core DarkRide feature for TCP stream capture that is planned for a future release.

## License

MIT
