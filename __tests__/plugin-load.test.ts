import { describe, it, expect } from 'vitest';
import { PluginManager } from '../../../backend/plugins/plugin-manager';

describe('MQTT Decoder Plugin', () => {
  it('loads successfully', async () => {
    const module = await import('../darkride-plugin');
    const definition = module.default;

    expect(definition.name).toBe('mqtt-decoder');
    expect(definition.version).toBe('1.0.0');

    const manager = new PluginManager();
    manager.loadPlugin(definition);

    const metadata = manager.getPluginMetadata();
    expect(metadata).toHaveLength(1);
    expect(metadata[0].name).toBe('mqtt-decoder');
  });

  it('does not collide with other plugin table names', async () => {
    const module = await import('../darkride-plugin');
    const manager = new PluginManager();
    manager.loadPlugin(module.default);
    expect(() => manager.validateTableNames()).not.toThrow();
  });
});
