import { pluginRegistry } from '../../../frontend/lib/plugin-registry';
import { mqttDecoder } from './mqtt';

pluginRegistry.registerDecoders('mqtt-decoder', [mqttDecoder]);
