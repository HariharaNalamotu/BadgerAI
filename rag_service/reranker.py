"""bge-reranker-large cross-encoder — optimised for RTX 5080 (Blackwell, 16 GB VRAM).

Runs in BF16 (~1.3 GB VRAM). No quantisation needed — it's small enough.
torch.compile gives a meaningful speedup since reranking processes many pairs.
"""
from __future__ import annotations
import logging
import torch
from sentence_transformers import CrossEncoder

logger = logging.getLogger(__name__)

_MODEL_NAME = "BAAI/bge-reranker-large"


class Reranker:
    def __init__(self, model_name: str = _MODEL_NAME) -> None:
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model_name = model_name

        logger.info("Loading %s on %s (BF16) …", model_name, self.device)

        self.model = CrossEncoder(
            model_name,
            device=self.device,
            automodel_args={
                "torch_dtype": torch.bfloat16,
                "attn_implementation": "flash_attention_2",
            },
        )

        if self.device == "cuda":
            try:
                self.model.model = torch.compile(
                    self.model.model,
                    mode="reduce-overhead",
                    fullgraph=False,
                )
                logger.info("torch.compile enabled for reranker.")
            except Exception as e:
                logger.warning("torch.compile skipped: %s", e)

        logger.info("Reranker ready (device=%s)", self.device)

    def rerank(self, query: str, passages: list[str], batch_size: int = 64) -> list[float]:
        """Return relevance scores for each (query, passage) pair. Higher = more relevant."""
        if not passages:
            return []
        pairs = [(query, p) for p in passages]
        with torch.inference_mode():
            scores = self.model.predict(
                pairs,
                batch_size=batch_size,
                show_progress_bar=False,
                convert_to_numpy=True,
            )
        return scores.tolist()
