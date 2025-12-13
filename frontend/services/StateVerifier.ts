/**
 * State Verifier Service
 * Phase 1: 상태 검증 레이어 - 각 단계 실행 후 상태 검증으로 silent failure 감지
 */

import { ApiService } from './ApiService';
import {
  StateVerificationResult,
  StateMismatch,
  ConfidenceScore,
  StateExpectation,
  VerificationContext,
  AutoAgentVerifyStateRequest,
  AutoAgentVerifyStateResponse,
  CONFIDENCE_THRESHOLDS,
  MismatchType,
  ExecutionResult,
  NotebookContext,
} from '../types/auto-agent';

// 기본 가중치 설정
const DEFAULT_WEIGHTS = {
  outputMatch: 0.3,
  variableCreation: 0.3,
  noExceptions: 0.25,
  executionComplete: 0.15,
};

/**
 * 상태 검증 서비스
 * - 스텝 실행 후 예상 상태와 실제 상태 비교
 * - 신뢰도 점수 계산
 * - 리플래닝 트리거 결정
 */
export class StateVerifier {
  private apiService: ApiService;
  private verificationHistory: StateVerificationResult[] = [];

  constructor(apiService: ApiService) {
    this.apiService = apiService;
  }

  /**
   * 스텝 실행 결과 검증
   * @param context 검증 컨텍스트
   * @returns 검증 결과
   */
  async verifyStepState(context: VerificationContext): Promise<StateVerificationResult> {
    console.log('[StateVerifier] Verifying step state:', {
      stepNumber: context.stepNumber,
      executionStatus: context.executionResult.status,
    });

    const mismatches: StateMismatch[] = [];
    const factors: ConfidenceScore['factors'] = {
      outputMatch: 1.0,
      variableCreation: 1.0,
      noExceptions: 1.0,
      executionComplete: 1.0,
    };

    // 1. 실행 완료 여부 확인
    if (context.executionResult.status === 'error') {
      factors.noExceptions = 0;
      factors.executionComplete = 0;

      mismatches.push({
        type: 'exception_occurred',
        severity: 'critical',
        description: `실행 중 예외 발생: ${context.executionResult.error?.ename || 'Unknown'}`,
        expected: '에러 없음',
        actual: context.executionResult.error?.evalue || 'Unknown error',
        suggestion: this.getSuggestionForError(context.executionResult.error?.ename),
      });
    }

    // 2. 변수 생성 검증 (expectation이 있는 경우)
    if (context.expectation?.expectedVariables) {
      const createdVariables = this.getNewVariables(
        context.previousVariables,
        context.currentVariables
      );

      const { score, variableMismatches } = this.verifyVariables(
        context.expectation.expectedVariables,
        createdVariables
      );

      factors.variableCreation = score;
      mismatches.push(...variableMismatches);
    }

    // 3. 출력 패턴 검증 (expectation이 있는 경우)
    if (context.expectation?.expectedOutputPatterns) {
      const { score, outputMismatches } = this.verifyOutputPatterns(
        context.expectation.expectedOutputPatterns,
        context.executionResult.stdout + context.executionResult.result
      );

      factors.outputMatch = score;
      mismatches.push(...outputMismatches);
    }

    // 4. Import 검증
    if (context.expectation?.expectedImports) {
      const importMismatches = this.verifyImports(
        context.expectation.expectedImports,
        context.executionResult
      );
      mismatches.push(...importMismatches);
    }

    // 5. 신뢰도 점수 계산
    const confidenceDetails = this.calculateConfidence(factors);

    // 6. 권장 사항 결정
    const recommendation = this.determineRecommendation(confidenceDetails.overall);

    const result: StateVerificationResult = {
      isValid: mismatches.filter(m => m.severity === 'critical').length === 0,
      confidence: confidenceDetails.overall,
      confidenceDetails,
      mismatches,
      recommendation,
      timestamp: Date.now(),
    };

    // 이력 저장
    this.verificationHistory.push(result);

    console.log('[StateVerifier] Verification result:', {
      isValid: result.isValid,
      confidence: result.confidence,
      recommendation: result.recommendation,
      mismatchCount: result.mismatches.length,
    });

    return result;
  }

