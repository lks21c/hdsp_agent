# Jupyter Agent - Comprehensive Design Specification

**Version**: 1.0.0
**Date**: October 31, 2025
**Target Platform**: JupyterLab 4.x
**Architecture**: Plugin-based JupyterLab Extension

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture](#2-system-architecture)
3. [Component Specifications](#3-component-specifications)
4. [API Design](#4-api-design)
5. [Implementation Plan](#5-implementation-plan)
6. [Technical Decisions](#6-technical-decisions)
7. [Code Patterns](#7-code-patterns)
8. [Integration Checklist](#8-integration-checklist)

---

## 1. Executive Summary

### 1.1 Project Vision

**Jupyter Agent** is a JupyterLab extension that combines the proven architecture of Jupyter AI with enhanced cell-level interaction features from Chrome Agent. The extension enables AI-powered assistance directly within notebooks through:

- **Preserved UI**: Complete Jupyter AI side panel chat interface
- **Enhanced Interaction**: Cell-level action buttons (E, F, ?) for targeted AI assistance
- **Seamless Integration**: Native JupyterLab experience with Material-UI consistency

### 1.2 Key Features

| Feature | Description | Source |
|---------|-------------|--------|
| **Side Panel Chat** | Full-featured chat interface with LLM integration | Jupyter AI |
| **Chat Settings** | Model configuration, API key management | Jupyter AI |
| **Theme Integration** | JupyterLab ↔ MUI theme synchronization | Jupyter AI |
| **E Button** | Explain cell code via LLM | Chrome Agent |
| **F Button** | Fix cell errors via LLM | Chrome Agent |
| **? Button** | Custom prompt dialog for cells | Chrome Agent |
| **Save Configuration** | Persistent settings storage | Chrome Agent |

### 1.3 Architecture Summary

```
┌─────────────────────────────────────────────────────────────┐
│                    JupyterLab Application                    │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐         ┌──────────────────────────────┐  │
│  │  Notebook    │         │     Side Panel (Jupyter AI)  │  │
│  │              │         │                              │  │
│  │  ┌────────┐  │         │  ┌────────────────────────┐ │  │
│  │  │ Cell 1 │  │◄───────┼──┤  Chat Interface         │ │  │
│  │  │ [E][F][?]│  │  Msgs  │  │  - Message threading    │ │  │
│  │  └────────┘  │         │  │  - Model configuration  │ │  │
│  │               │         │  │  - Settings UI          │ │  │
│  │  ┌────────┐  │         │  └────────────────────────┘ │  │
│  │  │ Cell 2 │  │         │                              │  │
│  │  │ [E][F][?]│  │         │  ┌────────────────────────┐ │  │
│  │  └────────┘  │         │  │  LLM Response Area      │ │  │
│  │               │         │  │  - Streaming responses  │ │  │
│  └──────────────┘         │  └────────────────────────┘ │  │
│         ▲                 └──────────────────────────────┘  │
│         │                               │                   │
│         │                               │                   │
└─────────┼───────────────────────────────┼───────────────────┘
          │                               │
          │    ┌─────────────────────────┴────────┐
          │    │   Cell Action Service            │
          │    │   - Message routing              │
          │    │   - Cell targeting               │
          └────┤   - State management             │
               └──────────────────────────────────┘
                              │
               ┌──────────────┴──────────────┐
               │   Backend REST API          │
               │   - LLM processing          │
               │   - Configuration storage   │
               │   - Model management        │
               └─────────────────────────────┘
```

---

## 2. System Architecture

### 2.1 Plugin Architecture

The extension follows JupyterLab's plugin-based architecture with **6 core plugins**:

```
┌────────────────────────────────────────────────────────────┐
│                     Plugin Registry                        │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  1. Main Plugin (@jupyter-agent/core:plugin)              │
│     - Chat settings UI                                     │
│     - Command registration                                 │
│     - Side panel management                                │
│                                                            │
│  2. Status Item Plugin (jupyter-agent:status-item)        │
│     - Status bar integration                               │
│     - IJaiStatusItem token provider                        │
│                                                            │
│  3. Completion Plugin (@jupyter-agent/core:completions)   │
│     - Inline code completions                              │
│     - WebSocket handler                                    │
│                                                            │
│  4. Stop Streaming Plugin (@jupyter-agent/core:stop)      │
│     - Message footer integration                           │
│     - Stop button component                                │
│                                                            │
│  5. Cell Actions Plugin (@jupyter-agent/core:cell-actions)│
│     - E, F, ? button injection                            │
│     - Cell context tracking                                │
│     - Custom prompt dialog                                 │
│                                                            │
│  6. Chat Commands Plugin (@jupyter-agent/core:commands)   │
│     - Slash command provider                               │
│     - File command integration                             │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

**NEW PLUGIN**: **Cell Actions Plugin** - This is the primary addition to the Jupyter AI architecture, responsible for all cell-level button functionality.

### 2.2 Component Hierarchy

```
JupyterLab Application
│
├── Main Area / Side Panel
│   └── ChatSettingsWidget (ReactWidget)
│       └── JlThemeProvider
│           └── ChatSettings
│               ├── ModelIdInput
│               ├── ModelParametersInput
│               ├── SecretsSection
│               │   ├── SecretsList
│               │   └── SecretsInput
│               └── CellActionSettings (NEW)
│                   └── EnableCellActionsToggle (NEW)
│
├── Notebook Area
│   └── NotebookPanel
│       └── NotebookWidget
│           └── Cells[]
│               ├── InputArea
│               │   ├── InputPrompt
│               │   └── CellActionButtons (NEW)
│               │       ├── ExplainButton (E)
│               │       ├── FixButton (F)
│               │       └── CustomPromptButton (?)
│               ├── OutputArea
│               └── CellMetadata
│                   └── cellId (NEW)
│
└── Dialogs (NEW)
    └── CustomPromptDialog
        ├── PromptTextarea
        ├── SubmitButton
        └── CancelButton
```

### 2.3 Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Data Flow Diagram                        │
└─────────────────────────────────────────────────────────────┘

User Clicks Button
      │
      ▼
┌──────────────────┐
│ CellActionButton │  (E, F, or ? button in cell)
│  - Captures code │
│  - Gets cell ID  │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────┐
│ CellActionService        │
│  - validateCellContent() │
│  - prepareMessage()      │
│  - trackActiveRequest()  │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│ Backend API              │
│  POST /api/agent/action  │
│  - processExplain()      │
│  - processFix()          │
│  - processCustom()       │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│ LLM Processing           │
│  - Generate response     │
│  - Stream completion     │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│ Side Panel Chat          │
│  - Display message       │
│  - Show streaming resp   │
│  - Apply code (F button) │
└──────────────────────────┘
```

### 2.4 Message Flow Sequence

```
Cell Button Click Flow:
═══════════════════════

1. User clicks [E] button
   │
   ├─> CellActionButton.onClick()
   │   │
   │   ├─> Extract cell content
   │   ├─> Get cell ID from metadata
   │   ├─> Get cell index in notebook
   │   └─> Validate content not empty
   │
   ├─> CellActionService.sendExplainRequest()
   │   │
   │   ├─> Create message payload:
   │   │   {
   │   │     type: 'EXPLAIN_CELL',
   │   │     content: cellCode,
   │   │     cellId: uniqueId,
   │   │     cellIndex: number
   │   │   }
   │   │
   │   └─> POST to /api/agent/action
   │
   ├─> Backend processes request
   │   │
   │   ├─> Generate LLM prompt
   │   ├─> Call model API
   │   └─> Stream response
   │
   └─> Side panel receives response
       │
       ├─> Display in chat interface
       └─> Enable code application (if F button)

Custom Prompt Flow:
══════════════════

1. User clicks [?] button
   │
   ├─> Show CustomPromptDialog
   │   │
   │   ├─> Modal overlay
   │   ├─> Textarea for prompt
   │   └─> Submit/Cancel buttons
   │
   ├─> User enters custom question
   │
   ├─> Dialog validates input
   │
   ├─> CellActionService.sendCustomPrompt()
   │   │
   │   └─> Include user prompt + cell code
   │
   └─> Backend processes → Side panel displays
```

---

## 3. Component Specifications

### 3.1 Cell Actions Plugin (NEW)

**File**: `packages/jupyter-agent/src/cell-actions/plugin.ts`

**Purpose**: Core plugin for managing cell-level button interactions

**TypeScript Interface**:

```typescript
/**
 * Cell Actions Plugin Token
 */
export const ICellActionsPlugin = new Token<ICellActionsPlugin>(
  '@jupyter-agent/core:cell-actions',
  'Provides cell-level action buttons (E, F, ?) for AI assistance'
);

export interface ICellActionsPlugin {
  /**
   * Enable/disable cell action buttons globally
   */
  setEnabled(enabled: boolean): void;

  /**
   * Check if cell actions are enabled
   */
  isEnabled(): boolean;

  /**
   * Refresh buttons in all visible cells
   */
  refreshButtons(): void;

  /**
   * Signal emitted when cell action settings change
   */
  settingsChanged: ISignal<ICellActionsPlugin, void>;
}

/**
 * Plugin registration
 */
const cellActionsPlugin: JupyterFrontEndPlugin<ICellActionsPlugin> = {
  id: '@jupyter-agent/core:cell-actions',
  autoStart: true,
  requires: [INotebookTracker, ICommandRegistry],
  optional: [ISettingRegistry, IStatusBar],
  provides: ICellActionsPlugin,
  activate: activateCellActions
};

function activateCellActions(
  app: JupyterFrontEnd,
  notebookTracker: INotebookTracker,
  commands: ICommandRegistry,
  settingRegistry: ISettingRegistry | null,
  statusBar: IStatusBar | null
): ICellActionsPlugin {
  console.log('JupyterAgent: Cell Actions Plugin activated');

  const service = new CellActionService(app, notebookTracker);

  // Track notebook changes
  notebookTracker.widgetAdded.connect((sender, panel) => {
    service.attachToNotebook(panel);
  });

  // Register commands
  commands.addCommand('jupyter-agent:explain-cell', {
    label: 'Explain Cell with AI',
    execute: () => service.explainActiveCell()
  });

  commands.addCommand('jupyter-agent:fix-cell', {
    label: 'Fix Cell with AI',
    execute: () => service.fixActiveCell()
  });

  commands.addCommand('jupyter-agent:custom-prompt', {
    label: 'Ask Custom Question',
    execute: () => service.showCustomPromptDialog()
  });

  return service;
}
```

### 3.2 CellActionService

**File**: `packages/jupyter-agent/src/cell-actions/service.ts`

**Purpose**: Service class managing all cell action operations

```typescript
import { Signal, ISignal } from '@lumino/signaling';
import { JupyterFrontEnd } from '@jupyterlab/application';
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { ICellModel, Cell } from '@jupyterlab/cells';

export interface ICellActionRequest {
  type: 'EXPLAIN_CELL' | 'FIX_CELL' | 'CUSTOM_PROMPT';
  content: string;
  cellId: string;
  cellIndex: number;
  prompt?: string;  // For CUSTOM_PROMPT type
}

export interface ICellActionResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export class CellActionService implements ICellActionsPlugin {
  private _enabled: boolean = true;
  private _settingsChanged = new Signal<this, void>(this);
  private _notebookTracker: INotebookTracker;
  private _app: JupyterFrontEnd;
  private _attachedNotebooks = new WeakSet<NotebookPanel>();

  constructor(app: JupyterFrontEnd, notebookTracker: INotebookTracker) {
    this._app = app;
    this._notebookTracker = notebookTracker;
  }

  get settingsChanged(): ISignal<this, void> {
    return this._settingsChanged;
  }

  setEnabled(enabled: boolean): void {
    if (this._enabled !== enabled) {
      this._enabled = enabled;
      this._settingsChanged.emit();
      this.refreshButtons();
    }
  }

  isEnabled(): boolean {
    return this._enabled;
  }

  /**
   * Attach button injection to notebook
   */
  attachToNotebook(panel: NotebookPanel): void {
    if (this._attachedNotebooks.has(panel)) {
      return;
    }

    this._attachedNotebooks.add(panel);

    const notebook = panel.content;

    // Inject buttons into existing cells
    this._injectButtonsIntoAllCells(notebook);

    // Listen for new cells
    notebook.model?.cells.changed.connect(() => {
      this._injectButtonsIntoAllCells(notebook);
    });

    // Listen for cell renders
    panel.content.rendered.connect(() => {
      this._injectButtonsIntoAllCells(notebook);
    });
  }

  refreshButtons(): void {
    const currentPanel = this._notebookTracker.currentWidget;
    if (currentPanel) {
      this._injectButtonsIntoAllCells(currentPanel.content);
    }
  }

  /**
   * Explain the active cell
   */
  async explainActiveCell(): Promise<void> {
    const cell = this._getActiveCell();
    if (!cell) return;

    const content = this._getCellContent(cell);
    if (!content.trim()) {
      this._showNotification('Cell is empty', 'warning');
      return;
    }

    const cellId = this._ensureCellId(cell);
    const cellIndex = this._getCellIndex(cell);

    await this._sendRequest({
      type: 'EXPLAIN_CELL',
      content,
      cellId,
      cellIndex
    });
  }

  /**
   * Fix the active cell
   */
  async fixActiveCell(): Promise<void> {
    const cell = this._getActiveCell();
    if (!cell) return;

    const content = this._getCellContent(cell);
    if (!content.trim()) {
      this._showNotification('Cell is empty', 'warning');
      return;
    }

    const cellId = this._ensureCellId(cell);
    const cellIndex = this._getCellIndex(cell);

    await this._sendRequest({
      type: 'FIX_CELL',
      content,
      cellId,
      cellIndex
    });
  }

  /**
   * Show custom prompt dialog
   */
  async showCustomPromptDialog(): Promise<void> {
    const cell = this._getActiveCell();
    if (!cell) return;

    const content = this._getCellContent(cell);
    const cellId = this._ensureCellId(cell);
    const cellIndex = this._getCellIndex(cell);

    // Create and show dialog
    const dialog = new CustomPromptDialog({
      cellIndex,
      onSubmit: async (promptText: string) => {
        await this._sendRequest({
          type: 'CUSTOM_PROMPT',
          content,
          cellId,
          cellIndex,
          prompt: promptText
        });
      }
    });

    dialog.show();
  }

  /**
   * Send request to backend
   */
  private async _sendRequest(request: ICellActionRequest): Promise<void> {
    try {
      const response = await fetch('/api/agent/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(request)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result: ICellActionResponse = await response.json();

      if (result.success) {
        // Open side panel to show response
        this._app.commands.execute('jupyter-agent:open-chat');
      } else {
        this._showNotification(result.error || 'Request failed', 'error');
      }
    } catch (error) {
      console.error('Cell action request failed:', error);
      this._showNotification('Failed to process request', 'error');
    }
  }

  /**
   * Inject buttons into all cells
   */
  private _injectButtonsIntoAllCells(notebook: Notebook): void {
    if (!this._enabled) {
      return;
    }

    for (let i = 0; i < notebook.widgets.length; i++) {
      const cell = notebook.widgets[i];
      this._injectButtonsIntoCell(cell);
    }
  }

  /**
   * Inject buttons into a single cell
   */
  private _injectButtonsIntoCell(cell: Cell): void {
    // Implementation uses DOM manipulation similar to Chrome Agent
    // See section 3.3 for CellActionButtons component
    const node = cell.node;

    // Skip if buttons already exist
    if (node.querySelector('.jp-cell-action-buttons')) {
      return;
    }

    // Create button container
    const buttonContainer = new CellActionButtons({
      cellId: this._ensureCellId(cell),
      onExplain: () => this._explainCell(cell),
      onFix: () => this._fixCell(cell),
      onCustomPrompt: () => this._showCustomPrompt(cell)
    });

    // Insert into DOM
    const inputArea = node.querySelector('.jp-InputArea');
    const inputPrompt = node.querySelector('.jp-InputPrompt');

    if (inputArea && inputPrompt) {
      inputPrompt.parentElement?.appendChild(buttonContainer.node);
    }
  }

  private _getActiveCell(): Cell | null {
    const panel = this._notebookTracker.currentWidget;
    return panel?.content.activeCell || null;
  }

  private _getCellContent(cell: Cell): string {
    return cell.model.value.text;
  }

  private _getCellIndex(cell: Cell): number {
    const panel = this._notebookTracker.currentWidget;
    if (!panel) return -1;

    const cells = panel.content.widgets;
    return cells.indexOf(cell);
  }

  private _ensureCellId(cell: Cell): string {
    const metadata = cell.model.metadata;
    let cellId = metadata.get('jupyterAgentCellId') as string;

    if (!cellId) {
      cellId = `cell-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      metadata.set('jupyterAgentCellId', cellId);
    }

    return cellId;
  }

  private _showNotification(message: string, type: 'info' | 'warning' | 'error'): void {
    // Use JupyterLab notification system
    this._app.commands.execute('apputils:notify', {
      message,
      type,
      options: { autoClose: 3000 }
    });
  }

  private async _explainCell(cell: Cell): Promise<void> {
    const content = this._getCellContent(cell);
    const cellId = this._ensureCellId(cell);
    const cellIndex = this._getCellIndex(cell);

    await this._sendRequest({
      type: 'EXPLAIN_CELL',
      content,
      cellId,
      cellIndex
    });
  }

  private async _fixCell(cell: Cell): Promise<void> {
    const content = this._getCellContent(cell);
    const cellId = this._ensureCellId(cell);
    const cellIndex = this._getCellIndex(cell);

    await this._sendRequest({
      type: 'FIX_CELL',
      content,
      cellId,
      cellIndex
    });
  }

  private async _showCustomPrompt(cell: Cell): Promise<void> {
    const content = this._getCellContent(cell);
    const cellId = this._ensureCellId(cell);
    const cellIndex = this._getCellIndex(cell);

    const dialog = new CustomPromptDialog({
      cellIndex,
      onSubmit: async (promptText: string) => {
        await this._sendRequest({
          type: 'CUSTOM_PROMPT',
          content,
          cellId,
          cellIndex,
          prompt: promptText
        });
      }
    });

    dialog.show();
  }
}
```

### 3.3 CellActionButtons Component

**File**: `packages/jupyter-agent/src/cell-actions/components/cell-action-buttons.tsx`

**Purpose**: React component for E, F, ? button UI

```typescript
import React from 'react';
import { ReactWidget } from '@jupyterlab/apputils';
import { Box, IconButton, Tooltip } from '@mui/material';
import { styled } from '@mui/material/styles';

interface ICellActionButtonsProps {
  cellId: string;
  onExplain: () => void;
  onFix: () => void;
  onCustomPrompt: () => void;
}

const StyledButton = styled(IconButton)(({ theme }) => ({
  background: 'transparent',
  color: theme.palette.text.secondary,
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: '3px',
  padding: '2px 6px',
  fontSize: '11px',
  fontWeight: 600,
  minWidth: '22px',
  height: '22px',
  lineHeight: 1,
  transition: 'all 0.15s ease',
  '&:hover': {
    background: theme.palette.action.hover,
    borderColor: theme.palette.action.active,
    color: theme.palette.text.primary
  }
}));

const ButtonContainer = styled(Box)({
  display: 'inline-flex',
  gap: '4px',
  marginLeft: '8px',
  alignItems: 'center'
});

function CellActionButtonsComponent(props: ICellActionButtonsProps) {
  const { onExplain, onFix, onCustomPrompt } = props;

  return (
    <ButtonContainer className="jp-cell-action-buttons">
      <Tooltip title="Explain this cell with AI" placement="top">
        <StyledButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            onExplain();
          }}
          data-action="explain"
        >
          E
        </StyledButton>
      </Tooltip>

      <Tooltip title="Fix errors in this cell with AI" placement="top">
        <StyledButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            onFix();
          }}
          data-action="fix"
        >
          F
        </StyledButton>
      </Tooltip>

      <Tooltip title="Ask a custom question about this cell" placement="top">
        <StyledButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            onCustomPrompt();
          }}
          data-action="custom"
        >
          ?
        </StyledButton>
      </Tooltip>
    </ButtonContainer>
  );
}

