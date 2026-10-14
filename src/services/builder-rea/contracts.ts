export type ReaToolName = 'rea_inspect_artifact' | 'rea_analyze_javascript' | 'rea_read_analysis' | 'rea_trace_feature';
export type ReaTools = {
  schemas: Array<{ name: ReaToolName; description: string; parameters: Record<string, unknown> }>;
  guidance: string;
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
  dispose(): Promise<void>;
};
export type ReaClient = {
  callTool(input: { name: string; arguments: Record<string, unknown> }, options?: { signal?: AbortSignal; timeout?: number }): Promise<unknown>;
  close(): Promise<void>;
};
