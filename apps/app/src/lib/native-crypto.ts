import { randomUUID } from 'expo-crypto';
import { Platform } from 'react-native';

// TanStack DB needs secure IDs for its live queries and transactions.
const runtime: { crypto?: Partial<Crypto> } = globalThis;
if (
  Platform.OS !== 'web' &&
  typeof runtime.crypto?.randomUUID !== 'function' &&
  typeof runtime.crypto?.getRandomValues !== 'function'
) {
  if (runtime.crypto) {
    Object.defineProperty(runtime.crypto, 'randomUUID', {
      value: randomUUID,
      configurable: true,
      writable: true,
    });
  } else {
    Object.defineProperty(globalThis, 'crypto', {
      value: { randomUUID },
      configurable: true,
      writable: true,
    });
  }
}
