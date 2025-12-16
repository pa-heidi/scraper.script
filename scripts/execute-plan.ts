#!/usr/bin/env ts-node

/**
 * Execute Plan Script
 * Executes a scraping plan and saves results to JSON
 */

import { Command } from 'commander';
import { MCPOrchestratorService } from '../src/services/mcp-orchestrator.service';
import { logger } from '../src/utils/logger';

const program = new Command();

program
    .name('execute-plan')
    .description('Execute a scraping plan')
    .requiredOption('--plan-id <planId>', 'Plan ID to execute')
    .option('--max-pages <number>', 'Maximum pages to process', '1')
    .option('--max-items <number>', 'Maximum items to extract', '5')
    .option('--max-items-per-page <number>', 'Maximum items per page')
    .option('--timeout <number>', 'Timeout in milliseconds', '30000')
    .option('--test-mode', 'Enable test mode', false)
    .option('--validate', 'Validate results', true)
    .option('--retry-failed', 'Retry failed items', true)
    .parse();

const options = program.opts();

async function executePlan() {
    try {
        logger.info('Starting plan execution...', {
            planId: options.planId,
            maxPages: parseInt(options.maxPages),
            maxItems: parseInt(options.maxItems),
            timeout: parseInt(options.timeout),
            testMode: options.testMode
        });

        const orchestrator = new MCPOrchestratorService();

        // Initialize the orchestrator (connects to Redis)
        await orchestrator.initialize();

        // Generate a unique run ID
        const runId = `run-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const executionOptions = {
            maxPages: parseInt(options.maxPages),
            maxItems: parseInt(options.maxItems),
            maxItemsPerPage: options.maxItemsPerPage ? parseInt(options.maxItemsPerPage) : undefined,
            timeout: parseInt(options.timeout),
            testMode: options.testMode,
            validateResults: options.validate !== false,
            retryFailedItems: options.retryFailed !== false
        };

        logger.info(`Executing plan ${options.planId} with run ID: ${runId}`);

        const result = await orchestrator.executePlan(
            options.planId,
            runId,
            executionOptions
        );

        logger.info('Plan execution completed!', {
            status: result.status,
            itemsExtracted: result.metrics.itemsExtracted,
            pagesProcessed: result.metrics.pagesProcessed,
            duration: result.metrics.duration,
            errors: result.errors.length
        });

        if (result.status === 'completed') {
            console.log('\n✅ Execution completed successfully!');
            console.log(`📊 Items extracted: ${result.metrics.itemsExtracted}`);
            console.log(`📄 Pages processed: ${result.metrics.pagesProcessed}`);
            console.log(`⏱️  Duration: ${result.metrics.duration}ms`);
            console.log(`📁 Results saved to: execution-results/execution-${runId}-*.json`);
        } else {
            console.log('\n❌ Execution failed');
            console.log(`🔍 Errors: ${result.errors.length}`);
            if (result.errors.length > 0) {
                console.log('Error details:');
                result.errors.forEach((error, index) => {
                    console.log(`  ${index + 1}. ${error instanceof Error ? error.message : String(error)}`);
                });
            }
        }

        // Cleanup
        await orchestrator.shutdown();
        process.exit(result.status === 'completed' ? 0 : 1);

    } catch (error) {
        logger.error('Plan execution failed:', error);
        console.error('\n❌ Execution failed with error:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

// Run the execution
executePlan();