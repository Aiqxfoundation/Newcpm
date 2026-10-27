import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

let pool: any;
let db: any;

if (process.env.DATABASE_URL) {
  try {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });
  } catch (err) {
    console.warn("[AI Studio] Database connection error - using mock fallback", err);
  }
}

if (!db) {
  console.warn("[AI Studio] DATABASE_URL not set - using mock database");
  pool = {
    query: async () => ({ rows: [] }),
    connect: async () => ({ query: async () => ({ rows: [] }), release: () => {} }),
  };
  const createQueryChain = () => {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      offset: () => chain,
      values: () => chain,
      set: () => chain,
      returning: async () => [],
      onConflictDoNothing: () => chain,
      onConflictDoUpdate: () => chain,
      for: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      execute: async () => [],
      then: (resolve: any) => Promise.resolve([]).then(resolve),
      catch: (reject: any) => Promise.resolve([]).catch(reject),
    };
    return chain;
  };
  db = {
    select: () => createQueryChain(),
    insert: () => createQueryChain(),
    update: () => createQueryChain(),
    delete: () => createQueryChain(),
    execute: async () => [],
    transaction: async (cb: any) => cb(db),
    query: new Proxy({}, {
      get: () => ({
        findMany: async () => [],
        findFirst: async () => null,
        findUnique: async () => null,
      }),
    }),
  };
}

export { pool, db };
export * from "./schema";
