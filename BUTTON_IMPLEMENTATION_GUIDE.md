# Chrome Agent Button Implementation Guide

## Quick Reference

### Three Button Types
1. **E Button** - Explain cell code
2. **F Button** - Fix cell errors
3. **? Button** - Ask custom questions

### Files to Study
- `/Users/a453180/repo/chrome_agent/jupyter-content.js` - Button UI creation and events
- `/Users/a453180/repo/chrome_agent/background.js` - Message routing and side panel
- `/Users/a453180/repo/chrome_agent/popup.js` - Side panel response handling
- `/Users/a453180/repo/chrome_agent/popup.css` - Side panel styling
- `/Users/a453180/repo/chrome_agent/popup.html` - Side panel HTML
- `/Users/a453180/repo/chrome_agent/constants.js` - UI text constants

---

## 1. BUTTON CREATION (jupyter-content.js)

### Button Creation Functions

#### E Button (Lines 294-315)
```javascript
function createExplainButton() {
  const button = document.createElement('button');
  button.innerHTML = 'E';
  button.className = 'jupyter-explain-button';
  button.title = 'Explain this cell with AI';
  button.setAttribute('data-jupyter-button', 'explain');
  button.style.cssText = BUTTON_STYLE;
  
  // Hover effects
  button.addEventListener('mouseenter', () => {
    button.style.background = '#f3f4f6';
    button.style.borderColor = '#9ca3af';
    button.style.color = '#374151';
  });
  
  button.addEventListener('mouseleave', () => {
    button.style.background = 'transparent';
    button.style.borderColor = '#d1d5db';
    button.style.color = '#6b7280';
  });
  
  return button;
}
```

#### F Button (Lines 318-339)
```javascript
function createFixButton() {
  const button = document.createElement('button');
  button.innerHTML = 'F';
  button.className = 'jupyter-fix-button';
  button.title = 'Fix errors in this cell with AI';
  button.setAttribute('data-jupyter-button', 'fix');
  button.style.cssText = BUTTON_STYLE;
  
  // Same hover logic as E button
  return button;
}
```

#### ? Button (Lines 342-363)
```javascript
function createCustomPromptButton() {
  const button = document.createElement('button');
  button.innerHTML = '?';
  button.className = 'jupyter-custom-prompt-button';
  button.title = 'Ask a custom question about this cell';
  button.setAttribute('data-jupyter-button', 'custom-prompt');
  button.style.cssText = BUTTON_STYLE;
  
  // Same hover logic
  return button;
}
```

### Button Styling Constant (Lines 45-61)
```javascript
const BUTTON_STYLE = `
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
`;
```

### Button Container Structure (Lines 366-421)
```javascript
function getOrCreateButtonContainer(cell) {
  const inputArea = cell.querySelector('.jp-InputArea');
  if (!inputArea) return null;
  
  const inputPrompt = inputArea.querySelector('.jp-InputPrompt');
  if (!inputPrompt) return null;
  
  // Check for existing container
  let container = cell.querySelector('.jupyter-custom-button-container');
  
  if (!container) {
    // Setup flex layout
    if (inputArea.style.display !== 'flex') {
      inputArea.style.display = 'flex';
      inputArea.style.flexDirection = 'column';
    }
    
    // Create or get wrapper
    let wrapper = inputArea.querySelector('.jupyter-prompt-wrapper');
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'jupyter-prompt-wrapper';
      wrapper.style.cssText = `
        display: flex;
        align-items: center;
        margin-bottom: 4px;
      `;
      inputPrompt.parentNode.insertBefore(wrapper, inputPrompt);
      wrapper.appendChild(inputPrompt);
    }
    
    // Create button container
    container = document.createElement('div');
    container.className = 'jupyter-custom-button-container';
    container.style.cssText = `
      display: inline-flex;
      gap: 4px;
      margin-left: 8px;
      align-items: center;
    `;
    
    wrapper.appendChild(container);
  }
  
  return container;
}
```

