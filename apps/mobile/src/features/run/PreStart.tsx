/**
 * Pre-start (spec §14): the step list, mode, GPS signal, voice and Start, then the 3-2-1.
 * Outdoor starts GPS here so the signal has warmed up by the time you tap Start.
 */
import { type SessionMode, type Step, structureSegments } from "@fit/core";
import { memo, useEffect, useState } from "react";
import { Pressable, ScrollView, Switch, View } from "react-native";
import Animated, { FadeIn, FadeOut, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHrProfile, useUnits } from "@/data/store";
import { haptic } from "@/lib/haptics";
import { createStyles, motion, toneColor, usePalette } from "@/theme";
import { Icons } from "@/ui/icons";
import {
  Button,
  IconButton,
  Segmented,
  StructureBar,
  T,
} from "@/ui/primitives";
import {
  cancelCountdown,
  paceRangeFor,
  setMode,
  setVoice,
  startCountdown,
  useLive,
  useRun,
} from "./engine";
import {
  accessComplete,
  type RecordingAccess,
  readAccess,
} from "./permissions";
import { RunPermissions } from "./RunPermissions";
import { stepAmount, stepName, stepTargetText, stepTone } from "./steps";

/** Start is enabled once a fix is this accurate (spec §5 GPS warmup). */
const GOOD_FIX_M = 20;
/** A fix older than this counts as no signal. */
const STALE_FIX_MS = 10_000;

type Signal = { level: "none" | "weak" | "good"; text: string };

function signalOf(
  accuracyM: number | undefined,
  lastFixAt: number | undefined,
  now: number,
): Signal {
  if (
    accuracyM === undefined ||
    lastFixAt === undefined ||
    now - lastFixAt > STALE_FIX_MS
  )
    return { level: "none", text: "Searching" };
  const m = Math.round(accuracyM);
  return accuracyM < GOOD_FIX_M
    ? { level: "good", text: `Good, ${m} m` }
    : { level: "weak", text: `Weak, ${m} m` };
}

const StepRow = memo(function StepRow({
  step,
  last,
}: {
  step: Step;
  last: boolean;
}) {
  const p = usePalette();
  const s = useStyles();
  const unit = useUnits().distance;
  const zones = useHrProfile()?.zones;
  const target = stepTargetText(step, unit, paceRangeFor, zones);
  return (
    <View style={[s.stepRow, !last && s.divider]}>
      <View
        style={[s.dot, { backgroundColor: toneColor(p, stepTone(step)) }]}
      />
      <View style={{ flex: 1 }}>
        <T v="bodyMedium">{stepName(step)}</T>
        {target && (
          <T v="caption" tone="secondary">
            {target}
          </T>
        )}
      </View>
      <T v="bodyStrong" num>
        {stepAmount(step, unit)}
      </T>
    </View>
  );
});

function GpsRow() {
  const p = usePalette();
  const s = useStyles();
  const accuracyM = useLive((l) => l.accuracyM);
  const lastFixAt = useLive((l) => l.lastFixAt);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(id);
  }, []);
  const sig = signalOf(accuracyM, lastFixAt, now);
  const color =
    sig.level === "good"
      ? p.success
      : sig.level === "weak"
        ? p.hard.color
        : p.textTertiary;
  return (
    <View style={s.setting}>
      <Icons.signal size={20} color={color} />
      <T v="bodyMedium" style={{ flex: 1 }}>
        GPS signal
      </T>
      <T v="label" color={color}>
        {sig.text}
      </T>
    </View>
  );
}

