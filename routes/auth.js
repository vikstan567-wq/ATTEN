const express = require('express');
const bcrypt = require('bcryptjs');
const store = require('../db/store');
const { signAdminToken } = require('../utils');

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { username, password, project_code } = req.body;
    const admin = await store.findOne('admins', a => a.username === username);
    if (!admin || !bcrypt.compareSync(password || '', admin.password_hash)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (admin.role === 'it') {
      const token = signAdminToken(admin);
      return res.json({ token, username: admin.username, role: 'it' });
    }

    if (!project_code || !project_code.trim()) {
      return res.status(400).json({ error: 'Project number daalna zaroori hai' });
    }
    const project = await store.findOne('projects', p => p.project_code.toLowerCase() === project_code.trim().toLowerCase());
    if (!project) {
      return res.status(400).json({ error: 'Ye project number nahi mila' });
    }

    const token = signAdminToken(admin, project.id, project.project_code);
    res.json({
      token,
      username: admin.username,
      role: 'admin',
      project_id: project.id,
      project_code: project.project_code,
      project_name: project.project_name
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error, please try again' });
  }
});

router.get('/status', (req, res) => {
  res.json({ setupDone: true });
});

module.exports = router;
