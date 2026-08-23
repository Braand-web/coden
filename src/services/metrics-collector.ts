// Lightweight APM / metrics collection service — dependency-free.
// Provides Counter, Gauge, Histogram, Timer, and a MetricsRegistry
// with snapshot (JSON) and Prometheus exposition format exports.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Labels = Record<string, string>;

/** Serialised key for a labels combination. */
function labelsKey(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  return keys.map((k) => `${k}="${labels[k]}"`).join(',');
}

function labelsEqual(a: Labels, b: Labels): boolean {
  return labelsKey(a) === labelsKey(b);
}

// ---------------------------------------------------------------------------
// Counter
// ---------------------------------------------------------------------------

interface CounterChild {
  labels: Labels;
  value: number;
}

export class Counter {
  readonly name: string;
  readonly help: string;
  private children: CounterChild[] = [];

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  /** Increment by 1 or by a positive delta. */
  inc(labelsOrDelta?: Labels | number, maybeDelta?: number): void {
    let labels: Labels = {};
    let delta = 1;

    if (typeof labelsOrDelta === 'number') {
      delta = labelsOrDelta;
    } else if (labelsOrDelta !== undefined) {
      labels = labelsOrDelta;
      if (maybeDelta !== undefined) delta = maybeDelta;
    }

    if (delta < 0) {
      throw new Error(`Counter "${this.name}" does not accept negative increments`);
    }

    const child = this.getOrCreate(labels);
    child.value += delta;
  }

  /** Current value for the given labels combination. */
  value(labels: Labels = {}): number {
    const child = this.find(labels);
    return child ? child.value : 0;
  }

  /** Reset all series. */
  reset(): void {
    this.children = [];
  }

  /** All series. */
  series(): { labels: Labels; value: number }[] {
    return this.children.map((c) => ({ labels: { ...c.labels }, value: c.value }));
  }

  // -- internal --

  private find(labels: Labels): CounterChild | undefined {
    return this.children.find((c) => labelsEqual(c.labels, labels));
  }

  private getOrCreate(labels: Labels): CounterChild {
    let child = this.find(labels);
    if (!child) {
      child = { labels: { ...labels }, value: 0 };
      this.children.push(child);
    }
    return child;
  }
}

// ---------------------------------------------------------------------------
// Gauge
// ---------------------------------------------------------------------------

interface GaugeChild {
  labels: Labels;
  value: number;
}

export class Gauge {
  readonly name: string;
  readonly help: string;
  private children: GaugeChild[] = [];

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  /** Set to an absolute value. */
  set(labelsOrValue: Labels | number, maybeValue?: number): void {
    let labels: Labels = {};
    let value: number;

    if (typeof labelsOrValue === 'number') {
      value = labelsOrValue;
    } else {
      labels = labelsOrValue;
      value = maybeValue ?? 0;
    }

    const child = this.getOrCreate(labels);
    child.value = value;
  }

  /** Increment (default +1). */
  inc(labelsOrDelta?: Labels | number, maybeDelta?: number): void {
    let labels: Labels = {};
    let delta = 1;

    if (typeof labelsOrDelta === 'number') {
      delta = labelsOrDelta;
    } else if (labelsOrDelta !== undefined) {
      labels = labelsOrDelta;
      if (maybeDelta !== undefined) delta = maybeDelta;
    }

    const child = this.getOrCreate(labels);
    child.value += delta;
  }

  /** Decrement (default -1). */
  dec(labelsOrDelta?: Labels | number, maybeDelta?: number): void {
    let labels: Labels = {};
    let delta = 1;

    if (typeof labelsOrDelta === 'number') {
      delta = labelsOrDelta;
    } else if (labelsOrDelta !== undefined) {
      labels = labelsOrDelta;
      if (maybeDelta !== undefined) delta = maybeDelta;
    }

    const child = this.getOrCreate(labels);
    child.value -= delta;
  }

  /** Current value for the given labels combination. */
  value(labels: Labels = {}): number {
    const child = this.find(labels);
    return child ? child.value : 0;
  }

  /** Reset all series. */
  reset(): void {
    this.children = [];
  }

  /** All series. */
  series(): { labels: Labels; value: number }[] {
    return this.children.map((c) => ({ labels: { ...c.labels }, value: c.value }));
  }

  // -- internal --

  private find(labels: Labels): GaugeChild | undefined {
    return this.children.find((c) => labelsEqual(c.labels, labels));
  }

  private getOrCreate(labels: Labels): GaugeChild {
    let child = this.find(labels);
    if (!child) {
      child = { labels: { ...labels }, value: 0 };
      this.children.push(child);
    }
    return child;
  }
}

// ---------------------------------------------------------------------------
// Histogram
// ---------------------------------------------------------------------------

export const DEFAULT_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

interface HistogramChild {
  labels: Labels;
  buckets: number[];       // upper bounds (sorted)
  counts: number[];        // count per bucket
  sum: number;
  count: number;
}

