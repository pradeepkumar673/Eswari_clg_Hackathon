/**
 * apps/api/src/middleware/routeCheck.ts
 *
 * Startup route permission self-check (Rule 160 / Step 4 req 8):
 * Enumerates all registered routes and throws an error if any non-public route
 * lacks a permission tag / requirePermission middleware.
 */

import { Express } from 'express';
import { logger } from '../logger.js';

export const PUBLIC_ROUTES = [
  'POST /auth/login',
  'POST /api/v1/auth/login',
  'POST /auth/demo-switch',
  'POST /api/v1/auth/demo-switch',
  'GET /auth/me',
  'GET /api/v1/auth/me',
  'GET /health',
  'GET /api/v1/health',
  'POST /webhooks/carrier/:source',
  'POST /api/v1/webhooks/carrier/:source',
  'GET /fixtures/sample-transcripts',
  'GET /api/v1/fixtures/sample-transcripts',
];

export interface DiscoveredRoute {
  method: string;
  path: string;
  hasPermission: boolean;
}

export function inspectAppRoutes(app: Express): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = [];

  function cleanPath(p: string): string {
    return ('/' + p).replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  }

  function walk(stack: any[], currentPath: string): void {
    if (!Array.isArray(stack)) return;

    for (const layer of stack) {
      if (layer.route) {
        const fullPath = cleanPath(currentPath + (layer.route.path || ''));
        const methods = Object.keys(layer.route.methods || {})
          .filter((m) => layer.route.methods[m])
          .map((m) => m.toUpperCase());

        const hasPerm = (layer.route.stack || []).some(
          (h: any) =>
            h.name === 'requirePermission' ||
            h.handle?.name === 'requirePermission' ||
            (h.handle && h.handle.toString().includes('permissionRequired')),
        );

        for (const method of methods) {
          routes.push({
            method,
            path: fullPath,
            hasPermission: hasPerm,
          });
        }
      } else if (layer.name === 'router' && layer.handle?.stack) {
        // Extract prefix from regex
        let prefix = '';
        if (layer.regexp) {
          const raw = layer.regexp.source || '';
          const cleaned = raw
            .replace('^\\', '')
            .replace('\\/?(?=\\/|$)', '')
            .replace(/\\\//g, '/')
            .replace(/[^a-zA-Z0-9_\-\/]/g, '');
          prefix = cleaned;
        }
        walk(layer.handle.stack, cleanPath(currentPath + '/' + prefix));
      }
    }
  }

  if (app._router?.stack) {
    walk(app._router.stack, '');
  }

  return routes;
}

export function verifyRoutePermissions(app: Express): void {
  const routes = inspectAppRoutes(app);
  const violations: string[] = [];

  for (const r of routes) {
    const routeKey = `${r.method} ${r.path}`;

    const isPublic = PUBLIC_ROUTES.some((pub) => {
      if (pub === routeKey) return true;
      const pubRegex = new RegExp(
        '^' + pub.replace(/:[a-zA-Z0-9_]+/g, '[^/]+') + '$',
      );
      return pubRegex.test(routeKey);
    });

    if (!isPublic && !r.hasPermission) {
      violations.push(routeKey);
    }
  }

  if (violations.length > 0) {
    logger.error(
      { violations },
      'Route permission self-check FAILED: Routes missing requirePermission',
    );
    throw new Error(
      `Route permission self-check failed: non-public routes lack requirePermission:\n${violations.join('\n')}`,
    );
  }

  logger.info({ routeCount: routes.length }, 'Route permission self-check passed');
}
