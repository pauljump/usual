import Foundation
import KeyboardCore
import notify

/// Keeps what the keyboard learns in the extension's own container, since without Full Access it can't write to the
/// App Group. The app resets it by sharing a new reset token through `SettingsStore`; the keyboard starts over when the
/// token it sees differs from the one its memory was saved under.
/// With Full Access the keyboard also shares its touch model through the group, for the app to show.
public enum MemoryStore {
    struct Saved: Codable {
        var resets: Int
        var memory: TypingMemory
        var seedVersion: Int? = nil

        func upgraded(from old: TypingMemory, to new: TypingMemory) -> Saved {
            guard seedVersion == nil || seedVersion == 1 else { return self }
            var copy = self
            copy.memory.replaceSeed(old, with: new)
            copy.seedVersion = 2
            return copy
        }
    }

    private static var activeSeedVersion = 2

    private static let resetsKey = "memoryResets"
    private static let touchesChanged = "com.shahidy.hexkeyboard.touches"

    private static var url: URL {
        URL.applicationSupportDirectory.appending(path: "typing-memory.json")
    }

    private static var sharedTouchesURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: SettingsStore.appGroup)?.appending(path: "touches.json")
    }

    private static var resets: Int? { SettingsStore.value(forKey: resetsKey, sharing: false) as? Int }

    static func load() -> TypingMemory {
        guard let saved = try? JSONDecoder().decode(Saved.self, from: Data(contentsOf: url)), saved.resets == resets ?? saved.resets else {
            activeSeedVersion = 2
            return seed() ?? TypingMemory()
        }
        activeSeedVersion = saved.seedVersion ?? 1
        guard saved.seedVersion == nil || saved.seedVersion == 1 else { return saved.memory }
        guard let old = seed(resource: "personal-memory-v1"), let new = seed() else { return saved.memory }
        // Keep the original mixed memory for recovery; never clear phone learning to
        // update a bundled corpus. A failed backup leaves the old model usable.
        let backup = url.deletingLastPathComponent().appending(path: "typing-memory-before-corpus-v2.json")
        if !FileManager.default.fileExists(atPath: backup.path) {
            do { try Data(contentsOf: url).write(to: backup, options: .atomic) }
            catch { return saved.memory }
        }
        let memory = saved.upgraded(from: old, to: new).memory
        activeSeedVersion = 2
        save(memory, sharing: false)
        return memory
    }

    private static func seed(resource: String = "personal-memory") -> TypingMemory? {
        let empty = TypingMemory()
        guard let url = Bundle.module.url(forResource: resource, withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let personal = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let defaults = try? JSONEncoder().encode(empty),
              var object = try? JSONSerialization.jsonObject(with: defaults) as? [String: Any] else { return nil }
        object.merge(personal) { _, new in new }
        guard let merged = try? JSONSerialization.data(withJSONObject: object),
              let seed = try? JSONDecoder().decode(TypingMemory.self, from: merged) else { return nil }
        return seed
    }

    static func save(_ memory: TypingMemory, sharing: Bool) {
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? JSONEncoder().encode(Saved(resets: resets ?? 0, memory: memory, seedVersion: activeSeedVersion)).write(to: url, options: .atomic)
        guard sharing, let sharedTouchesURL, (try? JSONEncoder().encode(memory.touches).write(to: sharedTouchesURL, options: .atomic)) != nil else { return }
        notify_post(touchesChanged)
    }

    public static func reset() {
        SettingsStore.set(Int.random(in: 1 ... .max), forKey: resetsKey)
        if let sharedTouchesURL { try? FileManager.default.removeItem(at: sharedTouchesURL) }
        notify_post(touchesChanged)
    }

    /// Where your taps land, as the keyboard last shared it.
    public static func sharedTouches() -> TouchModel? {
        sharedTouchesURL.flatMap { try? JSONDecoder().decode(TouchModel.self, from: Data(contentsOf: $0)) }
    }

    /// Calls `handler` on the main queue each time the keyboard shares new touches, until the token is cancelled.
    public static func observeTouches(_ handler: @escaping @MainActor @Sendable () -> Void) -> Int32 {
        var token: Int32 = 0
        notify_register_dispatch(touchesChanged, &token, .main) { _ in
            MainActor.assumeIsolated { handler() }
        }
        return token
    }
}
