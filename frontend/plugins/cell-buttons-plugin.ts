/**
 * Cell Buttons Plugin
 * Injects E, F, ? action buttons into notebook cells
 * Communicates with sidebar panel instead of Chrome extension
 */

import { INotebookTracker } from '@jupyterlab/notebook';
import { Cell } from '@jupyterlab/cells';
import { CellAction } from '../types';

/**
 * Cell Buttons Plugin
 */
export const cellButtonsPlugin = {
  id: '@hdsp-agent/cell-buttons',
  autoStart: true,
  requires: [INotebookTracker],
  activate: (app: any, notebookTracker: INotebookTracker) => {
    console.log('[CellButtonsPlugin] Activated');

    // Store app reference globally for later use
    (window as any).jupyterapp = app;

    // Handle new notebooks
    notebookTracker.widgetAdded.connect((sender, panel) => {
      console.log('[CellButtonsPlugin] Notebook widget added:', panel.id);

      // Wait for session to be ready
      panel.sessionContext.ready.then(() => {
        observeNotebook(panel);
      }).catch(err => {
        console.error('[CellButtonsPlugin] Error waiting for session:', err);
      });
    });

    // Handle current notebook if exists
    if (notebookTracker.currentWidget) {
      observeNotebook(notebookTracker.currentWidget);
    }

    // Handle notebook focus changes
    notebookTracker.currentChanged.connect((sender, panel) => {
      if (panel) {
        observeNotebook(panel);
      }
    });
  }
};

/**
 * Observe a notebook for cell changes and inject buttons
 */
function observeNotebook(panel: any): void {
  const notebook = panel.content;

  // Initial injection with delay to ensure cells are rendered
  setTimeout(() => {
    injectButtonsIntoAllCells(notebook, panel);
    // Retry after longer delay for cells that weren't ready
    setTimeout(() => {
      injectButtonsIntoAllCells(notebook, panel);
    }, 500);
  }, 200);

  // Watch for cell changes (add/remove/reorder)
  const cellsChangedHandler = () => {
    setTimeout(() => {
      injectButtonsIntoAllCells(notebook, panel);
    }, 100);
  };

  // Remove any previous listeners to avoid duplicates
  try {
    notebook.model?.cells.changed.disconnect(cellsChangedHandler);
  } catch {
    // Ignore if not connected
  }

  // Connect new listener
  notebook.model?.cells.changed.connect(cellsChangedHandler);
}

/**
 * Inject buttons into all cells in a notebook
 */
function injectButtonsIntoAllCells(notebook: any, panel: any): void {
  for (let i = 0; i < notebook.widgets.length; i++) {
    const cell = notebook.widgets[i];
    injectButtonsIntoCell(cell, panel);
  }
}

/**
 * Inject buttons into a single cell
 * Buttons are placed outside the cell (above), aligned with code start position
 */
function injectButtonsIntoCell(cell: Cell, panel: any): void {
  // Safety checks
  if (!cell || !cell.model) {
    return;
  }

  const cellNode = cell.node;
  if (!cellNode || !cellNode.classList.contains('jp-Cell')) {
    return;
  }

  // Check if buttons already exist (using our unique class name)
  if (cellNode.querySelector('.jp-hdsp-cell-buttons')) {
    return;
  }

  // Find the prompt area to get the correct left offset
  const promptNode = cellNode.querySelector('.jp-InputPrompt, .jp-OutputPrompt');
  const promptWidth = promptNode ? promptNode.getBoundingClientRect().width : 64;

  // Find the input wrapper to insert before
  const inputWrapper = cellNode.querySelector('.jp-Cell-inputWrapper');
  if (!inputWrapper) {
    return;
  }

  // Create button container with unique class name to avoid conflicts
  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'jp-hdsp-cell-buttons';
  buttonContainer.style.cssText = `
    display: flex;
    gap: 4px;
    padding: 4px 8px;
    padding-left: ${promptWidth}px;
    background: transparent;
  `;

  // Create E button (Explain)
  const explainBtn = createButton('E', '설명 요청', () => {
    handleCellAction(CellAction.EXPLAIN, cell);
  });

  // Create F button (Fix)
  const fixBtn = createButton('F', '수정 제안 요청', () => {
    handleCellAction(CellAction.FIX, cell);
  });

  // Create ? button (Custom Prompt)
  const customBtn = createButton('?', '질문하기', () => {
    handleCellAction(CellAction.CUSTOM_PROMPT, cell);
  });

  buttonContainer.appendChild(explainBtn);
  buttonContainer.appendChild(fixBtn);
  buttonContainer.appendChild(customBtn);

  // Insert before the input wrapper (outside the cell, above it)
  inputWrapper.parentNode?.insertBefore(buttonContainer, inputWrapper);
}

