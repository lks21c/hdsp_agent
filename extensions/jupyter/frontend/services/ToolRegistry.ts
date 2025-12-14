/**
 * ToolRegistry - 동적 도구 등록 및 관리
 *
 * 기존 switch문 기반 도구 라우팅을 Map 기반 레지스트리로 대체
 * - 동적 도구 등록/해제
 * - 위험 수준별 분류
 * - 카테고리별 조회
 */

import {
  ToolName,
  ToolResult,
  ToolDefinition,
  ToolRiskLevel,
  ToolCategory,
  ToolExecutionContext,
  ApprovalRequest,
  ApprovalResult,
  ApprovalCallback,
} from '../types/auto-agent';

/**
 * 기본 승인 콜백 - 항상 승인 (개발/테스트용)
 */
const defaultApprovalCallback: ApprovalCallback = async (request) => ({
  approved: true,
  requestId: request.id,
  timestamp: Date.now(),
});

/**
 * ToolRegistry 클래스
 * 싱글톤 패턴으로 구현 (전역 레지스트리)
 */
export class ToolRegistry {
  private static instance: ToolRegistry;
  private tools: Map<ToolName, ToolDefinition>;
  private approvalCallback: ApprovalCallback;
  private approvalRequired: boolean;

  private constructor() {
    this.tools = new Map();
    this.approvalCallback = defaultApprovalCallback;
    this.approvalRequired = true;
  }

  /**
   * 싱글톤 인스턴스 반환
   */
  static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  /**
   * 테스트용 인스턴스 리셋
   */
  static resetInstance(): void {
    ToolRegistry.instance = new ToolRegistry();
  }

  /**
   * 도구 등록
   */
  register(definition: ToolDefinition): void {
    if (this.tools.has(definition.name)) {
      console.warn(`[ToolRegistry] Tool '${definition.name}' already registered, overwriting`);
    }
    this.tools.set(definition.name, definition);
    console.log(`[ToolRegistry] Registered tool: ${definition.name} (${definition.riskLevel})`);
  }

  /**
   * 도구 해제
   */
  unregister(name: ToolName): boolean {
    const result = this.tools.delete(name);
    if (result) {
      console.log(`[ToolRegistry] Unregistered tool: ${name}`);
    }
    return result;
  }

  /**
   * 도구 조회
   */
  getTool(name: ToolName): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * 도구 존재 여부 확인
   */
  hasTool(name: ToolName): boolean {
    return this.tools.has(name);
  }

  /**
   * 등록된 모든 도구 반환
   */
  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * 카테고리별 도구 조회
   */
  getToolsByCategory(category: ToolCategory): ToolDefinition[] {
    return this.getAllTools().filter(tool => tool.category === category);
  }

  /**
   * 위험 수준별 도구 조회
   */
  getToolsByRiskLevel(riskLevel: ToolRiskLevel): ToolDefinition[] {
    return this.getAllTools().filter(tool => tool.riskLevel === riskLevel);
  }

  /**
   * 승인이 필요한 도구들 조회
   */
  getToolsRequiringApproval(): ToolDefinition[] {
    return this.getAllTools().filter(tool => tool.requiresApproval);
  }

  /**
   * 등록된 도구 이름들 반환
   */
  getToolNames(): ToolName[] {
    return Array.from(this.tools.keys());
  }

  /**
   * 승인 콜백 설정
   */
  setApprovalCallback(callback: ApprovalCallback): void {
    this.approvalCallback = callback;
    console.log('[ToolRegistry] Approval callback updated');
  }

  /**
   * 승인 필요 여부 설정
   */
  setApprovalRequired(required: boolean): void {
    this.approvalRequired = required;
    console.log(`[ToolRegistry] Approval requirement set to: ${required}`);
  }

  /**
   * 승인 필요 여부 확인
   */
  isApprovalRequired(): boolean {
    return this.approvalRequired;
  }

