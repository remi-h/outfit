import { z } from 'zod';

/**
 * Model output schemas.
 *
 * These are passed to `zodOutputFormat()` and become the structured-output
 * JSON schema. The SDK strips constraints the API does not support (`min`,
 * `max`, `int`) from the wire schema and re-checks them locally when parsing,
 * so a response that breaks one of them fails parsing rather than being
 * silently accepted.
 */

export const CategorySchema = z.enum([
  'top',
  'bottom',
  'outerwear',
  'shoes',
  'dress',
  'accessory',
]);

export const FormalitySchema = z.enum(['casual', 'smart', 'formal']);

export const SeasonSchema = z.enum(['spring', 'summer', 'autumn', 'winter']);

export const ItemTagsSchema = z.object({
  category: CategorySchema,
  color: z.string(),
  warmth: z.number().int().min(1).max(5),
  formality: FormalitySchema,
  rainproof: z.boolean(),
  season: z.array(SeasonSchema).min(1),
});

export const PlanSchema = z.object({
  days: z.array(
    z.object({
      date: z.string(),
      item_ids: z.array(z.string()),
      reason: z.string(),
    }),
  ),
});

export type ItemTags = z.infer<typeof ItemTagsSchema>;
export type Plan = z.infer<typeof PlanSchema>;

/**
 * Request body schemas.
 *
 * Deliberately permissive about the *contents* of `items` / `forecast` — the
 * app owns the data model and the outfit-rule validation. The Worker only
 * checks enough shape to build a sane prompt and to reject junk with a 400
 * instead of forwarding it to Claude.
 */

const MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

export const TagRequestSchema = z.object({
  image: z.string().min(1),
  mediaType: z.enum(MEDIA_TYPES).optional(),
});

export type TagRequest = z.infer<typeof TagRequestSchema>;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const PlanRequestSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        tags: ItemTagsSchema,
      }),
    )
    .min(1),
  forecast: z
    .array(
      z.object({
        date: z.string(),
        tMaxC: z.number(),
        tMinC: z.number(),
        rainChance: z.number(),
        weatherCode: z.number(),
      }),
    )
    .default([]),
  days: z.array(z.string().min(1)).min(1),
  otherDays: z
    .array(
      z.object({
        date: z.string(),
        itemIds: z.array(z.string()),
      }),
    )
    .default([]),
  dressCodes: z.record(z.string(), FormalitySchema).default({}),
  stylePreference: z.string().default(''),
  violations: z.array(z.string()).default([]),
});

export type PlanRequest = z.infer<typeof PlanRequestSchema>;
