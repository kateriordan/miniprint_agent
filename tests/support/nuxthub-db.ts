// Stand-in for the `@nuxthub/db` virtual module so server utils run under vitest.
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as auth from "../../server/db/schema/auth";
import * as miniprint from "../../server/db/schema/miniprint";

export const schema = { ...auth, ...miniprint };
export const db = drizzle(postgres(process.env.DATABASE_URL!, { max: 4 }), { schema });
