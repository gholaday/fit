/**
 * Guided stretch player (spec §10, mockup Stretch). Runs on the same timestamp-driven
 * player as runs: two-sided moves are Left, "Switch sides", Right, with a short "Next"
 * between moves. The countdown ring animates on the UI thread from the step's remaining
 * time; React re-renders once a second at most. Voice cues go through the run speaker
 * (audio focus ducks music) and the screen stays on.
 */
import { createPlayer, firstStepOfItem, formatClock, playerReducer, type PlayerState, type RoutineDetail, snapshot, type Step, stretchSteps } from '@fit/core';
import { Image } from 'expo-image';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, TextInput, View } from 'react-native';
import Animated, { cancelAnimation, Easing, FadeIn, useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { repo } from '@/data';
import { actions, showSnack, useSettings } from '@/data/store';
import { haptic } from '@/lib/haptics';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Sheet } from '@/ui/Sheet';
import { Button, IconButton, T } from '@/ui/primitives';
import { detailFor, thumbFor } from '@/features/library/catalog';
import { services } from '@/features/run/services';

const KEEP_AWAKE_TAG = 'stretch';
const RING = 220;
const STROKE = 10;
const R = (RING - STROKE) / 2;
const CIRC = 2 * Math.PI * R;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface Move {
  name: string;
  instruction: string;
  image?: number;
  holdS: number;
  sides: 'both' | 'none';
}

/** Which move a step belongs to, from its id ("3:left"). */
const itemOf = (step: Step): number => Number(step.id.split(':')[0]);

export function StretchScreen() {
  const { id, key } = useLocalSearchParams<{ id: string; key?: string }>();
  const [routine] = useState(() => repo.routine(id));
  if (!routine || routine.items.kind !== 'stretch' || routine.items.items.length === 0) return null;
  return <Player routine={routine} scheduleKey={key} />;
}

