require('dotenv').config();
const { createClient } = require('@libsql/client');

const client = createClient({
  url:       process.env.TURSO_URL,
  authToken: process.env.TURSO_TOKEN,
});

async function migrate() {
  try {
    console.log('Adding product_id to recipes...');
    await client.execute(`ALTER TABLE recipes ADD COLUMN product_id INTEGER;`);
    console.log('Done.');
  } catch (e) {
    console.log('Error (might already exist):', e.message);
  }

  try {
    console.log('Adding ingredient_inventory_id to recipe_ingredients...');
    await client.execute(`ALTER TABLE recipe_ingredients ADD COLUMN ingredient_inventory_id INTEGER;`);
    console.log('Done.');
  } catch (e) {
    console.log('Error (might already exist):', e.message);
  }

  console.log('Migration complete.');
}

migrate();
