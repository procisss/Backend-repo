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

    const orderItems = [];
    for (const item of items) {
      const orderQty = parseInt(item.quantity, 10) || 0;
      const recipeId = parseInt(item.recipeId || item.id, 10);
      const productInventoryId = item.productInventoryId ? parseInt(item.productInventoryId, 10) : null;

      if (!recipeId || orderQty <= 0) {
        return res.status(400).json({ message: 'Invalid order item.' });
      }

      const recipeResult = await db.execute({
        sql: `SELECT id, name, selling_price FROM recipes WHERE id = ? AND user_id = ?`,
        args: [recipeId, uid]
      });

      if (!recipeResult.rows.length) {
        return res.status(404).json({ message: `Product not found for recipe ${recipeId}.` });
      }

      const recipe = recipeResult.rows[0];
      const stockResult = await db.execute({
        sql: `SELECT id, quantity FROM product_inventory WHERE user_id = ? AND (recipe_id = ? OR id = ?) LIMIT 1`,
        args: [uid, recipeId, productInventoryId || -1]
      });

      if (stockResult.rows.length && Number(stockResult.rows[0].quantity) < orderQty) {
        return res.status(400).json({ message: `${recipe.name} only has ${stockResult.rows[0].quantity} left in stock.` });
      }

      const unitPrice = parseFloat(item.unitPrice ?? recipe.selling_price) || 0;
      orderItems.push({
        recipeId,
        productInventoryId,
        name: recipe.name,
        quantity: orderQty,
        unitPrice,
        subtotal: +(unitPrice * orderQty).toFixed(2)
      });
    }

    const total = +orderItems.reduce((sum, item) => sum + item.subtotal, 0).toFixed(2);
    const paid = paymentMethod === 'Cash' ? (parseFloat(amountPaid) || 0) : total;
    const change = paymentMethod === 'Cash' ? Math.max(0, paid - total) : 0;

    if (paymentMethod === 'Cash' && paid < total) {
      return res.status(400).json({ message: 'Amount paid is less than the order total.' });
    }

    await db.execute({
      sql: `INSERT INTO orders (user_id, total, payment_method, amount_paid, change_given, status, created_at)
            VALUES (?, ?, ?, ?, ?, 'completed', datetime('now'))`,
      args: [uid, total, paymentMethod || 'Cash', paid, +change.toFixed(2)]
    });
    const orderIdResult = await db.execute(`SELECT id FROM orders WHERE user_id = ${uid} ORDER BY id DESC LIMIT 1`);
    const orderId = orderIdResult.rows[0].id;

    // 2. Loop over every item sold in the POS to deduct stock
    for (const item of orderItems) {
      await db.execute({
        sql: `INSERT INTO order_items (order_id, recipe_id, name, quantity, unit_price, subtotal)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [orderId, item.recipeId, item.name, item.quantity, item.unitPrice, item.subtotal]
      });

      // --- Deduct Pre-made Stock (product_inventory) ---
      await db.execute({
        sql: `UPDATE product_inventory 
              SET quantity = MAX(0, quantity - ?), updated_at = datetime('now') 
              WHERE user_id = ? AND (recipe_id = ? OR id = ?)`,
        args: [item.quantity, uid, item.recipeId, item.productInventoryId || -1]
      });

      // --- Deduct Raw Materials (inventory) ---
      // Fetch ingredients mapped to this recipe
      const ingredientsResult = await db.execute({
        sql: `SELECT inventory_id, ingredient_inventory_id, quantity FROM recipe_ingredients WHERE recipe_id = ?`,
        args: [item.recipeId]
      });

      for (const ing of ingredientsResult.rows) {
        const inventoryId = ing.inventory_id || ing.ingredient_inventory_id;
        if (inventoryId) {
          // Total raw quantity to deduct = recipe amount * number of items ordered
          const totalDeduct = ing.quantity * item.quantity;

          await db.execute({
            sql: `UPDATE inventory 
                  SET quantity = MAX(0, quantity - ?), updated_at = datetime('now') 
                  WHERE id = ? AND user_id = ?`,
            args: [totalDeduct, inventoryId, uid]
          });
        }
      }
    }

    // Return your success response matching your current frontend expectations
    return res.status(201).json({ message: 'Order completed successfully.', orderId, total, change: +change.toFixed(2) });

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