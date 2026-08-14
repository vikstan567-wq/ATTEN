// Persistent storage using MongoDB Atlas (free tier) — this survives Render
// restarts/spin-downs, unlike a local JSON file which gets wiped every time
// the free-tier server restarts (which happens after ~15 min of inactivity).

const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is not set. Add it in Render → Environment Variables.');
}

let client;
let dbPromise;

function getDb() {
  if (!dbPromise) {
    client = new MongoClient(MONGODB_URI);
    dbPromise = client.connect().then(c => c.db('maswer_attend'));
  }
  return dbPromise;
}

function nowISO() {
  // India is UTC+5:30. We store wall-clock IST directly (not real UTC) so that
  // every displayed time, date-bucket, and "late" comparison is correct without
  // needing timezone conversion anywhere else in the app.
  const istMs = Date.now() + 5.5 * 60 * 60 * 1000;
  return new Date(istMs).toISOString().slice(0, 19).replace('T', ' ');
}

async function nextId(table) {
  const db = await getDb();
  const result = await db.collection('counters').findOneAndUpdate(
    { _id: table },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return result.seq;
}

function stripMongoId(doc) {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest;
}

async function insert(table, row) {
  const db = await getDb();
  const id = await nextId(table);
  const record = { id, ...row, created_at: nowISO() };
  await db.collection(table).insertOne({ ...record });
  return record;
}

async function findAll(table, predicate) {
  const db = await getDb();
  const docs = await db.collection(table).find({}).toArray();
  const clean = docs.map(stripMongoId);
  return predicate ? clean.filter(predicate) : clean;
}

async function findOne(table, predicate) {
  const all = await findAll(table);
  return all.find(predicate) || null;
}

async function updateById(table, id, changes) {
  const db = await getDb();
  await db.collection(table).updateOne({ id: Number(id) }, { $set: changes });
  return findOne(table, r => r.id === Number(id));
}

async function deleteWhere(table, predicate) {
  const matching = await findAll(table, predicate);
  if (matching.length === 0) return 0;
  const db = await getDb();
  const ids = matching.map(r => r.id);
  const result = await db.collection(table).deleteMany({ id: { $in: ids } });
  return result.deletedCount;
}

// Fixed admin logins — seeded automatically if not present.
// role 'it'    = full access, can create/edit/delete projects
// role 'admin' = must give a project code at login; sees ONLY that project's data
const DEFAULT_ADMINS = [
  { username: 'DHAVAL', password: 'AURA9999', role: 'admin' },
  { username: 'ADMIN', password: 'Admin123', role: 'admin' },
  { username: 'IT', password: 'IT@9999', role: 'it' }
];

async function seedDefaultAdmins() {
  const existingAdmins = await findAll('admins');
  for (const acc of DEFAULT_ADMINS) {
    const exists = existingAdmins.find(a => a.username === acc.username);
    if (!exists) {
      await insert('admins', {
        username: acc.username,
        password_hash: bcrypt.hashSync(acc.password, 10),
        role: acc.role
      });
    } else if (!exists.role) {
      await updateById('admins', exists.id, { role: acc.role });
    }
  }
}

module.exports = { insert, findAll, findOne, updateById, deleteWhere, nowISO, seedDefaultAdmins, getDb };
