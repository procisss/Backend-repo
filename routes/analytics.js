const express         = require('express');
const getDb           = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();
router.use(requireAuth);

function dateWhere(range, col) {
  switch (range) {
    case 'daily':   return `AND DATE(${col}) = DATE('now')`;
    case 'weekly':  return `AND ${col} >= DATE('now', '-7 days')`;
    case 'monthly': return `AND ${col} >= DATE('now', '-30 days')`;
    default:        return '';
  }
}

router.get('/', async (req, res) => {
  const range = req.query.range || 'monthly';
  const uid   = req.user.id;
  try {
    const db = await getDb();

    const revResult    = await db.execute(`SELECT COALESCE(SUM(total),0) AS total_revenue, COUNT(*) AS total_orders FROM orders WHERE user_id = ${uid} ${dateWhere(range,'created_at')}`);
    const totalRevenue = parseFloat(revResult.rows[0].total_revenue) || 0;
    const totalOrders  = parseInt(revResult.rows[0].total_orders)    || 0;

    // Cost based on restock purchases in same period
    const costResult = await db.execute(`SELECT COALESCE(SUM(total_cost),0) AS total_cost FROM restock_purchases WHERE user_id = ${uid} ${dateWhere(range,'created_at')}`);
    const totalCost   = parseFloat(costResult.rows[0].total_cost) || 0;
    const totalProfit  = totalRevenue - totalCost;
    const profitMargin = totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100).toFixed(1) : '0.0';

    const topResult = await db.execute(`SELECT oi.name, SUM(oi.quantity) AS units_sold, SUM(oi.subtotal) AS revenue, oi.recipe_id FROM order_items oi JOIN orders o ON oi.order_id = o.id WHERE o.user_id = ${uid} ${dateWhere(range,'o.created_at')} GROUP BY oi.recipe_id, oi.name ORDER BY units_sold DESC LIMIT 5`);
    const topProducts = topResult.rows.map(r => ({ name: r.name, unitsSold: r.units_sold, revenue: parseFloat(r.revenue).toFixed(2), recipeId: r.recipe_id }));

    const catResult = await db.execute(`SELECT r.category, SUM(oi.subtotal) AS revenue, SUM(oi.quantity) AS units FROM order_items oi JOIN orders o ON oi.order_id = o.id JOIN recipes r ON oi.recipe_id = r.id WHERE o.user_id = ${uid} ${dateWhere(range,'o.created_at')} GROUP BY r.category ORDER BY revenue DESC`);
    const salesByCategory = catResult.rows.map(r => ({ category: r.category, revenue: parseFloat(r.revenue).toFixed(2), units: r.units }));

    const marginResult = await db.execute(`SELECT r.id, r.name, r.selling_price, COALESCE(oi_agg.units_sold,0) AS units_sold, COALESCE(oi_agg.total_revenue,0) AS total_revenue FROM recipes r LEFT JOIN (SELECT oi.recipe_id, SUM(oi.quantity) AS units_sold, SUM(oi.subtotal) AS total_revenue FROM order_items oi JOIN orders o ON oi.order_id = o.id WHERE o.user_id = ${uid} ${dateWhere(range,'o.created_at')} GROUP BY oi.recipe_id) oi_agg ON r.id = oi_agg.recipe_id WHERE r.user_id = ${uid} ORDER BY units_sold DESC`);
    const productMargins = marginResult.rows.map(r => {
      const sellingPrice = parseFloat(r.selling_price) || 0;
      const unitsSold    = parseInt(r.units_sold) || 0;
      const totalRev     = parseFloat(r.total_revenue) || 0;
      const totalCostItem= 0; // cost per recipe not tracked at ingredient level in this version
      const profit       = totalRev - totalCostItem;
      const margin       = sellingPrice > 0 ? ((sellingPrice / sellingPrice) * 100).toFixed(1) : '0.0';
      return { name: r.name, sellingPrice: sellingPrice.toFixed(2), cost: '0.00', unitsSold, totalRevenue: totalRev.toFixed(2), totalCost: totalCostItem.toFixed(2), totalProfit: profit.toFixed(2), margin };
    });

    // Trend
    let trendSQL;
    if (range === 'daily')        trendSQL = `SELECT strftime('%H:00', created_at) AS label, COALESCE(SUM(total),0) AS value FROM orders WHERE user_id = ${uid} AND DATE(created_at) = DATE('now') GROUP BY strftime('%H', created_at) ORDER BY label`;
    else if (range === 'weekly')  trendSQL = `SELECT strftime('%m/%d', created_at) AS label, COALESCE(SUM(total),0) AS value FROM orders WHERE user_id = ${uid} AND created_at >= DATE('now','-7 days') GROUP BY DATE(created_at) ORDER BY created_at`;
    else if (range === 'monthly') trendSQL = `SELECT strftime('%m/%d', created_at) AS label, COALESCE(SUM(total),0) AS value FROM orders WHERE user_id = ${uid} AND created_at >= DATE('now','-30 days') GROUP BY DATE(created_at) ORDER BY created_at`;
    else                          trendSQL = `SELECT strftime('%Y-%m', created_at) AS label, COALESCE(SUM(total),0) AS value FROM orders WHERE user_id = ${uid} GROUP BY strftime('%Y-%m', created_at) ORDER BY label`;

    const trendResult  = await db.execute(trendSQL);
    const revenueTrend = trendResult.rows.map(r => ({ label: r.label, value: parseFloat(r.value) }));
    const profitTrend  = revenueTrend.map(rv => ({ label: rv.label, revenue: rv.value, cost: 0, profit: rv.value }));

    return res.json({ summary: { totalRevenue: +totalRevenue.toFixed(2), totalCost: +totalCost.toFixed(2), totalProfit: +totalProfit.toFixed(2), profitMargin, totalOrders }, topProducts, salesByCategory, productMargins, revenueTrend, profitTrend });
  } catch (err) {
    console.error('[GET /analytics]', err);
    return res.status(500).json({ message: 'Server error.', error: err.message });
  }
});

module.exports = router;