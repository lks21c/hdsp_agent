#!/bin/bash
set -e

echo "=== HDSP Agent Build Script ==="
echo ""

# Change to script directory
cd "$(dirname "$0")"

echo "📂 Working directory: $(pwd)"
echo ""

# Step 1: TypeScript compilation
echo "1️⃣  Compiling TypeScript..."
npx tsc
echo "✅ TypeScript compilation complete"
echo ""

echo "📂 Copying static assets..."
# frontend/styles 폴더를 lib/styles로 통째로 복사합니다.
cp -R frontend/styles lib/
echo "✅ Assets copied"

# Step 2: JupyterLab extension build (production mode)
echo "2️⃣  Building JupyterLab extension (production)..."
poetry run jupyter labextension build .
echo "✅ JupyterLab extension build complete"
echo ""

# Step 3: Build wheel package
echo "3️⃣  Building wheel package..."
poetry build
echo "✅ Wheel package build complete"
echo ""

# Step 4: Show results
echo "📦 Build artifacts:"
ls -lh dist/
echo ""

echo "🎉 Build complete!"
echo ""
echo "📝 To install in another environment:"
echo "   poetry add $(pwd)/dist/hdsp_agent-0.1.0-py3-none-any.whl"
echo ""
echo "   Or:"
echo "   poetry run pip install $(pwd)/dist/hdsp_agent-0.1.0-py3-none-any.whl"
