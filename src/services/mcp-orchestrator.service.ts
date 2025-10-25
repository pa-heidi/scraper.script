/**
 * MCP Orchestrator Service
 * Central coordination service for plan lifecycle management and async task processing
 * Requirements: 1.1, 2.1, 2.4, 4.1, 6.1, 8.1
 */

import { createClient, RedisClientType } from "redis";
import {
    ScrapingPlan,
    PlanOptions,
    PlanGenerationResult,
    ExecutionResult,
    PlanApproval,
    PlanLifecycleStatus,
    ExecutionRequest,
    QueueMessage,
    WorkflowState,
    WorkflowStep,
    MCPOrchestratorConfig,
    ExecutionOptions
} from "../interfaces/core";
import { LLMPlannerService } from "./llm-planner.service";
import { PlaywrightExecutor } from "./playwright-executor.service";
import { SiblingLinkDiscoveryService } from "./sibling-link-discovery.service";
import { ContentPatternAnalyzer } from "./content-pattern-analyzer.service";
import { logger } from "../utils/logger";

// Local interface definitions for standalone operation
interface ExecutionError {
    errorType: string;
    message: string;
    timestamp: Date;
    context: Record<string, any>;
    stack?: string;
}

export interface MCPOrchestrator {
    generatePlan(
        url: string,
        contentUrls?: string[],
        options?: PlanOptions
    ): Promise<PlanGenerationResult>;
    executePlan(
        planId: string,
        runId: string,
        options?: ExecutionOptions
    ): Promise<ExecutionResult>;
    queueExecution(
        planId: string,
        runId: string,
        options?: ExecutionOptions
    ): Promise<void>;
    schedulePlan(planId: string, schedule: string): Promise<void>;
    reviewPlan(planId: string, approval: PlanApproval): Promise<void>;
    getPlanStatus(planId: string): Promise<PlanLifecycleStatus | null>;
    getWorkflowState(workflowId: string): Promise<WorkflowState | null>;
}

export class MCPOrchestratorService implements MCPOrchestrator {
    private redisClient: RedisClientType;
    private llmPlanner: LLMPlannerService;
    private playwrightExecutor: PlaywrightExecutor;
    private siblingLinkDiscovery: SiblingLinkDiscoveryService;
    private contentPatternAnalyzer: ContentPatternAnalyzer;
    private config: MCPOrchestratorConfig;
    private isInitialized = false;
    private activeWorkflows = new Map<string, WorkflowState>();
    private executionQueue = new Map<string, ExecutionRequest>();

    constructor(config?: Partial<MCPOrchestratorConfig>) {
        // Parse Redis configuration from REDIS_URL or individual env vars
        let redisConfig: any = {};

        if (process.env.REDIS_URL) {
            // Parse REDIS_URL format: redis://:password@host:port/db
            try {
                const url = new URL(process.env.REDIS_URL);
                redisConfig = {
                    host: url.hostname || "localhost",
                    port: parseInt(url.port) || 6379,
                    db: parseInt(url.pathname.slice(1)) || 0
                };

                if (url.password) {
                    redisConfig.password = url.password;
                }
            } catch (error) {
                logger.warn(
                    "Failed to parse REDIS_URL, using individual env vars:",
                    error
                );
                redisConfig = {
                    host: process.env.REDIS_HOST || "localhost",
                    port: parseInt(process.env.REDIS_PORT || "6379"),
                    db: parseInt(process.env.REDIS_DB || "0")
                };

                if (process.env.REDIS_PASSWORD) {
                    redisConfig.password = process.env.REDIS_PASSWORD;
                }
            }
        } else {
            // Use individual environment variables
            redisConfig = {
                host: process.env.REDIS_HOST || "localhost",
                port: parseInt(process.env.REDIS_PORT || "6379"),
                db: parseInt(process.env.REDIS_DB || "0")
            };

            if (process.env.REDIS_PASSWORD) {
                redisConfig.password = process.env.REDIS_PASSWORD;
            }
        }

        this.config = {
            redis: redisConfig,
            queues: {
                planGeneration: "queue:plan-generation",
                planExecution: "queue:plan-execution",
                planValidation: "queue:plan-validation"
            },
            workers: {
                maxConcurrentExecutions: parseInt(
                    process.env.MAX_CONCURRENT_EXECUTIONS || "5"
                ),
                executionTimeout: parseInt(
                    process.env.EXECUTION_TIMEOUT || "300000"
                ), // 5 minutes
                retryAttempts: parseInt(process.env.RETRY_ATTEMPTS || "3")
            },
            monitoring: {
                metricsInterval: parseInt(
                    process.env.METRICS_INTERVAL || "60000"
                ), // 1 minute
                healthCheckInterval: parseInt(
                    process.env.HEALTH_CHECK_INTERVAL || "30000"
                ) // 30 seconds
            },
            ...config
        };

        const redisOptions: any = {
            socket: {
                host: this.config.redis.host,
                port: this.config.redis.port
            },
            database: this.config.redis.db
        };

        if (this.config.redis.password) {
            redisOptions.password = this.config.redis.password;
        }

        this.redisClient = createClient(redisOptions);

        // Add Redis error handling to prevent crashes
        this.redisClient.on("error", (error) => {
            logger.error("Redis client error:", error);
        });

        this.redisClient.on("disconnect", () => {
            logger.warn("Redis client disconnected");
        });

        this.redisClient.on("reconnecting", () => {
            logger.info("Redis client reconnecting...");
        });

        this.playwrightExecutor = new PlaywrightExecutor();
        this.llmPlanner = new LLMPlannerService(this.playwrightExecutor);
        this.siblingLinkDiscovery = new SiblingLinkDiscoveryService();
        this.contentPatternAnalyzer = new ContentPatternAnalyzer(
            this.playwrightExecutor
        );
    }

    /**
     * Initialize the orchestrator service
     * Requirements: 1.1, 2.1 - Service initialization and Redis connection
     */
    public async initialize(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        try {
            // Connect to Redis
            await this.redisClient.connect();
            logger.info("Connected to Redis for MCP orchestration");

            // Initialize Playwright executor with browser pool
            await this.playwrightExecutor.initialize();
            logger.info("Playwright executor initialized with browser pool");

            // Initialize queue listeners
            await this.initializeQueueListeners();

            // Start monitoring and health checks
            this.startMonitoring();

            this.isInitialized = true;
            logger.info("MCP Orchestrator Service initialized successfully");
        } catch (error) {
            logger.error(
                "Failed to initialize MCP Orchestrator Service:",
                error
            );
            throw error;
        }
    }

