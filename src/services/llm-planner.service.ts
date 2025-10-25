/**
 * LLM Planner Service
 * Implements AI-driven scraping plan generation using OpenAI GPT-5 with LLaMA fallback
 * Requirements: 1.1, 1.2, 1.5, 8.1, 8.2
 */

import {
    ScrapingPlan,
    PlanOptions,
    PlanGenerationResult,
    TestExecutionResult,
    PlanMetadata
} from "../interfaces/core";
import {
    SiteAnalysisService,
    SiteAnalysisResult
} from "./site-analysis.service";
import { getCentralizedLLMService, LLMRequest } from './centralized-llm.service';
import { PlaywrightExecutor } from './playwright-executor.service';
import { logger } from "../utils/logger";

// Add fetch for Node.js environments that don't have it globally
import fetch from "node-fetch";

export interface SiteAnalysis {
    url: string;
    compressedHtml: string;
    detectedPatterns: string[];
    archetype?: "wordpress" | "typo3" | "drupal" | "generic";
    complexity: "low" | "medium" | "high";
    estimatedTokens: number;
}

export interface LLMResponse {
    plan: Partial<ScrapingPlan>;
    confidence: number;
    reasoning: string;
    humanReadableDoc: string;
}

export interface ConfidenceFactors {
    selectorSpecificity: number;
    structureClarity: number;
    patternConsistency: number;
    responseCompleteness: number;
}

export class LLMPlannerService {
    private siteAnalysisService: SiteAnalysisService;
    private llmService = getCentralizedLLMService();

    private readonly maxTokensGPT4 = 8000; // Increased for GPT-4 models
    private readonly confidenceThreshold = 0.7;

    constructor(playwrightExecutor?: PlaywrightExecutor) {
        this.siteAnalysisService = new SiteAnalysisService(playwrightExecutor);

        // Configure LLM service for planning tasks
        this.llmService.updateConfig({
            primaryProvider: process.env.LLM_PRIMARY_PROVIDER as 'openai' | 'ollama' || 'openai',
            fallbackProvider: process.env.LLM_FALLBACK_PROVIDER as 'openai' | 'ollama' || 'ollama',
            openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
            ollamaModel: process.env.OLLAMA_MODEL || 'llama3.2:1b',
            maxTokens: 8000,
            temperature: 0.1,
        });
    }

    /**
     * Analyze website HTML and compress it for LLM processing
     * Implements requirement 8.1 - HTML compression for token reduction
     */
    async analyzeSite(url: string, html: string): Promise<SiteAnalysis> {
        logger.info(`Analyzing site: ${url}`);

        // Compress HTML by removing unnecessary content
        const compressedHtml = this.compressHtml(html, "main");

        // Detect common patterns and archetypes
        const detectedPatterns = this.detectPatterns(html);
        const archetype = this.detectArchetype(html);

        // Estimate complexity and token usage
        const complexity = this.estimateComplexity(
            compressedHtml,
            detectedPatterns
        );
        const estimatedTokens = Math.ceil(compressedHtml.length / 4); // Rough token estimation

        return {
            url,
            compressedHtml,
            detectedPatterns,
            archetype,
            complexity,
            estimatedTokens
        };
    }

    /**
     * Generate enhanced scraping plan using content URLs and site analysis with cost optimization
     * Implements requirements 1.1, 1.2, 1.3, 1.4, 1.6, 9.1, 9.2, 9.3, 9.4, 9.5 - Enhanced AI-driven plan generation with cost optimization
     */
    async generateEnhancedPlan(
        url: string,
        html: string,
        contentUrls?: string[],
        options: PlanOptions = {}
    ): Promise<PlanGenerationResult> {
        logger.info(
            `Generating enhanced plan for ${url} with ${contentUrls?.length || 0} content URLs`
        );

        // Step 1: Compress HTML for processing
        const compressedHtml = await this.compressHtml(html);

        logger.info("HTML compression completed", {
            originalSize: html.length,
            compressedSize: compressedHtml.length,
            compressionRatio: (1 - compressedHtml.length / html.length).toFixed(
                2
            )
        });

        // Step 2: Analyze site with compressed HTML
        const siteAnalysis = await this.siteAnalysisService.analyzeSite(
            url,
            compressedHtml,
            contentUrls
        );

        // Step 3: Two-phase analysis - Main page first, then content page
        let plan: ScrapingPlan;
        let detailSelectors: Record<string, string> = {};
        let cookieConsentSaveButton: string | undefined;

        // Phase 1: Analyze main page for list, pagination, and cookie consent selectors
        logger.info(
            "Phase 1: Analyzing main page for list and pagination selectors"
        );

        // Generate main page plan using LLM
        const analysis: SiteAnalysis = {
            url: siteAnalysis.url,
            compressedHtml: compressedHtml,
            detectedPatterns: siteAnalysis.patterns.map((p) => p.type),
            archetype: siteAnalysis.archetype,
            complexity: this.estimateComplexity(
                compressedHtml,
                siteAnalysis.patterns.map((p) => p.type)
            ),
            estimatedTokens: Math.ceil(compressedHtml.length / 4) // Rough estimate
        };

        const planResult = await this.generatePlan(analysis, options);
        plan = planResult.plan;

        // Extract cookie consent save button from main page analysis
        if (plan.metadata.aiResponse?.response) {
            try {
                const response = JSON.parse(plan.metadata.aiResponse.response);
                cookieConsentSaveButton =
                    response.cookieConsent?.saveButtonSelector;
            } catch (error) {
                logger.warn(
                    "Failed to parse cookie consent from main page analysis",
                    { error }
                );
            }
        }

        // Also check for cookie consent selector from LLaMA response
        if (
            !cookieConsentSaveButton &&
            (plan.metadata.aiResponse as any)?.cookieConsentSelector
        ) {
            cookieConsentSaveButton = (plan.metadata.aiResponse as any)
                .cookieConsentSelector;
        }

        // Phase 2: Analyze content page for detail selectors (if content URLs provided)
        let contentPageAiResponse: any = undefined;
        if (contentUrls && contentUrls.length > 0) {
            logger.info(
                `Phase 2: Analyzing content page for detail selectors: ${contentUrls[0]}`
            );

            try {
                // For now, we'll use the first content URL as a sample
                // In a full implementation, you might want to analyze multiple content pages
                const contentPageResult = await this.analyzeContentPage(
                    contentUrls[0],
                    html
                );
                detailSelectors = contentPageResult.detailSelectors;
                contentPageAiResponse = contentPageResult.aiResponse;

                logger.info("Content page analysis completed", {
                    contentUrl: contentUrls[0],
                    selectorsFound: Object.keys(detailSelectors).length,
                    confidence: contentPageResult.confidence
                });
            } catch (error) {
                const errorMessage =
                    error instanceof Error ? error.message : String(error);
                logger.error("Content page analysis failed", {
                    error: errorMessage
                });
                // Continue with empty detail selectors
            }
        }

        // Merge detail selectors into the main plan
        if (Object.keys(detailSelectors).length > 0) {
            plan.detailSelectors = detailSelectors;
        }

        // Add cookie consent save button to metadata
        if (cookieConsentSaveButton) {
            plan.metadata.cookieConsentSaveButton = cookieConsentSaveButton;
        }

        // Add content page AI response to metadata for debugging
        if (contentPageAiResponse) {
            (plan.metadata as any).contentPageAiResponse =
                contentPageAiResponse;
        }

        // Step 4: Validate plan accuracy
        let validationResult: {
            isValid: boolean;
            confidence: number;
            issues: string[];
        } = {
            isValid: true,
            confidence: siteAnalysis.confidence,
            issues: []
        };

        if (contentUrls && contentUrls.length > 0) {
            validationResult =
                await this.siteAnalysisService.validatePlanWithContentExamples(
                    plan,
                    contentUrls
                );
        }

        // Step 5: Generate human-readable documentation
        const humanReadableDoc = this.generateHumanReadableDoc(
            plan,
            siteAnalysis,
            contentUrls
        );

        // Step 6: Create test results with actual validation
        const testResults: TestExecutionResult = await this.generateTestResults(
            plan,
            siteAnalysis,
            validationResult,
            contentUrls
        );

        // Step 7: Log completion
        logger.info("Plan generation completed successfully", {
            planId: plan.planId,
            success: testResults.success,
            confidence: validationResult.confidence
        });

        return {
            planId: plan.planId,
            plan,
            confidence: validationResult.confidence,
            humanReadableDoc,
            testResults
        };
    }

