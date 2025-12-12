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
  IFileFixResponse
} from '../types';

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
  ExecutionPlan,
  PlanStep,
  ExecutionError,
  ToolCall,
} from '../types/auto-agent';

// ✅ 핵심 변경 1: ServerConnection 대신 PageConfig 임포트
import { URLExt, PageConfig } from '@jupyterlab/coreutils';

export class ApiService {
  private baseUrl: string;

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

  /**
   * Execute cell action (explain, fix, custom)
   */
  async cellAction(request: ICellActionRequest): Promise<ICellResponse> {
    const response = await fetch(`${this.baseUrl}/cell/action`, {
      method: 'POST',
      headers: this.getHeaders(),
      credentials: 'include', // ✅ 핵심 수정: 쿠키를 같이 보냄
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'API request failed' }));
      throw new Error(error.message || 'API request failed');
    }

    return response.json();
  }

  /**
   * Send chat message
   */
  async sendMessage(request: IChatRequest): Promise<IChatResponse> {
    const response = await fetch(`${this.baseUrl}/chat/message`, {
      method: 'POST',
      headers: this.getHeaders(),
      credentials: 'include', // ✅ 핵심 수정: 쿠키를 같이 보냄
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        message: `Failed to send message (${response.status})`,
        error: `HTTP ${response.status}: ${response.statusText}`
      }));
      console.error('Chat API error:', error);
      console.error('Response status:', response.status);
      console.error('Request:', request);
      throw new Error(error.message || error.error || `Failed to send message (${response.status})`);
    }

    return response.json();
  }

  /**
   * Send chat message with streaming response
   */
  async sendMessageStream(
    request: IChatRequest,
    onChunk: (chunk: string) => void,
    onMetadata?: (metadata: { conversationId?: string; messageId?: string; provider?: string; model?: string }) => void
  ): Promise<void> {
    const response = await fetch(`${this.baseUrl}/chat/stream`, {
      method: 'POST',
      headers: this.getHeaders(),
      credentials: 'include', // ✅ 핵심 수정: 쿠키를 같이 보냄
      body: JSON.stringify(request)
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

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              // Handle errors
              if (data.error) {
                throw new Error(data.error);
              }

              // Handle metadata (conversationId, messageId, etc.)
              if (data.conversationId && onMetadata) {
                onMetadata({
                  conversationId: data.conversationId,
                  messageId: data.messageId,
                  provider: data.metadata?.provider,
                  model: data.metadata?.model
                });
              }

              // Handle content chunks
              if (data.content) {
                onChunk(data.content);
              }

              // Final metadata update
              if (data.done && data.metadata && onMetadata) {
                onMetadata({
                  provider: data.metadata.provider,
                  model: data.metadata.model
                });
              }
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
  // Auto-Agent API Methods
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate execution plan for auto-agent task
   */
  async generateExecutionPlan(request: AutoAgentPlanRequest): Promise<AutoAgentPlanResponse> {
    console.log('[ApiService] generateExecutionPlan request:', request);

    const response = await fetch(`${this.baseUrl}/auto-agent/plan`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ApiService] Plan API Error:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
        url: `${this.baseUrl}/auto-agent/plan`
      });

      let errorMessage = '계획 생성 실패';
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error || errorJson.message || errorMessage;
      } catch (e) {
        errorMessage = errorText || errorMessage;
      }

      throw new Error(errorMessage);
    }

    const result = await response.json();
    console.log('[ApiService] Plan API Success:', result);
    return result;
  }

  /**
   * Refine step code after error (Self-Healing)
   */
  async refineStepCode(request: AutoAgentRefineRequest): Promise<AutoAgentRefineResponse> {
    console.log('[ApiService] refineStepCode request:', request);

    const response = await fetch(`${this.baseUrl}/auto-agent/refine`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ApiService] Refine API Error:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
        url: `${this.baseUrl}/auto-agent/refine`
      });

      let errorMessage = '코드 수정 실패';
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error || errorJson.message || errorMessage;
      } catch (e) {
        errorMessage = errorText || errorMessage;
      }

      throw new Error(errorMessage);
    }

    const result = await response.json();
    console.log('[ApiService] Refine API Success:', result);
    return result;
  }

  /**
   * Adaptive Replanning - 에러 분석 후 계획 재수립
   */
  async replanExecution(request: AutoAgentReplanRequest): Promise<AutoAgentReplanResponse> {
    console.log('[ApiService] replanExecution request:', request);

    const response = await fetch(`${this.baseUrl}/auto-agent/replan`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ApiService] Replan API Error:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
        url: `${this.baseUrl}/auto-agent/replan`
      });

      let errorMessage = '계획 재수립 실패';
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error || errorJson.message || errorMessage;
      } catch (e) {
        errorMessage = errorText || errorMessage;
      }

      throw new Error(errorMessage);
    }

    const result = await response.json();
    console.log('[ApiService] Replan API Success:', result);
    return result;
  }

  /**
   * Validate code before execution - 사전 코드 품질 검증 (Pyflakes/AST 기반)
   */
  async validateCode(request: AutoAgentValidateRequest): Promise<AutoAgentValidateResponse> {
    console.log('[ApiService] validateCode request:', request);

    const response = await fetch(`${this.baseUrl}/auto-agent/validate`, {
      method: 'POST',
      headers: this.getHeaders(),
      credentials: 'include',
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ApiService] Validate API Error:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
        url: `${this.baseUrl}/auto-agent/validate`
      });

      let errorMessage = '코드 검증 실패';
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error || errorJson.message || errorMessage;
      } catch (e) {
        errorMessage = errorText || errorMessage;
      }

      throw new Error(errorMessage);
    }

    const result = await response.json();
    console.log('[ApiService] Validate API Success:', result);
    return result;
  }

  /**
   * Reflect on step execution - 실행 결과 분석 및 적응적 조정
   */
  async reflectOnExecution(request: AutoAgentReflectRequest): Promise<AutoAgentReflectResponse> {
    console.log('[ApiService] reflectOnExecution request:', request);

    const response = await fetch(`${this.baseUrl}/auto-agent/reflect`, {
      method: 'POST',
      headers: this.getHeaders(),
      credentials: 'include',
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ApiService] Reflect API Error:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
        url: `${this.baseUrl}/auto-agent/reflect`
      });

      let errorMessage = 'Reflection 실패';
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error || errorJson.message || errorMessage;
      } catch (e) {
        errorMessage = errorText || errorMessage;
      }

      throw new Error(errorMessage);
    }

    const result = await response.json();
    console.log('[ApiService] Reflect API Success:', result);
    return result;
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
  async fileAction(request: IFileFixRequest): Promise<IFileFixResponse> {
    console.log('[ApiService] fileAction request:', request);

    const response = await fetch(`${this.baseUrl}/file/action`, {
      method: 'POST',
      headers: this.getHeaders(),
      credentials: 'include',
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ApiService] File Action API Error:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
        url: `${this.baseUrl}/file/action`
      });

      let errorMessage = '파일 액션 실패';
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error || errorJson.message || errorMessage;
      } catch (e) {
        errorMessage = errorText || errorMessage;
      }

      throw new Error(errorMessage);
    }

    const result = await response.json();
    console.log('[ApiService] File Action API Success:', result);
    return result;
  }
}
