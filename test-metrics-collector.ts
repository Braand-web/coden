// Comprehensive tests for src/services/metrics-collector.ts

import {
  Counter,
  Gauge,
  Histogram,
  Timer,
  MetricsRegistry,
  DEFAULT_BUCKETS,
  defaultMetrics,
  createCodenMetrics,
  type Labels,
  type CodenMetrics,
} from './src/services/metrics-collector.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    failed++;
    console.error(`  FAIL: ${msg}`);
  } else {
    passed++;
  }
}

function assertEq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) {
    failed++;
    console.error(`  FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else {
    passed++;
  }
}

function assertThrows(fn: () => void, msg: string): void {
  try {
    fn();
    failed++;
    console.error(`  FAIL: ${msg} — expected an error but none was thrown`);
  } catch {
    passed++;
  }
}

function section(name: string): void {
  console.log(`\n--- ${name} ---`);
}

// ============================================================================
// Counter tests
// ============================================================================

section('Counter: basic increment');
{
  const c = new Counter('test_counter', 'A test counter');
  assertEq(c.value(), 0, 'counter starts at 0');
  c.inc();
  assertEq(c.value(), 1, 'counter is 1 after inc()');
  c.inc();
  c.inc();
  assertEq(c.value(), 3, 'counter is 3 after three inc() calls');
}

section('Counter: increment by N');
{
  const c = new Counter('test_counter_n', 'Counter inc by N');
  c.inc(5);
  assertEq(c.value(), 5, 'counter is 5 after inc(5)');
  c.inc(10);
  assertEq(c.value(), 15, 'counter is 15 after inc(10)');
}

section('Counter: negative increment rejected');
{
  const c = new Counter('test_counter_neg', 'Counter negative');
  assertThrows(() => c.inc(-1), 'negative inc(number) throws');
  assertThrows(() => c.inc({}, -5), 'negative inc(labels, number) throws');
  assertEq(c.value(), 0, 'counter value unchanged after rejected increments');
}

section('Counter: labels');
{
  const c = new Counter('http_total', 'HTTP requests');
  c.inc({ method: 'GET', status: '200' });
  c.inc({ method: 'POST', status: '201' });
  c.inc({ method: 'GET', status: '200' }, 4);

  assertEq(c.value({ method: 'GET', status: '200' }), 5, 'GET 200 = 5');
  assertEq(c.value({ method: 'POST', status: '201' }), 1, 'POST 201 = 1');
  assertEq(c.value({ method: 'DELETE', status: '404' }), 0, 'unrecorded labels = 0');
}

section('Counter: series()');
{
  const c = new Counter('series_test', 'series');
  c.inc({ a: '1' });
  c.inc({ a: '2' }, 3);
  const series = c.series();
  assertEq(series.length, 2, 'two series');
  assert(series.some((s) => s.labels.a === '1' && s.value === 1), 'series a=1 value=1');
  assert(series.some((s) => s.labels.a === '2' && s.value === 3), 'series a=2 value=3');
}

section('Counter: reset');
{
  const c = new Counter('reset_test', 'reset');
  c.inc({ x: '1' }, 10);
  c.reset();
  assertEq(c.value({ x: '1' }), 0, 'value is 0 after reset');
  assertEq(c.series().length, 0, 'series empty after reset');
}

// ============================================================================
// Gauge tests
// ============================================================================

section('Gauge: set');
{
  const g = new Gauge('test_gauge', 'A test gauge');
  assertEq(g.value(), 0, 'gauge starts at 0');
  g.set(42);
  assertEq(g.value(), 42, 'gauge is 42 after set(42)');
  g.set(-10);
  assertEq(g.value(), -10, 'gauge is -10 after set(-10)');
}

section('Gauge: inc and dec');
{
  const g = new Gauge('gauge_incdec', 'inc/dec');
  g.set(10);
  g.inc();
  assertEq(g.value(), 11, 'gauge is 11 after inc()');
  g.inc(5);
  assertEq(g.value(), 16, 'gauge is 16 after inc(5)');
  g.dec();
  assertEq(g.value(), 15, 'gauge is 15 after dec()');
  g.dec(3);
  assertEq(g.value(), 12, 'gauge is 12 after dec(3)');
}

section('Gauge: labels');
{
  const g = new Gauge('gauge_labels', 'labeled gauge');
  g.set({ region: 'us' }, 100);
  g.set({ region: 'eu' }, 200);
  g.inc({ region: 'us' }, 5);
  g.dec({ region: 'eu' }, 50);

  assertEq(g.value({ region: 'us' }), 105, 'us = 105');
  assertEq(g.value({ region: 'eu' }), 150, 'eu = 150');
}

section('Gauge: reset');
{
  const g = new Gauge('gauge_reset', 'reset test');
  g.set({ a: '1' }, 99);
  g.reset();
  assertEq(g.value({ a: '1' }), 0, 'value 0 after reset');
  assertEq(g.series().length, 0, 'series empty after reset');
}

// ============================================================================
// Histogram tests
// ============================================================================

section('Histogram: default buckets');
{
  const h = new Histogram('test_hist', 'Test histogram');
  assertEq(JSON.stringify(h.buckets), JSON.stringify(DEFAULT_BUCKETS), 'uses DEFAULT_BUCKETS');
}

section('Histogram: custom buckets');
{
  const h = new Histogram('custom_hist', 'Custom', [100, 10, 50]);
  assertEq(JSON.stringify(h.buckets), JSON.stringify([10, 50, 100]), 'custom buckets sorted');
}

section('Histogram: observe and bucket distribution');
{
  const h = new Histogram('duration', 'Duration', [10, 50, 100, 500]);
  h.observe(5);    // bucket 10, 50, 100, 500
  h.observe(15);   // bucket 50, 100, 500
  h.observe(75);   // bucket 100, 500
  h.observe(200);  // bucket 500
  h.observe(999);  // no bucket (> 500)

  assertEq(h.count(), 5, 'count = 5');
  assertEq(h.sum(), 5 + 15 + 75 + 200 + 999, 'sum = 1294');

  const bc = h.bucketCounts();
  assertEq(bc.length, 4, '4 buckets');
  // le=10: values <= 10 -> 5 => count 1
  assertEq(bc[0].le, 10, 'first bucket le=10');
  assertEq(bc[0].count, 1, 'le=10 count=1');
  // le=50: values <= 50 -> 5, 15 => count 2
  assertEq(bc[1].le, 50, 'second bucket le=50');
  assertEq(bc[1].count, 2, 'le=50 count=2');
  // le=100: values <= 100 -> 5, 15, 75 => count 3
  assertEq(bc[2].le, 100, 'third bucket le=100');
  assertEq(bc[2].count, 3, 'le=100 count=3');
  // le=500: values <= 500 -> 5, 15, 75, 200 => count 4
  assertEq(bc[3].le, 500, 'fourth bucket le=500');
  assertEq(bc[3].count, 4, 'le=500 count=4');
}

section('Histogram: labels');
{
  const h = new Histogram('labeled_hist', 'Labeled', [10, 100]);
  h.observe({ method: 'GET' }, 5);
  h.observe({ method: 'GET' }, 50);
  h.observe({ method: 'POST' }, 7);

  assertEq(h.count({ method: 'GET' }), 2, 'GET count = 2');
  assertEq(h.sum({ method: 'GET' }), 55, 'GET sum = 55');
  assertEq(h.count({ method: 'POST' }), 1, 'POST count = 1');
  assertEq(h.sum({ method: 'POST' }), 7, 'POST sum = 7');
}

section('Histogram: series()');
{
  const h = new Histogram('series_hist', 'series', [10, 100]);
  h.observe({ a: '1' }, 5);
  h.observe({ a: '2' }, 50);
  const series = h.series();
  assertEq(series.length, 2, 'two series');
  const s1 = series.find((s) => s.labels.a === '1')!;
  assert(s1 !== undefined, 'series a=1 exists');
  assertEq(s1.count, 1, 'a=1 count=1');
  assertEq(s1.sum, 5, 'a=1 sum=5');
}

section('Histogram: reset');
{
  const h = new Histogram('reset_hist', 'reset', [10]);
  h.observe(5);
  h.reset();
  assertEq(h.count(), 0, 'count 0 after reset');
  assertEq(h.sum(), 0, 'sum 0 after reset');
}

section('Histogram: startTimer');
{
  const h = new Histogram('timer_hist', 'Timer histogram', [1, 10, 100, 1000]);
  const end = h.startTimer();
  // Busy wait ~5ms
  const start = performance.now();
  while (performance.now() - start < 5) { /* spin */ }
  const elapsed = end();
  assert(elapsed >= 4, `timer elapsed >= 4ms (got ${elapsed.toFixed(2)})`);
  assert(elapsed < 100, `timer elapsed < 100ms (got ${elapsed.toFixed(2)})`);
  assertEq(h.count(), 1, 'histogram count = 1 after timer');
  assert(h.sum() >= 4, 'histogram sum >= 4');
}

// ============================================================================
// Timer tests
// ============================================================================

section('Timer: records duration');
{
  const h = new Histogram('timer_test', 'timer', [1, 10, 100, 1000]);
  const timer = new Timer(h);
  const stop = timer.start();
  const s = performance.now();
  while (performance.now() - s < 5) { /* spin */ }
  const dur = stop();
  assert(dur >= 4, `timer duration >= 4ms (got ${dur.toFixed(2)})`);
  assertEq(h.count(), 1, 'underlying histogram count = 1');
  assert(timer.getHistogram() === h, 'getHistogram returns the histogram');
}

section('Timer: with labels');
{
  const h = new Histogram('timer_labels', 'timer labels', [100, 1000]);
  const timer = new Timer(h);
  const stop = timer.start({ op: 'read' });
  stop();
  assertEq(h.count({ op: 'read' }), 1, 'labeled timer recorded');
}

// ============================================================================
// MetricsRegistry tests
// ============================================================================

section('MetricsRegistry: counter/gauge/histogram/timer');
{
  const reg = new MetricsRegistry();
  const c = reg.counter('reg_counter', 'a counter');
  const g = reg.gauge('reg_gauge', 'a gauge');
  const h = reg.histogram('reg_hist', 'a histogram');
  const t = reg.timer('reg_timer', 'a timer');

  assert(c instanceof Counter, 'counter returns Counter');
  assert(g instanceof Gauge, 'gauge returns Gauge');
  assert(h instanceof Histogram, 'histogram returns Histogram');
  assert(t instanceof Timer, 'timer returns Timer');

  // Same name returns same instance
  assert(reg.counter('reg_counter') === c, 'same counter returned for same name');
  assert(reg.gauge('reg_gauge') === g, 'same gauge returned for same name');
  assert(reg.histogram('reg_hist') === h, 'same histogram returned for same name');
}

section('MetricsRegistry: snapshot');
{
  const reg = new MetricsRegistry();
  const c = reg.counter('snap_counter', 'counter help');
  const g = reg.gauge('snap_gauge', 'gauge help');
  const h = reg.histogram('snap_hist', 'hist help', [10, 100]);

  c.inc({ method: 'GET' }, 3);
  g.set({ region: 'us' }, 42);
  h.observe({ path: '/api' }, 55);

  const snap = reg.snapshot();

  // Counter snapshot
  const sc = snap['snap_counter'] as any;
  assertEq(sc.type, 'counter', 'snapshot counter type');
  assertEq(sc.help, 'counter help', 'snapshot counter help');
  assertEq(sc.values.length, 1, 'snapshot counter has 1 value');
  assertEq(sc.values[0].value, 3, 'snapshot counter value = 3');
  assertEq(sc.values[0].labels.method, 'GET', 'snapshot counter label');

  // Gauge snapshot
  const sg = snap['snap_gauge'] as any;
  assertEq(sg.type, 'gauge', 'snapshot gauge type');
  assertEq(sg.values[0].value, 42, 'snapshot gauge value = 42');

  // Histogram snapshot
  const sh = snap['snap_hist'] as any;
  assertEq(sh.type, 'histogram', 'snapshot histogram type');
  assertEq(sh.values[0].sum, 55, 'snapshot histogram sum = 55');
  assertEq(sh.values[0].count, 1, 'snapshot histogram count = 1');
  assert(Array.isArray(sh.buckets), 'snapshot histogram has buckets array');
  assertEq(sh.buckets.length, 2, 'snapshot histogram 2 buckets');
}

section('MetricsRegistry: snapshot with empty metrics');
{
  const reg = new MetricsRegistry();
  reg.counter('empty_counter', 'empty');
  const snap = reg.snapshot();
  const sc = snap['empty_counter'] as any;
  assertEq(sc.values.length, 0, 'empty counter has 0 values');
}

section('MetricsRegistry: Prometheus text format');
{
  const reg = new MetricsRegistry();
  const c = reg.counter('prom_requests', 'Total requests');
  const g = reg.gauge('prom_active', 'Active conns');
  const h = reg.histogram('prom_duration', 'Duration', [10, 100]);

  c.inc({ method: 'GET' }, 5);
  g.set(3);
  h.observe(7);
  h.observe(50);

  const text = reg.toPrometheus();

  // Counter lines
  assert(text.includes('# HELP prom_requests Total requests'), 'prom HELP counter');
  assert(text.includes('# TYPE prom_requests counter'), 'prom TYPE counter');
  assert(text.includes('prom_requests{method="GET"} 5'), 'prom counter value line');

  // Gauge lines
  assert(text.includes('# HELP prom_active Active conns'), 'prom HELP gauge');
  assert(text.includes('# TYPE prom_active gauge'), 'prom TYPE gauge');
  assert(text.includes('prom_active 3'), 'prom gauge value line');

  // Histogram lines
  assert(text.includes('# TYPE prom_duration histogram'), 'prom TYPE histogram');
  assert(text.includes('prom_duration_bucket{le="10"} 1'), 'prom bucket le=10');
  assert(text.includes('prom_duration_bucket{le="100"} 2'), 'prom bucket le=100');
  assert(text.includes('prom_duration_bucket{le="+Inf"} 2'), 'prom bucket +Inf');
  assert(text.includes('prom_duration_sum 57'), 'prom histogram sum');
  assert(text.includes('prom_duration_count 2'), 'prom histogram count');

  // Ends with newline
  assert(text.endsWith('\n'), 'prometheus text ends with newline');
}

section('MetricsRegistry: Prometheus format with labels on histogram');
{
  const reg = new MetricsRegistry();
  const h = reg.histogram('labeled_prom', 'Labeled', [10]);
  h.observe({ svc: 'api' }, 5);

  const text = reg.toPrometheus();
  assert(text.includes('labeled_prom_bucket{svc="api",le="10"} 1'), 'prom histogram labeled bucket');
  assert(text.includes('labeled_prom_bucket{svc="api",le="+Inf"} 1'), 'prom histogram labeled +Inf');
  assert(text.includes('labeled_prom_sum{svc="api"} 5'), 'prom histogram labeled sum');
  assert(text.includes('labeled_prom_count{svc="api"} 1'), 'prom histogram labeled count');
}

section('MetricsRegistry: reset');
{
  const reg = new MetricsRegistry();
  reg.counter('r_counter', '').inc(10);
  reg.gauge('r_gauge', '').set(42);
  reg.histogram('r_hist', '', [10]).observe(5);

  reg.reset();

  assertEq(reg.counter('r_counter').value(), 0, 'counter 0 after registry reset');
  assertEq(reg.gauge('r_gauge').value(), 0, 'gauge 0 after registry reset');
  assertEq(reg.histogram('r_hist').count(), 0, 'histogram count 0 after registry reset');
  assertEq(reg.histogram('r_hist').sum(), 0, 'histogram sum 0 after registry reset');
}

// ============================================================================
// Multiple labels combinations
// ============================================================================

section('Multiple labels combinations');
{
  const c = new Counter('multi_labels', 'Multi-label counter');
  c.inc({ method: 'GET', path: '/', status: '200' });
  c.inc({ method: 'GET', path: '/', status: '200' });
  c.inc({ method: 'GET', path: '/', status: '404' });
  c.inc({ method: 'POST', path: '/submit', status: '201' });
  c.inc({ method: 'POST', path: '/submit', status: '500' }, 2);

  assertEq(c.value({ method: 'GET', path: '/', status: '200' }), 2, 'GET / 200 = 2');
  assertEq(c.value({ method: 'GET', path: '/', status: '404' }), 1, 'GET / 404 = 1');
  assertEq(c.value({ method: 'POST', path: '/submit', status: '201' }), 1, 'POST /submit 201 = 1');
  assertEq(c.value({ method: 'POST', path: '/submit', status: '500' }), 2, 'POST /submit 500 = 2');
  assertEq(c.series().length, 4, '4 distinct label combos');
}

section('Labels key order does not matter');
{
  const c = new Counter('order_labels', 'Order test');
  c.inc({ b: '2', a: '1' });
  c.inc({ a: '1', b: '2' });
  assertEq(c.value({ a: '1', b: '2' }), 2, 'labels matched regardless of key order');
  assertEq(c.series().length, 1, 'only one series despite different key order');
}

// ============================================================================
// Default registry singleton
// ============================================================================

section('Default registry singleton');
{
  assert(defaultMetrics instanceof MetricsRegistry, 'defaultMetrics is a MetricsRegistry');
  // Reset it to ensure clean state for other tests
  defaultMetrics.reset();
}

// ============================================================================
// createCodenMetrics factory
// ============================================================================

section('createCodenMetrics: creates all expected metrics');
{
  const reg = new MetricsRegistry();
  const m = createCodenMetrics(reg);

  assert(m.httpRequestsTotal instanceof Counter, 'httpRequestsTotal is Counter');
  assert(m.httpRequestDurationMs instanceof Histogram, 'httpRequestDurationMs is Histogram');
  assert(m.generationTotal instanceof Counter, 'generationTotal is Counter');
  assert(m.generationDurationMs instanceof Histogram, 'generationDurationMs is Histogram');
  assert(m.generationTokens instanceof Histogram, 'generationTokens is Histogram');
  assert(m.activeConnections instanceof Gauge, 'activeConnections is Gauge');
  assert(m.queueDepth instanceof Gauge, 'queueDepth is Gauge');
  assert(m.errorsTotal instanceof Counter, 'errorsTotal is Counter');
  assert(m.creditsConsumed instanceof Counter, 'creditsConsumed is Counter');

  // Metric names
  assertEq(m.httpRequestsTotal.name, 'coden_http_requests_total', 'httpRequestsTotal name');
  assertEq(m.httpRequestDurationMs.name, 'coden_http_request_duration_ms', 'httpRequestDurationMs name');
  assertEq(m.generationTotal.name, 'coden_generation_total', 'generationTotal name');
  assertEq(m.generationDurationMs.name, 'coden_generation_duration_ms', 'generationDurationMs name');
  assertEq(m.generationTokens.name, 'coden_generation_tokens', 'generationTokens name');
  assertEq(m.activeConnections.name, 'coden_active_connections', 'activeConnections name');
  assertEq(m.queueDepth.name, 'coden_queue_depth', 'queueDepth name');
  assertEq(m.errorsTotal.name, 'coden_errors_total', 'errorsTotal name');
  assertEq(m.creditsConsumed.name, 'coden_credits_consumed', 'creditsConsumed name');
}

section('createCodenMetrics: functional usage');
{
  const reg = new MetricsRegistry();
  const m = createCodenMetrics(reg);

  m.httpRequestsTotal.inc({ method: 'POST', path: '/generate', status: '200' });
  m.httpRequestDurationMs.observe({ method: 'POST', path: '/generate' }, 123);
  m.generationTotal.inc({ model: 'gpt-4', status: 'success' });
  m.generationDurationMs.observe({ model: 'gpt-4' }, 456);
  m.generationTokens.observe({ model: 'gpt-4', direction: 'input' }, 100);
  m.generationTokens.observe({ model: 'gpt-4', direction: 'output' }, 50);
  m.activeConnections.inc();
  m.queueDepth.set({ type: 'generation', priority: 'high' }, 3);
  m.errorsTotal.inc({ type: 'timeout' });
  m.creditsConsumed.inc({ plan: 'pro', model: 'gpt-4' }, 10);

  assertEq(
    m.httpRequestsTotal.value({ method: 'POST', path: '/generate', status: '200' }),
    1,
    'httpRequestsTotal functional',
  );
  assertEq(
    m.httpRequestDurationMs.sum({ method: 'POST', path: '/generate' }),
    123,
    'httpRequestDurationMs functional',
  );
  assertEq(
    m.generationTokens.sum({ model: 'gpt-4', direction: 'input' }),
    100,
    'generationTokens input functional',
  );
  assertEq(
    m.generationTokens.sum({ model: 'gpt-4', direction: 'output' }),
    50,
    'generationTokens output functional',
  );
  assertEq(m.activeConnections.value(), 1, 'activeConnections functional');
  assertEq(m.queueDepth.value({ type: 'generation', priority: 'high' }), 3, 'queueDepth functional');
  assertEq(m.creditsConsumed.value({ plan: 'pro', model: 'gpt-4' }), 10, 'creditsConsumed functional');

  // Verify snapshot has all metrics
  const snap = reg.snapshot();
  const metricNames = Object.keys(snap);
  assert(metricNames.includes('coden_http_requests_total'), 'snapshot has coden_http_requests_total');
  assert(metricNames.includes('coden_http_request_duration_ms'), 'snapshot has coden_http_request_duration_ms');
  assert(metricNames.includes('coden_generation_total'), 'snapshot has coden_generation_total');
  assert(metricNames.includes('coden_generation_duration_ms'), 'snapshot has coden_generation_duration_ms');
  assert(metricNames.includes('coden_generation_tokens'), 'snapshot has coden_generation_tokens');
  assert(metricNames.includes('coden_active_connections'), 'snapshot has coden_active_connections');
  assert(metricNames.includes('coden_queue_depth'), 'snapshot has coden_queue_depth');
  assert(metricNames.includes('coden_errors_total'), 'snapshot has coden_errors_total');
  assert(metricNames.includes('coden_credits_consumed'), 'snapshot has coden_credits_consumed');
}

section('createCodenMetrics: uses defaultMetrics when no registry given');
{
  defaultMetrics.reset();
  const m = createCodenMetrics();
  m.httpRequestsTotal.inc({ method: 'GET', path: '/', status: '200' });
  const snap = defaultMetrics.snapshot();
  const sc = snap['coden_http_requests_total'] as any;
  assertEq(sc.values[0].value, 1, 'default registry received the counter increment');
  defaultMetrics.reset();
}

// ============================================================================
// Edge cases
// ============================================================================

section('Edge: histogram observe zero');
{
  const h = new Histogram('zero_hist', 'zero', [0, 10]);
  h.observe(0);
  assertEq(h.count(), 1, 'count = 1 after observe(0)');
  assertEq(h.sum(), 0, 'sum = 0 after observe(0)');
  const bc = h.bucketCounts();
  assertEq(bc[0].count, 1, 'le=0 bucket has count 1');
}

section('Edge: histogram bucketCounts for unknown labels');
{
  const h = new Histogram('unknown_labels_hist', 'test', [10, 100]);
  const bc = h.bucketCounts({ x: 'missing' });
  assertEq(bc.length, 2, 'returns correct number of buckets');
  assertEq(bc[0].count, 0, 'all counts are 0');
  assertEq(bc[1].count, 0, 'all counts are 0 (second)');
}

section('Edge: gauge can go negative');
{
  const g = new Gauge('negative_gauge', 'can be negative');
  g.set(-100);
  assertEq(g.value(), -100, 'gauge can be set to -100');
  g.dec(50);
  assertEq(g.value(), -150, 'gauge can go to -150');
}

section('Edge: counter inc with zero');
{
  const c = new Counter('zero_inc', 'zero');
  c.inc(0);
  assertEq(c.value(), 0, 'counter value remains 0 after inc(0)');
}

section('Edge: Prometheus format for empty registry');
{
  const reg = new MetricsRegistry();
  const text = reg.toPrometheus();
  assertEq(text, '\n', 'empty registry produces just a newline');
}

section('Edge: Prometheus format for counter with no observations');
{
  const reg = new MetricsRegistry();
  reg.counter('no_obs', 'Never observed');
  const text = reg.toPrometheus();
  assert(text.includes('no_obs 0'), 'counter with no observations shows 0');
}

section('Edge: Prometheus format for gauge with no observations');
{
  const reg = new MetricsRegistry();
  reg.gauge('no_obs_gauge', 'Never observed');
  const text = reg.toPrometheus();
  assert(text.includes('no_obs_gauge 0'), 'gauge with no observations shows 0');
}

// ============================================================================
// Summary
// ============================================================================

console.log(`\n========================================`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`========================================`);

if (failed > 0) {
  process.exit(1);
}

console.log('test-metrics-collector passed');
