import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NotificationRequest {
  userId?: string;
  userIds?: string[];
  type: 'challenge_invite' | 'team_invite' | 'check_in_reminder' | 'achievement' | 'comment' | 'reaction' | 'leaderboard_update' | 'system';
  title: string;
  body: string;
  data?: Record<string, any>;
  channels?: ('push' | 'email' | 'sms' | 'in_app')[];
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  scheduledFor?: string;
  batchId?: string;
}

interface EmailPayload {
  to: string[];
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
}

interface PushPayload {
  userIds: string[];
  title: string;
  body: string;
  data?: Record<string, any>;
  priority?: string;
  ttl?: number;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request body
    const request: NotificationRequest = await req.json();

    // Validate request
    if (!request.title || !request.body) {
      throw new Error('Title and body are required');
    }

    const userIds = request.userIds || (request.userId ? [request.userId] : []);
    if (userIds.length === 0) {
      throw new Error('At least one userId is required');
    }

    // Default channels if not specified
    const channels = request.channels || ['in_app'];
    const priority = request.priority || 'normal';

    // Check if this is a scheduled notification
    if (request.scheduledFor) {
      const scheduledTime = new Date(request.scheduledFor);
      if (scheduledTime > new Date()) {
        // Store for later processing
        const { error } = await supabase
          .from('scheduled_notifications')
          .insert({
            user_ids: userIds,
            type: request.type,
            title: request.title,
            body: request.body,
            data: request.data,
            channels,
            priority,
            scheduled_for: request.scheduledFor,
            batch_id: request.batchId,
            status: 'pending',
          });

        if (error) throw error;

        return new Response(
          JSON.stringify({
            success: true,
            message: 'Notification scheduled',
            scheduledFor: request.scheduledFor,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
          }
        );
      }
    }

    // Get user details for notifications
    const { data: users, error: usersError } = await supabase
      .from('profiles')
      .select('id, email, display_name, phone_number, phone_verified, preferences')
      .in('id', userIds);

    if (usersError || !users) {
      throw new Error('Failed to fetch user details');
    }

    // Batch notifications by channel
    const batches = {
      push: [] as string[],
      email: [] as { email: string; name: string }[],
      sms: [] as { phone: string; name: string }[],
      inApp: [] as string[],
    };

    // Process each user's notification preferences
    for (const user of users) {
      const prefs = user.preferences as any || {};
      const notificationPrefs = prefs.notifications || {};

      // Check if user has opted in for this notification type
      if (notificationPrefs[request.type] === false) {
        continue;
      }

      // Check channel preferences
      if (channels.includes('push') && notificationPrefs.push !== false) {
        batches.push.push(user.id);
      }

      if (channels.includes('email') && notificationPrefs.email !== false && user.email) {
        batches.email.push({ email: user.email, name: user.display_name });
      }

      if (channels.includes('sms') && notificationPrefs.sms !== false && user.phone_number && user.phone_verified) {
        batches.sms.push({ phone: user.phone_number, name: user.display_name });
      }

      if (channels.includes('in_app')) {
        batches.inApp.push(user.id);
      }
    }

    // Send push notifications
    if (batches.push.length > 0) {
      await sendPushNotifications({
        userIds: batches.push,
        title: request.title,
        body: request.body,
        data: request.data,
        priority: priority === 'urgent' ? 'high' : priority,
      });
    }

    // Send email notifications
    if (batches.email.length > 0) {
      await sendEmailNotifications({
        recipients: batches.email,
        subject: request.title,
        body: request.body,
        type: request.type,
        data: request.data,
      });
    }

    // Send SMS notifications (only for urgent/high priority)
    if (batches.sms.length > 0 && ['urgent', 'high'].includes(priority)) {
      await sendSmsNotifications({
        recipients: batches.sms,
        body: `${request.title}: ${request.body}`,
        type: request.type,
      });
    }

    // Store in-app notifications
    if (batches.inApp.length > 0) {
      const inAppNotifications = batches.inApp.map(userId => ({
        user_id: userId,
        type: request.type,
        channel: 'in_app' as const,
        title: request.title,
        body: request.body,
        action_data: request.data,
        priority,
        sent_at: new Date().toISOString(),
      }));

      const { error: notifError } = await supabase
        .from('notifications')
        .insert(inAppNotifications);

      if (notifError) {
        console.error('Error storing in-app notifications:', notifError);
      }

      // Broadcast real-time update for in-app notifications
      for (const userId of batches.inApp) {
        await supabase.channel(`notifications:${userId}`)
          .send({
            type: 'broadcast',
            event: 'new_notification',
            payload: {
              type: request.type,
              title: request.title,
              body: request.body,
              data: request.data,
              priority,
              timestamp: new Date().toISOString(),
            },
          });
      }
    }

    // Update notification metrics
    await updateNotificationMetrics({
      type: request.type,
      channels,
      userCount: userIds.length,
      sentCount: batches.inApp.length + batches.push.length + batches.email.length + batches.sms.length,
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Notifications sent successfully',
        stats: {
          requested: userIds.length,
          sent: {
            push: batches.push.length,
            email: batches.email.length,
            sms: batches.sms.length,
            inApp: batches.inApp.length,
          },
        },
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error sending notifications:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});

async function sendPushNotifications(payload: PushPayload): Promise<void> {
  const oneSignalAppId = Deno.env.get('ONESIGNAL_APP_ID');
  const oneSignalApiKey = Deno.env.get('ONESIGNAL_REST_API_KEY');

  if (!oneSignalAppId || !oneSignalApiKey) {
    console.warn('OneSignal not configured, skipping push notifications');
    return;
  }

  try {
    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${oneSignalApiKey}`,
      },
      body: JSON.stringify({
        app_id: oneSignalAppId,
        include_external_user_ids: payload.userIds,
        headings: { en: payload.title },
        contents: { en: payload.body },
        data: payload.data,
        priority: payload.priority === 'high' ? 10 : 5,
        ttl: payload.ttl || 86400, // 24 hours
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Push notification failed: ${error}`);
    }

    const result = await response.json();
    console.log('Push notifications sent:', result);
  } catch (error) {
    console.error('Error sending push notifications:', error);
    throw error;
  }
}

