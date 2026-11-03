import { Store } from './store';

export interface ToastItem { id: number; kind: 'info' | 'success' | 'error'; text: string }
export const toastStore = new Store<ToastItem[]>([]);
let n = 0;
export function toast(text: string, kind: ToastItem['kind'] = 'info'): void {
  const id = ++n;
  toastStore.set((l) => [...l, { id, kind, text }]);
  if (kind !== 'error') setTimeout(() => dismissToast(id), 4000);
}
export const dismissToast = (id: number): void => toastStore.set((l) => l.filter((t) => t.id !== id));
export const toastError = (e: unknown): void => toast(e instanceof Error ? e.message : 'Something went wrong', 'error');
