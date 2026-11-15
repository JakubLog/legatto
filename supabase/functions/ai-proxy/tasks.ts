// Rejestr zadan AI wykonywanych przez ai-proxy.
//
// Interpelacje sa generowane po stronie klienta MCP i wgrywane gotowym HTML-em.
// Proxy pozostaje punktem rozszerzen dla przyszlych, jawnie zdefiniowanych zadan AI.

export interface BuiltPrompt {
  system: string;
  prompt: string;
  maxTokens: number;
}

type TaskRunner = (input: unknown) => BuiltPrompt | { error: string };

const TASKS: Record<string, TaskRunner> = {};

export function buildTaskPrompt(task: string, input: unknown): BuiltPrompt | { error: string } {
  if (!Object.hasOwn(TASKS, task)) return { error: `Nieznane zadanie AI: ${task}` };
  return TASKS[task](input);
}
