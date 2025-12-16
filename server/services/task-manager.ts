/**
 * Task Manager Service
 * Handles spawning and tracking of scraper script execution
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { EventEmitter } from 'events';
import { TaskState, TaskInput, SSEMessage } from '../types';

const TASKS_DIR = path.join(process.cwd(), 'tasks');

export class TaskManager extends EventEmitter {
  private activeProcesses: Map<string, ChildProcess> = new Map();
  private taskStates: Map<string, TaskState> = new Map();

  constructor() {
    super();
    this.ensureTasksDir();
  }

  private async ensureTasksDir(): Promise<void> {
    try {
      await fs.mkdir(TASKS_DIR, { recursive: true });
    } catch (error) {
      console.error('Failed to create tasks directory:', error);
    }
  }

  /**
   * Generate a unique task ID
   */
  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get task file path
   */
  private getTaskFilePath(taskId: string): string {
    return path.join(TASKS_DIR, `${taskId}.json`);
  }

  /**
   * Save task state to file
   */
  private async saveTaskState(task: TaskState): Promise<void> {
    const filePath = this.getTaskFilePath(task.id);
    await fs.writeFile(filePath, JSON.stringify(task, null, 2));
    this.taskStates.set(task.id, task);
  }

  /**
   * Load task state from file
   */
  async getTaskState(taskId: string): Promise<TaskState | null> {
    // Check memory cache first
    if (this.taskStates.has(taskId)) {
      return this.taskStates.get(taskId)!;
    }

    // Load from file
    try {
      const filePath = this.getTaskFilePath(taskId);
      const content = await fs.readFile(filePath, 'utf-8');
      const task = JSON.parse(content) as TaskState;
      this.taskStates.set(taskId, task);
      return task;
    } catch {
      return null;
    }
  }

  /**
   * List all tasks
   */
  async listTasks(): Promise<TaskState[]> {
    try {
      const files = await fs.readdir(TASKS_DIR);
      const tasks: TaskState[] = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const content = await fs.readFile(path.join(TASKS_DIR, file), 'utf-8');
            tasks.push(JSON.parse(content));
          } catch {
            // Skip invalid files
          }
        }
      }

      // Sort by startedAt descending
      return tasks.sort((a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      );
    } catch {
      return [];
    }
  }

  /**
   * Emit SSE message for a task
   */
  private emitSSE(taskId: string, message: Omit<SSEMessage, 'timestamp'>): void {
    const sseMessage: SSEMessage = {
      ...message,
      timestamp: new Date().toISOString()
    };
    this.emit(`task:${taskId}`, sseMessage);
  }

  /**
   * Update task and emit SSE
   */
  private async updateTask(task: TaskState, updates: Partial<TaskState>): Promise<TaskState> {
    const updatedTask = { ...task, ...updates };
    await this.saveTaskState(updatedTask);

    if (updates.status) {
      this.emitSSE(task.id, { type: 'status', data: updates.status });
    }
    if (updates.progress !== undefined) {
      this.emitSSE(task.id, { type: 'progress', data: updates.progress });
    }

    return updatedTask;
  }

  /**
   * Add log entry to task
   */
  private async addLog(task: TaskState, log: string): Promise<void> {
    task.logs.push(log);
    await this.saveTaskState(task);
    this.emitSSE(task.id, { type: 'log', data: log });
  }

  /**
   * Start a plan generation task
   */
  async startGenerateTask(input: TaskInput): Promise<TaskState> {
    const taskId = this.generateTaskId();

    const task: TaskState = {
      id: taskId,
      type: 'generate',
      status: 'pending',
      progress: 0,
      logs: [],
      input,
      startedAt: new Date().toISOString()
    };

    await this.saveTaskState(task);
    await this.updateTask(task, { status: 'running', progress: 5 });
    await this.addLog(task, `Starting plan generation for URL: ${input.url}`);
    if (input.contentUrls && input.contentUrls.length > 0) {
      await this.addLog(task, `Sample content URLs: ${input.contentUrls.join(', ')}`);
    }

    // Spawn the generate-plan script in non-interactive mode
    const scriptPath = path.join(process.cwd(), 'dist', 'scripts', 'generate-plan-api.js');

    const args = [
      scriptPath,
      '--url', input.url || '',
      '--non-interactive'
    ];

    // Content URLs
    if (input.contentUrls && input.contentUrls.length > 0) {
      args.push('--content-urls', input.contentUrls.join(','));
    }

    // AI options
    if (input.options?.useLocalModel) {
      args.push('--use-local');
    }
    if (input.options?.priority) {
      args.push('--priority', input.options.priority);
    }
    if (input.options?.confidenceThreshold) {
      args.push('--confidence', input.options.confidenceThreshold.toString());
    }
    if (input.options?.maxTokens) {
      args.push('--max-tokens', input.options.maxTokens.toString());
    }
    if (input.options?.maxCost) {
      args.push('--max-cost', input.options.maxCost.toString());
    }

    // Pagination options
    if (input.options?.isPaginated) {
      args.push('--paginated');
    }
    if (input.options?.paginationUrl) {
      args.push('--pagination-url', input.options.paginationUrl);
    }

    // Report options
    if (input.options?.saveLlmTracking) {
      args.push('--save-llm-tracking');
    }
    if (input.options?.detailedReport) {
      args.push('--detailed-report');
    }

    await this.runProcess(task, 'node', args);
    return task;
  }

  /**
   * Start a plan execution task
   */
  async startExecuteTask(input: TaskInput): Promise<TaskState> {
    const taskId = this.generateTaskId();

    const task: TaskState = {
      id: taskId,
      type: 'execute',
      status: 'pending',
      progress: 0,
      logs: [],
      input,
      startedAt: new Date().toISOString()
    };

    await this.saveTaskState(task);
    await this.updateTask(task, { status: 'running', progress: 5 });
    await this.addLog(task, `Starting plan execution for plan: ${input.planId}`);

    const scriptPath = path.join(process.cwd(), 'dist', 'scripts', 'execute-plan.js');

    const args = [
      scriptPath,
      '--plan-id', input.planId || ''
    ];

    // Execution limits
    if (input.options?.maxPages) {
      args.push('--max-pages', input.options.maxPages.toString());
    }
    if (input.options?.maxItems) {
      args.push('--max-items', input.options.maxItems.toString());
    }
    if (input.options?.maxItemsPerPage) {
      args.push('--max-items-per-page', input.options.maxItemsPerPage.toString());
    }
    if (input.options?.timeout) {
      args.push('--timeout', input.options.timeout.toString());
    }

    // Execution options
    if (input.options?.testMode) {
      args.push('--test-mode');
    }
    if (input.options?.validateResults !== false) {
      args.push('--validate');
    }
    if (input.options?.retryFailedItems !== false) {
      args.push('--retry-failed');
    }

    await this.runProcess(task, 'node', args);
    return task;
  }

  /**
   * Run a child process and track its output
   */
  private async runProcess(task: TaskState, command: string, args: string[]): Promise<void> {
    const proc = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.activeProcesses.set(task.id, proc);

    let progressEstimate = 10;

    proc.stdout?.on('data', async (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        await this.addLog(task, line);

        // Parse progress from output
        if (line.includes('Initializing')) {
          progressEstimate = 15;
        } else if (line.includes('Analyzing') || line.includes('analysis')) {
          progressEstimate = 30;
        } else if (line.includes('Generating') || line.includes('generation')) {
          progressEstimate = 50;
        } else if (line.includes('Testing') || line.includes('test')) {
          progressEstimate = 70;
        } else if (line.includes('Saving') || line.includes('saved')) {
          progressEstimate = 90;
        } else if (line.includes('completed') || line.includes('success')) {
          progressEstimate = 95;
        }

        // Extract plan ID or result file from output
        const planIdMatch = line.match(/Plan ID:\s*(\S+)/i);
        if (planIdMatch) {
          task.output = { ...task.output, planId: planIdMatch[1] };
        }

        const planFileMatch = line.match(/saved to:\s*(.+\.md)/i);
        if (planFileMatch) {
          task.output = { ...task.output, planFile: planFileMatch[1] };
        }

        const resultFileMatch = line.match(/Results saved to:\s*(.+\.json)/i);
        if (resultFileMatch) {
          task.output = { ...task.output, resultFile: resultFileMatch[1] };
        }

        const itemsMatch = line.match(/Items extracted:\s*(\d+)/i);
        if (itemsMatch) {
          task.output = { ...task.output, itemsExtracted: parseInt(itemsMatch[1]) };
        }

        const pagesMatch = line.match(/Pages processed:\s*(\d+)/i);
        if (pagesMatch) {
          task.output = { ...task.output, pagesProcessed: parseInt(pagesMatch[1]) };
        }

        await this.updateTask(task, { progress: progressEstimate });
      }
    });

    proc.stderr?.on('data', async (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        await this.addLog(task, `[stderr] ${line}`);
      }
    });

    proc.on('close', async (code) => {
      this.activeProcesses.delete(task.id);

      if (code === 0) {
        await this.updateTask(task, {
          status: 'completed',
          progress: 100,
          completedAt: new Date().toISOString()
        });
        this.emitSSE(task.id, { type: 'complete', data: task.output });
      } else {
        await this.updateTask(task, {
          status: 'failed',
          error: `Process exited with code ${code}`,
          completedAt: new Date().toISOString()
        });
        this.emitSSE(task.id, { type: 'error', data: `Process exited with code ${code}` });
      }
    });

    proc.on('error', async (error) => {
      this.activeProcesses.delete(task.id);
      await this.updateTask(task, {
        status: 'failed',
        error: error.message,
        completedAt: new Date().toISOString()
      });
      this.emitSSE(task.id, { type: 'error', data: error.message });
    });
  }

  /**
   * Cancel a running task
   */
  async cancelTask(taskId: string): Promise<boolean> {
    const proc = this.activeProcesses.get(taskId);
    if (proc) {
      proc.kill('SIGTERM');
      this.activeProcesses.delete(taskId);

      const task = await this.getTaskState(taskId);
      if (task) {
        await this.updateTask(task, {
          status: 'failed',
          error: 'Task cancelled by user',
          completedAt: new Date().toISOString()
        });
      }
      return true;
    }
    return false;
  }

  /**
   * Delete a task (cancel if running, then remove)
   */
  async deleteTask(taskId: string): Promise<boolean> {
    // Cancel if running
    const proc = this.activeProcesses.get(taskId);
    if (proc) {
      proc.kill('SIGTERM');
      this.activeProcesses.delete(taskId);
    }

    // Remove from memory cache
    this.taskStates.delete(taskId);

    // Delete task file
    try {
      const filePath = this.getTaskFilePath(taskId);
      await fs.unlink(filePath);
      return true;
    } catch (error) {
      // File might not exist
      return false;
    }
  }
}

// Singleton instance
export const taskManager = new TaskManager();
