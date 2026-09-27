import assert from 'node:assert/strict';
import { WebResearchGateway, buildWebResearchPlan, decideWebResearch, researchToPromptContext, shouldUseWebResearch } from './src/services/web-research-gateway.ts';

assert.equal(shouldUseWebResearch({ prompt: 'bonjour', intent: 'conversation' }), false);
assert.equal(shouldUseWebResearch({ prompt: 'Check the latest Supabase auth docs', intent: 'build', requiresFileChanges: true }), true);
assert.equal(shouldUseWebResearch({ prompt: 'Add Stripe billing integration', intent: 'build', requiresFileChanges: true }), true);
assert.equal(shouldUseWebResearch({ prompt: 'crée une mini app pomodoro moderne', intent: 'build', requiresFileChanges: true }), false);
assert.equal(shouldUseWebResearch({ prompt: 'corrige le bug du bouton publish', intent: 'debug', requiresFileChanges: true }), false);
assert.equal(shouldUseWebResearch({ prompt: 'Recherche en ligne les dernières docs Vercel pour les domaines', intent: 'build', requiresFileChanges: true }), true);

const urlPlan = buildWebResearchPlan({
  prompt: 'Coden import context:\nSource URL: firecrawl.dev\nUser request: analyse ce site web',
  intent: 'build',
  requiresFileChanges: true,
});
assert.equal(urlPlan.shouldResearch, true);
assert.equal(urlPlan.action, 'scrape');
assert.equal(urlPlan.query, 'https://firecrawl.dev/');

const simpleBuildDecision = decideWebResearch({
  prompt: 'crée une application web de livraison avec suivi des commandes',
  intent: 'build',
  requiresFileChanges: true,
});
assert.equal(simpleBuildDecision.shouldResearch, false);
assert.equal(simpleBuildDecision.action, 'none');
assert.equal(simpleBuildDecision.reason, 'not_needed');

const explicitResearchDecision = decideWebResearch({
  prompt: 'cherche sur internet les nouvelles règles de custom domains Vercel',
  intent: 'build',
  requiresFileChanges: true,
});
assert.equal(explicitResearchDecision.shouldResearch, true);
assert.equal(explicitResearchDecision.action, 'search');
assert.equal(explicitResearchDecision.reason, 'explicit_web_research');
assert.ok(explicitResearchDecision.confidence >= 0.9);
assert.deepEqual(explicitResearchDecision.providerPreference.slice(0, 2), ['firecrawl', 'tavily']);

const providerDebugDecision = decideWebResearch({
  prompt: 'OpenRouter retourne PROVIDER_TIMEOUT avec ce modèle, vérifie les docs API',
  intent: 'debug',
  requiresFileChanges: true,
});
assert.equal(providerDebugDecision.shouldResearch, true);
assert.equal(providerDebugDecision.action, 'search');

const internalDebugDecision = decideWebResearch({
  prompt: 'corrige le blocage restant et la preview blanche dans ce projet',
  intent: 'debug',
  requiresFileChanges: true,
});
assert.equal(internalDebugDecision.shouldResearch, false);
assert.equal(internalDebugDecision.action, 'none');

const gateway = new WebResearchGateway({});
const skipped = await gateway.search('latest OpenRouter model availability');
assert.equal(skipped.status, 'skipped');
assert.equal(skipped.diagnostic_code, 'WEB_RESEARCH_NOT_CONFIGURED');
assert.equal(skipped.results.length, 0);

const calls: Array<{ url: string; body?: any }> = [];
const scrapeMarkdown = `Firecrawl clean markdown ${'x'.repeat(1_000)}`;
const mockFetch: any = async (url: string, init: any) => {
  calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
  return {
    ok: true,
    status: 200,
    async json() {
      if (url.includes('/scrape')) {
        return { success: true, data: { url: 'https://firecrawl.dev', markdown: scrapeMarkdown, metadata: { title: 'Firecrawl' } } };
      }
      return { success: true, data: { web: [{ url: 'https://docs.firecrawl.dev', title: 'Firecrawl Docs', description: 'Search result markdown' }] } };
    },
  };
};

