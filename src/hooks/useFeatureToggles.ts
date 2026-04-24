import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useStore } from '../store';

export function useFeatureToggles() {
  const user = useStore(state => state.user);
  const storeIsFeatureEnabled = useStore(state => state.isFeatureEnabled);

  const features = useLiveQuery(
    () => {
      if (!user?.shop_id) return [];
      return db.features.where('shop_id').equals(user.shop_id).toArray();
    },
    [user?.shop_id]
  ) || [];

  const isBoss = () => {
    if (!user) return false;
    return ['admin', 'boss', 'superadmin', 'owner'].includes(user.role);
  };

  const isFeatureEnabled = (featureKey: string) => {
    // Check if user is a boss first
    if (isBoss()) {
      console.log(`[Feature] ${featureKey}: ENABLED (User is Boss)`);
      return true;
    }

    const shopId = user?.shop_id || user?.shopId;
    if (!shopId) {
      console.warn(`[Feature] ${featureKey}: DISABLED (No shop_id found for user)`, user);
      return false;
    }

    // Check the live features array from Dexie
    const feature = features.find(f => 
      (f.featureKey === featureKey || (f as any).feature_key === featureKey)
    );
    
    if (feature) {
      // Robust boolean check (handles true, "true", 1, "1")
      const isEnabled = feature.isEnabled === true || 
                        (feature.isEnabled as any) === 1 || 
                        String(feature.isEnabled).toLowerCase() === 'true' ||
                        String(feature.isEnabled) === '1';
      
      console.log(`[Feature] ${featureKey}: ${isEnabled ? 'ENABLED' : 'DISABLED'} (From DB)`, { feature, shopId });
      return isEnabled;
    }

    // Fallback to store if Dexie query hasn't finished or is empty
    const storeEnabled = storeIsFeatureEnabled(featureKey);
    console.log(`[Feature] ${featureKey}: ${storeEnabled ? 'ENABLED' : 'DISABLED'} (From Store Fallback)`);
    return storeEnabled;
  };

  return {
    isBoss,
    isFeatureEnabled,
    features
  };
}
