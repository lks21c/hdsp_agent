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

export interface IChatRequest {
  message: string;
  conversationId?: string;
  context?: {
    selectedCells?: string[];
    notebookPath?: string;
  };
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
