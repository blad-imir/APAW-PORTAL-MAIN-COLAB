"""IP-based visitor counter service with lightweight JSON persistence."""

from __future__ import annotations

import json
import logging
import tempfile
from datetime import datetime
from pathlib import Path
from threading import Lock
from typing import Dict, Any

logger = logging.getLogger(__name__)


class VisitorCounterService:
    """Track visits per IP and keep counts persisted on disk."""

    def __init__(self, storage_path: str):
        self.storage_path = Path(storage_path)
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()
        self._data: Dict[str, Any] = {
            "total_hits": 0,
            "ips": {},
        }
        self._load()

    def _load(self) -> None:
        if not self.storage_path.exists():
            return

        try:
            with self.storage_path.open("r", encoding="utf-8") as f:
                loaded = json.load(f)
            if isinstance(loaded, dict):
                self._data["total_hits"] = int(loaded.get("total_hits", 0))
                self._data["ips"] = loaded.get("ips", {}) if isinstance(loaded.get("ips", {}), dict) else {}
        except Exception as exc:
            logger.warning("Failed to load visitor counter data: %s", exc)

    def _save_locked(self) -> None:
        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                dir=str(self.storage_path.parent),
                prefix="visitors_",
                suffix=".tmp",
                delete=False,
                encoding="utf-8",
            ) as tmp:
                json.dump(self._data, tmp, separators=(",", ":"))
                temp_path = tmp.name

            Path(temp_path).replace(self.storage_path)
        except Exception as exc:
            logger.warning("Failed to persist visitor counter: %s", exc)
            if temp_path:
                try:
                    Path(temp_path).unlink(missing_ok=True)
                except Exception:
                    pass

    @staticmethod
    def normalize_ip(ip: str | None) -> str:
        if not ip:
            return "unknown"

        first = ip.split(",")[0].strip()
        if not first:
            return "unknown"
        return first

    def register_visit(self, ip: str | None) -> int:
        normalized = self.normalize_ip(ip)
        now = datetime.now().isoformat()

        with self._lock:
            entry = self._data["ips"].get(normalized, {"visits": 0, "last_seen": None})
            entry["visits"] = int(entry.get("visits", 0)) + 1
            entry["last_seen"] = now
            self._data["ips"][normalized] = entry
            self._data["total_hits"] = int(self._data.get("total_hits", 0)) + 1
            self._save_locked()
            return entry["visits"]

    def get_summary(self, ip: str | None) -> Dict[str, int]:
        normalized = self.normalize_ip(ip)
        with self._lock:
            current_entry = self._data["ips"].get(normalized, {})
            return {
                "total_unique_visitors": len(self._data.get("ips", {})),
                "total_hits": int(self._data.get("total_hits", 0)),
                "current_ip_visits": int(current_entry.get("visits", 0)),
            }
