// The JSON the Worker sends and the app reads. Types only: both sides import from here, so a
// change to a response shape fails the typecheck on whichever side was not updated.
import type { LabelInput } from '@box/label';

export type BoxStatus = 'packed' | 'unpacked';
export type Item = { id: string; name: string; quantity: number | null; source: 'ai' | 'manual' };
export type Photo = { id: string; created_at: number };

/** A row of the `boxes` table. */
export type BoxRow = {
  id: string;
  house_id: string;
  number: number;
  title: string;
  room: string | null;
  notes: string | null;
  status: BoxStatus;
  created_at: number;
  updated_at: number;
};
export type Box = BoxRow & { items: Item[]; photos: Photo[]; can_edit: boolean };
export type BoxSummary = BoxRow & { item_count: number; preview: string | null };
export type BoxPatch = Partial<Pick<BoxRow, 'title' | 'room' | 'notes' | 'status'>>;
/** What an editor sends for one row of the item list; the server assigns ids. */
export type ItemInput = Pick<Item, 'name' | 'quantity' | 'source'>;

export type Role = 'owner' | 'member';
export type House = { id: string; name: string; role: Role };
export type User = { id: string; name: string | null; email: string | null };
export type Me = { user: User | null; houses: House[] };
export type Member = { user_id: string; name: string | null; email: string | null; role: Role };
export type PendingInvite = { id: string; created_at: number; expires_at: number };
export type InviteStatus = 'valid' | 'used' | 'expired' | 'revoked';
export type InviteInfo = { house_name: string; inviter_name: string | null; status: InviteStatus };

/** A device in the house that has a printer connected right now (a row of the connection status table). */
export type HouseholdPrinter = {
  device_id: string;
  device_name: string;
  printer_name: string | null;
};
export type QueuedJob = { id: string; label: LabelInput; requestedBy: string; createdAt: number };
export type PrintJobStatus = 'queued' | 'printing' | 'done' | 'failed';
export type PrintJob = {
  id: string;
  status: PrintJobStatus;
  error: string | null;
  via: string | null;
};