export class CellActionButtons extends ReactWidget {
  constructor(private props: ICellActionButtonsProps) {
    super();
    this.addClass('jp-cell-action-buttons-widget');
  }

  render(): JSX.Element {
    return <CellActionButtonsComponent {...this.props} />;
  }
}
```

### 3.4 CustomPromptDialog Component

**File**: `packages/jupyter-agent/src/cell-actions/components/custom-prompt-dialog.tsx`

**Purpose**: Modal dialog for custom prompt input

```typescript
import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Typography
} from '@mui/material';

interface ICustomPromptDialogProps {
  cellIndex: number;
  onSubmit: (promptText: string) => Promise<void>;
  onCancel?: () => void;
}

export function CustomPromptDialog(props: ICustomPromptDialogProps): JSX.Element {
  const { cellIndex, onSubmit, onCancel } = props;
  const [open, setOpen] = useState(true);
  const [promptText, setPromptText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    const trimmed = promptText.trim();

    if (!trimmed) {
      // Show validation error
      return;
    }

    setIsSubmitting(true);

    try {
      await onSubmit(trimmed);
      setOpen(false);
    } catch (error) {
      console.error('Failed to submit custom prompt:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setOpen(false);
    onCancel?.();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }

    if (e.key === 'Escape') {
      handleCancel();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleCancel}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>
        Ask a Custom Question
        <Typography variant="caption" display="block" color="text.secondary">
          Cell {cellIndex + 1}
        </Typography>
      </DialogTitle>

      <DialogContent>
        <TextField
          autoFocus
          multiline
          fullWidth
          minRows={4}
          maxRows={10}
          placeholder="Enter your question about this cell..."
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isSubmitting}
          sx={{ mt: 1 }}
        />
      </DialogContent>

      <DialogActions>
        <Button onClick={handleCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={isSubmitting || !promptText.trim()}
        >
          Submit
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export class CustomPromptDialogWidget {
  private _dialog: Dialog;

  constructor(props: ICustomPromptDialogProps) {
    // Create React root and render dialog
    this._dialog = /* implementation */;
  }

  show(): void {
    // Show dialog
  }

  hide(): void {
    // Hide dialog
  }
}
```

### 3.5 Cell Action Settings UI

**File**: `packages/jupyter-agent/src/components/settings/cell-action-settings.tsx`

**Purpose**: Settings UI for cell actions (add to ChatSettings component)

```typescript
import React from 'react';
import {
  Box,
  Typography,
  Switch,
  FormControlLabel,
  Divider,
  Paper
} from '@mui/material';
import { ICellActionsPlugin } from '../../cell-actions/plugin';

interface ICellActionSettingsProps {
  cellActionsPlugin: ICellActionsPlugin | null;
}

export function CellActionSettings(props: ICellActionSettingsProps): JSX.Element {
  const { cellActionsPlugin } = props;
  const [enabled, setEnabled] = React.useState(
    cellActionsPlugin?.isEnabled() ?? true
  );

  React.useEffect(() => {
    if (!cellActionsPlugin) return;

    const handleChange = () => {
      setEnabled(cellActionsPlugin.isEnabled());
    };

    cellActionsPlugin.settingsChanged.connect(handleChange);

    return () => {
      cellActionsPlugin.settingsChanged.disconnect(handleChange);
    };
  }, [cellActionsPlugin]);

  const handleToggle = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newEnabled = event.target.checked;
    setEnabled(newEnabled);
    cellActionsPlugin?.setEnabled(newEnabled);
  };

  return (
    <Paper sx={{ p: 2, mt: 2 }}>
      <Typography variant="h6" gutterBottom>
        Cell Actions
      </Typography>

      <Divider sx={{ my: 1 }} />

      <Box sx={{ mt: 2 }}>
        <FormControlLabel
          control={
            <Switch
              checked={enabled}
              onChange={handleToggle}
              disabled={!cellActionsPlugin}
            />
          }
          label="Enable cell action buttons (E, F, ?)"
        />

        <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 1, ml: 4 }}>
          When enabled, action buttons will appear next to cell prompts in notebooks.
        </Typography>
      </Box>

      <Box sx={{ mt: 2 }}>
        <Typography variant="body2" color="text.secondary">
          <strong>E</strong> - Explain cell code<br />
          <strong>F</strong> - Fix errors or improve cell<br />
          <strong>?</strong> - Ask custom questions about cell
        </Typography>
      </Box>
    </Paper>
  );
}
```

---

## 4. API Design

### 4.1 REST API Endpoints

The backend will extend the existing `/api/ai/` namespace with cell action endpoints:

```
POST   /api/agent/action           - Process cell action requests
GET    /api/agent/config           - Get cell action configuration
PUT    /api/agent/config           - Update cell action configuration
GET    /api/agent/history          - Get cell action history
DELETE /api/agent/history/:id      - Delete specific history item
```

### 4.2 API Request/Response Schemas

#### POST /api/agent/action

**Request**:
```typescript
interface CellActionRequest {
  type: 'EXPLAIN_CELL' | 'FIX_CELL' | 'CUSTOM_PROMPT';
  content: string;        // Cell code content
  cellId: string;         // Unique cell identifier
  cellIndex: number;      // Cell position in notebook
  prompt?: string;        // Custom prompt text (for CUSTOM_PROMPT)
  language?: string;      // Cell language (python, javascript, etc.)
  notebookPath?: string;  // Path to current notebook
}
```

**Response**:
```typescript
interface CellActionResponse {
  success: boolean;
  message?: string;
  error?: string;
  requestId?: string;     // For tracking/history
  timestamp?: number;
}
```

#### GET /api/agent/config

**Response**:
```typescript
interface CellActionConfig {
  enabled: boolean;
  defaultModel: string;
  explainPromptTemplate: string;
  fixPromptTemplate: string;
  customPromptTemplate: string;
  maxHistoryItems: number;
}
```

### 4.3 Backend Implementation (Python)

**File**: `packages/jupyter-agent/jupyter_agent/handlers/cell_actions.py`

```python
from jupyter_server.base.handlers import APIHandler
from tornado import web
import json
import uuid
from datetime import datetime

