# Chrome Agent Button Implementation Analysis

## Overview
The chrome_agent extension provides three buttons (E, F, ?) in Jupyter notebooks that integrate with an AI assistant for code explanation, fixing, and custom queries.

## 1. Button Implementation

### Location
- **Definition**: `/Users/a453180/repo/chrome_agent/jupyter-content.js` (lines 294-363)
- **Styling**: Lines 45-61 define `BUTTON_STYLE` constant
- **Container Styling**: Lines 29-42 define positioning styles

### Button Details

#### E Button (Explain)
- **Label**: "E"
- **Title**: "Explain this cell with AI"
- **Class**: `jupyter-explain-button`
- **Data Attribute**: `data-jupyter-button="explain"`
- **Function**: Lines 294-315 (`createExplainButton()`)

#### F Button (Fix)
- **Label**: "F"
- **Title**: "Fix errors in this cell with AI"
- **Class**: `jupyter-fix-button`
- **Data Attribute**: `data-jupyter-button="fix"`
- **Function**: Lines 318-339 (`createFixButton()`)

#### ? Button (Custom Prompt)
- **Label**: "?"
- **Title**: "Ask a custom question about this cell"
- **Class**: `jupyter-custom-prompt-button`
- **Data Attribute**: `data-jupyter-button="custom-prompt"`
- **Function**: Lines 342-363 (`createCustomPromptButton()`)

### Button Styling
```css
BUTTON_STYLE = {
  background: transparent;
  color: #6b7280;
  border: 1px solid #d1d5db;
  border-radius: 3px;
  padding: 2px 6px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  line-height: 1;
}

Hover State:
  background: #f3f4f6;
  borderColor: #9ca3af;
  color: #374151;

Default State:
  background: transparent;
  borderColor: #d1d5db;
  color: #6b7280;
```

## 2. Button Placement

### Location in UI
- **Container**: `.jupyter-custom-button-container` - placed next to cell number
- **Wrapper**: `.jupyter-prompt-wrapper` - wraps InputPrompt and button container
- **Layout**: Inline flex, same row as cell number (input prompt)

### Implementation
- Lines 365-421: `getOrCreateButtonContainer(cell)` function
- Buttons appear after the cell number, before the editor

## 3. Event Handlers and Actions

### E Button (Explain) - Lines 455-495
```javascript
explainButton.addEventListener('click', async (e) => {
  // 1. Get cell content
  // 2. Validate cell is not empty
  // 3. Find cell index in notebook
  // 4. Show confirm dialog
  // 5. Send message to background script:
  //    {type: 'EXPLAIN_CELL', content, cellIndex}
  // 6. Background opens side panel
})
```

### F Button (Fix) - Lines 502-550
```javascript
fixButton.addEventListener('click', async (e) => {
  // 1. Get cell content
  // 2. Validate cell is not empty
  // 3. Get cell error (if any)
  // 4. Find cell index in notebook
  // 5. Assign cell ID
  // 6. Show confirm dialog
  // 7. Send message to background script:
  //    {type: 'FIX_CELL', content, error, cellId, cellIndex}
  // 8. Background opens side panel
})
```

### ? Button (Custom Prompt) - Lines 560-582
```javascript
customPromptButton.addEventListener('click', async (e) => {
  // 1. Get cell content
  // 2. Validate cell is not empty
  // 3. Assign cell ID
  // 4. Find cell index in notebook
  // 5. Show custom prompt dialog
})
```

## 4. Custom Prompt Dialog (? Button Flow)

### Implementation
- Lines 908-1084: `showCustomPromptDialog(cellContent, cellIndex, cellId)`
- Modal dialog with text input for user's question

### Dialog Features
- **Title**: "셀에 대해 질문하기" (Ask a question about this cell)
- **Placeholder**: "이 셀에 대해 질문할 내용을 입력하세요..." (Enter your question)
- **Submit Button**: "질문" (Question)
- **Cancel Button**: "취소" (Cancel)

### Dialog Interactions
- Enter key submits (Shift+Enter creates newline)
- Escape key closes dialog
- Click outside overlay closes dialog

