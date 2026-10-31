"""
services/ml/simulate_history.py

Generates SYNTHETIC historical shipments for training.
The relationships below are defined by hand, so the models learn to recover
them. Report this as a pipeline demonstration, not evidence of real-world accuracy.

Run:  python services/ml/simulate_history.py
"""
from pathlib import Path
import numpy as np
import pandas as pd

rng = np.random.default_rng(42)
N = 3000

# Latent supplier reliability (not observed directly)
supplier_reliability = rng.uniform(0.60, 0.98, N)
# Observed proxy: the supplier's past on-time rate, with noise
supplier_past_ontime_rate = np.clip(supplier_reliability + rng.normal(0, 0.03, N), 0, 1)

units = rng.integers(20, 500, N)
warehouse_proc_h = rng.choice([2, 4, 6, 8], N)
n_events = rng.poisson(2, N)
weekday = rng.integers(0, 7, N)
hour_lead = rng.uniform(12, 120, N)            # hours between dispatch and promised ETA
order_count = rng.integers(1, 12, N)
penalty_per_hour = rng.choice([300, 600, 1200, 2000], N)

# Delay process: unreliable suppliers and weekend congestion cause more delay
base_delay = rng.gamma(shape=1.5, scale=3.0, size=N) * (1 - supplier_reliability) * 4
weekend_congestion = (weekday >= 5) * rng.uniform(0, 6, N)
delay_hours = np.clip(base_delay + weekend_congestion + rng.normal(0, 1.5, N), 0, None)

usable_ratio = np.clip(1 - rng.binomial(1, 0.05, N) * rng.uniform(0.05, 0.40, N), 0, 1)

breach = (delay_hours > 2).astype(int)                       # misses promise + 2h grace
penalty_inr = delay_hours * penalty_per_hour * (order_count / 4)
risk_band = np.where(delay_hours > 12, "RED", np.where(delay_hours > 4, "AMBER", "GREEN"))

df = pd.DataFrame({
    "supplier_past_ontime_rate": supplier_past_ontime_rate.round(4),
    "units": units,
    "usable_ratio": usable_ratio.round(4),
    "warehouse_proc_h": warehouse_proc_h,
    "n_events": n_events,
    "weekday": weekday,
    "hour_lead": hour_lead.round(2),
    "order_count": order_count,
    "penalty_per_hour": penalty_per_hour,
    # targets
    "breach": breach,
    "risk_band": risk_band,
    "delay_hours": delay_hours.round(3),
    "penalty_inr": penalty_inr.round(2),
})

Path("services/ml/data").mkdir(parents=True, exist_ok=True)
df.to_csv("services/ml/data/history_synthetic.csv", index=False)
print(f"Wrote {len(df)} synthetic rows -> services/ml/data/history_synthetic.csv")
