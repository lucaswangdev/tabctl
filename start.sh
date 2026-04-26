#!/bin/bash
set -e

PORT=7420
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "⎈  Starting tabctl..."

# Kill old server if port is in use
if lsof -ti :$PORT > /dev/null 2>&1; then
  echo "⚠️  Port $PORT in use — killing old process..."
  lsof -ti :$PORT | xargs kill -9 2>/dev/null || true
  sleep 1
fi

# Build extension
echo "⎈  Building extension..."
cd "$ROOT/extension"
npm install > /dev/null 2>&1
npm run build > /dev/null 2>&1

# Build server
echo "⎈  Building server..."
cd "$ROOT/server"
npm install > /dev/null 2>&1
npm run build > /dev/null 2>&1

# Start server
echo "⎈  Starting server on port $PORT..."
nohup node dist/server.js > /tmp/tabctl.log 2>&1 &
disown

sleep 1

if curl -s http://localhost:$PORT/health > /dev/null 2>&1; then
  echo "✅  tabctl is running at http://localhost:$PORT"
  echo "📦  Load extension from: $ROOT/extension/dist/"
  echo "📝  Logs: /tmp/tabctl.log"
else
  echo "❌  Server failed to start. Check /tmp/tabctl.log"
  cat /tmp/tabctl.log
  exit 1
fi
