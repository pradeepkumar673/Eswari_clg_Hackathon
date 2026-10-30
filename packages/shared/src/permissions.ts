/**
 * packages/shared/src/permissions.ts
 *
 * Authoritative role-permission matrix derived from Blueprint Section 12
 * and Step 19 Foundation requirements.
 * Defines capabilities, mapping to allowed roles, and warehouse-scoping requirements.
 */

export type Role =
  | 'Analyst'
  | 'Manager'
  | 'Warehouse_Operator'
  | 'Procurement_Approver'
  | 'Administrator'
  | 'DRIVER'
  | 'SUPPLIER';

export const ALL_ROLES: Role[] = [
  'Analyst',
  'Manager',
  'Warehouse_Operator',
  'Procurement_Approver',
  'Administrator',
  'DRIVER',
  'SUPPLIER',
];

export type Capability =
  | 'import_csv_json'
  | 'submit_field_report'
  | 'confirm_events'
  | 'view_disruptions'
  | 'manage_plans'
  | 'approve_reallocate_split'
  | 'approve_expedite_alt_supplier'
  | 'confirm_execution'
  | 'rollback'
  | 'manage_users_redteam'
  | 'read_audit'
  | 'resolve_allocation_conflict'
  | 'close_disruption'
  | 'set_guardrails'
  | 'clear_guardrail_escalation'
  | 'view_intelligence'
  | 'run_stress_test'
  | 'view_cockpit'
  | 'ask_the_desk'
  | 'run_detectors'
  | 'view_scorecards'
  | 'manage_delegations'
  | 'master_data_crud'
  | 'inventory_correction'
  | 'set_risk_and_thresholds'
  | 'view_import_report'
  | 'run_whatif'
  | 'ingest_text'
  | 'verify_audit_chain'
  | 'generate_customer_notices'
  | 'release_customer_notices'
  // Step 19 Foundation Capabilities
  | 'tracking.read.own'
  | 'tracking.read.warehouse'
  | 'tracking.read.all'
  | 'driver.ping'
  | 'driver.incident'
  | 'reroute.decide'
  | 'cctv.ingest'
  | 'cctv.view'
  | 'claim.read.own'
  | 'claim.respond'
  | 'claim.decide'
  | 'capacity.view'
  | 'zone.edit'
  | 'presence.read'
  | 'warehouse.read';

export interface PermissionDefinition {
  roles: Role[];
  warehouseScoped?: boolean;
  description: string;
}

