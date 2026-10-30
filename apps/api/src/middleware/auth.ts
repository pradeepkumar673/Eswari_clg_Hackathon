/**
 * apps/api/src/middleware/auth.ts
 *
 * Authentication, authorization, and permission checking middleware.
 * - Re-reads the user from MongoDB on every request so role updates take effect instantly.
 * - Enforces the role-permission matrix with warehouse-scoping for Warehouse_Operator.
 * - Enforces driver-scoping for DRIVER and supplier-scoping for SUPPLIER.
 * - Automatically writes an append-only audit log entry (ACCESS_DENIED) on 401 / 403.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { User, IUser } from '../models/users.js';
import { Warehouse } from '../models/warehouses.js';
import { Capability, hasPermission, ROLE_PERMISSIONS, Role } from '@disruptioniq/shared';
import { writeAudit } from '../services/audit.js';

export interface AuthenticatedUser {
  _id: mongoose.Types.ObjectId;
  id: string;
  username: string;
  role: Role;
  warehouse_id: mongoose.Types.ObjectId | null;
  driver_id: string | null;
  truck_id: string | null;
  supplier_id: string | null;
  display_name: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      rawBody?: string;
      permissionRequired?: Capability;
    }
  }
}

/**
 * Validates JWT token and loads live user record from MongoDB.
 */
export async function authenticateToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    await logAccessDenied(req, 'Missing or malformed Authorization header');
    res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as {
      sub: string;
      username: string;
      role: Role;
      warehouse_id: string | null;
      driver_id?: string | null;
      truck_id?: string | null;
      supplier_id?: string | null;
    };

    // Re-read user from DB on every request (changed role takes effect immediately)
    const userDoc = await User.findById(payload.sub).lean();
    if (!userDoc) {
      await logAccessDenied(req, 'User account no longer exists');
      res.status(401).json({ error: 'Unauthorized', message: 'User not found' });
      return;
    }

    req.user = {
      _id: userDoc._id,
      id: userDoc._id.toString(),
      username: userDoc.username,
      role: userDoc.role,
      warehouse_id: userDoc.warehouse_id,
      driver_id: userDoc.driver_id || null,
      truck_id: userDoc.truck_id || null,
      supplier_id: userDoc.supplier_id || null,
      display_name: userDoc.display_name,
    };

    next();
  } catch (err: any) {
    await logAccessDenied(req, `Invalid or expired token: ${err.message}`);
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired token' });
  }
}

/**
 * Middleware factory requiring a specific Capability from the shared permission matrix.
 */
export function requirePermission(capability: Capability) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    req.permissionRequired = capability;

    if (!req.user) {
      // Must be authenticated first
      await logAccessDenied(req, 'Unauthenticated access attempt');
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
      return;
    }

    // 1. Check capability
    if (!hasPermission(req.user.role, capability)) {
      await logAccessDenied(
        req,
        `Role '${req.user.role}' lacks capability '${capability}'`,
        capability,
      );
      res.status(403).json({
        error: 'Forbidden',
        message: `Role '${req.user.role}' is not authorized for capability '${capability}'`,
      });
      return;
    }

    // 2. Check warehouse scoping for Warehouse_Operator
    const permDef = ROLE_PERMISSIONS[capability];
    if (req.user.role === 'Warehouse_Operator' && permDef?.warehouseScoped) {
      const targetWarehouse =
        req.params.warehouseId ||
        req.body?.warehouse_id ||
        (req.query?.warehouse_id as string | undefined);

      if (targetWarehouse && req.user.warehouse_id) {
        const userWhStr = req.user.warehouse_id.toString();
        const targetWhStr = targetWarehouse.toString();

        let isMatch = userWhStr === targetWhStr;
        if (!isMatch) {
          const whDoc = await Warehouse.findById(req.user.warehouse_id).lean();
          if (whDoc && whDoc.code === targetWhStr) {
            isMatch = true;
          }
        }

        if (!isMatch) {
          await logAccessDenied(
            req,
            `Operator warehouse mismatch: user ${userWhStr} attempted action on warehouse ${targetWhStr}`,
            capability,
          );
          res.status(403).json({
            error: 'Forbidden',
            message: 'Warehouse Operator is restricted to their assigned warehouse',
          });
          return;
        }
      }
    }

    // 3. Check driver scoping for DRIVER
    if (req.user.role.toUpperCase() === 'DRIVER') {
      const requestedDriver =
        req.params.driverId ||
        req.body?.driver_id ||
        (req.query?.driver_id as string | undefined);
      const requestedTruck =
        req.params.truckId ||
        req.body?.truck_id ||
        (req.query?.truck_id as string | undefined);

      if (requestedDriver && req.user.driver_id && requestedDriver !== req.user.driver_id) {
        await logAccessDenied(
          req,
          `Driver mismatch: user ${req.user.driver_id} requested data for ${requestedDriver}`,
          capability,
        );
        res.status(403).json({
          error: 'Forbidden',
          message: 'Driver is restricted to own truck and tracking data',
        });
        return;
      }

      if (requestedTruck && req.user.truck_id && requestedTruck !== req.user.truck_id) {
        await logAccessDenied(
          req,
          `Truck mismatch: user ${req.user.truck_id} requested data for ${requestedTruck}`,
          capability,
        );
        res.status(403).json({
          error: 'Forbidden',
          message: 'Driver is restricted to own truck and tracking data',
        });
        return;
      }
    }

    // 4. Check supplier scoping for SUPPLIER
    if (req.user.role.toUpperCase() === 'SUPPLIER') {
      const requestedSupplier =
        req.params.supplierId ||
        req.body?.supplier_id ||
        (req.query?.supplier_id as string | undefined);

      if (requestedSupplier && req.user.supplier_id && requestedSupplier !== req.user.supplier_id) {
        await logAccessDenied(
          req,
          `Supplier mismatch: user ${req.user.supplier_id} requested data for ${requestedSupplier}`,
          capability,
        );
        res.status(403).json({
          error: 'Forbidden',
          message: 'Supplier is restricted to own claims and data',
        });
        return;
      }
    }

    next();
  };
}

