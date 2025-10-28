import { ScrapingPlan } from "../interfaces/core";
import { logger } from "../utils/logger";

export class PlanFactoryService {
    public async createScrapingPlanFromAnalysis(params: {
        url: string;
        enhancedContentUrls: string[];
        listSelector: string;
        paginationSelector: string;
        detailSelectors: Record<string, string>;
        siblingResults: any[];
        contentAnalysis: any;
        cookieConsentMetadata: any;
        options: any;
    }): Promise<ScrapingPlan> {
        const {
            url,
            enhancedContentUrls,
            listSelector,
            paginationSelector,
            detailSelectors,
            siblingResults,
            contentAnalysis,
            cookieConsentMetadata,
            options
        } = params;

        const planId = `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const contentLinkSelector = siblingResults.length > 0
            ? siblingResults.find((r: any) => r.metadata?.contentLinkSelector)?.metadata?.contentLinkSelector
            : undefined;

        const scrapingPlan: ScrapingPlan = {
            planId,
            version: 1,
            entryUrls: [url],
            listSelector: listSelector || "article, .item, .post, .entry",
            contentLinkSelector: contentLinkSelector,
            detailSelectors: {
                title: detailSelectors.title || "h1, h2, .title, .headline",
                description:
                    detailSelectors.description ||
                    "p, .description, .content, .summary",
                ...detailSelectors
            },
            richContentFields: contentAnalysis.richContentFields || [],
            paginationSelector: paginationSelector || undefined,
            rateLimitMs: options.rateLimitMs || 1000,
            retryPolicy: {
                maxAttempts: 3,
                backoffStrategy: "exponential" as const,
                baseDelayMs: 1000,
                maxDelayMs: 10000,
                retryableErrors: ["TIMEOUT", "NETWORK_ERROR", "RATE_LIMIT"]
            },
            confidenceScore: Math.max(
                contentAnalysis.confidence || 0,
                siblingResults.length > 0
                    ? Math.max(...siblingResults.map((r: any) => r.confidence))
                    : 0
            ),
            metadata: {
                domain: new URL(url).hostname,
                siteType: "municipal" as const,
                language: "de",
                createdBy: "ai" as const,
                successRate: 0,
                avgAccuracy: 0,
                robotsTxtCompliant: true,
                gdprCompliant: true,
                cookieConsent: cookieConsentMetadata
                    ? {
                          detected: cookieConsentMetadata.detected || false,
                          strategy: cookieConsentMetadata.strategy || "none",
                          library: cookieConsentMetadata.library || "unknown",
                          selectors: cookieConsentMetadata.selectors || {},
                          acceptButtonSelector:
                              cookieConsentMetadata.acceptButtonSelector,
                          rejectButtonSelector:
                              cookieConsentMetadata.rejectButtonSelector,
                          settingsButtonSelector:
                              cookieConsentMetadata.settingsButtonSelector,
                          bannerSelector: cookieConsentMetadata.bannerSelector,
                          modalSelector: cookieConsentMetadata.modalSelector,
                          handledSuccessfully:
                              cookieConsentMetadata.handledSuccessfully || false
                      }
                    : undefined
            }
        };

        logger.info("🏗️ Created scraping plan from workflow analysis:", {
            planId: scrapingPlan.planId,
            entryUrls: scrapingPlan.entryUrls.length,
            listSelector: scrapingPlan.listSelector,
            hasPagination: !!scrapingPlan.paginationSelector,
            detailSelectors: Object.keys(scrapingPlan.detailSelectors),
            confidence: scrapingPlan.confidenceScore,
            rateLimitMs: scrapingPlan.rateLimitMs
        });

        return scrapingPlan;
    }
}

export default PlanFactoryService;
