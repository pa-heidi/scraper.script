/**
 * Playwright Executor Service
 * Implements plan execution logic with browser pool management
 * Requirements: 6.3, 6.4, 5.1, 5.2, 5.3
 */

import { Browser, BrowserContext, Page, chromium } from 'playwright';
import { ScrapingPlan, ExtractedItem, ExecutionMetrics, ExecutionOptions } from '../interfaces/core';
import { logger } from '../utils/logger';

export interface PlaywrightExecutorConfig {
  maxBrowsers: number;
  browserTimeout: number;
  pageTimeout: number;
  defaultRateLimit: number;
  maxRetries: number;
}

export interface ScrapingResult {
  runId: string;
  planId: string;
  extractedData: ExtractedItem[];
  metadata: ExecutionMetadata;
  metrics: ExecutionMetrics;
}

export interface ExecutionMetadata {
  startTime: Date;
  endTime: Date;
  userAgent: string;
  browserVersion: string;
  totalPages: number;
  successfulPages: number;
}

export interface TestResult {
  success: boolean;
  extractedSamples: ExtractedItem[];
  errors: string[];
  confidence: number;
  executionTime: number;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  completenessScore: number;
}

export class PlaywrightExecutor {
  private browsers: Browser[] = [];
  private availableBrowsers: Browser[] = [];
  private config: PlaywrightExecutorConfig;
  private isShuttingDown = false;

  constructor(config: Partial<PlaywrightExecutorConfig> = {}) {
    this.config = {
      maxBrowsers: config.maxBrowsers || 3,
      browserTimeout: config.browserTimeout || 60000, // Increased to 60 seconds
      pageTimeout: config.pageTimeout || 30000, // Increased to 30 seconds
      defaultRateLimit: config.defaultRateLimit || 1000,
      maxRetries: config.maxRetries || 3,
      ...config,
    };
  }

  /**
   * Initialize browser pool
   */
  async initialize(): Promise<void> {
    logger.info(
      `🚀 Initializing Playwright executor with browser pool (${this.config.maxBrowsers} browsers)`
    );

    try {
      for (let i = 0; i < this.config.maxBrowsers; i++) {
        logger.info(`   🌐 Launching browser ${i + 1}/${this.config.maxBrowsers}...`);

        const browser = await chromium.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
          ],
        });

