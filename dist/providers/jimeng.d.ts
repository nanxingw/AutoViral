import type { GenerateProvider, ImageOpts, VideoOpts, GenerateResult } from './base.js';
export declare class JimengProvider implements GenerateProvider {
    readonly name = "jimeng";
    readonly supportsImage = true;
    readonly supportsVideo = true;
    private accessKey;
    private secretKey;
    constructor(config: {
        accessKey: string;
        secretKey: string;
    });
    generateImage(opts: ImageOpts): Promise<GenerateResult>;
    generateVideo(opts: VideoOpts): Promise<GenerateResult>;
}
//# sourceMappingURL=jimeng.d.ts.map