### Adding Buttons to Cell (Lines 424-586)
```javascript
function addButtonsToCell(cell) {
  // Skip hidden cells
  if (cell.style.display === 'none' || !cell.offsetParent) return;
  
  const container = getOrCreateButtonContainer(cell);
  if (!container) return;
  
  // Check for existing buttons
  const existingExplain = container.querySelector('[data-jupyter-button="explain"]');
  const existingFix = container.querySelector('[data-jupyter-button="fix"]');
  const existingCustomPrompt = container.querySelector('[data-jupyter-button="custom-prompt"]');
  
  if (existingExplain && existingFix && existingCustomPrompt) return;
  
  assignCellId(cell);
  
  // Add E button
  if (!existingExplain) {
    const explainButton = createExplainButton();
    explainButton.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      
      const content = getCellContent(cell);
      if (!content.trim()) {
        showNotification('셀 내용이 비어있습니다.', 'warning');
        return;
      }
      
      const allCells = getCellsInNotebook(cell);
      let cellIndex = -1;
      for (let i = 0; i < allCells.length; i++) {
        if (allCells[i] === cell) cellIndex = i;
      }
      
      showConfirmDialog(
        `셀 ${cellIndex + 1}번째 (위에서 아래): 설명 요청`,
        `이 셀의 코드 설명을 보시겠습니까?`,
        async () => {
          safeSendMessage({
            type: 'EXPLAIN_CELL',
            content: content,
            cellIndex: cellIndex
          }, (response) => {
            if (response && response.success) {
              console.log('설명 요청 성공, sidebar 열림');
            } else {
              showNotification('요청 처리 실패', 'error');
            }
          });
        }
      );
    });
    
    container.appendChild(explainButton);
  }
  
  // Add F button (similar pattern)
  // Add ? button (different - shows dialog first)
}
```

---

## 2. CUSTOM PROMPT DIALOG (? Button)

### Dialog Creation (Lines 908-1084)
```javascript
function showCustomPromptDialog(cellContent, cellIndex, cellId) {
  // Create overlay
  const dialogOverlay = document.createElement('div');
  dialogOverlay.className = 'jupyter-custom-prompt-dialog';
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
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
  
  // Dialog HTML
  dialogContainer.innerHTML = `
    <div style="margin-bottom: 20px;">
      <h3 style="margin: 0 0 8px 0; color: #424242; font-size: 16px; font-weight: 500;">
        ${GEMINI_AGENT_CONSTANTS.NOTIFICATIONS.CUSTOM_PROMPT_TITLE}
      </h3>
      <p style="margin: 0; color: #757575; font-size: 13px;">
        셀 ${cellIndex + 1}번째 (위에서 아래)
      </p>
    </div>
    <div style="margin-bottom: 20px;">
      <textarea class="custom-prompt-input"
        placeholder="${GEMINI_AGENT_CONSTANTS.NOTIFICATIONS.CUSTOM_PROMPT_PLACEHOLDER}"
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
      <button class="custom-prompt-cancel-btn" style="
        background: transparent;
        color: #616161;
        border: 1px solid #d1d5db;
        border-radius: 3px;
        padding: 8px 16px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
      ">${GEMINI_AGENT_CONSTANTS.NOTIFICATIONS.CUSTOM_PROMPT_CANCEL}</button>
      <button class="custom-prompt-submit-btn" style="
        background: transparent;
        color: #1976d2;
        border: 1px solid #1976d2;
        border-radius: 3px;
        padding: 8px 16px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
      ">${GEMINI_AGENT_CONSTANTS.NOTIFICATIONS.CUSTOM_PROMPT_SUBMIT}</button>
    </div>
  `;
  
  dialogOverlay.appendChild(dialogContainer);
  document.body.appendChild(dialogOverlay);
  
  // Focus input
  const inputField = dialogContainer.querySelector('.custom-prompt-input');
  setTimeout(() => inputField.focus(), 100);
  
  // Button handlers
  const cancelBtn = dialogContainer.querySelector('.custom-prompt-cancel-btn');
  const submitBtn = dialogContainer.querySelector('.custom-prompt-submit-btn');
  
  cancelBtn.addEventListener('click', () => {
    dialogOverlay.remove();
  });
  
  const handleSubmit = async () => {
    const promptText = inputField.value.trim();
    
    if (!promptText) {
      showNotification(
        GEMINI_AGENT_CONSTANTS.NOTIFICATIONS.CUSTOM_PROMPT_EMPTY, 
        'warning'
      );
      return;
    }
    
    dialogOverlay.remove();
    
    // Send to background script
    safeSendMessage({
      type: 'CUSTOM_PROMPT',
      cellContent: cellContent,
      cellIndex: cellIndex,
      cellId: cellId,
      prompt: promptText
    }, (response) => {
      if (response && response.success) {
        console.log('커스텀 프롬프트 전송 성공, side panel 열림');
      } else {
        showNotification('요청 처리 실패', 'error');
      }
    });
  };
  
  submitBtn.addEventListener('click', handleSubmit);
  
  // Enter key submits (Shift+Enter creates newline)
  inputField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  });
  
  // ESC key closes
  const handleEscapeKey = (e) => {
    if (e.key === 'Escape') {
      dialogOverlay.remove();
      document.removeEventListener('keydown', handleEscapeKey);
    }
  };
  document.addEventListener('keydown', handleEscapeKey);
}
```

