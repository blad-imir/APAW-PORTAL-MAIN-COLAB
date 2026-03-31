"""IP-based visitor counter service with lightweight JSON persistence."""

from __future__ import annotations

import json
import logging
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from threading import Lock
from typing import Dict, Any

logger = logging.getLogger(__name__)


class VisitorCounterService:
    """Track visits per IP and keep counts persisted on disk."""

    ACTIVE_WINDOW_MINUTES = 5

    def __init__(self, storage_path: str):
        self.storage_path = Path(storage_path)
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()
        self._data: Dict[str, Any] = {
            "total_hits": 0,
            "ips": {},
            "daily_stats": {},
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
                self._data["daily_stats"] = (
                    loaded.get("daily_stats", {})
                    if isinstance(loaded.get("daily_stats", {}), dict)
                    else {}
                )
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
        now = datetime.now()

        with self._lock:
            entry = self._data["ips"].get(normalized, {"visits": 0, "last_seen": None})
            entry["visits"] = int(entry.get("visits", 0)) + 1
            entry["last_seen"] = now.isoformat()
            self._data["ips"][normalized] = entry
            self._data["total_hits"] = int(self._data.get("total_hits", 0)) + 1

            current_users = self._get_current_users_locked(now)
            self._update_daily_stats_locked(now, current_users)

            self._save_locked()
            return entry["visits"]

    def _get_current_users_locked(self, now: datetime | None = None) -> int:
        current_time = now or datetime.now()
        active_cutoff = current_time - timedelta(minutes=self.ACTIVE_WINDOW_MINUTES)

        active_users = 0
        for entry in self._data.get("ips", {}).values():
            if not isinstance(entry, dict):
                continue
            last_seen_raw = entry.get("last_seen")
            if not last_seen_raw or not isinstance(last_seen_raw, str):
                continue

            try:
                last_seen = datetime.fromisoformat(last_seen_raw)
            except ValueError:
                continue

            if last_seen >= active_cutoff:
                active_users += 1

        return active_users

    def _update_daily_stats_locked(self, now: datetime, current_users: int) -> None:
        day_key = now.date().isoformat()
        daily_stats = self._data.setdefault("daily_stats", {})
        day_stats = daily_stats.get(day_key, {}) if isinstance(daily_stats.get(day_key), dict) else {}

        samples_total = int(day_stats.get("samples_total_users", 0)) + current_users
        samples_count = int(day_stats.get("samples_count", 0)) + 1
        max_users = max(int(day_stats.get("max_users", 0)), current_users)

        day_stats["samples_total_users"] = samples_total
        day_stats["samples_count"] = samples_count
        day_stats["max_users"] = max_users
        daily_stats[day_key] = day_stats

    @staticmethod
    def mask_ip(ip: str | None) -> str:
        normalized = VisitorCounterService.normalize_ip(ip)
        if normalized == "unknown":
            return "unknown"

        if len(normalized) <= 4:
            return "*" * len(normalized)

        return f"{normalized[:2]}{'*' * (len(normalized) - 4)}{normalized[-2:]}"

    def get_summary(self, ip: str | None) -> Dict[str, int]:
        normalized = self.normalize_ip(ip)
        with self._lock:
            current_entry = self._data["ips"].get(normalized, {})
            return {
                "total_unique_visitors": len(self._data.get("ips", {})),
                "total_hits": int(self._data.get("total_hits", 0)),
                "current_ip_visits": int(current_entry.get("visits", 0)),
            }

    def get_user_log_summary(self, ip: str | None) -> Dict[str, Any]:
        normalized = self.normalize_ip(ip)
        today_key = datetime.now().date().isoformat()

        with self._lock:
            current_entry = self._data.get("ips", {}).get(normalized, {})
            current_users = self._get_current_users_locked()

            daily_stats = self._data.get("daily_stats", {})
            today_stats = daily_stats.get(today_key, {}) if isinstance(daily_stats, dict) else {}
            day_max_users = int(today_stats.get("max_users", current_users))

            samples_total = int(today_stats.get("samples_total_users", 0))
            samples_count = int(today_stats.get("samples_count", 0))
            average_users = round(samples_total / samples_count, 2) if samples_count > 0 else float(current_users)

            return {
                "current_users": current_users,
                "day_max_users": day_max_users,
                "day_average_users": average_users,
                "current_ip": self.mask_ip(normalized),
                "current_ip_visits": int(current_entry.get("visits", 0)),
            }
