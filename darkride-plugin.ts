import { definePlugin } from '../../shared/plugins/define-plugin';

export default definePlugin({
  name: 'mqtt-decoder',
  version: '1.0.0',
  register() {
    // No backend extension points — this is a frontend-only protocol decoder.
    // The decoder is registered via frontend/plugin.ts.
  },
});
