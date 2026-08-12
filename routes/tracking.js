const express = require('express');
const store = require('../db/store');
const { distanceInMeters } = require('../utils');

const router = express.Router();

// Called by the worker's phone (background service / geofence trigger).
// No admin login needed — auth is via the worker's device_token.
router.post('/ping', (req, res) => {
  const { device_token, latitude, longitude } = req.body;
  if (!device_token || latitude == null || longitude == null) {
    return res.status(400).json({ error: 'device_token, latitude, longitude are required' });
  }

  const worker = store.findOne('workers', w => w.device_token === device_token);
  if (!worker) return res.status(401).json({ error: 'Unknown device token' });

  const project = store.findOne('projects', p => p.id === worker.project_id);
  if (!project || !project.is_active) {
    return res.status(400).json({ error: 'Project not found or inactive' });
  }

  const dist = distanceInMeters(Number(latitude), Number(longitude), project.latitude, project.longitude);
  const isInside = dist <= project.radius_meters;
  const newStatus = isInside ? 'IN' : 'OUT';
  const changed = worker.current_status !== newStatus;

  store.updateById('workers', worker.id, { last_ping_at: store.nowISO() });

  if (changed) {
    store.insert('attendance_logs', {
      worker_id: worker.id,
      project_id: project.id,
      event_type: newStatus,
      latitude: Number(latitude),
      longitude: Number(longitude),
      distance_meters: Math.round(dist),
      event_time: store.nowISO()
    });
    store.updateById('workers', worker.id, { current_status: newStatus });
  }

  res.json({
    status: newStatus,
    distance_meters: Math.round(dist),
    radius_meters: project.radius_meters,
    project_name: project.project_name,
    changed
  });
});

// Used by the phone app once, at install time, to fetch the geofence.
router.get('/geofence/:device_token', (req, res) => {
  const worker = store.findOne('workers', w => w.device_token === req.params.device_token);
  if (!worker) return res.status(401).json({ error: 'Unknown device token' });
  const project = store.findOne('projects', p => p.id === worker.project_id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  res.json({
    worker_name: worker.name,
    emp_id: worker.emp_id,
    project_name: project.project_name,
    latitude: project.latitude,
    longitude: project.longitude,
    radius_meters: project.radius_meters
  });
});

module.exports = router;
