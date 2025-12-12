/**
 * Auto-Agent Type Definitions
 * HuggingFace Jupyter Agent 패턴 기반 Tool Calling 구조
 */

// ═══════════════════════════════════════════════════════════════════════════
// Tool Definitions (HF Jupyter Agent 패턴)
// ═══════════════════════════════════════════════════════════════════════════

export type ToolName = 'jupyter_cell' | 'markdown' | 'final_answer';

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
  parameters: JupyterCellParams | MarkdownParams | FinalAnswerParams;
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
