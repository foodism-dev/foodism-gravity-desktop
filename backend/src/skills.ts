import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { createDatabase, getDatabaseUrl, type ServerDatabase } from "./db/client.ts";
import { skills, skillTagLinks, skillTags, type SkillRow } from "./db/schema.ts";

export type MarketSkillStatus = "published" | "hidden" | "archived";

export interface MarketSkill {
  slug: string;
  name: string;
  summary: string | null;
  description: string | null;
  icon: string | null;
  status: MarketSkillStatus;
  packageUrl: string;
  packageSha256: string;
  packageSizeBytes: number;
  unpackedSizeBytes: number | null;
  fileCount: number | null;
  manifest: Record<string, unknown>;
  downloadCount: number;
  tags: string[];
  updatedAt: string;
}

export interface ListMarketSkillsInput {
  query?: string;
  tag?: string;
}

export interface UpsertMarketSkillInput {
  slug: string;
  name: string;
  summary: string | null;
  description: string | null;
  icon: string | null;
  status: MarketSkillStatus;
  packageUrl: string;
  packageSha256: string;
  packageSizeBytes: number;
  unpackedSizeBytes: number | null;
  fileCount: number | null;
  manifest: Record<string, unknown>;
  tags: string[];
}

export interface SkillRepository {
  listSkills: (input: ListMarketSkillsInput) => Promise<MarketSkill[]>;
  getSkillBySlug: (slug: string) => Promise<MarketSkill | null>;
  recordDownload: (slug: string) => Promise<MarketSkill | null>;
  upsertSkill: (input: UpsertMarketSkillInput) => Promise<MarketSkill>;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function mapSkill(row: SkillRow, tags: string[]): MarketSkill {
  return {
    slug: row.slug,
    name: row.name,
    summary: row.summary,
    description: row.description,
    icon: row.icon,
    status: row.status as MarketSkillStatus,
    packageUrl: row.packageUrl,
    packageSha256: row.packageSha256,
    packageSizeBytes: row.packageSizeBytes,
    unpackedSizeBytes: row.unpackedSizeBytes,
    fileCount: row.fileCount,
    manifest: row.manifest,
    downloadCount: row.downloadCount,
    tags,
    updatedAt: toIsoString(row.updatedAt),
  };
}

function buildSearchCondition(query: string | undefined) {
  const q = query?.trim();
  if (!q) return undefined;
  const pattern = `%${q}%`;
  return or(
    ilike(skills.slug, pattern),
    ilike(skills.name, pattern),
    ilike(skills.summary, pattern),
    ilike(skills.description, pattern),
  );
}

export function createDrizzleSkillRepository(db: ServerDatabase): SkillRepository {
  async function loadTags(skillIds: string[]): Promise<Map<string, string[]>> {
    const tagMap = new Map<string, string[]>();
    if (skillIds.length === 0) return tagMap;

    const rows = await db
      .select({
        skillId: skillTagLinks.skillId,
        tagSlug: skillTags.slug,
      })
      .from(skillTagLinks)
      .innerJoin(skillTags, eq(skillTags.id, skillTagLinks.tagId))
      .where(inArray(skillTagLinks.skillId, skillIds));

    for (const row of rows) {
      const existing = tagMap.get(row.skillId) ?? [];
      existing.push(row.tagSlug);
      tagMap.set(row.skillId, existing);
    }

    return tagMap;
  }

  return {
    async listSkills(input: ListMarketSkillsInput): Promise<MarketSkill[]> {
      const searchCondition = buildSearchCondition(input.query);
      const conditions = [
        eq(skills.status, "published"),
        ...(searchCondition ? [searchCondition] : []),
      ];

      const rows = input.tag?.trim()
        ? await db
          .select({ skill: skills })
          .from(skills)
          .innerJoin(skillTagLinks, eq(skillTagLinks.skillId, skills.id))
          .innerJoin(skillTags, eq(skillTags.id, skillTagLinks.tagId))
          .where(and(...conditions, eq(skillTags.slug, input.tag.trim())))
          .orderBy(desc(skills.updatedAt))
        : await db
          .select({ skill: skills })
          .from(skills)
          .where(and(...conditions))
          .orderBy(desc(skills.updatedAt));

      const skillRows = rows.map((row) => row.skill);
      const tagMap = await loadTags(skillRows.map((row) => row.id));
      return skillRows.map((row) => mapSkill(row, tagMap.get(row.id) ?? []));
    },

    async getSkillBySlug(slug: string): Promise<MarketSkill | null> {
      const [row] = await db
        .select()
        .from(skills)
        .where(and(eq(skills.slug, slug), eq(skills.status, "published")))
        .limit(1);

      if (!row) return null;
      const tagMap = await loadTags([row.id]);
      return mapSkill(row, tagMap.get(row.id) ?? []);
    },

    async recordDownload(slug: string): Promise<MarketSkill | null> {
      const current = await this.getSkillBySlug(slug);
      if (!current) return null;

      const [updated] = await db
        .update(skills)
        .set({
          downloadCount: current.downloadCount + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(skills.slug, slug), eq(skills.status, "published")))
        .returning();

      if (!updated) return null;
      const tagMap = await loadTags([updated.id]);
      return mapSkill(updated, tagMap.get(updated.id) ?? []);
    },

    async upsertSkill(input: UpsertMarketSkillInput): Promise<MarketSkill> {
      const now = new Date();
      const [row] = await db
        .insert(skills)
        .values({
          slug: input.slug,
          name: input.name,
          summary: input.summary,
          description: input.description,
          icon: input.icon,
          status: input.status,
          packageUrl: input.packageUrl,
          packageSha256: input.packageSha256,
          packageSizeBytes: input.packageSizeBytes,
          unpackedSizeBytes: input.unpackedSizeBytes,
          fileCount: input.fileCount,
          manifest: input.manifest,
          publishedAt: input.status === "published" ? now : null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: skills.slug,
          set: {
            name: input.name,
            summary: input.summary,
            description: input.description,
            icon: input.icon,
            status: input.status,
            packageUrl: input.packageUrl,
            packageSha256: input.packageSha256,
            packageSizeBytes: input.packageSizeBytes,
            unpackedSizeBytes: input.unpackedSizeBytes,
            fileCount: input.fileCount,
            manifest: input.manifest,
            publishedAt: input.status === "published" ? now : null,
            updatedAt: now,
          },
        })
        .returning();

      if (!row) {
        throw new Error("Skill 保存失败");
      }

      await db.delete(skillTagLinks).where(eq(skillTagLinks.skillId, row.id));
      for (const tag of input.tags) {
        const [tagRow] = await db
          .insert(skillTags)
          .values({ slug: tag, name: tag })
          .onConflictDoUpdate({
            target: skillTags.slug,
            set: { name: tag },
          })
          .returning();
        if (!tagRow) continue;
        await db
          .insert(skillTagLinks)
          .values({ skillId: row.id, tagId: tagRow.id })
          .onConflictDoNothing();
      }

      return mapSkill(row, input.tags);
    },
  };
}

let defaultRepository: SkillRepository | null | undefined;

export function getDefaultSkillRepository(): SkillRepository | null {
  if (defaultRepository !== undefined) {
    return defaultRepository;
  }

  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    defaultRepository = null;
    return defaultRepository;
  }

  defaultRepository = createDrizzleSkillRepository(createDatabase(databaseUrl));
  return defaultRepository;
}
