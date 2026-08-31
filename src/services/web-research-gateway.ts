import { redactSecrets } from './secret-redaction.ts';

export type ResearchStatus = 'completed' | 'skipped' | 'failed';

export type ResearchResultItem = {
  title: string;
  url: string;
  snippet: string;
  published_at?: string | null;
  source?: string;
};

export type ResearchResult = {
  status: ResearchStatus;
  query: string;
  provider: 'firecrawl' | 'tavily' | 'brave' | 'none';
  diagnostic_code?: string;
  message: string;
  results: ResearchResultItem[];
};

export type WebResearchProvider = 'firecrawl' | 'tavily' | 'brave';

export type WebResearchDecision = {
  shouldResearch: boolean;
  action: 'none' | 'search' | 'scrape';
  query: string;
  reason: string;
  confidence: number;
  providerPreference: WebResearchProvider[];
};

export type WebResearchPlan = Omit<WebResearchDecision, 'action'> & {
  action: 'search' | 'scrape';
};

export class WebResearchGateway {
  private firecrawlKey: string;
  private tavilyKey: string;
  private braveKey: string;
  private fetchImpl: typeof fetch;

  constructor(env: Record<string, any> = process.env, fetchImpl: typeof fetch = fetch) {
    this.firecrawlKey = clean(env.FIRECRAWL_API_KEY);
    this.tavilyKey = clean(env.TAVILY_API_KEY);
    this.braveKey = clean(env.BRAVE_SEARCH_API_KEY);
    this.fetchImpl = fetchImpl;
  }

  isConfigured() {
    return Boolean(this.firecrawlKey || this.tavilyKey || this.braveKey);
  }

  async search(query: string, options: { maxResults?: number; timeoutMs?: number } = {}): Promise<ResearchResult> {
    const plan = buildWebResearchPlan({ prompt: query, requiresFileChanges: true });
    const normalizedQuery = sanitizeQuery(plan.query || query);
    if (!normalizedQuery) {
      return skipped(query, 'WEB_RESEARCH_QUERY_EMPTY', 'No useful research query was available.');
    }
    if (!this.isConfigured()) {
      return skipped(normalizedQuery, 'WEB_RESEARCH_NOT_CONFIGURED', 'Web research is not configured.');
    }

    const maxResults = Math.min(6, Math.max(1, options.maxResults || 4));
    if (this.firecrawlKey) {
      try {
        if (plan.action === 'scrape' || looksLikeUrl(normalizedQuery)) {
          return await this.scrapeFirecrawl(normalizeScrapeUrl(normalizedQuery), options.timeoutMs || 12_000);
        }
        const result = await this.searchFirecrawl(normalizedQuery, maxResults, options.timeoutMs || 12_000);
        if (hasUsefulResults(result) || (!this.tavilyKey && !this.braveKey)) return result;
      } catch (error: any) {
        if (!this.tavilyKey && !this.braveKey) return failed(normalizedQuery, 'firecrawl', error);
      }
    }
    if (this.tavilyKey) {
      try {
        const result = await this.searchTavily(normalizedQuery, maxResults, options.timeoutMs || 12_000);
        if (hasUsefulResults(result) || !this.braveKey) return result;
      } catch (error: any) {
        if (!this.braveKey) return failed(normalizedQuery, 'tavily', error);
      }
    }
    try {
      return await this.searchBrave(normalizedQuery, maxResults, options.timeoutMs || 12_000);
    } catch (error: any) {
      return failed(normalizedQuery, 'brave', error);
    }
  }

  async scrape(url: string, options: { timeoutMs?: number } = {}): Promise<ResearchResult> {
    const normalizedUrl = normalizeScrapeUrl(url);
    if (!normalizedUrl) {
      return skipped(url, 'WEB_RESEARCH_URL_INVALID', 'No valid URL was available for scraping.');
    }
    if (!this.firecrawlKey) {
      return skipped(normalizedUrl, 'FIRECRAWL_NOT_CONFIGURED', 'Firecrawl scraping is not configured.');
    }
    try {
      return await this.scrapeFirecrawl(normalizedUrl, options.timeoutMs || 12_000);
    } catch (error: any) {
      return failed(normalizedUrl, 'firecrawl', error);
    }
  }

