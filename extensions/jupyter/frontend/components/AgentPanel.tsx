/**
 * Agent Panel - Main sidebar panel for Jupyter Agent
 * Cursor AI Style: Unified Chat + Agent Interface
 */

import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';
import { ReactWidget, LabIcon } from '@jupyterlab/ui-components';
import { NotebookPanel, NotebookActions } from '@jupyterlab/notebook';
import { ApiService } from '../services/ApiService';
import { IChatMessage, IFileFixRequest, IFixedFile } from '../types';
import { SettingsPanel } from './SettingsPanel';
import {
  getLLMConfig,
  saveLLMConfig,
  hasValidApiKey,
  getDefaultLLMConfig,
  LLMConfig
} from '../services/ApiKeyManager';
import { AgentOrchestrator } from '../services/AgentOrchestrator';
import {
  AgentStatus,
  AutoAgentResult,
  ExecutionPlan,
  DEFAULT_AUTO_AGENT_CONFIG,
  ExecutionSpeed,
  ListFilesParams,
  ReadFileParams,
  ToolResult,
} from '../types/auto-agent';
import { formatMarkdownToHtml, escapeHtml } from '../utils/markdownRenderer';
import { FileSelectionDialog } from './FileSelectionDialog';

// 로고 이미지 (SVG) - TypeScript 모듈에서 인라인 문자열로 import
import { headerLogoSvg, tabbarLogoSvg } from '../logoSvg';

// 탭바 아이콘 생성
const hdspTabIcon = new LabIcon({
  name: 'hdsp-agent:tab-icon',
  svgstr: tabbarLogoSvg
});

// Agent 실행 메시지 타입 (채팅에 inline으로 표시)
interface AgentExecutionMessage {
  id: string;
  type: 'agent_execution';
  request: string;
  status: AgentStatus;
  plan: ExecutionPlan | null;
  result: AutoAgentResult | null;
  completedSteps: number[];
  failedSteps: number[];
  timestamp: number;
}

// 통합 메시지 타입 (Chat 메시지 또는 Agent 실행)
type UnifiedMessage = IChatMessage | AgentExecutionMessage;

interface AgentPanelProps {
  apiService: ApiService;
  notebookTracker?: any;
  consoleTracker?: any;  // IConsoleTracker from @jupyterlab/console
}

export interface ChatPanelHandle {
  handleSendMessage: () => Promise<void>;
  setInput: (value: string) => void;
  setLlmPrompt: (prompt: string) => void;
  setCurrentCellId: (cellId: string) => void;
  setCurrentCellIndex: (cellIndex: number) => void;
  setInputMode: (mode: 'chat' | 'agent') => void;
}

// Agent 명령어 감지 함수
const isAgentCommand = (input: string): boolean => {
  const trimmed = input.trim().toLowerCase();
  return trimmed.startsWith('/run ') ||
         trimmed.startsWith('@agent ') ||
         trimmed.startsWith('/agent ') ||
         trimmed.startsWith('/execute ');
};

// Agent 명령어에서 실제 요청 추출
const extractAgentRequest = (input: string): string => {
  const trimmed = input.trim();
  if (trimmed.toLowerCase().startsWith('/run ')) {
    return trimmed.slice(5).trim();
  }
  if (trimmed.toLowerCase().startsWith('@agent ')) {
    return trimmed.slice(7).trim();
  }
  if (trimmed.toLowerCase().startsWith('/agent ')) {
    return trimmed.slice(7).trim();
  }
  if (trimmed.toLowerCase().startsWith('/execute ')) {
    return trimmed.slice(9).trim();
  }
  return trimmed;
};

// ═══════════════════════════════════════════════════════════════════════════
// Python 파일 에러 감지 및 처리 유틸리티
// ═══════════════════════════════════════════════════════════════════════════

// Python 에러 패턴 감지
const detectPythonError = (text: string): boolean => {
  const errorPatterns = [
    /Traceback \(most recent call last\)/i,
    /SyntaxError:/i,
    /NameError:/i,
    /TypeError:/i,
    /ImportError:/i,
    /ModuleNotFoundError:/i,
    /AttributeError:/i,
    /ValueError:/i,
    /KeyError:/i,
    /IndexError:/i,
    /FileNotFoundError:/i,
    /File\s+"[^"]+\.py"/i,
  ];
  return errorPatterns.some(pattern => pattern.test(text));
};

// 에러 메시지에서 Python 파일 경로 추출
const extractFilePathsFromError = (text: string): string[] => {
  const paths: string[] = [];

  // 패턴 1: python xxx.py 명령어
  const cmdMatch = text.match(/python\s+(\S+\.py)/gi);
  if (cmdMatch) {
    cmdMatch.forEach(match => {
      const pathMatch = match.match(/python\s+(\S+\.py)/i);
      if (pathMatch) paths.push(pathMatch[1]);
    });
  }

  // 패턴 2: File "xxx.py" 형식 (트레이스백)
  const fileMatches = text.matchAll(/File\s+"([^"]+\.py)"/gi);
  for (const match of fileMatches) {
    if (!paths.includes(match[1])) {
      paths.push(match[1]);
    }
  }

  return paths;
};

// 메인 파일 경로 추출 (명령어에서 실행한 파일)
const extractMainFilePath = (text: string): string | null => {
  // python xxx.py 명령어에서 추출
  const cmdMatch = text.match(/python\s+(\S+\.py)/i);
  if (cmdMatch) {
    return cmdMatch[1];
  }
  return null;
};

// 에러가 발생한 실제 파일 추출 (트레이스백의 마지막 파일)
const extractErrorFilePath = (text: string): string | null => {
  // File "xxx.py" 패턴들 중 마지막 것 (실제 에러 발생 위치)
  const fileMatches = [...text.matchAll(/File\s+"([^"]+\.py)"/gi)];
  if (fileMatches.length > 0) {
    return fileMatches[fileMatches.length - 1][1];
  }
  return null;
};

// Python 파일에서 로컬 import 추출
const extractLocalImports = (content: string): string[] => {
  const imports: string[] = [];

  // from xxx import yyy (로컬 모듈)
  const fromImports = content.matchAll(/^from\s+(\w+)\s+import/gm);
  for (const match of fromImports) {
    const moduleName = match[1];
    // 표준 라이브러리가 아닌 것만 (간단한 휴리스틱)
    if (!isStdLibModule(moduleName)) {
      imports.push(moduleName);
    }
  }

  // import xxx (로컬 모듈)
  const directImports = content.matchAll(/^import\s+(\w+)/gm);
  for (const match of directImports) {
    const moduleName = match[1];
    if (!isStdLibModule(moduleName)) {
      imports.push(moduleName);
    }
  }

  return [...new Set(imports)];
};

// 표준 라이브러리 모듈 체크 (간단한 목록)
const isStdLibModule = (name: string): boolean => {
  const stdLibModules = [
    'os', 'sys', 'json', 're', 'math', 'datetime', 'time', 'random',
    'collections', 'itertools', 'functools', 'typing', 'pathlib',
    'subprocess', 'threading', 'multiprocessing', 'asyncio', 'socket',
    'http', 'urllib', 'email', 'html', 'xml', 'logging', 'unittest',
    'io', 'pickle', 'copy', 'pprint', 'traceback', 'warnings',
    'contextlib', 'abc', 'dataclasses', 'enum', 'types',
    // 외부 라이브러리 (일반적으로 설치됨)
    'numpy', 'pandas', 'matplotlib', 'seaborn', 'sklearn', 'scipy',
    'torch', 'tensorflow', 'keras', 'requests', 'flask', 'django',
  ];
  return stdLibModules.includes(name.toLowerCase());
};

/**
 * Chat Panel Component - Cursor AI Style Unified Interface
 */
// 입력 모드 타입
type InputMode = 'chat' | 'agent';

