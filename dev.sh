#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

# Install dependencies if needed
if command -v uv &>/dev/null; then
  uv sync --quiet
else
  pip install -q -e .
fi

if [ ! -d frontend/node_modules ]; then
  echo "Installing frontend dependencies..."
  (cd frontend && npm install)
fi

echo "Starting MCPeriscope..."

# Start FastAPI backend
uv run python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# Start Vite frontend
cd frontend && npx vite --host &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT

echo "Backend: http://localhost:8000"
echo "Frontend: http://localhost:5173"

wait