  /**
   * 백엔드 API를 통한 상세 검증 (복잡한 케이스)
   */
  async verifyWithBackend(
    stepNumber: number,
    executedCode: string,
    executionResult: ExecutionResult,
    expectation?: StateExpectation,
    previousVariables: string[] = [],
    currentVariables: string[] = []
  ): Promise<StateVerificationResult> {
    try {
      const request: AutoAgentVerifyStateRequest = {
        stepNumber,
        executedCode,
        executionOutput: executionResult.stdout + '\n' + JSON.stringify(executionResult.result),
        executionStatus: executionResult.status,
        errorMessage: executionResult.error?.evalue,
        expectedVariables: expectation?.expectedVariables,
        expectedOutputPatterns: expectation?.expectedOutputPatterns,
        previousVariables,
        currentVariables,
      };

      const response = await this.apiService.verifyState(request);
      return response.verification;
    } catch (error) {
      console.error('[StateVerifier] Backend verification failed, using local verification:', error);

      // 폴백: 로컬 검증 수행
      return this.verifyStepState({
        stepNumber,
        executionResult,
        expectation,
        previousVariables,
        currentVariables,
        notebookContext: { cellCount: 0, recentCells: [], importedLibraries: [], definedVariables: [] },
      });
    }
  }

  /**
   * 신뢰도 점수 계산
   */
  calculateConfidence(
    factors: ConfidenceScore['factors'],
    weights: ConfidenceScore['weights'] = DEFAULT_WEIGHTS
  ): ConfidenceScore {
    const overall =
      factors.outputMatch * weights.outputMatch +
      factors.variableCreation * weights.variableCreation +
      factors.noExceptions * weights.noExceptions +
      factors.executionComplete * weights.executionComplete;

    return {
      overall: Math.max(0, Math.min(1, overall)),
      factors,
      weights,
    };
  }

  /**
   * 신뢰도에 따른 권장 사항 결정
   */
  determineRecommendation(
    confidence: number
  ): StateVerificationResult['recommendation'] {
    if (confidence >= CONFIDENCE_THRESHOLDS.PROCEED) {
      return 'proceed';
    } else if (confidence >= CONFIDENCE_THRESHOLDS.WARNING) {
      return 'warning';
    } else if (confidence >= CONFIDENCE_THRESHOLDS.REPLAN) {
      return 'replan';
    } else {
      return 'escalate';
    }
  }

  /**
   * 이전/이후 변수 목록 비교하여 새로 생성된 변수 추출
   */
  private getNewVariables(previousVars: string[], currentVars: string[]): string[] {
    const previousSet = new Set(previousVars);
    return currentVars.filter(v => !previousSet.has(v));
  }

  /**
   * 변수 생성 검증
   */
  private verifyVariables(
    expectedVars: string[],
    createdVars: string[]
  ): { score: number; variableMismatches: StateMismatch[] } {
    const mismatches: StateMismatch[] = [];
    const createdSet = new Set(createdVars);

    let matchCount = 0;
    for (const expected of expectedVars) {
      if (createdSet.has(expected)) {
        matchCount++;
      } else {
        mismatches.push({
          type: 'variable_missing',
          severity: 'major',
          description: `예상 변수 '${expected}'가 생성되지 않음`,
          expected,
          actual: '(없음)',
          suggestion: `변수 '${expected}'를 생성하는 코드가 올바르게 실행되었는지 확인하세요`,
        });
      }
    }

    const score = expectedVars.length > 0 ? matchCount / expectedVars.length : 1;
    return { score, variableMismatches: mismatches };
  }

