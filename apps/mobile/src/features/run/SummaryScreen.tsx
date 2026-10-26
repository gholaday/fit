/**
 * Run summary (spec §5 "Post-session summary", mockup Summary). Reads the stored session
 * once; the map and replay are lazy-loaded so opening a summary never waits on MapLibre.
 */
import { type DistanceUnit, type SessionDetail, cumulativeDistance, formatClock, formatDistance, metersToUnit, paceToUnit, splits as splitsOf } from '@fit/core';
import { router, useLocalSearchParams } from 'expo-router';
import { lazy, Suspense, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { repo } from '@/data';
import { useUnits } from '@/data/store';
import { haptic } from '@/lib/haptics';
import { createStyles, toneColor, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Button, IconButton, T } from '@/ui/primitives';
import { PostRunCard } from '@/features/stretch/PostRunCard';
import { stepAmount, stepName, stepTone } from './steps';
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

export function SummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // One read for the whole screen.
  const [session] = useState<SessionDetail | undefined>(() => repo.session(id));
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const unit = useUnits().distance;

  const done = () => {
    haptic.commit();
    if (router.canGoBack()) router.back();
    else router.replace('/');
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
  const avgPace = session.distanceM > 20 ? session.elapsedMs / session.distanceM : undefined;
  const splitRows = hasRoute ? splitsOf(cumulativeDistance(session.points), unit, session.pauses) : [];

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
          <View style={[s.mapSlot, s.center]}>
            <T v="caption" tone="tertiary">
              {session.mode === 'outdoor' ? 'No route recorded' : session.mode === 'treadmill' ? 'Treadmill run, no route' : 'Timer run, no route'}
            </T>
          </View>
        )}

        <View style={s.hero}>
          <Stat value={formatClock(Math.round(session.elapsedMs / 1000))} label="Time" />
          {session.mode === 'outdoor' && <Stat value={metersToUnit(session.distanceM, unit).toFixed(2)} label={unit === 'mi' ? 'Miles' : 'Kilometers'} />}
          {session.mode === 'outdoor' && <Stat value={pace(avgPace, unit)} label={`Pace /${unit}`} />}
        </View>

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
                  {session.mode === 'outdoor' && (
                    <T v="caption" tone="secondary" num>
                      {r.avgPaceSecPerKm !== undefined ? `${formatDistance(r.distanceM, unit, 2)}, ${pace(r.avgPaceSecPerKm, unit)} /${unit}` : formatDistance(r.distanceM, unit, 2)}
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
                <T v="bodyStrong" num style={{ flex: 1 }}>
                  {`${pace(sp.paceSecPerKm, unit)} /${unit}`}
                </T>
                <T v="label" tone="secondary" num>
                  {formatClock(Math.round(sp.durationS))}
                </T>
              </View>
            ))}
          </View>
        )}

        <Feel session={session} />
      </ScrollView>
      <StatusShade />
      <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Button label="Done" onPress={done} />
      </View>
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
      <View style={s.rpe}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
          <Button
            key={n}
            label={String(n)}
            size="sm"
            kind={rpe === n ? 'primary' : 'quiet'}
            style={s.rpeBtn}
            accessibilityLabel={`Effort ${n} of 10`}
            onPress={() => {
              haptic.tick();
              setRpe(n);
              repo.updateSessionNotes(session.id, { rpe: n });
            }}
          />
        ))}
      </View>
      <T v="caption" tone="tertiary" style={{ marginBottom: 10 }}>
        1 is very easy, 10 is all out
      </T>
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
  rpe: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 6 },
  rpeBtn: { width: 44, paddingHorizontal: 0 },
  notes: { minHeight: 72, borderRadius: 12, backgroundColor: p.inset, padding: 12, color: p.text, fontFamily: 'Inter', fontSize: 15, textAlignVertical: 'top', marginBottom: 10 },
  footer: { paddingHorizontal: 20, paddingTop: 8 },
}));
