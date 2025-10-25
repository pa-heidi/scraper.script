/**
 * Site Analysis Service
 * Parses HTML and identifies common patterns for enhanced scraping plan generation
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 9.3
 */

import { JSDOM } from "jsdom";
import {
    ContentPatternAnalysis,
    ListContainer,
    DOMStructure,
    ScrapingPlan,
    PlanMetadata,
    RetryPolicy
} from "../interfaces/core";
import { ContentPatternAnalyzer } from "./content-pattern-analyzer.service";
import { PlaywrightExecutor } from './playwright-executor.service';
import { logger } from "../utils/logger";

export interface SiteAnalysisResult {
    url: string;
    archetype: CMSArchetype;
    patterns: DetectedPattern[];
    listContainers: ListContainer[];
    paginationInfo: PaginationInfo;
    contentAreas: ContentArea[];
    confidence: number;
}

export interface DetectedPattern {
    type: "list" | "table" | "card" | "article" | "pagination" | "navigation";
    selector: string;
    confidence: number;
    examples: string[];
}

export interface PaginationInfo {
    detected: boolean;
    selector?: string;
    type?: "numbered" | "next-prev" | "load-more";
    confidence: number;
}

export interface ContentArea {
    selector: string;
    type: "main" | "sidebar" | "header" | "footer" | "navigation";
    confidence: number;
}

export type CMSArchetype = "wordpress" | "typo3" | "drupal" | "generic";

export class SiteAnalysisService {
    private contentPatternAnalyzer: ContentPatternAnalyzer;

    // CMS detection patterns
    private readonly CMS_PATTERNS = {
        wordpress: [
            "wp-content",
            "wp-includes",
            "wordpress",
            "wp-admin",
            'class="wp-',
            'id="wp-',
            "/wp-json/",
            "wp-embed"
        ],
        typo3: [
            "typo3",
            "t3-",
            "TYPO3",
            "typo3conf",
            "fileadmin",
            'class="tx-',
            'id="tx-',
            "data-namespace-typo3"
        ],
        drupal: [
            "drupal",
            "sites/default",
            "sites/all",
            "modules/",
            'class="node-',
            'id="node-',
            "data-drupal-",
            "Drupal.settings"
        ]
    };

    // Common list patterns
    private readonly LIST_PATTERNS = [
        "ul.items",
        "ol.items",
        ".item-list",
        ".content-list",
        "ul.posts",
        "ol.posts",
        ".post-list",
        ".article-list",
        ".events",
        ".news-list",
        ".product-list",
        ".results",
        "tbody tr",
        ".grid .item",
        ".cards .card"
    ];

    // Pagination patterns
    private readonly PAGINATION_PATTERNS = [
        ".pagination",
        ".pager",
        ".page-numbers",
        ".nav-links",
        ".next",
        ".previous",
        ".load-more",
        '[rel="next"]',
        '[rel="prev"]',
        ".page-nav",
        ".paginate"
    ];

    constructor(playwrightExecutor?: PlaywrightExecutor) {
        // Create a default PlaywrightExecutor if none provided (for backward compatibility)
        if (!playwrightExecutor) {
            playwrightExecutor = new PlaywrightExecutor();
        }
        this.contentPatternAnalyzer = new ContentPatternAnalyzer(playwrightExecutor);
    }