  /**
   * 출력 패턴 검증
   */
  private verifyOutputPatterns(
    patterns: string[],
    output: string
  ): { score: number; outputMismatches: StateMismatch[] } {
    const mismatches: StateMismatch[] = [];

    let matchCount = 0;
    for (const pattern of patterns) {
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(output)) {
          matchCount++;
        } else {
          mismatches.push({
            type: 'output_mismatch',
            severity: 'minor',
            description: `출력에서 예상 패턴을 찾을 수 없음`,
            expected: pattern,
            actual: output.substring(0, 100) + (output.length > 100 ? '...' : ''),
          });
        }
      } catch (e) {
        // 정규식 오류 시 문자열 포함 검사
        if (output.includes(pattern)) {
          matchCount++;
        }
      }
    }

    const score = patterns.length > 0 ? matchCount / patterns.length : 1;
    return { score, outputMismatches: mismatches };
  }

  /**
   * Import 검증
   */
  private verifyImports(
    expectedImports: string[],
    executionResult: ExecutionResult
  ): StateMismatch[] {
    const mismatches: StateMismatch[] = [];

    // 에러가 ModuleNotFoundError 또는 ImportError인 경우
    if (executionResult.error) {
      const errorName = executionResult.error.ename;
      const errorValue = executionResult.error.evalue;

      if (errorName === 'ModuleNotFoundError' || errorName === 'ImportError') {
        // 어떤 모듈이 실패했는지 추출
        const moduleMatch = errorValue.match(/No module named '([^']+)'/);
        const failedModule = moduleMatch ? moduleMatch[1] : 'unknown';

        mismatches.push({
          type: 'import_failed',
          severity: 'critical',
          description: `모듈 '${failedModule}' import 실패`,
          expected: `${failedModule} 모듈이 설치되어 있어야 함`,
          actual: errorValue,
          suggestion: `pip install ${failedModule} 또는 conda install ${failedModule}로 설치하세요`,
        });
      }
    }

    return mismatches;
  }

  /**
   * 에러 타입에 따른 복구 제안
   */
  private getSuggestionForError(errorName?: string): string {
    const suggestions: Record<string, string> = {
      'ModuleNotFoundError': '누락된 패키지를 설치하세요 (pip install)',
      'NameError': '변수가 정의되었는지 확인하세요. 이전 셀을 먼저 실행해야 할 수 있습니다.',
      'SyntaxError': '코드 문법을 확인하세요',
      'TypeError': '함수 인자 타입을 확인하세요',
      'ValueError': '입력 값의 범위나 형식을 확인하세요',
      'KeyError': '딕셔너리 키가 존재하는지 확인하세요',
      'IndexError': '리스트/배열 인덱스가 범위 내인지 확인하세요',
      'FileNotFoundError': '파일 경로가 올바른지 확인하세요',
      'AttributeError': '객체에 해당 속성/메서드가 있는지 확인하세요',
    };

    return suggestions[errorName || ''] || '에러 메시지를 확인하고 코드를 수정하세요';
  }

  /**
   * 최근 검증 이력 조회
   */
  getRecentHistory(count: number = 5): StateVerificationResult[] {
    return this.verificationHistory.slice(-count);
  }

  /**
   * 전체 신뢰도 트렌드 분석
   */
  analyzeConfidenceTrend(): {
    average: number;
    trend: 'improving' | 'declining' | 'stable';
    criticalCount: number;
  } {
    if (this.verificationHistory.length < 2) {
      return {
        average: this.verificationHistory[0]?.confidence ?? 1,
        trend: 'stable',
        criticalCount: this.verificationHistory.filter(v => !v.isValid).length,
      };
    }

    const confidences = this.verificationHistory.map(v => v.confidence);
    const average = confidences.reduce((a, b) => a + b, 0) / confidences.length;

    // 최근 3개와 이전 3개 비교
    const recentAvg = confidences.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, confidences.length);
    const previousAvg = confidences.slice(0, -3).reduce((a, b) => a + b, 0) / Math.max(1, confidences.length - 3);

    let trend: 'improving' | 'declining' | 'stable' = 'stable';
    if (recentAvg > previousAvg + 0.1) {
      trend = 'improving';
    } else if (recentAvg < previousAvg - 0.1) {
      trend = 'declining';
    }

    return {
      average,
      trend,
      criticalCount: this.verificationHistory.filter(v => !v.isValid).length,
    };
  }

  /**
   * 검증 이력 초기화
   */
  clearHistory(): void {
    this.verificationHistory = [];
  }
}