        this.browsers.push(browser);
        this.availableBrowsers.push(browser);
        logger.info(`   ✅ Browser ${i + 1} launched successfully`);
      }

      logger.info(`✅ Browser pool initialized with ${this.browsers.length} browsers`);
    } catch (error) {
      logger.error('❌ Failed to initialize browser pool:', error);

      // Clean up any browsers that were created before the error
      for (const browser of this.browsers) {
        try {
          await browser.close();
        } catch (closeError) {
          logger.error('Error closing browser during cleanup:', closeError);
        }
      }

      this.browsers = [];
      this.availableBrowsers = [];
      throw error;
    }
  }

  /**
   * Execute a scraping plan
   */
  async executePlan(plan: ScrapingPlan, runId: string, options?: ExecutionOptions): Promise<ScrapingResult> {
    const startTime = new Date();
    logger.info(`🚀 Starting plan execution: ${plan.planId}, run: ${runId}`);
    logger.info(`📋 Plan details:`, {
      planId: plan.planId,
      entryUrls: plan.entryUrls,
      listSelector: plan.listSelector,
      paginationSelector: plan.paginationSelector,
      rateLimitMs: plan.rateLimitMs,
    });

    logger.info(`🌐 Will scrape ${plan.entryUrls.length} entry URL(s):`);
    plan.entryUrls.forEach((url, index) => {
      logger.info(`   ${index + 1}. ${url}`);
    });

    const browser = await this.acquireBrowser();
    logger.info(`🔧 Acquired browser from pool`);
    let context: BrowserContext | null = null;

    try {
      context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (compatible; AI-Scraper/1.0)',
        viewport: { width: 1920, height: 1080 },
      });

      const extractedData: ExtractedItem[] = [];
      let totalPages = 0;
      let successfulPages = 0;
      let errorsEncountered = 0;

      // Process each entry URL
      for (let i = 0; i < plan.entryUrls.length; i++) {
        const entryUrl = plan.entryUrls[i];
        logger.info(`📄 Processing entry URL ${i + 1}/${plan.entryUrls.length}: ${entryUrl}`);

        try {
          if (plan.rateLimitMs > 0) {
            logger.info(`⏳ Applying rate limit: ${plan.rateLimitMs}ms`);
            await this.applyRateLimit(plan.rateLimitMs);
          }

          const pageResults = await this.processEntryUrl(context, entryUrl, plan, options);

          logger.info(`✅ Entry URL ${i + 1} processed:`, {
            url: entryUrl,
            itemsFound: pageResults.items.length,
            pagesProcessed: pageResults.pagesProcessed,
            successfulPages: pageResults.successfulPages,
            errors: pageResults.errors,
            pageResults: pageResults.pageResults.map(pr => ({
              pageUrl: pr.pageUrl,
              pageNumber: pr.pageNumber,
              contentResultsCount: pr.contentResults.length,
              successfulContent: pr.contentResults.filter(cr => cr.success).length
            }))
          });

          extractedData.push(...pageResults.items);
          totalPages += pageResults.pagesProcessed;
          successfulPages += pageResults.successfulPages;
          errorsEncountered += pageResults.errors;
        } catch (error) {
          logger.error(`❌ Failed to process entry URL ${entryUrl}:`, error);
          errorsEncountered++;
        }
      }

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      const metrics: ExecutionMetrics = {
        duration,
        itemsExtracted: extractedData.length,
        pagesProcessed: totalPages,
        errorsEncountered,
        accuracyScore: this.calculateAccuracyScore(extractedData),
      };

      const metadata: ExecutionMetadata = {
        startTime,
        endTime,
        userAgent: 'Mozilla/5.0 (compatible; AI-Scraper/1.0)',
        browserVersion: browser.version(),
        totalPages,
        successfulPages,
      };

      logger.info(`🎉 Plan execution completed successfully!`, {
        runId,
        planId: plan.planId,
        totalItemsExtracted: extractedData.length,
        totalPagesProcessed: totalPages,
        successfulPages,
        errorsEncountered,
        duration: `${duration}ms`,
        accuracyScore: metrics.accuracyScore,
      });

      // Log sample of extracted data
      if (extractedData.length > 0) {
        logger.info(`📊 Sample of extracted data:`);
        extractedData.slice(0, 3).forEach((item, index) => {
          logger.info(`   ${index + 1}. "${item.title}" - ${item.website || 'No website'}`);
        });
      }

      return {
        runId,
        planId: plan.planId,
        extractedData,
        metadata,
        metrics,
      };
    } finally {
      if (context) {
        await context.close();
      }
      this.releaseBrowser(browser);
    }
  }

  /**
   * Test a scraping plan with limited execution
   */
  async testPlan(plan: ScrapingPlan): Promise<TestResult> {
    const startTime = Date.now();
    logger.info(`Testing plan: ${plan.planId}`);

    const browser = await this.acquireBrowser();
    let context: BrowserContext | null = null;

    try {
      context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (compatible; AI-Scraper-Test/1.0)',
        viewport: { width: 1920, height: 1080 },
      });

      const errors: string[] = [];
      const extractedSamples: ExtractedItem[] = [];

      // Test only the first entry URL with limited items
      if (plan.entryUrls.length > 0) {
        try {
          const testUrl = plan.entryUrls[0];
          const page = await context.newPage();

          // Navigate with retry logic for testing
          let retryCount = 0;
          const maxRetries = 2; // Fewer retries for testing

          while (retryCount < maxRetries) {
            try {
              await page.goto(testUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 30000,
              });
              break;
            } catch (error) {
              retryCount++;
              if (retryCount < maxRetries) {
                logger.warn(`⚠️  Test page load attempt ${retryCount} failed, retrying...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
              } else {
                throw error;
              }
            }
          }

          // Extract a few sample items for testing
          const items = await this.extractItemsFromPage(page, plan, 3); // Limit to 3 items
          extractedSamples.push(...items);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          errors.push(`Test execution failed: ${errorMsg}`);
          logger.error('Test execution error:', error);
        }
      }

      const executionTime = Date.now() - startTime;
      const success = errors.length === 0 && extractedSamples.length > 0;
      const confidence = this.calculateTestConfidence(extractedSamples, errors);

      return {
        success,
        extractedSamples,
        errors,
        confidence,
        executionTime,
      };
    } finally {
      if (context) {
        await context.close();
      }
      this.releaseBrowser(browser);
    }
  }

  /**
   * Validate extracted data against schema
   */
  async validateExtraction(result: ScrapingResult): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    let validItems = 0;

    for (const item of result.extractedData) {
      const itemErrors = this.validateExtractedItem(item);
      if (itemErrors.length === 0) {
        validItems++;
      } else {
        errors.push(...itemErrors);
      }

      // Check for warnings (missing optional fields)
      if (!item.place && !item.address) {
        warnings.push(`Item "${item.title}" missing location information`);
      }
      if (!item.startDate && !item.endDate && item.dates.length === 0) {
        warnings.push(`Item "${item.title}" missing date information`);
      }
    }

    const completenessScore =
      result.extractedData.length > 0 ? validItems / result.extractedData.length : 0;

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      completenessScore,
    };
  }

  /**
   * Process a single entry URL with pagination support
   */
  private async processEntryUrl(
    context: BrowserContext,
    entryUrl: string,
    plan: ScrapingPlan,
    options?: ExecutionOptions
  ): Promise<{
    items: ExtractedItem[];
    pagesProcessed: number;
    successfulPages: number;
    errors: number;
    pageResults: Array<{
      pageUrl: string;
      pageNumber: number;
      contentResults: Array<{
        contentUrl: string;
        item: ExtractedItem | null;
        success: boolean;
        error?: string;
      }>;
    }>;
  }> {
    const items: ExtractedItem[] = [];
    const pageResults: Array<{
      pageUrl: string;
      pageNumber: number;
      contentResults: Array<{
        contentUrl: string;
        item: ExtractedItem | null;
        success: boolean;
        error?: string;
      }>;
    }> = [];

    let pagesProcessed = 0;
    let successfulPages = 0;
    let errors = 0;
    let currentUrl: string | null = entryUrl;
    let pageNumber = 1;

    // Get testing limits from options
    const testMode = options?.testMode ?? false;
    const maxPages = testMode ? (options?.maxPages ?? 2) : (options?.maxPages ?? 50);
    const maxItemsPerPage = testMode ? (options?.maxItemsPerPage ?? 2) : undefined;

    logger.info(`🔍 Starting to process entry URL: ${entryUrl}`, {
      testMode,
      maxPages,
      maxItemsPerPage
    });

    // STEP 1 & 2: Process pages with cookie consent handling and content URL extraction
    do {
      try {
        logger.info(`📖 Processing page ${pageNumber}: ${currentUrl}`);
        const page = await context.newPage();

        try {
          // Navigate to page
          await page.goto(currentUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });

          logger.info(`✅ Page ${pageNumber} loaded successfully`);

          // Handle cookie consent ONCE on the first page (entry page) using plan metadata
          if (pageNumber === 1 && plan.metadata.cookieConsent?.detected) {
            logger.info(`🍪 Handling cookie consent on entry page using plan metadata: ${currentUrl}`);

            // Use cookie consent information from plan metadata
            const cookieConsentInfo = plan.metadata.cookieConsent;
            logger.info(`Using stored cookie consent strategy: ${cookieConsentInfo.strategy} (library: ${cookieConsentInfo.library})`, {
              hasAcceptSelector: !!cookieConsentInfo.acceptButtonSelector,
              hasRejectSelector: !!cookieConsentInfo.rejectButtonSelector,
              hasSettingsSelector: !!cookieConsentInfo.settingsButtonSelector,
              handledSuccessfully: cookieConsentInfo.handledSuccessfully,
              acceptSelector: cookieConsentInfo.acceptButtonSelector,
              rejectSelector: cookieConsentInfo.rejectButtonSelector
            });

            // If the plan indicates cookie consent was handled successfully before,
            // and we have the necessary selectors, use them directly for faster execution
            if (cookieConsentInfo.handledSuccessfully &&
                (cookieConsentInfo.acceptButtonSelector || cookieConsentInfo.rejectButtonSelector)) {

              try {
                // Use the stored selectors directly for faster handling
                const strategy = cookieConsentInfo.strategy as any || 'accept-all';
                let selectorToUse: string | undefined;

                if (strategy === 'accept-all' && cookieConsentInfo.acceptButtonSelector) {
                  selectorToUse = cookieConsentInfo.acceptButtonSelector;
                } else if (strategy === 'reject-all' && cookieConsentInfo.rejectButtonSelector) {
                  selectorToUse = cookieConsentInfo.rejectButtonSelector;
                } else if (cookieConsentInfo.acceptButtonSelector) {
                  selectorToUse = cookieConsentInfo.acceptButtonSelector; // Default fallback
                }

                if (selectorToUse) {
                  logger.info(`🎯 Using stored selector for direct cookie consent: ${selectorToUse}`);

                  // Wait for the element and click it directly
                  await page.waitForSelector(selectorToUse, { state: 'visible', timeout: 5000 });
                  await page.click(selectorToUse);
                  await page.waitForTimeout(1000); // Wait for consent to be processed

                  logger.info(`✅ Cookie consent handled directly using stored selector: ${selectorToUse}`);
                } else {
                  throw new Error('No suitable selector found in plan metadata');
                }
              } catch (directError) {
                // Fall back to the full cookie consent handler
                logger.warn(`Direct selector failed, falling back to CookieConsentHandler:`, directError);

                const { CookieConsentHandler } = await import('./cookie-consent-handler.service');
                const cookieHandler = new CookieConsentHandler();

                const consentResult = await cookieHandler.handleCookieConsent(page, currentUrl, {
                  strategy: cookieConsentInfo.strategy as any || 'accept-all',
                  timeout: 5000,
                  useAI: false, // Use heuristics since we have some metadata
                  languages: ['de', 'en', 'fr'],
                  retryAttempts: 2,
                });

                if (!consentResult.success) {
                  logger.warn(`Cookie consent handling failed for ${currentUrl} despite plan metadata:`, consentResult.error);
                } else {
                  logger.info(`✅ Cookie consent handled via fallback handler: ${consentResult.method} method, ${consentResult.duration}ms`);
                }
              }
            } else {
              // Use the full cookie consent handler if we don't have reliable metadata
              logger.info(`Using full CookieConsentHandler (no reliable selectors in plan metadata)`);

              const { CookieConsentHandler } = await import('./cookie-consent-handler.service');
              const cookieHandler = new CookieConsentHandler();

              const consentResult = await cookieHandler.handleCookieConsent(page, currentUrl, {
                strategy: cookieConsentInfo.strategy as any || 'accept-all',
                timeout: 5000,
                useAI: false, // Use heuristics since we have some metadata
                languages: ['de', 'en', 'fr'],
                retryAttempts: 2,
              });

              if (!consentResult.success) {
                logger.warn(`Cookie consent handling failed for ${currentUrl} despite plan metadata:`, consentResult.error);
              } else {
                logger.info(`✅ Cookie consent handled successfully using plan metadata: ${consentResult.method} method, ${consentResult.duration}ms`);
              }
            }
          } else if (pageNumber === 1) {
            logger.info(`🍪 No cookie consent detected in plan metadata for ${currentUrl}, skipping cookie handling`);
          }

          pagesProcessed++;

          // STEP 3: Extract content URLs from list items
          logger.info(`🔎 Extracting content URLs from page ${pageNumber} using selector: ${plan.listSelector}`);
          const contentUrls = await this.extractContentUrls(page, plan, maxItemsPerPage);

          logger.info(`📋 Found ${contentUrls.length} content URLs on page ${pageNumber}`);

          // STEP 4: Scrape each content page
          const pageContentResults: Array<{
            contentUrl: string;
            item: ExtractedItem | null;
            success: boolean;
            error?: string;
          }> = [];

          for (let i = 0; i < contentUrls.length; i++) {
            const contentUrl = contentUrls[i];
            try {
              logger.info(`📖 Scraping content page ${i + 1}/${contentUrls.length}: ${contentUrl}`);

              const extractedItem = await this.scrapeContentPage(context, contentUrl, plan);

              if (extractedItem) {
                items.push(extractedItem);
                pageContentResults.push({
                  contentUrl,
                  item: extractedItem,
                  success: true
                });
                logger.info(`✅ Content page ${i + 1} scraped successfully: "${extractedItem.title}"`);
              } else {
                pageContentResults.push({
                  contentUrl,
                  item: null,
                  success: false,
                  error: 'No content extracted'
                });
                logger.warn(`⚠️  Content page ${i + 1} failed: ${contentUrl}`);
              }
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              pageContentResults.push({
                contentUrl,
                item: null,
                success: false,
                error: errorMessage
              });
              logger.error(`❌ Error scraping content page ${i + 1}: ${errorMessage}`);
            }
          }

          // Store page results
          pageResults.push({
            pageUrl: currentUrl,
            pageNumber,
            contentResults: pageContentResults
          });

          if (pageContentResults.some(result => result.success)) {
            successfulPages++;
          }

          // STEP 5: Check for pagination
          if (plan.paginationSelector) {
            logger.info(`🔗 Checking for pagination using selector: ${plan.paginationSelector}`);
            currentUrl = await this.getNextPageUrl(page, plan.paginationSelector);

            if (currentUrl) {
              logger.info(`➡️  Found next page: ${currentUrl}`);
              pageNumber++;
            } else {
              logger.info(`🏁 No more pages found - pagination complete`);
            }
          } else {
            logger.info(`📄 No pagination selector provided - single page only`);
            currentUrl = null;
          }
        } finally {
          await page.close();
        }

        // Apply rate limiting between pages
        if (currentUrl) {
          logger.info(`⏳ Applying rate limit before next page: ${plan.rateLimitMs}ms`);
          await this.applyRateLimit(plan.rateLimitMs);
        }
      } catch (error) {
        logger.error(`❌ Error processing page ${pageNumber} (${currentUrl}):`, error);
        errors++;
        currentUrl = null; // Stop pagination on error
      }
    } while (currentUrl && pagesProcessed < maxPages);

    logger.info(`📊 Entry URL processing complete:`, {
      entryUrl,
      totalItems: items.length,
      pagesProcessed,
      successfulPages,
      errors,
      testMode,
      maxPages,
      maxItemsPerPage
    });

    return { items, pagesProcessed, successfulPages, errors, pageResults };
  }

  /**
   * Extract items from a single page
   */
  private async extractItemsFromPage(
    page: Page,
    plan: ScrapingPlan,
    maxItems?: number
  ): Promise<ExtractedItem[]> {
    const items: ExtractedItem[] = [];

    try {
      logger.info(`🔍 Looking for content using selector: ${plan.listSelector}`);

      // Wait for list elements to be present
      await page
        .waitForSelector(plan.listSelector, {
          timeout: 5000,
        })
        .catch(() => {
          logger.warn(`⚠️  List selector not found: ${plan.listSelector}`);
        });

      // Get all list items
      const listItems = await page.$$(plan.listSelector);
      logger.info(`📋 Found ${listItems.length} potential content items on page`);

      const itemsToProcess = maxItems ? listItems.slice(0, maxItems) : listItems;
      logger.info(
        `🎯 Processing ${itemsToProcess.length} items (${maxItems ? 'limited by maxItems' : 'all items'})`
      );

      for (let i = 0; i < itemsToProcess.length; i++) {
        const listItem = itemsToProcess[i];
        try {
          logger.info(`   📝 Extracting item ${i + 1}/${itemsToProcess.length}...`);
          const extractedItem = await this.extractSingleItem(listItem, plan);
          if (extractedItem) {
            logger.info(`   ✅ Item ${i + 1} extracted: "${extractedItem.title}"`);
            items.push(extractedItem);
          } else {
            logger.info(`   ⚠️  Item ${i + 1} skipped (missing required fields)`);
          }
        } catch (error) {
          logger.error(`   ❌ Error extracting item ${i + 1}:`, error);
        }
      }
    } catch (error) {
      logger.error('❌ Error extracting items from page:', error);
    }

    logger.info(`📦 Page extraction complete: ${items.length} valid items extracted`);
    return items;
  }

  /**
   * Extract data from a single list item
   */
  private async extractSingleItem(element: any, plan: ScrapingPlan): Promise<ExtractedItem | null> {
    try {
      const item: Partial<ExtractedItem> = {
        dates: [],
        images: [],
      };

      logger.info(
        `      🔧 Extracting fields using ${Object.keys(plan.detailSelectors).length} selectors`
      );

      // Extract each field using the plan's selectors
      for (const [field, selector] of Object.entries(plan.detailSelectors)) {
        try {
          const value = await this.extractFieldValue(element, selector, field);
          if (value !== null) {
            logger.info(`         ✅ ${field}: "${value}"`);
            (item as any)[field] = value;
          } else {
            logger.info(`         ⚠️  ${field}: not found`);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.info(`         ❌ ${field}: extraction failed - ${errorMessage}`);
        }
      }

      // Validate required fields
      if (!item.title || !item.description) {
        logger.info(
          `      ⚠️  Skipping item - missing required fields (title: ${!!item.title}, description: ${!!item.description})`
        );
        return null;
      }

      // Normalize and validate the extracted item
      const normalizedItem = this.normalizeExtractedItem(item as ExtractedItem);
      logger.info(`      ✅ Item successfully extracted and normalized`);
      return normalizedItem;
    } catch (error) {
      logger.error('      ❌ Error extracting single item:', error);
      return null;
    }
  }

  /**
   * Extract value for a specific field
   */
  private async extractFieldValue(element: any, selector: string, field: string): Promise<any> {
    try {
      const targetElement = await element.$(selector);
      if (!targetElement) {
        return null;
      }

      let value: any;

      // Handle different field types
      switch (field) {
        case 'images':
          const imgElements = await element.$$(selector);
          const imageUrls: string[] = [];
          for (const img of imgElements) {
            const src = await img.getAttribute('src');
            if (src) {
              imageUrls.push(this.resolveUrl(src, await element.page().url()));
            }
          }
          return imageUrls;

        case 'website':
          const href = await targetElement.getAttribute('href');
          return href ? this.resolveUrl(href, await element.page().url()) : null;

        case 'price':
        case 'discountPrice':
          const priceText = await targetElement.textContent();
          return this.parsePrice(priceText);

        case 'longitude':
        case 'latitude':
          const coordText = await targetElement.textContent();
          return this.parseCoordinate(coordText);

        case 'zipcode':
          const zipText = await targetElement.textContent();
          return this.parseZipcode(zipText);

        case 'startDate':
        case 'endDate':
          const dateText = await targetElement.textContent();
          return this.parseDate(dateText);

        case 'dates':
          const dateElements = await element.$$(selector);
          const dates: string[] = [];
          for (const dateEl of dateElements) {
            const dateText = await dateEl.textContent();
            const parsedDate = this.parseDate(dateText);
            if (parsedDate) {
              dates.push(parsedDate);
            }
          }
          return dates;

        default:
          value = await targetElement.textContent();
          return value ? value.trim() : null;
      }
    } catch (error) {
      logger.debug(`Error extracting field ${field}:`, error);
      return null;
    }
  }

  /**
   * Get next page URL for pagination
   */
  private async getNextPageUrl(page: Page, paginationSelector?: string): Promise<string | null> {
    if (!paginationSelector) {
      logger.info(`   📄 No pagination selector - single page only`);
      return null;
    }

    try {
      logger.info(`   🔗 Looking for next page link using: ${paginationSelector}`);
      const nextLink = await page.$(paginationSelector);
      if (!nextLink) {
        logger.info(`   🏁 No next page link found - end of pagination`);
        return null;
      }

      const href = await nextLink.getAttribute('href');
      if (!href) {
        logger.info(`   ⚠️  Next page link found but no href attribute`);
        return null;
      }

      const nextUrl = this.resolveUrl(href, page.url());
      logger.info(`   ➡️  Next page URL found: ${nextUrl}`);
      return nextUrl;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.info(`   ❌ Error getting next page URL: ${errorMessage}`);
      return null;
    }
  }

  /**
   * Apply rate limiting delay
   */
  private async applyRateLimit(delayMs: number): Promise<void> {
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  /**
   * Public method to acquire a browser from the pool for external services
   */
  public async acquireBrowserFromPool(): Promise<Browser> {
    return this.acquireBrowser();
  }

  /**
   * Public method to release a browser back to the pool for external services
   */
  public releaseBrowserToPool(browser: Browser): void {
    this.releaseBrowser(browser);
  }

  /**
   * Acquire a browser from the pool
   */
  private async acquireBrowser(): Promise<Browser> {
    logger.info(
      `🔍 Attempting to acquire browser from pool (available: ${this.availableBrowsers.length}, total: ${this.browsers.length})`
    );

    // Check if browser pool was initialized
    if (this.browsers.length === 0) {
      logger.error('❌ Browser pool not initialized! Call initialize() first.');
      throw new Error('Browser pool not initialized. Call initialize() method first.');
    }

    let waitTime = 0;
    const maxWaitTime = 30000; // 30 seconds max wait

    while (this.availableBrowsers.length === 0 && !this.isShuttingDown && waitTime < maxWaitTime) {
      logger.debug(`⏳ Waiting for available browser... (waited ${waitTime}ms)`);
      await new Promise(resolve => setTimeout(resolve, 100));
      waitTime += 100;
    }

    if (waitTime >= maxWaitTime) {
      logger.error('❌ Timeout waiting for available browser');
      throw new Error('Timeout waiting for available browser after 30 seconds');
    }

    if (this.isShuttingDown) {
      throw new Error('Executor is shutting down');
    }

    const browser = this.availableBrowsers.pop();
    if (!browser) {
      logger.error('❌ No browsers available after wait');
      throw new Error('No browsers available');
    }

    logger.info(`🔧 Acquired browser from pool (remaining: ${this.availableBrowsers.length})`);
    return browser;
  }

  /**
   * Release a browser back to the pool
   */
  private releaseBrowser(browser: Browser): void {
    if (!this.isShuttingDown && this.browsers.includes(browser)) {
      this.availableBrowsers.push(browser);
      logger.info(`🔄 Released browser back to pool (available: ${this.availableBrowsers.length})`);
    } else {
      logger.warn(
        `⚠️  Cannot release browser: shutting down=${this.isShuttingDown}, in pool=${this.browsers.includes(browser)}`
      );
    }
  }

  /**
   * Normalize extracted item to schema
   */
  private normalizeExtractedItem(item: ExtractedItem): ExtractedItem {
    // Ensure required arrays exist
    if (!item.dates) item.dates = [];
    if (!item.images) item.images = [];

    // Detect language (simple heuristic)
    const text = `${item.title} ${item.description}`.toLowerCase();
    item.language = this.detectLanguage(text);

    // Set creation timestamp
    if (!item.createdAt) {
      item.createdAt = new Date().toISOString();
    }

    return item;
  }

  /**
   * Detect content language
   */
  private detectLanguage(text: string): 'de' | 'en' {
    const germanWords = ['der', 'die', 'das', 'und', 'ist', 'mit', 'für', 'von', 'auf', 'zu'];
    const englishWords = ['the', 'and', 'is', 'with', 'for', 'from', 'on', 'to', 'at', 'by'];

    const words = text.split(/\s+/);
    let germanScore = 0;
    let englishScore = 0;

    for (const word of words) {
      if (germanWords.includes(word)) germanScore++;
      if (englishWords.includes(word)) englishScore++;
    }

    return germanScore > englishScore ? 'de' : 'en';
  }

  /**
   * Validate extracted item against schema
   */
  private validateExtractedItem(item: ExtractedItem): string[] {
    const errors: string[] = [];

    if (!item.title || item.title.trim().length === 0) {
      errors.push('Title is required');
    }

    if (!item.description || item.description.trim().length === 0) {
      errors.push('Description is required');
    }

    if (!['de', 'en'].includes(item.language)) {
      errors.push('Language must be "de" or "en"');
    }

    // Validate dates are ISO 8601 format
    const dateFields = ['startDate', 'endDate', 'createdAt'];
    for (const field of dateFields) {
      const value = (item as any)[field];
      if (value && !this.isValidISODate(value)) {
        errors.push(`${field} must be in ISO 8601 format`);
      }
    }

    if (item.dates) {
      for (let i = 0; i < item.dates.length; i++) {
        if (!this.isValidISODate(item.dates[i])) {
          errors.push(`dates[${i}] must be in ISO 8601 format`);
        }
      }
    }

    return errors;
  }

  /**
   * Calculate accuracy score based on data completeness
   */
  private calculateAccuracyScore(items: ExtractedItem[]): number {
    if (items.length === 0) return 0;

    let totalScore = 0;
    for (const item of items) {
      let itemScore = 0;
      let totalFields = 0;

      // Required fields (higher weight)
      if (item.title) itemScore += 2;
      totalFields += 2;

      if (item.description) itemScore += 2;
      totalFields += 2;

      // Optional fields (lower weight)
      const optionalFields = [
        'place',
        'address',
        'email',
        'phone',
        'website',
        'startDate',
        'endDate',
      ];
      for (const field of optionalFields) {
        totalFields += 1;
        if ((item as any)[field]) itemScore += 1;
      }

      totalScore += itemScore / totalFields;
    }

    return totalScore / items.length;
  }

  /**
   * Calculate test confidence score
   */
  private calculateTestConfidence(samples: ExtractedItem[], errors: string[]): number {
    if (errors.length > 0) return 0;
    if (samples.length === 0) return 0;

    const avgAccuracy = this.calculateAccuracyScore(samples);
    const sampleBonus = Math.min(samples.length / 3, 1); // Bonus for having multiple samples

    return avgAccuracy * sampleBonus;
  }

  /**
   * Utility methods for data parsing
   */
  private resolveUrl(url: string, baseUrl: string): string {
    try {
      return new URL(url, baseUrl).href;
    } catch {
      return url;
    }
  }

  private parsePrice(text: string | null): number | undefined {
    if (!text) return undefined;
    const match = text.match(/[\d,]+\.?\d*/);
    return match ? parseFloat(match[0].replace(',', '')) : undefined;
  }

  private parseCoordinate(text: string | null): number | undefined {
    if (!text) return undefined;
    const match = text.match(/-?\d+\.?\d*/);
    return match ? parseFloat(match[0]) : undefined;
  }

  private parseZipcode(text: string | null): number | undefined {
    if (!text) return undefined;
    const match = text.match(/\d{4,5}/);
    return match ? parseInt(match[0]) : undefined;
  }

  private parseDate(text: string | null): string | undefined {
    if (!text) return undefined;

    try {
      const date = new Date(text);
      if (isNaN(date.getTime())) return undefined;
      return date.toISOString();
    } catch {
      return undefined;
    }
  }

  private isValidISODate(dateString: string): boolean {
    try {
      const date = new Date(dateString);
      return date.toISOString() === dateString;
    } catch {
      return false;
    }
  }

  /**
   * Extract content URLs from list items on a page
   */
  private async extractContentUrls(
    page: Page,
    plan: ScrapingPlan,
    maxUrls?: number
  ): Promise<string[]> {
    const contentUrls: string[] = [];

    try {
      logger.info(`🔍 Looking for content URLs using selector: ${plan.listSelector}`);

      // Wait for list elements to be present
      await page
        .waitForSelector(plan.listSelector, {
          timeout: 5000,
        })
        .catch(() => {
          logger.warn(`⚠️  List selector not found: ${plan.listSelector}`);
        });

      // Get all list items
      const listItems = await page.$$(plan.listSelector);
      logger.info(`📋 Found ${listItems.length} potential content items on page`);

      const itemsToProcess = maxUrls ? listItems.slice(0, maxUrls) : listItems;
      logger.info(
        `🎯 Processing ${itemsToProcess.length} items for URL extraction (${maxUrls ? 'limited by maxUrls' : 'all items'})`
      );

      // Use contentLinkSelector if available for precise link extraction
      if (plan.contentLinkSelector) {
        logger.info(`🎯 Using content link selector for precise extraction: ${plan.contentLinkSelector}`);

        try {
          // Use the specific content link selector to get all content links at once
          const contentLinks = await page.$$(plan.contentLinkSelector);
          logger.info(`📋 Found ${contentLinks.length} content links using contentLinkSelector`);

          const linksToProcess = maxUrls ? contentLinks.slice(0, maxUrls) : contentLinks;

          for (let i = 0; i < linksToProcess.length; i++) {
            const linkElement = linksToProcess[i];
            try {
              const href = await linkElement.getAttribute('href');
              if (href) {
                // Convert relative URLs to absolute
                const absoluteUrl = new URL(href, page.url()).href;

                // Trust the content link selector - if it found the link, it's likely content
                // Only do basic validation (avoid duplicates and invalid URLs)
                if (!contentUrls.includes(absoluteUrl)) {
                  contentUrls.push(absoluteUrl);
                  logger.debug(`   📎 Found unique content URL ${contentUrls.length}: ${absoluteUrl}`);
                } else {
                  logger.debug(`   🔄 Skipped duplicate URL: ${absoluteUrl}`);
                }
              }
            } catch (error) {
              logger.warn(`   ⚠️  Error extracting URL from content link ${i + 1}:`, error);
            }
          }
        } catch (error) {
          logger.warn(`⚠️  Content link selector failed, falling back to list item approach:`, error);
          // Fall back to the original approach if contentLinkSelector fails
          await this.extractUrlsFromListItems(itemsToProcess, contentUrls, page);
        }
      } else {
        logger.info(`📋 No content link selector available, using list item approach`);
        // Use the original approach when no contentLinkSelector is available
        await this.extractUrlsFromListItems(itemsToProcess, contentUrls, page);
      }
    } catch (error) {
      logger.error('❌ Error extracting content URLs from page:', error);
    }

    logger.info(`📦 URL extraction complete: ${contentUrls.length} unique content URLs found`);
    return contentUrls;
  }

  /**
   * Extract URLs from list items (fallback method)
   */
  private async extractUrlsFromListItems(
    itemsToProcess: any[],
    contentUrls: string[],
    page: Page
  ): Promise<void> {
    for (let i = 0; i < itemsToProcess.length; i++) {
      const listItem = itemsToProcess[i];
      try {
        // Look for the first link within the list item (usually the main content link)
        const linkElement = await listItem.$('a[href]');
        if (linkElement) {
          const href = await linkElement.getAttribute('href');
          if (href) {
            // Convert relative URLs to absolute
            const absoluteUrl = new URL(href, page.url()).href;

            // Apply light filtering for fallback method (trust the list selector mostly)
            if (this.isLikelyContentLink(absoluteUrl, await linkElement.textContent())) {
              // Check if this URL is already in our list (avoid duplicates)
              if (!contentUrls.includes(absoluteUrl)) {
                contentUrls.push(absoluteUrl);
                logger.debug(`   📎 Found unique content URL ${contentUrls.length}: ${absoluteUrl}`);
              } else {
                logger.debug(`   🔄 Skipped duplicate URL: ${absoluteUrl}`);
              }
            } else {
              logger.debug(`   🚫 Filtered out non-content link: ${absoluteUrl}`);
            }
          }
        }
      } catch (error) {
        logger.warn(`   ⚠️  Error extracting URL from item ${i + 1}:`, error);
      }
    }
  }

  /**
   * Visit and scrape a single content page
   */
  private async scrapeContentPage(
    context: BrowserContext,
    contentUrl: string,
    plan: ScrapingPlan
  ): Promise<ExtractedItem | null> {
    try {
      logger.info(`📖 Scraping content page: ${contentUrl}`);

      const page = await context.newPage();

      try {
        // Navigate to content page
        await page.goto(contentUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });

        logger.info(`✅ Content page loaded successfully: ${contentUrl}`);

        // Extract data using detail selectors
        const extractedItem = await this.extractDataFromContentPage(page, plan, contentUrl);

        if (extractedItem) {
          logger.info(`✅ Content extracted successfully: "${extractedItem.title}"`);
        } else {
          logger.warn(`⚠️  No content extracted from: ${contentUrl}`);
        }

        return extractedItem;
      } finally {
        await page.close();
      }
    } catch (error) {
      logger.error(`❌ Error scraping content page ${contentUrl}:`, error);
      return null;
    }
  }

  /**
   * Extract data from a content page using detail selectors
   */
  private async extractDataFromContentPage(
    page: Page,
    plan: ScrapingPlan,
    contentUrl: string
  ): Promise<ExtractedItem | null> {
    try {
      const item: Partial<ExtractedItem> = {
        dates: [],
        images: [],
        language: 'de', // Default language
      };

      // Extract each field using detail selectors
      for (const [field, selector] of Object.entries(plan.detailSelectors)) {
        try {
          const element = await page.$(selector);
          if (element) {
            const value = await element.textContent();
            if (value && value.trim()) {
              switch (field) {
                case 'title':
                  item.title = value.trim();
                  break;
                case 'description':
                  item.description = value.trim();
                  break;
                case 'date':
                  item.dates = [value.trim()];
                  break;
                case 'address':
                  item.address = value.trim();
                  break;
                case 'phone':
                  item.phone = value.trim();
                  break;
                case 'email':
                  item.email = value.trim();
                  break;
                case 'website':
                  item.website = value.trim();
                  break;
                case 'images':
                  // For images, get the src attribute
                  const imgSrc = await element.getAttribute('src');
                  if (imgSrc) {
                    const absoluteImgUrl = new URL(imgSrc, page.url()).href;
                    item.images = [absoluteImgUrl];
                  }
                  break;
              }
            }
          }
        } catch (error) {
          logger.debug(`Failed to extract ${field} using selector ${selector}:`, error);
        }
      }

      // Note: Content URL is tracked separately in pageResults structure

      // Validate that we have at least a title
      if (!item.title) {
        logger.warn(`No title found for content page: ${contentUrl}`);
        return null;
      }

      return item as ExtractedItem;
    } catch (error) {
      logger.error(`Error extracting data from content page ${contentUrl}:`, error);
      return null;
    }
  }

  /**
   * Light filtering for fallback method - only filter obvious non-content links
   */
  private isLikelyContentLink(href: string, linkText: string | null): boolean {
    // Only filter out very obvious non-content patterns
    const obviousNonContentPatterns = [
      'javascript:',
      '#',
      '/login',
      '/register',
      '/contact',
      '/kontakt',
      '/imprint',
      '/impressum',
      '/privacy',
      '/datenschutz'
    ];

    const lowerHref = href.toLowerCase();
    if (obviousNonContentPatterns.some(pattern => lowerHref.includes(pattern))) {
      return false;
    }

    // Only filter out very obvious non-content link text
    if (linkText) {
      const lowerText = linkText.toLowerCase().trim();
      // Only filter single character navigation or empty links
      if ((lowerText.length === 1 && ['>', '<', '→', '←'].includes(lowerText)) || lowerText === '') {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if a link is likely a content link (not pagination or auxiliary) - DEPRECATED
   * This method is too aggressive and filters out valid content links
   */
  private isContentLink(href: string, linkText: string | null): boolean {
    // Skip common non-content patterns in URL
    const nonContentUrlPatterns = [
      '/page/',
      '/seite/',
      '?page=',
      '&page=',
      '/next',
      '/prev',
      '/previous',
      '/weiter',
      '/zurück',
      '/back',
      'javascript:',
      '#',
      '/search',
      '/suche',
      '/filter',
      '/sort',
      '/login',
      '/register',
      '/contact',
      '/kontakt',
      '/imprint',
      '/impressum',
      '/privacy',
      '/datenschutz',
      '/share',
      '/teilen',
      '/print',
      '/drucken',
      '/edit',
      '/bearbeiten',
      '/delete',
      '/löschen'
    ];

    // Check URL patterns
    const lowerHref = href.toLowerCase();
    if (nonContentUrlPatterns.some(pattern => lowerHref.includes(pattern))) {
      return false;
    }

    // Skip common non-content link text patterns
    if (linkText) {
      const lowerText = linkText.toLowerCase().trim();
      const nonContentTextPatterns = [
        'next',
        'previous',
        'prev',
        'weiter',
        'zurück',
        'back',
        'mehr',
        'more',
        'alle',
        'all',
        'share',
        'teilen',
        'print',
        'drucken',
        'edit',
        'bearbeiten',
        'delete',
        'löschen',
        '>>',
        '<<',
        '>',
        '<',
        '→',
        '←',
        '...'
      ];

      if (nonContentTextPatterns.some(pattern => lowerText === pattern || lowerText.includes(pattern))) {
        return false;
      }

      // Skip very short link text that's likely not content
      if (lowerText.length < 3 && !/\d/.test(lowerText)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Shutdown the executor and close all browsers
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down Playwright executor');
    this.isShuttingDown = true;

    for (const browser of this.browsers) {
      try {
        await browser.close();
      } catch (error) {
        logger.error('Error closing browser:', error);
      }
    }

    this.browsers = [];
    this.availableBrowsers = [];
  }
}
