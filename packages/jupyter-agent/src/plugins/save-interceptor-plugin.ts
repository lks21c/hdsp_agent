/**
 * Save Interceptor Plugin
 * Intercepts notebook save operations to offer code review before saving
 * Based on chrome_agent's save interception functionality
 */

import { INotebookTracker } from '@jupyterlab/notebook';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import { Cell } from '@jupyterlab/cells';
import { ICommandPalette } from '@jupyterlab/apputils';

/**
 * Interface for collected cell data
 */
interface CollectedCell {
  index: number;
  id: string;
  content: string;
  type: string;
  output?: string;
  imports?: Array<{
    module: string;
    items: string;
    isLocal: boolean;
  }>;
  localModuleSources?: { [key: string]: string };
}

/**
 * Save Interceptor Plugin
 */
export const saveInterceptorPlugin = {
  id: '@jupyter-agent/save-interceptor',
  autoStart: true,
  requires: [INotebookTracker],
  optional: [ICommandPalette],
  activate: (app: any, notebookTracker: INotebookTracker, palette: ICommandPalette | null) => {
    console.log('[SaveInterceptorPlugin] Activated');

    let isSaving = false;
    let originalSaveCommand: any = null;

    // Store original save command and wrap it
    if (app.commands.hasCommand('docmanager:save')) {
      console.log('[SaveInterceptorPlugin] Found docmanager:save command');

      const commandRegistry = app.commands;
      const commandId = 'docmanager:save';

      // Get the original command's execute function
      const originalCommand = (commandRegistry as any)._commands.get(commandId);
      if (originalCommand) {
        originalSaveCommand = originalCommand.execute.bind(originalCommand);
        console.log('[SaveInterceptorPlugin] Stored original save command');

        // Replace the execute function
        originalCommand.execute = async (args?: any) => {
          const currentWidget = notebookTracker.currentWidget;

          console.log('[SaveInterceptorPlugin] Save command triggered', {
            hasCurrentWidget: !!currentWidget,
            isSaving: isSaving,
            widgetType: currentWidget?.constructor?.name
          });

          // Only intercept for notebooks
          if (!currentWidget) {
            console.log('[SaveInterceptorPlugin] No current widget, allowing default save');
            return originalSaveCommand(args);
          }

          if (isSaving) {
            console.log('[SaveInterceptorPlugin] Already in save process, executing actual save');
            return originalSaveCommand(args);
          }

          console.log('[SaveInterceptorPlugin] Intercepting save, showing modal');
          await handleSaveIntercept(currentWidget, app, originalSaveCommand, args, () => isSaving = true, () => isSaving = false);
        };

        console.log('[SaveInterceptorPlugin] Wrapped save command installed');
      } else {
        console.error('[SaveInterceptorPlugin] Could not find original save command');
      }
    }

    // Also intercept keyboard shortcut as backup
    document.addEventListener('keydown', async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        const currentWidget = notebookTracker.currentWidget;
        if (!currentWidget) {
          return; // Not in a notebook, let default save happen
        }

        console.log('[SaveInterceptorPlugin] Save shortcut (Ctrl/Cmd+S) detected');
        e.preventDefault();
        e.stopPropagation();

        if (isSaving) {
          console.log('[SaveInterceptorPlugin] Already saving, ignoring duplicate request');
          return;
        }

        if (!originalSaveCommand) {
          console.error('[SaveInterceptorPlugin] No original save command stored');
          return;
        }
        await handleSaveIntercept(currentWidget, app, originalSaveCommand, undefined, () => isSaving = true, () => isSaving = false);
      }
    }, true); // Use capture phase to intercept before JupyterLab

    console.log('[SaveInterceptorPlugin] Save interception enabled');
  }
};

/**
 * Handle save intercept - show modal and collect cells if needed
 */
