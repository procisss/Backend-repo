// middleware/auth.js
const { verifyToken } = require('../utils/jwt');

function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'No token provided. Please log in.' });
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch (err) {
    const msg = err.name === 'TokenExpiredError'
      ? 'Session expired. Please log in again.'
      : 'Invalid token. Please log in again.';
    return res.status(401).json({ message: msg });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required.' });
    }
    next();
  });
}

// DELETE /api/auth/delete-account
router.delete('/delete-account', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const id = req.user.id;
    await db.execute(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = ${id})`);
    await db.execute(`DELETE FROM orders WHERE user_id = ${id}`);
    await db.execute(`DELETE FROM recipe_ingredients WHERE recipe_id IN (SELECT id FROM recipes WHERE user_id = ${id})`);
    await db.execute(`DELETE FROM recipes WHERE user_id = ${id}`);
    await db.execute(`DELETE FROM inventory WHERE user_id = ${id}`);
    await db.execute(`DELETE FROM restock_items WHERE restock_purchase_id IN (SELECT id FROM restock_purchases WHERE user_id = ${id})`);
    await db.execute(`DELETE FROM restock_purchases WHERE user_id = ${id}`);
    await db.execute(`DELETE FROM manual_alerts WHERE user_id = ${id}`);
    await db.execute(`DELETE FROM subscriptions WHERE user_id = ${id}`);
    await db.execute(`DELETE FROM upgrade_requests WHERE user_id = ${id}`);
    await db.execute(`DELETE FROM users WHERE id = ${id}`);
    return res.json({ message: 'Account deleted successfully.' });
  } catch (err) {
    console.error('[DELETE /auth/delete-account]', err);
    return res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = { requireAuth, requireAdmin };