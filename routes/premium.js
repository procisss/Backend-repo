const express = require('express');
const getDb   = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const router  = express.Router();

const FREE_LIMITS = { recipes: 5, inventory: 10, posOrders: 150 };

router.get('/limits', requireAuth, async (req, res) => {
  try {
    const db   = await getDb();
    const uRes = await db.execute(`SELECT plan FROM users WHERE id = ${req.user.id}`);
    const plan = uRes.rows[0]?.plan || 'free';
    if (plan === 'premium') return res.json({ plan: 'premium', limits: null, usage: null, isLimited: false });
    const recipeCount    = (await db.execute(`SELECT COUNT(*) as cnt FROM recipes WHERE user_id = ${req.user.id}`)).rows[0].cnt;
    const inventoryCount = (await db.execute(`SELECT COUNT(*) as cnt FROM inventory WHERE user_id = ${req.user.id}`)).rows[0].cnt;
    const posCount       = (await db.execute(`SELECT COUNT(*) as cnt FROM orders WHERE user_id = ${req.user.id} AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`)).rows[0].cnt;
    return res.json({ plan: 'free', limits: FREE_LIMITS, usage: { recipes: recipeCount, inventory: inventoryCount, posOrders: posCount }, isLimited: true });
  } catch (err) { return res.status(500).json({ message: 'Server error.' }); }
});

router.get('/status', requireAuth, async (req, res) => {
  try {
    const db   = await getDb();
    const uRes = await db.execute(`SELECT plan FROM users WHERE id = ${req.user.id}`);
    const plan = uRes.rows[0]?.plan || 'free';
    const subRes = await db.execute(`SELECT * FROM subscriptions WHERE user_id = ${req.user.id}`);
    return res.json({ plan, subscription: subRes.rows[0] || null });
  } catch (err) { return res.status(500).json({ message: 'Server error.' }); }
});

router.put('/admin/upgrade/:userId', requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const { billingCycle } = req.body;
  try {
    const db = await getDb();
    const userRes = await db.execute(`SELECT id FROM users WHERE id = ${userId}`);
    if (!userRes.rows.length) return res.status(404).json({ message: 'User not found.' });
    const startedAt = new Date().toISOString();
    const expiresAt = billingCycle === 'yearly'
      ? new Date(Date.now() + 365*24*60*60*1000).toISOString()
      : new Date(Date.now() +  30*24*60*60*1000).toISOString();
    await db.execute(`UPDATE users SET plan = 'premium' WHERE id = ${userId}`);
    const existing = await db.execute(`SELECT id FROM subscriptions WHERE user_id = ${userId}`);
    if (existing.rows.length) {
      await db.execute({ sql: `UPDATE subscriptions SET plan='premium', billing_cycle=?, started_at=?, expires_at=?, updated_at=datetime('now') WHERE user_id=?`, args: [billingCycle||'monthly', startedAt, expiresAt, userId] });
    } else {
      await db.execute({ sql: `INSERT INTO subscriptions (user_id, plan, billing_cycle, started_at, expires_at) VALUES (?, 'premium', ?, ?, ?)`, args: [userId, billingCycle||'monthly', startedAt, expiresAt] });
    }
    return res.json({ message: 'User upgraded to premium.' });
  } catch (err) { return res.status(500).json({ message: 'Server error.' }); }
});

router.put('/admin/downgrade/:userId', requireAdmin, async (req, res) => {
  const { userId } = req.params;
  try {
    const db = await getDb();
    await db.execute(`UPDATE users SET plan = 'free' WHERE id = ${userId}`);
    await db.execute(`UPDATE subscriptions SET plan='free', expires_at=datetime('now'), updated_at=datetime('now') WHERE user_id=${userId}`);
    return res.json({ message: 'User downgraded to free.' });
  } catch (err) { return res.status(500).json({ message: 'Server error.' }); }
});

router.post('/request-upgrade', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { billingCycle, gcashRef, gcashNumber, gcashName } = req.body;
    const cycle = billingCycle === 'yearly' ? 'yearly' : 'monthly';
    const uRes  = await db.execute(`SELECT plan FROM users WHERE id = ${req.user.id}`);
    if (uRes.rows[0]?.plan === 'premium')
      return res.status(400).json({ message: 'Already on premium plan.' });
    const existing = await db.execute(`SELECT id FROM upgrade_requests WHERE user_id = ${req.user.id} AND status = 'pending'`);
    if (existing.rows.length)
      return res.status(400).json({ message: 'You already have a pending upgrade request.' });
    await db.execute({ sql: `INSERT INTO upgrade_requests (user_id, billing_cycle, gcash_ref, gcash_number, gcash_name) VALUES (?, ?, ?, ?, ?)`, args: [req.user.id, cycle, gcashRef||null, gcashNumber||null, gcashName||null] });
    return res.json({ message: 'Upgrade request submitted.' });
  } catch (err) { return res.status(500).json({ message: 'Server error.' }); }
});

router.post('/cancel-subscription', requireAuth, async (req, res) => {
  try {
    const db   = await getDb();
    const uRes = await db.execute(`SELECT plan FROM users WHERE id = ${req.user.id}`);
    if (uRes.rows[0]?.plan !== 'premium')
      return res.status(400).json({ message: 'No active premium subscription found.' });
    await db.execute(`UPDATE users SET plan = 'free' WHERE id = ${req.user.id}`);
    await db.execute(`UPDATE subscriptions SET plan='free', expires_at=datetime('now'), updated_at=datetime('now') WHERE user_id=${req.user.id}`);
    return res.json({ message: 'Subscription cancelled successfully.' });
  } catch (err) { return res.status(500).json({ message: 'Server error.' }); }
});

module.exports = router;