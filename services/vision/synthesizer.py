"""
services/vision/synthesizer.py

Deterministic synthetic video generation for CCTV damage detection:
- Generates conveyor belt / warehouse footage with moving cardboard boxes.
- Textures cardboard with paper grain and brown packaging tape.
- Injects DROP (sudden vertical speed jump) and CRUSH (inward corner warping / creases).
- Byte-identical output for identical seeds.
"""

import os
import cv2
import json
import hashlib
import numpy as np
from pathlib import Path


def create_cardboard_texture(width, height, rng):
    """Generate a realistic cardboard texture with subtle fiber noise."""
    base_color = np.array([95, 140, 185], dtype=np.float32)  # Tan / cardboard brown in BGR
    noise = rng.normal(0, 4, (height, width, 3)).astype(np.float32)
    cardboard = np.clip(base_color + noise, 0, 255).astype(np.uint8)

    # Add subtle corrugation fluting lines (every 8 pixels vertically)
    for y in range(0, height, 8):
        cardboard[y : y + 2, :, :] = np.clip(cardboard[y : y + 2, :, :].astype(np.int16) - 10, 0, 255).astype(np.uint8)

    return cardboard


def synthesize_clip(spec, output_dir=None):
    """
    Synthesize an MP4 clip and ground-truth JSON according to spec.
    The same seed produces byte-identical video files.
    """
    warehouse_id = spec.get("warehouse_id", "WH-HOS")
    camera_id = spec.get("camera_id", "CAM-01")
    fps = int(spec.get("fps", 15))
    seconds = float(spec.get("seconds", 4))
    parcel_count = int(spec.get("parcel_count", 2))
    injected_events = spec.get("injected_events", [])
    seed = int(spec.get("seed", 42))

    if output_dir is None:
        output_dir = os.path.join(".", ".data", "cctv", "clips")
    os.makedirs(output_dir, exist_ok=True)

    rng = np.random.RandomState(seed)

    total_frames = int(fps * seconds)
    width, height = 640, 480

    clip_id = spec.get("clip_id") or f"CLP-{seed}-{warehouse_id}-{camera_id}"
    clip_filename = f"{clip_id}.mp4"
    clip_path = os.path.join(output_dir, clip_filename)

    # Pre-render static warehouse background with conveyor belt
    # Top & bottom: warehouse floor (concrete gray)
    bg = np.zeros((height, width, 3), dtype=np.uint8)
    bg[:140, :] = [185, 185, 190]   # Concrete floor BGR
    bg[340:, :] = [185, 185, 190]

    # Conveyor belt in the middle (dark metallic gray)
    bg[140:340, :] = [60, 65, 70]
    # Draw conveyor rollers / slats every 30px (dark metallic gray, < 60)
    for x in range(0, width, 30):
        cv2.line(bg, (x, 140), (x, 340), (45, 50, 55), 2)
        cv2.line(bg, (x + 2, 140), (x + 2, 340), (50, 55, 60), 1)

    # Yellow safety border lines
    cv2.line(bg, (0, 138), (width, 138), (30, 200, 230), 4)
    cv2.line(bg, (0, 342), (width, 342), (30, 200, 230), 4)

    # Setup parcel tracks
    box_w = 110
    box_h = 75
    box_texture = create_cardboard_texture(box_w, box_h, rng)

    tracks_config = {}
    for i in range(1, parcel_count + 1):
        # Evenly space parcels on conveyor
        start_x = 35 + (i - 1) * 210
        base_y = 215 + ((i % 2) * 8)
        # Moderate horizontal speed so boxes stay visible throughout clip
        speed_x = 2.5

        # Check for injected events on this track
        evt = next((e for e in injected_events if e.get("track_id") == i), None)

        tracks_config[i] = {
            "track_id": i,
            "start_x": start_x,
            "base_y": base_y,
            "speed_x": speed_x,
            "event": evt
        }

    # Video writer setup (mp4v codec on 640x480)
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(clip_path, fourcc, fps, (width, height))

    ground_truth_records = []

    for frame_idx in range(total_frames):
        frame = bg.copy()

        for track_id, cfg in tracks_config.items():
            current_x = int(cfg["start_x"] + frame_idx * cfg["speed_x"])
            current_y = int(cfg["base_y"])
            evt = cfg["event"]

            corner_warp = 0.0
            crease_lines = False

            if evt:
                f_start = evt.get("frame_start", 0)
                f_end = evt.get("frame_end", total_frames)
                kind = evt.get("kind", "").upper()
                sev = evt.get("severity", "MINOR").upper()

                if kind == "DROP":
                    # Sudden vertical jump for a few frames
                    if f_start <= frame_idx <= f_end:
                        if sev == "SEVERE":
                            # Sharp impact jump of 25px
                            if frame_idx == f_start:
                                current_y += 24
                            elif frame_idx == f_start + 1:
                                current_y += 18
                            elif frame_idx == f_start + 2:
                                current_y += 8
                        else:
                            # MINOR DROP: smooth drop with peak |Δvy| = 10 px/frame (I = 10/15 = 0.67)
                            if frame_idx == f_start:
                                current_y += 8
                            elif frame_idx == f_start + 1:
                                current_y += 13
                            elif frame_idx == f_start + 2:
                                current_y += 8

                elif kind == "CRUSH":
                    # Corners warped inward over several frames
                    if frame_idx >= f_start:
                        if frame_idx <= f_end:
                            progress = (frame_idx - f_start) / max(1, (f_end - f_start))
                        else:
                            progress = 1.0  # Stays crushed

                        if sev == "SEVERE":
                            # SEVERE CRUSH: 35px inward corner warp & vertical jolt
                            corner_warp = 35.0 * progress
                            crease_lines = True
                            if f_start <= frame_idx <= f_start + 2:
                                current_y += int(16 * (1.0 - (frame_idx - f_start) / 3))
                        else:
                            # MINOR CRUSH: 12px inward corner warp
                            corner_warp = 12.0 * progress

            # Draw parcel if it is inside the visible canvas
            if current_x + box_w > 0 and current_x < width:
                # Define 4 box corners with inward warping on top-right corner if crushed
                p0 = np.array([current_x, current_y], dtype=np.float32)                                # top-left
                p1 = np.array([current_x + box_w - corner_warp, current_y + corner_warp * 0.8], dtype=np.float32)  # top-right (warped inward)
                p2 = np.array([current_x + box_w - corner_warp * 0.3, current_y + box_h], dtype=np.float32)        # bottom-right
                p3 = np.array([current_x, current_y + box_h], dtype=np.float32)                        # bottom-left

                pts = np.array([p0, p1, p2, p3], dtype=np.int32).reshape((-1, 1, 2))

                # Fill box polygon with cardboard texture
                mask = np.zeros((height, width), dtype=np.uint8)
                cv2.fillPoly(mask, [pts], 255)

                # Paste cardboard texture into bounding box region
                x_min, y_min = max(0, current_x), max(0, current_y)
                x_max, y_max = min(width, current_x + box_w), min(height, current_y + box_h + int(corner_warp))

                if x_max > x_min and y_max > y_min:
                    # Place cardboard texture
                    sub_mask = mask[y_min:y_max, x_min:x_max]
                    sub_cardboard = cv2.resize(box_texture, (x_max - x_min, y_max - y_min))

                    # Blend cardboard where mask is 255
                    for c in range(3):
                        frame[y_min:y_max, x_min:x_max, c] = np.where(
                            sub_mask == 255,
                            sub_cardboard[:, :, c],
                            frame[y_min:y_max, x_min:x_max, c]
                        )

                    # Draw packaging tape across center (gray ~110 so it stays within mask range 78-175)
                    tape_y_start = max(y_min, current_y + box_h // 2 - 6)
                    tape_y_end = min(y_max, current_y + box_h // 2 + 6)
                    if tape_y_end > tape_y_start:
                        tape_mask = mask[tape_y_start:tape_y_end, x_min:x_max]
                        for c, val in enumerate([65, 100, 145]):  # BGR packaging tape
                            frame[tape_y_start:tape_y_end, x_min:x_max, c] = np.where(
                                tape_mask == 255,
                                val,
                                frame[tape_y_start:tape_y_end, x_min:x_max, c]
                            )

                    # Draw outer box border
                    cv2.polylines(frame, [pts], isClosed=True, color=(35, 50, 70), thickness=2)

                    # Draw crease lines if crushed
                    if crease_lines and corner_warp > 10:
                        dent_x = int(current_x + box_w - corner_warp)
                        dent_y = int(current_y + corner_warp * 0.8)
                        cv2.line(frame, (dent_x, dent_y), (dent_x - 20, dent_y + 25), (20, 30, 45), 2)
                        cv2.line(frame, (dent_x, dent_y), (dent_x + 10, dent_y + 35), (20, 30, 45), 2)

        writer.write(frame)

    writer.release()

    # Calculate SHA-256 of the generated video file
    with open(clip_path, "rb") as f:
        sha256_hash = hashlib.sha256(f.read()).hexdigest()

    # Ground-truth JSON
    gt_filename = f"{clip_id}_ground_truth.json"
    gt_path = os.path.join(output_dir, gt_filename)

    ground_truth = {
        "clip_id": clip_id,
        "warehouse_id": warehouse_id,
        "camera_id": camera_id,
        "fps": fps,
        "seconds": seconds,
        "frame_count": total_frames,
        "parcel_count": parcel_count,
        "sha256": sha256_hash,
        "injected_events": injected_events,
        "seed": seed
    }

    with open(gt_path, "w", encoding="utf-8") as f:
        json.dump(ground_truth, f, indent=2)

    return {
        "clip_id": clip_id,
        "clip_path": clip_path,
        "sha256": sha256_hash,
        "frame_count": total_frames,
        "fps": fps,
        "ground_truth_path": gt_path,
        "ground_truth": ground_truth
    }