export function PreStart({ onClose }: { onClose: () => void }) {
  const p = usePalette();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const name = useRun((r) => r.name);
  const steps = useRun((r) => r.steps);
  const mode = useRun((r) => r.mode);
  const voice = useRun((r) => r.voice);
  const counting = useRun((r) => r.phase === "countdown");
  const ready = useLive(
    (l) => l.accuracyM !== undefined && l.accuracyM < GOOD_FIX_M,
  );
  const segments = structureSegments(steps);
  const canStart = mode !== "outdoor" || ready;
  const [access, setAccess] = useState<RecordingAccess>();
  const [setupOpen, setSetupOpen] = useState(false);

  // Outdoor needs location; the setup flow opens on its own the first time.
  useEffect(() => {
    if (mode !== "outdoor") return;
    void readAccess().then((a) => {
      setAccess(a);
      if (a.location !== "granted") setSetupOpen(true);
    });
  }, [mode]);

  const setupDone = () => {
    setSetupOpen(false);
    void readAccess().then(setAccess);
    // Permission may have just been granted: start the GPS warmup.
    void setMode("outdoor");
  };

  const start = () => {
    haptic.commit();
    startCountdown();
  };

  return (
    <View style={[s.screen, { paddingTop: insets.top + 8 }]}>
      <View style={s.top}>
        <IconButton label="Close" size={44} onPress={onClose}>
          <Icons.x size={20} color={p.text} />
        </IconButton>
      </View>
      <ScrollView
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
      >
        <T v="display" accessibilityRole="header">
          {name}
        </T>
        {steps.length > 1 && <StructureBar segments={segments} height={8} />}

        <View style={s.card}>
          {steps.map((st, i) => (
            <StepRow key={i} step={st} last={i === steps.length - 1} />
          ))}
        </View>

        <Segmented
          options={[
            { value: "outdoor", label: "Outdoor" },
            { value: "treadmill", label: "Treadmill" },
            { value: "timer", label: "Timer" },
          ]}
          value={mode}
          onChange={(m: SessionMode) => void setMode(m)}
        />

        <View style={s.card}>
          {mode === "outdoor" && <GpsRow />}
          <View style={[s.setting, mode === "outdoor" && s.dividerTop]}>
            {voice ? (
              <Icons.volume size={20} color={p.text} />
            ) : (
              <Icons.volumeOff size={20} color={p.textTertiary} />
            )}
            <T v="bodyMedium" style={{ flex: 1 }}>
              Voice cues
            </T>
            <Switch
              value={voice}
              onValueChange={(v) => {
                haptic.tick();
                setVoice(v);
              }}
              accessibilityLabel="Voice cues"
            />
          </View>
        </View>
        {mode !== "outdoor" && (
          <T v="caption" tone="tertiary">
            {mode === "timer"
              ? "Timer mode records time only, with no GPS or map."
              : "Treadmill runs record time only for now. Distance and pace come in a later update."}
          </T>
        )}
        {mode === "outdoor" &&
          access &&
          access.location === "granted" &&
          !accessComplete(access) && (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                haptic.tap();
                setSetupOpen(true);
              }}
              style={s.notice}
            >
              <Icons.info size={18} color={p.hard.onTint} />
              <T v="label" color={p.hard.onTint} style={{ flex: 1 }}>
                Recording may stop with the screen off
              </T>
              <T v="labelStrong" color={p.hard.onTint}>
                Fix
              </T>
            </Pressable>
          )}
      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
        {!canStart && (
          <Button label="Start anyway" kind="quiet" size="md" onPress={start} />
        )}
        <Button
          label={canStart ? "Start" : "Waiting for GPS"}
          disabled={!canStart}
          onPress={start}
        />
      </View>

      {counting && <Countdown onCancel={cancelCountdown} />}
      {setupOpen && (
        <RunPermissions
          onDone={setupDone}
          onUseTimer={() => {
            setSetupOpen(false);
            void setMode("timer");
          }}
        />
      )}
    </View>
  );
}

/** Full-screen 3-2-1 before the clock starts. Tap to cancel. */
function Countdown({ onCancel }: { onCancel: () => void }) {
  const p = usePalette();
  const s = useStyles();
  const endsAt = useRun((r) => r.countdownEndsAt);
  const [left, setLeft] = useState(() =>
    Math.max(1, Math.ceil(((endsAt ?? Date.now()) - Date.now()) / 1000)),
  );
  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => {
      const n = Math.ceil((endsAt - Date.now()) / 1000);
      if (n >= 1) setLeft(n);
    }, 100);
    return () => clearInterval(id);
  }, [endsAt]);
  useEffect(() => haptic.lift(), [left]);
  return (
    <Animated.View
      entering={FadeIn.duration(motion.fast)}
      exiting={FadeOut.duration(motion.fast)}
      style={s.countdown}
    >
      <Animated.View key={left} entering={ZoomIn.duration(motion.slow)}>
        <T
          v="display"
          num
          color={p.onPrimary}
          style={{ fontSize: 160, lineHeight: 170 }}
        >
          {String(left)}
        </T>
      </Animated.View>
      <Button
        label="Cancel"
        kind="quiet"
        size="sm"
        style={{ position: "absolute", bottom: 80 }}
        onPress={onCancel}
      />
    </Animated.View>
  );
}

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg },
  top: { flexDirection: "row", paddingHorizontal: 16 },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 16 },
  card: { backgroundColor: p.surface, borderRadius: 16, paddingHorizontal: 14 },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: p.divider },
  dividerTop: { borderTopWidth: 1, borderTopColor: p.divider },
  dot: { width: 10, height: 10, borderRadius: 5 },
  setting: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 52,
  },
  footer: { paddingHorizontal: 20, gap: 8 },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: p.hard.tint,
  },
  countdown: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: p.primary,
    alignItems: "center",
    justifyContent: "center",
  },
}));
