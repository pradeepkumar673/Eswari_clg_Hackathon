"""
DisruptionIQ Solver Service — CP-SAT portfolio-level constrained optimisation.

POST /solve  ->  SolveResponse
GET  /health ->  { status: "ok", ... }

Scope: "portfolio-level constrained optimisation" — NEVER claims global optimality.
"""
from __future__ import annotations

import sys
import time
from datetime import datetime, timezone
from typing import Literal

from fastapi import FastAPI, HTTPException
from ortools.sat.python import cp_model
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Pydantic I/O models
# ---------------------------------------------------------------------------

class OrderIn(BaseModel):
    code: str
    sku: str
    quantity: int
    due_hours_from_now: float
    fulfil_warehouse: str
    penalty_per_unit: int  # INR integer


class SourceIn(BaseModel):
    type: Literal["FREE_STOCK", "CONFIRMED_INBOUND"]
    warehouse: str
    sku: str
    free_units: int
    arrival_hours: float = 0.0


class CandidateIn(BaseModel):
    type: Literal["TRANSFER", "ALT_SUPPLIER", "EXPEDITE", "VIA"]
    # TRANSFER / VIA
    donor: str | None = None
    via_warehouse: str | None = None
    # ALT_SUPPLIER
    supplier: str | None = None
    sku: str
    free_units: int | None = None   # for TRANSFER / VIA
    capacity: int | None = None     # for ALT_SUPPLIER / EXPEDITE
    lead_hours: float = 0.0
    unit_cost: int = 0              # INR integer


class SolveRequest(BaseModel):
    orders: list[OrderIn]
    sources: list[SourceIn]
    candidates: list[CandidateIn]
    sim_now: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    time_limit: float = 2.0         # seconds for CP-SAT


class PerOrderOutcome(BaseModel):
    code: str
    on_time_units: int
    backordered_units: int
    delay_hours: float


class ActionOut(BaseModel):
    type: str
    ref: str                        # donor / supplier / source label
    sku: str
    units: int
    lead_hours: float
    unit_cost: int
    total_cost: int
    target_order: str


class SolveResponse(BaseModel):
    status: Literal["OPTIMAL", "FEASIBLE", "INFEASIBLE", "UNKNOWN"]
    actions: list[ActionOut]
    per_order: list[PerOrderOutcome]
    objective: int                  # total cost INR
    baseline_objective: int         # baseline penalty INR
    collateral: list[str]           # orders that remain fully backordered
    solve_ms: float
    scope: str = "portfolio-level constrained optimisation"


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="DisruptionIQ Solver Service", version="2.0.0")


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "solver",
        "python_version": sys.version,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# Core CP-SAT solver
# ---------------------------------------------------------------------------

def _build_and_solve(
    orders: list[OrderIn],
    sources: list[SourceIn],
    candidates: list[CandidateIn],
    time_limit: float,
    candidates_only: bool = False,
) -> tuple[cp_model.CpSolver, cp_model.CpModel, dict, dict]:
    """
    Build and solve the CP-SAT model.

    Variables:
        src_assign[i][j]  = units from source i  -> order j  (only if arrival <= due)
        cand_assign[k][j] = units from candidate k -> order j (only if arrival <= due)
        shortfall[j]      = max(demand_j - sum_assigned_to_j, 0)

    Objective:
        minimise  sum(penalty[j] * shortfall[j])  +  sum(unit_cost[k] * sum_k_assigned)

    When candidates_only=True we set all candidate supply to 0 to compute the baseline.
    """
    model = cp_model.CpModel()
    BIG = 10_000_000  # large bound for variable domains

    n_orders = len(orders)
    n_sources = len(sources)
    n_cands = len(candidates)

    # ---- decision variables ----
    src_assign: dict[tuple[int, int], cp_model.IntVar] = {}
    for i, src in enumerate(sources):
        for j, ord_ in enumerate(orders):
            # Source is usable if it serves the right warehouse/sku and arrives in time
            usable = (
                src.sku == ord_.sku
                and src.warehouse == ord_.fulfil_warehouse
                and src.arrival_hours <= ord_.due_hours_from_now
            )
            max_units = src.free_units if usable else 0
            v = model.new_int_var(0, max_units, f"src_{i}_{j}")
            src_assign[(i, j)] = v

    cand_assign: dict[tuple[int, int], cp_model.IntVar] = {}
    for k, cand in enumerate(candidates):
        for j, ord_ in enumerate(orders):
            usable = (
                cand.sku == ord_.sku
                and cand.lead_hours <= ord_.due_hours_from_now
                and not candidates_only  # baseline: no candidates
            )
            cap = (cand.free_units if cand.free_units is not None else cand.capacity) or 0
            max_units = cap if usable else 0
            v = model.new_int_var(0, max_units, f"cand_{k}_{j}")
            cand_assign[(k, j)] = v

    # ---- supply constraints ----
    # Each source total across orders <= free_units
    for i, src in enumerate(sources):
        model.add(
            sum(src_assign[(i, j)] for j in range(n_orders)) <= src.free_units
        )

    # Each candidate total across orders <= capacity
    for k, cand in enumerate(candidates):
        cap = (cand.free_units if cand.free_units is not None else cand.capacity) or 0
        model.add(
            sum(cand_assign[(k, j)] for j in range(n_orders)) <= cap
        )

    # ---- shortfall variables ----
    shortfall: dict[int, cp_model.IntVar] = {}
    for j, ord_ in enumerate(orders):
        sf = model.new_int_var(0, ord_.quantity, f"shortfall_{j}")
        shortfall[j] = sf
        assigned = sum(src_assign[(i, j)] for i in range(n_sources)) + sum(
            cand_assign[(k, j)] for k in range(n_cands)
        )
        # shortfall >= demand - assigned
        model.add(sf >= ord_.quantity - assigned)

    # ---- objective ----
    penalty_cost = sum(ord_.penalty_per_unit * shortfall[j] for j, ord_ in enumerate(orders))
    action_cost = sum(
        cand.unit_cost * sum(cand_assign[(k, j)] for j in range(n_orders))
        for k, cand in enumerate(candidates)
    )
    model.minimize(penalty_cost + action_cost)

    # ---- solve ----
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit
    status = solver.Solve(model)

    return solver, status, src_assign, cand_assign, shortfall


