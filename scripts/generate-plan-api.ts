#!/usr/bin/env ts-node

/**
 * API-compatible Plan Generator Script
 * Non-interactive version for use by the web API
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { Command } from 'commander';
import { MCPOrchestratorService } from '../src/services/mcp-orchestrator.service';
import { PlanOptions } from '../src/interfaces/core';
import * as fs from 'fs/promises';
import * as path from 'path';

const program = new Command();

program
  .name('generate-plan-api')
  .description('Generate a scraping plan (non-interactive)')
  .requiredOption('--url <url>', 'Website URL to scrape')
  .option('--content-urls <urls>', 'Comma-separated content URLs', '')
  .option('--use-local', 'Use local AI model', false)
  .option('--priority <priority>', 'Priority: cost, speed, accuracy, balanced', 'balanced')
  .option('--confidence <number>', 'Confidence threshold (0-1)', '0.7')
  .option('--max-tokens <number>', 'Maximum tokens for LLM')
  .option('--max-cost <number>', 'Maximum cost per request in USD')
  .option('--paginated', 'Site has pagination', false)
  .option('--pagination-url <url>', 'Example pagination URL')
  .option('--save-llm-tracking', 'Save LLM tracking data', false)
  .option('--detailed-report', 'Generate detailed markdown report', false)
  .option('--non-interactive', 'Non-interactive mode', false)
  .parse();

const opts = program.opts();

async function main() {
  console.log('🚀 Starting plan generation...');
  console.log(`URL: ${opts.url}`);

  // Initialize LLM tracking if requested
  let sessionId: string | undefined;
  if (opts.saveLlmTracking) {
    try {
      const { resetLLMTrackerForNewSession } = await import('../src/utils/llm-tracking-integration');
      sessionId = `plan-generation-${Date.now()}`;
      resetLLMTrackerForNewSession(sessionId);
      console.log(`📊 LLM tracking initialized for session: ${sessionId}`);
    } catch (error) {
      console.warn('⚠️ LLM tracking not available:', error instanceof Error ? error.message : String(error));
    }
  }

  const orchestrator = new MCPOrchestratorService();

  try {
    // Initialize
    console.log('Initializing services...');
    await orchestrator.initialize();
    console.log('✅ Services initialized');

    // Parse content URLs
    const contentUrls = opts.contentUrls
      ? opts.contentUrls.split(',').map((u: string) => u.trim()).filter(Boolean)
      : undefined;

    if (contentUrls && contentUrls.length > 0) {
      console.log(`📎 Content URLs: ${contentUrls.length} provided`);
    }

    // Build options
    const options: PlanOptions = {
      useLocalModel: opts.useLocal,
      priority: opts.priority as PlanOptions['priority'],
      confidenceThreshold: parseFloat(opts.confidence),
      maxTokens: opts.maxTokens ? parseInt(opts.maxTokens) : undefined,
      maxCost: opts.maxCost ? parseFloat(opts.maxCost) : undefined,
      isPaginated: opts.paginated,
      paginationUrl: opts.paginationUrl
    };

    console.log('Generating scraping plan...');
    const result = await orchestrator.generatePlan(opts.url, contentUrls, options);

    console.log('\n🎉 Plan generated successfully!');
    console.log(`Plan ID: ${result.planId}`);
    console.log(`Confidence: ${(result.confidence * 100).toFixed(1)}%`);
    console.log(`Entry URLs: ${result.plan.entryUrls.length}`);

    // Save to file
    const domain = new URL(opts.url).hostname.replace(/\./g, '-');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `scraping-plan-${domain}-${timestamp}.md`;
    const filepath = path.join(process.cwd(), 'plans', filename);

    // Generate markdown content (detailed or simple)
    const markdown = opts.detailedReport
      ? generateDetailedMarkdown(result, opts.url)
      : generateSimpleMarkdown(result, opts.url);
    await fs.writeFile(filepath, markdown, 'utf8');

    console.log(`📄 Plan saved to: ${filepath}`);

    // Save LLM tracking data if enabled
    if (opts.saveLlmTracking) {
      try {
        const { saveLLMTrackingToPlan } = await import('../src/utils/llm-tracking-integration');
        await saveLLMTrackingToPlan(filepath);
        console.log(`📊 LLM tracking data saved`);
      } catch (error) {
        console.warn('⚠️ Failed to save LLM tracking:', error instanceof Error ? error.message : String(error));
      }
    }

    // Cleanup
    await orchestrator.shutdown();
    process.exit(0);

  } catch (error) {
    console.error('❌ Plan generation failed:', error instanceof Error ? error.message : String(error));
    await orchestrator.shutdown();
    process.exit(1);
  }
}

function generateSimpleMarkdown(result: any, url: string): string {
  const timestamp = new Date().toISOString();
  const domain = new URL(url).hostname;

  let md = `# 🕷️ Scraping Plan Report

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

  if (result.plan.paginationSelector) {
    md += `| Pagination Selector | \`${result.plan.paginationSelector}\` |\n`;
  }

  md += `\n## 🎯 Detail Selectors\n\n| Field | Content Type | Selector |\n|-------|--------------|----------|\n`;

  Object.entries(result.plan.detailSelectors).forEach(([field, selector]) => {
    const isRichContent = result.plan.richContentFields?.includes(field);
    const contentType = isRichContent ? '🎨 Rich HTML' : '📝 Text';
    md += `| ${field} | ${contentType} | \`${selector}\` |\n`;
  });

  md += `\n## 📄 Complete Plan (JSON)\n\n\`\`\`json\n${JSON.stringify(result.plan, null, 2)}\n\`\`\`\n`;

  md += `\n---\n*Generated by AI Scraper Service API on ${timestamp}*\n`;

  return md;
}

function generateDetailedMarkdown(result: any, url: string): string {
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

  // Add human-readable documentation if present
  if (result.humanReadableDoc) {
    markdown += `\n## 📖 Documentation

${result.humanReadableDoc}

`;
  }

  // Add complete plan as JSON
  markdown += `\n## 📄 Complete Plan (JSON)

\`\`\`json
${JSON.stringify(result.plan, null, 2)}
\`\`\`

`;

  // Add cookie consent section if available
  if (result.plan.metadata?.cookieConsent) {
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

  // Add metadata if available
  if (result.plan.metadata) {
    markdown += `\n## ℹ️ Metadata

| Property | Value |
|----------|-------|
| Domain | ${result.plan.metadata.domain || domain} |
| Site Type | ${result.plan.metadata.siteType || 'N/A'} |
| Language | ${result.plan.metadata.language || 'N/A'} |
| Created By | ${result.plan.metadata.createdBy || 'API'} |
| Robots.txt Compliant | ${result.plan.metadata.robotsTxtCompliant ? '✅' : '❌'} |
| GDPR Compliant | ${result.plan.metadata.gdprCompliant ? '✅' : '❌'} |

`;
  }

  // Add generation timestamp
  markdown += `\n---
*Generated by AI Scraper Service API on ${timestamp}*
`;

  return markdown;
}

main();
