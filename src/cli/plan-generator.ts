#!/usr/bin/env node

/**
 * Plan Generator CLI
 * Interactive command-line tool for generating website scraping plans
 */

import * as readline from 'readline';
import { MCPOrchestratorService } from '../services/mcp-orchestrator.service';
import { PlanOptions } from '../interfaces/core';

interface UserInput {
  url: string;
  contentUrls?: string[];
  options: PlanOptions;
}

class PlanGeneratorCLI {
  private orchestrator: MCPOrchestratorService;
  private rl: readline.Interface;

  constructor() {
    this.orchestrator = new MCPOrchestratorService();
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  /**
   * Start the interactive CLI
   */
  public async start(): Promise<void> {
    try {
      console.log('🚀 Website Scraping Plan Generator');
      console.log('===================================\n');

      // Initialize the orchestrator
      console.log('Initializing services...');
      await this.orchestrator.initialize();
      console.log('✅ Services initialized successfully\n');

      // Get user input
      const userInput = await this.getUserInput();

      // Generate the plan
      console.log('\n🔄 Generating scraping plan...');
      const result = await this.orchestrator.generatePlan(
        userInput.url,
        userInput.contentUrls,
        userInput.options
      );

      // Display results
      this.displayResults(result);

      // Ask if user wants to test the plan
      const shouldTest = await this.askYesNo('\nWould you like to test this plan? (y/n): ');
      if (shouldTest) {
        await this.testPlan(result.planId);
      }

      // Ask if user wants to generate another plan
      const generateAnother = await this.askYesNo('\nWould you like to generate another plan? (y/n): ');
      if (generateAnother) {
        await this.start();
      } else {
        await this.shutdown();
      }
    } catch (error) {
      console.error('\n❌ Error:', error instanceof Error ? error.message : String(error));
      await this.shutdown();
      process.exit(1);
    }
  }

  /**
   * Get user input interactively
   */
  private async getUserInput(): Promise<UserInput> {
    const url = await this.askQuestion('Enter the website URL to scrape: ');

    if (!this.isValidUrl(url)) {
      throw new Error('Invalid URL format. Please provide a valid HTTP/HTTPS URL.');
    }

    console.log('\n📋 Optional Configuration:');

    // Content URLs
    const hasContentUrls = await this.askYesNo('Do you have specific content page URLs to analyze? (y/n): ');
    let contentUrls: string[] | undefined;

    if (hasContentUrls) {
      contentUrls = await this.getContentUrls();
    }

    // Plan options
    const options = await this.getPlanOptions();

    return {
      url,
      contentUrls,
      options,
    };
  }

  /**
   * Get content URLs from user
   */
  private async getContentUrls(): Promise<string[]> {
    const urls: string[] = [];
    console.log('\nEnter content URLs (one per line, press Enter twice to finish):');

    while (true) {
      const url = await this.askQuestion('Content URL: ');

      if (url.trim() === '') {
        break;
      }

      if (this.isValidUrl(url)) {
        urls.push(url.trim());
        console.log(`✅ Added: ${url}`);
      } else {
        console.log('❌ Invalid URL, skipping...');
      }
    }

    return urls;
  }

  /**
   * Get plan options from user
   */
  private async getPlanOptions(): Promise<PlanOptions> {
    const options: PlanOptions = {};

    // Model preference
    const useLocal = await this.askYesNo('Use local AI model instead of OpenAI? (y/n): ');
    options.useLocalModel = useLocal;

    // Priority
    console.log('\nSelect priority:');
    console.log('1. Cost (cheapest)');
    console.log('2. Speed (fastest)');
    console.log('3. Accuracy (most accurate)');
    console.log('4. Balanced (default)');

    const priorityChoice = await this.askQuestion('Enter choice (1-4) [4]: ');
    const priorities = ['cost', 'speed', 'accuracy', 'balanced'] as const;
    const priorityIndex = parseInt(priorityChoice) - 1;
    options.priority = priorities[priorityIndex] || 'balanced';

    // Confidence threshold
    const confidenceInput = await this.askQuestion('Minimum confidence threshold (0.0-1.0) [0.7]: ');
    const confidence = parseFloat(confidenceInput);
    if (!isNaN(confidence) && confidence >= 0 && confidence <= 1) {
      options.confidenceThreshold = confidence;
    } else {
      options.confidenceThreshold = 0.7;
    }

    // Max cost
    const maxCostInput = await this.askQuestion('Maximum cost per request in USD [no limit]: ');
    const maxCost = parseFloat(maxCostInput);
    if (!isNaN(maxCost) && maxCost > 0) {
      options.maxCost = maxCost;
    }

    // Pagination
    const isPaginated = await this.askYesNo('Does the site have pagination? (y/n): ');
    options.isPaginated = isPaginated;

    if (isPaginated) {
      const paginationUrl = await this.askQuestion('Example pagination URL (optional): ');
      if (paginationUrl && this.isValidUrl(paginationUrl)) {
        options.paginationUrl = paginationUrl;
      }
    }

    return options;
  }

  /**
   * Display generation results
   */
  private displayResults(result: any): void {
    console.log('\n🎉 Plan Generated Successfully!');
    console.log('================================');
    console.log(`Plan ID: ${result.planId}`);
    console.log(`Confidence: ${(result.confidence * 100).toFixed(1)}%`);
    console.log(`Entry URLs: ${result.plan.entryUrls.length}`);
    console.log(`List Selector: ${result.plan.listSelector}`);

    if (result.plan.paginationSelector) {
      console.log(`Pagination Selector: ${result.plan.paginationSelector}`);
    }

    console.log('\nDetail Selectors:');
    Object.entries(result.plan.detailSelectors).forEach(([field, selector]) => {
      console.log(`  ${field}: ${selector}`);
    });

    if (result.plan.excludeSelectors && result.plan.excludeSelectors.length > 0) {
      console.log('\nExclude Selectors:');
      result.plan.excludeSelectors.forEach((selector: string) => {
        console.log(`  ${selector}`);
      });
    }

    console.log(`\nRate Limit: ${result.plan.rateLimitMs}ms`);
    console.log(`Max Retries: ${result.plan.retryPolicy.maxAttempts}`);

    if (result.siblingDiscovery) {
      console.log('\nSibling Link Discovery:');
      console.log(`  Original URLs: ${result.siblingDiscovery.originalUrls.length}`);
      console.log(`  Discovered Links: ${result.siblingDiscovery.discoveredLinks.length}`);
      console.log(`  Total Enhanced URLs: ${result.siblingDiscovery.totalEnhancedUrls}`);
    }

    if (result.testResults) {
      console.log('\nTest Results:');
      console.log(`  Success: ${result.testResults.success ? '✅' : '❌'}`);
      console.log(`  Sample Items: ${result.testResults.extractedSamples.length}`);
      console.log(`  Confidence: ${(result.testResults.confidence * 100).toFixed(1)}%`);

      if (result.testResults.errors.length > 0) {
        console.log('  Errors:');
        result.testResults.errors.forEach((error: string) => {
          console.log(`    - ${error}`);
        });
      }
    }

    console.log('\nHuman-Readable Documentation:');
    console.log('-----------------------------');
    console.log(result.humanReadableDoc);
  }

  /**
   * Test the generated plan
   */
  private async testPlan(planId: string): Promise<void> {
    try {
      console.log('\n🧪 Testing the plan...');

      const runId = `test_${Date.now()}`;
      const testOptions = {
        maxPages: 1,
        maxItems: 5,
        testMode: true,
        timeout: 30000,
      };

      const result = await this.orchestrator.executePlan(planId, runId, testOptions);

      console.log('\n📊 Test Results:');
      console.log('================');
      console.log(`Status: ${result.status}`);
      console.log(`Items Extracted: ${result.extractedData.length}`);
      console.log(`Pages Processed: ${result.metrics.pagesProcessed}`);
      console.log(`Duration: ${result.metrics.duration}ms`);
      console.log(`Accuracy Score: ${(result.metrics.accuracyScore * 100).toFixed(1)}%`);

      if (result.extractedData.length > 0) {
        console.log('\nSample Extracted Data:');
        console.log('---------------------');
        result.extractedData.slice(0, 3).forEach((item, index) => {
          console.log(`\nItem ${index + 1}:`);
          console.log(`  Title: ${item.title || 'N/A'}`);
          console.log(`  Description: ${item.description?.substring(0, 100) || 'N/A'}...`);
          console.log(`  Website: ${item.website || 'N/A'}`);
          console.log(`  Images: ${item.images.length} found`);
        });
      }

      if (result.errors.length > 0) {
        console.log('\nErrors Encountered:');
        result.errors.forEach((error) => {
          console.log(`  - ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    } catch (error) {
      console.error('❌ Test failed:', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Ask a question and return the answer
   */
  private askQuestion(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(question, (answer) => {
        resolve(answer.trim());
      });
    });
  }

  /**
   * Ask a yes/no question
   */
  private async askYesNo(question: string): Promise<boolean> {
    const answer = await this.askQuestion(question);
    return ['y', 'yes', 'true', '1'].includes(answer.toLowerCase());
  }

  /**
   * Validate URL format
   */
  private isValidUrl(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Shutdown the CLI
   */
  private async shutdown(): Promise<void> {
    console.log('\n👋 Shutting down...');
    this.rl.close();

    try {
      await this.orchestrator.shutdown();
      console.log('✅ Services shut down successfully');
    } catch (error) {
      console.error('⚠️  Error during shutdown:', error);
    }
  }
}

// Handle process signals for graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\n🛑 Received interrupt signal');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n\n🛑 Received termination signal');
  process.exit(0);
});

// Start the CLI if this file is run directly
if (require.main === module) {
  const cli = new PlanGeneratorCLI();
  cli.start().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { PlanGeneratorCLI };