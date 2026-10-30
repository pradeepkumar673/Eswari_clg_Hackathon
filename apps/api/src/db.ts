import mongoose from 'mongoose';
import { config } from './config.js';
import { logger } from './logger.js';

export async function connectDB(): Promise<typeof mongoose> {
  try {
    const conn = await mongoose.connect(config.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000
    });
    logger.info('Connected to MongoDB');
    return conn;
  } catch (err: any) {
    logger.error({ err }, 'Failed to connect to MongoDB');
    throw err;
  }
}

export async function checkTransactionsSupported(): Promise<boolean> {
  try {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      await session.abortTransaction();
      return true;
    } catch {
      return false;
    } finally {
      await session.endSession();
    }
  } catch {
    return false;
  }
}

