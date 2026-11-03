import { z } from 'zod';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const dayHoursSchema = z.object({ open: hhmm, close: hhmm });
export type DayHours = z.infer<typeof dayHoursSchema>;
/** key = ISO weekday 1 (Mon) .. 7 (Sun); `null` = closed that day */
export const operatingHoursSchema = z.record(z.enum(['1', '2', '3', '4', '5', '6', '7']), dayHoursSchema.nullable());
export type OperatingHours = z.infer<typeof operatingHoursSchema>;

export const settingsSchema = z.object({
  facilityName: z.string().min(1).max(80),
  operatingHours: operatingHoursSchema,
  completedDisplayMinutes: z.number().int().min(0).max(120),
  autoConfirmSeconds: z.number().int().min(10).max(3600),
  staleMatchMinutes: z.number().int().min(1).max(600),
  allowRuleOverrides: z.boolean(),
  endMatchHoldMs: z.number().int().min(1000).max(4000),
  adminLoginMasterPcOnly: z.boolean(),
  sessionIdleMinutes: z.number().int().min(5).max(10080),
  sessionMaxDays: z.number().int().min(1).max(90),
  terminalSessionDays: z.number().int().min(1).max(365),
  bookingSlotMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  bookingMaxHours: z.number().min(0.5).max(12),
  bookingAdvanceDays: z.number().int().min(1).max(730),
  bookingWarnMinutes: z.number().int().min(0).max(240),
  backupTime: hhmm,
  backupRetention: z.number().int().min(1).max(365),
  backupExtraPath: z.string().max(260).nullable(),
  courtTheme: z.enum(['dark', 'light']),
});
export type Settings = z.infer<typeof settingsSchema>;

const week = (): OperatingHours =>
  Object.fromEntries(['1', '2', '3', '4', '5', '6', '7'].map((d) => [d, { open: '07:00', close: '22:00' }])) as OperatingHours;

export const DEFAULT_SETTINGS: Settings = {
  facilityName: 'Pickleball Facility',
  operatingHours: week(),
  completedDisplayMinutes: 5,
  autoConfirmSeconds: 120,
  staleMatchMinutes: 20,
  allowRuleOverrides: true,
  endMatchHoldMs: 2000,
  adminLoginMasterPcOnly: false,
  sessionIdleMinutes: 480,
  sessionMaxDays: 7,
  terminalSessionDays: 30,
  bookingSlotMinutes: 30,
  bookingMaxHours: 4,
  bookingAdvanceDays: 90,
  bookingWarnMinutes: 15,
  backupTime: '23:30',
  backupRetention: 30,
  backupExtraPath: null,
  courtTheme: 'dark',
};

/** The subset of settings every signed-in client may read. */
export const PUBLIC_SETTING_KEYS = [
  'facilityName', 'allowRuleOverrides', 'endMatchHoldMs', 'autoConfirmSeconds', 'bookingSlotMinutes',
  'bookingMaxHours', 'bookingWarnMinutes', 'bookingAdvanceDays', 'operatingHours', 'courtTheme', 'completedDisplayMinutes',
] as const;
export type PublicSettings = Pick<Settings, (typeof PUBLIC_SETTING_KEYS)[number]> & { maxActiveCourts: number; timeZone: string };