async function handleSaveIntercept(
  panel: any,
  app: any,
  originalSaveCommand: any,
  args: any,
  setSaving: () => void,
  clearSaving: () => void
): Promise<void> {
  // Show confirmation modal
  const shouldAnalyze = await showSaveConfirmModal();

  if (shouldAnalyze === null) {
    // User cancelled
    clearSaving();
    return;
  }

  if (shouldAnalyze) {
    // Collect all cells and send for analysis
    await performAnalysisSave(panel, app, originalSaveCommand, args, setSaving, clearSaving);
  } else {
    // Direct save without analysis
    await performDirectSave(panel, app, originalSaveCommand, args, setSaving, clearSaving);
  }
}

/**
 * Show save confirmation modal
 * Returns: true for analysis, false for direct save, null for cancel
 */
function showSaveConfirmModal(): Promise<boolean | null> {
  return new Promise((resolve) => {
    // Remove existing modal if any
    const existingModal = document.querySelector('.jp-agent-save-confirm-modal');
    if (existingModal) {
      existingModal.remove();
    }

    // Create modal overlay
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'jp-agent-save-confirm-modal';
    modalOverlay.style.cssText = `
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

    // Create modal container
    const modalContainer = document.createElement('div');
    modalContainer.style.cssText = `
      background: var(--jp-layout-color1);
      border: 1px solid var(--jp-border-color1);
      border-radius: 4px;
      padding: 24px;
      max-width: 400px;
      width: 90%;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      font-family: var(--jp-ui-font-family);
    `;

    // Modal content
    modalContainer.innerHTML = `
      <div style="margin-bottom: 20px;">
        <h3 style="margin: 0 0 12px 0; color: var(--jp-ui-font-color1); font-size: 16px; font-weight: 500;">
          저장 전에 코드 검수를 하겠습니까?
        </h3>
        <p style="margin: 0; color: var(--jp-ui-font-color2); font-size: 14px; line-height: 1.5;">
          노트북을 저장하기 전에 모든 셀의 코드와 출력을 분석하여 최적화 제안을 받으시겠습니까?
        </p>
      </div>
      <div style="display: flex; gap: 12px; justify-content: flex-end;">
        <button class="jp-agent-save-direct-btn" style="
          background: transparent;
          color: var(--jp-ui-font-color2);
          border: 1px solid var(--jp-border-color2);
          border-radius: 3px;
          padding: 8px 16px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        ">그냥 저장하기</button>
        <button class="jp-agent-save-analysis-btn" style="
          background: var(--jp-brand-color1);
          color: white;
          border: 1px solid var(--jp-brand-color1);
          border-radius: 3px;
          padding: 8px 16px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        ">검수 후 저장하기</button>
      </div>
    `;

    modalOverlay.appendChild(modalContainer);
    document.body.appendChild(modalOverlay);

    // Button event listeners
    const directSaveBtn = modalContainer.querySelector('.jp-agent-save-direct-btn') as HTMLButtonElement;
    const analysisSaveBtn = modalContainer.querySelector('.jp-agent-save-analysis-btn') as HTMLButtonElement;

    // Direct save button
    directSaveBtn.addEventListener('click', () => {
      console.log('[SaveInterceptorPlugin] User chose direct save');
      modalOverlay.remove();
      resolve(false);
    });

    directSaveBtn.addEventListener('mouseenter', () => {
      directSaveBtn.style.background = 'var(--jp-layout-color2)';
    });

    directSaveBtn.addEventListener('mouseleave', () => {
      directSaveBtn.style.background = 'transparent';
    });

    // Analysis save button
    analysisSaveBtn.addEventListener('click', () => {
      console.log('[SaveInterceptorPlugin] User chose analysis save');
      modalOverlay.remove();
      resolve(true);
    });

    analysisSaveBtn.addEventListener('mouseenter', () => {
      analysisSaveBtn.style.opacity = '0.9';
    });

    analysisSaveBtn.addEventListener('mouseleave', () => {
      analysisSaveBtn.style.opacity = '1';
    });

    // Close on overlay click
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) {
        console.log('[SaveInterceptorPlugin] User cancelled save');
        modalOverlay.remove();
        resolve(null);
      }
    });

    // ESC key to close
    const handleEscapeKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        console.log('[SaveInterceptorPlugin] User cancelled save with ESC');
        modalOverlay.remove();
        document.removeEventListener('keydown', handleEscapeKey);
        resolve(null);
      }
    };
    document.addEventListener('keydown', handleEscapeKey);
  });
}

/**
 * Perform direct save without analysis
 */
async function performDirectSave(
  panel: any,
  app: any,
  originalSaveCommand: any,
  args: any,
  setSaving: () => void,
  clearSaving: () => void
): Promise<void> {
  console.log('[SaveInterceptorPlugin] Performing direct save');
  setSaving();

  try {
    // Use the original save command
    if (originalSaveCommand) {
      await originalSaveCommand(args);
      showNotification('저장이 완료되었습니다.', 'success');
    } else {
      // Fallback: Use JupyterLab's document manager to save
      const context = panel.context;
      if (context) {
        await context.save();
        showNotification('저장이 완료되었습니다.', 'success');
      }
    }
  } catch (error) {
    console.error('[SaveInterceptorPlugin] Save failed:', error);
    showNotification('저장에 실패했습니다.', 'error');
  } finally {
    clearSaving();
  }
}

/**
 * Perform analysis save - collect cells and send to AgentPanel
 */
async function performAnalysisSave(
  panel: any,
  app: any,
  originalSaveCommand: any,
  args: any,
  setSaving: () => void,
  clearSaving: () => void
): Promise<void> {
  console.log('[SaveInterceptorPlugin] Performing analysis save');

  try {
    // Collect all code cells
    const cells = await collectAllCodeCells(panel);

    if (cells.length === 0) {
      showNotification('분석할 코드 셀이 없습니다. 그냥 저장합니다.', 'warning');
      await performDirectSave(panel, app, originalSaveCommand, args, setSaving, clearSaving);
      return;
    }

    showNotification('코드 분석을 시작합니다...', 'info');

    // Get AgentPanel instance
    const agentPanel = (window as any)._jupyterAgentPanel;

    if (!agentPanel) {
      console.error('[SaveInterceptorPlugin] Agent panel not found');
      showNotification('Agent panel을 찾을 수 없습니다. 그냥 저장합니다.', 'warning');
      await performDirectSave(panel, app, originalSaveCommand, args, setSaving, clearSaving);
      return;
    }

    // Activate the sidebar panel
    if (app) {
      app.shell.activateById(agentPanel.id);
    }

    // Send cells to AgentPanel for analysis
    if (agentPanel.analyzeNotebook) {
      agentPanel.analyzeNotebook(cells, async () => {
        // Callback after analysis complete - perform save
        await performDirectSave(panel, app, originalSaveCommand, args, setSaving, clearSaving);
      });
    } else {
      console.error('[SaveInterceptorPlugin] analyzeNotebook method not found on AgentPanel');
      showNotification('분석 기능을 사용할 수 없습니다. 그냥 저장합니다.', 'warning');
      await performDirectSave(panel, app, originalSaveCommand, args, setSaving, clearSaving);
    }
  } catch (error) {
    console.error('[SaveInterceptorPlugin] Analysis save failed:', error);
    showNotification('분석에 실패했습니다. 그냥 저장합니다.', 'warning');
    await performDirectSave(panel, app, originalSaveCommand, args, setSaving, clearSaving);
  }
}

/**
 * Collect all code cells with content, output, and imports
 * Based on chrome_agent's collectAllCodeCells implementation
 */
async function collectAllCodeCells(panel: any): Promise<CollectedCell[]> {
  const notebook = panel.content;
  const cells: CollectedCell[] = [];

  for (let i = 0; i < notebook.widgets.length; i++) {
    const cell = notebook.widgets[i];

    // Only collect code cells
    if (cell.model.type !== 'code') {
      continue;
    }

    const content = cell.model.sharedModel.getSource();
    if (!content.trim()) {
      continue;
    }

    // Get or assign cell ID
    const cellId = getOrAssignCellId(cell);

    // Extract output
    const output = getCellOutput(cell);

    // Extract imports
    const imports = extractImports(content);

    // Get local module sources (simplified - would need kernel API access for full implementation)
    const localImports = imports.filter(imp => imp.isLocal);
    const localModuleSources: { [key: string]: string } = {};

    // Note: Full module source extraction would require kernel websocket connection
    // This is a simplified version for now
    for (const imp of localImports) {
      if (!imp.module.startsWith('.')) {
        // Could implement kernel-based source extraction here
        localModuleSources[imp.module] = `# Source for ${imp.module} would be fetched from kernel`;
      }
    }

    cells.push({
      index: i,
      id: cellId,
      content: content,
      type: 'code',
      output: output,
      imports: imports,
      localModuleSources: Object.keys(localModuleSources).length > 0 ? localModuleSources : undefined
    });
  }

  console.log(`[SaveInterceptorPlugin] Collected ${cells.length} code cells`);
  return cells;
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
 * Extract imports from Python code
 * Based on chrome_agent's extractImports implementation
 */
