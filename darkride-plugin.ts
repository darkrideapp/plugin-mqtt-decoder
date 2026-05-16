import { definePlugin } from '@darkrideapp/plugin-sdk';

export default definePlugin({
  name: 'mqtt-decoder',
  // No backend extension points — this is a frontend-only protocol decoder.
  // The decoder registers itself via frontend/plugin.ts.
  register() {},
});
