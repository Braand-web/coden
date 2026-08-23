import tailwindcss from '@tailwindcss/vite';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

function discoverHtmlInputs(root: string) {
  const ignored = new Set(['dist', 'node_modules', '.git', '.vscode', '.railway']);
  const inputs: Record<string, string> = {};

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignored.has(entry.name) || entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
      const relative = path.relative(root, fullPath).replace(/\\/g, '/');
      const key = relative.replace(/\/index\.html$/, '').replace(/\.html$/, '').replace(/\//g, '_') || 'main';
      inputs[key] = fullPath;
    }
  }

  walk(root);
  return inputs;
}

function normalizeRoutePath(value: string) {
  const pathname = (value.split('?')[0] || '/').replace(/\\+/g, '/');
  if (pathname === '/') return '/';
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

function codenPublicRedirects() {
  const policyPath = path.resolve(__dirname, 'config', 'public-route-policy.json');
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8')) as { redirects?: Record<string, string> };
  const redirects = new Map<string, string>();
  for (const [source, target] of Object.entries(policy.redirects || {})) {
    redirects.set(normalizeRoutePath(source), target);
    redirects.set(source.replace(/\/$/, '') || '/', target);
  }

  return {
    name: 'coden-public-redirects',
    configureServer(server: { middlewares: { use: (handler: (req: any, res: any, next: () => void) => void) => void } }) {
      server.middlewares.use((req, res, next) => {
        const target = redirects.get(normalizeRoutePath(req.url || '/'));
        if (!target) {
          next();
          return;
        }
        res.statusCode = 301;
        res.setHeader('Location', target);
        res.end();
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [codenPublicRedirects(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    build: {
      rollupOptions: {
        // @webcontainer/api is loaded dynamically at runtime only when the
        // webcontainer preview flag is enabled (browser-only, COOP/COEP required).
        // It must NOT be bundled by Rollup – it is delivered by the CDN at runtime.
        external: ['@webcontainer/api'],
        input: discoverHtmlInputs(__dirname),
        output: {
          manualChunks(id) {
            const normalized = id.replace(/\\/g, '/');
            if (normalized.includes('/node_modules/@supabase/')) return 'vendor-supabase';
            if (
              normalized.includes('/node_modules/react/') ||
              normalized.includes('/node_modules/react-dom/') ||
              normalized.includes('/node_modules/scheduler/')
            ) {
              return 'vendor-react';
            }
            if (
              normalized.includes('/node_modules/lucide-react/') ||
              normalized.includes('/node_modules/motion/') ||
              normalized.includes('/node_modules/nanoid/')
            ) {
              return 'vendor-ai-ui';
            }
            if (
              normalized.includes('/src/builder-conversation-island') ||
              normalized.includes('/src/components/ai-elements/')
            ) {
              return 'builder-chat-ui';
            }
            if (normalized.includes('/src/settings-panel')) return 'settings-panel';
          },
        },
        onwarn(warning, defaultHandler) {
          const message = String(warning.message || '');
          if (
            warning.code === 'MODULE_LEVEL_DIRECTIVE' &&
            message.includes('use client')
          ) {
            return;
          }
          if (
            message.includes("Module level directives cause errors when bundled") &&
            message.includes('use client')
          ) {
            return;
          }
          defaultHandler(warning);
        },
      },
    },
  };
});
