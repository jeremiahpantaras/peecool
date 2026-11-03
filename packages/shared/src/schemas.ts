import { z } from 'zod';
import { ruleOverridesSchema, rulesSchema } from './scoring/rules';

export const idParam = z.object({ id: z.coerce.number().int().positive() });

/* ---- auth / users ---- */
export const loginSchema = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(200) });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(8).max(200) });
export const setupSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits, . _ - only'),
  displayName: z.string().min(1).max(60),
  password: z.string().min(8).max(200),
  facilityName: z.string().min(1).max(80).optional(),
  courtCount: z.number().int().min(0).max(24).optional(),
});
export const createUserSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits, . _ - only'),
  displayName: z.string().min(1).max(60),
  password: z.string().min(8).max(200),
  role: z.enum(['admin', 'staff']).default('staff'),
  mustChangePassword: z.boolean().default(true),
});
export const patchUserSchema = z.object({
  displayName: z.string().min(1).max(60).optional(),
  role: z.enum(['admin', 'staff']).optional(),
  isActive: z.boolean().optional(),
});
export const resetPasswordSchema = z.object({ newPassword: z.string().min(8).max(200) });
export const terminalSchema = z.object({ courtId: z.number().int().positive(), replaceExisting: z.boolean().optional() });

/* ---- courts ---- */
export const createCourtSchema = z.object({
  name: z.string().trim().min(1).max(40),
  shortCode: z.string().trim().min(1).max(4),
  description: z.string().max(200).nullable().optional(),
});
export const bulkCourtsSchema = z.object({ count: z.number().int().min(1).max(24), namePrefix: z.string().max(30).optional() });
export const patchCourtSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  shortCode: z.string().trim().min(1).max(4).optional(),
  description: z.string().max(200).nullable().optional(),
  isActive: z.boolean().optional(),
  bookingAction: z.enum(['keep', 'cancel']).optional(),
});
export const courtOrderSchema = z.object({ courtIds: z.array(z.number().int().positive()).min(1) });
export const maintenanceSchema = z.object({ enabled: z.boolean(), note: z.string().max(200).nullable().optional() });

/* ---- players / formats ---- */
export const createPlayerSchema = z.object({
  displayName: z.string().trim().min(1).max(30),
  fullName: z.string().trim().max(80).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});
export const patchPlayerSchema = createPlayerSchema.partial().extend({ isActive: z.boolean().optional() });
export const addTypedToDirectorySchema = z.object({ name: z.string().min(1).max(30), displayName: z.string().trim().min(1).max(30).optional(), dryRun: z.boolean().optional() });
export const linkTypedSchema = z.object({ name: z.string().min(1).max(30) });

export const presetSchema = z.object({ name: z.string().trim().min(1).max(50), rules: rulesSchema });
export const patchPresetSchema = z.object({ name: z.string().trim().min(1).max(50).optional(), rules: rulesSchema.optional(), isActive: z.boolean().optional() });

/* ---- matches ---- */
const slotPlayer = z.object({
  team: z.enum(['A', 'B']), slot: z.union([z.literal(1), z.literal(2)]),
  playerId: z.number().int().positive().nullable().optional(),
  displayName: z.string().max(60).nullable().optional(),
});
export type SlotPlayerInput = z.infer<typeof slotPlayer>;

export const createMatchSchema = z.object({
  courtId: z.number().int().positive(),
  playType: z.enum(['singles', 'doubles']),
  formatId: z.number().int().positive().optional(),
  ruleOverrides: ruleOverridesSchema.optional(),
  teamAName: z.string().max(30).optional(),
  teamBName: z.string().max(30).optional(),
  players: z.array(slotPlayer).max(4).optional(),
  bookingId: z.number().int().positive().nullable().optional(),
  acknowledgeBooking: z.boolean().optional(),
  clientRequestId: z.string().max(64).optional(),
});

const team = z.enum(['A', 'B']);
const slot = z.union([z.literal(1), z.literal(2)]);
const startRight = z.object({ A: slot, B: slot }).partial();

export const commandSchema = z.object({
  commandId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  expectedVersion: z.number().int().min(0),
  type: z.enum(['START_MATCH', 'RALLY_WON', 'UNDO', 'ADJUST_SCORE', 'START_NEXT_GAME', 'PAUSE', 'RESUME', 'SWAP_SIDES',
    'UPDATE_PLAYERS', 'UPDATE_RULES', 'CONFIRM_MATCH_END', 'END_MATCH', 'CANCEL', 'RECORD_RESULT']),
  payload: z.record(z.any()).default({}),
});
export type CommandBody = z.infer<typeof commandSchema>;

