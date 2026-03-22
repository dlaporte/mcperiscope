"""File-backed AsyncKeyValue store for persisting OAuth tokens.

Implements the key_value AsyncKeyValue protocol so it can be passed directly
to FastMCP's OAuth(token_storage=...) parameter.  Data is stored as JSON
files under a configurable directory, organised by collection and key.

Directory layout:
    <base_dir>/<collection>/<sha256(key)[:16]>.json
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, SupportsFloat

import anyio
from anyio import Path as AsyncPath


def _safe_filename(key: str) -> str:
    """Derive a filesystem-safe filename from an arbitrary key string."""
    return hashlib.sha256(key.encode()).hexdigest()[:16] + ".json"


class FileKeyValueStore:
    """Async key-value store backed by the local filesystem.

    Satisfies the ``AsyncKeyValue`` protocol expected by FastMCP's
    ``OAuth(token_storage=...)`` parameter.  Values are ``dict[str, Any]``
    and are serialised as JSON.

    TTL is accepted but not enforced — tokens are persisted indefinitely and
    the OAuth layer handles refresh / expiry logic itself.
    """

    DEFAULT_COLLECTION = "__default__"

    def __init__(self, base_dir: Path | None = None) -> None:
        self._base_dir = base_dir or (Path.home() / ".mcp-optimizer" / "tokens")

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _collection_dir(self, collection: str | None) -> Path:
        return self._base_dir / (collection or self.DEFAULT_COLLECTION)

    def _key_path(self, key: str, collection: str | None) -> Path:
        return self._collection_dir(collection) / _safe_filename(key)

    async def _read(self, path: Path) -> dict[str, Any] | None:
        apath = AsyncPath(path)
        try:
            data = await apath.read_text(encoding="utf-8")
            return json.loads(data)  # type: ignore[no-any-return]
        except (FileNotFoundError, json.JSONDecodeError):
            return None

    async def _write(self, path: Path, value: Mapping[str, Any]) -> None:
        apath = AsyncPath(path)
        await AsyncPath(path.parent).mkdir(parents=True, exist_ok=True)
        # Atomic-ish write: write to tmp then rename
        tmp = path.with_suffix(".tmp")
        await AsyncPath(tmp).write_text(
            json.dumps(dict(value), indent=2), encoding="utf-8"
        )
        await AsyncPath(tmp).rename(apath)

    # ------------------------------------------------------------------
    # Core protocol methods
    # ------------------------------------------------------------------

    async def get(
        self,
        key: str,
        *,
        collection: str | None = None,
    ) -> dict[str, Any] | None:
        """Retrieve a value by key."""
        return await self._read(self._key_path(key, collection))

    async def put(
        self,
        key: str,
        value: Mapping[str, Any],
        *,
        collection: str | None = None,
        ttl: SupportsFloat | None = None,
    ) -> None:
        """Store a value.  *ttl* is accepted but not enforced."""
        await self._write(self._key_path(key, collection), value)

    async def delete(self, key: str, *, collection: str | None = None) -> bool:
        """Delete a key.  Returns True if it existed."""
        path = AsyncPath(self._key_path(key, collection))
        try:
            await path.unlink()
            return True
        except FileNotFoundError:
            return False

    async def ttl(
        self, key: str, *, collection: str | None = None
    ) -> tuple[dict[str, Any] | None, float | None]:
        """Return (value, ttl).  TTL is always None (no expiry tracking)."""
        value = await self.get(key, collection=collection)
        return (value, None)

    # ------------------------------------------------------------------
    # Bulk operations
    # ------------------------------------------------------------------

    async def get_many(
        self, keys: Sequence[str], *, collection: str | None = None
    ) -> list[dict[str, Any] | None]:
        return [await self.get(k, collection=collection) for k in keys]

    async def ttl_many(
        self, keys: Sequence[str], *, collection: str | None = None
    ) -> list[tuple[dict[str, Any] | None, float | None]]:
        return [await self.ttl(k, collection=collection) for k in keys]

    async def put_many(
        self,
        keys: Sequence[str],
        values: Sequence[Mapping[str, Any]],
        *,
        collection: str | None = None,
        ttl: SupportsFloat | None = None,
    ) -> None:
        for k, v in zip(keys, values):
            await self.put(k, v, collection=collection, ttl=ttl)

    async def delete_many(
        self, keys: Sequence[str], *, collection: str | None = None
    ) -> int:
        count = 0
        for k in keys:
            if await self.delete(k, collection=collection):
                count += 1
        return count
