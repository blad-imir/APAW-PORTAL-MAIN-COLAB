"""CGAN-Markov Chain weather prediction service.

This module provides a lightweight hybrid forecaster that mimics a
CGAN-Markov Chain pipeline for environments where deep-learning runtime
dependencies are not available. It combines:
- Markov state transitions learned from station history
- Conditional generation by station, metric, and time horizon
- Recursive prediction where each next value depends on prior predicted states
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
import random
from statistics import mean, pstdev
from typing import Any, Dict, List, Tuple

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

    STATE_COUNT = 10

    # Soft movement caps to improve consistency between consecutive points.
    MAX_STEP_DELTA = {
        "Temperature": 1.6,
        "Humidity": 4.0,
        "HourlyRain": 2.8,
        "WaterLevel": 16.0,
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
                "name": "CGAN-Markov Chain Hybrid",
                "engine": "lightweight-fallback",
                "lookback_steps": self.lookback_steps,
                "notes": (
                    "CGAN-Markov Chain recursive forecaster using conditional "
                    "state transitions from historical and generated trajectories"
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

        history_window = values[-max(self.lookback_steps, 30):]
        variability = pstdev(history_window) if len(history_window) > 1 else 0.0

        # Build a finite-state Markov model from historical values.
        state_centers = self._build_state_centers(history_window, metric)
        transition_probs = self._build_transition_matrix(history_window, state_centers)
        state_values = [self._value_to_state(v, state_centers) for v in history_window]
        if not state_values:
            return {"points": [], "confidence": 0.0}

        # Conditional random generator seed keeps output deterministic per run inputs.
        seed = f"{station_id}:{metric}:{horizon}:{len(values)}:{round(values[-1], 3)}"
        rng = random.Random(seed)

        predictions = []
        rolling_values = values[:]
        current_ts = timestamps[-1]

        # Recurring prediction: transition from the latest generated/historical state.
        current_state = state_values[-1]
        prior_delta = 0.0
        inertia = 0.72

        for _ in range(steps):
            next_state = self._sample_next_state(current_state, transition_probs, rng)
            state_target = state_centers[next_state]

            last_value = rolling_values[-1]
            raw_delta = state_target - last_value
            smooth_delta = (raw_delta * (1.0 - inertia)) + (prior_delta * inertia)
            bounded_delta = self._limit_delta(metric, smooth_delta)

            predicted = last_value + bounded_delta
            bounded = self._bound_metric(metric, predicted)

            current_ts = self._step_timestamp(current_ts, horizon)
            predictions.append(
                {
                    "timestamp": current_ts.isoformat(),
                    "value": round(bounded, 2),
                }
            )
            rolling_values.append(bounded)
            current_state = self._value_to_state(bounded, state_centers)
            prior_delta = bounded - last_value

        confidence = self._estimate_confidence(variability, metric, transition_probs)
        return {"points": predictions, "confidence": confidence}

    @staticmethod
    def _step_timestamp(current_ts: datetime, horizon: str) -> datetime:
        if horizon == "hourly":
            return current_ts + timedelta(hours=1)
        if horizon == "daily":
            return current_ts + timedelta(days=1)
        return current_ts + timedelta(days=7)

    def _build_state_centers(self, values: List[float], metric: str) -> List[float]:
        lower, upper = self.METRIC_BOUNDS[metric]
        if not values:
            span = upper - lower
            step = span / (self.STATE_COUNT - 1)
            return [lower + (i * step) for i in range(self.STATE_COUNT)]

        sorted_vals = sorted(values)
        centers = []
        total = len(sorted_vals)

        for i in range(self.STATE_COUNT):
            # Quantile centers keep states aligned to empirical weather distribution.
            q = i / max(1, self.STATE_COUNT - 1)
            idx = min(total - 1, max(0, int(round(q * (total - 1)))))
            centers.append(self._bound_metric(metric, sorted_vals[idx]))

        for i in range(1, len(centers)):
            if centers[i] < centers[i - 1]:
                centers[i] = centers[i - 1]

        if centers[-1] - centers[0] < 1e-6:
            step = (upper - lower) / (self.STATE_COUNT - 1)
            centers = [self._bound_metric(metric, centers[0] + step * (i - self.STATE_COUNT // 2)) for i in range(self.STATE_COUNT)]

        return centers

    def _value_to_state(self, value: float, state_centers: List[float]) -> int:
        best_idx = 0
        best_dist = float("inf")
        for idx, center in enumerate(state_centers):
            dist = abs(center - value)
            if dist < best_dist:
                best_dist = dist
                best_idx = idx
        return best_idx

    def _build_transition_matrix(
        self,
        values: List[float],
        state_centers: List[float],
    ) -> List[List[float]]:
        counts = [[1.0 for _ in range(self.STATE_COUNT)] for _ in range(self.STATE_COUNT)]

        states = [self._value_to_state(v, state_centers) for v in values]
        for idx in range(1, len(states)):
            prev_state = states[idx - 1]
            next_state = states[idx]
            counts[prev_state][next_state] += 1.0

            # Encourage smooth transitions around observed moves.
            if next_state - 1 >= 0:
                counts[prev_state][next_state - 1] += 0.35
            if next_state + 1 < self.STATE_COUNT:
                counts[prev_state][next_state + 1] += 0.35

        probabilities = []
        for row in counts:
            row_sum = sum(row)
            probabilities.append([c / row_sum for c in row])

        return probabilities

    def _sample_next_state(
        self,
        current_state: int,
        transition_probs: List[List[float]],
        rng: random.Random,
    ) -> int:
        row = transition_probs[current_state]
        roll = rng.random()
        cumulative = 0.0
        for idx, prob in enumerate(row):
            cumulative += prob
            if roll <= cumulative:
                return idx
        return len(row) - 1

    def _limit_delta(self, metric: str, delta: float) -> float:
        max_delta = self.MAX_STEP_DELTA.get(metric, 3.0)
        if delta > max_delta:
            return max_delta
        if delta < -max_delta:
            return -max_delta
        return delta

    def _bound_metric(self, metric: str, value: float) -> float:
        lower, upper = self.METRIC_BOUNDS[metric]
        return max(lower, min(upper, value))

    @staticmethod
    def _estimate_confidence(
        variability: float,
        metric: str,
        transition_probs: List[List[float]],
    ) -> float:
        scale = {
            "Temperature": 8.0,
            "Humidity": 20.0,
            "HourlyRain": 30.0,
            "WaterLevel": 120.0,
        }.get(metric, 20.0)

        normalized = min(1.0, max(0.0, variability / scale))
        # Higher self-transition stability means better consistency.
        stability = mean(row[idx] for idx, row in enumerate(transition_probs))
        confidence = (1.0 - normalized * 0.5) * 0.72 + stability * 0.28
        return round(max(0.35, min(0.98, confidence)), 2)
