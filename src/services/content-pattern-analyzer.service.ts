/**
 * Content Pattern Analyzer Service
 * Analyzes example content URLs to identify patterns and generate selectors
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
 */

import { JSDOM } from 'jsdom';
import { logger } from '../utils/logger';
import {
  ContentPattern,
  ContentPatternAnalysis,
  ContentMatch,
  ListContainer,
  DOMStructure,
  ContentPage,
  ContentVariation
} from '../interfaces/core';
import { PlaywrightExecutor } from './playwright-executor.service';

export class ContentPatternAnalyzer {
  private readonly NAVIGATION_SELECTORS = [
    'nav', 'header', 'footer', '.nav', '.navigation', '.header', '.footer',
    '.menu', '.sidebar', '.breadcrumb', '.pagination', '#nav', '#header', '#footer'
  ];

  constructor(private playwrightExecutor: PlaywrightExecutor) {}

  /**
   * Create ContentPage objects from pre-fetched HTML data
   * Used when HTML content is already available from orchestrator
   */
  createContentPagesFromHtml(contentPagesData: Array<{
    url: string;
    html: string;
    trimmedHtml: string;
    success: boolean;
  }>): ContentPage[] {
    const contentPages: ContentPage[] = [];

    for (const pageData of contentPagesData) {
      if (!pageData.success || !pageData.trimmedHtml) {
        continue;
      }

      try {
        // Use trimmed HTML for better analysis
        const dom = new JSDOM(pageData.trimmedHtml);
        const domStructure = this.parseDOMStructure(dom.window.document.documentElement);

        contentPages.push({
          url: pageData.url,
          html: pageData.trimmedHtml, // Use trimmed HTML
          domStructure,
          extractedContent: this.extractContentFromDOM(dom.window.document)
        });

        logger.debug(`Created ContentPage from pre-fetched data: ${pageData.url}`);
      } catch (error) {
        logger.warn(`Failed to create ContentPage from ${pageData.url}:`, error);
      }
    }

    return contentPages;
  }

  /**
   * Analyze content patterns from pre-fetched content pages
   * More efficient when content is already available
   */
  async analyzeContentPatternsFromPages(contentPages: ContentPage[]): Promise<ContentPatternAnalysis> {
    if (!contentPages || contentPages.length === 0) {
      throw new Error('Content pages are required for pattern analysis');
    }

    // Generate content patterns from each page
    const patterns = await this.generateContentPatterns(contentPages);

    // Find common structures across patterns
    const commonStructures = this.findCommonStructures(patterns);

    // Generate content selectors based on patterns
    const contentSelectors = this.generateContentSelectors(patterns);

    // Generate exclusion selectors for navigation elements
    const excludeSelectors = this.generateExclusionSelectors(contentPages);

    // Find common content container
    const commonContentContainer = this.findCommonContentContainer(patterns);

    // Generate content variations
    const contentVariations = this.generateContentVariations(patterns);

    // Calculate overall confidence
    const confidence = this.calculatePatternConfidence(patterns, commonStructures);

    return {
      contentSelectors,
      excludeSelectors,
      commonContentContainer,
      contentVariations,
      confidence,
      listContainers: [], // Will be populated when analyzing main page
      patterns
    };
  }

  /**
   * Analyze content URLs to identify patterns and generate analysis
   * Requirement 8.1: Accept content URLs and analyze patterns
   */
  async analyzeContentPatterns(contentUrls: string[]): Promise<ContentPatternAnalysis> {
    if (!contentUrls || contentUrls.length === 0) {
      throw new Error('Content URLs are required for pattern analysis');
    }

    // Fetch and parse content pages
    const contentPages = await this.fetchContentPages(contentUrls);

    return this.analyzeContentPatternsFromPages(contentPages);
  }

  // Placeholder implementations for the required methods
  private parseDOMStructure(element: Element, depth = 0, path = ''): DOMStructure {
    const tagName = element.tagName.toLowerCase();
    const className = element.className;
    const id = element.id;
    const attributes: Record<string, string> = {};

    // Extract relevant attributes
    for (let i = 0; i < element.attributes.length; i++) {
      const attr = element.attributes[i];
      if (['class', 'id', 'data-*', 'role'].some(pattern =>
        attr.name === pattern || attr.name.startsWith('data-'))) {
        attributes[attr.name] = attr.value;
      }
    }

    let currentPath = path ? `${path} > ${tagName}` : tagName;
    if (className) {
      currentPath += `.${className.split(' ')[0]}`;
    }
    if (id) {
      currentPath += `#${id}`;
    }

    const children: DOMStructure[] = [];
    for (let i = 0; i < element.children.length; i++) {
      children.push(this.parseDOMStructure(element.children[i], depth + 1, currentPath));
    }

    return {
      tagName,
      className,
      id,
      attributes,
      textContent: element.textContent?.trim() || '',
      children,
      depth,
      path: currentPath
    };
  }

