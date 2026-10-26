// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "HexKeyboard",
    platforms: [.iOS(.v26), .macOS(.v26)],
    products: [
        .library(name: "KeyboardCore", targets: ["KeyboardCore"]),
        .library(name: "KeyboardUI", targets: ["KeyboardUI"]),
    ],
    targets: [
        .target(name: "KeyboardCore"),
        .executableTarget(name: "UsualReplay", dependencies: ["KeyboardCore"], path: "Tools/UsualReplay"),
        .executableTarget(name: "SwipeHumanReplay", dependencies: ["KeyboardCore"], path: "Tools/SwipeHumanReplay"),
        .executableTarget(name: "SwipeSentenceReplay", dependencies: ["KeyboardCore"], path: "Tools/SwipeSentenceReplay"),
        .executableTarget(name: "SwipeReplay", dependencies: ["KeyboardCore"], path: "Tools/SwipeReplay"),
        .target(name: "KeyboardUI", dependencies: ["KeyboardCore"], exclude: ["Resources/LEXICON-LICENSE"], resources: [.copy("Resources/en.lexicon"), .copy("Resources/en.phrases"), .copy("Resources/personal-memory.json"), .copy("Resources/personal-memory-v1.json")], swiftSettings: [.defaultIsolation(MainActor.self)]),
        .executableTarget(name: "LexiconBuilder", dependencies: ["KeyboardCore"], path: "Tools/LexiconBuilder"),
        .executableTarget(name: "PhrasesBuilder", dependencies: ["KeyboardCore"], path: "Tools/PhrasesBuilder"),
        .testTarget(name: "KeyboardCoreTests", dependencies: ["KeyboardCore"]),
        .testTarget(name: "KeyboardUITests", dependencies: ["KeyboardUI"], resources: [.copy("phrases.txt"), .copy("chat.txt")]),
    ]
)
