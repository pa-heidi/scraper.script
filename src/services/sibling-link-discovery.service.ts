/**
 * Sibling Link Discovery Service (Refactored)
 * Discovers related/sibling links from example URLs using centralized LLM service
 * Requirements: Enhanced content URL discovery for better plan generation
 */

import { JSDOM } from "jsdom";
import { logger } from "../utils/logger";
import {
    getCentralizedLLMService,
    LLMRequest
} from "./centralized-llm.service";

export interface SiblingLinkResult {
    originalUrl: string;
    siblingLinks: string[];
    discoveryMethod:
        | "same-page"
        | "parent-page"
        | "category-page"
        | "search-results";
    confidence: number;
    metadata: {
        totalLinksFound: number;
        filteredLinks: number;
        patterns: string[];
        commonPath?: string;
        containerSignature?: string;
        paginationLinks?: string[];
        paginationNextSelector?: string; // NEW: Store the selector for next page
        contentLinkSelector?: string; // NEW: Store the selector for content links
        isPaginated?: boolean;
        totalPages?: number;
    };
}

export interface LinkDiscoveryOptions {
    maxSiblingLinks?: number;
    includeExternalLinks?: boolean;
    minSimilarityScore?: number;
    followParentPages?: boolean;
    searchForPatterns?: boolean;
    enableSamePageDiscovery?: boolean;
    enableParentPageDiscovery?: boolean;
    enableMainPageDiscovery?: boolean;
    useLLMDetection?: boolean;
    llmConfidenceThreshold?: number;
    examplePaginationUrl?: string;
    isPaginated?: boolean;
    detectPaginationPattern?: boolean;
}

export interface LLMContainerAnalysis {
    exampleUrlSelector: string;
    siblingContainerSelector: string;
    contentLinkSelector: string; // NEW: Selector to get all similar content links
    paginationNextSelector?: string; // NEW: Selector for "next page" button
    confidence: number;
    reasoning: string;
}

export class SiblingLinkDiscoveryService {
    private readonly DEFAULT_OPTIONS: LinkDiscoveryOptions = {
        maxSiblingLinks: 10,
        includeExternalLinks: false,
        minSimilarityScore: 0.6,
        followParentPages: true,
        searchForPatterns: true,
        enableSamePageDiscovery: false,
        enableParentPageDiscovery: false,
        enableMainPageDiscovery: true,
        useLLMDetection: process.env.USE_LLM_DETECTION !== "false",
        llmConfidenceThreshold: 0.7,
        detectPaginationPattern: true
    };

    private llmService = getCentralizedLLMService();

    constructor() {
        // Configure LLM service for link discovery tasks
        this.llmService.updateConfig({
            primaryProvider:
                (process.env.LLM_PRIMARY_PROVIDER as "openai" | "ollama") ||
                "openai",
            fallbackProvider:
                (process.env.LLM_FALLBACK_PROVIDER as "openai" | "ollama") ||
                "ollama",
            openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
            ollamaModel:
                process.env.OLLAMA_CODE_MODEL || "codellama:7b-code-q4_K_M",
            maxTokens: 4000,
            temperature: 0.1
        });
    }

    /**
     * Discover sibling links from an example URL using pre-fetched HTML content
     */
    async discoverSiblingLinksWithHtml(
        exampleUrl: string,
        mainPageUrl: string,
        html: string,
        options: LinkDiscoveryOptions = {}
    ): Promise<SiblingLinkResult> {
        const opts = { ...this.DEFAULT_OPTIONS, ...options };

        logger.info(
            `Discovering sibling links for: ${exampleUrl} using provided HTML`
        );
        logger.info(`Main page URL: ${mainPageUrl}`);

        // Check if html is undefined or null
        if (!html) {
            logger.error(`HTML content is undefined or null for ${exampleUrl}`);
            return {
                originalUrl: exampleUrl,
                siblingLinks: [],
                discoveryMethod: "same-page",
                confidence: 0,
                metadata: {
                    totalLinksFound: 0,
                    filteredLinks: 0,
                    patterns: []
                }
            };
        }

        logger.info(`HTML content size: ${html.length} characters`);

        try {
            // Step 1: Analyze the example URL structure
            const urlAnalysis = this.analyzeUrlStructure(
                exampleUrl,
                mainPageUrl
            );

            // Step 2: Use the provided HTML for main page discovery
            let discoveryResult: SiblingLinkResult | null = null;

            if (opts.enableMainPageDiscovery) {
                discoveryResult = await this.discoverFromMainPageWithHtml(
                    mainPageUrl,
                    exampleUrl,
                    html,
                    opts
                );
            }

            // Step 3: Fallback to other discovery methods if main page didn't work
            if (!discoveryResult || discoveryResult.siblingLinks.length === 0) {
                const discoveryPromises: Promise<SiblingLinkResult>[] = [];

                if (opts.enableSamePageDiscovery) {
                    discoveryPromises.push(
                        this.discoverFromSamePage(exampleUrl, opts)
                    );
                }

                if (opts.enableParentPageDiscovery) {
                    discoveryPromises.push(
                        this.discoverFromParentPage(
                            exampleUrl,
                            mainPageUrl,
                            opts
                        )
                    );
                }

                const discoveryResults =
                    await Promise.allSettled(discoveryPromises);

                // Find the best result
                let bestResult = discoveryResult;
                let bestConfidence = discoveryResult?.confidence || 0;

                for (const result of discoveryResults) {
                    if (
                        result.status === "fulfilled" &&
                        result.value &&
                        result.value.confidence > bestConfidence
                    ) {
                        bestResult = result.value;
                        bestConfidence = result.value.confidence;
                    }
                }

                discoveryResult = bestResult;
            }

            // Step 4: If no results found, return empty result
            if (!discoveryResult) {
                return {
                    originalUrl: exampleUrl,
                    siblingLinks: [],
                    discoveryMethod: "same-page",
                    confidence: 0,
                    metadata: {
                        totalLinksFound: 0,
                        filteredLinks: 0,
                        patterns: []
                    }
                };
            }

            // Step 5: Filter and rank the discovered links
            const rankedLinks = await this.rankSiblingLinks(
                discoveryResult.siblingLinks,
                exampleUrl,
                urlAnalysis,
                opts
            );

            // Step 6: Limit results
            const finalLinks = rankedLinks.slice(0, opts.maxSiblingLinks || 10);

            logger.info(
                `Discovered ${finalLinks.length} sibling links using shared HTML`,
                {
                    method: discoveryResult.discoveryMethod,
                    confidence: discoveryResult.confidence,
                    originalCount: discoveryResult.siblingLinks.length
                }
            );

            return {
                ...discoveryResult,
                siblingLinks: finalLinks,
                metadata: {
                    ...discoveryResult.metadata,
                    filteredLinks: finalLinks.length
                }
            };
        } catch (error) {
            logger.error(
                `Failed to discover sibling links for ${exampleUrl}:`,
                error
            );
            return {
                originalUrl: exampleUrl,
                siblingLinks: [],
                discoveryMethod: "same-page",
                confidence: 0,
                metadata: {
                    totalLinksFound: 0,
                    filteredLinks: 0,
                    patterns: []
                }
            };
        }
    }

