import { useState, useEffect } from 'react';
import { WifiOff, Wifi, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function NetworkStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showBackOnline, setShowBackOnline] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setShowBackOnline(true);
      // Hide the "Back Online" message after 3 seconds
      setTimeout(() => {
        setShowBackOnline(false);
      }, 3000);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setShowBackOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <AnimatePresence>
      {showBackOnline && (
        <motion.div
          initial={{ y: -100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -100, opacity: 0 }}
          className="fixed top-0 left-0 right-0 z-[10000] p-4 flex justify-center pointer-events-none"
        >
          <div className="bg-emerald-600 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center space-x-3 pointer-events-auto border border-emerald-500/20 backdrop-blur-md">
            <div className="bg-white/20 p-2 rounded-xl">
              <Wifi className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-sm md:text-base">Internet Imerudi!</p>
              <p className="text-xs opacity-90">Mfumo unajisajili upya sasa...</p>
            </div>
            <button onClick={() => setShowBackOnline(false)} className="ml-2 p-1 hover:bg-white/10 rounded-lg transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