class CellActionHandler(APIHandler):
    """
    Handler for cell action requests
    """

    @web.authenticated
    async def post(self):
        """Process cell action request"""
        try:
            data = self.get_json_body()

            request_type = data.get('type')
            content = data.get('content', '')
            cell_id = data.get('cellId', '')
            cell_index = data.get('cellIndex', -1)
            prompt = data.get('prompt', '')

            if not request_type or not content:
                self.set_status(400)
                self.finish(json.dumps({
                    'success': False,
                    'error': 'Missing required fields'
                }))
                return

            # Generate unique request ID
            request_id = str(uuid.uuid4())

            # Process based on type
            if request_type == 'EXPLAIN_CELL':
                await self._process_explain(content, cell_id, cell_index, request_id)
            elif request_type == 'FIX_CELL':
                await self._process_fix(content, cell_id, cell_index, request_id)
            elif request_type == 'CUSTOM_PROMPT':
                await self._process_custom(content, cell_id, cell_index, prompt, request_id)
            else:
                self.set_status(400)
                self.finish(json.dumps({
                    'success': False,
                    'error': f'Unknown request type: {request_type}'
                }))
                return

            self.finish(json.dumps({
                'success': True,
                'requestId': request_id,
                'timestamp': datetime.now().timestamp()
            }))

        except Exception as e:
            self.log.error(f"Cell action error: {e}")
            self.set_status(500)
            self.finish(json.dumps({
                'success': False,
                'error': str(e)
            }))

    async def _process_explain(self, content: str, cell_id: str, cell_index: int, request_id: str):
        """Process explain cell request"""
        prompt_template = self._get_config().get('explainPromptTemplate',
            'Please explain the following code:\n\n```python\n{content}\n```')

        full_prompt = prompt_template.format(content=content)

        # Send to chat system
        await self._send_to_chat(
            prompt=full_prompt,
            metadata={
                'type': 'EXPLAIN_CELL',
                'cellId': cell_id,
                'cellIndex': cell_index,
                'requestId': request_id
            }
        )

    async def _process_fix(self, content: str, cell_id: str, cell_index: int, request_id: str):
        """Process fix cell request"""
        prompt_template = self._get_config().get('fixPromptTemplate',
            'Please review and fix any errors in this code:\n\n```python\n{content}\n```')

        full_prompt = prompt_template.format(content=content)

        await self._send_to_chat(
            prompt=full_prompt,
            metadata={
                'type': 'FIX_CELL',
                'cellId': cell_id,
                'cellIndex': cell_index,
                'requestId': request_id,
                'applyToCell': True  # Enable code application
            }
        )

    async def _process_custom(self, content: str, cell_id: str, cell_index: int,
                             prompt: str, request_id: str):
        """Process custom prompt request"""
        prompt_template = self._get_config().get('customPromptTemplate',
            '{prompt}\n\nContext - Cell code:\n```python\n{content}\n```')

        full_prompt = prompt_template.format(prompt=prompt, content=content)

        await self._send_to_chat(
            prompt=full_prompt,
            metadata={
                'type': 'CUSTOM_PROMPT',
                'cellId': cell_id,
                'cellIndex': cell_index,
                'requestId': request_id,
                'userPrompt': prompt
            }
        )

    async def _send_to_chat(self, prompt: str, metadata: dict):
        """Send request to chat system"""
        # Integration with existing Jupyter AI chat system
        chat_handler = self.settings.get('jupyter_ai_chat_handler')

        if chat_handler:
            await chat_handler.process_message(
                message=prompt,
                metadata=metadata
            )
        else:
            self.log.warning("Chat handler not available")

    def _get_config(self) -> dict:
        """Get cell action configuration"""
        return self.settings.get('jupyter_agent_config', {})


