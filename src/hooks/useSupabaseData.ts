import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useStore } from '../store';

const tableMap: Record<string, string> = {
  'products': 'products',
  'sales': 'sales',
  'sale_items': 'saleItems',
  'expenses': 'expenses',
  'debt_payments': 'debtPayments',
  'shops': 'shops',
  'users': 'users'
};

export function useSupabaseData<T>(tableName: string, options?: { days?: number; allTime?: boolean }) {
  const user = useStore(state => state.user);
  const dexieTableName = tableMap[tableName] || tableName;

  const data = useLiveQuery(
    async () => {
      if (!user?.shop_id) return [];
      const table = (db as any)[dexieTableName];
      if (!table) {
        console.error(`Table ${dexieTableName} not found in Dexie db`);
        return [];
      }

      console.log(`Fetching ${dexieTableName} for shop ${user.shop_id}...`);
      let query = table.where('shop_id').equals(user.shop_id);

      // Apply date filter if applicable and not allTime
      const heavyTables = ['sales', 'saleItems', 'expenses', 'debtPayments'];
      if (heavyTables.includes(dexieTableName) && !options?.allTime) {
        const days = options?.days || 30;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startDateStr = startDate.toISOString();
        
        // Dexie doesn't support multiple where clauses easily on different fields without compound indexes
        // So we'll fetch and filter, but the initial fetch is already scoped by shop_id
        const results = await query.toArray();
        const filtered = results
          .filter((item: any) => !item.is_deleted && item.created_at >= startDateStr)
          .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        
        console.log(`Fetched ${results.length} ${dexieTableName}, ${filtered.length} after filtering.`);
        return filtered;
      }

      const results = await query.toArray();
      // Filter out deleted items if the table supports it
      const filtered = results
        .filter((item: any) => !item.is_deleted)
        .sort((a: any, b: any) => {
          if (a.created_at && b.created_at) {
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          }
          return 0;
        });

      console.log(`Fetched ${results.length} ${dexieTableName}, ${filtered.length} after filtering.`);

      // Safety limit to prevent RAM crashes (e.g., 2000 items)
      return filtered.slice(0, 2000);
    },
    [user?.shop_id, dexieTableName, options?.days, options?.allTime]
  );

  const getTotals = async (field: string) => {
    if (!user?.shop_id) return 0;
    const table = (db as any)[dexieTableName];
    if (!table) return 0;

    let total = 0;
    await table.where('shop_id').equals(user.shop_id).each((item: any) => {
      if (!item.is_deleted) {
        total += (item[field] || 0);
      }
    });
    return total;
  };

  return { 
    data: (data as T[]) || [], 
    loading: data === undefined, 
    error: null, 
    getTotals,
    refresh: () => {} 
  };
}

export function useSupabaseSingle<T>(tableName: string, id: string | number) {
  const user = useStore(state => state.user);
  const dexieTableName = tableMap[tableName] || tableName;

  const data = useLiveQuery(
    async () => {
      if (!user?.shop_id || !id) return null;
      const table = (db as any)[dexieTableName];
      if (!table) return null;
      return await table.get(id);
    },
    [tableName, id, user?.shop_id]
  );

  return { data: data as T | null, loading: data === undefined };
}

export function useSupabaseTotals(tableName: string, field: string, userId?: string) {
  const user = useStore(state => state.user);
  const dexieTableName = tableMap[tableName] || tableName;

  const total = useLiveQuery(
    async () => {
      if (!user?.shop_id) return 0;
      const table = (db as any)[dexieTableName];
      if (!table) return 0;

      let sum = 0;
      await table.where('shop_id').equals(user.shop_id).each((item: any) => {
        if (!item.is_deleted) {
          if (userId && item.user_id !== userId) return;
          if (dexieTableName === 'sales' && (item.status === 'cancelled' || item.status === 'refunded')) return;
          sum += (item[field] || 0);
        }
      });
      return sum;
    },
    [user?.shop_id, dexieTableName, field, userId]
  );

  return { total: total || 0, loading: total === undefined };
}
