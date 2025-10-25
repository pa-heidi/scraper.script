import { JSDOM } from 'jsdom';
import { logger } from '../utils/logger';
import { createOllamaService, OllamaService } from './ollamaService';
import { OpenAI } from 'openai';
import { LlamaIndexIntegrationService, LlamaIndexConfig } from './llamaindex-integration.service';
import { chromium, Browser, Page } from 'playwright';

export interface CompressionOptions {
  removeComments?: boolean;
  removeWhitespace?: boolean;
  removeEmptyElements?: boolean;
  removeScripts?: boolean;
  removeStyles?: boolean;
  removeNonContentElements?: boolean;
  maxTokens?: number;
  preserveStructure?: boolean;
  enableAdvancedCompression?: boolean;
  usePlaywright?: boolean;
  llamaindexEnabled?: boolean;
}

export interface CompressionResult {
  compressedHtml: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  tokensEstimate: number;
  elementsRemoved: number;
}

export interface ChunkAnalysisResult {
  chunkId: string;
  content: string;
  relevanceScore: number;
  contentType: 'main-content' | 'navigation' | 'advertisement' | 'footer' | 'header' | 'sidebar' | 'unknown';
  shouldKeep: boolean;
  reasoning: string;
  extractedSelectors: string[];
}

export interface ProgressiveCompressionResult {
  compressedHtml: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  tokensEstimate: number;
  chunksAnalyzed: number;
  chunksRemoved: number;
  analysisResults: ChunkAnalysisResult[];
  processingTime: number;
  llamaindexSummary?: string;
  compressionInsights?: any;
}

export interface ChunkingStrategy {
  maxChunkSize: number;
  overlapSize: number;
  strategy: 'semantic' | 'structural' | 'hybrid';
  preserveBoundaries: boolean;
}

export interface StructuralAnalysis {
  mainContent: string;
  navigation: string[];
  advertisements: string[];
  footers: string[];
  headers: string[];
  sidebars: string[];
  structuralElements: Map<string, string[]>;
}

export class HtmlCompressorService {
  private readonly defaultOptions: CompressionOptions = {
    removeComments: true,
    removeWhitespace: false,
    removeEmptyElements: false,
    removeScripts: true,
    removeStyles: true,
    removeNonContentElements: false,
    maxTokens: 15000,
    preserveStructure: true,
    enableAdvancedCompression: process.env.ENABLE_ADVANCED_COMPRESSION !== 'false',
    usePlaywright: process.env.USE_PLAYWRIGHT !== 'false',
    llamaindexEnabled: process.env.LLAMAINDEX_ENABLED !== 'false'
  };

  private readonly defaultChunkingStrategy: ChunkingStrategy = {
    maxChunkSize: parseInt(process.env.MAX_CHUNK_SIZE || '2000'),
    overlapSize: parseInt(process.env.CHUNK_OVERLAP || '200'),
    strategy: (process.env.COMPRESSION_STRATEGY as any) || 'hybrid',
    preserveBoundaries: true
  };

  private ollamaService: OllamaService;
  private openai?: OpenAI;
  private browser?: Browser;
  private llamaIndexService: LlamaIndexIntegrationService;

  constructor() {
    this.ollamaService = createOllamaService({
      model: process.env.OLLAMA_REASONING_MODEL || 'llama3.2:3b',
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      timeout: 300000
    });

    // Initialize OpenAI if API key is available
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    }

