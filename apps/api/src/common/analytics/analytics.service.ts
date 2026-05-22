import { Injectable, Logger, Optional, type OnModuleDestroy } from '@nestjs/common';
import { PostHog } from 'posthog-node';

import type { Role } from '@repo/shared';

import { env } from '../../env.js';

export interface CaptureInput {
  /** `User.id` of the actor. PostHog's `distinct_id` is set to this so
   *  the funnel can join the signup, sign-in, and bill-paid events on
   *  the same person. */
  userId: string;
  event: string;
  properties?: Record<string, unknown>;
}

export interface IdentifyInput {
  userId: string;
  /** Carries the user's role (array — a user may hold multiple). The
   *  `role` PostHog property is the canonical filter for per-role
   *  funnels and dashboards. */
  roles: Role[];
}

/**
 * Server-side PostHog wrapper. One `PostHog` SDK instance per process,
 * lazy-initialised on first capture so unit tests that don't set
 * `POSTHOG_KEY` never construct one.
 *
 * No-ops cleanly when `POSTHOG_KEY` is unset — local dev, CI, and the
 * unit suite all run without a key by default.
 */
@Injectable()
export class AnalyticsService implements OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsService.name);
  private client: PostHog | null = null;
  private initialized = false;

  /**
   * `@Optional()` so Nest doesn't try to resolve `PostHog` from the DI
   * graph (it isn't registered as a provider). Production passes
   * `undefined` and the lazy init below builds the real client from
   * env; tests pass a vi.fn-stubbed PostHog directly.
   */
  constructor(@Optional() client?: PostHog) {
    if (client) {
      this.client = client;
      this.initialized = true;
    }
  }

  private getClient(): PostHog | null {
    if (this.initialized) return this.client;
    this.initialized = true;
    if (!env.POSTHOG_KEY) return null;
    this.client = new PostHog(env.POSTHOG_KEY, {
      host: env.POSTHOG_HOST,
      // Conservative defaults — batch up to 20 events or 10s.
      flushAt: 20,
      flushInterval: 10_000,
    });
    return this.client;
  }

  capture(input: CaptureInput): void {
    const ph = this.getClient();
    if (!ph) return;
    try {
      ph.capture({
        distinctId: input.userId,
        event: input.event,
        properties: input.properties,
      });
    } catch (err) {
      // PostHog is fire-and-forget. A failure here should not bubble
      // up into a domain handler and 500 the request.
      this.logger.warn(`posthog capture failed: ${(err as Error).message}`);
    }
  }

  identify(input: IdentifyInput): void {
    const ph = this.getClient();
    if (!ph) return;
    try {
      ph.identify({
        distinctId: input.userId,
        properties: {
          role: input.roles,
          // PostHog's `$set` shorthand for person properties — keeps
          // the role queryable across events.
          $set: { role: input.roles },
        },
      });
    } catch (err) {
      this.logger.warn(`posthog identify failed: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) return;
    // 2-second flush budget on shutdown. Acceptable for serverless
    // cold-stop semantics — anything older than the previous batch
    // is already in PostHog.
    await this.client._shutdown(2_000).catch(() => undefined);
  }

  /**
   * GDPR person delete (Phase 9.3). Issues a `DELETE` against
   * PostHog's persons endpoint, scoped to the project. Requires
   * `POSTHOG_PERSONAL_API_KEY` — the ingest key has no delete perm.
   *
   * Returns `{ called: false, status: null }` when the personal API
   * key is unset; the audit row records that for ops follow-up.
   * Non-2xx responses don't throw — the orchestrator records the
   * status code and continues. The DB anonymization is the source
   * of truth; PostHog deletion is best-effort.
   */
  async deletePerson(input: { distinctId: string }): Promise<{
    called: boolean;
    status: number | null;
  }> {
    if (!env.POSTHOG_PERSONAL_API_KEY) {
      return { called: false, status: null };
    }
    try {
      const url = new URL(
        `/api/projects/@current/persons/?distinct_id=${encodeURIComponent(input.distinctId)}`,
        env.POSTHOG_HOST,
      );
      const response = await fetch(url.toString(), {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${env.POSTHOG_PERSONAL_API_KEY}`,
        },
      });
      if (!response.ok) {
        this.logger.warn(
          `posthog deletePerson failed: HTTP ${response.status} for ${input.distinctId}`,
        );
      }
      return { called: true, status: response.status };
    } catch (err) {
      this.logger.warn(`posthog deletePerson errored: ${(err as Error).message}`);
      return { called: true, status: null };
    }
  }
}
