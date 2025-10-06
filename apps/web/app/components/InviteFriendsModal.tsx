'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Link,
  Mail,
  Copy,
  Check,
  Share2,
  MessageCircle,
  Send,
  QrCode,
  Users,
  Loader2,
  Smartphone,
  CheckCircle2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from 'sonner';
// import QRCode from 'qrcode'; // TODO: Install when workspace issue is resolved

interface InviteFriendsModalProps {
  isOpen: boolean;
  onClose: () => void;
  circleId: string;
  circleName: string;
  inviteCode: string;
}

export default function InviteFriendsModal({
  isOpen,
  onClose,
  circleId,
  circleName,
  inviteCode,
}: InviteFriendsModalProps) {
  const { user } = useAuthStore();
  const [copied, setCopied] = useState(false);
  const [emails, setEmails] = useState('');
  const [personalMessage, setPersonalMessage] = useState('');
  const [isSendingEmails, setIsSendingEmails] = useState(false);
  const [qrCode, setQrCode] = useState('');
  const [showQR, setShowQR] = useState(false);

  const inviteLink = `${window.location.origin}/join/${inviteCode}`;

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      toast.success('Invite link copied to clipboard!');
      setTimeout(() => setCopied(false), 3000);
    } catch (error) {
      toast.error('Failed to copy link');
    }
  };

  const generateQRCode = async () => {
    // TODO: Implement QR code generation when qrcode package is installed
    toast.info('QR code generation coming soon!');
    // if (!qrCode) {
    //   try {
    //     const dataUrl = await QRCode.toDataURL(inviteLink, {
    //       width: 256,
    //       margin: 2,
    //       color: {
    //         dark: '#1e293b',
    //         light: '#ffffff',
    //       },
    //     });
    //     setQrCode(dataUrl);
    //   } catch (error) {
    //     console.error('Error generating QR code:', error);
    //     toast.error('Failed to generate QR code');
    //   }
    // }
    // setShowQR(!showQR);
  };

  const shareViaWhatsApp = () => {
    const text = encodeURIComponent(
      `Hey! I'm starting a fitness challenge called "${circleName}". Join my FitCircle - we track progress % only, your actual data stays private!\n\n${inviteLink}`
    );
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  const shareViaEmail = () => {
    const subject = encodeURIComponent(`Join my FitCircle: ${circleName}`);
    const body = encodeURIComponent(
      `Hi there,\n\nI'm starting a fitness challenge called "${circleName}".\n\nWhat makes FitCircle different:\n✓ Your actual weight/metrics stay private\n✓ We only share progress % toward goals\n✓ Daily check-ins and encouragement\n✓ No judgment, just support!\n\nClick here to join: ${inviteLink}\n\nLet's do this together!\nYour friend`
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const shareViaSMS = () => {
    const text = encodeURIComponent(
      `Join my FitCircle "${circleName}"! We track progress % only, your data stays private. ${inviteLink}`
    );
    window.location.href = `sms:?body=${text}`;
  };

  const sendEmailInvites = async () => {
    if (!emails.trim()) {
      toast.error('Please enter at least one email address');
      return;
    }

    const emailList = emails
      .split(/[,;\s]+/)
      .map(e => e.trim())
      .filter(e => e.includes('@'));

    if (emailList.length === 0) {
      toast.error('Please enter valid email addresses');
      return;
    }

    setIsSendingEmails(true);
    try {
      // In a real implementation, this would call an API endpoint to send emails
      // For now, we'll simulate the process
      const { error } = await supabase
        .from('fitcircle_invites')
        .insert(
          emailList.map(email => ({
            circle_id: circleId,
            inviter_id: user?.id,
            invite_method: 'email',
            recipient_email: email,
            invite_code: inviteCode,
          })) as any
        );

      if (error) throw error;

      toast.success(`Invitations sent to ${emailList.length} recipient(s)`);
      setEmails('');
      setPersonalMessage('');
    } catch (error) {
      console.error('Error sending invites:', error);
      toast.error('Failed to send invitations');
    } finally {
      setIsSendingEmails(false);
    }
  };

  const shareButtons = [
    {
      label: 'WhatsApp',
      icon: MessageCircle,
      onClick: shareViaWhatsApp,
      color: 'hover:bg-green-500/20 hover:text-green-400',
    },
    {
      label: 'Email',
      icon: Mail,
      onClick: shareViaEmail,
      color: 'hover:bg-blue-500/20 hover:text-blue-400',
    },
    {
      label: 'SMS',
      icon: Smartphone,
      onClick: shareViaSMS,
      color: 'hover:bg-purple-500/20 hover:text-purple-400',
    },
    {
      label: 'QR Code',
      icon: QrCode,
      onClick: generateQRCode,
      color: 'hover:bg-orange-500/20 hover:text-orange-400',
    },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl bg-slate-900/95 border-slate-800 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">
            <span className="bg-gradient-to-r from-orange-400 to-purple-400 bg-clip-text text-transparent">
              Invite Friends to {circleName}
            </span>
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="link" className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-slate-800/50">
            <TabsTrigger
              value="link"
              className="data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-400"
            >
              <Link className="h-4 w-4 mr-2" />
              Share Link
            </TabsTrigger>
            <TabsTrigger
              value="email"
              className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-400"
            >
              <Mail className="h-4 w-4 mr-2" />
              Email Invite
            </TabsTrigger>
          </TabsList>

          <TabsContent value="link" className="space-y-6 mt-6">
            {/* Invite Link Display */}
            <div className="space-y-3">
              <Label className="text-white">Your Invite Link</Label>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Input
                    value={inviteLink}
                    readOnly
                    className="pr-10 bg-slate-800/50 border-slate-700 text-white font-mono text-sm"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2">
                    <AnimatePresence mode="wait">
                      {copied ? (
                        <motion.div
                          key="check"
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          exit={{ scale: 0 }}
                        >
                          <Check className="h-5 w-5 text-green-400" />
                        </motion.div>
                      ) : (
                        <motion.div key="copy">
                          <Copy className="h-5 w-5 text-gray-400" />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
                <Button
                  onClick={copyToClipboard}
                  className={`transition-all ${
                    copied
                      ? 'bg-green-600 hover:bg-green-700'
                      : 'bg-orange-600 hover:bg-orange-700'
                  }`}
                >
                  {copied ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-2" />
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
            </div>

            {/* Share Buttons */}
            <div className="space-y-3">
              <Label className="text-white">Quick Share</Label>
              <div className="grid grid-cols-2 gap-3">
                {shareButtons.map((button) => (
                  <motion.div key={button.label} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                    <Button
                      variant="outline"
                      className={`w-full border-slate-700 bg-slate-800/30 text-gray-300 transition-all ${button.color}`}
                      onClick={button.onClick}
                    >
                      <button.icon className="h-4 w-4 mr-2" />
                      {button.label}
                    </Button>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* QR Code Display */}
            <AnimatePresence>
              {showQR && qrCode && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <Card className="bg-white p-4 border-slate-700">
                    <CardContent className="flex flex-col items-center p-0">
                      <img src={qrCode} alt="QR Code" className="w-64 h-64" />
                      <p className="text-sm text-gray-600 mt-2 text-center">
                        Scan to join the FitCircle
                      </p>
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Privacy Note */}
            <div className="bg-gradient-to-br from-green-900/20 to-green-800/10 rounded-lg p-4 border border-green-500/30">
              <div className="flex items-start gap-3">
                <div className="p-1 bg-green-500/20 rounded-lg">
                  <CheckCircle2 className="h-4 w-4 text-green-400" />
                </div>
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium text-green-400">Privacy Protected</p>
                  <p className="text-xs text-gray-400">
                    Members who join will only see progress percentages, never actual metrics or personal data.
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="email" className="space-y-6 mt-6">
            {/* Email Input */}
            <div className="space-y-3">
              <Label htmlFor="emails" className="text-white">
                Email Addresses
              </Label>
              <Textarea
                id="emails"
                placeholder="Enter email addresses separated by commas&#10;e.g., friend1@email.com, friend2@email.com"
                value={emails}
                onChange={(e) => setEmails(e.target.value)}
                className="min-h-[100px] bg-slate-800/50 border-slate-700 text-white placeholder:text-gray-500"
              />
              <p className="text-xs text-gray-400">
                Separate multiple emails with commas or spaces
              </p>
            </div>

            {/* Personal Message */}
            <div className="space-y-3">
              <Label htmlFor="message" className="text-white">
                Personal Message <span className="text-gray-500">(optional)</span>
              </Label>
              <Textarea
                id="message"
                placeholder="Add a personal message to your invitation..."
                value={personalMessage}
                onChange={(e) => setPersonalMessage(e.target.value)}
                className="min-h-[80px] bg-slate-800/50 border-slate-700 text-white placeholder:text-gray-500"
                maxLength={200}
              />
              <p className="text-xs text-gray-400">
                {personalMessage.length}/200 characters
              </p>
            </div>

            {/* Email Preview */}
            <Card className="bg-slate-800/30 border-slate-700">
              <CardContent className="p-4">
                <p className="text-xs text-gray-400 mb-2">Email Preview:</p>
                <div className="space-y-2 text-sm text-gray-300">
                  <p className="font-medium text-white">Subject: Join my FitCircle: {circleName}</p>
                  <div className="text-xs space-y-1">
                    {personalMessage && (
                      <p className="italic text-gray-300">{personalMessage}</p>
                    )}
                    <p>I'm starting a fitness challenge called "{circleName}".</p>
                    <p>✓ Your actual weight/metrics stay private</p>
                    <p>✓ We only share progress % toward goals</p>
                    <p>Click here to join: {inviteLink}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Send Button */}
            <Button
              onClick={sendEmailInvites}
              disabled={isSendingEmails || !emails.trim()}
              className="w-full bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800"
            >
              {isSendingEmails ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending Invitations...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send Email Invitations
                </>
              )}
            </Button>
          </TabsContent>
        </Tabs>

        {/* Invited Members Count */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-800">
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Users className="h-4 w-4" />
            <span>Share this link with friends to grow your circle</span>
          </div>
          <Badge variant="secondary" className="bg-slate-800">
            Invite Code: {inviteCode}
          </Badge>
        </div>
      </DialogContent>
    </Dialog>
  );
}