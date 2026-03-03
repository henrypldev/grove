import Foundation

// MARK: - Server → Client messages

struct DeviceInfo: Codable {
    let udid: String
    let name: String
    let runtime: String
    let state: String // "Shutdown", "Booted"
    let deviceType: String
}

struct DeviceListMessage: Codable {
    let type = "device_list"
    let devices: [DeviceInfo]
}

struct BootedMessage: Codable {
    let type = "booted"
    let deviceId: String
    let width: Int
    let height: Int
    let scale: Int
}

struct ShutdownCompleteMessage: Codable {
    let type = "shutdown_complete"
    let deviceId: String
}

struct ErrorMessage: Codable {
    let type = "error"
    let message: String
}

// MARK: - Client → Server messages

struct ClientMessage: Codable {
    let type: String
    let deviceId: String?
    let x: Double?
    let y: Double?
    let phase: String? // "began", "moved", "ended"
    let keyCode: UInt32? // USB HID keycode
    let isDown: Bool? // true=keyDown, false=keyUp
    let button: String? // "home", "lock", "appSwitcher"
    let text: String? // for "paste" type
}
