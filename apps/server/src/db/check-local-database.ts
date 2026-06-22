import postgres from "postgres";

function getDatabaseUrl() {
  const databaseUrl = Bun.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL 未配置");
  }

  return databaseUrl;
}

const databaseUrl = getDatabaseUrl();
const parsedUrl = new URL(databaseUrl);
const sql = postgres(databaseUrl, {
  max: 1,
  connect_timeout: 5,
});

try {
  const [result] = await sql<{ db: string; user: string }[]>`
    select current_database() as db, current_user as user
  `;
  if (!result) {
    throw new Error("数据库连接检查未返回结果");
  }

  console.log(`[数据库] 连接成功: ${result.user}@${parsedUrl.host}/${result.db}`);
} finally {
  await sql.end({ timeout: 1 });
}
