#!/usr/bin/env ts-node

/**
 * Website Scraping Plan Generator
 * Entry point script for generating scraping plans
 *
 * Usage:
 *   npm run generate-plan
 *   or
 *   npx ts-node generate-plan.ts
 */

// Load environment variables first
import * as dotenv from 'dotenv';
dotenv.config();

import { PlanGeneratorCLI } from '../src/cli/plan-generator';

async function main() {
  const cli = new PlanGeneratorCLI();
  await cli.start();
}

// Run the CLI
main().catch((error) => {
  console.error('❌ Fatal error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});