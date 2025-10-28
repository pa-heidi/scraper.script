/**
 * Cookie Consent Handler Service
 * Automatically detects and handles cookie consent dialogs across websites
 * Requirements: Cookie consent handling for German municipal websites and other sources
 */

import { Page, ElementHandle } from 'playwright';
import { logger } from '../utils/logger';
import { getCentralizedLLMService } from './centralized-llm.service';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface CookieConsentConfig {
  strategy: 'accept-all' | 'reject-all' | 'minimal' | 'ai-decide';
  languages: string[]; // ['de', 'en', 'fr']
  timeout: number; // 5000ms
  retryAttempts: number; // 3
  fallbackStrategy: 'skip' | 'fail' | 'continue';
}

export interface ConsentButtons {
  acceptAll?: { selector: string; text: string };
  rejectAll?: { selector: string; text: string };
  settings?: { selector: string; text: string };
  save?: { selector: string; text: string }; // NEW
  close?: { selector: string; text: string };
}

export interface ConsentHandlingResult {
  success: boolean;
  method: 'heuristic' | 'ai' | 'llm-primary' | 'llm-fallback' | 'stored-selectors' | 'none';
  buttonClicked?: string;
  error?: string;
  duration: number;
  library?: string;
  // NEW: Cookie consent metadata
  metadata: {
    detected: boolean;
    strategy: 'accept-all' | 'reject-all' | 'minimal' | 'ai-decide' | 'none-detected';
    library?: string;
    buttonSelectors?: {
      accept?: string;
      reject?: string;
      save?: string;
      close?: string;
    };
    // Enhanced selectors for plan reuse
    selectors?: Record<string, string>;
    acceptButtonSelector?: string;
    rejectButtonSelector?: string;
    settingsButtonSelector?: string;
    bannerSelector?: string;
    modalSelector?: string;
    handledSuccessfully?: boolean;
    handledAt?: Date;
    llmPlan?: CookieConsentLLMPlan;
    llmVerification?: LLMVerificationResult;
  };
}

export interface LLMVerificationResult {
  success: boolean;
  confidence: number;
  reasoning: string;
  detectedElements: string[];
  verificationMethod: 'page-analysis' | 'element-detection' | 'content-check';
  timestamp: Date;
}

export interface CookieConsentLLMPlan {
  url: string;
  domain: string;
  library: string;
  steps: CookieConsentStep[];
  createdAt: Date;
  successRate?: number;
  verificationResults?: LLMVerificationResult[];
  lastUsed?: Date;
  usageCount?: number;
}

export interface CookieConsentStep {
  stepNumber: number;
  action: 'click' | 'wait' | 'scroll' | 'select';
  selector: string;
  description: string;
  waitTime?: number;
  fallbackSelectors?: string[];
}

export class CookieConsentHandler {
  private config: CookieConsentConfig;

  // NEW: Domain-level consent cache to avoid redundant checks
  private domainConsentCache = new Map<string, {
    result: ConsentHandlingResult;
    timestamp: number;
    ttl: number; // Time to live in milliseconds
  }>();

  constructor(config?: Partial<CookieConsentConfig>) {
    this.config = {
      strategy: (process.env.COOKIE_CONSENT_STRATEGY as any) || 'accept-all',
      languages: (process.env.COOKIE_CONSENT_LANGUAGES || 'de,en').split(','),
      timeout: parseInt(process.env.COOKIE_CONSENT_TIMEOUT || '5000'),
      retryAttempts: 3,
      fallbackStrategy: 'continue',
      ...config,
    };
  }

