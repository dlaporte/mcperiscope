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

# Default to loopback. Set MCPERISCOPE_HOST=0.0.0.0 for LAN exposure (not recommended).
HOST="${MCPERISCOPE_HOST:-127.0.0.1}"
VITE_HOST_ARGS=()
if [ "$HOST" != "127.0.0.1" ] && [ "$HOST" != "localhost" ]; then
  echo "WARNING: binding to $HOST exposes MCPeriscope beyond localhost." >&2
  VITE_HOST_ARGS=(--host "$HOST")
fi

# Start FastAPI backend
python -m uvicorn backend.main:app --reload --host "$HOST" --port 8000 &
BACKEND_PID=$!

# Start Vite frontend
cd frontend && npx vite "${VITE_HOST_ARGS[@]}" &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT

echo "Backend: http://$HOST:8000"
echo "Frontend: http://$HOST:5173"

wait
