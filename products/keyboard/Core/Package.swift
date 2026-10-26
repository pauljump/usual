// swift-tools-version:5.10
import PackageDescription

let package = Package(
    name: "TelegraphCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "TelegraphCore", targets: ["TelegraphCore"]),
        .executable(name: "telegraph", targets: ["telegraph"]),
    ],
    targets: [
        .target(name: "TelegraphCore"),
        .executableTarget(name: "telegraph", dependencies: ["TelegraphCore"]),
        .testTarget(name: "TelegraphCoreTests", dependencies: ["TelegraphCore"]),
    ]
)
