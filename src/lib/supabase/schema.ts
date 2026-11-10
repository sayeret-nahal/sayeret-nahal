/** Postgres schema of the app's tables: "public" normally, a dedicated schema when sharing a Supabase project. */
export const DB_SCHEMA = process.env.NEXT_PUBLIC_DB_SCHEMA || "public";