const ChatPanel = forwardRef<ChatPanelHandle, AgentPanelProps>(({ apiService, notebookTracker, consoleTracker }, ref) => {
  // 통합 메시지 목록 (Chat + Agent 실행)
  const [messages, setMessages] = useState<UnifiedMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);
  const [llmConfig, setLlmConfig] = useState<LLMConfig | null>(null);
  // Agent 실행 상태
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [currentAgentMessageId, setCurrentAgentMessageId] = useState<string | null>(null);
  const [executionSpeed, setExecutionSpeed] = useState<ExecutionSpeed>('normal');
  // 입력 모드 (Cursor AI 스타일) - 로컬 스토리지에서 복원
  const [inputMode, setInputMode] = useState<InputMode>(() => {
    try {
      const saved = localStorage.getItem('hdsp-agent-input-mode');
      return (saved === 'agent' || saved === 'chat') ? saved : 'chat';
    } catch {
      return 'chat';
    }
  });
  const [showModeDropdown, setShowModeDropdown] = useState(false);
  // 파일 수정 관련 상태
  const [pendingFileFixes, setPendingFileFixes] = useState<IFixedFile[]>([]);
  // Console 에러 자동 감지 상태
  const [lastConsoleError, setLastConsoleError] = useState<string | null>(null);
  const [showConsoleErrorNotification, setShowConsoleErrorNotification] = useState(false);

  // File selection state
  const [fileSelectionMetadata, setFileSelectionMetadata] = useState<any>(null);
  const [pendingAgentRequest, setPendingAgentRequest] = useState<string | null>(null);

  // Human-in-the-Loop state
  const [debugStatus, setDebugStatus] = useState<string | null>(null);
  const [interruptData, setInterruptData] = useState<{
    threadId: string;
    action: string;
    args: any;
    description: string;
  } | null>(null);

  // Todo list state (from TodoListMiddleware)
  const [todos, setTodos] = useState<Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }>>([]);
  const [isTodoExpanded, setIsTodoExpanded] = useState(false);

  // Agent thread ID for context persistence across cycles (SummarizationMiddleware support)
  const [agentThreadId, setAgentThreadId] = useState<string | null>(null);

  // Rejection feedback mode - when user clicks reject, wait for optional feedback
  const [isRejectionMode, setIsRejectionMode] = useState(false);
  const [pendingRejectionInterrupt, setPendingRejectionInterrupt] = useState<{
    threadId: string;
    action: string;
    args: any;
    description: string;
  } | null>(null);
  const interruptMessageIdRef = useRef<string | null>(null);
  const approvalPendingRef = useRef<boolean>(false);
  const pendingToolCallsRef = useRef<Array<{ tool: string; code?: string; content?: string; cellIndex?: number }>>([]);
  const handledToolCallKeysRef = useRef<Set<string>>(new Set());

  const isNotebookWidget = (widget: any): widget is NotebookPanel => {
    if (!widget) return false;
    if (widget instanceof NotebookPanel) return true;
    const model = widget?.content?.model;
    return Boolean(model && (model.cells || model.sharedModel?.cells));
  };

  const getActiveNotebookPanel = (): NotebookPanel | null => {
    const app = (window as any).jupyterapp;
    const currentWidget = app?.shell?.currentWidget;
    if (isNotebookWidget(currentWidget)) {
      return currentWidget;
    }
    if (notebookTracker?.currentWidget && isNotebookWidget(notebookTracker.currentWidget)) {
      return notebookTracker.currentWidget;
    }
    return null;
  };

  const insertCell = (notebook: NotebookPanel, cellType: 'code' | 'markdown', source: string): number | null => {
    const model = notebook.content?.model;
    const cellCount = model?.cells?.length ?? model?.sharedModel?.cells?.length;
    if (!model?.sharedModel || cellCount === undefined) {
      console.warn('[AgentPanel] Notebook model not ready for insert');
      return null;
    }
    const insertIndex = cellCount;
    model.sharedModel.insertCell(insertIndex, {
      cell_type: cellType,
      source
    });
    notebook.content.activeCellIndex = insertIndex;
    return insertIndex;
  };

  const deleteCell = (notebook: NotebookPanel, cellIndex: number): boolean => {
    const model = notebook.content?.model;
    const cellCount = model?.cells?.length ?? model?.sharedModel?.cells?.length;
    if (!model?.sharedModel || cellCount === undefined) {
      console.warn('[AgentPanel] Notebook model not ready for delete');
      return false;
    }
    if (cellIndex < 0 || cellIndex >= cellCount) {
      console.warn('[AgentPanel] Invalid cell index for delete:', cellIndex);
      return false;
    }
    model.sharedModel.deleteCell(cellIndex);
    console.log('[AgentPanel] Deleted rejected cell at index:', cellIndex);
    return true;
  };

  const executeCell = async (notebook: NotebookPanel, cellIndex: number): Promise<void> => {
    try {
      await notebook.sessionContext.ready;
      notebook.content.activeCellIndex = cellIndex;
      await NotebookActions.run(notebook.content, notebook.sessionContext);
    } catch (error) {
      console.error('[AgentPanel] Cell execution failed:', error);
    }
  };

  const captureExecutionResult = (notebook: NotebookPanel, cellIndex: number) => {
    const cell = notebook.content.widgets[cellIndex];
    const model = (cell as any)?.model;
    const outputs = model?.outputs;
    const rawState = model?.executionState;
    const executionState =
      typeof rawState === 'string'
        ? rawState
        : rawState?.get?.() ?? rawState?.value ?? null;
    const result = {
      success: true,
      output: '',
      error: undefined as string | undefined,
      error_type: undefined as string | undefined,
      traceback: undefined as string[] | undefined,
      execution_count: model?.executionCount ?? null,
      execution_state: executionState,
      kernel_status: notebook.sessionContext?.session?.kernel?.status ?? null,
      cell_type: model?.type ?? null,
      outputs: [] as any[],
    };

    if (!outputs || outputs.length === 0) {
      return result;
    }

    const stripImageData = (data: Record<string, any>) => {
      const filtered: Record<string, any> = {};
      Object.keys(data || {}).forEach((key) => {
        if (!key.toLowerCase().startsWith('image/')) {
          filtered[key] = data[key];
        }
      });
      return filtered;
    };

    const errorSignatures = [
      'command not found',
      'ModuleNotFoundError',
      'No module named',
      'Traceback (most recent call last)',
      'Error:',
    ];

    for (let i = 0; i < outputs.length; i++) {
      const output = outputs.get(i);
      const json = (output as any).toJSON?.() || output;
      let sanitizedOutput = json;

      if (output.type === 'error') {
        result.outputs.push(sanitizedOutput);
        result.success = false;
        result.error_type = json.ename;
        result.error = json.evalue;
        if (Array.isArray(json.traceback)) {
          result.traceback = json.traceback;
        }
      } else if (output.type === 'stream' && json.text) {
        result.outputs.push(sanitizedOutput);
        result.output += json.text;
        const lowerText = json.text.toLowerCase();
        if (errorSignatures.some(signature => lowerText.includes(signature.toLowerCase()))) {
          result.success = false;
          result.error_type = 'runtime_error';
          result.error = json.text.trim();
        }
      } else if ((output.type === 'execute_result' || output.type === 'display_data') && json.data) {
        const filteredData = stripImageData(json.data);
        if (Object.keys(filteredData).length > 0) {
          sanitizedOutput = { ...json, data: filteredData };
          result.outputs.push(sanitizedOutput);
          result.output += JSON.stringify(filteredData);
        }
      }
    }

    return result;
  };

  const executePendingApproval = async (): Promise<{ tool: string; code?: string; content?: string; execution_result?: any } | null> => {
    const notebook = getActiveNotebookPanel();
    if (!notebook) {
      console.warn('[AgentPanel] No active notebook to execute cell');
      return null;
    }

    const pending = pendingToolCallsRef.current;
    if (pending.length === 0) {
      approvalPendingRef.current = false;
      return null;
    }

    const next = pending.shift();
    if (!next) {
      approvalPendingRef.current = false;
      return null;
    }

    if (next.tool === 'jupyter_cell' && next.code && typeof next.cellIndex === 'number') {
      await executeCell(notebook, next.cellIndex);
      const execResult = captureExecutionResult(notebook, next.cellIndex);
      (execResult as any).code = next.code;
      (next as any).execution_result = execResult;
      console.log('[AgentPanel] Executed approved code cell from tool call');
      approvalPendingRef.current = pendingToolCallsRef.current.length > 0;
      return next as any;
    }

    approvalPendingRef.current = pendingToolCallsRef.current.length > 0;
    return next as any;
  };

  const getAutoApproveEnabled = (config?: LLMConfig | null): boolean => (
    Boolean(config?.autoApprove)
  );

  const queueApprovalCell = (code: string): void => {
    const notebook = getActiveNotebookPanel();
    if (!notebook) {
      console.warn('[AgentPanel] No active notebook to add approval cell');
      return;
    }
    const key = `jupyter_cell:${code}`;
    if (handledToolCallKeysRef.current.has(key)) {
      return;
    }
    const index = insertCell(notebook, 'code', code);
    if (index === null) {
      return;
    }
    handledToolCallKeysRef.current.add(key);
    approvalPendingRef.current = true;
    pendingToolCallsRef.current.push({ tool: 'jupyter_cell', code, cellIndex: index });
    console.log('[AgentPanel] Added code cell pending approval via interrupt');
  };

  const handleToolCall = (toolCall: { tool: string; code?: string; content?: string }) => {
    const key = `${toolCall.tool}:${toolCall.code || toolCall.content || ''}`;
    if (handledToolCallKeysRef.current.has(key)) {
      return;
    }

    if (toolCall.tool === 'jupyter_cell') {
      return;
    }

    if (toolCall.tool === 'markdown' && toolCall.content) {
      const notebook = getActiveNotebookPanel();
      if (!notebook) {
        console.warn('[AgentPanel] No active notebook to add markdown');
        return;
      }
      const index = insertCell(notebook, 'markdown', toolCall.content);
      if (index !== null) {
        handledToolCallKeysRef.current.add(key);
        console.log('[AgentPanel] Added markdown cell from tool call');
      }
    }
  };

  // 모드 변경 시 로컬 스토리지에 저장
  useEffect(() => {
    try {
      localStorage.setItem('hdsp-agent-input-mode', inputMode);
    } catch {
      // 로컬 스토리지 접근 불가 시 무시
    }
  }, [inputMode]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pendingLlmPromptRef = useRef<string | null>(null);
  const allCodeBlocksRef = useRef<Array<{ id: string; code: string; language: string }>>([]);
  const currentCellIdRef = useRef<string | null>(null);
  const currentCellIndexRef = useRef<number | null>(null);
  const orchestratorRef = useRef<AgentOrchestrator | null>(null);

  const makeMessageId = (suffix?: string) => {
    const base = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return suffix ? `${base}-${suffix}` : base;
  };

  // Expose handleSendMessage via ref
  useImperativeHandle(ref, () => ({
    handleSendMessage: async () => {
      await handleSendMessage();
    },
    setInput: (value: string) => {
      setInput(value);
    },
    setLlmPrompt: (prompt: string) => {
      pendingLlmPromptRef.current = prompt;
      // Find textarea and set data attribute
      const textarea = messagesEndRef.current?.parentElement?.querySelector('.jp-agent-input') as HTMLTextAreaElement;
      if (textarea) {
        textarea.setAttribute('data-llm-prompt', prompt);
      }
    },
    setCurrentCellId: (cellId: string) => {
      console.log('[AgentPanel] setCurrentCellId called with:', cellId);
      currentCellIdRef.current = cellId;
    },
    setCurrentCellIndex: (cellIndex: number) => {
      console.log('[AgentPanel] setCurrentCellIndex called with:', cellIndex);
      currentCellIndexRef.current = cellIndex;
    },
    setInputMode: (mode: 'chat' | 'agent') => {
      console.log('[AgentPanel] setInputMode called with:', mode);
      setInputMode(mode);
    }
  }));

  // Load config on mount
  useEffect(() => {
    loadConfig();
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // Console 출력 모니터링 - Python 에러 자동 감지
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!consoleTracker) {
      console.log('[AgentPanel] ConsoleTracker not available');
      return;
    }

    console.log('[AgentPanel] Setting up console output monitoring');

    // Console 출력에서 에러 감지하는 함수
    const checkConsoleForErrors = () => {
      const currentConsole = consoleTracker.currentWidget;
      if (!currentConsole) {
        return;
      }

      try {
        // Console의 출력 영역에서 텍스트 추출
        const consoleNode = currentConsole.node;
        if (!consoleNode) return;

        // JupyterLab Console의 출력은 .jp-OutputArea-output 클래스에 있음
        const outputAreas = consoleNode.querySelectorAll('.jp-OutputArea-output');
        if (outputAreas.length === 0) return;

        // 최근 출력만 확인 (마지막 몇 개)
        const recentOutputs = Array.from(outputAreas).slice(-5);
        let combinedOutput = '';

        recentOutputs.forEach((output: Element) => {
          const text = output.textContent || '';
          combinedOutput += text + '\n';
        });

        // Python 에러 감지
        if (detectPythonError(combinedOutput)) {
          console.log('[AgentPanel] Python error detected in console output');

          // 중복 알림 방지
          if (lastConsoleError !== combinedOutput) {
            setLastConsoleError(combinedOutput);
            setShowConsoleErrorNotification(true);

            // 5초 후 자동으로 알림 숨기기
            setTimeout(() => {
              setShowConsoleErrorNotification(false);
            }, 10000);
          }
        }
      } catch (e) {
        console.error('[AgentPanel] Error checking console output:', e);
      }
    };

    // MutationObserver로 Console 출력 변경 감지
    let observer: MutationObserver | null = null;

    const setupObserver = () => {
      const currentConsole = consoleTracker.currentWidget;
      if (!currentConsole?.node) return;

      // 기존 observer 정리
      if (observer) {
        observer.disconnect();
      }

      observer = new MutationObserver((mutations) => {
        // 출력 영역에 변화가 있으면 에러 체크
        const hasOutputChange = mutations.some(mutation =>
          mutation.type === 'childList' ||
          (mutation.type === 'characterData')
        );
        if (hasOutputChange) {
          // 약간의 딜레이 후 체크 (출력이 완전히 렌더링될 때까지)
          setTimeout(checkConsoleForErrors, 100);
        }
      });

      // Console 전체를 관찰
      observer.observe(currentConsole.node, {
        childList: true,
        subtree: true,
        characterData: true
      });

      console.log('[AgentPanel] MutationObserver set up for console');
    };

    // 현재 Console에 observer 설정
    setupObserver();

    // Console 변경 시 observer 재설정
    const onConsoleChanged = () => {
      console.log('[AgentPanel] Console changed, re-setting up observer');
      setupObserver();
    };

    consoleTracker.currentChanged?.connect(onConsoleChanged);

    // Cleanup
    return () => {
      if (observer) {
        observer.disconnect();
      }
      consoleTracker.currentChanged?.disconnect(onConsoleChanged);
    };
  }, [consoleTracker, lastConsoleError]);

  // Remove lastActiveNotebook state - just use currentWidget directly

  // Agent 실행 핸들러
  const handleAgentExecution = useCallback(async (request: string) => {
    // CRITICAL: Prevent concurrent agent executions
    if (isAgentRunning) {
      const errorMessage: IChatMessage = {
        id: makeMessageId(),
        role: 'assistant',
        content: '⚠️ 이전 작업이 아직 실행 중입니다. 완료될 때까지 기다려주세요.',
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMessage]);
      return;
    }

    // IMPORTANT: Use app.shell.currentWidget for reliable active tab detection
    const app = (window as any).jupyterapp;
    let notebook = null;

    // Try to get notebook from shell.currentWidget (most reliable)
    if (app?.shell?.currentWidget) {
      const currentWidget = app.shell.currentWidget;
      if ('content' in currentWidget && currentWidget.content?.model) {
        notebook = currentWidget;
      }
    }

    // Fallback to notebookTracker
    if (!notebook) {
      notebook = notebookTracker?.currentWidget;
    }

    const sessionContext = notebook?.sessionContext;

    // 디버깅: 현재 선택된 노트북 경로 로그
    console.log('[AgentPanel] shell.currentWidget:', app?.shell?.currentWidget?.context?.path);
    console.log('[AgentPanel] tracker.currentWidget:', notebookTracker?.currentWidget?.context?.path);
    console.log('[AgentPanel] Using notebook:', notebook?.context?.path);
    console.log('[AgentPanel] Notebook title:', notebook?.title?.label);

    if (!notebook || !sessionContext) {
      // 노트북이 없으면 에러 메시지 표시
      const errorMessage: IChatMessage = {
        id: makeMessageId(),
        role: 'assistant',
        content: '노트북을 먼저 열어주세요. Agent 실행은 활성 노트북이 필요합니다.',
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMessage]);
      return;
    }

    // ★ 현재 활성화된 노트북으로 AgentOrchestrator 재생성 (탭 전환 대응)
    const config = { ...DEFAULT_AUTO_AGENT_CONFIG, executionSpeed };
    const orchestrator = new AgentOrchestrator(notebook, sessionContext, apiService, config);

    // Agent 실행 메시지 생성
    const agentMessageId = `agent-${Date.now()}`;
    const agentMessage: AgentExecutionMessage = {
      id: agentMessageId,
      type: 'agent_execution',
      request,
      status: { phase: 'planning', message: '실행 계획 생성 중...' },
      plan: null,
      result: null,
      completedSteps: [],
      failedSteps: [],
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, agentMessage]);
    setCurrentAgentMessageId(agentMessageId);
    setIsAgentRunning(true);

    try {
      // Get current llmConfig for the agent execution
      const currentLlmConfig = llmConfig || getLLMConfig() || getDefaultLLMConfig();

      const result = await orchestrator.executeTask(
        request,
        notebook,
        (newStatus: AgentStatus) => {
          // 실시간 상태 업데이트
          setMessages(prev =>
            prev.map(msg =>
              msg.id === agentMessageId && 'type' in msg && msg.type === 'agent_execution'
                ? {
                    ...msg,
                    status: newStatus,
                    plan: newStatus.plan || msg.plan,
                    completedSteps: newStatus.currentStep && newStatus.currentStep > 1
                      ? Array.from({ length: newStatus.currentStep - 1 }, (_, i) => i + 1)
                      : msg.completedSteps,
                    failedSteps: newStatus.phase === 'failed' && newStatus.currentStep
                      ? [...msg.failedSteps, newStatus.currentStep]
                      : msg.failedSteps,
                  }
                : msg
            )
          );
        },
        currentLlmConfig  // Pass llmConfig to orchestrator
      );

      // 최종 결과 업데이트
      setMessages(prev =>
        prev.map(msg =>
          msg.id === agentMessageId && 'type' in msg && msg.type === 'agent_execution'
            ? {
                ...msg,
                status: {
                  phase: result.success ? 'completed' : 'failed',
                  message: result.finalAnswer || (result.success ? '작업 완료' : '작업 실패'),
                },
                result,
                completedSteps: result.plan?.steps.map(s => s.stepNumber) || [],
              }
            : msg
        )
      );
    } catch (error: any) {
      console.log('[AgentPanel] Caught error:', error);
      console.log('[AgentPanel] Error name:', error.name);
      console.log('[AgentPanel] Error has fileSelectionMetadata:', !!error.fileSelectionMetadata);

      // Handle FILE_SELECTION_REQUIRED error
      if (error.name === 'FileSelectionError' && error.fileSelectionMetadata) {
        console.log('[AgentPanel] File selection required:', error.fileSelectionMetadata);

        // Show file selection dialog
        setFileSelectionMetadata(error.fileSelectionMetadata);
        setPendingAgentRequest(request);

        // Update message to show waiting state
        setMessages(prev =>
          prev.map(msg =>
            msg.id === agentMessageId && 'type' in msg && msg.type === 'agent_execution'
              ? {
                  ...msg,
                  status: {
                    phase: 'executing',
                    message: '파일 선택 대기 중...'
                  },
                }
              : msg
          )
        );
        // Keep isAgentRunning true to show we're paused, not failed
        return;
      }

      setMessages(prev =>
        prev.map(msg =>
          msg.id === agentMessageId && 'type' in msg && msg.type === 'agent_execution'
            ? {
                ...msg,
                status: { phase: 'failed', message: error.message || '실행 중 오류 발생' },
              }
            : msg
        )
      );
    } finally {
      setIsAgentRunning(false);
      setCurrentAgentMessageId(null);
    }
  }, [notebookTracker, apiService]);

  const loadConfig = () => {
    // Load from localStorage using ApiKeyManager
    const config = getLLMConfig();

    if (!config) {
      console.log('[AgentPanel] No config in localStorage, using default');
      const defaultConfig = getDefaultLLMConfig();
      setLlmConfig(defaultConfig);
      return;
    }

    setLlmConfig(config);

    // Log loaded model configuration
    console.log('=== HDSP Agent Model Configuration (localStorage) ===');
    console.log('Provider:', config.provider);

    if (config.provider === 'gemini') {
      console.log('Gemini Model:', config.gemini?.model || 'gemini-2.5-flash (default)');
      console.log('Gemini API Key:', config.gemini?.apiKey ? '✓ Configured' : '✗ Not configured');
    } else if (config.provider === 'vllm') {
      console.log('vLLM Model:', config.vllm?.model || 'default');
      console.log('vLLM Endpoint:', config.vllm?.endpoint || 'http://localhost:8000');
      console.log('vLLM API Key:', config.vllm?.apiKey ? '✓ Configured' : '✗ Not configured');
    } else if (config.provider === 'openai') {
      console.log('OpenAI Model:', config.openai?.model || 'gpt-4');
      console.log('OpenAI API Key:', config.openai?.apiKey ? '✓ Configured' : '✗ Not configured');
    }

    console.log('====================================================');
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Python 파일 에러 수정 관련 함수들
  // ═══════════════════════════════════════════════════════════════════════════

  // JupyterLab Contents API를 통해 파일 내용 로드
  const loadFileContent = async (filePath: string): Promise<string | null> => {
    try {
      // PageConfig에서 base URL 가져오기
      const { PageConfig, URLExt } = await import('@jupyterlab/coreutils');
      const baseUrl = PageConfig.getBaseUrl();
      const apiUrl = URLExt.join(baseUrl, 'api/contents', filePath);

      console.log('[AgentPanel] Loading file:', filePath, 'from:', apiUrl);

      const response = await fetch(apiUrl, {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        console.warn('[AgentPanel] Failed to load file:', filePath, response.status);
        return null;
      }

      const data = await response.json();
      return data.content as string;
    } catch (error) {
      console.error('[AgentPanel] Error loading file:', filePath, error);
      return null;
    }
  };

  // 파일에 수정된 코드 저장
  const saveFileContent = async (filePath: string, content: string): Promise<boolean> => {
    try {
      const { PageConfig, URLExt } = await import('@jupyterlab/coreutils');
      const baseUrl = PageConfig.getBaseUrl();
      const apiUrl = URLExt.join(baseUrl, 'api/contents', filePath);

      console.log('[AgentPanel] Saving file:', filePath);

      const response = await fetch(apiUrl, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'file',
          format: 'text',
          content: content,
        }),
      });

      if (!response.ok) {
        console.error('[AgentPanel] Failed to save file:', filePath, response.status);
        return false;
      }

      console.log('[AgentPanel] File saved successfully:', filePath);
      return true;
    } catch (error) {
      console.error('[AgentPanel] Error saving file:', filePath, error);
      return false;
    }
  };

  // Python 에러 메시지 처리 및 파일 수정 요청
  // Returns true if handled, false if should fall back to regular chat
  const handlePythonErrorFix = async (errorMessage: string): Promise<boolean> => {
    console.log('[AgentPanel] Handling Python error fix request');

    // 1. 에러가 발생한 파일 경로 추출
    const errorFilePath = extractErrorFilePath(errorMessage);
    const mainFilePath = extractMainFilePath(errorMessage);
    const allFilePaths = extractFilePathsFromError(errorMessage);

    console.log('[AgentPanel] Error file:', errorFilePath);
    console.log('[AgentPanel] Main file:', mainFilePath);
    console.log('[AgentPanel] All files:', allFilePaths);

    if (!errorFilePath && !mainFilePath) {
      // 파일 경로를 찾을 수 없으면 일반 채팅으로 처리
      console.log('[AgentPanel] No file path found, falling back to regular chat stream');
      return false;
    }

    // 2. 주요 파일 내용 로드
    const targetFile = errorFilePath || mainFilePath;
    const mainContent = await loadFileContent(targetFile!);

    if (!mainContent) {
      console.warn('[AgentPanel] Could not load file content for:', targetFile);
      // 파일을 읽을 수 없으면 에러 메시지만으로 처리 시도
      const errorOnlyRequest: IFileFixRequest = {
        action: 'fix',
        mainFile: { path: targetFile!, content: '(파일 읽기 실패)' },
        errorOutput: errorMessage,
      };

      try {
        const result = await apiService.fileAction(errorOnlyRequest);
        handleFileFixResponse(result.response, result.fixedFiles);
      } catch (error) {
        console.error('[AgentPanel] File fix API error:', error);
        addErrorMessage('파일 수정 요청 실패: ' + (error as Error).message);
      }
      return true;  // Handled (even if failed)
    }

    // 3. 관련 파일들 (imports) 로드
    const localImports = extractLocalImports(mainContent);
    const relatedFiles: { path: string; content: string }[] = [];

    // 에러 메시지에 언급된 다른 파일들도 로드
    for (const path of allFilePaths) {
      if (path !== targetFile) {
        const content = await loadFileContent(path);
        if (content) {
          relatedFiles.push({ path, content });
        }
      }
    }

    // 로컬 import 파일들도 로드
    const baseDir = targetFile!.includes('/') ? targetFile!.substring(0, targetFile!.lastIndexOf('/')) : '';
    for (const moduleName of localImports) {
      const modulePath = baseDir ? `${baseDir}/${moduleName}.py` : `${moduleName}.py`;
      if (!allFilePaths.includes(modulePath) && !relatedFiles.some(f => f.path === modulePath)) {
        const content = await loadFileContent(modulePath);
        if (content) {
          relatedFiles.push({ path: modulePath, content });
        }
      }
    }

    console.log('[AgentPanel] Related files loaded:', relatedFiles.length);

    // 4. 파일 수정 API 호출
    const request: IFileFixRequest = {
      action: 'fix',
      mainFile: { path: targetFile!, content: mainContent },
      errorOutput: errorMessage,
      relatedFiles: relatedFiles.length > 0 ? relatedFiles : undefined,
    };

    try {
      setIsLoading(true);
      const result = await apiService.fileAction(request);
      handleFileFixResponse(result.response, result.fixedFiles);
      return true;  // Successfully handled
    } catch (error) {
      console.error('[AgentPanel] File fix API error:', error);
      addErrorMessage('파일 수정 요청 실패: ' + (error as Error).message);
      return true;  // Handled (even if failed)
    } finally {
      setIsLoading(false);
    }
  };

  // 파일 수정 응답 처리
  const handleFileFixResponse = (response: string, fixedFiles: IFixedFile[]) => {
    console.log('[AgentPanel] File fix response received, fixed files:', fixedFiles.length);

    // Assistant 메시지로 응답 표시
    const assistantMessage: IChatMessage = {
      id: makeMessageId('file-fix'),
      role: 'assistant',
      content: response,
      timestamp: Date.now(),
      metadata: { type: 'file_fix', fixedFiles },
    };
    setMessages(prev => [...prev, assistantMessage]);

    // 수정된 파일이 있으면 상태에 저장 (적용 버튼용)
    if (fixedFiles.length > 0) {
      setPendingFileFixes(fixedFiles);
    }
  };

  // 수정된 파일 적용
  const applyFileFix = async (fix: IFixedFile) => {
    console.log('[AgentPanel] Applying fix to file:', fix.path);

    const success = await saveFileContent(fix.path, fix.content);
    if (success) {
      // 성공 메시지
      const successMessage: IChatMessage = {
        id: makeMessageId('apply-success'),
        role: 'assistant',
        content: `✅ **${fix.path}** 파일이 수정되었습니다.\n\n파일 에디터에서 변경사항을 확인하세요.`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, successMessage]);

      // 적용된 파일은 pending에서 제거
      setPendingFileFixes(prev => prev.filter(f => f.path !== fix.path));
    } else {
      addErrorMessage(`파일 저장 실패: ${fix.path}`);
    }
  };

  // 에러 메시지 추가 헬퍼
  const addErrorMessage = (message: string) => {
    const errorMessage: IChatMessage = {
      id: makeMessageId('error'),
      role: 'assistant',
      content: `⚠️ ${message}`,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, errorMessage]);
  };

  const handleSaveConfig = (config: LLMConfig) => {
    console.log('[AgentPanel] Saving config to localStorage');
    console.log('Provider:', config.provider);
    console.log('API Key configured:', hasValidApiKey(config) ? '✓ Yes' : '✗ No');

    // Save to localStorage using ApiKeyManager
    saveLLMConfig(config);

    // Update state
    setLlmConfig(config);

    console.log('[AgentPanel] Config saved successfully');
  };

  // File selection handlers
  const handleFileSelect = async (index: number) => {
    console.log('[AgentPanel] File selected:', index);

    if (!fileSelectionMetadata || !pendingAgentRequest) {
      console.error('[AgentPanel] Missing file selection metadata or pending request');
      return;
    }

    // Get selected file info (index is 1-based from the UI button click)
    const selectedFile = fileSelectionMetadata.options[index - 1];
    if (!selectedFile) {
      console.error('[AgentPanel] Invalid file selection index:', index);
      return;
    }

    console.log('[AgentPanel] Selected file:', selectedFile.path);

    // Close dialog
    setFileSelectionMetadata(null);
    const originalRequest = pendingAgentRequest;
    setPendingAgentRequest(null);

    // Update the agent message to show file was selected
    setMessages(prev =>
      prev.map(msg => {
        if ('type' in msg && msg.type === 'agent_execution' && msg.status.phase === 'executing') {
          return {
            ...msg,
            status: {
              phase: 'executing',
              message: `파일 선택됨: ${selectedFile.relative}\n실행 재개 중...`
            },
          };
        }
        return msg;
      })
    );

    // Re-execute the agent with the selected file path explicitly mentioned
    // Modify the request to include the selected file path
    const modifiedRequest = `${originalRequest} (파일 경로: ${selectedFile.path})`;

    console.log('[AgentPanel] Re-executing agent with modified request:', modifiedRequest);

    // Resume execution by calling handleAgentExecution with the modified request
    // Note: This will create a new agent message, but the existing one should be marked as cancelled
    setMessages(prev =>
      prev.map(msg => {
        if ('type' in msg && msg.type === 'agent_execution' && msg.status.phase === 'executing') {
          return {
            ...msg,
            status: {
              phase: 'completed',
              message: `파일 선택됨: ${selectedFile.relative}\n새 실행으로 재개됩니다...`
            },
          };
        }
        return msg;
      })
    );

    // Reset agent running state to allow new execution
    setIsAgentRunning(false);
    setCurrentAgentMessageId(null);

    // Start new agent execution with explicit file path
    await handleAgentExecution(modifiedRequest);
  };

  const handleFileSelectCancel = () => {
    console.log('[AgentPanel] File selection cancelled');

    // Update the agent message to show cancellation
    setMessages(prev =>
      prev.map(msg => {
        if ('type' in msg && msg.type === 'agent_execution' && msg.status.phase === 'executing') {
          return {
            ...msg,
            status: {
              phase: 'failed',
              message: '사용자가 파일 선택을 취소했습니다.'
            },
          };
        }
        return msg;
      })
    );

    setFileSelectionMetadata(null);
    setPendingAgentRequest(null);
    setIsAgentRunning(false);
    setCurrentAgentMessageId(null);
  };

  // Auto-scroll to bottom when messages change or streaming
  useEffect(() => {
    if (isStreaming) {
      // 스트리밍 중에는 즉시 스크롤
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    } else {
      // 일반 메시지 추가 시 부드러운 스크롤
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isStreaming]);

  const handleNextItemSelection = async (nextText: string) => {
    const trimmed = nextText.trim();
    if (!trimmed) return;

    // Check if there's a pending interrupt (HITL approval waiting)
    const hasPendingInterrupt = interruptData !== null;
    
    // Check if all todos are completed
    const allTodosCompleted = todos.length === 0 || todos.every(t => t.status === 'completed');
    
    // Block if there's a pending interrupt OR if agent is running with incomplete todos
    // Allow if all todos are completed even if streaming is finishing up
    if (hasPendingInterrupt || (isAgentRunning && !allTodosCompleted)) {
      showNotification('다른 작업이 진행 중입니다. 완료 후 다시 시도해주세요.', 'warning');
      return;
    }

    await sendChatMessage({
      displayContent: trimmed,
      clearInput: true
    });
  };

  const sendChatMessage = async ({
    displayContent,
    llmPrompt,
    textarea,
    clearInput = true
  }: {
    displayContent: string;
    llmPrompt?: string | null;
    textarea?: HTMLTextAreaElement | null;
    clearInput?: boolean;
  }) => {
    const displayContentText = displayContent || (llmPrompt ? '셀 분석 요청' : '');
    if (!displayContentText && !llmPrompt) return;

    // Check if API key is configured before sending
    let currentConfig = llmConfig;
    if (!currentConfig) {
      // Config not loaded yet, try to load from localStorage
      currentConfig = getLLMConfig() || getDefaultLLMConfig();
      setLlmConfig(currentConfig);
    }

    // Check API key using ApiKeyManager
    const hasApiKey = hasValidApiKey(currentConfig);
    const autoApproveEnabled = getAutoApproveEnabled(currentConfig);

    if (!hasApiKey) {
      // Show error message and open settings
      const providerName = currentConfig?.provider || 'LLM';
      const errorMessage: IChatMessage = {
        id: makeMessageId(),
        role: 'assistant',
        content: `API Key가 설정되지 않았습니다.\n\n${providerName === 'gemini' ? 'Gemini' : providerName === 'openai' ? 'OpenAI' : 'vLLM'} API Key를 먼저 설정해주세요.\n\n설정 버튼을 클릭하여 API Key를 입력하세요.`,
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, errorMessage]);
      setShowSettings(true);
      return;
    }

    const userMessage: IChatMessage = {
      id: makeMessageId(),
      role: 'user',
      content: displayContentText,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMessage]);
    if (clearInput && displayContentText) {
      setInput('');
    }
    setIsLoading(true);
    setIsStreaming(true);
    // Clear todos only when starting a new task (all completed or no todos)
    // Keep todos if there are pending/in_progress items (continuation of current task)
    const hasActiveTodos = todos.some(t => t.status === 'pending' || t.status === 'in_progress');
    if (!hasActiveTodos) {
      setTodos([]);
    }
    setDebugStatus(null);

    // Clear the data attribute and ref after using it
    if (textarea && llmPrompt) {
      textarea.removeAttribute('data-llm-prompt');
      pendingLlmPromptRef.current = null;
    }

    // Create assistant message ID for streaming updates
    const assistantMessageId = makeMessageId('assistant');
    let streamedContent = '';
    setStreamingMessageId(assistantMessageId);

    // Add empty assistant message that will be updated during streaming
    const initialAssistantMessage: IChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now()
    };
    setMessages(prev => [...prev, initialAssistantMessage]);

    try {
      // Use LLM prompt if available, otherwise use the display content
      const messageToSend = llmPrompt || displayContentText;

      console.log('[AgentPanel] Sending message with agentThreadId:', agentThreadId);

      await apiService.sendMessageStream(
        {
          message: messageToSend,
          conversationId: conversationId || undefined,
          llmConfig: currentConfig  // Include API keys with request
        },
        // onChunk callback - update message content incrementally
        (chunk: string) => {
          streamedContent += chunk;
          setMessages(prev =>
            prev.map(msg =>
              msg.id === assistantMessageId && isChatMessage(msg)
                ? { ...msg, content: streamedContent }
                : msg
            )
          );
        },
        // onMetadata callback - update conversationId and metadata
        (metadata) => {
          if (metadata.conversationId && !conversationId) {
            setConversationId(metadata.conversationId);
          }
          if (metadata.provider || metadata.model) {
            setMessages(prev =>
              prev.map(msg =>
                msg.id === assistantMessageId && isChatMessage(msg)
                  ? {
                      ...msg,
                      metadata: {
                        ...msg.metadata,
                        provider: metadata.provider,
                        model: metadata.model
                      }
                    }
                  : msg
              )
            );
          }
        },
        // onDebug callback - show debug status in gray
        (status: string) => {
          setDebugStatus(status);
        },
        // onInterrupt callback - show approval dialog
        (interrupt) => {
          approvalPendingRef.current = true;

          // Capture threadId from interrupt for context persistence
          if (interrupt.threadId && !agentThreadId) {
            setAgentThreadId(interrupt.threadId);
            console.log('[AgentPanel] Captured agentThreadId from interrupt:', interrupt.threadId);
          }

          // Auto-approve search/file/resource tools - execute immediately without user interaction
          if (
            interrupt.action === 'search_workspace_tool'
            || interrupt.action === 'search_notebook_cells_tool'
            || interrupt.action === 'check_resource_tool'
            || interrupt.action === 'list_files_tool'
            || interrupt.action === 'read_file_tool'
          ) {
            void handleAutoToolInterrupt(interrupt);
            return;
          }

          if (autoApproveEnabled) {
            void resumeFromInterrupt(interrupt, 'approve');
            return;
          }
          if (interrupt.action === 'jupyter_cell_tool' && interrupt.args?.code) {
            const shouldQueue = shouldExecuteInNotebook(interrupt.args.code);
            if (isAutoApprovedCode(interrupt.args.code)) {
              if (shouldQueue) {
                queueApprovalCell(interrupt.args.code);
              }
              void resumeFromInterrupt(interrupt, 'approve');
              return;
            }
            if (shouldQueue) {
              queueApprovalCell(interrupt.args.code);
            }
          }
          setInterruptData(interrupt);
          upsertInterruptMessage(interrupt);
          setIsLoading(false);
          setIsStreaming(false);
        },
        // onTodos callback - update todo list UI
        (newTodos) => {
          setTodos(newTodos);
        },
        // onDebugClear callback - clear debug status
        () => {
          setDebugStatus(null);
        },
        // onToolCall callback - add cells to notebook
        handleToolCall,
        // onComplete callback - capture thread_id for context persistence
        (data) => {
          if (data.threadId) {
            setAgentThreadId(data.threadId);
            console.log('[AgentPanel] Captured agentThreadId for context persistence:', data.threadId);
          }
        },
        // threadId - pass existing thread_id to continue context
        agentThreadId || undefined
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send message';
      setDebugStatus(`오류: ${message}`);
      // Update the assistant message with error
      setMessages(prev =>
        prev.map(msg =>
          msg.id === assistantMessageId && isChatMessage(msg)
            ? {
                ...msg,
                content: streamedContent + `\n\nError: ${message}`
              }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
      setStreamingMessageId(null);
      // Keep completed todos visible after the run
    }
  };

  // Extract and store code blocks from messages, setup button listeners
  useEffect(() => {
    // Use a small delay to ensure DOM is updated after message rendering
    const timeoutId = setTimeout(() => {
      // Find messages container - try multiple selectors
      const messagesContainer = 
        document.querySelector('.jp-agent-messages') ||
        messagesEndRef.current?.parentElement ||
        document.querySelector('[class*="jp-agent-messages"]');
      
      if (!messagesContainer) {
        console.log('[AgentPanel] Messages container not found');
        return;
      }

      // Extract code blocks from all assistant messages
      const codeBlocks: Array<{ id: string; code: string; language: string }> = [];
      const containers = messagesContainer.querySelectorAll('.code-block-container');
      
      console.log(`[AgentPanel] Found ${containers.length} code block containers`);
      
      containers.forEach(container => {
        const blockId = container.getAttribute('data-block-id');
        if (!blockId) {
          console.warn('[AgentPanel] Code block container missing data-block-id');
          return;
        }

        const codeElement = container.querySelector(`#${blockId}`) as HTMLElement;
        if (!codeElement) {
          console.warn(`[AgentPanel] Code element #${blockId} not found`);
          return;
        }

        const codeText = codeElement.textContent || '';
        const langElement = container.querySelector('.code-block-language');
        const language = langElement?.textContent?.toLowerCase() || 'python';

        codeBlocks.push({
          id: blockId,
          code: codeText,
          language: language
        });
      });

      // Update code blocks ref
      allCodeBlocksRef.current = codeBlocks;
      console.log(`[AgentPanel] Stored ${codeBlocks.length} code blocks`, codeBlocks.map(b => b.id));

      // Use event delegation - attach single listener to container
      const handleContainerClick = async (e: Event) => {
        const target = e.target as HTMLElement;

        const nextItem = target.closest('.jp-next-items-item') as HTMLElement | null;
        if (nextItem) {
          e.stopPropagation();
          e.preventDefault();

          const subject = nextItem.querySelector('.jp-next-items-subject')?.textContent?.trim() || '';
          const description = nextItem.querySelector('.jp-next-items-description')?.textContent?.trim() || '';
          const nextText = subject && description
            ? `${subject}\n\n${description}`
            : (subject || description);

          if (nextText) {
            void handleNextItemSelection(nextText);
          }
          return;
        }
        
        // Handle expand/collapse button
        if (target.classList.contains('code-block-toggle') || target.closest('.code-block-toggle')) {
          const button = target.classList.contains('code-block-toggle')
            ? target as HTMLButtonElement
            : target.closest('.code-block-toggle') as HTMLButtonElement;

          e.stopPropagation();
          e.preventDefault();

          const container = button.closest('.code-block-container') as HTMLElement | null;
          if (!container) return;

          const isExpanded = container.classList.toggle('is-expanded');
          button.setAttribute('aria-expanded', String(isExpanded));
          button.setAttribute('title', isExpanded ? '접기' : '전체 보기');
          button.setAttribute('aria-label', isExpanded ? '접기' : '전체 보기');

          const icon = button.querySelector('.code-block-toggle-icon');
          if (icon) {
            icon.textContent = isExpanded ? '▴' : '▾';
          }
          return;
        }

        // Handle copy button
        if (target.classList.contains('code-block-copy') || target.closest('.code-block-copy')) {
          const button = target.classList.contains('code-block-copy') 
            ? target as HTMLButtonElement 
            : target.closest('.code-block-copy') as HTMLButtonElement;
          
          e.stopPropagation();
          e.preventDefault();
          
          const blockId = button.getAttribute('data-block-id');
          if (!blockId) return;

          const block = allCodeBlocksRef.current.find(b => b.id === blockId);
          if (!block) return;

          try {
            await navigator.clipboard.writeText(block.code);
            const originalText = button.textContent;
            button.textContent = '복사됨!';
            setTimeout(() => {
              button.textContent = originalText || '복사';
            }, 2000);
          } catch (error) {
            console.error('Failed to copy code:', error);
            showNotification('복사에 실패했습니다.', 'error');
          }
          return;
        }
        
        // Handle apply button
        if (target.classList.contains('code-block-apply') || target.closest('.code-block-apply')) {
          const button = target.classList.contains('code-block-apply') 
            ? target as HTMLButtonElement 
            : target.closest('.code-block-apply') as HTMLButtonElement;
          
          e.stopPropagation();
          e.preventDefault();
          
          const blockId = button.getAttribute('data-block-id');
          console.log(`[AgentPanel] Apply button clicked via delegation, blockId: ${blockId}`);
          
          if (!blockId) {
            showNotification('코드 블록 ID를 찾을 수 없습니다.', 'error');
            return;
          }

          const block = allCodeBlocksRef.current.find(b => b.id === blockId);
          if (!block) {
            console.error('[AgentPanel] Block not found!', {
              clickedId: blockId,
              availableIds: allCodeBlocksRef.current.map(b => b.id),
              blocksCount: allCodeBlocksRef.current.length
            });
            showNotification('코드를 찾을 수 없습니다.', 'error');
            return;
          }

          console.log(`[AgentPanel] Applying code to cell via delegation, code length: ${block.code.length}`);
          await applyCodeToCell(block.code, blockId, button);
          return;
        }
      };

      // Attach single event listener to container
      messagesContainer.addEventListener('click', handleContainerClick);
      
      // Cleanup - store handler reference for cleanup
      (messagesContainer as any)._agentPanelClickHandler = handleContainerClick;

    }, 100); // Small delay to ensure DOM is ready

    // Cleanup
    return () => {
      clearTimeout(timeoutId);
      // Remove event listener on cleanup
      const messagesContainer = 
        document.querySelector('.jp-agent-messages') ||
        messagesEndRef.current?.parentElement ||
        document.querySelector('[class*="jp-agent-messages"]');
      
      if (messagesContainer && (messagesContainer as any)._agentPanelClickHandler) {
        messagesContainer.removeEventListener('click', (messagesContainer as any)._agentPanelClickHandler);
        delete (messagesContainer as any)._agentPanelClickHandler;
      }
    };
  }, [messages]);

  // Helper: Get notification background color
  const getNotificationColor = (type: 'info' | 'warning' | 'error'): string => {
    switch (type) {
      case 'error': return '#f56565';
      case 'warning': return '#ed8936';
      default: return '#4299e1';
    }
  };

  // Helper: Create and show notification element
  const createNotificationElement = (message: string, backgroundColor: string): HTMLDivElement => {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 16px;
      border-radius: 6px;
      color: white;
      font-size: 14px;
      font-weight: 500;
      z-index: 10001;
      opacity: 0;
      transition: opacity 0.3s ease;
      max-width: 300px;
      word-wrap: break-word;
      background: ${backgroundColor};
    `;
    notification.textContent = message;
    return notification;
  };

  // Helper: Animate notification in and out
  const animateNotification = (notification: HTMLDivElement) => {
    setTimeout(() => notification.style.opacity = '1', 10);
    setTimeout(() => {
      notification.style.opacity = '0';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 3000);
  };

  // Show notification
  const showNotification = (message: string, type: 'info' | 'warning' | 'error' = 'info') => {
    const notification = createNotificationElement(message, getNotificationColor(type));
    document.body.appendChild(notification);
    animateNotification(notification);
  };

  // Show tooltip on a specific cell
  const showCellTooltip = (cellElement: HTMLElement, message: string) => {
    // Remove any existing tooltip
    const existingTooltip = document.querySelector('.jp-agent-cell-tooltip');
    if (existingTooltip) {
      existingTooltip.remove();
    }

    const tooltip = document.createElement('div');
    tooltip.className = 'jp-agent-cell-tooltip';
    tooltip.textContent = message;
    tooltip.style.cssText = `
      position: absolute;
      top: 0;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 8px 16px;
      border-radius: 0 0 8px 8px;
      font-size: 13px;
      font-weight: 500;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
      z-index: 1000;
      opacity: 0;
      transition: opacity 0.3s ease;
      pointer-events: none;
      white-space: nowrap;
    `;

    // Make cell position relative if not already
    const originalPosition = cellElement.style.position;
    if (!originalPosition || originalPosition === 'static') {
      cellElement.style.position = 'relative';
    }

    cellElement.appendChild(tooltip);

    // Fade in
    requestAnimationFrame(() => {
      tooltip.style.opacity = '1';
    });

    // Fade out and remove after 2 seconds
    setTimeout(() => {
      tooltip.style.opacity = '0';
      setTimeout(() => {
        tooltip.remove();
        // Restore original position
        if (!originalPosition || originalPosition === 'static') {
          cellElement.style.position = originalPosition || '';
        }
      }, 300);
    }, 2000);
  };

  // Apply code to Jupyter cell
  const applyCodeToCell = async (code: string, blockId: string, button: HTMLButtonElement) => {
    console.log('[AgentPanel] applyCodeToCell called', { codeLength: code.length, blockId });
    
    const originalText = button.textContent;
    
    try {
      button.disabled = true;
      button.textContent = '적용 중...';

      const app = (window as any).jupyterapp;
      if (!app) {
        console.error('[AgentPanel] jupyterapp not found in window');
        showNotification('JupyterLab을 찾을 수 없습니다.', 'error');
        button.disabled = false;
        button.textContent = originalText || '셀에 적용';
        return;
      }
      
      console.log('[AgentPanel] Found jupyterapp');

      // Try to get notebook tracker from app
      // The notebookTracker is passed to cellButtonsPlugin, so we need to access it differently
      // Use shell to find current notebook widget
      const shell = app.shell;
      const currentWidget = shell.currentWidget;
      
      // Check if current widget is a notebook
      if (currentWidget && 'content' in currentWidget) {
        const notebook = (currentWidget as any).content;
        
        // Check if it's a notebook (has model and cells)
        if (notebook && 'model' in notebook && notebook.model && 'cells' in notebook.model) {
          await applyCodeToNotebookCell(code, notebook, blockId, button, originalText);
          return;
        }
      }

      // Fallback: show cell selector dialog
      showCellSelectorDialog(code, button, originalText);
    } catch (error) {
      console.error('Failed to apply code to cell:', error);
      showNotification('코드 적용에 실패했습니다.', 'error');
      button.disabled = false;
      button.textContent = originalText || '셀에 적용';
    }
  };

  // Helper: Try different methods to set cell source
  const setCellSource = (cellModel: any, code: string): void => {
    if (cellModel.sharedModel && typeof cellModel.sharedModel.setSource === 'function') {
      cellModel.sharedModel.setSource(code);
    } else if (cellModel.setSource && typeof cellModel.setSource === 'function') {
      cellModel.setSource(code);
    } else if (cellModel.value && typeof cellModel.value.setText === 'function') {
      cellModel.value.setText(code);
    } else if (cellModel.value && cellModel.value.text !== undefined) {
      cellModel.value.text = code;
    } else {
      throw new Error('Unable to set cell source - no compatible method found');
    }
  };

  // Helper: Reset button state
  const resetButtonState = (button: HTMLButtonElement, originalText: string | null) => {
    button.disabled = false;
    button.textContent = originalText || '셀에 적용';
  };

  // Apply code to a specific notebook cell
  const applyCodeToNotebookCell = async (
    code: string,
    notebook: any,
    blockId: string,
    button: HTMLButtonElement,
    originalText: string | null
  ) => {
    try {
      // Get widgets from notebook
      const cells = notebook.widgets || [];
      const modelCellsLength = notebook.model?.cells?.length || 0;

      console.log('[AgentPanel] applyCodeToNotebookCell called', {
        currentCellIndex: currentCellIndexRef.current,
        currentCellId: currentCellIdRef.current,
        blockId,
        widgetsLength: cells.length,
        modelCellsLength: modelCellsLength
      });

      // Try cell index first (most reliable)
      if (currentCellIndexRef.current !== null && currentCellIndexRef.current !== undefined) {
        console.log('[AgentPanel] Using cell index:', currentCellIndexRef.current);

        // Safety check: if widgets array is empty but model has cells, there might be a rendering issue
        if (cells.length === 0 && modelCellsLength > 0) {
          console.warn('[AgentPanel] Widgets not rendered yet, model has', modelCellsLength, 'cells');
          // Fall through to show selector dialog
        } else if (currentCellIndexRef.current >= 0 && currentCellIndexRef.current < cells.length) {
          const cell = cells[currentCellIndexRef.current];
          const cellModel = cell.model || cell;

          console.log('[AgentPanel] Found cell at index, applying code...');

          try {
            setCellSource(cellModel, code);
            console.log('[AgentPanel] Code applied successfully!');
            // Show tooltip on the target cell
            if (cell.node) {
              showCellTooltip(cell.node as HTMLElement, '✓ 코드가 적용되었습니다');
            } else {
              showNotification('코드가 셀에 적용되었습니다!', 'info');
            }
            resetButtonState(button, originalText);
            // Clear the cell index after successful application
            currentCellIndexRef.current = null;
            currentCellIdRef.current = null;
            return;
          } catch (updateError) {
            console.error('Failed to update cell content:', updateError);
            showNotification('셀 내용 업데이트 실패: ' + (updateError as Error).message, 'error');
            resetButtonState(button, originalText);
            return;
          }
        } else {
          console.error('[AgentPanel] Cell index out of bounds:', {
            currentIndex: currentCellIndexRef.current,
            widgetsLength: cells.length,
            modelCellsLength: modelCellsLength
          });
          // Don't show error, fall through to selector dialog
          currentCellIndexRef.current = null;
          currentCellIdRef.current = null;
        }
      }

      // Fallback: show selector dialog
      console.log('[AgentPanel] Showing cell selector dialog');
      showCellSelectorDialog(code, button, originalText);
    } catch (error) {
      console.error('Failed to apply code:', error);
      showNotification('코드 적용에 실패했습니다.', 'error');
      resetButtonState(button, originalText);
    }
  };

  // Show cell selector dialog (similar to chrome_agent)
  const showCellSelectorDialog = (
    code: string,
    button: HTMLButtonElement,
    originalText: string | null
  ) => {
    try {
      const app = (window as any).jupyterapp;
      if (!app) {
        showNotification('JupyterLab을 찾을 수 없습니다.', 'error');
        button.disabled = false;
        button.textContent = originalText || '셀에 적용';
        return;
      }

      // Find current notebook from shell
      const shell = app.shell;
      const currentWidget = shell.currentWidget;
      
      if (!currentWidget || !('content' in currentWidget)) {
        showNotification('활성 노트북을 찾을 수 없습니다.', 'warning');
        button.disabled = false;
        button.textContent = originalText || '셀에 적용';
        return;
      }

      const notebook = (currentWidget as any).content;
      
      if (!notebook || !('model' in notebook) || !notebook.model || !('cells' in notebook.model)) {
        showNotification('활성 노트북을 찾을 수 없습니다.', 'warning');
        button.disabled = false;
        button.textContent = originalText || '셀에 적용';
        return;
      }

      const cells = notebook.widgets || [];
      const codeCells: Array<{ cell: any; index: number; id: string; preview: string }> = [];

      // Collect code cells
      cells.forEach((cell: any, index: number) => {
        const cellModel = cell.model || cell;
        if (cellModel.type === 'code') {
          const cellId = cellModel.metadata?.get?.('jupyterAgentCellId') || 
                        cellModel.id ||
                        `cell-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          
          // Ensure cell has ID
          try {
            if (!cellModel.metadata?.get?.('jupyterAgentCellId')) {
              if (cellModel.metadata?.set) {
                cellModel.metadata.set('jupyterAgentCellId', cellId);
              }
            }
          } catch (e) {
            // Metadata might not be accessible, continue anyway
          }

          const content = (cellModel.sharedModel?.getSource?.() || 
                          cellModel.value?.text || 
                          '').toString();
          const preview = content.substring(0, 100).replace(/\n/g, ' ');

          codeCells.push({
            cell,
            index,
            id: cellId,
            preview
          });
        }
      });

      if (codeCells.length === 0) {
        showNotification('코드 셀을 찾을 수 없습니다.', 'warning');
        button.disabled = false;
        button.textContent = originalText || '셀에 적용';
        return;
      }

      // Remove existing dialog
      const existingDialog = document.querySelector('.jp-agent-cell-selector-dialog');
      if (existingDialog) {
        existingDialog.remove();
      }

      // Create dialog overlay
      const dialogOverlay = document.createElement('div');
      dialogOverlay.className = 'jp-agent-cell-selector-dialog';
      dialogOverlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.3);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
      `;

      // Create dialog container
      const dialogContainer = document.createElement('div');
      dialogContainer.style.cssText = `
        background: #fafafa;
        border: 1px solid #e0e0e0;
        border-radius: 4px;
        padding: 24px;
        max-width: 500px;
        width: 90%;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `;

      // Create cell list HTML
      const cellListHTML = codeCells.map(({ index, id, preview }) => {
        return `
          <div class="jp-agent-cell-selector-item" data-cell-id="${id}" style="
            padding: 12px;
            margin-bottom: 8px;
            background: white;
            border: 2px solid #e0e0e0;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s ease;
          ">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <span style="
                background: #667eea;
                color: white;
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 11px;
                font-weight: 600;
              ">셀 ${index + 1}</span>
            </div>
            <div style="font-size: 12px; color: #757575; font-family: 'Menlo', monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${escapeHtml(preview)}${preview.length >= 100 ? '...' : ''}
            </div>
          </div>
        `;
      }).join('');

      // Dialog content
      dialogContainer.innerHTML = `
        <div style="margin-bottom: 20px;">
          <h3 style="margin: 0 0 8px 0; color: #424242; font-size: 16px; font-weight: 500;">
            코드를 적용할 셀 선택
          </h3>
          <p style="margin: 0; color: #757575; font-size: 13px;">
            AI가 생성한 코드를 적용할 셀을 선택하세요
          </p>
        </div>
        <div class="jp-agent-cell-list" style="margin-bottom: 20px;">
          ${cellListHTML}
        </div>
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
          <button class="jp-agent-cell-selector-cancel-btn" style="
            background: transparent;
            color: #616161;
            border: 1px solid #d1d5db;
            border-radius: 3px;
            padding: 8px 16px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s ease;
          ">취소</button>
        </div>
      `;

      dialogOverlay.appendChild(dialogContainer);
      document.body.appendChild(dialogOverlay);

      // Cell item click handlers
      const cellItems = dialogContainer.querySelectorAll('.jp-agent-cell-selector-item');
      cellItems.forEach(item => {
        item.addEventListener('click', () => {
          const cellId = item.getAttribute('data-cell-id');
          if (!cellId) return;

          // Find the cell
          const cellInfo = codeCells.find(c => c.id === cellId);
          if (!cellInfo) return;

          const cellModel = cellInfo.cell.model || cellInfo.cell;

          // Apply code to cell
          try {
            setCellSource(cellModel, code);
            dialogOverlay.remove();
            // Show tooltip on the target cell
            if (cellInfo.cell.node) {
              showCellTooltip(cellInfo.cell.node as HTMLElement, '✓ 코드가 적용되었습니다');
            } else {
              showNotification('코드가 셀에 적용되었습니다!', 'info');
            }
            resetButtonState(button, originalText);
          } catch (error) {
            console.error('Failed to apply code to cell:', error);
            showNotification('코드 적용에 실패했습니다.', 'error');
            resetButtonState(button, originalText);
          }
        });

        // Hover effects
        item.addEventListener('mouseenter', () => {
          (item as HTMLElement).style.borderColor = '#667eea';
          (item as HTMLElement).style.background = '#f8f9ff';
        });

        item.addEventListener('mouseleave', () => {
          (item as HTMLElement).style.borderColor = '#e0e0e0';
          (item as HTMLElement).style.background = 'white';
        });
      });

      // Cancel button
      const cancelBtn = dialogContainer.querySelector('.jp-agent-cell-selector-cancel-btn');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
          dialogOverlay.remove();
          button.disabled = false;
          button.textContent = originalText || '셀에 적용';
        });

        (cancelBtn as HTMLElement).addEventListener('mouseenter', () => {
          (cancelBtn as HTMLElement).style.background = '#f5f5f5';
          (cancelBtn as HTMLElement).style.borderColor = '#9ca3af';
        });

        (cancelBtn as HTMLElement).addEventListener('mouseleave', () => {
          (cancelBtn as HTMLElement).style.background = 'transparent';
          (cancelBtn as HTMLElement).style.borderColor = '#d1d5db';
        });
      }

      // Close on overlay click
      dialogOverlay.addEventListener('click', (e) => {
        if (e.target === dialogOverlay) {
          dialogOverlay.remove();
          button.disabled = false;
          button.textContent = originalText || '셀에 적용';
        }
      });

      // ESC key to close
      const handleEsc = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          dialogOverlay.remove();
          document.removeEventListener('keydown', handleEsc);
          button.disabled = false;
          button.textContent = originalText || '셀에 적용';
        }
      };
      document.addEventListener('keydown', handleEsc);
    } catch (error) {
      console.error('Failed to show cell selector:', error);
      showNotification('셀 선택 다이얼로그 표시에 실패했습니다.', 'error');
      button.disabled = false;
      button.textContent = originalText || '셀에 적용';
    }
  };

  // Helper function to escape HTML
  const escapeHtml = (text: string): string => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  const isAutoApprovedCode = (code: string): boolean => {
    const lines = code
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'));
    if (lines.length === 0) {
      return true;
    }
    if (lines.some(line => (
      line.startsWith('!')
      || line.startsWith('%%bash')
      || line.startsWith('%%sh')
      || line.startsWith('%%shell')
    ))) {
      return false;
    }
    const disallowedPatterns = [
      /(^|[^=!<>])=([^=]|$)/,
      /\.read_[a-zA-Z0-9_]*\s*\(/,
      /\bread_[a-zA-Z0-9_]*\s*\(/,
      /\.to_[a-zA-Z0-9_]*\s*\(/,
    ];
    if (lines.some(line => disallowedPatterns.some(pattern => pattern.test(line)))) {
      return false;
    }
    const allowedPatterns = [
      /^print\(.+\)$/,
      /^display\(.+\)$/,
      /^df\.(head|info|describe)\s*\(.*\)$/,
      /^display\(df\.(head|info|describe)\s*\(.*\)\)$/,
      /^df\.(tail|sample)\s*\(.*\)$/,
      /^display\(df\.(tail|sample)\s*\(.*\)\)$/,
      /^df\.(shape|columns|dtypes)$/,
      /^import\s+pandas\s+as\s+pd$/,
    ];
    return lines.every(line => allowedPatterns.some(pattern => pattern.test(line)));
  };

  const userRequestedNotebookExecution = (): boolean => {
    const lastUserMessage = [...messages]
      .reverse()
      .find((msg): msg is IChatMessage => isChatMessage(msg) && msg.role === 'user');
    const content = lastUserMessage?.content ?? '';
    return /노트북|셀|cell|notebook|jupyter/i.test(content);
  };

  const isShellCell = (code: string): boolean => {
    const lines = code.split('\n');
    const firstLine = lines.find(line => line.trim().length > 0)?.trim() || '';
    if (
      firstLine.startsWith('%%bash')
      || firstLine.startsWith('%%sh')
      || firstLine.startsWith('%%shell')
    ) {
      return true;
    }
    return lines.some(line => line.trim().startsWith('!'));
  };

  const extractShellCommand = (code: string): string => {
    const lines = code.split('\n');
    const firstNonEmptyIndex = lines.findIndex(line => line.trim().length > 0);
    if (firstNonEmptyIndex === -1) {
      return '';
    }
    const firstLine = lines[firstNonEmptyIndex].trim();
    if (
      firstLine.startsWith('%%bash')
      || firstLine.startsWith('%%sh')
      || firstLine.startsWith('%%shell')
    ) {
      const script = lines.slice(firstNonEmptyIndex + 1).join('\n').trim();
      if (!script) {
        return '';
      }
      const escaped = script
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r?\n/g, '\\n');
      return `bash -lc $'${escaped}'`;
    }

    const shellLines = lines
      .map(line => line.trim())
      .filter(line => line.startsWith('!'))
      .map(line => line.replace(/^!+/, '').trim())
      .filter(Boolean);
    return shellLines.join('\n');
  };

  const buildPythonCommand = (code: string): string => (
    `python3 -c ${JSON.stringify(code)}`
  );

  const shouldExecuteInNotebook = (code: string): boolean => {
    const notebook = getActiveNotebookPanel();
    if (!notebook) {
      return false;
    }
    if (isShellCell(code) && !userRequestedNotebookExecution()) {
      return false;
    }
    return true;
  };

  const truncateOutputLines = (
    output: string,
    maxLines: number = 2
  ): { text: string; truncated: boolean } => {
    const lines = output.split(/\r?\n/).filter(line => line.length > 0);
    const text = lines.slice(0, maxLines).join('\n');
    return { text, truncated: lines.length > maxLines };
  };

  const createCommandOutputMessage = (command: string): string => {
    const messageId = makeMessageId('command-output');
    const outputMessage: IChatMessage = {
      id: messageId,
      role: 'system',
      content: `🐚 ${command}\n`,
      timestamp: Date.now(),
      metadata: {
        kind: 'shell-output',
        command
      }
    };
    setMessages(prev => [...prev, outputMessage]);
    return messageId;
  };

  const appendCommandOutputMessage = (
    messageId: string,
    text: string,
    stream: 'stdout' | 'stderr'
  ) => {
    if (!text) return;
    const prefix = stream === 'stderr' ? '[stderr] ' : '';
    setMessages(prev =>
      prev.map(msg => {
        if (msg.id !== messageId || !('role' in msg)) {
          return msg;
        }
        const chatMsg = msg as IChatMessage;
        return {
          ...chatMsg,
          content: `${chatMsg.content}${prefix}${text}`
        };
      })
    );
  };

  const executeSubprocessCommand = async (
    command: string,
    timeout?: number,
    onOutput?: (chunk: { stream: 'stdout' | 'stderr'; text: string }) => void,
    stdin?: string
  ): Promise<{ success: boolean; output: string; error?: string; returncode?: number | null; command: string; truncated: boolean }> => {
    try {
      const result = await apiService.executeCommandStream(command, { timeout, onOutput, stdin });
      const stdout = typeof result.stdout === 'string' ? result.stdout : '';
      const stderr = typeof result.stderr === 'string' ? result.stderr : '';
      const combined = [stdout, stderr].filter(Boolean).join('\n');
      const summary = truncateOutputLines(combined, 2);
      const truncated = summary.truncated || Boolean(result.truncated);
      const output = summary.text || '(no output)';
      if (result.success) {
        return {
          success: true,
          output,
          returncode: result.returncode ?? null,
          command,
          truncated
        };
      }
      const errorText = summary.text || result.error || stderr || 'Command failed';
      return {
        success: false,
        output,
        error: errorText,
        returncode: result.returncode ?? null,
        command,
        truncated
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Command execution failed';
      if (onOutput) {
        onOutput({ stream: 'stderr', text: `${message}\n` });
      }
      const summary = truncateOutputLines(message, 2);
      return {
        success: false,
        output: '',
        error: summary.text || 'Command execution failed',
        returncode: null,
        command,
        truncated: summary.truncated
      };
    }
  };

  const executeCodeViaSubprocess = async (
    code: string,
    timeout?: number
  ): Promise<{ success: boolean; output: string; error?: string; returncode?: number | null; command: string; truncated: boolean; execution_method: string }> => {
    const isShell = isShellCell(code);
    const command = isShell ? extractShellCommand(code) : buildPythonCommand(code);
    if (!command) {
      return {
        success: false,
        output: '',
        error: isShell ? 'Shell command is empty' : 'Python command is empty',
        returncode: null,
        command,
        truncated: false,
        execution_method: 'subprocess'
      };
    }
    const result = await executeSubprocessCommand(command, timeout);
    return {
      ...result,
      execution_method: 'subprocess'
    };
  };

  const upsertInterruptMessage = (interrupt: { threadId: string; action: string; args: any; description: string }) => {
    const interruptMessageId = interruptMessageIdRef.current || makeMessageId('interrupt');
    interruptMessageIdRef.current = interruptMessageId;
    const interruptMessage: IChatMessage = {
      id: interruptMessageId,
      role: 'system',
      content: interrupt.description || '코드 실행 승인이 필요합니다.',
      timestamp: Date.now(),
      metadata: { interrupt }
    };

    setMessages(prev => {
      const hasExisting = prev.some(msg => msg.id === interruptMessageId);
      if (hasExisting) {
        return prev.map(msg => msg.id === interruptMessageId ? interruptMessage : msg);
      }
      return [...prev, interruptMessage];
    });
  };

  const clearInterruptMessage = (decision?: 'approve' | 'reject') => {
    if (!interruptMessageIdRef.current) return;
    const messageId = interruptMessageIdRef.current;
    interruptMessageIdRef.current = null;
    setMessages(prev =>
      prev.map(msg => {
        // Only IChatMessage has metadata property (check via 'role' property)
        if (msg.id === messageId && 'role' in msg) {
          const chatMsg = msg as IChatMessage;
          return {
            ...chatMsg,
            metadata: {
              ...chatMsg.metadata,
              interrupt: {
                ...(chatMsg.metadata?.interrupt || {}),
                resolved: true,
                decision: decision || 'approve'  // Track approve/reject decision
              }
            }
          };
        }
        return msg;
      })
    );
  };

  const validateRelativePath = (path: string): { valid: boolean; error?: string } => {
    const trimmed = path.trim();
    if (trimmed.startsWith('/') || trimmed.startsWith('\\') || /^[A-Za-z]:/.test(trimmed)) {
      return { valid: false, error: 'Absolute paths are not allowed' };
    }
    if (trimmed.includes('..')) {
      return { valid: false, error: 'Path traversal (..) is not allowed' };
    }
    return { valid: true };
  };

  const normalizeContentsPath = (path: string): string => {
    const trimmed = path.trim();
    if (!trimmed || trimmed === '.' || trimmed === './') {
      return '';
    }
    return trimmed
      .replace(/^\.\/+/, '')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');
  };

  const globToRegex = (pattern: string): RegExp => {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const regex = `^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`;
    return new RegExp(regex);
  };

  const fetchContentsModel = async (
    path: string,
    options?: { content?: boolean; format?: 'text' | 'base64' | 'json' }
  ): Promise<{ success: boolean; data?: any; error?: string }> => {
    try {
      const { PageConfig, URLExt } = await import('@jupyterlab/coreutils');
      const baseUrl = PageConfig.getBaseUrl();
      const normalizedPath = normalizeContentsPath(path);
      const apiUrl = URLExt.join(baseUrl, 'api/contents', normalizedPath);
      const query = new URLSearchParams();
      if (options?.content !== undefined) {
        query.set('content', options.content ? '1' : '0');
      }
      if (options?.format) {
        query.set('format', options.format);
      }
      const url = query.toString() ? `${apiUrl}?${query.toString()}` : apiUrl;
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
      });
      if (!response.ok) {
        return { success: false, error: `Failed to load contents: ${response.status}` };
      }
      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load contents';
      return { success: false, error: message };
    }
  };

  const executeListFilesTool = async (params: ListFilesParams): Promise<ToolResult> => {
    const pathCheck = validateRelativePath(params.path);
    if (!pathCheck.valid) {
      return { success: false, error: pathCheck.error };
    }

    const pattern = (params.pattern || '*').trim() || '*';
    const recursive = params.recursive ?? false;
    const matcher = globToRegex(pattern);
    const maxEntries = 500;
    const files: Array<{ path: string; isDir: boolean; size: number }> = [];
    const pendingDirs: string[] = [normalizeContentsPath(params.path)];
    const visited = new Set<string>();

    while (pendingDirs.length > 0 && files.length < maxEntries) {
      const dirPath = pendingDirs.shift() ?? '';
      if (visited.has(dirPath)) {
        continue;
      }
      visited.add(dirPath);

      const contentsResult = await fetchContentsModel(dirPath, { content: true });
      if (!contentsResult.success) {
        return { success: false, error: contentsResult.error };
      }

      const model = contentsResult.data;
      if (!model || model.type !== 'directory' || !Array.isArray(model.content)) {
        const displayPath = dirPath || '.';
        return { success: false, error: `Not a directory: ${displayPath}` };
      }

      for (const entry of model.content) {
        if (!entry) {
          continue;
        }
        const name = entry.name || entry.path?.split('/').pop() || '';
        const entryPath = entry.path || name;
        const isDir = entry.type === 'directory';
        if (matcher.test(name)) {
          files.push({
            path: entryPath,
            isDir,
            size: isDir ? 0 : (entry.size ?? 0),
          });
        }
        if (recursive && isDir && entryPath) {
          pendingDirs.push(entryPath);
        }
        if (files.length >= maxEntries) {
          break;
        }
      }
    }

    const formatted = files.map((file: any) => {
      const icon = file.isDir ? '📁' : '📄';
      const sizeInfo = file.isDir ? '' : ` (${file.size} bytes)`;
      return `${icon} ${file.path}${file.isDir ? '/' : sizeInfo}`;
    }).join('\n');

    return {
      success: true,
      output: formatted || '(empty directory)',
      metadata: { count: files.length, files }
    };
  };

  const executeReadFileTool = async (params: ReadFileParams): Promise<ToolResult> => {
    if (!params.path) {
      return { success: false, error: 'Path is required' };
    }

    const pathCheck = validateRelativePath(params.path);
    if (!pathCheck.valid) {
      return { success: false, error: pathCheck.error };
    }

    const maxLines = typeof params.maxLines === 'number' ? params.maxLines : 1000;
    const safeMaxLines = Math.max(0, maxLines);
    const contentsResult = await fetchContentsModel(params.path, { content: true, format: 'text' });
    if (!contentsResult.success) {
      return { success: false, error: contentsResult.error };
    }

    const model = contentsResult.data;
    if (!model) {
      return { success: false, error: 'File not found' };
    }
    if (model.type === 'directory') {
      return { success: false, error: `Path is a directory: ${params.path}` };
    }

    let content = model.content ?? '';
    if (model.format === 'base64') {
      return { success: false, error: 'Binary file content is not supported' };
    }
    if (typeof content !== 'string') {
      content = JSON.stringify(content, null, 2);
    }

    const lines = content.split('\n');
    const sliced = lines.slice(0, safeMaxLines);
    return {
      success: true,
      output: sliced.join('\n'),
      metadata: {
        lineCount: sliced.length,
        truncated: lines.length > safeMaxLines
      }
    };
  };

  // Helper function for auto-approving search/file tools with execution results
  const handleAutoToolInterrupt = async (
    interrupt: { threadId: string; action: string; args: any; description: string }
  ) => {
    const { threadId, action, args } = interrupt;
    console.log('[AgentPanel] Auto-approving tool:', action, args);

    try {
      let executionResult: any;

      if (action === 'search_workspace_tool') {
        setDebugStatus(`🔍 검색 실행 중: ${args?.pattern || ''}`);
        executionResult = await apiService.searchWorkspace({
          pattern: args?.pattern || '',
          file_types: args?.file_types || ['*.py', '*.ipynb'],
          path: args?.path || '.',
          max_results: args?.max_results || 50,
          case_sensitive: args?.case_sensitive || false
        });
        console.log('[AgentPanel] search_workspace result:', executionResult);
      } else if (action === 'search_notebook_cells_tool') {
        setDebugStatus(`🔍 노트북 검색 실행 중: ${args?.pattern || ''}`);
        executionResult = await apiService.searchNotebookCells({
          pattern: args?.pattern || '',
          notebook_path: args?.notebook_path,
          cell_type: args?.cell_type,
          max_results: args?.max_results || 30,
          case_sensitive: args?.case_sensitive || false
        });
        console.log('[AgentPanel] search_notebook_cells result:', executionResult);
      } else if (action === 'check_resource_tool') {
        const filesList = args?.files || [];
        setDebugStatus(`📊 리소스 체크 중: ${filesList.join(', ') || 'system'}`);
        executionResult = await apiService.checkResource({
          files: filesList,
          dataframes: args?.dataframes || [],
          file_size_command: args?.file_size_command || '',
          dataframe_check_code: args?.dataframe_check_code || ''
        });
        console.log('[AgentPanel] check_resource result:', executionResult);
      } else if (action === 'list_files_tool') {
        setDebugStatus('📂 파일 목록 조회 중...');
        const listParams: ListFilesParams = {
          path: typeof args?.path === 'string' ? args.path : '.',
          recursive: args?.recursive ?? false,
          pattern: args?.pattern ?? undefined
        };
        executionResult = await executeListFilesTool(listParams);
        console.log('[AgentPanel] list_files result:', executionResult);
      } else if (action === 'read_file_tool') {
        setDebugStatus('📄 파일 읽는 중...');
        const readParams: ReadFileParams = {
          path: typeof args?.path === 'string' ? args.path : '',
          encoding: typeof args?.encoding === 'string' ? args.encoding : undefined,
          maxLines: args?.max_lines ?? args?.maxLines
        };
        executionResult = await executeReadFileTool(readParams);
        console.log('[AgentPanel] read_file result:', executionResult);
      } else {
        console.warn('[AgentPanel] Unknown auto tool:', action);
        return;
      }

      // Resume with execution result
      const resumeArgs = {
        ...args,
        execution_result: executionResult
      };

      // Clear interrupt state (don't show approval UI for search)
      setInterruptData(null);

      // Create new assistant message for continued response
      const assistantMessageId = makeMessageId('assistant');
      setStreamingMessageId(assistantMessageId);
      setMessages(prev => [
        ...prev,
        {
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          timestamp: Date.now()
        }
      ]);

      let streamedContent = '';
      let interrupted = false;

      setDebugStatus('🤔 LLM 응답 대기 중');

      await apiService.resumeAgent(
        threadId,
        'edit',  // Use 'edit' to pass execution_result in args
        resumeArgs,
        undefined,
        llmConfig || undefined,
        (chunk: string) => {
          streamedContent += chunk;
          setMessages(prev =>
            prev.map(msg =>
              msg.id === assistantMessageId && isChatMessage(msg)
                ? { ...msg, content: streamedContent }
                : msg
            )
          );
        },
        (status: string) => {
          setDebugStatus(status);
        },
        (nextInterrupt) => {
          interrupted = true;
          approvalPendingRef.current = true;
          const autoApproveEnabled = getAutoApproveEnabled(
            llmConfig || getLLMConfig() || getDefaultLLMConfig()
          );

          // Handle next interrupt (could be another search or code execution)
          if (
            nextInterrupt.action === 'search_workspace_tool'
            || nextInterrupt.action === 'search_notebook_cells_tool'
            || nextInterrupt.action === 'check_resource_tool'
            || nextInterrupt.action === 'list_files_tool'
            || nextInterrupt.action === 'read_file_tool'
          ) {
            void handleAutoToolInterrupt(nextInterrupt);
            return;
          }
          if (autoApproveEnabled) {
            void resumeFromInterrupt(nextInterrupt, 'approve');
            return;
          }
          if (nextInterrupt.action === 'jupyter_cell_tool' && nextInterrupt.args?.code) {
            const shouldQueue = shouldExecuteInNotebook(nextInterrupt.args.code);
            if (isAutoApprovedCode(nextInterrupt.args.code)) {
              if (shouldQueue) {
                queueApprovalCell(nextInterrupt.args.code);
              }
              void resumeFromInterrupt(nextInterrupt, 'approve');
              return;
            }
            if (shouldQueue) {
              queueApprovalCell(nextInterrupt.args.code);
            }
          }
          setInterruptData(nextInterrupt);
          upsertInterruptMessage(nextInterrupt);
          setIsLoading(false);
          setIsStreaming(false);
        },
        (newTodos) => {
          setTodos(newTodos);
        },
        () => {
          setDebugStatus(null);
        },
        handleToolCall
      );

      if (!interrupted) {
        setIsLoading(false);
        setIsStreaming(false);
        setStreamingMessageId(null);
        approvalPendingRef.current = false;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tool execution failed';
      console.error('[AgentPanel] Auto tool error:', error);
      setDebugStatus(`오류: ${message}`);
      setIsLoading(false);
      setIsStreaming(false);
      approvalPendingRef.current = false;
    }
  };

  const resumeFromInterrupt = async (
    interrupt: { threadId: string; action: string; args: any; description: string },
    decision: 'approve' | 'reject',
    feedback?: string  // Optional feedback message for rejection
  ) => {
    const { threadId } = interrupt;
    setInterruptData(null);
    setDebugStatus(null);
    clearInterruptMessage(decision);  // Pass decision to track approve/reject
    let resumeDecision: 'approve' | 'edit' | 'reject' = decision;
    let resumeArgs: any = undefined;
    if (decision === 'approve') {
      // Handle write_file_tool separately - execute file write on Jupyter server
      if (interrupt.action === 'write_file_tool') {
        try {
          setDebugStatus('📝 파일 쓰기 중...');
          const writeResult = await apiService.writeFile(
            interrupt.args?.path || '',
            interrupt.args?.content || '',
            {
              encoding: interrupt.args?.encoding || 'utf-8',
              overwrite: interrupt.args?.overwrite || false
            }
          );
          console.log('[AgentPanel] write_file result:', writeResult);
          resumeDecision = 'edit';
          resumeArgs = {
            ...interrupt.args,
            execution_result: writeResult
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'File write failed';
          console.error('[AgentPanel] write_file error:', error);
          resumeDecision = 'edit';
          resumeArgs = {
            ...interrupt.args,
            execution_result: { success: false, error: message }
          };
        }
      } else if (interrupt.action === 'execute_command_tool') {
        const command = (interrupt.args?.command || '').trim();
        // Default stdin to "y\n" for interactive prompts (yes/no)
        const stdinInput = (interrupt.args?.stdin as string | undefined) ?? 'y\n';
        setDebugStatus('🐚 셸 명령 실행 중...');
        const outputMessageId = command ? createCommandOutputMessage(command) : null;
        const execResult = command
          ? await executeSubprocessCommand(
              command,
              interrupt.args?.timeout,
              outputMessageId
                ? (chunk) => appendCommandOutputMessage(outputMessageId, chunk.text, chunk.stream)
                : undefined,
              stdinInput
            )
          : {
              success: false,
              output: '',
              error: 'Command is required',
              returncode: null,
              command,
              truncated: false
            };
        resumeDecision = 'edit';
        resumeArgs = {
          ...interrupt.args,
          execution_result: execResult
        };
      } else if (interrupt.action === 'jupyter_cell_tool' && interrupt.args?.code) {
        const code = interrupt.args.code as string;
        if (!shouldExecuteInNotebook(code)) {
          setDebugStatus('🐚 서브프로세스로 코드 실행 중...');
          const execResult = await executeCodeViaSubprocess(code, interrupt.args?.timeout);
          resumeDecision = 'edit';
          resumeArgs = {
            code,
            execution_result: execResult
          };
        } else {
          const executed = await executePendingApproval();
          if (executed && executed.tool === 'jupyter_cell') {
            resumeDecision = 'edit';
            resumeArgs = {
              code: executed.code,
              execution_result: (executed as any).execution_result
            };
          } else {
            const notebook = getActiveNotebookPanel();
            if (!notebook) {
              setDebugStatus('🐚 노트북이 없어 서브프로세스로 실행 중...');
              const execResult = await executeCodeViaSubprocess(code, interrupt.args?.timeout);
              resumeDecision = 'edit';
              resumeArgs = {
                code,
                execution_result: execResult
              };
            } else {
              const cellIndex = insertCell(notebook, 'code', code);
              if (cellIndex === null) {
                setDebugStatus('🐚 노트북 모델이 없어 서브프로세스로 실행 중...');
                const execResult = await executeCodeViaSubprocess(code, interrupt.args?.timeout);
                resumeDecision = 'edit';
                resumeArgs = {
                  code,
                  execution_result: execResult
                };
              } else {
                await executeCell(notebook, cellIndex);
                const execResult = captureExecutionResult(notebook, cellIndex);
                resumeDecision = 'edit';
                resumeArgs = {
                  code,
                  execution_result: execResult
                };
              }
            }
          }
        }
      } else {
        const executed = await executePendingApproval();
        if (executed && executed.tool === 'jupyter_cell') {
          resumeDecision = 'edit';
          resumeArgs = {
            code: executed.code,
            execution_result: (executed as any).execution_result
          };
        } else if (executed && executed.tool === 'markdown') {
          resumeDecision = 'edit';
          resumeArgs = {
            content: executed.content
          };
        }
      }
    } else {
      // Reject: delete the pending cell from notebook
      const pendingCall = pendingToolCallsRef.current[0];
      if (pendingCall && pendingCall.cellIndex !== undefined) {
        const notebook = getActiveNotebookPanel();
        if (notebook) {
          deleteCell(notebook, pendingCall.cellIndex);
        }
      }
      pendingToolCallsRef.current.shift();
      approvalPendingRef.current = pendingToolCallsRef.current.length > 0;
    }
    setIsLoading(true);
    setIsStreaming(true);
    let interrupted = false;

    // 항상 새 메시지 생성 - 승인 UI 아래에 append되도록
    const assistantMessageId = makeMessageId('assistant');
    setStreamingMessageId(assistantMessageId);

    // 새 메시지 추가 (맨 아래에 append)
    setMessages(prev => [
      ...prev,
      {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: Date.now()
      }
    ]);

    let streamedContent = '';

    // Build feedback message for rejection
    const rejectionFeedback = resumeDecision === 'reject'
      ? (feedback ? `사용자 피드백: ${feedback}` : 'User rejected this action')
      : undefined;

    try {
      await apiService.resumeAgent(
        threadId,
        resumeDecision,
        resumeArgs,
        rejectionFeedback,
        llmConfig || undefined,
        (chunk: string) => {
          streamedContent += chunk;
          setMessages(prev =>
            prev.map(msg =>
              msg.id === assistantMessageId && isChatMessage(msg)
                ? { ...msg, content: streamedContent }
                : msg
            )
          );
        },
        (status: string) => {
          setDebugStatus(status);
        },
        (nextInterrupt) => {
          interrupted = true;
          approvalPendingRef.current = true;
          const autoApproveEnabled = getAutoApproveEnabled(
            llmConfig || getLLMConfig() || getDefaultLLMConfig()
          );
          // Auto-approve search/file/resource tools
          if (
            nextInterrupt.action === 'search_workspace_tool'
            || nextInterrupt.action === 'search_notebook_cells_tool'
            || nextInterrupt.action === 'check_resource_tool'
            || nextInterrupt.action === 'list_files_tool'
            || nextInterrupt.action === 'read_file_tool'
          ) {
            void handleAutoToolInterrupt(nextInterrupt);
            return;
          }
          if (autoApproveEnabled) {
            void resumeFromInterrupt(nextInterrupt, 'approve');
            return;
          }
          if (nextInterrupt.action === 'jupyter_cell_tool' && nextInterrupt.args?.code) {
            const shouldQueue = shouldExecuteInNotebook(nextInterrupt.args.code);
            if (isAutoApprovedCode(nextInterrupt.args.code)) {
              if (shouldQueue) {
                queueApprovalCell(nextInterrupt.args.code);
              }
              void resumeFromInterrupt(nextInterrupt, 'approve');
              return;
            }
            if (shouldQueue) {
              queueApprovalCell(nextInterrupt.args.code);
            }
          }
          setInterruptData(nextInterrupt);
          upsertInterruptMessage(nextInterrupt);
          setIsLoading(false);
          setIsStreaming(false);
        },
        (newTodos) => {
          setTodos(newTodos);
        },
        () => {
          setDebugStatus(null);
        },
        handleToolCall
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to resume';
      setDebugStatus(`오류: ${message}`);
      console.error('Resume failed:', error);
      setMessages(prev => [
        ...prev,
        {
          id: makeMessageId(),
          role: 'assistant',
          content: `Error: ${message}`,
          timestamp: Date.now()
        }
      ]);
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
      if (!interrupted) {
        approvalPendingRef.current = false;
      }
    }
  };

  const handleSendMessage = async () => {
    // Handle rejection mode - resume with optional feedback
    if (isRejectionMode && pendingRejectionInterrupt) {
      const feedback = input.trim() || undefined;  // Empty input means no feedback

      // Add user message bubble if there's feedback
      if (feedback) {
        const userMessage: IChatMessage = {
          id: makeMessageId(),
          role: 'user',
          content: feedback,
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, userMessage]);
      }

      setInput('');
      setIsRejectionMode(false);
      const interruptToResume = pendingRejectionInterrupt;
      setPendingRejectionInterrupt(null);
      await resumeFromInterrupt(interruptToResume, 'reject', feedback);
      return;
    }

    // Check if there's an LLM prompt stored (from cell action)
    const textarea = messagesEndRef.current?.parentElement?.querySelector('.jp-agent-input') as HTMLTextAreaElement;
    const llmPrompt = pendingLlmPromptRef.current || textarea?.getAttribute('data-llm-prompt');

    // Allow execution if we have an LLM prompt even if input is empty (for auto-execution)
    if ((!input.trim() && !llmPrompt) || isLoading || isStreaming || isAgentRunning) return;

    const currentInput = input.trim();

    // Agent 모드이면 Agent 실행
    if (inputMode === 'agent') {
      // Use app.shell.currentWidget for reliable active tab detection
      const app = (window as any).jupyterapp;
      let notebook = null;

      if (app?.shell?.currentWidget) {
        const currentWidget = app.shell.currentWidget;
        if ('content' in currentWidget && currentWidget.content?.model) {
          notebook = currentWidget;
        }
      }

      if (!notebook) {
        notebook = notebookTracker?.currentWidget;
      }

      // 노트북이 없는 경우
      if (!notebook) {
        // Python 에러가 감지되면 파일 수정 모드로 전환
        if (detectPythonError(currentInput)) {
          console.log('[AgentPanel] Agent mode: No notebook, but Python error detected - attempting file fix');

          // Python 에러 수정 처리 시도
          const handled = await handlePythonErrorFix(currentInput);
          if (handled) {
            // 파일 수정 모드로 처리됨
            const userMessage: IChatMessage = {
              id: makeMessageId(),
              role: 'user',
              content: currentInput,
              timestamp: Date.now(),
            };
            setMessages(prev => [...prev, userMessage]);
            setInput('');
            return;
          }
          // 파일 경로를 찾지 못함 - 아래 로직으로 계속 진행
          console.log('[AgentPanel] Agent mode: No file path found, continuing...');
        }

        // 파일 수정 관련 자연어 요청 감지 (에러, 고쳐, 수정, fix 등)
        const fileFixRequestPatterns = [
          /에러.*해결/i,
          /에러.*고쳐/i,
          /에러.*수정/i,
          /오류.*해결/i,
          /오류.*고쳐/i,
          /오류.*수정/i,
          /fix.*error/i,
          /\.py.*에러/i,
          /\.py.*오류/i,
          /콘솔.*에러/i,
          /console.*error/i,
          /파일.*에러/i,
          /파일.*오류/i,
        ];

        const isFileFixRequest = fileFixRequestPatterns.some(pattern => pattern.test(currentInput));

        if (isFileFixRequest) {
          console.log('[AgentPanel] Agent mode: No notebook, file fix request detected - prompting for error details');

          // User 메시지 추가
          const userMessage: IChatMessage = {
            id: makeMessageId(),
            role: 'user',
            content: currentInput,
            timestamp: Date.now(),
          };
          setMessages(prev => [...prev, userMessage]);
          setInput('');

          // 에러 메시지 요청 안내
          const guideMessage: IChatMessage = {
            id: makeMessageId('guide'),
            role: 'assistant',
            content: `파일 에러 수정을 도와드리겠습니다! 🔧

