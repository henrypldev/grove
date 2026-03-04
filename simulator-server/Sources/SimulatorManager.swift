import Foundation
import IOSurface
import Network

class SimulatorManager {
    static let shared = SimulatorManager()

    private var bootedDevices: [String: AnyObject] = [:] // udid → SimDevice
    private let frameworkHandle: UnsafeMutableRawPointer?
    private let available: Bool

    // Objective-C class references loaded from CoreSimulator
    private let simServiceContextClass: AnyClass?
    private let simDeviceSetClass: AnyClass?

    private init() {
        // Load CoreSimulator.framework
        let frameworkPath = "/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator"
        guard let handle = dlopen(frameworkPath, RTLD_NOW) else {
            print("[SimulatorManager] Failed to load CoreSimulator: \(String(cString: dlerror()))")
            self.frameworkHandle = nil
            self.simServiceContextClass = nil
            self.simDeviceSetClass = nil
            self.available = false
            return
        }
        self.frameworkHandle = handle

        guard let serviceCtx = NSClassFromString("SimServiceContext"),
              let deviceSet = NSClassFromString("SimDeviceSet") else {
            print("[SimulatorManager] Failed to find CoreSimulator classes")
            self.simServiceContextClass = nil
            self.simDeviceSetClass = nil
            self.available = false
            return
        }
        self.simServiceContextClass = serviceCtx
        self.simDeviceSetClass = deviceSet
        self.available = true
    }

    func listDevices() -> [DeviceInfo] {
        guard available else { return [] }
        guard let deviceSet = getDefaultDeviceSet() else { return [] }

        let devices = deviceSet.value(forKeyPath: "devices") as? [AnyObject] ?? []
        return devices.compactMap { device -> DeviceInfo? in
            guard let udid = (device.value(forKey: "UDID") as? UUID)?.uuidString,
                  let name = device.value(forKey: "name") as? String,
                  let runtime = device.value(forKeyPath: "runtime.name") as? String,
                  let deviceType = device.value(forKeyPath: "deviceType.name") as? String
            else { return nil }

            let stateRaw = (device.value(forKey: "state") as? Int) ?? 0
            let state = stateRaw == 3 ? "Booted" : "Shutdown"

            return DeviceInfo(
                udid: udid,
                name: name,
                runtime: runtime,
                state: state,
                deviceType: deviceType
            )
        }
    }

    func boot(deviceId: String, connection: NWConnection) {
        guard available else {
            sendError("CoreSimulator not available", on: connection)
            return
        }

        guard let device = findDevice(udid: deviceId) else {
            sendError("Device not found: \(deviceId)", on: connection)
            return
        }

        let stateRaw = (device.value(forKey: "state") as? Int) ?? 0
        if stateRaw == 3 {
            // Already booted — just attach
            bootedDevices[deviceId] = device
            startStreaming(device: device, deviceId: deviceId, connection: connection)
            return
        }

        // Boot headlessly
        let options: [String: Any] = [
            "register-head-services": false  // headless — no Simulator.app window
        ]

        let sel = NSSelectorFromString("bootWithOptions:error:")
        let method = device.method(for: sel)

        typealias BootFn = @convention(c) (AnyObject, Selector, NSDictionary, UnsafeMutablePointer<NSError?>) -> Bool
        let bootFn = unsafeBitCast(method, to: BootFn.self)
        var error: NSError?
        let success = bootFn(device, sel, options as NSDictionary, &error)

        if success {
            bootedDevices[deviceId] = device
            // Poll for IOSurface readiness instead of hard-coded delay
            pollForReady(device: device, deviceId: deviceId, connection: connection)
        } else {
            sendError("Boot failed: \(error?.localizedDescription ?? "unknown")", on: connection)
        }
    }

    func shutdown(deviceId: String, connection: NWConnection) {
        guard let device = bootedDevices.removeValue(forKey: deviceId) else {
            sendError("Device not booted: \(deviceId)", on: connection)
            return
        }

        FrameStreamer.shared.stopStreaming(deviceId: deviceId)
        HIDInput.shared.removeDevice(deviceId: deviceId)

        let sel = NSSelectorFromString("shutdownWithError:")
        let method = device.method(for: sel)
        typealias ShutdownFn = @convention(c) (AnyObject, Selector, UnsafeMutablePointer<NSError?>) -> Bool
        let shutdownFn = unsafeBitCast(method, to: ShutdownFn.self)
        var error: NSError?
        _ = shutdownFn(device, sel, &error)

        sendJSON(ShutdownCompleteMessage(deviceId: deviceId), on: connection)
    }

    func shutdownAll() {
        for (deviceId, device) in bootedDevices {
            FrameStreamer.shared.stopStreaming(deviceId: deviceId)
            HIDInput.shared.removeDevice(deviceId: deviceId)
            let sel = NSSelectorFromString("shutdownWithError:")
            let method = device.method(for: sel)
            typealias ShutdownFn = @convention(c) (AnyObject, Selector, UnsafeMutablePointer<NSError?>) -> Bool
            let shutdownFn = unsafeBitCast(method, to: ShutdownFn.self)
            var error: NSError?
            _ = shutdownFn(device, sel, &error)
        }
        bootedDevices.removeAll()
    }

