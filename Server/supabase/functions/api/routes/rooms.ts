// routes/rooms.ts — single hard-coded "Random" room (basic-level MVP).

import type { RequestCtx } from '../_shared/types.ts';
import { json } from '../_shared/response.ts';

const ROOMS = [
  { id: 'random', name: 'Random', description: 'Everything today.' },
];

export async function list(_ctx: RequestCtx): Promise<Response> {
  return json({ rooms: ROOMS });
}