/**
 * Create a button element
 */
function createButton(
  label: string,
  title: string,
  onClick: () => void
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'jp-agent-button';
  btn.textContent = label;
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.onclick = onClick;

  // Add inline styles as fallback
  btn.style.cssText = `
    width: 24px !important;
    height: 24px !important;
    border: 1px solid #ddd !important;
    border-radius: 4px !important;
    background: white !important;
    cursor: pointer !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    font-size: 12px !important;
    font-weight: bold !important;
    color: #333 !important;
    padding: 0 !important;
    margin: 0 2px !important;
    opacity: 1 !important;
    visibility: visible !important;
  `;

  return btn;
}

/**
 * Handle cell action button click
 */
async function handleCellAction(action: CellAction, cell: Cell): Promise<void> {
  const cellContent = cell.model.sharedModel.getSource();

  if (!cellContent.trim()) {
    showNotification('셀 내용이 비어있습니다.', 'warning');
    return;
  }

  const cellIndex = getCellIndex(cell);

  if (action === CellAction.CUSTOM_PROMPT) {
    // For custom prompt, show dialog (no confirmation needed)
    showCustomPromptDialog(cell);
  } else {
    // Get cell output
    const cellOutput = getCellOutput(cell);

    // Determine confirmation dialog content based on action
    let title = '';
    let message = '';

    switch (action) {
      case CellAction.EXPLAIN:
        title = `셀 ${cellIndex}번째: 설명 요청`;
        message = '이 셀의 코드 설명을 보시겠습니까?';
        break;
      case CellAction.FIX:
        title = `셀 ${cellIndex}번째: 수정 제안 요청`;
        message = '이 셀의 코드 개선 제안을 받으시겠습니까?';
        break;
    }

    // Show confirmation dialog first
    const confirmed = await showConfirmDialog(title, message);

    if (confirmed) {
      // User confirmed, send to sidebar panel
      sendToSidebarPanel(action, cell, cellContent, cellIndex, cellOutput);
    }
  }
}

/**
 * Get the index of a cell in the notebook
 */
function getCellIndex(cell: Cell): number {
  const app = (window as any).jupyterapp;
  const notebookTracker = app?.shell?.currentWidget?.content;

  if (!notebookTracker) {
    return -1;
  }

  const widgets = notebookTracker.widgets;
  for (let i = 0; i < widgets.length; i++) {
    if (widgets[i] === cell) {
      return i + 1; // Return 1-based index
    }
  }

  return -1;
}

/**
 * Extract output from a code cell
 */
function getCellOutput(cell: Cell): string {
  if (cell.model.type !== 'code') {
    return '';
  }

  const codeCell = cell as any;
  const outputs = codeCell.model.outputs;

  if (!outputs || outputs.length === 0) {
    return '';
  }

  const outputTexts: string[] = [];

  for (let i = 0; i < outputs.length; i++) {
    const output = outputs.get(i);
    const outputType = output.type;

    if (outputType === 'stream') {
      // stdout, stderr
      const text = output.text;
      if (Array.isArray(text)) {
        outputTexts.push(text.join(''));
      } else {
        outputTexts.push(text);
      }
    } else if (outputType === 'execute_result' || outputType === 'display_data') {
      // Execution results or display data
      const data = output.data;
      if (data['text/plain']) {
        const text = data['text/plain'];
        if (Array.isArray(text)) {
          outputTexts.push(text.join(''));
        } else {
          outputTexts.push(text);
        }
      }
    } else if (outputType === 'error') {
      // Error output
      const traceback = output.traceback;
      if (Array.isArray(traceback)) {
        outputTexts.push(traceback.join('\n'));
      }
    }
  }

  return outputTexts.join('\n');
}