class CellActionConfigHandler(APIHandler):
    """Handler for cell action configuration"""

    @web.authenticated
    def get(self):
        """Get current configuration"""
        config = self.settings.get('jupyter_agent_config', {
            'enabled': True,
            'defaultModel': 'gpt-4',
            'explainPromptTemplate': 'Please explain the following code:\n\n```python\n{content}\n```',
            'fixPromptTemplate': 'Please review and fix any errors in this code:\n\n```python\n{content}\n```',
            'customPromptTemplate': '{prompt}\n\nContext - Cell code:\n```python\n{content}\n```',
            'maxHistoryItems': 100
        })

        self.finish(json.dumps(config))

    @web.authenticated
    def put(self):
        """Update configuration"""
        try:
            new_config = self.get_json_body()

            # Validate config
            if not isinstance(new_config, dict):
                self.set_status(400)
                self.finish(json.dumps({'error': 'Invalid configuration format'}))
                return

            # Save config
            self.settings['jupyter_agent_config'] = new_config

            self.finish(json.dumps({'success': True}))

        except Exception as e:
            self.log.error(f"Config update error: {e}")
            self.set_status(500)
            self.finish(json.dumps({'error': str(e)}))


# Route registration
def setup_handlers(web_app):
    """Register cell action handlers"""
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]

    handlers = [
        (url_path_join(base_url, r"/api/agent/action"), CellActionHandler),
        (url_path_join(base_url, r"/api/agent/config"), CellActionConfigHandler),
    ]

    web_app.add_handlers(host_pattern, handlers)
