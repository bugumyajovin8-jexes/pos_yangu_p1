import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import { authenticateToken, requireRole } from './auth';
import { supabase } from '../supabase';

export const adminRouter = Router();

adminRouter.use(authenticateToken);
adminRouter.use(requireRole(['admin', 'superadmin']));

// Get all users for the shop
adminRouter.get('/users', (req: any, res) => {
  const { shop_id } = req.user;
  const users = db.prepare('SELECT id, email, role, is_active, updated_at FROM users WHERE shop_id = ?').all(shop_id);
  res.json(users);
});

// Create new user
adminRouter.post('/users', (req: any, res) => {
  const { shop_id } = req.user;
  const { email, password, role } = req.body;
  
  if (!email || !password || !role) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const passHash = bcrypt.hashSync(password, 10);
    const id = uuidv4();
    const now = Date.now();
    
    db.prepare(`
      INSERT INTO users (id, shop_id, email, password_hash, role, is_active, updated_at) 
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `).run(id, shop_id, email, passHash, role, now);
    
    res.json({ id, email, role, is_active: 1, updated_at: now });
  } catch (error: any) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(400).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Update user (activate/deactivate, change role)
adminRouter.put('/users/:id', async (req: any, res) => {
  const { shop_id } = req.user;
  const { id } = req.params;
  const { is_active, role, password } = req.body;
  const now = Date.now();

  try {
    if (password) {
      const passHash = bcrypt.hashSync(password, 10);
      db.prepare('UPDATE users SET password_hash = ?, role = ?, is_active = ?, updated_at = ? WHERE id = ? AND shop_id = ?')
        .run(passHash, role, is_active ? 1 : 0, now, id, shop_id);
    } else {
      db.prepare('UPDATE users SET role = ?, is_active = ?, updated_at = ? WHERE id = ? AND shop_id = ?')
        .run(role, is_active ? 1 : 0, now, id, shop_id);
    }

    // Sync to Supabase for real-time blocking
    if (supabase) {
      try {
        await supabase
          .from('users')
          .update({
            status: is_active ? 'active' : 'blocked',
            role: role,
            updated_at: new Date(now).toISOString()
          })
          .eq('id', id);
        console.log(`Synced user ${id} status to Supabase: ${is_active ? 'active' : 'blocked'}`);
      } catch (supabaseError) {
        console.error('Failed to sync user status to Supabase:', supabaseError);
      }
    }

    res.json({ success: true, updated_at: now });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Get shop features
adminRouter.get('/features', (req: any, res) => {
  const { shop_id } = req.user;
  const features = db.prepare('SELECT * FROM features WHERE shop_id = ?').all(shop_id);
  res.json(features);
});

// Toggle feature
adminRouter.post('/features', (req: any, res) => {
  const { shop_id } = req.user;
  const { feature_key, is_enabled } = req.body;
  const now = Date.now();

  try {
    const id = uuidv4();
    db.prepare(`
      INSERT INTO features (id, shop_id, feature_key, is_enabled, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(feature_key) DO UPDATE SET
        is_enabled = excluded.is_enabled,
        updated_at = excluded.updated_at
    `).run(id, shop_id, feature_key, is_enabled ? 1 : 0, now);
    res.json({ success: true, updated_at: now });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update feature' });
  }
});
