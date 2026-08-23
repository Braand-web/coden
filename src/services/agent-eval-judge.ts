import { normalizeExecutionText } from './execution-contract.ts';

export type EvalJudgeResult = {
  passed: boolean;
  score: number;
  failures: string[];
  suggestedFixes: string[];
};

/**
 * Static heuristic judge — fast, zero-cost gate before LLM judge.
 * Catches the most obvious failure patterns without an extra API call.
 */
export function evaluateAgentOutput(
  prompt: string,
  output: string,
  appType: string,
  architectRequirements: string[]
): EvalJudgeResult {
  const result: EvalJudgeResult = {
    passed: true,
    score: 100,
    failures: [],
    suggestedFixes: [],
  };

  const text = normalizeExecutionText(output);
  const outputLower = output.toLowerCase();

  // 1. Fake-success guard
  if (text.length < 80 && /\b(done|ready|finished|complete|completed)\b/i.test(text)) {
    result.failures.push('Output claims success but is too short to be a real implementation.');
    result.suggestedFixes.push('Generate the actual code implementation instead of just confirming.');
    result.score -= 45;
  }

  // 2. Raw JSON or internal contract leaked to user
  if (/coden_deep_reasoning_contract|CODEN_DEEP_REASONING/i.test(output)) {
    result.failures.push('Internal reasoning contract was leaked into the generated output.');
    result.suggestedFixes.push('Strip all internal contract JSON. Deliver only user-facing code and a short summary.');
    result.score -= 60;
  }

  // 3. Runtime exception patterns in code
  if (/undefined is not a function|cannot read properties of undefined|is not defined/i.test(text)) {
    result.failures.push('Code contains JavaScript runtime exception patterns.');
    result.suggestedFixes.push('Add optional chaining (obj?.property), null guards, and default values.');
    result.score -= 50;
  }

  // 4. Missing entry point for React/Vite apps
  const isReactApp = /react|tsx|jsx|vite|tailwind/i.test(output);
  if (isReactApp && !/index\.html|<div id="root"|src\/main\.(t|j)sx?/i.test(output)) {
    result.failures.push('React/Vite app is missing index.html or src/main.tsx entry point.');
    result.suggestedFixes.push('Always include index.html with <div id="root"></div> and src/main.tsx for React/Vite projects.');
    result.score -= 35;
  }

  // 5. Architecture-specific checks
  if (/(ecommerce|saas|crm|marketplace)/i.test(appType) && !/supabase|database|sql|fetch|localstorage/i.test(outputLower)) {
    result.failures.push(`App type ${appType} requires data persistence, but none was found in the output.`);
    result.suggestedFixes.push('Implement localStorage for local persistence or Supabase for production persistence.');
    result.score -= 30;
  }

  // 6. Blank preview risk — no meaningful HTML/TSX output
  if (output.length < 200 && !/<!DOCTYPE|<html|function |const |import /i.test(output)) {
    result.failures.push('Output is too minimal — the preview would likely be blank.');
    result.suggestedFixes.push('Generate complete, renderable file content with HTML structure or React components.');
    result.score -= 40;
  }

  // 7. Security: client-side secret exposure
  if (/service_role|SUPABASE_SERVICE_ROLE|sk-[a-z0-9]{32}|OPENROUTER_API_KEY/i.test(output)) {
    result.failures.push('CRITICAL: Output contains a server-side secret or service role key that must never be in client code.');
    result.suggestedFixes.push('Remove all server-side secrets. Use only publishable/anon keys in frontend code. Keep service role keys server-side only.');
    result.score -= 80;
  }

  // 8. Dead controls — buttons/forms with no onClick/onSubmit
  if (/\<button/i.test(output) && !/onclick|onsubmit|onclick|addEventListener|handleClick|handleSubmit/i.test(output)) {
    result.failures.push('Buttons or forms are present but have no event handlers — controls appear dead.');
    result.suggestedFixes.push('Add onClick handlers to all interactive buttons and onSubmit to forms with real state updates.');
    result.score -= 20;
  }

  // 9. Architect requirements check
  for (const req of architectRequirements) {
    const reqNorm = req.toLowerCase().replace(/\s+/g, ' ').trim();
    if (reqNorm && !outputLower.includes(reqNorm)) {
      result.failures.push(`Failed architectural requirement: "${req}"`);
      result.suggestedFixes.push(`Ensure the generated code explicitly implements: ${req}`);
      result.score -= 15;
    }
  }

  // 10. Lorem ipsum / placeholder copy leak
  if (/lorem ipsum|placeholder text|feature 1|card title|your product/i.test(output)) {
    result.failures.push('Output contains generic placeholder copy (lorem ipsum / "Feature 1" / "Card title").');
    result.suggestedFixes.push('Replace all placeholder copy with realistic domain-relevant content that matches the app type.');
    result.score -= 15;
  }

  if (result.score < 70 || result.failures.length > 0) {
    result.passed = false;
  }

  return result;
}

/**
 * Builds a structured retry prompt when the heuristic judge fails.
 * Includes the original intent + specific failure + fix instructions.
 */
export function buildRetryPrompt(originalPrompt: string, evalResult: EvalJudgeResult): string {
  const failureList = evalResult.failures.map(f => `• ${f}`).join('\n');
  const fixList = evalResult.suggestedFixes.map(f => `• ${f}`).join('\n');

  return `
[AUTOMATED QUALITY REVIEW — RETRY REQUIRED]
Your previous generation scored ${evalResult.score}/100 and failed the following quality gates:

FAILURES:
${failureList}

REQUIRED FIXES:
${fixList}

IMPORTANT:
- Fix all the issues listed above before returning code.
- Do NOT acknowledge this message or explain what you will do — just generate the corrected code.
- Preserve all working parts; only fix what is listed.
- Original user request: "${originalPrompt.slice(0, 500)}"
  `.trim();
}

/**
 * Builds a prompt for an AI-powered second-opinion judge.
 * This is used when the heuristic judge passes but we want a deeper review
 * (e.g. for complex apps, security-sensitive features, or production-readiness checks).
 */
export function buildAiJudgePrompt(
  originalPrompt: string,
  generatedOutput: string,
  appType: string,
): string {
  const truncatedOutput = generatedOutput.slice(0, 12_000); // stay within context limits
  return `
You are a strict senior code reviewer evaluating AI-generated code for production readiness.

USER REQUEST:
"${originalPrompt.slice(0, 600)}"

APP TYPE: ${appType}

GENERATED CODE (truncated):
\`\`\`
${truncatedOutput}
\`\`\`

Evaluate the code on these criteria and respond ONLY with a JSON object:
{
  "score": <0-100>,
  "passed": <true|false>,
  "critical_failures": [<string>],
  "warnings": [<string>],
  "suggested_fixes": [<string>]
}

Criteria:
1. Does the app render without a blank screen? (index.html + entry point present if React/Vite)
2. Do interactive controls have real event handlers?
3. Is there data persistence appropriate to the app type?
4. Are there any exposed secrets or service role keys? (INSTANT FAIL if yes)
5. Is the copy realistic and domain-appropriate (not lorem ipsum)?
6. Does the code meet the user's stated requirements?
7. Is responsive/mobile layout implemented?
8. Are error, loading, and empty states handled for core flows?

Score below 75 = passed: false.
`.trim();
}
