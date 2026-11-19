import { useSyncExternalStore } from 'react';

export type PrinterStatus =
  | 'unsupported'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'printing';
/** `name` is the last printer this device connected to ("D30" until it has connected to one). */
export type PrinterState = { status: PrinterStatus; name: string; error?: string };

/** True while this device has a printer it can print on. */
export const isReady = (status: PrinterStatus) => status === 'connected' || status === 'printing';

/** Tiny observable store (printer state, household printers). */
export function createStore<T extends object>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  const get = () => state;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  return {
    get,
    subscribe,
    set(next: Partial<T>) {
      state = { ...state, ...next };
      for (const listener of listeners) {
        listener();
      }
    },
    useState: () => useSyncExternalStore(subscribe, get, get),
  };
}
