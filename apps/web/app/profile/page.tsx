'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardNav from '@/components/DashboardNav';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  User,
  Mail,
  Calendar,
  Edit,
  Settings,
  LogOut,
  Bell,
  Shield,
  Palette,
  Save,
  X,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from 'sonner';

export default function ProfilePage() {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: user?.name || '',
    email: user?.email || '',
    username: user?.username || '',
  });

  const handleSave = async () => {
    // TODO: Implement profile update
    toast.success('Profile updated successfully!');
    setIsEditing(false);
  };

  const handleLogout = async () => {
    await logout();
    router.push('/');
  };

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
              Profile
            </h1>
            <p className="text-gray-400 text-sm sm:text-base">
              Manage your account settings and preferences
            </p>
          </div>

          <div className="space-y-6">
            {/* Profile Card */}
            <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl">
              <CardHeader className="border-b border-slate-800">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-20 h-20 rounded-full bg-gradient-to-r from-indigo-500 to-purple-600 flex items-center justify-center">
                      <span className="text-white font-bold text-3xl">
                        {user?.name?.[0]?.toUpperCase() || 'U'}
                      </span>
                    </div>
                    <div>
                      <CardTitle className="text-white text-2xl">{user?.name || 'User'}</CardTitle>
                      <CardDescription className="text-gray-400">{user?.email}</CardDescription>
                    </div>
                  </div>
                  {!isEditing && (
                    <Button
                      variant="outline"
                      onClick={() => setIsEditing(true)}
                      className="bg-slate-900/50 border-slate-700 text-gray-300 hover:bg-slate-800 hover:text-white"
                    >
                      <Edit className="w-4 h-4 mr-2" />
                      Edit Profile
                    </Button>
                  )}
                </div>
              </CardHeader>

              <CardContent className="pt-6">
                {isEditing ? (
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="name" className="text-gray-300">Full Name</Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="mt-1.5"
                      />
                    </div>
                    <div>
                      <Label htmlFor="username" className="text-gray-300">Username</Label>
                      <Input
                        id="username"
                        value={formData.username}
                        onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                        className="mt-1.5"
                      />
                    </div>
                    <div>
                      <Label htmlFor="email" className="text-gray-300">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="mt-1.5"
                      />
                    </div>
                    <div className="flex gap-3 pt-4">
                      <Button
                        onClick={handleSave}
                        className="bg-purple-600 hover:bg-purple-700 shadow-lg hover:shadow-purple-500/50"
                      >
                        <Save className="w-4 h-4 mr-2" />
                        Save Changes
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setIsEditing(false)}
                        className="bg-slate-900/50 border-slate-700 text-gray-300 hover:bg-slate-800"
                      >
                        <X className="w-4 h-4 mr-2" />
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 text-gray-300">
                      <User className="w-5 h-5 text-gray-500" />
                      <div>
                        <p className="text-xs text-gray-500">Full Name</p>
                        <p className="text-sm font-medium">{user?.name || 'Not set'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-gray-300">
                      <Mail className="w-5 h-5 text-gray-500" />
                      <div>
                        <p className="text-xs text-gray-500">Email</p>
                        <p className="text-sm font-medium">{user?.email || 'Not set'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-gray-300">
                      <Calendar className="w-5 h-5 text-gray-500" />
                      <div>
                        <p className="text-xs text-gray-500">Member Since</p>
                        <p className="text-sm font-medium">
                          {user?.created_at ? new Date(user.created_at).toLocaleDateString() : 'Unknown'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Settings Sections */}
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-white">Settings</h2>

              {[
                { icon: Bell, title: 'Notifications', description: 'Manage notification preferences', color: 'text-indigo-400', href: '/settings/notifications' },
                { icon: Shield, title: 'Privacy & Security', description: 'Control your privacy settings', color: 'text-purple-400', href: '/settings/privacy' },
                { icon: Palette, title: 'Appearance', description: 'Customize your experience', color: 'text-orange-400', href: '/settings/appearance' },
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

            {/* Logout Section */}
            <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl border-red-900/20">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg bg-red-500/10 flex items-center justify-center text-red-400">
                      <LogOut className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-white font-semibold">Sign Out</h3>
                      <p className="text-sm text-gray-400">Sign out of your account</p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={handleLogout}
                    className="bg-red-500/10 border-red-900/30 text-red-400 hover:bg-red-500/20 hover:text-red-300"
                  >
                    <LogOut className="w-4 h-4 mr-2" />
                    Logout
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
