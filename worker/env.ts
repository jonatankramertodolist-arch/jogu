export interface Env {
  DB: D1Database;
  /**
   * Google's OAuth client id. Public on purpose: the browser has to present it
   * to sign in. No client secret is involved, because we verify a signed id
   * token rather than exchanging an authorisation code.
   */
  GOOGLE_CLIENT_ID: string;
  /**
   * Base64 AES-256 key that the athletes' Anthropic keys are encrypted against.
   * Set with `wrangler pages secret put`, so it lives outside the database and a
   * copy of the data alone reveals nothing.
   */
  KEY_ENCRYPTION_SECRET: string;
}
