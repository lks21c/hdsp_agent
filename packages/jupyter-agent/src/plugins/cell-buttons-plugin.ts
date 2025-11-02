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
  id: '@jupyter-agent/cell-buttons',
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
 */
function injectButtonsIntoCell(cell: Cell, panel: any): void {
  // Only inject into code cells
  if (cell.model.type !== 'code') {
    console.log('[CellButtonsPlugin] Skipping non-code cell');
    return;
  }

  // Get the cell node (contains the entire cell)
  const cellNode = cell.node;
  if (!cellNode) {
    console.warn('[CellButtonsPlugin] No cell node found');
    return;
  }

  // Check if buttons already injected
  if (cellNode.querySelector('.jp-agent-cell-buttons')) {
    console.log('[CellButtonsPlugin] Buttons already injected for cell');
    return;
  }

  console.log('[CellButtonsPlugin] Injecting buttons into cell');

  // Create button container
  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'jp-agent-cell-buttons';

  // Add inline styles for vertical button layout above prompt
  buttonContainer.style.cssText = `
    display: flex !important;
    flex-direction: column !important;
    gap: 2px !important;
    align-items: center !important;
    justify-content: center !important;
    margin-bottom: 4px !important;
  `;

  // Create E button (Explain)
  const explainBtn = createButton('E', 'Explain this code', () => {
    handleCellAction(CellAction.EXPLAIN, cell);
  });
  explainBtn.classList.add('jp-agent-button-explain');

  // Create F button (Fix)
  const fixBtn = createButton('F', 'Fix errors in this code', () => {
    handleCellAction(CellAction.FIX, cell);
  });
  fixBtn.classList.add('jp-agent-button-fix');

  // Create ? button (Custom)
  const customBtn = createButton('?', 'Custom prompt', () => {
    handleCellAction(CellAction.CUSTOM_PROMPT, cell);
  });
  customBtn.classList.add('jp-agent-button-custom');

  // Add buttons to container in horizontal order
  buttonContainer.appendChild(explainBtn);
  buttonContainer.appendChild(fixBtn);
  buttonContainer.appendChild(customBtn);

  // Get the width of the prompt area to align buttons with code
  const inputArea = cell.inputArea as any;
  const promptNode = inputArea?.promptNode;
  const promptWidth = promptNode ? promptNode.offsetWidth : 80; // Default to ~80px if not found

  // Style the button container to appear at the top of the cell, aligned with code
  buttonContainer.style.cssText = `
    display: flex !important;
    flex-direction: row !important;
    gap: 4px !important;
    align-items: center !important;
    justify-content: flex-start !important;
    padding: 4px 8px !important;
    padding-left: ${promptWidth + 8}px !important;
    background: rgba(255, 255, 255, 0.05) !important;
    border-bottom: 1px solid var(--jp-border-color2) !important;
  `;

  // Insert button container at the very top of the cell
  cellNode.insertBefore(buttonContainer, cellNode.firstChild);

  console.log('[CellButtonsPlugin] ✅ Buttons successfully injected into cell:', {
    container: buttonContainer,
    parent: cellNode,
    buttons: ['E', 'F', '?'],
    isVisible: buttonContainer.offsetWidth > 0 && buttonContainer.offsetHeight > 0
  });

  // Force visibility check
  if (buttonContainer.offsetWidth === 0 || buttonContainer.offsetHeight === 0) {
    console.error('[CellButtonsPlugin] ⚠️ Buttons are hidden! Check CSS:', {
      display: window.getComputedStyle(buttonContainer).display,
      visibility: window.getComputedStyle(buttonContainer).visibility,
      opacity: window.getComputedStyle(buttonContainer).opacity,
      containerWidth: buttonContainer.offsetWidth,
      containerHeight: buttonContainer.offsetHeight
    });
  }
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
function handleCellAction(action: CellAction, cell: Cell): void {
  const cellContent = cell.model.sharedModel.getSource();

  if (action === CellAction.CUSTOM_PROMPT) {
    // For custom prompt, show dialog
    showCustomPromptDialog(cell);
  } else {
    // Get cell index
    const cellIndex = getCellIndex(cell);

    // Get cell output
    const cellOutput = getCellOutput(cell);

    // For explain/fix, send to sidebar panel with both user-facing and LLM prompts
    sendToSidebarPanel(action, cellContent, cellIndex, cellOutput);
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
 * Send cell action to sidebar panel
 */
function sendToSidebarPanel(
  action: CellAction,
  cellContent: string,
  cellIndex: number,
  cellOutput: string
): void {
  const agentPanel = (window as any)._jupyterAgentPanel;

  if (!agentPanel) {
    console.error('[CellButtonsPlugin] Agent panel not found. Make sure sidebar plugin is loaded.');
    return;
  }

  // Activate the sidebar panel
  const app = (window as any).jupyterapp;
  if (app) {
    app.shell.activateById(agentPanel.id);
  }

  // Create user-facing display prompt
  let displayPrompt = '';
  // Create actual LLM prompt
  let llmPrompt = '';

  switch (action) {
    case CellAction.EXPLAIN:
      // User sees: "Cell x: 설명요청"
      displayPrompt = `${cellIndex}번째 셀: 설명요청`;

      // LLM receives: "코드 설명해줘 + 셀 내용 + cell output 결과"
      llmPrompt = `코드 설명해줘\n\n셀 내용:\n\`\`\`\n${cellContent}\n\`\`\``;
      if (cellOutput) {
        llmPrompt += `\n\n실행 결과:\n\`\`\`\n${cellOutput}\n\`\`\``;
      }
      break;

    case CellAction.FIX:
      // User sees: "Cell x: 오류수정 요청"
      displayPrompt = `${cellIndex}번째 셀: 오류수정 요청`;

      // LLM receives: Fix prompt with code and output
      llmPrompt = `코드의 오류를 수정해줘\n\n셀 내용:\n\`\`\`\n${cellContent}\n\`\`\``;
      if (cellOutput) {
        llmPrompt += `\n\n실행 결과 (오류 포함):\n\`\`\`\n${cellOutput}\n\`\`\``;
      }
      break;
  }

  // Send both prompts to panel
  if (agentPanel.addCellActionMessage) {
    agentPanel.addCellActionMessage(action, cellContent, displayPrompt, llmPrompt);
  }
}

/**
 * Show custom prompt dialog
 */
function showCustomPromptDialog(cell: Cell): void {
  const cellContent = cell.model.sharedModel.getSource();

  // Create dialog overlay
  const overlay = document.createElement('div');
  overlay.className = 'jp-agent-dialog-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'jp-agent-dialog';

  // Dialog title
  const title = document.createElement('h2');
  title.textContent = 'Custom Prompt for Cell';
  dialog.appendChild(title);

  // Cell preview
  const previewLabel = document.createElement('label');
  previewLabel.textContent = 'Cell Content Preview:';
  previewLabel.className = 'jp-agent-dialog-label';
  dialog.appendChild(previewLabel);

  const previewBox = document.createElement('pre');
  previewBox.className = 'jp-agent-dialog-preview';
  previewBox.textContent = cellContent.length > 200
    ? cellContent.substring(0, 200) + '...'
    : cellContent;
  dialog.appendChild(previewBox);

  // Prompt input
  const inputLabel = document.createElement('label');
  inputLabel.textContent = 'Enter your prompt:';
  inputLabel.className = 'jp-agent-dialog-label';
  dialog.appendChild(inputLabel);

  const textarea = document.createElement('textarea');
  textarea.className = 'jp-agent-dialog-input';
  textarea.placeholder = "e.g., 'Add docstrings to this function' or 'Optimize this code for performance'";
  textarea.rows = 4;
  dialog.appendChild(textarea);

  // Helper text
  const helperText = document.createElement('div');
  helperText.className = 'jp-agent-dialog-helper';
  helperText.textContent = 'Press Enter to submit, Shift+Enter for new line, Escape to cancel';
  dialog.appendChild(helperText);

  // Buttons
  const buttonRow = document.createElement('div');
  buttonRow.className = 'jp-agent-dialog-buttons';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.className = 'jp-agent-dialog-button';
  cancelBtn.onclick = () => {
    document.body.removeChild(overlay);
  };

  const submitBtn = document.createElement('button');
  submitBtn.textContent = 'Submit';
  submitBtn.className = 'jp-agent-dialog-button jp-agent-dialog-button-primary';
  submitBtn.onclick = () => {
    const prompt = textarea.value.trim();
    if (prompt) {
      // Get cell index and output
      const cellIndex = getCellIndex(cell);
      const cellOutput = getCellOutput(cell);

      // Create display prompt: "Cell x: Custom request"
      const displayPrompt = `${cellIndex}번째 셀: ${prompt}`;

      // Create LLM prompt with code and output
      let llmPrompt = `${prompt}\n\n셀 내용:\n\`\`\`\n${cellContent}\n\`\`\``;
      if (cellOutput) {
        llmPrompt += `\n\n실행 결과:\n\`\`\`\n${cellOutput}\n\`\`\``;
      }

      const agentPanel = (window as any)._jupyterAgentPanel;
      if (agentPanel) {
        // Activate the sidebar panel
        const app = (window as any).jupyterapp;
        if (app) {
          app.shell.activateById(agentPanel.id);
        }

        // Send both prompts
        if (agentPanel.addCellActionMessage) {
          agentPanel.addCellActionMessage(CellAction.CUSTOM_PROMPT, cellContent, displayPrompt, llmPrompt);
        }
      }

      document.body.removeChild(overlay);
    }
  };

  buttonRow.appendChild(cancelBtn);
  buttonRow.appendChild(submitBtn);
  dialog.appendChild(buttonRow);

  // Keyboard handlers
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitBtn.click();
    } else if (e.key === 'Escape') {
      cancelBtn.click();
    }
  });

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  // Focus textarea
  setTimeout(() => textarea.focus(), 100);

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      document.body.removeChild(overlay);
    }
  });
}
