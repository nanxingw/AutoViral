import { z } from "zod";

export const PlatformSchema = z.enum(["youtube", "tiktok", "xiaohongshu", "douyin"]);
export type Platform = z.infer<typeof PlatformSchema>;

export const ItemSourceSchema = z.enum(["scraper", "rss", "agent_websearch", "proxy"]);
export type ItemSource = z.infer<typeof ItemSourceSchema>;

export const CoverAspectSchema = z.enum(["9:16", "1:1", "16:9"]);
export type CoverAspect = z.infer<typeof CoverAspectSchema>;

export const TrendItemSchema = z.object({
  id: z.string().min(1),
  platform: PlatformSchema,
  title: z.string().min(1).max(200),
  sourceUrl: z.string().url(),
  source: ItemSourceSchema,
  scrapedAt: z.string().datetime(),
  cover: z.object({
    url: z.string().url(),
    aspect: CoverAspectSchema,
    cachedPath: z.string().optional(),
  }),
  metrics: z.object({
    views: z.number().nullable(),
    likes: z.number().nullable(),
    comments: z.number().nullable(),
    shares: z.number().nullable(),
    fetchedAt: z.string().datetime(),
  }).nullable(),
  analysis: z.object({
    heat: z.number().int().min(1).max(5),
    competition: z.enum(["低", "中", "高"]),
    opportunity: z.enum(["金矿", "蓝海", "红海"]),
    description: z.string().min(20).max(500),
    tags: z.array(z.string()).min(3).max(5),
    contentAngles: z.array(z.string()).min(2).max(3),
    exampleHook: z.string().min(5).max(100),
    category: z.string().min(1),
  }),
});
export type TrendItem = z.infer<typeof TrendItemSchema>;

export const TrendsCollectionResultSchema = z.object({
  platform: PlatformSchema,
  items: z.array(TrendItemSchema).min(5).max(30),
  collectedAt: z.string().datetime(),
  pipelineStatus: z.enum(["ok", "partial", "failed"]),
  errors: z.array(z.string()),
  validation: z.object({
    passed: z.boolean(),
    issues: z.array(z.object({
      itemId: z.string().optional(),
      path: z.string(),
      message: z.string(),
    })),
  }),
});
export type TrendsCollectionResult = z.infer<typeof TrendsCollectionResultSchema>;

export interface ValidationIssue {
  path: string;
  message: string;
  itemId?: string;
}

export interface ValidationOutcome {
  passed: boolean;
  result: TrendsCollectionResult | null;
  issues: ValidationIssue[];
}

export function validateCollection(input: unknown): ValidationOutcome {
  const parsed = TrendsCollectionResultSchema.safeParse(input);
  if (parsed.success) return { passed: true, result: parsed.data, issues: [] };
  return {
    passed: false,
    result: null,
    issues: parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    })),
  };
}
