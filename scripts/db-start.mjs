import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

const MONGOD_PATH = 'C:\\Program Files\\MongoDB\\Server\\8.3\\bin\\mongod.exe';
const DATA_DIR = path.resolve('.data/mongo');
const LOG_FILE = path.resolve('.data/mongo/mongod.log');
const PORT = 27017;
const REPL_SET = 'rs0';

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function checkPort(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      resolve(false);
    });
    socket.connect(port, '127.0.0.1');
  });
}

async function startMongod() {
  const isRunning = await checkPort(PORT);
  if (isRunning) {
    console.log(`Port ${PORT} is active.`);
    return;
  }

  // Remove diagnostic data if exists to prevent FTDC crash
  const diagDir = path.join(DATA_DIR, 'diagnostic.data');
  if (fs.existsSync(diagDir)) {
    try {
      fs.rmSync(diagDir, { recursive: true, force: true });
    } catch (_) {}
  }

  console.log(`Starting mongod on port ${PORT} with replSet ${REPL_SET}...`);
  // On Windows, use PowerShell Start-Process with array args to keep it persistent in background
  const psCmd = `Start-Process -FilePath '${MONGOD_PATH}' -ArgumentList @('--dbpath', '${DATA_DIR}', '--port', '${PORT}', '--replSet', '${REPL_SET}', '--bind_ip', '127.0.0.1', '--logpath', '${LOG_FILE}', '--setParameter', 'diagnosticDataCollectionEnabled=false') -WindowStyle Hidden`;
  execSync(`powershell -NoProfile -Command "${psCmd}"`);

  let ready = false;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    ready = await checkPort(PORT);
    if (ready) break;
  }

  if (!ready) {
    console.error(`Failed to start mongod on port ${PORT}`);
    process.exit(1);
  }
  console.log(`MongoDB started successfully on port ${PORT}`);
}

async function initiateReplicaSet() {
  try {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(`mongodb://127.0.0.1:${PORT}/?directConnection=true`, {
      serverSelectionTimeoutMS: 5000,
    });
    await client.connect();
    const admin = client.db('admin');

    try {
      const status = await admin.command({ replSetGetStatus: 1 });
      console.log(`Replica set "${status.set}" is active (state ${status.myState}).`);
      return true;
    } catch (err) {
      if (err.message && (err.message.includes('no replset config') || err.message.includes('NotYetInitialized'))) {
        console.log(`Initiating replica set "${REPL_SET}"...`);
        await admin.command({
          replSetInitiate: {
            _id: REPL_SET,
            members: [{ _id: 0, host: `127.0.0.1:${PORT}` }],
          },
        });
        console.log(`Replica set "${REPL_SET}" initiated successfully. Waiting for primary...`);
        for (let i = 0; i < 15; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          const s = await admin.command({ hello: 1 });
          if (s.isWritablePrimary) {
            console.log('Node is now PRIMARY.');
            return true;
          }
        }
      } else if (err.message && err.message.includes('not running with --replSet')) {
        console.error(`\n❌ CONFLICT DETECTED: MongoDB is running on port ${PORT}, but as a STANDALONE server without '--replSet ${REPL_SET}'.`);
        console.error(`The Windows service 'MongoDB Server (MongoDB)' is holding port ${PORT}.`);
        console.error(`\nTo resolve this:`);
        console.error(`  1. Open PowerShell as Administrator and run:`);
        console.error(`     Stop-Service MongoDB`);
        console.error(`     Set-Service MongoDB -StartupType Manual`);
        console.error(`     (Or open 'services.msc' -> stop 'MongoDB Server (MongoDB)')`);
        console.error(`  2. Then run: npm run db:start\n`);
        throw new Error(`Port ${PORT} is occupied by standalone MongoDB without --replSet ${REPL_SET}`);
      } else {
        console.log('ReplSet status:', err.message);
        throw err;
      }
    } finally {
      await client.close();
    }
  } catch (err) {
    console.error('Replica set initialization failed:', err.message);
    throw err;
  }
}

async function main() {
  await startMongod();
  await initiateReplicaSet();
  console.log('MongoDB single-node replica set is ready and healthy.');
}

main().catch((err) => {
  console.error('db:start error:', err);
  process.exit(1);
});
