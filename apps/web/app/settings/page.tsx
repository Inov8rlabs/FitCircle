'use client';

import DashboardNav from '@/components/DashboardNav';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Settings, User, Bell, Shield, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function SettingsPage() {
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

        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-12">
          <div className="mb-8">
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold bg-gradient-to-r from-indigo-300 via-fuchsia-400 to-orange-400 bg-clip-text text-transparent mb-2">
              Settings
            </h1>
            <p className="text-gray-400 text-sm sm:text-base">
              Manage your account and preferences
            </p>
          </div>

          <div className="space-y-4">
            {[
              { icon: User, title: 'Profile', description: 'Update your personal information', color: 'text-indigo-400' },
              { icon: Bell, title: 'Notifications', description: 'Manage notification preferences', color: 'text-purple-400' },
              { icon: Shield, title: 'Privacy & Security', description: 'Control your privacy settings', color: 'text-orange-400' },
              { icon: Palette, title: 'Appearance', description: 'Customize your experience', color: 'text-green-400' },
            ].map((item) => (
              <Card key={item.title} className="bg-slate-900/50 border-slate-800 backdrop-blur-xl hover:border-slate-700 transition-colors cursor-pointer">
                <CardHeader>
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-lg bg-slate-800 flex items-center justify-center ${item.color}`}>
                      <item.icon className="w-6 h-6" />
                    </div>
                    <div className="flex-1">
                      <CardTitle className="text-white text-lg">{item.title}</CardTitle>
                      <CardDescription className="text-gray-400">{item.description}</CardDescription>
                    </div>
                    <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
