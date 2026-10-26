import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/tabs';
import { useSettings } from '@/data/store';
import { usePalette } from '@/theme';
import { TabBar } from '@/ui/TabBar';

export default function TabsLayout() {
  const p = usePalette();
  const onboarded = useSettings().onboarded;
  if (!onboarded) return <Redirect href="/setup" />;
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false, lazy: true, animation: 'shift', sceneStyle: { backgroundColor: p.bg } }}>
      <Tabs.Screen name="index" options={{ title: 'Today' }} />
      <Tabs.Screen name="plan" options={{ title: 'Plan' }} />
      <Tabs.Screen name="library" options={{ title: 'Library' }} />
      <Tabs.Screen name="stats" options={{ title: 'Stats' }} />
    </Tabs>
  );
}
