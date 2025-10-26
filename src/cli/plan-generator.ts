#!/usr/bin/env node

/**
 * Plan Generator CLI
 * Interactive command-line tool for generating website scraping plans
 */

import * as readline from 'readline';
import * as fs from 'fs/promises';
import * as path from 'path';
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

      // Initialize LLM tracking
      const { resetLLMTrackerForNewSession } = await import('../utils/llm-tracking-integration');
      const sessionId = `plan-generation-${Date.now()}`;
      resetLLMTrackerForNewSession(sessionId);
      console.log(`📊 LLM tracking initialized for session: ${sessionId}\n`);

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

      // Save results to markdown file
      await this.saveResultsToFile(result, userInput.url);

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
      const isRichContent = result.plan.richContentFields?.includes(field);
      const contentType = isRichContent ? ' (Rich HTML)' : ' (Text)';
      console.log(`  ${field}${contentType}: ${selector}`);
    });

    if (result.plan.richContentFields && result.plan.richContentFields.length > 0) {
      console.log('\nRich Content Fields (HTML):');
      result.plan.richContentFields.forEach((field: string) => {
        console.log(`  ✨ ${field}: Preserves HTML formatting for WYSIWYG display`);
      });
    }

    if (result.plan.excludeSelectors && result.plan.excludeSelectors.length > 0) {
      console.log('\nExclude Selectors:');
      result.plan.excludeSelectors.forEach((selector: string) => {
        console.log(`  ${selector}`);
      });
    }

    console.log(`\nRate Limit: ${result.plan.rateLimitMs}ms`);
    console.log(`Max Retries: ${result.plan.retryPolicy.maxAttempts}`);

    // Display cookie consent information
    if (result.plan.metadata.cookieConsent) {
      const cc = result.plan.metadata.cookieConsent;
      console.log('\nCookie Consent Configuration:');
      console.log(`  Detected: ${cc.detected ? '✅' : '❌'}`);
      console.log(`  Strategy: ${cc.strategy}`);
      console.log(`  Library: ${cc.library}`);
      console.log(`  Handled Successfully: ${cc.handledSuccessfully ? '✅' : '❌'}`);

      if (cc.acceptButtonSelector) {
        console.log(`  Accept Button Selector: ${cc.acceptButtonSelector}`);
      }
      if (cc.bannerSelector) {
        console.log(`  Banner Selector: ${cc.bannerSelector}`);
      }
    } else {
      console.log('\nCookie Consent: ❌ Not detected');
    }

    if (result.siblingDiscovery) {
      console.log('\nSibling Link Discovery:');
      console.log(`  Original URLs: ${result.siblingDiscovery.originalUrls.length}`);
      console.log(`  Discovered Links: ${result.siblingDiscovery.discoveredLinks.length}`);
      console.log(`  Total Enhanced URLs: ${result.siblingDiscovery.totalEnhancedUrls}`);

      // Show content link selector if available
      if (result.siblingDiscovery.discoveryResults && result.siblingDiscovery.discoveryResults.length > 0) {
        const bestResult = result.siblingDiscovery.discoveryResults[0];
        if (bestResult.metadata?.contentLinkSelector) {
          console.log(`  Content Link Selector: ${bestResult.metadata.contentLinkSelector}`);
        }
      }
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
   * Save generation results to markdown file
   */
  private async saveResultsToFile(result: any, url: string): Promise<void> {
    try {
      // Create filename based on domain and timestamp
      const domain = new URL(url).hostname.replace(/\./g, '-');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `scraping-plan-${domain}-${timestamp}.md`;
      const filepath = path.join(process.cwd(), 'plans', filename);

      // Ensure plans directory exists
      await fs.mkdir(path.dirname(filepath), { recursive: true });

      // Generate markdown content
      const markdown = this.generateMarkdownReport(result, url);

      // Write to file
      await fs.writeFile(filepath, markdown, 'utf8');

      // Save LLM tracking data to the plan file
      const { saveLLMTrackingToPlan } = await import('../utils/llm-tracking-integration');
      await saveLLMTrackingToPlan(filepath);

      console.log(`\n📄 Plan saved to: ${filepath}`);
      console.log(`📊 LLM tracking data included in plan file`);
    } catch (error) {
      console.error('❌ Failed to save plan to file:', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Generate markdown report from results
   */
  private generateMarkdownReport(result: any, url: string): string {
    const timestamp = new Date().toISOString();
    const domain = new URL(url).hostname;

    let markdown = `# 🕷️ Scraping Plan Report

**Generated:** ${timestamp}
**Target URL:** [${url}](${url})
**Domain:** ${domain}
**Plan ID:** \`${result.planId}\`
**Confidence:** ${(result.confidence * 100).toFixed(1)}%

## 📋 Plan Overview

| Property | Value |
|----------|-------|
| Entry URLs | ${result.plan.entryUrls.length} |
| List Selector | \`${result.plan.listSelector}\` |
| Rate Limit | ${result.plan.rateLimitMs}ms |
| Max Retries | ${result.plan.retryPolicy.maxAttempts} |

`;

    // Add pagination selector if present
    if (result.plan.paginationSelector) {
      markdown += `| Pagination Selector | \`${result.plan.paginationSelector}\` |\n`;
    }

    // Add detail selectors
    markdown += `\n## 🎯 Detail Selectors

| Field | Content Type | Selector |
|-------|--------------|----------|
`;
    Object.entries(result.plan.detailSelectors).forEach(([field, selector]) => {
      const isRichContent = result.plan.richContentFields?.includes(field);
      const contentType = isRichContent ? '🎨 Rich HTML' : '📝 Text';
      markdown += `| ${field} | ${contentType} | \`${selector}\` |\n`;
    });

    // Add rich content fields section if present
    if (result.plan.richContentFields && result.plan.richContentFields.length > 0) {
      markdown += `
### ✨ Rich Content Fields

The following fields extract HTML content (innerHTML) for WYSIWYG display:

`;
      result.plan.richContentFields.forEach((field: string) => {
        markdown += `- **${field}**: Preserves HTML formatting, links, images, and other rich content elements\n`;
      });
      markdown += '\n';
    }

    // Add exclude selectors if present
    if (result.plan.excludeSelectors && result.plan.excludeSelectors.length > 0) {
      markdown += `\n## 🚫 Exclude Selectors

`;
      result.plan.excludeSelectors.forEach((selector: string) => {
        markdown += `- \`${selector}\`\n`;
      });
    }

    // Add sibling discovery results if present
    if (result.siblingDiscovery) {
      markdown += `\n## 🔗 Sibling Link Discovery

| Metric | Count |
|--------|-------|
| Original URLs | ${result.siblingDiscovery.originalUrls.length} |
| Discovered Links | ${result.siblingDiscovery.discoveredLinks.length} |
| Total Enhanced URLs | ${result.siblingDiscovery.totalEnhancedUrls} |

`;

      // Add content link selector information if available
      if (result.siblingDiscovery.discoveryResults && result.siblingDiscovery.discoveryResults.length > 0) {
        const bestResult = result.siblingDiscovery.discoveryResults[0];
        if (bestResult.metadata?.contentLinkSelector) {
          markdown += `### 🎯 Content Link Selector

The following selector was identified to extract all similar content links:

\`\`\`css
${bestResult.metadata.contentLinkSelector}
\`\`\`

> **💡 Usage**: This selector targets all content links within the container and is used as the primary list selector for scraping.

`;
        }
      }
    }

    // Add test results if present
    if (result.testResults) {
      markdown += `\n## 🧪 Test Results

| Metric | Value |
|--------|-------|
| Success | ${result.testResults.success ? '✅' : '❌'} |
| Sample Items | ${result.testResults.extractedSamples.length} |
| Confidence | ${(result.testResults.confidence * 100).toFixed(1)}% |

`;
      if (result.testResults.errors.length > 0) {
        markdown += `### ❌ Errors

`;
        result.testResults.errors.forEach((error: string) => {
          markdown += `- ${error}\n`;
        });
        markdown += '\n';
      }
    }

    // Add human-readable documentation
    markdown += `\n## 📖 Documentation

${result.humanReadableDoc}

`;

    // Add complete plan as JSON
    markdown += `\n## 📄 Complete Plan (JSON)

\`\`\`json
${JSON.stringify(result.plan, null, 2)}
\`\`\`

`;

    // Add cookie consent section if available
    if (result.plan.metadata.cookieConsent) {
      const cc = result.plan.metadata.cookieConsent;
      markdown += `\n## 🍪 Cookie Consent Configuration

| Property | Value |
|----------|-------|
| Detected | ${cc.detected ? '✅' : '❌'} |
| Strategy | ${cc.strategy} |
| Library | ${cc.library} |
| Handled Successfully | ${cc.handledSuccessfully ? '✅' : '❌'} |

### Cookie Consent Selectors

| Selector Type | CSS Selector |
|---------------|--------------|
`;
      if (cc.acceptButtonSelector) markdown += `| Accept Button | \`${cc.acceptButtonSelector}\` |\n`;
      if (cc.rejectButtonSelector) markdown += `| Reject Button | \`${cc.rejectButtonSelector}\` |\n`;
      if (cc.settingsButtonSelector) markdown += `| Settings Button | \`${cc.settingsButtonSelector}\` |\n`;
      if (cc.bannerSelector) markdown += `| Banner | \`${cc.bannerSelector}\` |\n`;
      if (cc.modalSelector) markdown += `| Modal | \`${cc.modalSelector}\` |\n`;

      markdown += `
> **💡 Usage Note**: These cookie consent selectors are automatically captured during plan generation and can be used by the scraping executor to handle cookie consent in future scraping sessions, ensuring compliance and preventing blocking.

`;
    }

    // Add metadata
    markdown += `\n## ℹ️ Metadata

| Property | Value |
|----------|-------|
| Domain | ${result.plan.metadata.domain} |
| Site Type | ${result.plan.metadata.siteType} |
| Language | ${result.plan.metadata.language} |
| Created By | ${result.plan.metadata.createdBy} |
| Robots.txt Compliant | ${result.plan.metadata.robotsTxtCompliant ? '✅' : '❌'} |
| GDPR Compliant | ${result.plan.metadata.gdprCompliant ? '✅' : '❌'} |

`;

    // Add generation timestamp
    markdown += `\n---
*Generated by AI Scraper Service CLI on ${timestamp}*
`;

    return markdown;
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