export const payloadSchemas = {
  START_MATCH: z.object({ servingTeam: team.optional(), startRight: startRight.optional(), leftTeam: team.optional() }),
  RALLY_WON: z.object({ team }),
  UNDO: z.object({}).passthrough(),
  ADJUST_SCORE: z.object({
    scoreA: z.number().int().min(0).max(200), scoreB: z.number().int().min(0).max(200),
    servingTeam: team.optional(), serverNumber: z.union([z.literal(1), z.literal(2)]).optional(), serverSlot: slot.optional(),
    rightSlot: startRight.optional(), reason: z.string().max(60).optional(),
  }),
  START_NEXT_GAME: z.object({ servingTeam: team.optional(), startRight: startRight.optional(), swapDisplay: z.boolean().optional() }),
  PAUSE: z.object({ reason: z.string().max(60).optional() }),
  RESUME: z.object({}).passthrough(),
  SWAP_SIDES: z.object({}).passthrough(),
  UPDATE_PLAYERS: z.object({
    teamAName: z.string().max(30).optional(), teamBName: z.string().max(30).optional(), players: z.array(slotPlayer).max(4).optional(),
  }),
  UPDATE_RULES: z.object({
    playType: z.enum(['singles', 'doubles']).optional(), formatId: z.number().int().positive().optional(), ruleOverrides: ruleOverridesSchema.optional(),
  }),
  CONFIRM_MATCH_END: z.object({}).passthrough(),
  END_MATCH: z.object({
    reason: z.enum(['time_up', 'injury', 'players_left', 'other']), note: z.string().max(200).optional(), confirmed: z.literal(true),
  }),
  CANCEL: z.object({}).passthrough(),
  RECORD_RESULT: z.object({ scoreA: z.number().int().min(0).max(200).optional(), scoreB: z.number().int().min(0).max(200).optional(), winner: team.optional() }),
} as const;

export const correctionSchema = z.object({
  commandId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  expectedVersion: z.number().int().min(0),
  games: z.array(z.object({ number: z.number().int().min(1).max(5), scoreA: z.number().int().min(0), scoreB: z.number().int().min(0), winner: team.optional() })).min(1),
  reason: z.string().trim().min(3).max(200),
  force: z.boolean().optional(),
});
export const finishedPlayersSchema = z.object({ players: z.array(slotPlayer).max(4), teamAName: z.string().max(30).optional(), teamBName: z.string().max(30).optional() });

/* ---- bookings ---- */
export const createBookingSchema = z.object({
  courtId: z.number().int().positive(),
  startAt: z.number().int().positive(),
  endAt: z.number().int().positive(),
  bookedByName: z.string().trim().min(1).max(60),
  phone: z.string().trim().max(30).nullable().optional(),
  playersCount: z.number().int().min(1).max(8).nullable().optional(),
  notes: z.string().max(300).nullable().optional(),
});
export const patchBookingSchema = createBookingSchema.partial();
export const cancelBookingSchema = z.object({ reason: z.string().max(200).optional() });

/* ---- settings ---- */
export const restoreSchema = z.object({ force: z.boolean().optional() });

/* ---- Open Play ---- */
const opPlayerInput = z.object({
  firstName: z.string().trim().max(40).nullable().optional(),
  lastName: z.string().trim().max(40).nullable().optional(),
  team: z.string().trim().max(40).nullable().optional(),
  /** Older single-field form, still accepted by the API. */
  displayName: z.string().max(60).nullable().optional(),
  playerId: z.number().int().positive().nullable().optional(),
}).refine((p) => !!p.playerId || !!p.displayName?.trim() || (!!p.firstName?.trim() && !!p.lastName?.trim()), 'First name and last name are required');
export const createOpenPlaySchema = z.object({
  name: z.string().trim().min(1).max(60),
  playType: z.enum(['singles', 'doubles']),
  courtIds: z.array(z.number().int().positive()).min(1).max(24),
  sessionMinutes: z.number().int().min(10).max(720).default(120),
  gameMinutes: z.number().int().min(3).max(120).default(15),
  changeoverMinutes: z.number().int().min(0).max(30).default(3),
  formatId: z.number().int().positive().optional(),
  players: z.array(opPlayerInput).max(200).optional(),
});
export const patchOpenPlaySchema = createOpenPlaySchema.omit({ players: true }).partial();
export const addOpenPlayPlayersSchema = z.object({ players: z.array(opPlayerInput).min(1).max(200) });
export const openPlayPlayerStatusSchema = z.object({ status: z.enum(['active', 'resting', 'left']) });
export const openPlayResultSchema = z.object({ scoreA: z.number().int().min(0).max(200), scoreB: z.number().int().min(0).max(200), winner: z.enum(['A', 'B']).optional() });
export const openPlayExtendSchema = z.object({ minutes: z.number().int().min(1).max(30) });
export const openPlaySwapSchema = z.object({ playerA: z.number().int().positive(), playerB: z.number().int().positive() });
export const openPlayEndSchema = z.object({ force: z.boolean().optional() });
