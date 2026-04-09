import { ActivityType, PrismaClient, Visibility } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

type SeedUser = {
  email: string;
  password: string;
  handle: string;
  displayName: string;
  bio: string;
  identitySummary: string;
};

type SeedContent = {
  key: string;
  title: string;
  canonicalUrl: string;
  description: string;
  sourceName: string;
  sourceSlug: string;
  sourceDomain: string;
  contentTypeName: string;
  contentTypeSlug: string;
  topics: string[];
};

const TOPICS = [
  { name: "Philosophy", slug: "philosophy" },
  { name: "Design", slug: "design" },
  { name: "Artificial Intelligence", slug: "artificial-intelligence" },
  { name: "Economics", slug: "economics" },
  { name: "Literature", slug: "literature" },
  { name: "History", slug: "history" },
];

const USERS: SeedUser[] = [
  {
    email: "ios@noetic.dev",
    password: "noetic-ios-demo",
    handle: "ios-demo",
    displayName: "iOS Demo User",
    bio: "Testing the NOETIC mobile experience with realistic network activity.",
    identitySummary: "Tracks ideas across philosophy, design, and AI.",
  },
  {
    email: "maria@noetic.dev",
    password: "noetic-network",
    handle: "maria-chen",
    displayName: "Maria Chen",
    bio: "Product strategist reading at the edges of systems and culture.",
    identitySummary: "Focuses on design systems, media theory, and tech criticism.",
  },
  {
    email: "devon@noetic.dev",
    password: "noetic-network",
    handle: "devon-hale",
    displayName: "Devon Hale",
    bio: "Engineer interested in AI alignment, institutions, and public reasoning.",
    identitySummary: "Blends AI research, governance, and philosophy of science.",
  },
  {
    email: "amira@noetic.dev",
    password: "noetic-network",
    handle: "amira-noor",
    displayName: "Amira Noor",
    bio: "Economic historian mapping old ideas onto modern internet behavior.",
    identitySummary: "Analyzes economics, history, and narrative strategy.",
  },
  {
    email: "leo@noetic.dev",
    password: "noetic-network",
    handle: "leo-park",
    displayName: "Leo Park",
    bio: "Builder studying attention, education, and creative tools.",
    identitySummary: "Explores learning systems, AI tooling, and long-form writing.",
  },
];

const CONTENT: SeedContent[] = [
  {
    key: "yt-rsa",
    title: "The Rules for Rulers",
    canonicalUrl: "https://www.youtube.com/watch?v=rStL7niR7gs",
    description: "A concise systems-level explanation of how political power is sustained.",
    sourceName: "YouTube",
    sourceSlug: "youtube",
    sourceDomain: "youtube.com",
    contentTypeName: "Video",
    contentTypeSlug: "video",
    topics: ["history", "economics"],
  },
  {
    key: "yt-llm",
    title: "Attention Is All You Need (Explained)",
    canonicalUrl: "https://www.youtube.com/watch?v=iDulhoQ2pro",
    description: "Practical walkthrough of transformer architecture and attention mechanics.",
    sourceName: "YouTube",
    sourceSlug: "youtube",
    sourceDomain: "youtube.com",
    contentTypeName: "Video",
    contentTypeSlug: "video",
    topics: ["artificial-intelligence"],
  },
  {
    key: "essay-design",
    title: "The Shape of Design",
    canonicalUrl: "https://shapeofdesignbook.com/",
    description: "Essay-book on intention, craft, and constraints in design work.",
    sourceName: "Shape of Design",
    sourceSlug: "shape-of-design",
    sourceDomain: "shapeofdesignbook.com",
    contentTypeName: "Article",
    contentTypeSlug: "article",
    topics: ["design", "philosophy"],
  },
  {
    key: "essay-history",
    title: "History of Economic Thought Overview",
    canonicalUrl: "https://www.econlib.org/library/Enc/EconomicThought.html",
    description: "Survey of how core economic ideas developed over time.",
    sourceName: "Econlib",
    sourceSlug: "econlib",
    sourceDomain: "econlib.org",
    contentTypeName: "Article",
    contentTypeSlug: "article",
    topics: ["economics", "history"],
  },
  {
    key: "essay-reading",
    title: "How to Read a Book",
    canonicalUrl: "https://fs.blog/how-to-read-a-book/",
    description: "On active reading and extracting signal from dense material.",
    sourceName: "Farnam Street",
    sourceSlug: "farnam-street",
    sourceDomain: "fs.blog",
    contentTypeName: "Article",
    contentTypeSlug: "article",
    topics: ["literature", "philosophy"],
  },
];

