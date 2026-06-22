import postgres from "postgres";

const LOCAL_ADMIN_USERNAME = "admin";
const LOCAL_ADMIN_PASSWORD = "foodism123";
const LOCAL_ADMIN_DISPLAY_NAME = "管理员";

function getDatabaseUrl() {
  const databaseUrl = Bun.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL 未配置");
  }

  return databaseUrl;
}

const sql = postgres(getDatabaseUrl(), {
  max: 1,
  connect_timeout: 5,
});

try {
  const passwordHash = await Bun.password.hash(LOCAL_ADMIN_PASSWORD);
  await sql`
    insert into users (username, password_hash, display_name)
    values (${LOCAL_ADMIN_USERNAME}, ${passwordHash}, ${LOCAL_ADMIN_DISPLAY_NAME})
    on conflict (username) do update set
      password_hash = excluded.password_hash,
      display_name = excluded.display_name,
      updated_at = now()
  `;

  console.log(`[数据库] 已同步本地管理员账号: ${LOCAL_ADMIN_USERNAME}`);
} finally {
  await sql.end({ timeout: 1 });
}
