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

    // 1. Fetch user tier from the users table to handle premium restrictions
    const userRes = await db.execute({
      sql: `SELECT is_premium FROM users WHERE id = ?`,
      args: [uid]
    });
    const isPremium = userRes.rows[0]?.is_premium === 1;

    let autoAlerts = [];

    // --- BASE TIER & PREMIUM TIER: Product Inventory Alerts ---
    // Select low/out-of-stock items from pre-made product inventories
    const prodResult = await db.execute({
      sql: `SELECT pi.id, pi.quantity, pi.min_stock, r.name 
            FROM product_inventory pi
            JOIN recipes r ON pi.recipe_id = r.id
            WHERE pi.user_id = ? AND (pi.quantity <= 0 OR pi.quantity <= pi.min_stock)
            ORDER BY pi.quantity ASC`,
      args: [uid]
    });

    const productAlerts = prodResult.rows.map(item => {
      const isCritical = item.quantity <= 0;
      return {
        id: `prod_${item.id}`,
        type: 'product',
        severity: isCritical ? 'critical' : 'warning',
        title: `${isCritical ? 'Critical' : 'Low'} Product Stock: ${item.name}`,
        message: isCritical ? `${item.name} is completely out of stock.` : `Stock is down to ${item.quantity} — minimum is ${item.min_stock}.`,
        item: item.name,
        current: `${item.quantity}`,
        minimum: `${item.min_stock}`,
        status: 'active',
        inventoryId: item.id,
        // Clickable redirect parameters for your front-end Purchases routing
        purchaseUrl: `/purchases?search=${encodeURIComponent(item.name)}&type=product`
      };
    });
    autoAlerts = [...productAlerts];

    // --- PREMIUM ONLY TIER: Raw Ingredient Inventory Alerts ---
    if (isPremium) {
      const invResult = await db.execute({
        sql: `SELECT id, name, quantity, unit, min_stock FROM inventory WHERE user_id = ? AND (quantity <= 0 OR quantity <= min_stock) ORDER BY quantity ASC`,
        args: [uid]
      });

      const ingredientAlerts = invResult.rows.map(item => {
        const isCritical = item.quantity <= 0;
        return {
          id: `ing_${item.id}`,
          type: 'inventory',
          severity: isCritical ? 'critical' : 'warning',
          title: `${isCritical ? 'Critical' : 'Low'} Ingredient: ${item.name}`,
          message: isCritical ? `${item.name} is completely out of stock.` : `Stock is ${item.quantity} ${item.unit} — minimum is ${item.min_stock} ${item.unit}.`,
          item: item.name,
          current: `${item.quantity} ${item.unit}`,
          minimum: `${item.min_stock} ${item.unit}`,
          status: 'active',
          inventoryId: item.id,
          // Redirect parameters linking this specific material item straight to restock orders
          purchaseUrl: `/purchases?search=${encodeURIComponent(item.name)}&type=ingredient`
        };
      });
      autoAlerts = [...autoAlerts, ...ingredientAlerts];
    }

    // --- PREMIUM ONLY TIER: Fetch Manual Alerts ---
    let manualAlerts = [];
    if (isPremium) {
      const manualResult = await db.execute({
        sql: `SELECT * FROM manual_alerts WHERE user_id = ? ORDER BY created_at DESC`,
        args: [uid]
      });
      manualAlerts = manualResult.rows.map(a => ({
        id: a.id,
        type: 'manual',
        severity: a.severity,
        title: a.title,
        message: a.message,
        status: a.status,
        createdAt: a.created_at,
        resolvedAt: a.resolved_at
      }));
    }

    // Compile active alerts totals
    const allActive = [...autoAlerts, ...manualAlerts.filter(a => a.status === 'active')];
    const summary = {
      total: allActive.length,
      critical: allActive.filter(a => a.severity === 'critical').length,
      warning: allActive.filter(a => a.severity === 'warning').length,
      resolved: manualAlerts.filter(a => a.status === 'resolved').length
    };

    return res.json({ autoAlerts, manualAlerts, summary });
  } catch (err) {
    console.error('[GET /alerts]', err);
    return res.status(500).json({ message: 'Server error.', error: err.message });
  }
});

// POST /api/alerts (Premium Guarded manually created alerts)
router.post('/', async (req, res) => {
  const { title, message, severity } = req.body;
  if (!title || !title.trim())
    return res.status(400).json({ message: 'Title is required.' });
    
  const sev = ['critical', 'warning', 'info'].includes(severity) ? severity : 'warning';
  try {
    const db = await getDb();
    const uid = req.user.id;

    // Premium Check Enforcement
    const userRes = await db.execute({ sql: `SELECT is_premium FROM users WHERE id = ?`, args: [uid] });
    if (userRes.rows[0]?.is_premium !== 1) {
      return res.status(403).json({ message: 'Manual alert creation is a premium feature.' });
    }

    await db.execute({ 
      sql: `INSERT INTO manual_alerts (user_id, title, message, severity) VALUES (?, ?, ?, ?)`, 
      args: [uid, title.trim(), (message || '').trim(), sev] 
    });
    
    const idRes = await db.execute({
      sql: `SELECT MAX(id) as id FROM manual_alerts WHERE user_id = ?`,
      args: [uid]
    });
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
    const db = await getDb();
    const check = await db.execute({ sql: `SELECT id FROM manual_alerts WHERE id = ? AND user_id = ?`, args: [id, req.user.id] });
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
    const db = await getDb();
    const check = await db.execute({ sql: `SELECT id FROM manual_alerts WHERE id = ? AND user_id = ?`, args: [id, req.user.id] });
    if (!check.rows.length)
      return res.status(404).json({ message: 'Alert not found.' });
    await db.execute({ sql: `DELETE FROM manual_alerts WHERE id = ? AND user_id = ?`, args: [id, req.user.id] });
    return res.json({ message: 'Alert deleted.' });
  } catch (err) {
    return res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;