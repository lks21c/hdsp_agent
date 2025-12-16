/**
 * Auto-Agent Type Definitions
 * HuggingFace Jupyter Agent 패턴 기반 Tool Calling 구조
 */

import { ILLMConfig } from './index';

// ═══════════════════════════════════════════════════════════════════════════
// Tool Definitions (HF Jupyter Agent 패턴)
// ═══════════════════════════════════════════════════════════════════════════

export type ToolName =
  | 'jupyter_cell' | 'markdown' | 'final_answer'
  | 'read_file' | 'write_file' | 'list_files'
  | 'execute_command' | 'search_files';

// ═══════════════════════════════════════════════════════════════════════════
// Cell Operation Types (Notebook Refactoring Support)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 셀 작업 유형
 * - CREATE: 노트북 끝에 새 셀 생성 (기본)
 * - MODIFY: 기존 셀 내용 수정
 * - INSERT_AFTER: 특정 셀 뒤에 새 셀 삽입
 * - INSERT_BEFORE: 특정 셀 앞에 새 셀 삽입
 */
export type CellOperation = 'CREATE' | 'MODIFY' | 'INSERT_AFTER' | 'INSERT_BEFORE';

export interface ToolCall {
  tool: ToolName;
  parameters: JupyterCellParams | MarkdownParams | FinalAnswerParams
    | ReadFileParams | WriteFileParams | ListFilesParams
    | ExecuteCommandParams | SearchFilesParams;
}

// jupyter_cell 도구 파라미터
export interface JupyterCellParams {
  code: string;
  cellIndex?: number;       // 기존 셀 수정 시 인덱스 지정 (MODIFY)
  insertAfter?: number;     // 특정 셀 뒤에 삽입 (INSERT_AFTER)
  insertBefore?: number;    // 특정 셀 앞에 삽입 (INSERT_BEFORE)
  operation?: CellOperation; // 명시적 셀 작업 유형
}

// markdown 도구 파라미터
export interface MarkdownParams {
  content: string;
  cellIndex?: number;
}

