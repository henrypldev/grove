import Foundation
import Network

let port: UInt16 = CommandLine.arguments.count > 1
    ? UInt16(CommandLine.arguments[1]) ?? 9876
    : 9876

let params = NWParameters.tcp
let wsOptions = NWProtocolWebSocket.Options()
params.defaultProtocolStack.applicationProtocols.insert(wsOptions, at: 0)

let listener = try! NWListener(using: params, on: NWEndpoint.Port(rawValue: port)!)

listener.newConnectionHandler = { connection in
    handleConnection(connection)
}

listener.stateUpdateHandler = { state in
    switch state {
    case .ready:
        print("WebSocket server listening on port \(port)")
    case .failed(let error):
        print("Server failed: \(error)")
        exit(1)
    default:
        break
    }
}

listener.start(queue: .main)

// Graceful shutdown on SIGTERM
signal(SIGTERM) { _ in
    print("SIGTERM received, shutting down...")
    SimulatorManager.shared.shutdownAll()
    exit(0)
}
signal(SIGINT) { _ in
    print("SIGINT received, shutting down...")
    SimulatorManager.shared.shutdownAll()
    exit(0)
}

func handleConnection(_ connection: NWConnection) {
    connection.start(queue: .main)
    receiveMessage(on: connection)
}

func receiveMessage(on connection: NWConnection) {
    connection.receiveMessage { data, context, _, error in
        if let error = error {
            print("Receive error: \(error)")
            return
        }

        guard let data = data,
              let metadata = context?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata
        else {
            receiveMessage(on: connection)
            return
        }

        if metadata.opcode == .text {
            handleTextMessage(data, on: connection)
        }

        receiveMessage(on: connection)
    }
}

func handleTextMessage(_ data: Data, on connection: NWConnection) {
    let decoder = JSONDecoder()
    guard let msg = try? decoder.decode(ClientMessage.self, from: data) else {
        sendError("Invalid message format", on: connection)
        return
    }

    switch msg.type {
    case "list_devices":
        let devices = SimulatorManager.shared.listDevices()
        sendJSON(DeviceListMessage(devices: devices), on: connection)

    case "boot":
        guard let deviceId = msg.deviceId else {
            sendError("Missing deviceId", on: connection)
            return
        }
        SimulatorManager.shared.boot(deviceId: deviceId, connection: connection)

    case "shutdown":
        guard let deviceId = msg.deviceId else {
            sendError("Missing deviceId", on: connection)
            return
        }
        SimulatorManager.shared.shutdown(deviceId: deviceId, connection: connection)

    case "touch":
        guard let x = msg.x, let y = msg.y, let phase = msg.phase else {
            sendError("Missing touch fields", on: connection)
            return
        }
        HIDInput.shared.sendTouch(x: x, y: y, phase: phase)

    case "key":
        guard let keyCode = msg.keyCode, let isDown = msg.isDown else {
            sendError("Missing key fields", on: connection)
            return
        }
        if isDown {
            HIDInput.shared.sendKeyDown(keyCode: keyCode)
        } else {
            HIDInput.shared.sendKeyUp(keyCode: keyCode)
        }

    case "button":
        guard let button = msg.button else {
            sendError("Missing button field", on: connection)
            return
        }
        HIDInput.shared.sendButton(name: button)

    case "paste":
        guard let text = msg.text else {
            sendError("Missing text field", on: connection)
            return
        }
        SimulatorManager.shared.paste(text: text)

    case "openurl":
        guard let text = msg.text else {
            sendError("Missing text field for openurl", on: connection)
            return
        }
        SimulatorManager.shared.openUrl(text, deviceId: msg.deviceId)

    default:
        sendError("Unknown message type: \(msg.type)", on: connection)
    }
}

func sendJSON<T: Encodable>(_ value: T, on connection: NWConnection) {
    guard let data = try? JSONEncoder().encode(value) else { return }
    let metadata = NWProtocolWebSocket.Metadata(opcode: .text)
    let context = NWConnection.ContentContext(identifier: "text", metadata: [metadata])
    connection.send(content: data, contentContext: context, completion: .idempotent)
}

func sendBinary(_ data: Data, on connection: NWConnection) {
    let metadata = NWProtocolWebSocket.Metadata(opcode: .binary)
    let context = NWConnection.ContentContext(identifier: "binary", metadata: [metadata])
    connection.send(content: data, contentContext: context, completion: .idempotent)
}

func sendError(_ message: String, on connection: NWConnection) {
    sendJSON(ErrorMessage(message: message), on: connection)
}

dispatchMain()
