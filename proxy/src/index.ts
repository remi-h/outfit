import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import { PLAN_SYSTEM, TAG_SYSTEM } from './prompts';
import {
  ItemTagsSchema,
  PlanRequestSchema,
  PlanSchema,
  TagRequestSchema,
  type MediaType,
  type PlanRequest,
} from './schemas';

export interface Env {
  /** `npx wrangler secret put ANTHROPIC_API_KEY` */
  ANTHROPIC_API_KEY: string;
  /** `npx wrangler secret put APP_TOKEN` */
  APP_TOKEN: string;
}

/** Chosen in idea.md. No date suffix — the bare id is the whole model id. */
const MODEL = 'claude-sonnet-5';

/** Non-streaming default. Lowballing this truncates the JSON mid-object. */
const MAX_TOKENS = 16000;

/**
 * The app owns the single retry (plan.md, "Retry semantics"), so the Worker
 * must not retry on its own — otherwise one user tap can become six model
 * calls. `maxRetries: 0` also stops the SDK retrying 429s, which the app
 * wants to surface immediately.
 */
const CLIENT_OPTIONS = { maxRetries: 0, timeout: 120_000 } as const;

// ---------------------------------------------------------------- responses

type ErrorCode =
  | 'unauthorized'
  | 'bad_request'
  | 'not_found'
  | 'rate_limited'
  | 'invalid_output'
  | 'upstream'
  | 'connection'
  | 'internal';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function fail(status: number, error: ErrorCode, message?: string): Response {
  return json(status, message ? { error, message } : { error });
}

// ---------------------------------------------------------------- auth

/**
 * Compares two secrets without leaking their length or a mismatch position.
 * Both sides are hashed to a fixed 32 bytes first, so the XOR loop below runs
 * the same number of iterations whatever the caller sent.
 */
async function secretsMatch(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i]! ^ vb[i]!;
  return diff === 0;
}

async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  const expected = env.APP_TOKEN;
  if (typeof expected !== 'string' || expected.length === 0) return false;

  const header = request.headers.get('authorization') ?? '';
  const prefix = 'Bearer ';
  // Run the comparison even when the prefix is wrong, so a malformed header
  // is not measurably faster to reject than a wrong token.
  const presented = header.startsWith(prefix) ? header.slice(prefix.length) : '';
  const wellFormed = header.startsWith(prefix);

  const equal = await secretsMatch(presented, expected);
  return wellFormed && equal;
}

// ---------------------------------------------------------------- helpers

async function readJsonBody(request: Request): Promise<unknown> {
  // `request.json()` throws on malformed JSON and on an empty body; the
  // caller turns that into a 400.
  return await request.json();
}

/** Base64 must reach the API as one unbroken line. Be forgiving about it. */
function stripWhitespace(value: string): string {
  return value.replace(/\s+/g, '');
}

function line(label: string, value: unknown): string {
  return `## ${label}\n${JSON.stringify(value)}`;
}

function buildPlanUserMessage(body: PlanRequest): string {
  const parts: string[] = [
    `Plan one outfit for each of these dates, in this order: ${body.days.join(', ')}.`,
    line('Closet items', body.items),
    line('Forecast (Celsius)', body.forecast),
  ];

  if (Object.keys(body.dressCodes).length > 0) {
    parts.push(line('Dress code by date', body.dressCodes));
  }
  if (body.otherDays.length > 0) {
    parts.push(
      line('Outfits already planned for other days (do not change these)', body.otherDays),
    );
  }
  if (body.closetNotes.length > 0) {
    parts.push(
      [
        '## Closet notes',
        'Facts about this closet, checked by the app. Not preferences:',
        ...body.closetNotes.map((n) => `- ${n}`),
      ].join('\n'),
    );
  }
  if (body.stylePreference.trim().length > 0) {
    parts.push(`## Style preference\n${body.stylePreference.trim()}`);
  }
  if (body.violations.length > 0) {
    parts.push(
      [
        '## Corrections',
        'Your previous answer broke these rules. Fix every one of them:',
        ...body.violations.map((v) => `- ${v}`),
      ].join('\n'),
    );
  }

  return parts.join('\n\n');
}

/**
 * Maps SDK failures onto the error contract in plan.md.
 *
 * Order matters and differs slightly from plan.md's sketch, which used the
 * Python class names: the TypeScript SDK has no `APIStatusError`, and its
 * `APIConnectionError` *extends* `APIError`. So connection errors must be
 * checked before the generic status error, or they would be reported as 502.
 * `AnthropicError` is the base class and catches the parse/validation failure
 * the SDK throws when the model's JSON does not satisfy the zod schema.
 */
