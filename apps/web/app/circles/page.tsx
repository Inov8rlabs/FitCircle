'use client';

import DashboardNav from '@/components/DashboardNav';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function CirclesPage() {
  return (
    <>
      <DashboardNav />
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        {/* Subtle circle background decoration */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-20 left-10 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl" />
          <div className="absolute top-40 right-20 w-[500px] h-[500px] bg-purple-500/5 rounded-full blur-3xl" />
          <div className="absolute bottom-20 left-1/3 w-[400px] h-[400px] bg-orange-500/5 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-12">
          <div className="mb-8">
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold bg-gradient-to-r from-indigo-300 via-fuchsia-400 to-orange-400 bg-clip-text text-transparent mb-2">
              FitCircles
            </h1>
            <p className="text-gray-400 text-sm sm:text-base">
              Join groups and compete with friends
            </p>
          </div>

          <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl">
            <CardContent className="p-12 text-center">
              <Users className="w-16 h-16 text-gray-600 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-white mb-2">Coming Soon</h3>
              <p className="text-gray-400 mb-6">FitCircles feature is under development</p>
              <Button className="bg-purple-600 hover:bg-purple-700 shadow-lg hover:shadow-purple-500/50">
                <Plus className="w-4 h-4 mr-2" />
                Create FitCircle
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
