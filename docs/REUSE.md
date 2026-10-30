# DisruptionIQ Verified Recovery Desk — Open Source Reuse Scout

_Authoritative License Audit & Model Registry — Recorded 2026-10-30 for Step 19_

---

## 1. Repository Scout & License Audit

Per the **License Rule**, source code is copied into the project only if the repository provides an explicit permissive license (MIT, Apache-2.0, BSD-2-Clause, or BSD-3-Clause). Unlicensed repositories or repositories without clear terms are marked `REFERENCE_ONLY` (read for architectural inspiration only; no code copied). Repositories that are 404 or missing are marked `NOT_USED`.

| Repository URL | Commit Hash | License | Contents Overview | Decision |
|---|---|---|---|---|
| `https://github.com/vityk-dev/Parcel-Damage-Detection` | `1f4544a37d9ff2196462386e75ddcf8dad319c38` | **None** (Unlicensed / No LICENSE file) | End-to-end YOLOv11n-cls classification system with Dash dashboard and ONNX/CoreML pipeline for autonomous warehouse robot inspection. | **REFERENCE_ONLY** (No copy permitted due to lack of open-source license; architecture and metrics reviewed). |
| `https://github.com/abhijeetgupta23/Box-Detection-in-Warehouse-using-Vision-Based-ML-Engineering` | `f117fcda3ec224ec2d2b297399d4c25d85412aac` | **None** (Unlicensed / No LICENSE file) | YOLOv8/YOLOv5 packaging detection in warehouse with example images, Jupyter notebooks, and a simple Flask interface. | **REFERENCE_ONLY** (No code copied; reviewed for detection bounding-box utilities). |
| `https://github.com/github2python/Campus-Bus-Tracking-System` | `cab2d23120e3185c221e0bc76ba9d1898db7b053` | **None** (Software Engineering Coursework, no license) | Student project with React frontend, Express/Node backend, JWT authentication, and Leaflet location tracking for campus buses. | **REFERENCE_ONLY** (Coursework repository with no license; used for conceptual reference). |
| `https://github.com/codewithbalaji/realtime_tracker` | N/A (404) | **None** (Repository Not Found) | GitHub repository returned HTTP 404 / Not Found. | **NOT_USED** (Repository unavailable on GitHub). |

---

## 2. Leaflet Tooling & Python Vision Dependencies

### Node.js / Web Workspace Dependencies (NPM Packages)
Installed cleanly via npm workspaces without copying untracked code:
- **`leaflet`** (`^1.9.4`): BSD-2-Clause licensed interactive map engine.
- **`react-leaflet`** (`^4.2.1`): Hippocratic / MIT license React wrapper for Leaflet.
- **`@geoman-io/leaflet-geoman-free`** (`^2.17.0`): MIT licensed polygon drawing and editing tool for warehouse zone mapping.
- **`ws`** (`^8.18.0`): MIT licensed native WebSocket server library attached to the Express HTTP server at `/ws`.

### Python Vision Service Dependencies
- **`opencv-python-headless`**: Apache-2.0.
- **`numpy`**: BSD-3-Clause.
- **`huggingface_hub`**: Apache-2.0.
- **`ultralytics`** (`8.4.x`): **AGPL-3.0**.
  > [!NOTE]
  > `ultralytics` is licensed under AGPL-3.0. This is fully acceptable for local development and the hackathon demonstration testbed. A commercial distribution or closed SaaS offering would require a commercial license from Ultralytics or an export to ONNX runtime.

---

## 3. Vision Model Registry: cvtechniques/PackageDamage

Downloaded deterministically from Hugging Face Hub using `huggingface_hub`:

- **Hugging Face Model ID**: [`cvtechniques/PackageDamage`](https://huggingface.co/cvtechniques/PackageDamage)
- **License**: MIT
- **Model Architecture**: YOLOv11 (`best.pt`)
- **Local Location**: `services/vision/models/best.pt`
- **SHA-256 Hash**:
  ```
  84c9b943672e676f32c97dc36a81aae8766bdd96646e1b5e552de17aebca289c
  ```
- **Model Class Names (`model.names`)**:
  ```json
  {
    0: "Damaged",
    1: "Normal"
  }
  ```

---

## 4. Model Smoke Test Verification

- **Input Sample Image**: `classexamples.png` (downloaded from the model repository).
- **Smoke Detections File**: `services/vision/tests/fixtures/model_smoke.json`
- **Annotated Output Image**: `services/vision/tests/fixtures/model_smoke_output.jpg`
- **Detection Results**:
  - Total Detections: **4** (2 Damaged, 2 Normal)
  - Box 1: `Damaged` (Confidence: 0.9450, Bounding Box: `[352.48, 20.03, 719.26, 302.41]`)
  - Box 2: `Damaged` (Confidence: 0.9054, Bounding Box: `[389.14, 344.43, 690.58, 612.98]`)
  - Box 3: `Normal` (Confidence: 0.8447, Bounding Box: `[70.86, 45.65, 275.10, 315.82]`)
  - Box 4: `Normal` (Confidence: 0.8149, Bounding Box: `[37.37, 366.67, 208.75, 626.83]`)

