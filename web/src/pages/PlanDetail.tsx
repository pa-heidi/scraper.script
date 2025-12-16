import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Play, Loader2, Download, Code } from 'lucide-react';
import { plansApi, PlanDetail as PlanDetailType } from '../services/api';
import MarkdownViewer from '../components/MarkdownViewer';

export default function PlanDetail() {
  const { id } = useParams<{ id: string }>();
  const [plan, setPlan] = useState<PlanDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);

  useEffect(() => {
    async function loadPlan() {
      if (!id) return;
      try {
        setLoading(true);
        const data = await plansApi.get(id);
        setPlan(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load plan');
      } finally {
        setLoading(false);
      }
    }
    loadPlan();
  }, [id]);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  if (error || !plan) {
    return (
      <div className="p-8">
        <Link to="/plans" className="flex items-center gap-2 text-primary-600 mb-4">
          <ArrowLeft size={20} />
          Back to Plans
        </Link>
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg">
          {error || 'Plan not found'}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <Link to="/plans" className="flex items-center gap-2 text-primary-600 mb-4">
        <ArrowLeft size={20} />
        Back to Plans
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{plan.domain}</h1>
          <p className="text-gray-500">{plan.url}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowJson(!showJson)}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Code size={20} />
            {showJson ? 'Show Markdown' : 'Show JSON'}
          </button>
          <a
            href={`/api/plans/${encodeURIComponent(plan.filename)}/raw`}
            download={plan.filename}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Download size={20} />
            Download
          </a>
          <Link
            to={`/new-task?planId=${encodeURIComponent(plan.id)}&type=execute`}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            <Play size={20} />
            Execute Plan
          </Link>
        </div>
      </div>

      {/* Plan Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Confidence</p>
          <p className="text-xl font-bold text-primary-600">
            {(plan.confidence * 100).toFixed(1)}%
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Plan ID</p>
          <p className="text-sm font-mono truncate">{plan.id}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Created</p>
          <p className="text-sm">{plan.createdAt}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">LLM Tracking</p>
          <p className="text-sm">{plan.hasTrackingData ? 'Available' : 'Not available'}</p>
        </div>
      </div>

      {/* Plan Content */}
      <div className="bg-white rounded-lg shadow">
        {showJson && plan.jsonPlan ? (
          <div className="p-4">
            <h2 className="text-lg font-semibold mb-4">JSON Plan</h2>
            <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-auto max-h-[600px] text-sm">
              {JSON.stringify(plan.jsonPlan, null, 2)}
            </pre>
          </div>
        ) : (
          <div className="p-6">
            <MarkdownViewer content={plan.content} />
          </div>
        )}
      </div>

      {/* LLM Tracking Data */}
      {plan.trackingData && (
        <div className="mt-6 bg-white rounded-lg shadow">
          <div className="p-4 border-b">
            <h2 className="text-lg font-semibold">LLM Tracking Data</h2>
          </div>
          <div className="p-4">
            <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-auto max-h-[400px] text-sm">
              {JSON.stringify(plan.trackingData, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
