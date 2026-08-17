from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .cases import router as cases_router
from .db import database_path, ensure_case_database

@asynccontextmanager
async def lifespan(_app: FastAPI):
    ensure_case_database()
    yield


app = FastAPI(title="公司設立登記案件 API", version="0.1.0", lifespan=lifespan)
origins = [origin.strip() for origin in os.getenv(
    "CASES_ALLOWED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173",
).split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["Content-Type"],
)
app.include_router(cases_router)


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(_request: Request, exc: StarletteHTTPException):
    """The previous route handlers replied with ``{"error": ...}`` rather than FastAPI's detail."""
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


@app.exception_handler(Exception)
async def unhandled_exception_handler(_request: Request, exc: Exception):
    return JSONResponse({"error": str(exc)}, status_code=500)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "database": str(database_path())}
