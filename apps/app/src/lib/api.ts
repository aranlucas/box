import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export type Item = { id?: string; name: string; quantity: number | null; source: 'ai' | 'manual' };
export type Photo = { id: string; created_at: number };
export type Box = {
  id: string;
  number: number;
  title: string;
  room: string | null;
  notes: string | null;
  status: 'packed' | 'unpacked';
  created_at: number;
  updated_at: number;
  items: Item[];
  photos: Photo[];
};
export type BoxSummary = Omit<Box, 'items' | 'photos'> & { item_count: number; preview: string | null };

/**
 * Where the Worker lives. On the web build it's the same origin (empty base); the native app and
 * local dev point at the deployed Worker via EXPO_PUBLIC_API_URL.
 */
export const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');

/** Origin printed into QR codes. Must be the deployed public origin, never localhost. */
export function publicOrigin(): string {
  if (process.env.EXPO_PUBLIC_PUBLIC_ORIGIN) return process.env.EXPO_PUBLIC_PUBLIC_ORIGIN.replace(/\/$/, '');
  if (API_BASE) return API_BASE;
  if (Platform.OS === 'web' && typeof window !== 'undefined') return window.location.origin;
  return '';
}

export const boxUrl = (id: string) => `${publicOrigin()}/b/${id}`;
export const photoUrl = (id: string) => `${API_BASE}/api/photos/${id}`;

const KEY_STORAGE = 'household-key';
let cachedKey: string | null | undefined;

export async function getHouseholdKey(): Promise<string | null> {
  if (cachedKey !== undefined) return cachedKey;
  cachedKey = await AsyncStorage.getItem(KEY_STORAGE).catch(() => null);
  return cachedKey;
}

export async function setHouseholdKey(key: string | null) {
  cachedKey = key;
  if (key) await AsyncStorage.setItem(KEY_STORAGE, key);
  else await AsyncStorage.removeItem(KEY_STORAGE);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = await getHouseholdKey();
  const headers = new Headers(init.headers);
  if (key) headers.set('x-household-key', key);
  if (init.body && typeof init.body === 'string') headers.set('content-type', 'application/json');
  const res = await fetch(`${API_BASE}/api${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  checkKey: (key: string) =>
    fetch(`${API_BASE}/api/auth/check`, { headers: { 'x-household-key': key } }).then((r) => r.ok),
  listBoxes: (q?: string, signal?: AbortSignal) =>
    request<{ boxes: BoxSummary[] }>(`/boxes${q ? `?q=${encodeURIComponent(q)}` : ''}`, { signal }).then((r) => r.boxes),
  getBox: (id: string) => request<{ box: Box }>(`/boxes/${id}`).then((r) => r.box),
  createBox: (photo: FormDataPhoto) =>
    request<{ box: Box; aiFailed: boolean }>('/boxes', { method: 'POST', body: photoForm(photo) }),
  addPhoto: (id: string, photo: FormDataPhoto) =>
    request<{ box: Box; aiFailed: boolean }>(`/boxes/${id}/photos`, { method: 'POST', body: photoForm(photo) }),
  updateBox: (id: string, patch: Partial<Pick<Box, 'title' | 'room' | 'notes' | 'status'>>) =>
    request<{ box: Box }>(`/boxes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }).then((r) => r.box),
  saveItems: (id: string, items: Item[]) =>
    request<{ box: Box }>(`/boxes/${id}/items`, { method: 'PUT', body: JSON.stringify({ items }) }).then((r) => r.box),
  deleteBox: (id: string) => request<{ ok: true }>(`/boxes/${id}`, { method: 'DELETE' }),
};

/** A photo ready for upload: a Blob on web, a file uri on native. */
export type FormDataPhoto = { blob: Blob } | { uri: string };

function photoForm(photo: FormDataPhoto): FormData {
  const form = new FormData();
  if ('blob' in photo) form.append('photo', photo.blob, 'box.jpg');
  // React Native's FormData accepts { uri, name, type } file descriptors.
  else form.append('photo', { uri: photo.uri, name: 'box.jpg', type: 'image/jpeg' } as unknown as Blob);
  return form;
}