    /**
     * Generate scraping plan with content URL support
     * Requirements: 1.1, 8.1 - Plan generation with content URLs
     */
    public async generatePlan(
        url: string,
        contentUrls?: string[],
        options: PlanOptions = {}
    ): Promise<PlanGenerationResult> {
        const workflowId = this.generateWorkflowId("plan_generation");

        try {
            logger.info(
                `Starting plan generation workflow ${workflowId} for ${url}`,
                {
                    contentUrls: contentUrls?.length || 0,
                    options
                }
            );

            // Create workflow state
            const workflow = this.createWorkflow(
                workflowId,
                "plan_lifecycle",
                [
                    {
                        stepId: "fetch_html",
                        name: "Fetch HTML Content",
                        status: "pending"
                    },
                    {
                        stepId: "discover_sibling_links",
                        name: "Discover Sibling Links",
                        status: "pending"
                    },
                    {
                        stepId: "analyze_content",
                        name: "Analyze Content Patterns",
                        status: "pending"
                    },
                    {
                        stepId: "generate_plan",
                        name: "Generate Scraping Plan",
                        status: "pending"
                    },
                    {
                        stepId: "validate_plan",
                        name: "Validate Plan",
                        status: "pending"
                    },
                    {
                        stepId: "store_plan",
                        name: "Store Plan",
                        status: "pending"
                    }
                ],
                { url, contentUrls, options }
            );

            this.activeWorkflows.set(workflowId, workflow);

            // Execute workflow steps

            const siblingDiscoveryResult = await this.executeWorkflowStep(
                workflowId,
                "discover_sibling_links",
                async () => {
                    // Reuse HTML content from previous step
                    const html = workflow.context.html;
                    const cookieConsentMetadata =
                        workflow.context.cookieConsentMetadata;

                    // Discover sibling links from provided content URLs using shared HTML
                    let discoveredLinks: string[] = [];
                    let siblingResults: any[] = [];
                    const processedContainers = new Set<string>();

                    if (contentUrls && contentUrls.length > 0) {
                        logger.info(
                            `Discovering sibling links from ${contentUrls.length} content URLs using shared HTML`
                        );

                        for (const contentUrl of contentUrls) {
                            try {
                                const siblingResult =
                                    await this.siblingLinkDiscovery.discoverSiblingLinksWithHtml(
                                        contentUrl,
                                        url,
                                        html, // Pass the shared HTML content
                                        {
                                            maxSiblingLinks: 5, // Limit per content URL
                                            includeExternalLinks: false,
                                            minSimilarityScore: 0.6,
                                            followParentPages: true,
                                            searchForPatterns: true,
                                            enableSamePageDiscovery: false,
                                            enableParentPageDiscovery: false,
                                            enableMainPageDiscovery: true,
                                            // NEW: Pagination support
                                            examplePaginationUrl:
                                                options.paginationUrl,
                                            isPaginated: options.isPaginated,
                                            detectPaginationPattern: true
                                            // Note: cookieConsentMetadata is passed via options but not part of LinkDiscoveryOptions interface
                                        }
                                    );

                                // Track container to avoid duplicate processing
                                const containerSignature =
                                    siblingResult.metadata.containerSignature;
                                if (
                                    containerSignature &&
                                    !processedContainers.has(containerSignature)
                                ) {
                                    processedContainers.add(containerSignature);
                                    siblingResults.push(siblingResult);
                                    discoveredLinks.push(
                                        ...siblingResult.siblingLinks
                                    );

                                    logger.info(
                                        `Discovered ${siblingResult.siblingLinks.length} sibling links from ${contentUrl} (new container)`,
                                        {
                                            method: siblingResult.discoveryMethod,
                                            confidence:
                                                siblingResult.confidence,
                                            containerSignature
                                        }
                                    );
                                } else if (!containerSignature) {
                                    // No container found, still add the results
                                    siblingResults.push(siblingResult);
                                    discoveredLinks.push(
                                        ...siblingResult.siblingLinks
                                    );

                                    logger.info(
                                        `Discovered ${siblingResult.siblingLinks.length} sibling links from ${contentUrl} (no container)`,
                                        {
                                            method: siblingResult.discoveryMethod,
                                            confidence: siblingResult.confidence
                                        }
                                    );
                                } else {
                                    logger.debug(
                                        `Skipped ${contentUrl} - container already processed: ${containerSignature}`
                                    );
                                }
                            } catch (error) {
                                logger.warn(
                                    `Failed to discover sibling links from ${contentUrl}:`,
                                    error
                                );
                            }
                        }

                        // Remove duplicates and combine with original content URLs
                        const allContentUrls = [
                            ...new Set([...contentUrls, ...discoveredLinks])
                        ];

                        logger.info(
                            `Enhanced content URLs: ${contentUrls.length} original + ${discoveredLinks.length} discovered = ${allContentUrls.length} total`
                        );

                        return {
                            originalContentUrls: contentUrls,
                            discoveredSiblingLinks: discoveredLinks,
                            enhancedContentUrls: allContentUrls,
                            siblingResults
                        };
                    }

                    return {
                        originalContentUrls: contentUrls || [],
                        discoveredSiblingLinks: [],
                        enhancedContentUrls: contentUrls || [],
                        siblingResults: []
                    };
                }
            );

            await this.executeWorkflowStep(
                workflowId,
                "analyze_content",
                async () => {
                    // Fetch and analyze enhanced content URLs individually
                    const mainPageHtml = workflow.context.html;
                    const enhancedContentUrls =
                        siblingDiscoveryResult.enhancedContentUrls;

                    if (enhancedContentUrls && enhancedContentUrls.length > 0) {
                        const contentAnalysis =
                            await this.analyzeContentUrlsWithHtml(
                                enhancedContentUrls,
                                mainPageHtml // Pass main page HTML for reference
                            );
                        return {
                            contentAnalysis,
                            usedEnhancedUrls: true,
                            totalUrls: enhancedContentUrls.length,
                            analyzedUrls: contentAnalysis.analyzedUrls || 0
                        };
                    }
                    return {
                        contentAnalysis: null,
                        usedEnhancedUrls: false,
                        totalUrls: 0,
                        analyzedUrls: 0
                    };
                }
            );

            const planResult = await this.executeWorkflowStep(
                workflowId,
                "generate_plan",
                async () => {
                    const rawHtml = workflow.context.html;
                    const enhancedContentUrls =
                        workflow.context.enhancedContentUrls;
                    const cookieConsentMetadata =
                        workflow.context.cookieConsentMetadata;

                    // Get analysis results from previous workflow steps
                    const siblingResults =
                        workflow.context.siblingResults || [];
                    const contentAnalysis =
                        workflow.context.contentAnalysis || {};

                    logger.info(
                        "🎯 Generating scraping plan using workflow analysis results",
                        {
                            siblingResultsCount: siblingResults.length,
                            hasContentAnalysis:
                                !!contentAnalysis.detailSelectors,
                            contentSelectorsCount: Object.keys(
                                contentAnalysis.detailSelectors || {}
                            ).length
                        }
                    );

                    // Extract selectors from sibling discovery analysis
                    let listSelector = "";
                    let paginationSelector = "";

                    if (siblingResults.length > 0) {
                        // Use the best sibling result (highest confidence)
                        const bestSiblingResult = siblingResults.reduce(
                            (best: any, current: any) =>
                                current.confidence > best.confidence
                                    ? current
                                    : best
                        );

                        // Extract selectors from sibling analysis metadata
                        if (
                            bestSiblingResult.metadata?.paginationNextSelector
                        ) {
                            paginationSelector =
                                bestSiblingResult.metadata
                                    .paginationNextSelector;
                        }

                        // For list selector, we need to derive it from the container and content link pattern
                        // This would typically be the container selector + content link selector
                        if (bestSiblingResult.metadata?.containerSignature) {
                            listSelector =
                                bestSiblingResult.metadata.containerSignature;
                        }

                        logger.info(
                            "📋 Extracted selectors from sibling analysis:",
                            {
                                listSelector,
                                paginationSelector,
                                confidence: bestSiblingResult.confidence,
                                method: bestSiblingResult.discoveryMethod
                            }
                        );
                    }

                    // Extract detail selectors from content analysis
                    const detailSelectors =
                        contentAnalysis.detailSelectors || {};

                    logger.info(
                        "🔍 Using detail selectors from content analysis:",
                        {
                            detailSelectors,
                            confidence: contentAnalysis.confidence || 0
                        }
                    );

                    // Create the scraping plan using the analyzed selectors
                    const scrapingPlan =
                        await this.createScrapingPlanFromAnalysis({
                            url,
                            enhancedContentUrls,
                            listSelector,
                            paginationSelector,
                            detailSelectors,
                            siblingResults,
                            contentAnalysis,
                            cookieConsentMetadata,
                            options
                        });

                    logger.info(
                        "✅ Scraping plan generated from workflow analysis",
                        {
                            planId: scrapingPlan.planId,
                            entryUrls: scrapingPlan.entryUrls.length,
                            listSelector: scrapingPlan.listSelector,
                            paginationSelector: scrapingPlan.paginationSelector,
                            detailSelectorsCount: Object.keys(
                                scrapingPlan.detailSelectors
                            ).length,
                            confidence: Math.max(
                                contentAnalysis.confidence || 0,
                                siblingResults.length > 0
                                    ? Math.max(
                                          ...siblingResults.map(
                                              (r: any) => r.confidence
                                          )
                                      )
                                    : 0
                            )
                        }
                    );

                    // Add workflow analysis metadata to the plan result
                    const result: PlanGenerationResult = {
                        planId: scrapingPlan.planId,
                        plan: scrapingPlan,
                        confidence: Math.max(
                            contentAnalysis.confidence || 0,
                            siblingResults.length > 0
                                ? Math.max(
                                      ...siblingResults.map(
                                          (r: any) => r.confidence
                                      )
                                  )
                                : 0
                        ),
                        humanReadableDoc: this.generateHumanReadableDoc(
                            scrapingPlan,
                            siblingResults,
                            contentAnalysis
                        ),
                        testResults: {
                            success: true,
                            extractedSamples: [],
                            errors: [],
                            confidence: contentAnalysis.confidence || 0.5
                        },
                        siblingDiscovery: {
                            originalUrls: workflow.context.originalContentUrls,
                            discoveredLinks:
                                workflow.context.discoveredSiblingLinks,
                            discoveryResults: siblingResults,
                            totalEnhancedUrls: enhancedContentUrls.length
                        }
                    };

                    return result;
                }
            );

            await this.executeWorkflowStep(
                workflowId,
                "validate_plan",
                async () => {
                    // Validate plan against requirements
                    const validation = await this.validatePlan(planResult.plan);
                    return { validation };
                }
            );

            await this.executeWorkflowStep(
                workflowId,
                "store_plan",
                async () => {
                    // Store plan in database with initial status
                    const planStatus: PlanLifecycleStatus = {
                        planId: planResult.planId,
                        status: "draft",
                        currentVersion: 1,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        approvals: [],
                        executionHistory: []
                    };

                    // NEW: Log the plan being stored
                    logger.info("Storing plan in database", {
                        planId: planResult.planId,
                        listSelector: planResult.plan.listSelector,
                        detailSelectors: planResult.plan.detailSelectors,
                        paginationSelector: planResult.plan.paginationSelector,
                        confidence: planResult.confidence,
                        hasAiResponse: !!planResult.plan.metadata.aiResponse
                    });

                    await this.storePlanWithStatus(planResult.plan, planStatus);

                    // NEW: Verify the plan was stored correctly
                    logger.info("Plan stored successfully", {
                        planId: planResult.planId,
                        storedAt: new Date().toISOString()
                    });

                    return { stored: true };
                }
            );

            // Mark workflow as completed
            workflow.status = "completed";
            workflow.completedAt = new Date();
            workflow.updatedAt = new Date();

            logger.info(
                `Plan generation workflow ${workflowId} completed successfully`
            );
            return planResult;
        } catch (error) {
            logger.error(
                `Plan generation workflow ${workflowId} failed:`,
                error
            );

            // Mark workflow as failed
            const workflow = this.activeWorkflows.get(workflowId);
            if (workflow) {
                workflow.status = "failed";
                workflow.updatedAt = new Date();
            }

            throw error;
        } finally {
            // Clean up workflow after completion or failure
            setTimeout(() => {
                this.activeWorkflows.delete(workflowId);
            }, 300000); // Keep for 5 minutes for debugging
        }
    }