    /**
     * Generate scraping plan using LLM analysis (legacy method)
     * Implements requirements 1.1, 1.2 - AI-driven plan generation
     */
    async generatePlan(
        analysis: SiteAnalysis,
        options: PlanOptions = {}
    ): Promise<PlanGenerationResult> {
        logger.info(
            `Generating plan for ${analysis.url} with ${analysis.archetype} archetype`
        );

        const planId = this.generatePlanId(analysis.url);
        let llmResponse: LLMResponse;
        let aiResponseData:
            | {
                  model: string;
                  prompt: string;
                  response: string;
                  tokensUsed: number;
              }
            | undefined;

        try {
            // Try GPT-5 first, fallback to local LLaMA if needed
            if (options.useLocalModel) {
                const result = await this.generateWithLLaMAWithResponse(
                    analysis,
                    options
                );
                llmResponse = result.response;
                aiResponseData = result.aiData;
            } else {
                const result = await this.generateWithGPT5WithResponse(
                    analysis,
                    options
                );
                llmResponse = result.response;
                aiResponseData = result.aiData;
            }
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : String(error);

            // Check if it's a token limit error and suggest solutions
            if (
                errorMessage.includes("max_tokens is too large") ||
                errorMessage.includes("token")
            ) {
                logger.warn(
                    `Token limit exceeded with GPT model, falling back to local LLaMA. Consider using GPT-4 models with larger context windows. Error: ${errorMessage}`
                );
            } else {
                logger.warn(
                    `Primary model failed, falling back to local LLaMA: ${errorMessage}`
                );
            }

            const result = await this.generateWithLLaMAWithResponse(
                analysis,
                options
            );
            llmResponse = result.response;
            aiResponseData = result.aiData;
        }
        logger.info("LLM response generated", {
            confidence: llmResponse.confidence
        });
        logger.info("LLM response generated", { plan: llmResponse.plan });
        logger.info("LLM response generated", {
            reasoning: llmResponse.reasoning
        });
        logger.info("LLM response generated", {
            humanReadableDoc: llmResponse.humanReadableDoc
        });

        // Build complete scraping plan
        const plan = this.buildScrapingPlan(
            planId,
            analysis,
            llmResponse,
            aiResponseData,
            options.cookieConsentData
        );

        // Calculate final confidence score
        const confidence = this.calculateConfidenceScore(llmResponse, analysis);

        // Generate test results using actual selector testing
        const mockSiteAnalysis: SiteAnalysisResult = {
            url: analysis.url,
            archetype: analysis.archetype || "generic",
            patterns: analysis.detectedPatterns.map((pattern) => ({
                type: this.mapPatternType(pattern),
                selector: "",
                confidence: 0.8,
                elements: [],
                description: `Pattern: ${pattern}`,
                examples: []
            })),
            listContainers: [],
            contentAreas: [],
            paginationInfo: { detected: false, confidence: 0 },
            confidence: confidence
        };

        const testResults: TestExecutionResult = await this.generateTestResults(
            plan,
            mockSiteAnalysis,
            {
                isValid: confidence > this.confidenceThreshold,
                confidence,
                issues: []
            }
        );

        return {
            planId,
            plan,
            confidence,
            humanReadableDoc: llmResponse.humanReadableDoc,
            testResults
        };
    }

    /**
     * Compress HTML content for efficient LLM processing
     * Implements requirement 8.1 - HTML compression to reduce token usage
     * Enhanced to remove headers/footers while maintaining context
     */
    private compressHtml(
        html: string,
        pageType: "main" | "content" = "main"
    ): string {
        // Use the improved compression method from sibling link discovery
        return this.compressHtmlForLLM(html, pageType === "content");
    }

