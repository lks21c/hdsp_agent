/**
 * Core type definitions for Jupyter Agent extension
 */

export enum CellAction {
  EXPLAIN = 'explain',
  FIX = 'fix',
  CUSTOM_PROMPT = 'custom_prompt'
}

export interface ICellActionEvent {
  type: CellAction;
  cellId: string;
  cellContent: string;
  customPrompt?: string;
  context?: {
    notebookPath?: string;
    cellIndex?: number;
    previousCells?: string[];
  };
}

export interface ICellActionRequest {
  cellId: string;
  cellContent: string;
  action: 'explain' | 'fix' | 'custom';
  customPrompt?: string;
  context?: {
    notebookPath: string;
    cellIndex: number;
    previousCells?: string[];
  };
}

export interface ICellResponse {
  cellId: string;
  response: string;
  suggestions?: string[];
  fixedCode?: string;
  metadata: {
    model: string;
    tokens: number;
    duration: number;
  };
}

export interface IChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

// ═══════════════════════════════════════════════════════════════════════════
// LLM Configuration Types (Client-side managed)
// ═══════════════════════════════════════════════════════════════════════════

export interface IGeminiConfig {
  apiKey: string;  // Primary key for backward compatibility
  apiKeys?: string[];  // Multiple keys (max 10) for rate limit rotation
  model: string;
}

export interface IOpenAIConfig {
  apiKey: string;
  model: string;
}

export interface IVLLMConfig {
  endpoint: string;
  apiKey?: string;
  model: string;
}

export interface IResourceUsageSnapshot {
  environment?: string;
  cpu?: {
    cores?: number;
    usage_percent?: number | null;
  };
  memory?: {
    total_gb?: number | null;
    available_gb?: number | null;
    used_gb?: number | null;
  };
  disk?: {
    path?: string;
    total_gb?: number | null;
    free_gb?: number | null;
    used_gb?: number | null;
  };
  gpus?: Array<{
    name?: string;
    utilization_percent?: number | null;
    memory_used_mb?: number | null;
    memory_total_mb?: number | null;
  }>;
  gpu_status?: string;
}

export interface ILLMConfig {
  provider: 'gemini' | 'openai' | 'vllm';
  gemini?: IGeminiConfig;
  openai?: IOpenAIConfig;
  vllm?: IVLLMConfig;
  workspaceRoot?: string;
  systemPrompt?: string;
  autoApprove?: boolean;
  resourceContext?: IResourceUsageSnapshot | string;
}

export interface IChatRequest {
  message: string;
  conversationId?: string;
  context?: {
    selectedCells?: string[];
    notebookPath?: string;
  };
  llmConfig?: ILLMConfig;
}

export interface IChatResponse {
  messageId: string;
  content: string;
  conversationId: string;
  metadata: {
    model: string;
    tokens: number;
  };
}

export interface IAgentConfig {
  provider?: 'gemini' | 'vllm' | 'openai';
  gemini?: {
    apiKey: string;
    model: string;
  };
  vllm?: {
    endpoint: string;
    apiKey: string;
    model: string;
  };
  openai?: {
    apiKey: string;
    model: string;
  };
  // Legacy fields for backward compatibility
  apiKey?: string;
  modelId?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface IHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  apiConnected: boolean;
  modelAvailable: boolean;
}

export interface IModelInfo {
  id: string;
  name: string;
  provider: string;
  capabilities: string[];
}

export enum AgentEvent {
  CELL_ACTION = 'hdsp-agent:cell-action',
  CONFIG_CHANGED = 'hdsp-agent:config-changed',
  MESSAGE_SENT = 'hdsp-agent:message-sent',
  MESSAGE_RECEIVED = 'hdsp-agent:message-received'
}

export interface INotebookGenerationRequest {
  prompt: string;
  outputDir?: string;
}

export interface INotebookGenerationResponse {
  taskId: string;
  status: string;
  message: string;
}

export interface ITaskStatus {
  taskId: string;
  prompt: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  message: string;
  result?: any;
  error?: string;
  notebookPath?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// File Action Types (Python 파일 에러 수정용)
// ═══════════════════════════════════════════════════════════════════════════

export enum FileAction {
  FIX = 'fix',
  EXPLAIN = 'explain',
  CUSTOM = 'custom'
}

export interface IFileInfo {
  path: string;
  content: string;
}

export interface IFileFixRequest {
  action: FileAction | 'fix' | 'explain' | 'custom';
  mainFile: IFileInfo;
  errorOutput?: string;
  relatedFiles?: IFileInfo[];
  customPrompt?: string;
}

export interface IFixedFile {
  path: string;
  content: string;
}

export interface IFileFixResponse {
  response: string;
  fixedFiles: IFixedFile[];
}
