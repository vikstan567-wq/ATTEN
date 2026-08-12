const express = require('express');
const store = require('../db/store');
const { requireAdmin } = require('../utils');

const router = express.Router();
router.use(requireAdmin);

const LATE_AFTER = '10:30'; // HH:MM — first check-in after this time counts as "Late"

function enrichWorkerRow(w) {
  const project = store.findOne('projects', p => p.id === w.project_id);
  return {
    id: w.id, emp_id: w.emp_id, name: w.name,
    current_status: w.current_status, last_ping_at: w.last_ping_at,
    project_name: project ? project.project_name : null,
    project_code: project ? project.project_code : null
  };
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate(); // month is 1-indexed here
}

// Build one worker's attendance record for a single date (YYYY-MM-DD)
// from raw IN/OUT log rows. First IN of the day = check-in,
// last OUT of the day = check-out (or "still inside" if none yet).
function buildDayRecord(worker, project, dateStr, dayLogs) {
  const logsForDay = dayLogs
    .filter(l => l.worker_id === worker.id && (l.event_time || '').startsWith(dateStr))
    .sort((a, b) => (a.event_time < b.event_time ? -1 : 1));

  if (logsForDay.length === 0) {
    return {
      worker_id: worker.id, emp_id: worker.emp_id, name: worker.name,
      project_name: project ? project.project_name : null,
      project_code: project ? project.project_code : null,
      date: dateStr, check_in: null, check_out: null, hours: 0, status: 'Absent'
    };
  }

  const firstIn = logsForDay.find(l => l.event_type === 'IN');
  const lastEvent = logsForDay[logsForDay.length - 1];
  const checkIn = firstIn ? firstIn.event_time : logsForDay[0].event_time;
  const checkOut = lastEvent.event_type === 'OUT' ? lastEvent.event_time : null;

  let hours = 0;
  const startMs = new Date(checkIn.replace(' ', 'T') + 'Z').getTime();
  const endMs = checkOut
    ? new Date(checkOut.replace(' ', 'T') + 'Z').getTime()
    : Date.now();
  hours = Math.max(0, (endMs - startMs) / 3600000);

  const checkInTime = checkIn.slice(11, 16); // HH:MM
  const status = checkInTime > LATE_AFTER ? 'Late' : 'Present';

  return {
    worker_id: worker.id, emp_id: worker.emp_id, name: worker.name,
    project_name: project ? project.project_name : null,
    project_code: project ? project.project_code : null,
    date: dateStr,
    check_in: checkIn, check_out: checkOut,
    hours: Math.round(hours * 10) / 10,
    status
  };
}

function filteredWorkers(project_id, search) {
  let workers = store.findAll('workers', project_id ? w => w.project_id === Number(project_id) : undefined);
  if (search) {
    const q = search.toLowerCase();
    workers = workers.filter(w => w.name.toLowerCase().includes(q) || w.emp_id.toLowerCase().includes(q));
  }
  return workers;
}

// ---------- Live status (unchanged) ----------
router.get('/live', (req, res) => {
  const { project_id } = req.query;
  let workers = store.findAll('workers', project_id ? w => w.project_id === Number(project_id) : undefined);
  const rows = workers.map(enrichWorkerRow)
    .sort((a, b) => (a.current_status === b.current_status ? a.name.localeCompare(b.name) : (a.current_status === 'IN' ? -1 : 1)));
  res.json(rows);
});

// ---------- Raw event log (unchanged) ----------
router.get('/logs', (req, res) => {
  const { project_id, worker_id, date } = req.query;
  let logs = store.findAll('attendance_logs');
  if (project_id) logs = logs.filter(l => l.project_id === Number(project_id));
  if (worker_id) logs = logs.filter(l => l.worker_id === Number(worker_id));
  if (date) logs = logs.filter(l => (l.event_time || '').startsWith(date));

  logs = logs.sort((a, b) => (a.event_time < b.event_time ? 1 : -1)).slice(0, 500);

  const rows = logs.map(l => {
    const worker = store.findOne('workers', w => w.id === l.worker_id);
    const project = store.findOne('projects', p => p.id === l.project_id);
    return {
      ...l,
      emp_id: worker ? worker.emp_id : null,
      name: worker ? worker.name : null,
      project_name: project ? project.project_name : null,
      project_code: project ? project.project_code : null
    };
  });
  res.json(rows);
});

// ---------- Daily summary: Present / Absent / Late / Total ----------
router.get('/daily-summary', (req, res) => {
  const { project_id, date } = req.query;
  const dateStr = date || todayStr();
  const workers = filteredWorkers(project_id);
  const allLogs = store.findAll('attendance_logs');

  const records = workers.map(w => {
    const project = store.findOne('projects', p => p.id === w.project_id);
    return buildDayRecord(w, project, dateStr, allLogs);
  });

  res.json({
    date: dateStr,
    present: records.filter(r => r.status === 'Present').length,
    late: records.filter(r => r.status === 'Late').length,
    absent: records.filter(r => r.status === 'Absent').length,
    total: workers.length
  });
});

