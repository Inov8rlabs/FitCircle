
import { NextRequest, NextResponse } from 'next/server';
import { NotificationService } from '../../lib/services/notification-service';

export async function POST(request: NextRequest) {
    try {
        const { email, type, title, body } = await request.json();

        if (!email) {
            return NextResponse.json({ error: 'Email is required' }, { status: 400 });
        }

        const result = await NotificationService.sendEmailNotification({
            userId: 'test-user-id',
            userEmail: email,
            userName: 'Test User',
            type: type || 'test_notification',
            title: title || 'Test Notification',
            body: body || 'This is a test notification from the new backend service.',
            actionUrl: 'https://fitcircle.app',
            actionText: 'Go to App',
        });

        return NextResponse.json({ success: result });
    } catch (error) {
        console.error('Test email error:', error);
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
}
