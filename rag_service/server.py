"""FastAPI server exposing embedding, reranking, and full search endpoints."""
from __future__ import annotations
import logging
import os
import subprocess
import sys
import tempfile
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

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


class IndexRequest(BaseModel):
    library_name: str
    url: str


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


def _find_binary() -> Path:
    """Find the plshelp binary next to this package."""
    root = Path(__file__).parent.parent
    for name in ("plshelp.exe", "plshelp"):
        p = root / "target" / "release" / name
        if p.exists():
            return p
    raise FileNotFoundError(
        "plshelp binary not found. Build it with: cargo build --release"
    )


def _is_single_page(url: str) -> bool:
    """
    True when a URL points to a specific deep page (.com/a/b or deeper).
    False for site roots or one-segment bases (.com/ or .com/docs).
    """
    try:
        path = urlparse(url).path
        segments = [s for s in path.split("/") if s]
        return len(segments) >= 2
    except Exception:
        return False


def _extract_file_text(path: str) -> str:
    """Extract plain text from PDF, DOCX, HTML, MD, or TXT files."""
    p = Path(path).expanduser().resolve()
    if not p.exists():
        raise FileNotFoundError(f"File not found: {p}")
    suffix = p.suffix.lower()

    if suffix == ".pdf":
        import pdfplumber
        pages: list[str] = []
        with pdfplumber.open(p) as pdf:
            for page in pdf.pages:
                text = page.extract_text()
                if text and text.strip():
                    pages.append(text.strip())
        return "\n\n".join(pages)

    if suffix == ".docx":
        from docx import Document  # python-docx
        doc = Document(str(p))
        paras = [para.text for para in doc.paragraphs if para.text.strip()]
        return "\n\n".join(paras)

    if suffix in (".html", ".htm"):
        from bs4 import BeautifulSoup
        html = p.read_text(encoding="utf-8", errors="ignore")
        soup = BeautifulSoup(html, "html.parser")
        for tag in soup(["script", "style", "nav", "footer"]):
            tag.decompose()
        return soup.get_text(separator="\n\n")

    # MD, TXT, RST, and everything else — read as-is
    return p.read_text(encoding="utf-8", errors="ignore")


def _run_local_file_index(binary: str, lib_name: str, path: str) -> None:
    """Extract text from a local file and index it via plshelp. Runs in a thread."""
    tmp_path: Path | None = None
    try:
        text = _extract_file_text(path)
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".txt", delete=False, encoding="utf-8"
        ) as f:
            f.write(text)
            tmp_path = Path(f.name)
        subprocess.run(
            [binary, "index", lib_name, "--file", str(tmp_path)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        logger.info("Indexed local file '%s' as library '%s'", path, lib_name)
    except Exception as exc:
        logger.error("Local file indexing failed for '%s': %s", lib_name, exc)
    finally:
        if tmp_path and tmp_path.exists():
            tmp_path.unlink(missing_ok=True)


@app.post("/v1/index", status_code=202)
def index_library(req: IndexRequest):
    """
    Start indexing in the background.

    • HTTP/HTTPS URL  → plshelp add (auto-detects website vs single page)
    • Local file path → extract text (PDF/DOCX/HTML/MD/TXT), then plshelp index --file
    """
    lib_name = req.library_name.strip()
    url = req.url.strip()
    if not lib_name or not url:
        raise HTTPException(400, "library_name and url are required")

    try:
        binary = str(_find_binary())
    except FileNotFoundError as e:
        raise HTTPException(500, str(e))

    if url.startswith(("http://", "https://")):
        args = [binary, "add", lib_name, url]
        if _is_single_page(url):
            args.append("--single")
            logger.info("Indexing single page '%s' from %s", lib_name, url)
        else:
            logger.info("Indexing full site '%s' from %s", lib_name, url)
        subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        logger.info("Indexing local file '%s' as library '%s'", url, lib_name)
        t = threading.Thread(
            target=_run_local_file_index, args=(binary, lib_name, url), daemon=True
        )
        t.start()

    return {"status": "started", "library_name": lib_name, "url": url}
