import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load .env
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/disruptioniq?replicaSet=rs0'),
  MONGODB_URI_READONLY: z.string().default('mongodb://127.0.0.1:27017/disruptioniq?replicaSet=rs0'),
  MONGODB_URI_ADMIN: z.string().default('mongodb://127.0.0.1:27017/disruptioniq?replicaSet=rs0'),
  JWT_SECRET: z.string().min(16).default('disruptioniq_super_secret_jwt_key_at_least_32_chars!'),
  WEBHOOK_SECRET: z.string().default('disruptioniq_carrier_webhook_secret_key_123'),
  SOLVER_URL: z.string().url().default('http://127.0.0.1:8000'),
  GROQ_API_KEY: z.string().optional(),
  SIM_NOW: z.string().optional(),
  DEMO_MODE: z.preprocess((val) => val === 'true' || val === true, z.boolean().default(true)),
  DEMO_PASSWORD: z.string().default('demo_recovery_2026'),
  // Step 19 Config
  MAP_TILE_URL: z.string().default(''),
  GEOFENCE_RADIUS_M: z.coerce.number().default(2000),
  SIM_TRUCK_KMH: z.coerce.number().default(50),
  CCTV_EVIDENCE_DIR: z.string().default('./.data/evidence'),
  VISION_URL: z.string().url().default('http://127.0.0.1:8010'),
});

export const config = ConfigSchema.parse(process.env);
