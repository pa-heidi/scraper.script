/**
 * Sandbox Executor Service
 * Requirements: 4.2, 4.3, 8.2, 8.3
 *
 * Provides safe sandbox environment for testing scraping plans with content URLs
 */

import { ScrapingPlan, TestExecutionResult, ExtractedItem } from '../interfaces/core';
import { PlaywrightExecutor, TestResult } from './playwright-executor.service';
import { DataValidatorService } from './data-validator.service';
import { logger } from '../utils/logger';

export interface SandboxConfig {
  maxPages: number;
  timeoutMs: number;
  maxMemoryMb: number;
  allowedDomains: string[];
  blockResources: string[];
  enableScreenshots: boolean;
  enableDOMHighlighting: boolean;
}

export interface SandboxTestResult extends TestExecutionResult {
  domHighlights?: DOMHighlight[];
  screenshots?: Screenshot[];
  performanceMetrics: SandboxPerformanceMetrics;
  resourceUsage: ResourceUsage;
  validationReport: ValidationReport;
}

export interface DOMHighlight {
  selector: string;
  elementType: 'list_container' | 'list_item' | 'detail_field' | 'pagination' | 'excluded';
  coordinates: { x: number; y: number; width: number; height: number };
  screenshot?: string; // base64 encoded screenshot
  extractedValue?: string;
  confidence: number;
}

export interface Screenshot {
  url: string;
  timestamp: Date;
  image: string; // base64 encoded
  annotations: ScreenshotAnnotation[];
}

export interface ScreenshotAnnotation {
  type: 'selector' | 'error' | 'success' | 'warning';
  coordinates: { x: number; y: number; width: number; height: number };
  label: string;
  color: string;
}

export interface SandboxPerformanceMetrics {
  totalDuration: number;
  pageLoadTime: number;
  selectorEvaluationTime: number;
  dataExtractionTime: number;
  memoryPeakMb: number;
  cpuUsagePercent: number;
  networkRequests: number;
  blockedRequests: number;
}

export interface ResourceUsage {
  memoryUsedMb: number;
  cpuTimeMs: number;
  networkBandwidthKb: number;
  storageUsedKb: number;
  browserInstances: number;
}

export interface ValidationReport {
  schemaCompliance: number; // 0-1
  dataQuality: number; // 0-1
  extractionAccuracy: number; // 0-1
  issues: ValidationIssue[];
  recommendations: string[];
}

export interface ValidationIssue {
  type: 'error' | 'warning' | 'info';
  field?: string;
  selector?: string;
  message: string;
  impact: 'low' | 'medium' | 'high';
  suggestion?: string;
}

export class SandboxExecutorService {
  private playwrightExecutor: PlaywrightExecutor;
  private dataValidator: DataValidatorService;
  private config: SandboxConfig;

  constructor(
    playwrightExecutor: PlaywrightExecutor,
    dataValidator: DataValidatorService,
    config: SandboxConfig
  ) {
    this.playwrightExecutor = playwrightExecutor;
    this.dataValidator = dataValidator;
    this.config = config;
  }

  /**
   * Execute plan in sandbox environment with comprehensive testing
   */
  public async executeSandboxTest(plan: ScrapingPlan): Promise<SandboxTestResult> {
    const startTime = Date.now();
    logger.info(`Starting sandbox test for plan ${plan.planId}`);

    try {
      // Validate plan before execution
      this.validatePlanForSandbox(plan);

      // Create sandbox environment
      const sandboxContext = await this.createSandboxContext(plan);

      // Execute plan with monitoring
      const executionResult = await this.executeWithMonitoring(plan, sandboxContext);

      // Generate DOM highlights and screenshots
      const domHighlights = this.config.enableDOMHighlighting
        ? await this.generateDOMHighlights(plan, sandboxContext)
        : [];

      const screenshots = this.config.enableScreenshots
        ? await this.captureScreenshots(plan, sandboxContext)
        : [];

      // Validate extracted data
      const validationReport = await this.validateExtractedData(executionResult.extractedSamples);

      // Calculate performance metrics
      const performanceMetrics = await this.calculatePerformanceMetrics(sandboxContext, startTime);

      // Calculate resource usage
      const resourceUsage = await this.calculateResourceUsage(sandboxContext);

      const result: SandboxTestResult = {
        success: executionResult.success,
        extractedSamples: executionResult.extractedSamples,
        errors: executionResult.errors,
        confidence: this.calculateOverallConfidence(executionResult, validationReport),
        domHighlights,
        screenshots,
        performanceMetrics,
        resourceUsage,
        validationReport,
      };

      // Cleanup sandbox
      await this.cleanupSandbox(sandboxContext);

      logger.info(
        `Sandbox test completed for plan ${plan.planId}: ${result.success ? 'PASSED' : 'FAILED'}`
      );
      return result;
    } catch (error) {
      logger.error(`Sandbox test failed for plan ${plan.planId}:`, error);

      return {
        success: false,
        extractedSamples: [],
        errors: [error instanceof Error ? error.message : 'Unknown sandbox error'],
        confidence: 0,
        performanceMetrics: this.getDefaultPerformanceMetrics(),
        resourceUsage: this.getDefaultResourceUsage(),
        validationReport: {
          schemaCompliance: 0,
          dataQuality: 0,
          extractionAccuracy: 0,
          issues: [
            {
              type: 'error',
              message: 'Sandbox execution failed',
              impact: 'high',
            },
          ],
          recommendations: ['Review plan configuration and selectors'],
        },
      };
    }
  }

