import assert from 'node:assert/strict';
import {
  createLogger,
  createRequestLogger,
  setLogLevel,
  getLogLevel,
  type LogLevel,
} from './src/services/structured-logger.ts';

// ---------------------------------------------------------------------------
// Helpers: capture stdout / stderr by replacing process.stdout/stderr.write
// ---------------------------------------------------------------------------

function captureStdout<T>(fn: () => T): { result: T; output: string } {
  let output = '';
  const original = process.stdout.write;
  process.stdout.write = ((chunk: any) => {
    output += typeof chunk === 'string' ? chunk : chunk.toString();
    return true;
  }) as any;
  try {
    const result = fn();
    return { result, output };
  } finally {
    process.stdout.write = original;
  }
}

function captureStderr<T>(fn: () => T): { result: T; output: string } {
  let output = '';
  const original = process.stderr.write;
  process.stderr.write = ((chunk: any) => {
    output += typeof chunk === 'string' ? chunk : chunk.toString();
    return true;
  }) as any;
  try {
    const result = fn();
    return { result, output };
  } finally {
    process.stderr.write = original;
  }
}

function captureBoth<T>(fn: () => T): { result: T; stdout: string; stderr: string } {
  let stdoutBuf = '';
  let stderrBuf = '';
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = ((chunk: any) => {
    stdoutBuf += typeof chunk === 'string' ? chunk : chunk.toString();
    return true;
  }) as any;
  process.stderr.write = ((chunk: any) => {
    stderrBuf += typeof chunk === 'string' ? chunk : chunk.toString();
    return true;
  }) as any;
  try {
    const result = fn();
    return { result, stdout: stdoutBuf, stderr: stderrBuf };
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
}

// ---------------------------------------------------------------------------
// Test: valid JSON output
// ---------------------------------------------------------------------------

{
  setLogLevel('debug');
  const logger = createLogger({ service: 'test' });
  const { output } = captureStdout(() => logger.info('hello world'));
  const parsed = JSON.parse(output.trim());
  assert.equal(parsed.level, 'info');
  assert.equal(parsed.msg, 'hello world');
  assert.equal(parsed.service, 'test');
  assert.ok(parsed.ts, 'should have timestamp');
  // ts should be valid ISO-8601
  assert.ok(!isNaN(Date.parse(parsed.ts)), 'ts should be valid ISO-8601');
}

// ---------------------------------------------------------------------------
// Test: log levels are respected
// ---------------------------------------------------------------------------

{
  setLogLevel('info');
  const logger = createLogger();

  // debug should be suppressed
  const { output: debugOut } = captureStdout(() => logger.debug('should not appear'));
  assert.equal(debugOut, '', 'debug should be suppressed at info level');

  // info should appear
  const { output: infoOut } = captureStdout(() => logger.info('should appear'));
  assert.ok(infoOut.length > 0, 'info should appear at info level');

  // warn goes to stderr
  const { stderr: warnOut } = captureBoth(() => logger.warn('warning'));
  const warnParsed = JSON.parse(warnOut.trim());
  assert.equal(warnParsed.level, 'warn');

  // error goes to stderr
  const { stderr: errOut } = captureBoth(() => logger.error('err'));
  const errParsed = JSON.parse(errOut.trim());
  assert.equal(errParsed.level, 'error');

  // fatal goes to stderr
  const { stderr: fatalOut } = captureBoth(() => logger.fatal('boom'));
  const fatalParsed = JSON.parse(fatalOut.trim());
  assert.equal(fatalParsed.level, 'fatal');
}

// ---------------------------------------------------------------------------
// Test: setLogLevel / getLogLevel
// ---------------------------------------------------------------------------

{
  setLogLevel('error');
  assert.equal(getLogLevel(), 'error');

  const logger = createLogger();
  const { stdout, stderr } = captureBoth(() => {
    logger.debug('no');
    logger.info('no');
    logger.warn('no');
    logger.error('yes');
  });
  assert.equal(stdout, '', 'stdout should be empty at error level');
  const lines = stderr.trim().split('\n');
  assert.equal(lines.length, 1, 'only error should appear');
  assert.equal(JSON.parse(lines[0]).msg, 'yes');

  // reset
  setLogLevel('info');
}

// ---------------------------------------------------------------------------
// Test: child loggers merge context
// ---------------------------------------------------------------------------

{
  setLogLevel('debug');
  const parent = createLogger({ service: 'api' });
  const child = parent.child({ requestId: 'req-123' });
  const grandchild = child.child({ userId: 'u-456' });

  const { output } = captureStdout(() => grandchild.info('handled'));
  const parsed = JSON.parse(output.trim());
  assert.equal(parsed.service, 'api');
  assert.equal(parsed.requestId, 'req-123');
  assert.equal(parsed.userId, 'u-456');
  assert.equal(parsed.msg, 'handled');
  setLogLevel('info');
}

// ---------------------------------------------------------------------------
// Test: redaction of sensitive fields
// ---------------------------------------------------------------------------

{
  const logger = createLogger();
  const { output } = captureStdout(() =>
    logger.info('login', {
      username: 'alice',
      password: 'hunter2',
      token: 'abc123',
      secret: 'shhh',
      authorization: 'Bearer xyz',
      api_key: 'key-1',
      apiKey: 'key-2',
    }),
  );
  const parsed = JSON.parse(output.trim());
  assert.equal(parsed.username, 'alice', 'non-sensitive field preserved');
  assert.equal(parsed.password, '[REDACTED]');
  assert.equal(parsed.token, '[REDACTED]');
  assert.equal(parsed.secret, '[REDACTED]');
  assert.equal(parsed.authorization, '[REDACTED]');
  assert.equal(parsed.api_key, '[REDACTED]');
  assert.equal(parsed.apiKey, '[REDACTED]');
}

// ---------------------------------------------------------------------------
// Test: nested redaction
// ---------------------------------------------------------------------------

{
  const logger = createLogger();
  const { output } = captureStdout(() =>
    logger.info('nested', {
      config: { password: 'secret-pass', host: 'localhost' },
    }),
  );
  const parsed = JSON.parse(output.trim());
  assert.equal((parsed.config as any).password, '[REDACTED]');
  assert.equal((parsed.config as any).host, 'localhost');
}

// ---------------------------------------------------------------------------
// Test: error serialization
// ---------------------------------------------------------------------------

{
  const logger = createLogger();
  const err = new Error('something broke');
  (err as any).code = 'ERR_BROKEN';

  const { stderr } = captureBoth(() =>
    logger.error('failed', { error: err }),
  );
  const parsed = JSON.parse(stderr.trim());
  assert.equal(parsed.error.message, 'something broke');
  assert.equal(parsed.error.code, 'ERR_BROKEN');
  assert.ok(parsed.error.stack, 'should have stack');
  assert.ok(typeof parsed.error.stack === 'string');
}

// ---------------------------------------------------------------------------
// Test: error serialization (Error without code)
// ---------------------------------------------------------------------------

{
  const logger = createLogger();
  const err = new Error('no code');

  const { stderr } = captureBoth(() =>
    logger.error('oops', { error: err }),
  );
  const parsed = JSON.parse(stderr.trim());
  assert.equal(parsed.error.message, 'no code');
  assert.equal(parsed.error.code, undefined, 'code should be absent');
}

// ---------------------------------------------------------------------------
// Test: time() measures elapsed
// ---------------------------------------------------------------------------

{
  const logger = createLogger({ service: 'timer-test' });
  const done = logger.time('db.query');

  // Simulate a small delay
  const start = performance.now();
  while (performance.now() - start < 15) {
    // busy-wait ~15ms
  }

  const { output } = captureStdout(() => done());
  const parsed = JSON.parse(output.trim());
  assert.equal(parsed.msg, 'db.query');
  assert.ok(typeof parsed.duration_ms === 'number', 'should have duration_ms');
  assert.ok(parsed.duration_ms >= 10, `duration should be >= 10ms, got ${parsed.duration_ms}`);
  assert.equal(parsed.service, 'timer-test');
}

// ---------------------------------------------------------------------------
// Test: createRequestLogger extracts IDs
// ---------------------------------------------------------------------------

{
  const fakeReq = {
    id: 'req-abc',
    user: { id: 'usr-1' },
    params: { projectId: 'proj-42' },
    method: 'POST',
    path: '/api/projects/proj-42/deploy',
    headers: {},
  };

  const logger = createRequestLogger(fakeReq);
  const { output } = captureStdout(() => logger.info('deploy started'));
  const parsed = JSON.parse(output.trim());
  assert.equal(parsed.requestId, 'req-abc');
  assert.equal(parsed.userId, 'usr-1');
  assert.equal(parsed.projectId, 'proj-42');
  assert.equal(parsed.method, 'POST');
  assert.equal(parsed.path, '/api/projects/proj-42/deploy');
}

// ---------------------------------------------------------------------------
// Test: createRequestLogger with x-request-id header
// ---------------------------------------------------------------------------

{
  const fakeReq = {
    headers: { 'x-request-id': 'hdr-id-99' },
    method: 'GET',
    url: '/health',
  };

  const logger = createRequestLogger(fakeReq);
  const { output } = captureStdout(() => logger.info('health check'));
  const parsed = JSON.parse(output.trim());
  assert.equal(parsed.requestId, 'hdr-id-99');
  assert.equal(parsed.path, '/health');
}

// ---------------------------------------------------------------------------
// Test: createRequestLogger with auth.userId
// ---------------------------------------------------------------------------

{
  const fakeReq = {
    auth: { userId: 'auth-user-7' },
    headers: {},
    method: 'GET',
    path: '/me',
  };

  const logger = createRequestLogger(fakeReq);
  const { output } = captureStdout(() => logger.info('who am i'));
  const parsed = JSON.parse(output.trim());
  assert.equal(parsed.userId, 'auth-user-7');
}

// ---------------------------------------------------------------------------
// All passed
// ---------------------------------------------------------------------------

// Reset log level to default
setLogLevel('info');

console.log('test-structured-logger passed');
