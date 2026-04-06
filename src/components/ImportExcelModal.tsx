import React, { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { X, Upload, FileSpreadsheet, Check, AlertCircle, Loader2 } from 'lucide-react';
import { db, recordAuditLog } from '../db';
import { useStore } from '../store';
import { TranslationKey } from '../translations';
import { SyncService } from '../services/sync';
import { v4 as uuidv4 } from 'uuid';

interface ImportExcelModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Mapping {
  appField: string;
  excelField: string;
  isConstant?: boolean;
  constantValue?: any;
}

interface ImportSettings {
  handleMissingBuyPrice: 'reject' | 'accept';
  handleMissingSellPrice: 'reject' | 'accept';
  mergeDuplicates: boolean;
}

interface ImportReport {
  total: number;
  success: number;
  failed: number;
  duplicates: number;
  merged: number;
  errors: any[];
}

const APP_FIELDS_BASE = [
  { key: 'name', label: 'productName' as TranslationKey, required: true },
  { key: 'buy_price', label: 'buyPrice' as TranslationKey, required: true, type: 'number' },
  { key: 'sell_price', label: 'sellPrice' as TranslationKey, required: true, type: 'number' },
  { key: 'stock', label: 'stock' as TranslationKey, required: true, type: 'number' },
  { key: 'min_stock', label: 'minStockAlert' as TranslationKey, required: true, type: 'number' },
];

const EXPIRY_FIELDS = [
  { key: 'expiry_date', label: 'expiryDate' as TranslationKey, required: false, type: 'date' },
  { key: 'notify_expiry_days', label: 'notifyExpiryDays' as TranslationKey, required: false, type: 'number' },
];

export default function ImportExcelModal({ isOpen, onClose }: ImportExcelModalProps) {
  const user = useStore(state => state.user);
  const t = useStore(state => state.t);
  const [shopSettings, setShopSettings] = useState<any>(null);
  const [step, setStep] = useState<'upload' | 'mapping' | 'settings' | 'importing' | 'report'>('upload');
  const [excelHeaders, setExcelHeaders] = useState<string[]>([]);
  const [excelData, setExcelData] = useState<any[]>([]);
  const [mappings, setMappings] = useState<Record<string, Mapping>>({});
  const [settings, setSettings] = useState<ImportSettings>({
    handleMissingBuyPrice: 'reject',
    handleMissingSellPrice: 'reject',
    mergeDuplicates: true
  });
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user?.shop_id) {
      db.shops.get(user.shop_id).then(data => setShopSettings(data));
    }
  }, [user?.shop_id]);

  const appFields = shopSettings?.enable_expiry 
    ? [...APP_FIELDS_BASE, ...EXPIRY_FIELDS]
    : APP_FIELDS_BASE;

  if (!isOpen) return null;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
        
        if (data.length < 2) {
          setError(t('fileNotEnoughData'));
          return;
        }

        const headers = data[0] as string[];
        const rows = data.slice(1);
        
        setExcelHeaders(headers);
        setExcelData(rows);
        
        // Initial mapping attempt
        const initialMappings: Record<string, Mapping> = {};
        appFields.forEach(field => {
          const fieldLabel = t(field.label);
          const match = headers.find(h => 
            h.toLowerCase().includes(fieldLabel.toLowerCase()) || 
            h.toLowerCase().includes(field.key.toLowerCase())
          );
          initialMappings[field.key] = {
            appField: field.key,
            excelField: match || '',
            isConstant: false,
            constantValue: field.key === 'min_stock' ? '5' : (field.key === 'notify_expiry_days' ? '10' : '')
          };
        });
        
        setMappings(initialMappings);
        setStep('mapping');
        setError(null);
      } catch (err) {
        setError(t('failedToReadExcel'));
        console.error(err);
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleMappingChange = (appField: string, excelField: string) => {
    setMappings(prev => ({
      ...prev,
      [appField]: { 
        ...prev[appField], 
        excelField: (excelField === '__constant__' || excelField === '__manual__') ? '' : excelField, 
        isConstant: excelField === '__constant__' 
      }
    }));
  };

  const handleConstantValueChange = (appField: string, value: string) => {
    setMappings(prev => ({
      ...prev,
      [appField]: { ...prev[appField], constantValue: value }
    }));
  };

  const startImport = async () => {
    setStep('importing');
    setError(null);
    setImportProgress(0);

    const productsMap = new Map<string, any>();
    const errors: any[] = [];
    let successCount = 0;
    let failedCount = 0;
    let duplicateCount = 0;
    let mergedCount = 0;

    const now = new Date().toISOString();
    const shopId = user?.shop_id || '';

    // Process in chunks for large datasets
    const CHUNK_SIZE = 500;
    
    for (let i = 0; i < excelData.length; i++) {
      const row = excelData[i];
      const rowData: any = {};
      let isRowValid = true;
      let rejectionReason = '';

      // Extract values based on mapping
      appFields.forEach(field => {
        const mapping = mappings[field.key];
        let value: any;

        if (mapping.isConstant) {
          value = mapping.constantValue;
        } else {
          const colIndex = excelHeaders.indexOf(mapping.excelField);
          value = colIndex !== -1 ? row[colIndex] : null;
        }

        if (field.type === 'number') {
          const rawValue = String(value || '').replace(/,/g, '').trim();
          value = rawValue === '' ? null : parseFloat(rawValue);
        } else if (field.type === 'date' && value) {
          if (typeof value === 'number') {
            const date = new Date((value - 25569) * 86400 * 1000);
            value = date.toISOString().split('T')[0];
          }
        }
        rowData[field.key] = value;
      });

      // 1. Validation: Name is mandatory
      if (!rowData.name || String(rowData.name).trim() === '') {
        isRowValid = false;
        rejectionReason = t('missingNameError');
      }

      // 2. Validation: Buy Price
      if (rowData.buy_price === null || isNaN(rowData.buy_price)) {
        if (settings.handleMissingBuyPrice === 'reject') {
          isRowValid = false;
          rejectionReason = t('missingBuyPriceError');
        } else {
          rowData.buy_price = 0;
        }
      }

      // 3. Validation: Sell Price
      if (rowData.sell_price === null || isNaN(rowData.sell_price)) {
        if (settings.handleMissingSellPrice === 'reject') {
          isRowValid = false;
          rejectionReason = t('missingSellPriceError');
        } else {
          rowData.sell_price = 0;
        }
      }

      if (!isRowValid) {
        failedCount++;
        errors.push({ ...row, _error: rejectionReason });
        continue;
      }

      // Clean up other numbers
      rowData.stock = parseFloat(rowData.stock) || 0;
      rowData.min_stock = parseFloat(rowData.min_stock) || 5;
      rowData.notify_expiry_days = parseInt(rowData.notify_expiry_days) || 10;
      rowData.expiry_date = rowData.expiry_date || '';

      // Deduplication & Merging Logic
      // Key: Name + Buy + Sell + Expiry
      const mergeKey = `${String(rowData.name).trim().toLowerCase()}|${rowData.buy_price}|${rowData.sell_price}|${rowData.expiry_date}`;
      
      if (productsMap.has(mergeKey)) {
        const existing = productsMap.get(mergeKey);
        
        if (settings.mergeDuplicates) {
          // Check if it's a perfect duplicate (including stock)
          if (existing.stock === rowData.stock) {
            duplicateCount++;
          } else {
            // Merge stock
            existing.stock += rowData.stock;
            existing.stock_delta = (existing.stock_delta || 0) + rowData.stock;
            if (existing.batches.length > 0) {
              existing.batches[0].stock += rowData.stock;
            }
            mergedCount++;
          }
        } else {
          // If not merging, just treat as new product (unlikely for business logic but option exists)
          const newId = uuidv4();
          productsMap.set(`${mergeKey}|${newId}`, {
            ...rowData,
            id: newId,
            shop_id: shopId,
            unit: 'pcs',
            created_at: now,
            updated_at: now,
            synced: 0,
            stock_delta: rowData.stock,
            batches: rowData.stock > 0 ? [{ id: uuidv4(), stock: rowData.stock, expiry_date: rowData.expiry_date }] : []
          });
          successCount++;
        }
      } else {
        productsMap.set(mergeKey, {
          ...rowData,
          id: uuidv4(),
          shop_id: shopId,
          unit: 'pcs',
          created_at: now,
          updated_at: now,
          synced: 0,
          stock_delta: rowData.stock,
          batches: rowData.stock > 0 ? [{ id: uuidv4(), stock: rowData.stock, expiry_date: rowData.expiry_date }] : []
        });
        successCount++;
      }

      if (i % 100 === 0) {
        setImportProgress(Math.round(((i + 1) / excelData.length) * 100));
      }
    }

    const finalProducts = Array.from(productsMap.values());

    try {
      // Use a Dexie transaction to ensure atomicity. If any chunk fails, the entire transaction rolls back.
      await db.transaction('rw', db.products, async () => {
        for (let i = 0; i < finalProducts.length; i += CHUNK_SIZE) {
          const chunk = finalProducts.slice(i, i + CHUNK_SIZE);
          await db.products.bulkPut(chunk);
          setImportProgress(Math.round(((i + chunk.length) / finalProducts.length) * 100));
        }
      });

      // Record Audit Log
      await recordAuditLog('import_products_excel', {
        total_rows: excelData.length,
        success_count: successCount,
        merged_count: mergedCount,
        failed_count: failedCount
      });

      await SyncService.sync(true);
      setReport({
        total: excelData.length,
        success: successCount,
        failed: failedCount,
        duplicates: duplicateCount,
        merged: mergedCount,
        errors: errors
      });
      setStep('report');
    } catch (err) {
      setError(t('failedToSaveToDb'));
      setStep('mapping');
      console.error(err);
    }
  };

  const downloadErrorReport = () => {
    if (!report || report.errors.length === 0) return;
    
    const ws = XLSX.utils.json_to_sheet(report.errors);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Errors");
    XLSX.writeFile(wb, `makosa_ya_import_${new Date().getTime()}.xlsx`);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
      <div className="bg-white rounded-[2rem] w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
              <FileSpreadsheet className="w-6 h-6 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">{t('importProductsExcel')}</h2>
              <p className="text-xs text-slate-500">{t('importExcelDesc')}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
            <X className="w-6 h-6 text-slate-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-6 p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-start space-x-3 text-rose-600">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}

          {step === 'upload' && (
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-200 rounded-[2rem] p-12 text-center hover:border-blue-400 hover:bg-blue-50 transition-all cursor-pointer group"
            >
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileUpload} 
                accept=".xlsx, .xls" 
                className="hidden" 
              />
              <div className="w-20 h-20 bg-slate-100 rounded-3xl flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform">
                <Upload className="w-10 h-10 text-slate-400 group-hover:text-blue-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">{t('chooseExcelFile')}</h3>
              <p className="text-slate-500 text-sm max-w-xs mx-auto">
                {t('chooseExcelFileDesc')}
              </p>
            </div>
          )}

          {step === 'mapping' && (
            <div className="space-y-6">
              <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
                <p className="text-sm text-blue-700 font-medium">
                  {t('foundProducts').replace('{count}', excelData.length.toString())} 
                  {t('matchHeaders')}
                </p>
              </div>

              <div className="space-y-4">
                {appFields.map(field => (
                  <div key={field.key} className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <div>
                      <label className="block text-sm font-bold text-slate-700">
                        {t(field.label)} {field.required && <span className="text-rose-500">*</span>}
                      </label>
                      <p className="text-[10px] text-slate-400">{t('appFieldLabel')}</p>
                    </div>
                    <div className="space-y-2">
                      <select 
                        value={mappings[field.key]?.isConstant ? '__constant__' : (mappings[field.key]?.excelField || '__manual__')}
                        onChange={(e) => handleMappingChange(field.key, e.target.value)}
                        className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      >
                        <option value="__manual__">{t('manualFill')}</option>
                        {excelHeaders.map(h => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                        <option value="__constant__">{t('setConstantValue')}</option>
                      </select>

                      {mappings[field.key]?.isConstant && (
                        <input 
                          type={field.type === 'number' ? 'number' : 'text'}
                          placeholder={t('enterValue').replace('{field}', t(field.label).toLowerCase())}
                          value={mappings[field.key]?.constantValue}
                          onChange={(e) => handleConstantValueChange(field.key, e.target.value)}
                          className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 'importing' && (
            <div className="py-12 text-center">
              <div className="relative w-32 h-32 mx-auto mb-8">
                <svg className="w-full h-full" viewBox="0 0 100 100">
                  <circle className="text-slate-100 stroke-current" strokeWidth="8" fill="transparent" r="40" cx="50" cy="50" />
                  <circle 
                    className="text-blue-600 stroke-current transition-all duration-300" 
                    strokeWidth="8" 
                    strokeDasharray={2 * Math.PI * 40}
                    strokeDashoffset={2 * Math.PI * 40 * (1 - importProgress / 100)}
                    strokeLinecap="round" 
                    fill="transparent" 
                    r="40" 
                    cx="50" 
                    cy="50" 
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-2xl font-bold text-slate-900">{importProgress}%</span>
                </div>
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">{t('importingData')}</h3>
              <p className="text-slate-500">{t('dontCloseWindow')}</p>
            </div>
          )}

          {step === 'settings' && (
            <div className="space-y-8">
              <div className="bg-blue-50 p-6 rounded-3xl border border-blue-100">
                <h3 className="font-bold text-blue-900 mb-2 flex items-center">
                  <AlertCircle className="w-5 h-5 mr-2" /> {t('dataCleaningGuide')}
                </h3>
                <ul className="text-sm text-blue-700 space-y-2 list-disc pl-5">
                  <li>{t('dataCleaningRule1')}</li>
                  <li>{t('dataCleaningRule2')}</li>
                  <li>{t('dataCleaningRule3')}</li>
                </ul>
              </div>

              <div className="space-y-6">
                <div className="p-6 bg-slate-50 rounded-3xl border border-slate-200">
                  <label className="block text-sm font-bold text-slate-700 mb-4">{t('ifBuyPriceMissing')}</label>
                  <div className="grid grid-cols-2 gap-4">
                    <button 
                      onClick={() => setSettings(s => ({ ...s, handleMissingBuyPrice: 'reject' }))}
                      className={`p-4 rounded-2xl border-2 font-bold transition-all ${settings.handleMissingBuyPrice === 'reject' ? 'border-blue-600 bg-blue-50 text-blue-600' : 'border-slate-200 bg-white text-slate-500'}`}
                    >
                      {t('rejectRow')}
                    </button>
                    <button 
                      onClick={() => setSettings(s => ({ ...s, handleMissingBuyPrice: 'accept' }))}
                      className={`p-4 rounded-2xl border-2 font-bold transition-all ${settings.handleMissingBuyPrice === 'accept' ? 'border-blue-600 bg-blue-50 text-blue-600' : 'border-slate-200 bg-white text-slate-500'}`}
                    >
                      {t('acceptWithZero')}
                    </button>
                  </div>
                </div>

                <div className="p-6 bg-slate-50 rounded-3xl border border-slate-200">
                  <label className="block text-sm font-bold text-slate-700 mb-4">{t('ifSellPriceMissing')}</label>
                  <div className="grid grid-cols-2 gap-4">
                    <button 
                      onClick={() => setSettings(s => ({ ...s, handleMissingSellPrice: 'reject' }))}
                      className={`p-4 rounded-2xl border-2 font-bold transition-all ${settings.handleMissingSellPrice === 'reject' ? 'border-blue-600 bg-blue-50 text-blue-600' : 'border-slate-200 bg-white text-slate-500'}`}
                    >
                      {t('rejectRow')}
                    </button>
                    <button 
                      onClick={() => setSettings(s => ({ ...s, handleMissingSellPrice: 'accept' }))}
                      className={`p-4 rounded-2xl border-2 font-bold transition-all ${settings.handleMissingSellPrice === 'accept' ? 'border-blue-600 bg-blue-50 text-blue-600' : 'border-slate-200 bg-white text-slate-500'}`}
                    >
                      {t('acceptWithZero')}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between p-6 bg-slate-50 rounded-3xl border border-slate-200">
                  <div>
                    <h4 className="font-bold text-slate-900">{t('mergeDuplicatesLabel')}</h4>
                    <p className="text-xs text-slate-500">{t('mergeDuplicatesDesc')}</p>
                  </div>
                  <button 
                    onClick={() => setSettings(s => ({ ...s, mergeDuplicates: !s.mergeDuplicates }))}
                    className={`w-14 h-8 rounded-full transition-colors relative ${settings.mergeDuplicates ? 'bg-blue-600' : 'bg-slate-300'}`}
                  >
                    <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all ${settings.mergeDuplicates ? 'left-7' : 'left-1'}`} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === 'report' && report && (
            <div className="space-y-8">
              <div className="text-center">
                <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Check className="w-10 h-10" />
                </div>
                <h3 className="text-2xl font-bold text-slate-900">{t('importReport')}</h3>
                <p className="text-slate-500">{t('importCompleted')}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-center">
                  <p className="text-xs text-slate-500 font-bold uppercase mb-1">{t('imported')}</p>
                  <p className="text-2xl font-bold text-emerald-600">{report.success}</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-center">
                  <p className="text-xs text-slate-500 font-bold uppercase mb-1">{t('rejected')}</p>
                  <p className="text-2xl font-bold text-rose-600">{report.failed}</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-center">
                  <p className="text-xs text-slate-500 font-bold uppercase mb-1">{t('merged')}</p>
                  <p className="text-2xl font-bold text-blue-600">{report.merged}</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-center">
                  <p className="text-xs text-slate-500 font-bold uppercase mb-1">{t('duplicatesLabel')}</p>
                  <p className="text-2xl font-bold text-amber-600">{report.duplicates}</p>
                </div>
              </div>

              {report.errors.length > 0 && (
                <div className="p-6 bg-rose-50 rounded-3xl border border-rose-100">
                  <h4 className="font-bold text-rose-900 mb-2">{t('errorsFound').replace('{count}', report.errors.length.toString())}</h4>
                  <p className="text-sm text-rose-700 mb-4">{t('someProductsNotImported')}</p>
                  <button 
                    onClick={downloadErrorReport}
                    className="w-full py-3 bg-rose-600 text-white font-bold rounded-xl hover:bg-rose-700 transition-colors flex items-center justify-center"
                  >
                    <Upload className="w-4 h-4 mr-2 rotate-180" /> {t('downloadErrorReport')}
                  </button>
                </div>
              )}

              <button 
                onClick={onClose}
                className="w-full py-4 bg-slate-900 text-white font-bold rounded-2xl hover:bg-slate-800 transition-colors"
              >
                {t('finish')}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'mapping' && (
          <div className="p-6 border-t border-slate-100 bg-slate-50 flex space-x-4">
            <button 
              onClick={() => setStep('upload')}
              className="flex-1 py-4 bg-white text-slate-600 font-bold rounded-2xl border border-slate-200 hover:bg-slate-50 transition-colors"
            >
              {t('goBack')}
            </button>
            <button 
              onClick={() => setStep('settings')}
              className="flex-1 py-4 bg-blue-600 text-white font-bold rounded-2xl shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition-colors flex items-center justify-center"
            >
              {t('continue')}
            </button>
          </div>
        )}

        {step === 'settings' && (
          <div className="p-6 border-t border-slate-100 bg-slate-50 flex space-x-4">
            <button 
              onClick={() => setStep('mapping')}
              className="flex-1 py-4 bg-white text-slate-600 font-bold rounded-2xl border border-slate-200 hover:bg-slate-50 transition-colors"
            >
              {t('goBack')}
            </button>
            <button 
              onClick={startImport}
              className="flex-1 py-4 bg-blue-600 text-white font-bold rounded-2xl shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition-colors flex items-center justify-center"
            >
              {t('startImport')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
