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
    // Prefer store if it has data, otherwise fallback to live query
    return storeIsFeatureEnabled(featureKey);
  };

  return {
    isBoss,
    isFeatureEnabled,
    features
  };
}
