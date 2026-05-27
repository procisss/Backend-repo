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

    // 1. Fetch user subscription details to evaluate the current plan tier
    const uRes = await db.execute(`SELECT plan FROM users WHERE id = ${uid}`);
    const isPremium = uRes.rows[0]?.plan === 'premium';

    let autoAlerts = [];

    if (isPremium) {
      // PREMIUM USERS: Receive alerts for BOTH pre-made Products AND raw Ingredients/Stock items
      // Scan standard inventory table (Ingredients)
      const invResult = await db.execute(`SELECT id, name, quantity, unit, min_stock FROM inventory WHERE user_id = ${uid} AND (quantity <= 0 OR quantity <= min_stock) ORDER BY quantity ASC`);
      const ingAlerts = invResult.rows.map(item => {
        const isCritical = item.quantity <= 0;
        return {
          id: `auto_ing_${item.id}`,
          type: 'inventory', // Tagged as Ingredient
          severity: isCritical ? 'critical' : 'warning',
          title: `${isCritical ? 'Critical' : 'Low'} Ingredient Stock: ${item.name}`,
          message: isCritical ? `${item.name} is completely out of stock.` : `Stock is ${item.quantity} ${item.unit} — minimum is ${item.min_stock} ${item.unit}.`,
          item: item.name,
          current: `${item.quantity} ${item.unit}`,
          minimum: `${item.min_stock} ${item.unit}`,
          status: 'active',
          inventoryId: item.id
        };
      });

      // Scan product_inventory table (Pre-made menu items/products)
      const prodResult = await db.execute(`SELECT id, name, quantity, unit, min_stock FROM product_inventory WHERE user_id = ${uid} AND (quantity <= 0 OR quantity <= min_stock) ORDER BY quantity ASC`);
      const prodAlerts = prodResult.rows.map(item => {
        const isCritical = item.quantity <= 0;
        return {
          id: `auto_prod_${item.id}`,
          type: 'product', // Tagged as Product
          severity: isCritical ? 'critical' : 'warning',
          title: `${isCritical ? 'Critical' : 'Low'} Product Stock: ${item.name}`,
          message: isCritical ? `${item.name} is completely out of stock.` : `Stock is ${item.quantity} ${item.unit} — minimum is ${item.min_stock} ${item.unit}.`,
          item: item.name,
          current: `${item.quantity} ${item.unit}`,
          minimum: `${item.min_stock} ${item.unit}`,
          status: 'active',
          inventoryId: item.id
        };
      });

      autoAlerts = [...prodAlerts, ...ingAlerts];
    } else {
      // FREE USERS: Only see alerts for the items inside the product_inventory table
      const prodResult = await db.execute(`SELECT id, name, quantity, unit, min_stock FROM product_inventory WHERE user_id = ${uid} AND (quantity <= 0 OR quantity <= min_stock) ORDER BY quantity ASC`);
      autoAlerts = prodResult.rows.map(item => {
        const isCritical = item.quantity <= 0;
        return {
          id: `auto_prod_${item.id}`,
          type: 'product',
          severity: isCritical ? 'critical' : 'warning',
          title: `${isCritical ? 'Critical' : 'Low'} Product Stock: ${item.name}`,
          message: isCritical ? `${item.name} is completely out of stock.` : `Stock is ${item.quantity} ${item.unit} — minimum is ${item.min_stock} ${item.unit}.`,
          item: item.name,
          current: `${item.quantity} ${item.unit}`,
          minimum: `${item.min_stock} ${item.unit}`,
          status: 'active',
          inventoryId: item.id
        };
      });
    }

    // 2. Fetch manual alerts (Enforce separation in frontend, or clear output if tier is downgraded)
    const manualResult = await db.execute(`SELECT * FROM alerts WHERE user_id = ${uid} AND type = 'manual' ORDER BY created_at DESC`);
    const manualAlerts = isPremium ? manualResult.rows.map(a => ({
      id: a.id,
      type: 'manual',
      severity: a.severity || 'warning',
      title: a.title,
      message: a.message,
      status: a.status,
      createdAt: a.created_at,
      resolvedAt: a.resolved_at
    })) : [];

    const activeManual = manualAlerts.filter(a => a.status === 'active');
    const resolvedManual = manualAlerts.filter(a => a.status === 'resolved');

    return res.json({
      autoAlerts,
      manualAlerts,
      summary: {
        total: autoAlerts.length + activeManual.length,
        critical: autoAlerts.filter(a => a.severity === 'critical').length + activeManual.filter(a => a.severity === 'critical').length,
        warning: autoAlerts.filter(a => a.severity === 'warning').length + activeManual.filter(a => a.severity === 'warning').length,
        resolved: resolvedManual.length
      }
    });
  } catch (err) {
    console.error('[GET /alerts]', err);
    return res.status(500).json({ message: 'Server error.' });
  }
});

// Protect manual creations explicitly inside POST
router.post('/', async (req, res) => {
  const { title, message, severity } = req.body;
  if (!title) return res.status(400).json({ message: 'Title is required.' });
  try {
    const db = await getDb();
    const uRes = await db.execute(`SELECT plan FROM users WHERE id = ${req.user.id}`);
    if (uRes.rows[0]?.plan !== 'premium') {
      return res.status(403).json({ message: 'Manual Alerts are exclusive to premium accounts.' });
    }
    
    await db.execute({
      sql: `INSERT INTO alerts (user_id, type, title, message, severity, status, created_at) VALUES (?, 'manual', ?, ?, ?, 'active', datetime('now'))`,
      args: [req.user.id, title.trim(), message ? message.trim() : null, severity || 'warning']
    });
    const last = await db.execute(`SELECT id FROM alerts WHERE user_id=${req.user.id} AND type='manual' ORDER BY id DESC LIMIT 1`);
    return res.status(201).json({ message: 'Alert created.', id: last.rows[0].id });
  } catch (err) {
    return res.status(500).json({ message: 'Server error.' });
  }
});

router.put('/:id/resolve', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ message: 'Invalid alert id.' });
  try {
    const db = await getDb();
    const result = await db.execute({
      sql: `UPDATE alerts SET status = 'resolved', resolved_at = datetime('now')
            WHERE id = ? AND user_id = ? AND type = 'manual'`,
      args: [id, req.user.id]
    });
    if (result.rowsAffected === 0) return res.status(404).json({ message: 'Alert not found.' });
    return res.json({ message: 'Alert resolved.' });
  } catch (err) {
    console.error('[PUT /alerts/:id/resolve]', err);
    return res.status(500).json({ message: 'Server error.' });
  }
});

router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ message: 'Invalid alert id.' });
  try {
    const db = await getDb();
    const result = await db.execute({
      sql: `DELETE FROM alerts WHERE id = ? AND user_id = ? AND type = 'manual'`,
      args: [id, req.user.id]
    });
    if (result.rowsAffected === 0) return res.status(404).json({ message: 'Alert not found.' });
    return res.json({ message: 'Alert deleted.' });
  } catch (err) {
    console.error('[DELETE /alerts/:id]', err);
    return res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;