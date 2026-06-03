'use client';

import { Loader2, Send, Sparkles } from 'lucide-react';
import { useState } from 'react';

import { nutritionClient, type CoachAnswer } from '@/lib/api/nutrition-client';

interface NutritionCoachProps {
  circleId?: string;
}

/** Q&A box → /nutrition-coach. Always renders the server-provided disclaimer. */
export function NutritionCoach({ circleId }: NutritionCoachProps) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<CoachAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    const q = question.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await nutritionClient.askCoach(q, circleId);
      setAnswer(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not get an answer');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-800/60 bg-slate-900/60 p-4 backdrop-blur-xl">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-fuchsia-400" />
        <h3 className="text-base font-semibold text-white">Nutrition coach</h3>
      </div>

      <div className="flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
          placeholder="Ask a nutrition question…"
          className="flex-1 rounded-lg border border-slate-700/60 bg-slate-800/60 px-3 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="button"
          onClick={ask}
          disabled={loading || !question.trim()}
          aria-label="Ask"
          className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-indigo-600 to-fuchsia-600 px-4 text-white hover:from-indigo-700 hover:to-fuchsia-700 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-amber-300">{error}</p>}

      {answer && (
        <div className="mt-4 space-y-3">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-200">{answer.answer}</p>
          <p className="rounded-lg border border-slate-700/40 bg-slate-800/40 p-2.5 text-xs italic text-gray-400">
            {answer.disclaimer}
          </p>
        </div>
      )}
    </div>
  );
}
