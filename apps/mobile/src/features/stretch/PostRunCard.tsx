/**
 * "Post-run stretch?" on the summary of a run that just ended (spec §10 Post-run
 * reminder). Starts the guided player with your post-run routine; it is not a scheduled
 * occurrence, so it never counts for adherence.
 */
import type { Routine } from '@fit/core';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useRoutines } from '@/data/store';
import { haptic } from '@/lib/haptics';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Button, IconButton, LaneTile, T } from '@/ui/primitives';
import { routineSub } from '@/features/library/labels';

/** Shown for runs that ended within this window, so old summaries stay quiet. */
const FRESH_MS = 2 * 60 * 60 * 1000;

/** Your own post-run routine first (a duplicate), then the starter. */
function postRunRoutine(routines: readonly Routine[]): Routine | undefined {
  const matches = routines.filter((r) => r.kind === 'stretch' && /post-run/i.test(r.name));
  return matches.find((r) => r.origin === 'custom') ?? matches[0];
}

export function PostRunCard({ endedAt }: { endedAt?: string }) {
  const s = useStyles();
  const p = usePalette();
  const routine = postRunRoutine(useRoutines());
  const [dismissed, setDismissed] = useState(false);
  const fresh = endedAt !== undefined && Date.now() - new Date(endedAt).getTime() < FRESH_MS;
  if (!routine || !fresh || dismissed) return null;
  return (
    <View style={s.card}>
      <View style={s.head}>
        <LaneTile lane="stretch" size={40} />
        <View style={{ flex: 1 }}>
          <T v="bodyStrong">Post-run stretch?</T>
          <T v="caption" tone="secondary">{`${routine.name}, ${routineSub(routine)}`}</T>
        </View>
        <IconButton
          label="Dismiss"
          size={32}
          bg="none"
          onPress={() => {
            haptic.tick();
            setDismissed(true);
          }}
        >
          <Icons.x size={16} color={p.textSecondary} />
        </IconButton>
      </View>
      <Button
        label="Start stretch"
        size="md"
        kind="outline"
        icon={<Icons.play size={16} color={p.text} />}
        onPress={() => {
          haptic.commit();
          router.push({ pathname: '/stretch/[id]', params: { id: routine.id } });
        }}
      />
    </View>
  );
}

const useStyles = createStyles((p) => ({
  card: { backgroundColor: p.surface, borderRadius: 16, padding: 14, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
}));