function mapModelError(e: unknown): Response {
  if (e instanceof Anthropic.RateLimitError) {
    return fail(429, 'rate_limited');
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return fail(503, 'connection');
  }
  if (e instanceof Anthropic.APIError) {
    return fail(502, 'upstream', `${e.status}`);
  }
  if (e instanceof Anthropic.AnthropicError) {
    // Thrown by `messages.parse()` when the returned JSON fails the schema.
    return fail(502, 'invalid_output');
  }
  return fail(500, 'internal');
}

// ---------------------------------------------------------------- handlers

async function handleTag(request: Request, env: Env): Promise<Response> {
  let raw: unknown;
  try {
    raw = await readJsonBody(request);
  } catch {
    return fail(400, 'bad_request', 'Body is not valid JSON.');
  }

  const parsed = TagRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return fail(400, 'bad_request', 'Expected { image: string, mediaType?: string }.');
  }

  const data = stripWhitespace(parsed.data.image);
  if (data.length === 0) {
    return fail(400, 'bad_request', 'Field "image" is empty.');
  }
  const mediaType: MediaType = parsed.data.mediaType ?? 'image/jpeg';

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, ...CLIENT_OPTIONS });

  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: TAG_SYSTEM,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: zodOutputFormat(ItemTagsSchema) },
      messages: [
        {
          role: 'user',
          content: [
            // Image first, then the instruction — better results on vision.
            { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
            { type: 'text', text: 'Tag this clothing item.' },
          ],
        },
      ],
    });

    const tags = response.parsed_output;
    if (tags === null) {
      return fail(502, 'invalid_output');
    }
    return json(200, { tags });
  } catch (e) {
    return mapModelError(e);
  }
}

async function handlePlan(request: Request, env: Env): Promise<Response> {
  let raw: unknown;
  try {
    raw = await readJsonBody(request);
  } catch {
    return fail(400, 'bad_request', 'Body is not valid JSON.');
  }

  const parsed = PlanRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return fail(400, 'bad_request', 'Expected { items, forecast, days, ... } per the proxy API.');
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, ...CLIENT_OPTIONS });

  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // PLAN_SYSTEM is constant, so it is worth a cache breakpoint. Everything
      // that varies per request lives in the user message after it.
      system: [{ type: 'text', text: PLAN_SYSTEM, cache_control: { type: 'ephemeral' } }],
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: zodOutputFormat(PlanSchema) },
      messages: [{ role: 'user', content: buildPlanUserMessage(parsed.data) }],
    });

    const plan = response.parsed_output;
    if (plan === null) {
      return fail(502, 'invalid_output');
    }
    return json(200, { days: plan.days });
  } catch (e) {
    return mapModelError(e);
  }
}

// ---------------------------------------------------------------- router

// A Map, not a plain object: `ROUTES['constructor']` on an object literal
// returns an inherited function, and `POST /constructor` would then sail past
// the 404 check. A Map has no prototype chain to walk.
const ROUTES = new Map<string, (request: Request, env: Env) => Promise<Response>>([
  ['/tag', handleTag],
  ['/plan', handlePlan],
]);

/**
 * Typed structurally rather than with the `ExportedHandler<Env>` global. The
 * repo root's Expo `tsconfig.json` globs `**\/*.ts`, so it compiles these
 * files too, and the Workers globals are not in scope there. Keeping the
 * Worker free of ambient Workers-only *types* means the app's typecheck stays
 * green either way.
 */
const worker: { fetch(request: Request, env: Env): Promise<Response> } = {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      // Auth first, before routing: an unauthenticated scanner then learns
      // nothing about which paths exist — every request looks the same.
      if (!(await isAuthorized(request, env))) {
        return fail(401, 'unauthorized');
      }
      if (!env.ANTHROPIC_API_KEY) {
        // Misconfigured deploy, not a client error. Reachable only with a
        // valid APP_TOKEN, so it is safe to say which secret is missing.
        return fail(500, 'internal', 'Worker is missing the ANTHROPIC_API_KEY secret.');
      }

      const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
      const handler = ROUTES.get(path);

      if (!handler) {
        return fail(404, 'not_found', 'Try POST /tag or POST /plan.');
      }
      if (request.method !== 'POST') {
        // Deliberately 400 and not 405: plan.md's error vocabulary is what
        // the app's api.ts switches on, and it has no method-not-allowed code.
        return fail(400, 'bad_request', 'Use POST.');
      }

      return await handler(request, env);
    } catch (e) {
      // Last line of defence: nothing escapes as a raw 500 with a stack.
      // Log the class only — never the error body, which can echo request
      // content, and never anything derived from env.
      console.error('unhandled', e instanceof Error ? e.name : typeof e);
      return fail(500, 'internal');
    }
  },
};

export default worker;
