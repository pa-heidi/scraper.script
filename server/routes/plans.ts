/**
 * Plans API Routes
 * Handle listing and retrieving scraping plans from the plans/ directory
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PlanSummary } from '../types';

const router = Router();
const PLANS_DIR = path.join(process.cwd(), 'plans');

/**
 * Parse plan metadata from markdown file
 */
async function parsePlanMetadata(filename: string): Promise<PlanSummary | null> {
  try {
    const filePath = path.join(PLANS_DIR, filename);
    const content = await fs.readFile(filePath, 'utf-8');

    // Extract metadata from markdown (handling **bold** markers)
    const idMatch = content.match(/\*?\*?Plan ID:\*?\*?\s*`?([^`\n]+)`?/i);
    const urlMatch = content.match(/\*?\*?Target URL:\*?\*?\s*\[([^\]]+)\]/i);
    const domainMatch = content.match(/\*?\*?Domain:\*?\*?\s*(\S+)/i);
    const confidenceMatch = content.match(/\*?\*?Confidence:\*?\*?\s*([\d.]+)%?/i);
    const generatedMatch = content.match(/\*?\*?Generated:\*?\*?\s*(\S+)/i);

    // Check for tracking data file
    const trackingFile = filename.replace('.md', '-llm-tracking.json');
    let hasTrackingData = false;
    try {
      await fs.access(path.join(PLANS_DIR, trackingFile));
      hasTrackingData = true;
    } catch {
      // No tracking file
    }

    const planId = idMatch?.[1]?.trim() || filename.replace('.md', '');

    // Parse confidence - it's stored as percentage (e.g., 85.0), convert to decimal
    let confidence = 0;
    if (confidenceMatch) {
      const confValue = parseFloat(confidenceMatch[1]);
      // If value > 1, it's a percentage, divide by 100
      confidence = confValue > 1 ? confValue / 100 : confValue;
    }

    return {
      id: planId,
      filename,
      domain: domainMatch?.[1] || 'unknown',
      url: urlMatch?.[1] || '',
      confidence,
      createdAt: generatedMatch?.[1] || '',
      hasTrackingData
    };
  } catch (error) {
    console.error(`Error parsing plan ${filename}:`, error);
    return null;
  }
}

/**
 * GET /api/plans - List all plans
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const files = await fs.readdir(PLANS_DIR);
    const mdFiles = files.filter(f => f.endsWith('.md') && f !== 'README.md');

    const plans: PlanSummary[] = [];
    for (const file of mdFiles) {
      const plan = await parsePlanMetadata(file);
      if (plan) {
        plans.push(plan);
      }
    }

    // Sort by createdAt descending
    plans.sort((a, b) => {
      if (!a.createdAt) return 1;
      if (!b.createdAt) return -1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    res.json(plans);
  } catch (error) {
    console.error('Error listing plans:', error);
    res.status(500).json({ error: 'Failed to list plans' });
  }
});

/**
 * Find plan file by ID - searches filename first, then file content
 */
async function findPlanFileById(id: string): Promise<string | null> {
  const files = await fs.readdir(PLANS_DIR);
  const mdFiles = files.filter(f => f.endsWith('.md') && f !== 'README.md');

  // First try to find by filename match
  let planFile = mdFiles.find(f =>
    f.includes(id) || f.replace('.md', '') === id
  );

  if (planFile) return planFile;

  // If not found, search inside file contents for the Plan ID
  for (const file of mdFiles) {
    try {
      const filePath = path.join(PLANS_DIR, file);
      const content = await fs.readFile(filePath, 'utf-8');
      // Check if the Plan ID is in the file (first 500 chars should contain metadata)
      const header = content.substring(0, 500);
      if (header.includes(id)) {
        return file;
      }
    } catch {
      // Skip unreadable files
    }
  }

  return null;
}

/**
 * GET /api/plans/:id - Get specific plan content
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // Find the plan file by ID (filename or content)
    const planFile = await findPlanFileById(id);

    if (!planFile) {
      res.status(404).json({ error: 'Plan not found' });
      return;
    }

    const filePath = path.join(PLANS_DIR, planFile);
    const content = await fs.readFile(filePath, 'utf-8');
    const metadata = await parsePlanMetadata(planFile);

    // Try to load tracking data
    let trackingData = null;
    const trackingFile = planFile.replace('.md', '-llm-tracking.json');
    try {
      const trackingContent = await fs.readFile(path.join(PLANS_DIR, trackingFile), 'utf-8');
      trackingData = JSON.parse(trackingContent);
    } catch {
      // No tracking data
    }

    // Try to extract JSON plan from markdown
    let jsonPlan = null;
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      try {
        jsonPlan = JSON.parse(jsonMatch[1]);
      } catch {
        // Invalid JSON
      }
    }

    res.json({
      ...metadata,
      content,
      jsonPlan,
      trackingData
    });
  } catch (error) {
    console.error('Error getting plan:', error);
    res.status(500).json({ error: 'Failed to get plan' });
  }
});

/**
 * GET /api/plans/:id/raw - Get raw markdown content
 */
router.get('/:id/raw', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // Find the plan file by ID (filename or content)
    const planFile = await findPlanFileById(id);

    if (!planFile) {
      res.status(404).json({ error: 'Plan not found' });
      return;
    }

    const filePath = path.join(PLANS_DIR, planFile);
    const content = await fs.readFile(filePath, 'utf-8');

    res.type('text/markdown').send(content);
  } catch (error) {
    console.error('Error getting plan:', error);
    res.status(500).json({ error: 'Failed to get plan' });
  }
});

export default router;
