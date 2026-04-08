import slugify from "slugify";
import type { DbClient } from "@/server/db";

export function normalizeTopicName(topic: string) {
  return topic.trim().replace(/\s+/g, " ");
}

export function topicSlug(topic: string) {
  return slugify(normalizeTopicName(topic), { lower: true, strict: true, trim: true });
}

export async function upsertTopics(db: DbClient, topics: string[]) {
  const normalized = [...new Set(topics.map(normalizeTopicName).filter(Boolean))];

  const created = [] as { id: string; name: string; slug: string }[];

  for (const topic of normalized) {
    const slug = topicSlug(topic);
    const existing = await db.topic.upsert({
      where: { slug },
      update: { name: topic },
      create: { name: topic, slug },
      select: { id: true, name: true, slug: true },
    });

    created.push(existing);
  }

  return created;
}