    /**
     * Analyze website structure and identify patterns
     * Requirement 1.1: Analyze website URLs and generate scraping plans
     */
    async analyzeSite(
        url: string,
        html: string,
        contentUrls?: string[]
    ): Promise<SiteAnalysisResult> {
        logger.info(`Starting site analysis for: ${url}`);

        const dom = new JSDOM(html);
        const document = dom.window.document;

        // Detect CMS archetype
        const archetype = this.detectCMSArchetype(html);
        logger.info(`Detected CMS archetype: ${archetype}`);

        // Parse DOM structure
        const domStructure = this.parseDOMStructure(document.documentElement);

        // Detect common patterns
        const patterns = await this.detectPatterns(html, domStructure);

        // Analyze content patterns if content URLs provided
        let contentPatternAnalysis: ContentPatternAnalysis | null = null;
        if (contentUrls && contentUrls.length > 0) {
            contentPatternAnalysis =
                await this.contentPatternAnalyzer.analyzeContentPatterns(
                    contentUrls
                );
        }

        // Identify list containers
        const listContainers = await this.identifyListContainers(
            html,
            domStructure,
            contentPatternAnalysis
        );

        // Detect pagination
        const paginationInfo = this.detectPagination(html, domStructure);

        // Identify content areas
        const contentAreas = this.identifyContentAreas(domStructure);

        // Calculate overall confidence
        const confidence = this.calculateAnalysisConfidence(
            patterns,
            listContainers,
            paginationInfo,
            contentPatternAnalysis
        );

        return {
            url,
            archetype,
            patterns,
            listContainers,
            paginationInfo,
            contentAreas,
            confidence
        };
    }

    /**
     * Generate enhanced scraping plan using content URLs
     * Requirement 1.2: Generate JSON scraping plan with content-aware selectors
     */
    async generateEnhancedPlan(
        siteAnalysis: SiteAnalysisResult,
        contentUrls?: string[]
    ): Promise<ScrapingPlan> {
        logger.info(`Generating enhanced plan for ${siteAnalysis.url}`);

        const planId = this.generatePlanId(siteAnalysis.url);

        // Use content-aware list detection if content URLs provided
        let listSelector: string;
        let detailSelectors: Record<string, string>;

        if (contentUrls && contentUrls.length > 0) {
            const contentAwarePlan = await this.generateContentAwarePlan(
                siteAnalysis,
                contentUrls
            );
            listSelector = contentAwarePlan.listSelector;
            detailSelectors = contentAwarePlan.detailSelectors;
        } else {
            // Fallback to pattern-based detection
            const patternBasedPlan =
                this.generatePatternBasedPlan(siteAnalysis);
            listSelector = patternBasedPlan.listSelector;
            detailSelectors = patternBasedPlan.detailSelectors;
        }

        // Generate pagination selector if detected
        const paginationSelector = siteAnalysis.paginationInfo.detected
            ? siteAnalysis.paginationInfo.selector
            : undefined;

        // Create metadata
        const metadata: PlanMetadata = {
            domain: new URL(siteAnalysis.url).hostname,
            siteType: this.inferSiteType(siteAnalysis),
            language: this.detectLanguage(siteAnalysis.url),
            createdBy: "ai",
            successRate: 0,
            avgAccuracy: 0,
            robotsTxtCompliant: true, // Will be validated by legal compliance service
            gdprCompliant: true
        };

        // Create retry policy based on site complexity
        const retryPolicy: RetryPolicy = {
            maxAttempts: 3,
            backoffStrategy: "exponential",
            baseDelayMs: 1000,
            maxDelayMs: 30000,
            retryableErrors: [
                "TIMEOUT",
                "NETWORK_ERROR",
                "RATE_LIMITED",
                "SELECTOR_NOT_FOUND"
            ]
        };

        const plan: ScrapingPlan = {
            planId,
            version: 1,
            entryUrls: [siteAnalysis.url],
            listSelector,
            ...(paginationSelector && { paginationSelector }),
            detailSelectors,
            rateLimitMs: this.calculateRateLimit(siteAnalysis),
            retryPolicy,
            confidenceScore: siteAnalysis.confidence,
            metadata
        };

        logger.info(
            `Generated plan ${planId} with confidence ${siteAnalysis.confidence}`
        );
        return plan;
    }

