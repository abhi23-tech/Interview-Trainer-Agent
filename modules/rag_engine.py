"""
RAG Engine — FAISS-powered retrieval for Interview Trainer
Builds a local vector store from knowledge base text files and
exposes a retrieve() function used once per user query.
"""

import os
import json
import logging
import numpy as np
from pathlib import Path
from typing import List, Tuple

logger = logging.getLogger(__name__)

# ── optional heavy imports (graceful fallback) ─────────────────────────────
try:
    from sentence_transformers import SentenceTransformer
    import faiss
    _DEPS_AVAILABLE = True
except ImportError:
    _DEPS_AVAILABLE = False
    logger.warning("sentence-transformers or faiss not installed — RAG disabled (keyword fallback active)")


# ──────────────────────────────────────────────────────────────────────────
#  Text chunking helpers
# ──────────────────────────────────────────────────────────────────────────

def _chunk_text(text: str, chunk_size: int = 200, overlap: int = 30) -> List[str]:
    """Split text into overlapping word-level chunks."""
    words = text.split()
    chunks: List[str] = []
    start = 0
    while start < len(words):
        end = min(start + chunk_size, len(words))
        chunks.append(" ".join(words[start:end]))
        if end == len(words):
            break
        start += chunk_size - overlap
    return chunks


def _load_knowledge_base(kb_dir: str) -> Tuple[List[str], List[dict]]:
    """Load all .txt files from the knowledge base directory."""
    kb_path = Path(kb_dir)
    chunks: List[str] = []
    metadatas: List[dict] = []

    if not kb_path.exists():
        logger.warning(f"Knowledge base directory not found: {kb_dir}")
        return chunks, metadatas

    for txt_file in sorted(kb_path.glob("*.txt")):
        try:
            content = txt_file.read_text(encoding="utf-8", errors="ignore")
            file_chunks = _chunk_text(content)
            for i, chunk in enumerate(file_chunks):
                chunks.append(chunk)
                metadatas.append({
                    "source": txt_file.name,
                    "chunk_index": i,
                    "category": _infer_category(txt_file.name),
                })
            logger.info(f"Loaded {len(file_chunks)} chunks from {txt_file.name}")
        except Exception as exc:
            logger.error(f"Failed to load {txt_file}: {exc}")

    return chunks, metadatas


def _infer_category(filename: str) -> str:
    name = filename.lower()
    if "technical" in name:
        return "Technical Questions"
    if "hr" in name or "behavioral" in name:
        return "HR & Behavioral"
    if "coding" in name:
        return "Coding Challenges"
    if "company" in name:
        return "Company-Specific"
    if "resume" in name:
        return "Resume Guidance"
    if "system" in name or "design" in name:
        return "System Design"
    return "General"


# ──────────────────────────────────────────────────────────────────────────
#  RAG Engine class
# ──────────────────────────────────────────────────────────────────────────