---

## 3. BACKGROUND MESSAGE HANDLING (background.js)

### EXPLAIN_CELL Handler (Lines 77-148)
```javascript
if (message.type === 'EXPLAIN_CELL') {
  try {
    const cellContent = message.content || '';
    const cellIndex = message.cellIndex;
    
    if (!cellContent.trim()) {
      sendResponse({ success: false, error: 'Empty content' });
      return;
    }
    
    const escapedContent = escapeContent(cellContent);
    
    // Create prompt
    const fullPrompt = `다음 Jupyter 셀의 내용을 자세히 설명해주세요:

\`\`\`python
${escapedContent}
\`\`\``;
    
    const userPromptText = '설명 요청';
    
    // Store in chrome storage
    chrome.storage.local.set({
      customPrompt: fullPrompt,
      customPromptUserText: userPromptText,
      customPromptCellIndex: cellIndex,
      customPromptCellId: null,
      customPromptTimestamp: Date.now(),
      isCustomPromptRequest: true
    }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      
      // Open side panel
      chrome.sidePanel.open({ windowId: sender.tab.windowId })
        .then(() => {
          sendResponse({ success: true });
        })
        .catch((error) => {
          // Fallback notification
          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'Jupyter 셀 설명 준비 완료',
            message: '확장 프로그램 아이콘을 클릭하여 Side Panel을 여세요.',
            priority: 2
          });
          sendResponse({ success: true });
        });
    });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
  
  return true; // async response
}
```

### FIX_CELL Handler (Lines 150-299)
```javascript
if (message.type === 'FIX_CELL') {
  try {
    const cellContent = message.content || '';
    const cellError = message.error || '';
    const cellId = message.cellId || '';
    const cellIndex = message.cellIndex;
    
    if (!cellContent.trim()) {
      sendResponse({ success: false, error: 'Empty content' });
      return;
    }
    
    const escapedContent = escapeContent(cellContent);
    const escapedError = escapeContent(cellError);
    
    // Create prompt based on whether error exists
    let prompt;
    if (cellError.trim()) {
      // Error exists - create fix prompt
      prompt = `다음 Jupyter 셀 코드에 에러가 발생했습니다.
      
원본 코드:
\`\`\`python
${escapedContent}
\`\`\`

에러:
\`\`\`
${escapedError}
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

최소 2개, 최대 3개의 다양한 수정 방법을 제안해주세요.`;
    } else {
      // No error - create improvement prompt
      prompt = `다음 Jupyter 셀 코드를 리뷰하고 개선 방법을 제안해주세요.

코드:
\`\`\`python
${escapedContent}
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

최소 2개, 최대 3개의 다양한 개선 방법을 제안해주세요.`;
    }
    
    const userPromptText = cellError.trim() ? '에러 수정 요청' : '개선 제안 요청';
    
    // Store with cell ID for code application
    chrome.storage.local.set({
      customPrompt: prompt,
      customPromptUserText: userPromptText,
      customPromptCellIndex: cellIndex,
      customPromptCellId: cellId,  // Important for code application
      customPromptTimestamp: Date.now(),
      isCustomPromptRequest: true
    }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      
      chrome.sidePanel.open({ windowId: sender.tab.windowId })
        .then(() => {
          sendResponse({ success: true });
        })
        .catch((error) => {
          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'Jupyter 셀 수정 준비 완료',
            message: '확장 프로그램 아이콘을 클릭하여 Side Panel을 여세요.',
            priority: 2
          });
          sendResponse({ success: true });
        });
    });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
  
  return true;
}
```

### CUSTOM_PROMPT Handler (Lines 337-411)
```javascript
if (message.type === 'CUSTOM_PROMPT') {
  try {
    const cellContent = message.cellContent || '';
    const cellIndex = message.cellIndex;
    const cellId = message.cellId;
    const userPrompt = message.prompt || '';
    
    if (!cellContent.trim()) {
      sendResponse({ success: false, error: 'Empty content' });
      return;
    }
    
    if (!userPrompt.trim()) {
      sendResponse({ success: false, error: 'Empty prompt' });
      return;
    }
    
    const escapedContent = escapeContent(cellContent);
    const escapedPrompt = escapeContent(userPrompt);
    
    // Combine user prompt with code
    const fullPrompt = `${escapedPrompt}

다음은 Jupyter 노트북의 셀 내용입니다:

\`\`\`python
${escapedContent}
\`\`\``;
    
    // Store
    chrome.storage.local.set({
      customPrompt: fullPrompt,
      customPromptUserText: userPrompt,
      customPromptCellIndex: cellIndex,
      customPromptCellId: cellId,
      customPromptTimestamp: Date.now(),
      isCustomPromptRequest: true
    }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      
      chrome.sidePanel.open({ windowId: sender.tab.windowId })
        .then(() => {
          sendResponse({ success: true });
        })
        .catch((error) => {
          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'Jupyter 질문 준비 완료',
            message: '확장 프로그램 아이콘을 클릭하여 Side Panel을 여세요.',
            priority: 2
          });
          sendResponse({ success: true });
        });
    });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
  
  return true;
}
```

---

## 4. SIDE PANEL HANDLING (popup.js)

### Storage Listener (Lines 342-371)
```javascript
chrome.storage.onChanged.addListener(async(changes, namespace) => {
  if (namespace !== 'local') return;
  
  if (changes.notebookAnalysisPrompt && changes.notebookAnalysisPrompt.newValue) {
    console.log('Storage 변경 감지: Notebook Analysis 요청');
    await this.checkNotebookAnalysisRequest();
  }
  
  if (changes.customPrompt) {
    console.log('Storage 변경 감지 - customPrompt:', {
      hasOld: !!changes.customPrompt.oldValue,
      hasNew: !!changes.customPrompt.newValue
    });
    
    // Only process if new value added (ignore deletions)
    if (changes.customPrompt.newValue && !changes.customPrompt.oldValue) {
      console.log('Storage 변경 감지: Custom Prompt 요청');
      await this.checkCustomPromptRequest();
    }
  }
});
```

### Custom Prompt Request Handler (Lines 2211-2332)
```javascript
async checkCustomPromptRequest() {
  const callId = Math.random().toString(36).substr(2, 9);
  console.log(`[${callId}] checkCustomPromptRequest 호출됨`);
  
  try {
    // Prevent duplicate processing
    if (this.processingCustomPrompt) {
      console.log(`[${callId}] 이미 처리 중, 즉시 리턴`);
      return;
    }
    
    const result = await chrome.storage.local.get([
      'customPrompt',
      'customPromptUserText',
      'customPromptCellIndex',
      'customPromptCellId',
      'customPromptTimestamp',
      'isCustomPromptRequest'
    ]);
    
    // Check for data
    if (!result.isCustomPromptRequest || !result.customPromptTimestamp) {
      console.log(`[${callId}] 데이터 없음, 리턴`);
      return;
    }
    
    // Check timestamp (ignore if >30 seconds old)
    const timeDiff = Date.now() - result.customPromptTimestamp;
    if (timeDiff >= 30000) {
      console.log(`[${callId}] 오래된 요청, 삭제 후 리턴`);
      await chrome.storage.local.remove([
        'customPrompt',
        'customPromptUserText',
        'customPromptCellIndex',
        'customPromptCellId',
        'customPromptTimestamp',
        'isCustomPromptRequest'
      ]);
      return;
    }
    
    // Check again for duplicates (after storage read)
    if (this.processingCustomPrompt) {
      console.log(`[${callId}] Storage 읽기 후 다시 확인: 이미 처리 중, 스킵`);
      return;
    }
    
    console.log(`[${callId}] 처리 시작:`, result.customPromptUserText);
    
    // Set processing flag
    this.processingCustomPrompt = true;
    
    // Delete immediately to prevent duplicate calls
    console.log(`[${callId}] Storage 삭제 시작`);
    await chrome.storage.local.remove([
      'customPrompt',
      'customPromptUserText',
      'customPromptCellIndex',
      'customPromptCellId',
      'customPromptTimestamp',
      'isCustomPromptRequest'
    ]);
    console.log(`[${callId}] Storage 삭제 완료`);
    
    // Save current cell context
    this.currentCellId = result.customPromptCellId;
    this.currentCellIndex = result.customPromptCellIndex;
    
    // Clear badge
    chrome.action.setBadgeText({ text: '' });
    
    // Display message
    const displayMessage = `💬 셀 ${result.customPromptCellIndex + 1}번째: ${result.customPromptUserText}`;
    this.addMessage(displayMessage, 'user');
    
    // Clear input
    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
      messageInput.value = '';
    }
    
    // Generate AI response
    setTimeout(async() => {
      try {
        this.showTypingIndicator();
        
        // Call AI API with streaming
        await this.callGeminiAPI(result.customPrompt, true);
        
        this.hideTypingIndicator();
      } catch (error) {
        console.error('AI 응답 생성 실패:', error);
        this.hideTypingIndicator();
        this.showNotification('AI 응답 생성에 실패했습니다.', 'error');
      } finally {
        this.processingCustomPrompt = false;
      }
    }, 500);
  } catch (error) {
    console.error('커스텀 프롬프트 요청 확인 실패:', error);
    this.processingCustomPrompt = false;
  }
}
```

---

## 5. SAVE BUTTON (popup.js & popup.html)

### HTML (popup.html, lines 78-81)
```html
<button id="saveApiKey" class="save-btn"></button>
<button id="testApiKey" class="test-btn"></button>
<button id="closeSettings" class="close-btn"></button>
```

### Handler (popup.js, lines 137-211)
```javascript
async saveApiKey() {
  const geminiRadio = document.getElementById('providerGemini');
  const vllmRadio = document.getElementById('providerVllm');
  const selectedProvider = geminiRadio.checked ? 'gemini' : 'vllm';
  
  try {
    const dataToSave = {
      [GEMINI_AGENT_CONSTANTS.STORAGE_KEYS.API_PROVIDER]: selectedProvider
    };
    
    if (selectedProvider === 'gemini') {
      const geminiApiKeyInput = document.getElementById('geminiApiKey');
      const newApiKey = geminiApiKeyInput.value.trim();
      
      if (!newApiKey) {
        this.showNotification('Gemini API 키를 입력해주세요.', 'error');
        return;
      }
      
      dataToSave[GEMINI_AGENT_CONSTANTS.STORAGE_KEYS.GEMINI_API_KEY] = newApiKey;
      this.apiKey = newApiKey;
      this.apiProvider = 'gemini';
      
      // Remove vLLM settings
      this.vllmUrl = '';
      this.vllmApiKey = '';
      this.vllmModel = '';
      await chrome.storage.local.remove([
        GEMINI_AGENT_CONSTANTS.STORAGE_KEYS.VLLM_URL,
        GEMINI_AGENT_CONSTANTS.STORAGE_KEYS.VLLM_API_KEY,
        GEMINI_AGENT_CONSTANTS.STORAGE_KEYS.VLLM_MODEL
      ]);
      
    } else {
      // vLLM settings
      const vllmUrlInput = document.getElementById('vllmUrl');
      const vllmApiKeyInput = document.getElementById('vllmApiKey');
      const vllmModelInput = document.getElementById('vllmModel');
      
      const newVllmUrl = vllmUrlInput.value.trim();
      const newVllmApiKey = vllmApiKeyInput.value.trim();
      const newVllmModel = vllmModelInput.value.trim();
      
      if (!newVllmUrl) {
        this.showNotification('vLLM 서버 주소를 입력해주세요.', 'error');
        return;
      }
      
      dataToSave[GEMINI_AGENT_CONSTANTS.STORAGE_KEYS.VLLM_URL] = newVllmUrl;
      dataToSave[GEMINI_AGENT_CONSTANTS.STORAGE_KEYS.VLLM_API_KEY] = newVllmApiKey;
      dataToSave[GEMINI_AGENT_CONSTANTS.STORAGE_KEYS.VLLM_MODEL] = newVllmModel;
      
      this.vllmUrl = newVllmUrl;
      this.vllmApiKey = newVllmApiKey;
      this.vllmModel = newVllmModel;
      this.apiProvider = 'vllm';
      
      // Remove Gemini settings
      this.apiKey = '';
      await chrome.storage.local.remove([
        GEMINI_AGENT_CONSTANTS.STORAGE_KEYS.GEMINI_API_KEY
      ]);
    }
    
    await chrome.storage.local.set(dataToSave);
    this.showNotification(GEMINI_AGENT_CONSTANTS.NOTIFICATIONS.API_KEY_SAVED, 'success');
    this.hideSettings();
    
  } catch (error) {
    console.error(GEMINI_AGENT_CONSTANTS.LOG_MESSAGES.API_KEY_SAVE_FAILED, error);
    this.showNotification(GEMINI_AGENT_CONSTANTS.NOTIFICATIONS.API_KEY_SAVE_FAILED, 'error');
  }
}
```

### Styling (popup.css, lines 167-185)
```css
.save-btn, .close-btn {
  padding: 6px 14px;
  border: 1px solid #e0e0e0;
  border-radius: 3px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 400;
  margin-right: 8px;
  transition: background 0.15s ease;
}

.save-btn {
  background: #ffffff;
  color: #424242;
}

.save-btn:hover {
  background: #f5f5f5;
}
```

---

## Key Files Reference

| File | Lines | Purpose |
|------|-------|---------|
| jupyter-content.js | 294-315 | E button creation |
| jupyter-content.js | 318-339 | F button creation |
| jupyter-content.js | 342-363 | ? button creation |
| jupyter-content.js | 45-61 | Button styling |
| jupyter-content.js | 365-421 | Button container setup |
| jupyter-content.js | 424-586 | Adding buttons to cells |
| jupyter-content.js | 908-1084 | Custom prompt dialog |
| background.js | 77-148 | EXPLAIN_CELL handler |
| background.js | 150-299 | FIX_CELL handler |
| background.js | 337-411 | CUSTOM_PROMPT handler |
| popup.js | 2211-2332 | Custom prompt receiver |
| popup.js | 137-211 | Save button handler |
| popup.css | 167-185 | Save button styling |

