import { requireOptionalNativeModule } from 'expo';

interface AudioFocusModule {
  /** Asks for transient focus that lets other apps duck. True when granted. */
  request(): boolean;
  release(): void;
}

/** Undefined until the native app is rebuilt with this module (and on iOS). */
export const AudioFocus = requireOptionalNativeModule<AudioFocusModule>('AudioFocus') ?? undefined;
