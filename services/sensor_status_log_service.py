"""Persistent daily sensor status archive service."""

from __future__ import annotations

import json
import logging
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from threading import Lock
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


class SensorStatusLogService:
    """Store daily sensor working/non-working summaries in a persistent archive."""

    MAX_ARCHIVE_DAYS = 365

    def __init__(self, storage_path: str):
        self.storage_path = Path(storage_path)
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()
        self._data: Dict[str, Any] = {
            "daily_logs": {},
            "updated_at": None,
        }
        self._load()

    def _load(self) -> None:
        if not self.storage_path.exists():
            return

        try:
            with self.storage_path.open("r", encoding="utf-8") as f:
                loaded = json.load(f)

            if isinstance(loaded, dict):
                self._data["daily_logs"] = (
                    loaded.get("daily_logs", {})
                    if isinstance(loaded.get("daily_logs", {}), dict)
                    else {}
                )
                self._data["updated_at"] = loaded.get("updated_at")
        except Exception as exc:
            logger.warning("Failed to load sensor status archive: %s", exc)

    def _save_locked(self) -> None:
        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                dir=str(self.storage_path.parent),
                prefix="sensor_logs_",
                suffix=".tmp",
                delete=False,
                encoding="utf-8",
            ) as tmp:
                json.dump(self._data, tmp, separators=(",", ":"))
                temp_path = tmp.name

            Path(temp_path).replace(self.storage_path)
        except Exception as exc:
            logger.warning("Failed to persist sensor status archive: %s", exc)
            if temp_path:
                try:
                    Path(temp_path).unlink(missing_ok=True)
                except Exception:
                    pass

    @staticmethod
    def _sanitize_daily_row(row: Dict[str, Any], day: datetime.date | None = None) -> Dict[str, Any]:
        date_value = row.get("date") or (day.isoformat() if day else datetime.now().date().isoformat())
        working_sensors = row.get("working_sensors") if isinstance(row.get("working_sensors"), list) else []
        non_working_sensors = row.get("non_working_sensors") if isinstance(row.get("non_working_sensors"), list) else []

        return {
            "date": date_value,
            "day_label": row.get("day_label") or datetime.fromisoformat(date_value).strftime("%b %d, %Y"),
            "working_count": int(row.get("working_count", len(working_sensors))),
            "non_working_count": int(row.get("non_working_count", len(non_working_sensors))),
            "working_sensors": working_sensors,
            "non_working_sensors": non_working_sensors,
        }

    def _prune_locked(self, today) -> None:
        cutoff = today - timedelta(days=self.MAX_ARCHIVE_DAYS)
        keys_to_remove = []

        for date_key in self._data.get("daily_logs", {}).keys():
            try:
                day = datetime.fromisoformat(date_key).date()
            except ValueError:
                keys_to_remove.append(date_key)
                continue

            if day < cutoff:
                keys_to_remove.append(date_key)

        for date_key in keys_to_remove:
            self._data["daily_logs"].pop(date_key, None)

    def get_sensor_logs(self, live_sensor_logs: Dict[str, Any], days: int = 14) -> Dict[str, Any]:
        """Merge live sensor metrics with persistent daily archive and return a stable view."""
        clamped_days = max(1, min(int(days or 14), 30))
        today = datetime.now().date()
        live_daily_rows: List[Dict[str, Any]] = live_sensor_logs.get("daily_logs", []) or []
        live_by_date = {
            row.get("date"): self._sanitize_daily_row(row)
            for row in live_daily_rows
            if isinstance(row, dict) and row.get("date")
        }

        with self._lock:
            archived = self._data.setdefault("daily_logs", {})

            # Preserve historical records; only refresh today and backfill missing dates.
            today_key = today.isoformat()
            for date_key, row in live_by_date.items():
                if date_key not in archived or date_key == today_key:
                    archived[date_key] = row

            self._prune_locked(today)
            self._data["updated_at"] = datetime.now().isoformat()
            self._save_locked()

            window_dates = [
                today - timedelta(days=offset)
                for offset in range(clamped_days - 1, -1, -1)
            ]

            station_names = [
                station.get("station_name")
                for station in live_sensor_logs.get("station_statuses", [])
                if isinstance(station, dict) and station.get("station_name")
            ]
            total_sensors = int(live_sensor_logs.get("total_sensors", len(station_names)))

            merged_daily_logs: List[Dict[str, Any]] = []
            for day in window_dates:
                date_key = day.isoformat()
                row = archived.get(date_key)
                if not isinstance(row, dict):
                    row = live_by_date.get(date_key)

                if isinstance(row, dict):
                    merged_daily_logs.append(self._sanitize_daily_row(row, day))
                else:
                    merged_daily_logs.append({
                        "date": date_key,
                        "day_label": day.strftime("%b %d, %Y"),
                        "working_count": 0,
                        "non_working_count": total_sensors,
                        "working_sensors": [],
                        "non_working_sensors": station_names,
                    })

        return {
            "days": clamped_days,
            "total_sensors": int(live_sensor_logs.get("total_sensors", 0)),
            "current_working_count": int(live_sensor_logs.get("current_working_count", 0)),
            "current_non_working_count": int(live_sensor_logs.get("current_non_working_count", 0)),
            "station_statuses": live_sensor_logs.get("station_statuses", []),
            "daily_logs": merged_daily_logs,
        }
