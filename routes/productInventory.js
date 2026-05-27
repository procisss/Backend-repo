const express      = require('express');
const getDb        = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();
router.use(requireAuth);

function getStatus(quantity, min_stock) {
  if (quantity <= 0)         return 'critical';
  if (quantity <= min_stock) return 'low';
  return 'good';
}

// GET /api/product-inventory
router.get('/', async (req, res) => {
  try {
    const db     = await getDb();
    const result = await db.execute(
      `SELECT pi.*, r.selling_price
       FROM product_inventory pi
       LEFT JOIN recipes r ON r.id = pi.recipe_id
       WHERE pi.user_id = ${req.user.id}
       ORDER BY pi.name ASC`
    );
    if (!result.rows.length) return res.json({ items: [], totalOnHand: 0, lowStockCount: 0 });
    const items = result.rows.map(item => ({
      ...item,
      status: getStatus(item.quantity, item.min_stock)
    }));
    const totalOnHand   = items.reduce((a, i) => a + (i.quantity || 0), 0);
    const lowStockCount = items.filter(i => i.status !== 'good').length;
    return res.json({ items, totalOnHand, lowStockCount });
  } catch (err) {
    console.error('[GET /product-inventory]', err);
    return res.status(500).json({ message: 'Server error.', error: err.message });
  }
});

// POST /api/product-inventory
router.post('/', async (req, res) => {
  const { name, category, quantity, unit, minStock, recipeId } = req.body;
  if (!name || !unit)
    return res.status(400).json({ message: 'Name and unit are required.' });
  const qty  = parseFloat(quantity) || 0;
  const minS = parseFloat(minStock) || 0;
  const cat  = category || 'General';
  try {
    const db = await getDb();
    const existing = await db.execute(
      `SELECT id FROM product_inventory WHERE user_id=${req.user.id} AND LOWER(name)=LOWER('${name.trim().replace(/'/g,"''")}')`
    );
    if (existing.rows.length)
      return res.status(409).json({ message: 'A product with this name already exists in inventory.' });
    await db.execute({
      sql: `INSERT INTO product_inventory (user_id, recipe_id, name, category, quantity, unit, min_stock) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [req.user.id, recipeId || null, name.trim(), cat, qty, unit, minS]
    });
    const idRes = await db.execute(`SELECT MAX(id) as id FROM product_inventory WHERE user_id=${req.user.id}`);
    const newId = idRes.rows[0].id;
    return res.status(201).json({
      message: 'Product stock added.',
      item: { id: newId, recipe_id: recipeId || null, name: name.trim(), category: cat, quantity: qty, unit, min_stock: minS, status: getStatus(qty, minS) }
    });
  } catch (err) {
    console.error('[POST /product-inventory]', err);
    return res.status(500).json({ message: 'Server error.', error: err.message });
  }
});

// PUT /api/product-inventory/:id
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, category, quantity, unit, minStock, recipeId } = req.body;
  if (!name || !unit)
    return res.status(400).json({ message: 'Name and unit are required.' });
  const qty  = parseFloat(quantity) || 0;
  const minS = parseFloat(minStock) || 0;
  const cat  = category || 'General';
  try {
    const db    = await getDb();
    const owner = await db.execute(`SELECT id FROM product_inventory WHERE id=${id} AND user_id=${req.user.id}`);
    if (!owner.rows.length)
      return res.status(404).json({ message: 'Product not found.' });
    await db.execute({
      sql: `UPDATE product_inventory SET name=?, category=?, quantity=?, unit=?, min_stock=?, recipe_id=?, updated_at=datetime('now') WHERE id=? AND user_id=?`,
      args: [name.trim(), cat, qty, unit, minS, recipeId || null, id, req.user.id]
    });
    return res.json({ message: 'Product stock updated.' });
  } catch (err) {
    console.error('[PUT /product-inventory/:id]', err);
    return res.status(500).json({ message: 'Server error.', error: err.message });
  }
});

// DELETE /api/product-inventory/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const db    = await getDb();
    const owner = await db.execute(`SELECT id FROM product_inventory WHERE id=${id} AND user_id=${req.user.id}`);
    if (!owner.rows.length)
      return res.status(404).json({ message: 'Product not found.' });
    await db.execute(`DELETE FROM product_inventory WHERE id=${id} AND user_id=${req.user.id}`);
    return res.json({ message: 'Product stock deleted.' });
  } catch (err) {
    console.error('[DELETE /product-inventory/:id]', err);
    return res.status(500).json({ message: 'Server error.', error: err.message });
  }
});

module.exports = router;