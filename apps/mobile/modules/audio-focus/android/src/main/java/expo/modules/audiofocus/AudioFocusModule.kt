package expo.modules.audiofocus

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Ducks other audio (music, podcasts) while a voice cue plays. expo-speech never asks for
 * audio focus, so the JS speaker requests transient, may-duck focus before each cue and
 * releases it when the speech is done (docs/decisions.md, 2026-10-26).
 */
class AudioFocusModule : Module() {
  private var focusRequest: AudioFocusRequest? = null
  private val legacyListener = AudioManager.OnAudioFocusChangeListener { }

  private val audioManager: AudioManager?
    get() = appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

  override fun definition() = ModuleDefinition {
    Name("AudioFocus")

    Function("request") {
      val am = audioManager ?: return@Function false
      val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val request = focusRequest ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
          .setAudioAttributes(
            AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
              .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
              .build()
          )
          .build()
          .also { focusRequest = it }
        am.requestAudioFocus(request)
      } else {
        @Suppress("DEPRECATION")
        am.requestAudioFocus(legacyListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
      }
      result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }

    Function("release") {
      val am = audioManager ?: return@Function null
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        focusRequest?.let { am.abandonAudioFocusRequest(it) }
      } else {
        @Suppress("DEPRECATION")
        am.abandonAudioFocus(legacyListener)
      }
      null
    }
  }
}
