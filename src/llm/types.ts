import type { ModelRole } from '../config/models.js';

export type { ModelRole };

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON arguments as produced by the model. */
  arguments: string;
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema of the arguments. */
  parameters: Record<string, unknown>;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatRequest {
  role: ModelRole;
  messages: ChatMessage[];
  tools?: ToolDef[];
  /** `response_format: json_object`. */
  json?: boolean;
  stream?: boolean;
  /** Streaming text deltas. */
  onDelta?: (text: string) => void;
  temperature?: number;
  signal?: AbortSignal;
}

export interface ChatResponse {
  content: string | null;
  toolCalls: ToolCall[];
  model: string;
  usage: LlmUsage;
  finishReason: string | undefined;
}

export interface LlmClient {
  chat(req: ChatRequest): Promise<ChatResponse>;
}
