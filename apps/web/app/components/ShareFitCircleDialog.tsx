'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Copy,
  Mail,
  CheckCircle,
  Loader2,
  Send,
  Plus,
  X,
  MessageCircle,
} from 'lucide-react';
import { toast } from 'sonner';

interface ShareFitCircleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fitCircleId: string;
  fitCircleName: string;
  inviteCode: string;
}

export function ShareFitCircleDialog({
  open,
  onOpenChange,
  fitCircleId,
  fitCircleName,
  inviteCode,
}: ShareFitCircleDialogProps) {
  const [copySuccess, setCopySuccess] = useState(false);
  const [messageCopySuccess, setMessageCopySuccess] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [emails, setEmails] = useState<string[]>(['']);
  const [emailErrors, setEmailErrors] = useState<Record<number, string>>({});

  // Use environment variable for production URLs, fallback to window.location.origin for development
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ||
    (typeof window !== 'undefined' ? window.location.origin : '');
  const inviteUrl = baseUrl ? `${baseUrl}/join/${inviteCode}` : '';

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopySuccess(true);
      toast.success('Invite link copied to clipboard!');
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (error) {
      toast.error('Failed to copy link');
    }
  };

  const generateShareMessage = () => {
    return `🏆 Join me on FitCircle!

I'm competing in "${fitCircleName}" and I want YOU to join!

💪 Let's crush our fitness goals together
🎯 Track progress & stay accountable
🏅 Compete on the leaderboard
🎉 Make staying healthy fun!

Join here:
${inviteUrl}

Let's do this! 🚀`;
  };

  const copyShareMessage = async () => {
    try {
      const message = generateShareMessage();
      await navigator.clipboard.writeText(message);
      setMessageCopySuccess(true);
      toast.success('Message copied! Ready to share on WhatsApp, Instagram, or anywhere!');
      setTimeout(() => setMessageCopySuccess(false), 3000);
    } catch (error) {
      toast.error('Failed to copy message');
    }
  };

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleEmailChange = (index: number, value: string) => {
    const newEmails = [...emails];
    newEmails[index] = value;
    setEmails(newEmails);

    // Clear error when user types
    if (emailErrors[index]) {
      const newErrors = { ...emailErrors };
      delete newErrors[index];
      setEmailErrors(newErrors);
    }
  };

  const addEmailField = () => {
    if (emails.length < 10) {
      setEmails([...emails, '']);
    }
  };

  const removeEmailField = (index: number) => {
    if (emails.length > 1) {
      const newEmails = emails.filter((_, i) => i !== index);
      setEmails(newEmails);

      // Clean up errors
      const newErrors = { ...emailErrors };
      delete newErrors[index];
      setEmailErrors(newErrors);
    }
  };

  const sendInviteEmails = async () => {
    // Validate all emails
    const validEmails: string[] = [];
    const newErrors: Record<number, string> = {};
    let hasErrors = false;

    emails.forEach((email, index) => {
      const trimmedEmail = email.trim();
      if (trimmedEmail) {
        if (!validateEmail(trimmedEmail)) {
          newErrors[index] = 'Invalid email address';
          hasErrors = true;
        } else {
          validEmails.push(trimmedEmail);
        }
      }
    });

    if (hasErrors) {
      setEmailErrors(newErrors);
      return;
    }

    if (validEmails.length === 0) {
      toast.error('Please enter at least one email address');
      return;
    }

    setIsSending(true);

    try {
      const response = await fetch(`/api/fitcircles/${fitCircleId}/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          emails: validEmails,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send invitations');
      }

      if (result.sent > 0) {
        toast.success(
          `Invitation${result.sent > 1 ? 's' : ''} sent to ${result.sent} ${
            result.sent > 1 ? 'people' : 'person'
          }!`
        );
      }

      if (result.failed > 0) {
        toast.error(`Failed to send ${result.failed} invitation(s)`);
      }

      // Reset form on success
      if (result.sent === validEmails.length) {
        setEmails(['']);
        onOpenChange(false);
      }
    } catch (error) {
      console.error('Error sending invitations:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to send invitations'
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-800 max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
            Share "{fitCircleName}"
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            Invite friends to join this FitCircle
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="link" className="w-full">
          <TabsList className="grid w-full grid-cols-3 bg-slate-800/50">
            <TabsTrigger value="link" className="data-[state=active]:bg-slate-700">
              <Copy className="h-4 w-4 mr-2" />
              Link
            </TabsTrigger>
            <TabsTrigger value="message" className="data-[state=active]:bg-slate-700">
              <MessageCircle className="h-4 w-4 mr-2" />
              Message
            </TabsTrigger>
            <TabsTrigger value="email" className="data-[state=active]:bg-slate-700">
              <Mail className="h-4 w-4 mr-2" />
              Email
            </TabsTrigger>
          </TabsList>

          {/* Copy Link Tab */}
          <TabsContent value="link" className="space-y-4 mt-4">
            <div className="space-y-3">
              <p className="text-sm text-gray-400">
                Share this link with anyone you want to invite:
              </p>

              <div className="flex gap-2">
                <Input
                  value={inviteUrl}
                  readOnly
                  className="bg-slate-800/50 border-slate-700 text-gray-300 font-mono text-sm"
                />
                <Button
                  onClick={copyToClipboard}
                  className={`${
                    copySuccess
                      ? 'bg-green-600 hover:bg-green-700'
                      : 'bg-indigo-600 hover:bg-indigo-700'
                  } transition-colors`}
                >
                  {copySuccess ? (
                    <>
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-2" />
                      Copy
                    </>
                  )}
                </Button>
              </div>

              <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-4">
                <p className="text-sm text-indigo-300">
                  💡 <strong>Pro tip:</strong> Anyone with this link can join your FitCircle.
                  Share it on social media, group chats, or anywhere you connect with friends!
                </p>
              </div>
            </div>
          </TabsContent>

          {/* Copy Message Tab */}
          <TabsContent value="message" className="space-y-4 mt-4">
            <div className="space-y-3">
              <p className="text-sm text-gray-400">
                Copy this pre-formatted message to share on WhatsApp, Instagram, or any social platform:
              </p>

              <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
                <pre className="text-sm text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">
                  {generateShareMessage()}
                </pre>
              </div>

              <Button
                onClick={copyShareMessage}
                className={`w-full ${
                  messageCopySuccess
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700'
                }`}
              >
                {messageCopySuccess ? (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Copied to Clipboard!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    Copy Message
                  </>
                )}
              </Button>

              <div className="grid grid-cols-2 gap-3 mt-4">
                <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 text-center">
                  <p className="text-xs text-green-400 font-semibold mb-1">📱 WhatsApp</p>
                  <p className="text-xs text-gray-400">Paste in chat or status</p>
                </div>
                <div className="bg-pink-500/10 border border-pink-500/20 rounded-lg p-3 text-center">
                  <p className="text-xs text-pink-400 font-semibold mb-1">📸 Instagram</p>
                  <p className="text-xs text-gray-400">Share in DM or story</p>
                </div>
              </div>

              <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4">
                <p className="text-sm text-purple-300">
                  💡 <strong>Tip:</strong> This message is ready to paste anywhere! Works great for group chats,
                  social media posts, or direct messages.
                </p>
              </div>
            </div>
          </TabsContent>

          {/* Send Email Tab */}
          <TabsContent value="email" className="space-y-4 mt-4">
            <div className="space-y-3">
              <p className="text-sm text-gray-400">
                Send personalized invitation emails:
              </p>

              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                {emails.map((email, index) => (
                  <div key={index} className="flex gap-2">
                    <div className="flex-1">
                      <Input
                        type="email"
                        placeholder={`friend${index + 1}@example.com`}
                        value={email}
                        onChange={(e) => handleEmailChange(index, e.target.value)}
                        className={`bg-slate-800/50 border-slate-700 ${
                          emailErrors[index] ? 'border-red-500' : ''
                        }`}
                      />
                      {emailErrors[index] && (
                        <p className="text-xs text-red-400 mt-1">
                          {emailErrors[index]}
                        </p>
                      )}
                    </div>
                    {emails.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeEmailField(index)}
                        className="text-gray-400 hover:text-red-400"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>

              {emails.length < 10 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addEmailField}
                  className="w-full border-slate-700 text-gray-300 hover:bg-slate-800"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add another email
                </Button>
              )}

              <Button
                onClick={sendInviteEmails}
                disabled={isSending}
                className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700"
              >
                {isSending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Send Invitation{emails.filter((e) => e.trim()).length > 1 ? 's' : ''}
                  </>
                )}
              </Button>

              <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4">
                <p className="text-sm text-purple-300">
                  📧 Each person will receive a beautifully designed email with details about
                  your FitCircle and a direct link to join.
                </p>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
