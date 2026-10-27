/**
 * Run summary (spec §5 "Post-session summary", mockup Summary). Reads the stored session
 * once; the map and replay are lazy-loaded so opening a summary never waits on MapLibre.
 */
import { type DistanceUnit, METERS_PER_MILE, type RecordEvent, type SessionDetail, cumulativeDistance, formatClock, formatDistance, hrStats, metersToUnit, paceToUnit, splits as splitsOf, unitToMeters } from '@fit/core';
import { router, useLocalSearchParams } from 'expo-router';
import { lazy, Suspense, useEffect, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { repo } from '@/data';
import { actions, showSnack, useHrProfile, usePaceBump, useUnits, useVdot } from '@/data/store';
import { PaceBumpCard, TrialCard } from '@/features/pace/paces';
import { haptic } from '@/lib/haptics';
import { createStyles, toneColor, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Button, IconButton, T } from '@/ui/primitives';
import { PostRunCard } from '@/features/stretch/PostRunCard';
import { RecordRow, Trophy } from '@/features/records/records';
import { HrCard } from './HrCard';
import { SessionProfile } from './SessionProfile';
import { stepAmount, stepName, stepTone } from './steps';
import { RatingSlider, RPE_WORDS } from '@/ui/RatingSlider';
import { Sheet } from '@/ui/Sheet';
import { Slider } from '@/ui/Slider';
import { StatusShade } from '@/ui/StatusShade';

const RouteMap = lazy(() => import('./RouteMap'));

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Tue, Oct 27, 6:12 PM" from an ISO instant, in local time. */
function startedLabel(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const time = `${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  return `${DOW[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${time}`;
}

const pace = (secPerKm: number | undefined, unit: DistanceUnit) => (secPerKm === undefined || !Number.isFinite(secPerKm) ? '-' : formatClock(paceToUnit(secPerKm, unit)));

/** Trophies this run earned. Records are rebuilt after a save, so time the first read. */
function newRecords(id: string): RecordEvent[] {
  const t0 = performance.now();
  const out = repo.sessionRecords(id).filter((e) => e.celebrate);
  if (__DEV__) console.log(`[records] sessionRecords ${Math.round(performance.now() - t0)} ms`);
  return out;
}

export function SummaryScreen() {
  // `saved` is set when the run screen opens the summary right after Save.
  const { id, saved } = useLocalSearchParams<{ id: string; saved?: string }>();
  // One read for the whole screen.
  const [session, setSession] = useState<SessionDetail | undefined>(() => repo.session(id));
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const units = useUnits();
  const unit = units.distance;
  const [records] = useState(() => (session ? newRecords(id) : []));
  // A small pop-up on Save; opening the summary later from History stays quiet.
  useEffect(() => {
    if (!saved || records.length === 0) return;
    haptic.success();
    showSnack({ message: records.length === 1 ? '1 new record' : `${records.length} new records` });
  }, []);
  const zones = useHrProfile()?.zones;
  const vdot = useVdot();
  const bump = usePaceBump();
  // A time trial (or the plans' 5K retest) in this run, for "Update your paces?".
  const [trial] = useState(() => (session ? repo.sessionTrial(session.id) : undefined));
  // Stats over the merged trace, once; the zones only change in Settings.
  const [hr] = useState(() => (session && session.hr.length > 1 ? hrStats(session.hr, zones ?? [], { endMs: session.endedAt ? Date.parse(session.endedAt) - Date.parse(session.startedAt) : (session.hr[session.hr.length - 1]?.tOffsetMs ?? 0), pauses: session.pauses, log: session.log }) : undefined));

  const [discarding, setDiscarding] = useState(false);

  const done = () => {
    haptic.commit();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  // Deleting reopens the plan workout and gives a merged watch recording back its own entry.
  const discard = () => {
    setDiscarding(false);
    repo.deleteSession(id);
    actions.reload();
    showSnack({ message: 'Run discarded' });
    done();
  };

  if (!session) {
    return (
      <View style={[s.screen, s.center]}>
        <T v="bodyMedium" tone="secondary">
          Run not found
        </T>
        <Button label="Back to Today" kind="outline" size="sm" onPress={() => router.replace('/')} />
      </View>
    );
  }

  const hasRoute = session.points.length > 1;
  const hasDistance = session.distanceM > 20;
  const avgPace = hasDistance ? session.elapsedMs / session.distanceM : undefined;
  const splitRows = hasRoute ? splitsOf(cumulativeDistance(session.points), unit, session.pauses) : [];
  // A new 1 km (or 1 mi) record puts a trophy on the fastest full split of that length.
  const splitM = unit === 'mi' ? METERS_PER_MILE : 1000;
  const splitRecord = records.some((e) => e.kind === 'effort' && Math.abs((e.meters ?? 0) - splitM) < 1);
  const fastest = splitRecord ? splitRows.filter((x) => !x.partial).reduce<(typeof splitRows)[number] | undefined>((b, x) => (!b || x.durationS < b.durationS ? x : b), undefined)?.index : undefined;

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + 8 }]} showsVerticalScrollIndicator={false}>
        <View style={s.top}>
          <IconButton label="Back to Today" size={40} onPress={done}>
            <Icons.chevronLeft size={20} color={p.text} />
          </IconButton>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <T v="headline">{session.name}</T>
            <T v="caption" tone="secondary">
              {startedLabel(session.startedAt)}
            </T>
          </View>
          <View style={{ width: 40 }} />
        </View>

        {hasRoute ? (
          <Suspense fallback={<View style={s.mapSlot} />}>
            <RouteMap session={session} />
          </Suspense>
        ) : (
          <SessionProfile session={session} />
        )}

        {session.mode !== 'outdoor' && <DistanceFix key={session.distanceM} session={session} onSaved={() => setSession(repo.session(id))} />}

        <View style={s.hero}>
          <Stat value={formatClock(Math.round(session.elapsedMs / 1000))} label="Time" />
          {hasDistance && <Stat value={metersToUnit(session.distanceM, unit).toFixed(2)} label={unit === 'mi' ? 'Miles' : 'Kilometers'} />}
          {hasDistance && <Stat value={pace(avgPace, unit)} label={`Pace /${unit}`} />}
        </View>

        {records.length > 0 && (
          <View style={s.card}>
            <View style={[s.cardTitle, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
              <Trophy size={20} />
              <T v="headline">New records</T>
            </View>
            {records.map((e, i) => (
              <RecordRow key={e.key} e={e} units={units} first={i === 0} />
            ))}
          </View>
        )}

        {trial && <TrialCard sessionId={session.id} trial={trial} current={vdot} />}
        {bump && !trial && <PaceBumpCard bump={bump} />}

        {hr && <HrCard session={session} stats={hr} zones={zones} run={session.stats} />}

        <PostRunCard endedAt={session.endedAt} />

        {session.steps.length > 1 && (
          <View style={s.card}>
            <T v="headline" style={s.cardTitle}>
              Steps
            </T>
            {session.steps.map((r, i) => (
              <View key={i} style={[s.row, i > 0 && s.divider]}>
                <View style={[s.dot, { backgroundColor: toneColor(p, stepTone(r.step)) }]} />
                <View style={{ flex: 1 }}>
                  <T v="bodyMedium">{stepName(r.step)}</T>
                  <T v="caption" tone="secondary">
                    {r.skipped ? `Planned ${stepAmount(r.step, unit)}, skipped` : `Planned ${stepAmount(r.step, unit)}`}
                  </T>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <T v="bodyStrong" num>
                    {formatClock(Math.round(r.durationS))}
                  </T>
                  {hasDistance && (
                    <T v="caption" tone="secondary" num>
                      {r.avgPaceSecPerKm !== undefined ? `${formatDistance(r.distanceM, unit, 2)}, ${pace(r.avgPaceSecPerKm, unit)} /${unit}` : formatDistance(r.distanceM, unit, 2)}
                    </T>
                  )}
                  {hr?.stepAvgBpm[r.idx] !== undefined && (
                    <T v="caption" tone="secondary" num>
                      {`${hr.stepAvgBpm[r.idx]} bpm avg`}
                    </T>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        {splitRows.length > 0 && (
          <View style={s.card}>
            <T v="headline" style={s.cardTitle}>
              Splits
            </T>
            {splitRows.map((sp, i) => (
              <View key={sp.index} style={[s.row, i > 0 && s.divider]}>
                <T v="bodyMedium" num style={{ width: 64 }}>
                  {sp.partial ? formatDistance(sp.distanceM, unit, 2) : `${sp.index} ${unit}`}
                </T>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <T v="bodyStrong" num>
                    {`${pace(sp.paceSecPerKm, unit)} /${unit}`}
                  </T>
                  {sp.index === fastest && <Trophy size={14} />}
                </View>
                <T v="label" tone="secondary" num>
                  {formatClock(Math.round(sp.durationS))}
                </T>
              </View>
            ))}
          </View>
        )}

        <Feel session={session} />

        <Button label="Discard run" kind="quiet" onPress={() => setDiscarding(true)} />
      </ScrollView>
      <StatusShade />
      <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Button label="Done" onPress={done} />
      </View>
      <Sheet visible={discarding} onClose={() => setDiscarding(false)} title="Discard run">
        <View style={{ gap: 10 }}>
          <T v="body" tone="secondary">
            {session.planWorkoutId ? 'The route and stats are deleted, and the plan workout is due again.' : 'The route and stats are deleted.'}
          </T>
          <Button label="Discard run" onPress={discard} />
          <Button label="Keep it" kind="outline" onPress={() => setDiscarding(false)} />
        </View>
      </Sheet>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1 }}>
      <T v="title" num>
        {value}
      </T>
      <T v="caption" tone="secondary">
        {label}
      </T>
    </View>
  );
}

/**
 * Treadmill and Timer runs: the recorded distance, set on a slider. On a treadmill the
 * estimate comes from belt speed and time, and the console's own count is nearly always
 * entered, so this card sits right under the run profile. Saving rescales every step's
 * distance and the pace.
 */
function DistanceFix({ session, onSaved }: { session: SessionDetail; onSaved: () => void }) {
  const s = useStyles();
  const unit = useUnits().distance;
  const treadmill = session.mode === 'treadmill';
  const stored = Math.round(metersToUnit(session.distanceM, unit) * 100) / 100;
  const [value, setValue] = useState(stored);
  // Half to one and a half times the estimate, at least one unit either side; 8 units with no estimate.
  const [range] = useState(() => (stored > 0 ? [Math.max(0, Math.floor((stored - Math.max(1, stored * 0.5)) * 10) / 10), Math.ceil((stored + Math.max(1, stored * 0.5)) * 10) / 10] : [0, 8]) as [number, number]);
  const changed = Math.abs(value - stored) >= 0.005 && value > 0;
  const paceS = value > 0 ? session.elapsedMs / 1000 / value : undefined;

  const set = (v: number) => {
    const next = Math.round(Math.max(0, v) * 100) / 100;
    if (next === value) return;
    // A tick on each tenth while dragging, every step on the buttons.
    if (Math.floor(next * 10) !== Math.floor(value * 10) || Math.abs(next - value) < 0.015) haptic.tick();
    setValue(next);
  };
  const save = () => {
    if (!changed) return;
    haptic.commit();
    repo.correctDistance(session.id, unitToMeters(value, unit));
    actions.reload();
    onSaved();
    showSnack({ message: `Distance saved as ${value.toFixed(2)} ${unit}` });
  };

  return (
    <View style={[s.card, { paddingBottom: 14 }]}>
      <T v="headline" style={s.cardTitle}>
        {treadmill ? 'Treadmill distance' : 'Distance'}
      </T>
      <T v="caption" tone="secondary">
        {treadmill ? 'Set the distance shown on the treadmill console. Pace and step distances update to match.' : 'Set the distance covered. Pace and step distances update to match.'}
      </T>
      <View style={s.fixValue}>
        <IconButton label={`Decrease by 0.01 ${unit}`} size={44} bg="inset" onPress={() => set(value - 0.01)}>
          <T v="title">-</T>
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <T v="display" num>
            {value.toFixed(2)}
          </T>
          <T v="caption" tone="secondary" num>
            {paceS ? `${unit === 'mi' ? 'Miles' : 'Kilometers'}, ${formatClock(paceS)} /${unit} pace` : unit === 'mi' ? 'Miles' : 'Kilometers'}
          </T>
        </View>
        <IconButton label={`Increase by 0.01 ${unit}`} size={44} bg="inset" onPress={() => set(value + 0.01)}>
          <T v="title">+</T>
        </IconButton>
      </View>
      <Slider value={value} min={range[0]} max={range[1]} step={0.01} onChange={set} label={treadmill ? 'Treadmill distance' : 'Distance'} valueText={`${value.toFixed(2)} ${unit}`} />
      <View style={s.fixRange}>
        <T v="micro" tone="tertiary" num>
          {`${range[0].toFixed(1)} ${unit}`}
        </T>
        <T v="micro" tone="tertiary" num>
          {`${range[1].toFixed(1)} ${unit}`}
        </T>
      </View>
      <Button label={changed ? 'Save distance' : stored > 0 ? `Recorded ${stored.toFixed(2)} ${unit}` : 'Set a distance'} kind={changed ? 'primary' : 'quiet'} disabled={!changed} onPress={save} />
    </View>
  );
}

/** RPE and notes, saved as you go. */
function Feel({ session }: { session: SessionDetail }) {
  const s = useStyles();
  const p = usePalette();
  const [rpe, setRpe] = useState(session.rpe);
  const [notes, setNotes] = useState(session.notes ?? '');
  return (
    <View style={s.card}>
      <T v="headline" style={s.cardTitle}>
        How hard was it
      </T>
      <View style={{ paddingBottom: 12 }}>
        <RatingSlider
          value={rpe}
          words={RPE_WORDS}
          label="Effort, 1 to 10"
          prompt="Tap or slide to rate"
          ends={['1 very easy', '10 all out']}
          onChange={(n) => {
            setRpe(n);
            repo.updateSessionNotes(session.id, { rpe: n });
          }}
        />
      </View>
      <TextInput
        value={notes}
        onChangeText={setNotes}
        onBlur={() => repo.updateSessionNotes(session.id, { notes })}
        placeholder="Notes"
        placeholderTextColor={p.textMuted}
        multiline
        style={s.notes}
      />
    </View>
  );
}

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  content: { paddingHorizontal: 20, paddingBottom: 24, gap: 14 },
  top: { flexDirection: 'row', alignItems: 'center' },
  mapSlot: { height: 240, borderRadius: 20, backgroundColor: p.inset },
  hero: { flexDirection: 'row', gap: 10, paddingHorizontal: 4 },
  card: { backgroundColor: p.surface, borderRadius: 16, paddingHorizontal: 14, paddingBottom: 6 },
  cardTitle: { paddingTop: 14, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  divider: { borderTopWidth: 1, borderTopColor: p.divider },
  dot: { width: 10, height: 10, borderRadius: 5 },
  notes: { minHeight: 72, borderRadius: 12, backgroundColor: p.inset, padding: 12, color: p.text, fontFamily: 'Inter', fontSize: 15, textAlignVertical: 'top', marginBottom: 10 },
  footer: { paddingHorizontal: 20, paddingTop: 8 },
  fixValue: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 14, paddingBottom: 4 },
  fixRange: { flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 12 },
}));
