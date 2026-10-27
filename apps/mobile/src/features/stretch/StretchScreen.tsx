/**
 * Guided stretch player (spec §10, mockup Stretch). Runs on the same timestamp-driven
 * player as runs: two-sided moves are Left, "Switch sides", Right, with a short "Next"
 * between moves. The countdown ring animates on the UI thread from the step's remaining
 * time; React re-renders once a second at most. Voice cues go through the run speaker
 * (audio focus ducks music) and the screen stays on.
 */
import { createPlayer, firstStepOfItem, formatClock, playerReducer, type PlayerState, type RoutineDetail, snapshot, type Step, stretchSteps } from '@fit/core';
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
import { NotFound } from '@/ui/NotFound';
import { FEEL_WORDS, RatingSlider } from '@/ui/RatingSlider';
import { Sheet } from '@/ui/Sheet';
import { Button, IconButton, T } from '@/ui/primitives';
import { services } from '@/features/run/services';

const KEEP_AWAKE_TAG = 'stretch';
const RING = 248;
const STROKE = 12;
const R = (RING - STROKE) / 2;
const CIRC = 2 * Math.PI * R;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface Move {
  name: string;
  /** Exercise.instructions, one paragraph per step. */
  instructions: string[];
  holdS: number;
  sides: 'both' | 'none';
}

/** Which move a step belongs to, from its id ("3:left"). */
const itemOf = (step: Step): number => Number(step.id.split(':')[0]);

