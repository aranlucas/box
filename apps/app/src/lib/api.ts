import type {
  Box,
  BoxPatch,
  BoxSummary,
  House,
  HouseholdPrinter,
  InviteInfo,
  ItemInput,
  Me,
  Member,
  PendingInvite,
  PrintJob,
  QueuedJob,
} from '@box/api';
import type { LabelInput } from '@box/label';

import { authHeader } from './auth';
import { API_BASE, publicOrigin } from './config';

export type * from '@box/api';

/** Best label for a person; undefined when the auth service gave us neither name nor email. */
export const displayName = (person: { name: string | null; email: string | null }) =>
  person.name?.trim() || person.email?.trim() || undefined;

export const boxUrl = (id: string) => `${publicOrigin()}/b/${id}`;
export const photoUrl = (id: string) => `${API_BASE}/api/photos/${id}`;

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** True for the API's answer `status` (404 for a missing box, 409 for a stale save, …). */
export const isApiError = (error: unknown, status: number) =>
  error instanceof ApiError && error.status === status;

/** The parsed body of an API response. `T` is the Worker's response type from @box/api. */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(await authHeader())) {
    headers.set(name, value);
  }
  if (typeof init.body === 'string') {
    headers.set('content-type', 'application/json');
  }
  const res = await fetch(`${API_BASE}/api${path}`, { ...init, headers });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the one place the app takes the Worker at its word
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`);
  }
  return body;
}

const json = (method: string, data: unknown): RequestInit => ({
  method,
  body: JSON.stringify(data),
});
const inHouse = (houseId: string, init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { 'x-house-id': houseId },
});

/** A photo ready for upload: a Blob on web, a file uri on native. */
export type FormDataPhoto = { blob: Blob } | { uri: string };

function photoForm(photo: FormDataPhoto): RequestInit {
  const form = new FormData();
  if ('blob' in photo) {
    form.append('photo', photo.blob, 'box.jpg');
  } else {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- React Native's FormData takes a { uri, name, type } file descriptor
    form.append('photo', {
      uri: photo.uri,
      name: 'box.jpg',
      type: 'image/jpeg',
    } as unknown as Blob);
  }
  return { method: 'POST', body: form };
}

type BoxWithAi = { box: Box; aiFailed: boolean };

export const api = {
  me: () => request<Me>('/me'),
  createHouse: (name: string) =>
    request<{ house: House }>('/houses', json('POST', { name })).then((r) => r.house),
  members: (houseId: string) =>
    request<{ members: Member[]; invites: PendingInvite[] }>(`/houses/${houseId}/members`),
  removeMember: (houseId: string, userId: string) =>
    request(`/houses/${houseId}/members/${userId}`, { method: 'DELETE' }),
  createInvite: (houseId: string) =>
    request<{ url: string; expires_at: number }>(`/houses/${houseId}/invites`, { method: 'POST' }),
  revokeInvite: (houseId: string, inviteId: string) =>
    request(`/houses/${houseId}/invites/${inviteId}`, { method: 'DELETE' }),
  inviteInfo: (token: string) => request<InviteInfo>(`/invites/${token}`),
  acceptInvite: (token: string) =>
    request<{ house: House }>(`/invites/${token}/accept`, { method: 'POST' }).then((r) => r.house),

  listBoxes: (houseId: string, q: string, signal: AbortSignal) =>
    request<{ boxes: BoxSummary[] }>(
      `/boxes?q=${encodeURIComponent(q)}`,
      inHouse(houseId, { signal }),
    ).then((r) => r.boxes),
  getBox: (id: string) => request<{ box: Box }>(`/boxes/${id}`).then((r) => r.box),
  createBox: (houseId: string, photo: FormDataPhoto) =>
    request<BoxWithAi>('/boxes', inHouse(houseId, photoForm(photo))),
  addPhoto: (id: string, photo: FormDataPhoto) =>
    request<BoxWithAi>(`/boxes/${id}/photos`, photoForm(photo)),
  updateBox: (id: string, patch: BoxPatch) =>
    request<{ box: Box }>(`/boxes/${id}`, json('PATCH', patch)).then((r) => r.box),
  /** ifUpdatedAt: the box version the editor started from; the server answers 409 if it changed. */
  saveItems: (id: string, items: ItemInput[], ifUpdatedAt: number) =>
    request<{ box: Box }>(
      `/boxes/${id}/items`,
      json('PUT', { items, if_updated_at: ifUpdatedAt }),
    ).then((r) => r.box),
  deleteBox: (id: string) => request(`/boxes/${id}`, { method: 'DELETE' }),

  // Shared printing within a house (see apps/worker/src/printing.ts).
  listPrinters: (houseId: string) =>
    request<{ printers: HouseholdPrinter[] }>('/printers', inHouse(houseId)).then(
      (r) => r.printers,
    ),
  printerHeartbeat: (
    houseId: string,
    device: { deviceId: string; deviceName: string; printerName: string },
  ) =>
    request<{ jobs: QueuedJob[] }>(
      '/printers/heartbeat',
      inHouse(houseId, json('POST', device)),
    ).then((r) => r.jobs),
  printerOffline: (houseId: string, deviceId: string) =>
    request(`/printers/${encodeURIComponent(deviceId)}`, inHouse(houseId, { method: 'DELETE' })),
  createPrintJob: (houseId: string, deviceId: string, label: LabelInput) =>
    request<{ job: PrintJob }>(
      '/print-jobs',
      inHouse(houseId, json('POST', { deviceId, label })),
    ).then((r) => r.job),
  getPrintJob: (houseId: string, id: string) =>
    request<{ job: PrintJob }>(`/print-jobs/${id}`, inHouse(houseId)).then((r) => r.job),
  claimPrintJob: (houseId: string, id: string, deviceId: string) =>
    request(`/print-jobs/${id}/claim`, inHouse(houseId, json('POST', { deviceId }))),
  completePrintJob: (
    houseId: string,
    id: string,
    deviceId: string,
    result: { ok: boolean; error?: string },
  ) =>
    request(`/print-jobs/${id}/complete`, inHouse(houseId, json('POST', { deviceId, ...result }))),
};