// final_answer 도구 파라미터
export interface FinalAnswerParams {
  answer: string;
  summary?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Extended Tool Parameter Types (파일/터미널 작업)
// ═══════════════════════════════════════════════════════════════════════════

// read_file 도구 파라미터
export interface ReadFileParams {
  path: string;
  encoding?: string;   // 기본: 'utf-8'
  maxLines?: number;   // 대용량 파일 읽기 방지 (기본: 1000)
}

// write_file 도구 파라미터
export interface WriteFileParams {
  path: string;
  content: string;
  overwrite?: boolean; // 기본: false (기존 파일 덮어쓰기 방지)
}

// list_files 도구 파라미터
export interface ListFilesParams {
  path: string;
  recursive?: boolean; // 기본: false
  pattern?: string;    // glob 패턴 (예: "*.py")
}

// execute_command 도구 파라미터
export interface ExecuteCommandParams {
  command: string;
  timeout?: number;    // ms (기본: 30000)
}

// search_files 도구 파라미터
export interface SearchFilesParams {
  pattern: string;     // 검색 패턴 (regex 지원)
  path?: string;       // 검색 시작 경로 (기본: 현재 디렉토리)
  maxResults?: number; // 최대 결과 수 (기본: 100)
}

// ═══════════════════════════════════════════════════════════════════════════
// Tool Results
// ═══════════════════════════════════════════════════════════════════════════

export interface ToolResult {
  success: boolean;
  output?: any;
  error?: string;              // 에러 메시지 (evalue)
  errorName?: string;          // 에러 타입명 (ename, e.g., "ModuleNotFoundError")
  traceback?: string[];
  cellIndex?: number;
  wasModified?: boolean;      // 기존 셀 수정 vs 새 셀 생성 구분
  operation?: CellOperation;  // 수행된 셀 작업 유형
  previousContent?: string;   // 수정 전 원본 내용 (MODIFY 시)
}

// 커널 실행 결과
export interface ExecutionResult {
  status: 'ok' | 'error';
  stdout: string;
  stderr: string;
  result: any;
  error?: {
    ename: string;
    evalue: string;
    traceback: string[];
  };
  executionTime: number;
  cellIndex: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Plan-and-Execute 구조
// ═══════════════════════════════════════════════════════════════════════════

export interface ExecutionPlan {
  steps: PlanStep[];
  totalSteps: number;
  estimatedTime?: number;  // 예상 소요 시간 (초)
}

export interface PlanStep {
  stepNumber: number;
  description: string;
  toolCalls: ToolCall[];
  dependencies: number[];     // 의존하는 이전 단계 번호들
  isNew?: boolean;            // Replan으로 새로 추가된 스텝인지 여부
  wasReplanned?: boolean;     // Replan으로 수정된 스텝인지 여부
  isReplaced?: boolean;       // 완전히 교체된 스텝인지 여부
  cellOperation?: CellOperation;  // 이 스텝의 셀 작업 유형 (UI 표시용)
  targetCellIndex?: number;   // 대상 셀 인덱스 (UI 표시용)
}

export interface StepResult {
  success: boolean;
  stepNumber: number;
  toolResults: ToolResult[];
  attempts: number;
  isFinalAnswer?: boolean;
  finalAnswer?: string;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Agent Status & Progress
// ═══════════════════════════════════════════════════════════════════════════

export type AgentPhase =
  | 'idle'
  | 'planning'
  | 'planned'
  | 'executing'
  | 'tool_calling'
  | 'validating'      // 코드 사전 검증 중
  | 'verifying'       // 상태 검증 중 (Phase 1: State Verification)
  | 'replanning'      // Adaptive Replanning (Fast Fail 후 계획 수정)
  | 'reflecting'      // Reflection 분석 중
  | 'completed'
  | 'failed';

export interface AgentStatus {
  phase: AgentPhase;
  message?: string;
  plan?: ExecutionPlan;
  currentStep?: number;
  totalSteps?: number;
  description?: string;
  tool?: ToolName;
  attempt?: number;
  error?: ExecutionError;
  failedStep?: number;  // 실패한 step number (UI에 빨간 X 표시용)
  // Validation & Reflection 상태
  validationStatus?: 'checking' | 'passed' | 'warning' | 'failed';
  reflectionStatus?: 'analyzing' | 'passed' | 'adjusting';
  confidenceScore?: number;  // Reflection 신뢰도 점수 (0-100)
  // Replan 상세 정보
  replanInfo?: {
    errorType?: string;      // 에러 타입 (e.g., "ModuleNotFoundError")
    rootCause?: string;      // 원인 분석
    decision?: ReplanDecision;  // 결정 (refine, insert_steps, etc.)
    reasoning?: string;      // 결정 이유
    missingPackage?: string; // 누락된 패키지 (있는 경우)
  };
}

export interface ExecutionError {
  type: 'runtime' | 'timeout' | 'safety' | 'validation' | 'environment';
  message: string;               // 에러 메시지 (evalue)
  errorName?: string;            // 에러 타입명 (ename, e.g., "ModuleNotFoundError")
  traceback?: string[];
  recoverable: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Final Results
// ═══════════════════════════════════════════════════════════════════════════

export interface AutoAgentResult {
  success: boolean;
  plan: ExecutionPlan | null;
  executedSteps: StepResult[];
  createdCells: number[];    // 생성된 셀 인덱스들
  modifiedCells: number[];   // 수정된 셀 인덱스들
  finalAnswer?: string;
  error?: string;
  totalAttempts: number;
  executionTime?: number;    // 총 실행 시간 (ms)
}

// ═══════════════════════════════════════════════════════════════════════════
// Notebook Context
// ═══════════════════════════════════════════════════════════════════════════

export interface NotebookContext {
  cellCount: number;
  recentCells: CellContext[];
  importedLibraries: string[];
  definedVariables: string[];
  notebookPath?: string;
}

export interface CellContext {
  index: number;
  type: 'code' | 'markdown';
  source: string;
  output?: string;
  hasError?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Safety
// ═══════════════════════════════════════════════════════════════════════════

export interface SafetyResult {
  safe: boolean;
  warnings: string[];
  blockedPatterns?: string[];
}

export interface SafetyConfig {
  enableSafetyCheck: boolean;
  blockDangerousPatterns: boolean;
  requireConfirmation: boolean;
  maxExecutionTime: number;  // 초 단위
}

// ═══════════════════════════════════════════════════════════════════════════
// API Request/Response Types
// ═══════════════════════════════════════════════════════════════════════════

export interface AutoAgentPlanRequest {
  request: string;
  notebookContext: NotebookContext;
  availableTools?: ToolName[];
  llmConfig?: ILLMConfig;
}

export interface AutoAgentPlanResponse {
  plan: ExecutionPlan;
  reasoning?: string;
}

export interface AutoAgentRefineRequest {
  step: PlanStep;
  error: ExecutionError;
  attempt: number;
  previousCode?: string;
  llmConfig?: ILLMConfig;
}

export interface AutoAgentRefineResponse {
  toolCalls: ToolCall[];
  reasoning?: string;
}

export interface AutoAgentToolCallRequest {
  toolCall: ToolCall;
  context?: NotebookContext;
}

// ═══════════════════════════════════════════════════════════════════════════
// Code Validation Types (Pyflakes/AST 기반 사전 검증)
// ═══════════════════════════════════════════════════════════════════════════

export type IssueSeverity = 'error' | 'warning' | 'info';

export type IssueCategory =
  | 'syntax'
  | 'undefined_name'
  | 'unused_import'
  | 'unused_variable'
  | 'redefined'
  | 'import_error'
  | 'type_error';

export interface ValidationIssue {
  severity: IssueSeverity;
  category: IssueCategory;
  message: string;
  line?: number;
  column?: number;
  code_snippet?: string;
}

export interface DependencyInfo {
  imports: string[];
  from_imports: Record<string, string[]>;
  defined_names: string[];
  used_names: string[];
  undefined_names: string[];
}

export interface AutoAgentValidateRequest {
  code: string;
  notebookContext?: NotebookContext;
}

export interface AutoAgentValidateResponse {
  valid: boolean;
  issues: ValidationIssue[];
  dependencies: DependencyInfo | null;
  hasErrors: boolean;
  hasWarnings: boolean;
  summary: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Enhanced Planning Types (Checkpoint & Reflection 기반)
// ═══════════════════════════════════════════════════════════════════════════

export type RiskLevel = 'low' | 'medium' | 'high';

export interface Checkpoint {
  expectedOutcome: string;
  validationCriteria: string[];
  successIndicators: string[];
}

export interface ProblemDecomposition {
  core_goal: string;
  essential_steps: string[];
  optional_steps: string[];
}

export interface AnalysisDependency {
  required_libraries: string[];
  data_flow: string;
  shared_variables: string[];
}

export interface RiskAssessment {
  high_risk_steps: number[];
  external_dependencies: string[];
  estimated_complexity: 'low' | 'medium' | 'high';
}

export interface PlanAnalysis {
  problem_decomposition: ProblemDecomposition;
  dependency_analysis: AnalysisDependency;
  risk_assessment: RiskAssessment;
}

export interface EnhancedPlanStep extends PlanStep {
  checkpoint?: Checkpoint;
  riskLevel?: RiskLevel;
}

export interface EnhancedExecutionPlan extends ExecutionPlan {
  steps: EnhancedPlanStep[];
  analysis?: PlanAnalysis;
}

// ═══════════════════════════════════════════════════════════════════════════
// Reflection Types (실행 결과 분석)
// ═══════════════════════════════════════════════════════════════════════════

export interface ReflectionEvaluation {
  checkpoint_passed: boolean;
  output_matches_expected: boolean;
  confidence_score: number;
}

export interface ReflectionAnalysis {
  success_factors: string[];
  failure_factors: string[];
  unexpected_outcomes: string[];
}

export interface ReflectionImpact {
  affected_steps: number[];
  severity: 'none' | 'minor' | 'major' | 'critical';
  description: string;
}

export type ReflectionAction = 'continue' | 'adjust' | 'retry' | 'replan';
export type AdjustmentType = 'modify_code' | 'add_step' | 'remove_step' | 'change_approach';

export interface ReflectionAdjustment {
  step_number: number;
  change_type: AdjustmentType;
  description: string;
  new_content?: string;
}

export interface ReflectionRecommendations {
  action: ReflectionAction;
  adjustments: ReflectionAdjustment[];
  reasoning: string;
}

export interface ReflectionResult {
  evaluation: ReflectionEvaluation;
  analysis: ReflectionAnalysis;
  impact_on_remaining: ReflectionImpact;
  recommendations: ReflectionRecommendations;
}

export interface AutoAgentReflectRequest {
  stepNumber: number;
  stepDescription: string;
  executedCode: string;
  executionStatus: string;
  executionOutput: string;
  errorMessage?: string;
  expectedOutcome?: string;
  validationCriteria?: string[];
  remainingSteps?: PlanStep[];
}

export interface AutoAgentReflectResponse {
  reflection: ReflectionResult;
}

// Adaptive Replanning Types
export type ReplanDecision = 'refine' | 'insert_steps' | 'replace_step' | 'replan_remaining';

export interface AutoAgentReplanRequest {
  originalRequest: string;
  executedSteps: PlanStep[];
  failedStep: PlanStep;
  error: ExecutionError;
  executionOutput?: string;
}

export interface ReplanAnalysis {
  root_cause: string;
  is_approach_problem: boolean;
  missing_prerequisites: string[];
}

export interface ReplanChanges {
  // decision이 "refine"인 경우
  refined_code?: string;
  // decision이 "insert_steps"인 경우
  new_steps?: PlanStep[];
  // decision이 "replace_step"인 경우
  replacement?: PlanStep;
  // decision이 "replan_remaining"인 경우
  new_plan?: PlanStep[];
}

export interface AutoAgentReplanResponse {
  analysis: ReplanAnalysis;
  decision: ReplanDecision;
  reasoning: string;
  changes: ReplanChanges;
}

// ═══════════════════════════════════════════════════════════════════════════
// UI Component Props
// ═══════════════════════════════════════════════════════════════════════════

export interface AutoAgentPanelProps {
  notebook: any;  // NotebookPanel type from JupyterLab
  sessionContext: any;  // ISessionContext from JupyterLab
  onComplete?: (result: AutoAgentResult) => void;
  onCancel?: () => void;
  config?: AutoAgentConfig;
}

export type ExecutionSpeed = 'instant' | 'fast' | 'normal' | 'slow' | 'step-by-step';

export interface AutoAgentConfig {
  maxRetriesPerStep: number;
  executionTimeout: number;  // ms
  enableSafetyCheck: boolean;
  showDetailedProgress: boolean;
  // 실행 속도 제어
  executionSpeed: ExecutionSpeed;
  stepDelay: number;  // ms - 각 스텝 사이 지연
  autoScrollToCell: boolean;  // 실행 중인 셀로 자동 스크롤
  highlightCurrentCell: boolean;  // 현재 실행 중인 셀 하이라이트
}

// 속도 프리셋 (ms 단위 지연) - 전반적으로 느리게 조정
export const EXECUTION_SPEED_DELAYS: Record<ExecutionSpeed, number> = {
  'instant': 0,
  'fast': 800,      // 기존 normal 수준
  'normal': 1500,   // 기존 slow 수준 (사용자가 따라갈 수 있는 속도)
  'slow': 3000,     // 충분히 느리게
  'step-by-step': -1,  // -1은 수동 진행 의미
};

export const DEFAULT_AUTO_AGENT_CONFIG: AutoAgentConfig = {
  maxRetriesPerStep: 3,
  executionTimeout: 30000,
  enableSafetyCheck: true,
  showDetailedProgress: true,
  executionSpeed: 'normal',
  stepDelay: 1500,  // 기본값도 조정
  autoScrollToCell: true,
  highlightCurrentCell: true,
};

// ═══════════════════════════════════════════════════════════════════════════
// State Verification Types (Phase 1: 상태 검증 레이어)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 신뢰도 임계값 상수
 * - PROCEED (0.8): 계속 진행
 * - WARNING (0.6): 경고 로그, 진행
 * - REPLAN (0.4): 리플래닝 트리거
 * - ESCALATE (0.2): 사용자 개입 필요
 */
export const CONFIDENCE_THRESHOLDS = {
  PROCEED: 0.8,
  WARNING: 0.6,
  REPLAN: 0.4,
  ESCALATE: 0.2,
} as const;

export type ConfidenceThresholdKey = keyof typeof CONFIDENCE_THRESHOLDS;

/**
 * 상태 불일치 유형
 */
export type MismatchType =
  | 'variable_missing'      // 예상 변수가 생성되지 않음
  | 'variable_type_mismatch' // 변수 타입이 예상과 다름
  | 'output_missing'        // 예상 출력이 없음
  | 'output_mismatch'       // 출력이 예상과 다름
  | 'file_not_created'      // 파일이 생성되지 않음
  | 'import_failed'         // import가 실패함
  | 'exception_occurred'    // 예상치 못한 예외 발생
  | 'partial_execution';    // 부분 실행 (일부만 성공)

/**
 * 개별 상태 불일치 상세 정보
 */
export interface StateMismatch {
  type: MismatchType;
  severity: 'critical' | 'major' | 'minor';
  description: string;
  expected?: string;
  actual?: string;
  suggestion?: string;  // 복구 제안
}

/**
 * 신뢰도 계산 상세 정보
 */
export interface ConfidenceScore {
  overall: number;  // 0.0 - 1.0
  factors: {
    outputMatch: number;      // 출력 일치도 (0.0 - 1.0)
    variableCreation: number; // 변수 생성 성공률 (0.0 - 1.0)
    noExceptions: number;     // 예외 없음 (0 or 1)
    executionComplete: number; // 완전 실행 (0 or 1)
  };
  weights: {
    outputMatch: number;
    variableCreation: number;
    noExceptions: number;
    executionComplete: number;
  };
}

/**
 * 상태 검증 결과
 */
export interface StateVerificationResult {
  isValid: boolean;
  confidence: number;  // 0.0 - 1.0
  confidenceDetails: ConfidenceScore;
  mismatches: StateMismatch[];
  recommendation: 'proceed' | 'warning' | 'replan' | 'escalate';
  timestamp: number;
}

/**
 * 스텝 실행 후 예상 상태
 */
export interface StateExpectation {
  stepNumber: number;
  expectedVariables?: string[];     // 생성될 것으로 예상되는 변수들
  expectedOutputPatterns?: string[]; // 예상 출력 패턴 (regex)
  expectedImports?: string[];       // 성공적으로 import될 라이브러리들
  expectedFiles?: string[];         // 생성될 파일들 (상대 경로)
  shouldNotError?: boolean;         // 에러가 없어야 하는지
  customValidators?: string[];      // 커스텀 검증 함수명들
}

/**
 * 검증 컨텍스트 - 검증에 필요한 모든 정보
 */
export interface VerificationContext {
  stepNumber: number;
  executionResult: ExecutionResult;
  expectation?: StateExpectation;
  previousVariables: string[];      // 실행 전 커널 변수 목록
  currentVariables: string[];       // 실행 후 커널 변수 목록
  notebookContext: NotebookContext;
}

/**
 * 검증 상태 API 요청
 */
export interface AutoAgentVerifyStateRequest {
  stepNumber: number;
  executedCode: string;
  executionOutput: string;
  executionStatus: 'ok' | 'error';
  errorMessage?: string;
  expectedVariables?: string[];
  expectedOutputPatterns?: string[];
  previousVariables: string[];
  currentVariables: string[];
}

/**
 * 검증 상태 API 응답
 */
export interface AutoAgentVerifyStateResponse {
  verification: StateVerificationResult;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tool Registry & Approval Types (Phase 1)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 도구 위험 수준 (Tool Registry용)
 * - low: 읽기 전용, 셀 내부 실행
 * - medium: 셀 생성/수정
 * - high: 파일 시스템 접근
 * - critical: 네트워크/시스템 명령
 */
export type ToolRiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * 도구 카테고리
 */
export type ToolCategory = 'cell' | 'file' | 'network' | 'system' | 'answer';

/**
 * 도구 실행 컨텍스트
 */
export interface ToolExecutionContext {
  notebook: any;  // NotebookPanel
  sessionContext: any;  // ISessionContext
  stepNumber?: number;
}

/**
 * 도구 정의 인터페이스
 */
export interface ToolDefinition {
  name: ToolName;
  description: string;
  riskLevel: ToolRiskLevel;
  requiresApproval: boolean;
  category: ToolCategory;
  executor: (params: any, context: ToolExecutionContext) => Promise<ToolResult>;
}

/**
 * 승인 요청 정보
 */
export interface ApprovalRequest {
  id: string;
  toolName: ToolName;
  toolDefinition: ToolDefinition;
  parameters: any;
  stepNumber?: number;
  description?: string;
  timestamp: number;
}

/**
 * 승인 결과
 */
export interface ApprovalResult {
  approved: boolean;
  requestId: string;
  reason?: string;
  timestamp: number;
}

/**
 * 승인 콜백 타입
 */
export type ApprovalCallback = (request: ApprovalRequest) => Promise<ApprovalResult>;

// ═══════════════════════════════════════════════════════════════════════════
// Context Window Management Types (Phase 2)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 셀 우선순위 레벨
 * - critical: 현재 실행 중인 셀
 * - high: 최근 3개 셀
 * - medium: 최근 5개 셀 (high 제외)
 * - low: 나머지 셀
 */
export type CellPriority = 'critical' | 'high' | 'medium' | 'low';

/**
 * 우선순위가 부여된 셀 정보
 */
export interface PrioritizedCell extends CellContext {
  priority: CellPriority;
  tokenEstimate: number;
}

/**
 * 토큰 사용량 통계
 */
export interface TokenUsageStats {
  totalTokens: number;
  cellTokens: number;
  variableTokens: number;
  libraryTokens: number;
  reservedTokens: number;
  usagePercent: number;
}

/**
 * 컨텍스트 예산 설정
 */
export interface ContextBudget {
  maxTokens: number;           // 최대 토큰 수 (기본: 8000)
  warningThreshold: number;    // 경고 임계값 (0-1, 기본: 0.75)
  reservedForResponse: number; // 응답용 예약 토큰 (기본: 2000)
}

/**
 * 기본 컨텍스트 예산 설정
 */
export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  maxTokens: 8000,
  warningThreshold: 0.75,
  reservedForResponse: 2000,
};

/**
 * 컨텍스트 관리자 상태
 */
export interface ContextManagerState {
  budget: ContextBudget;
  currentUsage: TokenUsageStats;
  isPruningRequired: boolean;
  lastPruneTimestamp?: number;
}

/**
 * 컨텍스트 축소 결과
 */
export interface ContextPruneResult {
  originalTokens: number;
  prunedTokens: number;
  removedCellCount: number;
  truncatedCellCount: number;
  preservedCells: number[];  // 유지된 셀 인덱스들
}

// ═══════════════════════════════════════════════════════════════════════════
// Checkpoint/Rollback Types (Phase 3)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 셀 스냅샷 정보
 * 롤백 시 셀 상태 복원에 사용
 */
export interface CellSnapshot {
  index: number;
  type: 'code' | 'markdown';
  source: string;
  outputs: any[];
  wasCreated: boolean;       // 이 스텝에서 새로 생성된 셀인지
  wasModified: boolean;      // 이 스텝에서 수정된 셀인지
  previousSource?: string;   // 수정 전 원본 소스 (wasModified=true일 때)
}

/**
 * 실행 체크포인트
 * 각 성공 스텝 후 저장되는 상태 스냅샷
 */
export interface ExecutionCheckpoint {
  id: string;
  stepNumber: number;
  timestamp: number;
  description: string;        // 스텝 설명
  planSnapshot: ExecutionPlan;
  cellSnapshots: CellSnapshot[];
  variableNames: string[];    // 이 시점까지 정의된 변수들
  createdCellIndices: number[];   // 이 시점까지 생성된 셀 인덱스들
  modifiedCellIndices: number[];  // 이 시점까지 수정된 셀 인덱스들
}

/**
 * 롤백 결과
 */
export interface RollbackResult {
  success: boolean;
  rolledBackTo: number;       // 롤백된 체크포인트의 stepNumber
  deletedCells: number[];     // 삭제된 셀 인덱스들
  restoredCells: number[];    // 복원된 셀 인덱스들
  error?: string;
}

/**
 * 체크포인트 관리자 설정
 */
export interface CheckpointConfig {
  maxCheckpoints: number;     // 최대 체크포인트 수 (순환 버퍼, 기본: 10)
  autoSave: boolean;          // 자동 저장 여부 (기본: true)
  saveToNotebookMetadata: boolean;  // 노트북 메타데이터에 저장 (기본: false)
}

/**
 * 기본 체크포인트 설정
 */
export const DEFAULT_CHECKPOINT_CONFIG: CheckpointConfig = {
  maxCheckpoints: 10,
  autoSave: true,
  saveToNotebookMetadata: false,
};

/**
 * 체크포인트 관리자 상태
 */
export interface CheckpointManagerState {
  config: CheckpointConfig;
  checkpointCount: number;
  oldestCheckpoint?: number;  // 가장 오래된 체크포인트의 stepNumber
  latestCheckpoint?: number;  // 가장 최근 체크포인트의 stepNumber
}
