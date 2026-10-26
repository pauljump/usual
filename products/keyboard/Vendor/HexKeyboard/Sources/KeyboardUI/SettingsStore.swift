import Foundation
import KeyboardCore

/// Settings travel from the app to the keyboard through the App Group, but iOS deletes the group's container whenever
/// an install leaves no app claiming the group, and the keyboard can write it only with Full Access. So each side also
/// keeps its own copy of every value and takes the group's only when the group holds one it hasn't seen: a missing
/// value changes nothing, and a side that may write the group puts its copy back.
public enum SettingsStore {
    public static let appGroup = "group.com.pauljump.telegraph"

    public static let toggles: [(key: String, path: WritableKeyPath<KeyboardSettings, Bool>)] = [
        ("autoCapitalization", \.autoCapitalization),
        ("autoCorrection", \.autoCorrection),
        ("capsLock", \.capsLock),
        ("smartPunctuation", \.smartPunctuation),
        ("periodShortcut", \.periodShortcut),
        ("predictiveText", \.predictiveText),
        ("characterPreview", \.characterPreview),
        ("haptics", \.haptics),
        ("sound", \.sound),
    ]

    private static let oneHandedKey = "oneHanded"

    private static var group: UserDefaults { UserDefaults(suiteName: appGroup) ?? .standard }
    private static var own: UserDefaults { .standard }

    public static func load(sharing: Bool = true) -> KeyboardSettings {
        var settings = KeyboardSettings()
        for (key, path) in toggles {
            if let value = value(forKey: key, sharing: sharing) as? Bool { settings[keyPath: path] = value }
        }
        settings.oneHanded = (value(forKey: oneHandedKey, sharing: sharing) as? String).flatMap(OneHanded.init) ?? .off
        return settings
    }

    public static func set(_ value: Bool, for path: WritableKeyPath<KeyboardSettings, Bool>) {
        guard let key = toggles.first(where: { $0.path == path })?.key else { return }
        set(value, forKey: key)
    }

    public static func set(_ oneHanded: OneHanded, sharing: Bool = true) {
        set(oneHanded.rawValue, forKey: oneHandedKey, sharing: sharing)
    }

    public static func reset() {
        let settings = KeyboardSettings()
        for (key, path) in toggles { set(settings[keyPath: path], forKey: key) }
        set(OneHanded.off)
    }

    static func value(forKey key: String, sharing: Bool) -> Any? {
        let seen = "seen." + key
        if let shared = group.object(forKey: key) as? NSObject {
            if !shared.isEqual(own.object(forKey: seen)) {
                own.set(shared, forKey: seen)
                own.set(shared, forKey: key)
            }
        } else if sharing, let mine = own.object(forKey: key) {
            group.set(mine, forKey: key)
            own.set(mine, forKey: seen)
        }
        return own.object(forKey: key)
    }

    static func set(_ value: Any, forKey key: String, sharing: Bool = true) {
        own.set(value, forKey: key)
        guard sharing else { return }
        group.set(value, forKey: key)
        own.set(value, forKey: "seen." + key)
    }
}
