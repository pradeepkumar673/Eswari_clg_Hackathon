# DisruptionIQ Verified Recovery Desk

Enterprise supply-chain disruption recovery with mathematical verification.

## Architecture

- **`apps/api`**: Node.js + Express + TypeScript + MongoDB
- **`apps/web`**: React + Vite + TypeScript + Tailwind CSS
- **`services/solver`**: Python FastAPI + Google OR-Tools CP-SAT
- **`packages/shared`**: Shared Zod schemas and TypeScript contracts

## Quick Start

### 1. Prerequisites
- Node.js v20+ / v22+
- Python 3.10+
- MongoDB 7.0+ (running as single-node replica set `rs0` on port 27017)

### 2. Setup Solver Environment
```bash
python -m venv services/solver/venv
# Windows:
.\services\solver\venv\Scripts\Activate.ps1
# Linux/macOS:
source services/solver/venv/bin/activate

pip install -r services/solver/requirements.txt
```

### 3. Setup Monorepo
```bash
npm install
npm run db:start
```

### 4. Run Development Stack
```bash
npm run dev
```
- Web UI: http://localhost:3000
- Backend API: http://localhost:4000
- Solver API: http://localhost:8000/docs