export function StretchScreen() {
  const { id, key } = useLocalSearchParams<{ id: string; key?: string }>();
  const [routine] = useState(() => repo.routine(id));
  if (!routine || routine.items.kind !== 'stretch' || routine.items.items.length === 0) return <NotFound message="Routine not found" />;
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
      return {
        name: ex?.name ?? 'Stretch',
        instructions: ex?.instructions ?? [],
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

  /** Next, Back and the moves list: moving on also starts the clock if it was paused. */
  const moveTo = (ev: Parameters<typeof playerReducer>[1]) => {
    apply(ev);
    if (player.current.status === 'paused') apply({ type: 'resume', t: ev.t });
  };

  const done = (t: number) => {
    cancelAnimation(progress);
    progress.value = 1;
    speak('Stretch complete');
    haptic.success();
    setFinishedAt(new Date(t));
  };

  /** The leave sheet holds the clock; closing it picks up where it was. */
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

      <Animated.View key={between ? itemIdx + 1 : itemIdx} entering={FadeIn.duration(220)} style={s.head}>
        <T v="title" align="center" numberOfLines={2}>
          {shownMove.name}
        </T>
        <T v="headline" align="center" color={between || step.label === 'Switch sides' ? p.textSecondary : p.stretch.onTint}>
          {between ? 'Get ready' : step.label === 'Switch sides' ? 'Switch sides' : step.label ? `${step.label} side` : 'Hold'}
        </T>
      </Animated.View>

      <View style={s.ringWrap}>
        <CountdownRing progress={progress} color={between || step.label === 'Switch sides' ? p.textTertiary : p.stretch.color} track={p.ringTrack} />
        <View style={s.ringText}>
          <T v="display" num style={{ fontSize: 56, lineHeight: 64 }}>
            {formatClock(left)}
          </T>
          <T v="caption" tone="secondary">{`of ${formatClock(total)}`}</T>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add 15 seconds"
            hitSlop={8}
            onPress={() => {
              haptic.tick();
              apply({ type: 'extend', t: t(), seconds: 15 });
            }}
            style={({ pressed }) => [s.extend, pressed && { opacity: 0.6 }]}
          >
            <T v="labelStrong">+15 s</T>
          </Pressable>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.cues} showsVerticalScrollIndicator={false}>
        {shownMove.instructions.length > 0 ? (
          shownMove.instructions.map((line, i) => (
            <T key={i} v="body" style={s.cue}>
              {line}
            </T>
          ))
        ) : (
          <T v="body" tone="secondary" style={s.cue}>
            Hold the stretch and breathe slowly.
          </T>
        )}
      </ScrollView>

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

      <View style={s.controls}>
        <IconButton
          label="Previous move"
          size={52}
          onPress={() => {
            haptic.tick();
            const steps = player.current.steps;
            const cur = itemOf(steps[player.current.stepIdx]!);
            const atStart = firstStepOfItem(steps, cur) === player.current.stepIdx;
            moveTo({ type: 'jump', t: t(), distanceM: 0, idx: firstStepOfItem(steps, atStart ? Math.max(0, cur - 1) : cur) });
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
          label="Skip"
          size={52}
          onPress={() => {
            haptic.tick();
            moveTo({ type: 'skip', t: t(), distanceM: 0 });
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
                  moveTo({ type: 'jump', t: t(), distanceM: 0, idx: firstStepOfItem(player.current.steps, i) });
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
          <Button
            label="Finish here"
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

/**
 * "How did it feel?" 1 to 5 and a note. Save (or back) marks the scheduled stretch done;
 * Discard leaves it due.
 */
function Feel({ routine, scheduleKey, startedAt, endedAt }: { routine: RoutineDetail; scheduleKey?: string; startedAt: Date; endedAt: Date }) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const p = usePalette();
  const [feel, setFeel] = useState<number>();
  const [note, setNote] = useState('');
  const [discarding, setDiscarding] = useState(false);
  const minutes = Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 60000));
  const save = () => {
    if (scheduleKey) actions.markDone(scheduleKey, { minutes, ...(feel ? { feel } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
    haptic.success();
    showSnack({ message: `${routine.name} done` });
    router.back();
  };
  const discard = () => {
    setDiscarding(false);
    showSnack({ message: 'Stretch discarded' });
    router.back();
  };
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      save();
      return true;
    });
    return () => sub.remove();
  });
  return (
    <View style={[s.screen, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 16, paddingHorizontal: 20 }]}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 16 }} keyboardShouldPersistTaps="handled">
        <T v="caption" tone="secondary">{`${routine.name}, ${minutes} min`}</T>
        <T v="display" accessibilityRole="header">
          How did it feel?
        </T>
        <RatingSlider value={feel} words={FEEL_WORDS} label="Feel, 1 to 5" prompt="Tap or slide to rate" ends={['1 tight', '5 very loose']} onChange={setFeel} />
        <TextInput value={note} onChangeText={setNote} placeholder="Note, optional" placeholderTextColor={p.textTertiary} accessibilityLabel="Note" multiline style={s.note} />
        <Button label="Discard stretch" kind="quiet" onPress={() => setDiscarding(true)} />
      </ScrollView>
      <Button label="Save" onPress={save} />
      <Sheet visible={discarding} onClose={() => setDiscarding(false)} title="Discard stretch">
        <View style={{ gap: 10 }}>
          <T v="body" tone="secondary">
            {scheduleKey ? 'Nothing is saved, and the stretch stays due.' : 'Nothing is saved.'}
          </T>
          <Button label="Discard stretch" onPress={discard} />
          <Button label="Keep it" kind="outline" onPress={() => setDiscarding(false)} />
        </View>
      </Sheet>
    </View>
  );
}

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  head: { paddingHorizontal: 20, paddingTop: 16, gap: 4 },
  ringWrap: { alignSelf: 'center', width: RING, height: RING, alignItems: 'center', justifyContent: 'center', marginVertical: 16 },
  ringText: { position: 'absolute', alignItems: 'center' },
  cues: { paddingHorizontal: 24, paddingBottom: 12, gap: 12 },
  // Read at arm's length mid-stretch, so larger than body copy.
  cue: { fontSize: 19, lineHeight: 28 },
  next: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, height: 52, borderRadius: 14, backgroundColor: p.surface, marginHorizontal: 20 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 36, paddingTop: 12 },
  extend: { marginTop: 10, height: 32, paddingHorizontal: 14, borderRadius: 16, justifyContent: 'center', backgroundColor: p.inset },
  play: { width: 76, height: 76, borderRadius: 38, backgroundColor: p.primary, alignItems: 'center', justifyContent: 'center' },
  overviewRow: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, paddingHorizontal: 10, borderRadius: 12 },
  note: { minHeight: 80, borderRadius: 12, backgroundColor: p.surface, padding: 12, color: p.text, fontFamily: 'Inter', fontSize: 15, textAlignVertical: 'top' },
}));
