/**
 * The run route: pre-start, countdown and in-run share one screen so the transition into
 * the run is a state change, not a navigation. Opened with `?key=` for a run card on
 * Today, or with no params for a free run.
 */
import type { SessionMode } from '@fit/core';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { BackHandler, View } from 'react-native';
import { repo } from '@/data';
import { useFit } from '@/data/store';
import { haptic } from '@/lib/haptics';
import { usePalette } from '@/theme';
import { Sheet } from '@/ui/Sheet';
import { Button, T } from '@/ui/primitives';
import { discardRun, FREE_RUN, finishRun, prepareRun, useRun } from './engine';
import { InRun } from './InRun';
import { PreStart } from './PreStart';

const KEEP_AWAKE_TAG = 'run';

/** The workout's default mode. Treadmill records like Timer until treadmill distance lands (M3). */
const supported = (mode: SessionMode | undefined): SessionMode => mode ?? 'outdoor';

function setupFor(key: string | undefined) {
  const item = key ? useFit.getState().items[key] : undefined;
  if (!item) return { name: FREE_RUN, mode: 'outdoor' as const, items: [] };
  const workout = repo.workout(item.refId);
  return {
    name: workout?.name ?? item.title,
    mode: supported(workout?.defaultMode),
    items: workout?.items ?? [],
    workoutId: workout?.id,
    planWorkoutId: item.source.type === 'plan_workout' ? item.source.planWorkoutId : undefined,
  };
}

export function RunScreen() {
  const p = usePalette();
  const { key } = useLocalSearchParams<{ key?: string }>();
  const phase = useRun((r) => r.phase);
  const sessionId = useRun((r) => r.sessionId);
  const [ending, setEnding] = useState(false);
  const linked = useRun((r) => r.linked);
  const running = phase === 'active' || phase === 'paused';

  // Load the workout once. Coming back to a run in progress keeps it as it is.
  useEffect(() => {
    const r = useRun.getState().phase;
    if (r !== 'active' && r !== 'paused') prepareRun(setupFor(key));
  }, [key]);

  // The screen stays on for the whole run; the user can still turn it off with the power button.
  useEffect(() => {
    if (!running) return;
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    return () => void deactivateKeepAwake(KEEP_AWAKE_TAG);
  }, [running]);

  // A finished workout (last step done) goes straight to its summary.
  useEffect(() => {
    if (phase === 'finished' && sessionId) router.replace({ pathname: '/summary/[id]', params: { id: sessionId } });
  }, [phase, sessionId]);

  // Hardware back never drops a run: it asks first.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (useRun.getState().phase === 'active' || useRun.getState().phase === 'paused') {
        setEnding(true);
        return true;
      }
      void discardRun();
      return false;
    });
    return () => sub.remove();
  }, []);

  const close = () => {
    void discardRun();
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      {running ? <InRun onEnd={() => setEnding(true)} /> : <PreStart onClose={close} />}
      <EndSheet visible={ending} onClose={() => setEnding(false)} linked={linked} />
    </View>
  );
}

function EndSheet({ visible, onClose, linked }: { visible: boolean; onClose: () => void; linked: boolean }) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const close = () => {
    setConfirmDiscard(false);
    onClose();
  };
  return (
    <Sheet visible={visible} onClose={close} title="End run">
      <View style={{ gap: 10 }}>
        <T v="body" tone="secondary">
          {linked ? 'Save keeps the route and marks the workout done.' : 'Save keeps the route and the stats.'}
        </T>
        <Button
          label="Save run"
          onPress={async () => {
            haptic.success();
            close();
            const id = await finishRun();
            if (id) router.replace({ pathname: '/summary/[id]', params: { id } });
            else router.back();
          }}
        />
        <Button label="Keep going" kind="outline" onPress={close} />
        <Button
          label={confirmDiscard ? 'Tap again to discard' : 'Discard run'}
          kind="quiet"
          onPress={async () => {
            if (!confirmDiscard) {
              haptic.warn();
              setConfirmDiscard(true);
              return;
            }
            close();
            await discardRun();
            router.back();
          }}
        />
      </View>
    </Sheet>
  );
}
