"""FastAPI server exposing embedding, reranking, and full search endpoints."""
from __future__ import annotations
import logging
import os
from contextlib import asynccontextmanager
from typing import Any

import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .config import get_db_path, get_service_settings
from .database import Database
from .embedder import Embedder
from .reranker import Reranker
from .search import SearchPipeline

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

# ── Shared state ─────────────────────────────────────────────────────────────

_state: dict[str, Any] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    cfg = get_service_settings()
    batch_size = int(cfg.get("embed_batch_size", 32))
    db_path = get_db_path()
    logger.info("DB path: %s", db_path)

    _state["embedder"] = Embedder(batch_size=batch_size)
    _state["reranker"] = Reranker()
    _state["db"] = Database(db_path)
    _state["pipeline"] = SearchPipeline(
        _state["db"], _state["embedder"], _state["reranker"]
    )
    yield
    _state.clear()


app = FastAPI(title="BadgerAI RAG Service", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Request / Response models ─────────────────────────────────────────────────

class EmbedRequest(BaseModel):
    texts: list[str]
    is_query: bool = False


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]
    model: str
    device: str


class RerankRequest(BaseModel):
    query: str
    passages: list[str]


class RerankResponse(BaseModel):
    scores: list[float]
    model: str


class SearchRequest(BaseModel):
    query: str
    library: str | None = None
    mode: str = "hybrid"
    top_k: int = 5
    rerank: bool = True
    vector_weight: float = 0.60
    bm25_weight: float = 0.40


# ── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/v1/health")
def health():
    embedder: Embedder = _state.get("embedder")  # type: ignore
    reranker: Reranker = _state.get("reranker")  # type: ignore
    return {
        "status": "ok",
        "embedding_model": embedder.model_name if embedder else None,
        "reranker_model": reranker.model_name if reranker else None,
        "device": "cuda" if torch.cuda.is_available() else "cpu",
        "cuda_device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
    }


@app.post("/v1/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest):
    if not req.texts:
        raise HTTPException(400, "texts must not be empty")
    embedder: Embedder = _state["embedder"]
    if req.is_query:
        embeddings = embedder.embed_queries(req.texts)
    else:
        embeddings = embedder.embed_passages(req.texts)
    return EmbedResponse(
        embeddings=embeddings,
        model=embedder.model_name,
        device=embedder.device,
    )


@app.post("/v1/rerank", response_model=RerankResponse)
def rerank(req: RerankRequest):
    if not req.passages:
        return RerankResponse(scores=[], model=_state["reranker"].model_name)
    reranker: Reranker = _state["reranker"]
    scores = reranker.rerank(req.query, req.passages)
    return RerankResponse(scores=scores, model=reranker.model_name)


@app.post("/v1/search")
def search(req: SearchRequest):
    pipeline: SearchPipeline = _state["pipeline"]
    results = pipeline.search(
        query=req.query,
        library=req.library,
        mode=req.mode,
        top_k=req.top_k,
        rerank=req.rerank,
        vector_weight=req.vector_weight,
        bm25_weight=req.bm25_weight,
    )
    return {
        "query": req.query,
        "library": req.library,
        "mode": req.mode,
        "top_k": req.top_k,
        "rerank": req.rerank,
        "results": results,
    }


@app.get("/v1/libraries")
def list_libraries():
    db: Database = _state["db"]
    return {"libraries": db.list_libraries()}


@app.get("/v1/libraries/{library_name}")
def get_library(library_name: str):
    db: Database = _state["db"]
    lib = db.get_library(library_name)
    if not lib:
        raise HTTPException(404, f"Library '{library_name}' not found")
    return lib
