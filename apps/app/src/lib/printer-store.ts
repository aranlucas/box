import { useSyncExternalStore } from 'react';

export type PrinterStatus =
  | 'unsupported'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'printing';
export type PrinterState = { status: PrinterStatus; name?: string; error?: string };

/** Tiny observable store (printer state, household printers). */
export function createStore<T extends object>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  return {
    get: () => state,
    subscribe,
    set(next: Partial<T>) {
      state = { ...state, ...next };
      listeners.forEach((l) => l());
    },
    useState: () =>
      useSyncExternalStore(
        subscribe,
        () => state,
        () => state,
      ),
  };
}

/** Printer connection state, one store per platform printer implementation. */
export const createPrinterStore = (initial: PrinterState) => createStore<PrinterState>(initial);

export const ROTATION_KEY = 'printer-rotation';
