"""
services/vision/main.py

FastAPI vision service exposing CCTV synthesis and deterministic damage analysis.
Runs on port 8010.
"""

import os
from pathlib import Path
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from services.vision.synthesizer import synthesize_clip
from services.vision.analyzer import analyze_clip

app = FastAPI(
    title="Antigravity CCTV Damage Vision Service",
    version="1.0.0",
    description="Deterministic OpenCV tracking, deformation analysis, and YOLO damage detection."
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODELS_DIR = Path(__file__).resolve().parent / "models"
DEFAULT_MODEL_WEIGHTS = str(MODELS_DIR / "best.pt")
DEFAULT_EVIDENCE_DIR = str(Path(__file__).resolve().parent.parent.parent / ".data" / "evidence")


class SynthesizeRequest(BaseModel):
    warehouse_id: str = "WH-HOS"
    camera_id: str = "CAM-01"
    fps: int = 15
    seconds: float = 4.0
    parcel_count: int = 2
    injected_events: List[Dict[str, Any]] = []
    seed: int = 42
    output_dir: Optional[str] = None
    clip_id: Optional[str] = None


class AnalyzeRequest(BaseModel):
    clip_path: str
    parcel_to_shipment_map: Optional[Dict[str, str]] = None
    warehouse_id: Optional[str] = "WH-HOS"
    camera_id: Optional[str] = "CAM-01"
    evidence_dir: Optional[str] = None
    model_weights_path: Optional[str] = None


@app.get("/health")
def health_check():
    weights_exist = os.path.exists(DEFAULT_MODEL_WEIGHTS)
    return {
        "status": "ok",
        "service": "vision",
        "port": 8010,
        "model_available": weights_exist,
        "model_path": DEFAULT_MODEL_WEIGHTS if weights_exist else None
    }


@app.post("/synthesize")
def synthesize(req: SynthesizeRequest):
    try:
        spec = req.model_dump()
        out_dir = spec.pop("output_dir", None)
        result = synthesize_clip(spec, output_dir=out_dir)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    try:
        weights_path = req.model_weights_path or DEFAULT_MODEL_WEIGHTS
        evidence_dir = req.evidence_dir or DEFAULT_EVIDENCE_DIR

        result = analyze_clip(
            clip_path=req.clip_path,
            parcel_to_shipment_map=req.parcel_to_shipment_map or {},
            warehouse_id=req.warehouse_id or "WH-HOS",
            camera_id=req.camera_id or "CAM-01",
            evidence_dir=evidence_dir,
            model_weights_path=weights_path
        )
        return result
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8010)

