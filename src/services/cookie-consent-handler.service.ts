/**
 * Cookie Consent Handler Service
 * Automatically detects and handles cookie consent dialogs across websites
 * Requirements: Cookie consent handling for German municipal websites and other sources
 */

import { Page, ElementHandle } from 'playwright';
import { logger } from '../utils/logger';
import { LLMPlannerService } from './llm-planner.service';

export interface CookieConsentConfig {
  strategy: 'accept-all' | 'reject-all' | 'minimal' | 'ai-decide';
  languages: string[]; // ['de', 'en', 'fr']
  timeout: number; // 5000ms
  retryAttempts: number; // 3
  fallbackStrategy: 'skip' | 'fail' | 'continue';
  useAI: boolean; // Use AI for button identification
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
  method: 'heuristic' | 'ai' | 'none';
  buttonClicked?: string;
  error?: string;
  duration: number;
  library?: string;
  // NEW: Cookie consent metadata
  metadata: {
    detected: boolean;
    strategy: 'accept-all' | 'reject-all' | 'minimal' | 'none-detected';
    library?: string;
    buttonSelectors?: {
      accept?: string;
      reject?: string;
      save?: string;
      close?: string;
    };
    handledAt?: Date;
  };
}

export class CookieConsentHandler {
  private llmPlanner: LLMPlannerService;
  private config: CookieConsentConfig;

  constructor(config?: Partial<CookieConsentConfig>) {
    this.llmPlanner = new LLMPlannerService();
    this.config = {
      strategy: (process.env.COOKIE_CONSENT_STRATEGY as any) || 'accept-all',
      languages: (process.env.COOKIE_CONSENT_LANGUAGES || 'de,en').split(','),
      timeout: parseInt(process.env.COOKIE_CONSENT_TIMEOUT || '5000'),
      retryAttempts: 3,
      fallbackStrategy: 'continue',
      useAI: process.env.COOKIE_CONSENT_USE_AI === 'true',
      ...config,
    };
  }

  /**
   * Main entry point for handling cookie consent
   */
  async handleCookieConsent(page: Page, url: string, config?: Partial<CookieConsentConfig>): Promise<ConsentHandlingResult> {
    const startTime = Date.now();
    const finalConfig = { ...this.config, ...config };

    try {
      logger.debug(`🍪 Checking for cookie consent dialog on ${url}`);

      // Detect if there's a cookie dialog
      const hasDialog = await this.detectCookieDialog(page);
      if (!hasDialog) {
        logger.debug(`No cookie consent dialog detected on ${url}`);
        return {
          success: true,
          method: 'none',
          duration: Date.now() - startTime,
          metadata: {
            detected: false,
            strategy: 'none-detected',
            handledAt: new Date()
          }
        };
      }

      logger.info(`🍪 Detected cookie consent dialog on ${url}`);

      // Capture debug screenshot of detected dialog
      await this.captureDebugScreenshot(page, 'dialog-detected');

      // Get the dialog element
      const dialogElement = await this.getCookieDialogElement(page);
      if (!dialogElement) {
        logger.warn(`Cookie dialog detected but no dialog element found on ${url}`);
        return {
          success: false,
          method: 'none',
          error: 'Dialog element not found',
          duration: Date.now() - startTime,
          metadata: {
            detected: true,
            strategy: 'none-detected',
            handledAt: new Date()
          }
        };
      }

      // Detect cookie consent library
      const library = await this.detectCookieConsentLibrary(page);
      if (library) {
        logger.debug(`Detected cookie consent library: ${library}`);
      }

      // Identify consent buttons
      let buttons: ConsentButtons = {};

      if (finalConfig.useAI) {
        try {
          buttons = await this.identifyButtonsWithAI(page, dialogElement);
          logger.debug(`AI identified ${Object.keys(buttons).length} consent buttons`);
        } catch (error) {
          logger.warn(`AI button identification failed, falling back to heuristics:`, error);
          buttons = await this.identifyButtonsWithHeuristics(page, dialogElement);
        }
      } else {
        buttons = await this.identifyButtonsWithHeuristics(page, dialogElement);
      }

      // Click the appropriate button based on strategy
      const clickResult = await this.clickConsentButton(page, buttons, finalConfig.strategy);
      if (!clickResult.success) {
        return {
          success: false,
          method: finalConfig.useAI ? 'ai' : 'heuristic',
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
            handledAt: new Date()
          }
        };
      }

      // Verify dialog was dismissed
      const dismissed = await this.verifyDialogDismissed(page);
      if (!dismissed) {
        logger.warn(`Cookie consent button clicked but dialog may not have been dismissed on ${url}`);
      }

      // Capture debug screenshot after handling
      await this.captureDebugScreenshot(page, 'after-handling');

      logger.info(`✅ Successfully handled cookie consent on ${url}`, {
        method: finalConfig.useAI ? 'ai' : 'heuristic',
        buttonClicked: clickResult.buttonClicked,
        library,
        duration: `${Date.now() - startTime}ms`,
      });

      return {
        success: true,
        method: finalConfig.useAI ? 'ai' : 'heuristic',
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
          handledAt: new Date()
        }
      };

    } catch (error) {
      logger.error(`❌ Error handling cookie consent on ${url}:`, error);
      return {
        success: false,
        method: 'none',
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
  private async getCookieDialogElement(page: Page): Promise<ElementHandle | null> {
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
            if (isVisible) {
              // Additional check: ensure it's likely a dialog
              const boundingBox = await element.boundingBox();
              if (boundingBox && await this.isLikelyCookieDialog(element, boundingBox)) {
                logger.debug(`Found cookie dialog element with selector: ${selector}`);
                return element;
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
                return element;
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

      for (const button of allButtons) {
        try {
          const buttonText = await button.textContent();
          const buttonClass = await button.getAttribute('class') || '';
          const buttonId = await button.getAttribute('id') || '';

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

      const className = await button.getAttribute('class');
      if (className) {
        const classes = className.split(' ').filter(c => c.trim());
        if (classes.length > 0) {
          // Use the most specific class (longest one)
          const mostSpecificClass = classes.reduce((longest, current) =>
            current.length > longest.length ? current : longest
          );
          return `.${mostSpecificClass}`;
        }
      }

      // Try to get a more specific selector using text content
      const text = await button.textContent();
      if (text && text.trim()) {
        const tagName = await button.evaluate((el: Element) => el.tagName.toLowerCase());
        return `${tagName}:has-text("${text.trim()}")`;
      }

      // Fallback to tag name
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

      // Use the LLM planner's OpenAI client
      const response = await this.llmPlanner.callOpenAI(prompt, {
        model: 'codeLlama:7b-code-q4_K_M',
        maxTokens: 1000,
        temperature: 0.1,
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
}
