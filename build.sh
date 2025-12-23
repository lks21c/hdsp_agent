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

# Temporarily add torch==2.2.2 for Mac build compatibility
echo "Temporarily adding torch==2.2.2 for build..."
if ! grep -q 'torch = "2.2.2"' pyproject.toml; then
    # Add torch after sentence-transformers dependency line (not comments)
    sed -i.bak '/^sentence-transformers = /a\
torch = "2.2.2"  # Temporary: Auto-added by build.sh for Mac compatibility
' pyproject.toml
    TORCH_ADDED=true
else
    TORCH_ADDED=false
fi

poetry install --no-interaction
poetry run pytest tests/ -v --tb=short

# Remove temporary torch addition
if [ "$TORCH_ADDED" = true ]; then
    echo "Removing temporary torch from pyproject.toml..."
    mv pyproject.toml.bak pyproject.toml 2>/dev/null || sed -i.bak '/torch = "2.2.2"/d' pyproject.toml
    rm -f pyproject.toml.bak
fi

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

echo "Jupyter Extension build complete"
echo ""

# Step 3: Build whl package (with embedded agent-server)
echo "3. Building whl package..."
cd "$ROOT_DIR/extensions/jupyter"

# Copy agent_server for whl build
echo "Copying agent_server module..."
if [ -d "agent_server" ]; then
    rm -rf agent_server
fi
cp -r "$ROOT_DIR/agent-server/agent_server" .

# Build whl
echo "Building whl with python -m build..."
python -m build

# Cleanup copied agent_server
rm -rf agent_server

echo "whl package built:"
ls -lh dist/*.whl
echo ""

# Step 4: Show results
echo "Build complete!"
echo ""
echo "whl location: $ROOT_DIR/extensions/jupyter/dist/"
echo ""
echo "To run:"
echo "  Agent Server: cd agent-server && poetry run uvicorn agent_server.main:app --port 8000"
echo "  Jupyter Lab:  poetry run jupyter lab"
