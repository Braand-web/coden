import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { sandboxRegistry, SandboxRegistry } from './sandbox/sandbox-registry.ts';
import { launchProjectPreview } from './sandbox/launch.ts';
import { issuePreviewToken } from './sandbox/preview-token.ts';
import { createSandboxTools } from './sandbox/sandbox-tools.ts';
import { runCoderLoop } from './sandbox/repair-loop.ts';
import { runLlmToolLoop } from './llm-tool-loop.ts';
import { runPlannerAgent } from './planner-agent.ts';
import { createAgentEventStream } from './agent-event-stream.ts';
import { buildMissionContext } from './agent-mission-context.ts';
import { selectModel } from './model-selection.ts';
import { MODEL_REGISTRY, AI_MODEL_PLAN_ACCESS } from '../config/ai-models.ts';
import { CodenAgentHarness } from './agent-harness/harness.ts';
import { InMemoryAgentHarnessStore } from './agent-harness/store.ts';

const clean = () => ({ ok: true, problems: [], ran: { devServer: true, typecheck: true, build: true, browser: true }, durationMs: 0 });
const files = new Map<string, string>();
const sandbox = {
  projectId: 'regression-memory', status: () => ({ state: 'running' }), getLogs: () => [],
  hasFile: async (path: string) => files.has(path),
  readProjectFile: async (path: string) => { if (!files.has(path)) throw new Error('missing'); return files.get(path)!; },
  listFiles: async () => [...files.keys()],
  writeFiles: async (items: Array<{path:string;content:string}>) => { for (const item of items) files.set(item.path,item.content); return items.map(item=>item.path); },
  runCommand: vi.fn(async (_command?: string, _args?: readonly string[], _options?: unknown) => ({ code: 0, output: '', timedOut: false })),
};
class ResponseStub extends EventEmitter {
  destroyed = false; writableEnded = false; writableLength = 0; writes: string[] = [];
  status() { return this; } set() { return this; } flushHeaders() {}
  write(value: string) { this.writes.push(value); return true; }
  end() { this.writableEnded = true; } destroy() { this.destroyed = true; }
}

beforeEach(() => {
  files.clear(); files.set('package.json', JSON.stringify({ scripts: { typecheck: 'tsc', build: 'vite build' } }));
  files.set('src/App.tsx', 'existing application');
  sandbox.runCommand.mockReset().mockResolvedValue({ code:0, output:'', timedOut:false });
  vi.spyOn(sandboxRegistry, 'get').mockReturnValue(sandbox as any);
});
afterEach(() => vi.restoreAllMocks());