/**
 * Get or assign cell ID to a cell
 */
function getOrAssignCellId(cell: Cell): string {
  const cellModel = cell.model;
  let cellId: string | undefined;
  
  // Try to get cell ID from metadata
  try {
    if (cellModel.metadata && typeof (cellModel.metadata as any).get === 'function') {
      cellId = (cellModel.metadata as any).get('jupyterAgentCellId') as string | undefined;
    } else if ((cellModel.metadata as any)?.jupyterAgentCellId) {
      cellId = (cellModel.metadata as any).jupyterAgentCellId;
    }
  } catch (e) {
    // Ignore errors
  }
  
  if (!cellId) {
    cellId = `cell-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    // Try to set cell ID in metadata
    try {
      if (cellModel.metadata && typeof (cellModel.metadata as any).set === 'function') {
        (cellModel.metadata as any).set('jupyterAgentCellId', cellId);
      } else if (cellModel.metadata) {
        (cellModel.metadata as any).jupyterAgentCellId = cellId;
      }
    } catch (e) {
      // Ignore errors
    }
  }
  
  return cellId;
}

/**
 * Send cell action to sidebar panel
 */
function sendToSidebarPanel(
  action: CellAction,
  cell: Cell,
  cellContent: string,
  cellIndex: number,
  cellOutput: string
): void {
  const agentPanel = (window as any)._hdspAgentPanel;

  if (!agentPanel) {
    console.error('[CellButtonsPlugin] Agent panel not found. Make sure sidebar plugin is loaded.');
    return;
  }

  // Get or assign cell ID
  const cellId = getOrAssignCellId(cell);

  // Activate the sidebar panel
  const app = (window as any).jupyterapp;
  if (app) {
    app.shell.activateById(agentPanel.id);
  }

  // Create user-facing display prompt
  let displayPrompt = '';
  // Create actual LLM prompt (based on chrome_agent)
  // Note: Use original content, not escaped. JSON.stringify will handle escaping.
  let llmPrompt = '';

  switch (action) {
    case CellAction.EXPLAIN:
      // User sees: "Cell x: 설명 요청" (chrome_agent와 동일)
      displayPrompt = `${cellIndex}번째 셀: 설명 요청`;

      // LLM receives: chrome_agent와 동일한 프롬프트
      llmPrompt = `다음 Jupyter 셀의 내용을 자세히 설명해주세요:

\`\`\`python
${cellContent}
\`\`\``;
      break;

    case CellAction.FIX:
      // Check if there's an error in the output
      const hasError = cellOutput && (
        cellOutput.includes('Error') ||
        cellOutput.includes('Traceback') ||
        cellOutput.includes('Exception') ||
        cellOutput.includes('에러') ||
        cellOutput.includes('오류')
      );

      if (hasError && cellOutput) {
        // 에러가 있는 경우 (chrome_agent와 동일)
        displayPrompt = `${cellIndex}번째 셀: 에러 수정 요청`;

        llmPrompt = `다음 Jupyter 셀 코드에 에러가 발생했습니다.

원본 코드:
\`\`\`python
${cellContent}
\`\`\`

에러:
\`\`\`
${cellOutput}
\`\`\`

다음 형식으로 응답해주세요:

## 에러 원인
(에러가 발생한 원인을 간단히 설명)

## 수정 방법

### 방법 1: (수정 방법 제목)
(이 방법에 대한 간단한 설명)
\`\`\`python
(수정된 코드)
\`\`\`

### 방법 2: (수정 방법 제목)
(이 방법에 대한 간단한 설명)
\`\`\`python
(수정된 코드)
\`\`\`

### 방법 3: (수정 방법 제목) (있는 경우)
(이 방법에 대한 간단한 설명)
\`\`\`python
(수정된 코드)
\`\`\`

최소 2개, 최대 3개의 다양한 수정 방법을 제안해주세요.`;
      } else {
        // 에러가 없는 경우 - 코드 리뷰/개선 제안 (chrome_agent와 동일)
        displayPrompt = `${cellIndex}번째 셀: 개선 제안 요청`;

        llmPrompt = `다음 Jupyter 셀 코드를 리뷰하고 개선 방법을 제안해주세요.

코드:
\`\`\`python
${cellContent}
\`\`\`

다음 형식으로 응답해주세요:

## 코드 분석
(현재 코드의 기능과 특징을 간단히 설명)

## 개선 방법

### 방법 1: (개선 방법 제목)
(이 방법에 대한 간단한 설명)
\`\`\`python
(개선된 코드)
\`\`\`

### 방법 2: (개선 방법 제목)
(이 방법에 대한 간단한 설명)
\`\`\`python
(개선된 코드)
\`\`\`

### 방법 3: (개선 방법 제목) (있는 경우)
(이 방법에 대한 간단한 설명)
\`\`\`python
(개선된 코드)
\`\`\`

최소 2개, 최대 3개의 다양한 개선 방법을 제안해주세요.`;
      }
      break;
  }

  // Send both prompts to panel with cell ID and cell index
  if (agentPanel.addCellActionMessage) {
    // cellIndex is 1-based (for display), convert to 0-based for array access
    const cellIndexZeroBased = cellIndex - 1;
    agentPanel.addCellActionMessage(action, cellContent, displayPrompt, llmPrompt, cellId, cellIndexZeroBased);
  }
}

