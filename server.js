require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const store = require('./db/store');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/workers', require('./routes/workers'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/track', require('./routes/tracking'));

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await store.getDb(); // fail fast with a clear error if MONGODB_URI is wrong
    await store.seedDefaultAdmins();
    app.listen(PORT, () => console.log(`Attendance server running on port ${PORT}`));
  } catch (err) {
    console.error('❌ Failed to start server (check MONGODB_URI):', err.message);
    process.exit(1);
  }
}

start();
