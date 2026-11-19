import { useSyncExternalStore } from 'react';

export type PrinterStatus = 'unsupported' | 'disconnected' | 'connecting' | 'connected' | 'printing';
export type PrinterState = { status: PrinterStatus; name?: string; error?: string };

/** Tiny observable store shared by the platform printer implementations. */
export function createPrinterStore(initial: PrinterState) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next: Partial<PrinterState>) {
      state = { ...state, ...next };
      listeners.forEach((l) => l());
    },
    useState: () =>
      useSyncExternalStore(
        (l) => (listeners.add(l), () => listeners.delete(l)),
        () => state,
        () => state,
      ),
  };
}

export const ROTATION_KEY = 'printer-rotation';
