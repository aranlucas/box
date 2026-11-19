import { randomUUID } from 'expo-crypto';
import { Platform } from 'react-native';

// TanStack DB needs secure IDs for its live queries and transactions.
if (
  Platform.OS !== 'web' &&
  typeof globalThis.crypto?.randomUUID !== 'function' &&
  typeof globalThis.crypto?.getRandomValues !== 'function'
) {
  if (globalThis.crypto) {
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: randomUUID, configurable: true, writable: true });
  } else {
    Object.defineProperty(globalThis, 'crypto', { value: { randomUUID }, configurable: true, writable: true });
  }
}
