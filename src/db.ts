import Dexie, { type Table } from 'dexie';
import { EncryptionUtils } from './utils/encryption';
import { useStore } from './store';
import { v4 as uuidv4 } from 'uuid';

export interface Shop {
  id: string;
  name: string;
  owner_name?: string;
  phone?: string;
  status?: string;
  enable_expiry?: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  isDeleted: number; // 0 for false, 1 for true
  is_deleted?: boolean; // Supabase compatibility
  synced: number; // 0 for false, 1 for true
}

export interface User {
  id: string;
  shop_id?: string;
  shopId?: string; // Alias for compatibility
  email: string;
  name: string;
  phone?: string;
  role: 'boss' | 'employee';
  status: 'active' | 'blocked';
  isActive?: boolean; // Alias for compatibility
  last_seen?: string;
  created_at: string;
  updated_at: string;
  isDeleted: number;
  is_deleted?: number; // Alias for compatibility
  synced: number;
}

export interface Product {
  id: string;
  shop_id: string;
  name: string;
  buy_price: number;
  sell_price: number;
  stock: number;
  min_stock: number;
  unit: string;
  batches?: {
    id: string;
    batch_number?: string;
    expiry_date: string;
    stock: number;
  }[];
  notify_expiry_days?: number;
  stock_delta: number;
  isDeleted: number; // 0 for false, 1 for true
  is_deleted?: number; // Alias for compatibility
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface Sale {
  id: string;
  shop_id: string;
  user_id: string;
  total_amount: number;
  total_profit: number;
  payment_method: 'cash' | 'mobile_money' | 'credit';
  status: 'completed' | 'cancelled' | 'refunded' | 'pending';
  customer_name?: string;
  customer_phone?: string;
  due_date?: string;
  is_credit?: boolean; // Web compatibility
  is_paid?: boolean; // Web compatibility
  date?: string; // Web compatibility
  isDeleted: number; // 0 for false, 1 for true
  is_deleted?: number; // Alias for compatibility
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface SaleItem {
  id: string;
  sale_id: string;
  shop_id: string;
  product_id: string;
  product_name: string;
  qty: number;
  buy_price: number;
  sell_price: number;
  profit?: number; // Web compatibility
  isDeleted: number; // 0 for false, 1 for true
  is_deleted?: number; // Alias for compatibility
  created_at: string;
  updated_at?: string;
  synced: number;
}

export interface Expense {
  id: string;
  shop_id: string;
  user_id?: string;
  amount: number;
  category: string;
  description?: string;
  date: string;
  isDeleted: number; // 0 for false, 1 for true
  is_deleted?: number; // Alias for compatibility
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface Settings {
  id: number;
  shopName: string;
  currency: string;
  taxPercentage: number;
  darkMode: boolean;
  lastSync: number;
  shopId?: string;
}

export interface Feature {
  id: string;
  shop_id: string;
  featureKey: string;
  isEnabled: boolean;
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface DebtPayment {
  id: string;
  shop_id: string;
  sale_id: string;
  amount: number;
  date: string;
  isDeleted: number; // 0 for false, 1 for true
  is_deleted?: number; // Alias for compatibility
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface License {
  id: number; // Always 1
  deviceId: string;
  startDate: number;
  expiryDate: number;
  isActive: boolean;
  lastVerifiedAt: number;
  signature?: string; // HMAC signature to prevent tampering
  lastSyncedAt?: number; // Web compatibility
  clockOffset?: number; // Web compatibility
  last_verified_at?: string; // Web compatibility
}

export interface AuditLog {
  id: string;
  shop_id: string;
  user_id: string;
  user_name?: string;
  action: string;
  details: string; // JSON string
  created_at: string;
  synced: number;
}

export class PosDatabase extends Dexie {
  shops!: Table<Shop>;
  users!: Table<User>;
  products!: Table<Product>;
  sales!: Table<Sale>;
  saleItems!: Table<SaleItem>;
  expenses!: Table<Expense>;
  settings!: Table<Settings>;
  features!: Table<Feature>;
  license!: Table<License>;
  debtPayments!: Table<DebtPayment>;
  auditLogs!: Table<AuditLog>;

  constructor() {
    super('PosDatabaseV10'); // Bumped version
    this.version(14).stores({
      shops: 'id, name, created_by, synced, isDeleted',
      users: 'id, shop_id, email, role, synced',
      products: 'id, shop_id, name, synced, isDeleted, [shop_id+isDeleted]',
      sales: 'id, shop_id, user_id, status, created_at, synced, isDeleted, [shop_id+isDeleted]',
      saleItems: 'id, sale_id, shop_id, product_id, synced, isDeleted',
      expenses: 'id, shop_id, category, date, synced, isDeleted, [shop_id+isDeleted]',
      settings: 'id',
      features: 'id, shop_id, featureKey, synced',
      license: 'id',
      debtPayments: 'id, shop_id, sale_id, synced, isDeleted',
      auditLogs: 'id, shop_id, user_id, action, synced'
    });
  }
}

export const db = new PosDatabase();

export async function recordAuditLog(action: string, details: any) {
  const user = useStore.getState().user;
  if (!user?.id || !user?.shop_id) return;

  const log: AuditLog = {
    id: uuidv4(),
    shop_id: user.shop_id,
    user_id: user.id,
    user_name: user.name,
    action,
    details: JSON.stringify(details),
    created_at: new Date().toISOString(),
    synced: 0
  };

  await db.auditLogs.add(log);
}
