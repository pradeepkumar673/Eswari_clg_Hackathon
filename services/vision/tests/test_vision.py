"""
services/vision/tests/test_vision.py

Pytest suite for Step 20 Damage Detector Vision Service:
1. Clean clip produces zero damage events (band NONE).
2. Clip with 1 SEVERE CRUSH and 1 MINOR DROP produces exactly two events
   with bands matching ground truth. Includes hand-calculated score arithmetic in comments.
3. Same spec synthesized twice produces byte-identical MP4 files (identical SHA-256)
   and identical analysis JSON outputs.
4. When weights are missing or removed, model_used is false and score still computes.
"""

import os
import hashlib
import json
import pytest
from pathlib import Path

# Add vision service root to sys.path
import sys
VISION_ROOT = Path(__file__).resolve().parent.parent
if str(VISION_ROOT) not in sys.path:
    sys.path.insert(0, str(VISION_ROOT))

from synthesizer import synthesize_clip
from analyzer import analyze_clip


@pytest.fixture
def tmp_dir(tmp_path):
    d = tmp_path / "vision_test_run"
    d.mkdir(parents=True, exist_ok=True)
    return str(d)


def test_clean_clip_zero_events(tmp_dir):
    """Clean clip with no injected drops or crushes must yield 0 damage events."""
    spec = {
        "warehouse_id": "WH-HOS",
        "camera_id": "CAM-01",
        "fps": 15,
        "seconds": 4,
        "parcel_count": 2,
        "injected_events": [],
        "seed": 42
    }
    synth_res = synthesize_clip(spec, output_dir=tmp_dir)
    assert os.path.exists(synth_res["clip_path"])
    assert synth_res["frame_count"] == 60

    parcel_map = {"1": "SHP-204", "2": "SHP-310"}
    analysis = analyze_clip(
        clip_path=synth_res["clip_path"],
        parcel_to_shipment_map=parcel_map,
        warehouse_id=spec["warehouse_id"],
        camera_id=spec["camera_id"],
        evidence_dir=os.path.join(tmp_dir, "evidence"),
        model_weights_path=str(VISION_ROOT / "models" / "best.pt")
    )

    # Clean clip must produce 0 damage events (all tracks have band NONE, 0-19)
    assert len(analysis["events"]) == 0


def test_injected_severe_crush_and_minor_drop(tmp_dir):
    """
    Clip with one injected SEVERE CRUSH and one injected MINOR DROP:
    Must produce exactly two events in the right tracks, with bands equal to ground truth.

    --------------------------------------------------------------------------
    Hand-calculated Score Verification & Arithmetic:
    --------------------------------------------------------------------------
    Weights: 0.4 Impact (I), 0.4 Deformation (C), 0.2 Model confidence (M)
    drop_scale = 15.0 px/frame, angle_threshold = 20.0 degrees

    Track 1: Injected SEVERE CRUSH
    - Vertical drop speed change |Δv_y| >= 15.0 px/frame -> I = clamp(15.0 / 15.0, 0, 1) = 1.0
    - Corner angle change Δθ >= 20.0 deg -> C = clamp(20.0 / 20.0, 0, 1) = 1.0
    - Model damaged confidence M >= 0.0
    - damage_score = 100 * min(1.0, 0.4 * 1.0 + 0.4 * 1.0 + 0.2 * M)
                   = 100 * (0.80 + 0.2 * M) >= 80.0
    - Band = SEVERE (score in 80..100)

    Track 2: Injected MINOR DROP
    - Vertical drop speed change |Δv_y| ~ 9.0 px/frame -> I = clamp(9.0 / 15.0, 0, 1) = 0.60
    - Corner angle change Δθ ~ 0.0 deg -> C = 0.0
    - Model damaged confidence M = 0.0 (cardboard intact)
    - damage_score = 100 * min(1.0, 0.4 * 0.60 + 0.4 * 0.0 + 0.2 * 0.0)
                   = 100 * 0.24 = 24.0
    - Band = MINOR (score in 20..49)
    --------------------------------------------------------------------------
    """
    spec = {
        "warehouse_id": "WH-HOS",
        "camera_id": "CAM-01",
        "fps": 15,
        "seconds": 5,
        "parcel_count": 2,
        "injected_events": [
            {
                "track_id": 1,
                "kind": "CRUSH",
                "severity": "SEVERE",
                "frame_start": 20,
                "frame_end": 35
            },
            {
                "track_id": 2,
                "kind": "DROP",
                "severity": "MINOR",
                "frame_start": 40,
                "frame_end": 50
            }
        ],
        "seed": 101
    }

    synth_res = synthesize_clip(spec, output_dir=tmp_dir)
    parcel_map = {"1": "SHP-204", "2": "SHP-310"}

    evidence_out = os.path.join(tmp_dir, "evidence")
    analysis = analyze_clip(
        clip_path=synth_res["clip_path"],
        parcel_to_shipment_map=parcel_map,
        warehouse_id=spec["warehouse_id"],
        camera_id=spec["camera_id"],
        evidence_dir=evidence_out,
        model_weights_path=str(VISION_ROOT / "models" / "best.pt")
    )

    events = analysis["events"]
    # Must yield exactly two events
    assert len(events) == 2

    track_map = {e["track_id"]: e for e in events}
    assert 1 in track_map
    assert 2 in track_map

    # Assert bands match ground truth specification
    assert track_map[1]["band"] == "SEVERE"
    assert track_map[1]["shipment_id"] == "SHP-204"
    assert track_map[1]["status"] == "DETECTED"

    assert track_map[2]["band"] == "MINOR"
    assert track_map[2]["shipment_id"] == "SHP-310"
    assert track_map[2]["status"] == "DETECTED"

    # Evidence files must exist on disk and match reported SHA-256
    for e in events:
        ev_path = e["evidence_path"]
        assert os.path.exists(ev_path), f"Evidence file {ev_path} must exist"
        with open(ev_path, "rb") as f:
            computed_sha = hashlib.sha256(f.read()).hexdigest()
        assert computed_sha == e["evidence_sha256"]


