import React from 'react';
import { useStore } from '../store';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export default function GlobalModal() {
  const { modal, hideModal } = useStore();

  if (!modal.isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div 
        className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200"
        role="dialog"
        aria-modal="true"
      >
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center space-x-3">
              {modal.type === 'alert' ? (
                <div className="p-2 bg-blue-100 text-blue-600 rounded-full">
                  <Info className="w-6 h-6" />
                </div>
              ) : (
                <div className="p-2 bg-amber-100 text-amber-600 rounded-full">
                  <AlertCircle className="w-6 h-6" />
                </div>
              )}
              <h3 className="text-xl font-semibold text-gray-900">
                {modal.title}
              </h3>
            </div>
            <button 
              onClick={hideModal}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          
          <p className="text-gray-600 mb-8 whitespace-pre-wrap">
            {modal.message}
          </p>

          <div className="flex justify-end space-x-3">
            {modal.type === 'confirm' && (
              <button
                onClick={() => {
                  if (modal.onCancel) modal.onCancel();
                  hideModal();
                }}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-xl transition-colors font-medium"
              >
                Ghairi
              </button>
            )}
            <button
              onClick={() => {
                if (modal.onConfirm) modal.onConfirm();
                hideModal();
              }}
              className={`px-6 py-2 text-white rounded-xl transition-colors font-medium ${
                modal.type === 'alert' 
                  ? 'bg-blue-600 hover:bg-blue-700' 
                  : 'bg-amber-600 hover:bg-amber-700'
              }`}
            >
              {modal.type === 'alert' ? 'Sawa' : 'Ndiyo, Endelea'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
