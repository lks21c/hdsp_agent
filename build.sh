#!/bin/bash
set -e

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
rm -rf lib dist tsconfig.tsbuildinfo jupyter_ext/labextension

# Install dependencies
if [ ! -d "node_modules" ]; then
    echo "Installing node dependencies..."
    yarn install
fi

# TypeScript compilation with asset copy
echo "Compiling TypeScript..."
mkdir -p lib/styles/icons
cp -r frontend/styles/icons/* lib/styles/icons/
./node_modules/.bin/tsc

# Build labextension
echo "Building labextension..."
cd "$ROOT_DIR"
poetry run jupyter labextension build "$ROOT_DIR/extensions/jupyter" --development True

echo "Jupyter Extension build complete"
echo ""

# Step 3: Show results
echo "Build complete!"
echo ""
echo "To run:"
echo "  Agent Server: cd agent-server && poetry run uvicorn agent_server.main:app --port 8000"
echo "  Jupyter Lab:  poetry run jupyter lab"
