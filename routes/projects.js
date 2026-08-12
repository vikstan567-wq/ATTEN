const express = require('express');
const store = require('../db/store');
const { requireAdmin } = require('../utils');

const router = express.Router();
router.use(requireAdmin);

router.get('/', (req, res) => {
  const projects = store.findAll('projects').map(p => {
    const workers = store.findAll('workers', w => w.project_id === p.id);
    return {
      ...p,
      worker_count: workers.length,
      present_count: workers.filter(w => w.current_status === 'IN').length
    };
  }).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  res.json(projects);
});

router.get('/:id', (req, res) => {
  const project = store.findOne('projects', p => p.id === Number(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

router.post('/', (req, res) => {
  const { project_code, project_name, latitude, longitude, radius_meters } = req.body;
  if (!project_code || !project_name || latitude == null || longitude == null) {
    return res.status(400).json({ error: 'project_code, project_name, latitude, longitude are required' });
  }
  const dup = store.findOne('projects', p => p.project_code === project_code);
  if (dup) return res.status(400).json({ error: 'Project code already exists' });

  const project = store.insert('projects', {
    project_code, project_name,
    latitude: Number(latitude), longitude: Number(longitude),
    radius_meters: Number(radius_meters) || 500,
    is_active: 1
  });
  res.json({ id: project.id });
});

router.put('/:id', (req, res) => {
  const { project_name, latitude, longitude, radius_meters, is_active } = req.body;
  const project = store.findOne('projects', p => p.id === Number(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const changes = {};
  if (project_name != null) changes.project_name = project_name;
  if (latitude != null) changes.latitude = Number(latitude);
  if (longitude != null) changes.longitude = Number(longitude);
  if (radius_meters != null) changes.radius_meters = Number(radius_meters);
  if (is_active != null) changes.is_active = is_active;

  store.updateById('projects', req.params.id, changes);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  const workerCount = store.findAll('workers', w => w.project_id === Number(req.params.id)).length;
  if (workerCount > 0) {
    return res.status(400).json({ error: 'Cannot delete project with workers assigned. Reassign or remove workers first.' });
  }
  store.deleteWhere('projects', p => p.id === Number(req.params.id));
  res.json({ success: true });
});

module.exports = router;
