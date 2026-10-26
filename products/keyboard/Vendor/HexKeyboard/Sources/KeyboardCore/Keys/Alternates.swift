enum Alternates {
    private static let all: [String: String] = [
        "a": "àáâäaæãåā",
        "c": "cçćč",
        "e": "ëéeèêěẽēėę",
        "g": "gğġ",
        "i": "îïíiīįì",
        "l": "lł",
        "n": "nñń",
        "o": "ôöòóoœøōõ",
        "s": "sßśš",
        "u": "ûüùúuū",
        "y": "yÿ",
        "z": "zžźż",
        "0": "0°",
        "-": "-–—•",
        "/": "/\\",
        "$": "$₽¥€¢£₩",
        "&": "&§",
        "\"": "\"„“”«»",
        ".": ".…",
        "?": "?¿",
        "!": "!¡",
        "'": "'`‘’‚",
        "%": "%‰",
    ]

    static func `for`(_ character: String) -> [String] {
        all[character].map { $0.map(String.init) } ?? []
    }
}
