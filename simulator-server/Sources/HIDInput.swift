import Foundation
import CoreGraphics
import Network

class HIDInput {
    static let shared = HIDInput()

    private struct DeviceHID {
        let client: AnyObject
        let width: Double
        let height: Double
        let connection: NWConnection
    }

    private var devices: [String: DeviceHID] = [:] // deviceId → HID state
    private var activeDeviceId: String?

    // IndigoHID function pointers from SimulatorKit
    private typealias KeyboardFn = @convention(c) (UInt32, Int32) -> UnsafeMutableRawPointer?
    private typealias MouseFn = @convention(c) (UnsafeMutablePointer<CGPoint>, UnsafeMutablePointer<CGPoint>?, Int32, Int32, CGSize, Int32) -> UnsafeMutableRawPointer?
    private typealias ButtonFn = @convention(c) (Int32, Int32, Int32) -> UnsafeMutableRawPointer?

    private var keyboardFn: KeyboardFn?
    private var mouseFn: MouseFn?
    private var buttonFn: ButtonFn?
    private var simKitHandle: UnsafeMutableRawPointer?

    private let hidClientClass: AnyClass?

    private init() {
        // Load SimulatorKit from the correct path
        let path = "/Applications/Xcode.app/Contents/Developer/Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit"
        simKitHandle = dlopen(path, RTLD_NOW)
        Bundle(path: "/Applications/Xcode.app/Contents/Developer/Library/PrivateFrameworks/SimulatorKit.framework")?.load()

        hidClientClass = NSClassFromString("SimulatorKit.SimDeviceLegacyHIDClient")

        if let handle = simKitHandle {
            if let ptr = dlsym(handle, "IndigoHIDMessageForKeyboardArbitrary") {
                keyboardFn = unsafeBitCast(ptr, to: KeyboardFn.self)
            }
            if let ptr = dlsym(handle, "IndigoHIDMessageForMouseNSEvent") {
                mouseFn = unsafeBitCast(ptr, to: MouseFn.self)
            }
            if let ptr = dlsym(handle, "IndigoHIDMessageForButton") {
                buttonFn = unsafeBitCast(ptr, to: ButtonFn.self)
            }
        }

        if keyboardFn != nil && mouseFn != nil && buttonFn != nil {
            print("[HID] IndigoHID symbols loaded")
        } else {
            print("[HID] Warning: Could not load IndigoHID symbols")
        }
    }

    func setActiveDevice(_ device: AnyObject, deviceId: String, width: Double, height: Double, connection: NWConnection) {
        // Create SimDeviceLegacyHIDClient for this device
        guard let cls = hidClientClass else {
            print("[HID] SimDeviceLegacyHIDClient class not found")
            return
        }

        let initSel = NSSelectorFromString("initWithDevice:error:")
        guard cls.instancesRespond(to: initSel) else {
            print("[HID] initWithDevice:error: not available")
            return
        }

        let alloc = cls.alloc()
        typealias InitFn = @convention(c) (AnyObject, Selector, AnyObject, UnsafeMutablePointer<NSError?>) -> AnyObject?
        var error: NSError?
        let method = (alloc as AnyObject).method(for: initSel)
        let client = unsafeBitCast(method, to: InitFn.self)(alloc, initSel, device, &error)

        if let client = client {
            devices[deviceId] = DeviceHID(client: client, width: width, height: height, connection: connection)
            activeDeviceId = deviceId
            print("[HID] Client created for device \(deviceId)")
        } else {
            print("[HID] Failed to create client: \(error?.localizedDescription ?? "unknown")")
        }
    }

    func removeDevice(deviceId: String) {
        devices.removeValue(forKey: deviceId)
        if activeDeviceId == deviceId {
            activeDeviceId = devices.keys.first
        }
    }

    func removeDevice(for connection: NWConnection) {
        let deviceIds = devices.filter { $0.value.connection === connection }.map { $0.key }
        for deviceId in deviceIds {
            removeDevice(deviceId: deviceId)
        }
    }

    private func device(for deviceId: String?) -> DeviceHID? {
        if let deviceId = deviceId, let d = devices[deviceId] { return d }
        guard let id = activeDeviceId else { return nil }
        return devices[id]
    }

