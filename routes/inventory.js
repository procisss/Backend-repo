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

// GET /api/inventory
router.get('/', async (req, res) => {
  try {
    const db     = await getDb();
    const result = await db.execute(`SELECT id, user_id, name, category, quantity, unit, stock_price, min_stock, created_at, updated_at FROM inventory WHERE user_id = ${req.user.id} ORDER BY name ASC`);
    if (!result.rows.length) return res.json({ items: [], totalValue: 0, lowStockCount: 0 });
    const items = result.rows.map(item => ({ ...item, status: getStatus(item.quantity, item.min_stock) }));
    const totalValue    = items.reduce((a, i) => a + (i.stock_price || 0), 0);
    const lowStockCount = items.filter(i => i.status !== 'good').length;
    return res.json({ items, totalValue: +totalValue.toFixed(2), lowStockCount });
  } catch (err) {
    console.error('[GET /inventory]', err);
    return res.status(500).json({ message: 'Server error.', error: err.message });
  }
});

// POST /api/inventory
router.post('/', async (req, res) => {
  const { name, category, quantity, unit, stockPrice, minStock } = req.body;
  if (!name || !category || !unit)
    return res.status(400).json({ message: 'Name, category, and unit are required.' });
  const qty   = parseFloat(quantity)   || 0;
  const price = parseFloat(stockPrice) || 0;
  const minS  = parseFloat(minStock)   || 0;
  try {
    const db = await getDb();
    const existing = await db.execute(`SELECT id FROM inventory WHERE user_id=${req.user.id} AND LOWER(name)=LOWER('${name.trim().replace(/'/g,"''")}')` );
    if (existing.rows.length)
      return res.status(409).json({ message: 'A product with this name already exists.' });
    await db.execute({ sql: `INSERT INTO inventory (user_id, name, category, quantity, unit, stock_price, min_stock) VALUES (?, ?, ?, ?, ?, ?, ?)`, args: [req.user.id, name.trim(), category, qty, unit, price, minS] });
    const idRes = await db.execute(`SELECT MAX(id) as id FROM inventory WHERE user_id=${req.user.id}`);
    const newId = idRes.rows[0].id;
    return res.status(201).json({ message: 'Product added.', item: { id: newId, name: name.trim(), category, quantity: qty, unit, stock_price: price, min_stock: minS, status: getStatus(qty, minS) } });
  } catch (err) {
    console.error('[POST /inventory]', err);
    return res.status(500).json({ message: 'Server error.', error: err.message });
  }
});

// PUT /api/inventory/:id
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, category, quantity, unit, stockPrice, minStock } = req.body;
  if (!name || !category || !unit)
    return res.status(400).json({ message: 'Name, category, and unit are required.' });
  const qty   = parseFloat(quantity)   || 0;
  const price = parseFloat(stockPrice) || 0;
  const minS  = parseFloat(minStock)   || 0;
  try {
    const db    = await getDb();
    const owner = await db.execute(`SELECT id FROM inventory WHERE id=${id} AND user_id=${req.user.id}`);
    if (!owner.rows.length)
      return res.status(404).json({ message: 'Product not found.' });
    await db.execute({ sql: `UPDATE inventory SET name=?, category=?, quantity=?, unit=?, stock_price=?, min_stock=?, updated_at=datetime('now') WHERE id=? AND user_id=?`, args: [name.trim(), category, qty, unit, price, minS, id, req.user.id] });
    return res.json({ message: 'Product updated.' });
  } catch (err) {
    console.error('[PUT /inventory/:id]', err);
    return res.status(500).json({ message: 'Server error.', error: err.message });
  }
});

// DELETE /api/inventory/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const db    = await getDb();
    const owner = await db.execute(`SELECT id FROM inventory WHERE id=${id} AND user_id=${req.user.id}`);
    if (!owner.rows.length)
      return res.status(404).json({ message: 'Product not found.' });
    await db.execute(`DELETE FROM inventory WHERE id=${id} AND user_id=${req.user.id}`);
    return res.json({ message: 'Product deleted.' });
  } catch (err) {
    console.error('[DELETE /inventory/:id]', err);
    return res.status(500).json({ message: 'Server error.', error: err.message });
  }
});

module.exports = router;