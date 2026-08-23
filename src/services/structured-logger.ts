// Structured JSON-line logger — dependency-free, Railway-friendly.
// Each log line is a single JSON object written to stdout (info/debug) or stderr (warn/error/fatal).

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(msg: string, ctx?: LogContext): void;
  info(msg: string, ctx?: LogContext): void;
  warn(msg: string, ctx?: LogContext): void;
  error(msg: string, ctx?: LogContext): void;
  fatal(msg: string, ctx?: LogContext): void;
  child(ctx: LogContext): Logger;
  time(label: string): () => void;
}

// ---------------------------------------------------------------------------
// Level ordering
// ---------------------------------------------------------------------------

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

// ---------------------------------------------------------------------------
// Global log level (respects LOG_LEVEL env var)
// ---------------------------------------------------------------------------

let currentLevel: LogLevel = (
  (process.env.LOG_LEVEL ?? 'info') as LogLevel
);

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'secret',
  'authorization',
  'api_key',
  'apikey', // normalised comparison
]);

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

function redact(obj: LogContext): LogContext {
  const out: LogContext = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      out[key] = '[REDACTED]';
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Error)) {
      out[key] = redact(value as LogContext);
    } else {
      out[key] = value;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Error serialization
// ---------------------------------------------------------------------------

function serializeError(err: Error): Record<string, unknown> {
  return {
    message: err.message,
    stack: err.stack,
    ...(('code' in err) ? { code: (err as any).code } : {}),
  };
}

function processContext(ctx: LogContext): LogContext {
  const out: LogContext = {};
  for (const [key, value] of Object.entries(ctx)) {
    if (value instanceof Error) {
      out[key] = serializeError(value);
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = processContext(value as LogContext);
    } else {
      out[key] = value;
    }
  }
  return redact(out);
}

// ---------------------------------------------------------------------------
// Core write
// ---------------------------------------------------------------------------

function writeLog(
  level: LogLevel,
  msg: string,
  mergedContext: LogContext,
): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return;

  const line: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...processContext(mergedContext),
  };

  const json = JSON.stringify(line) + '\n';

  if (level === 'warn' || level === 'error' || level === 'fatal') {
    process.stderr.write(json);
  } else {
    process.stdout.write(json);
  }
}

// ---------------------------------------------------------------------------
// Logger implementation
// ---------------------------------------------------------------------------

function buildLogger(baseContext: LogContext): Logger {
  function merge(ctx?: LogContext): LogContext {
    if (!ctx) return baseContext;
    return { ...baseContext, ...ctx };
  }

  return {
    debug(msg, ctx?) { writeLog('debug', msg, merge(ctx)); },
    info(msg, ctx?)  { writeLog('info', msg, merge(ctx)); },
    warn(msg, ctx?)  { writeLog('warn', msg, merge(ctx)); },
    error(msg, ctx?) { writeLog('error', msg, merge(ctx)); },
    fatal(msg, ctx?) { writeLog('fatal', msg, merge(ctx)); },

    child(ctx: LogContext): Logger {
      return buildLogger({ ...baseContext, ...ctx });
    },

    time(label: string): () => void {
      const start = performance.now();
      return () => {
        const elapsed = performance.now() - start;
        writeLog('info', label, { ...baseContext, duration_ms: Math.round(elapsed * 100) / 100 });
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Public factories
// ---------------------------------------------------------------------------

export function createLogger(baseContext?: LogContext): Logger {
  return buildLogger(baseContext ?? {});
}

export function createRequestLogger(req: any): Logger {
  const ctx: LogContext = {};

  // requestId — common middleware conventions
  const requestId =
    req.id ??
    req.requestId ??
    req.headers?.['x-request-id'] ??
    undefined;
  if (requestId) ctx.requestId = requestId;

  // userId — set by auth middleware
  const userId =
    req.userId ??
    req.user?.id ??
    req.auth?.userId ??
    undefined;
  if (userId) ctx.userId = userId;

  // projectId — route param or body
  const projectId =
    req.params?.projectId ??
    req.projectId ??
    undefined;
  if (projectId) ctx.projectId = projectId;

  // method + path for traceability
  if (req.method) ctx.method = req.method;
  if (req.path ?? req.url) ctx.path = req.path ?? req.url;

  return buildLogger(ctx);
}