export const ROLE_PERMISSIONS: Record<Capability, PermissionDefinition> = {
  import_csv_json: {
    roles: ['Analyst', 'Administrator'],
    description: 'Import shipments, orders, inventory via CSV or JSON',
  },
  submit_field_report: {
    roles: ['Analyst', 'Warehouse_Operator'],
    warehouseScoped: true,
    description: 'Submit field reports (voice/text) for inbound shipments',
  },
  confirm_events: {
    roles: ['Analyst', 'Manager', 'Warehouse_Operator'],
    warehouseScoped: true,
    description: 'Confirm draft events or resolve conflicting events',
  },
  view_disruptions: {
    roles: ['Analyst', 'Manager', 'Warehouse_Operator', 'Procurement_Approver', 'Administrator'],
    warehouseScoped: true,
    description: 'View active disruptions and at-risk orders',
  },
  manage_plans: {
    roles: ['Analyst', 'Manager'],
    description: 'Generate, edit, verify, and submit recovery plans',
  },
  approve_reallocate_split: {
    roles: ['Manager'],
    description: 'Approve plans with REALLOCATE and SPLIT actions',
  },
  approve_expedite_alt_supplier: {
    roles: ['Procurement_Approver'],
    description: 'Approve plans with EXPEDITE and ALT_SUPPLIER actions',
  },
  confirm_execution: {
    roles: ['Manager'],
    description: 'Confirm and execute approved recovery plans',
  },
  rollback: {
    roles: ['Manager'],
    description: 'Execute compensating ledger entries to roll back a plan',
  },
  manage_users_redteam: {
    roles: ['Administrator'],
    description: 'Manage users, security configurations, and run red-team suites',
  },
  read_audit: {
    roles: ['Analyst', 'Manager', 'Procurement_Approver', 'Administrator'],
    description: 'Query audit logs and view provenance records',
  },
  resolve_allocation_conflict: {
    roles: ['Manager'],
    description: 'Rule on competing plans in the Allocation Conflict Court',
  },
  close_disruption: {
    roles: ['Manager'],
    description: 'Mark disruption resolved and save playbook memory case',
  },
  set_guardrails: {
    roles: ['Manager', 'Administrator'],
    description: 'Update spending and service-level guardrail policy limits',
  },
  clear_guardrail_escalation: {
    roles: ['Manager', 'Procurement_Approver'],
    description: 'Approve and clear guardrail escalation triggers',
  },
  view_intelligence: {
    roles: ['Analyst', 'Manager', 'Procurement_Approver', 'Administrator'],
    description: 'View replay, lineage, fingerprints, playbook, and SPOF radar',
  },
  run_stress_test: {
    roles: ['Administrator'],
    description: 'Inject synthetic disruptions and chaos scenarios (demo mode)',
  },
  view_cockpit: {
    roles: ['Analyst', 'Manager', 'Warehouse_Operator', 'Procurement_Approver', 'Administrator'],
    warehouseScoped: true,
    description: 'View control tower dashboard, KPI strip, and network map',
  },
  ask_the_desk: {
    roles: ['Analyst', 'Manager', 'Warehouse_Operator', 'Procurement_Approver', 'Administrator'],
    warehouseScoped: true,
    description: 'Query natural-language Ask the Desk assistant (read-only)',
  },
  run_detectors: {
    roles: ['Analyst', 'Manager'],
    description: 'Acknowledge alerts and run late-shipment/stock detectors',
  },
  view_scorecards: {
    roles: ['Analyst', 'Manager', 'Procurement_Approver', 'Administrator'],
    description: 'Inspect supplier delay and on-time delivery scorecards',
  },
  manage_delegations: {
    roles: ['Manager', 'Procurement_Approver'],
    description: 'Delegate approval authority or request plan changes',
  },
  master_data_crud: {
    roles: ['Administrator'],
    description: 'Create and update warehouses, suppliers, and SKU master data',
  },
  inventory_correction: {
    roles: ['Manager', 'Administrator'],
    description: 'Submit audited stock adjustments through the ledger',
  },
  set_risk_and_thresholds: {
    roles: ['Manager', 'Administrator'],
    description: 'Set risk score bands (RED/AMBER/GREEN) and stock thresholds',
  },
  view_import_report: {
    roles: ['Analyst', 'Administrator'],
    description: 'View file-level import statistics and quarantine counts',
  },
  run_whatif: {
    roles: ['Analyst', 'Manager'],
    description: 'Run sandbox what-if simulations against read-only state',
  },
  ingest_text: {
    roles: ['Analyst', 'Warehouse_Operator'],
    warehouseScoped: true,
    description: 'Paste email or SMS text to create draft event cards',
  },
  verify_audit_chain: {
    roles: ['Analyst', 'Manager', 'Procurement_Approver', 'Administrator'],
    description: 'Recompute and verify SHA-256 cryptographic hash chains',
  },
  generate_customer_notices: {
    roles: ['Analyst', 'Manager'],
    description: 'Draft customer notices for delayed or split orders',
  },
  release_customer_notices: {
    roles: ['Manager'],
    description: 'Release verified customer notices to the simulated outbox',
  },

  // ── Step 19 Capabilities ──────────────────────────────────────────────────
  'tracking.read.own': {
    roles: ['DRIVER', 'Manager', 'Administrator'],
    description: 'Read own truck GPS position and reroute proposals',
  },
  'tracking.read.warehouse': {
    roles: ['Warehouse_Operator', 'Manager', 'Administrator'],
    warehouseScoped: true,
    description: 'Read live tracking for trucks in corridor feeding assigned warehouse',
  },
  'tracking.read.all': {
    roles: ['Analyst', 'Manager', 'Administrator'],
    description: 'Read all active driver pings, truck routes and tracking telemetry',
  },
  'driver.ping': {
    roles: ['DRIVER'],
    description: 'Submit GPS coordinate ping for own truck',
  },
  'driver.incident': {
    roles: ['DRIVER'],
    description: 'Submit breakdown, accident or delay incident report for own truck',
  },
  'reroute.decide': {
    roles: ['Manager'],
    description: 'Approve or reject automated truck reroute proposal (Supply Chain Manager only)',
  },
  'cctv.ingest': {
    roles: ['Warehouse_Operator', 'Analyst', 'Administrator'],
    warehouseScoped: true,
    description: 'Ingest CCTV video clips and trigger damage detection pipeline',
  },
  'cctv.view': {
    roles: ['Warehouse_Operator', 'Analyst', 'Manager', 'Administrator'],
    warehouseScoped: true,
    description: 'Inspect CCTV damage detection events, frames and evidence items',
  },
  'claim.read.own': {
    roles: ['SUPPLIER', 'Manager', 'Procurement_Approver', 'Administrator'],
    description: 'Read supplier claims scoped to own supplier_id',
  },
  'claim.respond': {
    roles: ['SUPPLIER'],
    description: 'Submit textual defense or acceptance response to supplier claim',
  },
  'claim.decide': {
    roles: ['Procurement_Approver', 'Manager', 'Administrator'],
    description: 'Adjudicate, accept, reject or escalate supplier claims',
  },
  'capacity.view': {
    roles: ['Warehouse_Operator', 'Analyst', 'Manager', 'Administrator'],
    warehouseScoped: true,
    description: 'View warehouse zone polygons, slot capacity and current occupancy',
  },
  'zone.edit': {
    roles: ['Manager', 'Administrator'],
    warehouseScoped: true,
    description: 'Create, modify and re-polygon warehouse operational zones (Manager and Admin only)',
  },
  'presence.read': {
    roles: ['Analyst', 'Manager', 'Warehouse_Operator', 'Administrator'],
    description: 'View live user presence across control tower desks and zones',
  },
  'warehouse.read': {
    roles: ALL_ROLES,
    description: 'Read the warehouse master list (codes, names, positions)',
  },
};

/**
 * Checks whether a given role possesses a specific capability.
 */
export function hasPermission(role: Role | string, capability: Capability): boolean {
  const perm = ROLE_PERMISSIONS[capability];
  if (!perm) return false;
  return perm.roles.includes(role as Role);
}

/**
 * Returns all capabilities granted to a specific role.
 */
export function getPermissionsForRole(role: Role | string): Capability[] {
  return (Object.keys(ROLE_PERMISSIONS) as Capability[]).filter((cap) =>
    hasPermission(role, cap)
  );
}
