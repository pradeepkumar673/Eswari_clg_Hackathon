# DisruptionIQ Verified Recovery Desk — Commands Guide

## Prerequisites & Installation

### 1. MongoDB with Single-Node Replica Set

#### Why is a replica set required?
DisruptionIQ relies on **multi-document ACID transactions** to guarantee that reservation holds (`reserveStock`), execution ledger entries, and audit logs are recorded atomically with zero race conditions or partial writes. Single-node standalone MongoDB does not support multi-document transactions unless configured with a replica set (e.g. `rs0`).

#### Windows Installation & Setup
1. MongoDB Server is installed in `C:\Program Files\MongoDB\Server\8.3\bin\`.
2. To run as a replica set without service conflicts:
   - If Windows Service `MongoDB` is running as a standalone node, either configure it in `mongod.cfg` with:
     ```yaml
     replication:
       replSetName: rs0
     ```
     and restart the service via `net stop MongoDB` and `net start MongoDB` (run in Administrator PowerShell).
   - Alternatively, our `npm run db:start` script runs `mongod` with `--replSet rs0 --dbpath .data/mongo --port 27017` idempotently.
3. Once running, initiate the replica set:
   ```js
   rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "127.0.0.1:27017" }] })
   ```

#### macOS / Linux Setup
- macOS (Homebrew):
  ```bash
  brew tap mongodb/brew
  brew install mongodb-community@7.0
  mongod --replSet rs0 --dbpath .data/mongo --port 27017
  ```
- Linux (Ubuntu/Debian):
  ```bash
  sudo apt-get install -y mongodb-org
  mongod --replSet rs0 --dbpath .data/mongo --port 27017
  ```

---

## Python Solver Setup (`services/solver`)

1. Ensure Python 3.10+ is installed (`python --version`).
2. Create and activate a virtual environment:
   ```bash
   python -m venv services/solver/venv
   # Windows PowerShell:
   .\services\solver\venv\Scripts\Activate.ps1
   # macOS/Linux:
   source services/solver/venv/bin/activate
   ```
3. Install dependencies:
   ```bash
   pip install -r services/solver/requirements.txt
   ```
4. Test solver health:
   ```bash
   pytest services/solver/tests
   ```

---

## Daily Development Workflow

```bash
# 1. Install all monorepo dependencies
npm install

# 2. Start local MongoDB replica set
npm run db:start

# 3. Start API, Frontend, and Solver in parallel
npm run dev

# 4. Run test suites
npm run test

# 5. Check code for placeholders / forbidden strings
npm run scan:placeholders
```