### Submit Action (Lines 1025-1049)
```javascript
const handleSubmit = async () => {
  // 1. Get user input
  // 2. Validate not empty
  // 3. Send to background script:
  //    {type: 'CUSTOM_PROMPT', cellContent, cellIndex, cellId, prompt}
  // 4. Side panel opens
}
```

## 5. Save Button Functionality

### In Settings Panel
- **Element ID**: `saveApiKey`
- **Handler**: Lines 137-211 in popup.js (`saveApiKey()`)
- **Location**: `/Users/a453180/repo/chrome_agent/popup.js`

### Save Button Features
- **Saves**: API provider selection, API credentials
- **Validation**: Checks for required fields
- **Storage**: Uses `chrome.storage.local.set()`
- **Success**: Shows notification and hides settings

### Storage Keys
- `apiProvider`: 'gemini' or 'vllm'
- `geminiApiKey`: API key for Gemini
- `vllmUrl`: vLLM server URL
- `vllmApiKey`: vLLM API key
- `vllmModel`: vLLM model name

## 6. Communication Flow

### Message Types
1. **EXPLAIN_CELL** (E button)
   - Source: jupyter-content.js
   - Receiver: background.js (lines 77-148)
   - Action: Creates explain prompt and opens side panel

2. **FIX_CELL** (F button)
   - Source: jupyter-content.js
   - Receiver: background.js (lines 150-299)
   - Action: Creates fix prompt and opens side panel

3. **CUSTOM_PROMPT** (? button)
   - Source: jupyter-content.js
   - Receiver: background.js (lines 337-411)
   - Action: Creates custom prompt and opens side panel

### Side Panel (Popup)
- Location: `side_panel.html` or in manifest
- Handler: popup.js (`checkCustomPromptRequest()` - lines 2211-2332)
- Receives storage updates via `chrome.storage.onChanged`

## 7. Storage Communication

### Key Storage Variables
```javascript
// Set by background.js, read by popup.js
{
  customPrompt: "Full LLM prompt with code",
  customPromptUserText: "User-visible text",
  customPromptCellIndex: 0, // Cell number
  customPromptCellId: "cell-uuid-timestamp", // For code application
  customPromptTimestamp: 1234567890, // For deduplication (30s timeout)
  isCustomPromptRequest: true
}
```

### Deduplication
- Timestamp checked in popup (lines 2244-2257)
- Requests older than 30 seconds are ignored
- Processing flag prevents duplicate processing
- Storage deleted immediately after reading (lines 2272-2280)

## 8. Styling Details

### CSS Classes (popup.css)
- `.save-btn` (lines 167-185)
  - Background: white
  - Hover: #f5f5f5
  - Border: #e0e0e0
  - Padding: 6px 14px

- `.test-btn` (lines 344-364)
  - Similar styling to save button
  - Can be disabled with opacity: 0.5

- `.close-btn` (lines 187-194)
  - Background: white
  - Hover: #f5f5f5

## 9. Key Files

| File | Purpose |
|------|---------|
| `/Users/a453180/repo/chrome_agent/jupyter-content.js` | Button creation, event handlers |
| `/Users/a453180/repo/chrome_agent/background.js` | Message processing, side panel opening |
| `/Users/a453180/repo/chrome_agent/popup.js` | Side panel UI, AI API calls |
| `/Users/a453180/repo/chrome_agent/popup.html` | Side panel HTML structure |
| `/Users/a453180/repo/chrome_agent/popup.css` | Styling for side panel |
| `/Users/a453180/repo/chrome_agent/constants.js` | UI text and constants |

## 10. Integration Points for Jupyter Agent

### Expected Integration
1. **Button Definition**: Inherit styling/placement from chrome_agent
2. **Custom Prompt Dialog**: Reuse dialog pattern from ? button
3. **Storage Communication**: Use same storage keys and timing patterns
4. **Message Types**: Define new message types for jupyter_agent actions
5. **Prompt Construction**: Build AI prompts similar to EXPLAIN_CELL/FIX_CELL
6. **Side Panel**: Ensure UI consistency with popup.html/popup.css

### Recommended Approach
- Use same button HTML structure and CSS classes
- Implement storage communication pattern from background.js
- Follow popup.js pattern for handling async AI responses
- Maintain consistent confirm dialog for user interactions