    /**
     * Validate scraping plan accuracy using content examples
     * Requirement 1.4: Plan validation with content examples
     */
    async validatePlanWithContentExamples(
        plan: ScrapingPlan,
        contentUrls: string[]
    ): Promise<{ isValid: boolean; confidence: number; issues: string[] }> {
        logger.info(
            `Validating plan ${plan.planId} with ${contentUrls.length} content examples`
        );

        const issues: string[] = [];
        let validationScore = 0;

        try {
            // Analyze content patterns from examples
            const contentAnalysis =
                await this.contentPatternAnalyzer.analyzeContentPatterns(
                    contentUrls
                );

            // Check if list selector matches content containers
            const listSelectorValid = this.validateListSelector(
                plan.listSelector,
                contentAnalysis
            );
            if (listSelectorValid) {
                validationScore += 0.4;
            } else {
                issues.push(
                    `List selector "${plan.listSelector}" does not match content patterns`
                );
            }

            // Validate detail selectors against content patterns
            const detailSelectorValidation = this.validateDetailSelectors(
                plan.detailSelectors,
                contentAnalysis
            );
            validationScore += detailSelectorValidation.score * 0.6;
            issues.push(...detailSelectorValidation.issues);

            // Ensure minimum confidence for reasonable plans
            const confidence = Math.max(Math.min(validationScore, 1.0), 0.3);
            const isValid = confidence >= 0.7 && issues.length === 0;

            return { isValid, confidence, issues };
        } catch (error) {
            logger.error(`Plan validation failed: ${error}`);
            // Return a reasonable fallback confidence for basic validation
            return {
                isValid: false,
                confidence: 0.4, // Fallback confidence instead of 0
                issues: [`Validation failed: ${error}`]
            };
        }
    }

    // Private helper methods

    /**
     * Detect CMS archetype for template reuse
     * Requirement 9.3: Archetype detection for optimization
     */
    private detectCMSArchetype(html: string): CMSArchetype {
        const htmlLower = html.toLowerCase();

        for (const [cms, patterns] of Object.entries(this.CMS_PATTERNS)) {
            const matchCount = patterns.filter((pattern) =>
                htmlLower.includes(pattern.toLowerCase())
            ).length;

            // If any pattern matches, consider it detected (more lenient)
            if (matchCount > 0) {
                return cms as CMSArchetype;
            }
        }

        return "generic";
    }

    /**
     * Parse DOM structure for analysis
     */
    private parseDOMStructure(
        element: Element,
        depth = 0,
        path = ""
    ): DOMStructure {
        const tagName = element.tagName.toLowerCase();
        const className = element.className;
        const id = element.id;
        const attributes: Record<string, string> = {};

        // Extract relevant attributes
        for (let i = 0; i < element.attributes.length; i++) {
            const attr = element.attributes[i];
            if (
                ["class", "id", "role", "data-*"].some(
                    (pattern) =>
                        attr.name === pattern || attr.name.startsWith("data-")
                )
            ) {
                attributes[attr.name] = attr.value;
            }
        }

        let currentPath = path ? `${path} > ${tagName}` : tagName;
        if (className) {
            currentPath += `.${className.split(" ")[0]}`;
        }
        if (id) {
            currentPath += `#${id}`;
        }

        const children: DOMStructure[] = [];
        for (let i = 0; i < element.children.length; i++) {
            children.push(
                this.parseDOMStructure(
                    element.children[i],
                    depth + 1,
                    currentPath
                )
            );
        }

        return {
            tagName,
            className,
            id,
            attributes,
            textContent: element.textContent?.trim() || "",
            children,
            depth,
            path: currentPath
        };
    }

    /**
     * Detect common patterns in HTML structure
     */
    private async detectPatterns(
        html: string,
        domStructure: DOMStructure
    ): Promise<DetectedPattern[]> {
        const patterns: DetectedPattern[] = [];

        // Detect list patterns
        const listPatterns = this.detectListPatterns(html, domStructure);
        patterns.push(...listPatterns);

        // Detect table patterns
        const tablePatterns = this.detectTablePatterns(domStructure);
        patterns.push(...tablePatterns);

        // Detect card/article patterns
        const cardPatterns = this.detectCardPatterns(domStructure);
        patterns.push(...cardPatterns);

        // Detect navigation patterns
        const navPatterns = this.detectNavigationPatterns(domStructure);
        patterns.push(...navPatterns);

        return patterns;
    }

