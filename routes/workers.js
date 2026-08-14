const express = require('express');
const crypto = require('crypto');
const store = require('../db/store');
const { requireAdmin } = require('../utils');

const router = express.Router();
router.use(requireAdmin);

function scopedProjectId(req, requestedId) {
  if (req.admin.role === 'admin') return req.admin.project_id;
  return requestedId ? Number(requestedId) : undefined;
}

router.get('/', async (req, res) => {
  try {
    const projectId = scopedProjectId(req, req.query.project_id);
    let workers = await store.findAll('workers', projectId ? w => w.project_id === projectId : undefined);
    const projects = await store.findAll('projects');
    const projectById = new Map(projects.map(p => [p.id, p]));
    workers = workers
      .map(w => {
        const project = projectById.get(w.project_id);
        return { ...w, project_name: project ? project.project_name : null, project_code: project ? project.project_code : null };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json(workers);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { emp_id, name, phone, gross_salary, allowances } = req.body;
    const project_id = scopedProjectId(req, req.body.project_id);
    if (!emp_id || !name || !project_id) {
      return res.status(400).json({ error: 'emp_id, name and project_id are required' });
    }
    const project = await store.findOne('projects', p => p.id === Number(project_id));
    if (!project) return res.status(400).json({ error: 'Selected project does not exist' });

    const dup = await store.findOne('workers', w => w.emp_id === emp_id);
    if (dup) return res.status(400).json({ error: 'Employee ID already exists' });

    const cleanAllowances = Array.isArray(allowances)
      ? allowances
          .filter(a => a && a.name && a.amount != null && a.amount !== '')
          .map(a => ({ name: String(a.name).trim(), amount: Number(a.amount) || 0 }))
      : [];

    const device_token = crypto.randomBytes(16).toString('hex');
    const worker = await store.insert('workers', {
      emp_id, name, phone: phone || null,
      project_id: Number(project_id),
      device_token,
      current_status: 'OUT',
      last_ping_at: null,
      gross_salary: Number(gross_salary) || 0,
      allowances: cleanAllowances
    });
    res.json({ id: worker.id, device_token });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

function assertOwnership(req, worker) {
  if (req.admin.role === 'admin' && worker.project_id !== req.admin.project_id) {
    return false;
  }
  return true;
}

router.put('/:id', async (req, res) => {
  const worker = await store.findOne('workers', w => w.id === Number(req.params.id));
  if (!worker) return res.status(404).json({ error: 'Worker not found' });
  if (!assertOwnership(req, worker)) return res.status(403).json({ error: 'Access denied' });

  const { name, phone, project_id, gross_salary, allowances } = req.body;
  const changes = {};
  if (name != null) changes.name = name;
  if (phone != null) changes.phone = phone;
  if (project_id != null && req.admin.role === 'it') changes.project_id = Number(project_id);
  if (gross_salary != null) changes.gross_salary = Number(gross_salary) || 0;
  if (Array.isArray(allowances)) {
    changes.allowances = allowances
      .filter(a => a && a.name && a.amount != null && a.amount !== '')
      .map(a => ({ name: String(a.name).trim(), amount: Number(a.amount) || 0 }));
  }

  await store.updateById('workers', req.params.id, changes);
  res.json({ success: true });
});

router.post('/:id/reset-token', async (req, res) => {
  const worker = await store.findOne('workers', w => w.id === Number(req.params.id));
  if (!worker) return res.status(404).json({ error: 'Worker not found' });
  if (!assertOwnership(req, worker)) return res.status(403).json({ error: 'Access denied' });

  const device_token = crypto.randomBytes(16).toString('hex');
  await store.updateById('workers', req.params.id, { device_token });
  res.json({ device_token });
});

router.delete('/:id', async (req, res) => {
  const worker = await store.findOne('workers', w => w.id === Number(req.params.id));
  if (!worker) return res.status(404).json({ error: 'Worker not found' });
  if (!assertOwnership(req, worker)) return res.status(403).json({ error: 'Access denied' });

  await store.deleteWhere('attendance_logs', l => l.worker_id === Number(req.params.id));
  await store.deleteWhere('workers', w => w.id === Number(req.params.id));
  res.json({ success: true });
});

module.exports = router;
