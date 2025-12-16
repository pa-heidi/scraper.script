/**
 * Tasks API Routes
 * Handle task creation, listing, and SSE streaming
 */

import { Router, Request, Response } from 'express';
import { taskManager } from '../services/task-manager';
import { SSEMessage } from '../types';

const router = Router();

/**
 * GET /api/tasks - List all tasks
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const tasks = await taskManager.listTasks();
    res.json(tasks);
  } catch (error) {
    console.error('Error listing tasks:', error);
    res.status(500).json({ error: 'Failed to list tasks' });
  }
});

/**
 * GET /api/tasks/:id - Get specific task
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const task = await taskManager.getTaskState(id);

    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    res.json(task);
  } catch (error) {
    console.error('Error getting task:', error);
    res.status(500).json({ error: 'Failed to get task' });
  }
});

/**
 * POST /api/tasks/generate - Start a plan generation task
 */
router.post('/generate', async (req: Request, res: Response): Promise<void> => {
  try {
    const { url, contentUrls, options } = req.body;

    if (!url) {
      res.status(400).json({ error: 'URL is required' });
      return;
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      res.status(400).json({ error: 'Invalid URL format' });
      return;
    }

    const task = await taskManager.startGenerateTask({ url, contentUrls, options });
    res.status(201).json(task);
  } catch (error) {
    console.error('Error starting generate task:', error);
    res.status(500).json({ error: 'Failed to start task' });
  }
});

/**
 * POST /api/tasks/execute - Start a plan execution task
 */
router.post('/execute', async (req: Request, res: Response): Promise<void> => {
  try {
    const { planId, options } = req.body;

    if (!planId) {
      res.status(400).json({ error: 'Plan ID is required' });
      return;
    }

    const task = await taskManager.startExecuteTask({ planId, options });
    res.status(201).json(task);
  } catch (error) {
    console.error('Error starting execute task:', error);
    res.status(500).json({ error: 'Failed to start task' });
  }
});

/**
 * POST /api/tasks/:id/cancel - Cancel a running task
 */
router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const cancelled = await taskManager.cancelTask(id);

    if (cancelled) {
      res.json({ message: 'Task cancelled' });
    } else {
      res.status(404).json({ error: 'Task not found or not running' });
    }
  } catch (error) {
    console.error('Error cancelling task:', error);
    res.status(500).json({ error: 'Failed to cancel task' });
  }
});

/**
 * DELETE /api/tasks/:id - Delete a task
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = await taskManager.deleteTask(id);

    if (deleted) {
      res.json({ message: 'Task deleted' });
    } else {
      res.status(404).json({ error: 'Task not found' });
    }
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

/**
 * GET /api/tasks/:id/stream - SSE endpoint for task progress
 */
router.get('/:id/stream', async (req: Request, res: Response) => {
  const { id } = req.params;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Send initial task state
  const task = await taskManager.getTaskState(id);
  if (!task) {
    res.write(`data: ${JSON.stringify({ type: 'error', data: 'Task not found' })}\n\n`);
    res.end();
    return;
  }

  // Send current state
  res.write(`data: ${JSON.stringify({ type: 'init', data: task })}\n\n`);

  // If task is already completed, send complete and close
  if (task.status === 'completed' || task.status === 'failed') {
    res.write(`data: ${JSON.stringify({ type: task.status === 'completed' ? 'complete' : 'error', data: task.output || task.error })}\n\n`);
    res.end();
    return;
  }

  // Listen for task updates
  const listener = (message: SSEMessage) => {
    res.write(`data: ${JSON.stringify(message)}\n\n`);

    // Close connection on complete or error
    if (message.type === 'complete' || message.type === 'error') {
      setTimeout(() => res.end(), 100);
    }
  };

  taskManager.on(`task:${id}`, listener);

  // Cleanup on client disconnect
  req.on('close', () => {
    taskManager.off(`task:${id}`, listener);
  });

  // Send heartbeat every 30 seconds to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
  });
});

export default router;
