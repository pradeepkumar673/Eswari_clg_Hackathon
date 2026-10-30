/**
 * apps/api/src/routes/imports.ts
 *
 * Import pipeline routes (M1, B11):
 *   POST   /imports                    — Upload CSV or JSON file
 *   GET    /imports/:id/quarantine     — View quarantined and conflicting rows
 *   PATCH  /imports/rows/:rowId        — Repair or discard a row
 *   POST   /imports/:id/commit         — Commit batch (idempotent)
 *   GET    /imports/:id/report         — Quality report
 */

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import {
  createImportBatch,
  getQuarantinedRows,
  patchImportRow,
  commitImportBatch,
  getImportReport,
} from '../services/importService.js';

export const importsRouter = Router();

// Store files in memory (max 10MB per import file)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['text/csv', 'application/json', 'text/plain', 'application/octet-stream'];
    const allowedExts = ['.csv', '.json'];
    const ext = '.' + (file.originalname.split('.').pop() || '').toLowerCase();

    if (allowed.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV or JSON files are accepted'));
    }
  },
});

const ENTITY_TYPES = ['shipments', 'orders', 'inventory', 'supplier_skus', 'transfer_lanes'];

/**
 * POST /imports
 * Upload a CSV or JSON file for a specific entity type.
 */
importsRouter.post(
  '/',
  authenticateToken,
  requirePermission('import_csv_json'),
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { entity_type } = req.body as { entity_type?: string };

      if (!entity_type || !ENTITY_TYPES.includes(entity_type)) {
        res.status(400).json({
          error: 'INVALID_ENTITY_TYPE',
          message: `entity_type must be one of: ${ENTITY_TYPES.join(', ')}`,
        });
        return;
      }

      if (!req.file) {
        res.status(400).json({ error: 'NO_FILE', message: 'A file must be uploaded in the "file" field' });
        return;
      }

      const result = await createImportBatch({
        filename: req.file.originalname,
        buffer: req.file.buffer,
        entityType: entity_type,
        uploadedBy: req.user!._id,
      });

      if (result.status === 'FILE_ALREADY_IMPORTED') {
        res.status(200).json({
          status: 'FILE_ALREADY_IMPORTED',
          message: 'An identical file was already committed. No changes applied.',
          batch_id: result.batch._id,
        });
        return;
      }

      res.status(201).json({
        status: 'VALIDATED',
        batch_id: result.batch._id,
        report: result.report,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /imports/:id/quarantine
 * Lists quarantined and conflicting rows for review.
 */
importsRouter.get(
  '/:id/quarantine',
  authenticateToken,
  requirePermission('import_csv_json'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rows = await getQuarantinedRows(req.params.id);
      res.json({ rows: rows.map((r) => ({
        id: r._id,
        row_number: r.row_number,
        entity_type: r.entity_type,
        natural_key: r.natural_key,
        raw_data: r.raw_data,
        status: r.status,
        errors: r.import_errors,
      })) });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * PATCH /imports/rows/:rowId
 * Repair or discard an individual import row.
 * raw_data remains untouched; only repaired_data is updated.
 */
importsRouter.patch(
  '/rows/:rowId',
  authenticateToken,
  requirePermission('import_csv_json'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { action, repaired_data } = req.body as {
        action?: 'REPAIR' | 'DISCARD';
        repaired_data?: Record<string, unknown>;
      };

      if (!action || !['REPAIR', 'DISCARD'].includes(action)) {
        res.status(400).json({ error: 'INVALID_ACTION', message: 'action must be REPAIR or DISCARD' });
        return;
      }

      const row = await patchImportRow({
        rowId: req.params.rowId,
        action,
        repairedData: repaired_data,
        actor: req.user!._id,
      });

      res.json({
        id: row._id,
        row_number: row.row_number,
        status: row.status,
        errors: row.import_errors,
        repaired_data: row.repaired_data,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /imports/:id/commit
 * Transactionally loads VALID and REPAIRED rows into the database.
 * Idempotent — re-calling on an already committed batch returns 200 ALREADY_COMMITTED.
 */
importsRouter.post(
  '/:id/commit',
  authenticateToken,
  requirePermission('import_csv_json'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await commitImportBatch({
        batchId: req.params.id,
        actor: req.user!._id,
      });

      res.json({
        status: result.status,
        loaded_count: result.loadedCount,
        batch_id: result.batch._id,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /imports/:id/report
 * Returns the full quality report for an import batch (B11).
 */
importsRouter.get(
  '/:id/report',
  authenticateToken,
  requirePermission('view_import_report'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const report = await getImportReport(req.params.id);
      res.json(report);
    } catch (err) {
      next(err);
    }
  },
);

