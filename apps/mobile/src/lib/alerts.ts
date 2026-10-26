/**
 * Local notifications: the rest timer at 0 and routine reminders. A thin layer over
 * expo-notifications so callers never deal with channels or permissions.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const CHANNEL_ALERTS = 'alerts';
const CHANNEL_REMINDERS = 'reminders';

let ready: Promise<boolean> | undefined;

/** Channels once, and permission (Android 13+ asks; earlier versions grant it). */
function ensureReady(): Promise<boolean> {
  ready ??= (async () => {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL_ALERTS, { name: 'Timers', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 300, 120, 300] });
      await Notifications.setNotificationChannelAsync(CHANNEL_REMINDERS, { name: 'Reminders', importance: Notifications.AndroidImportance.DEFAULT });
    }
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    return (await Notifications.requestPermissionsAsync()).granted;
  })().catch(() => false);
  return ready;
}

// Shown in the foreground too (the rest timer banner covers the screen anyway).
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

/** One-off alert at a time, replacing any pending alert with the same id. */
export async function scheduleAlert(id: string, at: Date, title: string, body: string): Promise<void> {
  if (!(await ensureReady())) return;
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: { title, body },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL_ALERTS },
  });
}

export async function cancelAlert(id: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
}

/** Weekly reminder (weekday 1 = Monday) at hh:mm, replacing one with the same id. */
export async function scheduleWeekly(id: string, weekday: number, hour: number, minute: number, title: string, body: string): Promise<void> {
  if (!(await ensureReady())) return;
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: { title, body },
    // expo-notifications weekdays run 1 = Sunday to 7 = Saturday.
    trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: (weekday % 7) + 1, hour, minute, channelId: CHANNEL_REMINDERS },
  });
}

/** Ids of every scheduled notification, for syncing reminders. */
export async function scheduledIds(): Promise<string[]> {
  return (await Notifications.getAllScheduledNotificationsAsync()).map((n) => n.identifier);
}
