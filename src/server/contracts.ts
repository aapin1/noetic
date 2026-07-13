import { z } from "zod";

export const visibilitySchema = z.enum(["PUBLIC", "PRIVATE", "FOLLOWERS"]);
export const devicePlatformSchema = z.enum(["IOS", "ANDROID", "WEB"]);
export const deviceProviderSchema = z.enum(["APNS", "FCM", "EXPO"]);

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(120).optional(),
});

export const tokenSchema = z.object({
  // Accepts either an email address or a profile handle.
  identifier: z.string().min(1).max(120),
  password: z.string().min(8).max(128),
});

export const insightStyleSchema = z.enum(["DIRECT", "REFLECTIVE", "ANALYTICAL"]);

export const onboardingProfileSchema = z.object({
  handle: z.string().min(2).max(40).regex(/^[a-z0-9_]+$/).optional(),
  displayName: z.string().min(1).max(120).optional(),
  bio: z.string().max(280).optional(),
  publicNotes: z.string().max(4000).optional(),
  avatarUrl: z.string().url().optional(),
  topics: z.array(z.string().min(1).max(80)).min(3).max(5),
  insightStyle: insightStyleSchema.optional(),
});

export const updateProfileSchema = onboardingProfileSchema.partial().extend({
  handle: z.string().min(3).max(40).regex(/^[a-z0-9_]+$/).optional(),
});

export const ingestContentSchema = z.object({
  url: z.string().url(),
});

export const manualContentSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(4000).optional(),
  canonicalUrl: z.string().url().optional(),
  originalUrl: z.string().url().optional(),
  siteName: z.string().max(160).optional(),
  imageUrl: z.string().url().optional(),
  authorName: z.string().max(160).optional(),
  publishedAt: z.string().datetime().optional(),
  sourceName: z.string().max(160).optional(),
  sourceDomain: z.string().max(200).optional(),
  contentType: z.string().min(1).max(80).optional(),
  topics: z.array(z.string().min(1).max(80)).max(20).default([]),
});

export const createLogEntrySchema = z.object({
  contentItemId: z.string().min(1),
  rating: z.number().int().min(1).max(5).optional(),
  annotation: z.string().max(4000).optional(),
  review: z.string().max(8000).optional(),
  topics: z.array(z.string().min(1).max(80)).max(20).default([]),
  visibility: visibilitySchema.default("PUBLIC"),
});

export const updateReviewSchema = z.object({
  logEntryId: z.string().min(1),
  content: z.string().min(1).max(8000),
  visibility: visibilitySchema.default("PUBLIC"),
});

export const rankingItemSchema = z.object({
  contentItemId: z.string().min(1),
  note: z.string().max(1000).optional(),
});

export const upsertRankingSchema = z.object({
  rankingListId: z.string().min(1).optional(),
  title: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  visibility: visibilitySchema.default("PUBLIC"),
  items: z.array(rankingItemSchema).min(1).max(100),
});

export const reorderRankingSchema = z.object({
  rankingListId: z.string().min(1),
  contentItemIds: z.array(z.string().min(1)).min(1).max(100),
});

export const followUserSchema = z.object({
  targetUserId: z.string().min(1),
});

export const unfollowUserSchema = z.object({
  targetUserId: z.string().min(1),
});

export const likeReviewSchema = z.object({
  reviewId: z.string().min(1),
});

export const saveContentSchema = z.object({
  contentItemId: z.string().min(1),
});

export const commentSchema = z.object({
  reviewId: z.string().min(1),
  parentId: z.string().min(1).optional(),
  content: z.string().min(1).max(4000),
  visibility: visibilitySchema.default("PUBLIC"),
});

export const searchSchema = z.object({
  query: z.string().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

export const compareProfilesSchema = z.object({
  targetHandle: z.string().min(3).max(40),
});

export const getFeedSchema = z.object({
  sort: z.enum(["relevance", "chronological"]).default("relevance"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const topicPageSchema = z.object({
  slug: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

export const contentPageSchema = z.object({
  id: z.string().min(1),
});

export const publicProfileSchema = z.object({
  handle: z.string().min(3).max(40),
});

export const registerDeviceTokenSchema = z.object({
  token: z.string().min(8).max(4096),
  platform: devicePlatformSchema,
  provider: deviceProviderSchema,
});

export const sendNotificationPayloadsSchema = z.object({
  notificationIds: z.array(z.string().min(1)).optional(),
  recipientId: z.string().min(1).optional(),
}).refine((value) => Boolean(value.notificationIds?.length || value.recipientId), {
  message: "notificationIds or recipientId is required",
});

export const captureKindSchema = z.enum(["LINK", "TEXT", "QUOTE", "IMAGE"]);

export const captureSchema = z.object({
  kind: captureKindSchema,
  url: z.string().url().max(2048).optional(),
  text: z.string().max(8000).optional(),
  caption: z.string().max(2000).optional(),
  mediaUrl: z.string().url().max(2048).optional(),
  reaction: z.string().max(500).optional(),
  userContext: z.string().max(4000).optional(),
  topicHints: z.array(z.string().min(1).max(80)).max(8).optional(),
}).superRefine((value, ctx) => {
  if (value.kind === "LINK" && !value.url) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "url is required for LINK captures", path: ["url"] });
  }

  if ((value.kind === "TEXT" || value.kind === "QUOTE") && !value.text) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "text is required", path: ["text"] });
  }

  if (value.kind === "IMAGE" && !value.mediaUrl && !value.caption && !value.text) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "image captures require mediaUrl or caption", path: ["mediaUrl"] });
  }
});

export const captureListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(80).default(20),
  query: z.string().trim().min(1).max(120).optional(),
  /** Capture id to page after (exclusive) — for the chronological diary. */
  cursor: z.string().min(1).optional(),
});

export const capturePreflightSchema = z.object({
  url: z.string().url().max(2048),
});

export const captureTranscribeSchema = z.object({
  audioBase64: z.string().min(100).max(12_000_000),
  mimeType: z.string().min(3).max(80).optional(),
});

export const captureUpdateSchema = z.object({
  userContext: z.string().min(1).max(4000),
});

export const memoryGraphSchema = z.object({
  limit: z.coerce.number().int().min(10).max(200).default(80),
  topicId: z.string().min(1).optional(),
});

export const memoryTrendsSchema = z.object({
  window: z.enum(["week", "month"]).default("week"),
});

export const updatePreferencesSchema = z.object({
  insightStyle: insightStyleSchema.optional(),
  preferences: z.record(z.string(), z.unknown()).optional(),
}).refine((value) => value.insightStyle !== undefined || value.preferences !== undefined, {
  message: "At least one preference field is required",
});

export const captureUploadSchema = z.object({
  imageBase64: z.string().min(100).max(8_000_000),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).optional(),
});

export const avatarUploadSchema = z
  .object({
    imageBase64: z.string().min(100).max(8_000_000).optional(),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).optional(),
    remove: z.boolean().optional(),
  })
  .refine((value) => value.remove === true || !!value.imageBase64, {
    message: "imageBase64 is required unless remove is true",
    path: ["imageBase64"],
  });

export const createPositionSchema = z.object({
  topicId: z.string().min(1),
  statement: z.string().min(10).max(2000),
  captureCountAtCreation: z.number().int().min(0).default(0),
});

export const acknowledgeSchema = z.object({
  revision: z.string().min(10).max(2000).optional(),
});

export const socraticReplySchema = z.object({
  content: z.string().min(1).max(4000),
});

export const companionReplySchema = z.object({
  content: z.string().min(1).max(4000),
  contextItemIds: z.array(z.string()).max(5).optional(),
});
