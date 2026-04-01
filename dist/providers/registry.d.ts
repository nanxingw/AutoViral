import type { GenerateProvider } from './base.js';
export declare function registerProvider(p: GenerateProvider): void;
export declare function getProvider(name: string): GenerateProvider | undefined;
export declare function getDefaultProvider(type: 'image' | 'video'): GenerateProvider | undefined;
export declare function listProviders(): {
    name: string;
    image: boolean;
    video: boolean;
}[];
export declare function initProviders(config: any): void;
//# sourceMappingURL=registry.d.ts.map