    /**
     * Discover sibling links from main page using centralized LLM service
     */
    private async discoverFromMainPageWithHtml(
        mainPageUrl: string,
        exampleUrl: string,
        html: string,
        options: LinkDiscoveryOptions
    ): Promise<SiblingLinkResult> {
        logger.debug("Discovering links from main page using provided HTML");

        try {
            const dom = new JSDOM(html);
            const document = dom.window.document;

            // Step 1: Find the list container that contains the example URL using LLM
            const {
                container: listContainer,
                paginationLinks: llmPaginationLinks,
                llmAnalysis
            } = await this.findListContainerForUrlWithLLM(
                document,
                exampleUrl,
                mainPageUrl,
                options.examplePaginationUrl
            );

            let siblingLinks: string[] = [];
            let containerSignature: string | undefined;
            let confidence = 0;
            let paginationLinks: string[] = llmPaginationLinks || [];

            if (listContainer) {
                logger.debug(
                    "Found list container for example URL using LLM analysis"
                );

                // Step 2: Use LLM analysis to extract links with selectors
                if (llmAnalysis && (llmAnalysis.confidence || 0) > 0.7) {
                    logger.info(
                        `🎯 Using LLM analysis (confidence: ${llmAnalysis.confidence || 0})`
                    );
                    logger.debug(`🧠 LLM reasoning: ${llmAnalysis.reasoning}`);

                    let extractedLinks: string[] = [];

                    // Method 1: Use LLM-provided contentLinkSelector (primary method)
                    if (llmAnalysis.contentLinkSelector) {
                        logger.info(
                            `� Using LLM content link selector: ${llmAnalysis.contentLinkSelector}`
                        );

                        try {
                            // Use the content link selector to find all similar links in the container
                            const selectorElements = Array.from(
                                listContainer.querySelectorAll(
                                    llmAnalysis.contentLinkSelector
                                )
                            );
                            logger.info(
                                `🎯 Found ${selectorElements.length} elements matching content link selector`
                            );

                            const selectorLinks = selectorElements
                                .map((element) => {
                                    const href = element.getAttribute("href");
                                    return href
                                        ? this.resolveUrl(href, mainPageUrl)
                                        : null;
                                })
                                .filter(
                                    (link): link is string =>
                                        link !== null &&
                                        this.isValidLink(
                                            link,
                                            exampleUrl,
                                            options
                                        ) &&
                                        link !== exampleUrl
                                );

                            extractedLinks = Array.from(new Set(selectorLinks));
                            logger.debug(`All Extracted Links:`, {
                                extractedLinks
                            });
                            logger.info(
                                `✅ Content link selector extraction: ${extractedLinks.length} valid links`
                            );
                        } catch (error) {
                            logger.warn(
                                `⚠️ LLM content link selector failed: ${llmAnalysis.contentLinkSelector}`,
                                error
                            );
                        }
                    }

                    // Method 2: Fallback to exampleUrlSelector if contentLinkSelector didn't work
                    if (
                        extractedLinks.length === 0 &&
                        llmAnalysis.exampleUrlSelector
                    ) {
                        logger.info(
                            `🔄 Fallback to example URL selector: ${llmAnalysis.exampleUrlSelector}`
                        );

                        try {
                            const selectorElements = Array.from(
                                listContainer.querySelectorAll(
                                    llmAnalysis.exampleUrlSelector
                                )
                            );
                            logger.info(
                                `🎯 Found ${selectorElements.length} elements matching example URL selector`
                            );

                            const selectorLinks = selectorElements
                                .map((element) => {
                                    const href = element.getAttribute("href");
                                    return href
                                        ? this.resolveUrl(href, mainPageUrl)
                                        : null;
                                })
                                .filter(
                                    (link): link is string =>
                                        link !== null &&
                                        this.isValidLink(
                                            link,
                                            exampleUrl,
                                            options
                                        ) &&
                                        link !== exampleUrl
                                );

                            extractedLinks = Array.from(new Set(selectorLinks));
                            logger.info(
                                `✅ Example URL selector extraction: ${extractedLinks.length} valid links`
                            );
                        } catch (error) {
                            logger.warn(
                                `⚠️ LLM example URL selector failed: ${llmAnalysis.exampleUrlSelector}`,
                                error
                            );
                        }
                    }

                    // Method 3: If still no links, try broader container search with pattern matching
                    if (extractedLinks.length === 0) {
                        logger.info(
                            `🔄 Trying pattern-based extraction from container`
                        );

                        const allContainerLinks = Array.from(
                            listContainer.querySelectorAll("a[href]")
                        )
                            .map((a) => {
                                const href = a.getAttribute("href");
                                return href
                                    ? this.resolveUrl(href, mainPageUrl)
                                    : null;
                            })
                            .filter(
                                (link): link is string =>
                                    link !== null &&
                                    this.isValidLink(
                                        link,
                                        exampleUrl,
                                        options
                                    ) &&
                                    link !== exampleUrl
                            );

                        // Filter by URL pattern similarity
                        extractedLinks = allContainerLinks.filter((link) => {
                            const similarity = this.calculateUrlSimilarity(
                                link,
                                exampleUrl
                            );
                            const threshold = this.isGermanMunicipalPattern(
                                link,
                                exampleUrl
                            )
                                ? 0.5
                                : options.minSimilarityScore || 0.6;
                            return similarity >= threshold;
                        });

                        extractedLinks = Array.from(new Set(extractedLinks)); // Deduplicate
                        logger.info(
                            `✅ Pattern-based extraction: ${extractedLinks.length} valid links`
                        );
                    }

                    siblingLinks = extractedLinks;
                    confidence = llmAnalysis.confidence || 0.8;

                    logger.info(
                        `🎉 Final LLM-based result: ${siblingLinks.length} sibling links found`
                    );
                    if (siblingLinks.length > 0) {
                        logger.debug(
                            `🔗 Sample links:`,
                            siblingLinks.slice(0, 3)
                        );
                    }
                } else {
                    // Step 2 Fallback: Extract all sibling links from the container with deduplication
                    logger.info(
                        `🔄 Falling back to container-wide link extraction (LLM confidence: ${llmAnalysis?.confidence || 0})`
                    );

                    const allContainerLinks = Array.from(
                        listContainer.querySelectorAll("a[href]")
                    )
                        .map((a) => {
                            const href = a.getAttribute("href");
                            return href
                                ? this.resolveUrl(href, mainPageUrl)
                                : null;
                        })
                        .filter(
                            (link): link is string =>
                                link !== null &&
                                this.isValidLink(link, exampleUrl, options)
                        );

                    // Step 2.1: Deduplicate links (multiple links per content card pointing to same URL)
                    const uniqueContainerLinks = Array.from(
                        new Set(allContainerLinks)
                    );

                    logger.debug(
                        `Link deduplication: ${allContainerLinks.length} total links -> ${uniqueContainerLinks.length} unique links`
                    );

                    // Step 3: Filter out the example URL itself and similar links
                    siblingLinks = uniqueContainerLinks.filter((link) => {
                        if (link === exampleUrl) return false;
                        const similarity = this.calculateUrlSimilarity(
                            link,
                            exampleUrl
                        );
                        // Lower threshold for German municipal sites
                        const threshold = this.isGermanMunicipalPattern(
                            link,
                            exampleUrl
                        )
                            ? 0.5
                            : options.minSimilarityScore || 0.6;
                        return similarity >= threshold;
                    });

                    confidence = 0.6; // Lower confidence for fallback method
                }

                // Step 4: Generate container signature for caching
                containerSignature =
                    this.generateContainerSignature(listContainer);

                logger.debug(`Container analysis completed`, {
                    containerTag: listContainer.tagName,
                    containerClass: listContainer.className,
                    method:
                        (llmAnalysis?.confidence || 0) > 0.7
                            ? "LLM-provided"
                            : "container-extraction",
                    siblingLinks: siblingLinks.length,
                    paginationLinks: paginationLinks.length,
                    confidence
                });
            }

            // Step 5: Enhanced pagination detection if not found in container
            if (
                options.detectPaginationPattern &&
                paginationLinks.length === 0
            ) {
                logger.info(
                    "🔍 Container analysis complete, now searching for pagination outside container..."
                );
                const paginationResult = await this.detectPaginationWithLLM(
                    document,
                    mainPageUrl,
                    listContainer
                );
                paginationLinks = paginationResult.paginationLinks;

                // Update LLM analysis with pagination selector if found
                if (paginationResult.paginationNextSelector && llmAnalysis) {
                    llmAnalysis.paginationNextSelector =
                        paginationResult.paginationNextSelector;
                }
            }

            const patterns = this.identifyLinkPatterns(
                siblingLinks,
                exampleUrl
            );

            return {
                originalUrl: exampleUrl,
                siblingLinks,
                discoveryMethod: "category-page",
                confidence,
                metadata: {
                    totalLinksFound: siblingLinks.length,
                    filteredLinks: siblingLinks.length,
                    patterns,
                    containerSignature,
                    paginationLinks,
                    paginationNextSelector: llmAnalysis?.paginationNextSelector,
                    contentLinkSelector: llmAnalysis?.contentLinkSelector, // NEW: Add content link selector for plan generation
                    isPaginated: paginationLinks.length > 0,
                    totalPages:
                        paginationLinks.length > 0
                            ? this.estimateTotalPages(paginationLinks)
                            : undefined
                }
            };
        } catch (error) {
            logger.error("Error discovering from main page:", error);
            throw error;
        }
    }

    /**
     * Find list container using heuristic search first, then LLM enhancement
     */
    private async findListContainerForUrlWithLLM(
        document: Document,
        exampleUrl: string,
        mainPageUrl: string,
        paginationUrl?: string
    ): Promise<{
        container: Element | null;
        paginationLinks: string[];
        llmAnalysis?: LLMContainerAnalysis;
    }> {
        try {
            logger.info(
                "Starting container detection with heuristics first, then LLM enhancement..."
            );

            // Step 1: Heuristic search to find the example URL and its container
            const heuristicResult = await this.findContainerWithHeuristics(
                document,
                exampleUrl,
                mainPageUrl
            );

            let targetContainer: Element | null = null;
            let compressedHtml: string;

            if (heuristicResult.container) {
                logger.info(
                    "Heuristic container found, proceeding with LLM analysis",
                    {
                        containerTag: heuristicResult.container.tagName,
                        containerClass: heuristicResult.container.className
                    }
                );

                // Use the heuristically found container for focused LLM analysis
                targetContainer = heuristicResult.container;
                compressedHtml = this.compressHtmlForLLM(
                    heuristicResult.container.outerHTML,
                    true
                ); // focused compression
            } else {
                logger.info(
                    "Heuristic search failed, using full page LLM analysis"
                );
                // Fallback to full page analysis
                compressedHtml = this.compressHtmlForLLM(
                    document.documentElement.outerHTML,
                    false
                ); // full page compression
            }

            // Step 2: Build LLM prompt for container analysis (enhanced with heuristic context)
            const prompt = this.buildContainerAnalysisPrompt(
                exampleUrl,
                mainPageUrl,
                compressedHtml,
                paginationUrl,
                heuristicResult
            );

            // Step 3: Use centralized LLM service
            const llmRequest: LLMRequest = {
                prompt,
                systemMessage:
                    "You are an expert web scraping engineer. Analyze HTML structure to identify list containers and pagination elements. Respond with valid JSON only.",
                format: "json",
                temperature: 0.1,
                maxTokens: 2000
            };

            logger.info("Starting LLM container analysis...");
            logger.debug("Making LLM request for container analysis", {
                exampleUrl,
                htmlLength: compressedHtml.length,
                hasPaginationExample: !!paginationUrl,
                hasHeuristicContainer: !!targetContainer,
                heuristicConfidence: heuristicResult?.confidence || 0
            });

            const llmResponse = await this.llmService.generate(llmRequest);

            logger.info("LLM container analysis completed", {
                provider: llmResponse.provider,
                model: llmResponse.model,
                tokensUsed: llmResponse.tokensUsed,
                responseLength: llmResponse.content.length
            });

            // Step 4: Parse LLM response
            const analysis = this.parseLLMContainerResponse(
                llmResponse.content
            );

            // Step 4.1: Validate LLM selectors
            this.validateLLMSelectors(document, analysis, exampleUrl);

            // Step 5: Find the container using LLM-provided selector or heuristic fallback
            let container: Element | null = null;

            if (analysis.siblingContainerSelector) {
                try {
                    container = document.querySelector(
                        analysis.siblingContainerSelector
                    );
                    if (container) {
                        logger.debug(
                            `LLM found container using selector: ${analysis.siblingContainerSelector}`
                        );
                    }
                } catch (error) {
                    logger.warn(
                        `Invalid LLM container selector: ${analysis.siblingContainerSelector}`,
                        { error }
                    );
                }
            }

            // Fallback to heuristic result if LLM didn't find a container
            if (!container && targetContainer) {
                logger.debug(
                    "LLM analysis failed, using heuristic container as fallback"
                );
                container = targetContainer;
            }

            // Step 6: Extract pagination next link from LLM analysis
            const paginationLinks: string[] = [];
            if (analysis.paginationNextSelector) {
                try {
                    const nextElement = document.querySelector(
                        analysis.paginationNextSelector
                    );
                    if (nextElement) {
                        const nextHref = nextElement.getAttribute("href");
                        if (nextHref) {
                            const resolvedLink = this.resolveUrl(
                                nextHref,
                                mainPageUrl
                            );
                            if (resolvedLink && this.isValidUrl(resolvedLink)) {
                                paginationLinks.push(resolvedLink);
                                logger.debug(
                                    `✅ Found pagination next link: ${resolvedLink}`
                                );
                            }
                        }
                    }
                } catch (error) {
                    logger.warn(
                        `⚠️ Failed to extract pagination next link using selector: ${analysis.paginationNextSelector}`,
                        error
                    );
                }
            }

            return { container, paginationLinks, llmAnalysis: analysis };
        } catch (error) {
            logger.error("LLM container analysis failed", { error });
            return {
                container: null,
                paginationLinks: [],
                llmAnalysis: undefined
            };
        }
    }