/**
 * Middleware factory requiring any of the specified capabilities.
 */
export function requireAnyPermission(capabilities: Capability[]) {
  const fn = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    req.permissionRequired = capabilities.join('|') as any;

    if (!req.user) {
      await logAccessDenied(req, 'Unauthenticated access attempt');
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
      return;
    }

    const hasAny = capabilities.some((cap) => hasPermission(req.user!.role, cap));
    if (!hasAny) {
      await logAccessDenied(
        req,
        `Role '${req.user.role}' lacks any of '${capabilities.join('|')}'`,
        capabilities[0],
      );
      res.status(403).json({
        error: 'Forbidden',
        message: `Role '${req.user.role}' is not authorized`,
      });
      return;
    }

    // Scoping for DRIVER
    if (req.user.role.toUpperCase() === 'DRIVER') {
      const requestedDriver =
        req.params.driverId ||
        req.body?.driver_id ||
        (req.query?.driver_id as string | undefined);
      if (requestedDriver && req.user.driver_id && requestedDriver !== req.user.driver_id) {
        await logAccessDenied(
          req,
          `Driver mismatch: user ${req.user.driver_id} requested data for ${requestedDriver}`,
          capabilities[0],
        );
        res.status(403).json({
          error: 'Forbidden',
          message: 'Driver is restricted to own truck and tracking data',
        });
        return;
      }
    }

    // Scoping for SUPPLIER
    if (req.user.role.toUpperCase() === 'SUPPLIER') {
      const requestedSupplier =
        req.params.supplierId ||
        req.body?.supplier_id ||
        (req.query?.supplier_id as string | undefined);
      if (requestedSupplier && req.user.supplier_id && requestedSupplier !== req.user.supplier_id) {
        await logAccessDenied(
          req,
          `Supplier mismatch: user ${req.user.supplier_id} requested data for ${requestedSupplier}`,
          capabilities[0],
        );
        res.status(403).json({
          error: 'Forbidden',
          message: 'Supplier is restricted to own claims and data',
        });
        return;
      }
    }

    next();
  };

  Object.defineProperty(fn, 'name', { value: 'requirePermission' });
  return fn;
}

/**
 * Helper to record ACCESS_DENIED audit log without leaking sensitive secrets.
 */
async function logAccessDenied(
  req: Request,
  reason: string,
  capability?: Capability,
): Promise<void> {
  try {
    await writeAudit({
      actor: req.user?._id || null,
      action: 'ACCESS_DENIED',
      entityType: 'AUTH',
      entityId: capability || req.path,
      before: null,
      after: {
        reason,
        path: req.originalUrl || req.path,
        method: req.method,
        ip: req.ip,
        capability: capability || null,
        username: req.user?.username || null,
        role: req.user?.role || null,
      },
      correlationId: 'auth',
      stepType: 'ACCESS_CONTROL',
    });
  } catch {
    // Fail silently so audit write error doesn't mask 401/403 response
  }
}