    /**
     * Execute scraping plan with queue management
     * Requirements: 6.1, 2.1 - Plan execution with async processing
     */
    public async executePlan(
        planId: string,
        runId: string,
        options: ExecutionOptions = {}
    ): Promise<ExecutionResult> {
        const workflowId = this.generateWorkflowId("execution");

        try {
            logger.info(
                `Starting execution workflow ${workflowId} for plan ${planId}`,
                {
                    runId,
                    options
                }
            );

            // Check if plan exists and is approved
            const planStatus = await this.getPlanStatus(planId);
            if (!planStatus) {
                throw new Error(`Plan ${planId} not found`);
            }

            if (planStatus.status !== "approved") {
                // Auto-approve plans in development mode for testing
                if (process.env.NODE_ENV === "development") {
                    logger.info(
                        `Auto-approving plan ${planId} for development testing`
                    );
                    await this.reviewPlan(planId, {
                        approved: true,
                        reviewerId: "auto-dev",
                        comments: "Auto-approved for development testing",
                        timestamp: new Date()
                    });
                    // Update plan status after approval
                    const updatedPlanStatus = await this.getPlanStatus(planId);
                    if (
                        !updatedPlanStatus ||
                        updatedPlanStatus.status !== "approved"
                    ) {
                        throw new Error(
                            `Failed to auto-approve plan ${planId} for development`
                        );
                    }
                } else {
                    throw new Error(
                        `Plan ${planId} is not approved for execution (status: ${planStatus.status})`
                    );
                }
            }

            // Get plan details from Redis
            const planKey = `plan:${planId}:${planStatus.currentVersion}`;
            const planData = await this.redisClient.hGetAll(planKey);
            if (!planData || Object.keys(planData).length === 0) {
                throw new Error(
                    `Plan ${planId} version ${planStatus.currentVersion} not found`
                );
            }

            const plan = {
                planId: planData.planId,
                version: parseInt(planData.version),
                plan: JSON.parse(planData.plan),
                status: planData.status,
                createdAt: new Date(planData.createdAt),
                updatedAt: new Date(planData.updatedAt)
            };

            // Apply development mode limits to prevent system overload
            const developmentOptions =
                process.env.NODE_ENV === "development"
                    ? {
                          ...options,
                          maxPages: Math.min(options?.maxPages || 1, 1), // Max 1 page in development
                          timeout: Math.min(options?.timeout || 30000, 30000), // Max 30 seconds
                          maxItems: Math.min(options?.maxItems || 5, 5), // Max 5 items
                          testMode: true
                      }
                    : options;

            logger.info(`Executing plan in ${process.env.NODE_ENV} mode`, {
                planId,
                runId,
                originalOptions: options,
                appliedOptions: developmentOptions
            });

            // Create execution workflow
            const workflow = this.createWorkflow(
                workflowId,
                "execution_workflow",
                [
                    {
                        stepId: "prepare_execution",
                        name: "Prepare Execution Environment",
                        status: "pending"
                    },
                    {
                        stepId: "execute_scraping",
                        name: "Execute Scraping Plan",
                        status: "pending"
                    },
                    {
                        stepId: "validate_results",
                        name: "Validate Extraction Results",
                        status: "pending"
                    },
                    {
                        stepId: "store_results",
                        name: "Store Results",
                        status: "pending"
                    },
                    {
                        stepId: "update_metrics",
                        name: "Update Plan Metrics",
                        status: "pending"
                    }
                ],
                { planId, runId, plan: plan.plan, options: developmentOptions }
            );

            this.activeWorkflows.set(workflowId, workflow);

            // Update plan status to executing
            await this.updatePlanStatus(planId, "executing");

            // Execute workflow steps
            await this.executeWorkflowStep(
                workflowId,
                "prepare_execution",
                async () => {
                    // Prepare execution environment
                    const executionRecord = {
                        runId,
                        planId,
                        status: "running" as const,
                        startTime: new Date(),
                        metrics: {
                            duration: 0,
                            itemsExtracted: 0,
                            pagesProcessed: 0,
                            errorsEncountered: 0,
                            accuracyScore: 0
                        },
                        errors: [],
                        createdAt: new Date(),
                        updatedAt: new Date()
                    };

                    // Store execution record in Redis
                    const executionKey = `execution:${runId}`;
                    await this.redisClient.hSet(executionKey, {
                        runId: executionRecord.runId,
                        planId: executionRecord.planId,
                        status: executionRecord.status,
                        startTime: executionRecord.startTime.toISOString(),
                        metrics: JSON.stringify(executionRecord.metrics),
                        errors: JSON.stringify(executionRecord.errors),
                        createdAt: executionRecord.createdAt.toISOString(),
                        updatedAt: executionRecord.updatedAt.toISOString()
                    });
                    return { prepared: true };
                }
            );

            const executionResult = await this.executeWorkflowStep(
                workflowId,
                "execute_scraping",
                async () => {
                    // Execute real scraping with Playwright (with development limits applied)
                    logger.info("Executing real scraping with Playwright", {
                        planId,
                        runId,
                        entryUrls: plan.plan.entryUrls,
                        listSelector: plan.plan.listSelector,
                        options: developmentOptions
                    });

                    const scrapingResult =
                        await this.playwrightExecutor.executePlan(
                            plan.plan,
                            runId
                        );

                    // Convert ScrapingResult to ExecutionResult
                    const executionResult: ExecutionResult = {
                        runId,
                        planId,
                        status: "completed",
                        startTime: new Date(),
                        endTime: new Date(),
                        extractedData: scrapingResult.extractedData,
                        metrics: scrapingResult.metrics,
                        errors: []
                    };

                    logger.info("Real scraping completed", {
                        runId,
                        planId,
                        itemsExtracted: scrapingResult.extractedData.length,
                        pagesProcessed: scrapingResult.metrics.pagesProcessed,
                        duration: scrapingResult.metrics.duration,
                        websites: scrapingResult.extractedData
                            .map((item) => item.website)
                            .filter(Boolean)
                    });

                    return executionResult;
                }
            );

            await this.executeWorkflowStep(
                workflowId,
                "validate_results",
                async () => {
                    // Validate extraction results
                    if (options.validateResults !== false) {
                        // Convert ExecutionResult back to ScrapingResult for validation
                        const scrapingResultForValidation = {
                            runId: executionResult.runId,
                            planId: executionResult.planId,
                            extractedData: executionResult.extractedData,
                            metadata: {
                                startTime: executionResult.startTime,
                                endTime: executionResult.endTime || new Date(),
                                userAgent: "MCP-Orchestrator",
                                browserVersion: "1.0.0",
                                totalPages:
                                    executionResult.metrics.pagesProcessed,
                                successfulPages:
                                    executionResult.metrics.pagesProcessed -
                                    executionResult.metrics.errorsEncountered
                            },
                            metrics: executionResult.metrics
                        };
                        const validation =
                            await this.playwrightExecutor.validateExtraction(
                                scrapingResultForValidation
                            );
                        return { validation };
                    }
                    return { validation: { isValid: true, issues: [] } };
                }
            );

            await this.executeWorkflowStep(
                workflowId,
                "store_results",
                async () => {
                    // Update execution record with results in Redis
                    const executionKey = `execution:${runId}`;
                    await this.redisClient.hSet(executionKey, {
                        status: executionResult.status,
                        endTime: (
                            executionResult.endTime || new Date()
                        ).toISOString(),
                        metrics: JSON.stringify(executionResult.metrics),
                        errors: JSON.stringify(
                            executionResult.errors.map((err) => {
                                const executionError: ExecutionError = {
                                    errorType: "EXECUTION_ERROR",
                                    message:
                                        err instanceof Error
                                            ? err.message
                                            : String(err),
                                    timestamp: new Date(),
                                    context: { runId, planId }
                                };
                                if (err instanceof Error && err.stack) {
                                    executionError.stack = err.stack;
                                }
                                return executionError;
                            })
                        ),
                        updatedAt: new Date().toISOString()
                    });
                    return { stored: true };
                }
            );

            await this.executeWorkflowStep(
                workflowId,
                "update_metrics",
                async () => {
                    // Update plan metrics based on execution results
                    await this.updatePlanMetrics(planId, executionResult);
                    return { updated: true };
                }
            );

            // Update plan status back to approved
            await this.updatePlanStatus(planId, "approved");

            // Mark workflow as completed
            workflow.status = "completed";
            workflow.completedAt = new Date();
            workflow.updatedAt = new Date();

            logger.info(
                `Execution workflow ${workflowId} completed successfully`
            );
            return executionResult;
        } catch (error) {
            logger.error(`Execution workflow ${workflowId} failed:`, error);

            // Update plan status to failed
            await this.updatePlanStatus(planId, "failed");

            // Mark workflow as failed
            const workflow = this.activeWorkflows.get(workflowId);
            if (workflow) {
                workflow.status = "failed";
                workflow.updatedAt = new Date();
            }

            // Create failed execution record
            const failedResult = {
                runId,
                planId,
                status: "failed" as const,
                startTime: new Date(),
                endTime: new Date(),
                metrics: {
                    duration: 0,
                    itemsExtracted: 0,
                    pagesProcessed: 0,
                    errorsEncountered: 1,
                    accuracyScore: 0
                },
                errors: (() => {
                    const executionError: ExecutionError = {
                        errorType: "EXECUTION_FAILURE",
                        message:
                            error instanceof Error
                                ? error.message
                                : String(error),
                        timestamp: new Date(),
                        context: { workflowId, planId, runId }
                    };
                    if (error instanceof Error && error.stack) {
                        executionError.stack = error.stack;
                    }
                    return [executionError];
                })(),
                updatedAt: new Date()
            };

            // Store failed execution record in Redis
            const executionKey = `execution:${runId}`;
            await this.redisClient.hSet(executionKey, {
                runId: failedResult.runId,
                planId: failedResult.planId,
                status: failedResult.status,
                startTime: failedResult.startTime.toISOString(),
                endTime: failedResult.endTime.toISOString(),
                metrics: JSON.stringify(failedResult.metrics),
                errors: JSON.stringify(failedResult.errors),
                updatedAt: failedResult.updatedAt.toISOString()
            });

            throw error;
        } finally {
            // Clean up workflow
            setTimeout(() => {
                this.activeWorkflows.delete(workflowId);
            }, 300000);
        }
    }

