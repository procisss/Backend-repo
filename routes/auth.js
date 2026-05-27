const express  = require('express');
const bcrypt   = require('bcryptjs');
const getDb    = require('../db');
const { signToken }   = require('../utils/jwt');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

// SIGNUP
router.post('/signup', async (req, res) => {
  const { businessName, ownerName, email, phone, password } = req.body;
  if (!businessName || !email || !password)
    return res.status(400).json({ message: 'Business name, email and password are required.' });
  if (!isValidEmail(email))
    return res.status(400).json({ message: 'Please enter a valid email address.' });
  if (password.length < 8)
    return res.status(400).json({ message: 'Password must be at least 8 characters.' });
  try {
    const db = await getDb();
    const existing = await db.execute(`SELECT id FROM users WHERE email = '${email.toLowerCase().trim()}'`);
    if (existing.rows.length > 0)
      return res.status(409).json({ message: 'An account with this email already exists.' });
    const passwordHash = await bcrypt.hash(password, 12);
    await db.execute({
      sql: `INSERT INTO users (business_name, owner_name, email, phone, password_hash) VALUES (?, ?, ?, ?, ?)`,
      args: [businessName.trim(), ownerName?.trim() || null, email.toLowerCase().trim(), phone?.trim() || null, passwordHash],
    });
    const result = await db.execute(`SELECT MAX(id) as id FROM users`);
    const userId = result.rows[0].id;
    const token = signToken({ id: userId, email: email.toLowerCase().trim(), businessName: businessName.trim(), role: 'user', plan: 'free' });
    return res.status(201).json({ message: 'Account created successfully.', token, user: { id: userId, businessName: businessName.trim(), email: email.toLowerCase().trim(), plan: 'free' } });
  } catch (err) {
    console.error('[signup]', err);
    return res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

// LOGIN
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ message: 'Email and password are required.' });
  try {
    const db = await getDb();
    const result = await db.execute(`SELECT id, business_name, owner_name, email, password_hash, plan, status FROM users WHERE email = '${email.toLowerCase().trim()}'`);
    if (result.rows.length === 0)
      return res.status(401).json({ message: 'Invalid email or password.' });
    const user = result.rows[0];
    if (user.status === 'inactive')
      return res.status(403).json({ message: 'Account deactivated. Contact support.' });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match)
      return res.status(401).json({ message: 'Invalid email or password.' });
    const token = signToken({ id: user.id, email: user.email, businessName: user.business_name, role: 'user', plan: user.plan });
    return res.status(200).json({ message: 'Login successful.', token, user: { id: user.id, businessName: user.business_name, email: user.email, plan: user.plan } });
  } catch (err) {
    console.error('[login]', err);
    return res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

// ADMIN LOGIN
router.post('/admin-login', (req, res) => {
  const { email, password } = req.body;
  const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'admin@procis.com';
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';
  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD)
    return res.status(401).json({ message: 'Invalid admin credentials.' });
  const token = signToken({ id: 0, email: ADMIN_EMAIL, role: 'admin' });
  return res.status(200).json({ message: 'Admin login successful.', token });
});

// ME
router.get('/me', requireAuth, async (req, res) => {
  if (req.user.role === 'admin') return res.json({ user: req.user });
  try {
    const db = await getDb();
    const result = await db.execute(`SELECT * FROM users WHERE id = ${req.user.id}`);
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'User not found.' });
    const raw = result.rows[0];
    return res.json({ user: { id: raw.id, businessName: raw.business_name, ownerName: raw.owner_name, email: raw.email, phone: raw.phone, plan: raw.plan, status: raw.status, createdAt: raw.created_at } });
  } catch (err) {
    console.error('[me]', err);
    return res.status(500).json({ message: 'Server error.' });
  }
});

// PUT /me - Update Profile
router.put('/me', requireAuth, async (req, res) => {
  if (req.user.role === 'admin') return res.status(403).json({ message: 'Admins cannot update profile here.' });
  const { businessName, ownerName } = req.body;
  if (!businessName) return res.status(400).json({ message: 'Business name is required.' });
  
  try {
    const db = await getDb();
    await db.execute({
      sql: `UPDATE users SET business_name = ?, owner_name = ? WHERE id = ?`,
      args: [businessName.trim(), ownerName?.trim() || null, req.user.id]
    });
    return res.json({ message: 'Profile updated successfully.' });
  } catch (err) {
    console.error('[PUT /me]', err);
    return res.status(500).json({ message: 'Server error.' });
  }
});

// DELETE /api/auth/delete-account
router.delete('/delete-account', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const id = req.user.id;

    // Delete all related data first
    await db.execute(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = ${id})`);
    await db.execute(`DELETE FROM orders WHERE user_id = ${id}`);
    await db.execute(`DELETE FROM recipe_ingredients WHERE recipe_id IN (SELECT id FROM recipes WHERE user_id = ${id})`);
    await db.execute(`DELETE FROM recipes WHERE user_id = ${id}`);
    await db.execute(`DELETE FROM inventory WHERE user_id = ${id}`);
    await db.execute(`DELETE FROM restock_items WHERE restock_purchase_id IN (SELECT id FROM restock_purchases WHERE user_id = ${id})`);
    await db.execute(`DELETE FROM restock_purchases WHERE user_id = ${id}`);
    await db.execute(`DELETE FROM alerts WHERE user_id = ${id}`);
    await db.execute(`DELETE FROM subscriptions WHERE user_id = ${id}`);
    await db.execute(`DELETE FROM upgrade_requests WHERE user_id = ${id}`);

    // Delete the user account itself
    await db.execute(`DELETE FROM users WHERE id = ${id}`);

    return res.json({ message: 'Account deleted successfully.' });
  } catch (err) {
    console.error('[DELETE /auth/delete-account]', err);
    return res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;