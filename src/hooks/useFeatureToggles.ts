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
    if (isBoss()) return true;

    // Check the live features array from Dexie
    const feature = features.find(f => f.featureKey === featureKey || (f as any).feature_key === featureKey);
    
    if (feature) {
      // Robust boolean check (handles true, "true", 1, "1")
      const isEnabled = feature.isEnabled === true || 
                        feature.isEnabled === 1 || 
                        String(feature.isEnabled).toLowerCase() === 'true' ||
                        String(feature.isEnabled) === '1';
      
      console.log(`Feature check: ${featureKey} = ${isEnabled}`, feature);
      return isEnabled;
    }

    // Fallback to store if Dexie query hasn't finished or is empty
    const storeEnabled = storeIsFeatureEnabled(featureKey);
    console.log(`Feature check (fallback): ${featureKey} = ${storeEnabled}`);
    return storeEnabled;
  };

  return {
    isBoss,
    isFeatureEnabled,
    features
  };
}
