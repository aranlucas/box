import { authHeader } from './auth';
import { API_BASE, publicOrigin } from './config';

export { API_BASE, publicOrigin };

export type Item = { id?: string; name: string; quantity: number | null; source: 'ai' | 'manual' };
export type Photo = { id: string; created_at: number };
export type Box = {
  id: string;
  house_id: string;
  number: number;
  title: string;
  room: string | null;
  notes: string | null;
  status: 'packed' | 'unpacked';
  created_at: number;
  updated_at: number;
  items: Item[];
  photos: Photo[];
  can_edit?: boolean;
};
export type BoxSummary = Omit<Box, 'items' | 'photos'> & { item_count: number; preview: string | null };
export type Role = 'owner' | 'member';
export type House = { id: string; name: string; role: Role };
export type User = { id: string; name: string | null; email: string | null };
export type Me = { user: User | null; houses: House[]; legacyHomeClaimable: boolean };
export type Member = { user_id: string; name: string | null; email: string | null; role: Role };
export type PendingInvite = { id: string; created_at: number; expires_at: number };
export type InviteInfo = { house_name: string; inviter_name: string | null; status: 'valid' | 'used' | 'expired' | 'revoked' };

/** A device in the house that has a printer connected right now (a row of the connection status table). */
export type HouseholdPrinter = { device_id: string; device_name: string; printer_name: string | null; last_seen: number };
export type RemoteLabel = { number: number; title: string; url: string };
export type QueuedJob = { id: string; label: RemoteLabel; requestedBy: string; createdAt: number };
export type PrintJob = { id: string; status: 'queued' | 'printing' | 'done' | 'failed'; error?: string | null; via: string | null };

/** Best label for a person; null when the auth service gave us neither name nor email. */
export const displayName = (p: { name: string | null; email: string | null } | null | undefined) =>
  p?.name?.trim() || p?.email?.trim() || null;

export const HOME_ID = 'HOME0000';
export const boxUrl = (id: string) => `${publicOrigin()}/b/${id}`;
export const photoUrl = (id: string) => `${API_BASE}/api/photos/${id}`;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(await authHeader())) headers.set(k, v);
  if (init.body && typeof init.body === 'string') headers.set('content-type', 'application/json');
  const res = await fetch(`${API_BASE}/api${path}`, { ...init, headers });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, (body.error as string) ?? `Request failed (${res.status})`, body);
  return body as T;
}

const json = (method: string, data?: unknown): RequestInit => ({ method, body: data === undefined ? undefined : JSON.stringify(data) });
const inHouse = (houseId: string, init: RequestInit = {}): RequestInit => ({ ...init, headers: { 'x-house-id': houseId } });

export const api = {
  me: () => request<Me>('/me'),
  createHouse: (name: string) => request<{ house: House }>('/houses', json('POST', { name })).then((r) => r.house),
  claimHome: (key: string) => request<{ house: House }>(`/houses/${HOME_ID}/claim`, json('POST', { key })).then((r) => r.house),
  members: (houseId: string) => request<{ members: Member[]; invites: PendingInvite[] }>(`/houses/${houseId}/members`),
  removeMember: (houseId: string, userId: string) => request(`/houses/${houseId}/members/${userId}`, { method: 'DELETE' }),
  createInvite: (houseId: string) => request<{ url: string; expires_at: number }>(`/houses/${houseId}/invites`, { method: 'POST' }),
  revokeInvite: (houseId: string, inviteId: string) => request(`/houses/${houseId}/invites/${inviteId}`, { method: 'DELETE' }),
  inviteInfo: (token: string) => request<InviteInfo>(`/invites/${token}`),
  acceptInvite: (token: string) => request<{ house: House }>(`/invites/${token}/accept`, { method: 'POST' }).then((r) => r.house),

  listBoxes: (houseId: string, q?: string, signal?: AbortSignal) =>
    request<{ boxes: BoxSummary[] }>(`/boxes${q ? `?q=${encodeURIComponent(q)}` : ''}`, {
      headers: { 'x-house-id': houseId },
      signal,
    }).then((r) => r.boxes),
  getBox: (id: string) => request<{ box: Box }>(`/boxes/${id}`).then((r) => r.box),
  createBox: (houseId: string, photo: FormDataPhoto) =>
    request<{ box: Box; aiFailed: boolean }>('/boxes', {
      method: 'POST',
      body: photoForm(photo),
      headers: { 'x-house-id': houseId },
    }),
  addPhoto: (id: string, photo: FormDataPhoto) =>
    request<{ box: Box; aiFailed: boolean }>(`/boxes/${id}/photos`, { method: 'POST', body: photoForm(photo) }),
  updateBox: (id: string, patch: Partial<Pick<Box, 'title' | 'room' | 'notes' | 'status'>>) =>
    request<{ box: Box }>(`/boxes/${id}`, json('PATCH', patch)).then((r) => r.box),
  /** ifUpdatedAt: the box version the editor started from; the server answers 409 if it changed. */
  saveItems: (id: string, items: Item[], ifUpdatedAt?: number) =>
    request<{ box: Box }>(`/boxes/${id}/items`, json('PUT', { items, if_updated_at: ifUpdatedAt })).then((r) => r.box),
  deleteBox: (id: string) => request<{ ok: true }>(`/boxes/${id}`, { method: 'DELETE' }),

  // Shared printing within a house (see apps/worker/src/printing.ts).
  listPrinters: (houseId: string) =>
    request<{ printers: HouseholdPrinter[] }>('/printers', inHouse(houseId)).then((r) => r.printers),
  printerHeartbeat: (houseId: string, body: { deviceId: string; deviceName: string; printerName?: string }) =>
    request<{ jobs: QueuedJob[] }>('/printers/heartbeat', inHouse(houseId, json('POST', body))).then((r) => r.jobs),
  printerOffline: (houseId: string, deviceId: string) =>
    request<{ ok: true }>(`/printers/${encodeURIComponent(deviceId)}`, inHouse(houseId, { method: 'DELETE' })),
  createPrintJob: (houseId: string, deviceId: string, label: RemoteLabel) =>
    request<{ job: PrintJob }>('/print-jobs', inHouse(houseId, json('POST', { deviceId, label }))).then((r) => r.job),
  getPrintJob: (houseId: string, id: string) =>
    request<{ job: PrintJob }>(`/print-jobs/${id}`, inHouse(houseId)).then((r) => r.job),
  claimPrintJob: (houseId: string, id: string, deviceId: string) =>
    request<{ ok: true }>(`/print-jobs/${id}/claim`, inHouse(houseId, json('POST', { deviceId }))),
  completePrintJob: (houseId: string, id: string, deviceId: string, result: { ok: boolean; error?: string }) =>
    request<{ ok: true }>(`/print-jobs/${id}/complete`, inHouse(houseId, json('POST', { deviceId, ...result }))),
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
