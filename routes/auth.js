const express = require('express');
const bcrypt = require('bcryptjs');
const store = require('../db/store');
const { signAdminToken } = require('../utils');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const admin = store.findOne('admins', a => a.username === username);
  if (!admin || !bcrypt.compareSync(password || '', admin.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const token = signAdminToken(admin);
  res.json({ token, username: admin.username });
});

// Kept for compatibility — admins are now pre-seeded, so this always reports setupDone.
router.get('/status', (req, res) => {
  res.json({ setupDone: true });
});

module.exports = router;