  private async searchFirecrawl(query: string, maxResults: number, timeoutMs: number): Promise<ResearchResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl('https://api.firecrawl.dev/v2/search', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.firecrawlKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          query,
          limit: maxResults,
          maxResults,
        }),
        signal: controller.signal as any,
      });
      if (!response.ok) throw new Error(`Firecrawl Search HTTP ${response.status}`);
      const data: any = await response.json();
      const rawResults = Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.results)
          ? data.results
          : Array.isArray(data?.items)
            ? data.items
            : [];
      const results = normalizeResults(rawResults.map(firecrawlItemToResult), maxResults);
      return {
        status: 'completed',
        query,
        provider: 'firecrawl',
        message: results.length ? 'Research completed.' : 'Research completed with no results.',
        results,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async scrapeFirecrawl(url: string, timeoutMs: number): Promise<ResearchResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl('https://api.firecrawl.dev/v2/scrape', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.firecrawlKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ url }),
        signal: controller.signal as any,
      });
      if (!response.ok) throw new Error(`Firecrawl Scrape HTTP ${response.status}`);
      const data: any = await response.json();
      const item = data?.data || data;
      const result = firecrawlItemToResult({ ...item, url: item?.url || item?.metadata?.sourceURL || url });
      return {
        status: 'completed',
        query: url,
        provider: 'firecrawl',
        message: result.snippet ? 'Scrape completed.' : 'Scrape completed with no content.',
        results: result.url ? [result] : [],
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async searchTavily(query: string, maxResults: number, timeoutMs: number): Promise<ResearchResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          api_key: this.tavilyKey,
          query,
          search_depth: 'basic',
          max_results: maxResults,
          include_answer: false,
          include_raw_content: false,
        }),
        signal: controller.signal as any,
      });
      if (!response.ok) throw new Error(`Tavily HTTP ${response.status}`);
      const data: any = await response.json();
      const results = Array.isArray(data?.results) ? data.results : [];
      return {
        status: 'completed',
        query,
        provider: 'tavily',
        message: results.length ? 'Research completed.' : 'Research completed with no results.',
        results: normalizeResults(results.map((item: any) => ({
          title: truncate(item?.title || item?.url || 'Untitled result', 120),
          url: safeUrl(item?.url),
          snippet: truncate(item?.content || item?.snippet || '', 360),
          published_at: item?.published_date || item?.published_at || null,
          source: 'tavily',
        })), maxResults),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async searchBrave(query: string, maxResults: number, timeoutMs: number): Promise<ResearchResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = new URL('https://api.search.brave.com/res/v1/web/search');
      url.searchParams.set('q', query);
      url.searchParams.set('count', String(maxResults));
      const response = await this.fetchImpl(url.toString(), {
        headers: {
          accept: 'application/json',
          'x-subscription-token': this.braveKey,
        },
        signal: controller.signal as any,
      });
      if (!response.ok) throw new Error(`Brave Search HTTP ${response.status}`);
      const data: any = await response.json();
      const results = Array.isArray(data?.web?.results) ? data.web.results : [];
      return {
        status: 'completed',
        query,
        provider: 'brave',
        message: results.length ? 'Research completed.' : 'Research completed with no results.',
        results: normalizeResults(results.map((item: any) => ({
          title: truncate(item?.title || item?.url || 'Untitled result', 120),
          url: safeUrl(item?.url),
          snippet: truncate(item?.description || item?.snippet || '', 360),
          published_at: item?.age || null,
          source: 'brave',
        })), maxResults),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function shouldUseWebResearch(input: { prompt: string; intent?: string; requiresFileChanges?: boolean }) {
  return decideWebResearch(input).shouldResearch;
}

export function buildWebResearchPlan(input: { prompt: string; intent?: string; requiresFileChanges?: boolean }): WebResearchPlan {
  const decision = decideWebResearch(input);
  return {
    ...decision,
    action: decision.action === 'none' ? 'search' : decision.action,
  };
}

export function decideWebResearch(input: { prompt: string; intent?: string; requiresFileChanges?: boolean }): WebResearchDecision {
  const rawPrompt = String(input.prompt || '');
  const prompt = rawPrompt.toLowerCase();
  const query = sanitizeQuery(rawPrompt);
  const url = extractPrimaryUrl(rawPrompt);
  const providerPreference: WebResearchProvider[] = ['firecrawl', 'tavily', 'brave'];
  const isShortGreeting = /\b(bonjour|salut|hello|hi|merci|thanks)\b/.test(prompt) && prompt.length < 80;
  const isSimpleLocalBuild = /\b(todo|to do|to-do|pomodoro|pomodero|timer|calculator|calculatrice|notes?|weather app|quiz)\b/i.test(prompt)
    && /\b(create|build|make|generate|cr[eé]e|g[eé]n[eè]re|app|application)\b/i.test(prompt)
    && !/\b(url|http|docs?|documentation|latest|recent|actuel|r[eé]cent|pricing|api|sdk|stripe|supabase|vercel|railway|github|figma|import|clone|rebuild|inspiration)\b/i.test(prompt);
  const isInternalBugOnly = /\b(bug|erreur|error|preview blanche|white screen|corrige|fix)\b/i.test(prompt)
    && !/\b(docs?|documentation|api|sdk|provider|openrouter|stripe|supabase|vercel|railway|google|cloudflare|dns|domain|oauth|webhook|latest|recent|actuel|r[eé]cent|pricing|http|url)\b/i.test(prompt);

  if (!query || isShortGreeting || isSimpleLocalBuild || isInternalBugOnly) {
    return { shouldResearch: false, action: 'none', query, reason: 'local_or_conversation', confidence: 0.92, providerPreference };
  }

  if (url && (looksLikeUrl(query) || /\b(research|analyse|analyze|scrape|crawl|import|clone|rebuild|inspiration|website|site|url|source url|website url|figma|github)\b/i.test(prompt))) {
    return { shouldResearch: true, action: 'scrape', query: url, reason: 'url_context', confidence: 0.95, providerPreference };
  }

  if (/\b(search the web|web search|online search|look up|browse|research online|internet search|recherche en ligne|cherche sur internet|chercher sur internet|consulte le web|fais une recherche|faire une recherche|recherche web)\b/i.test(prompt)) {
    return { shouldResearch: true, action: url ? 'scrape' : 'search', query: url || query, reason: 'explicit_web_research', confidence: 0.96, providerPreference };
  }

  if (/\b(latest|recent|today|current|now|new|pricing|price|docs?|documentation|api|sdk|version|changelog|release|availability|models?|provider|openrouter|railway|vercel|supabase|stripe|seo|google|cloudflare|dns|domain|deploy|oauth|webhook|terms|law|legal|gdpr)\b/i.test(prompt)
    || /\b(dernier|derni[eè]re|r[eé]cent|actuel|aujourd'hui|maintenant|prix|tarif|documentation|d[eé]ployer|domaine|mod[eè]le|disponibilit[eé]|firecrawl|tavily|brave search)\b/i.test(prompt)) {
    return { shouldResearch: true, action: 'search', query, reason: 'current_external_fact', confidence: 0.84, providerPreference };
  }

  if (input.requiresFileChanges && /\b(integrat|connect|provider|external|auth|payment|billing|database|deploy|api|sdk|webhook|oauth)\b/i.test(prompt)) {
    return { shouldResearch: true, action: 'search', query, reason: 'external_integration', confidence: 0.78, providerPreference };
  }

  return { shouldResearch: false, action: 'none', query, reason: 'not_needed', confidence: 0.74, providerPreference };
}

export function researchToPromptContext(result: ResearchResult) {
  if (result.status !== 'completed' || !result.results.length) return '';
  return [
    'Recent web research context:',
    ...result.results.map((item, index) => `${index + 1}. ${item.title} - ${item.url}\n   Source: ${item.source || result.provider}${item.published_at ? `; date: ${item.published_at}` : ''}\n   ${item.snippet}`),
    'Use these sources only as supporting context. Do not invent claims beyond the cited snippets.',
    'Prefer official documentation and primary sources when results conflict.',
  ].join('\n');
}

function skipped(query: string, diagnostic_code: string, message: string): ResearchResult {
  return { status: 'skipped', query, provider: 'none', diagnostic_code, message, results: [] };
}

function failed(query: string, provider: 'firecrawl' | 'tavily' | 'brave', error: any): ResearchResult {
  const message = redactSecrets(error?.message || error || 'Web research failed.', '[redacted]');
  return { status: 'failed', query, provider, diagnostic_code: 'WEB_RESEARCH_FAILED', message, results: [] };
}

function clean(value: unknown) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
}

function sanitizeQuery(value: string) {
  const redacted = redactSecrets(clean(value), '[redacted]').replace(/\s+/g, ' ');
  const url = extractPrimaryUrl(redacted);
  if (url && redacted.length > 180 && /\b(website url|source url|import source|research this website|rebuild this website|use this website|clone my own site)\b/i.test(redacted)) {
    return url;
  }
  return buildSearchQuery(redacted).slice(0, 240);
}

function truncate(value: unknown, limit: number) {
  const text = clean(value).replace(/\s+/g, ' ');
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function safeUrl(value: unknown) {
  const url = clean(value);
  return /^https?:\/\//i.test(url) ? url.slice(0, 500) : '';
}

function looksLikeUrl(value: string) {
  const cleanValue = clean(value);
  return /^https?:\/\//i.test(cleanValue) || /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#][^\s]*)?$/i.test(cleanValue);
}

function normalizeScrapeUrl(value: unknown) {
  const url = clean(value);
  if (/^https?:\/\//i.test(url)) return safeUrl(url);
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#][^\s]*)?$/i.test(url)) return `https://${url}`.slice(0, 500);
  return '';
}

function buildSearchQuery(value: string) {
  const text = clean(value).replace(/\s+/g, ' ');
  if (!text) return '';
  const url = extractPrimaryUrl(text);
  if (url && looksLikeUrl(text)) return url;
  const cleaned = text
    .replace(/Coden import context:/gi, '')
    .replace(/Import instructions:/gi, '')
    .replace(/User request:/gi, '')
    .replace(/Important:.*$/gi, '')
    .replace(/\b(project|files|existingFiles|seniorAgentOS|deepReasoning|uiGenerationPolicy)\b[:=][^{}]{0,180}/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const docsTarget = cleaned.match(/\b(?:docs?|documentation|api|sdk|pricing|deploy|oauth|webhook|latest|recent|current|version|mod[eè]le|tarif|prix|firecrawl|tavily|brave search|recherche en ligne|search the web|look up)\b.{0,140}/i)?.[0];
  if (docsTarget) return truncate(docsTarget, 220);
  return truncate(cleaned, 220);
}

function extractPrimaryUrl(value: unknown) {
  const original = String(value || '');
  const labelledLine = original.match(/\b(?:website url|source url|url|site)\s*:\s*([^\r\n\s)"'<>]+)/i)?.[1];
  if (labelledLine) return normalizeScrapeUrl(labelledLine.replace(/[),.;]+$/g, ''));
  const text = clean(value);
  const explicit = text.match(/\bhttps?:\/\/[^\s)"'<>]+/i)?.[0];
  if (explicit) return normalizeScrapeUrl(explicit.replace(/[),.;]+$/g, ''));
  const labelled = text.match(/\b(?:website url|source url|url|site)\s*:\s*([a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#][^\s)"'<>]*)?)/i)?.[1];
  if (labelled) return normalizeScrapeUrl(labelled.replace(/[),.;]+$/g, ''));
  return '';
}

function hasUsefulResults(result: ResearchResult) {
  return result.status === 'completed' && result.results.some(item => item.url && item.snippet);
}

function normalizeResults(items: ResearchResultItem[], maxResults: number) {
  const seen = new Set<string>();
  const normalized: ResearchResultItem[] = [];
  for (const item of items) {
    const url = safeUrl(item.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    normalized.push({
      title: truncate(item.title || url, 120),
      url,
      snippet: truncate(item.snippet || '', 520),
      published_at: item.published_at || null,
      source: item.source || 'web',
    });
    if (normalized.length >= maxResults) break;
  }
  return normalized;
}

function firecrawlItemToResult(item: any): ResearchResultItem {
  const metadata = item?.metadata || {};
  const url = safeUrl(item?.url || item?.sourceURL || metadata?.sourceURL || metadata?.url);
  const title = item?.title || metadata?.title || url || 'Untitled result';
  const snippet = item?.markdown || item?.content || item?.text || item?.description || item?.snippet || metadata?.description || '';
  return {
    title: truncate(title, 120),
    url,
    snippet: truncate(snippet, 520),
    published_at: item?.publishedDate || item?.published_at || metadata?.publishedTime || metadata?.published_at || null,
    source: 'firecrawl',
  };
}