    private detectListPatterns(
        html: string,
        domStructure: DOMStructure
    ): DetectedPattern[] {
        const patterns: DetectedPattern[] = [];

        // Check for basic list structures
        const ulElements = this.findElementsByTag(domStructure, "ul");
        const olElements = this.findElementsByTag(domStructure, "ol");

        if (ulElements.length > 0) {
            patterns.push({
                type: "list",
                selector: "ul",
                confidence: 0.7,
                examples: ulElements.slice(0, 3).map((e) => e.path)
            });
        }

        if (olElements.length > 0) {
            patterns.push({
                type: "list",
                selector: "ol",
                confidence: 0.7,
                examples: olElements.slice(0, 3).map((e) => e.path)
            });
        }

        // Check for specific list patterns
        for (const pattern of this.LIST_PATTERNS) {
            if (
                html.includes(pattern) ||
                this.selectorExistsInDOM(pattern, domStructure)
            ) {
                patterns.push({
                    type: "list",
                    selector: pattern,
                    confidence: 0.8,
                    examples: [pattern]
                });
            }
        }

        return patterns;
    }

    private detectTablePatterns(domStructure: DOMStructure): DetectedPattern[] {
        const patterns: DetectedPattern[] = [];
        const tableElements = this.findElementsByTag(domStructure, "table");

        for (const table of tableElements) {
            // Look for tbody or direct tr children
            const tbodyElements = this.findElementsByTag(table, "tbody");
            const trElements = this.findElementsByTag(table, "tr");

            if (tbodyElements.length > 0 || trElements.length > 1) {
                // Has multiple rows
                patterns.push({
                    type: "table",
                    selector: table.path,
                    confidence: 0.9,
                    examples: [table.path]
                });
            }
        }

        return patterns;
    }

    private detectCardPatterns(domStructure: DOMStructure): DetectedPattern[] {
        const patterns: DetectedPattern[] = [];
        const cardSelectors = [".card", ".item", ".entry", ".post", ".article"];

        for (const selector of cardSelectors) {
            const elements = this.findElementsBySelector(
                domStructure,
                selector
            );
            if (elements.length >= 2) {
                // Multiple similar elements
                patterns.push({
                    type: "card",
                    selector,
                    confidence: 0.7,
                    examples: elements.slice(0, 3).map((e) => e.path)
                });
            }
        }

        return patterns;
    }

    private detectNavigationPatterns(
        domStructure: DOMStructure
    ): DetectedPattern[] {
        const patterns: DetectedPattern[] = [];
        const navElements = this.findElementsByTag(domStructure, "nav");

        for (const nav of navElements) {
            patterns.push({
                type: "navigation",
                selector: nav.path,
                confidence: 0.95,
                examples: [nav.path]
            });
        }

        return patterns;
    }

    /**
     * Identify list containers using content-aware detection
     * Requirement 1.3: Content-aware list item detection
     */
    private async identifyListContainers(
        html: string,
        domStructure: DOMStructure,
        contentAnalysis?: ContentPatternAnalysis | null
    ): Promise<ListContainer[]> {
        const containers: ListContainer[] = [];

        if (contentAnalysis) {
            // Use content-aware detection
            const contentContainers = await this.identifyContentAwareContainers(
                html,
                domStructure,
                contentAnalysis
            );
            containers.push(...contentContainers);
        }

        // Fallback to pattern-based detection
        const patternContainers =
            this.identifyPatternBasedContainers(domStructure);
        containers.push(...patternContainers);

        // Remove duplicates and sort by confidence
        const uniqueContainers = this.deduplicateContainers(containers);
        return uniqueContainers.sort((a, b) => b.confidence - a.confidence);
    }

    private async identifyContentAwareContainers(
        html: string,
        _domStructure: DOMStructure,
        contentAnalysis: ContentPatternAnalysis
    ): Promise<ListContainer[]> {
        const containers: ListContainer[] = [];

        // Find similar content on main page using content patterns
        for (const pattern of contentAnalysis.patterns) {
            const matches =
                await this.contentPatternAnalyzer.findSimilarContentOnMainPage(
                    html,
                    [pattern]
                );

            if (matches.length >= 2) {
                const listContainers =
                    await this.contentPatternAnalyzer.identifyListContainers(
                        html,
                        matches
                    );
                containers.push(...listContainers);
            }
        }

        return containers;
    }

