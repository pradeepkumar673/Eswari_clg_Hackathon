"""
services/vision/analyzer.py

Deterministic OpenCV contour tracking and damage scoring pipeline for CCTV clips:
a. Grayscale, threshold, contours, filter parcel size range.
b. Track by nearest centroid with maximum jump distance (stable track ids).
c. Baseline shape from first 10 frames (approxPolyDP corner angles and min-area rectangle).
d. Impact I = clamp(peak vertical speed change / drop_scale, 0, 1).
e. Deformation C = clamp(mean absolute corner-angle change from baseline / 20 deg, 0, 1).
f. Model M = damaged-class confidence from YOLO model on peak frame (or 0 if model unavailable).
g. damage_score = 100 * min(1, 0.4 I + 0.4 C + 0.2 M).
h. Bands: 0-19 NONE, 20-49 MINOR, 50-79 MAJOR, 80-100 SEVERE.
i. Save evidence JPEG per damage event, hash with SHA-256.
j. 100% deterministic (no randomness at analysis time).
"""

import os
import cv2
import json
import hashlib
import numpy as np
from pathlib import Path

# Load vision params
PARAMS_PATH = Path(__file__).resolve().parent / "config" / "vision_params.json"
if PARAMS_PATH.exists():
    with open(PARAMS_PATH, "r", encoding="utf-8") as f:
        VISION_PARAMS = json.load(f)
else:
    VISION_PARAMS = {
        "drop_scale": 15.0,
        "deformation_threshold_deg": 20.0,
        "weight_impact": 0.4,
        "weight_deformation": 0.4,
        "weight_model": 0.2,
        "min_parcel_area": 800,
        "max_parcel_area": 120000,
        "max_jump_distance": 100.0,
        "baseline_frames": 10,
        "approx_poly_epsilon_ratio": 0.04,
        "bands": {
            "NONE": [0, 19],
            "MINOR": [20, 49],
            "MAJOR": [50, 79],
            "SEVERE": [80, 100]
        }
    }


def compute_polygon_angles(pts):
    """Compute interior/vertex angles in degrees for an ordered 4-vertex polygon."""
    if len(pts) != 4:
        return [90.0, 90.0, 90.0, 90.0]

    angles = []
    for i in range(4):
        p_prev = pts[(i - 1) % 4]
        p_curr = pts[i]
        p_next = pts[(i + 1) % 4]

        v1 = p_prev - p_curr
        v2 = p_next - p_curr

        n1 = np.linalg.norm(v1)
        n2 = np.linalg.norm(v2)

        if n1 < 1e-4 or n2 < 1e-4:
            angles.append(90.0)
            continue

        cos_th = np.dot(v1, v2) / (n1 * n2)
        cos_th = np.clip(cos_th, -1.0, 1.0)
        angle_deg = float(np.degrees(np.arccos(cos_th)))
        angles.append(angle_deg)

    return angles


def order_quad_vertices(pts):
    """Sort 4 vertices in clockwise order starting from top-left."""
    pts = np.array(pts, dtype=np.float32)
    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1)

    top_left = pts[np.argmin(s)]
    bottom_right = pts[np.argmax(s)]
    top_right = pts[np.argmin(diff)]
    bottom_left = pts[np.argmax(diff)]

    return np.array([top_left, top_right, bottom_right, bottom_left], dtype=np.float32)


def get_band(score):
    if score >= 80:
        return "SEVERE"
    elif score >= 50:
        return "MAJOR"
    elif score >= 20:
        return "MINOR"
    return "NONE"


