import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildPublicationInMicroVM, publicationRelativePath } from '../publish-isolated-build.ts';
import { applyPublicationMetadata, PublicationError, type PublicationSnapshot } from './model.ts';
import { deserializeBuiltArtifact, type BuiltPublicationArtifact, type BuiltPublicationAsset, type BuiltPublicationModule } from './cloudflare-provider.ts';

const mime = (file: string) => ({ '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.wasm': 'application/wasm' }[path.extname(file).toLowerCase()] || 'application/octet-stream');

/** No npm, shell, Wrangler or generated module runs on the platform server. */
export class IsolatedPublicationBuilder {
  constructor(readonly rootDomain: string, readonly loadRetainedArtifact?: (releaseId: string) => Promise<unknown>) {}
  async build(snapshot: PublicationSnapshot): Promise<BuiltPublicationArtifact> {
    if (snapshot.restored_from) {
      if (!this.loadRetainedArtifact) throw new Error('RETAINED_ARTIFACT_UNAVAILABLE');
      const old = deserializeBuiltArtifact(await this.loadRetainedArtifact(snapshot.restored_from));
      return { ...old, assets: (old.assets || []).map(asset => {
        if (!/\.html?$/i.test(asset.path)) return asset;
        const html = applyPublicationMetadata(new TextDecoder().decode(asset.bytes), snapshot.settings, `https://${snapshot.settings.subdomain}.${this.rootDomain}`, snapshot.id);
        return { ...asset, bytes: new TextEncoder().encode(html) };
      }) };
    }
    const runtime = snapshot.manifest.runtime;
    if (runtime !== 'static-assets' && runtime !== 'cloudflare-workers') throw new PublicationError('WORKER_RUNTIME_REQUIRED', 'Cette application nécessite un runtime serveur compatible Cloudflare Workers. Aucun serveur ne sera transformé en site statique.', 422);
    if ((snapshot.manifest.requiredServerEnv || []).some((env: any) => env.required)) throw new PublicationError('WORKER_BINDINGS_REQUIRED', 'Configurez les liaisons serveur de ce runtime Worker avant publication.', 422);
    const source = { files: Object.fromEntries(snapshot.files.map(file => [publicationRelativePath(file.path.replace(/^\//, '')), { content: file.content, encoding: file.encoding }])) };
    let entries: Array<{ path: string; bytes: Uint8Array }> = [];
    if (runtime === 'static-assets' && !source.files['package.json']) {
      if (!source.files['index.html'] || snapshot.files.some(file => /\.(?:tsx?|jsx)$/.test(file.path))) throw new PublicationError('BUILD_PACKAGE_REQUIRED', 'Un package de construction est requis pour ce projet.', 422);
      entries = snapshot.files.map(file => ({ path: publicationRelativePath(file.path), bytes: Uint8Array.from(Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8')) }));
    } else {
      const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coden-publish-v2-'));
      try {
        const directory = await buildPublicationInMicroVM(source, { projectId: snapshot.project_id, slug: snapshot.project_id, workDir, outputDirectory: snapshot.manifest.outputDirectory, publicEnv: snapshot.public_env, runtime });
        const walk = async (dir: string) => {
          for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
            const absolute = path.join(dir, entry.name);
            if (entry.isDirectory()) await walk(absolute);
            else if (entry.isFile()) entries.push({ path: publicationRelativePath(path.relative(directory, absolute).split(path.sep).join('/')), bytes: Uint8Array.from(await fs.readFile(absolute)) });
            else throw new Error('UNSAFE_BUILD_ENTRY');
          }
        };
        await walk(directory);
      } finally {
        // Only this mkdtemp-owned path is recursively removed; never project files.
        const resolved = path.resolve(workDir);
        if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('coden-publish-v2-')) await fs.rm(resolved, { recursive: true, force: true });
      }
    }
    const url = `https://${snapshot.settings.subdomain}.${this.rootDomain}`;
    const asset = (entry: typeof entries[number], name = entry.path): BuiltPublicationAsset => {
      let bytes = entry.bytes;
      if (/\.html?$/i.test(name)) {
        const html = applyPublicationMetadata(new TextDecoder().decode(bytes), snapshot.settings, url, snapshot.id);
        bytes = new TextEncoder().encode(html);
      }
      return { path: `/${name}`, contentType: mime(name), bytes };
    };
    if (runtime === 'static-assets') return { runtime, assets: entries.map(e => asset(e)), notFoundHandling: 'single-page-application' };
    // Explicit convention for a prebundled Worker: output/server/index.mjs and
    // output/public/*. No inference or destructive conversion of Node/SSR code.
    const main = entries.find(e => e.path === 'server/index.mjs' || e.path === 'server/index.js');
    if (!main) throw new PublicationError('WORKER_BUNDLE_REQUIRED', 'La construction Worker doit produire server/index.mjs (ou .js) et les assets dans public/.', 422);
    const modules: BuiltPublicationModule[] = entries.filter(e => e.path.startsWith('server/')).map(e => ({ name: e.path.slice(7), bytes: e.bytes, type: /\.wasm$/i.test(e.path) ? 'wasm' : /\.[cm]?js$/i.test(e.path) ? 'esm' : 'data' }));
    return { runtime, mainModule: main.path.slice(7), modules, assets: entries.filter(e => e.path.startsWith('public/')).map(e => asset(e, e.path.slice(7))), assetsBinding: 'ASSETS', compatibilityFlags: ['nodejs_compat'], notFoundHandling: 'none' };
  }
}
