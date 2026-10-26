import Foundation
import Testing
import KeyboardCore
@testable import KeyboardUI

@MainActor struct MemoryMigrationTests {
    @Test func legacySaveMigratesOnceAcrossSaveAndReload() throws {
        var old = TypingMemory()
        old.record("build", after: nil)
        var new = TypingMemory()
        new.record("hello", after: nil)
        var learned = old
        learned.record("pj", after: "hey")
        learned.keep("pj")
        let legacy = MemoryStore.Saved(resets: 19, memory: learned)
        let data = try JSONEncoder().encode(legacy)
        #expect(!String(decoding: data, as: UTF8.self).contains("seedVersion"))
        let decoded = try JSONDecoder().decode(MemoryStore.Saved.self, from: data)
        let updated = decoded.upgraded(from: old, to: new)
        #expect(updated.resets == 19 && updated.seedVersion == 2)
        #expect(updated.memory.counts["build"] == nil)
        #expect(updated.memory.counts["pj"] == 1 && updated.memory.isKept("pj"))
        let reloaded = try JSONDecoder().decode(MemoryStore.Saved.self, from: JSONEncoder().encode(updated))
        #expect(reloaded.upgraded(from: old, to: new).memory == updated.memory)
    }
}
