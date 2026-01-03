/**
 * API Service Layer for REST communication with backend
 */

import {
  IAgentConfig,
  ICellActionRequest,
  ICellResponse,
  IChatRequest,
  IChatResponse,
  IHealthStatus,
  IModelInfo,
  IFileFixRequest,
  IFileFixResponse,
  ILLMConfig,
  IResourceUsageSnapshot
} from '../types';

import {
  buildSingleKeyConfig,
  handleRateLimitError,
  isRateLimitError,
  resetKeyRotation,
  getValidGeminiKeys,
  getCurrentKeyIndex,
  LLMConfig
} from './ApiKeyManager';

import {
  AutoAgentPlanRequest,
  AutoAgentPlanResponse,
  AutoAgentRefineRequest,
  AutoAgentRefineResponse,
  AutoAgentReplanRequest,
  AutoAgentReplanResponse,
  AutoAgentValidateRequest,
  AutoAgentValidateResponse,
  AutoAgentReflectRequest,
  AutoAgentReflectResponse,
  AutoAgentVerifyStateRequest,
  AutoAgentVerifyStateResponse,
  ExecutionPlan,
  PlanStep,
  ExecutionError,
  ToolCall,
} from '../types/auto-agent';

// ✅ 핵심 변경 1: ServerConnection 대신 PageConfig 임포트
import { URLExt, PageConfig } from '@jupyterlab/coreutils';

export class ApiService {
  private baseUrl: string;
  private resourceUsageCache: { resource: IResourceUsageSnapshot; timestamp: number } | null = null;
  private readonly resourceUsageCacheMs = 15000;

  // 생성자에서 baseUrl을 선택적으로 받도록 하되, 없으면 자동으로 계산
  constructor(baseUrl?: string) {
    if (baseUrl) {
      this.baseUrl = baseUrl;
    } else {
      // ✅ 핵심 변경 2: ServerConnection 대신 PageConfig로 URL 가져오기
      // PageConfig.getBaseUrl()은 '/user/아이디/프로젝트/' 형태의 주소를 정확히 가져옵니다.
      const serverRoot = PageConfig.getBaseUrl();

      // 3. 경로 합치기
      // 결과: /user/453467/pl2wadmprj/hdsp-agent
      this.baseUrl = URLExt.join(serverRoot, 'hdsp-agent');
    }

    console.log('[ApiService] Base URL initialized:', this.baseUrl); // 디버깅용 로그
  }

