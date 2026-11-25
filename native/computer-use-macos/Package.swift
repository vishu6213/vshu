// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "VshuComputerUseMacOS",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "VshuComputerUseMacOSCore",
            targets: ["VshuComputerUseMacOSCore"]
        ),
        .executable(
            name: "vshu-computer-use-macos",
            targets: ["VshuComputerUseMacOS"]
        )
    ],
    targets: [
        .target(
            name: "VshuComputerUseMacOSCore",
            path: "Sources/VshuComputerUseMacOSCore"
        ),
        .executableTarget(
            name: "VshuComputerUseMacOS",
            dependencies: ["VshuComputerUseMacOSCore"],
            path: "Sources/VshuComputerUseMacOS"
        ),
        .testTarget(
            name: "VshuComputerUseMacOSTests",
            dependencies: ["VshuComputerUseMacOSCore"],
            path: "Tests/VshuComputerUseMacOSTests"
        )
    ]
)
