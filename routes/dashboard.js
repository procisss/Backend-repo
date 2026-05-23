const express         = require('express');
const getDb           = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const db  = await getDb();
    const uid = req.user.id;

    const todayRes   = await db.execute(`SELECT COALESCE(SUM(total),0) as revenue, COUNT(*) as orders FROM orders WHERE user_id = ${uid} AND date(created_at) = date('now')`);
    const todayRev   = todayRes.rows[0].revenue || 0;
    const todayOrders= todayRes.rows[0].orders  || 0;

    const yestRes    = await db.execute(`SELECT COALESCE(SUM(total),0) as revenue, COUNT(*) as orders FROM orders WHERE user_id = ${uid} AND date(created_at) = date('now','-1 day')`);
    const yestRev    = yestRes.rows[0].revenue || 0;
    const yestOrders = yestRes.rows[0].orders  || 0;

    const lowStockRes   = await db.execute(`SELECT COUNT(*) as cnt FROM inventory WHERE user_id = ${uid} AND quantity <= min_stock`);
    const lowStockCount = lowStockRes.rows[0].cnt || 0;

    const lowStockItemsRes = await db.execute(`SELECT name, quantity, min_stock, unit, CASE WHEN quantity <= 0 THEN 'critical' WHEN quantity <= min_stock THEN 'low' ELSE 'good' END as status FROM inventory WHERE user_id = ${uid} AND quantity <= min_stock ORDER BY quantity ASC LIMIT 5`);
    const lowStockItems = lowStockItemsRes.rows.map(row => ({ name: row.name, quantity: row.quantity, minStock: row.min_stock, unit: row.unit, status: row.status }));

    const topRes = await db.execute(`SELECT oi.name, SUM(oi.quantity) as units, SUM(oi.subtotal) as revenue FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.user_id = ${uid} GROUP BY oi.name ORDER BY units DESC LIMIT 5`);
    const topProducts = topRes.rows.map(row => ({ name: row.name, units: row.units, revenue: +parseFloat(row.revenue).toFixed(2) }));

    const weeklyRes = await db.execute(`SELECT date(created_at) as day, SUM(total) as revenue FROM orders WHERE user_id = ${uid} AND created_at >= date('now', '-6 days') GROUP BY date(created_at) ORDER BY day ASC`);
    const weekMap = {};
    weeklyRes.rows.forEach(row => { weekMap[row.day] = row.revenue; });
    const weeklyData = [];
    for (let i = 6; i >= 0; i--) {
      const d   = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      weeklyData.push({ label: d.toLocaleDateString('en-PH', { weekday: 'short' }), revenue: +(weekMap[key] || 0).toFixed(2) });
    }

    const catRes = await db.execute(`SELECT r.category, SUM(oi.subtotal) as revenue FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN recipes r ON r.id = oi.recipe_id WHERE o.user_id = ${uid} GROUP BY r.category ORDER BY revenue DESC`);
    const salesByCategory = catRes.rows.map(row => ({ category: row.category, revenue: +parseFloat(row.revenue).toFixed(2) }));

    const monthlyRes  = await db.execute(`SELECT COALESCE(SUM(total),0) as revenue FROM orders WHERE user_id = ${uid} AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`);
    const monthlyRevenue   = monthlyRes.rows[0].revenue || 0;
    const stockCostRes= await db.execute(`SELECT COALESCE(SUM(total_cost),0) as cost FROM restock_purchases WHERE user_id = ${uid} AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`);
    const monthlyStockCost = stockCostRes.rows[0].cost || 0;
    const monthlyProfit    = +(monthlyRevenue - monthlyStockCost).toFixed(2);

    const revTrend   = yestRev > 0 ? (((todayRev - yestRev) / yestRev) * 100).toFixed(1) : todayRev > 0 ? '100.0' : '0.0';
    const orderTrend = yestOrders > 0 ? (((todayOrders - yestOrders) / yestOrders) * 100).toFixed(1) : todayOrders > 0 ? '100.0' : '0.0';

    return res.json({ today: { revenue: +parseFloat(todayRev).toFixed(2), orders: todayOrders, revTrend: +revTrend, orderTrend: +orderTrend }, monthly: { revenue: +parseFloat(monthlyRevenue).toFixed(2), profit: monthlyProfit, cost: +parseFloat(monthlyStockCost).toFixed(2) }, lowStockCount, lowStockItems, topProducts, weeklyData, salesByCategory });
  } catch (err) {
    console.error('[GET /dashboard]', err);
    return res.status(500).json({ message: 'Server error.', error: err.message });
  }
});

module.exports = router;