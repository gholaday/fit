/**
 * Crash recovery on launch: a session still marked active means the app died mid-run (it
 * saves every 5 s). Offer to pick it up or to keep what was recorded.
 */
import type { ActiveSession } from '@fit/core';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { repo } from '@/data';
import { haptic } from '@/lib/haptics';
import { Sheet } from '@/ui/Sheet';
import { Button, T } from '@/ui/primitives';

// The engine (with the HR sensor and Health Connect sync behind it) loads only when a
// recovered run is resumed or saved, not on every launch.
const engine = () => import('./engine');

export function RecoveryPrompt() {
  const [active, setActive] = useState<ActiveSession>();
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // The root layout mounts once per launch, before any run can start, so an active
  // session here is always one the app died during.
  useEffect(() => {
    setActive(repo.activeSession());
  }, []);

  const close = () => {
    setActive(undefined);
    setConfirmDiscard(false);
  };

  return (
    <Sheet visible={active !== undefined} onClose={close} title="Resume run?">
      <View style={{ gap: 10 }}>
        <T v="body" tone="secondary">
          {active ? `${active.name} stopped recording when the app closed. Resume it, or save what was recorded.` : ''}
        </T>
        <Button
          label="Resume"
          onPress={() => {
            if (!active) return;
            haptic.commit();
            const items = active.workoutId ? (repo.workout(active.workoutId)?.items ?? []) : [];
            close();
            void engine().then((e) => {
              e.resumeRecovered(active, items);
              router.push('/run');
            });
          }}
        />
        <Button
          label="Save what was recorded"
          kind="outline"
          onPress={() => {
            if (!active) return;
            haptic.success();
            const id = active.id;
            close();
            void engine().then((e) => {
              e.saveRecovered(active);
              router.push({ pathname: '/summary/[id]', params: { id } });
            });
          }}
        />
        <Button
          label={confirmDiscard ? 'Tap again to discard' : 'Discard run'}
          kind="quiet"
          onPress={() => {
            if (!active) return;
            if (!confirmDiscard) {
              haptic.warn();
              setConfirmDiscard(true);
              return;
            }
            repo.discardSession(active.id);
            close();
          }}
        />
      </View>
    </Sheet>
  );
}