    private identifyPatternBasedContainers(
        domStructure: DOMStructure
    ): ListContainer[] {
        const containers: ListContainer[] = [];

        // Look for common list container patterns
        const listElements = this.findElementsByTag(domStructure, "ul");
        const olElements = this.findElementsByTag(domStructure, "ol");
        const divContainers = this.findElementsBySelector(
            domStructure,
            ".items, .list, .content"
        );

        [...listElements, ...olElements, ...divContainers].forEach(
            (element) => {
                if (element.children.length >= 2) {
                    containers.push({
                        selector: element.path,
                        itemCount: element.children.length,
                        confidence: 0.6,
                        sampleItems: element.children
                            .slice(0, 3)
                            .map((child) => child.path),
                        excludeSelectors: []
                    });
                }
            }
        );

        // Also look for div containers with multiple similar children
        const allDivs = this.findElementsByTag(domStructure, "div");
        for (const div of allDivs) {
            if (div.children.length >= 2) {
                // Check if children have similar structure (same tag names)
                const childTags = div.children.map((child) => child.tagName);
                const uniqueTags = new Set(childTags);

                // If most children have the same tag, it's likely a container
                if (uniqueTags.size <= 2 && div.children.length >= 2) {
                    containers.push({
                        selector: div.path,
                        itemCount: div.children.length,
                        confidence: 0.5,
                        sampleItems: div.children
                            .slice(0, 3)
                            .map((child) => child.path),
                        excludeSelectors: []
                    });
                }
            }
        }

        return containers;
    }

    /**
     * Detect pagination patterns
     * Requirement 1.3: Pagination detection logic
     */
    private detectPagination(
        html: string,
        domStructure: DOMStructure
    ): PaginationInfo {
        // Check for pagination patterns in HTML
        for (const pattern of this.PAGINATION_PATTERNS) {
            if (html.includes(pattern)) {
                return {
                    detected: true,
                    selector: pattern,
                    type: this.inferPaginationType(pattern),
                    confidence: 0.8
                };
            }
        }

        // Check DOM structure for pagination elements
        const paginationElements = this.findPaginationInDOM(domStructure);
        if (paginationElements.length > 0) {
            const bestElement = paginationElements[0];
            return {
                detected: true,
                selector: bestElement.path,
                type: this.inferPaginationType(bestElement.path),
                confidence: 0.7
            };
        }

        return {
            detected: false,
            confidence: 0
        };
    }

    private findPaginationInDOM(domStructure: DOMStructure): DOMStructure[] {
        const paginationElements: DOMStructure[] = [];

        if (this.isPaginationElement(domStructure)) {
            paginationElements.push(domStructure);
        }

        for (const child of domStructure.children) {
            paginationElements.push(...this.findPaginationInDOM(child));
        }

        return paginationElements;
    }

    private isPaginationElement(element: DOMStructure): boolean {
        const paginationClasses = [
            "pagination",
            "pager",
            "page-numbers",
            "nav-links"
        ];
        const paginationText = ["next", "previous", "more", "page"];

        // Check class names
        if (element.className) {
            const classes = element.className.toLowerCase().split(" ");
            if (
                classes.some((cls) =>
                    paginationClasses.some((pageCls) => cls.includes(pageCls))
                )
            ) {
                return true;
            }
        }

        // Check text content
        if (element.textContent) {
            const text = element.textContent.toLowerCase();
            if (paginationText.some((pageText) => text.includes(pageText))) {
                return true;
            }
        }

        return false;
    }

    private inferPaginationType(
        selector: string
    ): "numbered" | "next-prev" | "load-more" {
        const selectorLower = selector.toLowerCase();

        if (selectorLower.includes("load") || selectorLower.includes("more")) {
            return "load-more";
        }
        if (selectorLower.includes("next") || selectorLower.includes("prev")) {
            return "next-prev";
        }
        return "numbered";
    }

