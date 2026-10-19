import type { SessionContext } from "eve/context";
import { CONNECT_USER_ISSUER } from "../../shared/connect.js";
import { appOrigin, internalHeaders } from "./internal-api.js";

/**
 * The app user this session acts for. Only the web app's own session and
 * Slack/iMessage identities linked to an app account qualify; anything else
 * (an unlinked Slack user, a schedule) has no access to MiniPrint data.
 */
export function requireOwnerId(ctx: SessionContext): string {
  const auth = ctx.session.auth.current;
  const linked = auth?.authenticator === "app" || auth?.authenticator === CONNECT_USER_ISSUER;
  if (!auth || auth.principalType !== "user" || !linked || auth.principalId.startsWith("eve:")) {
    throw new Error("MiniPrint data is only available to the signed-in owner. Sign in on the web app or link this account first.");
  }
  return auth.principalId;
}

export async function callMiniprintTool<T = unknown>(ctx: SessionContext & { abortSignal?: AbortSignal }, name: string, input: unknown): Promise<T> {
  const ownerId = requireOwnerId(ctx);
  const response = await fetch(`${appOrigin()}/api/internal/mp/tools/${name}`, {
    method: "POST",
    headers: internalHeaders(),
    body: JSON.stringify({ ownerId, input }),
    signal: ctx.abortSignal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { statusMessage?: string; message?: string } | null;
    throw new Error(`${name} failed (${response.status}): ${body?.statusMessage ?? body?.message ?? response.statusText}`);
  }
  return response.json() as Promise<T>;
}
