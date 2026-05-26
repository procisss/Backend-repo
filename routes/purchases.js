const express         = require('express');
const getDb           = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();
router.use(requireAuth);

// GET /api/purchases
router.get('/', async (req, res) => {
  try {
    const db     = await getDb();
    const result = await db.execute(`SELECT * FROM restock_purchases WHERE user_id = ${req.user.id} ORDER BY created_at DESC`);
    if (!result.rows.length) return res.json({ purchases: [], stats: { totalRestocks: 0, totalSpent: 0, thisMonthSpent: 0, itemsRestocked: 0 } });

    const purchases = await Promise.all(result.rows.map(async p => {
      const items = await db.execute(`SELECT * FROM restock_items WHERE restock_purchase_id = ${p.id} ORDER BY id ASC`);
      return { ...p, items: items.rows };
    }));

    const now        = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    const totalSpent      = purchases.reduce((s, p) => s + (p.total_cost || 0), 0);
    const thisMonthSpent  = purchases.filter(p => p.created_at >= monthStart).reduce((s, p) => s + (p.total_cost || 0), 0);
    const itemsRestocked  = purchases.reduce((s, p) => s + (p.items?.length || 0), 0);

    return res.json({ purchases, stats: { totalRestocks: purchases.length, totalSpent: +totalSpent.toFixed(2), thisMonthSpent: +thisMonthSpent.toFixed(2), itemsRestocked } });
  } catch (err) {
    console.error('[GET /purchases]', err);
    return res.status(500).json({ message: 'Server error.', error: err.message });
  }
});

// POST /api/purchases
router.post('/', async (req, res) => {
  const { notes, items } = req.body;
  if (!items || items.length === 0)
    return res.status(400).json({ message: 'Add at least one item.' });
  for (const item of items) {
    if (!item.name || !item.name.trim())
      return res.status(400).json({ message: 'Each item must have a name.' });
    if (!item.quantity || parseFloat(item.quantity) <= 0)
      return res.status(400).json({ message: `Quantity for "${item.name}" must be greater than 0.` });
  }
  const grandTotal = items.reduce((s, i) => s + (parseFloat(i.totalCost) || 0), 0);
  try {
    const db = await getDb();
    await db.execute({ sql: `INSERT INTO restock_purchases (user_id, notes, total_cost) VALUES (?, ?, ?)`, args: [req.user.id, notes || '', +grandTotal.toFixed(2)] });
    const idRes     = await db.execute(`SELECT MAX(id) as id FROM restock_purchases WHERE user_id = ${req.user.id}`);
    const restockId = idRes.rows[0].id;

    for (const item of items) {
      const qty       = parseFloat(item.quantity) || 0;
      const cost      = parseFloat(item.totalCost) || 0;
      const invId     = item.inventoryId ? parseInt(item.inventoryId) : null;
      const nameClean = item.name.trim();
      const unit      = item.unit || 'pcs';

      await db.execute({ sql: `INSERT INTO restock_items (restock_purchase_id, inventory_id, name, quantity, unit, total_cost) VALUES (?, ?, ?, ?, ?, ?)`, args: [restockId, invId, nameClean, qty, unit, +cost.toFixed(2)] });

      if (invId) {
        const existing = await db.execute(
          `SELECT id, stock_price FROM inventory WHERE id = ${invId} AND user_id = ${req.user.id}`
        );

        if (existing.rows.length) {
          const oldPrice = existing.rows[0].stock_price || 0;

          await db.execute({
            sql: `
              UPDATE inventory
              SET
                quantity = quantity + ?,
                stock_price = ?,
                updated_at = datetime('now')
              WHERE id = ? AND user_id = ?
            `,
            args: [
              qty,
              +(oldPrice + cost).toFixed(2),
              invId,
              req.user.id
            ]
          });
        }

      } else {

        const nameMatch = await db.execute(
          `SELECT id, stock_price
          FROM inventory
          WHERE user_id = ${req.user.id}
          AND LOWER(TRIM(name)) = LOWER(TRIM('${nameClean.replace(/'/g, "''")}'))`
        );

        if (nameMatch.rows.length) {

          const existId  = nameMatch.rows[0].id;
          const oldPrice = nameMatch.rows[0].stock_price || 0;

          await db.execute({
            sql: `
              UPDATE inventory
              SET
                quantity = quantity + ?,
                stock_price = ?,
                updated_at = datetime('now')
              WHERE id = ?
            `,
            args: [
              qty,
              +(oldPrice + cost).toFixed(2),
              existId
            ]
          });

        } else {

          await db.execute({
            sql: `
              INSERT INTO inventory
              (user_id, name, quantity, unit, stock_price, min_stock)
              VALUES (?, ?, ?, ?, ?, 0)
            `,
            args: [
              req.user.id,
              nameClean,
              qty,
              unit,
              +cost.toFixed(2)
            ]
          });

        }
      }
    }
    return res.status(201).json({ message: 'Restock recorded and inventory updated.', restockId, totalCost: +grandTotal.toFixed(2), itemCount: items.length });
  } catch (err) {
    console.error('[POST /purchases]', err);
    return res.status(500).json({ message: 'Server error.', error: err.message });
  }
});

// DELETE /api/purchases/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const db    = await getDb();
    const owner = await db.execute(`SELECT id FROM restock_purchases WHERE id = ${id} AND user_id = ${req.user.id}`);
    if (!owner.rows.length)
      return res.status(404).json({ message: 'Restock record not found.' });
    await db.execute(`DELETE FROM restock_items WHERE restock_purchase_id = ${id}`);
    await db.execute(`DELETE FROM restock_purchases WHERE id = ${id} AND user_id = ${req.user.id}`);
    return res.json({ message: 'Restock record deleted.' });
  } catch (err) {
    console.error('[DELETE /purchases/:id]', err);
    return res.status(500).json({ message: 'Server error.', error: err.message });
  }
});

router.get('/suppliers',  async (req, res) => res.json({ suppliers: [] }));
router.post('/suppliers', async (req, res) => res.status(410).json({ message: 'Suppliers not used in this version.' }));

module.exports = router;