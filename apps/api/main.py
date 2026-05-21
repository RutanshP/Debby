from __future__ import annotations

import importlib
import os
import pkgutil

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import routes

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


# Auto-discover and mount every router under `routes/`.
# Each worker unit drops a module that exports `router` (an APIRouter); we pick
# it up without anyone needing to edit this file.
for _, module_name, _ in pkgutil.iter_modules(routes.__path__):
    module = importlib.import_module(f"routes.{module_name}")
    router = getattr(module, "router", None)
    if router is not None:
        app.include_router(router, prefix="/api")
