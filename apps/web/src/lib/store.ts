import { useSyncExternalStore } from 'react';

/** Minimal external store for useSyncExternalStore. */
export class Store<T> {
  private listeners = new Set<() => void>();
  constructor(private value: T) {}
  get = (): T => this.value;
  set(next: T | ((v: T) => T)): void {
    const v = typeof next === 'function' ? (next as (v: T) => T)(this.value) : next;
    if (Object.is(v, this.value)) return;
    this.value = v;
    this.listeners.forEach((l) => l());
  }
  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => this.listeners.delete(l); };
}
export function useStore<T>(s: Store<T>): T { return useSyncExternalStore(s.subscribe, s.get, s.get); }
export function useStoreSelector<T, R>(s: Store<T>, sel: (v: T) => R): R {
  let cache: { v: T; r: R } | null = null;
  return useSyncExternalStore(s.subscribe, () => { const v = s.get(); if (cache && cache.v === v) return cache.r; const r = sel(v); cache = { v, r }; return r; });
}