    /**
     * Compress HTML for LLM analysis (improved version)
     * Removes scripts, styles, comments and focuses on content areas
     */
    private compressHtmlForLLM(html: string, focused: boolean = false): string {
        // Step 1: Remove scripts, styles, comments, and other non-content elements
        let compressed = html
            .replace(/<!--[\s\S]*?-->/g, '') // Remove comments
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove scripts
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '') // Remove styles
            .replace(/<link[^>]*>/gi, '') // Remove link tags
            .replace(/<meta[^>]*>/gi, '') // Remove meta tags
            .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '') // Remove noscript
            .replace(/\s+/g, ' ') // Normalize whitespace
            .replace(/>\s+</g, '><') // Remove whitespace between tags
            .trim();

        // Step 2: Focus on main content areas and remove headers/footers
        const contentPatterns = [
            /<main[\s\S]*?<\/main>/gi,
            /<article[\s\S]*?<\/article>/gi,
            /<section[\s\S]*?<\/section>/gi,
            /<div[^>]*class[^>]*(?:content|main|list|items|news|articles|posts|teaser|container)[^>]*>[\s\S]*?<\/div>/gi,
        ];

        let mainContent = '';
        for (const pattern of contentPatterns) {
            const matches = compressed.match(pattern);
            if (matches && matches.length > 0) {
                mainContent += matches.join('\n');
            }
        }

        // Step 3: If no main content found, remove headers/footers from full HTML
        if (!mainContent) {
            mainContent = compressed
                .replace(/<header[\s\S]*?<\/header>/gi, '') // Remove headers
                .replace(/<footer[\s\S]*?<\/footer>/gi, '') // Remove footers
                .replace(/<nav[\s\S]*?<\/nav>/gi, '') // Remove navigation (unless it's main nav)
                .replace(/<aside[\s\S]*?<\/aside>/gi, ''); // Remove sidebars
        }

        // Step 4: Limit size for token efficiency
        const maxLength = focused ? 8000 : 15000; // Smaller limit for focused analysis
        if (mainContent.length > maxLength) {
            mainContent = mainContent.substring(0, maxLength) + '...';
        }

        return mainContent;
    }









    /**
     * Generate structural summary focusing on content patterns
     */
    private generateStructuralSummary(html: string): string {
        const contentTags = [
            "main",
            "article",
            "section",
            "div",
            "ul",
            "ol",
            "li",
            "dl",
            "dt",
            "dd",
            "table",
            "tr",
            "td",
            "th",
            "thead",
            "tbody",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "p",
            "a",
            "span",
            "strong",
            "em",
            "img",
            "figure",
            "figcaption",
            "time",
            "address"
        ];

        // Extract elements with their attributes and text content
        const elements: Array<{
            tag: string;
            attributes: string;
            content: string;
            hasContent: boolean;
        }> = [];
        for (const tag of contentTags) {
            const pattern = new RegExp(
                `<${tag}([^>]*)>([\\s\\S]*?)<\\/${tag}>`,
                "gi"
            );
            let match;
            while (
                (match = pattern.exec(html)) !== null &&
                elements.length < 100
            ) {
                const attributes = match[1];
                const content = match[2].replace(/<[^>]*>/g, "").trim();

                if (
                    content.length > 0 ||
                    attributes.includes("class=") ||
                    attributes.includes("id=")
                ) {
                    elements.push({
                        tag,
                        attributes: attributes.trim(),
                        content: content.substring(0, 200), // Limit content length
                        hasContent: content.length > 0
                    });
                }
            }
        }

        // Generate summary
        let summary = "MAIN CONTENT STRUCTURE:\n";

        if (elements.length === 0) {
            // Fallback: if no elements found, try to extract any meaningful content
            const fallbackPatterns = [
                /<[^>]+class[^>]*>/gi,
                /<[^>]+id[^>]*>/gi,
                /<[a-zA-Z]+[^>]*>/gi
            ];

            for (const pattern of fallbackPatterns) {
                const matches = html.match(pattern);
                if (matches && matches.length > 0) {
                    summary += `Found ${matches.length} HTML elements with attributes\n`;
                    summary += `Sample elements: ${matches.slice(0, 5).join(", ")}\n`;
                    break;
                }
            }

            if (summary === "MAIN CONTENT STRUCTURE:\n") {
                summary +=
                    "No structured content elements found. Raw HTML available for analysis.\n";
                // Add a sample of the raw HTML for debugging
                summary += `Raw HTML sample: ${html.substring(0, 500)}...\n`;
            }
        } else {
            elements.forEach((el, index) => {
                if (index < 50) {
                    // Limit number of elements
                    summary += `<${el.tag}${el.attributes ? " " + el.attributes : ""}>`;
                    if (el.hasContent && el.content.length > 10) {
                        summary += `${el.content.substring(0, 100)}...`;
                    }
                    summary += `</${el.tag}>\n`;
                }
            });
        }

        return summary;
    }

    /**
     * Extract layout context without full content
     */
    private extractLayoutContext(html: string): string {
        let context = "LAYOUT CONTEXT:\n";

        // Extract page structure indicators
        const structureIndicators = [
            { pattern: /<header[^>]*>/gi, label: "Header" },
            { pattern: /<nav[^>]*>/gi, label: "Navigation" },
            { pattern: /<main[^>]*>/gi, label: "Main Content" },
            { pattern: /<aside[^>]*>/gi, label: "Sidebar" },
            { pattern: /<footer[^>]*>/gi, label: "Footer" },
            {
                pattern:
                    /<div[^>]*class[^>]*(?:container|wrapper|layout)[^>]*>/gi,
                label: "Container"
            }
        ];

        structureIndicators.forEach((indicator) => {
            const matches = html.match(indicator.pattern);
            if (matches) {
                context += `${indicator.label}: ${matches.length} found\n`;
                // Add first match as example
                if (matches[0]) {
                    context += `  Example: ${matches[0]}\n`;
                }
            }
        });

        // Extract pagination indicators
        const paginationPatterns = [
            /class[^>]*(?:pagination|pager|page-nav)/gi,
            /(?:next|previous|prev|page-\d+)/gi
        ];

        paginationPatterns.forEach((pattern) => {
            const matches = html.match(pattern);
            if (matches && matches.length > 0) {
                context += `Pagination indicators found: ${matches.slice(0, 3).join(", ")}\n`;
            }
        });

        return context;
    }

    /**
     * Combine content and context for optimal LLM understanding
     */
    private combineContentAndContext(
        structuralSummary: string,
        layoutContext: string
    ): string {
        return `${layoutContext}\n\n${structuralSummary}\n\nINSTRUCTIONS: Focus on the MAIN CONTENT STRUCTURE for scraping. Use LAYOUT CONTEXT to understand page organization but target selectors within the main content area.`;
    }

    /**
     * Extract structural information from HTML
     */
    private extractStructuralInfo(
        html: string,
        importantTags: string[]
    ): string {
        const tagPattern = new RegExp(
            `<(${importantTags.join("|")})[^>]*>.*?</\\1>`,
            "gi"
        );
        const matches = html.match(tagPattern) || [];

        // Summarize structure
        const structure = matches.slice(0, 50).join("\n"); // Limit to first 50 matches

        return `HTML Structure Summary:\n${structure}`;
    }

    /**
     * Detect common patterns in HTML structure
     */
    private detectPatterns(html: string): string[] {
        const patterns: string[] = [];

        // List patterns
        if (html.includes("<ul") || html.includes("<ol")) {
            patterns.push("list-structure");
        }

        // Table patterns
        if (html.includes("<table")) {
            patterns.push("table-structure");
        }

        // Card/article patterns
        if (html.match(/<(div|article)[^>]*class[^>]*card/i)) {
            patterns.push("card-layout");
        }

        // Pagination patterns
        if (html.match(/pagination|next|previous|page-\d+/i)) {
            patterns.push("pagination");
        }

        // Date patterns
        if (html.match(/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2}/)) {
            patterns.push("date-content");
        }

        return patterns;
    }

    /**
     * Detect CMS archetype for template reuse
     * Implements requirement 8.3 - archetype detection for optimization
     */
    private detectArchetype(
        html: string
    ): "wordpress" | "typo3" | "drupal" | "generic" {
        if (html.includes("wp-content") || html.includes("wordpress")) {
            return "wordpress";
        }
        if (html.includes("typo3") || html.includes("t3-")) {
            return "typo3";
        }
        if (html.includes("drupal") || html.includes("sites/default")) {
            return "drupal";
        }
        return "generic";
    }

    /**
     * Estimate site complexity for model selection
     */
    private estimateComplexity(
        html: string,
        patterns: string[]
    ): "low" | "medium" | "high" {
        const complexityScore = patterns.length + html.length / 500; // More sensitive to length

        if (complexityScore < 8) return "low";
        if (complexityScore < 20) return "medium";
        return "high";
    }

    /**
     * Generate plan using centralized LLM service
     * Implements requirement 1.5 - GPT integration with proper model support
     */
    private async generateWithGPT5(
        analysis: SiteAnalysis,
        options: PlanOptions
    ): Promise<LLMResponse> {
        const prompt = this.buildPrompt(analysis, "gpt-5");

        const llmRequest: LLMRequest = {
            prompt,
            systemMessage: "You are an expert web scraping engineer. Generate precise CSS selectors and scraping plans. Always respond with valid JSON format.",
            format: 'json',
            temperature: 0.1,
            maxTokens: options.maxTokens || this.maxTokensGPT4,
        };

        logger.info("Making centralized LLM request for plan generation");

        const llmResponse = await this.llmService.generate(llmRequest);

        logger.info("LLM plan generation response received", {
            provider: llmResponse.provider,
            model: llmResponse.model,
            tokensUsed: llmResponse.tokensUsed,
            responseLength: llmResponse.content.length,
        });

        const parsed = this.parseGPTResponse(llmResponse.content);

        // Log the parsed plan
        logger.info("Parsed AI plan", {
            listSelector: parsed.plan.listSelector,
            detailSelectorsCount: Object.keys(parsed.plan.detailSelectors || {})
                .length,
            paginationSelector: parsed.plan.paginationSelector,
            confidence: parsed.confidence
        });

        return parsed;
    }

    /**
     * Generate plan using centralized LLM service with response data capture
     */
    private async generateWithGPT5WithResponse(
        analysis: SiteAnalysis,
        options: PlanOptions
    ): Promise<{
        response: LLMResponse;
        aiData: {
            model: string;
            prompt: string;
            response: string;
            tokensUsed: number;
        };
    }> {
        const prompt = this.buildPrompt(analysis, "gpt-5", "main-page");

        const llmRequest: LLMRequest = {
            prompt,
            systemMessage: "You are an expert web scraping engineer. Generate precise CSS selectors and scraping plans. Always respond with valid JSON format.",
            format: 'json',
            temperature: 0.1,
            maxTokens: options.maxTokens || this.maxTokensGPT4,
        };

        const llmResponse = await this.llmService.generate(llmRequest);
        const parsedResponse = this.parseGPTResponse(llmResponse.content);

        return {
            response: parsedResponse,
            aiData: {
                model: llmResponse.model,
                prompt,
                response: llmResponse.content,
                tokensUsed: llmResponse.tokensUsed || 0
            }
        };
    }

    /**
     * Generate plan using centralized LLM service (Ollama) with response data capture
     */
    private async generateWithLLaMAWithResponse(
        analysis: SiteAnalysis,
        options: PlanOptions
    ): Promise<{
        response: LLMResponse;
        aiData: {
            model: string;
            prompt: string;
            response: string;
            tokensUsed: number;
        };
    }> {
        const prompt = this.buildLocalLLMPrompt(analysis);

        const llmRequest: LLMRequest = {
            prompt,
            systemMessage: "You are an expert web scraping engineer. Generate precise CSS selectors and scraping plans.",
            temperature: 0.1,
            maxTokens: options.maxTokens || 2000,
            provider: 'ollama', // Force use of Ollama
        };

        const llmResponse = await this.llmService.generate(llmRequest);
        const parsedResponse = this.parseLocalLLMResponse(llmResponse.content, analysis);

        return {
            response: parsedResponse,
            aiData: {
                model: llmResponse.model,
                prompt,
                response: llmResponse.content,
                tokensUsed: llmResponse.tokensUsed || 0
            }
        };
    }



    /**
     * Generate plan using centralized LLM service with Ollama
     * Implements requirement 8.2 - local model fallback
     */
    private async generateWithLLaMA(
        analysis: SiteAnalysis,
        options: PlanOptions
    ): Promise<LLMResponse> {
        logger.info("Using centralized LLM service with Ollama for plan generation");

        try {
            // Build prompt for local LLaMA model
            const prompt = this.buildLocalLLMPrompt(analysis);

            const llmRequest: LLMRequest = {
                prompt,
                systemMessage: "You are an expert web scraping engineer. Generate precise CSS selectors and scraping plans.",
                temperature: 0.1,
                maxTokens: options.maxTokens || 2000,
                provider: 'ollama', // Force use of Ollama
            };

            const llmResponse = await this.llmService.generate(llmRequest);

            logger.info("Centralized LLM (Ollama) response received", {
                provider: llmResponse.provider,
                model: llmResponse.model,
                tokensUsed: llmResponse.tokensUsed,
            });

            // Parse the local LLM response
            const parsedResponse = this.parseLocalLLMResponse(
                llmResponse.content,
                analysis
            );

            logger.info("Ollama model generation completed", {
                confidence: parsedResponse.confidence,
                selectorsGenerated: Object.keys(
                    parsedResponse.plan.detailSelectors || {}
                ).length
            });

            return parsedResponse;
        } catch (error) {
            logger.warn(`Centralized LLM (Ollama) failed, using fallback: ${error}`);

            // Fallback to pattern-based generation
            return this.generateFallbackPlan(analysis);
        }
    }

    /**
     * Build prompt specifically for local LLaMA model
     */
    private buildLocalLLMPrompt(analysis: SiteAnalysis): string {
        return `
You are a web scraping expert. Analyze this website's main page and create CSS selectors for list and pagination.

Website: ${analysis.url}
CMS Type: ${analysis.archetype}
Patterns Found: ${analysis.detectedPatterns.join(", ")}
Complexity: ${analysis.complexity}

HTML Structure (compressed):
${analysis.compressedHtml}

Create a scraping plan for the main page with these components:
1. List Selector: CSS selector to find all content items
2. Pagination Selector: CSS selector for next page links (if any)
3. Cookie Consent Selector: CSS selector for cookie save/accept button (if any)

Respond in this format:
LIST_SELECTOR: [CSS selector for content items]
PAGINATION_SELECTOR: [CSS selector for pagination]
COOKIE_CONSENT_SELECTOR: [CSS selector for cookie save/accept button]
CONFIDENCE: [confidence score 0.0-1.0]
REASONING: [explanation of selector choices]

Focus on:
- Finding the main container that holds multiple content items
- Identifying pagination controls (next/previous buttons, page numbers)
- Detecting cookie consent save/accept buttons
- Precise selectors that target the right elements
- Avoiding navigation, header, and footer elements
- Selectors that work across similar pages
- German/English content handling
`;
    }

    /**
     * Parse local LLM response into structured format
     */
    private parseLocalLLMResponse(
        responseText: string,
        analysis: SiteAnalysis
    ): LLMResponse {
        try {
            const lines = responseText
                .split("\n")
                .map((line: string) => line.trim())
                .filter(Boolean);
            const selectors: Record<string, string> = {};
            let listSelector = "article, .item, .entry";
            let paginationSelector: string | undefined;
            let cookieConsentSelector: string | undefined;
            let confidence = 0.6;
            let reasoning = "Generated using local LLaMA model";

            // Parse structured response for main page
            for (const line of lines) {
                if (line.startsWith("LIST_SELECTOR:")) {
                    listSelector = line.replace("LIST_SELECTOR:", "").trim();
                } else if (line.startsWith("PAGINATION_SELECTOR:")) {
                    const pagSelector = line
                        .replace("PAGINATION_SELECTOR:", "")
                        .trim();
                    if (
                        pagSelector &&
                        pagSelector !== "None" &&
                        pagSelector !== "N/A"
                    ) {
                        paginationSelector = pagSelector;
                    }
                } else if (line.startsWith("COOKIE_CONSENT_SELECTOR:")) {
                    const cookieSelector = line
                        .replace("COOKIE_CONSENT_SELECTOR:", "")
                        .trim();
                    if (
                        cookieSelector &&
                        cookieSelector !== "None" &&
                        cookieSelector !== "N/A"
                    ) {
                        cookieConsentSelector = cookieSelector;
                    }
                } else if (line.startsWith("CONFIDENCE:")) {
                    const confStr = line.replace("CONFIDENCE:", "").trim();
                    const confNum = parseFloat(confStr);
                    if (!isNaN(confNum) && confNum >= 0 && confNum <= 1) {
                        confidence = confNum;
                    }
                } else if (line.startsWith("REASONING:")) {
                    reasoning = line.replace("REASONING:", "").trim();
                }
            }

            // Clean up empty selectors
            Object.keys(selectors).forEach((key) => {
                if (
                    !selectors[key] ||
                    selectors[key] === "None" ||
                    selectors[key] === "N/A"
                ) {
                    delete selectors[key];
                }
            });

            const plan: Partial<ScrapingPlan> = {
                listSelector,
                detailSelectors: selectors,
                rateLimitMs: 2000 // Conservative rate limit for local model
            };

            if (paginationSelector) {
                plan.paginationSelector = paginationSelector;
            }

            // Store cookie consent selector in a custom field for later extraction
            const llmResponse: LLMResponse = {
                plan,
                confidence,
                reasoning,
                humanReadableDoc: this.generateLocalLLMDoc(
                    plan,
                    analysis,
                    reasoning
                )
            };

            // Add cookie consent selector to the response for later extraction
            if (cookieConsentSelector) {
                (llmResponse as any).cookieConsentSelector =
                    cookieConsentSelector;
            }

            return llmResponse;
        } catch (error) {
            logger.warn(`Failed to parse local LLM response: ${error}`);
            return this.generateFallbackPlan(analysis);
        }
    }

    /**
     * Generate fallback plan when all LLM methods fail
     */
    private generateFallbackPlan(analysis: SiteAnalysis): LLMResponse {
        logger.info("Generating fallback plan using pattern-based approach");

        // Use detected patterns to create selectors
        const selectors: Record<string, string> = {
            title: 'h1, h2, h3, .title, .headline, [class*="title"]',
            description:
                'p, .description, .content, .text, [class*="description"]'
        };

        // Add date selectors if date patterns detected
        if (analysis.detectedPatterns.includes("date-content")) {
            selectors.dates =
                '.date, time, .published, [datetime], [class*="date"]';
        }

        // Add website selectors
        selectors.website =
            'a[href^="http"], a[href^="www"], [class*="website"], [class*="link"]';

        // Add image selectors
        selectors.images = 'img[src], picture img, [class*="image"] img';

        // Determine list selector based on detected patterns
        let listSelector = "article";
        if (analysis.detectedPatterns.includes("list-structure")) {
            listSelector = 'li, article, .item, .entry, [class*="item"]';
        } else if (analysis.detectedPatterns.includes("card-layout")) {
            listSelector = '.card, [class*="card"], article, .item';
        } else if (analysis.detectedPatterns.includes("table-structure")) {
            listSelector = "tr, tbody tr";
        }

        // Add pagination if detected
        let paginationSelector: string | undefined;
        if (analysis.detectedPatterns.includes("pagination")) {
            paginationSelector =
                '.pagination a, .next, [class*="next"], [class*="pagination"] a';
        }

        const plan: Partial<ScrapingPlan> = {
            listSelector,
            detailSelectors: selectors,
            rateLimitMs: 2000
        };

        if (paginationSelector) {
            plan.paginationSelector = paginationSelector;
        }

        // Lower confidence for fallback
        const confidence = 0.5;
        const reasoning = `Fallback plan generated using pattern-based approach. Detected patterns: ${analysis.detectedPatterns.join(", ")}. CMS archetype: ${analysis.archetype}.`;

        return {
            plan,
            confidence,
            reasoning,
            humanReadableDoc: this.generateLocalLLMDoc(
                plan,
                analysis,
                reasoning
            )
        };
    }

    /**
     * Generate documentation for local LLM generated plans
     */
    private generateLocalLLMDoc(
        plan: Partial<ScrapingPlan>,
        analysis: SiteAnalysis,
        reasoning: string
    ): string {
        return `
# Local LLM Generated Scraping Plan

## Overview
- **URL**: ${analysis.url}
- **Model**: Local LLaMA
- **Archetype**: ${analysis.archetype}
- **Complexity**: ${analysis.complexity}

## Selectors Generated
- **List Selector**: ${plan.listSelector}
- **Detail Selectors**: ${Object.keys(plan.detailSelectors || {}).length} fields
${Object.entries(plan.detailSelectors || {})
    .map(([field, selector]) => `  - ${field}: ${selector}`)
    .join("\n")}
${plan.paginationSelector ? `- **Pagination**: ${plan.paginationSelector}` : "- **Pagination**: Not detected"}

## Analysis
- **Detected Patterns**: ${analysis.detectedPatterns.join(", ")}
- **Estimated Tokens**: ${analysis.estimatedTokens}
- **Rate Limit**: ${plan.rateLimitMs}ms

## Reasoning
${reasoning}

## Notes
This plan was generated using a local LLaMA model as a fallback option.
Consider validating selectors on actual content before production use.
`;
    }

    /**
     * Build structured prompt for LLM
     */
    private buildPrompt(
        analysis: SiteAnalysis,
        _model: "gpt-5" | "llama",
        analysisType: "main-page" | "content-page" = "main-page"
    ): string {
        if (analysisType === "main-page") {
            return this.buildMainPagePrompt(analysis, _model);
        } else {
            return this.buildContentPagePrompt(analysis, _model);
        }
    }

    /**
     * Build prompt for main page analysis (list, pagination, cookie consent)
     */
    private buildMainPagePrompt(
        analysis: SiteAnalysis,
        _model: "gpt-5" | "llama"
    ): string {
        logger.info("Building main page prompt for LLM", {
            analysis: analysis.compressedHtml
        });
        return `
Analyze this website's main page and generate a JSON scraping plan for list and pagination:

URL: ${analysis.url}
Archetype: ${analysis.archetype}
Detected Patterns: ${analysis.detectedPatterns.join(", ")}
Complexity: ${analysis.complexity}

HTML Structure:
${analysis.compressedHtml}

Generate a JSON response with this structure:
{
  "plan": {
    "listSelector": "CSS selector for list items",
    "paginationSelector": "CSS selector for pagination (optional)",
    "rateLimitMs": 1000
  },
  "cookieConsent": {
    "saveButtonSelector": "CSS selector for cookie save/accept button (optional)"
  },
  "confidence": 0.85,
  "reasoning": "Explanation of selector choices and confidence",
  "humanReadableDoc": "Human-readable documentation of the plan"
}

Focus on:
1. Finding the main container that holds multiple content items
2. Identifying pagination controls (next/previous buttons, page numbers)
3. Detecting cookie consent save/accept buttons
4. Precise CSS selectors that target the right elements
5. Handling of German/English multilingual content
6. Robust selectors that work across similar pages
7. Confidence based on selector specificity and structure clarity
`;
    }

    /**
     * Build prompt for content page analysis (detail selectors)
     */
    private buildContentPagePrompt(
        analysis: SiteAnalysis,
        _model: "gpt-5" | "llama"
    ): string {
        logger.info("Building content page prompt for LLM", {
            analysis: analysis.compressedHtml
        });
        return `
Analyze this content page and generate detail selectors for data extraction:

URL: ${analysis.url}
Archetype: ${analysis.archetype}
Detected Patterns: ${analysis.detectedPatterns.join(", ")}
Complexity: ${analysis.complexity}

HTML Structure:
${analysis.compressedHtml}

Generate a JSON response with this structure:
{
  "detailSelectors": {
    "title": "CSS selector for title",
    "description": "CSS selector for description",
    "date": "CSS selector for dates",
    "address": "CSS selector for address",
    "phone": "CSS selector for phone",
    "email": "CSS selector for email",
    "website": "CSS selector for website links",
    "images": "CSS selector for images"
  },
  "confidence": 0.85,
  "reasoning": "Explanation of selector choices and confidence",
  "humanReadableDoc": "Human-readable documentation of the selectors"
}

Focus on:
1. Finding specific data fields within the content
2. Precise CSS selectors that target individual data elements
3. Handling of German/English multilingual content
4. Robust selectors that work across similar content pages
5. Confidence based on selector specificity and structure clarity
`;
    }

    /**
     * Parse GPT response and validate structure
     */
    private parseGPTResponse(content: string): LLMResponse {
        try {
            // Try to extract JSON from the response if it's wrapped in text
            let jsonContent = content.trim();

            // Look for JSON block markers
            const jsonMatch =
                content.match(/```json\s*([\s\S]*?)\s*```/) ||
                content.match(/```\s*([\s\S]*?)\s*```/) ||
                content.match(/\{[\s\S]*\}/);

            if (jsonMatch) {
                jsonContent = jsonMatch[1] || jsonMatch[0];
            }

            const parsed = JSON.parse(jsonContent);

            // Validate required fields
            if (!parsed.plan || !parsed.confidence || !parsed.reasoning) {
                logger.warn(
                    "Response missing required fields, attempting to construct from available data"
                );

                // Try to construct a valid response from partial data
                return this.constructFallbackResponse(parsed, content);
            }

            return parsed as LLMResponse;
        } catch (error) {
            logger.error(`Failed to parse GPT response: ${error}`);
            logger.debug(
                `Raw response content: ${content.substring(0, 500)}...`
            );

            // Try to construct a fallback response
            return this.constructFallbackResponse({}, content);
        }
    }

    /**
     * Construct a fallback response when JSON parsing fails
     */
    private constructFallbackResponse(
        partialData: any,
        rawContent: string
    ): LLMResponse {
        logger.warn("Constructing fallback response from partial data");

        return {
            plan: partialData.plan || {
                listSelector: "article, .item, .entry, .content",
                detailSelectors: {
                    title: "h1, h2, h3, .title",
                    description: "p, .description, .content",
                    website: "a[href]",
                    dates: ".date, time, [datetime]"
                }
            },
            confidence: partialData.confidence || 0.5,
            reasoning:
                partialData.reasoning ||
                "Fallback response due to parsing issues",
            humanReadableDoc:
                partialData.humanReadableDoc ||
                `Generated plan for content extraction. Raw response: ${rawContent.substring(0, 200)}...`
        };
    }

    /**
     * Parse content page response with different JSON structure
     */
    private parseContentPageResponse(content: string): {
        detailSelectors: Record<string, string>;
        confidence: number;
        reasoning: string;
        humanReadableDoc: string;
    } {
        try {
            // Try to extract JSON from the response if it's wrapped in text
            let jsonContent = content.trim();

            // Look for JSON block markers
            const jsonMatch =
                content.match(/```json\s*([\s\S]*?)\s*```/) ||
                content.match(/```\s*([\s\S]*?)\s*```/) ||
                content.match(/\{[\s\S]*\}/);

            if (jsonMatch) {
                jsonContent = jsonMatch[1] || jsonMatch[0];
            }

            const parsed = JSON.parse(jsonContent);

            // Validate required fields for content page response
            if (
                !parsed.detailSelectors ||
                !parsed.confidence ||
                !parsed.reasoning
            ) {
                logger.warn(
                    "Content page response missing required fields, using fallback"
                );

                return {
                    detailSelectors: parsed.detailSelectors || {
                        title: "h1, h2, h3, .title",
                        description: "p, .description, .content",
                        date: ".date, time, [datetime]",
                        address: '.address, [class*="address"]',
                        phone: '.phone, [class*="phone"]',
                        email: '.email, [class*="email"]',
                        website: "a[href]",
                        images: "img[src]"
                    },
                    confidence: parsed.confidence || 0.5,
                    reasoning:
                        parsed.reasoning || "Fallback content page selectors",
                    humanReadableDoc:
                        parsed.humanReadableDoc ||
                        "Generated content page selectors for data extraction"
                };
            }

            return {
                detailSelectors: parsed.detailSelectors,
                confidence: parsed.confidence,
                reasoning: parsed.reasoning,
                humanReadableDoc:
                    parsed.humanReadableDoc ||
                    "Content page selectors generated by AI"
            };
        } catch (error) {
            logger.error(`Failed to parse content page response: ${error}`);
            logger.debug(
                `Raw content page response: ${content.substring(0, 500)}...`
            );

            // Return fallback response
            return {
                detailSelectors: {
                    title: "h1, h2, h3, .title",
                    description: "p, .description, .content",
                    date: ".date, time, [datetime]",
                    address: '.address, [class*="address"]',
                    phone: '.phone, [class*="phone"]',
                    email: '.email, [class*="email"]',
                    website: "a[href]",
                    images: "img[src]"
                },
                confidence: 0.3,
                reasoning:
                    "Fallback content page selectors due to parsing error",
                humanReadableDoc: `Content page selectors generated with fallback. Raw response: ${content.substring(0, 200)}...`
            };
        }
    }

    /**
     * Build complete scraping plan from LLM response
     */
    private buildScrapingPlan(
        planId: string,
        analysis: SiteAnalysis,
        llmResponse: LLMResponse,
        aiResponseData?: {
            model: string;
            prompt: string;
            response: string;
            tokensUsed: number;
        },
        cookieConsentData?: any
    ): ScrapingPlan {
        // Use pre-detected cookie consent data if available, otherwise detect from HTML
        const hasCookieConsent =
            cookieConsentData?.detected ||
            this.detectCookieConsent(analysis.compressedHtml);
        const cookieLibrary =
            cookieConsentData?.library ||
            this.detectCookieConsentLibrary(analysis.compressedHtml);

        // Extract cookie consent selector from LLaMA response if available
        let cookieConsentSaveButton: string | undefined;
        if ((llmResponse as any).cookieConsentSelector) {
            cookieConsentSaveButton = (llmResponse as any)
                .cookieConsentSelector;
        }

        const metadata: PlanMetadata = {
            domain: new URL(analysis.url).hostname,
            siteType: "municipal", // Default - would be detected in real implementation
            language: "de", // Default - would be detected from content
            createdBy: "ai",
            successRate: 0,
            avgAccuracy: 0,
            robotsTxtCompliant: true, // Would be checked by legal compliance service
            gdprCompliant: true,
            cookieConsentStrategy:
                cookieConsentData?.strategy ||
                (hasCookieConsent ? "accept-all" : "none-detected"), // NEW
            cookieConsentRequired: hasCookieConsent, // NEW
            cookieConsentLibrary: cookieLibrary, // NEW
            cookieConsentSaveButton, // NEW: CSS selector for cookie save/accept button
            // NEW: Store AI response for debugging
            aiResponse: aiResponseData
                ? {
                      model: aiResponseData.model,
                      prompt: aiResponseData.prompt,
                      response: aiResponseData.response,
                      tokensUsed: aiResponseData.tokensUsed,
                      timestamp: new Date()
                  }
                : undefined
        };

        const plan: ScrapingPlan = {
            planId,
            version: 1,
            entryUrls: [analysis.url],
            listSelector: llmResponse.plan.listSelector || "article",
            detailSelectors: llmResponse.plan.detailSelectors || {},
            rateLimitMs: llmResponse.plan.rateLimitMs || 1000,
            retryPolicy: {
                maxAttempts: 3,
                backoffStrategy: "exponential",
                baseDelayMs: 1000,
                maxDelayMs: 30000,
                retryableErrors: ["TIMEOUT", "NETWORK_ERROR", "RATE_LIMITED"]
            },
            confidenceScore: llmResponse.confidence,
            metadata
        };

        if (llmResponse.plan.paginationSelector) {
            plan.paginationSelector = llmResponse.plan.paginationSelector;
        }

        return plan;
    }

    /**
     * Calculate confidence score based on multiple factors
     * Implements requirement 1.5 - confidence scoring algorithm
     */
    private calculateConfidenceScore(
        llmResponse: LLMResponse,
        analysis: SiteAnalysis
    ): number {
        const factors: ConfidenceFactors = {
            selectorSpecificity: this.evaluateSelectorSpecificity(
                llmResponse.plan.detailSelectors || {}
            ),
            structureClarity: this.evaluateStructureClarity(analysis),
            patternConsistency: this.evaluatePatternConsistency(
                analysis.detectedPatterns
            ),
            responseCompleteness: this.evaluateResponseCompleteness(
                llmResponse.plan
            )
        };

        // Weighted average of confidence factors
        const weights = {
            selectorSpecificity: 0.3,
            structureClarity: 0.25,
            patternConsistency: 0.2,
            responseCompleteness: 0.25
        };

        const weightedScore =
            factors.selectorSpecificity * weights.selectorSpecificity +
            factors.structureClarity * weights.structureClarity +
            factors.patternConsistency * weights.patternConsistency +
            factors.responseCompleteness * weights.responseCompleteness;

        // Combine with LLM's own confidence
        const finalScore = (weightedScore + llmResponse.confidence) / 2;

        return Math.round(finalScore * 100) / 100; // Round to 2 decimal places
    }

    /**
     * Evaluate selector specificity
     */
    private evaluateSelectorSpecificity(
        selectors: Record<string, string>
    ): number {
        const selectorCount = Object.keys(selectors).length;
        if (selectorCount === 0) return 0;

        let specificitySum = 0;
        for (const selector of Object.values(selectors)) {
            // Simple specificity scoring based on selector complexity
            const hasClass = selector.includes(".");
            const hasId = selector.includes("#");
            const hasAttribute = selector.includes("[");
            const hasDescendant = selector.includes(" ");

            let score = 0.3; // Base score
            if (hasClass) score += 0.2;
            if (hasId) score += 0.3;
            if (hasAttribute) score += 0.1;
            if (hasDescendant) score += 0.1;

            specificitySum += Math.min(score, 1.0);
        }

        return specificitySum / selectorCount;
    }

    /**
     * Evaluate structure clarity
     */
    private evaluateStructureClarity(analysis: SiteAnalysis): number {
        const patternCount = analysis.detectedPatterns.length;
        const complexityScore =
            analysis.complexity === "low"
                ? 0.9
                : analysis.complexity === "medium"
                  ? 0.7
                  : 0.5;

        const patternScore = Math.min(patternCount / 5, 1.0); // Normalize to 0-1

        return (complexityScore + patternScore) / 2;
    }

    /**
     * Evaluate pattern consistency
     */
    private evaluatePatternConsistency(patterns: string[]): number {
        // More patterns generally indicate better structure
        const patternScore = Math.min(patterns.length / 4, 1.0);

        // Bonus for having key patterns
        const keyPatterns = ["list-structure", "pagination", "date-content"];
        const keyPatternCount = patterns.filter((p) =>
            keyPatterns.includes(p)
        ).length;
        const keyPatternBonus = (keyPatternCount / keyPatterns.length) * 0.2;

        return Math.min(patternScore + keyPatternBonus, 1.0);
    }

    /**
     * Evaluate response completeness
     */
    private evaluateResponseCompleteness(plan: Partial<ScrapingPlan>): number {
        const requiredFields = ["listSelector", "detailSelectors"];
        const optionalFields = ["paginationSelector", "rateLimitMs"];

        let score = 0;

        // Check required fields
        for (const field of requiredFields) {
            if (plan[field as keyof ScrapingPlan]) {
                score += 0.4; // 0.8 total for required fields
            }
        }

        // Check optional fields
        for (const field of optionalFields) {
            if (plan[field as keyof ScrapingPlan]) {
                score += 0.1; // 0.2 total for optional fields
            }
        }

        return Math.min(score, 1.0);
    }

    /**
     * Enhance plan using centralized LLM service when confidence is low
     * Requirement 1.6: LLM enhancement for low-confidence plans
     */
    private async enhancePlanWithLLM(
        plan: ScrapingPlan,
        siteAnalysis: SiteAnalysisResult,
        options: PlanOptions
    ): Promise<Partial<ScrapingPlan> | null> {
        try {
            logger.info(
                `Enhancing plan ${plan.planId} with centralized LLM service due to low confidence`
            );

            const enhancementPrompt = this.buildEnhancementPrompt(
                plan,
                siteAnalysis
            );

            const llmRequest: LLMRequest = {
                prompt: enhancementPrompt,
                systemMessage: "You are an expert web scraping engineer. Improve the provided scraping plan based on site analysis. Always respond with valid JSON format.",
                format: 'json',
                maxTokens: options.maxTokens || this.maxTokensGPT4,
                temperature: 0.1,
            };

            const llmResponse = await this.llmService.generate(llmRequest);

            const enhancement = JSON.parse(llmResponse.content);
            return enhancement.improvements || null;
        } catch (error) {
            logger.warn(`LLM enhancement failed: ${error}`);
            return null;
        }
    }

    /**
     * Build enhancement prompt for LLM
     */
    private buildEnhancementPrompt(
        plan: ScrapingPlan,
        siteAnalysis: SiteAnalysisResult
    ): string {
        return `
Improve this scraping plan based on the site analysis:

Current Plan:
- List Selector: ${plan.listSelector}
- Detail Selectors: ${JSON.stringify(plan.detailSelectors, null, 2)}
- Pagination: ${plan.paginationSelector || "None"}
- Confidence: ${plan.confidenceScore}

Site Analysis:
- URL: ${siteAnalysis.url}
- CMS Archetype: ${siteAnalysis.archetype}
- Detected Patterns: ${siteAnalysis.patterns.map((p) => `${p.type}: ${p.selector}`).join(", ")}
- List Containers: ${siteAnalysis.listContainers.map((c) => c.selector).join(", ")}
- Pagination Detected: ${siteAnalysis.paginationInfo.detected}

Provide improvements in this JSON format:
{
  "improvements": {
    "listSelector": "improved selector if needed",
    "detailSelectors": {
      "title": "improved title selector",
      "description": "improved description selector"
    },
    "paginationSelector": "improved pagination selector if needed"
  },
  "reasoning": "explanation of improvements made"
}

Focus on:
1. More specific and reliable selectors
2. Better handling of the detected CMS archetype
3. Improved pagination detection
4. Selectors that work across similar pages
`;
    }

    /**
     * Generate human-readable documentation for the plan
     */
    private generateHumanReadableDoc(
        plan: ScrapingPlan,
        siteAnalysis: SiteAnalysisResult,
        contentUrls?: string[]
    ): string {
        const doc = `
# Scraping Plan Documentation

## Overview
- **Plan ID**: ${plan.planId}
- **Target URL**: ${siteAnalysis.url}
- **CMS Archetype**: ${siteAnalysis.archetype}
- **Confidence Score**: ${plan.confidenceScore.toFixed(2)}
- **Content URLs Used**: ${contentUrls?.length || 0}

## Site Analysis Results
- **Detected Patterns**: ${siteAnalysis.patterns.map((p) => p.type).join(", ")}
- **List Containers Found**: ${siteAnalysis.listContainers.length}
- **Pagination Detected**: ${siteAnalysis.paginationInfo.detected ? "Yes" : "No"}
- **Content Areas**: ${siteAnalysis.contentAreas.length}

## Scraping Configuration

### List Item Selection
- **Selector**: \`${plan.listSelector}\`
- **Purpose**: Identifies individual content items on the page

### Data Extraction Selectors
${Object.entries(plan.detailSelectors)
    .map(([field, selector]) => `- **${field}**: \`${selector}\``)
    .join("\n")}

