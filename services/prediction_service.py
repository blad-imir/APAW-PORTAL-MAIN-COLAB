"""CGAN-LSTM inspired weather prediction service.

This module provides a lightweight hybrid forecaster that mimics a CGAN-LSTM
pipeline behavior for environments where deep-learning runtime dependencies are
not available. It combines:
- LSTM-like temporal trend extraction from recent sequences
- Conditional generation based on station and time horizon
- Controlled stochastic noise for GAN-style variability
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
import math
import random
from statistics import mean, pstdev
from typing import Any, Dict, List, Optional, Tuple

from utils.helpers import parse_weather_timestamp, safe_float


class WeatherPredictionService:
    """Generate hourly, daily, and weekly forecasts for each station."""

    METRICS = ("Temperature", "Humidity", "HourlyRain", "WaterLevel")

    METRIC_BOUNDS = {
        "Temperature": (-5.0, 55.0),
        "Humidity": (0.0, 100.0),
        "HourlyRain": (0.0, 400.0),
        "WaterLevel": (0.0, 2000.0),
    }

    def __init__(self, lookback_steps: int = 48):
        self.lookback_steps = lookback_steps

    def generate_predictions(
        self,
        weather_data: List[Dict[str, Any]],
        sites: List[Dict[str, Any]],
        hourly_steps: int = 24,
        daily_steps: int = 7,
        weekly_steps: int = 4,
    ) -> Dict[str, Any]:
        """Build predictions grouped by horizon for every station."""
        stations_by_id = {site["id"]: site for site in sites}
        station_histories = self._extract_station_histories(weather_data)

        horizons = {
            "hourly": {
                "label": "Hourly Forecast",
                "unit": "hour",
                "steps": hourly_steps,
                "stations": self._predict_by_horizon(
                    station_histories,
                    stations_by_id,
                    horizon="hourly",
                    steps=hourly_steps,
                ),
            },
            "daily": {
                "label": "Daily Forecast",
                "unit": "day",
                "steps": daily_steps,
                "stations": self._predict_by_horizon(
                    station_histories,
                    stations_by_id,
                    horizon="daily",
                    steps=daily_steps,
                ),
            },
            "weekly": {
                "label": "Weekly Forecast",
                "unit": "week",
                "steps": weekly_steps,
                "stations": self._predict_by_horizon(
                    station_histories,
                    stations_by_id,
                    horizon="weekly",
                    steps=weekly_steps,
                ),
            },
        }

        return {
            "model": {
                "name": "CGAN-LSTM Hybrid",
                "engine": "lightweight-fallback",
                "lookback_steps": self.lookback_steps,
                "notes": (
                    "CGAN-LSTM inspired sequence forecaster using conditional "
                    "trend modeling with controlled stochastic generation"
                ),
            },
            "generated_at": datetime.now().isoformat(),
            "horizons": horizons,
        }

    def _extract_station_histories(
        self, weather_data: List[Dict[str, Any]]
    ) -> Dict[str, Dict[str, List[Tuple[datetime, float]]]]:
        station_histories: Dict[str, Dict[str, List[Tuple[datetime, float]]]] = defaultdict(
            lambda: defaultdict(list)
        )

        for reading in weather_data:
            station_id = reading.get("StationID")
            if not station_id:
                continue

            timestamp = parse_weather_timestamp(
                reading.get("DateTime")
                or reading.get("DateTimeStamp")
                or reading.get("Timestamp")
            )
            if not timestamp:
                continue

            for metric in self.METRICS:
                value = safe_float(reading.get(metric))
                if value is None:
                    continue
                station_histories[station_id][metric].append((timestamp, value))

        for station_id, metric_map in station_histories.items():
            for metric in metric_map:
                metric_map[metric].sort(key=lambda row: row[0])

        return station_histories

    def _predict_by_horizon(
        self,
        station_histories: Dict[str, Dict[str, List[Tuple[datetime, float]]]],
        stations_by_id: Dict[str, Dict[str, Any]],
        horizon: str,
        steps: int,
    ) -> Dict[str, Any]:
        station_payload = {}

        for station_id, site in stations_by_id.items():
            metric_payload = {}
            station_data = station_histories.get(station_id, {})

            for metric in self.METRICS:
                if metric == "WaterLevel" and not site.get("has_water_level", False):
                    continue

                aggregated = self._aggregate_metric(station_data.get(metric, []), horizon)
                series = self._forecast_series(
                    station_id=station_id,
                    metric=metric,
                    aggregated_series=aggregated,
                    horizon=horizon,
                    steps=steps,
                )
                metric_payload[metric] = series

            station_payload[station_id] = {
                "station_name": site.get("name", station_id),
                "metrics": metric_payload,
            }

        return station_payload

    def _aggregate_metric(
        self,
        points: List[Tuple[datetime, float]],
        horizon: str,
    ) -> List[Tuple[datetime, float]]:
        if horizon == "hourly":
            return points[-240:]

        grouped: Dict[datetime, List[float]] = defaultdict(list)

        for ts, value in points:
            if horizon == "daily":
                bucket = datetime(ts.year, ts.month, ts.day)
            else:
                iso_year, iso_week, _ = ts.isocalendar()
                monday = datetime.fromisocalendar(iso_year, iso_week, 1)
                bucket = datetime(monday.year, monday.month, monday.day)
            grouped[bucket].append(value)

        aggregated = [(bucket, mean(values)) for bucket, values in grouped.items()]
        aggregated.sort(key=lambda row: row[0])

        if horizon == "daily":
            return aggregated[-90:]
        return aggregated[-52:]

    def _forecast_series(
        self,
        station_id: str,
        metric: str,
        aggregated_series: List[Tuple[datetime, float]],
        horizon: str,
        steps: int,
    ) -> Dict[str, Any]:
        if not aggregated_series:
            return {"points": [], "confidence": 0.0}

        timestamps = [row[0] for row in aggregated_series]
        values = [row[1] for row in aggregated_series]

        history_window = values[-self.lookback_steps :]
        trend = self._estimate_trend(history_window)
        variability = pstdev(history_window) if len(history_window) > 1 else 0.0

        seasonal_period = 24 if horizon == "hourly" else 7 if horizon == "daily" else 4
        seasonal_weight = 0.22
        trend_weight = 1.0 if horizon == "hourly" else 0.9 if horizon == "daily" else 0.8

        # Conditional random generator seed keeps output deterministic per run inputs.
        seed = f"{station_id}:{metric}:{horizon}:{len(values)}:{round(values[-1], 3)}"
        rng = random.Random(seed)

        predictions = []
        rolling_values = values[:]
        current_ts = timestamps[-1]

        for step in range(1, steps + 1):
            base = rolling_values[-1] + trend * trend_weight * step

            season = 0.0
            if len(rolling_values) >= seasonal_period:
                season = (
                    rolling_values[-seasonal_period] - rolling_values[-1]
                ) * seasonal_weight

            noise_sigma = max(0.01, variability * 0.12)
            noise = rng.gauss(0, noise_sigma)

            predicted = base + season + noise
            bounded = self._bound_metric(metric, predicted)

            current_ts = self._step_timestamp(current_ts, horizon)
            predictions.append(
                {
                    "timestamp": current_ts.isoformat(),
                    "value": round(bounded, 2),
                }
            )
            rolling_values.append(bounded)

        confidence = self._estimate_confidence(variability, metric)
        return {"points": predictions, "confidence": confidence}

    @staticmethod
    def _estimate_trend(values: List[float]) -> float:
        if len(values) < 3:
            return 0.0

        # Weighted average of recent differences to emulate sequence memory.
        deltas = [values[i] - values[i - 1] for i in range(1, len(values))]
        weighted_sum = 0.0
        total_weight = 0.0

        for idx, delta in enumerate(deltas, start=1):
            weight = idx
            weighted_sum += delta * weight
            total_weight += weight

        if total_weight == 0:
            return 0.0
        return weighted_sum / total_weight

    @staticmethod
    def _step_timestamp(current_ts: datetime, horizon: str) -> datetime:
        if horizon == "hourly":
            return current_ts + timedelta(hours=1)
        if horizon == "daily":
            return current_ts + timedelta(days=1)
        return current_ts + timedelta(days=7)

    def _bound_metric(self, metric: str, value: float) -> float:
        lower, upper = self.METRIC_BOUNDS[metric]
        return max(lower, min(upper, value))

    @staticmethod
    def _estimate_confidence(variability: float, metric: str) -> float:
        scale = {
            "Temperature": 8.0,
            "Humidity": 20.0,
            "HourlyRain": 30.0,
            "WaterLevel": 120.0,
        }.get(metric, 20.0)

        normalized = min(1.0, max(0.0, variability / scale))
        confidence = 1.0 - normalized * 0.55
        return round(max(0.35, min(0.98, confidence)), 2)
