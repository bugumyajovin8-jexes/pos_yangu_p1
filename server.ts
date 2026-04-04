import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';
import { authRouter } from './server/routes/auth';
import { syncRouter } from './server/routes/sync';
import { adminRouter } from './server/routes/admin';
import { licenseRouter } from './server/routes/license';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Health check - Move to top to ensure it's reachable
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  app.get('/api/ping', (req, res) => {
    res.send('pong');
  });

  app.use(express.json());

  // API Routes
  app.use('/api/auth', authRouter);
  app.use('/api/sync', syncRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/license', licenseRouter);

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
