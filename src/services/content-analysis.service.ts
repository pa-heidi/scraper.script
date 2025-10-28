import { PlaywrightExecutor } from "./playwright-executor.service";
import { logger } from "../utils/logger";

export class ContentAnalysisService {
    private playwrightExecutor: PlaywrightExecutor;

    constructor(playwrightExecutor: PlaywrightExecutor) {
        this.playwrightExecutor = playwrightExecutor;
    }

    public async analyzeContentUrlsWithHtml(
        contentUrls: string[],
        mainPageHtml: string
    ): Promise<any> {
        try {
            logger.info(
                `Analyzing ${contentUrls.length} content URLs with fetching and pattern analysis`
            );

            if (!contentUrls || contentUrls.length === 0) {
                return { patterns: [], confidence: 0, analysis: null };
            }

            const batchSize = 5;
            const maxUrlsToAnalyze = 10;
            const urlsToAnalyze = contentUrls.slice(0, maxUrlsToAnalyze);

            const contentPagesData: Array<{
                url: string;
                html: string;
                trimmedHtml: string;
                success: boolean;
            }> = [];

            for (let i = 0; i < urlsToAnalyze.length; i += batchSize) {
                const batch = urlsToAnalyze.slice(i, i + batchSize);

                const batchResults = await Promise.allSettled(
                    batch.map(async (url) => {
                        try {
                            logger.debug(`Fetching content URL: ${url}`);
                            const { html } = await this.fetchHtmlContent(url);

                            const trimmedHtml = this.trimHtmlToMainContent(html);

                            return {
                                url,
                                html,
                                trimmedHtml,
                                success: true
                            };
                        } catch (error) {
                            logger.warn(`Failed to fetch ${url}:`, error);
                            return {
                                url,
                                html: "",
                                trimmedHtml: "",
                                success: false
                            };
                        }
                    })
                );

                for (const result of batchResults) {
                    if (result.status === "fulfilled" && result.value.success) {
                        contentPagesData.push(result.value);
                    }
                }
            }

            logger.info(
                `Successfully fetched ${contentPagesData.length}/${urlsToAnalyze.length} content URLs`
            );

            if (contentPagesData.length === 0) {
                return {
                    patterns: [],
                    confidence: 0,
                    analysis: null,
                    totalUrls: contentUrls.length,
                    successfulFetches: 0
                };
            }

            const contentAnalysis = await this.analyzeContentPagesWithLLM(
                contentPagesData,
                contentUrls
            );

            logger.info(`Content analysis completed using LLM`, {
                totalUrls: contentUrls.length,
                analyzed: contentPagesData.length,
                detailSelectors: Object.keys(
                    contentAnalysis.detailSelectors || {}
                ).length,
                confidence: contentAnalysis.confidence
            });

            return contentAnalysis;
        } catch (error) {
            logger.error("Content URL analysis failed:", error);
            return {
                patterns: [],
                confidence: 0,
                analysis: null,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    private trimHtmlToMainContent(html: string): string {
        let trimmed = html
            .replace(/<!--[\s\S]*?-->/g, "")
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
            .replace(/\s+/g, " ")
            .trim();

        const contentPatterns = [
            /<main[\s\S]*?<\/main>/gi,
            /<article[\s\S]*?<\/article>/gi,
            /<section[\s\S]*?<\/section>/gi,
            /<div[^>]*class[^>]*(?:content|main|article|post|entry)[^>]*>[\s\S]*?<\/div>/gi
        ];

        let mainContent = "";
        for (const pattern of contentPatterns) {
            const matches = trimmed.match(pattern);
            if (matches && matches.length > 0) {
                mainContent += matches.join("\n");
            }
        }

        if (!mainContent) {
            mainContent = trimmed
                .replace(/<header[\s\S]*?<\/header>/gi, "")
                .replace(/<footer[\s\S]*?<\/footer>/gi, "")
                .replace(/<nav[\s\S]*?<\/nav>/gi, "")
                .replace(/<aside[\s\S]*?<\/aside>/gi, "");
        }

        const maxLength = 20000;
        if (mainContent.length > maxLength) {
            mainContent = mainContent.substring(0, maxLength) + "...";
        }

        return mainContent;
    }

    private async analyzeContentPagesWithLLM(
        contentPagesData: Array<{
            url: string;
            html: string;
            trimmedHtml: string;
            success: boolean;
        }>,
        contentUrls: string[]
    ): Promise<any> {
        try {
            logger.info(
                `🔍 Analyzing ${contentPagesData.length} content pages with LLM to extract selectors`
            );

            logger.debug("📄 Content pages for LLM analysis:", {
                totalPages: contentPagesData.length,
                successfulPages: contentPagesData.filter((p) => p.success)
                    .length,
                urls: contentPagesData.map((p) => p.url),
                htmlSizes: contentPagesData.map((p) => ({
                    url: p.url,
                    originalSize: p.html.length,
                    trimmedSize: p.trimmedHtml.length
                }))
            });

            if (contentPagesData.length === 0) {
                logger.warn("⚠️ No content pages available for LLM analysis");
                return {
                    detailSelectors: {},
                    confidence: 0,
                    totalUrls: contentUrls.length,
                    analyzedUrls: 0
                };
            }

            const pagesToAnalyze = contentPagesData.slice(0, 3);
            logger.info(
                `📋 Using ${pagesToAnalyze.length} pages for LLM analysis (limited for performance)`
            );
            const combinedHtml = pagesToAnalyze
                .map((page) => `<!-- URL: ${page.url} -->\n${page.trimmedHtml}`)
                .join("\n\n<!-- PAGE SEPARATOR -->\n\n");

            logger.debug("🔗 Combined HTML for LLM analysis:", {
                combinedSize: combinedHtml.length,
                pageCount: pagesToAnalyze.length
            });

            const compressedHtml = this.compressHtmlForLLM(combinedHtml);

            logger.debug("📦 HTML compression results:", {
                originalSize: combinedHtml.length,
                compressedSize: compressedHtml.length,
                compressionRatio:
                    Math.round(
                        (1 - compressedHtml.length / combinedHtml.length) * 100
                    ) + "%"
            });

            const prompt = this.buildContentSelectorPrompt(
                pagesToAnalyze.map((p) => p.url),
                compressedHtml
            );

            const { getCentralizedLLMService } = await import(
                "./centralized-llm.service"
            );
            const llmService = getCentralizedLLMService();

            const llmRequest = {
                prompt,
                systemMessage:
                    "You are an expert web scraping engineer. Analyze HTML content to identify CSS selectors for extracting structured data. Respond with valid JSON only.",
                format: "json" as const,
                temperature: 0.1,
                maxTokens: 2000,
                service: 'content-analysis',
                method: 'analyzeContentSelectors',
                context: {
                    url: contentUrls[0],
                    step: 'content-selector-analysis'
                }
            };

            logger.info("Starting LLM content selector analysis...");
            const llmResponse = await llmService.generate(llmRequest);

            logger.info("LLM content selector analysis completed", {
                provider: llmResponse.provider,
                model: llmResponse.model,
                tokensUsed: llmResponse.tokensUsed,
                responseLength: llmResponse.content.length
            });

            logger.debug("🧠 Raw LLM selector response:", {
                content: llmResponse.content,
                provider: llmResponse.provider,
                model: llmResponse.model
            });

            const selectorAnalysis = this.parseLLMContentResponse(
                llmResponse.content
            );

            logger.info("🎯 LLM Selector Analysis Results:", {
                detailSelectorsCount: Object.keys(
                    selectorAnalysis.detailSelectors
                ).length,
                detailSelectors: selectorAnalysis.detailSelectors,
                confidence: selectorAnalysis.confidence,
                reasoning: selectorAnalysis.reasoning
            });

            return {
                detailSelectors: selectorAnalysis.detailSelectors,
                richContentFields: selectorAnalysis.richContentFields,
                confidence: selectorAnalysis.confidence,
                totalUrls: contentUrls.length,
                analyzedUrls: contentPagesData.length,
                llmAnalysis: true,
                reasoning: selectorAnalysis.reasoning
            };
        } catch (error) {
            logger.error("LLM content analysis failed:", error);
            return {
                detailSelectors: {},
                richContentFields: [],
                confidence: 0,
                totalUrls: contentUrls.length,
                analyzedUrls: 0,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    private buildContentSelectorPrompt(urls: string[], html: string): string {
        return `
Analyze these content pages to identify CSS selectors for extracting structured data fields.

Content URLs analyzed:
${urls.map((url, i) => `${i + 1}. ${url}`).join("\n")}

HTML Content:
${html}

Extract CSS selectors for common content fields that appear across these pages. Focus on:
- Title/Headline selectors (text content)
- Description/Content selectors (RICH HTML content for WYSIWYG display)
- Date/Time selectors (text content)
- Location/Address selectors (text content)
- Contact information (email, phone) selectors (text content)
- Image selectors (src attributes)
- Link/URL selectors (href attributes)
- Any other structured data fields

IMPORTANT FOR RICH CONTENT:
- For "description" field: Select the CONTAINER element that holds the full rich content (HTML with formatting, links, images, etc.)
- For "descriptionText": Select for plain text extraction (fallback)
- Rich content should preserve HTML formatting for WYSIWYG editors
- Description containers should include paragraphs, lists, links, embedded images, etc.

Respond with JSON:
{
  "detailSelectors": {
    "title": "CSS selector for titles/headlines (text)",
    "description": "CSS selector for RICH HTML content container (innerHTML)",
    "descriptionText": "CSS selector for plain text description (textContent fallback)",
    "startDate": "CSS selector for dates/times (text)",
    "place": "CSS selector for location/venue (text)",
    "address": "CSS selector for addresses (text)",
    "email": "CSS selector for email addresses (text)",
    "phone": "CSS selector for phone numbers (text)",
    "website": "CSS selector for website links (href)",
    "images": "CSS selector for images (src)"
  },
  "richContentFields": ["description"],
  "confidence": 0.85,
  "reasoning": "Explanation of selector choices, especially for rich content containers"
}

IMPORTANT:
- Only include selectors that work across multiple pages
- Prefer specific selectors over generic ones (e.g., ".event-title" over "h1")
- Test selectors mentally against the provided HTML
- Skip fields that don't have consistent selectors across pages
- Ensure selectors are valid CSS syntax
`;
    }

    private parseLLMContentResponse(content: string): {
        detailSelectors: Record<string, string>;
        richContentFields: string[];
        confidence: number;
        reasoning: string;
    } {
        try {
            const parsed = JSON.parse(content);

            logger.debug("📋 Parsed LLM JSON response:", {
                hasDetailSelectors: !!parsed.detailSelectors,
                confidence: parsed.confidence,
                reasoning: parsed.reasoning?.substring(0, 100) + "..."
            });

            const detailSelectors: Record<string, string> = {};

            if (
                parsed.detailSelectors &&
                typeof parsed.detailSelectors === "object"
            ) {
                logger.debug("🔍 Processing detail selectors from LLM...");

                for (const [field, selector] of Object.entries(
                    parsed.detailSelectors
                )) {
                    if (typeof selector === "string" && selector.trim()) {
                        detailSelectors[field] = selector.trim();
                        logger.debug(`  ✅ ${field}: "${selector.trim()}"`);
                    } else {
                        logger.debug(
                            `  ❌ ${field}: invalid selector (${typeof selector})`
                        );
                    }
                }
            } else {
                logger.warn(
                    "⚠️ No valid detailSelectors found in LLM response"
                );
            }

            const richContentFields: string[] = [];
            if (Array.isArray(parsed.richContentFields)) {
                richContentFields.push(...parsed.richContentFields.filter((field: any) =>
                    typeof field === "string" && detailSelectors[field]
                ));
                logger.debug(`🎨 Rich content fields identified: ${richContentFields.join(", ")}`);
            } else {
                if (detailSelectors.description) {
                    richContentFields.push("description");
                    logger.debug("🎨 Defaulting 'description' as rich content field");
                }
            }

            const result = {
                detailSelectors,
                richContentFields,
                confidence: parsed.confidence || 0.5,
                reasoning: parsed.reasoning || "LLM content analysis completed"
            };

            logger.info("📊 Final selector extraction results:", {
                totalSelectors: Object.keys(detailSelectors).length,
                selectorFields: Object.keys(detailSelectors),
                richContentFields: richContentFields,
                confidence: result.confidence
            });

            return result;
        } catch (error) {
            logger.warn("Failed to parse LLM content response", { error });
            return {
                detailSelectors: {},
                richContentFields: [],
                confidence: 0.3,
                reasoning: "Failed to parse LLM response"
            };
        }
    }

    private compressHtmlForLLM(html: string): string {
        let compressed = html
            .replace(/<!--[\s\S]*?-->/g, "")
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
            .replace(/\s+/g, " ")
            .replace(/>\s+</g, "><")
            .trim();

        const maxLength = 12000;
        if (compressed.length > maxLength) {
            compressed = compressed.substring(0, maxLength) + "...";
        }

        return compressed;
    }

    private async fetchHtmlContent(
        url: string
    ): Promise<{ html: string; cookieConsentMetadata?: any }> {
        const browser = await (this.playwrightExecutor as any).acquireBrowser();
        const context = await browser.newContext({
            userAgent:
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            viewport: { width: 1920, height: 1080 }
        });
        const page = await context.newPage();

        try {
            let retryCount = 0;
            const maxRetries = 2;
            let lastError: Error | null = null;

            while (retryCount < maxRetries) {
                try {
                    await page.goto(url, {
                        waitUntil: "domcontentloaded",
                        timeout: 30000
                    });
                    break;
                } catch (error) {
                    lastError = error as Error;
                    retryCount++;
                    if (retryCount < maxRetries) {
                        logger.warn(
                            `⚠️  HTML fetch attempt ${retryCount} failed for ${url}, retrying... Error: ${lastError.message}`
                        );
                        await new Promise((resolve) => setTimeout(resolve, 1000));
                    } else {
                        throw lastError;
                    }
                }
            }

            try {
                const { CookieConsentHandler } = await import(
                    "./cookie-consent-handler.service"
                );
                const cookieHandler = new CookieConsentHandler();
                const cookieResult = await cookieHandler.handleCookieConsent(page, url, {
                    strategy: "accept-all",
                    timeout: 5000,
                    languages: ["de", "en"]
                });
                logger.debug(`Cookie consent handled for ${url}`, {
                    detected: cookieResult.metadata?.detected,
                    strategy: cookieResult.metadata?.strategy,
                    library: cookieResult.metadata?.library
                });
            } catch (error) {
                logger.warn(
                    `Could not handle cookie consent for ${url}, continuing anyway:`,
                    error
                );
            }

            await page.waitForTimeout(2000);
            const html = await page.content();
            logger.debug(`Successfully fetched HTML content for ${url}`, {
                contentLength: html.length,
                title: await page.title()
            });

            return { html };
        } finally {
            await page.close();
            await context.close();
            (this.playwrightExecutor as any).releaseBrowser(browser);
        }
    }
}

export default ContentAnalysisService;