    /**
     * Identify content areas (main, sidebar, etc.)
     */
    private identifyContentAreas(domStructure: DOMStructure): ContentArea[] {
        const areas: ContentArea[] = [];

        // Find main content area
        const mainElements = this.findElementsByTag(domStructure, "main");
        mainElements.forEach((element) => {
            areas.push({
                selector: element.path,
                type: "main",
                confidence: 0.95
            });
        });

        // Find header/footer
        const headerElements = this.findElementsByTag(domStructure, "header");
        const footerElements = this.findElementsByTag(domStructure, "footer");

        headerElements.forEach((element) => {
            areas.push({
                selector: element.path,
                type: "header",
                confidence: 0.9
            });
        });

        footerElements.forEach((element) => {
            areas.push({
                selector: element.path,
                type: "footer",
                confidence: 0.9
            });
        });

        // Find navigation
        const navElements = this.findElementsByTag(domStructure, "nav");
        navElements.forEach((element) => {
            areas.push({
                selector: element.path,
                type: "navigation",
                confidence: 0.85
            });
        });

        return areas;
    }

    /**
     * Generate content-aware scraping plan
     */
    private async generateContentAwarePlan(
        siteAnalysis: SiteAnalysisResult,
        contentUrls: string[]
    ): Promise<{
        listSelector: string;
        detailSelectors: Record<string, string>;
    }> {
        // Analyze content patterns
        const contentAnalysis =
            await this.contentPatternAnalyzer.analyzeContentPatterns(
                contentUrls
            );

        // Use the best list container from content analysis
        const bestContainer = siteAnalysis.listContainers[0];
        const listSelector = bestContainer
            ? bestContainer.selector
            : "article, .item, .entry";

        // Generate detail selectors based on content patterns
        const detailSelectors: Record<string, string> = {};

        if (contentAnalysis.contentVariations.length > 0) {
            const primaryVariation = contentAnalysis.contentVariations[0];
            Object.assign(detailSelectors, primaryVariation.selectors);
        }

        // Add fallback selectors
        detailSelectors.title =
            detailSelectors.title || "h1, h2, h3, .title, .heading";
        detailSelectors.description =
            detailSelectors.description ||
            "p, .description, .summary, .excerpt";
        detailSelectors.date =
            detailSelectors.date || ".date, time, .published, .created";
        detailSelectors.address =
            detailSelectors.address || ".address, .location, .venue";
        detailSelectors.phone =
            detailSelectors.phone || ".phone, .tel, .telephone";
        detailSelectors.email =
            detailSelectors.email || '.email, .mail, a[href^="mailto:"]';
        detailSelectors.website =
            detailSelectors.website || 'a[href^="http"], .website, .url';
        detailSelectors.images =
            detailSelectors.images || "img, .image, .photo";

        return { listSelector, detailSelectors };
    }

    /**
     * Generate pattern-based scraping plan (fallback)
     */
    private generatePatternBasedPlan(siteAnalysis: SiteAnalysisResult): {
        listSelector: string;
        detailSelectors: Record<string, string>;
    } {
        // Use detected patterns to generate selectors
        const listPatterns = siteAnalysis.patterns.filter(
            (p) => p.type === "list"
        );
        const listSelector =
            listPatterns.length > 0
                ? listPatterns[0].selector
                : "article, .item, .entry, .post";

        // Generate generic detail selectors based on archetype
        const detailSelectors = this.generateArchetypeSelectors(
            siteAnalysis.archetype
        );

        return { listSelector, detailSelectors };
    }

    private generateArchetypeSelectors(
        archetype: CMSArchetype
    ): Record<string, string> {
        const baseSelectors = {
            title: "h1, h2, h3, .title, .heading",
            description: "p, .description, .summary, .excerpt, .content",
            date: ".date, time, .published, .created",
            address: ".address, .location, .venue",
            phone: ".phone, .tel, .telephone",
            email: '.email, .mail, a[href^="mailto:"]',
            website: 'a[href^="http"], .website, .url',
            images: "img, .image, .photo"
        };

        // Customize selectors based on CMS archetype
        switch (archetype) {
            case "wordpress":
                return {
                    ...baseSelectors,
                    title: ".entry-title, .post-title, h1, h2",
                    description: ".entry-content, .post-content, .excerpt",
                    date: ".entry-date, .post-date, .published"
                };

            case "typo3":
                return {
                    ...baseSelectors,
                    title: ".tx-news-title, .content-header h1, h1",
                    description: ".tx-news-text, .bodytext, .content-text",
                    date: ".tx-news-datetime, .news-date"
                };

            case "drupal":
                return {
                    ...baseSelectors,
                    title: ".node-title, .field-name-title h1, h1",
                    description: ".field-name-body, .node-content, .field-item",
                    date: ".field-name-created, .submitted"
                };

            default:
                return baseSelectors;
        }
    }

