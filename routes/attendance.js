const express = require('express');
const store = require('../db/store');
const { requireAdmin } = require('../utils');

const router = express.Router();
router.use(requireAdmin);

const LATE_AFTER = '10:30'; // HH:MM — first check-in after this time counts as "Late"

function todayStr() {
  const istMs = Date.now() + 5.5 * 60 * 60 * 1000;
  return new Date(istMs).toISOString().slice(0, 10);
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

function filterWorkers(workers, project_id, search) {
  let result = project_id ? workers.filter(w => w.project_id === Number(project_id)) : workers;
  if (search) {
    const q = search.toLowerCase();
    result = result.filter(w => w.name.toLowerCase().includes(q) || w.emp_id.toLowerCase().includes(q));
  }
  return result;
}

function scopedProjectId(req, requestedId) {
  if (req.admin.role === 'admin') return req.admin.project_id;
  return requestedId ? Number(requestedId) : undefined;
}

function lastDayOfMonth(y, m) {
  const totalDays = daysInMonth(y, m);
  const todayIso = todayStr();
  return (`${y}-${String(m).padStart(2, '0')}-${String(totalDays).padStart(2, '0')}` > todayIso)
    ? Number(todayIso.slice(8, 10)) : totalDays;
}

// ---------- Live status ----------
router.get('/live', async (req, res) => {
  try {
    const projectId = scopedProjectId(req, req.query.project_id);
    const workers = await store.findAll('workers', projectId ? w => w.project_id === projectId : undefined);
    const projects = await store.findAll('projects');
    const projectById = new Map(projects.map(p => [p.id, p]));

    const rows = workers.map(w => {
      const project = projectById.get(w.project_id);
      return {
        id: w.id, emp_id: w.emp_id, name: w.name,
        current_status: w.current_status, last_ping_at: w.last_ping_at,
        project_name: project ? project.project_name : null,
        project_code: project ? project.project_code : null
      };
    }).sort((a, b) => (a.current_status === b.current_status ? a.name.localeCompare(b.name) : (a.current_status === 'IN' ? -1 : 1)));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------- Raw event log ----------
router.get('/logs', async (req, res) => {
  try {
    const { worker_id, date } = req.query;
    const projectId = scopedProjectId(req, req.query.project_id);
    let logs = await store.findAll('attendance_logs');
    if (projectId) logs = logs.filter(l => l.project_id === projectId);
    if (worker_id) logs = logs.filter(l => l.worker_id === Number(worker_id));
    if (date) logs = logs.filter(l => (l.event_time || '').startsWith(date));

    logs = logs.sort((a, b) => (a.event_time < b.event_time ? 1 : -1)).slice(0, 500);

    const workers = await store.findAll('workers');
    const projects = await store.findAll('projects');
    const workerById = new Map(workers.map(w => [w.id, w]));
    const projectById = new Map(projects.map(p => [p.id, p]));

    const rows = logs.map(l => {
      const worker = workerById.get(l.worker_id);
      const project = projectById.get(l.project_id);
      return {
        ...l,
        emp_id: worker ? worker.emp_id : null,
        name: worker ? worker.name : null,
        project_name: project ? project.project_name : null,
        project_code: project ? project.project_code : null
      };
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------- Daily summary: Present / Absent / Late / Total ----------
router.get('/daily-summary', async (req, res) => {
  try {
    const { date } = req.query;
    const projectId = scopedProjectId(req, req.query.project_id);
    const dateStr = date || todayStr();
    const allWorkers = await store.findAll('workers');
    const workers = filterWorkers(allWorkers, projectId);
    const allLogs = await store.findAll('attendance_logs');
    const projects = await store.findAll('projects');
    const projectById = new Map(projects.map(p => [p.id, p]));

    const records = workers
      .filter(w => {
        const workerStartDate = (w.created_at || '').slice(0, 10);
        return !workerStartDate || dateStr >= workerStartDate;
      })
      .map(w => buildDayRecord(w, projectById.get(w.project_id), dateStr, allLogs));

    res.json({
      date: dateStr,
      present: records.filter(r => r.status === 'Present').length,
      late: records.filter(r => r.status === 'Late').length,
      absent: records.filter(r => r.status === 'Absent').length,
      total: workers.length
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------- Monthly report: pie breakdown + daily trend + records table ----------
router.get('/monthly', async (req, res) => {
  try {
    const { month, year } = req.query;
    const projectId = scopedProjectId(req, req.query.project_id);
    const now = new Date();
    const y = Number(year) || now.getFullYear();
    const m = Number(month) || (now.getMonth() + 1);
    const allWorkers = await store.findAll('workers');
    const workers = filterWorkers(allWorkers, projectId);
    const allLogs = await store.findAll('attendance_logs');
    const projects = await store.findAll('projects');
    const projectById = new Map(projects.map(p => [p.id, p]));

    const lastDay = lastDayOfMonth(y, m);
    let present = 0, late = 0, absent = 0;
    const dailyTrend = [];
    const records = [];

    for (let d = 1; d <= lastDay; d++) {
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      let attendedToday = 0;
      for (const w of workers) {
        const workerStartDate = (w.created_at || '').slice(0, 10);
        if (workerStartDate && dateStr < workerStartDate) continue;

        const rec = buildDayRecord(w, projectById.get(w.project_id), dateStr, allLogs);
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
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------- Full history: searchable, date-filterable attendance records ----------
router.get('/history', async (req, res) => {
  try {
    const { search, date, limit } = req.query;
    const projectId = scopedProjectId(req, req.query.project_id);
    const allWorkers = await store.findAll('workers');
    const workers = filterWorkers(allWorkers, projectId, search);
    const allLogs = await store.findAll('attendance_logs');
    const projects = await store.findAll('projects');
    const projectById = new Map(projects.map(p => [p.id, p]));

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
        const rec = buildDayRecord(w, projectById.get(w.project_id), dateStr, allLogs);
        if (rec.status !== 'Absent') records.push(rec);
      }
    }
    records.sort((a, b) => (a.date < b.date ? 1 : -1));
    res.json(records.slice(0, Number(limit) || 200));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
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

router.get('/export', async (req, res) => {
  try {
    const { scope, month, year, search, date } = req.query;
    const projectId = scopedProjectId(req, req.query.project_id);
    const allWorkers = await store.findAll('workers');
    const workers = filterWorkers(allWorkers, projectId, search);
    const allLogs = await store.findAll('attendance_logs');
    const projects = await store.findAll('projects');
    const projectById = new Map(projects.map(p => [p.id, p]));
    let records = [];

    if (scope === 'month') {
      const now = new Date();
      const y = Number(year) || now.getFullYear();
      const m = Number(month) || (now.getMonth() + 1);
      const lastDay = lastDayOfMonth(y, m);
      for (let d = 1; d <= lastDay; d++) {
        const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        for (const w of workers) {
          const rec = buildDayRecord(w, projectById.get(w.project_id), dateStr, allLogs);
          if (rec.status !== 'Absent') records.push(rec);
        }
      }
    } else {
      const distinctDates = date ? [date] : [...new Set(allLogs.map(l => (l.event_time || '').slice(0, 10)))].filter(Boolean);
      for (const dateStr of distinctDates) {
        for (const w of workers) {
          const rec = buildDayRecord(w, projectById.get(w.project_id), dateStr, allLogs);
          if (rec.status !== 'Absent') records.push(rec);
        }
      }
    }

    records.sort((a, b) => (a.date < b.date ? 1 : -1));
    const csv = toCSV(records);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-export.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------- Salary: gross + allowances calculated by present days in the month ----------
router.get('/salary', async (req, res) => {
  try {
    const { month, year } = req.query;
    const projectId = scopedProjectId(req, req.query.project_id);
    const now = new Date();
    const y = Number(year) || now.getFullYear();
    const m = Number(month) || (now.getMonth() + 1);
    const allWorkers = await store.findAll('workers');
    const workers = filterWorkers(allWorkers, projectId);
    const allLogs = await store.findAll('attendance_logs');
    const projects = await store.findAll('projects');
    const projectById = new Map(projects.map(p => [p.id, p]));

    const totalDaysInMonth = daysInMonth(y, m);
    const lastDay = lastDayOfMonth(y, m);

    const rows = workers.map(w => {
      const workerStartDate = (w.created_at || '').slice(0, 10);
      let presentDays = 0;
      for (let d = 1; d <= lastDay; d++) {
        const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        if (workerStartDate && dateStr < workerStartDate) continue;
        const rec = buildDayRecord(w, projectById.get(w.project_id), dateStr, allLogs);
        if (rec.status !== 'Absent') presentDays++;
      }

      const grossSalary = w.gross_salary || 0;
      const allowances = w.allowances || [];
      const dailyGrossRate = grossSalary / totalDaysInMonth;
      const dailyAllowanceTotal = allowances.reduce((sum, a) => sum + (a.amount || 0), 0);
      const totalSalary = (dailyGrossRate + dailyAllowanceTotal) * presentDays;
      const project = projectById.get(w.project_id);

      return {
        worker_id: w.id, emp_id: w.emp_id, name: w.name,
        project_name: project ? project.project_name : null,
        project_code: project ? project.project_code : null,
        gross_salary: grossSalary,
        allowances,
        daily_allowance_total: Math.round(dailyAllowanceTotal * 100) / 100,
        present_days: presentDays,
        total_days_in_month: totalDaysInMonth,
        total_salary: Math.round(totalSalary * 100) / 100
      };
    });

    res.json({ year: y, month: m, rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