async function upsertTopics() {
  const topicMap = new Map<string, string>();

  for (const topic of TOPICS) {
    const created = await prisma.topic.upsert({
      where: { slug: topic.slug },
      update: { name: topic.name },
      create: {
        name: topic.name,
        slug: topic.slug,
      },
      select: { id: true, slug: true },
    });
    topicMap.set(created.slug, created.id);
  }

  return topicMap;
}

async function upsertUsers() {
  const userMap = new Map<string, string>();

  for (const seedUser of USERS) {
    const passwordHash = await hash(seedUser.password, 12);
    const user = await prisma.user.upsert({
      where: { email: seedUser.email },
      update: {
        name: seedUser.displayName,
        passwordHash,
      },
      create: {
        email: seedUser.email,
        name: seedUser.displayName,
        passwordHash,
      },
      select: { id: true },
    });

    await prisma.profile.upsert({
      where: { userId: user.id },
      update: {
        handle: seedUser.handle,
        displayName: seedUser.displayName,
        bio: seedUser.bio,
        identitySummary: seedUser.identitySummary,
        isOnboarded: true,
      },
      create: {
        userId: user.id,
        handle: seedUser.handle,
        displayName: seedUser.displayName,
        bio: seedUser.bio,
        identitySummary: seedUser.identitySummary,
        isOnboarded: true,
      },
    });

    userMap.set(seedUser.email, user.id);
  }

  return userMap;
}

async function upsertContent(topicMap: Map<string, string>) {
  const contentMap = new Map<string, string>();

  for (const content of CONTENT) {
    const source = await prisma.contentSource.upsert({
      where: { slug: content.sourceSlug },
      update: {
        name: content.sourceName,
        domain: content.sourceDomain,
      },
      create: {
        name: content.sourceName,
        slug: content.sourceSlug,
        domain: content.sourceDomain,
      },
      select: { id: true },
    });

    const contentType = await prisma.contentType.upsert({
      where: { slug: content.contentTypeSlug },
      update: { name: content.contentTypeName },
      create: {
        name: content.contentTypeName,
        slug: content.contentTypeSlug,
      },
      select: { id: true },
    });

    const item = await prisma.contentItem.upsert({
      where: { canonicalUrl: content.canonicalUrl },
      update: {
        title: content.title,
        description: content.description,
        sourceId: source.id,
        contentTypeId: contentType.id,
      },
      create: {
        title: content.title,
        description: content.description,
        canonicalUrl: content.canonicalUrl,
        originalUrl: content.canonicalUrl,
        sourceId: source.id,
        contentTypeId: contentType.id,
      },
      select: { id: true },
    });

    await prisma.contentItemTopic.deleteMany({ where: { contentItemId: item.id } });
    await prisma.contentItemTopic.createMany({
      data: content.topics
        .map((topicSlug) => topicMap.get(topicSlug))
        .filter((topicId): topicId is string => Boolean(topicId))
        .map((topicId) => ({ contentItemId: item.id, topicId })),
      skipDuplicates: true,
    });

    contentMap.set(content.key, item.id);
  }

  return contentMap;
}