  /**
   * Get cookie value by name
   */
  private getCookie(name: string): string {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) {
      return parts.pop()?.split(';').shift() || '';
    }
    return '';
  }

  /**
   * Get CSRF token from cookie
   */
  private getCsrfToken(): string {
    return this.getCookie('_xsrf');
  }

  /**
   * Get headers with CSRF token for POST requests
   */
  private getHeaders(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'X-XSRFToken': this.getCsrfToken()
    };
  }

  private async getResourceUsageSnapshot(): Promise<IResourceUsageSnapshot | null> {
    const now = Date.now();
    if (
      this.resourceUsageCache
      && now - this.resourceUsageCache.timestamp < this.resourceUsageCacheMs
    ) {
      return this.resourceUsageCache.resource;
    }

    try {
      const response = await fetch(`${this.baseUrl}/resource-usage`, {
        method: 'GET',
        credentials: 'include'
      });
      if (!response.ok) {
        return null;
      }
      const payload = await response.json().catch(() => ({}));
      const candidate = payload?.resource ?? payload;
      const snapshot = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
        ? candidate as IResourceUsageSnapshot
        : null;
      if (snapshot) {
        this.resourceUsageCache = { resource: snapshot, timestamp: now };
      }
      return snapshot;
    } catch (error) {
      console.warn('[ApiService] Resource usage fetch failed:', error);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Global Rate Limit Handling with Key Rotation
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Fetch wrapper with automatic API key rotation on rate limit (429)
   *
   * NOTE (Financial Security Compliance):
   * - API key rotation is handled by frontend (not server)
   * - Server receives ONLY ONE key per request
   * - On 429 rate limit, frontend rotates key and retries with next key
   */
  private async fetchWithKeyRotation<T>(
    url: string,
    request: { llmConfig?: any; [key: string]: any },
    options?: {
      onKeyRotation?: (keyIndex: number, totalKeys: number) => void;
      defaultErrorMessage?: string;
    }
  ): Promise<T> {
    const MAX_RETRIES = 10;
    const originalConfig = request.llmConfig as LLMConfig | undefined;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      // Build request with single key for this attempt
      const requestToSend = originalConfig
        ? { ...request, llmConfig: buildSingleKeyConfig(originalConfig) }
        : request;

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: this.getHeaders(),
          credentials: 'include',
          body: JSON.stringify(requestToSend)
        });

        if (response.ok) {
          // Success - reset key rotation state
          resetKeyRotation();
          return response.json();
        }

        // Handle error response
        const errorText = await response.text();

        // Check if rate limit error
        if (isRateLimitError(errorText) && originalConfig) {
          console.log(`[ApiService] Rate limit on attempt ${attempt + 1}, rotating key...`);

          // Try to rotate to next key
          const rotatedConfig = handleRateLimitError(originalConfig);

          if (rotatedConfig) {
            // Notify UI about key rotation
            const keys = getValidGeminiKeys(originalConfig);
            if (options?.onKeyRotation) {
              options.onKeyRotation(getCurrentKeyIndex(), keys.length);
            }
            continue; // Try next key
          } else {
            // All keys exhausted
            throw new Error('모든 API 키가 Rate Limit 상태입니다. 잠시 후 다시 시도해주세요.');
          }
        }

        // Not a rate limit error - parse and throw
        let errorMessage = options?.defaultErrorMessage || 'API 요청 실패';
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.detail || errorJson.error || errorJson.message || errorMessage;
        } catch (e) {
          errorMessage = errorText || errorMessage;
        }

        throw new Error(errorMessage);

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        lastError = error instanceof Error ? error : new Error(errorMsg);

        // If it's a rate limit error from the catch block, check rotation
        if (isRateLimitError(errorMsg) && originalConfig) {
          const rotatedConfig = handleRateLimitError(originalConfig);
          if (rotatedConfig) {
            const keys = getValidGeminiKeys(originalConfig);
            if (options?.onKeyRotation) {
              options.onKeyRotation(getCurrentKeyIndex(), keys.length);
            }
            continue;
          }
          throw new Error('모든 API 키가 Rate Limit 상태입니다. 잠시 후 다시 시도해주세요.');
        }

        // Not a rate limit error, throw immediately
        throw error;
      }
    }

    throw lastError || new Error('Maximum retry attempts exceeded');
  }

  /**
   * Execute cell action (explain, fix, custom)
   * Uses global rate limit handling with key rotation
   */
  async cellAction(request: ICellActionRequest): Promise<ICellResponse> {
    console.log('[ApiService] cellAction request:', request);
    return this.fetchWithKeyRotation<ICellResponse>(
      `${this.baseUrl}/cell/action`,
      request,
      { defaultErrorMessage: '셀 액션 실패' }
    );
  }

  /**
   * Send chat message (non-streaming)
   * Uses global rate limit handling with key rotation
   */
  async sendMessage(request: IChatRequest): Promise<IChatResponse> {
    console.log('[ApiService] sendMessage request');
    return this.fetchWithKeyRotation<IChatResponse>(
      `${this.baseUrl}/chat/message`,
      request,
      { defaultErrorMessage: '메시지 전송 실패' }
    );
  }

  /**
   * Send chat message with streaming response
   *
   * NOTE (Financial Security Compliance):
   * - API key rotation is handled by frontend (not server)
   * - Server receives ONLY ONE key per request
   * - On 429 rate limit, frontend rotates key and retries with next key
   */
  async sendMessageStream(
    request: IChatRequest,
    onChunk: (chunk: string) => void,
    onMetadata?: (metadata: { conversationId?: string; messageId?: string; provider?: string; model?: string }) => void,
    onDebug?: (status: string) => void,
    onInterrupt?: (interrupt: { threadId: string; action: string; args: any; description: string }) => void,
    onTodos?: (todos: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }>) => void,
    onDebugClear?: () => void,
    onToolCall?: (toolCall: { tool: string; code?: string; content?: string; command?: string; timeout?: number }) => void,
    onComplete?: (data: { threadId: string }) => void,  // Callback to capture thread_id for context persistence
    threadId?: string  // Optional thread_id to continue existing conversation
  ): Promise<void> {
    // Maximum retry attempts (should match number of keys)
    const MAX_RETRIES = 10;
    let currentConfig = request.llmConfig as LLMConfig | undefined;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      // Build request with single key for this attempt
      const requestToSend = currentConfig
        ? { ...request, llmConfig: buildSingleKeyConfig(currentConfig) }
        : request;

      try {
        await this.sendMessageStreamInternal(requestToSend, onChunk, onMetadata, onDebug, onInterrupt, onTodos, onDebugClear, onToolCall, onComplete, threadId);
        // Success - reset key rotation state
        resetKeyRotation();
        return;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        lastError = error instanceof Error ? error : new Error(errorMsg);

        // Check if rate limit error and we have config to rotate
        if (isRateLimitError(errorMsg) && request.llmConfig) {
          console.log(`[ApiService] Rate limit on attempt ${attempt + 1}, trying next key...`);

          // Try to rotate to next key using ORIGINAL config (with all keys)
          const rotatedConfig = handleRateLimitError(request.llmConfig as LLMConfig);

          if (rotatedConfig) {
            // Update currentConfig with the rotated key for next attempt
            // Note: rotatedConfig already has single key, but we need full config for next rotation
            currentConfig = request.llmConfig as LLMConfig;
            continue; // Try next key
          } else {
            // All keys exhausted
            throw new Error('모든 API 키가 Rate Limit 상태입니다. 잠시 후 다시 시도해주세요.');
          }
        }

        // Not a rate limit error, throw immediately
        throw error;
      }
    }

    // Should not reach here, but just in case
    throw lastError || new Error('Maximum retry attempts exceeded');
  }

  /**
   * Build request with single API key for server
   * (Key rotation is managed by frontend for financial security compliance)
   */
  private buildRequestWithSingleKey(request: IChatRequest): IChatRequest {
    if (!request.llmConfig) {
      return request;
    }

    // Build config with single key (server only uses apiKey field)
    const singleKeyConfig = buildSingleKeyConfig(request.llmConfig as LLMConfig);

    return {
      ...request,
      llmConfig: singleKeyConfig
    };
  }

  /**
   * Internal streaming implementation (without retry logic)
   * Uses LangChain agent endpoint for improved middleware support
   */
  private async sendMessageStreamInternal(
    request: IChatRequest,
    onChunk: (chunk: string) => void,
    onMetadata?: (metadata: { conversationId?: string; messageId?: string; provider?: string; model?: string }) => void,
    onDebug?: (status: string) => void,
    onInterrupt?: (interrupt: { threadId: string; action: string; args: any; description: string }) => void,
    onTodos?: (todos: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }>) => void,
    onDebugClear?: () => void,
    onToolCall?: (toolCall: { tool: string; code?: string; content?: string; command?: string; timeout?: number }) => void,
    onComplete?: (data: { threadId: string }) => void,
    threadId?: string
  ): Promise<void> {
    // Convert IChatRequest to LangChain AgentRequest format
    // Frontend's context has limited fields, map what's available
    const resourceContext = await this.getResourceUsageSnapshot();
    const requestConfig = resourceContext && request.llmConfig
      ? { ...request.llmConfig, resourceContext }
      : request.llmConfig;
    const langchainRequest = {
      request: request.message,
      threadId: threadId,  // Include threadId for context persistence across cycles
      notebookContext: request.context ? {
        notebook_path: request.context.notebookPath,
        cell_count: 0,
        imported_libraries: [],
        defined_variables: [],
        recent_cells: request.context.selectedCells?.map(cell => ({ source: cell })) || []
      } : undefined,
      llmConfig: requestConfig,
      workspaceRoot: '.'
    };

    // Debug: log request size
    const requestBody = JSON.stringify(langchainRequest);
    console.log('[ApiService] Sending langchain request:', {
      messageLength: request.message.length,
      bodyLength: requestBody.length,
      threadId: threadId,
    });

    // Use LangChain streaming endpoint
    const response = await fetch(`${this.baseUrl}/agent/langchain/stream`, {
      method: 'POST',
      headers: this.getHeaders(),
      credentials: 'include',
      body: requestBody
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to send message: ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE messages
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        let currentEventType = '';
        for (const line of lines) {
          // Handle SSE event type: "event: type"
          if (line.startsWith('event: ')) {
            currentEventType = line.slice(7).trim();
            continue;
          }

          // Handle SSE data: "data: json"
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              // Handle based on event type
              if (currentEventType === 'todos' && data.todos && onTodos) {
                onTodos(data.todos);
                currentEventType = '';
                continue;
              }

              if (currentEventType === 'debug_clear' && onDebugClear) {
                onDebugClear();
                currentEventType = '';
                continue;
              }

              if (currentEventType === 'complete') {
                if (onDebugClear) {
                  onDebugClear();
                }
                // Capture thread_id for context persistence across cycles
                console.log('[ApiService] Complete event received, data:', data);
                if (onComplete && data.thread_id) {
                  console.log('[ApiService] Calling onComplete with threadId:', data.thread_id);
                  onComplete({ threadId: data.thread_id });
                } else {
                  console.log('[ApiService] onComplete not called - onComplete:', !!onComplete, 'thread_id:', data.thread_id);
                }
                return;
              }

              // Handle errors
              if (data.error) {
                if (onDebug) {
                  onDebug(`오류: ${data.error}`);
                }
                throw new Error(data.error);
              }

              // Handle debug events (display in gray)
              if (data.status && onDebug) {
                onDebug(data.status);
              }

              // Handle interrupt events (Human-in-the-Loop)
              if (data.thread_id && data.action && onInterrupt) {
                onInterrupt({
                  threadId: data.thread_id,
                  action: data.action,
                  args: data.args || {},
                  description: data.description || ''
                });
                return; // Stop processing, wait for user decision
              }

              // Handle token events (streaming LLM response)
              if (data.content) {
                onChunk(data.content);
              }

              // Handle tool_call events - pass to handler for cell creation
              if (currentEventType === 'tool_call' && data.tool && onToolCall) {
                onToolCall({
                  tool: data.tool,
                  code: data.code,
                  content: data.content,
                  command: data.command,
                  timeout: data.timeout
                });
                currentEventType = '';
                continue;
              }

              // Handle tool_result events - skip displaying raw output
              if (data.output) {
                // Don't add raw tool output to chat
              }

              // Handle completion
              if (data.final_answer) {
                onChunk(data.final_answer);
              }

              // Handle metadata
              if (data.conversationId && onMetadata) {
                onMetadata({
                  conversationId: data.conversationId,
                  messageId: data.messageId,
                  provider: data.metadata?.provider,
                  model: data.metadata?.model
                });
              }

              // Final metadata update
              if (data.done && data.metadata && onMetadata) {
                onMetadata({
                  provider: data.metadata.provider,
                  model: data.metadata.model
                });
              }

              currentEventType = '';
            } catch (e) {
              if (e instanceof SyntaxError) {
                console.warn('Failed to parse SSE data:', line);
              } else {
                throw e;
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Resume interrupted agent execution with user decision
   */
  async resumeAgent(
    threadId: string,
    decision: 'approve' | 'edit' | 'reject',
    args?: any,
    feedback?: string,
    llmConfig?: ILLMConfig,
    onChunk?: (chunk: string) => void,
    onDebug?: (status: string) => void,
    onInterrupt?: (interrupt: { threadId: string; action: string; args: any; description: string }) => void,
    onTodos?: (todos: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }>) => void,
    onDebugClear?: () => void,
    onToolCall?: (toolCall: { tool: string; code?: string; content?: string; command?: string; timeout?: number }) => void
  ): Promise<void> {
    const resourceContext = await this.getResourceUsageSnapshot();
    const requestConfig = resourceContext && llmConfig
      ? { ...llmConfig, resourceContext }
      : llmConfig;
    const resumeRequest = {
      threadId,
      decisions: [{
        type: decision,
        args,
        feedback
      }],
      llmConfig: requestConfig,
      workspaceRoot: '.'
    };

    const response = await fetch(`${this.baseUrl}/agent/langchain/resume`, {
      method: 'POST',
      headers: this.getHeaders(),
      credentials: 'include',
      body: JSON.stringify(resumeRequest)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to resume agent: ${error}`);
    }

    // Process SSE stream (same as sendMessageStream)
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEventType = '';
        for (const line of lines) {
          // Handle SSE event type
          if (line.startsWith('event: ')) {
            currentEventType = line.slice(7).trim();
            continue;
          }

          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.error) {
                if (onDebug) {
                  onDebug(`오류: ${data.error}`);
                }
                throw new Error(data.error);
              }

              // Handle todos event
              if (currentEventType === 'todos' && data.todos && onTodos) {
                onTodos(data.todos);
                currentEventType = '';
                continue;
              }

              // Handle debug_clear event
              if (currentEventType === 'debug_clear' && onDebugClear) {
                onDebugClear();
                currentEventType = '';
                continue;
              }

              if (currentEventType === 'complete') {
                if (onDebugClear) {
                  onDebugClear();
                }
                return;
              }

              // Debug events
              if (data.status && onDebug) {
                onDebug(data.status);
              }

              // Another interrupt
              if (data.thread_id && data.action && onInterrupt) {
                onInterrupt({
                  threadId: data.thread_id,
                  action: data.action,
                  args: data.args || {},
                  description: data.description || ''
                });
                return;
              }

              // Content chunks
              if (data.content && onChunk) {
                onChunk(data.content);
              }

              // Tool call events during resume
              if (currentEventType === 'tool_call' && data.tool && onToolCall) {
                onToolCall({
                  tool: data.tool,
                  code: data.code,
                  content: data.content,
                  command: data.command,
                  timeout: data.timeout
                });
                currentEventType = '';
                continue;
              }

              currentEventType = '';
            } catch (e) {
              if (!(e instanceof SyntaxError)) {
                throw e;
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async executeCommand(
    command: string,
    timeout?: number,
    cwd?: string,
    stdin?: string
  ): Promise<{
    success: boolean;
    stdout?: string;
    stderr?: string;
    returncode?: number;
    error?: string;
    cwd?: string;
  }> {
    const response = await fetch(`${this.baseUrl}/execute-command`, {
      method: 'POST',
      headers: this.getHeaders(),
      credentials: 'include',
      body: JSON.stringify({ command, timeout, cwd, stdin })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorMessage = (payload as any).error || 'Failed to execute command';
      throw new Error(errorMessage);
    }
    return payload;
  }

  async executeCommandStream(
    command: string,
    options?: {
      timeout?: number;
      cwd?: string;
      stdin?: string;
      onOutput?: (chunk: { stream: 'stdout' | 'stderr'; text: string }) => void;
    }
  ): Promise<{
    success: boolean;
    stdout?: string;
    stderr?: string;
    returncode?: number;
    error?: string;
    cwd?: string;
    truncated?: boolean;
    duration_ms?: number;
  }> {
    const response = await fetch(`${this.baseUrl}/execute-command/stream`, {
      method: 'POST',
      headers: this.getHeaders(),
      credentials: 'include',
      body: JSON.stringify({
        command,
        timeout: options?.timeout,
        cwd: options?.cwd,
        stdin: options?.stdin
      })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const errorMessage = (payload as any).error || 'Failed to execute command';
      throw new Error(errorMessage);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let result: any = null;
    let streamError: string | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEventType = line.slice(7).trim();
            continue;
          }

          if (!line.startsWith('data: ')) {
            continue;
          }

          let data: any;
          try {
            data = JSON.parse(line.slice(6));
          } catch (e) {
            continue;
          }

          if (currentEventType === 'output') {
            if (typeof data.text === 'string' && options?.onOutput) {
              options.onOutput({
                stream: data.stream === 'stderr' ? 'stderr' : 'stdout',
                text: data.text
              });
            }
            currentEventType = '';
            continue;
          }

          if (currentEventType === 'error') {
            streamError = data.error || 'Command execution failed';
            currentEventType = '';
            continue;
          }

          if (currentEventType === 'result') {
            result = data;
            return result;
          }

          currentEventType = '';
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (streamError) {
      throw new Error(streamError);
    }
    if (!result) {
      throw new Error('No command result received');
    }
    return result;
  }

  async writeFile(
    path: string,
    content: string,
    options?: { encoding?: string; overwrite?: boolean; cwd?: string }
  ): Promise<{
    success: boolean;
    path?: string;
    resolved_path?: string;
    size?: number;
    error?: string;
  }> {
    const response = await fetch(`${this.baseUrl}/write-file`, {
      method: 'POST',
      headers: this.getHeaders(),
      credentials: 'include',
      body: JSON.stringify({
        path,
        content,
        encoding: options?.encoding,
        overwrite: options?.overwrite,
        cwd: options?.cwd
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorMessage = (payload as any).error || 'Failed to write file';
      throw new Error(errorMessage);
    }
    return payload;
  }

  /**
   * Search workspace for files matching pattern
   * Executed on Jupyter server using grep/ripgrep
   */
  async searchWorkspace(options: {
    pattern: string;
    file_types?: string[];
    path?: string;
    max_results?: number;
    case_sensitive?: boolean;
  }): Promise<{
    success: boolean;
    command?: string;
    tool_used?: string;
    results?: Array<{
      file_path: string;
      line_number: number;
      content: string;
      match_type: string;
    }>;
    total_results?: number;
    error?: string;
  }> {
    const response = await fetch(`${this.baseUrl}/search-workspace`, {
      method: 'POST',
      headers: this.getHeaders(),
      credentials: 'include',
      body: JSON.stringify({
        pattern: options.pattern,
        file_types: options.file_types || ['*.py', '*.ipynb'],
        path: options.path || '.',
        max_results: options.max_results || 50,
        case_sensitive: options.case_sensitive || false
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorMessage = (payload as any).error || 'Failed to search workspace';
      throw new Error(errorMessage);
    }
    return payload;
  }

  /**
   * Search notebook cells for pattern
   * Executed on Jupyter server
   */
  async searchNotebookCells(options: {
    pattern: string;
    notebook_path?: string;
    cell_type?: 'code' | 'markdown';
    max_results?: number;
    case_sensitive?: boolean;
  }): Promise<{
    success: boolean;
    results?: Array<{
      file_path: string;
      cell_index: number;
      cell_type: string;
      content: string;
      matching_lines?: Array<{ line: number; content: string }>;
      match_type: string;
    }>;
    total_results?: number;
    notebooks_searched?: number;
    error?: string;
  }> {
    const response = await fetch(`${this.baseUrl}/search-notebook-cells`, {
      method: 'POST',
      headers: this.getHeaders(),
      credentials: 'include',
      body: JSON.stringify({
        pattern: options.pattern,
        notebook_path: options.notebook_path,
        cell_type: options.cell_type,
        max_results: options.max_results || 30,
        case_sensitive: options.case_sensitive || false
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorMessage = (payload as any).error || 'Failed to search notebook cells';
      throw new Error(errorMessage);
    }
    return payload;
  }

  /**
   * Check system resources and file sizes before data processing
   * Executed on Jupyter server
   */
  async checkResource(options: {
    files?: string[];
    dataframes?: string[];
    file_size_command?: string;
    dataframe_check_code?: string;
  }): Promise<{
    success: boolean;
    system?: {
      ram_available_mb: number;
      ram_total_mb: number;
      cpu_cores: number;
      environment: string;
    };
    files?: Array<{
      name: string;
      path: string;
      size_bytes?: number;
      size_mb?: number;
      exists: boolean;
      error?: string;
    }>;
    dataframes?: Array<{
      name: string;
      exists: boolean;
      rows?: number;
      cols?: number;
      memory_mb?: number;
      type?: string;
      error?: string;
    }>;
    error?: string;
  }> {
    const response = await fetch(`${this.baseUrl}/check-resource`, {
      method: 'POST',
      headers: this.getHeaders(),
      credentials: 'include',
      body: JSON.stringify({
        files: options.files || [],
        dataframes: options.dataframes || [],
        file_size_command: options.file_size_command || '',
        dataframe_check_code: options.dataframe_check_code || ''
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorMessage = (payload as any).error || 'Failed to check resources';
      throw new Error(errorMessage);
    }
    return payload;
  }

  /**
   * Save configuration
   */
  async saveConfig(config: IAgentConfig): Promise<void> {
    const response = await fetch(`${this.baseUrl}/config`, {
      method: 'POST',
      headers: this.getHeaders(),
      credentials: 'include', // ✅ 핵심 수정: 쿠키를 같이 보냄
      body: JSON.stringify(config)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Failed to save configuration' }));
      throw new Error(error.message || 'Failed to save configuration');
    }
  }

  /**
   * Get current configuration
   */
  async getConfig(): Promise<IAgentConfig> {
    const response = await fetch(`${this.baseUrl}/config`);

    if (!response.ok) {
      throw new Error('Failed to load configuration');
    }

    return response.json();
  }

  /**
   * Get health status
   */
  async getStatus(): Promise<IHealthStatus> {
    const response = await fetch(`${this.baseUrl}/status`);

    if (!response.ok) {
      throw new Error('Failed to get status');
    }

    return response.json();
  }

  /**
   * Get available models
   */
  async getModels(): Promise<IModelInfo[]> {
    const response = await fetch(`${this.baseUrl}/models`);

    if (!response.ok) {
      throw new Error('Failed to load models');
    }

    return response.json();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Auto-Agent API Methods (All use global rate limit handling)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate execution plan for auto-agent task
   */
  async generateExecutionPlan(
    request: AutoAgentPlanRequest,
    onKeyRotation?: (keyIndex: number, totalKeys: number) => void
  ): Promise<AutoAgentPlanResponse> {
    console.log('[ApiService] generateExecutionPlan request:', request);
    return this.fetchWithKeyRotation<AutoAgentPlanResponse>(
      `${this.baseUrl}/auto-agent/plan`,
      request,
      { onKeyRotation, defaultErrorMessage: '계획 생성 실패' }
    );
  }

  /**
   * Refine step code after error (Self-Healing)
   */
  async refineStepCode(
    request: AutoAgentRefineRequest,
    onKeyRotation?: (keyIndex: number, totalKeys: number) => void
  ): Promise<AutoAgentRefineResponse> {
    console.log('[ApiService] refineStepCode request:', request);
    return this.fetchWithKeyRotation<AutoAgentRefineResponse>(
      `${this.baseUrl}/auto-agent/refine`,
      request,
      { onKeyRotation, defaultErrorMessage: '코드 수정 실패' }
    );
  }

  /**
   * Adaptive Replanning - 에러 분석 후 계획 재수립
   */
  async replanExecution(
    request: AutoAgentReplanRequest,
    onKeyRotation?: (keyIndex: number, totalKeys: number) => void
  ): Promise<AutoAgentReplanResponse> {
    console.log('[ApiService] replanExecution request:', request);
    return this.fetchWithKeyRotation<AutoAgentReplanResponse>(
      `${this.baseUrl}/auto-agent/replan`,
      request,
      { onKeyRotation, defaultErrorMessage: '계획 재수립 실패' }
    );
  }

  /**
   * Validate code before execution - 사전 코드 품질 검증 (Pyflakes/AST 기반)
   * Note: This is a local validation, no LLM call, but uses wrapper for consistency
   */
  async validateCode(request: AutoAgentValidateRequest): Promise<AutoAgentValidateResponse> {
    console.log('[ApiService] validateCode request:', request);
    return this.fetchWithKeyRotation<AutoAgentValidateResponse>(
      `${this.baseUrl}/auto-agent/validate`,
      request,
      { defaultErrorMessage: '코드 검증 실패' }
    );
  }

  /**
   * Reflect on step execution - 실행 결과 분석 및 적응적 조정
   */
  async reflectOnExecution(
    request: AutoAgentReflectRequest,
    onKeyRotation?: (keyIndex: number, totalKeys: number) => void
  ): Promise<AutoAgentReflectResponse> {
    console.log('[ApiService] reflectOnExecution request:', request);
    return this.fetchWithKeyRotation<AutoAgentReflectResponse>(
      `${this.baseUrl}/auto-agent/reflect`,
      request,
      { onKeyRotation, defaultErrorMessage: 'Reflection 실패' }
    );
  }

  /**
   * Verify state after step execution - 상태 검증 (Phase 1)
   * Note: This is a local verification, no LLM call, but uses wrapper for consistency
   */
  async verifyState(request: AutoAgentVerifyStateRequest): Promise<AutoAgentVerifyStateResponse> {
    console.log('[ApiService] verifyState request:', request);
    return this.fetchWithKeyRotation<AutoAgentVerifyStateResponse>(
      `${this.baseUrl}/auto-agent/verify-state`,
      request,
      { defaultErrorMessage: '상태 검증 실패' }
    );
  }

  /**
   * Stream execution plan generation with real-time updates
   */
  async generateExecutionPlanStream(
    request: AutoAgentPlanRequest,
    onPlanUpdate: (plan: Partial<ExecutionPlan>) => void,
    onReasoning?: (reasoning: string) => void
  ): Promise<ExecutionPlan> {
    const response = await fetch(`${this.baseUrl}/auto-agent/plan/stream`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to generate plan: ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let finalPlan: ExecutionPlan | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.error) {
                throw new Error(data.error);
              }

              if (data.reasoning && onReasoning) {
                onReasoning(data.reasoning);
              }

              if (data.plan) {
                onPlanUpdate(data.plan);
                if (data.done) {
                  finalPlan = data.plan;
                }
              }
            } catch (e) {
              if (!(e instanceof SyntaxError)) {
                throw e;
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (!finalPlan) {
      throw new Error('No plan received from server');
    }

    return finalPlan;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // File Action API Methods (Python 파일 에러 수정)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Python 파일 에러 수정/분석/설명 요청
   */
  async fileAction(
    request: IFileFixRequest,
    onKeyRotation?: (keyIndex: number, totalKeys: number) => void
  ): Promise<IFileFixResponse> {
    console.log('[ApiService] fileAction request:', request);
    return this.fetchWithKeyRotation<IFileFixResponse>(
      `${this.baseUrl}/file/action`,
      request,
      { onKeyRotation, defaultErrorMessage: '파일 액션 실패' }
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // File Resolution API Methods (파일 경로 해결)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Resolve file path - 파일명 또는 패턴으로 경로 검색
   */
  async resolveFile(request: {
    filename?: string;
    pattern?: string;
    recursive?: boolean;
    notebookDir?: string;
    cwd?: string;
  }): Promise<{
    path?: string;
    relative?: string;
    requiresSelection?: boolean;
    filename?: string;
    options?: Array<{ path: string; relative: string; dir: string }>;
    message?: string;
    error?: string;
  }> {
    console.log('[ApiService] resolveFile request:', request);
    const response = await fetch(`${this.baseUrl}/file/resolve`, {
      method: 'POST',
      headers: this.getHeaders(),
      credentials: 'include',
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to resolve file: ${error}`);
    }

    return response.json();
  }

  /**
   * Select file from multiple options - 사용자 선택 처리
   */
  async selectFile(request: {
    selection: string;
    options: Array<{ path: string; relative: string; dir: string }>;
  }): Promise<{ path: string; relative: string }> {
    console.log('[ApiService] selectFile request:', request);
    const response = await fetch(`${this.baseUrl}/file/select`, {
      method: 'POST',
      headers: this.getHeaders(),
      credentials: 'include',
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to select file: ${error}`);
    }

    return response.json();
  }
}
