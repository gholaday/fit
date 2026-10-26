package expo.modules.hrsensor

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

/**
 * Live heart rate from a Bluetooth chest strap or watch broadcasting the standard Heart
 * Rate service (0x180D). Scans for that service, connects, subscribes to Heart Rate
 * Measurement (0x2A37) and forwards each notification's raw bytes with a timestamp; parsing
 * lives in @fit/core. A dropped link reconnects on its own until disconnect() is called, so
 * a strap that loses contact mid-run comes back without the runner touching the phone.
 *
 * Permissions (BLUETOOTH_SCAN, BLUETOOTH_CONNECT on Android 12+) are asked for in JS before
 * any call here; calls without them fail with a SecurityException that becomes a rejection.
 */
@SuppressLint("MissingPermission")
class HrSensorModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private var scanning = false
  private var gatt: BluetoothGatt? = null
  private var deviceId: String? = null
  /** True between connect() and disconnect(): drops while true are retried. */
  private var wanted = false

  private val context: Context?
    get() = appContext.reactContext

  private val adapter: BluetoothAdapter?
    get() = (context?.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

  override fun definition() = ModuleDefinition {
    Name("HrSensor")

    Events("onDevice", "onConnection", "onMeasurement")

    /** "on", "off", or "unsupported" when the phone has no Bluetooth LE. */
    Function("state") {
      val a = adapter ?: return@Function "unsupported"
      if (a.isEnabled) "on" else "off"
    }

    Function("startScan") {
      val scanner = adapter?.bluetoothLeScanner ?: return@Function false
      if (scanning) return@Function true
      val filter = ScanFilter.Builder().setServiceUuid(ParcelUuid(HR_SERVICE)).build()
      val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
      scanner.startScan(listOf(filter), settings, scanCallback)
      scanning = true
      // Scanning drains the battery; stop on our own if the screen forgets to.
      main.postDelayed(scanTimeout, SCAN_TIMEOUT_MS)
      true
    }

    Function("stopScan") {
      stopScanInternal()
    }

    AsyncFunction("connect") { id: String, promise: Promise ->
      val a = adapter ?: return@AsyncFunction promise.reject("ERR_UNSUPPORTED", "Bluetooth is not available", null)
      val ctx = context ?: return@AsyncFunction promise.reject("ERR_NO_CONTEXT", "App is not ready", null)
      stopScanInternal()
      closeGatt()
      wanted = true
      deviceId = id
      val device = a.getRemoteDevice(id)
      sendConnection(id, "connecting")
      gatt = connectGatt(ctx, device, autoConnect = false)
      promise.resolve(null)
    }

    Function("disconnect") {
      wanted = false
      deviceId?.let { sendConnection(it, "disconnected") }
      closeGatt()
      deviceId = null
    }

    /** Id of the device connect() was last called with, while it is wanted. */
    Function("connectedId") {
      if (wanted) deviceId else null
    }

    OnDestroy {
      wanted = false
      stopScanInternal()
      closeGatt()
    }
  }

  private val scanCallback = object : ScanCallback() {
    override fun onScanResult(callbackType: Int, result: ScanResult) {
      sendEvent(
        "onDevice",
        mapOf(
          "id" to result.device.address,
          "name" to (result.scanRecord?.deviceName ?: result.device.name),
          "rssi" to result.rssi,
        ),
      )
    }
  }

  private val scanTimeout = Runnable { stopScanInternal() }

  private fun stopScanInternal() {
    main.removeCallbacks(scanTimeout)
    if (!scanning) return
    scanning = false
    try {
      adapter?.bluetoothLeScanner?.stopScan(scanCallback)
    } catch (_: IllegalStateException) {
      // Bluetooth was turned off mid-scan; nothing left to stop.
    }
  }

  private fun connectGatt(ctx: Context, device: BluetoothDevice, autoConnect: Boolean): BluetoothGatt =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      device.connectGatt(ctx, autoConnect, gattCallback, BluetoothDevice.TRANSPORT_LE)
    } else {
      device.connectGatt(ctx, autoConnect, gattCallback)
    }

  private fun closeGatt() {
    gatt?.let {
      it.disconnect()
      it.close()
    }
    gatt = null
  }

  private fun sendConnection(id: String, state: String) {
    sendEvent("onConnection", mapOf("id" to id, "state" to state))
  }

  private val gattCallback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
      val id = g.device.address
      if (newState == BluetoothProfile.STATE_CONNECTED) {
        g.discoverServices()
        return
      }
      if (newState != BluetoothProfile.STATE_DISCONNECTED) return
      g.close()
      if (gatt == g) gatt = null
      if (!wanted || id != deviceId) return
      // Lost contact: autoConnect waits for the strap to come back without timing out.
      sendConnection(id, "reconnecting")
      val ctx = context ?: return
      main.post { if (wanted && deviceId == id) gatt = connectGatt(ctx, g.device, autoConnect = true) }
    }

    override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
      val ch = g.getService(HR_SERVICE)?.getCharacteristic(HR_MEASUREMENT)
      if (status != BluetoothGatt.GATT_SUCCESS || ch == null) {
        wanted = false
        sendEvent("onConnection", mapOf("id" to g.device.address, "state" to "failed", "reason" to "no-hr-service"))
        g.disconnect()
        return
      }
      g.setCharacteristicNotification(ch, true)
      val cccd = ch.getDescriptor(CCCD) ?: return
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        g.writeDescriptor(cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
      } else {
        @Suppress("DEPRECATION")
        cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
        @Suppress("DEPRECATION")
        g.writeDescriptor(cccd)
      }
    }

    override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
      if (descriptor.uuid == CCCD && status == BluetoothGatt.GATT_SUCCESS) sendConnection(g.device.address, "connected")
    }

    // Android 13+ delivers the value as a parameter.
    override fun onCharacteristicChanged(g: BluetoothGatt, ch: BluetoothGattCharacteristic, value: ByteArray) {
      if (ch.uuid == HR_MEASUREMENT) sendMeasurement(g.device.address, value)
    }

    @Deprecated("Android 12 and below")
    override fun onCharacteristicChanged(g: BluetoothGatt, ch: BluetoothGattCharacteristic) {
      @Suppress("DEPRECATION")
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU && ch.uuid == HR_MEASUREMENT) sendMeasurement(g.device.address, ch.value ?: return)
    }
  }

  private fun sendMeasurement(id: String, value: ByteArray) {
    sendEvent(
      "onMeasurement",
      mapOf(
        "id" to id,
        "t" to System.currentTimeMillis().toDouble(),
        "bytes" to value.map { it.toInt() and 0xFF },
      ),
    )
  }

  companion object {
    private const val SCAN_TIMEOUT_MS = 30_000L
    private val HR_SERVICE: UUID = UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb")
    private val HR_MEASUREMENT: UUID = UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb")
    private val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
  }
}
