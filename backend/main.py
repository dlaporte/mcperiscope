from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.state import session
from backend.routes import analysis, auth_routes, connection, optimize, prompts, resources, results, tools


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    if session.connection:
        await session.connection.disconnect()


app = FastAPI(title="MCPeriscope", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Phase 1 routes
app.include_router(connection.router, prefix="/api")
app.include_router(auth_routes.router, prefix="/api")

# Phase 2 routes
app.include_router(tools.router, prefix="/api")
app.include_router(resources.router, prefix="/api")
app.include_router(prompts.router, prefix="/api")
app.include_router(analysis.router, prefix="/api")

# Phase 3 routes
app.include_router(optimize.router, prefix="/api")

# Phase 4 routes
app.include_router(results.router, prefix="/api")