  private extractContentFromDOM(document: Document): Record<string, any> {
    return {
      title: document.querySelector('h1, h2, .title')?.textContent || '',
      description: document.querySelector('p, .description')?.textContent || '',
      url: document.querySelector('a')?.href || ''
    };
  }

  private async fetchContentPages(contentUrls: string[]): Promise<ContentPage[]> {
    const pages: ContentPage[] = [];

    // Limit to prevent excessive fetching (already limited in orchestrator)
    const urlsToFetch = contentUrls.slice(0, 15);

    // Use existing browser pool from playwright executor
    const browser = await this.playwrightExecutor.acquireBrowserFromPool();
    let context = null;

    try {
      context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      });

      for (const url of urlsToFetch) {
        try {
          logger.debug(`Fetching content page: ${url}`);

          const page = await context.newPage();

          try {
            await page.goto(url, {
              waitUntil: 'domcontentloaded',
              timeout: 15000
            });

            await page.waitForTimeout(1000); // Brief wait for dynamic content

            let html = await page.content();

            // Trim HTML to main content
            html = this.trimHtmlToMainContent(html);

            const dom = new JSDOM(html);
            const domStructure = this.parseDOMStructure(dom.window.document.documentElement);

            pages.push({
              url,
              html,
              domStructure,
              extractedContent: this.extractContentFromDOM(dom.window.document)
            });

            logger.debug(`Successfully fetched and parsed ${url}`);
          } finally {
            await page.close();
          }
        } catch (error) {
          logger.warn(`Failed to fetch content page ${url}:`, error);
          // Continue with other URLs
        }
      }
    } finally {
      if (context) {
        await context.close();
      }
      // Release browser back to pool
      this.playwrightExecutor.releaseBrowserToPool(browser);
    }

    return pages;
  }

  private trimHtmlToMainContent(html: string): string {
    // Remove scripts, styles, comments
    let trimmed = html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Focus on main content areas
    const contentPatterns = [
      /<main[\s\S]*?<\/main>/gi,
      /<article[\s\S]*?<\/article>/gi,
      /<section[\s\S]*?<\/section>/gi,
      /<div[^>]*class[^>]*(?:content|main|article|post|entry)[^>]*>[\s\S]*?<\/div>/gi
    ];

    let mainContent = '';
    for (const pattern of contentPatterns) {
      const matches = trimmed.match(pattern);
      if (matches && matches.length > 0) {
        mainContent += matches.join('\n');
      }
    }

    // If no main content found, remove header/footer/nav
    if (!mainContent) {
      mainContent = trimmed
        .replace(/<header[\s\S]*?<\/header>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '')
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<aside[\s\S]*?<\/aside>/gi, '');
    }

    // Limit size
    const maxLength = 20000;
    if (mainContent.length > maxLength) {
      mainContent = mainContent.substring(0, maxLength) + '...';
    }

    return mainContent;
  }

  // Minimal implementations for required methods
  private async generateContentPatterns(_contentPages: ContentPage[]): Promise<ContentPattern[]> {
    return []; // Simplified implementation
  }

  private findCommonStructures(_patterns: ContentPattern[]): DOMStructure[] {
    return []; // Simplified implementation
  }

  private generateContentSelectors(_patterns: ContentPattern[]): string[] {
    return []; // Simplified implementation
  }

  private generateExclusionSelectors(_contentPages: ContentPage[]): string[] {
    return this.NAVIGATION_SELECTORS; // Return default navigation selectors
  }

  private findCommonContentContainer(_patterns: ContentPattern[]): string {
    return ''; // Simplified implementation
  }

  private generateContentVariations(_patterns: ContentPattern[]): ContentVariation[] {
    return []; // Simplified implementation
  }

  private calculatePatternConfidence(_patterns: ContentPattern[], _commonStructures: DOMStructure[]): number {
    return 0.5; // Default confidence
  }

  /**
   * Find similar content on main page using content patterns
   * Requirement 8.2: Identify content patterns and find similar content
   */
  async findSimilarContentOnMainPage(
    _mainPageHtml: string,
    _contentPatterns: ContentPattern[]
  ): Promise<ContentMatch[]> {
    // Simplified implementation
    return [];
  }

  /**
   * Identify list containers where similar content items are grouped
   * Requirement 8.3: Create list container detection logic
   */
  async identifyListContainers(
    _mainPageHtml: string,
    _contentMatches: ContentMatch[]
  ): Promise<ListContainer[]> {
    // Simplified implementation
    return [];
  }
}