describe('Agent audit regressions', () => {
  it('reuses the real running preview prefix without reinstalling unchanged dependencies', async () => {
    const basePath=`/preview/${issuePreviewToken({projectId:'regression-memory',userId:'user'})}/`;
    const runtime={...sandbox, status:()=>({state:'running',basePath,port:4173}),stop:vi.fn(),install:vi.fn(),start:vi.fn(async()=>({state:'running',basePath,port:4173}))};
    files.set('node_modules/.package-lock.json','{}');
    vi.mocked(sandboxRegistry.get).mockReturnValue(runtime as any);
    vi.spyOn(sandboxRegistry,'makeRoomFor').mockResolvedValue([]);
    const result=await launchProjectPreview({projectId:'regression-memory',userId:'user',files:[{path:'package.json',content:files.get('package.json')!}]});
    expect(result.previewUrl).toBe(basePath);expect(runtime.stop).not.toHaveBeenCalled();expect(runtime.install).not.toHaveBeenCalled();
  });
  it('prevents concurrent writers and never evicts an active run', async () => {
    const registry=new SandboxRegistry({maxRunning:1});
    const release=registry.reserveRun('a');
    const active=registry.get('a');vi.spyOn(active,'status').mockReturnValue({state:'running'} as any);
    const stop=vi.spyOn(active,'stop');
    expect(()=>registry.reserveRun('a')).toThrow('already owns');
    expect(()=>registry.reserveRun('b')).toThrow('slots are busy');
    await expect(registry.makeRoomFor('b')).rejects.toThrow('cannot be evicted');
    expect(await registry.sweepIdle(Date.now()+99999999)).toEqual([]);expect(stop).not.toHaveBeenCalled();
    release();expect(()=>registry.reserveRun('b')()).not.toThrow();
  });
  it('keeps a compatible manual model pinned and rejects forbidden access', () => {
    const requestedModel = 'openai/gpt-5.6-terra';
    expect(selectModel({task:'code_edit',plan:'business',requestedModel,needs:{tools:true}}).modelId).toBe(requestedModel);
    const premium = MODEL_REGISTRY.find(model => ['business','enterprise'].includes(AI_MODEL_PLAN_ACCESS[model.id].toLowerCase()));
    expect(premium).toBeDefined();
    expect(()=>selectModel({task:'code_edit',plan:'free',requestedModel:premium!.id})).toThrow('No eligible model');
    expect(()=>selectModel({task:'code_edit',plan:'business',requestedModel:'made-up-model'})).toThrow('not available');
  });
  it('never marks a run completed with required pending checks or mislabels dollars as credits', async () => {
    const harness = new CodenAgentHarness(new InMemoryAgentHarnessStore());
    const thread = await harness.createThread({organizationId:'org',projectId:'project',userId:'user'});
    const {turn}=await harness.createTurn({threadId:thread.id,userId:'user',prompt:'Build',idempotencyKey:'gate',definitionOfDone:[{id:'behavior',label:'behavior',required:true,status:'pending'}]});
    await harness.transitionTurn(turn.id,'running');
    await expect(harness.transitionTurn(turn.id,'completed')).rejects.toThrow('verification is incomplete');
    const spent=await harness.recordSpend(turn.id,{costUsd:0.03,toolCalls:2});
    expect(spent.budgetUsed.credits).toBe(0);expect(spent.budgetUsed.costUsd).toBe(0.03);
    await harness.settleDefinitionOfDone(turn.id,{behavior:{status:'passed',evidence:'Executed assertion'}});
    expect((await harness.transitionTurn(turn.id,'completed')).status).toBe('completed');
  });
  it('does not count writing unchanged content as an implementation', async () => {
    const changes:string[][]=[];
    const tools=createSandboxTools('regression-memory',{onChange:paths=>changes.push(paths)});
    const result:any=await tools.call('write_file',{path:'src/App.tsx',content:files.get('src/App.tsx')});
    expect(result.unchanged).toBe(true);expect(changes).toEqual([]);
  });
  it('does not complete a modification with no changed files', async () => {
    const result = await runCoderLoop({ sandbox:sandbox as any, mode:'build', initialInstruction:'Make the button blue', maxRounds:2, initialReport:clean(), turn:async()=>({toolCalls:0}), verifyPreview:async()=>clean() });
    expect(result.ok).toBe(false);
    expect(result.finalReport.problems.some(problem=>problem.message.includes('NO_CHANGES'))).toBe(true);
  });
  it('preserves the original mission and previous steering in repair rounds', async () => {
    const instructions:string[]=[];
    let round=0;
    sandbox.runCommand.mockImplementation(async()=>round===1 ? {code:1,output:'src/App.tsx(1,1): error TS2304: Missing X',timedOut:false} : {code:0,output:'',timedOut:false});
    const result=await runCoderLoop({sandbox:sandbox as any, mode:'build', initialInstruction:'CART_PERSISTENCE_REQUIRED',initialReport:clean(),maxRounds:2,
      beforeRound:async index=>index===1?'KEEP_BLUE_DESIGN':undefined,
      turn:async ({instruction,call})=>{round++;instructions.push(instruction);await call('write_file',{path:'src/App.tsx',content:`cart implementation ${round}`});return {toolCalls:1};},verifyPreview:async()=>clean()});
    expect(result.ok).toBe(true); expect(instructions[1]).toContain('CART_PERSISTENCE_REQUIRED'); expect(instructions[1]).toContain('KEEP_BLUE_DESIGN');
  });
  it('reads every character of long files using an explicit cursor', async()=>{
    const source='x'.repeat(30000)+'FINAL_COMPONENT';files.set('long.ts',source);
    const tools=createSandboxTools('regression-memory');let offset=0;let joined='';
    for(let page=0;page<10;page++) {const result:any=await tools.call('read_file',{path:'long.ts',offset,limit:12000});expect(result.ok).toBe(true);joined+=result.content;if(result.nextOffset===null)break;offset=result.nextOffset;}
    expect(joined).toBe(source);
  });
  it('never returns malformed JSON when serializing tool output',async()=>{
    let calls=0;const gateway={chat:async()=>++calls===1?{text:'',model:'mock',tool_calls:[{id:'read',type:'function',function:{name:'read_file',arguments:'{}'}}]}:{text:'done',model:'mock'}};
    const result=await runLlmToolLoop({gateway:gateway as any,modelId:'mock',messages:[],handlers:{read_file:()=>({ok:true,content:'x'.repeat(22000)+'TAIL'})}});
    const content=String(result.messages.find(message=>message.role==='tool')?.content);
    expect(JSON.parse(content).content.endsWith('TAIL')).toBe(true);
  });
  it('reports failed commands as failures and forwards cancellation',async()=>{
    sandbox.runCommand.mockResolvedValue({code:1,output:'test failed',timedOut:false});const signal=new AbortController().signal;
    const result:any=await createSandboxTools('regression-memory',{signal}).call('run_command',{command:'npm',args:['test']});
    expect(result.ok).toBe(false);expect(result.exitCode).toBe(1);expect(sandbox.runCommand.mock.calls[0]?.[2]).toEqual(expect.objectContaining({signal}));
  });
  /*
   * A run out of time stops; it does not spend its last moments on a call that
   * cannot finish.
   *
   * This test used to require the opposite — that the leftover milliseconds be
   * handed to the provider as a timeout. That call expired by construction,
   * and the gateway could only classify the result as `PROVIDER_TIMEOUT`,
   * `retryable: true`: a failure charged to the model's circuit breaker, which
   * is process-wide and keyed by model alone. Three runs reaching their own
   * budget closed that model for every user — the "modèle temporairement
   * indisponible" that production showed constantly.
   *
   * The half of the old contract that was right is kept below: a call that
   * does start must still be capped so it cannot outlive the run's deadline.
   */
  it('stops on its own time budget instead of starting a call that cannot finish',async()=>{
    let called=false;
    const gateway={chat:async()=>{called=true;await new Promise(resolve=>setTimeout(resolve,20));return {text:'late',model:'mock'};}};
    const result=await runLlmToolLoop({gateway:gateway as any,modelId:'mock',messages:[],handlers:{},budget:{maxDurationMs:5}});
    expect(called).toBe(false);expect(result.spend.stoppedBecause).toBe('time_budget');
  });
  it('caps a call it does start at the time the run has left',async()=>{
    let timeout=Infinity;
    const gateway={chat:async(_model:unknown,_messages:unknown,options:any)=>{timeout=options.timeoutMs;return {text:'done',model:'mock'};}};
    const budgetMs=30_000;
    await runLlmToolLoop({gateway:gateway as any,modelId:'mock',messages:[],handlers:{},budget:{maxDurationMs:budgetMs}});
    expect(timeout).toBeGreaterThan(0);expect(timeout).toBeLessThanOrEqual(budgetMs);
  });
  it('sends source excerpts to the planner',async()=>{
    let observed='';const gateway={chat:async(_model:unknown,messages:unknown)=>{observed=JSON.stringify(messages);return {text:JSON.stringify({summary:'Add cart',files:[{path:'src/App.tsx',action:'edit',rationale:'cart'}]})};}};
    await runPlannerAgent({gateway:gateway as any,prompt:'Add cart',existingFiles:[{path:'src/App.tsx',content:'ACTUAL_SOURCE_CONTENT'}],plan:'business',credits:1000});
    expect(observed).toContain('ACTUAL_SOURCE_CONTENT');
  });
  it('recovers a transient persistence failure without losing event order',async()=>{
    const response=new ResponseStub();let attempts=0;const persisted:number[]=[];
    const stream=createAgentEventStream(response as any,'run',{retryDelayMs:0,persist:async event=>{attempts++;if(attempts===1)throw new Error('temporary');persisted.push(event.seq);}});
    stream.chat({type:'text_delta',delta:'one'});stream.chat({type:'text_delta',delta:'two'});
    await stream.finish({success:true},200);
    expect(response.destroyed).toBe(false);expect(response.writableEnded).toBe(true);expect(persisted).toEqual([...new Set(persisted)].sort((a,b)=>a-b));
    expect(response.writes.join('')).toContain('onetwo');expect(response.writes.join('')).toContain('run_finished');
  });
  it('does not emit success after permanent persistence failure',async()=>{
    const response=new ResponseStub();const stream=createAgentEventStream(response as any,'run',{retryDelayMs:0,persist:async()=>{throw new Error('offline');}});
    stream.chat({type:'text_delta',delta:'work'});await expect(stream.finish({success:true},200)).rejects.toThrow('offline');
    expect(response.destroyed).toBe(true);expect(response.writes.join('')).not.toContain('run_finished');
  });
  it('loads at most three writer skills and preserves the approved plan',()=>{
    const context=buildMissionContext({prompt:'Build a database landing page',approvedPlan:'APPROVED_SCOPE',history:[{role:'user',content:'KEEP_BLUE'}],fileCount:30});
    expect(context.skillIds.length).toBeLessThanOrEqual(3);expect(context.text).toContain('APPROVED_SCOPE');expect(context.text).toContain('KEEP_BLUE');
  });
});
