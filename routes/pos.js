const express      = require('express');
const getDb        = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();
router.use(requireAuth);

// GET /api/pos/products
router.get('/products', async (req, res) => {
  try {
    const db     = await getDb();
    const result = await db.execute(`SELECT id, name, category, selling_price, description FROM recipes WHERE user_id = ${req.user.id} ORDER BY category, name`);
    return res.json({ products: result.rows });
  } catch (err) {
    console.error('[GET /pos/products]', err);
    return res.status(500).json({ message: 'Server error.' });
  }
});

// POST /api/pos/orders
router.post('/orders', async (req, res) => {
  const { items, paymentMethod, amountPaid } = req.body;
  if (!items || items.length === 0)
    return res.status(400).json({ message: 'No items in order.' });
  if (!['Cash', 'GCash', 'Card'].includes(paymentMethod))
    return res.status(400).json({ message: 'Invalid payment method.' });
  const total  = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  const paid   = parseFloat(amountPaid) || total;
  const change = paymentMethod === 'Cash' ? Math.max(0, paid - total) : 0;
  if (paymentMethod === 'Cash' && paid < total)
    return res.status(400).json({ message: 'Amount paid is less than total.' });
  try {
    const db = await getDb();
    await db.execute({ sql: `INSERT INTO orders (user_id, total, payment_method, amount_paid, change_given) VALUES (?, ?, ?, ?, ?)`, args: [req.user.id, +total.toFixed(2), paymentMethod, +paid.toFixed(2), +change.toFixed(2)] });
    const orderIdResult = await db.execute(`SELECT MAX(id) as id FROM orders WHERE user_id = ${req.user.id}`);
    const orderId       = orderIdResult.rows[0].id;
    for (const item of items) {
      const subtotal = item.unitPrice * item.quantity;
      await db.execute({ sql: `INSERT INTO order_items (order_id, recipe_id, name, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?, ?)`, args: [orderId, item.recipeId, item.name, item.quantity, item.unitPrice, +subtotal.toFixed(2)] });
    }
    // Auto-deduct ingredients
    for (const item of items) {
      const ingResult = await db.execute(`SELECT ri.inventory_id, ri.quantity as ing_qty FROM recipe_ingredients ri WHERE ri.recipe_id = ${item.recipeId} AND ri.inventory_id IS NOT NULL`);
      for (const ing of ingResult.rows) {
        const deductQty = parseFloat(ing.ing_qty) * item.quantity;
        await db.execute({ sql: `UPDATE inventory SET quantity = MAX(0, quantity - ?), updated_at = datetime('now') WHERE id = ?`, args: [deductQty, ing.inventory_id] });
      }
    }
    return res.status(201).json({ message: 'Order completed successfully.', orderId, total: +total.toFixed(2), change: +change.toFixed(2) });
  } catch (err) {
    console.error('[POST /pos/orders]', err);
    return res.status(500).json({ message: 'Server error.' });
  }
});

// GET /api/pos/orders
router.get('/orders', async (req, res) => {
  try {
    const db           = await getDb();
    const ordersResult = await db.execute(`SELECT * FROM orders WHERE user_id = ${req.user.id} ORDER BY created_at DESC LIMIT 50`);
    if (!ordersResult.rows.length) return res.json({ orders: [] });
    const orders = await Promise.all(ordersResult.rows.map(async order => {
      const itemsResult = await db.execute(`SELECT * FROM order_items WHERE order_id = ${order.id}`);
      return { ...order, items: itemsResult.rows };
    }));
    return res.json({ orders });
  } catch (err) {
    console.error('[GET /pos/orders]', err);
    return res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;