    /**
     * Find container using heuristic search for the example URL (enhanced version from backup)
     */
    private async findContainerWithHeuristics(
        document: Document,
        exampleUrl: string,
        mainPageUrl: string
    ): Promise<{
        container: Element | null;
        exampleLinkElement: Element | null;
        containerPath: string;
        confidence: number;
        siblingCount: number;
    }> {
        try {
            // Step 1: Find the example URL link in the HTML
            const exampleLinkElement = this.findExampleUrlInDocument(
                document,
                exampleUrl,
                mainPageUrl
            );
            if (!exampleLinkElement) {
                logger.debug(
                    "Example URL not found in document during heuristic search"
                );
                // Debug: Show some sample URLs that were checked
                const anchors = Array.from(
                    document.querySelectorAll("a[href]")
                );
                const sampleAnchors = anchors.slice(0, 5);
                logger.debug("Sample anchors checked:");
                sampleAnchors.forEach((anchor, i) => {
                    const href = anchor.getAttribute("href");
                    if (href) {
                        const resolvedHref = this.resolveUrl(href, mainPageUrl);
                        const normalizedHref = this.normalizeUrl(resolvedHref);
                        logger.debug(
                            `  ${i + 1}. ${href} -> ${normalizedHref}`
                        );
                    }
                });
                return {
                    container: null,
                    exampleLinkElement: null,
                    containerPath: "",
                    confidence: 0,
                    siblingCount: 0
                };
            }
            logger.debug("Found example URL link element", {
                tagName: exampleLinkElement.tagName,
                href: exampleLinkElement.getAttribute("href"),
                text: exampleLinkElement.textContent?.substring(0, 100)
            });
            // Step 2: Find the container using enhanced logic from backup
            const containerResult = this.findListContainerForUrl(
                document,
                exampleUrl,
                mainPageUrl
            );
            if (containerResult) {
                const containerPath = this.generateElementPath(containerResult);
                const confidence = this.calculateContainerConfidence(
                    containerResult,
                    exampleUrl,
                    mainPageUrl
                );
                const siblingCount = this.countSiblingLinks(
                    containerResult,
                    exampleUrl,
                    mainPageUrl
                );
                logger.debug("Heuristic container analysis completed", {
                    containerTag: containerResult.tagName,
                    containerClass: containerResult.className,
                    containerPath,
                    confidence: confidence.toFixed(3),
                    siblingCount
                });
                return {
                    container: containerResult,
                    exampleLinkElement,
                    containerPath,
                    confidence,
                    siblingCount
                };
            }
            return {
                container: null,
                exampleLinkElement,
                containerPath: "",
                confidence: 0,
                siblingCount: 0
            };
        } catch (error) {
            logger.error("Error in heuristic container search:", error);
            return {
                container: null,
                exampleLinkElement: null,
                containerPath: "",
                confidence: 0,
                siblingCount: 0
            };
        }
    }

    /**
     * Find the list container that contains the example URL (enhanced version from backup)
     */
    private findListContainerForUrl(
        document: Document,
        exampleUrl: string,
        baseUrl: string
    ): Element | null {
        // Find all anchor elements
        const anchors = Array.from(document.querySelectorAll("a[href]"));
        // Find anchor matching example URL
        logger.debug(`Looking for example URL: ${exampleUrl}`);
        logger.debug(`Base URL: ${baseUrl}`);
        logger.debug(`Total anchors to check: ${anchors.length}`);
        const matchingAnchor = anchors.find((a) => {
            const anchor = a as HTMLAnchorElement;
            const href = anchor.getAttribute("href");
            if (!href) return false;
            const resolvedHref = this.resolveUrl(href, baseUrl);
            const normalizedHref = this.normalizeUrl(resolvedHref);
            const normalizedExample = this.normalizeUrl(exampleUrl);
            const matches = normalizedHref === normalizedExample;
            if (matches) {
                logger.debug(
                    `Found matching anchor: ${href} -> ${resolvedHref} -> ${normalizedHref}`
                );
            }
            return matches;
        }) as HTMLAnchorElement | undefined;
        if (!matchingAnchor) {
            logger.debug(
                "Example URL not found in main page, falling back to pattern-based discovery"
            );
            return null;
        }
        logger.debug("Found matching anchor for example URL");
        // Traverse up to find list container
        let current = matchingAnchor.parentElement;
        let bestContainer: Element | null = null;
        let bestScore = 0;
        let containerCount = 0;
        logger.debug(`Starting container traversal from matching anchor`);
        while (current) {
            containerCount++;
            logger.debug(
                `Checking container ${containerCount}: ${current.tagName.toLowerCase()}${current.className ? "." + current.className.split(" ").join(".") : ""}`
            );
            // Check if this is a list container
            if (this.isListContainer(current)) {
                logger.debug(`  ✅ Is list container`);
                // Calculate a score for this container based on content link density and specificity
                const containerScore = this.calculateContainerScore(
                    current,
                    exampleUrl,
                    baseUrl
                );
                logger.debug(
                    `  📊 Container score: ${containerScore.toFixed(3)}`
                );
                // Only consider containers with a reasonable number of content links (deduplicated)
                const allLinksInContainer = Array.from(
                    current.querySelectorAll("a[href]")
                )
                    .map((a) => {
                        const anchor = a as HTMLAnchorElement;
                        const href = anchor.getAttribute("href");
                        const text = anchor.textContent?.trim() || "";
                        return href
                            ? { href: this.resolveUrl(href, baseUrl), text }
                            : null;
                    })
                    .filter(
                        (link): link is { href: string; text: string } =>
                            link !== null
                    )
                    .filter((link) => this.isContentLink(link.href, link.text));

                // Deduplicate content links by URL
                const linksInContainer = Array.from(
                    new Map(
                        allLinksInContainer.map((link) => [link.href, link])
                    ).values()
                );
                logger.debug(
                    `  🔗 Content links in container: ${linksInContainer.length}`
                );
                // Prefer containers with 3-100 content links (not too few, not too many)
                if (
                    linksInContainer.length >= 3 &&
                    linksInContainer.length <= 100
                ) {
                    logger.debug(
                        `  ✅ Container has reasonable number of content links (${linksInContainer.length})`
                    );
                    if (containerScore > bestScore) {
                        bestScore = containerScore;
                        bestContainer = current;
                        logger.debug(
                            `  🏆 New best container with score ${containerScore.toFixed(3)}`
                        );
                    }
                } else {
                    logger.debug(
                        `  ❌ Container has too few/too many content links (${linksInContainer.length})`
                    );
                }
            } else {
                logger.debug(`  ❌ Not a list container`);
            }
            current = current.parentElement;
            // Stop at body to avoid infinite loops
            if (current && current.tagName.toLowerCase() === "body") {
                logger.debug(`Reached body element, stopping traversal`);
                break;
            }
        }
        logger.debug(
            `Container traversal complete. Found ${containerCount} containers, best score: ${bestScore.toFixed(3)}`
        );
        if (bestContainer) {
            logger.debug(
                `Returning best container: ${bestContainer.tagName.toLowerCase()}${bestContainer.className ? "." + bestContainer.className.split(" ").join(".") : ""}`
            );
        } else {
            logger.debug(`No suitable container found`);
        }
        return bestContainer;
    }

    /**
     * Find the example URL link element in the document
     */
    private findExampleUrlInDocument(
        document: Document,
        exampleUrl: string,
        mainPageUrl: string
    ): Element | null {
        // Get all links in the document
        const allLinks = Array.from(document.querySelectorAll("a[href]"));

        for (const link of allLinks) {
            const href = link.getAttribute("href");
            if (!href) continue;

            // Resolve relative URLs
            const resolvedHref = this.resolveUrl(href, mainPageUrl);

            // Check for exact match
            if (resolvedHref === exampleUrl) {
                return link;
            }

            // Check for partial matches (same path, different query params)
            try {
                const exampleUrlParsed = new URL(exampleUrl);
                const resolvedHrefParsed = new URL(resolvedHref);

                if (
                    exampleUrlParsed.hostname === resolvedHrefParsed.hostname &&
                    exampleUrlParsed.pathname === resolvedHrefParsed.pathname
                ) {
                    return link;
                }
            } catch (error) {
                // Invalid URL, continue
            }
        }

        return null;
    }

    /**
     * Find the container element that holds the example link and similar links
     */
    private findContainerForElement(
        exampleElement: Element,
        document: Document,
        mainPageUrl: string
    ): {
        container: Element | null;
        path: string;
        confidence: number;
        siblingCount: number;
    } {
        let currentElement = exampleElement.parentElement;
        let bestContainer: Element | null = null;
        let bestScore = 0;
        let bestPath = "";
        let bestSiblingCount = 0;

        // Traverse up the DOM tree to find the best container
        while (currentElement && currentElement !== document.documentElement) {
            const score = this.evaluateContainerCandidate(
                currentElement,
                exampleElement,
                mainPageUrl
            );

            if (score.totalScore > bestScore) {
                bestScore = score.totalScore;
                bestContainer = currentElement;
                bestPath = this.generateElementPath(currentElement);
                bestSiblingCount = score.siblingLinkCount;
            }

            currentElement = currentElement.parentElement;
        }

        return {
            container: bestContainer,
            path: bestPath,
            confidence: bestScore,
            siblingCount: bestSiblingCount
        };
    }

