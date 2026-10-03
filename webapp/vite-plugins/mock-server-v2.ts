/**
 * Dev-server adapter for the v2 mock API.
 *
 * The mock itself lives in `test/mock-server/` so tests can drive it with a
 * fake clock; this file only mounts it on the Vite dev server with real
 * timers. See that module for what the mock actually implements.
 */
import type { Plugin, ViteDevServer } from 'vite';
import type { MockServer } from '../test/mock-server/server';
import { createMockServer } from '../test/mock-server/server';

/** `create` lets a caller seed the mock and keep a handle on it (see scripts/screenshots.spec.ts). */
export function mockServerV2Plugin(create: () => MockServer = createMockServer): Plugin {
  return {
    name: 'mock-server-v2',
    configureServer(server: ViteDevServer) {
      const mock = create();

      server.middlewares.use((req, res, next) => mock.middleware(req, res, next));
      server.httpServer?.on('close', () => void mock.close());
    },
  };
}
