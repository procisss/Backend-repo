const express = require('express');
const getDb   = require('../db');
const { requireAdmin } = require('../middleware/auth');
const router  = express.Router();
router.use(requireAdmin);

router.get('/overview', async (req, res) => {
  try {
    const db = await getDb();
    const totalUsers    = (await db.execute(`SELECT COUNT(*) as cnt FROM users WHERE role != 'admin'`)).rows[0].cnt || 0;
    const premiumUsers  = (await db.execute(`SELECT COUNT(*) as cnt FROM users WHERE plan = 'premium' AND role != 'admin'`)).rows[0].cnt || 0;
    const freeUsers     = totalUsers - premiumUsers;
    const activeUsers   = (await db.execute(`SELECT COUNT(*) as cnt FROM users WHERE status = 'active' AND role != 'admin'`)).rows[0].cnt || 0;
    const monthlyRevenue= premiumUsers * 149;
    const newThisMonth  = (await db.execute(`SELECT COUNT(*) as cnt FROM users WHERE role != 'admin' AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`)).rows[0].cnt || 0;
    const newLastMonth  = (await db.execute(`SELECT COUNT(*) as cnt FROM users WHERE role != 'admin' AND strftime('%Y-%m', created_at) = strftime('%Y-%m', date('now', '-1 month'))`)).rows[0].cnt || 0;

    const growthRes  = await db.execute(`SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count FROM users WHERE role != 'admin' AND created_at >= date('now', '-6 months') GROUP BY month ORDER BY month ASC`);
    const growthData = growthRes.rows.map(row => ({ label: new Date(row.month + '-01').toLocaleDateString('en-PH', { month: 'short' }), users: row.count }));

    const ordersRes    = await db.execute(`SELECT COUNT(*) as cnt, COALESCE(SUM(total),0) as rev FROM orders`);
    const totalOrders  = ordersRes.rows[0].cnt || 0;
    const totalRevenue = ordersRes.rows[0].rev || 0;
    const totalInventory = (await db.execute(`SELECT COUNT(*) as cnt FROM inventory`)).rows[0].cnt || 0;
    const totalRecipes   = (await db.execute(`SELECT COUNT(*) as cnt FROM recipes`)).rows[0].cnt   || 0;

    const recentRes    = await db.execute(`SELECT business_name, email, plan, created_at FROM users WHERE role != 'admin' ORDER BY created_at DESC LIMIT 5`);
    const recentSignups= recentRes.rows.map(row => ({ businessName: row.business_name, email: row.email, plan: row.plan, createdAt: row.created_at }));

    return res.json({ stats: { totalUsers, premiumUsers, freeUsers, activeUsers, monthlyRevenue, newThisMonth, newLastMonth }, growthData, recentSignups, platform: { totalOrders, totalRevenue: +parseFloat(totalRevenue).toFixed(2), totalInventory, totalRecipes } });
  } catch (err) { console.error('[GET /admin/overview]', err); return res.status(500).json({ message: 'Server error.' }); }
});

router.get('/users', async (req, res) => {
  try {
    const db     = await getDb();
    const result = await db.execute(`SELECT u.id, u.business_name, u.owner_name, u.email, u.phone, u.plan, u.status, u.created_at, s.billing_cycle, s.started_at, s.expires_at, (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) as total_orders, (SELECT COUNT(*) FROM inventory i WHERE i.user_id = u.id) as total_inventory, (SELECT COUNT(*) FROM recipes r WHERE r.user_id = u.id) as total_recipes FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id WHERE u.role != 'admin' ORDER BY u.created_at DESC`);
    return res.json({ users: result.rows });
  } catch (err) { return res.status(500).json({ message: 'Server error.' }); }
});

router.get('/subscriptions', async (req, res) => {
  try {
    const db = await getDb();
    const premiumCount = (await db.execute(`SELECT COUNT(*) as cnt FROM users WHERE plan='premium' AND role!='admin'`)).rows[0].cnt || 0;
    const totalCount   = (await db.execute(`SELECT COUNT(*) as cnt FROM users WHERE role!='admin'`)).rows[0].cnt || 0;
    const monthlyCount = (await db.execute(`SELECT COUNT(*) as cnt FROM subscriptions s JOIN users u ON u.id = s.user_id WHERE s.billing_cycle = 'monthly' AND u.plan = 'premium'`)).rows[0].cnt || 0;
    const yearlyCount  = (await db.execute(`SELECT COUNT(*) as cnt FROM subscriptions s JOIN users u ON u.id = s.user_id WHERE s.billing_cycle = 'yearly' AND u.plan = 'premium'`)).rows[0].cnt || 0;
    const mrr = (monthlyCount * 149) + (yearlyCount * (1699/12));
    const arr = mrr * 12;

    const trendRes = await db.execute(`SELECT strftime('%Y-%m', created_at) as month, SUM(CASE WHEN plan='premium' THEN 1 ELSE 0 END) as premium, COUNT(*) as total FROM users WHERE role != 'admin' AND created_at >= date('now', '-6 months') GROUP BY month ORDER BY month ASC`);
    const trend = trendRes.rows.map(row => ({ label: new Date(row.month + '-01').toLocaleDateString('en-PH', { month: 'short' }), premium: row.premium, total: row.total }));

    const recentPremiumRes = await db.execute(`SELECT u.business_name, u.email, s.billing_cycle, s.started_at, s.expires_at FROM users u JOIN subscriptions s ON s.user_id = u.id WHERE u.plan = 'premium' ORDER BY s.started_at DESC LIMIT 10`);
    const recentPremium = recentPremiumRes.rows.map(row => ({ businessName: row.business_name, email: row.email, billingCycle: row.billing_cycle, startedAt: row.started_at, expiresAt: row.expires_at }));

    return res.json({ stats: { premiumCount, freeCount: totalCount - premiumCount, monthlyCount, yearlyCount, mrr: +mrr.toFixed(2), arr: +arr.toFixed(2), arpu: premiumCount > 0 ? +(mrr/premiumCount).toFixed(2) : 0 }, trend, recentPremium });
  } catch (err) { return res.status(500).json({ message: 'Server error.' }); }
});