    /**
     * Evaluate how good a container candidate is
     */
    private evaluateContainerCandidate(
        container: Element,
        exampleElement: Element,
        mainPageUrl: string
    ): {
        totalScore: number;
        siblingLinkCount: number;
        structureScore: number;
        contentScore: number;
    } {
        let structureScore = 0;
        let contentScore = 0;
        let siblingLinkCount = 0;

        // Count sibling links in this container
        const allLinks = Array.from(container.querySelectorAll("a[href]"));
        const validLinks = allLinks.filter((link) => {
            const href = link.getAttribute("href");
            if (!href) return false;

            const resolvedHref = this.resolveUrl(href, mainPageUrl);
            return this.isValidUrl(resolvedHref) && link !== exampleElement;
        });

        siblingLinkCount = validLinks.length;

        // Structure scoring
        if (siblingLinkCount >= 2) structureScore += 0.3;
        if (siblingLinkCount >= 5) structureScore += 0.2;
        if (siblingLinkCount >= 10) structureScore += 0.1;

        // Container type scoring
        const tagName = container.tagName.toLowerCase();
        const className = container.className.toLowerCase();

        if (["ul", "ol"].includes(tagName)) structureScore += 0.2;
        if (["div", "section", "article"].includes(tagName))
            structureScore += 0.1;

        // Class name indicators
        const listIndicators = [
            "list",
            "items",
            "container",
            "grid",
            "news",
            "articles",
            "posts",
            "teaser"
        ];
        if (listIndicators.some((indicator) => className.includes(indicator))) {
            structureScore += 0.2;
        }

        // Content similarity scoring
        const exampleHref = exampleElement.getAttribute("href");
        if (exampleHref) {
            const similarLinks = validLinks.filter((link) => {
                const href = link.getAttribute("href");
                if (!href) return false;

                const resolvedHref = this.resolveUrl(href, mainPageUrl);
                const exampleResolved = this.resolveUrl(
                    exampleHref,
                    mainPageUrl
                );

                return (
                    this.calculateUrlSimilarity(resolvedHref, exampleResolved) >
                    0.5
                );
            });

            const similarityRatio =
                similarLinks.length / Math.max(validLinks.length, 1);
            contentScore = similarityRatio * 0.4;
        }

        const totalScore = structureScore + contentScore;

        return {
            totalScore,
            siblingLinkCount,
            structureScore,
            contentScore
        };
    }

    /**
     * Generate a CSS selector path for an element
     */
    private generateElementPath(element: Element): string {
        const parts: string[] = [];
        let current: Element | null = element;
        const document = element.ownerDocument;

        while (current && current !== document?.documentElement) {
            let selector = current.tagName.toLowerCase();

            if (current.id) {
                selector += `#${current.id}`;
                parts.unshift(selector);
                break; // ID is unique, we can stop here
            }

            if (current.className) {
                const classes = current.className
                    .trim()
                    .split(/\s+/)
                    .slice(0, 2); // Limit to first 2 classes
                if (classes.length > 0) {
                    selector += "." + classes.join(".");
                }
            }

            parts.unshift(selector);
            current = current.parentElement;
        }

        return parts.join(" > ");
    }

    /**
     * Build prompt for LLM container analysis (enhanced with heuristic context)
     */
    private buildContainerAnalysisPrompt(
        exampleUrl: string,
        mainPageUrl: string,
        html: string,
        paginationUrl?: string,
        heuristicResult?: {
            container: Element | null;
            exampleLinkElement: Element | null;
            containerPath: string;
            confidence: number;
            siblingCount: number;
        }
    ): string {
        let heuristicContext = "";
        if (heuristicResult && heuristicResult.container) {
            heuristicContext = `
HEURISTIC ANALYSIS RESULTS:
- Found container: ${heuristicResult.containerPath}
- Container confidence: ${heuristicResult.confidence.toFixed(2)}
- Sibling links found: ${heuristicResult.siblingCount}
- Example URL was located in the HTML

The heuristic search has already identified a likely container. Please validate and enhance this analysis.
`;
        } else {
            heuristicContext = `
HEURISTIC ANALYSIS RESULTS:
- No container found by heuristic search
- Example URL may not be present in the HTML
- Full page analysis required

Please perform comprehensive analysis to find similar content patterns.
`;
        }

        const prompt = `
Analyze this HTML to find the list container that holds links similar to the example URL.

Main Page URL: ${mainPageUrl}
Example Content URL: ${exampleUrl}
${paginationUrl ? `Example Pagination URL: ${paginationUrl}` : ""}

${heuristicContext}

HTML Content:
${html}

Find:
1. The CSS selector for the container that holds multiple content items similar to the example URL
2. A CSS selector that can extract the PRIMARY/MAIN link from each content item (ONE unique link per item)
3. A CSS selector for the "next page" button/link for pagination (if any)

CRITICAL REQUIREMENTS:
- contentLinkSelector should target the MAIN/PRIMARY link of each content item (usually title link)
- Avoid selectors that pick up multiple links per content item (image links, button links, etc.)
- Exclude pagination, navigation, and menu links from content selectors
- Ensure each content item contributes only ONE unique link to avoid duplicates
- Focus on providing SELECTORS that can be used to extract content, not the actual URLs

Respond with JSON:
{
  "exampleUrlSelector": "CSS selector that would match the specific example URL link in the HTML",
  "siblingContainerSelector": "CSS selector for the parent container holding similar content items",
  "contentLinkSelector": "CSS selector that matches the PRIMARY/MAIN link from each content item (ONE unique link per item, usually title link or main link)",
  "paginationNextSelector": "CSS selector for the 'next page' button/link (like 'Next', '>', 'Weiter', etc.) - leave empty if no pagination",
  "confidence": 0.85,
  "reasoning": "Explanation of analysis and selector choices, especially why the contentLinkSelector targets the main link"
}

CRITICAL SELECTOR REQUIREMENTS:
- ALL selectors MUST be valid CSS syntax (no invalid characters like #[9])
- contentLinkSelector should select the PRIMARY/MAIN link from each content item (ONE per item)
- Avoid selectors that return multiple links per content item
- Use descendant selectors to target specific links within content items
- Ensure contentLinkSelector excludes pagination links even if they're in the same container

VALID SELECTOR EXAMPLES FOR UNIQUE CONTENT LINKS:
- If content links are in ".event-item" divs with title links: use ".event-item h2 a" or ".event-item .title a" for contentLinkSelector
- If content links are in "article" tags with header links: use "article header a" or "article h3 a" for contentLinkSelector
- If content links are in ".teaserblock_xs" with specific link class: use ".teaserblock_xs .main-link" for contentLinkSelector
- If content is in ".entries" with title links: use ".entries .item h2 a" or ".entries .title-link" for contentLinkSelector
- For pagination: use "a[title*='next']", ".pagination .next", ".pager .next" etc.

IMPORTANT SELECTOR STRATEGY:
- Target the PRIMARY/MAIN link within each content item (usually title link or designated main link)
- Avoid generic "a" selectors that pick up ALL links (images, buttons, etc.)
- Exclude pagination links by being specific about content structure
- Prefer title links, header links, or links with specific classes like .main-link, .title-link

INVALID SELECTORS TO AVOID:
- ".event-item a" (too broad - picks up image links, button links, etc.)
- "div.entries#[9]" (invalid syntax with #[9])
- "div:nth-child(9)" (too specific, won't work for all pages)
- Just container names without targeting specific links

The contentLinkSelector should target the MAIN/PRIMARY link of each content item to ensure uniqueness and avoid auxiliary links.

Focus on finding containers with multiple similar CONTENT items, and identify the primary link within each item.

USAGE PATTERN:
The contentLinkSelector will be used as: container.querySelectorAll(contentLinkSelector)
This means it should work within the siblingContainerSelector scope to find the main link of each content item.

EXAMPLE ANALYSIS:
If you see content items with structure like:
- Container div with class "events-list" containing multiple articles
- Each article has class "event-item" with an image, title link in h2, description, and auxiliary links
- The main content link is in the h2 element within each article

Then the selectors should be:
- siblingContainerSelector: ".events-list" (the container holding all items)
- contentLinkSelector: ".event-item h2 a" (gets primary link from each item, not auxiliary links)

${heuristicResult?.container ? "Validate the heuristically found container and enhance the analysis." : "Perform comprehensive search since heuristics failed."}
`;
        console.log(prompt);
        return prompt;
    }

    /**
     * Validate LLM selectors against the actual DOM
     */
    private validateLLMSelectors(
        document: Document,
        analysis: LLMContainerAnalysis,
        exampleUrl: string
    ): void {
        logger.debug(`🔍 Validating LLM selectors...`);

        // Test container selector
        if (analysis.siblingContainerSelector) {
            try {
                const containerElements = document.querySelectorAll(
                    analysis.siblingContainerSelector
                );
                logger.debug(
                    `📦 Container selector "${analysis.siblingContainerSelector}" found ${containerElements.length} elements`
                );
            } catch (error) {
                logger.warn(
                    `❌ Invalid container selector: ${analysis.siblingContainerSelector}`,
                    error
                );
            }
        }

        // Test example URL selector
        if (analysis.exampleUrlSelector) {
            try {
                const exampleElements = document.querySelectorAll(
                    analysis.exampleUrlSelector
                );
                logger.debug(
                    `🎯 Example URL selector "${analysis.exampleUrlSelector}" found ${exampleElements.length} elements`
                );

                // Check if any of these elements actually link to the example URL
                let foundExampleUrl = false;
                for (const element of Array.from(exampleElements)) {
                    const href = element.getAttribute("href");
                    if (href) {
                        const resolvedHref = this.resolveUrl(
                            href,
                            document.location?.href || ""
                        );
                        if (resolvedHref === exampleUrl) {
                            foundExampleUrl = true;
                            break;
                        }
                    }
                }
                logger.debug(
                    `🔗 Example URL selector ${foundExampleUrl ? "DOES" : "DOES NOT"} match the actual example URL`
                );
            } catch (error) {
                logger.warn(
                    `❌ Invalid example URL selector: ${analysis.exampleUrlSelector}`,
                    error
                );
            }
        }

        // Test content link selector
        if (analysis.contentLinkSelector) {
            try {
                const contentElements = document.querySelectorAll(
                    analysis.contentLinkSelector
                );
                logger.debug(
                    `🔗 Content link selector "${analysis.contentLinkSelector}" found ${contentElements.length} elements`
                );

                // Show sample hrefs
                if (contentElements.length > 0) {
                    const sampleHrefs = Array.from(contentElements)
                        .slice(0, 3)
                        .map((el) => el.getAttribute("href"))
                        .filter(Boolean);
                    logger.debug(`📋 Sample content links:`, sampleHrefs);
                }
            } catch (error) {
                logger.warn(
                    `❌ Invalid content link selector: ${analysis.contentLinkSelector}`,
                    error
                );
            }
        }

        // Test pagination next selector
        if (analysis.paginationNextSelector) {
            try {
                const paginationElements = document.querySelectorAll(
                    analysis.paginationNextSelector
                );
                logger.debug(
                    `📄 Pagination next selector "${analysis.paginationNextSelector}" found ${paginationElements.length} elements`
                );

                if (paginationElements.length > 0) {
                    const nextHref = paginationElements[0].getAttribute("href");
                    logger.debug(`➡️ Next page link: ${nextHref}`);
                }
            } catch (error) {
                logger.warn(
                    `❌ Invalid pagination next selector: ${analysis.paginationNextSelector}`,
                    error
                );
            }
        }
    }

