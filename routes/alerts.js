const express         = require('express');
const getDb           = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();
router.use(requireAuth);

// GET /api/alerts
router.get('/', async (req, res) => {
  try {
    const db  = await getDb();
    const uid = req.user.id;

    const invResult = await db.execute(`SELECT id, name, quantity, unit, min_stock FROM inventory WHERE user_id = ${uid} AND (quantity <= 0 OR quantity <= min_stock) ORDER BY quantity ASC`);
    const autoAlerts = invResult.rows.map(item => {
      const isCritical = item.quantity <= 0;
      return { id: `auto_${item.id}`, type: 'inventory', severity: isCritical ? 'critical' : 'warning', title: `${isCritical ? 'Critical' : 'Low'} Stock: ${item.name}`, message: isCritical ? `${item.name} is completely out of stock.` : `Stock is ${item.quantity} ${item.unit} — minimum is ${item.min_stock} ${item.unit}.`, item: item.name, current: `${item.quantity} ${item.unit}`, minimum: `${item.min_stock} ${item.unit}`, status: 'active', inventoryId: item.id };
    });

    const manualResult = await db.execute(`SELECT * FROM manual_alerts WHERE user_id = ${uid} ORDER BY created_at DESC`);
    const manualAlerts = manualResult.rows.map(a => ({ id: a.id, type: 'manual', severity: a.severity, title: a.title, message: a.message, status: a.status, createdAt: a.created_at, resolvedAt: a.resolved_at }));

    const allActive = [...autoAlerts, ...manualAlerts.filter(a => a.status === 'active')];
    const summary = { total: allActive.length, critical: allActive.filter(a => a.severity === 'critical').length, warning: allActive.filter(a => a.severity === 'warning').length, resolved: manualAlerts.filter(a => a.status === 'resolved').length };

    return res.json({ autoAlerts, manualAlerts, summary });
  } catch (err) {
    console.error('[GET /alerts]', err);
    return res.status(500).json({ message: 'Server error.', error: err.message });
  }
});

// POST /api/alerts
router.post('/', async (req, res) => {
  const { title, message, severity } = req.body;
  if (!title || !title.trim())
    return res.status(400).json({ message: 'Title is required.' });
  const sev = ['critical', 'warning', 'info'].includes(severity) ? severity : 'warning';
  try {
    const db = await getDb();
    await db.execute({ sql: `INSERT INTO manual_alerts (user_id, title, message, severity) VALUES (?, ?, ?, ?)`, args: [req.user.id, title.trim(), (message || '').trim(), sev] });
    const idRes = await db.execute(`SELECT MAX(id) as id FROM manual_alerts WHERE user_id = ${req.user.id}`);
    return res.status(201).json({ message: 'Alert created.', id: idRes.rows[0].id });
  } catch (err) {
    console.error('[POST /alerts]', err);
    return res.status(500).json({ message: 'Server error.', error: err.message });
  }
});

// PUT /api/alerts/:id/resolve
router.put('/:id/resolve', async (req, res) => {
  const { id } = req.params;
  try {
    const db    = await getDb();
    const check = await db.execute(`SELECT id FROM manual_alerts WHERE id = ${id} AND user_id = ${req.user.id}`);
    if (!check.rows.length)
      return res.status(404).json({ message: 'Alert not found.' });
    await db.execute({ sql: `UPDATE manual_alerts SET status = 'resolved', resolved_at = datetime('now') WHERE id = ? AND user_id = ?`, args: [id, req.user.id] });
    return res.json({ message: 'Alert resolved.' });
  } catch (err) {
    return res.status(500).json({ message: 'Server error.' });
  }
});

// DELETE /api/alerts/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const db    = await getDb();
    const check = await db.execute(`SELECT id FROM manual_alerts WHERE id = ${id} AND user_id = ${req.user.id}`);
    if (!check.rows.length)
      return res.status(404).json({ message: 'Alert not found.' });
    await db.execute({ sql: `DELETE FROM manual_alerts WHERE id = ? AND user_id = ?`, args: [id, req.user.id] });
    return res.json({ message: 'Alert deleted.' });
  } catch (err) {
    return res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;