    // Validation helper methods

    private validateListSelector(
        listSelector: string,
        contentAnalysis: ContentPatternAnalysis
    ): boolean {
        // Check if the list selector matches any of the identified content containers
        const hasMatch = contentAnalysis.listContainers.some(
            (container) =>
                container.selector === listSelector ||
                this.selectorsMatch(container.selector, listSelector)
        );

        // Also check if it's a reasonable generic selector
        const genericSelectors = [
            "article",
            ".item",
            ".entry",
            ".post",
            "li",
            "div"
        ];
        const isGenericSelector = genericSelectors.some((generic) =>
            listSelector.includes(generic)
        );

        return hasMatch || isGenericSelector;
    }

    private validateDetailSelectors(
        detailSelectors: Record<string, string>,
        contentAnalysis: ContentPatternAnalysis
    ): { score: number; issues: string[] } {
        const issues: string[] = [];
        let validSelectors = 0;
        const totalSelectors = Object.keys(detailSelectors).length;

        for (const [field, selector] of Object.entries(detailSelectors)) {
            const isValid = this.validateFieldSelector(
                field,
                selector,
                contentAnalysis
            );
            if (isValid) {
                validSelectors++;
            } else {
                // Don't add issues for reasonable generic selectors
                const isReasonableGeneric = this.isReasonableGenericSelector(
                    field,
                    selector
                );
                if (!isReasonableGeneric) {
                    issues.push(
                        `Selector for "${field}" may not match content patterns: ${selector}`
                    );
                } else {
                    validSelectors += 0.5; // Partial credit for generic selectors
                }
            }
        }

        const score =
            totalSelectors > 0 ? validSelectors / totalSelectors : 0.5;
        return { score, issues };
    }

    private validateFieldSelector(
        field: string,
        selector: string,
        contentAnalysis: ContentPatternAnalysis
    ): boolean {
        // Check if selector matches patterns in content variations
        return contentAnalysis.contentVariations.some((variation) => {
            const variationSelector = variation.selectors?.[field];
            return (
                variationSelector === selector ||
                (variationSelector &&
                    this.selectorsMatch(variationSelector, selector))
            );
        });
    }

    private selectorsMatch(selector1: string, selector2: string): boolean {
        // Simple selector matching - could be enhanced with CSS selector parsing
        const normalize = (s: string) => {
            if (!s || typeof s !== "string") return "";
            return s.replace(/\s+/g, " ").trim().toLowerCase();
        };
        return normalize(selector1) === normalize(selector2);
    }

    private isReasonableGenericSelector(
        field: string,
        selector: string
    ): boolean {
        const fieldMappings: Record<string, string[]> = {
            title: ["h1", "h2", "h3", ".title", ".heading"],
            description: [
                "p",
                ".description",
                ".summary",
                ".excerpt",
                ".content"
            ],
            date: [".date", "time", ".published", ".created"],
            address: [".address", ".location", ".venue"],
            phone: [".phone", ".tel", ".telephone"],
            email: [".email", ".mail", 'a[href^="mailto:"]'],
            website: ['a[href^="http"]', ".website", ".url"],
            images: ["img", ".image", ".photo"]
        };

        const reasonableSelectors = fieldMappings[field] || [];
        return reasonableSelectors.some(
            (reasonable) =>
                selector.includes(reasonable) || reasonable.includes(selector)
        );
    }

    // Utility helper methods

