/**
 * A request from *another* client — Node's http rather than the browser's
 * fetch, so the response's `Set-Cookie` never lands in the page's jar. The
 * mock accepts that cookie as proof of the lock, which would otherwise
 * authenticate the very requests a view-only test wants to see rejected.
 */
import http from 'http';

export interface ElsewhereResponse {
  status: number;
  body: string;
}

export function requestElsewhere(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<ElsewhereResponse> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        // No keep-alive: a test that rebinds the same port would otherwise get
        // a pooled socket pointing at the previous, now dead, listener.
        agent: false,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...extraHeaders,
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf-8');
        res.on('data', (chunk: string) => {
          text += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
      },
    );
    req.on('error', reject);
    req.end(payload ?? undefined);
  });
}

/**
 * Turns the control lock on as some other client would, and hands back its
 * token. On a device with a button that client needs a window of its own
 * (D-52): pass `pressBoot` and it asks for one first.
 */
export async function enableControlLockElsewhere(
  port: number,
  password: string,
  pressBoot?: () => unknown,
): Promise<string> {
  const window = pressBoot === undefined ? '' : await openWindowElsewhere(port, pressBoot);
  const { body } = await requestElsewhere(
    port,
    'POST',
    '/api/v2/control-lock/enable',
    { password },
    window === '' ? {} : { 'X-Config-Window': window },
  );
  return (JSON.parse(body) as { token: string }).token;
}

/** Another client asks for the configuration window and BOOT is pressed for it. */
export async function openWindowElsewhere(port: number, pressBoot: () => unknown): Promise<string> {
  const { body } = await requestElsewhere(port, 'POST', '/api/v2/config-window/request');
  pressBoot();
  return (JSON.parse(body) as { token: string }).token;
}
