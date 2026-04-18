"""Read-only SQLite access for the Python RAG service."""
from __future__ import annotations
import sqlite3
import struct
from pathlib import Path
from typing import Any


def _bytes_to_embedding(blob: bytes) -> list[float]:
    if not blob:
        return []
    n = len(blob) // 4
    return list(struct.unpack_from(f"{n}f", blob))


class Database:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self._conn: sqlite3.Connection | None = None

    def _get_conn(self) -> sqlite3.Connection:
        if self._conn is None:
            self._conn = sqlite3.connect(
                f"file:{self.db_path}?mode=ro",
                uri=True,
                check_same_thread=False,
            )
            self._conn.row_factory = sqlite3.Row
        return self._conn

    def list_libraries(self) -> list[dict[str, Any]]:
        cur = self._get_conn().execute(
            """SELECT library_name, source_url, page_count, chunk_count,
                      embedded_chunk_count, updated_at
               FROM libraries ORDER BY library_name"""
        )
        return [dict(r) for r in cur.fetchall()]

    def get_library(self, library_name: str) -> dict[str, Any] | None:
        cur = self._get_conn().execute(
            "SELECT * FROM libraries WHERE library_name = ?", (library_name,)
        )
        row = cur.fetchone()
        return dict(row) if row else None

    def bm25_scores(
        self, library_name: str, query: str, limit: int = 100
    ) -> dict[int, float]:
        """Return {chunk_id: score} from SQLite FTS5 BM25."""
        if not query.strip():
            return {}
        # Tokenise into OR-joined quoted terms
        seen: set[str] = set()
        terms = []
        for tok in query.split():
            tok = tok.strip('"\'.,;:!?()[]{}').lower()
            if tok and tok not in seen:
                seen.add(tok)
                terms.append(f'"{tok}"')
        fts_query = " OR ".join(terms)
        if not fts_query:
            return {}
        try:
            cur = self._get_conn().execute(
                """SELECT rowid, -bm25(chunks_fts) AS score
                   FROM chunks_fts
                   WHERE chunks_fts MATCH ? AND library_name = ?
                   ORDER BY bm25(chunks_fts) LIMIT ?""",
                (fts_query, library_name, limit),
            )
            return {row["rowid"]: row["score"] for row in cur.fetchall()}
        except sqlite3.OperationalError:
            return {}

    def get_chunks(self, library_name: str) -> list[dict[str, Any]]:
        cur = self._get_conn().execute(
            """SELECT id, parent_id, content, embedding
               FROM chunks WHERE library_name = ?""",
            (library_name,),
        )
        result = []
        for row in cur.fetchall():
            result.append({
                "id": row["id"],
                "parent_id": row["parent_id"],
                "content": row["content"],
                "embedding": _bytes_to_embedding(row["embedding"] or b""),
            })
        return result

    def get_parent(self, parent_id: int) -> dict[str, Any] | None:
        cur = self._get_conn().execute(
            """SELECT id, library_name, source_url, source_page_order,
                      parent_index_in_page, global_parent_index, content
               FROM parents WHERE id = ?""",
            (parent_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None

    def embedded_chunk_count(self, library_name: str) -> tuple[int, int]:
        cur = self._get_conn().execute(
            "SELECT COALESCE(chunk_count,0), COALESCE(embedded_chunk_count,0) "
            "FROM libraries WHERE library_name = ?",
            (library_name,),
        )
        row = cur.fetchone()
        return (row[0], row[1]) if row else (0, 0)