    this.llamaIndexService = new LlamaIndexIntegrationService({
      enabled: this.defaultOptions.llamaindexEnabled === true
    });
  }

  /**
   * Main compression method - maintains backward compatibility
   */
  async compressHtml(html: string, options: Partial<CompressionOptions> = {}): Promise<CompressionResult> {
    const opts = { ...this.defaultOptions, ...options };

    // Use advanced compression if enabled and Ollama is available
    if (opts.enableAdvancedCompression === true && await this.isOllamaAvailable()) {
      try {
        logger.info('Using advanced compression with chunked reasoning');
        const advancedResult = await this.compressWithChunkedReasoning(html, this.defaultChunkingStrategy);

        return {
          compressedHtml: advancedResult.compressedHtml,
          originalSize: advancedResult.originalSize,
          compressedSize: advancedResult.compressedSize,
          compressionRatio: advancedResult.compressionRatio,
          tokensEstimate: advancedResult.tokensEstimate,
          elementsRemoved: advancedResult.chunksRemoved
        };
      } catch (error) {
        logger.warn('Advanced compression failed, falling back to basic compression', { error });
      }
    }

    // Fallback to basic compression
    return this.basicCompression(html, opts);
  }

  /**
   * Advanced compression using chunked reasoning with Llama
   */
  async compressWithChunkedReasoning(
    html: string,
    options: Partial<ChunkingStrategy> = {}
  ): Promise<ProgressiveCompressionResult> {
    const startTime = Date.now();
    const strategy = { ...this.defaultChunkingStrategy, ...options };

    try {
      logger.info('Starting advanced HTML compression with chunked reasoning', {
        strategy: strategy.strategy,
        maxChunkSize: strategy.maxChunkSize,
        overlapSize: strategy.overlapSize
      });

      // Step 1: Structural extraction with Playwright
      const structuralAnalysis = await this.performStructuralExtraction(html);

      // Step 2: Chunk the HTML content
      const chunks = await this.chunkHtmlContent(html, strategy, structuralAnalysis);

      // Step 3: Progressive analysis with Llama
      const analysisResults = await this.performProgressiveAnalysis(chunks);

      // Step 4: Merge and refine results
      const compressedHtml = await this.mergeAndRefineResults(analysisResults, structuralAnalysis);

      // Step 5: Initialize LlamaIndex if enabled
      let llamaindexSummary: string | undefined;
      let compressionInsights: any;

      if (this.defaultOptions.llamaindexEnabled) {
        try {
          await this.llamaIndexService.initializeIndex(compressedHtml, {
            type: 'compressed-html',
            timestamp: new Date().toISOString(),
            originalSize: html.length,
            compressedSize: compressedHtml.length,
            compressionRatio: (html.length - compressedHtml.length) / html.length,
            chunksAnalyzed: chunks.length
          });

          llamaindexSummary = await this.llamaIndexService.getDocumentSummary();
          compressionInsights = await this.llamaIndexService.getCompressionInsights();
        } catch (error) {
          logger.warn('LlamaIndex integration failed', { error });
        }
      }

      const processingTime = Date.now() - startTime;
      const chunksRemoved = analysisResults.filter(r => !r.shouldKeep).length;

      const result: ProgressiveCompressionResult = {
        compressedHtml,
        originalSize: html.length,
        compressedSize: compressedHtml.length,
        compressionRatio: (html.length - compressedHtml.length) / html.length,
        tokensEstimate: this.estimateTokens(compressedHtml),
        chunksAnalyzed: chunks.length,
        chunksRemoved,
        analysisResults,
        processingTime,
        llamaindexSummary,
        compressionInsights
      };

      logger.info('Advanced HTML compression completed', {
        originalSize: result.originalSize,
        compressedSize: result.compressedSize,
        compressionRatio: Math.round(result.compressionRatio * 100),
        chunksAnalyzed: result.chunksAnalyzed,
        chunksRemoved: result.chunksRemoved,
        processingTime: result.processingTime
      });

      return result;

    } catch (error) {
      logger.error('Advanced HTML compression failed', { error });
      throw new Error(`Advanced HTML compression failed: ${error}`);
    }
  }

  /**
   * Step 1: Structural extraction using Playwright with JSDOM fallback
   */
  private async performStructuralExtraction(html: string): Promise<StructuralAnalysis> {
    const structuralElements = new Map<string, string[]>();

    // Initialize with empty arrays
    const categories = ['mainContent', 'navigation', 'advertisements', 'footers', 'headers', 'sidebars'];
    categories.forEach(cat => structuralElements.set(cat, []));

    try {
      if (this.defaultOptions.usePlaywright && await this.isPlaywrightAvailable()) {
        logger.debug('Using Playwright for structural extraction');
        return await this.extractWithPlaywright(html, structuralElements);
      } else {
        logger.debug('Using JSDOM for structural extraction');
        return await this.extractWithJSDOM(html, structuralElements);
      }
    } catch (error) {
      logger.warn('Structural extraction failed, using JSDOM fallback', { error });
      return await this.extractWithJSDOM(html, structuralElements);
    }
  }

  /**
   * Extract structural elements using Playwright
   */
  private async extractWithPlaywright(html: string, structuralElements: Map<string, string[]>): Promise<StructuralAnalysis> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
    }

    const page = await this.browser.newPage();

    try {
      await page.setContent(html);

      const selectors = {
        mainContent: ['main', 'article', '.content', '.main-content', '[role="main"]'],
        navigation: ['nav', '.navigation', '.nav', '.menu', '[role="navigation"]'],
        advertisements: ['.ad', '.advertisement', '.ads', '.banner', '[class*="ad-"]'],
        footers: ['footer', '.footer', '[role="contentinfo"]'],
        headers: ['header', '.header', '[role="banner"]'],
        sidebars: ['aside', '.sidebar', '.side', '[role="complementary"]']
      };

      for (const [category, selectorList] of Object.entries(selectors)) {
        const elements: string[] = [];
        for (const selector of selectorList) {
          const found = await page.$$eval(selector, els =>
            els.map(el => el.outerHTML)
          );
          elements.push(...found);
        }
        structuralElements.set(category, elements);
      }

      return {
        mainContent: structuralElements.get('mainContent')?.join('') || '',
        navigation: structuralElements.get('navigation') || [],
        advertisements: structuralElements.get('advertisements') || [],
        footers: structuralElements.get('footers') || [],
        headers: structuralElements.get('headers') || [],
        sidebars: structuralElements.get('sidebars') || [],
        structuralElements
      };

    } finally {
      await page.close();
    }
  }

  /**
   * Extract structural elements using JSDOM
   */
  private async extractWithJSDOM(html: string, structuralElements: Map<string, string[]>): Promise<StructuralAnalysis> {
    const dom = new JSDOM(html);
    const document = dom.window.document;

    const selectors = {
      mainContent: ['main', 'article', '.content', '.main-content', '[role="main"]'],
      navigation: ['nav', '.navigation', '.nav', '.menu', '[role="navigation"]'],
      advertisements: ['.ad', '.advertisement', '.ads', '.banner', '[class*="ad-"]'],
      footers: ['footer', '.footer', '[role="contentinfo"]'],
      headers: ['header', '.header', '[role="banner"]'],
      sidebars: ['aside', '.sidebar', '.side', '[role="complementary"]']
    };

    for (const [category, selectorList] of Object.entries(selectors)) {
      const elements: string[] = [];
      for (const selector of selectorList) {
        const found = document.querySelectorAll(selector);
        found.forEach(el => elements.push(el.outerHTML));
      }
      structuralElements.set(category, elements);
    }

    return {
      mainContent: structuralElements.get('mainContent')?.join('') || '',
      navigation: structuralElements.get('navigation') || [],
      advertisements: structuralElements.get('advertisements') || [],
      footers: structuralElements.get('footers') || [],
      headers: structuralElements.get('headers') || [],
      sidebars: structuralElements.get('sidebars') || [],
      structuralElements
    };
  }

  /**
   * Step 2: Chunk HTML content using specified strategy
   */
  private async chunkHtmlContent(
    html: string,
    strategy: ChunkingStrategy,
    structuralAnalysis: StructuralAnalysis
  ): Promise<Array<{ id: string; content: string; context: any }>> {
    const chunks: Array<{ id: string; content: string; context: any }> = [];

    if (strategy.strategy === 'semantic') {
      return this.chunkBySemanticBoundaries(html, strategy);
    } else if (strategy.strategy === 'structural') {
      return this.chunkByStructuralBoundaries(html, strategy, structuralAnalysis);
    } else {
      // Hybrid approach
      return this.chunkByHybridApproach(html, strategy, structuralAnalysis);
    }
  }

  /**
   * Chunk by semantic boundaries (HTML elements)
   */
  private chunkBySemanticBoundaries(html: string, strategy: ChunkingStrategy): Array<{ id: string; content: string; context: any }> {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const chunks: Array<{ id: string; content: string; context: any }> = [];

    // Extract meaningful elements
    const elements = document.querySelectorAll('div, section, article, main, aside, nav, header, footer, ul, ol, table');

    let currentChunk = '';
    let chunkIndex = 0;

    for (const element of elements) {
      const elementHtml = element.outerHTML;

      if (currentChunk.length + elementHtml.length > strategy.maxChunkSize && currentChunk.length > 0) {
        chunks.push({
          id: `chunk-${chunkIndex++}`,
          content: currentChunk,
          context: { type: 'semantic', elementCount: 1 }
        });
        currentChunk = elementHtml;
      } else {
        currentChunk += elementHtml;
      }
    }

    if (currentChunk.length > 0) {
      chunks.push({
        id: `chunk-${chunkIndex}`,
        content: currentChunk,
        context: { type: 'semantic', elementCount: 1 }
      });
    }

    return chunks;
  }

  /**
   * Chunk by structural boundaries
   */
  private chunkByStructuralBoundaries(
    html: string,
    strategy: ChunkingStrategy,
    structuralAnalysis: StructuralAnalysis
  ): Array<{ id: string; content: string; context: any }> {
    const chunks: Array<{ id: string; content: string; context: any }> = [];
    let chunkIndex = 0;

    // Create chunks based on structural elements
    for (const [category, elements] of structuralAnalysis.structuralElements) {
      for (const element of elements) {
        chunks.push({
          id: `chunk-${chunkIndex++}`,
          content: element,
          context: {
            type: 'structural',
            category,
            isMainContent: category === 'mainContent'
          }
        });
      }
    }

    return chunks;
  }

  /**
   * Hybrid chunking approach
   */
  private chunkByHybridApproach(
    html: string,
    strategy: ChunkingStrategy,
    structuralAnalysis: StructuralAnalysis
  ): Array<{ id: string; content: string; context: any }> {
    // Combine semantic and structural approaches
    const semanticChunks = this.chunkBySemanticBoundaries(html, strategy);
    const structuralChunks = this.chunkByStructuralBoundaries(html, strategy, structuralAnalysis);

    // Merge and deduplicate
    const allChunks = [...semanticChunks, ...structuralChunks];
    const uniqueChunks = this.deduplicateChunks(allChunks);

    return uniqueChunks;
  }

  /**
   * Step 3: Progressive analysis with Llama
   */
  private async performProgressiveAnalysis(
    chunks: Array<{ id: string; content: string; context: any }>
  ): Promise<ChunkAnalysisResult[]> {
    const results: ChunkAnalysisResult[] = [];
    let accumulatedContext = '';

    logger.info(`Starting progressive analysis of ${chunks.length} chunks`);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // Build progressive context
      const contextWindow = this.buildProgressiveContext(
        accumulatedContext,
        chunk,
        chunks.slice(Math.max(0, i - 2), i) // Previous 2 chunks for context
      );

      // Analyze chunk with Llama
      const analysis = await this.analyzeChunkWithLlama(chunk, contextWindow);
      results.push(analysis);

      // Update accumulated context
      if (analysis.shouldKeep) {
        accumulatedContext += `\n\n--- Chunk ${chunk.id} ---\n${chunk.content.substring(0, 500)}`;
      }

      // Limit context size to prevent token overflow
      if (accumulatedContext.length > 4000) {
        accumulatedContext = accumulatedContext.substring(accumulatedContext.length - 4000);
      }
    }

    logger.info('Progressive analysis completed', {
      chunksAnalyzed: results.length,
      chunksKept: results.filter(r => r.shouldKeep).length,
      chunksRemoved: results.filter(r => !r.shouldKeep).length
    });

    return results;
  }

  /**
   * Build progressive context for chunk analysis
   */
  private buildProgressiveContext(
    accumulatedContext: string,
    currentChunk: { id: string; content: string; context: any },
    previousChunks: Array<{ id: string; content: string; context: any }>
  ): string {
    let context = 'HTML CONTENT ANALYSIS CONTEXT:\n\n';

    if (accumulatedContext) {
      context += `PREVIOUS ANALYSIS SUMMARY:\n${accumulatedContext}\n\n`;
    }

    if (previousChunks.length > 0) {
      context += `RECENT CHUNKS:\n`;
      previousChunks.forEach(chunk => {
        context += `- ${chunk.id}: ${chunk.context.category || 'unknown'} (${chunk.content.length} chars)\n`;
      });
      context += '\n';
    }

    context += `CURRENT CHUNK TO ANALYZE:\n`;
    context += `ID: ${currentChunk.id}\n`;
    context += `Type: ${currentChunk.context.type}\n`;
    context += `Category: ${currentChunk.context.category || 'unknown'}\n`;
    context += `Content: ${currentChunk.content.substring(0, 1000)}...\n`;

    return context;
  }

  /**
   * Analyze individual chunk with Llama
   */
  private async analyzeChunkWithLlama(
    chunk: { id: string; content: string; context: any },
    context: string
  ): Promise<ChunkAnalysisResult> {
    const prompt = this.buildChunkAnalysisPrompt(chunk, context);

    try {
      logger.info('Using Ollama for content analysis...');
      const response = await this.ollamaService.generate(prompt, {
        temperature: 0.1,
        top_p: 0.9
      });

      return this.parseLlamaAnalysisResponse(response.response, chunk);

    } catch (error) {
      logger.warn(`Llama analysis failed for chunk ${chunk.id}, using fallback`, { error });
      return this.createFallbackAnalysis(chunk);
    }
  }

  /**
   * Build prompt for chunk analysis
   */
  private buildChunkAnalysisPrompt(
    chunk: { id: string; content: string; context: any },
    context: string
  ): string {
    return `${context}

ANALYSIS TASK:
Analyze this HTML chunk and determine:
1. Content relevance (0-10 scale)
2. Content type classification
3. Whether to keep or remove
4. Reasoning for decision
5. Extract useful CSS selectors

RESPONSE FORMAT (JSON):
{
  "relevanceScore": number,
  "contentType": "main-content" | "navigation" | "advertisement" | "footer" | "header" | "sidebar" | "unknown",
  "shouldKeep": boolean,
  "reasoning": "detailed explanation",
  "extractedSelectors": ["selector1", "selector2"]
}

FOCUS ON:
- Keep main content and important structural elements
- Remove advertisements, navigation, footers, headers unless they contain useful data
- Extract CSS selectors that could be useful for scraping
- Consider the context of previous chunks when making decisions`;
  }

  /**
   * Parse Llama analysis response
   */
  private parseLlamaAnalysisResponse(
    response: string,
    chunk: { id: string; content: string; context: any }
  ): ChunkAnalysisResult {
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const analysis = JSON.parse(jsonMatch[0]);

      return {
        chunkId: chunk.id,
        content: chunk.content,
        relevanceScore: analysis.relevanceScore || 0,
        contentType: analysis.contentType || 'unknown',
        shouldKeep: analysis.shouldKeep || false,
        reasoning: analysis.reasoning || 'No reasoning provided',
        extractedSelectors: analysis.extractedSelectors || []
      };

    } catch (error) {
      logger.warn(`Failed to parse Llama response for chunk ${chunk.id}`, { error });
      return this.createFallbackAnalysis(chunk);
    }
  }

  /**
   * Create fallback analysis when Llama fails
   */
  private createFallbackAnalysis(chunk: { id: string; content: string; context: any }): ChunkAnalysisResult {
    const isMainContent = chunk.context.category === 'mainContent' ||
                         chunk.context.isMainContent ||
                         chunk.content.includes('<main') ||
                         chunk.content.includes('<article');

    return {
      chunkId: chunk.id,
      content: chunk.content,
      relevanceScore: isMainContent ? 8 : 3,
      contentType: isMainContent ? 'main-content' : 'unknown',
      shouldKeep: isMainContent,
      reasoning: 'Fallback analysis - keeping main content only',
      extractedSelectors: []
    };
  }

  /**
   * Step 4: Merge and refine results
   */
  private async mergeAndRefineResults(
    analysisResults: ChunkAnalysisResult[],
    structuralAnalysis: StructuralAnalysis
  ): Promise<string> {
    // Keep chunks that should be preserved
    const keptChunks = analysisResults
      .filter(result => result.shouldKeep)
      .map(result => result.content);

    // Add structural elements that are important
    const importantStructuralElements = [
      ...structuralAnalysis.mainContent ? [structuralAnalysis.mainContent] : [],
      // Add other important structural elements if needed
    ];

    // Combine all kept content
    const allContent = [...keptChunks, ...importantStructuralElements];

    // Create final HTML structure
    const finalHtml = this.createFinalHtmlStructure(allContent);

    // Apply final refinement with Llama
    return await this.applyFinalRefinement(finalHtml);
  }

  /**
   * Create final HTML structure
   */
  private createFinalHtmlStructure(content: string[]): string {
    const bodyContent = content.join('\n');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Compressed Content</title>
</head>
<body>
  ${bodyContent}
</body>
</html>`;
  }

  /**
   * Apply final refinement with Llama
   */
  private async applyFinalRefinement(html: string): Promise<string> {
    const prompt = `FINAL HTML REFINEMENT:

Refine this compressed HTML to:
1. Remove any remaining redundant content
2. Optimize structure for web scraping
3. Ensure proper HTML formatting
4. Keep only essential content and structure

HTML TO REFINE:
${html}

Return only the refined HTML, no explanations.`;

    try {
      logger.info('Using Ollama for content refinement...');
      const response = await this.ollamaService.generate(prompt, {
        temperature: 0.1
      });

      return response.response.trim();
    } catch (error) {
      logger.warn('Final refinement failed, returning original', { error });
      return html;
    }
  }

  /**
   * Basic compression (fallback method)
   */
  private async basicCompression(html: string, options: CompressionOptions): Promise<CompressionResult> {
    const originalSize = html.length;

    try {
      // Step 1: Light compression - only remove truly unnecessary elements
      let compressed = html
        .replace(/<!--[\s\S]*?-->/g, '') // Remove comments
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove scripts
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '') // Remove styles
        .replace(/<link[^>]*>/gi, '') // Remove link tags
        .replace(/<meta[^>]*>/gi, '') // Remove meta tags
        .replace(/\s+/g, ' ') // Normalize whitespace
        .replace(/>\s+</g, '><') // Remove whitespace between tags
        .trim();

      // Step 2: For plan generation, preserve more structure
      let finalHtml = compressed;

      // Only apply additional compression if specifically requested
      if (options.removeWhitespace) {
        finalHtml = this.removeExcessiveWhitespace(finalHtml);
      }

      // Only truncate if we have a very strict token limit (for content pages, not main pages)
      if (options.maxTokens && options.maxTokens < 8000) {
        finalHtml = this.truncateToTokenLimit(finalHtml, options.maxTokens);
      }

      const compressedSize = finalHtml.length;
      const compressionRatio = (originalSize - compressedSize) / originalSize;
      const tokensEstimate = this.estimateTokens(finalHtml);

      logger.info('Basic HTML compression completed', {
        originalSize,
        compressedSize,
        compressionRatio: Math.round(compressionRatio * 100),
        tokensEstimate,
        approach: 'basic'
      });

      return {
        compressedHtml: finalHtml,
        originalSize,
        compressedSize,
        compressionRatio,
        tokensEstimate,
        elementsRemoved: 0
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Basic HTML compression failed', { error: errorMessage });
      throw new Error(`HTML compression failed: ${errorMessage}`);
    }
  }

  /**
   * Compress HTML specifically for content pattern analysis
   */
  async compressForContentAnalysis(html: string, contentSelectors: string[] = []): Promise<CompressionResult> {
    const options: CompressionOptions = {
      removeComments: true,
      removeWhitespace: true,
      removeEmptyElements: true,
      removeScripts: true,
      removeStyles: true,
      removeNonContentElements: false, // Keep structure for pattern analysis
      maxTokens: 12000, // Higher limit for content analysis
      preserveStructure: true
    };

    const result = await this.compressHtml(html, options);

    // If content selectors provided, focus on those areas
    if (contentSelectors.length > 0) {
      result.compressedHtml = this.focusOnContentAreas(result.compressedHtml, contentSelectors);
      result.compressedSize = result.compressedHtml.length;
      result.tokensEstimate = this.estimateTokens(result.compressedHtml);
    }

    return result;
  }

  /**
   * Focus on specific content areas
   */
  private focusOnContentAreas(html: string, contentSelectors: string[]): string {
    try {
      const dom = new JSDOM(html);
      const document = dom.window.document;

      const contentElements: Element[] = [];
      contentSelectors.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        contentElements.push(...Array.from(elements));
      });

      if (contentElements.length === 0) {
        return html; // Return original if no content found
      }

      // Create new document with only content elements
      const newDoc = new JSDOM('<!DOCTYPE html><html><body></body></html>');
      const newBody = newDoc.window.document.body;

      contentElements.forEach(element => {
        const cloned = element.cloneNode(true);
        newBody.appendChild(cloned);
      });

      return newDoc.window.document.documentElement.outerHTML;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn('Failed to focus on content areas, returning original HTML', { error: errorMessage });
      return html;
    }
  }

  /**
   * Remove excessive whitespace
   */
  private removeExcessiveWhitespace(html: string): string {
    return html
      .replace(/\s+/g, ' ') // Multiple whitespace to single space
      .replace(/>\s+</g, '><') // Remove whitespace between tags
      .replace(/^\s+|\s+$/g, '') // Trim start and end
      .replace(/\n\s*\n/g, '\n'); // Remove empty lines
  }

  /**
   * Truncate to token limit
   */
  private truncateToTokenLimit(html: string, maxTokens: number): string {
    const estimatedTokens = this.estimateTokens(html);

    if (estimatedTokens <= maxTokens) {
      return html;
    }

    // Rough approximation: 1 token ≈ 4 characters
    const maxChars = maxTokens * 4;
    const truncated = html.substring(0, maxChars);

    // Try to end at a complete tag
    const lastTagEnd = truncated.lastIndexOf('>');
    if (lastTagEnd > maxChars * 0.8) {
      return truncated.substring(0, lastTagEnd + 1);
    }

    return truncated;
  }

  /**
   * Deduplicate chunks
   */
  private deduplicateChunks(chunks: Array<{ id: string; content: string; context: any }>): Array<{ id: string; content: string; context: any }> {
    const seen = new Set<string>();
    return chunks.filter(chunk => {
      const key = chunk.content.substring(0, 100); // Use first 100 chars as key
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * Estimate tokens
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.5);
  }

  /**
   * Check if Ollama is available
   */
  private async isOllamaAvailable(): Promise<boolean> {
    try {
      return await this.ollamaService.healthCheck();
    } catch {
      return false;
    }
  }

  /**
   * Check if Playwright is available
   */
  private async isPlaywrightAvailable(): Promise<boolean> {
    try {
      if (!this.browser) {
        this.browser = await chromium.launch({ headless: true });
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get compression statistics for monitoring
   */
  getCompressionStats(results: CompressionResult[]): {
    avgCompressionRatio: number;
    avgTokenReduction: number;
    totalElementsRemoved: number;
  } {
    if (results.length === 0) {
      return { avgCompressionRatio: 0, avgTokenReduction: 0, totalElementsRemoved: 0 };
    }

    const avgCompressionRatio = results.reduce((sum, r) => sum + r.compressionRatio, 0) / results.length;
    const avgTokenReduction = results.reduce((sum, r) => {
      const originalTokens = this.estimateTokens('x'.repeat(r.originalSize));
      return sum + ((originalTokens - r.tokensEstimate) / originalTokens);
    }, 0) / results.length;
    const totalElementsRemoved = results.reduce((sum, r) => sum + r.elementsRemoved, 0);

    return {
      avgCompressionRatio,
      avgTokenReduction,
      totalElementsRemoved
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    try {
      if (this.browser) {
        await this.browser.close();
        this.browser = undefined;
      }

      if (this.llamaIndexService) {
        await this.llamaIndexService.cleanup();
      }

      logger.info('HtmlCompressorService cleanup completed');
    } catch (error) {
      logger.error('Error during HtmlCompressorService cleanup', { error });
    }
  }
}