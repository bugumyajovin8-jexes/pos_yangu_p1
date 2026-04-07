import { db } from '../db';
import { useStore } from '../store';
import { supabase } from '../supabase';
import { LicenseService } from './license';

export class SyncService {
  private static isSyncing = false;
  private static lastSyncAttempt = 0;
  private static lastSyncEnd = 0;
  private static currentSyncPromise: Promise<void> | null = null;
  private static pendingSync = false;

  static async sync(force = false): Promise<void> {
    const now = Date.now();
    
    // Auto-reset if stuck for more than 30 minutes
    if (this.isSyncing && now - this.lastSyncAttempt > 30 * 60 * 1000) {
      console.warn('Sync was stuck for over 30 minutes, force-resetting...');
      this.isSyncing = false;
      this.currentSyncPromise = null;
    }

    if (this.isSyncing) {
      if (force) {
        console.log(`Sync skipped: Already syncing (started ${Math.round((now - this.lastSyncAttempt)/1000)}s ago), but force requested - queuing follow-up`);
        this.pendingSync = true;
      } else {
        console.log(`Sync skipped: Already syncing (started ${Math.round((now - this.lastSyncAttempt)/1000)}s ago)`);
      }
      return this.currentSyncPromise || Promise.resolve();
    }

    // Set state immediately to prevent race conditions
    this.isSyncing = true;
    this.lastSyncAttempt = now;
    
    this.currentSyncPromise = (async () => {
      try {
        await this.doSync(force);
      } finally {
        this.isSyncing = false;
        this.lastSyncEnd = Date.now();
        this.currentSyncPromise = null;
        
        if (this.pendingSync) {
          console.log('Executing queued pending sync...');
          this.pendingSync = false;
          // Small delay before follow-up to let DB settle
          setTimeout(() => this.sync(true), 1000);
        }
      }
    })();

    return this.currentSyncPromise;
  }