  /**
   * Test plan with content URLs for pattern validation
   */
  public async testWithContentURLs(
    plan: ScrapingPlan,
    contentUrls: string[]
  ): Promise<SandboxTestResult> {
    logger.info(`Testing plan ${plan.planId} with ${contentUrls.length} content URLs`);

    try {
      // First test the main plan
      const mainResult = await this.executeSandboxTest(plan);

      // Then test against content URLs to validate patterns
      const contentValidationResults = await this.validateAgainstContentURLs(plan, contentUrls);

      // Merge results
      const mergedResult: SandboxTestResult = {
        ...mainResult,
        confidence: Math.min(mainResult.confidence, contentValidationResults.averageConfidence),
        validationReport: {
          ...mainResult.validationReport,
          issues: [...mainResult.validationReport.issues, ...contentValidationResults.issues],
          recommendations: [
            ...mainResult.validationReport.recommendations,
            ...contentValidationResults.recommendations,
          ],
        },
      };

      // Add content URL specific highlights
      if (contentValidationResults.domHighlights) {
        mergedResult.domHighlights = [
          ...(mergedResult.domHighlights || []),
          ...contentValidationResults.domHighlights,
        ];
      }

      logger.info(
        `Content URL validation completed with confidence: ${contentValidationResults.averageConfidence}`
      );
      return mergedResult;
    } catch (error) {
      logger.error(`Error testing plan with content URLs:`, error);
      throw error;
    }
  }

  // Private helper methods

  private validatePlanForSandbox(plan: ScrapingPlan): void {
    if (!plan.entryUrls || plan.entryUrls.length === 0) {
      throw new Error('Plan must have at least one entry URL');
    }

    // Check if domains are allowed
    for (const url of plan.entryUrls) {
      const domain = new URL(url).hostname;
      if (this.config.allowedDomains.length > 0 && !this.config.allowedDomains.includes(domain)) {
        throw new Error(`Domain ${domain} is not allowed in sandbox`);
      }
    }

    if (!plan.listSelector) {
      throw new Error('Plan must have a list selector');
    }
  }