export class Histogram {
  readonly name: string;
  readonly help: string;
  readonly buckets: number[];
  private children: HistogramChild[] = [];

  constructor(name: string, help: string, buckets?: number[]) {
    this.name = name;
    this.help = help;
    this.buckets = buckets ? [...buckets].sort((a, b) => a - b) : [...DEFAULT_BUCKETS];
  }

  /** Record an observed value. */
  observe(labelsOrValue: Labels | number, maybeValue?: number): void {
    let labels: Labels = {};
    let value: number;

    if (typeof labelsOrValue === 'number') {
      value = labelsOrValue;
    } else {
      labels = labelsOrValue;
      value = maybeValue ?? 0;
    }

    const child = this.getOrCreate(labels);
    child.sum += value;
    child.count += 1;

    for (let i = 0; i < child.buckets.length; i++) {
      if (value <= child.buckets[i]) {
        child.counts[i] += 1;
      }
    }
  }

  /** Start a timer that records duration in ms when the returned function is called. */
  startTimer(labels: Labels = {}): () => number {
    const start = performance.now();
    return () => {
      const elapsed = performance.now() - start;
      this.observe(labels, elapsed);
      return elapsed;
    };
  }

  /** Get sum for the given labels. */
  sum(labels: Labels = {}): number {
    const child = this.find(labels);
    return child ? child.sum : 0;
  }

  /** Get count for the given labels. */
  count(labels: Labels = {}): number {
    const child = this.find(labels);
    return child ? child.count : 0;
  }

  /** Get bucket counts for the given labels. */
  bucketCounts(labels: Labels = {}): { le: number; count: number }[] {
    const child = this.find(labels);
    if (!child) return this.buckets.map((b) => ({ le: b, count: 0 }));
    return child.buckets.map((b, i) => ({ le: b, count: child.counts[i] }));
  }

  /** Reset all series. */
  reset(): void {
    this.children = [];
  }

  /** All series. */
  series(): { labels: Labels; buckets: { le: number; count: number }[]; sum: number; count: number }[] {
    return this.children.map((c) => ({
      labels: { ...c.labels },
      buckets: c.buckets.map((b, i) => ({ le: b, count: c.counts[i] })),
      sum: c.sum,
      count: c.count,
    }));
  }

  // -- internal --

  private find(labels: Labels): HistogramChild | undefined {
    return this.children.find((c) => labelsEqual(c.labels, labels));
  }

  private getOrCreate(labels: Labels): HistogramChild {
    let child = this.find(labels);
    if (!child) {
      child = {
        labels: { ...labels },
        buckets: [...this.buckets],
        counts: new Array(this.buckets.length).fill(0),
        sum: 0,
        count: 0,
      };
      this.children.push(child);
    }
    return child;
  }
}

// ---------------------------------------------------------------------------
// Timer (convenience wrapper over Histogram)
// ---------------------------------------------------------------------------

export class Timer {
  private histogram: Histogram;

  constructor(histogram: Histogram) {
    this.histogram = histogram;
  }

  /** Start timing. Returns a function that stops the timer and records duration in ms. */
  start(labels: Labels = {}): () => number {
    return this.histogram.startTimer(labels);
  }

  /** Access the underlying histogram. */
  getHistogram(): Histogram {
    return this.histogram;
  }
}

// ---------------------------------------------------------------------------
// MetricsRegistry
// ---------------------------------------------------------------------------

export class MetricsRegistry {
  private counters: Map<string, Counter> = new Map();
  private gauges: Map<string, Gauge> = new Map();
  private histograms: Map<string, Histogram> = new Map();

  /** Create or retrieve a counter. */
  counter(name: string, help = ''): Counter {
    let c = this.counters.get(name);
    if (!c) {
      c = new Counter(name, help);
      this.counters.set(name, c);
    }
    return c;
  }

  /** Create or retrieve a gauge. */
  gauge(name: string, help = ''): Gauge {
    let g = this.gauges.get(name);
    if (!g) {
      g = new Gauge(name, help);
      this.gauges.set(name, g);
    }
    return g;
  }

  /** Create or retrieve a histogram. */
  histogram(name: string, help = '', buckets?: number[]): Histogram {
    let h = this.histograms.get(name);
    if (!h) {
      h = new Histogram(name, help, buckets);
      this.histograms.set(name, h);
    }
    return h;
  }

  /** Create a Timer backed by a histogram in this registry. */
  timer(name: string, help = '', buckets?: number[]): Timer {
    const h = this.histogram(name, help, buckets);
    return new Timer(h);
  }

  // -----------------------------------------------------------------------
  // Snapshot (JSON)
  // -----------------------------------------------------------------------

