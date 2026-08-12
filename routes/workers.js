const express = require('express');
const crypto = require('crypto');
const store = require('../db/store');
const { requireAdmin } = require('../utils');

const router = express.Router();
router.use(requireAdmin);

function withProjectInfo(w) {
  const project = store.findOne('projects', p => p.id === w.project_id);
  return { ...w, project_name: project ? project.project_name : null, project_code: project ? project.project_code : null };
}

router.get('/', (req, res) => {
  const { project_id } = req.query;
  let workers = store.findAll('workers', project_id ? w => w.project_id === Number(project_id) : undefined);
  workers = workers.map(withProjectInfo).sort((a, b) => a.name.localeCompare(b.name));
  res.json(workers);
});

router.post('/', (req, res) => {
  const { emp_id, name, phone, project_id } = req.body;
  if (!emp_id || !name || !project_id) {
    return res.status(400).json({ error: 'emp_id, name and project_id are required' });
  }
  const project = store.findOne('projects', p => p.id === Number(project_id));
  if (!project) return res.status(400).json({ error: 'Selected project does not exist' });

  const dup = store.findOne('workers', w => w.emp_id === emp_id);
  if (dup) return res.status(400).json({ error: 'Employee ID already exists' });

  const device_token = crypto.randomBytes(16).toString('hex');
  const worker = store.insert('workers', {
    emp_id, name, phone: phone || null,
    project_id: Number(project_id),
    device_token,
    current_status: 'OUT',
    last_ping_at: null
  });
  res.json({ id: worker.id, device_token });
});

router.put('/:id', (req, res) => {
  const worker = store.findOne('workers', w => w.id === Number(req.params.id));
  if (!worker) return res.status(404).json({ error: 'Worker not found' });

  const { name, phone, project_id } = req.body;
  const changes = {};
  if (name != null) changes.name = name;
  if (phone != null) changes.phone = phone;
  if (project_id != null) changes.project_id = Number(project_id);

  store.updateById('workers', req.params.id, changes);
  res.json({ success: true });
});

router.post('/:id/reset-token', (req, res) => {
  const device_token = crypto.randomBytes(16).toString('hex');
  store.updateById('workers', req.params.id, { device_token });
  res.json({ device_token });
});

router.delete('/:id', (req, res) => {
  store.deleteWhere('attendance_logs', l => l.worker_id === Number(req.params.id));
  store.deleteWhere('workers', w => w.id === Number(req.params.id));
  res.json({ success: true });
});

module.exports = router;
