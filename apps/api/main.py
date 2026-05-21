from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Debby API", version="0.1.0")

_allowed = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000")
allowed_origins = [o.strip() for o in _allowed.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


# Worker units (A1-A7) register their routers here in their PRs:
#     from routes.topics import router as topics_router
#     app.include_router(topics_router, prefix="/api")
