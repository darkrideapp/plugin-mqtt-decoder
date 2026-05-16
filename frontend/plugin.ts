import { pluginRegistry } from '@darkrideapp/plugin-sdk/react';
import { mqttDecoder } from './mqtt';

pluginRegistry.registerDecoders('mqtt-decoder', [mqttDecoder]);
