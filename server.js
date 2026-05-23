require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const app        = express();
const PORT       = process.env.PORT || 3000;

app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3001',
    'https://procis.vercel.app',
  ],
  credentials: true,
}));
app.use(express.json());

app.use('/api/auth',      require('./routes/auth'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/recipes',   require('./routes/recipes'));
app.use('/api/pos',       require('./routes/pos'));
app.use('/api/purchases', require('./routes/purchases'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/premium',   require('./routes/premium'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/admin',     require('./routes/admin'));
app.use('/api/alerts',    require('./routes/alerts'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.use((req, res) => res.status(404).json({ message: `Route ${req.method} ${req.path} not found.` }));

module.exports = app;