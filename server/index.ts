/**
 * Express API Server
 * Provides REST API and SSE endpoints for the scraper web UI
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

import plansRouter from './routes/plans';
import resultsRouter from './routes/results';
import tasksRouter from './routes/tasks';

const app = express();
const PORT = process.env.API_PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

// API Routes
app.use('/api/plans', plansRouter);
app.use('/api/results', resultsRouter);
app.use('/api/tasks', tasksRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  const webDistPath = path.join(__dirname, '..', 'web', 'dist');
  app.use(express.static(webDistPath));

  // SPA fallback
  app.get('*', (req, res) => {
    res.sendFile(path.join(webDistPath, 'index.html'));
  });
}

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 API Server running on http://localhost:${PORT}`);
  console.log(`📁 Plans directory: ${path.join(process.cwd(), 'plans')}`);
  console.log(`📁 Results directory: ${path.join(process.cwd(), 'execution-results')}`);
  console.log(`📁 Tasks directory: ${path.join(process.cwd(), 'tasks')}`);
});

export default app;
