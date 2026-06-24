import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createDatabase, getDatabaseUrl, type ServerDatabase } from "./db/client.ts";
import { users, type UserRow } from "./db/schema.ts";
import type { ApiUser } from "./auth.ts";

export interface UserWithPasswordHash extends ApiUser {
  passwordHash: string;
}

export interface UserRepository {
  findById: (id: string) => Promise<ApiUser | null>;
  findByUsername: (username: string) => Promise<UserWithPasswordHash | null>;
  ensureSsoUser: (user: ApiUser) => Promise<ApiUser>;
}

function mapUser(row: UserRow): ApiUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
  };
}

function mapUserWithPasswordHash(row: UserRow): UserWithPasswordHash {
  return {
    ...mapUser(row),
    passwordHash: row.passwordHash,
  };
}

export function createDrizzleUserRepository(db: ServerDatabase): UserRepository {
  return {
    async findById(id: string): Promise<ApiUser | null> {
      const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return user ? mapUser(user) : null;
    },

    async findByUsername(username: string): Promise<UserWithPasswordHash | null> {
      const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
      return user ? mapUserWithPasswordHash(user) : null;
    },

    async ensureSsoUser(user: ApiUser): Promise<ApiUser> {
      const passwordHash = await Bun.password.hash(`sso:${user.id}:${randomUUID()}`);
      const [savedUser] = await db
        .insert(users)
        .values({
          username: user.username,
          displayName: user.displayName,
          passwordHash,
        })
        .onConflictDoUpdate({
          target: users.username,
          set: {
            displayName: user.displayName,
            updatedAt: new Date(),
          },
        })
        .returning();

      return savedUser ? mapUser(savedUser) : user;
    },
  };
}

let defaultRepository: UserRepository | null | undefined;

export function getDefaultUserRepository(): UserRepository | null {
  if (defaultRepository !== undefined) {
    return defaultRepository;
  }

  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    console.warn("[数据库] 未配置 DATABASE_URL，登录接口使用开发测试账号");
    defaultRepository = null;
    return defaultRepository;
  }

  defaultRepository = createDrizzleUserRepository(createDatabase(databaseUrl));
  return defaultRepository;
}
