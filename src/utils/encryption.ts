import CryptoJS from 'crypto-js';

// This is a client-side secret. While not perfectly secure, it prevents 
// casual tampering by users in the browser console.
// In a real production app, this would be combined with a user-specific salt.
const SECRET_KEY = import.meta.env.VITE_ENCRYPTION_KEY || 'pos-system-secure-key-2026';

export const EncryptionUtils = {
  encrypt: (data: string, salt: string = ''): string => {
    return CryptoJS.AES.encrypt(data, SECRET_KEY + salt).toString();
  },

  decrypt: (ciphertext: string, salt: string = ''): string => {
    try {
      const bytes = CryptoJS.AES.decrypt(ciphertext, SECRET_KEY + salt);
      return bytes.toString(CryptoJS.enc.Utf8);
    } catch (e) {
      console.error('Decryption failed', e);
      return '';
    }
  },

  // Helper for numbers
  encryptNumber: (num: number, salt: string = ''): string => {
    return EncryptionUtils.encrypt(num.toString(), salt);
  },

  decryptNumber: (ciphertext: string, salt: string = ''): number => {
    const decrypted = EncryptionUtils.decrypt(ciphertext, salt);
    return decrypted ? parseFloat(decrypted) : 0;
  },

  // Generate a simple HMAC-like signature for license validation
  generateSignature: (data: string): string => {
    return CryptoJS.HmacSHA256(data, SECRET_KEY).toString();
  }
};