function extractImports(cellContent: string): Array<{ module: string; items: string; isLocal: boolean }> {
  const imports: Array<{ module: string; items: string; isLocal: boolean }> = [];
  const lines = cellContent.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (trimmed.startsWith('#') || trimmed === '') continue;

    // Relative import: from . import ... or from .. import ...
    const relativeMatch = trimmed.match(/^from\s+(\.+[\w.]*)\s+import\s+([\w,\s*]+)/);
    if (relativeMatch) {
      imports.push({
        module: relativeMatch[1],
        items: relativeMatch[2],
        isLocal: true
      });
      continue;
    }

    // from X import Y form
    const fromImportMatch = trimmed.match(/^from\s+([\w.]+)\s+import\s+([\w,\s*]+)/);
    if (fromImportMatch) {
      const moduleName = fromImportMatch[1];
      imports.push({
        module: moduleName,
        items: fromImportMatch[2],
        isLocal: isLocalImport(moduleName)
      });
      continue;
    }

    // import X, Y, Z form
    const importMatch = trimmed.match(/^import\s+([\w,\s.]+)/);
    if (importMatch) {
      const modules = importMatch[1].split(',').map(m => m.trim().split(' as ')[0]);
      modules.forEach(moduleName => {
        imports.push({
          module: moduleName,
          items: moduleName,
          isLocal: isLocalImport(moduleName)
        });
      });
    }
  }

  return imports;
}

