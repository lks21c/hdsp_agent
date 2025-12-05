#!/bin/bash
set -e

echo "=== HDSP Agent Build Script ==="
echo ""

# Change to script directory
cd "$(dirname "$0")"

echo "📂 Working directory: $(pwd)"
echo ""

# [추가됨] Step 0: Clean previous builds (필수!)
# 기존에 남아있는 컴파일 결과물과 캐시를 강제로 삭제합니다.
echo "0️⃣  Cleaning previous build artifacts..."
rm -rf lib dist tsconfig.tsbuildinfo
# 주피터랩 확장 빌드 캐시도 청소
poetry run jupyter lab clean
echo "✅ Clean complete"
echo ""

# Step 1: TypeScript compilation
echo "1️⃣  Compiling TypeScript..."
npx tsc
echo "✅ TypeScript compilation complete"
echo ""

# [확인 절차] 정말로 JS 파일이 변했는지 확인 (디버깅용, 나중에 주석 처리 가능)
if grep -q "PageConfig" lib/services/ApiService.js; then
    echo "✅ Verified: ApiService.js contains PageConfig logic."
else
    echo "❌ Error: ApiService.js does NOT contain PageConfig logic. Check source file."
    exit 1
fi

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
echo "   Or (Force Reinstall Recommended):"
echo "   poetry run pip install --force-reinstall --no-cache-dir $(pwd)/dist/hdsp_agent-0.1.0-py3-none-any.whl"