  /**
   * Extract domain from URL for caching
   */
  private extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch (error) {
      logger.warn(`Failed to extract domain from URL: ${url}`, error);
      return url; // Fallback to full URL
    }
  }

  /**
   * Check if domain consent is cached and still valid
   */
  private getCachedDomainConsent(domain: string): ConsentHandlingResult | null {
    const cached = this.domainConsentCache.get(domain);
    if (!cached) {
      return null;
    }

    const now = Date.now();
    if (now - cached.timestamp > cached.ttl) {
      // Cache expired
      this.domainConsentCache.delete(domain);
      logger.debug(`Domain consent cache expired for ${domain}`);
      return null;
    }

    logger.info(`🍪 Using cached consent result for domain: ${domain}`);
    return cached.result;
  }

  /**
   * Cache domain consent result
   */
  private cacheDomainConsent(domain: string, result: ConsentHandlingResult, ttlMinutes: number = 60): void {
    const ttl = ttlMinutes * 60 * 1000; // Convert to milliseconds
    this.domainConsentCache.set(domain, {
      result,
      timestamp: Date.now(),
      ttl
    });
    logger.debug(`Cached consent result for domain: ${domain} (TTL: ${ttlMinutes} minutes)`);
  }

  /**
   * Clear domain consent cache (useful for testing or when consent changes)
   */
  public clearDomainCache(domain?: string): void {
    if (domain) {
      this.domainConsentCache.delete(domain);
      logger.debug(`Cleared consent cache for domain: ${domain}`);
    } else {
      this.domainConsentCache.clear();
      logger.debug(`Cleared all domain consent cache`);
    }
  }

  /**
   * Handle cookie consent using pre-existing selectors from plan metadata
   */
  async handleCookieConsentWithSelectors(
    page: Page,
    url: string,
    selectors: Record<string, string>,
    config?: Partial<CookieConsentConfig>
  ): Promise<ConsentHandlingResult> {
    const startTime = Date.now();
    const finalConfig = { ...this.config, ...config };

    try {
      logger.info(`🍪 Using pre-existing selectors for cookie consent on ${url}`);

      // Try to use the stored dialog selector
      if (selectors.dialog) {
        try {
          const dialogElement = await page.$(selectors.dialog);
          if (dialogElement && await dialogElement.isVisible()) {
            logger.debug(`Found dialog using stored selector: ${selectors.dialog}`);

            // Try to click the appropriate button based on strategy
            let buttonSelector = '';
            let buttonType = '';

            switch (finalConfig.strategy) {
              case 'accept-all':
                buttonSelector = selectors.accept || selectors.acceptButtonSelector || '';
                buttonType = 'accept';
                break;
              case 'reject-all':
                buttonSelector = selectors.reject || selectors.rejectButtonSelector || '';
                buttonType = 'reject';
                break;
              case 'minimal':
                buttonSelector = selectors.settings || selectors.settingsButtonSelector || selectors.reject || '';
                buttonType = 'settings/reject';
                break;
              default:
                buttonSelector = selectors.accept || '';
                buttonType = 'accept';
            }

            if (buttonSelector) {
              logger.debug(`Attempting to click ${buttonType} button: ${buttonSelector}`);

              try {
                await page.click(buttonSelector, { timeout: 5000 });
                await page.waitForTimeout(1000); // Wait for action to complete

                return {
                  success: true,
                  method: 'stored-selectors',
                  buttonClicked: buttonType,
                  duration: Date.now() - startTime,
                  metadata: {
                    detected: true,
                    strategy: finalConfig.strategy as any,
                    selectors,
                    handledSuccessfully: true,
                    handledAt: new Date()
                  }
                };
              } catch (clickError) {
                logger.warn(`Failed to click stored selector ${buttonSelector}:`, clickError);
                // Fall through to full detection
              }
            }
          }
        } catch (error) {
          logger.warn(`Failed to use stored dialog selector ${selectors.dialog}:`, error);
          // Fall through to full detection
        }
      }

      // If stored selectors failed, fall back to full detection
      logger.info(`Stored selectors failed, falling back to full cookie consent detection`);
      return await this.handleCookieConsent(page, url, config);

    } catch (error) {
      logger.error(`❌ Error handling cookie consent with selectors on ${url}:`, error);
      return {
        success: false,
        method: 'stored-selectors',
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
        metadata: {
          detected: false,
          strategy: 'none-detected',
          handledAt: new Date()
        }
      };
    }
  }

  /**
   * Main entry point for handling cookie consent
   */
  async handleCookieConsent(page: Page, url: string, config?: Partial<CookieConsentConfig>): Promise<ConsentHandlingResult> {
    const startTime = Date.now();
    const finalConfig = { ...this.config, ...config };

    try {
      // NEW: Check domain-level cache first
      const domain = this.extractDomain(url);
      const cachedResult = this.getCachedDomainConsent(domain);
      if (cachedResult) {
        logger.info(`🍪 Using cached consent result for ${url} (domain: ${domain})`);
        return {
          ...cachedResult,
          duration: Date.now() - startTime // Update duration for this call
        };
      }

      logger.debug(`🍪 Checking for cookie consent dialog on ${url}`);

      // Detect if there's a cookie dialog
      const hasDialog = await this.detectCookieDialog(page);
      if (!hasDialog) {
        logger.debug(`No cookie consent dialog detected on ${url}`);
        const noDialogResult = {
          success: true,
          method: 'none' as const,
          duration: Date.now() - startTime,
          metadata: {
            detected: false,
            strategy: 'none-detected' as const,
            handledAt: new Date()
          }
        };

        // Cache the "no dialog" result for this domain
        this.cacheDomainConsent(domain, noDialogResult, 60);

        return noDialogResult;
      }

      logger.info(`🍪 Detected cookie consent dialog on ${url}`);

      // Capture debug screenshot of detected dialog
      await this.captureDebugScreenshot(page, 'dialog-detected');

      // Get the dialog element
      const dialogResult = await this.getCookieDialogElement(page);
      if (!dialogResult) {
        logger.warn(`Cookie dialog detected but no dialog element found on ${url}`);
        const noElementResult = {
          success: false,
          method: 'none' as const,
          error: 'Dialog element not found',
          duration: Date.now() - startTime,
          metadata: {
            detected: true,
            strategy: 'none-detected' as const,
            handledAt: new Date()
          }
        };

        // Cache the failed result for this domain (shorter TTL)
        this.cacheDomainConsent(domain, noElementResult, 10); // Cache for 10 minutes only

        return noElementResult;
      }

      // Detect cookie consent library
      const library = await this.detectCookieConsentLibrary(page);
      if (library) {
        logger.debug(`Detected cookie consent library: ${library}`);
      }

      // Extract dialog element and selector
      const dialogElement = dialogResult.element;
      const dialogSelector = dialogResult.selector;

      // Use heuristics first, then LLM analysis, with fallback logic
      let result: ConsentHandlingResult;
      let buttons: ConsentButtons = {};

      // Always start with heuristics
      try {
        buttons = await this.identifyButtonsWithHeuristics(page, dialogElement);
        logger.debug(`Heuristics identified ${Object.keys(buttons).length} consent buttons`);
      } catch (error) {
        logger.warn(`Heuristic button identification failed:`, error);
        buttons = {};
      }

      // Click the appropriate button based on strategy
      const clickResult = await this.clickConsentButton(page, buttons, finalConfig.strategy);
      if (!clickResult.success) {
        logger.warn(`Standard cookie consent handling failed: ${clickResult.error}`);

        // Try LLM-based fallback
        logger.info('🤖 Attempting LLM-based cookie consent fallback...');
        const llmResult = await this.handleWithLLMFallback(page, url, library);

        if (llmResult.success) {
          logger.info('✅ LLM fallback successfully handled cookie consent');
          result = {
            success: true,
            method: 'llm-fallback',
            buttonClicked: llmResult.buttonClicked,
            duration: Date.now() - startTime,
            library,
            metadata: {
              detected: true,
              strategy: finalConfig.strategy as any,
              library,
              buttonSelectors: {
                accept: buttons.acceptAll?.selector,
                reject: buttons.rejectAll?.selector,
                save: buttons.save?.selector,
                close: buttons.close?.selector
              },
              // Enhanced selectors for plan reuse (from LLM plan)
              selectors: llmResult.llmPlan ? this.extractSelectorsFromLLMPlan(llmResult.llmPlan, dialogSelector) : {
                dialog: dialogSelector
              },
              acceptButtonSelector: buttons.acceptAll?.selector,
              rejectButtonSelector: buttons.rejectAll?.selector,
              settingsButtonSelector: buttons.settings?.selector,
              bannerSelector: dialogSelector,
              modalSelector: dialogSelector,
              handledSuccessfully: true,
              handledAt: new Date(),
              llmPlan: llmResult.llmPlan
            }
          };
        } else {
          result = {
            success: false,
            method: 'heuristic',
            error: clickResult.error,
            duration: Date.now() - startTime,
            library,
            metadata: {
              detected: true,
              strategy: finalConfig.strategy as any,
              library,
              buttonSelectors: {
                accept: buttons.acceptAll?.selector,
                reject: buttons.rejectAll?.selector,
                save: buttons.save?.selector,
                close: buttons.close?.selector
              },
              // Include selectors even on failure for debugging
              selectors: {
                dialog: dialogSelector,
                accept: buttons.acceptAll?.selector || '',
                reject: buttons.rejectAll?.selector || '',
                save: buttons.save?.selector || '',
                close: buttons.close?.selector || ''
              },
              bannerSelector: dialogSelector,
              modalSelector: dialogSelector,
              handledSuccessfully: false,
              handledAt: new Date()
            }
          };
        }
      } else {
        result = {
          success: true,
          method: 'heuristic',
          buttonClicked: clickResult.buttonClicked,
          duration: Date.now() - startTime,
          library,
          metadata: {
            detected: true,
            strategy: finalConfig.strategy as any,
            library,
            buttonSelectors: {
              accept: buttons.acceptAll?.selector,
              reject: buttons.rejectAll?.selector,
              save: buttons.save?.selector,
              close: buttons.close?.selector
            },
            // Enhanced selectors for plan reuse
            selectors: {
              dialog: dialogSelector,
              accept: buttons.acceptAll?.selector || '',
              reject: buttons.rejectAll?.selector || '',
              save: buttons.save?.selector || '',
              close: buttons.close?.selector || ''
            },
            acceptButtonSelector: buttons.acceptAll?.selector,
            rejectButtonSelector: buttons.rejectAll?.selector,
            settingsButtonSelector: buttons.settings?.selector,
            bannerSelector: dialogSelector,
            modalSelector: dialogSelector,
            handledSuccessfully: true,
            handledAt: new Date()
          }
        };
      }



      // Always perform LLM verification of cookie consent success
      if (result.success) {
        logger.info('🔍 Performing LLM verification of cookie consent success...');
        const verification = await this.verifyConsentWithLLM(page, url, library);
        result.metadata.llmVerification = verification;

        if (!verification.success) {
          logger.warn('⚠️ LLM verification indicates cookie consent may not have been successful');
          result.success = false;
          result.error = `LLM verification failed: ${verification.reasoning}`;
        } else {
          logger.info(`✅ LLM verification successful (confidence: ${verification.confidence}%)`);
        }

        // Save verification results to plan if available
        if (result.metadata.llmPlan) {
          await this.saveCookieConsentPlan(result.metadata.llmPlan, verification);
        }
      }

      // Capture debug screenshot after handling
      await this.captureDebugScreenshot(page, 'after-handling');

      logger.info(`✅ Cookie consent handling completed on ${url}`, {
        method: result.method,
        buttonClicked: result.buttonClicked,
        library,
        duration: `${result.duration}ms`,
        llmVerified: !!result.metadata.llmVerification
      });

      // NEW: Cache the result at domain level for future requests
      this.cacheDomainConsent(domain, result, 60); // Cache for 60 minutes

      return result;

    } catch (error) {
      logger.error(`❌ Error handling cookie consent on ${url}:`, error);
      const errorResult = {
        success: false,
        method: 'none' as const,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
        metadata: {
          detected: false,
          strategy: 'none-detected' as const,
          handledAt: new Date()
        }
      };

      // Cache error result for shorter time to allow retry
      this.cacheDomainConsent(this.extractDomain(url), errorResult, 5); // Cache for 5 minutes only

      return errorResult;
    }
  }

  /**
   * Detect if there's a cookie consent dialog on the page
   */
  private async detectCookieDialog(page: Page): Promise<boolean> {
    try {
      // Enhanced German cookie consent keywords
      const cookieKeywords = [
        'cookie', 'consent', 'zustimmen', 'akzeptieren', 'datenschutz',
        // NEW German terms
        'cookie-präferenzen', 'cookie-disclaimer', 'cookie-einstellungen',
        'datenschutzeinstellungen', 'einwilligung', 'speichern', 'auswählen',
        'alle auswählen', 'alle abwählen', 'cookie-banner', 'cookie-hinweis'
      ];
      const pageContent = await page.content();
      const hasKeywords = cookieKeywords.some(keyword =>
        pageContent.toLowerCase().includes(keyword.toLowerCase())
      );

      if (!hasKeywords) {
        return false;
      }

      // Enhanced overlay selectors for dialogs
      const overlaySelectors = [
        '[class*="cookie"]',
        '[id*="cookie"]',
        '[class*="consent"]',
        '[id*="consent"]',
        '[class*="gdpr"]',
        '[id*="gdpr"]',
        '[class*="disclaimer"]', // NEW
        '[id*="disclaimer"]',    // NEW
        '[class*="präferenzen"]', // NEW
        '[id*="präferenzen"]',    // NEW
        '.cookie-banner',
        '.consent-banner',
        '.cookie-notice',
        '.privacy-notice',
        '.cookie-disclaimer',     // NEW
        '.cookie-preferences',    // NEW
        '[role="dialog"]',        // NEW
        '[aria-modal="true"]'     // NEW
      ];

      // First, try to wait for common cookie dialog elements to appear
      const commonDialogSelectors = [
        '[class*="cookie"]',
        '[id*="cookie"]',
        '[class*="consent"]',
        '[class*="disclaimer"]',
        '[role="dialog"]',
        '.cookie-banner',
        '.consent-banner'
      ];

      // Wait for any cookie dialog to appear (up to 3 seconds)
      try {
        await page.waitForSelector(commonDialogSelectors.join(', '), {
          state: 'visible',
          timeout: 3000
        });
      } catch {
        // No dialog found within timeout, continue with keyword check
      }

      for (const selector of overlaySelectors) {
        const elements = await page.$$(selector);
        for (const element of elements) {
          const isVisible = await element.isVisible();
          if (isVisible) {
            // Check if it's likely a cookie dialog based on position and content
            const boundingBox = await element.boundingBox();
            if (boundingBox && await this.isLikelyCookieDialog(element, boundingBox)) {
              return true;
            }
          }
        }
      }

      return false;
    } catch (error) {
      logger.debug(`Error detecting cookie dialog:`, error);
      return false;
    }
  }

  /**
   * Get the main cookie dialog element
   */
  private async getCookieDialogElement(page: Page): Promise<{ element: ElementHandle; selector: string } | null> {
    try {
      // Enhanced dialog selectors including disclaimer and modal patterns
      const dialogSelectors = [
        '[class*="cookie"][class*="dialog"]',
        '[class*="cookie"][class*="banner"]',
        '[class*="consent"][class*="dialog"]',
        '[class*="consent"][class*="banner"]',
        '[class*="disclaimer"]', // NEW
        '[id*="disclaimer"]',    // NEW
        '[class*="modal"]',      // NEW
        '[role="dialog"]',       // NEW
        '[aria-modal="true"]',   // NEW
        '.cookie-banner',
        '.cookie-banner-container',
        '.consent-banner',
        '.cookie-notice',
        '.privacy-notice',
        '.cookie-disclaimer',    // NEW
        '.cookie-preferences',   // NEW
        '[id*="cookie"][id*="banner"]',
        '[id*="consent"][id*="banner"]',
        '[id*="disclaimer"]',    // NEW
        // Fallback: any element with cookie-related text
        'div:has-text("cookie")',
        'div:has-text("Cookie")',
        'div:has-text("COOKIE")',
        'div:has-text("consent")',
        'div:has-text("Consent")',
        'div:has-text("disclaimer")',
        'div:has-text("Disclaimer")',
        'div:has-text("DISCLAIMER")',
      ];

      for (const selector of dialogSelectors) {
        try {
          const elements = await page.$$(selector);
          for (const element of elements) {
            const isVisible = await element.isVisible();
            // Additional check for computed styles to ensure element is truly visible
            const isReallyVisible = await element.evaluate((el: Element) => {
              const style = window.getComputedStyle(el);
              return style.display !== 'none' &&
                     style.visibility !== 'hidden' &&
                     style.opacity !== '0' &&
                     (el as HTMLElement).offsetWidth > 0 &&
                     (el as HTMLElement).offsetHeight > 0;
            });

            if (isVisible && isReallyVisible) {
              // Additional check: ensure it's likely a dialog
              const boundingBox = await element.boundingBox();
              if (boundingBox && await this.isLikelyCookieDialog(element, boundingBox)) {
                logger.debug(`Found cookie dialog element with selector: ${selector}`);
                return { element, selector };
              }
            }
          }
        } catch (selectorError) {
          // Some selectors might not be supported, continue with next
          logger.debug(`Selector ${selector} failed:`, selectorError);
        }
      }

      // Fallback: look for any visible overlay that might be a cookie dialog
      const allElements = await page.$$('div, section, aside, dialog');
      for (const element of allElements) {
        try {
          const isVisible = await element.isVisible();
          if (isVisible) {
            const boundingBox = await element.boundingBox();
            if (boundingBox && await this.isLikelyCookieDialog(element, boundingBox)) {
              // Check if it contains cookie-related text
              const textContent = await element.textContent();
              if (textContent && this.containsCookieKeywords(textContent)) {
                logger.debug(`Found cookie dialog element via fallback method`);
                return { element, selector: 'fallback-dialog' };
              }
            }
          }
        } catch (error) {
          // Continue with next element
        }
      }

      return null;
    } catch (error) {
      logger.debug(`Error getting cookie dialog element:`, error);
      return null;
    }
  }

  /**
   * Extract selectors from LLM plan for reuse
   */
  private extractSelectorsFromLLMPlan(llmPlan: CookieConsentLLMPlan, dialogSelector: string): Record<string, string> {
    const selectors: Record<string, string> = {
      dialog: dialogSelector
    };

    // Extract selectors from LLM plan steps
    llmPlan.steps.forEach((step, index) => {
      if (step.action === 'click') {
        selectors[`step_${index + 1}`] = step.selector;

        // Try to categorize based on description
        const desc = step.description.toLowerCase();
        if (desc.includes('accept') || desc.includes('zustimmen')) {
          selectors.accept = step.selector;
        } else if (desc.includes('reject') || desc.includes('ablehnen')) {
          selectors.reject = step.selector;
        } else if (desc.includes('save') || desc.includes('speichern')) {
          selectors.save = step.selector;
        } else if (desc.includes('settings') || desc.includes('einstellungen')) {
          selectors.settings = step.selector;
        }
      }
    });

    return selectors;
  }

  /**
   * Check if text contains cookie-related keywords
   */
  private containsCookieKeywords(text: string): boolean {
    const cookieKeywords = [
      'cookie', 'consent', 'zustimmen', 'akzeptieren', 'datenschutz',
      'cookie-präferenzen', 'cookie-disclaimer', 'cookie-einstellungen',
      'datenschutzeinstellungen', 'einwilligung', 'speichern', 'auswählen',
      'alle auswählen', 'alle abwählen', 'cookie-banner', 'cookie-hinweis'
    ];

    const normalizedText = text.toLowerCase();
    return cookieKeywords.some(keyword => normalizedText.includes(keyword.toLowerCase()));
  }

  /**
   * Check if an element is likely a cookie dialog based on its properties
   */
  private async isLikelyCookieDialog(element: ElementHandle, boundingBox: any): Promise<boolean> {
    try {
      // Check if element is positioned as an overlay (fixed or absolute)
      const computedStyle = await element.evaluate((el: Element) => {
        const style = window.getComputedStyle(el);
        return {
          position: style.position,
          zIndex: parseInt(style.zIndex) || 0,
          display: style.display,
          visibility: style.visibility,
          opacity: parseFloat(style.opacity) || 1,
        };
      });

      // Check if it's positioned as an overlay
      const isOverlay = computedStyle.position === 'fixed' || computedStyle.position === 'absolute';
      const hasHighZIndex = computedStyle.zIndex > 100;
      const isVisible = computedStyle.visibility !== 'hidden' && computedStyle.opacity > 0;

      // Check if it's at the bottom, top, or center of the viewport (common for cookie banners)
      const isAtBottom = boundingBox.y > 500; // Roughly bottom half of screen
      const isAtTop = boundingBox.y < 100; // Roughly top of screen
      const isCentered = boundingBox.y > 100 && boundingBox.y < 500; // Center of screen

      // Check if it covers a significant portion of the viewport
      const viewportHeight = 1080; // Default viewport height
      const coversSignificantArea = boundingBox.height > viewportHeight * 0.1; // At least 10% of viewport

      return isOverlay && isVisible && (hasHighZIndex || isAtBottom || isAtTop || isCentered) && coversSignificantArea;
    } catch (error) {
      logger.debug(`Error checking if element is cookie dialog:`, error);
      return false;
    }
  }

  /**
   * Identify consent buttons using heuristics
   */
  private async identifyButtonsWithHeuristics(page: Page, dialogElement: ElementHandle): Promise<ConsentButtons> {
    const buttons: ConsentButtons = {};

    try {
      // Common button selectors
      const buttonSelectors = [
        'button',
        'a[role="button"]',
        'input[type="button"]',
        'input[type="submit"]',
        '[role="button"]',
      ];

      // Enhanced language-specific button text patterns
      const buttonPatterns = {
        acceptAll: [
          // German - Enhanced
          'akzeptieren', 'alle akzeptieren', 'zustimmen', 'alle zustimmen',
          'akzeptiere alle', 'alle cookies akzeptieren', 'cookies akzeptieren',
          'alle auswählen', 'alle erlauben', 'alle zulassen', // NEW
          'alle cookies zulassen', 'auswahl bestätigen', // gera.de specific
          // English
          'accept all', 'accept all cookies', 'allow all', 'allow all cookies',
          'accept', 'agree', 'i agree', 'i accept',
          // French
          'accepter tout', 'accepter tous', 'j\'accepte', 'j\'accepte tout',
        ],
        rejectAll: [
          // German - Enhanced
          'ablehnen', 'alle ablehnen', 'verweigern', 'alle verweigern',
          'ablehne alle', 'nur notwendige', 'nur erforderliche',
          'alle abwählen', 'nicht zustimmen', // NEW
          'nur notwendige cookies zulassen', // gera.de specific
          // English
          'reject all', 'reject all cookies', 'decline all', 'decline',
          'reject', 'disagree', 'i disagree', 'necessary only',
          // French
          'refuser tout', 'refuser tous', 'je refuse', 'nécessaires seulement',
        ],
        settings: [
          // German - Enhanced
          'einstellungen', 'optionen', 'präferenzen', 'anpassen',
          'cookie einstellungen', 'cookie optionen', 'cookie-präferenzen', // NEW
          // English
          'settings', 'preferences', 'options', 'customize',
          'cookie settings', 'manage cookies',
          // French
          'paramètres', 'préférences', 'options', 'personnaliser',
          'paramètres cookies',
        ],
        save: [ // NEW category
          'speichern', 'save', 'sauvegarder', 'ok', 'fertig'
        ],
        close: [
          // German
          'schließen', 'schließen', 'x', '×',
          // English
          'close', 'x', '×', 'dismiss',
          // French
          'fermer', 'x', '×', 'fermer',
        ],
      };

      // Find all buttons within the dialog
      const allButtons = await dialogElement.$$(buttonSelectors.join(', '));

      // If no buttons found in dialog, try to find them in the page (they might be outside the dialog container)
      if (allButtons.length === 0) {
        logger.debug('No buttons found in dialog element, searching entire page...');
        const pageButtons = await page.$$(buttonSelectors.join(', '));
        // Filter buttons that are likely part of the cookie consent
        for (const button of pageButtons) {
          const buttonText = await button.textContent();
          if (buttonText && this.containsCookieKeywords(buttonText)) {
            allButtons.push(button);
          }
        }
        logger.debug(`Found ${allButtons.length} potential cookie consent buttons on page`);
      }

      logger.debug(`Processing ${allButtons.length} buttons for cookie consent`);

      for (const button of allButtons) {
        try {
          // Check if button is truly visible (not in a hidden container)
          const isButtonVisible = await button.evaluate((el: Element) => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' &&
                   style.visibility !== 'hidden' &&
                   style.opacity !== '0' &&
                   (el as HTMLElement).offsetWidth > 0 &&
                   (el as HTMLElement).offsetHeight > 0;
          });

          const buttonText = await button.textContent();
          const buttonClass = await button.getAttribute('class') || '';
          const buttonId = await button.getAttribute('id') || '';

          logger.debug(`Button found: text="${buttonText}", class="${buttonClass}", id="${buttonId}", visible=${isButtonVisible}`);

          if (!isButtonVisible) continue;
          if (!buttonText) continue;

          const normalizedText = buttonText.toLowerCase().trim();

          // Check for accept all buttons (prioritize this first)
          if (!buttons.acceptAll && this.matchesPatterns(normalizedText, buttonPatterns.acceptAll, buttonClass, buttonId)) {
            const selector = await this.generateSelector(button);
            buttons.acceptAll = { selector, text: buttonText };
            logger.debug(`Found accept all button: "${buttonText}" (${selector})`);
            continue; // Don't check other types for this button
          }

          // Check for reject all buttons
          if (!buttons.rejectAll && this.matchesPatterns(normalizedText, buttonPatterns.rejectAll, buttonClass, buttonId)) {
            const selector = await this.generateSelector(button);
            buttons.rejectAll = { selector, text: buttonText };
            logger.debug(`Found reject all button: "${buttonText}" (${selector})`);
            continue; // Don't check other types for this button
          }

          // Check for save buttons (prioritize over close)
          if (!buttons.save && this.matchesPatterns(normalizedText, buttonPatterns.save, buttonClass, buttonId)) {
            const selector = await this.generateSelector(button);
            buttons.save = { selector, text: buttonText };
            logger.debug(`Found save button: "${buttonText}" (${selector})`);
            continue; // Don't check other types for this button
          }

          // Check for settings buttons
          if (!buttons.settings && this.matchesPatterns(normalizedText, buttonPatterns.settings, buttonClass, buttonId)) {
            const selector = await this.generateSelector(button);
            buttons.settings = { selector, text: buttonText };
            logger.debug(`Found settings button: "${buttonText}" (${selector})`);
            continue; // Don't check other types for this button
          }

          // Check for close buttons (last priority)
          if (!buttons.close && this.matchesPatterns(normalizedText, buttonPatterns.close, buttonClass, buttonId)) {
            const selector = await this.generateSelector(button);
            buttons.close = { selector, text: buttonText };
            logger.debug(`Found close button: "${buttonText}" (${selector})`);
          }

        } catch (error) {
          logger.debug(`Error processing button:`, error);
        }
      }

      logger.debug(`Heuristic identification found ${Object.keys(buttons).length} buttons`);
      return buttons;

    } catch (error) {
      logger.error(`Error in heuristic button identification:`, error);
      return buttons;
    }
  }

  /**
   * Check if button text/class/id matches any of the patterns
   */
  private matchesPatterns(text: string, patterns: string[], className: string, id: string): boolean {
    const searchText = `${text} ${className} ${id}`.toLowerCase();
    return patterns.some(pattern => searchText.includes(pattern.toLowerCase()));
  }

  /**
   * Generate a CSS selector for a button element
   */
  private async generateSelector(button: ElementHandle): Promise<string> {
    try {
      // Try to create a unique selector
      const id = await button.getAttribute('id');
      if (id) {
        return `#${id}`;
      }

      // Get button text for more specific selectors
      const text = await button.textContent();
      const normalizedText = text ? text.trim() : '';

      // Try to create a text-based selector first (most specific)
      if (normalizedText) {
        const tagName = await button.evaluate((el: Element) => el.tagName.toLowerCase());

        // For cookie consent buttons, use text-based selectors to avoid conflicts
        if (normalizedText.toLowerCase().includes('cookie') ||
            normalizedText.toLowerCase().includes('zulassen') ||
            normalizedText.toLowerCase().includes('akzeptieren') ||
            normalizedText.toLowerCase().includes('ablehnen') ||
            normalizedText.toLowerCase().includes('notwendige')) {
          return `${tagName}:has-text("${normalizedText}")`;
        }
      }

      // Try class-based selector with context
      const className = await button.getAttribute('class');
      if (className) {
        const classes = className.split(' ').filter(c => c.trim());
        if (classes.length > 0) {
          // If multiple classes, try to create a more specific selector
          if (classes.length > 1) {
            // Combine multiple classes for specificity
            const combinedClasses = classes.slice(0, 3).join('.');

            // Add parent context if the selector might be too generic
            if (classes.some(c => ['btn', 'button', 'text-nowrap'].includes(c))) {
              // Try to get parent context for more specificity
              try {
                const parentClass = await button.evaluate((el: Element) => {
                  const parent = el.parentElement;
                  return parent ? parent.className : '';
                });

                if (parentClass && parentClass.includes('cookie')) {
                  return `.${parentClass.split(' ')[0]} .${combinedClasses}`;
                }
              } catch (e) {
                // Continue with fallback
              }
            }

            return `.${combinedClasses}`;
          } else {
            // Single class - use it but add text context if generic
            const singleClass = classes[0];
            if (['btn', 'button', 'text-nowrap'].includes(singleClass) && normalizedText) {
              const tagName = await button.evaluate((el: Element) => el.tagName.toLowerCase());
              return `${tagName}.${singleClass}:has-text("${normalizedText}")`;
            }
            return `.${singleClass}`;
          }
        }
      }

      // Fallback to text-based selector
      if (normalizedText) {
        const tagName = await button.evaluate((el: Element) => el.tagName.toLowerCase());
        return `${tagName}:has-text("${normalizedText}")`;
      }

      // Final fallback to tag name
      const tagName = await button.evaluate((el: Element) => el.tagName.toLowerCase());
      return tagName;
    } catch (error) {
      return 'button';
    }
  }

  /**
   * Identify consent buttons using AI
   */
  private async identifyButtonsWithAI(page: Page, dialogElement: ElementHandle): Promise<ConsentButtons> {
    try {
      // Extract HTML content of the dialog
      const dialogHTML = await dialogElement.innerHTML();

      // Enhanced prompt for AI analysis with German-specific guidance
      const prompt = `
Analyze this cookie consent dialog HTML. This is likely a German website, so look for German button text.

${dialogHTML}

Common German button texts to look for:
- Accept All: "alle auswählen", "alle akzeptieren", "alle zustimmen"
- Reject All: "alle abwählen", "alle ablehnen", "nur notwendige"
- Settings: "einstellungen", "präferenzen", "optionen"
- Save: "speichern", "ok", "fertig"
- Close: "schließen", "x"

Return JSON with button selectors and text:
{
  "acceptAll": { "selector": "CSS_SELECTOR", "text": "BUTTON_TEXT" },
  "rejectAll": { "selector": "CSS_SELECTOR", "text": "BUTTON_TEXT" },
  "settings": { "selector": "CSS_SELECTOR", "text": "BUTTON_TEXT" },
  "save": { "selector": "CSS_SELECTOR", "text": "BUTTON_TEXT" },
  "close": { "selector": "CSS_SELECTOR", "text": "BUTTON_TEXT" }
}

Only include buttons that exist. Use specific CSS selectors that can be used with document.querySelector().
Focus on buttons that handle cookie consent.
`;

      // Use the centralized LLM service
      const llmService = getCentralizedLLMService();
      const response = await llmService.generate({
        prompt,
        systemMessage: "You are an expert at identifying cookie consent buttons. Analyze the HTML and return valid JSON with button selectors.",
        format: "json" as const,
        temperature: 0.1,
        maxTokens: 1000,
        service: 'cookie-consent',
        method: 'identifyButtonsWithAI',
        context: {
          url: page.url(),
          step: 'button-identification'
        }
      });

      if (!response || !response.content) {
        throw new Error('No response from AI');
      }

      // Parse the JSON response
      const aiButtons = JSON.parse(response.content);
      const buttons: ConsentButtons = {};

      // Validate and convert AI response
      for (const [buttonType, buttonData] of Object.entries(aiButtons)) {
        if (buttonData && typeof buttonData === 'object' && 'selector' in buttonData && 'text' in buttonData) {
          const typedButtonData = buttonData as { selector: string; text: string };

          // Validate that the selector works
          try {
            const element = await page.$(typedButtonData.selector);
            if (element) {
              buttons[buttonType as keyof ConsentButtons] = typedButtonData;
              logger.debug(`AI found ${buttonType} button: "${typedButtonData.text}" (${typedButtonData.selector})`);
            }
          } catch (error) {
            logger.debug(`AI selector validation failed for ${buttonType}:`, error);
          }
        }
      }

      logger.debug(`AI identification found ${Object.keys(buttons).length} buttons`);
      return buttons;

    } catch (error) {
      logger.error(`Error in AI button identification:`, error);
      throw error;
    }
  }

  /**
   * Click the appropriate consent button based on strategy
   */
  private async clickConsentButton(
    page: Page,
    buttons: ConsentButtons,
    strategy: string
  ): Promise<{ success: boolean; buttonClicked?: string; error?: string }> {
    try {
      // For accept-all strategy, we need to handle multi-step consent dialogs
      if (strategy === 'accept-all' && buttons.acceptAll && buttons.save) {
        // Multi-step consent: first select all, then save
        logger.debug('Multi-step consent detected: selecting all cookies first, then saving');

        // Step 1: Click "Select All" or "Accept All"
        const selectAllResult = await this.clickButton(page, buttons.acceptAll);
        if (!selectAllResult.success) {
          return { success: false, error: `Failed to select all cookies: ${selectAllResult.error}` };
        }

        logger.debug(`Successfully clicked: ${selectAllResult.buttonClicked}`);

        // Wait a moment for the selection to take effect
        await page.waitForTimeout(1000);

        // Step 2: Click "Save" to confirm the selection
        const saveResult = await this.clickButton(page, buttons.save);
        if (!saveResult.success) {
          return { success: false, error: `Failed to save cookie consent: ${saveResult.error}` };
        }

        logger.debug(`Successfully clicked: ${saveResult.buttonClicked}`);
        return {
          success: true,
          buttonClicked: `${selectAllResult.buttonClicked} + ${saveResult.buttonClicked}`
        };
      }

      let buttonToClick: { selector: string; text: string } | undefined;

      // Determine which button to click based on strategy
      switch (strategy) {
        case 'accept-all':
          buttonToClick = buttons.acceptAll || buttons.save || buttons.close;
          break;
        case 'reject-all':
          buttonToClick = buttons.rejectAll || buttons.save || buttons.close;
          break;
        case 'minimal':
          buttonToClick = buttons.settings || buttons.rejectAll || buttons.save || buttons.close;
          break;
        case 'ai-decide':
          // AI decides based on available buttons
          buttonToClick = buttons.acceptAll || buttons.rejectAll || buttons.settings || buttons.save || buttons.close;
          break;
        default:
          buttonToClick = buttons.acceptAll || buttons.save || buttons.close;
      }

      if (!buttonToClick) {
        return {
          success: false,
          error: 'No suitable button found for strategy',
        };
      }

      // Click the button with enhanced visibility handling
      logger.debug(`Clicking button: "${buttonToClick.text}" (${buttonToClick.selector})`);

      try {
        // First, try to scroll the button into view
        await page.evaluate((selector) => {
          const element = document.querySelector(selector);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, buttonToClick.selector);

        // Wait for the element to be visible and stable
        await page.waitForSelector(buttonToClick.selector, {
          state: 'visible',
          timeout: 5000
        });

        // Try to click with different strategies
        const element = await page.$(buttonToClick.selector);
        if (element) {
          // Check if element is actually clickable
          const isVisible = await element.isVisible();
          const isEnabled = await element.isEnabled();

          if (isVisible && isEnabled) {
            await element.click();
          } else {
            // Try JavaScript click as fallback
            await page.evaluate((selector) => {
              const element = document.querySelector(selector) as HTMLElement;
              if (element && element.click) {
                element.click();
              }
            }, buttonToClick.selector);
          }
        } else {
          // Fallback to page.click
          await page.click(buttonToClick.selector);
        }

        // Wait a moment for the click to register
        await page.waitForTimeout(1000);

      } catch (clickError) {
        logger.debug(`Standard click failed, trying JavaScript click:`, clickError);

        // Fallback: JavaScript click
        await page.evaluate((selector) => {
          const element = document.querySelector(selector) as HTMLElement;
          if (element && element.click) {
            element.click();
          }
        }, buttonToClick.selector);

        await page.waitForTimeout(1000);
      }

      return {
        success: true,
        buttonClicked: buttonToClick.text,
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Helper method to click a single button
   */
  private async clickButton(
    page: Page,
    button: { selector: string; text: string }
  ): Promise<{ success: boolean; buttonClicked?: string; error?: string }> {
    try {
      logger.debug(`Clicking button: "${button.text}" (${button.selector})`);

      // Wait for button to exist (may be hidden initially)
      await page.waitForSelector(button.selector, {
        state: 'attached',
        timeout: 5000
      });

      // Scroll button into view
      await page.evaluate((selector) => {
        const element = document.querySelector(selector);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, button.selector);

      // Wait a moment for scroll to complete
      await page.waitForTimeout(500);

      // Try to make button visible if it's hidden
      const isVisible = await page.isVisible(button.selector);
      if (!isVisible) {
        logger.debug('Button is hidden, trying to make it visible...');

        // Try to click on the dialog or parent element to activate it
        await page.evaluate((selector) => {
          const element = document.querySelector(selector);
          if (element) {
            // Try to trigger events that might make it visible
            element.dispatchEvent(new Event('mouseover', { bubbles: true }));
            element.dispatchEvent(new Event('focus', { bubbles: true }));

            // Try to find and click a parent element that might activate the button
            let parent = element.parentElement;
            while (parent && parent !== document.body) {
              if (parent.style.display === 'none' || parent.style.visibility === 'hidden') {
                parent.style.display = 'block';
                parent.style.visibility = 'visible';
              }
              parent = parent.parentElement;
            }
          }
        }, button.selector);

        // Wait a moment for any animations
        await page.waitForTimeout(1000);
      }

      // Check if button is now visible and enabled
      const isNowVisible = await page.isVisible(button.selector);
      const isEnabled = await page.isEnabled(button.selector);

      if (!isNowVisible) {
        logger.debug('Button is still not visible, trying JavaScript click anyway...');
      }

      if (!isEnabled) {
        logger.debug('Button is not enabled, trying JavaScript click anyway...');
      }

      // Try to click the button
      let clickSuccess = false;
      try {
        await page.click(button.selector, { timeout: 5000 });
        clickSuccess = true;
      } catch (clickError) {
        logger.debug('Regular click failed, trying JavaScript click');
        try {
          await page.evaluate((selector) => {
            const element = document.querySelector(selector) as HTMLElement;
            if (element) {
              element.click();
            }
          }, button.selector);
          clickSuccess = true;
        } catch (jsClickError) {
          logger.debug('JavaScript click also failed, trying force click');
          // Last resort: try to force click by dispatching events
          await page.evaluate((selector) => {
            const element = document.querySelector(selector) as HTMLElement;
            if (element) {
              // Try different event types
              element.dispatchEvent(new Event('click', { bubbles: true }));
              element.dispatchEvent(new Event('mousedown', { bubbles: true }));
              element.dispatchEvent(new Event('mouseup', { bubbles: true }));
            }
          }, button.selector);
          clickSuccess = true; // Assume it worked
        }
      }

      if (!clickSuccess) {
        return { success: false, error: 'All click methods failed' };
      }

      logger.debug(`Successfully clicked button: "${button.text}"`);
      return { success: true, buttonClicked: button.text };
    } catch (error) {
      logger.error(`Error clicking button "${button.text}":`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Verify that the cookie dialog has been dismissed
   */
  private async verifyDialogDismissed(page: Page): Promise<boolean> {
    try {
      // Wait a moment for any animations to complete
      await page.waitForTimeout(1000);

      // Check if any cookie dialog elements are still visible
      const dialogSelectors = [
        '[class*="cookie"][class*="dialog"]',
        '[class*="cookie"][class*="banner"]',
        '[class*="consent"][class*="dialog"]',
        '[class*="consent"][class*="banner"]',
        '.cookie-banner',
        '.consent-banner',
        '.cookie-notice',
        '.privacy-notice',
      ];

      for (const selector of dialogSelectors) {
        const elements = await page.$$(selector);
        for (const element of elements) {
          const isVisible = await element.isVisible();
          if (isVisible) {
            return false; // Dialog still visible
          }
        }
      }

      return true; // No visible dialogs found
    } catch (error) {
      logger.debug(`Error verifying dialog dismissal:`, error);
      return true; // Assume dismissed if we can't check
    }
  }

  /**
   * Detect cookie consent library used on the page
   */
  private async detectCookieConsentLibrary(page: Page): Promise<string | undefined> {
    try {
      const pageContent = await page.content();

      const libraries = [
        { name: 'Cookiebot', patterns: ['cookiebot', 'CookieConsent.renew', 'CookieConsent'] },
        { name: 'OneTrust', patterns: ['OneTrust', 'optanon', 'OptanonConsent'] },
        { name: 'CookieYes', patterns: ['cookieyes', 'cky-', 'CookieYes'] },
        { name: 'Borlabs', patterns: ['borlabs-cookie', 'BorlabsCookie'] },
        { name: 'CookieLawInfo', patterns: ['cookie-law-info', 'cliSettings'] },
        { name: 'Cookie Notice', patterns: ['cookie-notice', 'CookieNotice'] },
      ];

      for (const library of libraries) {
        if (library.patterns.some(pattern =>
          pageContent.toLowerCase().includes(pattern.toLowerCase())
        )) {
          return library.name;
        }
      }

      return undefined;
    } catch (error) {
      logger.debug(`Error detecting cookie consent library:`, error);
      return undefined;
    }
  }

  /**
   * Capture debug screenshot (only in debug mode)
   */
  private async captureDebugScreenshot(page: Page, label: string): Promise<void> {
    const isDebugMode = process.env.LOG_LEVEL === 'debug' ||
                        process.env.COOKIE_CONSENT_DEBUG_SCREENSHOTS === 'true';

    if (isDebugMode) {
      try {
        const path = `logs/cookie-consent-${label}-${Date.now()}.png`;
        await page.screenshot({ path, fullPage: false });
        logger.debug(`📸 Cookie consent screenshot saved: ${path}`);
      } catch (error) {
        logger.debug(`Failed to capture debug screenshot:`, error);
      }
    }
  }


  /**
   * Verify cookie consent success using LLM analysis
   */
  private async verifyConsentWithLLM(
    page: Page,
    url: string,
    library?: string
  ): Promise<LLMVerificationResult> {
    try {
      const domain = new URL(url).hostname;

      // First, use heuristic search to find cookie dialog elements
      const cookieDialogSelectors = [
        '[class*="cookie"]', '[id*="cookie"]', '[class*="consent"]',
        '[class*="disclaimer"]', '[role="dialog"]', '.cookie-banner',
        '.consent-banner', '.cookie-notice'
      ];

      let remainingElements: string[] = [];
      let dialogHTML = '';
      let foundDialog = false;

      // Use heuristic search to find cookie dialog
      for (const selector of cookieDialogSelectors) {
        try {
          const elements = await page.$$(selector);
          for (const element of elements) {
            const isVisible = await element.isVisible();
            if (isVisible) {
              const text = await element.textContent();
              if (text && this.containsCookieKeywords(text)) {
                remainingElements.push(`${selector}: "${text.substring(0, 100)}..."`);

                // Get the HTML of this specific dialog element
                if (!foundDialog) {
                  dialogHTML = await element.innerHTML();
                  foundDialog = true;
                }
              }
            }
          }
        } catch (error) {
          // Continue with next selector
        }
      }

      // If no dialog found, verification is successful
      if (!foundDialog && remainingElements.length === 0) {
        return {
          success: true,
          confidence: 95,
          reasoning: 'No cookie consent dialog elements detected - consent likely successful',
          detectedElements: [],
          verificationMethod: 'element-detection',
          timestamp: new Date()
        };
      }

      // Pass only the relevant cookie dialog HTML to LLM for analysis
      const prompt = `
Analyze this cookie consent dialog HTML to determine if consent was successfully handled. This is a German website (${domain}) using ${library || 'unknown'} cookie consent library.

URL: ${url}

Cookie Dialog HTML (only the dialog element, not the whole page):
${dialogHTML}

Remaining Cookie Dialog Elements Found:
${remainingElements.length > 0 ? remainingElements.join('\n') : 'None detected'}

Determine if cookie consent was successfully handled based on:
1. Dialog state indicates consent was given/accepted
2. Dialog appears to be dismissed or closed
3. No blocking elements remain
4. Dialog content shows success state

Return JSON with this exact structure:
{
  "success": true|false,
  "confidence": 0-100,
  "reasoning": "Detailed explanation of your analysis",
  "detectedElements": ["list", "of", "elements", "found"],
  "verificationMethod": "element-detection"
}

Important:
- Analyze only the cookie dialog HTML provided
- Look for success indicators in the dialog content
- Consider German cookie consent patterns
- Be conservative in your assessment
- Confidence should reflect certainty level
`;

      const llmService = getCentralizedLLMService();
      const response = await llmService.generate({
        prompt,
        systemMessage: "You are an expert at analyzing cookie consent dialogs. Focus on the dialog HTML provided and determine if consent was successfully handled.",
        format: "json" as const,
        temperature: 0.1,
        maxTokens: 1000,
        service: 'cookie-consent',
        method: 'verifyConsentWithLLM',
        context: {
          url,
          domain,
          step: 'verification'
        }
      });

      if (!response || !response.content) {
        throw new Error('No response from LLM');
      }

      const verificationData = JSON.parse(response.content);

      const verification: LLMVerificationResult = {
        success: verificationData.success || false,
        confidence: verificationData.confidence || 0,
        reasoning: verificationData.reasoning || 'No reasoning provided',
        detectedElements: verificationData.detectedElements || remainingElements,
        verificationMethod: 'element-detection',
        timestamp: new Date()
      };

      logger.debug(`LLM verification result: ${verification.success} (${verification.confidence}% confidence)`);
      return verification;

    } catch (error) {
      logger.error('LLM verification failed:', error);
      return {
        success: false,
        confidence: 0,
        reasoning: `Verification failed: ${error instanceof Error ? error.message : String(error)}`,
        detectedElements: [],
        verificationMethod: 'element-detection',
        timestamp: new Date()
      };
    }
  }

  /**
   * Handle cookie consent using LLM-based fallback when standard methods fail
   */
  private async handleWithLLMFallback(
    page: Page,
    url: string,
    library?: string
  ): Promise<{ success: boolean; buttonClicked?: string; llmPlan?: CookieConsentLLMPlan; error?: string }> {
    try {
      const domain = new URL(url).hostname;

      // Check if we have a saved plan for this domain/library combination
      const existingPlan = await this.loadCookieConsentPlan(domain, library);
      if (existingPlan) {
        logger.info(`📋 Using existing LLM plan for ${domain} (${library || 'unknown library'})`);
        const result = await this.executeLLMPlan(page, existingPlan);
        if (result.success) {
          return { success: true, buttonClicked: result.buttonClicked, llmPlan: existingPlan };
        }
      }

      // Generate new LLM plan
      logger.info(`🤖 Generating new LLM plan for ${domain} (${library || 'unknown library'})`);
      const newPlan = await this.generateLLMPlan(page, url, library);
      if (!newPlan) {
        return { success: false, error: 'Failed to generate LLM plan' };
      }

      // Execute the new plan
      const result = await this.executeLLMPlan(page, newPlan);
      if (result.success) {
        // Save the successful plan for future use
        await this.saveCookieConsentPlan(newPlan);
        return { success: true, buttonClicked: result.buttonClicked, llmPlan: newPlan };
      }

      return { success: false, error: 'LLM plan execution failed' };

    } catch (error) {
      logger.error('LLM fallback failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Generate a cookie consent plan using LLM analysis
   */
  private async generateLLMPlan(
    page: Page,
    url: string,
    library?: string
  ): Promise<CookieConsentLLMPlan | null> {
    try {
      const domain = new URL(url).hostname;

      // First, use heuristic search to find cookie dialog and buttons
      const dialogResult = await this.getCookieDialogElement(page);
      if (!dialogResult) {
        logger.warn('No cookie dialog element found for LLM plan generation');
        return null;
      }

      const dialogElement = dialogResult.element;
      const dialogSelector = dialogResult.selector;

      // Get the HTML of the specific dialog element (not the whole page)
      const dialogHTML = await dialogElement.innerHTML();

      // Use heuristic search to find buttons within the dialog
      const buttons = await this.identifyButtonsWithHeuristics(page, dialogElement);

      // Create button information for LLM
      const buttonInfo = Object.entries(buttons).map(([type, button]) =>
        `${type}: "${button?.text}" (${button?.selector})`
      ).join('\n');

      const prompt = `
Analyze this cookie consent dialog HTML and create a step-by-step plan to handle it. This is a German website (${domain}) using ${library || 'unknown'} cookie consent library.

URL: ${url}

Cookie Dialog HTML (only the dialog element, not the whole page):
${dialogHTML}

Buttons Found by Heuristic Search:
${buttonInfo}

Create a detailed plan with specific steps to:
1. Accept all cookies (preferred) or reject all cookies (fallback)
2. Handle any multi-step processes
3. Ensure the dialog is completely dismissed

Use the buttons found by heuristic search as the primary selectors, but provide fallback selectors.

Return JSON with this exact structure:
{
  "steps": [
    {
      "stepNumber": 1,
      "action": "click|wait|scroll|select",
      "selector": "CSS_SELECTOR_HERE",
      "description": "What this step does",
      "waitTime": 1000,
      "fallbackSelectors": ["alternative_selector1", "alternative_selector2"]
    }
  ],
  "strategy": "accept-all|reject-all",
  "notes": "Additional observations about this cookie dialog"
}

Important:
- Use the heuristic-found button selectors as primary selectors
- Include fallback selectors for each step
- Add appropriate wait times between steps
- Focus on German button text patterns
- Handle multi-step consent flows properly
- Ensure selectors are robust and specific
`;

      const llmService = getCentralizedLLMService();
      const response = await llmService.generate({
        prompt,
        systemMessage: "You are an expert at analyzing cookie consent dialogs and creating automated handling plans. Use the heuristic-found buttons as primary selectors and provide fallback options.",
        format: "json" as const,
        temperature: 0.1,
        maxTokens: 2000,
        service: 'cookie-consent',
        method: 'generateLLMPlan',
        context: {
          url,
          domain,
          step: 'plan-generation',
          metadata: { library }
        }
      });

      if (!response || !response.content) {
        throw new Error('No response from LLM');
      }

      const planData = JSON.parse(response.content);

      const plan: CookieConsentLLMPlan = {
        url,
        domain,
        library: library || 'unknown',
        steps: planData.steps.map((step: any, index: number) => ({
          stepNumber: step.stepNumber || index + 1,
          action: step.action || 'click',
          selector: step.selector,
          description: step.description || `Step ${index + 1}`,
          waitTime: step.waitTime || 1000,
          fallbackSelectors: step.fallbackSelectors || []
        })),
        createdAt: new Date(),
        successRate: 0
      };

      logger.info(`🤖 Generated LLM plan with ${plan.steps.length} steps for ${domain} (using heuristic-found buttons)`);
      return plan;

    } catch (error) {
      logger.error('Failed to generate LLM plan:', error);
      return null;
    }
  }

  /**
   * Execute a cookie consent plan
   */
  private async executeLLMPlan(
    page: Page,
    plan: CookieConsentLLMPlan
  ): Promise<{ success: boolean; buttonClicked?: string; error?: string }> {
    try {
      let clickedButtons: string[] = [];

      for (const step of plan.steps) {
        logger.debug(`Executing step ${step.stepNumber}: ${step.description}`);

        try {
          switch (step.action) {
            case 'click':
              const clickResult = await this.executeClickStep(page, step);
              if (clickResult.success && clickResult.buttonText) {
                clickedButtons.push(clickResult.buttonText);
              }
              break;
            case 'wait':
              await page.waitForTimeout(step.waitTime || 1000);
              break;
            case 'scroll':
              await page.evaluate((selector) => {
                const element = document.querySelector(selector);
                if (element) {
                  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
              }, step.selector);
              break;
            case 'select':
              // Handle dropdown/checkbox selection if needed
              await page.selectOption(step.selector, { value: 'all' });
              break;
          }

          // Wait after each step
          if (step.waitTime) {
            await page.waitForTimeout(step.waitTime);
          }

        } catch (stepError) {
          logger.warn(`Step ${step.stepNumber} failed:`, stepError);
          // Continue with next step
        }
      }

      // Verify dialog was dismissed
      const dismissed = await this.verifyDialogDismissed(page);
      if (!dismissed) {
        logger.warn('LLM plan executed but dialog may not be fully dismissed');
      }

      return {
        success: true,
        buttonClicked: clickedButtons.join(' + ')
      };

    } catch (error) {
      logger.error('LLM plan execution failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Execute a click step with fallback selectors
   */
  private async executeClickStep(
    page: Page,
    step: CookieConsentStep
  ): Promise<{ success: boolean; buttonText?: string; error?: string }> {
    const selectors = [step.selector, ...(step.fallbackSelectors || [])];

    for (const selector of selectors) {
      try {
        // Wait for element to exist
        await page.waitForSelector(selector, {
          state: 'attached',
          timeout: 3000
        });

        // Scroll into view
        await page.evaluate((sel) => {
          const element = document.querySelector(sel);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, selector);

        // Wait for visibility
        await page.waitForTimeout(500);

        // Try to click
        const element = await page.$(selector);
        if (element) {
          const isVisible = await element.isVisible();
          const isEnabled = await element.isEnabled();

          if (isVisible && isEnabled) {
            await element.click();
          } else {
            // JavaScript click fallback
            await page.evaluate((sel) => {
              const element = document.querySelector(sel) as HTMLElement;
              if (element) {
                element.click();
              }
            }, selector);
          }

          // Get button text for logging
          const buttonText = await element.textContent() || selector;

          logger.debug(`Successfully clicked: ${buttonText}`);
          return { success: true, buttonText };
        }

      } catch (error) {
        logger.debug(`Selector ${selector} failed:`, error);
        continue; // Try next selector
      }
    }

    return { success: false, error: 'All selectors failed' };
  }

  /**
   * Save a cookie consent plan to disk
   */
  private async saveCookieConsentPlan(plan: CookieConsentLLMPlan, verificationResult?: LLMVerificationResult): Promise<void> {
    try {
      const plansDir = path.join(process.cwd(), 'plans', 'cookie-consent');
      await fs.mkdir(plansDir, { recursive: true });

      // Check if plan already exists and update it
      const existingPlan = await this.loadCookieConsentPlan(plan.domain, plan.library);
      if (existingPlan) {
        // Update existing plan with verification results and usage stats
        existingPlan.lastUsed = new Date();
        existingPlan.usageCount = (existingPlan.usageCount || 0) + 1;

        if (verificationResult) {
          if (!existingPlan.verificationResults) {
            existingPlan.verificationResults = [];
          }
          existingPlan.verificationResults.push(verificationResult);

          // Calculate success rate based on verification results
          const successfulVerifications = existingPlan.verificationResults.filter(v => v.success).length;
          existingPlan.successRate = Math.round((successfulVerifications / existingPlan.verificationResults.length) * 100);
        }

        // Save updated plan
        const createdAtTime = existingPlan.createdAt instanceof Date ? existingPlan.createdAt.getTime() : new Date(existingPlan.createdAt).getTime();
        const filename = `cookie-consent-plan-${existingPlan.domain}-${existingPlan.library}-${createdAtTime}.json`;
        const filepath = path.join(plansDir, filename);
        await fs.writeFile(filepath, JSON.stringify(existingPlan, null, 2));
        logger.info(`💾 Updated cookie consent plan: ${filename} (usage: ${existingPlan.usageCount}, success rate: ${existingPlan.successRate}%)`);
      } else {
        // Create new plan
        plan.lastUsed = new Date();
        plan.usageCount = 1;

        if (verificationResult) {
          plan.verificationResults = [verificationResult];
          plan.successRate = verificationResult.success ? 100 : 0;
        }

        const filename = `cookie-consent-plan-${plan.domain}-${plan.library}-${Date.now()}.json`;
        const filepath = path.join(plansDir, filename);
        await fs.writeFile(filepath, JSON.stringify(plan, null, 2));
        logger.info(`💾 Saved new cookie consent plan: ${filename}`);
      }
    } catch (error) {
      logger.error('Failed to save cookie consent plan:', error);
    }
  }

  /**
   * Load a cookie consent plan from disk
   */
  private async loadCookieConsentPlan(
    domain: string,
    library?: string
  ): Promise<CookieConsentLLMPlan | null> {
    try {
      const plansDir = path.join(process.cwd(), 'plans', 'cookie-consent');

      try {
        const files = await fs.readdir(plansDir);
        const cookieConsentFiles = files.filter(file =>
          file.startsWith('cookie-consent-plan-') &&
          file.includes(domain) &&
          (!library || file.includes(library))
        );

        if (cookieConsentFiles.length === 0) {
          return null;
        }

        // Get the most recent plan
        const latestFile = cookieConsentFiles.sort().pop();
        if (!latestFile) {
          return null;
        }

        const filepath = path.join(plansDir, latestFile);
        const content = await fs.readFile(filepath, 'utf-8');
        const planData = JSON.parse(content);

        // Convert date strings back to Date objects
        const plan: CookieConsentLLMPlan = {
          ...planData,
          createdAt: new Date(planData.createdAt),
          lastUsed: planData.lastUsed ? new Date(planData.lastUsed) : undefined,
          verificationResults: planData.verificationResults?.map((vr: any) => ({
            ...vr,
            timestamp: new Date(vr.timestamp)
          })) || []
        };

        logger.debug(`📋 Loaded cookie consent plan for ${domain} from ${latestFile}`);
        return plan;

      } catch (dirError) {
        // Directory doesn't exist yet
        return null;
      }

    } catch (error) {
      logger.error('Failed to load cookie consent plan:', error);
      return null;
    }
  }
}
