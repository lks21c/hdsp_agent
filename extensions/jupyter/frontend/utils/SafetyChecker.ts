/**
 * SafetyChecker - 코드 안전 검사기
 *
 * 위험한 코드 패턴을 사전에 검출하여 실행 전 경고
 * NBI (Notebook Intelligence) 패턴 참조
 */

import { SafetyResult, SafetyConfig } from '../types/auto-agent';

// 위험한 패턴 정의
interface DangerousPattern {
  pattern: RegExp;
  description: string;
  severity: 'critical' | 'warning' | 'info';
  category: 'system' | 'file' | 'network' | 'security' | 'loop';
}

const DANGEROUS_PATTERNS: DangerousPattern[] = [
  // 시스템 명령 관련
  {
    pattern: /rm\s+-rf\s+[\/~]/,
    description: '재귀 삭제 명령 (rm -rf)',
    severity: 'critical',
    category: 'system',
  },
  {
    pattern: /os\.system\s*\(/,
    description: '시스템 명령 실행 (os.system)',
    severity: 'critical',
    category: 'system',
  },
  {
    pattern: /subprocess\.(run|call|Popen|check_output)\s*\(/,
    description: '서브프로세스 실행 (subprocess)',
    severity: 'warning',
    category: 'system',
  },
  {
    pattern: /os\.exec\w*\s*\(/,
    description: 'OS exec 명령 실행',
    severity: 'critical',
    category: 'system',
  },

  // 동적 코드 실행
  {
    pattern: /\beval\s*\(/,
    description: '동적 코드 실행 (eval)',
    severity: 'critical',
    category: 'security',
  },
  {
    pattern: /\bexec\s*\(/,
    description: '동적 코드 실행 (exec)',
    severity: 'critical',
    category: 'security',
  },
  {
    pattern: /__import__\s*\(/,
    description: '동적 모듈 임포트 (__import__)',
    severity: 'warning',
    category: 'security',
  },
  {
    pattern: /compile\s*\([^)]*exec/,
    description: '동적 코드 컴파일 (compile)',
    severity: 'critical',
    category: 'security',
  },

  // 파일 시스템 관련
  {
    pattern: /open\s*\([^)]*,\s*['"]w/,
    description: '파일 쓰기 모드 열기',
    severity: 'warning',
    category: 'file',
  },
  {
    pattern: /shutil\.(rmtree|move|copy)/,
    description: '파일/디렉토리 조작 (shutil)',
    severity: 'warning',
    category: 'file',
  },
  {
    pattern: /os\.(remove|unlink|rmdir|makedirs|rename)/,
    description: '파일 시스템 변경 (os)',
    severity: 'warning',
    category: 'file',
  },
  {
    pattern: /pathlib\.Path[^)]*\.(unlink|rmdir|write)/,
    description: '파일 시스템 변경 (pathlib)',
    severity: 'warning',
    category: 'file',
  },

  // 네트워크 관련
  {
    pattern: /requests\.(get|post|put|delete|patch)\s*\([^)]*\)/,
    description: 'HTTP 요청 (requests)',
    severity: 'info',
    category: 'network',
  },
  {
    pattern: /urllib\.(request|urlopen)/,
    description: 'URL 요청 (urllib)',
    severity: 'info',
    category: 'network',
  },
  {
    pattern: /socket\./,
    description: '소켓 통신 (socket)',
    severity: 'warning',
    category: 'network',
  },

  // 무한 루프 패턴
  {
    pattern: /while\s+True\s*:/,
    description: '무한 루프 (while True)',
    severity: 'warning',
    category: 'loop',
  },
  {
    pattern: /while\s+1\s*:/,
    description: '무한 루프 (while 1)',
    severity: 'warning',
    category: 'loop',
  },
  {
    pattern: /for\s+\w+\s+in\s+iter\s*\(\s*int\s*,/,
    description: '무한 반복자 (iter(int, ...))',
    severity: 'warning',
    category: 'loop',
  },

  // 민감 정보 관련
  {
    pattern: /os\.environ\s*\[/,
    description: '환경 변수 접근',
    severity: 'info',
    category: 'security',
  },
  {
    pattern: /(password|secret|api_key|token)\s*=\s*['"][^'"]+['"]/i,
    description: '하드코딩된 민감 정보',
    severity: 'warning',
    category: 'security',
  },

  // 위험한 모듈
  {
    pattern: /import\s+pickle|from\s+pickle\s+import/,
    description: 'Pickle 모듈 (역직렬화 취약점)',
    severity: 'info',
    category: 'security',
  },
  {
    pattern: /import\s+ctypes|from\s+ctypes\s+import/,
    description: 'ctypes 모듈 (저수준 메모리 접근)',
    severity: 'warning',
    category: 'security',
  },
];

export class SafetyChecker {
  private config: SafetyConfig;

  constructor(config?: Partial<SafetyConfig>) {
    this.config = {
      enableSafetyCheck: true,
      blockDangerousPatterns: false, // 기본: 경고만, 차단 안함
      requireConfirmation: true,
      maxExecutionTime: 30,
      ...config,
    };
  }

  /**
   * 코드 안전성 검사
   */
  checkCodeSafety(code: string): SafetyResult {
    if (!this.config.enableSafetyCheck) {
      return { safe: true, warnings: [] };
    }

    const warnings: string[] = [];
    const blockedPatterns: string[] = [];

    for (const dangerous of DANGEROUS_PATTERNS) {
      if (dangerous.pattern.test(code)) {
        const message = `[${dangerous.severity.toUpperCase()}] ${dangerous.description}`;

        if (dangerous.severity === 'critical' && this.config.blockDangerousPatterns) {
          blockedPatterns.push(message);
        } else {
          warnings.push(message);
        }
      }
    }

    const safe = blockedPatterns.length === 0;

    return {
      safe,
      warnings,
      blockedPatterns: blockedPatterns.length > 0 ? blockedPatterns : undefined,
    };
  }

  /**
   * 여러 코드 블록 검사
   */
  checkMultipleCodeBlocks(codes: string[]): SafetyResult {
    const allWarnings: string[] = [];
    const allBlockedPatterns: string[] = [];

    for (let i = 0; i < codes.length; i++) {
      const result = this.checkCodeSafety(codes[i]);
      result.warnings.forEach((w) => allWarnings.push(`[Block ${i + 1}] ${w}`));
      if (result.blockedPatterns) {
        result.blockedPatterns.forEach((b) => allBlockedPatterns.push(`[Block ${i + 1}] ${b}`));
      }
    }

    return {
      safe: allBlockedPatterns.length === 0,
      warnings: allWarnings,
      blockedPatterns: allBlockedPatterns.length > 0 ? allBlockedPatterns : undefined,
    };
  }

  /**
   * 무한 루프 가능성 검사
   */
  checkInfiniteLoopRisk(code: string): boolean {
    const loopPatterns = DANGEROUS_PATTERNS.filter((p) => p.category === 'loop');
    return loopPatterns.some((p) => p.pattern.test(code));
  }

  /**
   * 파일 시스템 변경 위험 검사
   */
  checkFileSystemRisk(code: string): boolean {
    const filePatterns = DANGEROUS_PATTERNS.filter((p) => p.category === 'file');
    return filePatterns.some((p) => p.pattern.test(code));
  }

  /**
   * 네트워크 활동 검사
   */
  checkNetworkActivity(code: string): boolean {
    const networkPatterns = DANGEROUS_PATTERNS.filter((p) => p.category === 'network');
    return networkPatterns.some((p) => p.pattern.test(code));
  }

  /**
   * 실행 시간 제한 값 반환
   */
  getMaxExecutionTime(): number {
    return this.config.maxExecutionTime * 1000; // ms로 변환
  }

  /**
   * 확인 필요 여부
   */
  requiresConfirmation(result: SafetyResult): boolean {
    if (!this.config.requireConfirmation) {
      return false;
    }
    return result.warnings.length > 0 || (result.blockedPatterns?.length || 0) > 0;
  }

  /**
   * 설정 업데이트
   */
  updateConfig(config: Partial<SafetyConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 현재 설정 반환
   */
  getConfig(): SafetyConfig {
    return { ...this.config };
  }

  /**
   * 사용자 친화적 경고 메시지 생성
   */
  formatWarningsForDisplay(result: SafetyResult): string {
    if (result.warnings.length === 0 && !result.blockedPatterns?.length) {
      return '';
    }

    const lines: string[] = [];

    if (result.blockedPatterns && result.blockedPatterns.length > 0) {
      lines.push('⛔ 차단된 패턴:');
      result.blockedPatterns.forEach((p) => lines.push(`  • ${p}`));
    }

    if (result.warnings.length > 0) {
      lines.push('⚠️ 경고:');
      result.warnings.forEach((w) => lines.push(`  • ${w}`));
    }

    return lines.join('\n');
  }
}

export default SafetyChecker;