    func sendTouch(x: Double, y: Double, phase: String, deviceId: String? = nil) {
        guard let mouseFn = mouseFn, let device = device(for: deviceId) else { return }

        // On modern Xcode, IndigoHIDMessageForMouseNSEvent already produces proper
        // touch digitizer messages (eventType=2) with dual payloads.
        // nsEventType=6 (drag) returns nil, so use 1 (down) for both began and moved.
        // The digitizer interprets repeated downs at different coordinates as movement.
        let nsEventType: Int32
        switch phase {
        case "began": nsEventType = 1
        case "moved": nsEventType = 1  // drag (6) returns nil; repeated down = move
        case "ended": nsEventType = 2
        default: return
        }

        // Pass screen-pixel coordinates (not 0-1 ratios) since the function divides by screen size
        var point = CGPoint(x: x * device.width, y: y * device.height)

        guard let msg = mouseFn(&point, nil, 0x32, nsEventType, CGSize(width: device.width, height: device.height), 0) else {
            return
        }

        // The function already sets xRatio/yRatio correctly when given pixel coordinates.
        // Send as-is — the message is already a proper touch digitizer event.
        sendIndigoMessage(msg, deviceId: deviceId)
    }

    // Button event sources (from SimulatorKit)
    private static let buttonSourceHome: Int32 = 0x0
    private static let buttonSourceLock: Int32 = 0x1
    private static let buttonTargetHardware: Int32 = 0x33

    func sendButton(name: String, deviceId: String? = nil) {
        let source: Int32
        switch name {
        case "home": source = HIDInput.buttonSourceHome
        case "lock": source = HIDInput.buttonSourceLock
        case "appSwitcher":
            sendAppSwitcher(deviceId: deviceId)
            return
        default: return
        }

        pressButton(source: source, deviceId: deviceId)
    }

    private func pressButton(source: Int32, deviceId: String? = nil) {
        guard let buttonFn = buttonFn else { return }
        // Down
        if let msg = buttonFn(source, 1, HIDInput.buttonTargetHardware) {
            sendIndigoMessage(msg, deviceId: deviceId)
        }
        // Up (slight delay for the device to register)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [self] in
            if let msg = buttonFn(source, 2, HIDInput.buttonTargetHardware) {
                sendIndigoMessage(msg, deviceId: deviceId)
            }
        }
    }

    private func sendAppSwitcher(deviceId: String? = nil) {
        // Double-press Home to trigger app switcher
        pressButton(source: HIDInput.buttonSourceHome, deviceId: deviceId)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [self] in
            pressButton(source: HIDInput.buttonSourceHome, deviceId: deviceId)
        }
    }

    func sendKeyDown(keyCode: UInt32, deviceId: String? = nil) {
        guard let keyboardFn = keyboardFn else { return }
        // IndigoHIDMessageForKeyboardArbitrary(keyCode, op=1 for down)
        guard let msg = keyboardFn(keyCode, 1) else { return }
        sendIndigoMessage(msg, deviceId: deviceId)
    }

    func sendKeyUp(keyCode: UInt32, deviceId: String? = nil) {
        guard let keyboardFn = keyboardFn else { return }
        // IndigoHIDMessageForKeyboardArbitrary(keyCode, op=2 for up)
        guard let msg = keyboardFn(keyCode, 2) else { return }
        sendIndigoMessage(msg, deviceId: deviceId)
    }

    // MARK: - Private

    private func sendIndigoMessage(_ msg: UnsafeMutableRawPointer, deviceId: String? = nil) {
        guard let device = device(for: deviceId) else { return }
        let client = device.client

        let sendSel = NSSelectorFromString("sendWithMessage:freeWhenDone:completionQueue:completion:")
        guard (client as AnyObject).responds(to: sendSel) else { return }

        typealias SendFn = @convention(c) (AnyObject, Selector, UnsafeMutableRawPointer, Bool, DispatchQueue, Any) -> Void
        let method = (client as AnyObject).method(for: sendSel)
        let send = unsafeBitCast(method, to: SendFn.self)

        let callback: @convention(block) (NSError?) -> Void = { error in
            if let error = error {
                print("[HID] Send error: \(error.localizedDescription)")
            }
        }
        send(client, sendSel, msg, true, DispatchQueue.main, callback as Any)
    }
}