### Pagination
${
    plan.paginationSelector
        ? `- **Selector**: \`${plan.paginationSelector}\`\n- **Type**: ${siteAnalysis.paginationInfo.type || "Unknown"}`
        : "- No pagination detected"
}

### Rate Limiting
- **Delay**: ${plan.rateLimitMs}ms between requests
- **Retry Policy**: ${plan.retryPolicy.maxAttempts} attempts with ${plan.retryPolicy.backoffStrategy} backoff

## Content-Aware Features
${
    contentUrls && contentUrls.length > 0
        ? `
- **Content URLs Analyzed**: ${contentUrls.length}
- **Pattern-Based Selection**: Yes
- **Navigation Exclusion**: Automatic
- **Content Container Detection**: Yes
`
        : `
- **Content URLs Analyzed**: None
- **Pattern-Based Selection**: No
- **Fallback Mode**: Generic pattern detection
`
}

## Compliance
- **Robots.txt**: ${plan.metadata.robotsTxtCompliant ? "Compliant" : "Check Required"}
- **GDPR**: ${plan.metadata.gdprCompliant ? "Compliant" : "Review Required"}
- **Rate Limiting**: Enabled (${plan.rateLimitMs}ms)

## Quality Metrics
- **Expected Success Rate**: ${(plan.confidenceScore * 100).toFixed(0)}%
- **Archetype Optimization**: ${siteAnalysis.archetype !== "generic" ? "Yes" : "No"}
- **Validation Status**: ${contentUrls ? "Content-Validated" : "Pattern-Based"}
`;

        return doc.trim();
    }

    /**
     * Generate test results by actually testing selectors on content URLs
     * Implements requirement 4.3 - sandbox test execution for plan validation
     */
    private async generateTestResults(
        plan: ScrapingPlan,
        siteAnalysis: SiteAnalysisResult,
        validationResult: {
            isValid: boolean;
            confidence: number;
            issues: string[];
        },
        contentUrls?: string[]
    ): Promise<TestExecutionResult> {
        try {
            logger.info(`Generating test results for plan ${plan.planId}`);

            const testResults: TestExecutionResult = {
                success:
                    validationResult.isValid &&
                    validationResult.confidence > this.confidenceThreshold,
                extractedSamples: [],
                errors: validationResult.issues,
                confidence: validationResult.confidence
            };

            // If we have content URLs, test the selectors on them
            if (contentUrls && contentUrls.length > 0) {
                const sampleExtractions = await this.testSelectorsOnContentUrls(
                    plan,
                    contentUrls.slice(0, 3)
                ); // Test on first 3 URLs
                testResults.extractedSamples = sampleExtractions.samples;
                testResults.errors.push(...sampleExtractions.errors);

                // Adjust confidence based on actual extraction results
                if (sampleExtractions.samples.length > 0) {
                    const extractionSuccessRate =
                        sampleExtractions.samples.length /
                        Math.min(contentUrls.length, 3);
                    testResults.confidence =
                        (testResults.confidence + extractionSuccessRate) / 2;
                }
            } else {
                // Test on the main entry URL
                const mainUrlTest = await this.testSelectorsOnUrl(
                    plan,
                    siteAnalysis.url
                );
                testResults.extractedSamples = mainUrlTest.samples;
                testResults.errors.push(...mainUrlTest.errors);
            }

            // Update success status based on actual test results
            testResults.success =
                testResults.extractedSamples.length > 0 &&
                testResults.confidence > this.confidenceThreshold &&
                testResults.errors.length === 0;

            logger.info(`Test results generated for plan ${plan.planId}`, {
                success: testResults.success,
                samplesExtracted: testResults.extractedSamples.length,
                errors: testResults.errors.length,
                finalConfidence: testResults.confidence
            });

            return testResults;
        } catch (error) {
            logger.error(
                `Failed to generate test results for plan ${plan.planId}:`,
                error
            );

            return {
                success: false,
                extractedSamples: [],
                errors: [
                    `Test execution failed: ${error instanceof Error ? error.message : String(error)}`
                ],
                confidence: 0
            };
        }
    }

    /**
     * Test selectors on multiple content URLs
     */
    private async testSelectorsOnContentUrls(
        plan: ScrapingPlan,
        contentUrls: string[]
    ): Promise<{ samples: any[]; errors: string[] }> {
        const { chromium } = await import("playwright");
        const browser = await chromium.launch({ headless: true });
        const samples: any[] = [];
        const errors: string[] = [];

        try {
            for (const url of contentUrls) {
                try {
                    const context = await browser.newContext();
                    const page = await context.newPage();

                    await page.goto(url, {
                        waitUntil: "domcontentloaded",
                        timeout: 15000
                    });

                    // Extract data using the plan's selectors
                    const extractedData = await page.evaluate(
                        (selectors: Record<string, string>) => {
                            const data: any = { url: window.location.href };

                            // Extract each field
                            for (const [field, selector] of Object.entries(
                                selectors
                            )) {
                                try {
                                    const element =
                                        document.querySelector(selector);
                                    if (element) {
                                        if (field === "images") {
                                            data[field] =
                                                element.getAttribute("src") ||
                                                element.getAttribute(
                                                    "data-src"
                                                );
                                        } else if (field === "website") {
                                            data[field] =
                                                element.getAttribute("href");
                                        } else {
                                            data[field] =
                                                element.textContent?.trim();
                                        }
                                    }
                                } catch (err) {
                                    // Ignore individual selector errors
                                }
                            }

                            return data;
                        },
                        plan.detailSelectors
                    );

                    // Only add if we extracted meaningful data
                    const fieldCount = Object.keys(extractedData).filter(
                        (key) =>
                            key !== "url" &&
                            extractedData[key] &&
                            (typeof extractedData[key] === "string"
                                ? extractedData[key].length > 0
                                : !!extractedData[key])
                    ).length;

                    if (fieldCount > 0) {
                        samples.push(extractedData);
                    }

                    await context.close();
                } catch (error) {
                    errors.push(
                        `Failed to test on ${url}: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }
        } finally {
            await browser.close();
        }

        return { samples, errors };
    }

    /**
     * Test selectors on a single URL
     */
    private async testSelectorsOnUrl(
        plan: ScrapingPlan,
        url: string
    ): Promise<{ samples: any[]; errors: string[] }> {
        const { chromium } = await import("playwright");
        const browser = await chromium.launch({ headless: true });
        const samples: any[] = [];
        const errors: string[] = [];

        try {
            const context = await browser.newContext();
            const page = await context.newPage();

            await page.goto(url, {
                waitUntil: "domcontentloaded",
                timeout: 15000
            });

            // Test list selector first
            const listElements = await page.$$(plan.listSelector);

            if (listElements.length === 0) {
                errors.push(
                    `List selector "${plan.listSelector}" found no elements`
                );
                await context.close();
                return { samples, errors };
            }

            // Extract data from first few list items
            const extractedItems = await page.evaluate(
                (params: {
                    listSelector: string;
                    detailSelectors: Record<string, string>;
                }) => {
                    const items = document.querySelectorAll(
                        params.listSelector
                    );
                    const results: any[] = [];

                    // Test on first 3 items
                    for (let i = 0; i < Math.min(items.length, 3); i++) {
                        const item = items[i];
                        const data: any = {
                            url: window.location.href,
                            itemIndex: i
                        };

                        // Extract each field within the context of this item
                        for (const [field, selector] of Object.entries(
                            params.detailSelectors
                        )) {
                            try {
                                // Try to find element within the item first, then globally
                                let element =
                                    item.querySelector(selector) ||
                                    document.querySelector(selector);

                                if (element) {
                                    if (field === "images") {
                                        data[field] =
                                            element.getAttribute("src") ||
                                            element.getAttribute("data-src");
                                    } else if (field === "website") {
                                        data[field] =
                                            element.getAttribute("href");
                                    } else {
                                        data[field] =
                                            element.textContent?.trim();
                                    }
                                }
                            } catch (err) {
                                // Ignore individual selector errors
                            }
                        }

                        results.push(data);
                    }

                    return results;
                },
                {
                    listSelector: plan.listSelector,
                    detailSelectors: plan.detailSelectors
                }
            );

            const items = extractedItems as any[];
            samples.push(
                ...items.filter((item: any) => {
                    const fieldCount = Object.keys(item).filter(
                        (key: string) =>
                            !["url", "itemIndex"].includes(key) &&
                            item[key] &&
                            (typeof item[key] === "string"
                                ? item[key].length > 0
                                : !!item[key])
                    ).length;
                    return fieldCount > 0;
                })
            );

            await context.close();
        } catch (error) {
            errors.push(
                `Failed to test selectors on ${url}: ${error instanceof Error ? error.message : String(error)}`
            );
        } finally {
            await browser.close();
        }

        return { samples, errors };
    }

    /**
     * Map string pattern to DetectedPattern type
     */
    private mapPatternType(
        pattern: string
    ): "list" | "table" | "card" | "article" | "pagination" | "navigation" {
        switch (pattern) {
            case "list-structure":
                return "list";
            case "table-structure":
                return "table";
            case "card-layout":
                return "card";
            case "pagination":
                return "pagination";
            case "date-content":
                return "article";
            default:
                return "article";
        }
    }

    /**
     * Public method to call centralized LLM service for cookie consent button identification
     * Used by CookieConsentHandler service
     */
    async callOpenAI(
        prompt: string,
        options: {
            model?: string;
            maxTokens?: number;
            temperature?: number;
        } = {}
    ): Promise<{ content: string; tokensUsed?: number }> {
        const llmRequest: LLMRequest = {
            prompt,
            maxTokens: options.maxTokens || 1000,
            temperature: options.temperature || 0.1,
            provider: 'openai', // Force OpenAI for cookie consent analysis
        };

        logger.debug("Making centralized LLM request for cookie consent analysis");

        const llmResponse = await this.llmService.generate(llmRequest);

        return {
            content: llmResponse.content,
            tokensUsed: llmResponse.tokensUsed
        };
    }

    /**
     * Detect if website has cookie consent requirements
     */
    private detectCookieConsent(html: string): boolean {
        const cookieKeywords = [
            "cookie",
            "consent",
            "zustimmen",
            "akzeptieren",
            "datenschutz"
        ];
        const hasKeywords = cookieKeywords.some((keyword) =>
            html.toLowerCase().includes(keyword.toLowerCase())
        );

        // Check for common cookie consent patterns
        const cookiePatterns = [
            /cookie.*banner/i,
            /consent.*dialog/i,
            /cookie.*notice/i,
            /privacy.*notice/i,
            /gdpr.*consent/i
        ];

        const hasPatterns = cookiePatterns.some((pattern) =>
            pattern.test(html)
        );

        return hasKeywords && hasPatterns;
    }

    /**
     * Detect cookie consent library used on the page
     */
    private detectCookieConsentLibrary(html: string): string | undefined {
        const libraries = [
            {
                name: "Cookiebot",
                patterns: ["cookiebot", "CookieConsent.renew", "CookieConsent"]
            },
            {
                name: "OneTrust",
                patterns: ["OneTrust", "optanon", "OptanonConsent"]
            },
            { name: "CookieYes", patterns: ["cookieyes", "cky-", "CookieYes"] },
            { name: "Borlabs", patterns: ["borlabs-cookie", "BorlabsCookie"] },
            {
                name: "CookieLawInfo",
                patterns: ["cookie-law-info", "cliSettings"]
            },
            {
                name: "Cookie Notice",
                patterns: ["cookie-notice", "CookieNotice"]
            }
        ];

        for (const library of libraries) {
            if (
                library.patterns.some((pattern) =>
                    html.toLowerCase().includes(pattern.toLowerCase())
                )
            ) {
                return library.name;
            }
        }

        return undefined;
    }

    /**
     * Analyze individual content page to extract detail selectors
     */
    async analyzeContentPage(
        url: string,
        html: string
    ): Promise<{
        detailSelectors: Record<string, string>;
        confidence: number;
        aiResponse?: {
            model: string;
            prompt: string;
            response: string;
            tokensUsed: number;
            timestamp: Date;
        };
    }> {
        logger.info(`Analyzing content page for detail selectors: ${url}`);

        try {
            // Compress HTML for analysis
            const compressedHtml = this.compressHtml(html, "content");

            // Create site analysis for content page
            const analysis: SiteAnalysis = {
                url,
                compressedHtml,
                detectedPatterns: ["content-page"],
                archetype: "generic",
                complexity: "low",
                estimatedTokens: Math.ceil(compressedHtml.length / 4) // Rough token estimate
            };

            // Use content page prompt
            const prompt = this.buildContentPagePrompt(analysis, "gpt-5");

            // Call OpenAI API
            const response = await this.callOpenAI(prompt, {
                model: "gpt-4o-mini"
            });

            // Parse response using content page parser
            const parsedResponse = this.parseContentPageResponse(
                response.content
            );

            // Create AI response data for debugging
            const aiResponseData = {
                model: "gpt-4o-mini",
                prompt,
                response: response.content,
                tokensUsed: response.tokensUsed || 0,
                timestamp: new Date()
            };

            logger.info("Content page analysis completed", {
                url,
                confidence: parsedResponse.confidence,
                selectorsFound: Object.keys(
                    parsedResponse.detailSelectors || {}
                ).length
            });

            return {
                detailSelectors: parsedResponse.detailSelectors || {},
                confidence: parsedResponse.confidence || 0.5,
                aiResponse: aiResponseData
            };
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            logger.error("Content page analysis failed", {
                url,
                error: errorMessage
            });

            // Return empty selectors with low confidence
            return {
                detailSelectors: {},
                confidence: 0.1
            };
        }
    }

    /**
     * Generate unique plan ID
     */
    private generatePlanId(url: string): string {
        const domain = new URL(url).hostname.replace(/\./g, "-");
        const timestamp = Date.now();
        return `plan-${domain}-${timestamp}`;
    }
}
