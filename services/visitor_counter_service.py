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
    """Track visits and live active users per IP with persistence."""

    ACTIVE_WINDOW_MINUTES = 3

    def __init__(self, storage_path: str):
        self.storage_path = Path(storage_path)
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()
        self._data: Dict[str, Any] = {
            "total_hits": 0,
            "ips": {},
            "active_sessions": {},
            "daily_stats": {},
            "daily_visits": {},
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
                self._data["active_sessions"] = (
                    loaded.get("active_sessions", {})
                    if isinstance(loaded.get("active_sessions", {}), dict)
                    else {}
                )
                self._data["daily_stats"] = (
                    loaded.get("daily_stats", {})
                    if isinstance(loaded.get("daily_stats", {}), dict)
                    else {}
                )
                self._data["daily_visits"] = (
                    loaded.get("daily_visits", {})
                    if isinstance(loaded.get("daily_visits", {}), dict)
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
            self._update_daily_visits_locked(now, normalized)

            current_users = self._get_current_users_locked(now)
            self._update_daily_stats_locked(now, current_users)

            self._save_locked()
            return entry["visits"]

    def register_enter(self, ip: str | None, session_id: str | None) -> Dict[str, Any]:
        """Mark a browser session as active."""
        normalized = self.normalize_ip(ip)
        session_key = (session_id or "").strip()
        if not session_key:
            session_key = f"{normalized}:{datetime.now().timestamp()}"

        now = datetime.now()

        with self._lock:
            self._purge_expired_locked(now)
            entry = self._data["ips"].get(normalized, {"visits": 0, "last_seen": None})
            entry["last_seen"] = now.isoformat()
            self._data["ips"][normalized] = entry

            self._data.setdefault("active_sessions", {})[session_key] = {
                "ip": normalized,
                "last_seen": now.isoformat(),
                "started_at": now.isoformat(),
            }

            current_users = self._get_current_users_locked(now)
            self._update_daily_stats_locked(now, current_users)
            self._save_locked()
            return self._build_user_log_summary_locked(normalized)

    def register_heartbeat(self, ip: str | None, session_id: str | None) -> Dict[str, Any]:
        """Refresh a live browser session without changing the visible count."""
        normalized = self.normalize_ip(ip)
        session_key = (session_id or "").strip()
        if not session_key:
            return self.get_user_log_summary(normalized)

        now = datetime.now()

        with self._lock:
            self._purge_expired_locked(now)
            active_sessions = self._data.setdefault("active_sessions", {})
            session = active_sessions.get(session_key)
            if session and session.get("ip") == normalized:
                session["last_seen"] = now.isoformat()
                active_sessions[session_key] = session
            current_users = self._get_current_users_locked(now)
            self._update_daily_stats_locked(now, current_users)
            self._save_locked()
            return self._build_user_log_summary_locked(normalized)

    def register_leave(self, ip: str | None, session_id: str | None) -> Dict[str, Any]:
        """Remove a browser session from active users."""
        normalized = self.normalize_ip(ip)
        session_key = (session_id or "").strip()
        now = datetime.now()

        with self._lock:
            active_sessions = self._data.setdefault("active_sessions", {})
            if session_key and session_key in active_sessions:
                active_sessions.pop(session_key, None)
            else:
                # Fallback: remove every session from this IP when no session ID is available.
                to_remove = [sid for sid, session in active_sessions.items() if session.get("ip") == normalized]
                for sid in to_remove:
                    active_sessions.pop(sid, None)

            self._purge_expired_locked(now)
            current_users = self._get_current_users_locked(now)
            self._update_daily_stats_locked(now, current_users)
            self._save_locked()
            return self._build_user_log_summary_locked(normalized)

    def _get_current_users_locked(self, now: datetime | None = None) -> int:
        current_time = now or datetime.now()
        active_cutoff = current_time - timedelta(minutes=self.ACTIVE_WINDOW_MINUTES)

        active_ips = set()
        for session in self._data.get("active_sessions", {}).values():
            if not isinstance(session, dict):
                continue
            ip = session.get("ip")
            last_seen_raw = session.get("last_seen")
            if not ip or not last_seen_raw or not isinstance(last_seen_raw, str):
                continue

            try:
                last_seen = datetime.fromisoformat(last_seen_raw)
            except ValueError:
                continue

            if last_seen >= active_cutoff:
                active_ips.add(ip)

        if not active_ips:
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
                    active_ips.add("__legacy__")

        return len(active_ips)

    def _purge_expired_locked(self, now: datetime | None = None) -> None:
        current_time = now or datetime.now()
        active_cutoff = current_time - timedelta(minutes=self.ACTIVE_WINDOW_MINUTES)
        active_sessions = self._data.setdefault("active_sessions", {})
        expired_sessions = []

        for session_id, session in active_sessions.items():
            if not isinstance(session, dict):
                expired_sessions.append(session_id)
                continue
            last_seen_raw = session.get("last_seen")
            if not last_seen_raw or not isinstance(last_seen_raw, str):
                expired_sessions.append(session_id)
                continue

            try:
                last_seen = datetime.fromisoformat(last_seen_raw)
            except ValueError:
                expired_sessions.append(session_id)
                continue

            if last_seen < active_cutoff:
                expired_sessions.append(session_id)

        for session_id in expired_sessions:
            active_sessions.pop(session_id, None)

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

    def _update_daily_visits_locked(self, now: datetime, normalized_ip: str) -> None:
        day_key = now.date().isoformat()
        daily_visits = self._data.setdefault("daily_visits", {})
        day_entry = daily_visits.get(day_key, {}) if isinstance(daily_visits.get(day_key), dict) else {}

        ip_hits = day_entry.get("ip_hits", {})
        if not isinstance(ip_hits, dict):
            ip_hits = {}

        ip_hits[normalized_ip] = int(ip_hits.get(normalized_ip, 0)) + 1

        total_visits = int(day_entry.get("total_visits", 0)) + 1
        day_entry["date"] = day_key
        day_entry["total_visits"] = total_visits
        day_entry["unique_visitors"] = len(ip_hits)
        day_entry["ip_hits"] = ip_hits
        daily_visits[day_key] = day_entry

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
            self._purge_expired_locked()
            current_entry = self._data["ips"].get(normalized, {})
            return {
                "total_unique_visitors": len(self._data.get("ips", {})),
                "total_hits": int(self._data.get("total_hits", 0)),
                "current_ip_visits": int(current_entry.get("visits", 0)),
            }

    def get_user_log_summary(self, ip: str | None) -> Dict[str, Any]:
        normalized = self.normalize_ip(ip)

        with self._lock:
            self._purge_expired_locked()
            return self._build_user_log_summary_locked(normalized)

    def get_active_summary(self, ip: str | None = None) -> Dict[str, Any]:
        normalized = self.normalize_ip(ip)

        with self._lock:
            self._purge_expired_locked()
            return self._build_active_summary_locked(normalized)

    def _build_active_summary_locked(self, normalized_ip: str) -> Dict[str, Any]:
        today_key = datetime.now().date().isoformat()
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
            "current_ip": self.mask_ip(normalized_ip),
        }

    def _build_user_log_summary_locked(self, normalized_ip: str) -> Dict[str, Any]:
        active_summary = self._build_active_summary_locked(normalized_ip)
        current_entry = self._data.get("ips", {}).get(normalized_ip, {})
        active_summary["current_ip_visits"] = int(current_entry.get("visits", 0))
        return active_summary

    def get_daily_visit_logs(self, start_date: str | None = None, end_date: str | None = None) -> Dict[str, Any]:
        with self._lock:
            daily_visits = self._data.get("daily_visits", {})
            if not isinstance(daily_visits, dict):
                return {"logs": []}

            ordered_dates = sorted(daily_visits.keys())
            logs = []
            for date_key in ordered_dates:
                if start_date and date_key < start_date:
                    continue
                if end_date and date_key > end_date:
                    continue

                item = daily_visits.get(date_key, {})
                if not isinstance(item, dict):
                    continue

                logs.append(
                    {
                        "date": date_key,
                        "total_visits": int(item.get("total_visits", 0)),
                        "unique_visitors": int(item.get("unique_visitors", 0)),
                    }
                )

            return {"logs": logs}
