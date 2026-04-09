import { db } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '../store';
import { supabase } from '../supabase';
import { EncryptionUtils } from '../utils/encryption';

export type LicenseStatus = 'VALID' | 'EXPIRED' | 'BLOCKED' | 'DATE_MANIPULATED' | 'SYNC_REQUIRED' | 'TAMPERED';

export class LicenseService {
  private static isSyncing = false;
  private static lastSyncAttempt = 0;
  private static currentSyncPromise: Promise<void> | null = null;

  private static lastSyncLog = 0;

  static async getLocalLicense() {
    let license = await db.license.get(1);
    if (!license) {
      const now = Date.now();
      const deviceId = uuidv4();
      
      // Initialize as inactive with 0 expiry.
      // The app MUST sync with Supabase to get a valid license.
      // No local trial is granted.
      const expiry = 0; 
      
      const signature = EncryptionUtils.generateSignature(`${deviceId}-${expiry}-false`);
      
      license = {
        id: 1,
        deviceId,
        startDate: now,
        expiryDate: expiry,
        isActive: false,
        lastVerifiedAt: now,
        signature
      };
      await db.license.add(license);
    }
    return license;
  }

  static async checkStatus(): Promise<{ status: LicenseStatus, daysRemaining: number, expiryDate: number }> {
    const license = await this.getLocalLicense();
    const now = Date.now();
    const fiveDays = 5 * 24 * 60 * 60 * 1000;
    const daysRemaining = Math.ceil((license.expiryDate - now) / (24 * 60 * 60 * 1000));

    // Verify signature to prevent manual IndexedDB tampering
    const expectedSignature = EncryptionUtils.generateSignature(`${license.deviceId}-${license.expiryDate}-${license.isActive}`);
    if (license.signature !== expectedSignature) {
      console.error('License signature mismatch! Tampering detected.');
      return { status: 'TAMPERED', daysRemaining, expiryDate: license.expiryDate };
    }

    // If it's a fresh install that hasn't synced yet, require sync
    if (!license.isActive && license.startDate === license.lastVerifiedAt) {
      return { status: 'SYNC_REQUIRED', daysRemaining: 0, expiryDate: license.expiryDate };
    }

    if (!license.isActive) return { status: 'BLOCKED', daysRemaining, expiryDate: license.expiryDate };
    
    // Anti-cheat: If current time is earlier than last recorded verification time, 
    // it means the user likely moved the device clock backward to bypass expiry.
    // We allow a small 2-minute buffer for minor clock sync adjustments.
    if (now < license.lastVerifiedAt - 120000) {
      return { status: 'DATE_MANIPULATED', daysRemaining, expiryDate: license.expiryDate };
    }
    
    if (now > license.expiryDate) return { status: 'EXPIRED', daysRemaining, expiryDate: license.expiryDate };
    
    // If it's been more than 5 days since the last sync, require a sync
    if (now - license.lastVerifiedAt > fiveDays) return { status: 'SYNC_REQUIRED', daysRemaining, expiryDate: license.expiryDate };

    // Update lastVerifiedAt locally to track time progress.
    // Only update if the current time is actually later than the stored time.
    if (now > license.lastVerifiedAt) {
      await db.license.update(1, { lastVerifiedAt: now });
    }

    return { status: 'VALID', daysRemaining, expiryDate: license.expiryDate };
  }