def analyze_clip(
    clip_path,
    parcel_to_shipment_map=None,
    warehouse_id="WH-HOS",
    camera_id="CAM-01",
    evidence_dir=None,
    model_weights_path=None
):
    """
    Analyze clip with deterministic OpenCV contour tracking and YOLO package damage scoring.
    """
    if parcel_to_shipment_map is None:
        parcel_to_shipment_map = {}

    if evidence_dir is None:
        evidence_dir = os.path.join(".", ".data", "evidence")
    os.makedirs(evidence_dir, exist_ok=True)

    if not os.path.exists(clip_path):
        raise FileNotFoundError(f"Clip file not found: {clip_path}")

    # Load YOLO model if available
    model = None
    model_used = False

    if model_weights_path and os.path.exists(model_weights_path):
        try:
            from ultralytics import YOLO
            model = YOLO(model_weights_path)
            model_used = True
        except Exception:
            model = None
            model_used = False

    cap = cv2.VideoCapture(clip_path)
    if not cap.isOpened():
        raise RuntimeError(f"Failed to open video file: {clip_path}")

    drop_scale = VISION_PARAMS.get("drop_scale", 15.0)
    deform_scale = VISION_PARAMS.get("deformation_threshold_deg", 20.0)
    w_impact = VISION_PARAMS.get("weight_impact", 0.4)
    w_deform = VISION_PARAMS.get("weight_deformation", 0.4)
    w_model = VISION_PARAMS.get("weight_model", 0.2)
    min_area = VISION_PARAMS.get("min_parcel_area", 800)
    max_area = VISION_PARAMS.get("max_parcel_area", 120000)
    max_jump = VISION_PARAMS.get("max_jump_distance", 100.0)
    baseline_window = VISION_PARAMS.get("baseline_frames", 10)

    # Active tracks: track_id -> dict of history
    tracks = {}
    next_track_id = 1

    frames_cache = []
    frame_idx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frames_cache.append(frame)

        # Preprocessing: convert to grayscale and isolate parcel rectangles on conveyor
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # Parcels are cardboard tan (gray level ~130-160), tape is ~110, conveyor is ~65, floor is ~185
        # Threshold 85-175 captures cardboard + tape as a single contiguous contour without conveyor
        in_range = cv2.inRange(gray, 85, 175)
        # Morphological close to consolidate tape and texture
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        closed = cv2.morphologyEx(in_range, cv2.MORPH_CLOSE, kernel)

        contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        frame_detections = []
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if min_area <= area <= max_area:
                M = cv2.moments(cnt)
                if M["m00"] > 0:
                    cx = float(M["m10"] / M["m00"])
                    cy = float(M["m01"] / M["m00"])

                    bx, by, bw, bh = cv2.boundingRect(cnt)

                    # Extract 4 principal corner points from contour
                    c_pts = cnt.reshape(-1, 2)
                    tl = c_pts[np.argmin(c_pts[:, 0] + c_pts[:, 1])]
                    br = c_pts[np.argmax(c_pts[:, 0] + c_pts[:, 1])]
                    tr = c_pts[np.argmax(c_pts[:, 0] - c_pts[:, 1])]
                    bl = c_pts[np.argmin(c_pts[:, 0] - c_pts[:, 1])]
                    quad = np.array([tl, tr, br, bl], dtype=np.float32)

                    angles = compute_polygon_angles(quad)

                    frame_detections.append({
                        "cx": cx,
                        "cy": cy,
                        "bbox": (bx, by, bw, bh),
                        "angles": angles,
                        "quad": quad
                    })

        # Associate detections with tracks by nearest centroid
        matched_dets = set()
        for tid, tdata in tracks.items():
            if not tdata["active"]:
                continue

            last_pos = tdata["positions"][-1]
            last_cx, last_cy = last_pos["cx"], last_pos["cy"]

            best_d = float("inf")
            best_idx = None
            for idx, det in enumerate(frame_detections):
                if idx in matched_dets:
                    continue
                d = np.hypot(det["cx"] - last_cx, det["cy"] - last_cy)
                if d < best_d and d <= max_jump:
                    best_d = d
                    best_idx = idx

            if best_idx is not None:
                matched_dets.add(best_idx)
                det = frame_detections[best_idx]
                tdata["positions"].append({
                    "frame": frame_idx,
                    "cx": det["cx"],
                    "cy": det["cy"],
                    "bbox": det["bbox"],
                    "angles": det["angles"],
                    "quad": det["quad"]
                })
            else:
                # If lost for more than 15 frames, mark inactive
                if frame_idx - tdata["positions"][-1]["frame"] > 15:
                    tdata["active"] = False

        # Initialize new tracks for unmatched detections
        for idx, det in enumerate(frame_detections):
            if idx not in matched_dets:
                tracks[next_track_id] = {
                    "track_id": next_track_id,
                    "active": True,
                    "positions": [{
                        "frame": frame_idx,
                        "cx": det["cx"],
                        "cy": det["cy"],
                        "bbox": det["bbox"],
                        "angles": det["angles"],
                        "quad": det["quad"]
                    }]
                }
                next_track_id += 1

        frame_idx += 1

    cap.release()

    # Now compute metrics for each track
    clip_basename = Path(clip_path).stem
    events = []

    for tid, tdata in tracks.items():
        positions = tdata["positions"]
        if len(positions) < 3:
            continue

        # Baseline angles from up to first baseline_window frames
        init_angles = [p["angles"] for p in positions[:baseline_window]]
        baseline_angles = np.mean(init_angles, axis=0) if init_angles else [90.0, 90.0, 90.0, 90.0]

        # Calculate vertical speed series: vy(t) = (cy(t) - cy(t-1)) / dt
        vy_series = []
        for i in range(1, len(positions)):
            prev = positions[i - 1]
            curr = positions[i]
            dt = max(1, curr["frame"] - prev["frame"])
            vy = (curr["cy"] - prev["cy"]) / dt
            vy_series.append((curr["frame"], vy))

        # Peak change in vertical speed between consecutive frames |vy(t) - vy(t-1)|
        peak_delta_vy = 0.0
        for i in range(1, len(vy_series)):
            dvy = abs(vy_series[i][1] - vy_series[i - 1][1])
            if dvy > peak_delta_vy:
                peak_delta_vy = dvy

        # Compute corner angle deformation across frames
        peak_delta_theta = 0.0
        peak_frame = positions[0]["frame"]
        peak_combined_signal = -1.0
        peak_bbox = positions[0]["bbox"]

        for i, curr in enumerate(positions):
            angle_diffs = [abs(curr["angles"][a] - baseline_angles[a]) for a in range(4)]
            mean_angle_change = float(np.mean(angle_diffs))

            if mean_angle_change > peak_delta_theta:
                peak_delta_theta = mean_angle_change

            # Instantaneous signal for identifying the peak frame
            f_dvy = 0.0
            if i > 1 and (i - 1) < len(vy_series):
                f_dvy = abs(vy_series[i - 1][1] - vy_series[i - 2][1])

            sig = (f_dvy / drop_scale) * 0.5 + (mean_angle_change / deform_scale) * 0.5
            if sig > peak_combined_signal:
                peak_combined_signal = sig
                peak_frame = curr["frame"]
                peak_bbox = curr["bbox"]

        # Component I: Impact
        impact_I = float(np.clip(peak_delta_vy / drop_scale, 0.0, 1.0))

        # Component C: Deformation
        deform_C = float(np.clip(peak_delta_theta / deform_scale, 0.0, 1.0))

        # Component M: YOLO model confidence on peak frame
        model_M = 0.0
        if model_used and model is not None and 0 <= peak_frame < len(frames_cache):
            bx, by, bw, bh = peak_bbox
            # Crop parcel with small margin
            pad = 6
            h_img, w_img = frames_cache[peak_frame].shape[:2]
            y1, y2 = max(0, by - pad), min(h_img, by + bh + pad)
            x1, x2 = max(0, bx - pad), min(w_img, bx + bw + pad)

            if y2 > y1 and x2 > x1:
                crop = frames_cache[peak_frame][y1:y2, x1:x2]
                try:
                    preds = model.predict(crop, verbose=False)
                    if len(preds) > 0 and preds[0].boxes is not None:
                        for b in preds[0].boxes:
                            cls_id = int(b.cls[0].item())
                            conf = float(b.conf[0].item())
                            if cls_id == 0:  # Class 0 is Damaged
                                if conf > model_M:
                                    model_M = conf
                except Exception:
                    model_M = 0.0

        # Calculate damage score: 100 * min(1, 0.4 I + 0.4 C + 0.2 M)
        raw_score = 100.0 * min(1.0, (w_impact * impact_I + w_deform * deform_C + w_model * model_M))
        damage_score = round(raw_score, 1)
        band = get_band(damage_score)

        # Bands: 0 to 19 NONE, 20 to 49 MINOR, 50 to 79 MAJOR, 80 to 100 SEVERE
        # Only tracks with band != NONE are emitted as damage detection events
        if band != "NONE":
            event_id = f"EVT-CCTV-{clip_basename}-{tid}"
            evidence_filename = f"{event_id}.jpg"
            evidence_path = os.path.join(evidence_dir, evidence_filename)

            # Generate evidence JPEG: annotate peak frame
            evidence_frame = frames_cache[peak_frame].copy()
            bx, by, bw, bh = peak_bbox

            # Color coding: SEVERE = Red (0, 0, 255), MAJOR = Orange (0, 140, 255), MINOR = Yellow (0, 230, 255)
            color_map = {
                "SEVERE": (0, 0, 230),
                "MAJOR": (0, 140, 255),
                "MINOR": (0, 220, 240)
            }
            box_col = color_map.get(band, (0, 255, 0))

            cv2.rectangle(evidence_frame, (bx, by), (bx + bw, by + bh), box_col, 2)

            label_top = f"Track #{tid} | Band: {band} | Score: {damage_score:.1f}"
            label_sub = f"I={impact_I:.2f} C={deform_C:.2f} M={model_M:.2f}"

            cv2.putText(evidence_frame, label_top, (max(10, bx), max(25, by - 10)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 3, cv2.LINE_AA)
            cv2.putText(evidence_frame, label_top, (max(10, bx), max(25, by - 10)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, box_col, 1, cv2.LINE_AA)

            cv2.putText(evidence_frame, label_sub, (max(10, bx), min(470, by + bh + 20)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 2, cv2.LINE_AA)
            cv2.putText(evidence_frame, label_sub, (max(10, bx), min(470, by + bh + 20)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (20, 20, 20), 1, cv2.LINE_AA)

            cv2.imwrite(evidence_path, evidence_frame, [cv2.IMWRITE_JPEG_QUALITY, 92])

            with open(evidence_path, "rb") as ef:
                evidence_sha256 = hashlib.sha256(ef.read()).hexdigest()

            # Map shipment ID
            shipment_id = parcel_to_shipment_map.get(str(tid)) or parcel_to_shipment_map.get(tid)

            # Assign damaged units according to band
            units_damaged = 20 if band == "SEVERE" else (10 if band == "MAJOR" else 0)

            events.append({
                "event_id": event_id,
                "clip_id": clip_basename,
                "track_id": tid,
                "shipment_id": shipment_id,
                "warehouse_id": warehouse_id,
                "camera_id": camera_id,
                "band": band,
                "damage_score": damage_score,
                "components": {
                    "impact_I": round(impact_I, 4),
                    "deformation_C": round(deform_C, 4),
                    "model_M": round(model_M, 4)
                },
                "units_damaged": units_damaged,
                "frame_start": positions[0]["frame"],
                "frame_end": positions[-1]["frame"],
                "peak_frame": peak_frame,
                "evidence_path": str(Path(evidence_path).resolve()),
                "evidence_sha256": evidence_sha256,
                "status": "DETECTED"
            })

    # Sort events deterministically by track_id
    events.sort(key=lambda e: e["track_id"])

    return {
        "clip_id": clip_basename,
        "warehouse_id": warehouse_id,
        "camera_id": camera_id,
        "model_used": model_used,
        "events": events
    }

