import compression from 'compression';

/**
 * What goes out compressed.
 *
 * Everything the default filter accepts, except two things. An event stream
 * would be buffered by the compressor until a block fills — text arriving in
 * bursts, the exact defect the streaming work removed. And a preview is the
 * generated app's own dev server, proxied, with its own encoding and an HMR
 * socket alongside.
 */
export function shouldCompress(req: any, res: any): boolean {
  if (String(req.path || req.url || '').startsWith('/preview/')) return false;
  if (String(res.getHeader?.('Content-Type') || '').includes('text/event-stream')) return false;
  if (String(req.headers?.accept || '').includes('text/event-stream')) return false;
  return compression.filter(req, res);
}

export function responseCompression() {
  return compression({ threshold: 1024, filter: shouldCompress });
}
