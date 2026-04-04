export const formatCurrency = (amount: number, currency = 'TZS') => {
  return new Intl.NumberFormat('sw-TZ', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
  }).format(amount);
};

export const formatNumberWithCommas = (value: string | number) => {
  if (value === undefined || value === null || value === '') return '';
  const number = value.toString().replace(/[^0-9]/g, '');
  return number.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

export const parseFormattedNumber = (value: string) => {
  return parseInt(value.replace(/,/g, ''), 10) || 0;
};
