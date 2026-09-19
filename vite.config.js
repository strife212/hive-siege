import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Dev-only endpoint used by src/record.js: POST /__save?name=<file> writes the request body to recordings/<file>.
const saveRecordings = {
  name: 'save-recordings',
  configureServer(server) {
    server.middlewares.use('/__save', (req, res) => {
      if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
      const name = path.basename(new URL(req.url, 'http://x').searchParams.get('name') || 'capture.mp4');
      const dir = path.resolve(server.config.root, 'recordings');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, name);
      const out = fs.createWriteStream(file);
      req.pipe(out);
      out.on('finish', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ path: file })); });
      out.on('error', (e) => { res.statusCode = 500; res.end(String(e)); });
    });
  },
};

export default defineConfig({ plugins: [saveRecordings] });
