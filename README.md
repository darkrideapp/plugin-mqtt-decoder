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

From the DarkRide host:

- **Via the Marketplace UI** — open `/ui/marketplace`, find "MQTT Decoder", click **Install**, then click **Restart Server** when prompted.
- **Via the CLI** — `darkride plugin install @darkrideapp/plugin-mqtt-decoder` then restart the server.

The decoder activates automatically as soon as a captured WebSocket connection's `Sec-WebSocket-Protocol` header contains `mqtt`.

## Note on Raw TCP MQTT

This plugin currently decodes MQTT over WebSocket only. Raw TCP MQTT support (port 1883/8883) requires a core DarkRide feature for TCP stream capture that is planned for a future release.

## Development

```sh
git clone https://github.com/DarkRideApp/plugin-mqtt-decoder.git
cd plugin-mqtt-decoder
npm install
npm test
npm run build
```

To test against a local DarkRide checkout, drop this repo into the host's `plugins/` directory; the host's Vite glob picks it up as an in-tree workspace plugin and HMR works through `npm run dev`.

## Publishing

Tag and push to `main`; the GitHub Actions workflow publishes to npm on every `v*` tag. After publish, bump the plugin registry's `latestVersion` so the host UI offers the new version.

## License

MIT
