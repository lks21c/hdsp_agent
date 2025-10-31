# Jupyter Agent - Design Summary

**Quick Reference**: Executive summary of the comprehensive design specification

---

## What Is Jupyter Agent?

A JupyterLab extension combining:
- **Jupyter AI's architecture**: Side panel chat, settings, theme integration
- **Chrome Agent's UX**: Cell-level action buttons (E, F, ?)
- **Result**: Native JupyterLab AI assistant with enhanced cell interactions

---

## Core Features

### 1. Cell Action Buttons

```
┌─────────────────────────────┐
│ [In 1]: [E][F][?]           │
│                             │
│ import numpy as np          │
│ x = np.array([1, 2, 3])     │
└─────────────────────────────┘
```

| Button | Function | Use Case |
|--------|----------|----------|
| **E** | Explain | "What does this code do?" |
| **F** | Fix | "Fix errors or improve this" |
| **?** | Custom | Ask any question about cell |

### 2. Side Panel Chat

- Full Jupyter AI chat interface preserved
- Displays responses from button clicks
- Model configuration and settings
- Streaming LLM responses

### 3. Settings Management

- Enable/disable cell actions
- Configure LLM models
- Manage API keys
- Customize prompt templates

---

## Architecture Overview

```
User clicks [E] button
    ↓
CellActionService captures cell
    ↓
POST /api/agent/action
    ↓
Backend processes with LLM
    ↓
Response streams to side panel
```

**6 Plugins**:
1. Main Plugin (settings UI)
2. Status Item (status bar)
3. Completion Plugin (code completions)
4. Stop Streaming (stop button)
5. **Cell Actions Plugin** (NEW - buttons)
6. Chat Commands (slash commands)

---

## Key Components (NEW)

### Frontend (TypeScript/React)

| Component | Purpose | Lines |
|-----------|---------|-------|
| `CellActionService` | Core service managing buttons | ~400 |
| `CellActionButtons` | E, F, ? button UI | ~200 |
| `CustomPromptDialog` | ? button modal | ~250 |
| `CellActionSettings` | Settings UI panel | ~150 |

### Backend (Python)

| Component | Purpose | Lines |
|-----------|---------|-------|
| `CellActionHandler` | API request processing | ~200 |
| `CellActionConfigHandler` | Configuration management | ~100 |

---

## Technical Decisions

### 1. Button Injection
- **Approach**: DOM-based injection (Chrome Agent pattern)
- **Why**: Flexible, low overhead, works with dynamic notebooks
- **How**: React widgets inserted into cell DOM

### 2. Cell Identification
- **Approach**: Metadata-based IDs
- **Why**: Persistent across sessions, survives reordering
- **Format**: `cell-{timestamp}-{random}`
- **Storage**: `jupyterAgentCellId` in cell metadata

### 3. Communication
- **Approach**: Direct REST API calls
- **Why**: Simple, type-safe, matches Jupyter AI patterns
- **Endpoints**: `/api/agent/action`, `/api/agent/config`

### 4. Dialog UI
- **Approach**: MUI Dialog component
- **Why**: Consistent, accessible, theme-integrated
- **Features**: Textarea, keyboard shortcuts, validation

### 5. State Management
- **Approach**: Service class with Lumino signals
- **Why**: Matches JupyterLab patterns, no extra deps
- **Pattern**: Signal emission on changes

---

## File Structure

```
packages/jupyter-agent/
├── src/
│   ├── cell-actions/              # NEW
│   │   ├── plugin.ts              # Plugin registration
│   │   ├── service.ts             # Core service logic
│   │   ├── types.ts               # TypeScript interfaces
│   │   └── components/
│   │       ├── cell-action-buttons.tsx
│   │       └── custom-prompt-dialog.tsx
│   │
│   ├── components/
│   │   ├── settings/
│   │   │   └── cell-action-settings.tsx  # NEW
│   │   └── chat-settings.tsx      # MODIFY
│   │
│   └── ...existing Jupyter AI files
│
├── jupyter_agent/
│   ├── handlers/
│   │   └── cell_actions.py        # NEW
│   └── ...existing backend
│
└── style/
    └── cell-actions.css           # NEW
```

---

## Implementation Plan

### Phase 1: Foundation (Week 1-2)
- Plugin infrastructure
- Basic service skeleton
- Plugin activation

### Phase 2: Button UI (Week 3-4)
- Button components
- Injection logic
- Cell tracking

### Phase 3: Dialog (Week 5)
- Custom prompt dialog
- Validation
- Keyboard shortcuts

### Phase 4: Backend (Week 6-7)
- API endpoints
- LLM integration
- Chat system connection

### Phase 5: Settings (Week 8)
- Settings UI
- Configuration persistence

