"""NV-Embed-v2 embedding — optimised for RTX 5080 (Blackwell, 16 GB VRAM).

Memory layout (approximate):
  NV-Embed-v2  INT8 quantised  ≈  7 GB   (vs 14 GB in BF16)
  bge-reranker-large BF16      ≈  1.3 GB
  Activations + overhead       ≈  2-3 GB
  Total                        ≈ 10-11 GB  (comfortable on 16 GB)
"""
from __future__ import annotations
import logging
import torch
from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)

_QUERY_INSTRUCTION = (
    "Instruct: Given a web search query, retrieve relevant passages "
    "that answer the query\nQuery: "
)
_MODEL_NAME = "nvidia/NV-Embed-v2"


class Embedder:
    def __init__(self, model_name: str = _MODEL_NAME, batch_size: int = 32) -> None:
        if not torch.cuda.is_available():
            logger.warning("CUDA not available — running on CPU (very slow).")
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.batch_size = batch_size
        self.model_name = model_name

        logger.info("Loading %s on %s (INT8 quantised) …", model_name, self.device)

        # INT8 via bitsandbytes: halves VRAM vs BF16, negligible quality loss for retrieval.
        # Flash Attention 2: ~2x throughput on long sequences (Blackwell supports FA2 natively).
        self.model = SentenceTransformer(
            model_name,
            trust_remote_code=True,
            device=self.device,
            model_kwargs={
                "torch_dtype": torch.bfloat16,   # BF16 base before quantisation
                "load_in_8bit": True,             # bitsandbytes INT8 — ~7 GB VRAM
                "attn_implementation": "flash_attention_2",
            },
        )

        # torch.compile — reduces Python overhead on repeated calls (~15-25% faster).
        # "reduce-overhead" is the right preset for inference workloads.
        if self.device == "cuda":
            try:
                self.model[0].auto_model = torch.compile(
                    self.model[0].auto_model,
                    mode="reduce-overhead",
                    fullgraph=False,
                )
                logger.info("torch.compile enabled for embedder.")
            except Exception as e:
                logger.warning("torch.compile skipped: %s", e)

        logger.info(
            "Embedder ready (dim=%d, device=%s)",
            self.model.get_sentence_embedding_dimension(),
            self.device,
        )

    def embed_passages(self, texts: list[str]) -> list[list[float]]:
        """Embed document passages — no instruction prefix."""
        return self._encode(texts, prompt=None)

    def embed_queries(self, queries: list[str]) -> list[list[float]]:
        """Embed retrieval queries with the NV-Embed-v2 task instruction."""
        return self._encode(queries, prompt=_QUERY_INSTRUCTION)

    def _encode(self, texts: list[str], prompt: str | None) -> list[list[float]]:
        kwargs: dict = {
            "normalize_embeddings": True,
            "batch_size": self.batch_size,
            "show_progress_bar": False,
        }
        if prompt:
            kwargs["prompt"] = prompt
        with torch.inference_mode():
            embeddings = self.model.encode(texts, **kwargs)
        return embeddings.tolist()
