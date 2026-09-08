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
            // Privacy manifest: the package's UserDefaults use (background-task
            // schedule status) is a required-reason API, and SPM targets carry
            // their own PrivacyInfo.xcprivacy for App Store scanning.
            resources: [
                .copy("Resources/PrivacyInfo.xcprivacy"),
            ],
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
