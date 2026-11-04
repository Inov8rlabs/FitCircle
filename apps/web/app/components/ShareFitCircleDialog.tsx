'use client';

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
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AnalyticsEvents, analytics } from '@/lib/analytics';
import { invalidEmailsFrom } from '@/lib/referrals/invite-form';
import { EMAIL_COPY, validateEmailAddress } from '@/lib/validation/email-address';


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
  /** "Did you mean …?" per field (full corrected address). */
  const [emailSuggestions, setEmailSuggestions] = useState<Record<number, string>>({});

  // Use environment variable for production URLs, fallback to window.location.origin for development
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ||
    (typeof window !== 'undefined' ? window.location.origin : '');
  const inviteUrl = baseUrl ? `${baseUrl}/join/${inviteCode}` : '';

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      analytics.track(AnalyticsEvents.inviteShared({ method: 'copy_link' }));
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
      analytics.track(AnalyticsEvents.inviteShared({ method: 'copy_link' }));
      setMessageCopySuccess(true);
      toast.success('Message copied! Ready to share on WhatsApp, Instagram, or anywhere!');
      setTimeout(() => setMessageCopySuccess(false), 3000);
    } catch (error) {
      toast.error('Failed to copy message');
    }
  };

  const trackRejected = (reason: string | undefined, suggestionShown: boolean, checkedBy: 'client' | 'server') => {
    if (!reason || reason === 'empty') return;
    analytics.track(
      AnalyticsEvents.inviteEmailRejected({
        reason: reason as Parameters<typeof AnalyticsEvents.inviteEmailRejected>[0]['reason'],
        suggestion_shown: suggestionShown,
        checked_by: checkedBy,
        source: 'circle',
      })
    );
  };

  const setFieldResult = (index: number, error: string | null, suggestion?: string) => {
    setEmailErrors((prev) => {
      const next = { ...prev };
      if (error) next[index] = error;
      else delete next[index];
      return next;
    });
    setEmailSuggestions((prev) => {
      const next = { ...prev };
      if (suggestion) next[index] = suggestion;
      else delete next[index];
      return next;
    });
  };

  /** Blur: flag a typo (`yahoo.comr`) before they hit Send. */
  const checkEmailField = (index: number) => {
    const value = emails[index]?.trim();
    if (!value) return;
    const result = validateEmailAddress(value);
    if (!result.valid) {
      setFieldResult(index, EMAIL_COPY.invalid, result.suggestion);
      trackRejected(result.reason, Boolean(result.suggestion), 'client');
    }
  };

  const acceptSuggestion = (index: number) => {
    const suggestion = emailSuggestions[index];
    if (!suggestion) return;
    const reason = validateEmailAddress(emails[index]).reason;
    if (reason === 'unknown_tld' || reason === 'typo_likely') {
      analytics.track(AnalyticsEvents.inviteEmailSuggestionAccepted({ reason, source: 'circle' }));
    }
    const next = [...emails];
    next[index] = suggestion;
    setEmails(next);
    setFieldResult(index, null);
  };

  const handleEmailChange = (index: number, value: string) => {
    const newEmails = [...emails];
    newEmails[index] = value;
    setEmails(newEmails);

    // Clear error when user types
    if (emailSuggestions[index]) {
      const { [index]: _drop, ...rest } = emailSuggestions;
      setEmailSuggestions(rest);
    }
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

      // Indexes shift on removal: clear per-field errors/suggestions (re-checked on blur/send).
      setEmailErrors({});
      setEmailSuggestions({});
    }
  };

  const sendInviteEmails = async () => {
    // Validate all emails
    const validEmails: string[] = [];
    /** validEmails[i] came from emails[fieldIndex[i]] (to map server 422 indexes back). */
    const fieldIndex: number[] = [];
    const newErrors: Record<number, string> = {};
    const newSuggestions: Record<number, string> = {};
    let hasErrors = false;

    emails.forEach((email, index) => {
      const trimmedEmail = email.trim();
      if (trimmedEmail) {
        const result = validateEmailAddress(trimmedEmail);
        if (!result.valid) {
          newErrors[index] = EMAIL_COPY.invalid;
          if (result.suggestion) newSuggestions[index] = result.suggestion;
          trackRejected(result.reason, Boolean(result.suggestion), 'client');
          hasErrors = true;
        } else {
          validEmails.push(result.normalized);
          fieldIndex.push(index);
        }
      }
    });

    if (hasErrors) {
      setEmailErrors(newErrors);
      setEmailSuggestions(newSuggestions);
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

      const result = await response.json().catch(() => ({}));

      const invalid = response.status === 422 ? invalidEmailsFrom(result) : [];
      if (invalid.length) {
        const errors: Record<number, string> = {};
        const suggestions: Record<number, string> = {};
        for (const e of invalid) {
          const field = fieldIndex[e.index] ?? e.index;
          errors[field] = EMAIL_COPY.invalid;
          if (e.suggestion) suggestions[field] = e.suggestion;
          trackRejected(e.reason, Boolean(e.suggestion), 'server');
        }
        setEmailErrors(errors);
        setEmailSuggestions(suggestions);
        return;
      }

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send invitations');
      }

      if (result.sent > 0) {
        analytics.track(AnalyticsEvents.inviteShared({ method: 'email' }));
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
      <DialogContent className="bg-surface border-hairline max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold bg-gradient-indigo bg-clip-text text-transparent">
            Share &quot;{fitCircleName}&quot;
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            Invite friends to join this FitCircle
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="link" className="w-full">
          <TabsList className="grid w-full grid-cols-3 bg-white/5">
            <TabsTrigger value="link" className="data-[state=active]:bg-white/10">
              <Copy className="h-4 w-4 mr-2" />
              Link
            </TabsTrigger>
            <TabsTrigger value="message" className="data-[state=active]:bg-white/10">
              <MessageCircle className="h-4 w-4 mr-2" />
              Message
            </TabsTrigger>
            <TabsTrigger value="email" className="data-[state=active]:bg-white/10">
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
                  className="bg-white/5 border-glass text-gray-300 font-mono text-sm"
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

              <div className="bg-white/5 border border-glass rounded-lg p-4">
                <pre className="text-sm text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">
                  {generateShareMessage()}
                </pre>
              </div>

              <Button
                onClick={copyShareMessage}
                className={`w-full ${
                  messageCopySuccess
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-gradient-brand shadow-glow hover:brightness-110'
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
                        onBlur={() => checkEmailField(index)}
                        aria-invalid={Boolean(emailErrors[index])}
                        className={`bg-white/5 border-glass ${
                          emailErrors[index] ? 'border-red-500' : ''
                        }`}
                      />
                      {emailErrors[index] && (
                        <p role="alert" className="text-xs text-red-400 mt-1">
                          {emailErrors[index]}
                        </p>
                      )}
                      {emailSuggestions[index] && (
                        <button
                          type="button"
                          onClick={() => acceptSuggestion(index)}
                          data-testid={`email-suggestion-${index}`}
                          className="mt-1 inline-flex max-w-full items-center rounded-full border border-purple-500/50 bg-purple-500/15 px-3 py-1 text-xs text-purple-100 hover:bg-purple-500/25"
                        >
                          <span className="truncate">{EMAIL_COPY.didYouMean(emailSuggestions[index])}</span>
                        </button>
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
                  className="w-full border-glass text-gray-300 hover:bg-surface-raised"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add another email
                </Button>
              )}

              <Button
                onClick={sendInviteEmails}
                disabled={isSending || Object.keys(emailErrors).length > 0}
                className="w-full bg-gradient-brand shadow-glow hover:brightness-110"
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
