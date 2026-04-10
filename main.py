"""
main.py — FastAPI server for the Stock Trading Agent OpenEnv environment.

Endpoints
---------
POST /reset   → StockObservation
POST /step    → {observation, reward, done, info}
GET  /state   → StockState
GET  /tasks   → list of tasks
GET  /health  → {"status": "ok"}
GET  /        → metadata
"""
from __future__ import annotations

import threading
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from env.environment import StockTradingEnvironment
from env.models import StockAction

app = FastAPI(
    title="Stock Trading Agent Environment",
    description="OpenEnv environment where AI agents learn to trade stocks using technical indicators.",
    version="1.0.0",
)

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_env = StockTradingEnvironment()
_lock = threading.Lock()


class ResetRequest(BaseModel):
    task_id: Optional[str] = None


@app.post("/reset")
def reset(request: ResetRequest = None):
    with _lock:
        try:
            task_id = request.task_id if request else None
            obs = _env.reset(task_id=task_id)
            return obs.model_dump()
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))


@app.post("/step")
def step(action: StockAction):
    with _lock:
        try:
            obs, reward, done, info = _env.step(action)
            return {"observation": obs.model_dump(), "reward": reward.model_dump(), "done": done, "info": info}
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc))


@app.get("/state")
def state():
    with _lock:
        return _env.state()


@app.get("/tasks")
def list_tasks():
    with _lock:
        return _env.list_tasks()


@app.get("/health")
def health():
    return {"status": "ok", "environment": "stock-trading-agent", "version": "1.0.0"}


@app.get("/")
def root():
    return {
        "name": "Stock Trading Agent Environment",
        "version": "1.0.0",
        "openenv": True,
        "tasks": 3,
        "endpoints": ["/reset", "/step", "/state", "/tasks", "/health"],
    }
