interface CheckResult {
    name: string;
    passed: boolean;
    detail: string;
}
interface QualityDimension {
    name: string;
    score: number;
    feedback: string;
}
export interface EvaluationReport {
    processScore: number;
    outputScore: number;
    qualityScore: number;
    totalScore: number;
    details: {
        process: CheckResult[];
        output: CheckResult[];
        quality: QualityDimension[];
    };
    suggestions: string[];
}
export declare function evaluateWork(workId: string, contentType: "short-video" | "image-text"): Promise<EvaluationReport>;
export {};
//# sourceMappingURL=test-evaluator.d.ts.map