import Foundation
import CoreImage
import CoreGraphics
import IOSurface
import Network
import ImageIO

class FrameStreamer {
    static let shared = FrameStreamer()

    private struct StreamState {
        let timer: DispatchSourceTimer
        let connection: NWConnection
        var encoding: Bool = false
    }

    private var activeStreams: [String: StreamState] = [:] // deviceId → state
    private let ciContext = CIContext(options: [.useSoftwareRenderer: false])
    private let targetFPS: Double = 60.0
    private let jpegQuality: CGFloat = 0.1

    func startStreaming(device: AnyObject, deviceId: String, connection: NWConnection) {
        guard let surface = getIOSurface(from: device) else {
            sendError("Cannot access IOSurface framebuffer", on: connection)
            return
        }

        // Cancel existing stream for this device before starting new one
        if activeStreams[deviceId] != nil {
            stopStreaming(deviceId: deviceId)
        }

        var lastSeed: UInt32 = 0
        let interval = 1.0 / targetFPS
        var isEncoding = false
        // Pre-compute deviceId prefix: [2-byte big-endian length][deviceId UTF-8]
        let deviceIdData = Data(deviceId.utf8)
        var devicePrefix = Data()
        let len = UInt16(deviceIdData.count).bigEndian
        withUnsafeBytes(of: len) { devicePrefix.append(contentsOf: $0) }
        devicePrefix.append(deviceIdData)

        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .userInteractive))
        timer.schedule(deadline: .now(), repeating: interval)

        timer.setEventHandler { [weak self] in
            guard let self = self else { return }

            // Backpressure: skip frame if still encoding previous one
            if isEncoding { return }

            // Check if surface has changed (dirty tracking)
            let currentSeed = IOSurfaceGetSeed(surface)
            guard currentSeed != lastSeed else { return }
            lastSeed = currentSeed

            // Convert IOSurface → JPEG
            isEncoding = true
            if let jpegData = self.encodeFrame(surface: surface) {
                var prefixed = devicePrefix
                prefixed.append(jpegData)
                sendBinary(prefixed, on: connection)
            }
            isEncoding = false
        }

        timer.resume()
        activeStreams[deviceId] = StreamState(timer: timer, connection: connection)
    }

    func getIOSurfaceForDevice(_ device: AnyObject) -> IOSurfaceRef? {
        return getIOSurface(from: device)
    }

    func stopStreaming(deviceId: String) {
        if let state = activeStreams.removeValue(forKey: deviceId) {
            state.timer.cancel()
        }
    }

    func stopAllStreams(for connection: NWConnection) {
        let deviceIds = activeStreams.filter { $0.value.connection === connection }.map { $0.key }
        for deviceId in deviceIds {
            print("[FrameStreamer] Stopping stream for device \(deviceId) (connection closed)")
            stopStreaming(deviceId: deviceId)
        }
    }

    // MARK: - Private

    private func getIOSurface(from device: AnyObject) -> IOSurfaceRef? {
        guard let io = device.value(forKey: "io") as? AnyObject else { return nil }
        let ports = io.value(forKey: "ioPorts") as? [AnyObject] ?? []

        for port in ports {
            // Ports are ROCKRemoteProxy — use perform() not KVC
            let descSel = NSSelectorFromString("descriptor")
            guard port.responds(to: descSel),
                  let desc = port.perform(descSel)?.takeUnretainedValue() else { continue }

            // Only SimDisplayIOSurfaceRenderable ports have framebuffer
            let className = String(describing: type(of: desc))
            guard className.contains("SimDisplayIOSurfaceRenderable") else { continue }

            let fbSel = NSSelectorFromString("framebufferSurface")
            guard desc.responds(to: fbSel),
                  let result = desc.perform(fbSel) else { continue }

            let surfaceObj = result.takeUnretainedValue()
            let surface = unsafeBitCast(surfaceObj, to: IOSurfaceRef.self)
            // Skip surfaces with zero size (nil-equivalent)
            if IOSurfaceGetWidth(surface) > 0 {
                return surface
            }
        }

        return nil
    }

    private func encodeFrame(surface: IOSurfaceRef) -> Data? {
        let ciImage = CIImage(ioSurface: surface)
        guard let cgImage = ciContext.createCGImage(ciImage, from: ciImage.extent) else {
            return nil
        }

        let mutableData = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            mutableData as CFMutableData,
            "public.jpeg" as CFString,
            1,
            nil
        ) else { return nil }

        let options: [CFString: Any] = [
            kCGImageDestinationLossyCompressionQuality: NSNumber(value: Float(jpegQuality))
        ]
        CGImageDestinationAddImage(destination, cgImage, options as CFDictionary)
        CGImageDestinationFinalize(destination)

        return mutableData as Data
    }
}