### Phase 6: Polish (Week 9-10)
- Testing
- Accessibility
- Documentation

**Total**: 10 weeks to production-ready

---

## API Design

### POST /api/agent/action

**Request**:
```json
{
  "type": "EXPLAIN_CELL",
  "content": "import numpy as np",
  "cellId": "cell-1234-abc",
  "cellIndex": 0,
  "prompt": "optional custom text"
}
```

**Response**:
```json
{
  "success": true,
  "requestId": "uuid",
  "timestamp": 1234567890
}
```

**Types**: `EXPLAIN_CELL`, `FIX_CELL`, `CUSTOM_PROMPT`

---

## Code Patterns

### Button Injection
```typescript
attachToNotebook(panel: NotebookPanel): void {
  // Track attachment
  if (this._attachedNotebooks.has(panel)) return;
  this._attachedNotebooks.add(panel);

  // Inject buttons
  this._injectButtonsIntoAllCells(panel.content);

  // Listen for changes
  panel.content.rendered.connect(() => {
    this._injectButtonsIntoAllCells(panel.content);
  });
}
```

### API Calls
```typescript
private async _sendRequest(request: ICellActionRequest): Promise<void> {
  const response = await fetch('/api/agent/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  });

  const result = await response.json();

  if (result.success) {
    // Open side panel
    await this._app.commands.execute('jupyter-agent:open-chat');
  }
}
```

### Cell ID Management
```typescript
private _ensureCellId(cell: Cell): string {
  let cellId = cell.model.metadata.get('jupyterAgentCellId');

  if (!cellId) {
    cellId = `cell-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    cell.model.metadata.set('jupyterAgentCellId', cellId);
  }

  return cellId;
}
```

---

## Integration Checklist

### Frontend
- [ ] Create Cell Actions Plugin
- [ ] Implement CellActionService
- [ ] Build button components
- [ ] Create dialog component
- [ ] Add settings UI
- [ ] Style with CSS

### Backend
- [ ] Create API handlers
- [ ] Implement LLM processing
- [ ] Connect to chat system
- [ ] Add configuration management

### Testing
- [ ] Unit tests (≥80% coverage)
- [ ] Integration tests
- [ ] E2E tests
- [ ] Accessibility tests

### Documentation
- [ ] Developer docs
- [ ] User guide
- [ ] API reference
- [ ] Code comments

---

## Success Criteria

### Functional
✅ E button explains cell code
✅ F button fixes cell errors
✅ ? button opens custom prompt
✅ Buttons appear in all cells
✅ Responses in side panel
✅ Settings enable/disable

### Non-Functional
✅ Performance: <100ms per cell
✅ Accessibility: WCAG 2.1 AA
✅ JupyterLab 4.x compatible
✅ Light/dark theme support
✅ Mobile-friendly (≥768px)

### Quality
✅ Test coverage ≥80%
✅ Zero TypeScript errors
✅ Zero linting errors
✅ All APIs documented

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Button injection performance | Efficient deduplication, WeakSet tracking |
| Cell ID conflicts | Timestamp + random, uniqueness validation |
| Theme integration breaks | Follow existing patterns, test modes |
| Notebook metadata issues | Use standard Jupyter metadata |
| Streaming response issues | Leverage existing infrastructure |

---

## Development Setup

```bash
# Install
cd packages/jupyter-agent
npm install
pip install -e .

# Build
npm run build
jupyter labextension develop . --overwrite

# Develop (3 terminals)
npm run watch                # Terminal 1
npm run watch:labextension   # Terminal 2
jupyter lab --watch          # Terminal 3
```

---

## Resources

### Documentation
- **JUPYTER_AGENT_DESIGN_SPEC.md** - Full specification (30KB)
- **DESIGN_SUMMARY.md** - This document (quick reference)
- **Jupyter AI ARCHITECTURE_INDEX.md** - Reference architecture
- **Chrome Agent BUTTON_IMPLEMENTATION_GUIDE.md** - Button patterns

### Source References
- Jupyter AI: `/Users/a453180/repo/jupyter_ai_repo/`
- Chrome Agent: `/Users/a453180/repo/chrome_agent/`
- Jupyter Agent: `/Users/a453180/repo/jupyter_agent/`

---

## Next Steps

1. **Review** this summary and full design spec
2. **Approve** architecture and approach
3. **Create** development branch
4. **Start** Phase 1 implementation
5. **Setup** CI/CD pipeline
6. **Schedule** weekly progress reviews

---

**Document Version**: 1.0.0
**Date**: October 31, 2025
**Status**: Ready for Implementation
**Estimated Effort**: 10 weeks
**Team Size**: 1-2 developers
