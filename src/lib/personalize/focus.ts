import { db } from "@/lib/db";

export type UserFocusData = { request: string; mutedKeywords: string[]; mutedSources: string[] };

const DEFAULT_FOCUS: UserFocusData = { request: "", mutedKeywords: [], mutedSources: [] };

export async function getUserFocus(userId: string): Promise<UserFocusData> {
  const row = await db.userFocus.findUnique({ where: { userId } });
  if (!row) return DEFAULT_FOCUS;
  return { request: row.request, mutedKeywords: row.mutedKeywords, mutedSources: row.mutedSources };
}

export async function saveUserFocus(userId: string, data: Partial<UserFocusData>) {
  return db.userFocus.upsert({
    where: { userId },
    update: data,
    create: { userId, ...DEFAULT_FOCUS, ...data }
  });
}