    private calculateAnalysisConfidence(
        patterns: DetectedPattern[],
        listContainers: ListContainer[],
        paginationInfo: PaginationInfo,
        contentAnalysis?: ContentPatternAnalysis | null
    ): number {
        let confidence = 0.2; // Lower base confidence

        // Pattern detection confidence (30%)
        const avgPatternConfidence =
            patterns.length > 0
                ? patterns.reduce((sum, p) => sum + p.confidence, 0) /
                  patterns.length
                : 0.3; // Lower default if no patterns
        confidence += avgPatternConfidence * 0.3;

        // List container confidence (40%)
        const avgContainerConfidence =
            listContainers.length > 0
                ? listContainers.reduce((sum, c) => sum + c.confidence, 0) /
                  listContainers.length
                : 0.2; // Lower default if no containers
        confidence += avgContainerConfidence * 0.4;

        // Pagination detection confidence (10%)
        confidence += paginationInfo.confidence * 0.1;

        // Content analysis confidence (20%)
        const contentConfidence = contentAnalysis
            ? contentAnalysis.confidence
            : 0.4;
        confidence += contentConfidence * 0.2;

        return Math.min(confidence, 1.0);
    }

    private calculateRateLimit(siteAnalysis: SiteAnalysisResult): number {
        // Base rate limit
        let rateLimit = 1000;

        // Adjust based on archetype
        switch (siteAnalysis.archetype) {
            case "wordpress":
            case "drupal":
                rateLimit = 1500; // Be more conservative with popular CMS
                break;
            case "typo3":
                rateLimit = 2000; // TYPO3 sites often have more complex caching
                break;
        }

        // Adjust based on confidence (lower confidence = more conservative)
        if (siteAnalysis.confidence < 0.7) {
            rateLimit *= 1.5;
        }

        return Math.round(rateLimit);
    }

    private inferSiteType(
        siteAnalysis: SiteAnalysisResult
    ): "municipal" | "news" | "government" {
        const url = siteAnalysis.url.toLowerCase();

        if (url.includes(".gov") || url.includes("government")) {
            return "government";
        }
        if (
            url.includes("news") ||
            url.includes("press") ||
            url.includes("media")
        ) {
            return "news";
        }
        return "municipal"; // Default for German municipal sites
    }

    private detectLanguage(url: string): string {
        const urlLower = url.toLowerCase();
        if (urlLower.includes(".de") || urlLower.includes("german")) {
            return "de";
        }
        return "en"; // Default to English
    }

    private generatePlanId(url: string): string {
        const domain = new URL(url).hostname.replace(/\./g, "-");
        const timestamp = Date.now();
        return `plan-${domain}-${timestamp}`;
    }

    // DOM utility methods

    private selectorExistsInDOM(
        selector: string,
        domStructure: DOMStructure
    ): boolean {
        // Simple check - in real implementation would use proper CSS selector matching
        return this.findElementsBySelector(domStructure, selector).length > 0;
    }

    private findElementsByTag(
        domStructure: DOMStructure,
        tagName: string
    ): DOMStructure[] {
        const elements: DOMStructure[] = [];

        if (domStructure.tagName === tagName) {
            elements.push(domStructure);
        }

        for (const child of domStructure.children) {
            elements.push(...this.findElementsByTag(child, tagName));
        }

        return elements;
    }

    private findElementsBySelector(
        domStructure: DOMStructure,
        selector: string
    ): DOMStructure[] {
        const elements: DOMStructure[] = [];

        // Simple selector matching - could be enhanced
        if (this.elementMatchesSelector(domStructure, selector)) {
            elements.push(domStructure);
        }

        for (const child of domStructure.children) {
            elements.push(...this.findElementsBySelector(child, selector));
        }

        return elements;
    }

    private elementMatchesSelector(
        element: DOMStructure,
        selector: string
    ): boolean {
        // Basic selector matching
        if (selector.startsWith(".")) {
            const className = selector.substring(1);
            return element.className?.includes(className) || false;
        }
        if (selector.startsWith("#")) {
            const id = selector.substring(1);
            return element.id === id;
        }
        return element.tagName === selector;
    }

    private deduplicateContainers(
        containers: ListContainer[]
    ): ListContainer[] {
        const seen = new Set<string>();
        return containers.filter((container) => {
            if (seen.has(container.selector)) {
                return false;
            }
            seen.add(container.selector);
            return true;
        });
    }
}