/**
 * Show confirmation dialog
 * Based on chrome_agent's showConfirmDialog implementation
 */
function showConfirmDialog(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Remove existing dialog if any
    const existingDialog = document.querySelector('.jp-agent-confirm-dialog');
    if (existingDialog) {
      existingDialog.remove();
    }

    // Create dialog overlay
    const dialogOverlay = document.createElement('div');
    dialogOverlay.className = 'jp-agent-confirm-dialog';
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
      max-width: 400px;
      width: 90%;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    // Dialog content
    dialogContainer.innerHTML = `
      <div style="margin-bottom: 20px;">
        <h3 style="margin: 0 0 12px 0; color: #424242; font-size: 16px; font-weight: 500;">
          ${escapeHtml(title)}
        </h3>
        <p style="margin: 0; color: #616161; font-size: 14px; line-height: 1.5;">
          ${escapeHtml(message)}
        </p>
      </div>
      <div style="display: flex; gap: 12px; justify-content: flex-end;">
        <button class="jp-agent-confirm-cancel-btn" style="
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
        <button class="jp-agent-confirm-submit-btn" style="
          background: #1976d2;
          color: white;
          border: 1px solid #1976d2;
          border-radius: 3px;
          padding: 8px 16px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        ">확인</button>
      </div>
    `;

    dialogOverlay.appendChild(dialogContainer);
    document.body.appendChild(dialogOverlay);

    // Button event listeners
    const cancelBtn = dialogContainer.querySelector('.jp-agent-confirm-cancel-btn') as HTMLButtonElement;
    const submitBtn = dialogContainer.querySelector('.jp-agent-confirm-submit-btn') as HTMLButtonElement;

    // Cancel button
    cancelBtn.addEventListener('click', () => {
      dialogOverlay.remove();
      resolve(false);
    });

    cancelBtn.addEventListener('mouseenter', () => {
      cancelBtn.style.background = '#f5f5f5';
    });

    cancelBtn.addEventListener('mouseleave', () => {
      cancelBtn.style.background = 'transparent';
    });

    // Submit button
    submitBtn.addEventListener('click', () => {
      submitBtn.disabled = true;
      submitBtn.textContent = '처리 중...';
      
      // Small delay to show processing state
      setTimeout(() => {
        dialogOverlay.remove();
        resolve(true);
      }, 100);
    });

    submitBtn.addEventListener('mouseenter', () => {
      if (!submitBtn.disabled) {
        submitBtn.style.background = '#1565c0';
      }
    });

    submitBtn.addEventListener('mouseleave', () => {
      if (!submitBtn.disabled) {
        submitBtn.style.background = '#1976d2';
      }
    });

    // ESC key to close
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dialogOverlay.remove();
        document.removeEventListener('keydown', handleEsc);
        resolve(false);
      }
    };
    document.addEventListener('keydown', handleEsc);

    // Close on overlay click
    dialogOverlay.addEventListener('click', (e) => {
      if (e.target === dialogOverlay) {
        dialogOverlay.remove();
        document.removeEventListener('keydown', handleEsc);
        resolve(false);
      }
    });
  });
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Escape content for markdown code blocks
 * Based on chrome_agent's escapeContent function
 */