async function sendEmailNotifications(params: {
  recipients: { email: string; name: string }[];
  subject: string;
  body: string;
  type: string;
  data?: Record<string, any>;
}): Promise<void> {
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'team@fitcircle.app';
  const replyTo = Deno.env.get('RESEND_REPLY_TO') || 'support@fitcircle.app';

  if (!resendApiKey) {
    console.warn('Resend not configured, skipping email notifications');
    return;
  }

  // Create email HTML template
  const emailHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${params.subject}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; }
          .content { background: white; padding: 30px; border: 1px solid #e5e7eb; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 6px; margin-top: 20px; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 14px; color: #6b7280; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; font-size: 24px;">FitCircle</h1>
            <p style="margin: 10px 0 0 0; opacity: 0.9;">${params.subject}</p>
          </div>
          <div class="content">
            <p style="font-size: 16px; line-height: 1.5; color: #374151;">
              ${params.body}
            </p>
            ${params.data?.actionUrl ? `
              <a href="${params.data.actionUrl}" class="button">View Details</a>
            ` : ''}
          </div>
          <div class="footer">
            <p>
              You received this email because you have notifications enabled for ${params.type.replace(/_/g, ' ')} on FitCircle.
              <br><br>
              <a href="https://fitcircle.app/settings/notifications" style="color: #667eea;">Manage notification preferences</a>
            </p>
          </div>
        </div>
      </body>
    </html>
  `;

  try {
    // Batch emails if there are many recipients
    const batchSize = 50;
    for (let i = 0; i < params.recipients.length; i += batchSize) {
      const batch = params.recipients.slice(i, i + batchSize);

      const response = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resendApiKey}`,
        },
        body: JSON.stringify(
          batch.map(recipient => ({
            from: fromEmail,
            to: recipient.email,
            reply_to: replyTo,
            subject: params.subject,
            html: emailHtml.replace('{{name}}', recipient.name),
          }))
        ),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Email notification failed: ${error}`);
      }

      const result = await response.json();
      console.log(`Email batch ${i / batchSize + 1} sent:`, result);

      // Rate limiting - wait between batches
      if (i + batchSize < params.recipients.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  } catch (error) {
    console.error('Error sending email notifications:', error);
    throw error;
  }
}

async function sendSmsNotifications(params: {
  recipients: { phone: string; name: string }[];
  body: string;
  type: string;
}): Promise<void> {
  // SMS integration would go here (Twilio, AWS SNS, etc.)
  // For now, we'll just log it
  console.log('SMS notifications would be sent to:', params.recipients.length, 'recipients');

  // Placeholder for SMS implementation
  // const twilioAccountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
  // const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN');
  // const twilioFromNumber = Deno.env.get('TWILIO_FROM_NUMBER');
}

async function updateNotificationMetrics(metrics: {
  type: string;
  channels: string[];
  userCount: number;
  sentCount: number;
}): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    await supabase.from('notification_metrics').insert({
      type: metrics.type,
      channels: metrics.channels,
      user_count: metrics.userCount,
      sent_count: metrics.sentCount,
      sent_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error updating notification metrics:', error);
  }
}