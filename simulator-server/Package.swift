// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "GroveSimulatorServer",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "GroveSimulatorServer", targets: ["GroveSimulatorServer"])
    ],
    dependencies: [],
    targets: [
        .executableTarget(
            name: "GroveSimulatorServer",
            dependencies: [],
            path: "Sources",
            linkerSettings: [
                .unsafeFlags([
                    "-F", "/Library/Developer/PrivateFrameworks",
                    "-Xlinker", "-rpath", "-Xlinker", "/Library/Developer/PrivateFrameworks"
                ])
            ]
        )
    ]
)