function escapeContent(content: string): string {
  if (!content) return '';

  // 백슬래시를 먼저 escape (다른 escape 처리 전에 수행)
  let escaped = content.replace(/\\/g, '\\\\');

  // 백틱 escape (마크다운 코드 블록 안에서 문제 방지)
  escaped = escaped.replace(/`/g, '\\`');

  return escaped;
}

/**
 * Show notification (simple implementation)
 */
function showNotification(message: string, type: 'info' | 'warning' | 'error' = 'info'): void {
  // Simple notification implementation
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
  `;

  if (type === 'error') {
    notification.style.background = '#f56565';
  } else if (type === 'warning') {
    notification.style.background = '#ed8936';
  } else {
    notification.style.background = '#4299e1';
  }

  notification.textContent = message;
  document.body.appendChild(notification);

  // Show animation
  setTimeout(() => {
    notification.style.opacity = '1';
  }, 10);

  // Remove after 3 seconds
  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 3000);
}

/**
 * Show custom prompt dialog
 * Based on chrome_agent's showCustomPromptDialog implementation
 */
function showCustomPromptDialog(cell: Cell): void {
  const cellContent = cell.model.sharedModel.getSource();
  const cellIndex = getCellIndex(cell);
  const cellId = getOrAssignCellId(cell);

  console.log('커스텀 프롬프트 다이얼로그 표시', cellIndex, cellId);

  // 기존 다이얼로그가 있으면 제거
  const existingDialog = document.querySelector('.jp-agent-custom-prompt-dialog');
  if (existingDialog) {
    existingDialog.remove();
  }

  // 다이얼로그 오버레이 생성
  const dialogOverlay = document.createElement('div');
  dialogOverlay.className = 'jp-agent-custom-prompt-dialog';
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

  // 다이얼로그 컨테이너 생성
  const dialogContainer = document.createElement('div');
  dialogContainer.style.cssText = `
    background: #fafafa;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    padding: 24px;
    max-width: 500px;
    width: 90%;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;

  // 다이얼로그 내용
  dialogContainer.innerHTML = `
    <div style="margin-bottom: 20px;">
      <h3 style="margin: 0 0 8px 0; color: #424242; font-size: 16px; font-weight: 500;">
        셀에 대해 질문하기
      </h3>
      <p style="margin: 0; color: #757575; font-size: 13px;">
        물리적 위치: 셀 ${cellIndex + 1}번째 (위에서 아래로 카운트)
      </p>
    </div>
    <div style="margin-bottom: 20px;">
      <textarea class="jp-agent-custom-prompt-input"
        placeholder="이 셀에 대해 질문할 내용을 입력하세요..."
        style="
          width: 100%;
          min-height: 100px;
          padding: 12px;
          border: 1px solid #d1d5db;
          border-radius: 4px;
          font-size: 14px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          resize: vertical;
          box-sizing: border-box;
        "
      ></textarea>
    </div>
    <div style="display: flex; gap: 12px; justify-content: flex-end;">
      <button class="jp-agent-custom-prompt-cancel-btn" style="
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
      <button class="jp-agent-custom-prompt-submit-btn" style="
        background: transparent;
        color: #1976d2;
        border: 1px solid #1976d2;
        border-radius: 3px;
        padding: 8px 16px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
      ">질문</button>
    </div>
  `;

  dialogOverlay.appendChild(dialogContainer);
  document.body.appendChild(dialogOverlay);

  // 입력 필드에 포커스
  const inputField = dialogContainer.querySelector('.jp-agent-custom-prompt-input') as HTMLTextAreaElement;
  setTimeout(() => inputField?.focus(), 100);

  // 버튼 이벤트 리스너
  const cancelBtn = dialogContainer.querySelector('.jp-agent-custom-prompt-cancel-btn') as HTMLButtonElement;
  const submitBtn = dialogContainer.querySelector('.jp-agent-custom-prompt-submit-btn') as HTMLButtonElement;

  // 취소 버튼
  cancelBtn.addEventListener('click', () => {
    dialogOverlay.remove();
  });

  cancelBtn.addEventListener('mouseenter', () => {
    cancelBtn.style.background = '#f5f5f5';
    cancelBtn.style.borderColor = '#9ca3af';
  });

  cancelBtn.addEventListener('mouseleave', () => {
    cancelBtn.style.background = 'transparent';
    cancelBtn.style.borderColor = '#d1d5db';
  });

  // 제출 버튼
  const handleSubmit = async () => {
    const promptText = inputField?.value.trim() || '';

    if (!promptText) {
      showNotification('질문 내용을 입력해주세요.', 'warning');
      return;
    }

    dialogOverlay.remove();

    // Get cell output
    const cellOutput = getCellOutput(cell);

    // Create display prompt: "Cell x: Custom request"
    const displayPrompt = `${cellIndex}번째 셀: ${promptText}`;

    // Create LLM prompt with code and output
    let llmPrompt = `${promptText}\n\n셀 내용:\n\`\`\`\n${cellContent}\n\`\`\``;
    if (cellOutput) {
      llmPrompt += `\n\n실행 결과:\n\`\`\`\n${cellOutput}\n\`\`\``;
    }

    const agentPanel = (window as any)._hdspAgentPanel;
    if (agentPanel) {
      // Activate the sidebar panel
      const app = (window as any).jupyterapp;
      if (app) {
        app.shell.activateById(agentPanel.id);
      }

      // Send both prompts with cell ID and cell index
      if (agentPanel.addCellActionMessage) {
        // cellIndex is 1-based (for display), convert to 0-based for array access
        const cellIndexZeroBased = cellIndex - 1;
        agentPanel.addCellActionMessage(CellAction.CUSTOM_PROMPT, cellContent, displayPrompt, llmPrompt, cellId, cellIndexZeroBased);
      }
    }
  };

  submitBtn.addEventListener('click', handleSubmit);

  submitBtn.addEventListener('mouseenter', () => {
    submitBtn.style.background = 'rgba(25, 118, 210, 0.1)';
  });

  submitBtn.addEventListener('mouseleave', () => {
    submitBtn.style.background = 'transparent';
  });

  // Enter 키로 제출 (Shift+Enter는 줄바꿈)
  inputField?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  });

  // 오버레이 클릭 시 다이얼로그 닫기
  dialogOverlay.addEventListener('click', (e) => {
    if (e.target === dialogOverlay) {
      dialogOverlay.remove();
    }
  });

  // ESC 키로 다이얼로그 닫기
  const handleEscapeKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      dialogOverlay.remove();
      document.removeEventListener('keydown', handleEscapeKey);
    }
  };
  document.addEventListener('keydown', handleEscapeKey);
}
