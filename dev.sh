#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "Starting MCPeriscope..."

# Start FastAPI backend
uvicorn backend.main:app --reload --port 8000 &
BACKEND_PID=$!

# Start Vite frontend
cd frontend && npm run dev &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT

echo "Backend: http://localhost:8000"
echo "Frontend: http://localhost:5173"

wait