    func openUrl(_ url: String, deviceId: String? = nil) {
        let udid = deviceId ?? bootedDevices.keys.first
        guard let udid else { return }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
        process.arguments = ["simctl", "openurl", udid, url]
        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            print("[OpenURL] Failed: \(error)")
        }
    }

    func paste(text: String, deviceId: String? = nil) {
        // Find the booted device UDID for simctl
        guard let udid = deviceId ?? bootedDevices.keys.first else { return }

        // Set the simulator pasteboard via simctl pbcopy
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
        process.arguments = ["simctl", "pbcopy", udid]
        let pipe = Pipe()
        process.standardInput = pipe
        do {
            try process.run()
            pipe.fileHandleForWriting.write(Data(text.utf8))
            pipe.fileHandleForWriting.closeFile()
            process.waitUntilExit()
        } catch {
            print("[Paste] Failed to set pasteboard: \(error)")
            return
        }

        // Simulate Cmd+V via HID (Meta down, V down, V up, Meta up)
        let metaKey: UInt32 = 0xe3  // Left GUI/Cmd
        let vKey: UInt32 = 0x19     // V
        HIDInput.shared.sendKeyDown(keyCode: metaKey, deviceId: udid)
        HIDInput.shared.sendKeyDown(keyCode: vKey, deviceId: udid)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            HIDInput.shared.sendKeyUp(keyCode: vKey, deviceId: udid)
            HIDInput.shared.sendKeyUp(keyCode: metaKey, deviceId: udid)
        }
    }

    // MARK: - Private

    private func pollForReady(device: AnyObject, deviceId: String, connection: NWConnection, attempt: Int = 0) {
        let maxAttempts = 40  // 40 × 250ms = 10s
        let pollInterval = 0.25

        // Check if device IO and IOSurface are available
        if device.value(forKey: "io") != nil,
           FrameStreamer.shared.getIOSurfaceForDevice(device) != nil {
            startStreaming(device: device, deviceId: deviceId, connection: connection)
            return
        }

        if attempt >= maxAttempts {
            sendError("Boot timeout: device not ready after 10s", on: connection)
            return
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + pollInterval) {
            self.pollForReady(device: device, deviceId: deviceId, connection: connection, attempt: attempt + 1)
        }
    }

    private func getDefaultDeviceSet() -> AnyObject? {
        guard let simServiceContextClass = simServiceContextClass else { return nil }

        let sharedSel = NSSelectorFromString("sharedServiceContextForDeveloperDir:error:")
        guard simServiceContextClass.responds(to: sharedSel) else { return nil }

        let developerDir = "/Applications/Xcode.app/Contents/Developer"
        var error: NSError?

        typealias SharedFn = @convention(c) (AnyClass, Selector, NSString, UnsafeMutablePointer<NSError?>) -> AnyObject?
        let method = simServiceContextClass.method(for: sharedSel)
        let sharedFn = unsafeBitCast(method, to: SharedFn.self)
        guard let ctx = sharedFn(simServiceContextClass, sharedSel, developerDir as NSString, &error) else {
            return nil
        }

        let dsSel = NSSelectorFromString("defaultDeviceSetWithError:")
        guard ctx.responds(to: dsSel) else { return nil }
        let dsMethod = (ctx as AnyObject).method(for: dsSel)
        typealias DsFn = @convention(c) (AnyObject, Selector, UnsafeMutablePointer<NSError?>) -> AnyObject?
        let dsFn = unsafeBitCast(dsMethod, to: DsFn.self)
        var dsError: NSError?
        return dsFn(ctx, dsSel, &dsError)
    }

    private func findDevice(udid: String) -> AnyObject? {
        guard let deviceSet = getDefaultDeviceSet() else { return nil }
        let devices = deviceSet.value(forKeyPath: "devices") as? [AnyObject] ?? []
        return devices.first { device in
            (device.value(forKey: "UDID") as? UUID)?.uuidString == udid
        }
    }

    private func startStreaming(device: AnyObject, deviceId: String, connection: NWConnection) {
        guard device.value(forKey: "io") != nil else {
            sendError("Cannot access device IO", on: connection)
            return
        }

        // Get screen dimensions from the IOSurface framebuffer
        var screenWidth = 1170
        var screenHeight = 2532
        var screenScale = 3

        if let surface = FrameStreamer.shared.getIOSurfaceForDevice(device) {
            screenWidth = IOSurfaceGetWidth(surface)
            screenHeight = IOSurfaceGetHeight(surface)
            // Estimate scale from resolution (common iOS devices)
            if screenWidth > 1000 { screenScale = 3 }
            else { screenScale = 2 }
        }

        HIDInput.shared.setActiveDevice(device, deviceId: deviceId, width: Double(screenWidth), height: Double(screenHeight), connection: connection)

        sendJSON(BootedMessage(
            deviceId: deviceId,
            width: screenWidth,
            height: screenHeight,
            scale: screenScale
        ), on: connection)

        FrameStreamer.shared.startStreaming(
            device: device,
            deviceId: deviceId,
            connection: connection
        )
    }
}