// ---------- Monthly report: pie breakdown + daily trend + records table ----------
router.get('/monthly', (req, res) => {
  const { project_id, month, year } = req.query;
  const now = new Date();
  const y = Number(year) || now.getFullYear();
  const m = Number(month) || (now.getMonth() + 1); // 1-indexed
  const workers = filteredWorkers(project_id);
  const allLogs = store.findAll('attendance_logs');

  const totalDays = daysInMonth(y, m);
  const todayIso = todayStr();
  const lastDay = (`${y}-${String(m).padStart(2, '0')}-${String(totalDays).padStart(2, '0')}` > todayIso)
    ? Number(todayIso.slice(8, 10)) : totalDays; // don't project future days if it's the current month

  let present = 0, late = 0, absent = 0;
  const dailyTrend = [];
  const records = [];

  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    let attendedToday = 0;
    for (const w of workers) {
      const project = store.findOne('projects', p => p.id === w.project_id);
      const rec = buildDayRecord(w, project, dateStr, allLogs);
      if (rec.status === 'Present') present++;
      else if (rec.status === 'Late') late++;
      else absent++;
      if (rec.status !== 'Absent') {
        attendedToday++;
        records.push(rec);
      }
    }
    dailyTrend.push({ date: dateStr, count: attendedToday });
  }

  records.sort((a, b) => (a.date < b.date ? 1 : -1));

  res.json({
    year: y, month: m,
    summary: { present, late, absent },
    daily_trend: dailyTrend,
    records: records.slice(0, 500)
  });
});

// ---------- Full history: searchable, date-filterable attendance records ----------
router.get('/history', (req, res) => {
  const { project_id, search, date, limit } = req.query;
  const workers = filteredWorkers(project_id, search);
  const allLogs = store.findAll('attendance_logs');

  let dates;
  if (date) {
    dates = [date];
  } else {
    const distinctDates = [...new Set(allLogs.map(l => (l.event_time || '').slice(0, 10)))].filter(Boolean);
    dates = distinctDates.sort().reverse().slice(0, 14);
  }

  const records = [];
  for (const dateStr of dates) {
    for (const w of workers) {
      const project = store.findOne('projects', p => p.id === w.project_id);
      const rec = buildDayRecord(w, project, dateStr, allLogs);
      if (rec.status !== 'Absent') records.push(rec);
    }
  }
  records.sort((a, b) => (a.date < b.date ? 1 : -1));
  res.json(records.slice(0, Number(limit) || 200));
});

// ---------- CSV export (opens fine in Excel) ----------
function toCSV(records) {
  const header = 'Employee,Emp ID,Project,Date,Check In,Check Out,Hours,Status';
  const rows = records.map(r => [
    r.name, r.emp_id, r.project_code || '', r.date,
    r.check_in ? r.check_in.slice(11, 16) : '',
    r.check_out ? r.check_out.slice(11, 16) : 'Still IN',
    r.hours, r.status
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  return [header, ...rows].join('\n');
}

router.get('/export', (req, res) => {
  const { scope, project_id, month, year, search, date } = req.query;
  const workers = filteredWorkers(project_id, search);
  const allLogs = store.findAll('attendance_logs');
  let records = [];

  if (scope === 'month') {
    const now = new Date();
    const y = Number(year) || now.getFullYear();
    const m = Number(month) || (now.getMonth() + 1);
    const totalDays = daysInMonth(y, m);
    const todayIso = todayStr();
    const lastDay = (`${y}-${String(m).padStart(2, '0')}-${String(totalDays).padStart(2, '0')}` > todayIso)
      ? Number(todayIso.slice(8, 10)) : totalDays;
    for (let d = 1; d <= lastDay; d++) {
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      for (const w of workers) {
        const project = store.findOne('projects', p => p.id === w.project_id);
        const rec = buildDayRecord(w, project, dateStr, allLogs);
        if (rec.status !== 'Absent') records.push(rec);
      }
    }
  } else {
    const distinctDates = date ? [date] : [...new Set(allLogs.map(l => (l.event_time || '').slice(0, 10)))].filter(Boolean);
    for (const dateStr of distinctDates) {
      for (const w of workers) {
        const project = store.findOne('projects', p => p.id === w.project_id);
        const rec = buildDayRecord(w, project, dateStr, allLogs);
        if (rec.status !== 'Absent') records.push(rec);
      }
    }
  }

  records.sort((a, b) => (a.date < b.date ? 1 : -1));
  const csv = toCSV(records);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="attendance-export.csv"`);
  res.send(csv);
});

module.exports = router;