class RAGEngine:
    """
    Lightweight FAISS-backed RAG engine.
    - Loads documents from a local knowledge-base directory.
    - Embeds them with a SentenceTransformer model (all-MiniLM-L6-v2).
    - Persists the index to disk so subsequent startups are instant.
    - Exposes retrieve(query, top_k) → list of relevant context strings.
    """

    INDEX_FILE = "faiss.index"
    META_FILE = "metadata.json"
    CHUNKS_FILE = "chunks.json"

    def __init__(
        self,
        kb_dir: str = "knowledge_base",
        vector_db_path: str = "vector_db",
        embedding_model: str = "all-MiniLM-L6-v2",
        top_k: int = 5,
    ):
        self.kb_dir = kb_dir
        self.vector_db_path = Path(vector_db_path)
        self.embedding_model_name = embedding_model
        self.top_k = top_k

        self._model = None
        self._index = None
        self._chunks: List[str] = []
        self._metadatas: List[dict] = []
        self._ready = False

    # ── Public API ─────────────────────────────────────────────────────────

    def initialize(self) -> bool:
        """Build or load the vector index. Returns True on success."""
        if not _DEPS_AVAILABLE:
            logger.warning("RAG dependencies not available — using keyword fallback")
            self._load_raw_chunks_only()
            return False

        try:
            self._model = SentenceTransformer(self.embedding_model_name)
            if self._index_exists():
                self._load_index()
            else:
                self._build_index()
            self._ready = True
            logger.info(f"RAG engine ready — {len(self._chunks)} chunks indexed")
            return True
        except Exception as exc:
            logger.error(f"RAG initialization failed: {exc}")
            self._load_raw_chunks_only()
            return False

    def retrieve(self, query: str, top_k: int | None = None) -> str:
        """
        Return the top-k most relevant knowledge-base passages as a
        single formatted string to be injected into the Granite prompt.
        """
        k = top_k or self.top_k

        if self._ready and self._index is not None:
            return self._faiss_retrieve(query, k)
        elif self._chunks:
            return self._keyword_retrieve(query, k)
        return ""

    def add_document(self, text: str, source: str = "user_upload") -> None:
        """Add a new document (e.g. parsed resume) to the live index."""
        new_chunks = _chunk_text(text, chunk_size=400, overlap=60)
        if not new_chunks:
            return

        new_meta = [{"source": source, "chunk_index": i, "category": "User Document"}
                    for i in range(len(new_chunks))]
        self._chunks.extend(new_chunks)
        self._metadatas.extend(new_meta)

        if self._ready and self._model is not None:
            embeddings = self._model.encode(new_chunks, show_progress_bar=False)
            embeddings = np.array(embeddings, dtype=np.float32)
            faiss.normalize_L2(embeddings)
            self._index.add(embeddings)
            logger.info(f"Added {len(new_chunks)} chunks from {source} to live index")

    # ── Internal helpers ───────────────────────────────────────────────────

    def _index_exists(self) -> bool:
        return (
            (self.vector_db_path / self.INDEX_FILE).exists()
            and (self.vector_db_path / self.CHUNKS_FILE).exists()
        )

    def _build_index(self) -> None:
        logger.info("Building FAISS index from knowledge base …")
        self._chunks, self._metadatas = _load_knowledge_base(self.kb_dir)

        if not self._chunks:
            logger.warning("No chunks to index!")
            return

        embeddings = self._model.encode(self._chunks, show_progress_bar=True, batch_size=32)
        embeddings = np.array(embeddings, dtype=np.float32)
        faiss.normalize_L2(embeddings)

        dim = embeddings.shape[1]
        self._index = faiss.IndexFlatIP(dim)  # inner-product on L2-normalised = cosine
        self._index.add(embeddings)

        self._persist_index(embeddings)
        logger.info(f"FAISS index built and saved — {len(self._chunks)} vectors, dim={dim}")

    def _load_index(self) -> None:
        logger.info("Loading existing FAISS index …")
        self._index = faiss.read_index(str(self.vector_db_path / self.INDEX_FILE))
        with open(self.vector_db_path / self.CHUNKS_FILE, "r", encoding="utf-8") as f:
            self._chunks = json.load(f)
        meta_path = self.vector_db_path / self.META_FILE
        if meta_path.exists():
            with open(meta_path, "r", encoding="utf-8") as f:
                self._metadatas = json.load(f)
        logger.info(f"Loaded FAISS index — {len(self._chunks)} chunks")

    def _persist_index(self, _embeddings=None) -> None:
        self.vector_db_path.mkdir(parents=True, exist_ok=True)
        faiss.write_index(self._index, str(self.vector_db_path / self.INDEX_FILE))
        with open(self.vector_db_path / self.CHUNKS_FILE, "w", encoding="utf-8") as f:
            json.dump(self._chunks, f, ensure_ascii=False)
        with open(self.vector_db_path / self.META_FILE, "w", encoding="utf-8") as f:
            json.dump(self._metadatas, f, ensure_ascii=False)

    def _faiss_retrieve(self, query: str, k: int) -> str:
        query_vec = self._model.encode([query])
        query_vec = np.array(query_vec, dtype=np.float32)
        faiss.normalize_L2(query_vec)

        scores, indices = self._index.search(query_vec, k)
        results = []
        for score, idx in zip(scores[0], indices[0]):
            if idx < 0 or idx >= len(self._chunks):
                continue
            if score < 0.25:  # minimum relevance threshold
                continue
            meta = self._metadatas[idx] if idx < len(self._metadatas) else {}
            category = meta.get("category", "Knowledge Base")
            results.append(f"[{category}]\n{self._chunks[idx]}")

        return "\n\n---\n\n".join(results) if results else ""

    def _keyword_retrieve(self, query: str, k: int) -> str:
        """Simple TF-IDF-like keyword fallback when FAISS is unavailable."""
        query_words = set(query.lower().split())
        scored: List[Tuple[int, float]] = []
        for i, chunk in enumerate(self._chunks):
            chunk_words = set(chunk.lower().split())
            overlap = len(query_words & chunk_words)
            if overlap > 0:
                scored.append((i, overlap / len(query_words | chunk_words)))

        scored.sort(key=lambda x: x[1], reverse=True)
        top = scored[:k]
        results = []
        for idx, _ in top:
            meta = self._metadatas[idx] if idx < len(self._metadatas) else {}
            category = meta.get("category", "Knowledge Base")
            results.append(f"[{category}]\n{self._chunks[idx]}")
        return "\n\n---\n\n".join(results) if results else ""

    def _load_raw_chunks_only(self) -> None:
        """Load text chunks without embeddings for keyword fallback."""
        self._chunks, self._metadatas = _load_knowledge_base(self.kb_dir)
        logger.info(f"Loaded {len(self._chunks)} chunks for keyword fallback")


# ── Singleton instance ─────────────────────────────────────────────────────
_engine: RAGEngine | None = None


def get_rag_engine(
    kb_dir: str = "knowledge_base",
    vector_db_path: str = "vector_db",
    embedding_model: str = "all-MiniLM-L6-v2",
    top_k: int = 5,
) -> RAGEngine:
    global _engine
    if _engine is None:
        _engine = RAGEngine(kb_dir, vector_db_path, embedding_model, top_k)
        _engine.initialize()
    return _engine
