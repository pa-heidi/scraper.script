import { useState, useEffect, useCallback, useRef } from 'react';
import { TaskState } from '../services/api';

export interface SSEMessage {
  type: 'init' | 'status' | 'progress' | 'log' | 'complete' | 'error';
  data: any;
  timestamp: string;
}

export interface UseSSEResult {
  task: TaskState | null;
  logs: string[];
  isConnected: boolean;
  error: string | null;
  reconnect: () => void;
}

export function useSSE(taskId: string | null): UseSSEResult {
  const [task, setTask] = useState<TaskState | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  const connect = useCallback(() => {
    if (!taskId) return;

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource(`/api/tasks/${encodeURIComponent(taskId)}/stream`);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsConnected(true);
      setError(null);
    };

    eventSource.onmessage = (event) => {
      try {
        const message: SSEMessage = JSON.parse(event.data);

        switch (message.type) {
          case 'init':
            setTask(message.data);
            setLogs(message.data.logs || []);
            break;
          case 'status':
            setTask(prev => prev ? { ...prev, status: message.data } : null);
            break;
          case 'progress':
            setTask(prev => prev ? { ...prev, progress: message.data } : null);
            break;
          case 'log':
            setLogs(prev => [...prev, message.data]);
            break;
          case 'complete':
            setTask(prev => prev ? { ...prev, status: 'completed', output: message.data } : null);
            eventSource.close();
            setIsConnected(false);
            break;
          case 'error':
            setTask(prev => prev ? { ...prev, status: 'failed', error: message.data } : null);
            setError(message.data);
            eventSource.close();
            setIsConnected(false);
            break;
        }
      } catch (err) {
        console.error('Failed to parse SSE message:', err);
      }
    };

    eventSource.onerror = () => {
      setIsConnected(false);
      eventSource.close();

      // Only reconnect if task is still running
      if (task?.status === 'running' || task?.status === 'pending') {
        reconnectTimeoutRef.current = window.setTimeout(() => {
          connect();
        }, 3000);
      }
    };
  }, [taskId, task?.status]);

  const reconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    connect();
  }, [connect]);

  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { task, logs, isConnected, error, reconnect };
}
