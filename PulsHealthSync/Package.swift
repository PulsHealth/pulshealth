// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PulsHealthSync",
    platforms: [
        .iOS(.v17),
    ],
    products: [
        .library(name: "PulsHealthSync", targets: ["PulsHealthSync"]),
    ],
    targets: [
        .target(
            name: "PulsHealthSync",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]
        ),
        .testTarget(
            name: "PulsHealthSyncTests",
            dependencies: ["PulsHealthSync"]
        ),
    ]
)
