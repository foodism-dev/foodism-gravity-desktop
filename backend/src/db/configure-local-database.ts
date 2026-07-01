import postgres from "postgres";

function getDatabaseUrl() {
  const databaseUrl = Bun.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL 未配置");
  }

  return databaseUrl;
}

function getDatabaseTimezone() {
  return Bun.env.DATABASE_TIMEZONE?.trim() || Bun.env.PGTZ?.trim() || Bun.env.TZ?.trim() || "Asia/Shanghai";
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

const databaseUrl = getDatabaseUrl();
const parsedUrl = new URL(databaseUrl);
const databaseName = parsedUrl.pathname.slice(1);
const databaseTimezone = getDatabaseTimezone();

if (!databaseName) {
  throw new Error("DATABASE_URL 必须包含数据库名");
}

const sql = postgres(databaseUrl, {
  max: 1,
  connect_timeout: 5,
});

try {
  const [session] = await sql<{ user: string }[]>`
    select current_user as user
  `;
  const databaseIdentifier = quoteIdentifier(databaseName);
  const roleIdentifier = quoteIdentifier(session?.user || parsedUrl.username);
  const timezoneLiteral = quoteLiteral(databaseTimezone);

  await sql.unsafe(`alter database ${databaseIdentifier} set timezone to ${timezoneLiteral}`);
  await sql.unsafe(`alter role ${roleIdentifier} set timezone to ${timezoneLiteral}`);
  await sql.unsafe(`set timezone to ${timezoneLiteral}`);

  const [result] = await sql<{ timezone: string }[]>`
    select current_setting('timezone') as timezone
  `;

  console.log(`[数据库] 已设置默认时区: database=${databaseName} role=${session?.user || parsedUrl.username} timezone=${result?.timezone || databaseTimezone}`);
} finally {
  await sql.end({ timeout: 1 });
}