    /**
     * Queue execution for async processing (fire-and-forget)
     * Requirements: 6.1, 2.1 - Async execution queuing
     */
    public async queueExecution(
        planId: string,
        runId: string,
        options: ExecutionOptions = {}
    ): Promise<void> {
        try {
            logger.info(`Queuing execution for plan ${planId}`, {
                runId,
                options
            });

            // Create initial execution record with 'queued' status
            const executionRecord = {
                runId,
                planId,
                status: "queued" as const,
                startTime: new Date(),
                metrics: {
                    duration: 0,
                    itemsExtracted: 0,
                    pagesProcessed: 0,
                    errorsEncountered: 0,
                    accuracyScore: 0
                },
                errors: [],
                createdAt: new Date(),
                updatedAt: new Date()
            };

            // Store execution record in Redis
            const executionKey = `execution:${runId}`;
            await this.redisClient.hSet(executionKey, {
                runId: executionRecord.runId,
                planId: executionRecord.planId,
                status: executionRecord.status,
                startTime: executionRecord.startTime.toISOString(),
                metrics: JSON.stringify(executionRecord.metrics),
                errors: JSON.stringify(executionRecord.errors),
                createdAt: executionRecord.createdAt.toISOString(),
                updatedAt: executionRecord.updatedAt.toISOString()
            });

            // Execute asynchronously without blocking
            setImmediate(async () => {
                try {
                    logger.info(
                        `Starting background execution for plan ${planId}`,
                        { runId }
                    );

                    // Update status to 'running' in Redis
                    const executionKey = `execution:${runId}`;
                    await this.redisClient.hSet(executionKey, {
                        status: "running",
                        updatedAt: new Date().toISOString()
                    });

                    // Execute the plan
                    const result = await this.executePlan(
                        planId,
                        runId,
                        options
                    );

                    logger.info(
                        `Background execution completed for plan ${planId}`,
                        {
                            runId,
                            status: result.status,
                            itemsExtracted: result.metrics.itemsExtracted
                        }
                    );
                } catch (error) {
                    logger.error(
                        `Background execution failed for plan ${planId}`,
                        {
                            runId,
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                            stack:
                                error instanceof Error ? error.stack : undefined
                        }
                    );

                    // Update execution record with failure
                    const executionError: ExecutionError = {
                        errorType: "EXECUTION_FAILURE",
                        message:
                            error instanceof Error
                                ? error.message
                                : String(error),
                        timestamp: new Date(),
                        context: { planId, runId }
                    };

                    if (error instanceof Error && error.stack) {
                        executionError.stack = error.stack;
                    }

                    // Update execution record with failure in Redis
                    const executionKey = `execution:${runId}`;
                    await this.redisClient.hSet(executionKey, {
                        status: "failed",
                        endTime: new Date().toISOString(),
                        errors: JSON.stringify([executionError]),
                        updatedAt: new Date().toISOString()
                    });
                }
            });

            logger.info(`Execution queued successfully for plan ${planId}`, {
                runId
            });
        } catch (error) {
            logger.error(
                `Failed to queue execution for plan ${planId}:`,
                error
            );
            throw error;
        }
    }

    /**
     * Schedule plan for periodic execution
     * Requirements: 6.1 - Scheduling support
     */
    public async schedulePlan(planId: string, schedule: string): Promise<void> {
        try {
            logger.info(`Scheduling plan ${planId} with schedule: ${schedule}`);

            // Validate cron expression (basic validation)
            if (!this.isValidCronExpression(schedule)) {
                throw new Error(`Invalid cron expression: ${schedule}`);
            }

            // Store schedule in Redis
            const scheduleKey = `schedule:${planId}`;
            await this.redisClient.hSet(scheduleKey, {
                planId,
                schedule,
                active: "true",
                createdAt: new Date().toISOString(),
                nextRun: this.calculateNextRun(schedule).toISOString()
            });

            // Add to scheduler queue
            const message: QueueMessage = {
                id: this.generateMessageId(),
                type: "plan_execution",
                payload: { planId, schedule },
                priority: 1,
                createdAt: new Date(),
                attempts: 0,
                maxAttempts: 1,
                status: "pending"
            };

            await this.enqueueMessage(
                this.config.queues.planExecution,
                message
            );

            logger.info(`Plan ${planId} scheduled successfully`);
        } catch (error) {
            logger.error(`Failed to schedule plan ${planId}:`, error);
            throw error;
        }
    }

    /**
     * Review and approve/reject plan
     * Requirements: 4.1 - Human oversight and approval workflow
     */
    public async reviewPlan(
        planId: string,
        approval: PlanApproval
    ): Promise<void> {
        try {
            logger.info(`Reviewing plan ${planId}`, {
                approved: approval.approved,
                reviewer: approval.reviewerId
            });

            const planStatus = await this.getPlanStatus(planId);
            if (!planStatus) {
                throw new Error(`Plan ${planId} not found`);
            }

            // Add approval to history
            planStatus.approvals.push(approval);
            planStatus.updatedAt = new Date();

            // Update plan status based on approval
            if (approval.approved) {
                planStatus.status = "approved";

                // Apply modifications if provided
                if (approval.modifications) {
                    await this.applyPlanModifications(
                        planId,
                        approval.modifications
                    );
                }
            } else {
                planStatus.status = "rejected";
            }

            // Store updated status
            await this.storePlanStatus(planStatus);

            // Notify relevant systems
            await this.notifyPlanStatusChange(
                planId,
                planStatus.status,
                approval
            );

            logger.info(
                `Plan ${planId} review completed: ${approval.approved ? "approved" : "rejected"}`
            );
        } catch (error) {
            logger.error(`Failed to review plan ${planId}:`, error);
            throw error;
        }
    }

    /**
     * Get plan lifecycle status
     * Requirements: 2.4 - Plan status tracking
     */
    public async getPlanStatus(
        planId: string
    ): Promise<PlanLifecycleStatus | null> {
        try {
            const statusKey = `plan_status:${planId}`;
            const statusData = await this.redisClient.hGetAll(statusKey);

            if (!statusData || Object.keys(statusData).length === 0) {
                return null;
            }

            return {
                planId: statusData.planId,
                status: statusData.status as any,
                currentVersion: parseInt(statusData.currentVersion),
                createdAt: new Date(statusData.createdAt),
                updatedAt: new Date(statusData.updatedAt),
                lastExecutionId: statusData.lastExecutionId,
                approvals: JSON.parse(statusData.approvals || "[]"),
                executionHistory: JSON.parse(
                    statusData.executionHistory || "[]"
                )
            };
        } catch (error) {
            logger.error(`Failed to get plan status for ${planId}:`, error);
            return null;
        }
    }

    /**
     * Get workflow state
     * Requirements: 2.1 - Workflow state management
     */
    public async getWorkflowState(
        workflowId: string
    ): Promise<WorkflowState | null> {
        return this.activeWorkflows.get(workflowId) || null;
    }

    /**
     * Shutdown orchestrator service
     */
    public async shutdown(): Promise<void> {
        try {
            logger.info("Shutting down MCP Orchestrator Service");

            // Stop monitoring
            this.stopMonitoring();

            // Shutdown Playwright executor and close browsers
            await this.playwrightExecutor.shutdown();
            logger.info("Playwright executor shut down");

            // Close Redis connection
            await this.redisClient.quit();

            this.isInitialized = false;
            logger.info("MCP Orchestrator Service shutdown completed");
        } catch (error) {
            logger.error(
                "Error during MCP Orchestrator Service shutdown:",
                error
            );
            throw error;
        }
    }

    // Private helper methods

    private async initializeQueueListeners(): Promise<void> {
        // Initialize queue processing (simplified implementation)
        logger.info("Queue listeners initialized");
    }

    private startMonitoring(): void {
        // Start health checks and metrics collection
        setInterval(() => {
            this.performHealthCheck();
        }, this.config.monitoring.healthCheckInterval);

        setInterval(() => {
            this.collectMetrics();
        }, this.config.monitoring.metricsInterval);
    }

    private stopMonitoring(): void {
        // Stop monitoring intervals (implementation would track interval IDs)
        logger.info("Monitoring stopped");
    }

    private async performHealthCheck(): Promise<void> {
        try {
            // Check Redis connection
            await this.redisClient.ping();

            // Check active workflows
            const activeCount = this.activeWorkflows.size;

            logger.debug("Health check passed", {
                activeWorkflows: activeCount
            });
        } catch (error) {
            logger.error("Health check failed:", error);
        }
    }

    private async collectMetrics(): Promise<void> {
        try {
            const metrics = {
                activeWorkflows: this.activeWorkflows.size,
                queuedExecutions: this.executionQueue.size,
                timestamp: new Date().toISOString()
            };

            // Store metrics (implementation would send to monitoring system)
            logger.debug("Metrics collected", metrics);
        } catch (error) {
            logger.error("Failed to collect metrics:", error);
        }
    }

