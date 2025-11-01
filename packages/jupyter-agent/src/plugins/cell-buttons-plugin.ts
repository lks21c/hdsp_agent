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

  // Initial injection
  injectButtonsIntoAllCells(notebook, panel);

  // Watch for cell changes (add/remove/reorder)
  const cellsChangedHandler = () => {
    injectButtonsIntoAllCells(notebook, panel);
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
    return;
  }

  const promptNode = (cell.inputArea as any)?.promptNode;
  if (!promptNode) {
    return;
  }

  // Check if buttons already injected
  if (promptNode.querySelector('.jp-agent-cell-buttons')) {
    return;
  }

  // Create button container
  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'jp-agent-cell-buttons';

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

  // Add buttons to container
  buttonContainer.appendChild(explainBtn);
  buttonContainer.appendChild(fixBtn);
  buttonContainer.appendChild(customBtn);

  // Inject into prompt area
  promptNode.appendChild(buttonContainer);
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
    // For explain/fix, send to sidebar panel
    sendToSidebarPanel(action, cellContent);
  }
}

/**
 * Send cell action to sidebar panel
 */
function sendToSidebarPanel(action: CellAction, cellContent: string): void {
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

  // Create action message
  let message = '';
  switch (action) {
    case CellAction.EXPLAIN:
      message = `Explain this code:\n\n\`\`\`\n${cellContent}\n\`\`\``;
      break;
    case CellAction.FIX:
      message = `Fix any errors in this code:\n\n\`\`\`\n${cellContent}\n\`\`\``;
      break;
  }

  // Send message to panel
  if (agentPanel.addCellActionMessage) {
    agentPanel.addCellActionMessage(action, cellContent, message);
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
      const message = `${prompt}\n\n\`\`\`\n${cellContent}\n\`\`\``;
      sendToSidebarPanel(CellAction.CUSTOM_PROMPT, message);
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