def test_deterministic_synthesis_and_analysis_hash(tmp_dir):
    """Same spec synthesized twice must produce identical file hashes and identical analysis outputs."""
    spec = {
        "warehouse_id": "WH-HOS",
        "camera_id": "CAM-01",
        "fps": 15,
        "seconds": 3,
        "parcel_count": 2,
        "injected_events": [
            {
                "track_id": 1,
                "kind": "DROP",
                "severity": "MINOR",
                "frame_start": 15,
                "frame_end": 25
            }
        ],
        "seed": 999
    }

    dir1 = os.path.join(tmp_dir, "run1")
    dir2 = os.path.join(tmp_dir, "run2")
    os.makedirs(dir1, exist_ok=True)
    os.makedirs(dir2, exist_ok=True)

    res1 = synthesize_clip(spec, output_dir=dir1)
    res2 = synthesize_clip(spec, output_dir=dir2)

    # Identical video file SHA-256
    with open(res1["clip_path"], "rb") as f:
        h1 = hashlib.sha256(f.read()).hexdigest()
    with open(res2["clip_path"], "rb") as f:
        h2 = hashlib.sha256(f.read()).hexdigest()

    assert h1 == h2, "Byte-identical MP4 output expected for same seed and spec"

    # Identical analysis output
    parcel_map = {"1": "SHP-204"}
    analysis1 = analyze_clip(
        clip_path=res1["clip_path"],
        parcel_to_shipment_map=parcel_map,
        warehouse_id=spec["warehouse_id"],
        camera_id=spec["camera_id"],
        evidence_dir=os.path.join(dir1, "evidence"),
        model_weights_path=str(VISION_ROOT / "models" / "best.pt")
    )
    analysis2 = analyze_clip(
        clip_path=res2["clip_path"],
        parcel_to_shipment_map=parcel_map,
        warehouse_id=spec["warehouse_id"],
        camera_id=spec["camera_id"],
        evidence_dir=os.path.join(dir2, "evidence"),
        model_weights_path=str(VISION_ROOT / "models" / "best.pt")
    )

    assert len(analysis1["events"]) == len(analysis2["events"])
    assert analysis1["events"][0]["damage_score"] == analysis2["events"][0]["damage_score"]
    assert analysis1["events"][0]["band"] == analysis2["events"][0]["band"]


def test_model_used_false_when_weights_removed(tmp_dir):
    """When weights are missing, model_used is false and damage score still computes cleanly."""
    spec = {
        "warehouse_id": "WH-HOS",
        "camera_id": "CAM-01",
        "fps": 15,
        "seconds": 3,
        "parcel_count": 1,
        "injected_events": [
            {
                "track_id": 1,
                "kind": "CRUSH",
                "severity": "SEVERE",
                "frame_start": 15,
                "frame_end": 25
            }
        ],
        "seed": 777
    }

    synth_res = synthesize_clip(spec, output_dir=tmp_dir)
    parcel_map = {"1": "SHP-204"}

    # Pass non-existent model path
    analysis = analyze_clip(
        clip_path=synth_res["clip_path"],
        parcel_to_shipment_map=parcel_map,
        warehouse_id=spec["warehouse_id"],
        camera_id=spec["camera_id"],
        evidence_dir=os.path.join(tmp_dir, "evidence"),
        model_weights_path=os.path.join(tmp_dir, "nonexistent_weights.pt")
    )

    # Must explicitly state model_used is false
    assert analysis["model_used"] is False

    # Score must still compute successfully
    assert len(analysis["events"]) == 1
    event = analysis["events"][0]
    assert event["components"]["model_M"] == 0.0
    assert event["damage_score"] >= 80.0
    assert event["band"] == "SEVERE"

