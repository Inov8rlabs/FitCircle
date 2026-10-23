/**
 * Real FitCircle captures in public/landing (WebP). Sources:
 * - screen-*: App Store 6.9" listing frames (iOS app), cropped to the screen
 * - card-hydration: iOS Hydration card (snapshot-test render)
 * - notif-*: iOS Lock Screen notification captures (simulator)
 * - widgets / lock screen / live activity / standby / watch: real SwiftUI surface renders
 * - android-*: Android home screen with FitCircle widgets (emulator)
 * - wear-*: Wear OS app (emulator)
 * - web-dashboard: this web app's dashboard
 */
import type { Shot } from './Phone';

const s = (src: string, w: number, h: number, alt: string): Shot => ({ src: `/landing/${src}.webp`, w, h, alt });

export const SHOTS = {
  food: s('screen-food', 720, 1456, 'Food Log: today’s calories and meals grouped by day'),
  circle: s('screen-circle', 720, 1170, 'A circle: invite, chat, participants, days left, challenges and the food feed'),
  chat: s('screen-chat', 720, 1456, 'Circle chat: streak milestones post automatically'),
  streak: s('screen-streak', 720, 1456, 'Daily Streak: a 5 day streak and the last 7 days'),
  widgets: s('screen-widgets', 720, 1263, 'iPhone Home Screen with FitCircle widgets: steps, calories, today and the circle board'),
  lock: s('screen-lock', 720, 1263, 'iPhone Lock Screen with FitCircle widgets and a Live Activity'),
  hydration: s('card-hydration', 760, 706, 'Hydration card: 750 ml of 2 L, one-tap glass, bottle and large, and this week'),
  notifNudge: s('notif-nudge', 720, 692, 'Notification: Sam hasn’t checked in today, with Save their day and Send a nudge'),
  notifStreak: s('notif-streak', 720, 535, 'Notification: your streak is at risk, with Log a meal'),
  notifWater: s('notif-water', 720, 488, 'Notification: time for a glass, with +250 ml and +500 ml'),
  liveActivity: s('live-activity', 900, 336, 'Live Activity: Sam and Priya left to close the circle, with one-tap water'),
  standby: s('standby', 1200, 402, 'StandBy: circle ring, closed circle and water'),
  watchToday: s('watch-today', 416, 496, 'Apple Watch: 3 of 5 in today'),
  watchCircle: s('watch-circle', 416, 496, 'Apple Watch: who in the circle has checked in'),
  watchWater: s('watch-water', 416, 496, 'Apple Watch: log water'),
  watchFuel: s('watch-fuel', 416, 496, 'Apple Watch: calories and macros left'),
  wearToday: s('wear-today', 454, 454, 'Wear OS: today ring with steps, calories and water'),
  wearCircle: s('wear-circle', 454, 454, 'Wear OS: nudge or save a friend'),
  androidBoard: s('android-board', 600, 1031, 'Android circle board widget after a nudge and a save'),
  web: s('web-dashboard', 1280, 622, 'FitCircle on the web: the dashboard'),
} as const;