router.get('/usage', async (req, res) => {
  try {
    const db = await getDb();
    const dailyRes = await db.execute(`SELECT date(created_at) as day, COUNT(*) as orders FROM orders WHERE created_at >= date('now', '-6 days') GROUP BY day ORDER BY day ASC`);
    const dayMap   = {};
    dailyRes.rows.forEach(row => { dayMap[row.day] = row.orders; });
    const dailyOrders = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      dailyOrders.push({ label: d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }), orders: dayMap[key] || 0 });
    }
    const topUsersRes = await db.execute(`SELECT u.business_name, u.email, u.plan, COUNT(o.id) as order_count, COALESCE(SUM(o.total),0) as revenue FROM users u LEFT JOIN orders o ON o.user_id = u.id WHERE u.role != 'admin' GROUP BY u.id ORDER BY order_count DESC LIMIT 5`);
    const topUsers = topUsersRes.rows.map(row => ({ businessName: row.business_name, email: row.email, plan: row.plan, orderCount: row.order_count, revenue: +parseFloat(row.revenue).toFixed(2) }));
    const totalsRes = await db.execute(`SELECT (SELECT COUNT(*) FROM users WHERE role != 'admin') as users, (SELECT COUNT(*) FROM orders) as orders, (SELECT COALESCE(SUM(total),0) FROM orders) as revenue, (SELECT COUNT(*) FROM recipes) as recipes, (SELECT COUNT(*) FROM inventory) as inventory`);
    const t = totalsRes.rows[0];
    const featureUsage = [
      { name: 'POS Orders', v: (await db.execute(`SELECT COUNT(*) as cnt FROM orders`)).rows[0].cnt || 0 },
      { name: 'Inventory',  v: (await db.execute(`SELECT COUNT(*) as cnt FROM inventory`)).rows[0].cnt || 0 },
      { name: 'Recipes',    v: (await db.execute(`SELECT COUNT(*) as cnt FROM recipes`)).rows[0].cnt || 0 },
      { name: 'Restocks',   v: (await db.execute(`SELECT COUNT(*) as cnt FROM restock_purchases`)).rows[0].cnt || 0 },
      { name: 'Alerts',     v: (await db.execute(`SELECT COUNT(*) as cnt FROM alerts WHERE type='manual'`)).rows[0].cnt || 0 },
    ];
    return res.json({ dailyOrders, topUsers, featureUsage, totals: { users: t.users, orders: t.orders, revenue: +parseFloat(t.revenue).toFixed(2), recipes: t.recipes, inventory: t.inventory } });
  } catch (err) { return res.status(500).json({ message: 'Server error.' }); }
});

router.get('/upgrade-requests', async (req, res) => {
  try {
    const db     = await getDb();
    const result = await db.execute(`SELECT ur.id, ur.user_id, ur.billing_cycle, ur.status, ur.created_at, ur.gcash_ref, ur.gcash_number, ur.gcash_name, u.business_name, u.email FROM upgrade_requests ur JOIN users u ON u.id = ur.user_id ORDER BY ur.created_at DESC`);
    return res.json({ requests: result.rows });
  } catch (err) { return res.status(500).json({ message: 'Server error.' }); }
});

router.put('/upgrade-requests/:id/approve', async (req, res) => {
  try {
    const db = await getDb();
    await db.execute({ sql: `UPDATE upgrade_requests SET status='approved', updated_at=datetime('now') WHERE id=?`, args: [req.params.id] });
    return res.json({ message: 'Request approved.' });
  } catch (err) { return res.status(500).json({ message: 'Server error.' }); }
});

router.put('/upgrade-requests/:id/reject', async (req, res) => {
  try {
    const db = await getDb();
    await db.execute({ sql: `UPDATE upgrade_requests SET status='rejected', updated_at=datetime('now') WHERE id=?`, args: [req.params.id] });
    return res.json({ message: 'Request rejected.' });
  } catch (err) { return res.status(500).json({ message: 'Server error.' }); }
});

module.exports = router;