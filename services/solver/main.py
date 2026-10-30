from fastapi import FastAPI
from datetime import datetime, timezone
import sys

app = FastAPI(title="DisruptionIQ Solver Service", version="1.0.0")

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "solver",
        "python_version": sys.version,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

