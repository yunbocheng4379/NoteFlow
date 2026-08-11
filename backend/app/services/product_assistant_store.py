"""Product help document index for the workspace AI assistant."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any

from app.services.vector_store import LocalHashEmbeddingFunction
from app.utils.logger import get_logger

logger = get_logger(__name__)


def _chunk_product_markdown(markdown: str, source_title: str) -> list[dict[str, Any]]:
    """Split product Markdown into section-level searchable chunks."""
    sections = re.split(r"(?=^#{2,3}\s)", markdown or "", flags=re.MULTILINE)
    chunks: list[dict[str, Any]] = []
    for section in sections:
        section = section.strip()
        heading = re.match(r"^#{2,3}\s+(.+)", section)
        if not heading:
            continue
        body = section[heading.end():].strip()
        if len(body) < 8:
            continue
        chunks.append(
            {
                "text": section,
                "metadata": {
                    "title": source_title,
                    "section_title": heading.group(1).strip(),
                    "source_type": "product_doc",
                },
            }
        )
    return chunks


class ProductAssistantStore:
    """Persistent Chroma index for versioned NoteFlow product documents."""

    COLLECTION_NAME = "noteflow_product_assistant"

    def __init__(self, knowledge_dir: Path | None = None, vector_db_dir: str | None = None):
        self.knowledge_dir = knowledge_dir or Path(__file__).resolve().parents[1] / "assistant" / "knowledge"
        self.vector_db_dir = vector_db_dir
        self._embedding_function = LocalHashEmbeddingFunction()

    def _get_client(self):
        import chromadb
        from chromadb.config import Settings

        from app.services.vector_store import VECTOR_DB_DIR

        path = self.vector_db_dir or VECTOR_DB_DIR
        Path(path).mkdir(parents=True, exist_ok=True)
        return chromadb.PersistentClient(path=path, settings=Settings(anonymized_telemetry=False))

    def _read_documents(self) -> tuple[str, list[dict[str, Any]]]:
        files = sorted(self.knowledge_dir.glob("*.md"))
        digest = hashlib.sha256()
        chunks: list[dict[str, Any]] = []
        for path in files:
            content = path.read_text(encoding="utf-8")
            digest.update(path.name.encode("utf-8"))
            digest.update(content.encode("utf-8"))
            chunks.extend(_chunk_product_markdown(content, path.stem.replace("-", " ").title()))
        return digest.hexdigest(), chunks

    def ensure_index(self) -> None:
        fingerprint, chunks = self._read_documents()
        if not chunks:
            raise ValueError("产品帮助文档为空")

        client = self._get_client()
        try:
            collection = client.get_collection(
                self.COLLECTION_NAME,
                embedding_function=self._embedding_function,
            )
            if collection.metadata and collection.metadata.get("content_hash") == fingerprint:
                return
            client.delete_collection(self.COLLECTION_NAME)
        except Exception:
            pass

        collection = client.create_collection(
            name=self.COLLECTION_NAME,
            metadata={"hnsw:space": "cosine", "content_hash": fingerprint},
            embedding_function=self._embedding_function,
        )
        collection.add(
            documents=[item["text"] for item in chunks],
            metadatas=[item["metadata"] for item in chunks],
            ids=[f"product_doc_{index}" for index in range(len(chunks))],
        )
        logger.info("产品客服知识库索引完成: chunks=%s", len(chunks))

    def query(self, question: str, n_results: int = 5) -> list[dict[str, Any]]:
        try:
            client = self._get_client()
            collection = client.get_collection(
                self.COLLECTION_NAME,
                embedding_function=self._embedding_function,
            )
            results = collection.query(query_texts=[question], n_results=n_results)
        except Exception as exc:
            logger.warning("产品客服知识库查询失败: %s", exc)
            return []

        documents = results.get("documents", [[]])[0] or []
        metadatas = results.get("metadatas", [[]])[0] or []
        distances = results.get("distances", [[]])[0] or []
        return [
            {
                "text": text,
                "metadata": metadatas[index] if index < len(metadatas) else {},
                "distance": distances[index] if index < len(distances) else None,
            }
            for index, text in enumerate(documents)
        ]