    /**
     * Parse LLM container analysis response
     */
    private parseLLMContainerResponse(content: string): LLMContainerAnalysis {
        try {
            const parsed = JSON.parse(content);

            const analysis = {
                exampleUrlSelector: parsed.exampleUrlSelector || "",
                siblingContainerSelector: parsed.siblingContainerSelector || "",
                contentLinkSelector: parsed.contentLinkSelector || "",
                paginationNextSelector: parsed.paginationNextSelector || "",
                confidence: parsed.confidence || 0.5,
                reasoning: parsed.reasoning || "LLM analysis completed"
            };

            // Debug logging for LLM analysis
            logger.debug(`🧠 LLM Analysis Results:`, {
                exampleUrlSelector: analysis.exampleUrlSelector,
                siblingContainerSelector: analysis.siblingContainerSelector,
                contentLinkSelector: analysis.contentLinkSelector,
                paginationNextSelector: analysis.paginationNextSelector,
                confidence: analysis.confidence,
                reasoning: analysis.reasoning
            });

            return analysis;
        } catch (error) {
            logger.warn("Failed to parse LLM container response", { error });

            return {
                exampleUrlSelector: "",
                siblingContainerSelector: "",
                contentLinkSelector: "",
                paginationNextSelector: "",
                confidence: 0.3,
                reasoning: "Failed to parse LLM response"
            };
        }
    }

