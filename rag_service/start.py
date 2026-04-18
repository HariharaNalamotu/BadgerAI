#!/usr/bin/env python3
"""Start the BadgerAI RAG service.

Usage:
    python rag_service/start.py [--host HOST] [--port PORT] [--reload]

The service loads NV-Embed-v2 and bge-reranker-large onto the GPU on startup
(~30-60 s for first run while models download). It then listens for requests
from the Rust CLI (embedding, reranking) and the web frontend (full search).
"""
import argparse
import sys
from pathlib import Path

# Make sure the package is importable when run as a script
sys.path.insert(0, str(Path(__file__).parent.parent))

import uvicorn

parser = argparse.ArgumentParser(description="Start the BadgerAI RAG service")
parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
parser.add_argument("--port", type=int, default=8765, help="Bind port (default: 8765)")
parser.add_argument("--reload", action="store_true", help="Enable auto-reload for development")
args = parser.parse_args()

print(f"Starting BadgerAI RAG service on {args.host}:{args.port}")
print("Loading NV-Embed-v2 and bge-reranker-large — first run may download models (~3 GB).")
print()

uvicorn.run(
    "rag_service.server:app",
    host=args.host,
    port=args.port,
    reload=args.reload,
    log_level="info",
)