/**
 * Determine if a module import is local (not a standard library)
 */
function isLocalImport(moduleName: string): boolean {
  // Relative paths are always local
  if (moduleName.startsWith('.')) {
    return true;
  }

  // Common Python libraries (not exhaustive)
  const commonLibraries = [
    'numpy', 'np', 'pandas', 'pd', 'matplotlib', 'sklearn', 'scipy',
    'torch', 'tensorflow', 'tf', 'keras', 'PIL', 'cv2', 'requests',
    'json', 'os', 'sys', 'datetime', 'time', 'math', 'random',
    'collections', 'itertools', 'functools', 're', 'pathlib',
    'typing', 'dataclasses', 'abc', 'argparse', 'logging',
    'pickle', 'csv', 'sqlite3', 'http', 'urllib', 'email',
    'plotly', 'seaborn', 'statsmodels', 'xgboost', 'lightgbm',
    'transformers', 'datasets', 'accelerate', 'peft',
    'openai', 'anthropic', 'langchain', 'llama_index'
  ];

  // Get top-level module name
  const topLevelModule = moduleName.split('.')[0];

  // If not in common libraries, consider it local
  return !commonLibraries.includes(topLevelModule);
}

/**
 * Show notification
 */
function showNotification(message: string, type: 'info' | 'warning' | 'error' | 'success' = 'info'): void {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    border-radius: 8px;
    color: white;
    font-size: 14px;
    font-weight: 500;
    z-index: 10001;
    opacity: 0;
    transition: opacity 0.3s ease;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    max-width: 300px;
    word-wrap: break-word;
  `;

  // Type-based colors
  const colors = {
    success: '#48bb78',
    error: '#f56565',
    warning: '#ed8936',
    info: '#4299e1'
  };

  notification.style.background = colors[type] || colors.info;
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
