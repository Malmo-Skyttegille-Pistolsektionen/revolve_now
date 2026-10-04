import net from 'node:net';

import { expect, test } from '@playwright/test';

import { resetDevice } from './device';

/**
 * A client that vanishes mid-body must not take the device down.
 *
 * `httpd_req_recv()` returns 0 on a peer FIN. The vendored body reader used to
 * loop on that forever, starving the idle task until the task watchdog
 * panicked the device (5 s, `CONFIG_ESP_TASK_WDT_PANIC`). A browser tab closed
 * during an upload does exactly this.
 */

const BASE = new URL(process.env.RT_E2E_BASE_URL ?? 'http://localhost:8080');

/** Promise that settles once the server has closed or reset the socket, or the wait runs out. */
function truncatedPost(path: string, declared: number, sent: number): Promise<void> {
  return new Promise((resolve) => {
    const socket = net.connect(Number(BASE.port || 80), BASE.hostname, () => {
      socket.write(
        `POST ${path} HTTP/1.1\r\nHost: ${BASE.host}\r\nContent-Type: application/json\r\n` +
          `Content-Length: ${declared}\r\n\r\n` +
          '{'.padEnd(sent, ' '),
      );
      // Half-close: the device sees an orderly FIN with the body unfinished.
      socket.end();
    });
    socket.on('error', () => resolve());
    socket.on('close', () => resolve());
    setTimeout(() => {
      socket.destroy();
      resolve();
    }, 3_000);
  });
}

test.beforeEach(async ({ request }) => {
  await resetDevice(request);
});

test('a body cut short by the client does not wedge or reboot the device', async ({ request }) => {
  const before = (await (await request.get('/api/v2/diagnostics/info')).json()) as { uptimeSeconds: number };

  await truncatedPost('/api/v2/programs/start', 4_096, 64);

  // Longer than the 5 s watchdog: a spin would have panicked by now.
  await new Promise((resolve) => setTimeout(resolve, 8_000));

  const response = await request.get('/api/v2/diagnostics/info');
  expect(response.ok()).toBeTruthy();
  const after = (await response.json()) as { uptimeSeconds: number };
  expect(after.uptimeSeconds).toBeGreaterThanOrEqual(before.uptimeSeconds);
});
