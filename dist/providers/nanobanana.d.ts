import type { GenerateProvider, ImageOpts, VideoOpts, GenerateResult } from './base.js';
export declare class NanoBananaProvider implements GenerateProvider {
    readonly name = "nanobanana";
    readonly supportsImage = true;
    readonly supportsVideo = false;
    private apiKey;
    constructor(apiKey: string);
    generateImage(opts: ImageOpts): Promise<GenerateResult>;
    generateVideo(_opts: VideoOpts): Promise<GenerateResult>;
}
//# sourceMappingURL=nanobanana.d.ts.map