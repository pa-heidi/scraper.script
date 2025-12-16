/**
 * Results API Routes
 * Handle listing and retrieving execution results from the execution-results/ directory
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ResultSummary } from '../types';

const router = Router();
const RESULTS_DIR = path.join(process.cwd(), 'execution-results');

/**
 * Parse result metadata from JSON file
 */
async function parseResultMetadata(filename: string): Promise<ResultSummary | null> {
  try {
    const filePath = path.join(RESULTS_DIR, filename);
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    return {
      id: data.runId || filename.replace('.json', ''),
      filename,
      planId: data.planId || 'unknown',
      status: data.status || 'unknown',
      itemsExtracted: data.metrics?.itemsExtracted || data.extractedData?.length || 0,
      pagesProcessed: data.metrics?.pagesProcessed || 0,
      duration: data.metrics?.duration || 0,
      timestamp: data.timestamp || data.startTime || ''
    };
  } catch (error) {
    console.error(`Error parsing result ${filename}:`, error);
    return null;
  }
}

/**
 * GET /api/results - List all execution results
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const files = await fs.readdir(RESULTS_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    const results: ResultSummary[] = [];
    for (const file of jsonFiles) {
      const result = await parseResultMetadata(file);
      if (result) {
        results.push(result);
      }
    }

    // Sort by timestamp descending
    results.sort((a, b) => {
      if (!a.timestamp) return 1;
      if (!b.timestamp) return -1;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    res.json(results);
  } catch (error) {
    console.error('Error listing results:', error);
    res.status(500).json({ error: 'Failed to list results' });
  }
});

/**
 * GET /api/results/:id - Get specific result
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // Find the result file
    const files = await fs.readdir(RESULTS_DIR);
    const resultFile = files.find(f =>
      f.endsWith('.json') &&
      (f.includes(id) || f.replace('.json', '') === id)
    );

    if (!resultFile) {
      res.status(404).json({ error: 'Result not found' });
      return;
    }

    const filePath = path.join(RESULTS_DIR, resultFile);
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    res.json({
      ...data,
      filename: resultFile
    });
  } catch (error) {
    console.error('Error getting result:', error);
    res.status(500).json({ error: 'Failed to get result' });
  }
});

/**
 * GET /api/results/by-plan/:planId - Get results for a specific plan
 */
router.get('/by-plan/:planId', async (req: Request, res: Response) => {
  try {
    const { planId } = req.params;

    const files = await fs.readdir(RESULTS_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    const results: any[] = [];
    for (const file of jsonFiles) {
      try {
        const filePath = path.join(RESULTS_DIR, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(content);

        if (data.planId && data.planId.includes(planId)) {
          results.push({
            ...data,
            filename: file
          });
        }
      } catch {
        // Skip invalid files
      }
    }

    // Sort by timestamp descending
    results.sort((a, b) => {
      const aTime = a.timestamp || a.startTime || '';
      const bTime = b.timestamp || b.startTime || '';
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });

    res.json(results);
  } catch (error) {
    console.error('Error getting results for plan:', error);
    res.status(500).json({ error: 'Failed to get results' });
  }
});

export default router;
