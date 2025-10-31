# Jupyter Agent - Quick Start Guide

Fast-track guide to get Jupyter Agent running in 5 minutes.

---

## Prerequisites

- ✅ JupyterLab 4.0+
- ✅ Python 3.8+
- ✅ Node.js 18+
- ✅ OpenAI API key (or compatible endpoint)

---

## Installation

### Step 1: Navigate to Project

```bash
cd /Users/a453180/repo/jupyter_agent/packages/jupyter-agent
```

### Step 2: Install Dependencies

```bash
# Install Node dependencies
jlpm install

# Install Python package in development mode
pip install -e ".[dev]"
```

### Step 3: Build Extension

```bash
# Build TypeScript and extension
jlpm build
```

### Step 4: Install in JupyterLab

```bash
# Install extension
jupyter labextension develop . --overwrite

# Verify installation
jupyter labextension list
# Should see: @jupyter-agent/extension enabled
```

### Step 5: Configure API Key

Create config file:
```bash
mkdir -p ~/.jupyter
cat > ~/.jupyter/jupyter_agent_config.json << 'EOF'
{
  "apiKey": "sk-your-api-key-here",
  "modelId": "gpt-4",
  "baseUrl": "https://api.openai.com/v1",
  "temperature": 0.7,
  "maxTokens": 2000,
  "systemPrompt": "You are a helpful AI assistant for code analysis."
}
EOF
```

Or set environment variable:
```bash
export OPENAI_API_KEY="sk-your-api-key-here"
```

### Step 6: Start JupyterLab

```bash
jupyter lab
```

---

## Usage

### 1. Open a Notebook

Create or open any `.ipynb` file.

### 2. Write Some Code

```python
def calculate_fibonacci(n):
    if n <= 1:
        return n
    return calculate_fibonacci(n-1) + calculate_fibonacci(n-2)

print(calculate_fibonacci(10))
```

### 3. Use Action Buttons

You'll see three buttons next to the cell prompt: **E**, **F**, **?**

- **E** (Explain): Click to get an explanation of the code
- **F** (Fix): Click to identify and fix errors
- **?** (Custom): Click to enter a custom prompt

### 4. View Responses

Currently, responses are logged to:
- **Browser Console**: Press F12 → Console tab
- **Terminal**: Where you ran `jupyter lab`

Example response:
```
[CellService] Handling explain action for cell abc-123
Response: This code implements a recursive Fibonacci calculation...
```

---

## Development Workflow

### Watch Mode (for development)

In one terminal:
```bash
cd /Users/a453180/repo/jupyter_agent/packages/jupyter-agent
jlpm watch
```

In another terminal:
```bash
jupyter lab --watch
```

This enables hot-reloading for TypeScript changes.

### Rebuild After Changes

```bash
jlpm build
jupyter lab build
```

### View Logs

**Backend logs:**
```bash
# In terminal where jupyter lab is running
# Python print() statements and errors appear here
```

**Frontend logs:**
```bash
# In browser: F12 → Console
# JavaScript console.log() statements appear here
```

---

## Testing

### Manual Testing

1. **Test Button Injection**
   - Open notebook → Verify E, F, ? buttons appear
   - Add new cell → Buttons should appear automatically

2. **Test Explain Button**
   - Click E → Check console for API call
   - Verify LLM response in logs

3. **Test Fix Button**
   - Write buggy code → Click F
   - Check response suggests fixes

4. **Test Custom Prompt**
   - Click ? → Dialog opens
   - Enter prompt → Check it's sent to API

### Check API Endpoints

```bash
# Status check
curl http://localhost:8888/api/jupyter-agent/status

# Config check (requires auth token)
curl -H "Authorization: token YOUR_TOKEN" \
     http://localhost:8888/api/jupyter-agent/config
```

---

## Troubleshooting

### Buttons Don't Appear

**Check extension is installed:**
```bash
jupyter labextension list
# Should show: @jupyter-agent/extension enabled
```

**Check console for errors:**
- F12 → Console tab
- Look for `[CellButtonsPlugin]` messages

**Rebuild and restart:**
```bash
jlpm build
jupyter lab build
jupyter lab --reload
```

### API Errors

**Check API key:**
```bash
cat ~/.jupyter/jupyter_agent_config.json
# or
echo $OPENAI_API_KEY
```

**Check backend logs:**
- Terminal running `jupyter lab`
- Look for error messages

**Test API directly:**
```python
import aiohttp
import asyncio

async def test_api():
    headers = {'Authorization': 'Bearer YOUR_API_KEY'}
    payload = {
        'model': 'gpt-4',
        'messages': [{'role': 'user', 'content': 'Hello'}]
    }
    async with aiohttp.ClientSession() as session:
        async with session.post(
            'https://api.openai.com/v1/chat/completions',
            headers=headers,
            json=payload
        ) as response:
            print(await response.json())

asyncio.run(test_api())
```

### Build Errors

**Clear and rebuild:**
```bash
jlpm clean:all
jlpm install
jlpm build
```

**Check Node/Python versions:**
```bash
node --version  # Should be 18+
python --version  # Should be 3.8+
```

---

## File Locations

| Item | Location |
|------|----------|
| **Extension Code** | `/Users/a453180/repo/jupyter_agent/packages/jupyter-agent/` |
| **Config File** | `~/.jupyter/jupyter_agent_config.json` |
| **Built Extension** | `~/.local/share/jupyter/labextensions/@jupyter-agent/extension/` |
| **Logs** | Terminal output + Browser console |

---

## Next Steps

### Immediate
1. ✅ Get buttons showing
2. ✅ Get API calls working
3. ✅ Verify responses in console

### Short-term
- [ ] Implement side panel UI for responses
- [ ] Add visual loading indicators
- [ ] Improve error messages
- [ ] Add configuration UI in JupyterLab

### Long-term
- [ ] Add response history
- [ ] Implement code application (apply fixes to cells)
- [ ] Support multiple LLM providers
- [ ] Add keyboard shortcuts
- [ ] Package for PyPI distribution

---

## Quick Commands Reference

```bash
# Install
jlpm install && pip install -e ".[dev]"

# Build
jlpm build

# Install extension
jupyter labextension develop . --overwrite

# Watch mode
jlpm watch

# Clean
jlpm clean:all

# Start JupyterLab
jupyter lab

# Check installation
jupyter labextension list

# Uninstall
pip uninstall jupyter_agent
jupyter labextension uninstall @jupyter-agent/extension
```

---

## Support

- **Design Docs**: `/Users/a453180/repo/jupyter_agent/JUPYTER_AGENT_DESIGN.md`
- **Implementation Summary**: `/Users/a453180/repo/jupyter_agent/IMPLEMENTATION_SUMMARY.md`
- **Chrome Agent Reference**: `/Users/a453180/repo/jupyter_agent/CHROME_AGENT_REFERENCE.md`
- **Button Guide**: `/Users/a453180/repo/jupyter_agent/BUTTON_IMPLEMENTATION_GUIDE.md`

---

**Ready to start!** 🚀

Run these commands now:
```bash
cd /Users/a453180/repo/jupyter_agent/packages/jupyter-agent
jlpm install
pip install -e ".[dev]"
jlpm build
jupyter labextension develop . --overwrite
jupyter lab
```