  private static async syncWithRetry(shopId: string, retries = 3) {
    console.log(`LicenseService: Attempting to fetch license for shopId: ${shopId}`);
    for (let i = 0; i < retries; i++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s per attempt

      try {
        const { data: { session } } = await supabase.auth.getSession();
        console.log('Current Supabase Session:', session ? `User: ${session.user.id}` : 'No session');

        const [licenseRes, shopRes] = await Promise.all([
          supabase.from('licenses').select('*').eq('shop_id', shopId).abortSignal(controller.signal).limit(1),
          supabase.from('shops').select('status').eq('id', shopId).abortSignal(controller.signal).single()
        ]);
        
        clearTimeout(timeoutId);

        const licenseData = licenseRes.data && licenseRes.data.length > 0 ? licenseRes.data[0] : null;

        console.log('Supabase License Response:', { 
          data: licenseData, 
          error: licenseRes.error?.message,
          code: licenseRes.error?.code,
          count: licenseRes.data?.length
        });
        console.log('Supabase Shop Response:', { 
          data: shopRes.data, 
          error: shopRes.error?.message,
          code: shopRes.error?.code 
        });

        if (licenseRes.error && licenseRes.error.code !== 'PGRST116') {
          console.error('License fetch error:', licenseRes.error);
          throw licenseRes.error;
        }
        if (shopRes.error && shopRes.error.code !== 'PGRST116') {
          console.error('Shop fetch error:', shopRes.error);
          throw shopRes.error;
        }

        const isShopBlocked = shopRes.data?.status === 'blocked';
        
        if (licenseData) {
          console.log('License found on server, updating local state:', licenseData);
          const expiryDate = new Date(licenseData.expiry_date).getTime();
          const isActive = licenseData.status === 'active' && 
                          (licenseData as any).is_active !== false && 
                          !isShopBlocked;
          
          const license = await this.getLocalLicense();
          const signature = EncryptionUtils.generateSignature(`${license.deviceId}-${expiryDate}-${isActive}`);

          await db.license.update(1, {
            expiryDate,
            isActive,
            lastVerifiedAt: Date.now(),
            signature
          });
        } else if (isShopBlocked) {
          console.warn('Shop is blocked on server, updating local state...');
          const license = await this.getLocalLicense();
          const signature = EncryptionUtils.generateSignature(`${license.deviceId}-${license.expiryDate}-false`);
          
          await db.license.update(1, {
            isActive: false,
            lastVerifiedAt: Date.now(),
            signature
          });
        } else {
          console.log(`No license record found on server for shopId: ${shopId}. Setting local state to inactive.`);
          const license = await this.getLocalLicense();
          // Explicitly set to inactive and -1 expiry to indicate "No Record Found"
          const signature = EncryptionUtils.generateSignature(`${license.deviceId}--1-false`);
          
          await db.license.update(1, {
            expiryDate: -1,
            isActive: false,
            lastVerifiedAt: Date.now(),
            signature
          });
        }
        
        window.dispatchEvent(new CustomEvent('license-updated'));
        return; // Success!

      } catch (err: any) {
        clearTimeout(timeoutId);
        console.warn(`License fetch retry ${i + 1} failed:`, err.message || err);
        
        if (i === retries - 1) throw err;
        
        await new Promise(r => setTimeout(r, 2000)); // wait 2s before retry
      }
    }
  }

  static async syncLicense() {
    const now = Date.now();
    const MAX_SYNC_TIME = 60000; // Increased to 60s to allow for retries
    
    if (this.isSyncing && now - this.lastSyncAttempt > MAX_SYNC_TIME) {
      console.warn('License sync stuck. Resetting...');
      this.isSyncing = false;
      this.currentSyncPromise = null;
    }

    if (this.isSyncing) {
      // Only log every 30s to reduce noise
      if (!this.lastSyncLog || now - this.lastSyncLog > 30000) {
        console.log('License sync already in progress, waiting...');
        this.lastSyncLog = now;
      }
      return this.currentSyncPromise || Promise.resolve();
    }
    
    const user = useStore.getState().user;
    if (!user) {
      console.log('License sync skipped: User not logged in');
      return;
    }

    // Robust shopId resolution: prioritize shop_id/shopId from user object
    const shopId = user.shop_id || user.shopId;
    
    if (!shopId) {
      console.warn('License sync skipped: Could not determine shopId for user', user.id, user);
      return;
    }

    this.isSyncing = true;
    this.lastSyncAttempt = now;

    this.currentSyncPromise = (async () => {
      console.log(`Starting license sync process for shop: ${shopId}...`);
      
      try {
        await this.syncWithRetry(shopId, 3);
        console.log('License sync completed successfully');
      } catch (err: any) {
        console.error('Final license sync failure:', err.message || err);
      } finally {
        this.isSyncing = false;
        this.currentSyncPromise = null;
        console.log('License sync state reset');
      }
    })();

    return this.currentSyncPromise;
  }

  static resetSync() {
    this.isSyncing = false;
    this.lastSyncAttempt = 0;
    this.currentSyncPromise = null;
    console.log('License sync state reset manually');
  }
}
