import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { createNode } from '../../src/node';
import { portableTopicReplicationStrategies } from '../../src/strategies/portableReplicationStrategies';

const INFO_HASH = 'playwright-hybrid-v1';
const SETTLE_MS = 40_000;
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../../..');

type SmokeStatus = {
  readonly status: 'starting' | 'ready' | 'verified' | 'failed';
  readonly error?: string;
  readonly peerId?: string;
  readonly registrySize?: number;
  readonly connections?: number;
};

const pickWsBootstrapAddr = (addrs: ReadonlyArray<{ toString: () => string }>, peerId: string): string => {
  const ws = addrs.map((addr) => addr.toString()).find((addr) => addr.includes('/ws'));
  if (!ws) {
    throw new Error(`No /ws multiaddr on bootstrap. Got: ${addrs.map((addr) => addr.toString()).join(', ')}`);
  }
  return ws.includes('/p2p/') ? ws : `${ws}/p2p/${peerId}`;
};

const bundleHarness = async (): Promise<string> => {
  const result = await build({
    absWorkingDir: repoRoot,
    entryPoints: [join(here, 'harness.ts')],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    conditions: ['browser', 'development', 'import'],
    mainFields: ['browser', 'module', 'main'],
    logLevel: 'silent',
    define: {
      global: 'globalThis',
      'process.env.NODE_DEBUG': 'undefined',
      'process.env.NODE_ENV': '"development"',
    },
    banner: {
      js: 'var process = globalThis.process || { env: {} };',
    },
    inject: [join(here, 'buffer-shim.ts')],
  });
  const file = result.outputFiles[0];
  if (!file) throw new Error('esbuild produced no harness output');
  return file.text;
};

const serve = (
  files: Readonly<Record<string, { readonly body: string; readonly type: string }>>,
): Promise<{ readonly url: string; readonly close: () => Promise<void> }> =>
  new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const file = files[url.pathname];
      if (!file) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': file.type, 'cache-control': 'no-store' });
      res.end(file.body);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') {
        reject(new Error('failed to bind HTTP server'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
  });

test('Chromium createBrowserNode dials Node /ws bootstrap and lands in PeerRegistry', async ({ page }) => {
  const bootstrap = await createNode(
    INFO_HASH,
    'pw-bootstrap-seed',
    {
      network: {
        listenAddrs: ['/ip4/127.0.0.1/tcp/0', '/ip4/127.0.0.1/tcp/0/ws'],
        bootstrapPeers: [],
      },
      discovery: { enableMdns: false },
    },
    portableTopicReplicationStrategies(),
  );

  await bootstrap.start();
  const bootstrapPeerId = bootstrap.components.libp2p.peerId.toString();
  const bootstrapAddr = pickWsBootstrapAddr(bootstrap.components.libp2p.getMultiaddrs(), bootstrapPeerId);

  const harnessJs = await bundleHarness();
  const server = await serve({
    '/': {
      type: 'text/html; charset=utf-8',
      body: `<!doctype html><html><body>
<pre id="status">starting</pre>
<script>
window.__dechat = { status: 'starting' };
window.addEventListener('error', (e) => {
  window.__dechat = { status: 'failed', error: String(e.error || e.message) };
});
window.addEventListener('unhandledrejection', (e) => {
  window.__dechat = { status: 'failed', error: String(e.reason) };
});
</script>
<script type="module" src="/harness.js"></script>
</body></html>`,
    },
    '/harness.js': { type: 'text/javascript; charset=utf-8', body: harnessJs },
  });

  const pageErrors: string[] = [];
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') pageErrors.push(`console: ${msg.text()}`);
  });

  try {
    const target = `${server.url}/?bootstrap=${encodeURIComponent(bootstrapAddr)}&bootstrapPeerId=${encodeURIComponent(bootstrapPeerId)}&infoHash=${encodeURIComponent(INFO_HASH)}`;
    await page.goto(target);

    await page.waitForFunction(
      () => {
        const state = (globalThis as typeof globalThis & { __dechat?: SmokeStatus }).__dechat;
        return state?.status === 'verified' || state?.status === 'failed';
      },
      { timeout: SETTLE_MS },
    );

    const result = await page.evaluate((): SmokeStatus => {
      const state = (globalThis as typeof globalThis & { __dechat?: SmokeStatus }).__dechat;
      if (!state) return { status: 'failed', error: 'no __dechat state' };
      return state;
    });

    expect(result, `${JSON.stringify(result)} pageErrors=${JSON.stringify(pageErrors)}`).toMatchObject({
      status: 'verified',
    });
    expect(bootstrap.components.peerRegistry.getPeers()).toContain(result.peerId);
  } finally {
    await server.close();
    await bootstrap.stop();
  }
});
