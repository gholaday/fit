import { Redirect } from 'expo-router';
import { actions } from '@/data/store';

export function SetupScreen() {
  actions.updateSettings({ onboarded: true });
  return <Redirect href="/" />;
}