function Player({ routine, scheduleKey }: { routine: RoutineDetail; scheduleKey?: string }) {
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const voice = useSettings().voice;
  const moves = useMemo<Move[]>(() => {
    if (routine.items.kind !== 'stretch') return [];
    return routine.items.items.map((item) => {
      const ex = repo.exercise(item.exerciseId);
      const key = ex?.imageKeys[0];
      return {
        name: ex?.name ?? 'Stretch',
        // One or two lines on the card; the full steps are on the exercise page.
        instruction: (ex?.instructions ?? []).slice(0, 1).join(' '),
        image: key ? (detailFor(key) ?? thumbFor(ex?.slug)) : undefined,
        holdS: item.holdS,
        sides: item.sides,
      };
    });
  }, [routine]);

  const player = useRef<PlayerState>(createPlayer(routine.items.kind === 'stretch' ? stretchSteps(routine.items) : []));
  const [view, setView] = useState(() => snapshot(player.current, Date.now(), 0));
  const [overview, setOverview] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [finishedAt, setFinishedAt] = useState<Date>();
  const progress = useSharedValue(0);
  const startedAt = useRef(new Date());
  const lastCue = useRef('');

  const speak = (text: string) => {
    if (voice) services.speaker?.speak(text);
  };

  /** Animate the ring from where the step is to empty, over the time left. */
  const drive = (st: PlayerState, t: number) => {
    const snap = snapshot(st, t, 0);
    cancelAnimation(progress);
    progress.value = snap.stepProgress ?? 0;
    if (st.status === 'active' && snap.stepRemainingMs !== undefined) progress.value = withTiming(1, { duration: snap.stepRemainingMs, easing: Easing.linear });
  };

  /** Cues on entering a step, and "10 seconds" near the end of long holds. */
  const cue = (st: PlayerState, t: number) => {
    const snap = snapshot(st, t, 0);
    const step = snap.step;
    const move = moves[itemOf(step)];
    const enter = `${snap.stepIdx}`;
    if (lastCue.current !== enter && lastCue.current !== `${enter}:10`) {
      lastCue.current = enter;
      haptic.lift();
      if (step.label === 'Switch sides') speak('Switch sides');
      else if (step.label === 'Next') speak(`Next, ${moves[itemOf(step) + 1]?.name ?? ''}`);
      else if (move) speak(step.label ? `${move.name}. ${step.label} side.` : `${move.name}.`);
    }
    if (step.activity === 'stretch' && snap.stepRemainingMs !== undefined && step.duration.type === 'time' && step.duration.seconds >= 20 && snap.stepRemainingMs <= 10_000 && lastCue.current === enter) {
      lastCue.current = `${enter}:10`;
      speak('10 seconds');
    }
  };

  const apply = (ev: Parameters<typeof playerReducer>[1]) => {
    const t = ev.t;
    const before = player.current.stepIdx;
    player.current = playerReducer(player.current, ev);
    if (player.current.status === 'finished') return done(t);
    if (player.current.stepIdx !== before || ev.type !== 'tick') drive(player.current, t);
    cue(player.current, t);
    setView(snapshot(player.current, t, 0));
  };

  const done = (t: number) => {
    cancelAnimation(progress);
    progress.value = 1;
    speak('Stretch complete');
    haptic.success();
    setFinishedAt(new Date(t));
  };

  /** The leave sheet holds the clock; Keep going picks up where it was. */
  const pausedForLeave = useRef(false);
  const askLeave = () => {
    pausedForLeave.current = player.current.status === 'active';
    if (pausedForLeave.current) {
      apply({ type: 'pause', t: Date.now() });
      cancelAnimation(progress);
    }
    setLeaving(true);
  };
  const keepGoing = () => {
    setLeaving(false);
    if (pausedForLeave.current) apply({ type: 'resume', t: Date.now() });
    pausedForLeave.current = false;
  };

  // Start on mount; tick 4 times a second (state only changes when the second does).
  useEffect(() => {
    const t0 = Date.now();
    player.current = playerReducer(player.current, { type: 'start', t: t0 });
    drive(player.current, t0);
    cue(player.current, t0);
    setView(snapshot(player.current, t0, 0));
    const timer = setInterval(() => {
      if (player.current.status !== 'active') return;
      const t = Date.now();
      const prevIdx = player.current.stepIdx;
      const prevSec = Math.ceil((snapshot(player.current, t - 250, 0).stepRemainingMs ?? 0) / 1000);
      player.current = playerReducer(player.current, { type: 'tick', t, distanceM: 0 });
      if (player.current.status === 'finished') {
        clearInterval(timer);
        done(t);
        return;
      }
      if (player.current.stepIdx !== prevIdx) drive(player.current, t);
      cue(player.current, t);
      const snap = snapshot(player.current, t, 0);
      if (snap.stepIdx !== prevIdx || Math.ceil((snap.stepRemainingMs ?? 0) / 1000) !== prevSec) setView(snap);
    }, 250);
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    return () => {
      clearInterval(timer);
      deactivateKeepAwake(KEEP_AWAKE_TAG);
      services.speaker?.stop();
    };
    // Runs once: the player lives in a ref.
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (finishedAt) return false;
      askLeave();
      return true;
    });
    return () => sub.remove();
  }, [finishedAt]);

  if (finishedAt) return <Feel routine={routine} scheduleKey={scheduleKey} startedAt={startedAt.current} endedAt={finishedAt} />;

  const step = view.step;
  const itemIdx = itemOf(step);
  const move = moves[itemIdx]!;
  const between = step.label === 'Next';
  const shownMove = between ? (moves[itemIdx + 1] ?? move) : move;
  const nextMove = moves[(between ? itemIdx + 1 : itemIdx) + 1];
  const paused = view.status === 'paused';
  const total = step.duration.type === 'time' ? step.duration.seconds : 0;
  const left = Math.ceil((view.stepRemainingMs ?? 0) / 1000);
  const t = () => Date.now();

  return (
    <View style={[s.screen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
      <View style={s.top}>
        <IconButton label="Leave stretch" size={40} onPress={askLeave}>
          <Icons.x size={20} color={p.text} />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <T v="labelStrong" numberOfLines={1}>
            {routine.name}
          </T>
          <T v="micro" tone="secondary">{`${(between ? itemIdx + 1 : itemIdx) + 1} of ${moves.length}`}</T>
        </View>
        <IconButton label="All moves" size={40} onPress={() => setOverview(true)}>
          <Icons.listDetails size={20} color={p.text} />
        </IconButton>
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <Animated.View key={between ? itemIdx + 1 : itemIdx} entering={FadeIn.duration(220)} style={{ gap: 8 }}>
          <View style={s.imageWrap}>{shownMove.image ? <Image source={shownMove.image} style={{ width: '100%', height: '100%' }} contentFit="contain" /> : <Icons.stretching size={48} color={p.stretch.color} />}</View>
          <T v="title" align="center">
            {shownMove.name}
          </T>
          {shownMove.instruction ? (
            <T v="body" tone="secondary" align="center" numberOfLines={2}>
              {shownMove.instruction}
            </T>
          ) : null}
        </Animated.View>

        <View style={s.ringWrap}>
          <CountdownRing progress={progress} color={between || step.label === 'Switch sides' ? p.textTertiary : p.stretch.color} track={p.ringTrack} />
          <View style={s.ringText}>
            <T v="display" num style={{ fontSize: 44 }}>
              {formatClock(left)}
            </T>
            <T v="caption" tone="secondary">
              {between ? 'Get ready' : step.label === 'Switch sides' ? 'Switch sides' : `of ${formatClock(total)}`}
            </T>
          </View>
        </View>

        {move.sides === 'both' && !between && (
          <View style={s.sides}>
            {(['Left', 'Right'] as const).map((side) => {
              const on = step.label === side;
              return (
                <View key={side} style={[s.side, on && { backgroundColor: p.stretch.tint }]}>
                  <T v={on ? 'labelStrong' : 'label'} color={on ? p.stretch.onTint : p.textTertiary}>
                    {side}
                  </T>
                </View>
              );
            })}
          </View>
        )}

        {nextMove && (
          <View style={s.next}>
            <T v="caption" tone="secondary">
              Next
            </T>
            <T v="bodyMedium" style={{ flex: 1 }} numberOfLines={1}>
              {nextMove.name}
            </T>
            <T v="caption" tone="secondary">
              {nextMove.sides === 'both' ? `${nextMove.holdS} s each side` : `${nextMove.holdS} s`}
            </T>
          </View>
        )}
      </ScrollView>

      <View style={s.controls}>
        <IconButton
          label="Previous move"
          size={52}
          onPress={() => {
            haptic.tick();
            const steps = player.current.steps;
            const cur = itemOf(steps[player.current.stepIdx]!);
            const atStart = firstStepOfItem(steps, cur) === player.current.stepIdx;
            apply({ type: 'jump', t: t(), distanceM: 0, idx: firstStepOfItem(steps, atStart ? Math.max(0, cur - 1) : cur) });
          }}
        >
          <Icons.previous size={20} color={p.text} />
        </IconButton>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={paused ? 'Resume' : 'Pause'}
          onPress={() => {
            haptic.commit();
            apply({ type: paused ? 'resume' : 'pause', t: t() });
            if (!paused) cancelAnimation(progress);
          }}
          style={({ pressed }) => [s.play, pressed && { opacity: 0.8 }]}
        >
          {paused ? <Icons.play size={28} color={p.onPrimary} /> : <Icons.pause size={28} color={p.onPrimary} />}
        </Pressable>
        <IconButton
          label="Add 15 seconds"
          size={52}
          onPress={() => {
            haptic.tick();
            apply({ type: 'extend', t: t(), seconds: 15 });
          }}
        >
          <T v="labelStrong">+15 s</T>
        </IconButton>
        <IconButton
          label="Skip"
          size={52}
          onPress={() => {
            haptic.tick();
            apply({ type: 'skip', t: t(), distanceM: 0 });
          }}
        >
          <Icons.skip size={20} color={p.text} />
        </IconButton>
      </View>

      <Sheet visible={overview} onClose={() => setOverview(false)} title="Moves" scroll>
        <View style={{ gap: 4 }}>
          {moves.map((m, i) => {
            const current = i === (between ? itemIdx + 1 : itemIdx);
            return (
              <Pressable
                key={i}
                accessibilityRole="button"
                onPress={() => {
                  haptic.tap();
                  setOverview(false);
                  apply({ type: 'jump', t: t(), distanceM: 0, idx: firstStepOfItem(player.current.steps, i) });
                }}
                style={({ pressed }) => [s.overviewRow, current && { backgroundColor: p.stretch.tint }, pressed && { opacity: 0.7 }]}
              >
                <T v="labelStrong" tone="secondary" style={{ width: 24 }}>
                  {String(i + 1)}
                </T>
                <T v={current ? 'bodyStrong' : 'bodyMedium'} style={{ flex: 1 }} numberOfLines={1}>
                  {m.name}
                </T>
                <T v="caption" tone="secondary">
                  {m.sides === 'both' ? `${m.holdS} s each side` : `${m.holdS} s`}
                </T>
              </Pressable>
            );
          })}
        </View>
      </Sheet>

      <Sheet visible={leaving} onClose={keepGoing} title="Leave stretch">
        <View style={{ gap: 10 }}>
          <Button label="Keep going" onPress={keepGoing} />
          <Button
            label="Finish here"
            kind="outline"
            onPress={() => {
              setLeaving(false);
              done(Date.now());
            }}
          />
          <Button
            label="Leave without saving"
            kind="quiet"
            onPress={() => {
              setLeaving(false);
              router.back();
            }}
          />
        </View>
      </Sheet>
    </View>
  );
}

function CountdownRing({ progress, color, track }: { progress: { value: number }; color: string; track: string }) {
  const props = useAnimatedProps(() => ({ strokeDashoffset: CIRC * progress.value }));
  return (
    <Svg width={RING} height={RING}>
      <Circle cx={RING / 2} cy={RING / 2} r={R} stroke={track} strokeWidth={STROKE} fill="none" />
      <AnimatedCircle
        cx={RING / 2}
        cy={RING / 2}
        r={R}
        stroke={color}
        strokeWidth={STROKE}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${CIRC} ${CIRC}`}
        animatedProps={props}
        transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
      />
    </Svg>
  );
}

/** "How did it feel?" 1-5 and a note, then the scheduled stretch is marked done. */
function Feel({ routine, scheduleKey, startedAt, endedAt }: { routine: RoutineDetail; scheduleKey?: string; startedAt: Date; endedAt: Date }) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const p = usePalette();
  const [feel, setFeel] = useState<number>();
  const [note, setNote] = useState('');
  const minutes = Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 60000));
  const save = () => {
    if (scheduleKey) actions.markDone(scheduleKey, { minutes, ...(feel ? { feel } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
    haptic.success();
    showSnack({ message: `${routine.name} done` });
    router.back();
  };
  return (
    <View style={[s.screen, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 16, paddingHorizontal: 20 }]}>
      <View style={{ flex: 1, gap: 16 }}>
        <T v="caption" tone="secondary">{`${routine.name}, ${minutes} min`}</T>
        <T v="display" accessibilityRole="header">
          How did it feel?
        </T>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Button key={n} label={String(n)} kind={feel === n ? 'primary' : 'quiet'} style={{ flex: 1, paddingHorizontal: 0 }} accessibilityLabel={`Feel ${n} of 5`} onPress={() => setFeel(n)} />
          ))}
        </View>
        <T v="caption" tone="tertiary">
          1 is tight and stiff, 5 is loose and easy
        </T>
        <TextInput value={note} onChangeText={setNote} placeholder="Note, optional" placeholderTextColor={p.textTertiary} accessibilityLabel="Note" multiline style={s.note} />
      </View>
      <Button label="Save" onPress={save} />
    </View>
  );
}

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  body: { paddingHorizontal: 20, paddingTop: 12, gap: 16, alignItems: 'stretch' },
  imageWrap: { height: 200, borderRadius: 20, backgroundColor: p.surface, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  ringWrap: { alignSelf: 'center', width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  ringText: { position: 'absolute', alignItems: 'center' },
  sides: { flexDirection: 'row', alignSelf: 'center', gap: 6, padding: 4, borderRadius: 14, backgroundColor: p.surface },
  side: { paddingHorizontal: 18, height: 34, borderRadius: 10, justifyContent: 'center' },
  next: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, height: 52, borderRadius: 14, backgroundColor: p.surface },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', paddingTop: 12 },
  play: { width: 76, height: 76, borderRadius: 38, backgroundColor: p.primary, alignItems: 'center', justifyContent: 'center' },
  overviewRow: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, paddingHorizontal: 10, borderRadius: 12 },
  note: { minHeight: 80, borderRadius: 12, backgroundColor: p.surface, padding: 12, color: p.text, fontFamily: 'Inter', fontSize: 15, textAlignVertical: 'top' },
}));