**에러 메시지를 복사해서 붙여넣어 주세요.**

Console에서 발생한 에러 전체를 복사해주시면:
1. 에러가 발생한 파일을 자동으로 찾아서 읽고
2. 관련된 import 파일들도 함께 분석하여
3. 수정된 코드를 제안해 드립니다.

예시:
\`\`\`
$ python b.py
Traceback (most recent call last):
  File "a.py", line 3
    def foo(
          ^
SyntaxError: '(' was never closed
\`\`\``,
            timestamp: Date.now(),
          };
          setMessages(prev => [...prev, guideMessage]);
          return;
        }

        // 일반적인 요청은 Chat 모드로 fallback
        console.log('[AgentPanel] Agent mode: No notebook - falling back to chat mode');
      } else {
        // 노트북이 있으면 Agent 실행
        // User 메시지 추가
        const userMessage: IChatMessage = {
          id: makeMessageId(),
          role: 'user',
          content: `@agent ${currentInput}`,
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, userMessage]);
        setInput('');

        // Agent 실행
        await handleAgentExecution(currentInput);
        return;
      }
    }

    // Chat 모드에서도 명령어로 Agent 실행 가능
    if (isAgentCommand(currentInput)) {
      const agentRequest = extractAgentRequest(currentInput);
      if (agentRequest) {
        // User 메시지 추가
        const userMessage: IChatMessage = {
          id: makeMessageId(),
          role: 'user',
          content: currentInput,
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, userMessage]);
        setInput('');

        // Agent 실행
        await handleAgentExecution(agentRequest);
        return;
      }
    }

    // Python 에러 감지 및 파일 수정 모드 (Chat 모드에서만)
    // 파일 경로를 추출할 수 있는 경우에만 파일 수정 모드 사용
    // 그렇지 않으면 일반 LLM 스트림으로 처리
    if (inputMode === 'chat' && detectPythonError(currentInput)) {
      console.log('[AgentPanel] Python error detected in message, attempting file fix...');

      // Python 에러 수정 처리 시도 (파일 경로를 찾을 수 있는 경우에만 처리됨)
      const handled = await handlePythonErrorFix(currentInput);
      if (handled) {
        // 파일 수정 모드로 처리됨 - 사용자 메시지 추가 후 종료
        const userMessage: IChatMessage = {
          id: makeMessageId(),
          role: 'user',
          content: currentInput,
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        return;
      }
      // 파일 경로를 찾지 못해 handled=false 반환됨
      // 일반 스트림으로 폴백 (아래 로직에서 사용자 메시지 추가됨)
      console.log('[AgentPanel] No file path found in error, using regular LLM stream');
    }

    // Use the display prompt (input) for the user message, or use a fallback if input is empty
    const displayContent = currentInput || (llmPrompt ? '셀 분석 요청' : '');
    await sendChatMessage({
      displayContent,
      llmPrompt,
      textarea,
      clearInput: Boolean(currentInput)
    });
  };

  // Handle resume after user approval/rejection
  const handleResumeAgent = async (decision: 'approve' | 'reject') => {
    if (!interruptData) return;

    if (decision === 'reject') {
      // Enter rejection mode - wait for user feedback before resuming
      setIsRejectionMode(true);
      setPendingRejectionInterrupt(interruptData);
      // Clear the interrupt UI but keep the data for later, mark as rejected
      setInterruptData(null);
      clearInterruptMessage('reject');  // Pass 'reject' to show "거부됨"
      // Focus on input for user to provide feedback
      const textarea = document.querySelector('.jp-agent-input') as HTMLTextAreaElement;
      if (textarea) {
        textarea.focus();
      }
      return;
    }

    await resumeFromInterrupt(interruptData, decision);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter: 전송
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
    // Shift+Tab: 모드 전환 (chat ↔ agent)
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      setInputMode(prev => prev === 'chat' ? 'agent' : 'chat');
      return;
    }
    // Cmd/Ctrl + . : 모드 전환 (대체 단축키)
    if (e.key === '.' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setInputMode(prev => prev === 'chat' ? 'agent' : 'chat');
    }
    // Tab (without Shift): Agent 모드일 때 드롭다운 토글
    if (e.key === 'Tab' && !e.shiftKey && inputMode === 'agent') {
      e.preventDefault();
      setShowModeDropdown(prev => !prev);
    }
  };

  // 모드 토글 함수
  const toggleMode = () => {
    setInputMode(prev => prev === 'chat' ? 'agent' : 'chat');
    setShowModeDropdown(false);
  };

  const clearChat = () => {
    setMessages([]);
    setConversationId('');
  };

  // Agent 실행 메시지 렌더링
  const renderAgentExecutionMessage = (msg: AgentExecutionMessage) => {
    const { status, plan, result, completedSteps, failedSteps, request } = msg;
    const isActive = ['planning', 'executing', 'tool_calling', 'self_healing', 'replanning', 'validating', 'reflecting'].includes(status.phase);

    const getStepStatus = (stepNumber: number): 'completed' | 'failed' | 'current' | 'pending' => {
      if (failedSteps.includes(stepNumber)) return 'failed';
      if (completedSteps.includes(stepNumber)) return 'completed';
      if (status.currentStep === stepNumber) return 'current';
      return 'pending';
    };

    const progressPercent = plan ? (completedSteps.length / plan.totalSteps) * 100 : 0;

    return (
      <div className="jp-agent-execution-message">
        {/* Agent 요청 헤더 */}
        <div className="jp-agent-execution-header">
          <div className="jp-agent-execution-badge">
            <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
              <path d="M8 0a8 8 0 100 16A8 8 0 008 0zm0 14.5a6.5 6.5 0 110-13 6.5 6.5 0 010 13z"/>
              <path d="M8 3a.75.75 0 01.75.75v3.5h2.5a.75.75 0 010 1.5h-3.25a.75.75 0 01-.75-.75v-4.25A.75.75 0 018 3z"/>
            </svg>
            Agent
          </div>
          <span className="jp-agent-execution-request">{request}</span>
        </div>

        {/* 실행 상태 */}
        <div className={`jp-agent-execution-status jp-agent-execution-status--${status.phase}`}>
          {isActive && <div className="jp-agent-execution-spinner" />}
          {status.phase === 'completed' && (
            <svg viewBox="0 0 16 16" fill="currentColor" className="jp-agent-execution-icon--success">
              <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
            </svg>
          )}
          {status.phase === 'failed' && (
            <svg viewBox="0 0 16 16" fill="currentColor" className="jp-agent-execution-icon--error">
              <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/>
            </svg>
          )}
          <span className="jp-agent-execution-status-text">
            {status.phase === 'completed'
              ? '완료'
              : status.phase === 'failed'
                ? '실패'
                : (status.message || status.phase)
            }
          </span>
        </div>

        {/* 실행 계획 */}
        {plan && (
          <div className="jp-agent-execution-plan">
            <div className="jp-agent-execution-plan-header">
              <span>실행 계획</span>
              <span className="jp-agent-execution-plan-progress">
                {completedSteps.length} / {plan.totalSteps}
              </span>
            </div>
            {/* Progress Bar */}
            <div className="jp-agent-execution-progress-bar">
              <div
                className="jp-agent-execution-progress-fill"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {/* Steps */}
            <div className="jp-agent-execution-steps">
              {plan.steps.map((step) => {
                const stepStatus = getStepStatus(step.stepNumber);
                return (
                  <div
                    key={step.stepNumber}
                    className={`jp-agent-execution-step jp-agent-execution-step--${stepStatus}`}
                    ref={(el) => {
                      // 현재 진행 중인 단계로 자동 스크롤
                      if (stepStatus === 'current' && el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                      }
                    }}
                  >
                    <div className="jp-agent-execution-step-indicator">
                      {stepStatus === 'completed' && (
                        <svg viewBox="0 0 16 16" fill="currentColor">
                          <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
                        </svg>
                      )}
                      {stepStatus === 'failed' && (
                        <svg viewBox="0 0 16 16" fill="currentColor">
                          <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/>
                        </svg>
                      )}
                      {stepStatus === 'current' && <div className="jp-agent-execution-step-spinner" />}
                      {stepStatus === 'pending' && <span>{step.stepNumber}</span>}
                    </div>
                    <div className="jp-agent-execution-step-content">
                      <span className={`jp-agent-execution-step-desc ${stepStatus === 'completed' ? 'jp-agent-execution-step-desc--done' : ''}`}>
                        {step.description}
                      </span>
                      <div className="jp-agent-execution-step-tools">
                        {step.toolCalls
                          .filter(tc => !['jupyter_cell', 'final_answer', 'markdown'].includes(tc.tool))
                          .map((tc, i) => (
                            <span key={i} className="jp-agent-execution-tool-tag">{tc.tool}</span>
                          ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 최종 결과 */}
        {result && (
          <div className={`jp-agent-execution-result jp-agent-execution-result--${result.success ? 'success' : 'error'}`}>
            {result.finalAnswer && (
              <div
                className="jp-agent-execution-result-message jp-RenderedHTMLCommon"
                dangerouslySetInnerHTML={{ __html: formatMarkdownToHtml(result.finalAnswer) }}
              />
            )}
            {result.error && (
              <p className="jp-agent-execution-result-error">{result.error}</p>
            )}
            <div className="jp-agent-execution-result-stats">
              <span>{result.createdCells.length}개 셀 생성</span>
              <span>{result.modifiedCells.length}개 셀 수정</span>
              {result.executionTime && (
                <span>{(result.executionTime / 1000).toFixed(1)}초</span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // 메시지가 Chat 메시지인지 확인
  const isChatMessage = (msg: UnifiedMessage): msg is IChatMessage => {
    return !('type' in msg) || msg.type !== 'agent_execution';
  };

  const mapStatusText = (raw: string): string => {
    const normalized = raw.toLowerCase();
    if (normalized.includes('calling tool')) {
      return raw.replace(/Calling tool:/gi, '도구 호출 중:').trim();
    }
    if (normalized.includes('waiting for user approval')) {
      return '승인 대기 중...';
    }
    if (normalized.includes('resuming execution')) {
      return '승인 반영 후 실행 재개 중...';
    }
    return raw;
  };

  const getStatusText = (): string | null => {
    if (interruptData) {
      return `승인 대기: ${interruptData.action}`;
    }
    if (debugStatus) {
      return mapStatusText(debugStatus);
    }
    if (isLoading || isStreaming) {
      // 기본 상태 메시지 - todo 내용은 compact todo UI에서 표시
      return '요청 처리 중';
    }
    return null;
  };

  const statusText = getStatusText();
  const hasActiveTodos = todos.some(todo => todo.status === 'pending' || todo.status === 'in_progress');

  return (
    <div className="jp-agent-panel">
      {/* Settings Dialog */}
      {showSettings && (
        <SettingsPanel
          onClose={() => setShowSettings(false)}
          onSave={handleSaveConfig}
          currentConfig={llmConfig || undefined}
        />
      )}

      {/* Header */}
      <div className="jp-agent-header">
        <div
          className="jp-agent-header-logo"
          dangerouslySetInnerHTML={{ __html: headerLogoSvg }}
        />
        <div className="jp-agent-header-buttons">
          <button
            className="jp-agent-clear-button"
            onClick={clearChat}
            title="대화 초기화"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
          <button
            className="jp-agent-settings-button-icon"
            onClick={() => setShowSettings(true)}
            title="설정"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="21" x2="4" y2="14"></line>
              <line x1="4" y1="10" x2="4" y2="3"></line>
              <line x1="12" y1="21" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12" y2="3"></line>
              <line x1="20" y1="21" x2="20" y2="16"></line>
              <line x1="20" y1="12" x2="20" y2="3"></line>
              <line x1="1" y1="14" x2="7" y2="14"></line>
              <line x1="9" y1="8" x2="15" y2="8"></line>
              <line x1="17" y1="16" x2="23" y2="16"></line>
            </svg>
          </button>
        </div>
      </div>

      {/* Unified Messages (Chat + Agent Execution) */}
      <div className="jp-agent-messages">
        {messages.length === 0 ? (
          <div className="jp-agent-empty-state">
            <p>안녕하세요! HDSP Agent입니다.</p>
            <p className="jp-agent-empty-hint">
              {inputMode === 'agent'
                ? '노트북 작업을 자연어로 요청하세요. 예: "데이터 시각화 해줘"'
                : '메시지를 입력하거나 아래 버튼으로 Agent 모드를 선택하세요.'
              }
            </p>
          </div>
        ) : (
          messages.map(msg => {
            if (isChatMessage(msg)) {
              // 일반 Chat 메시지
              const isAssistant = msg.role === 'assistant';
              const isShellOutput = msg.metadata?.kind === 'shell-output';
              const interruptAction = msg.metadata?.interrupt?.action;
              const isWriteFile = interruptAction === 'write_file_tool';
              const writePath = (
                isWriteFile
                && typeof msg.metadata?.interrupt?.args?.path === 'string'
              ) ? msg.metadata?.interrupt?.args?.path : '';
              const headerRole = msg.role === 'user'
                ? '사용자'
                : msg.role === 'system'
                  ? (isShellOutput ? 'shell 실행' : '승인 요청')
                  : 'Agent';
              return (
                <div
                  key={msg.id}
                  className={
                    isAssistant
                      ? 'jp-agent-message jp-agent-message-assistant-inline'
                      : `jp-agent-message jp-agent-message-${msg.role}${isShellOutput ? ' jp-agent-message-shell-output' : ''}`
                  }
                >
                  {!isAssistant && (
                    <div className="jp-agent-message-header">
                      <span className="jp-agent-message-role">
                        {headerRole}
                      </span>
                      <span className="jp-agent-message-time">
                        {new Date(msg.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  )}
                  <div className={`jp-agent-message-content${streamingMessageId === msg.id ? ' streaming' : ''}${isShellOutput ? ' jp-agent-message-content-shell' : ''}`}>
                    {msg.role === 'system' && msg.metadata?.interrupt ? (
                      <div className="jp-agent-interrupt-inline">
                        <div className="jp-agent-interrupt-description">
                          {msg.content}
                        </div>
                        <div className="jp-agent-interrupt-action">
                          <div className="jp-agent-interrupt-action-args">
                            {(() => {
                              const command = msg.metadata?.interrupt?.args?.command;
                              const code = msg.metadata?.interrupt?.args?.code || msg.metadata?.interrupt?.args?.content || '';
                              const snippet = (command || code || '(no details)') as string;
                              const language = command ? 'bash' : 'python';
                              const resolved = msg.metadata?.interrupt?.resolved;
                              const decision = msg.metadata?.interrupt?.decision;
                              const resolvedText = decision === 'reject' ? '거부됨' : '승인됨';
                              const resolvedClass = decision === 'reject' ? 'jp-agent-interrupt-actions--rejected' : 'jp-agent-interrupt-actions--resolved';
                              const actionHtml = resolved
                                ? `<div class="jp-agent-interrupt-actions ${resolvedClass}">${resolvedText}</div>`
                                : `
<div class="code-block-actions jp-agent-interrupt-actions">
  <button class="jp-agent-interrupt-approve-btn" data-action="approve">승인</button>
  <button class="jp-agent-interrupt-reject-btn" data-action="reject">거부</button>
</div>
`;
                              const renderedHtml = (() => {
                                let html = formatMarkdownToHtml(`\n\`\`\`${language}\n${snippet}\n\`\`\``);
                                if (isWriteFile && writePath) {
                                  const safePath = escapeHtml(writePath);
                                  html = html.replace(
                                    /<span class="code-block-language">[^<]*<\/span>/,
                                    `<span class="code-block-language jp-agent-interrupt-path">${safePath}</span>`
                                  );
                                }
                                return html.replace('</div>', `${actionHtml}</div>`);
                              })();
                              return (
                                <div
                                  className="jp-RenderedHTMLCommon"
                                  style={{ padding: '0 4px' }}
                                  dangerouslySetInnerHTML={{ __html: renderedHtml }}
                                  onClick={(event) => {
                                    const target = event.target as HTMLElement;
                                    const action = target?.getAttribute?.('data-action');
                                    if (msg.metadata?.interrupt?.resolved) {
                                      return;
                                    }
                                    if (action === 'approve') {
                                      handleResumeAgent('approve');
                                    } else if (action === 'reject') {
                                      handleResumeAgent('reject');
                                    }
                                  }}
                                />
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    ) : msg.role === 'assistant' ? (
                      // Assistant(AI) 메시지: 마크다운 HTML 렌더링 + Jupyter 스타일 적용
                      <div
                        className="jp-RenderedHTMLCommon"
                        style={{ padding: '0 5px' }}
                        dangerouslySetInnerHTML={{ __html: formatMarkdownToHtml(msg.content) }}
                      />
                    ) : (
                      // User(사용자) 메시지: 텍스트 그대로 줄바꿈만 처리
                      <div style={{ whiteSpace: 'pre-wrap' }}>
                        {msg.content}
                      </div>
                    )}
                  </div>
                </div>
              );
            } else {
              // Agent 실행 메시지
              return (
                <div key={msg.id} className="jp-agent-message jp-agent-message-agent-execution">
                  {renderAgentExecutionMessage(msg)}
                </div>
              );
            }
          })
        )}

{/* Todo List moved to above input container */}

        {/* Console 에러 감지 알림 */}
        {showConsoleErrorNotification && lastConsoleError && (
          <div className="jp-agent-console-error-notification">
            <div className="jp-agent-console-error-header">
              <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16">
                <path d="M8.982 1.566a1.13 1.13 0 00-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 01-1.1 0L7.1 5.995A.905.905 0 018 5zm.002 6a1 1 0 110 2 1 1 0 010-2z"/>
              </svg>
              <span>Console에서 Python 에러가 감지되었습니다</span>
            </div>
            <div className="jp-agent-console-error-preview">
              {lastConsoleError.slice(0, 200)}
              {lastConsoleError.length > 200 ? '...' : ''}
            </div>
            <div className="jp-agent-console-error-actions">
              <button
                className="jp-agent-console-error-fix-btn"
                onClick={() => {
                  // 에러를 자동으로 입력창에 넣고 파일 수정 요청
                  setInput(`다음 에러를 분석하고 수정해주세요:\n\n${lastConsoleError}`);
                  setShowConsoleErrorNotification(false);
                  // 입력창에 포커스
                  const textarea = document.querySelector('.jp-agent-input') as HTMLTextAreaElement;
                  if (textarea) textarea.focus();
                }}
              >
                에러 분석 요청
              </button>
              <button
                className="jp-agent-console-error-dismiss-btn"
                onClick={() => setShowConsoleErrorNotification(false)}
              >
                닫기
              </button>
            </div>
          </div>
        )}

        {/* 파일 수정 적용 버튼 영역 */}
        {pendingFileFixes.length > 0 && (
          <div className="jp-agent-file-fixes">
            <div className="jp-agent-file-fixes-header">
              <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
                <path d="M14 1H2a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1V2a1 1 0 00-1-1zM2 0a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V2a2 2 0 00-2-2H2z"/>
                <path d="M9.5 5a.5.5 0 00-1 0v3.793L6.854 7.146a.5.5 0 10-.708.708l2.5 2.5a.5.5 0 00.708 0l2.5-2.5a.5.5 0 00-.708-.708L9.5 8.793V5z"/>
              </svg>
              <span>수정된 파일 ({pendingFileFixes.length}개)</span>
            </div>
            <div className="jp-agent-file-fixes-list">
              {pendingFileFixes.map((fix, index) => (
                <div key={index} className="jp-agent-file-fix-item">
                  <div className="jp-agent-file-fix-info">
                    <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
                      <path d="M4 0a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V4.5L9.5 0H4zm5.5 1.5v2a1 1 0 001 1h2l-3-3zM4.5 8a.5.5 0 010 1h7a.5.5 0 010-1h-7zm0 2a.5.5 0 010 1h7a.5.5 0 010-1h-7zm0 2a.5.5 0 010 1h4a.5.5 0 010-1h-4z"/>
                    </svg>
                    <span className="jp-agent-file-fix-path">{fix.path}</span>
                  </div>
                  <button
                    className="jp-agent-file-fix-apply"
                    onClick={() => applyFileFix(fix)}
                    title={`${fix.path} 파일에 수정 적용`}
                  >
                    적용하기
                  </button>
                </div>
              ))}
            </div>
            <button
              className="jp-agent-file-fixes-dismiss"
              onClick={() => setPendingFileFixes([])}
              title="수정 제안 닫기"
            >
              닫기
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Compact Todo Progress - Above Input */}
      {todos.length > 0 && (
        <div className="jp-agent-todo-compact">
          <div
            className="jp-agent-todo-compact-header"
            onClick={() => setIsTodoExpanded(!isTodoExpanded)}
          >
            <div className="jp-agent-todo-compact-left">
              <svg
                className={`jp-agent-todo-expand-icon ${isTodoExpanded ? 'jp-agent-todo-expand-icon--expanded' : ''}`}
                viewBox="0 0 16 16"
                fill="currentColor"
                width="12"
                height="12"
              >
                <path d="M6 12l4-4-4-4" />
              </svg>
              {(() => {
                const currentTodo = todos.find(t => t.status === 'in_progress') || todos.find(t => t.status === 'pending');
                const isStillWorking = isStreaming || isLoading || isAgentRunning;
                
                if (currentTodo) {
                  return (
                    <>
                      <div className="jp-agent-todo-compact-spinner" />
                      <span className="jp-agent-todo-compact-current">{currentTodo.content}</span>
                    </>
                  );
                } else if (isStillWorking) {
                  return (
                    <>
                      <div className="jp-agent-todo-compact-spinner" />
                      <span className="jp-agent-todo-compact-current">작업 마무리 중...</span>
                    </>
                  );
                } else {
                  return (
                    <span className="jp-agent-todo-compact-current">✓ 모든 작업 완료</span>
                  );
                }
              })()}
            </div>
            <span className="jp-agent-todo-compact-progress">
              {todos.filter(t => t.status === 'completed').length}/{todos.length}
            </span>
          </div>

          {statusText && hasActiveTodos && (
            <div
              className={`jp-agent-message jp-agent-message-debug jp-agent-message-debug--inline${
                statusText.startsWith('오류:') ? ' jp-agent-message-debug-error' : ''
              }`}
            >
              <div className="jp-agent-debug-content">
                <div className="jp-agent-debug-branch" aria-hidden="true" />
                <span className="jp-agent-debug-text">{statusText}</span>
                {!statusText.startsWith('오류:') && (
                  <span className="jp-agent-debug-ellipsis" aria-hidden="true" />
                )}
              </div>
            </div>
          )}

          {/* Expanded Todo List */}
          {isTodoExpanded && (
            <div className="jp-agent-todo-expanded">
              {todos.map((todo, index) => (
                <div
                  key={index}
                  className={`jp-agent-todo-item jp-agent-todo-item--${todo.status}`}
                >
                  <div className="jp-agent-todo-item-indicator">
                    {todo.status === 'completed' && (
                      <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
                        <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
                      </svg>
                    )}
                    {todo.status === 'in_progress' && <div className="jp-agent-todo-item-spinner" />}
                    {todo.status === 'pending' && <span className="jp-agent-todo-item-number">{index + 1}</span>}
                  </div>
                  <span className={`jp-agent-todo-item-text ${todo.status === 'completed' ? 'jp-agent-todo-item-text--done' : ''}`}>
                    {todo.content}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {statusText && !hasActiveTodos && (
        <div
          className={`jp-agent-message jp-agent-message-debug jp-agent-message-debug--above-input${
            statusText.startsWith('오류:') ? ' jp-agent-message-debug-error' : ''
          }`}
        >
          <div className="jp-agent-debug-content">
            <span className="jp-agent-debug-text">{statusText}</span>
            {!statusText.startsWith('오류:') && (
              <span className="jp-agent-debug-ellipsis" aria-hidden="true" />
            )}
          </div>
        </div>
      )}

      {/* Unified Input Container - Cursor AI Style */}
      <div className="jp-agent-input-container">
        <div className="jp-agent-input-wrapper">
          <textarea
            className={`jp-agent-input ${inputMode === 'agent' ? 'jp-agent-input--agent-mode' : ''} ${isRejectionMode ? 'jp-agent-input--rejection-mode' : ''}`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isRejectionMode
              ? '다른 방향 제시'
              : (inputMode === 'agent'
                ? '노트북 작업을 입력하세요... (예: 데이터 시각화 해줘)'
                : '메시지를 입력하세요...')
            }
            rows={3}
            disabled={isLoading || isAgentRunning}
          />
          <button
            className="jp-agent-send-button"
            onClick={handleSendMessage}
            disabled={(!input.trim() && !isRejectionMode) || isLoading || isStreaming || isAgentRunning}
            title={isRejectionMode ? "거부 전송 (Enter)" : "전송 (Enter)"}
          >
            {isAgentRunning ? '실행 중...' : (isRejectionMode ? '거부' : '전송')}
          </button>
        </div>

        {/* Mode Toggle Bar - Cursor AI Style */}
        <div className="jp-agent-mode-bar">
          <div className="jp-agent-mode-toggle-container">
            <button
              className={`jp-agent-mode-toggle ${inputMode === 'agent' ? 'jp-agent-mode-toggle--active' : ''}`}
              onClick={toggleMode}
              title={`${inputMode === 'agent' ? 'Agent' : 'Chat'} 모드 (⇧Tab)`}
            >
              {/* Agent 아이콘 */}
              <svg className="jp-agent-mode-icon" viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
                {inputMode === 'agent' ? (
                  // 무한대 아이콘 (Agent 모드)
                  <path d="M4.5 8c0-1.38 1.12-2.5 2.5-2.5.9 0 1.68.48 2.12 1.2L8 8l1.12 1.3c-.44.72-1.22 1.2-2.12 1.2-1.38 0-2.5-1.12-2.5-2.5zm6.88 1.3c.44-.72 1.22-1.2 2.12-1.2 1.38 0 2.5 1.12 2.5 2.5s-1.12 2.5-2.5 2.5c-.9 0-1.68-.48-2.12-1.2L12.5 10.6c.3.24.68.4 1.1.4.83 0 1.5-.67 1.5-1.5S14.43 8 13.6 8c-.42 0-.8.16-1.1.4l-1.12 1.3zM7 9.5c-.42 0-.8-.16-1.1-.4L4.78 7.8c-.44.72-1.22 1.2-2.12 1.2C1.28 9 .17 7.88.17 6.5S1.29 4 2.67 4c.9 0 1.68.48 2.12 1.2L5.9 6.5c-.3-.24-.68-.4-1.1-.4C3.97 6.1 3.3 6.77 3.3 7.6s.67 1.5 1.5 1.5c.42 0 .8-.16 1.1-.4l1.12-1.3L8 8l-1 1.5z"/>
                ) : (
                  // 채팅 아이콘 (Chat 모드)
                  <path d="M8 1C3.58 1 0 4.13 0 8c0 1.5.5 2.88 1.34 4.04L.5 15l3.37-.92A8.56 8.56 0 008 15c4.42 0 8-3.13 8-7s-3.58-7-8-7zM4.5 9a1 1 0 110-2 1 1 0 010 2zm3.5 0a1 1 0 110-2 1 1 0 010 2zm3.5 0a1 1 0 110-2 1 1 0 010 2z"/>
                )}
              </svg>
              <span className="jp-agent-mode-label">
                {inputMode === 'agent' ? 'Agent' : 'Chat'}
              </span>
              <svg className="jp-agent-mode-chevron" viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
                <path d="M4.47 5.47a.75.75 0 011.06 0L8 7.94l2.47-2.47a.75.75 0 111.06 1.06l-3 3a.75.75 0 01-1.06 0l-3-3a.75.75 0 010-1.06z"/>
              </svg>
            </button>

            {/* Mode Dropdown */}
            {showModeDropdown && (
              <div className="jp-agent-mode-dropdown">
                <button
                  className={`jp-agent-mode-option ${inputMode === 'chat' ? 'jp-agent-mode-option--selected' : ''}`}
                  onClick={() => { setInputMode('chat'); setShowModeDropdown(false); }}
                >
                  <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
                    <path d="M8 1C3.58 1 0 4.13 0 8c0 1.5.5 2.88 1.34 4.04L.5 15l3.37-.92A8.56 8.56 0 008 15c4.42 0 8-3.13 8-7s-3.58-7-8-7zM4.5 9a1 1 0 110-2 1 1 0 010 2zm3.5 0a1 1 0 110-2 1 1 0 010 2zm3.5 0a1 1 0 110-2 1 1 0 010 2z"/>
                  </svg>
                  <span>Chat</span>
                  <span className="jp-agent-mode-shortcut">일반 대화</span>
                </button>
                <button
                  className={`jp-agent-mode-option ${inputMode === 'agent' ? 'jp-agent-mode-option--selected' : ''}`}
                  onClick={() => { setInputMode('agent'); setShowModeDropdown(false); }}
                >
                  <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
                    <path d="M4.5 8c0-1.38 1.12-2.5 2.5-2.5.9 0 1.68.48 2.12 1.2L8 8l1.12 1.3c-.44.72-1.22 1.2-2.12 1.2-1.38 0-2.5-1.12-2.5-2.5z"/>
                  </svg>
                  <span>Agent</span>
                  <span className="jp-agent-mode-shortcut">노트북 자동 실행</span>
                </button>
              </div>
            )}
          </div>

          {/* 단축키 힌트 */}
          <div className="jp-agent-mode-hints">
            <span className="jp-agent-mode-hint">⇧Tab 모드 전환</span>
          </div>
        </div>
      </div>

      {/* File Selection Dialog */}
      {fileSelectionMetadata && (
        <FileSelectionDialog
          filename={fileSelectionMetadata.pattern}
          options={fileSelectionMetadata.options}
          message={fileSelectionMetadata.message}
          onSelect={handleFileSelect}
          onCancel={handleFileSelectCancel}
        />
      )}
    </div>
  );
});

ChatPanel.displayName = 'ChatPanel';

/**
 * Agent Panel Widget
 */
export class AgentPanelWidget extends ReactWidget {
  private apiService: ApiService;
  private notebookTracker: any;
  private consoleTracker: any;
  private chatPanelRef = React.createRef<ChatPanelHandle>();

  constructor(apiService: ApiService, notebookTracker?: any, consoleTracker?: any) {
    super();
    this.apiService = apiService;
    this.notebookTracker = notebookTracker;
    this.consoleTracker = consoleTracker;
    this.id = 'hdsp-agent-panel';
    this.title.caption = 'HDSP Agent Assistant';
    this.title.icon = hdspTabIcon;
    this.addClass('jp-agent-widget');
  }

  render(): JSX.Element {
    return (
      <ChatPanel
        ref={this.chatPanelRef}
        apiService={this.apiService}
        notebookTracker={this.notebookTracker}
        consoleTracker={this.consoleTracker}
      />
    );
  }

  /**
   * Add a message from cell action
   * @param action - The action type (explain, fix, custom_prompt)
   * @param cellContent - The cell content
   * @param displayPrompt - The user-facing prompt to show in the UI
   * @param llmPrompt - The actual prompt to send to the LLM
   * @param cellId - The cell ID for applying code (optional)
   * @param cellIndex - The cell index (0-based) for applying code (optional)
   */
  addCellActionMessage(
    action: string,
    cellContent: string,
    displayPrompt: string,
    llmPrompt: string,
    cellId?: string,
    cellIndex?: number
  ): void {
    console.log('[AgentPanel] Cell action:', action);
    console.log('[AgentPanel] Display prompt:', displayPrompt);
    console.log('[AgentPanel] LLM prompt:', llmPrompt);
    console.log('[AgentPanel] Cell ID:', cellId);
    console.log('[AgentPanel] Cell Index:', cellIndex);

    if (!this.chatPanelRef.current) {
      console.error('[AgentPanel] ChatPanel ref not available');
      return;
    }

    // E, F, ? 버튼 클릭 시 항상 일반 대화(chat) 모드로 전환
    if (this.chatPanelRef.current.setInputMode) {
      this.chatPanelRef.current.setInputMode('chat');
    }

    // Store cell index for code application (preferred method)
    if (cellIndex !== undefined && this.chatPanelRef.current.setCurrentCellIndex) {
      this.chatPanelRef.current.setCurrentCellIndex(cellIndex);
    }

    // Store cell ID for code application (fallback)
    if (cellId && this.chatPanelRef.current.setCurrentCellId) {
      this.chatPanelRef.current.setCurrentCellId(cellId);
    }

    // Set the display prompt in the input field
    this.chatPanelRef.current.setInput(displayPrompt);

    // Store the LLM prompt
    this.chatPanelRef.current.setLlmPrompt(llmPrompt);

    // Automatically execute after a short delay to ensure state is updated
    setTimeout(() => {
      if (this.chatPanelRef.current) {
        this.chatPanelRef.current.handleSendMessage().catch(error => {
          console.error('[AgentPanel] Failed to send message automatically:', error);
        });
      }
    }, 100);
  }

  /**
   * Analyze entire notebook before saving
   * @param cells - Array of collected cells with content, output, and imports
   * @param onComplete - Callback to execute after analysis (perform save)
   */
  analyzeNotebook(cells: any[], onComplete: () => void): void {
    console.log('[AgentPanel] analyzeNotebook called with', cells.length, 'cells');

    if (!this.chatPanelRef.current) {
      console.error('[AgentPanel] ChatPanel ref not available');
      onComplete();
      return;
    }

    // 저장 시 검수도 항상 일반 대화(chat) 모드로 전환
    if (this.chatPanelRef.current.setInputMode) {
      this.chatPanelRef.current.setInputMode('chat');
    }

    // Create summary of notebook
    const totalCells = cells.length;
    const cellsWithErrors = cells.filter(cell =>
      cell.output && (
        cell.output.includes('Error') ||
        cell.output.includes('Traceback') ||
        cell.output.includes('Exception')
      )
    ).length;
    const cellsWithImports = cells.filter(cell => cell.imports && cell.imports.length > 0).length;
    const localImports = cells.reduce((acc, cell) => {
      if (cell.imports) {
        return acc + cell.imports.filter((imp: any) => imp.isLocal).length;
      }
      return acc;
    }, 0);

    // Create display prompt
    const displayPrompt = `전체 노트북 검수 요청 (${totalCells}개 셀)`;

    // Create detailed LLM prompt with all cells
    let llmPrompt = `다음은 저장하기 전의 Jupyter 노트북 전체 내용입니다. 모든 셀을 검토하고 개선 사항을 제안해주세요.

## 노트북 요약
- 전체 셀 수: ${totalCells}개
- 에러가 있는 셀: ${cellsWithErrors}개
- Import가 있는 셀: ${cellsWithImports}개
- 로컬 모듈 import: ${localImports}개

## 전체 셀 내용

`;

    cells.forEach((cell, index) => {
      llmPrompt += `### 셀 ${index + 1} (ID: ${cell.id})
\`\`\`python
${cell.content}
\`\`\`
`;

      if (cell.output) {
        llmPrompt += `
**실행 결과:**
\`\`\`
${cell.output}
\`\`\`
`;
      }

      if (cell.imports && cell.imports.length > 0) {
        llmPrompt += `
**Imports:**
`;
        cell.imports.forEach((imp: any) => {
          llmPrompt += `- \`${imp.module}\` (${imp.isLocal ? '로컬' : '표준 라이브러리'})\n`;
        });
      }

      llmPrompt += '\n---\n\n';
    });

    llmPrompt += `
## 검수 요청 사항

다음 형식으로 응답해주세요:

### 1. 전반적인 코드 품질 평가
(노트북 전체의 코드 품질, 구조, 일관성 등을 평가)

### 2. 발견된 주요 이슈
(에러, 경고, 잠재적 문제점 등을 나열)

### 3. 셀별 개선 제안
각 셀에 대해 구체적인 개선 사항이 있다면:
- **셀 X**: (개선 사항)
  \`\`\`python
  (개선된 코드)
  \`\`\`

### 4. 전반적인 개선 권장사항
(노트북 전체를 개선하기 위한 일반적인 제안)

### 5. 저장 권장 여부
- ✅ **저장 권장**: (이유)
- ⚠️ **수정 후 저장 권장**: (이유)
- ❌ **저장 비권장**: (이유)
`;

    // Set the display prompt in the input field
    this.chatPanelRef.current.setInput(displayPrompt);

    // Store the LLM prompt
    this.chatPanelRef.current.setLlmPrompt(llmPrompt);

    // Automatically execute after a short delay to ensure state is updated
    setTimeout(() => {
      if (this.chatPanelRef.current) {
        this.chatPanelRef.current.handleSendMessage().catch(error => {
          console.error('[AgentPanel] Failed to send message automatically:', error);
        }).finally(() => {
          // Store the onComplete callback to be executed after user reviews the analysis
          // For now, we'll execute it immediately
          // TODO: Add UI button to allow user to review and then save
          console.log('[AgentPanel] Analysis complete, executing onComplete callback');
          onComplete();
        });
      }
    }, 100);
  }
}
