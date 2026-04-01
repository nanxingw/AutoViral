export interface Config {
    port: number;
    model: string;
    jimeng: {
        accessKey: string;
        secretKey: string;
    };
    openrouter?: {
        apiKey: string;
    };
    research: {
        enabled: boolean;
        schedule: string;
        platforms: string[];
    };
    interests?: string[];
    memory?: {
        apiKey: string;
        userId: string;
        syncEnabled: boolean;
    };
    analytics?: {
        douyinUrl: string;
        collectInterval: number;
        enabled: boolean;
    };
}
/** Base data directory for works, trends, etc. */
export declare const dataDir: string;
export declare function getDefaultConfig(): Config;
export declare function ensureDir(dirPath: string): Promise<void>;
export declare function loadConfig(): Promise<Config>;
export declare function saveConfig(config: Config): Promise<void>;
export declare function getConfigDir(): string;
//# sourceMappingURL=config.d.ts.map