    /**
     * Compress HTML for LLM analysis - truncate text content while preserving structure
     */
    private compressHtmlForLLM(html: string, focused: boolean = false): string {
        // Remove scripts, styles, comments, SVGs, and inline CSS
        let compressed = html
            .replace(/<!--[\s\S]*?-->/g, "") // Remove HTML comments
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "") // Remove script tags
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "") // Remove style tags
            .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, "") // Remove SVG elements
            .replace(/\sstyle\s*=\s*"[^"]*"/gi, "") // Remove inline style attributes
            .replace(/\sstyle\s*=\s*'[^']*'/gi, "") // Remove inline style attributes (single quotes)
            .replace(/\s+/g, " ") // Normalize whitespace
            .replace(/>\s+</g, "><") // Remove whitespace between tags
            .trim();

        // Remove verbose data attributes and unnecessary attributes
        compressed = this.removeVerboseAttributes(compressed);

        // Truncate text content within common tags while preserving HTML structure
        compressed = this.truncateTextContent(compressed, focused);

        return compressed;
    }

    /**
     * Remove verbose data attributes and unnecessary attributes while keeping essential ones
     */
    private removeVerboseAttributes(html: string): string {
        return (
            html
                // Remove verbose data attributes (like data-teasertext-*, data-ionas4-*, etc.)
                .replace(/\s+data-teasertext-[^=]*="[^"]*"/gi, "")
                .replace(/\s+data-ionas4-[^=]*="[^"]*"/gi, "")
                .replace(/\s+data-more="[^"]*"/gi, "")
                .replace(/\s+data-translatable[^=]*="[^"]*"/gi, "")

                // Remove image sources and alt text (keep img tags for structure)
                .replace(/\s+src="[^"]*"/gi, "")
                .replace(/\s+srcset="[^"]*"/gi, "")
                .replace(/\s+alt="[^"]*"/gi, "")
                .replace(/\s+title="[^"]*"/gi, "")

                // Remove other verbose attributes
                .replace(/\s+aria-label="[^"]*"/gi, "")
                .replace(/\s+aria-describedby="[^"]*"/gi, "")
                .replace(/\s+role="[^"]*"/gi, "")
                .replace(/\s+tabindex="[^"]*"/gi, "")

                // Remove tracking and analytics attributes
                .replace(/\s+data-track[^=]*="[^"]*"/gi, "")
                .replace(/\s+data-analytics[^=]*="[^"]*"/gi, "")
                .replace(/\s+data-gtm[^=]*="[^"]*"/gi, "")

                // Remove empty spans and paragraphs with no meaningful content
                .replace(/<span[^>]*>\s*<\/span>/gi, "")
                .replace(/<p[^>]*>\s*<span[^>]*>\s*<\/span>\s*<\/p>/gi, "")

                // Clean up multiple spaces that might be created
                .replace(/\s+/g, " ")
                .replace(/\s+>/g, ">")
                .replace(/>\s+/g, ">")
        );
    }

    /**
     * Truncate text content within HTML tags while preserving structure and CSS classes
     */
    private truncateTextContent(html: string, focused: boolean): string {
        const maxTextLength = focused ? 100 : 150; // Max characters per text node
        const maxTitleLength = focused ? 80 : 120; // Max characters for titles

        // Truncate content within common text-heavy tags
        let processed = html
            // Truncate title content (h1, h2, h3, etc.)
            .replace(
                /<(h[1-6][^>]*)>([^<]{1,}?)<\/h[1-6]>/gi,
                (match, openTag, content) => {
                    const truncated =
                        content.length > maxTitleLength
                            ? content.substring(0, maxTitleLength) + "..."
                            : content;
                    return `<${openTag}>${truncated}</h${openTag.match(/h([1-6])/)?.[1] || "1"}>`;
                }
            )

            // Truncate paragraph content
            .replace(
                /<(p[^>]*)>([^<]{1,}?)<\/p>/gi,
                (match, openTag, content) => {
                    const truncated =
                        content.length > maxTextLength
                            ? content.substring(0, maxTextLength) + "..."
                            : content;
                    return `<${openTag}>${truncated}</p>`;
                }
            )

            // Truncate span content
            .replace(
                /<(span[^>]*)>([^<]{1,}?)<\/span>/gi,
                (match, openTag, content) => {
                    const truncated =
                        content.length > maxTextLength
                            ? content.substring(0, maxTextLength) + "..."
                            : content;
                    return `<${openTag}>${truncated}</span>`;
                }
            )

            // Truncate div text content (but preserve nested HTML)
            .replace(
                /<(div[^>]*)>([^<]{50,}?)<\/div>/gi,
                (match, openTag, content) => {
                    // Only truncate if it's pure text content (no nested tags)
                    if (!content.includes("<")) {
                        const truncated =
                            content.length > maxTextLength
                                ? content.substring(0, maxTextLength) + "..."
                                : content;
                        return `<${openTag}>${truncated}</div>`;
                    }
                    return match; // Keep as-is if it contains nested HTML
                }
            )

            // Truncate link text content
            .replace(
                /<(a[^>]*)>([^<]{1,}?)<\/a>/gi,
                (match, openTag, content) => {
                    const truncated =
                        content.length > maxTextLength
                            ? content.substring(0, maxTextLength) + "..."
                            : content;
                    return `<${openTag}>${truncated}</a>`;
                }
            )

            // Truncate list item content
            .replace(
                /<(li[^>]*)>([^<]{1,}?)<\/li>/gi,
                (match, openTag, content) => {
                    const truncated =
                        content.length > maxTextLength
                            ? content.substring(0, maxTextLength) + "..."
                            : content;
                    return `<${openTag}>${truncated}</li>`;
                }
            )

            // Truncate table cell content
            .replace(
                /<(td[^>]*)>([^<]{1,}?)<\/td>/gi,
                (match, openTag, content) => {
                    const truncated =
                        content.length > maxTextLength
                            ? content.substring(0, maxTextLength) + "..."
                            : content;
                    return `<${openTag}>${truncated}</td>`;
                }
            )

            // Truncate table header content
            .replace(
                /<(th[^>]*)>([^<]{1,}?)<\/th>/gi,
                (match, openTag, content) => {
                    const truncated =
                        content.length > maxTextLength
                            ? content.substring(0, maxTextLength) + "..."
                            : content;
                    return `<${openTag}>${truncated}</th>`;
                }
            );

        return processed;
    }

    /**
     * Calculate a score for a container to determine if it's the best content list container
     */
    private calculateContainerScore(
        container: Element,
        exampleUrl: string,
        baseUrl: string
    ): number {
        let score = 0;
        // Get all content links in this container with deduplication
        const allContentLinks = Array.from(
            container.querySelectorAll("a[href]")
        )
            .map((a) => {
                const anchor = a as HTMLAnchorElement;
                const href = anchor.getAttribute("href");
                const text = anchor.textContent?.trim() || "";
                return href
                    ? { href: this.resolveUrl(href, baseUrl), text }
                    : null;
            })
            .filter(
                (link): link is { href: string; text: string } => link !== null
            )
            .filter((link) => this.isContentLink(link.href, link.text));

        // Deduplicate by URL (multiple links per content card)
        const uniqueContentLinks = Array.from(
            new Map(allContentLinks.map((link) => [link.href, link])).values()
        );
        const contentLinks = uniqueContentLinks.map((link) => link.href);
        // Score based on content link density (prefer containers with good content link ratio)
        const allLinks = Array.from(
            container.querySelectorAll("a[href]")
        ).length;
        const contentLinkRatio =
            allLinks > 0 ? contentLinks.length / allLinks : 0;
        // Higher score for better content link ratio (0.3-0.8 is ideal)
        if (contentLinkRatio >= 0.3 && contentLinkRatio <= 0.8) {
            score += contentLinkRatio * 0.4;
        } else if (contentLinkRatio > 0.8) {
            // Too high ratio might indicate it's too broad (like entire page)
            score += 0.2;
        }
        // Score based on container specificity
        const tagName = container.tagName.toLowerCase();
        const className = container.className.toLowerCase();
        const id = container.id.toLowerCase();
        // Prefer specific content containers
        const contentKeywords = [
            "content",
            "news",
            "article",
            "list",
            "items",
            "entries",
            "posts"
        ];
        const hasContentKeyword = contentKeywords.some(
            (keyword) => className.includes(keyword) || id.includes(keyword)
        );
        if (hasContentKeyword) {
            score += 0.3;
        }
        // Prefer semantic HTML elements
        if (["main", "article", "section"].includes(tagName)) {
            score += 0.2;
        } else if (["ul", "ol"].includes(tagName)) {
            score += 0.15;
        } else if (tagName === "div") {
            score += 0.1;
        }
        // Penalize very large containers (likely page-level containers)
        const childCount = container.children.length;
        if (childCount > 200) {
            score -= 0.3;
        } else if (childCount > 100) {
            score -= 0.2;
        } else if (childCount >= 3 && childCount <= 50) {
            score += 0.1; // Sweet spot for content lists
        }
        // Check for "weiterlesen" links (German "read more" - common in news sites)
        const weiterlesenLinks = Array.from(
            container.querySelectorAll("a[href]")
        ).filter((a) => {
            const text = a.textContent?.toLowerCase().trim();
            return (
                text === "weiterlesen" ||
                text === ">> weiterlesen" ||
                text === "weiterlesen >>"
            );
        }).length;
        if (weiterlesenLinks > 0) {
            score += 0.2; // Strong indicator of content list
        }
        // Check for consistent link patterns (like the Rottenburg site)
        const hasConsistentPattern = contentLinks.every(
            (link) => link.includes(".htm") || link.includes(".html")
        );
        if (hasConsistentPattern && contentLinks.length >= 3) {
            score += 0.15;
        }
        return Math.max(0, Math.min(1, score));
    }
    /**
     * Check if an element is a list container
     */
    private isListContainer(element: Element): boolean {
        const tagName = element.tagName.toLowerCase();
        // Direct list elements
        if (["ul", "ol", "dl"].includes(tagName)) return true;
        // Common list container classes/IDs
        const classList = element.className.toLowerCase();
        const listPatterns = [
            "list",
            "items",
            "entries",
            "posts",
            "articles",
            "news",
            "events",
            "grid",
            "container",
            // German news site patterns
            "teaserblock",
            "teaser",
            "topics",
            "nachrichten",
            "meldungen",
            "beitraege"
        ];
        if (listPatterns.some((pattern) => classList.includes(pattern)))
            return true;
        // Check if element has multiple similar child elements (but not individual items)
        const children = Array.from(element.children);
        if (children.length >= 3) {
            // Check if children have similar structure
            const firstChildTag = children[0]?.tagName;
            const similarChildren = children.filter(
                (c) => c.tagName === firstChildTag
            ).length;
            // Only consider it a list container if it has multiple similar children
            // AND it's not an individual item (like article, li, etc.)
            const isIndividualItem = ["article", "li", "div"].includes(
                firstChildTag?.toLowerCase() || ""
            );
            if (similarChildren >= children.length * 0.7 && !isIndividualItem)
                return true;
            // Special case: if it contains multiple articles, it's a list container
            if (
                firstChildTag?.toLowerCase() === "article" &&
                similarChildren >= 3
            )
                return true;
        }
        return false;
    }
    /**
     * Determine if a link is likely to be content-related (enhanced for German municipal sites)
     */
    private isContentLink(href: string, text: string): boolean {
        // Skip common non-content patterns
        const nonContentPatterns = [
            "/search",
            "/suche",
            "/login",
            "/anmelden",
            "/register",
            "/registrieren",
            "/contact",
            "/kontakt",
            "/about",
            "/ueber",
            "/privacy",
            "/datenschutz",
            "/impressum",
            "/sitemap",
            "/rss",
            "/feed",
            "/admin",
            "/cms"
        ];
        if (nonContentPatterns.some((pattern) => href.includes(pattern))) {
            return false;
        }

        // Enhanced content indicators (more flexible for German municipal sites)
        const contentIndicators = [
            // German municipal URL patterns (Rottenburg-style)
            href.match(/\d{6}\.htm/) || // 6-digit IDs (like 149559.htm)
                href.match(/\d{5}\.htm/) || // 5-digit IDs
                href.match(/\d{4}\.htm/), // 4-digit IDs

            // URLs with substantial numeric IDs and .htm extension
            href.includes(".htm") && href.match(/\d{4,}\.htm/),

            // German content keywords in text (reduced minimum length to 15 characters)
            text.length > 15 &&
                (text.includes("bericht") ||
                    text.includes("sitzung") ||
                    text.includes("beschluss") ||
                    text.includes("veranstaltung") ||
                    text.includes("meldung") ||
                    text.includes("nachricht") ||
                    text.includes("tagesordnung") ||
                    text.includes("protokoll") ||
                    text.includes("ausschuss") ||
                    text.includes("gemeinderat") ||
                    text.includes("stadtrat") ||
                    text.includes("öffentlich") ||
                    text.includes("oeffentlich")),

            // German content keywords in URL
            href.includes("tagesordnung") ||
                href.includes("sitzung") ||
                href.includes("beschluss") ||
                href.includes("protokoll") ||
                href.includes("ausschuss") ||
                href.includes("gemeinderat") ||
                href.includes("stadtrat") ||
                href.includes("oeffentlich") ||
                href.includes("öffentlich"),

            // Content path patterns
            href.includes("/aktuelles/") ||
                href.includes("/news/") ||
                href.includes("/artikel/") ||
                href.includes("/meldungen/") ||
                href.includes("/termine/") ||
                href.includes("/veranstaltungen/"),

            // Any link with reasonable text length (minimum 10 characters) and .htm extension
            text.length > 10 && href.includes(".htm"),

            // Links with dates in URL (common in municipal sites)
            href.match(/\d{4}[-_]\d{2}[-_]\d{2}/) ||
                href.match(/\d{2}[-_.]\d{2}[-_.]\d{4}/) ||
                href.match(/\d{1,2}[+.]\d{1,2}[+.]\d{4}/), // German date format with + separator

            // Links with substantial text content (any reasonable content)
            text.length > 20
        ];

        return contentIndicators.some((indicator) => indicator);
    }
    /**
     * Normalize URL by removing query parameters and fragments
     */
    private normalizeUrl(url: string): string {
        try {
            const parsed = new URL(url);
            return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
        } catch (error) {
            return url;
        }
    }
    /**
     * Calculate confidence for container-based discovery (enhanced version)
     */
    private calculateContainerConfidence(
        container: Element,
        exampleUrl: string,
        baseUrl: string
    ): number {
        let confidence = 0;
        // Get sibling links count
        const siblingLinks = this.countSiblingLinks(
            container,
            exampleUrl,
            baseUrl
        );
        // Base confidence from number of siblings found
        if (siblingLinks > 0) confidence += 0.3;
        if (siblingLinks > 2) confidence += 0.2;
        if (siblingLinks > 5) confidence += 0.1;
        // Container quality confidence
        const childCount = container.children.length;
        if (childCount >= 5) confidence += 0.2;
        if (childCount >= 10) confidence += 0.1;
        // Container type confidence
        const tagName = container.tagName.toLowerCase();
        if (["ul", "ol"].includes(tagName)) confidence += 0.1;
        const className = container.className.toLowerCase();
        const listKeywords = [
            "list",
            "items",
            "entries",
            "posts",
            "articles",
            "news"
        ];
        if (listKeywords.some((keyword) => className.includes(keyword)))
            confidence += 0.1;
        return Math.min(confidence, 1.0);
    }
    /**
     * Count sibling links in a container
     */
    private countSiblingLinks(
        container: Element,
        exampleUrl: string,
        baseUrl: string
    ): number {
        const allContainerLinks = Array.from(
            container.querySelectorAll("a[href]")
        )
            .map((a) => {
                const href = a.getAttribute("href");
                return href ? this.resolveUrl(href, baseUrl) : null;
            })
            .filter(
                (link): link is string => link !== null && this.isValidUrl(link)
            )
            .filter((link) => link !== exampleUrl);

        // Deduplicate links by URL (multiple links per content card)
        const uniqueContainerLinks = Array.from(new Set(allContainerLinks));

        return uniqueContainerLinks.filter((link) => {
            const similarity = this.calculateUrlSimilarity(link, exampleUrl);
            // Lower threshold for German municipal sites
            const threshold = this.isGermanMunicipalPattern(link, exampleUrl)
                ? 0.5
                : 0.6;
            return similarity >= threshold;
        }).length;
    }

    // Helper methods (keeping essential ones)

    private analyzeUrlStructure(exampleUrl: string, mainPageUrl: string): any {
        try {
            const exampleParsed = new URL(exampleUrl);
            const mainParsed = new URL(mainPageUrl);

            return {
                commonPath: this.findCommonPath(
                    exampleParsed.pathname,
                    mainParsed.pathname
                ),
                exampleSegments: exampleParsed.pathname
                    .split("/")
                    .filter(Boolean),
                mainSegments: mainParsed.pathname.split("/").filter(Boolean)
            };
        } catch (error) {
            return { commonPath: "", exampleSegments: [], mainSegments: [] };
        }
    }

    private findCommonPath(path1: string, path2: string): string {
        const segments1 = path1.split("/").filter(Boolean);
        const segments2 = path2.split("/").filter(Boolean);
        const commonSegments: string[] = [];

        const minLength = Math.min(segments1.length, segments2.length);
        for (let i = 0; i < minLength; i++) {
            if (segments1[i] === segments2[i]) {
                commonSegments.push(segments1[i]);
            } else {
                break;
            }
        }

        return "/" + commonSegments.join("/");
    }

    private async rankSiblingLinks(
        links: string[],
        exampleUrl: string,
        urlAnalysis: any,
        options: LinkDiscoveryOptions
    ): Promise<string[]> {
        const scored = links.map((link) => ({
            url: link,
            score: this.calculateUrlSimilarity(link, exampleUrl)
        }));

        return scored.sort((a, b) => b.score - a.score).map((item) => item.url);
    }

    private calculateUrlSimilarity(url1: string, url2: string): number {
        try {
            const parsed1 = new URL(url1);
            const parsed2 = new URL(url2);

            let score = 0;

            // Same domain
            if (parsed1.hostname === parsed2.hostname) score += 0.3;

            // Enhanced similarity for German municipal sites
            const isGermanMunicipal = this.isGermanMunicipalPattern(url1, url2);

            if (isGermanMunicipal) {
                // German municipal sites: focus on file patterns rather than path structure
                score += this.calculateGermanMunicipalSimilarity(
                    parsed1,
                    parsed2
                );
            } else {
                // Standard path similarity for other sites
                const pathSim = this.calculatePathSimilarity(
                    parsed1.pathname,
                    parsed2.pathname
                );
                score += pathSim * 0.5;
            }

            // Query parameter similarity
            const paramSim = this.calculateQueryParamSimilarity(
                parsed1,
                parsed2
            );
            score += paramSim * 0.2;

            return Math.min(score, 1.0);
        } catch (error) {
            return 0;
        }
    }

    /**
     * Check if URLs follow German municipal patterns
     */
    private isGermanMunicipalPattern(url1: string, url2: string): boolean {
        // Check for German municipal patterns
        const patterns = [
            /\d{4,6}\.htm/, // Numeric IDs with .htm
            /\+.*\+.*\.htm/, // Plus-separated German text with .htm
            /lnav=\d+/ // lnav parameter common in German municipal sites
        ];

        return patterns.some(
            (pattern) => pattern.test(url1) && pattern.test(url2)
        );
    }

    /**
     * Calculate similarity for German municipal URLs
     */
    private calculateGermanMunicipalSimilarity(url1: URL, url2: URL): number {
        let score = 0;

        const filename1 = url1.pathname.split("/").pop() || "";
        const filename2 = url2.pathname.split("/").pop() || "";

        // Both have .htm extension
        if (filename1.includes(".htm") && filename2.includes(".htm")) {
            score += 0.2;
        }

        // Both have numeric IDs
        const id1 = filename1.match(/\d{4,6}\.htm/);
        const id2 = filename2.match(/\d{4,6}\.htm/);
        if (id1 && id2) {
            score += 0.3; // Strong indicator of similar content type
        }

        // Both have German plus-separated text
        const hasGermanText1 = /\+.*\+/.test(filename1);
        const hasGermanText2 = /\+.*\+/.test(filename2);
        if (hasGermanText1 && hasGermanText2) {
            score += 0.2;
        }

        // Both have similar German keywords in filename
        const germanKeywords = [
            "sitzung",
            "tagesordnung",
            "protokoll",
            "beschluss",
            "bericht",
            "ausschuss",
            "gemeinderat",
            "stadtrat",
            "oeffentlich",
            "öffentlich",
            "veranstaltung"
        ];

        const keywords1 = germanKeywords.filter((keyword) =>
            filename1.toLowerCase().includes(keyword)
        );
        const keywords2 = germanKeywords.filter((keyword) =>
            filename2.toLowerCase().includes(keyword)
        );

        if (keywords1.length > 0 && keywords2.length > 0) {
            const commonKeywords = keywords1.filter((k) =>
                keywords2.includes(k)
            );
            if (commonKeywords.length > 0) {
                score += 0.1; // Bonus for shared German municipal keywords
            }
        }

        return score;
    }

    private calculatePathSimilarity(path1: string, path2: string): number {
        const segments1 = path1.split("/").filter(Boolean);
        const segments2 = path2.split("/").filter(Boolean);

        if (segments1.length === 0 && segments2.length === 0) return 1.0;
        if (segments1.length === 0 || segments2.length === 0) return 0;

        const commonSegments = segments1.filter((seg) =>
            segments2.includes(seg)
        );
        const maxSegments = Math.max(segments1.length, segments2.length);

        return commonSegments.length / maxSegments;
    }

    private calculateQueryParamSimilarity(url1: URL, url2: URL): number {
        const params1 = Array.from(url1.searchParams.keys());
        const params2 = Array.from(url2.searchParams.keys());

        if (params1.length === 0 && params2.length === 0) return 1.0;
        if (params1.length === 0 || params2.length === 0) return 0;

        const commonParams = params1.filter((param) => params2.includes(param));
        const maxParams = Math.max(params1.length, params2.length);

        return commonParams.length / maxParams;
    }

    private isValidLink(
        link: string,
        exampleUrl: string,
        options: LinkDiscoveryOptions
    ): boolean {
        try {
            const linkUrl = new URL(link);
            const exampleUrlParsed = new URL(exampleUrl);

            // Check if external links are allowed
            if (
                !options.includeExternalLinks &&
                linkUrl.hostname !== exampleUrlParsed.hostname
            ) {
                return false;
            }

            // Basic URL validation
            return (
                linkUrl.protocol === "http:" || linkUrl.protocol === "https:"
            );
        } catch (error) {
            return false;
        }
    }

    private isValidUrl(url: string): boolean {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    private resolveUrl(href: string, baseUrl: string): string {
        try {
            return new URL(href, baseUrl).href;
        } catch {
            return href;
        }
    }

    private generateContainerSignature(container: Element): string {
        const tag = container.tagName.toLowerCase();
        const className = container.className || "";
        const id = container.id || "";
        const childCount = container.children.length;

        return `${tag}.${className}#${id}[${childCount}]`;
    }

    /**
     * Enhanced pagination detection with heuristic search and LLM analysis
     */
    private async detectPaginationWithLLM(
        document: Document,
        baseUrl: string,
        contentContainer?: Element | null
    ): Promise<{
        paginationLinks: string[];
        paginationNextSelector?: string;
        confidence: number;
        method: "heuristic" | "llm" | "none";
    }> {
        logger.debug("🔍 Starting enhanced pagination detection...");

        // Step 1: Try heuristic detection first
        const heuristicResult = this.detectPaginationHeuristic(
            document,
            baseUrl
        );
        if (heuristicResult.paginationLinks.length > 0) {
            logger.info(
                `✅ Found ${heuristicResult.paginationLinks.length} pagination links using heuristic method`
            );

            // Step 1.5: LLM verification of heuristic results for better next selector
            logger.info(
                "🔍 Verifying heuristic pagination results with LLM..."
            );
            try {
                const llmVerification = await this.verifyPaginationWithLLM(
                    document,
                    baseUrl,
                    heuristicResult,
                    contentContainer
                );

                if (llmVerification.paginationNextSelector) {
                    logger.info(
                        `✅ LLM improved next selector: ${llmVerification.paginationNextSelector}`
                    );
                    return {
                        paginationLinks: heuristicResult.paginationLinks,
                        paginationNextSelector:
                            llmVerification.paginationNextSelector,
                        method: "heuristic",
                        confidence: Math.max(0.8, llmVerification.confidence)
                    };
                }
            } catch (error) {
                logger.warn(
                    "⚠️ LLM verification failed, using heuristic results:",
                    error
                );
            }

            return {
                ...heuristicResult,
                method: "heuristic",
                confidence: 0.8
            };
        }

        // Step 2: If heuristic fails, try LLM analysis
        logger.info(
            "🔄 Heuristic pagination detection failed, trying LLM analysis..."
        );
        try {
            const llmResult = await this.detectPaginationWithLLMAnalysis(
                document,
                baseUrl,
                contentContainer
            );
            if (llmResult.paginationLinks.length > 0) {
                logger.info(
                    `✅ Found ${llmResult.paginationLinks.length} pagination links using LLM analysis`
                );
                return {
                    ...llmResult,
                    method: "llm"
                };
            }
        } catch (error) {
            logger.warn("⚠️ LLM pagination detection failed:", error);
        }

        logger.info("❌ No pagination found using any method");
        return {
            paginationLinks: [],
            method: "none",
            confidence: 0
        };
    }

    /**
     * Heuristic pagination detection using common patterns
     */
    private detectPaginationHeuristic(
        document: Document,
        baseUrl: string
    ): {
        paginationLinks: string[];
        paginationNextSelector?: string;
    } {
        const paginationLinks: string[] = [];
        let paginationNextSelector: string | undefined;

        // Common pagination selectors (ordered by specificity)
        const selectors = [
            // Standard pagination classes
            ".pagination a[href]",
            ".pager a[href]",
            ".page-numbers a[href]",
            ".paginate a[href]",
            ".page-nav a[href]",

            // Semantic attributes
            'a[rel="next"]',
            'a[rel="prev"]',
            'a[aria-label*="next" i]',
            'a[aria-label*="previous" i]',

            // German pagination patterns
            'a[href*="seite"]',
            'a[href*="page"]',
            'a[href*="skip"]',
            'a[href*="offset"]',

            // Generic patterns (last resort)
            'a[href*="&p="]',
            'a[href*="?p="]',
            'a[href*="&page="]',
            'a[href*="?page="]'
        ];

        for (const selector of selectors) {
            const links = document.querySelectorAll(selector);
            if (links.length > 0) {
                logger.debug(
                    `🎯 Found pagination elements with selector: ${selector}`
                );

                // Check for "next" link specifically and create precise selector
                const nextLink = Array.from(links).find((link) => {
                    const text = link.textContent?.toLowerCase().trim() || "";
                    const ariaLabel =
                        link.getAttribute("aria-label")?.toLowerCase() || "";
                    const className = link.className.toLowerCase();
                    const rel = link.getAttribute("rel")?.toLowerCase() || "";

                    return (
                        text.includes("next") ||
                        text.includes("weiter") ||
                        text.includes("››") ||
                        text === ">" ||
                        ariaLabel.includes("next") ||
                        ariaLabel.includes("weiter") ||
                        className.includes("next") ||
                        className.includes("pn_next") ||
                        rel === "next"
                    );
                });

                if (nextLink && !paginationNextSelector) {
                    // Create a more specific selector for the next link
                    const nextClass = nextLink.className;
                    const nextRel = nextLink.getAttribute("rel");
                    const nextText = nextLink.textContent?.trim();
                    const baseSelector = selector.replace(" a[href]", "");

                    if (nextRel === "next") {
                        paginationNextSelector = `${baseSelector} a[rel="next"]`;
                    } else if (nextClass && nextClass.includes("next")) {
                        const nextClassSelector = nextClass
                            .split(" ")
                            .find((cls) => cls.includes("next"));
                        if (nextClassSelector) {
                            paginationNextSelector = `${baseSelector} a.${nextClassSelector}`;
                        }
                    } else if (nextClass && nextClass.includes("pn_next")) {
                        paginationNextSelector = `${baseSelector} .pn_next`;
                    } else if (
                        nextText &&
                        (nextText.includes("››") || nextText === ">")
                    ) {
                        // For text-based selectors, we'll use the general selector
                        paginationNextSelector = selector;
                    } else {
                        // Fallback to the general selector
                        paginationNextSelector = selector;
                    }

                    logger.debug(
                        `🎯 Created next selector: ${paginationNextSelector}`
                    );
                }

                links.forEach((link) => {
                    const href = link.getAttribute("href");
                    if (href) {
                        const resolvedUrl = this.resolveUrl(href, baseUrl);
                        if (
                            this.isValidUrl(resolvedUrl) &&
                            !paginationLinks.includes(resolvedUrl)
                        ) {
                            paginationLinks.push(resolvedUrl);
                        }
                    }
                });

                // If we found links with this selector, don't try less specific ones
                if (paginationLinks.length > 0) {
                    break;
                }
            }
        }

        return { paginationLinks, paginationNextSelector };
    }

    /**
     * LLM-based pagination detection for complex cases
     */
    private async detectPaginationWithLLMAnalysis(
        document: Document,
        baseUrl: string,
        contentContainer?: Element | null
    ): Promise<{
        paginationLinks: string[];
        paginationNextSelector?: string;
        confidence: number;
    }> {
        // Get HTML around the content container and footer areas where pagination usually appears
        let analysisHtml = "";

        if (contentContainer) {
            // Get the parent container and siblings that might contain pagination
            const parent = contentContainer.parentElement;
            if (parent) {
                analysisHtml = parent.outerHTML;
            } else {
                analysisHtml = contentContainer.outerHTML;
            }
        } else {
            // Fallback to footer and main content areas
            const footerElements = document.querySelectorAll(
                'footer, .footer, .pagination-wrapper, .page-nav, [class*="pag"]'
            );
            const mainElements = document.querySelectorAll(
                'main, .main, .content, [role="main"]'
            );

            const relevantElements = [
                ...Array.from(footerElements),
                ...Array.from(mainElements)
            ];
            analysisHtml = relevantElements
                .map((el) => el.outerHTML)
                .join("\n");
        }

        if (!analysisHtml) {
            analysisHtml = document.body.outerHTML;
        }

        // Compress HTML for LLM analysis
        const compressedHtml = this.compressHtmlForLLM(analysisHtml, true);

        const prompt = `Analyze this HTML to find pagination elements. Look for:
1. Links that navigate to next/previous pages
2. Numbered page links (1, 2, 3, etc.)
3. "Next", "Previous", "Weiter", "Zurück" buttons/links
4. Page navigation controls

HTML to analyze:
${compressedHtml}

Respond with JSON only:
{
  "paginationNextSelector": "CSS selector for next page link (if found)",
  "paginationLinks": ["array of pagination URLs found"],
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}`;

        const llmRequest = {
            prompt,
            systemMessage:
                "You are an expert at analyzing HTML structure for pagination elements. Respond with valid JSON only.",
            format: "json" as const,
            temperature: 0.1,
            maxTokens: 1000
        };

        try {
            const llmResponse = await this.llmService.generate(llmRequest);
            const analysis = JSON.parse(llmResponse.content);

            logger.debug("🧠 LLM pagination analysis:", analysis);

            // Validate and extract pagination links
            const paginationLinks: string[] = [];
            if (
                analysis.paginationLinks &&
                Array.isArray(analysis.paginationLinks)
            ) {
                for (const link of analysis.paginationLinks) {
                    if (typeof link === "string") {
                        const resolvedUrl = this.resolveUrl(link, baseUrl);
                        if (this.isValidUrl(resolvedUrl)) {
                            paginationLinks.push(resolvedUrl);
                        }
                    }
                }
            }

            // Validate pagination selector
            let paginationNextSelector: string | undefined;
            if (
                analysis.paginationNextSelector &&
                typeof analysis.paginationNextSelector === "string"
            ) {
                try {
                    // Test if selector is valid
                    document.querySelector(analysis.paginationNextSelector);
                    paginationNextSelector = analysis.paginationNextSelector;
                } catch (error) {
                    logger.warn(
                        `⚠️ Invalid LLM pagination selector: ${analysis.paginationNextSelector}`
                    );
                }
            }

            return {
                paginationLinks,
                paginationNextSelector,
                confidence: Math.min(Math.max(analysis.confidence || 0, 0), 1)
            };
        } catch (error) {
            logger.error("❌ LLM pagination analysis failed:", error);
            return {
                paginationLinks: [],
                confidence: 0
            };
        }
    }

    /**
     * LLM verification of heuristic pagination results to improve next selector
     */
    private async verifyPaginationWithLLM(
        document: Document,
        baseUrl: string,
        heuristicResult: {
            paginationLinks: string[];
            paginationNextSelector?: string;
        },
        contentContainer?: Element | null
    ): Promise<{
        paginationNextSelector?: string;
        confidence: number;
    }> {
        // Find the pagination container by looking for elements that contain the pagination links
        let paginationContainer: Element | null = null;

        // Try to find the container that holds the pagination
        const paginationSelectors = [
            ".pagination",
            ".pager",
            ".page-numbers",
            ".paginate",
            ".page-nav"
        ];
        for (const selector of paginationSelectors) {
            const container = document.querySelector(selector);
            if (container) {
                paginationContainer = container;
                break;
            }
        }

        // If no specific pagination container found, look for parent of pagination links
        if (!paginationContainer && heuristicResult.paginationNextSelector) {
            try {
                const nextElement = document.querySelector(
                    heuristicResult.paginationNextSelector
                );
                if (nextElement) {
                    paginationContainer =
                        nextElement.closest(
                            ".pagination, .pager, .page-numbers, .paginate, .page-nav"
                        ) || nextElement.parentElement;
                }
            } catch (error) {
                logger.debug(
                    "Could not find pagination container from next selector"
                );
            }
        }

        if (!paginationContainer) {
            logger.debug("No pagination container found for LLM verification");
            return { confidence: 0 };
        }

        // Compress the pagination HTML for LLM analysis
        const paginationHtml = this.compressHtmlForLLM(
            paginationContainer.outerHTML,
            true
        );

        const prompt = `Analyze this pagination HTML snippet to identify the best CSS selector for the "next page" link.

Found pagination links: ${heuristicResult.paginationLinks.slice(0, 3).join(", ")}
Current next selector: ${heuristicResult.paginationNextSelector || "none"}

HTML snippet:
${paginationHtml}

Look for:
1. Links with text like "next", "weiter", "››", ">"
2. Links with rel="next" attribute
3. Links with CSS classes containing "next"
4. The most specific selector that targets only the next page link

Respond with JSON only:
{
  "paginationNextSelector": "most specific CSS selector for next page link",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation of why this selector was chosen"
}`;

        const llmRequest = {
            prompt,
            systemMessage:
                "You are an expert at analyzing HTML pagination structures. Respond with valid JSON only.",
            format: "json" as const,
            temperature: 0.1,
            maxTokens: 800
        };

        try {
            const llmResponse = await this.llmService.generate(llmRequest);
            const analysis = JSON.parse(llmResponse.content);

            logger.debug("🧠 LLM pagination verification:", analysis);

            // Validate the selector
            let paginationNextSelector: string | undefined;
            if (
                analysis.paginationNextSelector &&
                typeof analysis.paginationNextSelector === "string"
            ) {
                try {
                    // Test if selector is valid and finds an element
                    const testElement = document.querySelector(
                        analysis.paginationNextSelector
                    );
                    if (testElement) {
                        paginationNextSelector =
                            analysis.paginationNextSelector;
                        logger.debug(
                            `✅ LLM selector validated: ${paginationNextSelector}`
                        );
                    } else {
                        logger.warn(
                            `⚠️ LLM selector finds no elements: ${analysis.paginationNextSelector}`
                        );
                    }
                } catch (error) {
                    logger.warn(
                        `⚠️ Invalid LLM selector: ${analysis.paginationNextSelector}`,
                        error
                    );
                }
            }

            return {
                paginationNextSelector,
                confidence: Math.min(Math.max(analysis.confidence || 0, 0), 1)
            };
        } catch (error) {
            logger.error("❌ LLM pagination verification failed:", error);
            return { confidence: 0 };
        }
    }

    private identifyLinkPatterns(
        links: string[],
        exampleUrl: string
    ): string[] {
        const patterns: string[] = [];

        if (links.length === 0) return patterns;

        // Check for consistent ID patterns
        const hasConsistentIds = links.every((link) => /\d{4,}/.test(link));
        if (hasConsistentIds) patterns.push("consistent-id-pattern");

        // Check for date patterns
        const hasDatePatterns = links.some((link) =>
            /\d{4}[-_]\d{2}[-_]\d{2}/.test(link)
        );
        if (hasDatePatterns) patterns.push("date-pattern");

        // Check for similar path structure
        const pathSimilarity = links.every((link) => {
            try {
                const linkUrl = new URL(link);
                const exampleUrlParsed = new URL(exampleUrl);
                return (
                    linkUrl.pathname.split("/").length ===
                    exampleUrlParsed.pathname.split("/").length
                );
            } catch {
                return false;
            }
        });
        if (pathSimilarity) patterns.push("consistent-path-structure");

        return patterns;
    }

    private estimateTotalPages(paginationLinks: string[]): number {
        // Try to extract page numbers from pagination links
        const pageNumbers: number[] = [];

        for (const link of paginationLinks) {
            const matches =
                link.match(/page[=\/](\d+)/i) || link.match(/p=(\d+)/i);
            if (matches && matches[1]) {
                const pageNum = parseInt(matches[1], 10);
                if (!isNaN(pageNum)) {
                    pageNumbers.push(pageNum);
                }
            }
        }

        return pageNumbers.length > 0
            ? Math.max(...pageNumbers)
            : paginationLinks.length;
    }

    // Placeholder methods for other discovery methods
    private async discoverFromSamePage(
        exampleUrl: string,
        options: LinkDiscoveryOptions
    ): Promise<SiblingLinkResult> {
        // Implementation would use centralized LLM service for same-page analysis
        return {
            originalUrl: exampleUrl,
            siblingLinks: [],
            discoveryMethod: "same-page",
            confidence: 0.5,
            metadata: { totalLinksFound: 0, filteredLinks: 0, patterns: [] }
        };
    }

    private async discoverFromParentPage(
        exampleUrl: string,
        mainPageUrl: string,
        options: LinkDiscoveryOptions
    ): Promise<SiblingLinkResult> {
        // Implementation would use centralized LLM service for parent page analysis
        return {
            originalUrl: exampleUrl,
            siblingLinks: [],
            discoveryMethod: "parent-page",
            confidence: 0.5,
            metadata: { totalLinksFound: 0, filteredLinks: 0, patterns: [] }
        };
    }
}
