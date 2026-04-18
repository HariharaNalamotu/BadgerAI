"""Full hybrid RAG search pipeline: BM25 + NV-Embed-v2 + bge-reranker-large."""
from __future__ import annotations
import math
from typing import Any

from .database import Database
from .embedder import Embedder
from .reranker import Reranker


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na > 0 and nb > 0 else 0.0


def _normalize(scores: dict[int, float]) -> dict[int, float]:
    if not scores:
        return {}
    lo, hi = min(scores.values()), max(scores.values())
    if abs(hi - lo) < 1e-9:
        return {k: 1.0 for k in scores}
    return {k: (v - lo) / (hi - lo) for k, v in scores.items()}


class SearchPipeline:
    def __init__(self, db: Database, embedder: Embedder, reranker: Reranker) -> None:
        self.db = db
        self.embedder = embedder
        self.reranker = reranker

    def search(
        self,
        query: str,
        library: str | None = None,
        mode: str = "hybrid",
        top_k: int = 5,
        rerank: bool = True,
        rerank_candidates: int | None = None,
        vector_weight: float = 0.60,
        bm25_weight: float = 0.40,
    ) -> list[dict[str, Any]]:
        """Run the full retrieval pipeline and return ranked results."""
        libraries = self._resolve_libraries(library)
        if not libraries:
            return []

        fetch_k = rerank_candidates or max(top_k * 5, top_k + 10)

        # Embed query once (reused across libraries)
        query_embedding: list[float] = []
        if mode in ("hybrid", "vector"):
            query_embedding = self.embedder.embed_queries([query])[0]

        all_candidates: list[dict[str, Any]] = []
        seen_parents: set[int] = set()

        for lib_name in libraries:
            total, embedded = self.db.embedded_chunk_count(lib_name)
            if total == 0:
                continue
            use_vector = mode in ("hybrid", "vector") and embedded == total and bool(query_embedding)

            # BM25 scores from SQLite FTS5
            bm25_raw = self.db.bm25_scores(lib_name, query, limit=fetch_k * 3) if mode != "vector" else {}

            # Load chunks with embeddings
            chunks = self.db.get_chunks(lib_name)

            # Score each chunk
            vector_raw: dict[int, float] = {}
            if use_vector:
                for chunk in chunks:
                    if chunk["embedding"]:
                        vector_raw[chunk["id"]] = _cosine(query_embedding, chunk["embedding"])

            v_norm = _normalize(vector_raw)
            b_norm = _normalize(bm25_raw)

            for chunk in chunks:
                v = v_norm.get(chunk["id"], 0.0)
                b = b_norm.get(chunk["id"], 0.0)
                if mode == "vector":
                    final = v
                elif mode == "keyword":
                    final = b
                else:  # hybrid
                    final = vector_weight * v + bm25_weight * b

                if final <= 0.0:
                    continue
                if chunk["parent_id"] in seen_parents:
                    continue

                seen_parents.add(chunk["parent_id"])
                all_candidates.append({
                    "chunk_id": chunk["id"],
                    "parent_id": chunk["parent_id"],
                    "library_name": lib_name,
                    "vector_score": v,
                    "bm25_score": b,
                    "initial_score": final,
                    "rerank_score": 0.0,
                })

        # Sort by initial score and take fetch_k candidates
        all_candidates.sort(key=lambda x: x["initial_score"], reverse=True)
        candidates = all_candidates[:fetch_k]

        if not candidates:
            return []

        # Load parent content for candidates
        for c in candidates:
            parent = self.db.get_parent(c["parent_id"])
            if parent:
                c["content"] = parent["content"]
                c["source_url"] = parent["source_url"]
            else:
                c["content"] = ""
                c["source_url"] = ""

        # Rerank with bge-reranker-large
        if rerank and len(candidates) > 1:
            passages = [c["content"] for c in candidates]
            scores = self.reranker.rerank(query, passages)
            for c, s in zip(candidates, scores):
                c["rerank_score"] = float(s)
            candidates.sort(key=lambda x: x["rerank_score"], reverse=True)

        # Build final output
        results = []
        for rank, c in enumerate(candidates[:top_k], start=1):
            results.append({
                "rank": rank,
                "chunk_id": c["chunk_id"],
                "parent_id": c["parent_id"],
                "library_name": c["library_name"],
                "source_url": c.get("source_url", ""),
                "content": c.get("content", ""),
                "scores": {
                    "rerank": c["rerank_score"],
                    "initial": c["initial_score"],
                    "vector": c["vector_score"],
                    "bm25": c["bm25_score"],
                },
            })
        return results

    def _resolve_libraries(self, library: str | None) -> list[str]:
        if library:
            return [library]
        return [lib["library_name"] for lib in self.db.list_libraries()]
