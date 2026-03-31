'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChallengeTemplate, ChallengeCategory } from '@/lib/types/circle-challenge';
import { CHALLENGE_TEMPLATES } from '@/lib/data/challenge-templates';

interface ChallengeTemplateGridProps {
  onSelectTemplate: (template: ChallengeTemplate) => void;
  onStartFromScratch: () => void;
}

const CATEGORY_TABS: { id: string; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'strength', label: 'Strength' },
  { id: 'cardio', label: 'Cardio' },
  { id: 'flexibility', label: 'Flexibility' },
  { id: 'wellness', label: 'Wellness' },
  { id: 'custom', label: 'Custom' },
];

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: 'bg-green-500/20 text-green-400 border-green-500/30',
  intermediate: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  advanced: 'bg-red-500/20 text-red-400 border-red-500/30',
  variable: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
};

const CATEGORY_COLORS: Record<string, string> = {
  strength: 'from-red-500/20 to-orange-500/20',
  cardio: 'from-blue-500/20 to-cyan-500/20',
  flexibility: 'from-purple-500/20 to-pink-500/20',
  wellness: 'from-green-500/20 to-emerald-500/20',
  custom: 'from-indigo-500/20 to-violet-500/20',
};

export default function ChallengeTemplateGrid({
  onSelectTemplate,
  onStartFromScratch,
}: ChallengeTemplateGridProps) {
  const [activeCategory, setActiveCategory] = useState('all');

  const filteredTemplates =
    activeCategory === 'all'
      ? CHALLENGE_TEMPLATES.filter(t => t.id !== 'custom')
      : CHALLENGE_TEMPLATES.filter(t => t.category === activeCategory && t.id !== 'custom');

  return (
    <div className="space-y-4">
      {/* Category Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {CATEGORY_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveCategory(tab.id)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
              activeCategory === tab.id
                ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/25'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Template Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[400px] overflow-y-auto pr-1">
        {filteredTemplates.map((template, index) => (
          <motion.div
            key={template.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.03 }}
          >
            <Card
              className="cursor-pointer border-slate-700/50 bg-gradient-to-br hover:border-indigo-500/50 hover:shadow-lg hover:shadow-indigo-500/10 transition-all group"
              style={{
                backgroundImage: `linear-gradient(to bottom right, var(--tw-gradient-from), var(--tw-gradient-to))`,
              }}
              onClick={() => onSelectTemplate(template)}
            >
              <CardContent className={`p-4 bg-gradient-to-br ${CATEGORY_COLORS[template.category]} rounded-lg`}>
                <div className="flex items-start justify-between mb-2">
                  <span className="text-2xl">{template.icon}</span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${DIFFICULTY_COLORS[template.difficulty]}`}
                  >
                    {template.difficulty}
                  </Badge>
                </div>
                <h3 className="font-semibold text-white mb-1 group-hover:text-indigo-300 transition-colors">
                  {template.name}
                </h3>
                <p className="text-xs text-slate-400 line-clamp-2 mb-2">
                  {template.description}
                </p>
                <div className="flex items-center gap-2 text-[10px] text-slate-500">
                  <span>{template.recommended_duration_days}d</span>
                  <span>·</span>
                  <span>{template.goal_amount.toLocaleString()} {template.unit}</span>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Start from Scratch */}
      <button
        onClick={onStartFromScratch}
        className="w-full py-3 rounded-lg border border-dashed border-slate-600 text-slate-400 hover:border-indigo-500 hover:text-indigo-400 transition-all text-sm font-medium"
      >
        ⭐ Start from scratch — create a custom challenge
      </button>
    </div>
  );
}
