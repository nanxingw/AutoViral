declare const CATEGORIES: readonly ["characters", "music", "templates"];
export declare function ensureSharedDirs(): Promise<void>;
export declare function listSharedAssets(): Promise<Record<string, string[]>>;
export declare function getSharedAssetPath(category: string, filename: string): string;
export { CATEGORIES };
//# sourceMappingURL=shared-assets.d.ts.map