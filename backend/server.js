const express = require('express');
const cors = require('cors');
const path = require('path');
const aiRoutes = require('./routes/ai');

const app = express();
const PORT = process.env.PORT || 7860;
const HOST = process.env.HOST || '0.0.0.0';

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint (ModelSpace requirement)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/ai', aiRoutes);

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../frontend')));

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
