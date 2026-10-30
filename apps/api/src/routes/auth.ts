/**
 * apps/api/src/routes/auth.ts
 *
 * Authentication routes:
 *  - POST /auth/login: bcrypt verification and JWT generation
 *  - GET /auth/me: live role and full permission list derived from shared matrix
 *  - POST /auth/demo-switch: switch to any seeded demo identity (DEMO_MODE only)
 */

import { Router, Request, Response } from 'express';
import bcryptjs from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { User } from '../models/users.js';
import { getPermissionsForRole, Role } from '@disruptioniq/shared';
import { authenticateToken } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';

export const authRouter = Router();

/**
 * Public login endpoint.
 */
authRouter.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    res.status(400).json({ error: 'Bad Request', message: 'Username and password are required' });
    return;
  }

  const user = await User.findOne({ username }).lean();
  if (!user) {
    await writeAudit({
      actor: null,
      action: 'ACCESS_DENIED',
      entityType: 'AUTH',
      entityId: username,
      before: null,
      after: { reason: 'User not found', username },
      correlationId: 'auth',
      stepType: 'LOGIN',
    });
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid username or password' });
    return;
  }

  const isMatch = await bcryptjs.compare(password, user.password_hash);
  if (!isMatch) {
    await writeAudit({
      actor: user._id,
      action: 'ACCESS_DENIED',
      entityType: 'AUTH',
      entityId: username,
      before: null,
      after: { reason: 'Invalid password', username },
      correlationId: 'auth',
      stepType: 'LOGIN',
    });
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid username or password' });
    return;
  }

  const token = jwt.sign(
    {
      sub: user._id.toString(),
      username: user.username,
      role: user.role,
      warehouse_id: user.warehouse_id ? user.warehouse_id.toString() : null,
    },
    config.JWT_SECRET,
    { expiresIn: '24h' },
  );

  await writeAudit({
    actor: user._id,
    action: 'USER_LOGIN',
    entityType: 'USER',
    entityId: user._id.toString(),
    before: null,
    after: { username: user.username, role: user.role },
    correlationId: 'auth',
    stepType: 'LOGIN',
  });

  res.json({
    token,
    user: {
      id: user._id.toString(),
      username: user.username,
      display_name: user.display_name,
      role: user.role,
      warehouse_id: user.warehouse_id ? user.warehouse_id.toString() : null,
      permissions: getPermissionsForRole(user.role as Role),
    },
  });
});

/**
 * Returns current user profile with live permissions.
 */
authRouter.get('/me', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const user = req.user!;
  res.json({
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    warehouse_id: user.warehouse_id ? user.warehouse_id.toString() : null,
    permissions: getPermissionsForRole(user.role),
    demo_mode: config.DEMO_MODE,
  });
});

/**
 * Demo role switcher (allowed only when DEMO_MODE=true).
 */
authRouter.post('/demo-switch', async (req: Request, res: Response): Promise<void> => {
  if (!config.DEMO_MODE) {
    res.status(403).json({ error: 'Forbidden', message: 'Demo mode is not enabled' });
    return;
  }

  const { role, username } = req.body || {};
  if (!role && !username) {
    res.status(400).json({ error: 'Bad Request', message: 'Either role or username must be specified' });
    return;
  }

  const query: Record<string, unknown> = {};
  if (username) query.username = username;
  else if (role) query.role = role;

  const user = await User.findOne(query).lean();
  if (!user) {
    res.status(404).json({ error: 'Not Found', message: `No demo user found matching ${JSON.stringify(query)}` });
    return;
  }

  const token = jwt.sign(
    {
      sub: user._id.toString(),
      username: user.username,
      role: user.role,
      warehouse_id: user.warehouse_id ? user.warehouse_id.toString() : null,
    },
    config.JWT_SECRET,
    { expiresIn: '24h' },
  );

  await writeAudit({
    actor: user._id,
    action: 'DEMO_ROLE_SWITCH',
    entityType: 'USER',
    entityId: user._id.toString(),
    before: null,
    after: { username: user.username, role: user.role },
    correlationId: 'demo',
    stepType: 'SWITCH',
  });

  res.json({
    token,
    user: {
      id: user._id.toString(),
      username: user.username,
      display_name: user.display_name,
      role: user.role,
      warehouse_id: user.warehouse_id ? user.warehouse_id.toString() : null,
      permissions: getPermissionsForRole(user.role as Role),
    },
  });
});
