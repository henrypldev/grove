import Foundation
import CoreImage
import CoreGraphics
import IOSurface
import Network
import ImageIO

class FrameStreamer {
    static let shared = FrameStreamer()

    private var activeStreams: [String: DispatchSourceTimer] = [:] // deviceId → timer
    private let ciContext = CIContext(options: [.useSoftwareRenderer: false])
    private let targetFPS: Double = 60.0
    private let jpegQuality: CGFloat = 0.9

    func startStreaming(device: AnyObject, deviceId: String, connection: NWConnection) {
        guard let surface = getIOSurface(from: device) else {
            sendError("Cannot access IOSurface framebuffer", on: connection)
            return
        }

        var lastSeed: UInt32 = 0
        let interval = 1.0 / targetFPS

        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .userInteractive))
        timer.schedule(deadline: .now(), repeating: interval)

        timer.setEventHandler { [weak self] in
            guard let self = self else { return }

            // Check if surface has changed (dirty tracking)
            let currentSeed = IOSurfaceGetSeed(surface)
            guard currentSeed != lastSeed else { return }
            lastSeed = currentSeed

            // Convert IOSurface → JPEG
            if let jpegData = self.encodeFrame(surface: surface) {
                sendBinary(jpegData, on: connection)
            }
        }

        timer.resume()
        activeStreams[deviceId] = timer
    }

    func getIOSurfaceForDevice(_ device: AnyObject) -> IOSurfaceRef? {
        return getIOSurface(from: device)
    }

    func stopStreaming(deviceId: String) {
        activeStreams[deviceId]?.cancel()
        activeStreams.removeValue(forKey: deviceId)
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
            kCGImageDestinationLossyCompressionQuality: jpegQuality
        ]
        CGImageDestinationAddImage(destination, cgImage, options as CFDictionary)
        CGImageDestinationFinalize(destination)

        return mutableData as Data
    }
}
