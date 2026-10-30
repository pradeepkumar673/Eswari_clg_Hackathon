import http from 'node:http';
import WebSocket from 'ws';
import jwt from 'jsonwebtoken';
import { app } from '../apps/api/src/app.js';
import { connectDB } from '../apps/api/src/db.js';
import { config } from '../apps/api/src/config.js';
import { initWebSocketServer, closeWebSocketServer } from '../apps/api/src/services/websocket.js';
import { User } from '../apps/api/src/models/users.js';

async function main() {
  console.log('--- Verifying WebSocket Server ---');
  await connectDB();
  const server = http.createServer(app);
  initWebSocketServer(server);

  const port = await new Promise<number>((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 4000);
    });
  });

  const wsUrl = `ws://127.0.0.1:${port}/ws`;
  console.log(`WebSocket server listening at ${wsUrl}`);

  // Test 1: Unauthenticated connection closes on timeout or non-auth message
  console.log('\n1. Testing unauthenticated message rejection:');
  const wsBad = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    wsBad.on('open', () => {
      console.log('  Connected. Sending invalid first message...');
      wsBad.send(JSON.stringify({ type: 'subscribe', topic: 'tracking' }));
    });
    wsBad.on('close', (code, reason) => {
      console.log(`  ✓ Unauthenticated connection closed as expected: code=${code}, reason=${reason.toString()}`);
      resolve();
    });
    wsBad.on('error', (err) => reject(err));
  });

  // Test 2: Authenticated connection with DRIVER token
  console.log('\n2. Testing authenticated connection with DRIVER token:');
  const drvUser = await User.findOne({ username: 'drv1' }).lean();
  if (!drvUser) throw new Error('drv1 user not found in database');

  const token = jwt.sign(
    { sub: drvUser._id.toString(), username: 'drv1', role: 'DRIVER', driver_id: 'DRV-1', truck_id: 'SHP-204' },
    config.JWT_SECRET,
  );

  const wsAuth = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    wsAuth.on('open', () => {
      console.log('  Connected. Sending auth message...');
      wsAuth.send(JSON.stringify({ type: 'auth', token }));
    });
    wsAuth.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      console.log(`  ✓ Received server message:`, msg);
      if (msg.type === 'auth_ok' && (msg.role === 'DRIVER' || msg.user?.role === 'DRIVER')) {
        console.log('  ✓ Authenticated connection accepted!');
        wsAuth.close();
        resolve();
      }
    });
    wsAuth.on('error', (err) => reject(err));
  });

  await closeWebSocketServer();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  process.exit(0);
}

main().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
