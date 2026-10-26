/**
 * What recording needs from Android (spec §5 "Android requirements"), read and requested in
 * one place for the first-run flow and the Diagnostics screen.
 */
import * as Battery from 'expo-battery';
import * as Device from 'expo-device';
import * as IntentLauncher from 'expo-intent-launcher';
import { Location, LocationAccuracy } from 'expo-location/next';
import { Linking } from 'react-native';

const PACKAGE = 'com.gholaday.fit';

export interface RecordingAccess {
  /** Precise location while using the app. Required for Outdoor. */
  location: 'granted' | 'approximate' | 'denied' | 'blocked';
  /** "Allow all the time". */
  background: boolean;
  notifications: boolean;
  /** True when Android may stop the app in the background (no exemption). */
  batteryRestricted: boolean;
  servicesOn: boolean;
}

export async function readAccess(): Promise<RecordingAccess> {
  const [fg, bg, notif, restricted, servicesOn] = await Promise.all([
    Location.getForegroundPermissions(),
    Location.getBackgroundPermissions(),
    Location.getNotificationPermissions(),
    Battery.isBatteryOptimizationEnabledAsync().catch(() => false),
    Promise.resolve(Location.hasLocationServicesEnabled()),
  ]);
  const location = fg.granted ? (fg.accuracy === LocationAccuracy.REDUCED ? 'approximate' : 'granted') : fg.canAskAgain ? 'denied' : 'blocked';
  return { location, background: bg.granted, notifications: notif.granted, batteryRestricted: restricted, servicesOn };
}

/** Everything a run with the screen off depends on is in place. */
export const accessComplete = (a: RecordingAccess) => a.location === 'granted' && a.background && a.notifications && !a.batteryRestricted;

export async function requestLocation(): Promise<boolean> {
  return (await Location.requestForegroundPermissions()).granted;
}

export async function requestBackground(): Promise<boolean> {
  return (await Location.requestBackgroundPermissions()).granted;
}

export async function requestNotifications(): Promise<boolean> {
  return (await Location.requestNotificationPermissions()).granted;
}

/** Opens the system "Stop optimizing battery usage?" dialog for this app. */
export async function requestBatteryExemption(): Promise<void> {
  try {
    await IntentLauncher.startActivityAsync('android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', { data: `package:${PACKAGE}` });
  } catch {
    await IntentLauncher.startActivityAsync('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
  }
}

export const openAppSettings = () => Linking.openSettings();

/** Samsung puts apps to sleep on its own schedule; it needs a second exemption (spec §5). */
export const isSamsung = () => (Device.manufacturer ?? '').toLowerCase() === 'samsung';