const firecrawlGateway = new WebResearchGateway({ FIRECRAWL_API_KEY: 'fc-test' }, mockFetch);
assert.equal(firecrawlGateway.isConfigured(), true);

const firecrawlSearch = await firecrawlGateway.search('Firecrawl docs search');
assert.equal(firecrawlSearch.status, 'completed');
assert.equal(firecrawlSearch.provider, 'firecrawl');
assert.equal(firecrawlSearch.results[0]?.source, 'firecrawl');
assert.ok(calls.some(call => call.url.includes('/search')));
assert.deepEqual(calls.find(call => call.url.includes('/search'))?.body.sources, ['web']);
assert.equal(calls.find(call => call.url.includes('/search'))?.body.maxResults, undefined);

const firecrawlScrape = await firecrawlGateway.search('https://firecrawl.dev');
assert.equal(firecrawlScrape.status, 'completed');
assert.equal(firecrawlScrape.provider, 'firecrawl');
assert.ok(firecrawlScrape.results[0]?.snippet.includes('Firecrawl clean markdown'));
assert.ok((firecrawlScrape.results[0]?.snippet.length || 0) > 520);
assert.ok(calls.some(call => call.url.includes('/scrape')));
assert.deepEqual(calls.find(call => call.url.includes('/scrape'))?.body.formats, ['markdown']);

const bareDomainScrape = await firecrawlGateway.scrape('firecrawl.dev');
assert.equal(bareDomainScrape.status, 'completed');
assert.equal(calls.at(-1)?.body.url, 'https://firecrawl.dev/');

const embeddedUrlScrape = await firecrawlGateway.search('Coden import context:\nSource URL: firecrawl.dev\nUser request: analyse ce site web');
assert.equal(embeddedUrlScrape.status, 'completed');
assert.equal(embeddedUrlScrape.provider, 'firecrawl');
assert.equal(calls.at(-1)?.body.url, 'https://firecrawl.dev/');

const callCountBeforeRejectedUrls = calls.length;
for (const url of ['http://localhost:3000/', 'http://127.0.0.1/', 'http://169.254.169.254/', 'https://user:password@firecrawl.dev/', 'https://firecrawl.dev:3000/']) {
  assert.equal((await firecrawlGateway.scrape(url)).diagnostic_code, 'WEB_RESEARCH_URL_INVALID');
}
assert.equal(calls.length, callCountBeforeRejectedUrls);

const fallbackCalls: Array<{ url: string; body?: any }> = [];
const fallbackFetch: any = async (url: string, init: any) => {
  fallbackCalls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
  return {
    ok: true,
    status: 200,
    async json() {
      if (url.includes('firecrawl.dev')) return { success: true, data: { web: [] } };
      return {
        results: [{
          url: 'https://docs.tavily.com',
          title: 'Tavily Docs',
          content: 'Tavily fallback result from current docs.',
        }],
      };
    },
  };
};
const fallbackGateway = new WebResearchGateway({ FIRECRAWL_API_KEY: 'fc-test', TAVILY_API_KEY: 'tv-test' }, fallbackFetch);
const fallbackResult = await fallbackGateway.search('latest Tavily API documentation');
assert.equal(fallbackResult.status, 'completed');
assert.equal(fallbackResult.provider, 'tavily');
assert.equal(fallbackResult.results[0]?.url, 'https://docs.tavily.com');
assert.ok(fallbackCalls.some(call => call.url.includes('firecrawl.dev')));
assert.ok(fallbackCalls.some(call => call.url.includes('tavily.com')));

const limitedGateway = new WebResearchGateway({ FIRECRAWL_API_KEY: 'fc-test' }, (async () => ({ ok: false, status: 429 })) as any);
const limited = await limitedGateway.search('latest API documentation');
assert.equal(limited.status, 'failed');
assert.match(limited.message, /provider rate limit/i);

const context = researchToPromptContext({
  status: 'completed',
  provider: 'firecrawl',
  query: 'docs',
  message: 'Research completed.',
  results: [{ title: 'Official docs', url: 'https://example.com/docs', snippet: 'Use the current API.' }],
});
assert.ok(context.includes('https://example.com/docs'));
assert.ok(context.includes('Recent web research context'));

console.log('test-web-research-gateway passed');