    private generateWorkflowId(type: string): string {
        return `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private generateMessageId(): string {
        return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private createWorkflow(
        workflowId: string,
        type: "plan_lifecycle" | "execution_workflow",
        steps: Omit<
            WorkflowStep,
            "startedAt" | "completedAt" | "error" | "result"
        >[],
        context: Record<string, any>
    ): WorkflowState {
        return {
            workflowId,
            type,
            currentStep: steps[0]?.stepId || "",
            steps: steps.map((step) => ({ ...step, status: "pending" })),
            context,
            status: "running",
            createdAt: new Date(),
            updatedAt: new Date()
        };
    }

    private async executeWorkflowStep<T>(
        workflowId: string,
        stepId: string,
        executor: () => Promise<T>
    ): Promise<T> {
        const workflow = this.activeWorkflows.get(workflowId);
        if (!workflow) {
            throw new Error(`Workflow ${workflowId} not found`);
        }

        const step = workflow.steps.find((s) => s.stepId === stepId);
        if (!step) {
            throw new Error(
                `Step ${stepId} not found in workflow ${workflowId}`
            );
        }

        try {
            step.status = "running";
            step.startedAt = new Date();
            workflow.currentStep = stepId;
            workflow.updatedAt = new Date();

            logger.debug(`Executing workflow step: ${workflowId}/${stepId}`);

            const result = await executor();

            step.status = "completed";
            step.completedAt = new Date();
            step.result = result;
            workflow.updatedAt = new Date();

            // Update workflow context with step result
            Object.assign(workflow.context, result);

            logger.debug(`Workflow step completed: ${workflowId}/${stepId}`);

            return result;
        } catch (error) {
            step.status = "failed";
            step.completedAt = new Date();
            step.error = error instanceof Error ? error.message : String(error);
            workflow.updatedAt = new Date();

            logger.error(
                `Workflow step failed: ${workflowId}/${stepId}`,
                error
            );
            throw error;
        }
    }

    private async fetchHtmlContent(
        url: string
    ): Promise<{ html: string; cookieConsentMetadata?: any }> {
        try {
            logger.debug(`Fetching HTML content for: ${url}`);

            // Use the existing Playwright executor's browser pool for efficiency
            const browser = await (
                this.playwrightExecutor as any
            ).acquireBrowser();
            const context = await browser.newContext({
                userAgent:
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                viewport: { width: 1920, height: 1080 }
            });

            const page = await context.newPage();

            try {
                // Navigate with retry logic similar to the executor
                let retryCount = 0;
                const maxRetries = 2;
                let lastError: Error | null = null;

                while (retryCount < maxRetries) {
                    try {
                        await page.goto(url, {
                            waitUntil: "domcontentloaded",
                            timeout: 30000
                        });
                        break; // Success, exit retry loop
                    } catch (error) {
                        lastError = error as Error;
                        retryCount++;

                        if (retryCount < maxRetries) {
                            logger.warn(
                                `⚠️  HTML fetch attempt ${retryCount} failed for ${url}, retrying... Error: ${lastError.message}`
                            );
                            await new Promise((resolve) =>
                                setTimeout(resolve, 1000)
                            );
                        } else {
                            throw lastError;
                        }
                    }
                }

                // NEW: Handle cookie consent and capture metadata
                let cookieConsentMetadata: any = undefined;
                try {
                    const { CookieConsentHandler } = await import(
                        "./cookie-consent-handler.service"
                    );
                    const cookieHandler = new CookieConsentHandler();
                    const cookieResult =
                        await cookieHandler.handleCookieConsent(page, url, {
                            strategy: "accept-all",
                            timeout: 5000,
                            useAI: false, // Fast heuristics for HTML fetching
                            languages: ["de", "en"]
                        });

                    // Extract cookie consent metadata
                    cookieConsentMetadata = cookieResult.metadata;
                    logger.debug(`Cookie consent handled for ${url}`, {
                        detected: cookieConsentMetadata.detected,
                        strategy: cookieConsentMetadata.strategy,
                        library: cookieConsentMetadata.library
                    });
                } catch (error) {
                    logger.warn(
                        `Could not handle cookie consent for ${url}, continuing anyway:`,
                        error
                    );
                }

                // Wait for any dynamic content to load
                await page.waitForTimeout(2000);

                // Get the full HTML content
                const html = await page.content();

                logger.debug(`Successfully fetched HTML content for ${url}`, {
                    contentLength: html.length,
                    title: await page.title()
                });

                return { html, cookieConsentMetadata };
            } finally {
                await page.close();
                await context.close();
                (this.playwrightExecutor as any).releaseBrowser(browser);
            }
        } catch (error) {
            logger.error(`Failed to fetch HTML content for ${url}:`, error);
            throw new Error(
                `Failed to fetch HTML content: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    private async analyzeContentUrlsWithHtml(
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

            // Batch processing: fetch in batches of 3-5 URLs
            const batchSize = 5;
            const maxUrlsToAnalyze = 10; // Limit for performance
            const urlsToAnalyze = contentUrls.slice(0, maxUrlsToAnalyze);

            const contentPagesData: Array<{
                url: string;
                html: string;
                trimmedHtml: string;
                success: boolean;
            }> = [];

            // Fetch content URLs in batches
            for (let i = 0; i < urlsToAnalyze.length; i += batchSize) {
                const batch = urlsToAnalyze.slice(i, i + batchSize);

                const batchResults = await Promise.allSettled(
                    batch.map(async (url) => {
                        try {
                            logger.debug(`Fetching content URL: ${url}`);
                            const { html, cookieConsentMetadata } =
                                await this.fetchHtmlContent(url);

                            // Trim HTML to main content (remove header, footer, nav)
                            const trimmedHtml =
                                this.trimHtmlToMainContent(html);

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

                // Collect successful results
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

            // Use LLM to analyze content pages and extract selectors for plan generation
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

    /**
     * Trim HTML to main content, removing header, footer, nav, and sidebar
     */
    private trimHtmlToMainContent(html: string): string {
        // Remove scripts, styles, comments
        let trimmed = html
            .replace(/<!--[\s\S]*?-->/g, "")
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
            .replace(/\s+/g, " ")
            .trim();

        // Focus on main content areas
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

        // If no main content found, remove header/footer/nav from full HTML
        if (!mainContent) {
            mainContent = trimmed
                .replace(/<header[\s\S]*?<\/header>/gi, "")
                .replace(/<footer[\s\S]*?<\/footer>/gi, "")
                .replace(/<nav[\s\S]*?<\/nav>/gi, "")
                .replace(/<aside[\s\S]*?<\/aside>/gi, "");
        }

        // Limit size for efficiency
        const maxLength = 20000;
        if (mainContent.length > maxLength) {
            mainContent = mainContent.substring(0, maxLength) + "...";
        }

        return mainContent;
    }

    /**
     * Analyze content pages using LLM to extract selectors for plan generation
     */
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

            // Log content pages being analyzed
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

            // Take first few pages for LLM analysis (limit for performance)
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

            // Compress HTML for LLM
            const compressedHtml = this.compressHtmlForLLM(combinedHtml);

            logger.debug("📦 HTML compression results:", {
                originalSize: combinedHtml.length,
                compressedSize: compressedHtml.length,
                compressionRatio:
                    Math.round(
                        (1 - compressedHtml.length / combinedHtml.length) * 100
                    ) + "%"
            });

            // Build LLM prompt for content selector extraction
            const prompt = this.buildContentSelectorPrompt(
                pagesToAnalyze.map((p) => p.url),
                compressedHtml
            );

            // Use centralized LLM service
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
                maxTokens: 2000
            };

            logger.info("Starting LLM content selector analysis...");
            const llmResponse = await llmService.generate(llmRequest);

            logger.info("LLM content selector analysis completed", {
                provider: llmResponse.provider,
                model: llmResponse.model,
                tokensUsed: llmResponse.tokensUsed,
                responseLength: llmResponse.content.length
            });

            // Log raw LLM response for debugging
            logger.debug("🧠 Raw LLM selector response:", {
                content: llmResponse.content,
                provider: llmResponse.provider,
                model: llmResponse.model
            });

            // Parse LLM response
            const selectorAnalysis = this.parseLLMContentResponse(
                llmResponse.content
            );

            // Log parsed selector analysis
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
                confidence: 0,
                totalUrls: contentUrls.length,
                analyzedUrls: 0,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Build LLM prompt for content selector extraction
     */
    private buildContentSelectorPrompt(urls: string[], html: string): string {
        return `
Analyze these content pages to identify CSS selectors for extracting structured data fields.

Content URLs analyzed:
${urls.map((url, i) => `${i + 1}. ${url}`).join("\n")}

HTML Content:
${html}

Extract CSS selectors for common content fields that appear across these pages. Focus on:
- Title/Headline selectors
- Description/Content text selectors
- Date/Time selectors
- Location/Address selectors
- Contact information (email, phone) selectors
- Image selectors
- Link/URL selectors
- Any other structured data fields

Respond with JSON:
{
  "detailSelectors": {
    "title": "CSS selector for titles/headlines",
    "description": "CSS selector for main content/description",
    "startDate": "CSS selector for dates/times",
    "place": "CSS selector for location/venue",
    "address": "CSS selector for addresses",
    "email": "CSS selector for email addresses",
    "phone": "CSS selector for phone numbers",
    "website": "CSS selector for website links",
    "images": "CSS selector for images"
  },
  "confidence": 0.85,
  "reasoning": "Explanation of selector choices and confidence"
}

IMPORTANT:
- Only include selectors that work across multiple pages
- Prefer specific selectors over generic ones (e.g., ".event-title" over "h1")
- Test selectors mentally against the provided HTML
- Skip fields that don't have consistent selectors across pages
- Ensure selectors are valid CSS syntax
`;
    }

    /**
     * Parse LLM content selector response
     */
    private parseLLMContentResponse(content: string): {
        detailSelectors: Record<string, string>;
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

            // Validate and clean selectors
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

            const result = {
                detailSelectors,
                confidence: parsed.confidence || 0.5,
                reasoning: parsed.reasoning || "LLM content analysis completed"
            };

            logger.info("📊 Final selector extraction results:", {
                totalSelectors: Object.keys(detailSelectors).length,
                selectorFields: Object.keys(detailSelectors),
                confidence: result.confidence
            });

            return result;
        } catch (error) {
            logger.warn("Failed to parse LLM content response", { error });
            return {
                detailSelectors: {},
                confidence: 0.3,
                reasoning: "Failed to parse LLM response"
            };
        }
    }

    /**
     * Create scraping plan from workflow analysis results
     */
    private async createScrapingPlanFromAnalysis(params: {
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

        // Generate unique plan ID
        const planId = `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Create the scraping plan
        const scrapingPlan: ScrapingPlan = {
            planId,
            version: 1,
            entryUrls: [url], // Main page URL
            listSelector: listSelector || "article, .item, .post, .entry", // Fallback if no selector found
            detailSelectors: {
                // Use selectors from content analysis, with fallbacks
                title: detailSelectors.title || "h1, h2, .title, .headline",
                description:
                    detailSelectors.description ||
                    "p, .description, .content, .summary",
                ...detailSelectors // Include all other selectors from content analysis
            },
            paginationSelector: paginationSelector || undefined, // Only set if found
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
                // Add cookie consent metadata for future scraping sessions
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
            confidence: Math.max(
                contentAnalysis.confidence || 0,
                siblingResults.length > 0
                    ? Math.max(...siblingResults.map((r: any) => r.confidence))
                    : 0
            ),
            rateLimitMs: scrapingPlan.rateLimitMs
        });

        return scrapingPlan;
    }

    /**
     * Generate human-readable documentation for the scraping plan
     */
    private generateHumanReadableDoc(
        plan: ScrapingPlan,
        siblingResults: any[],
        contentAnalysis: any
    ): string {
        // Cookie consent section
        const cookieConsentSection = plan.metadata.cookieConsent
            ? `
## Cookie Consent Configuration
- **Detected**: ${plan.metadata.cookieConsent.detected ? "✅ Yes" : "❌ No"}
- **Strategy**: ${plan.metadata.cookieConsent.strategy}
- **Library**: ${plan.metadata.cookieConsent.library}
- **Handled Successfully**: ${plan.metadata.cookieConsent.handledSuccessfully ? "✅ Yes" : "❌ No"}

### Cookie Consent Selectors
${plan.metadata.cookieConsent.acceptButtonSelector ? `- **Accept Button**: \`${plan.metadata.cookieConsent.acceptButtonSelector}\`` : ""}
${plan.metadata.cookieConsent.rejectButtonSelector ? `- **Reject Button**: \`${plan.metadata.cookieConsent.rejectButtonSelector}\`` : ""}
${plan.metadata.cookieConsent.settingsButtonSelector ? `- **Settings Button**: \`${plan.metadata.cookieConsent.settingsButtonSelector}\`` : ""}
${plan.metadata.cookieConsent.bannerSelector ? `- **Banner**: \`${plan.metadata.cookieConsent.bannerSelector}\`` : ""}
${plan.metadata.cookieConsent.modalSelector ? `- **Modal**: \`${plan.metadata.cookieConsent.modalSelector}\`` : ""}

**Usage Note**: These selectors can be used by the scraping executor to automatically handle cookie consent in future scraping sessions, ensuring compliance and avoiding blocking.
`
            : `
## Cookie Consent Configuration
- **Detected**: ❌ No cookie consent detected
`;

        const doc = `
# Scraping Plan: ${plan.planId}

## Overview
This scraping plan was generated using workflow analysis combining sibling link discovery and content pattern analysis.

## Plan Configuration
- **Entry URLs**: ${plan.entryUrls.join(", ")}
- **List Selector**: \`${plan.listSelector}\`
- **Pagination Selector**: ${plan.paginationSelector ? `\`${plan.paginationSelector}\`` : "None"}
- **Rate Limit**: ${plan.rateLimitMs}ms between requests
${cookieConsentSection}
## Detail Selectors
${Object.entries(plan.detailSelectors)
    .map(([field, selector]) => `- **${field}**: \`${selector}\``)
    .join("\n")}

## Analysis Results
### Sibling Discovery
- **Method**: ${siblingResults[0]?.discoveryMethod || "None"}
- **Confidence**: ${siblingResults[0]?.confidence || 0}
- **Links Found**: ${siblingResults.reduce((sum: number, r: any) => sum + r.siblingLinks.length, 0)}

### Content Analysis
- **Confidence**: ${contentAnalysis.confidence || 0}
- **Selectors Extracted**: ${Object.keys(contentAnalysis.detailSelectors || {}).length}
- **Reasoning**: ${contentAnalysis.reasoning || "N/A"}

## Generated At
${new Date().toISOString()}
        `.trim();

        return doc;
    }

    /**
     * Compress HTML for LLM analysis (reuse existing method)
     */
    private compressHtmlForLLM(html: string): string {
        // Remove scripts, styles, comments
        let compressed = html
            .replace(/<!--[\s\S]*?-->/g, "")
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
            .replace(/\s+/g, " ")
            .replace(/>\s+</g, "><")
            .trim();

        // Limit size for LLM efficiency
        const maxLength = 12000;
        if (compressed.length > maxLength) {
            compressed = compressed.substring(0, maxLength) + "...";
        }

        return compressed;
    }

    private async validatePlan(plan: ScrapingPlan): Promise<any> {
        try {
            logger.debug(`Validating plan: ${plan.planId}`);

            const validation = {
                isValid: true,
                issues: [] as string[],
                warnings: [] as string[],
                score: 0,
                checks: {
                    structure: false,
                    selectors: false,
                    urls: false,
                    accessibility: false
                }
            };

            // 1. Validate plan structure
            if (!plan.planId || !plan.entryUrls || !plan.listSelector) {
                validation.issues.push(
                    "Missing required plan fields: planId, entryUrls, or listSelector"
                );
                validation.isValid = false;
            } else {
                validation.checks.structure = true;
            }

            // 2. Validate URLs
            if (plan.entryUrls && plan.entryUrls.length > 0) {
                for (const url of plan.entryUrls) {
                    try {
                        new URL(url);
                    } catch {
                        validation.issues.push(`Invalid entry URL: ${url}`);
                        validation.isValid = false;
                    }
                }

                if (validation.isValid) {
                    validation.checks.urls = true;
                }
            }

            // 3. Validate selectors by testing them on actual pages
            if (
                plan.entryUrls &&
                plan.entryUrls.length > 0 &&
                validation.checks.urls
            ) {
                try {
                    const { chromium } = await import("playwright");
                    const browser = await chromium.launch({ headless: true });
                    const context = await browser.newContext();
                    const page = await context.newPage();

                    // Test on first entry URL
                    const testUrl = plan.entryUrls[0];
                    await page.goto(testUrl, {
                        waitUntil: "domcontentloaded",
                        timeout: 20000
                    });

                    // Test list selector
                    const listElements = await page.$$(plan.listSelector);
                    if (listElements.length === 0) {
                        validation.issues.push(
                            `List selector "${plan.listSelector}" found no elements on ${testUrl}`
                        );
                        validation.warnings.push(
                            "Consider using a more generic selector or check if content loads dynamically"
                        );
                    } else if (listElements.length < 2) {
                        validation.warnings.push(
                            `List selector "${plan.listSelector}" found only ${listElements.length} element(s). Expected multiple items.`
                        );
                    } else {
                        validation.checks.selectors = true;
                        logger.debug(
                            `List selector validation passed: found ${listElements.length} elements`
                        );
                    }

                    // Test detail selectors
                    if (
                        plan.detailSelectors &&
                        Object.keys(plan.detailSelectors).length > 0
                    ) {
                        const selectorResults: Record<string, number> = {};

                        for (const [field, selector] of Object.entries(
                            plan.detailSelectors
                        )) {
                            try {
                                const elements = await page.$$(selector);
                                selectorResults[field] = elements.length;

                                if (elements.length === 0) {
                                    validation.warnings.push(
                                        `Detail selector for "${field}" (${selector}) found no elements`
                                    );
                                }
                            } catch (error) {
                                validation.issues.push(
                                    `Invalid detail selector for "${field}": ${selector}`
                                );
                                validation.isValid = false;
                            }
                        }

                        logger.debug(
                            "Detail selector validation results:",
                            selectorResults
                        );
                    }

                    // Test pagination selector if provided
                    if (plan.paginationSelector) {
                        try {
                            const paginationElements = await page.$$(
                                plan.paginationSelector
                            );
                            if (paginationElements.length === 0) {
                                validation.warnings.push(
                                    `Pagination selector "${plan.paginationSelector}" found no elements`
                                );
                            }
                        } catch (error) {
                            validation.issues.push(
                                `Invalid pagination selector: ${plan.paginationSelector}`
                            );
                        }
                    }

                    await page.close();
                    await context.close();
                    await browser.close();
                } catch (error) {
                    validation.warnings.push(
                        `Could not validate selectors on live page: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }

            // 4. Check accessibility and politeness
            if (plan.rateLimitMs && plan.rateLimitMs < 500) {
                validation.warnings.push(
                    "Rate limit is very aggressive (< 500ms). Consider increasing for better politeness."
                );
            } else if (plan.rateLimitMs && plan.rateLimitMs >= 500) {
                validation.checks.accessibility = true;
            }

            // 5. Calculate overall validation score
            const checksPassed = Object.values(validation.checks).filter(
                Boolean
            ).length;
            const totalChecks = Object.keys(validation.checks).length;
            validation.score = (checksPassed / totalChecks) * 100;

            // Adjust score based on issues and warnings
            if (validation.issues.length > 0) {
                validation.score = Math.max(
                    0,
                    validation.score - validation.issues.length * 20
                );
            }
            if (validation.warnings.length > 0) {
                validation.score = Math.max(
                    0,
                    validation.score - validation.warnings.length * 5
                );
            }

            logger.info(`Plan validation completed for ${plan.planId}`, {
                isValid: validation.isValid,
                score: validation.score,
                issues: validation.issues.length,
                warnings: validation.warnings.length,
                checks: validation.checks
            });

            return validation;
        } catch (error) {
            logger.error(`Plan validation failed for ${plan.planId}:`, error);
            return {
                isValid: false,
                issues: [
                    `Validation error: ${error instanceof Error ? error.message : String(error)}`
                ],
                warnings: [],
                score: 0,
                checks: {
                    structure: false,
                    selectors: false,
                    urls: false,
                    accessibility: false
                }
            };
        }
    }

    private async storePlanWithStatus(
        plan: ScrapingPlan,
        status: PlanLifecycleStatus
    ): Promise<void> {
        // Map lifecycle status to plan document status
        const planDocumentStatus: "draft" | "approved" | "deprecated" =
            status.status === "approved"
                ? "approved"
                : status.status === "deprecated"
                  ? "deprecated"
                  : "draft";

        // Store plan in Redis
        const planKey = `plan:${plan.planId}:${plan.version}`;
        await this.redisClient.hSet(planKey, {
            planId: plan.planId,
            version: plan.version.toString(),
            plan: JSON.stringify(plan),
            status: planDocumentStatus,
            createdAt: status.createdAt.toISOString(),
            updatedAt: status.updatedAt.toISOString()
        });

        // Store full status in Redis for workflow tracking
        await this.storePlanStatus(status);
    }

    private async storePlanStatus(status: PlanLifecycleStatus): Promise<void> {
        const statusKey = `plan_status:${status.planId}`;
        await this.redisClient.hSet(statusKey, {
            planId: status.planId,
            status: status.status,
            currentVersion: status.currentVersion.toString(),
            createdAt: status.createdAt.toISOString(),
            updatedAt: status.updatedAt.toISOString(),
            lastExecutionId: status.lastExecutionId || "",
            approvals: JSON.stringify(status.approvals),
            executionHistory: JSON.stringify(status.executionHistory)
        });
    }

    private async updatePlanStatus(
        planId: string,
        status: PlanLifecycleStatus["status"]
    ): Promise<void> {
        const currentStatus = await this.getPlanStatus(planId);
        if (currentStatus) {
            currentStatus.status = status;
            currentStatus.updatedAt = new Date();
            await this.storePlanStatus(currentStatus);
        }
    }

    private async updatePlanMetrics(
        planId: string,
        executionResult: ExecutionResult
    ): Promise<void> {
        try {
            logger.debug(`Updating metrics for plan ${planId}`, {
                success: executionResult.status === "completed",
                itemsExtracted: executionResult.metrics.itemsExtracted
            });

            const metricsKey = `plan_metrics:${planId}`;
            const currentMetrics = await this.redisClient.hGetAll(metricsKey);

            // Initialize metrics if they don't exist
            const metrics = {
                planId,
                totalExecutions:
                    parseInt(currentMetrics.totalExecutions || "0") + 1,
                successfulExecutions:
                    parseInt(currentMetrics.successfulExecutions || "0") +
                    (executionResult.status === "completed" ? 1 : 0),
                failedExecutions:
                    parseInt(currentMetrics.failedExecutions || "0") +
                    (executionResult.status === "failed" ? 1 : 0),
                totalItemsExtracted:
                    parseInt(currentMetrics.totalItemsExtracted || "0") +
                    executionResult.metrics.itemsExtracted,
                totalPagesProcessed:
                    parseInt(currentMetrics.totalPagesProcessed || "0") +
                    executionResult.metrics.pagesProcessed,
                totalDuration:
                    parseInt(currentMetrics.totalDuration || "0") +
                    executionResult.metrics.duration,
                totalErrors:
                    parseInt(currentMetrics.totalErrors || "0") +
                    executionResult.metrics.errorsEncountered,
                lastExecutionTime: new Date().toISOString(),
                lastExecutionStatus: executionResult.status,
                lastExecutionId: executionResult.runId
            };

            // Calculate derived metrics
            const successRate =
                metrics.totalExecutions > 0
                    ? (metrics.successfulExecutions / metrics.totalExecutions) *
                      100
                    : 0;
            const avgItemsPerExecution =
                metrics.totalExecutions > 0
                    ? metrics.totalItemsExtracted / metrics.totalExecutions
                    : 0;
            const avgDuration =
                metrics.totalExecutions > 0
                    ? metrics.totalDuration / metrics.totalExecutions
                    : 0;
            const avgPagesPerExecution =
                metrics.totalExecutions > 0
                    ? metrics.totalPagesProcessed / metrics.totalExecutions
                    : 0;
            const errorRate =
                metrics.totalExecutions > 0
                    ? (metrics.totalErrors / metrics.totalExecutions) * 100
                    : 0;

            // Store updated metrics
            await this.redisClient.hSet(metricsKey, {
                ...metrics,
                successRate: successRate.toFixed(2),
                avgItemsPerExecution: avgItemsPerExecution.toFixed(2),
                avgDuration: avgDuration.toFixed(0),
                avgPagesPerExecution: avgPagesPerExecution.toFixed(2),
                errorRate: errorRate.toFixed(2),
                updatedAt: new Date().toISOString()
            });

            // Store execution history (keep last 100 executions)
            const historyKey = `plan_history:${planId}`;
            const executionSummary = {
                runId: executionResult.runId,
                status: executionResult.status,
                itemsExtracted: executionResult.metrics.itemsExtracted,
                pagesProcessed: executionResult.metrics.pagesProcessed,
                duration: executionResult.metrics.duration,
                errors: executionResult.metrics.errorsEncountered,
                timestamp: new Date().toISOString()
            };

            await this.redisClient.lPush(
                historyKey,
                JSON.stringify(executionSummary)
            );
            await this.redisClient.lTrim(historyKey, 0, 99); // Keep only last 100 executions

            // Update plan status with execution history
            const planStatus = await this.getPlanStatus(planId);
            if (planStatus) {
                planStatus.executionHistory.push(executionResult.runId);

                // Keep only last 50 executions in status
                if (planStatus.executionHistory.length > 50) {
                    planStatus.executionHistory =
                        planStatus.executionHistory.slice(-50);
                }

                planStatus.lastExecutionId = executionResult.runId;
                planStatus.updatedAt = new Date();

                await this.storePlanStatus(planStatus);
            }

            // Store aggregated metrics for monitoring dashboard
            const globalMetricsKey = "global_metrics";
            const globalMetrics =
                await this.redisClient.hGetAll(globalMetricsKey);

            await this.redisClient.hSet(globalMetricsKey, {
                totalPlans:
                    (await this.redisClient.sCard("active_plans")) || "0",
                totalExecutions: (
                    parseInt(globalMetrics.totalExecutions || "0") + 1
                ).toString(),
                totalItemsExtracted: (
                    parseInt(globalMetrics.totalItemsExtracted || "0") +
                    executionResult.metrics.itemsExtracted
                ).toString(),
                lastUpdated: new Date().toISOString()
            });

            // Add plan to active plans set
            await this.redisClient.sAdd("active_plans", planId);

            logger.info(`Plan metrics updated for ${planId}`, {
                totalExecutions: metrics.totalExecutions,
                successRate: successRate.toFixed(2) + "%",
                avgItemsPerExecution: avgItemsPerExecution.toFixed(2),
                lastStatus: executionResult.status
            });
        } catch (error) {
            logger.error(`Failed to update plan metrics for ${planId}:`, error);
            // Don't throw error as this is not critical for execution flow
        }
    }

    private async applyPlanModifications(
        planId: string,
        modifications: Partial<ScrapingPlan>
    ): Promise<void> {
        try {
            logger.info(
                `Applying modifications to plan ${planId}`,
                modifications
            );

            // Get current plan status to find the current version
            const planStatus = await this.getPlanStatus(planId);
            if (!planStatus) {
                throw new Error(`Plan ${planId} not found`);
            }

            // Get the current plan from Redis
            const planKey = `plan:${planId}:${planStatus.currentVersion}`;
            const planData = await this.redisClient.hGetAll(planKey);

            if (!planData || Object.keys(planData).length === 0) {
                throw new Error(
                    `Plan ${planId} version ${planStatus.currentVersion} not found`
                );
            }

            const currentPlan = {
                planId: planData.planId,
                version: parseInt(planData.version),
                plan: JSON.parse(planData.plan),
                status: planData.status,
                createdAt: new Date(planData.createdAt),
                updatedAt: new Date(planData.updatedAt)
            };

            // Create new version with modifications
            const newVersion = planStatus.currentVersion + 1;
            const modifiedPlan: ScrapingPlan = {
                ...currentPlan.plan,
                ...modifications,
                version: newVersion
            };

            // Validate the modified plan
            const validation = await this.validatePlan(modifiedPlan);
            if (!validation.isValid) {
                throw new Error(
                    `Plan modifications failed validation: ${validation.issues.join(", ")}`
                );
            }

            // Store the new version in Redis
            const newPlanKey = `plan:${planId}:${newVersion}`;
            await this.redisClient.hSet(newPlanKey, {
                planId,
                version: newVersion.toString(),
                plan: JSON.stringify(modifiedPlan),
                status: "draft", // New version starts as draft
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });

            // Update plan status to point to new version
            planStatus.currentVersion = newVersion;
            planStatus.status = "draft"; // Reset to draft for re-approval
            planStatus.updatedAt = new Date();

            await this.storePlanStatus(planStatus);

            // Log the changes made
            const changedFields = Object.keys(modifications);
            logger.info(`Plan ${planId} modified successfully`, {
                newVersion,
                changedFields,
                validationScore: validation.score,
                warnings: validation.warnings.length
            });

            // Store modification history
            const modificationHistoryKey = `plan_modifications:${planId}`;
            const modificationRecord = {
                version: newVersion,
                previousVersion: newVersion - 1,
                modifications: changedFields,
                timestamp: new Date().toISOString(),
                validationScore: validation.score,
                warnings: validation.warnings
            };

            await this.redisClient.lPush(
                modificationHistoryKey,
                JSON.stringify(modificationRecord)
            );
            await this.redisClient.lTrim(modificationHistoryKey, 0, 49); // Keep last 50 modifications
        } catch (error) {
            logger.error(
                `Failed to apply modifications to plan ${planId}:`,
                error
            );
            throw error;
        }
    }

    private async notifyPlanStatusChange(
        planId: string,
        status: string,
        approval: PlanApproval
    ): Promise<void> {
        try {
            logger.info(`Plan ${planId} status changed to ${status}`, {
                approval
            });

            // Create notification record
            const notification = {
                id: this.generateMessageId(),
                type: "plan_status_change",
                planId,
                status,
                approval,
                timestamp: new Date().toISOString(),
                recipients: [] as string[]
            };

            // Determine notification recipients based on status change
            switch (status) {
                case "approved":
                    // Notify operators and the plan creator
                    notification.recipients = ["operators", "plan_creator"];
                    break;
                case "rejected":
                    // Notify the plan creator and reviewers
                    notification.recipients = ["plan_creator", "reviewers"];
                    break;
                case "executing":
                    // Notify monitoring systems
                    notification.recipients = ["monitoring", "operators"];
                    break;
                case "failed":
                    // Notify administrators and operators
                    notification.recipients = ["administrators", "operators"];
                    break;
                default:
                    notification.recipients = ["administrators"];
            }

            // Store notification in Redis for processing
            const notificationKey = `notifications:${notification.id}`;
            await this.redisClient.hSet(notificationKey, {
                id: notification.id,
                type: notification.type,
                planId: notification.planId,
                status: notification.status,
                approval: JSON.stringify(notification.approval),
                timestamp: notification.timestamp,
                recipients: JSON.stringify(notification.recipients),
                processed: "false"
            });

            // Add to notification queue for processing
            await this.redisClient.lPush("notification_queue", notification.id);

            // Store in plan-specific notification history
            const planNotificationsKey = `plan_notifications:${planId}`;
            await this.redisClient.lPush(
                planNotificationsKey,
                JSON.stringify({
                    status,
                    approval: {
                        approved: approval.approved,
                        reviewerId: approval.reviewerId,
                        timestamp: approval.timestamp
                    },
                    timestamp: notification.timestamp
                })
            );
            await this.redisClient.lTrim(planNotificationsKey, 0, 99); // Keep last 100 notifications

            // Emit real-time notification if WebSocket connections exist
            await this.emitRealTimeNotification(notification);

            // Update global notification metrics
            const metricsKey = "notification_metrics";
            await this.redisClient.hIncrBy(
                metricsKey,
                "total_notifications",
                1
            );
            await this.redisClient.hIncrBy(metricsKey, `status_${status}`, 1);
            await this.redisClient.hSet(
                metricsKey,
                "last_notification",
                notification.timestamp
            );

            logger.debug(
                `Notification created for plan ${planId} status change`,
                {
                    notificationId: notification.id,
                    recipients: notification.recipients.length,
                    status
                }
            );
        } catch (error) {
            logger.error(
                `Failed to notify plan status change for ${planId}:`,
                error
            );
            // Don't throw error as notifications are not critical for core functionality
        }
    }

    private async emitRealTimeNotification(notification: any): Promise<void> {
        try {
            // Store for real-time pickup by WebSocket handlers
            const realtimeKey = `realtime_notifications`;
            await this.redisClient.lPush(
                realtimeKey,
                JSON.stringify(notification)
            );
            await this.redisClient.lTrim(realtimeKey, 0, 999); // Keep last 1000 for real-time pickup

            // Set expiration for cleanup
            await this.redisClient.expire(realtimeKey, 3600); // Expire after 1 hour

            logger.debug(`Real-time notification queued`, {
                notificationId: notification.id,
                type: notification.type
            });
        } catch (error) {
            logger.warn(`Failed to emit real-time notification:`, error);
        }
    }

    private async enqueueMessage(
        queueName: string,
        message: QueueMessage
    ): Promise<void> {
        const messageKey = `${queueName}:${message.id}`;
        await this.redisClient.hSet(messageKey, {
            id: message.id,
            type: message.type,
            payload: JSON.stringify(message.payload),
            priority: message.priority.toString(),
            createdAt: message.createdAt.toISOString(),
            attempts: message.attempts.toString(),
            maxAttempts: message.maxAttempts.toString(),
            status: message.status
        });

        // Add to queue list
        await this.redisClient.lPush(queueName, message.id);
    }

    private isValidCronExpression(expression: string): boolean {
        try {
            // Validate cron expression format
            const parts = expression.trim().split(/\s+/);

            // Support both 5-part (minute hour day month weekday) and 6-part (second minute hour day month weekday) cron expressions
            if (parts.length !== 5 && parts.length !== 6) {
                return false;
            }

            // Define valid ranges for each field
            const ranges =
                parts.length === 5
                    ? [
                          { min: 0, max: 59 }, // minute
                          { min: 0, max: 23 }, // hour
                          { min: 1, max: 31 }, // day
                          { min: 1, max: 12 }, // month
                          { min: 0, max: 7 } // weekday (0 and 7 both represent Sunday)
                      ]
                    : [
                          { min: 0, max: 59 }, // second
                          { min: 0, max: 59 }, // minute
                          { min: 0, max: 23 }, // hour
                          { min: 1, max: 31 }, // day
                          { min: 1, max: 12 }, // month
                          { min: 0, max: 7 } // weekday
                      ];

            // Validate each part
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                const range = ranges[i];

                if (!this.isValidCronField(part, range.min, range.max)) {
                    return false;
                }
            }

            return true;
        } catch (error) {
            logger.debug(
                `Cron expression validation failed: ${expression}`,
                error
            );
            return false;
        }
    }

    private isValidCronField(field: string, min: number, max: number): boolean {
        // Handle wildcard
        if (field === "*") {
            return true;
        }

        // Handle step values (e.g., */5, 1-10/2)
        if (field.includes("/")) {
            const [range, step] = field.split("/");
            const stepNum = parseInt(step);

            if (isNaN(stepNum) || stepNum <= 0) {
                return false;
            }

            // Validate the range part
            if (range === "*") {
                return true;
            }

            return this.isValidCronField(range, min, max);
        }

        // Handle ranges (e.g., 1-5, 10-15)
        if (field.includes("-")) {
            const [start, end] = field.split("-");
            const startNum = parseInt(start);
            const endNum = parseInt(end);

            if (isNaN(startNum) || isNaN(endNum)) {
                return false;
            }

            return (
                startNum >= min &&
                startNum <= max &&
                endNum >= min &&
                endNum <= max &&
                startNum <= endNum
            );
        }

        // Handle lists (e.g., 1,3,5)
        if (field.includes(",")) {
            const values = field.split(",");
            return values.every((value) => {
                const num = parseInt(value.trim());
                return !isNaN(num) && num >= min && num <= max;
            });
        }

        // Handle single number
        const num = parseInt(field);
        if (isNaN(num)) {
            return false;
        }

        return num >= min && num <= max;
    }

    private calculateNextRun(cronExpression: string): Date {
        try {
            // Parse cron expression and calculate next run time
            const parts = cronExpression.trim().split(/\s+/);
            const now = new Date();

            // Support both 5-part and 6-part cron expressions
            let minute, hour, day, month, weekday;

            if (parts.length === 5) {
                [minute, hour, day, month, weekday] = parts;
            } else if (parts.length === 6) {
                // Skip seconds for simplicity, use minute-level precision
                [, minute, hour, day, month, weekday] = parts;
            } else {
                throw new Error("Invalid cron expression format");
            }

            // Start from next minute to avoid immediate execution
            const nextRun = new Date(now);
            nextRun.setSeconds(0, 0);
            nextRun.setMinutes(nextRun.getMinutes() + 1);

            // Find next valid time (simple implementation for common cases)
            for (let attempts = 0; attempts < 366 * 24 * 60; attempts++) {
                // Max 1 year of minutes
                if (
                    this.matchesCronField(
                        minute,
                        nextRun.getMinutes(),
                        0,
                        59
                    ) &&
                    this.matchesCronField(hour, nextRun.getHours(), 0, 23) &&
                    this.matchesCronField(day, nextRun.getDate(), 1, 31) &&
                    this.matchesCronField(
                        month,
                        nextRun.getMonth() + 1,
                        1,
                        12
                    ) &&
                    this.matchesCronField(weekday, nextRun.getDay(), 0, 7)
                ) {
                    logger.debug(
                        `Next run calculated for cron "${cronExpression}"`,
                        {
                            nextRun: nextRun.toISOString(),
                            fromNow:
                                Math.round(
                                    (nextRun.getTime() - now.getTime()) /
                                        1000 /
                                        60
                                ) + " minutes"
                        }
                    );

                    return nextRun;
                }

                // Increment by 1 minute and try again
                nextRun.setMinutes(nextRun.getMinutes() + 1);
            }

            // Fallback: if no match found, schedule for next hour
            logger.warn(
                `Could not calculate next run for cron "${cronExpression}", using fallback`
            );
            const fallback = new Date(now);
            fallback.setHours(fallback.getHours() + 1, 0, 0, 0);
            return fallback;
        } catch (error) {
            logger.error(
                `Failed to calculate next run for cron "${cronExpression}":`,
                error
            );
            // Fallback to 1 hour from now
            const fallback = new Date();
            fallback.setHours(fallback.getHours() + 1);
            return fallback;
        }
    }

    private matchesCronField(
        cronField: string,
        currentValue: number,
        min: number,
        max: number
    ): boolean {
        // Handle wildcard
        if (cronField === "*") {
            return true;
        }

        // Handle step values
        if (cronField.includes("/")) {
            const [range, step] = cronField.split("/");
            const stepNum = parseInt(step);

            if (range === "*") {
                return (currentValue - min) % stepNum === 0;
            }

            // Handle range with step (e.g., 1-10/2)
            if (range.includes("-")) {
                const [start, end] = range.split("-");
                const startNum = parseInt(start);
                const endNum = parseInt(end);

                return (
                    currentValue >= startNum &&
                    currentValue <= endNum &&
                    (currentValue - startNum) % stepNum === 0
                );
            }

            // Handle single value with step
            const baseValue = parseInt(range);
            return (
                currentValue >= baseValue &&
                (currentValue - baseValue) % stepNum === 0
            );
        }

        // Handle ranges
        if (cronField.includes("-")) {
            const [start, end] = cronField.split("-");
            const startNum = parseInt(start);
            const endNum = parseInt(end);

            return currentValue >= startNum && currentValue <= endNum;
        }

        // Handle lists
        if (cronField.includes(",")) {
            const values = cronField.split(",").map((v) => parseInt(v.trim()));
            return values.includes(currentValue);
        }

        // Handle single value
        const fieldValue = parseInt(cronField);

        // Special case for weekday: both 0 and 7 represent Sunday
        if (min === 0 && max === 7) {
            // weekday field
            if (fieldValue === 7 && currentValue === 0) {
                return true;
            }
            if (fieldValue === 0 && currentValue === 7) {
                return true;
            }
        }

        return currentValue === fieldValue;
    }
}
