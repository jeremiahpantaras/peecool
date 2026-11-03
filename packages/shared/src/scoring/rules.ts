import { z } from 'zod';
import type { MatchRules, PlayType } from '../types';
import { DEFAULT_RULES } from '../constants';

export const rulesSchema = z.object({
  scoringType: z.enum(['side_out', 'rally']),
  servingMode: z.enum(['auto', 'off']),
  pointsToWin: z.number().int().min(1).max(50),
  winBy: z.union([z.literal(1), z.literal(2)]),
  pointCap: z.number().int().min(2).max(100).nullable(),
  gamesToWin: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  decidingGamePoints: z.number().int().min(1).max(50).nullable(),
  firstServerRule: z.enum(['start_server_2', 'both_servers']),
  switchEndsPrompt: z.enum(['off', 'deciding_game', 'every_game']),
  timeLimitMinutes: z.number().int().min(1).max(600).nullable(),
  trackServerNames: z.boolean(),
});

export const ruleOverridesSchema = rulesSchema.partial();
export type RuleOverrides = z.infer<typeof ruleOverridesSchema>;

export interface RuleIssue { field: keyof MatchRules | 'rules'; message: string }

/** Shared by server and UI (MATCH_SCORING_LOGIC §3). Returns [] when valid. */
export function validateRules(_playType: PlayType, rules: MatchRules): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const parsed = rulesSchema.safeParse(rules);
  if (!parsed.success) {
    for (const i of parsed.error.issues) issues.push({ field: (i.path[0] as keyof MatchRules) ?? 'rules', message: i.message });
    return issues;
  }
  if (rules.scoringType === 'side_out' && rules.servingMode !== 'auto')
    issues.push({ field: 'servingMode', message: 'Side-out scoring needs automatic serving' });
  if (rules.pointCap != null) {
    if (rules.winBy === 1) issues.push({ field: 'pointCap', message: 'A point cap only makes sense when winning by 2' });
    if (rules.pointCap <= rules.pointsToWin) issues.push({ field: 'pointCap', message: 'Point cap must be higher than the target' });
    if (rules.decidingGamePoints != null && rules.pointCap <= rules.decidingGamePoints)
      issues.push({ field: 'pointCap', message: 'Point cap must be higher than the deciding-game target' });
  }
  if (rules.decidingGamePoints != null && rules.gamesToWin === 1)
    issues.push({ field: 'decidingGamePoints', message: 'A deciding-game target needs more than one game' });
  return issues;
}

export function applyOverrides(base: MatchRules, overrides: RuleOverrides | undefined | null): MatchRules {
  if (!overrides) return { ...base };
  const out: MatchRules = { ...base };
  for (const [k, v] of Object.entries(overrides)) if (v !== undefined) (out as unknown as Record<string, unknown>)[k] = v;
  return out;
}

export function rulesEqual(a: MatchRules, b: MatchRules): boolean {
  return (Object.keys(DEFAULT_RULES) as (keyof MatchRules)[]).every((k) => a[k] === b[k]);
}

export function describeRules(r: MatchRules): string {
  const best = r.gamesToWin === 1 ? '1 game' : `best of ${r.gamesToWin * 2 - 1} games`;
  const base = `${r.scoringType === 'side_out' ? 'Side-out' : 'Rally'} scoring, ${best} to ${r.pointsToWin}, win by ${r.winBy}`;
  const parts = [base];
  if (r.pointCap) parts.push(`cap ${r.pointCap}`);
  if (r.decidingGamePoints) parts.push(`deciding game to ${r.decidingGamePoints}`);
  parts.push(r.servingMode === 'auto' ? 'automatic serving' : 'serving not tracked');
  if (r.timeLimitMinutes) parts.push(`${r.timeLimitMinutes} min limit`);
  return parts.join('; ');
}