  snapshot(): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [name, counter] of this.counters) {
      const series = counter.series();
      if (series.length === 0) {
        result[name] = { type: 'counter', help: counter.help, values: [] };
      } else {
        result[name] = {
          type: 'counter',
          help: counter.help,
          values: series.map((s) => ({
            labels: s.labels,
            value: s.value,
          })),
        };
      }
    }

    for (const [name, gauge] of this.gauges) {
      const series = gauge.series();
      result[name] = {
        type: 'gauge',
        help: gauge.help,
        values: series.map((s) => ({
          labels: s.labels,
          value: s.value,
        })),
      };
    }

    for (const [name, histogram] of this.histograms) {
      const series = histogram.series();
      result[name] = {
        type: 'histogram',
        help: histogram.help,
        buckets: histogram.buckets,
        values: series.map((s) => ({
          labels: s.labels,
          buckets: s.buckets,
          sum: s.sum,
          count: s.count,
        })),
      };
    }

    return result;
  }

  // -----------------------------------------------------------------------
  // Prometheus exposition format
  // -----------------------------------------------------------------------

  toPrometheus(): string {
    const lines: string[] = [];

    for (const [name, counter] of this.counters) {
      if (counter.help) lines.push(`# HELP ${name} ${counter.help}`);
      lines.push(`# TYPE ${name} counter`);
      const series = counter.series();
      if (series.length === 0) {
        lines.push(`${name} 0`);
      } else {
        for (const s of series) {
          lines.push(`${name}${promLabels(s.labels)} ${s.value}`);
        }
      }
    }

    for (const [name, gauge] of this.gauges) {
      if (gauge.help) lines.push(`# HELP ${name} ${gauge.help}`);
      lines.push(`# TYPE ${name} gauge`);
      const series = gauge.series();
      if (series.length === 0) {
        lines.push(`${name} 0`);
      } else {
        for (const s of series) {
          lines.push(`${name}${promLabels(s.labels)} ${s.value}`);
        }
      }
    }

    for (const [name, histogram] of this.histograms) {
      if (histogram.help) lines.push(`# HELP ${name} ${histogram.help}`);
      lines.push(`# TYPE ${name} histogram`);
      const series = histogram.series();
      for (const s of series) {
        for (const b of s.buckets) {
          lines.push(`${name}_bucket${promLabels({ ...s.labels, le: String(b.le) })} ${b.count}`);
        }
        lines.push(`${name}_bucket${promLabels({ ...s.labels, le: '+Inf' })} ${s.count}`);
        lines.push(`${name}_sum${promLabels(s.labels)} ${s.sum}`);
        lines.push(`${name}_count${promLabels(s.labels)} ${s.count}`);
      }
    }

    return lines.join('\n') + '\n';
  }

  // -----------------------------------------------------------------------
  // Reset
  // -----------------------------------------------------------------------

  reset(): void {
    for (const c of this.counters.values()) c.reset();
    for (const g of this.gauges.values()) g.reset();
    for (const h of this.histograms.values()) h.reset();
  }
}

// ---------------------------------------------------------------------------
// Prometheus label formatting helper
// ---------------------------------------------------------------------------

function promLabels(labels: Labels): string {
  const keys = Object.keys(labels);
  if (keys.length === 0) return '';
  const pairs = keys.map((k) => `${k}="${labels[k]}"`);
  return `{${pairs.join(',')}}`;
}

// ---------------------------------------------------------------------------
// Default singleton registry
// ---------------------------------------------------------------------------

export const defaultMetrics = new MetricsRegistry();

// ---------------------------------------------------------------------------
// Pre-built Coden metrics factory
// ---------------------------------------------------------------------------

export interface CodenMetrics {
  httpRequestsTotal: Counter;
  httpRequestDurationMs: Histogram;
  generationTotal: Counter;
  generationDurationMs: Histogram;
  generationTokens: Histogram;
  activeConnections: Gauge;
  queueDepth: Gauge;
  errorsTotal: Counter;
  creditsConsumed: Counter;
}

export function createCodenMetrics(registry?: MetricsRegistry): CodenMetrics {
  const r = registry ?? defaultMetrics;

  return {
    httpRequestsTotal: r.counter(
      'coden_http_requests_total',
      'Total HTTP requests',
    ),
    httpRequestDurationMs: r.histogram(
      'coden_http_request_duration_ms',
      'HTTP request duration in milliseconds',
    ),
    generationTotal: r.counter(
      'coden_generation_total',
      'Total generation requests',
    ),
    generationDurationMs: r.histogram(
      'coden_generation_duration_ms',
      'Generation duration in milliseconds',
    ),
    generationTokens: r.histogram(
      'coden_generation_tokens',
      'Generation token counts',
    ),
    activeConnections: r.gauge(
      'coden_active_connections',
      'Currently active connections',
    ),
    queueDepth: r.gauge(
      'coden_queue_depth',
      'Current queue depth',
    ),
    errorsTotal: r.counter(
      'coden_errors_total',
      'Total errors',
    ),
    creditsConsumed: r.counter(
      'coden_credits_consumed',
      'Total credits consumed',
    ),
  };
}
