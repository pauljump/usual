import Foundation
import Testing
@testable import KeyboardCore

struct MemoryCodingTests {
    @Test func memorySavedBeforeRecentTapsStillLoads() throws {
        var memory = TypingMemory()
        memory.touches.learn([TapSample(tap: Tap(x: 7.6, y: 2.5, key: "m"), intended: "m")], on: .standard)
        var json = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(memory)) as? [String: Any])
        var touches = try #require(json["touches"] as? [String: Any])
        #expect(touches["recent"] != nil)
        touches["recent"] = nil
        json["touches"] = touches
        let loaded = try JSONDecoder().decode(TypingMemory.self, from: JSONSerialization.data(withJSONObject: json))
        #expect(loaded.touches.taps(for: "m", on: .standard) == 1)
        #expect(loaded.touches.aims(on: .standard).first { $0.key.label == "m" }?.recent.isEmpty == true)
    }

    @Test func keysSavedBeforeTheyRememberedRecentAimStillLoad() throws {
        var memory = TypingMemory()
        memory.touches.learn((0..<40).map { _ in TapSample(tap: Tap(x: 7.3, y: 2.5, key: "m"), intended: "m") }, on: .standard)
        let center = memory.touches.center(of: "m", on: .standard)
        var json = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(memory)) as? [String: Any])
        var touches = try #require(json["touches"] as? [String: Any])
        var layouts = try #require(touches["layouts"] as? [String: [String: [String: Any]]])
        let m = try #require(layouts["standard"]?["m"])
        #expect(m["now"] != nil)
        layouts["standard"]?["m"] = m["all"] as? [String: Any]
        touches["layouts"] = layouts
        json["touches"] = touches
        let loaded = try JSONDecoder().decode(TypingMemory.self, from: JSONSerialization.data(withJSONObject: json))
        #expect(loaded.touches.taps(for: "m", on: .standard) == 40)
        let loadedCenter = loaded.touches.center(of: "m", on: .standard)
        #expect(abs(loadedCenter.x - center.x) < 0.01 && abs(loadedCenter.y - center.y) < 0.01)
    }
}

struct SeedMigrationTests {
    @Test func replacingImportedCountsPreservesPhoneLearningAndCalibration() {
        var old = TypingMemory()
        for _ in 0..<100 { old.record("deploy", after: "please") }
        var fresh = TypingMemory()
        fresh.record("deploy", after: nil)
        fresh.record("dinner", after: "after")
        var saved = old
        saved.record("deploy", after: "please")
        saved.record("pj", after: "hey")
        saved.keep("pj")
        saved.recordAfterSpace(isSpace: true)
        saved.touches.learn([TapSample(tap: Tap(x: 7.6, y: 2.5, key: "m"), intended: "m")], on: .standard)
        let touches = saved.touches
        saved.replaceSeed(old, with: fresh)
        #expect(saved.count(of: "deploy") == 2)
        #expect(saved.following["please"]?["deploy"] == 1)
        #expect(saved.count(of: "pj") == 1 && saved.isKept("pj"))
        #expect(saved.following["after"]?["dinner"] == 1)
        #expect(saved.total == 4)
        #expect(saved.spacesAfterSpace == 1 && saved.keysAfterSpace == 1)
        #expect(saved.touches == touches)
    }

    @Test func trimmedLegacyCountsCannotBecomeNegative() {
        var old = TypingMemory()
        old.record("old", after: "the")
        var saved = TypingMemory()
        var fresh = TypingMemory()
        fresh.record("new", after: "the")
        saved.replaceSeed(old, with: fresh)
        #expect(saved == fresh)
    }
}