async function seedNetwork(userMap: Map<string, string>, contentMap: Map<string, string>, topicMap: Map<string, string>) {
  const seededUserIds = [...userMap.values()];

  await prisma.activityEvent.deleteMany({
    where: {
      OR: [
        { actorId: { in: seededUserIds } },
        { targetUserId: { in: seededUserIds } },
      ],
    },
  });
  await prisma.review.deleteMany({ where: { authorId: { in: seededUserIds } } });
  await prisma.logEntry.deleteMany({ where: { userId: { in: seededUserIds } } });
  await prisma.follow.deleteMany({
    where: {
      OR: [
        { followerId: { in: seededUserIds } },
        { followingId: { in: seededUserIds } },
      ],
    },
  });

  const demoUserId = userMap.get("ios@noetic.dev")!;
  const mariaId = userMap.get("maria@noetic.dev")!;
  const devonId = userMap.get("devon@noetic.dev")!;
  const amiraId = userMap.get("amira@noetic.dev")!;
  const leoId = userMap.get("leo@noetic.dev")!;

  await prisma.follow.createMany({
    data: [
      { followerId: demoUserId, followingId: mariaId },
      { followerId: demoUserId, followingId: devonId },
      { followerId: demoUserId, followingId: amiraId },
      { followerId: mariaId, followingId: demoUserId },
      { followerId: devonId, followingId: demoUserId },
      { followerId: leoId, followingId: demoUserId },
    ],
    skipDuplicates: true,
  });

  const now = Date.now();
  const seededLogs = [
    {
      userId: mariaId,
      contentId: contentMap.get("essay-design")!,
      rating: 9,
      review: "Great framing for making intentional design decisions under real constraints.",
      topicSlugs: ["design", "philosophy"],
      hoursAgo: 2,
    },
    {
      userId: devonId,
      contentId: contentMap.get("yt-llm")!,
      rating: 8,
      review: "Clean transformer explanation. Good refresher for attention mechanics.",
      topicSlugs: ["artificial-intelligence"],
      hoursAgo: 4,
    },
    {
      userId: amiraId,
      contentId: contentMap.get("essay-history")!,
      rating: 8,
      review: "Strong historical context for why modern policy debates keep repeating old patterns.",
      topicSlugs: ["economics", "history"],
      hoursAgo: 8,
    },
    {
      userId: leoId,
      contentId: contentMap.get("essay-reading")!,
      rating: 7,
      review: "Actionable reading model. Easy to apply to long, dense essays.",
      topicSlugs: ["literature", "philosophy"],
      hoursAgo: 14,
    },
    {
      userId: mariaId,
      contentId: contentMap.get("yt-rsa")!,
      rating: 9,
      review: "Still one of the best explainers for incentive-driven systems.",
      topicSlugs: ["history", "economics"],
      hoursAgo: 20,
    },
  ];

  for (const item of seededLogs) {
    const loggedAt = new Date(now - item.hoursAgo * 60 * 60 * 1000);

    const logEntry = await prisma.logEntry.create({
      data: {
        userId: item.userId,
        contentItemId: item.contentId,
        rating: item.rating,
        visibility: Visibility.PUBLIC,
        loggedAt,
      },
      select: { id: true },
    });

    const topicIds = item.topicSlugs
      .map((slug) => topicMap.get(slug))
      .filter((topicId): topicId is string => Boolean(topicId));

    if (topicIds.length > 0) {
      await prisma.logEntryTopic.createMany({
        data: topicIds.map((topicId) => ({
          logEntryId: logEntry.id,
          topicId,
        })),
        skipDuplicates: true,
      });
    }

    const review = await prisma.review.create({
      data: {
        logEntryId: logEntry.id,
        authorId: item.userId,
        content: item.review,
        visibility: Visibility.PUBLIC,
      },
      select: { id: true },
    });

    await prisma.activityEvent.create({
      data: {
        actorId: item.userId,
        type: ActivityType.REVIEWED_CONTENT,
        contentItemId: item.contentId,
        logEntryId: logEntry.id,
        reviewId: review.id,
        visibility: Visibility.PUBLIC,
        weight: 1.5,
        occurredAt: loggedAt,
        metadata: { seeded: true },
      },
    });
  }
}

async function main() {
  const topicMap = await upsertTopics();
  const userMap = await upsertUsers();
  const contentMap = await upsertContent(topicMap);
  await seedNetwork(userMap, contentMap, topicMap);

  console.log("Seed complete.");
  console.log("Demo login: ios@noetic.dev / noetic-ios-demo");
  console.log("Additional users: maria@noetic.dev, devon@noetic.dev, amira@noetic.dev, leo@noetic.dev (password: noetic-network)");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
