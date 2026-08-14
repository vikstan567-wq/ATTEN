const express = require('express');
const store = require('../db/store');
const { requireAdmin } = require('../utils');

const router = express.Router();
router.use(requireAdmin);

function requireIT(req, res, next) {
  if (req.admin.role !== 'it') return res.status(403).json({ error: 'Sirf IT admin project add/edit kar sakta hai' });
  next();
}

router.get('/', async (req, res) => {
  try {
    let projects = await store.findAll('projects');
    if (req.admin.role === 'admin') {
      projects = projects.filter(p => p.id === req.admin.project_id);
    }
    const workers = await store.findAll('workers');
    const rows = projects.map(p => {
      const projectWorkers = workers.filter(w => w.project_id === p.id);
      return {
        ...p,
        worker_count: projectWorkers.length,
        present_count: projectWorkers.filter(w => w.current_status === 'IN').length
      };
    }).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  const project = await store.findOne('projects', p => p.id === Number(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (req.admin.role === 'admin' && project.id !== req.admin.project_id) {
    return res.status(403).json({ error: 'Is project ka access nahi hai' });
  }
  res.json(project);
});

router.post('/', requireIT, async (req, res) => {
  try {
    const { project_code, project_name, latitude, longitude, radius_meters } = req.body;
    if (!project_code || !project_name || latitude == null || longitude == null) {
      return res.status(400).json({ error: 'project_code, project_name, latitude, longitude are required' });
    }
    const dup = await store.findOne('projects', p => p.project_code === project_code);
    if (dup) return res.status(400).json({ error: 'Project code already exists' });

    const project = await store.insert('projects', {
      project_code, project_name,
      latitude: Number(latitude), longitude: Number(longitude),
      radius_meters: Number(radius_meters) || 500,
      is_active: 1
    });
    res.json({ id: project.id });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', requireIT, async (req, res) => {
  const { project_name, latitude, longitude, radius_meters, is_active } = req.body;
  const project = await store.findOne('projects', p => p.id === Number(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const changes = {};
  if (project_name != null) changes.project_name = project_name;
  if (latitude != null) changes.latitude = Number(latitude);
  if (longitude != null) changes.longitude = Number(longitude);
  if (radius_meters != null) changes.radius_meters = Number(radius_meters);
  if (is_active != null) changes.is_active = is_active;

  await store.updateById('projects', req.params.id, changes);
  res.json({ success: true });
});

router.delete('/:id', requireIT, async (req, res) => {
  const workers = await store.findAll('workers', w => w.project_id === Number(req.params.id));
  if (workers.length > 0) {
    return res.status(400).json({ error: 'Cannot delete project with workers assigned. Reassign or remove workers first.' });
  }
  await store.deleteWhere('projects', p => p.id === Number(req.params.id));
  res.json({ success: true });
});

module.exports = router;
