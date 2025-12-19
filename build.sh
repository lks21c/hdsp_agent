#!/bin/bash
set -e

# Parse arguments
CLEAN_ALL=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --clean-all)
      CLEAN_ALL=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--clean-all]"
      exit 1
      ;;
  esac
done

echo "=== HDSP Agent Build Script (Monorepo) ==="
echo ""

# Change to script directory
cd "$(dirname "$0")"
ROOT_DIR=$(pwd)

echo "Working directory: $ROOT_DIR"
echo ""

# Step 1: Build Agent Server
echo "1. Building Agent Server..."
cd "$ROOT_DIR/agent-server"
poetry install --no-interaction
poetry run pytest tests/ -v --tb=short
echo "Agent Server build complete"
echo ""

# Step 2: Build Jupyter Extension
echo "2. Building Jupyter Extension..."
cd "$ROOT_DIR/extensions/jupyter"

# Clean previous builds
echo "Cleaning previous builds..."
rm -rf lib dist tsconfig.tsbuildinfo jupyter_ext/labextension

if [ "$CLEAN_ALL" = true ]; then
  echo "🧹 Deep clean: removing node_modules and caches..."
  rm -rf node_modules .yarn/cache
fi

# Install dependencies
if [ ! -d "node_modules" ]; then
    echo "Installing node dependencies..."
    yarn install
fi

# TypeScript compilation with asset copy
echo "Compiling TypeScript..."
mkdir -p lib/styles/icons
cp -r frontend/styles/icons/* lib/styles/icons/ 2>/dev/null || true
./node_modules/.bin/tsc

# Build labextension
echo "Building labextension..."
cd "$ROOT_DIR"
poetry run jupyter labextension build "$ROOT_DIR/extensions/jupyter" --development True

# Install Jupyter Extension (Python package + server extension)
echo "Installing Jupyter Extension..."
poetry run pip install -e "$ROOT_DIR/extensions/jupyter"
poetry run jupyter labextension develop --overwrite "$ROOT_DIR/extensions/jupyter"

echo "Jupyter Extension build complete"
echo ""

# Step 3: Show results
echo "Build complete!"
echo ""
echo "To run:"
echo "  Agent Server: cd agent-server && poetry run uvicorn agent_server.main:app --port 8000"
echo "  Jupyter Lab:  poetry run jupyter lab"
