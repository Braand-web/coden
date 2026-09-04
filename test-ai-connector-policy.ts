import assert from 'node:assert/strict';
import { buildGenerationSystemPrompt } from './src/services/agent-prompt-stack.ts';
import { detectCodenCloudRequirements } from './src/services/coden-cloud.ts';
import {
  applyCodenFullstackKit,
  validateCodenFullstackFiles,
} from './src/services/fullstack-generation.ts';
import { scanGeneratedSecurity } from './src/services/generated-security-scanner.ts';

const systemPrompt = buildGenerationSystemPrompt({
  prompt: 'Create an AI chatbot that streams answers token by token for users.',
  uiPolicySystemPrompt: 'Use the Coden design system.',
  hasExistingFiles: false,
});

assert.match(systemPrompt, /Built-in AI Connector policy/);
assert.match(systemPrompt, /supabase\/functions\/ai-stream\/index\.ts/);
assert.match(systemPrompt, /src\/lib\/aiStream\.ts/);
assert.match(systemPrompt, /text\/event-stream/);
assert.match(systemPrompt, /AbortController/);
assert.match(systemPrompt, /HLS\/DASH/);
assert.match(systemPrompt, /must never contain provider API keys/i);

const badFrontendProviderCall = scanGeneratedSecurity([
  {
    path: 'src/App.tsx',
    language: 'tsx',
    content: [
      "import OpenAI from 'openai';",
      'const client = new OpenAI({ apiKey: import.meta.env.VITE_OPENAI_API_KEY });',
      'export default function App() {',
      '  return <main><h1>AI chatbot</h1><p>Streaming AI response</p></main>;',
      '}',
    ].join('\n'),
  },
]);

assert.equal(badFrontendProviderCall.status, 'failed');
assert.ok(badFrontendProviderCall.checks.some(check => check.key === 'security_ai_connector_server_side' && check.status === 'fail'));
assert.ok(badFrontendProviderCall.checks.some(check => check.key === 'security_ai_no_frontend_provider_call' && check.status === 'fail'));

const goodConnectorScan = scanGeneratedSecurity([
  {
    path: 'src/App.tsx',
    language: 'tsx',
    content: [
      "import { streamAiResponse } from './lib/aiStream';",
      'export default function App() {',
      '  return <main><h1>AI assistant</h1><button>Cancel stream</button></main>;',
      '}',
    ].join('\n'),
  },
  {
    path: 'src/lib/aiStream.ts',
    language: 'ts',
    content: [
      'export async function streamAiResponse() {',
      '  const controller = new AbortController();',
      "  const response = await fetch('/functions/v1/ai-stream', { signal: controller.signal });",
      '  if (!response.ok) throw new Error("AI_STREAM_UNAVAILABLE");',
      '  return response.body?.getReader();',
      '}',
    ].join('\n'),
  },
  {
    path: 'supabase/functions/ai-stream/index.ts',
    language: 'ts',
    content: [
      'Deno.serve(() => {',
      '  const key = Deno.env.get("OPENAI_API_KEY");',
      '  if (!key) return new Response("missing", { status: 500 });',
      '  return new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } });',
      '});',
    ].join('\n'),
  },
]);

assert.equal(goodConnectorScan.checks.find(check => check.key === 'security_ai_connector_server_side')?.status, 'pass');
assert.equal(goodConnectorScan.checks.find(check => check.key === 'security_ai_no_frontend_provider_call')?.status, 'pass');
assert.equal(goodConnectorScan.status, 'passed');

const aiPrompt = 'Build an AI tool with a prompt workspace, streamed responses, generation history and usage tracking.';
const requirement = detectCodenCloudRequirements(aiPrompt);
const files = applyCodenFullstackKit({
  files: [
    {
      path: 'package.json',
      language: 'json',
      content: JSON.stringify({
        scripts: {
          dev: 'vite',
          build: 'vite build',
          test: 'node --experimental-strip-types src/app.test.ts',
          lint: 'tsc --noEmit',
        },
        dependencies: {
          react: 'latest',
          'react-dom': 'latest',
        },
      }, null, 2),
    },
    {
      path: 'src/App.tsx',
      language: 'tsx',
      content: 'export default function App() { return <main>AI workspace</main>; }',
    },
  ],
  projectName: 'AI Workspace',
  prompt: aiPrompt,
  requirement,
});

const byPath = new Map(files.map(file => [file.path, file.content]));
assert.ok(byPath.has('src/lib/aiStream.ts'));
assert.ok(byPath.has('supabase/functions/ai-stream/index.ts'));
assert.ok(byPath.has('src/ai-stream.test.ts'));
assert.match(byPath.get('package.json') || '', /src\/ai-stream\.test\.ts/);
assert.match(byPath.get('src/lib/aiStream.ts') || '', /AbortController/);
assert.match(byPath.get('src/lib/aiStream.ts') || '', /\/functions\/v1\/ai-stream/);
assert.match(byPath.get('supabase/functions/ai-stream/index.ts') || '', /text\/event-stream/);
assert.match(byPath.get('supabase/functions/ai-stream/index.ts') || '', /Deno\.env\.get/);
const connector = byPath.get('supabase/functions/ai-stream/index.ts') || '';
assert.match(connector, /https:\/\/openrouter\.ai\/api\/v1\/chat\/completions/);
assert.match(connector, /OPENROUTER_API_KEY/);
assert.doesNotMatch(connector, /api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com|ANTHROPIC_API_KEY|GEMINI_API_KEY/);
assert.doesNotMatch(byPath.get('src/lib/aiStream.ts') || '', /VITE_(OPENAI|ANTHROPIC|GEMINI|GOOGLE|DEEPSEEK|FAL).*KEY|new\s+OpenAI|Anthropic\(/i);

const validationChecks = validateCodenFullstackFiles(files, requirement);
assert.equal(validationChecks.filter(check => check.status === 'fail').length, 0, validationChecks.map(check => `${check.key}: ${check.message}`).join('\n'));
assert.ok(validationChecks.some(check => check.key === 'fullstack_ai_stream_client_present'));
assert.ok(validationChecks.some(check => check.key === 'fullstack_ai_stream_function_present'));
assert.ok(validationChecks.some(check => check.key === 'fullstack_ai_stream_sse'));
assert.ok(validationChecks.some(check => check.key === 'fullstack_ai_secrets_server_side'));

console.log('test-ai-connector-policy passed');
