const express = require('express');
const getDb = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

async function getIngredients(db, recipeId) {
  const result = await db.execute(
    `SELECT * FROM recipe_ingredients WHERE recipe_id = ?`,
    [recipeId]
  );

  return result.rows;
}

// GET /api/recipes
router.get('/', async (req, res) => {
  try {
    const db = await getDb();

    const result = await db.execute(
      `SELECT * FROM recipes WHERE user_id = ? ORDER BY name ASC`,
      [req.user.id]
    );

    if (!result.rows.length) {
      return res.json({ recipes: [] });
    }

    const recipes = await Promise.all(
      result.rows.map(async (recipe) => {
        const ingredients = await getIngredients(db, recipe.id);

        return {
          ...recipe,
          ingredients,
        };
      })
    );

    return res.json({ recipes });

  } catch (err) {
    console.error('[GET /recipes]', err);
    return res.status(500).json({ message: 'Server error.' });
  }
});

// POST /api/recipes
router.post('/', async (req, res) => {
  const {
    name,
    category,
    sellingPrice,
    sellingUnit,
    description,
    ingredients
  } = req.body;

  if (!name || !category) {
    return res.status(400).json({
      message: 'Name and category are required.'
    });
  }

  if (!ingredients || ingredients.length === 0) {
    return res.status(400).json({
      message: 'Add at least one ingredient.'
    });
  }

  try {
    const db = await getDb();

    const existing = await db.execute({
      sql: `
        SELECT id
        FROM recipes
        WHERE user_id = ?
        AND LOWER(name) = LOWER(?)
      `,
      args: [req.user.id, name.trim()]
    });

    if (existing.rows.length) {
      return res.status(409).json({
        message: 'A recipe with this name already exists.'
      });
    }

    await db.execute({
      sql: `
        INSERT INTO recipes
        (user_id, name, category, selling_price, selling_unit, description)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      args: [
        req.user.id,
        name.trim(),
        category.trim(),
        parseFloat(sellingPrice) || 0,
        sellingUnit || 'pcs',
        description || ''
      ]
    });

    const idResult = await db.execute({
      sql: `SELECT MAX(id) as id FROM recipes WHERE user_id = ?`,
      args: [req.user.id]
    });

    const recipeId = idResult.rows[0].id;

    for (const ing of ingredients) {
      await db.execute({
        sql: `
          INSERT INTO recipe_ingredients
          (recipe_id, inventory_id, name, quantity, unit)
          VALUES (?, ?, ?, ?, ?)
        `,
        args: [
          recipeId,
          ing.inventoryId || null,
          ing.name.trim(),
          parseFloat(ing.quantity) || 0,
          ing.unit || 'pcs'
        ]
      });
    }

    return res.status(201).json({
      message: 'Recipe created successfully.',
      recipeId
    });

  } catch (err) {
    console.error('[POST /recipes]', err);
    return res.status(500).json({ message: 'Server error.' });
  }
});

// PUT /api/recipes/:id
router.put('/:id', async (req, res) => {
  const { id } = req.params;

  const {
    name,
    category,
    sellingPrice,
    sellingUnit,
    description,
    ingredients
  } = req.body;

  if (!name || !category) {
    return res.status(400).json({
      message: 'Name and category are required.'
    });
  }

  if (!ingredients || ingredients.length === 0) {
    return res.status(400).json({
      message: 'Add at least one ingredient.'
    });
  }

  try {
    const db = await getDb();

    const owner = await db.execute({
      sql: `
        SELECT id
        FROM recipes
        WHERE id = ?
        AND user_id = ?
      `,
      args: [id, req.user.id]
    });

    if (!owner.rows.length) {
      return res.status(404).json({
        message: 'Recipe not found.'
      });
    }

    await db.execute({
      sql: `
        UPDATE recipes
        SET
          name = ?,
          category = ?,
          selling_price = ?,
          selling_unit = ?,
          description = ?,
          updated_at = datetime('now')
        WHERE id = ?
        AND user_id = ?
      `,
      args: [
        name.trim(),
        category.trim(),
        parseFloat(sellingPrice) || 0,
        sellingUnit || 'pcs',
        description || '',
        id,
        req.user.id
      ]
    });

    await db.execute({
      sql: `DELETE FROM recipe_ingredients WHERE recipe_id = ?`,
      args: [id]
    });

    for (const ing of ingredients) {
      await db.execute({
        sql: `
          INSERT INTO recipe_ingredients
          (recipe_id, inventory_id, name, quantity, unit)
          VALUES (?, ?, ?, ?, ?)
        `,
        args: [
          id,
          ing.inventoryId || null,
          ing.name.trim(),
          parseFloat(ing.quantity) || 0,
          ing.unit || 'pcs'
        ]
      });
    }

    return res.json({
      message: 'Recipe updated successfully.'
    });

  } catch (err) {
    console.error('[PUT /recipes/:id]', err);
    return res.status(500).json({ message: 'Server error.' });
  }
});

// DELETE /api/recipes/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const db = await getDb();

    const owner = await db.execute({
      sql: `
        SELECT id
        FROM recipes
        WHERE id = ?
        AND user_id = ?
      `,
      args: [id, req.user.id]
    });

    if (!owner.rows.length) {
      return res.status(404).json({
        message: 'Recipe not found.'
      });
    }

    await db.execute({
      sql: `DELETE FROM recipe_ingredients WHERE recipe_id = ?`,
      args: [id]
    });

    await db.execute({
      sql: `
        DELETE FROM recipes
        WHERE id = ?
        AND user_id = ?
      `,
      args: [id, req.user.id]
    });

    return res.json({
      message: 'Recipe deleted successfully.'
    });

  } catch (err) {
    console.error('[DELETE /recipes/:id]', err);
    return res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;