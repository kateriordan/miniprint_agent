import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { sql } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";

/**
 * This app holds one person's private messages, so sign-up is closed:
 * only emails in MP_ALLOWED_EMAILS may register, or — when that is unset —
 * only the very first account.
 */
async function assertSignupAllowed(email: string) {
  const allowed = (process.env.MP_ALLOWED_EMAILS ?? "")
    .split(",")
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length > 0) {
    if (!allowed.includes(email.trim().toLowerCase())) {
      throw new APIError("FORBIDDEN", { message: "Sign-up is restricted on this app." });
    }
    return;
  }
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.user);
  if ((row?.n ?? 0) > 0) {
    throw new APIError("FORBIDDEN", { message: "Sign-up is closed on this app." });
  }
}

const productionUrl = process.env.BETTER_AUTH_URL?.trim();

export const auth = betterAuth({
  baseURL: productionUrl,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: productionUrl ? [productionUrl] : undefined,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          await assertSignupAllowed(user.email);
        },
      },
    },
  },
});