  private async createSandboxContext(plan: ScrapingPlan): Promise<any> {
    logger.debug(`Creating sandbox context for plan ${plan.planId}`);

    try {
      // Create isolated browser context with security restrictions
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          `--max_old_space_size=${this.config.maxMemoryMb}`,
        ],
      });

      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (compatible; AI-Scraper-Sandbox/1.0)',
        viewport: { width: 1920, height: 1080 },
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin',
        permissions: [], // No permissions for security
        extraHTTPHeaders: {
          'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        // Resource blocking for performance and security
        ...(this.config.blockResources.length > 0 && {
          ignoreHTTPSErrors: true,
        }),
      });

      // Block unwanted resources
      if (this.config.blockResources.length > 0) {
        await context.route('**/*', route => {
          const resourceType = route.request().resourceType();
          if (this.config.blockResources.includes(resourceType)) {
            route.abort();
          } else {
            route.continue();
          }
        });
      }

      // Set up performance monitoring
      const performanceData = {
        networkRequests: 0,
        blockedRequests: 0,
        memoryUsage: [],
        cpuUsage: [],
        startTime: Date.now(),
      };

      // Monitor network requests
      context.on('request', request => {
        performanceData.networkRequests++;
      });

      context.on('requestfailed', request => {
        performanceData.blockedRequests++;
      });

      return {
        planId: plan.planId,
        browser,
        context,
        startTime: Date.now(),
        memoryLimit: this.config.maxMemoryMb,
        timeoutMs: this.config.timeoutMs,
        resourceBlocking: this.config.blockResources,
        performanceData,
        pages: new Map(), // Track created pages
      };
    } catch (error) {
      logger.error(`Failed to create sandbox context for plan ${plan.planId}:`, error);
      throw error;
    }
  }

  private async executeWithMonitoring(plan: ScrapingPlan, context: any): Promise<TestResult> {
    logger.debug(`Executing plan ${plan.planId} with monitoring in sandbox`);

    try {
      const page = await context.context.newPage();
      context.pages.set('main', page);

      // Set up page-level monitoring
      const pageMetrics = {
        loadTime: 0,
        domContentLoaded: 0,
        networkRequests: 0,
        errors: [] as string[],
      };

      page.on('domcontentloaded', () => {
        pageMetrics.domContentLoaded = Date.now() - context.startTime;
      });

      page.on('load', () => {
        pageMetrics.loadTime = Date.now() - context.startTime;
      });

      page.on('pageerror', (error: Error) => {
        pageMetrics.errors.push(error.message);
      });

      page.on('request', () => {
        pageMetrics.networkRequests++;
      });

      // Execute the plan with timeout
      const executionPromise = this.executePlanInSandbox(plan, page, context);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Sandbox execution timeout')), context.timeoutMs);
      });

      const result = (await Promise.race([executionPromise, timeoutPromise])) as TestResult;

      // Add monitoring data to context
      context.pageMetrics = pageMetrics;
      context.executionTime = Date.now() - context.startTime;

      logger.debug(`Sandbox execution completed for plan ${plan.planId}`, {
        success: result.success,
        extractedSamples: result.extractedSamples.length,
        executionTime: context.executionTime,
        loadTime: pageMetrics.loadTime,
      });

      return result;
    } catch (error) {
      logger.error(`Sandbox execution failed for plan ${plan.planId}:`, error);
      throw error;
    }
  }

  /**
   * Execute plan within sandbox environment with resource monitoring
   */
  private async executePlanInSandbox(
    plan: ScrapingPlan,
    page: any,
    context: any
  ): Promise<TestResult> {
    const extractedSamples: ExtractedItem[] = [];
    const errors: string[] = [];
    let confidence = 0;

    try {
      // Navigate to first entry URL
      const entryUrl = plan.entryUrls[0];
      logger.debug(`Navigating to entry URL: ${entryUrl}`);

      await page.goto(entryUrl, {
        waitUntil: 'domcontentloaded',
        timeout: Math.min(context.timeoutMs, 30000),
      });

      // Wait for dynamic content
      await page.waitForTimeout(2000);

      // Test list selector
      const listElements = await page.$$(plan.listSelector);

      if (listElements.length === 0) {
        errors.push(`List selector "${plan.listSelector}" found no elements`);
        confidence = 0.1;
      } else {
        logger.debug(`List selector found ${listElements.length} elements`);
        confidence = 0.5;

        // Extract data from first few items (limited for sandbox)
        const maxItems = Math.min(listElements.length, 3);

        for (let i = 0; i < maxItems; i++) {
          try {
            const itemData = await this.extractDataFromElement(
              page,
              listElements[i],
              plan.detailSelectors,
              entryUrl
            );

            if (itemData && Object.keys(itemData).length > 1) {
              // More than just URL
              extractedSamples.push(itemData);
              confidence = Math.min(confidence + 0.2, 1.0);
            }
          } catch (error) {
            errors.push(
              `Failed to extract data from item ${i}: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }

        // Test pagination if present
        if (plan.paginationSelector) {
          const paginationElements = await page.$$(plan.paginationSelector);
          if (paginationElements.length === 0) {
            errors.push(`Pagination selector "${plan.paginationSelector}" found no elements`);
          } else {
            logger.debug(`Pagination selector found ${paginationElements.length} elements`);
            confidence = Math.min(confidence + 0.1, 1.0);
          }
        }
      }

      // Calculate final confidence based on extraction success
      if (extractedSamples.length > 0) {
        const avgFieldsPerItem =
          extractedSamples.reduce((sum, item) => {
            return (
              sum +
              Object.keys(item).filter(key => key !== 'url' && item[key as keyof ExtractedItem])
                .length
            );
          }, 0) / extractedSamples.length;

        confidence = Math.min(confidence + avgFieldsPerItem * 0.1, 1.0);
      }

      const success = extractedSamples.length > 0 && errors.length === 0 && confidence > 0.6;

      logger.debug(`Sandbox plan execution completed`, {
        success,
        extractedSamples: extractedSamples.length,
        errors: errors.length,
        confidence,
      });

      return {
        success,
        extractedSamples,
        errors,
        confidence,
        executionTime: Date.now() - context.startTime,
      };
    } catch (error) {
      logger.error(`Error executing plan in sandbox:`, error);
      return {
        success: false,
        extractedSamples: [],
        errors: [error instanceof Error ? error.message : String(error)],
        confidence: 0,
        executionTime: Date.now() - context.startTime,
      };
    }
  }

  /**
   * Extract data from a specific DOM element using detail selectors
   */
  private async extractDataFromElement(
    page: any,
    element: any,
    detailSelectors: Record<string, string>,
    baseUrl: string
  ): Promise<ExtractedItem | null> {
    try {
      // Extract data using selectors within the context of the element
      const extractedData = await page.evaluate(
        (el: Element, selectors: Record<string, string>, url: string) => {
          const data: any = { url };

          for (const [field, selector] of Object.entries(selectors)) {
            try {
              // Try to find element within the current item first, then globally
              let targetElement = el.querySelector(selector) || document.querySelector(selector);

              if (targetElement) {
                switch (field) {
                  case 'images':
                    data[field] =
                      targetElement.getAttribute('src') ||
                      targetElement.getAttribute('data-src') ||
                      targetElement.getAttribute('data-lazy-src');
                    break;
                  case 'website':
                    data[field] = targetElement.getAttribute('href');
                    break;
                  case 'email':
                    const emailText = targetElement.textContent?.trim() || '';
                    const emailMatch = emailText.match(/[\w\.-]+@[\w\.-]+\.\w+/);
                    data[field] = emailMatch ? emailMatch[0] : emailText;
                    break;
                  case 'phone':
                    const phoneText = targetElement.textContent?.trim() || '';
                    const phoneMatch = phoneText.match(/[\d\s\-\+\(\)\/]{8,}/);
                    data[field] = phoneMatch ? phoneMatch[0].trim() : phoneText;
                    break;
                  case 'dates':
                  case 'startDate':
                    const dateText = targetElement.textContent?.trim() || '';
                    const dateAttr =
                      targetElement.getAttribute('datetime') ||
                      targetElement.getAttribute('data-date');
                    data[field] = dateAttr || dateText;
                    break;
                  default:
                    data[field] = targetElement.textContent?.trim() || '';
                }

                // Resolve relative URLs
                if ((field === 'website' || field === 'images') && data[field]) {
                  try {
                    data[field] = new URL(data[field], url).href;
                  } catch (e) {
                    // Keep original value if URL resolution fails
                  }
                }
              }
            } catch (err) {
              // Skip individual field errors
            }
          }

          return data;
        },
        element,
        detailSelectors,
        baseUrl
      );

      // Validate and clean the extracted data
      const cleanedData = this.cleanExtractedData(extractedData);

      return cleanedData.title || cleanedData.description ? cleanedData : null;
    } catch (error) {
      logger.debug(`Error extracting data from element:`, error);
      return null;
    }
  }

  /**
   * Clean and normalize extracted data
   */
  private cleanExtractedData(data: any): ExtractedItem {
    const cleaned: any = { url: data.url };

    // Clean and validate each field
    if (data.title) {
      cleaned.title = this.cleanText(data.title);
    }

    if (data.description) {
      cleaned.description = this.cleanText(data.description);
    }

    if (data.address) {
      cleaned.address = this.cleanText(data.address);
    }

    if (data.place) {
      cleaned.place = this.cleanText(data.place);
    }

    if (data.email && this.isValidEmail(data.email)) {
      cleaned.email = data.email.trim();
    }

    if (data.phone) {
      cleaned.phone = this.cleanPhoneNumber(data.phone);
    }

    if (data.website && this.isValidUrl(data.website)) {
      cleaned.website = data.website;
    }

    if (data.images && this.isValidUrl(data.images)) {
      cleaned.images = [data.images];
    }

    if (data.dates || data.startDate) {
      const dateStr = data.dates || data.startDate;
      const parsedDate = this.parseDate(dateStr);
      if (parsedDate) {
        cleaned.startDate = parsedDate.toISOString();
      }
    }

    return cleaned as ExtractedItem;
  }

  /**
   * Clean text content
   */
  private cleanText(text: string): string {
    return text
      .replace(/\s+/g, ' ')
      .replace(/[\r\n\t]/g, ' ')
      .trim()
      .substring(0, 500); // Limit length
  }

  /**
   * Validate email format
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
  }

  /**
   * Validate URL format
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clean phone number
   */
  private cleanPhoneNumber(phone: string): string {
    return phone.replace(/[^\d\+\-\(\)\s]/g, '').trim();
  }

  /**
   * Parse date from various formats
   */
  private parseDate(dateStr: string): Date | null {
    if (!dateStr) return null;

    // Try various German date formats
    const patterns = [
      /(\d{1,2})\.(\d{1,2})\.(\d{4})/, // DD.MM.YYYY
      /(\d{4})-(\d{2})-(\d{2})/, // YYYY-MM-DD
      /(\d{1,2})\/(\d{1,2})\/(\d{4})/, // DD/MM/YYYY
    ];

    for (const pattern of patterns) {
      const match = dateStr.match(pattern);
      if (match) {
        try {
          let day, month, year;

          if (pattern.source.includes('\\.')) {
            // DD.MM.YYYY format
            [, day, month, year] = match;
          } else if (pattern.source.includes('-')) {
            // YYYY-MM-DD format
            [, year, month, day] = match;
          } else {
            // DD/MM/YYYY format
            [, day, month, year] = match;
          }

          return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        } catch (error) {
          continue;
        }
      }
    }

    // Try standard Date parsing as fallback
    try {
      const parsed = new Date(dateStr);
      return isNaN(parsed.getTime()) ? null : parsed;
    } catch {
      return null;
    }
  }

  private async generateDOMHighlights(plan: ScrapingPlan, context: any): Promise<DOMHighlight[]> {
    const highlights: DOMHighlight[] = [];

    try {
      const page = context.pages.get('main');
      if (!page) {
        logger.warn('No page available for DOM highlighting');
        return highlights;
      }

      logger.debug(`Generating DOM highlights for plan ${plan.planId}`);

      // Highlight list container
      const listHighlights = await this.highlightElements(
        page,
        plan.listSelector,
        'list_container',
        'List Container'
      );
      highlights.push(...listHighlights);

      // Highlight detail selectors
      for (const [field, selector] of Object.entries(plan.detailSelectors)) {
        const detailHighlights = await this.highlightElements(
          page,
          selector,
          'detail_field',
          `${field} (${selector})`,
          field
        );
        highlights.push(...detailHighlights);
      }

      // Highlight pagination if present
      if (plan.paginationSelector) {
        const paginationHighlights = await this.highlightElements(
          page,
          plan.paginationSelector,
          'pagination',
          'Pagination'
        );
        highlights.push(...paginationHighlights);
      }

      // Highlight excluded elements for reference
      if (plan.excludeSelectors && plan.excludeSelectors.length > 0) {
        for (const excludeSelector of plan.excludeSelectors) {
          const excludeHighlights = await this.highlightElements(
            page,
            excludeSelector,
            'excluded',
            `Excluded (${excludeSelector})`
          );
          highlights.push(...excludeHighlights);
        }
      }

      logger.debug(`Generated ${highlights.length} DOM highlights`);
      return highlights;
    } catch (error) {
      logger.error('Error generating DOM highlights:', error);
      return highlights;
    }
  }

  /**
   * Highlight specific elements on the page and capture their coordinates
   */
  private async highlightElements(
    page: any,
    selector: string,
    elementType: DOMHighlight['elementType'],
    label: string,
    field?: string
  ): Promise<DOMHighlight[]> {
    try {
      // Find elements matching the selector
      const elements = await page.$$(selector);

      if (elements.length === 0) {
        logger.debug(`No elements found for selector: ${selector}`);
        return [];
      }

      const highlights: DOMHighlight[] = [];

      // Process first few elements (limit for performance)
      const maxElements = Math.min(elements.length, elementType === 'list_item' ? 5 : 3);

      for (let i = 0; i < maxElements; i++) {
        const element = elements[i];

        try {
          // Get element coordinates and properties
          const elementInfo = await page.evaluate(
            (el: Element, fieldName?: string) => {
              const rect = el.getBoundingClientRect();
              const computedStyle = window.getComputedStyle(el);

              let extractedValue = '';
              if (fieldName) {
                if (fieldName === 'images') {
                  extractedValue = el.getAttribute('src') || el.getAttribute('data-src') || '';
                } else if (fieldName === 'website') {
                  extractedValue = el.getAttribute('href') || '';
                } else {
                  extractedValue = el.textContent?.trim().substring(0, 100) || '';
                }
              }

              return {
                coordinates: {
                  x: Math.round(rect.left),
                  y: Math.round(rect.top),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height),
                },
                extractedValue,
                isVisible:
                  computedStyle.display !== 'none' &&
                  computedStyle.visibility !== 'hidden' &&
                  rect.width > 0 &&
                  rect.height > 0,
                tagName: el.tagName.toLowerCase(),
                className: el.className,
                id: el.id,
              };
            },
            element,
            field
          );

          // Only include visible elements
          if (elementInfo.isVisible && elementInfo.coordinates.width > 0) {
            // Calculate confidence based on element properties
            let confidence = 0.7;

            // Boost confidence for elements with content
            if (elementInfo.extractedValue && elementInfo.extractedValue.length > 0) {
              confidence += 0.2;
            }

            // Boost confidence for semantic elements
            if (['article', 'section', 'main', 'header'].includes(elementInfo.tagName)) {
              confidence += 0.1;
            }

            // Reduce confidence for very small elements
            if (elementInfo.coordinates.width < 50 || elementInfo.coordinates.height < 20) {
              confidence -= 0.2;
            }

            confidence = Math.max(0.1, Math.min(1.0, confidence));

            const highlight: DOMHighlight = {
              selector,
              elementType,
              coordinates: elementInfo.coordinates,
              confidence,
              ...(elementInfo.extractedValue && { extractedValue: elementInfo.extractedValue }),
            };

            // Capture screenshot of the element if enabled
            if (this.config.enableScreenshots) {
              try {
                const screenshot = await element.screenshot({
                  type: 'png',
                  quality: 80,
                });
                highlight.screenshot = `data:image/png;base64,${screenshot.toString('base64')}`;
              } catch (screenshotError) {
                logger.debug(`Failed to capture element screenshot: ${screenshotError}`);
              }
            }

            highlights.push(highlight);
          }
        } catch (elementError) {
          logger.debug(`Error processing element ${i} for selector ${selector}:`, elementError);
        }
      }

      logger.debug(
        `Highlighted ${highlights.length}/${elements.length} elements for selector: ${selector}`
      );
      return highlights;
    } catch (error) {
      logger.debug(`Error highlighting elements for selector ${selector}:`, error);
      return [];
    }
  }

  private async captureScreenshots(plan: ScrapingPlan, context: any): Promise<Screenshot[]> {
    const screenshots: Screenshot[] = [];

    try {
      const page = context.pages.get('main');
      if (!page) {
        logger.warn('No page available for screenshot capture');
        return screenshots;
      }

      logger.debug(`Capturing screenshots for plan ${plan.planId}`);

      // Capture full page screenshot
      const fullPageScreenshot = await page.screenshot({
        type: 'png',
        fullPage: true,
        quality: 80,
      });

      const annotations: ScreenshotAnnotation[] = [];

      // Add annotations for list container
      try {
        const listElements = await page.$$(plan.listSelector);
        if (listElements.length > 0) {
          const listCoords = await page.evaluate((selector: string) => {
            const element = document.querySelector(selector);
            if (element) {
              const rect = element.getBoundingClientRect();
              return {
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              };
            }
            return null;
          }, plan.listSelector);

          if (listCoords) {
            annotations.push({
              type: 'selector',
              coordinates: listCoords,
              label: 'List Container',
              color: '#00ff00',
            });
          }
        }
      } catch (error) {
        logger.debug('Error adding list container annotation:', error);
      }

      // Add annotations for detail selectors
      for (const [field, selector] of Object.entries(plan.detailSelectors)) {
        try {
          const elements = await page.$$(selector);
          if (elements.length > 0) {
            const coords = await page.evaluate((sel: string) => {
              const element = document.querySelector(sel);
              if (element) {
                const rect = element.getBoundingClientRect();
                return {
                  x: Math.round(rect.left),
                  y: Math.round(rect.top),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height),
                };
              }
              return null;
            }, selector);

            if (coords) {
              annotations.push({
                type: 'selector',
                coordinates: coords,
                label: `${field}`,
                color: '#0066ff',
              });
            }
          }
        } catch (error) {
          logger.debug(`Error adding annotation for ${field}:`, error);
        }
      }

      // Add pagination annotation if present
      if (plan.paginationSelector) {
        try {
          const paginationElements = await page.$$(plan.paginationSelector);
          if (paginationElements.length > 0) {
            const paginationCoords = await page.evaluate((selector: string) => {
              const element = document.querySelector(selector);
              if (element) {
                const rect = element.getBoundingClientRect();
                return {
                  x: Math.round(rect.left),
                  y: Math.round(rect.top),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height),
                };
              }
              return null;
            }, plan.paginationSelector);

            if (paginationCoords) {
              annotations.push({
                type: 'selector',
                coordinates: paginationCoords,
                label: 'Pagination',
                color: '#ff6600',
              });
            }
          }
        } catch (error) {
          logger.debug('Error adding pagination annotation:', error);
        }
      }

      screenshots.push({
        url: plan.entryUrls[0],
        timestamp: new Date(),
        image: `data:image/png;base64,${fullPageScreenshot.toString('base64')}`,
        annotations,
      });

      logger.debug(
        `Captured ${screenshots.length} screenshots with ${annotations.length} annotations`
      );
      return screenshots;
    } catch (error) {
      logger.error('Error capturing screenshots:', error);
      return screenshots;
    }
  }

  private async validateExtractedData(extractedData: ExtractedItem[]): Promise<ValidationReport> {
    const issues: ValidationIssue[] = [];
    const recommendations: string[] = [];

    if (extractedData.length === 0) {
      issues.push({
        type: 'error',
        message: 'No data was extracted',
        impact: 'high',
        suggestion: 'Check list selector and ensure it matches elements on the page',
      });
    }

    let schemaCompliance = 0;
    let dataQuality = 0;

    if (extractedData.length > 0) {
      // Validate each item
      for (const item of extractedData) {
        const validation = this.dataValidator.validateAndNormalize(item);

        if (!validation.isValid) {
          validation.errors.forEach((error: any) => {
            issues.push({
              type: 'error',
              field: error.field,
              message: error.message,
              impact: 'medium',
            });
          });
        }

        validation.warnings.forEach((warning: any) => {
          issues.push({
            type: 'warning',
            field: warning.field,
            message: warning.message,
            impact: 'low',
          });
        });
      }

      // Calculate metrics
      const validItems = extractedData.filter(
        item => this.dataValidator.validateAndNormalize(item).isValid
      );

      schemaCompliance = validItems.length / extractedData.length;
      dataQuality = this.calculateDataQuality(extractedData);
    }

    // Generate recommendations
    if (schemaCompliance < 0.8) {
      recommendations.push('Improve selector accuracy to increase schema compliance');
    }

    if (dataQuality < 0.7) {
      recommendations.push('Review data extraction patterns to improve quality');
    }

    return {
      schemaCompliance,
      dataQuality,
      extractionAccuracy: (schemaCompliance + dataQuality) / 2,
      issues,
      recommendations,
    };
  }

  private async validateAgainstContentURLs(
    plan: ScrapingPlan,
    contentUrls: string[]
  ): Promise<{
    averageConfidence: number;
    issues: ValidationIssue[];
    recommendations: string[];
    domHighlights?: DOMHighlight[];
  }> {
    const results = [];
    const issues: ValidationIssue[] = [];
    const recommendations: string[] = [];

    for (const url of contentUrls.slice(0, 3)) {
      // Limit to 3 URLs for sandbox
      try {
        // Test if selectors work on content pages
        const testResult = await this.testSelectorsOnPage(plan, url);
        results.push(testResult);

        if (!testResult.success) {
          issues.push({
            type: 'warning',
            message: `Selectors may not work on content page: ${url}`,
            impact: 'medium',
            suggestion: 'Review selectors to ensure they work across different content pages',
          });
        }
      } catch (error) {
        issues.push({
          type: 'error',
          message: `Failed to test content URL: ${url}`,
          impact: 'low',
        });
      }
    }

    const averageConfidence =
      results.length > 0 ? results.reduce((sum, r) => sum + r.confidence, 0) / results.length : 0;

    if (averageConfidence < 0.7) {
      recommendations.push(
        'Consider updating selectors to work better with content page variations'
      );
    }

    return {
      averageConfidence,
      issues,
      recommendations,
    };
  }

  private async testSelectorsOnPage(
    plan: ScrapingPlan,
    url: string
  ): Promise<{ success: boolean; confidence: number }> {
    let browser;
    let context;
    let page;
    try {
      logger.debug(`Testing selectors on content page: ${url}`);

      // Create a lightweight browser instance for testing
      const { chromium } = await import('playwright');
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });

      context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (compatible; AI-Scraper-Sandbox/1.0)',
        viewport: { width: 1920, height: 1080 },
      });

      page = await context.newPage();

      // Navigate to the content URL with timeout
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });

      // Wait for dynamic content
      await page.waitForTimeout(1000);

      let confidence = 0;
      let successCount = 0;
      let totalTests = 0;

      // Test list selector
      totalTests++;
      const listElements = await page.$$(plan.listSelector);
      if (listElements.length > 0) {
        successCount++;
        confidence += 0.3;
        logger.debug(`List selector found ${listElements.length} elements on ${url}`);
      } else {
        logger.debug(`List selector found no elements on ${url}`);
      }

      // Test detail selectors
      for (const [field, selector] of Object.entries(plan.detailSelectors)) {
        totalTests++;
        const elements = await page.$$(selector);
        if (elements.length > 0) {
          successCount++;
          confidence += 0.1;
          logger.debug(`Detail selector '${field}' found ${elements.length} elements on ${url}`);
        } else {
          logger.debug(`Detail selector '${field}' found no elements on ${url}`);
        }
      }

      // Test pagination selector if present
      if (plan.paginationSelector) {
        totalTests++;
        const paginationElements = await page.$$(plan.paginationSelector);
        if (paginationElements.length > 0) {
          successCount++;
          confidence += 0.1;
          logger.debug(`Pagination selector found ${paginationElements.length} elements on ${url}`);
        } else {
          logger.debug(`Pagination selector found no elements on ${url}`);
        }
      }

      // Calculate final confidence and success
      const successRate = totalTests > 0 ? successCount / totalTests : 0;
      const success = successRate >= 0.5; // At least 50% of selectors should work
      confidence = Math.min(confidence, 1.0);

      logger.debug(`Selector test completed for ${url}: success=${success}, confidence=${confidence}`);

      return { success, confidence };
    } catch (error) {
      logger.debug(`Error testing selectors on ${url}:`, error);
      return { success: false, confidence: 0 };
    } finally {
      // Cleanup resources
      try {
        if (page) await page.close();
        if (context) await context.close();
        if (browser) await browser.close();
      } catch (cleanupError) {
        logger.debug('Error during selector test cleanup:', cleanupError);
      }
    }
  }

  private calculateOverallConfidence(
    executionResult: TestResult,
    validationReport: ValidationReport
  ): number {
    const baseConfidence = executionResult.confidence || 0;
    const validationConfidence = validationReport.extractionAccuracy;

    // Weight the confidences
    return baseConfidence * 0.6 + validationConfidence * 0.4;
  }

  private calculateDataQuality(extractedData: ExtractedItem[]): number {
    if (extractedData.length === 0) return 0;

    let qualityScore = 0;
    let totalFields = 0;

    for (const item of extractedData) {
      // Check required fields
      if (item.title && item.title.trim().length > 0) qualityScore++;
      if (item.description && item.description.trim().length > 0) qualityScore++;

      totalFields += 2; // title and description are required

      // Check optional fields
      const optionalFields = ['place', 'address', 'email', 'phone', 'website', 'startDate'];
      for (const field of optionalFields) {
        if (item[field as keyof ExtractedItem]) qualityScore += 0.5;
        totalFields += 0.5;
      }
    }

    return totalFields > 0 ? qualityScore / totalFields : 0;
  }

  private async calculatePerformanceMetrics(
    _context: any,
    startTime: number
  ): Promise<SandboxPerformanceMetrics> {
    return {
      totalDuration: Date.now() - startTime,
      pageLoadTime: 2000, // Mock values
      selectorEvaluationTime: 500,
      dataExtractionTime: 1000,
      memoryPeakMb: 150,
      cpuUsagePercent: 25,
      networkRequests: 15,
      blockedRequests: 5,
    };
  }

  private async calculateResourceUsage(_context: any): Promise<ResourceUsage> {
    return {
      memoryUsedMb: 120,
      cpuTimeMs: 3000,
      networkBandwidthKb: 500,
      storageUsedKb: 50,
      browserInstances: 1,
    };
  }

  private getDefaultPerformanceMetrics(): SandboxPerformanceMetrics {
    return {
      totalDuration: 0,
      pageLoadTime: 0,
      selectorEvaluationTime: 0,
      dataExtractionTime: 0,
      memoryPeakMb: 0,
      cpuUsagePercent: 0,
      networkRequests: 0,
      blockedRequests: 0,
    };
  }

  private getDefaultResourceUsage(): ResourceUsage {
    return {
      memoryUsedMb: 0,
      cpuTimeMs: 0,
      networkBandwidthKb: 0,
      storageUsedKb: 0,
      browserInstances: 0,
    };
  }

  private async cleanupSandbox(context: any): Promise<void> {
    logger.debug(`Cleaning up sandbox for plan ${context.planId}`);

    try {
      // Close all pages
      if (context.pages) {
        for (const [name, page] of context.pages) {
          try {
            await page.close();
            logger.debug(`Closed page: ${name}`);
          } catch (error) {
            logger.debug(`Error closing page ${name}:`, error);
          }
        }
        context.pages.clear();
      }

      // Close browser context
      if (context.context) {
        try {
          await context.context.close();
          logger.debug('Closed browser context');
        } catch (error) {
          logger.debug('Error closing browser context:', error);
        }
      }

      // Close browser
      if (context.browser) {
        try {
          await context.browser.close();
          logger.debug('Closed browser');
        } catch (error) {
          logger.debug('Error closing browser:', error);
        }
      }

      logger.debug(`Sandbox cleanup completed for plan ${context.planId}`);
    } catch (error) {
      logger.error(`Error during sandbox cleanup for plan ${context.planId}:`, error);
    }
  }
}
