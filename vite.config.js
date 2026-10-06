import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// While developing (`npm run dev`), answer /api/room right inside the Vite
// server, using the same code Vercel runs in production.
function localApi() {
  const mount = (middlewares, load) => {
    middlewares.use('/api/room', async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      let body = null;
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        /* bad JSON is reported by handle() */
      }
      const { handle } = await load();
      const ip = req.socket?.remoteAddress || '';
      const out = req.method === 'POST' ? await handle(body, Date.now(), { ip }) : { status: 405, json: { error: 'Use POST' } };
      res.statusCode = out.status;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(out.json));
    });
  };
  return {
    name: 'local-api',
    configureServer(server) {
      mount(server.middlewares, () => server.ssrLoadModule('/server/rooms.js'));
    },
    configurePreviewServer(server) {
      mount(server.middlewares, () => import('./server/rooms.js'));
    },
  };
}

// Give every build's service worker a unique cache name, so phones pick up
// the new version (and throw away the old files) after each deploy.
function stampServiceWorker() {
  let outDir = 'dist';
  return {
    name: 'stamp-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const file = path.join(outDir, 'sw.js');
      if (!fs.existsSync(file)) return;
      const stamp = Date.now().toString(36);
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('__BUILD__', stamp));
    },
  };
}

export default defineConfig({
  plugins: [react(), localApi(), stampServiceWorker()],
  server: { port: 5173 },
});
