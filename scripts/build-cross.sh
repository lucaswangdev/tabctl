#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR/.."
cd "$ROOT/server-rs"

echo "🔨 Building cross-platform binaries..."
echo ""

mkdir -p "$ROOT/dist"

# Linux x86_64 (native build)
echo "📦 [1/3] Linux x86_64..."
cargo build --release --target x86_64-unknown-linux-gnu 2>&1 | tail -3
cp target/x86_64-unknown-linux-gnu/release/tabctl-server "$ROOT/dist/tabctl-linux-x86_64"
echo "   ✅ tabctl-linux-x86_64"

# Windows x86_64 (cross-compile with mingw-w64)
echo "📦 [2/3] Windows x86_64..."
if command -v x86_64-w64-mingw32-gcc &> /dev/null; then
  CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=x86_64-w64-mingw32-gcc \
  cargo build --release --target x86_64-pc-windows-gnu 2>&1 | tail -3
  cp target/x86_64-pc-windows-gnu/release/tabctl-server.exe "$ROOT/dist/tabctl-windows-x86_64.exe"
  echo "   ✅ tabctl-windows-x86_64.exe"
else
  echo "   ⏭️  Skipping (mingw-w64 not installed)"
fi

# macOS targets require macOS machine or osxcross
echo "📦 [3/3] macOS binaries..."
if [ "$(uname)" = "Darwin" ]; then
  cargo build --release --target x86_64-apple-darwin 2>&1 | tail -1
  cp target/x86_64-apple-darwin/release/tabctl-server "$ROOT/dist/tabctl-macos-x86_64"
  cargo build --release --target aarch64-apple-darwin 2>&1 | tail -1
  cp target/aarch64-apple-darwin/release/tabctl-server "$ROOT/dist/tabctl-macos-arm64"
  echo "   ✅ tabctl-macos-x86_64"
  echo "   ✅ tabctl-macos-arm64"
else
  echo "   ⏭️  Skipping (requires macOS or osxcross)"
fi

echo ""
echo "✅ Build complete:"
ls -lh "$ROOT/dist/tabctl-"* 2>/dev/null