  private static async doSync(force = false) {
    if (!navigator.onLine && !force) {
      console.log('Sync skipped: Offline');
      return;
    }

    try {
      const state = useStore.getState();
      const user = state.user;
      
      if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
        console.error('Sync failed: Missing Supabase environment variables');
        return;
      }

      if (!user || (!user.shopId && !user.shop_id)) {
        console.warn('Sync skipped: No authenticated user or shop_id found', { user });
        return;
      }

      const shopId = user.shopId || user.shop_id;
      console.log(`Syncing for shopId: ${shopId}, User role: ${user.role}`);
      const settings = await db.settings.get(1);
      const lastSync = settings?.lastSync || 0;
      const lastSyncDate = lastSync ? new Date(lastSync).toISOString() : '';

      console.log(`Starting sync process for shop ${shopId}... Last sync: ${lastSyncDate || 'Never'}`);

      // 0. Sync License
      await this.executeWithRetry('License Sync', () => LicenseService.syncLicense(), 3, 30000);

      // 1. Push local changes
      const tables = ['shops', 'products', 'sales', 'sale_items', 'expenses', 'features', 'debt_payments', 'users', 'audit_logs'];
      for (const tableName of tables) {
        try {
          const table = (db as any)[
            tableName === 'sale_items' ? 'saleItems' : 
            tableName === 'debt_payments' ? 'debtPayments' : 
            tableName === 'audit_logs' ? 'auditLogs' :
            tableName
          ];
          if (table) {
            await this.executeWithRetry(`Push ${tableName}`, (signal) => this.pushTable(tableName, table, signal), 3, 30000);
          }
        } catch (e) {
          console.error(`Push failed for ${tableName}:`, e);
        }
      }

      // 2. Pull remote changes (incremental)
      for (const tableName of tables) {
        try {
          const table = (db as any)[
            tableName === 'sale_items' ? 'saleItems' : 
            tableName === 'debt_payments' ? 'debtPayments' : 
            tableName === 'audit_logs' ? 'auditLogs' :
            tableName
          ];
          if (table) {
            await this.executeWithRetry(`Pull ${tableName}`, (signal) => this.pullTable(tableName, table, shopId, lastSyncDate, force, signal), 3, 30000);
          }
        } catch (e) {
          console.error(`Pull failed for ${tableName}:`, e);
        }
      }

      // 3. Update last sync time
      await db.settings.put({
        id: 1,
        shopName: settings?.shopName || user.name || 'My Shop',
        currency: settings?.currency || 'TZS',
        taxPercentage: settings?.taxPercentage || 0,
        darkMode: settings?.darkMode || false,
        lastSync: Date.now(),
        shopId: shopId
      });

      console.log('Sync completed successfully');
    } catch (error: any) {
      if (error.message?.includes('AbortError') || error.message?.includes('Lock broken')) {
        console.log('Sync interrupted by auth lock or abort, will retry later');
      } else if (error.message?.includes('timeout')) {
        console.warn('Sync timed out:', error.message);
      } else {
        console.error('Sync failed:', error);
      }
    } finally {
      this.isSyncing = false;
      console.log('Sync process ended');
    }
  }

  private static async executeWithRetry(
    operationName: string,
    operation: (signal: AbortSignal) => Promise<void>,
    retries = 3,
    timeoutMs = 30000
  ) {
    for (let i = 0; i < retries; i++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        await operation(controller.signal);
        clearTimeout(timeoutId);
        return; // Success
      } catch (err: any) {
        clearTimeout(timeoutId);
        
        const isNetworkOrLockError = 
          err.message?.includes('Lock broken') || 
          err.message?.includes('Failed to fetch') ||
          err.message?.includes('AbortError') ||
          err.message?.includes('timeout') ||
          err.name === 'AbortError';

        if (isNetworkOrLockError && i < retries - 1) {
          console.warn(`${operationName} failed (attempt ${i + 1}/${retries}). Retrying in 2s...`, err.message || err);
          await new Promise(res => setTimeout(res, 2000));
          continue;
        }
        
        throw err;
      }
    }
  }

  private static async pushTable(tableName: string, table: any, signal: AbortSignal) {
    const unsynced = await table.where('synced').equals(0).toArray();
    
    if (unsynced.length === 0) return;

    console.log(`Pushing ${unsynced.length} unsynced records for ${tableName}`);
    // Handle products as a single batch operation
    if (tableName === 'products') {
      const productsData = unsynced.map((record: any) => {
        const { synced, ...localData } = record;
        const dataToSync = this.mapToRemote(tableName, localData);
        // Use the persistent stock_delta
        dataToSync.stock_delta = record.stock_delta || 0;
        return dataToSync;
      });

      if (productsData.length > 0) {
        const { error: rpcError } = await supabase.rpc('sync_products_with_deltas', { products_data: productsData }).abortSignal(signal);
        if (!rpcError) {
          for (const record of unsynced) {
            await table.update(record.id, { 
              synced: 1,
              stock_delta: 0 // Reset delta after successful push
            });
          }
        } else {
          console.error(`Error syncing products via RPC:`, rpcError);
        }
      }
      return;
    }

    // Standard bulk upsert for other tables
    const itemsToUpsert = unsynced.map((record: any) => {
      const { synced, ...localData } = record;
      return this.mapToRemote(tableName, localData);
    });

    const { error: upsertError } = await supabase
      .from(tableName)
      .upsert(itemsToUpsert, { onConflict: 'id' })
      .abortSignal(signal);

    if (!upsertError) {
      await table.bulkUpdate(unsynced.map((record: any) => ({
        key: record.id,
        changes: { synced: 1 }
      })));
    } else {
      console.error(`Error syncing ${tableName}:`, upsertError);
      if (upsertError.message && (upsertError.message.includes('column') || upsertError.message.includes('not found'))) {
        console.warn(`Possible schema mismatch for ${tableName}. Please check if all columns exist in Supabase.`);
      }
    }
  }

  private static async pullTable(tableName: string, table: any, shopId: string, lastSyncDate: string, force: boolean, signal: AbortSignal) {
    let query = supabase.from(tableName).select('*');
    
    if (tableName === 'shops') {
      query = query.eq('id', shopId);
    } else {
      query = query.eq('shop_id', shopId);
    }

    // Incremental sync: only pull what's new since last sync
    if (lastSyncDate && !force && tableName !== 'shops' && tableName !== 'features') {
      query = query.gt('updated_at', lastSyncDate);
    }

    const { data, error } = await query.abortSignal(signal);

    if (error) {
      console.error(`Error pulling ${tableName}:`, error);
      return;
    }

    console.log(`Pulled ${data?.length || 0} records for ${tableName}`);
    if (data && data.length > 0) {
      const localRecords: any[] = [];
      for (const record of data) {
        const localData = this.mapToLocal(tableName, record);
        localRecords.push(localData);
        const existing = await table.get(record.id);

        const isRemoteNewer = existing && record.updated_at && 
          new Date(record.updated_at) > new Date(existing.updated_at);
          
        const hasUnsyncedChanges = existing && existing.synced === 0;

        if (!existing) {
          await table.put({ 
            ...localData, 
            stock_delta: localData.stock_delta || 0,
            synced: 1 
          });
        } else if (isRemoteNewer) {
          if (tableName === 'products' && hasUnsyncedChanges) {
            // Smart Merge for products: remote stock + local pending delta
            const pendingDelta = existing.stock_delta || 0;
            const remoteStock = Number(record.stock) || 0;
            const mergedStock = Math.max(0, remoteStock + pendingDelta);
            
            await table.put({ 
              ...localData, 
              stock: mergedStock,
              stock_delta: pendingDelta,
              synced: 0 // Keep unsynced because of the pending delta
            });
          } else if (!hasUnsyncedChanges) {
            // Standard overwrite if no local changes
            await table.put({ ...localData, synced: 1 });
          }
        }
      }

      // Update store if features were pulled
      if (tableName === 'features') {
        useStore.getState().setFeatures(localRecords);
      }
    }
  }

  private static mapToRemote(tableName: string, data: any) {
    const mapped: any = { ...data };

    // Ensure shop_id is present if shopId is used
    if (data.shopId && !mapped.shop_id) {
      mapped.shop_id = data.shopId;
    }

    // Ensure user_id is present if it's missing but we have it in store
    if (!mapped.user_id && useStore.getState().user?.id) {
      mapped.user_id = useStore.getState().user?.id;
    }

    // Common mappings
    if ('isDeleted' in mapped) {
      mapped.is_deleted = mapped.isDeleted === 1;
      delete mapped.isDeleted;
    }
    if ('is_deleted' in mapped && typeof mapped.is_deleted === 'number') {
      mapped.is_deleted = mapped.is_deleted === 1;
    }

    if (tableName === 'sales') {
      // Ensure user_id and shop_id are not empty strings if we have them in store
      if (!mapped.user_id || mapped.user_id === '') {
        mapped.user_id = useStore.getState().user?.id;
      }
      if (!mapped.shop_id || mapped.shop_id === '') {
        mapped.shop_id = useStore.getState().user?.shop_id || useStore.getState().user?.shopId;
      }
    }

    if (tableName === 'sale_items') {
      return {
        id: data.id,
        sale_id: data.sale_id,
        shop_id: data.shop_id || data.shopId,
        product_id: data.product_id,
        product_name: data.product_name,
        qty: data.qty,
        buy_price: data.buy_price,
        sell_price: data.sell_price,
        created_at: data.created_at,
        updated_at: data.updated_at || data.created_at,
        is_deleted: data.is_deleted === 1 || data.isDeleted === 1
      };
    }

    if (tableName === 'features') {
      mapped.shop_id = data.shop_id || useStore.getState().user?.shop_id || useStore.getState().user?.shopId;
      mapped.feature_key = data.featureKey;
      mapped.is_enabled = data.isEnabled;
      delete mapped.featureKey;
      delete mapped.isEnabled;
    }

    if (tableName === 'debt_payments') {
      delete mapped.user_id;
    }

    if (tableName === 'shops') {
      delete mapped.currency;
    }

    if (tableName === 'users') {
      mapped.shop_id = data.shop_id || data.shopId;
    }

    if (tableName === 'audit_logs') {
      if (typeof data.details === 'string') {
        try {
          mapped.details = JSON.parse(data.details);
        } catch (e) {
          console.error('Failed to parse audit log details:', e);
        }
      }
    }

    return mapped;
  }

  private static mapToLocal(tableName: string, data: any) {
    const mapped: any = { ...data };

    // Default isDeleted to 0 if not present
    mapped.isDeleted = 0;

    if ('is_deleted' in data) {
      mapped.isDeleted = data.is_deleted ? 1 : 0;
      mapped.is_deleted = data.is_deleted ? 1 : 0; // Keep both for compatibility
    }

    if (tableName === 'sales') {
      if (data.is_credit !== undefined) {
        mapped.payment_method = data.is_credit ? 'credit' : (data.payment_method || 'cash');
      }
      if (data.is_paid !== undefined) {
        mapped.status = data.is_paid ? 'completed' : (data.status || 'pending');
      }
    }

    if (tableName === 'sale_items') {
      mapped.product_name = data.product_name || data.name;
    }

    if (tableName === 'features') {
      mapped.featureKey = data.feature_key;
      mapped.isEnabled = data.is_enabled;
    }

    return mapped;
  }

  static getIsSyncing() {
    return this.isSyncing;
  }

  static resetSync() {
    this.isSyncing = false;
    this.lastSyncAttempt = 0;
    console.log('Sync state reset manually');
  }
}
