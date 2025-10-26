/**
 * LLM Tracking Integration for Plan Output
 * Saves LLM request/response data in the final plan markdown file
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { getLLMTracker } from '../services/llm-tracker.service';
import { logger } from '../utils/logger';

export interface PlanWithLLMTracking {
  planContent: string;
  llmTrackingData: string;
  llmTrackingMarkdown: string;
}

/**
 * Save LLM tracking data to the final plan output
 */
export async function saveLLMTrackingToPlan(
  planFilePath: string,
  sessionId?: string
): Promise<void> {
  try {
    const tracker = getLLMTracker(sessionId);
    const trackingData = tracker.getTrackingData();

    // Generate markdown report
    const llmReport = tracker.generateMarkdownReport();

    // Read existing plan content
    const existingContent = await fs.readFile(planFilePath, 'utf-8');

    // Append LLM tracking data to the plan
    const updatedContent = `${existingContent}\n\n---\n\n# LLM Interaction Tracking\n\n${llmReport}`;

    // Write updated content back to file
    await fs.writeFile(planFilePath, updatedContent);

    logger.info('💾 LLM tracking data saved to plan file', {
      planFile: planFilePath,
      totalRequests: trackingData.summary.totalRequests,
      totalTokens: trackingData.summary.totalTokens,
      successRate: trackingData.summary.successRate
    });

    // Also save detailed JSON data
    const jsonFilePath = planFilePath.replace('.md', '-llm-tracking.json');
    await fs.writeFile(jsonFilePath, tracker.exportAsJSON());

    logger.info('💾 LLM tracking JSON data saved', {
      jsonFile: jsonFilePath
    });

  } catch (error) {
    logger.error('Failed to save LLM tracking data to plan:', error);
  }
}

/**
 * Generate LLM tracking summary for plan
 */
export function generateLLMTrackingSummary(sessionId?: string): string {
  try {
    const tracker = getLLMTracker(sessionId);
    const data = tracker.getTrackingData();

    let summary = `## LLM Usage Summary\n\n`;
    summary += `- **Total Requests:** ${data.summary.totalRequests}\n`;
    summary += `- **Total Tokens:** ${data.summary.totalTokens}\n`;
    summary += `- **Success Rate:** ${data.summary.successRate.toFixed(2)}%\n`;
    summary += `- **Total Duration:** ${data.summary.totalDuration}ms\n\n`;

    summary += `### Service Breakdown\n\n`;
    Object.entries(data.summary.serviceBreakdown).forEach(([service, count]) => {
      summary += `- **${service}:** ${count} requests\n`;
    });
    summary += `\n`;

    summary += `### Provider Breakdown\n\n`;
    Object.entries(data.summary.providerBreakdown).forEach(([provider, count]) => {
      summary += `- **${provider}:** ${count} requests\n`;
    });
    summary += `\n`;

    return summary;

  } catch (error) {
    logger.error('Failed to generate LLM tracking summary:', error);
    return `## LLM Usage Summary\n\n*Error generating summary: ${error}*\n\n`;
  }
}

/**
 * Reset LLM tracker for new session
 */
export function resetLLMTrackerForNewSession(sessionId?: string): void {
  const { resetLLMTracker } = require('../services/llm-tracker.service');
  resetLLMTracker(sessionId);
  logger.info('🔄 LLM tracker reset for new session', { sessionId });
}

/**
 * Get LLM tracking data for current session
 */
export function getCurrentLLMTrackingData(sessionId?: string) {
  const tracker = getLLMTracker(sessionId);
  return tracker.getTrackingData();
}
