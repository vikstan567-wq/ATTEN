// Bahut simple JSON-file based storage. Koi native module compile nahi hota,
// isliye ye hamesha deploy hoga (Render, Railway, kahin bhi).
// Chhote/medium scale attendance system ke liye ye kaafi hai.

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_FILE = path.join(__dirname, 'data.json');

// Fixed admin logins (as requested) — seeded automatically if not present.
// role 'it'    = full access, can create/edit/delete projects
// role 'admin' = must give a project code at login; sees ONLY that project's data
const DEFAULT_ADMINS = [
  { username: 'DHAVAL', password: 'AURA9999', role: 'admin' },
  { username: 'ADMIN', password: 'Admin123', role: 'admin' },
  { username: 'IT', password: 'IT@9999', role: 'it' }
];

function load() {
  if (!fs.existsSync(DB_FILE)) {
    const initial = {
      admins: [],
      projects: [],
      workers: [],
      attendance_logs: [],
      _counters: { admins: 0, projects: 0, workers: 0, attendance_logs: 0 }
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

let data = load();

function save() {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function nextId(table) {
  data._counters[table] = (data._counters[table] || 0) + 1;
  return data._counters[table];
}

function nowISO() {
  // India is UTC+5:30. We store wall-clock IST directly (not real UTC) so that
  // every displayed time, date-bucket, and "late" comparison is correct without
  // needing timezone conversion anywhere else in the app.
  const istMs = Date.now() + 5.5 * 60 * 60 * 1000;
  return new Date(istMs).toISOString().slice(0, 19).replace('T', ' ');
}

function seedDefaultAdmins() {
  let changed = false;
  for (const acc of DEFAULT_ADMINS) {
    const exists = data.admins.find(a => a.username === acc.username);
    if (!exists) {
      const id = nextId('admins');
      data.admins.push({
        id,
        username: acc.username,
        password_hash: bcrypt.hashSync(acc.password, 10),
        role: acc.role,
        created_at: nowISO()
      });
      changed = true;
    } else if (!exists.role) {
      // Patch older records (created before roles existed) with the right role
      exists.role = acc.role;
      changed = true;
    }
  }
  if (changed) save();
}
seedDefaultAdmins();

// ---------- generic helpers ----------
function insert(table, row) {
  const id = nextId(table);
  const record = { id, ...row, created_at: nowISO() };
  data[table].push(record);
  save();
  return record;
}

function findAll(table, predicate) {
  const rows = data[table];
  return predicate ? rows.filter(predicate) : rows.slice();
}

function findOne(table, predicate) {
  return data[table].find(predicate) || null;
}

function updateById(table, id, changes) {
  const row = data[table].find(r => r.id === Number(id));
  if (!row) return null;
  Object.assign(row, changes);
  save();
  return row;
}

function deleteWhere(table, predicate) {
  const before = data[table].length;
  data[table] = data[table].filter(r => !predicate(r));
  save();
  return before - data[table].length;
}

function reload() { data = load(); }

module.exports = { data, insert, findAll, findOne, updateById, deleteWhere, save, nowISO, reload };
