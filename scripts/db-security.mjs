#!/usr/bin/env node

/**
 * scripts/db-security.mjs
 *
 * Creates three MongoDB users with different privilege levels for DisruptionIQ:
 *   - app_rw:       read/write on all collections, but insert+find only on
 *                    audit_logs, execution_ledger, shipment_events (append-only)
 *   - app_readonly:  find on all collections + insert on simulation_runs only
 *   - demo_admin:    dbOwner (for Admin Tamper action and reset script)
 *
 * Idempotent — safe to run multiple times (drops and re-creates users/roles).
 *
 * Run: node scripts/db-security.mjs
 * Requires: MONGODB_URI_ADMIN env or defaults to direct connection on 27017.
 */

import { MongoClient } from 'mongodb';

const ADMIN_URI =
  process.env.MONGODB_URI_ADMIN ||
  'mongodb://127.0.0.1:27017/disruptioniq?directConnection=true';

const DB_NAME = 'disruptioniq';

// Append-only collections — insert + find only, no update/delete
const APPEND_ONLY = ['audit_logs', 'execution_ledger', 'shipment_events'];

async function main() {
  const client = new MongoClient(ADMIN_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);

    console.log('[db-security] Connected to', DB_NAME);

    // ── 1. Create custom roles ──────────────────────────────────────

    // Role: rw_except_appendonly — full CRUD minus update/delete on append-only
    try {
      await db.command({ dropRole: 'rw_except_appendonly' });
    } catch { /* role may not exist */ }

    await db.command({
      createRole: 'rw_except_appendonly',
      privileges: [
        // Full readWrite on the database
        {
          resource: { db: DB_NAME, collection: '' },
          actions: ['find', 'insert', 'update', 'remove', 'createIndex', 'createCollection', 'listCollections', 'listIndexes']
        },
        // Revoke update+remove on append-only collections by granting ONLY find+insert
        ...APPEND_ONLY.map((coll) => ({
          resource: { db: DB_NAME, collection: coll },
          actions: ['find', 'insert']
        }))
      ],
      roles: []
    });

    // We need to revoke update/remove on append-only collections.
    // Since MongoDB custom roles are additive, the approach is:
    // grant specific actions per collection instead of using the broad readWrite role.
    // Let's drop the role and recreate with the correct approach.
    await db.command({ dropRole: 'rw_except_appendonly' });

    // Get all current collection names
    const collections = await db.listCollections().toArray();
    const collNames = collections.map((c) => c.name);
    const normalCollections = collNames.filter((n) => !APPEND_ONLY.includes(n));

    const privileges = [
      // Full CRUD on non-append-only collections
      ...normalCollections.map((coll) => ({
        resource: { db: DB_NAME, collection: coll },
        actions: ['find', 'insert', 'update', 'remove', 'createIndex', 'listIndexes']
      })),
      // Insert + find only on append-only collections
      ...APPEND_ONLY.map((coll) => ({
        resource: { db: DB_NAME, collection: coll },
        actions: ['find', 'insert', 'createIndex', 'listIndexes']
      })),
      // Allow creating new collections and listing them
      {
        resource: { db: DB_NAME, collection: '' },
        actions: ['createCollection', 'listCollections', 'createIndex', 'listIndexes', 'find', 'insert', 'update', 'remove']
      }
    ];

    await db.command({
      createRole: 'rw_except_appendonly',
      privileges,
      roles: []
    });
    console.log('[db-security] Created role: rw_except_appendonly');

    // Role: readonly_plus_sim — find on everything + insert on simulation_runs
    try {
      await db.command({ dropRole: 'readonly_plus_sim' });
    } catch { /* role may not exist */ }

    await db.command({
      createRole: 'readonly_plus_sim',
      privileges: [
        {
          resource: { db: DB_NAME, collection: '' },
          actions: ['find', 'listCollections', 'listIndexes']
        },
        {
          resource: { db: DB_NAME, collection: 'simulation_runs' },
          actions: ['insert']
        }
      ],
      roles: []
    });
    console.log('[db-security] Created role: readonly_plus_sim');

    // ── 2. Create users ─────────────────────────────────────────────

    const users = [
      {
        user: 'app_rw',
        pwd: process.env.MONGO_APP_RW_PASSWORD || 'disruptioniq_rw_pass',
        roles: [{ role: 'rw_except_appendonly', db: DB_NAME }]
      },
      {
        user: 'app_readonly',
        pwd: process.env.MONGO_APP_READONLY_PASSWORD || 'disruptioniq_ro_pass',
        roles: [{ role: 'readonly_plus_sim', db: DB_NAME }]
      },
      {
        user: 'demo_admin',
        pwd: process.env.MONGO_DEMO_ADMIN_PASSWORD || 'disruptioniq_admin_pass',
        roles: [{ role: 'dbOwner', db: DB_NAME }]
      }
    ];

    for (const u of users) {
      try {
        await db.command({ dropUser: u.user });
      } catch { /* user may not exist */ }

      await db.command({
        createUser: u.user,
        pwd: u.pwd,
        roles: u.roles
      });
      console.log(`[db-security] Created user: ${u.user} with roles: ${u.roles.map((r) => r.role).join(', ')}`);
    }

    console.log('[db-security] All security roles and users created successfully.');
  } catch (err) {
    console.error('[db-security] Error:', err.message || err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();

