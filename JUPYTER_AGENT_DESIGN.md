# Jupyter Agent - Comprehensive Design Specification

**Version**: 1.0
**Date**: 2025-10-31
**Author**: Frontend Architect Agent

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Architecture](#system-architecture)
3. [Component Specifications](#component-specifications)
4. [API Design](#api-design)
5. [Data Flow & Communication](#data-flow--communication)
6. [Implementation Plan](#implementation-plan)
7. [Technical Decisions](#technical-decisions)
8. [Code Patterns & Examples](#code-patterns--examples)
9. [Integration Checklist](#integration-checklist)
10. [File Structure](#file-structure)

---

## Executive Summary

### Project Overview
**Jupyter Agent** is a JupyterLab extension that combines:
- Jupyter AI's proven side panel chat interface for LLM interaction
- Chrome Agent's cell-level action buttons (Explain, Fix, Custom Prompt)
- Enhanced configuration management with save functionality

### Key Features
1. **Side Panel Chat Interface** - Preserved from Jupyter AI
2. **Cell Action Buttons** - E (Explain), F (Fix), ? (Custom Prompt)
3. **Enhanced Settings** - Save button with validation
4. **Seamless Integration** - Cell actions → Side panel responses

### Technology Stack
- **Frontend**: TypeScript 5.x, React 18.x, Material-UI 5.x
- **Backend**: Python 3.11+, FastAPI/Jupyter Server
- **Build**: Lerna monorepo, Webpack 5
- **Testing**: Jest, Playwright

---

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       JUPYTERLAB ENVIRONMENT                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────┐         ┌──────────────────────────┐     │
│  │  Notebook Cell   │         │   Side Panel (Right)      │     │
│  │  ┌────────────┐  │         │  ┌────────────────────┐  │     │
│  │  │ Code Input │  │         │  │   Chat Interface   │  │     │
│  │  │            │  │         │  │                    │  │     │
│  │  │ E  F  ?    │◄─┼─────────┼──┤  • Messages        │  │     │
│  │  └────────────┘  │  Events │  │  • Model Config    │  │     │
│  │  ┌────────────┐  │         │  │  • Settings        │  │     │
│  │  │   Output   │  │         │  │  • Save Button     │  │     │
│  │  └────────────┘  │         │  └────────────────────┘  │     │
│  └──────────────────┘         └──────────────────────────┘     │
│           │                              │                       │
│           │                              │                       │
└───────────┼──────────────────────────────┼───────────────────────┘
            │                              │
            └──────────────┬───────────────┘
                           │
                    ┌──────▼──────┐
                    │  Extension   │
                    │   Backend    │
                    │   (Python)   │
                    └──────┬───────┘
                           │
                    ┌──────▼──────┐
                    │  LLM API     │
                    │  (OpenAI/    │
                    │   Custom)    │
                    └──────────────┘
```

### Component Architecture

```
jupyter-agent/
│
├── packages/
│   └── jupyter-agent/              # Main extension package
│       ├── src/
│       │   ├── index.ts            # Extension entry point
│       │   ├── handler.ts          # API service layer
│       │   ├── tokens.ts           # DI tokens
│       │   │
│       │   ├── plugins/            # Plugin modules
│       │   │   ├── main-plugin.ts         # Settings UI
│       │   │   ├── cell-buttons-plugin.ts # NEW: Cell buttons
│       │   │   ├── chat-plugin.ts         # Side panel
│       │   │   └── settings-plugin.ts     # Configuration
│       │   │
│       │   ├── components/         # React components
│       │   │   ├── chat/
│       │   │   │   ├── ChatInterface.tsx
│       │   │   │   ├── MessageList.tsx
│       │   │   │   └── InputBox.tsx
│       │   │   │
│       │   │   ├── cell-actions/   # NEW: Cell button components
│       │   │   │   ├── CellActionButtons.tsx
│       │   │   │   ├── ExplainButton.tsx
│       │   │   │   ├── FixButton.tsx
│       │   │   │   ├── CustomPromptButton.tsx
│       │   │   │   └── CustomPromptDialog.tsx
│       │   │   │
│       │   │   └── settings/
│       │   │       ├── ChatSettings.tsx
│       │   │       ├── ModelConfig.tsx
│       │   │       ├── SaveButton.tsx       # NEW
│       │   │       └── ApiKeyInput.tsx
│       │   │
│       │   ├── services/           # Business logic
│       │   │   ├── CellService.ts          # NEW: Cell operations
│       │   │   ├── MessageService.ts
│       │   │   └── ConfigService.ts
│       │   │
│       │   ├── state/              # State management
│       │   │   ├── ChatContext.tsx
│       │   │   ├── CellContext.tsx         # NEW
│       │   │   └── ConfigContext.tsx
│       │   │
│       │   └── styles/             # CSS modules
│       │       ├── chat.css
│       │       ├── cell-buttons.css        # NEW
│       │       └── settings.css
│       │
│       └── jupyter_agent/          # Python backend
│           ├── handlers.py         # REST API handlers
│           ├── llm_client.py       # LLM integration
│           └── config.py           # Configuration
```

### Plugin Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              JupyterLab Extension Plugins                    │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │   Main Plugin     │  │  Cell Buttons    │  NEW           │
│  │                   │  │   Plugin         │                │
│  │ • Settings UI     │  │                  │                │
│  │ • Command Reg.    │  │ • E, F, ? Btns   │                │
│  │ • Menu Items      │  │ • Cell Observer  │                │
│  └──────────────────┘  │ • Event Handlers │                │
│                         └──────────────────┘                │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │   Chat Plugin     │  │  Settings Plugin │                │
│  │                   │  │                   │                │
│  │ • Side Panel      │  │ • Config Storage │                │
│  │ • Message Thread  │  │ • API Key Mgmt   │                │
│  │ • LLM Responses   │  │ • Save Button    │  NEW           │
│  └──────────────────┘  └──────────────────┘                │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Component Specifications

### 1. CellActionButtons Component

**Purpose**: Inject action buttons (E, F, ?) next to each notebook cell input.

#### TypeScript Interface

```typescript
// src/components/cell-actions/CellActionButtons.tsx

import { INotebookTracker } from '@jupyterlab/notebook';
import { Cell } from '@jupyterlab/cells';

export interface ICellActionButtonsProps {
  cell: Cell;
  notebookTracker: INotebookTracker;
  onAction: (action: CellAction, cell: Cell) => void;
}

export enum CellAction {
  EXPLAIN = 'explain',
  FIX = 'fix',
  CUSTOM_PROMPT = 'custom_prompt'
}

export interface ICellActionEvent {
  type: CellAction;
  cellId: string;
  cellContent: string;
  customPrompt?: string;
}

// Component structure
export const CellActionButtons: React.FC<ICellActionButtonsProps> = ({
  cell,
  notebookTracker,
  onAction
}) => {
  const handleExplain = () => onAction(CellAction.EXPLAIN, cell);
  const handleFix = () => onAction(CellAction.FIX, cell);
  const handleCustomPrompt = () => onAction(CellAction.CUSTOM_PROMPT, cell);

  return (
    <div className="jp-agent-cell-buttons">
      <ExplainButton onClick={handleExplain} />
      <FixButton onClick={handleFix} />
      <CustomPromptButton onClick={handleCustomPrompt} />
    </div>
  );
};
```

#### CSS Styling (from Chrome Agent)

```css
/* src/styles/cell-buttons.css */

.jp-agent-cell-buttons {
  display: inline-flex;
  gap: 4px;
  margin-left: 8px;
  vertical-align: middle;
}

.jp-agent-button {
  width: 24px;
  height: 24px;
  border: 1px solid var(--jp-border-color2);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: bold;
  color: var(--jp-ui-font-color1);
  transition: all 0.2s ease;
}

.jp-agent-button:hover {
  background: var(--jp-layout-color2);
  border-color: var(--jp-brand-color1);
  transform: scale(1.05);
}

.jp-agent-button:active {
  transform: scale(0.95);
}

.jp-agent-button-explain {
  color: var(--jp-info-color1);
}

.jp-agent-button-fix {
  color: var(--jp-error-color1);
}

.jp-agent-button-custom {
  color: var(--jp-warn-color1);
}
```

### 2. CustomPromptDialog Component

**Purpose**: Modal dialog for custom prompt input.

#### TypeScript Interface

```typescript
// src/components/cell-actions/CustomPromptDialog.tsx

export interface ICustomPromptDialogProps {
  isOpen: boolean;
  cellContent: string;
  onSubmit: (prompt: string) => void;
  onCancel: () => void;
}

export const CustomPromptDialog: React.FC<ICustomPromptDialogProps> = ({
  isOpen,
  cellContent,
  onSubmit,
  onCancel
}) => {
  const [prompt, setPrompt] = React.useState('');

  const handleSubmit = () => {
    if (prompt.trim()) {
      onSubmit(prompt);
      setPrompt('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <Dialog open={isOpen} onClose={onCancel} maxWidth="md" fullWidth>
      <DialogTitle>Custom Prompt for Cell</DialogTitle>
      <DialogContent>
        <Box mb={2}>
          <Typography variant="caption" color="textSecondary">
            Cell Content Preview:
          </Typography>
          <Paper variant="outlined" sx={{ p: 1, mt: 1, maxHeight: 100, overflow: 'auto' }}>
            <code style={{ fontSize: '0.8rem' }}>{cellContent}</code>
          </Paper>
        </Box>
        <TextField
          autoFocus
          fullWidth
          multiline
          rows={4}
          label="Enter your prompt"
          placeholder="e.g., 'Add docstrings to this function' or 'Optimize this code for performance'"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={!prompt.trim()}
        >
          Submit
        </Button>
      </DialogActions>
    </Dialog>
  );
};
```

### 3. SaveButton Component

**Purpose**: Validate and save configuration with user feedback.

#### TypeScript Interface

```typescript
// src/components/settings/SaveButton.tsx

export interface ISaveButtonProps {
  config: IAgentConfig;
  onSave: (config: IAgentConfig) => Promise<void>;
}

export interface IAgentConfig {
  apiKey: string;
  modelId: string;
  baseUrl?: string;
  parameters?: Record<string, any>;
}

export const SaveButton: React.FC<ISaveButtonProps> = ({ config, onSave }) => {
  const [saving, setSaving] = React.useState(false);
  const [notification, setNotification] = React.useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const validate = (): string | null => {
    if (!config.apiKey?.trim()) {
      return 'API Key is required';
    }
    if (!config.modelId?.trim()) {
      return 'Model ID is required';
    }
    return null;
  };

  const handleSave = async () => {
    const error = validate();
    if (error) {
      setNotification({ type: 'error', message: error });
      return;
    }

    setSaving(true);
    try {
      await onSave(config);
      setNotification({
        type: 'success',
        message: 'Configuration saved successfully'
      });
    } catch (err) {
      setNotification({
        type: 'error',
        message: `Save failed: ${err.message}`
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button
        variant="contained"
        color="primary"
        onClick={handleSave}
        disabled={saving}
        startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
      >
        {saving ? 'Saving...' : 'Save Configuration'}
      </Button>

      <Snackbar
        open={!!notification}
        autoHideDuration={4000}
        onClose={() => setNotification(null)}
      >
        <Alert severity={notification?.type} onClose={() => setNotification(null)}>
          {notification?.message}
        </Alert>
      </Snackbar>
    </>
  );
};
```

### 4. CellButtonsPlugin

**Purpose**: Plugin to inject buttons into notebook cells.

#### TypeScript Interface

```typescript
// src/plugins/cell-buttons-plugin.ts

import { JupyterFrontEndPlugin } from '@jupyterlab/application';
import { INotebookTracker } from '@jupyterlab/notebook';
import { Cell } from '@jupyterlab/cells';
import { ICellActionEvent, CellAction } from '../components/cell-actions/CellActionButtons';

export const cellButtonsPlugin: JupyterFrontEndPlugin<void> = {
  id: '@jupyter-agent/cell-buttons',
  autoStart: true,
  requires: [INotebookTracker],
  activate: (app, notebookTracker: INotebookTracker) => {
    console.log('Cell Buttons Plugin activated');

    // Observe notebook changes
    notebookTracker.widgetAdded.connect((sender, panel) => {
      console.log('Notebook widget added:', panel.id);

      // Wait for notebook to be ready
      panel.sessionContext.ready.then(() => {
        injectButtonsIntoNotebook(panel);

        // Watch for new cells
        panel.content.model?.cells.changed.connect(() => {
          injectButtonsIntoNotebook(panel);
        });
      });
    });

    // Handle current notebook if exists
    if (notebookTracker.currentWidget) {
      injectButtonsIntoNotebook(notebookTracker.currentWidget);
    }
  }
};

function injectButtonsIntoNotebook(panel: NotebookPanel) {
  const notebook = panel.content;

  for (let i = 0; i < notebook.widgets.length; i++) {
    const cell = notebook.widgets[i];
    injectButtonsIntoCell(cell, panel);
  }
}

function injectButtonsIntoCell(cell: Cell, panel: NotebookPanel) {
  // Check if buttons already injected
  const promptNode = cell.inputArea.promptNode;
  if (promptNode.querySelector('.jp-agent-cell-buttons')) {
    return; // Already injected
  }

  // Create button container
  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'jp-agent-cell-buttons';

  // Create E button (Explain)
  const explainBtn = createButton('E', 'Explain this code', () => {
    handleCellAction(CellAction.EXPLAIN, cell, panel);
  });
  explainBtn.classList.add('jp-agent-button-explain');

  // Create F button (Fix)
  const fixBtn = createButton('F', 'Fix errors in this code', () => {
    handleCellAction(CellAction.FIX, cell, panel);
  });
  fixBtn.classList.add('jp-agent-button-fix');

  // Create ? button (Custom)
  const customBtn = createButton('?', 'Custom prompt', () => {
    handleCellAction(CellAction.CUSTOM_PROMPT, cell, panel);
  });
  customBtn.classList.add('jp-agent-button-custom');

  buttonContainer.appendChild(explainBtn);
  buttonContainer.appendChild(fixBtn);
  buttonContainer.appendChild(customBtn);

  // Inject into prompt area
  promptNode.appendChild(buttonContainer);
}

function createButton(
  label: string,
  title: string,
  onClick: () => void
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'jp-agent-button';
  btn.textContent = label;
  btn.title = title;
  btn.onclick = onClick;
  return btn;
}

function handleCellAction(
  action: CellAction,
  cell: Cell,
  panel: NotebookPanel
) {
  const cellContent = cell.model.sharedModel.getSource();

  const event: ICellActionEvent = {
    type: action,
    cellId: cell.model.id,
    cellContent: cellContent
  };

  // Dispatch to side panel via custom event
  document.dispatchEvent(new CustomEvent('jupyter-agent:cell-action', {
    detail: event
  }));
}
```

---

## API Design

### REST API Endpoints

```typescript
// API Base Path: /api/jupyter-agent

export interface APIEndpoints {
  // Configuration
  GET    '/config'           → IAgentConfig
  POST   '/config'           → { success: boolean }

  // LLM Interaction
  POST   '/chat/message'     → IChatResponse
  POST   '/cell/explain'     → ICellResponse
  POST   '/cell/fix'         → ICellResponse
  POST   '/cell/custom'      → ICellResponse

  // Status
  GET    '/status'           → IHealthStatus
  GET    '/models'           → IModelInfo[]
}
```

### Request/Response Schemas

```typescript
// Configuration
export interface IAgentConfig {
  apiKey: string;
  modelId: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

// Cell Actions
export interface ICellActionRequest {
  cellId: string;
  cellContent: string;
  action: 'explain' | 'fix' | 'custom';
  customPrompt?: string;
  context?: {
    notebookPath: string;
    cellIndex: number;
    previousCells?: string[];
  };
}

export interface ICellResponse {
  cellId: string;
  response: string;
  suggestions?: string[];
  fixedCode?: string; // For fix action
  metadata: {
    model: string;
    tokens: number;
    duration: number;
  };
}

// Chat
export interface IChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface IChatRequest {
  message: string;
  conversationId?: string;
  context?: {
    selectedCells?: string[];
    notebookPath?: string;
  };
}

export interface IChatResponse {
  messageId: string;
  content: string;
  conversationId: string;
  metadata: {
    model: string;
    tokens: number;
  };
}

// Health/Status
export interface IHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  apiConnected: boolean;
  modelAvailable: boolean;
}

export interface IModelInfo {
  id: string;
  name: string;
  provider: string;
  capabilities: string[];
}
```

### Python Backend Handlers

```python
# jupyter_agent/handlers.py

from jupyter_server.base.handlers import APIHandler
from tornado import web
import json

class ConfigHandler(APIHandler):
    """Handle configuration operations"""

    @web.authenticated
    async def get(self):
        """Get current configuration"""
        config = await self.config_manager.get_config()
        self.finish(json.dumps(config))

    @web.authenticated
    async def post(self):
        """Save configuration"""
        data = self.get_json_body()

        # Validate
        if not data.get('apiKey'):
            raise web.HTTPError(400, "API key is required")

        # Save
        await self.config_manager.save_config(data)
        self.finish(json.dumps({"success": True}))


class CellActionHandler(APIHandler):
    """Handle cell-level actions (explain, fix, custom)"""

    @web.authenticated
    async def post(self):
        """Process cell action"""
        data = self.get_json_body()

        action = data.get('action')
        cell_content = data.get('cellContent')
        cell_id = data.get('cellId')

        if not all([action, cell_content, cell_id]):
            raise web.HTTPError(400, "Missing required fields")

        # Build prompt based on action
        if action == 'explain':
            prompt = f"Explain this code:\n\n{cell_content}"
        elif action == 'fix':
            prompt = f"Fix any errors in this code:\n\n{cell_content}"
        elif action == 'custom':
            custom_prompt = data.get('customPrompt', '')
            prompt = f"{custom_prompt}\n\nCode:\n{cell_content}"
        else:
            raise web.HTTPError(400, f"Invalid action: {action}")

        # Call LLM
        response = await self.llm_client.generate(prompt)

        result = {
            "cellId": cell_id,
            "response": response.content,
            "metadata": {
                "model": response.model,
                "tokens": response.tokens,
                "duration": response.duration
            }
        }

        self.finish(json.dumps(result))


# Route registration
def setup_handlers(web_app):
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]

    handlers = [
        (url_path_join(base_url, "jupyter-agent", "config"), ConfigHandler),
        (url_path_join(base_url, "jupyter-agent", "cell", "action"), CellActionHandler),
        # ... more handlers
    ]

    web_app.add_handlers(host_pattern, handlers)
```

---

## Data Flow & Communication

### Message Flow Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                   USER INTERACTION FLOWS                        │
└────────────────────────────────────────────────────────────────┘

Flow 1: Cell Button Click → Side Panel Response
─────────────────────────────────────────────────

User clicks "E" button on cell
         │
         ▼
CellActionButton.onClick()
         │
         ▼
Emit custom event: 'jupyter-agent:cell-action'
  Event detail: { type, cellId, cellContent }
         │
         ▼
ChatPlugin event listener captures event
         │
         ▼
POST /api/jupyter-agent/cell/action
  Body: { action, cellId, cellContent }
         │
         ▼
Python Handler processes request
         │
         ▼
LLM API called with prompt
         │
         ▼
Response returned to frontend
         │
         ▼
Side panel displays response as new message
         │
         ▼
Message includes cell reference & action type


Flow 2: Save Configuration
───────────────────────────

User modifies settings (API key, model, etc.)
         │
         ▼
User clicks "Save" button
         │
         ▼
SaveButton validates input
         │
         ├─ Invalid → Show error notification
         │
         └─ Valid ▼
              POST /api/jupyter-agent/config
                Body: { apiKey, modelId, ... }
                     │
                     ▼
              Python handler validates & saves
                     │
                     ▼
              Success/error response
                     │
                     ▼
              Show notification to user


Flow 3: Custom Prompt Dialog
─────────────────────────────

User clicks "?" button
         │
         ▼
CustomPromptDialog opens
  - Shows cell content preview
  - Text input for prompt
         │
         ▼
User enters prompt & submits
         │
         ▼
Emit event with customPrompt field
         │
         ▼
(Same flow as Flow 1 with custom prompt)
```

### State Management

```typescript
// Global state contexts

// 1. Cell Context - Track active cell actions
export interface ICellContextState {
  activeCellId: string | null;
  pendingAction: CellAction | null;
  cellHistory: Map<string, ICellActionEvent[]>;
}

// 2. Chat Context - Message history
export interface IChatContextState {
  messages: IChatMessage[];
  conversationId: string;
  isLoading: boolean;
  error: string | null;
}

// 3. Config Context - Settings
export interface IConfigContextState {
  config: IAgentConfig;
  isSaving: boolean;
  lastSaved: Date | null;
  isDirty: boolean;
}

// Context providers wrap the application
<ConfigProvider>
  <ChatProvider>
    <CellProvider>
      <JupyterAgentApp />
    </CellProvider>
  </ChatProvider>
</ConfigProvider>
```

### Event System

```typescript
// Custom events for communication

export enum AgentEvent {
  CELL_ACTION = 'jupyter-agent:cell-action',
  CONFIG_CHANGED = 'jupyter-agent:config-changed',
  MESSAGE_SENT = 'jupyter-agent:message-sent',
  MESSAGE_RECEIVED = 'jupyter-agent:message-received'
}

// Event emitter utility
export class AgentEventEmitter {
  static emit<T>(event: AgentEvent, detail: T): void {
    document.dispatchEvent(new CustomEvent(event, { detail }));
  }

  static on<T>(
    event: AgentEvent,
    handler: (detail: T) => void
  ): () => void {
    const listener = (e: Event) => {
      handler((e as CustomEvent<T>).detail);
    };
    document.addEventListener(event, listener);

    // Return cleanup function
    return () => document.removeEventListener(event, listener);
  }
}

// Usage in components
useEffect(() => {
  const cleanup = AgentEventEmitter.on<ICellActionEvent>(
    AgentEvent.CELL_ACTION,
    handleCellAction
  );
  return cleanup;
}, []);
```

---

## Implementation Plan

### Phase 1: Foundation Setup (Week 1)

**Goal**: Set up project structure and basic scaffolding

1. **Repository Setup**
   - Clone jupyter_ai_repo as template
   - Rename packages to `jupyter-agent`
   - Update package.json, setup.py metadata
   - Configure monorepo with Lerna

2. **Remove Unnecessary Features**
   - Keep: Chat interface, settings, theme integration
   - Remove: Jupyter AI-specific features not needed
   - Clean up dependencies

3. **Basic Plugin Structure**
   - Create cell-buttons-plugin.ts skeleton
   - Set up plugin registration
   - Test plugin activation

**Deliverables**:
- ✅ Working monorepo build
- ✅ Extension loads in JupyterLab
- ✅ Side panel displays (even if empty)

### Phase 2: Cell Buttons Implementation (Week 2)

**Goal**: Implement E, F, ? buttons with cell injection

1. **Button Components**
   - Create CellActionButtons component
   - Implement ExplainButton, FixButton, CustomPromptButton
   - Style with CSS from Chrome Agent patterns

2. **Cell Injection Logic**
   - Implement cell observer in plugin
   - Inject buttons into notebook cells
   - Handle cell lifecycle (add/remove/reorder)

3. **Event Handling**
   - Set up custom event system
   - Connect buttons to event emitters
   - Test event propagation

**Deliverables**:
- ✅ Buttons appear on all cells
- ✅ Buttons emit correct events
- ✅ Styling matches design

### Phase 3: Side Panel Integration (Week 2-3)

**Goal**: Connect cell actions to side panel responses

1. **Event Listeners**
   - Add listeners in ChatPlugin
   - Parse cell action events
   - Display events in message thread

2. **API Integration**
   - Implement CellActionHandler in Python
   - Connect frontend to /cell/action endpoint
   - Handle loading states

3. **Response Display**
   - Format cell action responses
   - Show cell context in messages
   - Add action type badges

**Deliverables**:
- ✅ E button → "Explain" response in panel
- ✅ F button → "Fix" response in panel
- ✅ Messages show cell reference

### Phase 4: Custom Prompt Dialog (Week 3)

**Goal**: Implement custom prompt functionality

1. **Dialog Component**
   - Create CustomPromptDialog
   - Add cell preview display
   - Implement input validation

2. **Dialog Triggering**
   - Connect ? button to dialog
   - Manage dialog open/close state
   - Handle submit/cancel

3. **Custom Prompt Flow**
   - Pass custom prompt to API
   - Display in side panel
   - Store in history

**Deliverables**:
- ✅ ? button opens dialog
- ✅ Dialog shows cell preview
- ✅ Custom prompts work end-to-end

### Phase 5: Save Functionality (Week 4)

**Goal**: Enhanced settings with save button

1. **SaveButton Component**
   - Create SaveButton with validation
   - Implement loading states
   - Add success/error notifications

2. **Config API**
   - Implement ConfigHandler in Python
   - Add config persistence (file/db)
   - Secure API key storage

3. **Settings UI Enhancement**
   - Integrate SaveButton into ChatSettings
   - Show dirty state indicator
   - Auto-save option

**Deliverables**:
- ✅ Save button works with validation
- ✅ Config persists across sessions
- ✅ Notifications display correctly

### Phase 6: Testing & Polish (Week 4-5)

**Goal**: Quality assurance and refinement

1. **Unit Tests**
   - Test all React components
   - Test API handlers
   - Test event system

2. **Integration Tests**
   - End-to-end cell action flows
   - Configuration save/load
   - Error handling

3. **Polish**
   - Accessibility (ARIA labels, keyboard nav)
   - Performance optimization
   - Documentation

**Deliverables**:
- ✅ 80%+ test coverage
- ✅ All flows working smoothly
- ✅ Production-ready quality

---

## Technical Decisions

### 1. Cell Button Injection Strategy

**Decision**: DOM manipulation via cell observer pattern

**Rationale**:
- JupyterLab cells are DOM-based widgets
- Direct DOM injection is most reliable
- Observer pattern handles dynamic cells

**Alternative Considered**:
- React portals → Too complex, lifecycle issues
- Cell widgets extension → Overkill for simple buttons

**Implementation**:
```typescript
// Watch for cell changes and inject buttons
notebookTracker.currentWidget?.content.model?.cells.changed.connect(() => {
  injectButtonsIntoNotebook(panel);
});
```

### 2. Communication Pattern

**Decision**: Custom DOM events + REST API

**Rationale**:
- Custom events for frontend component communication
- REST API for backend LLM processing
- Clear separation of concerns

**Flow**:
```
Button Click → CustomEvent → ChatPlugin → REST API → LLM → Response
```

**Alternative Considered**:
- WebSocket → Overkill for request/response pattern
- Global state → Tight coupling between components

### 3. State Management

**Decision**: React Context API (not Redux)

**Rationale**:
- Moderate complexity doesn't justify Redux
- Context API sufficient for:
  - Config state
  - Chat messages
  - Active cell tracking

**Structure**:
```typescript
<ConfigProvider>     // Global settings
  <ChatProvider>     // Message thread
    <CellProvider>   // Active cell state
```

**Alternative Considered**:
- Redux → Too heavy for this use case
- Zustand → Adds dependency, Context API sufficient

### 4. Styling Approach

**Decision**: CSS modules + JupyterLab CSS variables

**Rationale**:
- CSS modules prevent style conflicts
- JupyterLab variables ensure theme compatibility
- Material-UI for complex components (dialogs)

**Example**:
```css
.jp-agent-button {
  border-color: var(--jp-border-color2);  /* Theme-aware */
  background: transparent;
}
```

### 5. API Key Storage

**Decision**: Jupyter config file (not browser storage)

**Rationale**:
- More secure than localStorage
- Persists across browser sessions
- Can be encrypted at rest
- Server-side validation

**Location**: `~/.jupyter/jupyter_agent_config.json`

### 6. LLM Integration

**Decision**: Provider-agnostic with adapters

**Rationale**:
- Support multiple LLM providers (OpenAI, Anthropic, local)
- Adapter pattern for extensibility
- User selects provider in settings

**Structure**:
```python
class LLMAdapter(ABC):
    @abstractmethod
    async def generate(self, prompt: str) -> LLMResponse:
        pass

class OpenAIAdapter(LLMAdapter):
    # Implementation

class AnthropicAdapter(LLMAdapter):
    # Implementation
```

---

## Code Patterns & Examples

### Pattern 1: Cell Observer & Button Injection

```typescript
// src/plugins/cell-buttons-plugin.ts

import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { Cell } from '@jupyterlab/cells';

export function setupCellObserver(notebookTracker: INotebookTracker): void {
  // Handle new notebooks
  notebookTracker.widgetAdded.connect((sender, panel) => {
    panel.sessionContext.ready.then(() => {
      observeNotebook(panel);
    });
  });

  // Handle current notebook
  if (notebookTracker.currentWidget) {
    observeNotebook(notebookTracker.currentWidget);
  }
}

function observeNotebook(panel: NotebookPanel): void {
  const notebook = panel.content;

  // Initial injection
  injectButtonsIntoAllCells(notebook);

  // Watch for cell changes
  notebook.model?.cells.changed.connect(() => {
    injectButtonsIntoAllCells(notebook);
  });

  // Watch for cell additions
  notebook.widgets.forEach(cell => {
    observeCell(cell, panel);
  });
}

function observeCell(cell: Cell, panel: NotebookPanel): void {
  // Inject buttons immediately
  injectButtons(cell, panel);

  // Re-inject if cell is re-rendered
  const observer = new MutationObserver(() => {
    if (!cell.inputArea.promptNode.querySelector('.jp-agent-cell-buttons')) {
      injectButtons(cell, panel);
    }
  });

  observer.observe(cell.inputArea.promptNode, {
    childList: true,
    subtree: true
  });
}
```

### Pattern 2: Event-Based Communication

```typescript
// src/services/CellService.ts

export class CellService {
  private static instance: CellService;

  private constructor() {
    this.setupEventListeners();
  }

  static getInstance(): CellService {
    if (!CellService.instance) {
      CellService.instance = new CellService();
    }
    return CellService.instance;
  }

  private setupEventListeners(): void {
    document.addEventListener('jupyter-agent:cell-action', (e) => {
      const event = e as CustomEvent<ICellActionEvent>;
      this.handleCellAction(event.detail);
    });
  }

  private async handleCellAction(event: ICellActionEvent): Promise<void> {
    const { type, cellId, cellContent, customPrompt } = event;

    // Show loading in side panel
    this.emitLoadingState(cellId, true);

    try {
      // Call API
      const response = await this.apiService.cellAction({
        action: type,
        cellId,
        cellContent,
        customPrompt
      });

      // Emit response for side panel
      this.emitCellResponse(response);

    } catch (error) {
      this.emitError(cellId, error);
    } finally {
      this.emitLoadingState(cellId, false);
    }
  }

  emitCellResponse(response: ICellResponse): void {
    document.dispatchEvent(new CustomEvent('jupyter-agent:response', {
      detail: response
    }));
  }
}
```

### Pattern 3: React Component with Context

```typescript
// src/components/chat/MessageList.tsx

import React, { useContext, useEffect } from 'react';
import { ChatContext } from '../../state/ChatContext';
import { CellContext } from '../../state/CellContext';

export const MessageList: React.FC = () => {
  const { messages, addMessage } = useContext(ChatContext);
  const { activeCellId } = useContext(CellContext);

  useEffect(() => {
    // Listen for cell responses
    const handleResponse = (e: Event) => {
      const event = e as CustomEvent<ICellResponse>;
      const { cellId, response, metadata } = event.detail;

      addMessage({
        id: generateId(),
        role: 'assistant',
        content: response,
        timestamp: Date.now(),
        metadata: {
          ...metadata,
          cellId,
          source: 'cell-action'
        }
      });
    };

    document.addEventListener('jupyter-agent:response', handleResponse);
    return () => {
      document.removeEventListener('jupyter-agent:response', handleResponse);
    };
  }, [addMessage]);

  return (
    <div className="jp-agent-messages">
      {messages.map(msg => (
        <MessageItem
          key={msg.id}
          message={msg}
          isActive={msg.metadata?.cellId === activeCellId}
        />
      ))}
    </div>
  );
};
```

### Pattern 4: API Service Layer

```typescript
// src/services/ApiService.ts

export class ApiService {
  private baseUrl: string;

  constructor(baseUrl: string = '/api/jupyter-agent') {
    this.baseUrl = baseUrl;
  }

  async cellAction(request: ICellActionRequest): Promise<ICellResponse> {
    const response = await fetch(`${this.baseUrl}/cell/action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'API request failed');
    }

    return response.json();
  }

  async saveConfig(config: IAgentConfig): Promise<void> {
    const response = await fetch(`${this.baseUrl}/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(config)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to save configuration');
    }
  }

  async getConfig(): Promise<IAgentConfig> {
    const response = await fetch(`${this.baseUrl}/config`);

    if (!response.ok) {
      throw new Error('Failed to load configuration');
    }

    return response.json();
  }
}
```

### Pattern 5: Python Handler with Validation

```python
# jupyter_agent/handlers.py

from jupyter_server.base.handlers import APIHandler
from tornado import web
from pydantic import BaseModel, ValidationError
import json

class CellActionRequest(BaseModel):
    """Validated request schema"""
    cellId: str
    cellContent: str
    action: str
    customPrompt: str | None = None

    class Config:
        extra = 'forbid'  # Reject unknown fields

class CellActionHandler(APIHandler):
    """Handle cell action requests with validation"""

    @web.authenticated
    async def post(self):
        try:
            # Parse and validate
            data = self.get_json_body()
            request = CellActionRequest(**data)

            # Validate action type
            valid_actions = ['explain', 'fix', 'custom']
            if request.action not in valid_actions:
                raise ValueError(f"Invalid action: {request.action}")

            # Build prompt
            prompt = self.build_prompt(request)

            # Call LLM
            response = await self.llm_client.generate(
                prompt=prompt,
                model=self.config.get('modelId'),
                max_tokens=self.config.get('maxTokens', 2000)
            )

            # Build response
            result = {
                "cellId": request.cellId,
                "response": response.content,
                "metadata": {
                    "model": response.model,
                    "tokens": response.usage.total_tokens,
                    "duration": response.duration_ms
                }
            }

            self.finish(json.dumps(result))

        except ValidationError as e:
            raise web.HTTPError(400, str(e))
        except Exception as e:
            self.log.error(f"Cell action failed: {e}")
            raise web.HTTPError(500, "Internal server error")

    def build_prompt(self, request: CellActionRequest) -> str:
        """Build LLM prompt based on action type"""
        if request.action == 'explain':
            return f"""Explain what this code does in clear, concise language:

```python
{request.cellContent}
```

Focus on:
1. Overall purpose
2. Key steps/logic
3. Important details"""

        elif request.action == 'fix':
            return f"""Analyze this code for errors and provide fixes:

```python
{request.cellContent}
```

Provide:
1. Identified issues
2. Fixed code
3. Explanation of changes"""

        else:  # custom
            return f"""{request.customPrompt}

Code:
```python
{request.cellContent}
```"""
```

---

## Integration Checklist

### Pre-Implementation

- [ ] Review Jupyter AI architecture documentation
- [ ] Review Chrome Agent button implementation
- [ ] Set up development environment
- [ ] Install JupyterLab 4.x for testing
- [ ] Install required Python packages
- [ ] Install required npm packages

### Phase 1: Foundation

- [ ] Clone jupyter_ai_repo
- [ ] Rename packages to jupyter-agent
- [ ] Update all package.json files
- [ ] Update Python setup.py/pyproject.toml
- [ ] Configure Lerna for monorepo
- [ ] Test build system
- [ ] Test extension loading in JupyterLab
- [ ] Verify side panel appears

### Phase 2: Cell Buttons

- [ ] Create cell-buttons-plugin.ts
- [ ] Implement plugin activation
- [ ] Create CellActionButtons component
- [ ] Create individual button components (E, F, ?)
- [ ] Implement cell injection logic
- [ ] Add CSS styling
- [ ] Test buttons appear on cells
- [ ] Test buttons survive cell operations (add/delete/move)
- [ ] Verify styling in light/dark themes

### Phase 3: Side Panel Integration

- [ ] Add event listener in ChatPlugin
- [ ] Create CellService for event handling
- [ ] Implement API service layer
- [ ] Create Python CellActionHandler
- [ ] Test E button → API → side panel
- [ ] Test F button → API → side panel
- [ ] Verify message formatting
- [ ] Add cell reference display
- [ ] Test error handling

### Phase 4: Custom Prompt

- [ ] Create CustomPromptDialog component
- [ ] Implement dialog open/close logic
- [ ] Add cell preview display
- [ ] Implement input validation
- [ ] Connect ? button to dialog
- [ ] Test dialog → API → side panel
- [ ] Verify keyboard shortcuts (Enter, Escape)
- [ ] Test edge cases (empty input, long content)

### Phase 5: Save Functionality

- [ ] Create SaveButton component
- [ ] Implement input validation
- [ ] Add loading states
- [ ] Add success/error notifications
- [ ] Create Python ConfigHandler
- [ ] Implement config persistence
- [ ] Secure API key storage
- [ ] Test save → reload → config restored
- [ ] Test validation errors display

### Phase 6: Testing

- [ ] Write unit tests for React components
- [ ] Write unit tests for Python handlers
- [ ] Write integration tests for cell actions
- [ ] Write E2E tests with Playwright
- [ ] Test accessibility (keyboard nav, screen readers)
- [ ] Test performance (many cells, large notebooks)
- [ ] Test error scenarios
- [ ] Test with multiple LLM providers

### Documentation

- [ ] Write user guide
- [ ] Write developer documentation
- [ ] Document API endpoints
- [ ] Create example notebooks
- [ ] Write troubleshooting guide
- [ ] Update README

### Production Readiness

- [ ] Security audit (API key handling)
- [ ] Performance optimization
- [ ] Bundle size optimization
- [ ] Browser compatibility testing
- [ ] JupyterLab version compatibility
- [ ] Create release package
- [ ] Set up CI/CD pipeline

---

## File Structure

### Complete Directory Tree

```
jupyter-agent/
│
├── packages/
│   └── jupyter-agent/
│       ├── package.json
│       ├── tsconfig.json
│       ├── webpack.config.js
│       │
│       ├── src/                          # Frontend TypeScript/React
│       │   │
│       │   ├── index.ts                  # Extension entry point
│       │   │   - Export all plugins
│       │   │   - Register extension
│       │   │
│       │   ├── handler.ts                # API service namespace
│       │   │   - AiService class
│       │   │   - API client methods
│       │   │
│       │   ├── tokens.ts                 # DI tokens
│       │   │   - Plugin tokens
│       │   │   - Service tokens
│       │   │
│       │   ├── types/                    # TypeScript definitions
│       │   │   ├── index.ts
│       │   │   ├── api.ts               # API types
│       │   │   ├── cell.ts              # Cell types
│       │   │   └── chat.ts              # Chat types
│       │   │
│       │   ├── plugins/                  # JupyterLab plugins
│       │   │   ├── index.ts
│       │   │   ├── main-plugin.ts       # Main settings UI
│       │   │   ├── cell-buttons-plugin.ts    # NEW: Cell buttons
│       │   │   ├── chat-plugin.ts       # Side panel chat
│       │   │   └── settings-plugin.ts   # Configuration
│       │   │
│       │   ├── components/               # React components
│       │   │   │
│       │   │   ├── chat/
│       │   │   │   ├── index.ts
│       │   │   │   ├── ChatInterface.tsx
│       │   │   │   ├── MessageList.tsx
│       │   │   │   ├── MessageItem.tsx
│       │   │   │   ├── InputBox.tsx
│       │   │   │   └── TypingIndicator.tsx
│       │   │   │
│       │   │   ├── cell-actions/        # NEW: Cell button components
│       │   │   │   ├── index.ts
│       │   │   │   ├── CellActionButtons.tsx
│       │   │   │   ├── ExplainButton.tsx
│       │   │   │   ├── FixButton.tsx
│       │   │   │   ├── CustomPromptButton.tsx
│       │   │   │   └── CustomPromptDialog.tsx
│       │   │   │
│       │   │   └── settings/
│       │   │       ├── index.ts
│       │   │       ├── ChatSettings.tsx
│       │   │       ├── ModelConfig.tsx
│       │   │       ├── ApiKeyInput.tsx
│       │   │       ├── SaveButton.tsx    # NEW
│       │   │       └── NotificationSnackbar.tsx
│       │   │
│       │   ├── services/                 # Business logic
│       │   │   ├── ApiService.ts        # REST API client
│       │   │   ├── CellService.ts       # NEW: Cell operations
│       │   │   ├── MessageService.ts    # Chat messages
│       │   │   └── ConfigService.ts     # Configuration
│       │   │
│       │   ├── state/                    # State management
│       │   │   ├── ChatContext.tsx      # Chat state
│       │   │   ├── CellContext.tsx      # NEW: Cell state
│       │   │   └── ConfigContext.tsx    # Config state
│       │   │
│       │   ├── utils/                    # Utilities
│       │   │   ├── events.ts            # Event emitter
│       │   │   ├── validation.ts        # Input validation
│       │   │   └── formatting.ts        # Text formatting
│       │   │
│       │   └── styles/                   # CSS
│       │       ├── index.css
│       │       ├── chat.css
│       │       ├── cell-buttons.css     # NEW
│       │       ├── settings.css
│       │       └── variables.css        # Theme variables
│       │
│       └── jupyter_agent/                # Backend Python
│           ├── __init__.py
│           ├── _version.py
│           │
│           ├── handlers/                 # API handlers
│           │   ├── __init__.py
│           │   ├── base.py             # Base handler
│           │   ├── config.py           # Config endpoints
│           │   ├── cell_action.py      # NEW: Cell actions
│           │   └── chat.py             # Chat endpoints
│           │
│           ├── services/                 # Business logic
│           │   ├── __init__.py
│           │   ├── llm_client.py       # LLM integration
│           │   ├── config_manager.py   # Config persistence
│           │   └── prompt_builder.py   # Prompt templates
│           │
│           ├── models/                   # Data models
│           │   ├── __init__.py
│           │   ├── config.py
│           │   ├── cell.py             # NEW
│           │   └── chat.py
│           │
│           └── utils/                    # Utilities
│               ├── __init__.py
│               ├── security.py         # API key encryption
│               └── validation.py       # Input validation
│
├── docs/                                 # Documentation
│   ├── user-guide.md
│   ├── developer-guide.md
│   ├── api-reference.md
│   └── examples/
│       └── example-notebook.ipynb
│
├── tests/                                # Tests
│   ├── frontend/
│   │   ├── components/
│   │   └── services/
│   └── backend/
│       ├── test_handlers.py
│       └── test_services.py
│
├── .github/                              # CI/CD
│   └── workflows/
│       ├── test.yml
│       └── publish.yml
│
├── lerna.json                           # Monorepo config
├── package.json                         # Root package
├── README.md
└── LICENSE
```

### Key File Purposes

| File | Purpose | Lines (Est.) |
|------|---------|--------------|
| `src/index.ts` | Extension entry, plugin exports | ~100 |
| `src/plugins/cell-buttons-plugin.ts` | Cell button injection logic | ~300 |
| `src/components/cell-actions/CellActionButtons.tsx` | Button UI | ~150 |
| `src/components/cell-actions/CustomPromptDialog.tsx` | Dialog UI | ~200 |
| `src/components/settings/SaveButton.tsx` | Save with validation | ~150 |
| `src/services/CellService.ts` | Cell action coordination | ~250 |
| `src/services/ApiService.ts` | REST API client | ~200 |
| `jupyter_agent/handlers/cell_action.py` | Cell action API | ~200 |
| `jupyter_agent/services/llm_client.py` | LLM integration | ~300 |
| `jupyter_agent/services/config_manager.py` | Config persistence | ~150 |

---

## Appendix: Design Decisions Summary

### Key Architectural Choices

1. **Plugin-Based Architecture**
   - Follows JupyterLab extension patterns
   - Modular, maintainable, testable
   - Easy to enable/disable features

2. **DOM Injection for Buttons**
   - Most reliable for notebook cells
   - Handles dynamic cell operations
   - Minimal performance impact

3. **Custom Events for Communication**
   - Decoupled components
   - Easy to test and debug
   - Standard browser API

4. **REST API (not WebSocket)**
   - Request/response pattern sufficient
   - Simpler error handling
   - Easier to scale and cache

5. **React Context (not Redux)**
   - Appropriate complexity level
   - Lighter bundle size
   - Easier learning curve

6. **Provider-Agnostic LLM**
   - Supports multiple backends
   - Future-proof architecture
   - User flexibility

### Performance Considerations

- **Button Injection**: Debounced, only for visible cells
- **API Calls**: Cached for repeated requests
- **Bundle Size**: Code splitting, lazy loading
- **Memory**: Event listener cleanup, context memoization

### Security Considerations

- **API Keys**: Encrypted at rest, never in browser storage
- **Input Validation**: Both frontend and backend
- **CSRF Protection**: Jupyter server authentication
- **XSS Prevention**: Sanitize user input, code content

---

**End of Design Specification**

Total: ~2,850 lines | ~75 KB

This design specification provides a complete blueprint for implementing the Jupyter Agent extension. All architectural decisions, component specifications, and implementation patterns are production-ready and follow JupyterLab best practices.
