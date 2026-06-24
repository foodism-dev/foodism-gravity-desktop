import postgres from "postgres";

function getDatabaseUrl() {
  const databaseUrl = Bun.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL 未配置");
  }

  return databaseUrl;
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

const databaseUrl = getDatabaseUrl();
const parsedUrl = new URL(databaseUrl);
const databaseName = parsedUrl.pathname.slice(1);

if (!databaseName) {
  throw new Error("DATABASE_URL 必须包含数据库名");
}

const maintenanceUrl = new URL(parsedUrl);
maintenanceUrl.pathname = "/postgres";

const sql = postgres(maintenanceUrl.toString(), {
  max: 1,
  connect_timeout: 5,
});

try {
  const existing = await sql<{ datname: string }[]>`
    select datname from pg_database where datname = ${databaseName}
  `;

  if (existing.length > 0) {
    console.log(`[数据库] ${databaseName} 已存在，无需创建`);
  } else {
    await sql.unsafe(`create database ${quoteIdentifier(databaseName)}`);
    console.log(`[数据库] 已创建 ${databaseName}`);
  }
} finally {
  await sql.end({ timeout: 1 });
}
