import { differenceInDays, parseISO } from 'date-fns';

export const getValidStock = (product: any) => {
  if (!product) return 0;
  if (!product.batches || product.batches.length === 0) return product.stock || 0;
  return product.batches.reduce((sum: number, batch: any) => {
    if (!batch.expiry_date) return sum + (batch.stock || 0);
    const daysUntilExpiry = differenceInDays(parseISO(batch.expiry_date), new Date());
    const isExpired = daysUntilExpiry < 0;
    return isExpired ? sum : sum + (batch.stock || 0);
  }, 0);
};

export const getExpiredStock = (product: any) => {
  if (!product || !product.batches || product.batches.length === 0) return 0;
  return product.batches.reduce((sum: number, batch: any) => {
    if (!batch.expiry_date) return sum;
    const daysUntilExpiry = differenceInDays(parseISO(batch.expiry_date), new Date());
    const isExpired = daysUntilExpiry < 0;
    return isExpired ? sum + (batch.stock || 0) : sum;
  }, 0);
};

export const getTotalStock = (product: any) => {
  if (!product) return 0;
  if (!product.batches || product.batches.length === 0) return product.stock || 0;
  return product.batches.reduce((sum: number, batch: any) => sum + (batch.stock || 0), 0);
};
