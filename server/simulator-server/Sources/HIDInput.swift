import Foundation
import CoreGraphics

class HIDInput {
    static let shared = HIDInput()

    private var hidClient: AnyObject?
    private var screenWidth: Double = 1170
    private var screenHeight: Double = 2532

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

    func setActiveDevice(_ device: AnyObject, width: Double, height: Double) {
        self.screenWidth = width
        self.screenHeight = height

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
            self.hidClient = client
            print("[HID] Client created for device")
        } else {
            print("[HID] Failed to create client: \(error?.localizedDescription ?? "unknown")")
        }
    }

    func sendTouch(x: Double, y: Double, phase: String) {
        guard let mouseFn = mouseFn else { return }

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
        var point = CGPoint(x: x * screenWidth, y: y * screenHeight)

        guard let msg = mouseFn(&point, nil, 0x32, nsEventType, CGSize(width: screenWidth, height: screenHeight), 0) else {
            return
        }

        // The function already sets xRatio/yRatio correctly when given pixel coordinates.
        // Send as-is — the message is already a proper touch digitizer event.
        sendIndigoMessage(msg)
    }

    // Button event sources (from SimulatorKit)
    private static let buttonSourceHome: Int32 = 0x0
    private static let buttonSourceLock: Int32 = 0x1
    private static let buttonTargetHardware: Int32 = 0x33

    func sendButton(name: String) {
        let source: Int32
        switch name {
        case "home": source = HIDInput.buttonSourceHome
        case "lock": source = HIDInput.buttonSourceLock
        case "appSwitcher":
            sendAppSwitcher()
            return
        default: return
        }

        pressButton(source: source)
    }

    private func pressButton(source: Int32) {
        guard let buttonFn = buttonFn else { return }
        // Down
        if let msg = buttonFn(source, 1, HIDInput.buttonTargetHardware) {
            sendIndigoMessage(msg)
        }
        // Up (slight delay for the device to register)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [self] in
            if let msg = buttonFn(source, 2, HIDInput.buttonTargetHardware) {
                sendIndigoMessage(msg)
            }
        }
    }

    private func sendAppSwitcher() {
        // Double-press Home to trigger app switcher
        pressButton(source: HIDInput.buttonSourceHome)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [self] in
            pressButton(source: HIDInput.buttonSourceHome)
        }
    }

    func sendKeyDown(keyCode: UInt32) {
        guard let keyboardFn = keyboardFn else { return }
        // IndigoHIDMessageForKeyboardArbitrary(keyCode, op=1 for down)
        guard let msg = keyboardFn(keyCode, 1) else { return }
        sendIndigoMessage(msg)
    }

    func sendKeyUp(keyCode: UInt32) {
        guard let keyboardFn = keyboardFn else { return }
        // IndigoHIDMessageForKeyboardArbitrary(keyCode, op=2 for up)
        guard let msg = keyboardFn(keyCode, 2) else { return }
        sendIndigoMessage(msg)
    }

    // MARK: - Private

    private func sendIndigoMessage(_ msg: UnsafeMutableRawPointer) {
        guard let client = hidClient else { return }

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