```

---

## 5. Implementation Plan

### 5.1 Directory Structure

```
packages/jupyter-agent/
├── src/
│   ├── index.ts                          # Main entry point (extend with cell actions)
│   ├── tokens.ts                         # Add ICellActionsPlugin token
│   ├── handler.ts                        # Extend with cell action API calls
│   │
│   ├── cell-actions/                     # NEW: Cell actions feature
│   │   ├── plugin.ts                     # Cell actions plugin registration
│   │   ├── service.ts                    # CellActionService implementation
│   │   ├── types.ts                      # TypeScript interfaces
│   │   ├── components/
│   │   │   ├── cell-action-buttons.tsx   # E, F, ? buttons component
│   │   │   ├── custom-prompt-dialog.tsx  # Custom prompt modal
│   │   │   └── index.ts
│   │   └── index.ts
│   │
│   ├── components/
│   │   ├── chat-settings.tsx             # Extend with CellActionSettings
│   │   ├── settings/
│   │   │   ├── cell-action-settings.tsx  # NEW: Cell action settings UI
│   │   │   └── ...existing settings
│   │   └── ...existing components
│   │
│   └── ...existing Jupyter AI structure
│
├── jupyter_agent/                        # Python backend
│   ├── handlers/
│   │   ├── cell_actions.py               # NEW: Cell action handlers
│   │   └── ...existing handlers
│   │
│   ├── config/
│   │   └── cell_actions.py               # NEW: Cell action configuration
│   │
│   └── ...existing backend structure
│
├── style/
│   ├── cell-actions.css                  # NEW: Cell action button styles
│   └── ...existing styles
│
├── schema/
│   └── cell-action-config.json           # NEW: Configuration schema
│
└── ...existing files
```

### 5.2 Phase-by-Phase Implementation

#### Phase 1: Foundation (Week 1-2)

**Goal**: Set up plugin infrastructure and basic button injection

**Tasks**:
1. Create `cell-actions/` directory structure
2. Implement `ICellActionsPlugin` token and interface
3. Create `CellActionService` class skeleton
4. Implement basic plugin activation
5. Add plugin to main index.ts exports
6. Test plugin loads and activates successfully

**Deliverables**:
- `cell-actions/plugin.ts` ✓
- `cell-actions/service.ts` (basic structure) ✓
- `tokens.ts` (updated with ICellActionsPlugin) ✓
- Plugin activation confirmed ✓

#### Phase 2: Button UI (Week 3-4)

**Goal**: Implement cell action buttons and injection logic

**Tasks**:
1. Create `CellActionButtons` React component
2. Implement button styling (E, F, ?)
3. Implement cell tracking and ID assignment
4. Create button injection logic in `CellActionService`
5. Handle notebook tracking and cell rendering events
6. Add CSS styling
7. Test buttons appear in all cells

**Deliverables**:
- `components/cell-action-buttons.tsx` ✓
- `style/cell-actions.css` ✓
- Button injection working ✓
- Visual consistency with JupyterLab theme ✓

#### Phase 3: Custom Prompt Dialog (Week 5)

**Goal**: Implement ? button dialog functionality

**Tasks**:
1. Create `CustomPromptDialog` component
2. Implement dialog UI with MUI components
3. Add validation and submit logic
4. Integrate with `CellActionService`
5. Handle keyboard shortcuts (Enter, Escape)
6. Test dialog UX

**Deliverables**:
- `components/custom-prompt-dialog.tsx` ✓
- Dialog interaction working ✓
- Keyboard shortcuts functional ✓

#### Phase 4: Backend Integration (Week 6-7)

**Goal**: Implement backend API and LLM processing

**Tasks**:
1. Create `handlers/cell_actions.py`
2. Implement POST /api/agent/action endpoint
3. Implement configuration endpoints
4. Create prompt templates
5. Integrate with existing chat system
6. Test end-to-end flow (button → backend → response)

**Deliverables**:
- `handlers/cell_actions.py` ✓
- API endpoints functional ✓
- Integration with chat system ✓
- LLM responses appear in side panel ✓

#### Phase 5: Settings UI (Week 8)

**Goal**: Add cell action settings to chat settings panel

**Tasks**:
1. Create `CellActionSettings` component
2. Add enable/disable toggle
3. Integrate with existing `ChatSettings`
4. Implement settings persistence
5. Test settings changes propagate correctly

**Deliverables**:
- `settings/cell-action-settings.tsx` ✓
- Settings UI integrated ✓
- Settings persistence working ✓

#### Phase 6: Testing & Polish (Week 9-10)

**Goal**: Comprehensive testing and UX refinement

**Tasks**:
1. Write unit tests for components
2. Write integration tests for API
3. Test accessibility (keyboard navigation, screen readers)
4. Performance testing (large notebooks)
5. UI polish and refinements
6. Documentation updates

**Deliverables**:
- Test suite ✓
- Accessibility compliance ✓
- Performance benchmarks ✓
- User documentation ✓

### 5.3 Migration Checklist

**From Jupyter AI**:
- [x] Clone repository structure
- [x] Preserve plugin architecture
- [x] Keep all existing components
- [x] Maintain theme integration
- [x] Preserve API communication patterns
- [x] Keep settings management system

**From Chrome Agent**:
- [x] Adapt button creation logic
- [x] Implement dialog functionality
- [x] Port message handling patterns
- [x] Adapt cell identification
- [x] Implement save functionality

**New Development**:
- [x] Cell Actions Plugin
- [x] CellActionService
- [x] Button injection for JupyterLab cells
- [x] Backend API endpoints
- [x] Settings UI integration

---

## 6. Technical Decisions

### 6.1 Button Injection Strategy

**Decision**: DOM-based button injection vs Widget-based approach

**Chosen**: **DOM-based injection** (similar to Chrome Agent)

**Rationale**:
- More flexible for dynamic notebook environments
- Easier to maintain consistency across cell types
- Lower overhead than creating Lumino widgets per button
- Matches Chrome Agent's proven approach
- Can still use React for button components

**Implementation**:
```typescript
// Hybrid approach: React components rendered to DOM nodes
private _injectButtonsIntoCell(cell: Cell): void {
  const buttonWidget = new CellActionButtons(props);

  // Insert React widget into DOM at correct location
  const inputPrompt = cell.node.querySelector('.jp-InputPrompt');
  inputPrompt.parentElement?.appendChild(buttonWidget.node);
}
```

### 6.2 Cell Identification

**Decision**: How to uniquely identify cells for targeting

**Chosen**: **Metadata-based cell IDs**

**Rationale**:
- Persistent across sessions (stored in .ipynb)
- Survives cell reordering
- No DOM manipulation issues
- Natural fit for Jupyter's architecture

**Implementation**:
```typescript
private _ensureCellId(cell: Cell): string {
  const metadata = cell.model.metadata;
  let cellId = metadata.get('jupyterAgentCellId') as string;

  if (!cellId) {
    cellId = `cell-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    metadata.set('jupyterAgentCellId', cellId);
  }

  return cellId;
}
```

### 6.3 Message Communication Pattern

**Decision**: Direct API calls vs Event-based messaging

**Chosen**: **Direct API calls with async/await**

**Rationale**:
- Simpler architecture than event bus
- Better error handling
- Type-safe with TypeScript
- Matches Jupyter AI patterns
- Avoids Chrome extension complexity

**Alternative Considered**: Event-based system (Chrome extension pattern)
- **Rejected**: Unnecessary complexity for same-process communication

### 6.4 Dialog Implementation

**Decision**: Custom modal vs MUI Dialog

**Chosen**: **MUI Dialog component**

**Rationale**:
- Consistent with existing UI
- Accessibility built-in
- Theme integration automatic
- Less code to maintain

**Implementation**:
```tsx
<Dialog open={open} onClose={handleCancel} maxWidth="sm" fullWidth>
  <DialogTitle>Ask a Custom Question</DialogTitle>
  <DialogContent>
    <TextField multiline minRows={4} ... />
  </DialogContent>
  <DialogActions>
    <Button onClick={handleCancel}>Cancel</Button>
    <Button onClick={handleSubmit} variant="contained">Submit</Button>
  </DialogActions>
</Dialog>
```

### 6.5 State Management

**Decision**: Context API vs Redux vs Service class

**Chosen**: **Service class with Lumino signals**

**Rationale**:
- Matches JupyterLab patterns
- No additional dependencies
- Simpler than Redux for this use case
- Integrates with existing plugin system

**Implementation**:
```typescript
export class CellActionService {
  private _settingsChanged = new Signal<this, void>(this);

  get settingsChanged(): ISignal<this, void> {
    return this._settingsChanged;
  }

  setEnabled(enabled: boolean): void {
    if (this._enabled !== enabled) {
      this._enabled = enabled;
      this._settingsChanged.emit();  // Notify listeners
    }
  }
}
```

### 6.6 Backend Integration

**Decision**: New REST endpoints vs WebSocket

**Chosen**: **REST endpoints**

**Rationale**:
- Simpler for request-response pattern
- Matches existing API patterns
- WebSocket reserved for streaming (already used for completions)
- Easier debugging and testing

**Future Consideration**: WebSocket for real-time response streaming

---

## 7. Code Patterns

### 7.1 Plugin Registration Pattern

```typescript
// Define plugin
const cellActionsPlugin: JupyterFrontEndPlugin<ICellActionsPlugin> = {
  id: '@jupyter-agent/core:cell-actions',
  autoStart: true,
  requires: [INotebookTracker, ICommandRegistry],
  optional: [ISettingRegistry, IStatusBar],
  provides: ICellActionsPlugin,
  activate: activateCellActions
};

// Activation function
function activateCellActions(
  app: JupyterFrontEnd,
  notebookTracker: INotebookTracker,
  commands: ICommandRegistry,
  settingRegistry: ISettingRegistry | null,
  statusBar: IStatusBar | null
): ICellActionsPlugin {
  // Create service
  const service = new CellActionService(app, notebookTracker);

  // Register commands
  commands.addCommand('jupyter-agent:explain-cell', {
    label: 'Explain Cell',
    execute: () => service.explainActiveCell()
  });

  // Track notebooks
  notebookTracker.widgetAdded.connect((sender, panel) => {
    service.attachToNotebook(panel);
  });

  return service;
}

// Export in index.ts
export default [
  mainPlugin,
  statusItemPlugin,
  completionPlugin,
  stopStreaming,
  cellActionsPlugin,  // NEW
  ...chatCommandPlugins
];
```

### 7.2 Button Injection Pattern

```typescript
class CellActionService {
  private _attachedNotebooks = new WeakSet<NotebookPanel>();

  attachToNotebook(panel: NotebookPanel): void {
    // Prevent duplicate attachment
    if (this._attachedNotebooks.has(panel)) {
      return;
    }
    this._attachedNotebooks.add(panel);

    const notebook = panel.content;

    // Initial injection
    this._injectButtonsIntoAllCells(notebook);

    // Listen for cell changes
    notebook.model?.cells.changed.connect(() => {
      this._injectButtonsIntoAllCells(notebook);
    });

    // Listen for renders
    panel.content.rendered.connect(() => {
      this._injectButtonsIntoAllCells(notebook);
    });
  }

  private _injectButtonsIntoAllCells(notebook: Notebook): void {
    for (let i = 0; i < notebook.widgets.length; i++) {
      const cell = notebook.widgets[i];
      this._injectButtonsIntoCell(cell);
    }
  }

  private _injectButtonsIntoCell(cell: Cell): void {
    const node = cell.node;

    // Skip if already injected
    if (node.querySelector('.jp-cell-action-buttons')) {
      return;
    }

    // Create and inject buttons
    const buttonWidget = new CellActionButtons({
      cellId: this._ensureCellId(cell),
      onExplain: () => this._explainCell(cell),
      onFix: () => this._fixCell(cell),
      onCustomPrompt: () => this._showCustomPrompt(cell)
    });

    // Insert into DOM
    const inputPrompt = node.querySelector('.jp-InputPrompt');
    if (inputPrompt?.parentElement) {
      inputPrompt.parentElement.appendChild(buttonWidget.node);
    }
  }
}
```

### 7.3 API Call Pattern

```typescript
class CellActionService {
  private async _sendRequest(request: ICellActionRequest): Promise<void> {
    try {
      // Show loading state
      this._app.commands.execute('apputils:notify', {
        message: 'Processing request...',
        type: 'info'
      });

      // Make API call
      const response = await fetch('/api/agent/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(request)
      });

      // Handle HTTP errors
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Parse response
      const result: ICellActionResponse = await response.json();

      // Handle application errors
      if (!result.success) {
        throw new Error(result.error || 'Request failed');
      }

      // Success: open side panel
      await this._app.commands.execute('jupyter-agent:open-chat');

    } catch (error) {
      // Log error
      console.error('Cell action request failed:', error);

      // Notify user
      this._app.commands.execute('apputils:notify', {
        message: 'Failed to process request',
        type: 'error',
        options: { autoClose: 5000 }
      });
    }
  }
}
```

### 7.4 React Component Pattern

```typescript
import React from 'react';
import { ReactWidget } from '@jupyterlab/apputils';
import { JlThemeProvider } from '../components/jl-theme-provider';

interface IMyComponentProps {
  data: string;
  onAction: () => void;
}

// React component
function MyComponent(props: IMyComponentProps): JSX.Element {
  const { data, onAction } = props;

  return (
    <JlThemeProvider>  {/* Always wrap in theme provider */}
      <Box>
        <Typography>{data}</Typography>
        <Button onClick={onAction}>Action</Button>
      </Box>
    </JlThemeProvider>
  );
}

// Lumino widget wrapper
export class MyComponentWidget extends ReactWidget {
  constructor(private props: IMyComponentProps) {
    super();
    this.addClass('jp-my-component');
  }

  render(): JSX.Element {
    return <MyComponent {...this.props} />;
  }
}
```

### 7.5 Settings Integration Pattern

```typescript
// In ChatSettings component
import { CellActionSettings } from './settings/cell-action-settings';

export function ChatSettings(props: IChatSettingsProps): JSX.Element {
  const { cellActionsPlugin } = props;  // Add to props

  return (
    <JlThemeProvider>
      <Box>
        {/* Existing settings */}
        <ModelIdInput ... />
        <ModelParametersInput ... />
        <SecretsSection ... />

        {/* NEW: Cell action settings */}
        <CellActionSettings cellActionsPlugin={cellActionsPlugin} />
      </Box>
    </JlThemeProvider>
  );
}
```

### 7.6 Cell Metadata Pattern

```typescript
// Read metadata
function getCellId(cell: Cell): string | undefined {
  return cell.model.metadata.get('jupyterAgentCellId') as string | undefined;
}

// Write metadata
function setCellId(cell: Cell, id: string): void {
  cell.model.metadata.set('jupyterAgentCellId', id);
}

// Delete metadata
function deleteCellId(cell: Cell): void {
  cell.model.metadata.delete('jupyterAgentCellId');
}

// Ensure ID exists
function ensureCellId(cell: Cell): string {
  let id = getCellId(cell);

  if (!id) {
    id = `cell-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setCellId(cell, id);
  }

  return id;
}
```

---

## 8. Integration Checklist

### 8.1 Frontend Integration

- [ ] **Plugin System**
  - [ ] Create `cell-actions/plugin.ts`
  - [ ] Define `ICellActionsPlugin` token
  - [ ] Implement plugin activation function
  - [ ] Add to main plugin exports in `index.ts`
  - [ ] Register commands in command registry

- [ ] **Service Layer**
  - [ ] Implement `CellActionService` class
  - [ ] Add notebook tracking logic
  - [ ] Implement button injection
  - [ ] Add cell ID management
  - [ ] Implement request sending logic

- [ ] **UI Components**
  - [ ] Create `CellActionButtons` component
  - [ ] Implement button styling with MUI
  - [ ] Create `CustomPromptDialog` component
  - [ ] Add `CellActionSettings` to settings panel
  - [ ] Integrate with existing `ChatSettings`

- [ ] **API Communication**
  - [ ] Add cell action endpoints to `handler.ts`
  - [ ] Implement request/response types
  - [ ] Add error handling
  - [ ] Test API calls

- [ ] **Styling**
  - [ ] Create `cell-actions.css`
  - [ ] Ensure theme consistency
  - [ ] Test light/dark mode
  - [ ] Verify responsive design

### 8.2 Backend Integration

- [ ] **Handlers**
  - [ ] Create `handlers/cell_actions.py`
  - [ ] Implement `CellActionHandler`
  - [ ] Implement `CellActionConfigHandler`
  - [ ] Register handlers in extension loader
  - [ ] Test endpoint responses

- [ ] **Configuration**
  - [ ] Create configuration schema
  - [ ] Implement config loading/saving
  - [ ] Add default prompt templates
  - [ ] Test config persistence

- [ ] **Chat Integration**
  - [ ] Connect to existing chat system
  - [ ] Pass metadata with requests
  - [ ] Enable response streaming
  - [ ] Test message display in side panel

- [ ] **LLM Processing**
  - [ ] Implement prompt template system
  - [ ] Add code context formatting
  - [ ] Test model integration
  - [ ] Verify response quality

### 8.3 Testing

- [ ] **Unit Tests**
  - [ ] Test `CellActionService` methods
  - [ ] Test button component rendering
  - [ ] Test dialog component
  - [ ] Test API handlers

- [ ] **Integration Tests**
  - [ ] Test plugin activation
  - [ ] Test button injection in notebooks
  - [ ] Test API request/response flow
  - [ ] Test chat integration

- [ ] **E2E Tests**
  - [ ] Test explain button flow
  - [ ] Test fix button flow
  - [ ] Test custom prompt flow
  - [ ] Test settings UI

- [ ] **Accessibility Tests**
  - [ ] Keyboard navigation
  - [ ] Screen reader support
  - [ ] Focus management
  - [ ] ARIA labels

### 8.4 Documentation

- [ ] **Developer Documentation**
  - [ ] Architecture overview
  - [ ] API documentation
  - [ ] Component documentation
  - [ ] Development setup guide

- [ ] **User Documentation**
  - [ ] Feature overview
  - [ ] Button usage guide
  - [ ] Configuration guide
  - [ ] Troubleshooting

- [ ] **Code Documentation**
  - [ ] TSDoc comments
  - [ ] Python docstrings
  - [ ] README files
  - [ ] CHANGELOG updates

### 8.5 Performance

- [ ] **Optimization**
  - [ ] Test with large notebooks (>100 cells)
  - [ ] Optimize button injection
  - [ ] Test memory usage
  - [ ] Profile rendering performance

- [ ] **Caching**
  - [ ] Cache cell IDs
  - [ ] Cache button widgets
  - [ ] Optimize re-renders
  - [ ] Test cache invalidation

### 8.6 Deployment

- [ ] **Build System**
  - [ ] Update package.json
  - [ ] Configure TypeScript
  - [ ] Test production build
  - [ ] Verify extension loading

- [ ] **Distribution**
  - [ ] Create release package
  - [ ] Test installation
  - [ ] Update version numbers
  - [ ] Create release notes

---

## 9. File Reference Summary

### 9.1 New Files to Create

| File Path | Purpose | Lines Est. | Priority |
|-----------|---------|------------|----------|
| `src/cell-actions/plugin.ts` | Plugin registration | 150 | P0 |
| `src/cell-actions/service.ts` | Core service logic | 400 | P0 |
| `src/cell-actions/types.ts` | TypeScript interfaces | 100 | P0 |
| `src/cell-actions/components/cell-action-buttons.tsx` | Button UI | 200 | P0 |
| `src/cell-actions/components/custom-prompt-dialog.tsx` | Dialog UI | 250 | P1 |
| `src/components/settings/cell-action-settings.tsx` | Settings UI | 150 | P1 |
| `jupyter_agent/handlers/cell_actions.py` | Backend handlers | 300 | P0 |
| `jupyter_agent/config/cell_actions.py` | Configuration | 100 | P1 |
| `style/cell-actions.css` | Styling | 100 | P1 |
| `schema/cell-action-config.json` | JSON schema | 50 | P2 |

### 9.2 Files to Modify

| File Path | Changes Required | Priority |
|-----------|------------------|----------|
| `src/index.ts` | Add cell actions plugin export | P0 |
| `src/tokens.ts` | Add ICellActionsPlugin token | P0 |
| `src/handler.ts` | Add cell action API calls | P0 |
| `src/components/chat-settings.tsx` | Integrate CellActionSettings | P1 |
| `jupyter_agent/__init__.py` | Register new handlers | P0 |
| `package.json` | Update dependencies | P1 |
| `style/index.css` | Import cell-actions.css | P1 |

### 9.3 Files to Reference (Preserved)

| File Path | Purpose | Do Not Modify |
|-----------|---------|---------------|
| `src/theme-provider.ts` | Theme integration | ✓ |
| `src/components/jl-theme-provider.tsx` | Theme wrapper | ✓ |
| `src/components/mui-extras/*` | MUI helpers | ✓ |
| `src/completions/*` | Completion system | ✓ |
| `src/contexts/*` | React contexts | ✓ |

---

## 10. Development Workflow

### 10.1 Setup

```bash
# Clone repository
git clone <repo-url> jupyter-agent
cd jupyter-agent

# Install dependencies
cd packages/jupyter-agent
npm install  # or jlpm install

# Install Python dependencies
pip install -e .

# Build extension
npm run build

# Install extension in development mode
jupyter labextension develop . --overwrite
```

### 10.2 Development Loop

```bash
# Terminal 1: Watch TypeScript compilation
npm run watch

# Terminal 2: Watch labextension build
npm run watch:labextension

# Terminal 3: Run JupyterLab
jupyter lab --watch
```

### 10.3 Testing

```bash
# Run frontend tests
npm test

# Run backend tests
pytest

# Run E2E tests
npm run test:e2e

# Run linting
npm run lint
```

---

## 11. Success Criteria

### 11.1 Functional Requirements

- ✅ E button explains cell code via LLM
- ✅ F button fixes cell errors via LLM
- ✅ ? button opens custom prompt dialog
- ✅ Buttons appear next to cell input prompts
- ✅ Responses display in side panel chat
- ✅ Settings UI allows enable/disable
- ✅ Cell IDs persist across sessions

### 11.2 Non-Functional Requirements

- ✅ Performance: <100ms button injection per cell
- ✅ Accessibility: WCAG 2.1 AA compliance
- ✅ Compatibility: JupyterLab 4.x support
- ✅ Browser Support: Chrome, Firefox, Safari, Edge
- ✅ Theme Integration: Light and dark mode support
- ✅ Responsive: Works on tablets (≥768px width)

### 11.3 Quality Metrics

- ✅ Test Coverage: ≥80% for new code
- ✅ TypeScript: Strict mode, no any types
- ✅ Linting: Zero ESLint/Pylint errors
- ✅ Documentation: All public APIs documented
- ✅ Performance: No memory leaks in 1-hour session

---

## 12. Risk Assessment

### 12.1 Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Button injection performance issues | Medium | High | Implement efficient deduplication, use WeakSet tracking |
| Cell ID conflicts | Low | Medium | Use timestamp + random string, validate uniqueness |
| Theme integration breaks | Low | Medium | Follow existing patterns, test light/dark modes |
| Notebook save issues with metadata | Low | High | Use standard Jupyter metadata, test .ipynb format |
| API response streaming issues | Medium | Medium | Leverage existing chat streaming infrastructure |

### 12.2 Integration Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Conflict with other extensions | Low | Medium | Use unique CSS classes, namespace properly |
| JupyterLab version compatibility | Medium | High | Test on JupyterLab 4.0+, document requirements |
| Backend chat system changes | Low | High | Use stable APIs, abstract integration layer |
| Model provider changes | Low | Medium | Use existing LiteLLM abstraction |

---

## Appendix A: ASCII Diagrams

### A.1 Complete System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         JupyterLab Application                       │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌───────────────────────────┐    ┌──────────────────────────────┐  │
│  │     Notebook Panel        │    │      Side Panel              │  │
│  │                           │    │                              │  │
│  │  ┌─────────────────────┐  │    │  ┌────────────────────────┐ │  │
│  │  │ Cell 1              │  │    │  │  Chat Settings         │ │  │
│  │  │ ┌─────────────────┐ │  │    │  │  - Model Config        │ │  │
│  │  │ │ [In 1]:         │ │  │    │  │  - Secrets Section     │ │  │
│  │  │ │ [E][F][?]       │ │  │◄───┼──┤  - Cell Action Settings│ │  │
│  │  │ └─────────────────┘ │  │    │  └────────────────────────┘ │  │
│  │  │ ┌─────────────────┐ │  │    │                              │  │
│  │  │ │ Code: print('x')│ │  │    │  ┌────────────────────────┐ │  │
│  │  │ └─────────────────┘ │  │    │  │  Chat Interface        │ │  │
│  │  │ ┌─────────────────┐ │  │    │  │  ┌──────────────────┐  │ │  │
│  │  │ │ Output: x       │ │  │    │  │  │ User: [E button] │  │ │  │
│  │  │ └─────────────────┘ │  │    │  │  ├──────────────────┤  │ │  │
│  │  └─────────────────────┘  │    │  │  │ AI: This code... │  │ │  │
│  │                           │    │  │  └──────────────────┘  │ │  │
│  │  ┌─────────────────────┐  │    │  │                        │ │  │
│  │  │ Cell 2              │  │    │  │  [Message Input]       │ │  │
│  │  │ [In 2]: [E][F][?]   │  │    │  └────────────────────────┘ │  │
│  │  └─────────────────────┘  │    │                              │  │
│  │                           │    └──────────────────────────────┘  │
│  └───────────────────────────┘                                      │
│                 ▲                              ▲                    │
│                 │                              │                    │
└─────────────────┼──────────────────────────────┼────────────────────┘
                  │                              │
    ┌─────────────┴───────┐        ┌────────────┴─────────────┐
    │ CellActionService   │        │   ChatSettings Widget    │
    │ - Button injection  │        │   - Settings management  │
    │ - Request handling  │        │   - UI rendering         │
    │ - Cell tracking     │        │   - Theme integration    │
    └─────────────────────┘        └──────────────────────────┘
                  │                              │
                  └──────────────┬───────────────┘
                                 │
                  ┌──────────────┴──────────────┐
                  │    Backend REST API         │
                  │  /api/agent/action          │
                  │  /api/agent/config          │
                  └──────────────┬──────────────┘
                                 │
                  ┌──────────────┴──────────────┐
                  │    LLM Processing           │
                  │  - Prompt generation        │
                  │  - Model invocation         │
                  │  - Response streaming       │
                  └─────────────────────────────┘
```

### A.2 Button Injection Flow

```
Notebook Load/Cell Render
         │
         ▼
┌────────────────────────┐
│ notebookTracker        │
│  .widgetAdded event    │
└───────────┬────────────┘
            │
            ▼
┌────────────────────────┐
│ CellActionService      │
│  .attachToNotebook()   │
└───────────┬────────────┘
            │
            ├─> Check if already attached (WeakSet)
            │
            ├─> Listen to notebook.model.cells.changed
            │
            └─> Listen to panel.content.rendered
                    │
                    ▼
         ┌──────────────────────────┐
         │ _injectButtonsIntoAllCells│
         └─────────────┬─────────────┘
                       │
                       ▼
              ┌────────────────┐
              │ For each cell: │
              └────────┬───────┘
                       │
                       ▼
         ┌──────────────────────────┐
         │ _injectButtonsIntoCell() │
         └─────────────┬────────────┘
                       │
                       ├─> Check if buttons exist (skip if yes)
                       │
                       ├─> Ensure cell has ID in metadata
                       │
                       ├─> Create CellActionButtons widget
                       │
                       └─> Insert into DOM next to InputPrompt
                                │
                                ▼
                    ┌────────────────────────┐
                    │ Buttons visible in UI  │
                    └────────────────────────┘
```

### A.3 Message Flow (E Button Example)

```
User clicks [E] button
         │
         ▼
┌───────────────────────┐
│ Button onClick        │
│  - Get cell content   │
│  - Get cell ID        │
│  - Get cell index     │
└──────────┬────────────┘
           │
           ▼
┌───────────────────────────────┐
│ CellActionService             │
│  .explainActiveCell()         │
│   - Validate content not empty│
│   - Prepare request payload   │
└──────────┬────────────────────┘
           │
           ▼
┌───────────────────────────────┐
│ _sendRequest()                │
│  POST /api/agent/action       │
│  {                            │
│    type: 'EXPLAIN_CELL',      │
│    content: cellCode,         │
│    cellId: 'cell-xxx',        │
│    cellIndex: 0               │
│  }                            │
└──────────┬────────────────────┘
           │
           ▼
┌───────────────────────────────┐
│ Backend: CellActionHandler    │
│  .post()                      │
│   - Validate request          │
│   - Extract fields            │
│   - Route to _process_explain │
└──────────┬────────────────────┘
           │
           ▼
┌───────────────────────────────┐
│ _process_explain()            │
│  - Format prompt template     │
│  - Call LLM                   │
│  - Send to chat system        │
└──────────┬────────────────────┘
           │
           ▼
┌───────────────────────────────┐
│ Chat System                   │
│  - Receive message            │
│  - Stream LLM response        │
│  - Display in side panel      │
└───────────────────────────────┘
           │
           ▼
┌───────────────────────────────┐
│ Frontend: Side Panel          │
│  - Message appears            │
│  - Streaming text display     │
│  - User sees explanation      │
└───────────────────────────────┘
```

---

## Conclusion

This comprehensive design specification provides a production-ready blueprint for implementing the Jupyter Agent extension. The design successfully merges:

1. **Jupyter AI's proven architecture**: Plugin system, theme integration, settings management
2. **Chrome Agent's enhanced UX**: Cell-level action buttons with targeted AI assistance
3. **Modern best practices**: TypeScript, React, Material-UI, accessibility compliance

**Key Strengths**:
- Modular plugin-based architecture enabling independent feature development
- Seamless JupyterLab integration using native APIs and patterns
- Type-safe implementation with comprehensive TypeScript interfaces
- Accessible UI following WCAG 2.1 AA standards
- Extensible design allowing future feature additions

**Next Steps**:
1. Review and approve this specification
2. Begin Phase 1 implementation (Foundation)
3. Establish CI/CD pipeline for testing
4. Create development branch and project board
5. Schedule weekly progress reviews

**Estimated Timeline**: 10 weeks from start to production-ready release

**Document Version**: 1.0.0
**Last Updated**: October 31, 2025
**Status**: Ready for Implementation
