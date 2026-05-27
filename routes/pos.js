const express      = require('express');
const getDb        = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();
router.use(requireAuth);

// GET /api/pos/products — includes stock_on_hand from product_inventory
router.get('/products', async (req, res) => {
  try {
    const db     = await getDb();
    const result = await db.execute(
      `SELECT r.id, r.name, r.category, r.selling_price, r.description,
              COALESCE(pi.quantity, -1) as stock_on_hand,
              COALESCE(pi.min_stock, 0) as min_stock,
              pi.id as product_inventory_id
       FROM recipes r
       LEFT JOIN product_inventory pi ON pi.recipe_id = r.id AND pi.user_id = r.user_id
       WHERE r.user_id = ${req.user.id}
       ORDER BY r.category, r.name`
    );
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

  try {
    const db = await getDb();
    const uid = req.user.id;

    // 1. Calculate totals and create your order records...
    // (Keep your existing order / order_items insert logic here)
    // Let's assume order creation yields an orderId and total costs.

    // 2. Loop over every item sold in the POS to deduct stock
    for (const item of items) {
      const orderQty = parseInt(item.quantity) || 0;
      const recipeId = item.recipeId || item.id; // Make sure this matches your frontend payload key

      // --- Deduct Pre-made Stock (product_inventory) ---
      await db.execute({
        sql: `UPDATE product_inventory 
              SET quantity = MAX(0, quantity - ?), updated_at = datetime('now') 
              WHERE recipe_id = ? AND user_id = ?`,
        args: [orderQty, recipeId, uid]
      });

      // --- Deduct Raw Materials (inventory) ---
      // Fetch ingredients mapped to this recipe
      const ingredientsResult = await db.execute({
        sql: `SELECT ingredient_inventory_id, quantity FROM recipe_ingredients WHERE recipe_id = ?`,
        args: [recipeId]
      });

      for (const ing of ingredientsResult.rows) {
        if (ing.ingredient_inventory_id) {
          // Total raw quantity to deduct = recipe amount * number of items ordered
          const totalDeduct = ing.quantity * orderQty;

          await db.execute({
            sql: `UPDATE inventory 
                  SET quantity = MAX(0, quantity - ?), updated_at = datetime('now') 
                  WHERE id = ? AND user_id = ?`,
            args: [totalDeduct, ing.ingredient_inventory_id, uid]
          });
        }
      }
    }

    // Return your success response matching your current frontend expectations
    return res.status(201).json({ message: 'Order completed successfully.' });

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