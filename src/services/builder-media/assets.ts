import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';
import type { MediaFile, MediaJob, MediaScope, MediaStore } from './contracts.ts';
import { boundedBytes } from './gateway.ts';
import type { ProjectSandbox } from '../sandbox/project-sandbox.ts';

const BUCKET = 'coden-generated-media';
const MAX_FILE = 20 * 1024 * 1024;
const fileId = (job: string, index: number) => {
  const hash = createHash('sha256').update(`${job}:${index}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};
async function cleanVideo(bytes: Uint8Array) {
  if (!ffmpeg) throw new Error('MEDIA_VIDEO_OPTIMIZER_UNAVAILABLE');
  const dir = await mkdtemp(path.join(tmpdir(), 'coden-media-'));
  try {
    const input = path.join(dir, 'input'); const output = path.join(dir, 'output.mp4'); await writeFile(input, bytes);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpeg as string, ['-nostdin', '-v', 'error', '-i', input, '-map_metadata', '-1', '-an', '-t', '10', '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease', '-c:v', 'libx264', '-crf', '27', '-movflags', '+faststart', '-y', output], { windowsHide: true, stdio: 'ignore' });
      const timer = setTimeout(() => { child.kill(); reject(new Error('MEDIA_VIDEO_OPTIMIZATION_TIMEOUT')); }, 120_000);
      child.once('error', () => { clearTimeout(timer); reject(new Error('MEDIA_VIDEO_OPTIMIZATION_FAILED')); });
      child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('MEDIA_VIDEO_OPTIMIZATION_FAILED')); });
    });
    const posterPath = path.join(dir, 'poster.webp');
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpeg as string, ['-nostdin','-v','error','-i',output,'-frames:v','1','-map_metadata','-1','-y',posterPath], { windowsHide: true, stdio: 'ignore' });
      const timer = setTimeout(() => { child.kill(); reject(new Error('MEDIA_VIDEO_OPTIMIZATION_TIMEOUT')); }, 30_000);
      child.once('error', () => { clearTimeout(timer); reject(new Error('MEDIA_VIDEO_OPTIMIZATION_FAILED')); });
      child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('MEDIA_VIDEO_OPTIMIZATION_FAILED')); });
    });
    return { bytes: new Uint8Array(await readFile(output)), poster: new Uint8Array(await readFile(posterPath)) };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export class MediaAssetStorage {
  constructor(private client: () => any, private store: MediaStore, private sandbox: (projectId: string) => ProjectSandbox) {}
  async persist(job: MediaJob, index: number, result: { bytes?: Uint8Array; url?: string }): Promise<MediaFile> {
    let bytes = result.bytes;
    if (!bytes && result.url) {
      const url = new URL(result.url);
      if (url.protocol !== 'https:' || !/(^|\.)fal\.(media|ai|run)$/.test(url.hostname)) throw new Error('MEDIA_DOWNLOAD_UNAVAILABLE');
      bytes = await boundedBytes(await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(90_000) }));
    }
    if (!bytes?.length || bytes.length > 25 * 1024 * 1024) throw new Error('MEDIA_FILE_INVALID');
    // Re-encoding removes metadata and rejects active SVG/HTML masquerading as an image.
    if (/^\s*</.test(Buffer.from(bytes.subarray(0, 512)).toString('utf8'))) throw new Error('MEDIA_FILE_INVALID');
    const video = job.model.kind === 'video' ? await cleanVideo(bytes) : undefined;
    const cleaned = video?.bytes || new Uint8Array(await sharp(bytes, { limitInputPixels: 32_000_000 }).resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer());
    if (!cleaned.length || cleaned.length > MAX_FILE) throw new Error('MEDIA_FILE_TOO_LARGE');
    const id = fileId(job.id, index); const extension = job.model.kind === 'image' ? 'webp' : 'mp4';
    const storagePath = `${job.userId}/${job.projectId}/${id}.${extension}`;
    const db = this.client(); if (!db) throw new Error('MEDIA_STORAGE_UNAVAILABLE');
    const upload = await db.storage.from(BUCKET).upload(storagePath, cleaned, { contentType: job.model.kind === 'image' ? 'image/webp' : 'video/mp4', upsert: true });
    if (upload.error) throw new Error('MEDIA_STORAGE_UNAVAILABLE');
    let poster: MediaFile['poster'];
    if (video) {
      const posterBytes = new Uint8Array(await sharp(video.poster).webp({ quality: 80 }).toBuffer());
      const posterStorage = job.userId + '/' + job.projectId + '/' + id + '-poster.webp';
      const uploaded = await db.storage.from(BUCKET).upload(posterStorage, posterBytes, { contentType: 'image/webp', upsert: true });
      if (uploaded.error) throw new Error('MEDIA_STORAGE_UNAVAILABLE');
      poster = { path: 'public/assets/generated/' + id + '-poster.webp', storagePath: posterStorage, bytes: posterBytes.length, sha256: createHash('sha256').update(posterBytes).digest('hex') };
    }
    return { id, path: `public/assets/generated/${id}.${extension}`, storagePath, kind: job.model.kind,
      mime: job.model.kind === 'image' ? 'image/webp' : 'video/mp4', bytes: cleaned.length,
      sha256: createHash('sha256').update(cleaned).digest('hex'), jobId: job.id, ...(poster ? { poster } : {}) };
  }
  async entries(scope: Pick<MediaScope, 'projectId' | 'userId'>) {
    const entries: Array<{ path: string; bytes: Uint8Array }> = [];
    for (const file of await this.store.files(scope)) {
      for (const part of [file, ...(file.poster ? [file.poster] : [])]) {
        if (!/^public\/assets\/generated\/[a-f0-9-]+(?:-poster)?\.(webp|mp4)$/.test(part.path) || !part.storagePath.startsWith(scope.userId + '/' + scope.projectId + '/')) throw new Error('MEDIA_PATH_INVALID');
        const db = this.client(); if (!db) throw new Error('MEDIA_STORAGE_UNAVAILABLE');
        const download = await db.storage.from(BUCKET).download(part.storagePath);
        if (download.error || !download.data) throw new Error('MEDIA_STORAGE_UNAVAILABLE');
        const bytes = new Uint8Array(await download.data.arrayBuffer());
        if (bytes.length !== part.bytes || createHash('sha256').update(bytes).digest('hex') !== part.sha256) throw new Error('MEDIA_INTEGRITY_FAILED');
        entries.push({ path: part.path, bytes });
      }
    }
    return entries;
  }
  async materialize(scope: Pick<MediaScope, 'projectId' | 'userId'>) {
    const sandbox = this.sandbox(scope.projectId);
    for (const file of await this.entries(scope)) await sandbox.writeBinaryAsset(file.path, file.bytes);
  }
}
