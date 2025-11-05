# HDSP Agent

AI-powered code assistance for JupyterLab with cell-level actions.

## Features

- **Cell Action Buttons**: Add E (Explain), F (Fix), and ? (Custom Prompt) buttons to every code cell
- **AI-Powered Assistance**: Get instant explanations, error fixes, and custom code analysis
- **Seamless Integration**: Works natively within JupyterLab's notebook interface
- **Configurable**: Support for multiple LLM providers (OpenAI, Anthropic, custom endpoints)

## Installation

```bash
pip install hdsp_agent
```

## Usage

### Cell Action Buttons

Three buttons appear next to each code cell:

- **E (Explain)**: Get a clear explanation of what the code does
- **F (Fix)**: Automatically identify and fix errors in your code
- **? (Custom Prompt)**: Enter a custom prompt for specific code analysis

### Configuration

Configure your API key and model settings:

1. Open JupyterLab
2. Go to Settings → HDSP Agent Settings
3. Enter your API key
4. Select your preferred model
5. Click Save

## Development

### Prerequisites

- Node.js 18+
- Python 3.8+
- JupyterLab 4.0+

### Setup

```bash
# Install dependencies
pip install -e ".[dev]"
jlpm install

# Build extension
jlpm build

# Install extension in development mode
jupyter labextension develop . --overwrite

# Watch for changes
jlpm watch
```

### Building

```bash
# Build TypeScript
jlpm build

# Build Python package
python -m build

# Build everything
jlpm build:prod
```

## Architecture

```
┌─────────────────────────────────────┐
│  Notebook Cell                      │
│  ┌──────────────┐                   │
│  │ Code Input   │                   │
│  │ E  F  ?      │ ──────────┐       │
│  └──────────────┘           │       │
└─────────────────────────────┼───────┘
                              │
                              ▼
                     ┌────────────────┐
                     │  REST API      │
                     │  /cell/action  │
                     └────────┬───────┘
                              │
                              ▼
                     ┌────────────────┐
                     │  LLM Service   │
                     │  (OpenAI, etc) │
                     └────────────────┘
```

## License

MIT

## Contributing

Contributions welcome! Please read CONTRIBUTING.md for details.
