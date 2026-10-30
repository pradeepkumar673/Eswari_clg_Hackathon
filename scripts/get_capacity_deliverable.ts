import mongoose from 'mongoose';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../apps/api/src/app.js';
import { config } from '../apps/api/src/config.js';
import { User } from '../apps/api/src/models/users.js';
import { seed } from '../apps/api/src/services/seedData.js';
import { ensureIndexes } from '../apps/api/src/models/index.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/disruptioniq_test?replicaSet=rs0';

async function run() {
  await mongoose.connect(MONGODB_URI);
  await ensureIndexes();
  await seed(MONGODB_URI, false);

  const manager = await User.findOne({ username: 'manager' });
  const token = jwt.sign(
    { sub: manager!._id, username: manager!.username, role: manager!.role },
    config.JWT_SECRET,
    { expiresIn: '1h' }
  );

  // 1. One stock assignment to ZN-HOS-STR: 20 units of SKU-101 (within 20 on_hand -> 2 slots)
  const assignRes = await request(app)
    .post('/api/v1/zones/ZN-HOS-STR/assignments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      sku_id: 'SKU-101',
      units: 20,
    });

  if (assignRes.status !== 200) {
    console.error('Assignment failed:', assignRes.status, assignRes.body);
  }

  // 2. One inbound plan to ZN-HOS-REC: 10 slots
  const planRes = await request(app)
    .post('/api/v1/capacity/inbound-plans')
    .set('Authorization', `Bearer ${token}`)
    .send({
      shipment_id: `SHP-HOS-DELIV-${Date.now()}`,
      zone_id: 'ZN-HOS-REC',
      slots: 10,
    });

  if (planRes.status !== 201) {
    console.error('Plan failed:', planRes.status, planRes.body);
  }

  // 3. GET /capacity/overview for WH-HOS
  const overviewRes = await request(app)
    .get('/api/v1/capacity/overview?warehouse_id=WH-HOS')
    .set('Authorization', `Bearer ${token}`);

  console.log('=== DELIVERABLE: GET /capacity/overview (WH-HOS) ===');
  console.log(JSON.stringify(overviewRes.body, null, 2));
  console.log('====================================================');

  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

