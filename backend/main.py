from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
from fastapi.middleware.cors import CORSMiddleware

from backend.auth_token import init_token, require_token, token_path
from backend.state import session
from backend.routes import analysis, auth_routes, connection, optimize, prompts, resources, results, tools

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    token = init_token()
    logger.info("MCPeriscope auth token written to %s", token_path())
    if os.environ.get("MCPERISCOPE_PRINT_TOKEN") == "1":
        logger.info("MCPeriscope bearer token: %s", token)
    yield
    if session.connection:
        await session.connection.disconnect()


app = FastAPI(title="MCPeriscope", lifespan=lifespan)

cors_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")]
# We don't use cookies; the bearer token travels in the Authorization header.
# Disabling credentials lets us be precise about allowed methods/headers
# without running into the spec rule that bans wildcards with credentials.
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# Single dependency that guards every /api route.
_API = [Depends(require_token)]

# Phase 1 routes
app.include_router(connection.router, prefix="/api", dependencies=_API)
app.include_router(auth_routes.router, prefix="/api", dependencies=_API)

# Phase 2 routes
app.include_router(tools.router, prefix="/api", dependencies=_API)
app.include_router(resources.router, prefix="/api", dependencies=_API)
app.include_router(prompts.router, prefix="/api", dependencies=_API)
app.include_router(analysis.router, prefix="/api", dependencies=_API)

# Phase 3 routes
app.include_router(optimize.router, prefix="/api", dependencies=_API)

# Phase 4 routes
app.include_router(results.router, prefix="/api", dependencies=_API)


@app.get("/healthz")
async def healthz():
    # Unauthenticated liveness check; reveals no session data.
    return {"ok": True}