  /**
   * 도구 실행 (승인 게이트 포함)
   */
  async executeTool(
    name: ToolName,
    params: any,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const tool = this.getTool(name);

    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: ${name}`,
      };
    }

    // 승인이 필요한 도구인 경우 승인 요청
    if (this.approvalRequired && tool.requiresApproval) {
      const request: ApprovalRequest = {
        id: `${name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        toolName: name,
        toolDefinition: tool,
        parameters: params,
        stepNumber: context.stepNumber,
        description: this.formatToolDescription(tool, params),
        timestamp: Date.now(),
      };

      console.log(`[ToolRegistry] Requesting approval for tool: ${name}`);
      const approvalResult = await this.approvalCallback(request);

      if (!approvalResult.approved) {
        console.log(`[ToolRegistry] Tool execution denied: ${name}, reason: ${approvalResult.reason}`);
        return {
          success: false,
          error: `Tool execution denied: ${approvalResult.reason || 'User rejected'}`,
        };
      }

      console.log(`[ToolRegistry] Tool approved: ${name}`);
    }

    // 도구 실행
    try {
      console.log(`[ToolRegistry] Executing tool: ${name}`);
      return await tool.executor(params, context);
    } catch (error: any) {
      console.error(`[ToolRegistry] Tool execution failed: ${name}`, error);
      return {
        success: false,
        error: error.message || `Failed to execute tool: ${name}`,
      };
    }
  }

  /**
   * 도구 설명 포맷팅 (승인 다이얼로그용)
   */
  private formatToolDescription(tool: ToolDefinition, params: any): string {
    const riskEmoji = {
      low: '🟢',
      medium: '🟡',
      high: '🟠',
      critical: '🔴',
    };

    let description = `${riskEmoji[tool.riskLevel]} ${tool.description}`;

    // 파라미터 요약 추가
    if (params) {
      const paramSummary = Object.entries(params)
        .map(([key, value]) => {
          const valueStr = typeof value === 'string'
            ? value.length > 50 ? value.substring(0, 50) + '...' : value
            : JSON.stringify(value);
          return `${key}: ${valueStr}`;
        })
        .join(', ');

      if (paramSummary) {
        description += `\n파라미터: ${paramSummary}`;
      }
    }

    return description;
  }

  /**
   * 레지스트리 상태 출력 (디버깅용)
   */
  printStatus(): void {
    console.log('[ToolRegistry] Status:');
    console.log(`  - Registered tools: ${this.tools.size}`);
    console.log(`  - Approval required: ${this.approvalRequired}`);
    console.log('  - Tools:');
    for (const [name, tool] of this.tools) {
      console.log(`    * ${name} (${tool.category}, ${tool.riskLevel}, approval: ${tool.requiresApproval})`);
    }
  }
}

/**
 * 기본 도구 정의들 (빌트인)
 * ToolExecutor의 메서드들을 executor로 연결하기 위해 나중에 초기화
 */
export const BUILTIN_TOOL_DEFINITIONS: Omit<ToolDefinition, 'executor'>[] = [
  {
    name: 'jupyter_cell',
    description: 'Jupyter 코드 셀 생성/수정/실행',
    riskLevel: 'medium',
    requiresApproval: false,  // 기본 셀 실행은 승인 불필요
    category: 'cell',
  },
  {
    name: 'markdown',
    description: 'Jupyter 마크다운 셀 생성/수정',
    riskLevel: 'low',
    requiresApproval: false,
    category: 'cell',
  },
  {
    name: 'final_answer',
    description: '작업 완료 및 최종 답변 반환',
    riskLevel: 'low',
    requiresApproval: false,
    category: 'answer',
  },
];

/**
 * 위험 수준 우선순위 (비교용)
 */
export const RISK_LEVEL_PRIORITY: Record<ToolRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

/**
 * 위험 수준 비교
 */
export function compareRiskLevels(a: ToolRiskLevel, b: ToolRiskLevel): number {
  return RISK_LEVEL_PRIORITY[a] - RISK_LEVEL_PRIORITY[b];
}

/**
 * 특정 위험 수준 이상인지 확인
 */
export function isRiskLevelAtLeast(level: ToolRiskLevel, threshold: ToolRiskLevel): boolean {
  return RISK_LEVEL_PRIORITY[level] >= RISK_LEVEL_PRIORITY[threshold];
}

export default ToolRegistry;