def _run_solve(req: SolveRequest) -> SolveResponse:
    t0 = time.perf_counter()

    # --- baseline: no candidates ---
    b_solver, b_status, b_src, b_cand, b_sf = _build_and_solve(
        req.orders, req.sources, req.candidates, req.time_limit, candidates_only=True
    )
    b_status_name = b_solver.StatusName(b_status)
    if b_status_name not in ("OPTIMAL", "FEASIBLE"):
        baseline_obj = sum(o.quantity * o.penalty_per_unit for o in req.orders)
    else:
        baseline_obj = int(b_solver.ObjectiveValue())

    # --- full solve ---
    f_solver, f_status, f_src, f_cand, f_sf = _build_and_solve(
        req.orders, req.sources, req.candidates, req.time_limit, candidates_only=False
    )
    status_name = f_solver.StatusName(f_status)

    solve_ms = (time.perf_counter() - t0) * 1000

    status_map = {
        "OPTIMAL": "OPTIMAL",
        "FEASIBLE": "FEASIBLE",
        "INFEASIBLE": "INFEASIBLE",
        "UNKNOWN": "UNKNOWN",
        "MODEL_INVALID": "UNKNOWN",
    }
    out_status: Literal["OPTIMAL", "FEASIBLE", "INFEASIBLE", "UNKNOWN"] = status_map.get(
        status_name, "UNKNOWN"
    )  # type: ignore[assignment]

    if out_status in ("INFEASIBLE", "UNKNOWN"):
        return SolveResponse(
            status=out_status,
            actions=[],
            per_order=[
                PerOrderOutcome(
                    code=o.code,
                    on_time_units=0,
                    backordered_units=o.quantity,
                    delay_hours=0.0,
                )
                for o in req.orders
            ],
            objective=baseline_obj,
            baseline_objective=baseline_obj,
            collateral=[o.code for o in req.orders],
            solve_ms=round(solve_ms, 1),
        )

    # Extract solution
    actions: list[ActionOut] = []
    n_orders = len(req.orders)
    n_sources = len(req.sources)

    for k, cand in enumerate(req.candidates):
        for j, ord_ in enumerate(req.orders):
            units = int(f_solver.Value(f_cand[(k, j)]))
            if units > 0:
                ref = cand.donor or cand.supplier or cand.via_warehouse or "?"
                actions.append(
                    ActionOut(
                        type=cand.type,
                        ref=ref,
                        sku=cand.sku,
                        units=units,
                        lead_hours=cand.lead_hours,
                        unit_cost=cand.unit_cost,
                        total_cost=units * cand.unit_cost,
                        target_order=ord_.code,
                    )
                )

    per_order: list[PerOrderOutcome] = []
    collateral: list[str] = []
    for j, ord_ in enumerate(req.orders):
        sf = int(f_solver.Value(f_sf[j]))
        on_time = ord_.quantity - sf
        if sf == ord_.quantity:
            collateral.append(ord_.code)
        per_order.append(
            PerOrderOutcome(
                code=ord_.code,
                on_time_units=on_time,
                backordered_units=sf,
                delay_hours=0.0 if sf == 0 else ord_.due_hours_from_now,
            )
        )

    objective = int(f_solver.ObjectiveValue())

    return SolveResponse(
        status=out_status,
        actions=actions,
        per_order=per_order,
        objective=objective,
        baseline_objective=baseline_obj,
        collateral=collateral,
        solve_ms=round(solve_ms, 1),
    )


@app.post("/solve", response_model=SolveResponse)
def solve(req: SolveRequest) -> SolveResponse:
    try:
        return _run_solve(req)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
